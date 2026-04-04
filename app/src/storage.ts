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
