import { FIREWORK_BURSTS } from "./diwali";

export type SettledSound = "win" | "lose";

const MUTE_KEY = "asm.sound";
const muteListeners = new Set<() => void>();
export function subscribeSound(listener: () => void) {
  muteListeners.add(listener);
  const storage = () => listener();
  if (typeof window !== "undefined") window.addEventListener("storage", storage);
  return () => { muteListeners.delete(listener); if (typeof window !== "undefined") window.removeEventListener("storage", storage); };
}

/** Maps a settled trade's status to the sound it should play, if any. */
export function soundForSettled(status: string): SettledSound | null {
  if (status === "WON") return "win";
  if (status === "LOST") return "lose";
  return null;
}

/** True only if the user has explicitly muted sounds. Never throws. */
export function isMuted(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(MUTE_KEY) === "off";
  } catch {
    return false;
  }
}

/** Persists the mute preference. Swallows storage errors (private mode, SSR). */
export function setMuted(muted: boolean): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (muted) localStorage.setItem(MUTE_KEY, "off");
    else localStorage.removeItem(MUTE_KEY);
  } catch {
    // Storage unavailable — nothing to do.
  } finally {
    muteListeners.forEach(listener => listener());
  }
}

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let fireworkNoise: AudioBuffer | null = null;

/** Lazily creates (and resumes) the one shared AudioContext. Null when unsupported. */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Autoplay policies suspend a freshly created context until a user gesture;
  // settlement always follows one (opening the trade), so resume is safe here.
  void ctx.resume().catch(() => { /* The browser may require another user gesture. */ });
  return ctx;
}

/** Call from a user gesture so a later celebration can play on mobile too. */
export function unlockSound(): void {
  if (isMuted()) return;
  try { getContext(); } catch { /* Audio is optional when unavailable. */ }
}

/** Resume during the explicit celebration gesture; false means visual-only fallback. */
export async function prepareFestivalSound(): Promise<boolean> {
  if (isMuted()) return false;
  try { const audio = getContext(); if (!audio) return false; await audio.resume(); return audio.state === "running"; } catch { return false; }
}

/** Three soft firework pops with a trailing crackle, timed to the visual bursts. */
export function playFireworks(synchronized = false): () => void {
  const silent = () => {};
  if (isMuted() || (typeof document !== "undefined" && document.hidden)) return silent;
  try {
    const audio = getContext();
    if (!audio || audio.state === "closed") return silent;
    const nodes: AudioNode[] = [];
    const sources: (AudioBufferSourceNode | OscillatorNode)[] = [];
    const duration = 0.7;
    const buffer = fireworkNoise ?? audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
    const samples = buffer.getChannelData(0);
    // Deterministic noise for the crackle; no downloads or per-frame work.
    let seed = 0x1d1a11;
    for (let i = 0; !fireworkNoise && i < samples.length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      samples[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    }
    fireworkNoise = buffer;
    if (synchronized) {
      const hiss = audio.createBufferSource(); hiss.buffer = buffer;
      const gain = audio.createGain(); const t = audio.currentTime;
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(0.025, t + 0.1);
      gain.gain.linearRampToValueAtTime(0, t + 0.35);
      hiss.connect(gain); gain.connect(audio.destination); hiss.start(t); hiss.stop(t + 0.36);
      sources.push(hiss); nodes.push(hiss, gain);
    }
    for (let burst = 0; burst < 3; burst++) {
      const t = audio.currentTime + (synchronized ? FIREWORK_BURSTS[burst]!.delay : 0.025 + burst * 0.22);
      const noise = audio.createBufferSource();
      noise.buffer = buffer;
      const filter = audio.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(3200, t);
      filter.frequency.exponentialRampToValueAtTime(450, t + duration);
      const envelope = audio.createGain();
      envelope.gain.setValueAtTime(0, t);
      envelope.gain.linearRampToValueAtTime(0.16, t + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      noise.connect(filter); filter.connect(envelope); envelope.connect(audio.destination);
      noise.start(t); noise.stop(t + duration);
      const boom = audio.createOscillator();
      const bass = audio.createGain();
      boom.frequency.setValueAtTime(130, t);
      boom.frequency.exponentialRampToValueAtTime(40, t + 0.18);
      bass.gain.setValueAtTime(0, t);
      bass.gain.linearRampToValueAtTime(0.1, t + 0.006);
      bass.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      boom.connect(bass); bass.connect(audio.destination);
      boom.start(t); boom.stop(t + 0.23);
      nodes.push(noise, filter, envelope, boom, bass);
      sources.push(noise, boom);
    }
    const stop = () => {
      for (const source of sources) { try { source.stop(); } catch { /* Already finished. */ } }
      for (const node of nodes) node.disconnect();
    };
    return stop;
  } catch { return silent; }
}

/** Plays one short tone with a quick attack + exponential decay envelope. */
function blip(audio: AudioContext, freq: number, startAt: number, durationSec: number, peakGain: number) {
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audio.destination);

  const t = audio.currentTime + startAt;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peakGain, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationSec);

  osc.start(t);
  osc.stop(t + durationSec + 0.02);
}

/** Ascending C5-E5-G5 major triad, staggered — the "win" chime. */
export function playWin(): void {
  if (isMuted()) return;
  const audio = getContext();
  if (!audio) return;
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => blip(audio, freq, i * 0.07, 0.09, 0.15));
}

/** Descending G4-C4 tone — the soft "lose" sound. */
export function playLose(): void {
  if (isMuted()) return;
  const audio = getContext();
  if (!audio) return;
  blip(audio, 392, 0, 0.14, 0.12);
  blip(audio, 261.63, 0.13, 0.14, 0.12);
}

/** Plays the settlement sound for a trade's status, if it has one. */
export function playSettled(status: string): void {
  const sound = soundForSettled(status);
  if (sound === "win") playWin();
  else if (sound === "lose") playLose();
}
