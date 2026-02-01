# Prior Art Analysis: Witness Protocol Evidence Preservation

A decade of innovation in evidence capture apps reveals clear patterns for building the next generation of secure documentation tools. **The core challenge isn't cryptographic—it's solved—but rather combining decentralized trust with legal admissibility while keeping tools simple enough for crisis moments.** Existing solutions split between proprietary systems with court-tested credentials (eyeWitness to Atrocities) and open-source tools with superior architecture but unproven legal standing (ProofMode). A blockchain-integrated approach can bridge this gap by combining ProofMode's technical elegance with eyeWitness's legal rigor.

## eyeWitness to Atrocities sets the legal benchmark

eyeWitness represents the gold standard for court-admissible evidence capture, developed through **four years of R&D** consulting with ICC lawyers and achieving landmark convictions. The app has processed **90,000+ photos/videos** used in **95+ legal dossiers**, including the first-ever conviction using app-captured evidence (DRC, 2018) and four Ukrainian court cases (2022-2024).

The technical approach prioritizes legal defensibility over transparency. Evidence flows through a controlled pipeline: capture with multi-source location verification (GPS + WiFi triangulation + cell towers), hash generation for tamper detection, upload to LexisNexis-hosted servers, and professional legal review before court submission. Metadata capture is deliberately selective—altitude is excluded because mobile devices are unreliable altimeters, and inconsistent metadata gives opposing counsel grounds to challenge evidence integrity.

Critical design decisions include:

- **No external imports**: Users cannot upload photos from other cameras because eyeWitness cannot verify their provenance
- **Upload before export**: Users must submit to eyeWitness servers before accessing their own copies, preventing chain of custody breaks
- **Closed source by design**: Legal experts argue code adaptation without legal vetting could undermine evidentiary value
- **Professional affidavits**: eyeWitness issues authenticity affidavits on request—a service no open-source tool provides

**Key limitation**: The system is entirely centralized, depending on the eyeWitness organization and LexisNexis infrastructure. User reviews note capture takes **1-2 seconds longer** than native cameras—potentially dangerous in crisis situations.

## ProofMode demonstrates the open-source alternative

ProofMode evolved from the complex InformaCam/CameraV system (2013) through 10+ years of iterative development into a lightweight, invisible utility. The app runs as a background service, automatically signing all device photos with **zero setup required**. It's the only mature open-source tool with full **C2PA (Content Credentials) integration** as of 2024.

The architecture uses sidecar proof files rather than modifying originals—a crucial design decision enabling selective sharing and preserving forensic integrity:

```
proof-bundle.zip/
├── [MEDIAFILE].jpg              # Original unmodified
├── [SHA256HASH].csv             # Metadata (GPS, sensors, device info)
├── [SHA256HASH].asc             # OpenPGP signature (RSA 4096-bit)
├── [SHA256HASH].ots             # OpenTimestamps Bitcoin proof
├── [SHA256HASH].gst             # Google SafetyNet attestation (JWT)
└── pubkey.asc                   # Verification key
```

The verification model layers multiple attestation types: **integrity** (SHA-256 hash matching), **identity** (PGP signature), and **notarization** (blockchain timestamp + device attestation). The Simple C2PA Library wraps Adobe's c2pa-rs Rust SDK via UniFFI for mobile, enabling Content Credentials on Android and iOS.

**Critical caveat**: ProofMode explicitly states its "chain-of-custody has not yet been tested in court." Self-signed certificates appear as "unknown source" in C2PA verification. The tool solves the cryptographic problem but not the institutional trust problem.

## C2PA standard and Truepic reveal commercial approaches

Truepic's commercial solution demonstrates enterprise-grade evidence capture, migrating from blockchain timestamping to **PKI infrastructure** using Keyfactor EJBCA. Their "Controlled Capture" runs **35 authenticity tests** including advanced geofencing, reverse image matching, and picture-of-a-picture detection. Pricing starts at **$1,000/month** for Truepic Vision.

The C2PA standard (Coalition for Content Provenance and Authenticity) provides the open specification underlying both Truepic and ProofMode. Key technical components include:

- **COSE signatures** (CBOR Object Signing) over X.509 certificates
- **Hard bindings** via SHA-256 hashes of content byte ranges
- **RFC 3161 timestamps** from Time Stamp Authorities
- **Ingredient tracking** for composed/edited assets

However, **C2PA has fundamental limitations**. The Nikon Z6 III incident (September 2025) revealed implementation vulnerabilities—researchers got AI-generated images validated by C2PA-enabled cameras via multiple exposure mode exploits. More fundamentally, C2PA authenticates that *someone* signed content, not that content is truthful. Metadata is easily stripped via screenshot, social media upload, or format conversion.

Open-source C2PA implementations are mature: c2pa-rs (Rust), c2pa-python, c2pa-js (browser), and mobile SDKs for Android/iOS—all available under Apache 2.0 from the contentauth GitHub organization.

## Guardian Project tools provide modular building blocks

Guardian Project's toolkit offers reusable components for secure mobile development:

**Haven** (Edward Snowden collaboration): Transforms phones into motion/sound/light detectors with trigger-based recording. Uses Signal protocol for encrypted notifications without requiring the Signal app installed. Tor integration via Orbot enables remote access through onion services. **6.8k GitHub stars** demonstrate community trust.

**IOCipher**: Drop-in encrypted file storage built on SQLCipher—`java.io` API clone with AES-256 encryption, no root required.

**NetCipher**: Hardened TLS settings plus Orbot integration for proxy support and Tor routing.

**ObscuraCam**: Automatic face detection with pixelate/redact/blur options, plus metadata stripping.

The library pattern—separate IOCipher, NetCipher, SQLCipher components—enables picking proven encryption without adopting entire applications.

## Landscape scan reveals gaps and failed experiments

The broader ecosystem includes several notable tools and instructive failures:

**Active tools worth studying**:
- **Tella** (Horizontal.org): On-device AES encryption, disguised app appearance, ODK standard compatibility—used documenting violence in Cuba, Myanmar, and Brazil
- **VictimsVoice**: Domestic abuse documentation designed with attorneys for legal admissibility ($39.95/year)—evidence used in court cases across all 50 US states
- **OpenArchive/Save**: IPFS/Filecoin integration with Decentralized Archivist Communities model for community-driven preservation
- **Starling Lab** (Stanford/USC): First cryptographic evidence submission to ICC for Ukraine war crimes; comprehensive Capture-Store-Verify framework

**Failed/discontinued projects**:
- **ACLU Mobile Justice**: Shutting down due to consumer privacy law concerns and surveillance risks—demonstrates regulatory complexity
- **DocuSAFE** (domestic violence tool): Discontinued October 2023—no clear reason, but funding instability is common
- **Martus**: Support ended 2018—technology became outdated; serves as warning against platform lock-in

**Underserved use cases**: Refugee asylum evidence, elder abuse in care facilities, workplace harassment, and internet shutdown resilience lack dedicated tools.

## Legal requirements define the admissibility bar

Digital evidence admissibility rests on authentication (FRE 901), chain of custody, and integrity verification. The 2017 FRE amendments created **self-authentication paths** for certified electronic records (902(13)) and hash-verified data copies (902(14))—directly relevant for blockchain-timestamped evidence.

**Required for court admissibility**:
- SHA-256 hash verification at collection and every transfer
- Complete chain of custody documentation (who, when, where, why for every handler)
- Preserved metadata (EXIF data for photos/videos including timestamps, GPS, device info)
- Qualified person certification
- Write-blocking during acquisition to prevent modification claims

The ICC uses a flexible three-part test: relevance, probative value (reliability/authenticity/credibility), and prejudice assessment. **Critical gap**: ICC still uses MD5 for digital file authentication—identified as "dangerously outdated."

**Blockchain evidence is gaining legal recognition**:
- Vermont H.B. 868: Blockchain records presumed authentic
- Arizona HB 2417: Cannot deny legal effect to blockchain signatures
- Illinois Blockchain Technology Act (2020): Smart contracts enforceable
- China's Hangzhou Internet Court (2018): First to accept blockchain evidence

However, blockchain timestamps prove existence at a time—not authorship or truthfulness. *US v. Lizarraga-Tirado* established that machine-generated data isn't hearsay because it's produced autonomously, which supports blockchain timestamp admissibility.

## Patterns to adopt for Witness Protocol

**From eyeWitness**: Multi-source location verification (GPS + WiFi + cell towers) provides redundancy and corroboration. Selective metadata capture—only capture what can be reliably recorded. Professional legal consultation during development pays dividends in court.

**From ProofMode**: Sidecar proof files preserve original evidence integrity. Layered verification (hash + signature + timestamp + attestation) builds defense-in-depth. Background service model with zero setup maximizes adoption. C2PA integration enables industry interoperability.

**From Guardian Project**: Modular library architecture (IOCipher, NetCipher) enables component reuse. Tor integration provides censorship resistance. Signal protocol for notifications without app dependency. Panic/quick-delete features for user safety.

**From Starling Lab**: Capture-Store-Verify framework provides complete lifecycle coverage. IPFS + Filecoin for decentralized storage. Multiple soft bindings (watermark + fingerprint + hash) for stripping resilience.

**For blockchain integration specifically**:
- Use OpenTimestamps for Bitcoin timestamping (free, no registration, privacy-preserving)
- PKI more scalable than on-chain for high-volume signing (Truepic's evolution)
- Generate hash locally before any network transmission (privacy)
- Consider DIDs (Decentralized Identifiers) instead of X.509 for decentralized trust model

## Mistakes to avoid

**From eyeWitness's limitations**: Centralized trust creates single points of failure. Closed source prevents community security auditing. Slower capture speed (1-2 seconds) is dangerous in crisis situations.

**From C2PA vulnerabilities**: Hardware attestation isn't foolproof (Nikon Z6 III exploit). Stripping problem remains unsolved—metadata easily removed. Self-signed certificates lack credibility without trust anchors.

**From failed projects**: Don't depend on single funding sources (DocuSAFE discontinuation). Avoid platform lock-in with proprietary formats (Martus obsolescence). Regulatory complexity killed ACLU Mobile Justice—consider privacy law implications early.

**From ProofMode's gaps**: Anonymous default identity (`noone@proofmode.witness.org`) lacks credibility. No persistent identity binding weakens legal standing. Self-signed C2PA certificates appear untrustworthy.

## Unsolved problems Witness Protocol could address

**Decentralized trust without centralized authorities**: Current solutions require trusting eyeWitness organization or C2PA's centralized certificate lists. A web-of-trust model using trusted contacts' wallet addresses could provide attestation without central authority.

**Stripping-resistant verification**: When social media strips metadata, recovery requires distributed lookup services. IPFS content addressing plus perceptual hashing could enable "rediscovery" of credentials even after modification.

**Legal affidavit equivalent**: eyeWitness provides professional affidavits on request—no open-source tool matches this. Smart contracts could enable on-chain attestation records that serve similar evidentiary function.

**Gasless onboarding for crisis contexts**: Current blockchain tools require crypto knowledge. Smart contract wallets with passkeys could eliminate seed phrases while maintaining self-custody.

**Real-time witness notification**: Legal Equalizer's Zoom witnessing model shows demand for live accountability. Trusted contacts receiving cryptographic proof of recording start could provide distributed witnessing.

## Already-solved problems to leverage

**Don't reinvent**:
- Cryptographic hashing: SHA-256 is legally recognized and implemented everywhere
- C2PA manifests: Use c2pa-rs/Simple C2PA—mature, audited, industry-standard
- Bitcoin timestamping: OpenTimestamps is free, battle-tested, legally recognized
- Encrypted storage: IOCipher/SQLCipher are production-ready
- Tor integration: NetCipher + Orbot are mature
- IPFS storage: Established infrastructure via Pinata, Filebase, Protocol Labs

**Leverage existing infrastructure**:
- Filecoin for long-term archival (funded by FFDW grants)
- OpenTimestamps calendar servers for Bitcoin anchoring
- Google SafetyNet/Play Integrity for device attestation
- Content Credentials verify tools for C2PA validation

## Technical architecture recommendations

For a hackathon prototype targeting journalists, activists, and domestic abuse survivors:

**Identity layer**: Smart contract wallet with passkey authentication eliminates seed phrase complexity. Generate device-specific signing keys stored in Android Keystore/iOS Secure Enclave. Trusted contacts added via wallet addresses, not phone numbers.

**Capture layer**: Background service hooks into camera events (ProofMode pattern). Capture GPS + WiFi + cell towers + accelerometer + light sensor + timestamp. Generate SHA-256 hash immediately. Create C2PA manifest with self-signed cert initially.

**Verification layer**: OpenTimestamps for Bitcoin anchoring. Optional trusted contact co-signatures for web-of-trust attestation. Google Play Integrity for device attestation.

**Storage layer**: Local encrypted storage via IOCipher. IPFS for decentralized publishing with content addressing. Filecoin archival for permanence. Emergency deletion via trusted contact trigger (Panic pattern).

**Notification layer**: Signal protocol messages to trusted contacts on capture events. Onion service for Tor-accessible evidence review. Smart contract event emission for on-chain activity log.

**Export layer**: Sidecar proof bundle (ProofMode format) for interoperability. C2PA manifest embedding for Content Credentials ecosystem. Gasless claiming for recipients via account abstraction.

## Conclusion

The evidence preservation space has matured significantly since eyeWitness launched in 2015. The cryptographic and legal foundations exist—SHA-256, C2PA, OpenTimestamps, and blockchain evidence all have legal recognition. What's missing is a system that combines **ProofMode's open architecture** with **eyeWitness's legal credibility** while adding **decentralized trust** that doesn't depend on any single organization.

Witness Protocol's blockchain integration—smart contract wallets, trusted contacts via addresses, gasless onboarding, censorship-resistant storage—directly addresses the centralization weakness of existing tools. The key innovation opportunity is replacing centralized certificate authorities with a web-of-trust model where trusted contacts provide attestation, creating legally meaningful verification without institutional gatekeepers.

Build on what's proven (C2PA, OpenTimestamps, IOCipher), solve what's broken (centralized trust, stripping vulnerability), and ignore what's unsolvable (proving truth vs. proving existence). The hackathon MVP should demonstrate: passkey wallet creation → evidence capture with full metadata → trusted contact attestation → IPFS storage with Bitcoin timestamp → verifiable proof bundle export.