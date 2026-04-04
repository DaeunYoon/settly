# Settly

A group expense app on **Arc** (Circle's L1 blockchain). Groups manage shared money in two modes:

- **Pot mode** — members pre-fund a shared pot in USDC or EURC, then request reimbursements that other members approve before funds are released
- **Split mode** — someone pays ad-hoc, logs the expense, and the app settles debts directly between wallets via approve-pull

Both modes coexist within the same group. The contract handles USDC ↔ EURC conversion automatically.

## Project Structure

```
├── app/                            # React Native mobile app (Expo)
│   ├── App.tsx                     # Root — navigation + session routing
│   ├── index.ts                    # Entry point with polyfills
│   ├── src/
│   │   ├── dynamic-client.ts       # Dynamic SDK client config
│   │   ├── types.ts                # Navigation types
│   │   ├── hooks/
│   │   │   └── useDynamic.ts       # Reactive hook for Dynamic client
│   │   └── screens/
│   │       ├── LoginScreen.tsx     # Authentication
│   │       ├── WalletSetupScreen.tsx # Wallet creation
│   │       └── HomeScreen.tsx      # Post-login landing
├── server/                         # Fastify backend API
│   ├── src/index.ts
│   └── tsconfig.json
├── contracts/                      # Foundry smart contracts
│   ├── src/                        # GroupPot.sol, SplitSettler.sol
│   ├── test/
│   ├── script/
│   ├── lib/                        # Git submodules (forge-std, openzeppelin)
│   └── foundry.toml
└── README.md
```

## Prerequisites

- Node.js 18+
- [Expo CLI](https://docs.expo.dev/get-started/installation/)
- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- A [Dynamic](https://www.dynamic.xyz/) account with an environment ID
- Xcode (for iOS) or Android Studio (for Android)

> **Note:** The mobile app uses native modules and is **not compatible with Expo Go**. You must use a development build.

## Getting Started

### Mobile App

```bash
cd app
npm install
cp .env.example .env
# Edit .env with your Dynamic environment ID
npx expo prebuild
npx expo run:ios     # or npx expo run:android
```

Find your environment ID in the [Dynamic Dashboard](https://app.dynamic.xyz/) under Developer → SDK & API Keys. Also enable **Embedded Wallets** for EVM chains in the dashboard.

### Backend

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

Server runs at `http://localhost:3000`.

**Endpoints:**
- `GET /health` — health check
- `GET /api/rate` — current FX rate
- `POST /api/rate/refresh` — force rate push to FXOracle
- `PUT /api/invite/:groupId` — store invite code `{ "code": "abc123" }`
- `GET /api/invite/:groupId` — get invite code
- `DELETE /api/invite/:groupId` — delete invite code (lock group)

### Smart Contracts

```bash
cd contracts
git submodule update --init --recursive
forge build
forge test
```

### Deployment (Arc Testnet)

```bash
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

## Arc Testnet

| | |
|---|---|
| **RPC** | `https://rpc.testnet.arc.network` |
| **Chain ID** | `5042002` |
| **Explorer** | `https://testnet.arcscan.app` |
| **Faucet** | `https://faucet.circle.com` |
| **USDC (ERC-20)** | `0x3600000000000000000000000000000000000000` (6 decimals) |
| **EURC (ERC-20)** | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` (6 decimals) |

> **Decimal note:** Arc uses USDC as native gas with 18 decimals. The ERC-20 interface for both USDC and EURC uses 6 decimals. Always use the ERC-20 interface for contract interactions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Chain** | Arc Testnet |
| **Smart Contracts** | Solidity 0.8.24, Foundry |
| **Mobile** | Expo (SDK 54), React Native 0.81, NativeWind, React Navigation |
| **Auth / Wallets** | Dynamic JS SDK |
| **Backend** | Fastify, TypeScript |
| **Stablecoins** | USDC + EURC on Arc |
