import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { getPublicClient, getWalletClient } from "../viem";
import { CONTRACTS, GROUP_POT_ABI, ERC20_ABI } from "../contracts";
import { useContractEventContext } from "../contexts/ContractEventContext";

export default function CreateGroupScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { addGroupId } = useContractEventContext();
  const [name, setName] = useState("");
  const [fundingGoal, setFundingGoal] = useState("");
  const [baseCurrency, setBaseCurrency] = useState<"USDC" | "EURC">("USDC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Group name is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const walletClient = await getWalletClient();
      const goalAmount = fundingGoal
        ? BigInt(Math.round(parseFloat(fundingGoal) * 1e6))
        : 0n;
      const currencyAddress =
        baseCurrency === "USDC" ? CONTRACTS.USDC : CONTRACTS.EURC;

      // Create group locked (bytes32(0) = no joins until invite code is set)
      const hash = await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "createGroup",
        args: [
          name,
          goalAmount,
          currencyAddress,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ],
      });

      await getPublicClient().waitForTransactionReceipt({ hash });

      // Approve token for funding goal so deposit doesn't need to
      if (goalAmount > 0n) {
        const approveHash = await walletClient.writeContract({
          address: currencyAddress,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.GROUP_POT, goalAmount],
        });
        await getPublicClient().waitForTransactionReceipt({ hash: approveHash });
      }

      const nextId = await getPublicClient().readContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "nextGroupId",
      });

      const newGroupId = Number(nextId);
      addGroupId(newGroupId);
      navigation.replace("GroupDetail", { groupId: newGroupId });
    } catch (e: any) {
      console.error("createGroup failed:", e);
      setError(e.shortMessage ?? e.message ?? "Failed to create group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 bg-white pt-16 px-6">
      <Pressable onPress={() => navigation.goBack()} className="mb-6">
        <Text className="text-gray-500">← Back</Text>
      </Pressable>

      <Text className="text-2xl font-bold text-gray-900 mb-6">
        Create Group
      </Text>

      <Text className="text-sm font-medium text-gray-700 mb-1">
        Group Name
      </Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="e.g. Cannes Trip"
        className="bg-gray-50 rounded-xl px-4 py-3 mb-4 text-base"
      />

      <Text className="text-sm font-medium text-gray-700 mb-1">
        Funding Goal (optional)
      </Text>
      <TextInput
        value={fundingGoal}
        onChangeText={setFundingGoal}
        placeholder="e.g. 600"
        keyboardType="decimal-pad"
        className="bg-gray-50 rounded-xl px-4 py-3 mb-4 text-base"
      />

      <Text className="text-sm font-medium text-gray-700 mb-2">
        Base Currency
      </Text>
      <View className="flex-row gap-3 mb-6">
        {(["USDC", "EURC"] as const).map((currency) => (
          <Pressable
            key={currency}
            onPress={() => setBaseCurrency(currency)}
            className={`flex-1 rounded-xl py-3 items-center border ${
              baseCurrency === currency
                ? "bg-black border-black"
                : "bg-gray-50 border-gray-200"
            }`}
          >
            <Text
              className={
                baseCurrency === currency
                  ? "text-white font-semibold"
                  : "text-gray-700 font-semibold"
              }
            >
              {currency}
            </Text>
          </Pressable>
        ))}
      </View>

      {error && <Text className="text-red-500 text-sm mb-4">{error}</Text>}

      <Pressable
        onPress={handleCreate}
        disabled={loading}
        className="bg-black rounded-xl py-4 items-center"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">Create</Text>
        )}
      </Pressable>
    </View>
  );
}
