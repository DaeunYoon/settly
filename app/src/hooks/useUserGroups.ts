import { useCallback, useRef, useState } from "react";
import { getPublicClient } from "../viem";
import { CONTRACTS, GROUP_POT_ABI } from "../contracts";
import { dynamicClient } from "../dynamic-client";

export function useUserGroups() {
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const scannedRef = useRef(false);

  const refresh = useCallback(async () => {
    const userAddress = dynamicClient.wallets.primary?.address;
    if (!userAddress) {
      setGroupIds([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const client = getPublicClient();
      const nextId = await client.readContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "nextGroupId",
      });

      const found: number[] = [];
      for (let i = 1; i < Number(nextId); i++) {
        try {
          const isMember = await client.readContract({
            address: CONTRACTS.GROUP_POT,
            abi: GROUP_POT_ABI,
            functionName: "isMember",
            args: [BigInt(i), userAddress as `0x${string}`],
          });
          if (isMember) found.push(i);
        } catch {
          // Group may not exist at this ID
        }
      }
      setGroupIds(found);
      scannedRef.current = true;
    } catch (err) {
      console.error("[useUserGroups] scan failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const addGroupId = useCallback((id: number) => {
    setGroupIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  return { groupIds, loading, refresh, addGroupId };
}
