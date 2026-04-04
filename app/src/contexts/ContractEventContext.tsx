import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { Alert, AppState } from "react-native";
import { formatUnits } from "viem";
import type { WatchContractEventReturnType, Log } from "viem";
import { getPublicClient } from "../viem";
import {
  CONTRACTS,
  GROUP_POT_ABI,
  SPLIT_SETTLER_ABI,
} from "../contracts";
import { dynamicClient } from "../dynamic-client";
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
  const { groupIds, loading, refresh, addGroupId } = useUserGroups();
  const subscribersRef = useRef<
    Map<string, Set<Callback>>
  >(new Map());
  const unwatchRef = useRef<WatchContractEventReturnType[]>([]);
  const activeRef = useRef(true);

  // Initial group scan
  useEffect(() => {
    refresh();
  }, [refresh]);

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
        case "FundsReleased": {
          if (args.requester?.toLowerCase() !== userAddress) break;
          const amount = formatUnits(args.amount ?? 0n, 6);
          Alert.alert("Funds Received", `You received ${amount}!`);
          break;
        }
      }
    }
  }, []);

  // ── Watcher lifecycle ──────────────────────────────────────

  const stopWatchers = useCallback(() => {
    unwatchRef.current.forEach((unwatch) => unwatch());
    unwatchRef.current = [];
  }, []);

  const startWatchers = useCallback(() => {
    stopWatchers();

    if (groupIds.length === 0) return;

    const client = getPublicClient();
    const bigIntIds = groupIds.map((id) => BigInt(id));

    const onLogs = (logs: Log[]) => {
      if (!activeRef.current) return;
      dispatch(logs);
      showPopups(logs);
    };

    try {
      const unwatchGroupPot = client.watchContractEvent({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        args: { groupId: bigIntIds } as any,
        pollingInterval: POLLING_INTERVAL,
        onLogs,
      });
      unwatchRef.current.push(unwatchGroupPot);
    } catch (err) {
      console.error("[ContractEvents] GroupPot watcher failed:", err);
    }

    try {
      const unwatchSplitSettler = client.watchContractEvent({
        address: CONTRACTS.SPLIT_SETTLER,
        abi: SPLIT_SETTLER_ABI,
        args: { groupId: bigIntIds } as any,
        pollingInterval: POLLING_INTERVAL,
        onLogs,
      });
      unwatchRef.current.push(unwatchSplitSettler);
    } catch (err) {
      console.error("[ContractEvents] SplitSettler watcher failed:", err);
    }
  }, [groupIds, stopWatchers, dispatch, showPopups]);

  // Start/restart watchers when groupIds change
  useEffect(() => {
    if (loading) return;
    startWatchers();
    return () => stopWatchers();
  }, [loading, startWatchers, stopWatchers]);

  // Pause on background, resume on foreground
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        activeRef.current = true;
        startWatchers();
      } else {
        activeRef.current = false;
        stopWatchers();
      }
    });
    return () => sub.remove();
  }, [startWatchers, stopWatchers]);

  return (
    <ContractEventContext.Provider
      value={{ subscribe, addGroupId, userGroupIds: groupIds }}
    >
      {children}
    </ContractEventContext.Provider>
  );
}
