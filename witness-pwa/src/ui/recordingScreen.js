/**
 * Recording Screen Controller
 * Manages fullscreen recording UI with camera preview, timer, and chunk status.
 */

import { SessionManager, createWiredCapture } from '../lib/streaming/SessionManager.js';
import { getAddress, getEncryptionKey } from '../lib/authState.js';
import { generateContentKey, wrapContentKey, bytesToHex, hexToBytes } from '../lib/encryption.js';
import { getGroupSecrets } from '../lib/storage.js';
import { getDefaultGroupIds } from '../lib/settingsStorage.js';

// DOM elements
let screenEl = null;
let previewEl = null;
let timeEl = null;
let chunkCountEl = null;
let chunkStatusEl = null;
let stopBtn = null;
let summaryEl = null;

// State
let captureService = null;
let sessionManager = null;
let timerInterval = null;
let chunkPollInterval = null;
let startTime = null;
let selectedGroupIds = [];
let lastChunkCount = 0;
let pendingChunks = 0;
let errorChunks = 0;

// Callbacks
let onComplete = null;

/**
 * Format seconds as MM:SS or M:SS
 */
export function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Update the timer display
 */
function updateTimer() {
    if (!startTime || !timeEl) return;

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    timeEl.textContent = formatTime(elapsed);
}

/**
 * Update chunk status display
 */
function updateChunkStatus(chunkCount, pending = 0, errors = 0) {
    if (!chunkCountEl || !chunkStatusEl) return;

    chunkCountEl.textContent = chunkCount;

    // Update status indicator
    chunkStatusEl.classList.remove('confirmed', 'pending', 'error');
    const iconEl = chunkStatusEl.querySelector('.chunk-icon');

    if (errors > 0) {
        chunkStatusEl.classList.add('error');
        if (iconEl) iconEl.textContent = '⚠️';
    } else if (pending > 0) {
        chunkStatusEl.classList.add('pending');
        if (iconEl) iconEl.textContent = '⏳';
    } else {
        chunkStatusEl.classList.add('confirmed');
        if (iconEl) iconEl.textContent = '✓';
    }
}

/**
 * Poll session manager for chunk count updates
 */
function pollChunkStatus() {
    if (!sessionManager) return;

    const count = sessionManager.getChunkCount();
    if (count !== lastChunkCount) {
        lastChunkCount = count;
        updateChunkStatus(count, pendingChunks, errorChunks);
    }
}

/**
 * Initialize DOM references
 */
function initElements() {
    screenEl = document.getElementById('recording-screen');
    previewEl = document.getElementById('recording-preview');
    timeEl = document.getElementById('recording-time');
    chunkCountEl = document.getElementById('chunk-count');
    chunkStatusEl = document.getElementById('chunk-status');
    stopBtn = document.getElementById('stop-recording-btn');
    summaryEl = document.getElementById('recording-summary');
}

/**
 * Show the recording screen
 */
function showRecordingScreen() {
    if (screenEl) {
        screenEl.classList.remove('hidden');
    }
}

/**
 * Hide the recording screen
 */
function hideRecordingScreen() {
    if (screenEl) {
        screenEl.classList.add('hidden');
    }
}

/**
 * Show the summary overlay
 */
function showSummary(chunkCount, allConfirmed = true) {
    if (!summaryEl) return;

    const titleEl = document.getElementById('summary-title');
    const detailsEl = document.getElementById('summary-details');

    if (allConfirmed) {
        titleEl.textContent = 'Recording Complete';
        detailsEl.textContent = `${chunkCount} chunks uploaded, all confirmed ✓`;
    } else {
        titleEl.textContent = 'Recording Saved';
        detailsEl.textContent = `${chunkCount} chunks captured, some pending upload`;
    }

    summaryEl.classList.remove('hidden');
}

/**
 * Hide the summary overlay
 */
function hideSummary() {
    if (summaryEl) {
        summaryEl.classList.add('hidden');
    }
}

/**
 * Prevent pull-to-refresh gesture during recording
 */
function preventPullToRefresh() {
    document.body.style.overscrollBehavior = 'none';

    if (screenEl) {
        screenEl.addEventListener('touchmove', preventTouchMove, { passive: false });
    }
}

function preventTouchMove(e) {
    e.preventDefault();
}

function allowPullToRefresh() {
    document.body.style.overscrollBehavior = '';

    if (screenEl) {
        screenEl.removeEventListener('touchmove', preventTouchMove);
    }
}

/**
 * Stop recording and show summary
 */
async function stopRecording() {
    // Stop timer
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }

    // Stop chunk polling
    if (chunkPollInterval) {
        clearInterval(chunkPollInterval);
        chunkPollInterval = null;
    }

    // Stop capture and wait for final chunk to be processed
    if (captureService) {
        console.log('[RecordingScreen] Waiting for final chunk...');
        await captureService.stop();
        console.log('[RecordingScreen] All chunks processed');
    }

    // Get final chunk count after all chunks are processed
    const finalChunkCount = sessionManager ? sessionManager.getChunkCount() : 0;

    // End session
    if (sessionManager) {
        try {
            await sessionManager.endSession();
        } catch (err) {
            console.error('Error ending session:', err);
        }
    }

    // Hide recording screen, show summary
    hideRecordingScreen();

    // Re-enable pull-to-refresh
    allowPullToRefresh();

    // Show summary
    showSummary(finalChunkCount, errorChunks === 0);
}

/**
 * Start the recording screen
 * @param {Object} options - Optional callbacks
 * @param {Function} options.onComplete - Called when recording ends with session result
 */
export async function startRecordingScreen(options = {}) {
    onComplete = options.onComplete || null;

    initElements();

    // Get groups from settings
    const groupIds = getDefaultGroupIds();
    if (groupIds.length === 0) {
        throw new Error('No groups selected. Please select at least one group in Settings.');
    }
    selectedGroupIds = groupIds;
    console.log('[RecordingScreen] Using groups from settings:', groupIds.map(g => g.slice(0, 10) + '...'));

    // Reset UI state
    if (timeEl) timeEl.textContent = '0:00';
    if (chunkCountEl) chunkCountEl.textContent = '0';
    lastChunkCount = 0;
    pendingChunks = 0;
    errorChunks = 0;
    updateChunkStatus(0, 0, 0);

    // Get auth state
    const uploader = getAddress();
    const encryptionKey = getEncryptionKey();

    if (!uploader || !encryptionKey) {
        console.error('[RecordingScreen] Missing auth state');
        throw new Error('Authentication required');
    }

    // Generate a random session key for this recording
    const sessionKey = await generateContentKey();
    console.log('[RecordingScreen] Generated session key for recording');

    // Wrap session key for each selected group
    const accessList = {};
    const secrets = await getGroupSecrets(encryptionKey);

    for (const groupId of groupIds) {
        const groupData = secrets[groupId];
        if (!groupData) {
            console.error(`[RecordingScreen] Group secret not found for ${groupId.slice(0, 10)}...`);
            throw new Error(`Group secret not found. Please rejoin the group.`);
        }

        const groupSecret = hexToBytes(groupData.secretHex);
        const { iv: wrapIv, wrappedKey } = await wrapContentKey(sessionKey, groupSecret);

        accessList[groupId] = {
            wrappedKey: bytesToHex(new Uint8Array(wrappedKey)),
            iv: bytesToHex(wrapIv),
        };
        console.log(`[RecordingScreen] Wrapped session key for group ${groupId.slice(0, 10)}...`);
    }

    // Create session manager with accessList
    sessionManager = await SessionManager.create({
        groupIds,
        uploader,
        sessionKey,
        accessList
    });

    // Create wired capture service (automatically routes chunks to session)
    captureService = await createWiredCapture(sessionManager, {
        timeslice: 10000 // 10 second chunks
    });

    // Start capture
    await captureService.start();

    // Attach stream to preview
    const stream = captureService.getStream();
    if (stream && previewEl) {
        previewEl.srcObject = stream;
    }

    // Start timer
    startTime = Date.now();
    timerInterval = setInterval(updateTimer, 1000);

    // Start chunk status polling
    chunkPollInterval = setInterval(pollChunkStatus, 500);

    // Show recording screen
    showRecordingScreen();

    // Prevent pull-to-refresh during recording
    preventPullToRefresh();

    // Wire up stop button
    if (stopBtn) {
        stopBtn.onclick = stopRecording;
    }

    // Wire up summary buttons
    const viewBtn = document.getElementById('view-recording-btn');
    const dismissBtn = document.getElementById('dismiss-summary-btn');

    if (viewBtn) {
        viewBtn.onclick = () => {
            hideSummary();
            if (onComplete) {
                onComplete({ sessionId: sessionManager?.sessionId, action: 'view' });
            }
        };
    }

    if (dismissBtn) {
        dismissBtn.onclick = () => {
            hideSummary();
            if (onComplete) {
                onComplete({ sessionId: sessionManager?.sessionId, action: 'dismiss' });
            }
        };
    }
}

/**
 * Force stop recording (e.g., when navigating away)
 */
export async function forceStopRecording() {
    if (captureService && captureService.isRecording()) {
        await stopRecording();
    }
}
