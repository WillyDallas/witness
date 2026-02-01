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
