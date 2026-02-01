# Planning Agent Context: Milestone 4 — MediaRecorder Integration

## Your Task

Write a detailed implementation plan for **Milestone 4: MediaRecorder Integration** from the Phase 8 streaming video capture plan.

## Context to Read First

Read these files in order:

1. **The high-level plan** (what you're implementing):
   - `docs/plans/Current/2026-02-02-phase-8-streaming-video-capture.md`
   - Focus on "MediaRecorder Integration" section and "Milestone 4" success criteria

2. **Chunking research** (MediaRecorder behavior):
   - `docs/research/video-storage-and-transport/chunking-research.md`
   - `docs/research/video-storage-and-transport/video-chunking-research-context.md`
   - Key insight: `timeslice` chunks may not be independently playable

3. **Existing camera code** (if any):
   - Search codebase for `getUserMedia` or `MediaRecorder` usage
   - Check current video capture implementation

4. **Milestone 2-3 services** (what you're wiring to):
   - `planning-agent-context-milestone-2.md` — SessionManager API
   - `planning-agent-context-milestone-3.md` — persistence layer

## Before Writing the Plan

**Use context7 to verify MediaRecorder patterns**:

1. Search for `MediaRecorder API` to understand:
   - `timeslice` parameter behavior
   - `ondataavailable` event handling
   - Supported MIME types by browser
   - iOS Safari limitations (video/mp4 only)

2. Search for `getUserMedia` to understand:
   - Camera/microphone permissions
   - Constraint options (resolution, facing mode)
   - Error handling

3. Search for `Geolocation API` to understand:
   - Permission flow
   - `watchPosition` vs `getCurrentPosition`
   - Accuracy options

## CaptureService Design

```javascript
class CaptureService {
  constructor(options: {
    timeslice: number;           // ms between chunks (10000)
    onChunk: (blob, index) => Promise<void>;
    onError: (error) => void;
    videoConstraints?: MediaTrackConstraints;
    audioConstraints?: MediaTrackConstraints;
  });

  async start(): Promise<void>;  // Request permissions, start recording
  stop(): void;                   // Stop recording, fire final chunk
  pause(): void;                  // Pause (if supported)
  resume(): void;                 // Resume (if supported)

  getStream(): MediaStream;       // For preview
  isRecording(): boolean;
}
```

## What the Plan Should Cover

Use the `superpowers:writing-plans` skill format:

### Permission Handling
- Camera permission request flow
- Microphone permission (optional? required?)
- Geolocation permission (optional)
- What to show if denied

### MediaRecorder Configuration
- MIME type selection (webm vs mp4)
- Fallback for iOS Safari
- Quality/bitrate settings
- Timeslice value (10000ms)

### Chunk Handling
- `ondataavailable` → `sessionManager.processChunk()`
- Handle final chunk on stop
- Handle empty chunks (skip)

### GPS Tracking
- Start `watchPosition` when recording starts
- Attach coordinates to each chunk's metadata
- Stop watching when recording stops
- `verified: false` flag (PWA limitation)

### Error Handling
- Camera in use by another app
- Permission denied mid-recording
- MediaRecorder errors
- Stream track ended unexpectedly

### Stream Preview
- How to get stream for UI preview
- Cleanup on stop

## Test Cases

- Start capture, record for 25 seconds, stop
- Verify `onChunk` called 3 times (at 10s, 20s, and final)
- Verify each blob is valid video data (size > 0, correct MIME type)
- Test on iOS Safari (mp4 fallback)
- Test permission denied flow
- Test GPS attachment to chunks

## Success Criteria

From Milestone 4:
- Add CaptureService with real camera
- Wire to SessionManager
- **Test**: Record 30s, verify 3 chunks uploaded and anchored

## Output Location

Write the detailed implementation plan to:
`docs/plans/Current/2026-02-02-milestone-4-mediarecorder-plan.md`

## Important Notes

- This is the first milestone with **real camera** — previous used mock Blobs
- iOS Safari has different MediaRecorder support — plan for it
- GPS is optional metadata, not blocking
- Focus on the happy path first, then error handling
