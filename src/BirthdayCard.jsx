import { useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
   Phoenix bird logo (already in src/assets). BirthdayCard.jsx lives
   directly in src/, so assets/ is a sibling folder — hence "./assets/...".
   Double-check the exact filename + extension in your assets folder
   (it might be .svg or .jpg instead of .png) and adjust below if needed,
   or just pass a `birdImageSrc` prop from outside to override it.
   --------------------------------------------------------------------------- */
import phoenixLogo from "./assets/phoenix-logo.png";

/* ===========================================================================
   BirthdayCard
   ---------------------------------------------------------------------------
   Shared "advanced" birthday celebration UI used by both:
     - BirthdayCelebration.jsx        (employee Dashboard)
     - ClientBirthdayCelebration.jsx  (Client Portal)

   Design brief this follows (from reference images the person shared):
     1. INTRO: the Hopenix phoenix logo flies in in 3D, drops a 3D
        envelope/letter (colored to match the phoenix logo's violet/indigo
        gradient), lands on top of the letter and gives a quick wink, then
        flies off as the envelope's flap opens.
     2. HERO PHOTO UP FRONT — the person's real profile photo sits large,
        front and center, inside a circular badge ring (like a "God Bless
        You / Happy Birthday" party-favor badge) with the celebration
        text curved around it and balloons/hearts floating beside it.
        The celebration (confetti bursts, glow) happens ON/AROUND that
        photo, not tucked away as a tiny pinned circle.
     3. A rolled parchment SCROLL LETTER unrolls underneath it (like a
        handwritten birthday scroll, wooden rod ends + wax seal), carrying
        the personal written message — in Hopenix's purple brand palette
        instead of the reference's cream/red.
     4. Two "popper cannons" fire from the bottom corners, plus a burst
        directly around the photo, plus a continuous falling confetti
        field across the whole screen.
     5. OUTRO: a little while after everything has settled, the phoenix
        flies back in, loops around above the photo badge (the "dp") twice,
        lands and drops a little party cap on it, gives a quick wink, then
        flies off again — the cap stays on.
   =========================================================================== */

const CONFETTI_COLORS = [
  "#8b5cf6", "#ec4899", "#f59e0b", "#22c55e",
  "#3b82f6", "#ef4444", "#facc15", "#14b8a6",
];
const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#0891b2", "#059669", "#d97706", "#dc2626", "#db2777", "#4f46e5"];

/* Fixed brand gradient for the bird + the letter it drops — matches the
   phoenix logo's own violet -> indigo gradient, independent of whichever
   `accent` color a given card (employee vs client) is using elsewhere. */
const PHOENIX_GRAD_FROM = "#7c3aed";
const PHOENIX_GRAD_TO = "#4338ca";

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name) {
  let hash = 0;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/* Fallback for people without a real uploaded profile photo yet. */
function fallbackAvatar(name) {
  const bg = colorFor(name);
  const label = initialsFor(name);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300">` +
    `<rect width="300" height="300" fill="${bg}"/>` +
    `<text x="50%" y="53%" font-family="Arial, sans-serif" font-size="120" fill="white" ` +
    `text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

/* Continuous top-down falling confetti across the whole screen. */
function useFallingConfetti(count) {
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 2.5,
      duration: 3.2 + Math.random() * 2.6,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: 5 + Math.random() * 7,
      drift: randomBetween(-70, 70),
      pattern: i % 2 === 0 ? "a" : "b",
    }))
  );
  return pieces;
}

/* A burst of pieces flying outward from a given origin angle-range,
   arcing up then falling — used both for the corner "popper cannons"
   and for the ring of confetti that bursts around the hero photo. */
function useBurst(count, angleMin, angleMax, minDist, maxDist) {
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => {
      const angle = randomBetween(angleMin, angleMax);
      const distance = randomBetween(minDist, maxDist);
      const rad = (angle * Math.PI) / 180;
      const peakX = Math.cos(rad) * distance * 0.55;
      const peakY = -Math.abs(Math.sin(rad) * distance * 0.9) - 40;
      const endX = Math.cos(rad) * distance * 1.15 + randomBetween(-30, 30);
      const endY = peakY * -0.1 + randomBetween(180, 340);
      return {
        id: i,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 5 + Math.random() * 7,
        peakX, peakY, endX, endY,
        spin: 360 + Math.random() * 900,
        delay: Math.random() * 0.4,
        duration: 1.4 + Math.random() * 1,
      };
    })
  );
  return pieces;
}

const BALLOONS = [
  { emoji: "🎈", side: "left", top: "6%", size: "2.1rem", delay: "0s" },
  { emoji: "🎈", side: "left", top: "42%", size: "1.5rem", delay: "0.6s" },
  { emoji: "❤️", side: "left", top: "76%", size: "1.3rem", delay: "1.1s" },
  { emoji: "🎈", side: "right", top: "10%", size: "1.8rem", delay: "0.3s" },
  { emoji: "🎈", side: "right", top: "46%", size: "2.2rem", delay: "0.9s" },
  { emoji: "❤️", side: "right", top: "78%", size: "1.3rem", delay: "1.3s" },
];

/* ---------------------------------------------------------------------------
   Rising "Happy Birthday" text + cake/balloon icons (the "Snapchat filter"
   look the person asked for) — floats up from the bottom of the screen the
   whole time the card is open, independent of the phoenix/letter/photo
   stage machine below. Sits at the same layer as the falling confetti.
   --------------------------------------------------------------------------- */
const RISING_MESSAGES = ["Happy Birthday", "🎂", "🎉", "Happy Birthday", "🎈", "✨", "Happy Birthday", "🥳"];

function useRisingText(count) {
  const [pieces] = useState(() =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      label: RISING_MESSAGES[i % RISING_MESSAGES.length],
      left: 4 + Math.random() * 92,
      delay: (i / count) * 3.5 + Math.random() * 0.6,
      duration: 5 + Math.random() * 3,
      drift: randomBetween(-40, 40),
      size: 0.85 + Math.random() * 0.85,
      spin: randomBetween(-12, 12),
    }))
  );
  return pieces;
}

/* Small confetti "poppers" that puff out behind the bird while it's flying —
   each one repeats on its own delay so the trail looks continuous. */
const TRAIL_DOTS = [
  { size: 6, color: "#f59e0b", tx: -20, ty: 24, duration: 0.6, delay: 0 },
  { size: 5, color: "#ec4899", tx: 16, ty: 28, duration: 0.55, delay: 0.08 },
  { size: 7, color: "#22c55e", tx: -12, ty: 32, duration: 0.65, delay: 0.16 },
  { size: 5, color: "#3b82f6", tx: 22, ty: 22, duration: 0.5, delay: 0.24 },
  { size: 6, color: "#facc15", tx: -24, ty: 20, duration: 0.6, delay: 0.32 },
  { size: 5, color: "#8b5cf6", tx: 14, ty: 30, duration: 0.55, delay: 0.4 },
];

export default function BirthdayCard({
  name,
  avatarUrl,
  greeting,
  subtitle,
  message,
  accent = "#7c3aed",
  birdImageSrc = phoenixLogo,
  soundSrc,
  onDismiss,
}) {
  // No "Incoming Call" screen any more: the celebration starts by itself the
  // moment the person opens the website on their birthday (it used to wait
  // for them to Answer, and Declining dismissed the card for the day, so the
  // wish was never shown).

  // closed -> birdIn -> drop -> perchLetter -> open -> photo -> scroll
  const [stage, setStage] = useState("closed");
  // idle -> circling -> perched -> winking -> leaving -> gone
  const [birdOutro, setBirdOutro] = useState("idle");
  // once the outro bird lands, it drops a little party cap on the photo —
  // this stays true (and the cap stays visible) even after the bird leaves.
  const [capPlaced, setCapPlaced] = useState(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setStage("birdIn"), 200),        // phoenix flies in with the letter
      setTimeout(() => setStage("drop"), 1300),         // it drops the letter, letter falls
      setTimeout(() => setStage("perchLetter"), 2050),  // bird lands on top of the letter and winks
      setTimeout(() => setStage("open"), 2950),         // bird lifts off, the letter's flap pops open
      setTimeout(() => setStage("photo"), 3550),        // hero photo badge reveals
      setTimeout(() => setStage("scroll"), 4400),       // scroll letter unrolls
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  // Once everything has settled, the phoenix comes back, loops around above
  // the photo badge twice, lands and drops a little party cap on it, winks,
  // then flies off again (the cap stays on).
  useEffect(() => {
    if (stage !== "scroll") return undefined;
    const timers = [
      setTimeout(() => setBirdOutro("circling"), 5200),
      setTimeout(() => setBirdOutro("perched"), 8650),
      setTimeout(() => setBirdOutro("winking"), 9150),
      setTimeout(() => setBirdOutro("leaving"), 10350),
      setTimeout(() => setBirdOutro("gone"), 11350),
    ];
    return () => timers.forEach(clearTimeout);
  }, [stage]);

  useEffect(() => {
    if (birdOutro === "perched") setCapPlaced(true);
  }, [birdOutro]);

  const fallingConfetti = useFallingConfetti(80);
  const leftCannon = useBurst(38, -15, 75, 180, 480);
  const rightCannon = useBurst(38, 105, 195, 180, 480);
  const photoBurst = useBurst(46, 0, 360, 90, 230);
  const risingText = useRisingText(16);

  // Optional birthday tune/voice line (soundSrc). It starts as soon as the
  // card appears. Browsers can refuse sound before the person has touched the
  // page at all - if that happens it starts on their first tap/click/key press
  // instead (so there is never a "tap to play" screen in the way).
  const audioRef = useRef(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const soundMutedRef = useRef(false);
  soundMutedRef.current = soundMuted;

  useEffect(() => {
    if (!soundSrc) return undefined;
    const audio = new Audio(soundSrc);
    // Loop the tune so it keeps playing for as long as the card is open — it
    // only stops when the person dismisses the card (or mutes it).
    audio.loop = true;
    audio.volume = 0.6;
    audioRef.current = audio;

    // Only these count as a real "user gesture" for browsers (touchstart does
    // NOT - on phones the gesture is registered on touchend / pointerup), so
    // all of them are listened for; the first one that lets play() through
    // starts the tune and removes the listeners.
    const events = ["pointerdown", "pointerup", "mousedown", "click", "touchend", "keydown"];
    const detach = () => events.forEach((ev) => window.removeEventListener(ev, retryOnGesture, true));
    function retryOnGesture() {
      if (soundMutedRef.current) return;
      audio.play().then(detach).catch(() => {});
    }
    audio.play().catch(() => {
      events.forEach((ev) => window.addEventListener(ev, retryOnGesture, true));
    });
    return () => {
      detach();
      audio.pause();
      if (audioRef.current === audio) audioRef.current = null;
    };
  }, [soundSrc]);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      audioRef.current = null;
    };
  }, []);

  const toggleSoundMuted = () => {
    if (soundMuted) {
      audioRef.current?.play().catch(() => {});
    } else {
      audioRef.current?.pause();
    }
    setSoundMuted((m) => !m);
  };

  const displayName = name || "there";
  const photo = avatarUrl || fallbackAvatar(displayName);
  const letterBody =
    message ||
    `Hey ${displayName}! Today is all about celebrating you. Thank you for the energy, ` +
      `dedication and positivity you bring — it truly makes a difference. Wishing you a year ` +
      `ahead filled with happiness, success and everything you deserve.`;

  const showPhoto = stage === "photo" || stage === "scroll";
  const showScroll = stage === "scroll";
  const showIntro = stage === "birdIn" || stage === "drop" || stage === "perchLetter" || stage === "open";
  const showOutroBird = birdOutro !== "idle" && birdOutro !== "gone";

  return (
    <div className="fixed inset-0 z-[999] overflow-hidden pointer-events-none" style={{ perspective: 1400 }}>
      {/* Falling confetti field, top to bottom */}
      {fallingConfetti.map((p) => (
        <span
          key={`fall-${p.id}`}
          style={{
            position: "absolute",
            top: "-24px",
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.42,
            backgroundColor: p.color,
            borderRadius: 2,
            opacity: 0.9,
            animation: `bday-fall-${p.pattern} ${p.duration}s linear ${p.delay}s infinite`,
            "--drift": `${p.drift}px`,
          }}
        />
      ))}

      {/* Popper cannon: bottom-left */}
      <div
        className="absolute -bottom-3 left-2 sm:left-10 text-4xl sm:text-5xl"
        style={{ animation: "bday-cannon-kick 1.6s ease-in-out infinite", transformOrigin: "bottom left" }}
      >
        🎉
      </div>
      {leftCannon.map((p) => (
        <span
          key={`l-${p.id}`}
          className="absolute bottom-8 left-8 sm:left-16"
          style={{
            width: p.size, height: p.size * 0.5, backgroundColor: p.color, borderRadius: 2,
            "--pdx": `${p.peakX}px`, "--pdy": `${p.peakY}px`,
            "--edx": `${p.endX}px`, "--edy": `${p.endY}px`, "--spin": `${p.spin}deg`,
            animation: `bday-burst ${p.duration}s cubic-bezier(.18,.8,.32,1) ${p.delay}s infinite`,
          }}
        />
      ))}

      {/* Popper cannon: bottom-right */}
      <div
        className="absolute -bottom-3 right-2 sm:right-10 text-4xl sm:text-5xl"
        style={{ animation: "bday-cannon-kick 1.6s ease-in-out infinite", animationDelay: "0.15s", transformOrigin: "bottom right" }}
      >
        🎉
      </div>
      {rightCannon.map((p) => (
        <span
          key={`r-${p.id}`}
          className="absolute bottom-8 right-8 sm:right-16"
          style={{
            width: p.size, height: p.size * 0.5, backgroundColor: p.color, borderRadius: 2,
            "--pdx": `${p.peakX}px`, "--pdy": `${p.peakY}px`,
            "--edx": `${p.endX}px`, "--edy": `${p.endY}px`, "--spin": `${p.spin}deg`,
            animation: `bday-burst ${p.duration}s cubic-bezier(.18,.8,.32,1) ${p.delay + 0.1}s infinite`,
          }}
        />
      ))}

      {/* ================= INTRO: phoenix flies in, drops the 3D letter, lands on it and winks, then opens it ================= */}
      {showIntro && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 20 }}>
          <div
            className="absolute w-24 h-24 sm:w-28 sm:h-28"
            style={{
              transformStyle: "preserve-3d",
              animation:
                stage === "birdIn"
                  ? "bday-bird-in 1.1s cubic-bezier(.22,.85,.3,1) forwards"
                  : stage === "drop"
                  ? "bday-bird-hover 0.75s ease-in-out infinite"
                  : stage === "perchLetter"
                  ? "bday-bird-land-letter 0.4s ease-out forwards, bday-bird-sit-bob 1s ease-in-out 0.4s infinite"
                  : "bday-bird-exit 0.45s ease-in forwards",
            }}
          >
            {/* trailing poppers streaming out behind the bird while it's actively flying */}
            {(stage === "birdIn" || stage === "drop") &&
              TRAIL_DOTS.map((d, i) => (
                <span
                  key={`intro-trail-${i}`}
                  className="absolute rounded-full"
                  style={{
                    width: d.size, height: d.size, backgroundColor: d.color,
                    left: "38%", top: "55%",
                    "--tx": `${d.tx}px`, "--ty": `${d.ty}px`,
                    animation: `bday-trail-puff ${d.duration}s ease-out ${d.delay}s infinite`,
                    opacity: 0,
                  }}
                />
              ))}
            <img
              src={birdImageSrc}
              alt=""
              className="w-full h-full object-contain"
              style={{
                filter: "drop-shadow(0 10px 18px rgba(67,56,202,0.5))",
                animation: stage !== "perchLetter" ? "bday-wing-flap 0.28s ease-in-out infinite" : undefined,
              }}
            />
            {/* wink once it's sitting on the letter — nudge left/top if your logo's eye sits elsewhere */}
            {stage === "perchLetter" && (
              <span
                className="absolute rounded-full bg-white"
                style={{ width: 9, height: 9, left: "47%", top: "40%", animation: "bday-wink 0.6s ease-in-out 0.35s" }}
              />
            )}
          </div>

          {(stage === "drop" || stage === "perchLetter" || stage === "open") && (
            <div
              className="absolute"
              style={{
                width: 130,
                height: 96,
                transformStyle: "preserve-3d",
                perspective: 700,
                animation:
                  stage === "drop"
                    ? "bday-letter-fall 0.75s cubic-bezier(.3,.6,.35,1.15) forwards"
                    : stage === "perchLetter"
                    ? "bday-letter-settle 0.3s ease-out forwards"
                    : undefined,
              }}
            >
              {/* envelope body — 3D, in the phoenix logo's own violet/indigo gradient */}
              <div
                className="absolute inset-0 rounded-md shadow-2xl"
                style={{ background: `linear-gradient(155deg, ${PHOENIX_GRAD_FROM}, ${PHOENIX_GRAD_TO})` }}
              />
              {/* the card peeking up out of the envelope once it opens */}
              <div
                className="absolute left-2 right-2 rounded-sm shadow-lg"
                style={{
                  bottom: "8%",
                  height: "72%",
                  background: `linear-gradient(155deg, #c4b5fd, ${PHOENIX_GRAD_FROM})`,
                  transform: stage === "open" ? "translateY(-48%)" : "translateY(6%)",
                  transition: "transform 0.5s cubic-bezier(.2,.8,.3,1.1) 0.15s",
                }}
              />
              {/* envelope flap, hinged at the top edge, flips open in 3D */}
              <div
                className="absolute left-0 right-0 top-0 origin-top"
                style={{
                  height: "58%",
                  background: `linear-gradient(200deg, #c4b5fd, ${PHOENIX_GRAD_TO})`,
                  clipPath: "polygon(0 0, 100% 0, 50% 85%)",
                  transformStyle: "preserve-3d",
                  transform: stage === "open" ? "rotateX(178deg)" : "rotateX(0deg)",
                  transition: "transform 0.6s cubic-bezier(.3,.7,.3,1.2)",
                  boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                }}
              />
              {/* wax seal, fades out the moment the flap opens */}
              <span
                className="absolute left-1/2 top-[38%] -translate-x-1/2 w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shadow-lg"
                style={{
                  background: `radial-gradient(circle at 35% 30%, #c084fc, ${PHOENIX_GRAD_FROM})`,
                  opacity: stage === "open" ? 0 : 1,
                  transition: "opacity 0.25s ease",
                }}
              >
                H
              </span>
            </div>
          )}
        </div>
      )}

      {/* Center column: hero photo badge, then scroll letter underneath */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-4 overflow-y-auto py-8">
        {/* ---------- HERO PHOTO BADGE ---------- */}
        <div
          className="pointer-events-auto relative shrink-0"
          style={{
            width: 230,
            height: 230,
            transform: showPhoto ? "scale(1)" : "scale(0.4)",
            opacity: showPhoto ? 1 : 0,
            transition: "transform 0.6s cubic-bezier(.2,.85,.3,1.3), opacity 0.4s ease",
            animation: showPhoto ? "bday-float 4.2s ease-in-out infinite" : undefined,
          }}
        >
          {/* confetti bursting directly around the photo */}
          {showPhoto &&
            photoBurst.map((p) => (
              <span
                key={`p-${p.id}`}
                className="absolute top-1/2 left-1/2"
                style={{
                  width: p.size, height: p.size * 0.5, backgroundColor: p.color, borderRadius: 2,
                  "--pdx": `${p.peakX}px`, "--pdy": `${p.peakY}px`,
                  "--edx": `${p.endX}px`, "--edy": `${p.endY}px`, "--spin": `${p.spin}deg`,
                  animation: `bday-burst ${p.duration}s cubic-bezier(.18,.8,.32,1) ${p.delay}s infinite`,
                  zIndex: 1,
                }}
              />
            ))}

          {/* balloons + hearts floating beside the photo */}
          {BALLOONS.map((b, i) => (
            <span
              key={i}
              className="absolute select-none"
              style={{
                [b.side]: "-22px",
                top: b.top,
                fontSize: b.size,
                filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.25))",
                animation: `bday-balloon-bob 3.4s ease-in-out ${b.delay} infinite`,
                zIndex: 2,
              }}
            >
              {b.emoji}
            </span>
          ))}

          {/* badge ring with curved "HAPPY BIRTHDAY" / "BEST WISHES" text */}
          <svg viewBox="0 0 230 230" className="absolute inset-0 w-full h-full" style={{ zIndex: 3 }}>
            <defs>
              <linearGradient id="bday-ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={accent} />
                <stop offset="100%" stopColor="#c026d3" />
              </linearGradient>
              <path id="bday-top-arc" d="M 19 115 A 96 96 0 0 1 211 115" fill="none" />
              <path id="bday-bottom-arc" d="M 211 115 A 96 96 0 0 1 19 115" fill="none" />
            </defs>
            <circle cx="115" cy="115" r="96" fill="none" stroke="url(#bday-ring-grad)" strokeWidth="30" />
            <circle cx="115" cy="115" r="96" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
            <text fill="#ffffff" fontSize="16" fontWeight="700" letterSpacing="2">
              <textPath href="#bday-top-arc" startOffset="50%" textAnchor="middle">
                HAPPY BIRTHDAY
              </textPath>
            </text>
            <text fill="#ffe8ff" fontSize="13" fontWeight="700" letterSpacing="2">
              <textPath href="#bday-bottom-arc" startOffset="50%" textAnchor="middle">
                ✦ BEST WISHES ✦
              </textPath>
            </text>
          </svg>

          {/* the photo itself, front and center */}
          <img
            src={photo}
            alt={displayName}
            className="absolute rounded-full object-cover shadow-xl"
            style={{
              top: "50%", left: "50%",
              width: 168, height: 168,
              transform: "translate(-50%, -50%)",
              border: "5px solid white",
              zIndex: 2,
              animation: "bday-avatar-pulse 2.2s ease-in-out infinite",
            }}
          />

          {/* party cap the phoenix drops on the photo once it lands — stays on even after it flies off */}
          {capPlaced && (
            <div
              className="absolute pointer-events-none"
              style={{
                top: -20,
                left: "50%",
                width: 44,
                height: 52,
                marginLeft: -28,
                transformOrigin: "bottom center",
                transform: "rotate(-16deg)",
                animation: "bday-cap-pop 0.35s cubic-bezier(.3,.9,.4,1.4) forwards",
                zIndex: 5,
              }}
            >
              <svg viewBox="0 0 60 70" width="44" height="52">
                <defs>
                  <linearGradient id="bday-cap-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={PHOENIX_GRAD_FROM} />
                    <stop offset="100%" stopColor={PHOENIX_GRAD_TO} />
                  </linearGradient>
                </defs>
                <polygon points="30,4 6,64 54,64" fill="url(#bday-cap-grad)" stroke="white" strokeWidth="2" />
                <circle cx="16" cy="46" r="3.2" fill="#fff" opacity="0.85" />
                <circle cx="30" cy="30" r="3.2" fill="#fff" opacity="0.85" />
                <circle cx="24" cy="54" r="3.2" fill="#fff" opacity="0.85" />
                <circle cx="40" cy="46" r="3.2" fill="#fff" opacity="0.85" />
                <circle cx="30" cy="4" r="6" fill="#fbbf24" />
              </svg>
            </div>
          )}

          {/* ---------- OUTRO: phoenix returns, circles twice above the photo, lands + caps it, winks, flies off ---------- */}
          {showOutroBird && (
            <div
              className="absolute left-1/2"
              style={{
                top: -34,
                width: 64,
                height: 64,
                marginLeft: -32,
                zIndex: 6,
                transformStyle: "preserve-3d",
                animation:
                  birdOutro === "circling"
                    ? "bday-bird-circle-in 0.4s ease-out forwards, bday-bird-circle 1.5s ease-in-out 0.4s 2"
                    : birdOutro === "leaving"
                    ? "bday-bird-flyoff 1s cubic-bezier(.35,.1,.4,1) forwards"
                    : undefined,
              }}
            >
              {/* trailing poppers streaming out behind the bird as it circles */}
              {birdOutro === "circling" &&
                TRAIL_DOTS.map((d, i) => (
                  <span
                    key={`outro-trail-${i}`}
                    className="absolute rounded-full"
                    style={{
                      width: d.size, height: d.size, backgroundColor: d.color,
                      left: "38%", top: "55%",
                      "--tx": `${d.tx}px`, "--ty": `${d.ty}px`,
                      animation: `bday-trail-puff ${d.duration}s ease-out ${d.delay}s infinite`,
                      opacity: 0,
                    }}
                  />
                ))}
              <img
                src={birdImageSrc}
                alt=""
                className="w-full h-full object-contain"
                style={{
                  filter: "drop-shadow(0 6px 10px rgba(67,56,202,0.45))",
                  animation:
                    birdOutro === "perched" || birdOutro === "winking"
                      ? "bday-bird-perch-bob 1.6s ease-in-out infinite"
                      : birdOutro === "circling" || birdOutro === "leaving"
                      ? "bday-wing-flap 0.28s ease-in-out infinite"
                      : undefined,
                }}
              />
              {/* wink: a quick eyelid flicker over the bird's eye — nudge left/top if your
                  logo's eye sits somewhere else in the image */}
              {birdOutro === "winking" && (
                <span
                  className="absolute rounded-full bg-white"
                  style={{ width: 7, height: 7, left: "47%", top: "40%", animation: "bday-wink 0.9s ease-in-out" }}
                />
              )}
            </div>
          )}
        </div>

        {/* ---------- SCROLL LETTER ---------- */}
        <div
          className="pointer-events-auto shrink-0"
          style={{
            width: "min(320px, 88vw)",
            transformOrigin: "top center",
            transform: showScroll ? "scaleY(1) translateY(0)" : "scaleY(0.15) translateY(-16px)",
            opacity: showScroll ? 1 : 0,
            transition: "transform 0.7s cubic-bezier(.22,.85,.3,1.1), opacity 0.5s ease",
          }}
        >
          {/* top rod */}
          <div className="relative h-3 rounded-full mx-[-10px]" style={{ background: `linear-gradient(90deg, ${accent}, #4c1d95)` }}>
            <span className="absolute -left-1 -top-1 w-5 h-5 rounded-full shadow" style={{ background: accent }} />
            <span className="absolute -right-1 -top-1 w-5 h-5 rounded-full shadow" style={{ background: accent }} />
          </div>

          {/* parchment body */}
          <div
            className="relative px-5 pt-4 pb-6 -mt-0.5 shadow-2xl"
            style={{ background: "linear-gradient(160deg, #fdf6e3, #f3e5c3)" }}
          >
            <p
              className="text-center font-bold tracking-wide text-base"
              style={{ color: accent, fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              {greeting || "HAPPY BIRTHDAY"}
            </p>
            <p className="text-center text-[11px] italic text-slate-500 mb-2" style={{ fontFamily: "Georgia, serif" }}>
              {subtitle || "— our dearest teammate —"}
            </p>
            <p
              className="text-[12.5px] leading-relaxed text-slate-700 text-center"
              style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
            >
              {letterBody}
            </p>
            {/* wax seal accent */}
            <span
              className="absolute -bottom-3 -left-3 w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg"
              style={{ background: `radial-gradient(circle at 35% 30%, #c084fc, ${accent})` }}
            >
              H
            </span>
            <span className="absolute bottom-2 right-4 text-rose-500 text-sm">❤</span>
          </div>

          {/* bottom rod */}
          <div className="relative h-3 rounded-full mx-[-10px]" style={{ background: `linear-gradient(90deg, #4c1d95, ${accent})` }}>
            <span className="absolute -left-1 -bottom-1 w-5 h-5 rounded-full shadow" style={{ background: accent }} />
            <span className="absolute -right-1 -bottom-1 w-5 h-5 rounded-full shadow" style={{ background: accent }} />
          </div>
        </div>
      </div>

      {/* Rising "Happy Birthday" text + cake/balloon icons floating up —
          placed here (after the letter/photo/scroll above) so it paints
          IN FRONT of them, not hidden behind. */}
      {risingText.map((p) => (
        <span
          key={`rise-${p.id}`}
          className="absolute select-none whitespace-nowrap font-semibold"
          style={{
            left: `${p.left}%`,
            bottom: "-10%",
            fontSize: `${p.size}rem`,
            color: p.label === "Happy Birthday" ? "#fff" : undefined,
            textShadow:
              p.label === "Happy Birthday" ? `0 0 10px ${accent}, 0 2px 6px rgba(0,0,0,0.35)` : "0 2px 6px rgba(0,0,0,0.25)",
            fontFamily: p.label === "Happy Birthday" ? "'Segoe Script','Brush Script MT',cursive" : undefined,
            "--drift": `${p.drift}px`,
            "--spin": `${p.spin}deg`,
            animation: `bday-rise ${p.duration}s ease-in ${p.delay}s infinite`,
          }}
        >
          {p.label}
        </span>
      ))}

      {/* Lit cake with a flickering candle flame, bottom center */}
      <div className="absolute left-1/2 bottom-[6%] -translate-x-1/2" style={{ animation: "bday-cake-bob 3.2s ease-in-out infinite" }}>
        <div className="relative flex flex-col items-center">
          <div className="relative w-3 h-5 mb-0.5" style={{ animation: "bday-flame-flicker 0.5s ease-in-out infinite alternate" }}>
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: "radial-gradient(circle at 50% 70%, #fff7cc 0%, #ffcf3f 35%, #ff8a00 70%, transparent 100%)",
                filter: "blur(0.3px)",
                clipPath: "path('M6 0C9 5 12 8 9 13C7.5 16 4.5 16 3 13C0 8 3 5 6 0Z')",
              }}
            />
            <div className="absolute inset-0" style={{ boxShadow: "0 0 14px 6px rgba(255,176,32,0.55)", borderRadius: "50%" }} />
          </div>
          <div className="w-[3px] h-3 bg-amber-900 rounded-full" />
          <div className="w-2 h-6 rounded-sm" style={{ background: "repeating-linear-gradient(45deg, #f43f5e, #f43f5e 4px, #fff 4px, #fff 8px)" }} />
          <div className="relative mt-[-2px]">
            <div className="w-28 h-9 rounded-t-xl relative overflow-hidden shadow-2xl" style={{ background: "linear-gradient(180deg, #fff 0%, #ffe4ec 100%)" }}>
              <div className="absolute inset-x-0 top-1 flex justify-center gap-1.5">
                {["#f43f5e", "#22c55e", "#f59e0b", "#3b82f6", "#8b5cf6"].map((c, i) => (
                  <span key={i} className="w-2 h-2 rounded-full" style={{ background: c }} />
                ))}
              </div>
            </div>
            <div className="w-32 h-7 -mt-1 -ml-2 rounded-b-lg shadow-2xl" style={{ background: "linear-gradient(180deg, #fda4c0 0%, #f472a0 100%)" }} />
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-36 h-3 rounded-full" style={{ background: "rgba(0,0,0,0.18)", filter: "blur(4px)" }} />
          </div>
        </div>
      </div>

      {soundSrc && (
        <div className="pointer-events-auto absolute bottom-5 right-5">
          <button
            onClick={toggleSoundMuted}
            className="w-9 h-9 rounded-full bg-white/90 hover:bg-white shadow-lg flex items-center justify-center text-base"
            aria-label={soundMuted ? "Unmute" : "Mute"}
          >
            {soundMuted ? "🔇" : "🔊"}
          </button>
        </div>
      )}

      {onDismiss && (
        <button
          onClick={onDismiss}
          className="pointer-events-auto absolute top-5 right-5 sm:top-8 sm:right-8 w-8 h-8 rounded-full bg-white/90 hover:bg-white text-slate-500 hover:text-slate-700 shadow-lg text-lg leading-none flex items-center justify-center"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}

      <style>{`
        @keyframes bday-rise {
          0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 0; }
          10% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate3d(var(--drift), -115vh, 0) rotate(var(--spin)); opacity: 0; }
        }
        @keyframes bday-flame-flicker {
          0% { transform: scaleY(1) scaleX(1) rotate(-1deg); }
          100% { transform: scaleY(1.15) scaleX(0.9) rotate(2deg); }
        }
        @keyframes bday-cake-bob {
          0%, 100% { transform: translate(-50%, 0); }
          50% { transform: translate(-50%, -6px); }
        }
        @keyframes bday-fall-a {
          0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate3d(var(--drift), 112vh, 0) rotate(440deg); opacity: 0.85; }
        }
        @keyframes bday-fall-b {
          0% { transform: translate3d(0, 0, 0) rotate(0deg) rotateY(0deg); opacity: 1; }
          100% { transform: translate3d(calc(var(--drift) * -1), 112vh, 0) rotate(-440deg) rotateY(540deg); opacity: 0.85; }
        }
        @keyframes bday-cannon-kick {
          0%, 100% { transform: rotate(0deg) scale(1); }
          10% { transform: rotate(-16deg) scale(1.1); }
          22% { transform: rotate(4deg) scale(1); }
        }
        @keyframes bday-burst {
          0% { transform: translate3d(0, 0, 0) rotate(0deg) rotateY(0deg) scale(0.55); opacity: 1; }
          45% { transform: translate3d(var(--pdx), var(--pdy), 30px) rotate(calc(var(--spin) * 0.5)) rotateY(200deg) scale(1); opacity: 1; }
          100% { transform: translate3d(var(--edx), var(--edy), 0) rotate(var(--spin)) rotateY(760deg) scale(0.85); opacity: 0; }
        }
        @keyframes bday-float {
          0%, 100% { transform: translateY(0) rotateZ(0deg); }
          50% { transform: translateY(-7px) rotateZ(1.2deg); }
        }
        @keyframes bday-avatar-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(139, 92, 246, 0.45); }
          50% { box-shadow: 0 0 0 10px rgba(139, 92, 246, 0); }
        }
        @keyframes bday-balloon-bob {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50% { transform: translateY(-10px) rotate(3deg); }
        }

        /* ---------- intro: phoenix flying in with the letter ---------- */
        @keyframes bday-bird-in {
          0% { transform: translate3d(130px, -170px, -220px) rotate3d(0,1,0,55deg) rotate(-25deg) scale(0.55); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translate3d(0, -74px, 0) rotate3d(0,1,0,0deg) rotate(-4deg) scale(1); opacity: 1; }
        }
        @keyframes bday-bird-hover {
          0%, 100% { transform: translate3d(0, -74px, 0) rotate(-4deg); }
          50% { transform: translate3d(0, -82px, 0) rotate(2deg); }
        }
        @keyframes bday-bird-exit {
          0% { transform: translate3d(0, -74px, 0) rotate(-4deg) scale(1); opacity: 1; }
          100% { transform: translate3d(-170px, -230px, -170px) rotate3d(0,1,0,-60deg) rotate(-30deg) scale(0.5); opacity: 0; }
        }
        @keyframes bday-letter-fall {
          0% { transform: translate3d(0, -150px, 0) rotateX(20deg) rotateZ(-8deg) scale(0.7); opacity: 0.4; }
          70% { transform: translate3d(0, 14px, 0) rotateX(-6deg) rotateZ(3deg) scale(1.04); opacity: 1; }
          100% { transform: translate3d(0, 0, 0) rotateX(0deg) rotateZ(0deg) scale(1); opacity: 1; }
        }
        @keyframes bday-letter-settle {
          0% { transform: scale(1); }
          50% { transform: scale(1.05); }
          100% { transform: scale(1); }
        }
        @keyframes bday-bird-land-letter {
          0% { transform: translate3d(0, -74px, 0) rotate(-4deg) scale(1); }
          60% { transform: translate3d(0, -50px, 0) rotate(3deg) scale(0.95); }
          100% { transform: translate3d(0, -46px, 0) rotate(-2deg) scale(0.92); }
        }
        @keyframes bday-bird-sit-bob {
          0%, 100% { transform: translate3d(0, -46px, 0) rotate(-2deg); }
          50% { transform: translate3d(0, -42px, 0) rotate(2deg); }
        }

        /* ---------- outro: phoenix circles above the photo, lands + drops a cap, winks, leaves ---------- */
        @keyframes bday-bird-circle-in {
          0% { transform: translate3d(60px, -40px, -80px) scale(0.6); opacity: 0; }
          100% { transform: translate3d(0, 0, 0) scale(1); opacity: 1; }
        }
        @keyframes bday-bird-circle {
          0%    { transform: translate3d(0px, 0px, 0px) rotate(0deg); }
          12.5% { transform: translate3d(105px, 44px, -28px) rotate(14deg); }
          25%   { transform: translate3d(149px, 149px, -40px) rotate(0deg); }
          37.5% { transform: translate3d(105px, 254px, -28px) rotate(-14deg); }
          50%   { transform: translate3d(0px, 298px, 0px) rotate(0deg); }
          62.5% { transform: translate3d(-105px, 254px, 28px) rotate(14deg); }
          75%   { transform: translate3d(-149px, 149px, 40px) rotate(0deg); }
          87.5% { transform: translate3d(-105px, 44px, 28px) rotate(-14deg); }
          100%  { transform: translate3d(0px, 0px, 0px) rotate(0deg); }
        }
        @keyframes bday-cap-pop {
          0% { transform: rotate(-16deg) scale(0.2); opacity: 0; }
          70% { transform: rotate(-16deg) scale(1.15); opacity: 1; }
          100% { transform: rotate(-16deg) scale(1); opacity: 1; }
        }
        @keyframes bday-bird-flyoff {
          0% { transform: translate3d(0, 0, 0) rotate(0deg) scale(1); opacity: 1; }
          100% { transform: translate3d(-160px, -150px, -170px) rotate3d(0,1,0,60deg) rotate(-25deg) scale(0.45); opacity: 0; }
        }
        @keyframes bday-bird-perch-bob {
          0%, 100% { transform: translateY(0) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(-2deg); }
        }
        @keyframes bday-wink {
          0%, 100% { transform: scaleY(1); opacity: 0; }
          35% { opacity: 1; transform: scaleY(1); }
          50% { transform: scaleY(0.15); opacity: 1; }
          65% { transform: scaleY(1); opacity: 1; }
          90% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}