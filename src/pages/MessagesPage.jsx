import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "../AuthContext.jsx";
import { useMessagingSocket } from "../MessagingSocketContext.jsx";
import { fetchConversations, fetchThread, markThreadRead, sendMessage as apiSendMessage } from "../messagesApi.js";
import {
  getPendingEmployeeBirthdayMessages,
  markBirthdayMessageDelivered,
  isBirthdayMessageAlreadyInConversations,
} from "../birthdayMessageDelivery.js";
import {
  Search,
  Filter,
  Info,
  MoreVertical,
  Paperclip,
  Smile,
  Send,
  ChevronRight,
  ChevronLeft,
  FileText,
  FileImage,
  Download,
  Eye,
  Mail,
  Phone,
  MapPin,
  X,
  Trash2,
  Plus,
  Check,
  MessageSquareOff,
  Mic,
  Square,
  Play,
  Pause,
  Users,
  User,
  Camera,
  Pencil,
  PhoneOff,
  PhoneMissed,
} from "lucide-react";
import { fetchCallHistory as apiFetchCallHistory } from "../callsApi.js";

/* -------------------------------------------------------------------------
 * NOTE: the conversation data used to live here as local mock state. It now
 * lives in Dashboard.jsx (SEED_CONVERSATIONS) and is passed down as the
 * `conversations` / `setConversations` props, so the Dashboard's AI
 * Assistant panel and this Messages page always show the same data — a
 * message sent from either place shows up in both.
 *
 * PERSISTENCE: conversations are now mirrored to localStorage from
 * Dashboard.jsx (the single authoritative source), not from this file.
 * That's what keeps messages from resetting when you navigate away to
 * another page and back.
 * ---------------------------------------------------------------------- */

const STATUS_FILTERS = ["All", "Active", "Away", "Offline"];

const statusColor = {
  Active: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  Away: "bg-amber-50 text-amber-600 ring-amber-200",
  Offline: "bg-slate-100 text-slate-500 ring-slate-200",
};

const statusDot = {
  Active: "bg-emerald-500",
  Away: "bg-amber-500",
  Offline: "bg-slate-400",
};

const fileIconColor = {
  pdf: "text-rose-500 bg-rose-50",
  doc: "text-indigo-500 bg-indigo-50",
  img: "text-emerald-500 bg-emerald-50",
};

const EMOJIS = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤔", "😴",
  "😢", "😭", "😡", "🥳", "😇", "🙌", "👏", "🙏", "👍", "👎",
  "💪", "🤝", "❤️", "🔥", "🎉", "✅", "❌", "⚡", "⭐", "💡",
];

/* -------------------------------------------------------------------------
 * BROADCAST COMMAND DETECTION
 * If the typed message starts with a phrase like "send to all", "broadcast",
 * "sab ko bhejo", etc. we strip the trigger phrase and send the remaining
 * text to every conversation instead of just the active one. Users can also
 * flip the explicit "Send to all members" toggle in the composer — either
 * path works, and individual sending (the default) is untouched.
 * ---------------------------------------------------------------------- */
const BROADCAST_TRIGGERS = [
  /^send\s+(this\s+|the\s+)?(msg|message)?\s*to\s+all(\s+members)?[:\-,]?\s*/i,
  /^send\s+(this\s+|the\s+)?(msg|message)?\s*to\s+everyone[:\-,]?\s*/i,
  /^broadcast[:\-,]?\s*/i,
  /^send\s+to\s+all[:\-,]?\s*/i,
  /^sab\s*ko\s*(bhej\s*do|send\s*karo|msg\s*karo|message\s*karo)[:\-,]?\s*/i,
  /^all\s+members\s+ko\s+(bhej\s*do|send\s*karo)[:\-,]?\s*/i,
  /^everyone\s+ko\s+(bhej\s*do|send\s*karo)[:\-,]?\s*/i,
];

/* Named-target detection, e.g. "Ali ko message karo: kal milte hain",
 * "message Ali: ...", "send Ali a message ...", "tell Ali ...". Used by
 * both the composer's typed commands and the AI Assistant panel, so
 * "Ali ko message karo" and "sab ko message karo" behave the same way
 * everywhere in the app. */
const NAMED_TARGET_PATTERNS = [
  /^(.+?)\s*ko\s*(msg|message)\s*(karo|bhejo|send\s*karo)[:\-,]?\s*/i,
  /^message\s+(.+?)[:\-,]\s*/i,
  /^send\s+(.+?)\s+(a\s+)?(msg|message)[:\-,]?\s*/i,
  /^tell\s+(.+?)[:\-,]\s*/i,
];

function parseCommand(rawText) {
  for (const pattern of BROADCAST_TRIGGERS) {
    if (pattern.test(rawText)) {
      return { isBroadcast: true, message: rawText.replace(pattern, "").trim() };
    }
  }
  return { isBroadcast: false, message: rawText };
}

/**
 * Resolves a natural-language command to a send target:
 *  - { type: "all", message }              → broadcast to every conversation
 *  - { type: "person", conversation, message } → a specific named person
 *  - { type: "unresolved", message }        → no target could be matched
 *
 * Exported so Dashboard.jsx's AI Assistant panel can reuse the EXACT same
 * parsing/matching logic that the message composer uses — see the
 * integration notes at the bottom of this file for how to wire it up.
 */
export function resolveMessageTarget(rawText, conversations) {
  const broadcast = parseCommand(rawText);
  if (broadcast.isBroadcast) {
    return { type: "all", message: broadcast.message };
  }

  for (const pattern of NAMED_TARGET_PATTERNS) {
    const match = rawText.match(pattern);
    if (match) {
      const name = match[1].trim();
      const conversation = conversations.find((c) =>
        c.name.toLowerCase().includes(name.toLowerCase())
      );
      if (conversation) {
        return {
          type: "person",
          conversation,
          message: rawText.slice(match[0].length).trim(),
        };
      }
    }
  }

  return { type: "unresolved", message: rawText };
}

/**
 * Actually performs the send for a resolved command against the shared
 * `conversations` state. Exported so the AI Assistant panel in
 * Dashboard.jsx can call this directly instead of re-implementing message
 * sending — pass it the same `conversations` / `setConversations` props
 * MessagesPage already receives, plus whatever the person typed to the AI.
 *
 * Returns a short human-readable result string the AI can reply with
 * (e.g. "Sent to Ali" / "Sent to all 6 members" / "Couldn't find ...").
 */
export function sendAssistantMessage(conversations, setConversations, rawText) {
  const text = rawText.trim();
  if (!text) return "Nothing to send.";

  const target = resolveMessageTarget(text, conversations);
  const now = Date.now();
  const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDate = todayDateKey();

  if (target.type === "all") {
    if (!target.message) return "Say what you'd like sent to everyone.";
    setConversations((prev) =>
      prev.map((c) => {
        const nextId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
        return {
          ...c,
          time: nowTime,
          lastMessageAt: now,
          lastMessageDate: nowDate,
          // Always sent by "admin" here, so the employee side of each
          // thread is the one who hasn't read it yet.
          unreadForUser: (c.unreadForUser || 0) + 1,
          messages: [
            ...c.messages,
            { id: nextId, text: target.message, time: nowTime, date: nowDate, timestamp: now, outgoing: true, sender: "admin" },
          ],
        };
      })
    );
    return `Sent to all ${conversations.length} members.`;
  }

  if (target.type === "person") {
    if (!target.message) return `Say what you'd like sent to ${target.conversation.name}.`;
    setConversations((prev) => {
      const updated = prev.map((c) =>
        c.id === target.conversation.id
          ? {
              ...c,
              time: nowTime,
              lastMessageAt: now,
              lastMessageDate: nowDate,
              unreadForUser: (c.unreadForUser || 0) + 1,
              messages: [
                ...c.messages,
                {
                  id: (c.messages[c.messages.length - 1]?.id || 0) + 1,
                  text: target.message,
                  time: nowTime,
                  date: nowDate,
                  timestamp: now,
                  outgoing: true,
                  sender: "admin",
                },
              ],
            }
          : c
      );
      const idx = updated.findIndex((c) => c.id === target.conversation.id);
      if (idx > 0) {
        const [moved] = updated.splice(idx, 1);
        updated.unshift(moved);
      }
      return updated;
    });
    return `Sent to ${target.conversation.name}.`;
  }

  return "Couldn't tell who that message is for — try \"<name> ko message karo: ...\" or \"send to all: ...\".";
}

/* -------------------------------------------------------------------------
 * MESSAGE ATTACHMENT MEDIA — stored in IndexedDB, NOT localStorage
 * ---------------------------------------------------------------------
 * Message attachments (screenshots sent from the Reports page, files sent
 * from the composer) used to be embedded directly as base64 `data:` URLs
 * inside the message object, which lives inside the `conversations` array
 * that Dashboard.jsx JSON.stringifies into localStorage on every change.
 * That silently breaks delivery: localStorage has a hard ~5-10MB per-origin
 * cap, and even one or two screenshots can blow past it. When the write
 * fails, `localStorage.setItem` throws — Dashboard.jsx only console.errors
 * it — so the message never actually reaches localStorage. It briefly
 * looks "sent" in the sender's own tab (React state already has it), but
 * the recipient's tab never receives it (no successful write means no
 * "storage" event, and a fresh load reads the old, unwritten localStorage).
 *
 * Fix: store the actual image/file bytes in IndexedDB instead (much larger
 * quota, and not part of the JSON blob written to localStorage at all).
 * Only a small `mediaId` reference lives inside the message/localStorage;
 * the real bytes are fetched from IndexedDB on demand when a message
 * bubble actually needs to render/download that file — see
 * `idbGetMessageMedia` and the `resolvedMediaUrls` cache in MessagesPage
 * below. Exported so any caller building attachments (ReportsPage.jsx,
 * etc.) can reuse the same storage.
 * ---------------------------------------------------------------------- */
const MESSAGE_MEDIA_DB_NAME = "hopenix_message_media_v1";
const MESSAGE_MEDIA_DB_STORE = "media";

let msgMediaDbPromise = null;

function openMessageMediaDB() {
  if (msgMediaDbPromise) return msgMediaDbPromise;
  msgMediaDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(MESSAGE_MEDIA_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MESSAGE_MEDIA_DB_STORE)) {
        req.result.createObjectStore(MESSAGE_MEDIA_DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      msgMediaDbPromise = null;
      reject(req.error || new Error("Could not open IndexedDB"));
    };
  });
  return msgMediaDbPromise;
}

function blobToArrayBuffer(blob) {
  if (!blob) return Promise.resolve(new ArrayBuffer(0));
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read blob as ArrayBuffer"));
    reader.readAsArrayBuffer(blob);
  });
}

export async function idbPutMessageMedia(id, blob) {
  try {
    const db = await openMessageMediaDB();
    const buffer = await blobToArrayBuffer(blob);
    const type = blob.type || "application/pdf";
    await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_MEDIA_DB_STORE, "readwrite");
      tx.objectStore(MESSAGE_MEDIA_DB_STORE).put({ buffer, type }, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || tx.db?.error || new Error("Write failed"));
    });
    return true;
  } catch (err) {
    console.error("Could not save message attachment to IndexedDB:", err);
    msgMediaDbPromise = null;
    return false;
  }
}

export async function idbGetMessageMedia(id) {
  try {
    const db = await openMessageMediaDB();
    const res = await new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGE_MEDIA_DB_STORE, "readonly");
      const req = tx.objectStore(MESSAGE_MEDIA_DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || tx.db?.error || new Error("Read failed"));
    });
    if (!res) return null;
    if (res instanceof Blob) return res;
    if (res.buffer) return new Blob([res.buffer], { type: res.type || "application/pdf" });
    return null;
  } catch {
    msgMediaDbPromise = null;
    return null;
  }
}

/**
 * Sends an admin message that originates from a daily-report row on the
 * Reports page (e.g. feedback on a submission, with one or more mistake
 * screenshots attached) straight into that employee's conversation thread —
 * using the exact same shared `conversations` / `setConversations` state
 * this page reads from, so it shows up on the Messages page immediately,
 * the same way sendAssistantMessage() does for the AI Assistant panel.
 *
 * Matches the conversation by employee id first (when a conversation
 * carries a `userId`/`employeeId` matching the report's `userId`), falling
 * back to a case-insensitive name match — same approach
 * resolveMessageTarget() uses for named targets. If no conversation exists
 * yet for that employee (e.g. they were just added and never messaged
 * before), one is created on the fly instead of failing, so "Send" always
 * works once a userId/userName is given.
 *
 * `attachments` is an optional array of { name, isImage, size, note, file }
 * (`file` being the raw File/Blob — preferred) or the older
 * { name, url, isImage, size, note } shape (a data: URL, kept working for
 * backward compatibility with any already-sent messages/callers). `note`
 * is an optional caption describing what's wrong in that specific
 * screenshot.
 *
 * Any attachment given as a raw `file`/`blob` has its bytes moved into
 * IndexedDB (via idbPutMessageMedia) BEFORE the message is built, so only
 * a small `mediaId` reference ends up in the message object that gets
 * saved to localStorage — see the big comment above idbPutMessageMedia
 * for why embedding the raw bytes there silently breaks delivery.
 *
 * The overall `text` is sent first as its own message, then each
 * attachment is sent as an image/file bubble immediately followed by its
 * own `note` as a text bubble right under it — so every screenshot's
 * mistake is anchored directly beneath that screenshot in the thread.
 *
 * This is now async (it awaits the IndexedDB writes) — callers must
 * `await` it. Returns true once the message (and/or attachments) has been
 * queued into a conversation — false only when there was nothing at all
 * to send.
 */
export async function sendReportMessage(conversations, setConversations, { userId, userName, userAvatar, userEmail, text, attachments } = {}) {
  const trimmedText = (text || "").trim();
  console.log("[BIRTHDAY DEBUG] sendReportMessage called:", { userId, userName, text, trimmedText });
  const rawAtts = Array.isArray(attachments) ? attachments : [];
  if (!trimmedText && rawAtts.length === 0) return false;

  // Resolve every attachment's storage location BEFORE building any
  // messages: a raw file/blob gets moved into IndexedDB (mediaId); an
  // already-legacy `url`-only attachment is passed through unchanged.
  const atts = [];
  for (const att of rawAtts) {
    const rawBlob = att.file || att.blob || null;
    if (rawBlob) {
      const mediaId = `msgmedia-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const stored = await idbPutMessageMedia(mediaId, rawBlob);
      atts.push(
        stored
          ? { name: att.name, size: att.size, isImage: att.isImage, note: att.note, mediaId }
          : { name: att.name, size: att.size, isImage: att.isImage, note: att.note, url: att.url }
      );
    } else {
      atts.push(att);
    }
  }

  // Every approved employee already has a 1:1 thread with Admin, keyed by
  // `authId` (see Dashboard.jsx's conversation-sync effect, which creates
  // one the moment a user is approved) — that's also the exact field the
  // employee's OWN view filters on (`c.authId === user?.id`), so matching
  // on it is what actually makes the message visible to them. Email is
  // checked next because Dashboard's own sync effect de-dupes contacts by
  // email too, so it's just as reliable an identity signal as authId.
  // `userId`/`employeeId` and the name fallback are kept only for older or
  // hand-built conversation objects that predate those fields.
  let conversation =
    conversations.find((c) => userId && c.authId != null && String(c.authId) === String(userId)) ||
    conversations.find(
      (c) => userId && ((c.userId != null && String(c.userId) === String(userId)) || (c.employeeId != null && String(c.employeeId) === String(userId)))
    ) ||
    conversations.find(
      (c) => userEmail && c.email && c.email.trim().toLowerCase() === userEmail.trim().toLowerCase()
    ) ||
    conversations.find(
      (c) => userName && c.name && c.name.trim().toLowerCase() === userName.trim().toLowerCase()
    ) ||
    conversations.find(
      (c) => userName && c.name && c.name.toLowerCase().includes(userName.toLowerCase())
    );

  const now = Date.now();
  const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const nowDate = todayDateKey();

  // No thread yet for this employee (freshly added user, never messaged
  // before) — create one instead of bailing out, so Send always works.
  // `authId: userId` is what makes this new thread actually show up on
  // the employee's own Messages page (see the note above). `email` is set
  // too — WITHOUT it, Dashboard.jsx's contact-sync effect (which de-dupes
  // by email) won't recognize this employee as already having a thread
  // and will create a SECOND conversation reusing the exact same
  // `auth-<id>` id, leaving two entries in the array under one id — the
  // empty duplicate can then shadow this one and make the message you
  // just sent appear to vanish. Setting email here closes that gap.
  const isNewConversation = !conversation;
  if (isNewConversation) {
    conversation = {
      id: userId ? `auth-${userId}` : `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      authId: userId || null,
      userId: userId || null,
      name: userName || "Employee",
      avatar: userAvatar || "",
      email: userEmail || "",
      isGroup: false,
      status: "Offline",
      messages: [],
      files: [],
      assignments: [],
      time: "",
      lastMessageAt: 0,
      lastMessageDate: "",
      unreadForUser: 0,
      unread: 0,
    };
  }

  function buildMessages(startId) {
    let nextId = startId;
    const built = [];
    if (trimmedText) {
      built.push({ id: nextId++, text: trimmedText, time: nowTime, date: nowDate, timestamp: now, outgoing: true, sender: "admin" });
    }
    atts.forEach((att) => {
      built.push({
        id: nextId++,
        file: {
          name: att.name,
          size: att.size,
          isImage: att.isImage,
          // Prefer the IndexedDB reference; only keep `url` inline when
          // there's no mediaId (legacy/no-IndexedDB fallback), see above.
          ...(att.mediaId ? { mediaId: att.mediaId } : { url: att.url }),
        },
        time: nowTime,
        date: nowDate,
        timestamp: now,
        outgoing: true,
        sender: "admin",
      });
      const noteText = (att.note || "").trim();
      if (noteText) {
        built.push({ id: nextId++, text: noteText, time: nowTime, date: nowDate, timestamp: now, outgoing: true, sender: "admin" });
      }
    });
    return built;
  }

  setConversations((prev) => {
    console.log("[BIRTHDAY DEBUG] prev has conversation?", prev.some((c) => c.id === conversation.id), "| conversation.id:", conversation.id, "| isNewConversation:", isNewConversation);
    const exists = prev.some((c) => c.id === conversation.id);
    const base = exists ? prev : [conversation, ...prev];
    const updated = base.map((c) => {
      if (c.id !== conversation.id) return c;
      const startId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
      return {
        ...c,
        time: nowTime,
        lastMessageAt: now,
        lastMessageDate: nowDate,
        unreadForUser: (c.unreadForUser || 0) + 1,
        messages: [...c.messages, ...buildMessages(startId)],
      };
    });
    const idx = updated.findIndex((c) => c.id === conversation.id);
    if (idx > 0) {
      const [moved] = updated.splice(idx, 1);
      updated.unshift(moved);
    }
    return updated;
  });

  return true;
}

/* Small initials/color helpers for rendering a group's member list (a
 * project group has no single photo, so each member gets a colored
 * initials circle instead — same look as the avatars on the Projects
 * page). */
const AVATAR_PALETTE = [
  "bg-rose-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-violet-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500",
];
function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// FIX (fictional auto DPs): people's/groups' "avatar" used to just be
// whatever URL landed in `avatar` — including the fictional stock-photo
// placeholders (e.g. i.pravatar.cc) seeded/auto-generated elsewhere in
// the app for anyone who never actually uploaded a real photo. Those
// aren't real photos of real people, so this page now only ever renders
// an <img> for a genuinely UPLOADED picture (a data: URL from the file
// picker here or on the Users/Employees page) — anything else falls back
// to the initials circle below, exactly like group members already get.
function isUploadedPhoto(avatar) {
  return typeof avatar === "string" && avatar.trim().length > 0;
}

function AvatarCircle({ name, avatar, sizeClass = "h-10 w-10", textSizeClass = "text-xs" }) {
  if (isUploadedPhoto(avatar)) {
    const src = avatar.includes("?v=") ? avatar : `${avatar}?v=${Date.now()}`;
    return <img src={src} alt={name} className={`${sizeClass} rounded-full object-cover`} />;
  }
  return (
    <div className={`flex ${sizeClass} items-center justify-center rounded-full font-bold text-white ${textSizeClass} ${avatarColor(name || "")}`}>
      {initials(name || "?")}
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/* WhatsApp-style date divider label: "Today", "Yesterday", or a full date
 * like "August 20, 2026" for anything older. Expects a "YYYY-MM-DD" key. */
function formatDateDivider(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  d.setHours(0, 0, 0, 0);

  if (d.getTime() === today.getTime()) return "Today";
  if (d.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

function todayDateKey() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/* WhatsApp/Slack-style LIVE relative timestamp: "Just now" → "12 sec ago"
 * → "3 min ago" → "2 hr ago", then once it crosses into a new calendar day
 * it settles into "Yesterday, 3:45 PM" or a full date. Falls back to the
 * plain `time` string for older seed messages that have no `timestamp`. */
function getRelativeTimeLabel({ timestamp, date, time }) {
  if (!timestamp) return time || "";

  const diffMs = Date.now() - timestamp;
  // Clamp to 0: guards against a message that was just saved to
  // localStorage on a slightly-ahead device clock, or restored right as
  // the millisecond ticks over, ever showing a negative "-1 sec ago".
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));

  if (diffSec < 5) return "Just now";
  if (diffSec < 60) return `${diffSec} sec ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  // More than a day old: switch to calendar-based labels.
  if (date) {
    const label = formatDateDivider(date); // "Yesterday" or "August 20, 2026"
    return time ? `${label}, ${time}` : label;
  }
  return time || "";
}

/* Shared across every VoicePlayer instance on the page: the <audio>
 * element that is currently playing, if any. Used so that starting
 * playback on one voice message automatically pauses any other voice
 * message that was already playing — only one plays at a time. */
let currentlyPlayingAudio = null;

/* Compact audio player used for both pending voice previews and sent voice
 * messages. Uses the native <audio> element for actual playback/decoding,
 * but drives its own play/pause button + timer for a consistent look. */
function VoicePlayer({ url, duration, outgoing, darkMode }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setCurrent(audio.currentTime);
    const onEnd = () => {
      setCurrent(0);
    };
    const onPlay = () => {
      // Enforce "only one voice message plays at a time": pause whatever
      // else was playing before letting this one start.
      if (currentlyPlayingAudio && currentlyPlayingAudio !== audio) {
        currentlyPlayingAudio.pause();
      }
      currentlyPlayingAudio = audio;
      setPlaying(true);
    };
    const onPause = () => {
      setPlaying(false);
      if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null;
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      if (currentlyPlayingAudio === audio) currentlyPlayingAudio = null;
    };
  }, []);

  function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  }

  const total = duration || 0;
  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <audio ref={audioRef} src={url} preload="metadata" className="hidden" />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          outgoing ? "bg-white/20 text-white" : darkMode ? "bg-slate-700 text-slate-200" : "bg-white text-violet-600"
        }`}
      >
        {playing ? <Pause size={12} /> : <Play size={12} className="ml-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`h-1.5 w-full overflow-hidden rounded-full ${outgoing ? "bg-white/25" : darkMode ? "bg-slate-600" : "bg-slate-200"}`}>
          <div className={`h-full rounded-full ${outgoing ? "bg-white" : "bg-violet-500"}`} style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span className={`shrink-0 text-[9.5px] tabular-nums ${outgoing ? "text-white/80" : darkMode ? "text-slate-400" : "text-slate-500"}`}>
        {formatDuration(playing || current > 0 ? current : total)}
      </span>
    </div>
  );
}

/* Small helper for dropdowns/menus that should close on outside click. */
function useOutsideClose(isOpen, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    if (isOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen, onClose]);
  return ref;
}

/* Auto-growing textarea hook: keeps the composer box tall enough to show
 * everything the user has typed (up to a max height, then it scrolls),
 * instead of a fixed single-line input that hides the text.
 *
 * FIX (tiny/collapsed box on mobile): on mobile the composer's wrapping
 * column is toggled between `hidden` and `flex` (list vs. chat view) —
 * the textarea itself is never unmounted, just display:none while hidden.
 * While hidden, scrollHeight reads as 0, so if this effect ran during that
 * time the box got stuck at ~0px height and never recovered until the
 * text itself changed. `visibleKey` lets the caller pass something that
 * changes when the composer actually becomes visible again (e.g. the
 * mobile list/chat toggle, or the active conversation id) so height gets
 * recalculated at that point too. */
function useAutoGrowTextarea(value, maxHeightPx = 120, visibleKey) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeightPx);
    el.style.height = `${next}px`;
  }, [value, maxHeightPx, visibleKey]);
  return ref;
}

/* -------------------------------------------------------------------------
 * FIX (mobile: info panel cut off with dead grey space below it):
 * The panel used to reserve mobile height with a guessed fixed offset
 * (`100dvh - 220px`), assuming a fixed pixel height for whatever header/nav
 * wraps this page. That guess didn't match the real app shell, leaving a
 * chunk of dead space below the panel instead of using the room that was
 * actually available — which then made the panel too short to show all of
 * its content (Conversation Info's "Quick Actions" section, in
 * particular).
 *
 * Instead of guessing a pixel number, this hook MEASURES how far down the
 * page the panel actually starts (`getBoundingClientRect().top`) and sizes
 * it to reach the real bottom of the visible viewport (using
 * `visualViewport` where available, since that correctly tracks the
 * on-screen keyboard and the mobile browser's address bar). This makes the
 * panel correct no matter what sits above it, and it re-measures on
 * resize/orientation change/keyboard open. Only applies below the `sm`
 * breakpoint — desktop/tablet keep their original fixed Tailwind sizing
 * untouched.
 * ---------------------------------------------------------------------- */
function useMobileFillHeight(bottomGapPx = 8) {
  const ref = useRef(null);
  const [height, setHeight] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const recalc = () => {
      const isDesktop = window.matchMedia("(min-width: 640px)").matches;
      if (isDesktop) {
        setHeight(null); // let the sm: Tailwind classes take over
        return;
      }
      const viewportH = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      const top = el.getBoundingClientRect().top;
      setHeight(Math.max(320, Math.round(viewportH - top - bottomGapPx)));
    };
    recalc();
    const vv = window.visualViewport;
    window.addEventListener("resize", recalc);
    window.addEventListener("orientationchange", recalc);
    vv?.addEventListener("resize", recalc);
    vv?.addEventListener("scroll", recalc);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("orientationchange", recalc);
      vv?.removeEventListener("resize", recalc);
      vv?.removeEventListener("scroll", recalc);
    };
  }, [bottomGapPx]);
  return [ref, height];
}

/* -------------------------------------------------------------------------
 * PROFILE VIEW MODAL — "View Profile" for the currently open conversation.
 * Mirrors the dedicated profile modals already on the Users page
 * (UserDetailModal) and Employees page (EmployeeDetailsModal): a centered
 * card, opened on demand, instead of the always-docked Conversation Info
 * sidebar this page already has. Only ever reads fields already present
 * on the conversation object passed down from Dashboard.jsx — it doesn't
 * fetch or assume any additional user/employee record, so it works the
 * same whether or not this person also has a linked account elsewhere.
 * ---------------------------------------------------------------------- */
function ProfileViewModal({ conversation, onClose, darkMode }) {
  if (!conversation) return null;
  const modalCard = darkMode ? "bg-slate-900 text-slate-100" : "bg-white";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const borderCol = darkMode ? "border-slate-800" : "border-slate-100";
  const hoverBg = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`w-full max-w-sm rounded-2xl p-5 shadow-2xl ${modalCard}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold">Profile</h2>
          <button onClick={onClose} className={subtleText} aria-label="Close profile view">
            <X size={16} />
          </button>
        </div>

        <div className="mb-5 flex flex-col items-center text-center">
          <div className="relative mb-3">
            {conversation.isGroup ? (
              isUploadedPhoto(conversation.avatar) ? (
                <img src={conversation.avatar} alt={conversation.name} className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                  <Users size={30} />
                </div>
              )
            ) : (
              <>
                <AvatarCircle name={conversation.name} avatar={conversation.avatar} sizeClass="h-20 w-20" textSizeClass="text-xl" />
                {conversation.status && (
                  <span
                    className={`absolute bottom-1 right-1 h-3.5 w-3.5 rounded-full ring-2 ring-white ${statusDot[conversation.status]}`}
                  />
                )}
              </>
            )}
          </div>
          <p className="text-sm font-bold">{conversation.name}</p>
          {conversation.role && <p className={`mt-0.5 text-[11px] ${mutedText}`}>{conversation.role}</p>}
          {!conversation.isGroup && conversation.status && (
            <span className={`mt-2 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${statusColor[conversation.status]}`}>
              {conversation.status}
            </span>
          )}
        </div>

        {conversation.isGroup ? (
          <div>
            <h3 className={`mb-2.5 text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>
              Members ({(conversation.members || []).length})
            </h3>
            <div className="max-h-56 space-y-2 overflow-y-auto">
              {(conversation.members || []).map((name) => (
                <div key={name} className="flex items-center gap-2.5">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(name)}`}>
                    {initials(name)}
                  </div>
                  <span className={`truncate text-[11px] ${mutedText}`}>{name}</span>
                </div>
              ))}
              {(conversation.members || []).length === 0 && (
                <p className={`text-[10.5px] ${subtleText}`}>No members yet.</p>
              )}
            </div>
          </div>
        ) : (
          <div className={`space-y-1 text-[11px] ${mutedText}`}>
            {conversation.email && (
              <a href={`mailto:${conversation.email}`} className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${hoverBg}`}>
                <Mail size={13} className={`shrink-0 ${subtleText}`} />
                <span className="truncate">{conversation.email}</span>
              </a>
            )}
            {conversation.phone && (
              <a href={`tel:${conversation.phone.replace(/\s+/g, "")}`} className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${hoverBg}`}>
                <Phone size={13} className={`shrink-0 ${subtleText}`} />
                <span>{conversation.phone}</span>
              </a>
            )}
            {conversation.location && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(conversation.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${hoverBg}`}
              >
                <MapPin size={13} className={`shrink-0 ${subtleText}`} />
                <span>{conversation.location}</span>
              </a>
            )}
            {!conversation.email && !conversation.phone && !conversation.location && (
              <p className={`text-[10.5px] ${subtleText}`}>No contact details on file.</p>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className={`mt-5 w-full rounded-full border py-2 text-xs font-semibold ${mutedText} ${
            darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
          }`}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * MessagesPage — drop-in content for Dashboard's <main>. Takes darkMode so
 * its cards/text match whatever theme Dashboard.jsx is currently using.
 * ---------------------------------------------------------------------- */
export default function MessagesPage({ darkMode, conversations, setConversations, isPrivilegedViewer = true, viewerId = null }) {
  const { user: currentUser } = useAuth();
  // Websocket connection + live call state/controls now live app-wide in
  // MessagingSocketProvider (mounted once in Dashboard.jsx) instead of
  // inside this page — see that file for why (presence/incoming calls
  // used to die the moment you navigated away from Messages).
  const { activeCall, callSeconds, callMuted, subscribe, startCall, acceptCall, rejectCall, endCall, toggleMute } =
    useMessagingSocket();
  const [activeId, setActiveId] = useState(conversations[0]?.id || null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [draft, setDraft] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [mobileView, setMobileView] = useState("list"); // "list" | "chat"
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileViewOpen, setProfileViewOpen] = useState(false); // "View Profile" modal for the active conversation
  const [confirmTarget, setConfirmTarget] = useState(null); // { type: 'conversation'|'message', id, label }
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [showAllAssignments, setShowAllAssignments] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [taskName, setTaskName] = useState("");
  const [toast, setToast] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState([]);

  // Turn any queued "it's so-and-so's birthday today" entry (written by
  // BirthdayCelebration.jsx on the employee dashboard) into a real message
  // in that employee's thread, then mark it delivered so it never goes out twice.
  useEffect(() => {
    const pending = getPendingEmployeeBirthdayMessages();
    if (pending.length === 0) return;
    pending.forEach((msg) => {
      if (!isBirthdayMessageAlreadyInConversations(conversations, msg.userId, msg.dateKey)) {
        sendReportMessage(conversations, setConversations, {
          userId: msg.userId,
          userName: msg.name,
          text: msg.text,
        });
      }
      markBirthdayMessageDelivered(msg.userId, msg.dateKey);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micError, setMicError] = useState("");
  const [broadcastMode, setBroadcastMode] = useState(false); // explicit "send to all" toggle
  const [, setLiveTick] = useState(0); // forces a re-render every second so "X sec/min ago" labels stay live
  // Group conversations only: editing the group's display name and photo
  // (see the "Group photo / name" block in the info panel below).
  const [editingGroupName, setEditingGroupName] = useState(false);
  const [groupNameDraft, setGroupNameDraft] = useState("");

  const scrollRef = useRef(null);
  const fileInputRef = useRef(null);
  const groupPhotoInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const recordingActionRef = useRef("confirm"); // "confirm" | "cancel"
  const recordingSecondsRef = useRef(0);

  // Per-conversation "Missed call" / "Call ended · 3:12" history strip —
  // still fetched here (REST, scoped to whichever thread is open). The
  // live call itself (websocket, WebRTC, the ringing/active overlay) is
  // owned by MessagingSocketProvider now — see the useMessagingSocket()
  // call above.
  const [callHistory, setCallHistory] = useState([]);

  const [apiConversations, setApiConversations] = useState([]);
  const [apiThread, setApiThread] = useState([]);
  // Captured once per conversation-open (see loadActiveThread below), so a
  // "2 unread messages" divider can be shown once — like WhatsApp — instead
  // of recomputing live off `is_read`, which flips to true as soon as
  // markThreadRead() resolves.
  const [unreadMarkerCount, setUnreadMarkerCount] = useState(0);
  const [firstUnreadMessageId, setFirstUnreadMessageId] = useState(null);
  const unreadDividerRef = useRef(null);
  const [loadingConversations, setLoadingConversations] = useState(true);

  const loadApiConversations = useCallback(async () => {
    try {
      const list = await fetchConversations();
      if (Array.isArray(list)) {
        setApiConversations(list);
      }
    } catch (err) {
      console.error("Could not fetch conversations:", err);
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    loadApiConversations();
  }, [loadApiConversations]);

  const effectiveConversations = useMemo(() => {
    if (apiConversations.length > 0) {
      return apiConversations.map((c) => ({
        id: c.id,
        otherUserId: c.otherUser?.id,
        name: c.name || c.otherUser?.name || "User",
        email: c.otherUser?.email || "",
        avatar: c.otherUser?.avatar || c.avatar || "",
        status: c.otherUser?.status || "Active",
        role: c.otherUser?.role || "employee",
        department: c.otherUser?.department || "",
        unread: c.unreadCount || 0,
        time: c.updatedAt ? new Date(c.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "",
        lastMessageAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
        // The sidebar preview ("hi", "🎤 Voice message", etc.) reads this,
        // NOT `messages` below — `messages` is always [] here because the
        // actual thread only gets fetched once a conversation is opened
        // (see loadActiveThread/apiThread). Without this field the sidebar
        // had no way to know the last message and always fell back to
        // "No messages yet", even for conversations with plenty of history.
        lastMessage: c.lastMessage || null,
        messages: [],
        files: [],
        assignments: [],
        phone: c.otherUser?.phone || "",
        location: c.otherUser?.location || "",
        otherUser: c.otherUser,
      }));
    }
    return conversations || [];
  }, [apiConversations, conversations]);

  const active = effectiveConversations.find((c) => c.id === activeId) || effectiveConversations[0] || null;
  const activePartnerId = active?.otherUserId;

  const messagesToRender = useMemo(() => {
    if (apiThread && apiThread.length > 0) {
      return apiThread.map((m) => {
        const createdDate = m.createdAt ? new Date(m.createdAt) : null;
        const timeStr = createdDate ? createdDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
        const dateStr = createdDate ? createdDate.toISOString().split("T")[0] : "";
        const isImg = m.attachmentUrl ? /\.(png|jpe?g|gif|webp|svg)($|\?)/i.test(m.attachmentUrl) : false;
        // Use the backend's own isMine flag (it already compares sender_id to
        // request.user.id server-side) instead of re-comparing ids here —
        // currentUser?.id can be a string while m.senderId is a number, so
        // `m.senderId === currentUser?.id` silently fails and every message
        // renders as incoming.
        const isOutgoing = typeof m.isMine === "boolean" ? m.isMine : m.senderId === currentUser?.id;
        return {
          id: m.id,
          sender: m.senderName || "User",
          senderId: m.senderId,
          recipientId: m.recipientId,
          text: m.text,
          time: timeStr,
          date: dateStr,
          ts: createdDate ? createdDate.getTime() : null,
          outgoing: isOutgoing,
          isMine: isOutgoing,
          file: m.attachmentUrl
            ? {
                name: m.attachmentName || m.attachmentUrl.split("/").pop(),
                size: m.attachmentSize ? `${(m.attachmentSize / 1024).toFixed(1)} KB` : "File",
                url: m.attachmentUrl,
                isImage: isImg,
              }
            : null,
          is_read: m.is_read,
        };
      });
    }
    return active?.messages || [];
  }, [apiThread, active?.messages, currentUser?.id, isPrivilegedViewer]);

  // Messages + calls, merged into one chronological timeline (like WhatsApp
  // shows "Missed call" inline where it actually happened, instead of a
  // banner pinned above the thread that's always for the MOST RECENT call
  // regardless of how long ago it was). Only finished calls are included —
  // an in-progress ringing/ongoing call has its own UI elsewhere.
  const timelineItems = useMemo(() => {
    const msgItems = messagesToRender.map((m, idx) => ({ kind: "message", data: m, ts: m.ts ?? null, idx }));
    // Mock/local conversations don't carry real timestamps on their
    // messages, so there's no reliable way to interleave calls among them
    // — just render the messages as-is rather than risk misplacing (or
    // dropping) any of them.
    if (msgItems.some((it) => it.ts == null)) return msgItems;

    const callItems = (callHistory || [])
      .filter((c) => c.status !== "ongoing" && c.status !== "ringing")
      .map((c, idx) => ({
        kind: "call",
        data: c,
        ts: c.startedAt ? new Date(c.startedAt).getTime() : null,
        idx: msgItems.length + idx,
      }))
      .filter((it) => it.ts !== null);

    return [...msgItems, ...callItems].sort((a, b) => a.ts - b.ts || a.idx - b.idx);
  }, [messagesToRender, callHistory]);

  const loadActiveThread = useCallback(async (userId) => {
    if (!userId) return;
    try {
      const msgs = await fetchThread(userId);
      // Snapshot "unread at the moment this chat was opened" BEFORE
      // markThreadRead() below flips them server-side — otherwise there's
      // nothing left to show a divider for by the time we render.
      const firstUnread = (msgs || []).find((m) => !m.isMine && !m.is_read);
      setFirstUnreadMessageId(firstUnread ? firstUnread.id : null);
      setUnreadMarkerCount((msgs || []).filter((m) => !m.isMine && !m.is_read).length);
      setApiThread(msgs || []);
      await markThreadRead(userId);
    } catch (err) {
      console.error("Could not fetch thread:", err);
    }
  }, []);

  useEffect(() => {
    if (activePartnerId) {
      loadActiveThread(activePartnerId);
    } else {
      setApiThread([]);
      setFirstUnreadMessageId(null);
      setUnreadMarkerCount(0);
    }
  }, [activePartnerId, loadActiveThread]);

  // Always-current copy of activePartnerId for the websocket handler
  // below, so that effect can be set up ONCE on mount (no reconnect on
  // every conversation switch) while still knowing which thread is open.
  const activePartnerIdRef = useRef(null);
  useEffect(() => {
    activePartnerIdRef.current = activePartnerId;
  }, [activePartnerId]);

  const refreshCallHistory = useCallback(() => {
    const partnerId = activePartnerIdRef.current;
    if (!partnerId) return;
    apiFetchCallHistory(partnerId).then((rows) => setCallHistory(rows || [])).catch(() => {});
  }, []);

  // --- Real-time push (websocket) ---------------------------------------
  // The socket connection itself now lives in MessagingSocketProvider
  // (mounted once in Dashboard.jsx — see that file for why), so this page
  // just subscribes to whatever comes through it: "message.new" /
  // "thread.read" events (to refresh the conversation list / open
  // thread), and any call.* event (just to refresh the small per-thread
  // call-history strip below — the call itself is fully handled by the
  // provider). If the socket is down for any reason, the 20s REST poll
  // further down still keeps everything eventually consistent.
  useEffect(() => {
    return subscribe((data) => {
      if (typeof data.type === "string" && data.type.startsWith("call.")) {
        refreshCallHistory();
        return;
      }
      if (data.type !== "message.new" && data.type !== "thread.read") return;

      loadApiConversations();

      const partnerId = activePartnerIdRef.current;
      const involvesOpenThread =
        partnerId &&
        (data.sender_id === partnerId || data.recipient_id === partnerId || data.read_by_user_id === partnerId);
      if (involvesOpenThread) {
        fetchThread(partnerId).then((msgs) => setApiThread(msgs || [])).catch(() => {});
      }
    });
  }, [subscribe, loadApiConversations, refreshCallHistory]);

  // Fetch call history whenever the open conversation changes, for the
  // small "Missed call" / "Call ended · 3:12" strip in the chat header.
  useEffect(() => {
    if (activePartnerId) refreshCallHistory();
    else setCallHistory([]);
  }, [activePartnerId, refreshCallHistory]);


  function formatCallDuration(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  useEffect(() => {
    // Fallback poll — slower now that the websocket above handles the
    // instant path. Kept running so nothing depends on the socket alone.
    const timer = setInterval(() => {
      loadApiConversations();
      if (activePartnerId) {
        fetchThread(activePartnerId).then((msgs) => setApiThread(msgs || [])).catch(() => {});
      }
    }, 20000);
    return () => clearInterval(timer);
  }, [loadApiConversations, activePartnerId]);

  /* ---------------------------------------------------------------------
   * Resolve message attachments stored in IndexedDB (m.file.mediaId) into
   * short-lived blob: object URLs for <img>/download use — see the big
   * comment above idbPutMessageMedia for why attachments are stored there
   * instead of inline. Cached by mediaId so each one is only fetched once;
   * re-runs whenever the open conversation (or its message count) changes,
   * so newly-arrived image messages get resolved too. Older messages that
   * still carry a plain `url` (sent before this change) keep working via
   * fileUrlFor's fallback below — nothing needs migrating.
   * ------------------------------------------------------------------- */
  const [resolvedMediaUrls, setResolvedMediaUrls] = useState({});
  const resolvedMediaUrlsRef = useRef({});
  resolvedMediaUrlsRef.current = resolvedMediaUrls;

  useEffect(() => {
    if (!active) return;
    const pendingIds = (active.messages || [])
      .map((m) => m.file?.mediaId)
      .filter((id) => id && !resolvedMediaUrlsRef.current[id]);
    if (!pendingIds.length) return;
    let cancelled = false;
    (async () => {
      const updates = {};
      for (const id of pendingIds) {
        const blob = await idbGetMessageMedia(id);
        if (blob) updates[id] = URL.createObjectURL(blob);
      }
      if (!cancelled && Object.keys(updates).length) {
        setResolvedMediaUrls((prev) => ({ ...prev, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, active?.messages?.length]);

  // Revoke every generated object URL when the page unmounts.
  useEffect(() => {
    return () => {
      Object.values(resolvedMediaUrlsRef.current).forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  function fileUrlFor(file) {
    if (!file) return null;
    return file.mediaId ? resolvedMediaUrls[file.mediaId] : file.url;
  }

  /* Message DIRECTION is relative to WHO'S LOOKING, not a fixed "admin
   * always sent the outgoing ones" assumption. `sender` ("admin" | "user")
   * records who actually wrote a message; `outgoing` (legacy, still used
   * by older/seed messages that have no `sender`) is treated as "an admin
   * wrote this". A privileged viewer (admin/manager) sees admin-authored
   * messages as their own (right side); anyone else sees their OWN
   * messages as theirs and admin's messages as incoming (left side) —
   * exactly like a normal two-person chat, no matter who's logged in. */
  function resolveSender(m) {
    return m.sender || (m.outgoing ? "admin" : "user");
  }
  /* Peer conversations (a direct chat between two non-admin users, see
   * `peerAuthIds` on the conversation object built in Dashboard.jsx) don't
   * fit the "admin"/"user" binary at all — either side could be either
   * role. For those, `sender` stores the actual authId of whoever wrote
   * the message, so direction is just "does it match MY id". Every other
   * conversation type (the admin 1:1 thread, groups) keeps the original
   * binary behaviour untouched. */
  function isOutgoingForViewer(m, conv) {
    const sender = resolveSender(m);
    if (conv && conv.peerAuthIds) return sender === viewerId;
    return isPrivilegedViewer ? sender === "admin" : sender === "user";
  }
  function viewerSenderFor(conv) {
    return conv && conv.peerAuthIds ? viewerId : isPrivilegedViewer ? "admin" : "user";
  }
  /* How many unread messages THIS viewer has in a given conversation. Peer
   * conversations (two non-admin users chatting directly) can't use the
   * single `unread`/`unreadForUser` split — both sides are "non-privileged"
   * — so they track counts per-participant in `unreadFor` instead. */
  function unreadCountFor(conv) {
    if (conv.peerAuthIds) return (conv.unreadFor && conv.unreadFor[viewerId]) || 0;
    return isPrivilegedViewer ? conv.unread || 0 : conv.unreadForUser || 0;
  }

  const emojiRef = useOutsideClose(emojiOpen, () => setEmojiOpen(false));
  const filterRef = useOutsideClose(filterOpen, () => setFilterOpen(false));
  const menuRef = useOutsideClose(menuOpen, () => setMenuOpen(false));
  const draftRef = useAutoGrowTextarea(draft, 120, `${mobileView}:${activeId}`);
  const [panelRef, mobilePanelHeight] = useMobileFillHeight(8);

  useEffect(() => {
    // Land on the "X unread messages" divider when one was just captured
    // for this conversation-open (WhatsApp-style); otherwise jump straight
    // to the latest message. Was previously keyed off `active?.messages?.length`,
    // which only exists for the old mock data — for real API threads that
    // value never changes, so this fired once (before the thread had even
    // loaded) and never again, leaving the view stuck at the top.
    if (unreadDividerRef.current) {
      unreadDividerRef.current.scrollIntoView({ block: "start" });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeId, timelineItems.length, unreadMarkerCount]);

  // If the active conversation was removed elsewhere (or none was selected
  // yet), fall back to the first available conversation.
  useEffect(() => {
    if (!effectiveConversations.some((c) => c.id === activeId)) {
      setActiveId(effectiveConversations[0]?.id || null);
    }
  }, [effectiveConversations, activeId]);

  useEffect(() => {
    setShowAllFiles(false);
    setShowAllAssignments(false);
    setAddingTask(false);
    setTaskName("");
    setPendingAttachments([]);
    setProfileViewOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  // Release the microphone if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Ticks once a second so message/list timestamps like "12 sec ago" keep
  // counting up live, the same way WhatsApp/Slack timestamps do. Browsers
  // throttle setInterval on hidden/background tabs, so a label can be
  // stale by the time you switch back — the visibilitychange listener
  // forces one extra immediate refresh right when the tab becomes active
  // again, so times like "2 hr ago" are always correct, not lagged.
  useEffect(() => {
    const id = setInterval(() => setLiveTick((t) => t + 1), 1000);
    function handleVisibility() {
      if (document.visibilityState === "visible") setLiveTick((t) => t + 1);
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const inputBg = darkMode ? "bg-slate-800" : "bg-slate-50";
  const borderCol = darkMode ? "border-slate-800" : "border-slate-100";
  const hoverBg = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";

  const filtered = (effectiveConversations || [])
    .filter(
      (c) =>
        (c.name || "").toLowerCase().includes((query || "").toLowerCase()) &&
        (statusFilter === "All" || c.status === statusFilter)
    )
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0));

  function openConversation(id) {
    setActiveId(id);
    setMobileView("chat");
    setInfoOpen(false);
    setEmojiOpen(false);
    setMenuOpen(false);
    setEditingGroupName(false);
    // `unread` = unread count FOR the admin/privileged side of this thread,
    // `unreadForUser` = unread count for the other (non-admin) party. Only
    // clear the one that belongs to whoever is actually looking right now
    // — otherwise an employee opening their own chat would also wipe the
    // admin's separate "you have an unread message" badge, and vice versa.
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (c.peerAuthIds) {
          return { ...c, unreadFor: { ...(c.unreadFor || {}), [viewerId]: 0 } };
        }
        return { ...c, ...(isPrivilegedViewer ? { unread: 0 } : { unreadForUser: 0 }) };
      })
    );
  }

  /* Appends a message to the active conversation AND moves that
   * conversation to the top of the list with the current real timestamp,
   * so the sidebar always reflects who you just talked to — in real time,
   * the same way WhatsApp/Slack move the active thread to the top. */
  function appendMessage(message) {
    setConversations((prev) => {
      const now = Date.now();
      const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const nowDate = todayDateKey();
      const updated = prev.map((c) => {
        if (c.id !== activeId) return c;
        // Whoever is sending this (viewerSenderFor) is NOT who needs
        // notifying — the OTHER party does. Bump their counter so their
        // sidebar picks up a red dot for this new message. Peer
        // conversations (direct chats between two non-admin users) track
        // this per-participant via `unreadFor`, since neither side is
        // "admin"/"user".
        const unreadPatch = c.peerAuthIds
          ? {
              unreadFor: {
                ...(c.unreadFor || {}),
                [c.peerAuthIds.find((id) => id !== viewerId)]:
                  ((c.unreadFor || {})[c.peerAuthIds.find((id) => id !== viewerId)] || 0) + 1,
              },
            }
          : isPrivilegedViewer
          ? { unreadForUser: (c.unreadForUser || 0) + 1 }
          : { unread: (c.unread || 0) + 1 };
        return {
          ...c,
          time: nowTime,
          lastMessageAt: now,
          lastMessageDate: nowDate,
          ...unreadPatch,
          messages: [
            ...c.messages,
            {
              id: (c.messages[c.messages.length - 1]?.id || 0) + 1,
              time: nowTime,
              date: nowDate,
              timestamp: now,
              outgoing: true,
              sender: viewerSenderFor(c),
              ...message,
            },
          ],
        };
      });
      const idx = updated.findIndex((c) => c.id === activeId);
      if (idx > 0) {
        const [moved] = updated.splice(idx, 1);
        updated.unshift(moved);
      }
      return updated;
    });
  }

  /* Sends the given text + any pending attachments to EVERY conversation.
   * Used both by the explicit "Send to all members" toggle and by typed
   * commands like "send to all: ..." / "sab ko bhej do ...". */
  function sendToAll(text, attachments) {
    if (!text && attachments.length === 0) return;
    const now = Date.now();
    const nowTime = new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const nowDate = todayDateKey();

    setConversations((prev) =>
      prev.map((c) => {
        let nextId = (c.messages[c.messages.length - 1]?.id || 0) + 1;
        const newMsgs = [...c.messages];
        const senderForC = viewerSenderFor(c);

        if (text) {
          newMsgs.push({ id: nextId++, text, time: nowTime, date: nowDate, timestamp: now, outgoing: true, sender: senderForC });
        }
        attachments.forEach((att) => {
          const payload =
            att.kind === "voice"
              ? { voice: { url: att.url, duration: att.duration } }
              : { file: { name: att.name, size: att.size, url: att.url, isImage: att.isImage } };
          newMsgs.push({ id: nextId++, time: nowTime, date: nowDate, timestamp: now, outgoing: true, sender: senderForC, ...payload });
        });

        // Same "notify the other party, not yourself" rule as appendMessage.
        const unreadPatch = c.peerAuthIds
          ? {
              unreadFor: {
                ...(c.unreadFor || {}),
                [c.peerAuthIds.find((id) => id !== viewerId)]:
                  ((c.unreadFor || {})[c.peerAuthIds.find((id) => id !== viewerId)] || 0) + 1,
              },
            }
          : isPrivilegedViewer
          ? { unreadForUser: (c.unreadForUser || 0) + 1 }
          : { unread: (c.unread || 0) + 1 };

        return {
          ...c,
          messages: newMsgs,
          time: nowTime,
          lastMessageAt: now,
          lastMessageDate: nowDate,
          ...unreadPatch,
        };
      })
    );

    setToast(`Message sent to all ${conversations.length} members`);
  }

  async function sendMessage() {
    const raw = draft.trim();
    if (!raw && pendingAttachments.length === 0) return;

    if (activePartnerId) {
      const fileToUpload = pendingAttachments.find((a) => a.rawFile)?.rawFile || null;
      try {
        await apiSendMessage({
          recipientId: activePartnerId,
          text: raw,
          attachment: fileToUpload,
        });
        setDraft("");
        setPendingAttachments([]);
        await loadActiveThread(activePartnerId);
        await loadApiConversations();
        return;
      } catch (err) {
        console.error("Failed to send message via API:", err);
      }
    }

    const { isBroadcast, message } = parseCommand(raw);
    const shouldBroadcastAll = isBroadcast || broadcastMode;
    const finalText = isBroadcast ? message : raw;

    if (shouldBroadcastAll) {
      sendToAll(finalText, pendingAttachments);
    } else {
      if (finalText) appendMessage({ text: finalText });
      pendingAttachments.forEach((att) => {
        if (att.kind === "voice") {
          appendMessage({ voice: { url: att.url, duration: att.duration } });
        } else {
          appendMessage({ file: { name: att.name, size: att.size, url: att.url, isImage: att.isImage } });
        }
      });
    }

    setDraft("");
    setPendingAttachments([]);
  }

  function handleEmojiSelect(emoji) {
    setDraft((prev) => prev + emoji);
  }

  function handleFileButtonClick() {
    fileInputRef.current?.click();
  }

  function handleFilesChosen(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    files.forEach((file) => {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const isImage = file.type.startsWith("image/");
      const size = formatBytes(file.size);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPendingAttachments((prev) => [
          ...prev,
          { id, kind: "file", name: file.name, size, url: reader.result, isImage, rawFile: file },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }

  /* Group photo — reads the chosen image as a data URL (same reasoning as
     handleFilesChosen above: object URLs die on reload, data URLs don't)
     and saves it straight onto the group's conversation record. */
  function handleGroupPhotoChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !active?.isGroup) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const nextAvatar = reader.result;
      setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, avatar: nextAvatar } : c)));
    };
    reader.readAsDataURL(file);
  }

  function startEditGroupName() {
    if (!active?.isGroup) return;
    setGroupNameDraft(active.name);
    setEditingGroupName(true);
  }

  function saveGroupName() {
    const next = groupNameDraft.trim();
    if (active?.isGroup && next && next !== active.name) {
      setConversations((prev) => prev.map((c) => (c.id === active.id ? { ...c, name: next } : c)));
    }
    setEditingGroupName(false);
  }

  function removePendingAttachment(id) {
    setPendingAttachments((prev) => {
      const target = prev.find((a) => a.id === id);
      // Voice recordings are now data: URLs (see startRecording), which
      // don't need revoking and aren't valid input for revokeObjectURL —
      // only file attachments still use real blob: object URLs.
      if (target && target.url && target.url.startsWith("blob:")) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((a) => a.id !== id);
    });
  }

  async function startRecording() {
    setMicError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      audioChunksRef.current = [];
      recordingActionRef.current = "confirm";

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        clearInterval(timerRef.current);

        if (recordingActionRef.current === "confirm" && audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" });
          // Convert to a base64 data URL instead of a blob: object URL.
          // Object URLs only live for the current page session — once the
          // conversations list is saved to localStorage and the page is
          // reloaded (or reopened "next day"), the blob URL is dead and the
          // voice note silently fails to play. A data URL is just text, so
          // it survives being saved/restored from localStorage and keeps
          // working forever.
          const reader = new FileReader();
          reader.onloadend = () => {
            setPendingAttachments((prev) => [
              ...prev,
              {
                id: `voice-${Date.now()}`,
                kind: "voice",
                url: reader.result,
                duration: recordingSecondsRef.current,
              },
            ]);
          };
          reader.readAsDataURL(blob);
        }
        setIsRecording(false);
        setRecordingSeconds(0);
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          recordingSecondsRef.current = s + 1;
          return s + 1;
        });
      }, 1000);
    } catch (err) {
      setMicError("Microphone access denied. Please allow mic permissions to record a voice message.");
    }
  }

  function stopRecording(action) {
    recordingActionRef.current = action;
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  // Converts a persisted base64 data: URL back into a short-lived blob:
  // object URL. Browsers block navigating a new tab straight to a data:
  // URL (it silently opens a blank page — this is what was happening for
  // PDF previews), but they're fine opening a blob: URL, which is what
  // window.open needs for the built-in PDF/image viewer to actually
  // render the file. Only used at the moment of preview — the stored
  // attachment itself stays a data: URL so it keeps working after reload.
  function dataUrlToViewableUrl(dataUrl) {
    try {
      const [header, base64] = dataUrl.split(",");
      const mimeMatch = header.match(/data:(.*);base64/);
      const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      return URL.createObjectURL(blob);
    } catch (err) {
      console.error("Could not prepare file for preview:", err);
      return dataUrl;
    }
  }

  function viewFile(url) {
    const isDataUrl = typeof url === "string" && url.startsWith("data:");
    const openUrl = isDataUrl ? dataUrlToViewableUrl(url) : url;
    window.open(openUrl, "_blank", "noopener,noreferrer");
    // Give the new tab a minute to finish loading the file before freeing
    // the temporary blob URL.
    if (isDataUrl) setTimeout(() => URL.revokeObjectURL(openUrl), 60000);
  }

  function requestDeleteMessage(messageId) {
    setConfirmTarget({ type: "message", id: messageId, label: "this message" });
  }

  function requestDeleteConversation(convo) {
    setMenuOpen(false);
    setConfirmTarget({ type: "conversation", id: convo.id, label: `your conversation with ${convo.name}` });
  }

  function confirmDelete() {
    if (!confirmTarget) return;
    if (confirmTarget.type === "message") {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId ? { ...c, messages: c.messages.filter((m) => m.id !== confirmTarget.id) } : c
        )
      );
    } else if (confirmTarget.type === "conversation") {
      setConversations((prev) => {
        const next = prev.filter((c) => c.id !== confirmTarget.id);
        if (confirmTarget.id === activeId) {
          setActiveId(next[0]?.id || null);
          setMobileView("list");
        }
        return next;
      });
      setToast("Conversation deleted");
    }
    setConfirmTarget(null);
  }

  function addTask() {
    const name = taskName.trim();
    if (!name) return;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? { ...c, assignments: [...c.assignments, { name, status: "In Progress" }] }
          : c
      )
    );
    appendMessage({
      text: `📋 New task assigned: "${name}"\nStatus: In Progress\nAssigned to: ${active?.name || ""}`,
    });
    setTaskName("");
    setAddingTask(false);
    setShowAllAssignments(true);
    setToast("Task created and sent in chat");
  }

  function gmailComposeUrl(convo) {
    const subject = `Message from Hopenix`;
    const body = `Hi ${convo?.name || ""},\n\n`;
    return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(convo?.email || "")}&su=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(body)}`;
  }

  const visibleFiles = active ? (showAllFiles ? (active.files || []) : (active.files || []).slice(0, 2)) : [];
  const visibleAssignments = active
    ? showAllAssignments
      ? (active.assignments || [])
      : (active.assignments || []).slice(0, 2)
    : [];

  return (
    <div
      ref={panelRef}
      style={mobilePanelHeight != null ? { height: mobilePanelHeight } : undefined}
      className={`relative min-h-[320px] overflow-hidden rounded-xl shadow-sm sm:h-[calc(100vh-160px)] sm:min-h-[480px] ${card}`}
    >
      {/* See useMobileFillHeight above for why mobile height is measured in
          JS instead of a guessed `calc(100dvh - Npx)` — that guess didn't
          match this app's real header height and left dead space below the
          panel instead of using it, which cut off content like the info
          panel's "Quick Actions" section. Desktop/tablet (sm+) keeps the
          original fixed Tailwind sizing untouched. */}
      {toast && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex justify-center px-2">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
            <Check size={12} className="text-emerald-400" />
            {toast}
          </div>
        </div>
      )}

      {/* Call overlay (incoming/outgoing/connecting/active) now renders
          app-wide from MessagingSocketProvider (Dashboard.jsx), not here —
          so it still shows up even when this page isn't the open tab. */}


      {profileViewOpen && active && (
        <ProfileViewModal conversation={active} onClose={() => setProfileViewOpen(false)} darkMode={darkMode} />
      )}

      {/* Delete confirmation modal */}
      {confirmTarget && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className={`w-full max-w-xs rounded-xl p-4 shadow-xl ${card}`}>
            <p className={`mb-1 text-xs font-semibold ${cardText}`}>
              Delete {confirmTarget.type === "conversation" ? "conversation?" : "message?"}
            </p>
            <p className={`mb-4 text-[11px] ${mutedText}`}>
              This will permanently delete {confirmTarget.label}. This action can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmTarget(null)}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-medium ${mutedText} ${
                  darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                Cancel
              </button>
              <button onClick={confirmDelete} className="rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-rose-700">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex h-full">
        {/* Conversation list */}
        <div
          className={`w-full sm:w-72 md:w-80 shrink-0 border-r ${borderCol} flex-col ${
            mobileView === "list" ? "flex" : "hidden"
          } sm:flex`}
        >
          <div className={`flex items-center gap-2 p-3 border-b ${borderCol}`}>
            <div className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 ${inputBg}`}>
              <Search size={14} className={subtleText} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations..."
                className={`w-full min-w-0 bg-transparent text-xs outline-none placeholder:text-slate-400 ${cardText}`}
              />
              {query && (
                <button onClick={() => setQuery("")} className={subtleText} aria-label="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="relative shrink-0" ref={filterRef}>
              <button
                onClick={() => setFilterOpen((v) => !v)}
                className={`relative rounded-lg border p-2 ${mutedText} ${darkMode ? "border-slate-700" : "border-slate-200"} ${hoverBg}`}
                aria-label="Filter conversations"
                title="Filter"
              >
                <Filter size={14} />
                {statusFilter !== "All" && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-violet-600" />}
              </button>
              {filterOpen && (
                <div className={`absolute right-0 top-10 z-40 w-40 rounded-xl border p-1.5 shadow-lg ${card} ${borderCol}`}>
                  <p className={`px-2 pb-1 pt-0.5 text-[9.5px] font-bold uppercase tracking-wide ${subtleText}`}>Filter by status</p>
                  {STATUS_FILTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setStatusFilter(s);
                        setFilterOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] ${hoverBg} ${
                        statusFilter === s ? "font-semibold text-violet-600" : mutedText
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {s !== "All" && <span className={`h-1.5 w-1.5 rounded-full ${statusDot[s]}`} />}
                        {s}
                      </span>
                      {statusFilter === s && <Check size={12} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingConversations ? (
              <div className="p-6 text-center">
                <p className={`text-xs font-medium ${subtleText}`}>Loading conversations...</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center">
                <p className={`text-xs font-medium ${cardText}`}>No conversations found</p>
                <p className={`mt-1 text-[10.5px] ${subtleText}`}>Try a different name or status filter.</p>
              </div>
            ) : (
              filtered.map((c) => {
                const statusStr = c.status || "Active";
                // Prefer the backend-computed lastMessage (real conversations
                // fetched from the API — see effectiveConversations above);
                // fall back to the local mock `messages` array only for the
                // legacy/offline conversations path, where lastMessage is
                // never set at all.
                const msgsList = c.messages || [];
                const lastMsg = c.lastMessage
                  ? {
                      text: c.lastMessage.text,
                      voice: c.lastMessage.kind === "voice",
                      file: c.lastMessage.kind === "file" || c.lastMessage.kind === "image",
                    }
                  : msgsList[msgsList.length - 1];
                return (
                  <div
                    key={c.id}
                    className={`group flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors ${borderCol} ${hoverBg} ${
                      c.id === activeId ? (darkMode ? "bg-violet-900/20" : "bg-violet-50/60") : ""
                    }`}
                  >
                    <div className="relative shrink-0">
                      <button onClick={() => openConversation(c.id)} aria-label={c.isGroup ? `Open ${c.name || "Group"} chat` : `Open chat with ${c.name || "User"}`} title={c.name || "User"}>
                        {c.isGroup ? (
                          isUploadedPhoto(c.avatar) ? (
                            <img src={c.avatar} alt={c.name || "Group"} className="h-10 w-10 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                              <Users size={17} />
                            </div>
                          )
                        ) : (
                          <AvatarCircle name={c.name || "User"} avatar={c.avatar} sizeClass="h-10 w-10" textSizeClass="text-xs" />
                        )}
                      </button>
                      {!c.isGroup && (
                        <button
                          onClick={() => openConversation(c.id)}
                          aria-label={`${c.name || "User"} is ${statusStr.toLowerCase()} — open chat`}
                          title={`${statusStr} — open chat`}
                          className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${statusDot[statusStr] || statusDot["Active"]}`}
                        />
                      )}
                    </div>
                    <button onClick={() => openConversation(c.id)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center justify-between">
                        <p className={`truncate text-xs font-semibold ${cardText}`}>{c.name || "User"}</p>
                        <span className={`ml-2 shrink-0 text-[10px] ${subtleText}`}>
                          {getRelativeTimeLabel({ timestamp: c.lastMessageAt, date: c.lastMessageDate, time: c.time })}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className={`truncate text-[11px] ${subtleText}`}>
                          {lastMsg?.text ||
                            (lastMsg?.voice
                              ? "🎤 Voice message"
                              : lastMsg?.file
                              ? "Sent a file"
                              : "No messages yet")}
                        </p>
                        {unreadCountFor(c) > 0 && (
                          <span className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[9px] font-semibold text-white">
                            {unreadCountFor(c)}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      onClick={() => requestDeleteConversation(c)}
                      className={`shrink-0 rounded-lg p-1.5 opacity-0 transition-opacity group-hover:opacity-100 ${subtleText} hover:bg-rose-50 hover:text-rose-500`}
                      aria-label={`Delete conversation with ${c.name || "User"}`}
                      title="Delete conversation"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* No conversation left */}
        {!active && (
          <div className={`hidden flex-1 flex-col items-center justify-center gap-2 sm:flex ${mutedText}`}>
            <MessageSquareOff size={28} className={subtleText} />
            <p className="text-xs font-medium">No conversation selected</p>
            <p className={`text-[10.5px] ${subtleText}`}>Pick someone from the list to start chatting.</p>
          </div>
        )}

        {/* Chat window */}
        {active && (
          <div className={`min-h-0 min-w-0 flex-1 flex-col ${mobileView === "chat" ? "flex" : "hidden"} sm:flex`}>
            <div className={`flex items-center justify-between gap-2 border-b px-3 py-2.5 sm:px-4 ${borderCol}`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <button className={`sm:hidden ${mutedText}`} onClick={() => setMobileView("list")} aria-label="Back to conversations">
                  <ChevronLeft size={20} />
                </button>
                <div className="relative shrink-0">
                  <button onClick={() => setInfoOpen(true)} aria-label={active.isGroup ? `View ${active.name} group details` : `View ${active.name}'s details`}>
                    {active.isGroup ? (
                      isUploadedPhoto(active.avatar) ? (
                        <img src={active.avatar} alt={active.name} className="h-9 w-9 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                          <Users size={16} />
                        </div>
                      )
                    ) : (
                      <AvatarCircle name={active.name} avatar={active.avatar} sizeClass="h-9 w-9" textSizeClass="text-xs" />
                    )}
                  </button>
                  {!active.isGroup && (
                    <button
                      onClick={() => setInfoOpen(true)}
                      aria-label={`${active.name} is ${active.status.toLowerCase()} — view details`}
                      title={`${active.status} — view details`}
                      className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white ${statusDot[active.status]}`}
                    />
                  )}
                </div>
                <button onClick={() => setInfoOpen(true)} className="min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <p className={`truncate text-xs font-semibold ${cardText}`}>{active.name}</p>
                    {!active.isGroup && (
                      <span className={`hidden shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-medium ring-1 sm:inline-block ${statusColor[active.status]}`}>
                        {active.status}
                      </span>
                    )}
                  </div>
                  <p className={`truncate text-[10.5px] ${subtleText}`}>{active.role}</p>
                </button>
              </div>
              <div className={`flex shrink-0 items-center gap-1 ${mutedText}`}>
                {!active.isGroup && (
                  <button
                    onClick={() => startCall(active)}
                    disabled={!active.otherUserId || !!activeCall}
                    className={`rounded-lg p-1.5 ${hoverBg} disabled:opacity-40`}
                    aria-label={`Call ${active.name}`}
                    title={`Call ${active.name}`}
                  >
                    <Phone size={15} />
                  </button>
                )}
                <button onClick={() => setInfoOpen(true)} className={`rounded-lg p-1.5 ${hoverBg}`} aria-label="Conversation info">
                  <Info size={15} />
                </button>
                <div className="relative" ref={menuRef}>
                  <button onClick={() => setMenuOpen((v) => !v)} className={`rounded-lg p-1.5 ${hoverBg}`} aria-label="More options">
                    <MoreVertical size={15} />
                  </button>
                  {menuOpen && (
                    <div className={`absolute right-0 top-9 z-40 w-48 rounded-xl border p-1.5 shadow-lg ${card} ${borderCol}`}>
                      <button
                        onClick={() => {
                          setProfileViewOpen(true);
                          setMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11.5px] font-medium ${cardText} ${hoverBg}`}
                      >
                        <Eye size={13} />
                        View profile
                      </button>
                      <button
                        onClick={() => requestDeleteConversation(active)}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11.5px] font-medium text-rose-500 hover:bg-rose-50"
                      >
                        <Trash2 size={13} />
                        Delete conversation
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-4 sm:px-4">
              {timelineItems.length === 0 && (
                <p className={`pt-10 text-center text-[11px] ${subtleText}`}>No messages yet. Say hi 👋</p>
              )}
              {(() => {
                let lastDateKey = null;
                return timelineItems.map((item) => {
                  // Finished calls are shown inline, chronologically among
                  // the messages — like WhatsApp — instead of a banner
                  // pinned above the thread that only ever reflected the
                  // single most recent call.
                  if (item.kind === "call") {
                    const c = item.data;
                    const callDate = c.startedAt ? new Date(c.startedAt) : null;
                    const dateKey = callDate ? callDate.toISOString().split("T")[0] : null;
                    const timeStr = callDate
                      ? callDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                      : "";
                    const showDateDivider = dateKey && dateKey !== lastDateKey;
                    if (dateKey) lastDateKey = dateKey;
                    return (
                      <React.Fragment key={`call-${c.id}`}>
                        {showDateDivider && (
                          <div className="flex items-center justify-center py-1">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[9.5px] font-semibold shadow-sm ${
                                darkMode ? "bg-slate-800 text-slate-400" : "bg-white text-slate-500"
                              }`}
                            >
                              {formatDateDivider(dateKey)}
                            </span>
                          </div>
                        )}
                        <div className="flex items-center justify-center py-1">
                          <span
                            className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10.5px] font-medium shadow-sm ${
                              darkMode ? "bg-slate-800 text-slate-300" : "bg-white text-slate-600"
                            }`}
                          >
                            {c.status === "missed" ? (
                              <PhoneMissed size={12} className="text-rose-500" />
                            ) : c.status === "rejected" ? (
                              <PhoneOff size={12} className="text-rose-500" />
                            ) : (
                              <Phone size={12} className="text-emerald-500" />
                            )}
                            {c.status === "missed"
                              ? `Missed call ${c.isMine ? "· no answer" : "from " + (active.name || "")}`
                              : c.status === "rejected"
                              ? "Call declined"
                              : `Call ended · ${formatCallDuration(c.durationSeconds || 0)}`}
                            <span className={subtleText}>{timeStr}</span>
                          </span>
                        </div>
                      </React.Fragment>
                    );
                  }

                  const rawMsg = item.data;
                  // Direction is computed per-viewer (see isOutgoingForViewer
                  // above), not read straight off the stored flag, so the
                  // same message correctly appears on the right for
                  // whoever sent it and on the left for whoever received
                  // it — instead of always being "outgoing" for everyone.
                  // EXCEPTION: real API-backed messages already carry a
                  // correct, backend-computed `isMine` flag (see
                  // messagesToRender above) — isOutgoingForViewer() only
                  // understands the old "admin"/"user"/peerAuthIds mock-data
                  // model and would wrongly mark every API message as
                  // incoming, since a real sender name never equals
                  // "admin" or "user".
                  const m = {
                    ...rawMsg,
                    outgoing: typeof rawMsg.isMine === "boolean" ? rawMsg.isMine : isOutgoingForViewer(rawMsg, active),
                  };
                  const showDivider = m.date && m.date !== lastDateKey;
                  if (m.date) lastDateKey = m.date;
                  const showUnreadDivider = !m.outgoing && m.id === firstUnreadMessageId && unreadMarkerCount > 0;
                  return (
                    <React.Fragment key={m.id}>
                      {showDivider && (
                        <div className="flex items-center justify-center py-1">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[9.5px] font-semibold shadow-sm ${
                              darkMode ? "bg-slate-800 text-slate-400" : "bg-white text-slate-500"
                            }`}
                          >
                            {formatDateDivider(m.date)}
                          </span>
                        </div>
                      )}
                      {showUnreadDivider && (
                        <div ref={unreadDividerRef} className="flex items-center gap-2 py-1">
                          <div className={`h-px flex-1 ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                          <span className="shrink-0 rounded-full bg-emerald-500/90 px-2.5 py-1 text-[9.5px] font-semibold text-white shadow-sm">
                            {unreadMarkerCount} unread {unreadMarkerCount === 1 ? "message" : "messages"}
                          </span>
                          <div className={`h-px flex-1 ${darkMode ? "bg-slate-700" : "bg-slate-200"}`} />
                        </div>
                      )}
                      <div className={`group flex items-start gap-1.5 ${m.outgoing ? "justify-end" : "justify-start"}`}>
                  {m.outgoing && (
                    <button
                      onClick={() => requestDeleteMessage(m.id)}
                      className={`mt-2 shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${subtleText} hover:bg-rose-50 hover:text-rose-500`}
                      aria-label="Delete message"
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-[11.5px] shadow-sm sm:max-w-[70%] ${
                      m.outgoing
                        ? "rounded-br-sm bg-gradient-to-br from-violet-600 to-indigo-600 text-white"
                        : `rounded-bl-sm ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-50 text-slate-700"}`
                    }`}
                  >
                    {m.voice ? (
                      <VoicePlayer url={m.voice.url} duration={m.voice.duration} outgoing={m.outgoing} darkMode={darkMode} />
                    ) : m.file ? (
                      m.file.isImage ? (
                        fileUrlFor(m.file) ? (
                          <button type="button" onClick={() => viewFile(fileUrlFor(m.file))} className="group/img relative block overflow-hidden rounded-lg">
                            <img src={fileUrlFor(m.file)} alt={m.file.name} className="max-h-48 w-full rounded-lg object-cover" />
                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition-colors group-hover/img:bg-black/30 group-hover/img:text-white">
                              <Eye size={16} />
                            </span>
                          </button>
                        ) : (
                          // Still loading from IndexedDB (see resolvedMediaUrls effect above).
                          <div className="flex h-24 w-full items-center justify-center rounded-lg bg-black/5 text-[10px]">
                            Loading image…
                          </div>
                        )
                      ) : (
                        <div className={`flex items-center gap-2.5 rounded-lg p-2 ${m.outgoing ? "bg-white/10" : darkMode ? "bg-slate-900/40" : "bg-white"}`}>
                          <div className="shrink-0 rounded-lg bg-rose-50 p-1.5 text-rose-500">
                            <FileText size={15} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[10.5px] font-semibold">{m.file.name}</p>
                            <p className={`text-[9.5px] ${m.outgoing ? "text-white/70" : subtleText}`}>{m.file.size}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {fileUrlFor(m.file) && (
                              <button type="button" onClick={() => viewFile(fileUrlFor(m.file))} aria-label={`View ${m.file.name}`} className="rounded p-1 hover:bg-black/10">
                                <Eye size={13} />
                              </button>
                            )}
                            {fileUrlFor(m.file) && (
                              <a href={fileUrlFor(m.file)} download={m.file.name} aria-label={`Download ${m.file.name}`} className="rounded p-1 hover:bg-black/10">
                                <Download size={13} />
                              </a>
                            )}
                          </div>
                        </div>
                      )
                    ) : (
                      <p className="leading-relaxed whitespace-pre-wrap break-words">{m.text}</p>
                    )}
                    <p className={`mt-1 text-right text-[9px] ${m.outgoing ? "text-white/70" : subtleText}`}>
                      {getRelativeTimeLabel(m)}
                    </p>
                  </div>
                  {!m.outgoing && (
                    <button
                      onClick={() => requestDeleteMessage(m.id)}
                      className={`mt-2 shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${subtleText} hover:bg-rose-50 hover:text-rose-500`}
                      aria-label="Delete message"
                      title="Delete message"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                      </div>
                    </React.Fragment>
                  );
                });
              })()}
            </div>

            <div className={`shrink-0 border-t ${borderCol}`}>
              {/* Send-to-all banner: shown when broadcast mode is on, so the
                  user always knows this message will go to everyone. */}
              {broadcastMode && (
                <div className="flex items-center gap-2 bg-violet-50 px-3 py-1.5 text-[10.5px] font-medium text-violet-700 sm:px-4">
                  <Users size={12} />
                  <span className="truncate">Sending to all {conversations.length} members</span>
                  <button
                    onClick={() => setBroadcastMode(false)}
                    className="ml-auto shrink-0 rounded p-0.5 text-violet-500 hover:bg-violet-100"
                    aria-label="Switch back to individual chat"
                    title="Back to individual chat"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {pendingAttachments.length > 0 && (
                <div className={`flex flex-wrap gap-2 px-3 pt-2.5 sm:px-4 ${borderCol}`}>
                  {pendingAttachments.map((att) =>
                    att.kind === "voice" ? (
                      <div
                        key={att.id}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
                      >
                        <div className="shrink-0 rounded-full bg-violet-100 p-1.5 text-violet-600">
                          <Mic size={13} />
                        </div>
                        <VoicePlayer url={att.url} duration={att.duration} outgoing={false} darkMode={darkMode} />
                        <button
                          onClick={() => removePendingAttachment(att.id)}
                          className={`shrink-0 rounded-full p-0.5 ${subtleText} hover:bg-rose-50 hover:text-rose-500`}
                          aria-label="Remove voice message"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        key={att.id}
                        className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
                      >
                        {att.isImage ? (
                          <img src={att.url} alt={att.name} className="h-8 w-8 shrink-0 rounded object-cover" />
                        ) : (
                          <div className="shrink-0 rounded bg-rose-50 p-1.5 text-rose-500">
                            <FileText size={13} />
                          </div>
                        )}
                        <div className="min-w-0 max-w-[120px]">
                          <p className={`truncate text-[10px] font-medium ${cardText}`}>{att.name}</p>
                          <p className={`text-[9px] ${subtleText}`}>{att.size}</p>
                        </div>
                        <button
                          onClick={() => removePendingAttachment(att.id)}
                          className={`shrink-0 rounded-full p-0.5 ${subtleText} hover:bg-rose-50 hover:text-rose-500`}
                          aria-label={`Remove ${att.name}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )
                  )}
                </div>
              )}
              {micError && (
                <p className="px-3 pt-2 text-[10.5px] text-rose-500 sm:px-4">{micError}</p>
              )}

              {isRecording ? (
                <div className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                  </span>
                  <p className={`flex-1 text-xs font-medium tabular-nums ${cardText}`}>
                    Recording&nbsp;&middot;&nbsp;{formatDuration(recordingSeconds)}
                  </p>
                  <button
                    onClick={() => stopRecording("cancel")}
                    className={`shrink-0 rounded-lg p-1.5 ${mutedText} hover:bg-rose-50 hover:text-rose-500`}
                    aria-label="Cancel recording"
                    title="Cancel"
                  >
                    <X size={16} />
                  </button>
                  <button
                    onClick={() => stopRecording("confirm")}
                    className="flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 p-2 text-white hover:opacity-90"
                    aria-label="Stop and keep recording"
                    title="Stop recording"
                  >
                    <Square size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative flex items-end gap-1 px-3 py-2.5 sm:gap-2 sm:px-4">
                  <input ref={fileInputRef} type="file" multiple onChange={handleFilesChosen} className="hidden" />
                  <button onClick={handleFileButtonClick} className={`shrink-0 rounded-lg p-1.5 mb-1 ${mutedText} ${hoverBg}`} aria-label="Attach file" title="Attach file (sent when you press Send)">
                    <Paperclip size={16} />
                  </button>

                  {/* Individual vs. All-members toggle — admin/manager only;
                      a regular employee only has their own single thread
                      anyway, so broadcasting doesn't apply to them. */}
                  {isPrivilegedViewer && (
                    <button
                      onClick={() => setBroadcastMode((v) => !v)}
                      className={`shrink-0 rounded-lg p-1.5 mb-1 transition-colors ${
                        broadcastMode ? "bg-violet-100 text-violet-600" : `${mutedText} ${hoverBg}`
                      }`}
                      aria-label={broadcastMode ? "Switch to individual chat" : "Send to all members"}
                      title={broadcastMode ? "Sending to all members — click to send to this chat only" : "Send this message to all members"}
                    >
                      {broadcastMode ? <Users size={16} /> : <User size={16} />}
                    </button>
                  )}

                  <textarea
                    ref={draftRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={
                      pendingAttachments.length > 0
                        ? "Add a caption (optional)..."
                        : broadcastMode
                        ? "Message to send to ALL members..."
                        : 'Type your message... (try "send to all: ...")'
                    }
                    rows={1}
                    className={`flex-1 min-w-0 resize-none rounded-lg px-3 py-2 text-xs leading-relaxed outline-none placeholder:text-slate-400 ${inputBg} ${cardText}`}
                    style={{ maxHeight: 120, overflowY: "auto" }}
                  />
                  <button onClick={startRecording} className={`inline-flex shrink-0 rounded-lg p-1.5 mb-1 ${mutedText} ${hoverBg}`} aria-label="Record voice message" title="Record voice message">
                    <Mic size={16} />
                  </button>
                  <div className="relative shrink-0" ref={emojiRef}>
                    <button onClick={() => setEmojiOpen((v) => !v)} className={`rounded-lg p-1.5 mb-1 ${mutedText} ${hoverBg}`} aria-label="Add emoji" title="Add emoji">
                      <Smile size={16} />
                    </button>
                    {emojiOpen && (
                      <div className={`absolute bottom-11 right-0 z-50 w-56 max-w-[calc(100vw-2rem)] rounded-xl border p-2 shadow-lg ${card} ${borderCol}`}>
                        <div className="grid grid-cols-6 gap-1">
                          {EMOJIS.map((emoji) => (
                            <button key={emoji} onClick={() => handleEmojiSelect(emoji)} className={`rounded-md p-1 text-base leading-none ${hoverBg}`}>
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <button
                    onClick={sendMessage}
                    className={`flex shrink-0 items-center justify-center rounded-lg p-2 mb-0.5 text-white hover:opacity-90 disabled:opacity-40 ${
                      broadcastMode ? "bg-gradient-to-br from-rose-500 to-orange-500" : "bg-gradient-to-br from-violet-600 to-indigo-600"
                    }`}
                    aria-label={broadcastMode ? "Send to all members" : "Send message"}
                    title={broadcastMode ? "Send to all members" : "Send message"}
                    disabled={!draft.trim() && pendingAttachments.length === 0}
                  >
                    <Send size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Conversation info panel */}
        {active && (
          <>
            <aside
              className={`absolute inset-y-0 right-0 z-40 w-full max-w-xs overflow-y-auto border-l p-4 shadow-xl transition-transform duration-200 sm:max-w-sm lg:w-80 lg:max-w-sm ${borderCol} ${card} ${
                infoOpen ? "translate-x-0" : "translate-x-full"
              }`}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className={`text-xs font-bold ${cardText}`}>Conversation Info</h2>
                <button className={subtleText} onClick={() => setInfoOpen(false)} aria-label="Close info panel">
                  <X size={16} />
                </button>
              </div>

              <div className="mb-5 flex flex-col items-center text-center">
                <div className="relative mb-2.5">
                  {active.isGroup && active.restrictedGroupView ? (
                    // Relabeled-to-PM view for a regular team member: just
                    // show the avatar, no group photo/rename controls —
                    // it isn't really "their" group to rebrand.
                    isUploadedPhoto(active.avatar) ? (
                      <img src={active.avatar} alt={active.name} className="h-16 w-16 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                        <Users size={26} />
                      </div>
                    )
                  ) : active.isGroup ? (
                    <>
                      <button
                        type="button"
                        onClick={() => groupPhotoInputRef.current?.click()}
                        className="group/avatar relative block h-16 w-16 overflow-hidden rounded-full"
                        aria-label="Change group photo"
                        title="Change group photo"
                      >
                        {isUploadedPhoto(active.avatar) ? (
                          <img src={active.avatar} alt={active.name} className="h-16 w-16 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-violet-100 text-violet-600">
                            <Users size={26} />
                          </div>
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition-colors group-hover/avatar:bg-black/40 group-hover/avatar:text-white">
                          <Camera size={16} />
                        </span>
                      </button>
                      <input
                        ref={groupPhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleGroupPhotoChosen}
                        className="hidden"
                      />
                    </>
                  ) : (
                    <>
                      <AvatarCircle name={active.name} avatar={active.avatar} sizeClass="h-16 w-16" textSizeClass="text-lg" />
                      <span
                        role="img"
                        aria-label={`Status: ${active.status}`}
                        title={active.status}
                        className={`absolute bottom-0.5 right-0.5 h-3 w-3 rounded-full ring-2 ring-white ${statusDot[active.status]}`}
                      />
                    </>
                  )}
                </div>
                {active.isGroup && editingGroupName ? (
                  <div className="mb-1 flex w-full items-center justify-center gap-1.5">
                    <input
                      autoFocus
                      value={groupNameDraft}
                      onChange={(e) => setGroupNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveGroupName();
                        if (e.key === "Escape") setEditingGroupName(false);
                      }}
                      className={`min-w-0 max-w-[160px] rounded-lg border px-2 py-1 text-center text-xs font-semibold ${
                        darkMode ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-800"
                      }`}
                    />
                    <button onClick={saveGroupName} className="rounded-lg p-1 text-emerald-600 hover:bg-emerald-50" aria-label="Save group name">
                      <Check size={14} />
                    </button>
                    <button onClick={() => setEditingGroupName(false)} className={`rounded-lg p-1 ${subtleText} hover:bg-rose-50 hover:text-rose-500`} aria-label="Cancel">
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="mb-0 flex items-center gap-1.5">
                    <p className={`text-xs font-semibold ${cardText}`}>{active.name}</p>
                    {active.isGroup && !active.restrictedGroupView && (
                      <button onClick={startEditGroupName} className={`rounded p-0.5 ${subtleText} hover:text-violet-600`} aria-label="Edit group name">
                        <Pencil size={11} />
                      </button>
                    )}
                  </div>
                )}
                <p className={`mb-2 text-[10.5px] ${subtleText}`}>{active.role}</p>
                {!active.isGroup && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${statusColor[active.status]}`}>{active.status}</span>
                )}
              </div>

              {active.isGroup && active.restrictedGroupView ? (
                <div className="mb-5">
                  <h3 className={`mb-2.5 text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>Team</h3>
                  <p className={`text-[10.5px] ${mutedText}`}>
                    {(() => {
                      const count = (active.members || []).length;
                      return `${count} member${count === 1 ? "" : "s"} on this project team.`;
                    })()}
                  </p>
                </div>
              ) : active.isGroup ? (
                <div className="mb-5">
                  <h3 className={`mb-2.5 text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>Members</h3>
                  <div className="space-y-2">
                    {(active.members || []).map((name) => (
                      <div key={name} className="flex items-center gap-2.5">
                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarColor(name)}`}>
                          {initials(name)}
                        </div>
                        <span className={`truncate text-[11px] ${mutedText}`}>{name}</span>
                      </div>
                    ))}
                    {(active.members || []).length === 0 && <p className={`text-[10.5px] ${subtleText}`}>No members yet.</p>}
                  </div>
                </div>
              ) : (
                <div className={`mb-5 space-y-1 text-[11px] ${mutedText}`}>
                  <a href={`mailto:${active.email}`} className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${hoverBg}`}>
                    <Mail size={13} className={`shrink-0 ${subtleText}`} />
                    <span className="truncate">{active.email}</span>
                  </a>
                  <a href={`tel:${active.phone.replace(/\s+/g, "")}`} className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${hoverBg}`}>
                    <Phone size={13} className={`shrink-0 ${subtleText}`} />
                    <span>{active.phone}</span>
                  </a>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(active.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 ${hoverBg}`}
                  >
                    <MapPin size={13} className={`shrink-0 ${subtleText}`} />
                    <span>{active.location}</span>
                  </a>
                </div>
              )}

              <div className="mb-5">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className={`text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>Shared Files</h3>
                  {active.files.length > 2 && (
                    <button onClick={() => setShowAllFiles((v) => !v)} className="text-[10px] font-medium text-violet-600 hover:underline">
                      {showAllFiles ? "Show Less" : "View All"}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {active.files.length === 0 && <p className={`text-[10.5px] ${subtleText}`}>No shared files yet.</p>}
                  {visibleFiles.map((f) => (
                    <div key={f.name} className="flex items-center gap-2.5">
                      <div className={`rounded-lg p-1.5 ${fileIconColor[f.type]}`}>
                        {f.type === "img" ? <FileImage size={14} /> : <FileText size={14} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-[10.5px] font-semibold ${cardText}`}>{f.name}</p>
                        <p className={`text-[9.5px] ${subtleText}`}>
                          {f.size} &middot; {f.date}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mb-5">
                <div className="mb-2.5 flex items-center justify-between">
                  <h3 className={`text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>Project Assignments</h3>
                  {active.assignments.length > 2 && (
                    <button onClick={() => setShowAllAssignments((v) => !v)} className="text-[10px] font-medium text-violet-600 hover:underline">
                      {showAllAssignments ? "Show Less" : "View All"}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {active.assignments.length === 0 && <p className={`text-[10.5px] ${subtleText}`}>No assignments.</p>}
                  {visibleAssignments.map((a) => (
                    <div key={a.name} className="flex items-center justify-between">
                      <span className={`text-[10.5px] ${mutedText}`}>{a.name}</span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                          a.status === "Completed" ? "bg-emerald-50 text-emerald-600" : "bg-violet-50 text-violet-600"
                        }`}
                      >
                        {a.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 className={`mb-2.5 text-[10px] font-bold uppercase tracking-wide ${subtleText}`}>Quick Actions</h3>
                <div className="space-y-1.5">
                  <button
                    onClick={() => setProfileViewOpen(true)}
                    className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[10.5px] font-medium ${mutedText} ${
                      darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <Eye size={12} />
                      View Profile
                    </span>
                    <ChevronRight size={12} />
                  </button>

                  {!active.isGroup && (
                    <a
                      href={gmailComposeUrl(active)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[10.5px] font-medium ${mutedText} ${
                        darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      Send Email (Gmail)
                      <ChevronRight size={12} />
                    </a>
                  )}

                  {isPrivilegedViewer && (
                    <button
                      onClick={() => setBroadcastMode(true)}
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[10.5px] font-medium ${mutedText} ${
                        darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Users size={12} />
                        Message All Members
                      </span>
                      <ChevronRight size={12} />
                    </button>
                  )}

                  {addingTask ? (
                    <div className={`rounded-lg border p-2 ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
                      <input
                        autoFocus
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addTask();
                          if (e.key === "Escape") setAddingTask(false);
                        }}
                        placeholder="Task name..."
                        className={`mb-2 w-full rounded-md px-2 py-1.5 text-[10.5px] outline-none ${inputBg} ${cardText}`}
                      />
                      <div className="flex justify-end gap-1.5">
                        <button onClick={() => setAddingTask(false)} className={`rounded-md px-2 py-1 text-[10px] ${mutedText} ${hoverBg}`}>
                          Cancel
                        </button>
                        <button onClick={addTask} className="rounded-md bg-violet-600 px-2 py-1 text-[10px] font-medium text-white hover:bg-violet-700">
                          Add
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingTask(true)}
                      className={`flex w-full items-center justify-between rounded-lg border px-2.5 py-2 text-[10.5px] font-medium ${mutedText} ${
                        darkMode ? "border-slate-700 hover:bg-slate-800" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        <Plus size={12} />
                        Create Task
                      </span>
                    </button>
                  )}

                  <button
                    onClick={() => requestDeleteConversation(active)}
                    className="flex w-full items-center justify-between rounded-lg border border-rose-200 px-2.5 py-2 text-[10.5px] font-medium text-rose-500 hover:bg-rose-50"
                  >
                    <span className="flex items-center gap-1.5">
                      <Trash2 size={12} />
                      Delete Conversation
                    </span>
                  </button>
                </div>
              </div>
            </aside>

            {infoOpen && <div className="absolute inset-0 z-30 bg-black/40" onClick={() => setInfoOpen(false)} />}
          </>
        )}
      </div>
    </div>
  );
}