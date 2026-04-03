import { useReactiveClient } from "@dynamic-labs/react-hooks";
import { dynamicClient } from "../dynamic-client";

export const useDynamic = () => useReactiveClient(dynamicClient);
