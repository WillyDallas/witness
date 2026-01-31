# Claude Code Implementation Brief: Witness PWA Milestone 1

## Project Overview

Build a minimal Progressive Web App (PWA) that captures video on a mobile device and saves it locally. This is the first milestone of a larger "Witness Protocol" evidence capture project.

**Target deployment:** `https://witness.squirrlylabs.xyz`

---

## Goal

Create a PWA that:
1. Can be installed on a phone's home screen
2. Accesses the device camera and microphone
3. Records video with audio
4. Downloads the recorded video to the device
5. Shows a list of past recordings (metadata only, stored in localStorage)

---

## Technical Requirements

### Stack
- **Pure HTML/CSS/JavaScript** - No frameworks, no build tools
- **No npm packages** - Use only browser APIs
- This is intentional - we want to understand the fundamentals before adding abstractions

### Browser APIs to Use
- `navigator.mediaDevices.getUserMedia()` - Camera/mic access
- `MediaRecorder` - Video recording
- `URL.createObjectURL()` / `URL.revokeObjectURL()` - Blob handling
- `localStorage` - Persist recording metadata
- Service Worker - PWA installation capability

### File Structure

```
witness-pwa/
├── index.html          # Main app HTML
├── manifest.json       # PWA manifest
├── sw.js              # Service worker
├── app.js             # Main application logic
├── styles.css         # Styling
└── icons/
    ├── icon-192.png   # PWA icon (192x192)
    └── icon-512.png   # PWA icon (512x512)
```

---

## Detailed Specifications

### index.html

Required elements:
- PWA meta tags (theme-color, apple-mobile-web-app-capable, etc.)
- Link to manifest.json
- Apple touch icon link
- Video element for camera preview (with `autoplay muted playsinline` attributes)
- Recording indicator (red dot + "REC" text, hidden by default)
- Start Recording button
- Stop Recording button (hidden by default)
- Status text area for feedback
- Recordings list section

### manifest.json

```json
{
    "name": "Witness Protocol",
    "short_name": "Witness",
    "description": "Secure evidence capture",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#000000",
    "theme_color": "#dc2626",
    "orientation": "portrait",
    "icons": [
        {
            "src": "icons/icon-192.png",
            "sizes": "192x192",
            "type": "image/png",
            "purpose": "any maskable"
        },
        {
            "src": "icons/icon-512.png",
            "sizes": "512x512",
            "type": "image/png",
            "purpose": "any maskable"
        }
    ]
}
```

### sw.js (Service Worker)

Minimal implementation:
- Cache app shell files on install (index.html, app.js, styles.css, manifest.json)
- Serve from cache with network fallback
- Clean up old caches on activate

### app.js

#### Initialization
1. Register service worker
2. Request camera access immediately on load
3. Set up video preview stream
4. Load recordings list from localStorage
5. Attach event listeners to buttons

#### Camera Setup
- Request back camera (`facingMode: 'environment'`) with 1080p preferred
- Include audio: true
- Handle permission denied gracefully with user-friendly message
- Handle no camera found error

#### Recording Logic
- Use MediaRecorder API
- Detect supported MIME type (try webm/vp9 first, fall back to webm/vp8, then webm)
- Collect chunks via `ondataavailable` with 1000ms timeslice
- On stop: combine chunks into single Blob

#### Saving
- Generate filename: `witness_YYYY-MM-DDTHH-mm-ss.webm`
- Create object URL from blob
- Trigger download using temporary anchor element
- Save metadata to localStorage:
  ```javascript
  {
      id: Date.now(),
      filename: string,
      timestamp: ISO string,
      duration: seconds (float),
      size: bytes (number)
  }
  ```
- Revoke object URL after download triggered

#### UI Updates
- Toggle button visibility (start/stop)
- Show/hide recording indicator
- Update status text at each step
- Render recordings list from localStorage

### styles.css

Design requirements:
- Dark theme (black background, white text)
- Mobile-first, full viewport height
- Video preview should fill available space with `object-fit: cover`
- Recording indicator: positioned top-left over video, semi-transparent background, pulsing red dot animation
- Large touch-friendly buttons (min 48px tap target)
- Red accent color: `#dc2626`
- Use system font stack
- Handle safe areas for notched phones (use `100dvh` for dynamic viewport)

### Icons

Generate simple placeholder icons:
- 512x512 PNG: Red (#dc2626) background with white "W" letter centered
- 192x192 PNG: Same design, smaller

You can create these programmatically using canvas or provide SVG placeholders.

---

## What NOT To Build

Keep scope minimal. Do NOT include:
- ❌ GPS/location tracking (that's Milestone 2)
- ❌ Encryption (that's Milestone 3)
- ❌ Upload to server/IPFS (that's Milestone 4)
- ❌ User authentication
- ❌ Multiple camera support / camera switching
- ❌ Video playback within the app
- ❌ React, Vue, or any framework
- ❌ TypeScript
- ❌ Build tools (webpack, vite, etc.)
- ❌ npm dependencies

---

## Error Handling

Handle these cases gracefully:
1. Camera permission denied → Show message with instructions to enable in settings
2. No camera found → Show message
3. MediaRecorder not supported → Show message (rare, but possible on old browsers)
4. Recording fails → Show error, allow retry

---

## Testing Checklist

The implementation is complete when:

- [ ] Opening index.html shows camera preview (on localhost or HTTPS)
- [ ] Clicking "Start Recording" begins recording (indicator shows)
- [ ] Clicking "Stop Recording" triggers video download
- [ ] Downloaded video plays correctly with audio
- [ ] Recording appears in the recordings list
- [ ] Recordings list persists after page refresh
- [ ] App can be installed as PWA (manifest loads correctly)
- [ ] Service worker registers successfully
- [ ] App works offline (shows cached version)
- [ ] UI is usable on mobile (tested in Chrome DevTools mobile view)

---

## Sample Code Patterns

### Getting Supported MIME Type

```javascript
function getSupportedMimeType() {
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
```

### Triggering Download

```javascript
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
```

### MediaRecorder Setup

```javascript
const mediaRecorder = new MediaRecorder(stream, {
    mimeType: getSupportedMimeType(),
    videoBitsPerSecond: 2500000
});

const chunks = [];

mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
        chunks.push(e.data);
    }
};

mediaRecorder.onstop = () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType });
    // ... save blob
};

mediaRecorder.start(1000); // Get data every 1 second
```

---

## Deployment

The app will be deployed to an nginx server at `witness.squirrlylabs.xyz`. 

Files should be placed in `/var/www/witness/` on the server.

No build step required - just copy the files.

---

## Output

Please create all files in a `witness-pwa/` directory:
- `index.html`
- `manifest.json`
- `sw.js`
- `app.js`
- `styles.css`
- `icons/icon-192.png` (or instructions to generate)
- `icons/icon-512.png` (or instructions to generate)

Make sure the code is clean, well-commented, and follows the specifications above.
