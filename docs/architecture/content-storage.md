# Content Storage Architecture

This document describes how Witness Protocol stores encrypted content on IPFS and commits integrity proofs on-chain.

## Overview

Content is stored in a hybrid architecture:

1. **IPFS (Pinata)**: Encrypted content blobs + manifest JSON
2. **On-Chain (Base Sepolia)**: Merkle root + manifest CID + metadata

This provides:
- **Decentralized Storage**: Content lives on IPFS, not a central server
- **Immutability Proof**: On-chain Merkle root proves content hasn't changed
- **Gas Efficiency**: Only hashes stored on-chain, not actual content
- **Multi-Group Access**: Wrapped keys in manifest enable selective sharing

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CONTENT UPLOAD FLOW                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User records/selects content                                        │
│                                                                         │
│  2. Client-side encryption (content.js + encryption.js):                │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. Generate random contentKey (32 bytes)                        │ │
│     │ b. Encrypt content with contentKey (AES-256-GCM)                │ │
│     │ c. For each selected group:                                     │ │
│     │    - Wrap contentKey with groupSecret                           │ │
│     │    - Store wrapped key in accessList                            │ │
│     │ d. Compute SHA-256 hash of encrypted content                    │ │
│     │ e. Build Merkle tree from chunk hashes                          │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  3. Upload to IPFS (ipfs.js):                                           │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. Upload encrypted content → get contentCID                    │ │
│     │ b. Build manifest JSON with:                                    │ │
│     │    - contentCID                                                 │ │
│     │    - accessList (wrapped keys per group)                        │ │
│     │    - merkleRoot                                                 │ │
│     │    - metadata (timestamp, uploader, etc.)                       │ │
│     │ c. Upload manifest → get manifestCID                            │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  4. On-chain commitment (contract.js):                                  │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ commitContent(                                                  │ │
│     │   contentId,        // Unique identifier                        │ │
│     │   merkleRoot,       // Root of content hash tree                │ │
│     │   manifestCID,      // IPFS pointer to manifest                 │ │
│     │   groupIds[]        // Which groups have access                 │ │
│     │ )                                                               │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Manifest Structure

```typescript
interface ContentManifest {
  version: 1;
  contentId: string;              // keccak256 hash, unique ID
  uploader: string;               // Smart account address
  createdAt: number;              // Unix timestamp

  // Encrypted content
  content: {
    cid: string;                  // IPFS CID of encrypted content
    size: number;                 // Size in bytes
    mimeType: string;             // e.g., "video/mp4"
  };

  // Encryption details
  encryption: {
    algorithm: 'aes-256-gcm';
    iv: string;                   // Hex-encoded IV
  };

  // Access control - wrapped keys per group
  accessList: {
    [groupId: string]: {
      iv: string;                 // IV used for key wrapping
      wrappedKey: string;         // AES-GCM wrapped content key
    };
  };

  // Integrity
  merkleRoot: string;             // Root of content hash tree
  contentHash: string;            // SHA-256 of encrypted content
}
```

## On-Chain Data

```solidity
// WitnessRegistry.sol

struct ContentCommitment {
    bytes32 merkleRoot;           // Hash tree root
    string manifestCID;           // IPFS pointer
    address uploader;             // Who uploaded
    uint64 timestamp;             // When committed
}

// Indexed by contentId
mapping(bytes32 => ContentCommitment) public content;

// Group-to-content index
mapping(bytes32 => bytes32[]) public groupContent;

// Content-to-groups index
mapping(bytes32 => bytes32[]) public contentGroups;

// User-to-content index
mapping(address => bytes32[]) public userContent;
```

## Content Discovery Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONTENT DISCOVERY FLOW                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Query on-chain for content IDs (contentDiscovery.js):               │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. Get user's own content: userContent[address]                 │ │
│     │ b. For each group user is in:                                   │ │
│     │    - Get group content: groupContent[groupId]                   │ │
│     │ c. Deduplicate and merge                                        │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  2. For each contentId, fetch metadata:                                 │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ a. Get on-chain commitment: content[contentId]                  │ │
│     │ b. Extract manifestCID                                          │ │
│     │ c. Fetch manifest from IPFS                                     │ │
│     │ d. Cache manifest locally                                       │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  3. Display in content browser                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Content Decryption Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      CONTENT DECRYPTION FLOW                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. User taps on content to view (contentDecrypt.js):                   │
│                                                                         │
│  2. Find usable wrapped key:                                            │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ for each groupId in manifest.accessList:                        │ │
│     │   if user has groupSecret for this group:                       │ │
│     │     use this wrapped key                                        │ │
│     │     break                                                       │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  3. Unwrap content key:                                                 │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ contentKey = unwrapContentKey(                                  │ │
│     │   accessList[groupId].iv,                                       │ │
│     │   accessList[groupId].wrappedKey,                               │ │
│     │   groupSecret                                                   │ │
│     │ )                                                               │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  4. Download encrypted content from IPFS:                               │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ encryptedData = await downloadContent(manifest.content.cid)     │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  5. Verify integrity:                                                   │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ computedHash = SHA-256(encryptedData)                           │ │
│     │ if computedHash !== manifest.contentHash:                       │ │
│     │   throw "Content tampered!"                                     │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  6. Decrypt content:                                                    │
│     ┌─────────────────────────────────────────────────────────────────┐ │
│     │ plaintext = AES-256-GCM-decrypt(                                │ │
│     │   encryptedData,                                                │ │
│     │   contentKey,                                                   │ │
│     │   manifest.encryption.iv                                        │ │
│     │ )                                                               │ │
│     └─────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│  7. Display to user                                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Merkle Tree

### Construction

```javascript
// merkle.js

export async function computeMerkleRoot(data) {
  // For single-chunk content, root = hash of content
  const hash = await hashContent(data);
  return hash;
}

export async function hashContent(data) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return '0x' + bytesToHex(new Uint8Array(hashBuffer));
}
```

### Verification

The Merkle root stored on-chain can be compared against computed hash to verify content hasn't changed:

```javascript
// Verify content integrity
const computedRoot = await computeMerkleRoot(encryptedContent);
const onChainRoot = await getContent(contentId).merkleRoot;

if (computedRoot !== onChainRoot) {
  throw new Error('Content has been tampered with!');
}
```

## IPFS Integration

### Upload

```javascript
// ipfs.js

const PINATA_JWT = import.meta.env.VITE_PINATA_JWT;
const PINATA_GATEWAY = import.meta.env.VITE_PINATA_GATEWAY;

export async function uploadEncryptedData(encryptedData) {
  const formData = new FormData();
  formData.append('file', new Blob([encryptedData]));

  const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PINATA_JWT}`
    },
    body: formData
  });

  const result = await response.json();
  return result.IpfsHash; // CID
}

export async function uploadManifest(manifest) {
  const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${PINATA_JWT}`
    },
    body: JSON.stringify({
      pinataContent: manifest
    })
  });

  const result = await response.json();
  return result.IpfsHash;
}
```

### Download

```javascript
// ipfs.js

export async function downloadContent(cid) {
  const response = await fetch(`${PINATA_GATEWAY}/ipfs/${cid}`);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

export async function downloadManifest(cid) {
  const response = await fetch(`${PINATA_GATEWAY}/ipfs/${cid}`);
  return response.json();
}
```

## On-Chain Commit

```javascript
// contract.js

export async function commitContent(contentId, merkleRoot, manifestCID, groupIds) {
  const client = getSmartAccountClient();

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'commitContent',
      args: [contentId, merkleRoot, manifestCID, groupIds]
    })
  });

  return hash;
}
```

## Smart Contract Functions

```solidity
// WitnessRegistry.sol

function commitContent(
    bytes32 contentId,
    bytes32 merkleRoot,
    string calldata manifestCID,
    bytes32[] calldata groupIds
) external {
    // Verify user is registered
    if (!registered[msg.sender]) revert NotRegistered();

    // Verify content doesn't exist
    if (content[contentId].timestamp != 0) revert ContentAlreadyExists();

    // Verify manifest CID is provided
    if (bytes(manifestCID).length == 0) revert EmptyManifestCID();

    // Verify at least one group
    if (groupIds.length == 0) revert NoGroupsSpecified();

    // Verify user is member of all specified groups
    for (uint256 i = 0; i < groupIds.length; i++) {
        if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
    }

    // Store commitment
    content[contentId] = ContentCommitment({
        merkleRoot: merkleRoot,
        manifestCID: manifestCID,
        uploader: msg.sender,
        timestamp: uint64(block.timestamp)
    });

    // Index by groups
    for (uint256 i = 0; i < groupIds.length; i++) {
        contentGroups[contentId].push(groupIds[i]);
        groupContent[groupIds[i]].push(contentId);
    }

    // Index by user
    userContent[msg.sender].push(contentId);

    emit ContentCommitted(contentId, msg.sender, merkleRoot, manifestCID, timestamp);
}
```

## Security Properties

| Property | How It's Achieved |
|----------|-------------------|
| **Content Confidentiality** | AES-256-GCM encryption with random key |
| **Immutability Proof** | Merkle root on-chain |
| **Access Control** | Key wrapping with group secrets |
| **Decentralized Storage** | IPFS (content-addressed) |
| **Tamper Detection** | Hash verification before decryption |
| **Multi-Group Sharing** | Separate wrapped key per group |
| **Gas Efficiency** | Only hashes on-chain, content on IPFS |

## Files

| File | Purpose |
|------|---------|
| `witness-pwa/src/lib/content.js` | Upload orchestration |
| `witness-pwa/src/lib/contentDiscovery.js` | Content indexing |
| `witness-pwa/src/lib/contentDecrypt.js` | Download & decrypt |
| `witness-pwa/src/lib/ipfs.js` | Pinata API client |
| `witness-pwa/src/lib/merkle.js` | Merkle tree computation |
| `witness-pwa/src/lib/encryption.js` | Encryption functions |
| `contracts/src/WitnessRegistry.sol` | On-chain storage |
