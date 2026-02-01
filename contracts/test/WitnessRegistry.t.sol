// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console} from "forge-std/Test.sol";
import {WitnessRegistry} from "../src/WitnessRegistry.sol";
import {MockSemaphore} from "./mocks/MockSemaphore.sol";
import "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";

contract WitnessRegistryTest is Test {
    WitnessRegistry public registry;
    MockSemaphore public mockSemaphore;

    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");

    // Test identity commitments (mock values)
    uint256 public constant ALICE_COMMITMENT = 12345678901234567890;
    uint256 public constant BOB_COMMITMENT = 98765432109876543210;

    function setUp() public {
        mockSemaphore = new MockSemaphore();
        registry = new WitnessRegistry(address(mockSemaphore));
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

    // ============================================
    // GROUP CREATION TESTS
    // ============================================

    bytes32 public constant TEST_GROUP_ID = keccak256("test-group-secret");

    function test_CreateGroup_Success() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        (address creator, uint64 createdAt, bool active) = registry.groups(TEST_GROUP_ID);
        assertEq(creator, alice);
        assertGt(createdAt, 0);
        assertTrue(active);
        assertTrue(registry.groupMembers(TEST_GROUP_ID, alice));

        // Verify Semaphore group was created
        assertGt(registry.semaphoreGroupId(TEST_GROUP_ID), 0);
    }

    function test_CreateGroup_EmitsEvent() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit WitnessRegistry.GroupCreated(TEST_GROUP_ID, alice, 1, uint64(block.timestamp));
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);
    }

    function test_CreateGroup_RevertIfNotRegistered() public {
        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.NotRegistered.selector);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);
    }

    function test_CreateGroup_RevertIfGroupExists() public {
        vm.prank(alice);
        registry.register();

        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        vm.prank(bob);
        registry.register();

        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.GroupAlreadyExists.selector);
        registry.createGroup(TEST_GROUP_ID, BOB_COMMITMENT);
    }

    // ============================================
    // GROUP JOINING TESTS
    // ============================================

    function test_JoinGroup_Success() public {
        // Alice creates group
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        // Bob joins
        vm.prank(bob);
        registry.register();
        vm.prank(bob);
        registry.joinGroup(TEST_GROUP_ID, BOB_COMMITMENT);

        assertTrue(registry.groupMembers(TEST_GROUP_ID, bob));
    }

    function test_JoinGroup_EmitsEvent() public {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        vm.prank(bob);
        registry.register();

        vm.prank(bob);
        vm.expectEmit(true, true, false, true);
        emit WitnessRegistry.GroupJoined(TEST_GROUP_ID, bob, BOB_COMMITMENT, uint64(block.timestamp));
        registry.joinGroup(TEST_GROUP_ID, BOB_COMMITMENT);
    }

    function test_JoinGroup_RevertIfNotRegistered() public {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.NotRegistered.selector);
        registry.joinGroup(TEST_GROUP_ID, BOB_COMMITMENT);
    }

    function test_JoinGroup_RevertIfGroupDoesNotExist() public {
        vm.prank(bob);
        registry.register();

        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.GroupDoesNotExist.selector);
        registry.joinGroup(TEST_GROUP_ID, BOB_COMMITMENT);
    }

    function test_JoinGroup_RevertIfAlreadyMember() public {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        // Alice tries to join again (already member as creator)
        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.AlreadyMember.selector);
        registry.joinGroup(TEST_GROUP_ID, ALICE_COMMITMENT);
    }

    // ============================================
    // CONTENT COMMITMENT TESTS
    // ============================================

    bytes32 public constant TEST_CONTENT_ID = keccak256("test-content-id");
    bytes32 public constant TEST_MERKLE_ROOT = keccak256("merkle-root-data");
    string public constant TEST_MANIFEST_CID = "QmTestManifestCID123456789";

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

    // ============================================
    // CONTENT COMMITMENT TESTS
    // ============================================

    function _setupGroupWithMembers() internal {
        vm.prank(alice);
        registry.register();
        vm.prank(alice);
        registry.createGroup(TEST_GROUP_ID, ALICE_COMMITMENT);

        vm.prank(bob);
        registry.register();
        vm.prank(bob);
        registry.joinGroup(TEST_GROUP_ID, BOB_COMMITMENT);
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

    // ============================================
    // ATTESTATION TESTS
    // ============================================

    function _setupContentForAttestation() internal {
        _setupGroupWithMembers();

        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;

        vm.prank(alice);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);
    }

    function _createMockProof(uint256 nullifier) internal pure returns (ISemaphore.SemaphoreProof memory) {
        uint256[8] memory points;
        return ISemaphore.SemaphoreProof({
            merkleTreeDepth: 20,
            merkleTreeRoot: 123456789,
            nullifier: nullifier,
            message: uint256(TEST_CONTENT_ID),
            scope: uint256(TEST_CONTENT_ID),
            points: points
        });
    }

    function test_AttestToContent_Success() public {
        _setupContentForAttestation();

        uint256 semGroupId = registry.semaphoreGroupId(TEST_GROUP_ID);
        assertGt(semGroupId, 0);

        ISemaphore.SemaphoreProof memory proof = _createMockProof(111111);

        vm.prank(bob);
        registry.attestToContent(TEST_CONTENT_ID, TEST_GROUP_ID, proof);

        assertEq(registry.getAttestationCount(TEST_CONTENT_ID), 1);
        assertTrue(registry.nullifierUsed(111111));
    }

    function test_AttestToContent_EmitsEvent() public {
        _setupContentForAttestation();

        ISemaphore.SemaphoreProof memory proof = _createMockProof(222222);

        vm.prank(alice);
        vm.expectEmit(true, true, false, true);
        emit WitnessRegistry.AttestationCreated(TEST_CONTENT_ID, TEST_GROUP_ID, 1, uint64(block.timestamp));
        registry.attestToContent(TEST_CONTENT_ID, TEST_GROUP_ID, proof);
    }

    function test_AttestToContent_MultipleAttestations() public {
        _setupContentForAttestation();

        ISemaphore.SemaphoreProof memory proof1 = _createMockProof(333333);
        ISemaphore.SemaphoreProof memory proof2 = _createMockProof(444444);

        vm.prank(alice);
        registry.attestToContent(TEST_CONTENT_ID, TEST_GROUP_ID, proof1);

        vm.prank(bob);
        registry.attestToContent(TEST_CONTENT_ID, TEST_GROUP_ID, proof2);

        assertEq(registry.getAttestationCount(TEST_CONTENT_ID), 2);
    }

    function test_AttestToContent_RevertIfContentNotInGroup() public {
        _setupGroupWithMembers();

        // Create a different group
        bytes32 otherGroupId = keccak256("other-group");
        vm.prank(alice);
        registry.createGroup(otherGroupId, ALICE_COMMITMENT);

        // Commit content to original group only
        bytes32[] memory groupIds = new bytes32[](1);
        groupIds[0] = TEST_GROUP_ID;
        vm.prank(alice);
        registry.commitContent(TEST_CONTENT_ID, TEST_MERKLE_ROOT, TEST_MANIFEST_CID, groupIds);

        // Try to attest through the other group
        ISemaphore.SemaphoreProof memory proof = _createMockProof(555555);

        vm.prank(alice);
        vm.expectRevert(WitnessRegistry.ContentNotInGroup.selector);
        registry.attestToContent(TEST_CONTENT_ID, otherGroupId, proof);
    }

    function test_AttestToContent_RevertIfNullifierUsed() public {
        _setupContentForAttestation();

        ISemaphore.SemaphoreProof memory proof = _createMockProof(666666);

        vm.prank(alice);
        registry.attestToContent(TEST_CONTENT_ID, TEST_GROUP_ID, proof);

        // Try to attest again with same nullifier
        vm.prank(bob);
        vm.expectRevert(WitnessRegistry.NullifierAlreadyUsed.selector);
        registry.attestToContent(TEST_CONTENT_ID, TEST_GROUP_ID, proof);
    }
}
