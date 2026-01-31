/**
 * Privy authentication module for Witness Protocol
 * Handles email login, embedded wallet creation, and session management
 */
import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getEntropyDetailsFromUser,
} from '@privy-io/js-sdk-core';
import { sepolia } from 'viem/chains';

// Singleton Privy instance
let privyInstance = null;
let privyIframe = null;

/**
 * Initialize Privy SDK with iframe for embedded wallet secure context
 * @returns {Privy} Configured Privy instance
 */
export function initPrivy() {
  if (privyInstance) return privyInstance;

  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const clientId = import.meta.env.VITE_PRIVY_CLIENT_ID;

  if (!appId || !clientId) {
    throw new Error('Missing Privy credentials. Check VITE_PRIVY_APP_ID and VITE_PRIVY_CLIENT_ID in .env');
  }

  privyInstance = new Privy({
    appId,
    clientId,
    supportedChains: [sepolia],
    storage: new LocalStorage(),
  });

  // Create hidden iframe for embedded wallet secure context
  privyIframe = document.createElement('iframe');
  privyIframe.src = privyInstance.embeddedWallet.getURL();
  privyIframe.style.display = 'none';
  privyIframe.id = 'privy-iframe';
  document.body.appendChild(privyIframe);

  // Set up message passing between app and Privy iframe
  privyInstance.setMessagePoster(privyIframe.contentWindow);
  window.addEventListener('message', (event) => {
    privyInstance.embeddedWallet.onMessage(event.data);
  });

  return privyInstance;
}

/**
 * Get the current Privy instance
 * @returns {Privy|null}
 */
export function getPrivy() {
  return privyInstance;
}

/**
 * Check if user has an active session
 * @returns {Promise<{authenticated: boolean, user: object|null}>}
 */
export async function checkSession() {
  const privy = getPrivy();
  if (!privy) {
    return { authenticated: false, user: null };
  }

  try {
    const user = await privy.getUser();
    return { authenticated: !!user, user };
  } catch {
    return { authenticated: false, user: null };
  }
}

/**
 * Send email verification code
 * @param {string} email - User's email address
 * @returns {Promise<void>}
 */
export async function sendEmailCode(email) {
  const privy = getPrivy();
  if (!privy) throw new Error('Privy not initialized');

  await privy.auth.email.sendCode(email);
}

/**
 * Complete email login with verification code
 * @param {string} email - User's email address
 * @param {string} code - 6-digit verification code
 * @returns {Promise<{user: object, isNewUser: boolean}>}
 */
export async function loginWithEmailCode(email, code) {
  const privy = getPrivy();
  if (!privy) throw new Error('Privy not initialized');

  const result = await privy.auth.email.loginWithCode(email, code);
  return { user: result.user, isNewUser: result.is_new_user };
}

/**
 * Get or create embedded Ethereum wallet for user
 * @param {object} user - Privy user object
 * @returns {Promise<{wallet: object, provider: object}>}
 */
export async function getOrCreateWallet(user) {
  const privy = getPrivy();
  if (!privy) throw new Error('Privy not initialized');

  // Check for existing embedded wallet
  let wallet = getUserEmbeddedEthereumWallet(user);

  // Create if doesn't exist
  if (!wallet) {
    await privy.embeddedWallet.create({});
    // Refresh user to get wallet
    const updatedUser = await privy.getUser();
    wallet = getUserEmbeddedEthereumWallet(updatedUser);
  }

  if (!wallet) {
    throw new Error('Failed to create embedded wallet');
  }

  // Get provider for signing
  const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(user);
  const provider = await privy.embeddedWallet.getEthereumProvider({
    wallet,
    entropyId,
    entropyIdVerifier,
  });

  return { wallet, provider };
}

/**
 * Logout and clear session
 * @returns {Promise<void>}
 */
export async function logout() {
  const privy = getPrivy();
  if (privy) {
    await privy.logout();
  }
}

/**
 * Get EOA address from wallet
 * @param {object} wallet - Privy wallet object
 * @returns {string} Wallet address
 */
export function getWalletAddress(wallet) {
  return wallet.address;
}
