import { parseAbi } from "viem";

// Arc Testnet deployed addresses
export const CONTRACTS = {
  FX_ORACLE: "0x545BD434404CA7F8F6aD86d86d8e3a2297b14616",
  GROUP_POT: "0xa361e0D722cFca3ED426E0522E7eF56c0CC3Cfa6",
  SPLIT_SETTLER: "0x454017Cc37Ce3574B2aB16a8567c69E884E64451",
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
  "function voteOnRequest(uint256 groupId, uint256 requestId, bool approve)",
  "function cancelRequest(uint256 groupId, uint256 requestId)",
  "function releaseFunds(uint256 groupId, uint256 requestId)",
  "function voteWithdraw(uint256 groupId)",
  "function updateInviteCode(uint256 groupId, bytes32 newInviteCodeHash)",
  "function isMember(uint256 groupId, address user) view returns (bool)",
  "function getBaseCurrency(uint256 groupId) view returns (address)",
  "function getMembers(uint256 groupId) view returns (address[])",
  "function getGroupInfo(uint256 groupId) view returns ((string name, address creator, address baseCurrency, uint256 fundingGoal, uint256 potBalance, bool closed, address[] members))",
  "function getPotInfo(uint256 groupId) view returns (uint256 balance, uint256 fundingGoal, address baseCurrency)",
  "function getRequestInfo(uint256 groupId, uint256 requestId) view returns ((address requester, uint256 amount, string description, uint256 approvalCount, uint256 rejectionCount, uint256 approvalsNeeded, uint8 status, bool thresholdMet, uint256 timestamp))",
  "function getContribution(uint256 groupId, address member) view returns (uint256)",
  "function getRequestCount(uint256 groupId) view returns (uint256)",
  "function getVote(uint256 groupId, uint256 requestId, address voter) view returns (uint8)",
  "function nextGroupId() view returns (uint256)",
  "function MAX_GROUP_SIZE() view returns (uint256)",
  "function usdc() view returns (address)",
  "function eurc() view returns (address)",
  "event GroupCreated(uint256 indexed groupId, string name, address creator, uint256 fundingGoal, address baseCurrency)",
  "event MemberJoined(uint256 indexed groupId, address member)",
  "event Deposited(uint256 indexed groupId, address member, uint256 amount, address token, uint256 convertedAmount)",
  "event ReimbursementRequested(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount, string description)",
  "event RequestApproved(uint256 indexed groupId, uint256 requestId, address approver, uint256 currentApprovals, uint256 needed)",
  "event RequestRejected(uint256 indexed groupId, uint256 requestId, address rejector, uint256 currentRejections, uint256 needed)",
  "event FundsReleased(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount)",
  "event RequestDisputed(uint256 indexed groupId, uint256 requestId, uint256 rejections)",
  "event RequestCancelled(uint256 indexed groupId, uint256 requestId)",
  "event InviteCodeUpdated(uint256 indexed groupId, address updatedBy)",
  "event PotClosed(uint256 indexed groupId)",
  "function bridgeToYield(uint256 groupId, address recipient, uint256 amount)",
  "function returnFromYield(uint256 groupId, uint256 amount, address token)",
  "function setYieldAdmin(address _admin)",
  "event YieldBridgeOut(uint256 indexed groupId, address recipient, uint256 amount, address token)",
  "event YieldBridgeIn(uint256 indexed groupId, uint256 amount, address token, uint256 convertedAmount)",
]);

export const SPLIT_SETTLER_ABI = parseAbi([
  "function addExpense(uint256 groupId, uint256 amount, string description, address[] splitAmong)",
  "function getBalances(uint256 groupId) view returns (address[] members, int256[] memberBalances)",
  "function calculateSettlements(uint256 groupId) view returns ((address from, address to, uint256 amount)[])",
  "function settle(uint256 groupId, address to)",
  "function getExpense(uint256 groupId, uint256 expenseId) view returns (address paidBy, uint256 amount, string description, address[] splitAmong, uint256 timestamp)",
  "function getExpenseCount(uint256 groupId) view returns (uint256)",
  "event ExpenseAdded(uint256 indexed groupId, uint256 expenseId, address paidBy, uint256 amount, string description)",
  "event Settled(uint256 indexed groupId, address indexed from, address indexed to, uint256 amount)",
]);

export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// ─── Yield Farming (Arc Testnet + Base Sepolia) ─────────────

// Placeholder addresses — update after deployment
export const YIELD_CONTRACTS = {
  // Arc Testnet
  YIELD_MANAGER: "0x9798c7B376bCfF3Eac99532061d8C22473339766",
  // Base Sepolia
  YIELD_STRATEGY: "0xf7CEd01B0109DA9c5Df8dA46f28E837Da148F311",
  SUSDS_VAULT: "0x180BdF64fb8753100f6E44516Ea6ed70e7c7521e",  // accepts USDC, 3.75% APY
  SUSDE_VAULT: "0xb093465BBF7e63d003edB0dc02522B08C511feED",  // accepts USDC, 8.5% APY
  USDC_BASE: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  WETH_BASE: "0x4200000000000000000000000000000000000006",
} as const;

export const BASE_SEPOLIA = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
} as const;

export const YIELD_MANAGER_ABI = parseAbi([
  "function proposeEnableYield(uint256 groupId, uint8 strategy)",
  "function voteEnableYield(uint256 groupId, bool approve)",
  "function proposeWithdraw(uint256 groupId)",
  "function voteWithdraw(uint256 groupId, bool approve)",
  "function isWithdrawalApproved(uint256 groupId) view returns (bool)",
  "function getYieldInfo(uint256 groupId) view returns (uint8 strategy, uint8 phase, uint256 bridgedAmount, uint256 currentValue)",
  "function getYieldVotes(uint256 groupId) view returns (uint256 lastUpdated, uint256 enableVoteCount, uint256 withdrawVoteCount, uint256 votesNeeded)",
  "function hasVotedCurrentEnable(uint256 groupId, address member) view returns (bool)",
  "function hasVotedCurrentWithdraw(uint256 groupId, address member) view returns (bool)",
  "function canProposeYield(uint256 groupId) view returns (bool)",
  "event YieldProposed(uint256 indexed groupId, uint8 strategy, address proposer)",
  "event YieldEnabled(uint256 indexed groupId, uint8 strategy, uint256 bridgedAmount)",
  "event YieldBalanceUpdated(uint256 indexed groupId, uint256 currentValue)",
  "event WithdrawalProposed(uint256 indexed groupId, address proposer)",
  "event WithdrawalExecuted(uint256 indexed groupId, uint256 returnedAmount)",
]);
