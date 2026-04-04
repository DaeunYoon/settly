import { parseAbi } from "viem";

// Arc Testnet deployed addresses
export const CONTRACTS = {
  FX_ORACLE: "0x2B4F88D09B00CB9D0A157c0E09f0d52438c31f05",
  GROUP_POT: "0x44c6387dDD97c45cda06687890d1F8C9564A5427",
  SPLIT_SETTLER: "0x1951BCf309E1d457d4a5D8FB035c2B7505cD15b4",
  USDC: "0x3600000000000000000000000000000000000000",
  EURC: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
} as const;

export const ARC_TESTNET = {
  id: 5042002,
  name: "Arc Testnet",
  rpcUrl: "https://rpc.testnet.arc.network",
} as const;

export const FX_ORACLE_ABI = parseAbi([
  "function getRate() view returns (uint256 rate, uint256 updatedAt)",
  "function usdcToEurcRate() view returns (uint256)",
  "function rateLastUpdated() view returns (uint256)",
  "function owner() view returns (address)",
  "function updateRate(uint256 _newRate)",
  "function transferOwnership(address newOwner)",
  "event RateUpdated(uint256 newRate, uint256 timestamp)",
]);

export const GROUP_POT_ABI = parseAbi([
  "function createGroup(string name, uint256 fundingGoal, address baseCurrency, bytes32 inviteCodeHash) returns (uint256)",
  "function joinGroup(uint256 groupId, string inviteCode)",
  "function deposit(uint256 groupId, uint256 amount, address token)",
  "function requestReimbursement(uint256 groupId, uint256 amount, string description) returns (uint256)",
  "function approveRequest(uint256 groupId, uint256 requestId)",
  "function cancelRequest(uint256 groupId, uint256 requestId)",
  "function releaseFunds(uint256 groupId, uint256 requestId)",
  "function voteWithdraw(uint256 groupId)",
  "function updateInviteCode(uint256 groupId, bytes32 newInviteCodeHash)",
  "function isMember(uint256 groupId, address user) view returns (bool)",
  "function getBaseCurrency(uint256 groupId) view returns (address)",
  "function getMembers(uint256 groupId) view returns (address[])",
  "function getGroupInfo(uint256 groupId) view returns ((string name, address creator, address baseCurrency, uint256 fundingGoal, uint256 potBalance, bool closed, address[] members))",
  "function getPotInfo(uint256 groupId) view returns (uint256 balance, uint256 fundingGoal, address baseCurrency)",
  "function getRequestInfo(uint256 groupId, uint256 requestId) view returns ((address requester, uint256 amount, string description, uint256 approvalCount, uint256 approvalsNeeded, uint8 status, bool thresholdMet, uint256 timestamp))",
  "function getContribution(uint256 groupId, address member) view returns (uint256)",
  "function getRequestCount(uint256 groupId) view returns (uint256)",
  "function nextGroupId() view returns (uint256)",
  "function MAX_GROUP_SIZE() view returns (uint256)",
  "function usdc() view returns (address)",
  "function eurc() view returns (address)",
  "event GroupCreated(uint256 indexed groupId, string name, address creator, uint256 fundingGoal, address baseCurrency)",
  "event MemberJoined(uint256 indexed groupId, address member)",
  "event Deposited(uint256 indexed groupId, address member, uint256 amount, address token, uint256 convertedAmount)",
  "event ReimbursementRequested(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount, string description)",
  "event RequestApproved(uint256 indexed groupId, uint256 requestId, address approver, uint256 currentApprovals, uint256 needed)",
  "event FundsReleased(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount)",
  "event RequestCancelled(uint256 indexed groupId, uint256 requestId)",
  "event InviteCodeUpdated(uint256 indexed groupId, address updatedBy)",
  "event PotClosed(uint256 indexed groupId)",
]);

export const SPLIT_SETTLER_ABI = parseAbi([
  "function addExpense(uint256 groupId, uint256 amount, string description, address[] splitAmong)",
  "function getBalances(uint256 groupId) view returns (address[] members, int256[] memberBalances)",
  "function calculateSettlements(uint256 groupId) view returns ((address from, address to, uint256 amount)[])",
  "function settleUp(uint256 groupId)",
  "function getExpense(uint256 groupId, uint256 expenseId) view returns (address paidBy, uint256 amount, string description, address[] splitAmong, uint256 timestamp)",
  "function getExpenseCount(uint256 groupId) view returns (uint256)",
  "event ExpenseAdded(uint256 indexed groupId, uint256 expenseId, address paidBy, uint256 amount, string description)",
  "event SettledUp(uint256 indexed groupId)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
