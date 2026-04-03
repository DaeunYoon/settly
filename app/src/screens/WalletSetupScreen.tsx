import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { dynamicClient } from "../dynamic-client";
import { useDynamic } from "../hooks/useDynamic";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "WalletSetup">;

type PartnerStatus = "idle" | "creating" | "done" | "error";

export default function WalletSetupScreen({ navigation }: Props) {
  const { wallets, auth } = useDynamic();

  const [partnerAStatus, setPartnerAStatus] = useState<PartnerStatus>(
    wallets.embedded?.hasWallet ? "done" : "idle"
  );
  const [partnerBStatus, setPartnerBStatus] = useState<PartnerStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const currentUserEmail = auth.authenticatedUser?.email ?? "You";

  const createWalletForCurrentUser = async () => {
    if (wallets.embedded?.hasWallet) {
      setPartnerAStatus("done");
      return;
    }

    setPartnerAStatus("creating");
    setError(null);
    try {
      await dynamicClient.wallets.embedded.createWallet({ chain: "Evm" });
      setPartnerAStatus("done");
    } catch (e: any) {
      setPartnerAStatus("error");
      setError(e.message ?? "Failed to create wallet");
    }
  };

  const createWalletForPartner = async () => {
    setPartnerBStatus("creating");
    setError(null);
    try {
      // Partner B needs to authenticate separately.
      // For now, create a second embedded wallet under the same session
      // which can later be reassigned or linked to partner B's account.
      await dynamicClient.wallets.embedded.createWallet({ chain: "Evm" });
      setPartnerBStatus("done");
    } catch (e: any) {
      setPartnerBStatus("error");
      setError(e.message ?? "Failed to create partner wallet");
    }
  };

  const bothDone = partnerAStatus === "done" && partnerBStatus === "done";

  return (
    <View className="flex-1 bg-white px-6 pt-16">
      <Text className="text-2xl font-bold text-gray-900 mb-2">
        Create Wallets
      </Text>
      <Text className="text-base text-gray-500 mb-8">
        Each partner needs their own wallet to manage the joint account.
      </Text>

      {/* Partner A */}
      <View className="bg-gray-50 rounded-xl p-5 mb-4">
        <Text className="text-lg font-semibold text-gray-900 mb-1">
          Partner A
        </Text>
        <Text className="text-sm text-gray-500 mb-3">{currentUserEmail}</Text>

        {partnerAStatus === "done" ? (
          <View className="flex-row items-center">
            <Text className="text-green-600 font-medium">Wallet created</Text>
          </View>
        ) : (
          <Pressable
            onPress={createWalletForCurrentUser}
            disabled={partnerAStatus === "creating"}
            className="bg-black rounded-lg px-5 py-3 items-center"
          >
            {partnerAStatus === "creating" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold">Create Wallet</Text>
            )}
          </Pressable>
        )}
      </View>

      {/* Partner B */}
      <View className="bg-gray-50 rounded-xl p-5 mb-6">
        <Text className="text-lg font-semibold text-gray-900 mb-1">
          Partner B
        </Text>
        <Text className="text-sm text-gray-500 mb-3">Invite your partner</Text>

        {partnerBStatus === "done" ? (
          <View className="flex-row items-center">
            <Text className="text-green-600 font-medium">Wallet created</Text>
          </View>
        ) : (
          <Pressable
            onPress={createWalletForPartner}
            disabled={
              partnerBStatus === "creating" || partnerAStatus !== "done"
            }
            className={`rounded-lg px-5 py-3 items-center ${
              partnerAStatus !== "done" ? "bg-gray-300" : "bg-black"
            }`}
          >
            {partnerBStatus === "creating" ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text className="text-white font-semibold">Create Wallet</Text>
            )}
          </Pressable>
        )}
      </View>

      {error && (
        <Text className="text-red-500 text-sm text-center mb-4">{error}</Text>
      )}

      {/* Continue */}
      {bothDone && (
        <Pressable
          onPress={() => navigation.replace("Dashboard")}
          className="bg-black rounded-xl px-8 py-4 items-center"
        >
          <Text className="text-white text-lg font-semibold">Continue</Text>
        </Pressable>
      )}
    </View>
  );
}
