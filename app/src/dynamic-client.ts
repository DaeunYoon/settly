import { createClient } from "@dynamic-labs/client";
import { ReactNativeExtension } from "@dynamic-labs/react-native-extension";
import { ViemExtension } from "@dynamic-labs/viem-extension";

const ENVIRONMENT_ID = process.env.EXPO_PUBLIC_DYNAMIC_ENVIRONMENT_ID!;

export const dynamicClient = createClient({
  environmentId: ENVIRONMENT_ID,
  appName: "Settly",
  evmNetworks: [
    {
      chainId: 5042002,
      networkId: 5042002,
      name: "Arc Testnet",
      iconUrls: [],
      nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
      rpcUrls: ["https://rpc.testnet.arc.network"],
      blockExplorerUrls: ["https://testnet.arcscan.app"],
    },
  ],
})
  .extend(ReactNativeExtension())
  .extend(ViemExtension());
