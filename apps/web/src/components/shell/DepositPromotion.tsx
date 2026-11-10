"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { bonusPercentForDeposit } from "@asm/client-core";
import { usePlatform } from "./PlatformProvider";
import { BonusOfferSheet } from "./PromoBanner";

export function DepositPromotion() {
  const { accounts, completedDeposits, focusMode } = usePlatform();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const pointerDown = useRef(false);
  const next = completedDeposits + 1;
  const key = `asm_deposit_offer:${accounts.map(a => a.id).sort().join(":")}:${next}`;
  const eligible = bonusPercentForDeposit(next) > 0;
  useEffect(() => {
    if (!eligible || focusMode || pathname !== "/trade") return;
    const down = () => { pointerDown.current = true; }, up = () => { pointerDown.current = false; };
    window.addEventListener("pointerdown", down, true); window.addEventListener("pointerup", up, true); window.addEventListener("pointercancel", up, true);
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      try {
        if (sessionStorage.getItem(key) || Date.now() - Number(localStorage.getItem(key) ?? 0) < 86400000) return;
      } catch { /* A blocked store still permits dismissal. */ }
      if (document.hidden || pointerDown.current || document.querySelector('[role="dialog"], [data-trade-busy="true"], [data-chart-editing="true"]') || document.activeElement?.matches("input, textarea, select")) {
        timer = setTimeout(check, 3000); return;
      }
      try { sessionStorage.setItem(key, "shown"); } catch { /* Optional persistence. */ }
      setOpen(true);
    };
    timer = setTimeout(check, 20000);
    return () => { clearTimeout(timer); window.removeEventListener("pointerdown", down, true); window.removeEventListener("pointerup", up, true); window.removeEventListener("pointercancel", up, true); };
  }, [key, eligible, focusMode, pathname]);
  if (!open || !eligible || focusMode) return null;
  return <BonusOfferSheet completedDeposits={completedDeposits} onClose={() => {
    setOpen(false); try { localStorage.setItem(key, String(Date.now())); } catch { /* Closing never depends on storage. */ }
  }} />;
}
