import { useEffect, useRef } from "react";

/**
 * Shared "keep this page live" hook.
 *
 * Many pages loaded their data from the backend ONCE on mount, so a change
 * made from another browser/device (admin assigns something, approves a
 * user, a client pays, ...) never showed up until a manual reload. This
 * re-runs a page's own *silent* loader on an interval, when the tab
 * becomes visible/focused again, and when the network comes back.
 *
 * `callback` must be SILENT and must not blank the screen on failure
 * (swallow errors, keep the data already shown). Runs are skipped while
 * the tab is hidden and never overlap.
 */
export function useLiveRefresh(callback, { interval = 15000, enabled = true } = {}) {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let inFlight = false;

    const run = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        await ref.current();
      } catch {
        // silent by design — keep whatever is already on screen
      } finally {
        inFlight = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };

    const timer = setInterval(run, interval);
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [interval, enabled]);
}

/** setState helper: only replace state when the data really changed. */
export function sameJson(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
