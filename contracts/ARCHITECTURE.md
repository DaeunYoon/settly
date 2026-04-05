# Contract Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User / Server                            │
└──────┬──────────────┬──────────────────┬────────────────────────┘
       │              │                  │
       ▼              ▼                  ▼
┌────────────┐ ┌──────────────┐ ┌────────────────────┐
│  GroupPot   │ │ SplitSettler │ │ YieldManager (Arc)  │
│  (Arc)      │ │ (Arc)        │ │                     │
└──────┬──────┘ └──────┬───────┘ └─────────┬──────────┘
       │               │                   │
       │  isMember()   │                   │ bridge
       │  getMembers() │                   │ (simulated)
       │◄──────────────┘                   │
       │                                   ▼
       │  getRate()              ┌──────────────────┐
       ▼                        │ YieldStrategy     │
┌────────────┐                  │ (Base Sepolia)    │
│  FXOracle  │                  └────────┬──────────┘
│  (Arc)     │                           │
└────────────┘                  ┌────────┴──────────┐
                                ▼                   ▼
                         ┌──────────┐        ┌──────────┐
                         │  msUSDS  │        │  msUSDe  │
                         │  Vault   │        │  Vault   │
                         └──────────┘        └──────────┘
```

## Contracts

### GroupPot (Arc Testnet)
Core contract for joint accounts. Manages groups, deposits, reimbursements, and voting.

- `createGroup()` — create group with invite code
- `joinGroup()` — join via invite code
- `deposit()` — contribute USDC or EURC (auto-converted to base currency via FXOracle)
- `requestReimbursement()` / `voteOnRequest()` / `releaseFunds()` — expense flow
- `voteWithdraw()` / `_closePot()` — close group, distribute proportionally
- `bridgeToYield()` / `returnFromYield()` — move funds to/from yield strategies

### FXOracle (Arc Testnet)
USDC/EURC exchange rate provider.

- `updateRate()` — owner sets rate (e.g., 920000 = 0.92 EURC per USDC)
- `getRate()` — called by GroupPot for currency conversion

### SplitSettler (Arc Testnet)
Tracks shared expenses and calculates settlements between members.

- `addExpense()` — record expense paid by one member, split among others
- `getBalances()` — net balances (positive = owed, negative = owes)
- `calculateSettlements()` — optimal settlement plan (greedy algorithm)
- `settle()` — execute peer-to-peer payment

Calls GroupPot for: `isMember()`, `getMembers()`, `getBaseCurrency()`

### YieldManager (Arc Testnet)
Governs yield farming lifecycle: propose, vote, bridge, withdraw.

- `proposeEnableYield()` / `voteEnableYield()` — group votes to enable yield
- `recordBridged()` — record funds bridged to Base Sepolia
- `updateYieldBalance()` — sync current yield value from Base
- `proposeWithdraw()` / `voteWithdraw()` — group votes to withdraw
- `recordWithdrawal()` — record funds returned

### YieldStrategy (Base Sepolia)
Routes deposits into mock yield vaults based on strategy.

- `deposit(amount, strategy, groupId)` — deposit USDC into vaults
- `withdraw(groupId)` — redeem all positions, return USDC
- `getPositionValue()` / `getStrategyBreakdown()` — read current value
- `advanceAllYields()` — simulate time passage (demo)

**Strategies:**
| # | Name         | Allocation                |
|---|--------------|---------------------------|
| 0 | Conservative | 100% msUSDS               |
| 1 | Balanced     | 50% msUSDS + 50% msUSDe   |
| 2 | Aggressive   | Same as Conservative (swap disabled) |

## Data Flow

### Deposit & Reimbursement
```
User ──deposit(USDC/EURC)──▶ GroupPot ──getRate()──▶ FXOracle
User ──requestReimbursement──▶ GroupPot
Members ──voteOnRequest──▶ GroupPot ──releaseFunds──▶ User
```

### Expense Splitting
```
User ──addExpense──▶ SplitSettler ──isMember()──▶ GroupPot
User ──settle──▶ SplitSettler (peer-to-peer transfer)
```

### Yield Farming
```
Vote passes on Arc ──▶ Server bridges funds (simulated)
Server ──deposit──▶ YieldStrategy ──▶ msUSDS / msUSDe vaults
Server ──withdraw──▶ YieldStrategy ──▶ USDC back to pocket
Server ──returnFromYield──▶ GroupPot (Arc)
```
