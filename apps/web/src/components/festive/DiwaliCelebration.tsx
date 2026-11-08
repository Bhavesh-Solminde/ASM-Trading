"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { isMuted, setMuted, subscribeSound } from "@/lib/sound";
import { FESTIVAL_MOTION_KEY, FESTIVAL_SOUND_KEY, festivalMotionEnabled, festivalSoundEnabled, setFestivalPreference, subscribeFestivalPreferences } from "@/lib/festive-preferences";
import { prepareFireworkSound, playFireworkSound } from "@/lib/festive-sound";
import { DiyaIcon, Fireworks } from "./SeasonalDiwali";
import styles from "./SeasonalDiwali.module.css";

export default function DiwaliCelebration({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [running, setRunning] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [animation, setAnimation] = useState(true);
  const [muted, setMutedState] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [message, setMessage] = useState("A little light, a little joy.");
  const busy = useRef(false);
  const generation = useRef(0);
  const stopAudio = useRef<() => void>(() => {});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancel = useCallback(() => {
    generation.current++; stopAudio.current(); stopAudio.current = () => {};
    timers.current.forEach(clearTimeout); timers.current = [];
    busy.current = false; setRunning(false); setCooldown(false);
  }, []);
  useEffect(() => {
    const element = dialog.current; const focus = document.activeElement;
    const overflow = document.body.style.overflow;
    element?.showModal(); document.body.style.overflow = "hidden";
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    const preferences = () => {
      setReduced(motion.matches); setAnimation(festivalMotionEnabled()); setSoundOn(festivalSoundEnabled()); setMutedState(isMuted());
      if (motion.matches || !festivalMotionEnabled()) cancel();
      if (isMuted() || !festivalSoundEnabled()) stopAudio.current();
    };
    preferences();
    const unsubscribe = subscribeSound(preferences);
    const unpreferences = subscribeFestivalPreferences(preferences);
    const visibility = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", visibility); motion.addEventListener("change", preferences);
    return () => {
      cancel(); unsubscribe(); unpreferences(); element?.close(); document.body.style.overflow = overflow;
      document.removeEventListener("visibilitychange", visibility); motion.removeEventListener("change", preferences);
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, [cancel]);
  const launch = async (sound: boolean) => {
    if (busy.current || reduced || !animation || document.hidden) return;
    busy.current = true;
    const token = generation.current;
    const ready = sound && !isMuted() ? await prepareFireworkSound() : false;
    if (token !== generation.current) return;
    if (ready && !isMuted()) {
      setFestivalPreference(FESTIVAL_SOUND_KEY, true); setSoundOn(true);
      stopAudio.current = playFireworkSound() ?? (() => {});
    }
    setRunning(true); setCooldown(true);
    setMessage(ready ? "Light and joy, with a little sparkle." : sound ? "Sound couldn't start. You can try again." : "A little celebration, quietly.");
    timers.current = [setTimeout(() => { setRunning(false); stopAudio.current(); }, 3000), setTimeout(() => { busy.current = false; setCooldown(false); }, 5000)];
  };
  const disabled = cooldown || reduced || !animation;
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onCancel={onClose}>
    <header className={styles.heading}><span>Festival of lights</span><button type="button" onClick={onClose} autoFocus aria-label="Close Diwali celebration">×</button></header>
    <div className={styles.scene}>
      {running ? <Fireworks /> : null}
      <span className={styles.halo} aria-hidden="true" /><DiyaIcon className={styles.diya} />
      <h2 id={title}>Happy Diwali</h2><p>May your home be filled<br />with light and joy.</p>
      <span className={styles.signature}>Warm wishes from IndianxTrade</span>
    </div>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={disabled || muted} onClick={() => void launch(true)}>Celebrate with sound</button>
      <button type="button" disabled={disabled} onClick={() => void launch(false)}>Play quietly</button>
    </div>
    <div className={styles.preferences}>
      {muted ? <button type="button" onClick={() => setMuted(false)}>Unmute site sounds</button> : <button type="button" aria-pressed={soundOn} onClick={async () => { if (soundOn) { stopAudio.current(); setFestivalPreference(FESTIVAL_SOUND_KEY, false); setSoundOn(false); } else { const ready = await prepareFireworkSound(); if (ready) { setFestivalPreference(FESTIVAL_SOUND_KEY, true); setSoundOn(true); } else setMessage("Sound could not start. Try Celebrate with sound."); } }}>Festival sound {soundOn ? "on" : "off"}</button>}
      <button type="button" aria-pressed={animation} onClick={() => { setFestivalPreference(FESTIVAL_MOTION_KEY, !animation); setAnimation(!animation); cancel(); }}>Animation {animation ? "on" : "off"}</button>
    </div>
    <p className={styles.status} role="status">{reduced ? "Reduced motion is on. Wishing you a peaceful Diwali." : !animation ? "Animation is off. Enjoy the quiet glow." : muted ? "Site sounds are muted. You can play quietly." : message}</p>
  </dialog>;
}
