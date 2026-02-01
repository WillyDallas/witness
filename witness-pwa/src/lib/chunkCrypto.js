/**
 * Chunk-level cryptographic operations for Witness Protocol
 * Handles HKDF-based per-chunk key derivation and decryption
 */

import { hexToBytes } from './encryption.js';

/**
 * Derive a per-chunk AES-256-GCM key from session key using HKDF
 *
 * @param {CryptoKey} sessionKey - The unwrapped session key (must be extractable for HKDF)
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
 * @param {string} ivString - The IV as base64 or hex string (from manifest)
 * @returns {Promise<ArrayBuffer>} Decrypted chunk data
 */
export async function decryptChunk(encryptedData, chunkKey, ivString) {
  // Detect if IV is base64 or hex based on format
  // Base64 for 12 bytes is 16 chars, hex for 12 bytes is 24 chars
  // Also base64 may contain +, /, = which aren't valid hex
  let iv;
  if (ivString.length === 16 || /[+/=]/.test(ivString) || !/^[0-9a-fA-F]+$/.test(ivString)) {
    // Base64 format (from ChunkProcessor)
    iv = base64ToBytes(ivString);
  } else {
    // Hex format (legacy)
    iv = hexToBytes(ivString);
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    chunkKey,
    encryptedData
  );

  return decrypted;
}

/**
 * Convert base64 string to Uint8Array
 */
function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
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
