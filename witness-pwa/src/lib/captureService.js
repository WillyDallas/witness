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
   * Handle track ended event (camera disconnected, etc.)
   * @param {Event} event
   */
  _handleTrackEnded(event) {
    console.error('[CaptureService] Track ended:', event.target.kind);

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

      // Attach track listeners for error handling
      this._attachTrackListeners();

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
