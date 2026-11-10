"use client";

import { createContext, useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { DIWALI_END, DIWALI_SEEN_KEY, isDiwali } from "@/lib/diwali";
import { SITE_NAME } from "@/lib/site";
import { playFireworks } from "@/lib/sound";
import { LogoWordmark } from "@/components/brand/Logo";
import styles from "./Diwali.module.css";

const Festival = createContext(false);

function Diya() {
  return <span className={styles.diya} aria-hidden="true"><span className={styles.flame} /><span className={styles.bowl} /></span>;
}

/** Fixed, bounded CSS particles: no animation loop or subscriptions to ticks. */
function Sparks() {
  return <span className={styles.sparks} aria-hidden="true">{Array.from({ length: 3 }, (_, burst) => (
    <span className={styles.burst} key={burst} style={{ "--burst": burst } as CSSProperties}>
      {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ "--angle": `${i * 30}deg` } as CSSProperties} />)}
    </span>
  ))}</span>;
}

function VideoGreeting({ variant, onDismiss, generation = "draft", withTypography = false }: { variant: "desktop" | "mobile"; onDismiss: () => void; generation?: "draft" | "kling4"; withTypography?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setVideoMuted] = useState(true);
  const [greetingReady, setGreetingReady] = useState(false);
  const source = generation === "kling4" ? `/festive/diwali-kling4-1080p-${variant}` : `/festive/diwali-2026-${variant}`;
  useEffect(() => {
    const element = video.current;
    if (element) element.volume = 0.65;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (document.hidden || motion.matches) {
        element?.pause();
        if (motion.matches) setGreetingReady(true);
      }
      else if (element && !element.ended) void element.play().catch(() => { /* The poster remains readable. */ });
    };
    update();
    motion.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      element?.pause();
      motion.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  const replay = (withSound = false) => {
    const element = video.current;
    if (!element) return;
    if (withSound) { element.muted = false; setVideoMuted(false); }
    element.currentTime = 0;
    setGreetingReady(false);
    void element.play().catch(() => { element.muted = true; setVideoMuted(true); });
  };
  return <div className={styles.videoScene} data-greeting={withTypography && greetingReady}>
    <video ref={video} className={styles.greetingVideo} src={`${source}.mp4`} poster={`${source}.jpg`} muted={muted} playsInline preload="auto" aria-hidden="true" onTimeUpdate={() => setGreetingReady((video.current?.currentTime ?? 0) >= 2.7)} onEnded={() => setGreetingReady(true)} />
    <h1 id="diwali-title" className="sr-only">Happy Diwali from IndianxTrade</h1>
    <p id="diwali-message" className="sr-only">May your home be filled with light, and your celebrations with joy.</p>
    {withTypography && greetingReady ? <div className={styles.videoCopy} aria-hidden="true">
      <LogoWordmark compact className={styles.wordmark ?? ""} />
      <div className={styles.title}>Happy<br /><span>Diwali</span></div>
      <p className={styles.message}>May your home be filled with light,<br />and your celebrations with joy.</p>
    </div> : null}
    <button type="button" className={styles.skip} onClick={onDismiss} autoFocus>Skip greeting ×</button>
    <div className={styles.videoActions}>
      <button type="button" className={styles.skip} onClick={() => replay()}>Replay video</button>
      {generation === "kling4" ? <button type="button" className={styles.skip} aria-pressed={!muted} onClick={() => { if (muted) replay(true); else { if (video.current) video.current.muted = true; setVideoMuted(true); } }}>{muted ? "Replay with sound" : "Mute sound"}</button> : null}
      <button type="button" className={styles.continue} onClick={onDismiss}>Continue to website</button>
    </div>
  </div>;
}

export function DiwaliProvider({ children, preview = false, greetingVideo, generation = "draft", withTypography = false }: { children: React.ReactNode; preview?: boolean; greetingVideo?: "desktop" | "mobile"; generation?: "draft" | "kling4"; withTypography?: boolean }) {
  const pathname = usePathname();
  const allowed = !/^\/(admin|maintenance)(\/|$)/.test(pathname);
  const [active, setActive] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!allowed || (!preview && !isDiwali())) { setActive(false); setOpen(false); return; }
    setActive(true);
    if (preview) { setOpen(true); return; }
    let seen = false;
    try { seen = localStorage.getItem(DIWALI_SEEN_KEY) === "1"; } catch { /* Storage may be blocked. */ }
    if (!seen) setOpen(true);
    const end = window.setTimeout(() => { setActive(false); setOpen(false); }, DIWALI_END - Date.now());
    const onVisible = () => { if (!isDiwali()) { setActive(false); setOpen(false); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(end); document.removeEventListener("visibilitychange", onVisible); };
  }, [allowed, preview]);

  useEffect(() => {
    if (!open || !active || !allowed) return;
    const element = dialog.current;
    if (!preview) element?.showModal();
    if (!preview) { try { localStorage.setItem(DIWALI_SEEN_KEY, "1"); } catch { /* The greeting still works. */ } }
    const previousFocus = document.activeElement;
    // Hold the final greeting in the review page until the viewer dismisses it.
    const timeout = preview ? undefined : window.setTimeout(() => setOpen(false), 11000);
    return () => {
      clearTimeout(timeout);
      element?.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open, active, allowed, preview]);

  return <Festival.Provider value={active && allowed}>
    {children}
    {active && allowed ? <>
      <div className={styles.edge} style={preview ? { position: "absolute" } : undefined} aria-hidden="true" />
      <button type="button" className={styles.badge} style={preview ? { position: "absolute" } : undefined} onClick={() => setOpen(true)} aria-label="Replay the Happy Diwali greeting"><Diya /><span>Happy Diwali</span></button>
      {open ? <dialog ref={dialog} open={preview || undefined} className={`${styles.dialog} ${preview ? styles.preview : ""}`} aria-labelledby="diwali-title" aria-describedby="diwali-message" onCancel={() => setOpen(false)} onClose={() => setOpen(false)}>
        {greetingVideo ? <VideoGreeting variant={greetingVideo} generation={generation} withTypography={withTypography} onDismiss={() => setOpen(false)} /> : <div className={styles.scene}>
          <button type="button" className={styles.skip} onClick={() => setOpen(false)} autoFocus>Skip greeting ×</button>
          <span className={styles.chakra} aria-hidden="true" />
          <div className={styles.reveal}>
            <Sparks />
            <LogoWordmark compact className={styles.wordmark ?? ""} />
            <p className={styles.from}>With warm wishes from {SITE_NAME}</p>
            <h1 id="diwali-title" className={styles.title}>Happy<br /><span>Diwali</span></h1>
            <p id="diwali-message" className={styles.message}>May your home be filled with light,<br />and your celebrations with joy.</p>
            <div className={styles.lamps}><Diya /><Diya /><Diya /></div>
            <button type="button" className={styles.continue} onClick={() => setOpen(false)}>Continue to website</button>
          </div>
        </div>}
      </dialog> : null}
    </> : null}
  </Festival.Provider>;
}

// Deduplicate remounts/replayed settlement messages without an unbounded history.
const celebrated = new Set<string>();
export function DiwaliWinFireworks({ tradeId }: { tradeId: string }) {
  const active = useContext(Festival);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active || !isDiwali() || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce)").matches || celebrated.has(tradeId)) return;
    celebrated.add(tradeId);
    if (celebrated.size > 100) celebrated.delete(celebrated.values().next().value!);
    setShow(true);
    const stopSound = playFireworks();
    const stop = () => { setShow(false); stopSound(); };
    const timer = window.setTimeout(stop, 2200);
    document.addEventListener("visibilitychange", stop);
    return () => { clearTimeout(timer); stopSound(); document.removeEventListener("visibilitychange", stop); };
  }, [active, tradeId]);
  return active && show ? <span className={styles.win} key={tradeId}><Sparks /></span> : null;
}
