/**
 * Auth State Manager for Witness Protocol
 * Centralized state for authentication, wallet, and encryption key
 */

import { clearCachedSignature } from './encryption.js';
import { clearSecureStorage } from './storage.js';

// Auth state (in-memory, lost on page refresh - session restored via Privy)
const authState = {
  initialized: false,
  authenticated: false,
  user: null,
  wallet: null,           // Privy embedded wallet
  provider: null,         // EOA provider for signing
  kernelAccount: null,    // Kernel smart account
  smartAccountClient: null,
  smartAccountAddress: null,
  encryptionKey: null,    // AES-256-GCM master key
};

// Event listeners for state changes
const listeners = new Set();

/**
 * Subscribe to auth state changes
 * @param {function} callback - Called with new state
 * @returns {function} Unsubscribe function
 */
export function subscribeToAuth(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Notify all listeners of state change
 */
function notifyListeners() {
  const stateCopy = { ...authState };
  listeners.forEach((callback) => callback(stateCopy));
}

/**
 * Update auth state
 * @param {object} updates - Partial state updates
 */
export function updateAuthState(updates) {
  Object.assign(authState, updates);
  notifyListeners();
}

/**
 * Get current auth state (read-only copy)
 * @returns {object}
 */
export function getAuthState() {
  return { ...authState };
}

/**
 * Check if user is fully authenticated with encryption key ready
 * @returns {boolean}
 */
export function isReady() {
  return authState.authenticated && authState.encryptionKey !== null;
}

/**
 * Get encryption key (for recording/playback)
 * @returns {CryptoKey|null}
 */
export function getEncryptionKey() {
  return authState.encryptionKey;
}

/**
 * Get smart account client (for gasless transactions)
 * @returns {object|null}
 */
export function getClient() {
  return authState.smartAccountClient;
}

/**
 * Get smart account address
 * @returns {string|null}
 */
export function getAddress() {
  return authState.smartAccountAddress;
}

/**
 * Get EOA address (embedded wallet)
 * @returns {string|null}
 */
export function getEOAAddress() {
  return authState.wallet?.address || null;
}

/**
 * Clear all auth state (logout)
 */
export function clearAuthState() {
  authState.initialized = true;
  authState.authenticated = false;
  authState.user = null;
  authState.wallet = null;
  authState.provider = null;
  authState.kernelAccount = null;
  authState.smartAccountClient = null;
  authState.smartAccountAddress = null;
  authState.encryptionKey = null;

  // Clear cached signature and secure storage
  clearCachedSignature();
  clearSecureStorage();

  notifyListeners();
}
