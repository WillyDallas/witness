# Witness Protocol Architecture

This document provides a high-level overview of the Witness Protocol system architecture as implemented through Phases 0-7.

## Purpose

Witness Protocol enables secure evidence capture for journalists, activists, and domestic abuse survivors. Content is:
- **Encrypted**: Only authorized group members can decrypt
- **Immutable**: Merkle root on-chain proves content hasn't changed
- **Shareable**: Groups share a symmetric secret for collective access
- **Anonymously Attestable**: Group members can verify content without revealing their identity

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           USER INTERFACE                                 │
│   • Login Modal (Privy email/social auth)                               │
│   • Groups Modal (create/join via QR)                                   │
│   • Content Browser (list + filter)                                     │
│   • Content Detail (decrypt + attest)                                   │
│   • Recording UI (capture + upload)                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         SERVICE LAYER                                    │
│   • privy.js          - Authentication & embedded wallet                │
│   • smartAccount.js   - Kernel ERC-4337 smart account                   │
│   • encryption.js     - AES-256-GCM + HKDF key derivation               │
│   • storage.js        - Encrypted localStorage                          │
│   • groups.js         - Group creation & QR invite handling             │
│   • content.js        - Upload orchestration                            │
│   • contentDiscovery.js - On-chain content indexing                     │
│   • contentDecrypt.js - Download & decryption                           │
│   • identity.js       - Semaphore identity management                   │
│   • attestation.js    - ZK proof generation & submission                │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       EXTERNAL SERVICES                                  │
│   • Privy         - Email/social login + embedded EOA wallet            │
│   • Pimlico       - ERC-4337 bundler + paymaster (gasless)              │
│   • Pinata        - IPFS pinning service                                │
│   • Base Sepolia  - L2 blockchain (testnet)                             │
│   • Semaphore     - ZK group membership proofs                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       SMART CONTRACT                                     │
│   WitnessRegistry.sol on Base Sepolia                                   │
│   • User registration                                                   │
│   • Group management (with parallel Semaphore groups)                   │
│   • Content commitment (Merkle root + manifest CID)                     │
│   • Anonymous attestations (ZK proof verification)                      │
└─────────────────────────────────────────────────────────────────────────┘
```

## Two-Layer Privacy Model

The system uses two parallel mechanisms for different privacy needs:

| Layer | Purpose | Technology | What's Public | What's Private |
|-------|---------|------------|---------------|----------------|
| **Access Control** | Who can decrypt | Address-based groups | Group membership | Content (encrypted) |
| **Attestations** | Prove verification | Semaphore ZK proofs | Attestation count | Who attested |

This design allows:
- Public proof that "N people verified this content"
- Complete anonymity for attestors
- Sybil-resistance (only real group members can attest)
- Double-attestation prevention (nullifiers)

## Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Frontend | Vite + Vanilla JS | PWA with service worker |
| Auth | Privy | Email/social login |
| Wallet | Kernel (ERC-4337) | Smart account with gasless tx |
| Gas | Pimlico | Paymaster sponsorship |
| Chain | Base Sepolia | L2 testnet (~2s blocks) |
| Storage | IPFS via Pinata | Decentralized content |
| Encryption | AES-256-GCM | Authenticated encryption |
| Key Derivation | HKDF | From wallet signature |
| ZK Proofs | Semaphore V4 | Anonymous attestations |

## Implementation Phases

All phases are complete:

1. **Phase 0**: Project setup (Vite, dependencies)
2. **Phase 1**: Authentication & wallet (Privy + smart account)
3. **Phase 2**: Smart contract & registration (gasless)
4. **Phase 3**: Encryption & key derivation
5. **Phase 4**: Group creation & joining (QR codes)
6. **Phase 5**: Content upload (IPFS + on-chain commit)
7. **Phase 6**: Content discovery & decryption
8. **Phase 7**: Anonymous attestations (Semaphore ZK)

## Key Documentation

- [Anonymous Attestations](./anonymous-attestations.md) - ZK proof system
- [Encryption & Key Derivation](./encryption-key-derivation.md) - Cryptographic design
- [Content Storage](./content-storage.md) - IPFS + on-chain architecture

## Deployment

- **Production URL**: https://witness.squirrlabs.xyz
- **Smart Contract**: Base Sepolia (verified on Basescan)
- **Build**: `cd witness-pwa && npm run build`
- **Deploy**: `rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/`
