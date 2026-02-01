/**
 * Registration status component
 * Shows whether user is registered on-chain and allows registration
 */
import { isRegistered, getRegisteredAt, register, waitForTransaction } from '../lib/contract.js';

/**
 * Create and mount the registration status component
 * @param {HTMLElement} container - Container element
 * @param {string} smartAccountAddress - User's smart account address
 * @returns {object} Component API
 */
export function createRegistrationStatus(container, smartAccountAddress) {
  let state = {
    isRegistered: false,
    registeredAt: null,
    isLoading: true,
    isRegistering: false,
    txHash: null,
    error: null,
  };

  function render() {
    container.innerHTML = `
      <div class="registration-status">
        <h3>On-Chain Registration</h3>

        ${state.isLoading ? `
          <p class="loading">Checking registration status...</p>
        ` : state.error ? `
          <p class="error">${state.error}</p>
          <button id="retry-check" class="btn-secondary">Retry</button>
        ` : state.isRegistered ? `
          <div class="registered">
            <p class="status success">Registered</p>
            <p class="timestamp">Since: ${new Date(Number(state.registeredAt) * 1000).toLocaleString()}</p>
            ${state.txHash ? `
              <p class="tx-link">
                <a href="https://sepolia.basescan.org/tx/${state.txHash}" target="_blank" rel="noopener">
                  View Transaction
                </a>
              </p>
            ` : ''}
          </div>
        ` : `
          <div class="not-registered">
            <p class="status pending">Not registered</p>
            <p class="info">Register on-chain to use Witness Protocol features.</p>
            <button id="register-btn" class="btn-primary" ${state.isRegistering ? 'disabled' : ''}>
              ${state.isRegistering ? 'Registering...' : 'Register (Gasless)'}
            </button>
          </div>
        `}
      </div>
    `;

    // Attach event listeners
    const registerBtn = container.querySelector('#register-btn');
    if (registerBtn) {
      registerBtn.addEventListener('click', handleRegister);
    }

    const retryBtn = container.querySelector('#retry-check');
    if (retryBtn) {
      retryBtn.addEventListener('click', checkStatus);
    }
  }

  async function checkStatus() {
    state.isLoading = true;
    state.error = null;
    render();

    try {
      const registered = await isRegistered(smartAccountAddress);
      state.isRegistered = registered;

      if (registered) {
        const timestamp = await getRegisteredAt(smartAccountAddress);
        state.registeredAt = timestamp;
      }
    } catch (err) {
      console.error('[RegistrationStatus] Error checking status:', err);
      state.error = 'Failed to check registration status';
    }

    state.isLoading = false;
    render();
  }

  async function handleRegister() {
    state.isRegistering = true;
    state.error = null;
    render();

    try {
      const hash = await register();
      state.txHash = hash;
      render();

      // Wait for confirmation
      await waitForTransaction(hash);

      // Re-check status
      state.isRegistered = true;
      const timestamp = await getRegisteredAt(smartAccountAddress);
      state.registeredAt = timestamp;
    } catch (err) {
      console.error('[RegistrationStatus] Registration failed:', err);
      state.error = err.message || 'Registration failed';
    }

    state.isRegistering = false;
    render();
  }

  // Initial render and status check
  render();
  checkStatus();

  return {
    refresh: checkStatus,
    getState: () => ({ ...state }),
  };
}
