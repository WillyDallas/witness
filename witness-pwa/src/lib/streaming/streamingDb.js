/**
 * Streaming Database Schema
 * IndexedDB persistence for upload queue and chunk state
 */
import Dexie from 'dexie';

const db = new Dexie('WitnessStreaming');

// Schema version 1
db.version(1).stores({
  // Pending uploads with retry tracking
  // Indexed by sessionId for bulk operations, status for queue processing
  pendingUploads: '++id, sessionId, chunkIndex, status, retryCount',

  // Session state for crash recovery
  // Primary key is sessionId
  sessions: 'sessionId, status, createdAt',
});

/**
 * @typedef {'pending'|'uploading'|'uploaded'|'manifesting'|'anchoring'|'confirmed'|'failed'} ChunkStatus
 */

/**
 * @typedef {Object} PendingUpload
 * @property {number} [id] - Auto-incremented ID
 * @property {string} sessionId - Recording session ID
 * @property {number} chunkIndex - Chunk index in session
 * @property {ChunkStatus} status - Current processing status
 * @property {Blob} [rawBlob] - Raw video blob (cleared after encryption)
 * @property {Uint8Array} [encryptedData] - Encrypted chunk data
 * @property {string} [plaintextHash] - SHA-256 of raw chunk
 * @property {string} [encryptedHash] - SHA-256 of encrypted chunk
 * @property {string} [iv] - Base64 IV for decryption
 * @property {string} [cid] - IPFS CID after upload
 * @property {number} capturedAt - Unix timestamp (ms)
 * @property {number} [uploadedAt] - Unix timestamp (ms)
 * @property {number} retryCount - Number of retry attempts
 * @property {string} [lastError] - Last error message
 */

/**
 * @typedef {Object} SessionRecord
 * @property {string} sessionId - Recording session ID
 * @property {'recording'|'uploading'|'complete'|'interrupted'} status
 * @property {string} sessionKeyHex - Session key as hex (for crash recovery)
 * @property {string[]} groupIds - Groups this session is shared with
 * @property {number} createdAt - Unix timestamp (ms)
 * @property {number} [completedAt] - Unix timestamp (ms)
 * @property {number} chunkCount - Total chunks captured
 * @property {string} [latestManifestCid] - Latest manifest CID
 * @property {string} [latestMerkleRoot] - Latest merkle root hex
 */

export { db };
export default db;
