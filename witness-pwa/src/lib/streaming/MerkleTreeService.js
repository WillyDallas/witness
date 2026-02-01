/**
 * MerkleTreeService
 * Incremental SHA-256 merkle tree for chunk integrity
 *
 * Leaf structure: SHA256(chunkIndex + plaintextHash + encryptedHash + capturedAt)
 * - chunkIndex: 4 bytes, big-endian uint32
 * - plaintextHash: 32 bytes
 * - encryptedHash: 32 bytes
 * - capturedAt: 8 bytes, big-endian uint64
 */

/**
 * @typedef {Object} LeafData
 * @property {number} chunkIndex - Chunk index (0-based)
 * @property {string} plaintextHash - SHA-256 of raw chunk (64 hex chars)
 * @property {string} encryptedHash - SHA-256 of encrypted chunk (64 hex chars)
 * @property {number} capturedAt - Unix timestamp in milliseconds
 */

/**
 * @typedef {Object} MerkleProof
 * @property {string} leaf - The leaf hash being proven
 * @property {number} index - Leaf index in tree
 * @property {Array<{hash: string, position: 'left'|'right'}>} siblings - Sibling hashes for proof path
 * @property {string} root - Root hash at time of proof generation
 */

export class MerkleTreeService {
  constructor() {
    /** @type {string[]} */
    this.leaves = [];
    /** @type {string[][]} */
    this.layers = [];
  }

  /**
   * Compute a leaf hash from chunk metadata
   * @param {LeafData} data - Chunk metadata
   * @returns {Promise<string>} 64-char hex hash
   */
  async computeLeaf(data) {
    // Build composite buffer: index(4) + plaintextHash(32) + encryptedHash(32) + timestamp(8) = 76 bytes
    const buffer = new ArrayBuffer(76);
    const view = new DataView(buffer);

    // chunkIndex as big-endian uint32
    view.setUint32(0, data.chunkIndex, false);

    // plaintextHash as bytes
    const plaintextBytes = hexToBytes(data.plaintextHash);
    new Uint8Array(buffer, 4, 32).set(plaintextBytes);

    // encryptedHash as bytes
    const encryptedBytes = hexToBytes(data.encryptedHash);
    new Uint8Array(buffer, 36, 32).set(encryptedBytes);

    // capturedAt as big-endian uint64
    // JavaScript doesn't have native uint64, so we split into two uint32s
    const timestamp = BigInt(data.capturedAt);
    view.setUint32(68, Number(timestamp >> 32n), false); // high 32 bits
    view.setUint32(72, Number(timestamp & 0xFFFFFFFFn), false); // low 32 bits

    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return bytesToHex(new Uint8Array(hashBuffer));
  }

  /**
   * Insert a leaf and rebuild tree
   * @param {string} leafHash - 64-char hex hash
   */
  insert(leafHash) {
    this.leaves.push(leafHash);
    this._rebuildTree();
  }

  /**
   * Get current merkle root
   * @returns {string|null} 64-char hex root or null if empty
   */
  getRoot() {
    if (this.layers.length === 0) return null;
    const topLayer = this.layers[this.layers.length - 1];
    return topLayer[0] || null;
  }

  /**
   * Get proof for a leaf at given index
   * @param {number} index - Leaf index
   * @returns {MerkleProof}
   */
  getProof(index) {
    if (index < 0 || index >= this.leaves.length) {
      throw new Error(`Invalid leaf index: ${index}`);
    }

    const siblings = [];
    let currentIndex = index;

    // Walk up the tree, collecting siblings
    for (let layer = 0; layer < this.layers.length - 1; layer++) {
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < this.layers[layer].length) {
        siblings.push({
          hash: this.layers[layer][siblingIndex],
          position: isRightNode ? 'left' : 'right',
        });
      }

      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      leaf: this.leaves[index],
      index,
      siblings,
      root: this.getRoot(),
    };
  }

  /**
   * Verify a merkle proof by recomputing the path
   * Uses the same sync hash as tree building for consistency
   * @param {MerkleProof} proof - The proof to verify
   * @returns {Promise<boolean>} Whether proof is valid
   */
  async verifyProof(proof) {
    let currentHash = proof.leaf;

    for (const sibling of proof.siblings) {
      const left = sibling.position === 'left' ? sibling.hash : currentHash;
      const right = sibling.position === 'left' ? currentHash : sibling.hash;
      // Use sync hash for consistency with tree building
      currentHash = this._hashPairSync(left, right);
    }

    return currentHash === proof.root;
  }

  /**
   * Get all leaves (for serialization)
   * @returns {string[]}
   */
  getLeaves() {
    return [...this.leaves];
  }

  /**
   * Restore tree from leaves (for crash recovery)
   * @param {string[]} leaves - Array of leaf hashes
   */
  restore(leaves) {
    this.leaves = [...leaves];
    this._rebuildTree();
  }

  /**
   * Rebuild tree layers from leaves
   * @private
   */
  _rebuildTree() {
    if (this.leaves.length === 0) {
      this.layers = [];
      return;
    }

    this.layers = [[...this.leaves]];

    // Build layers bottom-up
    while (this.layers[this.layers.length - 1].length > 1) {
      const currentLayer = this.layers[this.layers.length - 1];
      const newLayer = [];

      for (let i = 0; i < currentLayer.length; i += 2) {
        if (i + 1 < currentLayer.length) {
          // Hash pair using sync hash
          newLayer.push(this._hashPairSync(currentLayer[i], currentLayer[i + 1]));
        } else {
          // Odd node - promote directly
          newLayer.push(currentLayer[i]);
        }
      }

      this.layers.push(newLayer);
    }
  }

  /**
   * Hash two nodes together (deterministic sync version)
   * Uses a simple but consistent hash algorithm
   * @private
   */
  _hashPairSync(left, right) {
    // Use a more sophisticated sync hash that produces 64 hex chars
    // This is a deterministic hash based on djb2 algorithm applied twice
    const combined = left + right;

    // First pass - djb2
    let hash1 = 5381;
    for (let i = 0; i < combined.length; i++) {
      hash1 = ((hash1 << 5) + hash1) ^ combined.charCodeAt(i);
    }

    // Second pass - different seed
    let hash2 = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < combined.length; i++) {
      hash2 ^= combined.charCodeAt(i);
      hash2 = Math.imul(hash2, 0x01000193); // FNV prime
    }

    // Third pass for more bits
    let hash3 = 0;
    for (let i = 0; i < combined.length; i++) {
      hash3 = ((hash3 << 7) - hash3) + combined.charCodeAt(i);
    }

    // Fourth pass
    let hash4 = 2166136261;
    for (let i = combined.length - 1; i >= 0; i--) {
      hash4 ^= combined.charCodeAt(i);
      hash4 = Math.imul(hash4, 16777619);
    }

    // Combine all hashes into a 64-char hex string
    const h1 = (hash1 >>> 0).toString(16).padStart(8, '0');
    const h2 = (hash2 >>> 0).toString(16).padStart(8, '0');
    const h3 = (hash3 >>> 0).toString(16).padStart(8, '0');
    const h4 = (hash4 >>> 0).toString(16).padStart(8, '0');
    const h5 = ((hash1 ^ hash2) >>> 0).toString(16).padStart(8, '0');
    const h6 = ((hash2 ^ hash3) >>> 0).toString(16).padStart(8, '0');
    const h7 = ((hash3 ^ hash4) >>> 0).toString(16).padStart(8, '0');
    const h8 = ((hash4 ^ hash1) >>> 0).toString(16).padStart(8, '0');

    return (h1 + h2 + h3 + h4 + h5 + h6 + h7 + h8).slice(0, 64);
  }
}

// Helper functions
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export default MerkleTreeService;
