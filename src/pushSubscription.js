// Registers the service worker and subscribes this browser to Web Push,
// so calls can still ring the user even when the Hopenix tab/browser is
// fully closed (see public/sw.js on the frontend and messaging/push_utils.py
// + CallStartView on the backend). Call ensurePushSubscribed() once after
// login (see AuthContext.jsx) — it's a no-op (and safe to call again) if
// already subscribed, unsupported, or the user hasn't granted permission.
//
// NOTE ON WHAT THIS CAN AND CAN'T DO: a push notification can wake the
// browser and show an OS-level alert with the tab fully closed, and
// clicking it can open/focus the app — but it can NOT auto-answer the
// call, play a ringtone, or open the WebRTC connection while the site
// itself isn't running. That's a hard browser sandboxing limit, not a
// bug here — no web app can be woken into full background execution the
// way a native phone app can. Opening the notification is still what
// gets them into the call in time, same practical effect as a native
// app "ringing" for the couple of seconds before you pick up.

import { API_ROOT } from "./apiConfig.js";

const API_BASE_URL = `${API_ROOT}/api/messages`; // same host callsApi.js uses

// Paste the PUBLIC key printed by `npx web-push generate-vapid-keys`.
// The backend gets the matching PRIVATE key via hopenix/settings.py + .env.
const VAPID_PUBLIC_KEY = "BJcYjFfxa7wN95cOpokMfRbwnlYqMllQ_y6xluK4lFfvPKHi2rxq7bxuR5XvqbZzV04TBzNh63F9vFcfORpKHuM";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("hopenix_auth_token");
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers["Authorization"] = `Token ${token}`;
  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  if (!res.ok) throw new Error(`Push request failed (${res.status})`);
  return res.json().catch(() => null);
}

/** Registers /sw.js and subscribes this device to Web Push.
 *
 *  - Default (`prompt: false`, what the automatic calls after login use):
 *    only finishes the job if the person has ALREADY allowed notifications.
 *    It never pops the permission dialog by itself — phones ignore or
 *    silently suppress a prompt that isn't caused by a tap, which is why the
 *    "Enable" bar used to do nothing.
 *  - `prompt: true` (the "Enable" button): asks for permission FIRST, while
 *    the tap is still fresh, then subscribes and saves the subscription.
 *
 *  Always resolves (never throws) with `{ ok, status, message }` so the
 *  caller can tell the person what happened. */
export async function ensurePushSubscribed({ prompt = false } = {}) {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, status: "unsupported", message: "This browser can't show background notifications. Open Hopenix in Chrome (or Safari on iPhone, from the Home Screen)." };
  }
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("PASTE_")) {
    console.warn("VAPID_PUBLIC_KEY not set in pushSubscription.js — call push notifications are disabled.");
    return { ok: false, status: "error", message: "Notifications aren't configured yet." };
  }

  try {
    let permission = Notification.permission;
    if (permission === "default" && prompt) {
      // Must be the first thing that happens after the tap.
      permission = await Notification.requestPermission();
    }
    if (permission === "denied") {
      return { ok: false, status: "denied", message: "Notifications are blocked for this site. Tap the lock icon in the address bar → Permissions → Notifications → Allow, then reload." };
    }
    if (permission !== "granted") {
      return { ok: false, status: "default", message: prompt ? "Notification permission wasn't given — tap Enable and choose Allow." : "" };
    }

    // updateViaCache:"none" + update(): always fetch the newest sw.js, so a
    // deployed fix isn't hidden behind a cached old service worker.
    const reg0 = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
    reg0.update().catch(() => {});
    // subscribe() needs an ACTIVE service worker; right after the first
    // register() it is often still installing, which made the old code fail
    // silently on a fresh visit.
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    // A subscription made earlier with a DIFFERENT public key (keys were
    // regenerated, or a test key was used) is accepted by the browser but the
    // push service rejects every push the server signs with the current key
    // (403 "VAPID mismatch") — so nothing ever arrives. Drop it and re-subscribe.
    if (subscription) {
      try {
        const current = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        const existing = subscription.options?.applicationServerKey;
        if (existing) {
          const a = new Uint8Array(existing);
          const same = a.length === current.length && a.every((v, i) => v === current[i]);
          if (!same) {
            await apiFetch("/push/unsubscribe/", { method: "POST", body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
            await subscription.unsubscribe();
            subscription = null;
          }
        }
      } catch {
        /* comparison is best-effort */
      }
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, // required by Chrome: every push must surface a visible notification
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    await apiFetch("/push/subscribe/", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON()),
    });
    return { ok: true, status: "subscribed", message: "" };
  } catch (err) {
    console.error("Could not set up call push notifications:", err);
    return { ok: false, status: "error", message: `Couldn't turn notifications on (${err?.message || "unknown error"}). Please try again.` };
  }
}

/** Call on logout so a signed-out device stops being pushed to. */
export async function clearPushSubscription() {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration && (await registration.pushManager.getSubscription());
    if (!subscription) return;
    await apiFetch("/push/unsubscribe/", {
      method: "POST",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => {});
    await subscription.unsubscribe();
  } catch (err) {
    console.error("Could not clear call push subscription:", err);
  }
}