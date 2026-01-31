# Witness Protocol

An open-source personal safety toolkit for secure evidence capture and preservation.

## Problem

People at risk—journalists, activists, domestic abuse survivors—need a way to capture and preserve evidence of dangerous encounters. Existing solutions are paid services with centralized infrastructure that could be compromised, coerced, or shut down.

## Solution

A decentralized evidence capture system that:
- Captures video, audio, and GPS data on mobile devices
- Stores encrypted content to censorship-resistant infrastructure
- Gives trusted contacts (wallet-addressed) access to that data
- Uses blockchain for immutable proof of existence
- Is self-hostable and doesn't depend on any single company

## Project Structure

```
witness-pwa/          # Milestone 1: Simple PWA (HTML/CSS/JS)
docs/
├── planning/         # Architecture and implementation plans
│   ├── claude-code-pwa-brief.md      # Milestone 1 spec
│   ├── witness-protocol-planning.md  # Overall project plan
│   └── witness-protocol-architecture-v2.md  # Full architecture
└── research/         # Research findings
    ├── research-identity-wallets.md
    ├── research-data-layer.md
    ├── research-blockchain-integration.md
    ├── research-expo-stack.md
    └── research-prior-art.md
```

## Development Milestones

### Milestone 1: Basic PWA (Current)
- [x] Camera/microphone access
- [x] Video recording
- [x] Local download
- [ ] PWA installation support
- [ ] Recordings list (localStorage)

### Future Milestones
- GPS tracking and location metadata
- Encryption (wallet-derived keys)
- IPFS upload with Pinata
- Matrix coordination layer
- EAS attestations on Base
- Trusted contact management

## Tech Stack

**Milestone 1:**
- Pure HTML/CSS/JavaScript (no frameworks)
- Browser APIs: MediaRecorder, getUserMedia, Service Worker

**Future:**
- Expo (React Native + Web)
- Privy (Smart Wallets + Auth)
- IPFS/Pinata (Storage)
- Matrix (Coordination)
- EAS on Base (Attestations)

## Getting Started

```bash
# Milestone 1: Serve the PWA locally
cd witness-pwa
python -m http.server 8000
# Open https://localhost:8000 (camera requires HTTPS or localhost)
```

## Deployment

Target: `https://witness.squirrlylabs.xyz`

## License

MIT
