/**
 * Content Upload Modal for Witness Protocol
 * Test UI for uploading encrypted content to IPFS
 */

import { getAuthState } from '../lib/authState.js';
import { getMyGroups } from '../lib/groups.js';
import { uploadContent } from '../lib/content.js';
import { isConfigured } from '../lib/ipfs.js';

let modal = null;
let selectedGroups = new Set();

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'upload-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content upload-modal">
      <div class="modal-header">
        <h2>Upload Content</h2>
        <button class="modal-close" id="upload-close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Configuration Check -->
        <div id="upload-config-check" class="upload-section"></div>

        <!-- Content Input -->
        <div id="upload-input-section" class="upload-section">
          <label for="upload-text" class="upload-label">Test Content</label>
          <textarea
            id="upload-text"
            class="upload-textarea"
            placeholder="Enter text content to upload (for testing)"
            rows="4"
          ></textarea>
        </div>

        <!-- Group Selection -->
        <div id="upload-groups-section" class="upload-section">
          <label class="upload-label">Share with Groups</label>
          <div id="upload-groups-list" class="upload-groups-list"></div>
        </div>

        <!-- Upload Button -->
        <button id="upload-btn" class="btn btn-primary btn-full" disabled>
          Upload & Commit
        </button>

        <!-- Progress -->
        <div id="upload-progress" class="upload-progress hidden">
          <div class="progress-bar">
            <div id="progress-fill" class="progress-fill"></div>
          </div>
          <p id="progress-message" class="progress-message">Preparing...</p>
        </div>

        <!-- Result -->
        <div id="upload-result" class="upload-result hidden"></div>

        <!-- Error -->
        <p id="upload-error" class="error-text hidden"></p>
      </div>
    </div>
  `;
  return div;
}

/**
 * Check IPFS configuration
 */
function checkConfiguration() {
  const configEl = document.getElementById('upload-config-check');

  if (!isConfigured()) {
    configEl.innerHTML = `
      <div class="config-warning">
        <span class="warning-icon">⚠️</span>
        <p>IPFS not configured. Add VITE_PINATA_JWT and VITE_PINATA_GATEWAY to your .env file.</p>
      </div>
    `;
    return false;
  }

  configEl.innerHTML = '';
  return true;
}

/**
 * Load available groups
 */
async function loadGroups() {
  const listEl = document.getElementById('upload-groups-list');
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    listEl.innerHTML = '<p class="muted">Login to see groups</p>';
    return;
  }

  try {
    const groups = await getMyGroups();

    if (groups.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <p class="muted">No groups yet</p>
          <p class="muted-small">Create a group first in "My Groups"</p>
        </div>
      `;
      return;
    }

    selectedGroups.clear();

    listEl.innerHTML = groups.map(g => `
      <label class="group-checkbox">
        <input type="checkbox" value="${g.groupId}" class="group-check-input" />
        <span class="group-check-label">${escapeHtml(g.name)}</span>
        <span class="group-check-meta">${g.isCreator ? 'Creator' : 'Member'}</span>
      </label>
    `).join('');

    // Add checkbox listeners
    listEl.querySelectorAll('.group-check-input').forEach(checkbox => {
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedGroups.add(checkbox.value);
        } else {
          selectedGroups.delete(checkbox.value);
        }
        updateUploadButton();
      });
    });
  } catch (err) {
    listEl.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

/**
 * Update upload button state
 */
function updateUploadButton() {
  const btn = document.getElementById('upload-btn');
  const text = document.getElementById('upload-text').value.trim();
  const hasGroups = selectedGroups.size > 0;
  const configured = isConfigured();

  btn.disabled = !text || !hasGroups || !configured;
}

/**
 * Handle upload
 */
async function handleUpload() {
  const textEl = document.getElementById('upload-text');
  const btn = document.getElementById('upload-btn');
  const progressEl = document.getElementById('upload-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressMsg = document.getElementById('progress-message');
  const resultEl = document.getElementById('upload-result');
  const errorEl = document.getElementById('upload-error');

  const text = textEl.value.trim();

  if (!text || selectedGroups.size === 0) return;

  // Reset state
  btn.disabled = true;
  btn.textContent = 'Uploading...';
  errorEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  progressEl.classList.remove('hidden');
  progressFill.style.width = '0%';

  try {
    const contentData = new TextEncoder().encode(text);
    const groupIds = Array.from(selectedGroups);

    const result = await uploadContent(
      contentData,
      groupIds,
      { title: 'Test Upload' },
      (progress) => {
        progressFill.style.width = `${progress.progress}%`;
        progressMsg.textContent = progress.message;
      }
    );

    // Show result
    resultEl.innerHTML = `
      <div class="result-success">
        <div class="result-icon">✅</div>
        <h3>Upload Complete!</h3>
        <div class="result-details">
          <div class="result-row">
            <span class="result-label">Content ID:</span>
            <code class="result-value">${result.contentId.slice(0, 18)}...</code>
          </div>
          <div class="result-row">
            <span class="result-label">IPFS CID:</span>
            <code class="result-value">${result.manifestCID.slice(0, 20)}...</code>
          </div>
          <div class="result-row">
            <span class="result-label">Transaction:</span>
            <a href="https://sepolia.basescan.org/tx/${result.txHash}" target="_blank" class="result-link">
              ${result.txHash.slice(0, 18)}... 🔗
            </a>
          </div>
        </div>
      </div>
    `;
    resultEl.classList.remove('hidden');
    progressEl.classList.add('hidden');

    // Clear form
    textEl.value = '';
    selectedGroups.clear();
    document.querySelectorAll('.group-check-input').forEach(cb => cb.checked = false);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    progressEl.classList.add('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload & Commit';
    updateUploadButton();
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Show the upload modal
 */
export function showUploadModal() {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('upload-close').addEventListener('click', hideUploadModal);
    document.getElementById('upload-btn').addEventListener('click', handleUpload);
    document.getElementById('upload-text').addEventListener('input', updateUploadButton);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideUploadModal();
    });
  }

  // Reset state
  document.getElementById('upload-text').value = '';
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('upload-result').classList.add('hidden');
  document.getElementById('upload-error').classList.add('hidden');
  selectedGroups.clear();

  // Load data
  checkConfiguration();
  loadGroups();
  updateUploadButton();

  modal.classList.remove('hidden');
}

/**
 * Hide the upload modal
 */
export function hideUploadModal() {
  if (modal) {
    modal.classList.add('hidden');
  }
}
