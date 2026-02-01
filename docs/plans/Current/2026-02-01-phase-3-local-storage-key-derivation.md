# Phase 3: Local Storage & Key Derivation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add secure storage for group secrets and implement key wrapping for multi-group content encryption.

**Architecture:** Build on existing encryption.js (which already handles personal key derivation with session persistence). Add a storage service for group secrets using localStorage with an encryption layer. Implement key wrapping so content can be encrypted once but decryptable by multiple groups.

**Tech Stack:** Web Crypto API (AES-256-GCM, HKDF), localStorage, existing encryption.js

---

## Documentation Verification (Context7 Research)

**Verified against MDN Web Docs** (`/mdn/content` - 46,626 snippets, Benchmark 92.3):

| API Function | Verification | Source |
|--------------|--------------|--------|
| `crypto.subtle.generateKey()` | ✅ `{ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]` | [MDN generateKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/generateKey) |
| `crypto.subtle.importKey()` | ✅ `"raw", keyData, "HKDF", false, ["deriveKey"]` | [MDN importKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/importKey) |
| `crypto.subtle.deriveKey()` | ✅ HKDF with `{ name: "HKDF", salt, info, hash: "SHA-256" }` | [MDN deriveKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey) |
| `crypto.subtle.wrapKey()` | ✅ `"raw", contentKey, groupKey, { name: "AES-GCM", iv }` | [MDN wrapKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/wrapKey) |
| `crypto.subtle.unwrapKey()` | ✅ 7-param signature with unwrapAlgo and unwrappedKeyAlgo | [MDN unwrapKey](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/unwrapKey) |

**Key Implementation Notes from MDN:**
- AES-GCM IV must be 12 bytes (`new Uint8Array(12)`)
- Wrapped key output = original key (32 bytes) + auth tag (16 bytes) = 48 bytes
- Content key must be `extractable: true` to allow wrapping
- Wrapping key needs `keyUsages: ["wrapKey", "unwrapKey"]`

---

## Prerequisites

- Phase 1 complete (Privy auth + smart account)
- encryption.js already has: `deriveEncryptionKey`, `encrypt`, `decrypt`, `sha256`, session caching

## Current State Analysis

**Already Implemented:**
- Personal key derivation from EIP-712 wallet signature
- AES-256-GCM encrypt/decrypt
- Session persistence (cached signature in sessionStorage)
- SHA-256 hashing

**Missing (this phase):**
- Group secret generation
- Encrypted storage service for secrets
- Key wrapping/unwrapping for multi-group
- Test encryption UI

---

### Task 1: Add Group Secret Generation to encryption.js

**Files:**
- Modify: `witness-pwa/src/lib/encryption.js`

**Step 1: Write the group secret generation function**

Add after the existing `sha256` function (around line 206):

```javascript
// ============================================
// Group Secret Management
// ============================================

/**
 * Generate a random 32-byte group secret
 * @returns {Uint8Array} Random secret bytes
 */
export function generateGroupSecret() {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Derive group ID from group secret using SHA-256
 * Group ID = first 32 bytes of SHA-256(secret) as hex with 0x prefix
 * @param {Uint8Array} secret - Group secret bytes
 * @returns {Promise<string>} Group ID as bytes32 hex (0x-prefixed)
 */
export async function deriveGroupId(secret) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', secret);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Convert Uint8Array to hex string
 * @param {Uint8Array} bytes - Bytes to convert
 * @returns {string} Hex string without 0x prefix
 */
export function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Step 2: Verify in browser console**

Run dev server and test in console:
```bash
cd witness-pwa && npm run dev
```

Open browser console and test:
```javascript
import { generateGroupSecret, deriveGroupId, bytesToHex } from './src/lib/encryption.js';
const secret = generateGroupSecret();
console.log('Secret:', bytesToHex(secret));
const groupId = await deriveGroupId(secret);
console.log('Group ID:', groupId);
// Expected: Secret is 64 hex chars, Group ID is 0x + 64 hex chars
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/encryption.js
git commit -m "feat(encryption): add group secret generation and ID derivation"
```

---

### Task 2: Add Key Wrapping Functions to encryption.js

**Files:**
- Modify: `witness-pwa/src/lib/encryption.js`

**Step 1: Write key wrapping functions**

Add after the group secret functions:

```javascript
// ============================================
// Key Wrapping (for multi-group encryption)
// ============================================

/**
 * Derive an AES-256-GCM key from group secret for key wrapping
 * @param {Uint8Array} groupSecret - 32-byte group secret
 * @returns {Promise<CryptoKey>} AES-GCM key for wrapping
 */
async function deriveGroupKey(groupSecret) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    groupSecret,
    'HKDF',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt: new TextEncoder().encode('witness-protocol:group-key'),
      info: new TextEncoder().encode('AES-256-GCM-group-wrapping'),
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  );
}

/**
 * Wrap a content key with a group secret
 * Content is encrypted with a random key, then that key is wrapped for each group
 * @param {CryptoKey} contentKey - The key used to encrypt content
 * @param {Uint8Array} groupSecret - Group secret to wrap with
 * @returns {Promise<{iv: Uint8Array, wrappedKey: ArrayBuffer}>}
 */
export async function wrapContentKey(contentKey, groupSecret) {
  const groupKey = await deriveGroupKey(groupSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    contentKey,
    groupKey,
    { name: 'AES-GCM', iv }
  );

  return { iv, wrappedKey };
}

/**
 * Unwrap a content key using a group secret
 * @param {Uint8Array} iv - IV used during wrapping
 * @param {ArrayBuffer} wrappedKey - The wrapped key
 * @param {Uint8Array} groupSecret - Group secret to unwrap with
 * @returns {Promise<CryptoKey>} The unwrapped content key
 */
export async function unwrapContentKey(iv, wrappedKey, groupSecret) {
  const groupKey = await deriveGroupKey(groupSecret);

  return crypto.subtle.unwrapKey(
    'raw',
    wrappedKey,
    groupKey,
    { name: 'AES-GCM', iv },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Generate a random content key for encrypting media
 * @returns {Promise<CryptoKey>} Extractable AES-256-GCM key
 */
export async function generateContentKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // Extractable so we can wrap it
    ['encrypt', 'decrypt']
  );
}
```

**Step 2: Verify in browser console**

```javascript
import { generateGroupSecret, generateContentKey, wrapContentKey, unwrapContentKey, bytesToHex } from './src/lib/encryption.js';

// Generate a group secret
const secret = generateGroupSecret();

// Generate a content key
const contentKey = await generateContentKey();

// Wrap it
const { iv, wrappedKey } = await wrapContentKey(contentKey, secret);
console.log('Wrapped key length:', wrappedKey.byteLength); // Should be 48 bytes (32 key + 16 auth tag)

// Unwrap it
const unwrapped = await unwrapContentKey(iv, wrappedKey, secret);
console.log('Unwrap success:', unwrapped !== null);
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/encryption.js
git commit -m "feat(encryption): add key wrapping for multi-group content encryption"
```

---

### Task 3: Create Storage Service for Group Secrets

**Files:**
- Create: `witness-pwa/src/lib/storage.js`

**Step 1: Write the storage service**

```javascript
/**
 * Storage Service for Witness Protocol
 * Provides encrypted storage for sensitive data using the personal encryption key
 */

import { encrypt, decrypt, getOrDeriveEncryptionKey, hexToBytes, bytesToHex } from './encryption.js';

// Storage keys
const STORAGE_KEYS = {
  GROUP_SECRETS: 'witness_group_secrets',
  RECORDINGS_META: 'witness_recordings',
};

// ============================================
// Base Storage (unencrypted, for non-sensitive data)
// ============================================

/**
 * Get item from localStorage
 * @param {string} key - Storage key
 * @returns {any|null} Parsed value or null
 */
export function getItem(key) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Set item in localStorage
 * @param {string} key - Storage key
 * @param {any} value - Value to store (will be JSON stringified)
 */
export function setItem(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Remove item from localStorage
 * @param {string} key - Storage key
 */
export function removeItem(key) {
  localStorage.removeItem(key);
}

// ============================================
// Encrypted Storage (for sensitive data)
// ============================================

/**
 * Encrypt and store sensitive data
 * @param {string} key - Storage key
 * @param {any} value - Value to encrypt and store
 * @param {CryptoKey} encryptionKey - Personal encryption key
 */
export async function setSecureItem(key, value, encryptionKey) {
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const { iv, ciphertext } = await encrypt(plaintext, encryptionKey);

  // Store as base64-encoded object
  const stored = {
    iv: bytesToHex(iv),
    data: bytesToHex(new Uint8Array(ciphertext)),
  };

  localStorage.setItem(key, JSON.stringify(stored));
}

/**
 * Decrypt and retrieve sensitive data
 * @param {string} key - Storage key
 * @param {CryptoKey} encryptionKey - Personal encryption key
 * @returns {Promise<any|null>} Decrypted value or null
 */
export async function getSecureItem(key, encryptionKey) {
  try {
    const storedStr = localStorage.getItem(key);
    if (!storedStr) return null;

    const stored = JSON.parse(storedStr);
    const iv = hexToBytes(stored.iv);
    const ciphertext = hexToBytes(stored.data);

    const plaintext = await decrypt(iv, ciphertext.buffer, encryptionKey);
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (err) {
    console.error('[storage] Failed to decrypt:', err.message);
    return null;
  }
}

// ============================================
// Group Secrets Storage
// ============================================

/**
 * @typedef {Object} StoredGroupSecret
 * @property {string} groupId - Group ID (bytes32 hex)
 * @property {string} secretHex - Group secret as hex string
 * @property {string} name - Human-readable group name
 * @property {boolean} isCreator - Whether current user created this group
 * @property {string} createdAt - ISO timestamp
 */

/**
 * Get all stored group secrets
 * @param {CryptoKey} encryptionKey - Personal encryption key
 * @returns {Promise<Record<string, StoredGroupSecret>>} Map of groupId to secret data
 */
export async function getGroupSecrets(encryptionKey) {
  const secrets = await getSecureItem(STORAGE_KEYS.GROUP_SECRETS, encryptionKey);
  return secrets || {};
}

/**
 * Store a group secret
 * @param {string} groupId - Group ID
 * @param {Uint8Array} secret - Group secret bytes
 * @param {string} name - Group name
 * @param {boolean} isCreator - Whether user created this group
 * @param {CryptoKey} encryptionKey - Personal encryption key
 */
export async function setGroupSecret(groupId, secret, name, isCreator, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey);

  secrets[groupId] = {
    groupId,
    secretHex: bytesToHex(secret),
    name,
    isCreator,
    createdAt: new Date().toISOString(),
  };

  await setSecureItem(STORAGE_KEYS.GROUP_SECRETS, secrets, encryptionKey);
}

/**
 * Get a specific group secret as Uint8Array
 * @param {string} groupId - Group ID
 * @param {CryptoKey} encryptionKey - Personal encryption key
 * @returns {Promise<Uint8Array|null>} Group secret bytes or null
 */
export async function getGroupSecret(groupId, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey);
  const stored = secrets[groupId];
  if (!stored) return null;

  return hexToBytes(stored.secretHex);
}

/**
 * Remove a group secret
 * @param {string} groupId - Group ID to remove
 * @param {CryptoKey} encryptionKey - Personal encryption key
 */
export async function removeGroupSecret(groupId, encryptionKey) {
  const secrets = await getGroupSecrets(encryptionKey);
  delete secrets[groupId];
  await setSecureItem(STORAGE_KEYS.GROUP_SECRETS, secrets, encryptionKey);
}

/**
 * Clear all secure storage (for logout)
 */
export function clearSecureStorage() {
  localStorage.removeItem(STORAGE_KEYS.GROUP_SECRETS);
}
```

**Step 2: Export hexToBytes from encryption.js**

In `witness-pwa/src/lib/encryption.js`, find the `hexToBytes` function (around line 70) and add `export`:

```javascript
// Change from:
function hexToBytes(hex) {

// To:
export function hexToBytes(hex) {
```

**Step 3: Verify in browser console**

```javascript
import { getGroupSecrets, setGroupSecret, getGroupSecret } from './src/lib/storage.js';
import { generateGroupSecret, deriveGroupId, getOrDeriveEncryptionKey } from './src/lib/encryption.js';

// Need to be logged in first for encryption key
// Assuming you have provider and address from auth state
const encKey = /* get from authState */;

// Create and store a group secret
const secret = generateGroupSecret();
const groupId = await deriveGroupId(secret);
await setGroupSecret(groupId, secret, 'Test Group', true, encKey);

// Retrieve it
const retrieved = await getGroupSecret(groupId, encKey);
console.log('Retrieved matches:', retrieved.every((b, i) => b === secret[i]));
```

**Step 4: Commit**

```bash
git add witness-pwa/src/lib/storage.js witness-pwa/src/lib/encryption.js
git commit -m "feat(storage): add encrypted storage service for group secrets"
```

---

### Task 4: Create Encryption Test UI Component

**Files:**
- Create: `witness-pwa/src/ui/encryptionTest.js`
- Modify: `witness-pwa/index.html`

**Step 1: Write the encryption test modal**

```javascript
/**
 * Encryption Test UI for Witness Protocol
 * Allows testing encryption/decryption and viewing group secrets
 */

import { getAuthState } from '../lib/authState.js';
import { encrypt, decrypt, generateGroupSecret, deriveGroupId, bytesToHex } from '../lib/encryption.js';
import { getGroupSecrets, setGroupSecret, getGroupSecret } from '../lib/storage.js';

let modal = null;

/**
 * Create the encryption test modal HTML
 */
function createModal() {
  const div = document.createElement('div');
  div.id = 'encryption-test-modal';
  div.className = 'modal-overlay hidden';
  div.innerHTML = `
    <div class="modal-content encryption-test-modal">
      <div class="modal-header">
        <h2>Encryption Test</h2>
        <button class="modal-close" id="enc-test-close">&times;</button>
      </div>

      <div class="modal-body">
        <section class="test-section">
          <h3>Personal Key Status</h3>
          <p id="key-status">Checking...</p>
        </section>

        <section class="test-section">
          <h3>Test Encryption</h3>
          <input type="text" id="enc-test-input" placeholder="Enter text to encrypt" class="text-input" />
          <button id="enc-test-btn" class="primary-btn">Encrypt & Decrypt</button>
          <div id="enc-test-result" class="test-result hidden"></div>
        </section>

        <section class="test-section">
          <h3>Group Secrets</h3>
          <div id="group-secrets-list"></div>
          <button id="gen-group-btn" class="secondary-btn">Generate Test Group</button>
        </section>
      </div>
    </div>
  `;
  return div;
}

/**
 * Update key status display
 */
function updateKeyStatus() {
  const status = document.getElementById('key-status');
  const { encryptionKey } = getAuthState();

  if (encryptionKey) {
    status.innerHTML = '✅ Personal key derived and ready';
    status.className = 'status-success';
  } else {
    status.innerHTML = '❌ No encryption key (not authenticated)';
    status.className = 'status-error';
  }
}

/**
 * Run encrypt/decrypt test
 */
async function runEncryptTest() {
  const input = document.getElementById('enc-test-input');
  const result = document.getElementById('enc-test-result');
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    result.innerHTML = '❌ No encryption key available';
    result.className = 'test-result error';
    result.classList.remove('hidden');
    return;
  }

  const text = input.value.trim();
  if (!text) {
    result.innerHTML = '⚠️ Enter some text first';
    result.className = 'test-result warning';
    result.classList.remove('hidden');
    return;
  }

  try {
    // Encrypt
    const plaintext = new TextEncoder().encode(text);
    const { iv, ciphertext } = await encrypt(plaintext, encryptionKey);

    // Decrypt
    const decrypted = await decrypt(iv, ciphertext, encryptionKey);
    const decryptedText = new TextDecoder().decode(decrypted);

    // Display results
    const encHex = bytesToHex(new Uint8Array(ciphertext)).slice(0, 32) + '...';
    result.innerHTML = `
      <div class="result-row"><strong>Original:</strong> "${text}"</div>
      <div class="result-row"><strong>Encrypted:</strong> <code>${encHex}</code></div>
      <div class="result-row"><strong>Decrypted:</strong> "${decryptedText}"</div>
      <div class="result-row">${text === decryptedText ? '✅ Match!' : '❌ Mismatch!'}</div>
    `;
    result.className = 'test-result success';
  } catch (err) {
    result.innerHTML = `❌ Error: ${err.message}`;
    result.className = 'test-result error';
  }

  result.classList.remove('hidden');
}

/**
 * Load and display group secrets
 */
async function loadGroupSecrets() {
  const list = document.getElementById('group-secrets-list');
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    list.innerHTML = '<p class="muted">Login to view group secrets</p>';
    return;
  }

  try {
    const secrets = await getGroupSecrets(encryptionKey);
    const entries = Object.values(secrets);

    if (entries.length === 0) {
      list.innerHTML = '<p class="muted">No group secrets stored</p>';
      return;
    }

    list.innerHTML = entries.map(s => `
      <div class="group-secret-item">
        <strong>${s.name}</strong>
        <code>${s.groupId.slice(0, 18)}...</code>
        <span class="tag">${s.isCreator ? 'Creator' : 'Member'}</span>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = `<p class="error">Error: ${err.message}</p>`;
  }
}

/**
 * Generate a test group secret
 */
async function generateTestGroup() {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    alert('Please login first');
    return;
  }

  const secret = generateGroupSecret();
  const groupId = await deriveGroupId(secret);
  const name = `Test Group ${Date.now().toString(36)}`;

  await setGroupSecret(groupId, secret, name, true, encryptionKey);
  await loadGroupSecrets();
}

/**
 * Show the encryption test modal
 */
export function showEncryptionTest() {
  if (!modal) {
    modal = createModal();
    document.body.appendChild(modal);

    // Event listeners
    document.getElementById('enc-test-close').addEventListener('click', hideEncryptionTest);
    document.getElementById('enc-test-btn').addEventListener('click', runEncryptTest);
    document.getElementById('gen-group-btn').addEventListener('click', generateTestGroup);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) hideEncryptionTest();
    });
  }

  modal.classList.remove('hidden');
  updateKeyStatus();
  loadGroupSecrets();
}

/**
 * Hide the encryption test modal
 */
export function hideEncryptionTest() {
  if (modal) {
    modal.classList.add('hidden');
  }
}
```

**Step 2: Add CSS for the encryption test modal**

In `witness-pwa/src/style.css`, add after the existing modal styles:

```css
/* Encryption Test Modal */
.encryption-test-modal {
  max-width: 400px;
}

.test-section {
  margin-bottom: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid #333;
}

.test-section:last-child {
  border-bottom: none;
}

.test-section h3 {
  margin: 0 0 0.75rem 0;
  font-size: 0.9rem;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.text-input {
  width: 100%;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  background: #222;
  border: 1px solid #444;
  border-radius: 8px;
  color: #fff;
  font-size: 1rem;
}

.text-input:focus {
  outline: none;
  border-color: #4a9eff;
}

.primary-btn {
  width: 100%;
  padding: 0.75rem;
  background: #4a9eff;
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
}

.primary-btn:hover {
  background: #3a8eef;
}

.secondary-btn {
  width: 100%;
  padding: 0.75rem;
  background: #333;
  color: white;
  border: 1px solid #555;
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;
  margin-top: 0.5rem;
}

.secondary-btn:hover {
  background: #444;
}

.test-result {
  margin-top: 1rem;
  padding: 0.75rem;
  border-radius: 8px;
  font-size: 0.9rem;
}

.test-result.success {
  background: rgba(0, 200, 100, 0.1);
  border: 1px solid rgba(0, 200, 100, 0.3);
}

.test-result.error {
  background: rgba(255, 100, 100, 0.1);
  border: 1px solid rgba(255, 100, 100, 0.3);
}

.test-result.warning {
  background: rgba(255, 200, 0, 0.1);
  border: 1px solid rgba(255, 200, 0, 0.3);
}

.result-row {
  margin: 0.25rem 0;
}

.result-row code {
  background: #333;
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
  font-size: 0.8rem;
}

.group-secret-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  background: #222;
  border-radius: 6px;
  margin-bottom: 0.5rem;
}

.group-secret-item strong {
  flex: 1;
}

.group-secret-item code {
  font-size: 0.75rem;
  color: #888;
}

.tag {
  font-size: 0.7rem;
  padding: 0.2rem 0.4rem;
  background: #4a9eff;
  color: white;
  border-radius: 4px;
}

.muted {
  color: #666;
  font-style: italic;
}

.status-success {
  color: #4ade80;
}

.status-error {
  color: #f87171;
}
```

**Step 3: Add encryption test button to drawer**

In `witness-pwa/index.html`, add a button in the drawer (after the logout button):

```html
<!-- Inside the recordings-drawer div, after the drawer-content -->
<div class="drawer-footer">
  <button id="encryption-test-btn" class="drawer-action-btn">
    🔐 Encryption Test
  </button>
  <button id="logout-btn" class="drawer-action-btn logout">
    Logout
  </button>
</div>
```

**Step 4: Wire up the encryption test button in main.js**

In `witness-pwa/src/main.js`, add import and event listener:

```javascript
// Add import at top
import { showEncryptionTest } from './ui/encryptionTest.js';

// Add after existing event listeners (around line 545)
const encTestBtn = document.getElementById('encryption-test-btn');
if (encTestBtn) {
  encTestBtn.addEventListener('click', () => {
    closeDrawer();
    showEncryptionTest();
  });
}
```

**Step 5: Verify the encryption test UI**

1. Run `npm run dev`
2. Login with Privy
3. Open the drawer (bottom of screen)
4. Tap "🔐 Encryption Test"
5. Verify:
   - Personal key shows "✅ derived and ready"
   - Enter text, tap "Encrypt & Decrypt", see matching result
   - Tap "Generate Test Group", see it appear in list

**Step 6: Commit**

```bash
git add witness-pwa/src/ui/encryptionTest.js witness-pwa/src/style.css witness-pwa/index.html witness-pwa/src/main.js
git commit -m "feat(ui): add encryption test modal with group secret management"
```

---

### Task 5: Add clearSecureStorage to Logout Flow

**Files:**
- Modify: `witness-pwa/src/lib/authState.js`
- Modify: `witness-pwa/src/main.js`

**Step 1: Import and call clearSecureStorage on logout**

In `witness-pwa/src/lib/authState.js`, add import and update clearAuthState:

```javascript
// Add at top
import { clearCachedSignature } from './encryption.js';
import { clearSecureStorage } from './storage.js';

// Update clearAuthState function to also clear storage
export function clearAuthState() {
  authState.initialized = true;
  authState.authenticated = false;
  authState.user = null;
  authState.wallet = null;
  authState.provider = null;
  authState.kernelAccount = null;
  authState.smartAccountClient = null;
  authState.smartAccountAddress = null;
  authState.encryptionKey = null;

  // Clear cached signature and secure storage
  clearCachedSignature();
  clearSecureStorage();

  notifyListeners();
}
```

**Step 2: Verify logout clears storage**

1. Login
2. Open encryption test, generate a test group
3. Logout
4. Login again
5. Open encryption test - group secrets should be empty (storage was cleared)

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/authState.js
git commit -m "fix(auth): clear secure storage on logout"
```

---

### Task 6: Integration Test - Full Flow

**Files:** None (manual testing)

**Step 1: Test personal key derivation**

1. Clear browser data (localStorage, sessionStorage)
2. Run `npm run dev`
3. Login with email
4. Observe: Wallet signature prompt appears
5. Sign the message
6. Verify: Green checkmark in UI, camera enables

**Step 2: Test session persistence**

1. Refresh the page
2. Verify: No signature prompt (cached)
3. Verify: Camera re-enables automatically

**Step 3: Test encryption round-trip**

1. Open encryption test modal
2. Enter "Hello World"
3. Tap "Encrypt & Decrypt"
4. Verify: Original matches decrypted

**Step 4: Test group secret storage**

1. Generate 2-3 test groups
2. Refresh page
3. Open encryption test modal
4. Verify: Groups are still listed (persisted encrypted)

**Step 5: Test logout clears state**

1. Logout
2. Login again
3. Open encryption test modal
4. Verify: No groups (storage cleared)

**Step 6: Document any issues found**

If issues found, create tasks to fix them before proceeding.

---

### Task 7: Build and Deploy

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

Open http://localhost:4173, verify encryption test works.

**Step 3: Deploy to production**

```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

**Step 4: Verify production deployment**

1. Open https://witness.squirrlabs.xyz
2. Login
3. Open encryption test modal
4. Verify all features work

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: phase 3 complete - local storage and key derivation"
```

---

## Acceptance Criteria Checklist

- [ ] Personal key derived from wallet signature
- [ ] Key persists securely (session cache, no re-prompt on refresh)
- [ ] Can encrypt and decrypt test data
- [ ] Group secrets generated and stored encrypted
- [ ] Group ID derived from secret (keccak256)
- [ ] Key wrapping works for multi-group encryption
- [ ] Encryption test UI accessible from drawer
- [ ] Logout clears all secure storage
- [ ] Production deployment verified

---

## Notes

**Existing Implementation Leveraged:**
- `encryption.js` already had personal key derivation with EIP-712 and HKDF
- Session caching in sessionStorage already implemented
- AES-256-GCM encrypt/decrypt already implemented

**What This Phase Added:**
- Group secret generation and ID derivation
- Key wrapping for multi-group content encryption
- Encrypted storage service using personal key
- Encryption test UI for verification
- Proper cleanup on logout
