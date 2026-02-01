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
