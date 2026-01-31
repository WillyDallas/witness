# Chunked Video Recording Architecture for Mobile PWA Evidence Capture

**Client-side chunking with immediate upload is the optimal architecture for Witness Protocol**, but MediaRecorder chunks are not independently playable—they must be concatenated for valid video files. iOS Safari and Chrome Android diverge significantly on codec support (MP4 vs WebM), requiring platform-specific handling. A single MediaRecorder instance can serve both local storage and real-time upload through the `ondataavailable` handler, with IndexedDB providing crash resilience.

## MediaRecorder timeslice creates one continuous recording, not separate segments

When calling `mediaRecorder.start(10000)`, the browser creates a **single continuous recording** that fires `ondataavailable` events approximately every 10 seconds. The encoder runs continuously without interruption—timeslice simply controls when buffered data flushes to blobs. The recorder state remains `recording` throughout.

**Critically, you receive only chunks that must be concatenated—there is no separate "complete" video.** When `stop()` is called, the final `dataavailable` event contains only remaining data since the last chunk, not a full recording. The standard pattern requires collecting all chunks:

```javascript
const chunks = [];
mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
mediaRecorder.onstop = () => {
    const fullVideo = new Blob(chunks, { type: mediaRecorder.mimeType });
};
```

**Individual chunks are NOT independently playable.** The W3C specification explicitly states: "Individual Blobs need not be playable, but the combination of all Blobs from a completed recording MUST be playable." Only the first chunk contains file headers (EBML header for WebM, initialization data for MP4). Subsequent chunks are continuation data that cannot play standalone. Real-world testing confirms this—developers consistently report that only the first chunk plays correctly while subsequent chunks produce corruption or silence.

## Keyframe placement is browser-controlled, not aligned to timeslice boundaries

Neither Chrome nor Safari forces keyframes at chunk boundaries. Chrome generates keyframes approximately every **3-5 seconds** (100 frames) regardless of timeslice value, meaning short-interval chunks (e.g., 500ms) will contain zero keyframes. This has critical implications for streaming: you cannot seek to or independently play chunks that lack keyframes.

The MediaRecorder spec now includes `videoKeyFrameIntervalDuration` and `videoKeyFrameIntervalCount` options for explicit control:

```javascript
new MediaRecorder(stream, {
    videoKeyFrameIntervalDuration: 2000  // Force keyframe every 2 seconds
});
```

Browser support for these options remains inconsistent across mobile browsers.

## iOS Safari requires MP4—no WebM support—with significant quirks

iOS Safari's MediaRecorder (available since iOS 14.5) supports **only MP4 with H.264/AAC**. Attempting WebM or VP8/VP9 fails silently. This creates a fundamental cross-platform incompatibility with Chrome, which defaults to WebM.

| Feature | iOS Safari | Chrome Android |
|---------|------------|----------------|
| **Container** | MP4 only | WebM (default), MP4 supported |
| **Video codec** | H.264 | VP8, VP9, AV1, H.264 |
| **Audio codec** | AAC | Opus (default), AAC |
| **Timeslice** | Supported but variable | Supported |
| **Bitrate control** | Not supported | Supported |

**Timeslice works on iOS Safari but with notable bugs.** WebKit Bug #279432 remains open: pausing and resuming camera access via iOS system controls generates chunks **15x larger than expected**. Device sleep during recording produces 23MB+ chunks on resume. The `ondataavailable` handler receives 0-byte data during pause, then massive accumulated chunks when recording resumes.

Safari outputs fragmented MP4 (fMP4) when using timeslice, which requires strict chunk ordering during concatenation. Playing blobs out of order causes only the first video frame to display while audio continues normally.

## Chrome Android handles screen lock and app switching differently

Chrome Android's MediaRecorder has distinct behavior when the device is locked or the user switches apps: recording continues but **switches to audio-only** while the video track mutes. Upon unlock, a large accumulated chunk containing all buffered audio arrives. The final concatenated recording has three sections: video+audio → audio-only (locked period) → video+audio. This is documented expected behavior, not a bug.

Both platforms can produce unexpectedly large chunks in edge cases. Implementing `Blob.slice()` to split oversized chunks before upload is essential:

```javascript
const MAX_CHUNK_SIZE = 8 * 1024 * 1024;
if (chunk.size > MAX_CHUNK_SIZE) {
    for (let offset = 0; offset < chunk.size; offset += MAX_CHUNK_SIZE) {
        await uploadChunk(chunk.slice(offset, offset + MAX_CHUNK_SIZE));
    }
}
```

## Client-side chunking with immediate upload is the resilience-optimal architecture

For an evidence capture app where the phone might be knocked away mid-recording, client-side chunking with immediate upload to IPFS or any cloud storage preserves all data captured before interruption. This approach offers three key advantages:

- **Partial data preservation**: Every successfully uploaded chunk survives device loss or crash
- **Reduced memory pressure**: Chunks upload and release rather than buffering entire recordings in RAM (critical for multi-hour recordings)
- **Offline capability**: Chunks queue in IndexedDB when offline, sync via Background Sync API when connectivity returns

Server-side chunking (streaming to a server that segments) requires continuous connectivity and loses everything on connection failure—unacceptable for field evidence capture.

**A single MediaRecorder instance handles both local copy and upload.** The `ondataavailable` callback can simultaneously push chunks to a local array (for final blob creation), persist to IndexedDB (crash recovery), and queue for upload:

```javascript
mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
        localChunks.push(event.data);           // For local preview/download
        await saveToIndexedDB(event.data);       // Crash recovery
        uploadQueue.enqueue(event.data);         // Real-time upload
    }
};
```

You do not need two MediaRecorder instances. Cloning the stream for separate recorders doubles encoding overhead and battery drain on mobile devices.

## Cross-platform codec strategy requires runtime detection

The codec incompatibility between Safari and Chrome requires explicit handling. Always use `MediaRecorder.isTypeSupported()` for runtime detection:

```javascript
function getOptimalMimeType() {
    const types = [
        'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',  // Safari + Chrome 114+
        'video/webm; codecs="vp9,opus"',               // Chrome preferred
        'video/webm; codecs="vp8,opus"',               // Chrome fallback
    ];
    return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
}
```

For maximum compatibility, let Safari auto-select (it will choose MP4) and explicitly configure Chrome to use MP4 if cross-platform playback without transcoding is required. However, Chrome's WebM with VP9 offers better compression efficiency if server-side transcoding is acceptable.

## Complete resilience architecture for Witness Protocol

The recommended architecture layers three redundancy mechanisms:

```
MediaRecorder (500-1000ms timeslice)
        ↓
ondataavailable handler
        ├──→ IndexedDB (crash recovery, offline queue)
        ├──→ Upload queue with retry (immediate IPFS upload)
        └──→ Local chunks array (preview, local download)
        
Service Worker
        ├──→ Background Sync API (uploads pending chunks when online)
        └──→ Wake Lock API (prevents sleep during recording)
```

**Recommended timeslice values**: Use 1000-2000ms for recording granularity, but buffer chunks until reaching 5-8MB before upload to reduce HTTP overhead. This balances responsiveness (frequent `ondataavailable` events) with upload efficiency (fewer larger requests).

For IPFS specifically, chunks should align with IPFS block sizes (256KB) after buffering—uploading raw MediaRecorder blobs directly works but may fragment inefficiently across IPFS blocks.

## Production apps prioritize never losing data over perfect quality

Body camera systems (Motorola, Axon, LensLock) and evidence capture apps share common architectural patterns:

- **Continuous local storage with background upload**: Record to local encrypted storage first, upload when conditions permit
- **Chain of custody metadata**: Embed timestamps, GPS, device ID at capture time with cryptographic signatures
- **Pre-record buffers**: Capture 30-60 seconds before manual activation so evidence preceding the trigger isn't lost
- **Automatic activation triggers**: Motion, audio levels, or external signals start recording without user action

Open-source reference implementations worth studying include **stream.new** (Mux's implementation using MediaRecorder + UpChunk for resumable uploads) and **MediaStreamRecorder** (cross-browser recording with server upload).

## Critical implementation gotchas for mobile PWA context

**Memory accumulation during long recordings** is the primary risk on mobile. All recorded data stays in RAM until stop() is called. A 2-hour 1080p recording can exceed 1GB of memory, causing silent crashes on memory-constrained devices. Aggressive chunk upload with local array cleanup after confirmed upload mitigates this.

**WebM files lack duration metadata and aren't seekable** when recorded by Chrome. This is by design (live streaming format). Use libraries like `fix-webm-duration` for post-processing if seeking is required, or use MP4 format.

**Safari's pause/resume behavior differs from Chrome**: Safari continues capturing audio during "pause" (a bug), then delivers it all in one massive chunk on resume. Chrome's pause actually stops capture. Design your UX around these differences.

**Wake Lock API is essential**: Without it, iOS will suspend your PWA after ~30 seconds of screen-off, terminating recording. Request `screen` wake lock when recording starts:

```javascript
const wakeLock = await navigator.wakeLock.request('screen');
```

The architecture of client-side chunking, IndexedDB persistence, immediate upload with retry, and platform-specific codec handling provides maximum resilience for evidence capture where losing footage is unacceptable.