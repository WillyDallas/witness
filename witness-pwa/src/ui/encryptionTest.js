/**
 * Encryption Test UI for Witness Protocol
 * Allows testing encryption/decryption and viewing group secrets
 */

import { getAuthState } from '../lib/authState.js';
import { encrypt, decrypt, generateGroupSecret, deriveGroupId, bytesToHex } from '../lib/encryption.js';
import { getGroupSecrets, setGroupSecret } from '../lib/storage.js';

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
