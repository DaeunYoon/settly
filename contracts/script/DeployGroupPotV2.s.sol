// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GroupPot} from "../src/GroupPot.sol";

contract DeployGroupPotV2 is Script {
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address constant FX_ORACLE = 0x545BD434404CA7F8F6aD86d86d8e3a2297b14616;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        vm.startBroadcast(deployerKey);

        // 1. Deploy new GroupPot
        GroupPot groupPot = new GroupPot(USDC, EURC, FX_ORACLE);
        console.log("GroupPot V2 deployed at:", address(groupPot));

        // 2. Set deployer as yield admin
        groupPot.setYieldAdmin(deployer);
        console.log("Yield admin set to:", deployer);

        vm.stopBroadcast();
    }
}
