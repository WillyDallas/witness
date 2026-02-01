# Phase 4: Group Creation & Joining Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to create groups, share invites via QR codes, and join groups to share encrypted content with trusted contacts.

**Architecture:** Build on existing contract.js (which already has `createGroup` and `joinGroup` functions) and storage.js (which already has group secret storage). Add a groups service for orchestrating group operations, UI modals for group management, and QR code generation/scanning for invites.

**Tech Stack:** html5-qrcode (scanning), qrcode (generation), existing contract.js, existing storage.js

---

## Documentation Verification (Context7 Research)

**Verified against html5-qrcode** (`/mebjas/html5-qrcode` - 47 snippets, Benchmark 82.2):

| Feature | Verification | Source |
|---------|--------------|--------|
| Camera scanning | ✅ `new Html5Qrcode(elementId)` with `start({ facingMode: "environment" })` | [html5-qrcode docs](https://github.com/mebjas/html5-qrcode) |
| Config options | ✅ `{ fps: 10, qrbox: { width: 250, height: 250 } }` | Context7 examples |
| Stop scanning | ✅ `html5QrCode.stop().then(() => html5QrCode.clear())` | Context7 examples |
| Success callback | ✅ `onScanSuccess(decodedText, decodedResult)` | Context7 examples |

**QR Code Generation Options:**
- **qrcode** npm package - Simple, generates to canvas/data URL
- **qr-code-generator** (nayuki) - High quality, outputs SVG, more control

**Key Implementation Notes:**
- html5-qrcode requires a DOM element ID to render into
- Camera access requires HTTPS or localhost
- Stop scanner when modal closes to release camera
- QR data should be JSON stringified for structured invites

---

## Prerequisites

- Phase 1 complete (Privy auth + smart account)
- Phase 2 complete (contract deployed with createGroup/joinGroup)
- Phase 3 complete (storage.js with group secret storage)

## Current State Analysis

**Already Implemented:**
- `contract.js`: `createGroup(groupId)`, `joinGroup(groupId)`, `isGroupMember()`, `getGroup()`
- `storage.js`: `setGroupSecret()`, `getGroupSecret()`, `getGroupSecrets()`
- `encryption.js`: `generateGroupSecret()`, `deriveGroupId()`, `bytesToHex()`, `hexToBytes()`

**Missing (this phase):**
- Groups service (orchestrates create/join flows)
- Groups UI modal (list, create, view QR)
- QR Scanner modal (scan to join)
- Navigation to groups from drawer

---

### Task 1: Install QR Code Dependencies

**Files:**
- Modify: `witness-pwa/package.json`

**Step 1: Install html5-qrcode for scanning and qrcode for generation**

```bash
cd witness-pwa && npm install html5-qrcode qrcode
```

**Step 2: Verify installation**

```bash
npm ls html5-qrcode qrcode
```

Expected: Both packages listed without errors.

**Step 3: Commit**

```bash
git add witness-pwa/package.json witness-pwa/package-lock.json
git commit -m "chore: add QR code dependencies (html5-qrcode, qrcode)"
```

---

### Task 2: Create Groups Service

**Files:**
- Create: `witness-pwa/src/lib/groups.js`

**Step 1: Write the groups service**

```javascript
/**
 * Groups Service for Witness Protocol
 * Orchestrates group creation, joining, and invite management
 */

import { generateGroupSecret, deriveGroupId, bytesToHex, hexToBytes } from './encryption.js';
import { createGroup as contractCreateGroup, joinGroup as contractJoinGroup, waitForTransaction, isGroupMember, getGroup } from './contract.js';
import { setGroupSecret, getGroupSecrets, getGroupSecret } from './storage.js';
import { getAuthState } from './authState.js';

// Chain configuration
const CHAIN_ID = import.meta.env.VITE_CHAIN_ID || 84532;
const REGISTRY_ADDRESS = import.meta.env.VITE_WITNESS_REGISTRY_ADDRESS;

/**
 * @typedef {Object} GroupInvite
 * @property {string} groupId - Group ID (bytes32 hex)
 * @property {string} groupSecret - Group secret as hex string
 * @property {string} groupName - Human-readable group name
 * @property {number} chainId - Chain ID for verification
 * @property {string} registryAddress - Contract address for verification
 * @property {number} version - Invite format version
 */

/**
 * Create a new group
 * @param {string} name - Human-readable group name
 * @returns {Promise<{groupId: string, txHash: string}>}
 */
export async function createNewGroup(name) {
  const { encryptionKey, smartAccountAddress } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated - encryption key required');
  }

  if (!smartAccountAddress) {
    throw new Error('Smart account not initialized');
  }

  // Generate random group secret
  const secret = generateGroupSecret();
  const groupId = await deriveGroupId(secret);

  console.log('[groups] Creating group:', name, groupId.slice(0, 18) + '...');

  // Submit on-chain transaction
  const txHash = await contractCreateGroup(groupId);
  console.log('[groups] Waiting for confirmation...');

  // Wait for confirmation
  await waitForTransaction(txHash);

  // Store secret locally (encrypted)
  await setGroupSecret(groupId, secret, name, true, encryptionKey);

  console.log('[groups] Group created successfully');

  return { groupId, txHash };
}

/**
 * Join an existing group from invite
 * @param {GroupInvite} invite - Parsed invite data
 * @returns {Promise<{txHash: string}>}
 */
export async function joinGroupFromInvite(invite) {
  const { encryptionKey, smartAccountAddress } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated - encryption key required');
  }

  if (!smartAccountAddress) {
    throw new Error('Smart account not initialized');
  }

  // Validate invite
  if (invite.chainId !== Number(CHAIN_ID)) {
    throw new Error(`Wrong network. Expected chain ${CHAIN_ID}, got ${invite.chainId}`);
  }

  if (invite.registryAddress.toLowerCase() !== REGISTRY_ADDRESS.toLowerCase()) {
    throw new Error('Invalid registry address in invite');
  }

  // Check if already a member
  const alreadyMember = await isGroupMember(invite.groupId, smartAccountAddress);
  if (alreadyMember) {
    throw new Error('You are already a member of this group');
  }

  // Verify group exists on-chain
  const group = await getGroup(invite.groupId);
  if (!group.active) {
    throw new Error('Group does not exist or is inactive');
  }

  console.log('[groups] Joining group:', invite.groupName);

  // Submit on-chain transaction
  const txHash = await contractJoinGroup(invite.groupId);
  console.log('[groups] Waiting for confirmation...');

  // Wait for confirmation
  await waitForTransaction(txHash);

  // Store secret locally (encrypted)
  const secretBytes = hexToBytes(invite.groupSecret);
  await setGroupSecret(invite.groupId, secretBytes, invite.groupName, false, encryptionKey);

  console.log('[groups] Joined group successfully');

  return { txHash };
}

/**
 * Generate invite data for a group
 * @param {string} groupId - Group ID to generate invite for
 * @returns {Promise<GroupInvite>}
 */
export async function generateInviteData(groupId) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  // Get stored group data
  const secrets = await getGroupSecrets(encryptionKey);
  const groupData = secrets[groupId];

  if (!groupData) {
    throw new Error('Group not found in local storage');
  }

  if (!groupData.isCreator) {
    // For now, only creators can share. Could expand later.
    console.warn('[groups] Non-creator sharing group invite');
  }

  return {
    groupId: groupData.groupId,
    groupSecret: groupData.secretHex,
    groupName: groupData.name,
    chainId: Number(CHAIN_ID),
    registryAddress: REGISTRY_ADDRESS,
    version: 1,
  };
}

/**
 * Parse QR code data into GroupInvite
 * @param {string} qrData - Raw QR code string (JSON)
 * @returns {GroupInvite}
 */
export function parseInviteQR(qrData) {
  try {
    const invite = JSON.parse(qrData);

    // Validate required fields
    if (!invite.groupId || !invite.groupSecret || !invite.groupName) {
      throw new Error('Invalid invite: missing required fields');
    }

    if (!invite.chainId || !invite.registryAddress) {
      throw new Error('Invalid invite: missing network info');
    }

    // Validate groupId format (bytes32 hex)
    if (!/^0x[a-fA-F0-9]{64}$/.test(invite.groupId)) {
      throw new Error('Invalid invite: malformed groupId');
    }

    // Validate groupSecret format (64 hex chars)
    if (!/^[a-fA-F0-9]{64}$/.test(invite.groupSecret)) {
      throw new Error('Invalid invite: malformed groupSecret');
    }

    return invite;
  } catch (err) {
    if (err.message.startsWith('Invalid invite')) {
      throw err;
    }
    throw new Error('Invalid QR code: not a valid group invite');
  }
}

/**
 * Get all groups the user is a member of
 * @returns {Promise<Array<{groupId: string, name: string, isCreator: boolean, createdAt: string}>>}
 */
export async function getMyGroups() {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    return [];
  }

  const secrets = await getGroupSecrets(encryptionKey);
  return Object.values(secrets).map(s => ({
    groupId: s.groupId,
    name: s.name,
    isCreator: s.isCreator,
    createdAt: s.createdAt,
  }));
}
```

**Step 2: Verify imports work**

Run dev server and check console for import errors:
```bash
cd witness-pwa && npm run dev
```

Open browser console, verify no errors related to groups.js.

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/groups.js
git commit -m "feat(groups): add groups service for create/join orchestration"
```

---

### Task 3: Create QR Code Generation Utility

**Files:**
- Create: `witness-pwa/src/lib/qrcode.js`

**Step 1: Write the QR code utility**

```javascript
/**
 * QR Code utilities for Witness Protocol
 * Handles QR code generation for group invites
 */

import QRCode from 'qrcode';

/**
 * Generate QR code as data URL
 * @param {object} data - Data to encode (will be JSON stringified)
 * @param {object} options - QR code options
 * @returns {Promise<string>} Data URL (base64 PNG)
 */
export async function generateQRDataURL(data, options = {}) {
  const jsonStr = JSON.stringify(data);

  const defaultOptions = {
    errorCorrectionLevel: 'M',
    type: 'image/png',
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  };

  const qrOptions = { ...defaultOptions, ...options };

  try {
    const dataUrl = await QRCode.toDataURL(jsonStr, qrOptions);
    return dataUrl;
  } catch (err) {
    console.error('[qrcode] Generation failed:', err);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Generate QR code to a canvas element
 * @param {HTMLCanvasElement} canvas - Canvas element to draw on
 * @param {object} data - Data to encode
 * @param {object} options - QR code options
 */
export async function generateQRToCanvas(canvas, data, options = {}) {
  const jsonStr = JSON.stringify(data);

  const defaultOptions = {
    errorCorrectionLevel: 'M',
    width: 256,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  };

  const qrOptions = { ...defaultOptions, ...options };

  try {
    await QRCode.toCanvas(canvas, jsonStr, qrOptions);
  } catch (err) {
    console.error('[qrcode] Canvas generation failed:', err);
    throw new Error('Failed to generate QR code');
  }
}
```

**Step 2: Verify in browser console**

```javascript
import { generateQRDataURL } from './src/lib/qrcode.js';
const testData = { test: 'hello', value: 123 };
const url = await generateQRDataURL(testData);
console.log('QR URL starts with data:image/png:', url.startsWith('data:image/png'));
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/qrcode.js
git commit -m "feat(qrcode): add QR code generation utility"
```

---

### Task 4: Create Groups Modal UI

**Files:**
- Create: `witness-pwa/src/ui/groupsModal.js`

**Step 1: Write the groups modal**

```javascript
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
    const { groupId } = await createNewGroup(name);

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
export function showGroupsModal() {
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
}

/**
 * Refresh the groups list (called after joining)
 */
export function refreshGroupsList() {
  if (modal && currentView === 'list') {
    loadGroupsList();
  }
}
```

**Step 2: Verify modal creates without errors**

In browser console:
```javascript
import { showGroupsModal } from './src/ui/groupsModal.js';
showGroupsModal();
```

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/groupsModal.js
git commit -m "feat(ui): add groups modal for listing and creating groups"
```

---

### Task 5: Create QR Scanner Modal

**Files:**
- Create: `witness-pwa/src/ui/qrScannerModal.js`

**Step 1: Write the QR scanner modal**

```javascript
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
```

**Step 2: Verify scanner modal creates**

In browser console:
```javascript
import { showQRScannerModal } from './src/ui/qrScannerModal.js';
showQRScannerModal();
// Should show camera permission prompt
```

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/qrScannerModal.js
git commit -m "feat(ui): add QR scanner modal for joining groups"
```

---

### Task 6: Add CSS Styles for Groups UI

**Files:**
- Modify: `witness-pwa/styles.css`

**Step 1: Add groups modal styles**

Append to the end of `witness-pwa/styles.css`:

```css
/* ============================================
   Groups Modal
============================================ */

.groups-modal {
  max-width: 400px;
}

.groups-view {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.groups-list {
  max-height: 300px;
  overflow-y: auto;
}

.group-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: var(--bg-surface);
  border-radius: 8px;
  margin-bottom: 0.5rem;
}

.group-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.group-name {
  font-weight: 500;
}

.group-meta {
  font-size: 0.8rem;
  color: var(--text-muted);
}

.group-share-btn {
  background: none;
  border: none;
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background 0.2s;
}

.group-share-btn:hover {
  background: var(--bg-surface-hover);
}

.groups-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
}

.groups-instruction {
  color: var(--text-muted);
  text-align: center;
  margin-bottom: 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
}

.muted-small {
  font-size: 0.8rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

/* QR Code Display */
.qr-container {
  display: flex;
  justify-content: center;
  padding: 1rem;
  background: #fff;
  border-radius: 12px;
  margin: 1rem 0;
}

.qr-image {
  width: 280px;
  height: 280px;
}

.invite-group-name {
  text-align: center;
  font-weight: 600;
  font-size: 1.1rem;
}

.invite-hint {
  text-align: center;
  font-size: 0.85rem;
  color: var(--text-muted);
  margin: 0.5rem 0 1rem;
}

/* ============================================
   QR Scanner Modal
============================================ */

.qr-scanner-modal {
  max-width: 400px;
}

.scanner-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.qr-reader {
  width: 100%;
  max-width: 300px;
  border-radius: 12px;
  overflow: hidden;
}

.qr-reader video {
  border-radius: 12px;
}

.scan-status {
  color: var(--text-muted);
  text-align: center;
}

/* Confirm Join View */
.confirm-invite {
  text-align: center;
  padding: 1rem;
  background: var(--bg-surface);
  border-radius: 12px;
  width: 100%;
}

.confirm-label {
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.confirm-group-name {
  font-size: 1.3rem;
  font-weight: 600;
}

.confirm-info {
  color: var(--text-muted);
  margin-top: 1rem;
}

.confirm-list {
  color: var(--text-muted);
  margin: 0.5rem 0 1rem 1.5rem;
  font-size: 0.9rem;
}

.confirm-list li {
  margin-bottom: 0.25rem;
}

/* Joining View */
.joining-spinner {
  padding: 2rem;
}

.joining-status {
  color: var(--text-muted);
}

/* Success View */
.success-icon {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}

.success-text {
  font-size: 1.2rem;
  font-weight: 500;
  margin-bottom: 0.25rem;
}

.success-group-name {
  color: var(--text-muted);
  margin-bottom: 1.5rem;
}

/* Modal Back Button */
.modal-back {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--text-light);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  margin-right: 0.5rem;
}

.modal-back:hover {
  opacity: 0.7;
}

/* Button variants */
.btn-secondary {
  background: var(--bg-surface);
  color: var(--text-light);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-surface-hover);
}

.btn-full {
  width: 100%;
}
```

**Step 2: Verify styles apply**

```bash
cd witness-pwa && npm run dev
```

Open browser, import and show groups modal - verify styling looks correct.

**Step 3: Commit**

```bash
git add witness-pwa/styles.css
git commit -m "style: add groups and QR scanner modal styles"
```

---

### Task 7: Wire Up Groups Button in Drawer

**Files:**
- Modify: `witness-pwa/index.html`
- Modify: `witness-pwa/src/main.js`

**Step 1: Add groups button to drawer**

In `witness-pwa/index.html`, find the drawer footer section (around line 137) and add a groups button:

```html
<div class="drawer-footer">
    <button id="groups-btn" class="btn btn-link">
        👥 My Groups
    </button>
    <button id="logout-btn" class="btn btn-link btn-logout">
        Sign Out
    </button>
</div>
```

**Step 2: Wire up the groups button in main.js**

In `witness-pwa/src/main.js`, add the import at the top with other imports:

```javascript
import { showGroupsModal } from './ui/groupsModal.js';
```

Then add the event listener after the existing drawer event listeners (around line 548):

```javascript
// Groups button handler
const groupsBtn = document.getElementById('groups-btn');
if (groupsBtn) {
  groupsBtn.addEventListener('click', () => {
    closeDrawer();
    showGroupsModal();
  });
}
```

**Step 3: Verify integration**

1. Run `npm run dev`
2. Login with Privy
3. Open the drawer
4. Tap "👥 My Groups"
5. Verify groups modal opens
6. Verify "Create Group" button works
7. Verify "Scan to Join" opens scanner modal

**Step 4: Commit**

```bash
git add witness-pwa/index.html witness-pwa/src/main.js
git commit -m "feat: wire up groups button in drawer"
```

---

### Task 8: Integration Test - Full Flow

**Files:** None (manual testing)

**Step 1: Test group creation**

1. Clear browser data (localStorage, sessionStorage)
2. Run `npm run dev`
3. Login with email
4. Open drawer → "My Groups"
5. Tap "Create Group"
6. Enter name "Test Family"
7. Tap "Create Group"
8. Wait for transaction confirmation
9. Verify QR code appears
10. Tap "Done"
11. Verify group appears in list

**Step 2: Test QR generation**

1. Tap the share button (📤) on the created group
2. Verify QR code loads
3. Screenshot the QR code (for testing join flow)

**Step 3: Test group persistence**

1. Refresh the page
2. Login again (should restore session)
3. Open groups modal
4. Verify "Test Family" group is still listed

**Step 4: Test QR scanning (requires second device or browser)**

1. On second device/browser, login
2. Open groups modal
3. Tap "Scan to Join"
4. Allow camera access
5. Scan the QR code from step 2
6. Verify confirmation shows "Test Family"
7. Tap "Join Group"
8. Wait for transaction confirmation
9. Verify success message
10. Verify group appears in list on second device

**Step 5: Document any issues found**

If issues found, create tasks to fix them before proceeding.

---

### Task 9: Build and Deploy

**Files:** None (commands only)

**Step 1: Build for production**

```bash
cd witness-pwa && npm run build
```

Verify no build errors.

**Step 2: Test production build locally**

```bash
npm run preview
```

Open http://localhost:4173, verify groups functionality works.

**Step 3: Deploy to production**

```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

**Step 4: Verify production deployment**

1. Open https://witness.squirrlabs.xyz
2. Login
3. Create a group
4. Verify QR code generation works
5. Test join flow on another device

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: phase 4 complete - group creation and joining"
```

---

## Acceptance Criteria Checklist

- [ ] User can create a group with a name
- [ ] Group creation is gasless (via paymaster)
- [ ] QR code displays with invite data
- [ ] QR code contains: groupId, groupSecret, groupName, chainId, registryAddress
- [ ] Second device can scan QR and parse invite
- [ ] Second device can join group (gasless)
- [ ] Both devices show group in their list
- [ ] Group secrets stored locally and persist across refreshes
- [ ] Production deployment verified

---

## Notes

**Existing Implementation Leveraged:**
- `contract.js` already had `createGroup(groupId)` and `joinGroup(groupId)` functions
- `storage.js` already had `setGroupSecret()` and `getGroupSecret()` functions
- `encryption.js` already had `generateGroupSecret()` and `deriveGroupId()` functions

**What This Phase Added:**
- Groups service for orchestrating create/join flows
- QR code generation utility
- Groups modal UI (list, create, invite views)
- QR scanner modal for joining groups
- CSS styles for new UI components
- Drawer integration

**Semaphore Integration (Deferred):**
The original plan mentions Semaphore for anonymous attestations. This is deferred to Phase 7 as specified in the architecture document. The current implementation uses address-based group membership which is sufficient for the hackathon demo.

**Security Considerations:**
- Group secrets are encrypted at rest using the user's personal encryption key
- QR invite data includes chain ID and registry address for cross-chain protection
- Join flow validates group exists on-chain before storing secret locally
