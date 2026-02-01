# Planning Agent Context: Milestone 2 — Core Services

## Your Task

Write a detailed implementation plan for **Milestone 2: Core Services (No UI)** from the Phase 8 streaming video capture plan.

## Context to Read First

Read these files in order:

1. **The high-level plan** (what you're implementing):
   - `docs/plans/Current/2026-02-02-phase-8-streaming-video-capture.md`
   - Focus on "Client-Side Services" section and "Milestone 2" success criteria

2. **Existing encryption/storage code** (patterns to follow):
   - `witness-pwa/src/lib/storage.js` — current storage patterns
   - `witness-pwa/src/lib/contract.js` — contract interaction patterns
   - `witness-pwa/src/lib/groups.js` — key wrapping patterns

3. **Data chunking design** (technical spec):
   - `docs/research/video-storage-and-transport/data-chunking-transport-design.md`
   - Sections: Encryption Layer, Integrity Layer (Merkle Tree), Manifest Structure

4. **Current IPFS integration**:
   - Search codebase for Pinata usage patterns

## Before Writing the Plan

**Use context7 to verify JavaScript/Web patterns**:

1. Search for `Web Crypto API` to confirm:
   - HKDF key derivation patterns
   - AES-GCM encryption with Web Crypto
   - Proper IV generation

2. Search for `IndexedDB` to understand:
   - Async storage patterns
   - Transaction handling
   - Blob storage best practices

3. Search for `merkle tree javascript` to find:
   - Incremental tree implementations
   - SHA-256 based trees (not Poseidon for now)

## Services to Plan

### 1. ChunkProcessor
- Input: raw Blob
- Output: `{ cid, plaintextHash, encryptedHash, iv }`
- Responsibilities:
  - Hash raw chunk (SHA-256)
  - Derive chunk key via HKDF(sessionKey, chunkIndex)
  - Encrypt with AES-256-GCM
  - Hash encrypted chunk
  - Upload to Pinata
  - Return metadata

### 2. MerkleTreeService
- Incremental/append-only tree
- Composite leaf: `SHA256(chunkIndex + plaintextHash + encryptedHash + capturedAt)`
- Methods: `insert(leaf)`, `getRoot()`, `getProof(index)`

### 3. UploadQueue
- Persists pending uploads to IndexedDB
- Retry logic with exponential backoff
- Never blocks — returns immediately, processes async
- Methods: `enqueue(task)`, `pause()`, `resume()`, `getStatus()`

### 4. ManifestManager
- Builds VideoManifest object incrementally
- Uploads manifest to Pinata after each chunk
- Tracks all chunk metadata for session
- Methods: `addChunk(metadata)`, `uploadManifest()`, `getManifestCid()`

### 5. SessionManager
- Orchestrates full flow
- Coordinates: ChunkProcessor → ManifestManager → Contract
- Handles group selection and key wrapping at session start
- Methods: `startSession(groupIds)`, `processChunk(blob)`, `endSession()`

## What the Plan Should Cover

Use the `superpowers:writing-plans` skill format:

### File Structure
- Where each service lives (`witness-pwa/src/lib/`)
- New files vs modifications to existing

### Implementation Order
- Which service to build first (dependencies matter)
- Test checkpoint for each service in isolation

### Interface Definitions
- TypeScript-style interfaces for each service
- Input/output types

### Integration Tests
- Feed 5 mock blobs through full pipeline
- Verify 5 chunks on IPFS
- Verify 5 `updateSession()` calls to contract
- Verify final merkle root matches expected

## Success Criteria

From Milestone 2:
- Build ChunkProcessor, MerkleTreeService, UploadQueue
- Wire together with mock data (no camera yet)
- **Test**: Feed 5 blobs, verify 5 chunks on IPFS + 5 on-chain updates

## Output Location

Write the detailed implementation plan to:
`docs/plans/Current/2026-02-02-milestone-2-core-services-plan.md`

## Important Notes

- This milestone uses **mock Blobs**, not real camera data
- Milestone 1 (contract update) must be complete first
- Focus on testability — each service should be testable in isolation
- Use existing patterns from `storage.js` and `contract.js`
