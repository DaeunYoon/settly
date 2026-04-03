// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {JointAccount} from "../src/JointAccount.sol";

contract JointAccountTest is Test {
    JointAccount public ja;
    address partnerA = makeAddr("partnerA");
    address partnerB = makeAddr("partnerB");

    function setUp() public {
        ja = new JointAccount();
        vm.deal(partnerA, 10 ether);
        vm.deal(partnerB, 10 ether);
    }

    function test_CreateAndJoin() public {
        bytes32 code = keccak256("invite-123");

        vm.prank(partnerA);
        uint256 id = ja.createAccount(code);

        vm.prank(partnerB);
        ja.joinAccount(code);

        JointAccount.Account memory acct = ja.getAccount(id);
        assertEq(acct.partnerA, partnerA);
        assertEq(acct.partnerB, partnerB);
        assertTrue(acct.active);
    }

    function test_DepositAndWithdraw() public {
        bytes32 code = keccak256("invite-456");

        vm.prank(partnerA);
        uint256 id = ja.createAccount(code);

        vm.prank(partnerB);
        ja.joinAccount(code);

        vm.prank(partnerA);
        ja.deposit{value: 1 ether}(id);
        assertEq(address(ja).balance, 1 ether);

        vm.prank(partnerB);
        ja.withdraw(id, 0.5 ether, payable(partnerB));
        assertEq(address(ja).balance, 0.5 ether);
    }

    function test_RevertInvalidInvite() public {
        bytes32 code = keccak256("bad-code");
        vm.prank(partnerB);
        vm.expectRevert(JointAccount.InvalidInvite.selector);
        ja.joinAccount(code);
    }

    function test_RevertNotPartner() public {
        bytes32 code = keccak256("invite-789");
        vm.prank(partnerA);
        uint256 id = ja.createAccount(code);

        vm.prank(partnerB);
        ja.joinAccount(code);

        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(JointAccount.NotPartner.selector);
        ja.deposit{value: 0.1 ether}(id);
    }
}
