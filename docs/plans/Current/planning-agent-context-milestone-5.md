# Planning Agent Context: Milestone 5 — Recording UI

## Your Task

Write a detailed implementation plan for **Milestone 5: Recording UI** from the Phase 8 streaming video capture plan.

## Context to Read First

Read these files in order:

1. **The high-level plan** (what you're implementing):
   - `docs/plans/Current/2026-02-02-phase-8-streaming-video-capture.md`
   - Focus on "UI Changes" section and "Milestone 5" success criteria

2. **Existing UI code**:
   - `witness-pwa/index.html` — current app structure
   - `witness-pwa/styles.css` — current styling
   - `witness-pwa/src/ui/` — existing UI modules

3. **CaptureService from Milestone 4**:
   - `planning-agent-context-milestone-4.md`
   - How to get stream for preview
   - How to start/stop recording

4. **Groups UI** (for pre-recording selection):
   - `witness-pwa/src/ui/groupsModal.js`

## Before Writing the Plan

**Use context7 to verify UI patterns**:

1. Search for `video element getUserMedia` to understand:
   - Attaching MediaStream to `<video>` element
   - `autoplay`, `muted`, `playsinline` attributes
   - Mobile fullscreen considerations

2. Search for `CSS fullscreen video` to understand:
   - Object-fit for camera preview
   - Safe area handling (notch, home indicator)
   - Overlay positioning

3. Search for `PWA mobile UI` patterns:
   - Touch-friendly button sizes
   - Preventing accidental touches
   - Screen wake lock during recording

## UI Components

### Recording Screen Layout
```
┌─────────────────────────────┐
│ ● 2:34              ✓ 14   │  ← StatusBar (overlay)
│                             │
│                             │
│                             │
│      [Full Camera View]     │  ← <video> element, object-fit: cover
│                             │
│                             │
│                             │
│         ⏹ (stop fab)        │  ← StopButton (floating)
└─────────────────────────────┘
```

### StatusBar (Minimal Overlay)
- Recording indicator (● red dot, pulsing)
- Elapsed time (MM:SS)
- Chunk status:
  - `✓ 14` green — all chunks confirmed
  - `⏳ 14` yellow — queue building (uploads pending)
  - `⚠️ 14` red — errors in queue

### StopButton
- Large, centered at bottom
- Clear stop icon
- Tap to stop recording

### Pre-Recording: Group Selection
- Modal or screen before recording starts
- Checkboxes for each group user belongs to
- "Start Recording" button
- Can't change groups mid-recording

### Post-Recording: Summary
- Brief overlay or screen after stop
- "X chunks uploaded, all confirmed ✓"
- "View Recording" button → goes to content detail
- Auto-dismiss after 3 seconds?

## What the Plan Should Cover

Use the `superpowers:writing-plans` skill format:

### File Structure
- New UI module: `witness-pwa/src/ui/recordingScreen.js`
- New CSS: recording-specific styles
- Integration point in main app

### Component Implementation
- StatusBar component
- StopButton component
- Camera preview setup
- Group selection flow

### State Management
- Recording state (idle, recording, stopping)
- Elapsed time tracking (setInterval)
- Chunk count and status from SessionManager
- Network status detection

### Mobile Considerations
- Screen wake lock API (keep screen on)
- Fullscreen API (optional)
- Safe area insets (CSS env())
- Prevent pull-to-refresh during recording

### Transitions
- From main screen → group selection → recording
- From recording → summary → content detail

## Test Cases

- Record 30 seconds
- Verify UI shows 3 chunks uploaded
- Toggle airplane mode mid-recording
- Verify UI shows queue building (yellow indicator)
- Recording continues
- Restore network
- Verify queue drains (indicator turns green)
- Stop recording
- Verify summary shows correct chunk count

## Success Criteria

From Milestone 5:
- Full-screen camera with minimal overlay
- Group selection before recording
- Stop button
- **Test**: Full E2E flow from UI

## Output Location

Write the detailed implementation plan to:
`docs/plans/Current/2026-02-02-milestone-5-recording-ui-plan.md`

## Important Notes

- Camera preview should take up **most of the screen**
- Overlay should be **minimal and unobtrusive**
- This is the first user-facing milestone — UX matters
- Test on actual mobile device, not just desktop
