/* ------------------------------------------------------------------ */
/*  Reports API client — every call the Reports page makes to the      */
/*  Django backend (hopenix-backend/reports).                          */
/*                                                                     */
/*  Auth: the backend uses DRF TokenAuthentication ("Authorization:    */
/*  Token <key>"). This file doesn't know where your AuthContext keeps */
/*  the token, so getToken() below looks for it in localStorage by its */
/*  SHAPE (DRF tokens are 40 hex characters) rather than by key name.  */
/*  If that ever finds the wrong thing, wire it up explicitly once —   */
/*  e.g. in AuthContext or main.jsx:                                   */
/*                                                                     */
/*    import { configureReportsApi } from "./pages/reportsApi.js";     */
/*    configureReportsApi({ getToken: () => yourTokenVariable });      */
/* ------------------------------------------------------------------ */

const TOKEN_RE = /^[a-f0-9]{40}$/i;

function discoverToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const raw = localStorage.getItem(localStorage.key(i));
      if (!raw) continue;
      const bare = raw.replace(/^"|"$/g, "");
      if (TOKEN_RE.test(bare)) return bare;
      if (raw[0] === "{") {
        const obj = JSON.parse(raw);
        const t = obj?.token || obj?.key || obj?.authToken;
        if (typeof t === "string" && TOKEN_RE.test(t)) return t;
      }
    }
  } catch {
    // storage unavailable or a non-JSON value — keep looking / give up
  }
  return null;
}

const rawReportsBase = (typeof import.meta !== "undefined" && (import.meta.env?.VITE_API_URL || import.meta.env?.VITE_API_BASE_URL)) || "http://127.0.0.1:8000";
const cleanReportsBase = rawReportsBase.replace(/\/api\/?$/, "").replace(/\/$/, "");

const config = {
  baseUrl: cleanReportsBase,
  getToken: discoverToken,
};

export function configureReportsApi(partial) {
  Object.assign(config, partial || {});
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

function errorMessage(data, status) {
  if (data && typeof data === "object") {
    if (typeof data.error === "string") return data.error;
    if (typeof data.detail === "string") return data.detail;
    const first = Object.values(data)[0];
    if (Array.isArray(first) && first.length) return String(first[0]);
    if (typeof first === "string") return first;
  }
  return status === 401 ? "Please log in again." : `Request failed (${status}).`;
}

function qs(params) {
  const sp = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "" || v === "All") return;
    sp.set(k, v);
  });
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function rawRequest(path, { method = "GET", params, json, form } = {}) {
  const headers = {};
  const token = config.getToken();
  if (token) headers.Authorization = `Token ${token}`;
  let body;
  if (form) {
    body = form; // browser sets the multipart boundary itself
  } else if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  }
  const res = await fetch(`${config.baseUrl}${path}${qs(params)}`, { method, headers, body });
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch {
      // non-JSON error body
    }
    throw new ApiError(errorMessage(data, res.status), res.status, data);
  }
  return res;
}

async function request(path, opts) {
  const res = await rawRequest(path, opts);
  if (res.status === 204) return null;
  return res.json();
}

export const browserTz = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
})();

/* ---- summary + "All Reports" rows --------------------------------- */
export const getSummary = (p) => request("/api/reports/summary/", { params: p });
export const getCatalog = (p) => request("/api/reports/catalog/", { params: p });
export const createCatalogItem = (body) => request("/api/reports/catalog/", { method: "POST", json: body });
export const renameCatalogItem = (id, name) => request(`/api/reports/catalog/${encodeURIComponent(id)}/`, { method: "PATCH", json: { name } });
export const deleteCatalogItem = (id) => request(`/api/reports/catalog/${encodeURIComponent(id)}/`, { method: "DELETE" });

/* ---- daily reports ------------------------------------------------- */

// The page filters/sorts client-side, so pull every page (capped) up front.
export async function listAllDaily(params = {}, maxPages = 10) {
  let page = 1;
  const all = [];
  for (;;) {
    const data = await request("/api/reports/daily/", { params: { ...params, page, pageSize: 200 } });
    all.push(...data.results);
    if (!data.next || page >= maxPages) return { results: all, count: data.count, truncated: !!data.next };
    page += 1;
  }
}

export function createDaily({ date, note, project, files }) {
  const form = new FormData();
  if (date) form.append("date", date);
  form.append("note", note || "");
  form.append("project", project || "");
  (files || []).forEach((f) => form.append("files", f));
  return request("/api/reports/daily/", { method: "POST", form, params: { tz: browserTz } });
}
export const deleteDaily = (id) => request(`/api/reports/daily/${id}/`, { method: "DELETE" });
export const bulkDeleteDaily = (ids) => request("/api/reports/daily/bulk-delete/", { method: "POST", json: { ids } });
export const approveDaily = (id) => request(`/api/reports/daily/${id}/approve/`, { method: "POST" });

// Photos/videos need the auth header, so they can't be a plain <img src>.
// Fetch as a blob and hand back a blob: URL the viewer can use.
export async function fetchBlob(apiPath) {
  const res = await rawRequest(apiPath);
  return res.blob();
}

/* ---- activity log -------------------------------------------------- */
export const listActivity = (p) => request("/api/reports/activity/", { params: { tz: browserTz, ...p } });
export const getActivityFilters = () => request("/api/reports/activity/filters/");
export const getUserReports = (p) => request("/api/reports/users/", { params: { tz: browserTz, ...p } });
export const getUserReport = (id, p) => request(`/api/reports/users/${id}/`, { params: { tz: browserTz, ...p } });

export function trackActivity({ module, action = "view", description, page, project }) {
  // Fire-and-forget: a failed audit ping must never disturb the UI.
  return request("/api/reports/activity/track/", { method: "POST", json: { module, action, description, page, project } }).catch(() => null);
}

export async function downloadActivityCsv(params) {
  const res = await rawRequest("/api/reports/activity/export/", { params: { tz: browserTz, ...params } });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- projects (existing endpoint — for the "Project" dropdown) ------ */
export async function listProjectNames() {
  const data = await request("/api/projects/");
  const list = Array.isArray(data) ? data : data?.results || [];
  return list.filter((p) => p && p.name && !p.isArchived && !p.is_archived).map((p) => ({ id: p.id, name: p.name }));
}
