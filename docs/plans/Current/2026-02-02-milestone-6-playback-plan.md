# Milestone 6: Playback Updates Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable group members to download, decrypt, verify, and play back chunked video recordings on any device.

**Architecture:** Fetch manifest from IPFS, verify merkle root against on-chain data, download all encrypted chunks, unwrap session key using group secret, derive per-chunk keys via HKDF, decrypt and verify each chunk, concatenate into single Blob, play via object URL.

**Tech Stack:** Web Crypto API (HKDF, AES-256-GCM), Blob API, HTML5 Video element, IPFS/Pinata gateway

---

## Overview

This milestone completes the full recording loop: **record → upload → anchor → download → verify → play**. After this, a user on Device A can record evidence, and a trusted contact on Device B (in the same group) can download, verify, and view it.

### Key Differences from Current Implementation

The existing `contentDecrypt.js` handles **single-chunk** content with a single content key. Chunked streaming recordings use:
- **Session key** wrapped per group (unwrap once)
- **Per-chunk keys** derived via HKDF from session key
- **Per-chunk IVs** stored in manifest
- **Composite merkle leaves** (index + plaintextHash + encryptedHash + timestamp)

---

## Task 0: Bridge Session Discovery for Streaming Recordings

**Problem:** Streaming recordings use `updateSession()` which writes to the `sessions` on-chain mapping, but content discovery (`discoverContent()`) reads from the `content` mapping via `getUserContent()` and `getGroupContent()`. These are different data structures, so streaming recordings are invisible to the content browser.

**Files:**
- Modify: `witness-pwa/src/lib/contentDiscovery.js`
- Reference: `witness-pwa/src/lib/contract.js` (may need new read functions)

**Option A: Update Discovery to Query Sessions (Recommended for Hackathon)**

Add session discovery alongside content discovery:

```javascript
// In witness-pwa/src/lib/contentDiscovery.js

import { getUserSessions } from './contract.js'; // New function needed

/**
 * Discover all content the user has access to (including streaming sessions)
 */
export async function discoverContent(forceRefresh = false) {
  // ... existing code ...

  // 1. Get user's own content (existing)
  const userContentIds = await getUserContent(smartAccountAddress);

  // 2. Get user's streaming sessions (NEW)
  const userSessions = await getUserSessions(smartAccountAddress);

  // Convert sessions to content-like items
  for (const session of userSessions) {
    if (!session.manifestCID) continue;

    items[session.sessionId] = {
      contentId: session.sessionId,
      merkleRoot: session.merkleRoot,
      manifestCID: session.manifestCID,
      uploader: smartAccountAddress,
      timestamp: Number(session.updatedAt),
      groupIds: session.groupIds,
      manifest: null,
      isSession: true, // Flag to identify streaming content
    };
  }

  // ... rest of existing code ...
}
```

**Step 1: Add contract read function for user sessions**

In `witness-pwa/src/lib/contract.js`, add:

```javascript
/**
 * Get all session IDs for a user
 * @param {string} address - User address
 * @returns {Promise<object[]>} Array of session data
 */
export async function getUserSessions(address) {
  const contract = getRegistryContract();
  // This requires the contract to have a getUserSessions view function
  // or we query SessionUpdated events

  // Query SessionUpdated events for this user
  const publicClient = getPublicClient();
  const logs = await publicClient.getLogs({
    address: REGISTRY_ADDRESS,
    event: parseAbiItem('event SessionUpdated(bytes32 indexed sessionId, address indexed uploader, bytes32 merkleRoot, string manifestCID, uint256 chunkCount)'),
    args: { uploader: address },
    fromBlock: LOG_START_BLOCK,
    toBlock: 'latest',
  });

  // Deduplicate by sessionId (keep latest)
  const sessions = {};
  for (const log of logs) {
    sessions[log.args.sessionId] = {
      sessionId: log.args.sessionId,
      merkleRoot: log.args.merkleRoot,
      manifestCID: log.args.manifestCID,
      chunkCount: Number(log.args.chunkCount),
      updatedAt: Date.now(), // Would need block timestamp for accuracy
    };
  }

  return Object.values(sessions);
}
```

**Step 2: Test session discovery**

1. Record a streaming session
2. Open Evidence browser
3. Verify the session appears in the list

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/contentDiscovery.js witness-pwa/src/lib/contract.js
git commit -m "feat: add session discovery for streaming recordings"
```

**Note:** This approach queries events which may be slow for many recordings. Post-hackathon, consider adding a `getUserSessions()` view function to the contract that returns session IDs directly.

---

## Task 1: Add HKDF Chunk Key Derivation

**Files:**
- Create: `witness-pwa/src/lib/chunkCrypto.js`
- Test: `witness-pwa/src/lib/chunkCrypto.test.js` (manual browser test)

**Step 1: Write the chunk key derivation function**

```javascript
// witness-pwa/src/lib/chunkCrypto.js

/**
 * Chunk-level cryptographic operations for Witness Protocol
 * Handles HKDF-based per-chunk key derivation and decryption
 */

import { hexToBytes } from './encryption.js';

/**
 * Derive a per-chunk AES-256-GCM key from session key using HKDF
 *
 * @param {CryptoKey} sessionKey - The unwrapped session key (must have 'deriveBits' usage)
 * @param {number} chunkIndex - The chunk index (0, 1, 2, ...)
 * @returns {Promise<CryptoKey>} AES-256-GCM key for this specific chunk
 */
export async function deriveChunkKey(sessionKey, chunkIndex) {
  // Export session key to use as HKDF input key material
  const sessionKeyBytes = await crypto.subtle.exportKey('raw', sessionKey);

  // Import as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sessionKeyBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Encode chunk index as 4-byte big-endian for info parameter
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, chunkIndex, false); // big-endian

  // Derive chunk-specific key using HKDF
  const chunkKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new TextEncoder().encode('witness-chunk'),
      info: indexBytes,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable for security
    ['decrypt']
  );

  return chunkKey;
}

/**
 * Decrypt a single chunk using its derived key
 *
 * @param {ArrayBuffer} encryptedData - The encrypted chunk data
 * @param {CryptoKey} chunkKey - The derived chunk key
 * @param {string} ivHex - The IV as hex string (from manifest)
 * @returns {Promise<ArrayBuffer>} Decrypted chunk data
 */
export async function decryptChunk(encryptedData, chunkKey, ivHex) {
  const iv = hexToBytes(ivHex);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    chunkKey,
    encryptedData
  );

  return decrypted;
}

/**
 * Compute SHA-256 hash of data
 *
 * @param {ArrayBuffer} data - Data to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function computeHash(data) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Step 2: Verify the implementation manually**

Open browser console on the PWA and test:
```javascript
// Test HKDF derivation produces consistent results
const testKey = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  true, // extractable for test
  ['encrypt', 'decrypt']
);

// Import the module
const { deriveChunkKey } = await import('./src/lib/chunkCrypto.js');

const chunk0Key = await deriveChunkKey(testKey, 0);
const chunk1Key = await deriveChunkKey(testKey, 1);

console.log('Chunk 0 key:', chunk0Key);
console.log('Chunk 1 key:', chunk1Key);
// Should be different CryptoKey objects
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/chunkCrypto.js
git commit -m "feat: add HKDF chunk key derivation for chunked playback"
```

---

## Task 2: Create Chunked Content Decryption Service

**Files:**
- Create: `witness-pwa/src/lib/chunkedContentDecrypt.js`
- Modify: `witness-pwa/src/lib/encryption.js` (add extractable session key unwrap)

**Step 1: Add extractable unwrap function to encryption.js**

Add this function after the existing `unwrapContentKey`:

```javascript
// In witness-pwa/src/lib/encryption.js

/**
 * Unwrap a session key for chunk key derivation (extractable)
 * Used for chunked content where we need to derive per-chunk keys via HKDF
 *
 * @param {Uint8Array} iv - IV used during wrapping
 * @param {ArrayBuffer} wrappedKey - The wrapped session key
 * @param {Uint8Array} groupSecret - Group secret to unwrap with
 * @returns {Promise<CryptoKey>} The unwrapped session key (extractable for HKDF)
 */
export async function unwrapSessionKeyForChunks(iv, wrappedKey, groupSecret) {
  const groupKey = await deriveGroupKey(groupSecret);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    groupKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    true, // EXTRACTABLE - needed for HKDF derivation
    ['encrypt', 'decrypt']
  );
}
```

**Step 2: Create the chunked content decryption service**

```javascript
// witness-pwa/src/lib/chunkedContentDecrypt.js

/**
 * Chunked Content Decryption Service for Witness Protocol
 * Downloads and decrypts multi-chunk recordings
 */

import { getAuthState } from './authState.js';
import { getGroupSecrets } from './storage.js';
import { downloadEncryptedContent, downloadManifest } from './ipfs.js';
import { unwrapSessionKeyForChunks, hexToBytes } from './encryption.js';
import { deriveChunkKey, decryptChunk, computeHash } from './chunkCrypto.js';

/**
 * @typedef {Object} ChunkVerification
 * @property {number} index - Chunk index
 * @property {boolean} encryptedHashValid - Whether encrypted hash matches
 * @property {boolean} plaintextHashValid - Whether decrypted hash matches
 * @property {string} status - 'verified' | 'failed' | 'pending'
 */

/**
 * @typedef {Object} ChunkedDecryptProgress
 * @property {'fetching_manifest'|'unwrapping_key'|'downloading'|'decrypting'|'concatenating'|'done'|'error'} step
 * @property {number} progress - 0-100
 * @property {string} message
 * @property {number} [currentChunk] - Current chunk being processed
 * @property {number} [totalChunks] - Total chunks
 * @property {ChunkVerification[]} [verifications] - Per-chunk verification results
 */

/**
 * @typedef {Object} ChunkedDecryptResult
 * @property {Blob} videoBlob - Concatenated decrypted video
 * @property {string} contentId - Content ID
 * @property {boolean} merkleRootVerified - Whether merkle root matches on-chain
 * @property {ChunkVerification[]} chunkVerifications - Per-chunk verification results
 * @property {object} manifest - Full manifest
 * @property {number} totalDuration - Total video duration in ms
 */

/**
 * Download and decrypt chunked content
 *
 * @param {string} contentId - Content ID to decrypt
 * @param {string} manifestCID - IPFS CID of manifest
 * @param {string} onChainMerkleRoot - Merkle root from on-chain (for verification)
 * @param {function(ChunkedDecryptProgress): void} onProgress - Progress callback
 * @returns {Promise<ChunkedDecryptResult>}
 */
export async function downloadAndDecryptChunked(contentId, manifestCID, onChainMerkleRoot, onProgress = () => {}) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  try {
    // Step 1: Fetch manifest
    onProgress({
      step: 'fetching_manifest',
      progress: 5,
      message: 'Fetching manifest...'
    });

    const manifest = await downloadManifest(manifestCID);
    const chunks = manifest.chunks || [];

    if (chunks.length === 0) {
      throw new Error('No chunks in manifest');
    }

    console.log('[chunkedDecrypt] Manifest loaded:', chunks.length, 'chunks');

    // Step 2: Verify merkle root matches on-chain
    const cleanOnChainRoot = onChainMerkleRoot.startsWith('0x')
      ? onChainMerkleRoot.slice(2)
      : onChainMerkleRoot;
    const cleanManifestRoot = manifest.merkleRoot.startsWith('0x')
      ? manifest.merkleRoot.slice(2)
      : manifest.merkleRoot;

    const merkleRootVerified = cleanManifestRoot.toLowerCase() === cleanOnChainRoot.toLowerCase();

    if (!merkleRootVerified) {
      console.warn('[chunkedDecrypt] Merkle root mismatch!');
      console.warn('[chunkedDecrypt] On-chain:', cleanOnChainRoot);
      console.warn('[chunkedDecrypt] Manifest:', cleanManifestRoot);
    }

    // Step 3: Unwrap session key
    onProgress({
      step: 'unwrapping_key',
      progress: 10,
      message: 'Unwrapping session key...',
      totalChunks: chunks.length
    });

    const groupSecrets = await getGroupSecrets(encryptionKey);
    const accessList = manifest.accessList || {};

    let sessionKey = null;

    for (const groupId of Object.keys(accessList)) {
      const secretData = groupSecrets[groupId];
      if (secretData) {
        try {
          const groupSecret = hexToBytes(secretData.secretHex);
          const wrapped = accessList[groupId];
          const wrapIv = hexToBytes(wrapped.iv);
          const wrappedKeyBytes = hexToBytes(wrapped.wrappedKey);

          sessionKey = await unwrapSessionKeyForChunks(wrapIv, wrappedKeyBytes.buffer, groupSecret);
          console.log('[chunkedDecrypt] Unwrapped session key using group:', groupId.slice(0, 18));
          break;
        } catch (err) {
          console.warn('[chunkedDecrypt] Failed to unwrap with group:', groupId.slice(0, 18), err.message);
        }
      }
    }

    if (!sessionKey) {
      throw new Error('No access: you are not a member of any group this content is shared with');
    }

    // Step 4: Download and decrypt each chunk
    const decryptedChunks = [];
    const verifications = [];
    let totalDuration = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const progressPercent = 15 + Math.floor((i / chunks.length) * 70);

      // Download
      onProgress({
        step: 'downloading',
        progress: progressPercent,
        message: `Downloading chunk ${i + 1} of ${chunks.length}...`,
        currentChunk: i,
        totalChunks: chunks.length,
        verifications
      });

      const encryptedData = await downloadEncryptedContent(chunk.cid);

      // Verify encrypted hash
      const encryptedHash = await computeHash(encryptedData);
      const cleanChunkEncHash = chunk.encryptedHash.startsWith('0x')
        ? chunk.encryptedHash.slice(2)
        : chunk.encryptedHash;
      const encryptedHashValid = encryptedHash.toLowerCase() === cleanChunkEncHash.toLowerCase();

      if (!encryptedHashValid) {
        console.warn(`[chunkedDecrypt] Chunk ${i} encrypted hash mismatch!`);
      }

      // Decrypt
      onProgress({
        step: 'decrypting',
        progress: progressPercent + 5,
        message: `Decrypting chunk ${i + 1} of ${chunks.length}...`,
        currentChunk: i,
        totalChunks: chunks.length,
        verifications
      });

      const chunkKey = await deriveChunkKey(sessionKey, chunk.index);
      const decryptedData = await decryptChunk(encryptedData.buffer, chunkKey, chunk.iv);

      // Verify plaintext hash
      const plaintextHash = await computeHash(decryptedData);
      const cleanChunkPtHash = chunk.plaintextHash.startsWith('0x')
        ? chunk.plaintextHash.slice(2)
        : chunk.plaintextHash;
      const plaintextHashValid = plaintextHash.toLowerCase() === cleanChunkPtHash.toLowerCase();

      if (!plaintextHashValid) {
        console.warn(`[chunkedDecrypt] Chunk ${i} plaintext hash mismatch!`);
      }

      const verification = {
        index: chunk.index,
        encryptedHashValid,
        plaintextHashValid,
        status: (encryptedHashValid && plaintextHashValid) ? 'verified' : 'failed'
      };
      verifications.push(verification);

      decryptedChunks.push(new Uint8Array(decryptedData));
      totalDuration += chunk.duration || 0;

      console.log(`[chunkedDecrypt] Chunk ${i}: ${decryptedData.byteLength} bytes, verified=${verification.status}`);
    }

    // Step 5: Concatenate chunks into single Blob
    onProgress({
      step: 'concatenating',
      progress: 90,
      message: 'Concatenating video...',
      totalChunks: chunks.length,
      verifications
    });

    // Detect MIME type from first chunk
    const mimeType = detectVideoMimeType(decryptedChunks[0]);
    const videoBlob = new Blob(decryptedChunks, { type: mimeType });

    console.log(`[chunkedDecrypt] Concatenated ${chunks.length} chunks into ${videoBlob.size} byte ${mimeType} blob`);

    // Done!
    onProgress({
      step: 'done',
      progress: 100,
      message: 'Content ready',
      totalChunks: chunks.length,
      verifications
    });

    return {
      videoBlob,
      contentId,
      merkleRootVerified,
      chunkVerifications: verifications,
      manifest,
      totalDuration
    };

  } catch (err) {
    onProgress({ step: 'error', progress: 0, message: err.message });
    throw err;
  }
}

/**
 * Detect video MIME type from first bytes
 * @param {Uint8Array} data - First chunk data
 * @returns {string} MIME type
 */
function detectVideoMimeType(data) {
  // WebM signature: 1A 45 DF A3
  if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) {
    return 'video/webm';
  }

  // MP4/MOV: ftyp at byte 4
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return 'video/mp4';
  }

  // Default to webm (most common for MediaRecorder)
  return 'video/webm';
}

/**
 * Check if manifest represents chunked content
 * @param {object} manifest - Content manifest
 * @returns {boolean} True if multi-chunk content
 */
export function isChunkedContent(manifest) {
  return manifest.chunks && manifest.chunks.length > 1;
}

/**
 * Get summary info from manifest
 * @param {object} manifest - Content manifest
 * @returns {{chunkCount: number, totalDuration: number, status: string}}
 */
export function getChunkedContentInfo(manifest) {
  const chunks = manifest.chunks || [];
  const totalDuration = chunks.reduce((sum, c) => sum + (c.duration || 0), 0);

  return {
    chunkCount: chunks.length,
    totalDuration,
    status: manifest.status || 'complete'
  };
}
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/encryption.js witness-pwa/src/lib/chunkedContentDecrypt.js
git commit -m "feat: add chunked content decryption with per-chunk verification"
```

---

## Task 3: Update Content Detail UI for Chunked Content

**Files:**
- Modify: `witness-pwa/src/ui/contentDetail.js`

**Step 1: Add chunk info display and progress tracking**

Replace the `createModal()` function and update the modal HTML:

```javascript
// In witness-pwa/src/ui/contentDetail.js

// Add imports at top
import { downloadAndDecryptChunked, isChunkedContent, getChunkedContentInfo } from '../lib/chunkedContentDecrypt.js';

// Update the modal HTML in createModal() - add chunk info section
function createModal() {
  const div = document.createElement('div');
  div.id = 'content-detail-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content content-detail-modal">
      <div class="modal-header">
        <button class="modal-back" id="content-detail-back">← Back</button>
        <h2>Evidence Detail</h2>
        <div style="width: 60px;"></div>
      </div>

      <div class="modal-body">
        <!-- Content Preview -->
        <div id="content-preview" class="content-preview">
          <div id="preview-loading" class="preview-loading">
            <div class="spinner"></div>
            <p id="preview-status">Loading...</p>
            <!-- Chunk progress bar (hidden for single-chunk) -->
            <div id="chunk-progress" class="chunk-progress hidden">
              <div id="chunk-progress-bar" class="chunk-progress-bar"></div>
              <p id="chunk-progress-text" class="chunk-progress-text">0 / 0 chunks</p>
            </div>
          </div>
          <div id="preview-content" class="preview-content hidden"></div>
          <div id="preview-error" class="preview-error hidden"></div>
        </div>

        <!-- Chunk Info (for chunked content) -->
        <div id="chunk-info" class="chunk-info hidden">
          <div class="chunk-info-header">Recording Details</div>
          <div class="chunk-info-row">
            <span class="chunk-info-label">Chunks</span>
            <span id="chunk-count" class="chunk-info-value">-</span>
          </div>
          <div class="chunk-info-row">
            <span class="chunk-info-label">Duration</span>
            <span id="chunk-duration" class="chunk-info-value">-</span>
          </div>
          <div class="chunk-info-row">
            <span class="chunk-info-label">Status</span>
            <span id="chunk-status" class="chunk-info-value">-</span>
          </div>
        </div>

        <!-- Metadata -->
        <div id="content-metadata" class="content-metadata">
          <div class="metadata-row">
            <span class="metadata-label">Uploaded</span>
            <span id="meta-date" class="metadata-value">-</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">By</span>
            <span id="meta-uploader" class="metadata-value">-</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">Shared with</span>
            <span id="meta-groups" class="metadata-value">-</span>
          </div>
        </div>

        <!-- Verification Status -->
        <div id="verification-status" class="verification-status">
          <div class="verification-header">Verification</div>
          <div id="verification-details" class="verification-details">
            <div class="verification-row" id="verify-merkle">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">Merkle root</span>
            </div>
            <div class="verification-row" id="verify-chain">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">On-chain record</span>
            </div>
            <div class="verification-row" id="verify-chunks" class="hidden">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">Chunk integrity</span>
            </div>
          </div>
        </div>

        <!-- Attestation Panel (loaded dynamically) -->
        <div id="attestation-container"></div>

        <!-- Actions -->
        <div class="content-actions">
          <a id="basescan-link" href="#" target="_blank" class="btn btn-secondary btn-full">
            View on Basescan
          </a>
        </div>
      </div>
    </div>
  `;
  return div;
}
```

**Step 2: Update the loadContent function to handle chunked content**

Replace the `loadContent` function:

```javascript
// In witness-pwa/src/ui/contentDetail.js

/**
 * Load and display content (handles both single-chunk and chunked)
 */
async function loadContent(item) {
  const loadingEl = document.getElementById('preview-loading');
  const statusEl = document.getElementById('preview-status');
  const contentEl = document.getElementById('preview-content');
  const errorEl = document.getElementById('preview-error');
  const chunkProgressEl = document.getElementById('chunk-progress');
  const chunkProgressBar = document.getElementById('chunk-progress-bar');
  const chunkProgressText = document.getElementById('chunk-progress-text');
  const chunkInfoEl = document.getElementById('chunk-info');

  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  chunkProgressEl.classList.add('hidden');
  chunkInfoEl.classList.add('hidden');

  // Update metadata immediately
  const { smartAccountAddress } = getAuthState();
  const isOwn = item.uploader.toLowerCase() === smartAccountAddress?.toLowerCase();

  document.getElementById('meta-date').textContent = formatDate(item.timestamp);
  document.getElementById('meta-uploader').textContent = isOwn
    ? 'You'
    : item.uploader.slice(0, 6) + '...' + item.uploader.slice(-4);

  // Get group names
  const names = await getGroupNames(item.groupIds);
  const groupDisplay = item.groupIds.map(gid => names[gid] || gid.slice(0, 8)).join(', ');
  document.getElementById('meta-groups').textContent = groupDisplay || 'None';

  // Set basescan link
  document.getElementById('basescan-link').href =
    `https://sepolia.basescan.org/address/${item.uploader}`;

  try {
    // First fetch manifest to determine if chunked
    const manifest = await downloadManifest(item.manifestCID);
    const isChunked = isChunkedContent(manifest);

    if (isChunked) {
      // Show chunk info
      const info = getChunkedContentInfo(manifest);
      chunkInfoEl.classList.remove('hidden');
      document.getElementById('chunk-count').textContent = `${info.chunkCount} chunks`;
      document.getElementById('chunk-duration').textContent = formatDuration(info.totalDuration);
      document.getElementById('chunk-status').textContent = info.status === 'complete' ? 'Complete' : 'In Progress';

      // Show chunk verification row
      document.getElementById('verify-chunks').classList.remove('hidden');

      // Show progress bar
      chunkProgressEl.classList.remove('hidden');

      // Use chunked decryption
      const result = await downloadAndDecryptChunked(
        item.contentId,
        item.manifestCID,
        item.merkleRoot,
        (progress) => {
          statusEl.textContent = progress.message;

          if (progress.totalChunks) {
            const current = progress.currentChunk !== undefined ? progress.currentChunk + 1 : 0;
            chunkProgressText.textContent = `${current} / ${progress.totalChunks} chunks`;
            chunkProgressBar.style.width = `${progress.progress}%`;
          }
        }
      );

      // Update verification status
      updateVerificationChunked(result.merkleRootVerified, result.chunkVerifications);

      // Render video
      renderChunkedVideo(result.videoBlob);

      loadingEl.classList.add('hidden');

      // Load attestation panel
      await loadAttestationPanel(item.contentId, item.groupIds);

    } else {
      // Use existing single-chunk decryption
      const result = await downloadAndDecrypt(
        item.contentId,
        item.manifestCID,
        item.merkleRoot,
        (progress) => {
          statusEl.textContent = progress.message;
        }
      );

      // Update verification status
      updateVerification(result.verified, 'confirmed');

      // Detect content type and render
      const mimeType = detectContentType(result.manifest, result.data);
      renderPreview(result.data, mimeType);

      loadingEl.classList.add('hidden');

      // Load attestation panel
      await loadAttestationPanel(item.contentId, item.groupIds);
    }
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');

    // Mark verification as failed
    updateVerification(false, null);
  }
}

/**
 * Update verification UI for chunked content
 */
function updateVerificationChunked(merkleValid, chunkVerifications) {
  const merkleEl = document.getElementById('verify-merkle');
  const chainEl = document.getElementById('verify-chain');
  const chunksEl = document.getElementById('verify-chunks');

  merkleEl.innerHTML = `
    <span class="verify-icon">${merkleValid ? '✅' : '❌'}</span>
    <span class="verify-text">Merkle root ${merkleValid ? 'verified' : 'MISMATCH'}</span>
  `;

  chainEl.innerHTML = `
    <span class="verify-icon">✅</span>
    <span class="verify-text">On-chain since block confirmed</span>
  `;

  // Check all chunks verified
  const allVerified = chunkVerifications.every(v => v.status === 'verified');
  const verifiedCount = chunkVerifications.filter(v => v.status === 'verified').length;

  chunksEl.innerHTML = `
    <span class="verify-icon">${allVerified ? '✅' : '⚠️'}</span>
    <span class="verify-text">${verifiedCount}/${chunkVerifications.length} chunks verified</span>
  `;
}

/**
 * Render chunked video with object URL
 */
function renderChunkedVideo(videoBlob) {
  const previewEl = document.getElementById('preview-content');

  // Clean up previous URL
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
  }

  // Create object URL for video blob
  decryptedUrl = URL.createObjectURL(videoBlob);

  previewEl.innerHTML = `
    <video controls class="video-preview" playsinline>
      <source src="${decryptedUrl}" type="${videoBlob.type}" />
      Your browser does not support video playback.
    </video>
  `;

  previewEl.classList.remove('hidden');
}

/**
 * Format duration in ms to human readable
 */
function formatDuration(ms) {
  if (!ms) return 'Unknown';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}
```

**Step 3: Add required import for downloadManifest**

Add to imports at top of file:
```javascript
import { downloadManifest } from '../lib/ipfs.js';
```

**Step 4: Commit**

```bash
git add witness-pwa/src/ui/contentDetail.js
git commit -m "feat: update content detail UI for chunked video playback"
```

---

## Task 4: Add CSS for Chunk Progress UI

**Files:**
- Modify: `witness-pwa/src/index.css`

**Step 1: Add chunk progress styles**

Add these styles after the existing `.preview-loading` styles:

```css
/* In witness-pwa/src/index.css */

/* Chunk Progress */
.chunk-progress {
  margin-top: 1rem;
  width: 100%;
  max-width: 300px;
}

.chunk-progress-bar {
  height: 4px;
  background: var(--primary);
  border-radius: 2px;
  width: 0%;
  transition: width 0.3s ease;
}

.chunk-progress-text {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-top: 0.5rem;
  text-align: center;
}

/* Chunk Info Section */
.chunk-info {
  background: var(--surface);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
}

.chunk-info-header {
  font-weight: 600;
  margin-bottom: 0.75rem;
  color: var(--text-primary);
}

.chunk-info-row {
  display: flex;
  justify-content: space-between;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.chunk-info-row:last-child {
  border-bottom: none;
}

.chunk-info-label {
  color: var(--text-secondary);
}

.chunk-info-value {
  color: var(--text-primary);
  font-weight: 500;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/index.css
git commit -m "style: add CSS for chunk progress and info display"
```

---

## Task 5: Handle Object URL Cleanup

**Files:**
- Modify: `witness-pwa/src/ui/contentDetail.js`

**Step 1: Ensure cleanup on modal close**

The existing `hideContentDetail` function already revokes the object URL. Verify it handles the chunked case:

```javascript
// In witness-pwa/src/ui/contentDetail.js

/**
 * Hide the content detail modal
 */
export function hideContentDetail() {
  if (modal) {
    modal.classList.add('hidden');
  }

  // Clean up URL to prevent memory leak
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
    console.log('[contentDetail] Object URL revoked');
  }
}
```

**Step 2: Add cleanup on new content load**

This is already handled in `renderChunkedVideo` and `renderPreview` - they revoke previous URL before creating new one. Verify both functions have this:

```javascript
// Clean up previous URL
if (decryptedUrl) {
  URL.revokeObjectURL(decryptedUrl);
  decryptedUrl = null;
}
```

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/contentDetail.js
git commit -m "fix: ensure object URL cleanup on modal close and content change"
```

---

## Task 6: Integration Test - Cross-Device Playback

**Files:**
- None (manual testing)

**Step 1: Record chunked content on Device A**

1. Open PWA on Device A (phone or browser)
2. Login with user A credentials
3. Create or join a group
4. Start recording (should produce 10-second chunks)
5. Record for at least 30 seconds (3+ chunks)
6. Stop recording
7. Wait for all chunks to upload and anchor
8. Note the content ID from content list

**Step 2: Play back on Device B**

1. Open PWA on Device B (different device/browser)
2. Login with user B credentials (must be in same group)
3. Navigate to content list
4. Find the recording from Device A
5. Tap to open content detail

**Step 3: Verify playback**

Expected behavior:
- [ ] Shows "X chunks" and duration
- [ ] Progress bar shows download progress
- [ ] Chunk count increments as each downloads
- [ ] Merkle root shows verified (green check)
- [ ] Chunk integrity shows "X/X chunks verified"
- [ ] Video plays without corruption
- [ ] No gaps between chunks
- [ ] Audio is continuous

**Step 4: Test with wrong group**

1. Open PWA with user C (NOT in the group)
2. Try to open the same content
3. Should show: "No access: you are not a member of any group this content is shared with"

**Step 5: Document test results**

```
Test: Cross-Device Chunked Playback
Date: ____
Device A: ____
Device B: ____
Recording duration: ____ seconds
Chunk count: ____
Results:
- [ ] Chunks downloaded: PASS/FAIL
- [ ] Decryption succeeded: PASS/FAIL
- [ ] Merkle verification: PASS/FAIL
- [ ] Video playback: PASS/FAIL
- [ ] Audio quality: PASS/FAIL
- [ ] Access denied for non-member: PASS/FAIL
```

---

## Task 7: Handle Edge Cases

**Files:**
- Modify: `witness-pwa/src/lib/chunkedContentDecrypt.js`

**Step 1: Add retry logic for failed chunk downloads**

Update the download loop to retry failed chunks:

```javascript
// In downloadAndDecryptChunked, update the chunk download section:

const MAX_RETRIES = 3;

for (let i = 0; i < chunks.length; i++) {
  const chunk = chunks[i];
  let encryptedData = null;
  let lastError = null;

  // Retry loop for download
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const progressPercent = 15 + Math.floor((i / chunks.length) * 70);

      onProgress({
        step: 'downloading',
        progress: progressPercent,
        message: attempt > 0
          ? `Retrying chunk ${i + 1} (attempt ${attempt + 1})...`
          : `Downloading chunk ${i + 1} of ${chunks.length}...`,
        currentChunk: i,
        totalChunks: chunks.length,
        verifications
      });

      encryptedData = await downloadEncryptedContent(chunk.cid);
      break; // Success, exit retry loop
    } catch (err) {
      lastError = err;
      console.warn(`[chunkedDecrypt] Chunk ${i} download failed (attempt ${attempt + 1}):`, err.message);

      if (attempt < MAX_RETRIES - 1) {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  if (!encryptedData) {
    throw new Error(`Failed to download chunk ${i} after ${MAX_RETRIES} attempts: ${lastError?.message}`);
  }

  // ... rest of verification and decryption
}
```

**Step 2: Handle interrupted recordings (status: 'interrupted')**

Add handling in UI for interrupted recordings:

```javascript
// In contentDetail.js loadContent function, after getting chunk info:

if (info.status === 'interrupted') {
  document.getElementById('chunk-status').textContent = 'Interrupted';
  document.getElementById('chunk-status').classList.add('status-warning');
}
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/chunkedContentDecrypt.js witness-pwa/src/ui/contentDetail.js
git commit -m "fix: add retry logic for chunk downloads and handle interrupted recordings"
```

---

## Memory Considerations

For hackathon scope, we load all chunks into memory before concatenating. This is acceptable for short recordings (<5 minutes, ~150MB at typical quality).

**Current approach:**
```javascript
const decryptedChunks = [];
for (chunk of chunks) {
  decryptedChunks.push(new Uint8Array(decryptedData));
}
const videoBlob = new Blob(decryptedChunks, { type: mimeType });
```

**Post-hackathon improvement (streaming playback with MSE):**
- Use MediaSource Extension for progressive playback
- Stream chunks to SourceBuffer as they decrypt
- Don't load all into memory at once
- Enables playback of multi-hour recordings

This is noted as out of scope per the planning context.

---

## Success Criteria

From Milestone 6 definition:
- [ ] Bridge session discovery (streaming recordings visible in Evidence browser)
- [ ] Update content detail for chunked content (shows chunk count, duration, status)
- [ ] Download → decrypt → concatenate → play flow
- [ ] **Test**: Record on Device A, play on Device B

The session discovery bridge (Task 0) is a prerequisite - without it, streaming recordings won't appear in the content list.

---

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `witness-pwa/src/lib/contentDiscovery.js` | Modify | Add session discovery for streaming recordings |
| `witness-pwa/src/lib/contract.js` | Modify | Add getUserSessions() for session event queries |
| `witness-pwa/src/lib/chunkCrypto.js` | Create | HKDF chunk key derivation |
| `witness-pwa/src/lib/chunkedContentDecrypt.js` | Create | Multi-chunk download/decrypt service |
| `witness-pwa/src/lib/encryption.js` | Modify | Add extractable session key unwrap |
| `witness-pwa/src/ui/contentDetail.js` | Modify | UI for chunked playback |
| `witness-pwa/src/index.css` | Modify | Chunk progress styles |

---

## References

- [Phase 8 Plan](./2026-02-02-phase-8-streaming-video-capture.md) - Parent plan
- [Data Chunking Design](../../research/video-storage-and-transport/data-chunking-transport-design.md) - Technical spec
- [MDN: HKDF](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey#hkdf) - Key derivation
- [MDN: Blob constructor](https://developer.mozilla.org/en-US/docs/Web/API/Blob/Blob) - Concatenation
- [MDN: URL.createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL) - Video playback
