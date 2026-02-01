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
}
