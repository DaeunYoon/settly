import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { dynamicClient } from "../dynamic-client";

export default function WalletSetupScreen() {
  const [status, setStatus] = useState<"idle" | "creating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const createWallet = async () => {
    setStatus("creating");
    setError(null);
    try {
      await dynamicClient.wallets.embedded.createWallet({ chain: "Evm" });
    } catch (e: any) {
      setStatus("error");
      setError(e.message ?? "Failed to create wallet");
    }
  };

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-3xl font-bold text-gray-900 mb-2">Settly</Text>
      <Text className="text-base text-gray-500 mb-10 text-center">
        Create a wallet to get started
      </Text>

      <Pressable
        onPress={createWallet}
        disabled={status === "creating"}
        className="bg-black rounded-xl px-8 py-4 w-full items-center"
      >
        {status === "creating" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">
            Create Wallet
          </Text>
        )}
      </Pressable>

      {error && (
        <Text className="text-red-500 text-sm text-center mt-4">{error}</Text>
      )}
    </View>
  );
}
