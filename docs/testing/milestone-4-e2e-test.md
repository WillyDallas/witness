# Milestone 4 E2E Test Procedure

## Prerequisites

1. App deployed to https://witness.squirrlylabs.xyz (or localhost:5173)
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

---

## Quick Console Tests

Run these in browser DevTools after importing:

```javascript
// Import test utilities
import('/src/lib/captureService.test.js').then(m => m.runCaptureTests());

// Quick 15-second capture test
import('/src/lib/integrationTest.js').then(m => m.runQuickTest());

// Mock integration test (no IPFS/chain)
import('/src/lib/integrationTest.js').then(m => m.runMockTest());
```

---

## Platform Test Matrix

| Platform | Browser | MIME Type | Expected Behavior |
|----------|---------|-----------|-------------------|
| iOS 16+ | Safari | video/mp4 | MP4 chunks, GPS works |
| iOS 16+ | Chrome | video/mp4 | MP4 chunks (uses WebKit) |
| Android | Chrome | video/webm | WebM VP9 chunks |
| macOS | Chrome | video/webm | WebM VP9 chunks |
| macOS | Safari | video/mp4 | MP4 chunks |
| Windows | Chrome | video/webm | WebM VP9 chunks |
