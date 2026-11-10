"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { DIWALI_START, DIWALI_END, isDiwali, diwaliRouteAllowed } from "@/lib/diwali";
import styles from "./SeasonalDiwali.module.css";

const Celebration = dynamic(() => import("./DiwaliCelebration"));
const Festival = createContext({ active: false, open: () => {} });

/** No price subscriptions: children retain their existing server/client boundaries. */
export function SeasonalDiwali({ children, preview = false }: { children: ReactNode; preview?: boolean }) {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = Date.now();
      const eligible = preview || (process.env.NEXT_PUBLIC_DIWALI_ENABLED !== "false" && diwaliRouteAllowed(pathname) && isDiwali(now));
      setActive(eligible);
      if (!eligible || document.hidden) setOpen(false);
      clearTimeout(timer);
      const next = now < DIWALI_START ? DIWALI_START : DIWALI_END;
      if (!preview && next > now) timer = setTimeout(update, Math.min(next - now, 2_147_000_000));
    };
    setOpen(false);
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [pathname, preview]);
  return <Festival.Provider value={{ active, open: () => setOpen(true) }}>
    {children}
    {active && open ? <Celebration onClose={() => setOpen(false)} /> : null}
  </Festival.Provider>;
}

export function FestiveLights() {
  const { active } = useContext(Festival);
  return active ? <span className={styles.lights} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span> : null;
}

export function DiwaliEntry({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  const { active, open } = useContext(Festival);
  return active ? <button type="button" onClick={open} className={styles.entry} aria-label="Celebrate Diwali" aria-haspopup="dialog">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c-3 4-4 6-3 8s5 2 6 0-1-5-3-8Z" fill="currentColor" /><path d="M3 14h18c-1 5-4 7-9 7s-8-2-9-7Z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
    {iconOnly ? null : <span>{compact ? "Happy Diwali" : "Celebrate Diwali"}</span>}
  </button> : null;
}

export function DiwaliWish() {
  const { active } = useContext(Festival);
  return active ? <p className={styles.wish}>Wishing you a joyful festival of lights.</p> : null;
}
