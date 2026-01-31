# Privy + Pimlico + zkDID Integration for Witness Protocol PWA

**Target: Ethereum Sepolia | Vanilla JavaScript | Gasless UX**

This document consolidates research on implementing wallet creation, gasless transactions, and privacy-preserving identity for Witness Protocol.

---

## Executive Summary

| Component | Recommendation | Rationale |
|-----------|---------------|-----------|
| Auth + Embedded Wallet | Privy `@privy-io/js-sdk-core` | PWA-compatible, handles key custody |
| Smart Wallet | Kernel (ZeroDev) via permissionless.js | ERC-7579 module support, future flexibility |
| Bundler + Paymaster | Pimlico (Ethereum Sepolia) | 1M free credits/month, excellent docs |
| Quick Prototype Option | Base Sepolia free paymaster | Zero-config, no API key needed |
| Key Derivation | EIP-712 signature → HKDF → AES-256-GCM | Deterministic, secure, uses EOA signer |
| zkDID (MVP) | Semaphore | 4-8 hours to integrate, anonymous groups |
| zkDID (Sybil Resistance) | World ID | Proof-of-personhood, add post-MVP |
| Attestations (Simple) | EAS | Lightweight, no ZK complexity |

---

## 1. Privy Vanilla JavaScript SDK

Privy provides `@privy-io/js-sdk-core` for non-React applications. This is a **low-level library** with important caveats:

- No native smart wallet integration (React/React Native only)
- Frequent breaking changes—Privy recommends contacting support before production
- Requires manual iframe setup for embedded wallet secure context

### Initialization

```javascript
import Privy, { LocalStorage, getUserEmbeddedEthereumWallet, getEntropyDetailsFromUser } from '@privy-io/js-sdk-core';
import { sepolia } from 'viem/chains';

const privy = new Privy({
  appId: 'your-privy-app-id',
  clientId: 'your-privy-client-id', // From Dashboard
  supportedChains: [sepolia],
  storage: new LocalStorage()
});

// Critical: Manual iframe setup for secure context
const iframe = document.createElement('iframe');
iframe.src = privy.embeddedWallet.getURL();
iframe.style.display = 'none';
document.body.appendChild(iframe);
privy.setMessagePoster(iframe.contentWindow);
window.addEventListener('message', (e) => privy.embeddedWallet.onMessage(e.data));
```

### Authentication Flow (Email)

```javascript
// Send verification code
await privy.auth.email.sendCode('user@example.com');

// Complete login
const { user, is_new_user } = await privy.auth.email.loginWithCode(
  'user@example.com',
  '123456'
);

// Get embedded wallet
let wallet = getUserEmbeddedEthereumWallet(user);
if (!wallet) {
  await privy.embeddedWallet.create({});
  wallet = getUserEmbeddedEthereumWallet(user);
}

// Get provider for signing
const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(user);
const provider = await privy.embeddedWallet.getEthereumProvider({
  wallet, entropyId, entropyIdVerifier
});

const address = wallet.address; // 0x...
```

### PWA Considerations

- **Fully supported**: Privy maintains an official PWA template at `github.com/privy-io/create-privy-pwa`
- **Storage**: Keys stored in IndexedDB/localStorage with end-to-end encryption
- **HTTPS required**: Localhost exception for development
- **iOS Safari**: Test thoroughly—50MB storage limit for installable files, limited service worker support
- **Offline limitation**: Signing requires Privy's secure enclave communication; consider session keys for offline UX

---

## 2. Smart Wallet via permissionless.js

Since Privy's vanilla JS SDK lacks native smart wallet support, use **permissionless.js** to wrap the embedded wallet into a smart account.

### Smart Account Type Decision

**Recommendation: Kernel (ZeroDev)**

| Option | Pros | Cons |
|--------|------|------|
| SimpleAccount | Simplest, minimal gas | No module support |
| **Kernel** | ERC-7579 modules, future credential storage | Slightly higher gas |
| Safe | Battle-tested, multi-sig capable | Higher complexity |

> **Warning**: Changing smart account type later means users get a new address and lose access to assets at the old address. Lock this in early.

### Implementation

```javascript
import { createSmartAccountClient } from 'permissionless';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';
import { providerToSmartAccountSigner } from 'permissionless';

const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${API_KEY}`;

// 1. Create clients
const publicClient = createPublicClient({
  chain: sepolia,
  transport: http()
});

const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: { address: entryPoint07Address, version: '0.7' }
});

// 2. Convert Privy provider to signer
const smartAccountSigner = await providerToSmartAccountSigner(provider);

// 3. Create Kernel smart account
const kernelAccount = await toKernelSmartAccount({
  client: publicClient,
  signer: smartAccountSigner,
  entryPoint: { address: entryPoint07Address, version: '0.7' }
});

// 4. Create smart account client with gas sponsorship
const smartAccountClient = createSmartAccountClient({
  account: kernelAccount,
  chain: sepolia,
  bundlerTransport: http(PIMLICO_URL),
  paymaster: pimlicoClient,
  paymasterContext: { sponsorshipPolicyId: 'sp_your_policy_id' }, // Optional
  userOperation: {
    estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast
  }
});

// 5. Send gasless transaction
const txHash = await smartAccountClient.sendTransaction({
  to: '0xYourContract',
  data: '0x...',
  value: 0n
});
```

---

## 3. Pimlico Paymaster on Ethereum Sepolia

Pimlico provides both bundler and paymaster through a **single unified endpoint**.

### Contract Addresses

| Contract | Address | Notes |
|----------|---------|-------|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Legacy |
| **EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | **Use this** |
| Pimlico Paymaster v6 | `0x00000000000000fB866DaAA79352cC568a005D96` | Reference only |

### Free Tier Limits (Testnets)

- **1,000,000 API credits/month** (~1,300 user ops, ~950 sponsored)
- **500 requests/minute** rate limit
- **$0 subscription**, no credit card
- **Free sponsorship** on testnets (10% surcharge on mainnet only)

### Sponsorship Policy

Configure via Pimlico dashboard: global spending limits, per-user quotas, contract allowlists, time expiration. Reference by policy ID in code.

### Privy Dashboard Configuration

Add to Wallet Configuration → Smart wallets:
- **Bundler URL**: `https://api.pimlico.io/v2/11155111/rpc?apikey=YOUR_KEY`
- **Paymaster URL**: Same as above

---

## 4. Base Sepolia Alternative (Quick Prototyping)

For hackathon speed, Base Sepolia offers a **zero-configuration paymaster**:

```
https://paymaster.base.org
```

| Factor | Ethereum Sepolia + Pimlico | Base Sepolia Free |
|--------|---------------------------|-------------------|
| API key | Required | **None** |
| Setup time | 15-30 min | **5 min** |
| Bundler | Included | Bring your own |
| EntryPoint | v0.6 + v0.7 | v0.6 only |
| Policy control | Full | None |
| Mainnet gas | $1-5+ | **$0.001-0.01** |

**Recommendation**: Start with Base Sepolia for rapid validation, switch to Ethereum Sepolia for production if you need L1 settlement or broader integrations.

### Minimal Base Sepolia Integration

```javascript
const paymasterData = await fetch('https://paymaster.base.org', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_paymasterAndDataForUserOperation',
    params: [userOp, '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789', '0x14A34']
  })
}).then(r => r.json());
```

---

## 5. Deterministic Key Derivation

Derive AES-256 encryption keys from wallet signatures for evidence encryption.

### Critical Rule: Use EOA Signer, Not Smart Wallet

Smart wallet signatures (EIP-1271) are **not guaranteed deterministic**—they can involve multi-sig logic or state-dependent validation. Always sign with Privy's **embedded wallet** (the EOA that controls the smart wallet).

### Recommended: EIP-712 Typed Data

EIP-712 provides clearer user consent and phishing resistance:

```javascript
const ENCRYPTION_KEY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 11155111, // Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000'
};

const ENCRYPTION_KEY_TYPES = {
  EncryptionKeyRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'keyVersion', type: 'uint256' }
  ]
};

const typedData = {
  domain: ENCRYPTION_KEY_DOMAIN,
  types: ENCRYPTION_KEY_TYPES,
  primaryType: 'EncryptionKeyRequest',
  message: {
    purpose: 'Derive master encryption key',
    application: 'witness-protocol',
    keyVersion: 1
  }
};

// Sign with EOA (embedded wallet), not smart wallet
const signature = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [walletAddress, JSON.stringify(typedData)]
});
```

### HKDF Key Derivation

```javascript
async function deriveEncryptionKey(signature, walletAddress) {
  // Normalize signature to low-s for determinism
  const normalized = normalizeSignature(signature);
  const sigBytes = hexToBytes(normalized.slice(2));

  // Deterministic salt from app context
  const salt = new TextEncoder().encode(`witness-protocol:${walletAddress.toLowerCase()}`);
  const info = new TextEncoder().encode('AES-256-GCM-master-key');

  // Import as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw', sigBytes, 'HKDF', false, ['deriveKey']
  );

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    { name: 'HKDF', salt, info, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,  // non-extractable for security
    ['encrypt', 'decrypt']
  );
}

function normalizeSignature(sig) {
  const secp256k1n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const r = sig.slice(0, 66);
  let s = BigInt('0x' + sig.slice(66, 130));
  const v = sig.slice(130);
  if (s > secp256k1n / 2n) s = secp256k1n - s;
  return r + s.toString(16).padStart(64, '0') + v;
}
```

### Security Considerations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Signature exposure | HIGH | Never store; re-derive each session |
| Cross-app reuse | MEDIUM | Include appId + address in domain/salt |
| Smart wallet inconsistency | MEDIUM | Sign with embedded wallet only |
| Phishing | HIGH | Use EIP-712 with clear message |
| IV reuse | CRITICAL | Generate fresh random 12-byte IV per encryption |

---

## 6. zkDID Options for Ethereum Sepolia

### Comparison

| Provider | Sepolia Support | Integration Time | Best For |
|----------|-----------------|------------------|----------|
| **Semaphore** | Native | 4-8 hours | Anonymous group membership |
| **World ID** | Native | 8-16 hours | Sybil resistance (proof-of-humanity) |
| **EAS** | Native | 2-4 hours | Simple attestations, no ZK |
| Polygon ID | Indirect (Amoy) | 2-5 days | Complex credential schemas |
| zkPass | Native | 8-16 hours | Web2 reputation bridging |

### Semaphore (Recommended for MVP)

Best for: "Prove I'm in the trusted witness group without revealing which member I am"

```bash
npx @semaphore-protocol/cli create witness-groups --template monorepo-ethers
cd witness-groups && yarn
yarn deploy --network sepolia
```

**Contract Integration:**
```solidity
import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

contract WitnessAttestation {
    ISemaphore public semaphore;
    uint256 public witnessGroupId;
    mapping(uint256 => bool) public usedNullifiers;

    function attestEvidence(
        uint256 merkleTreeRoot,
        uint256 evidenceHash,      // signal
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external {
        require(!usedNullifiers[nullifierHash], "Already attested");

        semaphore.verifyProof(
            witnessGroupId,
            merkleTreeRoot,
            evidenceHash,
            nullifierHash,
            proof
        );

        usedNullifiers[nullifierHash] = true;
        emit EvidenceAttested(evidenceHash, block.timestamp);
    }
}
```

### World ID (Add Post-MVP for Sybil Resistance)

Best for: "Prove I'm a unique human, not a bot or duplicate account"

**Contract Addresses (Sepolia):**
- Router: `0x469449f251692e0779667583026b5a1e99512157`
- Identity Manager: `0xb2ead588f14e69266d1b87936b75325181377076`

**Verification Levels:**
- **Orb**: Biometric iris scan, highest assurance, required for on-chain
- **Device**: Phone-based, lower assurance, off-chain only

```javascript
import { IDKitWidget, VerificationLevel } from '@worldcoin/idkit';

<IDKitWidget
  app_id="app_staging_xxx"
  action="witness-attestation"
  verification_level={VerificationLevel.Orb}
  onSuccess={async (proof) => {
    await contract.verifyAndAttest(
      proof.merkle_root,
      proof.nullifier_hash,
      proof.proof
    );
  }}
/>
```

### EAS (Lightweight Alternative)

Best for: Simple attestations without ZK complexity

**Sepolia Addresses:**
- EAS: `0xC2679fBD37d54388Ce493F1DB75320D236e1815e`
- Schema Registry: `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0`

Supports both on-chain and off-chain attestations with EIP-712 signatures.

---

## 7. Architecture Decisions: What's Hard to Change Later

### Design Upfront (Hard to Retrofit)

| Decision | Why It Matters |
|----------|----------------|
| **Smart wallet type** | Changing = new address, users lose assets |
| **Nullifier storage pattern** | On-chain mapping must exist from deployment |
| **EOA vs smart wallet for signing** | Key derivation depends on this |
| **IndexedDB schema for credentials** | Migration is painful |

### Easy to Add Later

- Semaphore group integration
- World ID verification
- Additional credential types
- Paymaster/bundler provider changes
- New ZK circuits (additive)

### Key Insight

**zkDID creates separate identity keys independent of your wallet.** Polygon ID uses Baby Jubjub curves derived from a seed you can get from a wallet signature. Your smart wallet type doesn't constrain zkDID—it layers cleanly after the core wallet flow works.

---

## 8. Recommended Build Order

```
Phase 1: Foundation (Week 1-2)
├── Privy authentication (email/social)
├── Embedded wallet creation
├── PWA scaffolding with iframe setup
└── Signature-based encryption key derivation

Phase 2: Gasless Transactions (Week 2-3)
├── permissionless.js + Kernel smart account
├── Pimlico bundler + paymaster integration
├── First gasless transaction working
└── Smart wallet deployment on first tx

Phase 3: Evidence Flow (Week 3-4)
├── Evidence encryption with derived key
├── IPFS upload with merkle root
├── On-chain registration contract
└── Basic playback/verification

Phase 4: Trust Layer (Week 4+)
├── Semaphore for anonymous witness groups
├── Attestation contract integration
├── ZK proof generation (client-side WASM)
└── Optional: World ID for sybil resistance
```

---

## 9. Environment Configuration

```bash
# .env for Ethereum Sepolia
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_PRIVY_CLIENT_ID=your-privy-client-id
VITE_PIMLICO_API_KEY=your-pimlico-api-key
VITE_BUNDLER_URL=https://api.pimlico.io/v2/11155111/rpc?apikey=${VITE_PIMLICO_API_KEY}
VITE_ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032
VITE_CHAIN_ID=11155111

# Alternative: Base Sepolia (simpler, no API key)
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_PAYMASTER_URL=https://paymaster.base.org
VITE_ENTRYPOINT_V06=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
VITE_CHAIN_ID=84532
```

### Sepolia ETH Faucets

| Faucet | Amount | Requirement |
|--------|--------|-------------|
| Google Cloud | Varies | None |
| Chainstack | 0.5 ETH/24h | 0.002 ETH on mainnet |
| Alchemy | 0.5 ETH | 0.001 ETH on mainnet |
| Sepolia PoW | Varies | Proof-of-work |

---

## 10. Complete Integration Flow

```
User visits PWA
       ↓
Privy login modal (email/social/passkey)
       ↓
Embedded EOA wallet auto-created (Privy's TEE)
       ↓
Request EIP-712 signature for key derivation
       ↓
Derive AES-256-GCM master encryption key
       ↓
Smart wallet address computed (deterministic, not yet deployed)
       ↓
User records evidence → encrypt → upload to IPFS
       ↓
First on-chain tx → Smart wallet deployed → Merkle root registered
       ↓
Pimlico sponsors gas → Bundler submits UserOperation
       ↓
[Future] Join Semaphore group → Generate ZK proofs for attestations
```

---

## Summary

For Witness Protocol, the optimal stack is:

1. **Privy `@privy-io/js-sdk-core`** for PWA-compatible auth + embedded wallet
2. **Kernel smart account** via permissionless.js for future module flexibility
3. **Pimlico on Ethereum Sepolia** for production-path gasless transactions (or Base Sepolia for rapid prototyping)
4. **EIP-712 signature → HKDF → AES-256-GCM** for deterministic encryption keys (always use EOA signer)
5. **Semaphore** for anonymous witness group membership (MVP)
6. **World ID** for sybil resistance (post-MVP)
7. **EAS** as lightweight attestation alternative if ZK complexity is prohibitive

**Critical decisions to lock in early**: Smart wallet type (Kernel), signer separation (EOA for keys, smart wallet for transactions), nullifier storage pattern.

**Easy to add later**: zkDID providers, additional credential types, policy configurations.
