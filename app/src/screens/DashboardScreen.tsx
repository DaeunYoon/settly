import { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  ActivityIndicator,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../types";
import { dynamicClient } from "../dynamic-client";
import { getPublicClient } from "../viem";
import { CONTRACTS, GROUP_POT_ABI } from "../contracts";
import { useGroupEvents } from "../hooks/useGroupEvents";

type GroupSummary = {
  groupId: number;
  name: string;
  memberCount: number;
  potBalance: string;
  baseCurrency: string;
};

export default function DashboardScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const loadGroups = useCallback(async () => {
    try {
      setLoading(true);
      const client = getPublicClient();
      const nextId = await client.readContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "nextGroupId",
      });

      const userAddress = dynamicClient.wallets.primary?.address;
      if (!userAddress) return;

      const found: GroupSummary[] = [];
      for (let i = 1; i <= Number(nextId); i++) {
        try {
          const isMember = await client.readContract({
            address: CONTRACTS.GROUP_POT,
            abi: GROUP_POT_ABI,
            functionName: "isMember",
            args: [BigInt(i), userAddress as `0x${string}`],
          });
          if (isMember) {
            const { name, baseCurrency, potBalance, closed, members } =
              await client.readContract({
                address: CONTRACTS.GROUP_POT,
                abi: GROUP_POT_ABI,
                functionName: "getGroupInfo",
                args: [BigInt(i)],
              });
            if (!closed) {
              found.push({
                groupId: i,
                name,
                memberCount: members.length,
                potBalance: (Number(potBalance) / 1e6).toFixed(2),
                baseCurrency:
                  baseCurrency.toLowerCase() === CONTRACTS.USDC.toLowerCase()
                    ? "USDC"
                    : "EURC",
              });
            }
          }
        } catch {
          // Group may not exist at this ID, skip
        }
      }
      setGroups(found);
    } catch (err) {
      console.error("Failed to load groups:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadGroups();
    }, [loadGroups])
  );

  useGroupEvents("all", () => {
    loadGroups();
  });

  return (
    <View className="flex-1 bg-white pt-16 px-6">
      <View className="flex-row justify-between items-center mb-6">
        <Text className="text-2xl font-bold text-gray-900">Settly</Text>
        <Pressable onPress={() => navigation.navigate("Settings")}>
          <Text className="text-gray-500 text-2xl">&#9881;</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator className="mt-10" />
      ) : groups.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <Text className="text-gray-400 text-lg mb-2">No groups yet</Text>
          <Text className="text-gray-400 text-sm">
            Create or join a group to get started
          </Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => String(item.groupId)}
          renderItem={({ item }) => (
            <Pressable
              onPress={() =>
                navigation.navigate("GroupDetail", { groupId: item.groupId })
              }
              className="bg-gray-50 rounded-xl p-4 mb-3"
            >
              <Text className="text-lg font-semibold text-gray-900">
                {item.name}
              </Text>
              <View className="flex-row justify-between mt-1">
                <Text className="text-sm text-gray-500">
                  {item.memberCount} members
                </Text>
                <Text className="text-sm font-medium text-gray-700">
                  {item.potBalance} {item.baseCurrency}
                </Text>
              </View>
            </Pressable>
          )}
        />
      )}

      <View className="flex-row gap-3 mb-8">
        <Pressable
          onPress={() => navigation.navigate("CreateGroup")}
          className="flex-1 bg-black rounded-xl py-4 items-center"
        >
          <Text className="text-white font-semibold">Create Group</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate("JoinGroup")}
          className="flex-1 bg-gray-100 rounded-xl py-4 items-center border border-gray-200"
        >
          <Text className="text-gray-900 font-semibold">Join Group</Text>
        </Pressable>
      </View>
    </View>
  );
}
