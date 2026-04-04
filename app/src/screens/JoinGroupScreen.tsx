import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../types";
import { getPublicClient, getWalletClient } from "../viem";
import { CONTRACTS, GROUP_POT_ABI, ERC20_ABI } from "../contracts";
import { useContractEventContext } from "../contexts/ContractEventContext";
import { CameraView, useCameraPermissions } from "expo-camera";

type Mode = "choose" | "scan" | "manual";

export default function JoinGroupScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "JoinGroup">>();
  const { addGroupId } = useContractEventContext();

  const params = route.params;
  const [groupId, setGroupId] = useState(
    params?.groupId ? String(params.groupId) : ""
  );
  const [inviteCode, setInviteCode] = useState(params?.inviteCode ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(params?.groupId ? "manual" : "choose");
  const [scanned, setScanned] = useState(false);

  const [permission, requestPermission] = useCameraPermissions();

  const handleJoin = async () => {
    if (!groupId.trim() || !inviteCode.trim()) {
      setError("Group ID and invite code are required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const walletClient = await getWalletClient();

      const hash = await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "joinGroup",
        args: [BigInt(groupId), inviteCode],
      });

      await getPublicClient().waitForTransactionReceipt({ hash });

      // Read group info to get funding goal and base currency, then approve
      const { fundingGoal, baseCurrency } = await getPublicClient().readContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "getGroupInfo",
        args: [BigInt(groupId)],
      });

      if (fundingGoal > 0n) {
        const approveHash = await walletClient.writeContract({
          address: baseCurrency,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.GROUP_POT, fundingGoal],
        });
        await getPublicClient().waitForTransactionReceipt({ hash: approveHash });
      }

      addGroupId(Number(groupId));
      navigation.navigate("GroupDetail", { groupId: Number(groupId) });
    } catch (e: any) {
      setError(e.shortMessage ?? e.message ?? "Failed to join group");
    } finally {
      setLoading(false);
    }
  };

  const parseQrData = (data: string) => {
    // Match join/{groupId}/{inviteCode} in any URL format
    const match = data.match(/join\/(\d+)\/(.+?)(?:\?|$)/);
    if (match) {
      setGroupId(match[1]);
      setInviteCode(decodeURIComponent(match[2]));
      setScanned(true);
      setMode("manual");
    } else {
      setError("Invalid QR code");
    }
  };

  const handleScanMode = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        setError("Camera permission is required to scan QR codes");
        return;
      }
    }
    setMode("scan");
  };

  // ─── Scanner View ──────────────────────────────────────────
  if (mode === "scan") {
    return (
      <View className="flex-1 bg-black">
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            scanned ? undefined : ({ data }) => parseQrData(data)
          }
        />
        <View className="absolute top-16 left-6 right-6">
          <Pressable onPress={() => setMode("choose")}>
            <Text className="text-white text-base">← Back</Text>
          </Pressable>
          <Text className="text-white text-xl font-bold mt-4 text-center">
            Scan Invite QR
          </Text>
        </View>
        {error && (
          <View className="absolute bottom-20 left-6 right-6">
            <Text className="text-red-400 text-center">{error}</Text>
          </View>
        )}
      </View>
    );
  }

  // ─── Choose Mode ───────────────────────────────────────────
  if (mode === "choose") {
    return (
      <View className="flex-1 bg-white pt-16 px-6">
        <Pressable onPress={() => navigation.goBack()} className="mb-6">
          <Text className="text-gray-500">← Back</Text>
        </Pressable>

        <Text className="text-2xl font-bold text-gray-900 mb-2">
          Join Group
        </Text>
        <Text className="text-gray-500 mb-8">
          Scan a QR code or enter the details manually.
        </Text>

        <Pressable
          onPress={handleScanMode}
          className="bg-black rounded-xl py-4 items-center mb-3"
        >
          <Text className="text-white text-lg font-semibold">Scan QR Code</Text>
        </Pressable>

        <Pressable
          onPress={() => setMode("manual")}
          className="border border-gray-200 rounded-xl py-4 items-center"
        >
          <Text className="text-gray-900 text-lg font-semibold">
            Enter Manually
          </Text>
        </Pressable>
      </View>
    );
  }

  // ─── Manual Entry ──────────────────────────────────────────
  return (
    <View className="flex-1 bg-white pt-16 px-6">
      <Pressable
        onPress={() => (params?.groupId ? navigation.goBack() : setMode("choose"))}
        className="mb-6"
      >
        <Text className="text-gray-500">← Back</Text>
      </Pressable>

      <Text className="text-2xl font-bold text-gray-900 mb-2">Join Group</Text>
      {scanned && (
        <Text className="text-green-600 text-sm mb-4">
          QR code scanned successfully
        </Text>
      )}

      <Text className="text-sm font-medium text-gray-700 mb-1">Group ID</Text>
      <TextInput
        value={groupId}
        onChangeText={setGroupId}
        placeholder="e.g. 1"
        keyboardType="number-pad"
        className="bg-gray-50 rounded-xl px-4 py-3 mb-4 text-base"
      />

      <Text className="text-sm font-medium text-gray-700 mb-1">
        Invite Code
      </Text>
      <TextInput
        value={inviteCode}
        onChangeText={setInviteCode}
        placeholder="Enter the invite code"
        className="bg-gray-50 rounded-xl px-4 py-3 mb-6 text-base"
      />

      {error && <Text className="text-red-500 text-sm mb-4">{error}</Text>}

      <Pressable
        onPress={handleJoin}
        disabled={loading}
        className="bg-black rounded-xl py-4 items-center"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-white text-lg font-semibold">Join</Text>
        )}
      </Pressable>
    </View>
  );
}
