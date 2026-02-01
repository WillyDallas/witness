/**
 * Recovery Dialog for Witness Protocol
 * Shows when incomplete recording sessions are found on startup
 */

import {
  resumeSession,
  resumeAllSessions,
  discardSession,
  discardAllSessions,
  getRecoverySummary,
} from '../lib/streaming/RecoveryService.js';

let modal = null;
let uploadQueueRef = null;
let onCompleteCallback = null;

/**
 * Format timestamp to readable date
 * @param {number} timestamp - Unix timestamp (ms)
 * @returns {string}
 */
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

/**
 * Create the modal HTML structure
 * @param {Object} summary - Recovery summary from RecoveryService
 */
function createModal(summary) {
  const div = document.createElement('div');
  div.id = 'recovery-modal';
  div.className = 'modal-overlay';

  const sessionsHtml = summary.sessions
    .map(
      (s) => `
    <div class="recovery-session" data-session-id="${s.sessionId}">
      <div class="session-info">
        <div class="session-date">${formatDate(s.createdAt)}</div>
        <div class="session-stats">
          <span class="stat">${s.chunkCount} chunks captured</span>
          <span class="stat stat-pending">${s.pendingChunks} pending</span>
          ${s.failedChunks > 0 ? `<span class="stat stat-failed">${s.failedChunks} failed</span>` : ''}
        </div>
      </div>
      <div class="session-actions">
        <button class="btn btn-small btn-secondary" data-action="resume" data-session="${s.sessionId}">
          Resume
        </button>
        <button class="btn btn-small btn-danger" data-action="discard" data-session="${s.sessionId}">
          Discard
        </button>
      </div>
    </div>
  `
    )
    .join('');

  div.innerHTML = `
    <div class="modal-content recovery-modal">
      <div class="modal-header">
        <h2>Incomplete Recordings Found</h2>
      </div>

      <div class="modal-body">
        <p class="recovery-description">
          The app was closed while recording. Would you like to resume uploading these recordings?
        </p>

        <div class="recovery-sessions-list">
          ${sessionsHtml}
        </div>

        <div class="recovery-bulk-actions">
          <button id="recovery-resume-all" class="btn btn-primary">
            Resume All (${summary.sessionCount})
          </button>
          <button id="recovery-discard-all" class="btn btn-secondary">
            Discard All
          </button>
        </div>

        <p id="recovery-error" class="error-text hidden"></p>
      </div>
    </div>
  `;

  return div;
}

/**
 * Handle resuming a single session
 * @param {string} sessionId
 */
async function handleResumeSession(sessionId) {
  const errorEl = document.getElementById('recovery-error');
  const sessionEl = modal.querySelector(`[data-session-id="${sessionId}"]`);

  try {
    sessionEl.classList.add('processing');
    await resumeSession(sessionId, uploadQueueRef);
    sessionEl.remove();

    // Check if any sessions remain
    const remaining = modal.querySelectorAll('.recovery-session');
    if (remaining.length === 0) {
      closeAndComplete();
    }
  } catch (err) {
    console.error('[RecoveryDialog] Resume failed:', err);
    errorEl.textContent = `Resume failed: ${err.message}`;
    errorEl.classList.remove('hidden');
    sessionEl.classList.remove('processing');
  }
}

/**
 * Handle discarding a single session
 * @param {string} sessionId
 */
async function handleDiscardSession(sessionId) {
  const errorEl = document.getElementById('recovery-error');
  const sessionEl = modal.querySelector(`[data-session-id="${sessionId}"]`);

  try {
    sessionEl.classList.add('processing');
    await discardSession(sessionId);
    sessionEl.remove();

    // Check if any sessions remain
    const remaining = modal.querySelectorAll('.recovery-session');
    if (remaining.length === 0) {
      closeAndComplete();
    }
  } catch (err) {
    console.error('[RecoveryDialog] Discard failed:', err);
    errorEl.textContent = `Discard failed: ${err.message}`;
    errorEl.classList.remove('hidden');
    sessionEl.classList.remove('processing');
  }
}

/**
 * Handle resuming all sessions
 */
async function handleResumeAll() {
  const errorEl = document.getElementById('recovery-error');
  const btn = document.getElementById('recovery-resume-all');

  try {
    btn.disabled = true;
    btn.textContent = 'Resuming...';
    await resumeAllSessions(uploadQueueRef);
    closeAndComplete();
  } catch (err) {
    console.error('[RecoveryDialog] Resume all failed:', err);
    errorEl.textContent = `Resume failed: ${err.message}`;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Resume All';
  }
}

/**
 * Handle discarding all sessions
 */
async function handleDiscardAll() {
  const errorEl = document.getElementById('recovery-error');
  const btn = document.getElementById('recovery-discard-all');

  try {
    btn.disabled = true;
    btn.textContent = 'Discarding...';
    await discardAllSessions();
    closeAndComplete();
  } catch (err) {
    console.error('[RecoveryDialog] Discard all failed:', err);
    errorEl.textContent = `Discard failed: ${err.message}`;
    errorEl.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Discard All';
  }
}

/**
 * Close modal and call completion callback
 */
function closeAndComplete() {
  hideRecoveryDialog();
  if (onCompleteCallback) {
    onCompleteCallback();
  }
}

/**
 * Set up event listeners
 */
function attachListeners() {
  // Bulk action buttons
  document.getElementById('recovery-resume-all').addEventListener('click', handleResumeAll);
  document.getElementById('recovery-discard-all').addEventListener('click', handleDiscardAll);

  // Per-session buttons
  modal.querySelectorAll('.session-actions button').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      const sessionId = e.target.dataset.session;

      if (action === 'resume') {
        handleResumeSession(sessionId);
      } else if (action === 'discard') {
        handleDiscardSession(sessionId);
      }
    });
  });

  // Note: No click-outside-to-close for recovery dialog
  // User must make an explicit choice
}

/**
 * Show the recovery dialog
 * @param {Object} summary - Recovery summary from RecoveryService
 * @param {UploadQueue} uploadQueue - Upload queue instance for resuming
 * @param {Function} [onComplete] - Callback when recovery is complete
 * @returns {Promise<void>}
 */
export async function showRecoveryDialog(summary, uploadQueue, onComplete) {
  uploadQueueRef = uploadQueue;
  onCompleteCallback = onComplete || null;

  // Get fresh summary if not provided
  if (!summary) {
    summary = await getRecoverySummary();
  }

  if (!summary || summary.sessionCount === 0) {
    console.log('[RecoveryDialog] No sessions to recover');
    if (onComplete) onComplete();
    return;
  }

  if (modal) {
    modal.remove();
  }

  modal = createModal(summary);
  document.body.appendChild(modal);
  attachListeners();

  console.log(`[RecoveryDialog] Showing ${summary.sessionCount} incomplete session(s)`);
}

/**
 * Hide the recovery dialog
 */
export function hideRecoveryDialog() {
  if (modal) {
    modal.remove();
    modal = null;
  }
  uploadQueueRef = null;
  onCompleteCallback = null;
}

/**
 * Check if dialog is currently shown
 * @returns {boolean}
 */
export function isRecoveryDialogShown() {
  return modal !== null;
}

export default {
  showRecoveryDialog,
  hideRecoveryDialog,
  isRecoveryDialogShown,
};
