// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFXOracle} from "./interfaces/IFXOracle.sol";
import {IGroupPot} from "./interfaces/IGroupPot.sol";

contract GroupPot is IGroupPot, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Pending, Approved, Rejected, Cancelled }
    enum Vote { None, Approve, Reject }

    struct ReimbursementRequest {
        address requester;
        uint256 amount;
        string description;
        uint256 approvalCount;
        uint256 rejectionCount;
        uint256 approvalsNeeded;
        Status status;
        bool thresholdMet;
        uint256 timestamp;
    }

    struct Group {
        string name;
        address creator;
        address baseCurrency;
        uint256 fundingGoal;
        uint256 potBalance;
        uint256 nextRequestId;
        uint256 withdrawVoteCount;
        bool closed;
        bytes32 inviteCodeHash;
        address[] members;
    }

    // Return structs (no mappings)
    struct GroupInfo {
        string name;
        address creator;
        address baseCurrency;
        uint256 fundingGoal;
        uint256 potBalance;
        bool closed;
        address[] members;
    }

    struct ReimbursementInfo {
        address requester;
        uint256 amount;
        string description;
        uint256 approvalCount;
        uint256 rejectionCount;
        uint256 approvalsNeeded;
        Status status;
        bool thresholdMet;
        uint256 timestamp;
    }

    address public immutable usdc;
    address public immutable eurc;
    IFXOracle public immutable oracle;

    uint256 public constant MAX_GROUP_SIZE = 6;
    uint256 public nextGroupId;

    // groupId => Group
    mapping(uint256 => Group) private groups;
    // groupId => member => isMember
    mapping(uint256 => mapping(address => bool)) private memberOf;
    // groupId => member => contribution (in base currency)
    mapping(uint256 => mapping(address => uint256)) private contributions;
    // groupId => requestId => ReimbursementRequest
    mapping(uint256 => mapping(uint256 => ReimbursementRequest)) private requests;
    // groupId => requestId => voter => Vote
    mapping(uint256 => mapping(uint256 => mapping(address => Vote))) private votes;
    // groupId => member => hasVotedWithdraw
    mapping(uint256 => mapping(address => bool)) private hasVotedWithdraw;

    event GroupCreated(uint256 indexed groupId, string name, address creator, uint256 fundingGoal, address baseCurrency);
    event MemberJoined(uint256 indexed groupId, address member);
    event InviteCodeUpdated(uint256 indexed groupId, address updatedBy);
    event Deposited(uint256 indexed groupId, address member, uint256 amount, address token, uint256 convertedAmount);
    event ReimbursementRequested(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount, string description);
    event RequestApproved(uint256 indexed groupId, uint256 requestId, address approver, uint256 currentApprovals, uint256 needed);
    event RequestRejected(uint256 indexed groupId, uint256 requestId, address rejector, uint256 currentRejections, uint256 needed);
    event FundsReleased(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount);
    event RequestDisputed(uint256 indexed groupId, uint256 requestId, uint256 rejections);
    event RequestCancelled(uint256 indexed groupId, uint256 requestId);
    event PotClosed(uint256 indexed groupId);

    modifier onlyMember(uint256 groupId) {
        require(memberOf[groupId][msg.sender], "Not a member");
        _;
    }

    modifier groupOpen(uint256 groupId) {
        require(!groups[groupId].closed, "Group is closed");
        _;
    }

    constructor(address _usdc, address _eurc, address _oracle) {
        require(_usdc != address(0) && _eurc != address(0) && _oracle != address(0), "Zero address");
        usdc = _usdc;
        eurc = _eurc;
        oracle = IFXOracle(_oracle);
    }

    // ─── Group Management ────────────────────────────────────────

    function createGroup(
        string calldata name,
        uint256 fundingGoal,
        address baseCurrency,
        bytes32 inviteCodeHash
    ) external returns (uint256 groupId) {
        require(baseCurrency == usdc || baseCurrency == eurc, "Invalid base currency");

        groupId = ++nextGroupId;
        Group storage g = groups[groupId];
        g.name = name;
        g.creator = msg.sender;
        g.baseCurrency = baseCurrency;
        g.fundingGoal = fundingGoal;
        g.inviteCodeHash = inviteCodeHash; // bytes32(0) = locked
        g.members.push(msg.sender);
        memberOf[groupId][msg.sender] = true;

        emit GroupCreated(groupId, name, msg.sender, fundingGoal, baseCurrency);
        emit MemberJoined(groupId, msg.sender);
    }

    function joinGroup(uint256 groupId, string calldata inviteCode) external groupOpen(groupId) {
        require(groups[groupId].creator != address(0), "Group does not exist");
        require(!memberOf[groupId][msg.sender], "Already a member");
        require(groups[groupId].members.length < MAX_GROUP_SIZE, "Group is full");
        require(groups[groupId].inviteCodeHash != bytes32(0), "Group is locked");
        require(
            keccak256(abi.encodePacked(inviteCode)) == groups[groupId].inviteCodeHash,
            "Invalid invite code"
        );

        groups[groupId].members.push(msg.sender);
        memberOf[groupId][msg.sender] = true;

        emit MemberJoined(groupId, msg.sender);
    }

    /// @notice Set bytes32(0) to lock the group (no new joins). Set a new hash to reopen.
    function updateInviteCode(uint256 groupId, bytes32 newInviteCodeHash) external onlyMember(groupId) groupOpen(groupId) {
        groups[groupId].inviteCodeHash = newInviteCodeHash;
        emit InviteCodeUpdated(groupId, msg.sender);
    }

    // ─── Pot Funding ─────────────────────────────────────────────

    function deposit(
        uint256 groupId,
        uint256 amount,
        address token
    ) external onlyMember(groupId) groupOpen(groupId) nonReentrant {
        require(amount > 0, "Zero amount");
        require(token == usdc || token == eurc, "Invalid token");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 converted = _convertToBase(amount, token, groups[groupId].baseCurrency);
        contributions[groupId][msg.sender] += converted;
        groups[groupId].potBalance += converted;

        emit Deposited(groupId, msg.sender, amount, token, converted);
    }

    // ─── Reimbursements ──────────────────────────────────────────

    function requestReimbursement(
        uint256 groupId,
        uint256 amount,
        string calldata description
    ) external onlyMember(groupId) groupOpen(groupId) returns (uint256 requestId) {
        require(amount > 0, "Zero amount");

        requestId = groups[groupId].nextRequestId++;
        ReimbursementRequest storage r = requests[groupId][requestId];
        r.requester = msg.sender;
        r.amount = amount;
        r.description = description;
        r.status = Status.Pending;
        r.timestamp = block.timestamp;

        uint256 nonRequesterCount = groups[groupId].members.length - 1;
        r.approvalsNeeded = (nonRequesterCount / 2) + 1;

        emit ReimbursementRequested(groupId, requestId, msg.sender, amount, description);
    }

    function voteOnRequest(
        uint256 groupId,
        uint256 requestId,
        bool approve
    ) external onlyMember(groupId) groupOpen(groupId) nonReentrant {
        ReimbursementRequest storage r = requests[groupId][requestId];
        require(r.requester != address(0), "Request does not exist");
        require(r.status == Status.Pending, "Not pending");
        require(msg.sender != r.requester, "Cannot vote on own request");
        require(votes[groupId][requestId][msg.sender] == Vote.None, "Already voted");

        if (approve) {
            votes[groupId][requestId][msg.sender] = Vote.Approve;
            r.approvalCount++;
            emit RequestApproved(groupId, requestId, msg.sender, r.approvalCount, r.approvalsNeeded);

            if (r.approvalCount >= r.approvalsNeeded) {
                r.thresholdMet = true;
                _tryRelease(groupId, requestId);
            }
        } else {
            votes[groupId][requestId][msg.sender] = Vote.Reject;
            r.rejectionCount++;
            emit RequestRejected(groupId, requestId, msg.sender, r.rejectionCount, r.approvalsNeeded);

            if (r.rejectionCount >= r.approvalsNeeded) {
                r.status = Status.Rejected;
                emit RequestDisputed(groupId, requestId, r.rejectionCount);
            }
        }
    }

    function cancelRequest(
        uint256 groupId,
        uint256 requestId
    ) external {
        ReimbursementRequest storage r = requests[groupId][requestId];
        require(msg.sender == r.requester, "Not requester");
        require(r.status == Status.Pending, "Not pending");

        r.status = Status.Cancelled;
        emit RequestCancelled(groupId, requestId);
    }

    function releaseFunds(
        uint256 groupId,
        uint256 requestId
    ) external onlyMember(groupId) nonReentrant {
        require(requests[groupId][requestId].requester != address(0), "Request does not exist");
        _tryRelease(groupId, requestId);
    }

    // ─── Yield Bridge ─────────────────────────────────────────────
    // Simulated bridge: transfers to/from a pocket EOA.
    // TODO: Replace with real CCTP bridge (TokenMessenger.depositForBurn / receiveMessage).
    //       The interface stays the same — only the recipient changes from EOA to BridgeManager.

    address public yieldAdmin; // Backend wallet authorized to bridge funds for yield

    event YieldBridgeOut(uint256 indexed groupId, address recipient, uint256 amount, address token);
    event YieldBridgeIn(uint256 indexed groupId, uint256 amount, address token, uint256 convertedAmount);

    function setYieldAdmin(address _admin) external {
        require(yieldAdmin == address(0) || msg.sender == yieldAdmin, "Not authorized");
        yieldAdmin = _admin;
    }

    /// @notice Transfer pot funds to pocket EOA for yield bridging (Arc → Base simulated)
    /// @dev Drains both USDC and EURC held by the contract since deposits may be in either token.
    /// @param groupId The group whose pot to bridge from
    /// @param recipient Pocket EOA address that receives the funds
    /// @param amount Amount in base currency (6 decimals) — used only for accounting
    function bridgeToYield(uint256 groupId, address recipient, uint256 amount) external nonReentrant {
        require(msg.sender == yieldAdmin, "Not yield admin");
        Group storage g = groups[groupId];
        require(!g.closed, "Group is closed");
        require(g.potBalance >= amount, "Insufficient pot balance");

        g.potBalance -= amount;

        // Transfer actual token balances (pot may hold a mix of USDC and EURC)
        uint256 usdcBal = IERC20(usdc).balanceOf(address(this));
        uint256 eurcBal = IERC20(eurc).balanceOf(address(this));
        if (usdcBal > 0) IERC20(usdc).safeTransfer(recipient, usdcBal);
        if (eurcBal > 0) IERC20(eurc).safeTransfer(recipient, eurcBal);

        emit YieldBridgeOut(groupId, recipient, amount, g.baseCurrency);
    }

    /// @notice Return funds from yield back to pot (Base → Arc simulated)
    /// @param groupId The group whose pot to return funds to
    /// @param amount Amount of token being returned
    /// @param token USDC or EURC address
    function returnFromYield(uint256 groupId, uint256 amount, address token) external nonReentrant {
        require(msg.sender == yieldAdmin, "Not yield admin");
        require(token == usdc || token == eurc, "Invalid token");
        Group storage g = groups[groupId];

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        uint256 converted = _convertToBase(amount, token, g.baseCurrency);
        g.potBalance += converted;

        emit YieldBridgeIn(groupId, amount, token, converted);
    }

    // ─── Withdraw / Close ────────────────────────────────────────

    function voteWithdraw(uint256 groupId) external onlyMember(groupId) groupOpen(groupId) nonReentrant {
        require(!hasVotedWithdraw[groupId][msg.sender], "Already voted");

        hasVotedWithdraw[groupId][msg.sender] = true;
        groups[groupId].withdrawVoteCount++;

        uint256 needed = (groups[groupId].members.length / 2) + 1;

        if (groups[groupId].withdrawVoteCount >= needed) {
            _closePot(groupId);
        }
    }

    // ─── View Functions ──────────────────────────────────────────

    function isMember(uint256 groupId, address user) external view override returns (bool) {
        return memberOf[groupId][user];
    }

    function getBaseCurrency(uint256 groupId) external view override returns (address) {
        return groups[groupId].baseCurrency;
    }

    function getMembers(uint256 groupId) external view override returns (address[] memory) {
        return groups[groupId].members;
    }

    function getGroupInfo(uint256 groupId) external view returns (GroupInfo memory) {
        Group storage g = groups[groupId];
        return GroupInfo({
            name: g.name,
            creator: g.creator,
            baseCurrency: g.baseCurrency,
            fundingGoal: g.fundingGoal,
            potBalance: g.potBalance,
            closed: g.closed,
            members: g.members
        });
    }

    function getPotInfo(uint256 groupId) external view returns (
        uint256 balance,
        uint256 fundingGoal,
        address baseCurrency
    ) {
        Group storage g = groups[groupId];
        return (g.potBalance, g.fundingGoal, g.baseCurrency);
    }

    function getRequestInfo(uint256 groupId, uint256 requestId) external view returns (ReimbursementInfo memory) {
        ReimbursementRequest storage r = requests[groupId][requestId];
        return ReimbursementInfo({
            requester: r.requester,
            amount: r.amount,
            description: r.description,
            approvalCount: r.approvalCount,
            rejectionCount: r.rejectionCount,
            approvalsNeeded: r.approvalsNeeded,
            status: r.status,
            thresholdMet: r.thresholdMet,
            timestamp: r.timestamp
        });
    }

    function getContribution(uint256 groupId, address member) external view returns (uint256) {
        return contributions[groupId][member];
    }

    function getRequestCount(uint256 groupId) external view returns (uint256) {
        return groups[groupId].nextRequestId;
    }

    function getVote(uint256 groupId, uint256 requestId, address voter) external view returns (Vote) {
        return votes[groupId][requestId][voter];
    }

    // ─── Internal ────────────────────────────────────────────────

    function _convertToBase(uint256 amount, address token, address baseCurrency) internal view returns (uint256) {
        if (token == baseCurrency) return amount;

        (uint256 rate, ) = oracle.getRate();
        require(rate > 0, "Invalid FX rate");

        if (baseCurrency == usdc) {
            // EURC → USDC: amount * 1e6 / rate
            return (amount * 1e6) / rate;
        } else {
            // USDC → EURC: amount * rate / 1e6
            return (amount * rate) / 1e6;
        }
    }

    function _tryRelease(uint256 groupId, uint256 requestId) internal {
        ReimbursementRequest storage r = requests[groupId][requestId];
        require(r.status == Status.Pending, "Not pending");
        require(r.thresholdMet, "Threshold not met");

        Group storage g = groups[groupId];
        if (g.potBalance >= r.amount) {
            g.potBalance -= r.amount;
            r.status = Status.Approved;
            IERC20(g.baseCurrency).safeTransfer(r.requester, r.amount);
            emit FundsReleased(groupId, requestId, r.requester, r.amount);
        }
    }

    function _closePot(uint256 groupId) internal {
        Group storage g = groups[groupId];
        g.closed = true;

        // Settle any threshold-met pending requests first
        uint256 count = g.nextRequestId;
        for (uint256 i = 0; i < count; i++) {
            ReimbursementRequest storage r = requests[groupId][i];
            if (r.status == Status.Pending && r.thresholdMet && g.potBalance >= r.amount) {
                g.potBalance -= r.amount;
                r.status = Status.Approved;
                IERC20(g.baseCurrency).safeTransfer(r.requester, r.amount);
                emit FundsReleased(groupId, i, r.requester, r.amount);
            }
        }

        // Distribute remaining balance proportionally to contributions
        uint256 totalContributions;
        for (uint256 i = 0; i < g.members.length; i++) {
            totalContributions += contributions[groupId][g.members[i]];
        }

        if (totalContributions > 0 && g.potBalance > 0) {
            uint256 remaining = g.potBalance;
            uint256 distributed;
            for (uint256 i = 0; i < g.members.length; i++) {
                address member = g.members[i];
                uint256 contrib = contributions[groupId][member];
                if (contrib > 0) {
                    uint256 payout;
                    if (i == g.members.length - 1) {
                        // Last member gets remainder to avoid dust
                        payout = remaining - distributed;
                    } else {
                        payout = (remaining * contrib) / totalContributions;
                    }
                    if (payout > 0) {
                        distributed += payout;
                        IERC20(g.baseCurrency).safeTransfer(member, payout);
                    }
                }
            }
            g.potBalance = 0;
        }

        emit PotClosed(groupId);
    }
}
