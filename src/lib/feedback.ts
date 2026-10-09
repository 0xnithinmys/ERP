// Audible scan feedback (WebAudio, no assets). Fails silently where unsupported.

let ctx: AudioContext | null = null;

function tone(freq: number, ms: number, type: OscillatorType = "sine", volume = 0.08) {
  try {
    if (typeof window === "undefined") return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000);
    osc.start(now);
    osc.stop(now + ms / 1000);
  } catch {
    /* audio is optional */
  }
}

export const beepOk = () => tone(1320, 90, "square", 0.05);
export const beepError = () => {
  tone(220, 160, "sawtooth", 0.06);
  setTimeout(() => tone(180, 200, "sawtooth", 0.06), 170);
};
