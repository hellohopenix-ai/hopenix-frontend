// Single source of truth for the backend URL.
//
// Set VITE_API_BASE_URL in your .env to the Django host, e.g.
//   VITE_API_BASE_URL=https://api.yourdomain.com
// or, for local dev (this is also the default if the var is unset):
//   VITE_API_BASE_URL=http://127.0.0.1:8000
//
// Every other file should import from here instead of hardcoding a host.
const FALLBACK_ROOT = "http://127.0.0.1:8000";

const rawRoot =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_API_BASE_URL) ||
  FALLBACK_ROOT;

// Strip any trailing slash so callers can safely do `${API_ROOT}/api/...`.
export const API_ROOT = rawRoot.replace(/\/+$/, "");

// Most of the app talks to /api/*.
export const API_BASE_URL = `${API_ROOT}/api`;

// Same host, but ws:// (or wss:// if API_ROOT is https://).
export const WS_BASE_URL = API_ROOT.replace(/^http/, "ws");

export default API_ROOT;
