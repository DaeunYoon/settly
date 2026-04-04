import { View, Text, Pressable } from "react-native";
import { dynamicClient } from "../dynamic-client";

export default function LoginScreen() {
  const handleAuth = () => {
    dynamicClient.ui.auth.show();
  };

  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-3xl font-bold text-gray-900 mb-2">Settly</Text>
      <Text className="text-base text-gray-500 mb-10 text-center">
        Group expenses on-chain
      </Text>

      <Pressable
        onPress={handleAuth}
        className="bg-black rounded-xl px-8 py-4 w-full items-center"
      >
        <Text className="text-white text-lg font-semibold">Get Started</Text>
      </Pressable>
    </View>
  );
}
