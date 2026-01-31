# Witness Protocol: Hackathon MVP Architecture v2

**Chunked IPFS-First with Matrix Coordination**

The core insight: evidence capture must be resilient to the phone being knocked away mid-recording. Every 10-30 seconds, a chunk is encrypted, uploaded to IPFS, and the group is notified. If the phone dies, you lose at most one chunk—not everything.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           WITNESS PROTOCOL MVP v2                                │
│                                                                                  │
│                              ┌──────────────────┐                                │
│                              │      IPFS        │                                │
│                              │   (Pinata)       │                                │
│                              │                  │                                │
│                              │  Encrypted       │                                │
│                              │  video chunks    │                                │
│                              └────────▲─────────┘                                │
│                                       │                                          │
│   ┌──────────────────┐      ┌────────┴─────────┐      ┌──────────────────┐      │
│   │                  │      │                  │      │                  │      │
│   │   PWA CLIENT     │◄────►│  MATRIX SERVER   │      │   BLOCKCHAIN     │      │
│   │   (Expo Web)     │      │  (Synapse)       │      │   (Sepolia)      │      │
│   │                  │      │                  │      │                  │      │
│   │  • Capture video │      │  • CID registry  │      │  • Merkle root   │      │
│   │  • Chunk & encrypt│     │  • Group mgmt    │      │  • Timestamps    │      │
│   │  • Upload chunks │      │  • Key exchange  │      │  • Chunk proofs  │      │
│   │  • View videos   │      │  • Notifications │      │                  │      │
│   │                  │      │                  │      │                  │      │
│   └────────┬─────────┘      └──────────────────┘      └────────▲─────────┘      │
│            │                                                    │                │
│            │              ┌──────────────────┐                  │                │
│            └─────────────►│  PRIVY + PIMLICO │──────────────────┘                │
│                           │  (Wallet + Gas)  │                                   │
│                           └──────────────────┘                                   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key Difference from v1:** IPFS is the primary storage layer. Matrix coordinates but doesn't store video content.

---

## The Chunked Recording Model

```
Recording Timeline:
────────────────────────────────────────────────────────────────────►
│         │         │         │         │         │
0s       10s       20s       30s       40s       ✕ Phone knocked away
│         │         │         │         │         │
▼         ▼         ▼         ▼         ▼         │
Chunk 0   Chunk 1   Chunk 2   Chunk 3   Chunk 4   │ Chunk 5 (lost)
  │         │         │         │         │       │
  ▼         ▼         ▼         ▼         ▼       │
 IPFS     IPFS      IPFS      IPFS      IPFS     ✕ Never uploaded
  │         │         │         │         │
  └─────────┴─────────┴─────────┴─────────┘
                      │
                      ▼
              Merkle Root (on-chain)
              Covers chunks 0-4
              
Result: 50 seconds of evidence preserved, only 10 seconds lost
```

**Chunk Parameters:**
| Setting | Value | Rationale |
|---------|-------|-----------|
| Chunk duration | 10 seconds | Balance between granularity and overhead |
| Upload timeout | 5 seconds | Fail fast, retry on next chunk |
| Max parallel uploads | 2 | Don't overwhelm connection |
| Attestation frequency | End of recording OR every 5 minutes | Batch efficiency |

---

## Core User Flows

### Flow 1: Server Admin Setup (First User)

```
Admin deploys Matrix Synapse on VPS
         │
         ▼
Admin opens PWA, creates account via Privy
         │
         ▼
Privy creates embedded wallet + smart wallet
         │
         ▼
Admin creates "Evidence Circle" room on Matrix
         │
         ▼
Admin configures Pinata API keys in PWA settings
         │
         ▼
Admin becomes group owner, can invite others
```

### Flow 2: Member Joins Group

```
Admin shares invite link
         │
         ▼
New user opens PWA, creates account via Privy
         │
         ▼
User accepts invite, joins Matrix room
         │
         ▼
User receives room encryption keys (automatic via Matrix E2EE)
         │
         ▼
User can now view all group evidence + upload their own
```

### Flow 3: Capture Evidence (Chunked IPFS-First)

```
User taps "Record" in PWA
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  INITIALIZE                                                  │
│  • Start video recording                                     │
│  • Start GPS tracking                                        │
│  • Initialize chunk counter = 0                              │
│  • Initialize merkle tree (empty)                            │
│  • Generate session encryption key (AES-256-GCM)             │
│  • Share encryption key with group via Matrix (encrypted)    │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  CHUNKING LOOP (every 10 seconds)                           │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  1. Stop current segment, get video blob               │ │
│  │  2. Capture GPS point                                  │ │
│  │  3. Create chunk metadata:                             │ │
│  │     {                                                  │ │
│  │       chunkIndex: N,                                   │ │
│  │       startTime: ...,                                  │ │
│  │       endTime: ...,                                    │ │
│  │       gps: {lat, lng, alt},                           │ │
│  │       contentHash: SHA256(rawVideo)                    │ │
│  │     }                                                  │ │
│  │  4. Encrypt video chunk with session key               │ │
│  │  5. Upload encrypted chunk to IPFS → get CID           │ │
│  │  6. Add contentHash to merkle tree                     │ │
│  │  7. Notify Matrix room: "Chunk N uploaded: CID"        │ │
│  │  8. Save chunk locally (backup)                        │ │
│  │  9. Start next segment recording                       │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│                    Repeat until stopped                      │
│                    (or phone dies)                           │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
User taps "Stop" (or phone dies/app crashes)
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  FINALIZE                                                    │
│  • Upload any remaining partial chunk                        │
│  • Compute final merkle root                                 │
│  • Create manifest file:                                     │
│    {                                                         │
│      sessionId: "...",                                       │
│      chunks: [                                               │
│        { index: 0, cid: "Qm...", metadata: {...} },         │
│        { index: 1, cid: "Qm...", metadata: {...} },         │
│        ...                                                   │
│      ],                                                      │
│      merkleRoot: "0x...",                                    │
│      totalDuration: 127,                                     │
│      startTime: ...,                                         │
│      endTime: ...                                            │
│    }                                                         │
│  • Upload manifest to IPFS → manifestCID                     │
│  • Create EAS attestation with merkleRoot + manifestCID      │
│  • Post final message to Matrix room with attestation UID    │
│  • Stitch local chunks into single video (for social share)  │
└─────────────────────────────────────────────────────────────┘
```

### Flow 3b: Phone Dies Mid-Recording (Graceful Degradation)

```
Phone knocked away at chunk 4
         │
         ▼
Chunks 0-3 already on IPFS ✓
Chunk 4 upload in progress...
         │
         ├── Upload completes before connection lost → Chunk 4 saved ✓
         │
         └── Connection lost mid-upload → Chunk 4 lost ✗
         
         │
         ▼
No attestation created yet (phone is dead)
         │
         ▼
RECOVERY OPTIONS:

Option A: User recovers phone later
  • App detects incomplete session on restart
  • Retrieves chunk CIDs from Matrix room history
  • Creates attestation with available chunks
  • Marks session as "interrupted"

Option B: Trusted contact creates attestation
  • Contact saw chunk notifications in Matrix
  • Contact can create attestation on user's behalf
  • Uses chunk CIDs they witnessed
  • Attestation notes "submitted by witness"
```

### Flow 4: Watch Evidence

```
User opens "Evidence" tab in PWA
         │
         ▼
PWA fetches room timeline from Matrix
         │
         ▼
For each evidence session:
  │
  ├── Get manifestCID from completion message
  │
  ├── Fetch manifest from IPFS
  │
  ├── Get decryption key from Matrix room state
  │
  └── For playback:
        • Fetch chunks sequentially from IPFS
        • Decrypt each chunk
        • Feed to video player (Media Source Extensions)
        • Display GPS overlay from metadata
         │
         ▼
"Verify" button → Link to EAS attestation
```

---

## Component Details

### Component 1: PWA Client

**Key difference from v1:** Handles chunking, IPFS uploads, and Media Source Extensions for playback.

| Feature | Implementation |
|---------|----------------|
| Account creation | Privy SDK |
| Video capture | `expo-camera` with custom chunking |
| Chunking | `MediaRecorder` with `timeslice` option |
| GPS tracking | `expo-location` continuous |
| Encryption | Web Crypto API (AES-256-GCM) |
| IPFS upload | Pinata SDK (`pinata`) |
| Matrix coordination | `matrix-js-sdk` |
| Blockchain proof | `eas-sdk` + `viem` |
| Video playback | Media Source Extensions (MSE) |
| Local stitching | FFmpeg.wasm (for social export) |

**Chunking Implementation:**

```typescript
// Simplified chunking approach
const mediaRecorder = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=vp9',
});

const CHUNK_DURATION_MS = 10000; // 10 seconds

mediaRecorder.ondataavailable = async (event) => {
  if (event.data.size > 0) {
    await processChunk(event.data, chunkIndex++);
  }
};

// Request data every 10 seconds
mediaRecorder.start(CHUNK_DURATION_MS);
```

### Component 2: IPFS (Pinata)

**What it stores:**
- Encrypted video chunks (10 seconds each)
- Chunk metadata files
- Session manifest files

**Why Pinata for hackathon:**
- 1GB free tier (plenty for demo)
- Simple SDK
- Dedicated gateway for fast retrieval
- Can migrate to self-hosted IPFS later

**Pinning strategy for groups:**

```
User uploads chunk → Pinata pins it (guaranteed availability)
                   ↓
Matrix notifies group of CID
                   ↓
Group members' PWAs can also pin (optional redundancy)
                   ↓
Even if original user's Pinata quota runs out,
group members maintain copies
```

### Component 3: Matrix Synapse Server

**What it does (changed from v1):**
- ❌ Does NOT store video content
- ✅ Coordinates group membership
- ✅ Distributes encryption keys
- ✅ Announces new chunks (CID notifications)
- ✅ Stores session metadata and attestation UIDs

**Message types:**

```typescript
// Session start
{
  msgtype: "org.witness.session.start",
  body: "Recording started",
  "org.witness.session": {
    sessionId: "uuid-...",
    encryptionKey: { /* JWK, encrypted to room */ },
    startTime: 1706640000,
    startLocation: { lat: 40.7128, lng: -74.0060 }
  }
}

// Chunk uploaded
{
  msgtype: "org.witness.chunk",
  body: "Chunk 3 uploaded",
  "org.witness.chunk": {
    sessionId: "uuid-...",
    chunkIndex: 3,
    cid: "QmXyz...",
    contentHash: "0xabc...",
    duration: 10,
    gps: { lat: 40.7128, lng: -74.0060 }
  }
}

// Session complete
{
  msgtype: "org.witness.session.complete",
  body: "Recording complete",
  "org.witness.session.complete": {
    sessionId: "uuid-...",
    manifestCid: "QmManifest...",
    merkleRoot: "0xdef...",
    attestationUid: "0x123...",
    totalChunks: 12,
    totalDuration: 120
  }
}
```

### Component 4: Blockchain (Ethereum Sepolia)

**EAS Schema (updated for chunked model):**

```
bytes32 merkleRoot,
string manifestCid,
uint32 chunkCount,
uint64 startTime,
uint64 endTime,
string matrixRoomId
```

**What merkle root proves:**
- Every chunk hash is a leaf
- Root commits to entire recording
- Anyone with chunks can verify inclusion
- Tamper with one chunk → root won't match

**Verification flow:**

```
Verifier has: attestation UID + video file (stitched or chunks)
         │
         ▼
Fetch attestation → get merkleRoot, manifestCid
         │
         ▼
Fetch manifest from IPFS → get chunk list with expected hashes
         │
         ▼
For each chunk:
  • Hash the chunk content
  • Verify hash matches manifest
  • Verify hash is in merkle tree (using proof)
         │
         ▼
All chunks valid + merkle root matches attestation = VERIFIED
```

---

## Data Models

### Evidence Session

```typescript
interface EvidenceSession {
  // Identity
  sessionId: string;          // UUID
  
  // Encryption
  encryptionKey: CryptoKey;   // AES-256-GCM session key
  encryptionKeyJwk: JsonWebKey; // For sharing via Matrix
  
  // Chunks
  chunks: ChunkRecord[];
  
  // Merkle tree
  merkleTree: MerkleTree;
  merkleRoot: string | null;  // Set on finalization
  
  // Metadata
  startTime: number;
  endTime: number | null;
  startLocation: GpsPoint;
  endLocation: GpsPoint | null;
  
  // Storage references
  manifestCid: string | null;
  
  // Proof
  attestationUid: string | null;
  transactionHash: string | null;
  
  // Matrix
  matrixRoomId: string;
  
  // Status
  status: 'recording' | 'finalizing' | 'complete' | 'interrupted' | 'failed';
}

interface ChunkRecord {
  index: number;
  
  // Content
  localUri: string;           // Local file path
  encryptedBlob: Blob | null; // In memory during upload
  
  // Hashes
  contentHash: string;        // SHA-256 of raw video
  encryptedHash: string;      // SHA-256 of encrypted blob
  
  // IPFS
  cid: string | null;
  
  // Metadata
  startTime: number;
  endTime: number;
  duration: number;
  gps: GpsPoint;
  
  // Status
  status: 'recording' | 'processing' | 'uploading' | 'uploaded' | 'failed';
  uploadAttempts: number;
}

interface GpsPoint {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  timestamp: number;
}
```

### Manifest File (stored on IPFS)

```typescript
interface SessionManifest {
  version: "1.0";
  sessionId: string;
  
  // Proof
  merkleRoot: string;
  attestationUid: string;
  
  // Chunks
  chunks: {
    index: number;
    cid: string;
    contentHash: string;
    startTime: number;
    endTime: number;
    duration: number;
    gps: GpsPoint;
    byteSize: number;
  }[];
  
  // Session metadata
  totalDuration: number;
  totalSize: number;
  startTime: number;
  endTime: number;
  startLocation: GpsPoint;
  endLocation: GpsPoint;
  
  // Group
  matrixRoomId: string;
  submitterWallet: string;
  
  // Technical
  videoCodec: string;
  encryptionAlgorithm: "AES-256-GCM";
  chunkDurationTarget: number;
}
```

---

## Technical Stack

### PWA Client

| Package | Version | Purpose |
|---------|---------|---------|
| `expo` | ~52.0.0 | Framework |
| `expo-camera` | ~17.0.0 | Video capture |
| `expo-location` | ~19.0.0 | GPS tracking |
| `expo-file-system` | ~19.0.0 | Local chunk storage |
| `expo-sharing` | ~14.0.0 | Share stitched video to socials |
| `@privy-io/react-auth` | ^3.8.0 | Wallet + auth |
| `matrix-js-sdk` | ^34.0.0 | Matrix client |
| `pinata` | latest | IPFS uploads |
| `@ethereum-attestation-service/eas-sdk` | ^2.9.0 | Attestations |
| `viem` | ^2.0.0 | Ethereum interactions |
| `@openzeppelin/merkle-tree` | ^1.0.0 | Merkle tree construction |
| `zustand` | ^4.5.0 | State management |
| `@ffmpeg/ffmpeg` | ^0.12.0 | Video stitching (for export) |

### Infrastructure

| Service | Provider | Cost | Purpose |
|---------|----------|------|---------|
| Matrix VPS | Hetzner CX22 | €4.59/month | Coordination server |
| IPFS Pinning | Pinata Free | $0 | Video chunk storage (1GB) |
| PWA Hosting | Cloudflare Pages | $0 | Static hosting |
| Blockchain RPC | Alchemy Free | $0 | Sepolia access |
| Paymaster | Pimlico Free | $0 | Gas sponsorship |
| Domain | Cloudflare | ~$10/year | matrix.yourdomain.com |

**Total hackathon cost: ~€5 + domain**

---

## Deployment Checklist

### Day 0: Infrastructure Setup (2-3 hours)

- [ ] Provision Hetzner VPS (CX22, Ubuntu 24.04)
- [ ] Point `matrix.yourdomain.com` DNS to VPS
- [ ] Deploy Matrix Synapse via Docker
- [ ] Configure Nginx + SSL (Let's Encrypt)
- [ ] Create admin Matrix account
- [ ] Create Pinata account, get API keys
- [ ] Create Privy app, get App ID
- [ ] Create Pimlico account, get API key for Sepolia
- [ ] Create Alchemy account, get Sepolia API key

### Day 1: Core PWA + Recording (8 hours)

**Morning:**
- [ ] Initialize Expo project
- [ ] Integrate Privy authentication
- [ ] Implement basic video capture
- [ ] Implement GPS tracking

**Afternoon:**
- [ ] Implement chunking logic (10-second segments)
- [ ] Implement chunk encryption (AES-256-GCM)
- [ ] Implement Pinata upload for each chunk
- [ ] Test: chunks appearing on IPFS

### Day 2: Proof + Matrix Integration (8 hours)

**Morning:**
- [ ] Register EAS schema on Sepolia
- [ ] Implement merkle tree construction
- [ ] Implement manifest file creation + upload
- [ ] Implement EAS attestation (with Pimlico gas)

**Afternoon:**
- [ ] Initialize Matrix client
- [ ] Implement room creation (admin flow)
- [ ] Implement session start/chunk/complete messages
- [ ] Implement encryption key sharing via Matrix
- [ ] Test: full capture → prove → notify flow

### Day 3: Playback + Polish (8 hours)

**Morning:**
- [ ] Implement evidence list view (from Matrix timeline)
- [ ] Implement chunk fetching from IPFS
- [ ] Implement decryption + playback (MSE)
- [ ] Implement verification link to EAS

**Afternoon:**
- [ ] Implement member invite flow
- [ ] Implement video stitching for social export
- [ ] Deploy PWA to Cloudflare Pages
- [ ] End-to-end testing with 2-3 users
- [ ] Bug fixes and demo prep

### Day 4 (Buffer): Stretch Goals

- [ ] Interrupted session recovery
- [ ] human.tech zkDID integration
- [ ] Improved error handling
- [ ] UI polish

---

## Implementation Details

### Encryption Strategy

**Session key generation:**
```typescript
const sessionKey = await crypto.subtle.generateKey(
  { name: 'AES-GCM', length: 256 },
  true, // extractable (need to share with group)
  ['encrypt', 'decrypt']
);

// Export for sharing
const jwk = await crypto.subtle.exportKey('jwk', sessionKey);
```

**Chunk encryption:**
```typescript
async function encryptChunk(chunk: Blob, key: CryptoKey): Promise<{
  encrypted: Blob;
  iv: Uint8Array;
}> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await chunk.arrayBuffer();
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  
  return {
    encrypted: new Blob([encrypted]),
    iv
  };
}
```

**Key sharing via Matrix:**
```typescript
// The session key is encrypted by Matrix E2EE automatically
// when you send it to an encrypted room
await matrixClient.sendEvent(roomId, 'org.witness.session.start', {
  sessionId,
  encryptionKey: jwk, // Matrix encrypts this with Megolm
  startTime: Date.now(),
  startLocation: gps
});
```

### Merkle Tree Construction

```typescript
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';

// Collect all chunk hashes during recording
const chunkHashes: [string][] = chunks.map(c => [c.contentHash]);

// Build tree
const tree = StandardMerkleTree.of(chunkHashes, ['bytes32']);

// Get root for attestation
const merkleRoot = tree.root;

// Generate proof for any chunk (for verification)
const proof = tree.getProof(chunkIndex);
```

### IPFS Upload with Pinata

```typescript
import { PinataSDK } from 'pinata';

const pinata = new PinataSDK({
  pinataJwt: process.env.PINATA_JWT,
  pinataGateway: 'your-gateway.mypinata.cloud'
});

async function uploadChunk(
  encryptedBlob: Blob, 
  chunkIndex: number,
  sessionId: string
): Promise<string> {
  const file = new File(
    [encryptedBlob], 
    `${sessionId}_chunk_${chunkIndex}.enc`,
    { type: 'application/octet-stream' }
  );
  
  const result = await pinata.upload.file(file);
  return result.IpfsHash; // This is the CID
}
```

### EAS Attestation

```typescript
import { EAS, SchemaEncoder } from '@ethereum-attestation-service/eas-sdk';

const EAS_ADDRESS = '0xC2679fBD37d54388Ce493F1DB75320D236e1815e'; // Sepolia
const SCHEMA_UID = '0x...'; // Register during deployment

async function createAttestation(session: EvidenceSession) {
  const eas = new EAS(EAS_ADDRESS);
  eas.connect(signer); // From Privy smart wallet
  
  const encoder = new SchemaEncoder(
    'bytes32 merkleRoot, string manifestCid, uint32 chunkCount, uint64 startTime, uint64 endTime, string matrixRoomId'
  );
  
  const data = encoder.encodeData([
    { name: 'merkleRoot', value: session.merkleRoot, type: 'bytes32' },
    { name: 'manifestCid', value: session.manifestCid, type: 'string' },
    { name: 'chunkCount', value: session.chunks.length, type: 'uint32' },
    { name: 'startTime', value: BigInt(session.startTime), type: 'uint64' },
    { name: 'endTime', value: BigInt(session.endTime), type: 'uint64' },
    { name: 'matrixRoomId', value: session.matrixRoomId, type: 'string' },
  ]);
  
  const tx = await eas.attest({
    schema: SCHEMA_UID,
    data: {
      recipient: '0x0000000000000000000000000000000000000000',
      expirationTime: 0n,
      revocable: false,
      data,
    },
  });
  
  return await tx.wait(); // Returns attestation UID
}
```

### Video Playback with MSE

```typescript
async function playEvidence(manifest: SessionManifest, decryptionKey: CryptoKey) {
  const mediaSource = new MediaSource();
  videoElement.src = URL.createObjectURL(mediaSource);
  
  mediaSource.addEventListener('sourceopen', async () => {
    const sourceBuffer = mediaSource.addSourceBuffer('video/webm; codecs="vp9"');
    
    for (const chunk of manifest.chunks) {
      // Fetch from IPFS
      const encrypted = await fetch(`https://gateway.pinata.cloud/ipfs/${chunk.cid}`);
      const encryptedData = await encrypted.arrayBuffer();
      
      // Decrypt
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: chunk.iv },
        decryptionKey,
        encryptedData
      );
      
      // Append to video
      await appendBuffer(sourceBuffer, decrypted);
    }
    
    mediaSource.endOfStream();
  });
}
```

---

## Stretch Goals

### Stretch Goal 1: human.tech zkDID

**What it adds:** Verify group members are unique humans

**Integration point:** After Privy wallet creation, prompt user to complete human.tech verification. Store zkDID credential. Group admin can require zkDID for membership.

### Stretch Goal 2: Live Streaming

**What it adds:** Real-time viewing while recording

**Architecture change:**
```
Current chunk flow:  Chunk → Encrypt → IPFS → Matrix notification

With streaming:      Chunk → Encrypt → IPFS → Matrix notification
                        ↓
                     Also → WebRTC stream to online group members
```

Requires adding LiveKit or similar WebRTC infrastructure.

### Stretch Goal 3: Cross-Group Pinning

**What it adds:** Groups can pin each other's evidence for redundancy

**How it works:** Publish CIDs to a public registry. Other groups voluntarily pin, increasing censorship resistance.

### Stretch Goal 4: Interrupted Session Recovery

**What it adds:** Automatic recovery when app restarts after crash

**Implementation:**
- Persist session state to local storage
- On app start, check for incomplete sessions
- Resume upload of any unpinned local chunks
- Create attestation with whatever was saved

---

## Security Model

### What's Protected

| Asset | Protection | Failure Mode |
|-------|------------|--------------|
| Video content | AES-256-GCM encryption | Key compromise exposes content |
| Chunk integrity | SHA-256 + merkle tree | Undetected tampering impossible |
| Timestamp | EAS on-chain | Blockchain reorg (unlikely on mainnet) |
| Group membership | Matrix room encryption | Room key compromise |
| User wallet | Privy 2-of-2 SSS | Privy compromise + user device |

### What an Attacker Could Do

| Attacker | Capability | Impact | Mitigation |
|----------|------------|--------|------------|
| Matrix server operator | See CIDs, metadata, timing | Privacy leak (not content) | Content is encrypted |
| Pinata | Delete pinned content | Evidence unavailable | Group cross-pins |
| Network observer | See IPFS upload timing | Timing metadata | Tor (future) |
| Stolen phone | Access local chunks | Content exposure | Device encryption, session timeout |
| Privy | Block wallet access | Can't create attestations | Export private key |

### Trust Summary

```
You trust:
├── Privy (can be mitigated by key export)
├── Pimlico (can be mitigated by paying gas yourself)
├── Pinata (can be mitigated by group cross-pinning)
└── Your group members (they have decryption keys)

You don't have to trust:
├── Matrix server operator (sees metadata, not content)
├── Blockchain (public verification)
└── IPFS network (content-addressed, encrypted)
```

---

## Summary: What's Different from v1

| Aspect | v1 (Matrix Storage) | v2 (Chunked IPFS-First) |
|--------|---------------------|-------------------------|
| Video storage | Matrix media repo | IPFS (Pinata) |
| Upload timing | After recording stops | Every 10 seconds during recording |
| Phone knockout | Lose everything | Lose at most 10 seconds |
| Proof structure | Single hash | Merkle root of chunk hashes |
| Matrix role | Storage + coordination | Coordination only |
| Playback | Matrix download | IPFS fetch + MSE streaming |
| Complexity | Lower | Higher |
| Resilience | Lower | **Much higher** |

**The core tradeoff:** More implementation work for significantly better resilience to the exact scenario you're building for (evidence capture under duress).
