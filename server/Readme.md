# Server

Fastify API server for the joint-account app. Handles invite code management, short-lived invite tokens, and pushes FX rates on-chain.

All invite codes and tokens are stored **in-memory** and lost on restart.

## Getting Started

```bash
npm install
cp .env.example .env   # fill in values
npm run dev             # starts dev server with hot reload
```

**Scripts:**

| Command         | Description                        |
|-----------------|------------------------------------|
| `npm run dev`   | Start dev server (tsx watch)       |
| `npm run build` | Compile TypeScript                 |
| `npm start`     | Run compiled output (`dist/`)      |

## API Routes

All `/api/invite` routes require a `Bearer` JWT from Dynamic and on-chain group membership.

| Method   | Path                       | Auth     | Description                                      |
|----------|----------------------------|----------|--------------------------------------------------|
| `GET`    | `/health`                  | None     | Health check                                     |
| `PUT`    | `/api/invite/:groupId`     | Member   | Save an invite code for a group                  |
| `GET`    | `/api/invite/:groupId`     | Member   | Get the stored invite code                       |
| `DELETE` | `/api/invite/:groupId`     | Member   | Delete the invite code (lock the group)          |
| `POST`   | `/api/invite-token`        | Member   | Create a short-lived, single-use invite token    |
| `GET`    | `/api/invite-token/:token` | None     | Resolve an invite token (single-use, expires 24h)|

## Environment Variables

| Variable                   | Required | Description                                              |
|----------------------------|----------|----------------------------------------------------------|
| `PORT`                     | No       | Server port (default: `3000`)                            |
| `DYNAMIC_ENVIRONMENT_ID`   | Yes      | Dynamic environment ID for JWT verification              |
| `RATE_PUSHER_PRIVATE_KEY`  | No       | Private key for the FX rate pusher wallet                |
| `FX_ORACLE_ADDRESS`        | No       | FXOracle contract address on Arc testnet                 |
