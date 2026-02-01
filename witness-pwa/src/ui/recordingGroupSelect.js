/**
 * Recording Group Selection Modal
 * Allows user to select which groups to share recording with BEFORE recording starts.
 * Groups cannot be changed mid-recording.
 */

import { getAuthState } from '../lib/authState.js';
import { getMyGroups } from '../lib/groups.js';

let modal = null;
let onConfirmCallback = null;

/**
 * Create the modal HTML
 */
function createModal() {
    const div = document.createElement('div');
    div.id = 'recording-group-select';
    div.className = 'modal-overlay hidden';
    div.innerHTML = `
        <div class="modal-content recording-group-modal">
            <div class="modal-header">
                <h2>Select Groups</h2>
                <button class="modal-close" id="close-group-select">&times;</button>
            </div>

            <div class="modal-body">
                <p class="group-select-hint">
                    Choose which groups can view this recording.
                    This cannot be changed after recording starts.
                </p>

                <div id="recording-groups-list" class="upload-groups-list">
                    <div class="loading-spinner"></div>
                </div>

                <p id="no-groups-warning" class="error-text hidden">
                    You need to create or join a group first.
                </p>
            </div>

            <div class="modal-footer">
                <button id="start-recording-btn" class="btn btn-primary btn-full" disabled>
                    Start Recording
                </button>
            </div>
        </div>
    `;
    return div;
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
 * Load and render groups as checkboxes
 */
async function loadGroups() {
    const listEl = document.getElementById('recording-groups-list');
    const warningEl = document.getElementById('no-groups-warning');
    const startBtn = document.getElementById('start-recording-btn');

    const { encryptionKey } = getAuthState();

    if (!encryptionKey) {
        listEl.innerHTML = '<p class="muted">Login required</p>';
        return;
    }

    try {
        const groups = await getMyGroups();

        if (groups.length === 0) {
            listEl.innerHTML = '';
            warningEl.classList.remove('hidden');
            startBtn.disabled = true;
            return;
        }

        warningEl.classList.add('hidden');

        listEl.innerHTML = groups.map(g => `
            <label class="group-checkbox">
                <input type="checkbox"
                       class="group-check-input"
                       value="${g.groupId}"
                       data-group-name="${escapeHtml(g.name)}">
                <span class="group-check-label">${escapeHtml(g.name)}</span>
                <span class="group-check-meta">${g.isCreator ? 'Creator' : 'Member'}</span>
            </label>
        `).join('');

        // Enable start button when at least one group selected
        const checkboxes = listEl.querySelectorAll('.group-check-input');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const anyChecked = [...checkboxes].some(c => c.checked);
                startBtn.disabled = !anyChecked;
            });
        });

    } catch (err) {
        listEl.innerHTML = `<p class="error-text">Error: ${err.message}</p>`;
    }
}

/**
 * Get selected group IDs
 */
function getSelectedGroupIds() {
    const checkboxes = document.querySelectorAll('#recording-groups-list .group-check-input:checked');
    return [...checkboxes].map(cb => cb.value);
}

/**
 * Show the group selection modal
 * @param {Function} onConfirm - Called with array of selected group IDs when user clicks Start
 * @returns {Promise<void>}
 */
export async function showRecordingGroupSelect(onConfirm) {
    onConfirmCallback = onConfirm;

    if (!modal) {
        modal = createModal();
        document.body.appendChild(modal);

        // Close button
        document.getElementById('close-group-select').addEventListener('click', hideRecordingGroupSelect);

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideRecordingGroupSelect();
        });

        // Start recording button
        document.getElementById('start-recording-btn').addEventListener('click', () => {
            const selectedIds = getSelectedGroupIds();
            if (selectedIds.length > 0 && onConfirmCallback) {
                hideRecordingGroupSelect();
                onConfirmCallback(selectedIds);
            }
        });
    }

    modal.classList.remove('hidden');
    await loadGroups();
}

/**
 * Hide the modal
 */
export function hideRecordingGroupSelect() {
    if (modal) {
        modal.classList.add('hidden');
    }
}
