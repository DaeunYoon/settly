import { createPublicClient, http, defineChain } from "viem";
import { dynamicClient } from "./dynamic-client";

export const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
  blockExplorers: {
    default: { name: "ArcScan", url: "https://testnet.arcscan.app" },
  },
});

let publicClient: ReturnType<typeof createPublicClient> | null = null;

export function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(),
    });
  }
  return publicClient;
}

export async function getWalletClient() {
  const wallet = dynamicClient.wallets.primary;
  if (!wallet) throw new Error("No wallet connected");
  return dynamicClient.viem.createWalletClient({
    wallet,
    chain: arcTestnet,
  });
}
