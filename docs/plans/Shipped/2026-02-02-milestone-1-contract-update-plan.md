# Milestone 1: Contract Update Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `updateSession()` function to WitnessRegistry.sol for incremental streaming video commits with per-chunk on-chain anchoring.

**Architecture:** New `Session` struct stores mutable state (merkle root, manifest CID, chunk count) keyed by sessionId. Unlike `commitContent()` which reverts on duplicate, `updateSession()` allows the session creator to overwrite state with each chunk. Group associations stored on-chain enable attestation eligibility via existing `isContentInGroup()` pattern.

**Tech Stack:** Solidity 0.8.24, Foundry (forge test, forge script), Base Sepolia, Semaphore V4

---

## Contract Design

### New Storage

```solidity
struct Session {
    address creator;
    bytes32 merkleRoot;
    string manifestCid;
    uint256 chunkCount;
    uint64 createdAt;
    uint64 updatedAt;
}

mapping(bytes32 => Session) public sessions;
mapping(bytes32 => bytes32[]) public sessionGroups;  // sessionId => groupIds
```

### Function Signature

```solidity
function updateSession(
    bytes32 sessionId,
    bytes32 merkleRoot,
    string calldata manifestCid,
    uint256 chunkCount,
    bytes32[] calldata groupIds
) external;
```

### Event

```solidity
event SessionUpdated(
    bytes32 indexed sessionId,
    address indexed uploader,
    bytes32 merkleRoot,
    string manifestCid,
    uint256 chunkCount,
    bytes32[] groupIds,
    uint256 timestamp
);
```

### Behavior

1. **First call** (session doesn't exist): Creates session, stores creator as `msg.sender`, sets all fields
2. **Subsequent calls**: Only creator can update; overwrites merkleRoot, manifestCid, chunkCount, updatedAt
3. **Group validation**: Caller must be member of all specified groups (same as `commitContent`)
4. **Attestation integration**: Add `isSessionInGroup()` view function for attestation eligibility checks

---

## Task 1: Add Session Struct and Storage

**Files:**
- Modify: `contracts/src/WitnessRegistry.sol:15-28` (STRUCTS section)
- Modify: `contracts/src/WitnessRegistry.sol:45-53` (STATE VARIABLES section)

**Step 1: Add Session struct after ContentCommitment struct**

In `contracts/src/WitnessRegistry.sol`, add after line 27 (after ContentCommitment struct):

```solidity
struct Session {
    address creator;
    bytes32 merkleRoot;
    string manifestCid;
    uint256 chunkCount;
    uint64 createdAt;
    uint64 updatedAt;
}
```

**Step 2: Add session storage mappings**

After line 52 (after `mapping(address => bytes32[]) public userContent;`), add:

```solidity
// Session management (streaming video)
mapping(bytes32 => Session) public sessions;
mapping(bytes32 => bytes32[]) public sessionGroups;
```

**Step 3: Verify compilation**

Run: `cd contracts && forge build`
Expected: Compiler output shows success, no errors

**Step 4: Commit**

```bash
git add contracts/src/WitnessRegistry.sol
git commit -m "feat(contract): add Session struct and storage mappings"
```

---

## Task 2: Add SessionUpdated Event and New Errors

**Files:**
- Modify: `contracts/src/WitnessRegistry.sol:59-78` (EVENTS section)
- Modify: `contracts/src/WitnessRegistry.sol:83-95` (ERRORS section)

**Step 1: Add SessionUpdated event**

After line 77 (after AttestationCreated event), add:

```solidity
event SessionUpdated(
    bytes32 indexed sessionId,
    address indexed uploader,
    bytes32 merkleRoot,
    string manifestCid,
    uint256 chunkCount,
    bytes32[] groupIds,
    uint256 timestamp
);
```

**Step 2: Add new error types**

After line 94 (after InvalidProof error), add:

```solidity
error NotSessionCreator();
error ZeroChunkCount();
```

**Step 3: Verify compilation**

Run: `cd contracts && forge build`
Expected: Compiler output shows success

**Step 4: Commit**

```bash
git add contracts/src/WitnessRegistry.sol
git commit -m "feat(contract): add SessionUpdated event and session errors"
```

---

## Task 3: Write Failing Test for Session Creation

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`

**Step 1: Add test constants and helper**

After line 184 (after TEST_MANIFEST_CID constant), add:

```solidity
// ============================================
// SESSION TESTS
// ============================================

bytes32 public constant TEST_SESSION_ID = keccak256("test-session-id");

function _setupForSession() internal {
    vm.prank(alice);
    registry.register();
    vm.prank(alice);
    registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);
}
```

**Step 2: Write test for session creation**

After the helper function, add:

```solidity
function test_UpdateSession_CreatesNewSession() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);

    (
        address creator,
        bytes32 merkleRoot,
        string memory manifestCid,
        uint256 chunkCount,
        uint64 createdAt,
        uint64 updatedAt
    ) = registry.sessions(TEST_SESSION_ID);

    assertEq(creator, alice);
    assertEq(merkleRoot, TEST_MERKLE_ROOT);
    assertEq(manifestCid, TEST_MANIFEST_CID);
    assertEq(chunkCount, 1);
    assertGt(createdAt, 0);
    assertEq(createdAt, updatedAt);
}
```

**Step 3: Run test to verify it fails**

Run: `cd contracts && forge test --match-test test_UpdateSession_CreatesNewSession -vvv`
Expected: FAIL with error about `updateSession` function not existing or `sessions` mapping not accessible

**Step 4: Commit failing test**

```bash
git add contracts/test/WitnessRegistry.t.sol
git commit -m "test(contract): add failing test for session creation"
```

---

## Task 4: Implement updateSession Function

**Files:**
- Modify: `contracts/src/WitnessRegistry.sol` (after CONTENT COMMITMENT section, before ATTESTATIONS section)

**Step 1: Add updateSession function**

After line 213 (after the `commitContent` function closing brace), add:

```solidity
// ============================================
// SESSION MANAGEMENT (Streaming Video)
// ============================================

/**
 * @notice Create or update a streaming session
 * @param sessionId Unique identifier for the session
 * @param merkleRoot Current merkle root of all chunks
 * @param manifestCid IPFS CID of the current manifest
 * @param chunkCount Number of chunks uploaded so far
 * @param groupIds Groups that can access this session
 */
function updateSession(
    bytes32 sessionId,
    bytes32 merkleRoot,
    string calldata manifestCid,
    uint256 chunkCount,
    bytes32[] calldata groupIds
) external {
    if (!registered[msg.sender]) revert NotRegistered();
    if (bytes(manifestCid).length == 0) revert EmptyManifestCID();
    if (groupIds.length == 0) revert NoGroupsSpecified();
    if (chunkCount == 0) revert ZeroChunkCount();

    // Validate caller is member of all groups
    for (uint256 i = 0; i < groupIds.length; i++) {
        if (!groupMembers[groupIds[i]][msg.sender]) revert NotMember();
    }

    Session storage session = sessions[sessionId];

    if (session.createdAt == 0) {
        // New session
        session.creator = msg.sender;
        session.createdAt = uint64(block.timestamp);

        // Store group associations (only on creation)
        for (uint256 i = 0; i < groupIds.length; i++) {
            sessionGroups[sessionId].push(groupIds[i]);
        }
    } else {
        // Existing session - only creator can update
        if (session.creator != msg.sender) revert NotSessionCreator();
    }

    // Update mutable fields
    session.merkleRoot = merkleRoot;
    session.manifestCid = manifestCid;
    session.chunkCount = chunkCount;
    session.updatedAt = uint64(block.timestamp);

    emit SessionUpdated(
        sessionId,
        msg.sender,
        merkleRoot,
        manifestCid,
        chunkCount,
        groupIds,
        block.timestamp
    );
}
```

**Step 2: Run test to verify it passes**

Run: `cd contracts && forge test --match-test test_UpdateSession_CreatesNewSession -vvv`
Expected: PASS

**Step 3: Commit**

```bash
git add contracts/src/WitnessRegistry.sol
git commit -m "feat(contract): implement updateSession function"
```

---

## Task 5: Test Session Updates with Incrementing Chunks

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`

**Step 1: Write test for multiple updates**

After the previous test, add:

```solidity
function test_UpdateSession_UpdatesExistingSession() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    // First update (chunk 1)
    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, keccak256("root1"), "QmManifest1", 1, groupIds);

    // Second update (chunk 2)
    bytes32 root2 = keccak256("root2");
    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, root2, "QmManifest2", 2, groupIds);

    // Third update (chunk 3)
    bytes32 root3 = keccak256("root3");
    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, root3, "QmManifest3", 3, groupIds);

    // Verify final state
    (
        address creator,
        bytes32 merkleRoot,
        string memory manifestCid,
        uint256 chunkCount,
        uint64 createdAt,
        uint64 updatedAt
    ) = registry.sessions(TEST_SESSION_ID);

    assertEq(creator, alice);
    assertEq(merkleRoot, root3, "Final merkle root should be root3");
    assertEq(manifestCid, "QmManifest3", "Final manifest should be QmManifest3");
    assertEq(chunkCount, 3, "Chunk count should be 3");
    assertGt(createdAt, 0);
    assertGe(updatedAt, createdAt);
}
```

**Step 2: Run test**

Run: `cd contracts && forge test --match-test test_UpdateSession_UpdatesExistingSession -vvv`
Expected: PASS

**Step 3: Commit**

```bash
git add contracts/test/WitnessRegistry.t.sol
git commit -m "test(contract): verify session updates with incrementing chunks"
```

---

## Task 6: Test Event Emission

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`

**Step 1: Write event emission test**

Add after previous test:

```solidity
function test_UpdateSession_EmitsEvent() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    vm.expectEmit(true, true, false, true);
    emit WitnessRegistry.SessionUpdated(
        TEST_SESSION_ID,
        alice,
        TEST_MERKLE_ROOT,
        TEST_MANIFEST_CID,
        1,
        groupIds,
        block.timestamp
    );
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);
}
```

**Step 2: Run test**

Run: `cd contracts && forge test --match-test test_UpdateSession_EmitsEvent -vvv`
Expected: PASS

**Step 3: Commit**

```bash
git add contracts/test/WitnessRegistry.t.sol
git commit -m "test(contract): verify SessionUpdated event emission"
```

---

## Task 7: Test Access Control - Only Creator Can Update

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`

**Step 1: Write access control test**

Add after previous test:

```solidity
function test_UpdateSession_RevertIfNotCreator() public {
    _setupForSession();

    // Bob registers and joins the group
    vm.prank(bob);
    registry.register();
    vm.prank(bob);
    registry.joinGroup(TEST_GROUP_ID, BOB_COMMITMENT);

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    // Alice creates session
    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);

    // Bob tries to update Alice's session
    vm.prank(bob);
    vm.expectRevert(WitnessRegistry.NotSessionCreator.selector);
    registry.updateSession(TEST_SESSION_ID, keccak256("bob-root"), "QmBobManifest", 2, groupIds);
}
```

**Step 2: Run test**

Run: `cd contracts && forge test --match-test test_UpdateSession_RevertIfNotCreator -vvv`
Expected: PASS

**Step 3: Commit**

```bash
git add contracts/test/WitnessRegistry.t.sol
git commit -m "test(contract): verify only session creator can update"
```

---

## Task 8: Test Validation Edge Cases

**Files:**
- Modify: `contracts/test/WitnessRegistry.t.sol`

**Step 1: Write edge case tests**

Add after previous test:

```solidity
function test_UpdateSession_RevertIfNotRegistered() public {
    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    vm.expectRevert(WitnessRegistry.NotRegistered.selector);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);
}

function test_UpdateSession_RevertIfEmptyManifest() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    vm.expectRevert(WitnessRegistry.EmptyManifestCID.selector);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, "", 1, groupIds);
}

function test_UpdateSession_RevertIfNoGroups() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](0);

    vm.prank(alice);
    vm.expectRevert(WitnessRegistry.NoGroupsSpecified.selector);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);
}

function test_UpdateSession_RevertIfZeroChunkCount() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    vm.expectRevert(WitnessRegistry.ZeroChunkCount.selector);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 0, groupIds);
}

function test_UpdateSession_RevertIfNotMember() public {
    _setupForSession();

    // Create a different group that alice is not a member of
    vm.prank(bob);
    registry.register();
    bytes32 bobGroupId = keccak256("bob-group");
    vm.prank(bob);
    registry.createGroup(bobGroupId, BOB_COMMITMENT);

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = bobGroupId;

    vm.prank(alice);
    vm.expectRevert(WitnessRegistry.NotMember.selector);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);
}
```

**Step 2: Run all edge case tests**

Run: `cd contracts && forge test --match-test "test_UpdateSession_Revert" -vvv`
Expected: All 5 tests PASS

**Step 3: Commit**

```bash
git add contracts/test/WitnessRegistry.t.sol
git commit -m "test(contract): verify validation edge cases for updateSession"
```

---

## Task 9: Add isSessionInGroup View Function

**Files:**
- Modify: `contracts/src/WitnessRegistry.sol` (VIEW FUNCTIONS section)

**Step 1: Write failing test first**

Add to test file:

```solidity
function test_IsSessionInGroup_ReturnsTrue() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);

    assertTrue(registry.isSessionInGroup(TEST_SESSION_ID, TEST_GROUP_ID));
}

function test_IsSessionInGroup_ReturnsFalse() public {
    _setupForSession();

    bytes32[] memory groupIds = new bytes32[](1);
    groupIds[0] = TEST_GROUP_ID;

    vm.prank(alice);
    registry.updateSession(TEST_SESSION_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, 1, groupIds);

    bytes32 otherGroupId = keccak256("other-group");
    assertFalse(registry.isSessionInGroup(TEST_SESSION_ID, otherGroupId));
}
```

**Step 2: Run tests to verify they fail**

Run: `cd contracts && forge test --match-test "test_IsSessionInGroup" -vvv`
Expected: FAIL with function not found

**Step 3: Implement isSessionInGroup**

Add to VIEW FUNCTIONS section in WitnessRegistry.sol (after `getContentGroups` function):

```solidity
function getSessionGroups(bytes32 sessionId) external view returns (bytes32[] memory) {
    return sessionGroups[sessionId];
}

function isSessionInGroup(bytes32 sessionId, bytes32 groupId) external view returns (bool) {
    bytes32[] memory groups_ = sessionGroups[sessionId];
    for (uint256 i = 0; i < groups_.length; i++) {
        if (groups_[i] == groupId) {
            return true;
        }
    }
    return false;
}
```

**Step 4: Run tests to verify they pass**

Run: `cd contracts && forge test --match-test "test_IsSessionInGroup" -vvv`
Expected: PASS

**Step 5: Commit**

```bash
git add contracts/src/WitnessRegistry.sol contracts/test/WitnessRegistry.t.sol
git commit -m "feat(contract): add isSessionInGroup view function for attestation eligibility"
```

---

## Task 10: Run Full Test Suite

**Files:**
- None (verification only)

**Step 1: Run all contract tests**

Run: `cd contracts && forge test -vv`
Expected: All tests pass (existing tests + new session tests)

**Step 2: Check test coverage for new code**

Run: `cd contracts && forge coverage --match-contract WitnessRegistry`
Expected: High coverage on updateSession and isSessionInGroup

**Step 3: Commit any fixes if needed**

If all tests pass, no commit needed.

---

## Task 11: Deploy to Base Sepolia

**Files:**
- Modify: `contracts/script/DeployWitnessRegistry.s.sol` (if needed)

**Step 1: Verify deployment script still works**

The existing deployment script should work unchanged since it just deploys the contract.

**Step 2: Run dry-run deployment**

Run:
```bash
cd contracts && export $(grep -v '^#' ../.env | grep -v '^$' | xargs) && \
  forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url base-sepolia -vvvv
```
Expected: Simulation succeeds, shows contract deployment

**Step 3: Deploy with broadcast**

Run:
```bash
cd contracts && export $(grep -v '^#' ../.env | grep -v '^$' | xargs) && \
  forge script script/DeployWitnessRegistry.s.sol:DeployWitnessRegistry \
  --rpc-url base-sepolia --broadcast --verify -vvvv
```
Expected: Deployment succeeds, contract verified on Basescan

**Step 4: Record new contract address**

Note the deployed contract address from the output. Update `witness-pwa/src/lib/abi/WitnessRegistry.json` with new ABI and address.

**Step 5: Commit deployment artifacts**

```bash
git add contracts/broadcast/
git commit -m "deploy: WitnessRegistry with updateSession to Base Sepolia"
```

---

## Task 12: Update Frontend ABI

**Files:**
- Modify: `witness-pwa/src/lib/abi/WitnessRegistry.json`

**Step 1: Generate new ABI**

Run: `cd contracts && forge build --extra-output abi`

The ABI will be in `contracts/out/WitnessRegistry.sol/WitnessRegistry.json`

**Step 2: Copy ABI to frontend**

Extract the `abi` field from the forge output and update `witness-pwa/src/lib/abi/WitnessRegistry.json`

**Step 3: Update contract address**

Find the deployed address from Task 11 and update the address constant in the PWA.

Check for address references:
```bash
grep -r "0x" witness-pwa/src --include="*.ts" | grep -i witness
```

**Step 4: Verify frontend builds**

Run: `cd witness-pwa && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add witness-pwa/src/lib/abi/WitnessRegistry.json
git commit -m "chore: update WitnessRegistry ABI with updateSession"
```

---

## Task 13: Manual Verification on Base Sepolia

**Files:**
- None (manual verification)

**Step 1: Call updateSession 3 times via Basescan**

1. Go to Basescan contract page (verified contract)
2. Connect wallet
3. Call `updateSession` with:
   - sessionId: `0x0000000000000000000000000000000000000000000000000000000000000001`
   - merkleRoot: `0x1111111111111111111111111111111111111111111111111111111111111111`
   - manifestCid: `"QmTestChunk1"`
   - chunkCount: `1`
   - groupIds: array with one valid groupId you're a member of

4. Repeat with chunkCount 2 and 3, different merkleRoots

**Step 2: Verify on-chain state**

Read `sessions(sessionId)` - should show:
- Final merkleRoot matches last call
- Final manifestCid matches last call
- chunkCount = 3

**Step 3: Verify events**

Check Basescan events tab - should show 3 `SessionUpdated` events

**Step 4: Verify isSessionInGroup**

Call `isSessionInGroup(sessionId, groupId)` - should return `true`

---

## Success Criteria Checklist

- [ ] `updateSession()` function deployed to Base Sepolia
- [ ] Called `updateSession()` 3 times with incrementing chunk counts
- [ ] On-chain state: final merkle root and manifest CID match last call
- [ ] Events: `SessionUpdated` emitted for each call
- [ ] `isSessionInGroup()` returns true for session's groups
- [ ] All existing tests still pass
- [ ] Frontend ABI updated

---

## Notes for Implementation

### ERC-4337 Smart Account Consideration

The contract uses `msg.sender` which will be the Kernel smart account address when called via Pimlico paymaster. This is correct behavior - the smart account becomes the "creator" and can update the session. No changes needed.

### Relationship to commitContent

`updateSession()` is a **parallel** function to `commitContent()`:
- `commitContent()`: One-time commit, reverts on duplicate contentId
- `updateSession()`: Incremental updates, allows overwrites by creator

They use separate storage (`content` vs `sessions`) and are independent.

### Gas Optimization

For hackathon scope, the current implementation is acceptable. Future optimization could:
- Use a more efficient group membership check
- Consider batch updates if needed
