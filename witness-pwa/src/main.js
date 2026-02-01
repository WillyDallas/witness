/**
 * Witness Protocol PWA - Main Application
 *
 * This module handles video capture with touch-hold recording.
 * Authentication and encryption are handled by the auth modules.
 */

// Polyfill Node.js Buffer for browser (required by Privy SDK)
import { Buffer } from 'buffer';
globalThis.Buffer = Buffer;

import { initLoginModal, showLoginModal } from './ui/loginModal.js';
import { showEncryptionTest } from './ui/encryptionTest.js';
import { showGroupsModal } from './ui/groupsModal.js';
import { showUploadModal } from './ui/uploadModal.js';
import { showContentBrowser } from './ui/contentBrowser.js';
import { showRecoveryDialog } from './ui/recoveryDialog.js';
import { showStorageWarning } from './ui/storageWarning.js';
import { showRecordingGroupSelect } from './ui/recordingGroupSelect.js';
import { startRecordingScreen, forceStopRecording } from './ui/recordingScreen.js';
import { initRecovery } from './lib/streaming/RecoveryService.js';
import { isReady, subscribeToAuth, clearAuthState, getAuthState } from './lib/authState.js';
import { logout } from './lib/privy.js';
import { createRegistrationStatus } from './components/RegistrationStatus.js';
import { requestGPSPermission } from './lib/permissions.js';
import { hasDefaultGroups, getDefaultGroupIds } from './lib/settingsStorage.js';
import { showSettingsModal } from './ui/settingsModal.js';

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
const logoutBtn = document.getElementById('logout-btn');
const encryptionTestBtn = document.getElementById('encryption-test-btn');
const registrationContainer = document.getElementById('registration-container');

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

// Registration component
let registrationStatusComponent = null;

// Lock hint state (only show once ever)
const LOCK_HINT_KEY = 'witness_lock_hint_shown';
let lockHintTimeout = null;

// Constants
const STORAGE_KEY = 'witness_recordings';

// Note: Service worker is registered by vite-plugin-pwa

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

        // Request camera/mic AND GPS in parallel (GPS is optional/non-blocking)
        const [stream] = await Promise.all([
            navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment', // Prefer back camera
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: true
            }),
            requestGPSPermission()  // Non-blocking - resolves to true/false
        ]);

        mediaStream = stream;

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

// Record button - uses persistent default groups for instant recording
function handleRecordButtonClick() {
    if (recordBtn.disabled) return;

    // Check if user has default groups configured
    if (!hasDefaultGroups()) {
        // No defaults - prompt to configure in Settings
        showSettingsModal();
        return;
    }

    // Start recording immediately with default groups
    startRecordingScreen(getDefaultGroupIds(), {
        onComplete: (result) => {
            if (result.action === 'view') {
                // Navigate to content detail
                showContentBrowser(result.sessionId);
            }
            // Re-initialize camera for main screen
            initCamera();
        }
    });
}

// Simple click handler for record button
recordBtn.addEventListener('click', handleRecordButtonClick);

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

// Groups button handler
const groupsBtn = document.getElementById('groups-btn');
if (groupsBtn) {
    groupsBtn.addEventListener('click', () => {
        closeDrawer();
        showGroupsModal();
    });
}

// Upload button handler
const uploadBtnDrawer = document.getElementById('upload-btn-drawer');
if (uploadBtnDrawer) {
    uploadBtnDrawer.addEventListener('click', () => {
        closeDrawer();
        showUploadModal();
    });
}

// Evidence browser button handler
const evidenceBtn = document.getElementById('evidence-btn');
if (evidenceBtn) {
    evidenceBtn.addEventListener('click', () => {
        closeDrawer();
        showContentBrowser();
    });
}

// Encryption test button handler
encryptionTestBtn.addEventListener('click', () => {
    closeDrawer();
    showEncryptionTest();
});

// Settings button handler
const settingsBtn = document.getElementById('settings-btn');
if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
        closeDrawer();
        showSettingsModal();
    });
}

// Logout button handler
logoutBtn.addEventListener('click', async () => {
    // Stop any active streaming recording
    await forceStopRecording();

    // Stop any legacy recording
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
    }

    // Stop camera
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
        preview.srcObject = null;
    }

    // Clear auth state and logout from Privy
    await logout();
    clearAuthState();

    // Show login modal
    showLoginModal();

    // Close drawer
    closeDrawer();
});

// ============================================
// Initialization
// ============================================

async function init() {
    // Initialize login modal and check session
    const authenticated = await initLoginModal();

    // Check for incomplete recording sessions (crash recovery)
    if (authenticated) {
        try {
            const recovery = await initRecovery();
            console.log('[main] Recovery check:', recovery);

            if (recovery.needsRecovery) {
                // Show recovery dialog - user must choose to resume or discard
                // Note: uploadQueue would be passed here when streaming is active
                await showRecoveryDialog(recovery.recoverySummary, null, () => {
                    console.log('[main] Recovery complete');
                });
            }

            // Warn if storage is getting low
            if (recovery.storageStatus.isLow) {
                showStorageWarning(recovery.storageStatus);
            }
        } catch (err) {
            console.error('[main] Recovery check failed:', err);
            // Continue anyway - don't block app startup
        }
    }

    // Subscribe to auth state changes
    subscribeToAuth((state) => {
        if (state.authenticated && state.encryptionKey) {
            // User just completed authentication
            // Enable camera if not already initialized
            if (!mediaStream) {
                initCamera();
            }

            // Mount registration status component if not already mounted
            if (!registrationStatusComponent && state.smartAccountAddress) {
                registrationStatusComponent = createRegistrationStatus(
                    registrationContainer,
                    state.smartAccountAddress
                );
            }
        }
    });

    // Only initialize camera if already authenticated
    if (authenticated) {
        renderRecordingsList();
        await initCamera();

        // Mount registration component if session was restored
        const state = getAuthState();
        if (state.smartAccountAddress && !registrationStatusComponent) {
            registrationStatusComponent = createRegistrationStatus(
                registrationContainer,
                state.smartAccountAddress
            );
        }
    } else {
        // Camera will be initialized after login completes
        renderRecordingsList();
    }
}

// Start the app
init();
