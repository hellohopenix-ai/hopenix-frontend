import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FolderKanban,
  Loader,
  CheckCircle2,
  PauseCircle,
  XCircle,
  Wallet,
  Search,
  Plus,
  Filter,
  MoreVertical,
  X,
  Calendar,
  Eye,
  Download,
  Pencil,
  Archive,
  Trash2,
  ChevronDown,
  Users2,
  Building2,
  FileText,
  Clock,
  DollarSign,
  User,
  Check,
  Layers,
  Lock,
  CalendarClock,
  Link2,
  ExternalLink,
  ListTodo,
  ClipboardList,
  Video,
  Paperclip,
  ChevronRight,
} from "lucide-react";
import { useAuth, getRoleCategory } from "../AuthContext.jsx";
import * as projectsApi from "../projectsApi.js";
import CommissionFields, { syncCommissions, usePerProjectIds, useCommissionPrefill } from "../components/CommissionFields.jsx";
import { useLiveRefresh, sameJson } from "../useLiveRefresh.js";
import { listAllDaily, bulkDeleteDaily } from "./reportsApi.js";
import * as messagesApi from "../messagesApi.js";
import { idbPutMessageMedia } from "./MessagesPage.jsx";
import { saveAttachmentBlob, getAttachmentBlob } from "../attachmentStorage.js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/* ======================================================================
   STATIC CONFIG
====================================================================== */

const CLIENTS = [
  "Tech Solutions Inc.",
  "FinBank",
  "Business Hub",
  "Retail Max",
  "People First",
  "Brand Elevate",
  "E-Store Co.",
  "Data Insights Ltd.",
  "Connectify",
];

/* ----------------------------------------------------------------------
   REAL CLIENTS (shared with ClientsPage.jsx)
   ClientsPage.jsx persists its client list to localStorage under this
   exact key (see CLIENTS_STORAGE_KEY in ClientsPage.jsx). Reading it here
   is what "links" the two pages together: when creating a "Client
   Project" the dropdown only ever offers clients that genuinely exist on
   the Clients page — never a made-up name — and picking one keeps using
   that client's real company name as `project.client`, exactly like
   ClientsPage itself stores it. The static CLIENTS list above is kept
   only as a last-resort fallback for the "By Client" filter tab, in case
   nothing has been added on the Clients page yet.
---------------------------------------------------------------------- */
const REAL_CLIENTS_STORAGE_KEY = "clientspage_clients_v1";

function loadRealClients() {
  try {
    const raw = window.localStorage.getItem(REAL_CLIENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((c) => ({ id: c.id, name: c.name || c.companyName || "", contactPerson: c.contactPerson || "" }))
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

/* ----------------------------------------------------------------------
   REAL BACKEND <-> FRONTEND SHAPE TRANSLATION
   The Django backend stores manager/team/client as IDs (FKs) and uses
   different field names (due_date, project_type, ...) than this page's
   existing UI, which was built around name-strings (project.manager,
   project.client, project.deadline, ...) from the old localStorage demo.
   Rather than rewriting every one of the ~4000 lines below that reads
   those fields, these two functions translate AT THE BOUNDARY: backend
   response -> the exact same frontend shape the rest of this file
   already expects, and frontend form -> the exact payload shape the
   backend expects. Internal `_managerId`/`_teamIds` fields are kept on
   each project so edits can send IDs back without re-resolving names.
---------------------------------------------------------------------- */
function idToName(users, id) {
  if (id == null) return "";
  const u = (users || []).find((u) => String(u.id) === String(id));
  return u?.name || "";
}
function nameToId(users, name) {
  if (!name) return null;
  const u = (users || []).find((u) => u.name === name);
  return u ? u.id : null;
}

// A file must never be listed twice: drop any later entry with an id already seen.
function dedupeById(list) {
  const seen = new Set();
  return (list || []).filter((x) => {
    const key = String(x?.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function backendModuleToFrontend(bm) {
  return {
    id: bm.id,
    name: bm.name,
    assignee: bm.assignee_name || "",
    _assigneeId: bm.assignee ?? null,
    status: bm.status || "Pending",
    priority: bm.priority || "Medium",
    dueDate: bm.due_date || "",
    url: bm.url || "",
    price: Number(bm.price) || 0,
    // "" | "pending" (waiting for admin approval) | "sent" — see projects/handoff.py
    handoffStatus: bm.handoff_status || "",
    handoffNext: bm.handoff_next_name || "",
    files: dedupeById(bm.files || []).map((f) => ({
      id: f.id,
      fileName: f.original_name,
      mime: f.mime_type,
      size: f.size,
      uploadedBy: f.uploaded_by_name,
      uploadedOn: (f.uploaded_at || "").slice(0, 10),
      fileUrl: f.file, // real backend URL — used by downloadStoredFile's backend branch
      storedOnBackend: true,
    })),
  };
}

// `bp` is a row from either ProjectListSerializer (no `modules`) or
// ProjectDetailSerializer (has `modules`) — both map cleanly here.
function backendProjectToFrontend(bp, approvedUsers) {
  const teamNames = (bp.team || []).map((tid) => idToName(approvedUsers, tid)).filter(Boolean);
  return {
    id: bp.id,
    name: bp.name,
    description: bp.description || "No description provided.",
    projectType: bp.project_type || "company",
    client: bp.project_type === "client" ? bp.client_name || "" : "Internal / Company Project",
    manager: bp.manager_name || "Unassigned",
    team: teamNames,
    status: bp.status,
    priority: bp.priority,
    budget: Number(bp.budget) || 0,
    spent: Number(bp.spent) || 0,
    startDate: bp.start_date || "",
    deadline: bp.due_date || "",
    isArchived: !!bp.is_archived,
    modules: Array.isArray(bp.modules) ? bp.modules.map(backendModuleToFrontend) : [],
    moduleCount: bp.module_count,
    // FIX: these are now real columns on the backend Project model (see
    // projects/models.py) instead of local-only fields that vanished on
    // refresh — read straight from the server response.
    features: bp.features || "",
    requirements: bp.requirements || "",
    additionalInfo: bp.additional_info || "",
    notes: "No additional notes have been added to this project yet.",
    completedOn: bp.status === "Completed" ? (bp.updated_at || "").slice(0, 10) : undefined,
    completionLink: bp.completion_link || null,
    briefFile: bp.brief ? { fileName: String(bp.brief).split("/").pop(), fileUrl: bp.brief, storedOnBackend: true } : null,
    completedZip: bp.completed_zip
      ? { fileName: String(bp.completed_zip).split("/").pop(), fileUrl: bp.completed_zip, storedOnBackend: true }
      : null,
    createdAt: bp.created_at,
    updatedAt: bp.updated_at,
    // internal bookkeeping, not rendered anywhere directly
    _managerId: bp.manager ?? null,
    _teamIds: bp.team || [],
    _clientId: bp.client ?? null,
  };
}

// Frontend Create/Edit form -> backend payload. Resolves manager/team
// name-strings to real user IDs via `approvedUsers` (already a real,
// backend-sourced list from AuthContext). Client linking is left out
// for now: ClientsPage.jsx is still its own localStorage-only demo, so
// there is no reliable real Client ID to send yet (sending a made-up
// one would just fail against the backend's foreign key).
function buildBackendProjectPayload(data, { approvedUsers, isAdmin, realClients = [] } = {}) {
  const managerId = nameToId(approvedUsers, data.manager);
  const teamIds = Array.from(
    new Set([...(managerId != null ? [managerId] : []), ...(data.team || []).map((n) => nameToId(approvedUsers, n)).filter((v) => v != null)])
  );
  const payload = {
    name: data.name,
    description: data.description || "",
    project_type: data.projectType === "client" ? "client" : "company",
    manager: managerId,
    team: teamIds,
    due_date: data.deadline || null,
  };
  if (data.projectType === "client" && data.client) {
    const clientsList = realClients.length > 0 ? realClients : loadRealClients();
    const foundClient = clientsList.find((c) => String(c.id) === String(data.client) || c.name === data.client);
    if (foundClient) {
      payload.client = foundClient.id;
    }
  }
  if (data.status) payload.status = data.status;
  if (data.priority) payload.priority = data.priority;
  if (isAdmin && data.budget !== undefined && data.budget !== "") payload.budget = Number(data.budget) || 0;
  // FIX (features/requirements/additionalInfo/completionLink never
  // reached the server): these 4 fields are now real columns on the
  // backend Project model (see projects/models.py) — send them on every
  // create/edit instead of only keeping them in local component state.
  if (data.features !== undefined) payload.features = data.features || "";
  if (data.requirements !== undefined) payload.requirements = data.requirements || "";
  if (data.additionalInfo !== undefined) payload.additional_info = data.additionalInfo || "";
  if (data.completionLink !== undefined) payload.completion_link = data.completionLink || "";
  return payload;
}

/* ----------------------------------------------------------------------
   FILE UPLOADS -> REAL, OPENABLE ATTACHMENTS (project brief / screenshot
   / deliverable zip). Same approach TasksPage.jsx already uses for task
   attachments: converts the picked file into a base64 data URL via
   FileReader so it survives a localStorage round-trip and can be
   reopened later — including as a real attachment on the message that
   gets sent to the team once the project is created/assigned (see
   syncProjectPeerConversations below).
---------------------------------------------------------------------- */
const MAX_PROJECT_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB
const PROJECT_BRIEF_ACCEPT = "application/pdf,image/*";

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PROJECT_ATTACHMENT_BYTES) {
      reject(new Error("File is too large (max 5MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Turns a base64 `data:` URL (what readFileAsDataUrl above produces) back
// into a real Blob, so the project's brief file can be handed to
// MessagesPage.jsx's idbPutMessageMedia — messages themselves only ever
// carry IndexedDB, never the raw bytes (see the big comment above
// idbPutMessageMedia in MessagesPage.jsx for why: embedding a data: URL
// straight into a message can blow past localStorage's ~5-10MB quota and
// silently fail to deliver).
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mime = (header.match(/data:(.*);base64/) || [])[1] || "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const STATUS_OPTIONS = ["In Progress", "In Review", "Completed", "On Hold", "Cancelled"];

const STATUS_STYLES = {
  "In Progress": "bg-blue-50 text-blue-600",
  "In Review": "bg-amber-50 text-amber-600",
  Completed: "bg-emerald-50 text-emerald-600",
  "On Hold": "bg-orange-50 text-orange-600",
  Cancelled: "bg-rose-50 text-rose-600",
};

/* ----------------------------------------------------------------------
   MODULES — every project is now broken into Modules (e.g. Frontend,
   Backend, UI/UX) instead of a plain numeric task count. Each module
   carries its own assignee, status, priority, due date, an optional
   reference URL, and any files uploaded against it (spec docs,
   screenshots, deliverables) — see ModuleRow/ModulesSection below for
   how these render, and handleUploadModuleFile/downloadStoredFile
   further down for how the actual files are stored.
---------------------------------------------------------------------- */
const MODULE_STATUS_OPTIONS = ["Pending", "In Progress", "Completed"];
const MODULE_STATUS_STYLES = {
  Pending: "bg-amber-50 text-amber-600",
  "In Progress": "bg-blue-50 text-blue-600",
  Completed: "bg-emerald-50 text-emerald-600",
};
const MODULE_PRIORITY_OPTIONS = ["Low", "Medium", "High"];
const MODULE_PRIORITY_STYLES = {
  Low: "bg-slate-100 text-slate-500",
  Medium: "bg-amber-50 text-amber-600",
  High: "bg-rose-50 text-rose-600",
};

// A module's own file upload — same IndexedDB-backed pattern as the
// project brief/ZIP above (see saveAttachmentBlob), so a spec doc,
// screenshot, or deliverable attached to a module never risks blowing
// past localStorage's quota. Returns just the metadata; the caller
// (whoever knows who's logged in) stamps on `uploadedBy`/`uploadedOn`.
async function saveModuleFile(file) {
  const id = `modfile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = await saveAttachmentBlob(id, file);
  const base = { id, fileName: file.name, mime: file.type || "application/octet-stream", size: file.size };
  if (stored.storedInIDB) return { ...base, storedInIDB: true };
  // IndexedDB unavailable — fall back to the same capped base64 path
  // used everywhere else in this file.
  const dataUrl = await readFileAsDataUrl(file);
  return { ...base, dataUrl, storedInIDB: false };
}

// Pulls a module file's real bytes back out of wherever saveModuleFile
// put them and triggers a normal browser download. Any component in
// this file can call this directly — it's plain, prop-free plumbing,
// same as dataUrlToBlob/getAttachmentBlob it's built on.
async function downloadStoredFile(file, showToast) {
  try {
    const blob = file.storedInIDB ? await getAttachmentBlob(file.id) : file.dataUrl ? dataUrlToBlob(file.dataUrl) : null;
    if (!blob) {
      showToast?.("That file is no longer available.", "error");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.fileName || "file";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    showToast?.("Couldn't download that file — please try again.", "error");
  }
}

// Single source of truth for a project's module-based progress — done/
// total/percent are always derived straight from `modules`, never
// stored as separate numbers, so they can never drift out of sync.
function moduleStats(project) {
  const modules = project?.modules || [];
  const total = modules.length;
  const done = modules.filter((m) => m.status === "Completed").length;
  const pct = project?.status === "Completed" ? 100 : total ? Math.round((done / total) * 100) : 0;
  return { done, total, pct };
}

const AVATAR_PALETTE = [
  "bg-rose-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-violet-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500",
];

function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
function fmtMoney(n) {
  return `PKR ${Number(n).toLocaleString()}`;
}
// Auto-grows a description textarea as the user types, but only up to
// MAX_TEXTAREA_HEIGHT — past that it stops expanding and scrolls
// internally instead. Without this cap the box grew without limit as
// more was typed, pushing the rest of the form/panel down; the full
// text the user types is still kept and submitted either way, this
// only controls how tall the box itself is allowed to get.
const MAX_TEXTAREA_HEIGHT = 160;
function autoGrowTextarea(el) {
  if (!el) return;
  el.style.height = "auto";
  const next = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT);
  el.style.height = `${next}px`;
  el.style.overflowY = el.scrollHeight > MAX_TEXTAREA_HEIGHT ? "auto" : "hidden";
}
function fmtDate(iso) {
  if (!iso) return "—";
  try {
    // Parse a plain "YYYY-MM-DD" string as a LOCAL date instead of
    // letting `new Date(iso)` treat it as UTC midnight — that UTC
    // parsing is what made dates silently shift a day off (e.g. showing
    // yesterday's date) depending on the viewer's timezone, which is
    // exactly why the date shown didn't match the date the project was
    // actually created/due on. Also guards against a stray non-4-digit
    // year (e.g. from a mistyped date input) ever rendering a garbled
    // date like "Sep 8, 78645".
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
    if (Number.isNaN(d.getTime()) || d.getFullYear() < 1000 || d.getFullYear() > 9999) return "—";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}
// Clamp a date-input value to a sane 4-digit-year range so a mistyped
// year (browsers' native date input lets you keep typing digits into
// the year segment) can never be stored/shown as something absurd like
// "78645". Returns "" for anything outside the allowed range so the
// bad keystroke is simply ignored instead of being saved.
function clampDateInput(value, { minYear = 2000, maxYear = 2100 } = {}) {
  if (!value) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return "";
  const year = Number(m[1]);
  if (year < minYear || year > maxYear) return "";
  return value;
}
// Positive => `toIso` is BEFORE `fromIso` is not what this returns — this
// returns (toIso - fromIso) in whole days, so daysBetween(completedOn,
// deadline) > 0 means the project was completed before its deadline
// (delivered early), 0 means exactly on the deadline day, and < 0 means
// it slipped past the deadline (delivered late).
function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/* FIX: the old demo/seed projects (SEED_PROJECTS) were removed. When the
   backend was unreachable and the cache was empty they used to show up as
   if they were real projects. Real data only comes from the backend now. */
// Old builds cached the fake demo rows with ids like "p1", "p2" ... — real
// backend ids are never of that shape, so drop them if they're still lying
// around in someone's localStorage.
function isLegacySeedProject(item) {
  return typeof item?.id === "string" && /^p\d+$/.test(item.id);
}

/* ======================================================================
   PERSISTENCE (localStorage) — keeps created/edited/deleted projects
   saved across page navigations / reloads until the user deletes them.
====================================================================== */

const STORAGE_KEY = "hopenix_projects_data_v1";
const LEGACY_SHARED_STORAGE_KEY = "hopenix_projects_v1";

/* FIX (crash + data flicker/reset risk): `hopenix_projects_v1` used to be
   a SHARED key with TasksPage.jsx, which only ever stores a plain array
   of project NAME STRINGS there (see normalizeProjectList/
   saveProjectsToStorage in TasksPage.jsx) and re-saves it on its own
   schedule. Reading those bare strings straight into `projects` made
   every `p.team`/`p.manager` undefined and crashed the page (e.g.
   `p.team.includes(...)`); even after guarding against that crash,
   sharing the key still meant this page's rich project objects
   ({ id, name, manager, team, ... }) could get silently clobbered by
   Tasks' string-only writes, making projects you created here "flicker"
   back to seed data until this page saved again. To remove both risks,
   Projects now persists to its OWN dedicated key that TasksPage never
   touches, so the two pages can no longer collide.
   `LEGACY_SHARED_STORAGE_KEY` is only read once, to migrate any real
   project objects a user already had saved under the old shared key
   before this fix, so no existing data is lost. */
function isValidStoredProject(item) {
  return !!item && typeof item === "object" && !Array.isArray(item) && typeof item.id !== "undefined";
}

function loadStoredProjects() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const validProjects = parsed.filter(isValidStoredProject).filter((p) => !isLegacySeedProject(p));
        if (validProjects.length) return validProjects;
      }
    }
    // One-time migration: pull over any real project objects still sitting
    // under the old shared key (from before Projects had its own key).
    const legacyRaw = window.localStorage.getItem(LEGACY_SHARED_STORAGE_KEY);
    if (legacyRaw) {
      const legacyParsed = JSON.parse(legacyRaw);
      if (Array.isArray(legacyParsed)) {
        const legacyValidProjects = legacyParsed.filter(isValidStoredProject).filter((p) => !isLegacySeedProject(p));
        if (legacyValidProjects.length) {
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacyValidProjects));
          } catch {
            // ignore — migration is best-effort
          }
          return legacyValidProjects;
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

function saveStoredProjects(projects) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // storage unavailable (e.g. private mode) — fail silently, app still works in-memory
  }
}

/* ======================================================================
   LINK TO REPORTS PAGE — daily reports (with their photo/video proof)
   are tagged with a project name and live entirely on the BACKEND
   (/api/reports/daily/ — create, list, delete, approve, all of it; see
   ReportsPage.jsx / reportsApi.js). Nothing about the reports themselves
   is stored in this browser. Two things use the project<->reports link:

     1. "View Daily Reports" on a completed project jumps to Reports with
        that project pre-filtered — via PROJECT_FOCUS_LS_KEY below, which
        is NOT report data. It's a one-shot, same-tab navigation signal:
        set immediately before navigate("Reports"), read + deleted by
        ReportsPage the moment it mounts (see its onHandOff effect). It
        never outlives that single click, so it's intentionally local and
        does not need — and must not get — a cross-device/backend sync;
        syncing it would leak "what I'm looking at" between users sharing
        an account, which is the opposite of what it's for.
     2. Deleting a project also deletes every daily report tagged with it,
        photos/videos included, on the server — purgeDailyReportsForProject()
        below throws if that server call fails so the caller can tell the
        user, instead of silently leaving orphaned reports behind.
====================================================================== */

const PROJECT_FOCUS_LS_KEY = "reportspage_project_focus_v1"; // one-shot nav hint only — see note above, not synced

// Deletes every daily report tagged with `projectName` ON THE SERVER (the
// backend removes the attached photos/videos too), then tells any already-
// open Reports page to refresh. Returns how many reports were deleted and
// THROWS if the server call fails, so callers can tell the user instead of
// silently leaving reports behind. (Before this fix it only cleaned this
// browser's old localStorage copy, so the real reports stayed on the
// server after a project was deleted.)
async function purgeDailyReportsForProject(projectName) {
  if (!projectName) return 0;
  let deleted = 0;
  for (let round = 0; round < 5; round += 1) {
    const { results } = await listAllDaily({ project: projectName });
    const ids = (results || []).filter((r) => r?.project === projectName).map((r) => r.id);
    if (ids.length === 0) break;
    const res = await bulkDeleteDaily(ids);
    deleted += res?.deleted ?? ids.length;
  }
  if (deleted > 0) window.dispatchEvent(new Event("daily-reports-changed"));
  return deleted;
}

/* ======================================================================
   ASSIGNMENT NOTIFICATIONS (for the sidebar's red dot)
   Whenever someone is newly put on a project's team (on create, or on
   edit if they weren't on it before), their name is recorded here.
   A "hopenix:assignments-changed" event is dispatched every time this
   changes, so a Sidebar component elsewhere in the app can listen for
   it (and/or the native "storage" event, which also fires across tabs)
   and light up a red dot for whoever is currently logged in. Opening
   this page as that user clears their own entry — see the
   clear-on-mount effect inside ProjectsPage below.
====================================================================== */

const ASSIGNMENT_STORAGE_KEY = "hopenix_new_assignments_v1";
const ASSIGNMENT_EVENT = "hopenix:assignments-changed";

function readAssignmentMap() {
  try {
    const raw = window.localStorage.getItem(ASSIGNMENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAssignmentMap(map) {
  try {
    window.localStorage.setItem(ASSIGNMENT_STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(ASSIGNMENT_EVENT, { detail: map }));
  } catch {
    // storage unavailable — the red dot simply won't show, nothing else breaks
  }
}

function notifyAssigned(userName) {
  if (!userName) return;
  const map = readAssignmentMap();
  if (map[userName]) return;
  map[userName] = true;
  writeAssignmentMap(map);
}

function clearAssignmentNotification(userName) {
  if (!userName) return;
  const map = readAssignmentMap();
  if (!map[userName]) return;
  delete map[userName];
  writeAssignmentMap(map);
}

/* ======================================================================
   PROJECT TEAM GROUP CHAT
   Whenever a project has a team (manager + members), that team gets a
   group conversation on the Messages page — created the moment the
   project is created, kept in sync (name/members) on every edit, and
   seeded with the project's details as its first message so nobody has
   to be told separately what they were just assigned to.
====================================================================== */

/* One line per detail, skipping anything not set. Budget is deliberately
   left out — budget is admin-only everywhere else in this page, so it
   should never get broadcast into a group chat everyone on the team can
   read. */
function buildProjectDetailsMessage(project) {
  const lines = [
    `📁 Project: ${project.name}`,
    project.description && `Description: ${project.description}`,
    project.projectType === "client" ? `Client: ${project.client}` : "Type: Company Project",
    `Manager: ${project.manager}`,
    `Status: ${project.status}`,
    project.deadline && `Deadline: ${fmtDate(project.deadline)}`,
    project.features && `Features:\n${project.features}`,
    project.requirements && `Requirements:\n${project.requirements}`,
    project.additionalInfo && `Additional info: ${project.additionalInfo}`,
    project.briefFile && `📎 Attached: ${project.briefFile.fileName}`,
  ];
  return lines.filter(Boolean).join("\n");
}

// Turns a project's uploaded brief (PDF/screenshot) into a real message
// `file` attachment — the exact shape MessagesPage.jsx's own bubbles
// already know how to render (see `m.file` in its message list): the
// actual bytes get moved into IndexedDB via idbPutMessageMedia and only
// a small `mediaId` reference goes into the message/localStorage, same
// as sendReportMessage() already does over there.
// FIX (silent project-save failure + broken PDF message): `briefFile`
// itself now lives in IndexedDB too (see saveAttachmentBlob in the
// Create form below), so this reads the bytes back via
// getAttachmentBlob instead of decoding a base64 dataUrl that no
// longer exists on the project object. Old/legacy projects that still
// have a raw `dataUrl` (saved before this fix) keep working via the
// dataUrlToBlob fallback below.
async function buildFileMessageEntry(fileRecord, { isImage = false } = {}) {
  if (!fileRecord) return null;
  const blob = fileRecord.storedInIDB ? await getAttachmentBlob(fileRecord.id) : fileRecord.dataUrl ? dataUrlToBlob(fileRecord.dataUrl) : null;
  if (!blob) return null;
  const mediaId = `msgmedia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = await idbPutMessageMedia(mediaId, blob);
  const size = formatBytes(fileRecord.size || blob.size);
  return stored
    ? { name: fileRecord.fileName, size, isImage, mediaId }
    : { name: fileRecord.fileName, size, isImage, url: fileRecord.dataUrl || null };
}

async function buildBriefFileEntry(project) {
  if (!project.briefFile) return null;
  return buildFileMessageEntry(project.briefFile, { isImage: (project.briefFile.mime || "").startsWith("image/") });
}

// completedZip stores its size in MB (see handleUploadZip/handleZipFile),
// unlike briefFile which stores raw bytes — buildFileMessageEntry's size
// arg only ever multiplies by 1024*1024 when `size` is otherwise falsy,
// so pass the MB value straight through here instead.
async function buildZipFileEntry(zip) {
  if (!zip) return null;
  const blob = zip.storedInIDB ? await getAttachmentBlob(zip.id) : zip.dataUrl ? dataUrlToBlob(zip.dataUrl) : null;
  if (!blob) return null;
  const mediaId = `msgmedia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stored = await idbPutMessageMedia(mediaId, blob);
  const size = formatBytes(zip.size ? zip.size * 1024 * 1024 : blob.size);
  return stored
    ? { name: zip.fileName, size, isImage: false, mediaId }
    : { name: zip.fileName, size, isImage: false, url: zip.dataUrl || null };
}

/* No more shared "group" conversation per project. Instead, this keeps a
   plain 1:1 (peer-to-peer) thread in sync between the project's Manager
   and EACH team member individually — reusing the same peer conversation
   Dashboard.jsx already auto-creates for every pair of non-admin users
   (see the `peer-${sorted ids}` seeding effect there), just tagging the
   relevant pair with this project's id so Dashboard.jsx's
   visibleConversations knows to actually surface it:
     - a plain team member ends up seeing only their assigned Project
       Manager (their 1:1 thread with them gets a project link),
     - the Project Manager ends up seeing each of their own team members
       as a separate 1:1 contact (one project link per pair) — so they
       always know exactly who they're managing, without a merged group.
   If team membership changes, the project's id is dropped from any pair
   that's no longer part of the team (the underlying 1:1 thread itself is
   never deleted — people can keep talking — just its project link is
   removed so it stops being surfaced as a project contact). */
async function syncProjectPeerConversations(setConversations, project, approvedUsers, { newlyAdded = [] } = {}) {
  if (typeof setConversations !== "function") return; // Dashboard.jsx hasn't wired the props yet

  // All team member names assigned to this project (manager + team array)
  const allTeamNames = Array.from(
    new Set([
      ...(project.manager && project.manager !== "Unassigned" ? [project.manager] : []),
      ...(Array.isArray(project.team) ? project.team : []),
    ])
  );
  if (allTeamNames.length === 0) return; // nothing to message

  const now = Date.now();
  const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDate = new Date(now).toISOString().slice(0, 10);
  const detailsText = buildProjectDetailsMessage(project);
  // Resolved once, reused for every recipient — same IndexedDB blob, just
  // referenced by the same mediaId in each person's own thread.
  const briefFile = await buildBriefFileEntry(project);

  const managerUser = (approvedUsers || []).find((u) => u.name === project.manager);
  const managerAuthId = managerUser?.id || null;
  const isManagerAdmin = managerUser?.role === "admin";

  const memberUsers = allTeamNames
    .map((name) => (approvedUsers || []).find((u) => u.name === name))
    .filter(Boolean);

  const nonManagerMemberUsers = memberUsers.filter((u) => u.id !== managerAuthId);

  // Use peer threads if a non-admin manager is assigned and there are other non-admin team members
  const usePeerThreads = managerAuthId && !isManagerAdmin && nonManagerMemberUsers.length > 0;

  if (usePeerThreads) {
    const desiredPeerIds = new Set(
      nonManagerMemberUsers.map((m) => `peer-${[managerAuthId, m.id].sort().join("_")}`)
    );

    setTimeout(() => {
      setConversations((prev) => {
        let next = prev;

        // This project no longer pairs the manager with someone it used to —
        // drop just this project's id from that pair's link, nothing else.
        next = next.map((c) => {
          if (!c.peerAuthIds || !(c.projectIds || []).includes(project.id)) return c;
          if (desiredPeerIds.has(c.id)) return c;
          return { ...c, projectIds: c.projectIds.filter((pid) => pid !== project.id) };
        });

        nonManagerMemberUsers.forEach((member) => {
          const memberId = member.id;
          const memberName = member.name;
          const peerId = `peer-${[managerAuthId, memberId].sort().join("_")}`;
          const isNewlyAdded = newlyAdded.includes(memberName) || newlyAdded.includes(project.manager);
          const exists = next.some((c) => c.id === peerId);

          if (!exists) {
            // FIX (message shows on wrong side): MessagesPage.jsx computes
            // each message's left/right side dynamically per viewer, based
            // on `sender` (see resolveSender/isOutgoingForViewer there) —
            // it never trusts a fixed `outgoing` flag. For a peer
            // (manager↔member) thread specifically, direction is decided
            // by `sender === viewerId`, so `sender` has to be a REAL
            // authId, not the literal string "system" (which can never
            // equal anyone's id and so always rendered as incoming for
            // both people). These assignment/brief messages are
            // conceptually sent by the project's manager, so `sender` is
            // the manager's own authId — that makes it show as "sent by
            // me" on the manager's screen and "received" on the member's.
            const messages = [
              { id: 1, text: detailsText, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: managerAuthId },
            ];
            if (briefFile) {
              messages.push({ id: 2, file: briefFile, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: managerAuthId });
            }
            next = [
              {
                id: peerId,
                peerAuthIds: [managerAuthId, memberId],
                projectIds: [project.id],
                status: "Active",
                time: nowTime,
                lastMessageAt: now,
                lastMessageDate: nowDate,
                unreadFor: { [managerAuthId]: 1, [memberId]: 1 },
                files: [],
                assignments: [],
                messages,
              },
              ...next,
            ];
            return;
          }

          next = next.map((c) => {
            if (c.id !== peerId) return c;
            const projectIds = Array.from(new Set([...(c.projectIds || []), project.id]));
            const lastMsg = c.messages[c.messages.length - 1];
            const shouldPost = isNewlyAdded || !lastMsg || lastMsg.text !== detailsText;
            let nextId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
            const appended = [];
            if (shouldPost) {
              appended.push({
                id: nextId++,
                text: isNewlyAdded ? `You've been added to the project.\n\n${detailsText}` : detailsText,
                time: nowTime,
                date: nowDate,
                timestamp: now,
                outgoing: false,
                sender: managerAuthId,
              });
              if (briefFile) {
                appended.push({ id: nextId++, file: briefFile, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: managerAuthId });
              }
            }
            const nextMessages = appended.length > 0 ? [...c.messages, ...appended] : c.messages;
            const nextUnreadFor = { ...(c.unreadFor || {}) };
            if (shouldPost) {
              nextUnreadFor[managerAuthId] = (nextUnreadFor[managerAuthId] || 0) + 1;
              nextUnreadFor[memberId] = (nextUnreadFor[memberId] || 0) + 1;
            }
            return {
              ...c,
              projectIds,
              messages: nextMessages,
              unreadFor: nextUnreadFor,
              time: shouldPost ? nowTime : c.time,
              lastMessageAt: shouldPost ? now : c.lastMessageAt,
              lastMessageDate: shouldPost ? nowDate : c.lastMessageDate,
            };
          });
        });

        return next;
      });
    }, 0);
  } else {
    // Post to main 1:1 threads (c.authId === user.id) for assigned users.
    // FIX (message shows on wrong side): MessagesPage.jsx decides
    // left/right per viewer from `sender` — for this non-peer thread
    // type it checks `sender === "admin"` for a privileged viewer and
    // `sender === "user"` otherwise (see isOutgoingForViewer there).
    // `sender: "system"` matched neither, so these assignment messages
    // always rendered as incoming — even on the admin's own screen,
    // where they're really the ones "sending" this notification.
    // `sender: "admin"` makes it show as outgoing/sent-by-me for the
    // admin, and correctly still incoming for the team member receiving it.
    const targetUserIds = new Set(memberUsers.map((u) => u.id));

    setTimeout(() => {
      setConversations((prev) => {
        let next = prev;

        next = next.map((c) => {
          const userId = c.authId || c.id;
          if (!targetUserIds.has(userId)) return c;

          const targetUser = memberUsers.find((u) => u.id === userId);
          const isNewlyAdded = newlyAdded.includes(targetUser?.name);
          const projectIds = Array.from(new Set([...(c.projectIds || []), project.id]));
          const lastMsg = c.messages[c.messages.length - 1];
          const shouldPost = isNewlyAdded || !lastMsg || lastMsg.text !== detailsText;
          let nextId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
          const appended = [];
          if (shouldPost) {
            appended.push({
              id: nextId++,
              text: isNewlyAdded ? `You've been added to the project.\n\n${detailsText}` : detailsText,
              time: nowTime,
              date: nowDate,
              timestamp: now,
              outgoing: false,
              sender: "admin",
            });
            if (briefFile) {
              appended.push({ id: nextId++, file: briefFile, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: "admin" });
            }
          }
          const nextMessages = appended.length > 0 ? [...c.messages, ...appended] : c.messages;
          return {
            ...c,
            projectIds,
            messages: nextMessages,
            unread: shouldPost ? (c.unread || 0) + 1 : c.unread,
            unreadForUser: shouldPost ? (c.unreadForUser || 0) + 1 : c.unreadForUser,
            time: shouldPost ? nowTime : c.time,
            lastMessageAt: shouldPost ? now : c.lastMessageAt,
            lastMessageDate: shouldPost ? nowDate : c.lastMessageDate,
          };
        });

        return next;
      });
    }, 0);
  }
}


/* ----------------------------------------------------------------------
   PROJECT ZIP (create-time) -> MANAGER ONLY
   The ZIP a project is created with is deliverable/reference material
   for whoever is actually running the project, not something the whole
   team needs pushed to them — so unlike buildProjectDetailsMessage
   above (which goes out to the manager AND every team member), this
   only ever posts to the assigned Manager's own 1:1 thread. If there's
   no manager assigned yet (still "Unassigned") this simply does
   nothing — the ZIP stays attached to the project record and is still
   visible on the Zip Files admin page either way.
---------------------------------------------------------------------- */
async function sendProjectZipToManagerOnly(setConversations, project, approvedUsers) {
  if (typeof setConversations !== "function") return;
  if (!project.completedZip || !project.manager || project.manager === "Unassigned") return;

  const zipEntry = await buildZipFileEntry(project.completedZip);
  if (!zipEntry) return;

  const managerUser = (approvedUsers || []).find((u) => u.name === project.manager);
  if (!managerUser) return;

  const now = Date.now();
  const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDate = new Date(now).toISOString().slice(0, 10);

  setTimeout(() => {
    setConversations((prev) => {
      const managerId = managerUser.id;
      let found = false;
      const next = prev.map((c) => {
        const cid = c.authId || c.id;
        if (cid !== managerId) return c;
        found = true;
        let nextId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
        const appended = [
          {
            id: nextId++,
            text: `📦 The project ZIP for "${project.name}" has been uploaded.`,
            time: nowTime,
            date: nowDate,
            timestamp: now,
            outgoing: false,
            sender: "admin",
          },
          { id: nextId++, file: zipEntry, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: "admin" },
        ];
        return {
          ...c,
          messages: [...c.messages, ...appended],
          unread: (c.unread || 0) + 1,
          unreadForUser: (c.unreadForUser || 0) + 1,
          time: nowTime,
          lastMessageAt: now,
          lastMessageDate: nowDate,
        };
      });
      return found ? next : prev;
    });
  }, 0);
}

async function sendProjectNotificationsToBackend({ project, combinedTeam, approvedUsers, briefFile, zipFile, moduleFiles }) {
  try {
    const detailsText = buildProjectDetailsMessage(project);
    const memberUsers = (combinedTeam || [])
      .map((name) => (approvedUsers || []).find((u) => u.name === name))
      .filter((u) => u && u.id);

    for (const u of memberUsers) {
      // 1. Send details text
      await messagesApi.sendMessage({ recipientId: u.id, text: detailsText }).catch(() => {});
      
      // 2. Send brief file (PDF/Image attachment) to all assigned members + manager
      if (briefFile) {
        await messagesApi.sendMessage({
          recipientId: u.id,
          text: `📎 Project Brief attachment for "${project.name}"`,
          attachment: briefFile,
        }).catch(() => {});
      }

      // 3. Send deliverable ZIP file to all assigned members + manager
      if (zipFile) {
        await messagesApi.sendMessage({
          recipientId: u.id,
          text: `📦 Deliverable ZIP file for "${project.name}"`,
          attachment: zipFile,
        }).catch(() => {});
      }

      // 4. Module files are NOT broadcast to the team any more. They used
      // to be sent to every manager + member (so the same file landed in
      // everyone's chat several times, and employees received each other's
      // work). The server now sends each new module file/link to the ADMIN
      // once, and only an admin's "Approve & send" forwards it to the next
      // member (see projects/handoff.py).
    }
  } catch (err) {
    console.error("Failed sending backend project notifications:", err);
  }
}
/* ----------------------------------------------------------------------
   MODULE ATTACHMENT (file or URL) -> ADMIN
   Whenever a manager or team member attaches a file or a reference URL
   to one of their modules, the admin should see it without having to
   go dig through every project — this posts a heads-up (plus the file
   itself, when there is one) straight to that person's own 1:1 thread
   with `sender: "user"`, which is what makes it render as "sent by
   them" / received-by-admin, same convention used everywhere else in
   this file for user->admin traffic. An admin attaching their own
   module file doesn't need to notify themselves, so this is a no-op
   for admins.
---------------------------------------------------------------------- */
function notifyAdminOfModuleAttachment(setConversations, approvedUsers, currentUserName, { text, file } = {}) {
  if (typeof setConversations !== "function") return;
  if (!text && !file) return;
  const me = (approvedUsers || []).find((u) => u.name === currentUserName);
  if (!me || me.role === "admin") return;

  const now = Date.now();
  const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDate = new Date(now).toISOString().slice(0, 10);

  setTimeout(() => {
    setConversations((prev) => {
      const userId = me.id;
      let found = false;
      const next = prev.map((c) => {
        const cid = c.authId || c.id;
        if (cid !== userId) return c;
        found = true;
        let nextId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
        const appended = [];
        if (text) appended.push({ id: nextId++, text, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: "user" });
        if (file) appended.push({ id: nextId++, file, time: nowTime, date: nowDate, timestamp: now, outgoing: false, sender: "user" });
        if (appended.length === 0) return c;
        return {
          ...c,
          messages: [...c.messages, ...appended],
          unread: (c.unread || 0) + 1,
          time: nowTime,
          lastMessageAt: now,
          lastMessageDate: nowDate,
        };
      });
      return found ? next : prev;
    });
  }, 0);
}



function AvatarStack({ names, darkMode, max = 3 }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((n) => (
        <div
          key={n}
          title={n}
          className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white ring-2 ${avatarColor(n)} ${
            darkMode ? "ring-slate-900" : "ring-white"
          }`}
        >
          {initials(n)}
        </div>
      ))}
      {rest > 0 && (
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ring-2 ${
            darkMode ? "bg-slate-800 text-slate-300 ring-slate-900" : "bg-slate-100 text-slate-500 ring-white"
          }`}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLES[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function StatCard({ icon: Icon, iconBg, iconText, label, value, delta, up, card, cardText, mutedText, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl p-4 ${card} ${onClick ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md" : ""} ${active ? "ring-2 ring-violet-500" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconText}`}>
          <Icon className="w-5 h-5" />
        </span>
      </div>
      <p className={`text-xs mt-2.5 truncate ${mutedText}`}>{label}</p>
      <p className={`text-xl sm:text-2xl font-extrabold mt-0.5 ${cardText}`}>{value}</p>
      {delta && (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold mt-2 ${up ? "text-emerald-600" : "text-rose-600"}`}>
          {up ? "↑" : "↓"} {delta} <span className={`font-normal ${mutedText}`}>vs last month</span>
        </span>
      )}
    </button>
  );
}

/* ======================================================================
   PERFORMANCE — per-person stats: how many projects they've completed,
   how much money they've earned from them, how many were delivered
   early / exactly on time / late, and how much bonus that earned them.

   There's no separate payroll/bonus backend, so the model here is
   simple and transparent: on a Completed project, its `spent` amount is
   split evenly across everyone on the team (the manager is already
   folded into `team` when a project is created/edited, so they're
   included automatically). Delivering before the deadline earns a 10%
   bonus on that person's share, delivering exactly on the deadline day
   earns 5%, and a late delivery earns no bonus — nothing else changes,
   the base amount is still paid either way.
====================================================================== */
const EARLY_BONUS_RATE = 0.10;
const ON_TIME_BONUS_RATE = 0.05;

function computeUserPerformance(projects, personName) {
  const stats = { completed: 0, early: 0, onTime: 0, late: 0, earned: 0, bonus: 0 };
  if (!personName) return stats;

  (projects || []).forEach((p) => {
    if (p.status !== "Completed") return;
    const onThisProject = p.manager === personName || (p.team || []).includes(personName);
    if (!onThisProject) return;

    const teamSize = (p.team || []).length || 1;
    const share = (Number(p.spent) || 0) / teamSize;

    // Fall back to the deadline itself if a project somehow has no
    // completedOn recorded (shouldn't happen for anything completed
    // through the UI, but keeps this safe for older/edited data).
    const completedOn = p.completedOn || p.deadline;
    const diffDays = daysBetween(completedOn, p.deadline);

    let bonusRate = 0;
    if (diffDays > 0) {
      stats.early += 1;
      bonusRate = EARLY_BONUS_RATE;
    } else if (diffDays === 0) {
      stats.onTime += 1;
      bonusRate = ON_TIME_BONUS_RATE;
    } else {
      stats.late += 1;
    }

    stats.completed += 1;
    stats.earned += share;
    stats.bonus += share * bonusRate;
  });

  return stats;
}

function MiniStat({ icon: Icon, tone, label, value, card, cardText, mutedText }) {
  const TONE_STYLES = {
    emerald: "bg-emerald-50 text-emerald-600",
    violet: "bg-violet-50 text-violet-600",
    blue: "bg-blue-50 text-blue-600",
    cyan: "bg-cyan-50 text-cyan-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
  };
  return (
    <div className={`rounded-xl p-3 flex items-center gap-2.5 ${card}`}>
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${TONE_STYLES[tone] || TONE_STYLES.violet}`}>
        <Icon className="w-4 h-4" />
      </span>
      <div className="min-w-0">
        <p className={`text-[10.5px] truncate ${mutedText}`}>{label}</p>
        <p className={`text-sm font-extrabold truncate ${cardText}`}>{value}</p>
      </div>
    </div>
  );
}

/* ======================================================================
   MODULES UI — shared between the sidebar Project Details panel and the
   Full Details modal, so both ever only need one implementation to stay
   in sync. Renders the modules progress bar, then one row per module
   (checkbox, name, status badge, assignee, priority, due date, and a
   paperclip that expands into the module's URL + any uploaded files).
====================================================================== */

function ModulesProgress({ modules, status, darkMode, cardText, mutedText, subtleText, barsPlay = true }) {
  const total = (modules || []).length;
  const done = (modules || []).filter((m) => m.status === "Completed").length;
  const pct = status === "Completed" ? 100 : total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="mb-2">
      <div className="flex items-center justify-between mb-1">
        <p className={`text-xs font-semibold flex items-center gap-1.5 ${cardText}`}><Layers className="w-3.5 h-3.5 text-violet-500" />Modules Progress</p>
        <span className={`text-[11px] font-semibold ${mutedText}`}>{pct}%</span>
      </div>
      <p className={`text-[11px] mb-1.5 ${subtleText}`}>{done} of {total} modules completed</p>
      <div className={`w-full h-2 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${pct === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-violet-600 to-indigo-500"}`}
          style={{ width: barsPlay ? `${pct}%` : "0%" }}
        />
      </div>
    </div>
  );
}

function ModuleRow({ module: m, project, isAdmin, currentUser, canManage, canUploadFile, darkMode, cardText, mutedText, subtleText, onToggleDone, onCycleStatus, onUploadFile, onDownloadFile, onSetUrl, onApproveHandoff, onDeleteFile }) {
  const [expanded, setExpanded] = useState(false);
  // Local draft so typing doesn't fire a save on every keystroke — only
  // committed (via onSetUrl) on blur or Enter, and only when it actually
  // changed from what's saved.
  const [urlDraft, setUrlDraft] = useState(m.url || "");
  useEffect(() => setUrlDraft(m.url || ""), [m.url, m.id]);
  const commitUrl = () => {
    const next = urlDraft.trim();
    if (next !== (m.url || "").trim()) onSetUrl?.(next);
  };
  const status = m.status || "Pending";
  // A module file is visible to an admin, whoever uploaded it, and the
  // project's own manager — not every random person who can see the
  // project.
  const canSeeFile = (f) => isAdmin || f.uploadedBy === currentUser || project.manager === currentUser;
  const hasExtra = m.url || (m.files || []).length > 0 || m.description;

  return (
    <div className={`rounded-xl px-3 py-2.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => canManage && onToggleDone()}
          disabled={!canManage}
          className={`w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 border ${
            status === "Completed" ? "bg-violet-600 border-violet-600" : darkMode ? "border-slate-600" : "border-slate-300"
          } ${canManage ? "" : "opacity-60"}`}
          aria-label="Toggle module done"
        >
          {status === "Completed" && <Check className="w-3 h-3 text-white" />}
        </button>
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex-1 min-w-0 flex items-center gap-1 text-left">
          <span className={`text-xs font-semibold truncate ${cardText}`}>{m.name}</span>
          <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${mutedText} ${expanded ? "rotate-90" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => canManage && onCycleStatus()}
          disabled={!canManage}
          className={`shrink-0 px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap ${MODULE_STATUS_STYLES[status] || MODULE_STATUS_STYLES.Pending}`}
        >
          {status}
        </button>
      </div>

      {status === "Completed" && m.handoffStatus === "pending" && isAdmin && (
        <div className="mt-1.5 pl-[26px]">
          <button
            type="button"
            onClick={() => onApproveHandoff?.()}
            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold px-3 py-1 transition"
          >
            <Check className="w-3 h-3" /> Approve &amp; send{m.handoffNext ? ` to ${m.handoffNext}` : " to next member"}
          </button>
        </div>
      )}
      {status === "Completed" && m.handoffStatus === "pending" && !isAdmin && (
        <p className={`mt-1.5 pl-[26px] text-[10.5px] ${subtleText}`}>⏳ Waiting for admin approval before it goes to the next member.</p>
      )}
      {status === "Completed" && m.handoffStatus === "sent" && (
        <p className="mt-1.5 pl-[26px] text-[10.5px] text-emerald-600">✓ Sent to the next member.</p>
      )}

      <div className="flex items-center gap-2 mt-1.5 pl-[26px] flex-wrap">
        {m.assignee && m.assignee !== "Unassigned" && (
          <span
            title={m.assignee}
            className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white shrink-0 ${avatarColor(m.assignee)}`}
          >
            {initials(m.assignee)}
          </span>
        )}
        {m.priority && (
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${MODULE_PRIORITY_STYLES[m.priority] || MODULE_PRIORITY_STYLES.Medium}`}>
            {m.priority}
          </span>
        )}
        {m.dueDate && (
          <span className={`text-[10.5px] flex items-center gap-1 ${subtleText}`}>
            <Calendar className="w-3 h-3" />Due {fmtDate(m.dueDate)}
          </span>
        )}
        {isAdmin && Number(m.price) > 0 && (
          <span className="text-[10.5px] font-semibold text-violet-600">{fmtMoney(m.price)}</span>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`ml-auto shrink-0 w-6 h-6 rounded-lg flex items-center justify-center relative ${mutedText} ${darkMode ? "hover:bg-slate-700" : "hover:bg-slate-200"}`}
          aria-label="Module files"
        >
          <Paperclip className="w-3.5 h-3.5" />
          {(m.files || []).length > 0 && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 pl-[26px] space-y-1.5">
          {m.description && <p className={`text-[11px] leading-relaxed ${mutedText}`}>{m.description}</p>}

          {/* URL — editable right here once work is done (e.g. paste the
              live frontend link once it's deployed), not just from the
              Edit Project form. Read-only, open-only link for anyone who
              can't manage the module. */}
          {canManage ? (
            <div className="flex items-center gap-1.5">
              <Link2 className={`w-3 h-3 shrink-0 ${subtleText}`} />
              <input
                type="url"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={commitUrl}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitUrl();
                    e.target.blur();
                  }
                }}
                placeholder="Add a URL for this module (e.g. the live frontend link)"
                className={`flex-1 min-w-0 text-[11px] border rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-200"}`}
              />
              {m.url && (
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-violet-600" aria-label="Open module URL">
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          ) : (
            m.url && (
              <a
                href={m.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:underline break-all"
              >
                <Link2 className="w-3 h-3 shrink-0" /> {m.url} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
              </a>
            )
          )}

          {(m.files || []).map((f) => (
            <div key={f.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${darkMode ? "bg-slate-800" : "bg-white"}`}>
              <FileText className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`flex-1 min-w-0 truncate text-[11px] ${cardText}`}>{f.fileName}</span>
              <span className={`text-[10px] shrink-0 ${subtleText}`}>{f.uploadedBy}</span>
              {canSeeFile(f) ? (
                <button type="button" onClick={() => onDownloadFile(f)} className={mutedText} aria-label="Download file">
                  <Download className="w-3.5 h-3.5" />
                </button>
              ) : (
                <Lock className={`w-3 h-3 ${subtleText}`} />
              )}
              {canManage && canSeeFile(f) && onDeleteFile && (
                <button type="button" onClick={() => onDeleteFile(f)} className="text-slate-400 hover:text-rose-500" aria-label="Delete file" title="Delete file">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
          {!hasExtra && !canManage && <p className={`text-[10.5px] ${subtleText}`}>No link or files added to this module yet.</p>}
          {canUploadFile && (
            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:text-violet-700 cursor-pointer">
              <Plus className="w-3 h-3" /> Upload file
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUploadFile(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function ModulesSection({ project, isAdmin, currentUser, darkMode, cardText, mutedText, subtleText, barsPlay, onToggleDone, onCycleStatus, onUploadFile, onDownloadFile, onSetUrl, onApproveHandoff, onDeleteFile, maxHeight = "max-h-72" }) {
  const modules = project.modules || [];
  // Who's allowed to move a module along (check it off / cycle its
  // status / attach a file or URL to it) — an admin, the project's
  // manager, or anyone actually on its team. Random viewers of the
  // project can't.
  const canManage =
    isAdmin ||
    project.manager === currentUser ||
    (project.team || []).includes(currentUser) ||
    modules.some((m) => m.assignee === currentUser); // a module assignee can always tick/attach on their own module
  const moduleTotal = modules.reduce((sum, m) => sum + (Number(m.price) || 0), 0);

  return (
    <div className="mb-4">
      <ModulesProgress modules={modules} status={project.status} darkMode={darkMode} cardText={cardText} mutedText={mutedText} subtleText={subtleText} barsPlay={barsPlay} />
      {modules.length > 0 ? (
        <div className={`space-y-1.5 ${maxHeight} overflow-y-auto`}>
          {modules.map((m) => (
            <ModuleRow
              key={m.id}
              module={m}
              project={project}
              isAdmin={isAdmin}
              currentUser={currentUser}
              canManage={canManage}
              canUploadFile={canManage}
              darkMode={darkMode}
              cardText={cardText}
              mutedText={mutedText}
              subtleText={subtleText}
              onToggleDone={() => onToggleDone(m.id)}
              onCycleStatus={() => onCycleStatus(m.id)}
              onUploadFile={(file) => onUploadFile(m.id, file)}
              onDownloadFile={onDownloadFile}
              onSetUrl={(url) => onSetUrl?.(m.id, url)}
              onApproveHandoff={() => onApproveHandoff?.(m.id)}
              onDeleteFile={onDeleteFile ? (f) => onDeleteFile(m.id, f) : undefined}
            />
          ))}
        </div>
      ) : (
        <p className={`text-xs ${subtleText}`}>No modules added yet. Use Edit to add one.</p>
      )}
      {isAdmin && moduleTotal > 0 && (
        <p className={`text-[11px] pt-1.5 ${subtleText}`}>
          Modules total <span className="font-semibold text-violet-600">{fmtMoney(moduleTotal)}</span> — added to budget for a final cost of{" "}
          <span className="font-semibold text-violet-600">{fmtMoney((project.budget || 0) + moduleTotal)}</span>.
        </p>
      )}
    </div>
  );
}

/* ======================================================================
   MAIN PAGE
====================================================================== */

/* `conversations` / `setConversations` are the SAME shared state Dashboard.jsx
   passes to MessagesPage (see the note there about them being mirrored to
   localStorage) — Dashboard.jsx now passes them here too, which is what
   lets a project's team automatically get a group conversation over on
   the Messages page. Both props are optional: if they're ever missing,
   every call below silently no-ops and the rest of this page works
   exactly as before.

   `onNavigate` is the same page-switch callback ReportsPage.jsx already
   accepts (e.g. Dashboard.jsx wiring `onNavigate={(page) => setActivePage(page)}`).
   It's what "View Daily Reports" on a completed project uses to jump over
   to the Reports page already filtered to that project. If it's missing,
   the one-shot nav hint (PROJECT_FOCUS_LS_KEY, see above — not report data)
   is still written, the user just has to switch to Reports manually to see
   it applied. */
export default function ProjectsPage({ darkMode = false, conversations, setConversations, onNavigate = () => {} }) {
  const { user, approvedUsers, canCreate, canEdit, canDelete } = useAuth();
  // Ids of employees paid per project (not a monthly salary) — used to save
  // the commission typed in the Create/Edit Project popups.
  const perProjectIds = usePerProjectIds();
  const canCreateProjects = canCreate("Projects");
  const canEditProjects = canEdit("Projects");
  const canDeleteProjects = canDelete("Projects");

  // Only an admin should see money figures on this page (the aggregate
  // "Total Budget" stat, and each project's Budget/Spent numbers).
  const isAdmin = getRoleCategory(user?.role) === "admin";

  // The logged-in person, for the "My Projects" tab — no longer hardcoded.
  const CURRENT_USER = user?.name || "You";

  // Opening the Projects page means the logged-in user has now seen
  // whatever they were assigned, so clear their sidebar red dot.
  useEffect(() => {
    clearAssignmentNotification(CURRENT_USER);
  }, [CURRENT_USER]);

  // Only users an admin has actually approved in Users page show up here,
  // so a project can only ever be assigned to someone who can log in.
  // Client portal logins (role "client") are approved users too, but they
  // are NOT staff — they must never be offered as manager / team member /
  // module assignee, so they are filtered out here.
  const isClientUser = (u) => getRoleCategory(u?.role) === "client";
  const approvedNames = useMemo(
    () => Array.from(new Set((approvedUsers || []).filter((u) => !isClientUser(u)).map((u) => u.name).filter(Boolean))),
    [approvedUsers]
  );
  const clientUserNames = useMemo(
    () => Array.from(new Set((approvedUsers || []).filter(isClientUser).map((u) => u.name).filter(Boolean))),
    [approvedUsers]
  );

  // Name -> department lookup, so the Create/Edit project forms can show
  // each approved user's department right next to their full name in the
  // manager/team-member pickers — makes it much easier to tell people
  // apart and assign the right person, instead of a bare list of names.
  const teamDirectory = useMemo(() => {
    const map = {};
    (approvedUsers || []).forEach((u) => {
      if (u.name) map[u.name] = u.department || "";
    });
    return map;
  }, [approvedUsers]);

  // Real clients pulled live from the Clients page's own storage — this
  // is the "link" between the two pages: whatever exists on Clients
  // right now is exactly what's offered when adding a "Client Project"
  // here. Re-read on focus/storage so adding a client over there shows
  // up here without a full reload, same pattern used elsewhere in this
  // app (e.g. ClientsPage re-reading Tasks' writes).
  const [realClients, setRealClients] = useState(loadRealClients);
  useEffect(() => {
    const refresh = () => setRealClients(loadRealClients());
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const [projects, setProjects] = useState([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState("");
  const [projectsShowingCache, setProjectsShowingCache] = useState(false);
  // Becomes true only after a real fetch from the backend succeeds. Until
  // then the save-to-localStorage effect below must NOT run, otherwise the
  // initial empty list would overwrite the last good cached copy.
  const projectsHydratedRef = useRef(false);

  // Real data: fetch the live project list from the Django backend on
  // mount (and whenever the approved-users list first becomes available,
  // since manager/team IDs can only be resolved to display names once we
  // actually have that list). Falls back to whatever was last cached in
  // localStorage if the backend request fails (e.g. server not running),
  // so the page doesn't just go blank.
  useEffect(() => {
    let cancelled = false;
    async function loadFromBackend() {
      setProjectsLoading(true);
      try {
        const data = await projectsApi.listProjects();
        if (cancelled) return;
        const mapped = (Array.isArray(data) ? data : data?.results || []).map((bp) =>
          backendProjectToFrontend(bp, approvedUsers)
        );
        projectsHydratedRef.current = true; // from here on it's safe to cache edits
        setProjects(mapped);
        setProjectsError("");
        setProjectsShowingCache(false);
        saveStoredProjects(mapped); // keep the cache fresh for other pages that read it
      } catch (err) {
        if (cancelled) return;
        setProjectsError(err.message || "Couldn't reach the server.");
        // Fall back to the last copy that really came from the server. Never
        // to fake demo data: if there's no real cache the list stays empty.
        const cached = loadStoredProjects();
        setProjects(cached);
        setProjectsShowingCache(cached.length > 0);
      } finally {
        if (!cancelled) setProjectsLoading(false);
      }
    }
    loadFromBackend();
    return () => {
      cancelled = true;
    };
  }, [approvedUsers]);

  // Role-based visibility: an admin sees every project in the workspace.
  // Anyone else (employees/team members) should ONLY ever see projects
  // they're actually on — as the manager or as a team member. This is
  // the single source of truth for what a non-admin is allowed to see
  // on this page (stat cards, All/Status/Client tabs, PDF export, and
  // the sticky details panel all read from this, not the raw `projects`
  // list), so an employee can never see another employee's projects.
  const visibleProjects = useMemo(() => {
    if (isAdmin) return projects;
    // FIX: a module assignee is part of the project's group even if the
    // team list on this browser is stale.
    return projects.filter(
      (p) =>
        p.manager === CURRENT_USER ||
        (p.team || []).includes(CURRENT_USER) ||
        (p.modules || []).some((m) => m.assignee === CURRENT_USER)
    );
  }, [projects, isAdmin, CURRENT_USER]);

  // The logged-in person's own performance summary: how many projects
  // they've completed, total money earned from them, how many were
  // delivered early / on time / late, and total bonus earned. Purely
  // derived from `projects`, so it updates automatically the moment a
  // project they're on is marked Completed.
  const myPerformance = useMemo(
    () => computeUserPerformance(projects, CURRENT_USER),
    [projects, CURRENT_USER]
  );

  // Admin-only: every approved user's own performance, not just the
  // logged-in admin's. This is what powers the "Team Performance" table
  // shown to admins in the My Projects tab — an admin should be able to
  // see how much each real (approved) team member has completed/earned,
  // not just their own numbers. Sorted by total earned, highest first,
  // and only ever built from approvedUsers so a removed/rejected/fake
  // name can never appear here.
  const teamPerformance = useMemo(() => {
    if (!isAdmin) return [];
    return (approvedUsers || [])
      .filter((u) => u.name)
      .map((u) => ({ id: u.id, name: u.name, role: u.role, department: u.department, ...computeUserPerformance(projects, u.name) }))
      .sort((a, b) => b.earned - a.earned);
  }, [isAdmin, approvedUsers, projects]);

  const [activeTab, setActiveTab] = useState("all");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [clientFilter, setClientFilter] = useState("All Clients");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  /* Progress bars "fill in" animation — starts empty, fills to the real
     % a beat after the page mounts, the visible page of rows changes, or
     a different project is selected, so the Progress column / detail
     panel bars always animate on open. */
  const [progressPlay, setProgressPlay] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // Auto-open the first project once the real list has loaded, same
  // behavior the old synchronous localStorage read used to give for free.
  useEffect(() => {
    if (selectedId == null && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedId]);
  useEffect(() => {
    setProgressPlay(false);
    const t = setTimeout(() => setProgressPlay(true), 60);
    return () => clearTimeout(t);
  }, [page, selectedId]);
  // Desktop keeps its old behavior: the first project auto-opens in the
  // sticky right column. On mobile that same "open" state used to make a
  // full-screen dark overlay + bottom sheet pop up the INSTANT the page
  // loaded, sitting on top of the card list before the user tapped
  // anything. Any tap meant to hit a card underneath actually landed on
  // that overlay's backdrop instead, which closes the sheet — which is
  // exactly the "box disappears" / "scrolls down" behavior being reported.
  // So on mobile we start closed; tapping a card is what opens it, same
  // as everywhere else in the app.
  const [detailsOpen, setDetailsOpen] = useState(() => typeof window !== "undefined" ? window.innerWidth >= 1024 : true);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  // Screen position of the open row-actions (3-dot) menu. The menu is drawn in
  // a portal on <body> with position:fixed, so the table's overflow container
  // can no longer clip it ("pop up goes inside the div").
  const [actionMenuPos, setActionMenuPos] = useState(null);
  useEffect(() => {
    if (openActionMenu == null) return undefined;
    const close = () => setOpenActionMenu(null);
    const onDown = (e) => {
      if (e.target.closest?.("[data-action-menu]") || e.target.closest?.("[data-action-toggle]")) return;
      close();
    };
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true); // capture: also inner scroll areas
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [openActionMenu]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // FIX (ticked module reverted / never reached other devices): a module
  // tick used to change local state only, so the live refresh below would
  // pull the OLD status back from the server a few seconds later. These two
  // refs let the refresh know a module save is in flight (or happened while
  // it was fetching) so it throws that snapshot away instead of overwriting.
  const moduleSavesPendingRef = useRef(0);
  const moduleMutationSeqRef = useRef(0);

  // FIX (project created/edited/assigned on one device never showed on
  // another until a manual reload): the list above loads once on mount.
  // Silently re-pull it every 15s / on focus / on reconnect. Skipped while
  // the create/edit form is open (a multi-step save could otherwise be
  // overwritten mid-way) and until the first real load has happened.
  const approvedUsersLiveRef = useRef(approvedUsers);
  approvedUsersLiveRef.current = approvedUsers;
  useLiveRefresh(
    async () => {
      if (!projectsHydratedRef.current) return;
      if (createOpen || editingId != null) return;
      if (moduleSavesPendingRef.current > 0) return;
      const seqBefore = moduleMutationSeqRef.current;
      const data = await projectsApi.listProjects();
      // A module was ticked while this request was in flight: the snapshot
      // may not include it yet, so drop it (the next tick of the timer
      // fetches a fresh one).
      if (moduleSavesPendingRef.current > 0 || seqBefore !== moduleMutationSeqRef.current) return;
      const mapped = (Array.isArray(data) ? data : data?.results || []).map((bp) =>
        backendProjectToFrontend(bp, approvedUsersLiveRef.current)
      );
      setProjects((prev) => (sameJson(prev, mapped) ? prev : mapped));
      saveStoredProjects(mapped);
    },
    { interval: 5000 } // links/files attached on the Tasks page show up within seconds
  );
  const [toasts, setToasts] = useState([]);
  const [fullDetailsId, setFullDetailsId] = useState(null);
  const [previewFile, setPreviewFile] = useState(null);
  const filtersRef = useRef(null);

  // Tapping a stat card (Total Projects, In Progress, etc.) filters the
  // list below it — but on mobile that list can be a full screen-height
  // away, so the filter change alone isn't visible. This scrolls the
  // project list box into view after the tap, same as the Employees page.
  // Desktop's layout already has both on screen together, so it's a no-op
  // there.
  const tableSectionRef = useRef(null);
  const scrollToTableOnMobile = () => {
    if (window.innerWidth >= 1024) return; // lg breakpoint — desktop layout, no scroll needed
    tableSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Tracks whether we're below the `lg` breakpoint (1024px): desktop keeps
  // the sticky right column, mobile opens the same details in a centered
  // popup modal instead — same pattern as the Employees page, so tapping a
  // card just opens its data directly with no scrolling involved at all.
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 1024);
  useEffect(() => {
    const checkIsMobile = () => setIsMobile(window.innerWidth < 1024);
    checkIsMobile();
    window.addEventListener("resize", checkIsMobile);
    return () => window.removeEventListener("resize", checkIsMobile);
  }, []);

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200";
  const cardText = darkMode ? "text-slate-100" : "text-slate-900";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200 bg-white text-slate-900";
  const rowHover = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";

  const showToast = (message, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  useEffect(() => setPage(1), [activeTab, statusFilter, clientFilter, search, rowsPerPage]);

  // Save to localStorage every time the projects list changes (create/edit/status/delete)
  // so navigating to another page and back keeps everything until you explicitly delete it.
  useEffect(() => {
    if (!projectsHydratedRef.current) return; // don't cache the pre-fetch empty list / offline fallback
    saveStoredProjects(projects);
  }, [projects]);

  useEffect(() => {
    function onClickOutside(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Keep project team/manager assignments in sync with the Users page.
  // The FIRST time we get a real approved-users list, any name sitting in
  // a project's team/manager that isn't an actual approved user (e.g. the
  // demo's placeholder seed names) is silently cleaned up — this is what
  // fixes "fake" names showing up. After that, every time someone is
  // actually removed from the Users page, they're dropped from every
  // project's team (and un-assigned as manager) automatically, with a toast.
  const prevApprovedRef = useRef(null);
  useEffect(() => {
    // Wait for a real, non-empty approved-users list before doing anything.
    // This guards against an async/loading AuthContext briefly reporting
    // an empty array — acting on that would wrongly wipe every assignment.
    if (!Array.isArray(approvedUsers) || approvedNames.length === 0) return;
    const approvedSet = new Set(approvedNames);

    if (prevApprovedRef.current === null) {
      // First real load — purge anything that was never an approved user.
      prevApprovedRef.current = approvedSet;
      setProjects((list) =>
        list.map((p) => {
          const newTeam = p.team.filter((n) => approvedSet.has(n));
          const managerInvalid = p.manager && p.manager !== "Unassigned" && !approvedSet.has(p.manager);
          if (newTeam.length !== p.team.length || managerInvalid) {
            return { ...p, team: newTeam, manager: managerInvalid ? "Unassigned" : p.manager };
          }
          return p;
        })
      );
      return;
    }

    const removedNames = [...prevApprovedRef.current].filter((n) => !approvedSet.has(n));
    prevApprovedRef.current = approvedSet;
    if (removedNames.length === 0) return;
    const removedSet = new Set(removedNames);

    setProjects((list) =>
      list.map((p) => {
        const newTeam = p.team.filter((n) => !removedSet.has(n));
        const managerRemoved = removedSet.has(p.manager);
        if (newTeam.length !== p.team.length || managerRemoved) {
          return { ...p, team: newTeam, manager: managerRemoved ? "Unassigned" : p.manager };
        }
        return p;
      })
    );
    showToast(
      `${removedNames.join(", ")} ${removedNames.length > 1 ? "were" : "was"} removed from all assigned projects.`,
      "error"
    );
  }, [approvedNames, approvedUsers]);

  // Every stat card below is built from `visibleProjects`, not the raw
  // `projects` list — so for an admin these totals are workspace-wide,
  // and for anyone else they only ever count projects assigned to them.
  const counts = useMemo(
    () => ({
      total: visibleProjects.length,
      inProgress: visibleProjects.filter((p) => p.status === "In Progress").length,
      completed: visibleProjects.filter((p) => p.status === "Completed").length,
      onHold: visibleProjects.filter((p) => p.status === "On Hold").length,
      cancelled: visibleProjects.filter((p) => p.status === "Cancelled").length,
      totalBudget: visibleProjects.reduce((sum, p) => sum + p.budget, 0),
    }),
    [visibleProjects]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Base list is `visibleProjects`: admins get every project, everyone
    // else only ever gets their own assigned ones — so "All Projects",
    // "By Status" and "By Client" can never surface a project that isn't
    // theirs. The "my" tab still narrows further within that same base
    // (a no-op for non-admins, since it's already just their projects).
    let list = visibleProjects.filter((p) => {
      const matchesTab =
        activeTab === "all" ||
        activeTab === "status" ||
        activeTab === "client" ||
        (activeTab === "my" && (p.manager === CURRENT_USER || (p.team || []).includes(CURRENT_USER)));
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.client.toLowerCase().includes(q) || p.description.toLowerCase().includes(q);
      const matchesStatus = statusFilter === "All Status" || p.status === statusFilter;
      const matchesClient = clientFilter === "All Clients" || p.client === clientFilter;
      return matchesTab && matchesSearch && matchesStatus && matchesClient;
    });

    // "By Status" and "By Client" group/sort the results so switching tabs visibly changes the data order
    if (activeTab === "status") {
      const order = STATUS_OPTIONS;
      list = [...list].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
    } else if (activeTab === "client") {
      list = [...list].sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name));
    }
    return list;
  }, [visibleProjects, activeTab, search, statusFilter, clientFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageStart = (page - 1) * rowsPerPage;
  const paged = filtered.slice(pageStart, pageStart + rowsPerPage);

  // Resolved against `visibleProjects` (not raw `projects`) so the sticky
  // details panel / mobile popup can never land on a project outside this
  // person's own scope — e.g. a stale selectedId from a previous session,
  // or the very first project on the page for someone who isn't on it.
  const selected = visibleProjects.find((p) => p.id === selectedId) || visibleProjects[0] || null;
  const fullDetailsProject = projects.find((p) => p.id === fullDetailsId) || null;
  const editingProject = projects.find((p) => p.id === editingId) || null;

  const openDetails = (id) => {
    setSelectedId(id);
    setDetailsOpen(true);
    setOpenActionMenu(null);
  };

  // `link` is only used (and required by the UI) when status is being
  // set to "Completed" — it's the workable link (deployed site, repo,
  // doc, etc.) attached at the moment the project is marked complete.
  const setStatus = (id, status, link) => {
    projectsApi.updateProject(id, { status }).catch((err) => {
      showToast(err.message || "Couldn't save status to the server.", "error");
    });
    setProjects((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        // Record the real completion date the moment a project actually
        // becomes Completed — this is what powers the early/on-time/late
        // delivery stats in "My Performance". Moving a project OFF
        // Completed (e.g. reopened) clears it, so re-completing it later
        // records a fresh, accurate date instead of an old stale one.
        if (status === "Completed" && p.status !== "Completed") {
          // Marking a project Completed should visibly finish its progress
          // bar too — mark every module Completed so the modules-based
          // progress bar (see moduleStats) catches up to 100%.
          const modules = (p.modules || []).map((m) => ({ ...m, status: "Completed" }));
          return {
            ...p,
            status,
            modules,
            completedOn: new Date().toISOString().slice(0, 10),
            completionLink: link || p.completionLink || "",
          };
        }
        if (status !== "Completed" && p.completedOn) {
          return { ...p, status, completedOn: undefined };
        }
        return { ...p, status };
      })
    );
    setOpenActionMenu(null);
    showToast(`Project marked as ${status}.`, "success");
  };

  // FIX (module tick was local-only): saves ONE module's status to the
  // backend right away (PATCH sends only `status`, so nothing else on the
  // module or its task can be overwritten). If the server refuses, just
  // that module goes back to what it showed before and a toast says why.
  const persistModuleStatus = async (projectId, moduleId, nextStatus, prevStatus) => {
    // Brand-new modules from the create/edit form have a temporary "m-..."
    // id and are saved by that form's own Save button, not here.
    if (typeof moduleId === "string" && moduleId.startsWith("m-")) return;
    moduleSavesPendingRef.current += 1;
    moduleMutationSeqRef.current += 1;
    try {
      await projectsApi.updateModule(projectId, moduleId, { status: nextStatus });
    } catch (err) {
      setProjects((list) =>
        list.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                modules: (p.modules || []).map((m) =>
                  m.id === moduleId && m.status === nextStatus ? { ...m, status: prevStatus } : m
                ),
              }
        )
      );
      showToast(err.message || "Module status server par save nahi hua.", "error");
    } finally {
      moduleSavesPendingRef.current -= 1;
      moduleMutationSeqRef.current += 1;
    }
  };

  // Modules progress is always derived live from each module's `status`
  // (see moduleStats) — nothing else needs to be recomputed here.
  // Checkbox click: straight toggle between Completed and Pending.
  const toggleModuleDone = (projectId, moduleId) => {
    const current = (projects.find((p) => p.id === projectId)?.modules || []).find((m) => m.id === moduleId);
    if (!current) return;
    const prevStatus = current.status || "Pending";
    const nextStatus = prevStatus === "Completed" ? "Pending" : "Completed";
    setProjects((list) =>
      list.map((p) => {
        if (p.id !== projectId) return p;
        const modules = (p.modules || []).map((m) => (m.id === moduleId ? { ...m, status: nextStatus } : m));
        return { ...p, modules };
      })
    );
    persistModuleStatus(projectId, moduleId, nextStatus, prevStatus);
  };
  // Status badge click: cycles Pending -> In Progress -> Completed -> Pending.
  const cycleModuleStatus = (projectId, moduleId) => {
    const current = (projects.find((p) => p.id === projectId)?.modules || []).find((m) => m.id === moduleId);
    if (!current) return;
    const prevStatus = current.status || "Pending";
    const idx = MODULE_STATUS_OPTIONS.indexOf(prevStatus);
    const nextStatus = MODULE_STATUS_OPTIONS[(idx + 1) % MODULE_STATUS_OPTIONS.length];
    setProjects((list) =>
      list.map((p) => {
        if (p.id !== projectId) return p;
        const modules = (p.modules || []).map((m) => (m.id === moduleId ? { ...m, status: nextStatus } : m));
        return { ...p, modules };
      })
    );
    persistModuleStatus(projectId, moduleId, nextStatus, prevStatus);
  };
  // Attaches a real, downloadable file to one module (spec doc,
  // screenshot, deliverable, whatever the assignee needs to share) —
  // same IndexedDB-backed storage as the project brief/ZIP uploads.
  const handleUploadModuleFile = async (projectId, moduleId, file) => {
    if (!file) return;
    // FIX (one file shown twice): the live refresh could fetch the project
    // while this upload was still running, already containing the new file,
    // and then this handler appended the same file again. While an upload is
    // in flight the refresh is now skipped (and any in-progress snapshot is
    // discarded), and the append below ignores a file that is already there.
    moduleSavesPendingRef.current += 1;
    moduleMutationSeqRef.current += 1;
    try {
      const entry = await saveModuleFile(file);
      const localFileEntry = { ...entry, uploadedBy: CURRENT_USER, uploadedOn: new Date().toISOString().slice(0, 10) };
      let fileEntry = localFileEntry;
      // FIX (file attached from the module panel never reached the server, so
      // it never showed on the Tasks / Clients / Zip Files pages): upload it to
      // the backend like the Create/Edit forms already do. The backend then
      // mirrors it onto the module's tasks. A module that is still unsaved
      // (temporary "m-..." id) is uploaded by its form's own Save instead.
      const isSavedModule = !(typeof moduleId === "string" && moduleId.startsWith("m-"));
      if (isSavedModule) {
        try {
          const uploaded = await projectsApi.uploadModuleFile(projectId, moduleId, file);
          fileEntry = {
            id: uploaded.id,
            fileName: uploaded.original_name,
            mime: uploaded.mime_type,
            size: uploaded.size,
            uploadedBy: uploaded.uploaded_by_name || CURRENT_USER,
            uploadedOn: (uploaded.uploaded_at || "").slice(0, 10) || localFileEntry.uploadedOn,
            fileUrl: uploaded.file,
            storedOnBackend: true,
          };
        } catch (upErr) {
          showToast(upErr.message || "File server par save nahi hui — sirf is device par hai.", "error");
        }
      }
      let moduleName = "a module";
      let projectName = "";
      setProjects((list) =>
        list.map((p) => {
          if (p.id !== projectId) return p;
          moduleName = (p.modules || []).find((m) => m.id === moduleId)?.name || moduleName;
          projectName = p.name;
          const modules = (p.modules || []).map((m) =>
            m.id === moduleId ? { ...m, files: dedupeById([...(m.files || []), fileEntry]) } : m
          );
          return { ...p, modules };
        })
      );
      // The admin is told by the server (once) and the next member gets it
      // only after the admin approves - nothing is broadcast from here.

      showToast(`${file.name} uploaded to the module.`, "success");
    } catch (e) {
      showToast(e.message || "Couldn't upload that file.", "error");
    } finally {
      moduleSavesPendingRef.current -= 1;
      moduleMutationSeqRef.current += 1;
    }
  };
  const downloadModuleFile = (file) => downloadStoredFile(file, showToast);

  // Setting a module's URL live from the sidebar/Full Details panel —
  // e.g. pasting the deployed frontend link once that module's done —
  // not just from the Create/Edit forms. Same admin-notification rule
  // as a file upload: a non-admin setting/changing this gets forwarded
  // straight to the admin (see notifyAdminOfModuleAttachment).
  const handleSetModuleUrl = (projectId, moduleId, url) => {
    const trimmed = (url || "").trim();
    let moduleName = "a module";
    let projectName = "";
    let prevUrl = "";
    // FIX (link set from the module panel never reached the server): save it
    // on the backend too, same pattern as persistModuleStatus — the backend
    // mirrors it onto the module's tasks, and the Clients page reads it from
    // the same module. Reverted with a toast if the save fails.
    const prevSavedUrl =
      ((projects.find((p) => p.id === projectId)?.modules || []).find((m) => m.id === moduleId)?.url || "").trim();
    const isSavedModule = !(typeof moduleId === "string" && moduleId.startsWith("m-"));
    if (isSavedModule && trimmed !== prevSavedUrl) {
      moduleSavesPendingRef.current += 1;
      moduleMutationSeqRef.current += 1;
      projectsApi
        .updateModule(projectId, moduleId, { url: trimmed })
        .catch((err) => {
          setProjects((list) =>
            list.map((p) =>
              p.id !== projectId
                ? p
                : {
                    ...p,
                    modules: (p.modules || []).map((m) =>
                      m.id === moduleId && (m.url || "").trim() === trimmed ? { ...m, url: prevSavedUrl } : m
                    ),
                  }
            )
          );
          showToast(err.message || "Link server par save nahi hua.", "error");
        })
        .finally(() => {
          moduleSavesPendingRef.current -= 1;
          moduleMutationSeqRef.current += 1;
        });
    }
    setProjects((list) =>
      list.map((p) => {
        if (p.id !== projectId) return p;
        const existing = (p.modules || []).find((m) => m.id === moduleId);
        moduleName = existing?.name || moduleName;
        prevUrl = existing?.url || "";
        projectName = p.name;
        const modules = (p.modules || []).map((m) => (m.id === moduleId ? { ...m, url: trimmed } : m));
        return { ...p, modules };
      })
    );
  };

  // Admin approval: sends a completed module's link/files (already in the
  // admin's chat) on to the next member, with the "continue" note.
  const approveModuleHandoff = async (projectId, moduleId) => {
    try {
      const updated = await projectsApi.approveModuleHandoff(projectId, moduleId);
      setProjects((list) =>
        list.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                modules: (p.modules || []).map((m) =>
                  m.id === moduleId ? { ...m, handoffStatus: updated?.handoff_status || "sent", handoffNext: "" } : m
                ),
              }
        )
      );
      showToast(updated?.message || "Sent to the next member.", "success");
    } catch (err) {
      showToast(err.message || "Could not send to the next member.", "error");
    }
  };

  // Delete a file from a module at any time (also after it was completed).
  // Backend files are deleted on the server (which also removes it from the
  // module's tasks); a device-only file is just dropped locally.
  const handleDeleteModuleFile = async (projectId, moduleId, file) => {
    const isSavedModule = !(typeof moduleId === "string" && moduleId.startsWith("m-"));
    if (isSavedModule && file.storedOnBackend) {
      moduleSavesPendingRef.current += 1;
      moduleMutationSeqRef.current += 1;
      try {
        await projectsApi.deleteModuleFile(projectId, moduleId, file.id);
      } catch (err) {
        showToast(err.message || "File could not be deleted.", "error");
        return;
      } finally {
        moduleSavesPendingRef.current -= 1;
        moduleMutationSeqRef.current += 1;
      }
    }
    setProjects((list) =>
      list.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              modules: (p.modules || []).map((m) =>
                m.id === moduleId ? { ...m, files: (m.files || []).filter((x) => x.id !== file.id) } : m
              ),
            }
      )
    );
    showToast(`${file.fileName || "File"} deleted.`, "success");
  };

  const removeProject = (id) => {
    const target = projects.find((p) => p.id === id);
    setProjects((list) => list.filter((p) => p.id !== id));
    setOpenActionMenu(null);
    if (selectedId === id) setDetailsOpen(false);
    if (fullDetailsId === id) setFullDetailsId(null);
    // Real archive on the backend (soft-delete — ProjectViewSet.destroy
    // sets is_archived=True, it doesn't wipe the row). If this fails,
    // put the project back in the list so the UI doesn't lie about it
    // being gone.
    projectsApi.archiveProject(id).catch((err) => {
      showToast(err.message || "Couldn't delete on the server — restoring it here.", "error");
      if (target) setProjects((list) => [target, ...list]);
    });
    // Deleting a project also deletes every daily report (and attached
    // photo/video) tagged with it over on the Reports page — nothing
    // related should be left behind pointing at a project that no longer
    // exists. Best-effort/async: never blocks the project deletion itself.
    if (target?.name) {
      purgeDailyReportsForProject(target.name).catch((err) => {
        showToast(
          `Project deleted, but its daily reports couldn't be removed (${err?.message || "server error"}). You can delete them from the Reports page.`,
          "error"
        );
      });
    }
    showToast(`${target?.name || "Project"} deleted.`, "error");
  };

  // Jumps to the Reports page with its Daily Reports section pre-filtered
  // to this project, so its related work-log photos/videos show up right
  // away — used by the "View Daily Reports" action on completed projects.
  const viewProjectDailyReports = (project) => {
    try {
      window.localStorage.setItem(PROJECT_FOCUS_LS_KEY, project.name);
      // Same-tab signal — if ReportsPage happens to already be mounted
      // (kept alive by the parent's page-switching), it can react
      // immediately instead of only picking this up on its next mount.
      window.dispatchEvent(new Event("reports-project-focus-changed"));
    } catch {
      // storage unavailable — onNavigate below still fires, Reports page
      // just won't be pre-filtered
    }
    setOpenActionMenu(null);
    onNavigate?.("Reports");
  };

  // Manual, admin-only cleanup for a completed project's daily reports —
  // separate from removeProject's automatic purge (which only fires when
  // the whole project record is deleted). This lets an admin clear out
  // photos/videos that have already been reviewed without deleting the
  // project itself. Reuses the exact same purge helper either way.
  const handleDeleteDailyReports = async (project) => {
    if (!project?.name) return;
    const ok = window.confirm(`Delete every daily report logged for "${project.name}"? This removes all its photos/videos too and can't be undone.`);
    if (!ok) return;
    setOpenActionMenu(null);
    let count = 0;
    try {
      count = await purgeDailyReportsForProject(project.name);
    } catch (err) {
      showToast(err?.message || "Couldn't delete the daily reports on the server.", "error");
      return;
    }
    showToast(count > 0 ? `Deleted ${count} daily report${count === 1 ? "" : "s"} for ${project.name}.` : `No daily reports found for ${project.name}.`, count > 0 ? "success" : "error");
  };

  const handleCreate = async (data) => {
    // Combine the manager with any additionally selected team members, no duplicates.
    const combinedTeam = Array.from(
      new Set([...(data.manager ? [data.manager] : []), ...(data.team || [])])
    );

    let created;
    try {
      const payload = buildBackendProjectPayload(
        { ...data, team: combinedTeam, status: "In Progress" },
        { approvedUsers, isAdmin, realClients: loadRealClients() }
      );
      created = await projectsApi.createProject(payload);
    } catch (err) {
      showToast(err.message || "Couldn't create the project on the server.", "error");
      return;
    }

    const id = created.id;

    // Per-project employees: save the commission typed in the popup now
    // that the project has a real id.
    if (Object.keys(data.commissions || {}).length > 0) {
      const { failed } = await syncCommissions({
        commissions: data.commissions,
        names: [...combinedTeam, ...(data.modules || []).map((m) => m.assignee)],
        approvedUsers,
        perProjectIds,
        projectId: id,
      });
      if (failed > 0) showToast("Project created, but some commissions could not be saved.", "error");
    }

    // The zip (if one was picked in the form) only held onto the raw
    // File object until now — this is the first point a real project id
    // exists, so it can actually be uploaded to the backend's zip
    // endpoint (see the FIX comment on handleZipFile above). Done before
    // building `fresh` below so completedZip reflects the real,
    // server-saved file rather than the placeholder that was sitting in
    // form state.
    let completedZip = null;
    if (data.projectZip?.file) {
      try {
        const zipResult = await projectsApi.uploadDeliverableZip(id, data.projectZip.file);
        completedZip = {
          fileName: zipResult?.completed_zip ? String(zipResult.completed_zip).split("/").pop() : data.projectZip.fileName,
          fileUrl: zipResult?.completed_zip || null,
          storedOnBackend: true,
          uploadedBy: CURRENT_USER,
          uploadedOn: new Date().toISOString().slice(0, 10),
          size: data.projectZip.size,
        };
      } catch (err) {
        // The project itself was created successfully — don't lose that
        // just because the zip failed to attach. Tell the person so they
        // can retry the upload from the project's own page instead.
        showToast(err.message || "Project created, but the ZIP failed to upload — try attaching it again from the project.", "error");
      }
    }

    // FIX (brief PDF/screenshot never reached the backend): same pattern
    // as the zip upload just above — the brief only ever held onto the
    // raw File (see the FIX comment on handleBriefFile) until now, the
    // first point a real project id exists to attach it to. Previously
    // nothing here ever called projectsApi.uploadBrief at all, so the
    // brief only ever lived in this browser's IndexedDB.
    let briefFile = data.briefFile || null;
    if (data.briefFile?.file) {
      try {
        const briefResult = await projectsApi.uploadBrief(id, data.briefFile.file);
        briefFile = {
          ...data.briefFile,
          fileUrl: briefResult?.brief || null,
          storedOnBackend: true,
        };
      } catch (err) {
        showToast(err.message || "Project created, but the brief failed to upload — try attaching it again from the project.", "error");
      }
    }

    // FIX (Create Project form's modules never reached the backend):
    // every module added in the form only ever lived in this component's
    // local state — `fresh.modules` used to be set straight from
    // `data.modules` below, and projectsApi.createModule() was never
    // called from here at all. So a module typed into "Create Project"
    // looked saved (it showed up in the UI) but was gone the moment the
    // page reloaded, and no one else (another manager/admin opening the
    // same project) ever saw it, because nothing had actually been sent
    // to the server. Now that a real project id exists, every module is
    // created on the backend too, and the local placeholder is swapped
    // for the real backend-saved module (real id, server-resolved
    // assignee, etc). A module that fails to save is kept visible
    // locally (so nothing the person typed just vanishes) but flagged
    // with a toast so it's obvious it still needs to be re-added.
    const savedModules = [];
    // FIX (module files never reached the backend or Messages page):
    // each module file was only ever saved into local IndexedDB (see
    // saveModuleFile) and just carried over as-is onto the backend-saved
    // module below — never actually uploaded to the server, and never
    // included in the Messages dispatch further down. Collected here as
    // real File objects so both problems can be fixed at once: uploaded
    // to projectsApi.uploadModuleFile for the module below, and reused
    // for sendProjectNotificationsToBackend's message attachment.
    const moduleFilesForMessages = [];
    for (const m of data.modules || []) {
      try {
        const modulePayload = {
          name: m.name,
          assignee: nameToId(approvedUsers, m.assignee),
          status: m.status || "Pending",
          priority: m.priority || "Medium",
          due_date: m.dueDate || null,
          url: m.url || "",
        };
        if (isAdmin) modulePayload.price = Number(m.price) || 0;
        const createdModule = await projectsApi.createModule(id, modulePayload);

        // Upload each of this module's locally-attached files to the
        // real backend now that a real module id exists, swapping the
        // local IndexedDB-only placeholder for the server-saved file
        // (real id, real download URL). A file that fails to upload is
        // kept visible locally (nothing the person attached vanishes)
        // but flagged so it's obvious it still needs to be re-attached.
        const uploadedFiles = [];
        for (const f of m.files || []) {
          try {
            const blob = f.storedInIDB ? await getAttachmentBlob(f.id) : f.dataUrl ? dataUrlToBlob(f.dataUrl) : null;
            if (!blob) throw new Error("File data unavailable.");
            const fileForUpload = new File([blob], f.fileName, { type: f.mime || blob.type || "application/octet-stream" });
            const uploaded = await projectsApi.uploadModuleFile(id, createdModule.id, fileForUpload);
            uploadedFiles.push({
              id: uploaded.id,
              fileName: uploaded.original_name,
              mime: uploaded.mime_type,
              size: uploaded.size,
              uploadedBy: uploaded.uploaded_by_name,
              uploadedOn: (uploaded.uploaded_at || "").slice(0, 10),
              fileUrl: uploaded.file,
              storedOnBackend: true,
            });
            // Same file, reused (not re-read) for the Messages dispatch below.
            moduleFilesForMessages.push({ file: fileForUpload, fileName: f.fileName, moduleName: m.name });
          } catch (fileErr) {
            showToast(fileErr.message || `Couldn't upload "${f.fileName}" on the "${m.name}" module — it's kept here locally, try re-attaching it.`, "error");
            uploadedFiles.push(f);
          }
        }
        savedModules.push({ ...backendModuleToFrontend(createdModule), files: uploadedFiles });
      } catch (err) {
        showToast(err.message || `Couldn't save the "${m.name}" module to the server — it's kept here locally, try re-adding it.`, "error");
        savedModules.push(m);
      }
    }

    // Start from what the backend actually saved — features, requirements,
    // additionalInfo and completionLink are real backend columns now (see
    // buildBackendProjectPayload/backendProjectToFrontend), so they come
    // back correctly in `created` already and don't need overriding here.
    const fresh = {
      ...backendProjectToFrontend(created, approvedUsers),
      modules: savedModules,
      briefFile,
      completedZip,
    };
    setProjects((list) => [fresh, ...list]);
    setCreateOpen(false);
    setSelectedId(id);
    setDetailsOpen(true);
    // Notify everyone newly put on the team (manager + members) that
    // they've been assigned to a project, so the sidebar can show them
    // a red dot pointing at this page. See notifyAssigned() below.
    combinedTeam.forEach(notifyAssigned);
    // Link the manager with each team member's own 1:1 thread on the
    // Messages page — see syncProjectPeerConversations above. No shared
    // group is created any more.
    // `newlyAdded: combinedTeam` marks EVERY manager/member pair as newly
    // assigned on creation — this matters because Dashboard.jsx usually
    // already pre-seeded an empty 1:1 thread for every pair of users, so
    // syncProjectPeerConversations takes its "already exists" branch
    // instead of its "brand new thread" branch. That branch only attaches
    // the requirement PDF/screenshot (briefFile) when the recipient is
    // marked newly added — without this, the text details would post but
    // the PDF would silently never be sent. On first creation everyone on
    // the team is effectively newly assigned, so they all need to count.
    syncProjectPeerConversations(setConversations, fresh, approvedUsers, { newlyAdded: combinedTeam });
    // The ZIP attached at creation time is project-level deliverable
    // material meant for the person running the project, not the whole
    // team — so it's sent as a file message to the assigned Manager
    // ONLY (never broadcast to every team member).
    if (fresh.completedZip) {
      sendProjectZipToManagerOnly(setConversations, fresh, approvedUsers);
    }

    // Real backend message dispatch (PDF brief, deliverable ZIP & every
    // module file) to Messages page — moduleFilesForMessages is built
    // above, right alongside the actual backend module-file upload.
    sendProjectNotificationsToBackend({
      project: fresh,
      combinedTeam,
      approvedUsers,
      briefFile: data.briefFile?.file || (data.briefFile instanceof File ? data.briefFile : null),
      zipFile: data.projectZip?.file || (data.projectZip instanceof File ? data.projectZip : null),
      moduleFiles: moduleFilesForMessages,
    });

    showToast("Project created successfully.", "success");
  };

  /* Edit an existing project — name, description, client, manager/team
     (from approved users only), status, deadline/duration, task count,
     modules, and (admin only) budget. This is a real edit, not just a
     status toggle: the result is written into `projects` state and then
     persisted to localStorage by the effect above, so it stays saved
     across reloads/navigation until it's explicitly deleted. */
  const handleEditSave = async (id, data) => {
    const combinedTeam = Array.from(
      new Set([...(data.manager ? [data.manager] : []), ...(data.team || [])])
    );
    const previous = projects.find((p) => p.id === id);

    try {
      const payload = buildBackendProjectPayload({ ...data, team: combinedTeam }, { approvedUsers, isAdmin, realClients: loadRealClients() });
      await projectsApi.updateProject(id, payload);
    } catch (err) {
      showToast(err.message || "Couldn't save changes to the server.", "error");
      return;
    }

    // Per-project employees: save any commission changes made in the popup.
    if (data.commissions) {
      const { failed } = await syncCommissions({
        initial: data.initialCommissions,
        commissions: data.commissions,
        names: [...combinedTeam, ...(data.modules || []).map((m) => m.assignee)],
        approvedUsers,
        perProjectIds,
        projectId: id,
      });
      if (failed > 0) showToast("Project saved, but some commissions could not be saved.", "error");
    }

    // FIX (Edit Project's modules never reached the backend): editing an
    // existing project used to write `data.modules` straight into local
    // state only — projectsApi.createModule/updateModule/deleteModule
    // were never called from here at all, so adding, editing, deleting a
    // module (or attaching a file to one) from the Edit form looked
    // saved in the UI but was silently lost on refresh, and invisible to
    // anyone else who opened the same project. Mirrors the same
    // create/update/delete + file-upload sync handleCreate already does.
    const savedModules = [];
    const moduleFilesForMessages = [];
    const previousModulesById = new Map((previous?.modules || []).map((pm) => [String(pm.id), pm]));
    const nextModuleIds = new Set();

    for (const m of data.modules || []) {
      const isNewModule = typeof m.id === "string" && m.id.startsWith("m-");
      const modulePayload = {
        name: m.name,
        assignee: nameToId(approvedUsers, m.assignee),
        status: m.status || "Pending",
        priority: m.priority || "Medium",
        due_date: m.dueDate || null,
        url: m.url || "",
      };
      if (isAdmin) modulePayload.price = Number(m.price) || 0;

      let backendModule;
      try {
        backendModule = isNewModule
          ? await projectsApi.createModule(id, modulePayload)
          : await projectsApi.updateModule(id, m.id, modulePayload);
      } catch (err) {
        showToast(err.message || `Couldn't save the "${m.name}" module to the server — it's kept here locally, try again.`, "error");
        savedModules.push(m);
        continue;
      }
      nextModuleIds.add(String(isNewModule ? backendModule.id : m.id));

      // Upload only the files newly attached in this edit — anything
      // already `storedOnBackend` (or matching a file id the previous
      // snapshot already had) was uploaded before and is left alone.
      const prevModule = previousModulesById.get(String(m.id));
      const prevFileIds = new Set((prevModule?.files || []).map((f) => f.id));
      const finalFiles = [];
      for (const f of m.files || []) {
        if (f.storedOnBackend || prevFileIds.has(f.id)) {
          finalFiles.push(f);
          continue;
        }
        try {
          const blob = f.storedInIDB ? await getAttachmentBlob(f.id) : f.dataUrl ? dataUrlToBlob(f.dataUrl) : null;
          if (!blob) throw new Error("File data unavailable.");
          const fileForUpload = new File([blob], f.fileName, { type: f.mime || blob.type || "application/octet-stream" });
          const uploaded = await projectsApi.uploadModuleFile(id, backendModule.id, fileForUpload);
          finalFiles.push({
            id: uploaded.id,
            fileName: uploaded.original_name,
            mime: uploaded.mime_type,
            size: uploaded.size,
            uploadedBy: uploaded.uploaded_by_name,
            uploadedOn: (uploaded.uploaded_at || "").slice(0, 10),
            fileUrl: uploaded.file,
            storedOnBackend: true,
          });
          moduleFilesForMessages.push({ file: fileForUpload, fileName: f.fileName, moduleName: m.name });
        } catch (fileErr) {
          showToast(fileErr.message || `Couldn't upload "${f.fileName}" on the "${m.name}" module — it's kept here locally, try re-attaching it.`, "error");
          finalFiles.push(f);
        }
      }
      savedModules.push({ ...backendModuleToFrontend(backendModule), files: finalFiles });
    }

    // Any module removed from the form in this edit gets removed on the
    // server too — skips ids that never made it to the backend in the
    // first place (a locally-added module that failed to save earlier).
    for (const [pmId] of previousModulesById) {
      if (!/^\d+$/.test(pmId) || nextModuleIds.has(pmId)) continue;
      try {
        await projectsApi.deleteModule(id, pmId);
      } catch (err) {
        // best-effort — it's already gone from the local list either way
      }
    }

    // Anyone newly added to the team (wasn't on it before this edit)
    // gets an assignment notification — re-saving the same team should
    // never re-notify people who were already on it.
    const newlyAdded = combinedTeam.filter((n) => !previous?.team?.includes(n));

    // New module files/links from this edit are announced to the admin by the
    // server (once each); the next member only receives them after an admin
    // presses "Approve & send". Nothing is sent to the team from here.
    const projectLabel = previous?.name || data.name || "a project";

    // Snapshot of the project as it will look right after this edit, used
    // to keep each manager↔member 1:1 thread (details message) in sync —
    // built the same way as the setProjects updater below, kept separate
    // since that updater only runs per-item inside the list map.
    let nextSnapshot = null;
    setProjects((list) =>
      list.map((p) => {
        if (p.id !== id) return p;
        const nextStatus = data.status || p.status;
        // Same completedOn bookkeeping as setStatus above, so editing a
        // project's status from this modal keeps "My Performance"
        // accurate too, not just the quick status-menu action.
        let completedOnPatch = {};
        if (nextStatus === "Completed" && p.status !== "Completed") {
          completedOnPatch = { completedOn: new Date().toISOString().slice(0, 10) };
        } else if (nextStatus !== "Completed" && p.completedOn) {
          completedOnPatch = { completedOn: undefined };
        }
        const updated = {
          ...p,
          name: data.name.trim() || p.name,
          description: data.description,
          projectType: data.projectType || p.projectType || "company",
          client: data.client || p.client,
          additionalInfo: data.additionalInfo ?? p.additionalInfo ?? "",
          manager: data.manager || p.manager,
          team: combinedTeam,
          status: nextStatus,
          startDate: data.startDate || p.startDate,
          deadline: data.deadline || p.deadline,
          // Budget can only be changed by an admin — a non-admin editing
          // a project can never see or overwrite it.
          budget: isAdmin && data.budget !== "" ? Number(data.budget) || p.budget : p.budget,
          modules: savedModules.length > 0 || (data.modules || []).length === 0 ? savedModules : p.modules || [],
          features: data.features ?? p.features ?? "",
          requirements: data.requirements ?? p.requirements ?? "",
          completionLink: data.completionLink !== undefined ? data.completionLink : p.completionLink,
          ...completedOnPatch,
        };
        nextSnapshot = updated;
        return updated;
      })
    );
    newlyAdded.forEach(notifyAssigned);
    // Keep each manager↔member 1:1 thread in sync — links/unlinks pairs as
    // the team changes, and posts an update message only when something
    // actually changed for that pair. See syncProjectPeerConversations.
    if (nextSnapshot) syncProjectPeerConversations(setConversations, nextSnapshot, approvedUsers, { newlyAdded });
    setEditingId(null);
    showToast("Project updated successfully.", "success");
  };

  // Real PDF export (jsPDF + autoTable) — builds an actual PDF document
  // with a title and a formatted table, then saves it as a genuine .pdf.
  const exportPdf = () => {
    const headers = ["Project", "Client", "Manager", "Modules Done", "Modules Total", "Status", "Deadline"];
    if (isAdmin) headers.push("Budget", "Spent");
    const rows = filtered.map((p) => {
      const { done, total } = moduleStats(p);
      const row = [p.name, p.client, p.manager, String(done), String(total), p.status, fmtDate(p.deadline)];
      if (isAdmin) row.push(fmtMoney(p.budget), fmtMoney(p.spent));
      return row;
    });

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Hopenix — Projects", 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Exported ${new Date().toLocaleDateString()} · ${filtered.length} projects`, 14, 21);

    autoTable(doc, {
      head: [headers],
      body: rows,
      startY: 26,
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [124, 58, 237] }, // violet-600
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save("hopenix-projects.pdf");
    showToast("Projects exported to PDF.", "success");
  };

  const downloadDeliverable = (project) => {
    if (!project?.deliverable) return;
    const content = [
      `Deliverable: ${project.deliverable.name}`,
      `Project: ${project.name}`,
      `Client: ${project.client}`,
      `Uploaded: ${fmtDate(project.deliverable.date)}`,
      `Size: ${project.deliverable.size?.toFixed(1) || "1.0"} MB`,
      "",
      "This is a placeholder file generated from the Hopenix demo.",
    ].join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = project.deliverable.name.replace(/\.[a-z0-9]+$/i, "") + ".txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`${project.deliverable.name} downloaded.`, "success");
  };

  /* ----------------------------------------------------------------
     COMPLETED FILES (ZIP) UPLOAD
     Once a project's work is done, whoever is on the project (or an
     admin) can attach the actual finished files as a real .zip here.
     FIX (silent project-save failure): this used to base64-encode the
     whole zip and store it directly on the project object with NO size
     cap at all — a real deliverable zip is easily tens of MB, which
     guaranteed a localStorage quota failure the moment `projects` was
     next saved (see saveStoredProjects), silently discarding the
     upload (and often the rest of the project data saved alongside
     it). The actual bytes now go to IndexedDB via saveAttachmentBlob —
     same pattern as briefFile above — so there's no realistic size
     ceiling and localStorage only ever holds a small `id` reference.
     The dedicated Zip Files admin page (ZipFilesPage.jsx) already
     reads completedZip via getAttachmentBlob(id) for exactly this
     shape, with a legacy dataUrl fallback for anything uploaded before
     this fix.
  ---------------------------------------------------------------- */
  const handleUploadZip = async (projectId, file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".zip")) {
      showToast("Only .zip files can be uploaded here.", "error");
      return;
    }
    // FIX: this used to go through attachmentStorage.js (IndexedDB, with
    // a base64-in-localStorage fallback) — the file never actually left
    // the browser, capped by whatever browser storage was free/available.
    // projects/views.py's ProjectViewSet.upload_zip already exists and
    // accepts multipart uploads of any size straight to disk (path saved
    // on the Project row) — this now calls that endpoint via
    // projectsApi.uploadDeliverableZip instead, so the file is really
    // saved server-side with no browser-storage ceiling.
    try {
      const updated = await projectsApi.uploadDeliverableZip(projectId, file);
      const completedZip = {
        fileName: updated?.completed_zip ? String(updated.completed_zip).split("/").pop() : file.name,
        fileUrl: updated?.completed_zip || null,
        storedOnBackend: true,
        uploadedBy: CURRENT_USER,
        uploadedOn: new Date().toISOString().slice(0, 10),
        size: file.size / (1024 * 1024), // MB
      };
      setProjects((list) => list.map((p) => (p.id === projectId ? { ...p, completedZip } : p)));

      // Dispatch real backend message with deliverable ZIP file to all assigned members + manager
      const proj = projects.find((p) => p.id === projectId);
      if (proj) {
        const combinedTeam = Array.from(new Set([...(proj.manager && proj.manager !== "Unassigned" ? [proj.manager] : []), ...(proj.team || [])]));
        const memberUsers = combinedTeam.map((name) => (approvedUsers || []).find((u) => u.name === name)).filter((u) => u && u.id);
        for (const u of memberUsers) {
          messagesApi.sendMessage({
            recipientId: u.id,
            text: `📦 Deliverable ZIP file uploaded for project "${proj.name}": ${file.name}`,
            attachment: file,
          }).catch(() => {});
        }
      }

      showToast(`${file.name} uploaded and saved on the server.`, "success");
    } catch (err) {
      showToast(err.message || "Couldn't upload that file — please try again.", "error");
    }
  };

  const tabDefs = [
    { key: "all", label: "All Projects" },
    { key: "my", label: "My Projects" },
    { key: "status", label: "By Status" },
    { key: "client", label: "By Client" },
  ];

  // Renders the inner content of the "Project Details" view for whichever
  // project is currently `selected`. Pulled out into its own function so
  // the SAME markup can sit inside two different wrappers depending on
  // screen size: a sticky column on desktop (unchanged), or a centered
  // popup modal on mobile — same pattern as the Employees page. Opening a
  // modal instead of scrolling to an inline panel is what fixes the
  // "scrolls down to the wrong/unrelated data" bug: there's no scrolling
  // involved at all, so what you see is always exactly the card you tapped.
  const renderDetailsContent = () => (
    <>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-bold text-sm ${cardText}`}>Project Details</h3>
        <div className="flex items-center gap-1">
          {canEditProjects && (
            <button onClick={() => setEditingId(selected.id)} className={`w-7 h-7 flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`} aria-label="Edit project">
              <Pencil className="w-3.5 h-3.5" />
            </button>

          )}
          <button onClick={() => setDetailsOpen(false)} className={`w-7 h-7 flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <FolderKanban className="w-4 h-4" />
          </span>
          <p className={`font-bold text-sm leading-snug ${cardText}`}>{selected.name}</p>
        </div>
        <StatusBadge status={selected.status} />
      </div>
      <p className={`text-xs leading-relaxed mb-4 break-words ${mutedText}`}>{selected.description}</p>

      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div>
          <p className={subtleText}>Client</p>
          <p className={`font-semibold mt-0.5 flex items-center gap-1 ${cardText}`}><Building2 className="w-3 h-3 text-violet-500" />{selected.client}</p>
        </div>
        <div>
          <p className={subtleText}>Project Manager</p>
          <p className={`font-semibold mt-0.5 ${cardText}`}>{selected.manager}</p>
        </div>
        <div>
          <p className={subtleText}>Start Date</p>
          <p className={`font-semibold mt-0.5 flex items-center gap-1 ${cardText}`}><Calendar className="w-3 h-3 text-violet-500" />{fmtDate(selected.startDate)}</p>
        </div>
        <div>
          <p className={subtleText}>Deadline</p>
          <p className={`font-semibold mt-0.5 flex items-center gap-1 ${cardText}`}><Calendar className="w-3 h-3 text-violet-500" />{fmtDate(selected.deadline)}</p>
        </div>
        {isAdmin ? (
          <>
            <div>
              <p className={subtleText}>Budget</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>{fmtMoney(selected.budget)}</p>
            </div>
            <div>
              <p className={subtleText}>Spent</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>
                {fmtMoney(selected.spent)}{" "}
                <span className={subtleText}>({selected.budget ? Math.round((selected.spent / selected.budget) * 100) : 0}%)</span>
              </p>
            </div>
            {(() => {
              const modTotal = (selected.modules || []).reduce((sum, m) => sum + (Number(m.price) || 0), 0);
              return modTotal > 0 ? (
                <div className="col-span-2">
                  <p className={subtleText}>Final Budget (incl. modules)</p>
                  <p className="font-semibold mt-0.5 text-violet-600">{fmtMoney(selected.budget + modTotal)}</p>
                </div>
              ) : null;
            })()}
          </>
        ) : (
          <div className="col-span-2 flex items-center gap-1.5">
            <Lock className={`w-3 h-3 ${subtleText}`} />
            <p className={subtleText}>Budget details are visible to admins only.</p>
          </div>
        )}
      </div>

      <ModulesSection
        project={selected}
        isAdmin={isAdmin}
        currentUser={CURRENT_USER}
        darkMode={darkMode}
        cardText={cardText}
        mutedText={mutedText}
        subtleText={subtleText}
        barsPlay={progressPlay}
        maxHeight="max-h-56"
        onToggleDone={(moduleId) => toggleModuleDone(selected.id, moduleId)}
        onCycleStatus={(moduleId) => cycleModuleStatus(selected.id, moduleId)}
        onUploadFile={(moduleId, file) => handleUploadModuleFile(selected.id, moduleId, file)}
        onDownloadFile={downloadModuleFile}
        onSetUrl={(moduleId, url) => handleSetModuleUrl(selected.id, moduleId, url)}
        onApproveHandoff={(moduleId) => approveModuleHandoff(selected.id, moduleId)}
        onDeleteFile={(moduleId, f) => handleDeleteModuleFile(selected.id, moduleId, f)}
      />

      <div className={`flex items-center justify-between mb-2`}>
        <p className={`text-xs font-semibold ${cardText}`}>Team Members</p>
        <button onClick={() => { setFullDetailsId(selected.id); }} className="text-[11px] font-semibold text-violet-600 hover:text-violet-700">View All</button>
      </div>
      <div className="flex items-center mb-4">
        <AvatarStack names={selected.team} darkMode={darkMode} max={4} />
        {selected.team.length === 0 && <span className={`text-xs ${subtleText}`}>No team members assigned yet.</span>}
      </div>

      <p className={`text-xs font-semibold mb-2 ${cardText}`}>Latest Deliverable</p>
      {selected.deliverable ? (
        <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-4 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
          <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <FolderKanban className="w-3.5 h-3.5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-semibold truncate ${cardText}`}>{selected.deliverable.name}</p>
            <p className={`text-[10px] ${subtleText}`}>Uploaded on {fmtDate(selected.deliverable.date)}</p>
          </div>
          <button onClick={() => setPreviewFile({ project: selected, deliverable: selected.deliverable })} className={mutedText} aria-label="Preview file"><Eye className="w-3.5 h-3.5" /></button>
          <button onClick={() => downloadDeliverable(selected)} className={mutedText} aria-label="Download file"><Download className="w-3.5 h-3.5" /></button>
        </div>
      ) : (
        <p className={`text-[11px] mb-4 ${subtleText}`}>No deliverables uploaded yet.</p>
      )}

      {/* Project Files (ZIP) — visible right here on the Projects
          page itself, no need to open Full Details. Upload is only
          offered to an admin, the project's manager, or someone on
          its team. Once uploaded it's stored on the project record
          and shows up on the (password-protected) Zip Files page. */}
      <div className="flex items-center justify-between mb-2">
        <p className={`text-xs font-semibold flex items-center gap-1.5 ${cardText}`}>
          <Archive className="w-3.5 h-3.5 text-violet-500" />Project Files (ZIP)
        </p>
        {(isAdmin || selected.manager === CURRENT_USER || (selected.team || []).includes(CURRENT_USER)) && (
          <label className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 cursor-pointer">
            {selected.completedZip ? "Replace file" : "Upload ZIP"}
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUploadZip(selected.id, file);
                e.target.value = "";
              }}
            />
          </label>
        )}
      </div>
      {selected.completedZip ? (
        <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-4 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
          <span className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Archive className="w-3.5 h-3.5" />
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-[11px] font-semibold truncate ${cardText}`}>{selected.completedZip.fileName}</p>
            <p className={`text-[10px] ${subtleText}`}>
              Uploaded by {selected.completedZip.uploadedBy} on {fmtDate(selected.completedZip.uploadedOn)} · {(selected.completedZip.size || 0).toFixed(1)} MB
            </p>
          </div>
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        </div>
      ) : (
        <p className={`text-[11px] mb-4 ${subtleText}`}>No completed files uploaded yet.</p>
      )}

      {selected.completionLink && (
        <a
          href={selected.completionLink}
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2 rounded-xl px-3 py-2.5 mb-4 text-[11px] font-semibold text-violet-600 hover:underline ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}
        >
          <Link2 className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{selected.completionLink}</span>
          <ExternalLink className="w-3 h-3 shrink-0 ml-auto" />
        </a>
      )}

      {selected.status === "Completed" && (
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => viewProjectDailyReports(selected)}
            className={`flex-1 flex items-center justify-center gap-1.5 border text-xs font-semibold py-2.5 rounded-full ${darkMode ? "border-slate-700 text-slate-200 hover:bg-slate-800" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}
          >
            <Video className="w-3.5 h-3.5" /> View Daily Reports
          </button>
          {isAdmin && (
            <button
              onClick={() => handleDeleteDailyReports(selected)}
              title="Delete this project's daily reports"
              aria-label="Delete this project's daily reports"
              className={`shrink-0 w-9 h-9 flex items-center justify-center border text-rose-500 rounded-full ${darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-rose-50"}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      <button
        onClick={() => setFullDetailsId(selected.id)}
        className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-xs font-semibold py-2.5 rounded-full transition"
      >
        View Full Details →
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-base font-bold ${cardText}`}>Projects</h2>
          <p className={`text-xs mt-0.5 ${subtleText}`}>Track progress, budgets and teams across every project</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportPdf}
            className={`flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-full border transition ${inputCls}`}
          >
            <Download className="w-4 h-4" /> Export
          </button>
          {canCreateProjects && (
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-full transition shrink-0"
            >
              <Plus className="w-4 h-4" /> Create Project
            </button>
          )}
        </div>
      </div>

      {projectsLoading && (
        <div className={`text-xs px-3.5 py-2 rounded-lg ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-500"}`}>
          Loading projects from the server…
        </div>
      )}
      {!projectsLoading && projectsError && (
        <div className="text-xs px-3.5 py-2 rounded-lg bg-rose-50 text-rose-600">
          Couldn't load projects from the server ({projectsError}).{" "}
          {projectsShowingCache
            ? "Showing the last copy saved from the server — it may be out of date."
            : "No saved copy is available, so nothing is shown. Please check your connection and reload."}
        </div>
      )}

      {/* STATS */}
      <div className={`grid grid-cols-2 sm:grid-cols-3 gap-3 ${isAdmin ? "lg:grid-cols-6" : "lg:grid-cols-5"}`}>
        <StatCard
          card={card} cardText={cardText} mutedText={mutedText}
          icon={FolderKanban} iconBg="bg-violet-50" iconText="text-violet-600"
          label="Total Projects" value={counts.total} delta="12%" up
          active={statusFilter === "All Status" && activeTab !== "my"}
          onClick={() => { setActiveTab("all"); setStatusFilter("All Status"); scrollToTableOnMobile(); }}
        />
        <StatCard
          card={card} cardText={cardText} mutedText={mutedText}
          icon={Loader} iconBg="bg-blue-50" iconText="text-blue-600"
          label="In Progress" value={counts.inProgress} delta="8%" up
          active={statusFilter === "In Progress"}
          onClick={() => { setActiveTab("status"); setStatusFilter("In Progress"); scrollToTableOnMobile(); }}
        />
        <StatCard
          card={card} cardText={cardText} mutedText={mutedText}
          icon={CheckCircle2} iconBg="bg-emerald-50" iconText="text-emerald-600"
          label="Completed" value={counts.completed} delta="5%" up
          active={statusFilter === "Completed"}
          onClick={() => { setActiveTab("status"); setStatusFilter("Completed"); scrollToTableOnMobile(); }}
        />
        <StatCard
          card={card} cardText={cardText} mutedText={mutedText}
          icon={PauseCircle} iconBg="bg-orange-50" iconText="text-orange-600"
          label="On Hold" value={counts.onHold} delta="3%" up={false}
          active={statusFilter === "On Hold"}
          onClick={() => { setActiveTab("status"); setStatusFilter("On Hold"); scrollToTableOnMobile(); }}
        />
        <StatCard
          card={card} cardText={cardText} mutedText={mutedText}
          icon={XCircle} iconBg="bg-rose-50" iconText="text-rose-600"
          label="Cancelled" value={counts.cancelled} delta="2%" up={false}
          active={statusFilter === "Cancelled"}
          onClick={() => { setActiveTab("status"); setStatusFilter("Cancelled"); scrollToTableOnMobile(); }}
        />
        {isAdmin && (
          <StatCard
            card={card} cardText={cardText} mutedText={mutedText}
            icon={Wallet} iconBg="bg-indigo-50" iconText="text-indigo-600"
            label="Total Budget" value={fmtMoney(counts.totalBudget)} delta="10%" up
          />
        )}
      </div>

      {/* CONTENT GRID */}
      <div className={`grid gap-4 items-start ${detailsOpen && selected ? "lg:grid-cols-[1fr,340px]" : "lg:grid-cols-1"}`}>
        {/* LEFT: table card */}
        <div ref={tableSectionRef} className={`rounded-2xl overflow-hidden ${card}`}>
          {/* Tabs */}
          <div className={`flex items-center gap-1 px-4 pt-3 overflow-x-auto whitespace-nowrap border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
            {tabDefs.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setActiveTab(t.key);
                  if (t.key !== "status") setStatusFilter("All Status");
                  if (t.key !== "client") setClientFilter("All Clients");
                }}
                className={`px-3 py-2 text-sm font-semibold border-b-2 transition shrink-0 ${
                  activeTab === t.key ? "text-violet-600 border-violet-600" : `${mutedText} border-transparent hover:text-violet-500`
                }`}
              >
                {t.label}
                {t.key === "my" && (
                  <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${activeTab === "my" ? "bg-violet-100 text-violet-600" : darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"}`}>
                    {visibleProjects.filter((p) => p.manager === CURRENT_USER || (p.team || []).includes(CURRENT_USER)).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Contextual hint row for grouped tabs */}
          {(activeTab === "status" || activeTab === "client") && (
            <div className={`px-4 pt-2 text-[11px] flex items-center gap-1.5 ${subtleText}`}>
              <Filter className="w-3 h-3" />
              {activeTab === "status" ? "Grouped by status — use the Status dropdown to narrow further." : "Grouped by client — use the Client dropdown to narrow further."}
            </div>
          )}
          {activeTab === "my" && (
            <>
              <div className={`px-4 pt-2 text-[11px] flex items-center gap-1.5 ${subtleText}`}>
                <User className="w-3 h-3" />
                Showing projects where {CURRENT_USER} is the manager or a team member.
              </div>

              {/* My Performance — completed projects, money earned, and
                  delivery timing (early / on time / late) + bonus, all
                  computed from this person's own Completed projects. */}
              <div className="px-4 pt-3 pb-1">
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${subtleText}`}>My Performance</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                  <MiniStat
                    card={card} cardText={cardText} mutedText={mutedText}
                    icon={CheckCircle2} tone="emerald" label="Completed" value={myPerformance.completed}
                  />
                  <MiniStat
                    card={card} cardText={cardText} mutedText={mutedText}
                    icon={Wallet} tone="violet" label="Total Earned" value={fmtMoney(myPerformance.earned)}
                  />
                  <MiniStat
                    card={card} cardText={cardText} mutedText={mutedText}
                    icon={CalendarClock} tone="blue" label="Delivered Early" value={myPerformance.early}
                  />
                  <MiniStat
                    card={card} cardText={cardText} mutedText={mutedText}
                    icon={Clock} tone="cyan" label="On Time" value={myPerformance.onTime}
                  />
                  <MiniStat
                    card={card} cardText={cardText} mutedText={mutedText}
                    icon={Clock} tone="rose" label="Delivered Late" value={myPerformance.late}
                  />
                  <MiniStat
                    card={card} cardText={cardText} mutedText={mutedText}
                    icon={DollarSign} tone="amber" label="Bonus Earned" value={fmtMoney(myPerformance.bonus)}
                  />
                </div>
              </div>

              {/* Admin-only: every approved user's performance in one
                  table, not just the logged-in admin's own numbers —
                  so an admin can see at a glance who's completed what,
                  who's earned how much, and who delivers early/late. */}
              {isAdmin && (
                <div className="px-4 pt-4 pb-1">
                  <p className={`text-[10px] font-bold uppercase tracking-wide mb-2 ${subtleText}`}>Team Performance — All Users</p>
                  <div className={`rounded-xl overflow-hidden border ${darkMode ? "border-slate-800" : "border-slate-200"}`}>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr className={`text-left text-xs ${mutedText} ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
                            <th className="py-2.5 pl-4 pr-2 font-semibold">User</th>
                            <th className="py-2.5 px-2 font-semibold text-center">Completed</th>
                            <th className="py-2.5 px-2 font-semibold text-right">Earned</th>
                            <th className="py-2.5 px-2 font-semibold text-center">Early</th>
                            <th className="py-2.5 px-2 font-semibold text-center">On Time</th>
                            <th className="py-2.5 px-2 font-semibold text-center">Late</th>
                            <th className="py-2.5 pr-4 pl-2 font-semibold text-right">Bonus</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
                          {teamPerformance.map((u) => (
                            <tr key={u.id} className={rowHover}>
                              <td className="py-2.5 pl-4 pr-2">
                                <div className="flex items-center gap-2.5 min-w-[160px]">
                                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${avatarColor(u.name)}`}>
                                    {initials(u.name)}
                                  </span>
                                  <div className="min-w-0">
                                    <p className={`font-semibold truncate ${cardText}`}>{u.name}</p>
                                    {u.role && <p className={`text-[11px] truncate ${subtleText}`}>{u.role}</p>}
                                  </div>
                                </div>
                              </td>
                              <td className={`py-2.5 px-2 text-center font-semibold ${cardText}`}>{u.completed}</td>
                              <td className={`py-2.5 px-2 text-right font-semibold ${cardText}`}>{fmtMoney(u.earned)}</td>
                              <td className="py-2.5 px-2 text-center text-blue-600 font-semibold">{u.early || "—"}</td>
                              <td className="py-2.5 px-2 text-center text-cyan-600 font-semibold">{u.onTime || "—"}</td>
                              <td className="py-2.5 px-2 text-center text-rose-600 font-semibold">{u.late || "—"}</td>
                              <td className="py-2.5 pr-4 pl-2 text-right font-semibold text-amber-600">{fmtMoney(u.bonus)}</td>
                            </tr>
                          ))}
                          {teamPerformance.length === 0 && (
                            <tr>
                              <td colSpan={7} className={`text-center py-8 text-sm ${subtleText}`}>No approved users yet.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <div className="relative flex-1 min-w-[180px] order-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-400 order-2 ${inputCls}`}
            >
              <option>All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <div className="relative order-3" ref={filtersRef}>
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 ${inputCls}`}
              >
                <Filter className="w-3.5 h-3.5" /> Filter
                <ChevronDown size={12} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
              </button>
              {filtersOpen && (
                <div className={`absolute right-0 top-full mt-1.5 w-56 rounded-xl shadow-xl z-30 p-3 space-y-2 ${card}`}>
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>Client</p>
                  <select
                    value={clientFilter}
                    onChange={(e) => setClientFilter(e.target.value)}
                    className={`w-full text-sm border rounded-lg px-2.5 py-1.5 outline-none ${inputCls}`}
                  >
                    <option>All Clients</option>
                    {CLIENTS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setClientFilter("All Clients");
                      setStatusFilter("All Status");
                      setSearch("");
                    }}
                    className="w-full text-xs font-semibold text-violet-600 hover:text-violet-700 text-left"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-auto max-h-[560px]">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className={`text-left text-xs ${mutedText} border-y ${darkMode ? "border-slate-800 bg-slate-900" : "border-slate-100 bg-slate-50"}`}>
                  <th className="py-2.5 pl-5 pr-2 font-semibold">Project</th>
                  <th className="py-2.5 px-2 font-semibold">Client</th>
                  <th className="py-2.5 px-2 font-semibold">Team</th>
                  <th className="py-2.5 px-2 font-semibold">Modules</th>
                  <th className="py-2.5 px-2 font-semibold min-w-[140px]">Progress</th>
                  <th className="py-2.5 px-2 font-semibold">Status</th>
                  <th className="py-2.5 px-2 font-semibold">Deadline</th>
                  <th className="py-2.5 pr-5 pl-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className={`divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
                {paged.map((p) => {
                  const { done: modDone, total: modTotal, pct } = moduleStats(p);
                  return (
                    <tr
                      key={p.id}
                      onClick={() => openDetails(p.id)}
                      className={`cursor-pointer ${rowHover} ${selectedId === p.id && detailsOpen ? (darkMode ? "bg-violet-950/20" : "bg-violet-50/50") : ""}`}
                    >
                      <td className="py-2.5 pl-5 pr-2">
                        <div className="flex items-center gap-2.5 min-w-[190px]">
                          <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                            <FolderKanban className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className={`font-semibold truncate ${cardText}`}>{p.name}</p>
                              {p.completedZip && (
                                <span title={`ZIP uploaded: ${p.completedZip.fileName}`} className="shrink-0 w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                  <Archive className="w-2.5 h-2.5" />
                                </span>
                              )}
                            </div>
                            <p className={`text-xs truncate ${subtleText}`}>{p.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{p.client}</td>
                      <td className="py-2.5 px-2">
                        <AvatarStack names={p.team} darkMode={darkMode} />
                      </td>
                      <td className={`py-2.5 px-2 whitespace-nowrap font-medium ${cardText}`}>{modDone}/{modTotal}</td>
                      <td className="py-2.5 px-2">
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                            <div
                              className={`h-full rounded-full transition-all duration-700 ease-out ${pct === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-violet-600 to-indigo-500"}`}
                              style={{ width: progressPlay ? `${pct}%` : "0%" }}
                            />
                          </div>
                          <span className={`text-[11px] font-semibold w-8 text-right ${mutedText}`}>{pct}%</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-2"><StatusBadge status={p.status} /></td>
                      <td className={`py-2.5 px-2 whitespace-nowrap ${mutedText}`}>{fmtDate(p.deadline)}</td>
                      <td className="py-2.5 pr-5 pl-2 text-right relative" onClick={(e) => e.stopPropagation()}>
                        <button
                          data-action-toggle
                          onClick={(e) => {
                            if (openActionMenu === p.id) {
                              setOpenActionMenu(null);
                              return;
                            }
                            const r = e.currentTarget.getBoundingClientRect();
                            const MENU_H = 290; // tallest possible menu; flip upward if it won't fit below
                            const openUp = window.innerHeight - r.bottom < MENU_H && r.top > MENU_H;
                            setActionMenuPos(
                              openUp
                                ? { right: Math.max(8, window.innerWidth - r.right), bottom: window.innerHeight - r.top + 4 }
                                : { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 4 }
                            );
                            setOpenActionMenu(p.id);
                          }}
                          className={`w-8 h-8 inline-flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
                          aria-label="Row actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openActionMenu === p.id && actionMenuPos && createPortal(
                          <div
                            data-action-menu
                            style={{ position: "fixed", ...actionMenuPos }}
                            className={`z-[1000] w-44 rounded-xl shadow-lg py-1 text-left ${card}`}
                          >
                            <button onClick={() => { setFullDetailsId(p.id); setOpenActionMenu(null); }} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}>
                              <Eye className="w-3.5 h-3.5" /> View details
                            </button>
                            {canEditProjects && (
                              <button onClick={() => { setEditingId(p.id); setOpenActionMenu(null); }} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}>
                                <Pencil className="w-3.5 h-3.5" /> Edit project
                              </button>
                            )}
                            {p.status !== "On Hold" ? (
                              <button onClick={() => setStatus(p.id, "On Hold")} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}>
                                <Archive className="w-3.5 h-3.5" /> Put on hold
                              </button>
                            ) : (
                              <button onClick={() => setStatus(p.id, "In Progress")} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}>
                                <Loader className="w-3.5 h-3.5" /> Resume project
                              </button>
                            )}
                            {p.status === "Completed" && (
                              <button onClick={() => viewProjectDailyReports(p)} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${mutedText} ${rowHover}`}>
                                <Video className="w-3.5 h-3.5" /> View daily reports
                              </button>
                            )}
                            {p.status === "Completed" && isAdmin && (
                              <button onClick={() => handleDeleteDailyReports(p)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                                <Trash2 className="w-3.5 h-3.5" /> Delete daily reports
                              </button>
                            )}
                            {canDeleteProjects && (
                              <button onClick={() => removeProject(p.id)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                                <Trash2 className="w-3.5 h-3.5" /> Delete project
                              </button>
                            )}
                          </div>,
                          document.body
                        )}
                      </td>
                    </tr>
                  );
                })}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={8} className={`text-center py-14 text-sm ${subtleText}`}>No projects match these filters.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card list — flows in normal document flow (no inner
              max-height/scroll cap) so the WHOLE page scrolls together on
              mobile, same as everything else on the page. A capped
              `max-h + overflow-y-auto` box here used to trap the swipe
              gesture inside this small region, making the page feel like
              it wasn't scrolling at all. */}
          <div className={`md:hidden divide-y ${darkMode ? "divide-slate-800" : "divide-slate-100"}`}>
            {paged.map((p) => {
              const { pct } = moduleStats(p);
              return (
                <button key={p.id} onClick={() => openDetails(p.id)} className={`w-full text-left p-4 ${rowHover}`}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                        <FolderKanban className="w-4 h-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className={`font-semibold text-sm truncate ${cardText}`}>{p.name}</p>
                          {p.completedZip && (
                            <span title="ZIP uploaded" className="shrink-0 w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                              <Archive className="w-2.5 h-2.5" />
                            </span>
                          )}
                        </div>
                        <p className={`text-xs truncate ${subtleText}`}>{p.client}</p>
                      </div>
                    </div>
                  <StatusBadge status={p.status} />
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                      <div
                        className={`h-full rounded-full transition-all duration-700 ease-out ${pct === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-violet-600 to-indigo-500"}`}
                        style={{ width: progressPlay ? `${pct}%` : "0%" }}
                      />
                    </div>
                    <span className={`text-[11px] font-semibold ${mutedText}`}>{pct}%</span>
                  </div>
                  <div className={`flex items-center justify-between text-xs ${mutedText}`}>
                    <AvatarStack names={p.team} darkMode={darkMode} max={3} />
                    <span>Due {fmtDate(p.deadline)}</span>
                  </div>
                </button>
              );
            })}
            {paged.length === 0 && <p className={`text-center py-12 text-sm ${subtleText}`}>No projects match these filters.</p>}
          </div>

          {/* Pagination */}
          <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t text-sm ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
            <p className={`text-xs ${subtleText}`}>
              Showing {filtered.length === 0 ? 0 : pageStart + 1} to {Math.min(pageStart + rowsPerPage, filtered.length)} of {filtered.length} projects
            </p>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`w-8 h-8 flex items-center justify-center rounded-lg border disabled:opacity-40 ${inputCls}`}>‹</button>
              {(() => {
                // Sliding window of up to 5 page buttons centered on the
                // current page, clamped to [1, totalPages], so pages
                // beyond the first 5 (e.g. after lowering Rows per page)
                // are still reachable by number, not just via ‹ / ›.
                const windowSize = Math.min(5, totalPages);
                let start = Math.max(1, page - Math.floor(windowSize / 2));
                let end = start + windowSize - 1;
                if (end > totalPages) {
                  end = totalPages;
                  start = end - windowSize + 1;
                }
                return Array.from({ length: end - start + 1 }, (_, i) => start + i);
              })().map((p) => (
                <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-semibold ${page === p ? "bg-violet-600 text-white" : inputCls}`}>
                  {p}
                </button>
              ))}
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`w-8 h-8 flex items-center justify-center rounded-lg border disabled:opacity-40 ${inputCls}`}>›</button>
            </div>
            <div className={`flex items-center gap-2 text-xs ${subtleText}`}>
              Rows per page:
              <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className={`border rounded-lg px-2 py-1 outline-none ${inputCls}`}>
                {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* RIGHT: Project Details — desktop only, sticky column next to
            the list, exactly like before. On mobile, the same content
            opens in a centered popup modal instead (see below the grid),
            same pattern as the Employees page: tapping a card just opens
            its data directly, no scrolling involved. */}
        {detailsOpen && selected && !isMobile && (
          <div className={`w-full rounded-2xl p-4 lg:w-auto lg:sticky lg:top-4 ${card}`}>
            {renderDetailsContent()}
          </div>
        )}
      </div>

      {/* Mobile project details — centered popup modal, same pattern as
          EmployeeDetailsModal on the Employees page. Portaled to
          document.body like the other modals below, so it isn't trapped
          inside any ancestor's transform/overflow and can actually scroll. */}
      {isMobile && detailsOpen && selected && createPortal(
        <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={() => setDetailsOpen(false)}>
          <div className={`rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl p-4 ${card}`} onClick={(e) => e.stopPropagation()}>
            {renderDetailsContent()}
          </div>
        </div>,
        document.body
      )}

      {/* These four modals are all `fixed inset-0` overlays — portaled to
          document.body so they always cover the real viewport instead of
          risking getting trapped inside some ancestor's transform/overflow
          (same root cause as the details panel above). */}
      {createOpen && createPortal(
        <CreateProjectModal
          onClose={() => setCreateOpen(false)}
          onSubmit={handleCreate}
          darkMode={darkMode}
          teamOptions={approvedNames}
          excludeAssignees={clientUserNames}
          teamDirectory={teamDirectory}
          clientOptions={realClients}
          isAdmin={isAdmin}
          currentUser={CURRENT_USER}
        />,
        document.body
      )}

      {editingProject && createPortal(
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingId(null)}
          onSubmit={(data) => handleEditSave(editingProject.id, data)}
          darkMode={darkMode}
          teamOptions={approvedNames}
          excludeAssignees={clientUserNames}
          teamDirectory={teamDirectory}
          clientOptions={realClients}
          isAdmin={isAdmin}
          currentUser={CURRENT_USER}
        />,
        document.body
      )}

      {fullDetailsProject && createPortal(
        <FullDetailsModal
          project={fullDetailsProject}
          darkMode={darkMode}
          card={card}
          cardText={cardText}
          mutedText={mutedText}
          subtleText={subtleText}
          isAdmin={isAdmin}
          currentUser={CURRENT_USER}
          onClose={() => setFullDetailsId(null)}
          onEdit={canEditProjects ? () => { setEditingId(fullDetailsProject.id); setFullDetailsId(null); } : undefined}
          onPreview={(deliverable) => setPreviewFile({ project: fullDetailsProject, deliverable })}
          onDownload={() => downloadDeliverable(fullDetailsProject)}
          onSetStatus={(status, link) => setStatus(fullDetailsProject.id, status, link)}
          onToggleModuleDone={(moduleId) => toggleModuleDone(fullDetailsProject.id, moduleId)}
          onCycleModuleStatus={(moduleId) => cycleModuleStatus(fullDetailsProject.id, moduleId)}
          onUploadModuleFile={(moduleId, file) => handleUploadModuleFile(fullDetailsProject.id, moduleId, file)}
          onDownloadModuleFile={downloadModuleFile}
          onSetModuleUrl={(moduleId, url) => handleSetModuleUrl(fullDetailsProject.id, moduleId, url)}
          onApproveModuleHandoff={(moduleId) => approveModuleHandoff(fullDetailsProject.id, moduleId)}
          onDeleteModuleFile={(moduleId, f) => handleDeleteModuleFile(fullDetailsProject.id, moduleId, f)}
          onUploadZip={(file) => handleUploadZip(fullDetailsProject.id, file)}
          onViewDailyReports={() => viewProjectDailyReports(fullDetailsProject)}
          onDeleteDailyReports={() => handleDeleteDailyReports(fullDetailsProject)}
        />,
        document.body
      )}

      {previewFile && createPortal(
        <DeliverablePreviewModal
          data={previewFile}
          darkMode={darkMode}
          card={card}
          cardText={cardText}
          mutedText={mutedText}
          subtleText={subtleText}
          onClose={() => setPreviewFile(null)}
          onDownload={() => downloadDeliverable(previewFile.project)}
        />,
        document.body
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
   FULL DETAILS MODAL
====================================================================== */

function FullDetailsModal({ project, darkMode, card, cardText, mutedText, subtleText, isAdmin, currentUser, onClose, onEdit, onPreview, onDownload, onSetStatus, onToggleModuleDone, onCycleModuleStatus, onUploadModuleFile, onDownloadModuleFile, onSetModuleUrl, onApproveModuleHandoff, onDeleteModuleFile, onUploadZip, onViewDailyReports, onDeleteDailyReports }) {
  // Only an admin, the project's manager, or someone on its team can
  // upload the finished work — random viewers of a project shouldn't
  // be able to attach files to it.
  const canUploadZip = isAdmin || project.manager === currentUser || (project.team || []).includes(currentUser);
  // Marking a project Completed asks for a link before it actually
  // changes status — see the footer below. Any other status change
  // still happens immediately, same as before.
  const [completeLinkOpen, setCompleteLinkOpen] = useState(false);
  const [completeLink, setCompleteLink] = useState(project.completionLink || "");
  const linkLooksValid = /^https?:\/\/\S+/i.test(completeLink.trim());
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200 bg-white";

  const spentPct = project.budget ? Math.round((project.spent / project.budget) * 100) : 0;
  // Progress bars fill in from empty each time this modal opens.
  const [barsPlay, setBarsPlay] = useState(false);
  useEffect(() => {
    setBarsPlay(false);
    const t = setTimeout(() => setBarsPlay(true), 60);
    return () => clearTimeout(t);
  }, [project.id]);
  // Modules' prices add on top of the real budget to give the true,
  // final project cost (admin-only, same visibility rule as budget).
  const moduleTotal = (project.modules || []).reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const finalBudget = (project.budget || 0) + moduleTotal;

  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div
        className={`rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl ${card}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-start justify-between gap-3 p-5 sm:p-6 border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
              <FolderKanban className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h3 className={`font-bold text-base leading-snug ${cardText}`}>{project.name}</h3>
              <p className={`text-xs mt-0.5 ${subtleText}`}>{project.client}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={project.status} />
            {onEdit && (
              <button onClick={onEdit} className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div>
            <p className={`text-xs font-semibold mb-1 ${cardText}`}>Description</p>
            <p className={`text-sm leading-relaxed break-words ${mutedText}`}>{project.description}</p>
          </div>

          {/* Features & Requirements — so anyone opening the project can
              understand what actually needs to be built. Editable from
              the Edit Project modal, saved permanently with the project. */}
          <div>
            <p className={`text-xs font-semibold mb-1 flex items-center gap-1.5 ${cardText}`}><ListTodo className="w-3.5 h-3.5 text-violet-500" />Features</p>
            <p className={`text-sm leading-relaxed whitespace-pre-line ${mutedText}`}>
              {project.features || "No features added yet. Use Edit to add some."}
            </p>
          </div>
          <div>
            <p className={`text-xs font-semibold mb-1 flex items-center gap-1.5 ${cardText}`}><ClipboardList className="w-3.5 h-3.5 text-violet-500" />Requirements</p>
            <p className={`text-sm leading-relaxed whitespace-pre-line ${mutedText}`}>
              {project.requirements || "No requirements added yet. Use Edit to add some."}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <p className={`flex items-center gap-1 ${subtleText}`}><Building2 className="w-3 h-3" />Client</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>{project.client}</p>
            </div>
            <div>
              <p className={`flex items-center gap-1 ${subtleText}`}><User className="w-3 h-3" />Manager</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>{project.manager}</p>
            </div>
            <div>
              <p className={`flex items-center gap-1 ${subtleText}`}><Clock className="w-3 h-3" />Priority</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>{project.priority || "Medium"}</p>
            </div>
            <div>
              <p className={`flex items-center gap-1 ${subtleText}`}><Calendar className="w-3 h-3" />Start Date</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>{fmtDate(project.startDate)}</p>
            </div>
            <div>
              <p className={`flex items-center gap-1 ${subtleText}`}><Calendar className="w-3 h-3" />Deadline</p>
              <p className={`font-semibold mt-0.5 ${cardText}`}>{fmtDate(project.deadline)}</p>
            </div>
            {isAdmin && (
              <div>
                <p className={`flex items-center gap-1 ${subtleText}`}><DollarSign className="w-3 h-3" />Budget</p>
                <p className={`font-semibold mt-0.5 ${cardText}`}>{fmtMoney(project.budget)}</p>
              </div>
            )}
            {isAdmin && moduleTotal > 0 && (
              <div>
                <p className={`flex items-center gap-1 ${subtleText}`}><Wallet className="w-3 h-3" />Final Budget</p>
                <p className={`font-semibold mt-0.5 text-violet-600`}>{fmtMoney(finalBudget)}</p>
              </div>
            )}
          </div>

          {isAdmin ? (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className={`text-xs font-semibold flex items-center gap-1.5 ${cardText}`}><Wallet className="w-3.5 h-3.5 text-violet-500" />Budget Spent</p>
                <span className={`text-[11px] font-semibold ${mutedText}`}>{fmtMoney(project.spent)} of {fmtMoney(project.budget)} ({spentPct}%)</span>
              </div>
              <div className={`w-full h-2 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${spentPct > 90 ? "bg-rose-500" : "bg-gradient-to-r from-indigo-500 to-violet-600"}`}
                  style={{ width: barsPlay ? `${Math.min(100, spentPct)}%` : "0%" }}
                />
              </div>
            </div>
          ) : (
            <div className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-400"}`}>
              <Lock className="w-3.5 h-3.5" /> Budget & spending are visible to admins only.
            </div>
          )}

          <ModulesSection
            project={project}
            isAdmin={isAdmin}
            currentUser={currentUser}
            darkMode={darkMode}
            cardText={cardText}
            mutedText={mutedText}
            subtleText={subtleText}
            barsPlay={barsPlay}
            maxHeight="max-h-80"
            onToggleDone={(moduleId) => onToggleModuleDone?.(moduleId)}
            onCycleStatus={(moduleId) => onCycleModuleStatus?.(moduleId)}
            onUploadFile={(moduleId, file) => onUploadModuleFile?.(moduleId, file)}
            onDownloadFile={(f) => onDownloadModuleFile?.(f)}
            onSetUrl={(moduleId, url) => onSetModuleUrl?.(moduleId, url)}
            onApproveHandoff={(moduleId) => onApproveModuleHandoff?.(moduleId)}
            onDeleteFile={(moduleId, f) => onDeleteModuleFile?.(moduleId, f)}
          />

          <div>
            <p className={`text-xs font-semibold mb-2 ${cardText}`}>Team Members ({project.team.length})</p>
            {project.team.length ? (
              <div className="flex flex-wrap gap-2">
                {project.team.map((n) => (
                  <div key={n} className={`flex items-center gap-2 rounded-full pl-1 pr-3 py-1 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white ${avatarColor(n)}`}>{initials(n)}</span>
                    <span className={`text-xs font-medium ${cardText}`}>{n}</span>
                    {n === project.manager && <span className="text-[9px] font-bold text-violet-600">MGR</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className={`text-xs ${subtleText}`}>No team members assigned yet.</p>
            )}
          </div>

          <div>
            <p className={`text-xs font-semibold mb-2 ${cardText}`}>Latest Deliverable</p>
            {project.deliverable ? (
              <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                <span className="w-9 h-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${cardText}`}>{project.deliverable.name}</p>
                  <p className={`text-[10px] ${subtleText}`}>Uploaded {fmtDate(project.deliverable.date)} · {(project.deliverable.size || 1).toFixed(1)} MB</p>
                </div>
                <button onClick={() => onPreview(project.deliverable)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 ${mutedText} ${darkMode ? "hover:bg-slate-700" : "hover:bg-slate-200"}`}>
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>
                <button onClick={onDownload} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 bg-violet-600 text-white hover:opacity-90">
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
              </div>
            ) : (
              <p className={`text-xs ${subtleText}`}>No deliverables uploaded yet.</p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className={`text-xs font-semibold flex items-center gap-1.5 ${cardText}`}>
                <Archive className="w-3.5 h-3.5 text-violet-500" />Project Files (ZIP)
              </p>
              {canUploadZip && (
                <label className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 cursor-pointer">
                  {project.completedZip ? "Replace file" : "Upload ZIP"}
                  <input
                    type="file"
                    accept=".zip,application/zip,application/x-zip-compressed"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) onUploadZip?.(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            {project.completedZip ? (
              <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <Archive className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${cardText}`}>{project.completedZip.fileName}</p>
                  <p className={`text-[10px] ${subtleText}`}>
                    Uploaded by {project.completedZip.uploadedBy} on {fmtDate(project.completedZip.uploadedOn)} · {(project.completedZip.size || 0).toFixed(1)} MB
                  </p>
                </div>
              </div>
            ) : (
              <p className={`text-xs ${subtleText}`}>
                {canUploadZip ? "No completed files uploaded yet — upload the finished work as a ZIP once it's ready." : "No completed files uploaded yet."}
              </p>
            )}
            {project.completedZip && (
              <p className={`text-[10px] mt-1.5 ${subtleText}`}>Downloadable from the Zip Files page (admin password required).</p>
            )}
          </div>

          {/* Project Link — the workable link attached when the project
              was marked Completed (deployed site, repo, doc, etc.). */}
          {project.completionLink && (
            <div>
              <p className={`text-xs font-semibold mb-2 flex items-center gap-1.5 ${cardText}`}><Link2 className="w-3.5 h-3.5 text-violet-500" />Project Link</p>
              <a
                href={project.completionLink}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-violet-600 hover:underline break-all ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{project.completionLink}</span>
              </a>
            </div>
          )}

          {/* Daily Reports — jumps over to the Reports page's Daily
              Reports section already filtered to this project, showing
              every photo/video log tagged with it. Only shown once the
              project is Completed, matching where the same action lives
              in the row menu and the compact details panel. */}
          {project.status === "Completed" && (
            <div>
              <p className={`text-xs font-semibold mb-2 flex items-center gap-1.5 ${cardText}`}><Video className="w-3.5 h-3.5 text-violet-500" />Daily Reports</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onViewDailyReports}
                  className={`flex-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-xs font-semibold text-violet-600 hover:underline ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}
                >
                  <Video className="w-3.5 h-3.5 shrink-0" />
                  View this project's daily reports (photos &amp; videos)
                </button>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={onDeleteDailyReports}
                    title="Delete this project's daily reports"
                    aria-label="Delete this project's daily reports"
                    className={`shrink-0 w-10 h-10 flex items-center justify-center rounded-xl text-rose-500 ${darkMode ? "bg-slate-800 hover:bg-slate-700" : "bg-slate-50 hover:bg-rose-50"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}

          <div>
            <p className={`text-xs font-semibold mb-1 ${cardText}`}>Notes</p>
            <p className={`text-xs leading-relaxed ${mutedText}`}>{project.notes}</p>
          </div>
        </div>

        <div className={`flex flex-wrap gap-2 p-5 sm:p-6 border-t ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
          {STATUS_OPTIONS.filter((s) => s !== project.status).map((s) =>
            s === "Completed" ? (
              <button
                key={s}
                onClick={() => setCompleteLinkOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white transition"
              >
                <Check className="w-3.5 h-3.5" /> Mark as Completed
              </button>
            ) : (
              <button
                key={s}
                onClick={() => onSetStatus(s)}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                Mark as {s}
              </button>
            )
          )}

          {/* Marking Completed always asks for a link first — the
              project can't be finished without attaching something the
              team/client can actually open and use. */}
          {completeLinkOpen && (
            <div className={`w-full rounded-xl p-3 mt-1 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
              <p className={`text-xs font-semibold mb-2 flex items-center gap-1.5 ${cardText}`}>
                <Link2 className="w-3.5 h-3.5 text-violet-500" /> Attach the project link to mark as Completed
              </p>
              <input
                type="url"
                autoFocus
                value={completeLink}
                onChange={(e) => setCompleteLink(e.target.value)}
                placeholder="https://your-deployed-link.com"
                className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
              {!linkLooksValid && completeLink.trim() !== "" && (
                <p className="text-[11px] text-rose-500 mt-1">Link should start with http:// or https://</p>
              )}
              <div className="flex gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => setCompleteLinkOpen(false)}
                  className={`flex-1 border text-xs font-semibold py-2 rounded-full ${inputCls}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!linkLooksValid}
                  onClick={() => {
                    onSetStatus("Completed", completeLink.trim());
                    setCompleteLinkOpen(false);
                  }}
                  className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-xs font-semibold py-2 rounded-full transition"
                >
                  Confirm & Mark Completed
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   DELIVERABLE PREVIEW MODAL
====================================================================== */

function DeliverablePreviewModal({ data, darkMode, card, cardText, mutedText, subtleText, onClose, onDownload }) {
  const { project, deliverable } = data;
  const ext = deliverable.name.split(".").pop()?.toUpperCase() || "FILE";

  return (
    <div className="fixed inset-0 z-[98] bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md shadow-2xl overflow-hidden ${card}`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
          <p className={`font-bold text-sm ${cardText}`}>File Preview</p>
          <button onClick={onClose} className={`w-7 h-7 flex items-center justify-center rounded-lg ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6 flex flex-col items-center text-center">
          <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 bg-violet-50 text-violet-600`}>
            <FileText className="w-9 h-9" />
          </div>
          <p className={`font-semibold text-sm break-all ${cardText}`}>{deliverable.name}</p>
          <p className={`text-xs mt-1 ${subtleText}`}>{ext} file · {(deliverable.size || 1).toFixed(1)} MB</p>

          <div className={`w-full mt-5 rounded-xl p-4 text-left text-xs space-y-2 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
            <div className="flex justify-between"><span className={subtleText}>Project</span><span className={`font-semibold ${cardText}`}>{project.name}</span></div>
            <div className="flex justify-between"><span className={subtleText}>Client</span><span className={`font-semibold ${cardText}`}>{project.client}</span></div>
            <div className="flex justify-between"><span className={subtleText}>Uploaded</span><span className={`font-semibold ${cardText}`}>{fmtDate(deliverable.date)}</span></div>
          </div>
          <p className={`text-[11px] mt-3 ${subtleText}`}>Live preview isn't available for this file type in the demo — download it to view the full contents.</p>
        </div>
        <div className={`flex gap-2 px-5 pb-5`}>
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${darkMode ? "border-slate-700 text-slate-300" : "border-slate-200 text-slate-600"}`}>Close</button>
          <button onClick={onDownload} className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition">
            <Download className="w-4 h-4" /> Download
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   CREATE PROJECT MODAL
====================================================================== */

function CreateProjectModal({ onClose, onSubmit, darkMode, teamOptions = [], excludeAssignees = [], teamDirectory = {}, clientOptions = [], isAdmin, currentUser }) {
  const [form, setForm] = useState({
    name: "", description: "", projectType: "company", client: "", manager: "", team: [], deadline: "", budget: "", features: "", requirements: "",
    briefFile: null, // { id, fileName, mime, size, storedInIDB } (or legacy { id, fileName, dataUrl, mime, size, storedInIDB: false })
    additionalInfo: "",
    projectZip: null, // { id, fileName, uploadedBy, uploadedOn, size, storedInIDB } (or legacy { ...same, dataUrl, storedInIDB: false })
    // Modules (Frontend, Backend, UI/UX, etc.) added manually right here
    // while creating the project — each one can carry its own assignee,
    // priority, due date, reference URL and an optional file.
    modules: [],
    // Per-project employees' commission for this project: { [employeeId]: "amount" }
    commissions: {},
  });
  const [teamOpen, setTeamOpen] = useState(false);
  const [briefError, setBriefError] = useState("");
  const [zipError, setZipError] = useState("");
  const [newModule, setNewModule] = useState({ name: "", assignee: "", priority: "Medium", dueDate: "", url: "", price: "", fileEntry: null });
  const [moduleFileError, setModuleFileError] = useState("");
  const teamRef = useRef(null);
  // A Client Project must have a real client picked from the Clients
  // page's own list — a Company Project never needs one.
  const canSubmit = form.name.trim() && form.deadline && (form.projectType === "company" || form.client);
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";
  const menuCard = darkMode ? "bg-slate-900 border border-slate-700" : "bg-white border border-slate-200";

  const handleBriefFile = async (file) => {
    if (!file) return;
    setBriefError("");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = file.type.startsWith("image/");
    if (!isPdf && !isImage) {
      setBriefError("Only a PDF or an image/screenshot can be attached here.");
      return;
    }
    if (file.size > MAX_PROJECT_ATTACHMENT_BYTES) {
      setBriefError("File is too large (max 5MB).");
      return;
    }
    // FIX (silent project-save failure): this used to base64-encode the
    // whole file and store it directly on the project object, which then
    // got JSON.stringify'd into localStorage on every save. A PDF a few
    // MB in size was often enough to blow past localStorage's shared
    // quota, so `saveStoredProjects` failed silently and the newly
    // created project would vanish the moment this page re-read storage
    // (e.g. on navigating away and back). The actual bytes now go to
    // IndexedDB (see attachmentStorage.js) — the project object only
    // ever carries a small `id` reference, same pattern already used for
    // message attachments via idbPutMessageMedia.
    const id = `brief-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored = await saveAttachmentBlob(id, file);
    const mime = file.type || (isPdf ? "application/pdf" : "image/png");
    // FIX (brief never reached Messages / the backend): this used to only
    // keep the IndexedDB metadata ({ id, fileName, mime, size }) and threw
    // away the actual File object, so downstream code that needed the raw
    // File (uploading to /api/projects/<id>/brief/, forwarding it as a
    // real Messages attachment) always saw nothing to send. `file` is
    // kept here too now — it doesn't get JSON.stringify'd into
    // localStorage (see saveStoredProjects, which strips it back out
    // before persisting), so the original silent-quota-failure this
    // function was written to avoid still can't happen.
    if (stored.storedInIDB) {
      setForm((f) => ({ ...f, briefFile: { id, fileName: file.name, mime, size: file.size, storedInIDB: true, file } }));
      return;
    }
    // IndexedDB unavailable in this environment (e.g. a sandboxed
    // preview) — fall back to the old base64 path so the upload still
    // works, same 5MB cap as before.
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setForm((f) => ({ ...f, briefFile: { id, fileName: file.name, dataUrl, mime, size: file.size, storedInIDB: false, file } }));
    } catch (e) {
      setBriefError(e.message || "Could not read that file.");
    }
  };

  const handleZipFile = (file) => {
    if (!file) return;
    setZipError("");
    if (!/\.zip$/i.test(file.name)) {
      setZipError("Only a .zip file can be uploaded here.");
      return;
    }
    // FIX: this used to immediately encode the file into IndexedDB /
    // base64-in-localStorage right here, at pick-time — capped at 5MB on
    // the fallback path purely because of browser storage quotas, and
    // never actually reached the server even when it "succeeded". A
    // project doesn't have an id yet at this point in the form, so the
    // real backend zip endpoint (POST /api/projects/<id>/zip/) can't be
    // called until AFTER the project is created. So this now just holds
    // onto the raw File object — no size cap, nothing encoded — and
    // handleCreate (below, after projectsApi.createProject resolves)
    // uploads it for real once the new project's id exists.
    setForm((f) => ({
      ...f,
      projectZip: { file, fileName: file.name, size: file.size / (1024 * 1024) },
    }));
  };

  useEffect(() => {
    function onClickOutside(e) {
      if (teamRef.current && !teamRef.current.contains(e.target)) setTeamOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggleTeamMember = (name) => {
    setForm((f) => ({
      ...f,
      team: f.team.includes(name) ? f.team.filter((n) => n !== name) : [...f.team, name],
    }));
  };

  // Uploads immediately (same pattern as the brief/zip uploads above) so
  // the file is safely in IndexedDB the moment it's picked, rather than
  // sitting around as a raw File object waiting for "Add module".
  const handleNewModuleFile = async (file) => {
    if (!file) return;
    setModuleFileError("");
    try {
      const entry = await saveModuleFile(file);
      setNewModule((f) => ({ ...f, fileEntry: entry }));
    } catch (e) {
      setModuleFileError(e.message || "Could not upload that file.");
    }
  };

  const addModule = () => {
    const name = newModule.name.trim();
    if (!name) return;
    const mod = {
      id: `m-${Date.now()}`,
      name,
      description: "",
      price: Number(newModule.price) || 0,
      addedOn: new Date().toISOString().slice(0, 10),
      assignee: newModule.assignee || "Unassigned",
      status: "Pending",
      priority: newModule.priority || "Medium",
      dueDate: newModule.dueDate || "",
      url: newModule.url.trim(),
      files: newModule.fileEntry
        ? [{ ...newModule.fileEntry, uploadedBy: currentUser, uploadedOn: new Date().toISOString().slice(0, 10) }]
        : [],
    };
    setForm((f) => ({ ...f, modules: [...f.modules, mod] }));
    setNewModule({ name: "", assignee: "", priority: "Medium", dueDate: "", url: "", price: "", fileEntry: null });
    setModuleFileError("");
  };

  const removeModule = (id) => {
    setForm((f) => ({ ...f, modules: f.modules.filter((m) => m.id !== id) }));
  };

  // Every module's price adds on top of the real budget, same as before —
  // admin-only, same visibility rule as the budget field itself.
  const moduleTotal = form.modules.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const finalBudget = (Number(form.budget) || 0) + moduleTotal;

  // Assignee options for a module: manager + selected team members so
  // far, falling back to every approved user if nobody's picked yet.
  const moduleAssigneeOptions = Array.from(new Set([...(form.manager ? [form.manager] : []), ...form.team, ...teamOptions])).filter((n) => !excludeAssignees.includes(n));

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Create Project</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Project name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Customer Portal Revamp" className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              onInput={(e) => autoGrowTextarea(e.target)}
              ref={(el) => autoGrowTextarea(el)}
              rows={2}
              placeholder="Brief summary of the project"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          {/* Project type — Company (internal) or Client. Picking Client
              is what turns on the client dropdown just below, sourced
              live from the Clients page so only a real client can ever
              be linked to a project. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Project for</label>
            <div className={`grid grid-cols-2 gap-2 p-1 rounded-lg ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, projectType: "company", client: "" }))}
                className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-md transition ${form.projectType === "company" ? "bg-violet-600 text-white shadow" : darkMode ? "text-slate-300" : "text-slate-600"}`}
              >
                <Building2 className="w-3.5 h-3.5" /> Company Project
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, projectType: "client" }))}
                className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-md transition ${form.projectType === "client" ? "bg-violet-600 text-white shadow" : darkMode ? "text-slate-300" : "text-slate-600"}`}
              >
                <User className="w-3.5 h-3.5" /> Client Project
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {form.projectType === "client" ? (
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">Client</label>
                <select value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
                  <option value="">Select client</option>
                  {clientOptions.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}
                </select>
                {clientOptions.length === 0 && (
                  <p className="text-[10.5px] text-slate-400 mt-1">No clients yet — add one on the Clients page first.</p>
                )}
              </div>
            ) : (
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">Client</label>
                <div className={`w-full text-sm border rounded-lg px-2.5 py-2.5 ${darkMode ? "bg-slate-800/60 border-slate-700 text-slate-500" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  Internal / Company Project
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Project manager</label>
              <select value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
                <option value="">Select manager</option>
                {teamOptions.map((t) => (
                  <option key={t} value={t}>{teamDirectory[t] ? `${t} — ${teamDirectory[t]}` : t}</option>
                ))}
              </select>
              {teamOptions.length === 0 && (
                <p className="text-[10.5px] text-slate-400 mt-1">No approved users yet — approve people in the Users page first.</p>
              )}
            </div>
          </div>

          {/* NEW: multi-select team members */}
          <div className="relative" ref={teamRef}>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Team members</label>
            <button
              type="button"
              onClick={() => setTeamOpen((v) => !v)}
              className={`w-full flex items-center justify-between text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            >
              <span className={`truncate ${form.team.length ? "" : "text-slate-400"}`}>
                {form.team.length ? `${form.team.length} member${form.team.length > 1 ? "s" : ""} selected` : "Select team members"}
              </span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${teamOpen ? "rotate-180" : ""}`} />
            </button>

            {form.team.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.team.map((n) => (
                  <span
                    key={n}
                    className={`flex items-center gap-1 text-[11px] font-semibold pl-1 pr-1.5 py-1 rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}
                  >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white ${avatarColor(n)}`}>{initials(n)}</span>
                    {n}
                    <button type="button" onClick={() => toggleTeamMember(n)} className="ml-0.5 text-slate-400 hover:text-rose-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {teamOpen && (
              <div className={`absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl shadow-xl max-h-56 overflow-y-auto py-1 ${menuCard}`}>
                {teamOptions.length === 0 && (
                  <p className="px-3 py-2 text-xs text-slate-400">No approved users available yet.</p>
                )}
                {teamOptions.map((name) => {
                  const checked = form.team.includes(name);
                  return (
                    <button
                      type="button"
                      key={name}
                      onClick={() => toggleTeamMember(name)}
                      className={`w-full flex items-center gap-2.5 text-left px-3 py-2 text-sm ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
                    >
                      <span
                        className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${
                          checked ? "bg-violet-600 border-violet-600" : darkMode ? "border-slate-600" : "border-slate-300"
                        }`}
                      >
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${avatarColor(name)}`}>
                        {initials(name)}
                      </span>
                      <span className="min-w-0">
                        <span className={`block truncate ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{name}</span>
                        {teamDirectory[name] && (
                          <span className={`block text-[10.5px] truncate ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{teamDirectory[name]}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <CommissionFields
            names={[form.manager, ...form.team, ...form.modules.map((m) => m.assignee)]}
            values={form.commissions}
            onChange={(v) => setForm((f) => ({ ...f, commissions: v }))}
            darkMode={darkMode}
          />

          <div className={`grid grid-cols-1 gap-2 ${isAdmin ? "sm:grid-cols-2" : ""}`}>
            <div className="min-w-0">
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Deadline</label>
              <input type="date" min="2000-01-01" max="2100-12-31" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: clampDateInput(e.target.value) })} className={`w-full min-w-0 text-sm border rounded-lg px-2.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
            </div>
            {isAdmin && (
              <div className="min-w-0">
                <label className="text-xs font-semibold text-slate-500 mb-1 block">Budget (PKR)</label>
                <input type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder="0" className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
              </div>
            )}
          </div>

          {/* Modules — the project is broken into modules (Frontend,
              Backend, UI/UX, etc.) right from creation instead of a
              single numeric task count. Each module gets its own
              assignee, priority, due date, an optional reference URL,
              and an optional file — all editable later too. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" />Modules</label>
            <div className={`space-y-2 mb-2 rounded-lg p-2.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
              <input
                value={newModule.name}
                onChange={(e) => setNewModule((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModule(); } }}
                placeholder="Module name (e.g. Frontend, Backend, UI/UX)"
                className={`w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
              <div className="grid grid-cols-2 gap-2">
                <select value={newModule.assignee} onChange={(e) => setNewModule((f) => ({ ...f, assignee: e.target.value }))} className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`}>
                  <option value="">Unassigned</option>
                  {moduleAssigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select value={newModule.priority} onChange={(e) => setNewModule((f) => ({ ...f, priority: e.target.value }))} className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`}>
                  {MODULE_PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p} priority</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" min="2000-01-01" max="2100-12-31" value={newModule.dueDate} onChange={(e) => setNewModule((f) => ({ ...f, dueDate: clampDateInput(e.target.value) }))} className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`} />
                {isAdmin && (
                  <input type="number" min="0" value={newModule.price} onChange={(e) => setNewModule((f) => ({ ...f, price: e.target.value }))} placeholder="Price (PKR)" className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`} />
                )}
              </div>
              <input
                type="url"
                value={newModule.url}
                onChange={(e) => setNewModule((f) => ({ ...f, url: e.target.value }))}
                placeholder="Reference URL for this module (optional)"
                className={`w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
              <div className="flex items-center gap-2">
                <label className={`flex-1 flex items-center gap-2 text-xs border rounded-lg px-3 py-2 cursor-pointer ${inputCls}`}>
                  <Paperclip className="w-3.5 h-3.5 shrink-0 text-violet-500" />
                  <span className={`truncate ${newModule.fileEntry ? "" : "text-slate-400"}`}>{newModule.fileEntry ? newModule.fileEntry.fileName : "Attach a file (optional)"}</span>
                  <input type="file" className="hidden" onChange={(e) => handleNewModuleFile(e.target.files?.[0])} />
                </label>
                <button type="button" onClick={addModule} disabled={!newModule.name.trim()} className="shrink-0 flex items-center gap-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold px-3 py-2 rounded-lg">
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
              {moduleFileError && <p className="text-[10.5px] text-rose-500">{moduleFileError}</p>}
            </div>

            {form.modules.length > 0 ? (
              <div className="space-y-1.5">
                {form.modules.map((m) => (
                  <div key={m.id} className={`flex items-start justify-between gap-2 rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{m.name}</p>
                      <p className="text-[10.5px] mt-0.5 opacity-80 truncate">
                        {m.assignee && m.assignee !== "Unassigned" ? m.assignee : "Unassigned"} · {m.priority}
                        {m.dueDate ? ` · Due ${fmtDate(m.dueDate)}` : ""}
                        {m.url ? " · has link" : ""}
                        {(m.files || []).length > 0 ? " · has file" : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isAdmin && Number(m.price) > 0 && (
                        <span className="text-[11px] font-semibold text-violet-500">{fmtMoney(m.price)}</span>
                      )}
                      <button type="button" onClick={() => removeModule(m.id)} className="text-slate-400 hover:text-rose-500">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">No modules yet — add one above.</p>
            )}

            {isAdmin && moduleTotal > 0 && (
              <p className="text-[11px] mt-2 text-slate-400">
                Modules total <span className="font-semibold text-violet-600">{fmtMoney(moduleTotal)}</span> + budget = final budget{" "}
                <span className="font-semibold text-violet-600">{fmtMoney(finalBudget)}</span>
              </p>
            )}
          </div>

          {/* Features & Requirements — so anyone opening the project
              later understands what it actually needs to become. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><ListTodo className="w-3.5 h-3.5" />Features</label>
            <textarea
              value={form.features}
              onChange={(e) => setForm({ ...form, features: e.target.value })}
              rows={3}
              placeholder="What the project should do, one per line"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" />Requirements</label>
            <textarea
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              rows={3}
              placeholder="What's needed to build it, one per line"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>

          {/* Project brief — a PDF or a screenshot of the project (spec,
              mockup, client brief, whatever explains the project). Once
              the project is created and its team is set, this gets
              attached automatically to the assignment message each team
              member/manager receives on the Messages page. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />Project details (PDF or screenshot)</label>
            <label className={`flex items-center gap-2.5 text-sm border rounded-lg px-3 py-2.5 cursor-pointer ${inputCls}`}>
              <Plus className="w-3.5 h-3.5 shrink-0 text-violet-500" />
              <span className={`truncate ${form.briefFile ? "" : "text-slate-400"}`}>{form.briefFile ? form.briefFile.fileName : "Attach a PDF or screenshot"}</span>
              <input type="file" accept={PROJECT_BRIEF_ACCEPT} className="hidden" onChange={(e) => handleBriefFile(e.target.files?.[0])} />
            </label>
            {briefError && <p className="text-[10.5px] text-rose-500 mt-1">{briefError}</p>}
            {form.briefFile && (
              <p className="text-[10.5px] mt-1 flex items-center gap-1 text-emerald-600">
                <Check className="w-3 h-3" /> Will be sent with the assignment message once created.
              </p>
            )}
          </div>

          {/* Additional info — free-text notes for anything not covered by
              the fields above (links, credentials, special instructions,
              anything the team needs to know). Sent along in the
              assignment message the manager and every assigned team
              member receive on the Messages page once the project is
              created. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />Additional info</label>
            <textarea
              value={form.additionalInfo}
              onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })}
              rows={3}
              placeholder="Any extra notes, links, or instructions for the team"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>

          {/* End of the form: the whole project package as one .zip —
              same field FullDetailsModal's own "Upload ZIP" writes
              (`completedZip`), so it shows up on the Zip Files page
              right away either way it gets attached. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Project ZIP file</label>
            <label className={`flex items-center gap-2.5 text-sm border rounded-lg px-3 py-2.5 cursor-pointer ${inputCls}`}>
              <Plus className="w-3.5 h-3.5 shrink-0 text-violet-500" />
              <span className={`truncate ${form.projectZip ? "" : "text-slate-400"}`}>{form.projectZip ? form.projectZip.fileName : "Upload a .zip file (optional)"}</span>
              <input type="file" accept=".zip" className="hidden" onChange={(e) => handleZipFile(e.target.files?.[0])} />
            </label>
            {zipError && <p className="text-[10.5px] text-rose-500 mt-1">{zipError}</p>}
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>Cancel</button>
          <button disabled={!canSubmit} onClick={() => onSubmit(form)} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Create Project
          </button>
        </div>
      </div>
    </div>
  );
}
/* ======================================================================
   EDIT PROJECT MODAL
   Real editing (not just a status toggle): name/description/client,
   manager + team (only from users an admin has approved in the Users
   page), status, deadline & start date ("duration"), task count, and
   per-project Modules (add as many as needed / remove any time). Budget
   is only editable — and only visible — for an admin. Whatever is saved
   here flows back into `projects` state and is persisted to
   localStorage by ProjectsPage's effect, so it stays saved across
   reloads/navigation until someone explicitly deletes the project.
====================================================================== */

function EditProjectModal({ project, onClose, onSubmit, darkMode, teamOptions = [], excludeAssignees = [], teamDirectory = {}, clientOptions = [], isAdmin, currentUser }) {
  const [form, setForm] = useState({
    name: project.name,
    description: project.description,
    projectType: project.projectType || "company",
    client: project.client,
    manager: project.manager,
    team: project.team.filter((n) => n !== project.manager),
    status: project.status,
    startDate: project.startDate || "",
    deadline: project.deadline || "",
    budget: String(project.budget ?? ""),
    modules: project.modules || [],
    features: project.features || "",
    requirements: project.requirements || "",
    additionalInfo: project.additionalInfo || "",
    completionLink: project.completionLink || "",
    commissions: {},
  });
  // What is already saved as commission for this project (per-project people only).
  const initialCommissions = useCommissionPrefill({ projectId: /^\d+$/.test(String(project.id)) ? Number(project.id) : null }, (map) =>
    setForm((f) => ({ ...f, commissions: { ...map, ...f.commissions } }))
  );
  const [newModule, setNewModule] = useState({ name: "", assignee: "", priority: "Medium", dueDate: "", url: "", price: "", fileEntry: null });
  const [moduleFileError, setModuleFileError] = useState("");
  const [teamOpen, setTeamOpen] = useState(false);
  const teamRef = useRef(null);
  const canSubmit = form.name.trim() && form.client && (form.status !== "Completed" || /^https?:\/\/\S+/i.test((form.completionLink || "").trim()));

  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200";
  const menuCard = darkMode ? "bg-slate-900 border border-slate-700" : "bg-white border border-slate-200";

  useEffect(() => {
    function onClickOutside(e) {
      if (teamRef.current && !teamRef.current.contains(e.target)) setTeamOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const toggleTeamMember = (name) => {
    setForm((f) => ({
      ...f,
      team: f.team.includes(name) ? f.team.filter((n) => n !== name) : [...f.team, name],
    }));
  };

  // Uploads immediately into IndexedDB (same pattern as the brief/zip
  // uploads in CreateProjectModal) so the bytes are safe the moment a
  // file's picked, whether it's for a brand-new module below or an
  // existing one further down.
  const handleNewModuleFile = async (file) => {
    if (!file) return;
    setModuleFileError("");
    try {
      const entry = await saveModuleFile(file);
      setNewModule((f) => ({ ...f, fileEntry: entry }));
    } catch (e) {
      setModuleFileError(e.message || "Could not upload that file.");
    }
  };

  const addModule = () => {
    const name = newModule.name.trim();
    if (!name) return;
    const mod = {
      id: `m-${Date.now()}`,
      name,
      description: "",
      price: Number(newModule.price) || 0,
      addedOn: new Date().toISOString().slice(0, 10),
      assignee: newModule.assignee || "Unassigned",
      status: "Pending",
      priority: newModule.priority || "Medium",
      dueDate: newModule.dueDate || "",
      url: newModule.url.trim(),
      files: newModule.fileEntry
        ? [{ ...newModule.fileEntry, uploadedBy: currentUser, uploadedOn: new Date().toISOString().slice(0, 10) }]
        : [],
    };
    setForm((f) => ({ ...f, modules: [...f.modules, mod] }));
    setNewModule({ name: "", assignee: "", priority: "Medium", dueDate: "", url: "", price: "", fileEntry: null });
    setModuleFileError("");
  };

  // Real budget + every module's price = the project's final budget.
  // Admin-only, same visibility rule as the budget field itself.
  const moduleTotal = form.modules.reduce((sum, m) => sum + (Number(m.price) || 0), 0);
  const finalBudget = (Number(form.budget) || 0) + moduleTotal;

  const removeModule = (id) => {
    setForm((f) => ({ ...f, modules: f.modules.filter((m) => m.id !== id) }));
  };

  // Field-level edits on an already-added module (status/assignee/
  // priority/due date/url) — used by the editable module rows below.
  const updateModuleField = (id, field, value) => {
    setForm((f) => ({ ...f, modules: f.modules.map((m) => (m.id === id ? { ...m, [field]: value } : m)) }));
  };
  const handleModuleFileFor = async (moduleId, file) => {
    if (!file) return;
    try {
      const entry = await saveModuleFile(file);
      const fileEntry = { ...entry, uploadedBy: currentUser, uploadedOn: new Date().toISOString().slice(0, 10) };
      setForm((f) => ({
        ...f,
        modules: f.modules.map((m) => (m.id === moduleId ? { ...m, files: [...(m.files || []), fileEntry] } : m)),
      }));
    } catch {
      // Best-effort — the module itself is still saved fine without the file.
    }
  };
  const removeModuleFile = (moduleId, fileId) => {
    setForm((f) => ({
      ...f,
      modules: f.modules.map((m) => (m.id === moduleId ? { ...m, files: (m.files || []).filter((x) => x.id !== fileId) } : m)),
    }));
  };

  // Assignee options for a module: manager + selected team members so
  // far, falling back to every approved user if nobody's picked yet.
  const moduleAssigneeOptions = Array.from(new Set([...(form.manager ? [form.manager] : []), ...form.team, ...teamOptions])).filter((n) => !excludeAssignees.includes(n));

  // Everyone selectable in these dropdowns must come from real approved
  // users. The project's current manager/team is always kept selectable
  // even if that person has since been deactivated, so editing doesn't
  // silently drop them from a field they're still shown in.
  const managerOptions = Array.from(new Set([...(project.manager ? [project.manager] : []), ...teamOptions]));
  const teamMenuOptions = Array.from(new Set([...teamOptions, ...project.team]));

  return (
    <div className="fixed inset-0 z-[92] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${modalCard}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Edit Project</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Project name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              onInput={(e) => autoGrowTextarea(e.target)}
              ref={(el) => autoGrowTextarea(el)}
              rows={2}
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>

          {/* Features & Requirements — so anyone opening the project
              understands what it actually needs to become. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><ListTodo className="w-3.5 h-3.5" />Features</label>
            <textarea
              value={form.features}
              onChange={(e) => setForm({ ...form, features: e.target.value })}
              rows={3}
              placeholder="What the project should do, one per line"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><ClipboardList className="w-3.5 h-3.5" />Requirements</label>
            <textarea
              value={form.requirements}
              onChange={(e) => setForm({ ...form, requirements: e.target.value })}
              rows={3}
              placeholder="What's needed to build it, one per line"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" />Additional info</label>
            <textarea
              value={form.additionalInfo}
              onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })}
              rows={3}
              placeholder="Any extra notes, links, or instructions for the team"
              className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 resize-none ${inputCls}`}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Project for</label>
            <div className={`grid grid-cols-2 gap-2 p-1 rounded-lg ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, projectType: "company", client: "Internal / Company Project" }))}
                className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-md transition ${form.projectType === "company" ? "bg-violet-600 text-white shadow" : darkMode ? "text-slate-300" : "text-slate-600"}`}
              >
                <Building2 className="w-3.5 h-3.5" /> Company Project
              </button>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, projectType: "client", client: clientOptions.some((c) => c.name === f.client) ? f.client : "" }))}
                className={`flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-md transition ${form.projectType === "client" ? "bg-violet-600 text-white shadow" : darkMode ? "text-slate-300" : "text-slate-600"}`}
              >
                <User className="w-3.5 h-3.5" /> Client Project
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Client</label>
              {form.projectType === "client" ? (
                <select value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
                  <option value="">Select client</option>
                  {clientOptions.map((c) => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}
                </select>
              ) : (
                <div className={`w-full text-sm border rounded-lg px-2.5 py-2.5 ${darkMode ? "bg-slate-800/60 border-slate-700 text-slate-500" : "bg-slate-50 border-slate-200 text-slate-400"}`}>
                  Internal / Company Project
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Status</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Only relevant once the project is (or is being set to)
              Completed — lets the link attached via "Mark as Completed"
              be reviewed or corrected later. Required (same rule as the
              "Mark as Completed" flow in the details modal) — you can't
              save this form with status Completed and no valid link. */}
          {form.status === "Completed" && (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5" />Project link <span className="text-rose-500">*</span>
              </label>
              <input
                type="url"
                value={form.completionLink}
                onChange={(e) => setForm({ ...form, completionLink: e.target.value })}
                placeholder="https://your-deployed-link.com"
                className={`w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 ${
                  form.completionLink.trim() && !/^https?:\/\/\S+/i.test(form.completionLink.trim())
                    ? "border-rose-400 focus:ring-rose-300"
                    : "focus:ring-violet-400"
                } ${inputCls}`}
              />
              <p className={`text-[11px] mt-1 ${!/^https?:\/\/\S+/i.test((form.completionLink || "").trim()) ? "text-rose-500" : "text-emerald-600"}`}>
                {/^https?:\/\/\S+/i.test((form.completionLink || "").trim())
                  ? "Looks good — this will be attached as the completed project's link."
                  : "A workable link (starting with http:// or https://) is required to save a project as Completed."}
              </p>
            </div>
          )}

          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Project manager</label>
            <select value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none ${inputCls}`}>
              <option value="">Unassigned</option>
              {managerOptions.map((t) => (
                <option key={t} value={t}>{teamDirectory[t] ? `${t} — ${teamDirectory[t]}` : t}</option>
              ))}
            </select>
          </div>

          {/* Team members — only approved users show up here */}
          <div className="relative" ref={teamRef}>
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Team members</label>
            <button
              type="button"
              onClick={() => setTeamOpen((v) => !v)}
              className={`w-full flex items-center justify-between text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            >
              <span className={`truncate ${form.team.length ? "" : "text-slate-400"}`}>
                {form.team.length ? `${form.team.length} member${form.team.length > 1 ? "s" : ""} selected` : "Select team members"}
              </span>
              <ChevronDown size={14} className={`shrink-0 transition-transform ${teamOpen ? "rotate-180" : ""}`} />
            </button>

            {form.team.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.team.map((n) => (
                  <span key={n} className={`flex items-center gap-1 text-[11px] font-semibold pl-1 pr-1.5 py-1 rounded-full ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-white ${avatarColor(n)}`}>{initials(n)}</span>
                    {n}
                    <button type="button" onClick={() => toggleTeamMember(n)} className="ml-0.5 text-slate-400 hover:text-rose-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {teamOpen && (
              <div className={`absolute left-0 right-0 top-full mt-1.5 z-30 rounded-xl shadow-xl max-h-56 overflow-y-auto py-1 ${menuCard}`}>
                {teamMenuOptions.length === 0 && (
                  <p className="px-3 py-2 text-xs text-slate-400">No approved users available yet.</p>
                )}
                {teamMenuOptions.map((name) => {
                  const checked = form.team.includes(name);
                  return (
                    <button
                      type="button"
                      key={name}
                      onClick={() => toggleTeamMember(name)}
                      className={`w-full flex items-center gap-2.5 text-left px-3 py-2 text-sm ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
                    >
                      <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border ${checked ? "bg-violet-600 border-violet-600" : darkMode ? "border-slate-600" : "border-slate-300"}`}>
                        {checked && <Check className="w-3 h-3 text-white" />}
                      </span>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0 ${avatarColor(name)}`}>
                        {initials(name)}
                      </span>
                      <span className="min-w-0">
                        <span className={`block truncate ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{name}</span>
                        {teamDirectory[name] && (
                          <span className={`block text-[10.5px] truncate ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{teamDirectory[name]}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <CommissionFields
            names={[form.manager, ...form.team, ...form.modules.map((m) => m.assignee)]}
            values={form.commissions}
            onChange={(v) => setForm((f) => ({ ...f, commissions: v }))}
            darkMode={darkMode}
          />

          {/* Duration — start date + deadline, both editable so the
              project's timeline can be extended (or pulled in) at any
              point. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="min-w-0">
              <label className="text-xs font-semibold text-slate-500 mb-1 block flex items-center gap-1"><CalendarClock className="w-3 h-3" />Start date</label>
              <input type="date" min="2000-01-01" max="2100-12-31" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: clampDateInput(e.target.value) })} className={`w-full min-w-0 text-sm border rounded-lg px-2.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
            </div>
            <div className="min-w-0">
              <label className="text-xs font-semibold text-slate-500 mb-1 block flex items-center gap-1"><CalendarClock className="w-3 h-3" />Deadline</label>
              <input type="date" min="2000-01-01" max="2100-12-31" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: clampDateInput(e.target.value) })} className={`w-full min-w-0 text-sm border rounded-lg px-2.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
            </div>
          </div>

          {/* Budget — admin only, both to see and to change */}
          {isAdmin ? (
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Budget (PKR)</label>
              <input type="number" min="0" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} className={`w-full text-sm border rounded-lg px-2.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`} />
            </div>
          ) : (
            <p className={`text-[11px] flex items-center gap-1.5 rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-50 text-slate-400"}`}>
              <Lock className="w-3.5 h-3.5" /> Only an admin can view or change the budget.
            </p>
          )}

          {/* Modules — the project's Modules (Frontend, Backend, UI/UX,
              etc.) replace the old numeric task count entirely. Add as
              many as needed, remove any time; each one carries its own
              assignee, status, priority, due date, an optional reference
              URL and any uploaded files (visible to an admin, whoever
              uploaded it, and the project's manager — see ModuleRow).
              Every module's price still adds on top of the real budget
              for the final budget, same as before. */}
          <div>
            <label className="text-xs font-semibold text-slate-500 mb-1 flex items-center gap-1.5"><Layers className="w-3.5 h-3.5" />Modules</label>
            <div className={`space-y-2 mb-2 rounded-lg p-2.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
              <input
                value={newModule.name}
                onChange={(e) => setNewModule((f) => ({ ...f, name: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModule(); } }}
                placeholder="Module name (e.g. Frontend, Backend, UI/UX)"
                className={`w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
              <div className="grid grid-cols-2 gap-2">
                <select value={newModule.assignee} onChange={(e) => setNewModule((f) => ({ ...f, assignee: e.target.value }))} className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`}>
                  <option value="">Unassigned</option>
                  {moduleAssigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <select value={newModule.priority} onChange={(e) => setNewModule((f) => ({ ...f, priority: e.target.value }))} className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`}>
                  {MODULE_PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p} priority</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" min="2000-01-01" max="2100-12-31" value={newModule.dueDate} onChange={(e) => setNewModule((f) => ({ ...f, dueDate: clampDateInput(e.target.value) }))} className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`} />
                {isAdmin && (
                  <input type="number" min="0" value={newModule.price} onChange={(e) => setNewModule((f) => ({ ...f, price: e.target.value }))} placeholder="Price (PKR)" className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none ${inputCls}`} />
                )}
              </div>
              <input
                type="url"
                value={newModule.url}
                onChange={(e) => setNewModule((f) => ({ ...f, url: e.target.value }))}
                placeholder="Reference URL for this module (optional)"
                className={`w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
              <div className="flex items-center gap-2">
                <label className={`flex-1 flex items-center gap-2 text-xs border rounded-lg px-3 py-2 cursor-pointer ${inputCls}`}>
                  <Paperclip className="w-3.5 h-3.5 shrink-0 text-violet-500" />
                  <span className={`truncate ${newModule.fileEntry ? "" : "text-slate-400"}`}>{newModule.fileEntry ? newModule.fileEntry.fileName : "Attach a file (optional)"}</span>
                  <input type="file" className="hidden" onChange={(e) => handleNewModuleFile(e.target.files?.[0])} />
                </label>
                <button type="button" onClick={addModule} disabled={!newModule.name.trim()} className="shrink-0 flex items-center gap-1 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-sm font-semibold px-3 py-2 rounded-lg">
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
              {moduleFileError && <p className="text-[10.5px] text-rose-500">{moduleFileError}</p>}
            </div>

            {form.modules.length > 0 ? (
              <div className="space-y-1.5">
                {form.modules.map((m) => (
                  <div key={m.id} className={`rounded-lg px-3 py-2.5 space-y-1.5 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold truncate">{m.name}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        {isAdmin && Number(m.price) > 0 && (
                          <span className="text-[11px] font-semibold text-violet-500">{fmtMoney(m.price)}</span>
                        )}
                        <button type="button" onClick={() => removeModule(m.id)} className="text-slate-400 hover:text-rose-500">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={m.status || "Pending"}
                        onChange={(e) => updateModuleField(m.id, "status", e.target.value)}
                        className={`text-[11px] font-semibold rounded-full px-2 py-1 border-0 outline-none ${MODULE_STATUS_STYLES[m.status] || MODULE_STATUS_STYLES.Pending}`}
                      >
                        {MODULE_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select
                        value={m.assignee || ""}
                        onChange={(e) => updateModuleField(m.id, "assignee", e.target.value)}
                        className={`text-[11px] rounded-lg px-1.5 py-1 outline-none ${inputCls}`}
                      >
                        <option value="">Unassigned</option>
                        {moduleAssigneeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <select
                        value={m.priority || "Medium"}
                        onChange={(e) => updateModuleField(m.id, "priority", e.target.value)}
                        className={`text-[11px] font-semibold rounded-full px-2 py-1 border-0 outline-none ${MODULE_PRIORITY_STYLES[m.priority] || MODULE_PRIORITY_STYLES.Medium}`}
                      >
                        {MODULE_PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <input
                        type="date"
                        value={m.dueDate || ""}
                        onChange={(e) => updateModuleField(m.id, "dueDate", clampDateInput(e.target.value))}
                        className={`text-[11px] rounded-lg px-1.5 py-1 outline-none ${inputCls}`}
                      />
                    </div>
                    <input
                      type="url"
                      value={m.url || ""}
                      onChange={(e) => updateModuleField(m.id, "url", e.target.value)}
                      placeholder="Reference URL for this module"
                      className={`w-full text-[11px] border rounded-lg px-2 py-1.5 outline-none ${inputCls}`}
                    />
                    <div className="space-y-1">
                      {(m.files || []).map((f) => (
                        <div key={f.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 ${darkMode ? "bg-slate-900" : "bg-white"}`}>
                          <FileText className="w-3 h-3 text-violet-500 shrink-0" />
                          <span className="flex-1 min-w-0 truncate text-[10.5px]">{f.fileName}</span>
                          {(isAdmin || f.uploadedBy === currentUser || project.manager === currentUser) && (
                            <button type="button" onClick={() => downloadStoredFile(f)} className="text-slate-400 hover:text-violet-600" aria-label="Download file">
                              <Download className="w-3 h-3" />
                            </button>
                          )}
                          <button type="button" onClick={() => removeModuleFile(m.id, f.id)} className="text-slate-400 hover:text-rose-500" aria-label="Remove file">
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                      <label className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-violet-600 hover:text-violet-700 cursor-pointer">
                        <Paperclip className="w-3 h-3" /> {(m.files || []).length ? "Add another file" : "Attach a file"}
                        <input
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleModuleFileFor(m.id, file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">No modules yet — add one above.</p>
            )}

            {isAdmin && moduleTotal > 0 && (
              <p className="text-[11px] mt-2 text-slate-400">
                Modules total <span className="font-semibold text-violet-600">{fmtMoney(moduleTotal)}</span> + budget = final budget{" "}
                <span className="font-semibold text-violet-600">{fmtMoney(finalBudget)}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${inputCls}`}>Cancel</button>
          <button
            disabled={!canSubmit}
            onClick={() => onSubmit({ ...form, initialCommissions })}
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}