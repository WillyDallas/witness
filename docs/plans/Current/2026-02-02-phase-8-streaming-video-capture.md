# Phase 8: Streaming Video Capture

**Status**: Planning complete, ready for implementation

**Date**: 2026-02-02

**Depends on**: Phases 1-7 (all complete)

---

## Overview

This phase transforms Witness Protocol from uploading pre-recorded test content to **real-time streaming capture**. Video is chunked, encrypted, uploaded, and anchored on-chain as it's being recorded.

**Core Principle**: Recording never stops due to upload failures. Chunks queue locally and sync when connectivity returns.

### What Changes
- Replace manual "Upload Test Content" with live MediaRecorder capture
- 10-second chunks encrypted and uploaded in parallel with recording
- Per-chunk on-chain commits via new `updateSession()` contract function
- IndexedDB backup ensures crash resilience
- Two-stage confirmation: IPFS upload → On-chain anchor

### What Stays the Same
- Group selection before recording (determines key wrapping)
- AES-256-GCM encryption with HKDF-derived per-chunk keys
- Manifest structure (grows incrementally)
- Attestation system (works on completed sessions)

### End State
A user can record video, and even if their phone is seized mid-recording, chunks already uploaded are:
1. Safely stored on IPFS
2. Anchored on-chain with merkle root
3. Decryptable by group members
4. Attestable via Semaphore

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        STREAMING CAPTURE PIPELINE                            │
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

### On-Chain Commit Strategy

**Per-chunk commits** for maximum resilience. Each chunk gets its own on-chain anchor.

```
Chunk 0 captured:
  → Manifest v1: { chunks: [chunk0], merkleRoot: root_0 }
  → Upload manifest → CID_v1
  → updateSession(sessionId, root_0, CID_v1, 1, groupIds)

Chunk 1 captured:
  → Manifest v2: { chunks: [chunk0, chunk1], merkleRoot: root_0_1 }
  → Upload manifest → CID_v2
  → updateSession(sessionId, root_0_1, CID_v2, 2, groupIds)

Chunk 2 captured:
  → Manifest v3: { chunks: [chunk0, chunk1, chunk2], merkleRoot: root_0_1_2 }
  → Upload manifest → CID_v3
  → updateSession(sessionId, root_0_1_2, CID_v3, 3, groupIds)
```

On-chain only stores the latest CID, but that manifest contains pointers to ALL chunk CIDs.

### Failure Handling

| Failure Point | Behavior |
|---------------|----------|
| IPFS chunk upload | Queue for retry, continue capturing |
| Manifest upload | Queue for retry, use stale CID for tx |
| On-chain tx fails | Queue for retry, chunks safe on IPFS |
| On-chain tx reverts | Retry with fresh nonce |
| Network offline | Queue all, sync when back online |

**Critical**: Recording never stops due to upload failures.

---

## Contract Updates

### New Function

```solidity
function updateSession(
    bytes32 sessionId,
    bytes32 merkleRoot,
    string calldata manifestCid,
    uint256 chunkCount,
    bytes32[] calldata groupIds
) external;

event SessionUpdated(
    bytes32 indexed sessionId,
    address indexed uploader,
    bytes32 merkleRoot,
    string manifestCid,
    uint256 chunkCount,
    bytes32[] groupIds,
    uint256 timestamp
);
```

Each call overwrites the previous merkle root and manifest CID for that session.

### Test Checkpoint
- Deploy updated contract to Base Sepolia
- Call `updateSession()` 3 times with incrementing chunk counts
- Verify on-chain: final merkle root and manifest CID match last call
- Verify events: `SessionUpdated` emitted for each call
- Verify `isContentInGroup()` works for attestation eligibility

---

## Client-Side Services

Build in order, test each in isolation.

### 1. ChunkProcessor
Handles a single chunk's lifecycle: hash → encrypt → upload to IPFS

**Test Checkpoint**:
- Feed it a Blob, get back `{ cid, plaintextHash, encryptedHash, iv }`
- Verify chunk is retrievable from Pinata gateway
- Verify decryption round-trip works

### 2. MerkleTreeService
Incremental tree that grows with each chunk. Uses SHA-256 composite leaves.

**Leaf Structure**:
```javascript
leaf[i] = SHA256(
  chunkIndex      +  // 4 bytes, big-endian uint32
  plaintextHash   +  // 32 bytes, SHA256 of raw video
  encryptedHash   +  // 32 bytes, SHA256 of encrypted chunk
  capturedAt         // 8 bytes, Unix timestamp in ms
)
```

**Test Checkpoint**:
- Insert 5 leaves incrementally
- Verify root changes with each insert
- Generate proof for leaf 2, verify it validates against current root

### 3. UploadQueue
Manages retry logic. Persists pending uploads to IndexedDB. Never blocks.

**Test Checkpoint**:
- Queue 3 uploads, kill network mid-way
- Verify queued items persist across page reload
- Restore network, verify queue drains automatically

### 4. ManifestManager
Builds and uploads incremental manifests. Tracks all chunks for a session.

**Test Checkpoint**:
- Add 3 chunks via `addChunk()`
- Call `uploadManifest()` after each
- Verify each manifest CID contains cumulative chunk list

### 5. SessionManager
Orchestrates the full flow. Coordinates MediaRecorder → ChunkProcessor → ManifestManager → Contract.

**Test Checkpoint**:
- Start session, feed 3 mock chunks
- Verify 3 `updateSession()` calls to contract
- Verify final on-chain state matches

---

## MediaRecorder Integration

### CaptureService
Wraps MediaRecorder with chunk callbacks.

```javascript
const capture = new CaptureService({
  timeslice: 10000,  // 10 seconds
  onChunk: async (blob, index) => {
    await sessionManager.processChunk(blob, index);
  }
});
```

**Test Checkpoint**:
- Start capture, record for 25 seconds, stop
- Verify `onChunk` called 3 times (0s, 10s, 20s + final)
- Verify each blob is valid video data

### GPS Tracking (Optional Metadata)
Capture location with each chunk for provenance metadata.

**Test Checkpoint**:
- Enable location permission
- Verify each chunk metadata includes lat/lng
- Verify `verified: false` flag is set (honest about PWA limitations)

### IndexedDB Backup
Raw chunks saved locally before upload. Cleared only after on-chain confirmation.

**Test Checkpoint**:
- Start recording, capture 2 chunks
- Kill the browser tab mid-chunk-3
- Reopen app, verify chunks 0-1 are in IndexedDB
- Verify "resume upload" recovers them

---

## UI Changes

### Recording Screen

Full-screen camera with minimal overlay:

```
┌─────────────────────────────┐
│ ● 2:34              ✓ 14   │  ← tiny bar, mostly transparent
│                             │
│                             │
│                             │
│      [Full Camera View]     │
│                             │
│                             │
│                             │
│         ⏹ (stop fab)        │
└─────────────────────────────┘
```

**Overlay Behavior**:
- `●` red dot = recording
- Time elapsed
- Chunk count with status indicator:
  - `✓ 14` green = all caught up
  - `⏳ 14` yellow = queue building (offline or slow)
- Tap overlay to expand details (optional)

### Pre-Recording: Group Selection
User picks which groups to share with **before** recording starts. Session key wrapped for selected groups at session start.

### Post-Recording: Summary
After stop, brief summary: "15 chunks uploaded, all confirmed ✓" before returning to content list.

**Test Checkpoint**:
- Record 30 seconds
- Verify UI shows 3 chunks uploaded
- Toggle airplane mode mid-recording
- Verify UI shows queue building, recording continues
- Restore network, verify queue drains

---

## Verification & Playback

### Verification Flow
Existing content detail screen needs updates for chunked content:

- Fetch manifest from IPFS (already have this)
- Show chunk count and total duration
- Verify merkle root matches on-chain
- Download chunks on-demand (not all at once)

**Test Checkpoint**:
- Upload a 5-chunk recording from Device A
- Open content detail on Device B (same group)
- Verify shows "5 chunks, 50 seconds"
- Verify merkle root validation passes

### Playback Strategy
For hackathon scope: **Download all → Concatenate → Play**

1. Download all encrypted chunks
2. Decrypt each with derived chunk keys
3. Concatenate into single Blob
4. Create object URL, play in `<video>` element

**Test Checkpoint**:
- Record 30-second video
- Download and decrypt on another device
- Verify video plays without corruption
- Verify no gaps between chunks

### Future: Progressive Playback (Post-Hackathon)
MSE-based streaming for long videos. Not in scope for Phase 8.

---

## Implementation Milestones

Each milestone produces testable, working software.

### Milestone 1: Contract Update
- Add `updateSession()` to WitnessRegistry.sol
- Deploy to Base Sepolia
- **Test**: Call 3 times, verify on-chain state

### Milestone 2: Core Services (No UI)
- Build ChunkProcessor, MerkleTreeService, UploadQueue
- Wire together with mock data (no camera yet)
- **Test**: Feed 5 blobs, verify 5 chunks on IPFS + 5 on-chain updates

### Milestone 3: IndexedDB Persistence
- Add crash resilience layer
- **Test**: Kill tab mid-upload, reload, verify recovery

### Milestone 4: MediaRecorder Integration
- Add CaptureService with real camera
- Wire to SessionManager
- **Test**: Record 30s, verify 3 chunks uploaded and anchored

### Milestone 5: Recording UI
- Full-screen camera with minimal overlay
- Group selection before recording
- Stop button
- **Test**: Full E2E flow from UI

### Milestone 6: Playback Updates
- Update content detail for chunked content
- Download → decrypt → concatenate → play
- **Test**: Record on Device A, play on Device B

---

## Success Criteria

Phase 8 is complete when:

- [ ] User can select groups, tap record, capture video
- [ ] Chunks upload every 10 seconds during recording
- [ ] Each chunk anchored on-chain with updated merkle root
- [ ] Recording continues if network drops (queue builds)
- [ ] Queue drains automatically when network returns
- [ ] Interrupted recording preserves already-uploaded chunks
- [ ] Group members can download, verify, and play recordings
- [ ] Attestation system works on completed recordings

---

## References

- [data-chunking-transport-design.md](../../research/video-storage-and-transport/data-chunking-transport-design.md) — Detailed technical spec
- [witness-protocol-implementation-plan.md](../../research/Wallet-creation-paymaster-zkdid/witness-protocol-implementation-plan.md) — Overall project plan
- [witness-provenance-implementation.md](../../research/video-storage-and-transport/witness-provenance-implementation.md) — PWA vs Native tradeoffs
