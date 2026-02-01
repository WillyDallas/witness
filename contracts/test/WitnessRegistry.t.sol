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
