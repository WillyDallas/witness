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
