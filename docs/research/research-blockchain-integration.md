# Blockchain integration blueprint for Witness Protocol

**EAS on Base Sepolia emerges as the recommended foundation** for this 3-day hackathon project, combining battle-tested infrastructure with free gas sponsorship and minimal integration code. The evidence timestamping core is achievable in Day 1-2, while dead man's switch and access control features make compelling Day 3 stretch goals.

The Witness Protocol concept—streaming video/audio/GPS to decentralized storage with blockchain proof—aligns perfectly with EAS's attestation model. Using EAS instead of custom contracts saves approximately **8-12 hours of development time** while providing audited security, built-in explorers for verification demos, and ecosystem composability. For gasless UX, Base Sepolia's native Coinbase paymaster eliminates the need for API keys during hackathon development.

---

## Hash timestamping forms the immutable proof layer

The fundamental pattern stores only a **32-byte hash** on-chain—never the actual evidence. This approach costs approximately **45,000 gas** (~$0.01-0.05 on L2s) per submission while providing cryptographic proof that specific content existed at a specific time.

### Minimal evidence registry contract

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract WitnessRegistry {
    struct Evidence {
        uint96 timestamp;   // Fits in one slot with address
        address submitter;
    }
    
    mapping(bytes32 => Evidence) public registry;
    
    event EvidenceTimestamped(
        bytes32 indexed contentHash,
        address indexed submitter,
        uint256 timestamp
    );
    
    function timestamp(bytes32 contentHash) external {
        require(registry[contentHash].timestamp == 0, "Already exists");
        
        registry[contentHash] = Evidence({
            timestamp: uint96(block.timestamp),
            submitter: msg.sender
        });
        
        emit EvidenceTimestamped(contentHash, msg.sender, block.timestamp);
    }
    
    function verify(bytes32 contentHash) external view returns (
        bool exists,
        uint256 timestampedAt,
        address submittedBy
    ) {
        Evidence memory e = registry[contentHash];
        return (e.timestamp != 0, uint256(e.timestamp), e.submitter);
    }
}
```

### Merkle batching reduces costs by 99%+

Instead of storing N individual hashes, batch them into a Merkle tree and store only the root. This transforms the economics: **1,000 evidence items cost the same as 1** (~45,000 gas total), with individual verification via off-chain proofs.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract WitnessMerkleBatch {
    struct Batch {
        bytes32 root;
        uint64 timestamp;
        uint32 count;
        address submitter;
    }
    
    Batch[] public batches;
    
    event BatchSubmitted(uint256 indexed batchId, bytes32 indexed root, uint32 count);
    
    function submitBatch(bytes32 root, uint32 count) external returns (uint256) {
        uint256 batchId = batches.length;
        batches.push(Batch(root, uint64(block.timestamp), count, msg.sender));
        emit BatchSubmitted(batchId, root, count);
        return batchId;
    }
    
    function verifyProof(
        uint256 batchId,
        bytes32 evidenceHash,
        bytes32[] calldata proof
    ) external view returns (bool valid, uint256 timestamp) {
        Batch memory b = batches[batchId];
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(evidenceHash))));
        return (MerkleProof.verify(proof, b.root, leaf), b.timestamp);
    }
}
```

**Off-chain tree construction** uses OpenZeppelin's merkle-tree library:
```javascript
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";

const evidenceHashes = [["0x1234..."], ["0x5678..."], ["0x9abc..."]];
const tree = StandardMerkleTree.of(evidenceHashes, ["bytes32"]);

console.log("Root:", tree.root);  // Submit this on-chain
const proof = tree.getProof(0);   // Generate for verification
```

### Gas cost comparison table

| Approach | 1 Item | 100 Items | 1,000 Items | Cost @ $0.01/45k gas |
|----------|--------|-----------|-------------|---------------------|
| Individual hashes | 45k | 4.5M | 45M | $0.01 / $1 / $10 |
| Merkle root | 45k | 45k | 45k | $0.01 / $0.01 / $0.01 |

---

## EAS provides production-ready attestation infrastructure

The Ethereum Attestation Service eliminates the need to build custom timestamping contracts from scratch. It's **audited, tokenless, and deployed across all major chains** including Sepolia, Base Sepolia, Optimism Sepolia, and Arbitrum Sepolia.

### Schema design for video evidence

```solidity
// Recommended schema string for Witness Protocol
bytes32 contentHash, uint64 captureTimestamp, string locationData, 
bytes32 deviceFingerprint, string contentType
```

Register this schema once (costs ~50-100k gas), then create unlimited attestations referencing it.

### TypeScript attestation creation

```typescript
import { EAS, SchemaEncoder, NO_EXPIRATION } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";
import crypto from "crypto";

const EAS_ADDRESS = "0x4200000000000000000000000000000000000021"; // Base Sepolia
const SCHEMA_UID = "0xYourRegisteredSchemaUID";

const eas = new EAS(EAS_ADDRESS);
eas.connect(signer);

// Hash the video file
const videoBuffer = await fs.readFile("evidence.mp4");
const contentHash = "0x" + crypto.createHash("sha256").update(videoBuffer).digest("hex");

const schemaEncoder = new SchemaEncoder(
  "bytes32 contentHash, uint64 captureTimestamp, string locationData, bytes32 deviceFingerprint, string contentType"
);

const encodedData = schemaEncoder.encodeData([
  { name: "contentHash", value: contentHash, type: "bytes32" },
  { name: "captureTimestamp", value: BigInt(Date.now() / 1000), type: "uint64" },
  { name: "locationData", value: "18.7883,98.9853", type: "string" },  // Chiang Mai
  { name: "deviceFingerprint", value: deviceHash, type: "bytes32" },
  { name: "contentType", value: "video/mp4", type: "string" }
]);

const tx = await eas.attest({
  schema: SCHEMA_UID,
  data: {
    recipient: "0x0000000000000000000000000000000000000000",
    expirationTime: NO_EXPIRATION,
    revocable: true,
    data: encodedData
  }
});

const attestationUID = await tx.wait();
```

### Off-chain attestations eliminate gas costs entirely

For high-volume evidence capture, sign attestations off-chain and store on IPFS:

```typescript
const offchain = await eas.getOffchain();

const offchainAttestation = await offchain.signOffchainAttestation({
  recipient: "0x0000000000000000000000000000000000000000",
  expirationTime: NO_EXPIRATION,
  time: BigInt(Math.floor(Date.now() / 1000)),
  revocable: true,
  schema: SCHEMA_UID,
  refUID: "0x0000000000000000000000000000000000000000000000000000000000000000",
  data: encodedData
}, signer);

// Store JSON to IPFS - zero gas cost, cryptographically verifiable
```

### EAS contract addresses by testnet

| Testnet | EAS Contract | SchemaRegistry |
|---------|--------------|----------------|
| **Sepolia** | `0xC2679fBD37d54388Ce493F1DB75320D236e1815e` | `0x0a7E2Ff54e76B8E6659aedc9103FB21c038050D0` |
| **Base Sepolia** | `0x4200000000000000000000000000000000000021` | `0x4200000000000000000000000000000000000020` |
| **Optimism Sepolia** | `0x4200000000000000000000000000000000000021` | `0x4200000000000000000000000000000000000020` |
| **Arbitrum Sepolia** | `0xbD75f629A22Dc1ceD33dDA0b68c546A1c035c458` | `0xA310da9c5B885E7fb3fbA9D66E9Ba6Df512b78eB` |

---

## Base Sepolia wins the chain comparison for gasless transactions

After analyzing all four testnets for ERC-4337 paymaster ecosystems, **Base Sepolia emerges as the clear winner** for hackathon development due to Coinbase's native paymaster requiring no API keys.

### Testnet comparison matrix

| Feature | Sepolia | Base Sepolia | Arbitrum Sepolia | Optimism Sepolia |
|---------|---------|--------------|------------------|------------------|
| **Block time** | ~12s | ~2s | ~0.3s | ~2s |
| **Native paymaster** | ❌ | ✅ Coinbase | ❌ | ❌ |
| **EAS predeploy** | ❌ | ✅ | ❌ | ✅ |
| **Pimlico support** | ✅ | ✅ | ✅ | ✅ |
| **Gas costs** | Higher | Very low | Very low | Very low |

### Coinbase paymaster integration (zero API key required)

```typescript
// Base Sepolia native paymaster - no signup needed
const paymasterUrl = "https://paymaster.base.org";

// Works with standard ERC-4337 bundler calls
const paymasterData = await fetch(paymasterUrl, {
  method: "POST",
  body: JSON.stringify({
    jsonrpc: "2.0",
    method: "eth_paymasterAndDataForUserOperation",
    params: [userOperation, entryPointAddress, chainId]
  })
});
```

### EntryPoint addresses (universal across chains)

| Version | Address | Recommendation |
|---------|---------|----------------|
| **v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | ✅ Use this |
| v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | Legacy |

### Faucet URLs for Base Sepolia

- **Coinbase Developer Platform**: https://www.coinbase.com/developer-platform/products/faucet (includes ETH + USDC)
- **Alchemy**: https://www.alchemy.com/faucets/base-sepolia
- **Superchain Faucet**: https://console.optimism.io/faucet

---

## Dead man's switch enables emergency evidence release

This stretch goal pattern triggers automatic key release if the user fails to check in within a specified period—critical for journalist and activist safety scenarios.

### Basic implementation

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DeadMansSwitch {
    address public owner;
    address public beneficiary;
    uint256 public lastCheckIn;
    uint256 public checkInInterval;
    uint256 public gracePeriod;
    bytes public encryptedKey;
    
    enum Status { Active, Triggered }
    Status public status;
    
    event CheckIn(uint256 timestamp);
    event SwitchTriggered(address triggeredBy, bytes encryptedKey);
    
    constructor(address _beneficiary, uint256 _intervalDays, uint256 _graceDays) {
        owner = msg.sender;
        beneficiary = _beneficiary;
        checkInInterval = _intervalDays * 1 days;
        gracePeriod = _graceDays * 1 days;
        lastCheckIn = block.timestamp;
        status = Status.Active;
    }
    
    function checkIn() external {
        require(msg.sender == owner, "Not owner");
        require(status == Status.Active, "Already triggered");
        lastCheckIn = block.timestamp;
        emit CheckIn(block.timestamp);
    }
    
    function setEncryptedKey(bytes calldata _key) external {
        require(msg.sender == owner, "Not owner");
        encryptedKey = _key;
    }
    
    function isTriggerable() public view returns (bool) {
        return status == Status.Active && 
               block.timestamp > lastCheckIn + checkInInterval + gracePeriod;
    }
    
    function trigger() external {
        require(isTriggerable(), "Cannot trigger yet");
        status = Status.Triggered;
        emit SwitchTriggered(msg.sender, encryptedKey);
    }
    
    function timeRemaining() external view returns (uint256) {
        uint256 deadline = lastCheckIn + checkInInterval + gracePeriod;
        return block.timestamp >= deadline ? 0 : deadline - block.timestamp;
    }
}
```

### Gas costs for dead man's switch operations

| Operation | Gas Units | Cost on Base Sepolia |
|-----------|-----------|---------------------|
| Deploy | ~300,000 | ~$0.05-0.10 |
| checkIn() | ~28,000 | ~$0.005 |
| trigger() | ~45,000 | ~$0.01 |
| setEncryptedKey() | ~50-100k | ~$0.01-0.02 |

### Lit Protocol for condition-based decryption

Rather than storing keys on-chain, use Lit Protocol for threshold encryption that decrypts only when smart contract conditions are met:

```javascript
const accessControlConditions = [{
  contractAddress: "0xYourDeadMansSwitchContract",
  standardContractType: "Custom",
  chain: "baseSepolia",
  method: "isTriggered",
  parameters: [],
  returnValueTest: {
    comparator: "=",
    value: "true"
  }
}];

// Evidence can only be decrypted when isTriggered() returns true
const { ciphertext, dataToEncryptHash } = await litClient.encrypt({
  accessControlConditions,
  dataToEncrypt: evidenceDecryptionKey,
});
```

---

## On-chain access control manages trusted contacts

### Simple address allowlist (recommended for hackathon)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TrustedContacts {
    address public owner;
    mapping(address => bool) public trusted;
    mapping(address => uint256) public addedAt;
    
    event ContactAdded(address indexed contact);
    event ContactRemoved(address indexed contact);
    
    constructor() {
        owner = msg.sender;
    }
    
    function addContact(address contact) external {
        require(msg.sender == owner, "Not owner");
        require(!trusted[contact], "Already trusted");
        trusted[contact] = true;
        addedAt[contact] = block.timestamp;
        emit ContactAdded(contact);
    }
    
    function removeContact(address contact) external {
        require(msg.sender == owner, "Not owner");
        trusted[contact] = false;
        emit ContactRemoved(contact);
    }
    
    function isTrusted(address contact) external view returns (bool) {
        return trusted[contact];
    }
}
```

**Gas costs**: ~45,000 gas to add a contact, ~5,000 to remove.

### Merkle-based allowlist for larger lists

For 50+ contacts, a Merkle tree approach stores only one root on-chain:

```solidity
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

contract MerkleAllowlist {
    bytes32 public merkleRoot;
    
    function updateRoot(bytes32 _root) external {
        merkleRoot = _root;
    }
    
    function verifyMembership(bytes32[] calldata proof) external view returns (bool) {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender))));
        return MerkleProof.verify(proof, merkleRoot, leaf);
    }
}
```

### Key distribution problem solutions

| Approach | Pros | Cons | Hackathon Viable |
|----------|------|------|------------------|
| **Lit Protocol** | No key management, condition-based | Learning curve | ✅ Day 3 stretch |
| **Asymmetric encryption** | Standard crypto | Key registry needed | ✅ Medium effort |
| **Shamir's Secret Sharing** | Threshold security | Complex implementation | ⚠️ Post-hackathon |

---

## Technical stack and SDK versions

### Foundry setup

```bash
forge init witness-protocol && cd witness-protocol
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2
forge install ethereum-attestation-service/eas-contracts
```

**foundry.toml configuration:**
```toml
[profile.default]
solc = "0.8.25"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
base_sepolia = "${BASE_SEPOLIA_RPC_URL}"
```

### NPM packages with versions

| Package | Version | Purpose |
|---------|---------|---------|
| `viem` | **2.44.1** | Core Ethereum interface (preferred over ethers) |
| `permissionless` | **0.3.2** | ERC-4337 smart accounts, bundlers |
| `@ethereum-attestation-service/eas-sdk` | **2.9.0** | EAS attestations |
| `@openzeppelin/merkle-tree` | **1.x** | Off-chain Merkle tree construction |
| `wagmi` | **3.3.2** | React hooks for Ethereum |

### Installation command

```bash
npm install viem permissionless @ethereum-attestation-service/eas-sdk @openzeppelin/merkle-tree
```

### Context7 library IDs

| Library | Context7 ID |
|---------|-------------|
| EAS SDK | `/ethereum-attestation-service/eas-sdk` |
| permissionless.js | `/pimlicolabs/permissionless.js` |
| viem | `/wevm/viem` |
| forge-std | `/foundry-rs/forge-std` |
| EAS Contracts | `/ethereum-attestation-service/eas-contracts` |
| OpenZeppelin Contracts | `/OpenZeppelin/openzeppelin-contracts` |

### GitHub repositories with file paths

| Repository | Key Files |
|------------|-----------|
| https://github.com/ethereum-attestation-service/eas-contracts | `/contracts/EAS.sol`, `/contracts/SchemaRegistry.sol` |
| https://github.com/ethereum-attestation-service/eas-sdk | `/src/eas.ts`, `/src/offchain/offchain.ts` |
| https://github.com/pimlicolabs/permissionless.js | `/packages/permissionless/` |
| https://github.com/OpenZeppelin/merkle-tree | `/src/standard.ts` |
| https://github.com/eth-infinitism/account-abstraction | `/contracts/samples/SimpleAccount.sol` |

---

## Hackathon scoping recommendation

### Day 1-2: Core scope (must complete)

| Component | Time | Complexity | Demo Impact |
|-----------|------|------------|-------------|
| Register EAS schema on Base Sepolia | 1-2h | Simple | Medium |
| Evidence hash + attestation flow | 3-4h | Simple | High |
| Smart account with Coinbase paymaster | 2-3h | Medium | High |
| Basic verification UI | 2-3h | Simple | High |
| IPFS upload for evidence | 2h | Simple | Medium |

**Day 1-2 deliverable**: User captures video → hash computed → EAS attestation created (gasless) → verification link generated.

### Day 3: Stretch goals (pick 1-2)

| Feature | Time | Complexity | Demo Impact | Genuine Utility |
|---------|------|------------|-------------|-----------------|
| Dead man's switch (basic) | 3-4h | Medium | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Merkle batching | 2-3h | Medium | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Trusted contacts allowlist | 2-3h | Simple | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Lit Protocol integration | 4-6h | Medium | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Off-chain attestations + IPFS | 2h | Simple | ⭐⭐⭐ | ⭐⭐⭐⭐ |

**Recommended Day 3 focus**: Dead man's switch provides the highest combination of demo impact ("wow factor") and genuine utility for a safety application. The basic pattern is achievable in 3-4 hours.

### What's blockchain theater vs genuine utility

| Feature | Genuine Utility | Blockchain Theater |
|---------|----------------|-------------------|
| Hash timestamping | ✅ Proves content existed at time | - |
| EAS attestations | ✅ Standardized, verifiable, composable | - |
| Gasless transactions | ✅ Critical for UX | - |
| Dead man's switch | ✅ Real safety mechanism | - |
| Merkle batching | ✅ Cost reduction at scale | ⚠️ Overkill for demo |
| On-chain key storage | - | ⚠️ Security risk |
| Full Shamir's on-chain | - | ❌ Impractical |

### Open questions requiring hands-on testing

1. **Base Sepolia paymaster limits**: Does the free Coinbase paymaster have rate limits during hackathon usage?
2. **EAS schema composability**: How do linked attestations (refUID) perform for evidence chains?
3. **Lit Protocol latency**: What's the decryption latency when smart contract conditions change?
4. **Mobile device fingerprinting**: What metadata is reliably available across iOS/Android for deviceFingerprint?
5. **IPFS pinning during demo**: Should use Pinata/web3.storage for reliable demo availability?

---

## Conclusion

The Witness Protocol blockchain integration is **highly achievable in 3 days** using EAS on Base Sepolia as the foundation. The recommended architecture layers EAS attestations for evidence proof, Coinbase paymaster for gasless UX, and optional dead man's switch for safety features.

**Critical success factors**:
- Use EAS instead of custom contracts to save 8+ hours
- Deploy on Base Sepolia for free gas sponsorship
- Prioritize the happy path (capture → attest → verify) before stretch goals
- The dead man's switch is the highest-impact stretch goal for a safety app
- Test paymaster integration early—gasless UX is the demo's "magic moment"

**Technical debt to address post-hackathon**: Threshold key recovery, multi-chain attestation bridging, and production-grade key management via Lit Protocol or similar.