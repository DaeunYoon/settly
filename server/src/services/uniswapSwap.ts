/**
 * Uniswap Trading API integration for Base Sepolia
 *
 * Executes REAL on-chain swaps via Uniswap Trading API on Base Sepolia testnet.
 * Generates verifiable transaction IDs for Uniswap prize submission.
 *
 * API docs: https://api-docs.uniswap.org/guides/swapping
 * Developer dashboard: https://developers.uniswap.org/dashboard
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  type WalletClient,
  type PublicClient,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─── Base Sepolia Chain Config ──────────────────────────────

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },
  },
});

// ─── Uniswap Trading API ────────────────────────────────────

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

export type UniswapQuote = {
  quote: {
    methodParameters: {
      calldata: Hex;
      value: string;
      to: string;
    };
    quote: string;
    quoteDecimals: string;
    quoteGasAdjusted: string;
    gasUseEstimate: string;
    route: unknown[];
  };
  routing: string;
  permitData?: unknown;
};

export type SwapResult = {
  txHash: Hex;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  explorerUrl: string;
};

let walletClient: WalletClient | null = null;
let publicClient: PublicClient | null = null;

function getClients() {
  if (!walletClient || !publicClient) {
    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
    const privateKey = process.env.YIELD_PRIVATE_KEY || process.env.RATE_PUSHER_PRIVATE_KEY;
    if (!privateKey) throw new Error("YIELD_PRIVATE_KEY or RATE_PUSHER_PRIVATE_KEY required");

    const account = privateKeyToAccount(privateKey as Hex);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
    publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(rpcUrl),
    });
  }
  return { walletClient: walletClient!, publicClient: publicClient! };
}

function getApiKey(): string {
  const key = process.env.UNISWAP_API_KEY;
  if (!key) throw new Error("UNISWAP_API_KEY required (from developers.uniswap.org/dashboard)");
  return key;
}

/**
 * Get a swap quote from Uniswap Trading API
 */
export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amount: string, // raw amount in smallest unit
  swapper: string,
): Promise<UniswapQuote> {
  const apiKey = getApiKey();

  const body = {
    type: "EXACT_INPUT",
    tokenInChainId: baseSepolia.id,
    tokenOutChainId: baseSepolia.id,
    tokenIn,
    tokenOut,
    amount,
    swapper,
    slippageTolerance: 0.5, // 0.5%
  };

  const res = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uniswap quote failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<UniswapQuote>;
}

/**
 * Check if token approval is needed for Uniswap's Permit2
 */
export async function checkApproval(
  token: string,
  amount: string,
  walletAddress: string,
): Promise<{ approvalNeeded: boolean; txRequest?: { to: string; data: Hex } }> {
  const apiKey = getApiKey();

  const body = {
    token,
    amount,
    walletAddress,
    chainId: baseSepolia.id,
  };

  const res = await fetch(`${UNISWAP_API_BASE}/check_approval`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Uniswap check_approval failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    approvalNeeded: !!data.approval,
    txRequest: data.approval
      ? { to: data.approval.to, data: data.approval.data }
      : undefined,
  };
}

/**
 * Execute a Uniswap swap on Base Sepolia
 * Returns a real on-chain transaction hash
 */
export async function executeSwap(
  tokenIn: string,
  tokenOut: string,
  amount: string,
): Promise<SwapResult> {
  const { walletClient, publicClient } = getClients();
  const swapper = walletClient.account!.address;

  // 1. Check approval
  const approval = await checkApproval(tokenIn, amount, swapper);
  if (approval.approvalNeeded && approval.txRequest) {
    const approvalHash = await walletClient.sendTransaction({
      to: approval.txRequest.to as Hex,
      data: approval.txRequest.data,
      chain: baseSepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
  }

  // 2. Get quote with execution calldata
  const quote = await getQuote(tokenIn, tokenOut, amount, swapper);

  if (!quote.quote.methodParameters) {
    throw new Error("Quote did not return method parameters for execution");
  }

  // 3. Execute the swap
  const { calldata, value, to } = quote.quote.methodParameters;
  const txHash = await walletClient.sendTransaction({
    to: to as Hex,
    data: calldata,
    value: BigInt(value),
    chain: baseSepolia,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });

  return {
    txHash,
    amountIn: amount,
    amountOut: quote.quote.quote,
    tokenIn,
    tokenOut,
    explorerUrl: `https://sepolia.basescan.org/tx/${txHash}`,
  };
}

/**
 * Get the wallet address used for swaps
 */
export function getSwapperAddress(): string {
  const { walletClient } = getClients();
  return walletClient.account!.address;
}
