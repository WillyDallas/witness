# Data Layer Comparison for Witness Protocol

**IPFS with Pinata is the optimal choice for a 3-day hackathon** — offering the fastest path to encrypted, censorship-resistant evidence storage with excellent TypeScript tooling. Matrix Protocol serves as a strong backup if real-time sync becomes critical.

## Comparison matrix: All options at a glance

| Criteria | Matrix | IPFS + Pinata | Gun.js | Nostr + Blossom | WebRTC Direct | S3/MinIO |
|----------|--------|---------------|--------|-----------------|---------------|----------|
| **E2E Encryption** | ✅ Megolm + AES | ✅ Web Crypto | ✅ SEA | ✅ NIP-44 | ✅ DTLS-SRTP | ✅ Web Crypto |
| **Media Files** | ⚠️ 50MB default | ✅ Excellent | ❌ Requires chunking | ✅ Good | ✅ DataChannel | ✅ Excellent |
| **Real-time Sync** | ✅ 50-200ms | ⚠️ Not native | ✅ ~50-200ms | ✅ Via relays | ✅ P2P | ⚠️ WebSocket |
| **Web/PWA** | ✅ matrix-js-sdk | ✅ HTTP gateways | ✅ Browser | ✅ nostr-tools | ✅ Native API | ✅ fetch API |
| **Self-hostable** | ✅ Synapse | ✅ IPFS node | ✅ Gun relay | ✅ Relay/Blossom | ⚠️ TURN only | ✅ MinIO |
| **Censorship Resistant** | ⚠️ Depends on server | ✅ High | ✅ P2P | ✅ Multi-relay | ✅ P2P | ❌ Centralized |
| **Offline Support** | ✅ Queue + sync | ✅ Upload when ready | ✅ CRDT | ✅ Multi-relay | ❌ None | ⚠️ Local cache |
| **Implementation Time** | 🟡 16-24 hrs | 🟢 8-12 hrs | 🟡 12-18 hrs | 🟡 14-20 hrs | 🟡 12-16 hrs | 🟢 6-10 hrs |
| **Hackathon Score** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## Primary recommendation: IPFS with Pinata SDK

IPFS combined with Pinata delivers the **best balance of decentralization, security, and implementation speed** for a 3-day Ethereum hackathon. The content-addressed storage model aligns perfectly with blockchain principles, and Pinata's TypeScript SDK eliminates IPFS complexity.

### Why IPFS wins for Witness Protocol

**Speed to working prototype**: Using Pinata's SDK, you can have encrypted uploads working in under 4 hours. The entire stack requires just two npm packages (`pinata`, native Web Crypto API) with zero infrastructure setup.

**Ethereum-native architecture**: Content hashes (CIDs) are perfect for on-chain storage — your smart contract stores just the **32-byte hash**, while the encrypted evidence lives on IPFS. This creates an immutable, timestamped proof-of-existence that's cryptographically verifiable.

**Censorship resistance built-in**: Once pinned to multiple services, evidence cannot be deleted without controlling all pinning providers. The hash-based addressing means content can be retrieved from any IPFS node that has it.

### Core implementation pattern

```typescript
import { PinataSDK } from "pinata";

interface EvidenceRecord {
  cid: string;
  iv: string;
  contentHash: string;
  timestamp: number;
}

class WitnessProtocol {
  private pinata: PinataSDK;
  
  async uploadEvidence(file: File): Promise<EvidenceRecord> {
    // 1. Generate encryption key
    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
    );
    
    // 2. Encrypt with fresh IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, await file.arrayBuffer()
    );
    
    // 3. Upload encrypted blob
    const upload = await this.pinata.upload.file(
      new File([encrypted], `evidence_${Date.now()}.enc`)
    );
    
    // 4. Return metadata for on-chain storage
    return {
      cid: upload.IpfsHash,
      iv: btoa(String.fromCharCode(...iv)),
      contentHash: await this.sha256(await file.arrayBuffer()),
      timestamp: Date.now()
    };
  }
}
```

### Key packages and versions

| Package | Version | Purpose |
|---------|---------|---------|
| `pinata` | latest | IPFS pinning with TypeScript types |
| Web Crypto API | native | AES-256-GCM encryption |
| `tweetnacl` | ^1.0.3 | Key exchange for trusted contacts |

---

## Backup recommendation: Matrix Protocol

If **real-time sync and chat-like features** become essential during development, Matrix provides a battle-tested alternative with built-in encryption.

### When to pivot to Matrix

Switch to Matrix if you discover the app needs **bidirectional communication** between witness and contacts, such as live status updates, acknowledgment messages, or emergency chat during incidents. Matrix's room-based model handles this elegantly.

### Matrix implementation highlights

The encryption model differs from IPFS: media files use **AES-256-CTR** encryption (separate from Megolm room encryption), with the SDK handling key management through IndexedDB.

```typescript
import * as sdk from "matrix-js-sdk";
import { encryptAttachment } from "matrix-encrypt-attachment";

// Encrypt and upload media
const encrypted = await encryptAttachment(await file.arrayBuffer());
const upload = await client.uploadContent(new Blob([encrypted.data]));

// Send encrypted message with file metadata
await client.sendMessage(roomId, {
  msgtype: "m.video",
  body: filename,
  file: {
    url: upload.content_uri,
    key: encrypted.info.key,  // JWK format
    iv: encrypted.info.iv,
    hashes: encrypted.info.hashes,
    v: "v2"
  }
});
```

### Matrix limitations for hackathon

**Historical access complexity**: New room members don't automatically receive old Megolm session keys. Key forwarding requires explicit implementation — problematic if witnesses are added after evidence upload.

**50MB default limit**: Synapse homeservers cap uploads at 50MB by default. Longer video recordings need chunking or a custom homeserver configuration.

---

## Detailed analysis by option

### IPFS (Pinata): The decentralized winner

**Encryption approach**: IPFS provides no content encryption — you must encrypt before upload. The recommended pattern uses **AES-256-GCM** via the Web Crypto API, generating a fresh 12-byte IV for each file. This provides both confidentiality and authentication (detecting tampering).

**The pinning requirement**: Without pinning, IPFS content is garbage-collected when nodes clear cache. For evidence integrity, always use a pinning service. Pinata offers **1GB free** (sufficient for ~20 two-minute videos), dedicated gateways for fast retrieval, and excellent TypeScript types.

**Retrieval performance**: Pinned content on dedicated gateways retrieves in **50-500ms**. Public gateways like `ipfs.io` can take 15-60 seconds for cold fetches — avoid these for demos.

**Deduplication caveat**: Encrypting with unique IVs (required for security) means identical files produce different CIDs. Accept this tradeoff; security matters more than storage efficiency for evidence.

### Matrix Protocol: The real-time alternative

**Megolm encryption mechanics**: Matrix uses a sophisticated two-layer system. Room messages are encrypted with Megolm (group ratchet), while media files get **separate AES-CTR encryption**. The file encryption key travels inside the Megolm-encrypted message.

**Key storage in browsers**: Encryption keys live in IndexedDB, typically under `matrix-js-sdk:crypto`. If users clear browser storage, **keys are permanently lost** — historical messages become undecryptable. For a safety app, consider deriving keys from wallet signatures for recovery.

**Room permission model**: Create invite-only encrypted rooms with `history_visibility: "shared"` to allow retroactive access. Power levels control who can invite, kick, or admin the evidence room.

```typescript
const room = await client.createRoom({
  visibility: "private",
  preset: "private_chat",
  initial_state: [
    { type: "m.room.encryption", content: { algorithm: "m.megolm.v1.aes-sha2" }},
    { type: "m.room.history_visibility", content: { history_visibility: "shared" }}
  ],
  invite: ["@trusted_contact:matrix.org"]
});
```

### Nostr + Blossom: The emerging contender

**Protocol fundamentals**: Nostr uses cryptographic keypairs (secp256k1, same as Ethereum) for identity. Events are JSON objects signed with private keys, stored on multiple independent relay servers. No accounts, no central authority.

**Media via Blossom**: NIP-96 is deprecated — use **Blossom** for media storage. Files are addressed by SHA-256 hash, uploaded to Blossom servers, with metadata published as kind:1063 events. The hash-based model mirrors IPFS's content addressing.

**Encryption for private sharing**: NIP-44 provides modern ChaCha20 encryption with HKDF key derivation. However, NIP-44 targets text payloads. For media, encrypt the file with AES-GCM, then share the symmetric key via NIP-44 encrypted DM.

**Implementation complexity**: Nostr requires managing relay connections (use 3-5 for redundancy), Blossom server selection, and two encryption layers. Achievable but adds **4-6 hours** versus IPFS+Pinata.

```typescript
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';

// Create file metadata event
const fileEvent = finalizeEvent({
  kind: 1063,
  tags: [
    ['url', 'https://blossom.primal.net/<sha256>.mp4'],
    ['x', '<sha256>'],
    ['m', 'video/mp4']
  ],
  content: 'Witness evidence recording'
}, secretKey);
```

### Gun.js: Promising but problematic for media

**Real-time sync excellence**: Gun's CRDT-based HAM algorithm delivers sub-200ms sync between peers. For small data (JSON, metadata), it's impressively fast and offline-first.

**The media problem**: Gun works best with small JSON objects. Binary data requires Base64 encoding (+33% size), and browser localStorage caps at 5MB. Large videos need custom chunking to ~2MB segments, encrypting each separately. This adds significant complexity.

**SEA encryption capabilities**: Gun's SEA module provides ECDH key exchange and AES-GCM encryption. You can encrypt data for specific users by deriving shared secrets from their public keys.

**Verdict**: Use Gun for metadata and real-time presence, but **store actual media elsewhere** (IPFS, S3). The hybrid adds complexity that may not fit a 3-day timeline.

### WebRTC Direct: Real-time with a critical flaw

**Streaming capability**: WebRTC enables direct P2P video streaming to trusted contacts. Using PeerJS, you can have a working video call in ~50 lines of code. Encryption is mandatory per spec (DTLS-SRTP).

**The offline contacts problem**: WebRTC requires both peers online simultaneously. For a safety app, witnesses may trigger recording when contacts are asleep or unreachable. **This is a dealbreaker without fallback storage.**

**Recommended hybrid**: Use WebRTC for live streaming when contacts are online, with automatic IPFS fallback when they're not.

```typescript
// PeerJS for simplified WebRTC
import { Peer } from 'peerjs';

const peer = new Peer(userId, {
  host: '0.peerjs.com',
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  }
});

// Stream to contact
const call = peer.call(contactId, localMediaStream);
```

### Simple Backend (S3/MinIO): Fastest to build

**Implementation speed**: A working presigned-URL upload flow takes **~50 lines of code** and 2-3 hours. MinIO runs with a single Docker command; AWS S3 setup takes 15-30 minutes with free tier.

**Centralization tradeoff**: A single storage provider creates a point of failure and potential censorship vector. For a safety app, this is significant — but E2E encryption means the provider only sees ciphertext. Store the hash on Ethereum for proof-of-existence.

**When to choose this**: If decentralization isn't a hackathon judging criterion and you need maximum development speed, S3/MinIO lets you focus on UX and smart contracts instead of storage infrastructure.

---

## Implementation roadmap for 3-day hackathon

### Day 1: Core infrastructure (8 hours)

**Morning (4 hrs)**:
- Set up Pinata account and generate JWT
- Implement encryption utilities (AES-GCM with Web Crypto)
- Create basic upload flow with progress indicator

**Afternoon (4 hrs)**:
- Smart contract for evidence registry (CID + timestamp + hash)
- Key derivation from wallet signature (for recovery)
- Basic UI: record button, status display

### Day 2: Evidence sharing (8 hours)

**Morning (4 hrs)**:
- Trusted contacts management (on-chain or local)
- Key exchange with tweetnacl for sharing encryption keys
- Download and decrypt flow

**Afternoon (4 hrs)**:
- Push notifications or polling for new evidence
- Evidence verification (compare content hash with on-chain)
- Mobile-responsive UI

### Day 3: Polish and demo (6 hours)

**Morning (3 hrs)**:
- Emergency quick-record mode (one-tap capture)
- Error handling and retry logic
- Testing across browsers

**Afternoon (3 hrs)**:
- Demo preparation
- Edge case fixes
- Documentation

---

## Sample project structure

```
witness-protocol/
├── contracts/
│   └── WitnessRegistry.sol      # Evidence hash storage
├── src/
│   ├── lib/
│   │   ├── encryption.ts        # AES-GCM encrypt/decrypt
│   │   ├── keyExchange.ts       # tweetnacl box for sharing
│   │   ├── ipfs.ts              # Pinata SDK wrapper
│   │   └── ethereum.ts          # Contract interactions
│   ├── components/
│   │   ├── RecordButton.tsx
│   │   ├── EvidenceList.tsx
│   │   └── TrustedContacts.tsx
│   └── App.tsx
├── package.json
└── .env.local                   # PINATA_JWT, etc.
```

---

## Key technical gotchas

**Fresh IV every encryption**: AES-GCM security depends on never reusing an IV with the same key. Generate with `crypto.getRandomValues(new Uint8Array(12))` for each file.

**Large file chunking**: Browser memory limits mean files over ~100MB should be chunked. Process in 50MB segments, encrypting and uploading each separately.

**Key loss is permanent**: With client-side encryption, there's no password reset. Derive keys from wallet signatures (`signMessage`) for deterministic recovery.

**CORS on gateways**: Public IPFS gateways may lack CORS headers. Use Pinata's dedicated gateway or configure CORS on your own gateway.

**Matrix authenticated media**: Matrix 1.11+ requires auth headers for media downloads. Ensure your SDK version handles this automatically.

---

## Library reference

| Technology | Primary Package | Version | Documentation |
|------------|-----------------|---------|---------------|
| IPFS | `pinata` | latest | docs.pinata.cloud |
| Matrix | `matrix-js-sdk` | ^39.4.0 | matrix-org.github.io/matrix-js-sdk |
| Matrix Encryption | `matrix-encrypt-attachment` | ^1.0.3 | github.com/matrix-org/matrix-encrypt-attachment |
| Nostr | `nostr-tools` | latest | github.com/nbd-wtf/nostr-tools |
| Gun.js | `gun` | ^0.2020.1241 | gun.eco/docs |
| WebRTC | `peerjs` | ^1.5.5 | peerjs.com |
| S3 | `@aws-sdk/client-s3` | ^3.969.0 | docs.aws.amazon.com |
| Encryption | Web Crypto API | native | developer.mozilla.org |
| Key Exchange | `tweetnacl` | ^1.0.3 | github.com/dchest/tweetnacl-js |

---

## Final verdict

**Primary choice**: IPFS with Pinata SDK provides the fastest path to a working, decentralized, encrypted evidence storage system. The content-addressed model integrates naturally with Ethereum, and the TypeScript SDK eliminates infrastructure complexity.

**Backup if real-time needed**: Matrix Protocol offers superior real-time capabilities with built-in encryption, at the cost of additional complexity around key management and historical access.

**Avoid for this hackathon**: Gun.js (media handling too complex) and WebRTC alone (offline contacts problem). Consider S3/MinIO only if decentralization isn't judged.

The IPFS architecture can be built in **8-12 focused hours**, leaving ample time for smart contract development, UI polish, and demo preparation within your 3-day window.