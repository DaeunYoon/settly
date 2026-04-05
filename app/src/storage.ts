export const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

let _cachedToken: string | null = null;

/** Call this from a React component that has access to the reactive auth state. */
export function setAuthToken(token: string | null) {
  _cachedToken = token;
}

function authHeaders(): Record<string, string> {
  if (!_cachedToken) throw new Error("Not authenticated");
  return { Authorization: `Bearer ${_cachedToken}` };
}

export async function saveInviteCode(
  groupId: number,
  code: string
): Promise<void> {
  if (typeof groupId !== "number" || !Number.isFinite(groupId)) {
    throw new Error(`saveInviteCode: groupId must be a number, got ${typeof groupId}: ${groupId}`);
  }
  const auth = authHeaders();
  const res = await fetch(`${API_URL}/api/invite/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("saveInviteCode failed:", res.status, text);
  }
}

export async function getInviteCode(
  groupId: number
): Promise<string | null> {
  try {
    const auth = authHeaders();
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
  const auth = authHeaders();
  await fetch(`${API_URL}/api/invite/${groupId}`, {
    method: "DELETE",
    headers: auth,
  });
}

export async function createInviteToken(
  groupId: number
): Promise<string> {
  const auth = authHeaders();
  const res = await fetch(`${API_URL}/api/invite-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...auth },
    body: JSON.stringify({ groupId: String(groupId) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create invite token: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.token;
}

// ─── Yield Farming API ──────────────────────────────────────

// Phase enum: 0=Idle, 1=EnableVoting, 2=EnableApproved, 3=Active, 4=WithdrawVoting, 5=WithdrawApproved
export type YieldStatus = {
  strategy: number;
  phase: number;
  bridgedAmount: string;
  currentValue: string;
  yieldPercent: string;
  lastUpdated: number;
  enableVoteCount: number;
  withdrawVoteCount: number;
  votesNeeded: number;
  userHasVotedEnable: boolean;
  userHasVotedWithdraw: boolean;
  canPropose: boolean;
  breakdown: {
    strategy: number;
    msUSDS_value: string;
    msUSDe_value: string;
    weth_value: string;
    totalUsdcValue: string;
  } | null;
  swapTxs: Array<{
    timestamp: string;
    txHash: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
    explorerUrl: string;
  }>;
};

export async function enableYield(
  groupId: number,
  strategy: number
): Promise<{ success: boolean; bridgedAmount: string; swapTxs: unknown[] }> {
  const res = await fetch(`${API_URL}/api/yield/enable`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: String(groupId), strategy }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Enable yield failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function getYieldStatus(
  groupId: number
): Promise<YieldStatus> {
  const res = await fetch(`${API_URL}/api/yield/status/${groupId}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yield status failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function withdrawYield(
  groupId: number
): Promise<{ success: boolean; returnedAmount: string; yieldEarned: string }> {
  const res = await fetch(`${API_URL}/api/yield/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: String(groupId) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yield withdraw failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function topUpYield(
  groupId: number
): Promise<{ success: boolean; topUpAmount: string }> {
  const res = await fetch(`${API_URL}/api/yield/topup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: String(groupId) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yield top-up failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function simulateYield(
  seconds: number
): Promise<{ success: boolean; simulatedDays: string }> {
  const res = await fetch(`${API_URL}/api/yield/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ seconds }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yield simulate failed: ${res.status} ${text}`);
  }
  return res.json();
}
