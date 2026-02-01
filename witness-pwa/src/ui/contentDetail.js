/**
 * Content Detail View for Witness Protocol
 * Shows content with decryption and verification
 */

import { getAuthState } from '../lib/authState.js';
import { getGroupNames } from '../lib/contentDiscovery.js';
import { downloadAndDecrypt, toDataUrl, detectContentType } from '../lib/contentDecrypt.js';
import { createAttestationPanel, initAttestationPanel, refreshAttestationCount } from './attestationPanel.js';
import { fetchAttestationCount } from '../lib/attestation.js';

let modal = null;
let currentItem = null;
let decryptedUrl = null;

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'content-detail-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content content-detail-modal">
      <div class="modal-header">
        <button class="modal-back" id="content-detail-back">← Back</button>
        <h2>Evidence Detail</h2>
        <div style="width: 60px;"></div>
      </div>

      <div class="modal-body">
        <!-- Content Preview -->
        <div id="content-preview" class="content-preview">
          <div id="preview-loading" class="preview-loading">
            <div class="spinner"></div>
            <p id="preview-status">Loading...</p>
          </div>
          <div id="preview-content" class="preview-content hidden"></div>
          <div id="preview-error" class="preview-error hidden"></div>
        </div>

        <!-- Metadata -->
        <div id="content-metadata" class="content-metadata">
          <div class="metadata-row">
            <span class="metadata-label">Uploaded</span>
            <span id="meta-date" class="metadata-value">-</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">By</span>
            <span id="meta-uploader" class="metadata-value">-</span>
          </div>
          <div class="metadata-row">
            <span class="metadata-label">Shared with</span>
            <span id="meta-groups" class="metadata-value">-</span>
          </div>
        </div>

        <!-- Verification Status -->
        <div id="verification-status" class="verification-status">
          <div class="verification-header">Verification</div>
          <div id="verification-details" class="verification-details">
            <div class="verification-row" id="verify-merkle">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">Merkle proof</span>
            </div>
            <div class="verification-row" id="verify-chain">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">On-chain record</span>
            </div>
          </div>
        </div>

        <!-- Attestation Panel (loaded dynamically) -->
        <div id="attestation-container"></div>

        <!-- Actions -->
        <div class="content-actions">
          <a id="basescan-link" href="#" target="_blank" class="btn btn-secondary btn-full">
            View on Basescan
          </a>
        </div>
      </div>
    </div>
  `;
  return div;
}

/**
 * Format date for display
 */
function formatDate(timestamp) {
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

/**
 * Update verification UI
 */
function updateVerification(merkleValid, onChain) {
  const merkleEl = document.getElementById('verify-merkle');
  const chainEl = document.getElementById('verify-chain');

  merkleEl.innerHTML = `
    <span class="verify-icon">${merkleValid ? '✅' : '❌'}</span>
    <span class="verify-text">Merkle proof ${merkleValid ? 'valid' : 'INVALID'}</span>
  `;

  chainEl.innerHTML = `
    <span class="verify-icon">${onChain ? '✅' : '⏳'}</span>
    <span class="verify-text">On-chain since block ${onChain || 'unknown'}</span>
  `;
}

/**
 * Render content preview based on type
 */
function renderPreview(data, mimeType) {
  const previewEl = document.getElementById('preview-content');

  // Clean up previous URL
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
  }

  if (mimeType.startsWith('text/')) {
    // Text content
    const text = new TextDecoder().decode(data);
    previewEl.innerHTML = `<pre class="text-preview">${escapeHtml(text)}</pre>`;
  } else if (mimeType.startsWith('image/')) {
    // Image content
    decryptedUrl = toDataUrl(data, mimeType);
    previewEl.innerHTML = `<img src="${decryptedUrl}" class="image-preview" alt="Decrypted content" />`;
  } else if (mimeType.startsWith('video/')) {
    // Video content
    decryptedUrl = toDataUrl(data, mimeType);
    previewEl.innerHTML = `
      <video controls class="video-preview">
        <source src="${decryptedUrl}" type="${mimeType}" />
        Your browser does not support video playback.
      </video>
    `;
  } else {
    // Unknown type - show download option
    decryptedUrl = toDataUrl(data, mimeType);
    previewEl.innerHTML = `
      <div class="binary-preview">
        <p>Binary content (${data.length} bytes)</p>
        <a href="${decryptedUrl}" download="decrypted-content" class="btn btn-primary">
          Download
        </a>
      </div>
    `;
  }

  previewEl.classList.remove('hidden');
}

/**
 * Load and display attestation panel
 */
async function loadAttestationPanel(contentId, groupIds) {
  const container = document.getElementById('attestation-container');
  if (!container) return;

  try {
    // Get attestation count from chain
    const count = await fetchAttestationCount(contentId);

    // Create and insert panel HTML
    container.innerHTML = createAttestationPanel(contentId, groupIds, count);

    // Initialize panel with group data
    await initAttestationPanel(contentId, groupIds);
  } catch (err) {
    console.error('[contentDetail] Failed to load attestation panel:', err);
    container.innerHTML = ''; // Clear on error
  }
}

/**
 * Load and display content
 */
async function loadContent(item) {
  const loadingEl = document.getElementById('preview-loading');
  const statusEl = document.getElementById('preview-status');
  const contentEl = document.getElementById('preview-content');
  const errorEl = document.getElementById('preview-error');

  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');
  errorEl.classList.add('hidden');

  // Update metadata immediately
  const { smartAccountAddress } = getAuthState();
  const isOwn = item.uploader.toLowerCase() === smartAccountAddress?.toLowerCase();

  document.getElementById('meta-date').textContent = formatDate(item.timestamp);
  document.getElementById('meta-uploader').textContent = isOwn
    ? 'You'
    : item.uploader.slice(0, 6) + '...' + item.uploader.slice(-4);

  // Get group names
  const names = await getGroupNames(item.groupIds);
  const groupDisplay = item.groupIds.map(gid => names[gid] || gid.slice(0, 8)).join(', ');
  document.getElementById('meta-groups').textContent = groupDisplay || 'None';

  // Set basescan link (we don't have tx hash, so link to address)
  // In a real app, you'd store the tx hash and link to it
  document.getElementById('basescan-link').href =
    `https://sepolia.basescan.org/address/${item.uploader}`;

  // Decrypt content
  try {
    const result = await downloadAndDecrypt(
      item.contentId,
      item.manifestCID,
      item.merkleRoot,
      (progress) => {
        statusEl.textContent = progress.message;
      }
    );

    // Update verification status
    updateVerification(result.verified, 'confirmed');

    // Detect content type and render
    const mimeType = detectContentType(result.manifest, result.data);
    renderPreview(result.data, mimeType);

    loadingEl.classList.add('hidden');

    // Load attestation panel
    await loadAttestationPanel(item.contentId, item.groupIds);
  } catch (err) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');

    // Mark verification as failed
    updateVerification(false, null);
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
 * Show the content detail modal
 * @param {object} item - Content item from discovery
 */
export function showContentDetail(item) {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    document.getElementById('content-detail-back').addEventListener('click', hideContentDetail);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideContentDetail();
    });
  }

  currentItem = item;

  // Reset state
  document.getElementById('preview-loading').classList.remove('hidden');
  document.getElementById('preview-content').classList.add('hidden');
  document.getElementById('preview-error').classList.add('hidden');
  document.getElementById('preview-status').textContent = 'Loading...';
  document.getElementById('verify-merkle').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">Merkle proof</span>
  `;
  document.getElementById('verify-chain').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">On-chain record</span>
  `;
  document.getElementById('attestation-container').innerHTML = '';

  modal.classList.remove('hidden');
  loadContent(item);
}

/**
 * Hide the content detail modal
 */
export function hideContentDetail() {
  if (modal) {
    modal.classList.add('hidden');
  }

  // Clean up URL
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
  }
}
