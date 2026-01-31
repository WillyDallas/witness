# Witness Protocol - Claude Code Context

## Project Overview

Witness Protocol is an open-source personal safety toolkit for secure evidence capture. Target users are journalists, activists, and domestic abuse survivors who need to capture and preserve evidence that can't be easily deleted or manipulated.

## Goal

Build a progressive web app (PWA) that captures video/audio/GPS, stores encrypted content to decentralized infrastructure, and provides trusted contacts with access via wallet-addressed cryptographic identity.

## Current Milestone

**Milestone 1: Basic PWA** - Simple video capture with pure HTML/CSS/JavaScript. No frameworks, no build tools. Located in `witness-pwa/`.

## Tech Stack

### Milestone 1 (Current)
- Pure HTML/CSS/JavaScript
- Browser APIs: MediaRecorder, getUserMedia, Service Worker, localStorage

### Future Milestones
- Expo (React Native + Web)
- Privy (Smart Wallets + Passkey Auth)
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

### Deploy Command
From the project root:
```bash
rsync -avz witness-pwa/ root@46.62.231.168:/var/www/witness/
```

### After Deploying Changes
1. Bump `CACHE_NAME` version in `sw.js` (e.g., `witness-v4` → `witness-v5`)
2. Deploy with rsync command above
3. Users need to refresh or clear cache to get updates
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
cd witness-pwa && python3 -m http.server 8080
# Open http://localhost:8080
```
Camera APIs require localhost or HTTPS.
