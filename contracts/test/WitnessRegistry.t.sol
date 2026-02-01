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
}
