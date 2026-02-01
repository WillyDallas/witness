/**
 * Storage Service for Witness Protocol
 * Provides encrypted storage for sensitive data using the personal encryption key
 */

import { encrypt, decrypt, hexToBytes, bytesToHex } from './encryption.js';

// Storage keys
const STORAGE_KEYS = {
  GROUP_SECRETS: 'witness_group_secrets',
  RECORDINGS_META: 'witness_recordings',
  LOCAL_ATTESTATIONS: 'witness_local_attestations',
  SEMAPHORE_IDENTITY: 'witness_semaphore_identity',
};

// ============================================
// Base Storage (unencrypted, for non-sensitive data)
// ============================================

/**
 * Get item from localStorage
 * @param {string} key - Storage key
 * @returns {any|null} Parsed value or null
 */
export function getItem(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Set item in localStorage
 * @param {string} key - Storage key
 * @param {any} value - Value to store (will be JSON stringified)
 */
export function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 */
export function removeItem(key) {
  localStorage.removeItem(key);
}

// ============================================
// Encrypted Storage (for sensitive data)
// ============================================

/**
 * Encrypt and store sensitive data
 * @param {string} key - Storage key
 * @param {any} value - Value to encrypt and store
 * @param {CryptoKey} encryptionKey - Personal encryption key
 */
export async function setSecureItem(key, value, encryptionKey) {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const { iv, ciphertext } = await encrypt(plaintext, encryptionKey);

  // Store as hex-encoded object
  const stored = {
    iv: bytesToHex(iv),
    data: bytesToHex(new Uint8Array(ciphertext)),
  };

  localStorage.setItem(key, JSON.stringify(stored));
}

/**
 * Decrypt and retrieve sensitive data
 * @param {string} key - Storage key
 * @param {CryptoKey} encryptionKey - Personal encryption key
 * @returns {Promise<any|null>} Decrypted value or null
 */
export async function getSecureItem(key, encryptionKey) {
  try {
    const storedStr = localStorage.getItem(key);
    if (!storedStr) return null;

    const stored = JSON.parse(storedStr);
    const iv = hexToBytes(stored.iv);
    const ciphertext = hexToBytes(stored.data);

    const plaintext = await decrypt(iv, ciphertext.buffer, encryptionKey);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (err) {
    console.error('[storage] Failed to decrypt:', err.message);
    return null;
  }
}

// ============================================
// Group Secrets Storage
// ============================================

/**
 * @typedef {Object} StoredGroupSecret
 * @property {string} groupId - Group ID (bytes32 hex)
 * @property {string} secretHex - Group secret as hex string
 * @property {string} name - Human-readable group name
 * @property {boolean} isCreator - Whether current user created this group
 * @property {string} createdAt - ISO timestamp
 */

/**
 * Get all stored group secrets
 * @param {CryptoKey} encryptionKey - Personal encryption key
 * @returns {Promise<Record<string, StoredGroupSecret>>} Map of groupId to secret data
 */
export async function getGroupSecrets(encryptionKey) {
  const secrets = await getSecureItem(STORAGE_KEYS.GROUP_SECRETS, encryptionKey);
  return secrets || {};
}

/**
 * Store a group secret
 * @param {string} groupId - Group ID
 * @param {Uint8Array} secret - Group secret bytes
 * @param {string} name - Group name
 * @param {boolean} isCreator - Whether user created this group
 * @param {CryptoKey} encryptionKey - Personal encryption key
 */
export async function setGroupSecret(groupId, secret, name, isCreator, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey);

  secrets[groupId] = {
    groupId,
    secretHex: bytesToHex(secret),
    name,
    isCreator,
    createdAt: new Date().toISOString(),
  };

  await setSecureItem(STORAGE_KEYS.GROUP_SECRETS, secrets, encryptionKey);
}

/**
 * Get a specific group secret as Uint8Array
 * @param {string} groupId - Group ID
 * @param {CryptoKey} encryptionKey - Personal encryption key
 * @returns {Promise<Uint8Array|null>} Group secret bytes or null
 */
export async function getGroupSecret(groupId, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey);
  const stored = secrets[groupId];
  if (!stored) return null;

  return hexToBytes(stored.secretHex);
}

/**
 * Remove a group secret
 * @param {string} groupId - Group ID to remove
 * @param {CryptoKey} encryptionKey - Personal encryption key
 */
export async function removeGroupSecret(groupId, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey);
  delete secrets[groupId];
  await setSecureItem(STORAGE_KEYS.GROUP_SECRETS, secrets, encryptionKey);
}

/**
 * Clear all secure storage (for logout)
 */
export function clearSecureStorage() {
  localStorage.removeItem(STORAGE_KEYS.GROUP_SECRETS);
  localStorage.removeItem(STORAGE_KEYS.LOCAL_ATTESTATIONS);
  localStorage.removeItem(STORAGE_KEYS.SEMAPHORE_IDENTITY);
}
