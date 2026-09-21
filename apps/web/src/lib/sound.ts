export type SettledSound = "win" | "lose";

const MUTE_KEY = "asm.sound";

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
  }
}

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

/** Lazily creates (and resumes) the one shared AudioContext. Null when unsupported. */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  // Autoplay policies suspend a freshly created context until a user gesture;
  // settlement always follows one (opening the trade), so resume is safe here.
  void ctx.resume();
  return ctx;
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
