# Privy + Pimlico + zkDID wallet integration for PWA on Sepolia

**Native smart wallet support is unavailable in Privy's vanilla JavaScript SDK**, requiring custom account abstraction implementation via permissionless.js and Pimlico. The good news: this architecture actually provides more flexibility for zkDID integration, which can be cleanly layered after the core wallet flow works. Privy's `@privy-io/js-sdk-core` package (v0.58.5) handles authentication and embedded wallet creation, while Pimlico provides free testnet sponsorship with **1,000,000 API credits monthly**. For zkDID, World ID and Semaphore offer the best Sepolia support, with EAS (Ethereum Attestation Service) providing a lightweight alternative.

---

## Privy vanilla JavaScript SDK requires manual smart wallet implementation

Privy offers `@privy-io/js-sdk-core` for non-React applications, but it comes with significant caveats. This is officially described as a **"low-level JavaScript library"** with frequent breaking changes—Privy recommends contacting their team before production use. The critical limitation: native smart wallet integration exists only in React and React Native SDKs. For vanilla JS and PWAs, you must implement account abstraction manually using permissionless.js.

### Initialization and embedded wallet setup

```javascript
import Privy, { LocalStorage, getUserEmbeddedEthereumWallet, getEntropyDetailsFromUser } from '@privy-io/js-sdk-core';
import { sepolia } from 'viem/chains';

const privy = new Privy({
  appId: 'your-privy-app-id',
  clientId: 'your-privy-client-id', // From Dashboard
  supportedChains: [sepolia],
  storage: new LocalStorage() // Or custom implementation for PWA
});

// Critical: Manual iframe setup for secure context
const iframe = document.createElement('iframe');
iframe.src = privy.embeddedWallet.getURL();
iframe.style.display = 'none';
document.body.appendChild(iframe);
privy.setMessagePoster(iframe.contentWindow);
window.addEventListener('message', (e) => privy.embeddedWallet.onMessage(e.data));
```

Authentication flows work identically to React—email OTP, SMS, and OAuth are all supported. After login, you retrieve the embedded wallet provider and can convert it to a viem wallet client. The **EntryPoint v0.7 address** on Sepolia is `0x0000000071727De22E5E9d8BAf0edAc6f37da032`, used for ERC-4337 operations.

### Custom smart wallet implementation with permissionless.js

Since native smart wallets aren't available, you'll use ZeroDev's Kernel account or similar through permissionless.js:

```javascript
import { createSmartAccountClient } from 'permissionless';
import { toKernelSmartAccount } from 'permissionless/accounts';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { entryPoint07Address } from 'viem/account-abstraction';
import { providerToSmartAccountSigner } from 'permissionless';

const smartAccountSigner = await providerToSmartAccountSigner(privyProvider);
const kernelSmartAccount = await toKernelSmartAccount({
  client: publicClient,
  signer: smartAccountSigner,
  entryPoint: entryPoint07Address,
});
```

PWA-specific considerations include Safari's strict storage limits (**50MB for installable files**) and limited service worker support on iOS. OAuth redirect handling requires careful URL management in standalone mode. The embedded wallet's iframe-based secure context generally works, though testing on iOS Safari is essential.

---

## Pimlico offers generous free tier for Sepolia development

Pimlico's testnet support is excellent—the free tier provides **1,000,000 API credits monthly** with a rate limit of 500 requests per minute. This translates to approximately **1,300 unsponsored user operations** or **950 sponsored operations** per month, more than sufficient for development. Testnet paymaster sponsorship is completely free with no surcharges.

### Key contract addresses on Ethereum Sepolia

| Contract | Address |
|----------|---------|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| Pimlico SingletonPaymasterV6 | `0x00000000000000fB866DaAA79352cC568a005D96` |

The API endpoint format is `https://api.pimlico.io/v2/sepolia/rpc?apikey={YOUR_KEY}`. Pimlico manages paymaster deposits automatically—you don't need to fund contracts directly. They bill at month-end for mainnet usage with a **10% surcharge** on actual gas costs for sponsored transactions.

### Sponsorship policy configuration

The Pimlico dashboard allows granular control: global spending limits, per-user quotas, contract allowlists, and time-based expiration. Policies are referenced by ID in your code:

```javascript
const smartAccountClient = createSmartAccountClient({
  account: kernelSmartAccount,
  chain: sepolia,
  bundlerTransport: http(pimlicoUrl),
  paymaster: pimlicoClient,
  paymasterContext: { sponsorshipPolicyId: 'sp_your_policy_id' },
  userOperation: {
    estimateFeesPerGas: async () => (await pimlicoClient.getUserOperationGasPrice()).fast,
  },
});
```

The sponsored transaction flow works as follows: your client calls `pm_sponsorUserOperation`, Pimlico validates against your policy, returns signed `paymasterAndData`, you sign the full UserOperation, submit via the bundler, and the EntryPoint validates the paymaster signature before execution.

---

## Deterministic key derivation requires EOA signatures, not smart wallets

Deriving encryption keys from wallet signatures depends on **RFC 6979 deterministic ECDSA**, which most EOA wallets implement. The critical insight: smart wallet signatures (EIP-1271) are **not guaranteed to be deterministic** because they can involve multi-sig coordination, state-dependent validation logic, or variable signature ordering.

### Recommended cryptographic flow

Use EIP-712 typed data signing (`eth_signTypedData_v4`) for maximum determinism and security:

```javascript
const ENCRYPTION_KEY_DOMAIN = {
  name: 'MyApp Encryption',
  version: '1',
  chainId: 11155111, // Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000'
};

const ENCRYPTION_KEY_TYPES = {
  EncryptionKeyRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'keyVersion', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' }
  ]
};
```

The signature flows through HKDF (HMAC-based Key Derivation Function) to produce an AES-256-GCM key:

```javascript
async function deriveEncryptionKey(signature, salt, info) {
  const signatureBytes = hexToBytes(signature);
  const encoder = new TextEncoder();
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw', signatureBytes, 'HKDF', false, ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    { name: 'HKDF', salt: encoder.encode(salt), info: encoder.encode(info), hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable
    ['encrypt', 'decrypt']
  );
}
```

For encryption, generate a **fresh random 12-byte IV** for every operation—never reuse an IV with the same key. Use domain separation via distinct salt values for different purposes (data encryption vs. file encryption vs. backup keys). The key should be set as non-extractable for security.

### Handling smart wallet users

Detect smart wallets by checking if the address has deployed code. For users with smart wallets, either require signing via the underlying EOA signer (which Privy's embedded wallet is), or fall back to generating a random key stored encrypted in IndexedDB. Since Privy's embedded wallet is itself an EOA that controls the smart wallet, you can safely use its signatures for deterministic key derivation.

---

## World ID and Semaphore provide the strongest Sepolia zkDID support

After evaluating six providers, World ID and Semaphore emerge as the best options for Ethereum Sepolia integration. Sismo appears deprecated with no updates since late 2023. Polygon ID (now Privado ID) added Sepolia support in October 2024 but remains more complex to integrate.

### World ID contract addresses on Sepolia

| Contract | Address |
|----------|---------|
| World ID Router | `0x469449f251692e0779667583026b5a1e99512157` |
| Identity Manager | `0xb2ead588f14e69266d1b87936b75325181377076` |

World ID distinguishes between **Orb verification** (biometric iris scan, highest assurance, required for on-chain proofs) and **Device verification** (phone-based, lower assurance, off-chain only). The SDK is `@worldcoin/idkit` and works in vanilla JavaScript. Integration complexity is medium—you implement cloud verification for off-chain apps or call the World ID Router for on-chain verification.

### Semaphore for anonymous membership proofs

Semaphore operates on a different model: users create identities (private key + commitment), join groups represented as Merkle trees, and generate ZK proofs of membership without revealing which member they are. This is ideal for anonymous voting, signaling, or access control. Version 4 is current, with packages including `@semaphore-protocol/core`, `@semaphore-protocol/identity`, and `@semaphore-protocol/proof`.

### EAS as lightweight alternative

Ethereum Attestation Service provides the simplest integration path if you don't need zero-knowledge proofs. The **EAS contract on Sepolia** is at `0xC2679fBD37d54388Ce493F1DB75320D236e1815e` with Schema Registry at `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0`. EAS supports both on-chain and off-chain attestations with EIP-712 signatures, making it flexible for credential storage without the complexity of ZK circuits.

---

## Architecture decisions that are hard to retrofit versus easy to change

The most consequential early decision is **smart account type**. Changing from Safe to Kernel later means your users get a new wallet address—they'd lose access to assets at the old address. Lock this in early and don't change after users have real assets. Recommended choice: **Kernel (ZeroDev)** for its ERC-7579 module support, which provides flexibility for future credential storage patterns.

### Easy to change later

Paymaster and bundler providers are just URL configuration changes. ZK circuit selection is additive—you download new circuits as needed. Credential schemas can be extended without breaking existing data. The zkDID provider itself can be swapped, though APIs differ.

### Integration order recommendation

1. **Week 1-2**: Privy authentication + embedded wallet + PWA scaffolding
2. **Week 2-3**: Pimlico bundler integration + smart wallet deployment + paymaster
3. **Week 4+**: zkDID SDK integration + credential storage + proof generation

The key insight: **zkDID creates separate identity keys independent of your wallet**. Polygon ID uses Baby Jubjub (BJJ) curves for identity, derived from a seed you can obtain from the wallet signature. Your smart wallet type doesn't constrain zkDID integration at all—you're free to layer identity after the core wallet flow works.

### PWA-specific storage architecture

Store credentials as encrypted JSON in IndexedDB with a key derived from the user's signature. ZK circuits are large (**~100MB+**), so implement progressive loading with IndexedDB caching. For offline support, pre-fetch circuits during onboarding when the user has connectivity.

---

## Complete integration flow from login to gasless transaction

The end-to-end user journey connects all components:

```
User visits PWA → Privy login modal (email/social/passkey)
         ↓
Embedded EOA wallet auto-created (secured in Privy's TEE infrastructure)
         ↓
Request signature for encryption key derivation (EIP-712 typed data)
         ↓
Smart wallet address computed (deterministic from EOA, not yet deployed)
         ↓
User initiates first transaction → Smart wallet deployed on-chain
         ↓
UserOperation created → Pimlico sponsors gas → Bundler submits
         ↓
Optional: Initialize zkDID, scan issuer QR, claim credentials locally
```

### Minimal viable implementation code

```javascript
// 1. Initialize Privy
const privy = new Privy({ appId, clientId, supportedChains: [sepolia], storage: new LocalStorage() });
// Setup iframe (shown earlier)

// 2. Authenticate
await privy.auth.email.sendCode('user@example.com');
const { user } = await privy.auth.email.loginWithCode('user@example.com', '123456');

// 3. Get embedded wallet
let wallet = getUserEmbeddedEthereumWallet(user);
if (!wallet) await privy.embeddedWallet.create({});
const { entropyId, entropyIdVerifier } = getEntropyDetailsFromUser(user);
const provider = await privy.embeddedWallet.getEthereumProvider({ wallet, entropyId, entropyIdVerifier });

// 4. Create smart account client
const smartAccountSigner = await providerToSmartAccountSigner(provider);
const kernelAccount = await toKernelSmartAccount({ client: publicClient, signer: smartAccountSigner, entryPoint: entryPoint07Address });
const smartClient = createSmartAccountClient({
  account: kernelAccount,
  chain: sepolia,
  bundlerTransport: http(pimlicoUrl),
  paymaster: pimlicoClient
});

// 5. Derive encryption key (using EOA signer, not smart wallet)
const signature = await provider.request({ method: 'eth_signTypedData_v4', params: [walletAddress, typedData] });
const encryptionKey = await deriveEncryptionKey(signature, salt, info);

// 6. First gasless transaction
const txHash = await smartClient.sendTransaction({ to: recipientAddress, value: 0n, data: '0x' });
```

---

## Testnet resources and development costs

For Sepolia ETH, the most reliable faucets require minimal mainnet holdings to prevent abuse. **Chainstack** provides 0.5 ETH every 24 hours if you hold 0.002 ETH on mainnet. **Alchemy** similarly provides 0.5 ETH with a 0.001 ETH mainnet requirement. The **Sepolia PoW Faucet** offers an alternative requiring computational proof-of-work instead of mainnet holdings.

Development on testnet is effectively free. Pimlico's free tier covers development needs without credit card. The main costs appear only on mainnet: Pimlico charges the 10% gas surcharge for sponsored transactions, and you pay actual gas costs. Budget approximately **$0.01 per sponsored user operation** on mainnet including gas and surcharges.

Differences between Sepolia and mainnet are primarily operational: mainnet gas prices fluctuate more, bundler competition affects inclusion times, and paymaster policies need stricter rate limits to prevent abuse. ZK proof generation times remain similar since they're client-side WebAssembly operations unaffected by network choice.

---

## Conclusion

Building this integration in vanilla JavaScript is more work than React but entirely feasible. The critical path runs through Privy's embedded wallet → permissionless.js smart account → Pimlico paymaster, with zkDID cleanly layerable afterward. Three architectural decisions merit early attention: commit to Kernel accounts for module flexibility, use the EOA signer (not smart wallet) for deterministic key derivation, and design IndexedDB storage for offline credentials before implementing zkDID.

For zkDID specifically, starting with EAS attestations provides the fastest path to working credentials, while World ID offers the strongest "proof of humanity" if that's the primary use case. Save Polygon ID/Privado ID integration for when you need sophisticated credential schemas and selective disclosure proofs—its complexity is justified only for advanced identity requirements. The **total development timeline** ranges from 2 weeks for minimal viable (embedded wallet + gasless transactions) to 8-12 weeks for full zkDID integration with ZK proof generation.