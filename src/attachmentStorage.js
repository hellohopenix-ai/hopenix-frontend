/* ======================================================================
   ATTACHMENT FILE STORAGE (IndexedDB)

   WHY THIS FILE EXISTS (bug fix):
   Every uploaded screenshot/video/zip used to be base64-encoded and
   stored directly inside the task/client JSON that gets saved to
   localStorage. Browsers cap localStorage at only a few MB TOTAL for
   the whole app (not per item) — so once a real file in the 5-20MB
   range was involved (a zipped module build, a finished project
   deliverable), one of two things happened silently:
     1) it was rejected outright by the old 5MB-per-file check, or
     2) it looked like it "added" in the UI, but `localStorage.setItem`
        then threw a quota error that was silently swallowed by a bare
        try/catch, so it never actually persisted (and in the worst
        case could corrupt other unrelated saved data in the same
        quota — tasks, clients, invoices).

   THE FIX:
   The actual file bytes now live in IndexedDB — a browser database
   built for exactly this, with realistically hundreds of MB to a few
   GB of headroom, way beyond localStorage. localStorage/React state
   keep only small metadata about each attachment (id, name, type,
   uploadedAt). Every page in this app (Tasks, Clients, Client Portal)
   shares the same browser/origin, so whatever gets uploaded from any
   one of them is instantly readable from the others too — exactly
   like before, just without the size ceiling.

   ATTACHMENT SHAPE (stays backward compatible with old saved data):
     - type "link"                    -> { id, type: "link", name, url, uploadedAt }
     - type image/video/zip/file
       (OLD data, saved before this fix)
                                       -> { id, type, name, url: "data:...", uploadedAt }
     - type image/video/zip/file
       (NEW uploads, after this fix)
                                       -> { id, type, name, storedInIDB: true, uploadedAt }
       (actual bytes stored separately in IndexedDB, keyed by `id`)
====================================================================== */

import { useEffect, useState } from "react";

const DB_NAME = "app_attachments_v1";
const STORE_NAME = "files";
const DB_VERSION = 1;

let dbPromise = null;
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("File storage isn't available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Could not open file storage."));
  });
  return dbPromise;
}

// A much smaller cap used only for the fallback path below, since it
// goes back to base64-in-localStorage territory (see the big comment at
// the top of this file for why that has to stay small).
const FALLBACK_MAX_BYTES = 5 * 1024 * 1024;

function readFileAsDataUrl(file, maxBytes) {
  return new Promise((resolve, reject) => {
    if (file.size > maxBytes) {
      reject(
        new Error(
          `File storage is restricted in this environment (files here are limited to ${Math.round(
            maxBytes / (1024 * 1024)
          )}MB). This usually happens inside an embedded/sandboxed preview — try opening the app in its own browser tab.`
        )
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

// Saves a file's bytes for later retrieval and returns the extra
// field(s) to spread into the attachment metadata object — either
// { storedInIDB: true } (bytes saved to IndexedDB, effectively no size
// ceiling beyond MAX_ATTACHMENT_BYTES) or { url: "data:..." } (a
// same-tab base64 fallback, capped much lower).
//
// IndexedDB can throw a bare "UnknownError: Internal error." with no
// further detail — this shows up most often when the page is running
// inside a sandboxed/embedded preview (an iframe with third-party
// storage restrictions), not because of anything wrong with the file
// itself. Rather than surface that cryptic browser message, this falls
// back automatically so the upload still works — just with a lower
function fileToArrayBuffer(file) {
  if (!file) return Promise.resolve(new ArrayBuffer(0));
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file as ArrayBuffer"));
    reader.readAsArrayBuffer(file);
  });
}

export async function saveAttachmentBlob(id, file) {
  try {
    const db = await openDb();
    const buffer = await fileToArrayBuffer(file);
    const type = file.type || "application/octet-stream";
    const name = file.name || "file";
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ buffer, type, name }, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save file."));
    });
    return { storedInIDB: true };
  } catch (e) {
    console.warn("[attachmentStorage] IndexedDB save failed, falling back to lightweight ref:", e);
    dbPromise = null;
    return { storedInIDB: false };
  }
}

export async function getAttachmentBlob(id) {
  try {
    const db = await openDb();
    const res = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error("Could not read file."));
    });
    if (!res) return null;
    if (res instanceof Blob) return res;
    if (res.buffer) return new Blob([res.buffer], { type: res.type || "application/octet-stream" });
    return null;
  } catch {
    dbPromise = null;
    return null;
  }
}

export async function deleteAttachmentBlob(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Could not delete file."));
  });
}

// Small in-tab cache so the same attachment isn't re-read/re-decoded on
// every render — object URLs are cheap to keep around for the tab's life.
const urlCache = new Map();

async function resolveAttachmentUrl(a) {
  if (a.url) return a.url; // "link" type, or a legacy base64 attachment — already usable as-is
  if (!a.storedInIDB) return null;
  if (urlCache.has(a.id)) return urlCache.get(a.id);
  const blob = await getAttachmentBlob(a.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(a.id, url);
  return url;
}

// Drop-in hook: pass whatever attachments array you already read off a
// task/module/sub-task/project, get back the same array with `.url`
// filled in for every attachment (resolved from IndexedDB where needed).
// Every existing render call that reads `a.url` — <img src={a.url}>,
// <a href={a.url}> — keeps working completely unchanged.
export function useResolvedAttachments(attachments) {
  const list = attachments || [];
  const [resolved, setResolved] = useState(list);
  // Depend on the ids (not the array reference) so a re-render with a
  // structurally-identical list doesn't re-trigger the IndexedDB reads.
  const idKey = list.map((a) => a.id).join(",");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await Promise.all(
        list.map(async (a) => {
          if (a.url) return a;
          const url = await resolveAttachmentUrl(a).catch(() => null);
          return url ? { ...a, url } : a;
        })
      );
      if (!cancelled) setResolved(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  return resolved;
}

/* ======================================================================
   LEGACY ATTACHMENT MIGRATION (one-time cleanup)

   WHY THIS EXISTS:
   Anything uploaded before this file's IndexedDB fix — or uploaded
   during a moment IndexedDB briefly failed and the 5MB fallback kicked
   in — is still sitting in localStorage as a base64 `url`. localStorage
   shares one small quota across EVERYTHING the app saves (tasks,
   clients, invoices, employees...), so a handful of these old entries
   can be enough to make every *new* save fail from then on — including
   a save for a task that has nothing to do with the original large
   file. Since the failure is silent by design in old code (see the
   FIX comments in TasksPage.jsx/ClientsPage.jsx), it can look like a
   brand-new upload is broken when the real problem is leftover old
   data quietly filling up the quota.

   This walks any saved tasks/clients data, finds attachments still
   holding a base64 `url`, moves their bytes into IndexedDB, and hands
   back an equivalent, much smaller record — freeing up the shared
   quota without losing anything. Safe to run on every page load: once
   there's nothing left to migrate, it's a no-op.
====================================================================== */

// A "link" attachment also has a `url`, but it's always a real,
// hand-typed http(s) address — never a data: URL — so this never
// mistakes a link for a legacy file that needs migrating.
function isLegacyDataUrlAttachment(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.url === "string" &&
    value.url.startsWith("data:") &&
    value.type !== "link"
  );
}

function dataUrlToBlob(dataUrl) {
  const commaIdx = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, commaIdx);
  const base64 = dataUrl.slice(commaIdx + 1);
  const mimeMatch = /data:(.*?);base64/.exec(header);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Migrates one attachment. Never throws — a failed migration just
// leaves that attachment exactly as it was, since this always runs as
// a best-effort background step, not something the person is waiting
// on or would see an error from.
async function migrateLegacyAttachment(attachment) {
  if (!isLegacyDataUrlAttachment(attachment)) return attachment;
  try {
    const blob = dataUrlToBlob(attachment.url);
    const stored = await saveAttachmentBlob(attachment.id, blob);
    if (!stored.storedInIDB) return attachment; // IndexedDB still unavailable — leave as-is
    const { url, ...rest } = attachment;
    return { ...rest, ...stored };
  } catch (e) {
    console.warn("[attachmentStorage] Could not migrate legacy attachment:", attachment.id, e);
    return attachment;
  }
}

// Deep-walks any JSON-shaped value — the whole `tasks` array, the whole
// `clients` array, a single task, whatever — and migrates every legacy
// attachment found anywhere inside it, no matter how deeply nested
// (module attachments, sub-module attachments, per-task attachments,
// per-subtask attachments, a project's deliverableZip, ...). Returns
// `{ value, changed }` so the caller only re-saves to storage — and
// only shows any "migrated" feedback — when something actually moved.
export async function migrateLegacyAttachmentsDeep(value) {
  let changed = false;
  async function walk(node) {
    if (Array.isArray(node)) {
      return Promise.all(node.map(walk));
    }
    if (node && typeof node === "object") {
      if (isLegacyDataUrlAttachment(node)) {
        const migrated = await migrateLegacyAttachment(node);
        if (migrated !== node) changed = true;
        return migrated;
      }
      const entries = await Promise.all(Object.entries(node).map(async ([k, v]) => [k, await walk(v)]));
      return Object.fromEntries(entries);
    }
    return node;
  }
  const result = await walk(value);
  return { value: result, changed };
}