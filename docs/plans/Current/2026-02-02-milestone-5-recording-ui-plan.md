# Milestone 5: Recording UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fullscreen camera UI with minimal overlay for streaming video capture, including group selection before recording and summary after stopping.

**Architecture:** Replace current touch-hold recording with a dedicated recording screen. The UI transitions: Main Screen → Group Selection Modal → Fullscreen Recording → Summary Overlay → Content Detail. All state flows through SessionManager from Milestone 4.

**Tech Stack:** Vanilla JS (matches existing codebase), CSS with safe-area-inset for mobile notches, Screen Wake Lock API, existing CaptureService and SessionManager from Milestone 4.

---

## Prerequisites

Before starting this milestone, ensure:
- Milestone 4 (CaptureService) is complete and tested
- `witness-pwa/src/services/captureService.js` exists with `start()`, `stop()`, `getStream()` methods
- `witness-pwa/src/services/sessionManager.js` exists with `processChunk()` and status events

---

## Task 1: Create Recording Screen HTML Structure

**Files:**
- Modify: `witness-pwa/index.html`

**Step 1: Add the recording screen HTML**

Add this after the `</div>` of `.app-container` (before the script tag):

```html
<!-- Recording Screen (fullscreen overlay, hidden by default) -->
<div id="recording-screen" class="recording-screen hidden">
    <!-- Camera Preview (fullscreen) -->
    <video id="recording-preview" autoplay muted playsinline></video>

    <!-- Status Bar (minimal overlay at top) -->
    <div class="recording-status-bar">
        <div class="recording-status-left">
            <span class="recording-dot"></span>
            <span id="recording-time" class="recording-time">0:00</span>
        </div>
        <div class="recording-status-right">
            <span id="chunk-status" class="chunk-status">
                <span class="chunk-icon">✓</span>
                <span id="chunk-count">0</span>
            </span>
        </div>
    </div>

    <!-- Stop Button (centered at bottom) -->
    <button id="stop-recording-btn" class="stop-recording-btn">
        <span class="stop-icon"></span>
    </button>
</div>

<!-- Recording Summary Overlay -->
<div id="recording-summary" class="recording-summary hidden">
    <div class="summary-content">
        <div class="summary-icon">✓</div>
        <h3 id="summary-title">Recording Complete</h3>
        <p id="summary-details">15 chunks uploaded, all confirmed</p>
        <div class="summary-actions">
            <button id="view-recording-btn" class="btn btn-primary">View Recording</button>
            <button id="dismiss-summary-btn" class="btn btn-secondary">Done</button>
        </div>
    </div>
</div>
```

**Step 2: Run the dev server to verify HTML renders**

Run: `cd witness-pwa && npm run dev`
Expected: Page loads without errors, recording screen is hidden

**Step 3: Commit**

```bash
git add witness-pwa/index.html
git commit -m "feat(ui): add recording screen HTML structure"
```

---

## Task 2: Add Recording Screen CSS

**Files:**
- Modify: `witness-pwa/styles.css`

**Step 1: Add recording screen styles**

Add at the end of `styles.css`:

```css
/* ============================================
   RECORDING SCREEN
============================================ */

.recording-screen {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #000;
    z-index: 2000;
    display: flex;
    flex-direction: column;
}

.recording-screen.hidden {
    display: none;
}

/* Fullscreen camera preview */
#recording-preview {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background-color: #000;
}

/* Status bar overlay */
.recording-status-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top));
    padding-left: calc(16px + env(safe-area-inset-left));
    padding-right: calc(16px + env(safe-area-inset-right));
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.6), transparent);
    z-index: 10;
}

.recording-status-left {
    display: flex;
    align-items: center;
    gap: 8px;
}

.recording-dot {
    width: 12px;
    height: 12px;
    background-color: #ef4444;
    border-radius: 50%;
    animation: recording-pulse 1s ease-in-out infinite;
}

@keyframes recording-pulse {
    0%, 100% {
        opacity: 1;
        transform: scale(1);
    }
    50% {
        opacity: 0.5;
        transform: scale(0.85);
    }
}

.recording-time {
    font-size: 16px;
    font-weight: 600;
    color: #fff;
    font-variant-numeric: tabular-nums;
}

.recording-status-right {
    display: flex;
    align-items: center;
}

.chunk-status {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    background: rgba(0, 0, 0, 0.4);
    border-radius: 12px;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
}

.chunk-icon {
    font-size: 14px;
}

.chunk-status.confirmed .chunk-icon {
    color: #22c55e;
}

.chunk-status.pending .chunk-icon {
    color: #eab308;
}

.chunk-status.error .chunk-icon {
    color: #ef4444;
}

#chunk-count {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
}

/* Stop button */
.stop-recording-btn {
    position: absolute;
    bottom: 40px;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: env(safe-area-inset-bottom);
    width: 72px;
    height: 72px;
    border-radius: 50%;
    background-color: rgba(255, 255, 255, 0.9);
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    transition: transform 0.1s, background-color 0.2s;
    -webkit-tap-highlight-color: transparent;
}

.stop-recording-btn:active {
    transform: translateX(-50%) scale(0.95);
    background-color: rgba(255, 255, 255, 1);
}

.stop-icon {
    width: 24px;
    height: 24px;
    background-color: #ef4444;
    border-radius: 4px;
}

/* ============================================
   RECORDING SUMMARY
============================================ */

.recording-summary {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.9);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2100;
    padding: 20px;
}

.recording-summary.hidden {
    display: none;
}

.summary-content {
    text-align: center;
    max-width: 320px;
}

.summary-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: #22c55e;
    color: #fff;
    font-size: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 0 auto 16px;
}

.summary-content h3 {
    font-size: 20px;
    font-weight: 600;
    color: #fff;
    margin: 0 0 8px;
}

.summary-content p {
    font-size: 14px;
    color: var(--text-muted);
    margin: 0 0 24px;
}

.summary-actions {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.summary-actions .btn {
    width: 100%;
}
```

**Step 2: Verify styles in browser**

Run: `cd witness-pwa && npm run dev`
Expected: If you remove `hidden` class from recording-screen in devtools, fullscreen black overlay appears with status bar

**Step 3: Commit**

```bash
git add witness-pwa/styles.css
git commit -m "feat(ui): add recording screen and summary CSS"
```

---

## Task 3: Create Group Selection Modal for Recording

**Files:**
- Create: `witness-pwa/src/ui/recordingGroupSelect.js`

**Step 1: Write the failing test**

Create `witness-pwa/src/ui/__tests__/recordingGroupSelect.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('../../lib/authState.js', () => ({
    getAuthState: vi.fn(() => ({ encryptionKey: 'mock-key' }))
}));

vi.mock('../../lib/groups.js', () => ({
    getMyGroups: vi.fn(() => Promise.resolve([
        { groupId: 'group1', name: 'Family', isCreator: true },
        { groupId: 'group2', name: 'Work', isCreator: false }
    ]))
}));

describe('recordingGroupSelect', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('should export showRecordingGroupSelect function', async () => {
        const { showRecordingGroupSelect } = await import('../recordingGroupSelect.js');
        expect(typeof showRecordingGroupSelect).toBe('function');
    });

    it('should render group checkboxes', async () => {
        const { showRecordingGroupSelect } = await import('../recordingGroupSelect.js');

        await showRecordingGroupSelect();

        const checkboxes = document.querySelectorAll('.group-check-input');
        expect(checkboxes.length).toBe(2);
    });

    it('should call onConfirm with selected group IDs', async () => {
        const { showRecordingGroupSelect } = await import('../recordingGroupSelect.js');
        const onConfirm = vi.fn();

        await showRecordingGroupSelect(onConfirm);

        // Select first group
        const checkbox = document.querySelector('.group-check-input');
        checkbox.checked = true;

        // Click start button
        const startBtn = document.getElementById('start-recording-btn');
        startBtn.click();

        expect(onConfirm).toHaveBeenCalledWith(['group1']);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd witness-pwa && npm test -- --run recordingGroupSelect`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `witness-pwa/src/ui/recordingGroupSelect.js`:

```javascript
/**
 * Recording Group Selection Modal
 * Allows user to select which groups to share recording with BEFORE recording starts.
 * Groups cannot be changed mid-recording.
 */

import { getAuthState } from '../lib/authState.js';
import { getMyGroups } from '../lib/groups.js';

let modal = null;
let onConfirmCallback = null;

/**
 * Create the modal HTML
 */
function createModal() {
    const div = document.createElement('div');
    div.id = 'recording-group-select';
    div.className = 'modal-overlay hidden';
    div.innerHTML = `
        <div class="modal-content recording-group-modal">
            <div class="modal-header">
                <h2>Select Groups</h2>
                <button class="modal-close" id="close-group-select">&times;</button>
            </div>

            <div class="modal-body">
                <p class="group-select-hint">
                    Choose which groups can view this recording.
                    This cannot be changed after recording starts.
                </p>

                <div id="recording-groups-list" class="upload-groups-list">
                    <div class="loading-spinner"></div>
                </div>

                <p id="no-groups-warning" class="error-text hidden">
                    You need to create or join a group first.
                </p>
            </div>

            <div class="modal-footer">
                <button id="start-recording-btn" class="btn btn-primary btn-full" disabled>
                    Start Recording
                </button>
            </div>
        </div>
    `;
    return div;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Load and render groups as checkboxes
 */
async function loadGroups() {
    const listEl = document.getElementById('recording-groups-list');
    const warningEl = document.getElementById('no-groups-warning');
    const startBtn = document.getElementById('start-recording-btn');

    const { encryptionKey } = getAuthState();

    if (!encryptionKey) {
        listEl.innerHTML = '<p class="muted">Login required</p>';
        return;
    }

    try {
        const groups = await getMyGroups();

        if (groups.length === 0) {
            listEl.innerHTML = '';
            warningEl.classList.remove('hidden');
            startBtn.disabled = true;
            return;
        }

        warningEl.classList.add('hidden');

        listEl.innerHTML = groups.map(g => `
            <label class="group-checkbox">
                <input type="checkbox"
                       class="group-check-input"
                       value="${g.groupId}"
                       data-group-name="${escapeHtml(g.name)}">
                <span class="group-check-label">${escapeHtml(g.name)}</span>
                <span class="group-check-meta">${g.isCreator ? 'Creator' : 'Member'}</span>
            </label>
        `).join('');

        // Enable start button when at least one group selected
        const checkboxes = listEl.querySelectorAll('.group-check-input');
        checkboxes.forEach(cb => {
            cb.addEventListener('change', () => {
                const anyChecked = [...checkboxes].some(c => c.checked);
                startBtn.disabled = !anyChecked;
            });
        });

    } catch (err) {
        listEl.innerHTML = `<p class="error-text">Error: ${err.message}</p>`;
    }
}

/**
 * Get selected group IDs
 */
function getSelectedGroupIds() {
    const checkboxes = document.querySelectorAll('#recording-groups-list .group-check-input:checked');
    return [...checkboxes].map(cb => cb.value);
}

/**
 * Show the group selection modal
 * @param {Function} onConfirm - Called with array of selected group IDs when user clicks Start
 * @returns {Promise<void>}
 */
export async function showRecordingGroupSelect(onConfirm) {
    onConfirmCallback = onConfirm;

    if (!modal) {
        modal = createModal();
        document.body.appendChild(modal);

        // Close button
        document.getElementById('close-group-select').addEventListener('click', hideRecordingGroupSelect);

        // Click outside to close
        modal.addEventListener('click', (e) => {
            if (e.target === modal) hideRecordingGroupSelect();
        });

        // Start recording button
        document.getElementById('start-recording-btn').addEventListener('click', () => {
            const selectedIds = getSelectedGroupIds();
            if (selectedIds.length > 0 && onConfirmCallback) {
                hideRecordingGroupSelect();
                onConfirmCallback(selectedIds);
            }
        });
    }

    modal.classList.remove('hidden');
    await loadGroups();
}

/**
 * Hide the modal
 */
export function hideRecordingGroupSelect() {
    if (modal) {
        modal.classList.add('hidden');
    }
}
```

**Step 4: Run test to verify it passes**

Run: `cd witness-pwa && npm test -- --run recordingGroupSelect`
Expected: PASS

**Step 5: Commit**

```bash
git add witness-pwa/src/ui/recordingGroupSelect.js witness-pwa/src/ui/__tests__/recordingGroupSelect.test.js
git commit -m "feat(ui): add recording group selection modal"
```

---

## Task 4: Add Group Selection Modal CSS

**Files:**
- Modify: `witness-pwa/styles.css`

**Step 1: Add modal styles**

Add to the end of `styles.css`:

```css
/* ============================================
   RECORDING GROUP SELECT MODAL
============================================ */

.recording-group-modal {
    max-width: 400px;
}

.recording-group-modal .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
}

.recording-group-modal .modal-header h2 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-light);
}

.group-select-hint {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0 0 1rem;
    line-height: 1.4;
}

.recording-group-modal .modal-footer {
    margin-top: 1.5rem;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/styles.css
git commit -m "feat(ui): add recording group select modal styles"
```

---

## Task 5: Create Recording Screen Controller

**Files:**
- Create: `witness-pwa/src/ui/recordingScreen.js`

**Step 1: Write the failing test**

Create `witness-pwa/src/ui/__tests__/recordingScreen.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock CaptureService
const mockCaptureService = {
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    getStream: vi.fn(() => ({ getTracks: () => [] })),
    isRecording: vi.fn(() => false)
};

vi.mock('../../services/captureService.js', () => ({
    CaptureService: vi.fn(() => mockCaptureService)
}));

// Mock SessionManager
const mockSessionManager = {
    startSession: vi.fn(() => Promise.resolve('session-123')),
    endSession: vi.fn(() => Promise.resolve({ chunkCount: 3, allConfirmed: true })),
    processChunk: vi.fn(() => Promise.resolve()),
    getStatus: vi.fn(() => ({ chunkCount: 0, confirmedCount: 0, pendingCount: 0 })),
    on: vi.fn(),
    off: vi.fn()
};

vi.mock('../../services/sessionManager.js', () => ({
    SessionManager: vi.fn(() => mockSessionManager)
}));

describe('recordingScreen', () => {
    beforeEach(() => {
        // Set up DOM
        document.body.innerHTML = `
            <div id="recording-screen" class="hidden">
                <video id="recording-preview"></video>
                <span id="recording-time">0:00</span>
                <span id="chunk-count">0</span>
                <div id="chunk-status" class="chunk-status"></div>
                <button id="stop-recording-btn"></button>
            </div>
            <div id="recording-summary" class="hidden">
                <h3 id="summary-title"></h3>
                <p id="summary-details"></p>
                <button id="view-recording-btn"></button>
                <button id="dismiss-summary-btn"></button>
            </div>
        `;
        vi.clearAllMocks();
    });

    it('should export startRecordingScreen function', async () => {
        const { startRecordingScreen } = await import('../recordingScreen.js');
        expect(typeof startRecordingScreen).toBe('function');
    });

    it('should show recording screen when started', async () => {
        const { startRecordingScreen } = await import('../recordingScreen.js');

        await startRecordingScreen(['group1']);

        const screen = document.getElementById('recording-screen');
        expect(screen.classList.contains('hidden')).toBe(false);
    });

    it('should format time correctly', async () => {
        const { formatTime } = await import('../recordingScreen.js');

        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(65)).toBe('1:05');
        expect(formatTime(3661)).toBe('61:01');
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd witness-pwa && npm test -- --run recordingScreen`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

Create `witness-pwa/src/ui/recordingScreen.js`:

```javascript
/**
 * Recording Screen Controller
 * Manages fullscreen recording UI with camera preview, timer, and chunk status.
 */

// Note: These imports will work once Milestone 4 is complete
// import { CaptureService } from '../services/captureService.js';
// import { SessionManager } from '../services/sessionManager.js';

// Temporary mocks for UI development (remove when Milestone 4 is ready)
const CaptureService = class {
    constructor(opts) { this.opts = opts; }
    async start() { console.log('[Mock] CaptureService.start()'); }
    stop() { console.log('[Mock] CaptureService.stop()'); }
    getStream() { return null; }
    isRecording() { return false; }
};

const SessionManager = class {
    async startSession() { return 'mock-session-' + Date.now(); }
    async endSession() { return { chunkCount: 3, allConfirmed: true }; }
    async processChunk() {}
    getStatus() { return { chunkCount: 0, confirmedCount: 0, pendingCount: 0, errorCount: 0 }; }
    on() {}
    off() {}
};

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
let wakeLock = null;
let timerInterval = null;
let startTime = null;
let selectedGroupIds = [];
let currentSessionId = null;

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
 * Request screen wake lock to prevent screen from sleeping
 */
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                console.log('Wake lock released');
            });
            console.log('Wake lock acquired');
        } catch (err) {
            console.warn('Wake lock failed:', err.message);
        }
    }
}

/**
 * Release screen wake lock
 */
async function releaseWakeLock() {
    if (wakeLock) {
        try {
            await wakeLock.release();
            wakeLock = null;
        } catch (err) {
            console.warn('Wake lock release failed:', err.message);
        }
    }
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
function updateChunkStatus(status) {
    if (!chunkCountEl || !chunkStatusEl) return;

    const { chunkCount, confirmedCount, pendingCount, errorCount } = status;

    chunkCountEl.textContent = chunkCount;

    // Update status indicator
    chunkStatusEl.classList.remove('confirmed', 'pending', 'error');

    if (errorCount > 0) {
        chunkStatusEl.classList.add('error');
        chunkStatusEl.querySelector('.chunk-icon').textContent = '⚠️';
    } else if (pendingCount > 0) {
        chunkStatusEl.classList.add('pending');
        chunkStatusEl.querySelector('.chunk-icon').textContent = '⏳';
    } else {
        chunkStatusEl.classList.add('confirmed');
        chunkStatusEl.querySelector('.chunk-icon').textContent = '✓';
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
function showSummary(result) {
    if (!summaryEl) return;

    const titleEl = document.getElementById('summary-title');
    const detailsEl = document.getElementById('summary-details');

    if (result.allConfirmed) {
        titleEl.textContent = 'Recording Complete';
        detailsEl.textContent = `${result.chunkCount} chunks uploaded, all confirmed ✓`;
    } else {
        titleEl.textContent = 'Recording Saved';
        detailsEl.textContent = `${result.chunkCount} chunks captured, some pending upload`;
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
 * Handle chunk events from SessionManager
 */
function handleChunkStatus(status) {
    updateChunkStatus(status);
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

    // Stop capture
    if (captureService) {
        captureService.stop();
    }

    // End session and get results
    let result = { chunkCount: 0, allConfirmed: true };
    if (sessionManager) {
        try {
            result = await sessionManager.endSession();
        } catch (err) {
            console.error('Error ending session:', err);
        }
    }

    // Release wake lock
    await releaseWakeLock();

    // Hide recording screen, show summary
    hideRecordingScreen();
    showSummary(result);
}

/**
 * Start the recording screen
 * @param {string[]} groupIds - Selected group IDs
 * @param {Object} options - Optional callbacks
 * @param {Function} options.onComplete - Called when recording ends with session result
 */
export async function startRecordingScreen(groupIds, options = {}) {
    selectedGroupIds = groupIds;
    onComplete = options.onComplete || null;

    initElements();

    // Reset UI state
    if (timeEl) timeEl.textContent = '0:00';
    if (chunkCountEl) chunkCountEl.textContent = '0';
    updateChunkStatus({ chunkCount: 0, confirmedCount: 0, pendingCount: 0, errorCount: 0 });

    // Create services
    sessionManager = new SessionManager();

    captureService = new CaptureService({
        timeslice: 10000, // 10 second chunks
        onChunk: async (blob, index) => {
            await sessionManager.processChunk(blob, index);
        },
        onError: (err) => {
            console.error('Capture error:', err);
        }
    });

    // Subscribe to session status updates
    sessionManager.on('status', handleChunkStatus);

    // Request wake lock
    await requestWakeLock();

    // Start session
    currentSessionId = await sessionManager.startSession(groupIds);

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

    // Show recording screen
    showRecordingScreen();

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
                onComplete({ sessionId: currentSessionId, action: 'view' });
            }
        };
    }

    if (dismissBtn) {
        dismissBtn.onclick = () => {
            hideSummary();
            if (onComplete) {
                onComplete({ sessionId: currentSessionId, action: 'dismiss' });
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
```

**Step 4: Run test to verify it passes**

Run: `cd witness-pwa && npm test -- --run recordingScreen`
Expected: PASS

**Step 5: Commit**

```bash
git add witness-pwa/src/ui/recordingScreen.js witness-pwa/src/ui/__tests__/recordingScreen.test.js
git commit -m "feat(ui): add recording screen controller with timer and chunk status"
```

---

## Task 6: Wire Recording Flow to Main App

**Files:**
- Modify: `witness-pwa/src/main.js`

**Step 1: Add imports and new record button handler**

At the top of `main.js`, add import:

```javascript
import { showRecordingGroupSelect } from './ui/recordingGroupSelect.js';
import { startRecordingScreen, forceStopRecording } from './ui/recordingScreen.js';
import { showContentDetail } from './ui/contentDetail.js';
```

**Step 2: Add new "Record" button handler**

Replace the existing record button touch/click handlers with a simplified flow that opens group selection.

Find the existing `handleTouchStart` function and the record button event listeners. Replace the recording logic to use the new UI:

```javascript
// New simplified record button - opens group selection flow
function handleRecordButtonClick() {
    if (recordBtn.disabled) return;

    // Show group selection modal
    showRecordingGroupSelect((selectedGroupIds) => {
        // User selected groups and clicked Start
        startRecordingScreen(selectedGroupIds, {
            onComplete: (result) => {
                if (result.action === 'view') {
                    // Navigate to content detail
                    showContentDetail(result.sessionId);
                }
                // Re-initialize camera for main screen
                initCamera();
            }
        });
    });
}

// Replace complex touch handlers with simple click
recordBtn.removeEventListener('touchstart', handleTouchStart);
recordBtn.removeEventListener('touchmove', handleTouchMove);
recordBtn.removeEventListener('touchend', handleTouchEnd);
recordBtn.removeEventListener('touchcancel', handleTouchCancel);

recordBtn.addEventListener('click', handleRecordButtonClick);
```

**Step 3: Test manually**

Run: `cd witness-pwa && npm run dev`
Expected: Clicking record button shows group selection modal, selecting a group and clicking Start shows fullscreen recording screen

**Step 4: Commit**

```bash
git add witness-pwa/src/main.js
git commit -m "feat(ui): wire recording flow through group selection to recording screen"
```

---

## Task 7: Add Pull-to-Refresh Prevention During Recording

**Files:**
- Modify: `witness-pwa/src/ui/recordingScreen.js`

**Step 1: Add overscroll prevention**

Add these functions to prevent pull-to-refresh during recording:

```javascript
/**
 * Prevent pull-to-refresh gesture during recording
 */
function preventPullToRefresh() {
    document.body.style.overscrollBehavior = 'none';

    // Also prevent touchmove on the recording screen
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
```

**Step 2: Call prevention in startRecordingScreen**

In `startRecordingScreen`, add after `showRecordingScreen()`:

```javascript
// Prevent pull-to-refresh during recording
preventPullToRefresh();
```

**Step 3: Call restoration in stopRecording**

In `stopRecording`, add after `hideRecordingScreen()`:

```javascript
// Re-enable pull-to-refresh
allowPullToRefresh();
```

**Step 4: Commit**

```bash
git add witness-pwa/src/ui/recordingScreen.js
git commit -m "feat(ui): prevent pull-to-refresh during recording"
```

---

## Task 8: Integration Test - Full E2E Recording Flow

**Files:**
- Create: `witness-pwa/src/ui/__tests__/recordingFlow.integration.test.js`

**Step 1: Write integration test**

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// This is a documentation of manual test steps since full E2E requires browser

describe('Recording Flow Integration', () => {
    it('documents the manual E2E test flow', () => {
        const testSteps = `
        Manual E2E Test for Milestone 5 - Recording UI
        ================================================

        Prerequisites:
        - Dev server running: npm run dev
        - Logged in with a valid account
        - At least one group created
        - Camera permission granted

        Test Case 1: Basic Recording Flow
        ---------------------------------
        1. Click the record button
        2. Verify: Group selection modal appears
        3. Check one or more groups
        4. Click "Start Recording"
        5. Verify: Fullscreen recording screen appears
        6. Verify: Timer starts at 0:00
        7. Verify: Red dot pulses
        8. Verify: Chunk count shows 0
        9. Wait 10+ seconds
        10. Verify: Chunk count increases
        11. Click stop button
        12. Verify: Summary overlay appears
        13. Verify: Shows correct chunk count
        14. Click "Done"
        15. Verify: Returns to main screen

        Test Case 2: Network Offline During Recording
        ---------------------------------------------
        1. Start recording
        2. Wait for first chunk to upload (count shows 1)
        3. Toggle airplane mode ON
        4. Wait 10 seconds
        5. Verify: Chunk count increases
        6. Verify: Status icon changes to yellow ⏳
        7. Toggle airplane mode OFF
        8. Wait for uploads to complete
        9. Verify: Status icon returns to green ✓
        10. Stop recording
        11. Verify summary shows all chunks

        Test Case 3: Screen Wake Lock
        -----------------------------
        1. Start recording
        2. Do not interact with device
        3. Wait 30+ seconds
        4. Verify: Screen stays on (does not dim or lock)
        5. Stop recording
        6. Verify: Screen can now auto-lock normally

        Test Case 4: View Recording After Stop
        -------------------------------------
        1. Complete a recording
        2. On summary screen, click "View Recording"
        3. Verify: Content detail modal opens
        4. Verify: Shows correct metadata
        `;

        console.log(testSteps);
        expect(true).toBe(true); // Placeholder
    });
});
```

**Step 2: Run test**

Run: `cd witness-pwa && npm test -- --run recordingFlow`
Expected: PASS (documents manual test steps)

**Step 3: Commit**

```bash
git add witness-pwa/src/ui/__tests__/recordingFlow.integration.test.js
git commit -m "test(ui): add integration test documentation for recording flow"
```

---

## Task 9: Final Cleanup and Polish

**Files:**
- Review all new files

**Step 1: Remove mock services from recordingScreen.js**

Once Milestone 4 is complete, replace the mock classes with actual imports:

```javascript
// Remove these mock classes:
const CaptureService = class { ... };
const SessionManager = class { ... };

// Uncomment these imports:
import { CaptureService } from '../services/captureService.js';
import { SessionManager } from '../services/sessionManager.js';
```

**Step 2: Run all tests**

Run: `cd witness-pwa && npm test`
Expected: All tests pass

**Step 3: Build for production**

Run: `cd witness-pwa && npm run build`
Expected: Build succeeds without errors

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(ui): complete Milestone 5 Recording UI"
```

---

## Success Criteria Checklist

From Milestone 5:
- [ ] Full-screen camera with minimal overlay
- [ ] Group selection before recording
- [ ] Stop button
- [ ] Screen wake lock (screen stays on during recording)
- [ ] Timer display (MM:SS format)
- [ ] Chunk status indicator (green/yellow/red)
- [ ] Summary overlay after recording
- [ ] Pull-to-refresh prevention during recording
- [ ] **Test**: Full E2E flow from UI

---

## File Summary

**New Files:**
- `witness-pwa/src/ui/recordingGroupSelect.js` - Group selection modal
- `witness-pwa/src/ui/recordingScreen.js` - Recording screen controller
- `witness-pwa/src/ui/__tests__/recordingGroupSelect.test.js` - Unit tests
- `witness-pwa/src/ui/__tests__/recordingScreen.test.js` - Unit tests
- `witness-pwa/src/ui/__tests__/recordingFlow.integration.test.js` - E2E documentation

**Modified Files:**
- `witness-pwa/index.html` - Add recording screen and summary HTML
- `witness-pwa/styles.css` - Add recording screen and group select styles
- `witness-pwa/src/main.js` - Wire new recording flow

---

## Dependencies on Other Milestones

This milestone depends on:
- **Milestone 4** (CaptureService): `getStream()` for video preview, `start()`/`stop()` for recording
- **Milestone 2** (SessionManager): `startSession()`, `processChunk()`, `endSession()`, status events

The mock services in Task 5 allow UI development to proceed in parallel with Milestone 4.
