import crypto from "node:crypto";
import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  createPublicClient,
  http,
  defineChain,
  parseAbi,
} from "viem";
import ratePusher from "./plugins/ratePusher";
import yieldManager from "./plugins/yieldManager";

const app = Fastify({ logger: true });

app.register(cors);
app.register(ratePusher);
app.register(yieldManager);

// ─── On-chain membership verification ───────────────────────

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
});

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

const GROUP_POT_ADDRESS = "0x2bEe6c4a414147360069cce4B22FFA9f8Bf28f3E";
const GROUP_POT_ABI = parseAbi([
  "function isMember(uint256 groupId, address user) view returns (bool)",
]);

// ─── Dynamic JWT verification ──────────────────────────────

const DYNAMIC_ENV_ID = process.env.DYNAMIC_ENVIRONMENT_ID!;
const JWKS = createRemoteJWKSet(
  new URL(`https://app.dynamic.xyz/api/v0/sdk/${DYNAMIC_ENV_ID}/.well-known/jwks`)
);

async function verifyAuthToken(
  headers: Record<string, string | string[] | undefined>
): Promise<{ ok: true; address: string } | { ok: false; error: string; status: number }> {
  const authHeader = headers["authorization"] as string | undefined;
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing or invalid Authorization header" };
  }

  try {
    const { payload } = await jwtVerify(authHeader.slice(7), JWKS);
    const creds = payload.verified_credentials as Array<{ address?: string; chain?: string; wallet_name?: string; format?: string; lastSelectedAt?: string }> | undefined;
    // Pick the most recently selected EVM wallet
    const evmCreds = creds?.filter((c) => c.format === "blockchain" && c.address?.startsWith("0x")) ?? [];
    const evmCred = evmCreds.sort((a, b) =>
      new Date(b.lastSelectedAt ?? 0).getTime() - new Date(a.lastSelectedAt ?? 0).getTime()
    )[0];
    const address = evmCred?.address ?? (payload.wallet_address as string | undefined);
    if (!address) {
      return { ok: false, status: 401, error: "No wallet address in token" };
    }
    return { ok: true, address };
  } catch {
    return { ok: false, status: 401, error: "Invalid or expired token" };
  }
}

async function verifyMembership(
  groupId: string,
  headers: Record<string, string | string[] | undefined>
): Promise<{ ok: true; address: string } | { ok: false; error: string; status: number }> {
  const auth = await verifyAuthToken(headers);
  if (!auth.ok) return auth;

  const isMember = await publicClient.readContract({
    address: GROUP_POT_ADDRESS,
    abi: GROUP_POT_ABI,
    functionName: "isMember",
    args: [BigInt(groupId), auth.address as `0x${string}`],
  });
  if (!isMember) {
    return { ok: false, status: 403, error: "Not a member of this group" };
  }

  return { ok: true, address: auth.address };
}

app.get("/health", async () => {
  return { status: "ok" };
});

// ─── Invite Code Store (in-memory) ──────────────────────────

const inviteCodes = new Map<string, string>(); // groupId -> inviteCode

app.put<{ Params: { groupId: string }; Body: { code: string } }>(
  "/api/invite/:groupId",
  async (request, reply) => {
    const { groupId } = request.params;
    const auth = await verifyMembership(groupId, request.headers);
    if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

    const { code } = request.body;
    if (!code) return reply.status(400).send({ error: "code is required" });
    inviteCodes.set(groupId, code);
    return { status: "ok" };
  }
);

app.get<{ Params: { groupId: string } }>(
  "/api/invite/:groupId",
  async (request, reply) => {
    const { groupId } = request.params;
    const auth = await verifyMembership(groupId, request.headers);
    if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

    const code = inviteCodes.get(groupId);
    if (!code) return reply.status(404).send({ error: "no invite code set" });
    return { code };
  }
);

app.delete<{ Params: { groupId: string } }>(
  "/api/invite/:groupId",
  async (request, reply) => {
    const { groupId } = request.params;
    const auth = await verifyMembership(groupId, request.headers);
    if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

    inviteCodes.delete(groupId);
    return { status: "ok" };
  }
);

// ─── Invite Token Store (short-lived, single-use) ──────────

type InviteToken = { groupId: string; inviteCode: string; expiresAt: number };
const inviteTokens = new Map<string, InviteToken>();
// Long-poll watchers: token -> list of resolve callbacks
const tokenWatchers = new Map<string, Set<() => void>>();
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cleanup expired tokens every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [token, entry] of inviteTokens) {
    if (now > entry.expiresAt) {
      inviteTokens.delete(token);
      tokenWatchers.delete(token);
    }
  }
}, 5 * 60 * 1000);

app.post<{ Body: { groupId: string } }>(
  "/api/invite-token",
  async (request, reply) => {
    const { groupId } = request.body;
    if (!groupId) return reply.status(400).send({ error: "groupId is required" });

    const auth = await verifyMembership(groupId, request.headers);
    if (!auth.ok) return reply.status(auth.status).send({ error: auth.error });

    const inviteCode = inviteCodes.get(groupId);
    if (!inviteCode) return reply.status(404).send({ error: "no invite code set for this group" });

    const token = crypto.randomUUID();
    inviteTokens.set(token, {
      groupId,
      inviteCode,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });

    app.log.info({ token, groupId, totalTokens: inviteTokens.size }, "Token created");
    return { token };
  }
);

app.get<{ Params: { token: string } }>(
  "/api/invite-token/:token",
  async (request, reply) => {
    const { token } = request.params;
    app.log.info({ token, exists: inviteTokens.has(token), totalTokens: inviteTokens.size }, "Token resolve attempt");
    const entry = inviteTokens.get(token);

    if (!entry || Date.now() > entry.expiresAt) {
      inviteTokens.delete(token);
      return reply.status(404).send({ error: "Invalid or expired invite link" });
    }

    // TODO: re-enable single-use for production
    // inviteTokens.delete(token);

    return { groupId: entry.groupId, inviteCode: entry.inviteCode };
  }
);

// Long-poll endpoint: blocks until the token is consumed or times out
app.get<{ Params: { token: string } }>(
  "/api/invite-token/:token/watch",
  async (request, reply) => {
    const { token } = request.params;
    if (!inviteTokens.has(token)) {
      return { event: "consumed" };
    }

    const TIMEOUT_MS = 30_000;
    const result = await new Promise<"consumed" | "timeout">((resolve) => {
      const timer = setTimeout(() => {
        tokenWatchers.get(token)?.delete(onConsumed);
        resolve("timeout");
      }, TIMEOUT_MS);

      const onConsumed = () => {
        clearTimeout(timer);
        resolve("consumed");
      };

      if (!tokenWatchers.has(token)) tokenWatchers.set(token, new Set());
      tokenWatchers.get(token)!.add(onConsumed);

      request.raw.on("close", () => {
        clearTimeout(timer);
        tokenWatchers.get(token)?.delete(onConsumed);
      });
    });

    return { event: result };
  }
);

const start = async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: "0.0.0.0" });
};

start();
