# Building Witness Protocol: Privy, Pimlico, and zkDID on Ethereum Sepolia

Privacy-preserving evidence capture requires a carefully orchestrated stack: **Privy's vanilla JS SDK** (`@privy-io/js-sdk-core`) enables email/social authentication with embedded wallets in PWA contexts, **Pimlico** handles gasless transactions via ERC-4337 on Sepolia with generous free-tier limits, and **Semaphore** emerges as the optimal zkDID solution for hackathon timelines. Base Sepolia offers a compelling alternative with its no-API-key paymaster at `paymaster.base.org`. This report provides complete integration guidance including code examples, security considerations, and architectural recommendations.

## Privy offers vanilla JS SDK with full PWA support

Privy provides **`@privy-io/js-sdk-core`** for non-React applications—a critical finding for vanilla JS PWA development. This low-level library (~50,000+ weekly npm downloads) requires explicit iframe setup for the embedded wallet's secure context but delivers full authentication and signing capabilities.

**Initialization pattern for vanilla JS:**
```javascript
import Privy, { LocalStorage } from '@privy-io/js-sdk-core';

const privy = new Privy({
  appId: 'your-app-id',
  supportedChains: [{ id: 11155111, name: 'sepolia', rpcUrls: ['...'] }],
  storage: new LocalStorage()
});

// Mount secure iframe for embedded wallet
const iframe = document.createElement('iframe');
iframe.src = privy.embeddedWallet.getURL();
iframe.style.display = 'none';
document.body.appendChild(iframe);
privy.setMessagePoster(iframe.contentWindow);
```

PWA operation is **fully supported**—Privy even maintains an official PWA template at `github.com/privy-io/create-privy-pwa`. Keys are stored using **IndexedDB/localStorage** with end-to-end encryption, and the system requires HTTPS (with localhost exception for development). The primary limitation: offline signing requires session keys or delegated signing patterns since authentication and signing operations communicate with Privy's secure enclave.

**Authentication flow example (email):**
```javascript
// Send verification code
await privy.auth.email.sendCode('user@example.com');

// Complete login
const { user, is_new_user } = await privy.auth.email.loginWithCode(
  'user@example.com', 
  '123456'
);

// Access embedded wallet
const wallet = user.linked_accounts.find(a => a.type === 'wallet');
const address = wallet.address; // 0x...
```

**Critical caveat:** Native smart wallet integration exists only in React/React Native SDKs. For vanilla JS, you must use **permissionless.js** to wrap Privy's embedded wallet into a smart account. This adds complexity but provides maximum flexibility.

## Pimlico configuration for Ethereum Sepolia enables gasless transactions

Pimlico serves both bundler and paymaster functions through a **single unified endpoint**:
```
https://api.pimlico.io/v2/11155111/rpc?apikey=YOUR_API_KEY
```

**EntryPoint contract addresses on Ethereum Sepolia:**
| Version | Address | Recommendation |
|---------|---------|----------------|
| v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Legacy support |
| **v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | **Use for new projects** |

EntryPoint v0.7 offers improved gas efficiency and enhanced features—the clear choice for new development.

**Free tier limits (testnets):**
- **1,000,000 API credits/month** (~1,300 user operations, ~950 if sponsored)
- **500 requests/minute** rate limit
- **$0 subscription**, no credit card required
- Verifying paymaster surcharge: **FREE on testnets**

**Complete Privy + Pimlico integration using permissionless.js:**
```javascript
import { createSmartAccountClient } from 'permissionless';
import { toSimpleSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { entryPoint07Address } from 'viem/account-abstraction';

const PIMLICO_URL = `https://api.pimlico.io/v2/11155111/rpc?apikey=${API_KEY}`;

// 1. Create clients
const publicClient = createPublicClient({ chain: sepolia, transport: http() });
const pimlicoClient = createPimlicoClient({
  transport: http(PIMLICO_URL),
  entryPoint: { address: entryPoint07Address, version: '0.7' }
});

// 2. Get Privy embedded wallet provider
const provider = await privy.embeddedWallet.getEthereumProvider({...});

// 3. Create smart account
const smartAccount = await toSimpleSmartAccount({
  owner: provider,
  client: publicClient,
  entryPoint: { address: entryPoint07Address, version: '0.7' }
});

// 4. Create smart account client with gas sponsorship
const smartAccountClient = createSmartAccountClient({
  account: smartAccount,
  chain: sepolia,
  bundlerTransport: http(PIMLICO_URL),
  paymaster: pimlicoClient,
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

For the Privy dashboard configuration: add `https://api.pimlico.io/v2/11155111/rpc?apikey=YOUR_KEY` to both Bundler URL and Paymaster URL fields under Wallet Configuration → Smart wallets.

## Base Sepolia provides a simpler alternative with no API key required

Base Sepolia offers a **zero-configuration paymaster** that dramatically simplifies initial development:

**Free paymaster endpoint (no API key):**
```
https://paymaster.base.org
```

**Contract addresses:**
- Paymaster: `0xf5d253B62543C6Ef526309D497f619CeF95aD430`
- EntryPoint: `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` (v0.6)

**Direct comparison:**

| Factor | Ethereum Sepolia + Pimlico | Base Sepolia Free Paymaster |
|--------|---------------------------|----------------------------|
| API key required | Yes | **No** |
| Setup time | 15-30 minutes | **5 minutes** |
| Bundler included | Yes | No (bring your own) |
| EntryPoint version | v0.6 + v0.7 | v0.6 only |
| Policy control | Full | None |
| Mainnet path | Ethereum mainnet ($1-5+ gas) | Base mainnet ($0.001-0.01 gas) |
| Documentation | Excellent | Good (GitHub README) |

**Recommendation:** Start with **Base Sepolia** for rapid hackathon prototyping (zero config), then consider Ethereum Sepolia for production if you need L1 settlement or broader protocol integrations. The free paymaster endpoint eliminates account setup friction entirely.

**Minimal Base Sepolia integration:**
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

## Deterministic key derivation from signatures requires careful implementation

Deriving AES-256 encryption keys from wallet signatures is **cryptographically sound** when properly implemented, but smart wallet compatibility introduces important caveats.

**Key principles:**
- EIP-191 `personal_sign` produces **deterministic signatures** for EOA wallets (including Privy embedded wallets)
- Use **HKDF** (not PBKDF2) since input is already high-entropy
- **Never store signatures**—re-derive keys on-demand
- **Normalize signatures** to low-s values to prevent malleability issues

**Complete Web Crypto API implementation:**
```javascript
async function deriveKeyFromSignature(signature, walletAddress, appId = 'witness-protocol') {
  // Deterministic message format (no timestamps!)
  const message = `${appId}:v1:encryption-key:${walletAddress.toLowerCase()}`;
  
  // Request signature from wallet (do this at session start)
  // const signature = await signer.signMessage(message);
  
  // Normalize signature (ensure low-s for determinism)
  const normalized = normalizeSignature(signature);
  const sigBytes = hexToBytes(normalized.slice(2));
  
  // Deterministic salt derived from app context
  const salt = new TextEncoder().encode(`${appId}:${walletAddress.toLowerCase()}`);
  const info = new TextEncoder().encode('AES-256-GCM-encryption-key');
  
  // Import signature as HKDF key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw', sigBytes, 'HKDF', false, ['deriveKey']
  );
  
  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    { name: 'HKDF', salt, info, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,  // non-extractable
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

**Smart wallet critical consideration:** Use the **embedded wallet** (EOA signer) for key derivation, not the smart wallet. Smart wallets may implement custom signature verification logic that breaks determinism. Privy's embedded wallet produces standard EIP-191 signatures that are deterministic, but the smart wallet wrapper can modify output format.

**Security risk matrix:**
| Risk | Severity | Mitigation |
|------|----------|------------|
| Signature exposure | HIGH | Never store; re-derive each session |
| Cross-app reuse | MEDIUM | Include appId + address in signed message |
| Smart wallet inconsistency | MEDIUM | Sign with embedded wallet, not smart wallet |
| Phishing | HIGH | Use clear messages; consider EIP-712 |

## Semaphore emerges as the optimal zkDID choice for hackathon development

Among zkDID providers supporting Ethereum Sepolia, **Semaphore** offers the lowest integration friction (**4-8 hours to MVP**) with excellent PSE/Ethereum Foundation backing.

**Provider comparison for Sepolia:**
| Provider | Sepolia Support | Integration Time | Best For |
|----------|-----------------|------------------|----------|
| **Semaphore** | ✅ Native | 4-8 hours | Group membership proofs |
| World ID | ✅ `0x469449f...2157` | 8-16 hours | Sybil resistance |
| zkPass | ✅ Native | 8-16 hours | Web2 reputation bridging |
| Polygon ID | ⚠️ Indirect (Amoy) | 2-5 days | Custom credentials |
| Holonym | ✅ EVM | 12-24 hours | KYC/government ID |

**Semaphore quick start:**
```bash
npx @semaphore-protocol/cli create witness-protocol --template monorepo-ethers
cd witness-protocol && yarn
yarn deploy --network sepolia
```

**Witness Protocol contract integration:**
```solidity
import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

contract WitnessProtocol {
    ISemaphore public semaphore;
    uint256 public witnessGroupId;
    mapping(uint256 => bool) public usedNullifiers;
    
    function submitWitness(
        uint256 merkleTreeRoot,
        uint256 evidenceHash,      // signal
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external {
        require(!usedNullifiers[nullifierHash], "Already submitted");
        
        semaphore.verifyProof(
            witnessGroupId, 
            merkleTreeRoot, 
            evidenceHash, 
            nullifierHash, 
            proof
        );
        
        usedNullifiers[nullifierHash] = true;
        // Store witness attestation...
    }
}
```

**World ID for sybil resistance** (add after MVP):
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

**World ID Sepolia addresses:**
- Router: `0x469449f251692e0779667583026b5a1e99512157`
- Identity Manager: `0xb2ead588f14e69266d1b87936b75325181377076`

## Architectural decisions that affect later retrofitting

Several decisions become difficult to change after initial deployment. Plan these upfront:

**Design early:**
- **Nullifier storage pattern**: On-chain mapping for sybil resistance must exist from deployment
- **Smart wallet type**: Changing from SimpleAccount to Kernel later requires migration
- **Signer separation**: Keep embedded wallet address (for signing/key derivation) distinct from smart wallet address (for transactions)

**Easy to add later:**
- Semaphore group integration
- World ID verification widget
- Additional credential types
- Off-chain credential storage

**Recommended integration order:**
```
Phase 1 (Hackathon MVP):
├── Privy embedded wallet (js-sdk-core)
├── Base Sepolia free paymaster OR Pimlico on Ethereum Sepolia
├── Signature-based key derivation for evidence encryption
└── Semaphore for anonymous witness groups

Phase 2 (Post-hackathon):
├── Upgrade to smart wallet via permissionless.js
├── Add World ID for proof-of-personhood
├── Implement session keys for better UX
└── Add custom credentials via Polygon ID
```

## Complete environment configuration

```bash
# .env for Ethereum Sepolia
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_PIMLICO_API_KEY=your-pimlico-api-key
VITE_BUNDLER_URL=https://api.pimlico.io/v2/11155111/rpc?apikey=${VITE_PIMLICO_API_KEY}
VITE_ENTRYPOINT_V07=0x0000000071727De22E5E9d8BAf0edAc6f37da032
VITE_CHAIN_ID=11155111

# Alternative: .env for Base Sepolia (simpler)
VITE_PRIVY_APP_ID=your-privy-app-id
VITE_PAYMASTER_URL=https://paymaster.base.org
VITE_ENTRYPOINT_V06=0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789
VITE_CHAIN_ID=84532
```

**Sepolia ETH faucets:**
- Google Cloud: `cloud.google.com/application/web3/faucet/ethereum/sepolia` (no requirements)
- Chainlink: `faucets.chain.link/sepolia` (wallet connect required)
- Chainstack: `chainstack.com/sepolia-faucet/` (0.5 ETH/24h)

## Conclusion

For Witness Protocol's hackathon timeline, the optimal path combines **Privy's vanilla JS SDK** for PWA-compatible authentication, **Base Sepolia's free paymaster** for zero-friction gasless transactions, **HKDF-based key derivation** from embedded wallet signatures for deterministic encryption, and **Semaphore** for privacy-preserving witness groups. This stack minimizes setup time while maintaining a clear upgrade path to Ethereum mainnet with Pimlico, World ID integration for sybil resistance, and custom credentials via Polygon ID. The critical architectural decision: always derive encryption keys from the embedded wallet (not smart wallet) to ensure deterministic signatures, and design nullifier storage patterns upfront even if zkDID integration comes later.