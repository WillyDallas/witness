/**
 * Groups Modal UI for Witness Protocol
 * Displays user's groups and allows creating new ones
 */

import { getAuthState } from '../lib/authState.js';
import { getMyGroups, createNewGroup, generateInviteData } from '../lib/groups.js';
import { generateQRDataURL } from '../lib/qrcode.js';

let modal = null;
let currentView = 'list'; // 'list' | 'create' | 'invite'
let selectedGroupId = null;
let onCloseCallback = null;

/**
 * Create the modal HTML structure
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'groups-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content groups-modal">
      <div class="modal-header">
        <button class="modal-back hidden" id="groups-back">←</button>
        <h2 id="groups-title">My Groups</h2>
        <button class="modal-close" id="groups-close">&times;</button>
      </div>

      <div class="modal-body">
        <!-- List View -->
        <div id="groups-view-list" class="groups-view">
          <div id="groups-list" class="groups-list"></div>
          <div class="groups-actions">
            <button id="create-group-btn" class="btn btn-primary btn-full">
              + Create Group
            </button>
            <button id="scan-join-btn" class="btn btn-secondary btn-full">
              📷 Scan to Join
            </button>
          </div>
        </div>

        <!-- Create View -->
        <div id="groups-view-create" class="groups-view hidden">
          <p class="groups-instruction">Enter a name for your group</p>
          <input
            type="text"
            id="group-name-input"
            class="text-input"
            placeholder="Family Safety, Work Team, etc."
            maxlength="50"
          />
          <button id="confirm-create-btn" class="btn btn-primary btn-full">
            Create Group
          </button>
          <p id="create-error" class="error-text hidden"></p>
          <p id="create-status" class="status-text hidden"></p>
        </div>

        <!-- Invite View (QR Code) -->
        <div id="groups-view-invite" class="groups-view hidden">
          <p class="groups-instruction">Share this QR code to invite members</p>
          <div class="qr-container">
            <img id="invite-qr-image" class="qr-image" alt="Group invite QR code" />
          </div>
          <p id="invite-group-name" class="invite-group-name"></p>
          <p class="invite-hint">Anyone who scans this can join and view videos shared with this group</p>
          <button id="done-invite-btn" class="btn btn-primary btn-full">
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

  document.getElementById('groups-view-list').classList.toggle('hidden', view !== 'list');
  document.getElementById('groups-view-create').classList.toggle('hidden', view !== 'create');
  document.getElementById('groups-view-invite').classList.toggle('hidden', view !== 'invite');

  const backBtn = document.getElementById('groups-back');
  const title = document.getElementById('groups-title');

  backBtn.classList.toggle('hidden', view === 'list');

  switch (view) {
    case 'list':
      title.textContent = 'My Groups';
      break;
    case 'create':
      title.textContent = 'Create Group';
      document.getElementById('group-name-input').value = '';
      document.getElementById('create-error').classList.add('hidden');
      document.getElementById('create-status').classList.add('hidden');
      break;
    case 'invite':
      title.textContent = 'Invite Members';
      break;
  }
}

/**
 * Load and render the groups list
 */
async function loadGroupsList() {
  const list = document.getElementById('groups-list');
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    list.innerHTML = '<p class="muted">Login to view groups</p>';
    return;
  }

  try {
    const groups = await getMyGroups();

    if (groups.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <p class="muted">No groups yet</p>
          <p class="muted-small">Create a group or scan an invite to get started</p>
        </div>
      `;
      return;
    }

    list.innerHTML = groups.map(g => `
      <div class="group-item" data-group-id="${g.groupId}">
        <div class="group-info">
          <span class="group-name">${escapeHtml(g.name)}</span>
          <span class="group-meta">${g.isCreator ? 'Created by you' : 'Member'}</span>
        </div>
        <button class="group-share-btn" data-group-id="${g.groupId}" title="Share invite">
          📤
        </button>
      </div>
    `).join('');

    // Add click handlers for share buttons
    list.querySelectorAll('.group-share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const groupId = btn.dataset.groupId;
        showInviteView(groupId);
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

/**
 * Handle group creation
 */
async function handleCreateGroup() {
  const input = document.getElementById('group-name-input');
  const errorEl = document.getElementById('create-error');
  const statusEl = document.getElementById('create-status');
  const btn = document.getElementById('confirm-create-btn');

  const name = input.value.trim();

  if (!name) {
    errorEl.textContent = 'Please enter a group name';
    errorEl.classList.remove('hidden');
    return;
  }

  if (name.length < 2) {
    errorEl.textContent = 'Group name must be at least 2 characters';
    errorEl.classList.remove('hidden');
    return;
  }

  // Disable button during creation
  btn.disabled = true;
  btn.textContent = 'Creating...';
  errorEl.classList.add('hidden');
  statusEl.textContent = 'Submitting transaction...';
  statusEl.classList.remove('hidden');

  try {
    // Get provider and EOA address for identity commitment
    const { provider, wallet } = getAuthState();
    if (!provider || !wallet?.address) {
      throw new Error('Wallet not ready');
    }

    const { groupId } = await createNewGroup(name, provider, wallet.address);

    statusEl.textContent = 'Group created!';

    // Show invite view after short delay
    setTimeout(() => {
      showInviteView(groupId);
    }, 500);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
    statusEl.classList.add('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Group';
  }
}

/**
 * Show the invite QR code view
 */
async function showInviteView(groupId) {
  selectedGroupId = groupId;
  showView('invite');

  const qrImage = document.getElementById('invite-qr-image');
  const groupNameEl = document.getElementById('invite-group-name');

  qrImage.src = '';
  groupNameEl.textContent = 'Loading...';

  try {
    const invite = await generateInviteData(groupId);
    const qrDataUrl = await generateQRDataURL(invite, { width: 280 });

    qrImage.src = qrDataUrl;
    groupNameEl.textContent = invite.groupName;
  } catch (err) {
    groupNameEl.textContent = 'Error: ' + err.message;
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
 * Show the groups modal
 */
export function showGroupsModal(options = {}) {
  onCloseCallback = options.onClose || null;

  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('groups-close').addEventListener('click', hideGroupsModal);
    document.getElementById('groups-back').addEventListener('click', () => showView('list'));
    document.getElementById('create-group-btn').addEventListener('click', () => showView('create'));
    document.getElementById('confirm-create-btn').addEventListener('click', handleCreateGroup);
    document.getElementById('done-invite-btn').addEventListener('click', () => {
      showView('list');
      loadGroupsList();
    });

    // Scan button - will be wired to scanner modal
    document.getElementById('scan-join-btn').addEventListener('click', () => {
      // Import dynamically to avoid circular deps
      import('./qrScannerModal.js').then(({ showQRScannerModal }) => {
        hideGroupsModal();
        showQRScannerModal();
      });
    });

    // Enter key to submit
    document.getElementById('group-name-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleCreateGroup();
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideGroupsModal();
    });
  }

  showView('list');
  loadGroupsList();
  modal.classList.remove('hidden');
}

/**
 * Hide the groups modal
 */
export function hideGroupsModal() {
  if (modal) {
    modal.classList.add('hidden');
  }
  if (onCloseCallback) {
    onCloseCallback();
  }
}

/**
 * Refresh the groups list (called after joining)
 */
export function refreshGroupsList() {
  if (modal && currentView === 'list') {
    loadGroupsList();
  }
}
