import React, { useEffect, useState } from "react";
import { ensurePushSubscribed, sendTestPush } from "../pushSubscription.js";

// Phones (iOS especially) only allow the notification permission prompt from
// a real tap, so the automatic prompt after login isn't enough there. This
// slim bar shows until notifications are on (or dismissed) and enables them
// on tap. It also SAYS what happened (working / blocked / unsupported)
// instead of silently doing nothing.
//
// NEW: once notifications are allowed, the bar offers a "Test" that sends a
// real push to this account and asks "did it arrive?". A second test fires
// 15 s later so the person can close Hopenix first and see whether it also
// arrives while the app is NOT open. If it doesn't, the bar shows the exact
// device settings that usually block it (battery restriction, Chrome
// background running, notification importance) instead of failing silently.
const isIOS = /iphone|ipad|ipod/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
const isAndroid = /android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "");
const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

const VERIFIED_KEY = "hopenix_push_verified_v1"; // set once the person confirmed a test arrived
const PENDING_KEY = "hopenix_push_delayed_test_at"; // when a "app closed" test was scheduled
const RESYNC_EVERY_MS = 10 * 60 * 1000;

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
function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Chrome offers "install as app" through this event. It fires once, early, so
// it is captured at module load and kept for the button below.
let deferredInstallPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new Event("hopenix-install-ready"));
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
  });
}

const ANDROID_TIPS = [
  "Phone Settings → Apps → Chrome → Battery → choose “Unrestricted” (on Xiaomi / Oppo / Vivo / Realme / Infinix / Tecno also switch ON “Autostart” and lock Chrome in the recent-apps screen). This is the most common reason notifications only show up after you open Chrome.",
  "Phone Settings → Apps → Chrome (or Hopenix, if installed) → Notifications → make sure “Sites” / Hopenix is ON, sound is ON and importance is “High / Urgent”.",
  "Turn OFF Do Not Disturb / Focus mode and check the phone isn't on silent.",
  "Install Hopenix as an app (Chrome ⋮ menu → “Install app”). The installed app gets its own notification settings and is far less likely to be put to sleep.",
];
const DESKTOP_TIPS = [
  "In Chrome open chrome://settings/system and switch ON “Continue running background apps when Google Chrome is closed”. Without it, nothing can arrive once Chrome is fully closed.",
  "Windows Settings → System → Notifications: make sure notifications are ON for Chrome (or Hopenix if installed) and Focus assist / Do not disturb is OFF.",
  "Install Hopenix as an app (install icon at the right end of the address bar). An installed app can also be set to start when you sign in to the computer.",
];

// `token`: the auth token to register this device under. Omit it for staff (the
// normal login is used); the Client Portal passes its own portal token.
// `audience="client"` only changes the wording. `className` is added to the bar.
export default function EnableNotificationsBanner({ darkMode, token, audience, className = "" }) {
  const what = audience === "client" ? "messages, project updates and birthday wishes" : "messages, calls and tasks";
  const supported = typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
  const [perm, setPerm] = useState(supported ? Notification.permission : "unsupported");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(""); // last result message, shown in place of the default text
  const [justEnabled, setJustEnabled] = useState(false);
  const [dismissed, setDismissed] = useState(() => lsGet("hopenix_notif_banner_dismissed") === "1");

  // Test flow: idle | testing | asked | scheduled | error | help
  const [verified, setVerified] = useState(() => lsGet(VERIFIED_KEY) === "1");
  const [testHidden, setTestHidden] = useState(false); // "Later" — until next visit
  const [step, setStep] = useState(() => {
    const at = Number(lsGet(PENDING_KEY) || 0);
    return at && Date.now() - at < 15 * 60 * 1000 ? "asked" : "idle"; // came back after an "app closed" test
  });
  const [testMsg, setTestMsg] = useState("");
  const [canInstall, setCanInstall] = useState(!!deferredInstallPrompt);

  useEffect(() => {
    const onReady = () => setCanInstall(true);
    window.addEventListener("hopenix-install-ready", onReady);
    return () => window.removeEventListener("hopenix-install-ready", onReady);
  }, []);

  // Already allowed on this device -> quietly make sure the push subscription
  // exists and is saved on the server (no prompt involved). Repeated whenever
  // the app comes back to the foreground (at most every 10 min), so a
  // subscription that expired or was dropped is repaired without a re-login.
  useEffect(() => {
    if (!supported) return undefined;
    let last = 0;
    const resync = () => {
      if (document.visibilityState !== "visible" || Notification.permission !== "granted") return;
      const now = Date.now();
      if (now - last < RESYNC_EVERY_MS) return;
      last = now;
      ensurePushSubscribed({ token });
    };
    resync();
    document.addEventListener("visibilitychange", resync);
    return () => document.removeEventListener("visibilitychange", resync);
  }, [supported, token]);

  useEffect(() => {
    if (!justEnabled) return undefined;
    const t = setTimeout(() => setJustEnabled(false), 3500);
    return () => clearTimeout(t);
  }, [justEnabled]);

  const needsInstall = isIOS && !isStandalone; // iPhone: push only works from the Home Screen app
  const shell = `shrink-0 px-4 sm:px-6 py-2 flex items-center justify-between gap-3 text-[12px] ${darkMode ? "bg-violet-950 text-violet-100" : "bg-violet-50 text-violet-900"} ${className}`;
  const btn = "px-3 py-1 rounded-md bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-60";
  const btnGhost = `px-3 py-1 rounded-md font-semibold border ${darkMode ? "border-violet-400/40 hover:bg-violet-900" : "border-violet-300 hover:bg-violet-100"}`;

  const fail = (message) => {
    setTestMsg(message);
    setStep("error");
  };

  // delay 0: send now and read the push service's answer. delay > 0: send
  // later so the person can close the app first.
  const runTest = async (delay = 0) => {
    if (busy) return;
    setBusy(true);
    setStep("testing");
    setTestMsg("");
    lsRemove(PENDING_KEY);
    try {
      // Make sure THIS device is registered before asking the server to push.
      const sub = await ensurePushSubscribed({ token });
      if (!sub.ok) return fail(sub.message || "This device couldn't be registered for notifications.");

      const r = await sendTestPush({ delay, token });
      if (!r.configured) return fail(`The server can't send notifications yet: ${r.reason}`);
      if (!r.subscriptions) return fail("The server doesn't have this device registered yet. Reload the page and try again.");

      if (delay > 0) {
        lsSet(PENDING_KEY, String(Date.now()));
        setStep("scheduled");
        return undefined;
      }
      if (r.delivered > 0) {
        setTestMsg(`Test sent to ${r.delivered} device${r.delivered > 1 ? "s" : ""}.`);
        setStep("asked");
        return undefined;
      }
      const e = r.errors?.[0];
      if (e) return fail(`The push service (${e.device}) refused the notification${e.status ? ` [${e.status}]` : ""}. ${e.detail || ""}`.trim());
      if (r.removed) {
        // The old registration had expired and was cleaned up; this device now
        // registers a fresh one on the next attempt.
        await ensurePushSubscribed({ token });
        return fail("This device's old registration had expired. A new one was created — tap “Try again”.");
      }
      return fail("Nothing was delivered. Tap “Try again”.");
    } catch (err) {
      return fail(err?.message || "Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const confirmWorking = () => {
    lsSet(VERIFIED_KEY, "1");
    lsRemove(PENDING_KEY);
    setVerified(true);
    setStep("idle");
    setJustEnabled(true);
  };

  const installApp = async () => {
    if (!deferredInstallPrompt) return;
    try {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
    } catch {
      /* dismissed */
    }
    deferredInstallPrompt = null;
    setCanInstall(false);
  };

  if (justEnabled) {
    return <div className={shell}><span>Notifications are on ✓ — you'll get {what} even when Hopenix is closed.</span></div>;
  }

  // ---------- notifications are allowed: run / show the delivery test ----------
  if (perm === "granted") {
    if (verified || testHidden) return null;

    if (step === "help") {
      const tips = isAndroid ? ANDROID_TIPS : DESKTOP_TIPS;
      return (
        <div className={`${shell} flex-col items-stretch !gap-2`}>
          <div className="font-semibold">Notification didn't arrive? Your device is probably putting the browser to sleep. Please check:</div>
          <ol className="list-decimal pl-5 space-y-1">
            {tips.map((t) => <li key={t}>{t}</li>)}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {canInstall && <button type="button" onClick={installApp} className={btn}>Install Hopenix app</button>}
            <button type="button" onClick={() => runTest(0)} disabled={busy} className={btn}>Test again</button>
            <button type="button" onClick={() => runTest(15)} disabled={busy} className={btnGhost}>Test with app closed</button>
            <button type="button" onClick={() => setTestHidden(true)} className="opacity-70 hover:opacity-100 ml-auto" aria-label="Close">✕</button>
          </div>
        </div>
      );
    }

    if (step === "testing") {
      return <div className={shell}><span>Sending a test notification…</span></div>;
    }

    if (step === "scheduled") {
      return (
        <div className={shell}>
          <span>Now <b>close Hopenix</b> (or lock your phone). A test notification will arrive in about 15 seconds. Then open Hopenix again and tell me if it came.</span>
          <button type="button" onClick={() => setStep("asked")} className={btnGhost}>I'm back</button>
        </div>
      );
    }

    if (step === "asked") {
      return (
        <div className={shell}>
          <span>{testMsg || "Did the test notification arrive (with a sound)?"} {testMsg ? "Did it appear with a sound?" : ""}</span>
          <span className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={confirmWorking} className={btn}>Yes</button>
            <button type="button" onClick={() => { lsRemove(PENDING_KEY); setStep("help"); }} className={btnGhost}>No</button>
            <button type="button" onClick={() => runTest(15)} disabled={busy} className={btnGhost}>Test with app closed</button>
          </span>
        </div>
      );
    }

    if (step === "error") {
      return (
        <div className={shell}>
          <span>{testMsg}</span>
          <span className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => runTest(0)} disabled={busy} className={btn}>Try again</button>
            <button type="button" onClick={() => setStep("help")} className={btnGhost}>Help</button>
            <button type="button" onClick={() => setTestHidden(true)} className="opacity-70 hover:opacity-100" aria-label="Dismiss">✕</button>
          </span>
        </div>
      );
    }

    return (
      <div className={shell}>
        <span>Notifications are allowed on this device. Run a quick test to be sure they reach you, even when Hopenix is closed.</span>
        <span className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => runTest(0)} disabled={busy} className={btn}>Test now</button>
          <button type="button" onClick={() => setTestHidden(true)} className="opacity-70 hover:opacity-100" aria-label="Later">✕</button>
        </span>
      </div>
    );
  }

  // ---------- not allowed yet ----------
  if (dismissed || (!supported && !needsInstall)) return null;

  const dismiss = () => {
    lsSet("hopenix_notif_banner_dismissed", "1");
    setDismissed(true);
  };
  const enable = async () => {
    if (busy) return;
    setBusy(true);
    setNote("");
    const result = await ensurePushSubscribed({ prompt: true, token });
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
            : `Turn on notifications to know about new ${what} even when Hopenix is closed.`)}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {!needsInstall && (
          <button type="button" onClick={enable} disabled={busy} className={btn}>
            {busy ? "Enabling…" : "Enable"}
          </button>
        )}
        <button onClick={dismiss} className="opacity-70 hover:opacity-100" aria-label="Dismiss">✕</button>
      </span>
    </div>
  );
}