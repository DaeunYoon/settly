import { useCallback, useEffect, useState } from "react";
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
import { getInviteCode, saveInviteCode, deleteInviteCode } from "../storage";


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
  const [loading, setLoading] = useState(true);
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
    } catch (err) {
      console.error("Failed to load group:", err);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadGroup();
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

      // Approve first
      await walletClient.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.GROUP_POT, amount],
      });

      // Then deposit
      await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "deposit",
        args: [BigInt(groupId), amount, token],
      });

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

      await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "requestReimbursement",
        args: [BigInt(groupId), amount, reimbDesc],
      });

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
      await walletClient.writeContract({
        address: CONTRACTS.GROUP_POT,
        abi: GROUP_POT_ABI,
        functionName: "voteOnRequest",
        args: [BigInt(groupId), BigInt(requestId), approve],
      });
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

      await walletClient.writeContract({
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

      setExpenseAmount("");
      setExpenseDesc("");
      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Add expense failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleSettleUp = async () => {
    if (!group) return;
    setTxLoading(true);
    try {
      const walletClient = await getWalletClient();
      const token = group.baseCurrency as `0x${string}`;

      // Approve settler to pull tokens
      await walletClient.writeContract({
        address: token,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [CONTRACTS.SPLIT_SETTLER, parseUnits("1000000", 6)],
      });

      await walletClient.writeContract({
        address: CONTRACTS.SPLIT_SETTLER,
        abi: SPLIT_SETTLER_ABI,
        functionName: "settleUp",
        args: [BigInt(groupId)],
      });

      loadGroup();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Settle up failed");
    } finally {
      setTxLoading(false);
    }
  };

  const handleInvite = async () => {
    // Check if we already have a code stored
    const code = await getInviteCode(groupId);
    if (code) {
      setStoredInviteCode(code);
      setPendingCode(null);
      setInviteModalVisible(true);
    } else {
      // Generate new code, show it to user before submitting tx
      const chars = "abcdefghijkmnpqrstuvwxyz23456789";
      let newCode = "";
      for (let i = 0; i < 6; i++) {
        newCode += chars[Math.floor(Math.random() * chars.length)];
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
      await saveInviteCode(groupId, code);
      setStoredInviteCode(code);
      setPendingCode(null);
      // Reopen modal to show the confirmed code
      setInviteModalVisible(true);
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
              await deleteInviteCode(groupId);
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

  const buildInviteUrl = (code: string) => {
    const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
    if (!webUrl) {
      console.error("EXPO_PUBLIC_WEB_URL is not set");
      return null;
    }
    return `${webUrl}/join/${groupId}/${encodeURIComponent(code)}`;
  };

  const handleShareLink = async () => {
    if (!storedInviteCode) return;
    const link = buildInviteUrl(storedInviteCode);
    const message = link
      ? `Join "${group?.name}" on Settly!\n\n${link}`
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
  const hasDebt = balances.some((b) => b.balance < 0n);

  return (
    <View className="flex-1 bg-white pt-16">
      {/* Header */}
      <View className="px-6 mb-4">
        <Pressable onPress={() => navigation.goBack()} className="mb-2">
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
        <View className="px-6 py-2 bg-gray-50">
          <ActivityIndicator />
        </View>
      )}

      <ScrollView className="flex-1 px-6 pt-4">
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

            {/* Balances */}
            <Text className="font-semibold text-gray-900 mb-2">Balances</Text>
            {balances.map((b) => (
              <View
                key={b.member}
                className="flex-row justify-between py-2 border-b border-gray-100"
              >
                <Text className="text-gray-700">{shortAddr(b.member)}</Text>
                <Text
                  className={
                    b.balance > 0n
                      ? "text-green-600 font-medium"
                      : b.balance < 0n
                      ? "text-red-500 font-medium"
                      : "text-gray-400"
                  }
                >
                  {b.balance >= 0n ? "+" : ""}
                  {formatUnits(b.balance, 6)}{" "}
                  {currencySymbol(group.baseCurrency)}
                </Text>
              </View>
            ))}

            {hasDebt && (
              <Pressable
                onPress={handleSettleUp}
                className="bg-black rounded-xl py-3 items-center mt-4"
              >
                <Text className="text-white font-semibold">Settle Up</Text>
              </Pressable>
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
        onRequestClose={() => setInviteModalVisible(false)}
      >
        <View className="flex-1 bg-white pt-16 px-6">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-2xl font-bold text-gray-900">
              Invite Members
            </Text>
            <Pressable onPress={() => { setInviteModalVisible(false); setPendingCode(null); }}>
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
                onPress={() => {
                  // Regenerate
                  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
                  let c = "";
                  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
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
                <View className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                  <QrCodeSvg
                    value={buildInviteUrl(storedInviteCode) ?? `settly://join/${groupId}/${storedInviteCode}`}
                    frameSize={200}
                  />
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
                onPress={() => {
                  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
                  let c = "";
                  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
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
