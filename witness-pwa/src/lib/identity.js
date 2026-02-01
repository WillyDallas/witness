/**
 * Semaphore Identity Service for Witness Protocol
 * Creates deterministic ZK identities from wallet signatures
 */

import { Identity } from '@semaphore-protocol/identity';
import { setSecureItem, getSecureItem } from './storage.js';

// Storage key for Semaphore identity
const IDENTITY_STORAGE_KEY = 'witness_semaphore_identity';

// EIP-712 domain for identity derivation signature
const IDENTITY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 84532, // Base Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

const IDENTITY_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  SemaphoreIdentityRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'identityVersion', type: 'uint256' },
  ],
};

/**
 * Request EIP-712 signature for identity derivation
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<string>} Signature hex string
 */
async function requestIdentitySignature(provider, walletAddress) {
  const typedData = {
    domain: IDENTITY_DOMAIN,
    types: IDENTITY_TYPES,
    primaryType: 'SemaphoreIdentityRequest',
    message: {
      purpose: 'Create anonymous attestation identity',
      application: 'witness-protocol',
      identityVersion: 1,
    },
  };

  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [walletAddress, JSON.stringify(typedData)],
  });

  return signature;
}

/**
 * Derive Semaphore identity from wallet signature
 * Deterministic: same wallet = same identity (recoverable)
 * @param {string} signature - Wallet signature
 * @returns {Identity} Semaphore Identity instance
 */
function deriveIdentityFromSignature(signature) {
  // Use signature as seed for deterministic identity
  // Identity constructor accepts string seed
  const identity = new Identity(signature);
  return identity;
}

/**
 * Get stored identity from encrypted localStorage
 * @param {CryptoKey} encryptionKey - User's encryption key
 * @returns {Promise<Identity|null>} Identity or null if not stored
 */
export async function getStoredIdentity(encryptionKey) {
  try {
    const stored = await getSecureItem(IDENTITY_STORAGE_KEY, encryptionKey);
    if (!stored || !stored.privateKey) {
      return null;
    }

    // Reconstruct identity from stored private key
    const identity = new Identity(stored.privateKey);
    console.log('[identity] Loaded from storage, commitment:', identity.commitment.toString().slice(0, 20) + '...');
    return identity;
  } catch (err) {
    console.error('[identity] Failed to load:', err.message);
    return null;
  }
}

/**
 * Store identity securely
 * @param {Identity} identity - Semaphore identity
 * @param {CryptoKey} encryptionKey - User's encryption key
 */
export async function storeIdentity(identity, encryptionKey) {
  // Store the private key (used to reconstruct identity)
  const stored = {
    privateKey: identity.privateKey.toString(),
    commitment: identity.commitment.toString(),
    createdAt: new Date().toISOString(),
  };

  await setSecureItem(IDENTITY_STORAGE_KEY, stored, encryptionKey);
  console.log('[identity] Stored securely');
}

/**
 * Create or retrieve Semaphore identity
 * If stored identity exists, returns it. Otherwise creates new one.
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @param {CryptoKey} encryptionKey - User's encryption key
 * @returns {Promise<Identity>} Semaphore identity
 */
export async function getOrCreateIdentity(provider, walletAddress, encryptionKey) {
  // Check for existing identity
  const existing = await getStoredIdentity(encryptionKey);
  if (existing) {
    return existing;
  }

  // Create new identity from wallet signature
  console.log('[identity] Creating new Semaphore identity...');
  const signature = await requestIdentitySignature(provider, walletAddress);
  const identity = deriveIdentityFromSignature(signature);

  // Store for future sessions
  await storeIdentity(identity, encryptionKey);

  console.log('[identity] Created, commitment:', identity.commitment.toString().slice(0, 20) + '...');
  return identity;
}

/**
 * Get identity commitment as BigInt
 * This is the public value added to Semaphore groups
 * @param {Identity} identity - Semaphore identity
 * @returns {bigint} Commitment value
 */
export function getCommitment(identity) {
  return identity.commitment;
}

/**
 * Clear stored identity (for logout)
 */
export function clearIdentity() {
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  console.log('[identity] Cleared');
}
