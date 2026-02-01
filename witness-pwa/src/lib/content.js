/**
 * Content Service for Witness Protocol
 * Orchestrates content encryption, upload, and on-chain commitment
 */

import { getAuthState } from './authState.js';
import { generateContentKey, encrypt, wrapContentKey, bytesToHex, hexToBytes } from './encryption.js';
import { getGroupSecrets } from './storage.js';
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
