// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {YieldManager} from "../src/yield/YieldManager.sol";

contract DeployYieldManager is Script {
    address constant GROUP_POT = 0xadF07b7D9645fFB46237ceFB2a4BbF970D93F158;
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address constant FX_ORACLE = 0x545BD434404CA7F8F6aD86d86d8e3a2297b14616;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        YieldManager ym = new YieldManager(GROUP_POT, USDC, EURC, FX_ORACLE);
        console.log("YieldManager deployed at:", address(ym));

        vm.stopBroadcast();
    }
}
