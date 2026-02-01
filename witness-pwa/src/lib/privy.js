/**
 * Privy authentication module for Witness Protocol
 * Handles email login, embedded wallet creation, and session management
 */
import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getEntropyDetailsFromUser,
} from '@privy-io/js-sdk-core';
import { baseSepolia } from 'viem/chains';

// Singleton Privy instance
let privyInstance = null;
let privyIframe = null;
let iframeReadyPromise = null;
let iframeReady = false;

// Session storage key for user cache
const USER_CACHE_KEY = 'witness_privy_user';

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
    supportedChains: [baseSepolia],
    storage: new LocalStorage(),
  });

  // Create hidden iframe for embedded wallet secure context
  privyIframe = document.createElement('iframe');
  privyIframe.src = privyInstance.embeddedWallet.getURL();
  privyIframe.style.display = 'none';
  privyIframe.id = 'privy-iframe';

  // Set up message listener BEFORE adding iframe to DOM
  // Per Privy docs: pass ALL messages to onMessage - let SDK handle filtering
  window.addEventListener('message', (event) => {
    // Only process messages after iframe is ready to avoid "proxy not initialized" errors
    if (!iframeReady) return;

    // Pass ALL messages to Privy SDK - it handles its own filtering
    try {
      privyInstance.embeddedWallet.onMessage(event.data);
    } catch (e) {
      // Silently ignore messages not meant for Privy
    }
  });

  // Create promise that resolves when iframe is ready
  iframeReadyPromise = new Promise((resolve) => {
    privyIframe.onload = () => {
      privyInstance.setMessagePoster(privyIframe.contentWindow);
      iframeReady = true;
      console.log('[privy] Initialized');
      resolve();
    };
    privyIframe.onerror = (e) => {
      console.error('[privy] Iframe failed to load:', e);
    };
  });

  document.body.appendChild(privyIframe);

  return privyInstance;
}

/**
 * Wait for Privy iframe to be ready
 * @returns {Promise<void>}
 */
export async function waitForPrivyReady() {
  if (iframeReadyPromise) {
    await iframeReadyPromise;
  }
}

/**
 * Get the current Privy instance
 * @returns {Privy|null}
 */
export function getPrivy() {
  return privyInstance;
}

/**
 * Cache user for session persistence
 * @param {object} user - Privy user object
 */
function cacheUser(user) {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
}

/**
 * Get cached user
 * @returns {object|null}
 */
function getCachedUser() {
  try {
    const data = localStorage.getItem(USER_CACHE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Clear cached user
 */
function clearCachedUser() {
  localStorage.removeItem(USER_CACHE_KEY);
}

/**
 * Check if user has an active session
 * @returns {Promise<{authenticated: boolean, user: object|null}>}
 */
export async function checkSession() {
  const privy = getPrivy();
  if (!privy) {
    console.log('[privy] checkSession: no privy instance');
    return { authenticated: false, user: null };
  }

  // Wait for iframe to be ready before checking session
  await waitForPrivyReady();

  try {
    // Check if we have a valid access token (indicates active session)
    const token = await privy.getAccessToken();
    console.log('[privy] checkSession: token exists:', !!token);
    if (!token) {
      clearCachedUser();
      return { authenticated: false, user: null };
    }
    // Get cached user (js-sdk-core doesn't have getSession)
    const user = getCachedUser();
    console.log('[privy] checkSession: cached user:', user?.id?.slice(0, 10) + '...');
    return { authenticated: !!user, user };
  } catch (error) {
    console.log('[privy] checkSession error:', error.message);
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
  // Cache user for session persistence (js-sdk-core doesn't persist user)
  cacheUser(result.user);
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

  // Wait for iframe to be ready before any wallet operations
  await waitForPrivyReady();

  // Check for existing embedded wallet
  let wallet = getUserEmbeddedEthereumWallet(user);
  let currentUser = user;

  // Create if doesn't exist
  if (!wallet) {
    console.log('[privy] Creating embedded wallet...');
    const result = await privy.embeddedWallet.create({});
    currentUser = result.user;
    wallet = getUserEmbeddedEthereumWallet(currentUser);
    // Update cached user with wallet info
    cacheUser(currentUser);
    console.log('[privy] Wallet created:', wallet?.address);
  }

  if (!wallet) {
    throw new Error('Failed to create embedded wallet');
  }

  // Get provider for signing (use the current user for entropy details)
  const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(currentUser);
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
  const cachedUser = getCachedUser();

  if (privy && cachedUser?.id) {
    try {
      await privy.auth.logout({ userId: cachedUser.id });
    } catch (e) {
      console.warn('[privy] Logout error (continuing anyway):', e.message);
    }
  }
  clearCachedUser();
}

/**
 * Get EOA address from wallet
 * @param {object} wallet - Privy wallet object
 * @returns {string} Wallet address
 */
export function getWalletAddress(wallet) {
  return wallet.address;
}
