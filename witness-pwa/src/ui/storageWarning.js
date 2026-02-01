/**
 * Storage Warning Banner for Witness Protocol
 * Shows a non-blocking warning when storage is getting low (>80% used)
 */

import { getStorageStatus } from '../lib/streaming/RecoveryService.js';

let warningBanner = null;
let dismissedUntil = 0;

/**
 * Create the warning banner HTML
 * @param {Object} status - Storage status from RecoveryService
 */
function createBanner(status) {
  const div = document.createElement('div');
  div.className = 'storage-warning';
  div.innerHTML = `
    <div class="storage-warning-content">
      <span class="storage-warning-icon">&#9888;</span>
      <span class="storage-warning-text">
        Storage is ${status.usagePercent}% full. Recording may stop if storage runs out.
      </span>
      <button class="storage-warning-dismiss" aria-label="Dismiss">&#10005;</button>
    </div>
  `;
  return div;
}

/**
 * Show the storage warning banner
 * @param {Object} [status] - Optional storage status (will fetch if not provided)
 */
export async function showStorageWarning(status) {
  // Don't show if already visible
  if (warningBanner) return;

  // Don't show if recently dismissed (10 minute cooldown)
  if (Date.now() < dismissedUntil) return;

  // Get status if not provided
  if (!status) {
    status = await getStorageStatus();
  }

  // Only show if storage is actually low
  if (!status.isLow) return;

  warningBanner = createBanner(status);

  // Dismiss button handler
  warningBanner.querySelector('.storage-warning-dismiss').addEventListener('click', () => {
    hideStorageWarning();
    // Don't show again for 10 minutes
    dismissedUntil = Date.now() + 10 * 60 * 1000;
  });

  // Insert at top of body
  document.body.insertBefore(warningBanner, document.body.firstChild);

  console.log('[StorageWarning] Showing warning:', status.usagePercent + '%');
}

/**
 * Hide the storage warning banner
 */
export function hideStorageWarning() {
  if (warningBanner) {
    warningBanner.remove();
    warningBanner = null;
  }
}

/**
 * Check storage and show warning if needed
 * Call this periodically during recording
 */
export async function checkAndWarn() {
  const status = await getStorageStatus();
  if (status.isLow) {
    showStorageWarning(status);
  }
}

/**
 * Reset the dismiss cooldown (for testing)
 */
export function resetDismissCooldown() {
  dismissedUntil = 0;
}

/**
 * Listen for storage warning events from other modules
 */
function initEventListener() {
  window.addEventListener('witness:storage-low', (e) => {
    showStorageWarning(e.detail);
  });
}

// Initialize event listener
initEventListener();

export default {
  showStorageWarning,
  hideStorageWarning,
  checkAndWarn,
  resetDismissCooldown,
};
