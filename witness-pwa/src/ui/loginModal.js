/**
 * Login Modal Controller
 * Handles UI state and user interactions for authentication flow
 */
import {
  initPrivy,
  checkSession,
  sendEmailCode,
  loginWithEmailCode,
  getOrCreateWallet,
  getWalletAddress,
} from '../lib/privy.js';
import { initializeSmartAccount } from '../lib/smartAccount.js';
import { deriveEncryptionKey } from '../lib/encryption.js';
import { updateAuthState, clearAuthState } from '../lib/authState.js';

// DOM elements (cached on init)
let elements = {};

/**
 * Cache DOM element references
 */
function cacheElements() {
  elements = {
    modal: document.getElementById('login-modal'),
    walletIndicator: document.getElementById('wallet-indicator'),
    walletAddress: document.getElementById('wallet-address'),
    // Steps
    stepEmail: document.getElementById('login-step-email'),
    stepCode: document.getElementById('login-step-code'),
    stepLoading: document.getElementById('login-step-loading'),
    // Inputs
    emailInput: document.getElementById('email-input'),
    codeInput: document.getElementById('code-input'),
    emailDisplay: document.getElementById('email-display'),
    // Buttons
    sendCodeBtn: document.getElementById('send-code-btn'),
    verifyCodeBtn: document.getElementById('verify-code-btn'),
    backToEmailBtn: document.getElementById('back-to-email-btn'),
    // Messages
    loadingMessage: document.getElementById('loading-message'),
    errorMessage: document.getElementById('login-error'),
  };
}

/**
 * Show a specific login step, hide others
 * @param {'email'|'code'|'loading'} step
 */
function showStep(step) {
  elements.stepEmail.classList.toggle('hidden', step !== 'email');
  elements.stepCode.classList.toggle('hidden', step !== 'code');
  elements.stepLoading.classList.toggle('hidden', step !== 'loading');
  elements.errorMessage.classList.add('hidden');
}

/**
 * Show error message
 * @param {string} message
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove('hidden');
}

/**
 * Update loading message
 * @param {string} message
 */
function setLoadingMessage(message) {
  elements.loadingMessage.textContent = message;
}

/**
 * Truncate address for display
 * @param {string} address
 * @returns {string}
 */
function truncateAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Hide modal and show wallet indicator
 * @param {string} address - Smart account address
 */
function showAuthenticated(address) {
  elements.modal.classList.add('hidden');
  elements.walletAddress.textContent = truncateAddress(address);
  elements.walletIndicator.classList.remove('hidden');
}

/**
 * Complete login flow after email verification
 * @param {object} user - Privy user object
 */
async function completeLogin(user) {
  try {
    showStep('loading');

    // Step 1: Get or create embedded wallet
    setLoadingMessage('Creating your wallet...');
    const { wallet, provider } = await getOrCreateWallet(user);
    const eoaAddress = getWalletAddress(wallet);

    // Step 2: Initialize smart account (pass address for owner creation)
    setLoadingMessage('Setting up gasless transactions...');
    const { kernelAccount, client, address } = await initializeSmartAccount(provider, eoaAddress);

    // Step 3: Derive encryption key (user sees signature prompt)
    setLoadingMessage('Securing your encryption keys...');
    const encryptionKey = await deriveEncryptionKey(provider, eoaAddress);

    // Update auth state
    updateAuthState({
      initialized: true,
      authenticated: true,
      user,
      wallet,
      provider,
      kernelAccount,
      smartAccountClient: client,
      smartAccountAddress: address,
      encryptionKey,
    });

    // Show success UI
    showAuthenticated(address);

    return true;
  } catch (error) {
    console.error('Login completion failed:', error);
    showStep('email');
    showError(error.message || 'Failed to complete setup. Please try again.');
    return false;
  }
}

/**
 * Handle "Continue" button click (send verification code)
 */
async function handleSendCode() {
  const email = elements.emailInput.value.trim();

  if (!email || !email.includes('@')) {
    showError('Please enter a valid email address');
    return;
  }

  elements.sendCodeBtn.disabled = true;
  elements.sendCodeBtn.textContent = 'Sending...';

  try {
    await sendEmailCode(email);
    elements.emailDisplay.textContent = email;
    showStep('code');
    elements.codeInput.focus();
  } catch (error) {
    console.error('Send code failed:', error);
    showError(error.message || 'Failed to send code. Please try again.');
  } finally {
    elements.sendCodeBtn.disabled = false;
    elements.sendCodeBtn.textContent = 'Continue';
  }
}

/**
 * Handle "Verify" button click (submit verification code)
 */
async function handleVerifyCode() {
  const email = elements.emailDisplay.textContent;
  const code = elements.codeInput.value.trim();

  if (!code || code.length !== 6) {
    showError('Please enter the 6-digit code');
    return;
  }

  elements.verifyCodeBtn.disabled = true;
  elements.verifyCodeBtn.textContent = 'Verifying...';

  try {
    const { user } = await loginWithEmailCode(email, code);
    await completeLogin(user);
  } catch (error) {
    console.error('Verify code failed:', error);
    showError(error.message || 'Invalid code. Please try again.');
    elements.verifyCodeBtn.disabled = false;
    elements.verifyCodeBtn.textContent = 'Verify';
  }
}

/**
 * Handle "Use a different email" link click
 */
function handleBackToEmail() {
  elements.codeInput.value = '';
  showStep('email');
  elements.emailInput.focus();
}

/**
 * Initialize login modal and check for existing session
 * @returns {Promise<boolean>} True if user is authenticated
 */
export async function initLoginModal() {
  cacheElements();

  // Set up event listeners
  elements.sendCodeBtn.addEventListener('click', handleSendCode);
  elements.verifyCodeBtn.addEventListener('click', handleVerifyCode);
  elements.backToEmailBtn.addEventListener('click', handleBackToEmail);

  // Enter key handlers
  elements.emailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendCode();
  });
  elements.codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleVerifyCode();
  });

  // Initialize Privy
  try {
    initPrivy();
  } catch (error) {
    console.error('Privy init failed:', error);
    showError('Failed to initialize authentication. Check your API keys.');
    return false;
  }

  // Check for existing session
  showStep('loading');
  setLoadingMessage('Checking session...');

  const { authenticated, user } = await checkSession();

  if (authenticated && user) {
    // Restore session
    return await completeLogin(user);
  } else {
    // Show login form
    updateAuthState({ initialized: true, authenticated: false });
    showStep('email');
    return false;
  }
}

/**
 * Show the login modal (for logout/re-auth)
 */
export function showLoginModal() {
  clearAuthState();
  elements.modal.classList.remove('hidden');
  elements.walletIndicator.classList.add('hidden');
  elements.emailInput.value = '';
  elements.codeInput.value = '';
  showStep('email');
}
