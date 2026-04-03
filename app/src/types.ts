export type RootStackParamList = {
  Login: undefined;
  WalletSetup: undefined;
  Home: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
