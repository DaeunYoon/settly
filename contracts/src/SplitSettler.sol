// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IGroupPot} from "./interfaces/IGroupPot.sol";

contract SplitSettler is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Expense {
        address paidBy;
        uint256 amount;
        string description;
        address[] splitAmong;
        uint256 timestamp;
    }

    struct Settlement {
        address from;
        address to;
        uint256 amount;
    }

    address public immutable usdc;
    address public immutable eurc;
    IGroupPot public immutable groupPot;

    // groupId => expenses
    mapping(uint256 => Expense[]) private groupExpenses;
    // groupId => member => net balance (positive = creditor, negative = debtor)
    mapping(uint256 => mapping(address => int256)) private balances;

    event ExpenseAdded(uint256 indexed groupId, uint256 expenseId, address paidBy, uint256 amount, string description);
    event SettledUp(uint256 indexed groupId);

    constructor(address _usdc, address _eurc, address _groupPot) {
        require(_usdc != address(0) && _eurc != address(0) && _groupPot != address(0), "Zero address");
        usdc = _usdc;
        eurc = _eurc;
        groupPot = IGroupPot(_groupPot);
    }

    function addExpense(
        uint256 groupId,
        uint256 amount,
        string calldata description,
        address[] calldata splitAmong
    ) external {
        require(groupPot.isMember(groupId, msg.sender), "Not a member");
        require(amount > 0, "Zero amount");
        require(splitAmong.length > 0, "No split targets");

        // Validate all split targets are members and no duplicates
        for (uint256 i = 0; i < splitAmong.length; i++) {
            require(groupPot.isMember(groupId, splitAmong[i]), "Split target not a member");
            for (uint256 j = 0; j < i; j++) {
                require(splitAmong[i] != splitAmong[j], "Duplicate address");
            }
        }

        require(amount >= splitAmong.length, "Amount too small to split");
        uint256 perPerson = amount / splitAmong.length;

        // Credit the payer
        balances[groupId][msg.sender] += int256(amount);

        // Debit each person in the split
        for (uint256 i = 0; i < splitAmong.length; i++) {
            balances[groupId][splitAmong[i]] -= int256(perPerson);
        }

        // Assign rounding dust to first split target so balances stay zero-sum
        uint256 dust = amount - (perPerson * splitAmong.length);
        if (dust > 0) {
            balances[groupId][splitAmong[0]] -= int256(dust);
        }

        uint256 expenseId = groupExpenses[groupId].length;
        groupExpenses[groupId].push();
        Expense storage e = groupExpenses[groupId][expenseId];
        e.paidBy = msg.sender;
        e.amount = amount;
        e.description = description;
        e.splitAmong = splitAmong;
        e.timestamp = block.timestamp;

        emit ExpenseAdded(groupId, expenseId, msg.sender, amount, description);
    }

    function getBalances(uint256 groupId) external view returns (address[] memory members, int256[] memory memberBalances) {
        members = groupPot.getMembers(groupId);
        memberBalances = new int256[](members.length);
        for (uint256 i = 0; i < members.length; i++) {
            memberBalances[i] = balances[groupId][members[i]];
        }
    }

    function calculateSettlements(uint256 groupId) public view returns (Settlement[] memory) {
        address[] memory members = groupPot.getMembers(groupId);

        // Separate creditors and debtors
        uint256 creditorCount;
        uint256 debtorCount;
        for (uint256 i = 0; i < members.length; i++) {
            int256 bal = balances[groupId][members[i]];
            if (bal > 0) creditorCount++;
            else if (bal < 0) debtorCount++;
        }

        if (creditorCount == 0 || debtorCount == 0) {
            return new Settlement[](0);
        }

        address[] memory creditors = new address[](creditorCount);
        uint256[] memory credits = new uint256[](creditorCount);
        address[] memory debtors = new address[](debtorCount);
        uint256[] memory debts = new uint256[](debtorCount);

        uint256 ci;
        uint256 di;
        for (uint256 i = 0; i < members.length; i++) {
            int256 bal = balances[groupId][members[i]];
            if (bal > 0) {
                creditors[ci] = members[i];
                credits[ci] = uint256(bal);
                ci++;
            } else if (bal < 0) {
                debtors[di] = members[i];
                debts[di] = uint256(-bal);
                di++;
            }
        }

        // Greedy matching
        Settlement[] memory temp = new Settlement[](creditorCount + debtorCount);
        uint256 settlementCount;
        uint256 c;
        uint256 d;

        while (c < creditorCount && d < debtorCount) {
            uint256 transferAmount = credits[c] < debts[d] ? credits[c] : debts[d];

            if (transferAmount > 0) {
                temp[settlementCount] = Settlement({
                    from: debtors[d],
                    to: creditors[c],
                    amount: transferAmount
                });
                settlementCount++;
            }

            credits[c] -= transferAmount;
            debts[d] -= transferAmount;

            if (credits[c] == 0) c++;
            if (debts[d] == 0) d++;
        }

        // Copy to correctly sized array
        Settlement[] memory result = new Settlement[](settlementCount);
        for (uint256 i = 0; i < settlementCount; i++) {
            result[i] = temp[i];
        }
        return result;
    }

    function settleUp(uint256 groupId) external nonReentrant {
        require(groupPot.isMember(groupId, msg.sender), "Not a member");

        Settlement[] memory settlements = calculateSettlements(groupId);
        require(settlements.length > 0, "Nothing to settle");

        address baseCurrency = groupPot.getBaseCurrency(groupId);
        require(baseCurrency == usdc || baseCurrency == eurc, "Invalid currency");

        for (uint256 i = 0; i < settlements.length; i++) {
            IERC20(baseCurrency).safeTransferFrom(
                settlements[i].from,
                settlements[i].to,
                settlements[i].amount
            );
        }

        // Clear balances and expenses
        address[] memory members = groupPot.getMembers(groupId);
        for (uint256 i = 0; i < members.length; i++) {
            delete balances[groupId][members[i]];
        }
        delete groupExpenses[groupId];

        emit SettledUp(groupId);
    }

    function getExpense(uint256 groupId, uint256 expenseId) external view returns (
        address paidBy,
        uint256 amount,
        string memory description,
        address[] memory splitAmong,
        uint256 timestamp
    ) {
        require(expenseId < groupExpenses[groupId].length, "Expense does not exist");
        Expense storage e = groupExpenses[groupId][expenseId];
        return (e.paidBy, e.amount, e.description, e.splitAmong, e.timestamp);
    }

    function getExpenseCount(uint256 groupId) external view returns (uint256) {
        return groupExpenses[groupId].length;
    }
}
