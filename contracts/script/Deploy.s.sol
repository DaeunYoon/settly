// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FXOracle} from "../src/FXOracle.sol";
import {GroupPot} from "../src/GroupPot.sol";
import {SplitSettler} from "../src/SplitSettler.sol";

contract Deploy is Script {
    // Arc testnet token addresses
    address constant USDC = 0x3600000000000000000000000000000000000000;
    address constant EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    // Initial FX rate: 1 USDC = 0.92 EURC (scaled by 1e6)
    uint256 constant INITIAL_RATE = 920000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // 1. Deploy FXOracle
        FXOracle oracle = new FXOracle(INITIAL_RATE);
        console.log("FXOracle deployed at:", address(oracle));

        // 2. Deploy GroupPot
        GroupPot groupPot = new GroupPot(USDC, EURC, address(oracle));
        console.log("GroupPot deployed at:", address(groupPot));

        // 3. Deploy SplitSettler
        SplitSettler settler = new SplitSettler(USDC, EURC, address(groupPot));
        console.log("SplitSettler deployed at:", address(settler));

        vm.stopBroadcast();
    }
}
