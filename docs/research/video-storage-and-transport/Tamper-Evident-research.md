# Building tamper-evident video capture for the Witness Protocol

**Cryptographic proof of video authenticity is achievable today using a combination of C2PA manifests, hardware-backed signing, and blockchain timestamping—but requires native code for core security guarantees.** A pure PWA cannot access Secure Enclave or Android Keystore, making a React Native/Expo hybrid architecture essential for your IPFS-chunked video capture system. The legal landscape has matured significantly: FRE 902(13)/(14) now allows self-authenticating electronic records with hash verification, the ICC accepts cryptographically-authenticated evidence, and recent C2PA adoption by Google Pixel 10, Sony cameras, and Cloudflare has created real infrastructure for content provenance.

## C2PA is the emerging standard for video provenance

The Coalition for Content Provenance and Authenticity specification has reached critical mass in 2024-2025. The **c2pa-rs** Rust library (v0.45.2+) serves as the reference implementation, with official mobile SDKs available: **c2pa-android** provides StrongBox TEE integration for hardware-backed signing, while **c2pa-ios** offers Secure Enclave support. For rapid prototyping, Guardian Project's **Simple C2PA** library wraps c2pa-rs via Mozilla UniFFI, enabling self-signed certificate workflows without requiring a Certificate Authority relationship.

C2PA manifests embed in MP4 containers via a UUID box (identifier `D8FEC3D6-1B0E-483C-9297-5828877EC481`) placed after the FTYP box but before MDAT and MOOV boxes. The manifest contains JUMBF-formatted assertions including `c2pa.hash.bmff.v3` for video-specific SHA-256 hashes of content byte ranges. For your 10-second IPFS chunk architecture, **fragmented MP4 (fMP4) support** uses Merkle tree hashing—each chunk has a corresponding entry in a `hashes` array, enabling per-segment validation while maintaining cryptographic continuity.

The cryptographic requirements include COSE signatures (RFC 8152) with ES256 (P-256 ECDSA) as the recommended algorithm, X.509 certificates with `digitalSignature` Key Usage, and RFC 3161 timestamp authority integration for proving signature existence at specific times. Self-signed certificates work for development but won't pass C2PA Trust List validation—starting 2026, conforming products must use certificates from approved Certificate Authorities.

## The Nikon Z6 III vulnerability reveals C2PA's limits

In September 2025, researcher Adam Horshack discovered that Nikon's C2PA-enabled Z6 III could sign images containing unsigned content through its Multiple Exposure mode. An attacker could use an unsigned RAW image from a non-C2PA camera as an input, producing a final image that passes Content Authenticity verification despite containing unauthenticated content. This "soft target" vulnerability left the cryptographic mechanism intact but rendered it meaningless for that image.

**Metadata stripping remains the critical challenge**: approximately 95% of images lose their C2PA manifests when uploaded to social platforms. Mitigations include soft bindings (perceptual hashes, invisible watermarks) and external manifest repositories with unique identifier recovery. The World Privacy Forum's 2024 review also identified risks including account breach exploitation (malicious actors publishing credentialed fakes through compromised legitimate accounts) and AI training exploitation (adversaries training generative AI on C2PA-verified content to create convincing fakes).

For the Witness Protocol, uploading encrypted chunks to IPFS actually provides a significant advantage: the content-addressed nature of IPFS means you control the full provenance chain without platform interference.

## Hardware attestation proves device legitimacy but has bypass limitations

**Google Play Integrity API** (which replaced SafetyNet in May 2025) returns device integrity verdicts: `MEETS_BASIC_INTEGRITY` allows unrecognized Android devices, `MEETS_DEVICE_INTEGRITY` confirms genuine Play Protect certified devices, and `MEETS_STRONG_INTEGRITY` requires hardware-backed security signals plus recent security patches. The API also provides `appAccessRiskVerdict` to detect screen capture apps and `recentDeviceActivity` to identify potential bots.

**Apple App Attest** uses the Secure Enclave to generate hardware-backed key pairs, providing attestation that the app is running on a genuine device. The flow involves generating a key with `DCAppAttestService.shared.generateKey()`, then attesting it against a server challenge—the resulting CBOR-encoded attestation contains an X.509 certificate chain traceable to Apple's root.

However, determined attackers can bypass basic integrity checks. The current bypass stack includes ZygiskNext, Shamiko for root concealment, PlayIntegrityFix with leaked device fingerprints, and TrickyStore for keybox management. **`MEETS_STRONG_INTEGRITY` remains the hardest to bypass** and should be your minimum requirement for evidence applications.

Truepic's "35 authenticity tests" approach adds detection layers: reverse image search (detects pre-existing content), picture-of-picture detection (Moiré patterns, screen bezels), geofencing, and AI/synthetic content filtering. Their Qualcomm partnership embeds Controlled Capture in the Snapdragon 865's Trusted Execution Environment.

## ProofMode's sidecar architecture offers a proven field-tested approach

Guardian Project's ProofMode generates proof bundles as ZIP archives containing multiple companion files named using the SHA256 hash of the original media:

- **`.proof.csv` / `.proof.json`**: Sensor metadata snapshot (GPS, cell towers, WiFi BSSIDs, accelerometer, device info)
- **`.asc`**: RSA 4096-bit OpenPGP signature of media file
- **`.ots`**: OpenTimestamps Bitcoin blockchain proof
- **`.gst`**: Google SafetyNet attestation JWT (verifies device wasn't rooted/tampered)

This sidecar approach never modifies original media files—all proof data remains separate. ProofMode-authenticated evidence has been submitted to the ICC via Starling Lab's Project Dokaz, documenting attacks on Ukrainian schools in March 2022. The UN Human Rights Council cited their methodology as "emerging good practice."

Haven (the Edward Snowden collaboration) demonstrates secure notification architecture: it uses **libsignal-service-java directly**—not the Signal app—for encrypted notifications with media attachments. This means you can integrate Signal protocol encryption without requiring users to have Signal installed. NetCipher provides hardened TLS with Tor proxy support, while IOCipher creates virtual encrypted filesystems using SQLCipher.

## OpenTimestamps provides trustless Bitcoin timestamping

OpenTimestamps creates verifiable proofs by anchoring SHA256 hashes to the Bitcoin blockchain via Merkle tree aggregation. Calendar servers (alice.btc.calendar.opentimestamps.org, bob.btc.calendar.opentimestamps.org, finney.calendar.eternitywall.com) aggregate thousands of timestamps into single transactions—the Internet Archive timestamped ~750 million files with a single transaction, demonstrating unlimited scalability.

The `.ots` proof file contains three sections: the original file hash, commitment operations representing Merkle tree traversal, and either a `PendingAttestation` (calendar URL) or `BitcoinBlockHeaderAttestation` (complete, independently verifiable). Verification requires only the original document, the .ots file, and access to Bitcoin block headers.

**Legal recognition has advanced significantly**:
- **Vermont H.B. 868** (2016): Blockchain records are self-authenticating under Vermont Rule of Evidence 902, creating a rebuttable presumption of authenticity
- **Arizona HB 2417** (2017): Signatures secured through blockchain are valid electronic signatures; smart contracts given legal effect
- **China's Hangzhou Internet Court** (2018): First Chinese court to accept blockchain evidence; Supreme People's Court provisions now officially permit blockchain authentication
- **EU eIDAS**: Qualified timestamps enjoy legal presumption, though OpenTimestamps alone isn't "qualified" under current regulations—hybrid approaches combining OTS with RFC 3161 qualified timestamps provide maximum legal coverage

For your 10-second chunk architecture, timestamp each chunk's hash immediately upon capture, then batch-upgrade pending attestations after Bitcoin confirmation (~1 hour).

## A pure PWA cannot meet security requirements

**Critical limitation**: PWAs cannot access iOS Secure Enclave, Android Keystore, or hardware attestation APIs. Web Crypto API keys are always software keys—extractable by JavaScript and not bound to device hardware. WebAuthn provides some device attestation during credential registration, but synced passkeys (Apple/Google) no longer provide attestation statements, and you cannot sign arbitrary data with hardware-backed keys from browsers.

Additional PWA limitations for video evidence:
- MediaRecorder gaps when tab is backgrounded (Chrome throttles rendering)
- No reliable background recording
- IndexedDB storage can be evicted by browsers under pressure
- iOS Safari can delete data after 7 days of inactivity (unless home screen PWA)

**Native code is required for**:
| Capability | iOS Implementation | Android Implementation |
|------------|-------------------|----------------------|
| Hardware-backed keys | SecureEnclave.P256 via CryptoKit | Android Keystore with StrongBox |
| Device attestation | DCAppAttestService | Play Integrity API |
| C2PA signing | c2pa-ios SDK | c2pa-android SDK |
| Background recording | AVCaptureSession | Camera2 + foreground service |
| Biometric key protection | LAContext | BiometricPrompt |

For React Native/Expo, **react-native-keychain** provides direct Keychain/Keystore access with biometric authentication—used by production apps including MetaMask Mobile and Rainbow Wallet. **react-native-biometrics** generates RSA key pairs in Secure Enclave/Keystore for signing arbitrary payloads with biometric-protected keys.

## Legal admissibility centers on chain of custody documentation

**FRE 901(a)** requires producing "evidence sufficient to support a finding that the item is what the proponent claims it is." For digital evidence, FRE 901(b)(9) covers processes or systems that produce accurate results.

**FRE 902(13) and 902(14)** (effective December 2017) enable self-authentication:
- 902(13): Records generated by electronic processes producing accurate results, certified by a "qualified person"
- 902(14): Data authenticated by "process of digital identification"—specifically hash value verification

These rules mean cryptographically-verified video can be self-authenticating without requiring live witness testimony about the recording process.

**ICC's three-part test** requires relevance, probative value (reliability + significance), and absence of prejudicial effect. For video evidence, this means proving origin and integrity (not digitally altered), attaching metadata to submissions, and documenting chain of custody. The ICC created a Digital Forensics Team in 2013 and launched OTPLink in 2023 for online evidence submission.

**eyeWitness to Atrocities** (International Bar Association) provides the only system specifically designed by legal professionals for court admissibility. Their three-pillar system covers controlled capture (automatic metadata embedding), chain of custody (encryption, secure transmission, verified access records), and legal processing (lawyers tag and catalog evidence for tribunal submission). Over 10+ years they've captured **85,000+ photos/videos** and submitted **80+ dossiers** to investigative bodies, with evidence used in four Ukrainian court cases.

## Recommended architecture for Witness Protocol

```
┌─────────────────────────────────────────────────────────────┐
│                     Witness Protocol App                     │
│                   (React Native / Expo)                      │
├─────────────────────────────────────────────────────────────┤
│  Capture Layer                                               │
│  ├── expo-camera with hardware-backed session               │
│  ├── 10-second chunk generation (fMP4 format)               │
│  └── Immediate SHA256 hashing via expo-crypto               │
├─────────────────────────────────────────────────────────────┤
│  Attestation Layer (Native Modules)                          │
│  ├── Play Integrity / App Attest verification               │
│  ├── react-native-keychain for Secure Enclave keys          │
│  └── Device/environment validation                          │
├─────────────────────────────────────────────────────────────┤
│  Evidence Layer                                              │
│  ├── C2PA manifest per chunk (c2pa-android/ios SDK)         │
│  ├── Hardware-backed ECDSA P-256 signing                    │
│  ├── ProofMode-style metadata (.csv + .json)                │
│  └── OpenTimestamps submission to calendar servers          │
├─────────────────────────────────────────────────────────────┤
│  Storage/Upload Layer                                        │
│  ├── IOCipher encrypted local storage (SQLCipher-based)     │
│  ├── AES-256-GCM encryption of chunks before upload         │
│  ├── IPFS upload via HTTP gateway or Helia                  │
│  └── Manifest linking chunk CIDs with provenance data       │
└─────────────────────────────────────────────────────────────┘
```

### Implementation sequence for each 10-second chunk

1. **Capture**: Record video segment, generate fMP4 chunk
2. **Hash**: Compute SHA256 of chunk immediately
3. **Metadata**: Capture GPS, cell towers, WiFi BSSIDs, accelerometer, timestamp
4. **Attest**: Include Play Integrity/App Attest token in metadata
5. **Sign**: Create C2PA manifest with hardware-backed key (Secure Enclave/StrongBox)
6. **Timestamp**: Submit hash to OpenTimestamps calendar servers
7. **Encrypt**: AES-256-GCM encryption with key derived from user credentials
8. **Upload**: Push encrypted chunk to IPFS, record CID
9. **Index**: Create manifest linking CID → chunk hash → C2PA manifest → OTS proof

### Key design decisions

**Use fMP4 with Merkle tree hashing** rather than standard MP4—this enables per-chunk validation while maintaining cryptographic continuity across the full recording session.

**Generate self-signed certificates initially** via Guardian Project's Simple C2PA for rapid deployment, then pursue C2PA Conformance Program certification (required for Trust List inclusion by 2026) as the product matures.

**Implement hybrid timestamping**: OpenTimestamps for trustless Bitcoin anchoring plus an RFC 3161 timestamp authority for EU eIDAS qualification if regulatory compliance becomes necessary.

**Store proof bundles alongside encrypted chunks on IPFS**: Each chunk CID should have an associated manifest CID containing the C2PA manifest, ProofMode-style metadata CSV, OpenTimestamps proof, and device attestation token.

**Require `MEETS_STRONG_INTEGRITY` (Android) / App Attest validation (iOS)** as the minimum device security threshold for evidence capture, with graceful degradation messaging for users on non-compliant devices.

## Recent developments favor this architecture

The Google Pixel 10 (September 2025) became the first smartphone with native C2PA support at Assurance Level 2 (highest), using hardware-backed keys in the Titan M2 chip with on-device trusted timestamps that work offline. Samsung Galaxy S25 (February 2025) added native C2PA support. Sony launched video C2PA for professional camcorders in October 2024, with the PXW-Z300 becoming the first video camera with Content Credentials.

Cloudflare's February 2025 implementation means ~20% of web traffic now preserves Content Credentials through delivery. The EU AI Act Article 50 (effective August 2026) will require AI-generated audio/video/images to be machine-readable and detectable, creating regulatory pressure for provenance infrastructure.

For the Witness Protocol's specific use case—encrypted video chunks uploaded to IPFS every 10 seconds—this architecture provides cryptographic proof from capture through storage, with verification possible using only the content itself, the associated proof bundles, and public blockchain data. The evidence would meet FRE 902(13)/(14) self-authentication requirements and align with ICC authentication standards for digital evidence submission.