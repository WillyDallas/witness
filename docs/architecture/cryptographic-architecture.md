# Cryptographic Architecture

A detailed explanation of all cryptographic operations in Witness Protocol: key derivation, encryption, hashing, Merkle trees, and zero-knowledge proofs.

---

## Overview

Witness Protocol uses a layered cryptographic architecture:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CRYPTOGRAPHIC LAYERS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  Layer 1: IDENTITY                                                            │
│  └── Wallet signature → HKDF → Personal encryption key                       │
│  └── Wallet signature → Semaphore identity (for ZK proofs)                   │
│                                                                               │
│  Layer 2: GROUP ACCESS                                                        │
│  └── Random group secrets shared via QR                                       │
│  └── Group ID = SHA-256(group secret)                                         │
│                                                                               │
│  Layer 3: CONTENT PROTECTION                                                  │
│  └── Random content key per recording                                         │
│  └── Content key wrapped for each group                                       │
│  └── Per-chunk keys derived via HKDF                                          │
│                                                                               │
│  Layer 4: INTEGRITY                                                           │
│  └── SHA-256 hashes of content                                                │
│  └── Merkle tree of chunk hashes                                              │
│  └── On-chain root anchoring                                                  │
│                                                                               │
│  Layer 5: ANONYMOUS ATTESTATION                                               │
│  └── Semaphore identity commitments                                           │
│  └── ZK proofs of group membership                                            │
│  └── Nullifiers prevent double-attestation                                    │
│                                                                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Layer 1: Identity & Personal Key Derivation

### The Problem

Users authenticate via email (Privy), but we need a deterministic encryption key that:
- Can be recovered if the user logs in again
- Is unique to this user
- Never leaves the device in plaintext

### The Solution: EIP-712 Signature → HKDF

#### Step 1: Request Typed Signature

We ask the user's embedded wallet to sign a structured message using EIP-712:

```javascript
const typedData = {
  domain: {
    name: 'Witness Protocol',
    version: '1',
    chainId: 84532,  // Base Sepolia
    verifyingContract: '0x0000000000000000000000000000000000000000'
  },
  types: {
    KeyDerivation: [
      { name: 'purpose', type: 'string' },
      { name: 'application', type: 'string' },
      { name: 'version', type: 'uint256' }
    ]
  },
  primaryType: 'KeyDerivation',
  message: {
    purpose: 'Derive encryption key for secure storage',
    application: 'witness-protocol',
    version: 1
  }
};
```

**Why EIP-712?**
- Structured data is human-readable in wallet UI
- Prevents signature reuse across applications
- Domain separator binds to specific chain and contract

#### Step 2: Normalize the Signature

ECDSA signatures have a malleability property: for any valid signature `(r, s)`, the signature `(r, n - s)` is also valid (where `n` is the curve order). We normalize to ensure deterministic key derivation:

```javascript
function normalizeSignature(signature) {
  // secp256k1 curve order
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

  // Parse signature components
  const r = BigInt('0x' + signature.slice(2, 66));
  const s = BigInt('0x' + signature.slice(66, 130));
  const v = parseInt(signature.slice(130, 132), 16);

  // Normalize s to lower half of curve
  const normalizedS = s > n / 2n ? n - s : s;

  // Reconstruct signature
  return '0x' +
    r.toString(16).padStart(64, '0') +
    normalizedS.toString(16).padStart(64, '0') +
    v.toString(16).padStart(2, '0');
}
```

#### Step 3: Derive Key via HKDF

HKDF (HMAC-based Key Derivation Function) extracts entropy from the signature and derives a fixed-length key:

```javascript
async function deriveEncryptionKey(signature) {
  const signatureBytes = hexToBytes(signature);

  // Import signature as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    signatureBytes,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Derive AES-256 key
  const encryptionKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('witness-protocol-v1'),
      info: new TextEncoder().encode('encryption-key')
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,  // Not extractable
    ['encrypt', 'decrypt']
  );

  return encryptionKey;
}
```

**HKDF Parameters:**
- **Hash**: SHA-256
- **Salt**: `"witness-protocol-v1"` (application-specific, prevents cross-application attacks)
- **Info**: `"encryption-key"` (context string for this specific derivation)
- **Output**: 256-bit AES-GCM key

**Security Properties:**
- Same wallet + same message = same signature = same key (deterministic recovery)
- Different wallets = different keys (user isolation)
- Salt and info prevent key reuse across contexts

---

## Layer 2: Group Access Control

### Group Secret Generation

Each group has a 256-bit random secret:

```javascript
function generateGroupSecret() {
  return crypto.getRandomValues(new Uint8Array(32));
}
```

**Why 256 bits?** Matches AES-256 key size, provides 128-bit security against birthday attacks.

### Group ID Derivation

The group ID is the SHA-256 hash of the secret:

```javascript
async function deriveGroupId(groupSecret) {
  const hash = await crypto.subtle.digest('SHA-256', groupSecret);
  return '0x' + bytesToHex(new Uint8Array(hash));
}
```

**Why hash the secret?**
- Group ID can be public (on-chain) without revealing the secret
- Knowing the ID doesn't help decrypt content
- Hash is one-way: can't recover secret from ID

### QR Code Sharing

When sharing a group, the QR contains:

```javascript
const inviteData = {
  groupId: '0x7a3b...',      // SHA-256 of secret (32 bytes hex)
  groupSecret: '0xf4e2...',  // The actual secret (32 bytes hex)
  groupName: 'Family Safety',
  chainId: 84532,
  registryAddress: '0x5678...'
};

// Encoded as base64 JSON in QR
const qrPayload = btoa(JSON.stringify(inviteData));
```

**Security Note:** The QR code contains the secret in plaintext. Physical proximity is required to join a group — this is intentional. No remote invite mechanism exists.

### Encrypted Storage of Group Secrets

Group secrets are stored in localStorage, encrypted with the personal key:

```javascript
async function storeGroupSecret(groupId, groupData, personalKey) {
  const plaintext = JSON.stringify(groupData);
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    personalKey,
    new TextEncoder().encode(plaintext)
  );

  // Store IV || ciphertext
  const combined = new Uint8Array(12 + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), 12);

  localStorage.setItem(`group_${groupId}`, bytesToBase64(combined));
}
```

---

## Layer 3: Content Encryption

### Content Key Generation

Each recording gets a fresh random key:

```javascript
function generateContentKey() {
  return crypto.getRandomValues(new Uint8Array(32));  // 256 bits
}
```

**Why per-content keys?**
- Compromising one recording doesn't expose others
- Forward secrecy: past recordings remain safe even if current key leaks

### Per-Chunk Key Derivation

For streaming capture, each chunk gets a derived key:

```javascript
async function deriveChunkKey(contentKey, chunkIndex) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    contentKey,
    'HKDF',
    false,
    ['deriveKey']
  );

  // Convert chunk index to bytes
  const indexBytes = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, chunkIndex, false);  // Big-endian

  return await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('witness-chunk'),
      info: indexBytes
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

**Key Derivation Chain:**
```
contentKey (random 256-bit)
    │
    ├── HKDF(salt="witness-chunk", info=0x00000000) → chunkKey[0]
    ├── HKDF(salt="witness-chunk", info=0x00000001) → chunkKey[1]
    ├── HKDF(salt="witness-chunk", info=0x00000002) → chunkKey[2]
    └── ...
```

### AES-256-GCM Encryption

Each chunk is encrypted with authenticated encryption:

```javascript
async function encryptChunk(plaintext, chunkKey) {
  // Fresh random IV for each chunk (CRITICAL for GCM security)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    chunkKey,
    plaintext
  );

  return { ciphertext, iv };
}
```

**AES-GCM Parameters:**
- **Key size**: 256 bits
- **IV size**: 96 bits (12 bytes) — GCM recommended size
- **Tag size**: 128 bits (included in ciphertext by Web Crypto)

**Security Properties:**
- **Confidentiality**: Ciphertext reveals nothing about plaintext
- **Authenticity**: Any tampering is detected (GCM tag verification fails)
- **IV uniqueness**: Random IV ensures same plaintext → different ciphertext

**Critical Warning:** Never reuse an IV with the same key. With random 96-bit IVs, collision probability reaches 50% after ~2^48 encryptions. For our 10-second chunks, this is ~89 million years of continuous recording.

### Key Wrapping for Groups

The content key is wrapped (encrypted) for each group that should have access:

```javascript
async function wrapContentKey(contentKey, groupSecret) {
  // Import group secret as wrapping key
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    groupSecret,
    { name: 'AES-GCM' },
    false,
    ['wrapKey']
  );

  // Import content key (must be extractable for wrapping)
  const keyToWrap = await crypto.subtle.importKey(
    'raw',
    contentKey,
    { name: 'AES-GCM' },
    true,  // Extractable
    ['encrypt', 'decrypt']
  );

  // Wrap with fresh IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.wrapKey(
    'raw',
    keyToWrap,
    wrappingKey,
    { name: 'AES-GCM', iv }
  );

  return {
    iv: bytesToHex(iv),
    wrappedKey: bytesToHex(new Uint8Array(wrappedKey))
  };
}
```

**Multi-Group Access:**
```
contentKey
    │
    ├── wrap(groupSecret_A) → { iv_A, wrappedKey_A }
    ├── wrap(groupSecret_B) → { iv_B, wrappedKey_B }
    └── wrap(groupSecret_C) → { iv_C, wrappedKey_C }
```

Each group gets their own wrapped copy. Adding a new group doesn't require re-encrypting the content — just wrap the content key again.

### Key Unwrapping

To decrypt content, unwrap the content key first:

```javascript
async function unwrapContentKey(wrappedKey, iv, groupSecret) {
  const unwrappingKey = await crypto.subtle.importKey(
    'raw',
    groupSecret,
    { name: 'AES-GCM' },
    false,
    ['unwrapKey']
  );

  const contentKey = await crypto.subtle.unwrapKey(
    'raw',
    hexToBytes(wrappedKey),
    unwrappingKey,
    { name: 'AES-GCM', iv: hexToBytes(iv) },
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  return contentKey;
}
```

---

## Layer 4: Integrity & Merkle Trees

### SHA-256 Hashing

All integrity checks use SHA-256:

```javascript
async function sha256(data) {
  const buffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return '0x' + bytesToHex(new Uint8Array(hash));
}
```

**SHA-256 Properties:**
- **Output**: 256 bits (32 bytes)
- **Collision resistance**: ~2^128 operations to find collision
- **Preimage resistance**: ~2^256 operations to reverse
- **Deterministic**: Same input always produces same output

### Composite Leaf Construction

Each Merkle leaf binds multiple properties:

```javascript
async function computeLeaf(chunkIndex, plaintextHash, encryptedHash, capturedAt) {
  // Pack data into fixed-size buffer
  const buffer = new ArrayBuffer(76);  // 4 + 32 + 32 + 8 bytes
  const view = new DataView(buffer);

  // Chunk index (4 bytes, big-endian)
  view.setUint32(0, chunkIndex, false);

  // Plaintext hash (32 bytes)
  const plaintextBytes = hexToBytes(plaintextHash);
  new Uint8Array(buffer, 4, 32).set(plaintextBytes);

  // Encrypted hash (32 bytes)
  const encryptedBytes = hexToBytes(encryptedHash);
  new Uint8Array(buffer, 36, 32).set(encryptedBytes);

  // Timestamp (8 bytes, big-endian milliseconds)
  view.setBigUint64(68, BigInt(capturedAt), false);

  // Hash the combined buffer
  return await sha256(buffer);
}
```

**Leaf Structure (76 bytes):**
```
┌────────────┬─────────────────┬─────────────────┬────────────┐
│ chunkIndex │  plaintextHash  │  encryptedHash  │ capturedAt │
│  4 bytes   │    32 bytes     │    32 bytes     │  8 bytes   │
└────────────┴─────────────────┴─────────────────┴────────────┘
                              │
                              ▼
                    SHA-256(concatenation)
                              │
                              ▼
                         leaf hash
```

**Why composite leaves?**
- **chunkIndex**: Prevents reordering attacks
- **plaintextHash**: Proves actual video content
- **encryptedHash**: Allows verification without decryption
- **capturedAt**: Binds to capture timeline

### Merkle Tree Construction

A binary Merkle tree built incrementally:

```javascript
class MerkleTree {
  constructor() {
    this.leaves = [];
  }

  async addLeaf(leafHash) {
    this.leaves.push(leafHash);
  }

  async getRoot() {
    if (this.leaves.length === 0) return null;
    if (this.leaves.length === 1) return this.leaves[0];

    let level = [...this.leaves];

    while (level.length > 1) {
      const nextLevel = [];

      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] || left;  // Duplicate if odd
        nextLevel.push(await this.hashPair(left, right));
      }

      level = nextLevel;
    }

    return level[0];
  }

  async hashPair(left, right) {
    // Sort to ensure deterministic ordering
    const [a, b] = left < right ? [left, right] : [right, left];
    const combined = hexToBytes(a.slice(2) + b.slice(2));
    return await sha256(combined);
  }
}
```

**Tree Structure Example (4 leaves):**
```
                    Root
                   /    \
                  /      \
               H(0,1)   H(2,3)
               /    \   /    \
              L0    L1 L2    L3
```

**Merkle Proof:**
To prove L1 is in the tree:
1. Provide: L0 (sibling), H(2,3) (uncle)
2. Verifier computes: H(L0, L1) → H(0,1)
3. Verifier computes: H(H(0,1), H(2,3)) → Root
4. Compare with on-chain root

### On-Chain Anchoring

The Merkle root is stored on-chain:

```solidity
// WitnessRegistry.sol

struct ContentCommitment {
    bytes32 merkleRoot;      // Root of chunk hash tree
    string manifestCID;      // IPFS pointer to full manifest
    address uploader;        // Who uploaded
    uint64 timestamp;        // Block timestamp
}

mapping(bytes32 => ContentCommitment) public content;

event ContentCommitted(
    bytes32 indexed contentId,
    address indexed uploader,
    bytes32 merkleRoot,
    string manifestCID,
    uint256 timestamp
);
```

**What the root proves:**
- All chunks existed at block timestamp
- Chunk order is fixed (can't reorder)
- Any chunk modification invalidates the root

---

## Layer 5: Anonymous Attestations (Semaphore)

### Semaphore Identity

A Semaphore identity is a keypair derived from a secret:

```javascript
import { Identity } from '@semaphore-protocol/core';

async function createSemaphoreIdentity(wallet) {
  // Request typed signature (similar to encryption key)
  const typedData = {
    domain: {
      name: 'Witness Protocol',
      version: '1',
      chainId: 84532,
      verifyingContract: '0x0000...'
    },
    types: {
      SemaphoreIdentityRequest: [
        { name: 'purpose', type: 'string' },
        { name: 'application', type: 'string' },
        { name: 'identityVersion', type: 'uint256' }
      ]
    },
    message: {
      purpose: 'Create anonymous attestation identity',
      application: 'witness-protocol',
      identityVersion: 1
    }
  };

  const signature = await wallet.signTypedData(typedData);

  // Use signature as deterministic seed
  const identity = new Identity(signature);

  return identity;
}
```

**Identity Components:**
- **privateKey**: Secret scalar (derived from signature)
- **commitment**: `Poseidon(privateKey)` — public identifier

**Poseidon Hash:**
Semaphore uses Poseidon, a ZK-friendly hash function optimized for arithmetic circuits. Unlike SHA-256, Poseidon operates over a prime field, making it efficient to prove in SNARKs.

### Group Membership

When joining a Witness group, the identity commitment is added to a parallel Semaphore group:

```solidity
// On-chain
function joinGroup(bytes32 groupId, uint256 identityCommitment) external {
    // Add to Witness group
    groupMembers[groupId][msg.sender] = true;

    // Add to parallel Semaphore group
    uint256 semGroupId = semaphoreGroupId[groupId];
    semaphore.addMember(semGroupId, identityCommitment);
}
```

**On-Chain State:**
```
Semaphore Group (on-chain Merkle tree of commitments)
├── commitment_1 (Alice)
├── commitment_2 (Bob)
├── commitment_3 (Charlie)
└── ...
```

### ZK Proof Generation

To attest anonymously, the user generates a Semaphore proof:

```javascript
import { generateProof } from '@semaphore-protocol/core';

async function createAttestationProof(identity, group, contentId) {
  // scope = contentId makes nullifier content-specific
  const scope = BigInt(contentId);

  // message = contentId (what we're attesting to)
  const message = BigInt(contentId);

  const proof = await generateProof(identity, group, message, scope);

  return proof;
  // proof = {
  //   merkleTreeDepth: number,
  //   merkleTreeRoot: bigint,
  //   nullifier: bigint,
  //   message: bigint,
  //   scope: bigint,
  //   points: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]
  // }
}
```

**What the proof proves (without revealing identity):**
1. Prover knows a privateKey
2. Poseidon(privateKey) is a leaf in the group Merkle tree
3. The nullifier was computed correctly from privateKey and scope

### Nullifier Mechanics

The nullifier prevents double-attestation:

```
nullifier = Poseidon(privateKey, scope)
```

**Properties:**
- Same identity + same scope = same nullifier (blocked)
- Same identity + different scope = different nullifier (allowed)
- Different identity + same scope = different nullifier (allowed)

```solidity
// On-chain verification
mapping(uint256 => bool) public nullifierUsed;

function attestToContent(
    bytes32 contentId,
    bytes32 groupId,
    ISemaphore.SemaphoreProof calldata proof
) external {
    // Check nullifier not used
    require(!nullifierUsed[proof.nullifier], "Already attested");

    // Verify ZK proof
    uint256 semGroupId = semaphoreGroupId[groupId];
    semaphore.validateProof(semGroupId, proof);

    // Record nullifier
    nullifierUsed[proof.nullifier] = true;
    attestationCount[contentId]++;
}
```

### The SNARK Circuit

Semaphore uses Groth16 proofs over the BN254 curve. The circuit verifies:

```
Public inputs:
  - merkleTreeRoot (from on-chain group)
  - nullifier (computed value)
  - message (contentId)
  - scope (contentId)

Private inputs:
  - privateKey (identity secret)
  - merkleSiblings (path from leaf to root)

Constraints:
  1. commitment = Poseidon(privateKey)
  2. merkleTreeRoot = MerkleVerify(commitment, merkleSiblings)
  3. nullifier = Poseidon(privateKey, scope)
```

**Proof size:** ~256 bytes (8 field elements)
**Verification gas:** ~300-400k on EVM

---

## Complete Data Flow

### Recording Flow

```
User starts recording
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Generate contentKey = random(32 bytes)                        │
│ 2. For each selected group:                                      │
│    wrappedKey[group] = AES-GCM-wrap(contentKey, groupSecret)    │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ For each 10-second chunk:                                        │
│                                                                  │
│ 3. chunkKey = HKDF(contentKey, chunkIndex)                      │
│ 4. plaintextHash = SHA-256(rawVideo)                            │
│ 5. iv = random(12 bytes)                                        │
│ 6. encrypted = AES-GCM(chunkKey, iv, rawVideo)                  │
│ 7. encryptedHash = SHA-256(encrypted)                           │
│ 8. leaf = SHA-256(index || plaintextHash || encryptedHash || ts) │
│ 9. merkleTree.addLeaf(leaf)                                     │
│ 10. Upload encrypted → IPFS → get CID                           │
│ 11. Update manifest with chunk metadata                          │
│ 12. Upload manifest → IPFS → get manifestCID                    │
│ 13. On-chain: updateSession(sessionId, merkleRoot, manifestCID)  │
└─────────────────────────────────────────────────────────────────┘
```

### Decryption Flow

```
Group member requests content
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Fetch manifest from IPFS                                      │
│ 2. Find wrappedKey for user's group in accessList               │
│ 3. contentKey = AES-GCM-unwrap(wrappedKey, groupSecret)         │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ For each chunk:                                                  │
│                                                                  │
│ 4. Download encrypted chunk from IPFS                            │
│ 5. Verify SHA-256(encrypted) === manifest.chunk[i].encryptedHash │
│ 6. chunkKey = HKDF(contentKey, chunkIndex)                      │
│ 7. plaintext = AES-GCM-decrypt(chunkKey, iv, encrypted)         │
│ 8. Verify SHA-256(plaintext) === manifest.chunk[i].plaintextHash │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. Recompute Merkle root from all leaves                         │
│ 10. Verify computed root === on-chain root                       │
│ 11. Concatenate chunks → playable video                          │
└─────────────────────────────────────────────────────────────────┘
```

### Attestation Flow

```
Group member views verified content
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load Semaphore identity from encrypted storage                │
│ 2. Fetch group member commitments from on-chain events           │
│ 3. Build Group object with correct Merkle tree                   │
│ 4. Verify user's commitment is in group                          │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. scope = contentId                                             │
│ 6. message = contentId                                           │
│ 7. proof = generateProof(identity, group, message, scope)        │
│    - Downloads ~2MB SNARK artifacts (cached after first use)     │
│    - Generates proof in ~5-15 seconds                            │
└─────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. Submit: attestToContent(contentId, groupId, proof)            │
│ 9. Contract verifies ZK proof                                    │
│ 10. Contract records nullifier                                   │
│ 11. attestationCount[contentId]++                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Algorithm Summary

| Purpose | Algorithm | Parameters |
|---------|-----------|------------|
| Personal key derivation | HKDF-SHA256 | salt="witness-protocol-v1", info="encryption-key" |
| Content encryption | AES-256-GCM | 256-bit key, 96-bit IV, 128-bit tag |
| Chunk key derivation | HKDF-SHA256 | salt="witness-chunk", info=chunkIndex |
| Key wrapping | AES-256-GCM | 256-bit key, 96-bit IV |
| Content hashing | SHA-256 | 256-bit output |
| Group ID derivation | SHA-256 | 256-bit output |
| Merkle tree | Binary tree, SHA-256 | Sorted pair hashing |
| Identity commitment | Poseidon | ZK-friendly hash |
| ZK proofs | Groth16 / BN254 | ~256 byte proofs |

---

## Security Considerations

### What's Protected

| Asset | Protection | Strength |
|-------|------------|----------|
| Video content | AES-256-GCM | 256-bit |
| Content keys | AES-GCM key wrapping | 256-bit |
| Personal key | Non-extractable CryptoKey | Browser-enforced |
| Group secrets | Encrypted with personal key | 256-bit |
| Attestor identity | ZK proof (Semaphore) | Information-theoretic |

### Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| Software keys | Extractable via JS on compromised device | Production: hardware-backed keys |
| Random IV | 2^-48 collision probability per key | Acceptable for chunk volumes |
| Browser storage | Can be cleared/evicted | IndexedDB persistence, re-derivation |
| Semaphore artifacts | 2MB download on first proof | Cached after first use |

### Cryptographic Assumptions

1. **AES-256**: No practical attacks (best known: 2^254 complexity)
2. **SHA-256**: Collision-resistant (no known collisions)
3. **ECDSA/secp256k1**: Discrete log problem is hard
4. **BN254**: Bilinear pairing assumptions hold (standard in ZK)
5. **Poseidon**: Algebraic attack resistance (conservative design)

---

## References

- [AES-GCM (NIST SP 800-38D)](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [HKDF (RFC 5869)](https://www.rfc-editor.org/rfc/rfc5869)
- [EIP-712: Typed Structured Data Hashing](https://eips.ethereum.org/EIPS/eip-712)
- [Semaphore Protocol](https://semaphore.pse.dev/)
- [Poseidon Hash](https://www.poseidon-hash.info/)
- [Groth16 Proofs](https://eprint.iacr.org/2016/260)
