import { useMemo, useState } from "react";
import { FLAG_KEYS, syncFlag } from "./userFlags.js";

/* ===========================================================================
   TeamBirthdayConfetti
   ---------------------------------------------------------------------------
   For admin-facing list pages (EmployeesPage, ClientsPage, etc.) — pass in
   the array of people being listed (each needs a `name` and, once the
   backend adds it, a `dateOfBirth`/`date_of_birth` field in "YYYY-MM-DD").
   If anyone in the list has a birthday today, shows a confetti burst plus a
   small banner naming them. Renders nothing if no one's DOB is today (or
   the field doesn't exist yet on any record — safe no-op until the
   backend field is added).

   Dismissal is remembered for the rest of the day (localStorage) — before
   this, closing the banner only set in-memory React state, so navigating
   away from the page and back (which remounts this component) reset that
   state and the banner popped right back up, even though the admin had
   already closed it once today. Tomorrow's stored date won't match
   today's, so it naturally shows again on the next birthday with no
   cleanup needed.
   =========================================================================== */

const CONFETTI_COLORS = ["#8b5cf6", "#ec4899", "#f59e0b", "#22c55e", "#3b82f6", "#ef4444"];
const DISMISS_DATE_KEY = FLAG_KEYS.teamConfettiDismissed; // synced per user via /api/flags/

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function isDismissedToday() {
  try {
    return localStorage.getItem(DISMISS_DATE_KEY) === todayKey();
  } catch {
    return false;
  }
}

function markDismissedToday() {
  try {
    localStorage.setItem(DISMISS_DATE_KEY, todayKey());
    syncFlag(DISMISS_DATE_KEY);
  } catch {
    // localStorage unavailable — safe to ignore, best-effort only
  }
}

export function isBirthdayToday(dateValue) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  return d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
}

export default function TeamBirthdayConfetti({ people = [] }) {
  const [dismissed, setDismissed] = useState(() => isDismissedToday());

  const birthdayPeople = useMemo(
    () => people.filter((p) => isBirthdayToday(p.dateOfBirth || p.date_of_birth)),
    [people]
  );

  if (birthdayPeople.length === 0 || dismissed) return null;

  const confettiPieces = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 2,
    duration: 3 + Math.random() * 2,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    size: 6 + Math.random() * 6,
    rotate: Math.random() * 360,
  }));

  const names = birthdayPeople.map((p) => p.name).join(", ");

  return (
    <div className="fixed inset-0 z-[999] pointer-events-none overflow-hidden">
      {confettiPieces.map((p) => (
        <span
          key={p.id}
          style={{
            position: "absolute",
            top: "-20px",
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.4,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `team-birthday-fall ${p.duration}s linear ${p.delay}s infinite`,
            borderRadius: 2,
          }}
        />
      ))}

      <div className="pointer-events-auto absolute top-6 left-1/2 -translate-x-1/2 bg-white shadow-2xl rounded-2xl px-6 py-4 flex items-center gap-3 border border-purple-200">
        <span className="text-3xl">🎉</span>
        <div>
          <p className="font-bold text-slate-800 text-sm sm:text-base">
            🎂 It's {names}'s birthday today!
          </p>
          <p className="text-xs text-slate-500">Don't forget to wish them well.</p>
        </div>
        <button
          onClick={() => {
            markDismissedToday();
            setDismissed(true);
          }}
          className="ml-2 text-slate-400 hover:text-slate-600 text-lg leading-none"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>

      <style>{`
        @keyframes team-birthday-fall {
          0% { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(360deg); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}