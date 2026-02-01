# Identity & Wallet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Privy authentication with embedded wallet, Kernel smart account, Pimlico paymaster, and deterministic encryption key derivation to the Witness Protocol PWA.

**Architecture:** Users authenticate via email through Privy, which creates an embedded EOA wallet. This EOA becomes the signer for a Kernel smart account (ERC-4337) with Pimlico paymaster for gasless transactions. After login, we derive a deterministic AES-256-GCM encryption key from an EIP-712 signature, storing it in memory for evidence encryption in future phases.

**Tech Stack:**
- Vite (build tooling)
- `@privy-io/js-sdk-core` (authentication + embedded wallet)
- `viem` (Ethereum client)
- `permissionless` (smart account abstraction)
- Web Crypto API (key derivation)

---

## Prerequisites

Before starting, you need:
1. A Privy account (free tier) at https://privy.io
2. A Pimlico account (free tier) at https://pimlico.io
3. Node.js 18+ installed

---

## Task 1: Create Privy App and Get Credentials

**Files:**
- Create: `.env` (environment variables)

**Step 1: Create Privy Application**

1. Go to https://dashboard.privy.io
2. Click "Create App"
3. Name: `Witness Protocol`
4. Select "Progressive Web App" as platform
5. Enable "Email" login method
6. Copy the **App ID** and **Client ID** from Settings

**Step 2: Configure Privy App Settings**

In Privy Dashboard → Settings:
- Allowed Origins: `http://localhost:5173`, `https://witness.squirrlylabs.xyz`
- Enable "Embedded Wallets"
- Set default chain to "Sepolia"

**Step 3: Create Pimlico Account**

1. Go to https://dashboard.pimlico.io
2. Sign up (free tier: 1M credits/month)
3. Create new project
4. Copy the **API Key**
5. Note: Bundler + Paymaster share the same endpoint

**Step 4: Create environment file**

Create `.env` in project root:

```bash
# Privy Configuration
VITE_PRIVY_APP_ID=your-privy-app-id-here
VITE_PRIVY_CLIENT_ID=your-privy-client-id-here

# Pimlico Configuration (Ethereum Sepolia)
VITE_PIMLICO_API_KEY=your-pimlico-api-key-here
VITE_BUNDLER_URL=https://api.pimlico.io/v2/11155111/rpc?apikey=${VITE_PIMLICO_API_KEY}

# Chain Configuration
VITE_CHAIN_ID=11155111
VITE_ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032
```

**Step 5: Add .env to .gitignore**

Verify `.gitignore` includes:
```
.env
.env.local
.env.*.local
```

**Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore: add env file to gitignore for identity setup"
```

---

## Task 2: Initialize Vite Build System

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Modify: `witness-pwa/index.html` (add module script)
- Move: `witness-pwa/app.js` → `witness-pwa/src/main.js`

**Step 1: Initialize npm project**

Run from project root:

```bash
cd /Users/willydallas/WillyDev/witness/witness-pwa
npm init -y
```

**Step 2: Install Vite and dependencies**

```bash
npm install --save-dev vite vite-plugin-pwa
npm install @privy-io/js-sdk-core viem permissionless
```

**Step 3: Create Vite configuration**

Create `witness-pwa/vite.config.js`:

```javascript
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Witness Protocol',
        short_name: 'Witness',
        description: 'Privacy-preserving evidence capture',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: '/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
});
```

**Step 4: Restructure project for Vite**

```bash
mkdir -p witness-pwa/src witness-pwa/public/icons
mv witness-pwa/app.js witness-pwa/src/main.js
mv witness-pwa/icons/* witness-pwa/public/icons/
mv witness-pwa/manifest.json witness-pwa/public/
rmdir witness-pwa/icons
```

**Step 5: Update index.html for ES modules**

Modify `witness-pwa/index.html`:

Replace:
```html
<script src="app.js"></script>
```

With:
```html
<script type="module" src="/src/main.js"></script>
```

**Step 6: Add npm scripts to package.json**

Update `witness-pwa/package.json` scripts section:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

**Step 7: Verify Vite runs**

```bash
cd witness-pwa && npm run dev
```

Expected: Server starts at http://localhost:5173, app loads with camera

**Step 8: Commit**

```bash
git add witness-pwa/package.json witness-pwa/package-lock.json witness-pwa/vite.config.js witness-pwa/src witness-pwa/public witness-pwa/index.html
git commit -m "build: add Vite bundler with PWA plugin"
```

---

## Task 3: Create Privy Authentication Module

**Files:**
- Create: `witness-pwa/src/lib/privy.js`

**Step 1: Create the Privy wrapper module**

Create `witness-pwa/src/lib/privy.js`:

```javascript
/**
 * Privy authentication module for Witness Protocol
 * Handles email login, embedded wallet creation, and session management
 */
import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getEntropyDetailsFromUser,
} from '@privy-io/js-sdk-core';
import { sepolia } from 'viem/chains';

// Singleton Privy instance
let privyInstance = null;
let privyIframe = null;

/**
 * Initialize Privy SDK with iframe for embedded wallet secure context
 * @returns {Privy} Configured Privy instance
 */
export function initPrivy() {
  if (privyInstance) return privyInstance;

  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const clientId = import.meta.env.VITE_PRIVY_CLIENT_ID;

  if (!appId || !clientId) {
    throw new Error('Missing Privy credentials. Check VITE_PRIVY_APP_ID and VITE_PRIVY_CLIENT_ID in .env');
  }

  privyInstance = new Privy({
    appId,
    clientId,
    supportedChains: [sepolia],
    storage: new LocalStorage(),
  });

  // Create hidden iframe for embedded wallet secure context
  privyIframe = document.createElement('iframe');
  privyIframe.src = privyInstance.embeddedWallet.getURL();
  privyIframe.style.display = 'none';
  privyIframe.id = 'privy-iframe';
  document.body.appendChild(privyIframe);

  // Set up message passing
  privyInstance.setMessagePoster(privyIframe.contentWindow);
  window.addEventListener('message', (event) => {
    privyInstance.embeddedWallet.onMessage(event.data);
  });

  return privyInstance;
}

/**
 * Get the current Privy instance
 * @returns {Privy|null}
 */
export function getPrivy() {
  return privyInstance;
}

/**
 * Check if user has an active session
 * @returns {Promise<{authenticated: boolean, user: object|null}>}
 */
export async function checkSession() {
  const privy = getPrivy();
  if (!privy) {
    return { authenticated: false, user: null };
  }

  try {
    const user = await privy.getUser();
    return { authenticated: !!user, user };
  } catch {
    return { authenticated: false, user: null };
  }
}

/**
 * Send email verification code
 * @param {string} email - User's email address
 * @returns {Promise<void>}
 */
export async function sendEmailCode(email) {
  const privy = getPrivy();
  if (!privy) throw new Error('Privy not initialized');

  await privy.auth.email.sendCode(email);
}

/**
 * Complete email login with verification code
 * @param {string} email - User's email address
 * @param {string} code - 6-digit verification code
 * @returns {Promise<{user: object, isNewUser: boolean}>}
 */
export async function loginWithEmailCode(email, code) {
  const privy = getPrivy();
  if (!privy) throw new Error('Privy not initialized');

  const result = await privy.auth.email.loginWithCode(email, code);
  return { user: result.user, isNewUser: result.is_new_user };
}

/**
 * Get or create embedded Ethereum wallet for user
 * @param {object} user - Privy user object
 * @returns {Promise<{wallet: object, provider: object}>}
 */
export async function getOrCreateWallet(user) {
  const privy = getPrivy();
  if (!privy) throw new Error('Privy not initialized');

  // Check for existing embedded wallet
  let wallet = getUserEmbeddedEthereumWallet(user);

  // Create if doesn't exist
  if (!wallet) {
    await privy.embeddedWallet.create({});
    // Refresh user to get wallet
    const updatedUser = await privy.getUser();
    wallet = getUserEmbeddedEthereumWallet(updatedUser);
  }

  if (!wallet) {
    throw new Error('Failed to create embedded wallet');
  }

  // Get provider for signing
  const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(user);
  const provider = await privy.embeddedWallet.getEthereumProvider({
    wallet,
    entropyId,
    entropyIdVerifier,
  });

  return { wallet, provider };
}

/**
 * Logout and clear session
 * @returns {Promise<void>}
 */
export async function logout() {
  const privy = getPrivy();
  if (privy) {
    await privy.logout();
  }
}

/**
 * Get EOA address from wallet
 * @param {object} wallet - Privy wallet object
 * @returns {string} Wallet address
 */
export function getWalletAddress(wallet) {
  return wallet.address;
}
```

**Step 2: Verify module syntax**

```bash
cd witness-pwa && npm run dev
```

Open browser console, check for import errors.

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/privy.js
git commit -m "feat: add Privy authentication module"
```

---

## Task 4: Create Smart Account Module

**Files:**
- Create: `witness-pwa/src/lib/smartAccount.js`

**Step 1: Create the smart account wrapper**

Create `witness-pwa/src/lib/smartAccount.js`:

```javascript
/**
 * Smart Account module for Witness Protocol
 * Wraps Privy EOA into Kernel smart account with Pimlico paymaster
 */
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { providerToSmartAccountSigner } from 'permissionless';

// Cached clients
let publicClient = null;
let pimlicoClient = null;
let smartAccountClient = null;

/**
 * Get the Pimlico bundler/paymaster URL
 * @returns {string}
 */
function getPimlicoUrl() {
  const apiKey = import.meta.env.VITE_PIMLICO_API_KEY;
  if (!apiKey) {
    throw new Error('Missing VITE_PIMLICO_API_KEY in .env');
  }
  return `https://api.pimlico.io/v2/11155111/rpc?apikey=${apiKey}`;
}

/**
 * Initialize public client for Sepolia
 * @returns {object} Viem public client
 */
export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: sepolia,
      transport: http(),
    });
  }
  return publicClient;
}

/**
 * Initialize Pimlico client for bundler/paymaster operations
 * @returns {object} Pimlico client
 */
export function getPimlicoClient() {
  if (!pimlicoClient) {
    pimlicoClient = createPimlicoClient({
      transport: http(getPimlicoUrl()),
      entryPoint: {
        address: entryPoint07Address,
        version: '0.7',
      },
    });
  }
  return pimlicoClient;
}

/**
 * Create Kernel smart account from Privy EOA provider
 * @param {object} provider - Privy embedded wallet provider
 * @returns {Promise<object>} Kernel smart account
 */
export async function createKernelAccount(provider) {
  const client = getPublicClient();

  // Convert Privy provider to smart account signer
  const smartAccountSigner = await providerToSmartAccountSigner(provider);

  // Create Kernel smart account
  const kernelAccount = await toKernelSmartAccount({
    client,
    signer: smartAccountSigner,
    entryPoint: {
      address: entryPoint07Address,
      version: '0.7',
    },
  });

  return kernelAccount;
}

/**
 * Create smart account client with Pimlico paymaster
 * @param {object} kernelAccount - Kernel smart account
 * @returns {object} Smart account client ready for gasless transactions
 */
export function createGaslessClient(kernelAccount) {
  const pimlico = getPimlicoClient();

  smartAccountClient = createSmartAccountClient({
    account: kernelAccount,
    chain: sepolia,
    bundlerTransport: http(getPimlicoUrl()),
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => {
        const gasPrice = await pimlico.getUserOperationGasPrice();
        return gasPrice.fast;
      },
    },
  });

  return smartAccountClient;
}

/**
 * Get the smart account address (counterfactual - may not be deployed yet)
 * @param {object} kernelAccount - Kernel smart account
 * @returns {string} Smart account address
 */
export function getSmartAccountAddress(kernelAccount) {
  return kernelAccount.address;
}

/**
 * Get the current smart account client
 * @returns {object|null}
 */
export function getSmartAccountClient() {
  return smartAccountClient;
}

/**
 * Full initialization: EOA → Kernel → Gasless Client
 * @param {object} provider - Privy embedded wallet provider
 * @returns {Promise<{kernelAccount: object, client: object, address: string}>}
 */
export async function initializeSmartAccount(provider) {
  const kernelAccount = await createKernelAccount(provider);
  const client = createGaslessClient(kernelAccount);
  const address = getSmartAccountAddress(kernelAccount);

  return { kernelAccount, client, address };
}
```

**Step 2: Verify imports resolve**

```bash
cd witness-pwa && npm run dev
```

Check browser console for errors.

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/smartAccount.js
git commit -m "feat: add Kernel smart account with Pimlico paymaster"
```

---

## Task 5: Create Encryption Key Derivation Module

**Files:**
- Create: `witness-pwa/src/lib/encryption.js`

**Step 1: Create encryption key module**

Create `witness-pwa/src/lib/encryption.js`:

```javascript
/**
 * Encryption key derivation module for Witness Protocol
 * Derives deterministic AES-256-GCM keys from wallet signatures
 *
 * CRITICAL: Always use the EOA (embedded wallet) for signing, not the smart wallet.
 * Smart wallet signatures are not guaranteed deterministic.
 */

// EIP-712 domain for key derivation signatures
const ENCRYPTION_KEY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 11155111, // Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

// EIP-712 types for key derivation
const ENCRYPTION_KEY_TYPES = {
  EncryptionKeyRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'keyVersion', type: 'uint256' },
  ],
};

/**
 * Request EIP-712 signature for key derivation
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<string>} Signature hex string
 */
async function requestKeyDerivationSignature(provider, walletAddress) {
  const typedData = {
    domain: ENCRYPTION_KEY_DOMAIN,
    types: ENCRYPTION_KEY_TYPES,
    primaryType: 'EncryptionKeyRequest',
    message: {
      purpose: 'Derive master encryption key for evidence protection',
      application: 'witness-protocol',
      keyVersion: 1,
    },
  };

  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [walletAddress, JSON.stringify(typedData)],
  });

  return signature;
}

/**
 * Convert hex string to Uint8Array
 * @param {string} hex - Hex string (with or without 0x prefix)
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Normalize signature to low-s form for determinism
 * ECDSA signatures can have two valid s values; we normalize to the lower one.
 * @param {string} sig - Signature hex string
 * @returns {string} Normalized signature
 */
function normalizeSignature(sig) {
  const cleanSig = sig.startsWith('0x') ? sig.slice(2) : sig;
  const secp256k1n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

  const r = cleanSig.slice(0, 64);
  let s = BigInt('0x' + cleanSig.slice(64, 128));
  const v = cleanSig.slice(128);

  // Normalize s to low-s
  if (s > secp256k1n / 2n) {
    s = secp256k1n - s;
  }

  return '0x' + r + s.toString(16).padStart(64, '0') + v;
}

/**
 * Derive AES-256-GCM key from wallet signature using HKDF
 * @param {string} signature - Normalized signature
 * @param {string} walletAddress - EOA address (used in salt)
 * @returns {Promise<CryptoKey>} Non-extractable AES-256-GCM key
 */
async function deriveKeyFromSignature(signature, walletAddress) {
  const normalized = normalizeSignature(signature);
  const sigBytes = hexToBytes(normalized.slice(2));

  // Deterministic salt from app context + wallet
  const salt = new TextEncoder().encode(
    `witness-protocol:${walletAddress.toLowerCase()}`
  );
  const info = new TextEncoder().encode('AES-256-GCM-master-key');

  // Import signature as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    sigBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Derive AES-256-GCM key
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      salt,
      info,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // Non-extractable for security
    ['encrypt', 'decrypt']
  );

  return aesKey;
}

/**
 * Full key derivation flow: request signature → derive key
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<CryptoKey>} Master encryption key
 */
export async function deriveEncryptionKey(provider, walletAddress) {
  // Request signature (user sees EIP-712 prompt)
  const signature = await requestKeyDerivationSignature(provider, walletAddress);

  // Derive key from signature
  const key = await deriveKeyFromSignature(signature, walletAddress);

  return key;
}

/**
 * Encrypt data with AES-256-GCM
 * @param {ArrayBuffer} data - Data to encrypt
 * @param {CryptoKey} key - AES-256-GCM key
 * @returns {Promise<{iv: Uint8Array, ciphertext: ArrayBuffer}>}
 */
export async function encrypt(data, key) {
  // Generate fresh random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  return { iv, ciphertext };
}

/**
 * Decrypt data with AES-256-GCM
 * @param {Uint8Array} iv - Initialization vector
 * @param {ArrayBuffer} ciphertext - Encrypted data
 * @param {CryptoKey} key - AES-256-GCM key
 * @returns {Promise<ArrayBuffer>} Decrypted data
 */
export async function decrypt(iv, ciphertext, key) {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return plaintext;
}

/**
 * Hash data using SHA-256
 * @param {ArrayBuffer|Blob} data - Data to hash
 * @returns {Promise<string>} Hex-encoded hash
 */
export async function sha256(data) {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
```

**Step 2: Verify module syntax**

```bash
cd witness-pwa && npm run dev
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/encryption.js
git commit -m "feat: add deterministic encryption key derivation from wallet signature"
```

---

## Task 6: Create Auth State Manager

**Files:**
- Create: `witness-pwa/src/lib/authState.js`

**Step 1: Create centralized auth state**

Create `witness-pwa/src/lib/authState.js`:

```javascript
/**
 * Auth State Manager for Witness Protocol
 * Centralized state for authentication, wallet, and encryption key
 */

// Auth state (in-memory, lost on page refresh - session restored via Privy)
const authState = {
  initialized: false,
  authenticated: false,
  user: null,
  wallet: null,           // Privy embedded wallet
  provider: null,         // EOA provider for signing
  kernelAccount: null,    // Kernel smart account
  smartAccountClient: null,
  smartAccountAddress: null,
  encryptionKey: null,    // AES-256-GCM master key
};

// Event listeners for state changes
const listeners = new Set();

/**
 * Subscribe to auth state changes
 * @param {function} callback - Called with new state
 * @returns {function} Unsubscribe function
 */
export function subscribeToAuth(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Notify all listeners of state change
 */
function notifyListeners() {
  const stateCopy = { ...authState };
  listeners.forEach((callback) => callback(stateCopy));
}

/**
 * Update auth state
 * @param {object} updates - Partial state updates
 */
export function updateAuthState(updates) {
  Object.assign(authState, updates);
  notifyListeners();
}

/**
 * Get current auth state (read-only copy)
 * @returns {object}
 */
export function getAuthState() {
  return { ...authState };
}

/**
 * Check if user is fully authenticated with encryption key ready
 * @returns {boolean}
 */
export function isReady() {
  return authState.authenticated && authState.encryptionKey !== null;
}

/**
 * Get encryption key (for recording/playback)
 * @returns {CryptoKey|null}
 */
export function getEncryptionKey() {
  return authState.encryptionKey;
}

/**
 * Get smart account client (for gasless transactions)
 * @returns {object|null}
 */
export function getClient() {
  return authState.smartAccountClient;
}

/**
 * Get smart account address
 * @returns {string|null}
 */
export function getAddress() {
  return authState.smartAccountAddress;
}

/**
 * Get EOA address (embedded wallet)
 * @returns {string|null}
 */
export function getEOAAddress() {
  return authState.wallet?.address || null;
}

/**
 * Clear all auth state (logout)
 */
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
  notifyListeners();
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/lib/authState.js
git commit -m "feat: add centralized auth state manager"
```

---

## Task 7: Create Login UI Components

**Files:**
- Modify: `witness-pwa/index.html` (add login modal HTML)
- Create: `witness-pwa/src/ui/loginModal.js`
- Modify: `witness-pwa/styles.css` (add modal styles)

**Step 1: Add login modal HTML**

In `witness-pwa/index.html`, add after `<body>` tag (before `.app-container`):

```html
<!-- Login Modal (shown before camera access) -->
<div id="login-modal" class="modal-overlay">
    <div class="modal-content login-modal">
        <div class="modal-header">
            <h1 class="app-title">Witness Protocol</h1>
            <p class="app-subtitle">Privacy-preserving evidence capture</p>
        </div>

        <div id="login-step-email" class="login-step">
            <p class="login-instruction">Enter your email to get started</p>
            <input
                type="email"
                id="email-input"
                class="login-input"
                placeholder="you@example.com"
                autocomplete="email"
                inputmode="email"
            />
            <button id="send-code-btn" class="btn btn-primary btn-full">
                Continue
            </button>
        </div>

        <div id="login-step-code" class="login-step hidden">
            <p class="login-instruction">
                Enter the 6-digit code sent to<br>
                <span id="email-display" class="email-display"></span>
            </p>
            <input
                type="text"
                id="code-input"
                class="login-input code-input"
                placeholder="000000"
                maxlength="6"
                inputmode="numeric"
                pattern="[0-9]*"
                autocomplete="one-time-code"
            />
            <button id="verify-code-btn" class="btn btn-primary btn-full">
                Verify
            </button>
            <button id="back-to-email-btn" class="btn btn-link">
                Use a different email
            </button>
        </div>

        <div id="login-step-loading" class="login-step hidden">
            <div class="loading-spinner"></div>
            <p id="loading-message" class="loading-message">Setting up your wallet...</p>
        </div>

        <p id="login-error" class="login-error hidden"></p>
    </div>
</div>

<!-- Wallet Status Indicator (shown when authenticated) -->
<div id="wallet-indicator" class="wallet-indicator hidden">
    <span class="wallet-dot"></span>
    <span id="wallet-address" class="wallet-address"></span>
</div>
```

**Step 2: Add modal styles**

Append to `witness-pwa/styles.css`:

```css
/* ==========================================
   LOGIN MODAL STYLES
   ========================================== */

.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.95);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
}

.modal-overlay.hidden {
    display: none;
}

.modal-content {
    background: var(--bg-dark);
    border-radius: 16px;
    padding: 32px 24px;
    max-width: 380px;
    width: 100%;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.login-modal .modal-header {
    text-align: center;
    margin-bottom: 32px;
}

.app-title {
    font-size: 24px;
    font-weight: 600;
    color: var(--text-light);
    margin: 0 0 8px 0;
}

.app-subtitle {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
}

.login-step {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.login-step.hidden {
    display: none;
}

.login-instruction {
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
    margin: 0;
    line-height: 1.5;
}

.login-input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    padding: 14px 16px;
    font-size: 16px;
    color: var(--text-light);
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.2s;
}

.login-input:focus {
    outline: none;
    border-color: var(--text-light);
}

.login-input::placeholder {
    color: var(--text-muted);
}

.code-input {
    text-align: center;
    font-size: 24px;
    letter-spacing: 8px;
    font-family: monospace;
}

.btn-primary {
    background: var(--text-light);
    color: var(--bg-dark);
    border: none;
    border-radius: 8px;
    padding: 14px 24px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.2s;
}

.btn-primary:hover {
    opacity: 0.9;
}

.btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.btn-full {
    width: 100%;
}

.btn-link {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 14px;
    cursor: pointer;
    padding: 8px;
    text-decoration: underline;
}

.btn-link:hover {
    color: var(--text-light);
}

.email-display {
    color: var(--text-light);
    font-weight: 500;
}

.loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--text-light);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

.loading-message {
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
    margin: 16px 0 0 0;
}

.login-error {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #ef4444;
    padding: 12px;
    border-radius: 8px;
    font-size: 14px;
    text-align: center;
    margin-top: 16px;
}

.login-error.hidden {
    display: none;
}

/* ==========================================
   WALLET INDICATOR
   ========================================== */

.wallet-indicator {
    position: fixed;
    top: calc(12px + env(safe-area-inset-top));
    right: calc(12px + env(safe-area-inset-right));
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    padding: 8px 12px;
    border-radius: 20px;
    z-index: 100;
}

.wallet-indicator.hidden {
    display: none;
}

.wallet-dot {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
}

.wallet-address {
    color: var(--text-muted);
    font-size: 12px;
    font-family: monospace;
}
```

**Step 3: Create login modal controller**

Create `witness-pwa/src/ui/loginModal.js`:

```javascript
/**
 * Login Modal Controller
 * Handles UI state and user interactions for authentication flow
 */
import {
  initPrivy,
  checkSession,
  sendEmailCode,
  loginWithEmailCode,
  getOrCreateWallet,
  getWalletAddress,
} from '../lib/privy.js';
import { initializeSmartAccount } from '../lib/smartAccount.js';
import { deriveEncryptionKey } from '../lib/encryption.js';
import { updateAuthState, clearAuthState } from '../lib/authState.js';

// DOM elements (cached on init)
let elements = {};

/**
 * Cache DOM element references
 */
function cacheElements() {
  elements = {
    modal: document.getElementById('login-modal'),
    walletIndicator: document.getElementById('wallet-indicator'),
    walletAddress: document.getElementById('wallet-address'),
    // Steps
    stepEmail: document.getElementById('login-step-email'),
    stepCode: document.getElementById('login-step-code'),
    stepLoading: document.getElementById('login-step-loading'),
    // Inputs
    emailInput: document.getElementById('email-input'),
    codeInput: document.getElementById('code-input'),
    emailDisplay: document.getElementById('email-display'),
    // Buttons
    sendCodeBtn: document.getElementById('send-code-btn'),
    verifyCodeBtn: document.getElementById('verify-code-btn'),
    backToEmailBtn: document.getElementById('back-to-email-btn'),
    // Messages
    loadingMessage: document.getElementById('loading-message'),
    errorMessage: document.getElementById('login-error'),
  };
}

/**
 * Show a specific login step, hide others
 * @param {'email'|'code'|'loading'} step
 */
function showStep(step) {
  elements.stepEmail.classList.toggle('hidden', step !== 'email');
  elements.stepCode.classList.toggle('hidden', step !== 'code');
  elements.stepLoading.classList.toggle('hidden', step !== 'loading');
  elements.errorMessage.classList.add('hidden');
}

/**
 * Show error message
 * @param {string} message
 */
function showError(message) {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove('hidden');
}

/**
 * Update loading message
 * @param {string} message
 */
function setLoadingMessage(message) {
  elements.loadingMessage.textContent = message;
}

/**
 * Truncate address for display
 * @param {string} address
 * @returns {string}
 */
function truncateAddress(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Hide modal and show wallet indicator
 * @param {string} address - Smart account address
 */
function showAuthenticated(address) {
  elements.modal.classList.add('hidden');
  elements.walletAddress.textContent = truncateAddress(address);
  elements.walletIndicator.classList.remove('hidden');
}

/**
 * Complete login flow after email verification
 * @param {object} user - Privy user object
 */
async function completeLogin(user) {
  try {
    showStep('loading');

    // Step 1: Get or create embedded wallet
    setLoadingMessage('Creating your wallet...');
    const { wallet, provider } = await getOrCreateWallet(user);
    const eoaAddress = getWalletAddress(wallet);

    // Step 2: Initialize smart account
    setLoadingMessage('Setting up gasless transactions...');
    const { kernelAccount, client, address } = await initializeSmartAccount(provider);

    // Step 3: Derive encryption key (user sees signature prompt)
    setLoadingMessage('Securing your encryption keys...');
    const encryptionKey = await deriveEncryptionKey(provider, eoaAddress);

    // Update auth state
    updateAuthState({
      initialized: true,
      authenticated: true,
      user,
      wallet,
      provider,
      kernelAccount,
      smartAccountClient: client,
      smartAccountAddress: address,
      encryptionKey,
    });

    // Show success UI
    showAuthenticated(address);

    return true;
  } catch (error) {
    console.error('Login completion failed:', error);
    showStep('email');
    showError(error.message || 'Failed to complete setup. Please try again.');
    return false;
  }
}

/**
 * Handle "Continue" button click (send verification code)
 */
async function handleSendCode() {
  const email = elements.emailInput.value.trim();

  if (!email || !email.includes('@')) {
    showError('Please enter a valid email address');
    return;
  }

  elements.sendCodeBtn.disabled = true;
  elements.sendCodeBtn.textContent = 'Sending...';

  try {
    await sendEmailCode(email);
    elements.emailDisplay.textContent = email;
    showStep('code');
    elements.codeInput.focus();
  } catch (error) {
    console.error('Send code failed:', error);
    showError(error.message || 'Failed to send code. Please try again.');
  } finally {
    elements.sendCodeBtn.disabled = false;
    elements.sendCodeBtn.textContent = 'Continue';
  }
}

/**
 * Handle "Verify" button click (submit verification code)
 */
async function handleVerifyCode() {
  const email = elements.emailDisplay.textContent;
  const code = elements.codeInput.value.trim();

  if (!code || code.length !== 6) {
    showError('Please enter the 6-digit code');
    return;
  }

  elements.verifyCodeBtn.disabled = true;
  elements.verifyCodeBtn.textContent = 'Verifying...';

  try {
    const { user } = await loginWithEmailCode(email, code);
    await completeLogin(user);
  } catch (error) {
    console.error('Verify code failed:', error);
    showError(error.message || 'Invalid code. Please try again.');
    elements.verifyCodeBtn.disabled = false;
    elements.verifyCodeBtn.textContent = 'Verify';
  }
}

/**
 * Handle "Use a different email" link click
 */
function handleBackToEmail() {
  elements.codeInput.value = '';
  showStep('email');
  elements.emailInput.focus();
}

/**
 * Initialize login modal and check for existing session
 * @returns {Promise<boolean>} True if user is authenticated
 */
export async function initLoginModal() {
  cacheElements();

  // Set up event listeners
  elements.sendCodeBtn.addEventListener('click', handleSendCode);
  elements.verifyCodeBtn.addEventListener('click', handleVerifyCode);
  elements.backToEmailBtn.addEventListener('click', handleBackToEmail);

  // Enter key handlers
  elements.emailInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSendCode();
  });
  elements.codeInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleVerifyCode();
  });

  // Initialize Privy
  try {
    initPrivy();
  } catch (error) {
    console.error('Privy init failed:', error);
    showError('Failed to initialize authentication. Check your API keys.');
    return false;
  }

  // Check for existing session
  showStep('loading');
  setLoadingMessage('Checking session...');

  const { authenticated, user } = await checkSession();

  if (authenticated && user) {
    // Restore session
    return await completeLogin(user);
  } else {
    // Show login form
    updateAuthState({ initialized: true, authenticated: false });
    showStep('email');
    return false;
  }
}

/**
 * Show the login modal (for logout/re-auth)
 */
export function showLoginModal() {
  clearAuthState();
  elements.modal.classList.remove('hidden');
  elements.walletIndicator.classList.add('hidden');
  elements.emailInput.value = '';
  elements.codeInput.value = '';
  showStep('email');
}
```

**Step 4: Verify modal renders**

```bash
cd witness-pwa && npm run dev
```

Open http://localhost:5173, verify login modal appears.

**Step 5: Commit**

```bash
git add witness-pwa/index.html witness-pwa/styles.css witness-pwa/src/ui/loginModal.js
git commit -m "feat: add login modal UI with email verification flow"
```

---

## Task 8: Integrate Auth into Main App

**Files:**
- Modify: `witness-pwa/src/main.js`

**Step 1: Update main.js to gate camera behind login**

Replace the beginning of `witness-pwa/src/main.js` (add imports and modify init):

```javascript
/**
 * Witness Protocol PWA - Main Application
 *
 * This module handles video capture with touch-hold recording.
 * Authentication and encryption are handled by the auth modules.
 */
import { initLoginModal } from './ui/loginModal.js';
import { isReady, subscribeToAuth } from './lib/authState.js';

// ... (keep all existing code below the imports)

// Modify the init() function at the bottom:
async function init() {
    // Initialize login modal and check session
    const authenticated = await initLoginModal();

    // Subscribe to auth state changes
    subscribeToAuth((state) => {
        if (state.authenticated && state.encryptionKey) {
            // User just completed authentication
            // Enable camera if not already initialized
            if (!mediaStream) {
                initCamera();
            }
        }
    });

    // Only initialize camera if already authenticated
    if (authenticated) {
        renderRecordingsList();
        await initCamera();
    } else {
        // Camera will be initialized after login completes
        renderRecordingsList();
    }
}

// Keep the existing init() call at the bottom
init();
```

**Step 2: Verify full flow works**

```bash
cd witness-pwa && npm run dev
```

1. Open http://localhost:5173
2. Login modal should appear
3. Enter email → receive code → verify
4. Should see signature prompt for key derivation
5. Wallet indicator should appear
6. Camera should initialize

**Step 3: Commit**

```bash
git add witness-pwa/src/main.js
git commit -m "feat: integrate auth flow, gate camera behind login"
```

---

## Task 9: Add Logout Functionality

**Files:**
- Modify: `witness-pwa/index.html` (add logout button to drawer)
- Modify: `witness-pwa/src/main.js` (add logout handler)
- Modify: `witness-pwa/src/ui/loginModal.js` (export for use)

**Step 1: Add logout button to drawer**

In `witness-pwa/index.html`, inside the `.drawer-content` div, after the recordings list:

```html
<div class="drawer-footer">
    <button id="logout-btn" class="btn btn-link btn-logout">
        Sign Out
    </button>
</div>
```

**Step 2: Add drawer footer styles**

Append to `witness-pwa/styles.css`:

```css
/* ==========================================
   DRAWER FOOTER
   ========================================== */

.drawer-footer {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.btn-logout {
    width: 100%;
    text-align: center;
    color: #ef4444;
}

.btn-logout:hover {
    color: #f87171;
}
```

**Step 3: Add logout handler to main.js**

Add to `witness-pwa/src/main.js`:

```javascript
import { showLoginModal } from './ui/loginModal.js';
import { logout } from './lib/privy.js';
import { clearAuthState } from './lib/authState.js';

// Add after other DOM element declarations
const logoutBtn = document.getElementById('logout-btn');

// Add after other event listeners
logoutBtn.addEventListener('click', async () => {
    // Stop any active recording
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
    }

    // Stop camera
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }

    // Clear auth state and logout from Privy
    await logout();
    clearAuthState();

    // Show login modal
    showLoginModal();

    // Close drawer
    closeDrawer();
});
```

**Step 4: Test logout flow**

1. Login and access camera
2. Open drawer
3. Click "Sign Out"
4. Should return to login modal

**Step 5: Commit**

```bash
git add witness-pwa/index.html witness-pwa/styles.css witness-pwa/src/main.js
git commit -m "feat: add logout functionality"
```

---

## Task 10: Create Environment Example and Update Deployment

**Files:**
- Create: `.env.example`
- Modify: `CLAUDE.md` (update deployment notes)

**Step 1: Create environment example file**

Create `.env.example` in project root:

```bash
# Witness Protocol Environment Configuration
# Copy this file to .env and fill in your values

# Privy Configuration (https://dashboard.privy.io)
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_PRIVY_CLIENT_ID=your-privy-client-id

# Pimlico Configuration (https://dashboard.pimlico.io)
VITE_PIMLICO_API_KEY=your-pimlico-api-key

# Chain Configuration (Ethereum Sepolia)
VITE_CHAIN_ID=11155111
VITE_ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032
```

**Step 2: Update CLAUDE.md with new deployment instructions**

Add to CLAUDE.md under "Deployment":

```markdown
### Build for Production

```bash
cd witness-pwa
npm run build
```

This outputs to `witness-pwa/dist/`.

### Deploy Command (Updated)

From project root:
```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

### Environment Variables on Server

Set environment variables via nginx or create a `.env` file that gets embedded at build time. For now, environment variables are baked into the build.
```

**Step 3: Commit**

```bash
git add .env.example CLAUDE.md
git commit -m "docs: add environment example and update deployment instructions"
```

---

## Task 11: Write Integration Test (Manual Checklist)

**Files:**
- Create: `witness-pwa/tests/manual-auth-test.md`

**Step 1: Create manual test checklist**

Create `witness-pwa/tests/manual-auth-test.md`:

```markdown
# Identity & Wallet Integration Test Checklist

Run through this checklist to verify the auth flow works correctly.

## Prerequisites
- [ ] `.env` file created with valid Privy and Pimlico API keys
- [ ] `npm install` completed in `witness-pwa/`
- [ ] Dev server running: `npm run dev`

## Fresh Login Flow

### 1. Initial Load
- [ ] Login modal appears (not camera)
- [ ] "Witness Protocol" title displayed
- [ ] Email input field focused or visible
- [ ] No console errors

### 2. Email Entry
- [ ] Enter valid email address
- [ ] Click "Continue"
- [ ] "Sending..." state appears briefly
- [ ] Transitions to code entry step
- [ ] Email displayed in code entry step
- [ ] Verification email received (check inbox/spam)

### 3. Code Verification
- [ ] Enter 6-digit code
- [ ] Click "Verify"
- [ ] "Verifying..." state appears
- [ ] Transitions to loading state

### 4. Wallet Setup
- [ ] "Creating your wallet..." message appears
- [ ] "Setting up gasless transactions..." message appears
- [ ] "Securing your encryption keys..." message appears
- [ ] EIP-712 signature prompt appears in browser
- [ ] Signature prompt shows "Witness Protocol" domain
- [ ] Signature prompt shows purpose: "Derive master encryption key..."

### 5. Post-Login State
- [ ] Login modal disappears
- [ ] Wallet indicator appears (top-right)
- [ ] Address shows truncated (0x1234...5678)
- [ ] Green dot next to address
- [ ] Camera preview initializes
- [ ] Record button becomes enabled

## Session Restore Flow

### 6. Page Refresh
- [ ] Refresh the page (F5 or Cmd+R)
- [ ] "Checking session..." loading state appears briefly
- [ ] Auto-restores session (no email entry needed)
- [ ] Signature prompt appears for key re-derivation
- [ ] Camera initializes after signature

## Logout Flow

### 7. Logout
- [ ] Open recordings drawer
- [ ] "Sign Out" button visible at bottom
- [ ] Click "Sign Out"
- [ ] Login modal reappears
- [ ] Camera stops
- [ ] Wallet indicator hidden

## Error Handling

### 8. Invalid Email
- [ ] Enter invalid email (no @ sign)
- [ ] Click "Continue"
- [ ] Error message: "Please enter a valid email address"

### 9. Invalid Code
- [ ] Complete email step with valid email
- [ ] Enter wrong code (e.g., 000000)
- [ ] Click "Verify"
- [ ] Error message appears
- [ ] Can retry with correct code

### 10. Back Navigation
- [ ] On code entry step, click "Use a different email"
- [ ] Returns to email entry step
- [ ] Can enter new email

## Console Checks

### 11. No Errors
- [ ] Open browser DevTools Console
- [ ] No red errors related to Privy, viem, permissionless
- [ ] No uncaught exceptions

### 12. Smart Account Address
- [ ] In console, run: `window.witnessAuth` (if exposed)
- [ ] Or check Network tab for Pimlico API calls
- [ ] Verify smart account address is deterministic (same on refresh)

---

## Test Results

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| 1. Initial Load | | |
| 2. Email Entry | | |
| 3. Code Verification | | |
| 4. Wallet Setup | | |
| 5. Post-Login State | | |
| 6. Page Refresh | | |
| 7. Logout | | |
| 8. Invalid Email | | |
| 9. Invalid Code | | |
| 10. Back Navigation | | |
| 11. No Errors | | |
| 12. Smart Account Address | | |

**Tested by:** _______________
**Date:** _______________
**Browser/Device:** _______________
```

**Step 2: Commit**

```bash
git add witness-pwa/tests/manual-auth-test.md
git commit -m "test: add manual auth integration test checklist"
```

---

## Summary

This plan implements the Identity & Wallet component with:

1. **Vite build system** - Modern bundling for ES modules and dependencies
2. **Privy email authentication** - Simple email + code flow
3. **Embedded wallet creation** - Auto-created EOA on first login
4. **Kernel smart account** - ERC-4337 account abstraction
5. **Pimlico paymaster** - Gasless transaction sponsorship (ready for future phases)
6. **Deterministic encryption key** - AES-256-GCM derived from EIP-712 signature
7. **Session persistence** - Auto-restore on page refresh
8. **Login-gated camera** - No recording until authenticated

**Files created/modified:**
- `.env` (credentials, gitignored)
- `.env.example` (template)
- `witness-pwa/package.json`
- `witness-pwa/vite.config.js`
- `witness-pwa/src/lib/privy.js`
- `witness-pwa/src/lib/smartAccount.js`
- `witness-pwa/src/lib/encryption.js`
- `witness-pwa/src/lib/authState.js`
- `witness-pwa/src/ui/loginModal.js`
- `witness-pwa/src/main.js`
- `witness-pwa/index.html`
- `witness-pwa/styles.css`
- `witness-pwa/tests/manual-auth-test.md`
- `CLAUDE.md` (deployment updates)

**Next Phase (Phase 2: Core Loop):**
- Use `encryptionKey` from auth state to encrypt video chunks
- Upload encrypted chunks to IPFS via Pinata
- Call registry contract via `smartAccountClient` for gasless merkle root updates
