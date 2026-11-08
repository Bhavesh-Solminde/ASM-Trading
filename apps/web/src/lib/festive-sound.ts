import { getSoundContext, isMuted } from "./sound";
import { FIREWORK_BURSTS } from "./diwali";

let buffers: AudioBuffer[] | undefined;
let loading: Promise<void> | undefined;
/** Decode once, only after an explicit sound gesture. Failures are retryable. */
export async function prepareFireworkSound() {
  const audio = getSoundContext();
  if (!audio || isMuted()) return false;
  try {
    await audio.resume();
    if (!loading) loading = Promise.all(["firework-pop.m4a", "firework-rise.m4a"].map(async name => {
      const response = await fetch(`/festive/${name}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Sound unavailable");
      return audio.decodeAudioData(await response.arrayBuffer());
    })).then(decoded => { buffers = decoded; }).catch(error => { loading = undefined; throw error; });
    await loading;
    return audio.state === "running";
  } catch { return false; }
}

/** Return null when no audio actually starts, so normal settlement sound can remain. */
export function playFireworkSound(compact = false): (() => void) | null {
  const audio = getSoundContext();
  if (!audio || audio.state !== "running" || !buffers || isMuted() || document.hidden) return null;
  const sources: AudioBufferSourceNode[] = [];
  const gain = audio.createGain();
  gain.gain.value = compact ? 0.48 : 0.62;
  gain.connect(audio.destination);
  const start = audio.currentTime + 0.025;
  const schedule = (buffer: AudioBuffer, delay: number, rate = 1) => {
    const source = audio.createBufferSource(); source.buffer = buffer; source.playbackRate.value = rate;
    source.connect(gain); source.onended = () => source.disconnect();
    source.start(start + delay); sources.push(source);
  };
  schedule(buffers[1]!, 0);
  FIREWORK_BURSTS.slice(0, compact ? 2 : 3).forEach((burst, i) => schedule(buffers![0]!, burst.delay, [1, 0.96, 1.06][i]));
  let stopped = false;
  return () => {
    if (stopped) return; stopped = true;
    for (const source of sources) { try { source.stop(); } catch { /* Already ended. */ } source.disconnect(); }
    gain.disconnect();
  };
}
