// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IGroupPot} from "../interfaces/IGroupPot.sol";
import {IFXOracle} from "../interfaces/IFXOracle.sol";

/// @title YieldManager — on-chain yield state tracker on Arc Testnet
/// @dev Tracks bridged yield positions, handles enable/withdraw voting.
///      Does NOT hold funds — backend orchestrates the actual bridge + deposit on Base Sepolia.
///      Backend is the admin that records bridge completions and pushes yield balance updates.
contract YieldManager {
    enum Strategy { Conservative, Balanced, Aggressive }

    enum Phase {
        Idle,               // no yield active
        EnableVoting,       // proposal submitted, members voting
        EnableApproved,     // vote passed, waiting for backend to bridge
        Active,             // funds bridged and earning yield
        WithdrawVoting,     // withdrawal proposed, members voting
        WithdrawApproved    // withdrawal vote passed, waiting for backend
    }

    struct YieldState {
        Phase phase;
        Strategy strategy;
        uint256 bridgedAmount;      // USDC amount sent to Base Sepolia
        uint256 currentValue;       // Latest value from backend (USDC terms)
        uint256 lastUpdated;
        uint256 enableVoteCount;
        uint256 enableRejectCount;
        uint256 withdrawVoteCount;
        address enableProposer;
        address withdrawProposer;
    }

    IGroupPot public immutable groupPot;
    address public immutable usdc;
    address public immutable eurc;
    IFXOracle public immutable oracle;
    address public admin; // Backend wallet that records bridges + updates balances

    // groupId => YieldState
    mapping(uint256 => YieldState) public yieldStates;
    // Nonces live outside YieldState so `delete yieldStates[groupId]` doesn't reset them
    mapping(uint256 => uint256) public enableNonce;
    mapping(uint256 => uint256) public withdrawNonce;
    // groupId => nonce => member => voted
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVotedEnable;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) public hasVotedWithdraw;

    event YieldProposed(uint256 indexed groupId, Strategy strategy, address proposer);
    event YieldVoteCast(uint256 indexed groupId, address voter, bool approve, uint256 currentVotes, uint256 needed);
    event YieldEnabled(uint256 indexed groupId, Strategy strategy, uint256 bridgedAmount);
    event YieldBalanceUpdated(uint256 indexed groupId, uint256 currentValue);
    event YieldProposalRejected(uint256 indexed groupId);
    event WithdrawalProposed(uint256 indexed groupId, address proposer);
    event WithdrawalVoteCast(uint256 indexed groupId, address voter, bool approve, uint256 currentVotes, uint256 needed);
    event WithdrawalExecuted(uint256 indexed groupId, uint256 returnedAmount);

    modifier onlyMember(uint256 groupId) {
        require(groupPot.isMember(groupId, msg.sender), "Not a member");
        _;
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    constructor(
        address _groupPot,
        address _usdc,
        address _eurc,
        address _oracle
    ) {
        require(_groupPot != address(0), "Zero address");
        groupPot = IGroupPot(_groupPot);
        usdc = _usdc;
        eurc = _eurc;
        oracle = IFXOracle(_oracle);
        admin = msg.sender;
    }

    // ─── Enable Yield ───────────────────────────────────────────

    /// @notice Propose enabling yield farming for a group
    function proposeEnableYield(uint256 groupId, Strategy strategy) external onlyMember(groupId) {
        require(canProposeYield(groupId), "Yield already enabled");

        delete yieldStates[groupId];
        enableNonce[groupId]++;

        YieldState storage state = yieldStates[groupId];
        state.strategy = strategy;
        state.phase = Phase.EnableVoting;
        state.enableProposer = msg.sender;
        state.enableVoteCount = 1; // Proposer auto-votes yes
        hasVotedEnable[groupId][enableNonce[groupId]][msg.sender] = true;

        emit YieldProposed(groupId, strategy, msg.sender);

        // Check if single member = auto-approve
        uint256 needed = _votesNeeded(groupId);
        emit YieldVoteCast(groupId, msg.sender, true, 1, needed);
        if (state.enableVoteCount >= needed) {
            state.phase = Phase.EnableApproved;
            emit YieldEnabled(groupId, strategy, 0);
        }
    }

    /// @notice Vote on enabling yield
    function voteEnableYield(uint256 groupId, bool approve) external onlyMember(groupId) {
        YieldState storage state = yieldStates[groupId];
        require(state.phase == Phase.EnableVoting, "No pending vote");
        require(!hasVotedEnable[groupId][enableNonce[groupId]][msg.sender], "Already voted");

        hasVotedEnable[groupId][enableNonce[groupId]][msg.sender] = true;
        uint256 needed = _votesNeeded(groupId);

        if (approve) {
            state.enableVoteCount++;
            emit YieldVoteCast(groupId, msg.sender, true, state.enableVoteCount, needed);

            if (state.enableVoteCount >= needed) {
                state.phase = Phase.EnableApproved;
                emit YieldEnabled(groupId, state.strategy, 0);
            }
        } else {
            state.enableRejectCount++;
            emit YieldVoteCast(groupId, msg.sender, false, state.enableRejectCount, needed);

            if (state.enableRejectCount >= needed) {
                delete yieldStates[groupId];
                emit YieldProposalRejected(groupId);
            }
        }
    }

    // ─── Backend Records ────────────────────────────────────────

    /// @notice Admin can force-enable yield (recovery for broken state)
    function forceEnableYield(uint256 groupId, Strategy strategy, uint256 bridgedAmount) external onlyAdmin {
        YieldState storage state = yieldStates[groupId];
        state.strategy = strategy;
        state.phase = Phase.Active;
        state.bridgedAmount = bridgedAmount;
        state.currentValue = bridgedAmount;
        state.lastUpdated = block.timestamp;
        emit YieldEnabled(groupId, strategy, bridgedAmount);
    }

    /// @notice Backend records that funds have been bridged to Base Sepolia
    function recordBridged(uint256 groupId, uint256 amount) external onlyAdmin {
        YieldState storage state = yieldStates[groupId];
        require(state.phase == Phase.EnableApproved, "Yield not approved");
        state.phase = Phase.Active;
        state.bridgedAmount = amount;
        state.currentValue = amount;
        state.lastUpdated = block.timestamp;

        emit YieldEnabled(groupId, state.strategy, amount);
    }

    /// @notice Backend pushes latest yield value from Base Sepolia
    function updateYieldBalance(uint256 groupId, uint256 currentValue) external onlyAdmin {
        YieldState storage state = yieldStates[groupId];
        require(state.phase == Phase.Active || state.phase == Phase.WithdrawVoting || state.phase == Phase.WithdrawApproved, "Yield not active");
        state.currentValue = currentValue;
        state.lastUpdated = block.timestamp;

        emit YieldBalanceUpdated(groupId, currentValue);
    }

    // ─── Withdraw ───────────────────────────────────────────────

    /// @notice Propose withdrawing yield funds back to Arc
    function proposeWithdraw(uint256 groupId) external onlyMember(groupId) {
        YieldState storage state = yieldStates[groupId];
        require(state.phase == Phase.Active, "Yield not active");
        require(state.bridgedAmount > 0, "Nothing bridged");

        withdrawNonce[groupId]++;
        state.phase = Phase.WithdrawVoting;
        state.withdrawProposer = msg.sender;
        state.withdrawVoteCount = 1; // Proposer auto-votes
        hasVotedWithdraw[groupId][withdrawNonce[groupId]][msg.sender] = true;

        emit WithdrawalProposed(groupId, msg.sender);

        uint256 needed = _votesNeeded(groupId);
        emit WithdrawalVoteCast(groupId, msg.sender, true, 1, needed);

        if (state.withdrawVoteCount >= needed) {
            state.phase = Phase.WithdrawApproved;
        }
    }

    /// @notice Vote on withdrawal
    function voteWithdraw(uint256 groupId, bool approve) external onlyMember(groupId) {
        YieldState storage state = yieldStates[groupId];
        require(state.phase == Phase.WithdrawVoting, "No withdrawal proposed");
        require(!hasVotedWithdraw[groupId][withdrawNonce[groupId]][msg.sender], "Already voted");

        hasVotedWithdraw[groupId][withdrawNonce[groupId]][msg.sender] = true;
        uint256 needed = _votesNeeded(groupId);

        if (approve) {
            state.withdrawVoteCount++;
            emit WithdrawalVoteCast(groupId, msg.sender, true, state.withdrawVoteCount, needed);

            if (state.withdrawVoteCount >= needed) {
                state.phase = Phase.WithdrawApproved;
            }
        } else {
            emit WithdrawalVoteCast(groupId, msg.sender, false, state.withdrawVoteCount, needed);
        }
    }

    /// @notice Check if withdrawal has enough votes (backend calls this before executing)
    function isWithdrawalApproved(uint256 groupId) external view returns (bool) {
        return yieldStates[groupId].phase == Phase.WithdrawApproved;
    }

    /// @notice Reset yield state when nothing was bridged (prevents deadlock)
    function resetYield(uint256 groupId) external onlyMember(groupId) {
        YieldState storage state = yieldStates[groupId];
        require(state.phase != Phase.Idle, "No yield to reset");
        require(state.bridgedAmount == 0, "Funds bridged, use withdrawal flow");

        delete yieldStates[groupId];
    }

    /// @notice Backend records that withdrawal is complete
    function recordWithdrawal(uint256 groupId, uint256 returnedAmount) external onlyAdmin {
        YieldState storage state = yieldStates[groupId];
        require(state.phase == Phase.WithdrawApproved, "Withdrawal not approved");

        emit WithdrawalExecuted(groupId, returnedAmount);

        delete yieldStates[groupId];
    }

    // ─── View ───────────────────────────────────────────────────

    function getYieldInfo(uint256 groupId) external view returns (
        uint8 strategy,
        uint8 phase,
        uint256 bridgedAmount,
        uint256 currentValue
    ) {
        YieldState storage state = yieldStates[groupId];
        return (
            uint8(state.strategy),
            uint8(state.phase),
            state.bridgedAmount,
            state.currentValue
        );
    }

    function getYieldVotes(uint256 groupId) external view returns (
        uint256 lastUpdated,
        uint256 enableVoteCount,
        uint256 withdrawVoteCount,
        uint256 votesNeeded
    ) {
        YieldState storage state = yieldStates[groupId];
        return (
            state.lastUpdated,
            state.enableVoteCount,
            state.withdrawVoteCount,
            _votesNeeded(groupId)
        );
    }

    function getEnableRejectCount(uint256 groupId) external view returns (uint256) {
        return yieldStates[groupId].enableRejectCount;
    }

    /// @notice Whether a new yield proposal can be made for a group
    function canProposeYield(uint256 groupId) public view returns (bool) {
        YieldState storage state = yieldStates[groupId];
        return state.phase == Phase.Idle || state.bridgedAmount == 0;
    }

    /// @notice Check if member has voted on the current enable proposal
    function hasVotedCurrentEnable(uint256 groupId, address member) external view returns (bool) {
        return hasVotedEnable[groupId][enableNonce[groupId]][member];
    }

    /// @notice Check if member has voted on the current withdraw proposal
    function hasVotedCurrentWithdraw(uint256 groupId, address member) external view returns (bool) {
        return hasVotedWithdraw[groupId][withdrawNonce[groupId]][member];
    }

    // ─── Internal ───────────────────────────────────────────────

    function _votesNeeded(uint256 groupId) internal view returns (uint256) {
        address[] memory members = groupPot.getMembers(groupId);
        return (members.length / 2) + 1;
    }
}
