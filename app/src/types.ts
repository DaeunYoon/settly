export type RootStackParamList = {
  Login: undefined;
  WalletSetup: undefined;
  Dashboard: undefined;
  CreateGroup: undefined;
  JoinGroup: { groupId?: string; inviteCode?: string } | undefined;
  GroupDetail: { groupId: number };
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
