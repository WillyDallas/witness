/**
 * ChunkProcessor
 * Handles single chunk lifecycle: hash → encrypt → upload to IPFS
 *
 * Key derivation: HKDF(sessionKey, "witness-chunk", chunkIndex)
 */
import { uploadEncryptedData } from '../ipfs.js';

/**
 * @typedef {Object} ChunkMetadata
 * @property {string} cid - IPFS CID of encrypted chunk
 * @property {string} plaintextHash - SHA-256 of raw chunk (hex)
 * @property {string} encryptedHash - SHA-256 of encrypted chunk (hex)
 * @property {string} iv - Base64-encoded IV for decryption
 * @property {number} size - Size of encrypted chunk in bytes
 * @property {number} capturedAt - Unix timestamp (ms) when captured
 * @property {number} chunkIndex - Index of this chunk in session
 */

/**
 * @typedef {Object} EncryptionResult
 * @property {Uint8Array} encryptedData - Encrypted chunk bytes
 * @property {string} iv - Base64-encoded IV
 * @property {string} plaintextHash - SHA-256 of raw chunk (hex)
 * @property {string} encryptedHash - SHA-256 of encrypted chunk (hex)
 */

export class ChunkProcessor {
  /**
   * @param {CryptoKey} sessionKey - Session encryption key (extractable)
   */
  constructor(sessionKey) {
    this.sessionKey = sessionKey;
    this._sessionKeyBytes = null; // Cached for HKDF
  }

  /**
   * Hash a blob using SHA-256
   * @param {Blob} blob - Blob to hash
   * @returns {Promise<string>} 64-char hex hash
   */
  async hashBlob(blob) {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  /**
   * Hash a Uint8Array using SHA-256
   * @param {Uint8Array} data - Data to hash
   * @returns {Promise<string>} 64-char hex hash
   */
  async hashBytes(data) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  /**
   * Derive chunk-specific key from session key
   * Uses HKDF: sessionKey + salt + chunkIndex → chunkKey
   * @param {number} chunkIndex - Chunk index
   * @returns {Promise<CryptoKey>} Chunk-specific AES-GCM key
   */
  async deriveChunkKey(chunkIndex) {
    // Get raw session key bytes (cache for performance)
    if (!this._sessionKeyBytes) {
      const exported = await crypto.subtle.exportKey('raw', this.sessionKey);
      this._sessionKeyBytes = new Uint8Array(exported);
    }

    // Import session key as HKDF key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      this._sessionKeyBytes,
      'HKDF',
      false,
      ['deriveKey']
    );

    // Derive chunk-specific key
    // info = chunkIndex as 4-byte big-endian
    const info = new ArrayBuffer(4);
    new DataView(info).setUint32(0, chunkIndex, false);

    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: new TextEncoder().encode('witness-chunk'),
        info: new Uint8Array(info),
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      true, // Extractable for round-trip testing
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a chunk blob
   * @param {Blob} blob - Raw video chunk
   * @param {number} chunkIndex - Chunk index for key derivation
   * @returns {Promise<EncryptionResult>}
   */
  async encryptChunk(blob, chunkIndex) {
    // Hash plaintext first
    const plaintextHash = await this.hashBlob(blob);

    // Derive chunk-specific key
    const chunkKey = await this.deriveChunkKey(chunkIndex);

    // Generate fresh IV (12 bytes for AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const plaintext = await blob.arrayBuffer();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      chunkKey,
      plaintext
    );

    const encryptedData = new Uint8Array(ciphertext);

    // Hash ciphertext
    const encryptedHash = await this.hashBytes(encryptedData);

    return {
      encryptedData,
      iv: bytesToBase64(iv),
      plaintextHash,
      encryptedHash,
    };
  }

  /**
   * Decrypt a chunk (for verification/playback)
   * @param {Uint8Array} encryptedData - Encrypted chunk bytes
   * @param {string} ivBase64 - Base64-encoded IV
   * @param {number} chunkIndex - Chunk index for key derivation
   * @returns {Promise<ArrayBuffer>} Decrypted chunk data
   */
  async decryptChunk(encryptedData, ivBase64, chunkIndex) {
    const chunkKey = await this.deriveChunkKey(chunkIndex);
    const iv = base64ToBytes(ivBase64);

    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      chunkKey,
      encryptedData
    );
  }

  /**
   * Process full chunk pipeline: hash → encrypt → upload
   * @param {Blob} blob - Raw video chunk
   * @param {number} chunkIndex - Chunk index
   * @param {number} capturedAt - Capture timestamp (ms)
   * @returns {Promise<ChunkMetadata>}
   */
  async processChunk(blob, chunkIndex, capturedAt) {
    // Encrypt (includes hashing)
    const encrypted = await this.encryptChunk(blob, chunkIndex);

    // Upload to IPFS
    const filename = `chunk-${chunkIndex}.enc`;
    const { cid, size } = await uploadEncryptedData(encrypted.encryptedData, filename);

    return {
      cid,
      plaintextHash: encrypted.plaintextHash,
      encryptedHash: encrypted.encryptedHash,
      iv: encrypted.iv,
      size,
      capturedAt,
      chunkIndex,
    };
  }
}

// Helper functions
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default ChunkProcessor;
