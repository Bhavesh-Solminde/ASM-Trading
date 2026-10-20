import { View } from "react-native";
import { useBootstrap } from "@/api/queries";
import { useSession } from "@/auth/session-store";
import { Skeleton } from "@/theme/ui";
import { AppHeader } from "@/ui/AppHeader";
import { BrandMark } from "@/ui/Brand";
import { accountOfType, bootstrapTradesAccountId, canUseLive, resolveAccount, type AppAccount } from "./accounts";
import { listLoadedFor, useListLoaded } from "./list-loaded-store";
import { TopBar } from "./TopBar";
import { useUserPrefs } from "./trade-prefs";

/**
 * The shared app header on Payments, History and Account: the very TopBar Trade shows. It reads which account's
 * trade list is complete from the store Trade publishes to and NEVER fetches (`useAccountTradesLoaded` lives in
 * Trade alone), so a tab switch costs no `GET /api/trades`. Before bootstrap it is the plain header with a skeleton.
 */
export function TabHeader() {
  const token = useSession((s) => s.token);
  const boot = useBootstrap(!!token).data;
  const prefs = useUserPrefs(boot?.userId ?? null);
  const loadedFor = useListLoaded((s) => s.loadedFor);

  const account = boot ? resolveAccount(boot.accounts, prefs.accountId, boot.liveAccess) : undefined;
  if (!boot || !account) {
    return (
      <AppHeader>
        <BrandMark width={34} />
        <View style={{ flex: 1 }} />
        <Skeleton height={20} width={120} />
      </AppHeader>
    );
  }

  const selectAccountType = (type: AppAccount["type"]) => {
    const target = accountOfType(boot.accounts, type);
    if (target) prefs.set({ accountId: target.id });
  };
  return (
    <TopBar
      account={account}
      liveEnabled={canUseLive(boot.accounts, boot.liveAccess)}
      onSelectType={selectAccountType}
      listLoaded={listLoadedFor(loadedFor, account.id, bootstrapTradesAccountId(boot.accounts))}
    />
  );
}
