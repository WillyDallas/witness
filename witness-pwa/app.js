// Witness Protocol - Main Application
'use strict';

// DOM Elements
const preview = document.getElementById('preview');
const recordBtn = document.getElementById('record-btn');
const lockIndicator = document.getElementById('lock-indicator');
const saveBtn = document.getElementById('save-btn');
const statusText = document.getElementById('status');
const recordingIndicator = document.getElementById('recording-indicator');
const recordingsList = document.getElementById('recordings-list');
const noRecordingsMsg = document.getElementById('no-recordings');
const drawerToggle = document.getElementById('drawer-toggle');
const recordingsDrawer = document.getElementById('recordings-drawer');
const drawerBackdrop = document.getElementById('drawer-backdrop');
const drawerHandle = document.getElementById('drawer-handle');

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

// Pending video for save
let pendingBlob = null;
let pendingFilename = null;

// Drawer state
let drawerOpen = false;

// Lock hint state (only show once ever)
const LOCK_HINT_KEY = 'witness_lock_hint_shown';

// Constants
const STORAGE_KEY = 'witness_recordings';

// ============================================
// Service Worker Registration
// ============================================

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service worker registered:', reg.scope))
        .catch(err => console.error('Service worker registration failed:', err));
}

// ============================================
// Utility Functions
// ============================================

function getSupportedMimeType() {
    // Prefer MP4 on iOS (required for Photos app compatibility)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    if (isIOS) {
        // iOS Safari supports mp4 with h264/aac
        const iosTypes = [
            'video/mp4;codecs=avc1,mp4a.40.2',
            'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
            'video/mp4',
        ];
        for (const type of iosTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }
    }

    // Desktop/Android: prefer webm for better quality/compression
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
    ];

    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    return 'video/webm';
}

function generateFilename(mimeType) {
    const now = new Date();
    const timestamp = now.toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);
    const ext = mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
    return `witness_${timestamp}.${ext}`;
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(isoString) {
    const date = new Date(isoString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ============================================
// localStorage Functions
// ============================================

function getRecordings() {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
}

function saveRecording(metadata) {
    const recordings = getRecordings();
    recordings.unshift(metadata); // Add to beginning
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recordings));
}

// ============================================
// UI Functions
// ============================================

function updateStatus(message) {
    statusText.textContent = message;
}

function showElement(element) {
    element.classList.remove('hidden');
}

function hideElement(element) {
    element.classList.add('hidden');
}

function renderRecordingsList() {
    const recordings = getRecordings();

    if (recordings.length === 0) {
        showElement(noRecordingsMsg);
        recordingsList.innerHTML = '';
        return;
    }

    hideElement(noRecordingsMsg);
    recordingsList.innerHTML = recordings.map(rec => `
        <li class="recording-item">
            <div class="recording-info">
                <span class="recording-filename">${rec.filename}</span>
                <span class="recording-meta">${formatDate(rec.timestamp)} · ${formatDuration(rec.duration)} · ${formatFileSize(rec.size)}</span>
            </div>
        </li>
    `).join('');
}

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

// ============================================
// Camera Functions
// ============================================

async function initCamera() {
    // Check for mediaDevices support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        updateStatus('Camera not supported in this browser');
        return false;
    }

    // Check for MediaRecorder support
    if (typeof MediaRecorder === 'undefined') {
        updateStatus('Recording not supported in this browser');
        return false;
    }

    try {
        updateStatus('Requesting camera access...');

        // Request camera with preferred settings
        mediaStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // Prefer back camera
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: true
        });

        // Connect stream to video preview
        preview.srcObject = mediaStream;

        updateStatus('Ready to record');
        recordBtn.disabled = false;
        return true;

    } catch (err) {
        console.error('Camera access error:', err);

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            updateStatus('Camera permission denied. Please allow camera access in your browser settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            updateStatus('No camera found on this device.');
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
            updateStatus('Camera is in use by another application.');
        } else {
            updateStatus('Could not access camera: ' + err.message);
        }

        return false;
    }
}

// ============================================
// Recording Functions
// ============================================

function startRecording() {
    if (!mediaStream) {
        updateStatus('Camera not ready');
        return;
    }

    recordedChunks = [];

    try {
        const mimeType = getSupportedMimeType();
        mediaRecorder = new MediaRecorder(mediaStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 2500000
        });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = handleRecordingStop;

        mediaRecorder.onerror = (event) => {
            console.error('MediaRecorder error:', event.error);
            updateStatus('Recording error: ' + event.error.message);
            setRecordingUI(false);
        };

        // Start recording with 1 second chunks
        recordingStartTime = Date.now();
        mediaRecorder.start(1000);
        setRecordingUI(true);

    } catch (err) {
        console.error('Failed to start recording:', err);
        updateStatus('Failed to start recording: ' + err.message);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        updateStatus('Processing recording...');
    }
}

async function handleRecordingStop() {
    const duration = (Date.now() - recordingStartTime) / 1000;
    const mimeType = mediaRecorder.mimeType;
    const blob = new Blob(recordedChunks, { type: mimeType });
    const filename = generateFilename(mimeType);

    // Save metadata to localStorage
    const metadata = {
        id: Date.now(),
        filename: filename,
        timestamp: new Date().toISOString(),
        duration: duration,
        size: blob.size
    };
    saveRecording(metadata);

    // Update UI
    renderRecordingsList();
    setRecordingUI(false);

    // Store blob for save button (iOS requires user gesture for share)
    pendingBlob = blob;
    pendingFilename = filename;

    // Show save button and prompt user
    showElement(saveBtn);
    hideElement(recordBtn);
    updateStatus('Tap "Save Video" to save to Photos');

    // Clear chunks
    recordedChunks = [];
}

async function shareOrDownload(blob, filename) {
    // Try Web Share API first (works on iOS for saving to Photos)
    if (navigator.canShare) {
        const file = new File([blob], filename, { type: blob.type });
        const shareData = { files: [file] };

        if (navigator.canShare(shareData)) {
            try {
                updateStatus('Tap "Save Video" to save to Photos...');
                await navigator.share(shareData);
                return true;
            } catch (err) {
                // User cancelled or share failed
                if (err.name === 'AbortError') {
                    updateStatus('Share cancelled');
                    return false;
                }
                console.error('Share failed, falling back to download:', err);
            }
        }
    }

    // Fallback to download for desktop browsers
    downloadBlob(blob, filename);
    return true;
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up the object URL after a short delay
    setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ============================================
// Event Listeners
// ============================================

// Track if touch event just fired (to prevent ghost clicks)
let touchHandled = false;

// Touch event handlers for hold-to-record
function handleTouchStart(e) {
    if (recordBtn.disabled) return;
    e.preventDefault();
    touchHandled = true;

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

    // Only show lock hint if never shown before
    if (!localStorage.getItem(LOCK_HINT_KEY)) {
        showElement(lockIndicator);
        lockIndicator.classList.add('visible');
    }

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

        // Mark hint as shown so it never appears again
        localStorage.setItem(LOCK_HINT_KEY, 'true');

        // Hide the indicator after a moment
        setTimeout(() => {
            hideElement(lockIndicator);
            lockIndicator.classList.remove('visible', 'locked');
        }, 800);
    }
}

function handleTouchEnd(e) {
    if (!isHolding) return;
    e.preventDefault();

    isHolding = false;
    recordBtn.classList.remove('holding');

    // If locked, keep recording; otherwise stop
    if (!isLocked) {
        // Mark hint as shown (they've seen it once)
        localStorage.setItem(LOCK_HINT_KEY, 'true');

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
    // Skip if touch event just handled this
    if (touchHandled) {
        touchHandled = false;
        return;
    }

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

// Save button handler (requires fresh user gesture for iOS share)
saveBtn.addEventListener('click', async () => {
    if (!pendingBlob || !pendingFilename) return;

    const saved = await shareOrDownload(pendingBlob, pendingFilename);

    // Reset state
    pendingBlob = null;
    pendingFilename = null;
    hideElement(saveBtn);
    showElement(recordBtn);

    if (saved) {
        updateStatus('Ready to record');
    }
});

// ============================================
// Drawer Functions
// ============================================

function openDrawer() {
    drawerOpen = true;
    recordingsDrawer.classList.add('open');
    drawerBackdrop.classList.add('visible');
}

function closeDrawer() {
    drawerOpen = false;
    recordingsDrawer.classList.remove('open');
    drawerBackdrop.classList.remove('visible');
}

// Drawer toggle button
drawerToggle.addEventListener('click', () => {
    if (drawerOpen) {
        closeDrawer();
    } else {
        openDrawer();
    }
});

// Close drawer when clicking backdrop or handle
drawerBackdrop.addEventListener('click', closeDrawer);
drawerHandle.addEventListener('click', closeDrawer);

// ============================================
// Initialization
// ============================================

async function init() {
    renderRecordingsList();
    await initCamera();
}

// Start the app
init();
