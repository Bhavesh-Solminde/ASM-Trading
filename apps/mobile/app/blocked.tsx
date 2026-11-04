import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useSession } from "@/auth/session-store";
import { useGate } from "@/gate/gate-store";
import { Button } from "@/theme/ui";
import { GateScreen } from "@/ui/GateScreen";

export default function Blocked() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      // /bootstrap runs the VPN guard, so it only succeeds once the block is gone. Signed out there is no
      // guarded GET to probe, so /app/config (always open) is used and Retry may clear the gate early;
      // the next guarded call re-blocks.
      if (useSession.getState().token) await api("/api/v1/bootstrap");
      else await api("/api/v1/app/config", { auth: false });
      // Only a request that got through proves the block is gone.
      useGate.getState().setGate("ok");
    } catch {
      // Still blocked or offline: the gate stays and this screen explains why.
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateScreen title={t("gate.blockedTitle")} body={t("gate.blockedBody")}>
      <Button label={t("common.retry")} onPress={retry} busy={busy} />
    </GateScreen>
  );
}
