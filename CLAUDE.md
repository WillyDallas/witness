# Witness Protocol - Claude Code Context

## Project Overview

Witness Protocol is an open-source personal safety toolkit for secure evidence capture. Target users are journalists, activists, and domestic abuse survivors who need to capture and preserve evidence that can't be easily deleted or manipulated.

## THIS IS A HACKATHON PROJECT

no data needs to be preserved, do not consider backward compatibility in making plans, we are in a phase of RAPID iteration.

## Goal

Build a progressive web app (PWA) that captures video/audio/GPS, stores encrypted content to decentralized infrastructure, and provides trusted contacts with access via wallet-addressed cryptographic identity.

## Current Milestone

**Phase 1: Identity & Wallet** - Privy authentication with embedded wallet, Kernel smart account, and encryption key derivation. Located in `witness-pwa/`.

## Tech Stack

### Current Implementation
- Vite (build tooling)
- `@privy-io/js-sdk-core` (email auth + embedded wallet)
- `viem` (Ethereum client)
- `permissionless` (Kernel smart account + Pimlico paymaster)
- Web Crypto API (AES-256-GCM encryption key derivation)
- Browser APIs: MediaRecorder, getUserMedia, localStorage

### Future Phases
- IPFS/Pinata (Decentralized Storage)
- Matrix Protocol (Coordination Layer)
- EAS on Base Sepolia (Attestations)

## Repository Structure

```
witness-pwa/          # Milestone 1 implementation
docs/planning/        # Architecture and specs
docs/research/        # Research findings
```

## Git Conventions

- Do not include "Co-Authored-By" attribution lines in commits
- Keep commit messages concise and descriptive
- Follow conventional commit format when appropriate

## Key Files

- `docs/planning/claude-code-pwa-brief.md` - Milestone 1 specification
- `docs/planning/witness-protocol-architecture-v2.md` - Full architecture vision

## Deployment

### Production URL
https://witness.squirrlylabs.xyz

### Server Details
- **Provider**: Hetzner VPS
- **IP**: 46.62.231.168
- **SSH**: `ssh root@46.62.231.168`
- **Web Root**: `/var/www/witness/`
- **Web Server**: nginx with Let's Encrypt SSL

### Build for Production
```bash
cd witness-pwa
npm run build
```
This outputs to `witness-pwa/dist/`.

### Deploy Command
From the project root:
```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

### After Deploying Changes
1. Run `npm run build` to create production bundle
2. Deploy with rsync command above
3. vite-plugin-pwa handles service worker updates automatically
4. For PWA home screen apps: users may need to delete and re-add

### nginx Configuration
Located at `/etc/nginx/sites-available/witness`. Key points:
- Service worker (`sw.js`) is set to no-cache for update propagation
- Static assets cached for 1 year
- HTTPS enforced with auto-redirect from HTTP

## Development Notes

### iOS Safari Limitations
- **WebM format**: Cannot be saved to Photos app, only to Files
- **Web Share API**: iOS 16+ removed "Save to Photos" for images (videos may still work)
- **MediaRecorder**: iOS Safari only supports `video/mp4` format
- **PWA updates**: Users must delete home screen app and re-add to get service worker updates

### Testing Locally
```bash
cd witness-pwa && npm run dev
# Open http://localhost:5173
```
Camera APIs require localhost or HTTPS.

### Environment Setup
Copy `.env.example` to `.env` and fill in your API keys:
- **Privy**: Get App ID and Client ID from https://dashboard.privy.io
- **Pimlico**: Get API Key from https://dashboard.pimlico.io

## Smart Contract Deployment

### Deploy WitnessRegistry to Base Sepolia

From the project root:

```bash
cd contracts && export $(grep -v '^#' ../.env | grep -v '^$' | xargs) && \
  forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url base-sepolia --broadcast --verify -vvvv
```

**Flags explained:**
- `export $(grep ...)` - Loads env vars from root `.env` (more reliable than `source`)
- `--rpc-url base-sepolia` - Uses named endpoint from `foundry.toml`
- `--broadcast` - Actually sends transactions (omit for dry-run)
- `--verify` - Verifies on Basescan using `[etherscan]` config
- `-vvvv` - Max verbosity

### Dry Run (Simulation)
```bash
cd contracts && export $(grep -v '^#' ../.env | grep -v '^$' | xargs) && \
  forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url base-sepolia -vvvv
```

### Resume Failed Verification
```bash
cd contracts && export $(grep -v '^#' ../.env | grep -v '^$' | xargs) && \
  forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url base-sepolia --resume --verify
```

### Required Environment Variables
Set in root `.env`:
- `DEPLOYER_PRIVATE_KEY` - Wallet private key for deployment
- `BASE_SEPOLIA_RPC_URL` - RPC endpoint (referenced in foundry.toml)
- `BASESCAN_API_KEY` - For contract verification
