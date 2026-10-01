import React, { useEffect, useState } from "react";
import { ensurePushSubscribed } from "../pushSubscription.js";
import { canInstallApp, installHopenixApp, isAndroid, PHONE_TIPS } from "../installApp.js";

// Notification permission popup.
//
//  * Permission NOT given yet  -> a centered popup asks the person to allow
//    notifications. It comes back on EVERY page load / app open until they
//    tap Allow (closing it with "Not now" only hides it for this visit).
//  * Permission blocked        -> same popup, but with the steps to unblock
//    (the browser never lets a site re-ask once blocked).
//  * Permission granted        -> NOTHING is shown. No "Test now" bar. The
//    device is silently (re)registered for push in the background, so
//    messages, calls and tasks arrive like WhatsApp even when Hopenix is
//    closed and the phone is not in use.
//
// Props are unchanged (darkMode, token, audience, className), so Dashboard
// and Client Portal keep working as they are. `token` = auth token to
// register this device under (Client Portal passes its own).
const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

const RESYNC_EVERY_MS = 5 * 60 * 1000;
const NUDGE_KEY = "hopenix_phone_nudge_v1"; // the one-time "install the app" card was dealt with

function lsGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export default function EnableNotificationsBanner({ darkMode, token, audience }) {
  const what = audience === "client" ? "messages, project updates and birthday wishes" : "messages, calls and tasks";
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [hidden, setHidden] = useState(false); // "Not now": only until the next page load
  const [thanks, setThanks] = useState(false);
  const [nudgeDone, setNudgeDone] = useState(() => lsGet(NUDGE_KEY) === "1");
  const [showTips, setShowTips] = useState(false);
  const [canInstall, setCanInstall] = useState(canInstallApp());

  useEffect(() => {
    const sync = () => setCanInstall(canInstallApp());
    window.addEventListener("hopenix-install-ready", sync);
    return () => window.removeEventListener("hopenix-install-ready", sync);
  }, []);

  const needsInstall = isIOS && !isStandalone; // iPhone: push only works from the Home Screen app

  // Granted -> keep this device registered, quietly. Runs on load, whenever
  // the app returns to the foreground, and when the browser comes back online,
  // so an expired / dropped subscription repairs itself without a re-login.
  useEffect(() => {
    if (!supported || perm !== "granted") return undefined;
    let last = 0;
    const resync = (force) => {
      if (document.visibilityState !== "visible" || Notification.permission !== "granted") return;
      const now = Date.now();
      if (!force && now - last < RESYNC_EVERY_MS) return;
      last = now;
      ensurePushSubscribed({ token });
    };
    resync(true);
    const onVisible = () => resync(false);
    const onOnline = () => resync(true);
    const onSwMessage = (e) => {
      if (e?.data?.type === "hopenix.resubscribe") resync(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      navigator.serviceWorker.removeEventListener("message", onSwMessage);
    };
  }, [supported, perm, token]);

  // Notice permission changes made in the browser's site settings while the
  // page is open (e.g. unblocking) and react without a reload.
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return undefined;
    let status;
    let cancelled = false;
    navigator.permissions
      .query({ name: "notifications" })
      .then((s) => {
        if (cancelled) return;
        status = s;
        s.onchange = () => setPerm(Notification.permission);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (status) status.onchange = null;
    };
  }, [supported]);

  useEffect(() => {
    if (!thanks) return undefined;
    const t = setTimeout(() => setThanks(false), 3000);
    return () => clearTimeout(t);
  }, [thanks]);

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    // requestPermission() must be the first thing after the tap.
    const result = await ensurePushSubscribed({ prompt: true, token });
    setPerm(Notification.permission);
    setBusy(false);
    if (result.ok) setThanks(true);
    else if (Notification.permission === "default") setNote("Please tap “Allow” in the browser's permission box to turn notifications on.");
    else if (result.message) setNote(result.message);
  };

  if (thanks) {
    return (
      <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[10000] px-4 py-2 rounded-full bg-emerald-600 text-white text-[12px] font-semibold shadow-lg">
        Notifications are on ✓
      </div>
    );
  }

  // Granted: nothing to ask. On an Android phone that is NOT using the installed
  // app, show a small one-time card — Android puts a plain Chrome tab to sleep,
  // which is the usual reason notifications stop when the phone is locked.
  if (perm === "granted") {
    if (!isAndroid || isStandalone || nudgeDone) return null;
    const done = () => {
      lsSet(NUDGE_KEY, "1");
      setNudgeDone(true);
    };
    const nCard = darkMode ? "bg-[#14122b] text-violet-50 border border-violet-500/30" : "bg-white text-slate-900 border border-slate-200";
    return (
      <div className={`fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:max-w-sm z-[10000] rounded-2xl p-4 shadow-2xl ${nCard}`}>
        <p className="text-[13px] font-bold">Get notifications even when your phone is locked</p>
        <p className={`text-[12px] mt-1 ${darkMode ? "text-violet-200/80" : "text-slate-600"}`}>
          Install Hopenix as an app and let it run in the background, otherwise your phone may put the browser to sleep.
        </p>
        {showTips && (
          <ol className={`list-decimal pl-5 mt-2 space-y-1 text-[11px] ${darkMode ? "text-violet-100/90" : "text-slate-700"}`}>
            {PHONE_TIPS.map((t) => <li key={t}>{t}</li>)}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {canInstall && (
            <button
              type="button"
              onClick={async () => {
                await installHopenixApp();
                setShowTips(true);
              }}
              className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[12px] font-semibold hover:bg-violet-700"
            >
              Install app
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowTips((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border ${darkMode ? "border-violet-400/40" : "border-slate-300"}`}
          >
            {showTips ? "Hide steps" : "Show steps"}
          </button>
          <button type="button" onClick={done} className="ml-auto text-[12px] opacity-70 hover:opacity-100">
            Done
          </button>
        </div>
      </div>
    );
  }

  // Unsupported (non-iPhone) / dismissed for this visit: show nothing.
  if (hidden || (!supported && !needsInstall)) return null;

  const blocked = perm === "denied";
  const card = darkMode ? "bg-[#14122b] text-violet-50 border border-violet-500/30" : "bg-white text-slate-900";
  const sub = darkMode ? "text-violet-200/80" : "text-slate-600";
  const btn = "w-full px-4 py-2.5 rounded-xl bg-violet-600 text-white text-[13px] font-semibold hover:bg-violet-700 disabled:opacity-60";
  const btnGhost = `w-full px-4 py-2 rounded-xl text-[12px] font-medium ${darkMode ? "text-violet-200 hover:bg-white/5" : "text-slate-500 hover:bg-slate-100"}`;

  let title = "Allow notifications";
  let text = `Get ${what} on this device, even when Hopenix is closed — just like WhatsApp.`;
  if (needsInstall) {
    title = "Add Hopenix to your Home Screen";
    text = "On iPhone, notifications only work from the Home Screen app. Tap Share → Add to Home Screen, then open Hopenix from there and tap Allow.";
  } else if (blocked) {
    title = "Notifications are blocked";
    text = "Open the browser's site settings (lock icon next to the address bar, or Settings → Site settings → Notifications), set Hopenix to Allow, then come back here.";
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full max-w-sm rounded-2xl p-6 text-center shadow-2xl ${card}`}>
        <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-violet-600/15 flex items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </div>
        <h2 className="text-[17px] font-bold mb-1.5">{title}</h2>
        <p className={`text-[13px] leading-relaxed mb-5 ${sub}`}>{note || text}</p>
        <div className="space-y-2">
          {!needsInstall && !blocked && (
            <button type="button" onClick={allow} disabled={busy} className={btn}>
              {busy ? "Waiting…" : "Allow notifications"}
            </button>
          )}
          {blocked && !needsInstall && (
            <button type="button" onClick={() => window.location.reload()} className={btn}>
              I've allowed it — reload
            </button>
          )}
          <button type="button" onClick={() => setHidden(true)} className={btnGhost}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
