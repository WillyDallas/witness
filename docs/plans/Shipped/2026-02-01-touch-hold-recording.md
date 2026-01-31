# Touch-Hold Recording with Swipe-to-Lock Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace click-based recording with touch-hold (press-and-hold to record, release to stop) plus swipe-up gesture to lock recording on.

**Architecture:** Implement touch event handlers on a unified record button that detects: (1) touch-and-hold to start recording, (2) release to stop, (3) upward swipe during hold to "lock" recording so it continues after release. Visual feedback shows lock affordance during hold.

**Tech Stack:** Vanilla JavaScript touch events (touchstart, touchmove, touchend), CSS transforms for visual feedback

---

## Task 1: Update HTML - Replace Dual Buttons with Single Record Button

**Files:**
- Modify: `witness-pwa/index.html:34-41`

**Step 1: Read the current button group structure**

Current code (lines 34-41):
```html
<div class="button-group">
    <button id="start-btn" class="btn btn-record" disabled>
        Start Recording
    </button>
    <button id="stop-btn" class="btn btn-stop hidden">
        Stop Recording
    </button>
</div>
```

**Step 2: Replace with single record button and lock indicator**

Replace lines 34-41 with:
```html
<div class="button-group">
    <div class="record-button-container">
        <button id="record-btn" class="btn btn-record" disabled>
            <span class="record-btn-icon"></span>
        </button>
        <div id="lock-indicator" class="lock-indicator hidden">
            <span class="lock-arrow">↑</span>
            <span class="lock-text">Slide to lock</span>
        </div>
    </div>
</div>
```

**Step 3: Commit**

```bash
git add witness-pwa/index.html
git commit -m "refactor: replace dual buttons with single record button"
```

---

## Task 2: Add CSS for New Record Button and Lock Indicator

**Files:**
- Modify: `witness-pwa/styles.css` (after line 171, before Recordings Section)

**Step 1: Add record button container styles**

Add after line 171 (after `.btn-stop:hover`):
```css
/* ============================================
   Record Button (Touch-Hold)
============================================ */

.record-button-container {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
}

#record-btn {
    width: 80px;
    height: 80px;
    min-width: 80px;
    min-height: 80px;
    padding: 0;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, background-color 0.2s;
}

#record-btn.recording {
    background-color: var(--text-light);
}

.record-btn-icon {
    width: 28px;
    height: 28px;
    background-color: var(--text-light);
    border-radius: 50%;
    transition: border-radius 0.15s ease, background-color 0.15s ease;
}

#record-btn.recording .record-btn-icon {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background-color: var(--red-accent);
}

#record-btn.holding {
    transform: scale(1.1);
}

/* Lock Indicator */
.lock-indicator {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 16px;
    margin-bottom: 12px;
    background-color: rgba(0, 0, 0, 0.8);
    border-radius: 12px;
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
}

.lock-indicator.visible {
    opacity: 1;
}

.lock-arrow {
    font-size: 20px;
    color: var(--text-light);
    animation: bounce-up 0.8s ease-in-out infinite;
}

.lock-text {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
    white-space: nowrap;
}

.lock-indicator.locked .lock-arrow {
    animation: none;
}

.lock-indicator.locked .lock-text::after {
    content: " ✓";
    color: #22c55e;
}

@keyframes bounce-up {
    0%, 100% {
        transform: translateY(0);
    }
    50% {
        transform: translateY(-6px);
    }
}
```

**Step 2: Commit**

```bash
git add witness-pwa/styles.css
git commit -m "style: add touch-hold record button and lock indicator styles"
```

---

## Task 3: Update JavaScript DOM References

**Files:**
- Modify: `witness-pwa/app.js:5-11`

**Step 1: Update DOM element references**

Replace lines 5-11:
```javascript
const preview = document.getElementById('preview');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusText = document.getElementById('status');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingsList = document.getElementById('recordings-list');
const noRecordingsMsg = document.getElementById('no-recordings');
```

With:
```javascript
const preview = document.getElementById('preview');
const recordBtn = document.getElementById('record-btn');
const lockIndicator = document.getElementById('lock-indicator');
const statusText = document.getElementById('status');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingsList = document.getElementById('recordings-list');
const noRecordingsMsg = document.getElementById('no-recordings');
```

**Step 2: Commit**

```bash
git add witness-pwa/app.js
git commit -m "refactor: update DOM references for new record button"
```

---

## Task 4: Add Touch State Variables

**Files:**
- Modify: `witness-pwa/app.js:13-17`

**Step 1: Add touch tracking state**

Replace lines 13-17:
```javascript
// State
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;
```

With:
```javascript
// State
let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = null;

// Touch state
let touchStartY = 0;
let isHolding = false;
let isLocked = false;
const LOCK_THRESHOLD = 50; // pixels to swipe up to lock
```

**Step 2: Commit**

```bash
git add witness-pwa/app.js
git commit -m "feat: add touch state variables for hold-to-record"
```

---

## Task 5: Update setRecordingUI Function

**Files:**
- Modify: `witness-pwa/app.js:148-160`

**Step 1: Update UI function for new button**

Replace lines 148-160:
```javascript
function setRecordingUI(isRecording) {
    if (isRecording) {
        hideElement(startBtn);
        showElement(stopBtn);
        showElement(recordingIndicator);
        updateStatus('Recording...');
    } else {
        showElement(startBtn);
        hideElement(stopBtn);
        hideElement(recordingIndicator);
        startBtn.disabled = false;
    }
}
```

With:
```javascript
function setRecordingUI(isRecording) {
    if (isRecording) {
        recordBtn.classList.add('recording');
        showElement(recordingIndicator);
        updateStatus(isLocked ? 'Recording (locked) - tap to stop' : 'Recording...');
    } else {
        recordBtn.classList.remove('recording', 'holding');
        hideElement(recordingIndicator);
        hideElement(lockIndicator);
        lockIndicator.classList.remove('visible', 'locked');
        recordBtn.disabled = false;
        isHolding = false;
        isLocked = false;
    }
}
```

**Step 2: Commit**

```bash
git add witness-pwa/app.js
git commit -m "refactor: update setRecordingUI for touch-hold button"
```

---

## Task 6: Implement Touch Event Handlers

**Files:**
- Modify: `witness-pwa/app.js:337-342`

**Step 1: Replace click listeners with touch handlers**

Replace lines 337-342:
```javascript
// ============================================
// Event Listeners
// ============================================

startBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);
```

With:
```javascript
// ============================================
// Event Listeners
// ============================================

// Touch event handlers for hold-to-record
function handleTouchStart(e) {
    if (recordBtn.disabled) return;
    e.preventDefault();

    const touch = e.touches[0];
    touchStartY = touch.clientY;
    isHolding = true;

    // If already recording (locked mode), stop on tap
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
        return;
    }

    // Visual feedback
    recordBtn.classList.add('holding');
    showElement(lockIndicator);
    lockIndicator.classList.add('visible');

    // Start recording
    startRecording();
}

function handleTouchMove(e) {
    if (!isHolding || isLocked) return;
    e.preventDefault();

    const touch = e.touches[0];
    const deltaY = touchStartY - touch.clientY;

    // Check if swiped up enough to lock
    if (deltaY > LOCK_THRESHOLD) {
        isLocked = true;
        lockIndicator.classList.add('locked');
        updateStatus('Recording locked - tap to stop');
    }
}

function handleTouchEnd(e) {
    if (!isHolding) return;
    e.preventDefault();

    isHolding = false;
    recordBtn.classList.remove('holding');

    // If locked, keep recording; otherwise stop
    if (!isLocked) {
        hideElement(lockIndicator);
        lockIndicator.classList.remove('visible');
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        }
    }
}

function handleTouchCancel(e) {
    // Treat cancel same as end
    handleTouchEnd(e);
}

// Attach touch listeners
recordBtn.addEventListener('touchstart', handleTouchStart, { passive: false });
recordBtn.addEventListener('touchmove', handleTouchMove, { passive: false });
recordBtn.addEventListener('touchend', handleTouchEnd, { passive: false });
recordBtn.addEventListener('touchcancel', handleTouchCancel, { passive: false });

// Fallback click handler for desktop/mouse
recordBtn.addEventListener('click', (e) => {
    // Only handle if not a touch event (touch events will handle themselves)
    if (e.pointerType === 'touch') return;

    if (recordBtn.disabled) return;

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
    } else {
        startRecording();
        // For desktop, auto-lock since there's no hold gesture
        isLocked = true;
        updateStatus('Recording - click to stop');
    }
});
```

**Step 2: Commit**

```bash
git add witness-pwa/app.js
git commit -m "feat: implement touch-hold recording with swipe-to-lock"
```

---

## Task 7: Update Camera Init to Enable New Button

**Files:**
- Modify: `witness-pwa/app.js:196`

**Step 1: Update button reference in initCamera**

Find line 196:
```javascript
        startBtn.disabled = false;
```

Replace with:
```javascript
        recordBtn.disabled = false;
```

**Step 2: Commit**

```bash
git add witness-pwa/app.js
git commit -m "fix: enable correct button after camera init"
```

---

## Task 8: Update Status Messages in startRecording

**Files:**
- Modify: `witness-pwa/app.js:220-224`

**Step 1: Update status message references**

Find lines 220-224:
```javascript
function startRecording() {
    if (!mediaStream) {
        updateStatus('Camera not ready');
        return;
    }
```

No change needed here - the status update is fine. But verify `setRecordingUI(true)` on line 252 still works correctly (it should since we updated that function in Task 5).

**Step 2: Verify no changes needed, move on**

---

## Task 9: Test on Mobile Device

**Files:**
- None (manual testing)

**Step 1: Deploy to test server**

Run:
```bash
# Bump service worker version in sw.js first
# Then deploy
rsync -avz witness-pwa/ root@46.62.231.168:/var/www/witness/
```

**Step 2: Test on iOS Safari**

Test cases:
1. Press and hold record button → recording starts
2. Release finger → recording stops
3. Press and hold, then swipe up → lock indicator shows checkmark
4. Release after locking → recording continues
5. Tap again when locked → recording stops
6. Desktop click behavior still works

**Step 3: Commit any fixes**

---

## Task 10: Update Service Worker Cache Version

**Files:**
- Modify: `witness-pwa/sw.js:4`

**Step 1: Bump cache version**

Find line 4 (the CACHE_NAME):
```javascript
const CACHE_NAME = 'witness-v4';
```

Replace with:
```javascript
const CACHE_NAME = 'witness-v5';
```

**Step 2: Commit**

```bash
git add witness-pwa/sw.js
git commit -m "chore: bump service worker cache version"
```

---

## Summary

This plan implements:
1. **Hold-to-record**: Touch and hold the button to start recording, release to stop
2. **Swipe-to-lock**: While holding, swipe up 50+ pixels to lock recording on
3. **Tap-to-stop**: When locked, tap the button to stop recording
4. **Desktop fallback**: Click works normally (auto-locks since no hold gesture)
5. **Visual feedback**: Button scales while holding, lock indicator shows swipe affordance

The interaction pattern matches common apps like Instagram Stories and Snapchat for intuitive use.
