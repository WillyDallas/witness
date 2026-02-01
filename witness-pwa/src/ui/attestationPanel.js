/**
 * Attestation Panel Component
 * Shows attestation count and attest button for content
 */

import { submitAttestation, hasLocallyAttested, fetchAttestationCount } from '../lib/attestation.js';
import { getGroupSecrets } from '../lib/storage.js';
import { getAuthState } from '../lib/authState.js';

/**
 * Create attestation panel HTML
 * @param {string} contentId - Content ID
 * @param {string[]} contentGroupIds - Groups content is shared with
 * @param {number} initialCount - Initial attestation count
 * @returns {string} HTML string
 */
export function createAttestationPanel(contentId, contentGroupIds, initialCount) {
  const hasAttested = hasLocallyAttested(contentId);

  return `
    <div class="attestation-section" data-content-id="${contentId}">
      <h3>Anonymous Attestations</h3>

      <div class="attestation-count-box">
        <div class="attestation-icon">🛡️</div>
        <div class="attestation-info">
          <span class="attestation-count" id="attestation-count-${contentId}">${initialCount}</span>
          <span class="attestation-label">group members have verified this evidence</span>
        </div>
        <div class="attestation-privacy-note">
          Identities are private. Only the count is public.
        </div>
      </div>

      <div class="attest-controls" id="attest-controls-${contentId}">
        ${hasAttested ? `
          <div class="already-attested">
            ✓ You have attested to this evidence
          </div>
        ` : `
          <div class="attest-form" id="attest-form-${contentId}">
            <label for="attest-group-${contentId}">Attest as member of:</label>
            <select id="attest-group-${contentId}" class="form-select">
              <option value="">Loading groups...</option>
            </select>
            <button class="btn btn-attest" id="btn-attest-${contentId}" disabled>
              🔐 Attest to Evidence
            </button>
            <div class="attest-progress" id="attest-progress-${contentId}" style="display: none;">
              <div class="spinner"></div>
              <span id="attest-message-${contentId}">Generating proof...</span>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

/**
 * Initialize attestation panel with group data
 * @param {string} contentId - Content ID
 * @param {string[]} contentGroupIds - Groups content is shared with
 */
export async function initAttestationPanel(contentId, contentGroupIds) {
  const { encryptionKey } = getAuthState();
  if (!encryptionKey) return;

  const hasAttested = hasLocallyAttested(contentId);
  if (hasAttested) return; // No need to load groups if already attested

  // Get user's groups
  const userGroups = await getGroupSecrets(encryptionKey);
  const attestableGroups = contentGroupIds.filter(gId => userGroups[gId]);

  const selectEl = document.getElementById(`attest-group-${contentId}`);
  const btnEl = document.getElementById(`btn-attest-${contentId}`);

  if (!selectEl || !btnEl) return;

  if (attestableGroups.length === 0) {
    selectEl.innerHTML = '<option value="">No matching groups</option>';
    const formEl = document.getElementById(`attest-form-${contentId}`);
    if (formEl) {
      formEl.innerHTML = `
        <div class="no-attest-access">
          You are not a member of any group this content is shared with.
        </div>
      `;
    }
    return;
  }

  // Populate group select
  selectEl.innerHTML = attestableGroups.map(gId => {
    const group = userGroups[gId];
    return `<option value="${gId}">${escapeHtml(group.name)}</option>`;
  }).join('');

  btnEl.disabled = false;

  // Add click handler
  btnEl.addEventListener('click', () => handleAttest(contentId));
}

/**
 * Handle attestation button click
 * @param {string} contentId - Content ID
 */
async function handleAttest(contentId) {
  const selectEl = document.getElementById(`attest-group-${contentId}`);
  const btnEl = document.getElementById(`btn-attest-${contentId}`);
  const progressEl = document.getElementById(`attest-progress-${contentId}`);
  const messageEl = document.getElementById(`attest-message-${contentId}`);
  const controlsEl = document.getElementById(`attest-controls-${contentId}`);

  const groupId = selectEl?.value;
  if (!groupId) return;

  try {
    // Show progress
    if (btnEl) btnEl.style.display = 'none';
    if (selectEl) selectEl.style.display = 'none';
    if (progressEl) progressEl.style.display = 'flex';

    const result = await submitAttestation(contentId, groupId, (progress) => {
      if (messageEl) messageEl.textContent = progress.message;
    });

    // Update count
    const countEl = document.getElementById(`attestation-count-${contentId}`);
    if (countEl) countEl.textContent = result.newCount;

    // Replace form with success message
    if (controlsEl) {
      controlsEl.innerHTML = `
        <div class="already-attested">
          ✓ You have attested to this evidence
        </div>
      `;
    }
  } catch (err) {
    // Restore form on error
    if (progressEl) progressEl.style.display = 'none';
    if (btnEl) btnEl.style.display = 'flex';
    if (selectEl) selectEl.style.display = 'block';

    alert('Attestation failed: ' + err.message);
  }
}

/**
 * Refresh attestation count
 * @param {string} contentId - Content ID
 */
export async function refreshAttestationCount(contentId) {
  try {
    const count = await fetchAttestationCount(contentId);
    const countEl = document.getElementById(`attestation-count-${contentId}`);
    if (countEl) countEl.textContent = count;
    return count;
  } catch (err) {
    console.error('[attestationPanel] Failed to refresh count:', err);
    return 0;
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
