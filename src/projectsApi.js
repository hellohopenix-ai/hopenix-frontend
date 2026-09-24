// Real backend client for the Projects app (Django REST Framework).
// Mirrors the exact same token pattern AuthContext.jsx already uses:
// Token stored in localStorage under "hopenix_auth_token", sent as
// "Authorization: Token <key>" (DRF TokenAuthentication, not JWT/Bearer).

const API_BASE_URL = "http://127.0.0.1:8000/api/projects";

/** Fetch wrapper for JSON endpoints. For file uploads, pass a FormData
 *  body — Content-Type is intentionally left unset so the browser adds
 *  the correct multipart boundary itself. */
async function apiFetch(path, options = {}) {
  const token = localStorage.getItem("hopenix_auth_token");
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers = { ...(options.headers || {}) };
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Token ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses (e.g. file downloads) have no JSON body
  }

  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || Object.values(data)[0])) ||
      "Something went wrong talking to the server.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

/* ---------------------------- Projects ---------------------------- */

export function listProjects() {
  return apiFetch("/");
}
export function getProject(id) {
  return apiFetch(`/${id}/`);
}
export function createProject(payload) {
  return apiFetch("/", { method: "POST", body: JSON.stringify(payload) });
}
export function updateProject(id, payload) {
  return apiFetch(`/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
}
/** Soft-delete (archives, doesn't hard-delete) — matches ProjectViewSet.destroy. */
export function archiveProject(id) {
  return apiFetch(`/${id}/`, { method: "DELETE" });
}
export function restoreProject(id) {
  return apiFetch(`/${id}/restore/`, { method: "POST" });
}

export function uploadBrief(id, file) {
  const fd = new FormData();
  fd.append("brief", file);
  return apiFetch(`/${id}/brief/`, { method: "POST", body: fd });
}
export function uploadDeliverableZip(id, file) {
  const fd = new FormData();
  fd.append("zip", file);
  return apiFetch(`/${id}/zip/`, { method: "POST", body: fd });
}

/* ----------------------------- Modules ----------------------------- */

export function listModules(projectId) {
  return apiFetch(`/${projectId}/modules/`);
}
export function createModule(projectId, payload) {
  return apiFetch(`/${projectId}/modules/`, { method: "POST", body: JSON.stringify(payload) });
}
export function updateModule(projectId, moduleId, payload) {
  return apiFetch(`/${projectId}/modules/${moduleId}/`, { method: "PATCH", body: JSON.stringify(payload) });
}
export function deleteModule(projectId, moduleId) {
  return apiFetch(`/${projectId}/modules/${moduleId}/`, { method: "DELETE" });
}

/* --------------------------- Module files --------------------------- */

export function uploadModuleFile(projectId, moduleId, file) {
  const fd = new FormData();
  fd.append("file", file);
  return apiFetch(`/${projectId}/modules/${moduleId}/files/`, { method: "POST", body: fd });
}
export function deleteModuleFile(projectId, moduleId, fileId) {
  return apiFetch(`/${projectId}/modules/${moduleId}/files/${fileId}/`, { method: "DELETE" });
}

export const PROJECTS_API_BASE_URL = API_BASE_URL;
