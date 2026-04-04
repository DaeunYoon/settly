import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Alert, AppState } from "react-native";
import { formatUnits } from "viem";
import type { Log } from "viem";
import { getPublicClient } from "../viem";
import {
  CONTRACTS,
  GROUP_POT_ABI,
  SPLIT_SETTLER_ABI,
} from "../contracts";
import { dynamicClient } from "../dynamic-client";
import { useDynamic } from "../hooks/useDynamic";
import { useUserGroups } from "../hooks/useUserGroups";

const POLLING_INTERVAL = 4_000;

type Callback = (log: Log) => void;

type ContractEventContextValue = {
  subscribe: (
    groupId: number | "all",
    callback: Callback
  ) => () => void;
  addGroupId: (id: number) => void;
  userGroupIds: number[];
};

const ContractEventContext = createContext<ContractEventContextValue | null>(
  null
);

export function useContractEventContext() {
  const ctx = useContext(ContractEventContext);
  if (!ctx)
    throw new Error(
      "useContractEventContext must be used within ContractEventProvider"
    );
  return ctx;
}

// ── Helpers ──────────────────────────────────────────────────

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function currencySymbol(addr: string) {
  return addr.toLowerCase() === CONTRACTS.USDC.toLowerCase() ? "USDC" : "EURC";
}

// ── Provider ─────────────────────────────────────────────────

export function ContractEventProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { wallets } = useDynamic();
  const walletAddress = wallets.primary?.address;
  const { groupIds, loading, refresh, addGroupId } = useUserGroups();
  const subscribersRef = useRef<
    Map<string, Set<Callback>>
  >(new Map());
  const activeRef = useRef(true);
  const groupIdsRef = useRef<number[]>(groupIds);

  // Keep groupIds ref in sync
  useEffect(() => {
    groupIdsRef.current = groupIds;
  }, [groupIds]);

  // Re-scan groups when wallet becomes available or changes
  useEffect(() => {
    refresh();
  }, [refresh, walletAddress]);

  // ── Subscriber registry ────────────────────────────────────

  const subscribe = useCallback(
    (groupId: number | "all", callback: Callback) => {
      const key = String(groupId);
      if (!subscribersRef.current.has(key)) {
        subscribersRef.current.set(key, new Set());
      }
      subscribersRef.current.get(key)!.add(callback);

      return () => {
        subscribersRef.current.get(key)?.delete(callback);
      };
    },
    []
  );

  const dispatch = useCallback((logs: Log[]) => {
    for (const log of logs) {
      const args = (log as any).args;
      const groupId = args?.groupId != null ? Number(args.groupId) : null;

      // Dispatch to group-specific subscribers
      if (groupId != null) {
        const subs = subscribersRef.current.get(String(groupId));
        if (subs) subs.forEach((cb) => cb(log));
      }

      // Dispatch to "all" subscribers
      const allSubs = subscribersRef.current.get("all");
      if (allSubs) allSubs.forEach((cb) => cb(log));
    }
  }, []);

  // ── Popup notifications ────────────────────────────────────

  const showPopups = useCallback((logs: Log[]) => {
    const userAddress = dynamicClient.wallets.primary?.address?.toLowerCase();
    if (!userAddress) return;

    for (const log of logs) {
      const eventName = (log as any).eventName as string | undefined;
      const args = (log as any).args;
      if (!eventName || !args) continue;

      switch (eventName) {
        case "MemberJoined": {
          if (args.member?.toLowerCase() === userAddress) break;
          Alert.alert(
            "New Member",
            `${shortAddr(args.member)} joined the group`
          );
          break;
        }
        case "Deposited": {
          if (args.member?.toLowerCase() === userAddress) break;
          const amount = formatUnits(args.amount ?? 0n, 6);
          const token = currencySymbol(args.token ?? "");
          Alert.alert(
            "New Deposit",
            `${shortAddr(args.member)} deposited ${amount} ${token}`
          );
          break;
        }
        case "ReimbursementRequested": {
          if (args.requester?.toLowerCase() === userAddress) break;
          const amount = formatUnits(args.amount ?? 0n, 6);
          Alert.alert(
            "Reimbursement Request",
            `${shortAddr(args.requester)} requested ${amount} reimbursement: ${args.description}`
          );
          break;
        }
        case "ExpenseAdded": {
          if (args.paidBy?.toLowerCase() === userAddress) break;
          const amount = formatUnits(args.amount ?? 0n, 6);
          Alert.alert(
            "New Expense",
            `${shortAddr(args.paidBy)} added expense: ${args.description} (${amount})`
          );
          break;
        }
        case "Settled": {
          const settledAmt = formatUnits(args.amount ?? 0n, 6);
          if (args.to?.toLowerCase() === userAddress) {
            Alert.alert(
              "Settlement Received",
              `${shortAddr(args.from)} paid you ${settledAmt}`
            );
          } else if (args.from?.toLowerCase() !== userAddress) {
            Alert.alert(
              "Settlement",
              `${shortAddr(args.from)} settled ${settledAmt} with ${shortAddr(args.to)}`
            );
          }
          break;
        }
        case "FundsReleased": {
          if (args.requester?.toLowerCase() !== userAddress) break;
          const amount = formatUnits(args.amount ?? 0n, 6);
          Alert.alert("Funds Received", `You received ${amount}!`);
          break;
        }
      }
    }
  }, []);

  // ── Manual poll lifecycle ───────────────────────────────────
  // Uses getContractEvents (eth_getLogs) directly instead of
  // watchContractEvent, which relies on eth_newFilter and can
  // silently fail on certain RPC providers.

  const lastBlockRef = useRef<bigint | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!activeRef.current) return;
    if (groupIdsRef.current.length === 0) return;

    try {
      const client = getPublicClient();
      const latestBlock = await client.getBlockNumber();

      // On first poll, just record the current block — don't replay history
      if (lastBlockRef.current === null) {
        lastBlockRef.current = latestBlock;
        return;
      }

      if (latestBlock <= lastBlockRef.current) return;

      const fromBlock = lastBlockRef.current + 1n;
      lastBlockRef.current = latestBlock;

      const [potLogs, splitLogs] = await Promise.all([
        client.getContractEvents({
          address: CONTRACTS.GROUP_POT,
          abi: GROUP_POT_ABI,
          fromBlock,
          toBlock: latestBlock,
        }),
        client.getContractEvents({
          address: CONTRACTS.SPLIT_SETTLER,
          abi: SPLIT_SETTLER_ABI,
          fromBlock,
          toBlock: latestBlock,
        }),
      ]);

      const allLogs = [...potLogs, ...splitLogs] as Log[];
      if (allLogs.length === 0) return;

      // Client-side groupId filter
      const groupIdSet = new Set(groupIdsRef.current);
      const relevant = allLogs.filter((log: any) => {
        const gId = log.args?.groupId;
        return gId != null && groupIdSet.has(Number(gId));
      });
      if (relevant.length === 0) return;

      dispatch(relevant);
      showPopups(relevant);
    } catch (err) {
      console.error("[ContractEvents] poll error:", err);
    }
  }, [dispatch, showPopups]);

  const startPolling = useCallback(() => {
    stopPolling();
    // Reset so next poll seeds the block cursor
    lastBlockRef.current = null;
    // Kick off first poll immediately, then repeat
    poll();
    timerRef.current = setInterval(poll, POLLING_INTERVAL);
  }, [stopPolling, poll]);

  // Start/restart polling when groups become available
  const hasGroups = groupIds.length > 0;
  useEffect(() => {
    if (loading || !hasGroups) return;
    startPolling();
    return () => stopPolling();
  }, [loading, hasGroups, startPolling, stopPolling]);

  // Pause on background, resume on foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        activeRef.current = true;
        startPolling();
      } else {
        activeRef.current = false;
        stopPolling();
      }
    });
    return () => sub.remove();
  }, [startPolling, stopPolling]);

  return (
    <ContractEventContext.Provider
      value={{ subscribe, addGroupId, userGroupIds: groupIds }}
    >
      {children}
    </ContractEventContext.Provider>
  );
}
