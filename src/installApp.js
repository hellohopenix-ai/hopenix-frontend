// Shared helpers for "install Hopenix as an app" + the phone settings that
// decide whether notifications reach a phone that is locked / not in use.
//
// Why this matters: on Android, a notification sent to Chrome only arrives
// while the phone lets Chrome wake up. Many phones (Tecno / Infinix / Itel /
// Xiaomi / Oppo / Vivo / Realme / Samsung) shut Chrome down in the background,
// and then nothing can arrive until Chrome is opened again. An INSTALLED
// Hopenix app (Chrome ⋮ → Install app) is treated by Android as its own app,
// has its own notification settings and is far less likely to be put to sleep.

export const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);
export const isStandalone =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

// Chrome fires `beforeinstallprompt` once, early — capture it at load.
let deferredInstallPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    window.dispatchEvent(new Event("hopenix-install-ready"));
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    window.dispatchEvent(new Event("hopenix-install-ready"));
  });
}

export function canInstallApp() {
  return !!deferredInstallPrompt;
}

/** Opens Chrome's own install dialog. Resolves true when the person accepted. */
export async function installHopenixApp() {
  if (!deferredInstallPrompt) return false;
  let accepted = false;
  try {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    accepted = choice?.outcome === "accepted";
  } catch {
    /* dismissed */
  }
  deferredInstallPrompt = null;
  window.dispatchEvent(new Event("hopenix-install-ready"));
  return accepted;
}

export const PHONE_TIPS = [
  "Install Hopenix as an app: Chrome ⋮ menu → “Install app” (or “Add to Home screen”). Then open Hopenix from its new icon.",
  "Phone Settings → Apps → Hopenix (or Chrome) → Battery → choose “Unrestricted” / “No restrictions”. On Tecno / Infinix / Itel / Xiaomi / Oppo / Vivo / Realme also switch ON “Autostart” and lock the app in the recent-apps screen (so “clean / boost” never closes it).",
  "Phone Settings → Apps → Hopenix (or Chrome) → Notifications → ON, sound ON, importance “High / Urgent”, and allow notifications on the lock screen.",
  "Turn OFF Do Not Disturb / Focus mode, and make sure the phone isn't on silent.",
  "Never swipe Hopenix / Chrome away and then use “Force stop” or a cleaner app — a force-stopped app can't receive anything until it's opened again.",
];
