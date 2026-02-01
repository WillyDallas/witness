# Phase 5: Content Upload (IPFS + On-Chain Commit) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable encrypted content upload to IPFS with Merkle root commitment on-chain for integrity verification.

**Architecture:** Create a content service that orchestrates the full upload flow: generate content key, encrypt data, wrap key for each selected group, build manifest with chunk CIDs, compute Merkle root, upload to Pinata, and commit on-chain. Start with text content for testing; video integration comes in Phase 8.

**Tech Stack:** Pinata SDK (IPFS), Web Crypto API (AES-256-GCM), existing encryption.js (key wrapping), existing contract.js (commitContent)

---

## Documentation Verification (Context7 Research)

**Verified against Pinata SDK** (`/pinatacloud/docs` - 1187 snippets, Benchmark 72.8):

| Feature | Verification | Source |
|---------|--------------|--------|
| SDK initialization | `new PinataSDK({ pinataJwt, pinataGateway })` | Context7 examples |
| Upload file | `await pinata.upload.public.file(file)` returns `{ cid, size, ... }` | Context7 examples |
| Upload JSON | `await pinata.upload.public.json(jsonData)` | Context7 examples |
| Retrieve file | `await pinata.gateways.public.get(cid)` | Context7 examples |
| Get gateway URL | `await pinata.gateways.convert(cid)` or `https://${gateway}/ipfs/${cid}` | Context7 examples |

**Verified against MDN Web Docs** (`/mdn/content`):

| Feature | Verification | Source |
|---------|--------------|--------|
| SHA-256 digest | `await crypto.subtle.digest("SHA-256", data)` returns ArrayBuffer | MDN digest docs |
| Hex encoding | `Array.from(new Uint8Array(buffer)).map(b => b.toString(16).padStart(2, '0')).join('')` | MDN examples |

**Key Implementation Notes:**
- Pinata SDK uses `pinata` npm package (not `pinata-web3` which is deprecated)
- For browser builds, gateway downloads don't require JWT authentication
- Merkle tree can be implemented manually using SHA-256 (no external library needed for simple case)
- Content key is AES-256-GCM, extractable, wrapped separately for each group

---

## Prerequisites

- Phase 1 complete (Privy auth + smart account)
- Phase 2 complete (contract deployed with commitContent)
- Phase 3 complete (encryption.js with key wrapping)
- Phase 4 complete (groups.js with group secret storage)

## Current State Analysis

**Already Implemented:**
- `contract.js`: `commitContent(contentId, merkleRoot, manifestCID, groupIds)`, `getContent()`, `getUserContent()`, `getGroupContent()`
- `encryption.js`: `generateContentKey()`, `encrypt()`, `wrapContentKey()`, `unwrapContentKey()`, `sha256()`, `bytesToHex()`
- `storage.js`: `getGroupSecrets()`, `getGroupSecret()`
- `groups.js`: `getMyGroups()`

**Missing (this phase):**
- Pinata/IPFS service for uploads/downloads
- Content service for orchestrating full upload flow
- Merkle tree utility for computing root hash
- Content upload UI modal
- Integration with drawer/main UI

---

### Task 1: Install Pinata SDK

**Files:**
- Modify: `witness-pwa/package.json`

**Step 1: Install the Pinata SDK**

```bash
cd witness-pwa && npm install pinata
```

**Step 2: Verify installation**

```bash
npm ls pinata
```

Expected: `pinata@x.x.x` listed without errors.

**Step 3: Add Pinata environment variables**

Add to `witness-pwa/.env` (create if needed):

```env
VITE_PINATA_JWT=your-pinata-jwt
VITE_PINATA_GATEWAY=your-gateway.mypinata.cloud
```

**Step 4: Update .env.example**

Add to `.env.example`:

```env
# Pinata Configuration (https://app.pinata.cloud)
VITE_PINATA_JWT=your-pinata-jwt
VITE_PINATA_GATEWAY=your-gateway.mypinata.cloud
```

**Step 5: Commit**

```bash
git add witness-pwa/package.json witness-pwa/package-lock.json .env.example
git commit -m "chore: add Pinata SDK for IPFS uploads"
```

---

### Task 2: Create IPFS Service

**Files:**
- Create: `witness-pwa/src/lib/ipfs.js`

**Step 1: Write the IPFS service**

```javascript
/**
 * IPFS Service for Witness Protocol
 * Handles file uploads and downloads via Pinata
 */

import { PinataSDK } from 'pinata';

// Initialize Pinata SDK
const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY;

let pinata = null;

/**
 * Get or initialize Pinata SDK instance
 * @returns {PinataSDK}
 */
function getPinata() {
  if (!pinata) {
    if (!PINATA_JWT) {
      throw new Error('VITE_PINATA_JWT not configured');
    }
    if (!PINATA_GATEWAY) {
      throw new Error('VITE_PINATA_GATEWAY not configured');
    }

    pinata = new PinataSDK({
      pinataJwt: PINATA_JWT,
      pinataGateway: PINATA_GATEWAY,
    });
  }
  return pinata;
}

/**
 * Upload encrypted data to IPFS
 * @param {Uint8Array} encryptedData - Encrypted bytes to upload
 * @param {string} filename - Filename for the upload
 * @returns {Promise<{cid: string, size: number}>}
 */
export async function uploadEncryptedData(encryptedData, filename) {
  const sdk = getPinata();

  // Create a File object from the encrypted bytes
  const file = new File([encryptedData], filename, {
    type: 'application/octet-stream',
  });

  try {
    const result = await sdk.upload.public.file(file);
    console.log('[ipfs] Uploaded:', filename, '→', result.cid);

    return {
      cid: result.cid,
      size: result.size,
    };
  } catch (err) {
    console.error('[ipfs] Upload failed:', err);
    throw new Error('Failed to upload to IPFS: ' + err.message);
  }
}

/**
 * Upload JSON manifest to IPFS
 * @param {object} manifest - Manifest object
 * @returns {Promise<{cid: string}>}
 */
export async function uploadManifest(manifest) {
  const sdk = getPinata();

  try {
    const result = await sdk.upload.public.json(manifest);
    console.log('[ipfs] Manifest uploaded:', result.cid);

    return {
      cid: result.cid,
    };
  } catch (err) {
    console.error('[ipfs] Manifest upload failed:', err);
    throw new Error('Failed to upload manifest: ' + err.message);
  }
}

/**
 * Download content from IPFS
 * @param {string} cid - Content ID to download
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadContent(cid) {
  const sdk = getPinata();

  try {
    const response = await sdk.gateways.public.get(cid);

    // Response could be various types - handle accordingly
    if (response instanceof ArrayBuffer) {
      return response;
    }

    if (response instanceof Blob) {
      return await response.arrayBuffer();
    }

    // If it's JSON (for manifests), return as-is
    if (typeof response === 'object') {
      return response;
    }

    throw new Error('Unexpected response type from gateway');
  } catch (err) {
    console.error('[ipfs] Download failed:', err);
    throw new Error('Failed to download from IPFS: ' + err.message);
  }
}

/**
 * Get gateway URL for a CID
 * @param {string} cid - Content ID
 * @returns {string} Full gateway URL
 */
export function getGatewayUrl(cid) {
  return `https://${PINATA_GATEWAY}/ipfs/${cid}`;
}

/**
 * Check if IPFS is configured
 * @returns {boolean}
 */
export function isConfigured() {
  return Boolean(PINATA_JWT && PINATA_GATEWAY);
}
```

**Step 2: Verify imports work**

```bash
cd witness-pwa && npm run dev
```

Open browser console, verify no import errors.

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/ipfs.js
git commit -m "feat(ipfs): add IPFS service for Pinata uploads/downloads"
```

---

### Task 3: Create Merkle Tree Utility

**Files:**
- Create: `witness-pwa/src/lib/merkle.js`

**Step 1: Write the Merkle tree utility**

```javascript
/**
 * Merkle Tree Utility for Witness Protocol
 * Computes Merkle root from content chunk hashes for integrity verification
 */

/**
 * Hash data using SHA-256 and return as hex string
 * @param {Uint8Array|ArrayBuffer} data - Data to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
async function sha256Hex(data) {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash data using SHA-256 and return as bytes
 * @param {Uint8Array|ArrayBuffer} data - Data to hash
 * @returns {Promise<Uint8Array>} Hash bytes
 */
async function sha256Bytes(data) {
  const buffer = data instanceof ArrayBuffer ? data : data.buffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hashBuffer);
}

/**
 * Concatenate two Uint8Arrays
 * @param {Uint8Array} a - First array
 * @param {Uint8Array} b - Second array
 * @returns {Uint8Array} Concatenated array
 */
function concat(a, b) {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * Compute Merkle root from leaf hashes
 * Uses SHA-256 for internal nodes: H(left || right)
 * @param {string[]} leafHashes - Array of hex-encoded leaf hashes
 * @returns {Promise<string>} Hex-encoded Merkle root
 */
export async function computeMerkleRoot(leafHashes) {
  if (leafHashes.length === 0) {
    throw new Error('Cannot compute Merkle root of empty array');
  }

  // Single leaf case
  if (leafHashes.length === 1) {
    return leafHashes[0];
  }

  // Convert hex strings to bytes
  let level = leafHashes.map(hex => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  });

  // Build tree bottom-up
  while (level.length > 1) {
    const nextLevel = [];

    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      // If odd number of nodes, duplicate the last one
      const right = level[i + 1] || level[i];

      // Hash the concatenation
      const combined = concat(left, right);
      const parent = await sha256Bytes(combined);
      nextLevel.push(parent);
    }

    level = nextLevel;
  }

  // Convert root to hex
  return Array.from(level[0])
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hash content and return hex string (for leaf hashes)
 * @param {Uint8Array|ArrayBuffer} content - Content to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function hashContent(content) {
  return sha256Hex(content);
}

/**
 * Generate a unique content ID from manifest data
 * contentId = SHA-256(uploader || timestamp || merkleRoot)
 * @param {string} uploader - Uploader address
 * @param {number} timestamp - Unix timestamp
 * @param {string} merkleRoot - Merkle root hex
 * @returns {Promise<string>} Bytes32 hex content ID with 0x prefix
 */
export async function generateContentId(uploader, timestamp, merkleRoot) {
  const data = new TextEncoder().encode(
    `${uploader.toLowerCase()}:${timestamp}:${merkleRoot}`
  );
  const hash = await sha256Hex(data);
  return '0x' + hash;
}
```

**Step 2: Test Merkle root computation**

In browser console:
```javascript
import { computeMerkleRoot, hashContent } from './src/lib/merkle.js';

// Test with known data
const hash1 = await hashContent(new TextEncoder().encode('chunk1'));
const hash2 = await hashContent(new TextEncoder().encode('chunk2'));
const root = await computeMerkleRoot([hash1, hash2]);
console.log('Merkle root:', root);
// Should produce a 64-char hex string
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/merkle.js
git commit -m "feat(merkle): add Merkle tree utility for content integrity"
```

---

### Task 4: Create Content Service

**Files:**
- Create: `witness-pwa/src/lib/content.js`

**Step 1: Write the content service**

```javascript
/**
 * Content Service for Witness Protocol
 * Orchestrates content encryption, upload, and on-chain commitment
 */

import { getAuthState } from './authState.js';
import { generateContentKey, encrypt, wrapContentKey, bytesToHex } from './encryption.js';
import { getGroupSecrets, getGroupSecret } from './storage.js';
import { uploadEncryptedData, uploadManifest } from './ipfs.js';
import { computeMerkleRoot, hashContent, generateContentId } from './merkle.js';
import { commitContent as contractCommitContent, waitForTransaction } from './contract.js';

/**
 * @typedef {Object} UploadProgress
 * @property {'preparing'|'encrypting'|'uploading'|'committing'|'done'|'error'} step
 * @property {number} progress - 0-100
 * @property {string} message
 */

/**
 * @typedef {Object} UploadResult
 * @property {string} contentId - On-chain content ID
 * @property {string} manifestCID - IPFS CID of manifest
 * @property {string} merkleRoot - Merkle root hash
 * @property {string} txHash - Transaction hash
 * @property {string[]} groupIds - Groups shared with
 */

/**
 * @typedef {Object} VideoManifest
 * @property {number} version
 * @property {string} contentId
 * @property {string} uploader
 * @property {number} createdAt
 * @property {Array<{index: number, cid: string, size: number, plaintextHash: string}>} chunks
 * @property {{algorithm: string, iv: string}} encryption
 * @property {Object<string, {wrappedKey: string, iv: string}>} accessList
 * @property {string} merkleRoot
 */

/**
 * Upload content with encryption and on-chain commitment
 * @param {Uint8Array} contentData - Raw content bytes
 * @param {string[]} selectedGroupIds - Group IDs to share with
 * @param {object} metadata - Optional metadata (title, etc.)
 * @param {function(UploadProgress): void} onProgress - Progress callback
 * @returns {Promise<UploadResult>}
 */
export async function uploadContent(contentData, selectedGroupIds, metadata = {}, onProgress = () => {}) {
  const { encryptionKey, smartAccountAddress } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated - encryption key required');
  }

  if (!smartAccountAddress) {
    throw new Error('Smart account not initialized');
  }

  if (selectedGroupIds.length === 0) {
    throw new Error('Must select at least one group to share with');
  }

  try {
    // Step 1: Prepare
    onProgress({ step: 'preparing', progress: 0, message: 'Preparing content...' });

    const timestamp = Math.floor(Date.now() / 1000);

    // Step 2: Generate content key and encrypt
    onProgress({ step: 'encrypting', progress: 10, message: 'Encrypting content...' });

    const contentKey = await generateContentKey();
    const { iv: encryptionIv, ciphertext } = await encrypt(contentData, contentKey);
    const encryptedBytes = new Uint8Array(ciphertext);

    // Hash the plaintext for verification
    const plaintextHash = await hashContent(contentData);

    onProgress({ step: 'encrypting', progress: 30, message: 'Wrapping keys for groups...' });

    // Step 3: Wrap content key for each group
    const accessList = {};
    const secrets = await getGroupSecrets(encryptionKey);

    for (const groupId of selectedGroupIds) {
      const groupData = secrets[groupId];
      if (!groupData) {
        throw new Error(`Group secret not found for ${groupId.slice(0, 10)}...`);
      }

      const groupSecret = hexToBytes(groupData.secretHex);
      const { iv: wrapIv, wrappedKey } = await wrapContentKey(contentKey, groupSecret);

      accessList[groupId] = {
        wrappedKey: bytesToHex(new Uint8Array(wrappedKey)),
        iv: bytesToHex(wrapIv),
      };
    }

    // Step 4: Upload encrypted content to IPFS
    onProgress({ step: 'uploading', progress: 40, message: 'Uploading to IPFS...' });

    const chunkFilename = `content_${timestamp}.enc`;
    const { cid: chunkCid, size: chunkSize } = await uploadEncryptedData(encryptedBytes, chunkFilename);

    // Step 5: Compute Merkle root (single chunk for now)
    onProgress({ step: 'uploading', progress: 60, message: 'Computing integrity hash...' });

    const chunkHash = await hashContent(encryptedBytes);
    const merkleRoot = await computeMerkleRoot([chunkHash]);

    // Step 6: Generate content ID
    const contentId = await generateContentId(smartAccountAddress, timestamp, merkleRoot);

    // Step 7: Build and upload manifest
    onProgress({ step: 'uploading', progress: 70, message: 'Uploading manifest...' });

    const manifest = {
      version: 1,
      contentId,
      uploader: smartAccountAddress,
      createdAt: timestamp,
      chunks: [
        {
          index: 0,
          cid: chunkCid,
          size: chunkSize,
          plaintextHash,
        },
      ],
      encryption: {
        algorithm: 'aes-256-gcm',
        iv: bytesToHex(encryptionIv),
      },
      accessList,
      merkleRoot,
      metadata: metadata.title ? { title: metadata.title } : undefined,
    };

    const { cid: manifestCID } = await uploadManifest(manifest);

    // Step 8: Commit on-chain
    onProgress({ step: 'committing', progress: 80, message: 'Committing to blockchain...' });

    const merkleRootBytes32 = '0x' + merkleRoot;
    const txHash = await contractCommitContent(contentId, merkleRootBytes32, manifestCID, selectedGroupIds);

    onProgress({ step: 'committing', progress: 90, message: 'Waiting for confirmation...' });

    await waitForTransaction(txHash);

    // Done!
    onProgress({ step: 'done', progress: 100, message: 'Upload complete!' });

    console.log('[content] Upload complete:', {
      contentId,
      manifestCID,
      merkleRoot,
      txHash,
    });

    return {
      contentId,
      manifestCID,
      merkleRoot,
      txHash,
      groupIds: selectedGroupIds,
    };
  } catch (err) {
    onProgress({ step: 'error', progress: 0, message: err.message });
    throw err;
  }
}

/**
 * Helper to convert hex to bytes (import from encryption.js doesn't work in some cases)
 */
function hexToBytes(hex) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}
```

**Step 2: Verify service loads**

```bash
cd witness-pwa && npm run dev
```

In browser console:
```javascript
import { uploadContent } from './src/lib/content.js';
console.log('Content service loaded:', typeof uploadContent === 'function');
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/content.js
git commit -m "feat(content): add content service for encrypted upload flow"
```

---

### Task 5: Create Content Upload Modal UI

**Files:**
- Create: `witness-pwa/src/ui/uploadModal.js`

**Step 1: Write the upload modal**

```javascript
/**
 * Content Upload Modal for Witness Protocol
 * Test UI for uploading encrypted content to IPFS
 */

import { getAuthState } from '../lib/authState.js';
import { getMyGroups } from '../lib/groups.js';
import { uploadContent } from '../lib/content.js';
import { isConfigured } from '../lib/ipfs.js';

let modal = null;
let selectedGroups = new Set();

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'upload-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content upload-modal">
      <div class="modal-header">
        <h2>Upload Content</h2>
        <button class="modal-close" id="upload-close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Configuration Check -->
        <div id="upload-config-check" class="upload-section"></div>

        <!-- Content Input -->
        <div id="upload-input-section" class="upload-section">
          <label for="upload-text" class="upload-label">Test Content</label>
          <textarea
            id="upload-text"
            class="upload-textarea"
            placeholder="Enter text content to upload (for testing)"
            rows="4"
          ></textarea>
        </div>

        <!-- Group Selection -->
        <div id="upload-groups-section" class="upload-section">
          <label class="upload-label">Share with Groups</label>
          <div id="upload-groups-list" class="upload-groups-list"></div>
        </div>

        <!-- Upload Button -->
        <button id="upload-btn" class="btn btn-primary btn-full" disabled>
          Upload & Commit
        </button>

        <!-- Progress -->
        <div id="upload-progress" class="upload-progress hidden">
          <div class="progress-bar">
            <div id="progress-fill" class="progress-fill"></div>
          </div>
          <p id="progress-message" class="progress-message">Preparing...</p>
        </div>

        <!-- Result -->
        <div id="upload-result" class="upload-result hidden"></div>

        <!-- Error -->
        <p id="upload-error" class="error-text hidden"></p>
      </div>
    </div>
  `;
  return div;
}

/**
 * Check IPFS configuration
 */
function checkConfiguration() {
  const configEl = document.getElementById('upload-config-check');

  if (!isConfigured()) {
    configEl.innerHTML = `
      <div class="config-warning">
        <span class="warning-icon">⚠️</span>
        <p>IPFS not configured. Add VITE_PINATA_JWT and VITE_PINATA_GATEWAY to your .env file.</p>
      </div>
    `;
    return false;
  }

  configEl.innerHTML = '';
  return true;
}

/**
 * Load available groups
 */
async function loadGroups() {
  const listEl = document.getElementById('upload-groups-list');
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    listEl.innerHTML = '<p class="muted">Login to see groups</p>';
    return;
  }

  try {
    const groups = await getMyGroups();

    if (groups.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p class="muted">No groups yet</p>
          <p class="muted-small">Create a group first in "My Groups"</p>
        </div>
      `;
      return;
    }

    selectedGroups.clear();

    listEl.innerHTML = groups.map(g => `
      <label class="group-checkbox">
        <input type="checkbox" value="${g.groupId}" class="group-check-input" />
        <span class="group-check-label">${escapeHtml(g.name)}</span>
        <span class="group-check-meta">${g.isCreator ? 'Creator' : 'Member'}</span>
      </label>
    `).join('');

    // Add checkbox listeners
    listEl.querySelectorAll('.group-check-input').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedGroups.add(checkbox.value);
        } else {
          selectedGroups.delete(checkbox.value);
        }
        updateUploadButton();
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

/**
 * Update upload button state
 */
function updateUploadButton() {
  const btn = document.getElementById('upload-btn');
  const text = document.getElementById('upload-text').value.trim();
  const hasGroups = selectedGroups.size > 0;
  const configured = isConfigured();

  btn.disabled = !text || !hasGroups || !configured;
}

/**
 * Handle upload
 */
async function handleUpload() {
  const textEl = document.getElementById('upload-text');
  const btn = document.getElementById('upload-btn');
  const progressEl = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressMsg = document.getElementById('progress-message');
  const resultEl = document.getElementById('upload-result');
  const errorEl = document.getElementById('upload-error');

  const text = textEl.value.trim();

  if (!text || selectedGroups.size === 0) return;

  // Reset state
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  errorEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '0%';

  try {
    const contentData = new TextEncoder().encode(text);
    const groupIds = Array.from(selectedGroups);

    const result = await uploadContent(
      contentData,
      groupIds,
      { title: 'Test Upload' },
      (progress) => {
        progressFill.style.width = `${progress.progress}%`;
        progressMsg.textContent = progress.message;
      }
    );

    // Show result
    resultEl.innerHTML = `
      <div class="result-success">
        <div class="result-icon">✅</div>
        <h3>Upload Complete!</h3>
        <div class="result-details">
          <div class="result-row">
            <span class="result-label">Content ID:</span>
            <code class="result-value">${result.contentId.slice(0, 18)}...</code>
          </div>
          <div class="result-row">
            <span class="result-label">IPFS CID:</span>
            <code class="result-value">${result.manifestCID.slice(0, 20)}...</code>
          </div>
          <div class="result-row">
            <span class="result-label">Transaction:</span>
            <a href="https://sepolia.basescan.org/tx/${result.txHash}" target="_blank" class="result-link">
              ${result.txHash.slice(0, 18)}... 🔗
            </a>
          </div>
        </div>
      </div>
    `;
    resultEl.classList.remove('hidden');
    progressEl.classList.add('hidden');

    // Clear form
    textEl.value = '';
    selectedGroups.clear();
    document.querySelectorAll('.group-check-input').forEach(cb => cb.checked = false);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    progressEl.classList.add('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload & Commit';
    updateUploadButton();
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show the upload modal
 */
export function showUploadModal() {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('upload-close').addEventListener('click', hideUploadModal);
    document.getElementById('upload-btn').addEventListener('click', handleUpload);
    document.getElementById('upload-text').addEventListener('input', updateUploadButton);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideUploadModal();
    });
  }

  // Reset state
  document.getElementById('upload-text').value = '';
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('upload-result').classList.add('hidden');
  document.getElementById('upload-error').classList.add('hidden');
  selectedGroups.clear();

  // Load data
  checkConfiguration();
  loadGroups();
  updateUploadButton();

  modal.classList.remove('hidden');
}

/**
 * Hide the upload modal
 */
export function hideUploadModal() {
  if (modal) {
    modal.classList.add('hidden');
  }
}
```

**Step 2: Verify modal creates**

In browser console:
```javascript
import { showUploadModal } from './src/ui/uploadModal.js';
showUploadModal();
```

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/uploadModal.js
git commit -m "feat(ui): add content upload modal for test uploads"
```

---

### Task 6: Add CSS Styles for Upload UI

**Files:**
- Modify: `witness-pwa/styles.css`

**Step 1: Add upload modal styles**

Append to the end of `witness-pwa/styles.css`:

```css
/* ============================================
   Upload Modal
============================================ */

.upload-modal {
  max-width: 450px;
}

.upload-section {
  margin-bottom: 1.25rem;
}

.upload-label {
  display: block;
  font-weight: 500;
  margin-bottom: 0.5rem;
  color: var(--text-light);
}

.upload-textarea {
  width: 100%;
  padding: 0.75rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  color: var(--text-light);
  font-size: 1rem;
  font-family: inherit;
  resize: vertical;
  min-height: 100px;
}

.upload-textarea:focus {
  outline: none;
  border-color: var(--red-accent);
}

.upload-textarea::placeholder {
  color: var(--text-muted);
}

/* Group Selection */
.upload-groups-list {
  max-height: 150px;
  overflow-y: auto;
}

.group-checkbox {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-surface);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition: background 0.2s;
}

.group-checkbox:hover {
  background: var(--bg-surface-hover);
}

.group-check-input {
  width: 18px;
  height: 18px;
  accent-color: var(--red-accent);
}

.group-check-label {
  flex: 1;
  font-weight: 500;
}

.group-check-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
}

/* Progress Bar */
.upload-progress {
  margin-top: 1rem;
}

.progress-bar {
  height: 8px;
  background: var(--bg-surface);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--red-accent);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-message {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-top: 0.5rem;
}

/* Result Display */
.upload-result {
  margin-top: 1rem;
}

.result-success {
  text-align: center;
  padding: 1rem;
  background: var(--bg-surface);
  border-radius: 12px;
}

.result-icon {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.result-success h3 {
  margin: 0 0 1rem 0;
  color: var(--text-light);
}

.result-details {
  text-align: left;
}

.result-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border-color);
}

.result-row:last-child {
  border-bottom: none;
}

.result-label {
  color: var(--text-muted);
  font-size: 0.85rem;
}

.result-value {
  font-family: monospace;
  font-size: 0.85rem;
  background: var(--bg-dark);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.result-link {
  color: var(--red-accent);
  text-decoration: none;
  font-size: 0.85rem;
}

.result-link:hover {
  text-decoration: underline;
}

/* Configuration Warning */
.config-warning {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 1rem;
  background: rgba(234, 179, 8, 0.1);
  border: 1px solid rgba(234, 179, 8, 0.3);
  border-radius: 8px;
  margin-bottom: 1rem;
}

.warning-icon {
  font-size: 1.25rem;
}

.config-warning p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-light);
}
```

**Step 2: Verify styles**

```bash
cd witness-pwa && npm run dev
```

Open browser, show upload modal, verify styling looks correct.

**Step 3: Commit**

```bash
git add witness-pwa/styles.css
git commit -m "style: add upload modal styles"
```

---

### Task 7: Wire Up Upload Button in Drawer

**Files:**
- Modify: `witness-pwa/index.html`
- Modify: `witness-pwa/src/main.js`

**Step 1: Add upload button to drawer**

In `witness-pwa/index.html`, find the drawer-footer section and add an upload button before the groups button:

```html
<div class="drawer-footer">
    <button id="upload-btn-drawer" class="btn btn-link">
        📤 Upload Content
    </button>
    <button id="groups-btn" class="btn btn-link">
        👥 My Groups
    </button>
    <button id="encryption-test-btn" class="btn btn-link">
        🔐 Encryption Test
    </button>
    <button id="logout-btn" class="btn btn-link btn-logout">
        Sign Out
    </button>
</div>
```

**Step 2: Wire up the upload button in main.js**

In `witness-pwa/src/main.js`, add the import at the top with other imports:

```javascript
import { showUploadModal } from './ui/uploadModal.js';
```

Then add the event listener after the groups button handler:

```javascript
// Upload button handler
const uploadBtnDrawer = document.getElementById('upload-btn-drawer');
if (uploadBtnDrawer) {
  uploadBtnDrawer.addEventListener('click', () => {
    closeDrawer();
    showUploadModal();
  });
}
```

**Step 3: Verify integration**

1. Run `npm run dev`
2. Login with Privy
3. Open the drawer
4. Tap "📤 Upload Content"
5. Verify upload modal opens

**Step 4: Commit**

```bash
git add witness-pwa/index.html witness-pwa/src/main.js
git commit -m "feat: wire up upload button in drawer"
```

---

### Task 8: Integration Test - Full Flow

**Files:** None (manual testing)

**Prerequisites:**
- Pinata account with API key configured in `.env`
- At least one group created (from Phase 4)

**Step 1: Configure Pinata**

1. Go to https://app.pinata.cloud
2. Create an API key with pinning permissions
3. Copy your gateway domain
4. Add to `.env`:
   ```
   VITE_PINATA_JWT=your-jwt-token
   VITE_PINATA_GATEWAY=your-gateway.mypinata.cloud
   ```

**Step 2: Test upload flow**

1. Clear browser data
2. Run `npm run dev`
3. Login with email
4. Create a group (if none exist)
5. Open drawer → "📤 Upload Content"
6. Enter test text: "Hello, this is a test upload!"
7. Select the group checkbox
8. Tap "Upload & Commit"
9. Watch progress bar fill
10. Verify success result appears with:
    - Content ID
    - IPFS CID
    - Transaction link

**Step 3: Verify on-chain**

1. Click the transaction link
2. Verify transaction succeeded on Basescan
3. Check contract call data shows `commitContent`

**Step 4: Verify on IPFS**

1. In browser console:
   ```javascript
   import { downloadContent } from './src/lib/ipfs.js';
   // Use the manifestCID from the result
   const manifest = await downloadContent('YOUR_MANIFEST_CID');
   console.log('Manifest:', manifest);
   ```
2. Verify manifest contains:
   - contentId
   - chunks array with CID
   - accessList with wrapped keys
   - merkleRoot

**Step 5: Document any issues found**

If issues found, create tasks to fix them before proceeding.

---

### Task 9: Build and Deploy

**Files:** None (commands only)

**Step 1: Build for production**

```bash
cd witness-pwa && npm run build
```

Verify no build errors.

**Step 2: Test production build locally**

```bash
npm run preview
```

Open http://localhost:4173, verify upload functionality works.

**Step 3: Deploy to production**

```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

**Step 4: Verify production deployment**

1. Open https://witness.squirrlabs.xyz
2. Login
3. Create a group (if none)
4. Upload test content
5. Verify success

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: phase 5 complete - content upload to IPFS with on-chain commit"
```

---

## Acceptance Criteria Checklist

- [ ] Can encrypt test data for selected groups
- [ ] Encrypted data uploads to Pinata IPFS
- [ ] Manifest with wrapped keys uploads to Pinata
- [ ] Merkle root computes correctly from chunk hashes
- [ ] Content commits on-chain (gasless via paymaster)
- [ ] Content indexed under selected groups
- [ ] Transaction visible on Basescan
- [ ] Production deployment verified

---

## Notes

**Existing Implementation Leveraged:**
- `contract.js` already had `commitContent()` function
- `encryption.js` already had `generateContentKey()`, `encrypt()`, `wrapContentKey()`
- `storage.js` already had group secret retrieval
- `groups.js` already had `getMyGroups()`

**What This Phase Added:**
- IPFS service (Pinata SDK wrapper)
- Merkle tree utility
- Content service (orchestrates full upload flow)
- Upload modal UI
- CSS styles for upload UI
- Drawer integration

**Chunked Upload (Deferred):**
The current implementation uploads content as a single chunk. For large videos:
- Content would be split into ~1MB chunks
- Each chunk encrypted and uploaded separately
- Merkle tree built from all chunk hashes
- This is Phase 8 (video integration)

**Content Discovery (Next Phase):**
Phase 6 will add:
- Listing content from on-chain indexes
- Downloading and decrypting content
- Manifest parsing and key unwrapping
- Content detail view

**Security Considerations:**
- Content key is randomly generated per upload
- Key wrapped separately for each group using their secret
- Plaintext hash stored for integrity verification
- Merkle root committed on-chain for tamper detection
