import * as SecureStore from "expo-secure-store";

const INVITE_CODE_PREFIX = "invite_code_";

export async function saveInviteCode(
  groupId: number,
  code: string
): Promise<void> {
  await SecureStore.setItemAsync(`${INVITE_CODE_PREFIX}${groupId}`, code);
}

export async function getInviteCode(
  groupId: number
): Promise<string | null> {
  return SecureStore.getItemAsync(`${INVITE_CODE_PREFIX}${groupId}`);
}
