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
import { API_ROOT } from "../apiConfig.js";

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

const config = {
  baseUrl: API_ROOT,
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
  if (status === 401) return "Please log in again.";
  if (status === 413) return "The file is too large for the server. Choose a smaller photo/video.";
  if (status >= 500) return `The server had a problem (${status}). Please try again in a moment.`;
  return `Request failed (${status}).`;
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
  let res;
  try {
    res = await fetch(`${config.baseUrl}${path}${qs(params)}`, { method, headers, body });
  } catch {
    // fetch() only throws when no HTTP answer arrived at all (connection
    // dropped / timed out mid-upload, offline, blocked). Say so instead of
    // the browser's cryptic "Failed to fetch" / "Load failed".
    throw new ApiError("Could not reach the server — check your internet connection and try again. Large videos need a stable connection.", 0, null);
  }
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

// FIX (daily report upload failed from phones / other browsers): a phone
// photo is often 5-15 MB, which is slow on mobile data and can be over the
// image-size limit of the file server. Big JPEG/PNG/WebP photos are scaled
// down (longest side 2000px, JPEG 82%) in the browser before uploading —
// plenty for a daily-report photo. Anything the browser can't decode
// (HEIC on Chrome, GIF, videos) is sent exactly as it is.
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
const SHRINK_MAX_SIDE = 2000;

async function shrinkImage(file) {
  try {
    const isShrinkable =
      /^image\/(jpeg|png|webp|bmp)$/i.test(file.type || "") ||
      (!file.type && /\.(jpe?g|png|webp|bmp)$/i.test(file.name || ""));
    if (!isShrinkable || file.size <= SHRINK_ABOVE_BYTES) return file;
    if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;

    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, SHRINK_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return file;
    }
    ctx.fillStyle = "#ffffff"; // PNG transparency would turn black in a JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file; // no gain — keep the original
    const base = (file.name || "photo").replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file;
  }
}

export async function createDaily({ date, note, project, files }) {
  const form = new FormData();
  if (date) form.append("date", date);
  form.append("note", note || "");
  form.append("project", project || "");
  for (const f of files || []) {
    form.append("files", await shrinkImage(f)); // one at a time — keeps memory low on phones
  }
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