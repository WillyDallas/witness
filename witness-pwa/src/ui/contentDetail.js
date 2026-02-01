/**
 * Content Detail View for Witness Protocol
 * Shows content with decryption and verification
 */

import { getAuthState } from '../lib/authState.js';
import { getGroupNames } from '../lib/contentDiscovery.js';
import { downloadAndDecrypt, toDataUrl, detectContentType } from '../lib/contentDecrypt.js';
import { downloadAndDecryptChunked, isChunkedContent, getChunkedContentInfo } from '../lib/chunkedContentDecrypt.js';
import { downloadManifest } from '../lib/ipfs.js';
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
            <!-- Chunk progress bar (hidden for single-chunk) -->
            <div id="chunk-progress" class="chunk-progress hidden">
              <div id="chunk-progress-bar" class="chunk-progress-bar"></div>
              <p id="chunk-progress-text" class="chunk-progress-text">0 / 0 chunks</p>
            </div>
          </div>
          <div id="preview-content" class="preview-content hidden"></div>
          <div id="preview-error" class="preview-error hidden"></div>
        </div>

        <!-- Chunk Info (for chunked content) -->
        <div id="chunk-info" class="chunk-info hidden">
          <div class="chunk-info-header">Recording Details</div>
          <div class="chunk-info-row">
            <span class="chunk-info-label">Chunks</span>
            <span id="chunk-count" class="chunk-info-value">-</span>
          </div>
          <div class="chunk-info-row">
            <span class="chunk-info-label">Duration</span>
            <span id="chunk-duration" class="chunk-info-value">-</span>
          </div>
          <div class="chunk-info-row">
            <span class="chunk-info-label">Status</span>
            <span id="chunk-status" class="chunk-info-value">-</span>
          </div>
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
              <span class="verify-text">Merkle root</span>
            </div>
            <div class="verification-row" id="verify-chain">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">On-chain record</span>
            </div>
            <div class="verification-row hidden" id="verify-chunks">
              <span class="verify-icon">⏳</span>
              <span class="verify-text">Chunk integrity</span>
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
 * Update verification UI for chunked content
 */
function updateVerificationChunked(merkleValid, chunkVerifications) {
  const merkleEl = document.getElementById('verify-merkle');
  const chainEl = document.getElementById('verify-chain');
  const chunksEl = document.getElementById('verify-chunks');

  merkleEl.innerHTML = `
    <span class="verify-icon">${merkleValid ? '✅' : '❌'}</span>
    <span class="verify-text">Merkle root ${merkleValid ? 'verified' : 'MISMATCH'}</span>
  `;

  chainEl.innerHTML = `
    <span class="verify-icon">✅</span>
    <span class="verify-text">On-chain record confirmed</span>
  `;

  // Check all chunks verified
  const allVerified = chunkVerifications.every(v => v.status === 'verified');
  const verifiedCount = chunkVerifications.filter(v => v.status === 'verified').length;

  chunksEl.innerHTML = `
    <span class="verify-icon">${allVerified ? '✅' : '⚠️'}</span>
    <span class="verify-text">${verifiedCount}/${chunkVerifications.length} chunks verified</span>
  `;
}

/**
 * Render chunked video with object URL
 */
function renderChunkedVideo(videoBlob) {
  const previewEl = document.getElementById('preview-content');

  // Clean up previous URL
  if (decryptedUrl) {
    URL.revokeObjectURL(decryptedUrl);
    decryptedUrl = null;
  }

  // DIAGNOSTIC: Log blob details
  console.log('[contentDetail] DIAGNOSTIC - Video blob size:', videoBlob.size, 'type:', videoBlob.type);

  // Create object URL for video blob
  decryptedUrl = URL.createObjectURL(videoBlob);
  console.log('[contentDetail] DIAGNOSTIC - Video URL created:', decryptedUrl);

  previewEl.innerHTML = `
    <video controls class="video-preview" playsinline>
      <source src="${decryptedUrl}" type="${videoBlob.type}" />
      Your browser does not support video playback.
    </video>
  `;

  // Add error handler to video element
  const videoEl = previewEl.querySelector('video');
  videoEl.onerror = (e) => {
    console.error('[contentDetail] Video playback error:', e);
    console.error('[contentDetail] Video error code:', videoEl.error?.code, 'message:', videoEl.error?.message);
  };

  previewEl.classList.remove('hidden');
}

/**
 * Format duration in ms to human readable
 */
function formatDuration(ms) {
  if (!ms) return 'Unknown';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
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
 * Load and display content (handles both single-chunk and chunked)
 */
async function loadContent(item) {
  const loadingEl = document.getElementById('preview-loading');
  const statusEl = document.getElementById('preview-status');
  const contentEl = document.getElementById('preview-content');
  const errorEl = document.getElementById('preview-error');
  const chunkProgressEl = document.getElementById('chunk-progress');
  const chunkProgressBar = document.getElementById('chunk-progress-bar');
  const chunkProgressText = document.getElementById('chunk-progress-text');
  const chunkInfoEl = document.getElementById('chunk-info');
  const verifyChunksEl = document.getElementById('verify-chunks');

  loadingEl.classList.remove('hidden');
  contentEl.classList.add('hidden');
  errorEl.classList.add('hidden');
  chunkProgressEl.classList.add('hidden');
  chunkInfoEl.classList.add('hidden');
  verifyChunksEl.classList.add('hidden');

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

  // Set basescan link
  document.getElementById('basescan-link').href =
    `https://sepolia.basescan.org/address/${item.uploader}`;

  try {
    // First fetch manifest to determine if chunked
    const manifest = await downloadManifest(item.manifestCID);
    const isChunked = isChunkedContent(manifest);

    if (isChunked) {
      // Show chunk info
      const info = getChunkedContentInfo(manifest);
      chunkInfoEl.classList.remove('hidden');
      document.getElementById('chunk-count').textContent = `${info.chunkCount} chunks`;
      document.getElementById('chunk-duration').textContent = formatDuration(info.totalDuration);

      const statusEl2 = document.getElementById('chunk-status');
      if (info.status === 'interrupted') {
        statusEl2.textContent = 'Interrupted';
        statusEl2.classList.add('status-warning');
      } else {
        statusEl2.textContent = info.status === 'complete' ? 'Complete' : 'In Progress';
        statusEl2.classList.remove('status-warning');
      }

      // Show chunk verification row
      verifyChunksEl.classList.remove('hidden');

      // Show progress bar
      chunkProgressEl.classList.remove('hidden');

      // Use chunked decryption
      const result = await downloadAndDecryptChunked(
        item.contentId,
        item.manifestCID,
        item.merkleRoot,
        (progress) => {
          statusEl.textContent = progress.message;

          if (progress.totalChunks) {
            const current = progress.currentChunk !== undefined ? progress.currentChunk + 1 : 0;
            chunkProgressText.textContent = `${current} / ${progress.totalChunks} chunks`;
            chunkProgressBar.style.width = `${progress.progress}%`;
          }
        }
      );

      // Update verification status
      updateVerificationChunked(result.merkleRootVerified, result.chunkVerifications);

      // Render video
      renderChunkedVideo(result.videoBlob);

      loadingEl.classList.add('hidden');

      // Load attestation panel
      await loadAttestationPanel(item.contentId, item.groupIds);

    } else {
      // Use existing single-chunk decryption
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
    }
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
  document.getElementById('chunk-progress').classList.add('hidden');
  document.getElementById('chunk-progress-bar').style.width = '0%';
  document.getElementById('chunk-progress-text').textContent = '0 / 0 chunks';
  document.getElementById('chunk-info').classList.add('hidden');
  document.getElementById('verify-merkle').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">Merkle root</span>
  `;
  document.getElementById('verify-chain').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">On-chain record</span>
  `;
  document.getElementById('verify-chunks').classList.add('hidden');
  document.getElementById('verify-chunks').innerHTML = `
    <span class="verify-icon">⏳</span>
    <span class="verify-text">Chunk integrity</span>
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
