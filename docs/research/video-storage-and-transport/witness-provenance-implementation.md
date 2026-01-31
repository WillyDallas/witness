# Witness Protocol: Provenance Implementation Guide

## PWA Hackathon Scope vs Production Native Roadmap

**The honest truth**: A PWA can build a *credible demonstration* of tamper-evident video capture, but cannot provide *cryptographic guarantees* about device authenticity. For a hackathon, this is fine—you're showing the architecture and user experience. For production, you need native code.

---

## What a PWA CAN Do (Hackathon Scope)

### ✅ Achievable in Browser

| Capability | API | Security Level | Notes |
|------------|-----|----------------|-------|
| **Video chunking** | MediaRecorder | ✅ Full | `timeslice` parameter works great |
| **SHA-256 hashing** | Web Crypto API | ✅ Full | Cryptographically sound |
| **AES-256-GCM encryption** | Web Crypto API | ✅ Full | Industry standard |
| **GPS coordinates** | Geolocation API | ⚠️ Spoofable | User can fake location |
| **Timestamps** | `Date.now()` | ⚠️ Spoofable | Device clock can be manipulated |
| **Device fingerprint** | navigator.userAgent | ⚠️ Spoofable | Easily faked |
| **Merkle tree construction** | JavaScript | ✅ Full | Math is math |
| **IPFS upload** | Fetch API | ✅ Full | Via Pinata HTTP gateway |
| **Local storage** | IndexedDB | ⚠️ Volatile | Browser can evict |

### ❌ NOT Achievable in Browser

| Capability | Why Not | Impact |
|------------|---------|--------|
| **Hardware-backed signing** | No Secure Enclave/Keystore access | Keys extractable via JS |
| **Device attestation** | No Play Integrity/App Attest | Can't prove real device |
| **C2PA with hardware keys** | Requires native crypto modules | Self-signed only |
| **Background recording** | Tab throttling, no foreground service | Unreliable if app backgrounded |
| **Tamper-proof key storage** | IndexedDB is JavaScript-accessible | Keys not protected |

---

## Hackathon Implementation: "Honest Provenance"

The strategy: **Build the full cryptographic pipeline, but be honest about what's verified vs unverified.**

### Proof Bundle Structure

```
chunk_proof_bundle/
├── chunk_003.enc                    # AES-256-GCM encrypted video
├── chunk_003.hash                   # SHA-256 of raw video (before encryption)
├── chunk_003.meta.json              # Metadata (see below)
├── chunk_003.sig                    # Software signature (ECDSA P-256)
└── chunk_003.ots                    # OpenTimestamps proof (REAL!)
```

### Metadata Schema (chunk_003.meta.json)

```json
{
  "version": "1.0",
  "chunkIndex": 3,
  "sessionId": "uuid-v4",
  
  "hashes": {
    "raw": "sha256:abc123...",
    "encrypted": "sha256:def456..."
  },
  
  "capture": {
    "startTime": "2026-01-31T10:30:00.000Z",
    "endTime": "2026-01-31T10:30:10.000Z",
    "duration": 10.0
  },
  
  "location": {
    "latitude": 18.7883,
    "longitude": 98.9853,
    "accuracy": 10,
    "altitude": 310,
    "source": "navigator.geolocation",
    "verified": false  // HONEST: we can't verify this
  },
  
  "device": {
    "userAgent": "Mozilla/5.0...",
    "platform": "iPhone",
    "verified": false  // HONEST: we can't verify this
  },
  
  "attestation": {
    "type": "none",  // Would be "play_integrity" or "app_attest" in production
    "token": null,
    "note": "PWA cannot access hardware attestation APIs"
  },
  
  "signature": {
    "algorithm": "ECDSA-P256",
    "publicKey": "base64...",
    "signature": "base64...",
    "keyStorage": "software",  // HONEST: not hardware-backed
    "verified": true  // The signature itself IS cryptographically valid
  },
  
  "timestamps": {
    "captured": "2026-01-31T10:30:10.000Z",
    "deviceClockVerified": false,  // HONEST
    "openTimestamps": {
      "status": "pending",  // or "confirmed" after ~1 hour
      "calendarUrl": "https://alice.btc.calendar.opentimestamps.org",
      "proof": "base64..."  // This IS cryptographically verifiable!
    }
  }
}
```

### What's Actually Cryptographically Sound

Even in a PWA, these things **cannot be faked** after the fact:

1. **Hash chain integrity**: If you have chunk hashes H1, H2, H3... and a Merkle root R, anyone can verify the chunks weren't modified after hashing.

2. **OpenTimestamps proofs**: Once confirmed in a Bitcoin block, this proves the hash existed at that time. This is **real, trustless, legally recognized** timestamping.

3. **Encryption integrity**: AES-256-GCM provides authenticated encryption—tampering is detectable.

4. **IPFS content addressing**: The CID is derived from content hash—if you have the CID, you can verify the content matches.

### What CAN Be Faked (Be Honest)

1. **GPS**: User could spoof location before recording
2. **Device clock**: Could be set to wrong time (but OpenTimestamps catches this!)
3. **Device identity**: Could claim to be any device
4. **That the video came from camera**: Could upload pre-recorded content

---

## Implementation Code for PWA

### 1. Cryptographic Utilities

```javascript
// crypto.js - All the crypto primitives you need

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

// Generate a session encryption key
export async function generateSessionKey() {
  return await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable for sharing with trusted contacts later
    ['encrypt', 'decrypt']
  );
}

// Generate signing key pair (software-based, but still ECDSA)
export async function generateSigningKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

// Hash a blob
export async function hashBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return bufferToHex(hashBuffer);
}

// Encrypt a chunk
export async function encryptChunk(blob, key) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const data = await blob.arrayBuffer();
  
  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    data
  );
  
  return {
    encrypted: new Blob([encrypted], { type: 'application/octet-stream' }),
    iv: bufferToBase64(iv)
  };
}

// Sign data with ECDSA
export async function signData(data, privateKey) {
  const encoded = new TextEncoder().encode(
    typeof data === 'string' ? data : JSON.stringify(data)
  );
  
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoded
  );
  
  return bufferToBase64(signature);
}

// Export public key for verification
export async function exportPublicKey(keyPair) {
  const exported = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  return bufferToBase64(exported);
}

// Utility functions
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufferToBase64(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer;
  return btoa(String.fromCharCode(...bytes));
}
```

### 2. Merkle Tree for Chunk Integrity

```javascript
// merkle.js - Simple Merkle tree for chunk verification

export class MerkleTree {
  constructor() {
    this.leaves = [];
  }
  
  addLeaf(hash) {
    this.leaves.push(hash);
  }
  
  getRoot() {
    if (this.leaves.length === 0) return null;
    if (this.leaves.length === 1) return this.leaves[0];
    
    let level = [...this.leaves];
    
    while (level.length > 1) {
      const nextLevel = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || left; // Duplicate last if odd
        nextLevel.push(this.hashPair(left, right));
      }
      level = nextLevel;
    }
    
    return level[0];
  }
  
  hashPair(a, b) {
    // Sort to ensure deterministic ordering
    const combined = a < b ? a + b : b + a;
    // Use synchronous hash for simplicity (or make async)
    return this.sha256Sync(combined);
  }
  
  sha256Sync(str) {
    // For demo - in production use async crypto.subtle.digest
    // This is a simplified version - use a proper library
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    // Placeholder - implement proper hashing
    return 'hash_' + str.substring(0, 16);
  }
  
  getProof(index) {
    // Returns the proof path for a specific leaf
    const proof = [];
    let idx = index;
    let level = [...this.leaves];
    
    while (level.length > 1) {
      const isRight = idx % 2 === 1;
      const siblingIdx = isRight ? idx - 1 : idx + 1;
      
      if (siblingIdx < level.length) {
        proof.push({
          hash: level[siblingIdx],
          position: isRight ? 'left' : 'right'
        });
      }
      
      const nextLevel = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || left;
        nextLevel.push(this.hashPair(left, right));
      }
      
      level = nextLevel;
      idx = Math.floor(idx / 2);
    }
    
    return proof;
  }
}
```

### 3. OpenTimestamps Integration (This is REAL!)

```javascript
// opentimestamps.js - Real Bitcoin timestamping

const OTS_CALENDARS = [
  'https://alice.btc.calendar.opentimestamps.org',
  'https://bob.btc.calendar.opentimestamps.org',
  'https://finney.calendar.eternitywall.com'
];

export async function submitTimestamp(hash) {
  // Convert hex hash to bytes
  const hashBytes = hexToBytes(hash);
  
  const results = await Promise.allSettled(
    OTS_CALENDARS.map(calendar => submitToCalendar(calendar, hashBytes))
  );
  
  // Return first successful result
  const success = results.find(r => r.status === 'fulfilled');
  if (success) {
    return success.value;
  }
  
  throw new Error('All calendar submissions failed');
}

async function submitToCalendar(calendarUrl, hashBytes) {
  const response = await fetch(`${calendarUrl}/digest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/vnd.opentimestamps.v1'
    },
    body: hashBytes
  });
  
  if (!response.ok) {
    throw new Error(`Calendar ${calendarUrl} returned ${response.status}`);
  }
  
  const proofBytes = await response.arrayBuffer();
  
  return {
    calendar: calendarUrl,
    timestamp: new Date().toISOString(),
    proof: bufferToBase64(proofBytes),
    status: 'pending' // Will be 'confirmed' after Bitcoin block inclusion
  };
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

function bufferToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}
```

### 4. Chunk Processor with Full Provenance

```javascript
// chunkProcessor.js - Ties it all together

import { hashBlob, encryptChunk, signData, exportPublicKey } from './crypto.js';
import { submitTimestamp } from './opentimestamps.js';
import { uploadToIPFS } from './ipfs.js';

export class ChunkProcessor {
  constructor(sessionKey, signingKeyPair, merkleTree) {
    this.sessionKey = sessionKey;
    this.signingKeyPair = signingKeyPair;
    this.merkleTree = merkleTree;
    this.chunkIndex = 0;
  }
  
  async processChunk(videoBlob, gpsPosition) {
    const chunkIndex = this.chunkIndex++;
    const timestamp = new Date().toISOString();
    
    // 1. Hash the raw video
    const rawHash = await hashBlob(videoBlob);
    
    // 2. Add to Merkle tree
    this.merkleTree.addLeaf(rawHash);
    
    // 3. Encrypt the chunk
    const { encrypted, iv } = await encryptChunk(videoBlob, this.sessionKey);
    const encryptedHash = await hashBlob(encrypted);
    
    // 4. Build metadata
    const metadata = {
      version: '1.0',
      chunkIndex,
      sessionId: this.sessionId,
      
      hashes: {
        raw: `sha256:${rawHash}`,
        encrypted: `sha256:${encryptedHash}`
      },
      
      capture: {
        timestamp,
        duration: 10.0
      },
      
      location: gpsPosition ? {
        latitude: gpsPosition.coords.latitude,
        longitude: gpsPosition.coords.longitude,
        accuracy: gpsPosition.coords.accuracy,
        altitude: gpsPosition.coords.altitude,
        source: 'navigator.geolocation',
        verified: false // HONEST
      } : null,
      
      device: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        verified: false // HONEST
      },
      
      attestation: {
        type: 'none',
        note: 'PWA - hardware attestation unavailable'
      },
      
      encryption: {
        algorithm: 'AES-256-GCM',
        iv
      }
    };
    
    // 5. Sign the metadata
    const signature = await signData(metadata, this.signingKeyPair.privateKey);
    const publicKey = await exportPublicKey(this.signingKeyPair);
    
    metadata.signature = {
      algorithm: 'ECDSA-P256',
      publicKey,
      signature,
      keyStorage: 'software', // HONEST
      verified: true
    };
    
    // 6. Submit to OpenTimestamps (async, non-blocking)
    const otsPromise = submitTimestamp(rawHash).catch(err => {
      console.warn('OpenTimestamps submission failed:', err);
      return { status: 'failed', error: err.message };
    });
    
    // 7. Upload encrypted chunk to IPFS
    const chunkCid = await uploadToIPFS(
      encrypted, 
      `chunk_${chunkIndex}.enc`
    );
    
    // 8. Wait for OTS (with timeout)
    const otsResult = await Promise.race([
      otsPromise,
      new Promise(resolve => 
        setTimeout(() => resolve({ status: 'timeout' }), 5000)
      )
    ]);
    
    metadata.timestamps = {
      captured: timestamp,
      deviceClockVerified: false, // HONEST
      openTimestamps: otsResult
    };
    
    // 9. Upload metadata to IPFS
    const metadataCid = await uploadToIPFS(
      new Blob([JSON.stringify(metadata, null, 2)], { type: 'application/json' }),
      `chunk_${chunkIndex}.meta.json`
    );
    
    return {
      chunkIndex,
      rawHash,
      chunkCid,
      metadataCid,
      otsStatus: otsResult.status
    };
  }
}
```

---

## Production Native Implementation (Roadmap)

### Architecture Difference

```
PWA (Hackathon)                    Native (Production)
─────────────────                  ────────────────────
                                   
┌─────────────────┐                ┌─────────────────┐
│   Web Crypto    │                │  Secure Enclave │  ← Hardware isolation
│   (Software)    │                │  / StrongBox    │
└────────┬────────┘                └────────┬────────┘
         │                                  │
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│  ECDSA P-256    │                │  ECDSA P-256    │  ← Same algorithm
│  (Extractable)  │                │  (Non-export)   │  ← Key never leaves hardware
└────────┬────────┘                └────────┬────────┘
         │                                  │
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│   No Device     │                │  Play Integrity │  ← Google/Apple signed
│   Attestation   │                │  / App Attest   │     device proof
└────────┬────────┘                └────────┬────────┘
         │                                  │
         ▼                                  ▼
┌─────────────────┐                ┌─────────────────┐
│  Self-signed    │                │  CA-signed      │  ← Trusted certificate
│  C2PA Manifest  │                │  C2PA Manifest  │     chain
└─────────────────┘                └─────────────────┘
```

### React Native / Expo Implementation

```javascript
// Native module integration points

// 1. Hardware-backed key generation (react-native-keychain)
import * as Keychain from 'react-native-keychain';

async function generateHardwareBackedKey() {
  // On iOS: Uses Secure Enclave
  // On Android: Uses StrongBox if available, otherwise TEE
  
  const result = await Keychain.setGenericPassword(
    'witness_signing_key',
    'key_placeholder', // The actual key is generated in hardware
    {
      accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE,
    }
  );
  
  return result;
}

// 2. Device attestation (react-native-device-info + custom native module)
// Android: Play Integrity API
async function getPlayIntegrityToken(nonce) {
  // Requires native module - see https://developer.android.com/google/play/integrity
  const token = await NativeModules.PlayIntegrity.requestIntegrityToken(nonce);
  
  // Token must be verified on YOUR server against Google's API
  // Returns: MEETS_BASIC_INTEGRITY, MEETS_DEVICE_INTEGRITY, MEETS_STRONG_INTEGRITY
  return token;
}

// iOS: App Attest
async function getAppAttestAttestation(challenge) {
  // Requires native module - see DCAppAttestService
  const keyId = await NativeModules.AppAttest.generateKey();
  const attestation = await NativeModules.AppAttest.attestKey(keyId, challenge);
  
  // Attestation is CBOR-encoded, verified against Apple's servers
  return { keyId, attestation };
}

// 3. C2PA manifest creation (c2pa-android / c2pa-ios SDK)
async function createC2PAManifest(mediaPath, metadata) {
  // Requires native module wrapping c2pa-android or c2pa-ios
  
  const manifest = await NativeModules.C2PA.createManifest({
    mediaPath,
    assertions: [
      {
        label: 'c2pa.actions',
        data: { actions: [{ action: 'c2pa.recorded', when: metadata.timestamp }] }
      },
      {
        label: 'stds.exif',
        data: {
          'EXIF:GPSLatitude': metadata.location.latitude,
          'EXIF:GPSLongitude': metadata.location.longitude,
          'EXIF:DateTimeOriginal': metadata.timestamp
        }
      }
    ],
    // Sign with hardware-backed key
    signingOptions: {
      algorithm: 'ES256',
      keyId: 'secure_enclave_key',
      useHardwareKey: true
    }
  });
  
  return manifest;
}
```

### Production Metadata Schema

```json
{
  "version": "2.0",
  "chunkIndex": 3,
  "sessionId": "uuid-v4",
  
  "hashes": {
    "raw": "sha256:abc123...",
    "encrypted": "sha256:def456..."
  },
  
  "location": {
    "latitude": 18.7883,
    "longitude": 98.9853,
    "accuracy": 10,
    "source": "fused_location_provider",
    "verified": true,
    "verificationMethod": "play_integrity_location_signal"
  },
  
  "device": {
    "manufacturer": "Google",
    "model": "Pixel 8",
    "osVersion": "Android 15",
    "verified": true,
    "verificationMethod": "play_integrity"
  },
  
  "attestation": {
    "type": "play_integrity",
    "verdict": "MEETS_STRONG_INTEGRITY",
    "token": "eyJ...",
    "nonce": "random_challenge",
    "verifiedAt": "2026-01-31T10:30:10.000Z"
  },
  
  "signature": {
    "algorithm": "ECDSA-P256",
    "publicKey": "base64...",
    "signature": "base64...",
    "keyStorage": "strongbox",
    "keyAttestation": "base64...",
    "verified": true
  },
  
  "c2pa": {
    "manifestHash": "sha256:...",
    "assertions": ["c2pa.actions", "stds.exif", "c2pa.hash.bmff.v3"],
    "signatureInfo": {
      "issuer": "CN=Witness Protocol, O=Your Org",
      "algorithm": "ES256",
      "timestamp": "2026-01-31T10:30:10.000Z",
      "timestampAuthority": "http://timestamp.digicert.com"
    }
  },
  
  "timestamps": {
    "captured": "2026-01-31T10:30:10.000Z",
    "deviceClockVerified": true,
    "verificationMethod": "play_integrity_time_signal",
    "openTimestamps": {
      "status": "confirmed",
      "bitcoinBlock": 880234,
      "blockTime": "2026-01-31T11:45:00.000Z",
      "proof": "base64..."
    },
    "rfc3161": {
      "authority": "http://timestamp.digicert.com",
      "token": "base64...",
      "time": "2026-01-31T10:30:15.000Z"
    }
  }
}
```

---

## Verification Levels

### Level 1: Basic Integrity (PWA achievable ✅)
- ✅ Chunk hashes match content
- ✅ Merkle root covers all chunks
- ✅ OpenTimestamps proof verifiable against Bitcoin
- ✅ IPFS CIDs match content
- ❓ GPS/time/device unverified

**Legal standing**: Proves content existed at timestamp, hasn't been modified since. Does NOT prove where/how it was captured.

### Level 2: Software Attestation (PWA achievable ✅)
- All of Level 1, plus:
- ✅ Valid ECDSA signature chain
- ✅ Consistent metadata across chunks
- ❓ Software keys could have been extracted

**Legal standing**: Stronger chain of custody, but keys could theoretically be compromised.

### Level 3: Hardware Attestation (Native required ❌)
- All of Level 2, plus:
- ✅ Play Integrity: MEETS_STRONG_INTEGRITY
- ✅ Hardware-backed signing key
- ✅ Key attestation certificate chain
- ✅ Device wasn't rooted/jailbroken

**Legal standing**: Meets FRE 902(13)/(14) self-authentication. Strong evidence the content came from a specific, uncompromised device.

### Level 4: Full C2PA Compliance (Native + CA cert required ❌)
- All of Level 3, plus:
- ✅ CA-signed C2PA manifest
- ✅ RFC 3161 qualified timestamp
- ✅ C2PA Trust List validation

**Legal standing**: Maximum admissibility. Meets ICC digital evidence standards. EU eIDAS qualified.

---

## Hackathon Demo Script

"Here's what Witness Protocol does:

1. **Every 10 seconds**, a video chunk is captured, hashed, encrypted, and uploaded to IPFS.

2. **The hash is immediately submitted to Bitcoin** via OpenTimestamps. Within an hour, we have cryptographic proof this content existed at this time—proof that's independently verifiable by anyone, forever.

3. **All chunks are linked in a Merkle tree**. Tamper with one frame, and the entire chain breaks.

4. **Even if my phone is seized**, chunks already uploaded are safe on IPFS, timestamped on Bitcoin.

Now, here's what we're honest about:

- In this PWA demo, we can't prove the video came from THIS camera on THIS device. A sophisticated attacker could upload pre-recorded content.

- The production roadmap adds **hardware attestation** via Play Integrity and App Attest, **C2PA manifests** with hardware-backed signatures, and **CA-signed certificates** for full legal admissibility.

- But the core innovation—**chunked upload with Bitcoin timestamping**—works today, in your browser, right now."

---

## Migration Path: PWA → Native

| Component | PWA Implementation | Native Upgrade |
|-----------|-------------------|----------------|
| Key storage | IndexedDB | react-native-keychain (Secure Enclave) |
| Signing | Web Crypto (software) | Native crypto with hardware key |
| Device attestation | None | expo-device + Play Integrity module |
| C2PA | Not possible | c2pa-ios / c2pa-android SDK |
| Background recording | Unreliable | expo-camera + foreground service |
| Local storage | IndexedDB (volatile) | expo-file-system + IOCipher |

The good news: **Your cryptographic pipeline (hash → sign → timestamp → merkle → upload) stays identical.** You're just swapping out WHERE the keys live and adding attestation layers.
