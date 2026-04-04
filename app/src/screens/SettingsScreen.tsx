import { View, Text, Pressable, Alert } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { dynamicClient } from "../dynamic-client";
import { useDynamic } from "../hooks/useDynamic";
import * as Clipboard from "expo-clipboard";

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { auth, wallets } = useDynamic();

  const user = auth.authenticatedUser;
  const wallet = wallets.primary;

  const copyAddress = async () => {
    if (wallet?.address) {
      await Clipboard.setStringAsync(wallet.address);
      Alert.alert("Copied", "Wallet address copied to clipboard");
    }
  };

  const handleLogout = async () => {
    await dynamicClient.auth.logout();
  };

  return (
    <View className="flex-1 bg-white pt-16 px-6">
      <Pressable onPress={() => navigation.goBack()} className="mb-6">
        <Text className="text-gray-500">← Back</Text>
      </Pressable>

      <Text className="text-2xl font-bold text-gray-900 mb-6">Settings</Text>

      {/* Account Info */}
      <Text className="text-xs font-medium text-gray-400 uppercase mb-2">
        Account
      </Text>
      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        {user?.email && (
          <View className="mb-3">
            <Text className="text-xs text-gray-400">Email</Text>
            <Text className="text-base text-gray-900">{user.email}</Text>
          </View>
        )}
        {user?.alias && (
          <View className="mb-3">
            <Text className="text-xs text-gray-400">Username</Text>
            <Text className="text-base text-gray-900">{user.alias}</Text>
          </View>
        )}
        {user?.userId && (
          <View>
            <Text className="text-xs text-gray-400">User ID</Text>
            <Text className="text-sm text-gray-500">{user.userId}</Text>
          </View>
        )}
      </View>

      {/* Wallet Info */}
      <Text className="text-xs font-medium text-gray-400 uppercase mb-2">
        Wallet
      </Text>
      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        {wallet?.address && (
          <Pressable onPress={copyAddress}>
            <Text className="text-xs text-gray-400">Address (tap to copy)</Text>
            <Text className="text-sm text-gray-900 font-mono">
              {wallet.address}
            </Text>
          </Pressable>
        )}
        {wallet?.chain && (
          <View className="mt-3">
            <Text className="text-xs text-gray-400">Network</Text>
            <Text className="text-base text-gray-900">Arc Testnet</Text>
          </View>
        )}
      </View>

      {/* Network Info */}
      <Text className="text-xs font-medium text-gray-400 uppercase mb-2">
        Network
      </Text>
      <View className="bg-gray-50 rounded-xl p-4 mb-8">
        <View className="mb-3">
          <Text className="text-xs text-gray-400">Chain ID</Text>
          <Text className="text-base text-gray-900">5042002</Text>
        </View>
        <View className="mb-3">
          <Text className="text-xs text-gray-400">Explorer</Text>
          <Text className="text-base text-gray-900">testnet.arcscan.app</Text>
        </View>
        <View>
          <Text className="text-xs text-gray-400">Faucet</Text>
          <Text className="text-base text-gray-900">faucet.circle.com</Text>
        </View>
      </View>

      {/* Logout */}
      <Pressable
        onPress={handleLogout}
        className="border border-red-200 rounded-xl py-4 items-center"
      >
        <Text className="text-red-500 font-semibold">Logout</Text>
      </Pressable>
    </View>
  );
}
