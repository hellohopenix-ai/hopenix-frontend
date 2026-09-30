import React, { useEffect, useState } from "react";
import { ensurePushSubscribed } from "../pushSubscription.js";

// Phones (iOS especially) only allow the notification permission prompt from
// a real tap, so the automatic prompt after login isn't enough there. This
// slim bar shows until notifications are on (or dismissed) and enables them
// on tap. It now also SAYS what happened (working / blocked / unsupported)
// instead of silently doing nothing.
const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

export default function EnableNotificationsBanner({ darkMode }) {
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(""); // last result message, shown in place of the default text
  const [justEnabled, setJustEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("hopenix_notif_banner_dismissed") === "1"; } catch { return false; }
  });

  // Already allowed on this device -> quietly make sure the push subscription
  // exists and is saved on the server (no prompt involved).
  useEffect(() => {
    if (supported && Notification.permission === "granted") ensurePushSubscribed();
  }, [supported]);

  useEffect(() => {
    if (!justEnabled) return;
    const t = setTimeout(() => setJustEnabled(false), 3500);
    return () => clearTimeout(t);
  }, [justEnabled]);

  const needsInstall = isIOS && !isStandalone; // iPhone: push only works from the Home Screen app
  const shell = `shrink-0 px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-[12px] ${darkMode ? "bg-violet-950 text-violet-100" : "bg-violet-50 text-violet-900"}`;

  if (justEnabled) {
    return <div className={shell}><span>Notifications are on ✓ — you'll get messages, calls and tasks even when Hopenix is closed.</span></div>;
  }
  if (dismissed || perm === "granted" || (!supported && !needsInstall)) return null;

  const dismiss = () => {
    try { localStorage.setItem("hopenix_notif_banner_dismissed", "1"); } catch { /* ignore */ }
    setDismissed(true);
  };
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    const result = await ensurePushSubscribed({ prompt: true });
    setPerm(Notification.permission);
    setBusy(false);
    if (result.ok) setJustEnabled(true);
    else setNote(result.message);
  };

  // Blocked earlier: nothing to tap, but say how to fix it.
  if (perm === "denied") {
    return (
      <div className={shell}>
        <span>Notifications are blocked for Hopenix. Tap the lock icon in the address bar → Permissions → Notifications → Allow, then reload.</span>
        <button onClick={dismiss} className="opacity-70 hover:opacity-100 shrink-0" aria-label="Dismiss">✕</button>
      </div>
    );
  }

  return (
    <div className={shell}>
      <span>
        {note ||
          (needsInstall
            ? "To get message, call and task notifications on iPhone: tap Share → Add to Home Screen, then open Hopenix from the Home Screen."
            : "Turn on notifications to know about new messages, calls and tasks even when Hopenix is closed.")}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {!needsInstall && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="px-3 py-1 rounded-md bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-60"
          >
            {busy ? "Enabling…" : "Enable"}
          </button>
        )}
        <button onClick={dismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">✕</button>
      </span>
    </div>
  );
}