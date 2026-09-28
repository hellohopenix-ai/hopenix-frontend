import { useEffect, useMemo, useRef, useState } from "react";
import {
  ListChecks,
  CheckCircle2,
  Clock,
  Hourglass,
  AlertTriangle,
  UserCircle2,
  Search,
  Filter,
  ChevronDown,
  MoreVertical,
  Plus,
  X,
  Check,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Paperclip,
  Trash2,
  Pencil,
  Bell,
  FolderKanban,
  Flag,
  Image as ImageIcon,
  Video,
  Link2,
  Upload,
  Archive,
  File as FileIcon,
  Building2,
  Download,
  FileText,
  Lock,
} from "lucide-react";
import { useAuth, getRoleCategory } from "../AuthContext.jsx";
import { sendMessage as apiSendMessage } from "../messagesApi.js";
// FIX (module/sub-task ticks + attachments from this page never reached
// the real backend): ClientsPage.jsx already syncs its own module
// toggles/attachments to clientsApi.updateModule/uploadModuleFile using
// each module's real backendId (see its toggleProjectModule/
// addModuleAttachment) — this page generates the exact same module/
// sub-task tasks from the exact same `clientspage_clients_v1` record
// (see loadClientsForTaskSync below, which already carries each
// project/module/sub-module's backendId through untouched), it just
// never called the backend with it. See syncModuleStatusToClientsStorage.
import * as clientsApi from "../api/clientsApi.js";
import { API_ROOT } from "../apiConfig.js";

/* ======================================================================
   BACKEND API (tasks app — see hopenix-backend/tasks/)
   ---------------------------------------------------------------------
   Same pattern as AuthContext.jsx's apiFetch: attaches the saved DRF
   Token header, throws a readable Error on non-2xx so callers can just
   try/catch + showToast. localStorage (below) is kept as an offline
   cache/fallback, but the backend is now the source of truth — this is
   what actually replaces the old "fake data" with real, persisted data.
====================================================================== */
// API base URL comes from src/apiConfig.js (VITE_API_BASE_URL).
const TASKS_API_BASE = `${API_ROOT}/api/tasks`;

async function tasksApiFetch(path, options = {}) {
  const token = localStorage.getItem("hopenix_auth_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers["Authorization"] = `Token ${token}`;

  const res = await fetch(`${TASKS_API_BASE}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses (e.g. 204 No Content on delete) have no body
  }
  if (!res.ok) {
    const message =
      (data && (data.detail || Object.values(data)[0])) || "Something went wrong. Please try again.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

/* FIX (zip attachments never actually reached the database): every zip
   the page attached — a task's own proof-of-work zip, and the final
   project deliverable zip — used to go through readFileAsDataUrl() and
   get stuffed into a JSON column (or, for the final deliverable, only
   into browser localStorage, never the backend at all). The backend
   already has a real TaskZipFile model + /tasks/{id}/zip/ endpoints
   built for exactly this (bytes on disk, path+metadata in Postgres) —
   this is the multipart counterpart to tasksApiFetch that actually uses
   them, instead of a second, unused code path sitting idle. */
async function tasksApiUploadZip(taskId, file, { final = false } = {}) {
  const token = localStorage.getItem("hopenix_auth_token");
  const headers = {};
  if (token) headers["Authorization"] = `Token ${token}`;

  const formData = new FormData();
  formData.append("zip", file);
  // FIX: tells the backend this is the project's FINAL deliverable, so it
  // is also stored as the project's own zip — what the Clients page and
  // Client Portal actually read.
  if (final) formData.append("final", "1");

  const res = await fetch(`${TASKS_API_BASE}/tasks/${taskId}/zip/`, {
    method: "POST",
    headers,
    body: formData,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }
  if (!res.ok) {
    const message =
      (data && (data.detail || data.error || Object.values(data)[0])) || "Upload failed. Please try again.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data; // { id, fileName, downloadUrl, uploadedOn, size, ... } — see TaskZipFileSerializer
}

/* NEW (delete an uploaded file / zip / URL from a module): one call to the
   backend's remove-attachment action (tasks/views.py), which deletes the
   attachment everywhere it is stored — the file on disk, the TaskZipFile /
   ModuleFile rows the Clients page + Client Portal read, or the module's
   linked URL. The response carries `deletedModuleFileIds` so the Clients
   page's cached copy can be cleaned too (see
   removeModuleAttachmentFromClientsStorage). Only small identifying fields
   are sent — never a base64 data URL. `localOnly` marks an attachment that
   lives only inside a sub-task checklist row (never mirrored to the Client
   module), so the backend must not go looking for a same-named module file. */
async function tasksApiRemoveAttachment(taskId, attachment, { localOnly = false, moduleId = null } = {}) {
  const hint = { type: attachment.type, name: attachment.name };
  if (attachment.zipFileId != null && attachment.zipFileId !== "") hint.zipFileId = attachment.zipFileId;
  if (attachment.type === "link" && typeof attachment.url === "string") hint.url = attachment.url;
  if (localOnly) hint.localOnly = true;
  return tasksApiFetch(`/tasks/${taskId}/remove-attachment/`, {
    method: "POST",
    // moduleId: real pk of the client's module — lets the backend clean the
    // right module even for older tasks whose own module link was never saved.
    body: JSON.stringify({ attachmentId: attachment.id ?? null, attachment: hint, moduleId }),
  });
}

// A zip attachment is known by two ids: the frontend keeps the backend's
// "task-<pk>" string, the backend's own JSON entry stores the plain <pk>.
// Both normalise to the same key so every copy of one zip is treated as one.
function zipKey(a) {
  if (!a || a.zipFileId == null || a.zipFileId === "") return null;
  return String(a.zipFileId).replace(/^task-/, "");
}

function sameAttachment(a, target) {
  if (!a || !target) return false;
  const zk = zipKey(target);
  return (target.id != null && a.id === target.id) || (zk != null && zipKey(a) === zk);
}

// FIX (same uploaded file showing twice in Project Details): an uploaded
// zip/file used to land in a task's attachments two times — once from the
// upload endpoint itself and once from the add-attachment call that follows
// it. Both copies describe the same file (same zip id, or same attachment
// id), so they are folded into one entry here; the merged entry keeps every
// field either copy had (id + url from this page, zipFileId from the server).
function dedupeAttachments(list) {
  const out = [];
  const index = new Map();
  (list || []).forEach((a) => {
    if (!a || typeof a !== "object") return;
    const zk = zipKey(a);
    const key = zk != null ? `zip:${zk}` : a.id != null && a.id !== "" ? `id:${a.id}` : null;
    if (key == null) {
      out.push(a);
      return;
    }
    if (index.has(key)) {
      const pos = index.get(key);
      const merged = { ...out[pos] };
      Object.entries(a).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") merged[k] = v;
      });
      out[pos] = merged;
    } else {
      index.set(key, out.length);
      out.push(a);
    }
  });
  return out;
}

// Stable key for the delete-confirm state (a zip entry saved by the backend
// has no `id` of its own, only a zipFileId).
function attachmentKey(a) {
  return a.id != null ? `id-${a.id}` : `zip-${zipKey(a) ?? a.name}`;
}

/* ======================================================================
   STATIC CONFIG
====================================================================== */

/* FIX (add new module/project): this used to be a fixed, hardcoded list
   with no way to add to it from the UI. It's now just the SEED/fallback
   list — the actual list of projects lives in state (see `projects` in
   the main component below) and is persisted to localStorage, so a new
   project/module added from Create/Edit Task can be picked again later
   and survives a refresh. */
// FIX ("By Projects mein delete ki hui / kabhi use na hui projects abhi bhi
// dikh rahi hain"): these five used to be seeded into the projects catalog
// for every single install and never removed again, so "CRM System",
// "Graphic Design" and "Video Editing" showed up as permanent empty
// sections in "By Projects" — with "No tasks match the current filters." —
// even on an account that never touched them. The catalog now starts
// empty; a project only ever appears once something real (a client's
// project, or Create Task's "add new project") actually adds it, and the
// pruning pass below (see pruneEmptyProjectsFromCatalog) removes it again
// the moment nothing real is left under that name.
const DEFAULT_PROJECTS = [];

const PRIORITIES = ["High", "Medium", "Low"];

const STATUSES = ["Pending", "In Progress", "In Review", "Completed", "Overdue"];

const PRIORITY_STYLES = {
  High: "bg-rose-50 text-rose-600",
  Medium: "bg-amber-50 text-amber-600",
  Low: "bg-emerald-50 text-emerald-600",
};

const STATUS_STYLES = {
  Pending: "bg-amber-50 text-amber-600",
  "In Progress": "bg-blue-50 text-blue-600",
  "In Review": "bg-violet-50 text-violet-600",
  Completed: "bg-emerald-50 text-emerald-600",
  Overdue: "bg-rose-50 text-rose-600",
};

const PROJECT_ICON_STYLES = {
  "E-Commerce Website": "bg-blue-50 text-blue-500",
  "Mobile Banking App": "bg-violet-50 text-violet-500",
  "CRM System": "bg-emerald-50 text-emerald-500",
  "Graphic Design": "bg-fuchsia-50 text-fuchsia-500",
  "Video Editing": "bg-orange-50 text-orange-500",
};

/* Any newly-added project/module won't have a hand-picked entry above —
   this cycles through a small palette (keyed by name so the same new
   project always gets the same color) instead of rendering with no
   style at all. */
const FALLBACK_PROJECT_ICON_STYLES = [
  "bg-fuchsia-50 text-fuchsia-500",
  "bg-cyan-50 text-cyan-600",
  "bg-amber-50 text-amber-600",
  "bg-lime-50 text-lime-600",
  "bg-orange-50 text-orange-500",
  "bg-teal-50 text-teal-600",
];
function projectIconStyle(name) {
  if (PROJECT_ICON_STYLES[name]) return PROJECT_ICON_STYLES[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return FALLBACK_PROJECT_ICON_STYLES[Math.abs(hash) % FALLBACK_PROJECT_ICON_STYLES.length];
}

const AVATAR_PALETTE = [
  "bg-rose-500",
  "bg-blue-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-indigo-500",
];

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function avatarColor(name) {
  let hash = 0;
  const str = name || "?";
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function Avatar({ name, avatar, size = "w-8 h-8" }) {
  if (typeof avatar === "string" && avatar.trim().length > 0) {
    const src = avatar.includes("?v=") ? avatar : `${avatar}?v=${Date.now()}`;
    return <img src={src} alt={name} className={`${size} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${size} ${avatarColor(name)} rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0`}>
      {initials(name)}
    </div>
  );
}

/* FIX (multi-assignee support): a task can now be given to up to 3 people
   instead of just one. Rather than rewriting every existing task object
   (seed data + anything already saved in localStorage) to a new shape,
   this helper reads BOTH the new `assignees` array (used by tasks
   created/edited from now on) and the old single `assignee` string (used
   by every pre-existing task), so every part of the page below can just
   call getAssignees(task) and get a consistent array either way. */
function getAssignees(task) {
  if (Array.isArray(task.assignees) && task.assignees.length > 0) return task.assignees;
  return task.assignee ? [task.assignee] : [];
}

// FIX ("user ko wo task nahi dikh raha jo usay assign kiya gaya hai"): a
// task's assignee name gets typed/stored in one place (a client's manager
// field on the Clients page, an admin picking from a dropdown, an older
// saved task) and compared against the logged-in user's own `name` in
// another. The two only need to differ by a leading/trailing space or by
// case — "Hira " vs "Hira", "hira" vs "Hira" — for a plain `===` /
// `.includes()` check to call them different people, and the task then
// silently disappears from that person's own "My Tasks" view even though
// it's genuinely assigned to them. Every place that decides "is this task
// mine" now goes through this same trimmed, case-insensitive comparison
// (the same normalisation resolveRealAssignee already used, just shared
// instead of only applied in one spot) so a task assigned to someone always
// shows up for that exact same person regardless of how their name was
// capitalised or spaced when it was typed in.
function isSameAssignee(a, b) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function assignedToUser(task, userName) {
  if (!userName) return false;
  return getAssignees(task).some((n) => isSameAssignee(n, userName));
}

// Union of every assignee across a project's modules — used by the
// grouped "All Tasks" project row so one avatar stack represents
// everyone working on that project, instead of just one module's team.
function projectAssignees(list) {
  const set = new Set();
  list.forEach((t) => getAssignees(t).forEach((n) => set.add(n)));
  return Array.from(set);
}

/* Small stacked-avatar cluster for showing 1-3 assignees compactly in
   table rows / cards, instead of just one name. */
function AssigneeStack({ names, size = "w-6 h-6", darkMode }) {
  if (!names || names.length === 0) {
    return <span className={darkMode ? "text-slate-500 text-xs" : "text-slate-400 text-xs"}>Unassigned</span>;
  }
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div className="flex items-center -space-x-1.5 shrink-0">
        {names.slice(0, 3).map((n) => (
          <span key={n} title={n} className={`rounded-full ring-2 ${darkMode ? "ring-slate-900" : "ring-white"}`}>
            <Avatar name={n} size={size} />
          </span>
        ))}
      </div>
      <span className="truncate">{names.join(", ")}</span>
    </div>
  );
}

/* FIX (looked like a 3-person group assignment): a project row groups
   together every task/module under that project — each one still has
   only ONE assignee, but the old AssigneeStack rendering stacked every
   distinct person from every task in the row side by side, which read as
   "this task got assigned to 3 people at once". This shows just the
   first person plus a "+N more" badge (with everyone's name in the
   tooltip) so it's clear these are separate single-person tasks, not one
   group assignment. */
function ProjectAssigneeSummary({ tasks, size = "w-6 h-6", darkMode }) {
  const names = projectAssignees(tasks);
  if (names.length === 0) {
    return <span className={darkMode ? "text-slate-500 text-xs" : "text-slate-400 text-xs"}>Unassigned</span>;
  }
  return (
    <div className="flex items-center gap-1.5 min-w-0" title={names.length > 1 ? `One person per task: ${names.join(", ")}` : names[0]}>
      <Avatar name={names[0]} size={size} />
      <span className="truncate">{names[0]}</span>
      {names.length > 1 && (
        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
          +{names.length - 1} more (separate tasks)
        </span>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------
   REAL EMPLOYEES ONLY

   Module/assignment tasks generated from a client's project checklist
   (see CLIENT MODULE <-> TASK ENGINE below) get their assignee straight
   from that client's `manager.name` field on the Clients page — which can
   still hold a made-up placeholder name from old demo/seed data (e.g. a
   client set up before any real employee existed, or leftover seed
   content) instead of someone who actually registered and got approved on
   this site. This checks that name against the real, currently-approved
   users list (the exact same list the Assignee dropdown on Create/Edit
   Task is built from) and falls back to "Unassigned" whenever it doesn't
   match a real person — so a fabricated name never shows up as if it were
   a real teammate.
---------------------------------------------------------------------- */
function resolveRealAssignee(name, approvedUsers) {
  if (!name) return "Unassigned";
  const real = (approvedUsers || []).some((u) => (u.name || "").trim().toLowerCase() === name.trim().toLowerCase());
  return real ? name : "Unassigned";
}

let idCounter = 1000;
const nextId = () => ++idCounter;
const pad4 = (n) => String(n).padStart(4, "0");

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isPastDue(iso) {
  if (!iso) return false;
  return new Date(iso + "T23:59:59") < new Date();
}

// A saved attachment can be either a real link (pasted) or just a file
// name (picked via the file input, which can't give us a real URL in the
// browser) — only render/open the first kind as an actual clickable link.
function isUrl(str) {
  if (!str) return false;
  return /^https?:\/\//i.test(str.trim());
}

/* ----------------------------------------------------------------------
   SIDEBAR "NEW ASSIGNMENT" NOTIFICATION

   Whenever a task is created/edited so that someone new is now assigned
   to it, we flag that person's name here. A Sidebar/Nav component (not
   part of this file) can read this same key on mount and whenever the
   "tasks:assignment" window event fires, and show a red dot on the Tasks
   nav item for exactly the users included here. The flag for the current
   user is cleared as soon as they land on this page (see the effect in
   the main component), since opening Tasks counts as "seen".
---------------------------------------------------------------------- */
const TASK_NOTIFY_STORAGE_KEY = "sidebar_task_notifications_v1";

function flagTaskNotification(names) {
  try {
    const raw = localStorage.getItem(TASK_NOTIFY_STORAGE_KEY);
    const flags = raw ? JSON.parse(raw) : {};
    names.forEach((n) => {
      if (n) flags[n] = true;
    });
    localStorage.setItem(TASK_NOTIFY_STORAGE_KEY, JSON.stringify(flags));
    window.dispatchEvent(new CustomEvent("tasks:assignment", { detail: { names } }));
  } catch {
    // storage unavailable — the red dot just won't show this session
  }
}

function clearTaskNotification(name) {
  try {
    const raw = localStorage.getItem(TASK_NOTIFY_STORAGE_KEY);
    if (!raw) return;
    const flags = JSON.parse(raw);
    if (!flags[name]) return;
    delete flags[name];
    localStorage.setItem(TASK_NOTIFY_STORAGE_KEY, JSON.stringify(flags));
    window.dispatchEvent(new CustomEvent("tasks:assignment", { detail: { names: [] } }));
  } catch {
    // storage unavailable — nothing to clear
  }
}

/* ----------------------------------------------------------------------
   TASK ASSIGNMENT -> MESSAGES

   Whenever someone is newly assigned a task (Create Task or Edit Task),
   they should also get a real chat message about it on the Messages
   page — not just the sidebar red-dot flagTaskNotification() already
   handles. `conversations`/`setConversations` are the exact same shared
   state Dashboard.jsx already passes to ProjectsPage and MessagesPage
   (see Dashboard's CONVERSATIONS_STORAGE_KEY), so appending a message
   here shows up immediately in Messages for both the admin and the
   assignee, and is persisted the same way any other message is.

   Each assignee is matched to their conversation by real user id
   (`authId`) — the same field Dashboard.jsx's own approvedUsers-sync
   effect uses to create/keep that conversation in the first place — not
   by name, since two different people could share a name but never
   share an id. If a conversation for someone doesn't exist yet for any
   reason, that one person just doesn't get a message this time; nothing
   crashes and the sidebar notification still goes through regardless.
---------------------------------------------------------------------- */
// FIX (same assignment message arriving again and again): the "already
// notified" memory used for auto-generated tasks lived only in a React ref,
// so it was wiped on every page visit / reload / remount and the very same
// task was messaged to the assignee all over again each time. It is now
// persisted in localStorage so one real event = one message.
const NOTIFIED_AUTO_KEYS_STORAGE = "taskspage_notified_auto_keys_v1";
function loadNotifiedAutoKeys() {
  try {
    const raw = localStorage.getItem(NOTIFIED_AUTO_KEYS_STORAGE);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
function saveNotifiedAutoKeys(set) {
  try {
    localStorage.setItem(NOTIFIED_AUTO_KEYS_STORAGE, JSON.stringify(Array.from(set).slice(-1000)));
  } catch {
    /* storage full / blocked — in-memory set still protects this session */
  }
}

function todayDateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// FIX (assignment messages went to a local-only mock conversation store
// that the real Messages page never reads from — see messagesApi.js /
// MessagingSocketContext.jsx, which are what MessagesPage.jsx actually
// talks to): every notifyX function below now sends a REAL message
// through the same backend endpoint the Messages composer itself uses
// (POST /api/messages/send/), so it actually shows up for the recipient.
// `setConversations` is still accepted by every function below (existing
// call sites all still pass it) but is no longer used for the message
// itself — kept only so none of those call sites need to change.

// A sample/reference file attached to a task is stored as a data: URL
// (see SampleFilesField), not a real uploaded File — but the backend's
// /send/ endpoint needs an actual file to upload as an attachment. This
// turns that data: URL back into a File the same fetch()/Blob trick
// works for any data: URL, so the reference file still shows up as a
// real, downloadable message instead of silently being dropped.
async function dataUrlToFile(url, filename) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return new File([blob], filename || "file", { type: blob.type || "application/octet-stream" });
  } catch (err) {
    console.error("Could not attach file to message:", filename, err);
    return null;
  }
}

async function sendFileMessages(recipientId, files) {
  for (const f of files) {
    const file = await dataUrlToFile(f.url, f.name);
    if (file) {
      try {
        await apiSendMessage({ recipientId, attachment: file });
      } catch (err) {
        console.error("Could not send attachment message:", err);
      }
    }
  }
}

function notifyAssigneesOfTask(names, task, approvedUsers, setConversations) {
  notifyAssigneesOfTaskBatch(names, [task], approvedUsers, setConversations);
}

// FIX (role-template Create Task -> Messages): when Create Task generates
// several module tasks at once (Graphic Designer -> Concept & Moodboard,
// Design Drafts, ...), the assignee should get ONE assignment message
// listing every module — not one separate message per module. This is
// the shared implementation; notifyAssigneesOfTask above just wraps a
// single task in a 1-item array for every existing call site.
async function notifyAssigneesOfTaskBatch(names, tasks, approvedUsers, setConversations) {
  if (!names || names.length === 0 || !tasks || tasks.length === 0) return;

  const idByName = new Map(
    (approvedUsers || []).filter((u) => u.name).map((u) => [u.name.trim().toLowerCase(), u.id])
  );
  const targetIds = names.map((n) => idByName.get((n || "").trim().toLowerCase())).filter(Boolean);
  if (targetIds.length === 0) return;

  const first = tasks[0];
  const dueLabel = first.dueDate ? formatDate(first.dueDate) : "no due date set";
  // Sample/reference images and/or a brief PDF the admin attached on
  // Create Task ride along right after the assignment message, so
  // whoever the task is assigned to sees them straight in Messages
  // instead of only inside the Tasks page.
  const sampleFiles = Array.isArray(first.sampleFiles) ? first.sampleFiles : [];
  // A single module task created via `fromClientModule` (acceptModuleRequest
  // on ClientsPage appending one new module onto an already-existing
  // project) is exactly the "client asked for the next module, go start
  // it" case — worded distinctly from the generic "new task assigned"
  // text so the manager understands why this landed in Messages and
  // that it's ready to be picked up right now.
  const isSingleModuleKickoff = tasks.length === 1 && first.fromClientModule && first.clientName;
  // FIX (duplicate/placeholder message): the auto "New client assigned: X"
  // system task used to be worded as `New task assigned: "New client assigned: X"`
  // — a task title wrapped inside another "task assigned" sentence, with no
  // real details. It now reads as a proper client-assignment message with
  // the real client name, project, priority and due date. Every other task
  // message also carries the client's name whenever the task belongs to one.
  const isClientAssignment = tasks.length === 1 && first.fromClientAssignment;
  const clientLabel = first.clientName ? ` • Client: ${first.clientName}` : "";
  const text =
    tasks.length > 1
      ? `📋 New task assigned: "${first.moduleProjectName || first.project}" — Project: ${first.project}${clientLabel} • Priority: ${first.priority} • Due: ${dueLabel}\n🧩 ${tasks.length} modules: ${tasks.map((t) => t.title).join(", ")}`
      : isClientAssignment
      ? `👤 New client assigned: "${first.clientName || first.project}" — Project: ${first.project} • Priority: ${first.priority} • Due: ${dueLabel}\nPlease review the scope and kick off onboarding.`
      : isSingleModuleKickoff
      ? `🚀 "${first.title}" is ready to start — client "${first.clientName}" requested it for "${first.project}". Priority: ${first.priority} • Due: ${dueLabel}\nPlease begin this next.`
      : `📋 New task assigned: "${first.title}" — Project: ${first.project}${clientLabel} • Priority: ${first.priority} • Due: ${dueLabel}`;
  const fullText = text + (sampleFiles.length ? `\n📎 ${sampleFiles.length} reference file${sampleFiles.length === 1 ? "" : "s"} attached below.` : "");

  for (const recipientId of targetIds) {
    try {
      await apiSendMessage({ recipientId, text: fullText });
      await sendFileMessages(recipientId, sampleFiles);
    } catch (err) {
      console.error("Could not send task-assignment message:", err);
    }
  }
}

/* ----------------------------------------------------------------------
   TASK COMPLETION -> MESSAGES (employee -> admin)

   Notifies whoever created the task (task.createdBy, resolved to a real
   user the same name-matching way assignees are above) if that resolves
   to a real approved user; otherwise falls back to every admin, so a
   completion never just silently goes nowhere.
---------------------------------------------------------------------- */
async function notifyAdminOfTaskCompletion(task, link, newAttachments, currentUser, approvedUsers, setConversations) {
  if (!currentUser?.id) return;

  const idByName = new Map(
    (approvedUsers || []).filter((u) => u.name).map((u) => [u.name.trim().toLowerCase(), u.id])
  );
  const creatorId = idByName.get((task?.createdBy || "").trim().toLowerCase());
  // BUG 4 FIX: the createdBy field may resolve to a manager or other staff
  // user who is NOT in the sender's allowed contacts (messaging/permissions.py
  // only allows employee→admin + their own manager). If we ONLY send to the
  // resolved creatorId and they are not an admin, the POST 403s. Fix: always
  // include ALL admin users plus the resolved creator, deduplicated — admins
  // are always reachable by any staff user per get_allowed_contacts(), so the
  // admin path never 403s regardless of who is doing the completing.
  const adminIds = (approvedUsers || []).filter((u) => u.role === "admin").map((u) => u.id);
  const targetIdSet = new Set([...adminIds, ...(creatorId ? [creatorId] : [])]);
  const targetIds = Array.from(targetIdSet);
  if (targetIds.length === 0) return;

  const atts = Array.isArray(newAttachments) ? newAttachments : [];
  // Real files (image/video/zip/pdf/etc) become their own viewable/
  // downloadable message bubbles; a plain pasted link isn't a file to
  // download, so it's called out in the text instead — same distinction
  // TaskAttachmentsSection already draws (Open ↗ vs Download).
  const fileAtts = atts.filter((a) => a.type !== "link");
  const linkUrl = atts.find((a) => a.type === "link")?.url || (link && isUrl(link) ? link : "");

  let text = `✅ ${currentUser.name || "Someone"} marked "${task.title}" as completed — Project: ${task.project || "—"}.`;
  if (fileAtts.length) text += `\n📎 ${fileAtts.length} file${fileAtts.length === 1 ? "" : "s"} attached below.`;
  if (linkUrl) text += `\n🔗 Submitted work: ${linkUrl}`;

  for (const recipientId of targetIds) {
    try {
      await apiSendMessage({ recipientId, text });
      await sendFileMessages(recipientId, fileAtts);
    } catch (err) {
      console.error("Could not send task-completion message:", err);
    }
  }
}

/* ----------------------------------------------------------------------
   TASK DELETION -> MESSAGES
---------------------------------------------------------------------- */
async function notifyAssigneesOfTaskDeletion(names, task, approvedUsers, setConversations) {
  if (!task || !names || names.length === 0) return;

  const idByName = new Map(
    (approvedUsers || []).filter((u) => u.name).map((u) => [u.name.trim().toLowerCase(), u.id])
  );
  const targetIds = names.map((n) => idByName.get((n || "").trim().toLowerCase())).filter(Boolean);
  if (targetIds.length === 0) return;

  const text = `🗑️ Task deactivated: "${task.title}" — Project: ${task.project || "—"}.`;

  for (const recipientId of targetIds) {
    apiSendMessage({ recipientId, text }).catch((err) => console.error("Could not send task-deletion message:", err));
  }
}

/* ----------------------------------------------------------------------
   WHOLE-PROJECT (GROUP) DELETION -> MESSAGES
---------------------------------------------------------------------- */
async function notifyAssigneesOfProjectDeletion(tasks, approvedUsers, setConversations) {
  if (!tasks || tasks.length === 0) return;

  const idByName = new Map(
    (approvedUsers || []).filter((u) => u.name).map((u) => [u.name.trim().toLowerCase(), u.id])
  );

  const modulesByKey = new Map();
  tasks.forEach((t) => {
    getAssignees(t).forEach((n) => {
      const key = (n || "").trim().toLowerCase();
      if (!key) return;
      if (!modulesByKey.has(key)) modulesByKey.set(key, []);
      modulesByKey.get(key).push(t);
    });
  });
  if (modulesByKey.size === 0) return;

  const project = tasks[0].project || "—";

  for (const [key, myTasks] of modulesByKey.entries()) {
    const recipientId = idByName.get(key);
    if (!recipientId) continue;
    const text =
      myTasks.length > 1
        ? `🗑️ Project deactivated: "${project}" — ${myTasks.length} modules removed: ${myTasks.map((t) => t.title).join(", ")}.`
        : `🗑️ Task deactivated: "${myTasks[0].title}" — Project: ${project}.`;
    apiSendMessage({ recipientId, text }).catch((err) => console.error("Could not send project-deletion message:", err));
  }
}


/* ----------------------------------------------------------------------
   PERSISTENCE

   Tasks are saved to localStorage the same way EmployeesPage already
   saves its employees list, so creating/editing/completing/deleting a
   task — and the "pending approval" attachment on a task — all survive
   navigating away from this page or refreshing the browser instead of
   resetting back to the seed data.

   Whenever the tasks list changes, we also recompute each assignee's
   *active* (non-completed) task count and write it straight into the
   EmployeesPage's own localStorage record. EmployeesPage reads that same
   key on mount, so a task assigned here shows up under that employee's
   "Tasks" / active-tasks count as soon as you open the Employees page.
---------------------------------------------------------------------- */

const TASKS_STORAGE_KEY = "taskspage_tasks_v1";
/* FIX (same client assigned once on the Clients page but showing up as
   3-4 identical tasks here, each with its own duplicate message):
   the client-link fields below (clientId / moduleTaskKey / ...) are what
   BOTH sync functions use to decide "this client/module already has a
   task, skip it". They only ever existed in this page's own React state
   though — sanitizeTaskForBackend strips most of them before POSTing, and
   the backend serializer doesn't know about the rest (moduleTaskKey,
   moduleProjectName, fromClientModule, ...), so every row that comes back
   from the API has them missing. Since both the create round-trip and the
   initial GET /tasks/ used to overwrite the local task with that
   stripped-down row wholesale, the link was lost the moment it was saved
   — the very next sync pass saw the client as "not linked yet" and
   created (and persisted, and notified) another copy, over and over.
   Keeping a small id -> link-metadata map on the side and re-attaching it
   after every backend round-trip is what makes the de-dupe checks
   actually hold across saves and reloads. */
const TASK_LINK_META_STORAGE_KEY = "taskspage_task_link_meta_v1";
const TASK_LINK_META_FIELDS = [
  "clientId",
  "clientName",
  "moduleTaskKey",
  "moduleProjectName",
  "moduleName",
  "moduleId",
  "subModuleId",
  "requiresLink",
  "fromClientModule",
  "fromClientAssignment",
];

function readTaskLinkMeta() {
  try {
    const raw = localStorage.getItem(TASK_LINK_META_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeTaskLinkMeta(map) {
  try {
    localStorage.setItem(TASK_LINK_META_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota/private-mode — the in-memory copy still works for this session */
  }
}

function pickTaskLinkMeta(task) {
  const meta = {};
  TASK_LINK_META_FIELDS.forEach((f) => {
    if (task && task[f] !== undefined && task[f] !== null && task[f] !== "") meta[f] = task[f];
  });
  return meta;
}

// Remembers the client-link fields of every task that has any, keyed by
// task id, so they can be put back after the backend hands the row back
// without them.
function rememberTaskLinkMeta(tasks) {
  const map = readTaskLinkMeta();
  let changed = false;
  (tasks || []).forEach((t) => {
    if (!t || t.id == null) return;
    const meta = pickTaskLinkMeta(t);
    if (!meta.moduleTaskKey && !meta.fromClientAssignment && meta.clientId == null) return;
    const key = String(t.id);
    const prev = map[key];
    const next = { ...(prev || {}), ...meta };
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) {
      map[key] = next;
      changed = true;
    }
  });
  if (changed) writeTaskLinkMeta(map);
}

// The other half: re-attaches whatever the backend dropped. Only fills in
// fields the incoming row doesn't already carry, so real server data
// always wins over the cached copy.
function hydrateTaskLinkMeta(list) {
  const map = readTaskLinkMeta();
  return (list || []).map((t) => {
    const meta = map[String(t?.id)];
    if (!meta) return t;
    const merged = { ...t };
    TASK_LINK_META_FIELDS.forEach((f) => {
      if (merged[f] === undefined || merged[f] === null || merged[f] === "") {
        if (meta[f] !== undefined) merged[f] = meta[f];
      }
    });
    return merged;
  });
}

// Used when a locally-created task gets its real backend id: the saved row
// keeps the server's id/fields, but every client-link field is carried
// over from the local copy, and the metadata map is re-keyed to the new id
// so the link survives the next reload too.
function mergeSavedTask(local, saved) {
  if (!saved) return local;
  const merged = { ...local, ...saved };
  TASK_LINK_META_FIELDS.forEach((f) => {
    if (saved[f] === undefined || saved[f] === null || saved[f] === "") {
      if (local[f] !== undefined) merged[f] = local[f];
    }
  });
  if (saved.id != null && local.id != null && String(saved.id) !== String(local.id)) {
    const map = readTaskLinkMeta();
    delete map[String(local.id)];
    const meta = pickTaskLinkMeta(merged);
    if (meta.moduleTaskKey || meta.fromClientAssignment || meta.clientId != null) map[String(saved.id)] = meta;
    writeTaskLinkMeta(map);
  }
  return merged;
}

// Fallback identity for an auto-generated task, used only when the proper
// link fields are missing (old rows saved before the metadata map above
// existed). A module task is uniquely "this module, in this project, for
// this client", which its project + title already spell out.
function autoTaskFallbackKey(task) {
  if (!task) return "";
  return `${(task.project || "").trim().toLowerCase()}::${(task.title || "").trim().toLowerCase()}`;
}

// One-time cleanup for the copies the old behaviour already created and
// saved: returns the ids of every EXTRA auto-generated task that points at
// the same client/module as one that's already kept. The copy carrying the
// most real work (completed, attachments) is the one that survives, so
// nobody loses a screenshot or a finished module to the cleanup.
function findDuplicateAutoTaskIds(tasks) {
  const workScore = (t) =>
    (t.status === "Completed" ? 4 : 0) +
    ((t.attachments || []).length ? 2 : 0) +
    (t.attachment ? 1 : 0) +
    ((t.subtasks || []).some((s) => s.done) ? 1 : 0);
  const kept = new Map();
  const removeIds = [];
  (tasks || []).forEach((t) => {
    if (!t || t.id == null) return;
    const isAuto =
      !!t.moduleTaskKey ||
      !!t.fromClientModule ||
      !!t.fromClientAssignment ||
      (t.createdBy === "System" && (t.clientId != null || /^New client assigned: /i.test(t.title || "")));
    if (!isAuto) return;
    const key = t.moduleTaskKey || autoTaskFallbackKey(t);
    if (!key) return;
    const prev = kept.get(key);
    if (!prev) {
      kept.set(key, t);
      return;
    }
    const winner = workScore(t) > workScore(prev) ? t : prev;
    kept.set(key, winner);
    removeIds.push((winner === t ? prev : t).id);
  });

  // Second sweep: drop the old standalone "New client assigned: X" rows
  // for any client whose real project modules already exist as tasks (see
  // the matching guard in syncClientAssignmentTasks). That row is what
  // made a single client assignment look like it happened two or three
  // times — one phantom project group named after the client, sitting
  // beside the client's actual project.
  const clientsWithModuleWork = new Set();
  (tasks || []).forEach((t) => {
    if (!t || !(t.moduleTaskKey || t.fromClientModule)) return;
    if (t.clientId != null) clientsWithModuleWork.add(`id::${t.clientId}`);
    if (t.clientName) clientsWithModuleWork.add(`name::${t.clientName.trim().toLowerCase()}`);
  });
  (tasks || []).forEach((t) => {
    if (!t || t.id == null || removeIds.includes(t.id)) return;
    const match = /^New client assigned:\s*(.+)$/i.exec((t.title || "").trim());
    const isAssignmentTask = !!t.fromClientAssignment || !!match;
    if (!isAssignmentTask || t.moduleTaskKey) return;
    // Never touch one somebody has actually worked on.
    if (workScore(t) > 0) return;
    const byId = t.clientId != null && clientsWithModuleWork.has(`id::${t.clientId}`);
    const nameFromTitle = match ? match[1].trim().toLowerCase() : "";
    const byName =
      (t.clientName && clientsWithModuleWork.has(`name::${t.clientName.trim().toLowerCase()}`)) ||
      (nameFromTitle && clientsWithModuleWork.has(`name::${nameFromTitle}`));
    if (byId || byName) removeIds.push(t.id);
  });

  return removeIds;
}
const EMPLOYEES_STORAGE_KEY = "employeespage_employees_v1";
const PROJECTS_STORAGE_KEY = "hopenix_projects_v1";
const LEGACY_PROJECTS_STORAGE_KEY = "taskspage_projects_v1";
// NEW: final packaged zip deliverable(s) per project (keyed the same way
// `groupedRows` keys a project — clientId + project name — so two
// different clients' identically-named projects never share a deliverable).
const DELIVERABLES_STORAGE_KEY = "taskspage_deliverables_v1";

function loadDeliverablesFromStorage() {
  try {
    const raw = localStorage.getItem(DELIVERABLES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveDeliverablesToStorage(map) {
  try {
    localStorage.setItem(DELIVERABLES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — deliverable still works in-memory for this session
  }
}

/* FIX (blank-screen crash on Create/Edit Task): `projects` must always be
   a plain array of name strings — every <option>, projectIconStyle(), and
   comparison in this file assumes that. If localStorage ever ends up
   holding full project objects instead (e.g. leftover/corrupted data, or
   another page writing richer records under the same key), rendering
   `<option key={p}>{p}</option>` with an object crashes the whole page.
   This normalizes anything read from storage down to clean, deduped
   name strings, so bad data can never reach the UI. */
function normalizeProjectList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  list.forEach((item) => {
    const name = typeof item === "string" ? item : item && typeof item === "object" ? item.name : null;
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  });
  return out;
}

/* FIX (newly added default projects invisible to existing users): once a
   person has ever saved a projects list, loadProjectsFromStorage used to
   return THAT stored list verbatim forever — any project later added to
   DEFAULT_PROJECTS (e.g. "Graphic Design", "Video Editing") would only
   ever show up for a brand-new/reset browser, never for someone who
   already had a projects list saved. Any fallback entry not already
   present (case-insensitively) is appended here, so new built-in
   projects reach everyone on their next load — a person's own existing
   projects, and their order, are left untouched. */
function mergeWithDefaultProjects(stored, fallback) {
  if (!Array.isArray(fallback) || fallback.length === 0) return stored;
  const seen = new Set(stored.map((p) => p.toLowerCase()));
  const merged = [...stored];
  fallback.forEach((p) => {
    const key = (p || "").trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(p.trim());
    }
  });
  return merged;
}

function loadProjectsFromStorage(fallback) {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (raw) {
      const normalized = normalizeProjectList(JSON.parse(raw));
      if (normalized.length) return mergeWithDefaultProjects(normalized, fallback);
    }
    const legacyRaw = localStorage.getItem(LEGACY_PROJECTS_STORAGE_KEY);
    if (legacyRaw) {
      const normalizedLegacy = normalizeProjectList(JSON.parse(legacyRaw));
      if (normalizedLegacy.length) {
        try {
          localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(normalizedLegacy));
        } catch {
          // ignore
        }
        return mergeWithDefaultProjects(normalizedLegacy, fallback);
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function saveProjectsToStorage(list) {
  try {
    // Normalize on the way OUT too — so even if some future code path
    // ever pushes a bad value into `projects` state, it never gets
    // persisted to localStorage and the corruption can't survive a reload.
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(normalizeProjectList(list)));
    window.dispatchEvent(new Event("hopenix:projects-changed"));
  } catch {
    // storage unavailable — new project still works in-memory for this session
  }
}

function loadTasksFromStorage(fallback) {
  try {
    const raw = localStorage.getItem(TASKS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function saveTasksToStorage(tasks) {
  try {
    localStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks));
  } catch {
    // storage unavailable (e.g. private browsing) — state still works in-memory for this session
  }
}

/* One-time cleanup for data saved by an older, buggy build: back then
   `nextId()` restarted from 1000 on every reload, so a freshly created
   task could end up with the exact same `id` as an already-saved older
   task. Two rows sharing an id meant ticking either row's checkbox
   (which matches purely by t.id) visually ticked both. This walks the
   loaded list once, keeps the first task that owns an id, and hands any
   later duplicate a brand-new unique id — so old, already-corrupted
   localStorage data gets repaired automatically the next time this page
   loads, on top of new tasks never colliding in the first place. */
function dedupeTaskIds(tasks) {
  const seenIds = new Set();
  let maxId = tasks.reduce((m, t) => Math.max(m, t.id), 1000);
  let changed = false;
  const result = tasks.map((t) => {
    if (seenIds.has(t.id)) {
      maxId += 1;
      seenIds.add(maxId);
      changed = true;
      return { ...t, id: maxId };
    }
    seenIds.add(t.id);
    return t;
  });
  return { result, changed };
}

/* One-time cleanup for browsers that already had the old fake demo
   data (Sara Khan / Usman Ali / Hina Fatima / Zain Ali / Ayesha Noor)
   saved into localStorage from before this fix — switching the initial
   fallback to [] only stops NEW/empty storage from picking up fake
   data, it does nothing for storage that already has it written in.
   This matches each loaded task against the exact title+project+assignee
   combo of the old hardcoded demo tasks and drops only those, leaving
   every real task (including anything a real person happens to be
   named the same as, unless title+project also match exactly) alone. */
const FAKE_DEMO_TASK_SIGNATURES = new Set([
  "Design landing page UI|E-Commerce Website|Sara Khan",
  "Develop authentication module|Mobile Banking App|Usman Ali",
  "Dashboard analytics design|CRM System|Hina Fatima",
  "API documentation|CRM System|Zain Ali",
  "Fix UI responsiveness issue|E-Commerce Website|Zain Ali",
  "Payment gateway integration|E-Commerce Website|Ayesha Noor",
  "Create database schema|Mobile Banking App|Usman Ali",
  "User permissions module|CRM System|Zain Ali",
  "Bug fixes and optimization|Mobile Banking App|Hina Fatima",
  "Email notifications setup|CRM System|Ayesha Noor",
]);
function stripFakeDemoTasks(tasks) {
  let changed = false;
  const result = tasks.filter((t) => {
    const signature = `${t.title}|${t.project}|${getAssignees(t)[0] || ""}`;
    if (FAKE_DEMO_TASK_SIGNATURES.has(signature)) {
      changed = true;
      return false;
    }
    return true;
  });
  return { result, changed };
}

function syncEmployeeTaskCounts(tasks) {
  try {
    const raw = localStorage.getItem(EMPLOYEES_STORAGE_KEY);
    if (!raw) return;
    const employees = JSON.parse(raw);
    if (!Array.isArray(employees)) return;

    const activeCountByName = {};
    tasks.forEach((t) => {
      const isActive = t.status !== "Completed";
      if (isActive) {
        getAssignees(t).forEach((name) => {
          activeCountByName[name] = (activeCountByName[name] || 0) + 1;
        });
      }
    });

    const updated = employees.map((e) =>
      e.name in activeCountByName || tasks.some((t) => getAssignees(t).includes(e.name))
        ? { ...e, tasks: activeCountByName[e.name] || 0 }
        : e
    );
    localStorage.setItem(EMPLOYEES_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // storage unavailable — Employees page will just show its own last-known counts
  }
}

/* ----------------------------------------------------------------------
   CLIENT -> TASK ASSIGNMENT SYNC

   Reads the exact same localStorage record ClientsPage saves to
   (`clientspage_clients_v1`). Whenever a client there has a manager
   assigned, that manager gets one linked task here — matched by
   `clientId` (not name), so renaming a client never creates a
   duplicate. If a client's manager changes later, the already-linked
   task's assignee is moved over instead of leaving a stale task on the
   old manager, and if a client is later removed, its task is just left
   alone (history isn't deleted out from under anyone).
---------------------------------------------------------------------- */
const CLIENTS_STORAGE_KEY = "clientspage_clients_v1";

// FIX (module tasks/manager notifications lagging after an accept on
// Clients page): the native "storage" event only ever fires in a
// DIFFERENT browser tab than the one that wrote the change — never this
// one — so accepting a "new module" request on ClientsPage.jsx never
// reached this page's sync effect until a manual focus/refresh, even
// though both live in the same running app. ClientPortal.jsx already
// dispatches this same plain window CustomEvent after every write it
// makes; this page now dispatches it too after its own writes, and
// listens for it, so an accepted request's module task (and the
// manager's notification) shows up here immediately instead of on the
// next tab switch.
const CLIENTS_DATA_EVENT = "clientsdata:updated";

// FIX (completed zips missing from Zip Files page for single-person /
// non-client tasks): this must exactly match ProjectsPage.jsx's own
// STORAGE_KEY (and, in turn, ZipFilesPage.jsx's PROJECTS_STORAGE_KEY) —
// it's the single source of truth the admin "Zip Files" page reads from,
// pulling out whichever project objects have a `completedZip` attached.
// See syncZipToZipFilesStorage below.
const ZIP_FILES_PROJECTS_STORAGE_KEY = "hopenix_projects_data_v1";

// FIX (locking never showed up on Tasks for already-existing projects):
// same backfill ClientsPage.jsx's ensureProjectModules does — a project
// saved before the lock feature existed has modules with no `unlocked`
// field at all. moduleLeaves() already treats missing `unlocked` as
// "unlocked" (so nothing already in progress retroactively locks), but
// that also means those older projects would never show ANY lock unless
// something actually assigns the field. This runs independently of
// whether ClientsPage.jsx has even been opened this session, so Tasks
// page reflects locking correctly on its own straight from
// clientspage_clients_v1, not only after a visit to Clients backfills it
// first.
function backfillModuleLocks(modules) {
  let unlockedAssigned = false;
  return (modules || []).map((m) => {
    if (m.subModules && m.subModules.length) return m; // sub-tasks are never lock-gated
    if (m.done) return m; // a completed module doesn't hold the "next unlocked" slot
    if (m.unlocked !== undefined) {
      if (m.unlocked) unlockedAssigned = true;
      return m;
    }
    if (!unlockedAssigned) {
      unlockedAssigned = true;
      return { ...m, unlocked: true };
    }
    return { ...m, unlocked: false };
  });
}

function loadClientsForTaskSync() {
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c) => ({
      ...c,
      projects: (c.projects || []).map((p) => ({ ...p, modules: backfillModuleLocks(p.modules) })),
    }));
  } catch {
    return [];
  }
}

function syncClientAssignmentTasks(tasks, clients, approvedUsers) {
  const linkedClientIds = new Set(tasks.filter((t) => t.clientId).map((t) => t.clientId));
  // Second, name-based safety net for rows whose clientId didn't survive a
  // backend round-trip made before the link-metadata map existed (see
  // TASK_LINK_META_STORAGE_KEY) — without it those older tasks read as
  // "not linked" forever and this client gets a fresh duplicate on every
  // single sync pass.
  const existingTitles = new Set(tasks.map((t) => (t.title || "").trim().toLowerCase()));
  let maxId = tasks.reduce((max, t) => Math.max(max, t.id), 1000);
  const createdTasks = [];
  let anyReassigned = false;

  const reassignedTasks = tasks.map((t) => {
    if (!t.clientId) return t;
    const client = clients.find((c) => c.id === t.clientId);
    if (!client || !client.manager?.name) return t;
    // FIX (real employees only): resolve against the real approved-users
    // list before ever writing this name onto a task's assignee, so a
    // fabricated/placeholder manager name from Clients-page data can never
    // show up here as if they were a real registered teammate.
    const realName = resolveRealAssignee(client.manager.name, approvedUsers);
    const current = getAssignees(t);
    if (current.length === 1 && current[0] === realName) return t;
    anyReassigned = true;
    return { ...t, assignees: [realName], assignee: undefined, assigneeRole: realName === "Unassigned" ? "" : client.manager.role || "" };
  });

  clients.forEach((c) => {
    if (!c.manager?.name || linkedClientIds.has(c.id)) return;
    // FIX ("ek client assign karne par 3 dafa assign hota hai"): every
    // project module of this client ALREADY becomes its own real task via
    // syncClientModuleTasks, assigned to this very same manager and
    // notified to them. Adding a separate "New client assigned: X" task on
    // top of that meant one assignment produced two separate rows — and
    // because that task's `project` is the CLIENT's name, it showed up in
    // the grouped list as a second, phantom project sitting right next to
    // the client's real one, with its own duplicate message to the
    // manager. The standalone task is now only created for a client who
    // has no module work at all yet (no projects, or projects with an
    // empty checklist), so there's still something telling the manager to
    // start onboarding — and it disappears on its own the moment real
    // modules exist (see the cleanup in cleanupDuplicateAutoTasks).
    const hasModuleWork = (c.projects || []).some((p) => moduleLeaves(p).length > 0);
    if (hasModuleWork) return;
    const title = `New client assigned: ${c.name}`;
    if (existingTitles.has(title.trim().toLowerCase())) return;
    maxId += 1;
    existingTitles.add(title.trim().toLowerCase());
    linkedClientIds.add(c.id);
    const realName = resolveRealAssignee(c.manager.name, approvedUsers);
    createdTasks.push({
      id: maxId,
      title,
      description: `${realName} has been assigned as manager for client "${c.name}". Review scope and kick off onboarding.`,
      project: c.name,
      assignees: [realName],
      assigneeRole: realName === "Unassigned" ? "" : c.manager.role || "",
      priority: "Medium",
      dueDate: isoDaysFromNow(7),
      status: "Pending",
      createdBy: "System",
      createdOn: new Date().toISOString().slice(0, 10),
      attachment: "",
      requirements: "",
      subtasks: [],
      clientId: c.id,
      clientName: c.name,
      fromClientAssignment: true,
    });
  });

  if (createdTasks.length === 0 && !anyReassigned) return null;
  return { tasks: [...createdTasks, ...reassignedTasks], createdTasks };
}

/* Seed tasks — demo content shaped like the reference design. Assignees
   here are just display names; once real approved users exist in
   AuthContext, new tasks are assigned from that real list instead. */
/* ----------------------------------------------------------------------
   CLIENT MODULE <-> TASK ENGINE

   Every module/sub-task in a client's project checklist (Planning,
   Frontend, Backend, Database, API Integration, Testing, Deployment,
   ...) gets its own real task here, assigned to whichever manager or
   developer is picked for that client on the Clients page. Ticking that
   task complete (or just uploading a screenshot/video/link to it) writes
   straight back into the exact same `clientspage_clients_v1` record
   ClientsPage and the Client Portal read from, recomputing the module's
   `done` flag / project progress the same way ClientsPage itself does —
   so a checkbox ticked here shows up there (and vice versa) without any
   extra wiring.

   Each generated task is matched to its module by a stable
   `moduleTaskKey` (client id + project name + module id + sub-module id)
   rather than by name/title, so renaming a project or a module never
   creates a duplicate or orphans an existing task.
---------------------------------------------------------------------- */

// Kept in sync with ClientsPage.jsx's own LINK_REQUIRED_MODULES — a
// module task can't be marked complete without a real URL attached for
// exactly these three.
const LINK_REQUIRED_MODULES = ["Frontend", "Backend", "Deployment"];

/* ----------------------------------------------------------------------
   ROLE-BASED TASK TEMPLATES (Create Task)

   FIX (only web-dev-shaped module tasks existed): before this, the only
   way to get a project broken down into separate module tasks — each
   with its own row, its own progress, and its own Task Details panel —
   was through a client's Web Development project (Planning, Frontend,
   Backend, ...). A company also runs Graphic Design, Video Editing,
   Content Writing, and UI/UX work the same way, so Create Task can now
   generate the equivalent module breakdown for those roles too, using
   the exact same "one task per module, grouped by project" pattern
   syncClientModuleTasks already uses (see `moduleName`/requiresLink
   below) — that's what makes them show up correctly in the "All Tasks"
   grouped view with a modules count + progress bar, no other change
   needed. "Custom" keeps the old single-task behavior.

   The "Graphic Designer" module names intentionally match ClientsPage's
   own Graphic Design project-type modules (Concept & Moodboard, Design
   Drafts, Client Revisions, Final Artwork) so the two stay consistent.
---------------------------------------------------------------------- */
const ROLE_TASK_TEMPLATES = {
  "Graphic Designer": ["Concept & Moodboard", "Design Drafts", "Client Revisions", "Final Artwork"],
  "Video Editor": ["Script & Footage Review", "Rough Cut Edit", "Color Grading & Sound", "Final Export & Delivery"],
  "Web Developer": ["Planning", "Frontend", "Backend", "Database", "API Integration", "Testing", "Deployment"],
  "Content Writer": ["Research & Outline", "Draft Writing", "Proofreading & SEO", "Final Submission"],
  "UI/UX Designer": ["Wireframes", "Mockups & UI Design", "Prototype", "Design Handoff"],
};
const ROLE_TEMPLATE_NAMES = Object.keys(ROLE_TASK_TEMPLATES);

/* ----------------------------------------------------------------------
   PER-SUB-TASK ATTACHMENT RULES

   Every checklist item inside a task (UI/UX Design, Frontend, Backend,
   API Integration, Testing, Deployment, ...) can now take its OWN proof
   of work — not just one attachment for the whole task — and what kind
   of proof makes sense differs per item: a design step only needs a
   screenshot, a deployed step only needs a live URL. Matched by the
   sub-task's text, case-insensitively, so this applies whether the
   sub-task came from hand-typed text or a client's module checklist.
   Anything that matches no rule below falls back to "either a link or a
   file", same as task-level attachments always have. (Function is
   defined here but only ever called from render time, so it's safe to
   reference ATTACHMENT_ACCEPT even though that const is declared further
   down this file.)
---------------------------------------------------------------------- */
const SUBTASK_ATTACHMENT_RULES = [
  {
    // FIX (graphic design projects): matches the "Graphic Design" project
    // type's own modules (Concept & Moodboard, Design Drafts, Client
    // Revisions, Final Artwork — see ClientsPage.jsx's PROJECT_TYPES). No
    // live URL makes sense for design work, so unlike Frontend/Backend/
    // Deployment this never requires a link — just the design files
    // themselves.
    match: /concept|moodboard|mood board|design draft|revision|final art|artwork|graphic/i,
    allowLink: false,
    allowFile: true,
    accept: "image/*,.cdr,.ai,.psd,.eps,.pdf,.zip,.rar,.7z",
    hint: "Attach design files — CorelDRAW (.cdr), AI, PSD, PDF, images, or a zipped folder.",
  },
  {
    match: /ui\/?ux|design/i,
    allowLink: false,
    allowFile: true,
    accept: "image/*,.zip,.rar,.7z",
    hint: "Attach a screenshot/mockup — image or a zipped design file.",
  },
  {
    match: /frontend/i,
    allowLink: true,
    allowFile: true,
    accept: "video/*,.zip,.rar,.7z",
    requiresLink: true,
    hint: "A live URL is required — a screen-recording video or a zipped build is optional on top.",
  },
  {
    match: /backend|api|deployment/i,
    allowLink: true,
    allowFile: true,
    accept: ".zip,.rar,.7z",
    requiresLink: true,
    hint: "A real URL/endpoint is required — a zipped code/deployment package is optional on top.",
  },
  {
    match: /\bdevelopment\b/i,
    allowLink: true,
    allowFile: true,
    accept: ".zip,.rar,.7z,image/*,video/*",
    hint: "Attach a zipped build/source, a screenshot or recording, or a link.",
  },
  {
    match: /test/i,
    allowLink: true,
    allowFile: true,
    accept: "image/*,video/*,.zip,.rar,.7z",
    hint: "Attach a test report, recording, zip, or a link.",
  },
];

function subtaskAttachmentRule(text) {
  const found = SUBTASK_ATTACHMENT_RULES.find((r) => r.match.test(text || ""));
  if (found) return found;
  return { match: null, allowLink: true, allowFile: true, accept: ATTACHMENT_ACCEPT, hint: "Attach a screenshot, video, zip, or link." };
}

// Mirrors ClientsPage.jsx's own moduleUnits/computeProgress exactly, so
// a progress % written back here always agrees with what ClientsPage
// itself would compute from the same modules array.
function moduleUnits(m) {
  if (m.subModules && m.subModules.length) {
    return { total: m.subModules.length, done: m.subModules.filter((s) => s.done).length };
  }
  return { total: 1, done: m.done ? 1 : 0 };
}

function computeModulesProgress(modules) {
  if (!modules || modules.length === 0) return 0;
  let total = 0;
  let done = 0;
  modules.forEach((m) => {
    const u = moduleUnits(m);
    total += u.total;
    done += u.done;
  });
  if (total === 0) return 0;
  return Math.round((done / total) * 100);
}

function moduleTaskKey(clientId, projectName, moduleId, subModuleId) {
  return `${clientId}::${projectName}::${moduleId}::${subModuleId || ""}`;
}

// Flattens a project's modules into leaf checklist items — a plain
// module is its own leaf, while a module broken into sub-tasks (e.g.
// "Development" -> Frontend/Backend/Database/API Integration) yields one
// leaf per sub-task instead of one for the parent, since the parent's
// own `done` flag is always just derived from its sub-tasks.
function moduleLeaves(project) {
  const leaves = [];
  (project.modules || []).forEach((m) => {
    if (m.subModules && m.subModules.length) {
      m.subModules.forEach((s) => {
        // Sub-tasks under a compound module (e.g. Development ->
        // Frontend/Backend/...) aren't individually request/accept-gated
        // like top-level modules are, so they're always unlocked.
        leaves.push({
          moduleId: m.id, subModuleId: s.id,
          // FIX: carry the real Postgres pks so task creation and
          // syncModuleStatusToClientsStorage can use them cross-browser.
          moduleBackendId: s.backendId ?? null,
          moduleProjectBackendId: project.backendId ?? null,
          name: s.name, done: s.done, attachments: s.attachments || [],
          parentName: m.name, kickoffPing: !!s.kickoffPing, unlocked: true,
        });
      });
    } else {
      leaves.push({
        moduleId: m.id, subModuleId: null,
        // FIX: carry the real Postgres pks.
        moduleBackendId: m.backendId ?? null,
        moduleProjectBackendId: project.backendId ?? null,
        name: m.name, done: m.done, attachments: m.attachments || [],
        parentName: null, kickoffPing: !!m.kickoffPing, unlocked: m.unlocked !== false,
      });
    }
  });
  return leaves;
}

function syncClientModuleTasks(tasks, clients, approvedUsers) {
  const existingKeys = new Set(tasks.filter((t) => t.moduleTaskKey).map((t) => t.moduleTaskKey));
  // Same name-based safety net as syncClientAssignmentTasks — catches a
  // module task whose moduleTaskKey was lost on an older backend save, so
  // it isn't re-created (and re-notified) as a duplicate every pass.
  const existingFallbackKeys = new Set(tasks.map((t) => autoTaskFallbackKey(t)).filter(Boolean));
  let maxId = tasks.reduce((max, t) => Math.max(max, t.id), 1000);
  const createdTasks = [];
  // FIX (accepted module request never messaged the manager): most
  // projects get every module (Planning, Frontend, Backend, ...) created
  // upfront by makeModules() at project creation, each already turned
  // into its own task + notified right then. So when a client later taps
  // "Request to start" on one of those SAME modules and staff Accepts it
  // on ClientsPage, that module already existed — acceptModuleRequest
  // had nothing new to add, Pass 2 below never saw a new moduleTaskKey,
  // and the manager was never told the client had just asked for it to
  // start. kickoffTasks collects exactly that case: an already-linked
  // task whose module got `kickoffPing: true` set by acceptModuleRequest,
  // so runClientModuleSync can send the "ready to start" message even
  // though no task was actually (re)created.
  const kickoffTasks = [];
  let anyChanged = false;

  // Pass 1: keep already-linked module tasks in sync with whatever's
  // currently true on the Clients side (assignee + done state), in case
  // the manager was reassigned or the module was ticked directly on the
  // Clients page rather than from here.
  const syncedTasks = tasks.map((t) => {
    if (!t.moduleTaskKey) return t;
    const client = clients.find((c) => c.id === t.clientId);
    if (!client) return t;
    const project = (client.projects || []).find((p) => p.name === t.moduleProjectName);
    if (!project) return t;
    const leaf = moduleLeaves(project).find(
      (l) => l.moduleId === t.moduleId && (l.subModuleId || null) === (t.subModuleId || null)
    );
    if (!leaf) return t;

    let next = t;
    // FIX (real employees only): same resolveRealAssignee guard as
    // syncClientAssignmentTasks — a client's manager field can still hold
    // an old placeholder/seed name that was never actually registered and
    // approved on this site, so it's checked against the real
    // approved-users list before ever landing on a task as its assignee.
    const realName = client.manager?.name ? resolveRealAssignee(client.manager.name, approvedUsers) : null;
    if (realName && getAssignees(t)[0] !== realName) {
      anyChanged = true;
      next = { ...next, assignees: [realName], assignee: undefined, assigneeRole: realName === "Unassigned" ? "" : client.manager.role || "" };
    }
    // Keep the client's display name in sync too — if the client is
    // renamed on the Clients page, every module task generated for them
    // should show the new name in its own Task Details panel instead of
    // whatever name existed at the moment the task was first created.
    if (client.name && next.clientName !== client.name) {
      anyChanged = true;
      next = { ...next, clientName: client.name };
    }
    // Only ever sync Clients->Tasks in the "now done" direction here —
    // ticking it complete on the Clients page should complete the task
    // too. The reverse (task completed here -> module ticked there) is
    // handled explicitly by markCompleted calling
    // syncModuleStatusToClientsStorage, not by this effect, so the two
    // never fight each other.
    if (leaf.done && next.status !== "Completed") {
      anyChanged = true;
      next = { ...next, status: "Completed", progress: 100 };
    }
    // Keep the task's locked state in sync with the module's unlocked
    // flag — flips to false the moment acceptModuleRequest sets
    // unlocked:true on the Clients side, same sync pass that sends the
    // kickoff message below.
    const isLocked = !leaf.unlocked && next.status !== "Completed";
    if (!!next.locked !== isLocked) {
      anyChanged = true;
      next = { ...next, locked: isLocked };
    }
    if (leaf.kickoffPing) {
      kickoffTasks.push(next);
    }
    return next;
  });

  // Pass 2: create any module task that doesn't exist yet. Every module
  // (UI/UX, Frontend, Backend, ...) always gets its own task here — even
  // before a manager has been assigned to the client — so it shows up in
  // the Tasks page sidebar right away, each with its own Task Details
  // panel (Requirements + Attachments: image/video/zip/URL). If a
  // manager gets assigned later, Pass 1 above reassigns it automatically.
  clients.forEach((c) => {
    (c.projects || []).forEach((p) => {
      moduleLeaves(p).forEach((leaf) => {
        const key = moduleTaskKey(c.id, p.name, leaf.moduleId, leaf.subModuleId);
        if (existingKeys.has(key)) return;
        const requiresLink = LINK_REQUIRED_MODULES.includes(leaf.name);
        const title = leaf.parentName ? `${leaf.parentName}: ${leaf.name}` : leaf.name;
        const fallbackKey = autoTaskFallbackKey({ project: p.name, title });
        if (existingFallbackKeys.has(fallbackKey)) return;
        maxId += 1;
        existingKeys.add(key);
        existingFallbackKeys.add(fallbackKey);
        const assigneeName = c.manager?.name ? resolveRealAssignee(c.manager.name, approvedUsers) : "Unassigned";
        createdTasks.push({
          id: maxId,
          title,
          description: `"${title}" module for project "${p.name}" — client ${c.name}.${
            requiresLink ? " A live link/URL is required before this can be marked complete." : ""
          }`,
          project: p.name,
          assignees: [assigneeName],
          assigneeRole: assigneeName === "Unassigned" ? "" : c.manager?.role || "",
          priority: "Medium",
          dueDate: isoDaysFromNow(14),
          status: leaf.done ? "Completed" : "Pending",
          createdBy: "System",
          createdOn: new Date().toISOString().slice(0, 10),
          attachment: "",
          attachments: [],
          requirements: "",
          subtasks: [],
          clientId: c.id,
          clientName: c.name,
          moduleProjectName: p.name,
          moduleName: leaf.name,
          moduleId: leaf.moduleId,
          subModuleId: leaf.subModuleId,
          // FIX: stamp the real backend Module pk and its project pk so that
          // (a) the backend PATCH sets Task.module FK on save, and
          // (b) syncModuleStatusToClientsStorage can call uploadModuleFile
          //     cross-browser without needing localStorage.
          moduleBackendId: leaf.moduleBackendId ?? null,
          moduleProjectBackendId: leaf.moduleProjectBackendId ?? null,
          moduleTaskKey: key,
          requiresLink,
          fromClientModule: true,
          // Locked until the client requests this module and staff
          // accepts that request (see makeModulesFromNames/
          // acceptModuleRequest in ClientsPage.jsx) — never locked for an
          // already-completed module.
          locked: !leaf.unlocked && !leaf.done,
        });
      });
    });
  });

  if (createdTasks.length === 0 && !anyChanged && kickoffTasks.length === 0) return null;
  return { tasks: [...createdTasks, ...syncedTasks], createdTasks, kickoffTasks };
}

// The Clients-side data these sync functions read from (loadClientsForTaskSync
// / `clientspage_clients_v1`) still carries its OLD local id scheme for
// any client created before the real backend Client model existed — a
// plain string like "c1", "c23", NOT the real numeric Postgres id. The
// backend's `clientId` field is a PrimaryKeyRelatedField (a real FK), so
// sending one of those old string ids as-is fails with "Incorrect type.
// Expected pk value, received str." Since Task.client is nullable, the
// safe move is to only ever send clientId when it's actually numeric —
// otherwise drop it and let the task save without that link rather than
// failing to save at all.
function sanitizeTaskForBackend(t) {
  // Strip local-only fields (clientName and createdOn are read-only on the
  // backend). moduleId / subModuleId / fromClientAssignment USED to be
  // stripped here too, but the backend now stores them (tasks migration
  // 0004), so they are sent along and survive a reload / another browser.
  // Keep moduleBackendId so the backend can stamp Task.module FK (the real
  // projects.Module pk).
  const { id, clientId, moduleId, subModuleId, fromClientAssignment, clientName, createdOn, moduleProjectBackendId, ...rest } = t;
  const out = { ...rest };
  // moduleId / subModuleId are text columns: send a string, or nothing.
  if (moduleId !== undefined && moduleId !== null && moduleId !== "") out.moduleId = String(moduleId);
  // "no sub-module" is null on the frontend; the backend stores that as "".
  if (subModuleId !== undefined && subModuleId !== null && subModuleId !== "") out.subModuleId = String(subModuleId);
  // The backend's BooleanField rejects null, so only send a real boolean.
  if (typeof fromClientAssignment === "boolean") out.fromClientAssignment = fromClientAssignment;
  const numericClientId = clientId != null && /^\d+$/.test(String(clientId)) ? Number(clientId) : null;
  return numericClientId != null ? { ...out, clientId: numericClientId } : out;
}

// FIX (auto-generated tasks vanished after reload / never showed up for
// anyone else): runClientAssignmentSync and runClientModuleSync below
// used to only ever setTasks(...) locally — the message to the assignee
// went out for real (notifyAssigneesOfTask hits the real backend), but
// the task ROW itself was never saved server-side. It looked fine in
// THIS browser tab until the next GET /tasks/ (reload, or another
// device/tab) silently replaced it with the real backend list, which
// never had it. This mirrors the exact persist step the manual
// Create-Task flow already does: save for real, then swap the
// locally-faked id for the real one so edit/delete/complete (all
// id-based) keep working against the row that's actually in Postgres.
function persistAutoCreatedTasks(createdList, setTasks, onSettled) {
  if (!createdList || createdList.length === 0) return;
  const persist =
    createdList.length > 1
      ? tasksApiFetch("/tasks/bulk-create/", {
          method: "POST",
          body: JSON.stringify({ tasks: createdList.map(sanitizeTaskForBackend) }),
        })
      : tasksApiFetch("/tasks/", {
          method: "POST",
          body: JSON.stringify(sanitizeTaskForBackend(createdList[0])),
        }).then((saved) => [saved]);

  persist
    .then((saved) => {
      // FIX (duplicates): this used to be `saved[idx]` outright, which
      // threw away clientId / moduleTaskKey / clientName — the exact
      // fields both syncs use to recognise an already-created task — so
      // the next pass happily created the same one again. mergeSavedTask
      // keeps the backend's real id and data while carrying those links
      // over (and re-keys the saved metadata to the new id).
      setTasks((list) =>
        list.map((t) => {
          const idx = createdList.findIndex((c) => c.id === t.id);
          return idx !== -1 && saved[idx] ? mergeSavedTask(t, saved[idx]) : t;
        })
      );
    })
    .catch((err) => {
      console.error("Could not save auto-generated task(s) to the backend:", err);
    })
    .finally(() => {
      if (onSettled) onSettled();
    });
}


// Writes a module task's completion/attachments into the same
// `clientspage_clients_v1` localStorage record ClientsPage and the
// Client Portal read from — and also fires real backend API calls so
// the data is persisted cross-browser (no localStorage dependency
// for the authoritative file storage path).
function syncModuleStatusToClientsStorage(task, { done, newAttachments } = {}) {
  if (!task.clientId || !task.moduleTaskKey) return;

  // PRIMARY PATH (cross-browser): if the task already carries its real
  // backend Module and Project pks, call the backend directly without
  // going through localStorage at all. This is what makes attachments
  // visible in ClientPortal from a different browser/device.
  const directModuleId = task.moduleBackendId ?? null;
  const directProjectId = task.moduleProjectBackendId ?? null;

  if (directModuleId && directProjectId) {
    // Status sync.
    if (done !== undefined) {
      clientsApi
        .updateModule(directProjectId, directModuleId, { status: done ? "Completed" : "Pending" })
        .catch((err) => console.error("Module status didn't reach the server:", err.message));
    }
    // File uploads — both IndexedDB and data: URL paths.
    if (newAttachments && newAttachments.length) {
      newAttachments
        .filter((a) => a.type !== "link" && (
          (typeof a.url === "string" && a.url.startsWith("data:")) ||
          a.storedInIDB === true
        ))
        .forEach((a) => {
          const filePromise = a.storedInIDB
            ? import("../attachmentStorage.js").then(({ getAttachmentBlob }) =>
                getAttachmentBlob(a.id).then((blob) =>
                  blob ? new File([blob], a.name || "file", { type: blob.type || "application/octet-stream" }) : null
                )
              )
            : dataUrlToFile(a.url, a.name);
          filePromise.then((file) => {
            if (!file) return;
            clientsApi
              .uploadModuleFile(directProjectId, directModuleId, file)
              .catch((err) => console.error("Attachment didn't reach the server:", err.message));
          });
        });
      // FIX (a URL/link attached from Task page never reached the client's
      // real Module -> never showed on the Client Portal / another
      // browser): the filter above deliberately excludes `type === "link"`
      // since it isn't a file to upload — but that meant a link was never
      // synced to the backend AT ALL, only into the same-tab localStorage
      // mirror below. A link lives on the real Module's own `url` field
      // (see dashboard/serializers.py's _module_attachments), so it needs
      // its own PATCH here, same as the status-sync call just above.
      const linkAttachment = newAttachments.find((a) => a.type === "link" && a.url);
      if (linkAttachment) {
        clientsApi
          .updateModule(directProjectId, directModuleId, { url: linkAttachment.url })
          .catch((err) => console.error("Link didn't reach the server:", err.message));
      }
    }
  }

  // SECONDARY PATH: also update localStorage so the same-browser
  // ClientsPage UI updates instantly (optimistic UI), and fire the
  // backend call via the localStorage-derived backendId for tasks that
  // pre-date the moduleBackendId stamp (legacy fallback only).
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return;
    const clients = JSON.parse(raw);
    if (!Array.isArray(clients)) return;

    let touched = false;
    let syncTarget = null;
    let parentSyncTarget = null;
    const nextClients = clients.map((c) => {
      if (c.id !== task.clientId) return c;
      const projects = (c.projects || []).map((p) => {
        if (p.name !== task.moduleProjectName) return p;
        const modules = (p.modules || []).map((m) => {
          if (task.subModuleId) {
            if (m.id !== task.moduleId) return m;
            const subModules = (m.subModules || []).map((s) => {
              if (s.id !== task.subModuleId) return s;
              touched = true;
              const nextDone = done !== undefined ? done : s.done;
              // Only fire legacy backend call if the direct path didn't already.
              if (!directModuleId && p.backendId && s.backendId) {
                syncTarget = { projectBackendId: p.backendId, moduleBackendId: s.backendId, done: done !== undefined ? nextDone : undefined };
              }
              return {
                ...s,
                done: nextDone,
                attachments: newAttachments && newAttachments.length ? [...(s.attachments || []), ...newAttachments] : s.attachments || [],
              };
            });
            const nextParentDone = subModules.length > 0 && subModules.every((s) => s.done);
            if (!directModuleId && p.backendId && m.backendId && nextParentDone !== m.done) {
              parentSyncTarget = { projectBackendId: p.backendId, moduleBackendId: m.backendId, done: nextParentDone };
            }
            return { ...m, subModules, done: nextParentDone };
          }
          if (m.id !== task.moduleId) return m;
          touched = true;
          const nextDone = done !== undefined ? done : m.done;
          if (!directModuleId && p.backendId && m.backendId) {
            syncTarget = { projectBackendId: p.backendId, moduleBackendId: m.backendId, done: done !== undefined ? nextDone : undefined };
          }
          return {
            ...m,
            done: nextDone,
            attachments: newAttachments && newAttachments.length ? [...(m.attachments || []), ...newAttachments] : m.attachments || [],
          };
        });
        const progress = computeModulesProgress(modules);
        return { ...p, modules, progress };
      });
      if (!touched) return c;
      return {
        ...c,
        projects,
        activity: [
          { text: `"${task.title}" updated on "${task.moduleProjectName}"${done ? " (marked complete)" : ""}`, time: "just now" },
          ...(c.activity || []),
        ],
      };
    });

    if (touched) {
      localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(nextClients));
      window.dispatchEvent(new Event(CLIENTS_DATA_EVENT));
    }

    // Legacy backend sync (only fires when moduleBackendId was absent).
    if (syncTarget && syncTarget.done !== undefined) {
      clientsApi
        .updateModule(syncTarget.projectBackendId, syncTarget.moduleBackendId, {
          status: syncTarget.done ? "Completed" : "Pending",
        })
        .catch((err) => console.error("Module status didn't reach the server:", err.message));
    }
    if (parentSyncTarget) {
      clientsApi
        .updateModule(parentSyncTarget.projectBackendId, parentSyncTarget.moduleBackendId, {
          status: parentSyncTarget.done ? "Completed" : "Pending",
        })
        .catch(() => {});
    }
    // Legacy file upload (only fires when moduleBackendId was absent).
    if (!directModuleId && syncTarget && newAttachments && newAttachments.length) {
      newAttachments
        .filter((a) => a.type !== "link" && (
          (typeof a.url === "string" && a.url.startsWith("data:")) ||
          a.storedInIDB === true
        ))
        .forEach((a) => {
          const filePromise = a.storedInIDB
            ? import("../attachmentStorage.js").then(({ getAttachmentBlob }) =>
                getAttachmentBlob(a.id).then((blob) =>
                  blob ? new File([blob], a.name || "file", { type: blob.type || "application/octet-stream" }) : null
                )
              )
            : dataUrlToFile(a.url, a.name);
          filePromise.then((file) => {
            if (!file) return;
            clientsApi
              .uploadModuleFile(syncTarget.projectBackendId, syncTarget.moduleBackendId, file)
              .catch((err) => console.error("Attachment didn't reach the server:", err.message));
          });
        });
    }
    // Legacy link sync (only fires when moduleBackendId was absent) — see
    // the matching FIX comment in the direct path above.
    if (!directModuleId && syncTarget && newAttachments && newAttachments.length) {
      const linkAttachment = newAttachments.find((a) => a.type === "link" && a.url);
      if (linkAttachment) {
        clientsApi
          .updateModule(syncTarget.projectBackendId, syncTarget.moduleBackendId, { url: linkAttachment.url })
          .catch((err) => console.error("Link didn't reach the server:", err.message));
      }
    }
  } catch {
    // storage unavailable — the task itself still saved fine, this sync
    // is best-effort only
  }
}

// NEW — the real (Postgres) pk of the client module a task belongs to. A task
// created before that pk was known has no `moduleBackendId` of its own, but
// the Clients cache (`clientspage_clients_v1`) does carry it on the module.
function resolveTaskModuleBackendId(task) {
  if (task?.moduleBackendId != null) return task.moduleBackendId;
  if (!task?.clientId || !task?.moduleProjectName) return null;
  try {
    const clients = JSON.parse(localStorage.getItem(CLIENTS_STORAGE_KEY) || "[]");
    const c = (Array.isArray(clients) ? clients : []).find((x) => String(x.id) === String(task.clientId));
    const p = (c?.projects || []).find((x) => x.name === task.moduleProjectName);
    const m = (p?.modules || []).find((x) => x.id === task.moduleId);
    const node = task.subModuleId ? (m?.subModules || []).find((x) => x.id === task.subModuleId) : m;
    return node?.backendId ?? null;
  } catch {
    return null;
  }
}

// NEW — counterpart of syncModuleStatusToClientsStorage for DELETING: once the
// backend has removed an attachment, drop every cached copy of it from the
// same `clientspage_clients_v1` record ClientsPage reads. The Clients page
// merges the backend's list with this cache and keeps any cached entry the
// backend doesn't know (mergeModuleAttachments) — and when the module's real
// list is empty it shows the cache as-is — so without this a deleted file
// would keep showing there. The module is found by its real backend pk first
// (works for every client/project, whatever the local ids look like) and by
// client + project name + local module id as a fallback. Removes the
// attachment's own id, the zip's id, the ModuleFile ids the backend reported
// deleting, and — for a link — the same URL.
function removeModuleAttachmentFromClientsStorage(task, attachment, deletedModuleFileIds = [], moduleBackendId = null) {
  if (!attachment) return;
  const backendModuleId = moduleBackendId ?? resolveTaskModuleBackendId(task);
  const hasNameKey = !!(task?.clientId && task?.moduleProjectName);
  if (backendModuleId == null && !hasNameKey) return;
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return;
    const clients = JSON.parse(raw);
    if (!Array.isArray(clients)) return;

    const dead = new Set((deletedModuleFileIds || []).map(String));
    const zk = zipKey(attachment);
    const isDead = (a) =>
      (attachment.id != null && a.id === attachment.id) ||
      (zk != null && zipKey(a) === zk) ||
      dead.has(String(a.id)) ||
      (attachment.type === "link" && a.type === "link" && !!attachment.url && a.url === attachment.url);

    const byBackendId = (node) =>
      backendModuleId != null && node.backendId != null && String(node.backendId) === String(backendModuleId);
    const byNames = (c, p, m, sub) =>
      hasNameKey &&
      String(c.id) === String(task.clientId) &&
      p.name === task.moduleProjectName &&
      m.id === task.moduleId &&
      (task.subModuleId ? !!sub && sub.id === task.subModuleId : !sub);

    let anyTouched = false;
    const nextClients = clients.map((c) => {
      let clientTouched = false;
      const strip = (node) => {
        const before = node.attachments || [];
        const after = before.filter((a) => !isDead(a));
        if (after.length === before.length) return node;
        clientTouched = true;
        return { ...node, attachments: after };
      };
      const projects = (c.projects || []).map((p) => {
        const modules = (p.modules || []).map((m) => {
          const subModules = (m.subModules || []).map((sub) => (byBackendId(sub) || byNames(c, p, m, sub) ? strip(sub) : sub));
          const top = byBackendId(m) || byNames(c, p, m, null) ? strip(m) : m;
          return m.subModules ? { ...top, subModules } : top;
        });
        return { ...p, modules };
      });
      if (!clientTouched) return c;
      anyTouched = true;
      return {
        ...c,
        projects,
        activity: [{ text: `Attachment removed from "${task?.title || "a module"}"`, time: "just now" }, ...(c.activity || [])],
      };
    });

    if (anyTouched) {
      localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(nextClients));
      window.dispatchEvent(new Event(CLIENTS_DATA_EVENT));
    }
  } catch {
    // storage unavailable — the backend copy is already gone, this cache
    // cleanup is best-effort only
  }
}

// Clears a module's `kickoffPing` flag once runClientModuleSync has sent
// the "ready to start" message for it, straight in the same
// `clientspage_clients_v1` record ClientsPage's acceptModuleRequest set
// it on — otherwise the manager would get re-pinged on every future
// mount/focus/storage sync for the same accepted request.
function clearModuleKickoffPing(clientId, projectName, moduleName) {
  if (!clientId || !projectName || !moduleName) return;
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return;
    const clients = JSON.parse(raw);
    if (!Array.isArray(clients)) return;

    let touched = false;
    const nextClients = clients.map((c) => {
      if (c.id !== clientId) return c;
      const projects = (c.projects || []).map((p) => {
        if (p.name !== projectName) return p;
        const modules = (p.modules || []).map((m) => {
          if (m.name === moduleName && m.kickoffPing) {
            touched = true;
            const { kickoffPing, ...rest } = m;
            return rest;
          }
          if (m.subModules && m.subModules.length) {
            const subModules = m.subModules.map((s) => {
              if (s.name !== moduleName || !s.kickoffPing) return s;
              touched = true;
              const { kickoffPing, ...restSub } = s;
              return restSub;
            });
            return { ...m, subModules };
          }
          return m;
        });
        return { ...p, modules };
      });
      return { ...c, projects };
    });

    if (touched) {
      localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(nextClients));
      window.dispatchEvent(new Event(CLIENTS_DATA_EVENT));
    }
  } catch {
    // storage unavailable — the message itself already sent fine, this
    // flag-clear is best-effort only
  }
}

// Writes the final packaged zip straight onto the matching project's
// `deliverableZip` field in the same `clientspage_clients_v1` record —
// this is the field ClientsPage's own FinalDeliverable UI and
// ClientPortal's FinalDeliverableBlock both read, so a zip uploaded here
// (once every module in the project is done) shows up on the Clients
// page immediately, and on the Client Portal as soon as that client's
// outstanding balance hits zero — without any separate wiring.
function syncDeliverableToClientsStorage(clientId, projectName, attachment) {
  if (!clientId || !projectName) return;
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return;
    const clients = JSON.parse(raw);
    if (!Array.isArray(clients)) return;

    let touched = false;
    const nextClients = clients.map((c) => {
      if (c.id !== clientId) return c;
      const projects = (c.projects || []).map((p) => {
        if (p.name !== projectName) return p;
        touched = true;
        return { ...p, deliverableZip: attachment };
      });
      if (!touched) return c;
      return {
        ...c,
        projects,
        activity: [{ text: `Final deliverable uploaded for "${projectName}"`, time: "just now" }, ...(c.activity || [])],
      };
    });

    if (touched) {
      localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(nextClients));
      window.dispatchEvent(new Event(CLIENTS_DATA_EVENT));
    }
  } catch {
    // storage unavailable — the deliverable still saved fine in this
    // page's own storage, this sync to Clients/Portal is best-effort only
  }
}

// NEW — inverse of syncDeliverableToClientsStorage + syncZipToZipFilesStorage:
// once a final-deliverable zip is deleted, clear it from the Clients page's
// `deliverableZip` and the Zip Files page's `completedZip` caches so neither
// keeps listing a file that is gone. Only the record that still points at
// THIS zip (same name / same url) is cleared.
function removeDeliverableFromLocalCaches(clientId, projectName, attachment) {
  if (!projectName || !attachment) return;
  try {
    const sameZip = (z) =>
      !!z && ((z.url && z.url === attachment.url) || (z.dataUrl && z.dataUrl === attachment.url) ||
        (z.name || z.fileName) === attachment.name);
    if (clientId) {
      const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
      const clients = raw ? JSON.parse(raw) : null;
      if (Array.isArray(clients)) {
        let touched = false;
        const next = clients.map((c) => {
          if (c.id !== clientId) return c;
          const projects = (c.projects || []).map((p) => {
            if (p.name !== projectName || !sameZip(p.deliverableZip)) return p;
            touched = true;
            return { ...p, deliverableZip: null };
          });
          return { ...c, projects };
        });
        if (touched) {
          localStorage.setItem(CLIENTS_STORAGE_KEY, JSON.stringify(next));
          window.dispatchEvent(new Event(CLIENTS_DATA_EVENT));
        }
      }
    }
    const rawZip = localStorage.getItem(ZIP_FILES_PROJECTS_STORAGE_KEY);
    const zipProjects = rawZip ? JSON.parse(rawZip) : null;
    if (Array.isArray(zipProjects)) {
      const wanted = projectName.trim().toLowerCase();
      let touched = false;
      const next = zipProjects.map((p) => {
        if ((p.name || "").trim().toLowerCase() !== wanted || !sameZip(p.completedZip)) return p;
        touched = true;
        return { ...p, completedZip: null };
      });
      if (touched) localStorage.setItem(ZIP_FILES_PROJECTS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // storage unavailable — the server-side delete already succeeded
  }
}

// FIX (single-person task's completed zip went nowhere): completing a
// task with a zip attached used to only ever reach the Clients page, and
// only for module tasks that already had a `clientId` — a plain,
// directly-created task (no linked client) has neither, so its zip was
// never synced anywhere and the "Zip Files" admin page never saw it.
// This writes/updates a matching project entry straight in
// ZIP_FILES_PROJECTS_STORAGE_KEY (same key ProjectsPage and ZipFilesPage
// both read/write, via each project's `completedZip` field) so ANY zip
// completed from the Tasks page — single-person task or a client/module
// task — always shows up on the Zip Files page too, in addition to
// wherever it already went (Clients page, when applicable).
function syncZipToZipFilesStorage({ projectName, clientName, projectDetails, attachment }) {
  if (!projectName || !attachment) return;
  try {
    const raw = localStorage.getItem(ZIP_FILES_PROJECTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    const projects = Array.isArray(parsed) ? parsed : [];

    // These completion-flow attachments only ever carry a base64 data URL,
    // not the original File (so no `.size` in bytes) — approximate the MB
    // size straight from the base64 payload length so the Zip Files page
    // still shows a real-ish figure instead of always "0.0 MB".
    const approxSizeMb =
      attachment.size ||
      (typeof attachment.url === "string" && attachment.url.includes(",")
        ? ((attachment.url.split(",")[1] || "").length * 0.75) / (1024 * 1024)
        : 0);

    const completedZip = {
      fileName: attachment.name,
      uploadedBy: attachment.uploadedBy || "—",
      uploadedOn: (attachment.uploadedAt || new Date().toISOString()).slice(0, 10),
      size: approxSizeMb,
      dataUrl: attachment.url,
      storedInIDB: false,
    };

    const normalizedName = projectName.trim().toLowerCase();
    // Prefer a project that also matches on client (so two different
    // clients' identically-named projects never collide) but fall back to
    // a plain name match if client info isn't available on either side.
    const existingIndex = projects.findIndex((p) => {
      if ((p.name || "").trim().toLowerCase() !== normalizedName) return false;
      if (clientName && p.client && p.client !== clientName) return false;
      return true;
    });

    let nextProjects;
    if (existingIndex !== -1) {
      nextProjects = projects.map((p, i) =>
        i === existingIndex
          ? {
              ...p,
              completedZip,
              client: p.client || clientName || "Internal / Company Project",
              description: p.description || projectDetails || "No description provided.",
            }
          : p
      );
    } else if (!clientName) {
      // No matching project object exists on the Projects page yet, and
      // this is a genuine single-person task (no client at all) — the
      // exact case this fix was originally for (see the comment above
      // this function): a plain task's zip had nowhere else to go, so a
      // minimal, fully-shaped entry mirrors what ProjectsPage itself
      // creates on "Create Project", so nothing else that reads this same
      // storage (stats, team-sync effects, etc.) breaks on a missing
      // field.
      //
      // FIX (client/module task's zip was leaking a phantom project onto
      // the real Projects page): a client/module task's zip already
      // reaches the Clients page + Client Portal
      // (syncDeliverableToClientsStorage / syncModuleAttachmentToTasksStorage
      // above), and the task itself already shows correctly, grouped by
      // project, in this very page's own sidebar (moduleTaskKey-linked —
      // see syncClientModuleTasks). It was never a real row created via
      // ProjectsPage's own "Create Project" flow, so — unlike a
      // single-person task, which has nowhere else for its zip to go —
      // fabricating one here for a client task just because no existing
      // match was found only planted a disconnected, wrongly-shaped card
      // ("Unassigned" manager, 0/0 tasks) straight onto ProjectsPage.jsx's
      // own board (same STORAGE_KEY). The placeholder-creation branch
      // below is now for the no-client case only; a client task with no
      // existing Projects-page match falls through to the `else` below
      // instead, which does nothing.
      const id = `p${Date.now()}`;
      nextProjects = [
        {
          id,
          name: projectName,
          description: projectDetails || "No description provided.",
          projectType: "company",
          client: "Internal / Company Project",
          manager: "Unassigned",
          team: [],
          tasksDone: 0,
          tasksTotal: 0,
          tasks: [],
          status: "Completed",
          deadline: "",
          startDate: new Date().toISOString().slice(0, 10),
          budget: 0,
          spent: 0,
          deliverable: null,
          priority: "Medium",
          notes: "No additional notes have been added to this project yet.",
          modules: [],
          features: "",
          requirements: "",
          completionLink: null,
          briefFile: null,
          additionalInfo: "",
          completedZip,
        },
        ...projects,
      ];
    } else {
      // Client/module task, no existing Projects-page row to attach the
      // zip to — nothing to write; see the FIX comment above.
      return;
    }

    localStorage.setItem(ZIP_FILES_PROJECTS_STORAGE_KEY, JSON.stringify(nextProjects));
  } catch {
    // storage unavailable — the zip itself still saved fine on this task,
    // this sync to the Zip Files page is best-effort only
  }
}

// FIX (single-person task's zip should reach Clients page too): a plain
// task created straight on the Tasks page has no `clientId` of its own —
// only module tasks generated FROM a client's project modules do — so
// syncModuleStatusToClientsStorage has nothing to write to. As a
// best-effort bridge, if the task's project name happens to match a real
// project on some client's own project list, that client is used so the
// zip still reaches the Clients page / Client Portal (as that project's
// final deliverable) even though the task itself was never linked to a
// client. If no client has a project by that name, there's genuinely no
// client to attach it to — the zip still lands on the Zip Files page.
function findClientIdForProjectName(projectName) {
  if (!projectName) return null;
  try {
    const raw = localStorage.getItem(CLIENTS_STORAGE_KEY);
    if (!raw) return null;
    const clients = JSON.parse(raw);
    if (!Array.isArray(clients)) return null;
    const normalized = projectName.trim().toLowerCase();
    const match = clients.find((c) => (c.projects || []).some((p) => (p.name || "").trim().toLowerCase() === normalized));
    return match ? match.id : null;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------------
   FILE UPLOADS -> REAL, OPENABLE ATTACHMENTS

   Converts a picked image/video file into a real base64 data URL (via
   FileReader) instead of just remembering its file name — this is what
   lets the same file be reopened later from the Tasks page, the Clients
   page, or the Client Portal, since a plain File object can't survive a
   localStorage round-trip. Capped per file since everything here lives
   in localStorage (shared, limited quota).
---------------------------------------------------------------------- */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB per file (zips run bigger than screenshots)

// File-picker accept string shared by every uploader (Tasks page, Clients
// page module rows) — images, videos, and zip/archive files.
const ATTACHMENT_ACCEPT =
  "image/*,video/*,.zip,.rar,.7z,.cdr,.ai,.psd,.eps,.pdf,application/zip,application/x-zip-compressed,application/x-7z-compressed,application/x-rar-compressed";

// Classifies a picked File into one of our attachment "type" buckets —
// image/video get inline previews, zip/archive gets its own icon, and
// anything else falls back to a generic file icon. Used by every
// uploader (Tasks page, Clients page module rows) so a file dropped in
// from any of them is tagged consistently everywhere it's displayed.
function detectAttachmentKind(file) {
  const name = (file.name || "").toLowerCase();
  if (file.type?.startsWith("image/")) return "image";
  if (file.type?.startsWith("video/")) return "video";
  if (
    file.type === "application/zip" ||
    file.type === "application/x-zip-compressed" ||
    file.type === "application/x-7z-compressed" ||
    file.type === "application/x-rar-compressed" ||
    /\.(zip|rar|7z)$/.test(name)
  ) {
    return "zip";
  }
  return "file";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      reject(new Error("File is too large (max 5MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function genAttachmentId() {
  return `att-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

const SEED_TASKS = [
  {
    id: nextId(),
    title: "Design landing page UI",
    description: "Design a modern and responsive landing page for the e-commerce website using Figma.",
    project: "E-Commerce Website",
    assignee: "Sara Khan",
    assigneeRole: "UI/UX Designer",
    priority: "High",
    dueDate: isoDaysFromNow(3),
    status: "In Progress",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-10),
    attachment: "",
    requirements: "Create wireframe, design hero/features/testimonials sections, and export final assets ready for handoff to development.",
    subtasks: [
      { id: 1, text: "Create wireframe", done: true },
      { id: 2, text: "Design hero section", done: true },
      { id: 3, text: "Design features section", done: true },
      { id: 4, text: "Design testimonials section", done: false },
      { id: 5, text: "Finalize and export assets", done: false },
    ],
  },
  {
    id: nextId(),
    title: "Develop authentication module",
    description: "Implement login, register, and password reset flows with JWT sessions.",
    project: "Mobile Banking App",
    assignee: "Usman Ali",
    assigneeRole: "Backend Developer",
    priority: "High",
    dueDate: isoDaysFromNow(1),
    status: "In Progress",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-8),
    attachment: "",
    requirements: "Login/register endpoints, JWT access + refresh tokens, password reset via email link, and rate-limiting on auth routes.",
    subtasks: [
      { id: 1, text: "Login endpoint", done: true },
      { id: 2, text: "Register endpoint", done: true },
      { id: 3, text: "Password reset flow", done: false },
    ],
  },
  {
    id: nextId(),
    title: "Dashboard analytics design",
    description: "Design charts and analytics widgets for the CRM dashboard overview.",
    project: "CRM System",
    assignee: "Hina Fatima",
    assigneeRole: "Business Analyst",
    priority: "Medium",
    dueDate: isoDaysFromNow(0),
    status: "In Review",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-6),
    attachment: "",
    subtasks: [
      { id: 1, text: "Chart mockups", done: true },
      { id: 2, text: "Widget layout", done: true },
    ],
  },
  {
    id: nextId(),
    title: "API documentation",
    description: "Write API docs using Swagger for all CRM endpoints.",
    project: "CRM System",
    assignee: "Zain Ali",
    assigneeRole: "QA Engineer",
    priority: "Low",
    dueDate: isoDaysFromNow(-3),
    status: "Completed",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-14),
    attachment: "",
    subtasks: [{ id: 1, text: "Document all routes", done: true }],
  },
  {
    id: nextId(),
    title: "Fix UI responsiveness issue",
    description: "Fix mobile and tablet layout issues across the storefront pages.",
    project: "E-Commerce Website",
    assignee: "Zain Ali",
    assigneeRole: "UI/UX Designer",
    priority: "Medium",
    dueDate: isoDaysFromNow(5),
    status: "Pending",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-2),
    attachment: "",
    subtasks: [
      { id: 1, text: "Audit breakpoints", done: false },
      { id: 2, text: "Fix nav overflow", done: false },
    ],
  },
  {
    id: nextId(),
    title: "Payment gateway integration",
    description: "Integrate Stripe payment processing with order checkout.",
    project: "E-Commerce Website",
    assignee: "Ayesha Noor",
    assigneeRole: "Accountant",
    priority: "High",
    dueDate: isoDaysFromNow(2),
    status: "In Progress",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-5),
    attachment: "",
    subtasks: [
      { id: 1, text: "Connect Stripe SDK", done: true },
      { id: 2, text: "Handle webhooks", done: false },
    ],
  },
  {
    id: nextId(),
    title: "Create database schema",
    description: "Design the database schema for transactions and account ledgers.",
    project: "Mobile Banking App",
    assignee: "Usman Ali",
    assigneeRole: "Backend Developer",
    priority: "High",
    dueDate: isoDaysFromNow(-1),
    status: "Completed",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-12),
    attachment: "",
    subtasks: [{ id: 1, text: "Design tables", done: true }],
  },
  {
    id: nextId(),
    title: "User permissions module",
    description: "Implement role based access control across the CRM.",
    project: "CRM System",
    assignee: "Zain Ali",
    assigneeRole: "QA Engineer",
    priority: "Medium",
    dueDate: isoDaysFromNow(6),
    status: "Pending",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-1),
    attachment: "",
    subtasks: [],
  },
  {
    id: nextId(),
    title: "Bug fixes and optimization",
    description: "Fix reported bugs and improve loading speed of the banking app.",
    project: "Mobile Banking App",
    assignee: "Hina Fatima",
    assigneeRole: "Business Analyst",
    priority: "Medium",
    dueDate: isoDaysFromNow(8),
    status: "In Progress",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-3),
    attachment: "",
    subtasks: [
      { id: 1, text: "Fix crash on login", done: true },
      { id: 2, text: "Reduce bundle size", done: false },
    ],
  },
  {
    id: nextId(),
    title: "Email notifications setup",
    description: "Configure transactional email notifications for CRM events.",
    project: "CRM System",
    assignee: "Ayesha Noor",
    assigneeRole: "Accountant",
    priority: "Low",
    dueDate: isoDaysFromNow(-2),
    status: "Completed",
    createdBy: "Admin",
    createdOn: isoDaysFromNow(-9),
    attachment: "",
    subtasks: [{ id: 1, text: "Configure SMTP", done: true }],
  },
];

/* ======================================================================
   SMALL UI PIECES
====================================================================== */

function StatCard({ icon: Icon, iconBg, iconText, label, value, delta, up, card, cardText, mutedText, onClick }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      /* min-w-0: without it, a CSS grid child defaults to min-width:auto,
         which on a 2-column mobile grid can push the whole grid — and the
         page — wider than the screen. */
      className={`rounded-2xl p-3.5 min-w-0 ${card} ${
        onClick ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0" : ""
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconText}`}>
          <Icon className="w-4 h-4" />
        </span>
        <div className="min-w-0">
          <p className={`text-[11px] truncate ${mutedText}`}>{label}</p>
          <p className={`text-lg font-extrabold leading-tight ${cardText}`}>{value}</p>
        </div>
      </div>
      {delta && (
        <p className={`text-[10px] font-semibold mt-1.5 ${up ? "text-emerald-600" : "text-rose-600"}`}>
          {up ? "↑" : "↓"} {delta} <span className={`font-normal ${mutedText}`}>vs last month</span>
        </p>
      )}
    </div>
  );
}

function ProgressBar({ value, darkMode }) {
  // Fills in from 0 -> value the moment this bar first mounts (task list
  // opens, a row appears, a filter reveals it), instead of snapping
  // straight to its final width.
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPlay(true), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500 transition-all duration-700 ease-out"
          style={{ width: play ? `${value}%` : "0%" }}
        />
      </div>
      <span className="text-[10.5px] font-semibold text-slate-500 w-8 text-right shrink-0">{value}%</span>
    </div>
  );
}

// Same fill-in-from-0 behavior as ProgressBar, but bare (no % label) for
// spots that already render their own percentage text alongside the bar.
function ProgressBarFill({ pct, darkMode }) {
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPlay(true), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500 transition-all duration-700 ease-out"
        style={{ width: play ? `${pct}%` : "0%" }}
      />
    </div>
  );
}

function Dropdown({ label, value, options, onChange, inputCls, minWidth = "min-w-[130px]" }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-between gap-2 text-xs border rounded-lg px-3 py-1.5 ${minWidth} ${inputCls}`}
      >
        <span className="truncate">{value}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute left-0 top-full mt-1.5 w-full min-w-[160px] rounded-lg shadow-xl z-50 overflow-hidden max-h-56 overflow-y-auto ${inputCls}`}>
            {options.map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[11.5px] font-medium transition-colors ${
                  opt === value ? "bg-violet-600 text-white" : "hover:bg-violet-50 hover:text-violet-700"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ======================================================================
   MAIN PAGE
====================================================================== */

export default function TasksPage({ darkMode = false, conversations = [], setConversations }) {
  const { user, approvedUsers, canCreate, canEdit, canDelete } = useAuth();
  // Defined up-front (not just further down) so the very first render —
  // including the initial `selectedTaskId` below — already knows which
  // tasks this specific user is even allowed to see.
  const currentUserName = user?.name || "";

  // Real, per-role module permission gates (set from Users & Roles ->
  // Module Access Control). "Tasks" module: creating/editing/deleting a
  // task is only allowed if the current user's role has that permission
  // turned on — same helpers EmployeesPage.jsx uses for its own module.
  const canCreateTasks = canCreate("Tasks");
  const canEditTasks = canEdit("Tasks");
  const canDeleteTasks = canDelete("Tasks");

  // Only admin/manager get to see everyone's tasks. Anyone else (a real
  // employee, accountant, client, etc.) should only ever see tasks that
  // are actually assigned to them — matches the "approved user only sees
  // what they're allowed to" access model the rest of the app follows.
  const canSeeAllTasks = user?.role === "admin" || getRoleCategory(user?.role) === "manager";

  // Loaded from localStorage (falls back to an empty list, not fake demo
  // data) so that creating, editing, completing, or deleting a task
  // persists across page navigation and browser refreshes instead of
  // resetting every time this page remounts.
  const [tasks, setTasks] = useState(() => {
    const loaded = loadTasksFromStorage([]);
    const { result: withoutFakeDemo, changed: fakeDemoRemoved } = stripFakeDemoTasks(loaded);
    const { result, changed } = dedupeTaskIds(withoutFakeDemo);
    // If cleanup actually removed fake demo tasks or renumbered anything,
    // persist the repaired list right away so the fix sticks — otherwise
    // the very next save would just write the old data straight back to
    // storage.
    if (changed || fakeDemoRemoved) saveTasksToStorage(result);
    return result;
  });

  // FIX (real backend instead of fake/local-only data): the state above
  // still boots from localStorage first so the page has *something* to
  // paint instantly on load, but the backend (tasks app) is now the
  // actual source of truth — as soon as it answers, its list replaces
  // whatever was loaded from storage. If the request fails (backend not
  // running, logged out, offline, ...) the localStorage copy is left in
  // place as a fallback instead of blanking the page.
  const [tasksLoading, setTasksLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await tasksApiFetch("/tasks/");
        // FIX (duplicates on every reload): the backend list doesn't carry
        // moduleTaskKey / clientName / legacy string clientIds, so dropping
        // it into state raw made every client-linked task look unlinked and
        // both syncs re-created the whole set (with fresh messages) each
        // time the page loaded. hydrateTaskLinkMeta puts those links back.
        const list = hydrateTaskLinkMeta(Array.isArray(data) ? data : data?.results || []);
        if (!cancelled) {
          setTasks(list);
          saveTasksToStorage(list);
        }
      } catch (err) {
        console.error("Could not load tasks from the backend, showing cached data instead:", err);
      } finally {
        if (!cancelled) setTasksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // FIX (reliable single-person-task -> Clients page zip sync): Create
  // Task / Edit Task now let you explicitly pick which real client (from
  // ClientsPage's own list) a task belongs to, instead of only ever being
  // able to tag a task with client-linkage via the auto-generated module
  // tasks. Kept fresh the same way the module/assignment sync above does
  // (mount, window focus, and the "storage" event) so a client added or
  // renamed on the Clients page shows up in this dropdown without a
  // manual refresh.
  const [clientsForPicker, setClientsForPicker] = useState(() => loadClientsForTaskSync());
  const [view, setView] = useState(() => (canSeeAllTasks ? "all" : "mine")); // all | mine | projects | calendar
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("All Projects");
  // Which project cards are collapsed in the "By Projects" view — a
  // project starts expanded the first time you see it; toggling the
  // chevron just flips its entry here.
  const [collapsedProjects, setCollapsedProjects] = useState({});
  const [assigneeFilter, setAssigneeFilter] = useState("All Assignees");
  const [priorityFilter, setPriorityFilter] = useState("All Priorities");
  const [statusFilterPanelOpen, setStatusFilterPanelOpen] = useState(false);
  const [statusFilters, setStatusFilters] = useState([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedIds, setSelectedIds] = useState([]);
  // FIX (role-based visibility leak + stuck/duplicate panel): this used to
  // always default to SEED_TASKS[0]'s id — a fixed task that may belong to
  // someone else entirely — and, worse, having *any* task pre-selected on
  // load fought with the project-grouped view's own "select the first
  // project" effect below, since the panel always preferred a resolved
  // `selectedTaskId` over `selectedProjectKey`. Both "All Tasks" and "My
  // Tasks" are grouped-by-project views now (see `isGroupedView`), so there
  // is nothing to pre-select here — the grouped-view effect handles picking
  // the first project row instead.
  const [selectedTaskId, setSelectedTaskId] = useState(null);
  // FIX (mobile scroll): on phones/tablets the details panel renders BELOW
  // the task list (the grid collapses to a single column under `lg`), so
  // tapping a task used to leave the user staring at the same list with no
  // visible change — they had to know to scroll down manually. We now
  // auto-scroll the details panel into view whenever a task is tapped, but
  // only below the `lg` breakpoint (on desktop the panel is already visible
  // side-by-side, so we leave scroll position alone there).
  //
  // `scrollTick` is bumped on every tap (even re-tapping the already-
  // selected task, e.g. the default first task on initial load) so the
  // scroll always fires — relying on `selectedTaskId` alone as the effect
  // dependency meant tapping a task that was already selected did nothing,
  // which is the main case that made this feel completely broken.
  const [scrollTick, setScrollTick] = useState(0);
  const taskDetailsRef = useRef(null);
  // FIX (stuck Task Details panel): selecting a task and selecting a
  // project-group row used to write to two completely separate pieces of
  // state (`selectedTaskId` / `selectedProjectKey`) without ever clearing
  // the other. Since the panel below picks TaskDetails first whenever
  // `selectedTaskId` resolves to *any* task, a task selected once (even
  // just the page's initial default) stayed permanently "pinned" — clicking
  // a different project row in "All Tasks" changed `selectedProjectKey` but
  // the panel never noticed, because it kept finding the old
  // `selectedTaskId` first. Each selector now clears the other one, so
  // exactly one thing is ever "selected" at a time and the panel always
  // reflects whatever was just clicked.
  const selectTask = (id) => {
    setSelectedTaskId(id);
    setSelectedProjectKey(null);
    setScrollTick((n) => n + 1);
  };
  // NEW (grouped "All Tasks" view): "All Tasks" used to list every module
  // (UI/UX Design, Frontend, Backend, API Integration, Testing,
  // Deployment...) as its own separate row, even though they all belong
  // to the same project. It now shows ONE row per project instead —
  // `selectedProjectKey` tracks which project's row is selected, and the
  // right-hand panel shows every module underneath it (see
  // ProjectGroupDetails below), each still with its own attach/zip
  // button, just no longer scattered across separate top-level rows.
  const [selectedProjectKey, setSelectedProjectKey] = useState(null);
  const selectProjectGroup = (key) => {
    setSelectedProjectKey(key);
    setSelectedTaskId(null); // see the FIX note on selectTask() above
    setScrollTick((n) => n + 1);
  };
  useEffect(() => {
    if (!selectedTaskId || scrollTick === 0) return;
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile) return;
    // Wait for two animation frames so the details panel has actually
    // painted (its content/height can change a beat after selection)
    // before measuring where to scroll to — a fixed setTimeout delay was
    // occasionally firing before layout settled, which made the scroll
    // silently no-op.
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        taskDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [selectedTaskId, scrollTick]);
  const [openMenuId, setOpenMenuId] = useState(null);
  // Scroll target for the stat cards above: clicking one sets the view/status
  // filter to match that card, then smooth-scrolls the task list into view
  // (mainly useful on mobile, where the list sits below the stat cards).
  const taskListRef = useRef(null);
  const scrollToTaskList = (status) => {
    setView("all");
    setStatusFilters(status ? [status] : []);
    taskListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  // NEW: screen-space position of the currently open 3-dot menu. The menu
  // itself is now rendered once at the root of the page (fixed position)
  // instead of inline inside each table row, so it can never get
  // clipped/mis-placed by the table's own `overflow-auto` scroll area.
  const [menuPos, setMenuPos] = useState(null);
  // FIX (no delete option for a whole project row): grouped "All
  // Tasks"/"My Tasks" project rows had no actions menu at all — the
  // per-task menu above only ever looks a task up by id, so a project
  // row (keyed by `client::project`, see groupedRows) needs its own
  // open/position state rather than reusing openMenuId/menuPos.
  const [openGroupMenuKey, setOpenGroupMenuKey] = useState(null);
  const [groupMenuPos, setGroupMenuPos] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  // Which task (if any) currently has the "attach a link & mark completed"
  // confirmation modal open — replaces the old always-visible inline
  // attachment field with a focused prompt shown right when you click
  // Mark as Completed, either from the details panel or the 3-dot menu.
  const [completingTaskId, setCompletingTaskId] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [toasts, setToasts] = useState([]);
  // FIX (add new module/project): persisted, editable list of
  // projects/modules — starts from the same 3 seed projects but can now
  // grow, from either Create Task or Edit Task, and the addition sticks
  // around (used by the filter dropdown, the "By Projects" view, and both
  // task forms) instead of being a fixed, uneditable array.
  // FIX (blank-screen crash on Create/Edit Task): wrapping the raw setter
  // means EVERY update to `projects` — no matter which code path calls
  // setProjects, now or in any future change — gets normalized to plain
  // name strings before it ever lands in state. This is the last line of
  // defense: even if storage or a sync function somehow hands this a full
  // object instead of a string, the <option> elements below can never see it.
  const [projects, setProjectsRaw] = useState(() => loadProjectsFromStorage(DEFAULT_PROJECTS));
  const setProjects = (updater) => {
    setProjectsRaw((list) => normalizeProjectList(typeof updater === "function" ? updater(list) : updater));
  };
  // Which task (if any) is currently open in the Edit modal.
  const [editingTaskId, setEditingTaskId] = useState(null);
  // NEW: final zip deliverable(s) uploaded once a whole project's modules
  // are all completed — keyed by the same client+project key groupedRows
  // uses, so it always lines up with the right project's row.
  const [projectDeliverables, setProjectDeliverables] = useState(() => loadDeliverablesFromStorage());

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200";
  const cardText = darkMode ? "text-slate-100" : "text-slate-900";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-700";
  const rowHover = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";

  const showToast = (message, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  // Persist every change (create, edit, subtask toggle, complete, delete,
  // attachment save) so the data is still there next time this page mounts
  // — and keep each assignee's active-task count in sync on the Employees
  // page's own localStorage record.
  useEffect(() => {
    saveTasksToStorage(tasks);
    // Keep the id -> client-link map current (see
    // TASK_LINK_META_STORAGE_KEY) so the next backend fetch can restore
    // whatever the API drops, instead of the syncs treating those rows as
    // brand-new clients/modules and duplicating them.
    rememberTaskLinkMeta(tasks);
    syncEmployeeTaskCounts(tasks);
  }, [tasks]);

  useEffect(() => {
    saveProjectsToStorage(projects);
  }, [projects]);

  useEffect(() => {
    saveDeliverablesToStorage(projectDeliverables);
  }, [projectDeliverables]);

  const addProjectDeliverable = (key, attachment) => {
    setProjectDeliverables((map) => ({ ...map, [key]: [...(map[key] || []), attachment] }));
    // `key` is the same "${clientId}::${projectName}" composite groupedRows
    // uses — split on the first "::" only, since a project name could
    // itself legitimately contain "::".
    const sepIndex = key.indexOf("::");
    const clientId = sepIndex === -1 ? "" : key.slice(0, sepIndex);
    const projectName = sepIndex === -1 ? "" : key.slice(sepIndex + 2);
    syncDeliverableToClientsStorage(clientId, projectName, attachment);
    // FIX (see syncZipToZipFilesStorage above): a final project deliverable
    // zip uploaded here used to only ever reach the Clients page — it now
    // also shows up on the Zip Files admin page, same as a zip completed
    // straight from a task.
    const clientName = tasks.find((t) => t.clientId === clientId)?.clientName || null;
    syncZipToZipFilesStorage({
      projectName,
      clientName,
      attachment: { ...attachment, uploadedBy: attachment.uploadedBy || currentUserName || user?.name },
    });
    showToast("Final deliverable uploaded.", "success");
  };

  // NEW — delete a final-deliverable zip. Backend first (removes the stored
  // file, the TaskZipFile row and its ModuleFile mirror); only when that
  // worked is it dropped from this page and from the Clients / Zip Files
  // caches, so no page can keep showing a zip that no longer exists.
  // Throws on failure so the panel can show the error next to the file.
  const removeProjectDeliverable = async (key, attachment, taskId) => {
    if (!attachment) return;
    const ownerTask = tasks.find((t) => t.id === taskId);
    if (taskId != null && attachment.zipFileId != null) {
      try {
        await tasksApiRemoveAttachment(taskId, attachment, { moduleId: resolveTaskModuleBackendId(ownerTask) });
      } catch (err) {
        // Task never existed on the server -> nothing there to delete.
        if (!/not found/i.test(err?.message || "")) throw err;
      }
    }
    setProjectDeliverables((map) => ({
      ...map,
      [key]: (map[key] || []).filter((d) => !sameAttachment(d, attachment)),
    }));
    // The upload endpoint also left a copy in that module task's own list.
    if (taskId != null) {
      setTasks((list) =>
        list.map((t) =>
          t.id !== taskId ? t : { ...t, attachments: (t.attachments || []).filter((a) => !sameAttachment(a, attachment)) }
        )
      );
    }
    const sepIndex = key.indexOf("::");
    const clientId = sepIndex === -1 ? "" : key.slice(0, sepIndex);
    const projectName = sepIndex === -1 ? "" : key.slice(sepIndex + 2);
    removeDeliverableFromLocalCaches(clientId, projectName, attachment);
    showToast("Zip deleted.", "success");
  };

  // Both syncs below need the LATEST tasks each time they run (not just
  // whatever `tasks` was when the effect was first set up), since they're
  // now re-triggered on focus/storage events too, not just on mount — a
  // ref keeps that read fresh without re-subscribing the listeners below
  // every time a task changes.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // FIX (same client/module auto-assigned 2-4x): tasksRef only reflects
  // a newly auto-created task once its backend persist (see
  // persistAutoCreatedTasks) actually resolves — but mount, the
  // approvedUsers-ready effect, window focus and CLIENTS_DATA_EVENT can
  // all invoke these sync functions again before that round-trip
  // finishes, each one still seeing the client/module as "not linked
  // yet" and independently creating (and persisting, and notifying)
  // another copy. These two sets track "already being created, don't
  // start a second one" for exactly the window between deciding to
  // create a task and that persist resolving — closing the gap
  // tasksRef alone can't close because it only updates AFTER the round
  // trip, not before it starts.
  const pendingAssignmentClientIdsRef = useRef(new Set());
  const pendingModuleTaskKeysRef = useRef(new Set());

  // Names added this session via addProject (Create Task's "+ Add new
  // project"), kept around even while they still have zero tasks — see
  // pruneProjectCatalog below, which otherwise removes any empty project
  // it doesn't recognise as still genuinely in use.
  const manuallyAddedProjectNamesRef = useRef(new Set());

  // FIX ("By Projects mein delete ki hui projects abhi bhi dikh rahi hain"):
  // the projects catalog only ever grew — nothing ever took a name back out
  // once every task under it was deleted, or once a client/project was
  // removed on the Clients page. Called every time the client syncs run, so
  // the catalog always matches what's actually real: a project stays only
  // if it still has at least one task, still exists as a real client
  // project, or was manually added this session and hasn't been touched
  // yet.
  const pruneProjectCatalog = (clients) => {
    const keep = new Set();
    tasksRef.current.forEach((t) => {
      if (t.project) keep.add(t.project.trim().toLowerCase());
    });
    (clients || []).forEach((c) => {
      (c.projects || []).forEach((p) => {
        if (p.name) keep.add(p.name.trim().toLowerCase());
      });
    });
    manuallyAddedProjectNamesRef.current.forEach((n) => keep.add(n.trim().toLowerCase()));
    setProjects((list) => {
      const next = list.filter((name) => keep.has((name || "").trim().toLowerCase()));
      return next.length === list.length ? list : next;
    });
  };

  // Last line of defence for the "manager ko msg bar bar jata hai" half of
  // the bug: even if some path still manages to hand the same client/module
  // to a sync twice, its assignee is only ever messaged (and only ever
  // toasted about) once per session for a given key.
  const notifiedAutoKeysRef = useRef(null);
  if (notifiedAutoKeysRef.current === null) notifiedAutoKeysRef.current = loadNotifiedAutoKeys();
  // Key = the task/module + WHO it is assigned to, so a real reassignment
  // to a different person still notifies them once, but the same person is
  // never told twice about the same thing (even after a reload).
  const autoNotifyKey = (t, prefix = "") => {
    const base = t.moduleTaskKey || (t.clientId != null ? `client::${t.clientId}` : autoTaskFallbackKey(t));
    const who = getAssignees(t).map((n) => (n || "").trim().toLowerCase()).sort().join("|");
    return `${prefix}${base}::${who}`;
  };
  const notifyOnceForAutoTasks = (list) => {
    const fresh = list.filter((t) => {
      // FIX: module tasks are all created UPFRONT (locked) when a project
      // is made — messaging the manager at that point was noise. A locked
      // module is announced only when the client's "Request to start" is
      // approved (see the kickoffTasks path in runClientModuleSync).
      if (t.locked) return false;
      const key = autoNotifyKey(t);
      if (notifiedAutoKeysRef.current.has(key)) return false;
      notifiedAutoKeysRef.current.add(key);
      return true;
    });
    if (fresh.length) saveNotifiedAutoKeys(notifiedAutoKeysRef.current);
    fresh.forEach((t) => {
      flagTaskNotification(getAssignees(t));
      notifyAssigneesOfTask(getAssignees(t), t, approvedUsers, setConversations);
    });
    return fresh;
  };

  // Clears out the duplicate rows the earlier behaviour already saved, both
  // here and on the backend, so the page stops showing the same task 3-4
  // times for a single assignment. Runs once, right after the real task
  // list has loaded.
  const deletedAutoTaskIdsRef = useRef(new Set());
  const cleanupDuplicateAutoTasks = () => {
    // FIX ("user view mein assigned task dikh ke gayab ho jata hai"): the
    // client-link metadata this cleanup depends on (see
    // TASK_LINK_META_STORAGE_KEY) lives in ONE browser's localStorage —
    // it's never shared across logins. On the employee's own browser that
    // metadata was never written (they didn't create the task, an
    // admin/manager did, on a different machine), so every client-linked
    // task looks "unlinked" the moment it loads there. The fallback
    // project+title matching this cleanup uses for exactly that situation
    // could then mistake the employee's own real, correctly-assigned task
    // for a duplicate of something else and DELETE it from the backend —
    // which is exactly a "shows for a moment, then disappears" bug, and it
    // deletes the task for every user, not just this one. Only a session
    // that can actually manage client assignments (admin/manager) — and
    // therefore is far more likely to have that local metadata cached —
    // ever runs this destructive pass; a plain employee's session only
    // ever reads and displays whatever the backend already has.
    if (!canSeeAllTasks) return;
    const removeIds = findDuplicateAutoTaskIds(tasksRef.current).filter(
      (id) => !deletedAutoTaskIdsRef.current.has(String(id))
    );
    if (removeIds.length === 0) return;
    removeIds.forEach((id) => deletedAutoTaskIdsRef.current.add(String(id)));
    const removeSet = new Set(removeIds.map((id) => String(id)));
    const cleaned = tasksRef.current.filter((t) => !removeSet.has(String(t.id)));
    tasksRef.current = cleaned;
    setTasks(cleaned);
    removeIds.forEach((id) => {
      tasksApiFetch(`/tasks/${id}/`, { method: "DELETE" }).catch((err) => {
        console.error("Could not delete a duplicate auto-generated task:", err);
      });
    });
  };

  // Pulls in any client that's been given a manager on the Clients page
  // and doesn't have a task here yet, auto-assigning one to that manager
  // (and moving it over if the client's manager was changed since).
  const runClientAssignmentSync = () => {
    // FIX (task auto-assigned again on every visit, then vanished): this
    // used to run immediately on mount, racing the real GET /tasks/
    // fetch below — tasksRef.current at that moment was still whatever
    // (possibly stale) localStorage had cached, so a client already
    // linked to a real backend task could still look "unlinked" for a
    // moment, get a SECOND task auto-created and persisted, and then
    // have the real fetch's result overwrite/hide whichever copy lost
    // the race — different outcome (and duplicate toast) practically
    // every time. Waiting for the real list to finish loading at least
    // once means this always runs against the true, authoritative state.
    if (tasksLoading) return;
    // Same reasoning as cleanupDuplicateAutoTasks above: generating and
    // reassigning client tasks is an admin/manager action, and doing it
    // from an employee's under-informed browser is how a real assigned
    // task ends up getting treated as a stale duplicate and removed.
    if (!canSeeAllTasks) return;
    // Sweep out leftover duplicate / redundant auto rows first, so this
    // pass works from a clean list (and so an assignment row left over
    // from before the client had projects disappears as soon as its real
    // module tasks exist).
    cleanupDuplicateAutoTasks();
    const clients = loadClientsForTaskSync();
    // Runs regardless of whether any client exists — otherwise a manually
    // typed/now-fully-deleted project (no client, no tasks left) would
    // never get pruned on an account with zero clients.
    pruneProjectCatalog(clients);
    if (clients.length === 0) return;
    const sync = syncClientAssignmentTasks(tasksRef.current, clients, approvedUsers);
    if (!sync) return;

    // Drop any client a still-in-flight call already started creating a
    // task for — see pendingAssignmentClientIdsRef above. The
    // reassignment half of `sync` (renamed manager, etc.) is unaffected
    // either way and always applies.
    const reassignedTasks = sync.tasks.filter((t) => !sync.createdTasks.includes(t));
    const newTasks = sync.createdTasks.filter((t) => !pendingAssignmentClientIdsRef.current.has(t.clientId));
    const finalTasks = [...newTasks, ...reassignedTasks];
    newTasks.forEach((t) => pendingAssignmentClientIdsRef.current.add(t.clientId));

    setTasks(finalTasks);
    // FIX (manager notified up to 4x for the same client): mount, the
    // approvedUsers-change effect, window focus, the "storage" event and
    // CLIENTS_DATA_EVENT can all fire within the same tick (e.g. right on
    // page load). tasksRef used to only get refreshed by its own effect
    // AFTER this whole commit finished, so every one of those calls was
    // still reading the same stale tasksRef.current, none of them could
    // see the task the others had just "created", and each one sent its
    // own duplicate assignment message. Updating the ref immediately, the
    // moment we compute the new list, means the very next call — even one
    // fired later in the same synchronous burst — sees this client as
    // already linked and skips it instead of re-notifying.
    tasksRef.current = finalTasks;
    setProjects((list) => {
      const missing = clients
        .map((c) => c.name)
        .filter((n) => n && !list.some((p) => p.toLowerCase() === n.toLowerCase()));
      return missing.length ? [...list, ...missing] : list;
    });

    const notified = notifyOnceForAutoTasks(newTasks);
    persistAutoCreatedTasks(newTasks, setTasks, () => {
      newTasks.forEach((t) => pendingAssignmentClientIdsRef.current.delete(t.clientId));
    });
    if (notified.length > 0) {
      showToast(
        notified.length === 1
          ? `Task auto-assigned to ${notified[0].assignees[0]} for new client "${notified[0].project}".`
          : `${notified.length} tasks auto-assigned from client manager assignments.`,
        "success"
      );
    }
  };

  // Same idea, one level deeper: generates one real task per project
  // module/sub-task (Planning, Frontend, Backend, Database, API
  // Integration, Testing, Deployment, ...) for every client that has a
  // manager/developer assigned, and keeps each one's assignee + done
  // state synced with whatever's currently true on the Clients page —
  // this is the link that makes UI/UX, Frontend, Backend, Deployment...
  // show up here as real tasks in the first place, matching the Clients
  // page's own checklist one-for-one.
  const runClientModuleSync = () => {
    // See the matching comment in runClientAssignmentSync above — same
    // race, same fix.
    if (tasksLoading) return;
    // Same admin/manager-only gate as runClientAssignmentSync — see the
    // comment there for why an employee's browser must never run this.
    if (!canSeeAllTasks) return;
    const clients = loadClientsForTaskSync();
    if (clients.length === 0) return;
    const sync = syncClientModuleTasks(tasksRef.current, clients, approvedUsers);
    if (!sync) return;

    // Drop any module a still-in-flight call already started creating a
    // task for — see pendingModuleTaskKeysRef above.
    const reassignedTasks = sync.tasks.filter((t) => !sync.createdTasks.includes(t));
    const newTasks = sync.createdTasks.filter((t) => !pendingModuleTaskKeysRef.current.has(t.moduleTaskKey));
    const finalTasks = [...newTasks, ...reassignedTasks];
    newTasks.forEach((t) => pendingModuleTaskKeysRef.current.add(t.moduleTaskKey));

    setTasks(finalTasks);
    // FIX (same stale-ref duplicate-notification bug as runClientAssignmentSync
    // above, one level deeper): keep tasksRef current immediately so a
    // module sync triggered right after (same tick) doesn't re-create/
    // re-notify a module task this call already just added.
    tasksRef.current = finalTasks;
    setProjects((list) => {
      const missing = clients
        .flatMap((c) => (c.projects || []).map((p) => p.name))
        .filter((n) => n && !list.some((p) => p.toLowerCase() === n.toLowerCase()));
      return missing.length ? [...list, ...Array.from(new Set(missing))] : list;
    });

    const notified = notifyOnceForAutoTasks(newTasks);
    persistAutoCreatedTasks(newTasks, setTasks, () => {
      newTasks.forEach((t) => pendingModuleTaskKeysRef.current.delete(t.moduleTaskKey));
    });
    if (notified.length > 0) {
      showToast(
        `${notified.length} module task${notified.length === 1 ? "" : "s"} auto-assigned from client project checklists.`,
        "success"
      );
    }

    // The "already existed, client just asked to start it now" case —
    // see kickoffTasks comment above syncClientModuleTasks. Message the
    // manager the same "ready to start" way, then clear the flag so it
    // doesn't fire again next sync.
    (sync.kickoffTasks || []).forEach((t) => {
      // One "ready to start" message per approved request — guarded
      // persistently so a failed clear/reload can't resend it.
      const kKey = autoNotifyKey(t, "kickoff::");
      if (!notifiedAutoKeysRef.current.has(kKey)) {
        notifiedAutoKeysRef.current.add(kKey);
        saveNotifiedAutoKeys(notifiedAutoKeysRef.current);
        flagTaskNotification(getAssignees(t));
        notifyAssigneesOfTask(getAssignees(t), t, approvedUsers, setConversations);
      }
      clearModuleKickoffPing(t.clientId, t.moduleProjectName, t.moduleName);
    });
  };

  // Run once on mount (covers "navigated here right after assigning a
  // client on the Clients page"), then again on window focus and on the
  // native "storage" event (covers "Clients page open in another tab and
  // I just ticked/uploaded something there") — this is what keeps the
  // two pages feeling like one connected system instead of only agreeing
  // after a manual refresh.
  useEffect(() => {
    runClientAssignmentSync();
    runClientModuleSync();
    setClientsForPicker(loadClientsForTaskSync());
    const onFocus = () => {
      runClientAssignmentSync();
      runClientModuleSync();
      setClientsForPicker(loadClientsForTaskSync());
    };
    const onStorage = (e) => {
      if (e.key === CLIENTS_STORAGE_KEY) {
        runClientAssignmentSync();
        runClientModuleSync();
        setClientsForPicker(loadClientsForTaskSync());
      }
    };
    // Same-tab counterpart to the "storage" listener above — see
    // CLIENTS_DATA_EVENT: catches a module request accepted (or any
    // other client-data change) from ClientsPage.jsx without needing a
    // tab switch first, so the new module's task — and the manager's
    // notification below — appears right away.
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    window.addEventListener(CLIENTS_DATA_EVENT, onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CLIENTS_DATA_EVENT, onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Runs the two syncs once, right when the real backend task list
  // finishes its first load (tasksLoading true -> false) — this is what
  // actually catches "navigated here right after assigning a client",
  // now that both sync functions refuse to run any earlier (see the
  // tasksLoading guard inside each). The plain mount-effect above still
  // fires first, same tick, but simply no-ops until this fires.
  useEffect(() => {
    if (tasksLoading) return;
    // Sweep out the duplicate copies saved by the earlier behaviour BEFORE
    // syncing, so the syncs see one clean task per client/module.
    cleanupDuplicateAutoTasks();
    runClientAssignmentSync();
    runClientModuleSync();
    setClientsForPicker(loadClientsForTaskSync());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksLoading]);

  // FIX (real employees only, loaded late): the effect above intentionally
  // only runs once on mount plus focus/storage events, so it can end up
  // closing over an empty/stale `approvedUsers` list if that list finishes
  // loading a moment after this page first mounts — which would leave
  // every client-derived module task stuck on "Unassigned" even after the
  // real employee list is ready. Re-running the sync whenever the real
  // approved-users list actually changes re-resolves every assignee
  // against the current list.
  useEffect(() => {
    if (!approvedUsers || approvedUsers.length === 0) return;
    runClientAssignmentSync();
    runClientModuleSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedUsers]);

  // Adds a brand-new project/module (case-insensitive de-duped). Returns
  // true on success so the calling form knows whether to auto-select it.
  const addProject = (name) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return false;
    if (projects.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
      showToast("That project already exists.", "error");
      return false;
    }
    manuallyAddedProjectNamesRef.current.add(trimmed.toLowerCase());
    setProjects((list) => [...list, trimmed]);
    showToast(`Project "${trimmed}" added.`, "success");
    return true;
  };

  // Real approved users, so tasks can actually be assigned to people who
  // exist in the system. Only employees/managers/accountants are
  // assignable — same rule EmployeesPage uses to decide who shows up as a
  // real employee, so "who can be assigned a task" and "who is an
  // employee" always agree. Falls back to whoever is logged in if the
  // list is still empty in a fresh demo.
  const assignableUsers = useMemo(() => {
    const list = (approvedUsers || [])
      .filter((u) => u.role !== "admin" && u.role !== "client")
      .map((u) => ({ name: u.name, role: u.role || "Team Member" }));
    if (list.length === 0 && user) list.push({ name: user.name, role: user.role || "Admin" });
    return list;
  }, [approvedUsers, user]);

  // Opening Tasks counts as "seen" — clear this user's red-dot flag for
  // the sidebar the moment this page mounts (or the logged-in user changes).
  useEffect(() => {
    if (currentUserName) clearTaskNotification(currentUserName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserName]);

  // Every stat/list below reads from this instead of raw `tasks`, so a
  // non-privileged user (regular employee, accountant, client, etc.) only
  // ever sees tasks assigned to them — never the whole company's list.
  const visibleTasks = useMemo(
    () => (canSeeAllTasks ? tasks : tasks.filter((t) => assignedToUser(t, currentUserName))),
    [tasks, canSeeAllTasks, currentUserName]
  );

  useEffect(() => {
    setPage(1);
  }, [view, search, projectFilter, assigneeFilter, priorityFilter, statusFilters, rowsPerPage]);

  // Effective status: a task past its due date and not completed reads as Overdue,
  // regardless of what was last saved, so counts and badges always stay honest.
  const effectiveStatus = (t) => (t.status !== "Completed" && isPastDue(t.dueDate) ? "Overdue" : t.status);

  const counts = useMemo(() => {
    const withStatus = visibleTasks.map((t) => effectiveStatus(t));
    return {
      total: visibleTasks.length,
      completed: withStatus.filter((s) => s === "Completed").length,
      inProgress: withStatus.filter((s) => s === "In Progress").length,
      pending: withStatus.filter((s) => s === "Pending").length,
      overdue: withStatus.filter((s) => s === "Overdue").length,
      myPending: visibleTasks.filter((t) => assignedToUser(t, currentUserName) && effectiveStatus(t) !== "Completed").length,
    };
  }, [visibleTasks, currentUserName]);

  const assigneeOptions = useMemo(
    () => ["All Assignees", ...Array.from(new Set(visibleTasks.flatMap((t) => getAssignees(t))))],
    [visibleTasks]
  );

  const matchesFilters = (t) => {
    const q = search.trim().toLowerCase();
    const assignees = getAssignees(t);
    const matchesSearch =
      !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || assignees.some((a) => a.toLowerCase().includes(q));
    const matchesProject = projectFilter === "All Projects" || t.project === projectFilter;
    const matchesAssignee = assigneeFilter === "All Assignees" || assignees.includes(assigneeFilter);
    const matchesPriority = priorityFilter === "All Priorities" || t.priority === priorityFilter;
    const matchesStatus = statusFilters.length === 0 || statusFilters.includes(effectiveStatus(t));
    return matchesSearch && matchesProject && matchesAssignee && matchesPriority && matchesStatus;
  };

  const filteredTasks = useMemo(() => {
    let list = visibleTasks.filter(matchesFilters);
    if (view === "mine") list = list.filter((t) => assignedToUser(t, currentUserName));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, search, projectFilter, assigneeFilter, priorityFilter, statusFilters, view, currentUserName]);

  // Group filteredTasks by project — "All Tasks" renders one row per
  // PROJECT (see isGroupedView below) instead of one row per module, so
  // a project with six modules (UI/UX Design, Frontend, Backend, ...)
  // shows as a single "vdvfg" row instead of six unrelated-looking rows.
  // FIX (mixed-up / stuck-on-one-project bug): this used to key purely
  // off the project NAME. Two different clients whose projects happened
  // to share a name (e.g. both just called "Website") got merged into
  // ONE row here — clicking either one always showed the same combined
  // (and often wrong) set of modules, and there was no way to reach "the
  // other" project at all since both pointed at the same key. Keying by
  // client + project name together keeps same-named projects for
  // different clients (or a client project vs. an unrelated manual task
  // that happens to share the name) in their own separate rows.
  const groupedRows = useMemo(() => {
    const map = new Map();
    filteredTasks.forEach((t) => {
      const key = `${t.clientId || ""}::${t.project}`;
      if (!map.has(key)) map.set(key, { key, project: t.project, clientId: t.clientId || null, clientName: t.clientName || null, tasks: [] });
      map.get(key).tasks.push(t);
    });
    return Array.from(map.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTasks]);

  // Same client+project-name composite grouping as `groupedRows` above,
  // but for the "By Projects" view — which (unlike the "All Tasks" table)
  // also needs to keep showing a still-empty, newly-added catalog project
  // as its own collapsible section even before any task exists under it.
  // FIX (mixed-up projects): previously this view iterated the plain
  // `projects` name catalog and filtered filteredTasks by name alone, so
  // it had the exact same same-name-different-client mixing bug as the
  // "All Tasks" view did.
  const projectSections = useMemo(() => {
    const map = new Map();
    filteredTasks.forEach((t) => {
      const key = `${t.clientId || ""}::${t.project}`;
      if (!map.has(key)) map.set(key, { key, name: t.project, clientId: t.clientId || null, clientName: t.clientName || null, tasks: [] });
      map.get(key).tasks.push(t);
    });
    projects.forEach((name) => {
      if (projectFilter !== "All Projects" && projectFilter !== name) return;
      const key = `::${name}`;
      if (!map.has(key)) map.set(key, { key, name, clientId: null, clientName: null, tasks: [] });
    });
    return Array.from(map.values());
  }, [filteredTasks, projects, projectFilter]);

  // FIX (one consistent Task Details design for every role): "My Tasks"
  // used to stay a flat, one-row-per-module list backed by the older
  // TaskDetails panel, while "All Tasks" showed the grouped-by-project
  // table + module-checklist panel. That meant an employee saw a
  // completely different (and out of date looking) details panel than an
  // admin looking at the exact same work. Both "All Tasks" and "My Tasks"
  // are grouped by project now — `visibleTasks` (and therefore
  // `filteredTasks`/`groupedRows`) is already scoped to "only this
  // person's tasks" for a non-admin/manager, so "My Tasks" simply shows
  // that same person's own projects, grouped the same way, with the same
  // panel.
  const isGroupedView = view === "all" || view === "mine";
  const totalPages = Math.max(1, Math.ceil((isGroupedView ? groupedRows.length : filteredTasks.length) / rowsPerPage));
  const pageStart = (page - 1) * rowsPerPage;
  const pagedTasks = filteredTasks.slice(pageStart, pageStart + rowsPerPage);
  const pagedGroups = groupedRows.slice(pageStart, pageStart + rowsPerPage);

  // FIX (role-based visibility): resolved against `visibleTasks`, not the
  // raw full `tasks` list — so a restricted user's details panel can
  // never end up showing a task that isn't theirs, no matter how
  // `selectedTaskId` got set.
  const selectedTask = visibleTasks.find((t) => t.id === selectedTaskId) || null;
  // Modules under whichever project row is currently selected in the
  // grouped "All Tasks" view. Pulled straight off the matching group in
  // `groupedRows` (keyed by client + project, see the FIX note above)
  // instead of re-filtering filteredTasks by project name alone — that
  // used to silently pull in another client's identically-named project
  // too.
  const selectedProjectGroup = selectedProjectKey ? groupedRows.find((g) => g.key === selectedProjectKey) || null : null;
  const selectedProjectTasks = selectedProjectGroup ? selectedProjectGroup.tasks : [];

  // Keep a project selected whenever we're on the grouped view: pick the
  // first visible project the moment "All Tasks" is opened, and fall back
  // to the first remaining one if the selected project gets filtered out
  // entirely (e.g. an assignee/priority filter that no longer matches it).
  useEffect(() => {
    if (!isGroupedView) return;
    if (selectedProjectKey && groupedRows.some((g) => g.key === selectedProjectKey)) return;
    setSelectedProjectKey(groupedRows[0]?.key ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGroupedView, groupedRows]);
  const editingTask = tasks.find((t) => t.id === editingTaskId) || null;
  const completingTask = tasks.find((t) => t.id === completingTaskId) || null;

  // In the grouped view, "select all" selects every module task across
  // the currently-visible project rows, not just the (nonexistent)
  // one-row-per-task list.
  const pagedGroupTasks = useMemo(() => pagedGroups.flatMap((g) => g.tasks), [pagedGroups]);
  const relevantPagedTasks = isGroupedView ? pagedGroupTasks : pagedTasks;
  const allPagedSelected = relevantPagedTasks.length > 0 && relevantPagedTasks.every((t) => selectedIds.includes(t.id));
  const toggleSelectAll = () => {
    if (allPagedSelected) {
      setSelectedIds((ids) => ids.filter((id) => !relevantPagedTasks.some((t) => t.id === id)));
    } else {
      setSelectedIds((ids) => Array.from(new Set([...ids, ...relevantPagedTasks.map((t) => t.id)])));
    }
  };
  const toggleSelectRow = (id) => {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  };

  const updateTask = (id, patch) => {
    // Optimistic: update the UI immediately, same feel as before, then
    // persist to the backend. If the save fails, roll the local state
    // back and tell the person — don't leave them thinking it saved.
    const prevTask = tasks.find((t) => t.id === id);
    setTasks((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    tasksApiFetch(`/tasks/${id}/`, { method: "PATCH", body: JSON.stringify(patch) }).catch((err) => {
      console.error("Could not save task changes to the backend:", err);
      if (prevTask) setTasks((list) => list.map((t) => (t.id === id ? prevTask : t)));
      showToast(err.message || "Could not save changes. Please try again.", "error");
    });
  };

  const toggleSubtask = (taskId, subId) => {
    setTasks((list) =>
      list.map((t) => {
        if (t.id !== taskId) return t;
        const subtasks = t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s));
        const progress = subtasks.length ? Math.round((subtasks.filter((s) => s.done).length / subtasks.length) * 100) : t.progress ?? 0;
        return { ...t, subtasks, progress: t.status === "Completed" ? 100 : progress };
      })
    );
    tasksApiFetch(`/tasks/${taskId}/toggle-subtask/`, {
      method: "POST",
      body: JSON.stringify({ subtaskId: subId }),
    }).catch((err) => {
      console.error("Could not save subtask toggle to the backend:", err);
      showToast(err.message || "Could not save that change. Please try again.", "error");
    });
  };

  const markCompleted = (id, link, newAttachments = []) => {
    // Locked module tasks (client hasn't requested it / staff hasn't
    // accepted that request yet — see acceptModuleRequest in
    // ClientsPage.jsx) can't be marked complete from here at all.
    const targetTask = tasks.find((t) => t.id === id);
    if (targetTask?.locked) {
      showToast("This module is locked until the client's request to start it is accepted.", "error");
      return;
    }
    let completedTask = null;
    setTasks((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        const next = {
          ...t,
          status: "Completed",
          progress: 100,
          subtasks: t.subtasks.map((s) => ({ ...s, done: true })),
          attachment: link !== undefined && link !== "" ? link : t.attachment,
          attachments: newAttachments.length ? [...(t.attachments || []), ...newAttachments] : t.attachments || [],
        };
        completedTask = next;
        return next;
      })
    );
    if (completedTask) {
      syncModuleStatusToClientsStorage(completedTask, { done: true, newAttachments });
      // FIX (see syncZipToZipFilesStorage / findClientIdForProjectName
      // above): whatever kind of task this is — an auto-generated
      // client/module task (already synced to the Clients page above), a
      // task explicitly tagged with a client via the new "Client"
      // dropdown, or a plain single-person task with no client at all —
      // any zip/archive attached while completing it now also reaches (a)
      // the Zip Files admin page always, and (b) the Clients page too,
      // reliably when a client was explicitly picked, or best-effort by
      // project-name match for older tasks that predate the dropdown.
      (newAttachments || [])
        .filter((a) => a.type === "zip")
        .forEach((att) => {
          const projectName = completedTask.moduleProjectName || completedTask.project;
          const attachmentWithUploader = { ...att, uploadedBy: currentUserName || user?.name };

          syncZipToZipFilesStorage({
            projectName,
            clientName: completedTask.clientName || null,
            attachment: attachmentWithUploader,
          });

          if (completedTask.clientId && !completedTask.moduleTaskKey) {
            // Explicitly tagged via the Client dropdown on Create/Edit
            // Task (not an auto-generated module task, which is already
            // synced above) — 100% reliable, no name-matching needed.
            syncDeliverableToClientsStorage(completedTask.clientId, projectName, attachmentWithUploader);
          } else if (!completedTask.clientId) {
            // Older task created before the Client dropdown existed, with
            // no client picked at all — best-effort fallback: only works
            // if the project name happens to match a real client project.
            const matchedClientId = findClientIdForProjectName(projectName);
            if (matchedClientId) {
              syncDeliverableToClientsStorage(matchedClientId, projectName, attachmentWithUploader);
            }
          }
        });
      // FIX: actually send admin the "task completed" message (+ any
      // uploaded URL/screenshot/PDF) — see notifyAdminOfTaskCompletion
      // for why this used to be a no-op.
      notifyAdminOfTaskCompletion(completedTask, link, newAttachments, user, approvedUsers, setConversations);
    }
    tasksApiFetch(`/tasks/${id}/complete/`, {
      method: "POST",
      body: JSON.stringify({ link: link || "", attachments: newAttachments }),
    }).catch((err) => {
      console.error("Could not save task completion to the backend:", err);
    });
    showToast("Task marked as completed. Admin has been notified.", "success");
  };

  // Lets a screenshot/video/link be added to a task at any time — not
  // just at the moment it's marked complete — and, for a module task,
  // syncs straight into the client's project checklist so it shows up
  // on the Clients page and the Client Portal right away.
  const addTaskAttachment = (id, attachment) => {
    const targetTask = tasks.find((t) => t.id === id);
    if (targetTask?.locked) {
      showToast("This module is locked until the client's request to start it is accepted.", "error");
      return;
    }
    let updatedTask = null;
    setTasks((list) =>
      list.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, attachments: dedupeAttachments([...(t.attachments || []), attachment]) };
        updatedTask = next;
        return next;
      })
    );
    if (updatedTask) syncModuleStatusToClientsStorage(updatedTask, { newAttachments: [attachment] });
    tasksApiFetch(`/tasks/${id}/add-attachment/`, {
      method: "POST",
      body: JSON.stringify({ attachment }),
    }).catch((err) => {
      console.error("Could not save the attachment to the backend:", err);
    });
    showToast("Attachment uploaded.", "success");
  };

  // Same idea as addTaskAttachment, but scoped to one specific checklist
  // item inside the task (e.g. just the "UI/UX Design" row) instead of
  // the task as a whole — this is what the paperclip icon on each
  // sub-task row calls. Plain hand-typed sub-tasks aren't linked to any
  // client/module record, so there's nothing further to sync here; the
  // attachment just lives on the task itself and is saved by the normal
  // persistence effect like everything else in `tasks`.
  const addSubtaskAttachment = (taskId, subId, attachment) => {
    setTasks((list) =>
      list.map((t) => {
        if (t.id !== taskId) return t;
        const subtasks = t.subtasks.map((s) =>
          s.id === subId ? { ...s, attachments: [...(s.attachments || []), attachment] } : s
        );
        return { ...t, subtasks };
      })
    );
    showToast("Attachment uploaded.", "success");
  };

  // NEW — delete one uploaded file / zip / URL from a module task. The
  // backend goes first (it removes the stored file, the TaskZipFile /
  // ModuleFile rows and the module's linked URL — everything the Clients
  // page and Client Portal read); only once that worked is the attachment
  // dropped here and from the Clients page's cached copy, so the two pages
  // can never disagree about whether it still exists. Throws on failure so
  // the calling component can show the error next to the file.
  const removeTaskAttachment = async (id, attachment) => {
    const targetTask = tasks.find((t) => t.id === id);
    if (!targetTask || !attachment) return;
    const moduleBackendId = resolveTaskModuleBackendId(targetTask);
    let res = null;
    try {
      res = await tasksApiRemoveAttachment(id, attachment, { moduleId: moduleBackendId });
    } catch (err) {
      // A task that only ever existed in this browser has nothing on the
      // server to delete — just clear it locally.
      if (!/not found/i.test(err?.message || "")) throw err;
    }
    setTasks((list) =>
      list.map((t) =>
        t.id !== id ? t : { ...t, attachments: (t.attachments || []).filter((a) => !sameAttachment(a, attachment)) }
      )
    );
    removeModuleAttachmentFromClientsStorage(targetTask, attachment, res?.deletedModuleFileIds, moduleBackendId);
    showToast("Attachment deleted.", "success");
  };

  // Same, for an attachment on one checklist row (sub-task) inside a task.
  // Sub-task files/links are never mirrored to the client's module, so the
  // backend is told not to look for a same-named module file (localOnly) —
  // only a zip, which really is stored server-side, gets deleted there.
  const removeSubtaskAttachment = async (taskId, subId, attachment) => {
    const targetTask = tasks.find((t) => t.id === taskId);
    if (!targetTask || !attachment) return;
    const moduleBackendId = resolveTaskModuleBackendId(targetTask);
    let res = null;
    try {
      res = await tasksApiRemoveAttachment(taskId, attachment, { localOnly: true, moduleId: moduleBackendId });
    } catch (err) {
      if (!/not found/i.test(err?.message || "")) throw err;
    }
    setTasks((list) =>
      list.map((t) => {
        if (t.id !== taskId) return t;
        const subtasks = t.subtasks.map((s) =>
          s.id === subId ? { ...s, attachments: (s.attachments || []).filter((a) => !sameAttachment(a, attachment)) } : s
        );
        return { ...t, subtasks };
      })
    );
    if (attachment.type !== "link") {
      removeModuleAttachmentFromClientsStorage(targetTask, attachment, res?.deletedModuleFileIds, moduleBackendId);
    }
    showToast("Attachment deleted.", "success");
  };

  const deleteTask = (id) => {
    const task = tasks.find((t) => t.id === id);
    const remaining = tasks.filter((t) => t.id !== id);
    setTasks(remaining);
    tasksRef.current = remaining;
    setSelectedIds((ids) => ids.filter((x) => x !== id));
    if (selectedTaskId === id) setSelectedTaskId(null);
    setOpenMenuId(null);
    setMenuPos(null);
    if (task) notifyAssigneesOfTaskDeletion(getAssignees(task), task, approvedUsers, setConversations);
    tasksApiFetch(`/tasks/${id}/`, { method: "DELETE" }).catch((err) => {
      console.error("Could not delete the task on the backend:", err);
    });
    // FIX (ghost "By Projects" section): if that was the last task under
    // this project (and it isn't a real client project or a name the user
    // just added), take its name back out of the catalog right away
    // instead of leaving an empty section behind until the next sync pass.
    pruneProjectCatalog(loadClientsForTaskSync());
    showToast("Task deleted.", "error");
  };

  // FIX (no delete option for a whole project row in "All Tasks"/"My
  // Tasks"): removes every module task under the given project group in
  // one action instead of requiring one-by-one deletes from inside the
  // Project Details panel. Same cleanup as deleteTask (selection,
  // selectedTaskId, open menus) plus clearing selectedProjectKey when the
  // deleted project was the one currently open.
  const deleteProjectGroup = (key) => {
    const group = groupedRows.find((g) => g.key === key);
    if (!group || group.tasks.length === 0) return;
    const idsToRemove = new Set(group.tasks.map((t) => t.id));
    const remaining = tasks.filter((t) => !idsToRemove.has(t.id));
    setTasks(remaining);
    tasksRef.current = remaining;
    setSelectedIds((ids) => ids.filter((x) => !idsToRemove.has(x)));
    if (selectedTaskId && idsToRemove.has(selectedTaskId)) setSelectedTaskId(null);
    if (selectedProjectKey === key) setSelectedProjectKey(null);
    setOpenMenuId(null);
    setMenuPos(null);
    setOpenGroupMenuKey(null);
    setGroupMenuPos(null);
    notifyAssigneesOfProjectDeletion(group.tasks, approvedUsers, setConversations);
    idsToRemove.forEach((taskId) => {
      tasksApiFetch(`/tasks/${taskId}/`, { method: "DELETE" }).catch((err) => {
        console.error("Could not delete task on the backend:", err);
      });
    });
    // Same ghost-section fix as deleteTask above, just for the whole group
    // at once.
    pruneProjectCatalog(loadClientsForTaskSync());
    showToast("Project deactivated.", "error");
  };

  const progressOf = (t) => {
    if (t.subtasks.length) return Math.round((t.subtasks.filter((s) => s.done).length / t.subtasks.length) * 100);
    return t.progress ?? (t.status === "Completed" ? 100 : t.status === "Pending" ? 0 : 40);
  };

  // Aggregate stats for a project's grouped row in the "All Tasks" table —
  // the same three-state logic ("Not Started" / "In Progress" /
  // "Completed") the "By Projects" view already derives per project,
  // plus an average progress and the latest due date across all of that
  // project's modules.
  function projectAggregate(list) {
    const done = list.filter((t) => effectiveStatus(t) === "Completed").length;
    const avgProgress = list.length ? Math.round(list.reduce((sum, t) => sum + progressOf(t), 0) / list.length) : 0;
    const status = list.length === 0 || done === 0 ? "Not Started" : done === list.length ? "Completed" : "In Progress";
    const dueDate = list.reduce((latest, t) => (!latest || (t.dueDate && t.dueDate > latest) ? t.dueDate : latest), null);
    return { done, avgProgress, status, dueDate };
  }

  const tabDefs = [
    { key: "all", label: "All Tasks" },
    { key: "mine", label: "My Tasks" },
    { key: "projects", label: "By Projects" },
    { key: "calendar", label: "Calendar View" },
  ];

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-base font-bold ${cardText}`}>Tasks</h2>
          <p className={`text-xs mt-0.5 ${subtleText}`}>Assign, track and complete work across every project</p>
        </div>
        {canCreateTasks && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-full transition shrink-0"
          >
            <Plus className="w-4 h-4" /> Create Task
          </button>
        )}
      </div>

      {/* STATS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={ListChecks} iconBg="bg-violet-50" iconText="text-violet-600" label="Total Tasks" value={counts.total} delta="12%" up onClick={() => scrollToTaskList(null)} />
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={CheckCircle2} iconBg="bg-emerald-50" iconText="text-emerald-600" label="Completed" value={counts.completed} delta="15%" up onClick={() => scrollToTaskList("Completed")} />
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={Clock} iconBg="bg-blue-50" iconText="text-blue-600" label="In Progress" value={counts.inProgress} delta="8%" up onClick={() => scrollToTaskList("In Progress")} />
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={Hourglass} iconBg="bg-amber-50" iconText="text-amber-600" label="Pending" value={counts.pending} delta="5%" up={false} onClick={() => scrollToTaskList("Pending")} />
        <StatCard card={card} cardText={cardText} mutedText={mutedText} icon={AlertTriangle} iconBg="bg-rose-50" iconText="text-rose-600" label="Overdue" value={counts.overdue} delta="12%" up={false} onClick={() => scrollToTaskList("Overdue")} />
        <div
          onClick={() => {
            setView("mine");
            taskListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setView("mine");
              taskListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
          }}
          className={`rounded-2xl p-3.5 flex items-center justify-between gap-2 min-w-0 cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 ${card}`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-50 text-indigo-600">
              <UserCircle2 className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <p className={`text-[11px] truncate ${mutedText}`}>My Pending Tasks</p>
              <p className={`text-lg font-extrabold leading-tight ${cardText}`}>{counts.myPending}</p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setView("mine");
              taskListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="text-[10.5px] font-semibold text-violet-600 bg-violet-50 px-2 py-1.5 rounded-lg hover:bg-violet-100 transition shrink-0"
          >
            View
          </button>
        </div>
      </div>

      {/* CONTENT GRID */}
      <div className="grid lg:grid-cols-[1fr,360px] gap-4 items-start">
        {/* LEFT: table / views */}
        <div ref={taskListRef} className={`rounded-2xl overflow-hidden min-w-0 ${card}`}>
          {/* Tabs */}
          <div className={`flex items-center gap-1 px-4 pt-3 overflow-x-auto whitespace-nowrap border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
            {tabDefs.map((t) => (
              <button
                key={t.key}
                onClick={() => setView(t.key)}
                className={`px-3 py-2 text-sm font-semibold border-b-2 transition shrink-0 ${
                  view === t.key ? "text-violet-600 border-violet-600" : `${mutedText} border-transparent hover:text-violet-500`
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Filters */}
          {view !== "calendar" && (
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <Dropdown label="Project" value={projectFilter} options={["All Projects", ...projects]} onChange={setProjectFilter} inputCls={inputCls} />
              <Dropdown label="Assignee" value={assigneeFilter} options={assigneeOptions} onChange={setAssigneeFilter} inputCls={inputCls} />
              <Dropdown label="Priority" value={priorityFilter} options={["All Priorities", ...PRIORITIES]} onChange={setPriorityFilter} inputCls={inputCls} minWidth="min-w-[120px]" />

              <div className="relative">
                <button
                  onClick={() => setStatusFilterPanelOpen((v) => !v)}
                  className={`flex items-center gap-1.5 text-xs border rounded-lg px-3 py-1.5 ${inputCls} ${statusFilters.length ? "ring-2 ring-violet-400" : ""}`}
                >
                  <Filter className="w-3.5 h-3.5" /> Filter{statusFilters.length ? ` (${statusFilters.length})` : ""}
                </button>
                {statusFilterPanelOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setStatusFilterPanelOpen(false)} />
                    <div className={`absolute left-0 top-full mt-1.5 w-48 rounded-lg shadow-xl z-50 p-2 space-y-1 ${inputCls}`}>
                      <p className={`text-[10px] font-bold uppercase tracking-wide px-1.5 pb-1 ${subtleText}`}>Status</p>
                      {STATUSES.map((s) => (
                        <label key={s} className="flex items-center gap-2 px-1.5 py-1 rounded-md text-xs cursor-pointer hover:bg-violet-50 hover:text-violet-700">
                          <input
                            type="checkbox"
                            checked={statusFilters.includes(s)}
                            onChange={() =>
                              setStatusFilters((f) => (f.includes(s) ? f.filter((x) => x !== s) : [...f, s]))
                            }
                            className="rounded border-slate-300 accent-violet-600"
                          />
                          {s}
                        </label>
                      ))}
                      {statusFilters.length > 0 && (
                        <button onClick={() => setStatusFilters([])} className="w-full text-left text-[10.5px] text-rose-500 font-semibold px-1.5 pt-1">
                          Clear status filter
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="relative flex-1 min-w-[160px] ml-auto">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search tasks..."
                  className={`w-full text-sm border rounded-lg pl-9 pr-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
                />
              </div>
            </div>
          )}

          {/* ---------- Calendar view ---------- */}
          {view === "calendar" && (
            <CalendarView
              tasks={visibleTasks}
              calendarMonth={calendarMonth}
              setCalendarMonth={setCalendarMonth}
              onSelectTask={selectTask}
              darkMode={darkMode}
              card={card}
              cardText={cardText}
              mutedText={mutedText}
              subtleText={subtleText}
            />
          )}

          {/* ---------- By Projects view ---------- */}
          {view === "projects" && (
            <div className="p-4 space-y-3">
              {projectSections.map((sec) => {
                const projTasks = sec.tasks;
                const done = projTasks.filter((t) => effectiveStatus(t) === "Completed").length;
                const pct = projTasks.length ? Math.round((done / projTasks.length) * 100) : 0;
                // "Not Started" / "In Progress" / "Completed" — purely
                // derived from the tasks under this project, same three
                // states the reference design's pill uses.
                const projStatus = projTasks.length === 0 || done === 0 ? "Not Started" : done === projTasks.length ? "Completed" : "In Progress";
                const projStatusStyle =
                  projStatus === "Completed"
                    ? "bg-emerald-50 text-emerald-600"
                    : projStatus === "In Progress"
                    ? "bg-amber-50 text-amber-600"
                    : darkMode
                    ? "bg-slate-800 text-slate-400"
                    : "bg-slate-100 text-slate-500";
                const isCollapsed = !!collapsedProjects[sec.key];
                return (
                  <div key={sec.key} className={`rounded-xl border ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                    <button
                      type="button"
                      onClick={() => setCollapsedProjects((m) => ({ ...m, [sec.key]: !m[sec.key] }))}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                      aria-expanded={!isCollapsed}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${subtleText} ${isCollapsed ? "-rotate-90" : ""}`} />
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${projectIconStyle(sec.name)}`}>
                          <FolderKanban className="w-4 h-4" />
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`font-semibold text-sm truncate ${cardText}`}>{sec.name}</p>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${projStatusStyle}`}>{projStatus}</span>
                          </div>
                          {/* FIX (mixed-up projects): client name shown so two
                              different clients' identically-named projects
                              (e.g. both called "Website") render as two
                              clearly separate sections instead of merging. */}
                          {sec.clientName && <p className={`text-[10.5px] truncate ${subtleText}`}>{sec.clientName}</p>}
                        </div>
                      </div>
                    </button>

                    {!isCollapsed && (
                      <>
                        <div className="flex items-center gap-3 px-4 pb-3">
                          <span className={`text-[11px] font-semibold shrink-0 ${subtleText}`}>
                            {done}/{projTasks.length} tasks
                          </span>
                          <ProgressBarFill pct={pct} darkMode={darkMode} />
                          <span className={`text-[11px] font-semibold shrink-0 ${subtleText}`}>{pct}%</span>
                        </div>
                        <div className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-50"}`}>
                          {projTasks.length === 0 && <p className={`px-4 pb-3 text-xs ${subtleText}`}>No tasks match the current filters.</p>}
                          {projTasks.map((t) => {
                            const tDone = effectiveStatus(t) === "Completed";
                            return (
                              <div
                                key={t.id}
                                onClick={() => selectTask(t.id)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${rowHover} ${
                                  selectedTaskId === t.id ? (darkMode ? "bg-slate-800/70" : "bg-violet-50/50") : ""
                                }`}
                              >
                                <span
                                  className={`w-4 h-4 rounded shrink-0 flex items-center justify-center ${
                                    tDone ? "bg-violet-600" : darkMode ? "border border-slate-600" : "border border-slate-300"
                                  }`}
                                >
                                  {tDone && <Check className="w-3 h-3 text-white" />}
                                </span>
                                <span className={`text-xs font-medium truncate flex-1 ${tDone ? `line-through ${subtleText}` : cardText}`}>
                                  {t.title}
                                  {t.locked && <Lock className="inline-block w-3 h-3 ml-1.5 mb-0.5 text-slate-400" />}
                                </span>
                                <AssigneeStack names={getAssignees(t)} size="w-6 h-6" darkMode={darkMode} />
                                <InlineAttachButton
                                  label={t.title}
                                  attachments={t.attachments || []}
                                  rule={subtaskAttachmentRule(t.title)}
                                  taskId={t.id}
                                  onAdd={(attachment) => addTaskAttachment(t.id, attachment)}
                                  onRemove={(attachment) => removeTaskAttachment(t.id, attachment)}
                                  disabled={t.locked}
                                  darkMode={darkMode}
                                  cardText={cardText}
                                  subtleText={subtleText}
                                  inputCls={inputCls}
                                />
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ---------- All Tasks / My Tasks table ---------- */}
          {(view === "all" || view === "mine") && (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-auto max-h-[460px]">
                <table className="w-full min-w-[840px] text-sm">
                  <thead className="sticky top-0 z-10">
                    <tr className={`text-left text-xs ${mutedText} border-y ${darkMode ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-slate-50"}`}>
                      <th className="py-2.5 pl-5 pr-2 w-8">
                        <input type="checkbox" checked={allPagedSelected} onChange={toggleSelectAll} className="rounded border-slate-300 accent-violet-600" />
                      </th>
                      <th className="py-2.5 px-2 font-semibold">{isGroupedView ? "Project" : "Task"}</th>
                      {isGroupedView ? (
                        <th className="py-2.5 px-2 font-semibold">Modules</th>
                      ) : (
                        <th className="py-2.5 px-2 font-semibold">Project</th>
                      )}
                      <th className="py-2.5 px-2 font-semibold">Assignee(s)</th>
                      {!isGroupedView && <th className="py-2.5 px-2 font-semibold">Priority</th>}
                      <th className="py-2.5 px-2 font-semibold">Due Date</th>
                      <th className="py-2.5 px-2 font-semibold">Status</th>
                      <th className="py-2.5 px-2 font-semibold">Progress</th>
                      <th className="py-2.5 pr-5 pl-2 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
                    {isGroupedView &&
                      pagedGroups.map((g) => {
                        const agg = projectAggregate(g.tasks);
                        const groupSelected = g.tasks.length > 0 && g.tasks.every((t) => selectedIds.includes(t.id));
                        return (
                          <tr
                            key={g.key}
                            onClick={() => selectProjectGroup(g.key)}
                            className={`cursor-pointer transition-colors ${rowHover} ${
                              selectedProjectKey === g.key ? (darkMode ? "bg-slate-800/70" : "bg-violet-50/40") : ""
                            }`}
                          >
                            <td className="py-2.5 pl-5 pr-2" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={groupSelected}
                                onChange={() =>
                                  setSelectedIds((ids) =>
                                    groupSelected
                                      ? ids.filter((id) => !g.tasks.some((t) => t.id === id))
                                      : Array.from(new Set([...ids, ...g.tasks.map((t) => t.id)]))
                                  )
                                }
                                className="rounded border-slate-300 accent-violet-600"
                              />
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="flex items-center gap-2.5 min-w-[190px]">
                                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${projectIconStyle(g.project)}`}>
                                  <FolderKanban className="w-4 h-4" />
                                </span>
                                <div className="min-w-0">
                                  <p className={`font-semibold truncate ${cardText}`}>{g.project}</p>
                                  {/* FIX (mixed-up projects): shown so two different
                                      clients' identically-named projects (e.g. both
                                      called "Website") are still told apart at a
                                      glance instead of looking like one duplicate row. */}
                                  {g.clientName && <p className={`text-[10.5px] truncate ${subtleText}`}>{g.clientName}</p>}
                                </div>
                              </div>
                            </td>
                            <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>
                              {agg.done}/{g.tasks.length} modules
                            </td>
                            <td className="py-2.5 px-2">
                              <div className={`flex items-center gap-2 max-w-[170px] ${cardText}`}>
                                <ProjectAssigneeSummary tasks={g.tasks} darkMode={darkMode} />
                              </div>
                            </td>
                            <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{formatDate(agg.dueDate)}</td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                                  agg.status === "Completed"
                                    ? STATUS_STYLES.Completed
                                    : agg.status === "In Progress"
                                    ? STATUS_STYLES["In Progress"]
                                    : darkMode
                                    ? "bg-slate-800 text-slate-400"
                                    : "bg-slate-100 text-slate-500"
                                }`}
                              >
                                {agg.status}
                              </span>
                            </td>
                            <td className="py-2.5 px-2">
                              <ProgressBar value={agg.avgProgress} darkMode={darkMode} />
                            </td>
                            <td className="py-2.5 pr-5 pl-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => selectProjectGroup(g.key)}
                                className={`w-8 h-8 inline-flex items-center justify-center rounded-lg relative ${
                                  g.tasks.some((t) => t.attachments?.length) ? "text-violet-500" : mutedText
                                } ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                                aria-label="View project modules and attachments"
                                title="View modules — upload screenshots, videos, zips, or links"
                              >
                                <Paperclip className="w-4 h-4" />
                                {g.tasks.some((t) => t.attachments?.length) && (
                                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-500" />
                                )}
                              </button>
                              {/* FIX (no delete option for a whole project row): opens
                                  the same style of global fixed-position menu as the
                                  per-task rows below, but keyed by project group so
                                  "Delete" here removes every module at once. */}
                              <button
                                onClick={(e) => {
                                  if (openGroupMenuKey === g.key) {
                                    setOpenGroupMenuKey(null);
                                    setGroupMenuPos(null);
                                    return;
                                  }
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const left = Math.min(Math.max(8, rect.right - 176), window.innerWidth - 176 - 8);
                                  setGroupMenuPos({ top: rect.bottom + 4, left });
                                  setOpenGroupMenuKey(g.key);
                                }}
                                className={`w-8 h-8 inline-flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                                aria-label="Project actions"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    {!isGroupedView &&
                      pagedTasks.map((t) => {
                      const status = effectiveStatus(t);
                      const progress = progressOf(t);
                      return (
                        <tr
                          key={t.id}
                          onClick={() => selectTask(t.id)}
                          className={`cursor-pointer transition-colors ${rowHover} ${selectedTaskId === t.id ? (darkMode ? "bg-slate-800/70" : "bg-violet-50/40") : ""}`}
                        >
                          <td className="py-2.5 pl-5 pr-2" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelectRow(t.id)} className="rounded border-slate-300 accent-violet-600" />
                          </td>
                          <td className="py-2.5 px-2">
                            <div className="min-w-[190px] max-w-[240px]">
                              <p className={`font-semibold truncate ${cardText}`}>
                                {t.title}
                                {t.locked && <Lock className="inline-block w-3 h-3 ml-1.5 mb-0.5 text-slate-400" />}
                              </p>
                              <p className={`text-[11px] truncate ${subtleText}`}>{t.description}</p>
                            </div>
                          </td>
                          <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{t.project}</td>
                          <td className="py-2.5 px-2">
                            <div className={`flex items-center gap-2 max-w-[170px] ${cardText}`}>
                              <AssigneeStack names={getAssignees(t)} darkMode={darkMode} />
                            </div>
                          </td>
                          <td className="py-2.5 px-2">
                            <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
                          </td>
                          <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{formatDate(t.dueDate)}</td>
                          <td className="py-2.5 px-2">
                            <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLES[status]}`}>{status}</span>
                          </td>
                          <td className="py-2.5 px-2">
                            <ProgressBar value={progress} darkMode={darkMode} />
                          </td>
                          {/* FIX (3-dot menu): button now only records its own screen
                              position and opens the single global menu rendered at the
                              bottom of the page — the old inline `absolute` dropdown
                              here (which used to get clipped/misplaced by the table's
                              overflow-auto scroll container) has been removed. */}
                          <td className="py-2.5 pr-5 pl-2 text-right relative" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => selectTask(t.id)}
                              className={`w-8 h-8 inline-flex items-center justify-center rounded-lg relative ${
                                t.attachments?.length ? "text-violet-500" : mutedText
                              } ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                              aria-label="Attachments"
                              title={t.attachments?.length ? `${dedupeAttachments(t.attachments).length} attachment(s) — image, video, zip, or URL` : "Add image, video, zip, or URL"}
                            >
                              <Paperclip className="w-4 h-4" />
                              {t.attachments?.length > 0 && (
                                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-violet-500" />
                              )}
                            </button>
                            <button
                              onClick={(e) => {
                                if (openMenuId === t.id) {
                                  setOpenMenuId(null);
                                  setMenuPos(null);
                                  return;
                                }
                                const rect = e.currentTarget.getBoundingClientRect();
                                // Clamp so the 176px-wide menu (w-44) never renders
                                // off the left/right edge on narrower screens.
                                const left = Math.min(Math.max(8, rect.right - 176), window.innerWidth - 176 - 8);
                                setMenuPos({ top: rect.bottom + 4, left });
                                setOpenMenuId(t.id);
                              }}
                              className={`w-8 h-8 inline-flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                              aria-label="Task actions"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {(isGroupedView ? pagedGroups.length === 0 : pagedTasks.length === 0) && (
                      <tr>
                        <td colSpan={isGroupedView ? 8 : 9} className={`text-center py-12 text-sm ${subtleText}`}>
                          {view === "mine" ? "No tasks assigned to you yet." : isGroupedView ? "No projects match these filters." : "No tasks match these filters."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className={`md:hidden divide-y max-h-[520px] overflow-y-auto ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
                {isGroupedView &&
                  pagedGroups.map((g) => {
                    const agg = projectAggregate(g.tasks);
                    return (
                      <button
                        key={g.key}
                        onClick={() => selectProjectGroup(g.key)}
                        className={`w-full text-left p-4 transition-colors ${rowHover} ${
                          selectedProjectKey === g.key ? (darkMode ? "bg-slate-800/70" : "bg-violet-50/40") : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${projectIconStyle(g.project)}`}>
                              <FolderKanban className="w-3.5 h-3.5" />
                            </span>
                            <div className="min-w-0">
                              <p className={`font-semibold text-sm truncate ${cardText}`}>{g.project}</p>
                              {g.clientName && <p className={`text-[10px] truncate ${subtleText}`}>{g.clientName}</p>}
                            </div>
                          </div>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                              agg.status === "Completed"
                                ? STATUS_STYLES.Completed
                                : agg.status === "In Progress"
                                ? STATUS_STYLES["In Progress"]
                                : darkMode
                                ? "bg-slate-800 text-slate-400"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {agg.status}
                          </span>
                        </div>
                        <p className={`text-xs mb-2 ${subtleText}`}>
                          {agg.done}/{g.tasks.length} modules · Due {formatDate(agg.dueDate)}
                        </p>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <ProjectAssigneeSummary tasks={g.tasks} size="w-6 h-6" darkMode={darkMode} />
                          <span className={`flex items-center gap-1 text-[11px] ${g.tasks.some((t) => t.attachments?.length) ? "text-violet-500 font-semibold" : subtleText}`}>
                            <Paperclip className="w-3 h-3" /> {g.tasks.reduce((n, t) => n + dedupeAttachments(t.attachments).length, 0)}
                          </span>
                        </div>
                        <ProgressBar value={agg.avgProgress} darkMode={darkMode} />
                      </button>
                    );
                  })}
                {!isGroupedView &&
                  pagedTasks.map((t) => {
                  const status = effectiveStatus(t);
                  const progress = progressOf(t);
                  return (
                    <button
                      key={t.id}
                      onClick={() => selectTask(t.id)}
                      className={`w-full text-left p-4 transition-colors ${rowHover} ${selectedTaskId === t.id ? (darkMode ? "bg-slate-800/70" : "bg-violet-50/40") : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className={`font-semibold text-sm truncate ${cardText}`}>
                          {t.title}
                          {t.locked && <Lock className="inline-block w-3 h-3 ml-1.5 mb-0.5 text-slate-400" />}
                        </p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[status]}`}>{status}</span>
                      </div>
                      <p className={`text-xs truncate mb-2 ${subtleText}`}>{t.description}</p>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <div className={`flex items-center gap-1.5 min-w-0 text-xs ${mutedText}`}>
                          <AssigneeStack names={getAssignees(t)} size="w-6 h-6" darkMode={darkMode} />
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className={`text-[11px] ${subtleText}`}>{t.project}</span>
                        <span className={`flex items-center gap-1 text-[11px] ${t.attachments?.length ? "text-violet-500 font-semibold" : subtleText}`}>
                          <Paperclip className="w-3 h-3" /> {dedupeAttachments(t.attachments).length}
                        </span>
                        <span className={`text-[11px] ${subtleText}`}>Due {formatDate(t.dueDate)}</span>
                      </div>
                      <ProgressBar value={progress} darkMode={darkMode} />
                    </button>
                  );
                })}
                {(isGroupedView ? pagedGroups.length === 0 : pagedTasks.length === 0) && (
                  <p className={`text-center py-10 text-sm ${subtleText}`}>
                    {view === "mine" ? "No tasks assigned to you yet." : isGroupedView ? "No projects match these filters." : "No tasks match these filters."}
                  </p>
                )}
              </div>

              {/* Pagination */}
              <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t text-sm ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <p className={`text-xs ${subtleText}`}>
                  Showing {(isGroupedView ? groupedRows.length : filteredTasks.length) === 0 ? 0 : pageStart + 1} to{" "}
                  {Math.min(pageStart + rowsPerPage, isGroupedView ? groupedRows.length : filteredTasks.length)} of{" "}
                  {isGroupedView ? groupedRows.length : filteredTasks.length} {isGroupedView ? "projects" : "tasks"}
                </p>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`w-8 h-8 flex items-center justify-center rounded-lg border disabled:opacity-40 ${inputCls}`}>
                    ‹
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((p) => (
                    <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-semibold ${page === p ? "bg-violet-600 text-white" : inputCls}`}>
                      {p}
                    </button>
                  ))}
                  <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`w-8 h-8 flex items-center justify-center rounded-lg border disabled:opacity-40 ${inputCls}`}>
                    ›
                  </button>
                </div>
                <div className={`flex items-center gap-2 text-xs ${subtleText}`}>
                  Rows per page:
                  <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className={`border rounded-lg px-2 py-1 outline-none ${inputCls}`}>
                    {[10, 25, 50].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT: Task Details panel */}
        <div ref={taskDetailsRef} className={`rounded-2xl p-4 min-w-0 ${card} lg:sticky lg:top-4 scroll-mt-4`}>
          {selectedTask ? (
            <TaskDetails
              task={selectedTask}
              effectiveStatus={effectiveStatus(selectedTask)}
              progress={progressOf(selectedTask)}
              // Closing a module opened from a project row returns to that
              // project's module list instead of the empty placeholder,
              // since selectedProjectKey is left untouched here.
              onClose={() => setSelectedTaskId(null)}
              onToggleSubtask={(subId) => toggleSubtask(selectedTask.id, subId)}
              onMarkCompleted={() => setCompletingTaskId(selectedTask.id)}
              onDelete={() => deleteTask(selectedTask.id)}
              onEdit={() => setEditingTaskId(selectedTask.id)}
              onSaveRequirements={(text) => updateTask(selectedTask.id, { requirements: text })}
              onAddAttachment={(attachment) => addTaskAttachment(selectedTask.id, attachment)}
              onAddSubtaskAttachment={(subId, attachment) => addSubtaskAttachment(selectedTask.id, subId, attachment)}
              onRemoveAttachment={(attachment) => removeTaskAttachment(selectedTask.id, attachment)}
              onRemoveSubtaskAttachment={(subId, attachment) => removeSubtaskAttachment(selectedTask.id, subId, attachment)}
              canEdit={canEditTasks}
              canDelete={canDeleteTasks}
              darkMode={darkMode}
              cardText={cardText}
              mutedText={mutedText}
              subtleText={subtleText}
              inputCls={inputCls}
            />
          ) : isGroupedView && selectedProjectKey ? (
            <ProjectGroupDetails
              project={selectedProjectGroup?.project || selectedProjectKey}
              clientName={selectedProjectGroup?.clientName}
              tasks={selectedProjectTasks}
              effectiveStatus={effectiveStatus}
              progressOf={progressOf}
              onClose={() => setSelectedProjectKey(null)}
              onAddAttachment={(id, attachment) => addTaskAttachment(id, attachment)}
              onRemoveAttachment={(id, attachment) => removeTaskAttachment(id, attachment)}
              onRequestComplete={(id) => setCompletingTaskId(id)}
              onSaveRequirements={(id, text) => updateTask(id, { requirements: text })}
              onEditTask={(id) => setEditingTaskId(id)}
              onDeleteTask={(id) => deleteTask(id)}
              onDeleteProject={() => selectedProjectKey && deleteProjectGroup(selectedProjectKey)}
              canEdit={canEditTasks}
              canDelete={canDeleteTasks}
              deliverables={(selectedProjectKey && projectDeliverables[selectedProjectKey]) || []}
              onUploadDeliverable={(attachment) => selectedProjectKey && addProjectDeliverable(selectedProjectKey, attachment)}
              onRemoveDeliverable={(attachment, taskId) => selectedProjectKey && removeProjectDeliverable(selectedProjectKey, attachment, taskId)}
              darkMode={darkMode}
              cardText={cardText}
              mutedText={mutedText}
              subtleText={subtleText}
              inputCls={inputCls}
            />
          ) : (
            <div className="text-center py-10">
              <span className="w-12 h-12 rounded-xl bg-violet-50 text-violet-500 flex items-center justify-center mx-auto mb-3">
                <ListChecks className="w-5 h-5" />
              </span>
              <p className={`text-sm font-semibold ${cardText}`}>No task selected</p>
              <p className={`text-xs mt-1 ${subtleText}`}>Click any project or task in the list to see its details here.</p>
            </div>
          )}
        </div>
      </div>

      {/* FIX (3-dot menu): single global menu, positioned in fixed/screen
          coordinates from menuPos. Rendered once here instead of once per
          row, so it always sits exactly under the button that opened it
          and is never clipped by the scrolling table container. */}
      {openMenuId && menuPos && (() => {
        const t = tasks.find((x) => x.id === openMenuId);
        if (!t) return null;
        const status = effectiveStatus(t);
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setOpenMenuId(null);
                setMenuPos(null);
              }}
            />
            <div
              style={{ top: menuPos.top, left: menuPos.left }}
              className={`fixed z-50 w-44 rounded-xl shadow-lg py-1 text-left ${card}`}
            >
              <button
                onClick={() => {
                  selectTask(t.id);
                  setOpenMenuId(null);
                  setMenuPos(null);
                }}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}
              >
                <ListChecks className="w-3.5 h-3.5" /> View
              </button>
              {/* FIX (real edit): this used to also say "View / Edit" but
                  only ever selected the task into the read-only details
                  panel — there was no actual way to change a task's
                  title/project/assignees/priority/due date after
                  creating it. This now opens a real Edit Task modal —
                  gated by the real per-role "Edit" permission for Tasks. */}
              {canEditTasks && (
                <button
                  onClick={() => {
                    setEditingTaskId(t.id);
                    setOpenMenuId(null);
                    setMenuPos(null);
                  }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </button>
              )}
              {status !== "Completed" && (
                <button
                  onClick={() => {
                    setCompletingTaskId(t.id);
                    setOpenMenuId(null);
                    setMenuPos(null);
                  }}
                  className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-emerald-600 ${rowHover}`}
                >
                  <Check className="w-3.5 h-3.5" /> Mark Completed
                </button>
              )}
              {canDeleteTasks && (
                <button
                  onClick={() => deleteTask(t.id)}
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </button>
              )}
            </div>
          </>
        );
      })()}

      {/* FIX (no delete option for a whole project row): mirrors the
          per-task menu above, but for a grouped "All Tasks"/"My Tasks"
          project row — "Delete" here removes every module under that
          project in one go via deleteProjectGroup, instead of only
          being reachable one module at a time from inside the Project
          Details panel. */}
      {openGroupMenuKey && groupMenuPos && (() => {
        const g = groupedRows.find((x) => x.key === openGroupMenuKey);
        if (!g) return null;
        return (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => {
                setOpenGroupMenuKey(null);
                setGroupMenuPos(null);
              }}
            />
            <div
              style={{ top: groupMenuPos.top, left: groupMenuPos.left }}
              className={`fixed z-50 w-44 rounded-xl shadow-lg py-1 text-left ${card}`}
            >
              <button
                onClick={() => {
                  selectProjectGroup(g.key);
                  setOpenGroupMenuKey(null);
                  setGroupMenuPos(null);
                }}
                className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}
              >
                <ListChecks className="w-3.5 h-3.5" /> View
              </button>
              {canDeleteTasks && (
                <button
                  onClick={() => deleteProjectGroup(g.key)}
                  className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete Project
                </button>
              )}
            </div>
          </>
        );
      })()}

      {createOpen && (
        <CreateTaskModal
          onClose={() => setCreateOpen(false)}
          onCreate={(data) => {
            // FIX (duplicate row-select tick): `nextId()` restarts from 1000
            // on every page reload because `idCounter` is just an in-memory
            // module variable, while `tasks` is reloaded from localStorage
            // with its old, already-used ids. That let a freshly created
            // task end up sharing an id with an old task, so ticking one
            // row's checkbox (which matches by t.id) visually ticked both.
            // Deriving the new id from the current max id in `tasks` makes
            // every created task's id unique, reload or not.
            const newId = tasks.reduce((max, t) => Math.max(max, t.id), 1000) + 1;
            const moduleNames = data.roleTemplate && data.roleTemplate !== "Custom" ? ROLE_TASK_TEMPLATES[data.roleTemplate] : null;
            // FIX (100% reliable single-person-task -> Clients page zip
            // routing): resolve the picked client id (if any) to its
            // current name once here, and stamp both onto every task
            // created below — this is what lets a zip attached at
            // completion reach that exact client's project reliably,
            // instead of guessing off a matching project name.
            const pickedClient = data.clientId ? clientsForPicker.find((c) => c.id === data.clientId) : null;

            // FIX (role-based module generation): a role template
            // (Graphic Designer, Video Editor, ...) creates one task PER
            // module — same shape/pattern as syncClientModuleTasks uses
            // for a client's Frontend/Backend/Deployment breakdown — so
            // they group into a single project row with a modules count
            // and per-module progress in the "All Tasks" grouped view,
            // instead of one flat task with no breakdown.
            const createdList = moduleNames
              ? moduleNames.map((moduleName, i) => ({
                  id: newId + i,
                  title: moduleName,
                  description: data.description
                    ? `${data.description} — "${moduleName}" module for "${data.title}".`
                    : `"${moduleName}" module for "${data.title}".`,
                  project: data.project,
                  clientId: pickedClient?.id || null,
                  clientName: pickedClient?.name || null,
                  assignees: data.assignees,
                  priority: data.priority,
                  dueDate: data.dueDate,
                  status: "Pending",
                  createdBy: currentUserName || "Admin",
                  createdOn: new Date().toISOString().slice(0, 10),
                  attachment: "",
                  attachments: [],
                  requirements: data.requirements || "",
                  subtasks: [],
                  moduleName,
                  moduleProjectName: data.title,
                  roleTemplate: data.roleTemplate,
                  requiresLink: LINK_REQUIRED_MODULES.includes(moduleName),
                  // Every module carries the same reference images/brief
                  // PDF — shown in each module's Task Details, and sent
                  // once (not per-module) to Messages below.
                  sampleFiles: data.sampleFiles || [],
                }))
              : [
                  {
                    id: newId,
                    title: data.title,
                    description: data.description,
                    project: data.project,
                    clientId: pickedClient?.id || null,
                    clientName: pickedClient?.name || null,
                    // FIX (multi-assignee): a task can now go to up to 3 people.
                    // `assignees` is the real field going forward; getAssignees()
                    // handles reading old single-`assignee` tasks too.
                    assignees: data.assignees,
                    priority: data.priority,
                    dueDate: data.dueDate,
                    status: "Pending",
                    createdBy: currentUserName || "Admin",
                    createdOn: new Date().toISOString().slice(0, 10),
                    attachment: "",
                    requirements: data.requirements || "",
                    // Reference images / brief PDF attached at creation time —
                    // shown in Task Details and forwarded to the assignee's
                    // Messages thread (see notifyAssigneesOfTaskBatch below).
                    sampleFiles: data.sampleFiles || [],
                    subtasks: [],
                  },
                ];

            setTasks((list) => [...createdList, ...list]);
            setSelectedTaskId(createdList[0].id);
            setCreateOpen(false);
            flagTaskNotification(data.assignees);
            notifyAssigneesOfTaskBatch(data.assignees, createdList, approvedUsers, setConversations);
            showToast(
              createdList.length > 1
                ? `${createdList.length} modules assigned to ${data.assignees.join(", ")}.`
                : `Task assigned to ${data.assignees.join(", ")}.`,
              "success"
            );

            // Persist to the backend, then swap these locally-generated
            // ids for the real ones the backend assigned — everything
            // else (edit/delete/complete/toggle-subtask) matches on
            // t.id, so this keeps all of that working against the row
            // that's actually saved server-side.
            // sanitizeTaskForBackend: `pickedClient` here can come from the
            // same old-local-id client data the auto-sync functions read
            // (see that function's comment) — same "Incorrect type,
            // expected pk value, received str" risk if a client picked
            // here still only has a legacy string id.
            const persist = moduleNames
              ? tasksApiFetch("/tasks/bulk-create/", {
                  method: "POST",
                  body: JSON.stringify({ tasks: createdList.map(sanitizeTaskForBackend) }),
                })
              : tasksApiFetch("/tasks/", {
                  method: "POST",
                  body: JSON.stringify(sanitizeTaskForBackend(createdList[0])),
                }).then((saved) => [saved]);

            persist
              .then((saved) => {
                setTasks((list) =>
                  list.map((t) => {
                    const idx = createdList.findIndex((c) => c.id === t.id);
                    return idx !== -1 && saved[idx] ? mergeSavedTask(t, saved[idx]) : t;
                  })
                );
              })
              .catch((err) => {
                console.error("Could not save the new task(s) to the backend:", err);
                showToast(err.message || "Task created locally, but could not be saved to the backend.", "error");
              });
          }}
          assignableUsers={assignableUsers}
          projects={projects}
          onAddProject={addProject}
          clients={clientsForPicker}
          darkMode={darkMode}
        />
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          onClose={() => setEditingTaskId(null)}
          onSave={(patch) => {
            const prevAssignees = getAssignees(editingTask);
            const newlyAdded = (patch.assignees || []).filter((n) => !prevAssignees.includes(n));
            updateTask(editingTask.id, patch);
            setEditingTaskId(null);
            if (newlyAdded.length > 0) {
              flagTaskNotification(newlyAdded);
              notifyAssigneesOfTask(newlyAdded, patch, approvedUsers, setConversations);
            }
            showToast("Task updated.", "success");
          }}
          assignableUsers={assignableUsers}
          projects={projects}
          onAddProject={addProject}
          clients={clientsForPicker}
          darkMode={darkMode}
        />
      )}

      {completingTask && (
        <MarkCompleteModal
          task={completingTask}
          onClose={() => setCompletingTaskId(null)}
          onConfirm={(link, newAttachments) => {
            markCompleted(completingTask.id, link, newAttachments);
            setCompletingTaskId(null);
          }}
          darkMode={darkMode}
        />
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-white ${t.tone === "error" ? "bg-rose-600" : "bg-emerald-600"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ======================================================================
   TASK DETAILS PANEL
====================================================================== */

/* ----------------------------------------------------------------------
   REQUIREMENTS & FEATURES SECTION (inside Task Details)
   An editable, saveable spec area so an assignee can always see exactly
   what needs to be built, separate from the short one-line description.
   Starts read-only (or with an "Add" prompt if empty) and switches to an
   editable textarea + Save/Cancel on click.
---------------------------------------------------------------------- */
function RequirementsSection({ task, onSave, darkMode, cardText, subtleText, inputCls }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.requirements || "");

  // Keep the draft in sync if a different task gets selected while this
  // panel stays mounted.
  useEffect(() => {
    setDraft(task.requirements || "");
    setEditing(false);
  }, [task.id]);

  const save = () => {
    onSave(draft.trim());
    setEditing(false);
  };

  return (
    <div className={`rounded-xl p-3 mb-4 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
      <div className="flex items-center justify-between mb-1.5">
        <p className={`text-xs font-bold ${cardText}`}>Requirements & Features</p>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-[10.5px] font-semibold text-violet-600 hover:text-violet-700">
            {task.requirements ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="List the features, requirements, or acceptance criteria for this task so it's clear exactly what to build..."
            className={`w-full text-xs border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                setDraft(task.requirements || "");
                setEditing(false);
              }}
              className={`flex-1 border text-xs font-semibold py-1.5 rounded-lg ${inputCls}`}
            >
              Cancel
            </button>
            <button onClick={save} className="flex-1 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold py-1.5 rounded-lg">
              Save
            </button>
          </div>
        </>
      ) : task.requirements ? (
        <p className={`text-xs whitespace-pre-wrap leading-relaxed ${cardText}`}>{task.requirements}</p>
      ) : (
        <p className={`text-xs ${subtleText}`}>No requirements added yet — click Add to spell out what needs to be built.</p>
      )}
    </div>
  );
}

/* ======================================================================
   PROJECT GROUP DETAILS
   NEW: the right-hand panel that opens when a project row is clicked in
   the grouped "All Tasks" view. "All Tasks" used to show every module
   (UI/UX Design, Frontend, Backend, API Integration, Testing,
   Deployment...) as its own separate row even though they all belong to
   the same project — now the table shows one row per PROJECT, and this
   panel is where all of that project's modules actually live.

   Each module row can be expanded (chevron) to reveal the exact same
   full details TaskDetails used to show on its own — description,
   requirements, assignee(s)/priority/due date/created by/on/task ID, and
   the full attachments list — plus a tick checkbox. Ticking a module
   that isn't completed opens the same "Mark as Completed" flow used
   everywhere else in this file (`onRequestComplete` -> `setCompletingTaskId`
   -> the existing CompletingTaskModal -> `markCompleted()`), which is
   exactly what already calls `syncModuleStatusToClientsStorage()` — so a
   tick here shows up completed on the Clients page automatically, and
   any screenshot/video/zip/link attached (here or via the completion
   modal) is written into the same client record the Client Portal reads
   from, with zero extra plumbing needed.
====================================================================== */
function ProjectGroupDetails({
  project,
  clientName,
  tasks,
  effectiveStatus,
  progressOf,
  onClose,
  onAddAttachment,
  onRemoveAttachment,
  onRequestComplete,
  onSaveRequirements,
  onEditTask,
  onDeleteTask,
  onDeleteProject,
  canEdit = true,
  canDelete = true,
  deliverables = [],
  onUploadDeliverable,
  onRemoveDeliverable,
  darkMode,
  cardText,
  mutedText,
  subtleText,
  inputCls,
}) {
  const done = tasks.filter((t) => effectiveStatus(t) === "Completed").length;
  const avgProgress = tasks.length ? Math.round(tasks.reduce((sum, t) => sum + progressOf(t), 0) / tasks.length) : 0;
  // FIX (one consistent Task Details design for every role): a module row
  // used to navigate you away into a completely separate TaskDetails panel
  // (a different `selectedTaskId`, fighting with `selectedProjectKey` — see
  // the FIX notes on selectTask/selectProjectGroup above). This is THE
  // module-checklist panel now — the design the person actually wants both
  // admin and employee to see — so a row just expands in place instead,
  // pulling in the fields that used to only live on that other panel
  // (Requirements & Features, Created By/On, Task ID, Edit/Delete).
  const [expandedId, setExpandedId] = useState(null);
  // Once every module is completed the project as a whole is "done" — this
  // is where a final packaged deliverable (a single zip of the finished
  // work) can be handed over, separate from any one module's own proof of
  // work above.
  const allDone = tasks.length > 0 && done === tasks.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-bold text-sm ${cardText}`}>Project Details</h3>
        <div className="flex items-center gap-1">
          {/* FIX (no delete option for a whole project row): previously
              the only delete action anywhere in this panel was per-module
              (see canDelete && onDeleteTask below) — there was no way to
              remove the entire project (every module) in one action,
              including here on mobile where the grouped table row's own
              3-dot menu isn't reachable. */}
          {canDelete && onDeleteProject && (
            <button
              onClick={onDeleteProject}
              title="Delete this entire project (all modules)"
              className={`w-7 h-7 flex items-center justify-center rounded-lg text-rose-500 hover:text-rose-600 ${darkMode ? "hover:bg-slate-800" : "hover:bg-rose-50"}`}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button onClick={onClose} className={`w-7 h-7 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"} ${subtleText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 mb-3">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${projectIconStyle(project)}`}>
          <FolderKanban className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`font-bold text-sm truncate ${cardText}`}>{project}</p>
          {/* FIX (mixed-up projects): the client this project belongs to,
              so two different clients' identically-named projects are
              never mistaken for each other in this panel either. */}
          {clientName && <p className={`text-[11px] mt-0.5 truncate ${subtleText}`}>{clientName}</p>}
          <p className={`text-[11px] mt-0.5 ${subtleText}`}>
            {done}/{tasks.length} modules completed
          </p>
        </div>
      </div>

      <ProgressBar value={avgProgress} darkMode={darkMode} />

      <div className={`rounded-xl p-3 mt-4 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
        <p className={`text-xs font-bold mb-2 ${cardText}`}>Modules</p>
        <div className="space-y-2 max-h-[600px] overflow-y-auto pr-0.5">
          {/* FIX (modules showed newest-first / backwards): these are
              always fetched from the backend, whose default Task
              ordering is newest-id-first (see tasks/models.py) — right
              for a general task inbox, but backwards for one project's
              own module checklist, which was created UI/UX Design ->
              ... -> Deployment (ascending ids) and should always read in
              that same order regardless of how the parent list happened
              to be sorted when it was fetched. */}
          {[...tasks].sort((a, b) => a.id - b.id).map((t) => {
            const tStatus = effectiveStatus(t);
            const tDone = tStatus === "Completed";
            const isExpanded = expandedId === t.id;
            return (
              <div key={t.id} className={`rounded-lg ${darkMode ? "bg-slate-900/60" : "bg-white"}`}>
                <div className="flex items-center gap-2 px-2.5 pt-2">
                  {/* Tick to mark this module completed — same flow (and
                      same Clients-page/Portal sync) as everywhere else in
                      Tasks. Already-completed modules stay locked, same
                      as the checklist inside a single task's own details
                      panel. */}
                  <button
                    type="button"
                    disabled={tDone}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!tDone) onRequestComplete(t.id);
                    }}
                    title={tDone ? "Completed" : "Mark this module completed"}
                    aria-label={tDone ? "Completed" : `Mark ${t.title} completed`}
                    className={`w-4 h-4 rounded shrink-0 flex items-center justify-center disabled:cursor-default ${
                      tDone ? "bg-violet-600" : darkMode ? "border border-slate-600 hover:border-violet-400" : "border border-slate-300 hover:border-violet-400"
                    }`}
                  >
                    {tDone && <Check className="w-3 h-3 text-white" />}
                  </button>
                  {/* Expands in place — this IS the details panel now, not a
                      link to a different one. */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : t.id)}
                    className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                    title={isExpanded ? "Collapse" : "Show full details"}
                    aria-expanded={isExpanded}
                  >
                    <span className={`text-xs font-semibold truncate flex-1 ${tDone ? `line-through ${subtleText}` : cardText}`}>
                      {t.title}
                      {t.locked && <Lock className="inline-block w-3 h-3 ml-1.5 mb-0.5 text-slate-400" />}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${subtleText} ${isExpanded ? "" : "-rotate-90"}`} />
                  </button>
                  <span className={`text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_STYLES[tStatus]}`}>{tStatus}</span>
                </div>

                <div className="flex items-center justify-between gap-2 mt-1.5 px-2.5 pl-9">
                  <AssigneeStack names={getAssignees(t)} size="w-5 h-5" darkMode={darkMode} />
                  <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1.5 px-2.5 pl-9 pb-2">
                  <span className={`text-[10.5px] ${subtleText}`}>Due {formatDate(t.dueDate)}</span>
                  {/* Same InlineAttachButton the "By Projects" view already
                      uses — every module here allows image/video/zip/link
                      per its own subtaskAttachmentRule(), and every upload
                      is synced straight to the Clients page/Portal by
                      addTaskAttachment already. */}
                  <InlineAttachButton
                    label={t.title}
                    attachments={t.attachments || []}
                    rule={subtaskAttachmentRule(t.title)}
                    taskId={t.id}
                    onAdd={(attachment) => onAddAttachment(t.id, attachment)}
                    onRemove={onRemoveAttachment ? (attachment) => onRemoveAttachment(t.id, attachment) : undefined}
                    disabled={t.locked}
                    darkMode={darkMode}
                    cardText={cardText}
                    subtleText={subtleText}
                    inputCls={inputCls}
                  />
                </div>

                {/* NEW: everything that used to only exist on the separate
                    TaskDetails panel, merged straight into this module row
                    — description, Requirements & Features, Client/Created
                    By/On/Task ID, and Edit/Delete — so this one panel is now
                    the complete picture for both admin and employee. */}
                {isExpanded && (
                  <div className={`mx-2.5 mb-2.5 pt-2.5 border-t ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                    {t.description && <p className={`text-[11px] mb-2.5 leading-relaxed ${mutedText}`}>{t.description}</p>}

                    <RequirementsSection
                      task={t}
                      onSave={(text) => onSaveRequirements(t.id, text)}
                      darkMode={darkMode}
                      cardText={cardText}
                      subtleText={subtleText}
                      inputCls={inputCls}
                    />

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] mb-3">
                      {clientName && (
                        <div className="col-span-2 flex items-center gap-1.5">
                          <Building2 className={`w-3 h-3 shrink-0 ${subtleText}`} />
                          <span className={subtleText}>Client</span>
                          <span className={`font-semibold truncate ${cardText}`}>{clientName}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-1.5">
                        <UserCircle2 className={`w-3 h-3 shrink-0 ${subtleText}`} />
                        <span className={subtleText}>By</span>
                        <span className={`font-semibold truncate ${cardText}`}>{t.createdBy || "—"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CalendarIcon className={`w-3 h-3 shrink-0 ${subtleText}`} />
                        <span className={subtleText}>On</span>
                        <span className={`font-semibold truncate ${cardText}`}>{formatDate(t.createdOn)}</span>
                      </div>
                      <div className="col-span-2 flex items-center gap-1.5">
                        <ListChecks className={`w-3 h-3 shrink-0 ${subtleText}`} />
                        <span className={subtleText}>Task ID</span>
                        <span className={`font-semibold ${cardText}`}>#TSK-{pad4(t.id)}</span>
                      </div>
                    </div>

                    {(canEdit || canDelete) && (
                      <div className="flex items-center gap-3">
                        {canEdit && onEditTask && (
                          <button
                            onClick={() => onEditTask(t.id)}
                            className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                          >
                            <Pencil className="w-3 h-3" /> Edit
                          </button>
                        )}
                        {canDelete && onDeleteTask && (
                          <button
                            onClick={() => onDeleteTask(t.id)}
                            className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-500 hover:text-rose-600"
                          >
                            <Trash2 className="w-3 h-3" /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {tasks.length === 0 && <p className={`text-xs ${subtleText}`}>No modules match the current filters.</p>}
        </div>
      </div>

      {/* NEW: once every module above is completed, the project itself can
          take one final packaged deliverable (a zip of the finished work) —
          separate from any single module's own proof of work. */}
      {allDone && onUploadDeliverable && (
        <FinalDeliverableUpload
          deliverables={deliverables}
          onUpload={onUploadDeliverable}
          onRemove={onRemoveDeliverable ? (d) => onRemoveDeliverable(d, tasks[0]?.id) : undefined}
          // TaskZipFile (backend) is per-Task, not per-project — the
          // final deliverable belongs to the project as a whole, so it's
          // attached to this group's first module task. No new backend
          // model/migration needed for that.
          taskId={tasks[0]?.id}
          darkMode={darkMode}
          cardText={cardText}
          subtleText={subtleText}
          mutedText={mutedText}
          inputCls={inputCls}
        />
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------
   FINAL DELIVERABLE (ZIP) UPLOAD

   Shown at the bottom of the Project Details panel only once every module
   in the project is completed — this is the one place to hand over the
   final packaged zip for the whole project, separate from the per-module
   proof-of-work attachments above. Restricted to archive files specifically
   (not images/video/links), since this is meant to be the final build/
   source handoff, not another screenshot.
---------------------------------------------------------------------- */
const ZIP_ACCEPT = ".zip,.rar,.7z,application/zip,application/x-zip-compressed,application/x-7z-compressed,application/x-rar-compressed";

function FinalDeliverableUpload({ deliverables, onUpload, onRemove, taskId, darkMode, cardText, subtleText, mutedText, inputCls }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // NEW: delete a final-deliverable zip (inline "Delete? / Cancel" confirm,
  // same control every other attachment on this page uses).
  const [confirmKey, setConfirmKey] = useState(null);
  const [removingKey, setRemovingKey] = useState(null);

  const removeDeliverable = async (d) => {
    if (!onRemove) return;
    setRemovingKey(attachmentKey(d));
    setError("");
    try {
      await onRemove(d);
      setConfirmKey(null);
    } catch (e) {
      setError(e.message || "Could not delete this zip.");
    } finally {
      setRemovingKey(null);
    }
  };

  const addFile = async (file) => {
    setBusy(true);
    setError("");
    try {
      const name = (file.name || "").toLowerCase();
      if (detectAttachmentKind(file) !== "zip" && !/\.(zip|rar|7z)$/.test(name)) {
        throw new Error("Please upload a zip (or .rar/.7z) archive of the final project.");
      }
      if (!taskId) {
        throw new Error("Could not find a module to attach this deliverable to.");
      }
      // FIX: this used to base64-encode the zip and save it to
      // localStorage only — it never reached the backend/database, and
      // silently failed for anything over the 5MB base64 cap. Now the
      // real bytes go to the backend's TaskZipFile storage (disk +
      // Postgres metadata), the same place the Zip Files admin page
      // reads from.
      const uploaded = await tasksApiUploadZip(taskId, file, { final: true });
      onUpload({
        id: genAttachmentId(),
        type: "zip",
        name: uploaded.fileName || file.name,
        url: uploaded.downloadUrl,
        zipFileId: uploaded.id,
        uploadedAt: uploaded.uploadedOn || new Date().toISOString(),
      });
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl p-3 mt-4 border-2 border-dashed ${darkMode ? "border-emerald-800 bg-emerald-950/20" : "border-emerald-200 bg-emerald-50/60"}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <p className={`text-xs font-bold ${cardText}`}>All modules completed — upload final deliverable</p>
      </div>
      <p className={`text-[10.5px] mb-2.5 ${mutedText}`}>Package the finished project as a single zip file and upload it here to hand it over.</p>

      {deliverables.length > 0 && (
        <div className="space-y-1.5 mb-2.5">
          {deliverables.map((d) => (
            <div key={d.id} className={`flex items-center gap-2.5 rounded-lg border p-2 ${darkMode ? "border-slate-700 bg-slate-900/60" : "border-slate-200 bg-white"}`}>
              <span className="w-8 h-8 rounded-md bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Archive className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold truncate ${cardText}`}>{d.name}</p>
                <p className={`text-[10px] ${subtleText}`}>Uploaded {formatDate((d.uploadedAt || "").slice(0, 10))}</p>
              </div>
              <a
                href={d.url}
                download={d.name}
                className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800"
                title="Download this file"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
              {onRemove && (
                <AttachmentDeleteControl
                  confirming={confirmKey === attachmentKey(d)}
                  removing={removingKey === attachmentKey(d)}
                  onAsk={() => setConfirmKey(attachmentKey(d))}
                  onConfirm={() => removeDeliverable(d)}
                  onCancel={() => setConfirmKey(null)}
                  darkMode={darkMode}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <label className={`flex items-center justify-center gap-2 w-full text-xs font-semibold py-2.5 rounded-lg border cursor-pointer ${inputCls}`}>
        <Upload className="w-4 h-4" />
        {busy ? "Uploading…" : deliverables.length > 0 ? "Upload another zip" : "Upload zip file"}
        <input
          type="file"
          accept={ZIP_ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addFile(file);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="text-[11px] mt-1.5 text-rose-500">{error}</p>}
    </div>
  );
}

function TaskDetails({
  task,
  effectiveStatus,
  progress,
  onClose,
  onToggleSubtask,
  onMarkCompleted,
  onDelete,
  onEdit,
  onSaveRequirements,
  onAddAttachment,
  onAddSubtaskAttachment,
  onRemoveAttachment,
  onRemoveSubtaskAttachment,
  canEdit: canEditTask = true,
  canDelete: canDeleteTask = true,
  darkMode,
  cardText,
  mutedText,
  subtleText,
  inputCls,
}) {
  const isCompleted = task.status === "Completed";
  const doneCount = task.subtasks.filter((s) => s.done).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-bold text-sm ${cardText}`}>Task Details</h3>
        <div className="flex items-center gap-1">
          {canEditTask && (
            <button
              onClick={onEdit}
              className={`w-7 h-7 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"} ${subtleText}`}
              aria-label="Edit task"
              title="Edit task"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={onClose} className={`w-7 h-7 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"} ${subtleText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-start gap-3 mb-3">
        <span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
          <ListChecks className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`font-bold text-sm ${cardText}`}>{task.title}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[effectiveStatus]}`}>{effectiveStatus}</span>
            {task.locked && (
              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                <Lock className="w-3 h-3" /> Locked
              </span>
            )}
            {task.requiresLink && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-600" title="A real URL must be attached before this can be marked complete">
                Link required
              </span>
            )}
          </div>
          <p className={`text-[11px] mt-0.5 ${subtleText}`}>{task.project}</p>
        </div>
      </div>

      <p className={`text-xs mb-4 ${mutedText}`}>{task.description}</p>

      {task.locked && (
        <div className="rounded-xl p-3 mb-4 flex items-start gap-2.5 bg-slate-100 text-slate-600">
          <Lock className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold">Locked</p>
            <p className="text-[10.5px] mt-0.5">
              Waiting on the client to request this module and staff to accept that request — see it under that client's Requests on the Clients page.
              You'll be notified here the moment it unlocks.
            </p>
          </div>
        </div>
      )}

      <RequirementsSection
        task={task}
        onSave={onSaveRequirements}
        darkMode={darkMode}
        cardText={cardText}
        subtleText={subtleText}
        inputCls={inputCls}
      />

      {/* FIX (reference files visible in Task Details): sample images /
          brief PDF attached at task creation (see SampleFilesField) are
          also sent to Messages, but should be reachable here too — for
          both admin and the assignee — without having to dig through
          chat history. Read-only: editing these happens from Edit Task. */}
      {task.sampleFiles && task.sampleFiles.length > 0 && (
        <div className={`rounded-xl p-3 mb-4 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
          <p className={`text-xs font-bold mb-2 ${cardText}`}>Reference Files</p>
          <div className="space-y-2">
            {task.sampleFiles.map((f) => (
              <div key={f.id} className={`flex items-center gap-2.5 rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                {f.type === "image" ? (
                  <img src={f.url} alt={f.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
                ) : (
                  <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-semibold truncate ${cardText}`}>{f.name}</p>
                  <p className={`text-[10.5px] ${subtleText}`}>{f.type === "pdf" ? "PDF brief" : "Reference image"}</p>
                </div>
                <a
                  href={f.url}
                  download={f.name}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                  title="Download this file"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2.5 text-xs mb-4">
        {/* FIX (complete task details): Module + Project + Client used to
            be missing from this panel — Project only ever showed up as a
            small subtitle under the title, and Module/Client didn't show
            at all. Module/Client only exist for tasks generated from a
            client's project checklist (fromClientModule); a manually
            created task shows "—" for both since it isn't tied to a
            client project. */}
        <div className="flex items-center gap-2.5">
          <FolderKanban className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Module</span>
          <span className={`font-semibold ${cardText}`}>{task.moduleName || "—"}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <FolderKanban className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Project</span>
          <span className={`font-semibold ${cardText}`}>{task.project || "—"}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <Building2 className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Client</span>
          <span className={`font-semibold ${cardText}`}>{task.clientName || "—"}</span>
        </div>
        <div className="flex items-start gap-2.5">
          <UserCircle2 className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>
            {getAssignees(task).length > 1 ? "Assignees" : "Assignee"}
          </span>
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            {getAssignees(task).map((name) => (
              <span key={name} className="flex items-center gap-1.5">
                <Avatar name={name} size="w-5 h-5" />
                <span className={`font-semibold truncate ${cardText}`}>{name}</span>
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Flag className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Priority</span>
          <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <CalendarIcon className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Due Date</span>
          <span className={`font-semibold ${cardText}`}>{formatDate(task.dueDate)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <UserCircle2 className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Created By</span>
          <span className={`font-semibold ${cardText}`}>{task.createdBy}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <CalendarIcon className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Created On</span>
          <span className={`font-semibold ${cardText}`}>{formatDate(task.createdOn)}</span>
        </div>
        <div className="flex items-center gap-2.5">
          <ListChecks className={`w-3.5 h-3.5 shrink-0 ${subtleText}`} />
          <span className={`w-16 shrink-0 ${subtleText}`}>Task ID</span>
          <span className={`font-semibold ${cardText}`}>#TSK-{pad4(task.id)}</span>
        </div>
      </div>

      {task.subtasks.length > 0 && (
        <div className={`rounded-xl p-3 mb-4 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
          <div className="flex items-center justify-between mb-2">
            <p className={`text-xs font-bold ${cardText}`}>
              Sub Tasks ({doneCount}/{task.subtasks.length})
            </p>
            <span className={`text-[10.5px] font-semibold ${subtleText}`}>{progress}%</span>
          </div>
          <div className="space-y-1.5 mb-2">
            {task.subtasks.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer group min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={s.done}
                    disabled={isCompleted}
                    onChange={() => onToggleSubtask(s.id)}
                    className="rounded border-slate-300 accent-emerald-600 disabled:opacity-60 shrink-0"
                  />
                  <span className={`text-xs truncate ${s.done ? `line-through ${subtleText}` : cardText}`}>{s.text}</span>
                </label>
                <SubtaskAttachButton
                  subtask={s}
                  taskId={task.id}
                  disabled={isCompleted}
                  onAdd={(attachment) => onAddSubtaskAttachment && onAddSubtaskAttachment(s.id, attachment)}
                  onRemove={onRemoveSubtaskAttachment ? (attachment) => onRemoveSubtaskAttachment(s.id, attachment) : undefined}
                  darkMode={darkMode}
                  cardText={cardText}
                  subtleText={subtleText}
                  inputCls={inputCls}
                />
              </div>
            ))}
          </div>
          <ProgressBar value={progress} darkMode={darkMode} />
        </div>
      )}

      <TaskAttachmentsSection
        task={task}
        onAddAttachment={onAddAttachment}
        onRemoveAttachment={onRemoveAttachment}
        darkMode={darkMode}
        cardText={cardText}
        subtleText={subtleText}
        mutedText={mutedText}
        inputCls={inputCls}
      />

      {!isCompleted && !task.locked && (
        <div className="mb-4">
          <p className={`text-xs font-bold mb-1.5 ${cardText}`}>Mark as Completed</p>
          <p className={`text-[10.5px] mb-2 ${subtleText}`}>
            {task.requiresLink
              ? "You'll be asked to attach a real link (URL) to the finished work — required for this module."
              : "You'll be asked to attach a screenshot, video, or link of the finished work."}
          </p>
          <button
            onClick={onMarkCompleted}
            className="w-full flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            <Check className="w-4 h-4" /> Mark as Completed
          </button>
        </div>
      )}

      {isCompleted && (
        <div className="mb-4 rounded-xl p-3 bg-emerald-50 text-emerald-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <p className="text-xs font-semibold">This task is completed.</p>
          </div>
          {task.attachment ? (
            isUrl(task.attachment) ? (
              <a
                href={task.attachment}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold underline decoration-emerald-400 break-all hover:text-emerald-800"
              >
                <Paperclip className="w-3.5 h-3.5 shrink-0" /> Open submitted work ↗
              </a>
            ) : (
              <p className="mt-2 flex items-center gap-1.5 text-xs">
                <Paperclip className="w-3.5 h-3.5 shrink-0" /> {task.attachment}
              </p>
            )
          ) : (
            <p className="mt-2 text-xs opacity-80">No work link was attached.</p>
          )}
        </div>
      )}

      <div className={`rounded-xl p-3 flex items-start gap-2.5 ${darkMode ? "bg-slate-800/60" : "bg-violet-50/60"}`}>
        <Bell className="w-4 h-4 text-violet-500 shrink-0 mt-0.5" />
        <div>
          <p className={`text-xs font-bold ${cardText}`}>Admin Notification</p>
          <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>When you mark this task as completed, admin will be notified automatically.</p>
        </div>
      </div>

      {canDeleteTask && (
        <button onClick={onDelete} className="w-full mt-3 flex items-center justify-center gap-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 py-2">
          <Trash2 className="w-3.5 h-3.5" /> Delete this task
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------
   TASK ATTACHMENTS — screenshot / video upload + link, available any
   time (not just at completion). Every addition is handed to
   `onAddAttachment`, which (for a module task) also writes straight into
   the client's project checklist so it shows up on the Clients page and
   the Client Portal immediately.
---------------------------------------------------------------------- */

// NEW — the small trash icon next to an uploaded file / zip / URL. First click
// turns it into an inline "Delete? / Cancel" confirm (no extra modal), second
// click on "Delete?" actually deletes.
function AttachmentDeleteControl({ confirming, removing, onAsk, onConfirm, onCancel, darkMode }) {
  if (confirming) {
    return (
      <span className="shrink-0 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={removing}
          className="text-[10.5px] font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
        >
          {removing ? "Deleting…" : "Delete?"}
        </button>
        {!removing && (
          <button
            type="button"
            onClick={onCancel}
            className={`text-[10.5px] font-semibold hover:opacity-80 ${darkMode ? "text-slate-400" : "text-slate-500"}`}
          >
            Cancel
          </button>
        )}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onAsk}
      title="Delete this attachment"
      aria-label="Delete this attachment"
      className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-rose-500 hover:text-rose-600 ${darkMode ? "hover:bg-slate-800" : "hover:bg-rose-50"}`}
    >
      <Trash2 className="w-3.5 h-3.5" />
    </button>
  );
}

function TaskAttachmentsSection({ task, onAddAttachment, onRemoveAttachment, darkMode, cardText, subtleText, mutedText, inputCls }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState(null);
  const [removingKey, setRemovingKey] = useState(null);
  const attachments = dedupeAttachments(task.attachments);
  const locked = !!task.locked;

  const removeAttachment = async (a) => {
    if (!onRemoveAttachment) return;
    setRemovingKey(attachmentKey(a));
    setError("");
    try {
      await onRemoveAttachment(a);
      setConfirmKey(null);
    } catch (e) {
      setError(e.message || "Could not delete this attachment.");
    } finally {
      setRemovingKey(null);
    }
  };

  const addLink = () => {
    if (locked) return;
    const trimmed = link.trim();
    if (!trimmed) return;
    if (!onAddAttachment) return;
    onAddAttachment({ id: genAttachmentId(), type: "link", name: trimmed, url: trimmed, uploadedAt: new Date().toISOString() });
    setLink("");
    setError("");
  };

  const addFile = async (file) => {
    if (locked || !file || !onAddAttachment) return;
    setBusy(true);
    setError("");
    try {
      const type = detectAttachmentKind(file);
      if (type === "zip") {
        // FIX: zip proof-of-work used to be base64-encoded straight into
        // the task's `attachments` JSON column (5MB hard cap, no real
        // file on disk). Route it through the backend's TaskZipFile
        // storage instead — same endpoint the final deliverable now uses.
        const uploaded = await tasksApiUploadZip(task.id, file);
        onAddAttachment({
          id: genAttachmentId(),
          type: "zip",
          name: uploaded.fileName || file.name,
          url: uploaded.downloadUrl,
          zipFileId: uploaded.id,
          uploadedAt: uploaded.uploadedOn || new Date().toISOString(),
        });
      } else if (task.id && task.moduleBackendId) {
        // FIX (cross-browser ModuleFile): when the task has a real backend
        // ID and a linked Module, upload the file to upload-file-attachment
        // which creates a ModuleFile row. The returned HTTP URL is stored
        // directly on the attachment entry so ClientPortal can download it
        // from any browser without needing this browser's IndexedDB.
        const updatedTask = await clientsApi.uploadTaskFileAttachment(task.id, file);
        // The backend returns the full updated task — find the last attachment
        // it appended (the one we just uploaded, with a real HTTP url).
        const backendAttachments = updatedTask?.attachments || [];
        const newEntry = backendAttachments[backendAttachments.length - 1];
        onAddAttachment(newEntry || { id: genAttachmentId(), type, name: file.name, uploadedAt: new Date().toISOString() });
      } else {
        // Fallback: no linked module — store as base64 data URL in task JSON.
        // This preserves all existing behaviour for tasks that aren't module-
        // linked (regular tasks, tasks created before this fix).
        const dataUrl = await readFileAsDataUrl(file);
        onAddAttachment({ id: genAttachmentId(), type, name: file.name, url: dataUrl, uploadedAt: new Date().toISOString() });
      }
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`rounded-xl p-3 mb-4 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
      <p className={`text-xs font-bold mb-2 ${cardText}`}>Attachments</p>

      {attachments.length > 0 && (
        <div className="space-y-2 mb-3">
          {attachments.map((a) => (
            <div key={a.id} className={`flex items-center gap-2.5 rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {a.type === "image" ? (
                <img src={a.url} alt={a.name} className="w-10 h-10 rounded-md object-cover shrink-0" />
              ) : a.type === "video" ? (
                <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                  <Video className="w-4 h-4" />
                </span>
              ) : a.type === "zip" ? (
                <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                  <Archive className="w-4 h-4" />
                </span>
              ) : a.type === "link" ? (
                <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                  <Link2 className="w-4 h-4" />
                </span>
              ) : (
                <span className="w-10 h-10 rounded-md bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                  <FileIcon className="w-4 h-4" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold truncate ${cardText}`}>{a.name}</p>
                <p className={`text-[10.5px] capitalize ${subtleText}`}>{a.type}</p>
              </div>
              {a.type === "link" ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                >
                  Open ↗
                </a>
              ) : (
                <a
                  href={a.url}
                  download={a.name}
                  className="shrink-0 flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-700"
                  title="Download this file"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </a>
              )}
              {onRemoveAttachment && !locked && (
                <AttachmentDeleteControl
                  confirming={confirmKey === attachmentKey(a)}
                  removing={removingKey === attachmentKey(a)}
                  onAsk={() => setConfirmKey(attachmentKey(a))}
                  onConfirm={() => removeAttachment(a)}
                  onCancel={() => setConfirmKey(null)}
                  darkMode={darkMode}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {attachments.length === 0 && <p className={`text-[11px] mb-3 ${subtleText}`}>Nothing uploaded yet.</p>}

      {locked ? (
        <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${subtleText}`}>
          <Lock className="w-3.5 h-3.5 shrink-0" /> Locked until the client's request to start this module is accepted.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addLink()}
              placeholder="Paste a link (https://...)"
              className={`flex-1 min-w-0 text-xs border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
            />
            <button
              type="button"
              onClick={addLink}
              disabled={!link.trim()}
              className="shrink-0 text-[11px] font-semibold px-2.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white"
            >
              Add
            </button>
            <label className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-lg border cursor-pointer ${inputCls}`} title="Upload screenshot, video, or zip file">
              <Upload className="w-4 h-4" />
              <input
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {busy && <p className={`text-[11px] mt-1.5 ${subtleText}`}>Uploading…</p>}
          {error && <p className="text-[11px] mt-1.5 text-rose-500">{error}</p>}
          <p className={`text-[10.5px] mt-1.5 ${mutedText}`}>Images, videos, or zip files up to 5MB — or just paste a link.</p>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------
   PER-SUB-TASK ATTACH BUTTON

   The small paperclip next to each checklist row (matches the reference
   design). Clicking it opens a compact popover scoped to that one
   sub-task, offering only the attachment kind(s) its
   subtaskAttachmentRule() allows — e.g. "UI/UX Design" only offers an
   image upload, "Frontend" requires a link and optionally a video. The
   paperclip fills in solid once at least one attachment exists, so it
   doubles as an at-a-glance "has proof attached" indicator.
---------------------------------------------------------------------- */
// Thin wrapper kept for the sub-task checklist inside Task Details — see
// InlineAttachButton below for the actual implementation, now shared
// with the per-project checklist cards in the "By Projects" view.
function SubtaskAttachButton({ subtask, taskId, disabled, onAdd, onRemove, darkMode, cardText, subtleText, inputCls }) {
  return (
    <InlineAttachButton
      label={subtask.text}
      attachments={subtask.attachments || []}
      rule={subtaskAttachmentRule(subtask.text)}
      taskId={taskId}
      disabled={disabled}
      onAdd={onAdd}
      onRemove={onRemove}
      darkMode={darkMode}
      cardText={cardText}
      subtleText={subtleText}
      inputCls={inputCls}
    />
  );
}

function InlineAttachButton({ label, attachments: rawAttachments, rule, taskId, disabled, onAdd, onRemove, darkMode, cardText, subtleText, inputCls }) {
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmKey, setConfirmKey] = useState(null);
  const [removingKey, setRemovingKey] = useState(null);
  const attachments = dedupeAttachments(rawAttachments);
  const hasAttachments = attachments.length > 0;

  const removeAttachment = async (a) => {
    if (!onRemove) return;
    setRemovingKey(attachmentKey(a));
    setError("");
    try {
      await onRemove(a);
      setConfirmKey(null);
    } catch (e) {
      setError(e.message || "Could not delete this attachment.");
    } finally {
      setRemovingKey(null);
    }
  };

  const addLink = () => {
    const trimmed = link.trim();
    if (!trimmed || !onAdd) return;
    if (!isUrl(trimmed)) {
      setError("This needs to be a real URL (starting with http:// or https://).");
      return;
    }
    onAdd({ id: genAttachmentId(), type: "link", name: trimmed, url: trimmed, uploadedAt: new Date().toISOString() });
    setLink("");
    setError("");
  };

  const addFile = async (file) => {
    if (!file || !onAdd) return;
    setBusy(true);
    setError("");
    try {
      const type = detectAttachmentKind(file);
      if (type === "zip" && taskId) {
        // FIX: route real backend disk storage instead of base64-into-JSON.
        const uploaded = await tasksApiUploadZip(taskId, file);
        onAdd({
          id: genAttachmentId(),
          type: "zip",
          name: uploaded.fileName || file.name,
          url: uploaded.downloadUrl,
          zipFileId: uploaded.id,
          uploadedAt: uploaded.uploadedOn || new Date().toISOString(),
        });
      } else {
        const dataUrl = await readFileAsDataUrl(file);
        onAdd({ id: genAttachmentId(), type, name: file.name, url: dataUrl, uploadedAt: new Date().toISOString() });
      }
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={hasAttachments ? `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : rule.hint}
        aria-label={`Attachments for ${label}`}
        className={`w-7 h-7 flex items-center justify-center rounded-lg border transition disabled:opacity-40 ${
          hasAttachments
            ? "bg-violet-600 border-violet-600 text-white"
            : darkMode
            ? "border-slate-700 text-slate-400 hover:bg-slate-800"
            : "border-slate-200 text-slate-400 hover:bg-slate-50"
        }`}
      >
        <Paperclip className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className={`absolute right-0 z-20 mt-1.5 w-64 rounded-xl border p-3 shadow-xl ${darkMode ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200"}`}
        >
          <div className="flex items-center justify-between mb-2">
            <p className={`text-[11px] font-bold truncate ${cardText}`}>{label}</p>
            <button onClick={() => setOpen(false)} className={`w-5 h-5 flex items-center justify-center rounded ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
              <X className="w-3 h-3" />
            </button>
          </div>

          {attachments.length > 0 && (
            <div className="space-y-1.5 mb-2 max-h-28 overflow-y-auto">
              {attachments.map((a) => (
                <div
                  key={a.id ?? attachmentKey(a)}
                  className={`flex items-center gap-1 rounded-lg border pr-1 ${darkMode ? "border-slate-700" : "border-slate-200"}`}
                >
                  <a
                    href={a.url}
                    {...(a.type === "link" ? { target: "_blank", rel: "noopener noreferrer" } : { download: a.name })}
                    title={a.type === "link" ? "Open link" : "Download this file"}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-[10.5px] px-2 py-1.5 hover:opacity-80"
                  >
                    {a.type === "image" ? (
                      <ImageIcon className="w-3 h-3 shrink-0 text-violet-500" />
                    ) : a.type === "video" ? (
                      <Video className="w-3 h-3 shrink-0 text-violet-500" />
                    ) : a.type === "link" ? (
                      <Link2 className="w-3 h-3 shrink-0 text-violet-500" />
                    ) : (
                      <FileIcon className="w-3 h-3 shrink-0 text-violet-500" />
                    )}
                    <span className={`truncate flex-1 ${cardText}`}>{a.name}</span>
                  </a>
                  {onRemove && (
                    <AttachmentDeleteControl
                      confirming={confirmKey === attachmentKey(a)}
                      removing={removingKey === attachmentKey(a)}
                      onAsk={() => setConfirmKey(attachmentKey(a))}
                      onConfirm={() => removeAttachment(a)}
                      onCancel={() => setConfirmKey(null)}
                      darkMode={darkMode}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {!disabled && (
            <>
              {rule.allowLink && (
                <div className="flex items-center gap-1.5 mb-1.5">
                  <input
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addLink()}
                    placeholder="Paste URL"
                    className={`flex-1 min-w-0 text-[11px] border rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                  />
                  <button
                    type="button"
                    onClick={addLink}
                    disabled={!link.trim()}
                    className="shrink-0 text-[10.5px] font-semibold px-2 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white"
                  >
                    Add
                  </button>
                </div>
              )}
              {rule.allowFile && (
                <label className={`flex items-center justify-center gap-1.5 text-[10.5px] font-semibold border rounded-lg py-1.5 cursor-pointer ${inputCls}`}>
                  <Upload className="w-3 h-3" /> {busy ? "Uploading…" : "Upload file"}
                  <input
                    type="file"
                    accept={rule.accept}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) addFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
              <p className={`text-[10px] mt-1.5 ${subtleText}`}>{rule.hint}</p>
              {error && <p className="text-[10px] mt-1 text-rose-500">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ======================================================================
   CALENDAR VIEW
====================================================================== */

function CalendarView({ tasks, calendarMonth, setCalendarMonth, onSelectTask, darkMode, cardText, mutedText, subtleText }) {
  const { year, month } = calendarMonth;
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const tasksByDay = useMemo(() => {
    const map = {};
    tasks.forEach((t) => {
      if (!t.dueDate) return;
      const d = new Date(t.dueDate + "T00:00:00");
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        map[day] = map[day] || [];
        map[day].push(t);
      }
    });
    return map;
  }, [tasks, year, month]);

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const today = new Date();
  const isToday = (d) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

  const goMonth = (delta) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setCalendarMonth({ year: y, month: m });
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <p className={`font-bold text-sm ${cardText}`}>{monthLabel}</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => goMonth(-1)} className={`w-7 h-7 flex items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"}`}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => goMonth(1)} className={`w-7 h-7 flex items-center justify-center rounded-lg border ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"}`}>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className={`text-center text-[10px] font-semibold py-1 ${subtleText}`}>
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const dayTasks = d ? tasksByDay[d] || [] : [];
          // FIX ("calendar view mein khali boxes show hote hain"): every
          // in-month day used to get the same filled box background
          // whether or not it actually had a task on it, so a month with
          // only a couple of due dates rendered as a wall of identical
          // gray boxes with nothing inside most of them. Only a day that
          // actually has a task (or is today) gets the filled box now — an
          // empty day still shows its date number, just without the box
          // around it, so it reads as genuinely empty instead of looking
          // like a card waiting to be filled in.
          const hasTasks = dayTasks.length > 0;
          return (
            <div
              key={i}
              className={`min-h-[64px] rounded-lg p-1 text-left ${
                d ? (isToday(d) ? "ring-2 ring-violet-400" : hasTasks ? (darkMode ? "bg-slate-800/50" : "bg-slate-50") : "") : ""
              }`}
            >
              {d && (
                <>
                  <p className={`text-[10px] font-semibold mb-1 ${isToday(d) ? "text-violet-600" : mutedText}`}>{d}</p>
                  <div className="space-y-0.5">
                    {dayTasks.slice(0, 2).map((t) => (
                      <button
                        key={t.id}
                        onClick={() => onSelectTask(t.id)}
                        className={`w-full text-left text-[9px] font-medium truncate px-1 py-0.5 rounded ${PRIORITY_STYLES[t.priority]}`}
                        title={t.title}
                      >
                        {t.title}
                      </button>
                    ))}
                    {dayTasks.length > 2 && <p className={`text-[9px] ${subtleText}`}>+{dayTasks.length - 2} more</p>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ======================================================================
   CREATE TASK MODAL
====================================================================== */

/* FIX (multiple assignees, up to 3): a checkbox-style dropdown used by
   both Create and Edit task forms so a task can be given to more than
   one person instead of only ever having a single assignee. */
function MultiAssigneeSelect({ users, selected, onChange, max = 3, inputCls, darkMode }) {
  const [open, setOpen] = useState(false);

  const toggle = (name) => {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      if (selected.length >= max) return;
      onChange([...selected, name]);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-2 text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}
      >
        <span className="truncate text-left">
          {selected.length === 0 ? "Select up to 3 people" : selected.join(", ")}
        </span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 top-full mt-1.5 w-full min-w-[200px] rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto ${
              darkMode ? "bg-slate-800 border border-slate-700" : "bg-white border border-slate-200"
            }`}
          >
            {users.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No approved users yet</p>}
            {users.map((u) => {
              const checked = selected.includes(u.name);
              const disabled = !checked && selected.length >= max;
              return (
                <label
                  key={u.name}
                  className={`flex items-center gap-2 px-3 py-2 text-xs ${
                    disabled ? "opacity-40 cursor-not-allowed" : `cursor-pointer ${darkMode ? "hover:bg-slate-700" : "hover:bg-violet-50"}`
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(u.name)}
                    className="rounded border-slate-300 accent-violet-600"
                  />
                  <span className={darkMode ? "text-slate-200" : "text-slate-700"}>{u.name}</span>
                </label>
              );
            })}
          </div>
        </>
      )}
      <p className={`text-[10px] mt-1 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
        {selected.length}/{max} selected
      </p>
    </div>
  );
}

/* FIX (single assignee + searchable): replaces the old "pick up to 3
   people from a checkbox list" flow with a single-person, type-to-search
   field — typing filters the people list live, each match shows their
   role/department next to their name, and picking one closes the list.
   `selected`/`onChange` still use the same array shape (`["Name"]` or
   `[]`) as before, just capped at one entry, so every other part of the
   file that reads assignees via getAssignees() keeps working unchanged. */
function AssigneeSearchSelect({ users, selected, onChange, inputCls, darkMode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedUser = users.find((u) => u.name === selected[0]) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.name.toLowerCase().includes(q) || (u.role || "").toLowerCase().includes(q));
  }, [users, query]);

  const pick = (u) => {
    onChange([u.name]);
    setQuery("");
    setOpen(false);
  };

  const clear = (e) => {
    e.stopPropagation();
    onChange([]);
    setQuery("");
  };

  const badge = darkMode ? "bg-slate-700 text-slate-300" : "bg-slate-100 text-slate-500";

  return (
    <div className="relative">
      <div className={`w-full flex items-center gap-2 text-sm border rounded-lg px-2.5 py-2 ${inputCls}`}>
        {selectedUser && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="flex-1 flex items-center justify-between gap-2 text-left min-w-0">
            <span className="flex items-center gap-1.5 min-w-0">
              <Avatar name={selectedUser.name} size="w-5 h-5" />
              <span className="truncate">{selectedUser.name}</span>
              <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge}`}>{selectedUser.role}</span>
            </span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          </button>
        ) : (
          <input
            autoFocus={open}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Type a name or role..."
            className="flex-1 min-w-0 bg-transparent outline-none py-0.5"
          />
        )}
        {selectedUser && (
          <button type="button" onClick={clear} title="Clear" className="shrink-0 text-slate-400 hover:text-rose-500">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 top-full mt-1.5 w-full min-w-[220px] rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto ${
              darkMode ? "bg-slate-800 border border-slate-700" : "bg-white border border-slate-200"
            }`}
          >
            {filtered.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No matching people</p>}
            {filtered.map((u) => (
              <button
                type="button"
                key={u.name}
                onClick={() => pick(u)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-xs text-left ${
                  darkMode ? "hover:bg-slate-700" : "hover:bg-violet-50"
                } ${u.name === selected[0] ? (darkMode ? "bg-slate-700/60" : "bg-violet-50") : ""}`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Avatar name={u.name} size="w-5 h-5" />
                  <span className={`truncate ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{u.name}</span>
                </span>
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${badge}`}>{u.role}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


/* FIX (type-to-search project field): replaces the old "pick from a
   <select>, or click '+ New module' to reveal a separate text box" flow
   with a single combobox — typing live-filters existing projects, and if
   what's typed doesn't match anything, an "Add ... as new project" option
   appears right in the same list so a brand-new project/module can be
   created without ever leaving this field. Same props/contract as before
   (`value`/`onChange`/`onAddProject`), so both Create and Edit task forms
   below needed no changes to use it. */
// FIX (100% reliable single-person-task -> Clients page zip routing):
// lets Create Task / Edit Task explicitly tag a task with a real client
// from ClientsPage's own list, instead of relying on the task's project
// name happening to match one of that client's projects. "— No client /
// Internal —" is the default, same as a Company Project on the Projects
// page — nothing forces every task to belong to a client.
function ClientPickerField({ clients, value, onChange, inputCls }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 mb-1 block">Client (optional)</label>
      <select
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}
      >
        <option value="">— No client / Internal —</option>
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProjectFieldWithAdd({ projects, value, onChange, onAddProject, inputCls, darkMode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.toLowerCase().includes(q));
  }, [projects, query]);

  const exactMatch = projects.some((p) => p.toLowerCase() === query.trim().toLowerCase());

  const pick = (p) => {
    onChange(p);
    setQuery("");
    setOpen(false);
  };

  const addNew = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const ok = onAddProject(trimmed);
    if (ok) {
      onChange(trimmed);
      setQuery("");
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <label className="text-xs font-semibold text-slate-500 mb-1 block">Project</label>
      <div className={`w-full flex items-center gap-2 text-sm border rounded-lg px-2.5 py-2 ${inputCls}`}>
        {value && !open ? (
          <button type="button" onClick={() => setOpen(true)} className="flex-1 flex items-center justify-between gap-2 text-left min-w-0">
            <span className="truncate">{value}</span>
            <ChevronDown className="w-3.5 h-3.5 shrink-0" />
          </button>
        ) : (
          <input
            autoFocus={open}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (exactMatch) pick(projects.find((p) => p.toLowerCase() === query.trim().toLowerCase()));
                else addNew();
              }
            }}
            placeholder="Type to search or add a project..."
            className="flex-1 min-w-0 bg-transparent outline-none py-0.5"
          />
        )}
      </div>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute left-0 top-full mt-1.5 w-full min-w-[220px] rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto ${
              darkMode ? "bg-slate-800 border border-slate-700" : "bg-white border border-slate-200"
            }`}
          >
            {/* Defensive: only ever render string project names, even if
                something upstream slips through with a bad value. */}
            {filtered
              .filter((p) => typeof p === "string" && p)
              .map((p) => (
                <button
                  type="button"
                  key={p}
                  onClick={() => pick(p)}
                  className={`w-full flex items-center px-3 py-2 text-xs text-left truncate ${
                    darkMode ? "hover:bg-slate-700 text-slate-200" : "hover:bg-violet-50 text-slate-700"
                  } ${p === value ? (darkMode ? "bg-slate-700/60" : "bg-violet-50") : ""}`}
                >
                  {p}
                </button>
              ))}
            {query.trim() && !exactMatch && (
              <button
                type="button"
                onClick={addNew}
                className={`w-full flex items-center gap-1.5 px-3 py-2 text-xs text-left font-semibold text-violet-600 border-t ${
                  darkMode ? "border-slate-700 hover:bg-slate-700" : "border-slate-100 hover:bg-violet-50"
                }`}
              >
                <Plus className="w-3.5 h-3.5 shrink-0" /> Add "{query.trim()}" as new project
              </button>
            )}
            {filtered.length === 0 && !query.trim() && <p className="px-3 py-2 text-xs text-slate-400">No projects yet</p>}
          </div>
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------------
   SAMPLE / REFERENCE FILES (images + PDF brief) — Create/Edit Task

   FIX (reference files at task-creation time): admin previously had no
   way to hand over reference material (a logo sample, banner mockup, a
   PDF brief/spec sheet, etc.) while creating a task — only the assignee
   could attach files, and only once the task was finished. This lets
   admin attach one or more images and/or a PDF right on the Create/Edit
   Task form; they're saved on the task as `task.sampleFiles` and (for a
   brand-new task) also forwarded straight into the assignee's Messages
   thread by notifyAssigneesOfTask(), so a graphic-design/video-editing
   task etc. can ship with its reference images or brief attached to the
   very message that tells the assignee about it.
---------------------------------------------------------------------- */
const SAMPLE_FILE_ACCEPT = "image/*,application/pdf";

function SampleFilesField({ files, onChange, darkMode, inputCls }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const addFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const isImage = file.type?.startsWith("image/");
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
      if (!isImage && !isPdf) {
        throw new Error("Only images or a PDF are allowed here.");
      }
      const dataUrl = await readFileAsDataUrl(file);
      onChange([
        ...files,
        { id: genAttachmentId(), type: isPdf ? "pdf" : "image", name: file.name, url: dataUrl, uploadedAt: new Date().toISOString() },
      ]);
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 mb-1 block">Sample images / brief PDF (optional)</label>
      <p className={`text-[10.5px] mb-1.5 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>
        e.g. logo/banner references for a design task, or a PDF brief — sent straight to the assignee in Messages.
      </p>
      {files.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {files.map((f) => (
            <div key={f.id} className={`flex items-center gap-2 text-[11px] rounded-lg border px-2 py-1.5 ${inputCls}`}>
              {f.type === "pdf" ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <ImageIcon className="w-3.5 h-3.5 shrink-0" />}
              <span className="truncate flex-1">{f.name}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((x) => x.id !== f.id))}
                className="shrink-0 text-rose-500 hover:text-rose-600 font-semibold"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <label className={`flex items-center justify-center gap-2 w-full text-xs font-semibold py-2.5 rounded-lg border cursor-pointer ${inputCls}`}>
        <Upload className="w-4 h-4" />
        {busy ? "Uploading…" : "Upload image or PDF"}
        <input
          type="file"
          accept={SAMPLE_FILE_ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) addFile(file);
            e.target.value = "";
          }}
        />
      </label>
      {error && <p className="text-[11px] mt-1.5 text-rose-500">{error}</p>}
    </div>
  );
}

function CreateTaskModal({ onClose, onCreate, assignableUsers, projects, onAddProject, clients = [], darkMode }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    requirements: "",
    project: projects[0] || "",
    clientId: "",
    assignees: assignableUsers[0] ? [assignableUsers[0].name] : [],
    priority: "Medium",
    dueDate: isoDaysFromNow(7),
    sampleFiles: [],
    // FIX (role-based module generation): "Custom" keeps the previous
    // single-task behavior; picking a role (Graphic Designer, Video
    // Editor, ...) instead generates one task per module for that role —
    // see ROLE_TASK_TEMPLATES.
    roleTemplate: "Custom",
  });
  const canSubmit = form.title.trim() && form.assignees.length > 0 && form.dueDate;
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Create Task</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Task title{form.roleTemplate !== "Custom" ? " / Project focus" : ""}</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Design checkout page"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Task type</label>
            <select
              value={form.roleTemplate}
              onChange={(e) => setForm((f) => ({ ...f, roleTemplate: e.target.value }))}
              className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}
            >
              <option value="Custom">Custom (single task)</option>
              {ROLE_TEMPLATE_NAMES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            {/* FIX (graphic design / video editing / other roles): picking a
                role here generates one module task per item below — same
                as a client's Frontend/Backend/Deployment breakdown — so
                the sidebar's "All Tasks" grouped view shows this project
                with a modules count + progress bar right away. */}
            {form.roleTemplate !== "Custom" && (
              <div className={`mt-1.5 rounded-lg px-2.5 py-2 text-[11px] ${darkMode ? "bg-slate-800 text-slate-400" : "bg-violet-50 text-violet-700"}`}>
                Will create {ROLE_TASK_TEMPLATES[form.roleTemplate].length} module tasks: {ROLE_TASK_TEMPLATES[form.roleTemplate].join(", ")}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What needs to be done..."
              rows={2}
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Requirements & Features (optional)</label>
            <textarea
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              placeholder="Spell out exactly what needs to be built — features, requirements, acceptance criteria..."
              rows={3}
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ProjectFieldWithAdd
              projects={projects}
              value={form.project}
              onChange={(v) => setForm((f) => ({ ...f, project: v }))}
              onAddProject={onAddProject}
              inputCls={inputCls}
              darkMode={darkMode}
            />
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <ClientPickerField
            clients={clients}
            value={form.clientId}
            onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            inputCls={inputCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Assignee</label>
              <AssigneeSearchSelect
                users={assignableUsers}
                selected={form.assignees}
                onChange={(v) => setForm({ ...form, assignees: v })}
                inputCls={inputCls}
                darkMode={darkMode}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Due date</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`} />
            </div>
          </div>
          <SampleFilesField
            files={form.sampleFiles}
            onChange={(v) => setForm((f) => ({ ...f, sampleFiles: v }))}
            darkMode={darkMode}
            inputCls={inputCls}
          />
          <p className={`text-xs rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-400"}`}>
            {form.roleTemplate === "Custom"
              ? <>Everyone assigned will see this task under <b>My Tasks</b> and can tick it off once it's done.</>
              : <>Everyone assigned will see all {ROLE_TASK_TEMPLATES[form.roleTemplate].length} modules under <b>My Tasks</b>, each with its own progress and attachments.</>}
          </p>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>
            Cancel
          </button>
          <button disabled={!canSubmit} onClick={() => onCreate(form)} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            {form.roleTemplate === "Custom" ? "Create Task" : `Create ${ROLE_TASK_TEMPLATES[form.roleTemplate].length} Modules`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   MARK AS COMPLETED MODAL
   Shown the moment "Mark as Completed" is clicked (from the details panel
   or the 3-dot menu) — asks for a link to the finished work so it's
   attached and openable right from the task, instead of a silent status
   flip with nothing to show for it.
====================================================================== */

function MarkCompleteModal({ task, onClose, onConfirm, darkMode }) {
  const [link, setLink] = useState(task.attachment || "");
  const [pendingFiles, setPendingFiles] = useState([]); // [{id,type,name,url}]
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";
  const requiresLink = !!task.requiresLink;
  // A module that requires a link (Frontend/Backend/Deployment) can only
  // be completed with a real, openable URL — a bare file name doesn't
  // count. Every other module just needs *something* attached: a real
  // link, or at least one uploaded screenshot/video.
  const canSubmit = requiresLink ? isUrl(link) : link.trim().length > 0 || pendingFiles.length > 0;

  const addFile = async (file) => {
    setBusy(true);
    setError("");
    try {
      const type = detectAttachmentKind(file);
      if (type === "zip") {
        const uploaded = await tasksApiUploadZip(task.id, file);
        setPendingFiles((list) => [
          ...list,
          {
            id: genAttachmentId(),
            type: "zip",
            name: uploaded.fileName || file.name,
            url: uploaded.downloadUrl,
            zipFileId: uploaded.id,
            uploadedAt: uploaded.uploadedOn || new Date().toISOString(),
          },
        ]);
      } else {
        const dataUrl = await readFileAsDataUrl(file);
        setPendingFiles((list) => [...list, { id: genAttachmentId(), type, name: file.name, url: dataUrl, uploadedAt: new Date().toISOString() }]);
      }
    } catch (e) {
      setError(e.message || "Could not upload file.");
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    const trimmedLink = link.trim();
    const attachments = [...pendingFiles];
    if (trimmedLink && isUrl(trimmedLink)) {
      attachments.push({ id: genAttachmentId(), type: "link", name: trimmedLink, url: trimmedLink, uploadedAt: new Date().toISOString() });
    }
    onConfirm(trimmedLink, attachments);
  };

  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-sm p-6 shadow-2xl ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-bold">Mark as Completed</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg shrink-0 ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-xs font-semibold mb-3 truncate ${darkMode ? "text-slate-300" : "text-slate-600"}`}>{task.title}</p>
        <p className={`text-xs mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
          {requiresLink
            ? "A real link (URL) is required for this module — paste the live/deployed link below."
            : "Attach a link, and/or upload a screenshot, video, or zip file of the finished work."}
        </p>
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) submit();
            }}
            placeholder="Paste Google Drive / deployed link (https://...)"
            className={`flex-1 min-w-0 text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
          />
          {!requiresLink && (
            <label className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-lg border cursor-pointer ${inputCls}`} title="Upload a screenshot, video, or zip file">
              <Upload className="w-4 h-4" />
              <input
                type="file"
                accept={ATTACHMENT_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) addFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
        {requiresLink && link.trim() && !isUrl(link) && (
          <p className="text-[11px] mt-1.5 text-rose-500">This needs to be a real URL (starting with http:// or https://) — a file name isn't enough for this module.</p>
        )}
        {pendingFiles.length > 0 && (
          <div className="mt-2.5 space-y-1.5">
            {pendingFiles.map((f) => (
              <div key={f.id} className={`flex items-center gap-2 text-[11px] rounded-lg border px-2 py-1.5 ${inputCls}`}>
                {f.type === "image" ? (
                  <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                ) : f.type === "video" ? (
                  <Video className="w-3.5 h-3.5 shrink-0" />
                ) : f.type === "zip" ? (
                  <Archive className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <FileIcon className="w-3.5 h-3.5 shrink-0" />
                )}
                <span className="truncate flex-1">{f.name}</span>
                <button
                  type="button"
                  onClick={async () => {
                    // A zip was already uploaded to the server the moment it
                    // was picked — delete it there too, or "Remove" would
                    // leave an orphan file behind.
                    if (f.type === "zip" && f.zipFileId != null) {
                      try {
                        await tasksApiRemoveAttachment(task.id, f, { moduleId: resolveTaskModuleBackendId(task) });
                      } catch (err) {
                        if (!/not found/i.test(err?.message || "")) {
                          setError(err.message || "Could not delete this zip.");
                          return;
                        }
                      }
                    }
                    setPendingFiles((list) => list.filter((x) => x.id !== f.id));
                  }}
                  className="shrink-0 text-rose-500 hover:text-rose-600 font-semibold"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        {busy && <p className={`text-[11px] mt-1.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>Uploading…</p>}
        {error && <p className="text-[11px] mt-1.5 text-rose-500">{error}</p>}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={submit}
            className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            <Check className="w-4 h-4" /> Mark Completed
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   EDIT TASK MODAL
   FIX (real edit + "increase duration"): previously "View / Edit" only
   ever opened the read-only Task Details panel — there was no way to
   actually change a task's title, project, assignees, priority, or due
   date (i.e. extend/shorten its duration) after creating it. This mirrors
   CreateTaskModal's form, pre-filled with the task's current values.
====================================================================== */

function EditTaskModal({ task, onClose, onSave, assignableUsers, projects, onAddProject, clients = [], darkMode }) {
  const [form, setForm] = useState({
    title: task.title,
    description: task.description,
    requirements: task.requirements || "",
    project: task.project,
    clientId: task.clientId || "",
    assignees: getAssignees(task),
    priority: task.priority,
    dueDate: task.dueDate,
    sampleFiles: task.sampleFiles || [],
  });
  const canSubmit = form.title.trim() && form.assignees.length > 0 && form.dueDate;
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Edit Task</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Task title</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Requirements & Features</label>
            <textarea
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              placeholder="Spell out exactly what needs to be built — features, requirements, acceptance criteria..."
              rows={3}
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ProjectFieldWithAdd
              projects={projects}
              value={form.project}
              onChange={(v) => setForm((f) => ({ ...f, project: v }))}
              onAddProject={onAddProject}
              inputCls={inputCls}
              darkMode={darkMode}
            />
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Priority</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
                {PRIORITIES.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          <ClientPickerField
            clients={clients}
            value={form.clientId}
            onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            inputCls={inputCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Assignee</label>
              <AssigneeSearchSelect
                users={assignableUsers}
                selected={form.assignees}
                onChange={(v) => setForm({ ...form, assignees: v })}
                inputCls={inputCls}
                darkMode={darkMode}
              />
            </div>
            <div>
              {/* "Duration" = the task's due date. Extending/shortening it
                  here is exactly the "increase duration" ability that was
                  missing before — due date used to only ever be set once,
                  at creation. */}
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Due date</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`} />
            </div>
          </div>
          <SampleFilesField
            files={form.sampleFiles}
            onChange={(v) => setForm((f) => ({ ...f, sampleFiles: v }))}
            darkMode={darkMode}
            inputCls={inputCls}
          />
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>
            Cancel
          </button>
          <button
            disabled={!canSubmit}
            onClick={() =>
              onSave({
                title: form.title,
                description: form.description,
                requirements: form.requirements,
                project: form.project,
                // FIX (100% reliable single-person-task -> Clients page
                // zip routing): resolve the picked client id to its
                // current name here too, exactly like Create Task does,
                // so an existing task can be explicitly (re)linked to a
                // client — or unlinked, by picking "— No client —" again.
                clientId: form.clientId || null,
                clientName: form.clientId ? clients.find((c) => c.id === form.clientId)?.name || null : null,
                assignees: form.assignees,
                // Drop the old single `assignee` field on save so the
                // task is fully migrated to the new multi-assignee shape
                // (getAssignees() would otherwise still prefer `assignees`
                // anyway, but this keeps the stored data clean).
                assignee: undefined,
                priority: form.priority,
                dueDate: form.dueDate,
                sampleFiles: form.sampleFiles,
              })
            }
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}