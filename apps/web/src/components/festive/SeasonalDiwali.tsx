"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { DIWALI_START, DIWALI_END, isDiwali, diwaliRouteAllowed, isCelebratedWin, FIREWORK_BURSTS } from "@/lib/diwali";
import { festivalMotionEnabled, festivalSoundEnabled, subscribeFestivalPreferences } from "@/lib/festive-preferences";
import { claimFestivalWin, registerFestivalSettlement } from "@/lib/festive-settlement";
import { isMuted, subscribeSound } from "@/lib/sound";
import styles from "./SeasonalDiwali.module.css";

const Celebration = dynamic(() => import("./DiwaliCelebration"));
type Run = { id: string; serial: number } | null;
const Festival = createContext({ active: false, open: () => {}, win: null as Run, cancel: () => {} });

/** Seasonal state never subscribes to market prices or alters server results. */
export function SeasonalDiwali({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  const [win, setWin] = useState<Run>(null);
  const until = useRef(0);
  const serial = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stopSound = useRef<() => void>(() => {});
  const soundModule = useRef<typeof import("@/lib/festive-sound") | null>(null);
  const cancel = useCallback(() => {
    clearTimeout(timer.current); stopSound.current(); stopSound.current = () => {};
    until.current = 0; setWin(null);
  }, []);

  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout>;
    const update = () => {
      const now = Date.now();
      const eligible = process.env.NEXT_PUBLIC_DIWALI_ENABLED !== "false" && diwaliRouteAllowed(pathname) && isDiwali(now);
      setActive(eligible);
      if (!eligible || document.hidden) { setOpen(false); cancel(); }
      clearTimeout(expiry);
      const next = now < DIWALI_START ? DIWALI_START : DIWALI_END;
      if (next > now) expiry = setTimeout(update, Math.min(next - now, 2_147_000_000));
    };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { clearTimeout(expiry); cancel(); setOpen(false); document.removeEventListener("visibilitychange", update); };
  }, [pathname, cancel]);

  useEffect(() => {
    if (!active) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const preferences = () => {
      if (motion.matches || !festivalMotionEnabled()) cancel();
      if (!festivalSoundEnabled() || isMuted()) stopSound.current();
      // Fetch/decode only after the visitor has opted into festival sound.
      if (festivalSoundEnabled() && !soundModule.current) void import("@/lib/festive-sound").then(module => { soundModule.current = module; });
    };
    preferences();
    const unlock = () => {
      if (festivalSoundEnabled() && !isMuted() && !motion.matches) void import("@/lib/festive-sound").then(module => { soundModule.current = module; return module.prepareFireworkSound(); });
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock);
    const unpreferences = subscribeFestivalPreferences(preferences);
    const unmute = subscribeSound(preferences);
    motion.addEventListener("change", preferences);
    const unregister = registerFestivalSettlement(trade => {
      if (!isCelebratedWin(trade) || !/^\/trade(\/|$)/.test(pathname)) return false;
      // Consume even suppressed wins so they cannot appear after a modal closes.
      if (!claimFestivalWin(trade.id)) return true;
      if (!isDiwali() || document.hidden || motion.matches || !festivalMotionEnabled() || document.querySelector("dialog[open]") || Date.now() < until.current) return false;
      until.current = Date.now() + 2500;
      setWin({ id: trade.id, serial: ++serial.current });
      const stop = festivalSoundEnabled() && !isMuted() ? soundModule.current?.playFireworkSound(true) : null;
      if (stop) stopSound.current = stop;
      timer.current = setTimeout(cancel, 2400);
      return !!stop; // Only replace the ordinary win chime when festive audio starts.
    });
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); unregister(); unpreferences(); unmute(); motion.removeEventListener("change", preferences); cancel(); };
  }, [active, pathname, cancel]);

  const show = () => {
    if (!active || document.querySelector("dialog[open]")) return;
    cancel(); setOpen(true);
  };
  return <Festival.Provider value={{ active, open: show, win, cancel }}>
    {children}
    {active && open ? <Celebration onClose={() => setOpen(false)} /> : null}
  </Festival.Provider>;
}

export function DiyaIcon({ className }: { className?: string | undefined }) {
  return <svg className={className} viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3c-4 5-5 8-3 10 2 2 5 1 6-1 1-2-1-6-3-9Z" fill="currentColor"/><path d="M4 19h24c-2 7-6 10-12 10S6 26 4 19Z" fill="currentColor" opacity=".18"/><path d="M4 19h24c-2 7-6 10-12 10S6 26 4 19Zm2 0c5-3 15-3 20 0" fill="none" stroke="currentColor" strokeWidth="1.4"/></svg>;
}

export function FestiveLights() {
  const { active } = useContext(Festival);
  return active ? <span className={styles.lights} aria-hidden="true"><svg viewBox="0 0 1000 20" preserveAspectRatio="none"><path d="M0 3Q125 24 250 3Q375 24 500 3Q625 24 750 3Q875 24 1000 3"/></svg>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}</span> : null;
}

export function DiwaliEntry({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  const { active, open } = useContext(Festival);
  return active ? <button type="button" onClick={open} className={styles.entry} aria-label="Celebrate Diwali" aria-haspopup="dialog"><DiyaIcon />{iconOnly ? null : <span>{compact ? "Happy Diwali" : "Celebrate Diwali"}</span>}</button> : null;
}
export function DiwaliHero() {
  const { active } = useContext(Festival);
  return active ? <div className={styles.hero}><DiwaliEntry compact /></div> : null;
}
export function DiwaliWish() {
  const { active } = useContext(Festival);
  return active ? <p className={styles.wish}><DiyaIcon />Wishing you a joyful festival of lights.</p> : null;
}
export function WinDiwaliFireworks({ tradeId }: { tradeId: string }) {
  const { active, win, cancel } = useContext(Festival);
  const playing = active && win?.id === tradeId;
  useEffect(() => { if (playing) return cancel; }, [playing, cancel]);
  return active && win?.id === tradeId ? <span className={styles.win} key={win.serial} aria-hidden="true"><Fireworks compact /><span className={styles.winWish}>Happy Diwali</span></span> : null;
}

export function Fireworks({ compact = false }: { compact?: boolean }) {
  const points = compact ? FIREWORK_BURSTS.slice(0, 2).map((burst, i) => ({ ...burst, x: i ? "100%" : "0%", y: i ? "30%" : "15%" })) : FIREWORK_BURSTS;
  return <span className={styles.fireworks} aria-hidden="true">{points.map((burst, b) => <span key={b} className={styles.burst} style={{ "--x": burst.x, "--y": burst.y, "--delay": `${burst.delay}s` } as React.CSSProperties}><b className={styles.launch} />{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--angle": `${i * 30}deg`, "--distance": `${i % 2 ? 74 : 96}px` } as React.CSSProperties} />)}</span>)}</span>;
}
