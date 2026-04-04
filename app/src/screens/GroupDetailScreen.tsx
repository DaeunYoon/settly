import * as ExpoCrypto from "expo-crypto";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Share,
  Modal,
  RefreshControl,
} from "react-native";
import { QrCodeSvg } from "react-native-qr-svg";
import { useRoute, useNavigation } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../types";
import { dynamicClient } from "../dynamic-client";
import { getPublicClient, getWalletClient } from "../viem";
import {
  CONTRACTS,
  GROUP_POT_ABI,
  SPLIT_SETTLER_ABI,
  ERC20_ABI,
} from "../contracts";
import { formatUnits, parseUnits, keccak256, encodePacked } from "viem";
import { API_URL, getInviteCode, saveInviteCode, deleteInviteCode, createInviteToken } from "../storage";
import { useGroupEvents } from "../hooks/useGroupEvents";


type Tab = "pot" | "split" | "members";

type GroupData = {
  name: string;
  creator: string;
  baseCurrency: string;
  fundingGoal: bigint;
  potBalance: bigint;
  closed: boolean;
  members: string[];
};

type RequestData = {
  id: number;
  requester: string;
  amount: bigint;
  description: string;
  approvalCount: number;
  rejectionCount: number;
  approvalsNeeded: number;
  status: number; // 0=Pending, 1=Approved, 2=Rejected, 3=Cancelled
  thresholdMet: boolean;
  userVote: number; // 0=None, 1=Approve, 2=Reject
};

export default function GroupDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, "GroupDetail">>();
  const navigation = useNavigation();
  const { groupId } = route.params;

  const [tab, setTab] = useState<Tab>("pot");
  const [group, setGroup] = useState<GroupData | null>(null);
  const [requests, setRequests] = useState<RequestData[]>([]);
  const [contributions, setContributions] = useState<Map<string, bigint>>(
    new Map()
  );
  const [balances, setBalances] = useState<{ member: string; balance: bigint }[]>([]);
  const [settlements, setSettlements] = useState<{ from: string; to: string; amount: bigint }[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [txLoading, setTxLoading] = useState(false);

  // Form states
  const [depositAmount, setDepositAmount] = useState("");
  const [depositCurrency, setDepositCurrency] = useState<"USDC" | "EURC">("USDC");
  const [reimbAmount, setReimbAmount] = useState("");
  const [reimbDesc, setReimbDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDesc, setExpenseDesc] = useState("");

  // Invite
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [storedInviteCode, setStoredInviteCode] = useState<string | null>(null);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const currencySymbol = (addr: string) =>
    addr.toLowerCase() === CONTRACTS.USDC.toLowerCase() ? "USDC" : "EURC";

  const userAddress = dynamicClient.wallets.primary?.address?.toLowerCase();

  const loadGroup = useCallback(async () => {
    try {
      const client = getPublicClient();
      const { name, creator, baseCurrency, fundingGoal, potBalance, closed, members } =
        await client.readContract({
          address: CONTRACTS.GROUP_POT,
          abi: GROUP_POT_ABI,
          functionName: "getGroupInfo",
          args: [BigInt(groupId)],
        });

      setGroup({
        name,
        creator,
        baseCurrency,
        fundingGoal,
        potBalance,
        closed,
        members: members as string[],
      });

      // Load contributions
      const contribs = new Map<string, bigint>();
      for (const m of members) {
        const c = await client.readContract({
          address: CONTRACTS.GROUP_POT,
          abi: GROUP_POT_ABI,
          functionName: "getContribution",
          args: [BigInt(groupId), m as `0x${string}`],
        });
        contribs.set(m.toLowerCase(), c as bigint);
      }
      setContributions(contribs);

      // Load requests
      const count = await client.readContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "getRequestCount",
        args: [BigInt(groupId)],
      });
      const reqs: RequestData[] = [];
      for (let i = 0; i < Number(count); i++) {
        const { requester, amount, description, approvalCount, rejectionCount, approvalsNeeded, status, thresholdMet } =
          await client.readContract({
            address: CONTRACTS.GROUP_POT,
            abi: GROUP_POT_ABI,
            functionName: "getRequestInfo",
            args: [BigInt(groupId), BigInt(i)],
          });
        let userVote = 0;
        if (userAddress) {
          userVote = Number(await client.readContract({
            address: CONTRACTS.GROUP_POT,
            abi: GROUP_POT_ABI,
            functionName: "getVote",
            args: [BigInt(groupId), BigInt(i), userAddress as `0x${string}`],
          }));
        }
        reqs.push({
          id: i,
          requester,
          amount,
          description,
          approvalCount: Number(approvalCount),
          rejectionCount: Number(rejectionCount),
          approvalsNeeded: Number(approvalsNeeded),
          status,
          thresholdMet,
          userVote,
        });
      }
      setRequests(reqs);

      // Load split balances
      const balsResult = await client.readContract({
        address: CONTRACTS.SPLIT_SETTLER,
        abi: SPLIT_SETTLER_ABI,
        functionName: "getBalances",
        args: [BigInt(groupId)],
      });
      const [balMembers, balAmounts] = balsResult as [string[], bigint[]];
      setBalances(
        balMembers.map((m, i) => ({ member: m, balance: balAmounts[i] }))
      );

      // Load calculated settlements
      const settlementsResult = await client.readContract({
        address: CONTRACTS.SPLIT_SETTLER,
        abi: SPLIT_SETTLER_ABI,
        functionName: "calculateSettlements",
        args: [BigInt(groupId)],
      });
      const rawSettlements = settlementsResult as { from: string; to: string; amount: bigint }[];
      setSettlements(rawSettlements.map((s) => ({ from: s.from, to: s.to, amount: s.amount })));
    } catch (err) {
      console.error("Failed to load group:", err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadGroup();
  }, [loadGroup]);

  useGroupEvents(groupId, () => {
    loadGroup();
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadGroup();
    setRefreshing(false);
  }, [loadGroup]);

  const shortAddr = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // ─── Actions ───────────────────────────────────────────────

  const handleDeposit = async () => {
    if (!depositAmount) return;
    setTxLoading(true);
    try {
      const walletClient = await getWalletClient();
      const amount = parseUnits(depositAmount, 6);
      const token =
        depositCurrency === "USDC" ? CONTRACTS.USDC : CONTRACTS.EURC;

      // Check existing allowance, only approve if insufficient
      const allowance = await getPublicClient().readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletClient.account.address, CONTRACTS.GROUP_POT],
      });

      if (allowance < amount) {
        const approveHash = await walletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.GROUP_POT, amount],
        });
        await getPublicClient().waitForTransactionReceipt({ hash: approveHash });
      }

      // Then deposit
      const depositHash = await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "deposit",
        args: [BigInt(groupId), amount, token],
      });
      await getPublicClient().waitForTransactionReceipt({ hash: depositHash });

      setDepositAmount("");
      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Deposit failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleRequestReimbursement = async () => {
    if (!reimbAmount || !reimbDesc) return;
    setTxLoading(true);
    try {
      const walletClient = await getWalletClient();
      const amount = parseUnits(reimbAmount, 6);

      const reimbHash = await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "requestReimbursement",
        args: [BigInt(groupId), amount, reimbDesc],
      });
      await getPublicClient().waitForTransactionReceipt({ hash: reimbHash });

      setReimbAmount("");
      setReimbDesc("");
      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Request failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleVote = async (requestId: number, approve: boolean) => {
    setTxLoading(true);
    try {
      const walletClient = await getWalletClient();
      const voteHash = await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "voteOnRequest",
        args: [BigInt(groupId), BigInt(requestId), approve],
      });
      await getPublicClient().waitForTransactionReceipt({ hash: voteHash });
      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? (approve ? "Approve failed" : "Reject failed"));
    } finally {
      setTxLoading(false);
    }
  };

  const handleAddExpense = async () => {
    if (!expenseAmount || !expenseDesc || !group) return;
    setTxLoading(true);
    try {
      const walletClient = await getWalletClient();
      const amount = parseUnits(expenseAmount, 6);

      const expHash = await walletClient.writeContract({
        address: CONTRACTS.SPLIT_SETTLER,
        abi: SPLIT_SETTLER_ABI,
        functionName: "addExpense",
        args: [
          BigInt(groupId),
          amount,
          expenseDesc,
          group.members as `0x${string}`[],
        ],
      });
      await getPublicClient().waitForTransactionReceipt({ hash: expHash });

      setExpenseAmount("");
      setExpenseDesc("");
      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Add expense failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleSettle = async (to: string) => {
    if (!group) return;
    setTxLoading(true);
    try {
      const walletClient = await getWalletClient();
      const token = group.baseCurrency as `0x${string}`;

      // Only approve if current allowance is insufficient
      const publicClient = getPublicClient();
      const allowance = await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [walletClient.account.address, CONTRACTS.SPLIT_SETTLER],
      }) as bigint;

      if (allowance < parseUnits("1000000", 6)) {
        const approveHash = await walletClient.writeContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACTS.SPLIT_SETTLER, parseUnits("1000000", 6)],
        });
        await getPublicClient().waitForTransactionReceipt({ hash: approveHash });
      }

      const settleHash = await walletClient.writeContract({
        address: CONTRACTS.SPLIT_SETTLER,
        abi: SPLIT_SETTLER_ABI,
        functionName: "settle",
        args: [BigInt(groupId), to as `0x${string}`],
      });
      await getPublicClient().waitForTransactionReceipt({ hash: settleHash });

      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Settlement failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleInvite = async () => {
    // Check if we already have a code stored
    const code = await getInviteCode(Number(groupId));
    if (code) {
      setStoredInviteCode(code);
      setPendingCode(null);
      setInviteModalVisible(true);
      refreshInviteUrl(code);
    } else {
      // Generate new code, show it to user before submitting tx
      const chars = "abcdefghijkmnpqrstuvwxyz23456789";
      const bytes = new Uint8Array(6);
      ExpoCrypto.getRandomValues(bytes);
      let newCode = "";
      for (let i = 0; i < 6; i++) {
        newCode += chars[bytes[i] % chars.length];
      }
      setPendingCode(newCode);
      setStoredInviteCode(null);
      setInviteModalVisible(true);
    }
  };

  const confirmInviteCode = async () => {
    if (!pendingCode) return;
    const code = pendingCode;
    // Close the modal first so Dynamic's transaction drawer appears on top
    setInviteModalVisible(false);
    try {
      setTxLoading(true);
      const walletClient = await getWalletClient();
      const hash = keccak256(encodePacked(["string"], [code]));
      const txHash = await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "updateInviteCode",
        args: [BigInt(groupId), hash],
      });
      await getPublicClient().waitForTransactionReceipt({ hash: txHash });
      await saveInviteCode(Number(groupId), code);
      setStoredInviteCode(code);
      setPendingCode(null);
      // Reopen modal to show the confirmed code
      setInviteModalVisible(true);
      refreshInviteUrl(code);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to set invite code");
      // Reopen modal so user can retry
      setInviteModalVisible(true);
    } finally {
      setTxLoading(false);
    }
  };

  const handleLockGroup = async () => {
    Alert.alert(
      "Lock Group",
      "No one will be able to join until you create a new invite. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Lock",
          style: "destructive",
          onPress: async () => {
            try {
              setTxLoading(true);
              const walletClient = await getWalletClient();
              const txHash = await walletClient.writeContract({
                address: CONTRACTS.GROUP_POT,
                abi: GROUP_POT_ABI,
                functionName: "updateInviteCode",
                args: [
                  BigInt(groupId),
                  "0x0000000000000000000000000000000000000000000000000000000000000000",
                ],
              });
              await getPublicClient().waitForTransactionReceipt({ hash: txHash });
              // Clear stored code
              await deleteInviteCode(Number(groupId));
              Alert.alert("Locked", "Group is now locked.");
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "Failed to lock group");
            } finally {
              setTxLoading(false);
            }
          },
        },
      ]
    );
  };

  const qrWatchRef = useRef<(() => void) | null>(null);

  const refreshInviteUrl = async (inviteCode?: string) => {
    // Clean up previous SSE watcher
    qrWatchRef.current?.();
    qrWatchRef.current = null;
    setQrUrl(null);

    const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
    if (!webUrl) {
      console.error("EXPO_PUBLIC_WEB_URL is not set");
      return;
    }
    try {
      // Ensure the server has the invite code (it may have restarted and lost in-memory state)
      const code = inviteCode || storedInviteCode || pendingCode;
      if (code) {
        await saveInviteCode(Number(groupId), code);
      }
      const token = await createInviteToken(Number(groupId));
      setQrUrl(`${webUrl}/join/${token}`);

      // Long-poll: watch for token consumption, then auto-refresh QR
      const controller = new AbortController();
      qrWatchRef.current = () => controller.abort();
      (async () => {
        try {
          while (!controller.signal.aborted) {
            const res = await fetch(
              `${API_URL}/api/invite-token/${token}/watch`,
              { signal: controller.signal }
            );
            const data = await res.json();
            if (data.event === "consumed") {
              refreshInviteUrl(code);
              return;
            }
            // "timeout" — re-poll
          }
        } catch {
          // aborted or network error — stop polling
        }
      })();
    } catch (e) {
      console.error("Failed to create invite token:", e);
    }
  };

  const handleShareLink = async () => {
    if (!storedInviteCode) return;
    const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
    let shareUrl = "";
    if (webUrl) {
      try {
        // Generate a fresh single-use token for each share
        await saveInviteCode(Number(groupId), storedInviteCode);
        const token = await createInviteToken(Number(groupId));
        shareUrl = `${webUrl}/join/${token}`;
      } catch (e) {
        console.error("Failed to create share token:", e);
      }
    }
    const message = shareUrl
      ? `Join "${group?.name}" on Settly!\n\n${shareUrl}`
      : `Join "${group?.name}" on Settly!\n\nGroup ID: ${groupId}\nInvite Code: ${storedInviteCode}`;
    try {
      await Share.share({ message });
    } catch {}
  };

  if (loading || !group) {
    return (
      <View className="flex-1 bg-white items-center justify-center">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const pendingRequests = requests.filter((r) => r.status === 0);
  const rejectedRequests = requests.filter((r) => r.status === 2);
  const myBalance = balances.find((b) => b.member.toLowerCase() === userAddress);
  const mySettlements = settlements.filter(
    (s) => s.from.toLowerCase() === userAddress
  );

  return (
    <View className="flex-1 bg-white pt-16">
      {/* Header */}
      <View className="px-6 mb-4">
        <Pressable onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate("Dashboard")} className="mb-2">
          <Text className="text-gray-500">← Back</Text>
        </Pressable>
        <Text className="text-2xl font-bold text-gray-900">{group.name}</Text>
        <Text className="text-sm text-gray-500">
          {formatUnits(group.potBalance, 6)} {currencySymbol(group.baseCurrency)}{" "}
          in pot · {group.members.length} members
        </Text>
      </View>

      {/* Tabs */}
      <View className="flex-row border-b border-gray-200 px-6">
        {(["pot", "split", "members"] as Tab[]).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            className={`flex-1 py-3 items-center ${
              tab === t ? "border-b-2 border-black" : ""
            }`}
          >
            <Text
              className={
                tab === t
                  ? "font-semibold text-gray-900"
                  : "text-gray-400"
              }
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {txLoading && (
        <View className="absolute inset-0 z-50 bg-black/40 items-center justify-center">
          <View className="bg-white rounded-2xl px-8 py-6 items-center">
            <ActivityIndicator size="large" />
            <Text className="text-gray-700 mt-3 font-medium">Processing transaction...</Text>
          </View>
        </View>
      )}

      <ScrollView
        className="flex-1 px-6 pt-4"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* ─── Pot Tab ─── */}
        {tab === "pot" && (
          <>
            {/* Deposit */}
            <Text className="font-semibold text-gray-900 mb-2">Deposit</Text>
            <View className="flex-row gap-2 mb-2">
              <TextInput
                value={depositAmount}
                onChangeText={setDepositAmount}
                placeholder="Amount"
                keyboardType="decimal-pad"
                className="flex-1 bg-gray-50 rounded-xl px-4 py-3"
              />
              <View className="flex-row gap-1">
                {(["USDC", "EURC"] as const).map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => setDepositCurrency(c)}
                    className={`rounded-xl px-3 py-3 ${
                      depositCurrency === c ? "bg-black" : "bg-gray-100"
                    }`}
                  >
                    <Text
                      className={
                        depositCurrency === c ? "text-white" : "text-gray-700"
                      }
                    >
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            <Pressable
              onPress={handleDeposit}
              className="bg-black rounded-xl py-3 items-center mb-6"
            >
              <Text className="text-white font-semibold">Deposit</Text>
            </Pressable>

            {/* Request Reimbursement */}
            <Text className="font-semibold text-gray-900 mb-2">
              Request Reimbursement
            </Text>
            <TextInput
              value={reimbAmount}
              onChangeText={setReimbAmount}
              placeholder="Amount"
              keyboardType="decimal-pad"
              className="bg-gray-50 rounded-xl px-4 py-3 mb-2"
            />
            <TextInput
              value={reimbDesc}
              onChangeText={setReimbDesc}
              placeholder="Description"
              className="bg-gray-50 rounded-xl px-4 py-3 mb-2"
            />
            <Pressable
              onPress={handleRequestReimbursement}
              className="bg-black rounded-xl py-3 items-center mb-6"
            >
              <Text className="text-white font-semibold">Submit Request</Text>
            </Pressable>

            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <>
                <Text className="font-semibold text-gray-900 mb-2">
                  Pending Requests
                </Text>
                {pendingRequests.map((r) => (
                  <View key={r.id} className="bg-gray-50 rounded-xl p-4 mb-2">
                    <Text className="font-medium text-gray-900">
                      {r.description}
                    </Text>
                    <Text className="text-sm text-gray-500">
                      {formatUnits(r.amount, 6)}{" "}
                      {currencySymbol(group.baseCurrency)} ·{" "}
                      {shortAddr(r.requester)}
                    </Text>
                    <Text className="text-sm text-gray-500">
                      {r.approvalCount}/{r.approvalsNeeded} approvals
                      {r.rejectionCount > 0
                        ? ` · ${r.rejectionCount}/${r.approvalsNeeded} rejections`
                        : ""}
                      {r.thresholdMet ? " · Awaiting funds" : ""}
                    </Text>
                    {r.requester.toLowerCase() !== userAddress && (
                      r.userVote !== 0 ? (
                        <Text className="text-sm text-gray-400 mt-2">
                          You {r.userVote === 1 ? "approved" : "rejected"} this request
                        </Text>
                      ) : (
                        <View className="flex-row gap-2 mt-2">
                          <Pressable
                            onPress={() => handleVote(r.id, true)}
                            className="flex-1 bg-black rounded-lg py-2 items-center"
                          >
                            <Text className="text-white font-semibold text-sm">
                              Approve
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => handleVote(r.id, false)}
                            className="flex-1 border border-red-300 rounded-lg py-2 items-center"
                          >
                            <Text className="text-red-500 font-semibold text-sm">
                              Reject
                            </Text>
                          </Pressable>
                        </View>
                      )
                    )}
                  </View>
                ))}
              </>
            )}

            {/* Rejected Requests */}
            {rejectedRequests.length > 0 && (
              <>
                <Text className="font-semibold text-gray-900 mb-2">
                  Rejected Requests
                </Text>
                {rejectedRequests.map((r) => (
                  <View key={r.id} className="bg-red-50 rounded-xl p-4 mb-2 opacity-70">
                    <Text className="font-medium text-gray-900">
                      {r.description}
                    </Text>
                    <Text className="text-sm text-gray-500">
                      {formatUnits(r.amount, 6)}{" "}
                      {currencySymbol(group.baseCurrency)} ·{" "}
                      {shortAddr(r.requester)}
                    </Text>
                    <Text className="text-sm text-red-500">
                      Disputed · {r.rejectionCount}/{r.approvalsNeeded} rejections
                    </Text>
                  </View>
                ))}
              </>
            )}
          </>
        )}

        {/* ─── Split Tab ─── */}
        {tab === "split" && (
          <>
            <Text className="font-semibold text-gray-900 mb-2">
              Add Expense
            </Text>
            <TextInput
              value={expenseAmount}
              onChangeText={setExpenseAmount}
              placeholder="Amount"
              keyboardType="decimal-pad"
              className="bg-gray-50 rounded-xl px-4 py-3 mb-2"
            />
            <TextInput
              value={expenseDesc}
              onChangeText={setExpenseDesc}
              placeholder="Description"
              className="bg-gray-50 rounded-xl px-4 py-3 mb-2"
            />
            <Text className="text-xs text-gray-400 mb-2">
              Split evenly among all members
            </Text>
            <Pressable
              onPress={handleAddExpense}
              className="bg-black rounded-xl py-3 items-center mb-6"
            >
              <Text className="text-white font-semibold">Add Expense</Text>
            </Pressable>

            {/* Your Balance */}
            <Text className="font-semibold text-gray-900 mb-2">Your Balance</Text>
            <View className="bg-gray-50 rounded-xl p-4 mb-4">
              <Text
                className={
                  (myBalance?.balance ?? 0n) > 0n
                    ? "text-green-600 text-xl font-bold text-center"
                    : (myBalance?.balance ?? 0n) < 0n
                    ? "text-red-500 text-xl font-bold text-center"
                    : "text-gray-400 text-xl font-bold text-center"
                }
              >
                {(myBalance?.balance ?? 0n) >= 0n ? "+" : ""}
                {formatUnits(myBalance?.balance ?? 0n, 6)}{" "}
                {currencySymbol(group.baseCurrency)}
              </Text>
              <Text className="text-gray-400 text-xs text-center mt-1">
                {(myBalance?.balance ?? 0n) > 0n
                  ? "Others owe you"
                  : (myBalance?.balance ?? 0n) < 0n
                  ? "You owe others"
                  : "All settled"}
              </Text>
            </View>

            {/* You Owe */}
            {mySettlements.length > 0 && (
              <>
                <Text className="font-semibold text-gray-900 mb-2">You Owe</Text>
                {mySettlements.map((s) => (
                  <View
                    key={s.to}
                    className="bg-red-50 rounded-xl p-4 mb-2 flex-row justify-between items-center"
                  >
                    <View>
                      <Text className="text-gray-900 font-medium">
                        {shortAddr(s.to)}
                      </Text>
                      <Text className="text-red-500 text-sm">
                        {formatUnits(s.amount, 6)} {currencySymbol(group.baseCurrency)}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleSettle(s.to)}
                      className="bg-black rounded-lg px-4 py-2"
                    >
                      <Text className="text-white font-semibold text-sm">Pay</Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            {/* Others Owe You */}
            {settlements.filter((s) => s.to.toLowerCase() === userAddress).length > 0 && (
              <>
                <Text className="font-semibold text-gray-900 mb-2 mt-2">Others Owe You</Text>
                {settlements
                  .filter((s) => s.to.toLowerCase() === userAddress)
                  .map((s) => (
                    <View
                      key={s.from}
                      className="bg-green-50 rounded-xl p-4 mb-2 flex-row justify-between items-center"
                    >
                      <View>
                        <Text className="text-gray-900 font-medium">
                          {shortAddr(s.from)}
                        </Text>
                        <Text className="text-green-600 text-sm">
                          {formatUnits(s.amount, 6)} {currencySymbol(group.baseCurrency)}
                        </Text>
                      </View>
                      <Text className="text-gray-400 text-sm">Pending</Text>
                    </View>
                  ))}
              </>
            )}
          </>
        )}

        {/* ─── Members Tab ─── */}
        {tab === "members" && (
          <>
            <View className="flex-row justify-between items-center mb-2">
              <Text className="font-semibold text-gray-900">Members</Text>
              <View className="flex-row gap-2">
                <Pressable
                  onPress={handleLockGroup}
                  className="border border-red-200 rounded-lg px-3 py-2"
                >
                  <Text className="text-red-500 text-sm font-semibold">Lock</Text>
                </Pressable>
                <Pressable
                  onPress={handleInvite}
                  className="bg-black rounded-lg px-4 py-2"
                >
                  <Text className="text-white text-sm font-semibold">Invite</Text>
                </Pressable>
              </View>
            </View>
            {group.members.map((m) => (
              <View
                key={m}
                className="flex-row justify-between py-3 border-b border-gray-100"
              >
                <View>
                  <Text className="text-gray-900">{shortAddr(m)}</Text>
                  {m.toLowerCase() === group.creator.toLowerCase() && (
                    <Text className="text-xs text-gray-400">Creator</Text>
                  )}
                </View>
                <Text className="text-gray-500">
                  {formatUnits(contributions.get(m.toLowerCase()) ?? 0n, 6)}{" "}
                  {currencySymbol(group.baseCurrency)}
                </Text>
              </View>
            ))}
          </>
        )}

        <View className="h-8" />
      </ScrollView>

      {/* Invite Modal */}
      <Modal
        visible={inviteModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { qrWatchRef.current?.(); setInviteModalVisible(false); }}
      >
        <View className="flex-1 bg-white pt-16 px-6">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-2xl font-bold text-gray-900">
              Invite Members
            </Text>
            <Pressable onPress={() => { qrWatchRef.current?.(); setInviteModalVisible(false); setPendingCode(null); }}>
              <Text className="text-gray-500 text-base">Close</Text>
            </Pressable>
          </View>

          {/* Step 1: Show generated code, ask to confirm */}
          {pendingCode && !storedInviteCode && (
            <>
              <Text className="text-gray-500 mb-4">
                A new invite code has been generated. Confirm to set it on-chain.
              </Text>
              <View className="bg-gray-50 rounded-xl p-6 items-center mb-6">
                <Text className="text-xs text-gray-400 mb-2">Invite Code</Text>
                <Text className="text-3xl font-bold text-gray-900 tracking-widest">
                  {pendingCode}
                </Text>
              </View>
              <Pressable
                onPress={confirmInviteCode}
                disabled={txLoading}
                className="bg-black rounded-xl py-4 items-center mb-3"
              >
                {txLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text className="text-white text-lg font-semibold">
                    Confirm & Set Code
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={async () => {
                  // Regenerate
                  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
                  const bytes = new Uint8Array(6);
                  ExpoCrypto.getRandomValues(bytes);
                  let c = "";
                  for (let i = 0; i < 6; i++) c += chars[bytes[i] % chars.length];
                  setPendingCode(c);
                }}
                className="rounded-xl py-4 items-center border border-gray-200"
              >
                <Text className="text-gray-700 text-base">Regenerate Code</Text>
              </Pressable>
            </>
          )}

          {/* Step 2: Code is live — show QR + share */}
          {storedInviteCode && (
            <>
              <View className="bg-gray-50 rounded-xl p-4 items-center mb-4">
                <Text className="text-xs text-gray-400 mb-1">Invite Code</Text>
                <Text className="text-2xl font-bold text-gray-900 tracking-widest">
                  {storedInviteCode}
                </Text>
              </View>

              {/* QR Code */}
              <View className="items-center mb-6">
                <View className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100" style={{ width: 232, height: 232, alignItems: "center", justifyContent: "center" }}>
                  {qrUrl ? (
                    <QrCodeSvg value={qrUrl} frameSize={200} />
                  ) : (
                    <ActivityIndicator size="small" />
                  )}
                </View>
                <Text className="text-sm text-gray-500 mt-3">
                  Scan to join {group?.name}
                </Text>
              </View>

              {/* Share Button */}
              <Pressable
                onPress={handleShareLink}
                className="bg-black rounded-xl py-4 items-center mb-3"
              >
                <Text className="text-white text-lg font-semibold">
                  Share via Message
                </Text>
              </Pressable>

              {/* Regenerate Code */}
              <Pressable
                onPress={async () => {
                  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
                  const bytes = new Uint8Array(6);
                  ExpoCrypto.getRandomValues(bytes);
                  let c = "";
                  for (let i = 0; i < 6; i++) c += chars[bytes[i] % chars.length];
                  setPendingCode(c);
                  setStoredInviteCode(null);
                }}
                className="rounded-xl py-4 items-center border border-gray-200"
              >
                <Text className="text-gray-700 text-base">Regenerate Code</Text>
              </Pressable>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}
