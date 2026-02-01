# Technical Decisions & Limitations

This document describes the architectural tradeoffs made for the hackathon prototype, known limitations, and the roadmap for production-grade implementation.

---

## Core Innovation

**"Evidence that can't be deleted, verified by people who can't be identified."**

Witness Protocol combines three technologies in a novel way:

1. **Decentralized Storage** (IPFS) — Content can't be deleted by seizing a single server
2. **On-Chain Anchoring** (Base Sepolia) — Merkle roots prove content existed at a specific time
3. **Anonymous Attestations** (Semaphore V4) — Group members can vouch for evidence without revealing their identity

The two-layer privacy model separates **access control** (who can decrypt) from **attestations** (who verified). This allows public proof that "N people verified this content" while keeping attestor identities completely private.

---

## What's Cryptographically Sound

Even as a PWA prototype, these guarantees are production-grade:

| Component | Implementation | Security Level |
|-----------|----------------|----------------|
| Content hashing | SHA-256 via Web Crypto API | Full |
| Encryption | AES-256-GCM with random IVs | Full |
| Key derivation | HKDF from wallet signature | Full |
| Merkle tree integrity | SHA-256 composite leaves | Full |
| IPFS content addressing | CID = hash of content | Full |
| On-chain timestamps | Base Sepolia block timestamps | Full |
| Anonymous attestations | Semaphore V4 ZK proofs | Full |
| Double-attestation prevention | Nullifier uniqueness | Full |

**The math is correct.** The cryptographic pipeline would pass a security audit.

---

## Hackathon Tradeoffs

### 1. PWA vs Native App

**Decision**: Build a Progressive Web App instead of React Native/Expo.

**Rationale**: Faster iteration, no app store approval, works on any device with a browser.

**What we lose**:

| Capability | PWA Limitation | Production Fix |
|------------|----------------|----------------|
| Hardware-backed keys | Web Crypto keys are software-only, extractable via JS | React Native + react-native-keychain (Secure Enclave/StrongBox) |
| Device attestation | Can't prove "real, unrooted device" | Play Integrity API (Android) / App Attest (iOS) |
| C2PA manifests | Self-signed only, won't pass Trust List | c2pa-ios / c2pa-android SDKs with CA certificates |
| Background recording | Tab throttling kills recording if backgrounded | Foreground service (Android), AVCaptureSession (iOS) |
| Reliable local storage | IndexedDB can be evicted by browser | expo-file-system + IOCipher |

**Honest framing**: The cryptographic pipeline is production-grade. What's missing is *device attestation* — proving THIS video came from THIS camera on THIS uncompromised device.

**Metadata honesty**: GPS, timestamps, and device info are captured but marked `verified: false` in manifests because a PWA cannot verify these values aren't spoofed.

---

### 2. No Real-Time Coordination Layer

**Decision**: Use blockchain + IPFS for coordination instead of Matrix.

**Original vision**:
- Self-hosted Matrix server with E2EE rooms per trust circle
- Real-time push notifications when evidence uploads
- Automatic key distribution via Matrix's key management
- Presence awareness (who's online, who's seen what)

**What was built**:
- On-chain events for content discovery (requires polling/refresh)
- QR codes for one-time, in-person key exchange
- No push notifications

**What this means**:
- Trusted contacts must manually refresh to see new content
- No "evidence appearing in real-time on her phone" without polling
- Key exchange requires physical proximity (scan QR)

**Post-hackathon direction**: Integrate Matrix or a lightweight pubsub layer (libp2p, Waku) for real-time coordination while keeping the blockchain as the source of truth.

---

### 3. No zkDID Integration

**Decision**: Attestations prove group membership only, not attestor credentials.

**Original vision**:
- Attestors could prove attributes via zero-knowledge proofs
- "Verified by a licensed journalist" without revealing *which* journalist
- "5 attestations from verified humans" with Worldcoin/Polygon ID
- Selective disclosure: reveal credential category, hide identity

**What was built**:
- Semaphore proves "someone in this group" (Sybil-resistant, unlinkable)
- All attestors are equal — no credential weighting
- Can't distinguish "my lawyer attested" from "my neighbor attested"

**What this means for credibility**:
- Attestation count is meaningful (real people, can't double-attest)
- Attestation *weight* is uniform
- Courts/investigators can't evaluate attestor qualifications

**Post-hackathon direction**: Compose Semaphore with Polygon ID, Sismo, or professional credential systems to add attestor qualification proofs.

---

### 4. Testnet Only

**Decision**: Deploy to Base Sepolia with Pimlico sponsorship.

**Rationale**: Gasless UX is critical for non-crypto users. Pimlico's testnet sponsorship enables this without cost.

**Limitations**:
- Base Sepolia is a testnet — could be reset, has no real value
- Pimlico testnet sponsorship has rate limits
- Smart contract not audited for production

**Production path**:
- Mainnet deployment on Base (low gas fees)
- Pimlico production paymaster with sponsorship policy
- Smart contract audit
- Consider L3 or app-specific rollup for lower costs at scale

---

### 5. Download-All Playback

**Decision**: Download all chunks, concatenate, then play.

**Rationale**: Simplest implementation, reliable across browsers.

**Limitations**:
- Long videos require downloading entire file before playback starts
- Memory pressure on mobile devices for large files
- No seek-before-download

**Production path**: Implement MSE (Media Source Extensions) for progressive playback — decrypt and feed chunks to video element as they download.

---

### 6. iOS Safari Constraints

**Known issues**:
- MediaRecorder only supports `video/mp4` (not WebM)
- WebM files can't be saved to Photos app (only Files)
- PWA updates require deleting and re-adding home screen app
- Service worker caching behavior differs from Chrome

**Mitigations in place**:
- Format detection with fallback to MP4
- Service worker configured with no-cache for sw.js
- Documentation warns users about PWA update behavior

**Production path**: Native iOS app eliminates all Safari-specific constraints.

---

## Security Model

### What We Can Prove

| Claim | Proof Mechanism | Confidence |
|-------|-----------------|------------|
| Content existed at time T | On-chain timestamp + Merkle root | High |
| Content hasn't been modified | Hash verification against on-chain root | High |
| N people verified this content | Attestation count on-chain | High |
| Attestors are real group members | Semaphore ZK proof | High |
| Same person can't attest twice | Nullifier uniqueness | High |
| Content is encrypted for specific groups | Key wrapping with group secrets | High |

### What We Cannot Prove (PWA)

| Claim | Why Not | Production Fix |
|-------|---------|----------------|
| Video came from this camera | No hardware attestation | Play Integrity / App Attest |
| GPS coordinates are accurate | Browser API is spoofable | Hardware-attested location signals |
| Timestamp is accurate | Device clock can be manipulated | Trusted timestamping (RFC 3161) |
| Device wasn't rooted/jailbroken | No integrity check | MEETS_STRONG_INTEGRITY requirement |
| Signing keys weren't extracted | Software keys in IndexedDB | Secure Enclave / StrongBox |

### Threat Model Acknowledgment

**Threats we mitigate**:
- Evidence deletion after upload (IPFS + on-chain = no single point of failure)
- Attestor identification (Semaphore ZK proofs)
- Evidence tampering post-upload (Merkle root verification)
- Replay attacks (nullifiers prevent double-attestation)

**Threats we don't mitigate (in PWA)**:
- Sophisticated user uploading pre-recorded/fabricated content
- GPS/timestamp spoofing before capture
- Compromised device with extracted keys
- Adversary with physical access to device

---

## Post-Hackathon Roadmap

### Phase 1: Native App Foundation
- React Native / Expo implementation
- Hardware-backed key storage (react-native-keychain)
- Play Integrity / App Attest integration
- Background recording with foreground service

### Phase 2: Enhanced Provenance
- C2PA manifest generation with hardware-backed signatures
- OpenTimestamps integration for Bitcoin anchoring
- RFC 3161 qualified timestamps for EU compliance
- ProofMode-style metadata bundles

### Phase 3: Real-Time Coordination
- Matrix or Waku integration for push notifications
- Real-time evidence streaming to trusted contacts
- Presence and read receipts
- Multi-device key synchronization

### Phase 4: Credential Layer
- zkDID integration (Polygon ID, Sismo, Worldcoin)
- Attestor credential proofs
- Professional verification tiers (journalist, lawyer, NGO)
- Selective disclosure for court submissions

### Phase 5: Production Hardening
- Mainnet deployment with audited contracts
- Paymaster sponsorship policies
- Rate limiting and abuse prevention
- Legal partnership for affidavit generation (eyeWitness model)

---

## Prior Art Positioning

| Tool | Strength | Our Differentiation |
|------|----------|---------------------|
| eyeWitness to Atrocities | Court-tested, legal affidavits | Decentralized (no central authority) |
| ProofMode | Open source, C2PA, Bitcoin timestamps | Anonymous attestations (web of trust) |
| Truepic | Enterprise-grade, 35 authenticity tests | Gasless UX, no subscription fee |
| Starling Lab | ICC submissions, IPFS + Filecoin | Real-time group sharing |

**Our unique contribution**: Combining decentralized storage (IPFS), on-chain anchoring (EVM), and anonymous attestations (Semaphore) into a single system with gasless UX. No existing tool provides all three.

---

## Conclusion

Witness Protocol demonstrates a viable architecture for privacy-preserving evidence capture. The cryptographic foundations are sound. The hackathon tradeoffs are deliberate and documented. The roadmap to production is clear.

**What works today**:
- Capture → Encrypt → Upload → Anchor → Attest pipeline
- Gasless UX (no crypto knowledge required)
- Anonymous attestations (public count, private identity)
- Group-based access control

**What needs production investment**:
- Native app for hardware attestation
- Real-time coordination layer
- Credential-weighted attestations
- Legal partnership for court admissibility

The core insight remains: **Evidence is only as credible as the witnesses who can vouch for it.** Witness Protocol lets trusted contacts verify evidence while protecting their identities — a novel combination that addresses real needs for journalists, activists, and abuse survivors.
