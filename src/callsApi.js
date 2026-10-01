// Calls API — mirrors messagesApi.js's conventions exactly (same base
// host, same DRF Token auth header, same JSON-first-then-throw error
// handling) so MessagesPage.jsx's call feature talks to the backend the
// same way its messages already do.

// Django backend base URL comes from src/apiConfig.js (VITE_API_BASE_URL) —
// same host AuthContext.jsx and messagesApi.js use, just a different path.
import { API_ROOT } from "./apiConfig.js";
import { getMessagingToken } from "./messagingToken.js";

const API_BASE_URL = `${API_ROOT}/api/messages`;

async function apiFetch(path, options = {}) {
  const token = getMessagingToken();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers["Authorization"] = `Token ${token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses have no body
  }
  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || Object.values(data)[0])) ||
      "Something went wrong. Please try again.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

/** Starts a call to `calleeId`. The backend checks in real time whether
 *  that user's websocket is actually connected right now: if it is, the
 *  call comes back with status "ringing" and a "call.incoming" event is
 *  pushed to them; if they're offline, it comes back already "missed"
 *  (there's no live connection to ring). */
export function startCall(calleeId, callType = "audio") {
  return apiFetch("/calls/start/", {
    method: "POST",
    body: JSON.stringify({ calleeId, callType }),
  });
}

/** Callee only. action is "accept" or "reject". */
export function respondToCall(callId, action) {
  return apiFetch(`/calls/${callId}/respond/`, {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

/** Either party. Ends an ongoing call, or cancels/times out a ringing
 *  one (which the backend then records as "missed"). */
export function endCall(callId) {
  return apiFetch(`/calls/${callId}/end/`, { method: "POST" });
}

/** Relays one WebRTC signalling payload (SDP offer/answer or an ICE
 *  candidate) to the other participant over their existing websocket. */
export function sendCallSignal(callId, data) {
  return apiFetch(`/calls/${callId}/signal/`, {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

/** Recent calls between the current user and `userId` — used to show a
 *  "Missed call" / "Call ended · 3:12" strip for the open conversation. */
export function fetchCallHistory(userId) {
  return apiFetch(`/calls/thread/${userId}/`, { method: "GET" });
}

/** Any call currently RINGING where the current user is the callee, or
 *  null. Called once on app load to recover an in-progress ring — e.g.
 *  the user opened the app from a push notification (see
 *  pushSubscription.js) after missing the live "call.incoming" websocket
 *  event because their tab/browser was closed when it arrived. */
export function fetchActiveIncomingCall() {
  return apiFetch("/calls/active/", { method: "GET" });
}