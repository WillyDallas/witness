# Phase 0 & Phase 1: Project Setup + Identity & Wallet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Establish a working Witness Protocol PWA with Privy email authentication, embedded wallet creation, Kernel smart account integration, and encryption key derivation.

**Architecture:** Users authenticate via email (Privy), which creates an embedded EOA wallet. This EOA becomes the owner of a Kernel smart account (ERC-4337) with Pimlico paymaster for gasless transactions. A deterministic AES-256-GCM encryption key is derived from an EIP-712 signature.

**Tech Stack:**
- Vite + vite-plugin-pwa (build tooling)
- `@privy-io/js-sdk-core` (email auth + embedded wallet)
- `viem` (Ethereum client)
- `permissionless` (Kernel smart account + Pimlico paymaster)
- Web Crypto API (AES-256-GCM encryption)

**Current State:** Phase 0 and Phase 1 are **ALREADY IMPLEMENTED** in `witness-pwa/`. This plan documents the implementation for verification, testing, and future reference.

---

## PHASE 0: Project Setup

Phase 0 establishes the foundational structure. **STATUS: COMPLETE**

### Task 0.1: Project Initialization

**Files:**
- Exists: `witness-pwa/package.json`
- Exists: `witness-pwa/vite.config.js`
- Exists: `witness-pwa/index.html`

**Verification Step 1: Check project runs**

```bash
cd witness-pwa && npm run dev
```

Expected: Vite dev server starts on `http://localhost:5173`

**Verification Step 2: Check production build**

```bash
cd witness-pwa && npm run build
```

Expected: Build completes, outputs to `dist/` directory

---

### Task 0.2: Dependencies Verification

**Files:**
- Exists: `witness-pwa/package.json`

**Step 1: Verify core dependencies installed**

```bash
cd witness-pwa && npm ls @privy-io/js-sdk-core viem permissionless
```

Expected output shows:
- `@privy-io/js-sdk-core@0.60.0`
- `viem@2.45.1`
- `permissionless@0.2.57`

**Step 2: Verify Buffer polyfill (required for Privy in browser)**

```bash
cd witness-pwa && npm ls buffer
```

Expected: `buffer@6.0.3`

---

### Task 0.3: Environment Configuration

**Files:**
- Exists: `witness-pwa/.env.example`
- Create if missing: `witness-pwa/.env`

**Step 1: Verify .env.example structure**

Read `witness-pwa/.env.example` and confirm it contains:
```env
VITE_PRIVY_APP_ID=...
VITE_PRIVY_CLIENT_ID=...
VITE_PIMLICO_API_KEY=...
VITE_CHAIN_ID=84532
VITE_ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032
```

**Step 2: Verify .env exists with real values**

Check `.env` file exists (should NOT be committed to git):
```bash
ls -la witness-pwa/.env
```

If missing, copy from example:
```bash
cp witness-pwa/.env.example witness-pwa/.env
```

Then fill in API keys from:
- Privy: https://dashboard.privy.io
- Pimlico: https://dashboard.pimlico.io

---

### Task 0.4: Folder Structure Verification

**Step 1: Verify required directories exist**

```bash
ls -la witness-pwa/src/lib/
ls -la witness-pwa/src/ui/
```

Expected structure:
```
witness-pwa/src/
├── main.js           # App entry + video capture
├── lib/
│   ├── authState.js  # Centralized auth state
│   ├── privy.js      # Privy SDK integration
│   ├── encryption.js # AES-256-GCM key derivation
│   └── smartAccount.js # Kernel + Pimlico
└── ui/
    └── loginModal.js # Login flow controller
```

---

## PHASE 0: Testing Checkpoint

**Manual Test:**
1. Run `npm run dev` in `witness-pwa/`
2. Open `http://localhost:5173`
3. Verify app loads without console errors
4. Verify login modal appears

**Expected Result:** App runs, shows "Get Started" or login UI

---

## PHASE 1: Account Creation & Wallet

Phase 1 implements the full authentication flow. **STATUS: COMPLETE**

---

### Task 1.1: Privy SDK Configuration

**Files:**
- Exists: `witness-pwa/src/lib/privy.js`

**Verification Step 1: Review Privy initialization**

Read `witness-pwa/src/lib/privy.js` and verify:

```javascript
// Key patterns to verify:
import Privy, {
  LocalStorage,
  getUserEmbeddedEthereumWallet,
  getEntropyDetailsFromUser,
} from '@privy-io/js-sdk-core';
import { baseSepolia } from 'viem/chains';

// Singleton initialization
privyInstance = new Privy({
  appId,
  clientId,
  supportedChains: [baseSepolia],
  storage: new LocalStorage(),
});

// Hidden iframe for embedded wallet secure context
privyIframe = document.createElement('iframe');
privyIframe.src = privyInstance.embeddedWallet.getURL();
```

**Insight:**
```
★ Insight ─────────────────────────────────────
• Privy uses a hidden iframe for embedded wallet operations - this provides a secure context for cryptographic operations
• LocalStorage is used for session persistence across page refreshes
• The message listener must be set up BEFORE iframe loads to avoid "proxy not initialized" errors
─────────────────────────────────────────────────
```

**Step 2: Verify email auth methods exist**

Confirm these exports exist in `privy.js`:
- `sendEmailCode(email)` - Sends 6-digit verification code
- `loginWithEmailCode(email, code)` - Completes login
- `checkSession()` - Validates existing session
- `logout()` - Clears session

---

### Task 1.2: Embedded Wallet Provider

**Files:**
- Exists: `witness-pwa/src/lib/privy.js`

**Verification Step 1: Review wallet creation flow**

Read the `getOrCreateWallet` function and verify:

```javascript
export async function getOrCreateWallet(user) {
  // Check for existing embedded wallet
  let wallet = getUserEmbeddedEthereumWallet(user);

  // Create if doesn't exist
  if (!wallet) {
    const result = await privy.embeddedWallet.create({});
    currentUser = result.user;
    wallet = getUserEmbeddedEthereumWallet(currentUser);
  }

  // Get provider for signing
  const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(currentUser);
  const provider = await privy.embeddedWallet.getEthereumProvider({
    wallet,
    entropyId,
    entropyIdVerifier,
  });

  return { wallet, provider };
}
```

**Insight:**
```
★ Insight ─────────────────────────────────────
• `getEntropyDetailsFromUser` provides deterministic signing - same user always produces same keys
• The provider is an EIP-1193 provider that can be used with viem's `custom()` transport
• Embedded wallets are created on first use, not on login
─────────────────────────────────────────────────
```

---

### Task 1.3: Smart Account (Kernel) Setup

**Files:**
- Exists: `witness-pwa/src/lib/smartAccount.js`

**Verification Step 1: Review Kernel account creation**

Read `smartAccount.js` and verify the key patterns:

```javascript
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { baseSepolia } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { createSmartAccountClient } from 'permissionless';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';

// Create owner from Privy provider
const owner = createWalletClient({
  account: address,
  chain: baseSepolia,
  transport: custom(provider),
});

// Create Kernel smart account
const kernelAccount = await toKernelSmartAccount({
  client: publicClient,
  owners: [owner],
  version: '0.3.1',
  entryPoint: {
    address: entryPoint07Address,
    version: '0.7',
  },
});
```

**Insight:**
```
★ Insight ─────────────────────────────────────
• Kernel v0.3.1 with EntryPoint 0.7 is the current stable combination
• The smart account address is counterfactual - it's deterministic but may not be deployed yet
• `toKernelSmartAccount` from permissionless replaces the older `signerToKernelSmartAccount`
─────────────────────────────────────────────────
```

**Step 2: Verify Pimlico paymaster integration**

```javascript
const pimlicoClient = createPimlicoClient({
  transport: http(pimlicoUrl),
  entryPoint: {
    address: entryPoint07Address,
    version: '0.7',
  },
});

const smartAccountClient = createSmartAccountClient({
  account: kernelAccount,
  chain: baseSepolia,
  bundlerTransport: http(pimlicoUrl),
  paymaster: pimlicoClient,
  userOperation: {
    estimateFeesPerGas: async () => {
      const gasPrice = await pimlicoClient.getUserOperationGasPrice();
      return gasPrice.fast;
    },
  },
});
```

**Insight:**
```
★ Insight ─────────────────────────────────────
• `createPimlicoClient` combines bundler + paymaster into one client (replaces separate clients)
• `getUserOperationGasPrice().fast` gets the current recommended gas price
• The bundler URL format is: `https://api.pimlico.io/v2/{chainId}/rpc?apikey={key}`
─────────────────────────────────────────────────
```

---

### Task 1.4: Encryption Key Derivation

**Files:**
- Exists: `witness-pwa/src/lib/encryption.js`

**Verification Step 1: Review EIP-712 signature request**

```javascript
const ENCRYPTION_KEY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 84532, // Base Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

const ENCRYPTION_KEY_TYPES = {
  EIP712Domain: [...],
  EncryptionKeyRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'keyVersion', type: 'uint256' },
  ],
};
```

**Step 2: Review key derivation flow**

```javascript
// 1. Request signature via EIP-712
const signature = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [walletAddress, JSON.stringify(typedData)],
});

// 2. Normalize to low-s form for determinism
function normalizeSignature(sig) {
  const secp256k1n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  // ... normalize s value to lower half of curve
}

// 3. Derive AES-256-GCM key using HKDF
const aesKey = await crypto.subtle.deriveKey({
  name: 'HKDF',
  salt: `witness-protocol:${walletAddress.toLowerCase()}`,
  info: 'AES-256-GCM-master-key',
  hash: 'SHA-256',
}, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
```

**Insight:**
```
★ Insight ─────────────────────────────────────
• ECDSA signatures have two valid s values (s and n-s) - normalizing to low-s ensures determinism
• HKDF (HMAC-based Key Derivation Function) safely stretches the signature into an encryption key
• The key is non-extractable (last param = false) for security - it can only be used for encrypt/decrypt
─────────────────────────────────────────────────
```

**Step 3: Review session persistence**

```javascript
// Cache signature in sessionStorage to avoid re-prompting on refresh
function cacheSignature(walletAddress, signature) {
  sessionStorage.setItem(SIGNATURE_CACHE_KEY, JSON.stringify({
    address: walletAddress.toLowerCase(),
    signature: normalizeSignature(signature),
  }));
}

// On page load, use cached signature if available
export async function getOrDeriveEncryptionKey(provider, walletAddress) {
  const cachedSig = getCachedSignature(walletAddress);
  if (cachedSig) {
    return await deriveKeyFromSignature(cachedSig, walletAddress);
  }
  // ... request new signature
}
```

---

### Task 1.5: Auth State Management

**Files:**
- Exists: `witness-pwa/src/lib/authState.js`

**Verification Step 1: Review centralized state**

```javascript
const authState = {
  initialized: false,
  authenticated: false,
  user: null,
  wallet: null,
  provider: null,
  kernelAccount: null,
  smartAccountClient: null,
  smartAccountAddress: null,
  encryptionKey: null,
};

// Observer pattern for UI updates
const subscribers = new Set();
export function subscribeToAuth(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}
```

**Insight:**
```
★ Insight ─────────────────────────────────────
• Centralized state avoids prop drilling and keeps wallet/key state in one place
• Observer pattern (subscribeToAuth) allows UI components to react to auth changes
• `isReady()` check: authenticated && encryptionKey - ensures both wallet and encryption are ready
─────────────────────────────────────────────────
```

---

### Task 1.6: Login Flow Controller

**Files:**
- Exists: `witness-pwa/src/ui/loginModal.js`

**Verification Step 1: Review complete login flow**

```javascript
async function completeLogin(user) {
  // 1. Get or create embedded wallet
  const { wallet, provider } = await getOrCreateWallet(user);

  // 2. Initialize smart account (Kernel + Pimlico)
  const { kernelAccount, client, address } = await initializeSmartAccount(
    provider, wallet.address
  );

  // 3. Derive encryption key
  const encryptionKey = await getOrDeriveEncryptionKey(provider, wallet.address);

  // 4. Update centralized auth state
  updateAuthState({
    authenticated: true,
    user,
    wallet,
    provider,
    kernelAccount,
    smartAccountClient: client,
    smartAccountAddress: address,
    encryptionKey,
  });
}
```

---

## PHASE 1: Testing Checkpoint

### Manual Test 1.1: Fresh Login Flow

**Prerequisites:**
- `.env` file configured with valid API keys
- Privy app created at https://dashboard.privy.io
- Pimlico account at https://dashboard.pimlico.io

**Steps:**
1. Run `npm run dev` in `witness-pwa/`
2. Open `http://localhost:5173`
3. Clear localStorage and sessionStorage (DevTools → Application → Storage)
4. Click "Get Started" or "Sign In"
5. Enter a valid email address
6. Check email for 6-digit code
7. Enter code in app

**Expected:**
- Login modal shows loading states
- After code entry, wallet signature prompt appears
- After signing, user sees their smart account address
- Console shows: `[privy] Initialized`, `[encryption] Key derived for 0x...`

**Verification:**
```javascript
// In browser console:
localStorage.getItem('witness_privy_user'); // Should show user JSON
sessionStorage.getItem('witness_enc_sig');  // Should show signature cache
```

---

### Manual Test 1.2: Session Restoration

**Steps:**
1. Complete Test 1.1 (fresh login)
2. Refresh the page (F5 or Cmd+R)

**Expected:**
- Login modal briefly shows "Restoring session..."
- User is automatically logged in without email/code entry
- Encryption key is restored from cached signature (NO signing prompt)
- Console shows: `[encryption] Using cached signature for key derivation`

---

### Manual Test 1.3: Logout Flow

**Steps:**
1. Complete Test 1.1 or 1.2 (be logged in)
2. Click logout button (⎋ or similar)

**Expected:**
- User returns to login screen
- localStorage `witness_privy_user` is cleared
- sessionStorage `witness_enc_sig` is cleared
- Camera stops if it was running

---

### Manual Test 1.4: Test Signature (Encryption Key)

**Steps:**
1. Complete login (Test 1.1 or 1.2)
2. Open browser DevTools Console
3. Run:

```javascript
// Get the encryption key from auth state
const { getEncryptionKey } = await import('/src/lib/authState.js');
const key = getEncryptionKey();
console.log('Encryption key ready:', !!key);

// Test encrypt/decrypt
const { encrypt, decrypt } = await import('/src/lib/encryption.js');
const testData = new TextEncoder().encode('Hello Witness Protocol!');
const { iv, ciphertext } = await encrypt(testData, key);
console.log('Encrypted:', new Uint8Array(ciphertext).slice(0, 10), '...');

const decrypted = await decrypt(iv, ciphertext, key);
const result = new TextDecoder().decode(decrypted);
console.log('Decrypted:', result);
```

**Expected:**
- `Encryption key ready: true`
- `Decrypted: Hello Witness Protocol!`

---

### Manual Test 1.5: Smart Account Address

**Steps:**
1. Complete login
2. Verify smart account address is displayed in UI
3. Open browser console and run:

```javascript
const { getAddress, getClient } = await import('/src/lib/authState.js');
console.log('Smart Account Address:', getAddress());
console.log('Client ready:', !!getClient());
```

**Expected:**
- Address starts with `0x` and is 42 characters
- Client is ready (truthy)

**Verification:**
- Open https://sepolia.basescan.org/
- Search for the address - it may show "Contract not yet deployed" (counterfactual)
- This is expected until the first transaction is sent

---

## Acceptance Criteria Summary

### Phase 0 ✓
- [ ] App runs with `npm run dev`
- [ ] Production build works with `npm run build`
- [ ] All dependencies installed correctly
- [ ] Environment variables configured

### Phase 1 ✓
- [ ] User can tap "Get Started" and see Privy login modal
- [ ] User can authenticate with email (code sent + verified)
- [ ] After auth, user sees their smart account address
- [ ] User can sign a message (EIP-712 signature for key derivation)
- [ ] Encryption key derived and ready for use
- [ ] Encrypt/decrypt test passes
- [ ] User can logout and login again
- [ ] Session persists across page refreshes (no re-auth needed)
- [ ] Address persists correctly

---

## Next Phase Preview

**Phase 2: Smart Contract & On-Chain Registration** will:
1. Deploy WitnessRegistry contract to Base Sepolia
2. Add `register()` function call (gasless via paymaster)
3. Show registration status in UI
4. Link to Basescan transaction

**Phase 3: Local Storage & Key Derivation** will:
- Already implemented in Phase 1
- Verify group secret storage patterns
- Prepare for IPFS manifest storage

---

## Error Troubleshooting

### "Missing Privy credentials"
- Check `.env` file exists with `VITE_PRIVY_APP_ID` and `VITE_PRIVY_CLIENT_ID`
- Values must match Privy dashboard exactly

### "Missing VITE_PIMLICO_API_KEY"
- Add `VITE_PIMLICO_API_KEY` to `.env`
- Get key from https://dashboard.pimlico.io

### "proxy not initialized" error
- Privy iframe not ready before message was sent
- Check that `waitForPrivyReady()` is called before wallet operations

### Signature request fails
- Ensure using EOA (embedded wallet), not smart account
- Smart account signatures are not deterministic

### Buffer is not defined
- Install: `npm install buffer`
- Vite config should alias Buffer polyfill

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER FLOW                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [User] → Email Login → [Privy] → Create EOA                        │
│                              ↓                                      │
│                         EOA Wallet (embedded)                       │
│                              ↓                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ PARALLEL INITIALIZATION                                      │   │
│  │                                                              │   │
│  │  ┌──────────────────┐    ┌──────────────────────────────┐   │   │
│  │  │ Smart Account    │    │ Encryption Key               │   │   │
│  │  │ (Kernel v0.3.1)  │    │ (EIP-712 sig → HKDF → AES)   │   │   │
│  │  │                  │    │                              │   │   │
│  │  │ • EntryPoint 0.7 │    │ • Deterministic from EOA sig │   │   │
│  │  │ • Pimlico payer  │    │ • Cached in sessionStorage   │   │   │
│  │  │ • Gasless txs    │    │ • Non-extractable key        │   │   │
│  │  └──────────────────┘    └──────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              ↓                                      │
│                      [Auth State Ready]                             │
│                              ↓                                      │
│                        [Camera Access]                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```
