// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {YieldManager} from "../src/yield/YieldManager.sol";
import {YieldStrategy} from "../src/yield/YieldStrategy.sol";
import {MockYieldVault} from "../src/yield/MockYieldVault.sol";

/// @notice Redeploy YieldManager (Arc) — run with Arc RPC
contract RedeployYieldManager is Script {
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

/// @notice Redeploy MockYieldVaults + YieldStrategy on Base Sepolia
contract RedeployYieldStrategy is Script {
    // Base Sepolia USDC (Circle)
    address constant USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;
    // Base Sepolia WETH
    address constant WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        // 1. Deploy MockYieldVaults (msUSDS + msUSDe)
        MockYieldVault msUSDS = new MockYieldVault(USDC, "Mock sUSDS", "msUSDS", 375); // 3.75% APY
        console.log("msUSDS vault deployed at:", address(msUSDS));

        MockYieldVault msUSDe = new MockYieldVault(USDC, "Mock sUSDe", "msUSDe", 850); // 8.5% APY
        console.log("msUSDe vault deployed at:", address(msUSDe));

        // 2. Deploy YieldStrategy pointing at the new vaults
        YieldStrategy ys = new YieldStrategy(USDC, address(msUSDS), address(msUSDe), WETH);
        console.log("YieldStrategy deployed at:", address(ys));

        vm.stopBroadcast();
    }
}
