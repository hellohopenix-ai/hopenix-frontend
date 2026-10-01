/* ===========================================================================
   brand.js
   ---------------------------------------------------------------------------
   One place that knows the company's logo, so changing it in
   Settings -> General -> Company Logo changes it on EVERY page of the site
   (landing, login/register, dashboard, client portal, ...), including the
   logged-out ones.

   How it works
     * The logo lives on the backend (CompanySettings.logo). The public
       endpoint GET /api/settings/branding/ needs no login, so the login and
       landing pages can read it too.
     * This module fetches it once at start-up, keeps it in a tiny store,
       and caches the last known URL in localStorage so the next page load
       shows the right logo instantly instead of flashing the default.
     * Components read it with useBrandLogo() / <BrandImg /> and re-render
       the moment it changes (e.g. right after an upload).
     * No custom logo yet (or the image fails to load) -> the built-in
       Hopenix phoenix is used, exactly like before.
   =========================================================================== */
import { useSyncExternalStore } from "react";
import { API_ROOT } from "./apiConfig.js";
import defaultLogo from "./assets/phoenix-logo.png";

const CACHE_KEY = "hopenix_brand_v1";
const SETTINGS_URL = `${API_ROOT}/api/settings`;

function readCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (raw && typeof raw.logo === "string") return { logo: raw.logo, name: raw.name || "" };
  } catch {
    /* storage unavailable / corrupt — ignore */
  }
  return { logo: "", name: "" };
}

let state = readCache();
const listeners = new Set();

function emit(next) {
  state = { ...state, ...next };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  applyFavicon(state.logo);
  listeners.forEach((l) => l());
}

/** Browser-tab icon follows the logo too (only once a custom one is set —
 *  otherwise the site's own favicon files stay untouched). */
function applyFavicon(url) {
  if (typeof document === "undefined" || !url) return;
  let link = document.querySelector("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.removeAttribute("type");
  link.href = url;
}

function subscribe(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
const getSnapshot = () => state;

/** { logo: <custom url or "">, name } */
export function useBrand() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The URL every logo <img> should use: the custom one, else the phoenix. */
export function useBrandLogo() {
  return useBrand().logo || defaultLogo;
}

export const DEFAULT_LOGO = defaultLogo;

/** Re-read the logo from the server (called at start-up and after login). */
export async function refreshBrand() {
  try {
    const res = await fetch(`${SETTINGS_URL}/branding/`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    emit({ logo: data.logo || "", name: data.name || "" });
  } catch {
    /* offline / backend down — keep whatever we had */
  }
}

/** Called by the <img> fallback: a custom logo that fails to load (deleted
 *  file, storage hiccup) must never leave a broken picture on the site. */
export function markLogoBroken() {
  if (state.logo) emit({ logo: "" });
}

function authHeaders() {
  const token = localStorage.getItem("hopenix_auth_token");
  return token ? { Authorization: `Token ${token}` } : {};
}

async function parse(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.detail)) || "Couldn't update the logo. Please try again.";
    throw new Error(String(msg));
  }
  return data;
}

/** Admin: upload a new company logo. Resolves with the new URL. */
export async function uploadCompanyLogo(file) {
  const body = new FormData();
  body.append("logo", file);
  const data = await parse(await fetch(`${SETTINGS_URL}/company/logo/`, { method: "POST", headers: authHeaders(), body }));
  emit({ logo: data.logo || "" });
  return data.logo || "";
}

/** Admin: go back to the built-in logo. */
export async function removeCompanyLogo() {
  await parse(await fetch(`${SETTINGS_URL}/company/logo/`, { method: "DELETE", headers: authHeaders() }));
  emit({ logo: "" });
}

// Fetch as soon as this module is first imported (main.jsx imports it).
refreshBrand();
if (state.logo) applyFavicon(state.logo);
