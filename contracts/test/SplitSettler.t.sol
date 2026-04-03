// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SplitSettler} from "../src/SplitSettler.sol";
import {GroupPot} from "../src/GroupPot.sol";
import {FXOracle} from "../src/FXOracle.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract SplitSettlerTest is Test {
    SplitSettler settler;
    GroupPot pot;
    FXOracle oracle;
    MockERC20 usdc;
    MockERC20 eurc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 gid;

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC");
        eurc = new MockERC20("EURC", "EURC");
        oracle = new FXOracle(920000);
        pot = new GroupPot(address(usdc), address(eurc), address(oracle));
        settler = new SplitSettler(address(usdc), address(eurc), address(pot));

        // Create group with 3 members
        bytes32 inviteHash = keccak256(abi.encodePacked("secret"));
        vm.prank(alice);
        gid = pot.createGroup("Trip", 0, address(usdc), inviteHash);
        vm.prank(bob);
        pot.joinGroup(gid, "secret");
        vm.prank(carol);
        pot.joinGroup(gid, "secret");

        // Fund users with USDC and approve settler
        usdc.mint(alice, 10000e6);
        usdc.mint(bob, 10000e6);
        usdc.mint(carol, 10000e6);

        vm.prank(alice);
        usdc.approve(address(settler), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(settler), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(settler), type(uint256).max);
    }

    // ─── Add Expense ─────────────────────────────────────────────

    function test_AddExpense() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        // Bob pays 60 USDC, split 3 ways
        vm.prank(bob);
        settler.addExpense(gid, 60e6, "Taxi", split);

        assertEq(settler.getExpenseCount(gid), 1);

        (address paidBy, uint256 amount, string memory desc, , ) = settler.getExpense(gid, 0);
        assertEq(paidBy, bob);
        assertEq(amount, 60e6);
        assertEq(desc, "Taxi");
    }

    function test_AddExpense_BalancesCorrect() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        // Bob pays 60, split 3 ways: each owes 20
        // Bob net: +60 - 20 = +40
        // Alice net: -20
        // Carol net: -20
        vm.prank(bob);
        settler.addExpense(gid, 60e6, "Taxi", split);

        (address[] memory members, int256[] memory bals) = settler.getBalances(gid);
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == bob) assertEq(bals[i], int256(40e6));
            else assertEq(bals[i], int256(-20e6));
        }
    }

    function test_AddExpense_RoundingDust() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        // 100 split 3 ways: perPerson = 33, dust = 1
        // alice gets extra -1 dust (first in splitAmong)
        vm.prank(bob);
        settler.addExpense(gid, 100, "Small", split);

        (address[] memory members, int256[] memory bals) = settler.getBalances(gid);

        // Verify zero-sum
        int256 total;
        for (uint256 i = 0; i < bals.length; i++) {
            total += bals[i];
        }
        assertEq(total, 0, "Balances must be zero-sum");
    }

    function test_AddExpense_RevertNonMember() public {
        address outsider = makeAddr("outsider");
        address[] memory split = new address[](1);
        split[0] = alice;

        vm.prank(outsider);
        vm.expectRevert("Not a member");
        settler.addExpense(gid, 60e6, "Taxi", split);
    }

    function test_AddExpense_RevertDuplicateAddress() public {
        address[] memory split = new address[](2);
        split[0] = alice;
        split[1] = alice;

        vm.prank(bob);
        vm.expectRevert("Duplicate address");
        settler.addExpense(gid, 60e6, "Taxi", split);
    }

    function test_AddExpense_RevertEmptySplit() public {
        address[] memory split = new address[](0);

        vm.prank(bob);
        vm.expectRevert("No split targets");
        settler.addExpense(gid, 60e6, "Taxi", split);
    }

    function test_AddExpense_RevertSplitTargetNotMember() public {
        address outsider = makeAddr("outsider");
        address[] memory split = new address[](1);
        split[0] = outsider;

        vm.prank(bob);
        vm.expectRevert("Split target not a member");
        settler.addExpense(gid, 60e6, "Taxi", split);
    }

    function test_AddExpense_RevertAmountTooSmall() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        vm.prank(bob);
        vm.expectRevert("Amount too small to split");
        settler.addExpense(gid, 2, "Tiny", split);
    }

    // ─── Calculate Settlements ───────────────────────────────────

    function test_CalculateSettlements() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        vm.prank(bob);
        settler.addExpense(gid, 60e6, "Taxi", split);

        SplitSettler.Settlement[] memory settlements = settler.calculateSettlements(gid);
        assertGt(settlements.length, 0);

        // Total settlement amount should equal total debt (40e6)
        uint256 totalTransfer;
        for (uint256 i = 0; i < settlements.length; i++) {
            totalTransfer += settlements[i].amount;
            assertEq(settlements[i].to, bob); // Bob is the only creditor
        }
        assertEq(totalTransfer, 40e6);
    }

    function test_CalculateSettlements_NoExpenses() public view {
        SplitSettler.Settlement[] memory settlements = settler.calculateSettlements(gid);
        assertEq(settlements.length, 0);
    }

    // ─── Settle Up ───────────────────────────────────────────────

    function test_SettleUp_FullFlow() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        vm.prank(bob);
        settler.addExpense(gid, 60e6, "Taxi", split);

        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 carolBefore = usdc.balanceOf(carol);

        vm.prank(alice);
        settler.settleUp(gid);

        // Alice paid 20 to Bob, Carol paid 20 to Bob
        assertEq(usdc.balanceOf(alice), aliceBefore - 20e6);
        assertEq(usdc.balanceOf(carol), carolBefore - 20e6);
        assertEq(usdc.balanceOf(bob), bobBefore + 40e6);
    }

    function test_SettleUp_ClearsState() public {
        address[] memory split = new address[](3);
        split[0] = alice;
        split[1] = bob;
        split[2] = carol;

        vm.prank(bob);
        settler.addExpense(gid, 60e6, "Taxi", split);

        vm.prank(alice);
        settler.settleUp(gid);

        // Expenses cleared
        assertEq(settler.getExpenseCount(gid), 0);

        // Balances cleared
        (, int256[] memory bals) = settler.getBalances(gid);
        for (uint256 i = 0; i < bals.length; i++) {
            assertEq(bals[i], 0);
        }
    }

    function test_SettleUp_RevertNothingToSettle() public {
        vm.prank(alice);
        vm.expectRevert("Nothing to settle");
        settler.settleUp(gid);
    }

    function test_SettleUp_RevertNonMember() public {
        address outsider = makeAddr("outsider");

        vm.prank(outsider);
        vm.expectRevert("Not a member");
        settler.settleUp(gid);
    }

    // ─── Multiple Expenses ───────────────────────────────────────

    function test_MultipleExpenses_NetBalances() public {
        address[] memory split3 = new address[](3);
        split3[0] = alice;
        split3[1] = bob;
        split3[2] = carol;

        // Bob pays 60, split 3 ways
        vm.prank(bob);
        settler.addExpense(gid, 60e6, "Taxi", split3);

        // Alice pays 30, split 3 ways
        vm.prank(alice);
        settler.addExpense(gid, 30e6, "Coffee", split3);

        // Bob: +60 -20 -10 = +30
        // Alice: -20 +30 -10 = 0
        // Carol: -20 -10 = -30
        (address[] memory members, int256[] memory bals) = settler.getBalances(gid);
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == bob) assertEq(bals[i], int256(30e6));
            else if (members[i] == alice) assertEq(bals[i], int256(0));
            else if (members[i] == carol) assertEq(bals[i], int256(-30e6));
        }

        // Settle: Carol pays 30 to Bob
        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 carolBefore = usdc.balanceOf(carol);

        vm.prank(alice);
        settler.settleUp(gid);

        assertEq(usdc.balanceOf(bob), bobBefore + 30e6);
        assertEq(usdc.balanceOf(carol), carolBefore - 30e6);
    }
}
