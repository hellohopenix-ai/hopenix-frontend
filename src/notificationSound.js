// Short "ding" played inside the open page when a message / task / project
// notification arrives (the OS notification can't be shown loudly while the
// app is focused). Synthesised with WebAudio, so no sound file is needed.
// Browsers only allow audio after a tap/click, so the context is unlocked on
// the first interaction.

let ctx = null;

function getCtx() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  return ctx;
}

function unlock() {
  const c = getCtx();
  if (c && c.state === "suspended") c.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  ["pointerdown", "keydown", "touchstart"].forEach((ev) =>
    window.addEventListener(ev, unlock, { passive: true })
  );
}

export function playNotificationSound() {
  const c = getCtx();
  if (!c) return;
  try {
    if (c.state === "suspended") c.resume().catch(() => {});
    const t0 = c.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t0 + i * 0.14;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);
      osc.connect(gain).connect(c.destination);
      osc.start(start);
      osc.stop(start + 0.4);
    });
  } catch {
    /* sound is a nicety, never break the app for it */
  }
}
