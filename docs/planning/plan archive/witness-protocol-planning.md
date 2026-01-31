# Witness Protocol: Research & Architecture Planning

## 1. Project Overview

### Problem Statement
People at risk—journalists, activists, domestic abuse survivors—need a way to capture and preserve evidence of dangerous encounters. Existing solutions (bSafe, Noonlight) are paid services with centralized infrastructure that could be compromised, coerced, or shut down.

### Solution Concept
An open-source personal safety toolkit that:
- Captures video, audio, and GPS data
- Streams to decentralized/durable storage that can't be easily scrubbed
- Gives a trusted group of contacts access to that data
- Is self-hostable and configurable
- Uses blockchain for immutable proof of existence and potentially access control

### Target Users
- Journalists and activists in hostile environments
- People escaping domestic abuse situations
- Anyone who needs verifiable evidence of an interaction with a dangerous person or group

### Hackathon Constraints
- **Timeline:** 3 days
- **Context:** Ethereum hackathon (blockchain integration should be meaningful, not shoehorned)
- **Demo goal:** Record video on phone → trusted contacts can access it → blockchain integration provides real value
- **Technical preference:** TypeScript, possibly Rust for learning

---

## 2. Decisions vs Candidates

### Firm Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Identity system | Smart contract wallet + passkeys | Frictionless onboarding, no seed phrases, Ethereum-native |
| Identity provider | human.tech (to validate) | ZK identity, passkey auth, ERC-4337 |
| User identity | Pseudonymous by default | Random human-readable name, ZK proofs optional later |
| Trusted contacts | Wallet-addressed | Cryptographic identity, no passwords |
| Onboarding | Gasless account creation | Paymaster covers wallet deployment |
| Open source | Yes | Core to the mission |

### Candidates to Validate

| Component | Leading Candidate | Alternatives to Research | Decision Criteria |
|-----------|-------------------|--------------------------|-------------------|
| Client platform | PWA | Native Android, React Native, Flutter | Persistent background access to camera/mic/GPS |
| Data layer | Matrix protocol | IPFS + pubsub, Gun.js, Nostr, WebRTC mesh, Self-hosted S3 | E2E encryption, media support, latency, complexity |
| Blockchain use | Hash timestamping | + Dead man's switch, + Access control, + Incentivized witnessing | Meaningful value vs complexity |
| Target chain | Base Sepolia | Sepolia, Arbitrum Sepolia, Optimism Sepolia | Paymaster availability, cost, tooling |

---

## 3. Open Research Questions

### 3.1 Identity & Wallet

**human.tech Evaluation**
- What does the SDK provide? (wallet creation, signing, ZK proofs)
- Documentation quality and maturity?
- Integration complexity for web apps?
- Passkey + PIN flow: how does it work technically?
- What chains are supported?
- Paymaster: included or bring your own?

**Alternatives Comparison**
- How do Privy, Dynamic, Thirdweb, Safe, Coinbase Smart Wallet compare?
- Which has best browser support?
- Which has simplest integration for hackathon timeline?

**Technical Mechanics**
- ERC-4337: how does signing work when wallet is a contract?
- How do passkeys (WebAuthn) integrate with blockchain signing?
- Can wallet-derived keys be used for E2E encryption of media?

**Why it matters:** Identity is foundational. Wrong choice here cascades through entire architecture.

---

### 3.2 Client Platform Feasibility

**PWA Capabilities**
- Can a PWA get persistent camera/microphone access?
- Can a PWA continue recording when screen is locked?
- Can a PWA continue recording when user switches apps?
- Geolocation API: background access possible?
- What are the differences between iOS and Android PWA capabilities?

**Native App Comparison**
- What can native Android do that PWA cannot?
- React Native / Flutter: do they unlock more permissions?
- What's the development time tradeoff?

**For Hackathon Scope**
- If PWA has limitations, are they acceptable for a demo?
- Can we note limitations as "future work" and still demo core concept?

**Why it matters:** If PWA can't do background recording at all, we need to know immediately.

---

### 3.3 Data Layer Options

**Matrix Protocol**
- Can matrix-js-sdk handle video uploads? Size limits?
- E2E encryption with media: how do keys work?
- Latency: how quickly do room members see new content?
- Can new room members access historical content?
- Self-hosting requirements vs using matrix.org

**IPFS + Alternatives**
- IPFS: pinning problem, latency, encryption approach?
- Gun.js: real-time sync, encryption, reliability?
- Nostr: simplicity, relay model, media support?
- WebRTC: direct P2P to trusted contacts?
- Simple self-hosted storage: S3/MinIO + sharing?

**Evaluation Criteria**
- E2E encryption (must have)
- Real-time or near-real-time sync (must have)
- Media file support (must have)
- Decentralization / censorship resistance (nice to have)
- Self-hostability (nice to have)
- Integration complexity (hackathon constraint)

**Why it matters:** This is the core infrastructure. Wrong choice = rebuild from scratch.

---

### 3.4 Blockchain Integration Options

**Option A: Hash Timestamping (Baseline)**
- Commit content hashes to chain as proof of existence
- Simple, clear value proposition
- Low gas cost if batched

**Option B: Dead Man's Switch**
- User must check in periodically (send tx or sign message)
- If check-in missed, contract releases decryption key to trusted contacts
- Or: triggers alert to trusted contacts
- Complexity: key escrow, timing, false positives

**Option C: On-Chain Access Control**
- Trusted contact list stored in contract
- To decrypt, must prove membership (signature challenge)
- Could use token-gating or allowlist
- Complexity: key distribution, gas for updates

**Option D: Incentivized Witnessing**
- Bounty escrowed for witnesses who help
- Trusted contacts stake reputation
- Complexity: tokenomics, abuse prevention

**Option E: Verifiable Credentials / Attestations**
- EAS attestations for video authenticity
- Attestations about trusted contact relationships
- Builds portable reputation

**For Hackathon**
- Which options are achievable in 3 days?
- Which tell the best story to judges?
- Which provide genuine value vs "blockchain for blockchain's sake"?

**Future Directions (Stretch / Post-Hackathon)**
- Full DAO governance for platform
- Decentralized storage incentives (Filecoin integration)
- Cross-chain identity
- Integration with legal/NGO systems

**Why it matters:** This is an Ethereum hackathon. Blockchain integration must be meaningful.

---

### 3.5 Deployment Architecture

**Questions to Answer**

**What must be centralized (if anything)?**
- Does Matrix require a homeserver someone operates?
- Does IPFS require pinning infrastructure?
- Who runs the paymaster for gasless transactions?
- Is there a "Witness Protocol server" or is it fully P2P?

**What can users self-host?**
- Can a tech-savvy group run their own infrastructure?
- What's the minimum viable self-hosted setup?
- What's the "easy mode" that uses shared infrastructure?

**Trust Model**
- Who do users have to trust in each architecture option?
- What's the blast radius if a component is compromised?
- How does this compare to existing solutions (bSafe, etc.)?

**Cost Model**
- What are the ongoing costs to operate?
- Who pays? (User, trusted contacts, grants, donations?)
- Can it run on free tiers for small scale?

**For Hackathon Demo**
- What's the minimal deployment for a working demo?
- What can we use free/public infrastructure for?
- What needs to be deployed specifically for the demo?

**Why it matters:** "Decentralized" is meaningless if there's a hidden central point of failure.

---

### 3.6 Prior Art

**eyeWitness to Atrocities**
- Is it open source? Architecture?
- How do they handle chain of custody?
- Storage/encryption approach?
- What worked, what didn't?

**ProofMode**
- Implementation details (open source)
- Metadata capture approach
- C2PA integration?

**Other Tools**
- Other open source safety/evidence apps?
- Academic research on secure evidence capture?
- Relevant legal precedents for digital evidence?

**Why it matters:** Learn from existing solutions. Don't reinvent wheels.

---

## 4. Proposed Architecture (Draft)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client (PWA or Native TBD)                   │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Camera     │  │  Microphone  │  │     GPS      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                     │
│                  ┌─────────────────┐                            │
│                  │  Media Capture  │                            │
│                  │  (chunked)      │                            │
│                  └────────┬────────┘                            │
│                           ▼                                     │
│         ┌─────────────────────────────────────────┐             │
│         │         Encryption Layer                │             │
│         │   (wallet-derived keys? TBD)            │             │
│         └─────────────────┬───────────────────────┘             │
│                           │                                     │
│              ┌────────────┴────────────┐                        │
│              ▼                         ▼                        │
│   ┌──────────────────┐      ┌──────────────────┐               │
│   │  Data Layer      │      │  Blockchain      │               │
│   │  (Matrix? TBD)   │      │  (multiple uses) │               │
│   └────────┬─────────┘      └────────┬─────────┘               │
│            │                         │                          │
├────────────┼─────────────────────────┼──────────────────────────┤
│  IDENTITY  │                         │                          │
│  ┌─────────┴─────────┐               │                          │
│  │  human.tech SDK   │               │                          │
│  │  - Passkey auth   │               │                          │
│  │  - Smart wallet   │               │                          │
│  │  - Signing        │               │                          │
│  └───────────────────┘               │                          │
└──────────────────────────────────────┼──────────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────┐
          ▼                            ▼                        ▼
┌──────────────────┐       ┌──────────────────┐     ┌──────────────────┐
│   Data Storage   │       │  Hash Registry   │     │  Access Control  │
│   (TBD)          │       │  (timestamps)    │     │  (TBD scope)     │
│                  │       │                  │     │                  │
│ - E2E encrypted  │       │ - Proof of exist │     │ - Trusted list   │
│ - Shared access  │       │ - Immutable      │     │ - Dead man switch│
│ - Media + GPS    │       │                  │     │                  │
└────────┬─────────┘       └──────────────────┘     └──────────────────┘
         │
         ▼
┌──────────────────┐
│ Trusted Contacts │
│                  │
│ - View media     │
│ - See location   │
│ - Verify proofs  │
└──────────────────┘
```

### Key Uncertainties
- [ ] PWA vs Native: can PWA do background capture?
- [ ] Matrix vs alternatives: which fits best?
- [ ] Blockchain scope: hash-only or more?
- [ ] Deployment: what's centralized?
- [ ] Encryption: wallet-derived or separate keys?

---

## 5. Milestone Plan (Draft)

*Subject to significant revision after research*

### Day 1: Foundation
- [ ] Validate client platform choice (PWA feasibility)
- [ ] Integrate identity provider for wallet creation
- [ ] Basic capture: camera/mic access, single clip
- [ ] Connect to data layer (Matrix or alternative)
- [ ] Send test content to storage

**Demo checkpoint:** User creates wallet, captures media, media stored somewhere accessible

### Day 2: Core Features
- [ ] Chunked continuous recording
- [ ] GPS capture and transmission
- [ ] Smart contract deployment
- [ ] Hash submission on capture
- [ ] Trusted contact invitation flow

**Demo checkpoint:** Recording session with GPS, trusted contact can view, hashes on-chain

### Day 3: Polish + Stretch
- [ ] Viewer interface for trusted contacts
- [ ] Hash verification UI
- [ ] (Stretch) Dead man's switch
- [ ] (Stretch) On-chain access control
- [ ] End-to-end test
- [ ] Presentation prep

**Demo checkpoint:** Full flow demo-ready, clear narrative for judges

### Stretch Goals (If Ahead of Schedule)
- Dead man's switch implementation
- On-chain access control
- Multiple recording sessions
- Session history view
- Export/download functionality

---

## 6. Deployment Questions

### Hackathon Demo Deployment
| Component | Planned Approach | Centralized? | Cost |
|-----------|------------------|--------------|------|
| Client | Hosted on Vercel/Netlify | Yes (static hosting) | Free |
| Identity | human.tech infrastructure | Yes (their service) | Free tier? |
| Data layer | TBD | TBD | TBD |
| Blockchain | Public testnet | No | Free (testnet) |
| Paymaster | TBD | Yes | Sponsor/grant? |

### Production Deployment (Future)
| Component | Options | Self-Hostable? |
|-----------|---------|----------------|
| Client | Any static host, IPFS | Yes |
| Identity | human.tech, or alternatives | Depends on provider |
| Data layer | Matrix (Synapse), IPFS node, etc. | Yes |
| Blockchain | Any EVM chain | N/A (public infra) |
| Paymaster | Run own, or use service | Yes (with funding) |

### Trust Analysis
*To be filled in after research*

| Architecture Option | Who Must You Trust? | Single Points of Failure |
|---------------------|---------------------|--------------------------|
| Option A | TBD | TBD |
| Option B | TBD | TBD |

---

## 7. Research Tasks

Six parallel research tasks. Each outputs a standalone .md file that will be synthesized into final architecture decisions.

See: `research-prompts.md` for detailed agent prompts.

---

## Next Steps

1. ✅ Finalize planning document
2. ✅ Create research agent prompts  
3. ⏳ Dispatch research tasks in parallel
4. ⏳ Synthesize research findings
5. ⏳ Make final architecture decisions
6. ⏳ Finalize milestone plan
7. ⏳ Begin implementation

---

*Document created: January 30, 2025*
*Last updated: January 30, 2025*
*Status: Planning phase - research prompts ready*
