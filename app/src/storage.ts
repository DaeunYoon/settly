import { getWalletClient } from "./viem";

export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

async function authHeaders(groupId: number): Promise<Record<string, string>> {
  const walletClient = await getWalletClient();
  const address = walletClient.account.address;
  const timestamp = String(Date.now());
  const message = `settly:${groupId}:${timestamp}`;
  const signature = await walletClient.signMessage({ message });
  return {
    "x-address": address,
    "x-signature": signature,
    "x-timestamp": timestamp,
  };
}

export async function saveInviteCode(
  groupId: number,
  code: string
): Promise<void> {
  const auth = await authHeaders(groupId);
  await fetch(`${API_URL}/api/invite/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ code }),
  });
}

export async function getInviteCode(
  groupId: number
): Promise<string | null> {
  try {
    const auth = await authHeaders(groupId);
    const res = await fetch(`${API_URL}/api/invite/${groupId}`, {
      headers: auth,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.code ?? null;
  } catch {
    return null;
  }
}

export async function deleteInviteCode(
  groupId: number
): Promise<void> {
  const auth = await authHeaders(groupId);
  await fetch(`${API_URL}/api/invite/${groupId}`, {
    method: "DELETE",
    headers: auth,
  });
}

export async function createInviteToken(
  groupId: number
): Promise<string> {
  const auth = await authHeaders(groupId);
  const res = await fetch(`${API_URL}/api/invite-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ groupId: String(groupId) }),
  });
  if (!res.ok) throw new Error("Failed to create invite token");
  const data = await res.json();
  return data.token;
}
