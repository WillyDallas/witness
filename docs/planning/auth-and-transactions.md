# Witness Protocol: Auth & Transaction Architecture

Technical documentation for how authentication, wallet management, and gasless transactions work in the Witness Protocol PWA.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AUTH & WALLET STACK                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   Email Login (Privy)                                                        │
│        ↓                                                                     │
│   Embedded Wallet (EOA) ─── Signs transactions & key derivation             │
│        ↓                                                                     │
│   Kernel Smart Account ─── ERC-4337 account abstraction                     │
│        ↓                                                                     │
│   Pimlico Paymaster ─── Sponsors gas fees on Sepolia                        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Authentication Flow

### First Login (Fresh User)

1. **Email Verification** (`privy.auth.email.sendCode` / `loginWithCode`)
   - User enters email → receives 6-digit code → verifies
   - Privy creates session, stores access token in LocalStorage

2. **Embedded Wallet Creation** (`privy.embeddedWallet.create`)
   - Privy creates an EOA (Externally Owned Account) in a secure iframe
   - Wallet is recoverable via Privy's key management
   - Address example: `0x056caE049B4F656E4543d2d9051540A2C4aBCa96`

3. **Smart Account Initialization** (Kernel via permissionless.js)
   - Creates a Kernel smart account with EOA as owner
   - Address is **counterfactual** - computed deterministically but NOT deployed yet
   - Address example: `0x650687A45300c6a2f25eE3Da48A48097e7033204`

4. **Encryption Key Derivation** (EIP-712 signature → HKDF)
   - User signs a typed data message with their EOA
   - Signature is normalized and run through HKDF to derive AES-256-GCM key
   - Key is non-extractable (Web Crypto API security)

### Session Restore (Page Reload)

```
Page Load
    ↓
checkSession() ─── Verify Privy access token exists
    ↓
getCachedUser() ─── Retrieve user from localStorage
    ↓
getOrCreateWallet() ─── Reconnect to existing embedded wallet
    ↓
initializeSmartAccount() ─── Recompute counterfactual address
    ↓
getOrDeriveEncryptionKey() ─── Use cached signature from sessionStorage
    ↓
Ready (no prompts needed)
```

### Session Persistence Implementation

| Data | Storage | Lifetime | Purpose |
|------|---------|----------|---------|
| Privy access token | LocalStorage (managed by Privy) | Until logout/expiry | Proves authenticated session |
| User object | LocalStorage (`witness_privy_user`) | Until logout | js-sdk-core doesn't persist user |
| Encryption signature | SessionStorage (`witness_enc_sig`) | Browser session | Avoids re-signing on reload |

**Security tradeoff**: The encryption signature in sessionStorage means a page reload won't prompt for signature, but closing the browser will. This is acceptable for demo purposes but should be reviewed for production.

---

## Wallet Architecture

### EOA (Embedded Wallet)
- **Type**: Standard Ethereum account
- **Managed by**: Privy (in secure iframe)
- **Purpose**: Signs all transactions and key derivation requests
- **Key point**: This is the "owner" of the smart account

### Smart Account (Kernel)
- **Type**: ERC-4337 smart contract wallet
- **Implementation**: ZeroDev Kernel v0.3.1
- **Purpose**: Enables gasless transactions via paymaster
- **Key point**: Not deployed until first transaction

### Address Relationship
```
EOA Address: 0x056caE...   (Privy embedded wallet)
     ↓
     └── Owner of ──→ Smart Account: 0x650687...  (Kernel)
```

The smart account address is derived deterministically from:
- EOA address (owner)
- Kernel factory address
- Salt (default)
- EntryPoint version (0.7)

---

## Gasless Transactions

### How It Works

1. **User Operation (UserOp)** is created instead of a regular transaction
2. **Bundler** (Pimlico) collects UserOps and submits them to the network
3. **Paymaster** (Pimlico) pays the gas fee, not the user
4. **EntryPoint** contract validates and executes the UserOp

### Sending a Transaction

```javascript
import { getClient } from './lib/authState.js';

// Get the smart account client (configured with paymaster)
const client = getClient();

// Send a gasless transaction
const txHash = await client.sendTransaction({
  to: '0x...contractAddress',
  data: encodeFunctionData({
    abi: contractAbi,
    functionName: 'someFunction',
    args: [arg1, arg2]
  })
});
```

### First Transaction = Smart Account Deployment

The first UserOp automatically:
1. Deploys the Kernel smart account contract
2. Executes the intended transaction

Both are bundled into a single UserOp and paid for by the paymaster.

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/smartAccount.js` | Kernel account + Pimlico client setup |
| `src/lib/authState.js` | Centralized state, exposes `getClient()` |

---

## Smart Account Client API

The `smartAccountClient` from permissionless.js provides:

```javascript
// Send transaction (most common)
await client.sendTransaction({ to, data, value });

// Send UserOperation directly (advanced)
await client.sendUserOperation({ callData });

// Write to contract (convenience wrapper)
await client.writeContract({ abi, address, functionName, args });

// Get account address
client.account.address;
```

---

## Environment Variables

```bash
# Privy (auth)
VITE_PRIVY_APP_ID=...
VITE_PRIVY_CLIENT_ID=...

# Pimlico (bundler + paymaster)
VITE_PIMLICO_API_KEY=...
```

---

## Next Steps: Contract Deployment

### What Needs to Happen

1. **Initialize Foundry** in the repo
   ```bash
   cd witness
   forge init contracts --no-commit
   ```

2. **Create WitnessRegistry Contract**
   - Minimal: `mapping(address => bytes32) public merkleRoots`
   - Function: `setMerkleRoot(bytes32 root)`
   - Event: `MerkleRootUpdated(address indexed user, bytes32 root)`

3. **Deploy to Sepolia**
   ```bash
   forge create --rpc-url $SEPOLIA_RPC --private-key $DEPLOYER_KEY src/WitnessRegistry.sol:WitnessRegistry
   ```

4. **Test Gasless Transaction**
   - Add a "Test Transaction" button in the PWA
   - Call `setMerkleRoot` with a dummy value
   - First call will deploy the smart account + execute the function

### Testing the Paymaster

To verify the paymaster is working:

```javascript
// In browser console after login:
import { getClient } from './lib/authState.js';

const client = getClient();
const hash = await client.sendTransaction({
  to: '0x0000000000000000000000000000000000000000',
  data: '0x',
  value: 0n
});
console.log('Transaction hash:', hash);
```

This sends a no-op transaction that:
- Deploys the smart account (first time only)
- Proves the paymaster is sponsoring gas

---

## Key Insights

1. **EOA never holds ETH** - All transactions go through the smart account with paymaster sponsorship

2. **Smart account is counterfactual** - The address exists before deployment; first tx deploys it

3. **Session persistence uses two caches**:
   - User object in localStorage (Privy doesn't persist in js-sdk-core)
   - Encryption signature in sessionStorage (avoids re-signing)

4. **Signature normalization is critical** - ECDSA signatures can have two valid forms; we normalize to ensure deterministic key derivation

5. **Pimlico handles both bundler and paymaster** - Single API key, single endpoint

---

## File Reference

```
witness-pwa/src/
├── lib/
│   ├── privy.js          # Privy SDK init, login, wallet creation, session
│   ├── smartAccount.js   # Kernel smart account, Pimlico client
│   ├── encryption.js     # Key derivation, encrypt/decrypt, caching
│   └── authState.js      # Centralized state manager
├── ui/
│   └── loginModal.js     # Login flow orchestration
└── main.js               # App entry, camera, recording
```
