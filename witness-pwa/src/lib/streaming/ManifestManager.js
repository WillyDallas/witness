/**
 * ManifestManager
 * Builds and uploads incremental VideoManifest to IPFS
 */
import { uploadManifest } from '../ipfs.js';

/**
 * @typedef {Object} ChunkMetadata
 * @property {number} index - Chunk index (0, 1, 2, ...)
 * @property {string} cid - IPFS CID of encrypted chunk
 * @property {number} size - Encrypted size in bytes
 * @property {number} duration - Video duration in ms
 * @property {string} plaintextHash - SHA256 of raw chunk (hex)
 * @property {string} encryptedHash - SHA256 of encrypted chunk (hex)
 * @property {string} iv - Base64 IV for this chunk
 * @property {number} capturedAt - Unix timestamp (ms)
 * @property {number} uploadedAt - Unix timestamp (ms)
 */

/**
 * @typedef {Object} VideoManifest
 * @property {number} version - Manifest format version
 * @property {string} contentId - Unique recording ID (UUID)
 * @property {string} sessionId - On-chain session reference
 * @property {string} uploader - Ethereum address
 * @property {number} captureStarted - Unix timestamp (ms)
 * @property {number} lastUpdated - Unix timestamp (ms)
 * @property {ChunkMetadata[]} chunks - Chunk list
 * @property {string} merkleRoot - Current root (hex)
 * @property {{algorithm: string, keyDerivation: string}} encryption
 * @property {Object<string, {wrappedKey: string, iv: string}>} accessList
 * @property {'recording'|'complete'|'interrupted'} status
 */

/**
 * @typedef {Object} ManifestConfig
 * @property {string} sessionId - Recording session ID (also used as contentId)
 * @property {string} uploader - Uploader's Ethereum address
 * @property {string[]} groupIds - Group IDs for access control
 */

export class ManifestManager {
  /**
   * @param {ManifestConfig} config
   */
  constructor(config) {
    this.sessionId = config.sessionId;
    this.uploader = config.uploader;
    this.groupIds = config.groupIds;

    /** @type {ChunkMetadata[]} */
    this.chunks = [];

    /** @type {string|null} */
    this.merkleRoot = null;

    /** @type {Object<string, {wrappedKey: string, iv: string}>} */
    this.accessList = {};

    /** @type {'recording'|'complete'|'interrupted'} */
    this.status = 'recording';

    /** @type {number} */
    this.captureStarted = Date.now();

    /** @type {string|null} */
    this.latestCid = null;
  }

  /**
   * Add chunk metadata to manifest
   * @param {ChunkMetadata} chunk
   */
  addChunk(chunk) {
    // Ensure chunks are in order
    if (chunk.index !== this.chunks.length) {
      console.warn(`[ManifestManager] Expected chunk ${this.chunks.length}, got ${chunk.index}`);
    }
    this.chunks.push(chunk);
    console.log(`[ManifestManager] Added chunk ${chunk.index}, total: ${this.chunks.length}`);
  }

  /**
   * Set current merkle root
   * @param {string} root - 64-char hex root
   */
  setMerkleRoot(root) {
    this.merkleRoot = root;
  }

  /**
   * Set access list (wrapped session keys per group)
   * @param {Object<string, {wrappedKey: string, iv: string}>} accessList
   */
  setAccessList(accessList) {
    this.accessList = accessList;
  }

  /**
   * Set manifest status
   * @param {'recording'|'complete'|'interrupted'} status
   */
  setStatus(status) {
    this.status = status;
  }

  /**
   * Get current chunk count
   * @returns {number}
   */
  getChunkCount() {
    return this.chunks.length;
  }

  /**
   * Get latest uploaded manifest CID
   * @returns {string|null}
   */
  getLatestCid() {
    return this.latestCid;
  }

  /**
   * Build full manifest object
   * @returns {VideoManifest}
   */
  getManifest() {
    return {
      version: 1,
      contentId: this.sessionId,
      sessionId: this.sessionId,
      uploader: this.uploader,
      captureStarted: this.captureStarted,
      lastUpdated: Date.now(),
      chunks: [...this.chunks],
      merkleRoot: this.merkleRoot || '',
      encryption: {
        algorithm: 'aes-256-gcm',
        keyDerivation: 'hkdf-sha256',
      },
      accessList: { ...this.accessList },
      status: this.status,
    };
  }

  /**
   * Upload manifest to IPFS
   * @returns {Promise<{cid: string}>}
   */
  async uploadManifest() {
    const manifest = this.getManifest();
    const result = await uploadManifest(manifest);

    this.latestCid = result.cid;
    console.log(`[ManifestManager] Uploaded manifest v${this.chunks.length}: ${result.cid}`);

    return result;
  }

  /**
   * Serialize manifest to JSON string
   * @returns {string}
   */
  toJSON() {
    return JSON.stringify(this.getManifest(), null, 2);
  }

  /**
   * Restore from serialized manifest
   * @param {string|VideoManifest} data - JSON string or manifest object
   * @returns {ManifestManager}
   */
  static fromJSON(data) {
    const manifest = typeof data === 'string' ? JSON.parse(data) : data;

    const manager = new ManifestManager({
      sessionId: manifest.sessionId,
      uploader: manifest.uploader,
      groupIds: Object.keys(manifest.accessList || {}),
    });

    manager.chunks = manifest.chunks || [];
    manager.merkleRoot = manifest.merkleRoot || null;
    manager.accessList = manifest.accessList || {};
    manager.status = manifest.status || 'recording';
    manager.captureStarted = manifest.captureStarted;

    return manager;
  }
}

export default ManifestManager;
