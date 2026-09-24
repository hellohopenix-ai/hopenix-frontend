// expensesApi.js
// Talks to the new Django `expenses` app instead of localStorage.
// Drop this file next to ExpensesPage.jsx (e.g. src/api/expensesApi.js)
// and see EXPENSES_BACKEND_GUIDE.md for exactly what to change inside
// ExpensesPage.jsx to use it.

// Same host/port AuthContext.jsx's API_BASE_URL uses ("http://127.0.0.1:8000/api/auth")
// — change this if your backend runs somewhere else.
const BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000") + "/api/expenses/expenses";

function authHeaders() {
  // Same key AuthContext.jsx saves the DRF token under after login.
  const token = localStorage.getItem("hopenix_auth_token");
  return token ? { Authorization: `Token ${token}` } : {};
}

async function handleResponse(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || body.detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// GET /expenses/?category=&project=&payment=&status=&search=&dateFrom=&dateTo=
export async function fetchExpenses(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v);
  });
  const res = await fetch(`${BASE_URL}/?${params.toString()}`, {
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// GET /expenses/summary/  -> stat cards + category breakdown
export async function fetchExpenseSummary() {
  const res = await fetch(`${BASE_URL}/summary/`, { headers: { ...authHeaders() } });
  return handleResponse(res);
}

// GET /expenses/filters/  -> distinct categories/projects for dropdowns
export async function fetchExpenseFilters() {
  const res = await fetch(`${BASE_URL}/filters/`, { headers: { ...authHeaders() } });
  return handleResponse(res);
}

// POST /expenses/   body: {title, category, project, amount, date, payment, status}
export async function createExpense(data) {
  const res = await fetch(`${BASE_URL}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// PATCH /expenses/:id/
export async function updateExpense(id, data) {
  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}

// DELETE /expenses/:id/
export async function deleteExpense(id) {
  const res = await fetch(`${BASE_URL}/${id}/`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}

// POST /expenses/:id/receipt/   (multipart file upload — image or pdf)
export async function uploadReceipt(id, file) {
  const form = new FormData();
  form.append("receipt", file);
  const res = await fetch(`${BASE_URL}/${id}/receipt/`, {
    method: "POST",
    headers: { ...authHeaders() }, // do NOT set Content-Type, browser sets multipart boundary
    body: form,
  });
  return handleResponse(res);
}

// DELETE /expenses/:id/receipt/
export async function removeReceipt(id) {
  const res = await fetch(`${BASE_URL}/${id}/receipt/`, {
    method: "DELETE",
    headers: { ...authHeaders() },
  });
  return handleResponse(res);
}