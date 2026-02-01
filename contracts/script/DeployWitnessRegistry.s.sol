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
