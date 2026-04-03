# Joint Account

A shared on-chain wallet for couples. Built with React Native (Expo) and Solidity (Foundry).

Each partner authenticates via Dynamic, creates their own embedded wallet, and links it to a joint account smart contract.

## Project Structure

```
├── app/                            # React Native mobile app
│   ├── App.tsx                     # Root — navigation + session routing
│   ├── index.ts                    # Entry point with polyfills
│   ├── src/
│   │   ├── dynamic-client.ts       # Dynamic SDK client config
│   │   ├── types.ts                # Navigation + state types
│   │   ├── hooks/
│   │   │   ├── useDynamic.ts       # Reactive hook for Dynamic client
│   │   │   └── useAccountStatus.ts # Joint account state machine
│   │   └── screens/
│   │       ├── LoginScreen.tsx     # Authentication
│   │       ├── WalletSetupScreen.tsx # Wallet creation
│   │       ├── SoloScreen.tsx      # Invite or join a partner
│   │       ├── PendingScreen.tsx   # Waiting for partner
│   │       └── DashboardScreen.tsx # Active joint account
│   └── ...
├── server/                         # Fastify backend API
│   ├── src/index.ts                # Entry point
│   └── tsconfig.json
├── contracts/                      # Foundry smart contracts
│   ├── src/JointAccount.sol        # Joint account contract
│   ├── test/JointAccount.t.sol     # Contract tests
│   ├── script/JointAccount.s.sol   # Deploy script
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

Server runs at `http://localhost:3000`. Health check: `GET /health`.

### Smart Contracts

```bash
cd contracts
forge build
forge test
```

## Tech Stack

- **Mobile:** Expo (SDK 54), React Native 0.81, Dynamic (v4), NativeWind, React Navigation
- **Backend:** Fastify, TypeScript
- **Contracts:** Solidity 0.8.24, Foundry
