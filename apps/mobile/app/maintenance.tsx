import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { GateScreen } from "@/ui/GateScreen";

const POLL_MS = 30_000;

export default function Maintenance() {
  const { t } = useTranslation();
  useEffect(() => {
    // Any 2xx from /api/v1 clears the gate (api() resets it), and the gatekeeper then leaves this screen.
    const id = setInterval(() => {
      void api("/api/v1/app/config", { auth: false }).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);
  return <GateScreen testID="gate-maintenance" title={t("gate.maintenanceTitle")} body={t("gate.maintenanceBody")} />;
}
