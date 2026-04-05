/**
 * Uniswap Trading API integration for Ethereum Sepolia
 *
 * Executes REAL on-chain swaps via Uniswap Trading API on Ethereum Sepolia testnet.
 * Uses the Permit2 flow: quote → sign permit → swap.
 *
 * API docs: https://api-docs.uniswap.org/guides/swapping
 * Developer dashboard: https://developers.uniswap.org/dashboard
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  defineChain,
  parseAbi,
  type PublicClient,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";


export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"] },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },  },
});

// Base Sepolia token addresses
const BASE_SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const BASE_SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// ─── Uniswap Trading API ────────────────────────────────────

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";

export type SwapResult = {
  txHash: Hex;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  explorerUrl: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let walletClient: any = null;
let publicClient: PublicClient | null = null;

function getClients() {
  if (!walletClient || !publicClient) {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/demo";
    const privateKey = process.env.YIELD_PRIVATE_KEY || process.env.RATE_PUSHER_PRIVATE_KEY;
    if (!privateKey) throw new Error("YIELD_PRIVATE_KEY or RATE_PUSHER_PRIVATE_KEY required");

    const account = privateKeyToAccount(privateKey as Hex);
    walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(rpcUrl),
    });
    publicClient = createPublicClient({
      chain: sepolia,
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
 * Ensure the token has approved Permit2 to spend on behalf of the wallet.
 */
async function ensurePermit2Approval(token: Hex, amount: bigint) {
  const { walletClient, publicClient } = getClients();
  const owner = walletClient.account!.address;

  const allowance = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [owner, PERMIT2_ADDRESS],
  });

  if (allowance < amount) {
    console.log("[uniswapSwap] Approving Permit2 for token", token);
    const hash = await walletClient.writeContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [PERMIT2_ADDRESS, BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")],
      chain: sepolia,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log("[uniswapSwap] Permit2 approval tx:", hash);
  }
}

/**
 * Execute a Uniswap swap on Ethereum Sepolia using the Permit2 flow:
 * 1. Approve Permit2 (if needed)
 * 2. Get quote (returns permitData for signing)
 * 3. Sign the Permit2 typed data
 * 4. POST /swap with signature to get the swap transaction
 * 5. Execute the swap transaction on-chain
 */
export async function executeSwap(
  _tokenIn: string,
  _tokenOut: string,
  amount: string,
): Promise<SwapResult> {
  const { walletClient, publicClient } = getClients();
  const swapper = walletClient.account!.address;
  const apiKey = getApiKey();

  const baseSepoliaTokenIn = BASE_SEPOLIA_USDC;
  const baseSepoliaTokenOut = BASE_SEPOLIA_WETH;

  // 1. Ensure Permit2 has token approval
  await ensurePermit2Approval(baseSepoliaTokenIn as Hex, BigInt(amount));

  // 2. Get quote
  console.log("[uniswapSwap] Getting quote...");
  const quoteRes = await fetch(`${UNISWAP_API_BASE}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      type: "EXACT_INPUT",
      tokenInChainId: baseSepolia.id,
      tokenOutChainId: baseSepolia.id,
      tokenIn: baseSepoliaTokenIn,
      tokenOut: baseSepoliaTokenOut,
      amount,
      swapper,
      slippageTolerance: 15, // 15% — testnet pools have low liquidity
    }),
  });

  if (!quoteRes.ok) {
    const text = await quoteRes.text();
    throw new Error(`Uniswap quote failed (${quoteRes.status}): ${text}`);
  }

  const quoteData: any = await quoteRes.json();
  const outputAmount = quoteData.quote?.output?.amount || quoteData.quote?.quote || amount;
  const quoteId = quoteData.quote?.quoteId;
  console.log("[uniswapSwap] Quote received, quoteId:", quoteId, "output:", outputAmount);

  // 3. Sign Permit2 data if present
  let signature: string | undefined;
  if (quoteData.permitData) {
    const { domain, types, values } = quoteData.permitData;
    console.log("[uniswapSwap] Signing Permit2 data...");
    signature = await walletClient.signTypedData({
      domain: {
        name: domain.name,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract as Hex,
      },
      types,
      primaryType: "PermitSingle",
      message: values,
    });
    console.log("[uniswapSwap] Permit2 signature obtained");
  }

  // 4. Call /swap to get the transaction
  console.log("[uniswapSwap] Calling /swap endpoint...");
  const swapBody: Record<string, unknown> = {
    quote: quoteData.quote,
    permitData: quoteData.permitData || undefined,
    signature: signature || undefined,
  };

  const swapRes = await fetch(`${UNISWAP_API_BASE}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(swapBody),
  });

  if (!swapRes.ok) {
    const text = await swapRes.text();
    throw new Error(`Uniswap swap request failed (${swapRes.status}): ${text}`);
  }

  const swapData: any = await swapRes.json();
  console.log("[uniswapSwap] Swap response received, has swap:", !!swapData.swap);

  if (!swapData.swap) {
    throw new Error("Uniswap /swap did not return transaction data");
  }

  // 5. Execute the swap transaction
  const { to, data, value } = swapData.swap;
  console.log("[uniswapSwap] Sending swap tx to:", to);
  const txHash = await walletClient.sendTransaction({
    to: to as Hex,
    data: data as Hex,
    value: value ? BigInt(value) : 0n,
    chain: baseSepolia,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("[uniswapSwap] Swap confirmed:", txHash);

  return {
    txHash,
    amountIn: amount,
    amountOut: outputAmount,
    tokenIn: baseSepoliaTokenIn,
    tokenOut: baseSepoliaTokenOut,
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
