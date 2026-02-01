# Witness Protocol: Complete Implementation Guide

**Privy Smart Wallet + Human Passport + Worldcoin** integration delivers gasless, privacy-preserving identity verification for your personal safety toolkit. This guide provides everything a coding agent needs—exact package versions, contract addresses, complete code examples, and architectural patterns for Base Sepolia.

## Core architecture decisions validated

The research confirms your stack is well-suited for the use case. **Privy's smart wallets** use ERC-4337 account abstraction with paymaster support, enabling gasless transactions critical for safety app adoption. **Human Passport** (formerly Gitcoin Passport, acquired by Holonym Foundation for $10M in February 2025) offers 35+ credential types with a "Unique Humanity Score" system. **World ID** provides the strongest sybil resistance through Orb biometric verification with on-chain ZK proof verification.

---

## Privy smart wallet implementation

### NPM packages and versions

| Package | Version | Purpose |
|---------|---------|---------|
| `@privy-io/react-auth` | **3.8.1** | Main Privy React SDK |
| `permissionless` | Latest | Required for smart wallets |
| `viem` | 2.x | EVM interactions |
| `wagmi` | 2.x | Optional wagmi integration |
| `@privy-io/wagmi` | Latest | Wagmi connector |
| `@tanstack/react-query` | 5.x | Required by wagmi |

```bash
npm install @privy-io/react-auth permissionless viem
npm install @privy-io/wagmi wagmi @tanstack/react-query  # optional
```

### Smart wallet configuration

Privy supports **six smart account types**: Kernel (ZeroDev), Light Account (Alchemy), Safe, Biconomy, Thirdweb, and Coinbase Smart Wallet. For Witness Protocol, **Light Account** or **Kernel** with Pimlico paymaster provides the best balance of features and gas efficiency.

```typescript
// providers.tsx
'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { SmartWalletsProvider } from '@privy-io/react-auth/smart-wallets';
import { baseSepolia, base } from 'viem/chains';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
          logo: '/witness-protocol-logo.png',
        },
        loginMethods: ['email', 'google', 'apple', 'passkey'],
        embeddedWallets: {
          createOnLogin: 'all-users',
          showWalletUIs: true,
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia, base],
      }}
    >
      <SmartWalletsProvider>
        {children}
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}
```

**Dashboard configuration** (Privy Console):
1. Navigate to **Embedded wallets** → **Smart wallet** tab
2. Enable smart wallets toggle
3. Select **Light Account** or **Kernel**
4. Add Base Sepolia with Pimlico bundler URL: `https://api.pimlico.io/v2/base-sepolia/rpc?apikey=YOUR_KEY`

### Key hooks and methods

**usePrivy** provides authentication state and basic signing:
```typescript
import { usePrivy } from '@privy-io/react-auth';

const { ready, authenticated, user, login, logout, signMessage, signTypedData } = usePrivy();
```

**useSmartWallets** handles all smart wallet operations:
```typescript
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';

const { client, getClientForChain } = useSmartWallets();

// client.signMessage, client.signTypedData, client.sendTransaction
```

**Accessing wallet addresses**:
```typescript
const { user } = usePrivy();

// Smart wallet address
const smartWallet = user?.linkedAccounts.find(a => a.type === 'smart_wallet');
console.log(smartWallet?.address);

// Embedded EOA address (signer)
const embeddedWallet = user?.linkedAccounts.find(
  a => a.type === 'wallet' && a.walletClientType === 'privy'
);
```

### Signing for encryption key derivation

For deriving encryption keys from signatures (useful for evidence encryption):

```typescript
const { client } = useSmartWallets();

// Deterministic signature for key derivation
const encryptionSeed = await client.signMessage({
  message: 'Witness Protocol Encryption Key v1'
});

// Derive AES-256 key using Web Crypto
const encoder = new TextEncoder();
const keyMaterial = await crypto.subtle.importKey(
  'raw',
  encoder.encode(encryptionSeed),
  'PBKDF2',
  false,
  ['deriveKey']
);

const encryptionKey = await crypto.subtle.deriveKey(
  {
    name: 'PBKDF2',
    salt: encoder.encode('witness-protocol-salt'),
    iterations: 100000,
    hash: 'SHA-256'
  },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  true,
  ['encrypt', 'decrypt']
);
```

### EIP-712 typed data signing for check-ins

```typescript
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';

const { client } = useSmartWallets();

const domain = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 84532, // Base Sepolia
  verifyingContract: '0xYourContractAddress' as `0x${string}`,
};

const types = {
  CheckIn: [
    { name: 'userId', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'locationHash', type: 'bytes32' },
    { name: 'contentMerkleRoot', type: 'bytes32' },
  ],
};

const signature = await client.signTypedData({
  domain,
  types,
  primaryType: 'CheckIn',
  message: {
    userId: '0x...',
    timestamp: BigInt(Date.now()),
    locationHash: '0x...',
    contentMerkleRoot: '0x...',
  },
});
```

### Gasless transactions with paymaster

```typescript
import { useSmartWallets } from '@privy-io/react-auth/smart-wallets';
import { encodeFunctionData } from 'viem';

const { client } = useSmartWallets();

// Single transaction - gas automatically sponsored
const txHash = await client.sendTransaction({
  to: WITNESS_CONTRACT,
  data: encodeFunctionData({
    abi: WITNESS_ABI,
    functionName: 'recordEvidence',
    args: [contentHash, metadata],
  }),
  value: 0n,
});

// Batch transactions (approve + record in one tx)
const txHash = await client.sendTransaction({
  calls: [
    { to: TOKEN_ADDRESS, data: approveData },
    { to: WITNESS_CONTRACT, data: recordData },
  ],
});
```

**Critical gotcha**: Smart wallet signatures use **EIP-1271** (contract signature verification), not standard ECDSA. On-chain verification must account for this.

---

## Human Passport integration

Human Passport offers **Sybil-resistant identity verification** with 2M+ users and privacy-preserving ZK credentials. Users collect "stamps" (verifiable credentials) to build a **Unique Humanity Score** (threshold: 20 recommended).

### NPM packages and API access

```bash
npm install @passportxyz/passport-embed  # Embedded React component
```

**Legacy SDK** (Ceramic-based, still functional):
```bash
npm install @gitcoinco/passport-sdk-reader @gitcoinco/passport-sdk-verifier
```

**API Access Setup**:
1. Go to https://developer.passport.xyz/
2. Connect wallet and create API key
3. Create a "Scorer" to get your Scorer ID

### Available credentials (stamps)

- **Government ID/KYC**: Holonym KYC (16 points), Binance BABT, Coinbase verification
- **Biometrics**: human.tech 3D Facial Liveness Detection
- **Phone**: Phone number verification via human.tech
- **Social**: Google, LinkedIn, Discord, X (Twitter), GitHub, Steam
- **Blockchain**: ETH activity across chains (0-100 model score), NFT history, ENS, Lens, zkSync
- **Web2**: Uber receipts, Amazon purchase confirmations
- **Web3**: Gitcoin Grants participation, Guild.xyz, Snapshot proposals

### Integration with Passport Embed (recommended)

```tsx
import { PassportEmbed } from '@passportxyz/passport-embed';

function VerifyIdentity() {
  return (
    <PassportEmbed
      theme="dark"
      scorerId={process.env.NEXT_PUBLIC_PASSPORT_SCORER_ID}
      apiKey={process.env.NEXT_PUBLIC_PASSPORT_API_KEY}
      threshold={20}
      onSuccess={(data) => {
        console.log('Verified:', data.score, data.stamps);
        // Link to user profile, create attestation
      }}
      onError={(error) => console.error(error)}
    />
  );
}
```

### REST API verification

**Base URL**: `https://api.passport.xyz`

```typescript
// Check user's Passport score
async function checkPassportScore(address: string) {
  const response = await fetch(
    `https://api.passport.xyz/v2/stamps/${SCORER_ID}/score/${address}`,
    {
      headers: {
        'X-API-KEY': process.env.PASSPORT_API_KEY!,
        'Content-Type': 'application/json'
      }
    }
  );
  
  const data = await response.json();
  return {
    score: parseFloat(data.score),          // e.g., 33.538
    isPassing: data.passing_score,          // true if >= threshold
    threshold: data.threshold,              // configured threshold
    stamps: data.stamp_scores,              // { Discord: "0.516", ... }
    expiration: data.expiration_timestamp
  };
}
```

**Models API** for frictionless verification (no stamps required):
```typescript
// ML-based Sybil detection from on-chain activity
const response = await fetch(
  `https://api.passport.xyz/v2/models/score/${address}?model=aggregate`
);
// Returns: -1 (insufficient data) or 0-100 (0=likely Sybil, 100=likely human)
```

### On-chain verification via smart contracts

Human Passport uses **EAS (Ethereum Attestation Service)** for on-chain attestations.

**Decoder contract** (recommended entry point):
```typescript
import { ethers } from 'ethers';

const decoderAddress = "0x..."; // Network-specific - see docs.passport.xyz
const contract = new ethers.Contract(decoderAddress, DECODER_ABI, provider);

const passportInfo = await contract.getPassport(userAddress);
const score = await contract.getScore(userAddress);
```

**Solidity gating**:
```solidity
interface IPassportDecoder {
    function getScore(address user) external view returns (uint256);
}

contract PassportGated {
    IPassportDecoder public decoder;
    uint256 public constant THRESHOLD = 20;

    modifier onlyVerified() {
        require(decoder.getScore(msg.sender) >= THRESHOLD, "Score too low");
        _;
    }

    function protectedAction() external onlyVerified {
        // Only verified humans can call
    }
}
```

### Key GitHub repositories

- Main app: https://github.com/passportxyz/passport
- Embed component: https://github.com/passportxyz/passport-embed
- Scorer API: https://github.com/passportxyz/passport-scorer
- SDK: https://github.com/passportxyz/passport-sdk

---

## Worldcoin World ID integration (stretch goal)

World ID provides the **strongest sybil resistance** through Orb biometric verification with cryptographic uniqueness guarantees.

### NPM packages

| Package | Version | Purpose |
|---------|---------|---------|
| `@worldcoin/idkit` | **2.4.2** | React SDK |
| `@worldcoin/idkit-core` | 2.1.0 | Core library |
| `@worldcoin/idkit-standalone` | 2.2.5 | Vanilla JS |

```bash
npm install @worldcoin/idkit
```

### Verification levels

| Level | Uniqueness | On-Chain Support | Use Case |
|-------|------------|------------------|----------|
| **Device** | Medium (per device) | ❌ No | Quick verification, lower trust |
| **Orb** | Strong (per human) | ✅ Yes | High-trust actions, DeFi, governance |

**Only Orb verification supports on-chain verification** (groupId = 1).

### IDKit React component

```tsx
import { IDKitWidget, ISuccessResult, VerificationLevel } from '@worldcoin/idkit';

function WorldIDVerify({ walletAddress }: { walletAddress: string }) {
  const handleVerify = async (proof: ISuccessResult) => {
    // Send to backend for verification
    const response = await fetch('/api/verify-worldid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proof),
    });
    if (!response.ok) throw new Error('Verification failed');
  };

  const onSuccess = (result: ISuccessResult) => {
    console.log('World ID verified!', result.nullifier_hash);
    // Store verification, update user profile
  };

  return (
    <IDKitWidget
      app_id={process.env.NEXT_PUBLIC_WORLD_APP_ID!}  // "app_xxxxx"
      action="verify-human"
      signal={walletAddress}  // Bind proof to wallet
      verification_level={VerificationLevel.Orb}
      handleVerify={handleVerify}
      onSuccess={onSuccess}
    >
      {({ open }) => (
        <button onClick={open}>Verify with World ID</button>
      )}
    </IDKitWidget>
  );
}
```

**Next.js SSR fix**:
```tsx
import dynamic from 'next/dynamic';
const IDKitWidget = dynamic(
  () => import('@worldcoin/idkit').then(mod => mod.IDKitWidget),
  { ssr: false }
);
```

### Cloud verification backend

```typescript
// POST /api/verify-worldid
import { hashToField } from '@worldcoin/idkit-core/hashing';

export async function POST(req: Request) {
  const proof = await req.json();
  
  const response = await fetch(
    `https://developer.worldcoin.org/api/v2/verify/${process.env.WORLD_APP_ID}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nullifier_hash: proof.nullifier_hash,
        merkle_root: proof.merkle_root,
        proof: proof.proof,
        verification_level: proof.verification_level,
        action: 'verify-human',
        signal_hash: hashToField(proof.signal).toString(),
      }),
    }
  );

  const { verified } = await response.json();
  return Response.json({ success: verified });
}
```

### On-chain verification contract addresses

**Base Sepolia Testnet**:
| Contract | Address |
|----------|---------|
| World ID Router | `0x42FF98C4E85212a5D31358ACbFe76a621b50fC02` |
| Bridged World ID | `0x163b09b4fE21177c455D850BD815B6D583732432` |

**Other networks** (mainnet):
- Ethereum: `0x163b09b4fe21177c455d850bd815b6d583732432`
- World Chain: `0x17B354dD2595411ff79041f930e491A4Df39A278`
- Optimism: `0x57f928158C3EE7CDad1e4D8642503c4D0201f611`
- Polygon: `0x515f06B36E6D3b707eAecBdeD18d8B384944c87f`

**⚠️ Base Mainnet is not yet officially supported—only Base Sepolia testnet.**

### Solidity verification

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IWorldID } from "@worldcoin/world-id-contracts/interfaces/IWorldID.sol";
import { ByteHasher } from "@worldcoin/world-id-contracts/libraries/ByteHasher.sol";

contract WitnessWorldID {
    using ByteHasher for bytes;

    IWorldID internal worldId;
    uint256 internal constant GROUP_ID = 1;  // Orb only
    uint256 internal externalNullifierHash;
    
    mapping(uint256 => bool) internal nullifierUsed;

    constructor(IWorldID _worldId, string memory _appId, string memory _action) {
        worldId = _worldId;
        externalNullifierHash = abi
            .encodePacked(abi.encodePacked(_appId).hashToField(), _action)
            .hashToField();
    }

    function verifyAndRegister(
        address signal,
        uint256 root,
        uint256 nullifierHash,
        uint256[8] calldata proof
    ) external {
        require(!nullifierUsed[nullifierHash], "Already verified");

        worldId.verifyProof(
            root,
            GROUP_ID,
            abi.encodePacked(signal).hashToField(),
            nullifierHash,
            externalNullifierHash,
            proof
        );

        nullifierUsed[nullifierHash] = true;
        emit UserVerified(signal, nullifierHash);
    }
}
```

**Proof unpacking** (frontend to contract):
```typescript
import { decodeAbiParameters } from 'viem';

const unpackedProof = decodeAbiParameters(
  [{ type: 'uint256[8]' }],
  proof.proof
)[0];
```

### GitHub repositories

- IDKit JS: https://github.com/worldcoin/idkit-js
- Smart contracts: https://github.com/worldcoin/world-id-contracts
- On-chain template: https://github.com/worldcoin/world-id-onchain-template

---

## Combined architecture and on-chain storage

### EAS (Ethereum Attestation Service) on Base

EAS is **natively deployed** on Base as an OP Stack predeploy:

| Contract | Address (Base Mainnet & Sepolia) |
|----------|----------------------------------|
| EAS | `0x4200000000000000000000000000000000000021` |
| Schema Registry | `0x4200000000000000000000000000000000000020` |

**EAS Explorer**: https://base-sepolia.easscan.org

### Recommended schema for Witness Protocol

```typescript
import { SchemaRegistry, EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

// Register schema
const schema = 'address walletAddress, bytes32 worldIdNullifier, bytes32 passportScoreHash, uint64 verificationTimestamp, bool isActive';

const schemaRegistry = new SchemaRegistry('0x4200000000000000000000000000000000000020');
schemaRegistry.connect(signer);

const tx = await schemaRegistry.register({
  schema,
  resolverAddress: '0x0000000000000000000000000000000000000000',
  revocable: true
});

const schemaUID = await tx.wait();
```

### Creating attestations

```typescript
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

const eas = new EAS('0x4200000000000000000000000000000000000021');
eas.connect(signer);

const encoder = new SchemaEncoder(schema);
const encodedData = encoder.encodeData([
  { name: 'walletAddress', value: userAddress, type: 'address' },
  { name: 'worldIdNullifier', value: nullifierHash, type: 'bytes32' },
  { name: 'passportScoreHash', value: keccak256(scoreData), type: 'bytes32' },
  { name: 'verificationTimestamp', value: Math.floor(Date.now() / 1000), type: 'uint64' },
  { name: 'isActive', value: true, type: 'bool' }
]);

const tx = await eas.attest({
  schema: schemaUID,
  data: {
    recipient: userAddress,
    expirationTime: 0n,
    revocable: true,
    data: encodedData
  }
});
```

### Data storage architecture

| Data | Location | Rationale |
|------|----------|-----------|
| Credential Merkle root | On-chain (EAS) | Immutable verification anchor |
| World ID nullifier hash | On-chain | Sybil resistance |
| Passport score hash | On-chain (EAS) | Verification without exposing score |
| Full credential metadata | Off-chain (IPFS) | Privacy, gas efficiency |
| Evidence content | IPFS + Merkle root on-chain | Tamper-proof with privacy |
| User PII | **Never on-chain** | Privacy requirement |

### User flow diagram

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐
│   User      │───>│   Privy     │───>│ Smart Wallet │
│ (Email/     │    │ (Auth)      │    │ (Base)       │
│  Social)    │    │             │    │              │
└─────────────┘    └─────────────┘    └──────────────┘
                          │                    │
        ┌─────────────────┼────────────────────┘
        │                 │
        ▼                 ▼
┌───────────────┐  ┌─────────────────┐
│ Human Passport│  │ World ID        │
│ (Score ≥20)   │  │ (Orb optional)  │
└───────────────┘  └─────────────────┘
        │                 │
        └────────┬────────┘
                 ▼
        ┌─────────────────┐
        │ EAS Attestation │
        │ (On Base)       │
        └─────────────────┘
```

---

## Security and privacy considerations

### What's exposed where

| System | Data Visible | Privacy Protection |
|--------|--------------|-------------------|
| Privy | Email/social (to Privy only) | Keys sharded, TEE-protected, self-custodial |
| Human Passport | Score + stamp types | No PII stored, user controls which stamps |
| World ID | Nothing (ZK proof) | Different nullifiers per action prevent tracking |
| EAS attestations | Schema-defined data | On-chain = public; use off-chain for sensitive data |
| Smart wallet | All transactions | Public blockchain—minimize on-chain data |

### Key security notes

- **World ID proofs valid for 7 days** for on-chain verification
- **Human Passport stamps expire** (90-day refresh cycle for some)
- **Smart wallet type is permanent per user**—changing type in dashboard affects only new users
- **Signal binding is critical**—always bind World ID proofs to wallet address to prevent proof reuse

---

## Implementation timeline estimates

| Component | Complexity | Estimate |
|-----------|------------|----------|
| Privy + Smart Wallet setup | Low | 1-2 days |
| Paymaster integration | Low | 0.5-1 day |
| Human Passport (Embed + API) | Medium | 2-3 days |
| World ID (IDKit + Cloud) | Medium | 2-3 days |
| EAS schema + attestations | Medium | 2-3 days |
| World ID on-chain verification | Medium-High | 3-5 days |
| Full credential system | High | 2-3 weeks |

### Recommended MVP sequence

1. **Days 1-2**: Privy + Smart Wallets + Paymaster
2. **Days 3-5**: Human Passport Embed integration
3. **Days 5-7**: World ID with cloud verification
4. **Days 7-10**: EAS attestations linking credentials to wallet
5. **Week 2+**: On-chain World ID verification, security hardening

---

## Context7 library identifiers for documentation lookup

- Privy: `privy-io/docs` or search "privy smart wallets"
- World ID: `worldcoin/idkit` or `worldcoin/world-id-contracts`
- EAS: `ethereum-attestation-service/eas-sdk`
- Human Passport: `passportxyz/passport-sdk` or `passportxyz/passport-embed`
- Viem: `wevm/viem`
- Permissionless (ERC-4337): `pimlicolabs/permissionless.js`

## Conclusion

This stack provides a robust foundation for Witness Protocol's identity layer. **Privy handles authentication and gasless smart wallets**, **Human Passport provides flexible credential verification** with a low barrier to entry (email/social stamps), and **World ID offers maximum sybil resistance** for high-trust actions. All three integrate cleanly with **EAS attestations on Base** for tamper-proof credential anchoring. The combination of off-chain verification (for speed and privacy) with optional on-chain attestations (for decentralization) gives you architectural flexibility as the product evolves.