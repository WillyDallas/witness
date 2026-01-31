/**
 * Encryption key derivation module for Witness Protocol
 * Derives deterministic AES-256-GCM keys from wallet signatures
 *
 * CRITICAL: Always use the EOA (embedded wallet) for signing, not the smart wallet.
 * Smart wallet signatures are not guaranteed deterministic.
 */

// EIP-712 domain for key derivation signatures
const ENCRYPTION_KEY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 11155111, // Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

// EIP-712 types for key derivation
const ENCRYPTION_KEY_TYPES = {
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

  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [walletAddress, JSON.stringify(typedData)],
  });

  return signature;
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex - Hex string (with or without 0x prefix)
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
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
 * @returns {Promise<CryptoKey>} Non-extractable AES-256-GCM key
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
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt,
      info,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // Non-extractable for security
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
  // Request signature (user sees EIP-712 prompt)
  const signature = await requestKeyDerivationSignature(provider, walletAddress);

  // Derive key from signature
  const key = await deriveKeyFromSignature(signature, walletAddress);

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
