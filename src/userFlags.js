/* ===========================================================================
   userFlags.js
   ---------------------------------------------------------------------------
   Small per-user UI flags (birthday popup already dismissed, "seen" markers,
   already-notified keys, ...) used to live ONLY in one browser's localStorage,
   so the same person on a phone + a laptop saw different dots and got the
   same notification twice.

   They now follow the account through the backend's /api/flags/ (userflags
   app), while localStorage stays as a fast, synchronous cache so every
   existing reader keeps working unchanged:

     - writers keep calling localStorage.setItem(key, ...) and then call
       syncFlag(key) -> debounced PUT /api/flags/<key>/
     - hydrateFlags() runs once after login / session restore: it pulls the
       server copy, MERGES it with whatever is cached locally (so nothing is
       lost on the first run), writes the result back to the cache and, if the
       server was behind, uploads the merged value.
     - clearLocalFlags() runs on logout so the next person on the same
       browser never inherits (or uploads) someone else's flags.

   Everything is best-effort: if the backend is down the app behaves exactly
   like the old localStorage-only version.
   =========================================================================== */

import { API_ROOT } from "./apiConfig.js";

const STAFF_TOKEN_KEY = "hopenix_auth_token";
const PORTAL_SESSION_KEY = "clientportal_session_v1";
const OWNER_KEY_PREFIX = "hopenix_flags_owner_";
const DEBOUNCE_MS = 600;
const HYDRATE_TIMEOUT_MS = 4000;

export const FLAG_KEYS = {
  taskAutoNotified: "taskspage_notified_auto_keys_v1",
  tasksSeen: "sidebar_tasks_seen_ids_v1",
  celebrationDismissed: "hopenix_birthday_celebration_dismissed",
  pendingBirthday: "hopenix_pending_birthday_messages",
  teamConfettiDismissed: "hopenix_team_birthday_confetti_dismissed_date",
  portalSeenActivity: "clientportal_seen_activity_v1",
};

// Which flags belong to which kind of login (staff account vs client portal).
const KEYS_BY_KIND = {
  staff: [
    FLAG_KEYS.taskAutoNotified,
    FLAG_KEYS.tasksSeen,
    FLAG_KEYS.celebrationDismissed,
    FLAG_KEYS.pendingBirthday,
    FLAG_KEYS.teamConfettiDismissed,
  ],
  portal: [FLAG_KEYS.portalSeenActivity, FLAG_KEYS.celebrationDismissed, FLAG_KEYS.pendingBirthday],
};

/* ------------------------------ helpers ------------------------------ */

function tokenFor(kind) {
  try {
    if (kind === "portal") {
      const s = JSON.parse(localStorage.getItem(PORTAL_SESSION_KEY) || "null");
      return s?.token || null;
    }
    return localStorage.getItem(STAFF_TOKEN_KEY);
  } catch {
    return null;
  }
}

function readLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw; // a few flags are stored as a bare string (e.g. a date)
    }
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // storage unavailable — flag just won't be cached on this device
  }
}

async function flagRequest(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${API_ROOT}/api/flags/${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Flags API ${res.status}`);
  if (res.status === 204) return null;
  return res.json();
}

const isPlainObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function itemIdentity(item) {
  // pending birthday messages are objects; everything else in arrays is a primitive
  return `${item.audience || ""}|${item.userId}|${item.dateKey}`;
}

/** Merge a server value with the locally cached one. "Seen / dismissed /
 *  delivered" style data only ever moves one way, so a merge never resurrects
 *  something the user already cleared on another device. */
function mergeValues(server, local) {
  if (server === undefined || server === null) return local;
  if (local === undefined || local === null) return server;

  if (Array.isArray(server) && Array.isArray(local)) {
    if (server.every((x) => !isPlainObject(x)) && local.every((x) => !isPlainObject(x))) {
      return Array.from(new Set([...server, ...local]));
    }
    const byId = new Map();
    [...server, ...local].forEach((item) => {
      if (!isPlainObject(item)) return;
      const id = itemIdentity(item);
      const prev = byId.get(id);
      byId.set(id, prev ? { ...prev, ...item, delivered: Boolean(prev.delivered || item.delivered) } : item);
    });
    return Array.from(byId.values());
  }

  if (isPlainObject(server) && isPlainObject(local)) {
    const out = { ...server };
    Object.keys(local).forEach((k) => {
      out[k] = k in server ? mergeValues(server[k], local[k]) : local[k];
    });
    return out;
  }

  if (typeof server === "number" && typeof local === "number") return Math.max(server, local);
  if (typeof server === "boolean" && typeof local === "boolean") return server || local;
  if (typeof server === "string" && typeof local === "string") return server > local ? server : local; // ISO dates
  return server;
}

/* --------------------------- write (local -> server) --------------------------- */

const pending = new Map(); // key -> { kind, token, timer }

async function pushFlag(key, token) {
  const value = readLocal(key);
  try {
    if (value == null) await flagRequest(`${encodeURIComponent(key)}/`, { method: "DELETE", token });
    else await flagRequest(`${encodeURIComponent(key)}/`, { method: "PUT", token, body: { value } });
  } catch (err) {
    console.warn(`Could not save flag "${key}" to the server (kept locally):`, err.message);
  }
}

/** Call right AFTER writing the flag to localStorage. Debounced. */
export function syncFlag(key, kind = "staff") {
  const token = tokenFor(kind); // captured now, so a logout right after still uses it
  if (!token) return;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => {
    pending.delete(key);
    pushFlag(key, token);
  }, DEBOUNCE_MS);
  pending.set(key, { kind, token, timer });
}

/** Send anything still waiting in the debounce queue (call before logout). */
export async function flushFlags() {
  const entries = Array.from(pending.entries());
  pending.clear();
  await Promise.all(
    entries.map(([key, p]) => {
      clearTimeout(p.timer);
      return pushFlag(key, p.token);
    })
  );
}

/* --------------------------- read (server -> local) --------------------------- */

/** Pull the server copy once after login / session restore and merge it with
 *  the local cache. Never throws; gives up after a few seconds so a slow
 *  backend can't block the app. */
export async function hydrateFlags({ kind = "staff", ownerId } = {}) {
  const token = tokenFor(kind);
  if (!token || ownerId == null) return;
  const keys = KEYS_BY_KIND[kind] || [];

  const work = (async () => {
    const ownerKey = `${OWNER_KEY_PREFIX}${kind}`;
    const prevOwner = localStorage.getItem(ownerKey);
    if (prevOwner && prevOwner !== String(ownerId)) {
      // Cached flags belong to somebody else who used this browser: drop
      // them so they are neither shown to, nor uploaded for, this account.
      keys.forEach((k) => writeLocal(k, null));
    }
    localStorage.setItem(ownerKey, String(ownerId));

    const data = await flagRequest("", { token });
    const server = (data && data.flags) || {};

    for (const key of keys) {
      const serverVal = key in server ? server[key] : undefined;
      const merged = mergeValues(serverVal, readLocal(key));
      if (merged === undefined || merged === null) continue;
      writeLocal(key, merged);
      if (JSON.stringify(merged) !== JSON.stringify(serverVal)) syncFlag(key, kind);
    }
    window.dispatchEvent(new CustomEvent("hopenix:flags-hydrated", { detail: { kind } }));
  })();

  try {
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, HYDRATE_TIMEOUT_MS))]);
  } catch (err) {
    console.warn("Could not load saved flags from the server (using this device's copy):", err.message);
  }
}

/** Logout: forget this account's cached flags on this device. */
export function clearLocalFlags(kind = "staff") {
  (KEYS_BY_KIND[kind] || []).forEach((k) => writeLocal(k, null));
  try {
    localStorage.removeItem(`${OWNER_KEY_PREFIX}${kind}`);
  } catch {
    // ignore
  }
}
