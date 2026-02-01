# Planning Agent Context: Milestone 3 — IndexedDB Persistence

## Your Task

Write a detailed implementation plan for **Milestone 3: IndexedDB Persistence** from the Phase 8 streaming video capture plan.

## Context to Read First

Read these files in order:

1. **The high-level plan** (what you're implementing):
   - `docs/plans/Current/2026-02-02-phase-8-streaming-video-capture.md`
   - Focus on "IndexedDB Backup" section and "Milestone 3" success criteria

2. **Data chunking design** (chunk lifecycle states):
   - `docs/research/video-storage-and-transport/data-chunking-transport-design.md`
   - Section 6: "Chunk Lifecycle State Machine"
   - "Implementation Checklist" → Storage Schema

3. **Existing storage patterns**:
   - `witness-pwa/src/lib/storage.js` — current localStorage usage
   - Note: This milestone adds IndexedDB alongside localStorage

4. **Milestone 2 services** (what you're adding persistence to):
   - Read `planning-agent-context-milestone-2.md` for service architecture

## Before Writing the Plan

**Use context7 to verify IndexedDB patterns**:

1. Search for `IndexedDB` to understand:
   - Object store design
   - Index creation for queries
   - Blob storage (can store Blobs directly)
   - Transaction patterns (read vs readwrite)

2. Search for `idb` or `dexie` libraries:
   - Wrapper libraries that simplify IndexedDB
   - Promise-based APIs
   - Decide: raw IndexedDB vs wrapper library

3. Search for `service worker IndexedDB`:
   - Persistence across page reloads
   - Quota management
   - When browser evicts data

## What to Persist

### ChunkRecord Schema
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

### Session State
- Current session ID
- Group IDs selected
- Wrapped keys
- Chunk count

## What the Plan Should Cover

Use the `superpowers:writing-plans` skill format:

### Database Schema
- Object stores needed
- Indexes for querying (by sessionId, by status)
- Versioning strategy

### Persistence Points
- When to write to IndexedDB
- When to clear data (only after on-chain confirmation)
- How to handle partial writes

### Recovery Flow
- On app startup: check for incomplete sessions
- Resume upload queue from persisted state
- UI indication that recovery is happening

### Integration with Existing Services
- How UploadQueue uses IndexedDB
- How SessionManager checks for recovery on init

### Test Cases
- Start recording, capture 2 chunks
- Kill browser tab mid-chunk-3
- Reopen app
- Verify chunks 0-1 are in IndexedDB
- Verify "resume upload" recovers them
- Verify no duplicate uploads

## Success Criteria

From Milestone 3:
- Add crash resilience layer
- **Test**: Kill tab mid-upload, reload, verify recovery

## Output Location

Write the detailed implementation plan to:
`docs/plans/Current/2026-02-02-milestone-3-indexeddb-persistence-plan.md`

## Important Notes

- This builds on Milestone 2 services
- Focus on the **recovery path** — normal path should already work
- Consider: what if user has multiple incomplete sessions?
- Consider: storage quota limits (warn user if low?)
