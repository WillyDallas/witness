/**
 * Encryption key derivation module for Witness Protocol
 * Derives deterministic AES-256-GCM keys from wallet signatures
 *
 * CRITICAL: Always use the EOA (embedded wallet) for signing, not the smart wallet.
 * Smart wallet signatures are not guaranteed deterministic.
 */

// Session storage key for cached signature
const SIGNATURE_CACHE_KEY = 'witness_enc_sig';

// EIP-712 domain for key derivation signatures
const ENCRYPTION_KEY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 84532, // Base Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

// EIP-712 types for key derivation (must include EIP712Domain per spec)
const ENCRYPTION_KEY_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  EncryptionKeyRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'keyVersion', type: 'uint256' },
  ],
};

/**
 * Request EIP-712 signature for key derivation
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<string>} Signature hex string
 */
async function requestKeyDerivationSignature(provider, walletAddress) {
  const typedData = {
    domain: ENCRYPTION_KEY_DOMAIN,
    types: ENCRYPTION_KEY_TYPES,
    primaryType: 'EncryptionKeyRequest',
    message: {
      purpose: 'Derive master encryption key for evidence protection',
      application: 'witness-protocol',
      keyVersion: 1,
    },
  };

  try {
    const signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [walletAddress, JSON.stringify(typedData)],
    });
    return signature;
  } catch (error) {
    console.error('[encryption] Signature request failed:', error.message);
    throw error;
  }
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex - Hex string (with or without 0x prefix)
 * @returns {Uint8Array}
 */
export function hexToBytes(hex) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Normalize signature to low-s form for determinism
 * ECDSA signatures can have two valid s values; we normalize to the lower one.
 * @param {string} sig - Signature hex string
 * @returns {string} Normalized signature
 */
function normalizeSignature(sig) {
  const cleanSig = sig.startsWith('0x') ? sig.slice(2) : sig;
  const secp256k1n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

  const r = cleanSig.slice(0, 64);
  let s = BigInt('0x' + cleanSig.slice(64, 128));
  const v = cleanSig.slice(128);

  // Normalize s to low-s
  if (s > secp256k1n / 2n) {
    s = secp256k1n - s;
  }

  return '0x' + r + s.toString(16).padStart(64, '0') + v;
}

/**
 * Derive AES-256-GCM key from wallet signature using HKDF
 * @param {string} signature - Normalized signature
 * @param {string} walletAddress - EOA address (used in salt)
 * @returns {Promise<CryptoKey>} Extractable AES-256-GCM key (for HKDF chunk derivation)
 */
async function deriveKeyFromSignature(signature, walletAddress) {
  const normalized = normalizeSignature(signature);
  const sigBytes = hexToBytes(normalized.slice(2));

  // Deterministic salt from app context + wallet
  const salt = new TextEncoder().encode(
    `witness-protocol:${walletAddress.toLowerCase()}`
  );
  const info = new TextEncoder().encode('AES-256-GCM-master-key');

  // Import signature as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sigBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Derive AES-256-GCM key
  // Note: Must be extractable so ChunkProcessor can derive per-chunk keys via HKDF
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt,
      info,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // Extractable for HKDF chunk key derivation
    ['encrypt', 'decrypt']
  );

  return aesKey;
}

/**
 * Full key derivation flow: request signature → derive key
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<CryptoKey>} Master encryption key
 */
export async function deriveEncryptionKey(provider, walletAddress) {
  // Request signature (triggers wallet signing prompt)
  const signature = await requestKeyDerivationSignature(provider, walletAddress);

  // Derive key from signature
  const key = await deriveKeyFromSignature(signature, walletAddress);
  console.log('[encryption] Key derived for', walletAddress.slice(0, 10) + '...');

  return key;
}

/**
 * Encrypt data with AES-256-GCM
 * @param {ArrayBuffer} data - Data to encrypt
 * @param {CryptoKey} key - AES-256-GCM key
 * @returns {Promise<{iv: Uint8Array, ciphertext: ArrayBuffer}>}
 */
export async function encrypt(data, key) {
  // Generate fresh random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return { iv, ciphertext };
}

/**
 * Decrypt data with AES-256-GCM
 * @param {Uint8Array} iv - Initialization vector
 * @param {ArrayBuffer} ciphertext - Encrypted data
 * @param {CryptoKey} key - AES-256-GCM key
 * @returns {Promise<ArrayBuffer>} Decrypted data
 */
export async function decrypt(iv, ciphertext, key) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return plaintext;
}

/**
 * Hash data using SHA-256
 * @param {ArrayBuffer|Blob} data - Data to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function sha256(data) {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Group Secret Management
// ============================================

/**
 * Generate a random 32-byte group secret
 * @returns {Uint8Array} Random secret bytes
 */
export function generateGroupSecret() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive group ID from group secret using SHA-256
 * Group ID = first 32 bytes of SHA-256(secret) as hex with 0x prefix
 * @param {Uint8Array} secret - Group secret bytes
 * @returns {Promise<string>} Group ID as bytes32 hex (0x-prefixed)
 */
export async function deriveGroupId(secret) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', secret);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes - Bytes to convert
 * @returns {string} Hex string without 0x prefix
 */
export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ============================================
// Key Wrapping (for multi-group encryption)
// ============================================

/**
 * Derive an AES-256-GCM key from group secret for key wrapping
 * @param {Uint8Array} groupSecret - 32-byte group secret
 * @returns {Promise<CryptoKey>} AES-GCM key for wrapping
 */
async function deriveGroupKey(groupSecret) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    groupSecret,
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new TextEncoder().encode('witness-protocol:group-key'),
      info: new TextEncoder().encode('AES-256-GCM-group-wrapping'),
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Wrap a content key with a group secret
 * Content is encrypted with a random key, then that key is wrapped for each group
 * @param {CryptoKey} contentKey - The key used to encrypt content
 * @param {Uint8Array} groupSecret - Group secret to wrap with
 * @returns {Promise<{iv: Uint8Array, wrappedKey: ArrayBuffer}>}
 */
export async function wrapContentKey(contentKey, groupSecret) {
  const groupKey = await deriveGroupKey(groupSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    contentKey,
    groupKey,
    { name: 'AES-GCM', iv }
  );

  return { iv, wrappedKey };
}

/**
 * Unwrap a content key using a group secret
 * @param {Uint8Array} iv - IV used during wrapping
 * @param {ArrayBuffer} wrappedKey - The wrapped key
 * @param {Uint8Array} groupSecret - Group secret to unwrap with
 * @returns {Promise<CryptoKey>} The unwrapped content key
 */
export async function unwrapContentKey(iv, wrappedKey, groupSecret) {
  const groupKey = await deriveGroupKey(groupSecret);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    groupKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Unwrap a session key for chunk key derivation (extractable)
 * Used for chunked content where we need to derive per-chunk keys via HKDF
 *
 * @param {Uint8Array} iv - IV used during wrapping
 * @param {ArrayBuffer} wrappedKey - The wrapped session key
 * @param {Uint8Array} groupSecret - Group secret to unwrap with
 * @returns {Promise<CryptoKey>} The unwrapped session key (extractable for HKDF)
 */
export async function unwrapSessionKeyForChunks(iv, wrappedKey, groupSecret) {
  const groupKey = await deriveGroupKey(groupSecret);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    groupKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    true, // EXTRACTABLE - needed for HKDF chunk key derivation
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random content key for encrypting media
 * @returns {Promise<CryptoKey>} Extractable AES-256-GCM key
 */
export async function generateContentKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // Extractable so we can wrap it
    ['encrypt', 'decrypt']
  );
}

// ============================================
// Session Persistence (cache normalized signature)
// ============================================

/**
 * Cache the normalized signature for session persistence
 * @param {string} walletAddress - EOA address
 * @param {string} signature - Normalized signature
 */
function cacheSignature(walletAddress, signature) {
  const data = {
    address: walletAddress.toLowerCase(),
    signature: normalizeSignature(signature),
  };
  sessionStorage.setItem(SIGNATURE_CACHE_KEY, JSON.stringify(data));
  console.log('[encryption] Signature cached for session');
}

/**
 * Retrieve cached signature for wallet
 * @param {string} walletAddress - EOA address
 * @returns {string|null} Cached signature or null
 */
function getCachedSignature(walletAddress) {
  try {
    const data = sessionStorage.getItem(SIGNATURE_CACHE_KEY);
    if (!data) return null;

    const parsed = JSON.parse(data);
    if (parsed.address !== walletAddress.toLowerCase()) {
      // Different wallet - clear stale cache
      clearCachedSignature();
      return null;
    }
    return parsed.signature;
  } catch {
    return null;
  }
}

/**
 * Clear cached signature (call on logout)
 */
export function clearCachedSignature() {
  sessionStorage.removeItem(SIGNATURE_CACHE_KEY);
  console.log('[encryption] Signature cache cleared');
}

/**
 * Get or derive encryption key - uses cached signature if available
 * This provides session persistence without re-prompting for signature
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<CryptoKey>} Master encryption key
 */
export async function getOrDeriveEncryptionKey(provider, walletAddress) {
  // Check for cached signature first
  const cachedSig = getCachedSignature(walletAddress);

  if (cachedSig) {
    console.log('[encryption] Using cached signature for key derivation');
    const key = await deriveKeyFromSignature(cachedSig, walletAddress);
    console.log('[encryption] Key restored from cache for', walletAddress.slice(0, 10) + '...');
    return key;
  }

  // No cache - request fresh signature
  const signature = await requestKeyDerivationSignature(provider, walletAddress);
  const normalizedSig = normalizeSignature(signature);

  // Cache for session persistence
  cacheSignature(walletAddress, normalizedSig);

  // Derive key from signature
  const key = await deriveKeyFromSignature(normalizedSig, walletAddress);
  console.log('[encryption] Key derived for', walletAddress.slice(0, 10) + '...');

  return key;
}
