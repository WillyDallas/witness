# Phase 7: Anonymous Attestations (Semaphore) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable group members to anonymously attest to evidence using ZK proofs, proving "N people verified this" without revealing who attested.

**Architecture:** Derive Semaphore identity from wallet signature (deterministic, recoverable). Create parallel Semaphore groups on-chain when Witness groups are created. When attesting, generate ZK proof client-side proving group membership, submit to contract which verifies proof and increments attestation counter. Nullifier prevents double-attestation per content.

**Tech Stack:** @semaphore-protocol/core (Identity, Group, generateProof, verifyProof), Solidity ISemaphore interface, existing contract.js + viem pattern, localStorage for identity persistence

---

## Documentation Verification (Context7 Research)

**Verified against Semaphore Protocol** (`/semaphore-protocol/semaphore` - 396 snippets, High reputation):

| Feature | Verification | Source |
|---------|--------------|--------|
| Identity creation | `new Identity()` or `new Identity(seed)` for deterministic | Context7: core/README.md |
| Identity properties | `.commitment` (public), `.trapdoor`, `.nullifier` (secret) | Context7: guides/identities.md |
| Group creation | `new Group([commitment1, commitment2, ...])` | Context7: core/README.md |
| Proof generation | `generateProof(identity, group, message, scope)` | Context7: proof/README.md |
| SNARK artifacts | Auto-downloaded if not provided | Context7: proof/README.md |
| On-chain validation | `semaphore.validateProof(groupId, proof)` | Context7: V4/guides/proofs.mdx |
| Solidity interface | `ISemaphore` from `@semaphore-protocol/contracts` | Context7: Greeter.sol example |

**Key Implementation Notes (V4 API):**
- V4 uses `generateProof(identity, group, message, scope)` - different from V2/V3
- `scope` determines nullifier uniqueness - use `contentId` so same user can attest to different content
- `message` is what we're attesting to - also use `contentId`
- SNARK artifacts auto-download from CDN (~2MB, cached in browser)
- On-chain: `ISemaphore.SemaphoreProof` struct for validation

---

## Prerequisites

- Phase 4 complete (group creation/joining)
- Phase 6 complete (content viewing)
- Semaphore contracts deployed on Base Sepolia (or use existing deployment)
- Smart contract upgraded with Semaphore integration

## Current State Analysis

**Already Implemented:**
- `contract.js`: Group creation/joining, content queries
- `storage.js`: Encrypted localStorage for secrets
- `encryption.js`: Key derivation from wallet signature
- `WitnessRegistry.sol`: Groups, content commitments

**Missing (this phase):**
- Semaphore identity service (deterministic from wallet)
- Identity storage (encrypted in localStorage)
- Updated contract with Semaphore integration
- Attestation service (proof generation + submission)
- UI for attestation count and attest button

---

### Task 1: Install Semaphore Dependencies

**Files:**
- Modify: `witness-pwa/package.json`

**Step 1: Add Semaphore packages**

Run in `witness-pwa/` directory:

```bash
npm install @semaphore-protocol/core @semaphore-protocol/proof @semaphore-protocol/group @semaphore-protocol/identity
```

**Step 2: Verify installation**

```bash
npm list @semaphore-protocol/core
```

Expected: Shows installed version (should be V4.x)

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add semaphore-protocol packages for anonymous attestations"
```

---

### Task 2: Create Identity Service

**Files:**
- Create: `witness-pwa/src/lib/identity.js`

**Step 1: Create the identity service**

```javascript
/**
 * Semaphore Identity Service for Witness Protocol
 * Creates deterministic ZK identities from wallet signatures
 */

import { Identity } from '@semaphore-protocol/identity';
import { setSecureItem, getSecureItem } from './storage.js';

// Storage key for Semaphore identity
const IDENTITY_STORAGE_KEY = 'witness_semaphore_identity';

// EIP-712 domain for identity derivation signature
const IDENTITY_DOMAIN = {
  name: 'Witness Protocol',
  version: '1',
  chainId: 84532, // Base Sepolia
  verifyingContract: '0x0000000000000000000000000000000000000000',
};

const IDENTITY_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  SemaphoreIdentityRequest: [
    { name: 'purpose', type: 'string' },
    { name: 'application', type: 'string' },
    { name: 'identityVersion', type: 'uint256' },
  ],
};

/**
 * Request EIP-712 signature for identity derivation
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @returns {Promise<string>} Signature hex string
 */
async function requestIdentitySignature(provider, walletAddress) {
  const typedData = {
    domain: IDENTITY_DOMAIN,
    types: IDENTITY_TYPES,
    primaryType: 'SemaphoreIdentityRequest',
    message: {
      purpose: 'Create anonymous attestation identity',
      application: 'witness-protocol',
      identityVersion: 1,
    },
  };

  const signature = await provider.request({
    method: 'eth_signTypedData_v4',
    params: [walletAddress, JSON.stringify(typedData)],
  });

  return signature;
}

/**
 * Derive Semaphore identity from wallet signature
 * Deterministic: same wallet = same identity (recoverable)
 * @param {string} signature - Wallet signature
 * @returns {Identity} Semaphore Identity instance
 */
function deriveIdentityFromSignature(signature) {
  // Use signature as seed for deterministic identity
  // Identity constructor accepts string seed
  const identity = new Identity(signature);
  return identity;
}

/**
 * Get stored identity from encrypted localStorage
 * @param {CryptoKey} encryptionKey - User's encryption key
 * @returns {Promise<Identity|null>} Identity or null if not stored
 */
export async function getStoredIdentity(encryptionKey) {
  try {
    const stored = await getSecureItem(IDENTITY_STORAGE_KEY, encryptionKey);
    if (!stored || !stored.privateKey) {
      return null;
    }

    // Reconstruct identity from stored private key
    const identity = new Identity(stored.privateKey);
    console.log('[identity] Loaded from storage, commitment:', identity.commitment.toString().slice(0, 20) + '...');
    return identity;
  } catch (err) {
    console.error('[identity] Failed to load:', err.message);
    return null;
  }
}

/**
 * Store identity securely
 * @param {Identity} identity - Semaphore identity
 * @param {CryptoKey} encryptionKey - User's encryption key
 */
export async function storeIdentity(identity, encryptionKey) {
  // Store the private key (used to reconstruct identity)
  const stored = {
    privateKey: identity.privateKey.toString(),
    commitment: identity.commitment.toString(),
    createdAt: new Date().toISOString(),
  };

  await setSecureItem(IDENTITY_STORAGE_KEY, stored, encryptionKey);
  console.log('[identity] Stored securely');
}

/**
 * Create or retrieve Semaphore identity
 * If stored identity exists, returns it. Otherwise creates new one.
 * @param {object} provider - Privy embedded wallet provider
 * @param {string} walletAddress - EOA address
 * @param {CryptoKey} encryptionKey - User's encryption key
 * @returns {Promise<Identity>} Semaphore identity
 */
export async function getOrCreateIdentity(provider, walletAddress, encryptionKey) {
  // Check for existing identity
  const existing = await getStoredIdentity(encryptionKey);
  if (existing) {
    return existing;
  }

  // Create new identity from wallet signature
  console.log('[identity] Creating new Semaphore identity...');
  const signature = await requestIdentitySignature(provider, walletAddress);
  const identity = deriveIdentityFromSignature(signature);

  // Store for future sessions
  await storeIdentity(identity, encryptionKey);

  console.log('[identity] Created, commitment:', identity.commitment.toString().slice(0, 20) + '...');
  return identity;
}

/**
 * Get identity commitment as BigInt
 * This is the public value added to Semaphore groups
 * @param {Identity} identity - Semaphore identity
 * @returns {bigint} Commitment value
 */
export function getCommitment(identity) {
  return identity.commitment;
}

/**
 * Clear stored identity (for logout)
 */
export function clearIdentity() {
  localStorage.removeItem(IDENTITY_STORAGE_KEY);
  console.log('[identity] Cleared');
}
```

**Step 2: Verify file created**

Run: `ls -la witness-pwa/src/lib/identity.js`
Expected: File exists

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/identity.js
git commit -m "feat: add Semaphore identity service with deterministic derivation"
```

---

### Task 3: Update WitnessRegistry Contract with Semaphore Integration

**Files:**
- Modify: `contracts/src/WitnessRegistry.sol`

**Step 1: Install Semaphore contracts in Foundry**

```bash
cd contracts
forge install semaphore-protocol/semaphore --no-commit
```

**Step 2: Update remappings.txt**

Add to `contracts/remappings.txt`:

```
@semaphore-protocol/=lib/semaphore/packages/
```

**Step 3: Update WitnessRegistry.sol**

Replace the entire file:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

/**
 * @title WitnessRegistry
 * @notice On-chain registry for Witness Protocol with anonymous attestations
 * @dev Integrates Semaphore for ZK group membership proofs
 */
contract WitnessRegistry {
    // ============================================
    // STRUCTS
    // ============================================

    struct Group {
        address creator;
        uint64 createdAt;
        bool active;
    }

    struct ContentCommitment {
        bytes32 merkleRoot;
        string manifestCID;
        address uploader;
        uint64 timestamp;
    }

    // ============================================
    // STATE VARIABLES
    // ============================================

    // Semaphore contract reference
    ISemaphore public semaphore;

    // User registration
    mapping(address => bool) public registered;
    mapping(address => uint64) public registeredAt;

    // Group management
    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(address => bool)) public groupMembers;
    mapping(bytes32 => address[]) internal _groupMemberList;

    // Semaphore group mapping (witnessGroupId => semaphoreGroupId)
    mapping(bytes32 => uint256) public semaphoreGroupId;
    uint256 private _nextSemaphoreGroupId;

    // Content commitments
    mapping(bytes32 => ContentCommitment) public content;
    mapping(bytes32 => bytes32[]) public contentGroups;
    mapping(bytes32 => bytes32[]) public groupContent;
    mapping(address => bytes32[]) public userContent;

    // Attestations
    mapping(bytes32 => uint256) public attestationCount; // contentId => count
    mapping(uint256 => bool) public nullifierUsed; // nullifier => used

    // ============================================
    // EVENTS
    // ============================================

    event UserRegistered(address indexed user, uint64 timestamp);
    event GroupCreated(bytes32 indexed groupId, address indexed creator, uint256 semaphoreGroupId, uint64 timestamp);
    event GroupJoined(bytes32 indexed groupId, address indexed member, uint256 identityCommitment, uint64 timestamp);
    event ContentCommitted(
        bytes32 indexed contentId,
        address indexed uploader,
        bytes32 merkleRoot,
        string manifestCID,
        uint64 timestamp
    );
    event AttestationCreated(
        bytes32 indexed contentId,
        bytes32 indexed groupId,
        uint256 newCount,
        uint64 timestamp
    );

    // ============================================
    // ERRORS
    // ============================================

    error AlreadyRegistered();
    error NotRegistered();
    error GroupAlreadyExists();
    error GroupDoesNotExist();
    error AlreadyMember();
    error NotMember();
    error ContentAlreadyExists();
    error EmptyManifestCID();
    error NoGroupsSpecified();
    error ContentNotInGroup();
    error NullifierAlreadyUsed();
    error InvalidProof();

    // ============================================
    // CONSTRUCTOR
    // ============================================

    /**
     * @notice Initialize with Semaphore contract address
     * @param _semaphore Address of deployed Semaphore contract
     */
    constructor(address _semaphore) {
        semaphore = ISemaphore(_semaphore);
        _nextSemaphoreGroupId = 1;
    }

    // ============================================
    // USER REGISTRATION
    // ============================================

    function register() external {
        if (registered[msg.sender]) revert AlreadyRegistered();

        registered[msg.sender] = true;
        registeredAt[msg.sender] = uint64(block.timestamp);

        emit UserRegistered(msg.sender, uint64(block.timestamp));
    }

    // ============================================
    // GROUP MANAGEMENT
    // ============================================

    /**
     * @notice Create a new group with parallel Semaphore group
     * @param groupId The keccak256 hash of the group secret
     * @param identityCommitment Creator's Semaphore identity commitment
     */
    function createGroup(bytes32 groupId, uint256 identityCommitment) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt != 0) revert GroupAlreadyExists();

        // Create Witness group
        groups[groupId] = Group({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            active: true
        });

        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        // Create parallel Semaphore group
        uint256 semGroupId = _nextSemaphoreGroupId++;
        semaphoreGroupId[groupId] = semGroupId;
        semaphore.createGroup();

        // Add creator to Semaphore group
        semaphore.addMember(semGroupId, identityCommitment);

        emit GroupCreated(groupId, msg.sender, semGroupId, uint64(block.timestamp));
    }

    /**
     * @notice Join an existing group with identity commitment
     * @param groupId The group to join
     * @param identityCommitment Joiner's Semaphore identity commitment
     */
    function joinGroup(bytes32 groupId, uint256 identityCommitment) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt == 0) revert GroupDoesNotExist();
        if (groupMembers[groupId][msg.sender]) revert AlreadyMember();

        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        // Add to Semaphore group
        uint256 semGroupId = semaphoreGroupId[groupId];
        semaphore.addMember(semGroupId, identityCommitment);

        emit GroupJoined(groupId, msg.sender, identityCommitment, uint64(block.timestamp));
    }

    function getGroupMemberCount(bytes32 groupId) external view returns (uint256) {
        return _groupMemberList[groupId].length;
    }

    // ============================================
    // CONTENT COMMITMENT
    // ============================================

    function commitContent(
        bytes32 contentId,
        bytes32 merkleRoot,
        string calldata manifestCID,
        bytes32[] calldata groupIds
    ) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (content[contentId].timestamp != 0) revert ContentAlreadyExists();
        if (bytes(manifestCID).length == 0) revert EmptyManifestCID();
        if (groupIds.length == 0) revert NoGroupsSpecified();

        for (uint256 i = 0; i < groupIds.length; i++) {
            if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
        }

        content[contentId] = ContentCommitment({
            merkleRoot: merkleRoot,
            manifestCID: manifestCID,
            uploader: msg.sender,
            timestamp: uint64(block.timestamp)
        });

        for (uint256 i = 0; i < groupIds.length; i++) {
            contentGroups[contentId].push(groupIds[i]);
            groupContent[groupIds[i]].push(contentId);
        }

        userContent[msg.sender].push(contentId);

        emit ContentCommitted(contentId, msg.sender, merkleRoot, manifestCID, uint64(block.timestamp));
    }

    // ============================================
    // ATTESTATIONS (Anonymous via Semaphore)
    // ============================================

    /**
     * @notice Attest to content anonymously using ZK proof
     * @param contentId The content being attested to
     * @param groupId The group through which user is attesting
     * @param proof The Semaphore proof (includes nullifier)
     */
    function attestToContent(
        bytes32 contentId,
        bytes32 groupId,
        ISemaphore.SemaphoreProof calldata proof
    ) external {
        // Verify content is shared with this group
        bool inGroup = false;
        bytes32[] memory groups_ = contentGroups[contentId];
        for (uint256 i = 0; i < groups_.length; i++) {
            if (groups_[i] == groupId) {
                inGroup = true;
                break;
            }
        }
        if (!inGroup) revert ContentNotInGroup();

        // Check nullifier not used (prevents double attestation)
        if (nullifierUsed[proof.nullifier]) revert NullifierAlreadyUsed();

        // Verify ZK proof via Semaphore
        uint256 semGroupId = semaphoreGroupId[groupId];
        semaphore.validateProof(semGroupId, proof);

        // Record attestation
        nullifierUsed[proof.nullifier] = true;
        attestationCount[contentId]++;

        emit AttestationCreated(contentId, groupId, attestationCount[contentId], uint64(block.timestamp));
    }

    /**
     * @notice Get attestation count for content
     * @param contentId The content ID
     * @return Number of attestations
     */
    function getAttestationCount(bytes32 contentId) external view returns (uint256) {
        return attestationCount[contentId];
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    function getUserContent(address user) external view returns (bytes32[] memory) {
        return userContent[user];
    }

    function getGroupContent(bytes32 groupId) external view returns (bytes32[] memory) {
        return groupContent[groupId];
    }

    function getContentGroups(bytes32 contentId) external view returns (bytes32[] memory) {
        return contentGroups[contentId];
    }
}
```

**Step 4: Build and verify**

```bash
cd contracts
forge build
```

Expected: Compilation successful

**Step 5: Commit**

```bash
git add contracts/
git commit -m "feat: add Semaphore integration to WitnessRegistry for anonymous attestations"
```

---

### Task 4: Update Contract ABI

**Files:**
- Modify: `witness-pwa/src/lib/abi/WitnessRegistry.json`

**Step 1: Export new ABI from Foundry**

```bash
cd contracts
forge build
cat out/WitnessRegistry.sol/WitnessRegistry.json | jq '.abi' > ../witness-pwa/src/lib/abi/WitnessRegistry.json
```

**Step 2: Verify ABI contains new functions**

Open `witness-pwa/src/lib/abi/WitnessRegistry.json` and verify it contains:
- `attestToContent` function
- `getAttestationCount` function
- `attestationCount` mapping
- Updated `createGroup` with `identityCommitment` parameter
- Updated `joinGroup` with `identityCommitment` parameter

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/abi/WitnessRegistry.json
git commit -m "chore: update ABI with attestation functions"
```

---

### Task 5: Update contract.js with Attestation Functions

**Files:**
- Modify: `witness-pwa/src/lib/contract.js`

**Step 1: Add attestation read functions after getGroupContent**

```javascript
/**
 * Get attestation count for content
 * @param {string} contentId - Content ID (bytes32 hex)
 * @returns {Promise<number>} Attestation count
 */
export async function getAttestationCount(contentId) {
  const contract = getRegistryContract();
  const count = await contract.read.attestationCount([contentId]);
  return Number(count);
}

/**
 * Get Semaphore group ID for a Witness group
 * @param {string} groupId - Witness group ID (bytes32 hex)
 * @returns {Promise<bigint>} Semaphore group ID
 */
export async function getSemaphoreGroupId(groupId) {
  const contract = getRegistryContract();
  return contract.read.semaphoreGroupId([groupId]);
}

/**
 * Check if a nullifier has been used
 * @param {bigint} nullifier - The nullifier to check
 * @returns {Promise<boolean>} Whether nullifier is used
 */
export async function isNullifierUsed(nullifier) {
  const contract = getRegistryContract();
  return contract.read.nullifierUsed([nullifier]);
}
```

**Step 2: Update createGroup to include identity commitment**

Replace the existing `createGroup` function:

```javascript
/**
 * Create a new group with Semaphore integration
 * @param {string} groupId - Group ID (keccak256 of group secret)
 * @param {bigint} identityCommitment - Creator's Semaphore identity commitment
 * @returns {Promise<string>} Transaction hash
 */
export async function createGroup(groupId, identityCommitment) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'createGroup',
      args: [groupId, identityCommitment],
    }),
  });

  console.log('[contract] Create group tx:', hash);
  return hash;
}
```

**Step 3: Update joinGroup to include identity commitment**

Replace the existing `joinGroup` function:

```javascript
/**
 * Join an existing group with identity commitment
 * @param {string} groupId - Group ID to join
 * @param {bigint} identityCommitment - Joiner's Semaphore identity commitment
 * @returns {Promise<string>} Transaction hash
 */
export async function joinGroup(groupId, identityCommitment) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'joinGroup',
      args: [groupId, identityCommitment],
    }),
  });

  console.log('[contract] Join group tx:', hash);
  return hash;
}
```

**Step 4: Add attestation write function at end of WRITE FUNCTIONS section**

```javascript
/**
 * Submit anonymous attestation to content
 * @param {string} contentId - Content ID to attest to
 * @param {string} groupId - Group ID through which attesting
 * @param {object} proof - Semaphore proof object
 * @returns {Promise<string>} Transaction hash
 */
export async function attestToContent(contentId, groupId, proof) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  // Format proof for contract
  const formattedProof = {
    merkleTreeDepth: proof.merkleTreeDepth,
    merkleTreeRoot: proof.merkleTreeRoot,
    nullifier: proof.nullifier,
    message: proof.message,
    scope: proof.scope,
    points: proof.points,
  };

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'attestToContent',
      args: [contentId, groupId, formattedProof],
    }),
  });

  console.log('[contract] Attestation tx:', hash);
  return hash;
}
```

**Step 5: Commit**

```bash
git add witness-pwa/src/lib/contract.js
git commit -m "feat: add attestation functions to contract service"
```

---

### Task 6: Create Attestation Service

**Files:**
- Create: `witness-pwa/src/lib/attestation.js`

**Step 1: Create the attestation service**

```javascript
/**
 * Attestation Service for Witness Protocol
 * Generates ZK proofs and submits anonymous attestations
 */

import { Group } from '@semaphore-protocol/group';
import { generateProof } from '@semaphore-protocol/proof';
import { getStoredIdentity } from './identity.js';
import { getAuthState } from './authState.js';
import {
  attestToContent as contractAttestToContent,
  getAttestationCount,
  waitForTransaction,
} from './contract.js';
import { getItem, setItem } from './storage.js';

// Local attestation tracking
const LOCAL_ATTESTATIONS_KEY = 'witness_local_attestations';

/**
 * Get local attestation records
 * @returns {Object} Map of contentId => attestation data
 */
function getLocalAttestations() {
  return getItem(LOCAL_ATTESTATIONS_KEY) || {};
}

/**
 * Record local attestation
 * @param {string} contentId - Content ID attested to
 * @param {string} groupId - Group ID used for attestation
 */
function recordLocalAttestation(contentId, groupId) {
  const attestations = getLocalAttestations();
  attestations[contentId] = {
    groupId,
    attestedAt: new Date().toISOString(),
  };
  setItem(LOCAL_ATTESTATIONS_KEY, attestations);
}

/**
 * Check if user has locally recorded an attestation
 * (On-chain check is impossible since attestations are anonymous)
 * @param {string} contentId - Content ID
 * @returns {boolean} Whether user has attested
 */
export function hasLocallyAttested(contentId) {
  const attestations = getLocalAttestations();
  return !!attestations[contentId];
}

/**
 * Build a Group object from user's commitment
 * For proof generation, we need the user's commitment in the group
 * @param {bigint} userCommitment - Current user's commitment
 * @returns {Group} Semaphore Group object
 */
function buildGroup(userCommitment) {
  // Create group with user's commitment
  // The on-chain Semaphore contract has the full merkle tree
  // For client-side proof gen, we just need our commitment
  const group = new Group([userCommitment]);
  return group;
}

/**
 * @typedef {Object} AttestationProgress
 * @property {'loading'|'proving'|'submitting'|'confirming'|'done'|'error'} step
 * @property {string} message
 */

/**
 * Generate proof and submit attestation
 * @param {string} contentId - Content ID to attest to (bytes32 hex)
 * @param {string} groupId - Group ID to attest through (bytes32 hex)
 * @param {function(AttestationProgress): void} onProgress - Progress callback
 * @returns {Promise<{txHash: string, newCount: number}>}
 */
export async function submitAttestation(contentId, groupId, onProgress = () => {}) {
  const { encryptionKey } = getAuthState();

  if (!encryptionKey) {
    throw new Error('Not authenticated');
  }

  try {
    // Step 1: Load identity
    onProgress({ step: 'loading', message: 'Loading identity...' });

    const identity = await getStoredIdentity(encryptionKey);
    if (!identity) {
      throw new Error('Semaphore identity not found. Please rejoin a group to create identity.');
    }

    // Step 2: Build group
    onProgress({ step: 'loading', message: 'Building group...' });
    const group = buildGroup(identity.commitment);

    // Step 3: Generate ZK proof
    onProgress({ step: 'proving', message: 'Generating zero-knowledge proof...' });

    // scope = contentId ensures unique nullifier per content
    // message = contentId (what we're attesting to)
    const scope = BigInt(contentId);
    const message = BigInt(contentId);

    console.log('[attestation] Generating proof for content:', contentId.slice(0, 12) + '...');
    const proof = await generateProof(identity, group, message, scope);
    console.log('[attestation] Proof generated, nullifier:', proof.nullifier.toString().slice(0, 20) + '...');

    // Step 4: Submit to contract
    onProgress({ step: 'submitting', message: 'Submitting attestation...' });

    const txHash = await contractAttestToContent(contentId, groupId, proof);

    // Step 5: Wait for confirmation
    onProgress({ step: 'confirming', message: 'Waiting for confirmation...' });

    await waitForTransaction(txHash);

    // Step 6: Record locally and get new count
    recordLocalAttestation(contentId, groupId);
    const newCount = await getAttestationCount(contentId);

    onProgress({ step: 'done', message: 'Attestation submitted!' });

    console.log('[attestation] Complete! New count:', newCount);

    return { txHash, newCount };
  } catch (err) {
    console.error('[attestation] Failed:', err);
    onProgress({ step: 'error', message: err.message });
    throw err;
  }
}

/**
 * Fetch attestation count from chain
 * @param {string} contentId - Content ID
 * @returns {Promise<number>} Attestation count
 */
export async function fetchAttestationCount(contentId) {
  return getAttestationCount(contentId);
}

/**
 * Clear local attestation records (for logout)
 */
export function clearLocalAttestations() {
  localStorage.removeItem(LOCAL_ATTESTATIONS_KEY);
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/lib/attestation.js
git commit -m "feat: add attestation service with ZK proof generation"
```

---

### Task 7: Add Attestation CSS Styles

**Files:**
- Modify: `witness-pwa/src/styles.css`

**Step 1: Add attestation styles at end of file**

```css
/* ============================================
   ATTESTATION STYLES
   ============================================ */

.attestation-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 2px solid #e0e0e0;
}

.attestation-section h3 {
  font-size: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #666;
  margin-bottom: 1rem;
}

.attestation-count-box {
  background: linear-gradient(135deg, #f0f7ff 0%, #e6f0fa 100%);
  border: 1px solid #c0d8f0;
  border-radius: 12px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
}

.attestation-icon {
  font-size: 2rem;
}

.attestation-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.attestation-count {
  font-size: 2.5rem;
  font-weight: 700;
  color: #1a56db;
  line-height: 1;
}

.attestation-label {
  font-size: 0.9rem;
  color: #4a5568;
}

.attestation-privacy-note {
  font-size: 0.75rem;
  color: #718096;
  font-style: italic;
  margin-top: 0.5rem;
}

.already-attested {
  background: #d4edda;
  color: #155724;
  padding: 1rem;
  border-radius: 8px;
  text-align: center;
  font-weight: 500;
  margin-top: 1rem;
}

.attest-form {
  margin-top: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.attest-form label {
  font-size: 0.85rem;
  color: #4a5568;
}

.attest-form .form-select {
  padding: 0.5rem;
  border: 1px solid #d0d0d0;
  border-radius: 6px;
  font-size: 0.95rem;
}

.btn-attest {
  background: linear-gradient(135deg, #1a56db 0%, #1e40af 100%);
  color: white;
  border: none;
  padding: 0.875rem 1.5rem;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition: transform 0.1s, box-shadow 0.2s;
}

.btn-attest:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(26, 86, 219, 0.3);
}

.btn-attest:active {
  transform: translateY(0);
}

.attest-progress {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 1rem;
  background: #f8f9fa;
  border-radius: 8px;
}

.attest-progress .spinner {
  width: 20px;
  height: 20px;
  border: 2px solid #e0e0e0;
  border-top-color: #1a56db;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.no-attest-access {
  background: #fff3cd;
  color: #856404;
  padding: 1rem;
  border-radius: 8px;
  text-align: center;
  font-size: 0.9rem;
  margin-top: 1rem;
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/styles.css
git commit -m "style: add attestation UI styles"
```

---

### Task 8: Update Storage Service for Attestation Cleanup

**Files:**
- Modify: `witness-pwa/src/lib/storage.js`

**Step 1: Update STORAGE_KEYS constant**

```javascript
const STORAGE_KEYS = {
  GROUP_SECRETS: 'witness_group_secrets',
  RECORDINGS_META: 'witness_recordings',
  LOCAL_ATTESTATIONS: 'witness_local_attestations',
  SEMAPHORE_IDENTITY: 'witness_semaphore_identity',
};
```

**Step 2: Update clearSecureStorage function**

```javascript
/**
 * Clear all secure storage (for logout)
 */
export function clearSecureStorage() {
  localStorage.removeItem(STORAGE_KEYS.GROUP_SECRETS);
  localStorage.removeItem(STORAGE_KEYS.LOCAL_ATTESTATIONS);
  localStorage.removeItem(STORAGE_KEYS.SEMAPHORE_IDENTITY);
}
```

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/storage.js
git commit -m "feat: clear attestation data on logout"
```

---

### Task 9: Create Attestation UI Component

**Files:**
- Create: `witness-pwa/src/ui/attestationPanel.js`

**Step 1: Create the attestation panel component**

```javascript
/**
 * Attestation Panel Component
 * Shows attestation count and attest button for content
 */

import { submitAttestation, hasLocallyAttested, fetchAttestationCount } from '../lib/attestation.js';
import { getGroupSecrets } from '../lib/storage.js';
import { getAuthState } from '../lib/authState.js';

/**
 * Create attestation panel HTML
 * @param {string} contentId - Content ID
 * @param {string[]} contentGroupIds - Groups content is shared with
 * @param {number} initialCount - Initial attestation count
 * @returns {string} HTML string
 */
export function createAttestationPanel(contentId, contentGroupIds, initialCount) {
  const hasAttested = hasLocallyAttested(contentId);

  return `
    <div class="attestation-section" data-content-id="${contentId}">
      <h3>Anonymous Attestations</h3>

      <div class="attestation-count-box">
        <div class="attestation-icon">🛡️</div>
        <div class="attestation-info">
          <span class="attestation-count" id="attestation-count-${contentId}">${initialCount}</span>
          <span class="attestation-label">group members have verified this evidence</span>
        </div>
        <div class="attestation-privacy-note">
          Identities are private. Only the count is public.
        </div>
      </div>

      <div class="attest-controls" id="attest-controls-${contentId}">
        ${hasAttested ? `
          <div class="already-attested">
            ✓ You have attested to this evidence
          </div>
        ` : `
          <div class="attest-form" id="attest-form-${contentId}">
            <label for="attest-group-${contentId}">Attest as member of:</label>
            <select id="attest-group-${contentId}" class="form-select">
              <option value="">Loading groups...</option>
            </select>
            <button class="btn btn-attest" id="btn-attest-${contentId}" disabled>
              🔐 Attest to Evidence
            </button>
            <div class="attest-progress" id="attest-progress-${contentId}" style="display: none;">
              <div class="spinner"></div>
              <span id="attest-message-${contentId}">Generating proof...</span>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

/**
 * Initialize attestation panel with group data
 * @param {string} contentId - Content ID
 * @param {string[]} contentGroupIds - Groups content is shared with
 */
export async function initAttestationPanel(contentId, contentGroupIds) {
  const { encryptionKey } = getAuthState();
  if (!encryptionKey) return;

  const hasAttested = hasLocallyAttested(contentId);
  if (hasAttested) return; // No need to load groups if already attested

  // Get user's groups
  const userGroups = await getGroupSecrets(encryptionKey);
  const attestableGroups = contentGroupIds.filter(gId => userGroups[gId]);

  const selectEl = document.getElementById(`attest-group-${contentId}`);
  const btnEl = document.getElementById(`btn-attest-${contentId}`);

  if (!selectEl || !btnEl) return;

  if (attestableGroups.length === 0) {
    selectEl.innerHTML = '<option value="">No matching groups</option>';
    const formEl = document.getElementById(`attest-form-${contentId}`);
    if (formEl) {
      formEl.innerHTML = `
        <div class="no-attest-access">
          You are not a member of any group this content is shared with.
        </div>
      `;
    }
    return;
  }

  // Populate group select
  selectEl.innerHTML = attestableGroups.map(gId => {
    const group = userGroups[gId];
    return `<option value="${gId}">${group.name}</option>`;
  }).join('');

  btnEl.disabled = false;

  // Add click handler
  btnEl.addEventListener('click', () => handleAttest(contentId));
}

/**
 * Handle attestation button click
 * @param {string} contentId - Content ID
 */
async function handleAttest(contentId) {
  const selectEl = document.getElementById(`attest-group-${contentId}`);
  const btnEl = document.getElementById(`btn-attest-${contentId}`);
  const progressEl = document.getElementById(`attest-progress-${contentId}`);
  const messageEl = document.getElementById(`attest-message-${contentId}`);
  const controlsEl = document.getElementById(`attest-controls-${contentId}`);

  const groupId = selectEl?.value;
  if (!groupId) return;

  try {
    // Show progress
    if (btnEl) btnEl.style.display = 'none';
    if (selectEl) selectEl.style.display = 'none';
    if (progressEl) progressEl.style.display = 'flex';

    const result = await submitAttestation(contentId, groupId, (progress) => {
      if (messageEl) messageEl.textContent = progress.message;
    });

    // Update count
    const countEl = document.getElementById(`attestation-count-${contentId}`);
    if (countEl) countEl.textContent = result.newCount;

    // Replace form with success message
    if (controlsEl) {
      controlsEl.innerHTML = `
        <div class="already-attested">
          ✓ You have attested to this evidence
        </div>
      `;
    }
  } catch (err) {
    // Restore form on error
    if (progressEl) progressEl.style.display = 'none';
    if (btnEl) btnEl.style.display = 'flex';
    if (selectEl) selectEl.style.display = 'block';

    alert('Attestation failed: ' + err.message);
  }
}

/**
 * Refresh attestation count
 * @param {string} contentId - Content ID
 */
export async function refreshAttestationCount(contentId) {
  try {
    const count = await fetchAttestationCount(contentId);
    const countEl = document.getElementById(`attestation-count-${contentId}`);
    if (countEl) countEl.textContent = count;
    return count;
  } catch (err) {
    console.error('[attestationPanel] Failed to refresh count:', err);
    return 0;
  }
}
```

**Step 2: Commit**

```bash
git add witness-pwa/src/ui/attestationPanel.js
git commit -m "feat: create reusable attestation panel component"
```

---

### Task 10: Deploy Updated Contract

**Files:**
- Create/Modify: `contracts/script/Deploy.s.sol`

**Step 1: Create deployment script**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/WitnessRegistry.sol";

contract DeployWitnessRegistry is Script {
    // Base Sepolia Semaphore address - verify at semaphore.pse.dev
    address constant SEMAPHORE_ADDRESS = 0x1e0d7FF1610e480fC93BdEC510811ea2Ba6d7c2f;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        WitnessRegistry registry = new WitnessRegistry(SEMAPHORE_ADDRESS);

        console.log("WitnessRegistry deployed to:", address(registry));

        vm.stopBroadcast();
    }
}
```

**Step 2: Deploy**

```bash
cd contracts
forge script script/Deploy.s.sol:DeployWitnessRegistry \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify
```

**Step 3: Update environment**

Update `.env` with new contract address from deployment output.

**Step 4: Commit**

```bash
git add contracts/script/Deploy.s.sol
git commit -m "deploy: add deployment script for Semaphore-integrated registry"
```

---

### Task 11: Integration Testing

**Step 1: Start dev server**

```bash
cd witness-pwa && npm run dev
```

**Step 2: Test identity creation**

1. Log in with test account
2. Create a new group
3. Check console for `[identity] Created, commitment: ...`
4. Verify group creation tx on Basescan

**Step 3: Test attestation flow**

1. Upload content to a group
2. Open content detail
3. Verify attestation count shows 0
4. Click "Attest to Evidence"
5. Wait for ZK proof (5-15s first time)
6. Verify tx submitted
7. Verify count increments to 1
8. Verify button shows "You have attested"

**Step 4: Test double-attestation prevention**

1. Try attesting to same content again
2. Should show "You have attested" - no button

**Step 5: Test with second account**

1. Log out, create second account
2. Join same group
3. Attest to same content
4. Verify count increments to 2

---

### Task 12: Build and Deploy

**Step 1: Build**

```bash
cd witness-pwa && npm run build
```

**Step 2: Preview locally**

```bash
npm run preview
```

Test attestation in production build.

**Step 3: Deploy**

```bash
rsync -avz witness-pwa/dist/ root@46.62.231.168:/var/www/witness/
```

**Step 4: Final commit**

```bash
git add .
git commit -m "feat: Phase 7 complete - anonymous attestations with Semaphore ZK proofs"
```

---

## Acceptance Criteria

- [ ] Semaphore packages installed and building
- [ ] Identity created deterministically from wallet signature
- [ ] Identity persisted in encrypted localStorage
- [ ] Contract updated with Semaphore integration
- [ ] Contract deployed to Base Sepolia
- [ ] createGroup includes identity commitment
- [ ] joinGroup includes identity commitment
- [ ] Attestation service generates valid ZK proofs
- [ ] Proofs verify on-chain
- [ ] Attestation count increments correctly
- [ ] Nullifier prevents double-attestation on same content
- [ ] Same user CAN attest to different content
- [ ] UI shows attestation count
- [ ] UI shows attest button for non-attested content
- [ ] UI shows confirmation for already-attested content
- [ ] No way to determine WHO attested (privacy verified)

---

## Technical Notes

### Semaphore V4 API

```javascript
// Identity (deterministic from seed)
const identity = new Identity(seed);
identity.commitment   // public - added to groups
identity.privateKey   // secret - for proofs

// Group
const group = new Group([commitment1, commitment2]);

// Proof generation
const proof = await generateProof(identity, group, message, scope);
// Returns: { merkleTreeRoot, nullifier, points, ... }
```

### Gas Costs

| Operation | Approximate Gas |
|-----------|-----------------|
| createGroup | ~150k |
| joinGroup | ~80k |
| attestToContent | ~300-400k |

### SNARK Downloads

First proof downloads ~2MB WASM/zkey from CDN. Cached in browser for subsequent proofs. Generation takes 5-15 seconds.

## Testing Plan

1. Clear Old Data First
Since the contract changed, clear your browser's localStorage for the app to start fresh:

Open DevTools → Application → Storage → Clear site data
2. Test Identity Creation (via Group Creation)
Log in with email
Go to My Groups
Click + Create Group
Enter a name and create
Expected: You'll be prompted to sign a message for "Create anonymous attestation identity"
Check console for: [identity] Created, commitment: ...
3. Test Content Upload
Record or upload test content
Select your new group
Upload
Expected: Content commits to new contract
4. Test Attestation
Go to Evidence tab

Tap on the uploaded content

Scroll down to see Anonymous Attestations section

Expected:

Shows "0 group members have verified"
Shows dropdown with your group
Shows "Attest to Evidence" button
Click 🔐 Attest to Evidence

Expected (first time - will take 5-15 seconds):

"Generating zero-knowledge proof..."
Progress through steps
Count increments to 1
Button changes to "✓ You have attested"
5. Test Double-Attestation Prevention
View the same content again
Expected: Already shows "✓ You have attested" (no button)
Key Console Logs to Watch

[identity] Created, commitment: 12345...
[attestation] Generating proof for content: 0x1234...
[attestation] Proof generated, nullifier: 98765...
[contract] Attestation tx: 0xabc...
[attestation] Complete! New count: 1

Test scenario: Anonymous attestation from different user

Device A (current session):

Create a new group
Note the group secret/QR code
Device B (different browser or incognito):

Go to https://witness.squirrlylabs.xyz
Log in with a different email
Join the group using the secret/QR
Either device: Upload content to the group

The OTHER device: Click "Attest" on the content

This proves someone else can attest
The attestation count increases but reveals nothing about who attested