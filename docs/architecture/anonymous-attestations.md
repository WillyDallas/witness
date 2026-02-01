# Anonymous Attestations Architecture

This document describes how Witness Protocol implements anonymous attestations using Semaphore V4 zero-knowledge proofs.

## Overview

When group members verify evidence, they can "attest" to its validity. The blockchain records:
- **Public**: How many group members attested
- **Private**: Which specific members attested

This is achieved using Semaphore, a ZK protocol that proves group membership without revealing identity.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ATTESTATION FLOW                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User views content → taps "Attest to Evidence"                      │
│                                                                         │
│  2. Client-side (identity.js + attestation.js):                         │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. Load Semaphore identity from encrypted localStorage          │ │
│     │ b. Fetch group member commitments from on-chain events          │ │
│     │ c. Build Group object with correct merkle tree                  │ │
│     │ d. Verify user's commitment is in the group                     │ │
│     │ e. Generate ZK proof:                                           │ │
│     │    - message = contentId (what we're attesting to)              │ │
│     │    - scope = contentId (makes nullifier content-specific)       │ │
│     │    - Output: { merkleTreeRoot, nullifier, points }              │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  3. Submit to contract:                                                 │
│     attestToContent(contentId, groupId, proof)                          │
│                                                                         │
│  4. Contract verifies (WitnessRegistry.sol):                            │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. Content is shared with this group                            │ │
│     │ b. Nullifier not already used (prevents double-attest)          │ │
│     │ c. ZK proof is valid via Semaphore.validateProof()              │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  5. On success:                                                         │
│     - nullifierUsed[proof.nullifier] = true                             │
│     - attestationCount[contentId]++                                     │
│     - emit AttestationCreated(contentId, groupId, newCount)             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Semaphore Identity

### Creation (Deterministic)

Identities are derived from wallet signatures, making them recoverable:

```javascript
// identity.js

// 1. Request EIP-712 typed signature
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

const signature = await provider.request({
  method: 'eth_signTypedData_v4',
  params: [walletAddress, JSON.stringify(typedData)]
});

// 2. Use signature as deterministic seed
const identity = new Identity(signature);

// identity.commitment  → public (added to groups)
// identity.privateKey  → secret (used for proofs)
```

### Storage

Identities are encrypted before storage:

```javascript
await setSecureItem('witness_semaphore_identity', {
  privateKey: identity.privateKey.toString(),
  commitment: identity.commitment.toString(),
  createdAt: new Date().toISOString()
}, encryptionKey);
```

### Recovery

Same wallet = same signature = same identity. If a user reinstalls the app, they can recover their identity by signing the same typed data.

## Group Membership

When a user creates or joins a Witness group, their identity commitment is also added to a parallel Semaphore group:

```solidity
// WitnessRegistry.sol

function createGroup(bytes32 groupId, uint256 identityCommitment) external {
    // Create Witness group
    groups[groupId] = Group({...});
    groupMembers[groupId][msg.sender] = true;

    // Create parallel Semaphore group
    uint256 semGroupId = semaphore.createGroup();
    semaphoreGroupId[groupId] = semGroupId;

    // Add creator to Semaphore group
    semaphore.addMember(semGroupId, identityCommitment);
}

function joinGroup(bytes32 groupId, uint256 identityCommitment) external {
    // Add to Witness group
    groupMembers[groupId][msg.sender] = true;

    // Add to Semaphore group
    uint256 semGroupId = semaphoreGroupId[groupId];
    semaphore.addMember(semGroupId, identityCommitment);
}
```

## ZK Proof Generation

### Building the Group Merkle Tree

The client must reconstruct the exact merkle tree that exists on-chain:

```javascript
// attestation.js

async function buildGroupFromChain(witnessGroupId) {
  // Get Semaphore group ID for this Witness group
  const semGroupId = await getSemaphoreGroupId(witnessGroupId);

  // Fetch all member commitments from on-chain events
  const { commitments, onChainRoot } = await getSemaphoreGroupMembers(semGroupId);

  // Build Group with all members in correct order
  const group = new Group(commitments);

  // Verify merkle roots match
  if (group.root.toString() !== onChainRoot.toString()) {
    console.error('Merkle root mismatch!');
  }

  return group;
}
```

### Generating the Proof

```javascript
// attestation.js

async function submitAttestation(contentId, groupId, onProgress) {
  // 1. Load identity
  const identity = await getStoredIdentity(encryptionKey);

  // 2. Build group from on-chain data
  const group = await buildGroupFromChain(groupId);

  // 3. Verify user is a member
  const memberIndex = group.indexOf(identity.commitment);
  if (memberIndex === -1) {
    throw new Error('Your identity is not in this group');
  }

  // 4. Generate ZK proof
  const scope = BigInt(contentId);   // Makes nullifier content-specific
  const message = BigInt(contentId); // What we're attesting to

  const proof = await generateProof(identity, group, message, scope);

  // proof contains:
  // - merkleTreeDepth: tree depth
  // - merkleTreeRoot: root of the group tree
  // - nullifier: unique per identity+scope (prevents double-attest)
  // - message: the contentId
  // - scope: the contentId
  // - points: the ZK proof data

  // 5. Submit to contract
  const txHash = await contractAttestToContent(contentId, groupId, proof);

  return { txHash, newCount: await getAttestationCount(contentId) };
}
```

## On-Chain Verification

```solidity
// WitnessRegistry.sol

function attestToContent(
    bytes32 contentId,
    bytes32 groupId,
    ISemaphore.SemaphoreProof calldata proof
) external {
    // 1. Verify content is shared with this group
    bool inGroup = false;
    bytes32[] memory groups_ = contentGroups[contentId];
    for (uint256 i = 0; i < groups_.length; i++) {
        if (groups_[i] == groupId) {
            inGroup = true;
            break;
        }
    }
    if (!inGroup) revert ContentNotInGroup();

    // 2. Check nullifier not used (prevents double-attestation)
    if (nullifierUsed[proof.nullifier]) revert NullifierAlreadyUsed();

    // 3. Verify ZK proof via Semaphore contract
    uint256 semGroupId = semaphoreGroupId[groupId];
    semaphore.validateProof(semGroupId, proof);

    // 4. Record attestation
    nullifierUsed[proof.nullifier] = true;
    attestationCount[contentId]++;

    emit AttestationCreated(contentId, groupId, attestationCount[contentId], timestamp);
}
```

## Privacy Properties

| Property | Guarantee |
|----------|-----------|
| **Anonymity** | Only the attestation count is public. There is no way to determine which group members attested. |
| **No Double-Attest** | The nullifier (derived from identity + scope) prevents the same user from attesting to the same content twice. |
| **Cross-Content** | Same user CAN attest to different content (different scope = different nullifier). |
| **Sybil Resistance** | Only users whose identity commitment is in the Semaphore group can generate valid proofs. |
| **Non-Repudiation** | Users cannot prove they attested (or didn't attest) to anyone. |

## Nullifier Mechanics

The nullifier is derived from:
- The user's identity secret
- The scope (contentId in our case)

```
nullifier = hash(identity.secret, scope)
```

This means:
- Same identity + same content = same nullifier (blocked)
- Same identity + different content = different nullifier (allowed)
- Different identity + same content = different nullifier (allowed)

## Gas Costs

| Operation | Approximate Gas |
|-----------|-----------------|
| Create Group (with Semaphore) | ~150k |
| Join Group (with Semaphore) | ~80k |
| Attest to Content | ~300-400k |

The higher cost for attestation is due to ZK proof verification on-chain.

## SNARK Artifacts

Semaphore uses SNARK proofs which require circuit artifacts (WASM + zkey files):
- First proof generation downloads ~2MB from CDN
- Cached in browser for subsequent proofs
- Generation takes 5-15 seconds (first time may be longer)

## Local Attestation Tracking

Since attestations are anonymous, we can't check on-chain if the current user has attested. Instead, we track locally:

```javascript
// attestation.js

const LOCAL_ATTESTATIONS_KEY = 'witness_local_attestations';

function recordLocalAttestation(contentId, groupId) {
  const attestations = getItem(LOCAL_ATTESTATIONS_KEY) || {};
  attestations[contentId] = {
    groupId,
    attestedAt: new Date().toISOString()
  };
  setItem(LOCAL_ATTESTATIONS_KEY, attestations);
}

function hasLocallyAttested(contentId) {
  const attestations = getItem(LOCAL_ATTESTATIONS_KEY) || {};
  return !!attestations[contentId];
}
```

This is cleared on logout, matching the fact that a new device/session wouldn't have this information.

## UI Integration

The attestation panel shows:
1. Current attestation count
2. Privacy notice ("Identities are private. Only the count is public.")
3. Attest button (if not already attested)
4. Group selector (if user is in multiple groups that have access)
5. Progress indicator during proof generation
6. Success confirmation after attestation

## Files

| File | Purpose |
|------|---------|
| `witness-pwa/src/lib/identity.js` | Semaphore identity creation & storage |
| `witness-pwa/src/lib/attestation.js` | Proof generation & submission |
| `witness-pwa/src/ui/attestationPanel.js` | Attestation UI component |
| `contracts/src/WitnessRegistry.sol` | On-chain verification |
