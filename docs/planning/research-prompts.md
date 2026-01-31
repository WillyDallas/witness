# Witness Protocol: Research Agent Prompts

---

## Project Context (Include with Each Task)

**Copy this section into each research agent prompt so they have full context.**

### What We're Building

**Witness Protocol** is an open-source personal safety toolkit for people at risk—journalists, activists, domestic abuse survivors—who need to capture and preserve evidence of dangerous encounters.

**Core concept:**
- User captures video, audio, and GPS data on their phone
- Data streams to decentralized/durable storage that can't be easily scrubbed
- A trusted group of contacts (wallet-addressed) can access the data
- Blockchain provides immutable proof of existence and potentially access control
- The system is self-hostable and doesn't depend on any single company

**Why this matters:** Existing solutions (bSafe, Noonlight) are paid services with centralized infrastructure that could be compromised, coerced, or shut down. We want censorship-resistant evidence preservation.

### Hackathon Constraints

- **Timeline:** 3 days at ETH Chiang Mai hackathon
- **Context:** Ethereum hackathon—blockchain integration must provide genuine value, not be shoehorned
- **Demo goal:** Record video on phone → trusted contacts can access it → blockchain provides real value (timestamps, access control, or dead man's switch)
- **Tech preferences:** TypeScript, Foundry for contracts

### Firm Decisions (Already Made)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Identity system | Smart contract wallet + passkeys | Frictionless onboarding, no seed phrases |
| Identity provider | human.tech (needs validation) | ZK identity, passkey auth, ERC-4337 |
| User identity | Pseudonymous by default | Random human-readable name |
| Trusted contacts | Wallet-addressed | Cryptographic identity |
| Onboarding | Gasless account creation | Paymaster covers wallet deployment |
| Open source | Yes | Core to the mission |

### Candidates to Validate (Why Research Matters)

| Component | Leading Candidate | Alternatives | Your Task May Impact |
|-----------|-------------------|--------------|----------------------|
| Client platform | PWA | Native Android, React Native | Task 2 |
| Data layer | Matrix protocol | IPFS, Gun.js, Nostr, WebRTC, S3 | Task 3 |
| Blockchain use | Hash timestamping | + Dead man's switch, + Access control | Task 4 |
| Target chain | Base Sepolia | Sepolia, Arbitrum Sepolia, Optimism Sepolia | Task 4 |

---

## Agent Instructions (Include with Each Task)

### Before You Begin

1. **Review this prompt completely** before starting research
2. **Ask clarifying questions** if anything is ambiguous or if you need more context about project priorities. Don't guess—ask.
3. If you have enough information to proceed, **begin immediately**—no need to ask permission

### Research Approach

1. **Prioritize official documentation** - Always start with official docs, SDKs, and GitHub repos
2. **Verify with multiple sources** - Cross-reference claims, especially for capability limitations
3. **Note version numbers** - APIs change; note which version of docs/SDKs you're referencing

### Output Requirements

Your output .md file MUST include:

1. **Executive Summary** (2-3 sentences) - The key finding/recommendation
2. **Detailed Analysis** - Structured findings per the task template
3. **References Section** - Every claim should have a source. Include:
   - Direct links to official documentation
   - GitHub repo links with specific file paths where relevant
   - Library/SDK version numbers
   - Links suitable for Context7 follow-up (e.g., "For implementation details, query Context7 with library ID `/matrix-org/matrix-js-sdk`")
4. **Open Questions** - What couldn't you determine? What needs hands-on testing?
5. **Context7 Library IDs** - List any library IDs you discovered that would be useful for implementation

### Example References Section

```markdown
## References

### Official Documentation
- [human.tech SDK Docs](https://docs.human.tech) - v2.1.0
- [Matrix Client-Server API Spec](https://spec.matrix.org/latest/client-server-api/)

### GitHub Repositories
- [matrix-js-sdk](https://github.com/matrix-org/matrix-js-sdk) - MIT License
- [EAS Contracts](https://github.com/ethereum-attestation-service/eas-contracts)

### Context7 Library IDs for Implementation
- `/matrix-org/matrix-js-sdk` - Matrix JavaScript SDK
- `/ethereum-attestation-service/eas-sdk` - EAS SDK

### Additional Resources
- [MDN MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [EIP-4337 Specification](https://eips.ethereum.org/EIPS/eip-4337)
```

---

## Task 1: Identity & Smart Wallet Research

**Output file:** `research-identity-wallets.md`

### Why This Research Matters

Identity is foundational—every other component depends on it. The wrong choice here cascades through the entire architecture. We need passkey-based authentication (no seed phrases) with ERC-4337 smart wallets for gasless onboarding.

### Primary Focus: human.tech

Research human.tech (https://human.tech) as our identity and wallet solution:

1. **SDK & Documentation**
   - What does the SDK provide? (wallet creation, signing, ZK proofs, etc.)
   - Quality of documentation—is there a quickstart guide?
   - Are there code examples or sample projects?
   - What's the integration complexity for a web/PWA app?

2. **Technical Implementation**
   - How does passkey + PIN authentication work technically?
   - How does their ERC-4337 smart wallet implementation work?
   - What signing capabilities are available? (personal_sign, typed data, etc.)
   - **Critical:** Can you derive encryption keys from the wallet for E2E encryption of other data?

3. **Infrastructure**
   - What chains are supported?
   - Is a paymaster included for gasless transactions, or bring your own?
   - What are the dependencies on human.tech infrastructure?
   - What happens if human.tech goes down? Is there recovery?

4. **ZK Identity Features**
   - What ZK proof capabilities exist?
   - Can users prove attributes without revealing identity?
   - Is this mature or experimental?

5. **Hackathon Viability**
   - Can this be integrated in 1 day?
   - Any known issues or gotchas?
   - Is there developer support (Discord, docs, etc.)?

### Secondary: Alternatives Comparison

Briefly compare these alternatives to human.tech:

| Provider | Passkey Support | ERC-4337 | Gasless | PWA/Browser | Docs Quality | Hackathon Fit |
|----------|-----------------|----------|---------|-------------|--------------|---------------|
| Privy | ? | ? | ? | ? | ? | ? |
| Dynamic | ? | ? | ? | ? | ? | ? |
| Thirdweb Embedded Wallets | ? | ? | ? | ? | ? | ? |
| Safe + Passkey Module | ? | ? | ? | ? | ? | ? |
| Coinbase Smart Wallet | ? | ? | ? | ? | ? | ? |

For each, note the Context7 library ID if available.

### Output Structure

```markdown
# Identity & Smart Wallet Research

## Executive Summary
[2-3 sentence recommendation]

## human.tech Evaluation

### Overview
[What is it, company background, maturity]

### SDK & Integration
[Detailed findings with code examples if available]

### Technical Details
[How passkeys work, signing flow, key derivation possibilities]

### Infrastructure & Dependencies
[Chains, paymaster, uptime dependencies]

### ZK Features
[Current state, applicability]

### Hackathon Viability Assessment
[Honest assessment of 1-day integration feasibility]

## Alternatives Comparison
[Table + brief notes on each]
[Include Context7 library IDs for each]

## Recommendation
[Which to use and why]
[Backup recommendation if primary doesn't work out]

## Open Questions
[Things that couldn't be determined—need hands-on testing]

## References
[Links to docs, repos, Context7 IDs, etc.]
```

---

## Task 2: Client Platform Capabilities

**Output file:** `research-client-platform.md`

### Why This Research Matters

If a PWA can't do background recording at all, we need to know immediately—it changes the entire client architecture. This is a go/no-go decision for our leading candidate. It may still be the case, that we build a PWA for the hackathon scope, but we should know it's long-term limitations.

### Core Question

Can a PWA provide persistent access to camera, microphone, and GPS—including background recording when the screen is locked or app is switched?

### PWA Research

1. **MediaRecorder API**
   - Browser support matrix (Chrome, Firefox, Safari—desktop and mobile)
   - iOS Safari specifically—what are the limitations?
   - Supported video/audio codecs
   - Maximum recording duration or file size limits

2. **Background Execution**
   - What happens when user locks screen? (iOS vs Android)
   - What happens when user switches to another app?
   - Service Worker capabilities—can they access camera/mic?
   - Web Locks API, Background Sync, Background Fetch—any help?
   - Are there any workarounds documented?

3. **Geolocation API**
   - Can a PWA get background location updates?
   - Permissions model on iOS vs Android
   - Battery impact of continuous polling
   - Accuracy in different modes

4. **Camera/Microphone Permissions**
   - How persistent are permissions?
   - Can permissions survive browser/app restart?
   - Any differences between "installed" PWA vs browser tab?

5. **PWA Installation**
   - Requirements for Add to Home Screen
   - Does installation grant any additional permissions?
   - Offline capability requirements

### Native Comparison

If PWA has significant limitations, briefly assess:

1. **Native Android**
   - What permissions/capabilities does native unlock?
   - Foreground Service for background recording
   - Complexity vs PWA

2. **React Native / Expo**
   - Do they bridge the gap?
   - Any libraries for background recording?
   - Development time tradeoff
   - **Context7:** Check for expo-camera, expo-av documentation

### Hackathon Implications

- If PWA can't do background recording, is foreground-only acceptable for demo?
- What's the minimum viable demo given platform constraints?
- Should we explicitly state limitations as "future work"?

### Output Structure

```markdown
# Client Platform Capabilities Research

## Executive Summary
[Can PWA do what we need? Yes/No/Partially—and what's the recommended path]

## PWA Capabilities

### MediaRecorder API
[Browser support matrix table]
[Code examples for chunked recording if possible]

### Background Execution
[What's possible, what's not—with sources]

### Geolocation
[Capabilities and limits]

### Permissions Persistence
[Findings]

### Installation Benefits
[What "installing" the PWA unlocks, if anything]

## Platform Comparison Table

| Capability | PWA (iOS) | PWA (Android) | Native Android | React Native |
|------------|-----------|---------------|----------------|--------------|
| Foreground video | | | | |
| Background video | | | | |
| Background audio | | | | |
| Background GPS | | | | |
| Screen-off recording | | | | |

## Hackathon Recommendation
[What to build given constraints]
[Specific recommendation: PWA with limitations acknowledged, or pivot to React Native, etc.]

## Demo Limitations to Acknowledge
[What won't work that we should mention to judges]

## References
[MDN links, browser compat tables, React Native library links]
[Context7 library IDs for implementation]
```

---

## Task 3: Data Layer Comparison

**Output file:** `research-data-layer.md`

### Why This Research Matters

This is the core infrastructure for storing and sharing encrypted media. Wrong choice here means rebuilding from scratch. We need E2E encryption, real-time sync, and media support—ideally with censorship resistance.

### Evaluation Criteria (in priority order)

1. **Must Have**
   - E2E encryption support
   - Media file support (video chunks, images)
   - Real-time or near-real-time sync to recipients
   - Accessible from web/PWA/App

2. **Should Have**
   - Self-hostable
   - Censorship resistant
   - Works offline with sync when reconnected

3. **Nice to Have**
   - Fully decentralized
   - Content-addressed storage
   - Existing mobile SDKs

### Options to Research

**Matrix Protocol** (Leading candidate)
- matrix-js-sdk capabilities for media upload
- File size limits and chunking approach
- E2E encryption (Megolm)—how does it work with media?
- Key management in browser—where are keys stored?
- Can new room members see historical messages? (key sharing)
- Latency—how fast do messages arrive?
- Using matrix.org vs self-hosting Synapse
- Room permissions model

**IPFS**
- How to encrypt before upload?
- Pinning problem—who keeps data alive?
- Latency for retrieval
- Integration complexity
- Pinata, Web3.Storage, or other pinning services

**Gun.js**
- Real-time sync capabilities
- Encryption support (SEA)
- Reliability and maturity
- Complexity

**Nostr**
- Protocol simplicity
- Media/file support (or lack thereof—NIP-94, NIP-96)
- Relay model—who runs relays?
- Encryption approach

**WebRTC Direct**
- P2P to trusted contacts
- Complexity of signaling
- What if contacts are offline?

**Simple Backend (S3/MinIO + API)**
- Fastest to implement
- Centralization tradeoff
- Self-hostable with MinIO

### Output Structure

```markdown
# Data Layer Comparison Research

## Executive Summary
[Recommended choice and why—be decisive]

## Evaluation Matrix

| Criteria | Matrix | IPFS | Gun.js | Nostr | WebRTC | S3/API |
|----------|--------|------|--------|-------|--------|--------|
| E2E Encryption | | | | | | |
| Media Support | | | | | | |
| Real-time Sync | | | | | | |
| Self-hostable | | | | | | |
| Censorship Resistant | | | | | | |
| Offline Support | | | | | | |
| Integration Complexity | | | | | | |
| Hackathon Feasible | | | | | | |

## Detailed Analysis

### Matrix Protocol
[Detailed findings]
[Code snippet for basic media upload if possible]

### IPFS
[Detailed findings]

### Gun.js
[Detailed findings]

### Nostr
[Detailed findings]

### WebRTC
[Detailed findings]

### Simple Backend
[Detailed findings]

## Recommendation

### Primary Choice
[Which to use and why]

### Backup Choice
[If primary fails during implementation]

## Implementation Notes
[Key technical details for chosen option]
[Sample code structure or pseudocode]

## References
[Official docs, GitHub repos, Context7 library IDs]
```

---

## Task 4: Blockchain Integration Patterns

**Output file:** `research-blockchain-integration.md`

### Why This Research Matters

This is an Ethereum hackathon. Blockchain integration must be meaningful, not shoehorned. We need patterns that provide genuine value for an evidence/safety application—not "blockchain for blockchain's sake."

### Options to Evaluate

**Option A: Hash Timestamping** (Baseline—definitely implementing)
- Simple pattern: store hash + timestamp on-chain
- Proves "this data existed at this time"
- Gas costs for frequent submissions
- Batching with Merkle roots to reduce cost
- Custom contract vs existing solutions (like EAS)

**Option B: Ethereum Attestation Service (EAS)**
- What is EAS and how does it work?
- Schema design for video evidence
- Benefits over custom contract
- Integration complexity
- Chain availability

**Option C: Dead Man's Switch** (Stretch goal)
- Smart contract holds encrypted key or trigger
- User must check in periodically
- If missed, releases key or alerts contacts
- Implementation patterns
- Key escrow considerations
- False positive handling
- Gas costs for check-ins

**Option D: On-Chain Access Control** (Stretch goal)
- Store trusted contact allowlist on-chain
- Signature challenge to prove membership
- Token-gating alternatives
- Key distribution problem
- Gas costs for list updates


### Chain Selection

Research each chain for:

| Chain | Paymaster Availability | Block Time | Tooling Quality | Testnet Faucet | Notes |
|-------|------------------------|------------|-----------------|----------------|-------|
| Sepolia | ? | ? | ? | ? | |
| Base Sepolia | ? | ? | ? | ? | |
| Arbitrum Sepolia | ? | ? | ? | ? | |
| Optimism Sepolia | ? | ? | ? | ? | |

Focus on: Which has the best paymaster ecosystem for ERC-4337?

### Hackathon Scoping

For each option, assess:
- Implementation complexity (simple/medium/complex)
- Demo impact / "wow factor"
- Genuine utility vs theater

### Output Structure

```markdown
# Blockchain Integration Patterns Research

## Executive Summary
[Recommended approach for hackathon—be specific]

## Pattern Analysis

### Hash Timestamping
- How it works
- Implementation approach (custom vs EAS)
- Gas analysis
- Pros/cons
- Sample Solidity code or reference

### Ethereum Attestation Service (EAS)
- Overview
- Applicability to our use case
- Schema design recommendation
- Integration steps
- Pros/cons

### Dead Man's Switch
- Implementation pattern
- Key management considerations
- Pros/cons
- Complexity assessment
- Worth it for hackathon? Yes/No

### On-Chain Access Control
- Implementation pattern
- Key distribution problem
- Pros/cons
- Worth it for hackathon? Yes/No

### Incentivized Witnessing
- Feasibility assessment
- Complexity: too much for hackathon

## Chain Comparison
[Table with findings]
[Specific recommendation]

## Hackathon Recommendation

### Core Scope (Must Have)
[What to definitely implement—Day 1-2]

### Stretch Goals (If Time Permits)
[Prioritized list for Day 3]

### Future Directions (Post-Hackathon)
[Interesting possibilities to mention in presentation]

## Sample Implementation
[Actual Solidity for recommended approach—not pseudocode]
[Or link to reference implementation]

## References
[EAS docs, Foundry docs, chain-specific docs]
[Context7 library IDs]
```

---

## Task 5: Deployment Architecture Analysis

**Output file:** `research-deployment-architecture.md`

### Why This Research Matters

"Decentralized" is meaningless if there's a hidden central point of failure. We need to understand the trust model for our architecture and what's required for a working demo.

### Core Questions

1. What components require centralized infrastructure?
2. What can be self-hosted?
3. What's the trust model for each architecture option?
4. What's the minimal deployment for a hackathon demo?

### Components to Analyze

For each component, determine:
- Can it be decentralized?
- If centralized, who operates it?
- What's the failure mode if it goes down?
- What's the cost model?

**Identity/Wallet Provider**
- human.tech infrastructure dependencies
- What if human.tech is unavailable?
- Self-hosting options?

**Data Layer** (based on Task 3 findings—may need to coordinate)
- Matrix: homeserver requirements
- IPFS: pinning infrastructure
- Other options: dependencies

**Paymaster**
- Who runs it?
- Funding model
- Alternatives: Pimlico, Alchemy, StackUp, Biconomy
- Self-operating feasibility
- **Context7:** Query paymaster provider SDKs

**Smart Contracts**
- Deployed to public chain = no central dependency
- Upgrade patterns (if any)

**Client Hosting**
- Static hosting (Vercel, Netlify, IPFS)
- No meaningful centralization concern

### Trust Analysis

For 2-3 likely architecture configurations, document:

| Component | Who You Trust | What They Could Do | Mitigation |
|-----------|---------------|-------------------|------------|
| human.tech | human.tech Inc | See wallet creation metadata, deny service | Alternative providers exist |
| Matrix homeserver | Homeserver operator | See message metadata, deny service | Self-host or use matrix.org |
| ... | ... | ... | ... |

### Cost Analysis

| Component | Free Tier | Paid Tier | Self-Host Cost |
|-----------|-----------|-----------|----------------|
| | | | |

### Hackathon Demo Setup

What's the minimal deployment to demo the full flow?
- Free services to use
- Things to deploy ourselves
- Setup complexity

### Output Structure

```markdown
# Deployment Architecture Analysis

## Executive Summary
[Key findings on centralization and trust]

## Component Analysis

### Identity Provider
- Dependencies
- Trust implications
- Self-host options

### Data Layer
- Dependencies
- Trust implications
- Self-host options

### Paymaster
- Options (with links)
- Costs
- Trust implications
- Recommendation for hackathon

### Blockchain
- Public infra, no central dependency

### Client Hosting
- Options
- Minimal concern

## Architecture Options

### Option A: Maximum Convenience
[Use hosted services everywhere]
- Components and providers
- Trust model
- Cost
- Setup time

### Option B: Balanced
[Mix of hosted and self-hosted]
- Components and providers
- Trust model
- Cost

### Option C: Maximum Sovereignty
[Self-host everything possible]
- Components and requirements
- Trust model
- Cost

## Trust Comparison with Existing Solutions

| Aspect | Witness Protocol (Option A) | Witness Protocol (Option B) | bSafe | Noonlight |
|--------|----------------------------|----------------------------|-------|-----------|
| Who sees your data | | | | |
| Who can shut it down | | | | |
| Can be compelled by gov't | | | | |

## Hackathon Demo Deployment

### Recommended Setup
[Specific services and why]

### Deployment Checklist
- [ ] Step 1...
- [ ] Step 2...

## References
[Service docs, pricing pages, setup guides]
```

---

## Task 6: Prior Art Analysis

**Output file:** `research-prior-art.md`

### Why This Research Matters

Learn from existing solutions. Don't reinvent wheels. Understand what's been tried, what works, and what gaps exist that we could fill.

### Projects to Research

**eyeWitness to Atrocities** (https://www.eyewitness.global/)
- Is it open source? Where's the code?
- Architecture overview
- How do they handle:
  - Evidence capture
  - Chain of custody
  - Storage and encryption
  - Legal admissibility
- Lessons learned / what works
- Limitations or criticisms

**ProofMode** (https://proofmode.org/ and https://github.com/nickrepack/proofmode)
- Open source—review the code
- Technical approach
- Metadata capture
- C2PA integration (if any)
- How it differs from our approach

**Truepic**
- Commercial solution—how does it work?
- What can we learn from their approach?
- C2PA/Coalition for Content Provenance and Authenticity

**Other Tools**
- Guardian Project tools (haven, etc.)
- Other journalist safety tools
- Any other open source evidence capture apps?

### Academic/Legal Research

- Any academic papers on secure evidence capture?
- Legal standards for digital evidence admissibility
- Chain of custody requirements
- What makes digital evidence "trustworthy" in court?

### Lessons for Our Project

- What patterns should we adopt?
- What mistakes should we avoid?
- What's been solved that we shouldn't re-solve?
- What gaps exist that we could fill?

### Output Structure

```markdown
# Prior Art Analysis

## Executive Summary
[Key learnings for our project—what to adopt, what to avoid]

## eyeWitness to Atrocities

### Overview
[What it is, who uses it]

### Architecture
[Technical approach if available]

### Key Design Decisions
[What they chose and why]

### What Works Well
[Documented successes]

### Limitations
[Known issues or criticisms]

### Lessons for Witness Protocol
[Specific takeaways]

## ProofMode

### Overview
[What it is]

### Technical Approach
[From code review]

### Code Review Notes
[Interesting patterns, libraries used]

### Lessons for Us
[Specific takeaways]

## Truepic

### Overview
[Commercial context]

### Approach
[How it works]

### Lessons for Us
[What we can learn]

## Other Relevant Tools
[Brief notes on any others found]

## Academic/Legal Context

### Digital Evidence Standards
[Key requirements]

### Chain of Custody Requirements
[What's legally required]

### Relevant Research
[Papers or articles worth reading]

## Synthesis: Lessons for Witness Protocol

### Patterns to Adopt
1. [Pattern + source]
2. ...

### Mistakes to Avoid
1. [Mistake + what went wrong]
2. ...

### Unsolved Problems We Could Address
1. [Gap we could fill]
2. ...

### Things Not to Reinvent
1. [What's already solved—use existing solutions]
2. ...

## References
[Links to projects, papers, legal standards]
[GitHub repos with relevant code]
```

---

## Research Execution Notes

### Timeline
- Each task should take approximately 30-60 minutes of focused research
- If you hit a dead end, note it and move on—don't rabbit hole

### Quality Standards
- Prioritize official documentation, GitHub repos, and technical blogs
- For unclear items, note them as "Unknown—needs hands-on testing"
- Include specific links to sources
- Focus on actionable findings, not comprehensive coverage

### Coordination
- Tasks 3 and 5 have dependencies (deployment depends on data layer choice)
- If you're doing Task 5, you may need to wait for Task 3 or make assumptions and note them

### Context7 Usage
- When researching any SDK or library, first try to find it in Context7
- Include the library ID in your references so implementation can query it directly
- If a library isn't in Context7, note that in your output

### After Completion
- All six research files will be synthesized into final architecture decisions
- Your recommendations directly impact what we build
- Be opinionated—give clear recommendations, not just lists of options

---

*Document created: January 30, 2025*
*Last updated: January 30, 2025*
*Status: Ready for parallel research dispatch*