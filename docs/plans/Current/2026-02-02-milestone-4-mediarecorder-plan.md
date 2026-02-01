# Milestone 4: MediaRecorder Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire real camera capture via MediaRecorder to the SessionManager pipeline, producing encrypted chunks uploaded to IPFS and anchored on-chain.

**Architecture:** CaptureService wraps MediaRecorder with 10-second timeslice, routing each `ondataavailable` chunk to SessionManager.processChunk(). GPS coordinates are optionally attached as metadata. The existing main.js camera code is refactored into CaptureService for reuse.

**Tech Stack:** MediaRecorder API, getUserMedia API, Geolocation API, Web Crypto API (AES-256-GCM)

---

## Key Technical Constraints

### MediaRecorder Behavior (from chunking research)

| Constraint | Implication |
|------------|-------------|
| `timeslice` chunks are NOT independently playable | Must concatenate all chunks for valid video |
| First chunk contains headers (EBML/MP4 init) | Subsequent chunks depend on first chunk |
| Keyframes NOT aligned to timeslice boundaries | Cannot seek within individual chunks |
| iOS Safari: MP4 only, no WebM | Must detect platform and use appropriate MIME type |
| iOS Safari: timeslice can produce 15x larger chunks on pause/resume | Handle oversized chunks gracefully |
| Chrome Android: audio-only during screen lock | Final video may have video gaps |

### Platform MIME Type Support

| Platform | Supported | Recommended |
|----------|-----------|-------------|
| iOS Safari | `video/mp4` only | `video/mp4` (auto-selected) |
| Chrome Android | `video/webm;codecs=vp9,opus` | WebM preferred |
| Desktop Chrome | `video/webm;codecs=vp9,opus` | WebM preferred |
| Desktop Safari | `video/mp4` | MP4 |

---

## CaptureService Design

```javascript
// witness-pwa/src/lib/captureService.js

class CaptureService {
  constructor(options) {
    this.timeslice = options.timeslice || 10000;  // 10 seconds default
    this.onChunk = options.onChunk;               // async (blob, index) => void
    this.onError = options.onError;               // (error) => void
    this.onStateChange = options.onStateChange;   // (state) => void
    this.videoConstraints = options.videoConstraints || {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
    this.audioConstraints = options.audioConstraints ?? true;
    this.enableGPS = options.enableGPS ?? true;

    // Internal state
    this.stream = null;
    this.recorder = null;
    this.chunkIndex = 0;
    this.gpsWatchId = null;
    this.currentLocation = null;
    this.state = 'idle'; // idle | starting | recording | stopping | stopped
  }

  async start() { ... }
  stop() { ... }
  pause() { ... }
  resume() { ... }

  getStream() { return this.stream; }
  isRecording() { return this.state === 'recording'; }
  getState() { return this.state; }
  getCurrentLocation() { return this.currentLocation; }
}
```

---

## Implementation Tasks

### Task 1: Create CaptureService Module

**Files:**
- Create: `witness-pwa/src/lib/captureService.js`

**Step 1: Write the base CaptureService class**

```javascript
// witness-pwa/src/lib/captureService.js

/**
 * CaptureService - Wraps MediaRecorder for chunked video capture
 * Produces 10-second chunks routed to SessionManager for encryption and upload.
 */

/**
 * Get the best supported MIME type for this platform
 * @returns {string} Supported MIME type
 */
function getSupportedMimeType() {
  // iOS Safari requires MP4
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
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

  // Desktop/Android: prefer WebM for better compression
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

/**
 * CaptureService - Real-time video capture with chunked output
 */
export class CaptureService {
  /**
   * @param {Object} options
   * @param {number} [options.timeslice=10000] - Milliseconds between chunks
   * @param {Function} options.onChunk - async (blob, index, metadata) => void
   * @param {Function} [options.onError] - (error) => void
   * @param {Function} [options.onStateChange] - (state) => void
   * @param {MediaTrackConstraints} [options.videoConstraints]
   * @param {boolean|MediaTrackConstraints} [options.audioConstraints=true]
   * @param {boolean} [options.enableGPS=true]
   */
  constructor(options) {
    if (!options.onChunk) {
      throw new Error('CaptureService requires onChunk callback');
    }

    this.timeslice = options.timeslice || 10000;
    this.onChunk = options.onChunk;
    this.onError = options.onError || console.error;
    this.onStateChange = options.onStateChange || (() => {});

    this.videoConstraints = options.videoConstraints || {
      facingMode: 'environment',
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };
    this.audioConstraints = options.audioConstraints ?? true;
    this.enableGPS = options.enableGPS ?? true;

    // Internal state
    this.stream = null;
    this.recorder = null;
    this.chunkIndex = 0;
    this.gpsWatchId = null;
    this.currentLocation = null;
    this.state = 'idle';
    this.mimeType = null;
    this.startTime = null;
  }

  /**
   * Update internal state and notify listener
   * @param {string} newState
   */
  _setState(newState) {
    this.state = newState;
    this.onStateChange(newState);
  }

  /**
   * Start GPS tracking
   */
  _startGPS() {
    if (!this.enableGPS) return;
    if (!navigator.geolocation) {
      console.warn('[CaptureService] Geolocation API not available');
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 10000,  // Accept cached position up to 10s old
      timeout: 5000
    };

    this.gpsWatchId = navigator.geolocation.watchPosition(
      (position) => {
        this.currentLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          altitude: position.coords.altitude,
          altitudeAccuracy: position.coords.altitudeAccuracy,
          timestamp: position.timestamp,
          verified: false  // PWA cannot cryptographically verify GPS
        };
      },
      (error) => {
        console.warn('[CaptureService] GPS error:', error.message);
        // Don't fail recording if GPS fails
      },
      options
    );

    console.log('[CaptureService] GPS tracking started');
  }

  /**
   * Stop GPS tracking
   */
  _stopGPS() {
    if (this.gpsWatchId !== null) {
      navigator.geolocation.clearWatch(this.gpsWatchId);
      this.gpsWatchId = null;
      console.log('[CaptureService] GPS tracking stopped');
    }
  }

  /**
   * Handle dataavailable event from MediaRecorder
   * @param {BlobEvent} event
   */
  async _handleDataAvailable(event) {
    if (event.data.size === 0) {
      console.log('[CaptureService] Skipping empty chunk');
      return;
    }

    const index = this.chunkIndex++;
    const capturedAt = Date.now();

    const metadata = {
      index,
      capturedAt,
      mimeType: this.mimeType,
      size: event.data.size,
      location: this.currentLocation ? { ...this.currentLocation } : null
    };

    console.log(`[CaptureService] Chunk ${index}: ${event.data.size} bytes`);

    try {
      await this.onChunk(event.data, index, metadata);
    } catch (err) {
      console.error(`[CaptureService] Error processing chunk ${index}:`, err);
      this.onError(err);
    }
  }

  /**
   * Request camera and microphone permissions and start the stream
   * @returns {Promise<MediaStream>}
   */
  async _initStream() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera not supported in this browser');
    }

    if (typeof MediaRecorder === 'undefined') {
      throw new Error('Recording not supported in this browser');
    }

    const constraints = {
      video: this.videoConstraints,
      audio: this.audioConstraints
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      return this.stream;
    } catch (err) {
      // Translate error to user-friendly message
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        throw new Error('Camera permission denied. Please allow camera access.');
      } else if (err.name === 'NotFoundError') {
        throw new Error('No camera found on this device.');
      } else if (err.name === 'NotReadableError') {
        throw new Error('Camera is in use by another application.');
      } else {
        throw new Error(`Could not access camera: ${err.message}`);
      }
    }
  }

  /**
   * Start capturing video
   * @returns {Promise<void>}
   */
  async start() {
    if (this.state !== 'idle' && this.state !== 'stopped') {
      throw new Error(`Cannot start from state: ${this.state}`);
    }

    this._setState('starting');
    this.chunkIndex = 0;
    this.currentLocation = null;
    this.startTime = Date.now();

    try {
      // Initialize stream if not already done
      if (!this.stream) {
        await this._initStream();
      }

      // Start GPS tracking (non-blocking)
      this._startGPS();

      // Determine MIME type
      this.mimeType = getSupportedMimeType();
      console.log(`[CaptureService] Using MIME type: ${this.mimeType}`);

      // Create MediaRecorder
      this.recorder = new MediaRecorder(this.stream, {
        mimeType: this.mimeType,
        videoBitsPerSecond: 2500000  // 2.5 Mbps
      });

      // Set up event handlers
      this.recorder.ondataavailable = (e) => this._handleDataAvailable(e);

      this.recorder.onerror = (event) => {
        console.error('[CaptureService] MediaRecorder error:', event.error);
        this.onError(event.error);
        this._setState('stopped');
      };

      this.recorder.onstop = () => {
        console.log('[CaptureService] MediaRecorder stopped');
        this._stopGPS();
        this._setState('stopped');
      };

      // Start recording with timeslice
      this.recorder.start(this.timeslice);
      this._setState('recording');

      console.log(`[CaptureService] Recording started (${this.timeslice}ms chunks)`);

    } catch (err) {
      this._setState('idle');
      throw err;
    }
  }

  /**
   * Stop capturing video
   * Triggers final chunk via ondataavailable
   */
  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this._setState('stopping');
      this.recorder.stop();
    }
  }

  /**
   * Pause recording (if supported)
   * Note: iOS Safari has bugs with pause - audio continues
   */
  pause() {
    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.pause();
      this._setState('paused');
      console.log('[CaptureService] Recording paused');
    }
  }

  /**
   * Resume recording (if supported)
   */
  resume() {
    if (this.recorder && this.recorder.state === 'paused') {
      this.recorder.resume();
      this._setState('recording');
      console.log('[CaptureService] Recording resumed');
    }
  }

  /**
   * Get the media stream for preview
   * @returns {MediaStream|null}
   */
  getStream() {
    return this.stream;
  }

  /**
   * Check if currently recording
   * @returns {boolean}
   */
  isRecording() {
    return this.state === 'recording';
  }

  /**
   * Get current state
   * @returns {string}
   */
  getState() {
    return this.state;
  }

  /**
   * Get current GPS location
   * @returns {Object|null}
   */
  getCurrentLocation() {
    return this.currentLocation;
  }

  /**
   * Get the MIME type being used
   * @returns {string|null}
   */
  getMimeType() {
    return this.mimeType;
  }

  /**
   * Get recording duration in milliseconds
   * @returns {number}
   */
  getDuration() {
    if (!this.startTime) return 0;
    return Date.now() - this.startTime;
  }

  /**
   * Release all resources
   */
  destroy() {
    this.stop();
    this._stopGPS();

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }

    this.recorder = null;
    this._setState('idle');
  }
}

export { getSupportedMimeType };
```

**Step 2: Verify file was created**

Run: `ls -la witness-pwa/src/lib/captureService.js`
Expected: File exists

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/captureService.js
git commit -m "feat: add CaptureService for chunked video capture"
```

---

### Task 2: Write Unit Tests for CaptureService

**Files:**
- Create: `witness-pwa/src/lib/captureService.test.js`

**Step 1: Write the test file**

```javascript
// witness-pwa/src/lib/captureService.test.js

/**
 * CaptureService Tests
 *
 * Note: These tests require browser environment with MediaRecorder.
 * Run via: npm run test (with vitest configured for browser mode)
 * Or manually in browser console.
 */

import { CaptureService, getSupportedMimeType } from './captureService.js';

// Mock test helper for browser console
export async function runCaptureTests() {
  console.log('=== CaptureService Tests ===');

  // Test 1: getSupportedMimeType returns valid type
  console.log('Test 1: getSupportedMimeType');
  const mimeType = getSupportedMimeType();
  console.assert(
    mimeType.startsWith('video/'),
    `Expected video/* MIME type, got: ${mimeType}`
  );
  console.assert(
    MediaRecorder.isTypeSupported(mimeType),
    `MIME type not supported: ${mimeType}`
  );
  console.log(`  PASS: ${mimeType}`);

  // Test 2: CaptureService requires onChunk
  console.log('Test 2: Constructor requires onChunk');
  try {
    new CaptureService({});
    console.assert(false, 'Should have thrown');
  } catch (err) {
    console.assert(
      err.message.includes('onChunk'),
      `Unexpected error: ${err.message}`
    );
    console.log('  PASS: Throws without onChunk');
  }

  // Test 3: CaptureService initializes with defaults
  console.log('Test 3: Default options');
  const chunks = [];
  const service = new CaptureService({
    onChunk: (blob, index) => chunks.push({ blob, index })
  });
  console.assert(service.timeslice === 10000, 'Default timeslice should be 10000');
  console.assert(service.getState() === 'idle', 'Initial state should be idle');
  console.assert(service.isRecording() === false, 'Should not be recording');
  console.log('  PASS: Defaults set correctly');

  // Test 4: Start and stop recording (requires user gesture in browser)
  console.log('Test 4: Start/stop recording');
  console.log('  (Requires camera permission - run manually)');

  // Test 5: State transitions
  console.log('Test 5: State transitions');
  const states = [];
  const service2 = new CaptureService({
    onChunk: () => {},
    onStateChange: (state) => states.push(state)
  });
  console.assert(service2.getState() === 'idle', 'Should start idle');
  console.log('  PASS: State machine ready');

  console.log('=== All sync tests passed ===');
  console.log('Run manual integration test for camera capture.');

  return { mimeType, service, service2 };
}

/**
 * Manual integration test - call from browser console
 * Records for 25 seconds to produce 3 chunks
 */
export async function manualCaptureTest() {
  console.log('=== Manual Capture Test ===');
  console.log('Will record for 25 seconds (3 chunks expected)');

  const chunks = [];
  const states = [];

  const service = new CaptureService({
    timeslice: 10000,  // 10 second chunks
    onChunk: (blob, index, metadata) => {
      console.log(`Chunk ${index}: ${blob.size} bytes`, metadata);
      chunks.push({ blob, index, metadata });
    },
    onStateChange: (state) => {
      console.log(`State: ${state}`);
      states.push(state);
    },
    onError: (err) => console.error('Capture error:', err)
  });

  try {
    console.log('Starting capture...');
    await service.start();

    // Record for 25 seconds
    await new Promise(resolve => setTimeout(resolve, 25000));

    console.log('Stopping capture...');
    service.stop();

    // Wait for final chunk
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('=== Results ===');
    console.log(`Chunks captured: ${chunks.length}`);
    console.log(`States observed: ${states.join(' → ')}`);

    // Verify
    console.assert(chunks.length >= 3, `Expected 3+ chunks, got ${chunks.length}`);

    chunks.forEach((chunk, i) => {
      console.assert(chunk.blob.size > 0, `Chunk ${i} is empty`);
      console.assert(chunk.index === i, `Chunk index mismatch: ${chunk.index} !== ${i}`);
    });

    console.log('=== Test PASSED ===');

    // Cleanup
    service.destroy();

    return { chunks, states, service };

  } catch (err) {
    console.error('Test failed:', err);
    service.destroy();
    throw err;
  }
}

// Export for browser console access
if (typeof window !== 'undefined') {
  window.runCaptureTests = runCaptureTests;
  window.manualCaptureTest = manualCaptureTest;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/lib/captureService.test.js
git commit -m "test: add CaptureService unit tests"
```

---

### Task 3: Wire CaptureService to SessionManager

**Files:**
- Modify: `witness-pwa/src/lib/sessionManager.js` (assumes exists from Milestone 2)

**Step 1: Add integration method for CaptureService**

At the bottom of `sessionManager.js`, add:

```javascript
/**
 * Create a CaptureService wired to this SessionManager
 * @param {Object} options - Additional CaptureService options
 * @returns {CaptureService}
 */
export function createWiredCapture(sessionManager, options = {}) {
  const { CaptureService } = await import('./captureService.js');

  return new CaptureService({
    ...options,
    onChunk: async (blob, index, metadata) => {
      await sessionManager.processChunk(blob, index, metadata);
    },
    onError: (err) => {
      console.error('[SessionManager] Capture error:', err);
      sessionManager.markInterrupted();
    }
  });
}
```

**Step 2: Update SessionManager to accept chunk metadata**

In `processChunk` method, update signature:

```javascript
/**
 * Process a captured chunk
 * @param {Blob} blob - Raw video data
 * @param {number} index - Chunk index
 * @param {Object} [metadata] - Optional metadata from CaptureService
 */
async processChunk(blob, index, metadata = {}) {
  // ... existing processing logic ...

  // Include GPS in chunk record if available
  const chunkRecord = {
    // ... existing fields ...
    location: metadata.location || null,
    capturedAt: metadata.capturedAt || Date.now()
  };

  // ... rest of processing ...
}
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/sessionManager.js
git commit -m "feat: wire CaptureService to SessionManager"
```

---

### Task 4: Create Integration Test Script

**Files:**
- Create: `witness-pwa/src/lib/integrationTest.js`

**Step 1: Write integration test**

```javascript
// witness-pwa/src/lib/integrationTest.js

/**
 * Integration test: CaptureService → SessionManager → IPFS → Contract
 *
 * Run this in browser console after authentication:
 * import('/src/lib/integrationTest.js').then(m => m.runIntegrationTest())
 */

import { CaptureService } from './captureService.js';

/**
 * Full integration test: Record 30s, verify 3 chunks uploaded and anchored
 * @param {Object} sessionManager - Initialized SessionManager instance
 * @param {string[]} groupIds - Groups to share with
 */
export async function runIntegrationTest(sessionManager, groupIds) {
  console.log('=== Integration Test: Capture → IPFS → Chain ===');
  console.log(`Groups: ${groupIds.join(', ')}`);

  const results = {
    sessionId: null,
    chunks: [],
    errors: [],
    startTime: Date.now()
  };

  try {
    // Start session
    console.log('1. Starting session...');
    results.sessionId = await sessionManager.startSession(groupIds);
    console.log(`   Session ID: ${results.sessionId}`);

    // Create capture service
    console.log('2. Creating CaptureService...');
    const capture = new CaptureService({
      timeslice: 10000,
      onChunk: async (blob, index, metadata) => {
        console.log(`   Chunk ${index}: ${blob.size} bytes`);

        try {
          await sessionManager.processChunk(blob, index, metadata);
          results.chunks.push({
            index,
            size: blob.size,
            capturedAt: metadata.capturedAt,
            location: metadata.location
          });
          console.log(`   Chunk ${index} processed successfully`);
        } catch (err) {
          console.error(`   Chunk ${index} failed:`, err);
          results.errors.push({ index, error: err.message });
        }
      },
      onStateChange: (state) => console.log(`   State: ${state}`),
      onError: (err) => {
        console.error('   Capture error:', err);
        results.errors.push({ phase: 'capture', error: err.message });
      }
    });

    // Start recording
    console.log('3. Starting capture (30 seconds)...');
    await capture.start();

    // Wait 30 seconds for 3 chunks
    const recordTime = 30000;
    const progressInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - results.startTime) / 1000);
      console.log(`   Recording: ${elapsed}s / ${recordTime / 1000}s`);
    }, 5000);

    await new Promise(resolve => setTimeout(resolve, recordTime));
    clearInterval(progressInterval);

    // Stop recording
    console.log('4. Stopping capture...');
    capture.stop();

    // Wait for final chunk
    await new Promise(resolve => setTimeout(resolve, 2000));

    // End session
    console.log('5. Ending session...');
    await sessionManager.endSession();

    // Cleanup
    capture.destroy();

    // Report results
    console.log('\n=== Results ===');
    console.log(`Session ID: ${results.sessionId}`);
    console.log(`Chunks captured: ${results.chunks.length}`);
    console.log(`Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log('Errors:', results.errors);
    }

    // Verify
    const passed = results.chunks.length >= 3 && results.errors.length === 0;
    console.log(`\n=== Test ${passed ? 'PASSED' : 'FAILED'} ===`);

    return results;

  } catch (err) {
    console.error('Integration test failed:', err);
    results.errors.push({ phase: 'test', error: err.message });
    return results;
  }
}

/**
 * Quick test with mock SessionManager
 */
export async function runMockTest() {
  console.log('=== Mock Integration Test ===');

  // Mock SessionManager for testing without IPFS/chain
  const mockSessionManager = {
    sessionId: `mock-${Date.now()}`,
    chunks: [],

    async startSession(groupIds) {
      console.log('[Mock] Session started for groups:', groupIds);
      return this.sessionId;
    },

    async processChunk(blob, index, metadata) {
      console.log(`[Mock] Processing chunk ${index}: ${blob.size} bytes`);
      // Simulate processing delay
      await new Promise(r => setTimeout(r, 500));
      this.chunks.push({ index, size: blob.size, metadata });
      console.log(`[Mock] Chunk ${index} "uploaded"`);
    },

    async endSession() {
      console.log('[Mock] Session ended');
      console.log(`[Mock] Total chunks: ${this.chunks.length}`);
    },

    markInterrupted() {
      console.log('[Mock] Session marked interrupted');
    }
  };

  return runIntegrationTest(mockSessionManager, ['mock-group-1']);
}

// Export for browser console
if (typeof window !== 'undefined') {
  window.runCaptureIntegrationTest = runIntegrationTest;
  window.runMockCaptureTest = runMockTest;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/lib/integrationTest.js
git commit -m "test: add CaptureService integration test"
```

---

### Task 5: Add GPS Permission Handling

**Files:**
- Create: `witness-pwa/src/lib/permissions.js`

**Step 1: Write permissions helper**

```javascript
// witness-pwa/src/lib/permissions.js

/**
 * Permissions helper for camera, microphone, and GPS
 */

/**
 * Check if a permission is granted, denied, or needs prompting
 * @param {string} name - Permission name ('camera', 'microphone', 'geolocation')
 * @returns {Promise<'granted'|'denied'|'prompt'>}
 */
export async function checkPermission(name) {
  if (!navigator.permissions) {
    // Permissions API not supported, will need to request
    return 'prompt';
  }

  try {
    const result = await navigator.permissions.query({ name });
    return result.state;
  } catch (err) {
    // Permission query failed (e.g., not supported for this type)
    return 'prompt';
  }
}

/**
 * Request camera permission
 * @returns {Promise<boolean>} Whether permission was granted
 */
export async function requestCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    // Immediately stop the stream, we just wanted permission
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (err) {
    console.error('[permissions] Camera permission denied:', err);
    return false;
  }
}

/**
 * Request microphone permission
 * @returns {Promise<boolean>} Whether permission was granted
 */
export async function requestMicrophonePermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    return true;
  } catch (err) {
    console.error('[permissions] Microphone permission denied:', err);
    return false;
  }
}

/**
 * Request camera + microphone together
 * @returns {Promise<{camera: boolean, microphone: boolean}>}
 */
export async function requestCameraAndMic() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true
    });
    stream.getTracks().forEach(track => track.stop());
    return { camera: true, microphone: true };
  } catch (err) {
    // One or both failed - try separately to determine which
    const camera = await requestCameraPermission();
    const microphone = await requestMicrophonePermission();
    return { camera, microphone };
  }
}

/**
 * Request geolocation permission
 * @returns {Promise<boolean>} Whether permission was granted
 */
export async function requestGPSPermission() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      console.warn('[permissions] Geolocation not available');
      resolve(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      () => resolve(true),  // Success
      (err) => {
        console.warn('[permissions] GPS permission denied:', err.message);
        resolve(false);
      },
      { timeout: 5000 }
    );
  });
}

/**
 * Request all permissions needed for capture
 * @returns {Promise<Object>} Permission status for each type
 */
export async function requestAllCapturePermissions() {
  const results = {
    camera: false,
    microphone: false,
    gps: false
  };

  // Request camera and mic together (better UX - single prompt on most browsers)
  const camMic = await requestCameraAndMic();
  results.camera = camMic.camera;
  results.microphone = camMic.microphone;

  // GPS is separate permission
  results.gps = await requestGPSPermission();

  console.log('[permissions] Results:', results);
  return results;
}

/**
 * Get user-friendly message for permission denial
 * @param {string} permissionType
 * @returns {string}
 */
export function getPermissionDeniedMessage(permissionType) {
  const messages = {
    camera: 'Camera access denied. Please enable camera in your browser settings to record video.',
    microphone: 'Microphone access denied. Video will be recorded without audio.',
    gps: 'Location access denied. Video will be recorded without GPS metadata.'
  };
  return messages[permissionType] || 'Permission denied.';
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/lib/permissions.js
git commit -m "feat: add permissions helper for capture"
```

---

### Task 6: Handle MediaRecorder Errors

**Files:**
- Modify: `witness-pwa/src/lib/captureService.js`

**Step 1: Add error recovery logic**

Add these methods to CaptureService:

```javascript
/**
 * Handle track ended event (camera disconnected, etc.)
 * @param {Event} event
 */
_handleTrackEnded(event) {
  console.error('[CaptureService] Track ended:', event.target.kind);

  const wasRecording = this.state === 'recording';

  // Stop recording gracefully
  if (this.recorder && this.recorder.state !== 'inactive') {
    try {
      this.recorder.stop();
    } catch (err) {
      console.error('[CaptureService] Error stopping after track ended:', err);
    }
  }

  this.onError(new Error(`${event.target.kind} track ended unexpectedly`));
  this._setState('stopped');
}

/**
 * Attach track event listeners
 */
_attachTrackListeners() {
  if (!this.stream) return;

  this.stream.getTracks().forEach(track => {
    track.addEventListener('ended', (e) => this._handleTrackEnded(e));
  });
}
```

**Step 2: Update start() to attach listeners**

In the `start()` method, after `_initStream()`:

```javascript
// Attach track listeners for error handling
this._attachTrackListeners();
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/captureService.js
git commit -m "fix: handle track ended errors in CaptureService"
```

---

### Task 7: Add Wake Lock for Recording

**Files:**
- Modify: `witness-pwa/src/lib/captureService.js`

**Step 1: Add Wake Lock support**

Add to CaptureService constructor:

```javascript
this.wakeLock = null;
```

Add these methods:

```javascript
/**
 * Request wake lock to prevent screen sleep during recording
 */
async _requestWakeLock() {
  if (!('wakeLock' in navigator)) {
    console.warn('[CaptureService] Wake Lock API not available');
    return;
  }

  try {
    this.wakeLock = await navigator.wakeLock.request('screen');

    this.wakeLock.addEventListener('release', () => {
      console.log('[CaptureService] Wake lock released');
    });

    console.log('[CaptureService] Wake lock acquired');
  } catch (err) {
    console.warn('[CaptureService] Wake lock request failed:', err);
  }
}

/**
 * Release wake lock
 */
async _releaseWakeLock() {
  if (this.wakeLock) {
    try {
      await this.wakeLock.release();
      this.wakeLock = null;
    } catch (err) {
      console.warn('[CaptureService] Wake lock release failed:', err);
    }
  }
}
```

**Step 2: Update start() and stop()**

In `start()`, after `_startGPS()`:

```javascript
// Request wake lock to prevent screen sleep
await this._requestWakeLock();
```

In `stop()`:

```javascript
// Release wake lock
this._releaseWakeLock();
```

In `destroy()`:

```javascript
this._releaseWakeLock();
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/captureService.js
git commit -m "feat: add wake lock to prevent sleep during recording"
```

---

### Task 8: Handle iOS Safari MP4 Fallback

**Files:**
- Modify: `witness-pwa/src/lib/captureService.js`

**Step 1: Add iOS detection and handling**

Add at module level:

```javascript
/**
 * Detect iOS Safari
 * @returns {boolean}
 */
function isIOSSafari() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const isNotCriOS = !/CriOS/.test(ua);  // Not Chrome on iOS
  return isIOS && isWebkit && isNotCriOS;
}

/**
 * Get platform info for debugging
 * @returns {Object}
 */
function getPlatformInfo() {
  return {
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
    isIOSSafari: isIOSSafari(),
    isAndroid: /Android/.test(navigator.userAgent),
    userAgent: navigator.userAgent
  };
}
```

**Step 2: Log platform info on start**

In `start()` method:

```javascript
const platform = getPlatformInfo();
console.log('[CaptureService] Platform:', platform);
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/captureService.js
git commit -m "feat: add iOS Safari detection and logging"
```

---

### Task 9: Full E2E Test Procedure

**Files:**
- Create: `docs/testing/milestone-4-e2e-test.md`

**Step 1: Write test procedure document**

```markdown
# Milestone 4 E2E Test Procedure

## Prerequisites

1. App deployed to https://witness.squirrlabs.xyz (or localhost:5173)
2. User logged in with Privy
3. At least one group created
4. Valid IPFS/Pinata credentials configured

## Test Case 1: Basic 30-Second Recording

### Setup
1. Open app in browser (Chrome or Safari)
2. Ensure camera permission granted
3. Open DevTools Console

### Steps
1. Open drawer, note upload queue status
2. Start recording (hold record button)
3. Lock recording (swipe up)
4. Wait 30+ seconds (watch console for chunk logs)
5. Stop recording (tap record button)
6. Wait for all chunks to process

### Expected Results
- [ ] Console shows `[CaptureService] Recording started`
- [ ] Console shows 3+ `Chunk X: Y bytes` messages
- [ ] Each chunk shows IPFS CID on upload
- [ ] Console shows `updateSession()` calls to contract
- [ ] No errors in console

### Verification
1. Open IndexedDB → WitnessChunks → chunks table
2. Verify 3+ chunk records exist
3. Check status is 'confirmed' for all chunks

---

## Test Case 2: iOS Safari MP4 Format

### Setup
1. Open app on iPhone/iPad Safari
2. Grant camera + location permissions

### Steps
1. Start recording
2. Record for 15 seconds
3. Stop recording
4. Check console for MIME type

### Expected Results
- [ ] Console shows `Using MIME type: video/mp4`
- [ ] 2+ chunks captured successfully
- [ ] No codec errors

---

## Test Case 3: GPS Attachment

### Setup
1. Enable location services on device
2. Grant location permission to app

### Steps
1. Start recording
2. Record for 10+ seconds
3. Check console chunk metadata

### Expected Results
- [ ] Chunk metadata includes `location` object
- [ ] Location has `latitude`, `longitude`, `accuracy`
- [ ] `verified: false` flag is present

---

## Test Case 4: Permission Denied Flow

### Setup
1. Revoke camera permission in browser settings
2. Open app fresh

### Steps
1. Attempt to start recording

### Expected Results
- [ ] User-friendly error message displayed
- [ ] No crash or unhandled exception
- [ ] App remains usable

---

## Test Case 5: Network Offline Recovery

### Setup
1. Start recording
2. Record for 15+ seconds

### Steps
1. Enable airplane mode mid-recording
2. Continue recording for 10+ seconds
3. Stop recording
4. Disable airplane mode
5. Wait for queue to drain

### Expected Results
- [ ] Recording continues during offline
- [ ] Chunks queued in IndexedDB
- [ ] Chunks upload after network returns
- [ ] Final on-chain state correct

---

## Test Case 6: Tab Close Recovery

### Setup
1. Start recording
2. Capture 2-3 chunks

### Steps
1. Close browser tab abruptly (Cmd+W)
2. Reopen app

### Expected Results
- [ ] Recovery dialog appears OR auto-resume occurs
- [ ] Chunks from IndexedDB re-queued
- [ ] Uploads complete successfully
- [ ] No duplicate chunks on IPFS

---

## Verification Query (Contract)

After test, query contract for session:

```javascript
const sessionData = await witnessRegistry.getSession(sessionId);
console.log('Chunk count:', sessionData.chunkCount);
console.log('Manifest CID:', sessionData.manifestCid);
console.log('Merkle root:', sessionData.merkleRoot);
```

Session should show correct chunk count and valid CIDs.
```

**Step 2: Commit**

```bash
git add docs/testing/milestone-4-e2e-test.md
git commit -m "docs: add Milestone 4 E2E test procedure"
```

---

## Summary

This plan implements MediaRecorder integration with:

1. **CaptureService** - Clean wrapper around MediaRecorder with 10-second chunks
2. **GPS Tracking** - Optional location metadata attached to each chunk
3. **Platform Detection** - iOS Safari MP4 vs WebM for other browsers
4. **Wake Lock** - Prevents screen sleep during recording
5. **Error Handling** - Graceful handling of track ended, permission denied
6. **Permissions Helper** - Clean API for requesting camera/mic/GPS
7. **Integration** - Wired to SessionManager.processChunk()

**Key Principle**: CaptureService focuses only on capture. It passes blobs to SessionManager, which handles encryption, upload, and on-chain anchoring (from Milestone 2-3).

---

## Test Checkpoints

| Checkpoint | Verification |
|------------|-------------|
| CaptureService created | File exists at `src/lib/captureService.js` |
| MIME type detection | `getSupportedMimeType()` returns valid type |
| 10s chunks produced | `ondataavailable` fires ~every 10s |
| GPS attached | Chunk metadata includes location object |
| Wake lock active | Screen doesn't sleep during recording |
| iOS Safari works | MP4 format used, chunks captured |
| Wired to SessionManager | Chunks flow through full pipeline |
| 30s test passes | 3 chunks uploaded and anchored |

---

## References

- [Phase 8 Plan](./2026-02-02-phase-8-streaming-video-capture.md) - High-level streaming capture plan
- [Milestone 2 Plan](./2026-02-02-milestone-2-core-services-plan.md) - SessionManager API
- [Milestone 3 Plan](./2026-02-02-milestone-3-indexeddb-persistence-plan.md) - IndexedDB persistence
- [Chunking Research](../../research/video-storage-and-transport/chunking-research.md) - MediaRecorder behavior
- [MDN MediaRecorder](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) - API reference
- [MDN Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API) - GPS API reference
