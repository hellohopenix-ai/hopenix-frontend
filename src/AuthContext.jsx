import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { ensurePushSubscribed, clearPushSubscription } from "./pushSubscription";
import { configureReportsApi } from "./pages/reportsApi.js";
import { API_ROOT } from "./apiConfig.js";
import { hydrateFlags, flushFlags, clearLocalFlags } from "./userFlags.js";
import { useLiveRefresh } from "./useLiveRefresh.js";

export const AuthContext = createContext(null);

// reportsApi.js can't see how this app stores its token, so by default it
// falls back to scanning localStorage for anything shaped like a DRF token —
// which can grab a stale token left over from a *different* account's
// earlier session on this browser (e.g. a client's), causing every Reports
// call to silently authenticate as the wrong user (403s / empty data) even
// while the current user is correctly logged in as admin. Wiring it
// explicitly to the exact key this file uses removes that ambiguity.
configureReportsApi({ getToken: () => localStorage.getItem("hopenix_auth_token") });

// Django backend base URL comes from src/apiConfig.js (VITE_API_BASE_URL).
const API_BASE_URL = `${API_ROOT}/api/auth`;
// Settings app (Company info, Notifications, Security/2FA, Billing, and
// password changes) — a separate Django app (`settings/`), so it gets its
// own base URL under /api/settings/.
const SETTINGS_API_BASE_URL = `${API_ROOT}/api/settings`;

/** Fetch wrapper that automatically attaches the saved auth Token header
 *  (DRF's TokenAuthentication expects "Authorization: Token <key>", NOT
 *  "Bearer <key>" — that's a JWT convention, this app uses plain tokens).
 *  `base` defaults to the auth API but can be pointed at another app's
 *  base URL (e.g. SETTINGS_API_BASE_URL) — same token, same error
 *  handling, just a different route prefix. */
async function apiFetch(path, options = {}, base = API_BASE_URL) {
  const token = localStorage.getItem("hopenix_auth_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers["Authorization"] = `Token ${token}`;

  const res = await fetch(`${base}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses (e.g. 204 No Content on logout) have no body
  }
  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || Object.values(data)[0])) ||
      "Something went wrong. Please try again.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

/* ===========================================================================
   AuthContext - tracks role ("admin" | "manager" | "employee"), department,
   and approval status ("pending" | "approved" | "rejected" | "deactivated")
   per user, not just an email.

   IMPORTANT: this still has no real backend. It uses localStorage as a
   stand-in "database" so approvals / signups survive a page refresh instead
   of resetting every time (which was the old behaviour). Passwords are
   stored in plain text here purely for demo purposes - this MUST be
   replaced by a real backend (hashed passwords, server-side session/token)
   before this app is used with real user data.
   =========================================================================== */

const USERS_KEY = "hopenix_users";
const SESSION_KEY = "hopenix_session_email";
const TOKEN_KEY = "hopenix_auth_token";
const PERMISSIONS_KEY = "hopenix_role_permissions_v1";
const MODULE_PERMISSIONS_KEY = "hopenix_module_permissions_v1";
const AI_ASSISTANT_KEY = "hopenix_ai_assistant_enabled_v1";
const USER_ACCESS_KEY = "hopenix_user_access_overrides_v1";
const SUB_PAGE_ACCESS_KEY = "hopenix_sub_page_access_overrides_v1";
// Legacy key from the first version of this feature, back when it only
// existed for the Settings page. Still read once on load (see
// loadSubPageAccessOverrides below) and folded into the new, generalized
// shape, so nobody who already had "Full Settings Access" granted loses
// it just because this shipped for more pages.
const LEGACY_SETTINGS_ACCESS_KEY = "hopenix_settings_access_overrides_v1";

/* ===========================================================================
   PAGE PERMISSIONS
   ---------------------------------------------------------------------------
   These labels MUST match the `label` values in Dashboard.jsx's NAV_ITEMS
   exactly, since Dashboard filters its sidebar against this list.

   This is the single source of truth for "who can see what". An admin can
   change these at runtime (e.g. from a future Roles UI in UserPage) via
   `updateRolePermissions`, and the result is persisted so it survives a
   refresh, same as the rest of AuthContext's data.
   =========================================================================== */
export const ALL_PAGES = [
  "Dashboard",
  "Projects",
  "Zip Files",
  "Tasks",
  "Meetings",
  "Visitors",
  "Clients",
  "Client Portal",
  "Employees",
  "Users",
  "Income",
  "Expenses",
  "Sales",
  "Reports",
  "Coworking Space",
  "Messages",
  "Settings",
];

// Sensible defaults per role. "admin" always implicitly gets everything
// (handled in code below) so it isn't listed as a maintained array here.
// NOTE: "Zip Files" is deliberately left out of every one of these —
// ZipFilesPage.jsx already restricts itself to admins only (plus its own
// separate password gate), so non-admin roles never get it added to their
// sidebar by default either. An admin can still grant it to a specific
// role later from the Roles UI, since ALL_PAGES includes it.
const DEFAULT_ROLE_PERMISSIONS = {
  manager: ["Dashboard", "Projects", "Tasks", "Clients", "Client Portal", "Employees", "Income", "Expenses", "Sales", "Reports", "Coworking Space", "Visitors", "Messages", "Settings"],
  employee: ["Dashboard", "Tasks", "Projects", "Messages", "Settings"],
  client: ["Dashboard", "Projects", "Messages", "Settings"],
  accountant: ["Dashboard", "Income", "Expenses", "Sales", "Reports", "Coworking Space", "Messages", "Settings"],
};

/* ---------------------------------------------------------------------------
   ROLE CATEGORIES
   ---------------------------------------------------------------------------
   UserPage lets an admin assign a specific job title as `role` (e.g.
   "UI/UX Designer", "Backend Developer", "HR Executive") — not just the
   generic "employee"/"manager"/"client"/"accountant" buckets that
   DEFAULT_ROLE_PERMISSIONS is keyed by. Without this mapping, a freshly
   approved "UI/UX Designer" would look up rolePermissions["UI/UX Designer"],
   find nothing, and get an EMPTY page list — an empty sidebar and no
   access to anything, even though they were just approved. This maps any
   specific job title down to the permission bucket it should behave like.
   Anything not explicitly listed here defaults to "employee" (the safest,
   most limited real-work bucket) instead of getting locked out entirely.
   Comparison is case-insensitive since roles are sometimes stored
   Capitalized ("Manager") and sometimes lowercase ("manager"). */
const ROLE_CATEGORY_MAP = {
  admin: "admin",
  "super admin": "admin",
  manager: "manager",
  "project manager": "manager",
  accountant: "accountant",
  client: "client",
  employee: "employee",
};

export function getRoleCategory(role) {
  if (!role) return "employee";
  const key = role.toLowerCase().trim();
  return ROLE_CATEGORY_MAP[key] || "employee";
}

function loadRolePermissions() {
  try {
    const raw = localStorage.getItem(PERMISSIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        // merge over defaults so newly-added roles/pages still show up
        // even if an older permissions object was already saved
        return { ...DEFAULT_ROLE_PERMISSIONS, ...parsed };
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_ROLE_PERMISSIONS;
}



/* ===========================================================================
   MODULE (ACTION-LEVEL) PERMISSIONS — view / create / edit / delete
   ---------------------------------------------------------------------------
   This is the REAL enforcement layer for "can this role only VIEW this
   module, or can it also CREATE/EDIT/DELETE in it". ALL_PAGES above only
   controls whether a role can see a page at all (sidebar + route access).
   This controls what a role is allowed to DO once inside that page.

   Shape: { [roleCategory]: { [moduleName]: { view, create, edit, delete } } }
   roleCategory is one of the same buckets ALL_PAGES/rolePermissions uses
   (manager | employee | client | accountant) via getRoleCategory(). "admin"
   is never stored here — it always gets full access on every module,
   enforced in code below, same pattern as getAllowedPages.

   Persisted to localStorage so an admin's changes here survive a refresh,
   and so any page in the app (EmployeesPage, TasksPage, etc.) can call
   `canCreate("Employees")` / `canEdit("Employees")` / `canDelete("Employees")`
   from useAuth() to actually hide/disable its create/edit/delete UI instead
   of just visually greying things out. =========================================================================== */
export const MODULE_ACTIONS = ["view", "create", "edit", "delete"];

const FULL_MODULE_ACCESS = { view: true, create: true, edit: true, delete: true };
const VIEW_ONLY_MODULE_ACCESS = { view: true, create: false, edit: false, delete: false };

function buildModuleDefaults(overrides) {
  // Every page in ALL_PAGES gets an entry (defaulting to view-only) so a
  // module never silently falls back to "no access" just because it's
  // missing from a hand-written table below.
  const base = {};
  ALL_PAGES.forEach((page) => {
    base[page] = { ...VIEW_ONLY_MODULE_ACCESS };
  });
  return { ...base, ...overrides };
}

const DEFAULT_MODULE_PERMISSIONS = {
  manager: buildModuleDefaults({
    Dashboard: { ...FULL_MODULE_ACCESS },
    Projects: { ...FULL_MODULE_ACCESS },
    Tasks: { ...FULL_MODULE_ACCESS },
    Clients: { ...FULL_MODULE_ACCESS },
    Employees: { view: true, create: true, edit: true, delete: false },
    Income: { ...FULL_MODULE_ACCESS },
    Expenses: { ...FULL_MODULE_ACCESS },
    Sales: { ...FULL_MODULE_ACCESS },
    Reports: { view: true, create: true, edit: false, delete: false },
    Messages: { view: true, create: true, edit: true, delete: false },
    Settings: { view: true, create: false, edit: true, delete: false },
  }),
  // Employee default: view-only almost everywhere except their own Tasks
  // and Messages, where they can create/edit but not delete. This is the
  // set an admin will most commonly narrow further (e.g. turn Employees'
  // "Tasks" create off too) from the Module Access Control table.
  employee: buildModuleDefaults({
    Tasks: { view: true, create: true, edit: true, delete: false },
    Messages: { view: true, create: true, edit: false, delete: false },
    Employees: { ...VIEW_ONLY_MODULE_ACCESS },
    Settings: { view: true, create: false, edit: true, delete: false },
  }),
  client: buildModuleDefaults({
    Projects: { ...VIEW_ONLY_MODULE_ACCESS },
    Messages: { view: true, create: true, edit: false, delete: false },
    Settings: { view: true, create: false, edit: true, delete: false },
  }),
  accountant: buildModuleDefaults({
    Income: { ...FULL_MODULE_ACCESS },
    Expenses: { ...FULL_MODULE_ACCESS },
    Sales: { view: true, create: true, edit: true, delete: false },
    Reports: { view: true, create: true, edit: false, delete: false },
    Messages: { view: true, create: true, edit: false, delete: false },
    Settings: { view: true, create: false, edit: true, delete: false },
  }),
};

function loadModulePermissions() {
  try {
    const raw = localStorage.getItem(MODULE_PERMISSIONS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        // Deep-merge over defaults, role by role and module by module, so:
        //  - a role/module added later (new app feature) still shows up
        //    with a sane default instead of silently having no access
        //  - a partially-saved flag set from an older version of this app
        //    doesn't end up missing keys (e.g. no "delete" key at all)
        const merged = {};
        for (const roleKey of Object.keys(DEFAULT_MODULE_PERMISSIONS)) {
          merged[roleKey] = {};
          for (const moduleName of ALL_PAGES) {
            merged[roleKey][moduleName] = {
              ...(DEFAULT_MODULE_PERMISSIONS[roleKey][moduleName] || VIEW_ONLY_MODULE_ACCESS),
              ...((parsed[roleKey] && parsed[roleKey][moduleName]) || {}),
            };
          }
        }
        return merged;
      }
    }
  } catch {
    // ignore corrupt storage
  }
  return DEFAULT_MODULE_PERMISSIONS;
}

/* ===========================================================================
   AI ASSISTANT VISIBILITY
   ---------------------------------------------------------------------------
   A single global admin switch (not per-role, unlike ALL_PAGES above) that
   controls whether the AI Assistant panel/button in Dashboard.jsx is shown
   to anyone other than admin. Admin can always see it, regardless of this
   flag — same guarantee getAllowedPages/getModulePermissions give admin
   elsewhere, so admin's own tools can never be switched off by mistake.
   Persisted to localStorage so the setting survives a refresh, same pattern
   as rolePermissions/modulePermissions above. =========================================================================== */
function loadAiAssistantEnabled() {
  try {
    const raw = localStorage.getItem(AI_ASSISTANT_KEY);
    if (raw !== null) return raw === "true";
  } catch {
    // ignore corrupt/unavailable storage
  }
  return true; // default: everyone who already has page access can see it
}

/* ===========================================================================
   PER-USER ACCESS OVERRIDES
   ---------------------------------------------------------------------------
   Sits ON TOP of the role-based ALL_PAGES/rolePermissions system above.
   Lets an admin bypass a specific person's role-based page list entirely:
   give them a hand-picked set of pages ("custom"), full admin-style
   access ("full"), or lock them out of every page ("none"). A user with
   no entry here simply falls back to their role's default access — this
   is purely additive and never required.

   Shape: { [userId]: { mode: "custom" | "full" | "none", pages: string[] } }
   Keyed by the same `id` field every user record already has. This is
   the REAL enforcement layer (not just a UI toggle) — getAllowedPages,
   getModulePermissions and canAccessPage below all resolve through it
   whenever a userId is supplied, so it takes effect immediately, app-wide,
   the next time that person's pages are computed (including on their next
   login). Persisted to localStorage like everything else in this file. */
function loadUserAccessOverrides() {
  try {
    const raw = localStorage.getItem(USER_ACCESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  return {};
}

/* ===========================================================================
   PER-USER "SUB-PAGE" ACCESS OVERRIDES
   ---------------------------------------------------------------------------
   Separate from (and independent of) the page-level overrides above.
   ALL_PAGES/userAccessOverrides only control whether someone can see a
   given page at all (e.g. whether "Settings" or "Reports" shows up in
   their sidebar). This controls something one level deeper: some pages
   have their own internal "admin view" vs "everyone else's view" —
   SettingsPage.jsx has extra tabs (Users & Roles, Departments, Billing,
   ...) normally admin-only, and ReportsPage.jsx has an admin-wide view
   (every employee's reports + approve/message) vs a "just my own log"
   view for everyone else. This lets an admin grant one specific
   non-admin person that FULL, admin-style view of one particular page
   ("full") without making them an admin or granting them Full Access
   everywhere, while everyone else stays on "default" (their normal
   trimmed-down view of that page).

   Shape: { [userId]: { [pageName]: "full" } }. A user with no entry for
   a given page simply gets "default" for it. `pageName` should be one of
   ALL_PAGES (e.g. "Settings", "Reports") so it's obvious which page an
   entry applies to; new pages can opt into this system later just by
   reading it with their own page name, no changes needed here.

   Persisted to localStorage like everything else in this file, and synced
   across tabs via the same `storage` event pattern as USER_ACCESS_KEY. */
function loadSubPageAccessOverrides() {
  let result = {};
  try {
    const raw = localStorage.getItem(SUB_PAGE_ACCESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed;
    }
  } catch {
    // ignore corrupt storage
  }
  // One-time migration from the old Settings-only key (see
  // LEGACY_SETTINGS_ACCESS_KEY above), folded in as this user's "Settings"
  // entry in the new shape — only if the new key hasn't already got its
  // own (possibly newer) Settings entry for that user.
  try {
    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_ACCESS_KEY);
    if (legacyRaw) {
      const legacy = JSON.parse(legacyRaw);
      if (legacy && typeof legacy === "object" && !Array.isArray(legacy)) {
        Object.keys(legacy).forEach((userId) => {
          if (legacy[userId] === "full" && result[userId]?.Settings !== "full") {
            result = { ...result, [userId]: { ...(result[userId] || {}), Settings: "full" } };
          }
        });
      }
    }
  } catch {
    // ignore corrupt legacy storage
  }
  return result;
}

// Seed account so there is always someone who can log in and approve
// everyone else. Change/remove this once a real backend exists.
const DEFAULT_ADMIN = {
  id: "admin-1",
  name: "Hamna Jameel",
  email: "hamnaarooj784@gmail.com",
  password: "C##Hh123",
  company: "Hopenix",
  role: "admin",
  department: "Management",
  status: "approved",
  createdAt: new Date().toISOString(),
};

function loadUsers() {
  let list = [];
  try {
    const raw = localStorage.getItem(USERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    }
  } catch {
    // ignore corrupt storage, fall through to reseed
  }

  // Always guarantee the admin account exists AND is approved/admin, no
  // matter what was already saved (e.g. a stale "pending" record from
  // before this email was made the fixed admin, or an old password). This
  // makes the admin login self-healing instead of needing localStorage to
  // be cleared by hand every time DEFAULT_ADMIN changes.
  //
  // FIX: previously this spread `...DEFAULT_ADMIN` LAST, which overwrote
  // every saved field (name, avatar, department, etc.) with the hardcoded
  // defaults on every single load/refresh - so any name/DP change the
  // admin made in Settings would silently revert on next reload. Now
  // DEFAULT_ADMIN is spread FIRST (as a base) and the saved user `u` is
  // spread on top of it, so saved data always wins. Only `role` and
  // `status` are force-set afterwards, since those are the only two
  // fields this self-healing logic actually needs to guarantee.
  const adminIndex = list.findIndex(
    (u) => u.email.toLowerCase() === DEFAULT_ADMIN.email.toLowerCase()
  );
  if (adminIndex === -1) {
    list = [...list, DEFAULT_ADMIN];
  } else {
    list = list.map((u, i) =>
      i === adminIndex
        ? {
            ...DEFAULT_ADMIN,
            ...u,
            id: u.id || DEFAULT_ADMIN.id,
            role: "admin",
            status: "approved",
          }
        : u
    );
  }

  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(list));
  } catch (err) {
    console.error("Could not save users to localStorage during initial load:", err);
  }
  return list;
}

export function AuthProvider({ children }) {
  // `users` now starts empty and is populated from the backend (only
  // admins can actually fetch the full list — see refreshUsers below).
  const [users, setUsers] = useState([]);
  // FIX (client add -> auto task assigned, but the assignment message
  // never reaches Messages, for a manager session — same reason a
  // manager's Add Client "assign manager/developer" dropdown was
  // silently empty): `approvedUsers` used to be derived purely from
  // `users` above, which only ever gets populated for an admin session
  // (refreshUsers() below is admin-gated, and GET /users/ 403s for
  // anyone else). So every non-admin session had an empty approvedUsers
  // list, and anything matching a name against it (ClientsPage's
  // assignableTeam, TasksPage's resolveRealAssignee/
  // notifyAssigneesOfTaskBatch) silently found nothing — no error, the
  // dropdown was just empty / the notification was just never sent.
  // This is a separate, lightweight (id/name/role only) list from the
  // new GET /approved-users/ endpoint, which ANY logged-in user can
  // call — see refreshApprovedUsers below.
  const [approvedUsersLite, setApprovedUsersLite] = useState([]);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [rolePermissions, setRolePermissions] = useState(() => loadRolePermissions());
  // Role Management card's directory of role labels (name/tag/access,
  // separate from rolePermissions above, which is page-level access per
  // role category). null while loading; falls back to these same six
  // defaults on fetch failure, matching what the backend migration seeds
  // a fresh install with, so the UI looks the same either way.
  const [roleCatalog, setRoleCatalog] = useState(null);
  const [modulePermissions, setModulePermissions] = useState(() => loadModulePermissions());
  const [userAccessOverrides, setUserAccessOverrides] = useState(() => loadUserAccessOverrides());
  const [subPageAccessOverrides, setSubPageAccessOverrides] = useState(() => loadSubPageAccessOverrides());
  const [aiAssistantEnabled, setAiAssistantEnabledState] = useState(() => loadAiAssistantEnabled());

  /** Admin-only: (re)load the full user list from the real backend.
   *  Called after login (if admin) and after approve/reject, so
   *  UserPage/PendingApprovalPage stay in sync with Postgres.
   *
   *  FIX (admin doesn't see a user's saved profile photo): the backend
   *  doesn't store avatar/phone yet (see the TODO near persistUsers), so
   *  every record it returns here is missing whatever a person saved
   *  through updateUserProfile — that only ever lands in
   *  PROFILE_OVERRIDES_KEY now (see the fix notes on updateUserProfile).
   *  Without merging that in here, admin's Users/Employees/Messages
   *  views would NEVER show an updated photo, even after a manual
   *  refresh. This only actually finds something when the update
   *  happened in the same browser (localStorage is per-origin, shared
   *  across tabs but not across devices) — see the cross-tab `storage`
   *  listener below for the live-update half of this fix. */
  /** GET /role-permissions/ -> merge over the hardcoded defaults, same
   *  merge behaviour loadRolePermissions() used to do from localStorage. */
  const refreshRolePermissions = useCallback(async () => {
    try {
      const data = await apiFetch("/role-permissions/");
      setRolePermissions((prev) => ({ ...DEFAULT_ROLE_PERMISSIONS, ...prev, ...data }));
    } catch (err) {
      console.error("Could not load role permissions from backend:", err.message);
    }
  }, []);

  /** GET /role-catalog/ -> the Role Management card's list. Used to be
   *  localStorage-only (userpage_roles_v1), so a role added by one admin
   *  on one browser was invisible to every other admin/browser and lost
   *  on clearing site data — this is the real, shared version. */
  const refreshRoleCatalog = useCallback(async () => {
    try {
      const data = await apiFetch("/role-catalog/");
      setRoleCatalog(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Could not load the role catalog from backend:", err.message);
    }
  }, []);

  /** One GET per role bucket (manager/employee/client/accountant) — the
   *  backend only exposes module permissions scoped to a single role at
   *  a time (GET /module-permissions/?role=X), so this fans out to all
   *  four and reassembles the same { [role]: { [module]: {...} } } shape
   *  the rest of this file already expects. */
  const refreshModulePermissions = useCallback(async () => {
    const roles = Object.keys(DEFAULT_MODULE_PERMISSIONS);
    try {
      const results = await Promise.all(
        roles.map((role) => apiFetch(`/module-permissions/?role=${encodeURIComponent(role)}`))
      );
      setModulePermissions((prev) => {
        const next = { ...prev };
        roles.forEach((role, i) => {
          const rowsForRole = {};
          (results[i] || []).forEach((row) => {
            rowsForRole[row.module] = { view: row.view, create: row.create, edit: row.edit, delete: row.delete };
          });
          next[role] = { ...buildModuleDefaults(DEFAULT_MODULE_PERMISSIONS[role]), ...(prev[role] || {}), ...rowsForRole };
        });
        return next;
      });
    } catch (err) {
      console.error("Could not load module permissions from backend:", err.message);
    }
  }, []);

  // Pages that have their own separate per-user "sub-access" toggle —
  // must match the pages UserPage's Manage Access modal actually offers
  // this switch for.
  const PAGES_WITH_SUB_ACCESS = ["Settings", "Reports", "Meetings"];

  /** No bulk endpoint exists for either override table (they're
   *  per-user, and per-user-per-page, by design) — so this fans out one
   *  GET per user (and per user per sub-access page) in parallel to
   *  rebuild both tables after the user list loads. Fine for normal team
   *  sizes; if this ever needs to scale to hundreds of users, add a bulk
   *  endpoint on the backend instead of fetching in a loop like this. */
  const refreshAccessOverrides = useCallback(async (userList) => {
    try {
      const overrideResults = await Promise.all(
        userList.map((u) => apiFetch(`/users/${u.id}/access-override/`).catch(() => null))
      );
      const nextOverrides = {};
      userList.forEach((u, i) => {
        if (overrideResults[i]) nextOverrides[u.id] = overrideResults[i];
      });
      setUserAccessOverrides(nextOverrides);

      const subResults = await Promise.all(
        userList.flatMap((u) =>
          PAGES_WITH_SUB_ACCESS.map((page) =>
            apiFetch(`/users/${u.id}/sub-access/${encodeURIComponent(page)}/`)
              .then((r) => ({ userId: u.id, page, mode: r.mode }))
              .catch(() => null)
          )
        )
      );
      const nextSub = {};
      subResults.forEach((r) => {
        if (r && r.mode === "full") {
          nextSub[r.userId] = { ...(nextSub[r.userId] || {}), [r.page]: "full" };
        }
      });
      setSubPageAccessOverrides(nextSub);
    } catch (err) {
      console.error("Could not load access overrides from backend:", err.message);
    }
  }, []);

  const refreshUsers = useCallback(async () => {
    try {
      const data = await apiFetch("/users/");
      const list = Array.isArray(data) ? data : [];
      setUsers(list);
      // Admin-only permission tables live on the backend now too — pull
      // them in right after the user list, same "only admins get here"
      // gate (a non-admin's /users/ call above already threw and skipped
      // this line).
      await Promise.all([
        refreshRolePermissions(),
        refreshModulePermissions(),
        refreshAccessOverrides(list),
        refreshRoleCatalog(),
      ]);
    } catch {
      // Non-admins get a 403 here, which is expected — just leave users empty.
    }
  }, [refreshRolePermissions, refreshModulePermissions, refreshAccessOverrides, refreshRoleCatalog]);

  // Any logged-in user (admin, manager, employee, ...) can call this —
  // see the approvedUsersLite comment above for why it exists separately
  // from admin-only refreshUsers/`users`.
  const refreshApprovedUsers = useCallback(async () => {
    try {
      const data = await apiFetch("/approved-users/");
      setApprovedUsersLite(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Could not load approved users from backend:", err.message);
    }
  }, []);

  /** FIX (access + salary set by admin never reached the user's own
   *  device): role-permissions / module-permissions / access-override /
   *  sub-access are admin-only endpoints and refreshUsers() (which loads
   *  them) only runs for admin sessions, so every other user only ever saw
   *  hard-coded defaults or stale localStorage. GET /my-access/ returns
   *  just THIS user's own resolved access, so it works on any browser or
   *  device. Never throws (a failure just keeps whatever is already
   *  loaded). Admins are skipped — they always have full access. */
  const applyMyAccess = useCallback(async (u) => {
    if (!u || u.id == null) return;
    const category = getRoleCategory(u.role);
    if (category === "admin") return;
    try {
      const acc = await apiFetch("/my-access/");
      if (!acc || typeof acc !== "object") return;
      const uid = u.id;
      const sameJson = (a, b) => {
        try {
          return JSON.stringify(a) === JSON.stringify(b);
        } catch {
          return false;
        }
      };

      if (Array.isArray(acc.rolePages)) {
        setRolePermissions((prev) =>
          sameJson(prev[category], acc.rolePages) ? prev : { ...prev, [category]: acc.rolePages }
        );
      }

      const moduleTable = {
        ...buildModuleDefaults(DEFAULT_MODULE_PERMISSIONS[category] || DEFAULT_MODULE_PERMISSIONS.employee),
        ...(acc.modules || {}),
      };
      setModulePermissions((prev) =>
        sameJson(prev[category], moduleTable) ? prev : { ...prev, [category]: moduleTable }
      );

      setUserAccessOverrides((prev) => {
        const next = { ...prev };
        if (acc.override && acc.override.mode) {
          if (sameJson(prev[uid], acc.override)) return prev;
          next[uid] = acc.override;
        } else {
          if (!(uid in prev)) return prev;
          delete next[uid];
        }
        return next;
      });

      setSubPageAccessOverrides((prev) => {
        const sub = acc.subAccess && Object.keys(acc.subAccess).length ? acc.subAccess : null;
        if (sub) {
          if (sameJson(prev[uid], sub)) return prev;
          return { ...prev, [uid]: sub };
        }
        if (!(uid in prev)) return prev;
        const next = { ...prev };
        delete next[uid];
        return next;
      });
    } catch (err) {
      console.error("Could not load your access from the backend:", err.message);
    }
  }, []);

  // Keep a non-admin's own access (and their own profile data, e.g. the
  // salary an admin sets) live: re-pull on an interval, when the tab
  // regains focus/visibility and when the network comes back — so a change
  // an admin makes on another device applies here without a re-login.
  useEffect(() => {
    if (!user?.id) return undefined;
    if (getRoleCategory(user.role) === "admin") return undefined;
    let cancelled = false;
    let inFlight = false;
    const uid = user.id;
    const sync = async () => {
      if (inFlight || cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        await applyMyAccess({ id: uid, role: user.role });
        const me = await apiFetch("/me/").catch(() => null);
        if (!cancelled && me && me.id === uid) {
          setUser((prev) => {
            if (!prev || prev.id !== uid) return prev;
            const changed = Object.keys(me).some((k) => JSON.stringify(me[k]) !== JSON.stringify(prev[k]));
            return changed ? { ...prev, ...me } : prev;
          });
        }
      } finally {
        inFlight = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const timer = setInterval(sync, 10000);
    window.addEventListener("focus", sync);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  // FIX (approval / new user / role change made on one device never showed
  // on another): `users` (admin) and `approvedUsersLite` (everyone, used
  // for the assignee dropdowns) were loaded once at login. Keep them live.
  // Admin: only the cheap /users/ list is polled every 30s (the heavy
  // per-user override fan-out in refreshUsers() is NOT repeated). The
  // same tab focus / visibility / online triggers apply.
  useLiveRefresh(
    async () => {
      if (!user?.id) return;
      if (getRoleCategory(user.role) === "admin") {
        const data = await apiFetch("/users/");
        if (Array.isArray(data)) {
          setUsers((prev) => (JSON.stringify(prev) === JSON.stringify(data) ? prev : data));
        }
      }
      const lite = await apiFetch("/approved-users/");
      if (Array.isArray(lite)) {
        setApprovedUsersLite((prev) => (JSON.stringify(prev) === JSON.stringify(lite) ? prev : lite));
      }
    },
    { interval: 30000, enabled: !!user?.id }
  );

  // Restore session on refresh using the saved token (real backend call,
  // not a localStorage lookup anymore).
  useEffect(() => {
    async function restoreSession() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        setAuthLoading(false);
        return;
      }
      try {
        const me = await apiFetch("/me/");
        await hydrateFlags({ kind: "staff", ownerId: me.id }); // saved per-user flags (never throws, times out fast)
        await applyMyAccess(me); // own access first, so the right pages are allowed on the very first render
        setUser(me);
        if (me.role === "admin") await refreshUsers();
        await refreshApprovedUsers();
      } catch {
        // Saved token is invalid/expired — clear it.
        localStorage.removeItem(TOKEN_KEY);
      } finally {
        setAuthLoading(false);
      }
    }
    restoreSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any authenticated user can GET this, so pull the real value in as
  // soon as someone is logged in (not just admins), instead of trusting
  // whatever localStorage happened to have from before.
  useEffect(() => {
    if (!user) return;
    apiFetch("/settings/ai-assistant/")
      .then((data) => setAiAssistantEnabledState(!!data.enabled))
      .catch((err) => console.error("Could not load AI Assistant setting from backend:", err.message));
  }, [user?.id]);

  // Cross-tab sync: each tab loads `users` into React state only ONCE on
  // mount, so if the admin (or anyone) updates their name/avatar in one
  // tab, other tabs open in the same browser never find out - their copy
  // of `users` (and the logged-in `user` object built from it) stays
  // stale in memory until that tab is manually refreshed. The browser's
  // `storage` event fixes this: it fires automatically in every OTHER
  // tab (never the tab that made the change) whenever localStorage is
  // written, so we use it here to pull the fresh data into this tab's
  // state without the user having to do anything.
  useEffect(() => {
    function handleStorageChange(e) {
      if (e.key === USERS_KEY && e.newValue) {
        try {
          const next = JSON.parse(e.newValue);
          if (Array.isArray(next)) {
            setUsers(next);
            // Keep the currently logged-in user (in THIS tab) in sync too,
            // e.g. so their own name/avatar in the header updates if it
            // was changed from another tab (rare, but consistent).
            setUser((prevUser) => {
              if (!prevUser) return prevUser;
              const updated = next.find((u) => u.id === prevUser.id);
              return updated || prevUser;
            });
          }
        } catch {
          // ignore corrupt/partial storage payloads
        }
      } else if (e.key === USER_ACCESS_KEY) {
        // A per-user access override was added/changed/cleared in another
        // tab — pick it up here too, so this tab's canAccessPage/
        // getAllowedPages resolve the same way without needing a refresh.
        try {
          const next = e.newValue ? JSON.parse(e.newValue) : {};
          if (next && typeof next === "object") setUserAccessOverrides(next);
        } catch {
          // ignore corrupt/partial storage payloads
        }
      } else if (e.key === SUB_PAGE_ACCESS_KEY) {
        // Same idea as USER_ACCESS_KEY above, but for the per-page
        // sub-access override (Settings tabs, Reports admin view, ...) —
        // keeps hasFullSubPageAccess() in sync across tabs too.
        try {
          const next = e.newValue ? JSON.parse(e.newValue) : {};
          if (next && typeof next === "object") setSubPageAccessOverrides(next);
        } catch {
          // ignore corrupt/partial storage payloads
        }
      }
    }
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  // Phase 2 migration DONE: inviteUser, updateUserRole, updateUserDepartment,
  // setUserStatus, removeUser, updateUserProfile (admin-editable fields),
  // rolePermissions, modulePermissions, userAccessOverrides,
  // subPageAccessOverrides and aiAssistantEnabled are all now real DRF
  // calls (see refreshUsers, refreshRolePermissions,
  // refreshModulePermissions, refreshAccessOverrides above, and each
  // function's own apiFetch call below). Only a user's OWN avatar/phone
  // self-edit still falls back to the local profile-override cache,
  // since the backend has no lightweight endpoint for that yet (only the
  // full multipart CompleteProfileView) — see updateUserProfile.
  function persistUsers(next) {
    setUsers(next);
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(next));
      return true; // caller now knows the save actually went through
    } catch (err) {
      // Without this, a failed save (most commonly: localStorage's
      // ~5-10MB quota exceeded by a large base64 avatar image) was
      // SILENT — the admin's own screen looked fine (React state was
      // already updated in memory) but nothing was actually written to
      // localStorage, so the change (e.g. a newly-uploaded DP) never
      // reached other logins/sessions on this browser. Now it's at
      // least visible in the console instead of failing invisibly, AND
      // callers (e.g. updateUserProfile) can react to the failure.
      console.error("Could not save users to localStorage (data may be too large, e.g. an oversized avatar image):", err);
      return false;
    }
  }

  /** Sign a brand-new user up on the real backend. Always starts as role
   *  "employee", status "pending" (enforced server-side too). */
  async function registerUser({ name, email, password, company, department }) {
    try {
      const data = await apiFetch("/register/", {
        method: "POST",
        body: JSON.stringify({ name, email, password, company, department }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      await hydrateFlags({ kind: "staff", ownerId: data.user?.id });
      setUser(data.user);
      ensurePushSubscribed(); // fire-and-forget — asks for notification permission so calls can still ring this device later
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: invite someone directly (no self-signup). Backend
   *  creates a "pending" account with a random temp password, emails it
   *  to them, and it shows up in the normal approval queue — same
   *  behaviour as before, now actually persisted in Postgres instead of
   *  only this browser's localStorage. */
  async function inviteUser({ name, email, role, department }) {
    try {
      const data = await apiFetch("/users/invite/", {
        method: "POST",
        body: JSON.stringify({ name, email, role, department }),
      });
      await refreshUsers();
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Log an existing user in against the real backend. Does NOT block
   *  pending/rejected users here - the calling page decides where to
   *  route them based on user.status, so "pending" users can still see
   *  a waiting screen instead of a raw error. */
  async function loginUser(email, password) {
    try {
      const data = await apiFetch("/login/", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      await hydrateFlags({ kind: "staff", ownerId: data.user?.id });
      await applyMyAccess(data.user);
      setUser(data.user);
      ensurePushSubscribed(); // fire-and-forget
      if (data.user.role === "admin") await refreshUsers();
      await refreshApprovedUsers();
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Real Google login (LOGIN page's button). `accessToken` comes from
   *  the frontend's useGoogleLogin() hook. Only logs an EXISTING account
   *  in - the backend returns an error if no account exists yet with
   *  that email, telling them to sign up instead. */
  async function loginWithGoogle(accessToken) {
    try {
      const data = await apiFetch("/google-login/", {
        method: "POST",
        body: JSON.stringify({ access_token: accessToken }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      await hydrateFlags({ kind: "staff", ownerId: data.user?.id });
      await applyMyAccess(data.user);
      setUser(data.user);
      ensurePushSubscribed(); // fire-and-forget
      if (data.user.role === "admin") await refreshUsers();
      await refreshApprovedUsers();
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Real Google signup (REGISTER page's button). Creates a new
   *  pending/employee account straight from the Google profile (no
   *  password - Google is their only login method). Always meant to be
   *  followed by navigating to /complete-profile, same as a normal
   *  email/password signup. */
  async function signupWithGoogle(accessToken) {
    try {
      const data = await apiFetch("/google-signup/", {
        method: "POST",
        body: JSON.stringify({ access_token: accessToken }),
      });
      localStorage.setItem(TOKEN_KEY, data.token);
      setUser(data.user);
      ensurePushSubscribed(); // fire-and-forget
      if (data.user.role === "admin") await refreshUsers();
      await refreshApprovedUsers();
      return { success: true, user: data.user };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function logout() {
    // Must run BEFORE /logout/ below: that call deletes the auth token on the
    // server, so unsubscribing afterwards always came back 401 and the
    // server-side push subscription row was never removed.
    await clearPushSubscription(); // this device stops receiving call pushes
    await flushFlags(); // send any pending flag change while the token is still valid
    try {
      await apiFetch("/logout/", { method: "POST" });
    } catch {
      // even if the network call fails, still clear the local session below
    }
    localStorage.removeItem(TOKEN_KEY);
    clearLocalFlags("staff"); // next person on this browser must not inherit these flags
    setUser(null);
    setUsers([]);
  }

  /** Admin action: approve a pending user on the real backend, assigning
   *  their role and (optionally) department. This is what actually lets a
   *  pending user log in — loginUser above never blocks on status, so
   *  it's approval that flips the gate. */
  async function approveUser(id, role, department) {
    try {
      await apiFetch(`/users/${id}/approve/`, {
        method: "POST",
        body: JSON.stringify({ role, department }),
      });
      await refreshUsers();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: reject a pending user on the real backend. Keeps the
   *  record (so a rejected applicant can be shown a clear "rejected"
   *  message) instead of silently deleting it — use removeUser for a
   *  hard delete. */
  async function rejectUser(id) {
    try {
      await apiFetch(`/users/${id}/reject/`, { method: "POST" });
      await refreshUsers();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: change an approved user's role (e.g. employee -> manager),
   *  and optionally their department at the same time. UserPage's "Update
   *  Role & Department" button calls this with both — previously this
   *  function only accepted `role` and silently dropped the 3rd argument,
   *  so department changes never actually persisted even though the UI
   *  looked like it worked. Doing both fields in ONE persistUsers call
   *  also avoids a stale-closure race that a separate updateUserDepartment
   *  call right after this one would hit (each reads `users` from the same
   *  render, so the second call would overwrite the first). */
  async function updateUserRole(id, role, department) {
    // Backend requires both fields together — fall back to the user's
    // current department if the caller only meant to change the role.
    const current = users.find((u) => u.id === id);
    const finalDepartment = department !== undefined ? department : current?.department;
    try {
      await apiFetch(`/users/${id}/update-role/`, {
        method: "POST",
        body: JSON.stringify({ role, department: finalDepartment }),
      });
      await refreshUsers();
      if (user?.id === id) setUser((prev) => (prev ? { ...prev, role, department: finalDepartment } : prev));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: change a user's department. Reuses the same backend
   *  endpoint as updateUserRole (it requires role + department together),
   *  sending the user's current role unchanged. */
  async function updateUserDepartment(id, department) {
    const current = users.find((u) => u.id === id);
    return updateUserRole(id, current?.role, department);
  }

  /** Admin action: set a user's status directly. Used to deactivate an
   *  approved account (blocks login-worthy access) and to reactivate it
   *  again later, without touching their role/department. */
  async function setUserStatus(id, status) {
    try {
      await apiFetch(`/users/${id}/status/`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await refreshUsers();
      if (user?.id === id) setUser((prev) => (prev ? { ...prev, status } : prev));
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Any logged-in user (or admin, on their behalf later) updates their
   *  own profile fields — currently avatar (data URL) and phone. Kept
   *  generic so more real profile fields can be added later without a
   *  new function per field.
   *
   *  FIX (updating your own profile logged you out): `users` only ever
   *  holds the FULL list when an ADMIN is logged in (see refreshUsers —
   *  it's only called for admin sessions). For a normal user, `users`
   *  stays `[]`, so `users.map(...)` here found nothing to update and
   *  `next.find((u) => u.id === id)` came back `undefined`. That
   *  `undefined` was then handed straight to `setUser()`, which wiped
   *  out the logged-in user in context — ProtectedRoute treats no user
   *  as "not logged in" and immediately bounced back to /login, even
   *  though the person never actually logged out. Now the currently
   *  logged-in user's own state is always updated directly by merging
   *  `updates` onto the existing `user` object, regardless of whether
   *  an admin's `users` list happens to be loaded in this tab; the
   *  `users` array (used elsewhere, e.g. an admin browsing Users/
   *  Employees pages) is only touched when that id actually exists in it.
   *
   *  FIX (saved profile photo disappeared after logging out): avatar/
   *  phone updates aren't wired to the real backend yet (see the TODO
   *  note near persistUsers above), and — per the fix above — they no
   *  longer get force-written into the (often empty, for a normal user)
   *  `users`/USERS_KEY cache either. That left the update living only in
   *  this tab's in-memory `user` state, so logging out (which clears
   *  `user`) and back in (which re-fetches a fresh `user` straight from
   *  the backend, with no idea about the photo) made it vanish. Now
   *  every update is also written to PROFILE_OVERRIDES_KEY, a small
   *  per-user-id cache that survives logout, and every place a session
   *  is (re)established (restoreSession / loginUser / loginWithGoogle /
   *  signupWithGoogle / registerUser) re-applies it via
   *  withProfileOverride() — so the saved photo/phone reliably comes
   *  back after logging back in. */
  const ADMIN_EDITABLE_PROFILE_FIELDS = ["salary", "bankName", "accountTitle", "accountNumber", "iban", "branchCode"];
  const FIELD_NAME_TO_BACKEND = {
    bankName: "bank_name",
    accountTitle: "account_title",
    accountNumber: "account_number",
    branchCode: "branch_code",
  };

  /** Two cases in one function, same as before:
   *  1) Admin editing ANOTHER user's salary/bank details (e.g.
   *     handleModalSalaryUpdate) — PATCH to AdminUpdateProfileView.
   *  2) A user editing their OWN avatar/phone — now a real PATCH to
   *     /me/update/ (a lightweight, JSON/base64 counterpart to the full
   *     multipart CompleteProfileView, built specifically for this).
   *     Falls back to the local "profile override" cache only if that
   *     call fails (e.g. offline), so the change still isn't silently
   *     lost — it'll just need a retry once the backend save works. */
  async function updateUserProfile(id, updates) {
    const backendFields = {};
    Object.keys(updates).forEach((key) => {
      if (ADMIN_EDITABLE_PROFILE_FIELDS.includes(key)) {
        backendFields[FIELD_NAME_TO_BACKEND[key] || key] = updates[key];
      }
    });

    if (Object.keys(backendFields).length > 0) {
      try {
        await apiFetch(`/users/${id}/profile/`, {
          method: "PATCH",
          body: JSON.stringify(backendFields),
        });
        await refreshUsers();
        if (user?.id === id) setUser((prev) => (prev ? { ...prev, ...updates } : prev));
        return true;
      } catch (err) {
        console.error("Could not save profile fields to the backend:", err.message);
        return false;
      }
    }

    // Self-editing own name/avatar/phone. `name` was previously missing
    // here entirely — it matched neither ADMIN_EDITABLE_PROFILE_FIELDS nor
    // this block, so it fell all the way through to the local-only
    // setUser() at the bottom: the change looked like it worked in your
    // own tab, but was never sent to the backend, so nobody else (and not
    // even you, after logging back in) ever actually saw it.
    const selfFields = {};
    if ("name" in updates) selfFields.name = updates.name;
    if ("avatar" in updates) selfFields.avatar = updates.avatar;
    if ("phone" in updates) selfFields.phone = updates.phone;

    if (user?.id === id && Object.keys(selfFields).length > 0) {
      try {
        const updatedUser = await apiFetch("/me/update/", {
          method: "PATCH",
          body: JSON.stringify(selfFields),
        });
        setUser(updatedUser);
        // BUG FIX: `setUser` above only updates this tab's own logged-in
        // user object (Settings, header, etc). The separate `users` array
        // — the one UserPage's admin table actually reads (as
        // `authUsers`) — was never touched here, so a freshly-saved
        // avatar/name/phone kept showing the old value on the Users &
        // Roles page until a full refreshUsers()/relogin happened. Mirror
        // the same fields into `users` so any row for this id (e.g. an
        // admin browsing the list, or this same account appearing in its
        // own session) updates immediately too.
        setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...updatedUser } : u)));
        return true;
      } catch (err) {
        console.error("Could not save avatar/phone to backend:", err.message);
        return false;
      }
    }

    if (user?.id === id) {
      setUser((prev) => (prev ? { ...prev, ...updates } : prev));
    }
    return true;
  }

  /** Change the CURRENTLY LOGGED-IN user's own password — SettingsPage.jsx's
   *  Security tab. Real verification happens server-side: POST
   *  /change-password/ checks currentPassword against the account's real
   *  hashed password (request.user.check_password(...)) and only then
   *  hashes + saves newPassword. Nothing password-related is ever kept in
   *  this context's `user` state (the backend never sends a password
   *  field back), which is why this couldn't just be a case inside
   *  updateUserProfile above.
   *
   *  On success the backend deletes the old auth token and issues a new
   *  one (a password change should invalidate any token issued under the
   *  old password), so we must store that new token under TOKEN_KEY right
   *  away — otherwise the very next apiFetch call would 401 and look like
   *  the user got logged out. */
  async function changePassword(currentPassword, newPassword) {
    try {
      const data = await apiFetch(
        "/change-password/",
        { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) },
        SETTINGS_API_BASE_URL
      );
      if (data?.token) {
        localStorage.setItem(TOKEN_KEY, data.token);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ------------------------------------------------------------------
     Settings page — Company / Notifications / Security(2FA) / Billing.
     All four map 1:1 onto the new `settings` Django app. Each is
     GET-to-load, PUT-to-save, same shape SettingsPage.jsx already keeps
     in local state — so a save button just calls the matching update*
     function with its current form state and doesn't need to change
     the shape of anything it's already rendering. */

  /* ------------------------------------------------------------------
     Settings page — Company / Notifications / Security(2FA) / Billing.
     All four map onto the new `settings` Django app. SettingsPage.jsx
     keeps its own state in camelCase (company.dateFormat, .zip, etc —
     see DEFAULT_COMPANY/DEFAULT_BILLING there); the backend uses
     snake_case field names (date_format, zip_code, etc). The two little
     mappers below translate both ways so SettingsPage.jsx never has to
     know or care — it keeps reading/writing the exact shape it already
     uses today. */

  function companyFromBackend(data) {
    if (!data) return null;
    return {
      name: data.name,
      email: data.email,
      phone: data.phone,
      website: data.website,
      timezone: data.timezone,
      currency: data.currency,
      dateFormat: data.date_format,
      timeFormat: data.time_format,
      defaultDashboard: data.default_dashboard,
      language: data.language,
      compactMode: data.compact_mode,
      emailNotifications: data.email_notifications,
      autoCurrencyUpdate: data.auto_currency_update,
      street: data.street,
      city: data.city,
      state: data.state,
      zip: data.zip_code,
      country: data.country,
    };
  }

  function companyToBackend(company) {
    return {
      name: company.name,
      email: company.email,
      phone: company.phone,
      website: company.website,
      timezone: company.timezone,
      currency: company.currency,
      date_format: company.dateFormat,
      time_format: company.timeFormat,
      default_dashboard: company.defaultDashboard,
      language: company.language,
      compact_mode: company.compactMode,
      email_notifications: company.emailNotifications,
      auto_currency_update: company.autoCurrencyUpdate,
      street: company.street,
      city: company.city,
      state: company.state,
      zip_code: company.zip,
      country: company.country,
    };
  }

  async function getCompanySettings() {
    try {
      const data = await apiFetch("/company/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: companyFromBackend(data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateCompanySettings(company) {
    try {
      const data = await apiFetch(
        "/company/",
        { method: "PUT", body: JSON.stringify(companyToBackend(company)) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data: companyFromBackend(data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function getNotificationPreferences() {
    try {
      const data = await apiFetch("/notifications/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** `notifications` is the same array shape the Notifications tab
   *  already keeps in state: [{ id, label, email, push, sms }, ...] */
  async function updateNotificationPreferences(notifications) {
    try {
      const data = await apiFetch(
        "/notifications/",
        { method: "PUT", body: JSON.stringify(notifications) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ---- Notifications: live status + real test ------------------------- */
  async function getNotificationStatus() {
    try {
      const data = await apiFetch("/notifications/status/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Sends a real notification to the logged-in user (in-app + browser push)
   *  and reports what actually happened. */
  async function sendTestNotification() {
    try {
      const data = await apiFetch("/notifications/test/", { method: "POST" }, SETTINGS_API_BASE_URL);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ---- Departments: the real ones (built from the people in the system) - */
  function departmentFromBackend(d) {
    return {
      id: d.id,
      name: d.name,
      head: d.head || "",
      headId: d.head_id ?? null,
      members: d.members ?? 0,
      totalUsers: d.total_users ?? 0,
      budget: Number(d.budget) || 0,
    };
  }

  async function getDepartments() {
    try {
      const data = await apiFetch("/departments/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: (Array.isArray(data) ? data : []).map(departmentFromBackend) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function createDepartment({ name, headId, budget }) {
    try {
      const data = await apiFetch(
        "/departments/",
        { method: "POST", body: JSON.stringify({ name, head_id: headId || null, budget: budget || 0 }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data: departmentFromBackend(data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateDepartment(id, { name, headId, budget }) {
    try {
      const data = await apiFetch(
        `/departments/${id}/`,
        { method: "PATCH", body: JSON.stringify({ name, head_id: headId || null, budget: budget || 0 }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data: departmentFromBackend(data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function deleteDepartment(id) {
    try {
      await apiFetch(`/departments/${id}/`, { method: "DELETE" }, SETTINGS_API_BASE_URL);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ---- Storage: what is really stored (admin only) ---------------------- */
  async function getStorageUsage(refresh = false) {
    try {
      const data = await apiFetch(`/storage/${refresh ? "?refresh=1" : ""}`, {}, SETTINGS_API_BASE_URL);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function getSecuritySettings() {
    try {
      const data = await apiFetch("/security/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateSecuritySettings(changes) {
    try {
      const data = await apiFetch(
        "/security/",
        { method: "PUT", body: JSON.stringify(changes) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Backend BillingInfo only tracks plan/card display fields — it has
   *  no invoice-history model (that would be its own thing, tied to a
   *  real payment processor). SettingsPage.jsx's `billing.history` stays
   *  local/demo data; only `plan`, `cardLast4`, `cardBrand` round-trip
   *  to the backend. */
  function billingFromBackend(data) {
    if (!data) return null;
    return {
      plan: data.plan_name || "",
      price: Number(data.price) || 0,
      cardLast4: data.card_last4 || "",
      cardBrand: data.card_brand || "",
      cardExpiry: data.card_expiry || "",
      nextBillingDate: data.next_billing_date || "",
      storageLimitGb: Number(data.storage_limit_gb) || 0,
      features: Array.isArray(data.features) ? data.features : [],
      plans: Array.isArray(data.plans) ? data.plans : [],
      history: Array.isArray(data.history) ? data.history : [],
    };
  }

  // Only what the admin can actually change goes up. Price / storage limit /
  // renewal date / history are decided by the server. Only the masked card
  // (last 4 + brand + expiry) is ever sent - never a full number or CVV.
  function billingToBackend(changes) {
    const body = {};
    if (changes.plan) body.plan_name = changes.plan;
    if (changes.cardLast4) {
      body.card_last4 = changes.cardLast4;
      body.card_brand = changes.cardBrand || "Card";
      if (changes.cardExpiry) body.card_expiry = changes.cardExpiry;
    }
    return body;
  }

  async function getBillingInfo() {
    try {
      const data = await apiFetch("/billing/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: billingFromBackend(data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateBillingInfo(changes) {
    try {
      const data = await apiFetch(
        "/billing/",
        { method: "PUT", body: JSON.stringify(billingToBackend(changes)) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data: billingFromBackend(data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /* ------------------------------------------------------------------
     Settings page — Projects / Tasks / Income / Expenses / Sales.
     All five are simple singletons on the backend (same GET-all,
     PUT-admin-only pattern as company/billing above) — field names
     already match SettingsPage.jsx's snake_case-free camelCase EXCEPT
     the JSON list field name (categories/statuses) and a couple of
     scalar names, so each pair below does a tiny key rename instead of
     a full remap function like company/billing needed. */

  async function getProjectSettings() {
    try {
      const data = await apiFetch("/projects/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: { ...data, defaultView: data.default_view, autoArchive: data.auto_archive, requireCode: data.require_code, allowGuestAccess: data.allow_guest_access, timeTracking: data.time_tracking } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateProjectSettings(s) {
    try {
      const data = await apiFetch(
        "/projects/",
        { method: "PUT", body: JSON.stringify({
          default_view: s.defaultView, auto_archive: s.autoArchive, require_code: s.requireCode,
          allow_guest_access: s.allowGuestAccess, time_tracking: s.timeTracking, categories: s.categories,
        }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function getTaskSettings() {
    try {
      const data = await apiFetch("/tasks/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: { ...data, defaultView: data.default_view, autoAssignLead: data.auto_assign_lead, allowSubtasks: data.allow_subtasks, requireDueDate: data.require_due_date, sendReminders: data.send_reminders } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateTaskSettings(s) {
    try {
      const data = await apiFetch(
        "/tasks/",
        { method: "PUT", body: JSON.stringify({
          default_view: s.defaultView, auto_assign_lead: s.autoAssignLead, allow_subtasks: s.allowSubtasks,
          require_due_date: s.requireDueDate, send_reminders: s.sendReminders, statuses: s.statuses,
        }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function getIncomeSettings() {
    try {
      const data = await apiFetch("/income/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: { ...data, defaultAccount: data.default_account, recurringIncome: data.recurring_income, autoInvoice: data.auto_invoice } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateIncomeSettings(s) {
    try {
      const data = await apiFetch(
        "/income/",
        { method: "PUT", body: JSON.stringify({
          default_account: s.defaultAccount, recurring_income: s.recurringIncome, auto_invoice: s.autoInvoice, categories: s.categories,
        }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function getExpenseSettings() {
    try {
      const data = await apiFetch("/expenses/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: { ...data, approvalThreshold: Number(data.approval_threshold), requireReceipt: data.require_receipt, autoCategorize: data.auto_categorize } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateExpenseSettings(s) {
    try {
      const data = await apiFetch(
        "/expenses/",
        { method: "PUT", body: JSON.stringify({
          approval_threshold: s.approvalThreshold, require_receipt: s.requireReceipt, auto_categorize: s.autoCategorize, categories: s.categories,
        }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function getSalesSettings() {
    try {
      const data = await apiFetch("/sales/", {}, SETTINGS_API_BASE_URL);
      return { success: true, data: { ...data, taxRate: Number(data.tax_rate), invoicePrefix: data.invoice_prefix, paymentTerms: data.payment_terms, discount: Number(data.discount), autoInvoiceNumber: data.auto_invoice_number, paymentReminders: data.payment_reminders } };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async function updateSalesSettings(s) {
    try {
      const data = await apiFetch(
        "/sales/",
        { method: "PUT", body: JSON.stringify({
          tax_rate: s.taxRate, invoice_prefix: s.invoicePrefix, payment_terms: s.paymentTerms,
          discount: s.discount, auto_invoice_number: s.autoInvoiceNumber, payment_reminders: s.paymentReminders,
        }) },
        SETTINGS_API_BASE_URL
      );
      return { success: true, data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: permanently remove a user record from the backend. */
  async function removeUser(id) {
    try {
      await apiFetch(`/users/${id}/remove/`, { method: "DELETE" });
      await refreshUsers();
      if (user?.id === id) await logout();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: set (or clear, passing null) which manager a user
   *  reports to. Drives the Messages page's contact-visibility rule on
   *  the backend. Not previously exposed from AuthContext — added here
   *  since the endpoint already exists (POST .../assign-manager/). */
  async function assignManager(id, managerId) {
    try {
      await apiFetch(`/users/${id}/assign-manager/`, {
        method: "POST",
        body: JSON.stringify({ manager_id: managerId }),
      });
      await refreshUsers();
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: change which pages a role can see. `pages` is the full
   *  replacement list of allowed page labels for that role (must match
   *  Dashboard's NAV_ITEMS labels). "admin" is intentionally never editable
   *  here — it always has full access, enforced in getAllowedPages below. */
  function updateRolePermissions(role, pages) {
    // Optimistic: update the UI immediately, then sync to Postgres. If
    // the backend call fails, roll back so the UI never claims a change
    // was saved when it wasn't.
    setRolePermissions((prev) => ({ ...prev, [role]: pages }));
    apiFetch("/role-permissions/", {
      method: "PUT",
      body: JSON.stringify({ role, pages }),
    }).catch((err) => {
      console.error("Could not save role permissions to backend:", err.message);
      refreshRolePermissions(); // pull back the real, last-saved state
    });
  }

  /** Admin action: add one role to the org's Role Management directory.
   *  Not optimistic (unlike updateRolePermissions above) because the
   *  backend assigns the id the delete button needs, and duplicate-name
   *  rejection needs a real answer before the UI can call it "created". */
  async function createRoleCatalogEntry(name, tag, access) {
    try {
      const entry = await apiFetch("/role-catalog/", {
        method: "POST",
        body: JSON.stringify({ name, tag, access }),
      });
      setRoleCatalog((prev) => [...(prev || []), entry]);
      return { success: true, entry };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /** Admin action: remove one role from the directory. Optimistic, rolls
   *  back on failure (e.g. someone else already deleted it, or it's
   *  locked) the same way updateRolePermissions does. */
  async function deleteRoleCatalogEntry(id) {
    const prevCatalog = roleCatalog;
    setRoleCatalog((prev) => (prev || []).filter((r) => r.id !== id));
    try {
      await apiFetch(`/role-catalog/${id}/`, { method: "DELETE" });
      return { success: true };
    } catch (err) {
      setRoleCatalog(prevCatalog); // roll back
      return { success: false, error: err.message };
    }
  }

  /** Admin action: change a single view/create/edit/delete flag for one
   *  module, for one role. This is the write side of the real module
   *  permission engine — called from UserPage's "Module Access Control"
   *  table. "admin" is intentionally never editable here — it always has
   *  full access on every module, enforced in getModulePermissions below. */
  function updateModulePermission(role, moduleName, action, value) {
    const category = getRoleCategory(role);
    if (category === "admin") return; // admin's access can never be narrowed
    setModulePermissions((prev) => {
      const prevModule = (prev[category] && prev[category][moduleName]) || VIEW_ONLY_MODULE_ACCESS;
      let nextModule = { ...prevModule, [action]: value };
      // "view" is a prerequisite for doing anything else in a module: if
      // view is turned off, create/edit/delete are forced off too (a role
      // that can't see a module's data can't meaningfully create/edit/
      // delete it). If any of create/edit/delete is turned ON, view is
      // forced back on for the same reason, in the other direction.
      if (action === "view" && value === false) {
        nextModule = { view: false, create: false, edit: false, delete: false };
      } else if (action !== "view" && value === true) {
        nextModule.view = true;
      }
      const nextRole = { ...(prev[category] || {}), [moduleName]: nextModule };
      const next = { ...prev, [category]: nextRole };

      // Backend only stores one flag per call — send exactly the flag the
      // caller changed. If "view" got force-cascaded off/on above, the
      // other flags implied by that cascade get their own calls below too,
      // so the saved row on the server matches what's now shown on screen.
      const flagsChanged = action === "view" && value === false
        ? ["view", "create", "edit", "delete"]
        : action !== "view" && value === true
        ? [action, "view"]
        : [action];
      flagsChanged.forEach((flag) => {
        apiFetch("/module-permissions/", {
          method: "PUT",
          body: JSON.stringify({ role: category, module: moduleName, flag, value: nextModule[flag] }),
        }).catch((err) => console.error("Could not save module permission to backend:", err.message));
      });

      return next;
    });
  }

  /** Returns { view, create, edit, delete } for a given role + module.
   *  "admin" (and the built-in Super Admin) always gets full access on
   *  every module, regardless of what's stored — same guarantee as
   *  getAllowedPages, so the app can never lock the admin seat out of its
   *  own data. Any specific job title is normalized to its permission
   *  category first, same as getAllowedPages.
   *
   *  `userId` is optional and only matters when checking a SPECIFIC
   *  person's real access (e.g. canPerform below, for the logged-in
   *  user): if that user has an individual override (see
   *  updateUserAccessOverride), it takes priority over the role table —
   *  "full" grants every action, "none" blocks every action, and
   *  "custom" blocks every action on any page not in their custom page
   *  list (a page they can't see can't be acted on either). Callers that
   *  just want to preview/edit a ROLE's own defaults (e.g. UserPage's
   *  Module Access Control table, which edits `moduleAccessRole`, not a
   *  specific person) should omit `userId` so they see the plain role
   *  table, unaffected by any individual's override. */
  function getModulePermissions(role, moduleName, userId) {
    const category = getRoleCategory(role);
    if (category === "admin") return { ...FULL_MODULE_ACCESS };
    if (userId != null) {
      const override = userAccessOverrides[userId];
      if (override) {
        if (override.mode === "full") return { ...FULL_MODULE_ACCESS };
        if (override.mode === "none") return { view: false, create: false, edit: false, delete: false };
        if (override.mode === "custom" && !(override.pages || []).includes(moduleName)) {
          return { view: false, create: false, edit: false, delete: false };
        }
      }
    }
    return (
      (modulePermissions[category] && modulePermissions[category][moduleName]) ||
      { ...VIEW_ONLY_MODULE_ACCESS }
    );
  }

  /** Admin action: turn the AI Assistant on/off for everyone except admin.
   *  Admin's own AI Assistant is never affected — enforced in
   *  canUseAiAssistant below, the same "admin can't be locked out" pattern
   *  as updateRolePermissions/updateModulePermission use for pages/modules. */
  function setAiAssistantEnabled(value) {
    setAiAssistantEnabledState(value); // optimistic
    apiFetch("/settings/ai-assistant/", {
      method: "PUT",
      body: JSON.stringify({ enabled: value }),
    }).catch((err) => {
      console.error("Could not save AI Assistant setting to backend:", err.message);
      setAiAssistantEnabledState((v) => !v); // roll back on failure
    });
  }

  /** Returns whether a given role should see the AI Assistant. Admin (and
   *  the built-in Super Admin) always can, regardless of the global switch —
   *  same guarantee getAllowedPages/getModulePermissions give admin, so the
   *  admin seat can never be switched off by its own setting. */
  function canUseAiAssistant(role) {
    const category = getRoleCategory(role);
    if (category === "admin") return true;
    return aiAssistantEnabled;
  }

  /** Core real-enforcement check used by every page in the app:
   *  canPerform("create", "Employees") etc. Always resolves against the
   *  CURRENTLY LOGGED-IN user's role — there is no logged-in user, no
   *  access, full stop. This is what a create/edit/delete button's
   *  `disabled` (or a conditional render) should be wired to so an
   *  employee an admin didn't grant "create"/"edit" to physically cannot
   *  trigger those actions from the UI, not just have them hidden/greyed
   *  out by convention. */
  function canPerform(action, moduleName) {
    if (!user) return false;
    // A page a role can't even see is implicitly "no access" on every
    // action, regardless of what the module table says.
    if (!canAccessPage(moduleName)) return false;
    return !!getModulePermissions(user.role, moduleName, user.id)[action];
  }

  const canViewModule = (moduleName) => canPerform("view", moduleName);
  const canCreate = (moduleName) => canPerform("create", moduleName);
  const canEdit = (moduleName) => canPerform("edit", moduleName);
  const canDelete = (moduleName) => canPerform("delete", moduleName);

  /** Returns the list of page labels a given role is allowed to see.
   *  "admin" (and the built-in Super Admin) always gets every page,
   *  regardless of what's stored, so the app can never lock the admin
   *  seat out of its own permissions screen. Any specific job title (e.g.
   *  "UI/UX Designer") is normalized down to its permission category
   *  (getRoleCategory) before the lookup, so approving someone with a
   *  real job title doesn't leave them with an empty/no-access sidebar.
   *
   *  `userId` is optional. Pass it (e.g. `getAllowedPages(user.role,
   *  user.id)`) to resolve one SPECIFIC person's real, final page list —
   *  their individual override (if any) takes priority over their role's
   *  default. Omit it when you just want to read/edit a ROLE's own
   *  defaults in the abstract (e.g. UserPage's Page Access Control
   *  table), so a specific person's override never leaks into that view. */
  function getAllowedPages(role, userId) {
    const category = getRoleCategory(role);
    if (category === "admin") return ALL_PAGES;
    if (userId != null) {
      const override = userAccessOverrides[userId];
      if (override) {
        if (override.mode === "full") return ALL_PAGES;
        if (override.mode === "none") return [];
        if (override.mode === "custom") return override.pages || [];
      }
    }
    return rolePermissions[category] || DEFAULT_ROLE_PERMISSIONS.employee;
  }

  /** Convenience for the currently logged-in user's fully-resolved page
   *  list (role default + their own override already applied, if any).
   *  If Dashboard.jsx's sidebar filter currently calls
   *  `getAllowedPages(user.role)` directly, swap that call for this one
   *  (or for `getAllowedPages(user.role, user.id)`) so an individual
   *  override actually changes what that person's sidebar shows. */
  function getAllowedPagesForCurrentUser() {
    if (!user) return [];
    return getAllowedPages(user.role, user.id);
  }

  /** Convenience check for a specific page, defaulting to "no access" if
   *  there's no logged-in user yet. Always resolves the CURRENT user's
   *  individual override too (via the userId argument), not just their
   *  role's default. */
  function canAccessPage(page) {
    if (!user) return false;
    return getAllowedPages(user.role, user.id).includes(page);
  }

  /** Admin action: read the individual access override currently set for
   *  a specific user id, or null if that user has none (meaning they
   *  simply follow their role's default access). Used by UserPage's
   *  Individual User Access panel to show each user's current mode. */
  function getUserAccessOverride(id) {
    return userAccessOverrides[id] || null;
  }

  /** Admin action: set, replace, or clear ONE user's individual access
   *  override — the real enforcement layer behind UserPage's Individual
   *  User Access panel. `mode` is one of:
   *    - "default": clears the override entirely (back to plain
   *      role-based access via rolePermissions)
   *    - "custom": exactly `pages` (an explicit list of page labels)
   *    - "full": every page in ALL_PAGES, admin-style
   *    - "none": no pages at all — a full lockout without deactivating
   *      the account
   *  Once saved, getAllowedPages / getModulePermissions / canAccessPage
   *  all resolve through this immediately, everywhere in the app — no
   *  separate wiring needed elsewhere. A real admin's own access can
   *  never be narrowed this way, mirroring the guard already used by
   *  updateModulePermission. */
  function updateUserAccessOverride(id, mode, pages) {
    const target = users.find((u) => u.id === id);
    if (target && getRoleCategory(target.role) === "admin") return;

    setUserAccessOverrides((prev) => {
      const next = { ...prev };
      if (!mode || mode === "default") {
        delete next[id];
      } else if (mode === "full") {
        next[id] = { mode: "full", pages: ALL_PAGES };
      } else if (mode === "none") {
        next[id] = { mode: "none", pages: [] };
      } else {
        next[id] = { mode: "custom", pages: Array.isArray(pages) ? pages : [] };
      }
      return next;
    });

    apiFetch(`/users/${id}/access-override/`, {
      method: "PUT",
      body: JSON.stringify({ mode: mode || "default", pages: Array.isArray(pages) ? pages : [] }),
    }).catch((err) => {
      console.error("Could not save user access override to backend:", err.message);
      // Re-sync from the server so the screen shows what is REALLY saved,
      // instead of a change that only exists in this browser.
      refreshAccessOverrides(users);
    });
  }

  /** Admin action: read the individual sub-access override currently set
   *  for a specific user id + page — "full" if granted, otherwise
   *  "default" (meaning they just get that page's normal trimmed-down
   *  non-admin view). Used by UserPage's Individual User Access modal to
   *  show/reset this per user per page, same pattern as
   *  getUserAccessOverride above. */
  function getSubPageAccess(id, pageName) {
    return (subPageAccessOverrides[id] && subPageAccessOverrides[id][pageName]) || "default";
  }

  /** Admin action: grant ("full") or clear ("default") one user's access
   *  to everything INSIDE one particular page — e.g. every tab in
   *  Settings (General, Users & Roles, Departments, Billing, ...), or the
   *  admin-wide view in Reports (every employee's reports + approve/
   *  message) — independent of whether they can see that page at all
   *  (that's still controlled separately by the page-level override /
   *  role permissions above). A real admin's own access can never be
   *  changed this way, same guard as updateUserAccessOverride. */
  function updateSubPageAccess(id, pageName, mode) {
    const target = users.find((u) => u.id === id);
    if (target && getRoleCategory(target.role) === "admin") return;

    setSubPageAccessOverrides((prev) => {
      const next = { ...prev };
      const forUser = { ...(next[id] || {}) };
      if (mode === "full") {
        forUser[pageName] = "full";
      } else {
        delete forUser[pageName];
      }
      if (Object.keys(forUser).length === 0) {
        delete next[id];
      } else {
        next[id] = forUser;
      }
      return next;
    });

    apiFetch(`/users/${id}/sub-access/${encodeURIComponent(pageName)}/`, {
      method: "PUT",
      body: JSON.stringify({ mode: mode === "full" ? "full" : "default" }),
    }).catch((err) => {
      console.error("Could not save sub-page access to backend:", err.message);
      refreshAccessOverrides(users);
    });
  }

  /** True if a specific user id currently has the page-access override
   *  (the "Default / Custom / Full Access / No Access" picker at the top
   *  of UserPage's Manage Access modal) set to "full" — i.e. an admin has
   *  explicitly said "treat this person like Admin". Used below as one of
   *  the inputs to "should pages that have their own internal admin-only
   *  view (Settings' tabs, ReportsPage's admin-wide view, etc.) treat this
   *  person as admin", not just "which pages can they see". */
  function hasFullPageAccessOverride(id) {
    const override = userAccessOverrides[id];
    return !!override && override.mode === "full";
  }

  /** Convenience check for the CURRENTLY LOGGED-IN user: should a given
   *  page (by its ALL_PAGES name, e.g. "Settings" or "Reports") show them
   *  its full, admin-style view, or just the normal trimmed-down view
   *  everyone else gets? True for real admins always. Also true for
   *  anyone granted page-access "Full Access" (mode: "full") — that
   *  option is explicitly described as "same as Admin" in the Manage
   *  Access modal, so this makes that promise hold true inside pages too,
   *  not just in the sidebar — OR anyone granted the separate, more
   *  targeted per-page override (getSubPageAccess) for just this one
   *  page, without needing full page access everywhere. This can only
   *  ever grant EXTRA visibility to a non-admin, never take anything away
   *  from an admin. */
  function hasFullSubPageAccess(pageName) {
    if (!user) return false;
    if (getRoleCategory(user.role) === "admin") return true;
    if (hasFullPageAccessOverride(user.id)) return true;
    return getSubPageAccess(user.id, pageName) === "full";
  }

  const pendingUsers = users.filter((u) => u.status === "pending");
  // Admin sessions have the full, rich `users` list (avatar, email, ...)
  // loaded via refreshUsers() — keep using that exactly as before so
  // nothing admin-facing changes shape. Every other session never gets
  // `users` populated (GET /users/ is admin-only), so it falls back to
  // the lightweight approvedUsersLite list (id/name/role) from
  // refreshApprovedUsers() above — see that state's comment for why.
  const approvedUsers = users.length > 0 ? users.filter((u) => u.status === "approved") : approvedUsersLite;

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser, // kept so existing pages (e.g. Dashboard's old logout button) don't break
        authLoading, // true until the saved token (if any) has been checked against the backend
        users,
        refreshUsers,
        pendingUsers,
        approvedUsers,
        registerUser,
        inviteUser,
        loginUser,
        loginWithGoogle,
        signupWithGoogle,
        logout,
        approveUser,
        rejectUser,
        updateUserRole,
        updateUserDepartment,
        setUserStatus,
        removeUser,
        assignManager,
        updateUserProfile,
        changePassword,
        getCompanySettings,
        updateCompanySettings,
        getNotificationPreferences,
        updateNotificationPreferences,
        getNotificationStatus,
        sendTestNotification,
        getDepartments,
        createDepartment,
        updateDepartment,
        deleteDepartment,
        getStorageUsage,
        getSecuritySettings,
        updateSecuritySettings,
        getBillingInfo,
        updateBillingInfo,
        getProjectSettings,
        updateProjectSettings,
        getTaskSettings,
        updateTaskSettings,
        getIncomeSettings,
        updateIncomeSettings,
        getExpenseSettings,
        updateExpenseSettings,
        getSalesSettings,
        updateSalesSettings,
        rolePermissions,
        updateRolePermissions,
        roleCatalog,
        createRoleCatalogEntry,
        deleteRoleCatalogEntry,
        getAllowedPages,
        getAllowedPagesForCurrentUser,
        canAccessPage,
        modulePermissions,
        updateModulePermission,
        getModulePermissions,
        userAccessOverrides,
        getUserAccessOverride,
        updateUserAccessOverride,
        subPageAccessOverrides,
        getSubPageAccess,
        updateSubPageAccess,
        hasFullSubPageAccess,
        canPerform,
        canViewModule,
        canCreate,
        canEdit,
        canDelete,
        aiAssistantEnabled,
        setAiAssistantEnabled,
        canUseAiAssistant,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// Small helper so pages just do: const { user, setUser } = useAuth();
export function useAuth() {
  return useContext(AuthContext);
}