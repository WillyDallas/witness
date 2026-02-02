/**
 * Settings Modal
 * Allows user to configure persistent default groups for recording.
 */

import { getAuthState } from '../lib/authState.js';
import { getMyGroups } from '../lib/groups.js';
import { getDefaultGroupIds, setDefaultGroupIds } from '../lib/settingsStorage.js';
import { showGroupsModal } from './groupsModal.js';

let modal = null;
let onCloseCallback = null;

/**
 * Create the modal HTML
 */
function createModal() {
    const div = document.createElement('div');
    div.id = 'settings-modal';
    div.className = 'modal-overlay hidden';
    div.innerHTML = `
        <div class="modal-content settings-modal">
            <div class="modal-header">
                <h2>Settings</h2>
                <button class="modal-close" id="close-settings">&times;</button>
            </div>

            <div class="modal-body">
                <section class="settings-section">
                    <h3>Default Recording Groups</h3>
                    <p class="settings-hint">
                        Select which groups automatically receive your recordings.
                        You can record instantly without choosing groups each time.
                    </p>

                    <div id="settings-groups-list" class="upload-groups-list">
                        <div class="loading-spinner"></div>
                    </div>

                    <p id="settings-no-groups" class="muted hidden">
                        No groups yet. <a href="#" id="settings-create-group">Create one</a>
                    </p>
                </section>
            </div>

            <div class="modal-footer">
                <button id="save-settings-btn" class="btn btn-primary btn-full">
                    Save Settings
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
 * Load and render groups as checkboxes with current defaults checked
 */
async function loadGroups() {
    const listEl = document.getElementById('settings-groups-list');
    const noGroupsEl = document.getElementById('settings-no-groups');

    const { encryptionKey } = getAuthState();

    if (!encryptionKey) {
        listEl.innerHTML = '<p class="muted">Login required</p>';
        return;
    }

    try {
        const groups = await getMyGroups();
        const defaultIds = getDefaultGroupIds();

        if (groups.length === 0) {
            listEl.innerHTML = '';
            noGroupsEl.classList.remove('hidden');
            return;
        }

        noGroupsEl.classList.add('hidden');

        listEl.innerHTML = groups.map(g => `
            <label class="group-checkbox">
                <input type="checkbox"
                       class="settings-group-check"
                       value="${g.groupId}"
                       ${defaultIds.includes(g.groupId) ? 'checked' : ''}>
                <span class="group-check-label">${escapeHtml(g.name)}</span>
                <span class="group-check-meta">${g.isCreator ? 'Creator' : 'Member'}</span>
            </label>
        `).join('');

    } catch (err) {
        listEl.innerHTML = `<p class="error-text">Error: ${err.message}</p>`;
    }
}

/**
 * Get selected group IDs from checkboxes
 */
function getSelectedGroupIds() {
    const checkboxes = document.querySelectorAll('.settings-group-check:checked');
    return [...checkboxes].map(cb => cb.value);
}

/**
 * Handle save button click
 */
function handleSave() {
    const selectedIds = getSelectedGroupIds();
    setDefaultGroupIds(selectedIds);
    hideSettingsModal();
}

/**
 * Show the settings modal
 */
export async function showSettingsModal(options = {}) {
    onCloseCallback = options.onClose || null;

    if (!modal) {
        modal = createModal();
        document.body.appendChild(modal);

        // Close button
        document.getElementById('close-settings').addEventListener('click', hideSettingsModal);

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideSettingsModal();
        });

        // Save button
        document.getElementById('save-settings-btn').addEventListener('click', handleSave);

        // Create group link
        const createGroupLink = document.getElementById('settings-create-group');
        if (createGroupLink) {
            createGroupLink.addEventListener('click', (e) => {
                e.preventDefault();
                hideSettingsModal();
                showGroupsModal();
            });
        }
    }

    modal.classList.remove('hidden');
    await loadGroups();
}

/**
 * Hide the settings modal
 */
export function hideSettingsModal() {
    if (modal) {
        modal.classList.add('hidden');
    }
    if (onCloseCallback) {
        onCloseCallback();
    }
}
