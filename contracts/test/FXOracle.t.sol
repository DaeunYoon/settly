// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FXOracle} from "../src/FXOracle.sol";

contract FXOracleTest is Test {
    FXOracle oracle;
    address owner = address(this);
    address alice = makeAddr("alice");

    function setUp() public {
        oracle = new FXOracle(920000); // 1 USDC = 0.92 EURC
    }

    function test_InitialState() public view {
        assertEq(oracle.usdcToEurcRate(), 920000);
        assertEq(oracle.owner(), owner);
        assertGt(oracle.rateLastUpdated(), 0);
    }

    function test_GetRate() public view {
        (uint256 rate, uint256 updatedAt) = oracle.getRate();
        assertEq(rate, 920000);
        assertEq(updatedAt, block.timestamp);
    }

    function test_UpdateRate() public {
        oracle.updateRate(950000);
        assertEq(oracle.usdcToEurcRate(), 950000);
    }

    function test_UpdateRate_EmitsEvent() public {
        vm.expectEmit(false, false, false, true);
        emit FXOracle.RateUpdated(950000, block.timestamp);
        oracle.updateRate(950000);
    }

    function test_UpdateRate_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        oracle.updateRate(950000);
    }

    function test_UpdateRate_RevertZero() public {
        vm.expectRevert("Invalid rate");
        oracle.updateRate(0);
    }

    function test_Constructor_RevertZeroRate() public {
        vm.expectRevert("Invalid rate");
        new FXOracle(0);
    }

    function test_TransferOwnership() public {
        oracle.transferOwnership(alice);
        assertEq(oracle.owner(), alice);

        // Old owner can no longer update
        vm.expectRevert("Not authorized");
        oracle.updateRate(950000);

        // New owner can
        vm.prank(alice);
        oracle.updateRate(950000);
        assertEq(oracle.usdcToEurcRate(), 950000);
    }

    function test_TransferOwnership_RevertZeroAddress() public {
        vm.expectRevert("Invalid owner");
        oracle.transferOwnership(address(0));
    }

    function test_TransferOwnership_RevertNonOwner() public {
        vm.prank(alice);
        vm.expectRevert("Not authorized");
        oracle.transferOwnership(alice);
    }
}
