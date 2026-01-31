# Milestone 2: Chunked Evidence Upload

**Goal**: Extend the PWA to upload encrypted video chunks to IPFS in real-time, with GPS and timestamp metadata. Evidence survives even if the phone is seized mid-recording.

**Timeline**: 2 days
**Build on**: Existing PWA at `witness-pwa/`

---

## Success Criteria

- [ ] Video uploads to IPFS in 10-second chunks during recording
- [ ] Each chunk includes GPS coordinates and timestamp
- [ ] Chunks are encrypted before upload (AES-256-GCM)
- [ ] Recording metadata (manifest) uploaded on stop
- [ ] Verification link generated for each recording session
- [ ] Works on iOS Safari and Chrome Android

---

## Architecture Overview

```
Recording Session
│
├── Chunk 0 (0-10s)
│   ├── video_chunk_0.enc (encrypted video)
│   ├── metadata: { gps, timestamp, hash }
│   └── CID: Qm...abc
│
├── Chunk 1 (10-20s)
│   ├── video_chunk_1.enc
│   ├── metadata: { gps, timestamp, hash }
│   └── CID: Qm...def
│
└── manifest.json (uploaded on stop)
    ├── sessionId
    ├── chunks: [{ index, cid, gps, timestamp, hash }, ...]
    ├── encryptionKeyHint (for trusted contacts - future)
    └── CID: Qm...xyz  ──> Verification Link
```

---

## Implementation Plan

### Phase 1: Chunked Recording (3-4 hours)

**Current state**: MediaRecorder captures to memory, downloads on stop.

**Target state**: MediaRecorder fires `ondataavailable` every 10 seconds, each chunk processed immediately.

```javascript
// Key change in app.js
const CHUNK_DURATION_MS = 10000; // 10 seconds

mediaRecorder.start(CHUNK_DURATION_MS);

mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
        await processChunk(event.data, chunkIndex++);
    }
};
```

**Tasks**:
1. Modify `startRecording()` to use chunked mode
2. Create `processChunk(blob, index)` function that queues uploads
3. Track chunk metadata in session state
4. Handle upload queue (don't block recording on slow uploads)

### Phase 2: GPS Capture (1-2 hours)

**API**: `navigator.geolocation.watchPosition()`

```javascript
let locationWatcher = null;
let currentLocation = null;

function startLocationTracking() {
    if (!navigator.geolocation) return;

    locationWatcher = navigator.geolocation.watchPosition(
        (position) => {
            currentLocation = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                altitude: position.coords.altitude,
                timestamp: position.timestamp
            };
        },
        (error) => console.error('GPS error:', error),
        { enableHighAccuracy: true, maximumAge: 5000 }
    );
}

function stopLocationTracking() {
    if (locationWatcher) {
        navigator.geolocation.clearWatch(locationWatcher);
    }
}
```

**Tasks**:
1. Add location permission request on init
2. Start tracking when recording starts
3. Attach current location to each chunk's metadata
4. Stop tracking when recording stops

### Phase 3: Encryption (2-3 hours)

**Approach**: Generate a session key, encrypt each chunk with AES-256-GCM.

```javascript
async function generateSessionKey() {
    return await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable (for future sharing)
        ['encrypt', 'decrypt']
    );
}

async function encryptChunk(blob, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await blob.arrayBuffer();

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data
    );

    return {
        encrypted: new Blob([encrypted]),
        iv: Array.from(iv) // Store for decryption
    };
}
```

**Tasks**:
1. Generate session key on recording start
2. Encrypt each chunk before upload
3. Store IV with chunk metadata
4. Export key as JWK for manifest (future: share with trusted contacts)

### Phase 4: IPFS Upload via Pinata (2-3 hours)

**Setup**:
1. Create Pinata account: https://app.pinata.cloud
2. Generate API JWT (free tier: 1GB storage)

**Implementation**:
```javascript
const PINATA_JWT = 'your-jwt-here'; // TODO: Move to env/config
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';

async function uploadToIPFS(blob, filename) {
    const formData = new FormData();
    formData.append('file', blob, filename);

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${PINATA_JWT}`
        },
        body: formData
    });

    if (!response.ok) {
        throw new Error(`Pinata upload failed: ${response.status}`);
    }

    const result = await response.json();
    return result.IpfsHash; // This is the CID
}
```

**Tasks**:
1. Set up Pinata account and get JWT
2. Implement `uploadToIPFS()` function
3. Create upload queue with retry logic
4. Handle offline/failure gracefully (store locally, retry later)

### Phase 5: Manifest & Verification (2 hours)

**On recording stop**:
```javascript
async function finalizeSession(sessionId, chunks, sessionKey) {
    const manifest = {
        version: '1.0',
        sessionId,
        createdAt: new Date().toISOString(),
        chunks: chunks.map(c => ({
            index: c.index,
            cid: c.cid,
            iv: c.iv,
            gps: c.gps,
            timestamp: c.timestamp,
            duration: c.duration,
            size: c.size,
            contentHash: c.contentHash
        })),
        totalDuration: chunks.reduce((sum, c) => sum + c.duration, 0),
        totalChunks: chunks.length
    };

    const manifestBlob = new Blob(
        [JSON.stringify(manifest, null, 2)],
        { type: 'application/json' }
    );

    const manifestCid = await uploadToIPFS(manifestBlob, `manifest_${sessionId}.json`);

    return {
        manifestCid,
        verificationUrl: `${PINATA_GATEWAY}${manifestCid}`
    };
}
```

**Tasks**:
1. Create manifest structure
2. Upload manifest to IPFS
3. Display verification link to user
4. Store session in localStorage with manifest CID

---

## File Changes

| File | Changes |
|------|---------|
| `app.js` | Major refactor: chunked recording, GPS, encryption, IPFS upload |
| `index.html` | Add location permission UI, verification link display |
| `styles.css` | Styling for new UI elements |
| `config.js` | New file for Pinata JWT and other config |

---

## Environment Setup

```bash
# Pinata account
1. Go to https://app.pinata.cloud
2. Sign up (free tier)
3. Go to API Keys → New Key
4. Copy the JWT

# Local development
cd witness-pwa
python3 -m http.server 8080
# Open https://localhost:8080 (need HTTPS for camera/GPS)
```

For HTTPS locally, use:
```bash
# Option 1: ngrok
ngrok http 8080

# Option 2: mkcert for local certs
mkcert -install
mkcert localhost
# Then use a simple HTTPS server
```

---

## Testing Checklist

- [ ] Recording creates chunks every 10 seconds
- [ ] Each chunk uploads to IPFS (check Pinata dashboard)
- [ ] GPS coordinates attached to chunks
- [ ] Manifest created on stop with all CIDs
- [ ] Verification link works (can view manifest in browser)
- [ ] Simulated "phone knockout" - stop mid-recording, verify partial chunks saved
- [ ] Works on iOS Safari (MP4 format)
- [ ] Works on Chrome Android

---

## Security Notes

- **Pinata JWT**: For MVP, embedded in code. For production, use a backend proxy.
- **Encryption key**: Stored in memory during session. Future: derive from wallet signature for recovery.
- **No key sharing yet**: Trusted contacts feature is future milestone.

---

## What We're NOT Building (Scope Control)

- ❌ Trusted contacts / key sharing
- ❌ Matrix coordination
- ❌ Blockchain attestations (EAS)
- ❌ Video playback/decryption UI
- ❌ Expo migration

These are future milestones. Focus is: **chunks upload to IPFS with metadata**.

---

## Primus Integration Points

The following data should be captured in a format ready for Primus zkTLS proofs (see `primus-integration-reference.md`):

| Data | Current Capture | Future zkTLS Enhancement |
|------|-----------------|--------------------------|
| Timestamp | `Date.now()` | Verified via WorldTimeAPI + zkTLS |
| GPS | `navigator.geolocation` | Verified via Google Geolocation API + zkTLS |
| Device info | `navigator.userAgent` | Verified via Play Integrity + zkTLS |

For this milestone, capture raw data. Primus proofs can wrap these API calls in next iteration.
