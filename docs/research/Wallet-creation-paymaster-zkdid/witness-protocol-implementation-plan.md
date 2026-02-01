# Witness Protocol: Implementation Plan v4

## Purpose

This document provides context for a planning agent to build Witness Protocol incrementally. The goal is **working software at each phase**—not a big bang integration.

---

## Core Concept

Witness Protocol lets users capture video evidence that is:
- **Encrypted**: Only authorized viewers can decrypt
- **Immutable**: Merkle root on-chain proves content hasn't changed
- **Shareable**: Groups can be created where all members can view each other's content

---

## User Flows (What We're Building)

### Flow 1: Solo User (Phase 1 Target)

```
┌─────────────────────────────────────────────────────────────────────┐
│ SOLO USER FLOW                                                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. USER OPENS APP (first time)                                     │
│     └─► See "Get Started" screen                                    │
│     └─► Tap "Create Account"                                        │
│                                                                     │
│  2. AUTHENTICATION (Privy)                                          │
│     └─► Choose: Email, Google, Apple                                │
│     └─► Complete auth flow                                          │
│     └─► Privy creates embedded EOA (invisible to user)              │
│     └─► Privy creates Kernel smart account (invisible to user)      │
│     └─► User sees: "Account created!" + their address               │
│                                                                     │
│  3. RECORD VIDEO (future phase, but informs wallet design)          │
│     └─► Tap record button                                           │
│     └─► Video encrypted with key derived from wallet signature      │
│     └─► Uploaded to IPFS                                            │
│     └─► Merkle root committed on-chain (gasless)                    │
│                                                                     │
│  4. VIEW MY VIDEOS                                                  │
│     └─► List shows videos I recorded                                │
│     └─► Tap to decrypt + play                                       │
│     └─► Only I can decrypt (my wallet signature = my key)           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Flow 2: Group Creator (Phase 2 Target)

```
┌─────────────────────────────────────────────────────────────────────┐
│ GROUP CREATOR FLOW                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  PREREQUISITE: User has completed solo flow (has account)           │
│                                                                     │
│  1. CREATE GROUP                                                    │
│     └─► Tap "Create Group"                                          │
│     └─► Enter group name (local only, not on-chain)                 │
│     └─► App generates groupSecret (32 random bytes)                 │
│     └─► App derives groupId = keccak256(groupSecret)                │
│     └─► App calls contract: createGroup(groupId)                    │
│     └─► App stores groupSecret + groupName locally                  │
│                                                                     │
│  2. INVITE MEMBERS                                                  │
│     └─► Tap "Invite to Group"                                       │
│     └─► App shows QR code containing:                               │
│         {                                                           │
│           groupSecret: "0x...",                                     │
│           groupId: "0x...",                                         │
│           groupName: "Family Safety",                               │
│           chainId: 84532,                                           │
│           registryAddress: "0x..."                                  │
│         }                                                           │
│     └─► Other user scans QR (see Flow 3)                            │
│                                                                     │
│  3. RECORD VIDEO (now goes to group)                                │
│     └─► Select which groups to share with (checkboxes)              │
│     └─► Video encrypted with random key                             │
│     └─► Random key wrapped for each selected group                  │
│     └─► Uploaded to IPFS                                            │
│     └─► Merkle root committed on-chain with groupIds                │
│                                                                     │
│  4. VIEW GROUP VIDEOS                                               │
│     └─► See all videos shared with groups I'm in                    │
│     └─► Unwrap key using groupSecret, decrypt, play                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Flow 3: Group Joiner (Phase 2 Target)

```
┌─────────────────────────────────────────────────────────────────────┐
│ GROUP JOINER FLOW                                                    │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  PREREQUISITE: May or may not have account yet                      │
│                                                                     │
│  1. SCAN QR CODE                                                    │
│     └─► Tap "Join Group" or camera auto-detects                     │
│     └─► Scan QR from group creator                                  │
│     └─► App parses groupSecret, groupId, etc.                       │
│                                                                     │
│  2. IF NO ACCOUNT: Create one first (Flow 1, steps 1-2)             │
│                                                                     │
│  3. JOIN GROUP                                                      │
│     └─► App calls contract: joinGroup(groupId)                      │
│     └─► App stores groupSecret + groupName locally                  │
│     └─► User sees: "Joined Family Safety!"                          │
│                                                                     │
│  4. VIEW + RECORD                                                   │
│     └─► Can now see all videos shared with this group               │
│     └─► New recordings can be shared with this group                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Technical Decisions (Already Made)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Auth provider | Privy | Email/social login, embedded wallets, smart account support |
| Smart account | Kernel (ERC-4337) | Privy default, well-supported |
| Paymaster | Pimlico on Base Sepolia | Gasless UX, good free tier |
| Chain | Base Sepolia (testnet) | ~2s block time, good for streaming commits |
| Group membership | Address-based | Simple access control, who can decrypt |
| **Anonymous attestations** | **Semaphore V4** | **ZK proofs: "N attested" without revealing who** |
| Storage | IPFS via Pinata | Decentralized, content-addressed |
| Encryption | AES-256-GCM | Standard, fast, authenticated |
| Key wrapping | AES-GCM wrap | Simple, enables multi-group |
| On-chain data | Merkle roots + attestation counts | Minimal on-chain footprint |

### The Two-Layer Privacy Model (Core Architecture)

We use **two parallel systems** for different privacy needs:

```
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 1: ACCESS CONTROL (Address-Based, Simple)                    │
├─────────────────────────────────────────────────────────────────────┤
│  • mapping(groupId => mapping(address => bool)) members             │
│  • Public: who is in which group                                    │
│  • Private: content (encrypted with groupSecret)                    │
│  • Purpose: control who can DECRYPT                                 │
└─────────────────────────────────────────────────────────────────────┘
                              +
┌─────────────────────────────────────────────────────────────────────┐
│  LAYER 2: ATTESTATIONS (Semaphore ZK, Anonymous)                    │
├─────────────────────────────────────────────────────────────────────┤
│  • Semaphore group mirrors each witness group                       │
│  • Identity commitment added when user joins                        │
│  • Public: attestation COUNT per content                            │
│  • Private: WHO attested (ZK proof)                                 │
│  • Purpose: prove N people vouched WITHOUT revealing identities     │
└─────────────────────────────────────────────────────────────────────┘
```

| Layer | Technology | What's Public | What's Private |
|-------|------------|---------------|----------------|
| Access Control | Address-based groups | Group membership | Content (encrypted) |
| Attestations | Semaphore ZK proofs | Attestation COUNT | WHO attested |

### Why This Architecture?

**Group membership being public is acceptable** because:
- It doesn't reveal content (encrypted)
- It doesn't reveal who downloaded/viewed (no tracking)
- It doesn't reveal who vouched (Semaphore)

**Attestations being anonymous is the differentiator:**
- Proves evidence has been verified by N group members
- Nobody (not even uploader) knows which N
- Each member can only attest once (nullifier prevents double-counting)
- Sybil-resistant: only actual group members can attest

### The Hackathon Demo Narrative

> "Alice uploads evidence to her Family Safety group. Three members download it, verify it's unmodified, and attest. The blockchain now shows: **'3 verified attestations from group members'**—but nobody can determine which three. Not the public, not Alice, not even the attestors themselves can prove they attested. The count is real, verifiable, and completely anonymous."

This is the "wow factor" that makes this more than "encrypted IPFS + merkle root."

---

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        COMPONENT LAYERS                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      UI LAYER (React/Expo)                   │   │
│  │  • Screens: Onboarding, Record, Videos, Groups, Settings     │   │
│  │  • Components: VideoPlayer, QRScanner, GroupSelector         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    HOOKS LAYER (React)                       │   │
│  │  • useAuth: login state, user info                           │   │
│  │  • useWallet: signing, transactions                          │   │
│  │  • useGroups: group membership, secrets                      │   │
│  │  • useContent: videos, encryption, upload                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   SERVICE LAYER (TypeScript)                 │   │
│  │  • PrivyService: auth, wallet access                         │   │
│  │  • ContractService: registry interactions                    │   │
│  │  • EncryptionService: encrypt, decrypt, key wrapping         │   │
│  │  • IPFSService: upload, download, pinning                    │   │
│  │  • StorageService: local persistence (MMKV)                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  EXTERNAL SERVICES                           │   │
│  │  • Privy (auth + wallets)                                    │   │
│  │  • Pimlico (bundler + paymaster)                             │   │
│  │  • Pinata (IPFS pinning)                                     │   │
│  │  • Base Sepolia RPC                                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  SMART CONTRACT (Solidity)                   │   │
│  │  • WitnessRegistry.sol                                       │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Build Phases

### Phase 0: Project Setup
**Goal**: Empty app that runs, with all dependencies installed

**Tasks**:
1. Initialize Expo project with TypeScript
2. Install Privy SDK (`@privy-io/expo`)
3. Install crypto libraries (`@noble/ciphers`, `@noble/hashes`)
4. Install viem for contract interactions
5. Set up environment variables structure
6. Create folder structure (screens, hooks, services, contracts)

**Acceptance Criteria**:
- `npm run start` launches app
- No runtime errors
- Environment variables loading correctly

**Dependencies**: None

---

### Phase 1: Account Creation & Wallet
**Goal**: User can create account, see their address, sign a message

**Tasks**:

#### 1.1 Privy Configuration
```typescript
// services/privy.ts
- Configure PrivyProvider with:
  - App ID (from Privy dashboard)
  - Login methods: email, google, apple
  - Embedded wallet: createOnLogin: 'all-users'
  - Smart wallet: enabled, type: 'kernel'
  - Chain: Base Sepolia
```

#### 1.2 Auth Hook
```typescript
// hooks/useAuth.ts
interface UseAuth {
  isReady: boolean;           // Privy SDK loaded
  isAuthenticated: boolean;   // User logged in
  user: PrivyUser | null;     // User object
  login: () => Promise<void>; // Trigger login modal
  logout: () => Promise<void>;
}
```

#### 1.3 Wallet Hook
```typescript
// hooks/useWallet.ts
interface UseWallet {
  address: string | null;           // Smart account address
  eoaAddress: string | null;        // Embedded EOA address
  isDeployed: boolean;              // Smart account deployed?
  signMessage: (msg: string) => Promise<string>;
  signTypedData: (data: TypedData) => Promise<string>;
}
```

#### 1.4 Onboarding Screen
```
┌─────────────────────────────┐
│                             │
│     🛡️ Witness Protocol     │
│                             │
│   Secure evidence capture   │
│   with blockchain proof     │
│                             │
│   ┌─────────────────────┐   │
│   │   Get Started       │   │
│   └─────────────────────┘   │
│                             │
│   Already have account?     │
│   [Sign In]                 │
│                             │
└─────────────────────────────┘
```

#### 1.5 Home Screen (Authenticated)
```
┌─────────────────────────────┐
│ Witness Protocol      [⚙️]  │
├─────────────────────────────┤
│                             │
│  Welcome!                   │
│                             │
│  Your address:              │
│  0x1234...5678 [📋]         │
│                             │
│  Wallet status:             │
│  ✅ Ready                   │
│                             │
│  ┌─────────────────────┐   │
│  │   Test Signature    │   │
│  └─────────────────────┘   │
│                             │
│  Signature result:          │
│  (appears after signing)    │
│                             │
└─────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] User can tap "Get Started" and see Privy login modal
- [ ] User can authenticate with email
- [ ] After auth, user sees their smart account address
- [ ] User can tap "Test Signature" and sign a message
- [ ] Signature appears on screen
- [ ] User can logout and login again
- [ ] Address persists across app restarts

**Dependencies**: Privy dashboard setup, Base Sepolia RPC

---

### Phase 2: Smart Contract & On-Chain Registration
**Goal**: User registration recorded on-chain, gasless

**Tasks**:

#### 2.1 Smart Contract
```solidity
// contracts/WitnessRegistry.sol
contract WitnessRegistry {
    // User registration
    mapping(address => bool) public registered;
    mapping(address => uint256) public registeredAt;
    
    // Group management
    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(address => bool)) public groupMembers;
    
    // Content commitments
    mapping(bytes32 => ContentCommitment) public content;
    mapping(bytes32 => bytes32[]) public groupContentIndex;
    mapping(address => bytes32[]) public userContentIndex;
    
    function register() external;
    function createGroup(bytes32 groupId) external;
    function joinGroup(bytes32 groupId) external;
    function commitContent(
        bytes32 contentId,
        bytes32 merkleRoot,
        string calldata manifestCID,
        bytes32[] calldata groupIds
    ) external;
}
```

#### 2.2 Contract Deployment
- Deploy to Base Sepolia using Foundry
- Verify on Basescan
- Record deployed address in environment

#### 2.3 Contract Service
```typescript
// services/contract.ts
interface ContractService {
  // Read functions (no gas)
  isRegistered(address: string): Promise<boolean>;
  getGroups(address: string): Promise<Group[]>;
  getContent(contentId: string): Promise<ContentCommitment>;
  
  // Write functions (gasless via paymaster)
  register(): Promise<TxHash>;
  createGroup(groupId: string): Promise<TxHash>;
  joinGroup(groupId: string): Promise<TxHash>;
  commitContent(params: CommitParams): Promise<TxHash>;
}
```

#### 2.4 Paymaster Integration
```typescript
// services/paymaster.ts
- Configure Pimlico bundler URL
- Configure paymaster (sponsorship policy)
- Wrap Privy's sendTransaction with paymaster context
```

#### 2.5 Registration Flow
```typescript
// hooks/useRegistration.ts
interface UseRegistration {
  isRegistered: boolean;
  isLoading: boolean;
  register: () => Promise<void>;
  registrationTx: string | null;
}
```

#### 2.6 Updated Home Screen
```
┌─────────────────────────────┐
│ Witness Protocol      [⚙️]  │
├─────────────────────────────┤
│                             │
│  Your address:              │
│  0x1234...5678 [📋]         │
│                             │
│  Registration:              │
│  ⏳ Not registered          │
│                             │
│  ┌─────────────────────┐   │
│  │   Register On-Chain │   │  ← Gasless!
│  └─────────────────────┘   │
│                             │
│  (after registration)       │
│  ✅ Registered              │
│  Block: 12345678            │
│  Tx: 0xabc...def [🔗]       │
│                             │
└─────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] Contract deployed to Base Sepolia
- [ ] User can tap "Register" and transaction submits
- [ ] Transaction is gasless (user pays nothing)
- [ ] Registration status updates after tx confirms
- [ ] Can view transaction on Basescan

**Dependencies**: Phase 1, Pimlico API key, Foundry setup

---

### Phase 3: Local Storage & Key Derivation
**Goal**: Derive encryption keys from wallet, persist securely

**Tasks**:

#### 3.1 Storage Service
```typescript
// services/storage.ts (using MMKV)
interface StorageService {
  // Secure storage (encrypted)
  setSecure(key: string, value: string): void;
  getSecure(key: string): string | null;
  
  // Regular storage
  set(key: string, value: any): void;
  get<T>(key: string): T | null;
  
  // Typed accessors
  getGroupSecrets(): Record<string, GroupSecret>;
  setGroupSecret(groupId: string, secret: GroupSecret): void;
}
```

#### 3.2 Key Derivation Service
```typescript
// services/encryption.ts
interface EncryptionService {
  // Derive personal encryption key from wallet signature
  derivePersonalKey(walletSignature: string): Promise<Uint8Array>;
  
  // Generate random group secret
  generateGroupSecret(): Uint8Array;
  
  // Derive group ID from secret
  deriveGroupId(groupSecret: Uint8Array): string;
  
  // Encrypt/decrypt content
  encrypt(data: Uint8Array, key: Uint8Array): Promise<EncryptedData>;
  decrypt(encrypted: EncryptedData, key: Uint8Array): Promise<Uint8Array>;
  
  // Key wrapping for multi-group
  wrapKey(videoKey: Uint8Array, groupSecret: Uint8Array): WrappedKey;
  unwrapKey(wrapped: WrappedKey, groupSecret: Uint8Array): Uint8Array;
}
```

#### 3.3 Key Derivation Hook
```typescript
// hooks/useEncryption.ts
interface UseEncryption {
  isReady: boolean;              // Personal key derived
  deriveKeys: () => Promise<void>; // Trigger derivation
  encrypt: (data: Uint8Array) => Promise<EncryptedData>;
  decrypt: (encrypted: EncryptedData) => Promise<Uint8Array>;
}
```

#### 3.4 Test Encryption Screen
```
┌─────────────────────────────┐
│ Encryption Test       [←]   │
├─────────────────────────────┤
│                             │
│  Personal Key:              │
│  ✅ Derived                 │
│                             │
│  Test encryption:           │
│  ┌─────────────────────┐   │
│  │ Enter test message  │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │   Encrypt & Decrypt │   │
│  └─────────────────────┘   │
│                             │
│  Result:                    │
│  Original: "hello"          │
│  Encrypted: 0x8f3a...       │
│  Decrypted: "hello" ✅      │
│                             │
└─────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] Personal key derived from wallet signature
- [ ] Key persists securely (don't re-derive on every app open)
- [ ] Can encrypt and decrypt test data
- [ ] Encryption is deterministic (same input = same output with same key)

**Dependencies**: Phase 1

---

### Phase 4: Group Creation & Joining
**Goal**: Create groups, share via QR, join groups

**Tasks**:

#### 4.1 Group Service
```typescript
// services/groups.ts
interface GroupService {
  createGroup(name: string): Promise<{
    groupId: string;
    groupSecret: Uint8Array;
    txHash: string;
  }>;
  
  joinGroup(groupSecret: Uint8Array, groupId: string): Promise<{
    txHash: string;
  }>;
  
  generateInviteQR(groupId: string): string; // QR data
  parseInviteQR(data: string): GroupInvite;
}
```

#### 4.2 Groups Hook
```typescript
// hooks/useGroups.ts
interface UseGroups {
  groups: Group[];                    // All groups user is in
  createGroup: (name: string) => Promise<void>;
  joinGroup: (invite: GroupInvite) => Promise<void>;
  getGroupSecret: (groupId: string) => Uint8Array | null;
}
```

#### 4.3 Groups Screen
```
┌─────────────────────────────┐
│ My Groups             [←]   │
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐   │
│  │ 👨‍👩‍👧‍👦 Family Safety    │   │
│  │ 3 members · 12 videos│   │
│  │ Created by you       │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │ 📰 Journalist Net   │   │
│  │ 8 members · 45 videos│   │
│  │ Joined 2 days ago    │   │
│  └─────────────────────┘   │
│                             │
│  ──────────────────────────│
│                             │
│  ┌─────────────────────┐   │
│  │   + Create Group    │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │   📷 Scan to Join   │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

#### 4.4 Create Group Flow
```
┌─────────────────────────────┐
│ Create Group          [←]   │
├─────────────────────────────┤
│                             │
│  Group name:                │
│  ┌─────────────────────┐   │
│  │ Family Safety       │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │   Create Group      │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘

         ↓ (after creation)

┌─────────────────────────────┐
│ Invite Members        [←]   │
├─────────────────────────────┤
│                             │
│  Group created! ✅          │
│                             │
│  Share this QR code:        │
│                             │
│      ┌─────────────┐        │
│      │ ▄▄▄ ▄▄▄ ▄▄ │        │
│      │ █▄█ ▄▄▄ █▄█│        │
│      │ ▄▄▄ █▄█ ▄▄▄│        │
│      └─────────────┘        │
│                             │
│  Anyone who scans this      │
│  can join and view videos   │
│                             │
│  ┌─────────────────────┐   │
│  │      Done           │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

#### 4.5 Join Group Flow
```
┌─────────────────────────────┐
│ Scan QR Code          [×]   │
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐   │
│  │                     │   │
│  │    [Camera View]    │   │
│  │                     │   │
│  │    Point at QR      │   │
│  │                     │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘

         ↓ (after scan)

┌─────────────────────────────┐
│ Join Group?           [×]   │
├─────────────────────────────┤
│                             │
│  You're invited to:         │
│                             │
│  👨‍👩‍👧‍👦 Family Safety          │
│                             │
│  You'll be able to:         │
│  • View videos shared here  │
│  • Share your videos here   │
│                             │
│  ┌─────────────────────┐   │
│  │   Join Group        │   │
│  └─────────────────────┘   │
│                             │
│  [Cancel]                   │
│                             │
└─────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] User can create a group with a name
- [ ] Group creation is gasless
- [ ] Group creation also creates parallel Semaphore group
- [ ] QR code displays with invite data
- [ ] Second device can scan QR and parse invite
- [ ] Second device can join group (gasless)
- [ ] Joining group also adds identity commitment to Semaphore group
- [ ] Both devices show group in their list
- [ ] Group secrets stored locally and persist
- [ ] Semaphore identity created/stored when user first joins any group

**Dependencies**: Phase 2, Phase 3, QR scanning library, @semaphore-protocol packages

---

### Phase 5: Content Upload (IPFS + On-Chain Commit)
**Goal**: Encrypt content, upload to IPFS, commit merkle root on-chain

**Tasks**:

#### 5.1 IPFS Service
```typescript
// services/ipfs.ts
interface IPFSService {
  uploadEncrypted(data: EncryptedData): Promise<string>; // Returns CID
  uploadManifest(manifest: VideoManifest): Promise<string>;
  download(cid: string): Promise<Uint8Array>;
}
```

#### 5.2 Content Service
```typescript
// services/content.ts
interface ContentService {
  // Full upload flow
  uploadVideo(
    videoData: Uint8Array,
    selectedGroupIds: string[],
    metadata: VideoMetadata
  ): Promise<{
    contentId: string;
    manifestCID: string;
    merkleRoot: string;
    txHash: string;
  }>;
  
  // Build manifest with wrapped keys
  buildManifest(
    chunks: EncryptedChunk[],
    selectedGroups: GroupAccess[],
    metadata: VideoMetadata
  ): VideoManifest;
}
```

#### 5.3 Upload Hook
```typescript
// hooks/useUpload.ts
interface UseUpload {
  isUploading: boolean;
  progress: number;              // 0-100
  currentStep: UploadStep;       // 'encrypting' | 'uploading' | 'committing'
  upload: (video: VideoData, groupIds: string[]) => Promise<void>;
  lastUpload: UploadResult | null;
}
```

#### 5.4 Test Upload Screen (Text First, Video Later)
```
┌─────────────────────────────┐
│ Test Upload           [←]   │
├─────────────────────────────┤
│                             │
│  Test content:              │
│  ┌─────────────────────┐   │
│  │ This is test data   │   │
│  └─────────────────────┘   │
│                             │
│  Share with:                │
│  [✓] Family Safety          │
│  [ ] Journalist Net         │
│                             │
│  ┌─────────────────────┐   │
│  │   Upload & Commit   │   │
│  └─────────────────────┘   │
│                             │
│  Progress:                  │
│  ████████░░░░░░░░ 50%       │
│  Uploading to IPFS...       │
│                             │
│  Result:                    │
│  ✅ Content ID: 0x123...    │
│  ✅ IPFS CID: Qm...         │
│  ✅ Tx: 0xabc... [🔗]       │
│                             │
└─────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] Can encrypt test data for selected groups
- [ ] Encrypted data uploads to Pinata
- [ ] Manifest with wrapped keys uploads to Pinata
- [ ] Merkle root commits on-chain (gasless)
- [ ] Content indexed under selected groups

**Dependencies**: Phase 3, Phase 4, Pinata API key

---

### Phase 6: Content Discovery & Decryption
**Goal**: List content, download from IPFS, decrypt and display

**Tasks**:

#### 6.1 Content Discovery Hook
```typescript
// hooks/useContent.ts
interface UseContent {
  // Personal content (ungrouped)
  personalContent: ContentItem[];
  
  // Group content (from all groups user is in)
  groupContent: Record<string, ContentItem[]>;
  
  // Refresh
  refresh: () => Promise<void>;
  isLoading: boolean;
}
```

#### 6.2 Decryption Flow
```typescript
// services/content.ts
interface ContentService {
  // ... previous methods ...
  
  downloadAndDecrypt(
    contentId: string,
    manifest: VideoManifest,
    groupSecrets: GroupAccess[]  // All groups user has secrets for
  ): Promise<Uint8Array>;
}
```

#### 6.3 Content List Screen
```
┌─────────────────────────────┐
│ Evidence              [⚙️]  │
├─────────────────────────────┤
│  [All] [Family] [Journalist]│
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐   │
│  │ 📹 Jan 30, 3:45 PM  │   │
│  │ Family Safety       │   │
│  │ Uploaded by you     │   │
│  │ ✅ Verified         │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │ 📹 Jan 29, 11:20 AM │   │
│  │ Family Safety       │   │
│  │ Uploaded by 0x789...│   │
│  │ ✅ Verified         │   │
│  └─────────────────────┘   │
│                             │
│  ┌─────────────────────┐   │
│  │ 📹 Jan 28, 9:00 PM  │   │
│  │ Personal            │   │
│  │ ✅ Verified         │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

#### 6.4 Content Detail Screen
```
┌─────────────────────────────┐
│ Evidence Detail       [←]   │
├─────────────────────────────┤
│                             │
│  ┌─────────────────────┐   │
│  │                     │   │
│  │   [Decrypted        │   │
│  │    Content          │   │
│  │    Preview]         │   │
│  │                     │   │
│  └─────────────────────┘   │
│                             │
│  Uploaded: Jan 30, 3:45 PM  │
│  By: 0x1234...5678 (you)    │
│                             │
│  Shared with:               │
│  • Family Safety            │
│                             │
│  Verification:              │
│  ✅ Merkle proof valid      │
│  ✅ On-chain since block    │
│     #12345678               │
│                             │
│  ┌─────────────────────┐   │
│  │  View on Basescan   │   │
│  └─────────────────────┘   │
│                             │
└─────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] List shows all content user has access to
- [ ] Can filter by group
- [ ] Tapping content fetches from IPFS
- [ ] Content decrypts using appropriate group secret
- [ ] Merkle proof verification works
- [ ] Shows which groups content is shared with

**Dependencies**: Phase 5

---

### Phase 7: Anonymous Attestations (Semaphore) — THE DIFFERENTIATOR
**Goal**: Group members can attest to evidence anonymously, proving "N people vouched" without revealing who

This is the hackathon's key innovation. Everything before this is table stakes; this is what makes the project compelling.

**Tasks**:

#### 7.1 Semaphore Setup
```bash
npm install @semaphore-protocol/core @semaphore-protocol/proof @semaphore-protocol/identity
```

#### 7.2 Identity Service
```typescript
// services/identity.ts
import { Identity } from "@semaphore-protocol/core";

interface IdentityService {
  // Create identity from wallet signature (deterministic)
  createIdentity(walletSignature: string): Identity;
  
  // Get commitment for group registration
  getCommitment(identity: Identity): bigint;
  
  // Store/retrieve identity locally (encrypted)
  storeIdentity(identity: Identity): void;
  getIdentity(): Identity | null;
}

// Implementation
function createIdentity(walletSignature: string): Identity {
  // Deterministic: same signature = same identity
  // This allows recovery if user reinstalls app
  const seed = keccak256(walletSignature);
  return new Identity(seed);
}
```

#### 7.3 Updated Smart Contract (with Semaphore)
```solidity
// contracts/WitnessRegistry.sol
import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

contract WitnessRegistry {
    ISemaphore public semaphore;
    
    // Map our groupId to Semaphore groupId
    mapping(bytes32 => uint256) public semaphoreGroupId;
    
    // Attestation tracking
    mapping(bytes32 => uint256) public attestationCount;  // contentId => count
    mapping(bytes32 => bool) public nullifierUsed;        // prevent double-attestation
    
    event AttestationCreated(
        bytes32 indexed contentId,
        bytes32 indexed groupId,
        uint256 newCount
    );
    
    function createGroup(bytes32 groupId) external {
        // ... existing group creation ...
        
        // Create parallel Semaphore group
        uint256 semGroupId = uint256(groupId);
        semaphore.createGroup(semGroupId, address(this));
        semaphoreGroupId[groupId] = semGroupId;
    }
    
    function joinGroup(bytes32 groupId, uint256 identityCommitment) external {
        // ... existing membership check ...
        
        // Add to Semaphore group
        uint256 semGroupId = semaphoreGroupId[groupId];
        semaphore.addMember(semGroupId, identityCommitment);
    }
    
    function attestToContent(
        bytes32 contentId,
        bytes32 groupId,
        ISemaphore.SemaphoreProof calldata proof
    ) external {
        // Verify content exists and is shared with this group
        require(isContentInGroup(contentId, groupId), "Content not in group");
        
        // Verify nullifier not used (prevents double-attestation)
        bytes32 nullifierHash = bytes32(proof.nullifier);
        require(!nullifierUsed[nullifierHash], "Already attested");
        
        // Verify ZK proof
        // scope = contentId ensures nullifier is content-specific
        uint256 semGroupId = semaphoreGroupId[groupId];
        semaphore.validateProof(semGroupId, proof);
        
        // Record attestation
        nullifierUsed[nullifierHash] = true;
        attestationCount[contentId]++;
        
        emit AttestationCreated(contentId, groupId, attestationCount[contentId]);
    }
}
```

#### 7.4 Attestation Service
```typescript
// services/attestation.ts
import { generateProof } from "@semaphore-protocol/proof";
import { Group } from "@semaphore-protocol/core";

interface AttestationService {
  // Generate ZK proof for attestation
  generateAttestationProof(
    identity: Identity,
    group: Group,
    contentId: string
  ): Promise<SemaphoreProof>;
  
  // Submit attestation on-chain
  submitAttestation(
    contentId: string,
    groupId: string,
    proof: SemaphoreProof
  ): Promise<TxHash>;
  
  // Get attestation count for content
  getAttestationCount(contentId: string): Promise<number>;
}

async function generateAttestationProof(
  identity: Identity,
  group: Group,
  contentId: string
): Promise<SemaphoreProof> {
  // scope = contentId ensures each content has unique nullifiers
  // This means: same user can attest to different content,
  // but cannot attest to same content twice
  const scope = BigInt(contentId);
  const message = BigInt(contentId);  // What we're attesting to
  
  return generateProof(identity, group, message, scope);
}
```

#### 7.5 Attestation Hook
```typescript
// hooks/useAttestation.ts
interface UseAttestation {
  // Attest to content (generates proof + submits)
  attest: (contentId: string, groupId: string) => Promise<void>;
  isAttesting: boolean;
  
  // Check if current user has attested (via local storage, not on-chain)
  hasAttested: (contentId: string) => boolean;
  
  // Get count from chain
  getCount: (contentId: string) => Promise<number>;
}
```

#### 7.6 Updated Content Detail Screen (with Attestations)
```
┌─────────────────────────────────────┐
│ Evidence Detail               [←]   │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐   │
│  │                             │   │
│  │   [Decrypted Content]       │   │
│  │                             │   │
│  └─────────────────────────────┘   │
│                                     │
│  Uploaded: Jan 30, 3:45 PM          │
│  By: 0x1234...5678                  │
│                                     │
│  Shared with:                       │
│  • Family Safety (5 members)        │
│                                     │
│  ════════════════════════════════   │
│  ANONYMOUS ATTESTATIONS             │
│  ════════════════════════════════   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │  🛡️  3 group members have   │   │
│  │     verified this evidence  │   │
│  │                             │   │
│  │  Identities are private.    │   │
│  │  Only the count is public.  │   │
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │   🔐 Attest to Evidence     │   │  ← ZK proof generated
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │    View on Basescan        │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

#### 7.7 Attestation Flow Diagram
```
┌─────────────────────────────────────────────────────────────────────┐
│                    ATTESTATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. User views content they have access to                          │
│                                                                     │
│  2. User taps "Attest to Evidence"                                  │
│                                                                     │
│  3. Client-side:                                                    │
│     a. Load user's Semaphore identity (from local storage)          │
│     b. Fetch group's merkle tree from chain                         │
│     c. Generate ZK proof:                                           │
│        - Proves: "I know a secret in this group's tree"             │
│        - scope = contentId (makes nullifier content-specific)       │
│        - Output: proof + nullifier                                  │
│                                                                     │
│  4. Submit to contract:                                             │
│     attestToContent(contentId, groupId, proof)                      │
│                                                                     │
│  5. Contract verifies:                                              │
│     - Proof is valid (ZK verification)                              │
│     - Nullifier not used (no double-attest)                         │
│     - Content is shared with group                                  │
│                                                                     │
│  6. Contract updates:                                               │
│     attestationCount[contentId]++                                   │
│     nullifierUsed[nullifier] = true                                 │
│                                                                     │
│  7. Event emitted:                                                  │
│     AttestationCreated(contentId, groupId, count)                   │
│                                                                     │
│  WHAT'S PUBLIC:                                                     │
│  • Content has N attestations                                       │
│  • Attestations came from group members                             │
│                                                                     │
│  WHAT'S PRIVATE:                                                    │
│  • Which members attested                                           │
│  • When each attestation was made (all look the same)               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Acceptance Criteria**:
- [ ] Identity commitment created when user registers
- [ ] Commitment added to Semaphore group when user joins our group
- [ ] User can generate ZK attestation proof client-side
- [ ] Proof verifies on-chain
- [ ] Attestation count increments
- [ ] Same user cannot attest twice to same content (nullifier)
- [ ] Same user CAN attest to different content
- [ ] UI shows attestation count
- [ ] No way to determine WHO attested (verify manually!)

**Dependencies**: Phase 4 (groups), Phase 6 (content viewing)

**Technical Notes**:
- Semaphore V4 is the current version
- Proof generation happens client-side (WASM)
- Proof verification happens on-chain
- Gas cost: ~300-400k for attestation (mostly ZK verification)
- Semaphore contracts already deployed on Sepolia

---

### Future Phases (Post-Hackathon)

| Phase | Feature | Complexity | Notes |
|-------|---------|------------|-------|
| 8 | Video capture integration | Medium | Replace test data with actual video |
| 9 | Chunked streaming upload | High | Real-time upload during recording |
| 10 | Real-time notifications (Matrix) | High | Live sync between group members |
| 11 | Multi-group attestation aggregation | Medium | Prove "N total across all groups" |
| 12 | zkDID integration | High | Prove attestor properties |
| 13 | Threshold attestations | Medium | "Release if N attestations" |

---

## Data Models

### On-Chain (Minimal)

```solidity
struct ContentCommitment {
    bytes32 merkleRoot;           // Hash tree root of chunks
    string manifestCID;           // IPFS pointer to full manifest
    address uploader;             // Who uploaded
    uint64 timestamp;             // When committed
    bytes32[] sharedWithGroups;   // Which groups have access
}

struct Group {
    address creator;
    uint64 createdAt;
    uint256 semaphoreGroupId;     // Linked Semaphore group for ZK attestations
    bool active;
}

// Attestation state (no struct needed, just mappings)
// mapping(bytes32 contentId => uint256 count) attestationCount;
// mapping(bytes32 nullifier => bool used) nullifierUsed;
```

### Off-Chain: Video Manifest (IPFS)

```typescript
interface VideoManifest {
  version: 1;
  contentId: string;              // Unique ID
  uploader: string;               // Address
  createdAt: number;              // Unix timestamp
  
  // Encrypted content chunks
  chunks: {
    index: number;
    cid: string;                  // IPFS CID of encrypted chunk
    size: number;                 // Bytes
    plaintextHash: string;        // SHA-256 of original (for verification)
  }[];
  
  // Encryption metadata
  encryption: {
    algorithm: 'aes-256-gcm';
    iv: string;                   // Hex-encoded IV for video encryption
  };
  
  // Access control
  accessList: {
    [groupId: string]: {
      wrappedKey: string;         // AES-GCM wrapped video key
      iv: string;                 // IV used for wrapping
    };
  };
  
  // Integrity
  merkleRoot: string;             // Root of chunk hashes
  
  // Video metadata (encrypted)
  encryptedMetadata?: string;     // GPS, duration, etc.
}
```

### Local Storage (MMKV)

```typescript
interface LocalStorage {
  // User identity
  'user:address': string;
  'user:eoaAddress': string;
  'user:personalKeyHash': string;  // To verify derivation
  
  // Semaphore identity (CRITICAL - must be encrypted!)
  'user:semaphoreIdentity': {
    secret: string;              // Hex-encoded, ENCRYPTED
    commitment: string;          // Public, derived from secret
  };
  
  // Groups
  'groups': {
    [groupId: string]: {
      name: string;
      secret: string;             // Hex-encoded groupSecret
      semaphoreGroupId: string;   // Linked Semaphore group
      joinedAt: number;
      isCreator: boolean;
    };
  };
  
  // Attestations made by this user (local tracking)
  'attestations': {
    [contentId: string]: {
      attestedAt: number;
      groupId: string;
    };
  };
  
  // Content cache
  'content:index': string[];      // Content IDs we know about
  'content:{id}': {
    manifestCID: string;
    cachedManifest?: VideoManifest;
    downloadedAt?: number;
    attestationCount?: number;    // Cached count
  };
}
```

---

## Environment Variables

```env
# Privy
EXPO_PUBLIC_PRIVY_APP_ID=

# Blockchain (Base Sepolia)
EXPO_PUBLIC_CHAIN_ID=84532
EXPO_PUBLIC_RPC_URL=https://sepolia.base.org
EXPO_PUBLIC_REGISTRY_ADDRESS=

# Semaphore (Base Sepolia)
EXPO_PUBLIC_SEMAPHORE_ADDRESS=0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D
EXPO_PUBLIC_SEMAPHORE_VERIFIER_ADDRESS=0x4DeC9E3784EcC1eE002001BfE91deEf4A48931f8

# Pimlico (Paymaster) - Base Sepolia bundler
PIMLICO_API_KEY=

# Pinata (IPFS)
PINATA_JWT=
EXPO_PUBLIC_PINATA_GATEWAY=

# Development
EXPO_PUBLIC_DEBUG=true
```

---

## Testing Checkpoints

After each phase, verify:

| Phase | Checkpoint |
|-------|------------|
| 0 | App runs, no errors |
| 1 | Can login, see address, sign message |
| 2 | Can register on-chain, gasless works |
| 3 | Can derive key, encrypt/decrypt text |
| 4 | Can create group, scan QR, join group + Semaphore group |
| 5 | Can upload encrypted content to IPFS + commit |
| 6 | Can list content, download, decrypt, verify |
| 7 | **Can attest anonymously, count increments, can't double-attest** |

### Phase 7 Specific Verification

To prove the ZK attestation works correctly, verify:

1. **Anonymity**: Have 3 users attest. Check chain - only count visible, not addresses
2. **No double-attest**: Same user tries to attest twice → rejected
3. **Cross-content**: Same user attests to 2 different contents → both succeed
4. **Membership required**: Non-member tries to attest → proof fails

---

## Open Questions (To Resolve During Build)

| Question | Options | Current Leaning |
|----------|---------|-----------------|
| Expo vs React Native CLI? | Expo (faster), RN CLI (more control) | Expo |
| How to handle offline? | Queue uploads, sync later | Defer to future |
| Multiple devices same account? | Privy handles, secrets need sync | Defer to future |
| Group admin controls? | None (simple), creator can remove | None for MVP |
| Max groups per user? | Unlimited, limit of 10, limit of 5 | Unlimited for MVP |
