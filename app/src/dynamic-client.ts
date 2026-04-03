import { createClient } from "@dynamic-labs/client";
import { ReactNativeExtension } from "@dynamic-labs/react-native-extension";
import { ViemExtension } from "@dynamic-labs/viem-extension";

const ENVIRONMENT_ID = process.env.EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID!;

export const dynamicClient = createClient({
  environmentId: ENVIRONMENT_ID,
  appName: "Joint Account",
})
  .extend(ReactNativeExtension())
  .extend(ViemExtension());
