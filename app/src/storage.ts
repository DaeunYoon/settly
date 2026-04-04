const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

export async function saveInviteCode(
  groupId: number,
  code: string
): Promise<void> {
  await fetch(`${API_URL}/api/invite/${groupId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

export async function getInviteCode(
  groupId: number
): Promise<string | null> {
  try {
    const res = await fetch(`${API_URL}/api/invite/${groupId}`);
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
  await fetch(`${API_URL}/api/invite/${groupId}`, { method: "DELETE" });
}
