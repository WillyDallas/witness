/**
 * SessionManager
 * Orchestrates full streaming recording flow:
 * ChunkProcessor → MerkleTreeService → ManifestManager → Contract
 */
import { ChunkProcessor } from './ChunkProcessor.js';
import { MerkleTreeService } from './MerkleTreeService.js';
import { ManifestManager } from './ManifestManager.js';
import { updateSession, waitForTransaction } from '../contract.js';
import { db } from './streamingDb.js';

/**
 * @typedef {Object} SessionConfig
 * @property {string[]} groupIds - Groups to share recording with
 * @property {string} uploader - Uploader's Ethereum address
 * @property {CryptoKey} sessionKey - Session encryption key
 * @property {Object<string, {wrappedKey: string, iv: string}>} [accessList] - Pre-wrapped keys
 */

/**
 * @typedef {Object} ChunkResult
 * @property {number} chunkIndex - Index of processed chunk
 * @property {string} cid - IPFS CID
 * @property {string} merkleRoot - Updated merkle root
 * @property {string} manifestCid - Updated manifest CID
 * @property {string} [txHash] - On-chain transaction hash
 */

export class SessionManager {
  /**
   * @param {string} sessionId
   * @param {ChunkProcessor} chunkProcessor
   * @param {MerkleTreeService} merkleTree
   * @param {ManifestManager} manifestManager
   * @param {string[]} groupIds
   */
  constructor(sessionId, chunkProcessor, merkleTree, manifestManager, groupIds) {
    this.sessionId = sessionId;
    this.chunkProcessor = chunkProcessor;
    this.merkleTree = merkleTree;
    this.manifestManager = manifestManager;
    this.groupIds = groupIds;

    this._active = true;
    this._chunkIndex = 0;
    this._status = 'recording';
  }

  /**
   * Create a new session
   * @param {SessionConfig} config
   * @returns {Promise<SessionManager>}
   */
  static async create(config) {
    // Generate session ID
    const sessionId = crypto.randomUUID();

    // Initialize services
    const chunkProcessor = new ChunkProcessor(config.sessionKey);
    const merkleTree = new MerkleTreeService();
    const manifestManager = new ManifestManager({
      sessionId,
      uploader: config.uploader,
      groupIds: config.groupIds,
    });

    // Set access list if provided
    if (config.accessList) {
      manifestManager.setAccessList(config.accessList);
    }

    // Persist session state for crash recovery
    await db.sessions.add({
      sessionId,
      status: 'recording',
      groupIds: config.groupIds,
      createdAt: Date.now(),
      chunkCount: 0,
    });

    console.log(`[SessionManager] Created session ${sessionId}`);

    return new SessionManager(
      sessionId,
      chunkProcessor,
      merkleTree,
      manifestManager,
      config.groupIds
    );
  }

  /**
   * Process a single chunk through the full pipeline
   * @param {Blob} blob - Raw video chunk
   * @param {number} [duration=10000] - Chunk duration in ms
   * @param {Object} [metadata] - Optional metadata from CaptureService
   * @param {Object} [metadata.location] - GPS location data
   * @param {number} [metadata.capturedAt] - Timestamp when chunk was captured
   * @returns {Promise<ChunkResult>}
   */
  async processChunk(blob, duration = 10000, metadata = {}) {
    if (!this._active) {
      throw new Error('Session is not active');
    }

    const chunkIndex = this._chunkIndex;
    const capturedAt = metadata.capturedAt || Date.now();

    console.log(`[SessionManager] Processing chunk ${chunkIndex}`);

    // 1. Process chunk (hash → encrypt → upload)
    const chunkMeta = await this.chunkProcessor.processChunk(blob, chunkIndex, capturedAt);

    // 2. Update merkle tree
    const leaf = await this.merkleTree.computeLeaf({
      chunkIndex,
      plaintextHash: chunkMeta.plaintextHash,
      encryptedHash: chunkMeta.encryptedHash,
      capturedAt,
    });
    this.merkleTree.insert(leaf);
    const merkleRoot = this.merkleTree.getRoot();

    // 3. Update manifest
    this.manifestManager.addChunk({
      index: chunkIndex,
      cid: chunkMeta.cid,
      size: chunkMeta.size,
      duration,
      plaintextHash: chunkMeta.plaintextHash,
      encryptedHash: chunkMeta.encryptedHash,
      iv: chunkMeta.iv,
      capturedAt,
      uploadedAt: Date.now(),
      location: metadata.location || null,
    });
    this.manifestManager.setMerkleRoot(merkleRoot);

    // 4. Upload manifest
    const { cid: manifestCid } = await this.manifestManager.uploadManifest();

    // 5. Anchor on-chain
    let txHash = null;
    try {
      // Convert UUID to bytes32 format
      const sessionIdBytes32 = '0x' + this.sessionId.replace(/-/g, '').padEnd(64, '0').slice(0, 64);

      txHash = await updateSession(
        sessionIdBytes32,
        '0x' + merkleRoot,
        manifestCid,
        BigInt(chunkIndex + 1),
        this.groupIds
      );
      await waitForTransaction(txHash);
      console.log(`[SessionManager] Chunk ${chunkIndex} anchored: ${txHash}`);
    } catch (error) {
      console.error(`[SessionManager] On-chain anchor failed:`, error.message);
      // Continue even if on-chain fails - chunks are safe on IPFS
    }

    // Update state
    this._chunkIndex++;
    await db.sessions.update(this.sessionId, {
      chunkCount: this._chunkIndex,
      latestManifestCid: manifestCid,
      latestMerkleRoot: merkleRoot,
    });

    return {
      chunkIndex,
      cid: chunkMeta.cid,
      merkleRoot,
      manifestCid,
      txHash,
    };
  }

  /**
   * End the session
   */
  async endSession() {
    this._active = false;
    this._status = 'complete';
    this.manifestManager.setStatus('complete');

    // Final manifest upload
    await this.manifestManager.uploadManifest();

    // Update session record
    await db.sessions.update(this.sessionId, {
      status: 'complete',
      completedAt: Date.now(),
    });

    console.log(`[SessionManager] Session ${this.sessionId} ended`);
  }

  /**
   * Mark the session as interrupted (capture error, tab close, etc.)
   */
  async markInterrupted() {
    this._status = 'interrupted';
    this.manifestManager.setStatus('interrupted');

    await db.sessions.update(this.sessionId, {
      status: 'interrupted',
      interruptedAt: Date.now(),
    });

    console.log(`[SessionManager] Session ${this.sessionId} marked interrupted`);
  }

  /**
   * Check if session is active
   * @returns {boolean}
   */
  isActive() {
    return this._active;
  }

  /**
   * Get current status
   * @returns {'recording'|'complete'|'interrupted'}
   */
  getStatus() {
    return this._status;
  }

  /**
   * Get current chunk count
   * @returns {number}
   */
  getChunkCount() {
    return this._chunkIndex;
  }

  /**
   * Get current merkle root
   * @returns {string|null}
   */
  getMerkleRoot() {
    return this.merkleTree.getRoot();
  }

  /**
   * Get latest manifest CID
   * @returns {string|null}
   */
  getManifestCid() {
    return this.manifestManager.getLatestCid();
  }
}

/**
 * Create a CaptureService wired to a SessionManager
 * @param {SessionManager} sessionManager - The session to wire to
 * @param {Object} [options] - Additional CaptureService options
 * @returns {Promise<import('../captureService.js').CaptureService>}
 */
export async function createWiredCapture(sessionManager, options = {}) {
  const { CaptureService } = await import('../captureService.js');

  return new CaptureService({
    ...options,
    onChunk: async (blob, index, metadata) => {
      // Use timeslice as duration (default 10000ms)
      const duration = options.timeslice || 10000;
      await sessionManager.processChunk(blob, duration, metadata);
    },
    onError: (err) => {
      console.error('[SessionManager] Capture error:', err);
      sessionManager.markInterrupted();
    }
  });
}

export default SessionManager;
