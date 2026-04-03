import fp from "fastify-plugin";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const FX_ORACLE_ABI = parseAbi([
  "function updateRate(uint256 newRate) external",
  "function usdcToEurcRate() view returns (uint256)",
  "function rateLastUpdated() view returns (uint256)",
]);

const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
};

async function fetchEurUsdRate(): Promise<number> {
  const res = await fetch(
    "https://api.frankfurter.app/latest?from=USD&to=EUR"
  );
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
  const data = (await res.json()) as { rates: { EUR: number } };
  return data.rates.EUR;
}

function rateToContractFormat(eurPerUsd: number): bigint {
  return BigInt(Math.round(eurPerUsd * 1_000_000));
}

export default fp(async function ratePusher(fastify) {
  const privateKey = process.env.RATE_PUSHER_PRIVATE_KEY;
  const oracleAddress = process.env.FX_ORACLE_ADDRESS;

  if (!privateKey || !oracleAddress) {
    fastify.log.warn(
      "RATE_PUSHER_PRIVATE_KEY or FX_ORACLE_ADDRESS not set, rate pusher disabled"
    );
    return;
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(),
  });
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(),
  });

  let lastPushedRate = 0n;

  async function pushRate() {
    try {
      const eurPerUsd = await fetchEurUsdRate();
      const newRate = rateToContractFormat(eurPerUsd);

      // Skip if rate hasn't changed significantly (< 0.1%)
      if (lastPushedRate > 0n) {
        const diff =
          lastPushedRate > newRate
            ? lastPushedRate - newRate
            : newRate - lastPushedRate;
        if (diff * 1000n < lastPushedRate) {
          fastify.log.info(`Rate unchanged (${newRate}), skipping`);
          return;
        }
      }

      const hash = await walletClient.writeContract({
        address: oracleAddress as `0x${string}`,
        abi: FX_ORACLE_ABI,
        functionName: "updateRate",
        args: [newRate],
      });

      await publicClient.waitForTransactionReceipt({ hash });

      lastPushedRate = newRate;
      fastify.log.info(
        `Rate pushed: ${newRate} (1 USDC = ${eurPerUsd} EURC), tx: ${hash}`
      );
    } catch (err) {
      fastify.log.error(err, "Rate push failed");
    }
  }

  // Push on startup
  await pushRate();

  // Push every 15 minutes
  const interval = setInterval(pushRate, 15 * 60 * 1000);

  fastify.addHook("onClose", () => clearInterval(interval));

  fastify.post("/api/rate/refresh", async () => {
    await pushRate();
    return { status: "ok", rate: Number(lastPushedRate) };
  });

  fastify.get("/api/rate", async () => {
    return {
      rate: Number(lastPushedRate),
      rateFormatted: Number(lastPushedRate) / 1_000_000,
      source: "frankfurter.app (ECB)",
    };
  });
});
