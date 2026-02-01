# Milestone 3: IndexedDB Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add crash resilience to the streaming capture pipeline by persisting chunks to IndexedDB until on-chain confirmation.

**Architecture:** Use Dexie.js as an IndexedDB wrapper for cleaner async/await patterns. Chunks are persisted immediately on capture and only deleted after on-chain confirmation. On app startup, check for incomplete sessions and resume upload queue automatically.

**Tech Stack:** Dexie.js (IndexedDB wrapper), Web Storage API (for persistent storage request)

---

## Why Dexie.js?

| Raw IndexedDB | Dexie.js |
|---------------|----------|
| Callback-based | Promise/async-await native |
| Manual versioning | Declarative `db.version(n).stores({})` |
| Verbose transaction handling | Implicit transactions |
| No TypeScript support | First-class TypeScript |

Dexie adds ~45KB gzipped but eliminates significant boilerplate. For a crash-resilience feature, the cleaner API reduces bug risk.

---

## Database Schema

### Object Stores

```javascript
// witness-pwa/src/lib/chunkStore.js

import Dexie from 'dexie';

const db = new Dexie('WitnessChunks');

db.version(1).stores({
  // Primary store for chunk records
  // Indexes: sessionId (for session queries), status (for recovery queries)
  chunks: 'id, sessionId, status, index, [sessionId+index]',

  // Session metadata for recovery
  sessions: 'sessionId, status, startedAt'
});
```

### Index Explanations

| Index | Purpose |
|-------|---------|
| `id` | Primary key (UUID) |
| `sessionId` | Query all chunks for a session |
| `status` | Query pending/failed chunks for recovery |
| `index` | Order chunks within session |
| `[sessionId+index]` | Compound index for "get chunk N of session X" |

---

## TypeScript Interfaces

```typescript
// Types (for documentation - actual code is JS)

type ChunkStatus =
  | 'captured'     // Saved to IndexedDB, not yet processed
  | 'hashing'      // Computing plaintextHash
  | 'encrypting'   // Deriving key, encrypting
  | 'uploading'    // Upload to IPFS in progress
  | 'uploaded'     // CID received, waiting for manifest
  | 'manifesting'  // Manifest upload in progress
  | 'anchoring'    // On-chain tx in progress
  | 'confirmed';   // On-chain confirmed, safe to delete

interface ChunkRecord {
  id: string;                    // UUID
  sessionId: string;             // Recording session UUID
  index: number;                 // 0, 1, 2, ...
  status: ChunkStatus;
  rawBlob?: Blob;                // Cleared after upload confirmed
  encryptedBlob?: Blob;          // Cleared after upload confirmed
  plaintextHash?: string;        // Set after hashing
  encryptedHash?: string;        // Set after encrypting
  iv?: string;                   // Base64 IV for this chunk
  cid?: string;                  // Set after IPFS upload
  capturedAt: number;            // Unix timestamp (ms)
  uploadedAt?: number;           // When CID received
  confirmedAt?: number;          // When on-chain confirmed
  retryCount: number;            // For backoff logic
  lastError?: string;            // Most recent error message
}

interface SessionRecord {
  sessionId: string;
  status: 'recording' | 'uploading' | 'complete' | 'interrupted';
  groupIds: string[];            // Selected groups
  wrappedKeys: Record<string, { wrappedKey: string; iv: string }>;
  sessionKeyHex?: string;        // Encrypted session key (encrypted with personal key)
  chunkCount: number;
  startedAt: number;
  endedAt?: number;
}
```

---

## Implementation Tasks

### Task 1: Install Dexie.js

**Files:**
- Modify: `witness-pwa/package.json`

**Step 1: Add Dexie dependency**

Run:
```bash
cd witness-pwa && npm install dexie
```

**Step 2: Verify installation**

Run: `cd witness-pwa && npm ls dexie`
Expected: `dexie@4.x.x` listed

**Step 3: Commit**

```bash
git add witness-pwa/package.json witness-pwa/package-lock.json
git commit -m "deps: add dexie for IndexedDB persistence"
```

---

### Task 2: Create ChunkStore Service

**Files:**
- Create: `witness-pwa/src/lib/chunkStore.js`
- Test: Manual browser console test

**Step 1: Write the ChunkStore module**

```javascript
// witness-pwa/src/lib/chunkStore.js

/**
 * ChunkStore - IndexedDB persistence for video chunks
 * Provides crash resilience by persisting chunks until on-chain confirmation.
 */

import Dexie from 'dexie';

// Database instance
const db = new Dexie('WitnessChunks');

// Schema definition
db.version(1).stores({
  chunks: 'id, sessionId, status, index, [sessionId+index]',
  sessions: 'sessionId, status, startedAt'
});

// ============================================
// Chunk Operations
// ============================================

/**
 * Save a new chunk to IndexedDB
 * @param {Object} chunk - ChunkRecord to save
 * @returns {Promise<string>} The chunk ID
 */
export async function saveChunk(chunk) {
  return db.chunks.add(chunk);
}

/**
 * Update an existing chunk
 * @param {string} id - Chunk ID
 * @param {Object} updates - Fields to update
 */
export async function updateChunk(id, updates) {
  return db.chunks.update(id, updates);
}

/**
 * Update chunk status with optional fields
 * @param {string} id - Chunk ID
 * @param {string} status - New status
 * @param {Object} [extras] - Additional fields to update
 */
export async function updateChunkStatus(id, status, extras = {}) {
  return db.chunks.update(id, { status, ...extras });
}

/**
 * Get a chunk by ID
 * @param {string} id - Chunk ID
 * @returns {Promise<Object|undefined>}
 */
export async function getChunk(id) {
  return db.chunks.get(id);
}

/**
 * Get all chunks for a session, ordered by index
 * @param {string} sessionId
 * @returns {Promise<Object[]>}
 */
export async function getChunksBySession(sessionId) {
  return db.chunks.where('sessionId').equals(sessionId).sortBy('index');
}

/**
 * Get chunks that need recovery (not confirmed)
 * @returns {Promise<Object[]>}
 */
export async function getPendingChunks() {
  return db.chunks
    .where('status')
    .notEqual('confirmed')
    .toArray();
}

/**
 * Get chunks by status
 * @param {string} status
 * @returns {Promise<Object[]>}
 */
export async function getChunksByStatus(status) {
  return db.chunks.where('status').equals(status).toArray();
}

/**
 * Delete a confirmed chunk (clear blobs, keep metadata briefly)
 * @param {string} id - Chunk ID
 */
export async function clearChunkBlobs(id) {
  return db.chunks.update(id, {
    rawBlob: undefined,
    encryptedBlob: undefined
  });
}

/**
 * Fully delete a chunk record
 * @param {string} id - Chunk ID
 */
export async function deleteChunk(id) {
  return db.chunks.delete(id);
}

/**
 * Delete all chunks for a completed session
 * @param {string} sessionId
 */
export async function deleteSessionChunks(sessionId) {
  return db.chunks.where('sessionId').equals(sessionId).delete();
}

// ============================================
// Session Operations
// ============================================

/**
 * Save session metadata
 * @param {Object} session - SessionRecord
 */
export async function saveSession(session) {
  return db.sessions.put(session);
}

/**
 * Update session
 * @param {string} sessionId
 * @param {Object} updates
 */
export async function updateSession(sessionId, updates) {
  return db.sessions.update(sessionId, updates);
}

/**
 * Get session by ID
 * @param {string} sessionId
 * @returns {Promise<Object|undefined>}
 */
export async function getSession(sessionId) {
  return db.sessions.get(sessionId);
}

/**
 * Get incomplete sessions (for recovery)
 * @returns {Promise<Object[]>}
 */
export async function getIncompleteSessions() {
  return db.sessions
    .where('status')
    .anyOf(['recording', 'uploading', 'interrupted'])
    .toArray();
}

/**
 * Delete session metadata
 * @param {string} sessionId
 */
export async function deleteSession(sessionId) {
  return db.sessions.delete(sessionId);
}

// ============================================
// Recovery & Maintenance
// ============================================

/**
 * Check if there are any incomplete sessions
 * @returns {Promise<boolean>}
 */
export async function hasIncompleteData() {
  const count = await db.sessions
    .where('status')
    .anyOf(['recording', 'uploading', 'interrupted'])
    .count();
  return count > 0;
}

/**
 * Get recovery summary for UI
 * @returns {Promise<Object>}
 */
export async function getRecoverySummary() {
  const sessions = await getIncompleteSessions();
  const summary = {
    sessionCount: sessions.length,
    sessions: []
  };

  for (const session of sessions) {
    const chunks = await getChunksBySession(session.sessionId);
    const confirmedCount = chunks.filter(c => c.status === 'confirmed').length;
    const pendingCount = chunks.length - confirmedCount;

    summary.sessions.push({
      sessionId: session.sessionId,
      status: session.status,
      startedAt: session.startedAt,
      totalChunks: chunks.length,
      confirmedChunks: confirmedCount,
      pendingChunks: pendingCount
    });
  }

  return summary;
}

/**
 * Clear all data (for testing or user-initiated reset)
 */
export async function clearAllData() {
  await db.chunks.clear();
  await db.sessions.clear();
}

// ============================================
// Storage Management
// ============================================

/**
 * Request persistent storage from browser
 * @returns {Promise<boolean>} Whether persistent storage was granted
 */
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const granted = await navigator.storage.persist();
    console.log('[chunkStore] Persistent storage:', granted ? 'granted' : 'denied');
    return granted;
  }
  console.log('[chunkStore] Persistent storage API not available');
  return false;
}

/**
 * Check current storage status
 * @returns {Promise<Object>}
 */
export async function getStorageStatus() {
  if (navigator.storage && navigator.storage.estimate) {
    const estimate = await navigator.storage.estimate();
    return {
      usage: estimate.usage,
      quota: estimate.quota,
      usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(2),
      persistent: await navigator.storage.persisted()
    };
  }
  return { available: false };
}

/**
 * Check if storage is getting low (> 80% used)
 * @returns {Promise<boolean>}
 */
export async function isStorageLow() {
  const status = await getStorageStatus();
  if (!status.quota) return false;
  return (status.usage / status.quota) > 0.8;
}

// Export the database instance for advanced usage
export { db };
```

**Step 2: Test in browser console**

1. Run `npm run dev` in `witness-pwa/`
2. Open browser console
3. Run:
```javascript
import('/src/lib/chunkStore.js').then(async (store) => {
  // Test save
  const testChunk = {
    id: 'test-' + Date.now(),
    sessionId: 'session-1',
    index: 0,
    status: 'captured',
    rawBlob: new Blob(['test data']),
    capturedAt: Date.now(),
    retryCount: 0
  };
  await store.saveChunk(testChunk);
  console.log('Saved chunk');

  // Test retrieve
  const chunks = await store.getChunksBySession('session-1');
  console.log('Retrieved:', chunks);

  // Clean up
  await store.deleteChunk(testChunk.id);
  console.log('Test passed!');
});
```

Expected: "Test passed!" logged without errors

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/chunkStore.js
git commit -m "feat: add ChunkStore for IndexedDB persistence"
```

---

### Task 3: Create RecoveryService

**Files:**
- Create: `witness-pwa/src/lib/recoveryService.js`

**Step 1: Write the RecoveryService module**

```javascript
// witness-pwa/src/lib/recoveryService.js

/**
 * RecoveryService - Handles app startup recovery for incomplete sessions
 * Checks IndexedDB for pending data and coordinates with UploadQueue
 */

import {
  hasIncompleteData,
  getIncompleteSessions,
  getChunksBySession,
  getChunksByStatus,
  updateChunkStatus,
  updateSession,
  getRecoverySummary,
  requestPersistentStorage,
  getStorageStatus,
  isStorageLow
} from './chunkStore.js';

// Recovery state
let recoveryState = {
  checked: false,
  hasData: false,
  recovering: false,
  summary: null
};

// Callbacks for UI updates
let onRecoveryStart = null;
let onRecoveryProgress = null;
let onRecoveryComplete = null;

/**
 * Set recovery event handlers
 * @param {Object} handlers
 */
export function setRecoveryHandlers(handlers) {
  onRecoveryStart = handlers.onStart || null;
  onRecoveryProgress = handlers.onProgress || null;
  onRecoveryComplete = handlers.onComplete || null;
}

/**
 * Check for incomplete data on app startup
 * Call this early in app initialization
 * @returns {Promise<Object>} Recovery summary
 */
export async function checkForRecovery() {
  console.log('[recovery] Checking for incomplete sessions...');

  const hasData = await hasIncompleteData();
  recoveryState.checked = true;
  recoveryState.hasData = hasData;

  if (hasData) {
    const summary = await getRecoverySummary();
    recoveryState.summary = summary;
    console.log('[recovery] Found incomplete data:', summary);
    return summary;
  }

  console.log('[recovery] No incomplete data found');
  return null;
}

/**
 * Resume uploads for incomplete sessions
 * @param {Object} uploadQueue - UploadQueue instance to use
 * @returns {Promise<Object>} Recovery result
 */
export async function resumeUploads(uploadQueue) {
  if (recoveryState.recovering) {
    console.log('[recovery] Already recovering, skipping');
    return { status: 'already_running' };
  }

  recoveryState.recovering = true;

  if (onRecoveryStart) {
    onRecoveryStart(recoveryState.summary);
  }

  const results = {
    sessionsProcessed: 0,
    chunksRequeued: 0,
    errors: []
  };

  try {
    const sessions = await getIncompleteSessions();

    for (const session of sessions) {
      console.log(`[recovery] Processing session ${session.sessionId}`);

      // Mark session as uploading (from recording/interrupted)
      await updateSession(session.sessionId, { status: 'uploading' });

      // Get chunks that need processing
      const chunks = await getChunksBySession(session.sessionId);

      for (const chunk of chunks) {
        if (chunk.status === 'confirmed') {
          continue; // Already done
        }

        try {
          // Reset stuck states to appropriate restart point
          const restartStatus = getRestartStatus(chunk.status);

          if (restartStatus !== chunk.status) {
            await updateChunkStatus(chunk.id, restartStatus);
          }

          // Re-enqueue for processing
          await uploadQueue.enqueueRecovery(chunk);
          results.chunksRequeued++;

          if (onRecoveryProgress) {
            onRecoveryProgress({
              sessionId: session.sessionId,
              chunkId: chunk.id,
              chunkIndex: chunk.index,
              total: chunks.length,
              processed: results.chunksRequeued
            });
          }
        } catch (err) {
          console.error(`[recovery] Failed to requeue chunk ${chunk.id}:`, err);
          results.errors.push({ chunkId: chunk.id, error: err.message });
        }
      }

      results.sessionsProcessed++;
    }

    console.log('[recovery] Recovery complete:', results);

    if (onRecoveryComplete) {
      onRecoveryComplete(results);
    }

    return results;

  } finally {
    recoveryState.recovering = false;
  }
}

/**
 * Determine the appropriate restart status for a chunk
 * @param {string} currentStatus
 * @returns {string} Status to restart from
 */
function getRestartStatus(currentStatus) {
  // Map stuck states to safe restart points
  const restartMap = {
    'captured': 'captured',      // Start from beginning
    'hashing': 'captured',       // Redo hashing
    'encrypting': 'captured',    // Redo from start (need raw blob)
    'uploading': 'encrypting',   // Re-encrypt and upload (upload might have failed)
    'uploaded': 'uploaded',      // Continue to manifest
    'manifesting': 'uploaded',   // Redo manifest upload
    'anchoring': 'manifesting',  // Redo on-chain
    'confirmed': 'confirmed'     // Done
  };

  return restartMap[currentStatus] || 'captured';
}

/**
 * Get current recovery state
 * @returns {Object}
 */
export function getRecoveryState() {
  return { ...recoveryState };
}

/**
 * Initialize recovery system on app startup
 * Requests persistent storage and checks for incomplete data
 * @returns {Promise<Object>}
 */
export async function initRecovery() {
  // Request persistent storage (best effort)
  const persistent = await requestPersistentStorage();

  // Check storage status
  const storageStatus = await getStorageStatus();

  // Check for low storage
  const lowStorage = await isStorageLow();
  if (lowStorage) {
    console.warn('[recovery] Storage is getting low (>80% used)');
  }

  // Check for incomplete sessions
  const recoverySummary = await checkForRecovery();

  return {
    persistent,
    storageStatus,
    lowStorage,
    needsRecovery: recoverySummary !== null,
    recoverySummary
  };
}

/**
 * Discard incomplete session (user chose not to recover)
 * @param {string} sessionId
 */
export async function discardSession(sessionId) {
  const { deleteSessionChunks, deleteSession } = await import('./chunkStore.js');

  console.log(`[recovery] Discarding session ${sessionId}`);
  await deleteSessionChunks(sessionId);
  await deleteSession(sessionId);
}

/**
 * Discard all incomplete data
 */
export async function discardAllIncomplete() {
  const sessions = await getIncompleteSessions();

  for (const session of sessions) {
    await discardSession(session.sessionId);
  }

  recoveryState.hasData = false;
  recoveryState.summary = null;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/lib/recoveryService.js
git commit -m "feat: add RecoveryService for startup recovery"
```

---

### Task 4: Integrate ChunkStore with UploadQueue

**Files:**
- Modify: `witness-pwa/src/lib/uploadQueue.js` (assumes exists from Milestone 2)

**Note:** This task modifies the UploadQueue from Milestone 2 to persist state to IndexedDB.

**Step 1: Add persistence hooks to UploadQueue**

At the top of `uploadQueue.js`, add:

```javascript
import {
  saveChunk,
  updateChunk,
  updateChunkStatus,
  getChunk,
  clearChunkBlobs,
  deleteChunk
} from './chunkStore.js';
```

**Step 2: Modify enqueue to persist**

In the `enqueue` method, add persistence:

```javascript
/**
 * Enqueue a chunk for processing
 * @param {Object} chunkData - Raw chunk data
 * @returns {Promise<string>} Chunk ID
 */
async enqueue(chunkData) {
  const chunkRecord = {
    id: chunkData.id || crypto.randomUUID(),
    sessionId: chunkData.sessionId,
    index: chunkData.index,
    status: 'captured',
    rawBlob: chunkData.blob,
    capturedAt: Date.now(),
    retryCount: 0
  };

  // Persist to IndexedDB FIRST (crash resilience)
  await saveChunk(chunkRecord);

  // Then add to in-memory queue
  this.queue.push(chunkRecord);

  // Trigger processing
  this.processNext();

  return chunkRecord.id;
}
```

**Step 3: Modify status updates to persist**

Wrap status transitions with IndexedDB updates:

```javascript
async updateStatus(chunkId, newStatus, extras = {}) {
  // Update IndexedDB
  await updateChunkStatus(chunkId, newStatus, extras);

  // Update in-memory (if present)
  const inMemory = this.queue.find(c => c.id === chunkId);
  if (inMemory) {
    inMemory.status = newStatus;
    Object.assign(inMemory, extras);
  }
}
```

**Step 4: Add recovery enqueue method**

```javascript
/**
 * Enqueue a chunk from recovery (already in IndexedDB)
 * @param {Object} chunk - ChunkRecord from IndexedDB
 */
async enqueueRecovery(chunk) {
  // Don't re-save to IndexedDB, just add to in-memory queue
  this.queue.push(chunk);
  this.processNext();
}
```

**Step 5: Clear blobs after confirmation**

In the confirmation handler:

```javascript
async onChunkConfirmed(chunkId) {
  // Clear blobs from IndexedDB (keep metadata for audit)
  await clearChunkBlobs(chunkId);

  // Update status
  await this.updateStatus(chunkId, 'confirmed', {
    confirmedAt: Date.now()
  });

  // Remove from in-memory queue
  this.queue = this.queue.filter(c => c.id !== chunkId);
}
```

**Step 6: Commit**

```bash
git add witness-pwa/src/lib/uploadQueue.js
git commit -m "feat: integrate IndexedDB persistence with UploadQueue"
```

---

### Task 5: Integrate ChunkStore with SessionManager

**Files:**
- Modify: `witness-pwa/src/lib/sessionManager.js` (assumes exists from Milestone 2)

**Step 1: Add session persistence on start**

```javascript
import { saveSession, updateSession, getSession } from './chunkStore.js';

async startSession(groupIds, wrappedKeys) {
  const sessionId = crypto.randomUUID();

  const sessionRecord = {
    sessionId,
    status: 'recording',
    groupIds,
    wrappedKeys,
    chunkCount: 0,
    startedAt: Date.now()
  };

  // Persist session metadata
  await saveSession(sessionRecord);

  this.currentSession = sessionRecord;
  return sessionId;
}
```

**Step 2: Update session on each chunk**

```javascript
async processChunk(blob, index) {
  // ... existing processing logic ...

  // Update session chunk count in IndexedDB
  await updateSession(this.currentSession.sessionId, {
    chunkCount: index + 1
  });
}
```

**Step 3: Mark session complete**

```javascript
async endSession() {
  await updateSession(this.currentSession.sessionId, {
    status: 'complete',
    endedAt: Date.now()
  });

  this.currentSession = null;
}
```

**Step 4: Handle interruption**

```javascript
// Called if recording stops unexpectedly
async markInterrupted() {
  if (this.currentSession) {
    await updateSession(this.currentSession.sessionId, {
      status: 'interrupted',
      endedAt: Date.now()
    });
  }
}
```

**Step 5: Commit**

```bash
git add witness-pwa/src/lib/sessionManager.js
git commit -m "feat: integrate IndexedDB persistence with SessionManager"
```

---

### Task 6: Add Recovery Check to App Initialization

**Files:**
- Modify: `witness-pwa/src/main.js` (or app entry point)
- Create: `witness-pwa/src/components/RecoveryBanner.js` (optional UI)

**Step 1: Add recovery check on startup**

In `main.js` or app initialization:

```javascript
import { initRecovery, resumeUploads } from './lib/recoveryService.js';
import { uploadQueue } from './lib/uploadQueue.js';

// Check for recovery on app start
async function initializeApp() {
  // ... existing init ...

  // Check for incomplete sessions
  const recoveryStatus = await initRecovery();

  if (recoveryStatus.needsRecovery) {
    console.log('[app] Recovery needed:', recoveryStatus.recoverySummary);

    // Show recovery UI or auto-resume
    // Option 1: Auto-resume silently
    await resumeUploads(uploadQueue);

    // Option 2: Show UI for user decision
    // showRecoveryDialog(recoveryStatus.recoverySummary);
  }

  if (recoveryStatus.lowStorage) {
    console.warn('[app] Storage is running low');
    // Show storage warning
  }
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/main.js
git commit -m "feat: add recovery check on app startup"
```

---

### Task 7: Integration Test - Kill Tab Recovery

**Files:**
- Manual test procedure

**Test Procedure:**

1. **Setup**: Open app, start recording

2. **Capture chunks**:
   - Record for ~25 seconds (should capture chunks 0, 1, 2)
   - Open DevTools → Application → IndexedDB → WitnessChunks
   - Verify `chunks` store has 3 entries
   - Verify `sessions` store has 1 entry with `status: 'recording'`

3. **Simulate crash**:
   - Close the browser tab (Cmd+W / Ctrl+W)
   - OR: Use DevTools → Application → Clear site data → ONLY clear "Cache" (not IndexedDB)

4. **Verify persistence**:
   - Reopen the app
   - Open DevTools → IndexedDB → WitnessChunks
   - Verify chunks 0, 1, 2 are still present
   - Verify session status is 'recording' or 'interrupted'

5. **Verify recovery**:
   - Check console for `[recovery] Found incomplete data`
   - Verify chunks are re-enqueued
   - Wait for uploads to complete
   - Verify chunks reach `confirmed` status

6. **Verify no duplicates**:
   - Check IPFS/Pinata for the session
   - Verify only 3 chunk CIDs (not 6 from double-upload)

**Step 1: Document test results**

Create a manual test checklist:

```markdown
## Kill Tab Recovery Test - [DATE]

- [ ] Recorded 3 chunks
- [ ] Verified chunks in IndexedDB before kill
- [ ] Killed tab
- [ ] Reopened app
- [ ] Verified chunks still in IndexedDB
- [ ] Verified recovery log messages
- [ ] Verified chunks re-enqueued
- [ ] Verified uploads completed
- [ ] Verified no duplicate uploads
- [ ] Verified final on-chain state correct
```

**Step 2: Commit test documentation**

```bash
git add docs/testing/milestone-3-recovery-test.md
git commit -m "test: add kill-tab recovery test procedure"
```

---

### Task 8: Handle Multiple Incomplete Sessions

**Files:**
- Create: `witness-pwa/src/components/RecoveryDialog.js` (UI component)

**Step 1: Create recovery dialog component**

```javascript
// witness-pwa/src/components/RecoveryDialog.js

/**
 * RecoveryDialog - Shows when incomplete sessions are found on startup
 */

import { resumeUploads, discardSession, discardAllIncomplete } from '../lib/recoveryService.js';

export function createRecoveryDialog(recoverySummary, uploadQueue) {
  const dialog = document.createElement('dialog');
  dialog.className = 'recovery-dialog';

  const sessionsHtml = recoverySummary.sessions.map(s => `
    <div class="recovery-session" data-session-id="${s.sessionId}">
      <div class="session-info">
        <span class="session-date">${new Date(s.startedAt).toLocaleString()}</span>
        <span class="session-chunks">${s.pendingChunks} chunks pending</span>
      </div>
      <div class="session-actions">
        <button class="resume-btn" data-action="resume">Resume</button>
        <button class="discard-btn" data-action="discard">Discard</button>
      </div>
    </div>
  `).join('');

  dialog.innerHTML = `
    <h2>Incomplete Recordings Found</h2>
    <p>The app was closed while recording. Would you like to resume uploading?</p>
    <div class="sessions-list">
      ${sessionsHtml}
    </div>
    <div class="dialog-actions">
      <button class="resume-all-btn">Resume All</button>
      <button class="discard-all-btn">Discard All</button>
    </div>
  `;

  // Event handlers
  dialog.querySelector('.resume-all-btn').onclick = async () => {
    await resumeUploads(uploadQueue);
    dialog.close();
  };

  dialog.querySelector('.discard-all-btn').onclick = async () => {
    await discardAllIncomplete();
    dialog.close();
  };

  dialog.querySelectorAll('.session-actions button').forEach(btn => {
    btn.onclick = async (e) => {
      const sessionId = e.target.closest('.recovery-session').dataset.sessionId;
      const action = e.target.dataset.action;

      if (action === 'resume') {
        // Resume single session
        await resumeUploads(uploadQueue); // TODO: Filter to single session
      } else {
        await discardSession(sessionId);
        e.target.closest('.recovery-session').remove();

        // Close dialog if no sessions left
        if (dialog.querySelectorAll('.recovery-session').length === 0) {
          dialog.close();
        }
      }
    };
  });

  document.body.appendChild(dialog);
  dialog.showModal();

  return dialog;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/components/RecoveryDialog.js
git commit -m "feat: add recovery dialog for multiple incomplete sessions"
```

---

### Task 9: Add Storage Quota Warning

**Files:**
- Modify: `witness-pwa/src/lib/recoveryService.js`
- Create: `witness-pwa/src/components/StorageWarning.js`

**Step 1: Add quota monitoring**

In `recoveryService.js`, add periodic check:

```javascript
let storageWarningShown = false;

/**
 * Check storage periodically during recording
 */
export async function checkStorageDuringRecording() {
  if (storageWarningShown) return;

  const isLow = await isStorageLow();
  if (isLow) {
    storageWarningShown = true;

    const status = await getStorageStatus();
    console.warn('[recovery] Storage warning:', status);

    // Emit event for UI
    window.dispatchEvent(new CustomEvent('witness:storage-low', {
      detail: status
    }));
  }
}

/**
 * Reset warning flag (call when recording ends)
 */
export function resetStorageWarning() {
  storageWarningShown = false;
}
```

**Step 2: Create storage warning component**

```javascript
// witness-pwa/src/components/StorageWarning.js

export function showStorageWarning(storageStatus) {
  const existing = document.querySelector('.storage-warning');
  if (existing) return;

  const warning = document.createElement('div');
  warning.className = 'storage-warning';
  warning.innerHTML = `
    <div class="warning-content">
      <span class="warning-icon">⚠️</span>
      <span class="warning-text">
        Storage is ${storageStatus.usagePercent}% full.
        Recording may stop if storage runs out.
      </span>
      <button class="warning-dismiss">×</button>
    </div>
  `;

  warning.querySelector('.warning-dismiss').onclick = () => {
    warning.remove();
  };

  document.body.appendChild(warning);

  // Auto-dismiss after 10 seconds
  setTimeout(() => warning.remove(), 10000);
}

// Listen for storage warning events
window.addEventListener('witness:storage-low', (e) => {
  showStorageWarning(e.detail);
});
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/recoveryService.js witness-pwa/src/components/StorageWarning.js
git commit -m "feat: add storage quota warning during recording"
```

---

## Summary

This plan implements crash resilience through:

1. **ChunkStore** - Dexie.js wrapper for IndexedDB with chunk and session storage
2. **RecoveryService** - Startup check and resume logic for incomplete sessions
3. **UploadQueue integration** - Persist-first pattern ensures chunks survive crashes
4. **SessionManager integration** - Session metadata persisted throughout recording
5. **Recovery UI** - Dialog for user to resume or discard incomplete sessions
6. **Storage monitoring** - Warn users when storage is running low

**Key Principle**: Write to IndexedDB BEFORE any processing. Chunks are only deleted from IndexedDB after on-chain confirmation.

---

## Test Checkpoints

| Checkpoint | Verification |
|------------|-------------|
| Dexie installed | `npm ls dexie` shows version |
| ChunkStore works | Console test saves/retrieves chunk |
| Recovery detects data | Console shows "[recovery] Found incomplete data" |
| Kill-tab recovery | Chunks survive tab close and resume on reopen |
| No duplicate uploads | Same CIDs after recovery as before kill |
| Multiple sessions | Dialog shows all incomplete sessions |
| Storage warning | Warning appears when > 80% storage used |

---

## References

- [Phase 8 Plan](./2026-02-02-phase-8-streaming-video-capture.md) - High-level streaming capture plan
- [Data Chunking Design](../../research/video-storage-and-transport/data-chunking-transport-design.md) - Chunk lifecycle states
- [Dexie.js Docs](https://dexie.org/docs/) - IndexedDB wrapper documentation
- [MDN Storage API](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API) - Browser storage quotas
