import React, { useState } from "react";
import { ensurePushSubscribed } from "../pushSubscription.js";

// Phones (iOS especially) only allow the notification permission prompt from
// a real tap, so the automatic prompt after login isn't enough there. This
// slim bar shows until notifications are on (or dismissed) and enables them
// on tap.
const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

export default function EnableNotificationsBanner({ darkMode }) {
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("hopenix_notif_banner_dismissed") === "1"; } catch { return false; }
  });

  const needsInstall = isIOS && !isStandalone; // iPhone: push only works from the Home Screen app
  if (dismissed || perm === "granted" || perm === "denied" || (!supported && !needsInstall)) return null;

  const dismiss = () => {
    try { localStorage.setItem("hopenix_notif_banner_dismissed", "1"); } catch { /* ignore */ }
    setDismissed(true);
  };
  const enable = async () => {
    await ensurePushSubscribed();
    setPerm(Notification.permission);
  };

  return (
    <div className={`shrink-0 px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-[12px] ${darkMode ? "bg-violet-950 text-violet-100" : "bg-violet-50 text-violet-900"}`}>
      <span>
        {needsInstall
          ? "To get message, call and task notifications on iPhone: tap Share → Add to Home Screen, then open Hopenix from the Home Screen."
          : "Turn on notifications to know about new messages, calls and tasks even when Hopenix is closed."}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {!needsInstall && (
          <button onClick={enable} className="px-3 py-1 rounded-md bg-violet-600 text-white font-semibold hover:bg-violet-700">
            Enable
          </button>
        )}
        <button onClick={dismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">✕</button>
      </span>
    </div>
  );
}
