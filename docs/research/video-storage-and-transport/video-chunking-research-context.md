# Video Chunking & Provenance Research Context

**Purpose**: This document provides context for a research agent investigating video chunking, streaming upload, and provenance record creation for the Witness Protocol project.

---

## What We're Building

Witness Protocol is a privacy-preserving evidence capture app. Users record video that is:
1. **Encrypted** — only authorized group members can decrypt
2. **Stored on IPFS** — decentralized, content-addressed
3. **Anchored on-chain** — merkle root proves integrity and timestamp
4. **Attestable** — group members can anonymously vouch for evidence (ZK proofs)

The research question: **How should we chunk, encrypt, upload, and create provenance records for streaming video capture?**

---

## Current Architecture Decisions (Already Made)

These decisions are fixed. The chunking strategy must work within these constraints.

### Storage Layer

| Component | Choice | Details |
|-----------|--------|---------|
| Storage | IPFS via Pinata | Content-addressed, each file gets a CID |
| Pinning | Pinata SDK | `pinata` npm package, 1GB free tier |
| Gateway | Pinata dedicated gateway | Fast retrieval, CORS configured |

**Key property**: IPFS is content-addressed. Identical content = identical CID. Encrypted content with unique IV = unique CID even for identical source.

### Encryption Layer

| Component | Choice | Details |
|-----------|--------|---------|
| Algorithm | AES-256-GCM | Authenticated encryption |
| Video key | Random per recording | Fresh 32-byte key for each video |
| Chunk keys | Derived from video key | `chunkKey = HKDF(videoKey, chunkIndex)` |
| IV | Fresh per chunk | 12 bytes from `crypto.getRandomValues()` |
| Key distribution | Wrapped per group | Video key wrapped with each group's secret |

**Key property**: Each chunk is independently decryptable given the video key. Chunks can be decrypted in any order (random access).

### On-Chain Layer

| Component | Choice | Details |
|-----------|--------|---------|
| Chain | Base Sepolia | Testnet, ~2s block time (good for streaming commits) |
| Data stored | Merkle root + manifest CID | Minimal on-chain footprint |
| Gas | Sponsored via Pimlico paymaster | Gasless UX |
| Contract | WitnessRegistry.sol | Single commit per video/recording session |

**Key property**: On-chain storage is expensive. We store only a 32-byte merkle root and a string CID, not individual chunk data.

### Access Control Layer

| Component | Choice | Details |
|-----------|--------|---------|
| Groups | Address-based membership | `mapping(groupId => mapping(address => bool))` |
| Group secret | 32 random bytes | Shared via QR code |
| Multi-group | Key wrapping | Video key wrapped separately for each group |
| Attestations | Semaphore ZK proofs | Anonymous "N attested" without revealing who |

**Key property**: Anyone with the group secret can derive decryption keys. The group secret is the access control primitive.

---

## The Provenance Problem

We need to prove:

1. **Integrity**: This video hasn't been modified since capture
2. **Timestamp**: This video existed at time T (on-chain anchor)
3. **Ordering**: These chunks are in the correct sequence
4. **Completeness**: No chunks are missing
5. **Attribution**: This video was captured by address X (or: by a member of group Y)

For **streaming/chunked upload**, we also need:
6. **Incremental provenance**: Evidence is preserved even if recording is interrupted
7. **Chunk independence**: Each chunk can be verified independently

---

## Current Thinking: Manifest + Merkle Tree

### The Manifest (stored on IPFS)

```typescript
interface VideoManifest {
  version: 1;
  
  // Identity
  contentId: string;           // Unique ID for this recording
  uploader: string;            // Ethereum address
  
  // Timing
  captureStarted: number;      // Unix timestamp
  captureEnded: number;        // Unix timestamp
  
  // Chunks
  chunks: {
    index: number;             // 0, 1, 2, ...
    cid: string;               // IPFS CID of encrypted chunk
    size: number;              // Bytes (encrypted size)
    duration: number;          // Milliseconds of video
    plaintextHash: string;     // SHA-256 of raw video chunk (before encryption)
    encryptedHash: string;     // SHA-256 of encrypted chunk
    iv: string;                // IV used for this chunk's encryption
    capturedAt: number;        // When this chunk was recorded
  }[];
  
  // Merkle tree
  merkleRoot: string;          // Root of tree built from chunk hashes
  
  // Encryption info
  encryption: {
    algorithm: 'aes-256-gcm';
    keyDerivation: 'hkdf-sha256';  // chunkKey = HKDF(videoKey, index)
  };
  
  // Access control
  accessList: {
    [groupId: string]: {
      wrappedKey: string;      // AES-GCM(groupSecret, videoKey)
      iv: string;
    };
  };
  
  // Device metadata (encrypted with videoKey)
  encryptedMetadata?: string;  // GPS track, device info, etc.
}
```

### The Merkle Tree

**Question for research agent**: What should the merkle tree leaves contain?

Option A: Hash of encrypted chunk
```
leaf[i] = SHA256(encryptedChunk[i])
```
- Pro: Can verify without decrypting
- Con: Doesn't prove content, only that *something* was uploaded

Option B: Hash of plaintext chunk
```
leaf[i] = SHA256(rawChunk[i])
```
- Pro: Proves actual video content
- Con: Requires decryption to verify

Option C: Composite
```
leaf[i] = SHA256(index || plaintextHash || encryptedHash || capturedAt)
```
- Pro: Binds metadata to content
- Con: More complex

**Current leaning**: Option C, binding chunk index + plaintext hash + timestamp into each leaf.

### On-Chain Commitment

```solidity
function commitContent(
    bytes32 contentId,
    bytes32 merkleRoot,
    string calldata manifestCID,
    bytes32[] calldata groupIds
) external;
```

Only the merkle root goes on-chain. The manifest (with full chunk list) is on IPFS, referenced by CID.

---

## The Streaming Upload Challenge

### Batch Upload (Current Plan for Hackathon MVP)

```
Record complete → Encrypt all → Upload all → Build tree → Commit once

Timeline:
[=== Record 60s ===][= Encrypt =][=== Upload ===][Commit]
                                                    ↑
                                              Single tx
```

**Problem**: If phone is seized during recording, nothing is preserved.

### Streaming Upload (Research Target)

```
Record chunk → Encrypt → Upload → Continue recording...

Timeline:
[Record 10s][Enc][Up] [Record 10s][Enc][Up] [Record 10s][Enc][Up] [Stop][Commit]
              ↓           ↓           ↓                              ↑
           Chunk 0     Chunk 1     Chunk 2                    Final commit
```

**Benefit**: Chunks 0, 1, 2 are already on IPFS even if phone is grabbed during chunk 3.

### The Merkle Tree Problem for Streaming

If we commit the merkle root only at the end, interrupted recordings have no on-chain anchor.

**Options**:

**Option 1: Commit root after each chunk (expensive)**
```
Chunk 0 uploaded → commitRoot(root_0)     // ~50k gas
Chunk 1 uploaded → updateRoot(root_0_1)   // ~30k gas
Chunk 2 uploaded → updateRoot(root_0_1_2) // ~30k gas
...
```
- Pro: Each chunk has on-chain timestamp
- Con: Many transactions, gas cost adds up (even if sponsored)

**Option 2: Commit once at end, accept interruption risk**
```
Chunk 0, 1, 2, ... uploaded to IPFS (no on-chain record)
Recording ends → commitRoot(final_root)
```
- Pro: Single transaction
- Con: Interrupted recording has no on-chain proof

**Option 3: Periodic commits (every N chunks or T seconds)**
```
Chunk 0, 1, 2 uploaded → commitRoot(root_0_1_2)   // Checkpoint 1
Chunk 3, 4, 5 uploaded → updateRoot(root_0..5)    // Checkpoint 2
Recording ends → finalizeRecording()
```
- Pro: Balance between gas cost and interruption resilience
- Con: More complex state management

**Option 4: Commit session start, update incrementally with events**
```
Start recording → startSession(sessionId)   // On-chain, records start time
Chunks upload to IPFS (off-chain)
Recording ends → commitSession(sessionId, merkleRoot, manifestCID)
```
- Pro: Session start is timestamped even if never completed
- Con: Incomplete sessions visible on-chain

**Question for research agent**: What's the optimal commit strategy balancing gas cost, interruption resilience, and implementation complexity?

---

## Incremental Merkle Tree Considerations

For streaming, we can't rebuild the entire tree for each chunk. We need an **incremental/append-only** structure.

### Standard Merkle Tree (Rebuild Required)

```
        root
       /    \
     h01    h23
    /  \   /  \
   h0  h1 h2  h3
```

Adding h4 requires restructuring. Not ideal for streaming.

### Incremental Merkle Tree (Append-Only)

Semaphore uses a "Lean Incremental Merkle Tree" (LeanIMT) that supports efficient appends.

```typescript
import { LeanIMT } from "@zk-kit/imt"

const tree = new LeanIMT((a, b) => poseidonHash([a, b]))

// Append chunks as they're captured
tree.insert(chunkHash0)  // O(log n)
tree.insert(chunkHash1)  // O(log n)
tree.insert(chunkHash2)  // O(log n)

const root = tree.root   // Current root reflects all inserted leaves
```

**Question for research agent**: Should we use LeanIMT (Poseidon hash, ZK-friendly) or a standard SHA256-based incremental tree? Poseidon enables future ZK proofs over the tree, but adds complexity.

---

## Chunk Verification Flow

How a viewer verifies a chunk:

```
1. Fetch manifest from IPFS (via manifestCID from chain)
2. Verify manifestCID matches on-chain record
3. For chunk N:
   a. Fetch encrypted chunk from IPFS (chunk.cid)
   b. Verify SHA256(encryptedChunk) == chunk.encryptedHash
   c. Derive chunkKey = HKDF(videoKey, N)
   d. Decrypt: rawChunk = AES-GCM-decrypt(chunkKey, chunk.iv, encryptedChunk)
   e. Verify SHA256(rawChunk) == chunk.plaintextHash
   f. Verify chunk.plaintextHash is in merkle tree (provide proof)
   g. Verify merkle root matches on-chain commitment
4. Chunk is authentic ✓
```

**Question for research agent**: Is there a more efficient verification flow? Should we support "quick verify" (check encrypted hash only) vs "full verify" (decrypt and check plaintext)?

---

## Playback Considerations

Chunked video needs reassembly for playback:

### Option A: Download all, concatenate, play
```
Fetch chunk 0, 1, 2, ... → Decrypt all → Concatenate → Play
```
- Simple
- High latency for long videos
- High memory usage

### Option B: Streaming playback with MSE (Media Source Extensions)
```
Fetch chunk 0 → Decrypt → Append to MSE buffer → Start playing
While playing: Fetch chunk 1 → Decrypt → Append → ...
```
- Low latency
- Requires careful buffer management
- Chunks must be valid media segments (not arbitrary byte splits)

**Critical constraint for chunking**: If using MSE, chunks must align with video keyframes/GOP boundaries. Arbitrary 10-second splits may not produce playable segments.

**Question for research agent**: What chunking strategy produces independently playable segments? Options:
- Time-based (every N seconds) — may split mid-GOP
- Keyframe-based (every N keyframes) — variable chunk size
- Byte-based (every N MB) — definitely splits mid-frame

---

## MediaRecorder API Context

For web/PWA capture, `MediaRecorder` with `timeslice` parameter produces chunks:

```javascript
const recorder = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=vp9',
});

recorder.ondataavailable = async (event) => {
  if (event.data.size > 0) {
    const chunk = event.data;  // Blob
    // Process chunk: encrypt, upload, add to tree
  }
};

// Start with 10-second chunks
recorder.start(10000);  // timeslice in ms
```

**Caveat**: `timeslice` chunks are not guaranteed to be independently playable. The first chunk contains headers; subsequent chunks may depend on previous state.

**Question for research agent**: How do we ensure each chunk is independently decodable for verification purposes, even if playback requires sequential access?

---

## Expo/React Native Context

For mobile capture, `expo-camera` records to a file, not a stream:

```typescript
const video = await cameraRef.current.recordAsync({
  maxDuration: 300,  // 5 minutes max
});
// video.uri is the complete file
```

**No native chunk streaming** in expo-camera. Options:
1. Record complete file, then chunk afterward (loses real-time upload benefit)
2. Use `maxDuration` with manual restart (gaps between recordings)
3. Use native module or FFmpeg for chunking

**Question for research agent**: What's the best approach for mobile streaming capture with Expo? Is there a React Native library that provides chunk callbacks?

---

## Summary of Open Questions

| # | Question | Context |
|---|----------|---------|
| 1 | What should merkle tree leaves contain? | Plaintext hash, encrypted hash, or composite? |
| 2 | What's the optimal on-chain commit strategy? | Per-chunk, periodic, or end-only? |
| 3 | Should we use Poseidon (ZK-friendly) or SHA256 for merkle tree? | Future ZK proofs vs simplicity |
| 4 | How do we produce independently verifiable chunks? | GOP alignment, keyframe boundaries |
| 5 | How do we handle MSE playback requirements? | Chunks must be valid media segments |
| 6 | What's the mobile (Expo) chunking strategy? | expo-camera doesn't support streaming |
| 7 | What metadata should each chunk carry? | Timestamp, GPS, sequence number, etc. |
| 8 | How do we handle chunk upload failures mid-stream? | Retry? Skip? Abort? |

---

## Constraints Summary

**Must work with**:
- IPFS/Pinata for storage (content-addressed)
- AES-256-GCM encryption (per-chunk keys derived from video key)
- Base Sepolia for on-chain commits (~2s blocks, minimize transactions)
- Pimlico paymaster (gasless, but still want efficiency)
- Semaphore for attestations (attestors verify chunks existed)

**Goals**:
- Interrupted recording should preserve already-uploaded chunks
- Chunks should be independently verifiable
- Playback should be possible without downloading entire video first
- Merkle proof should work for any individual chunk

**Non-goals for hackathon**:
- Perfect real-time streaming (small delays acceptable)
- Handling hours-long recordings (target: 5-10 minutes max)
- Multi-bitrate/adaptive streaming
