// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {WitnessRegistry} from "../src/WitnessRegistry.sol";

contract DeployWitnessRegistry is Script {
    // Base Sepolia Semaphore V4 address - https://docs.semaphore.pse.dev/deployed-contracts
    address constant SEMAPHORE_ADDRESS = 0x8A1fd199516489B0Fb7153EB5f075cDAC83c693D;

    function setUp() public {}

    function run() public returns (WitnessRegistry) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        WitnessRegistry registry = new WitnessRegistry(SEMAPHORE_ADDRESS);

        console.log("WitnessRegistry deployed to:", address(registry));

        vm.stopBroadcast();

        return registry;
    }
}
