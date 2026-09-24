/* ===========================================================================
   birthdayMessageDelivery.js
   ---------------------------------------------------------------------------
   BirthdayCelebration.jsx (employee dashboard) and
   ClientBirthdayCelebration.jsx (client portal) both queue a "someone's
   birthday today" entry into this same localStorage key the moment they
   detect it. This file is the OTHER end of that queue — it's how
   MessagesPage.jsx (employees) and ClientPortal.jsx (clients) actually turn
   a queued entry into a real message in the existing thread, then mark it
   delivered so it's never sent twice.
   =========================================================================== */

/** Today's date as YYYY-MM-DD in the person's LOCAL timezone.
 *  FIX: this used new Date().toISOString() (UTC) everywhere — in Pakistan
 *  (UTC+5) that still says "yesterday" between midnight and 5 AM, so a
 *  birthday wish queued/dismissed in those hours was keyed to the wrong
 *  day and could be skipped or shown against the wrong date. */
function localTodayKey() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Once-per-day "already dismissed" tracking for the BirthdayCard
 *  celebration popup (employee dashboard and client portal) — without
 *  this, closing the card only set in-memory React state, so simply
 *  navigating away/back or logging in again (which remounts the
 *  component) reset that state and the celebration reappeared, even
 *  though the person already closed it once today. Keyed by
 *  audience+id+today's date, so it naturally shows again on the next
 *  actual birthday next year without any cleanup needed. */
const DISMISSED_CELEBRATIONS_KEY = "hopenix_birthday_celebration_dismissed";

function readDismissedCelebrations() {
  try {
    const raw = localStorage.getItem(DISMISSED_CELEBRATIONS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function writeDismissedCelebrations(obj) {
  try {
    localStorage.setItem(DISMISSED_CELEBRATIONS_KEY, JSON.stringify(obj));
  } catch {
    // localStorage unavailable — safe to ignore, best-effort only
  }
}

function celebrationDismissKey(audience, id) {
  const todayKey = localTodayKey();
  return `${audience}:${id}:${todayKey}`;
}

export function isCelebrationDismissedToday(audience, id) {
  if (id == null) return false;
  return Boolean(readDismissedCelebrations()[celebrationDismissKey(audience, id)]);
}

export function markCelebrationDismissedToday(audience, id) {
  if (id == null) return;
  const map = readDismissedCelebrations();
  map[celebrationDismissKey(audience, id)] = true;
  writeDismissedCelebrations(map);
}

const PENDING_MESSAGES_KEY = "hopenix_pending_birthday_messages";

export function isBirthdayToday(dateValue) {
  if (!dateValue) return false;
  const str = String(dateValue).trim();
  if (!str) return false;
  const match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  const today = new Date();
  if (match) {
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    return today.getMonth() === month && today.getDate() === day;
  }
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return false;
  return (
    (d.getUTCMonth() === today.getMonth() && d.getUTCDate() === today.getDate()) ||
    (d.getMonth() === today.getMonth() && d.getDate() === today.getDate())
  );
}

function readQueue() {
  try {
    const raw = localStorage.getItem(PENDING_MESSAGES_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(list) {
  try {
    localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable — safe to ignore, best-effort only
  }
}

export function queueEmployeeBirthdayMessage(user) {
  if (!user || (!user.id && user.id !== 0)) return;
  try {
    const list = readQueue();
    const todayKey = localTodayKey();
    const alreadyQueued = list.some(
      (m) => String(m.userId) === String(user.id) && m.dateKey === todayKey && m.audience !== "client"
    );
    if (alreadyQueued) return;
    const displayName = user.name || "there";
    list.push({
      userId: user.id,
      name: displayName,
      dateKey: todayKey,
      text: `🎉 Happy Birthday, ${displayName}! Best wishes from the whole Hopenix team! 🎂`,
      sender: "Hopenix Team",
      audience: "employee",
      delivered: false,
    });
    writeQueue(list);
  } catch {
    // safe ignore
  }
}

export function queueClientBirthdayMessage(client) {
  if (!client || (!client.id && client.id !== 0)) return;
  try {
    const list = readQueue();
    const todayKey = localTodayKey();
    const alreadyQueued = list.some(
      (m) => String(m.userId) === String(client.id) && m.dateKey === todayKey && m.audience === "client"
    );
    if (alreadyQueued) return;
    const displayName = client.contactPerson || client.name || "there";
    list.push({
      userId: client.id,
      name: displayName,
      dateKey: todayKey,
      text: `🎉 Happy Birthday, ${displayName}! Best wishes from the whole Hopenix team! 🎂`,
      sender: "Hopenix Team",
      audience: "client",
      delivered: false,
    });
    writeQueue(list);
  } catch {
    // safe ignore
  }
}

export function isBirthdayMessageAlreadyInConversations(conversations, userId, dateKey) {
  if (!Array.isArray(conversations) || !userId) return false;
  const conv = conversations.find(
    (c) =>
      (c.authId != null && String(c.authId) === String(userId)) ||
      (c.userId != null && String(c.userId) === String(userId)) ||
      (c.employeeId != null && String(c.employeeId) === String(userId))
  );
  if (!conv || !Array.isArray(conv.messages)) return false;
  return conv.messages.some(
    (m) => m.text && m.text.includes("Happy Birthday") && (m.date === dateKey || !dateKey)
  );
}

/** Undelivered employee birthday wishes (queued by BirthdayCelebration.jsx). */
export function getPendingEmployeeBirthdayMessages() {
  return readQueue().filter((m) => m.audience !== "client" && !m.delivered);
}

/** Undelivered client birthday wishes (queued by ClientBirthdayCelebration.jsx). */
export function getPendingClientBirthdayMessages() {
  return readQueue().filter((m) => m.audience === "client" && !m.delivered);
}

/** Call once a queued entry has actually been turned into a real message,
 *  so it isn't delivered again next time this page mounts. */
export function markBirthdayMessageDelivered(userId, dateKey) {
  const list = readQueue().map((m) =>
    String(m.userId) === String(userId) && m.dateKey === dateKey ? { ...m, delivered: true } : m
  );
  writeQueue(list);
}