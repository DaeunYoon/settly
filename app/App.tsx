import "./global.css";
import { useEffect, useRef } from "react";
import { StatusBar } from "expo-status-bar";
import {
  NavigationContainer,
  NavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";

import { dynamicClient } from "./src/dynamic-client";
import { useDynamic } from "./src/hooks/useDynamic";
import { ContractEventProvider } from "./src/contexts/ContractEventContext";
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
console.log("[Linking] prefix:", prefix);

function parseJoinUrl(url: string): { token: string } | null {
  console.log("[Linking] parseJoinUrl input:", url);
  const tokenMatch = url.match(/join\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?|$)/i);
  if (tokenMatch) {
    console.log("[Linking] token match:", tokenMatch);
    return { token: tokenMatch[1] };
  }
  return null;
}

const linking = {
  prefixes: [prefix, "settly://"],
  config: {
    screens: {
      JoinGroup: {
        path: "join/:token",
      },
    },
  },
};

export default function App() {
  const { auth, wallets } = useDynamic();
  const navRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const pendingJoin = useRef<{ token: string } | null>(null);

  const isAuthenticated = !!auth.authenticatedUser;
  const hasWallet = !!wallets.embedded?.hasWallet;
  const isReady = isAuthenticated && hasWallet;

  console.log("[App] render — isAuthenticated:", isAuthenticated, "hasWallet:", hasWallet, "isReady:", isReady);

  // Capture deep links that arrive before auth is complete
  useEffect(() => {
    // Check initial URL
    Linking.getInitialURL().then((url) => {
      console.log("[Linking] getInitialURL:", url);
      if (url && !isReady) {
        const params = parseJoinUrl(url);
        console.log("[Linking] initial parsed params:", params);
        if (params) pendingJoin.current = params;
      }
    });

    // Listen for URLs while unauthenticated
    const sub = Linking.addEventListener("url", ({ url }) => {
      console.log("[Linking] url event:", url, "isReady:", isReady);
      if (!isReady) {
        const params = parseJoinUrl(url);
        console.log("[Linking] event parsed params:", params);
        if (params) pendingJoin.current = params;
      }
    });
    return () => sub.remove();
  }, [isReady]);

  // Replay pending deep link after auth + wallet setup
  useEffect(() => {
    console.log("[Linking] replay check — isReady:", isReady, "pendingJoin:", pendingJoin.current);
    if (isReady && pendingJoin.current) {
      const params = pendingJoin.current;
      pendingJoin.current = null;
      console.log("[Linking] navigating to JoinGroup with:", params);
      // Small delay to let navigator mount
      setTimeout(() => {
        console.log("[Linking] navRef.current:", !!navRef.current);
        navRef.current?.navigate("JoinGroup", params);
      }, 100);
    }
  }, [isReady]);

  return (
    <>
      <dynamicClient.reactNative.WebView />
      <ContractEventProvider>
        <NavigationContainer ref={navRef} linking={linking}>
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
      </ContractEventProvider>
      <StatusBar style="auto" />
    </>
  );
}
