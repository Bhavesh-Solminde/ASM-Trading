import { useRef, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { queryClient } from "@/api/queries";
import { refreshBootstrap } from "@/api/refresh-bootstrap";
import { useSession } from "@/auth/session-store";
import { toast } from "@/ui/Toast";
import { DEMO_RESET_TIMEOUT_MS, createDemoResetSubmitter } from "./demo-reset";

/**
 * "Reset demo balance": the confirm Alert, then the money-moving POST (see `createDemoResetSubmitter`). The caller
 * passes the DEMO account's id (`demoAccountId`); nothing here can reach the LIVE account.
 */
export function useDemoReset() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // Built once: its in-flight flag must survive re-renders. It reads the latest `t` from here.
  const latestT = useRef(t);
  latestT.current = t;
  const submitter = useRef<ReturnType<typeof createDemoResetSubmitter> | null>(null);
  if (submitter.current === null) {
    submitter.current = createDemoResetSubmitter({
      post: (accountId) => api("/api/account/demo-balance", { method: "POST", body: { accountId }, timeoutMs: DEMO_RESET_TIMEOUT_MS }),
      refresh: () => refreshBootstrap(queryClient),
      toast,
      session: () => useSession.getState().token,
      setBusy,
      t: (key) => latestT.current(key),
    });
  }

  const confirmReset = (demoId: string) => {
    Alert.alert(t("account.resetDemoTitle"), t("account.resetDemoBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("account.resetDemoConfirm"), style: "destructive", onPress: () => void submitter.current?.(demoId) },
    ]);
  };

  return { busy, confirmReset };
}
