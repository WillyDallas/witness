# Witness Protocol

**Privacy-Preserving Evidence Capture with Web of Trust**

An open-source personal safety toolkit that enables secure video evidence capture, encrypted storage, and anonymous verification through trusted contacts.

> **Hackathon Project**: This is in active development with rapid iteration. No backward compatibility guarantees.

## 🎯 The Vision

Evidence is only as credible as the witnesses who can vouch for it. Witness Protocol lets you:
- Record video that encrypts and uploads to IPFS in real-time (10-second chunks)
- Share evidence with trusted contacts via wallet-based cryptographic identity
- Enable trusted contacts to verify and attest to evidence anonymously (ZK proofs)
- Prove content integrity with on-chain merkle roots
- Maintain privacy: content stays encrypted, attestor identities stay hidden

## 🚀 Current Status

**Phases 0-7 Complete** (v1.0.0):
- ✅ Privy authentication with embedded wallet
- ✅ Kernel ERC-4337 smart account (gasless transactions via Pimlico)
- ✅ AES-256-GCM encryption with wallet-derived keys
- ✅ Group creation and QR code-based trusted contact sync
- ✅ IPFS content upload via Pinata
- ✅ On-chain content registration with merkle roots
- ✅ Content discovery and decryption for group members
- ✅ Anonymous attestations using Semaphore V4 ZK proofs

**In Progress**:
- 🔄 Chunked video streaming with live merkle tree updates
- 🔄 Enhanced recording UI with visual feedback
- 🔄 Improved playback for chunked content

**Live Demo:** https://witness.squirrlylabs.xyz

## 📁 Project Structure

```
witness-pwa/                    # Main PWA application
├── src/
│   ├── services/              # Core services (auth, encryption, storage, etc.)
│   ├── modals/                # UI modals (login, groups, content detail)
│   └── app.js                 # Main application controller
├── contracts/                 # WitnessRegistry.sol (Base Sepolia)
└── public/                    # Static assets + manifest

docs/
├── architecture/              # System architecture documentation
│   ├── README.md             # High-level overview
│   ├── anonymous-attestations.md
│   ├── encryption-key-derivation.md
│   ├── content-storage.md
│   └── cryptographic-architecture.md
├── planning/                  # Vision and architecture docs
│   ├── witness-protocol-architecture-v3.md  # Current architecture
│   └── plan archive/         # Historical planning docs
├── plans/
│   ├── Shipped/              # Completed implementation plans (Phases 0-7)
│   └── Current/              # In-progress milestone plans
├── research/                  # Technology research
│   ├── general/
│   ├── video-storage-and-transport/
│   └── Wallet-creation-paymaster-zkdid/
├── front-end/                # UI/UX documentation
└── testing/                  # Test plans and results
```

## 🛠 Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Frontend** | Vite + Vanilla JS | PWA with service worker |
| **Authentication** | Privy (`@privy-io/js-sdk-core`) | Email/social login + embedded wallet |
| **Smart Account** | Kernel + Permissionless | ERC-4337 account abstraction |
| **Gas Sponsorship** | Pimlico | Paymaster for gasless transactions |
| **Blockchain** | Base Sepolia | L2 testnet (~2s block times) |
| **Storage** | IPFS via Pinata | Decentralized content storage |
| **Encryption** | Web Crypto API | AES-256-GCM with HKDF key derivation |
| **ZK Proofs** | Semaphore V4 | Anonymous group membership attestations |
| **Ethereum Client** | viem | Lightweight Ethereum interaction |
| **Local DB** | Dexie (IndexedDB) | Client-side persistence |
| **QR Codes** | qrcode + html5-qrcode | Group invite generation/scanning |

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Accounts/API keys:
  - [Privy](https://dashboard.privy.io) - App ID and Client ID
  - [Pimlico](https://dashboard.pimlico.io) - API Key for Base Sepolia
  - [Pinata](https://pinata.cloud) - JWT for IPFS uploads

### Local Development

1. **Clone and install**:
   ```bash
   git clone https://github.com/yourusername/witness.git
   cd witness/witness-pwa
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run dev server**:
   ```bash
   npm run dev
   # Open http://localhost:5173
   ```

   Camera APIs require localhost or HTTPS to function.

### Production Build

```bash
cd witness-pwa
npm run build
# Output: dist/
```

### Deployment

**Server**: Hetzner VPS (46.62.231.168)
**Domain**: https://witness.squirrlylabs.xyz
**Web Server**: nginx with Let's Encrypt SSL

Deploy latest build:
```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

Service worker updates propagate automatically. For PWA home screen apps, users may need to delete and re-add the app to see major updates.

## 📜 Smart Contract

**WitnessRegistry.sol** on Base Sepolia:
- User registration with on-chain identity
- Group management (parallel Semaphore groups for ZK attestations)
- Content commitment (merkle roots + manifest CIDs)
- Anonymous attestation verification

**Deployed Address**: [`0xd68f0B67c158a1e862Fe7fAc0d58302D21220b78`](https://sepolia.basescan.org/address/0xd68f0B67c158a1e862Fe7fAc0d58302D21220b78)

### Deploy Contract

From project root:
```bash
cd contracts && export $(grep -v '^#' ../.env | grep -v '^$' | xargs) && \
  forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url base-sepolia --broadcast --verify -vvvv
```

See [CLAUDE.md](./CLAUDE.md) for detailed deployment instructions.

## 📚 Key Documentation

- **[Architecture Overview](docs/architecture/README.md)** - System design and component interaction
- **[Architecture v3 (Vision)](docs/planning/witness-protocol-architecture-v3.md)** - Full hackathon architecture
- **[Anonymous Attestations](docs/architecture/anonymous-attestations.md)** - ZK proof system using Semaphore
- **[Encryption & Key Derivation](docs/architecture/encryption-key-derivation.md)** - Cryptographic design
- **[Content Storage](docs/architecture/content-storage.md)** - IPFS + on-chain architecture
- **[Shipped Plans](docs/plans/Shipped/)** - Completed implementation plans for Phases 0-7
- **[Current Plans](docs/plans/Current/)** - In-progress milestone work

## 🎨 How It Works

1. **Create Account**: Email/social login via Privy → embedded wallet → Kernel smart account
2. **Create or Join Group**: Generate QR invite or scan one to join a trusted contact group
3. **Record Evidence**: Video chunks encrypt and upload to IPFS in real-time, merkle root commits on-chain
4. **Share & Verify**: Group members decrypt content, verify integrity, and attest anonymously using ZK proofs
5. **Privacy Preserved**: Content stays encrypted, attestor identities hidden, only attestation count is public

## 🔐 Privacy Model

The system uses **two-layer privacy**:

| Layer | Purpose | What's Public | What's Private |
|-------|---------|---------------|----------------|
| **Access Control** | Who can decrypt | Group membership (addresses) | Content (encrypted) |
| **Attestations** | Verification proofs | Attestation count | Who attested (ZK proofs) |

This allows public proof that "N people verified this content" while maintaining complete anonymity for attestors.

## 📱 iOS Safari Limitations

- **WebM format**: Not supported for saving to Photos (only Files app)
- **MediaRecorder**: Only `video/mp4` format supported
- **Service Worker**: PWA updates require home screen app deletion/re-add

## 🐛 Known Issues & Limitations

This is a hackathon project with rapid iteration. See [Technical Decisions & Limitations](docs/architecture/technical-decisions-and-limitations.md) for current constraints.

## 🤝 Contributing

This project is in active hackathon development. If you're interested in contributing:
- Check [Current Plans](docs/plans/Current/) for in-progress work
- See [CLAUDE.md](./CLAUDE.md) for development guidelines
- Review [Architecture docs](docs/architecture/) to understand the system

## 📞 Contact

Contact me at: [beau@squirrlylabs.xyz](mailto:beau@squirrlylabs.xyz)

## 📄 License

MIT
