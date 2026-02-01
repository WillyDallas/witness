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
    results.sessionId = sessionManager.sessionId;
    console.log(`   Session ID: ${results.sessionId}`);

    // Create capture service
    console.log('2. Creating CaptureService...');
    const capture = new CaptureService({
      timeslice: 10000,
      onChunk: async (blob, index, metadata) => {
        console.log(`   Chunk ${index}: ${blob.size} bytes`);

        try {
          await sessionManager.processChunk(blob, 10000, metadata);
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

    async processChunk(blob, duration, metadata) {
      console.log(`[Mock] Processing chunk ${metadata.index}: ${blob.size} bytes`);
      // Simulate processing delay
      await new Promise(r => setTimeout(r, 500));
      this.chunks.push({ index: metadata.index, size: blob.size, metadata });
      console.log(`[Mock] Chunk ${metadata.index} "uploaded"`);
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

/**
 * Short 15-second test for quick validation
 */
export async function runQuickTest() {
  console.log('=== Quick 15s Test ===');

  const chunks = [];
  const capture = new CaptureService({
    timeslice: 5000, // 5 second chunks for faster test
    onChunk: async (blob, index, metadata) => {
      console.log(`Chunk ${index}: ${blob.size} bytes`);
      chunks.push({ blob, index, metadata });
    },
    onStateChange: (state) => console.log(`State: ${state}`),
    onError: (err) => console.error('Error:', err)
  });

  try {
    await capture.start();
    console.log('Recording for 15 seconds...');
    await new Promise(r => setTimeout(r, 15000));
    capture.stop();
    await new Promise(r => setTimeout(r, 1000));

    console.log(`\n=== Quick Test Results ===`);
    console.log(`Chunks: ${chunks.length}`);
    console.log(`Expected: 3+ chunks`);
    console.log(`Result: ${chunks.length >= 3 ? 'PASS' : 'FAIL'}`);

    capture.destroy();
    return chunks;
  } catch (err) {
    console.error('Quick test failed:', err);
    capture.destroy();
    throw err;
  }
}

// Export for browser console
if (typeof window !== 'undefined') {
  window.runCaptureIntegrationTest = runIntegrationTest;
  window.runMockCaptureTest = runMockTest;
  window.runQuickCaptureTest = runQuickTest;
}
