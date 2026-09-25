// Real backend client for Messaging (Django REST Framework).
// Token stored in localStorage under "hopenix_auth_token", sent as "Authorization: Token <key>".

import { API_ROOT } from "./apiConfig.js";

const API_BASE_URL = `${API_ROOT}/api/messages`;

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
    // non-json body
  }

  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || Object.values(data)[0])) ||
      "Something went wrong talking to the messaging server.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

export function fetchConversations() {
  return apiFetch("/conversations/");
}

export function fetchThread(userId) {
  return apiFetch(`/thread/${userId}/`);
}

export function markThreadRead(userId) {
  return apiFetch(`/thread/${userId}/read/`, { method: "POST" });
}

export function sendMessage({ recipientId, text, attachment }) {
  if (attachment) {
    const fd = new FormData();
    fd.append("recipient", recipientId);
    if (text) fd.append("text", text);
    fd.append("attachment", attachment);
    return apiFetch("/send/", { method: "POST", body: fd });
  } else {
    return apiFetch("/send/", {
      method: "POST",
      body: JSON.stringify({ recipient: recipientId, text: text || "" }),
    });
  }
}
