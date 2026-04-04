import "./global.css";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";

import { dynamicClient } from "./src/dynamic-client";
import { useDynamic } from "./src/hooks/useDynamic";
import type { RootStackParamList } from "./src/types";

import LoginScreen from "./src/screens/LoginScreen";
import WalletSetupScreen from "./src/screens/WalletSetupScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import CreateGroupScreen from "./src/screens/CreateGroupScreen";
import JoinGroupScreen from "./src/screens/JoinGroupScreen";
import GroupDetailScreen from "./src/screens/GroupDetailScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const Stack = createNativeStackNavigator<RootStackParamList>();

const prefix = Linking.createURL("/");

const linking = {
  prefixes: [prefix, "settly://"],
  config: {
    screens: {
      JoinGroup: {
        path: "join/:groupId/:inviteCode",
        parse: {
          groupId: (id: string) => id,
          inviteCode: (code: string) => decodeURIComponent(code),
        },
      },
    },
  },
};

export default function App() {
  const { auth, wallets } = useDynamic();

  const isAuthenticated = !!auth.authenticatedUser;
  const hasWallet = !!wallets.embedded?.hasWallet;

  return (
    <>
      <dynamicClient.reactNative.WebView />
      <NavigationContainer linking={linking}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!isAuthenticated ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : !hasWallet ? (
            <Stack.Screen name="WalletSetup" component={WalletSetupScreen} />
          ) : (
            <>
              <Stack.Screen name="Dashboard" component={DashboardScreen} />
              <Stack.Screen name="CreateGroup" component={CreateGroupScreen} />
              <Stack.Screen name="JoinGroup" component={JoinGroupScreen} />
              <Stack.Screen name="GroupDetail" component={GroupDetailScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </>
  );
}
