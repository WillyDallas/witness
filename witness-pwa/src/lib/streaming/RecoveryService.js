/**
 * RecoveryService
 * Handles app startup recovery for incomplete/interrupted recording sessions.
 * Checks IndexedDB for pending data and coordinates with UploadQueue.
 */
import { db } from './streamingDb.js';

// Recovery state
let recoveryState = {
  checked: false,
  hasData: false,
  recovering: false,
  summary: null,
};

/**
 * Check for incomplete sessions on app startup
 * @returns {Promise<Object[]|null>} Array of interrupted sessions or null
 */
export async function checkForRecovery() {
  console.log('[RecoveryService] Checking for incomplete sessions...');

  const sessions = await db.sessions
    .where('status')
    .anyOf(['recording', 'uploading'])
    .toArray();

  recoveryState.checked = true;
  recoveryState.hasData = sessions.length > 0;

  if (sessions.length > 0) {
    console.log(`[RecoveryService] Found ${sessions.length} incomplete session(s)`);
    return sessions;
  }

  console.log('[RecoveryService] No incomplete sessions found');
  return null;
}

/**
 * Get detailed recovery summary for UI display
 * @returns {Promise<Object>}
 */
export async function getRecoverySummary() {
  const sessions = await db.sessions
    .where('status')
    .anyOf(['recording', 'uploading'])
    .toArray();

  const summary = {
    sessionCount: sessions.length,
    sessions: [],
  };

  for (const session of sessions) {
    const pendingUploads = await db.pendingUploads
      .where('sessionId')
      .equals(session.sessionId)
      .toArray();

    const uploadedCount = pendingUploads.filter(u => u.status === 'uploaded').length;
    const pendingCount = pendingUploads.filter(u => u.status === 'pending').length;
    const failedCount = pendingUploads.filter(u => u.status === 'failed').length;

    summary.sessions.push({
      sessionId: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      chunkCount: session.chunkCount || pendingUploads.length,
      uploadedChunks: uploadedCount,
      pendingChunks: pendingCount,
      failedChunks: failedCount,
      latestManifestCid: session.latestManifestCid,
    });
  }

  recoveryState.summary = summary;
  return summary;
}

/**
 * Resume uploads for an interrupted session
 * @param {string} sessionId - Session to resume
 * @param {UploadQueue} uploadQueue - Upload queue instance
 */
export async function resumeSession(sessionId, uploadQueue) {
  console.log(`[RecoveryService] Resuming session ${sessionId}`);

  // Mark session as uploading
  await db.sessions.update(sessionId, { status: 'uploading' });

  // Reset failed chunks to pending for retry
  const failedChunks = await db.pendingUploads
    .where('[sessionId+status]')
    .equals([sessionId, 'failed'])
    .toArray();

  for (const chunk of failedChunks) {
    await db.pendingUploads.update(chunk.id, {
      status: 'pending',
      retryCount: 0,
      lastError: null,
    });
  }

  // Start the queue - it will auto-process pending items from DB
  uploadQueue.start();

  console.log(`[RecoveryService] Session ${sessionId} resumed`);
}

/**
 * Resume all incomplete sessions
 * @param {UploadQueue} uploadQueue - Upload queue instance
 */
export async function resumeAllSessions(uploadQueue) {
  const sessions = await checkForRecovery();
  if (!sessions) return;

  recoveryState.recovering = true;

  for (const session of sessions) {
    await resumeSession(session.sessionId, uploadQueue);
  }

  recoveryState.recovering = false;
  console.log('[RecoveryService] All sessions resumed');
}

/**
 * Discard an incomplete session (user chose not to recover)
 * @param {string} sessionId - Session to discard
 */
export async function discardSession(sessionId) {
  console.log(`[RecoveryService] Discarding session ${sessionId}`);

  // Delete all pending uploads for this session
  await db.pendingUploads.where('sessionId').equals(sessionId).delete();

  // Mark session as complete (discarded)
  await db.sessions.update(sessionId, {
    status: 'complete',
    completedAt: Date.now(),
  });

  console.log(`[RecoveryService] Session ${sessionId} discarded`);
}

/**
 * Discard all incomplete sessions
 */
export async function discardAllSessions() {
  const sessions = await checkForRecovery();
  if (!sessions) return;

  for (const session of sessions) {
    await discardSession(session.sessionId);
  }

  recoveryState.hasData = false;
  recoveryState.summary = null;
  console.log('[RecoveryService] All incomplete sessions discarded');
}

/**
 * Request persistent storage from browser
 * Prevents browser from evicting IndexedDB data under storage pressure
 * @returns {Promise<boolean>} Whether persistent storage was granted
 */
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    const granted = await navigator.storage.persist();
    console.log('[RecoveryService] Persistent storage:', granted ? 'granted' : 'denied');
    return granted;
  }
  console.log('[RecoveryService] Persistent storage API not available');
  return false;
}

/**
 * Check if persistent storage is already granted
 * @returns {Promise<boolean>}
 */
export async function isPersisted() {
  if (navigator.storage && navigator.storage.persisted) {
    return navigator.storage.persisted();
  }
  return false;
}

/**
 * Get current storage status
 * @returns {Promise<Object>}
 */
export async function getStorageStatus() {
  if (!navigator.storage?.estimate) {
    return { available: false };
  }

  const estimate = await navigator.storage.estimate();
  const persisted = await isPersisted();

  return {
    usage: estimate.usage,
    quota: estimate.quota,
    usagePercent: ((estimate.usage / estimate.quota) * 100).toFixed(1),
    isLow: estimate.usage / estimate.quota > 0.8,
    persistent: persisted,
  };
}

/**
 * Check if storage is getting low (> 80% used)
 * @returns {Promise<boolean>}
 */
export async function isStorageLow() {
  const status = await getStorageStatus();
  return status.isLow || false;
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

  // Check for incomplete sessions
  const incompleteSessions = await checkForRecovery();
  const recoverySummary = incompleteSessions
    ? await getRecoverySummary()
    : null;

  return {
    persistent,
    storageStatus,
    needsRecovery: incompleteSessions !== null,
    sessions: incompleteSessions,
    recoverySummary,
  };
}

/**
 * Get current recovery state
 * @returns {Object}
 */
export function getRecoveryState() {
  return { ...recoveryState };
}

/**
 * Clear all data (for testing or user-initiated reset)
 */
export async function clearAllData() {
  await db.pendingUploads.clear();
  await db.sessions.clear();
  recoveryState = {
    checked: false,
    hasData: false,
    recovering: false,
    summary: null,
  };
  console.log('[RecoveryService] All data cleared');
}

export default {
  checkForRecovery,
  getRecoverySummary,
  resumeSession,
  resumeAllSessions,
  discardSession,
  discardAllSessions,
  requestPersistentStorage,
  isPersisted,
  getStorageStatus,
  isStorageLow,
  initRecovery,
  getRecoveryState,
  clearAllData,
};
