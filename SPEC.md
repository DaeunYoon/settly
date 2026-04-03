# Settly — App Spec v3

## Overview

**Settly** is a group expense app deployed on **Arc** (Circle's L1 blockchain). Groups manage shared money in two modes:

1. **Pot mode** — members pre-fund a shared pot in USDC or EURC, then request reimbursements that other members approve before funds are released
2. **Split mode** — someone pays ad-hoc, logs the expense, and the app settles debts directly between wallets via approve-pull

Both modes coexist within the same group. Members can set their preferred settlement currency (USDC or EURC), and the contract handles FX conversion automatically.

**One-liner:** "A group wallet with approval-based spending, Splitwise-style debt settling, and automatic USD/EUR FX — on-chain."

---

## Hackathon Context

- **Event:** ETHGlobal Cannes 2026 (April 3–5)
- **Prize targets (1 track per sponsor):**

| Sponsor | Track | Prize | Role in App |
|---------|-------|-------|-------------|
| **Arc** | Smart Contracts + Advanced Stablecoin Logic | $3,000 | Pot contract, settlement contract, USDC/EURC FX logic, escrow |
| **Uniswap Foundation** | Best Uniswap API Integration | $10,000 | Phase 2: yield on idle pot funds, cross-chain token→USDC swap |
| **Dynamic** | Best use of Dynamic JS SDK | $1,667 | Email login, embedded wallets, frictionless group onboarding |

**Total prize ceiling: ~$14,700**

---

## Target Users

- Crypto-native friend groups splitting expenses (dinners, trips, rent)
- Travel groups pooling money toward shared goals
- Housemates splitting recurring bills
- Mixed USD/EUR groups (e.g., Americans and Europeans traveling together)

---

## Core Features

### Feature 1: Pot Mode (Pre-funded group treasury with approval-based spending)

**Best for:** Planned group expenses — trips, events, shared subscriptions.

#### User Flow

1. **Create group + pot** — Alice creates "Cannes Trip" group with a pot. Sets optional funding goal (e.g., 600 USDC).
2. **Members join** — Bob and Carol join via invite link (Dynamic email login).
3. **Fund the pot** — Each member deposits USDC or EURC into the pot. Pot tracks individual contributions and auto-converts to the pot's base currency if needed.
4. **Alice pays for hotel** — She pays from her own wallet.
5. **Request reimbursement** — Alice submits a request to the pot: "Hotel — 300 USDC."
6. **Members approve** — Bob and Carol review the request. Once enough non-requester members approve, the pot automatically releases funds to Alice.
7. **Dashboard updates** — Shows remaining pot balance, all past reimbursements, and per-member contributions.

#### Approval Mechanics

- Requester **cannot** approve their own request
- Approval threshold: majority of non-requester members
  - 2-member group: 1 non-requester, need 1 approval
  - 3-member group: 2 non-requesters, need 2 approvals
  - 4-member group: 3 non-requesters, need 2 approvals
  - Formula: `required = (nonRequesterCount / 2) + 1`
- Auto-releases funds to requester once threshold is met
- If pot has insufficient funds → request stays pending until pot is topped up
- Requester can cancel their own pending request

#### Pot Lifecycle

- Members can contribute at any time
- Members can vote to close the pot and distribute remaining funds proportionally to contributions (majority vote)

### Feature 2: Split Mode (Ad-hoc expense splitting)

**Best for:** Spontaneous expenses, one-off splits, quick settlements.

#### User Flow

1. **Log expense** — Bob pays 60 USDC for a taxi. Logs: "Taxi — 60 USDC, split among Alice/Bob/Carol."
2. **View balances** — App calculates net debts. Alice owes 20, Carol owes 20, Bob is owed 40.
3. **Settle up** — Any member taps "Settle Up." Contract pulls from debtors (via approve/transferFrom) and sends to creditors.

#### Settlement Mechanics

- Each member grants a one-time ERC-20 `approve()` to the contract during onboarding
- `settleUp()` calculates optimized transfers (greedy matching: largest debtor ↔ largest creditor)
- Pulls from debtors, sends to creditors in one transaction
- Expenses reset after settlement

### Feature 3: Multi-Currency FX (USDC ↔ EURC)

**Context:** Arc natively supports both USDC and EURC. StableFX (Circle's institutional FX engine) requires permissioned access, so we implement our own lightweight FX within the contracts.

#### How It Works

- Each group has a **base currency** (USDC or EURC) set at creation
- Members can deposit in either USDC or EURC
- If a deposit currency differs from the group's base currency, the contract converts it using a configurable exchange rate
- The exchange rate is stored in the contract and can be updated by the group creator (or fetched from an oracle in production)
- Reimbursements and settlements pay out in the pot's base currency
- Members can optionally set a **preferred payout currency** — if different from base, the contract converts on payout

#### FX Contract Logic

```solidity
// Stored rate: how many EURC per 1 USDC (scaled by 1e6)
// e.g., 920000 means 1 USDC = 0.92 EURC
uint256 public usdcToEurcRate;

function convertToBase(uint256 amount, address token) internal view returns (uint256) {
    if (token == baseCurrency) return amount;
    if (baseCurrency == usdc && token == eurc) {
        // EURC → USDC: amount * 1e6 / usdcToEurcRate
        return (amount * 1e6) / usdcToEurcRate;
    } else {
        // USDC → EURC: amount * usdcToEurcRate / 1e6
        return (amount * usdcToEurcRate) / 1e6;
    }
}
```

#### Why This Matters for the Arc Prize

Arc's pitch is "the home for stablecoin finance." Having a contract that programmatically handles USDC↔EURC conversion, escrow, and conditional multi-party settlement is exactly the kind of "advanced stablecoin logic" their track is looking for. This showcases what's uniquely possible on Arc vs any other chain.

---

## Uniswap Integration (Phase 2 — implement after core features work)

Uniswap is not deployed on Arc testnet. The integration works cross-chain.

### Use Case 1: Pay in Any Token

1. User has ETH (or any token) on Ethereum/Sepolia
2. Uniswap API swaps token → USDC on source chain
3. Circle CCTP bridges USDC from source chain → Arc
4. USDC arrives on Arc → used for pot deposit or settlement

### Use Case 2: Yield on Idle Pot Funds

1. Idle USDC in the pot can be bridged to Base (or another chain with Uniswap liquidity)
2. Deposited into a yield-bearing Uniswap v4 position or liquidity pool
3. Yield accrues to the pot
4. When needed, withdraw + bridge back to Arc

### Integration Points
- **Uniswap Developer Platform:** `https://developers.uniswap.org/`
- **Uniswap API Docs:** `https://api-docs.uniswap.org/guides/integration_guide`
- **Uniswap AI Toolkit:** `https://github.com/Uniswap/uniswap-ai`
- **Circle CCTP Docs:** `https://developers.circle.com/stablecoins/cctp-getting-started`
- **Circle Bridge Kit:** `https://developers.circle.com/bridge-kit`

### Cross-Chain Swap + Bridge Flow
```
User (Sepolia)          Uniswap (Sepolia)       CCTP              Arc
     │                       │                    │                 │
     │── approve token ─────▶│                    │                 │
     │── swap ETH→USDC ────▶│                    │                 │
     │◀── USDC ─────────────│                    │                 │
     │── approve for CCTP ──────────────────────▶│                 │
     │── depositForBurn ────────────────────────▶│                 │
     │                       │                    │── mint USDC ──▶│
     │                       │                    │    deposit()   │
```

### Submission Requirements (Uniswap)
- Transaction IDs showing real on-chain swap execution
- Public GitHub with README
- Demo link or setup instructions
- Demo video (max 3 min)
- Completed feedback form: `https://developers.uniswap.org/feedback`

---

## Smart Contract Architecture

### Contract 1: GroupPot.sol

**Purpose:** Group management, pot funding (USDC/EURC with FX), reimbursement requests with multi-member approval.

**Constructor:** `constructor(address _usdc, address _eurc, uint256 _initialRate)`

**Key State:**
- Group info: name, members, base currency
- Pot: balance (in base currency), per-member contributions
- FX rate: `usdcToEurcRate` (updatable by group creator)
- Reimbursement requests with approval tracking

**Functions:**

| Function | Access | Description |
|----------|--------|-------------|
| `createGroup(string name, uint256 fundingGoal, address baseCurrency)` | Anyone | Creates group + pot with USDC or EURC as base. Returns `groupId`. |
| `joinGroup(uint256 groupId)` | Anyone | Join existing group. |
| `deposit(uint256 groupId, uint256 amount, address token)` | Members | Deposit USDC or EURC. Auto-converts to base currency if different. |
| `requestReimbursement(uint256 groupId, uint256 amount, string description)` | Members | Submit reimbursement request (amount in base currency). |
| `approveRequest(uint256 groupId, uint256 requestId)` | Members (not requester) | Approve request. Auto-releases on threshold. |
| `cancelRequest(uint256 groupId, uint256 requestId)` | Requester | Cancel own pending request. |
| `voteWithdraw(uint256 groupId)` | Members | Vote to close pot, distribute proportionally. |
| `updateRate(uint256 groupId, uint256 newRate)` | Group creator | Update USDC↔EURC exchange rate. |
| `isMember(uint256 groupId, address user)` | View | Membership check (used by SplitSettler). |
| `getPotInfo(uint256 groupId)` | View | Balance, goal, contributions, base currency. |
| `getGroupInfo(uint256 groupId)` | View | Name, members, settings. |
| `getRequestInfo(uint256 groupId, uint256 requestId)` | View | Request details + approval status. |
| `getContribution(uint256 groupId, address member)` | View | Member's total contribution (in base currency). |

**Structs:**
```solidity
struct ReimbursementRequest {
    address requester;
    uint256 amount;        // in base currency (6 decimals)
    string description;
    uint256 approvalCount;
    mapping(address => bool) hasApproved;
    Status status;
    uint256 timestamp;
}

enum Status { Pending, Approved, Cancelled }
```

**Events:**
- `GroupCreated(uint256 indexed groupId, string name, address creator, uint256 fundingGoal, address baseCurrency)`
- `MemberJoined(uint256 indexed groupId, address member)`
- `Deposited(uint256 indexed groupId, address member, uint256 amount, address token, uint256 convertedAmount)`
- `ReimbursementRequested(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount, string description)`
- `RequestApproved(uint256 indexed groupId, uint256 requestId, address approver, uint256 currentApprovals, uint256 needed)`
- `FundsReleased(uint256 indexed groupId, uint256 requestId, address requester, uint256 amount)`
- `RequestCancelled(uint256 indexed groupId, uint256 requestId)`
- `RateUpdated(uint256 indexed groupId, uint256 newRate)`
- `PotClosed(uint256 indexed groupId)`

---

### Contract 2: SplitSettler.sol

**Purpose:** Ad-hoc expense tracking + one-click approve-pull settlement. Settles in the group's base currency.

**Constructor:** `constructor(address _usdc, address _eurc, address _groupPot)`

References GroupPot for membership checks via `GroupPot.isMember()` and for the group's base currency.

**Functions:**

| Function | Access | Description |
|----------|--------|-------------|
| `addExpense(uint256 groupId, uint256 amount, string description, address[] splitAmong)` | Members | Log expense. Amount in base currency. |
| `getBalances(uint256 groupId)` | View | Net balances per member (+creditor, -debtor). |
| `calculateSettlements(uint256 groupId)` | View | Optimized `Settlement[]` transfers. |
| `settleUp(uint256 groupId)` | Members | Execute all settlements via transferFrom in base currency. |
| `getExpense(uint256 groupId, uint256 expenseId)` | View | Expense details. |

**Structs:**
```solidity
struct Settlement {
    address from;
    address to;
    uint256 amount;
}
```

**Events:**
- `ExpenseAdded(uint256 indexed groupId, uint256 expenseId, address paidBy, uint256 amount, string description)`
- `SettledUp(uint256 indexed groupId, Settlement[] transfers)`

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────┐
│               Frontend (React)                   │
│  • Dynamic JS SDK (email login, embedded wallet) │
│  • Group dashboard                               │
│  • Pot: deposit, request, approve                │
│  • Split: log expense, view balances, settle     │
│  • FX: deposit in USDC or EURC, auto-convert     │
└──────────────────┬───────────────────────────────┘
                   │ ethers.js / viem
                   │
┌──────────────────▼───────────────────────────────┐
│              Arc Testnet (EVM)                   │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │             GroupPot.sol                    │  │
│  │  • createGroup(baseCurrency: USDC|EURC)    │  │
│  │  • deposit(USDC or EURC → auto FX)         │  │
│  │  • requestReimbursement()                  │  │
│  │  • approveRequest() → auto-release         │  │
│  │  • updateRate() (USDC↔EURC)                │  │
│  │  • voteWithdraw()                          │  │
│  └─────────────────────┬──────────────────────┘  │
│                        │ isMember()              │
│  ┌─────────────────────▼──────────────────────┐  │
│  │           SplitSettler.sol                 │  │
│  │  • addExpense()                            │  │
│  │  • getBalances()                           │  │
│  │  • settleUp() (approve-pull in base ccy)   │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  USDC: 0x3600000000000000000000000000000000000000 │
│  EURC: 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a│
│  Both 6 decimals (ERC-20 interface)              │
└──────────────────────────────────────────────────┘

Phase 2 (Uniswap):
┌────────────┐  ┌─────────┐
│ Uniswap API│  │  CCTP   │  Any token on Sepolia → USDC → bridge → Arc
│ (Sepolia)  │──▶(bridge) │──▶ deposit() or settleUp()
└────────────┘  └─────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Chain** | Arc Testnet (Chain ID: `5042002`, RPC: `https://rpc.testnet.arc.network`) |
| **Smart Contracts** | Solidity 0.8.30, Foundry |
| **Frontend** | React (Next.js or Vite) |
| **Auth / Wallets** | Dynamic JS SDK (`@dynamic-labs/sdk-react-core` + `@dynamic-labs/ethereum`) |
| **Stablecoins** | USDC + EURC on Arc (both 6 decimals via ERC-20) |
| **Faucet** | `https://faucet.circle.com` (select Arc Testnet, request both USDC and EURC) |
| **Explorer** | `https://testnet.arcscan.app` |

---

## Frontend Pages

### Page 1: Landing / Auth
- Dynamic SDK login (email, social, or wallet)
- After login → redirect to dashboard

### Page 2: Dashboard
- List of user's groups
- Each group card: name, member count, pot balance (with currency symbol), pending requests count
- "Create Group" button

### Page 3: Group Detail (tabbed)

**Tab: Pot**
- Pot balance + funding goal progress bar (denominated in base currency)
- Per-member contribution breakdown
- Currency indicator (USDC or EURC)
- "Deposit" button:
  - Amount input
  - Currency selector (USDC or EURC)
  - If depositing non-base currency, show conversion preview (e.g., "100 EURC ≈ 108.70 USDC at current rate")
- Pending reimbursement requests:
  - Requester, amount, description, approval progress (e.g., "1/2 approvals")
  - "Approve" button (disabled if you're the requester or already approved)
- "Request Reimbursement" button → form: amount + description
- Past approved reimbursements log

**Tab: Split**
- Expense log (chronological)
- "Add Expense" form: amount (in base currency), description, split among (checkboxes)
- Net balance summary: who owes whom
- "Settle Up" button → preview transfers → execute
- Settlement history

**Tab: Members**
- Member list with addresses
- Invite link / share button
- Per-member pot contribution

---

## Arc-Specific Notes

### Network Config
```
Network:   Arc Testnet
RPC:       https://rpc.testnet.arc.network
Chain ID:  5042002
Gas Token: USDC (native, 18 decimals)
Explorer:  https://testnet.arcscan.app
Faucet:    https://faucet.circle.com
```

### Token Addresses
```
USDC (ERC-20): 0x3600000000000000000000000000000000000000  (6 decimals)
EURC (ERC-20): 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a  (6 decimals)
Permit2:       0x000000000022D473030F116dDEE9F6B43aC78BA3
```

**Critical decimal note:** Arc uses USDC as native gas with 18 decimals. The ERC-20 interface for both USDC and EURC uses 6 decimals. Always use the ERC-20 interface for contract interactions (`approve`, `transferFrom`, `balanceOf`). Never mix native 18-decimal values with ERC-20 6-decimal values.

### CCTP (for Phase 2 bridging)
```
TokenMessengerV2:     0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
MessageTransmitterV2: 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
Arc Domain:           26
```

### StableFX Note
Circle's StableFX is an institutional-grade FX engine on Arc but requires permissioned access (KYB/AML). We implement our own lightweight FX conversion in the smart contract using a configurable rate. In production, this could be replaced with a StableFX integration or a Chainlink price feed.

### Deployment
```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
forge init split-settle && cd split-settle

# Deploy GroupPot
forge create src/GroupPot.sol:GroupPot \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a \
    920000 \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $PRIVATE_KEY \
  --broadcast

# Deploy SplitSettler (pass USDC, EURC, and GroupPot address)
forge create src/SplitSettler.sol:SplitSettler \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a \
    <GROUP_POT_ADDRESS> \
  --rpc-url https://rpc.testnet.arc.network \
  --private-key $PRIVATE_KEY \
  --broadcast
```

---

## Dynamic Integration

- **Docs:** `https://www.dynamic.xyz/docs/javascript/introduction/welcome`
- Use `@dynamic-labs/sdk-react-core` + `@dynamic-labs/ethereum`
- Add Arc Testnet as custom EVM network via `evmNetworks` prop (Chain ID `5042002`, RPC `https://rpc.testnet.arc.network`)
- Enable email + social login
- Embedded wallets auto-created on signup
- Dynamic is an official Arc ecosystem partner

---

## Submission Requirements

### Arc
- Functional MVP with frontend + backend + architecture diagram
- Video demo + presentation outlining use of Circle/Arc developer tools
- GitHub repo link

### Uniswap Foundation (Phase 2)
- Transaction IDs showing real on-chain swap execution (testnet or mainnet)
- Public GitHub with README
- Demo link or setup instructions
- Demo video (max 3 min)
- Completed feedback form: `https://developers.uniswap.org/feedback`

### Dynamic
- Uses Dynamic JS SDK (any framework)
- App must be deployed and usable by judges

---

## Build Priority

| Priority | Component | Est. Time |
|----------|-----------|-----------|
| **P0** | GroupPot.sol (deposit w/ FX, request, approve, release) | ~6 hrs |
| **P0** | Dynamic auth + Arc network setup | ~2 hrs |
| **P0** | Group creation + join + pot deposit UI (with currency selector) | ~3 hrs |
| **P0** | Request reimbursement + approval UI | ~3 hrs |
| **P1** | SplitSettler.sol (ad-hoc expenses + settle) | ~4 hrs |
| **P1** | Split mode UI (add expense, balances, settle up) | ~3 hrs |
| **P2** | Uniswap swap + CCTP bridge flow (Phase 2) | ~5 hrs |
| **P2** | Yield farming integration for idle pot funds | ~4 hrs |
| **P2** | Architecture diagram + demo video | ~2 hrs |
| **P2** | Polish, error handling, mobile responsiveness | ~2 hrs |

**P0: ~14 hrs | P1: ~7 hrs | P2: ~13 hrs**

Ship P0 first (pot mode + FX + Dynamic). Then P1 (split mode). Then P2 (Uniswap) if time allows.