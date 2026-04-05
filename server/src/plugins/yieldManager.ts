import fp from "fastify-plugin";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  formatUnits,
  type Chain,
  type Hex,
} from "viem";
import { privateKeyToAccount, nonceManager } from "viem/accounts";
import { executeSwap } from "../services/uniswapSwap";
import { baseSepolia } from "../services/uniswapSwap";

// ─── ABIs ───────────────────────────────────────────────────

const YIELD_MANAGER_ABI = parseAbi([
  "function proposeEnableYield(uint256 groupId, uint8 strategy)",
  "function voteEnableYield(uint256 groupId, bool approve)",
  "function recordBridged(uint256 groupId, uint256 amount)",
  "function updateYieldBalance(uint256 groupId, uint256 currentValue)",
  "function proposeWithdraw(uint256 groupId)",
  "function voteWithdraw(uint256 groupId, bool approve)",
  "function isWithdrawalApproved(uint256 groupId) view returns (bool)",
  "function recordWithdrawal(uint256 groupId, uint256 returnedAmount)",
  "function getYieldInfo(uint256 groupId) view returns (uint8 strategy, uint8 phase, uint256 bridgedAmount, uint256 currentValue)",
  "function getYieldVotes(uint256 groupId) view returns (uint256 lastUpdated, uint256 enableVoteCount, uint256 withdrawVoteCount, uint256 votesNeeded)",
]);

const YIELD_STRATEGY_ABI = parseAbi([
  "function deposit(uint256 amount, uint8 strategy, uint256 groupId)",
  "function depositWETH(uint256 amount, uint256 groupId)",
  "function withdraw(uint256 groupId) returns (uint256)",
  "function getPositionValue(uint256 groupId) view returns (uint256 deposited, uint256 currentValue, uint256 wethHeld)",
  "function getStrategyBreakdown(uint256 groupId) view returns (uint8 strategy, uint256 msUSDS_value, uint256 msUSDe_value, uint256 weth_value, uint256 totalUsdcValue)",
  "function advanceAllYields(uint256 seconds)",
  "function isPositionActive(uint256 groupId) view returns (bool)",
]);

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

const GROUP_POT_ABI = parseAbi([
  "function getPotInfo(uint256 groupId) view returns (uint256 balance, uint256 fundingGoal, address baseCurrency)",
  "function isMember(uint256 groupId, address user) view returns (bool)",
  "function bridgeToYield(uint256 groupId, address recipient, uint256 amount)",
  "function returnFromYield(uint256 groupId, uint256 amount, address token)",
]);

// ─── Arc Testnet ────────────────────────────────────────────

const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.testnet.arc.network"] },
  },
};

// ─── Plugin ─────────────────────────────────────────────────

export default fp(async function yieldManagerPlugin(fastify) {
  // ── Addresses from env ──
  const YIELD_MANAGER_ADDRESS = process.env.YIELD_MANAGER_ADDRESS as Hex;
  const YIELD_STRATEGY_ADDRESS = process.env.YIELD_STRATEGY_ADDRESS as Hex;
  // Real USDC on Base Sepolia (from Circle faucet) — pocket EOA holds this
  const USDC_BASE_ADDRESS = (process.env.USDC_BASE_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Hex;
  const GROUP_POT_ADDRESS = process.env.GROUP_POT_ADDRESS as Hex;

  if (!YIELD_MANAGER_ADDRESS || !YIELD_STRATEGY_ADDRESS) {
    fastify.log.warn("Yield manager addresses not configured, skipping yield plugin");
    return;
  }

  // Arc operations use the rate pusher / deployer key (also yieldAdmin on GroupPot)
  const arcKey = (process.env.YIELD_PRIVATE_KEY || process.env.RATE_PUSHER_PRIVATE_KEY) as Hex;
  // Base Sepolia operations use the pocket EOA (holds USDC)
  const baseKey = (process.env.USDC_POCKET_PRIVATE_KEY || arcKey) as Hex;

  if (!arcKey) {
    fastify.log.warn("No private key for yield operations, skipping yield plugin");
    return;
  }

  const arcAccount = privateKeyToAccount(arcKey, { nonceManager });
  const baseAccount = privateKeyToAccount(baseKey, { nonceManager });

  // Arc clients
  const arcPublic = createPublicClient({ chain: arcTestnet, transport: http() });
  const arcWallet = createWalletClient({ account: arcAccount, chain: arcTestnet, transport: http() });

  // Base Sepolia clients — uses pocket EOA with USDC
  const baseRpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const basePublic = createPublicClient({ chain: baseSepolia, transport: http(baseRpc) });
  const baseWallet = createWalletClient({ account: baseAccount, chain: baseSepolia, transport: http(baseRpc) });

  // ─── Swap transaction log (for Uniswap prize submission) ──

  const swapTxLog: Array<{
    timestamp: string;
    groupId: string;
    strategy: number;
    txHash: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    explorerUrl: string;
  }> = [];

  // ─── Routes ───────────────────────────────────────────────

  /**
   * POST /api/yield/enable
   * Enable yield farming for a group. Simulates bridge + deposits on Base Sepolia.
   */
  fastify.post<{ Body: { groupId: string; strategy: number } }>(
    "/api/yield/enable",
    async (request, reply) => {
      const { groupId, strategy } = request.body;
      const log = (step: string, data?: Record<string, unknown>) =>
        fastify.log.info({ groupId, strategy, step, ...data }, `[yield/enable] ${step}`);

      let completedStep = "none";
      try {
        if (strategy < 0 || strategy > 2) {
          return reply.status(400).send({ error: "Invalid strategy (0-2)" });
        }

        // Step 1: Check yield is actually enabled on-chain before bridging
        log("1_check_yield_enabled");
        const yieldCheck = await arcPublic.readContract({
          address: YIELD_MANAGER_ADDRESS,
          abi: YIELD_MANAGER_ABI,
          functionName: "getYieldInfo",
          args: [BigInt(groupId)],
        });
        const yieldPhase = Number(yieldCheck[1]); // [1] = phase
        if (yieldPhase < 2) { // Must be EnableApproved (2) or beyond
          log("1_check_yield_enabled:NOT_ENABLED", { phase: yieldPhase });
          return reply.status(400).send({ error: "Yield not enabled on-chain. Vote must pass first." });
        }
        completedStep = "1_check_yield_enabled";

        // Step 2: Read pot balance from Arc
        log("2_read_pot_balance");
        const [balance, , baseCurrency] = await arcPublic.readContract({
          address: GROUP_POT_ADDRESS,
          abi: GROUP_POT_ABI,
          functionName: "getPotInfo",
          args: [BigInt(groupId)],
        });
        log("2_read_pot_balance:OK", { balance: formatUnits(balance, 6), baseCurrency });

        if (balance === 0n) {
          return reply.status(400).send({ error: "Pot is empty" });
        }
        completedStep = "2_read_pot_balance";

        // Step 3: Check pocket EOA has enough USDC on Base BEFORE bridging out
        log("3_check_pocket_balance_base");
        const pocketBalance = await basePublic.readContract({
          address: USDC_BASE_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [baseAccount.address],
        });
        log("3_check_pocket_balance_base:OK", {
          pocketBalance: formatUnits(pocketBalance, 6),
          needed: formatUnits(balance, 6),
        });
        if (pocketBalance < balance) {
          log("3_check_pocket_balance_base:INSUFFICIENT");
          return reply.status(400).send({
            error: `Insufficient USDC on Base Sepolia pocket. Need ${formatUnits(balance, 6)}, have ${formatUnits(pocketBalance, 6)}. Fund via Circle faucet.`,
          });
        }
        completedStep = "3_check_pocket_balance_base";

        // Step 4: Bridge Arc → Base (simulated): pull USDC/EURC from GroupPot to pocket EOA
        // TODO: Replace with real CCTP bridge (TokenMessenger.depositForBurn)
        log("4_bridge_out_arc");
        const bridgeOutHash = await arcWallet.writeContract({
          address: GROUP_POT_ADDRESS,
          abi: GROUP_POT_ABI,
          functionName: "bridgeToYield",
          args: [BigInt(groupId), arcAccount.address, balance],
        });
        await arcPublic.waitForTransactionReceipt({ hash: bridgeOutHash });
        log("4_bridge_out_arc:OK", { tx: bridgeOutHash });
        completedStep = "4_bridge_out_arc";

        // Step 5: Approve YieldStrategy to spend USDC on Base
        log("5_approve_yield_strategy");
        const approveHash = await baseWallet.writeContract({
          address: USDC_BASE_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [YIELD_STRATEGY_ADDRESS, balance],
        });
        await basePublic.waitForTransactionReceipt({ hash: approveHash });
        log("5_approve_yield_strategy:OK", { tx: approveHash });
        completedStep = "5_approve_yield_strategy";

        // Step 6: Deposit into YieldStrategy on Base Sepolia
        log("6_deposit_yield_strategy");
        const depositHash = await baseWallet.writeContract({
          address: YIELD_STRATEGY_ADDRESS,
          abi: YIELD_STRATEGY_ABI,
          functionName: "deposit",
          args: [balance, strategy, BigInt(groupId)],
        });
        await basePublic.waitForTransactionReceipt({ hash: depositHash });
        log("6_deposit_yield_strategy:OK", { tx: depositHash });
        completedStep = "6_deposit_yield_strategy";

        // Step 7: Aggressive strategy — swap half to WETH via Uniswap
        if (strategy === 2) {
          log("7_uniswap_swap");
          try {
            const wethAddress = process.env.WETH_BASE_ADDRESS || "0x4200000000000000000000000000000000000006";
            const halfBalance = (balance / 2n).toString();
            const swapResult = await executeSwap(
              USDC_BASE_ADDRESS,
              wethAddress,
              halfBalance,
            );
            swapTxLog.push({
              timestamp: new Date().toISOString(),
              groupId,
              strategy,
              txHash: swapResult.txHash,
              tokenIn: swapResult.tokenIn,
              tokenOut: swapResult.tokenOut,
              amountIn: swapResult.amountIn,
              amountOut: swapResult.amountOut,
              explorerUrl: swapResult.explorerUrl,
            });
            log("7_uniswap_swap:OK", { tx: swapResult.txHash, amountOut: swapResult.amountOut });
          } catch (swapErr) {
            log("7_uniswap_swap:FAILED", { error: String(swapErr) });
            fastify.log.warn(`Uniswap swap failed (non-critical): ${swapErr}`);
          }
          completedStep = "7_uniswap_swap";
        }

        // Step 8: Record bridge on Arc's YieldManager
        log("8_record_bridged");
        const recordHash = await arcWallet.writeContract({
          address: YIELD_MANAGER_ADDRESS,
          abi: YIELD_MANAGER_ABI,
          functionName: "recordBridged",
          args: [BigInt(groupId), balance],
        });
        await arcPublic.waitForTransactionReceipt({ hash: recordHash });
        log("8_record_bridged:OK", { tx: recordHash });
        completedStep = "8_record_bridged";

        log("COMPLETE", { bridgedAmount: formatUnits(balance, 6) });

        return {
          success: true,
          bridgedAmount: formatUnits(balance, 6),
          strategy,
          depositTx: depositHash,
          bridgeRecordTx: recordHash,
          swapTxs: swapTxLog.filter((t) => t.groupId === groupId),
        };
      } catch (err) {
        fastify.log.error({ groupId, strategy, completedStep, err: String(err) },
          `[yield/enable] FAILED after step ${completedStep}: ${err}`);
        return reply.status(500).send({
          error: "Yield enable failed",
          failedAfterStep: completedStep,
          details: String(err),
        });
      }
    },
  );

  /**
   * GET /api/yield/status/:groupId
   * Get current yield position status
   */
  fastify.get<{ Params: { groupId: string } }>(
    "/api/yield/status/:groupId",
    async (request, reply) => {
      try {
        const { groupId } = request.params;
        const log = (step: string, data?: Record<string, unknown>) =>
          fastify.log.info({ groupId, step, ...data }, `[yield/status] ${step}`);

        log("read_arc_state");
        // Read YieldManager state from Arc (split into two calls to avoid stack-too-deep)
        const yieldInfo = await arcPublic.readContract({
          address: YIELD_MANAGER_ADDRESS,
          abi: YIELD_MANAGER_ABI,
          functionName: "getYieldInfo",
          args: [BigInt(groupId)],
        });
        const yieldVotes = await arcPublic.readContract({
          address: YIELD_MANAGER_ADDRESS,
          abi: YIELD_MANAGER_ABI,
          functionName: "getYieldVotes",
          args: [BigInt(groupId)],
        });

        const [strategy, phase, bridgedAmount, currentValue] = yieldInfo;
        const [lastUpdated, enableVoteCount, withdrawVoteCount, votesNeeded] = yieldVotes;

        log("read_arc_state:OK", {
          strategy: Number(strategy),
          phase: Number(phase),
          bridgedAmount: formatUnits(bridgedAmount, 6),
          currentValue: formatUnits(currentValue, 6),
          enableVoteCount: Number(enableVoteCount),
          votesNeeded: Number(votesNeeded),
        });

        // If active (phase >= 3), read latest value from Base Sepolia
        let latestValue = currentValue;
        let breakdown = null;

        if (Number(phase) >= 3 && bridgedAmount > 0n) {
          const gId = BigInt(groupId);

          try {
            const posValue = await basePublic.readContract({
              address: YIELD_STRATEGY_ADDRESS,
              abi: YIELD_STRATEGY_ABI,
              functionName: "getPositionValue",
              args: [gId],
            });
            latestValue = posValue[1]; // currentValue

            const bd = await basePublic.readContract({
              address: YIELD_STRATEGY_ADDRESS,
              abi: YIELD_STRATEGY_ABI,
              functionName: "getStrategyBreakdown",
              args: [gId],
            });
            breakdown = {
              strategy: Number(bd[0]),
              msUSDS_value: formatUnits(bd[1], 6),
              msUSDe_value: formatUnits(bd[2], 6),
              weth_value: formatUnits(bd[3], 18),
              totalUsdcValue: formatUnits(bd[4], 6),
            };

            // Push updated value to Arc YieldManager
            if (latestValue !== currentValue) {
              log("update_arc_balance", {
                oldValue: formatUnits(currentValue, 6),
                newValue: formatUnits(latestValue, 6),
              });
              arcWallet.writeContract({
                address: YIELD_MANAGER_ADDRESS,
                abi: YIELD_MANAGER_ABI,
                functionName: "updateYieldBalance",
                args: [BigInt(groupId), latestValue],
              }).then((tx) => {
                fastify.log.info({ groupId, tx }, `[yield/status] update_arc_balance:OK`);
              }).catch((err) => {
                fastify.log.error({ groupId, err: String(err) }, `[yield/status] update_arc_balance:FAILED`);
              });
            }
          } catch (baseErr) {
            log("read_base_position:FAILED", { error: String(baseErr) });
            fastify.log.warn(`Base Sepolia read failed: ${baseErr}`);
          }
        }

        const deposited = Number(formatUnits(bridgedAmount, 6));
        const current = Number(formatUnits(latestValue, 6));
        const yieldPercent = deposited > 0 ? ((current - deposited) / deposited) * 100 : 0;

        return {
          strategy: Number(strategy),
          phase: Number(phase),
          bridgedAmount: formatUnits(bridgedAmount, 6),
          currentValue: formatUnits(latestValue, 6),
          yieldPercent: yieldPercent.toFixed(4),
          lastUpdated: Number(lastUpdated),
          enableVoteCount: Number(enableVoteCount),
          withdrawVoteCount: Number(withdrawVoteCount),
          votesNeeded: Number(votesNeeded),
          breakdown,
          swapTxs: swapTxLog.filter((t) => t.groupId === groupId),
        };
      } catch (err) {
        fastify.log.error({ groupId: request.params.groupId, err: String(err) },
          `[yield/status] FAILED: ${err}`);
        return reply.status(500).send({ error: "Failed to get yield status", details: String(err) });
      }
    },
  );

  /**
   * POST /api/yield/withdraw
   * Withdraw yield funds from Base Sepolia back to Arc
   */
  fastify.post<{ Body: { groupId: string } }>(
    "/api/yield/withdraw",
    async (request, reply) => {
      const { groupId } = request.body;
      const gId = BigInt(groupId);
      const log = (step: string, data?: Record<string, unknown>) =>
        fastify.log.info({ groupId, step, ...data }, `[yield/withdraw] ${step}`);

      let completedStep = "none";
      try {
        // Step 1: Check withdrawal is approved on Arc
        log("1_check_approval");
        const approved = await arcPublic.readContract({
          address: YIELD_MANAGER_ADDRESS,
          abi: YIELD_MANAGER_ABI,
          functionName: "isWithdrawalApproved",
          args: [BigInt(groupId)],
        });
        if (!approved) {
          log("1_check_approval:NOT_APPROVED");
          return reply.status(400).send({ error: "Withdrawal not approved by group" });
        }
        completedStep = "1_check_approval";

        // Step 2: Read current position value before withdrawal
        log("2_read_position_value");
        const [deposited, currentVal] = await basePublic.readContract({
          address: YIELD_STRATEGY_ADDRESS,
          abi: YIELD_STRATEGY_ABI,
          functionName: "getPositionValue",
          args: [gId],
        });
        log("2_read_position_value:OK", {
          deposited: formatUnits(deposited, 6),
          currentVal: formatUnits(currentVal, 6),
        });
        completedStep = "2_read_position_value";

        // Step 3: Withdraw from YieldStrategy on Base Sepolia → USDC returns to pocket EOA
        log("3_withdraw_base");
        const pocketBalanceBefore = await basePublic.readContract({
          address: USDC_BASE_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [baseAccount.address],
        });
        const withdrawHash = await baseWallet.writeContract({
          address: YIELD_STRATEGY_ADDRESS,
          abi: YIELD_STRATEGY_ABI,
          functionName: "withdraw",
          args: [gId],
        });
        await basePublic.waitForTransactionReceipt({ hash: withdrawHash });
        const pocketBalanceAfter = await basePublic.readContract({
          address: USDC_BASE_ADDRESS,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [baseAccount.address],
        });
        const actualReturned = pocketBalanceAfter - pocketBalanceBefore;
        log("3_withdraw_base:OK", {
          tx: withdrawHash,
          expectedReturn: formatUnits(currentVal, 6),
          actualReturned: formatUnits(actualReturned, 6),
        });
        completedStep = "3_withdraw_base";

        // Step 4: Check pocket has enough USDC on Arc to return
        // === Bridge Base → Arc (simulated): return USDC from pocket to GroupPot ===
        // TODO: Replace with real CCTP bridge (TokenMessenger.depositForBurn on Base → receiveMessage on Arc)
        // Always use Arc USDC — yield operates in USDC regardless of group's baseCurrency.
        // GroupPot.returnFromYield handles FX conversion for EURC groups.
        const ARC_USDC = "0x3600000000000000000000000000000000000000" as Hex;
        log("4_check_pocket_arc");
        const pocketArcBalance = await arcPublic.readContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [arcAccount.address],
        });
        // Use the actual returned amount (from Base withdraw), capped by what pocket holds on Arc
        const returnAmount = pocketArcBalance < actualReturned ? pocketArcBalance : actualReturned;
        log("4_check_pocket_arc:OK", {
          pocketArcBalance: formatUnits(pocketArcBalance, 6),
          returnAmount: formatUnits(returnAmount, 6),
        });
        completedStep = "4_check_pocket_arc";

        // Step 5: Approve GroupPot to pull USDC from pocket on Arc
        log("5_approve_arc");
        const approveArcHash = await arcWallet.writeContract({
          address: ARC_USDC,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [GROUP_POT_ADDRESS, returnAmount],
        });
        await arcPublic.waitForTransactionReceipt({ hash: approveArcHash });
        log("5_approve_arc:OK", { tx: approveArcHash });
        completedStep = "5_approve_arc";

        // Step 6: Return funds to GroupPot
        log("6_return_to_pot");
        const returnHash = await arcWallet.writeContract({
          address: GROUP_POT_ADDRESS,
          abi: GROUP_POT_ABI,
          functionName: "returnFromYield",
          args: [gId, returnAmount, ARC_USDC],
        });
        await arcPublic.waitForTransactionReceipt({ hash: returnHash });
        log("6_return_to_pot:OK", { tx: returnHash });
        completedStep = "6_return_to_pot";

        // Step 7: Record withdrawal on Arc YieldManager
        log("7_record_withdrawal");
        const recordHash = await arcWallet.writeContract({
          address: YIELD_MANAGER_ADDRESS,
          abi: YIELD_MANAGER_ABI,
          functionName: "recordWithdrawal",
          args: [gId, returnAmount],
        });
        await arcPublic.waitForTransactionReceipt({ hash: recordHash });
        log("7_record_withdrawal:OK", { tx: recordHash });
        completedStep = "7_record_withdrawal";

        const depositedNum = Number(formatUnits(deposited, 6));
        const returnedNum = Number(formatUnits(returnAmount, 6));

        log("COMPLETE", { returnedAmount: formatUnits(returnAmount, 6) });

        return {
          success: true,
          returnedAmount: formatUnits(returnAmount, 6),
          yieldEarned: (returnedNum - depositedNum).toFixed(6),
          bridgeBackTx: returnHash,
          withdrawTx: withdrawHash,
          recordTx: recordHash,
        };
      } catch (err) {
        fastify.log.error({ groupId, completedStep, err: String(err) },
          `[yield/withdraw] FAILED after step ${completedStep}: ${err}`);
        return reply.status(500).send({
          error: "Withdrawal failed",
          failedAfterStep: completedStep,
          details: String(err),
        });
      }
    },
  );

  /**
   * POST /api/yield/simulate
   * Demo: advance yield by N seconds across all mock vaults
   */
  fastify.post<{ Body: { seconds: number } }>(
    "/api/yield/simulate",
    async (request, reply) => {
      try {
        const { seconds } = request.body;
        if (!seconds || seconds <= 0) {
          return reply.status(400).send({ error: "seconds must be positive" });
        }

        const hash = await baseWallet.writeContract({
          address: YIELD_STRATEGY_ADDRESS,
          abi: YIELD_STRATEGY_ABI,
          functionName: "advanceAllYields",
          args: [BigInt(seconds)],
        });
        await basePublic.waitForTransactionReceipt({ hash });

        return {
          success: true,
          simulatedDays: (seconds / 86400).toFixed(1),
          tx: hash,
        };
      } catch (err) {
        fastify.log.error(`Yield simulate failed: ${err}`);
        return reply.status(500).send({ error: "Simulation failed" });
      }
    },
  );

  /**
   * GET /api/yield/swap-log
   * Get all Uniswap swap transaction IDs (for prize submission)
   */
  fastify.get("/api/yield/swap-log", async () => {
    return {
      totalSwaps: swapTxLog.length,
      swaps: swapTxLog,
    };
  });

  fastify.log.info("Yield manager plugin registered");
});
