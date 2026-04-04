import { useEffect, useRef } from "react";
import type { Log } from "viem";
import { useContractEventContext } from "../contexts/ContractEventContext";

export function useGroupEvents(
  groupId: number | "all",
  callback: (log: Log) => void
) {
  const { subscribe } = useContractEventContext();
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const unsubscribe = subscribe(groupId, (log) => {
      callbackRef.current(log);
    });
    return unsubscribe;
  }, [groupId, subscribe]);
}
