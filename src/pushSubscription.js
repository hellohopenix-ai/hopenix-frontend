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
const VAPID_PUBLIC_KEY = "PASTE_YOUR_VAPID_PUBLIC_KEY_HERE";

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

/** Call after login. Registers /sw.js, asks for Notification permission
 * (skips silently if already denied — never re-prompts, matching browser
 * norms), subscribes to Web Push, and saves the subscription server-side. */
export async function ensurePushSubscribed() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return; // unsupported browser
  if (!VAPID_PUBLIC_KEY || VAPID_PUBLIC_KEY.startsWith("PASTE_")) {
    console.warn("VAPID_PUBLIC_KEY not set in pushSubscription.js — call push notifications are disabled.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return; // user declined — respect it

    let subscription = await registration.pushManager.getSubscription();
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
  } catch (err) {
    console.error("Could not set up call push notifications:", err);
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
