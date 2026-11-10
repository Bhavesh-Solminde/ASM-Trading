"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DIWALI_END, DIWALI_SEEN_KEY, isDiwali } from "@/lib/diwali";
import styles from "./FirstVisitDiwali.module.css";

const SEEN_COOKIE = "indianxtrade_diwali_2026_seen";
// Fallback for navigation/remounts when persistent storage is unavailable.
let seenInThisPage = false;

function hasSeenGreeting() {
  if (seenInThisPage) return true;
  try { if (localStorage.getItem(DIWALI_SEEN_KEY) === "1") return true; } catch { /* Try the cookie fallback. */ }
  return document.cookie.split(";").some(value => value.trim() === `${SEEN_COOKIE}=1`);
}

function rememberGreeting() {
  seenInThisPage = true;
  try { localStorage.setItem(DIWALI_SEEN_KEY, "1"); } catch { /* Cookie persists when local storage is blocked. */ }
  document.cookie = `${SEEN_COOKIE}=1; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export function DiwaliGreeting({ onDismiss, preview = false }: { onDismiss: () => void; preview?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const titleId = useId();
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    if (!preview) {
      element?.showModal();
      document.body.style.overflow = "hidden";
    } else if (element) element.open = true;
    const media = video.current;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let resumeAfterVisibility = false;
    const play = () => { if (media) void media.play().catch(() => setPaused(true)); };
    if (motion.matches) setPaused(true);
    else play();
    const visibility = () => {
      if (!media) return;
      if (document.hidden) { resumeAfterVisibility = !media.paused; media.pause(); }
      else if (resumeAfterVisibility && !media.ended) { resumeAfterVisibility = false; play(); }
    };
    const reduceMotion = () => { if (motion.matches) { media?.pause(); resumeAfterVisibility = false; } };
    document.addEventListener("visibilitychange", visibility);
    motion.addEventListener("change", reduceMotion);
    return () => {
      media?.pause();
      element?.close();
      document.removeEventListener("visibilitychange", visibility);
      motion.removeEventListener("change", reduceMotion);
      if (!preview) {
        document.body.style.overflow = previousOverflow;
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      }
    };
  }, [preview]);

  const toggleSound = async () => {
    const media = video.current;
    if (!media) return;
    const next = !muted;
    media.muted = next;
    setMuted(next);
    try { await media.play(); } catch { media.muted = true; setMuted(true); setPaused(true); }
  };

  return <dialog ref={dialog} open={preview || undefined} className={`${styles.dialog} ${preview ? styles.preview : ""}`} aria-labelledby={titleId} onCancel={onDismiss}>
    <header className={styles.header}>
      <h2 id={titleId}>A Diwali greeting for you</h2>
      <button type="button" onClick={onDismiss} autoFocus aria-label="Skip Diwali greeting">Skip <span aria-hidden="true">×</span></button>
    </header>
    <div className={styles.media}>
      <video ref={video} muted={muted} playsInline preload="metadata" poster="/festive/diwali-welcome-2026.jpg" aria-label="Spinning chakri, fireworks, and Happy Diwali wishes from IndianxTrade" onPlay={() => setPaused(false)} onPause={() => setPaused(true)} onEnded={() => { if (!preview) onDismiss(); }} onCanPlay={() => setFailed(false)} onError={() => { if (video.current?.error) { setFailed(true); setPaused(true); } }}>
        <source media="(max-width: 767px)" src="/festive/diwali-welcome-2026-720p.mp4" type="video/mp4" />
        <source src="/festive/diwali-welcome-2026-1080p.mp4" type="video/mp4" />
      </video>
      <p className="sr-only">Happy Diwali. May your home be filled with light and joy.</p>
    </div>
    <footer className={styles.footer}>
      <div className={styles.playback}>
        {!failed ? <button type="button" onClick={() => { const media = video.current; if (!media) return; if (media.paused) { if (media.ended) media.currentTime = 0; void media.play().catch(() => setPaused(true)); } else media.pause(); }}>{paused ? "Play greeting" : "Pause"}</button> : <span>Happy Diwali!</span>}
        {!failed ? <button type="button" aria-pressed={!muted} onClick={() => void toggleSound()}>{muted ? "Turn sound on" : "Mute sound"}</button> : null}
      </div>
      <button type="button" className={styles.continue} onClick={onDismiss}>Continue to website</button>
    </footer>
  </dialog>;
}

/** Mounted once in the root layout; revisits never mount or download the video. */
export function FirstVisitDiwali() {
  const pathname = usePathname();
  const allowed = !/^\/(admin|maintenance|diwali-preview)(\/|$)/.test(pathname);
  const [open, setOpen] = useState(false);
  const dismiss = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!allowed || !isDiwali()) { setOpen(false); return; }
    if (!hasSeenGreeting()) {
      rememberGreeting();
      setOpen(true);
    }
    const expire = () => { if (!isDiwali()) setOpen(false); };
    const timer = window.setTimeout(expire, DIWALI_END - Date.now());
    const anotherTab = (event: StorageEvent) => { if (event.key === DIWALI_SEEN_KEY && event.newValue === "1") setOpen(false); };
    window.addEventListener("storage", anotherTab);
    document.addEventListener("visibilitychange", expire);
    return () => { clearTimeout(timer); window.removeEventListener("storage", anotherTab); document.removeEventListener("visibilitychange", expire); };
  }, [allowed]);

  return open && allowed ? <DiwaliGreeting onDismiss={dismiss} /> : null;
}
