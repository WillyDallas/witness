# Phase 2: Smart Contract & On-Chain Registration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deploy WitnessRegistry smart contract to Base Sepolia and enable gasless user registration through the existing Pimlico-powered smart account.

**Architecture:** Create a Foundry project for the WitnessRegistry contract, write comprehensive tests, deploy to Base Sepolia with verification, then integrate with the PWA via a new contract service that uses the existing smart account client for gasless transactions.

**Tech Stack:** Foundry (forge, cast), Solidity 0.8.x, viem, permissionless, Base Sepolia (chainId 84532)

---

## Prerequisites

Before starting, ensure you have:
- Phase 1 complete (Privy auth + smart account working)
- Foundry installed (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Pimlico API key configured in `.env`
- Base Sepolia ETH in deployer wallet (for contract deployment only)

---

## Task 1: Initialize Foundry Project Structure

**Files:**
- Create: `contracts/foundry.toml`
- Create: `contracts/src/WitnessRegistry.sol`
- Create: `contracts/test/WitnessRegistry.t.sol`
- Create: `contracts/script/DeployWitnessRegistry.s.sol`
- Create: `contracts/.gitignore`

**Step 1: Create contracts directory**

```bash
mkdir -p contracts
cd contracts
```

**Step 2: Initialize Foundry project**

```bash
forge init --no-git
```

Expected output: `Initializing /Users/.../witness/contracts...`

**Step 3: Configure foundry.toml**

Replace `contracts/foundry.toml` with:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"
optimizer = true
optimizer_runs = 200
via_ir = false

# Base Sepolia configuration
[rpc_endpoints]
base-sepolia = "${BASE_SEPOLIA_RPC_URL}"

[etherscan]
base-sepolia = { key = "${BASESCAN_API_KEY}", url = "https://api-sepolia.basescan.org/api" }

[fmt]
line_length = 100
tab_width = 4
bracket_spacing = true
```

**Step 4: Create .gitignore**

Create `contracts/.gitignore`:

```
# Compiler files
cache/
out/

# Ignores development broadcast logs
!/broadcast
/broadcast/*/31337/
/broadcast/**/dry-run/

# Docs
docs/

# Dotenv file
.env
```

**Step 5: Install OpenZeppelin contracts**

```bash
cd contracts && forge install OpenZeppelin/openzeppelin-contracts --no-commit
```

**Step 6: Add remapping for OpenZeppelin**

Create `contracts/remappings.txt`:

```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

**Step 7: Commit**

```bash
git add contracts/
git commit -m "feat: initialize Foundry project structure for smart contracts"
```

---

## Task 2: Write WitnessRegistry Contract - Data Structures

**Files:**
- Modify: `contracts/src/WitnessRegistry.sol`

**Step 1: Write the basic contract structure with events and structs**

Replace `contracts/src/WitnessRegistry.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title WitnessRegistry
 * @notice On-chain registry for Witness Protocol users, groups, and content commitments
 * @dev Minimal on-chain footprint - heavy data lives on IPFS
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

    // User registration
    mapping(address => bool) public registered;
    mapping(address => uint64) public registeredAt;

    // Group management
    mapping(bytes32 => Group) public groups;
    mapping(bytes32 => mapping(address => bool)) public groupMembers;
    mapping(bytes32 => address[]) internal _groupMemberList;

    // Content commitments
    mapping(bytes32 => ContentCommitment) public content;
    mapping(bytes32 => bytes32[]) public contentGroups; // contentId => groupIds
    mapping(bytes32 => bytes32[]) public groupContent; // groupId => contentIds
    mapping(address => bytes32[]) public userContent; // user => contentIds

    // ============================================
    // EVENTS
    // ============================================

    event UserRegistered(address indexed user, uint64 timestamp);
    event GroupCreated(bytes32 indexed groupId, address indexed creator, uint64 timestamp);
    event GroupJoined(bytes32 indexed groupId, address indexed member, uint64 timestamp);
    event ContentCommitted(
        bytes32 indexed contentId,
        address indexed uploader,
        bytes32 merkleRoot,
        string manifestCID,
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
}
```

**Step 2: Verify it compiles**

```bash
cd contracts && forge build
```

Expected: `Compiler run successful!`

**Step 3: Commit**

```bash
git add contracts/src/WitnessRegistry.sol
git commit -m "feat: add WitnessRegistry data structures and events"
```

---

## Task 3: Write Tests for User Registration

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`

**Step 1: Write the failing test for registration**

Replace `contracts/test/WitnessRegistry.t.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {WitnessRegistry} from "../src/WitnessRegistry.sol";

contract WitnessRegistryTest is Test {
    WitnessRegistry public registry;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    function setUp() public {
        registry = new WitnessRegistry();
    }

    // ============================================
    // REGISTRATION TESTS
    // ============================================

    function test_Register_Success() public {
        vm.prank(alice);
        registry.register();

        assertTrue(registry.registered(alice));
        assertGt(registry.registeredAt(alice), 0);
    }

    function test_Register_EmitsEvent() public {
        vm.prank(alice);
        vm.expectEmit(true, false, false, true);
        emit WitnessRegistry.UserRegistered(alice, uint64(block.timestamp));
        registry.register();
    }

    function test_Register_RevertIfAlreadyRegistered() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.AlreadyRegistered.selector);
        registry.register();
    }

    function test_IsRegistered_ReturnsFalseForNewUser() public view {
        assertFalse(registry.registered(alice));
    }
}
```

**Step 2: Run tests to verify they fail**

```bash
cd contracts && forge test -vv
```

Expected: Tests fail with "register()" not found

**Step 3: Implement the register function**

Add to `contracts/src/WitnessRegistry.sol` (before the closing brace):

```solidity
    // ============================================
    // USER REGISTRATION
    // ============================================

    /**
     * @notice Register the caller as a Witness Protocol user
     * @dev Emits UserRegistered event
     */
    function register() external {
        if (registered[msg.sender]) revert AlreadyRegistered();

        registered[msg.sender] = true;
        registeredAt[msg.sender] = uint64(block.timestamp);

        emit UserRegistered(msg.sender, uint64(block.timestamp));
    }
```

**Step 4: Run tests to verify they pass**

```bash
cd contracts && forge test -vv --match-contract WitnessRegistryTest
```

Expected: All 4 tests pass

**Step 5: Commit**

```bash
git add contracts/src/WitnessRegistry.sol contracts/test/WitnessRegistry.t.sol
git commit -m "feat: implement user registration with tests"
```

---

## Task 4: Write Tests and Implement Group Creation

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`
- Modify: `contracts/src/WitnessRegistry.sol`

**Step 1: Add failing tests for group creation**

Add to `contracts/test/WitnessRegistry.t.sol` (inside the contract):

```solidity
    // ============================================
    // GROUP CREATION TESTS
    // ============================================

    bytes32 public constant TEST_GROUP_ID = keccak256("test-group-secret");

    function test_CreateGroup_Success() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        (address creator, uint64 createdAt, bool active) = registry.groups(TEST_GROUP_ID);
        assertEq(creator, alice);
        assertGt(createdAt, 0);
        assertTrue(active);
        assertTrue(registry.groupMembers(TEST_GROUP_ID, alice));
    }

    function test_CreateGroup_EmitsEvent() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit WitnessRegistry.GroupCreated(TEST_GROUP_ID, alice, uint64(block.timestamp));
        registry.createGroup(TEST_GROUP_ID);
    }

    function test_CreateGroup_RevertIfNotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.NotRegistered.selector);
        registry.createGroup(TEST_GROUP_ID);
    }

    function test_CreateGroup_RevertIfGroupExists() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        vm.prank(bob);
        registry.register();

        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.GroupAlreadyExists.selector);
        registry.createGroup(TEST_GROUP_ID);
    }
```

**Step 2: Run tests to verify they fail**

```bash
cd contracts && forge test -vv --match-test "test_CreateGroup"
```

Expected: Tests fail with "createGroup(bytes32)" not found

**Step 3: Implement createGroup function**

Add to `contracts/src/WitnessRegistry.sol`:

```solidity
    // ============================================
    // GROUP MANAGEMENT
    // ============================================

    /**
     * @notice Create a new group
     * @param groupId The keccak256 hash of the group secret
     * @dev Caller must be registered. Creator is automatically added as member.
     */
    function createGroup(bytes32 groupId) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt != 0) revert GroupAlreadyExists();

        groups[groupId] = Group({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            active: true
        });

        // Creator is automatically a member
        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        emit GroupCreated(groupId, msg.sender, uint64(block.timestamp));
    }
```

**Step 4: Run tests to verify they pass**

```bash
cd contracts && forge test -vv --match-test "test_CreateGroup"
```

Expected: All 4 tests pass

**Step 5: Commit**

```bash
git add contracts/src/WitnessRegistry.sol contracts/test/WitnessRegistry.t.sol
git commit -m "feat: implement group creation with tests"
```

---

## Task 5: Write Tests and Implement Group Joining

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`
- Modify: `contracts/src/WitnessRegistry.sol`

**Step 1: Add failing tests for joining groups**

Add to `contracts/test/WitnessRegistry.t.sol`:

```solidity
    // ============================================
    // GROUP JOINING TESTS
    // ============================================

    function test_JoinGroup_Success() public {
        // Alice creates group
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        // Bob joins
        vm.prank(bob);
        registry.register();
        vm.prank(bob);
        registry.joinGroup(TEST_GROUP_ID);

        assertTrue(registry.groupMembers(TEST_GROUP_ID, bob));
    }

    function test_JoinGroup_EmitsEvent() public {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        vm.prank(bob);
        registry.register();

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit WitnessRegistry.GroupJoined(TEST_GROUP_ID, bob, uint64(block.timestamp));
        registry.joinGroup(TEST_GROUP_ID);
    }

    function test_JoinGroup_RevertIfNotRegistered() public {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.NotRegistered.selector);
        registry.joinGroup(TEST_GROUP_ID);
    }

    function test_JoinGroup_RevertIfGroupDoesNotExist() public {
        vm.prank(bob);
        registry.register();

        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.GroupDoesNotExist.selector);
        registry.joinGroup(TEST_GROUP_ID);
    }

    function test_JoinGroup_RevertIfAlreadyMember() public {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        // Alice tries to join again (already member as creator)
        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.AlreadyMember.selector);
        registry.joinGroup(TEST_GROUP_ID);
    }
```

**Step 2: Run tests to verify they fail**

```bash
cd contracts && forge test -vv --match-test "test_JoinGroup"
```

Expected: Tests fail

**Step 3: Implement joinGroup function**

Add to `contracts/src/WitnessRegistry.sol` (after createGroup):

```solidity
    /**
     * @notice Join an existing group
     * @param groupId The group to join
     * @dev Caller must be registered and group must exist
     */
    function joinGroup(bytes32 groupId) external {
        if (!registered[msg.sender]) revert NotRegistered();
        if (groups[groupId].createdAt == 0) revert GroupDoesNotExist();
        if (groupMembers[groupId][msg.sender]) revert AlreadyMember();

        groupMembers[groupId][msg.sender] = true;
        _groupMemberList[groupId].push(msg.sender);

        emit GroupJoined(groupId, msg.sender, uint64(block.timestamp));
    }

    /**
     * @notice Get the number of members in a group
     * @param groupId The group to query
     * @return The number of members
     */
    function getGroupMemberCount(bytes32 groupId) external view returns (uint256) {
        return _groupMemberList[groupId].length;
    }
```

**Step 4: Run tests to verify they pass**

```bash
cd contracts && forge test -vv --match-test "test_JoinGroup"
```

Expected: All 5 tests pass

**Step 5: Commit**

```bash
git add contracts/src/WitnessRegistry.sol contracts/test/WitnessRegistry.t.sol
git commit -m "feat: implement group joining with tests"
```

---

## Task 6: Write Tests and Implement Content Commitment

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`
- Modify: `contracts/src/WitnessRegistry.sol`

**Step 1: Add failing tests for content commitment**

Add to `contracts/test/WitnessRegistry.t.sol`:

```solidity
    // ============================================
    // CONTENT COMMITMENT TESTS
    // ============================================

    bytes32 public constant TEST_CONTENT_ID = keccak256("test-content-id");
    bytes32 public constant TEST_MERKLE_ROOT = keccak256("merkle-root-data");
    string public constant TEST_MANIFEST_CID = "QmTestManifestCID123456789";

    function _setupGroupWithMembers() internal {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID);

        vm.prank(bob);
        registry.register();
        vm.prank(bob);
        registry.joinGroup(TEST_GROUP_ID);
    }

    function test_CommitContent_Success() public {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(alice);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);

        (bytes32 merkleRoot, string memory manifestCID, address uploader, uint64 timestamp) =
            registry.content(TEST_CONTENT_ID);

        assertEq(merkleRoot, TEST_MERKLE_ROOT);
        assertEq(manifestCID, TEST_MANIFEST_CID);
        assertEq(uploader, alice);
        assertGt(timestamp, 0);
    }

    function test_CommitContent_EmitsEvent() public {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit WitnessRegistry.ContentCommitted(
            TEST_CONTENT_ID, alice, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, uint64(block.timestamp)
        );
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);
    }

    function test_CommitContent_RevertIfNotRegistered() public {
        _setupGroupWithMembers();

        address carol = makeAddr("carol");
        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(carol);
        vm.expectRevert(WitnessRegistry.NotRegistered.selector);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);
    }

    function test_CommitContent_RevertIfNotMember() public {
        _setupGroupWithMembers();

        address carol = makeAddr("carol");
        vm.prank(carol);
        registry.register();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(carol);
        vm.expectRevert(WitnessRegistry.NotMember.selector);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);
    }

    function test_CommitContent_RevertIfContentExists() public {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(alice);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);

        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.ContentAlreadyExists.selector);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);
    }

    function test_CommitContent_RevertIfEmptyManifest() public {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.EmptyManifestCID.selector);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, "", groupIds);
    }

    function test_CommitContent_RevertIfNoGroups() public {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](0);

        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.NoGroupsSpecified.selector);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);
    }

    function test_CommitContent_IndexesCorrectly() public {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(alice);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);

        // Check user content index
        bytes32[] memory aliceContent = registry.getUserContent(alice);
        assertEq(aliceContent.length, 1);
        assertEq(aliceContent[0], TEST_CONTENT_ID);

        // Check group content index
        bytes32[] memory groupContentList = registry.getGroupContent(TEST_GROUP_ID);
        assertEq(groupContentList.length, 1);
        assertEq(groupContentList[0], TEST_CONTENT_ID);
    }
```

**Step 2: Run tests to verify they fail**

```bash
cd contracts && forge test -vv --match-test "test_CommitContent"
```

Expected: Tests fail

**Step 3: Implement commitContent function**

Add to `contracts/src/WitnessRegistry.sol`:

```solidity
    // ============================================
    // CONTENT COMMITMENT
    // ============================================

    /**
     * @notice Commit content to the registry
     * @param contentId Unique identifier for the content
     * @param merkleRoot Merkle root of content chunks
     * @param manifestCID IPFS CID of the content manifest
     * @param groupIds Groups to share this content with
     * @dev Caller must be registered and member of all specified groups
     */
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

        // Verify caller is member of all groups
        for (uint256 i = 0; i < groupIds.length; i++) {
            if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
        }

        // Store content commitment
        content[contentId] = ContentCommitment({
            merkleRoot: merkleRoot,
            manifestCID: manifestCID,
            uploader: msg.sender,
            timestamp: uint64(block.timestamp)
        });

        // Index content under each group
        for (uint256 i = 0; i < groupIds.length; i++) {
            contentGroups[contentId].push(groupIds[i]);
            groupContent[groupIds[i]].push(contentId);
        }

        // Index under user
        userContent[msg.sender].push(contentId);

        emit ContentCommitted(contentId, msg.sender, merkleRoot, manifestCID, uint64(block.timestamp));
    }

    // ============================================
    // VIEW FUNCTIONS
    // ============================================

    /**
     * @notice Get all content IDs for a user
     * @param user The user address
     * @return Array of content IDs
     */
    function getUserContent(address user) external view returns (bytes32[] memory) {
        return userContent[user];
    }

    /**
     * @notice Get all content IDs for a group
     * @param groupId The group ID
     * @return Array of content IDs
     */
    function getGroupContent(bytes32 groupId) external view returns (bytes32[] memory) {
        return groupContent[groupId];
    }

    /**
     * @notice Get all groups a content is shared with
     * @param contentId The content ID
     * @return Array of group IDs
     */
    function getContentGroups(bytes32 contentId) external view returns (bytes32[] memory) {
        return contentGroups[contentId];
    }
```

**Step 4: Run tests to verify they pass**

```bash
cd contracts && forge test -vv --match-test "test_CommitContent"
```

Expected: All 8 tests pass

**Step 5: Run full test suite**

```bash
cd contracts && forge test -vv
```

Expected: All tests pass (approximately 17 tests)

**Step 6: Commit**

```bash
git add contracts/src/WitnessRegistry.sol contracts/test/WitnessRegistry.t.sol
git commit -m "feat: implement content commitment with tests"
```

---

## Task 7: Create Deployment Script

**Files:**
- Modify: `contracts/script/DeployWitnessRegistry.s.sol`
- Modify: `.env.example`

**Step 1: Write the deployment script**

Replace `contracts/script/DeployWitnessRegistry.s.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {WitnessRegistry} from "../src/WitnessRegistry.sol";

contract DeployWitnessRegistry is Script {
    function setUp() public {}

    function run() public returns (WitnessRegistry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        WitnessRegistry registry = new WitnessRegistry();

        console.log("WitnessRegistry deployed to:", address(registry));

        vm.stopBroadcast();

        return registry;
    }
}
```

**Step 2: Update .env.example with new variables**

Add to `.env.example`:

```bash
# Contract Deployment (Base Sepolia)
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
DEPLOYER_PRIVATE_KEY=your-deployer-private-key
BASESCAN_API_KEY=your-basescan-api-key

# Deployed Contract Address (fill after deployment)
VITE_WITNESS_REGISTRY_ADDRESS=
```

**Step 3: Test the deployment script locally (dry run)**

```bash
cd contracts && forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry --fork-url https://sepolia.base.org -vvvv
```

Expected: Script runs successfully in simulation mode

**Step 4: Commit**

```bash
git add contracts/script/DeployWitnessRegistry.s.sol .env.example
git commit -m "feat: add deployment script for WitnessRegistry"
```

---

## Task 8: Deploy to Base Sepolia

**Files:**
- Modify: `.env` (local only, not committed)
- Modify: `.env.example`

**Step 1: Set up deployer wallet**

You need a wallet with Base Sepolia ETH. Get testnet ETH from:
- https://www.coinbase.com/faucets/base-ethereum-goerli-faucet (Base Sepolia)
- https://faucet.quicknode.com/base/sepolia

Export the private key and add to `.env`:
```bash
DEPLOYER_PRIVATE_KEY=0x...your-private-key...
BASE_SEPOLIA_RPC_URL=https://sepolia.base.org
BASESCAN_API_KEY=...your-basescan-api-key...
```

**Step 2: Deploy with verification**

```bash
cd contracts && source ../.env && forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url $BASE_SEPOLIA_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

Expected output includes:
- Transaction hash
- Deployed contract address
- Verification status

**Step 3: Record the deployed address**

Copy the deployed contract address and add to `.env`:
```bash
VITE_WITNESS_REGISTRY_ADDRESS=0x...deployed-address...
```

**Step 4: Verify on Basescan**

Visit: `https://sepolia.basescan.org/address/YOUR_CONTRACT_ADDRESS`

Confirm:
- Contract is verified
- Source code is visible
- Read/Write functions accessible

**Step 5: Commit deployment artifacts**

```bash
git add contracts/broadcast/
git commit -m "chore: record WitnessRegistry deployment to Base Sepolia"
```

---

## Task 9: Create Contract ABI Export

**Files:**
- Create: `witness-pwa/src/lib/abi/WitnessRegistry.json`

**Step 1: Create ABI directory**

```bash
mkdir -p witness-pwa/src/lib/abi
```

**Step 2: Export ABI from Foundry**

```bash
cd contracts && forge inspect WitnessRegistry abi > ../witness-pwa/src/lib/abi/WitnessRegistry.json
```

**Step 3: Verify ABI is valid JSON**

```bash
cat witness-pwa/src/lib/abi/WitnessRegistry.json | head -20
```

Expected: Valid JSON array starting with `[`

**Step 4: Commit**

```bash
git add witness-pwa/src/lib/abi/
git commit -m "feat: export WitnessRegistry ABI for frontend"
```

---

## Task 10: Create Contract Service

**Files:**
- Create: `witness-pwa/src/lib/contract.js`

**Step 1: Write the contract service**

Create `witness-pwa/src/lib/contract.js`:

```javascript
/**
 * Contract interaction service for Witness Protocol
 * Uses the smart account client for gasless transactions
 */
import { getContract, encodeFunctionData } from 'viem';
import { getPublicClient, getSmartAccountClient } from './smartAccount.js';
import WitnessRegistryABI from './abi/WitnessRegistry.json';

// Contract address from environment
const REGISTRY_ADDRESS = import.meta.env.VITE_WITNESS_REGISTRY_ADDRESS;

if (!REGISTRY_ADDRESS) {
  console.warn('[contract] VITE_WITNESS_REGISTRY_ADDRESS not set');
}

/**
 * Get a read-only contract instance
 * @returns {object} Viem contract instance for reads
 */
export function getRegistryContract() {
  const publicClient = getPublicClient();

  return getContract({
    address: REGISTRY_ADDRESS,
    abi: WitnessRegistryABI,
    client: publicClient,
  });
}

// ============================================
// READ FUNCTIONS (No gas required)
// ============================================

/**
 * Check if an address is registered
 * @param {string} address - Address to check
 * @returns {Promise<boolean>}
 */
export async function isRegistered(address) {
  const contract = getRegistryContract();
  return contract.read.registered([address]);
}

/**
 * Get registration timestamp for an address
 * @param {string} address - Address to check
 * @returns {Promise<bigint>} Unix timestamp or 0
 */
export async function getRegisteredAt(address) {
  const contract = getRegistryContract();
  return contract.read.registeredAt([address]);
}

/**
 * Check if address is member of a group
 * @param {string} groupId - Group ID (bytes32 hex)
 * @param {string} address - Address to check
 * @returns {Promise<boolean>}
 */
export async function isGroupMember(groupId, address) {
  const contract = getRegistryContract();
  return contract.read.groupMembers([groupId, address]);
}

/**
 * Get group details
 * @param {string} groupId - Group ID (bytes32 hex)
 * @returns {Promise<{creator: string, createdAt: bigint, active: boolean}>}
 */
export async function getGroup(groupId) {
  const contract = getRegistryContract();
  const [creator, createdAt, active] = await contract.read.groups([groupId]);
  return { creator, createdAt, active };
}

/**
 * Get content commitment details
 * @param {string} contentId - Content ID (bytes32 hex)
 * @returns {Promise<{merkleRoot: string, manifestCID: string, uploader: string, timestamp: bigint}>}
 */
export async function getContent(contentId) {
  const contract = getRegistryContract();
  const [merkleRoot, manifestCID, uploader, timestamp] = await contract.read.content([contentId]);
  return { merkleRoot, manifestCID, uploader, timestamp };
}

/**
 * Get all content IDs for a user
 * @param {string} address - User address
 * @returns {Promise<string[]>} Array of content IDs
 */
export async function getUserContent(address) {
  const contract = getRegistryContract();
  return contract.read.getUserContent([address]);
}

/**
 * Get all content IDs for a group
 * @param {string} groupId - Group ID
 * @returns {Promise<string[]>} Array of content IDs
 */
export async function getGroupContent(groupId) {
  const contract = getRegistryContract();
  return contract.read.getGroupContent([groupId]);
}

// ============================================
// WRITE FUNCTIONS (Gasless via Smart Account)
// ============================================

/**
 * Register the current user on-chain
 * @returns {Promise<string>} Transaction hash
 */
export async function register() {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized. Call initializeSmartAccount first.');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'register',
      args: [],
    }),
  });

  console.log('[contract] Registration tx:', hash);
  return hash;
}

/**
 * Create a new group
 * @param {string} groupId - Group ID (keccak256 of group secret)
 * @returns {Promise<string>} Transaction hash
 */
export async function createGroup(groupId) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'createGroup',
      args: [groupId],
    }),
  });

  console.log('[contract] Create group tx:', hash);
  return hash;
}

/**
 * Join an existing group
 * @param {string} groupId - Group ID to join
 * @returns {Promise<string>} Transaction hash
 */
export async function joinGroup(groupId) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'joinGroup',
      args: [groupId],
    }),
  });

  console.log('[contract] Join group tx:', hash);
  return hash;
}

/**
 * Commit content to the registry
 * @param {string} contentId - Unique content identifier
 * @param {string} merkleRoot - Merkle root of content chunks
 * @param {string} manifestCID - IPFS CID of manifest
 * @param {string[]} groupIds - Groups to share with
 * @returns {Promise<string>} Transaction hash
 */
export async function commitContent(contentId, merkleRoot, manifestCID, groupIds) {
  const client = getSmartAccountClient();
  if (!client) {
    throw new Error('Smart account not initialized');
  }

  const hash = await client.sendTransaction({
    to: REGISTRY_ADDRESS,
    data: encodeFunctionData({
      abi: WitnessRegistryABI,
      functionName: 'commitContent',
      args: [contentId, merkleRoot, manifestCID, groupIds],
    }),
  });

  console.log('[contract] Commit content tx:', hash);
  return hash;
}

/**
 * Wait for a transaction to be confirmed
 * @param {string} hash - Transaction hash
 * @returns {Promise<object>} Transaction receipt
 */
export async function waitForTransaction(hash) {
  const publicClient = getPublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('[contract] Tx confirmed in block:', receipt.blockNumber);
  return receipt;
}
```

**Step 2: Verify the file compiles (no syntax errors)**

```bash
cd witness-pwa && npm run build 2>&1 | head -30
```

Expected: No import/syntax errors related to contract.js

**Step 3: Commit**

```bash
git add witness-pwa/src/lib/contract.js
git commit -m "feat: add contract service for WitnessRegistry interactions"
```

---

## Task 11: Add Registration UI Component

**Files:**
- Create: `witness-pwa/src/components/RegistrationStatus.js`
- Modify: `witness-pwa/src/app.js` (or main app file)

**Step 1: Create the RegistrationStatus component**

Create `witness-pwa/src/components/RegistrationStatus.js`:

```javascript
/**
 * Registration status component
 * Shows whether user is registered on-chain and allows registration
 */
import { isRegistered, getRegisteredAt, register, waitForTransaction } from '../lib/contract.js';

/**
 * Create and mount the registration status component
 * @param {HTMLElement} container - Container element
 * @param {string} smartAccountAddress - User's smart account address
 * @returns {object} Component API
 */
export function createRegistrationStatus(container, smartAccountAddress) {
  let state = {
    isRegistered: false,
    registeredAt: null,
    isLoading: true,
    isRegistering: false,
    txHash: null,
    error: null,
  };

  function render() {
    container.innerHTML = `
      <div class="registration-status">
        <h3>On-Chain Registration</h3>

        ${state.isLoading ? `
          <p class="loading">Checking registration status...</p>
        ` : state.error ? `
          <p class="error">${state.error}</p>
          <button id="retry-check">Retry</button>
        ` : state.isRegistered ? `
          <div class="registered">
            <p class="status success">Registered</p>
            <p class="timestamp">Since: ${new Date(Number(state.registeredAt) * 1000).toLocaleString()}</p>
            ${state.txHash ? `
              <p class="tx-link">
                <a href="https://sepolia.basescan.org/tx/${state.txHash}" target="_blank" rel="noopener">
                  View Transaction
                </a>
              </p>
            ` : ''}
          </div>
        ` : `
          <div class="not-registered">
            <p class="status pending">Not registered</p>
            <p class="info">Register on-chain to use Witness Protocol features.</p>
            <button id="register-btn" ${state.isRegistering ? 'disabled' : ''}>
              ${state.isRegistering ? 'Registering...' : 'Register (Gasless)'}
            </button>
          </div>
        `}
      </div>
    `;

    // Attach event listeners
    const registerBtn = container.querySelector('#register-btn');
    if (registerBtn) {
      registerBtn.addEventListener('click', handleRegister);
    }

    const retryBtn = container.querySelector('#retry-check');
    if (retryBtn) {
      retryBtn.addEventListener('click', checkStatus);
    }
  }

  async function checkStatus() {
    state.isLoading = true;
    state.error = null;
    render();

    try {
      const registered = await isRegistered(smartAccountAddress);
      state.isRegistered = registered;

      if (registered) {
        const timestamp = await getRegisteredAt(smartAccountAddress);
        state.registeredAt = timestamp;
      }
    } catch (err) {
      console.error('[RegistrationStatus] Error checking status:', err);
      state.error = 'Failed to check registration status';
    }

    state.isLoading = false;
    render();
  }

  async function handleRegister() {
    state.isRegistering = true;
    state.error = null;
    render();

    try {
      const hash = await register();
      state.txHash = hash;
      render();

      // Wait for confirmation
      await waitForTransaction(hash);

      // Re-check status
      state.isRegistered = true;
      const timestamp = await getRegisteredAt(smartAccountAddress);
      state.registeredAt = timestamp;
    } catch (err) {
      console.error('[RegistrationStatus] Registration failed:', err);
      state.error = err.message || 'Registration failed';
    }

    state.isRegistering = false;
    render();
  }

  // Initial render and status check
  render();
  checkStatus();

  return {
    refresh: checkStatus,
    getState: () => ({ ...state }),
  };
}
```

**Step 2: Add CSS styles**

Add to your main CSS file or create `witness-pwa/src/styles/registration.css`:

```css
.registration-status {
  padding: 1rem;
  border: 1px solid #333;
  border-radius: 8px;
  margin: 1rem 0;
}

.registration-status h3 {
  margin-top: 0;
  margin-bottom: 0.5rem;
}

.registration-status .loading {
  color: #888;
}

.registration-status .status {
  font-weight: bold;
  font-size: 1.1rem;
}

.registration-status .status.success {
  color: #4caf50;
}

.registration-status .status.pending {
  color: #ff9800;
}

.registration-status .error {
  color: #f44336;
}

.registration-status .timestamp {
  font-size: 0.9rem;
  color: #888;
}

.registration-status .tx-link a {
  color: #2196f3;
}

.registration-status .info {
  font-size: 0.9rem;
  color: #888;
  margin-bottom: 1rem;
}

.registration-status button {
  background: #2196f3;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 4px;
  font-size: 1rem;
  cursor: pointer;
}

.registration-status button:disabled {
  background: #666;
  cursor: not-allowed;
}

.registration-status button:hover:not(:disabled) {
  background: #1976d2;
}
```

**Step 3: Commit**

```bash
git add witness-pwa/src/components/RegistrationStatus.js witness-pwa/src/styles/
git commit -m "feat: add RegistrationStatus UI component"
```

---

## Task 12: Integration Testing

**Files:**
- Manual testing steps

**Step 1: Start the development server**

```bash
cd witness-pwa && npm run dev
```

**Step 2: Test the full registration flow**

1. Open http://localhost:5173
2. Log in with Privy (email)
3. Verify smart account address is displayed
4. Verify "Not registered" status appears
5. Click "Register (Gasless)"
6. Verify transaction submits without gas prompt
7. Wait for confirmation
8. Verify "Registered" status appears with timestamp
9. Click "View Transaction" link
10. Verify transaction is visible on Basescan

**Step 3: Test idempotency**

1. Refresh the page
2. Verify "Registered" status persists
3. Registration button should not appear

**Step 4: Verify on Basescan**

1. Navigate to: `https://sepolia.basescan.org/address/YOUR_REGISTRY_ADDRESS`
2. Click "Read Contract"
3. Query `registered` with your smart account address
4. Verify returns `true`

**Step 5: Commit any fixes**

If any issues were found and fixed:
```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

---

## Acceptance Criteria Checklist

After completing all tasks, verify:

- [ ] Contract deployed to Base Sepolia
- [ ] Contract verified on Basescan (source visible)
- [ ] User can tap "Register" and transaction submits
- [ ] Transaction is gasless (user pays nothing)
- [ ] Registration status updates after tx confirms
- [ ] Can view transaction on Basescan
- [ ] All Foundry tests pass (`forge test`)
- [ ] Contract address recorded in `.env`

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                          USER INTERFACE                              │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │              RegistrationStatus Component                      │  │
│  │  • Shows registration state                                    │  │
│  │  • "Register (Gasless)" button                                 │  │
│  │  • Transaction link to Basescan                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    contract.js Service                         │  │
│  │  • isRegistered() - read                                       │  │
│  │  • register() - write via smart account                        │  │
│  │  • Uses WitnessRegistry ABI                                    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                              ▼                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │               smartAccount.js (existing)                       │  │
│  │  • getSmartAccountClient() - for writes                        │  │
│  │  • getPublicClient() - for reads                               │  │
│  │  • Pimlico paymaster integration                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
└──────────────────────────────┼───────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BASE SEPOLIA BLOCKCHAIN                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    WitnessRegistry.sol                         │  │
│  │  • register()                                                  │  │
│  │  • createGroup(bytes32)                                        │  │
│  │  • joinGroup(bytes32)                                          │  │
│  │  • commitContent(bytes32, bytes32, string, bytes32[])          │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │                    Pimlico Paymaster                           │  │
│  │  • Sponsors gas for user operations                            │  │
│  │  • EntryPoint 0.7 compatible                                   │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Notes for Future Phases

Phase 2 creates the foundation for:
- **Phase 3**: Uses contract for group creation/joining via `createGroup()` and `joinGroup()`
- **Phase 4**: Uses `commitContent()` for uploading encrypted content
- **Phase 7**: Will extend contract with Semaphore integration for anonymous attestations

The contract is designed to be **minimal and extensible** - heavy data lives on IPFS, only commitments on-chain.
