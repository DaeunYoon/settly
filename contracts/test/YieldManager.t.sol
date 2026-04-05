// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GroupPot} from "../src/GroupPot.sol";
import {FXOracle} from "../src/FXOracle.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {YieldManager} from "../src/yield/YieldManager.sol";
import {MockYieldVault} from "../src/yield/MockYieldVault.sol";
import {YieldStrategy} from "../src/yield/YieldStrategy.sol";

contract YieldManagerTest is Test {
    GroupPot pot;
    FXOracle oracle;
    MockERC20 usdc;
    MockERC20 eurc;
    YieldManager yieldMgr;
    MockYieldVault sUSDS;
    MockYieldVault sUSDe;
    YieldStrategy strategy;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address admin = makeAddr("admin");

    uint256 constant RATE = 920000;
    string constant INVITE_CODE = "yield123";

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC");
        eurc = new MockERC20("EURC", "EURC");
        oracle = new FXOracle(RATE);
        pot = new GroupPot(address(usdc), address(eurc), address(oracle));

        // Deploy yield infrastructure
        sUSDS = new MockYieldVault(address(usdc), "sUSDS Vault", "sUSDS", 375);
        sUSDe = new MockYieldVault(address(usdc), "sUSDe Vault", "sUSDe", 750);
        address weth = makeAddr("weth"); // placeholder for tests
        strategy = new YieldStrategy(address(usdc), address(sUSDS), address(sUSDe), weth);

        vm.prank(admin);
        yieldMgr = new YieldManager(address(pot), address(usdc), address(eurc), address(oracle));

        // Set yield admin on GroupPot
        pot.setYieldAdmin(admin);

        // Fund users
        usdc.mint(alice, 10000e6);
        usdc.mint(bob, 10000e6);
        usdc.mint(carol, 10000e6);

        // Approve pot
        vm.prank(alice);
        usdc.approve(address(pot), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(pot), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(pot), type(uint256).max);
    }

    // ─── Helpers ────────────────────────────────────────────────

    function _createGroupWith3Members() internal returns (uint256) {
        vm.prank(alice);
        uint256 gid = pot.createGroup("Yield Test", 1000e6, address(usdc), bytes32(0));

        bytes32 hash = keccak256(abi.encodePacked(INVITE_CODE));
        vm.prank(alice);
        pot.updateInviteCode(gid, hash);
        vm.prank(bob);
        pot.joinGroup(gid, INVITE_CODE);
        vm.prank(carol);
        pot.joinGroup(gid, INVITE_CODE);
        return gid;
    }

    function _createGroupWith1Member() internal returns (uint256) {
        vm.prank(alice);
        return pot.createGroup("Solo Yield", 500e6, address(usdc), bytes32(0));
    }

    // ─── Tests: Propose + Vote ──────────────────────────────────

    function test_proposeEnableYield_singleMember() public {
        uint256 gid = _createGroupWith1Member();

        // Deposit into pot
        vm.prank(alice);
        pot.deposit(gid, 100e6, address(usdc));

        // Single member — propose auto-passes
        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Conservative);

        (uint8 s, uint8 phase,, ) = yieldMgr.getYieldInfo(gid);
        assertEq(phase, 2, "Should be EnableApproved for single member"); // Phase.EnableApproved = 2
        assertEq(s, 0, "Strategy should be Conservative");
    }

    function test_proposeEnableYield_multiMember_needsVotes() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.deposit(gid, 300e6, address(usdc));

        // Propose — alice auto-votes yes (1/2 needed)
        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Balanced);

        (, uint8 phase1,, ) = yieldMgr.getYieldInfo(gid);
        assertEq(phase1, 1, "Should be EnableVoting"); // Phase.EnableVoting = 1

        // Bob votes yes — now 2/2 needed → passes
        vm.prank(bob);
        yieldMgr.voteEnableYield(gid, true);

        (, uint8 phase2,, ) = yieldMgr.getYieldInfo(gid);
        assertEq(phase2, 2, "Should be EnableApproved after majority"); // Phase.EnableApproved = 2
    }

    function test_rejectProposal_allowsReproposal() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.deposit(gid, 300e6, address(usdc));

        // Alice proposes Conservative
        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Conservative);

        // Bob and Carol reject
        vm.prank(bob);
        yieldMgr.voteEnableYield(gid, false);
        vm.prank(carol);
        yieldMgr.voteEnableYield(gid, false);

        // Proposal should be reset
        {
            (, uint8 phase2,, ) = yieldMgr.getYieldInfo(gid);
            assertEq(phase2, 0, "Should be Idle after rejection"); // Phase.Idle = 0
        }

        // Bob can now propose a different strategy
        vm.prank(bob);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Aggressive);

        {
            (uint8 s2, uint8 phase3,, ) = yieldMgr.getYieldInfo(gid);
            assertEq(phase3, 1, "New vote should be EnableVoting"); // Phase.EnableVoting = 1
            assertEq(s2, 2, "Strategy should be Aggressive");
        }
    }

    function test_cannotVoteTwice() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Conservative);

        // Alice already voted (auto-vote on propose) — should revert
        vm.prank(alice);
        vm.expectRevert("Already voted");
        yieldMgr.voteEnableYield(gid, true);
    }

    function test_canReproposeWhenNothingBridged() public {
        uint256 gid = _createGroupWith1Member();

        vm.prank(alice);
        pot.deposit(gid, 100e6, address(usdc));

        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Conservative);

        // No funds bridged yet — re-proposing with different strategy should succeed
        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Balanced);

        (uint8 s,,,) = yieldMgr.getYieldInfo(gid);
        assertEq(s, 1, "Strategy should be Balanced after re-proposal");
    }

    function test_cannotProposeWhenFundsBridged() public {
        uint256 gid = _createGroupWith1Member();

        vm.prank(alice);
        pot.deposit(gid, 100e6, address(usdc));

        vm.prank(alice);
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Conservative);

        // Admin bridges funds — now re-proposal should revert
        vm.prank(admin);
        pot.bridgeToYield(gid, admin, 100e6);
        vm.prank(admin);
        yieldMgr.recordBridged(gid, 100e6);

        vm.prank(alice);
        vm.expectRevert("Yield already enabled");
        yieldMgr.proposeEnableYield(gid, YieldManager.Strategy.Balanced);
    }

    // ─── Tests: Bridge ──────────────────────────────────────────

    function test_bridgeToYield() public {
        uint256 gid = _createGroupWith1Member();

        vm.prank(alice);
        pot.deposit(gid, 500e6, address(usdc));

        (uint256 balBefore,,) = pot.getPotInfo(gid);
        assertEq(balBefore, 500e6);

        // Bridge 200 USDC to admin (pocket EOA)
        vm.prank(admin);
        pot.bridgeToYield(gid, admin, 200e6);

        (uint256 balAfter,,) = pot.getPotInfo(gid);
        assertEq(balAfter, 300e6, "Pot should have 300 after bridge out");
        assertEq(usdc.balanceOf(admin), 200e6, "Admin should have received 200");
    }

    function test_returnFromYield() public {
        uint256 gid = _createGroupWith1Member();

        vm.prank(alice);
        pot.deposit(gid, 500e6, address(usdc));

        // Bridge out
        vm.prank(admin);
        pot.bridgeToYield(gid, admin, 500e6);

        // Simulate yield: admin now has 520 USDC (500 + 20 yield)
        usdc.mint(admin, 20e6);
        assertEq(usdc.balanceOf(admin), 520e6);

        // Return with yield
        vm.prank(admin);
        usdc.approve(address(pot), 520e6);
        vm.prank(admin);
        pot.returnFromYield(gid, 520e6, address(usdc));

        (uint256 balAfter,,) = pot.getPotInfo(gid);
        assertEq(balAfter, 520e6, "Pot should have 520 (original + yield)");
    }

    function test_onlyYieldAdminCanBridge() public {
        uint256 gid = _createGroupWith1Member();

        vm.prank(alice);
        pot.deposit(gid, 500e6, address(usdc));

        // Non-admin should revert
        vm.prank(alice);
        vm.expectRevert("Not yield admin");
        pot.bridgeToYield(gid, alice, 100e6);
    }

    // ─── Tests: MockYieldVault ──────────────────────────────────

    function test_vaultDepositAndRedeem() public {
        usdc.mint(alice, 1000e6);
        // Mint extra USDC to vault to cover yield payouts
        usdc.mint(address(sUSDS), 100e6);

        vm.prank(alice);
        usdc.approve(address(sUSDS), 1000e6);
        vm.prank(alice);
        uint256 shares = sUSDS.deposit(1000e6, alice);
        assertEq(shares, 1000e6, "1:1 shares at initial rate");

        // Advance yield by 1 year (3.75% APY)
        sUSDS.advanceYield(365.25 days);

        uint256 value = sUSDS.convertToAssets(shares);
        assertApproxEqRel(value, 1037.5e6, 0.01e18, "Should be ~1037.5 after 1 year at 3.75%");

        // Redeem
        vm.prank(alice);
        uint256 redeemed = sUSDS.redeem(shares, alice);
        assertApproxEqRel(redeemed, 1037.5e6, 0.01e18, "Should redeem ~1037.5");
    }

    function test_vaultYieldAccrual_30days() public {
        usdc.mint(alice, 1000e6);

        vm.prank(alice);
        usdc.approve(address(sUSDe), 1000e6);
        vm.prank(alice);
        uint256 shares = sUSDe.deposit(1000e6, alice);

        // 30 days at 7.5% APY
        sUSDe.advanceYield(30 days);

        uint256 value = sUSDe.convertToAssets(shares);
        // Expected: 1000 * (1 + 0.075 * 30/365.25) ≈ 1006.16
        assertGt(value, 1006e6, "Should have earned yield");
        assertLt(value, 1007e6, "Should not exceed expected");
    }

    // ─── Tests: YieldStrategy ───────────────────────────────────

    function test_strategyConservative() public {
        usdc.mint(address(this), 1000e6);
        usdc.approve(address(strategy), 1000e6);
        usdc.mint(address(sUSDS), 100e6); // extra for yield payouts

        strategy.deposit(1000e6, YieldStrategy.Strategy.Conservative, 1);

        (uint256 deposited, uint256 currentValue,) = strategy.getPositionValue(1);
        assertEq(deposited, 1000e6);
        assertEq(currentValue, 1000e6, "Should be 1:1 before yield");

        // Advance yield directly on vaults (test contract is vault admin)
        sUSDS.advanceYield(365.25 days);

        (, currentValue,) = strategy.getPositionValue(1);
        assertApproxEqRel(currentValue, 1037.5e6, 0.01e18, "~3.75% yield after 1 year");
    }

    function test_strategyBalanced() public {
        usdc.mint(address(this), 1000e6);
        usdc.approve(address(strategy), 1000e6);
        usdc.mint(address(sUSDS), 100e6);
        usdc.mint(address(sUSDe), 100e6);

        strategy.deposit(1000e6, YieldStrategy.Strategy.Balanced, 2);

        // Advance 1 year directly on vaults
        sUSDS.advanceYield(365.25 days);
        sUSDe.advanceYield(365.25 days);

        (, uint256 currentValue,) = strategy.getPositionValue(2);
        // 50% at 3.75% + 50% at 7.5% = avg 5.625%
        assertApproxEqRel(currentValue, 1056.25e6, 0.02e18, "~5.625% blended yield");
    }

    function test_withdrawReturnsUSDC() public {
        usdc.mint(address(this), 1000e6);
        usdc.approve(address(strategy), 1000e6);
        usdc.mint(address(sUSDS), 100e6);

        strategy.deposit(1000e6, YieldStrategy.Strategy.Conservative, 3);
        sUSDS.advanceYield(30 days);

        uint256 balBefore = usdc.balanceOf(address(this));
        strategy.withdraw(3);
        uint256 balAfter = usdc.balanceOf(address(this));

        assertGt(balAfter - balBefore, 1000e6, "Should get back more than deposited");
    }
}
