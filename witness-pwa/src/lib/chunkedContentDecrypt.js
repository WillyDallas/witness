/**
 * Chunked Content Decryption Service for Witness Protocol
 * Downloads and decrypts multi-chunk streaming recordings
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

const MAX_RETRIES = 3;

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

    // DIAGNOSTIC: Always log merkle roots for debugging
    console.log('[chunkedDecrypt] DIAGNOSTIC - On-chain merkle root:', onChainMerkleRoot);
    console.log('[chunkedDecrypt] DIAGNOSTIC - Manifest merkle root:', manifest.merkleRoot);

    const merkleRootVerified = cleanManifestRoot.toLowerCase() === cleanOnChainRoot.toLowerCase();
    console.log('[chunkedDecrypt] DIAGNOSTIC - Merkle roots match:', merkleRootVerified);

    if (!merkleRootVerified) {
      console.warn('[chunkedDecrypt] Merkle root mismatch!');
      console.warn('[chunkedDecrypt] On-chain (cleaned):', cleanOnChainRoot);
      console.warn('[chunkedDecrypt] Manifest (cleaned):', cleanManifestRoot);
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

    // DIAGNOSTIC: Log what we have vs what we need
    console.log('[chunkedDecrypt] DIAGNOSTIC - accessList groupIds:', Object.keys(accessList));
    console.log('[chunkedDecrypt] DIAGNOSTIC - groupSecrets groupIds:', Object.keys(groupSecrets));
    for (const groupId of Object.keys(accessList)) {
      console.log('[chunkedDecrypt] DIAGNOSTIC - checking groupId:', groupId);
      console.log('[chunkedDecrypt] DIAGNOSTIC - has secret?:', !!groupSecrets[groupId]);
      if (groupSecrets[groupId]) {
        console.log('[chunkedDecrypt] DIAGNOSTIC - secret groupId stored as:', groupSecrets[groupId].groupId);
      }
    }

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
        progress: 15 + Math.floor(((i + 0.5) / chunks.length) * 70),
        message: `Decrypting chunk ${i + 1} of ${chunks.length}...`,
        currentChunk: i,
        totalChunks: chunks.length,
        verifications
      });

      console.log(`[chunkedDecrypt] DIAGNOSTIC - Decrypting chunk ${i}, index=${chunk.index}, iv=${chunk.iv?.slice(0, 20)}...`);
      const chunkKey = await deriveChunkKey(sessionKey, chunk.index);
      console.log(`[chunkedDecrypt] DIAGNOSTIC - Derived chunk key for chunk ${i}`);
      const decryptedData = await decryptChunk(encryptedData.buffer, chunkKey, chunk.iv);
      console.log(`[chunkedDecrypt] DIAGNOSTIC - Decrypted chunk ${i}: ${decryptedData?.byteLength} bytes`);

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
