import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import {
  createPublicClient,
  http,
  defineChain,
  verifyMessage,
  parseAbi,
} from "viem";
import ratePusher from "./plugins/ratePusher";

const app = Fastify({ logger: true });

app.register(cors);
app.register(ratePusher);

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

const GROUP_POT_ADDRESS = "0xFe48DA5dE72879F7c7897aEb48D3D9450d025153";
const GROUP_POT_ABI = parseAbi([
  "function isMember(uint256 groupId, address user) view returns (bool)",
]);

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Verify the caller is a member of the group.
 * Expects headers:
 *   x-address:   wallet address
 *   x-signature: signature of "settly:<groupId>:<timestamp>"
 *   x-timestamp: unix-ms timestamp used in the signed message
 */
async function verifyMembership(
  groupId: string,
  headers: Record<string, string | string[] | undefined>
): Promise<{ ok: true; address: string } | { ok: false; error: string; status: number }> {
  const address = headers["x-address"] as string | undefined;
  const signature = headers["x-signature"] as string | undefined;
  const timestamp = headers["x-timestamp"] as string | undefined;

  if (!address || !signature || !timestamp) {
    return { ok: false, status: 401, error: "Missing auth headers (x-address, x-signature, x-timestamp)" };
  }

  // Check timestamp freshness
  const ts = Number(timestamp);
  if (Number.isNaN(ts) || Math.abs(Date.now() - ts) > MAX_SIGNATURE_AGE_MS) {
    return { ok: false, status: 401, error: "Signature expired or invalid timestamp" };
  }

  // Verify signature
  const message = `settly:${groupId}:${timestamp}`;
  const valid = await verifyMessage({
    address: address as `0x${string}`,
    message,
    signature: signature as `0x${string}`,
  });
  if (!valid) {
    return { ok: false, status: 401, error: "Invalid signature" };
  }

  // Check on-chain membership
  const isMember = await publicClient.readContract({
    address: GROUP_POT_ADDRESS,
    abi: GROUP_POT_ABI,
    functionName: "isMember",
    args: [BigInt(groupId), address as `0x${string}`],
  });
  if (!isMember) {
    return { ok: false, status: 403, error: "Not a member of this group" };
  }

  return { ok: true, address };
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

const start = async () => {
  const port = Number(process.env.PORT) || 3000;
  await app.listen({ port, host: "0.0.0.0" });
};

start();
