"use client";

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { FIREWORK_BURSTS } from "@/lib/diwali";
import { isMuted, playFireworks, setMuted, subscribeSound, prepareFestivalSound } from "@/lib/sound";
import styles from "./SeasonalDiwali.module.css";

const MOTION_KEY = "indianxtrade:diwali:2026:animation";
function readMotion() { try { return localStorage.getItem(MOTION_KEY) !== "off"; } catch { return true; } }

export default function DiwaliCelebration({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [running, setRunning] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [animation, setAnimation] = useState(true);
  const [muted, setMutedState] = useState(false);
  const [message, setMessage] = useState("Choose a little celebration, with sound or quietly.");
  const stopAudio = useRef<() => void>(() => {});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const busy = useRef(false);
  const generation = useRef(0);
  const cancel = useCallback(() => {
    generation.current++;
    stopAudio.current(); stopAudio.current = () => {};
    timers.current.forEach(clearTimeout); timers.current = [];
    busy.current = false;
    setRunning(false); setCooldown(false);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    const focus = document.activeElement;
    element?.showModal();
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preferences = () => {
      setReduced(motion.matches); setAnimation(readMotion());
      cancel();
    };
    preferences(); setMutedState(isMuted());
    const unsubscribe = subscribeSound(() => { setMutedState(isMuted()); if (isMuted()) stopAudio.current(); });
    const visibility = () => { if (document.hidden) cancel(); };
    const storage = (event: StorageEvent) => { if (event.key === MOTION_KEY || event.key === null) preferences(); };
    motion.addEventListener("change", preferences);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("storage", storage);
    return () => {
      cancel(); unsubscribe(); element?.close();
      motion.removeEventListener("change", preferences);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("storage", storage);
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [cancel]);

  const launch = async (sound: boolean) => {
    if (busy.current || reduced || !animation || document.hidden) return;
    busy.current = true;
    const token = generation.current;
    const audible = sound && !isMuted() ? await prepareFestivalSound() : false;
    if (token !== generation.current) return;
    if (audible && !isMuted()) stopAudio.current = playFireworks(true);
    setRunning(true); setCooldown(true);
    setMessage(audible ? "A little light and joy. Use Mute sound to stop the audio." : sound ? "Sound could not start. Enjoy the lights, or try again." : "A little light and joy, quietly.");
    timers.current = [setTimeout(() => { setRunning(false); stopAudio.current(); }, 3000), setTimeout(() => { busy.current = false; setCooldown(false); }, 5000)];
  };
  const toggleAnimation = () => {
    const next = !animation;
    setAnimation(next); cancel();
    try { localStorage.setItem(MOTION_KEY, next ? "on" : "off"); } catch { /* Use in-memory state. */ }
  };
  const disabled = cooldown || reduced || !animation;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={onClose}>
    <header className={styles.heading}><h2 id={titleId}>A little Diwali celebration</h2><button type="button" onClick={onClose} autoFocus aria-label="Close Diwali celebration">Close ×</button></header>
    <div className={styles.scene}>
      {running ? FIREWORK_BURSTS.map((burst, b) => <span key={b} className={styles.burst} aria-hidden="true" style={{ "--x": burst.x, "--y": burst.y, "--delay": `${burst.delay}s` } as CSSProperties}>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--angle": `${i * 30}deg` } as CSSProperties} />)}</span>) : null}
      <svg width="40" height="44" viewBox="0 0 24 26" className={styles.diya} aria-hidden="true"><path d="M12 2c-3 4-4 6-3 8s5 2 6 0-1-5-3-8Z" fill="currentColor" /><path d="M3 14h18c-1 5-4 7-9 7s-8-2-9-7Z" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><strong>Happy Diwali</strong><p>May your home be filled with light and joy.</p>
    </div>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={disabled || muted} onClick={() => void launch(true)}>Celebrate with sound</button>
      <button type="button" disabled={disabled} onClick={() => void launch(false)}>Play quietly</button>
      <button type="button" aria-pressed={!muted} onClick={() => { const next = !muted; if (next) stopAudio.current(); setMuted(next); setMutedState(next); }}>{muted ? "Unmute site sounds" : "Mute sound"}</button>
      <button type="button" aria-pressed={animation} onClick={toggleAnimation}>Animation {animation ? "on" : "off"}</button>
    </div>
    <p className={styles.status} role="status">{reduced ? "Your device prefers reduced motion. Enjoy a quiet Diwali greeting." : !animation ? "Animation is off. Wishing you a peaceful Diwali." : muted ? "Site sounds are muted. You can still play quietly." : message}</p>
  </dialog>;
}
