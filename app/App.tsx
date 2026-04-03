import "./global.css";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { dynamicClient } from "./src/dynamic-client";
import { useDynamic } from "./src/hooks/useDynamic";
import type { RootStackParamList } from "./src/types";

import LoginScreen from "./src/screens/LoginScreen";
import WalletSetupScreen from "./src/screens/WalletSetupScreen";
import HomeScreen from "./src/screens/HomeScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const { auth, wallets } = useDynamic();

  const isAuthenticated = !!auth.authenticatedUser;
  const hasWallet = !!wallets.embedded?.hasWallet;

  const renderScreens = () => {
    if (!isAuthenticated) {
      return <Stack.Screen name="Login" component={LoginScreen} />;
    }
    if (!hasWallet) {
      return <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />;
    }
    return <Stack.Screen name="Home" component={HomeScreen} />;
  };

  return (
    <>
      <dynamicClient.reactNative.WebView />
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {renderScreens()}
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </>
  );
}
