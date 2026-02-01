# Data Chunking & Transport Design

**Purpose**: Technical specification for how Witness Protocol chunks, encrypts, uploads, and anchors video evidence.

**Status**: Design complete, ready for implementation.

**Date**: 2026-02-01

---

## Design Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA CHUNKING & TRANSPORT                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   MediaRecorder (10s chunks)                                                 │
│        │                                                                     │
│        ▼                                                                     │
│   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐  │
│   │ CAPTURE │───▶│ ENCRYPT │───▶│ UPLOAD  │───▶│MANIFEST │───▶│ ANCHOR  │  │
│   │         │    │         │    │         │    │         │    │         │  │
│   │IndexedDB│    │AES-256  │    │ Pinata  │    │  IPFS   │    │On-chain │  │
│   │ backup  │    │  GCM    │    │  IPFS   │    │ update  │    │  root   │  │
│   └─────────┘    └─────────┘    └─────────┘    └─────────┘    └─────────┘  │
│                                                                              │
│   Queue & Continue: Never block capture, retry failures in background        │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Terminology Note

This document uses `sessionId` to represent a recording session. This maps to `contentId` in the broader implementation plan—they are the same identifier. A "session" becomes "content" when recording completes, but the ID remains constant throughout.

| Term | Meaning |
|------|---------|
| `sessionId` / `contentId` | Unique identifier for a recording (UUID, generated at recording start) |
| `groupId` | `keccak256(groupSecret)` - identifies a sharing group |
| `sessionKey` | Random 32-byte key generated per recording for encryption |
| `groupSecret` | 32-byte secret shared among group members for key unwrapping |

---

## Core Design Decisions

### 1. Capture Layer

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Chunk interval | **10 seconds** | Balance between upload granularity and overhead |
| Capture API | MediaRecorder with `timeslice` | Browser-native, works in PWA |
| Local backup | **IndexedDB** | Crash resilience, survives page reload |
| Upload trigger | **ASAP** | Get data off-device as fast as possible |

**Key insight**: Capture is never blocked by upload status. If network is slow, chunks queue locally while recording continues.

---

### 2. Encryption Layer

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Algorithm | **AES-256-GCM** | Authenticated encryption, Web Crypto native |
| Session key | **Random 32 bytes per recording** | Fresh key isolates each session |
| Per-chunk key | **HKDF(sessionKey, chunkIndex)** | Derived keys for each chunk |
| IV | **Fresh 12 bytes per chunk** | Required for AES-GCM security |
| Key distribution | **Wrapped per group** | Session key wrapped with each group's secret |

#### Key Derivation Flow

```
Recording Starts
      │
      ▼
┌─────────────────────────────────┐
│ sessionKey = randomBytes(32)    │  ← Random, ephemeral
└─────────────────────────────────┘
      │
      │  For each chunk:
      ▼
┌─────────────────────────────────┐
│ chunkKey = HKDF(               │
│   ikm: sessionKey,              │
│   salt: "witness-chunk",        │
│   info: chunkIndex (as bytes),  │
│   length: 32                    │
│ )                               │
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│ iv = randomBytes(12)            │  ← Fresh IV per chunk
└─────────────────────────────────┘
      │
      ▼
┌─────────────────────────────────┐
│ encrypted = AES-GCM-encrypt(    │
│   key: chunkKey,                │
│   iv: iv,                       │
│   plaintext: rawChunk           │
│ )                               │
└─────────────────────────────────┘
```

#### Key Wrapping for Groups

Groups are selected **before recording starts**. The session key is wrapped for each selected group:

```javascript
// For each selected group:
wrappedKey = AES-GCM-encrypt(
  key: groupSecret,      // 32-byte group secret
  iv: randomBytes(12),   // Fresh IV for wrapping
  plaintext: sessionKey  // The session key to wrap
)
```

This wrapped key is included in every manifest version, ensuring cutoff recordings remain decryptable by group members.

---

### 3. Transport Layer

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Upload target | **Pinata (IPFS)** | Content-addressed, decentralized |
| Upload strategy | **ASAP with queue** | Minimize data-at-risk on device |
| Confirmation model | **Two-stage** | CID confirmed → On-chain confirmed |
| Failure handling | **Queue & Continue** | Never block capture |

#### Two-Stage Confirmation

A chunk is not fully "safe" until both stages complete:

```
Stage 1: IPFS Confirmation
─────────────────────────
- Upload encrypted chunk to Pinata
- Receive CID back (HTTP 200)
- Chunk is now retrievable from IPFS
- Status: UPLOADED

Stage 2: On-Chain Confirmation
─────────────────────────────
- Submit updated Merkle root to WitnessRegistry
- Wait for transaction confirmation (~2s on Sepolia)
- Chunk existence is now provable via blockchain
- Status: CONFIRMED → Dequeue
```

#### Failure Handling: Queue & Continue

```
Failure Point          │ Behavior
───────────────────────┼─────────────────────────────────────
IPFS chunk upload      │ Queue for retry, continue capturing
Manifest upload        │ Queue for retry, use stale CID for tx
On-chain tx fails      │ Queue for retry, chunks safe on IPFS
On-chain tx reverts    │ Retry with fresh nonce
Network offline        │ Queue all, sync when back online
```

**Critical**: Recording never stops due to upload failures. IndexedDB provides local backup until uploads succeed.

---

### 4. Integrity Layer (Merkle Tree)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Merkle leaves | **Composite hash** | Binds index + content + timing |
| Tree updates | **Per-chunk** | Maximum granularity |
| On-chain commits | **Per-chunk** | ~2s Sepolia blocks make this practical |
| Root storage | **Cumulative** | Single root represents all chunks |

#### Composite Leaf Structure

Each Merkle leaf binds multiple properties together:

```javascript
leaf[i] = SHA256(
  chunkIndex      +  // 4 bytes, big-endian uint32
  plaintextHash   +  // 32 bytes, SHA256 of raw video
  encryptedHash   +  // 32 bytes, SHA256 of encrypted chunk
  capturedAt         // 8 bytes, Unix timestamp in ms
)
```

**Why composite?**
- `chunkIndex` prevents reordering attacks
- `plaintextHash` proves actual video content
- `encryptedHash` allows verification without decryption
- `capturedAt` binds to the capture timeline

#### Incremental Tree Building

```javascript
// On recording start:
const merkleTree = new IncrementalMerkleTree();

// On each chunk:
const leaf = computeLeaf(chunk);
merkleTree.insert(leaf);
const currentRoot = merkleTree.root;

// currentRoot now reflects all chunks so far
```

---

### 5. Manifest Structure

The manifest is the "table of contents" for a recording. It's re-uploaded after each chunk.

```typescript
interface VideoManifest {
  version: 1;

  // Identity
  contentId: string;              // Unique recording ID (UUID)
  sessionId: string;              // On-chain session reference
  uploader: string;               // Ethereum address

  // Timing
  captureStarted: number;         // Unix timestamp (ms)
  lastUpdated: number;            // Unix timestamp (ms)

  // Chunks (grows with each update)
  chunks: ChunkMetadata[];

  // Integrity
  merkleRoot: string;             // Current root (hex)

  // Encryption
  encryption: {
    algorithm: 'aes-256-gcm';
    keyDerivation: 'hkdf-sha256';
  };

  // Access control (set at recording start, included in every version)
  accessList: {
    [groupId: string]: {
      wrappedKey: string;         // Base64 wrapped session key
      iv: string;                 // Base64 IV used for wrapping
    };
  };

  // Recording status
  status: 'recording' | 'complete' | 'interrupted';
}

interface ChunkMetadata {
  index: number;                  // 0, 1, 2, ...
  cid: string;                    // IPFS CID of encrypted chunk
  size: number;                   // Encrypted size in bytes
  duration: number;               // Video duration in ms
  plaintextHash: string;          // SHA256 of raw chunk (hex)
  encryptedHash: string;          // SHA256 of encrypted chunk (hex)
  iv: string;                     // Base64 IV for this chunk
  capturedAt: number;             // Unix timestamp (ms)
  uploadedAt: number;             // Unix timestamp (ms)
}
```

#### Manifest Update Cycle

```
Chunk N captured
      │
      ▼
┌─────────────────────────────────┐
│ 1. Encrypt chunk                │
│ 2. Upload to IPFS → get CID     │
│ 3. Add ChunkMetadata to manifest│
│ 4. Update merkleRoot            │
│ 5. Upload manifest → get new CID│
│ 6. On-chain: setRoot(root, cid) │
└─────────────────────────────────┘
      │
      ▼
Chunk N+1 captured...
```

---

### 6. Chunk Lifecycle State Machine

```
┌─────────────┐
│  CAPTURED   │  Chunk received from MediaRecorder
│             │  Saved to IndexedDB
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  HASHING    │  Computing plaintextHash
│             │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ ENCRYPTING  │  Deriving chunkKey, encrypting
│             │  Computing encryptedHash
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  UPLOADING  │  Uploading to IPFS via Pinata
│             │  Retrying on failure
└──────┬──────┘
       │ (CID received)
       ▼
┌─────────────┐
│  UPLOADED   │  Chunk is on IPFS
│             │  Waiting for manifest + on-chain
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ MANIFESTING │  Adding to manifest, uploading manifest
│             │
└──────┬──────┘
       │ (Manifest CID received)
       ▼
┌─────────────┐
│  ANCHORING  │  Submitting on-chain transaction
│             │
└──────┬──────┘
       │ (Tx confirmed)
       ▼
┌─────────────┐
│ CONFIRMED   │  Fully verified
│             │  Safe to remove from IndexedDB
└─────────────┘
```

---

### 7. On-Chain Interface

```solidity
// WitnessRegistry.sol

// Called per-chunk during recording
function updateSession(
    bytes32 sessionId,
    bytes32 merkleRoot,
    string calldata manifestCid,
    uint256 chunkCount,
    bytes32[] calldata groupIds    // Which groups have access (for attestation verification)
) external;

// Events for trusted contacts to watch
event SessionUpdated(
    bytes32 indexed sessionId,
    address indexed uploader,
    bytes32 merkleRoot,
    string manifestCid,
    uint256 chunkCount,
    bytes32[] groupIds,
    uint256 timestamp
);

// Verification
function verifyChunk(
    bytes32 sessionId,
    bytes32 leafHash,
    bytes32[] calldata proof,
    uint256 leafIndex
) external view returns (bool);

// Check if content is shared with a group (used by attestation verification)
function isContentInGroup(bytes32 sessionId, bytes32 groupId) external view returns (bool);
```

**Why groupIds on-chain?**

Groups are stored on-chain (not just in the manifest) because:
1. **Attestation verification**: The contract must verify "this content is shared with group X" before accepting a Semaphore ZK proof for attestation
2. **Indexing**: Enables `groupContentIndex` mapping for discovery
3. **Semaphore integration**: Links content to the parallel Semaphore groups for anonymous attestations

The manifest's `accessList` still holds the **wrapped keys** (off-chain), while the contract holds the **group membership** (on-chain).

---

### 8. Semaphore Integration (Anonymous Attestations)

This design operates alongside the Semaphore-based attestation system defined in [witness-protocol-implementation-plan.md](../../Wallet-creation-paymaster-zkdid/witness-protocol-implementation-plan.md).

**How they connect:**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TWO-LAYER ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LAYER 1: DATA CHUNKING & TRANSPORT (this document)                 │
│  ─────────────────────────────────────────────────────────────────  │
│  • Capture → Encrypt → Upload → Anchor                              │
│  • Merkle root proves content integrity                             │
│  • groupIds on-chain enable access control verification             │
│  • accessList in manifest holds wrapped keys for decryption         │
│                                                                     │
│  LAYER 2: ANONYMOUS ATTESTATIONS (Semaphore)                        │
│  ─────────────────────────────────────────────────────────────────  │
│  • Each witness group has a parallel Semaphore group                │
│  • Members can attest: "I verified this content"                    │
│  • ZK proof reveals nothing about WHO attested                      │
│  • Contract checks isContentInGroup() before accepting attestation  │
│                                                                     │
│  PUBLIC: Attestation COUNT per content                              │
│  PRIVATE: Which members attested                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Attestation flow (after content upload):**

1. Group member downloads content via this transport layer
2. Member verifies Merkle proof (content matches on-chain root)
3. Member generates Semaphore ZK proof with `scope = sessionId`
4. Contract verifies:
   - `isContentInGroup(sessionId, groupId)` → true
   - Semaphore proof is valid
   - Nullifier not already used
5. `attestationCount[sessionId]++`

**Key point**: The `groupIds` stored on-chain by `updateSession()` enable the contract to verify attestation eligibility without requiring the attestor to reveal their identity.

---

## Verification Flow

How a trusted contact verifies evidence:

```
1. Watch for SessionUpdated events (or query by sessionId)
      │
      ▼
2. Fetch manifest from IPFS (manifestCid from event)
      │
      ▼
3. Verify manifest.merkleRoot matches on-chain root
      │
      ▼
4. For each chunk in manifest.chunks:
   │
   ├─► Fetch encrypted chunk from IPFS (chunk.cid)
   │
   ├─► Verify SHA256(encrypted) === chunk.encryptedHash
   │
   ├─► Unwrap session key using groupSecret
   │
   ├─► Derive chunkKey = HKDF(sessionKey, chunk.index)
   │
   ├─► Decrypt: raw = AES-GCM-decrypt(chunkKey, chunk.iv, encrypted)
   │
   ├─► Verify SHA256(raw) === chunk.plaintextHash
   │
   └─► Verify leaf is in Merkle tree (optional, root already verified)
      │
      ▼
5. Concatenate all raw chunks → playable video
      │
      ▼
6. Video is verified authentic ✓
      │
      ▼
7. (Optional) Attest to evidence
   │
   ├─► Generate Semaphore ZK proof (scope = sessionId)
   │
   ├─► Submit attestToContent(sessionId, groupId, proof)
   │
   └─► Attestation count increments anonymously
```

---

## Implementation Checklist

### Services to Build

- [ ] `ChunkProcessor` - Handles encrypt/hash/upload cycle
- [ ] `UploadQueue` - Manages retry logic, never blocks capture
- [ ] `ManifestManager` - Builds and uploads incremental manifests
- [ ] `MerkleTreeService` - Incremental tree building
- [ ] `SessionManager` - Coordinates recording lifecycle

### Storage Schema (IndexedDB)

```typescript
interface ChunkRecord {
  id: string;                    // UUID
  sessionId: string;
  index: number;
  status: ChunkStatus;
  rawBlob?: Blob;                // Cleared after upload confirmed
  encryptedBlob?: Blob;          // Cleared after upload confirmed
  plaintextHash: string;
  encryptedHash: string;
  iv: string;
  cid?: string;                  // Set after IPFS upload
  capturedAt: number;
  uploadedAt?: number;
  confirmedAt?: number;
  retryCount: number;
  lastError?: string;
}

type ChunkStatus =
  | 'captured'
  | 'hashing'
  | 'encrypting'
  | 'uploading'
  | 'uploaded'
  | 'manifesting'
  | 'anchoring'
  | 'confirmed';
```

---

## Open Questions (Deferred)

| Question | Notes |
|----------|-------|
| Offline-first sync | How to handle extended offline periods? |
| Multi-device | Same session from multiple devices? |
| Resume recording | Continue a session after app restart? |
| Chunk size adaptation | Adjust based on network conditions? |

These are post-hackathon considerations.

---

## References

- [witness-protocol-implementation-plan.md](../../Wallet-creation-paymaster-zkdid/witness-protocol-implementation-plan.md) - **Primary implementation plan** (takes precedence)
- [chunking-research.md](./chunking-research.md) - MediaRecorder behavior research
- [Tamper-Evident-research.md](./Tamper-Evident-research.md) - Provenance standards
- [witness-provenance-implementation.md](./witness-provenance-implementation.md) - PWA vs Native tradeoffs
- [witness-protocol-architecture-v3.md](../planning/witness-protocol-architecture-v3.md) - Overall architecture
- [primus-integration-reference.md](./primus-integration-reference.md) - zkTLS for verified timestamps (future)
