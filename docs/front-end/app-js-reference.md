# app.js Function Reference

Quick reference for all functions and event handlers in the PWA application.

---

## Utility Functions

### `getSupportedMimeType()`
**Lines:** 58-90
**Purpose:** Detect best video format for device
**Returns:** MIME type string (e.g., `'video/mp4'` on iOS, `'video/webm;codecs=vp9,opus'` on desktop)
**Future Integration:** No changes needed - format detection remains device-specific

### `generateFilename(mimeType)`
**Lines:** 92-100
**Purpose:** Create timestamped filename for recordings
**Returns:** String like `witness_2026-02-01_14-30-00.mp4`
**Future Integration:** May include session ID or merkle root hash

### `formatDuration(seconds)`
**Lines:** 102-106
**Purpose:** Convert seconds to `M:SS` format
**Returns:** String like `1:30`

### `formatFileSize(bytes)`
**Lines:** 108-112
**Purpose:** Human-readable file size
**Returns:** String like `2.5 MB`

### `formatDate(isoString)`
**Lines:** 114-117
**Purpose:** Format ISO date for display
**Returns:** String like `2/1/2026 2:30 PM`

---

## Storage Functions

### `getRecordings()`
**Lines:** 123-126
**Purpose:** Retrieve recording metadata from localStorage
**Returns:** Array of recording metadata objects
**Future Integration:** Will query local index that references IPFS CIDs

### `saveRecording(metadata)`
**Lines:** 128-132
**Purpose:** Persist recording metadata to localStorage
**Params:** `metadata` object with `{id, filename, timestamp, duration, size}`
**Future Integration:** Will include `manifestCid`, `merkleRoot`, `attestationCount`

---

## UI Functions

### `updateStatus(message)`
**Lines:** 138-140
**Purpose:** Update status text display
**Params:** `message` - string to display

### `showElement(element)` / `hideElement(element)`
**Lines:** 142-148
**Purpose:** Toggle `.hidden` class
**Params:** DOM element reference

### `renderRecordingsList()`
**Lines:** 150-168
**Purpose:** Render recordings in drawer from localStorage
**Future Integration:** Add click handlers for playback, show attestation counts

### `setRecordingUI(isRecording)`
**Lines:** 170-184
**Purpose:** Toggle all recording-related UI states
**Params:** `isRecording` - boolean
**Side Effects:**
- Toggles `.recording` class on button
- Shows/hides recording indicator
- Shows/hides lock indicator
- Resets `isHolding` and `isLocked` flags

---

## Camera Functions

### `initCamera()`
**Lines:** 190-238
**Purpose:** Request camera/mic access and connect to preview
**Returns:** `true` on success, `false` on failure
**Side Effects:**
- Sets `mediaStream`
- Connects stream to `preview.srcObject`
- Enables record button
- Updates status with error messages on failure

**Error Handling:**
| Error Name | User Message |
|-----------|--------------|
| NotAllowedError | "Camera permission denied..." |
| NotFoundError | "No camera found on this device." |
| NotReadableError | "Camera is in use by another application." |
| Other | "Could not access camera: [message]" |

---

## Recording Functions

### `startRecording()`
**Lines:** 244-282
**Purpose:** Initialize MediaRecorder and begin capture
**Side Effects:**
- Creates new `MediaRecorder` with best MIME type
- Sets `recordingStartTime`
- Calls `setRecordingUI(true)`
- Registers `ondataavailable`, `onstop`, `onerror` handlers

**Future Integration Point:**
```javascript
// Change from 1000ms to 10000ms chunks
mediaRecorder.start(10000);

// Enhanced ondataavailable for chunked upload
mediaRecorder.ondataavailable = async (event) => {
    // Hash → Encrypt → Upload → Update merkle
};
```

### `stopRecording()`
**Lines:** 284-289
**Purpose:** Stop the MediaRecorder
**Side Effects:** Triggers `onstop` event → `handleRecordingStop()`

### `handleRecordingStop()`
**Lines:** 291-322
**Purpose:** Process completed recording
**Side Effects:**
- Creates Blob from chunks
- Generates filename
- Saves metadata to localStorage
- Stores blob in `pendingBlob` for save button
- Shows save button, hides record button

**Future Integration Point:**
```javascript
// Instead of local blob storage:
// 1. Upload manifest to IPFS
// 2. Register on-chain
// 3. Store CID reference locally
```

### `shareOrDownload(blob, filename)`
**Lines:** 324-349
**Purpose:** Trigger native share (iOS) or download (desktop)
**Returns:** `true` on success, `false` on cancel
**Params:** `blob` - video Blob, `filename` - suggested name

### `downloadBlob(blob, filename)`
**Lines:** 351-362
**Purpose:** Fallback download via anchor click
**Side Effects:** Creates temporary `<a>` element, triggers click, cleans up

---

## Touch Event Handlers

### `handleTouchStart(e)`
**Lines:** 372-405
**Purpose:** Handle finger down on record button
**Side Effects:**
- Sets `touchHandled = true` (prevents ghost click)
- Records `touchStartY` for swipe detection
- Sets `isHolding = true`
- If already recording: stops (tap-to-stop in locked mode)
- Otherwise: shows lock hint (if first time), starts recording

### `handleTouchMove(e)`
**Lines:** 407-436
**Purpose:** Detect swipe-up gesture for lock
**Side Effects:**
- Calculates vertical delta from `touchStartY`
- If delta > `LOCK_THRESHOLD` (50px): sets `isLocked = true`
- Clears auto-hide timeout
- Shows "locked" confirmation, then hides indicator

### `handleTouchEnd(e)`
**Lines:** 438-462
**Purpose:** Handle finger release
**Side Effects:**
- Sets `isHolding = false`
- Removes `.holding` class
- Clears auto-hide timeout
- If not locked: stops recording, hides lock indicator
- If locked: recording continues

### `handleTouchCancel(e)`
**Lines:** 464-467
**Purpose:** Handle interrupted touch (e.g., notification)
**Side Effects:** Delegates to `handleTouchEnd()`

---

## Click Handlers

### Record Button Click (anonymous)
**Lines:** 476-493
**Purpose:** Desktop fallback for recording control
**Logic:**
```javascript
if (touchHandled) return;  // Prevent ghost click
if (recording) stop();
else {
    start();
    isLocked = true;  // Auto-lock for desktop
}
```

### Save Button Click (anonymous)
**Lines:** 496-510
**Purpose:** Trigger share/download for pending recording
**Side Effects:**
- Calls `shareOrDownload()` with `pendingBlob`
- Clears `pendingBlob` and `pendingFilename`
- Hides save button, shows record button

---

## Drawer Functions

### `openDrawer()`
**Lines:** 516-520
**Purpose:** Show recordings drawer
**Side Effects:**
- Sets `drawerOpen = true`
- Adds `.open` class to drawer
- Adds `.visible` class to backdrop

### `closeDrawer()`
**Lines:** 522-527
**Purpose:** Hide recordings drawer
**Side Effects:**
- Sets `drawerOpen = false`
- Removes `.open` and `.visible` classes

### Drawer Toggle Click (anonymous)
**Lines:** 529-535
**Purpose:** Toggle drawer open/close state

### Backdrop/Handle Click Listeners
**Lines:** 538-539
**Purpose:** Close drawer when clicking outside or on handle

---

## Initialization

### `init()`
**Lines:** 545-548
**Purpose:** Application entry point
**Side Effects:**
- Calls `renderRecordingsList()`
- Calls `initCamera()`

**Future Integration:**
```javascript
async function init() {
    // Initialize Privy
    await initPrivy();

    // Derive encryption key from wallet
    sessionKey = await deriveSessionKey(wallet);

    // Render existing recordings
    renderRecordingsList();

    // Initialize camera
    await initCamera();

    // Set up chain event listeners
    await subscribeToContractEvents();
}
```

---

## State Variables Quick Reference

| Variable | Type | Purpose |
|----------|------|---------|
| `mediaStream` | MediaStream | Camera/mic stream |
| `mediaRecorder` | MediaRecorder | Recording instance |
| `recordedChunks` | Blob[] | Accumulated video data |
| `recordingStartTime` | number | Timestamp for duration calc |
| `touchStartY` | number | Y position for swipe detection |
| `isHolding` | boolean | Button currently pressed |
| `isLocked` | boolean | Recording locked on |
| `touchHandled` | boolean | Prevent ghost clicks |
| `pendingBlob` | Blob | Video awaiting save |
| `pendingFilename` | string | Name for pending video |
| `drawerOpen` | boolean | Drawer visibility state |
| `lockHintTimeout` | number | Timer ID for auto-hide |

---

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `LOCK_THRESHOLD` | 50 | Pixels to swipe up for lock |
| `STORAGE_KEY` | `'witness_recordings'` | localStorage key |
| `LOCK_HINT_KEY` | `'witness_lock_hint_shown'` | One-time hint flag |
