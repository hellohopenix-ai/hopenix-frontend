/* ===========================================================================
   taskNotifications.js
   ---------------------------------------------------------------------------
   Sidebar red dot for "you were assigned a task".

   OLD: whoever created/edited a task wrote `{ "<assignee name>": true }` into
   the shared localStorage key `sidebar_task_notifications_v1`. That only ever
   worked if the assignee happened to open the app in the SAME browser as the
   person who assigned the task — a flag one user sets for another cannot live
   in per-user storage.

   NOW: the dot is derived from the real tasks on the server. A task assigned
   to me that I have not "seen" yet lights the dot; opening Tasks marks the
   ids I currently have as seen. The seen ids are a per-user flag
   (sidebar_tasks_seen_ids_v1 -> /api/flags/), so it follows the account
   across devices, and no user ever needs to write into someone else's data.
   =========================================================================== */

import { API_ROOT } from "./apiConfig.js";
import { FLAG_KEYS, syncFlag } from "./userFlags.js";

const MAX_SEEN_IDS = 500;

/** Ids of tasks whose assignees include `name` (same name-matching the
 *  backend's ?assignee= filter and the Tasks page use). Throws if the user
 *  has no access to the Tasks module (403) — callers treat that as "no dot". */
export async function fetchAssignedTaskIds(name) {
  const token = localStorage.getItem("hopenix_auth_token");
  if (!token || !name) return [];
  const res = await fetch(`${API_ROOT}/api/tasks/tasks/?assignee=${encodeURIComponent(name)}`, {
    headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
  });
  if (!res.ok) throw new Error(`Tasks API ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data?.results || [];
  return list.map((t) => t.id).filter((id) => id != null);
}

function readSeen() {
  try {
    const raw = localStorage.getItem(FLAG_KEYS.tasksSeen);
    if (raw == null) return null; // never initialised on this account yet
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return null;
  }
}

function writeSeen(set) {
  try {
    localStorage.setItem(FLAG_KEYS.tasksSeen, JSON.stringify(Array.from(set).slice(-MAX_SEEN_IDS)));
    syncFlag(FLAG_KEYS.tasksSeen);
  } catch {
    // storage unavailable — dot may reappear next visit, nothing breaks
  }
}

/** Opening the Tasks page: everything currently assigned counts as seen. */
export function markTasksSeen(ids) {
  const seen = readSeen() || new Set();
  let changed = false;
  ids.forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      changed = true;
    }
  });
  if (changed || readSeen() === null) writeSeen(seen);
}

/** true when at least one currently-assigned task has not been seen yet.
 *  The very first check on an account seeds the seen-set with what already
 *  exists (so old tasks don't all show up as "new") and returns false. */
export function hasUnseenTasks(ids) {
  const seen = readSeen();
  if (seen === null) {
    writeSeen(new Set(ids));
    return false;
  }
  return ids.some((id) => !seen.has(id));
}
