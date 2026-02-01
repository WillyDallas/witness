/**
 * Content Decryption Service for Witness Protocol
 * Downloads encrypted content from IPFS and decrypts using group secrets
 */

import { getAuthState } from './authState.js';
import { getGroupSecrets } from './storage.js';
import { downloadEncryptedContent, downloadManifest } from './ipfs.js';
import { unwrapContentKey, decrypt, hexToBytes } from './encryption.js';
import { computeMerkleRoot, hashContent } from './merkle.js';

/**
 * @typedef {Object} DecryptedContent
 * @property {Uint8Array} data - Decrypted content bytes
 * @property {string} contentId - Content ID
 * @property {boolean} verified - Whether Merkle proof verified
 * @property {object} manifest - Full manifest
 */

/**
 * @typedef {Object} DecryptProgress
 * @property {'fetching_manifest'|'fetching_content'|'decrypting'|'verifying'|'done'|'error'} step
 * @property {number} progress - 0-100
 * @property {string} message
 */

/**
 * Download and decrypt content
 * @param {string} contentId - Content ID to decrypt
 * @param {string} manifestCID - IPFS CID of manifest
 * @param {string} onChainMerkleRoot - Merkle root from on-chain (for verification)
 * @param {function(DecryptProgress): void} onProgress - Progress callback
 * @returns {Promise<DecryptedContent>}
 */
export async function downloadAndDecrypt(contentId, manifestCID, onChainMerkleRoot, onProgress = () => {}) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  try {
    // Step 1: Fetch manifest
    onProgress({ step: 'fetching_manifest', progress: 10, message: 'Fetching manifest...' });

    const manifest = await downloadManifest(manifestCID);
    console.log('[decrypt] Manifest loaded:', manifest.contentId?.slice(0, 18));

    // Step 2: Find a group secret we have access to
    onProgress({ step: 'fetching_content', progress: 20, message: 'Finding access key...' });

    const groupSecrets = await getGroupSecrets(encryptionKey);
    const accessList = manifest.accessList || {};

    let contentKey = null;
    let accessGroupId = null;

    for (const groupId of Object.keys(accessList)) {
      const secretData = groupSecrets[groupId];
      if (secretData) {
        try {
          const groupSecret = hexToBytes(secretData.secretHex);
          const wrapped = accessList[groupId];
          const wrapIv = hexToBytes(wrapped.iv);
          const wrappedKeyBytes = hexToBytes(wrapped.wrappedKey);

          contentKey = await unwrapContentKey(wrapIv, wrappedKeyBytes.buffer, groupSecret);
          accessGroupId = groupId;
          console.log('[decrypt] Unwrapped key using group:', groupId.slice(0, 18));
          break;
        } catch (err) {
          console.warn('[decrypt] Failed to unwrap with group:', groupId.slice(0, 18), err.message);
        }
      }
    }

    if (!contentKey) {
      throw new Error('No access: you are not a member of any group this content is shared with');
    }

    // Step 3: Download encrypted chunks
    onProgress({ step: 'fetching_content', progress: 40, message: 'Downloading encrypted content...' });

    const chunks = manifest.chunks || [];
    if (chunks.length === 0) {
      throw new Error('No content chunks in manifest');
    }

    // For now, we support single-chunk content (Phase 5 uploads)
    // Multi-chunk support would iterate and concatenate
    const chunk = chunks[0];
    const encryptedData = await downloadEncryptedContent(chunk.cid);

    console.log('[decrypt] Downloaded encrypted content:', encryptedData.length, 'bytes');

    // Step 4: Verify Merkle root
    onProgress({ step: 'verifying', progress: 60, message: 'Verifying integrity...' });

    const chunkHash = await hashContent(encryptedData);
    const computedRoot = await computeMerkleRoot([chunkHash]);

    // Compare with on-chain root (remove 0x prefix if present)
    const cleanOnChainRoot = onChainMerkleRoot.startsWith('0x')
      ? onChainMerkleRoot.slice(2)
      : onChainMerkleRoot;
    const cleanComputedRoot = computedRoot.startsWith('0x')
      ? computedRoot.slice(2)
      : computedRoot;

    const verified = cleanComputedRoot.toLowerCase() === cleanOnChainRoot.toLowerCase();

    if (!verified) {
      console.warn('[decrypt] Merkle root mismatch!');
      console.warn('[decrypt] On-chain:', cleanOnChainRoot);
      console.warn('[decrypt] Computed:', cleanComputedRoot);
    } else {
      console.log('[decrypt] Merkle root verified');
    }

    // Step 5: Decrypt content
    onProgress({ step: 'decrypting', progress: 80, message: 'Decrypting content...' });

    const encryptionIv = hexToBytes(manifest.encryption.iv);
    const decryptedBuffer = await decrypt(encryptionIv, encryptedData.buffer, contentKey);
    const decryptedData = new Uint8Array(decryptedBuffer);

    console.log('[decrypt] Decrypted:', decryptedData.length, 'bytes');

    // Done!
    onProgress({ step: 'done', progress: 100, message: 'Content ready' });

    return {
      data: decryptedData,
      contentId,
      verified,
      manifest,
    };
  } catch (err) {
    onProgress({ step: 'error', progress: 0, message: err.message });
    throw err;
  }
}

/**
 * Check if user has access to decrypt content
 * @param {object} manifest - Content manifest
 * @returns {Promise<boolean>}
 */
export async function canDecrypt(manifest) {
  const { encryptionKey } = getAuthState();
  if (!encryptionKey) return false;

  const groupSecrets = await getGroupSecrets(encryptionKey);
  const accessList = manifest.accessList || {};

  for (const groupId of Object.keys(accessList)) {
    if (groupSecrets[groupId]) {
      return true;
    }
  }

  return false;
}

/**
 * Convert decrypted bytes to a data URL for display
 * @param {Uint8Array} data - Decrypted content bytes
 * @param {string} mimeType - MIME type (e.g., 'text/plain', 'video/webm')
 * @returns {string} Data URL
 */
export function toDataUrl(data, mimeType = 'application/octet-stream') {
  const blob = new Blob([data], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Try to determine content type from manifest or data
 * @param {object} manifest - Content manifest
 * @param {Uint8Array} data - Decrypted data
 * @returns {string} MIME type
 */
export function detectContentType(manifest, data) {
  // Check manifest metadata
  if (manifest.metadata?.mimeType) {
    return manifest.metadata.mimeType;
  }

  // Try to detect from data
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
    return 'image/png';
  }

  // JPEG signature: FF D8 FF
  if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
    return 'image/jpeg';
  }

  // WebM signature: 1A 45 DF A3
  if (data[0] === 0x1A && data[1] === 0x45 && data[2] === 0xDF && data[3] === 0xA3) {
    return 'video/webm';
  }

  // MP4/MOV: starts with ftyp
  if (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70) {
    return 'video/mp4';
  }

  // Default to text for test content
  try {
    new TextDecoder().decode(data.slice(0, 100));
    return 'text/plain';
  } catch {
    return 'application/octet-stream';
  }
}
