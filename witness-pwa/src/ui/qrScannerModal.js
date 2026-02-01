/**
 * QR Scanner Modal for Witness Protocol
 * Scans QR codes to join groups
 */

import { Html5Qrcode } from 'html5-qrcode';
import { parseInviteQR, joinGroupFromInvite } from '../lib/groups.js';
import { refreshGroupsList } from './groupsModal.js';

let modal = null;
let scanner = null;
let currentView = 'scan'; // 'scan' | 'confirm' | 'joining'
let pendingInvite = null;

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'qr-scanner-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content qr-scanner-modal">
      <div class="modal-header">
        <h2 id="scanner-title">Scan QR Code</h2>
        <button class="modal-close" id="scanner-close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Scan View -->
        <div id="scanner-view-scan" class="scanner-view">
          <div id="qr-reader" class="qr-reader"></div>
          <p id="scan-status" class="scan-status">Point camera at QR code</p>
          <p id="scan-error" class="error-text hidden"></p>
        </div>

        <!-- Confirm View -->
        <div id="scanner-view-confirm" class="scanner-view hidden">
          <div class="confirm-invite">
            <p class="confirm-label">You're invited to join:</p>
            <p id="confirm-group-name" class="confirm-group-name"></p>
          </div>
          <p class="confirm-info">You'll be able to:</p>
          <ul class="confirm-list">
            <li>View videos shared with this group</li>
            <li>Share your videos with this group</li>
          </ul>
          <button id="confirm-join-btn" class="btn btn-primary btn-full">
            Join Group
          </button>
          <button id="cancel-join-btn" class="btn btn-secondary btn-full">
            Cancel
          </button>
          <p id="join-error" class="error-text hidden"></p>
        </div>

        <!-- Joining View -->
        <div id="scanner-view-joining" class="scanner-view hidden">
          <div class="joining-spinner">
            <div class="loading-spinner"></div>
          </div>
          <p id="joining-status" class="joining-status">Joining group...</p>
        </div>

        <!-- Success View -->
        <div id="scanner-view-success" class="scanner-view hidden">
          <div class="success-icon">✅</div>
          <p class="success-text">Successfully joined!</p>
          <p id="success-group-name" class="success-group-name"></p>
          <button id="done-join-btn" class="btn btn-primary btn-full">
            Done
          </button>
        </div>
      </div>
    </div>
  `;
  return div;
}

/**
 * Show a specific view
 */
function showView(view) {
  currentView = view;

  document.getElementById('scanner-view-scan').classList.toggle('hidden', view !== 'scan');
  document.getElementById('scanner-view-confirm').classList.toggle('hidden', view !== 'confirm');
  document.getElementById('scanner-view-joining').classList.toggle('hidden', view !== 'joining');
  document.getElementById('scanner-view-success').classList.toggle('hidden', view !== 'success');

  const title = document.getElementById('scanner-title');

  switch (view) {
    case 'scan':
      title.textContent = 'Scan QR Code';
      break;
    case 'confirm':
      title.textContent = 'Join Group?';
      break;
    case 'joining':
      title.textContent = 'Joining...';
      break;
    case 'success':
      title.textContent = 'Success!';
      break;
  }
}

/**
 * Start the QR scanner
 */
async function startScanner() {
  const errorEl = document.getElementById('scan-error');
  const statusEl = document.getElementById('scan-status');

  errorEl.classList.add('hidden');
  statusEl.textContent = 'Starting camera...';

  try {
    scanner = new Html5Qrcode('qr-reader');

    const config = {
      fps: 10,
      qrbox: { width: 250, height: 250 },
      aspectRatio: 1.0,
    };

    await scanner.start(
      { facingMode: 'environment' },
      config,
      onScanSuccess,
      onScanError
    );

    statusEl.textContent = 'Point camera at QR code';
  } catch (err) {
    console.error('[scanner] Failed to start:', err);

    if (err.name === 'NotAllowedError') {
      errorEl.textContent = 'Camera permission denied. Please allow camera access.';
    } else if (err.name === 'NotFoundError') {
      errorEl.textContent = 'No camera found on this device.';
    } else {
      errorEl.textContent = 'Failed to start camera: ' + err.message;
    }
    errorEl.classList.remove('hidden');
    statusEl.textContent = '';
  }
}

/**
 * Stop the QR scanner
 */
async function stopScanner() {
  if (scanner) {
    try {
      await scanner.stop();
      scanner.clear();
    } catch (err) {
      console.warn('[scanner] Error stopping:', err);
    }
    scanner = null;
  }
}

/**
 * Handle successful QR scan
 */
function onScanSuccess(decodedText) {
  console.log('[scanner] Scanned:', decodedText.slice(0, 50) + '...');

  try {
    const invite = parseInviteQR(decodedText);
    pendingInvite = invite;

    // Stop scanner and show confirmation
    stopScanner();
    showConfirmView(invite);
  } catch (err) {
    const errorEl = document.getElementById('scan-error');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');

    // Clear error after 3 seconds
    setTimeout(() => {
      errorEl.classList.add('hidden');
    }, 3000);
  }
}

/**
 * Handle scan errors (called frequently, mostly ignorable)
 */
function onScanError(errorMessage) {
  // Most errors are just "no QR found" - ignore those
  // Only log actual errors
  if (!errorMessage.includes('No QR code found')) {
    console.warn('[scanner] Error:', errorMessage);
  }
}

/**
 * Show the confirmation view
 */
function showConfirmView(invite) {
  document.getElementById('confirm-group-name').textContent = invite.groupName;
  document.getElementById('join-error').classList.add('hidden');
  showView('confirm');
}

/**
 * Handle join confirmation
 */
async function handleJoinGroup() {
  if (!pendingInvite) return;

  const errorEl = document.getElementById('join-error');
  errorEl.classList.add('hidden');

  showView('joining');
  document.getElementById('joining-status').textContent = 'Submitting transaction...';

  try {
    await joinGroupFromInvite(pendingInvite);

    document.getElementById('success-group-name').textContent = pendingInvite.groupName;
    showView('success');

    // Refresh groups list in background
    refreshGroupsList();
  } catch (err) {
    console.error('[scanner] Join failed:', err);
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    showView('confirm');
  }
}

/**
 * Show the QR scanner modal
 */
export function showQRScannerModal() {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('scanner-close').addEventListener('click', hideQRScannerModal);
    document.getElementById('confirm-join-btn').addEventListener('click', handleJoinGroup);
    document.getElementById('cancel-join-btn').addEventListener('click', () => {
      pendingInvite = null;
      showView('scan');
      startScanner();
    });
    document.getElementById('done-join-btn').addEventListener('click', hideQRScannerModal);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideQRScannerModal();
    });
  }

  pendingInvite = null;
  showView('scan');
  modal.classList.remove('hidden');

  // Start scanner after modal is visible
  setTimeout(() => startScanner(), 100);
}

/**
 * Hide the QR scanner modal
 */
export function hideQRScannerModal() {
  stopScanner();
  pendingInvite = null;

  if (modal) {
    modal.classList.add('hidden');
  }
}
