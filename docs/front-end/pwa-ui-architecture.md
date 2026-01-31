# Witness Protocol PWA - UI Architecture

## Overview

The Witness Protocol PWA provides a mobile-first video capture interface designed for evidence recording. The current implementation (Milestone 1) establishes the UI patterns and interaction model that will integrate with the full protocol stack in future milestones.

**Location:** `witness-pwa/`

**Key Files:**
- `app.js` - Application logic, state management, event handling
- `index.html` - DOM structure
- `styles.css` - Visual styling and animations
- `sw.js` - Service worker for offline capability

---

## UI Components

### 1. Video Preview (Fullscreen)

**Purpose:** Live camera feed occupying the entire viewport

**DOM Elements:**
```html
<div class="video-container">
    <video id="preview" autoplay muted playsinline></video>
</div>
```

**JavaScript Reference:** `preview` element connected to `mediaStream.srcObject`

**Architecture Connection Points:**
| Future Component | Integration |
|-----------------|-------------|
| **Capture Pipeline** | The `mediaStream` will feed into MediaRecorder with chunking (`timeslice` parameter) |
| **Metadata Collection** | GPS and device info will be captured per chunk from this stream |

---

### 2. Record Button (Touch-Hold)

**Purpose:** Primary recording control with gesture-based interaction

**DOM Elements:**
```html
<div class="record-button-container">
    <button id="record-btn" class="btn btn-record" disabled>
        <span class="record-btn-icon"></span>
    </button>
    <div id="lock-indicator" class="lock-indicator hidden">
        <span class="lock-arrow">↑</span>
        <span class="lock-text">Slide to lock</span>
    </div>
</div>
```

**JavaScript Reference:** `recordBtn`, `lockIndicator`

**Interaction Model:**
```
┌─────────────────────────────────────────────────────────────┐
│                    TOUCH-HOLD RECORDING                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Touch & Hold ──► Recording Starts                           │
│       │                                                      │
│       ├── Release ──► Recording Stops                        │
│       │                                                      │
│       └── Swipe Up (50px+) ──► Lock Mode                     │
│                                    │                         │
│                                    └── Tap Again ──► Stop    │
│                                                              │
│  Desktop: Click toggles recording (auto-locks)               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**State Variables:**
```javascript
let touchStartY = 0;        // Y position when touch began
let isHolding = false;      // Currently holding the button
let isLocked = false;       // Recording locked on
const LOCK_THRESHOLD = 50;  // Pixels to swipe for lock
```

**Architecture Connection Points:**
| Future Component | Integration |
|-----------------|-------------|
| **Capture Pipeline** | `startRecording()` will initialize chunked MediaRecorder with 10s `timeslice` |
| **Encryption** | Each chunk will be encrypted with AES-256-GCM session key before upload |
| **On-Chain Proof** | Merkle root will update after each chunk uploads |

---

### 3. Recording Indicator

**Purpose:** Visual feedback that recording is active

**DOM Elements:**
```html
<div id="recording-indicator" class="recording-indicator hidden">
    <span class="red-dot"></span>
    <span class="rec-text">REC</span>
</div>
```

**JavaScript Reference:** `recordingIndicator`

**Behavior:** Shows when recording, hidden otherwise. Red dot pulses via CSS animation.

**Architecture Connection Points:**
| Future Component | Integration |
|-----------------|-------------|
| **On-Chain Proof** | Could show chunk upload progress / merkle root update status |
| **Storage** | Could indicate IPFS upload status per chunk |

---

### 4. Save Button

**Purpose:** Trigger share/download after recording completes (required for iOS)

**DOM Elements:**
```html
<button id="save-btn" class="btn btn-save hidden">
    Save Video
</button>
```

**JavaScript Reference:** `saveBtn`, `pendingBlob`, `pendingFilename`

**Why This Exists:**
iOS Safari requires `navigator.share()` to be called within a direct user gesture. Since `MediaRecorder.onstop` is asynchronous, we store the blob and let the user tap to trigger the share.

**State Variables:**
```javascript
let pendingBlob = null;      // Recorded video blob awaiting save
let pendingFilename = null;  // Generated filename for the recording
```

**Architecture Connection Points:**
| Future Component | Integration |
|-----------------|-------------|
| **Storage** | In future, this button may be replaced by automatic IPFS upload |
| **Playback** | May transition to a "View Recording" action instead of save |

---

### 5. Status Text

**Purpose:** User feedback and instructions

**DOM Element:**
```html
<p id="status" class="status-text">Initializing camera...</p>
```

**JavaScript Reference:** `statusText`, updated via `updateStatus(message)`

**Status Messages:**
| State | Message |
|-------|---------|
| Initializing | "Initializing camera..." |
| Ready | "Ready to record" |
| Recording (hold) | "Recording..." |
| Recording (locked) | "Recording (locked) - tap to stop" |
| Recording (desktop) | "Recording - click to stop" |
| Processing | "Processing recording..." |
| After recording | "Tap 'Save Video' to save to Photos" |
| Locked confirmed | "Recording locked - tap to stop" |

**Architecture Connection Points:**
| Future Component | Integration |
|-----------------|-------------|
| **Storage** | "Uploading chunk 3/10..." |
| **On-Chain Proof** | "Merkle root updated on-chain" |
| **Encryption** | "Encrypting..." |

---

### 6. Recordings Drawer

**Purpose:** View history of recorded sessions

**DOM Elements:**
```html
<button id="drawer-toggle" class="drawer-toggle">
    <span class="drawer-toggle-line"></span>
    <span class="drawer-toggle-text">Recordings</span>
</button>

<div id="drawer-backdrop" class="drawer-backdrop"></div>

<div id="recordings-drawer" class="recordings-drawer">
    <div class="drawer-handle" id="drawer-handle">
        <span class="drawer-handle-bar"></span>
    </div>
    <div class="drawer-content">
        <h2>Recordings</h2>
        <ul id="recordings-list" class="recordings-list"></ul>
        <p id="no-recordings" class="no-recordings">No recordings yet</p>
    </div>
</div>
```

**JavaScript References:** `drawerToggle`, `recordingsDrawer`, `drawerBackdrop`, `drawerHandle`, `recordingsList`, `noRecordingsMsg`

**State Variables:**
```javascript
let drawerOpen = false;
const STORAGE_KEY = 'witness_recordings';  // localStorage key for metadata
```

**Data Model (localStorage):**
```javascript
{
    id: Date.now(),           // Unique identifier
    filename: string,         // e.g., "witness_2026-02-01_14-30-00.mp4"
    timestamp: ISO string,    // When recorded
    duration: number,         // Seconds
    size: number              // Bytes
}
```

**Architecture Connection Points:**
| Future Component | Integration |
|-----------------|-------------|
| **Storage** | Will display IPFS CID instead of local filename |
| **On-Chain Proof** | Will show merkle root / verification status |
| **Attestation** | Will show vouch count ("3 attestations") |
| **Playback** | Tapping a recording will fetch from IPFS and decrypt |

---

## Event Flow Diagrams

### Recording Flow (Current)

```
┌──────────────────────────────────────────────────────────────────────┐
│                        CURRENT RECORDING FLOW                         │
└──────────────────────────────────────────────────────────────────────┘

    User Touch
        │
        ▼
┌───────────────┐     ┌──────────────────┐     ┌───────────────────┐
│ handleTouch   │────►│ startRecording() │────►│ MediaRecorder     │
│ Start()       │     │                  │     │ .start(1000)      │
└───────────────┘     └──────────────────┘     └───────────────────┘
        │                                              │
        │                                              │ ondataavailable
        ▼                                              ▼
┌───────────────┐                              ┌───────────────────┐
│ setRecordingUI│                              │ recordedChunks[]  │
│ (true)        │                              │ .push(data)       │
└───────────────┘                              └───────────────────┘
        │
        │ User releases (or taps if locked)
        ▼
┌───────────────┐     ┌──────────────────┐     ┌───────────────────┐
│ handleTouch   │────►│ stopRecording()  │────►│ MediaRecorder     │
│ End()         │     │                  │     │ .stop()           │
└───────────────┘     └──────────────────┘     └───────────────────┘
                                                       │
                                                       │ onstop
                                                       ▼
                      ┌──────────────────┐     ┌───────────────────┐
                      │ handleRecording  │◄────│ Create Blob       │
                      │ Stop()           │     │ from chunks       │
                      └──────────────────┘     └───────────────────┘
                              │
                              ▼
                      ┌──────────────────┐
                      │ Save metadata to │
                      │ localStorage     │
                      └──────────────────┘
                              │
                              ▼
                      ┌──────────────────┐
                      │ Show Save button │
                      │ (pendingBlob)    │
                      └──────────────────┘
                              │
                              │ User taps Save
                              ▼
                      ┌──────────────────┐
                      │ navigator.share()│
                      │ or download      │
                      └──────────────────┘
```

### Recording Flow (Future with Protocol Integration)

```
┌──────────────────────────────────────────────────────────────────────┐
│                      FUTURE RECORDING FLOW                            │
└──────────────────────────────────────────────────────────────────────┘

    User Touch
        │
        ▼
┌───────────────┐     ┌──────────────────┐     ┌───────────────────┐
│ handleTouch   │────►│ startRecording() │────►│ MediaRecorder     │
│ Start()       │     │                  │     │ .start(10000)     │
└───────────────┘     └──────────────────┘     └─────────┬─────────┘
                                                         │
                              ┌───────────────────────────┘
                              │ Every 10 seconds (ondataavailable)
                              ▼
                      ┌──────────────────┐
                      │ Capture Chunk    │
                      │ + GPS + Timestamp│
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Hash chunk       │
                      │ (SHA-256)        │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Update Merkle    │
                      │ tree             │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Encrypt chunk    │
                      │ (AES-256-GCM)    │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐     ┌───────────────────┐
                      │ Upload to IPFS   │────►│ Get CID           │
                      │ (Pinata)         │     │                   │
                      └────────┬─────────┘     └───────────────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Update merkle    │
                      │ root on-chain    │
                      └──────────────────┘
                               │
                               │ (repeat for each chunk)
                               │
                               │ User stops recording
                               ▼
                      ┌──────────────────┐
                      │ Upload manifest  │
                      │ to IPFS          │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ Final on-chain   │
                      │ registration     │
                      └──────────────────┘
```

---

## State Management

### Global State Variables

```javascript
// Core recording state
let mediaStream = null;        // Camera/mic stream
let mediaRecorder = null;      // MediaRecorder instance
let recordedChunks = [];       // Array of Blob chunks
let recordingStartTime = null; // For duration calculation

// Touch interaction state
let touchStartY = 0;           // Starting Y for swipe detection
let isHolding = false;         // Button currently held
let isLocked = false;          // Recording locked on
let touchHandled = false;      // Prevent ghost clicks

// Save flow state (iOS workaround)
let pendingBlob = null;        // Blob awaiting save
let pendingFilename = null;    // Filename for pending blob

// UI state
let drawerOpen = false;        // Recordings drawer visibility

// One-time hints
const LOCK_HINT_KEY = 'witness_lock_hint_shown';
let lockHintTimeout = null;    // Auto-hide timer for lock hint
```

### Future State Additions

```javascript
// Identity (Privy integration)
let wallet = null;             // Embedded wallet
let sessionKey = null;         // Derived encryption key

// Capture pipeline
let merkleTree = null;         // Running merkle tree for chunks
let chunkIndex = 0;            // Current chunk number
let sessionId = null;          // Unique recording session ID

// Storage
let uploadedCids = [];         // IPFS CIDs for uploaded chunks
let manifestCid = null;        // Final manifest CID

// Network state
let isOnline = navigator.onLine;
let pendingUploads = [];       // Chunks waiting for network
```

---

## Key Integration Points

### 1. Capture Pipeline Integration

**Current:** `MediaRecorder.start(1000)` - 1 second chunks for smooth `ondataavailable`

**Future:** `MediaRecorder.start(10000)` - 10 second chunks per architecture spec

**Code Location:** `startRecording()` in [app.js:244-282](witness-pwa/app.js#L244-L282)

```javascript
// Current
mediaRecorder.start(1000);

// Future
mediaRecorder.start(10000);  // 10-second chunks

mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
        const chunk = event.data;

        // Collect metadata
        const metadata = await collectChunkMetadata();

        // Hash before encryption
        const hash = await hashChunk(chunk);

        // Update merkle tree
        merkleTree.addLeaf(hash);

        // Encrypt
        const encrypted = await encryptChunk(chunk, sessionKey);

        // Upload to IPFS
        const cid = await uploadToIPFS(encrypted);
        uploadedCids.push({ cid, hash, metadata });

        // Update on-chain (if online)
        if (isOnline) {
            await updateMerkleRoot(sessionId, merkleTree.root);
        }
    }
};
```

### 2. Encryption Integration

**Connection Point:** After chunk capture, before IPFS upload

**Key Derivation:** From Privy wallet signature

```javascript
// Future addition to app.js
async function deriveSessionKey(wallet) {
    // Sign a deterministic message to derive key material
    const message = `witness-session-${Date.now()}`;
    const signature = await wallet.signMessage(message);

    // Derive AES key from signature
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(signature),
        'PBKDF2',
        false,
        ['deriveBits', 'deriveKey']
    );

    return await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: new Uint8Array(16), iterations: 100000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

async function encryptChunk(chunk, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        await chunk.arrayBuffer()
    );
    return { iv, data: encrypted };
}
```

### 3. Storage Integration

**Connection Point:** Replace local Blob storage with IPFS upload

**Code Location:** `handleRecordingStop()` in [app.js:291-322](witness-pwa/app.js#L291-L322)

```javascript
// Future modification to handleRecordingStop
async function handleRecordingStop() {
    // Create manifest
    const manifest = {
        sessionId,
        chunks: uploadedCids,
        merkleRoot: merkleTree.root,
        timestamp: new Date().toISOString(),
        duration: (Date.now() - recordingStartTime) / 1000
    };

    // Upload manifest
    const manifestCid = await uploadToIPFS(JSON.stringify(manifest));

    // Register on-chain
    await registryContract.registerEvidence(merkleTree.root, manifestCid);

    // Update local storage with CID reference
    saveRecording({
        id: sessionId,
        manifestCid,
        merkleRoot: merkleTree.root,
        ...manifest
    });
}
```

### 4. On-Chain Proof Integration

**Connection Point:** After each chunk upload, update merkle root

**Contract Interface:**
```solidity
function registerEvidence(bytes32 merkleRoot, string manifestCid) external;
function updateMerkleRoot(bytes32 sessionId, bytes32 newRoot) external;
```

```javascript
// Future addition
async function updateMerkleRoot(sessionId, newRoot) {
    const tx = await registryContract.updateMerkleRoot(sessionId, newRoot);
    await tx.wait();
    updateStatus(`Chunk ${chunkIndex} verified on-chain`);
}
```

### 5. Playback Integration

**Connection Point:** Recordings drawer item tap → fetch from IPFS → decrypt → play

**Code Location:** `renderRecordingsList()` in [app.js:150-168](witness-pwa/app.js#L150-L168)

```javascript
// Future: Add click handler to recording items
recordingsList.addEventListener('click', async (e) => {
    const item = e.target.closest('.recording-item');
    if (!item) return;

    const manifestCid = item.dataset.manifestCid;

    // Fetch manifest from IPFS
    const manifest = await fetchFromIPFS(manifestCid);

    // Fetch and decrypt chunks
    const decryptedChunks = await Promise.all(
        manifest.chunks.map(async ({ cid }) => {
            const encrypted = await fetchFromIPFS(cid);
            return decryptChunk(encrypted, sessionKey);
        })
    );

    // Create playable blob
    const blob = new Blob(decryptedChunks, { type: 'video/mp4' });

    // Play in modal or new view
    openPlaybackModal(blob, manifest);
});
```

### 6. Trusted Contact Sync Integration

**Connection Point:** New UI element for QR code generation/scanning

**Future Addition:**
```html
<!-- Add to controls or as modal -->
<button id="share-access-btn" class="btn">Share Access</button>

<!-- QR Modal -->
<div id="qr-modal" class="modal hidden">
    <canvas id="qr-canvas"></canvas>
    <p>Scan to become a trusted contact</p>
</div>
```

```javascript
// QR contains: { publicKey, encryptedSessionKey }
async function generateTrustedContactQR() {
    const payload = {
        witnessPublicKey: wallet.publicKey,
        // Session key wrapped for the contact to decrypt with their key
        // (requires key exchange protocol)
    };

    // Generate QR code
    QRCode.toCanvas(qrCanvas, JSON.stringify(payload));
    showElement(qrModal);
}
```

---

## CSS Architecture

### Layout Strategy

```
┌─────────────────────────────────────────┐
│           .app-container                │
│  ┌───────────────────────────────────┐  │
│  │       .video-container            │  │
│  │  (position: absolute, fullscreen) │  │
│  │                                   │  │
│  │     #preview (video element)      │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  #recording-indicator       │  │  │
│  │  │  (top-left overlay)         │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │          .controls                │  │
│  │  (position: absolute, bottom)     │  │
│  │  (gradient background)            │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  #status (status text)      │  │  │
│  │  └─────────────────────────────┘  │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  .button-group              │  │  │
│  │  │  (record btn + save btn)    │  │  │
│  │  └─────────────────────────────┘  │  │
│  │                                   │  │
│  │  ┌─────────────────────────────┐  │  │
│  │  │  #drawer-toggle             │  │  │
│  │  └─────────────────────────────┘  │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  #drawer-backdrop (z-index: 50)   │  │
│  └───────────────────────────────────┘  │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │  #recordings-drawer (z-index:100) │  │
│  │  (slide up from bottom)           │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

### Key CSS Patterns

**Safe Area Handling (notch/home indicator):**
```css
.app-container {
    padding-top: env(safe-area-inset-top);
    padding-left: env(safe-area-inset-left);
    padding-right: env(safe-area-inset-right);
}

.controls {
    padding-bottom: calc(16px + env(safe-area-inset-bottom));
}
```

**Slide-Up Drawer Animation:**
```css
.recordings-drawer {
    transform: translateY(100%);
    transition: transform 0.3s ease-out;
}

.recordings-drawer.open {
    transform: translateY(0);
}
```

**Record Button States:**
```css
#record-btn.holding { transform: scale(1.1); }
#record-btn.recording { background-color: var(--text-light); }
#record-btn.recording .record-btn-icon {
    border-radius: 4px;  /* Circle → Square */
    background-color: var(--red-accent);
}
```

---

## Service Worker Strategy

**Current Implementation:** Cache-first for app shell

```javascript
const CACHE_NAME = 'witness-v9';
const ASSETS = [
    '/', '/index.html', '/app.js', '/styles.css',
    '/manifest.json', '/icons/icon-192.svg', '/icons/icon-512.svg'
];
```

**Future Considerations:**
- Network-first for API calls to IPFS gateways
- Background sync for offline chunk uploads
- Push notifications for trusted contact alerts

---

## Browser Compatibility Notes

### iOS Safari Specifics

| Feature | Limitation | Workaround |
|---------|-----------|------------|
| Web Share API | Requires direct user gesture | Save button with `pendingBlob` |
| MediaRecorder | Only `video/mp4` supported | MIME type detection in `getSupportedMimeType()` |
| PWA Updates | Must delete/re-add home screen app | Cache versioning + `no-cache` header on `sw.js` |
| Touch Events | Ghost clicks ~300ms after touch | `touchHandled` flag |

### Desktop Fallback

Click-based recording auto-locks since hold gesture isn't available with mouse.

---

## Testing Checklist

### Touch-Hold Recording
- [ ] Press and hold → recording starts
- [ ] Release → recording stops
- [ ] Swipe up while holding → locks recording
- [ ] Tap when locked → stops recording
- [ ] Lock hint appears only on first use
- [ ] Lock hint auto-hides after 2 seconds

### Save Flow
- [ ] Save button appears after recording
- [ ] Tapping save triggers share sheet (iOS) or download (desktop)
- [ ] After save, record button reappears

### Drawer
- [ ] Toggle button opens drawer
- [ ] Backdrop click closes drawer
- [ ] Handle click closes drawer
- [ ] Recordings list displays metadata

### Service Worker
- [ ] App works offline after first load
- [ ] Cache version bump triggers update
