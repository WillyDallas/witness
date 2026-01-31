# Witness Protocol: Hackathon Architecture v3

**Privacy-Preserving Evidence Capture with Web of Trust**

Core insight: Evidence is only as credible as the witnesses who can vouch for it. Witness Protocol lets trusted contacts view, verify, and attest to your evidence — while revealing only what you choose to share.

---

## The Product

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   "I recorded something important. My trusted contacts can see it,      │
│    verify it's unmodified, and vouch for it — without revealing         │
│    who they are or how many I have."                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**User A (Witness):**
- Records video → encrypted chunks upload to IPFS in real-time
- Merkle root updates on-chain with each chunk
- Evidence persists even if phone is seized mid-recording

**User B (Trusted Contact):**
- Scans QR code to sync with User A
- Can decrypt and view User A's videos from IPFS
- Sees new uploads in real-time (watches merkle root updates)
- Can "vouch" for evidence (on-chain attestation)
- Their identity is never revealed — only that *someone* vouched

**Verification:**
- Anyone can verify evidence exists and is unmodified (public merkle root)
- Only trusted contacts can view content (encrypted)
- Attestation count is public, attestor identities are private (ZK proof)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WITNESS PROTOCOL                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│  │   CAPTURE    │────►│   STORAGE    │────►│    PROOF     │            │
│  │              │     │              │     │              │            │
│  │ • Chunking   │     │ • IPFS       │     │ • Merkle     │            │
│  │ • Encryption │     │ • Pinata     │     │ • On-chain   │            │
│  │ • Metadata   │     │ • Manifest   │     │ • Timestamps │            │
│  └──────────────┘     └──────────────┘     └──────────────┘            │
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│  │   IDENTITY   │────►│   SHARING    │────►│ ATTESTATION  │            │
│  │              │     │              │     │              │            │
│  │ • Privy      │     │ • QR Sync    │     │ • Vouch      │            │
│  │ • Paymaster  │     │ • Key Share  │     │ • ZK Count   │            │
│  │ • zkDID      │     │ • P2P First  │     │ • Privacy    │            │
│  └──────────────┘     └──────────────┘     └──────────────┘            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────┐           │
│  │                    STRETCH: MATRIX                       │           │
│  │                                                          │           │
│  │  • Trust circle coordination                             │           │
│  │  • Real-time notifications                               │           │
│  │  • Multi-user key distribution                           │           │
│  └─────────────────────────────────────────────────────────┘           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Identity & Wallet

**Purpose:** User authentication, transaction signing, key derivation, gasless UX

| Subcomponent | Description |
|--------------|-------------|
| Privy Integration | Email/social login → embedded wallet → smart wallet |
| Paymaster Setup | Pimlico on Sepolia for gasless transactions |
| Key Derivation | Deterministic encryption keys from wallet signatures |
| zkDID Foundation | Privacy-preserving identity claims for selective disclosure |

**Outputs:**
- User has a wallet they don't need to think about
- Encryption keys recoverable from wallet
- Foundation for "prove X without revealing Y"

---

### 2. Capture Pipeline

**Purpose:** Record video, chunk it, prepare for encrypted upload

| Subcomponent | Description |
|--------------|-------------|
| Video Capture | MediaRecorder API with camera/mic access |
| Chunking | 10-second segments via `timeslice` parameter |
| Metadata Collection | GPS, timestamp, device info per chunk |
| Hash Generation | SHA-256 of raw video before encryption |
| Merkle Tree | Build tree incrementally, update root per chunk |

**Outputs:**
- Stream of video chunks ready for encryption
- Running merkle root that commits to all chunks so far
- Metadata bundle for each chunk

---

### 3. Encryption

**Purpose:** Protect evidence so only trusted contacts can view

| Subcomponent | Description |
|--------------|-------------|
| Session Key Generation | AES-256-GCM key per recording session |
| Chunk Encryption | Encrypt each chunk with session key |
| Key Wrapping | Wrap session key for each trusted contact's public key |
| Key Recovery | Derive master key from wallet signature for self-recovery |

**Key Question to Resolve:**
- How do trusted contacts get the decryption key?
- Options: QR code exchange, on-chain encrypted key registry, direct P2P

**Outputs:**
- Encrypted chunks (only trusted contacts can decrypt)
- Wrapped keys for each authorized viewer

---

### 4. Storage (IPFS + Pinata)

**Purpose:** Decentralized, censorship-resistant evidence storage

| Subcomponent | Description |
|--------------|-------------|
| Pinata Setup | API keys, gateway configuration |
| Chunk Upload | Upload encrypted chunks, get CIDs |
| Manifest Creation | JSON linking all chunks, hashes, metadata, merkle root |
| Manifest Upload | Upload manifest to IPFS |

**Outputs:**
- Each chunk has a CID (content-addressed, tamper-evident)
- Manifest CID serves as the "evidence ID"
- Evidence retrievable by anyone with CID (but only decryptable by trusted contacts)

---

### 5. On-Chain Proof

**Purpose:** Immutable timestamp and integrity anchor

| Subcomponent | Description |
|--------------|-------------|
| Registry Contract | Store merkle roots with timestamps |
| Incremental Updates | Update root as chunks upload (or batch on session end) |
| Event Emission | Emit events so trusted contacts can watch for new evidence |
| Verification Function | Anyone can verify a chunk hash against registered root |

**Contract Interface (Simple):**
```solidity
function registerEvidence(bytes32 merkleRoot, string manifestCid) external;
function updateMerkleRoot(bytes32 sessionId, bytes32 newRoot) external;
function verify(bytes32 sessionId, bytes32 chunkHash, bytes32[] proof) external view returns (bool);
```

**Outputs:**
- Evidence existence provable via block timestamp
- Trusted contacts can watch contract events for new uploads
- Public verifiability of integrity

---

### 6. Trusted Contact Sync

**Purpose:** Add trusted contacts who can view and vouch for your evidence

| Subcomponent | Description |
|--------------|-------------|
| QR Code Generation | Encode connection info + public key |
| QR Code Scanning | Parse and establish trust relationship |
| Key Exchange | Share decryption capability with new contact |
| Contact Registry | Track who your trusted contacts are (local or on-chain) |
| Watch for Updates | Trusted contacts monitor chain for new evidence from you |

**Key Question to Resolve:**
- Is the trust relationship on-chain or off-chain?
- How does contact B get the decryption key for contact A's videos?
- P2P key exchange vs. on-chain encrypted key storage

**Outputs:**
- Trusted contacts can decrypt your videos
- Trusted contacts see when you upload new evidence
- Relationship can be revoked

---

### 7. Attestation & Selective Disclosure

**Purpose:** Trusted contacts vouch for evidence, revealing minimal information

| Subcomponent | Description |
|--------------|-------------|
| Vouch Action | Trusted contact attests "I viewed this evidence" |
| Privacy-Preserving Count | Prove "N people vouched" without revealing who |
| Selective Disclosure | Reveal only chosen attributes (e.g., "attester has zkDID") |
| Attestation Registry | On-chain record of vouches (ZK or plaintext based on privacy needs) |

**ZK Applications:**
- Prove you have N trusted contacts without revealing identities
- Prove an attester meets criteria (has zkDID, is in your trust circle) without revealing which one
- Prove evidence has attestations without linking to specific attestors

**Outputs:**
- Evidence credibility increases with attestations
- Attestor privacy preserved
- Verifiable claims about attestation count/quality

---

### 8. Playback & Verification

**Purpose:** View evidence and verify integrity

| Subcomponent | Description |
|--------------|-------------|
| Fetch from IPFS | Retrieve encrypted chunks via CID |
| Decrypt | Use session key to decrypt chunks |
| Playback | Stitch and play video in browser |
| Integrity Check | Verify chunk hashes against merkle root |
| Attestation Display | Show vouch count and ZK-verified properties |

**Outputs:**
- Trusted contacts can watch the video
- Anyone can verify evidence wasn't tampered with
- Clear display of attestation status

---

### 9. STRETCH: Matrix Coordination

**Purpose:** Real-time sync, notifications, multi-party key distribution

| Subcomponent | Description |
|--------------|-------------|
| Synapse Deployment | Self-hosted Matrix server |
| Room per Trust Circle | E2EE room for each witness + their contacts |
| Key Distribution | Matrix handles session key sharing |
| Real-time Notifications | Contacts notified instantly on new evidence |
| Presence | See who's online, who's seen evidence |

**Why Stretch:**
- Significant infrastructure overhead
- Core functionality works P2P without it
- Adds polish but not essential for demo

**Outputs:**
- Seamless real-time experience
- Automatic key management
- Foundation for overlapping trust circles

---

## Build Order

```
PHASE 1: Foundation
├── 1. Identity & Wallet (Privy + Paymaster)
└── 2. Capture Pipeline (Chunking + Metadata)

PHASE 2: Core Loop  
├── 3. Encryption (AES-256-GCM + Key Derivation)
├── 4. Storage (Pinata + IPFS)
└── 5. On-Chain Proof (Registry Contract)

PHASE 3: Sharing
├── 6. Trusted Contact Sync (QR + Key Exchange)
└── 8. Playback & Verification

PHASE 4: Trust Layer
└── 7. Attestation & Selective Disclosure (Vouch + ZK Count)

PHASE 5: Stretch
└── 9. Matrix Coordination
```

---

## Open Questions (To Resolve Per Component)

| Component | Question |
|-----------|----------|
| Encryption | How do trusted contacts receive decryption keys? P2P handshake? On-chain encrypted registry? |
| Trusted Sync | Is the trust graph on-chain or local? Can you revoke access? |
| Attestation | What ZK scheme for private attestation count? Semaphore? Custom circuit? |
| zkDID | Which provider? What claims are useful to prove about attestors? |
| Playback | Stream from IPFS or download-then-play? MSE support? |
| Updates | Per-chunk merkle updates or batch on session end? Gas tradeoffs? |

---

## Demo Narrative

> "Watch this: I start recording. Every 10 seconds, an encrypted chunk uploads to IPFS and the merkle root updates on-chain.
>
> My trusted contact Sarah scanned my QR code earlier. She can see my evidence appearing in real-time on her phone. She can decrypt it, watch it, verify it's unmodified.
>
> Sarah taps 'Vouch' — she's now attested that she witnessed this evidence. But here's the key: nobody knows it was Sarah. All anyone can see is that this evidence has one attestation from a verified human.
>
> If I get five friends to vouch, the evidence shows '5 attestations from verified contacts' — but their identities stay private. Web of trust, with selective disclosure."

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Chunk upload latency | < 5 seconds per 10s chunk |
| Time to first trusted contact sync | < 30 seconds (QR scan to viewing) |
| Attestation creation | Gasless, < 10 seconds |
| Evidence verification | Anyone can verify in < 5 seconds |
| Privacy | Zero attestor identities leaked |
