// src/api/employeesApi.js
//
// Talks to the Django `employees` app (see hopenix-backend/employees/).
// Only covers what EmployeesPage.jsx can't get from AuthContext already:
// rating, Active/On Leave status, location override, leave requests,
// holidays and the promotions/bonus/post announcement feed. Everything
// about an employee's core identity (name, email, role, department,
// avatar, salary, approval) still goes through AuthContext exactly as
// before — this file never touches that.
//
// Adjust API_BASE_URL / TOKEN_KEYS below if your AuthContext stores the
// backend URL or auth token differently.

const rawBase = import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";
const API_BASE_URL = rawBase.endsWith("/api") ? rawBase : `${rawBase.replace(/\/$/, "")}/api`;

// Confirmed from the browser's actual localStorage keys: AuthContext
// saves the DRF token under "hopenix_auth_token". The others are kept as
// a fallback in case a different part of the app ever saves it under one
// of these instead.
const TOKEN_KEYS = ["hopenix_auth_token", "hopenix_token", "authToken", "token"];

function getToken() {
  for (const key of TOKEN_KEYS) {
    let value = localStorage.getItem(key);
    if (!value) continue;
    // In case it was ever saved via JSON.stringify (adds surrounding quotes).
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        // leave as-is
      }
    }
    return value;
  }
  return null;
}

async function request(path, { method = "GET", body, isForm = false } = {}) {
  const token = getToken();
  const headers = {};
  if (token) headers.Authorization = `Token ${token}`;
  if (!isForm && body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE_URL}/employees${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no JSON body (e.g. a plain error page) — fall through with data = null
  }

  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || Object.values(data)[0])) || `Request failed (${res.status}).`;
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

// -- Employees (rating / status / location / manual perf fallback) --------

export const fetchEmployees = () => request("/");
export const fetchEmployee = (userId) => request(`/${userId}/`);
export const setEmployeeStatus = (userId, status) =>
  request(`/${userId}/status/`, { method: "POST", body: { status } });
export const setEmployeeRating = (userId, rating) =>
  request(`/${userId}/rating/`, { method: "POST", body: { rating } });
export const setEmployeeLocation = (userId, location) =>
  request(`/${userId}/location/`, { method: "POST", body: { location } });
export const setEmployeePerformance = (userId, fields) =>
  request(`/${userId}/performance/`, { method: "POST", body: fields });

// -- Leave requests ---------------------------------------------------------

export const fetchLeaveRequests = (employeeId) =>
  request(employeeId ? `/leave-requests/?employee=${employeeId}` : "/leave-requests/");
export const submitLeaveRequest = (employeeId, { type, startDate, endDate, reason }) =>
  request("/leave-requests/", {
    method: "POST",
    body: { employee: employeeId, type, startDate, endDate, reason },
  });
export const decideLeaveRequest = (leaveId, decision) =>
  request(`/leave-requests/${leaveId}/${decision === "approved" ? "approve" : "reject"}/`, { method: "POST" });
export const cancelLeaveRequest = (leaveId) => request(`/leave-requests/${leaveId}/`, { method: "DELETE" });

// -- Holidays -----------------------------------------------------------------

export const fetchHolidays = () => request("/holidays/");
export const announceHoliday = (date, reason) =>
  request("/holidays/", { method: "POST", body: { date, reason } });
export const cancelHoliday = (holidayId) => request(`/holidays/${holidayId}/`, { method: "DELETE" });

// -- Announcements (promotions / bonuses / posts) ----------------------------

export const fetchAnnouncements = () => request("/announcements/");

export function postAnnouncement({ type, employeeId, detail, message, image, pdfFile }) {
  const form = new FormData();
  form.append("type", type);
  if (employeeId) form.append("employeeId", employeeId);
  if (detail) form.append("detail", detail);
  if (message) form.append("message", message);
  if (image) form.append("image", image);
  if (pdfFile) form.append("pdfFile", pdfFile);
  return request("/announcements/", { method: "POST", body: form, isForm: true });
}

export const cancelAnnouncement = (announcementId) =>
  request(`/announcements/${announcementId}/`, { method: "DELETE" });
export const markAnnouncementSeen = (announcementId) =>
  request(`/announcements/${announcementId}/seen/`, { method: "POST" });