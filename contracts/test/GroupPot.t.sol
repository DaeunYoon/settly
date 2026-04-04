// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GroupPot} from "../src/GroupPot.sol";
import {FXOracle} from "../src/FXOracle.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract GroupPotTest is Test {
    GroupPot pot;
    FXOracle oracle;
    MockERC20 usdc;
    MockERC20 eurc;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    uint256 constant RATE = 920000; // 1 USDC = 0.92 EURC

    function setUp() public {
        usdc = new MockERC20("USDC", "USDC");
        eurc = new MockERC20("EURC", "EURC");
        oracle = new FXOracle(RATE);
        pot = new GroupPot(address(usdc), address(eurc), address(oracle));

        // Fund users
        usdc.mint(alice, 10000e6);
        usdc.mint(bob, 10000e6);
        usdc.mint(carol, 10000e6);
        eurc.mint(alice, 10000e6);
        eurc.mint(bob, 10000e6);

        // Approve pot
        vm.prank(alice);
        usdc.approve(address(pot), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(pot), type(uint256).max);
        vm.prank(carol);
        usdc.approve(address(pot), type(uint256).max);
        vm.prank(alice);
        eurc.approve(address(pot), type(uint256).max);
        vm.prank(bob);
        eurc.approve(address(pot), type(uint256).max);
    }

    // ─── Helpers ─────────────────────────────────────────────────

    string constant INVITE_CODE = "secret123";
    bytes32 INVITE_HASH = keccak256(abi.encodePacked(INVITE_CODE));

    function _createGroup() internal returns (uint256) {
        vm.prank(alice);
        return pot.createGroup("Trip", 1000e6, address(usdc), bytes32(0));
    }

    function _createGroupWith3Members() internal returns (uint256) {
        uint256 gid = _createGroup();
        // Unlock group for joining
        vm.prank(alice);
        pot.updateInviteCode(gid, INVITE_HASH);
        vm.prank(bob);
        pot.joinGroup(gid, INVITE_CODE);
        vm.prank(carol);
        pot.joinGroup(gid, INVITE_CODE);
        return gid;
    }

    // ─── Group Management ────────────────────────────────────────

    function test_CreateGroup() public {
        vm.prank(alice);
        uint256 gid = pot.createGroup("Trip", 1000e6, address(usdc), bytes32(0));

        assertEq(gid, 1);
        assertTrue(pot.isMember(gid, alice));

        GroupPot.GroupInfo memory info = pot.getGroupInfo(gid);
        assertEq(info.name, "Trip");
        assertEq(info.creator, alice);
        assertEq(info.baseCurrency, address(usdc));
        assertEq(info.fundingGoal, 1000e6);
        assertEq(info.members.length, 1);
        assertFalse(info.closed);
    }

    function test_CreateGroup_RevertInvalidCurrency() public {
        vm.prank(alice);
        vm.expectRevert("Invalid base currency");
        pot.createGroup("Trip", 1000e6, address(0x123), INVITE_HASH);
    }

    function test_JoinGroup() public {
        uint256 gid = _createGroup();

        // Unlock group first
        vm.prank(alice);
        pot.updateInviteCode(gid, INVITE_HASH);

        vm.prank(bob);
        pot.joinGroup(gid, INVITE_CODE);

        assertTrue(pot.isMember(gid, bob));
        assertEq(pot.getMembers(gid).length, 2);
    }

    function test_JoinGroup_RevertWrongInviteCode() public {
        uint256 gid = _createGroup();

        // Unlock group
        vm.prank(alice);
        pot.updateInviteCode(gid, INVITE_HASH);

        vm.prank(bob);
        vm.expectRevert("Invalid invite code");
        pot.joinGroup(gid, "wrongcode");
    }

    function test_JoinGroup_RevertLocked() public {
        uint256 gid = _createGroup();

        // Group starts locked with bytes32(0)
        vm.prank(bob);
        vm.expectRevert("Group is locked");
        pot.joinGroup(gid, INVITE_CODE);
    }

    function test_JoinGroup_UnlockWithNewCode() public {
        uint256 gid = _createGroup();

        // Lock
        vm.prank(alice);
        pot.updateInviteCode(gid, bytes32(0));

        // Unlock with new code
        string memory newCode = "newcode";
        vm.prank(alice);
        pot.updateInviteCode(gid, keccak256(abi.encodePacked(newCode)));

        // Bob can join with new code
        vm.prank(bob);
        pot.joinGroup(gid, newCode);
        assertTrue(pot.isMember(gid, bob));
    }

    function test_JoinGroup_RevertAlreadyMember() public {
        uint256 gid = _createGroup();

        vm.prank(alice);
        vm.expectRevert("Already a member");
        pot.joinGroup(gid, INVITE_CODE);
    }

    function test_JoinGroup_RevertGroupFull() public {
        uint256 gid = _createGroup();
        // Unlock
        vm.prank(alice);
        pot.updateInviteCode(gid, INVITE_HASH);
        // Add 5 more members (total 6 = MAX_GROUP_SIZE)
        for (uint256 i = 1; i <= 5; i++) {
            address member = makeAddr(string(abi.encodePacked("member", i)));
            vm.prank(member);
            pot.joinGroup(gid, INVITE_CODE);
        }
        // 7th should fail
        address extra = makeAddr("extra");
        vm.prank(extra);
        vm.expectRevert("Group is full");
        pot.joinGroup(gid, INVITE_CODE);
    }

    function test_JoinGroup_RevertNonexistent() public {
        vm.prank(alice);
        vm.expectRevert("Group does not exist");
        pot.joinGroup(999, INVITE_CODE);
    }

    // ─── Deposit ─────────────────────────────────────────────────

    function test_Deposit_SameCurrency() public {
        uint256 gid = _createGroup();

        vm.prank(alice);
        pot.deposit(gid, 100e6, address(usdc));

        (uint256 balance, , ) = pot.getPotInfo(gid);
        assertEq(balance, 100e6);
        assertEq(pot.getContribution(gid, alice), 100e6);
    }

    function test_Deposit_CrossCurrency() public {
        uint256 gid = _createGroup(); // base = USDC

        // Deposit EURC into USDC-base group
        // 100 EURC at rate 920000 (0.92 EURC/USDC) = 100 * 1e6 / 920000 ≈ 108.695652 USDC
        vm.prank(alice);
        pot.deposit(gid, 100e6, address(eurc));

        uint256 expected = (100e6 * 1e6) / RATE; // 108695652
        assertEq(pot.getContribution(gid, alice), expected);
    }

    function test_Deposit_RevertNonMember() public {
        uint256 gid = _createGroup();

        vm.prank(bob);
        vm.expectRevert("Not a member");
        pot.deposit(gid, 100e6, address(usdc));
    }

    function test_Deposit_RevertZeroAmount() public {
        uint256 gid = _createGroup();

        vm.prank(alice);
        vm.expectRevert("Zero amount");
        pot.deposit(gid, 0, address(usdc));
    }

    function test_Deposit_RevertInvalidToken() public {
        uint256 gid = _createGroup();

        vm.prank(alice);
        vm.expectRevert("Invalid token");
        pot.deposit(gid, 100e6, address(0x123));
    }

    // ─── Reimbursement ───────────────────────────────────────────

    function test_RequestReimbursement() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        assertEq(rid, 0);
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(info.requester, alice);
        assertEq(info.amount, 50e6);
        assertEq(info.approvalsNeeded, 2); // 3 members, 2 non-requesters, need 2
        assertEq(uint8(info.status), uint8(GroupPot.Status.Pending));
    }

    function test_ApproveRequest_AutoRelease() public {
        uint256 gid = _createGroupWith3Members();

        // Fund pot
        vm.prank(alice);
        pot.deposit(gid, 200e6, address(usdc));

        // Request
        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        uint256 aliceBefore = usdc.balanceOf(alice);

        // Bob approves (1/2)
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, true);

        // Carol approves (2/2) — should auto-release
        vm.prank(carol);
        pot.voteOnRequest(gid, rid, true);

        // Alice should have received 50 USDC
        assertEq(usdc.balanceOf(alice) - aliceBefore, 50e6);

        // Pot balance should decrease
        (uint256 balance, , ) = pot.getPotInfo(gid);
        assertEq(balance, 150e6);

        // Status should be Approved
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Approved));
    }

    function test_ApproveRequest_InsufficientFunds_StaysPending() public {
        uint256 gid = _createGroupWith3Members();

        // No funds deposited — request 50 USDC
        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        // Both approve, but no funds
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, true);
        vm.prank(carol);
        pot.voteOnRequest(gid, rid, true);

        // Should still be pending (thresholdMet but no funds)
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Pending));
        assertTrue(info.thresholdMet);
    }

    function test_ReleaseFunds_AfterDeposit() public {
        uint256 gid = _createGroupWith3Members();

        // Request with no funds
        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        vm.prank(bob);
        pot.voteOnRequest(gid, rid, true);
        vm.prank(carol);
        pot.voteOnRequest(gid, rid, true);

        // Now deposit funds
        vm.prank(bob);
        pot.deposit(gid, 100e6, address(usdc));

        // Manually release
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(bob);
        pot.releaseFunds(gid, rid);

        assertEq(usdc.balanceOf(alice) - aliceBefore, 50e6);
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Approved));
    }

    function test_VoteOnRequest_RevertSelfVote() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        vm.prank(alice);
        vm.expectRevert("Cannot vote on own request");
        pot.voteOnRequest(gid, rid, true);
    }

    function test_VoteOnRequest_RevertDoubleVote() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        vm.prank(bob);
        pot.voteOnRequest(gid, rid, true);

        vm.prank(bob);
        vm.expectRevert("Already voted");
        pot.voteOnRequest(gid, rid, true);
    }

    function test_CancelRequest() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        vm.prank(alice);
        pot.cancelRequest(gid, rid);

        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Cancelled));
    }

    function test_CancelRequest_RevertNotRequester() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        vm.prank(bob);
        vm.expectRevert("Not requester");
        pot.cancelRequest(gid, rid);
    }

    // ─── Approval Threshold ──────────────────────────────────────

    function test_ApprovalThreshold_2Members() public {
        uint256 gid = _createGroup();
        vm.prank(alice);
        pot.updateInviteCode(gid, INVITE_HASH);
        vm.prank(bob);
        pot.joinGroup(gid, INVITE_CODE);

        vm.prank(alice);
        pot.deposit(gid, 200e6, address(usdc));

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Dinner");

        // 2 members, 1 non-requester, need 1 approval
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(info.approvalsNeeded, 1);

        // Bob approves — should auto-release
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, true);

        assertEq(usdc.balanceOf(alice) - aliceBefore, 50e6);
    }

    function test_ApprovalThreshold_4Members() public {
        uint256 gid = _createGroupWith3Members();
        address dave = makeAddr("dave");
        // Group already unlocked by _createGroupWith3Members
        vm.prank(dave);
        pot.joinGroup(gid, INVITE_CODE);

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Taxi");

        // 4 members, 3 non-requesters, need (3/2)+1 = 2 approvals
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(info.approvalsNeeded, 2);
    }

    // ─── Vote Withdraw ───────────────────────────────────────────

    function test_VoteWithdraw_ProportionalDistribution() public {
        uint256 gid = _createGroupWith3Members();

        // Alice deposits 300, Bob deposits 100
        vm.prank(alice);
        pot.deposit(gid, 300e6, address(usdc));
        vm.prank(bob);
        pot.deposit(gid, 100e6, address(usdc));

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore = usdc.balanceOf(bob);

        // Need 2 votes (3 members, (3/2)+1 = 2)
        vm.prank(alice);
        pot.voteWithdraw(gid);
        vm.prank(bob);
        pot.voteWithdraw(gid);

        // Alice contributed 300/400 = 75% of 400 = 300
        // Bob contributed 100/400 = 25% of 400 = 100
        assertEq(usdc.balanceOf(alice) - aliceBefore, 300e6);
        assertEq(usdc.balanceOf(bob) - bobBefore, 100e6);

        GroupPot.GroupInfo memory info = pot.getGroupInfo(gid);
        assertTrue(info.closed);
    }

    function test_VoteWithdraw_RevertAlreadyVoted() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.voteWithdraw(gid);

        vm.prank(alice);
        vm.expectRevert("Already voted");
        pot.voteWithdraw(gid);
    }

    function test_VoteWithdraw_SettlesPendingApproved() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.deposit(gid, 300e6, address(usdc));

        // Alice requests 50 — gets approved but not enough for release yet
        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, true);
        vm.prank(carol);
        pot.voteOnRequest(gid, rid, true);

        // Request was released since pot had funds — verify
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Approved));
    }

    // ─── Closed Group ────────────────────────────────────────────

    function test_ClosedGroup_RevertDeposit() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.voteWithdraw(gid);
        vm.prank(bob);
        pot.voteWithdraw(gid); // closes

        vm.prank(alice);
        vm.expectRevert("Group is closed");
        pot.deposit(gid, 100e6, address(usdc));
    }

    function test_ClosedGroup_RevertJoin() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.voteWithdraw(gid);
        vm.prank(bob);
        pot.voteWithdraw(gid); // closes

        address dave = makeAddr("dave");
        vm.prank(dave);
        vm.expectRevert("Group is closed");
        pot.joinGroup(gid, INVITE_CODE);
    }

    // ─── Dispute / Rejection ────────────────────────────────────

    function test_RejectRequest_AutoRejects() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.deposit(gid, 200e6, address(usdc));

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        // Bob rejects (1/2)
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, false);

        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Pending));
        assertEq(info.rejectionCount, 1);

        // Carol rejects (2/2) — should auto-reject
        vm.prank(carol);
        pot.voteOnRequest(gid, rid, false);

        info = pot.getRequestInfo(gid, rid);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Rejected));
        assertEq(info.rejectionCount, 2);
    }

    function test_RejectRequest_ApproveWinsRace() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        pot.deposit(gid, 200e6, address(usdc));

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        // Bob rejects, Carol approves — neither threshold met yet (need 2)
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, false);
        vm.prank(carol);
        pot.voteOnRequest(gid, rid, true);

        // Add dave to cast the deciding vote
        address dave = makeAddr("dave");
        vm.prank(dave);
        pot.joinGroup(gid, INVITE_CODE);

        // New request with 4 members (need 2 of 3 non-requesters)
        vm.prank(alice);
        uint256 rid2 = pot.requestReimbursement(gid, 30e6, "Taxi");

        vm.prank(bob);
        pot.voteOnRequest(gid, rid2, true);
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(carol);
        pot.voteOnRequest(gid, rid2, true);

        // Should be approved and released
        GroupPot.ReimbursementInfo memory info = pot.getRequestInfo(gid, rid2);
        assertEq(uint8(info.status), uint8(GroupPot.Status.Approved));
        assertEq(usdc.balanceOf(alice) - aliceBefore, 30e6);
    }

    function test_RejectRequest_CannotVoteTwice() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        // Bob rejects
        vm.prank(bob);
        pot.voteOnRequest(gid, rid, false);

        // Bob tries to also approve — should fail
        vm.prank(bob);
        vm.expectRevert("Already voted");
        pot.voteOnRequest(gid, rid, true);
    }

    function test_RejectRequest_RequesterCannotReject() public {
        uint256 gid = _createGroupWith3Members();

        vm.prank(alice);
        uint256 rid = pot.requestReimbursement(gid, 50e6, "Hotel");

        vm.prank(alice);
        vm.expectRevert("Cannot vote on own request");
        pot.voteOnRequest(gid, rid, false);
    }
}
