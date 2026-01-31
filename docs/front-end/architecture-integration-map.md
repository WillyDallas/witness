# UI ↔ Architecture Integration Map

This document maps current UI components to their integration points with the Witness Protocol architecture components defined in [witness-protocol-architecture-v3.md](../planning/witness-protocol-architecture-v3.md).

---

## Integration Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CURRENT UI STATE                                   │
│                                                                              │
│   [Camera Preview] ─► [Record Button] ─► [MediaRecorder] ─► [Local Blob]    │
│                              │                                               │
│                              ▼                                               │
│                       [Save Button] ─► [Share/Download]                      │
│                              │                                               │
│                              ▼                                               │
│                       [Recordings Drawer] ─► [localStorage metadata]         │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

                                    │
                                    │ Future Integration
                                    ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│                         PROTOCOL-INTEGRATED STATE                            │
│                                                                              │
│   [Camera Preview] ─► [Record Button] ─► [Capture Pipeline]                  │
│                              │                 │                             │
│                              │                 ├──► [Encryption]             │
│                              │                 ├──► [IPFS Upload]            │
│                              │                 └──► [On-Chain Proof]         │
│                              ▼                                               │
│                       [Playback View] ◄─── [IPFS Fetch + Decrypt]            │
│                              │                                               │
│                              ▼                                               │
│                       [Recordings Drawer] ─► [CID index + Attestation count] │
│                                                                              │
│   [QR Share Button] ─► [Trusted Contact Sync]                               │
│                              │                                               │
│                              ▼                                               │
│                       [Vouch Button] ─► [Attestation System]                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Component-by-Component Integration

### 1. Identity & Wallet

**Architecture Component:** Privy Integration, Paymaster Setup, Key Derivation

**Current UI State:** None (no authentication)

**Integration Points:**

| UI Addition | Purpose | Priority |
|------------|---------|----------|
| Login button/modal | Privy email/social auth | Phase 1 |
| Wallet status indicator | Show connected state | Phase 1 |
| Key derivation on login | Generate encryption keys | Phase 1 |

**Code Changes:**
```javascript
// Add to init()
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';

async function initIdentity() {
    const { login, authenticated, user } = usePrivy();

    if (!authenticated) {
        // Show login UI
        await login();
    }

    // Derive encryption key from wallet signature
    const wallet = user.wallet;
    sessionKey = await deriveKeyFromWallet(wallet);
}
```

**New UI Elements:**
```html
<!-- Login modal (pre-camera access) -->
<div id="auth-modal" class="modal">
    <h2>Witness Protocol</h2>
    <p>Sign in to start recording</p>
    <button id="login-btn" class="btn btn-primary">Sign In</button>
</div>

<!-- Wallet indicator (header overlay) -->
<div class="wallet-indicator">
    <span class="wallet-status connected"></span>
    <span class="wallet-address">0x1234...5678</span>
</div>
```

---

### 2. Capture Pipeline

**Architecture Component:** Video Capture, Chunking, Metadata Collection, Hash Generation, Merkle Tree

**Current UI State:** Basic MediaRecorder with 1s chunks

**Integration Points:**

| Current Code | Change Required | Purpose |
|-------------|-----------------|---------|
| `mediaRecorder.start(1000)` | Change to `start(10000)` | 10-second chunks per spec |
| `ondataavailable` handler | Add hash/encrypt/upload per chunk | Real-time upload |
| Status text | Show chunk progress | User feedback |
| Recording indicator | Add upload progress | Visual feedback |

**Code Changes in `startRecording()`:**
```javascript
// Current: simple chunk collection
mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
        recordedChunks.push(event.data);
    }
};

// Future: chunked pipeline
mediaRecorder.ondataavailable = async (event) => {
    if (event.data.size > 0) {
        chunkIndex++;

        // Metadata collection
        const metadata = {
            index: chunkIndex,
            timestamp: Date.now(),
            gps: await getCurrentPosition(),
            deviceInfo: getDeviceInfo()
        };

        // Hash before encryption
        const hash = await sha256(event.data);

        // Update merkle tree
        merkleTree.addLeaf(hash);

        // Encrypt chunk
        const encrypted = await encrypt(event.data, sessionKey);

        // Upload to IPFS (non-blocking UI)
        uploadChunk(encrypted, metadata).then(cid => {
            uploadedCids.push({ cid, hash, metadata });
            updateStatus(`Uploaded chunk ${chunkIndex}`);
        });

        // Update on-chain merkle root
        if (chunkIndex % 3 === 0) {  // Batch updates
            updateMerkleRootOnChain(merkleTree.root);
        }
    }
};
```

**UI Enhancements:**
```html
<!-- Enhanced recording indicator -->
<div id="recording-indicator" class="recording-indicator">
    <span class="red-dot"></span>
    <span class="rec-text">REC</span>
    <span class="chunk-status">Chunk 3 ↑</span>  <!-- NEW -->
</div>
```

---

### 3. Encryption

**Architecture Component:** Session Key Generation, Chunk Encryption, Key Wrapping

**Current UI State:** No encryption (plaintext blobs)

**Integration Points:**

| Integration | Location | Notes |
|------------|----------|-------|
| Key generation | On login/session start | Derived from Privy wallet |
| Chunk encryption | `ondataavailable` handler | AES-256-GCM per chunk |
| Key wrapping | Trusted contact sync | Wrap session key for contacts |

**No direct UI changes** - encryption is transparent to user. Status messages may indicate encryption:
```javascript
updateStatus('Encrypting and uploading...');
```

---

### 4. Storage (IPFS + Pinata)

**Architecture Component:** Chunk Upload, Manifest Creation, Manifest Upload

**Current UI State:** Local Blob storage only

**Integration Points:**

| Current Flow | New Flow |
|-------------|----------|
| Blob stored in memory | Encrypted chunks uploaded to IPFS |
| Save button triggers share | Recording auto-uploads during capture |
| localStorage has filename | localStorage has CID + merkle root |

**Code Changes in `handleRecordingStop()`:**
```javascript
// Current: local blob
const blob = new Blob(recordedChunks, { type: mimeType });
pendingBlob = blob;
showElement(saveBtn);

// Future: IPFS manifest
const manifest = {
    sessionId,
    merkleRoot: merkleTree.root,
    chunks: uploadedCids,
    timestamp: new Date().toISOString(),
    duration: (Date.now() - recordingStartTime) / 1000,
    creator: wallet.address
};

const manifestCid = await uploadToIPFS(JSON.stringify(manifest));

// Register on-chain
await registryContract.registerEvidence(merkleTree.root, manifestCid);

// Local index (no blob storage needed)
saveRecording({
    id: sessionId,
    manifestCid,
    merkleRoot: merkleTree.root,
    ...manifest
});

updateStatus('Evidence secured on-chain');
```

**UI Changes:**
- Remove save button (auto-upload replaces it)
- Add "View on IPFS" link in recordings drawer
- Show upload progress during recording

---

### 5. On-Chain Proof

**Architecture Component:** Registry Contract, Incremental Updates, Event Emission

**Current UI State:** No blockchain integration

**Integration Points:**

| UI Element | On-Chain Connection |
|-----------|---------------------|
| Recording indicator | Show on-chain confirmation |
| Recordings drawer | Display verification status |
| Status text | Transaction progress |

**New UI Elements:**
```html
<!-- Verification badge in drawer -->
<li class="recording-item">
    <div class="recording-info">
        <span class="recording-filename">Session #12345</span>
        <span class="recording-meta">
            <span class="verified-badge">✓ Verified</span>  <!-- NEW -->
            2/1/2026 · 1:30 · 5 chunks
        </span>
    </div>
</li>

<!-- On-chain status in recording indicator -->
<div id="recording-indicator" class="recording-indicator">
    <span class="red-dot"></span>
    <span class="rec-text">REC</span>
    <span class="chain-status">⛓ On-chain</span>  <!-- NEW -->
</div>
```

**Event Subscription:**
```javascript
// Subscribe to contract events for real-time updates
registryContract.on('EvidenceRegistered', (sessionId, merkleRoot, manifestCid) => {
    // Update local state
    markRecordingVerified(sessionId);
    renderRecordingsList();
});
```

---

### 6. Trusted Contact Sync

**Architecture Component:** QR Code Generation/Scanning, Key Exchange, Contact Registry

**Current UI State:** No sharing capability

**Integration Points:**

**New UI Elements:**
```html
<!-- Share access button in controls -->
<button id="share-access-btn" class="btn btn-secondary">
    <span class="icon">👥</span>
    Share Access
</button>

<!-- QR modal -->
<div id="qr-modal" class="modal hidden">
    <div class="modal-content">
        <h3>Share Access</h3>
        <canvas id="qr-code"></canvas>
        <p>Scan to become a trusted contact</p>
        <button id="scan-qr-btn" class="btn">Scan Contact's QR</button>
        <button id="close-qr-btn" class="btn btn-secondary">Close</button>
    </div>
</div>

<!-- Trusted contacts drawer section -->
<div class="drawer-section">
    <h2>Trusted Contacts</h2>
    <ul id="contacts-list" class="contacts-list">
        <!-- Contact items -->
    </ul>
    <button id="add-contact-btn" class="btn btn-small">+ Add Contact</button>
</div>
```

**Code Addition:**
```javascript
async function generateAccessQR() {
    const qrData = {
        type: 'witness-trust',
        publicKey: wallet.publicKey,
        // Encrypted session key (requires exchange protocol)
    };

    await QRCode.toCanvas(
        document.getElementById('qr-code'),
        JSON.stringify(qrData)
    );

    showElement(qrModal);
}

async function scanContactQR() {
    // Use device camera to scan QR
    const qrData = await scanQRCode();

    // Add to trusted contacts
    await addTrustedContact(qrData);

    // Subscribe to their evidence events
    subscribeToContact(qrData.publicKey);
}
```

---

### 7. Attestation & Selective Disclosure

**Architecture Component:** Vouch Action, Privacy-Preserving Count, Attestation Registry

**Current UI State:** No attestation capability

**Integration Points:**

**New UI Elements (Viewer Mode):**
```html
<!-- When viewing someone else's evidence -->
<div class="evidence-viewer">
    <video id="evidence-playback"></video>

    <div class="evidence-info">
        <span class="attestation-count">3 attestations</span>
        <span class="verified-badge">✓ Verified</span>
    </div>

    <div class="evidence-actions">
        <button id="vouch-btn" class="btn btn-primary">
            Vouch for This Evidence
        </button>
    </div>
</div>
```

**Recording Drawer Enhancement:**
```html
<li class="recording-item">
    <div class="recording-info">
        <span class="recording-filename">Session #12345</span>
        <span class="recording-meta">
            2/1/2026 · 1:30
            <span class="attestation-badge">👥 3</span>  <!-- Attestation count -->
        </span>
    </div>
</li>
```

**Code Addition:**
```javascript
async function vouchForEvidence(sessionId, merkleRoot) {
    // Create attestation (gasless via paymaster)
    const tx = await attestationContract.vouch(sessionId, merkleRoot);
    await tx.wait();

    updateStatus('Vouched successfully');
}

// Display attestation count
async function getAttestationCount(sessionId) {
    return await attestationContract.getVouchCount(sessionId);
}
```

---

### 8. Playback & Verification

**Architecture Component:** Fetch from IPFS, Decrypt, Playback, Integrity Check

**Current UI State:** No playback (recordings are download-only)

**Integration Points:**

**New UI Elements:**
```html
<!-- Playback modal -->
<div id="playback-modal" class="modal hidden">
    <div class="modal-content playback-content">
        <video id="evidence-video" controls></video>

        <div class="verification-panel">
            <h4>Verification</h4>
            <div class="verification-item">
                <span class="label">Merkle Root</span>
                <span class="value hash">0x1234...5678</span>
                <span class="status verified">✓</span>
            </div>
            <div class="verification-item">
                <span class="label">On-Chain Timestamp</span>
                <span class="value">Feb 1, 2026 2:30 PM</span>
            </div>
            <div class="verification-item">
                <span class="label">Attestations</span>
                <span class="value">3 verified contacts</span>
            </div>
        </div>

        <button id="close-playback" class="btn">Close</button>
    </div>
</div>
```

**Code Addition:**
```javascript
async function playRecording(manifestCid) {
    // Fetch manifest
    const manifest = await fetchFromIPFS(manifestCid);

    // Verify merkle root on-chain
    const verified = await verifyOnChain(manifest.merkleRoot);

    // Fetch and decrypt all chunks
    const chunks = await Promise.all(
        manifest.chunks.map(async ({ cid, hash }) => {
            const encrypted = await fetchFromIPFS(cid);
            const decrypted = await decrypt(encrypted, sessionKey);

            // Verify chunk hash
            const actualHash = await sha256(decrypted);
            if (actualHash !== hash) {
                throw new Error('Chunk integrity check failed');
            }

            return decrypted;
        })
    );

    // Create playable blob
    const blob = new Blob(chunks, { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    // Display in player
    document.getElementById('evidence-video').src = url;
    showElement(playbackModal);

    // Show verification status
    updateVerificationPanel(manifest, verified);
}
```

---

## Phase-by-Phase UI Evolution

### Phase 1: Foundation
**Focus:** Identity & basic capture enhancement

| Change | Component |
|--------|-----------|
| Add Privy login flow | Identity & Wallet |
| Show wallet status | Identity & Wallet |
| Change to 10s chunks | Capture Pipeline |

### Phase 2: Core Loop
**Focus:** Encryption, storage, on-chain proof

| Change | Component |
|--------|-----------|
| Remove save button | Storage |
| Add upload progress to indicator | Storage |
| Show on-chain confirmation | On-Chain Proof |
| Add verification badge to drawer | On-Chain Proof |

### Phase 3: Sharing
**Focus:** Trusted contacts & playback

| Change | Component |
|--------|-----------|
| Add share access button | Trusted Contact Sync |
| Add QR modal | Trusted Contact Sync |
| Add playback modal | Playback & Verification |
| Make drawer items clickable | Playback & Verification |

### Phase 4: Trust Layer
**Focus:** Attestations

| Change | Component |
|--------|-----------|
| Add vouch button in viewer | Attestation |
| Show attestation counts | Attestation |
| Add trusted contacts section to drawer | Attestation |

---

## Summary: Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add login modal, QR modal, playback modal, wallet indicator, vouch button |
| `app.js` | Add Privy init, encryption pipeline, IPFS upload, contract interactions, playback logic |
| `styles.css` | Add modal styles, verification badges, attestation indicators |
| `sw.js` | Add network-first strategy for IPFS gateway calls |

**New Dependencies:**
- `@privy-io/react-auth` (or vanilla JS SDK)
- `pinata-sdk` or direct API calls
- `ethers.js` for contract interactions
- `qrcode` for QR generation
- `jsqr` for QR scanning (or native camera API)
