import React, { useState, useEffect, useMemo } from "react";
import { CalendarDays, CalendarPlus, Plus, X, Video, ChevronLeft, ChevronRight, Clock, CheckCircle2, Link as LinkIcon } from "lucide-react";
import { useAuth, getRoleCategory } from "../AuthContext.jsx";

/* =====================================================================
   DATE / TIME HELPERS
   ---------------------------------------------------------------------
   Har jagah raw ISO date ("2026-09-15") aur 24hr time ("10:00") store
   hota hai — display ke liye pretty format yahin se banta hai, taake
   conflict-check (1 slot = 1 meeting) reliable rahe.
===================================================================== */

function isoDateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDatePretty(rawDate) {
  if (!rawDate) return rawDate;
  return new Date(rawDate + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTimePretty(rawTime) {
  if (!rawTime) return rawTime;
  const [h, m] = rawTime.split(":");
  const hour = ((+h + 11) % 12) + 1;
  const ampm = +h >= 12 ? "PM" : "AM";
  return `${hour}:${m} ${ampm}`;
}

function addMinutes(rawTime, mins) {
  const [h, m] = rawTime.split(":").map(Number);
  const total = (h * 60 + m + mins + 24 * 60) % (24 * 60);
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatTimeRangePretty(rawTime, durationMins = 60) {
  return `${formatTimePretty(rawTime)} – ${formatTimePretty(addMinutes(rawTime, durationMins))}`;
}

/** Meeting abhi "aaj" ke slot mein hai aur declined/cancelled nahi hai. */
function isMeetingToday(m) {
  return m.rawDate === isoDateOffset(0) && m.status !== "Cancelled" && m.status !== "Declined";
}
/** Meeting ka poora slot (start + default 60min) guzar chuka hai, aur wo abhi tak
 *  completed/cancelled/declined mark nahi hui — matlab attend nahi ki gayi. */
function isMeetingMissed(m) {
  if (!m.rawDate || !m.rawTime) return false;
  if (m.status === "Cancelled" || m.status === "Declined" || m.status === "Completed") return false;
  const start = new Date(`${m.rawDate}T${m.rawTime}:00`);
  if (Number.isNaN(start.getTime())) return false;
  const end = new Date(start.getTime() + 60 * 60000);
  return Date.now() > end.getTime();
}

/* =====================================================================
   API LAYER — Meetings backend (Django REST Framework + PostgreSQL)
   ---------------------------------------------------------------------
   This used to be a localStorage + custom-events prototype store. It's
   now backed by real endpoints under /api/meetings/... (see the
   `meetings` Django app: models.py/serializers.py/views.py/urls.py).
   Every function below keeps the exact name/shape the rest of this file
   already calls (createMeeting, updateMeetingStatus,
   submitMeetingRequest, ...) — they just hit the API now instead of
   window.localStorage, and return Promises instead of plain values, so
   every call site further down awaits/.then()s them and updates state
   from the response.

   Auth: reads the DRF auth token from localStorage under "hopenix_auth_token"
   (confirmed from AuthContext.jsx — same key its own apiRequest() reads,
   same "Authorization: Token <key>" header DRF's TokenAuthentication
   expects, not "Bearer").
===================================================================== */

const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE_URL) || "http://127.0.0.1:8000";
// Matches AuthContext.jsx exactly: `localStorage.getItem("hopenix_auth_token")`
// and `Authorization: Token <key>` (DRF TokenAuthentication, not JWT/Bearer).
const TOKEN_KEY = "hopenix_auth_token";

function authHeaders() {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
  return token ? { Authorization: `Token ${token}` } : {};
}

async function apiFetch(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const firstError = data && (data.detail || Object.values(data)[0]);
    const message = Array.isArray(firstError) ? firstError[0] : firstError;
    throw new Error(message || "Something went wrong — please try again.");
  }
  return data;
}

// Poll every few seconds so the Admin view and every User view stay in
// sync with each other and across tabs, without needing a websocket —
// same "everyone shares one source of truth" feel the old
// localStorage+event version had. The very first tick fires immediately,
// so this also covers each component's *initial* load — no separate
// "loading" fetch needed on mount. Swap this for a websocket/SSE
// subscription later on if you want push-instant updates instead.
const POLL_MS = 5000;
function pollResource(fetchFn, callback) {
  let cancelled = false;
  const tick = () => {
    fetchFn()
      .then((data) => { if (!cancelled) callback(data); })
      .catch(() => {}); // a dropped poll tick isn't worth surfacing to the user
  };
  tick();
  const id = setInterval(tick, POLL_MS);
  return () => { cancelled = true; clearInterval(id); };
}

// ---- Registered users (for the "With" picker in ScheduleModal) ----
// GET /api/auth/users/ is admin-only on the backend (users.views.
// UsersListView) — someone who reaches this admin Meetings view via
// hasFullSubPageAccess("Meetings") but isn't a real admin/manager would
// get a 403 here; caught below so the picker just stays empty instead
// of breaking the whole schedule form.
function getRegisteredUsers() {
  return apiFetch("/api/auth/users/").catch(() => []);
}

// ---- Meetings ----
/** Backend only stores/returns rawDate + rawTime (like TasksPage's
 * dueDate) — the pretty `date`/`time` strings every component here
 * reads (MeetingCard, Calendar, MeetingDetailsModal, ...) are rebuilt
 * client-side right after each fetch/mutation, so nothing downstream of
 * this API layer needs to change at all. */
function enrichMeeting(m) {
  return { ...m, date: formatDatePretty(m.rawDate), time: formatTimeRangePretty(m.rawTime) };
}
function enrichMeetings(list) {
  return (list || []).map(enrichMeeting);
}
function getMeetings() {
  return apiFetch("/api/meetings/meetings/").then(enrichMeetings);
}
function subscribeToMeetings(cb) {
  return pollResource(getMeetings, cb);
}
/** Client-side pre-check against the already-fetched list — sirf 1
 * meeting per (date + start time). This is only a fast UX pre-check:
 * the server re-validates the exact same rule on every create/reschedule
 * (MeetingSerializer.validate / the reschedule actions on the backend),
 * so two tabs racing for the same slot still can't both win. */
function isSlotTaken(meetingsList, rawDate, rawTime, excludeId = null) {
  return (meetingsList || []).some(
    (m) => m.rawDate === rawDate && m.rawTime === rawTime && m.status !== "Declined" && m.status !== "Cancelled" && m.id !== excludeId
  );
}
function createMeeting({ title, type, project, rawDate, rawTime, participants = ["You"], agenda = ["Agenda to be added"], status = "Upcoming" }) {
  return apiFetch("/api/meetings/meetings/", {
    method: "POST",
    body: { title, type, project, rawDate, rawTime, participants, agenda, status },
  }).then(enrichMeeting);
}
function updateMeetingStatus(id, status) {
  return apiFetch(`/api/meetings/meetings/${id}/set-status/`, { method: "POST", body: { status } }).then(enrichMeeting);
}
function setMeetingLink(id, meetLink) {
  return apiFetch(`/api/meetings/meetings/${id}/set-link/`, { method: "POST", body: { meetLink } }).then(enrichMeeting);
}
/** Reschedule: date/time change karta hai — server authoritative response
 * (raw fields) se pretty date/time yahin dobara ban jate hain, taake dono
 * taraf hamesha sync rahe. */
function rescheduleMeeting(id, rawDate, rawTime) {
  return apiFetch(`/api/meetings/meetings/${id}/reschedule/`, { method: "POST", body: { rawDate, rawTime } }).then(enrichMeeting);
}

/** Permanently removes a meeting (different from Cancel, which just
 * flips status to "Cancelled" but keeps the record). Admin-only action —
 * wired from MeetingDetailsModal's "Delete Meeting" button below. */
function deleteMeeting(id) {
  return apiFetch(`/api/meetings/meetings/${id}/`, { method: "DELETE" });
}

// ---- Requests ----
/** Same reasoning as enrichMeeting() above, just with the single-instant
 * `time` label (formatTimePretty) requests/reschedule-requests have
 * always used instead of a range. */
function enrichRequest(r) {
  return { ...r, date: formatDatePretty(r.rawDate), time: formatTimePretty(r.rawTime) };
}
function enrichRequests(list) {
  return (list || []).map(enrichRequest);
}
function getRequests() {
  return apiFetch("/api/meetings/requests/").then(enrichRequests);
}
function subscribeToRequests(cb) {
  return pollResource(getRequests, cb);
}
function submitMeetingRequest({ name, role, project, reason, rawDate, rawTime }) {
  const cleanProject = project?.trim() || "General";
  return apiFetch("/api/meetings/requests/", {
    method: "POST",
    body: { name: name?.trim() || undefined, role, project: cleanProject, org: cleanProject, reason: reason?.trim(), rawDate, rawTime },
  }).then(enrichRequest);
}
function approveRequest(id) {
  return apiFetch(`/api/meetings/requests/${id}/approve/`, { method: "POST" }).then(enrichRequest);
}
function rejectRequest(id) {
  return apiFetch(`/api/meetings/requests/${id}/reject/`, { method: "POST" }).then(enrichRequest);
}

// ---- Reschedule Requests ----
// User/Client seedha meeting reschedule nahi kar sakta — sirf request
// bhejta hai (naya date/time + reason), admin approve kare tabhi asal
// meeting ka date/time badalta hai (backend ka RescheduleRequestViewSet.
// approve). Admin khud apni meetings ko kabhi bhi seedha reschedule kar
// sakta hai (rescheduleMeeting) — ye store sirf non-admin requests ke
// liye hai.
function getRescheduleRequests() {
  return apiFetch("/api/meetings/reschedule-requests/").then(enrichRequests);
}
function subscribeToRescheduleRequests(cb) {
  return pollResource(getRescheduleRequests, cb);
}
function submitRescheduleRequest({ meetingId, name, role, project, reason, rawDate, rawTime }) {
  return apiFetch("/api/meetings/reschedule-requests/", {
    method: "POST",
    body: { meetingId, name: name?.trim() || undefined, role, project, reason: reason?.trim(), rawDate, rawTime },
  }).then(enrichRequest);
}
function approveReschedule(id) {
  return apiFetch(`/api/meetings/reschedule-requests/${id}/approve/`, { method: "POST" }).then(enrichRequest);
}
function rejectReschedule(id) {
  return apiFetch(`/api/meetings/reschedule-requests/${id}/reject/`, { method: "POST" }).then(enrichRequest);
}

// ---- Admin Availability ----
// Ek hi shared row (backend: Availability.load()) — jo admin apni
// "My Availability" card se edit karta hai, wahi User view (client/
// developer, aur ClientPortal ke andar bhi, kyunke wo UserMeetings hi
// reuse karta hai) read-only dikhati hai.
const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getAvailability() {
  return apiFetch("/api/meetings/availability/");
}
function subscribeToAvailability(cb) {
  return pollResource(getAvailability, cb);
}
function saveAvailability(data) {
  return apiFetch("/api/meetings/availability/", { method: "PUT", body: data });
}

/** ["Mon","Tue","Wed"] -> "Mon – Wed", single day -> "Mon", non-contiguous -> "Mon, Wed, Fri". */
function formatAvailabilityDays(days) {
  const idxs = (days || [])
    .map((d) => WEEK_DAYS.indexOf(d))
    .filter((i) => i !== -1)
    .sort((a, b) => a - b);
  if (idxs.length === 0) return "—";
  let contiguous = true;
  for (let i = 1; i < idxs.length; i++) {
    if (idxs[i] !== idxs[i - 1] + 1) { contiguous = false; break; }
  }
  if (contiguous) return idxs.length === 1 ? WEEK_DAYS[idxs[0]] : `${WEEK_DAYS[idxs[0]]} – ${WEEK_DAYS[idxs[idxs.length - 1]]}`;
  return idxs.map((i) => WEEK_DAYS[i]).join(", ");
}

/* =====================================================================
   THEME HELPERS
   ---------------------------------------------------------------------
   Bilkul TasksPage.jsx / Dashboard.jsx wale hi tokens — light mode
   default hai, `darkMode` prop true hone par dark variant apply hoti
   hai. Koi apna alag background/shell nahi — Dashboard ka <main> pehle
   se hi padding/scroll handle karta hai.
===================================================================== */

function useTheme(darkMode) {
  return {
    card: darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200",
    cardText: darkMode ? "text-slate-100" : "text-slate-900",
    mutedText: darkMode ? "text-slate-400" : "text-slate-500",
    subtleText: darkMode ? "text-slate-500" : "text-slate-400",
    inputCls: darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-700",
    modalCard: darkMode ? "bg-slate-900 text-slate-100" : "bg-white",
    hoverRow: darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50",
    border: darkMode ? "border-slate-800" : "border-slate-100",
  };
}

function statusBadge(status, darkMode) {
  const dark = {
    Upcoming: "bg-emerald-500/15 text-emerald-400",
    Confirmed: "bg-indigo-500/15 text-indigo-300",
    "In Progress": "bg-sky-500/15 text-sky-300",
    Completed: "bg-slate-700/50 text-slate-300",
    Cancelled: "bg-rose-500/15 text-rose-400",
    Declined: "bg-rose-500/15 text-rose-400",
  };
  const light = {
    Upcoming: "bg-emerald-50 text-emerald-600",
    Confirmed: "bg-indigo-50 text-indigo-600",
    "In Progress": "bg-sky-50 text-sky-600",
    Completed: "bg-slate-100 text-slate-600",
    Cancelled: "bg-rose-50 text-rose-600",
    Declined: "bg-rose-50 text-rose-600",
  };
  const map = darkMode ? dark : light;
  return map[status] || map.Upcoming;
}

function typeBadge(type, darkMode) {
  const dark = {
    Client: "bg-sky-500/15 text-sky-300",
    Team: "bg-indigo-500/15 text-indigo-300",
    Developer: "bg-amber-500/15 text-amber-300",
  };
  const light = {
    Client: "bg-sky-50 text-sky-600",
    Team: "bg-indigo-50 text-indigo-600",
    Developer: "bg-amber-50 text-amber-600",
  };
  const map = darkMode ? dark : light;
  return map[type] || (darkMode ? "bg-white/10 text-slate-300" : "bg-slate-100 text-slate-600");
}

/* =====================================================================
   SMALL SHARED UI PIECES
===================================================================== */

const AVATAR_COLORS = ["bg-fuchsia-500", "bg-indigo-500", "bg-teal-500", "bg-amber-500", "bg-rose-500"];

function Avatar({ name, size = "w-7 h-7", idx = 0, ring }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("");
  return (
    <div
      className={`${size} ${AVATAR_COLORS[idx % AVATAR_COLORS.length]} rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0 ${ring || ""}`}
      title={name}
    >
      {initials}
    </div>
  );
}

const dotColor = { Client: "bg-sky-400", Team: "bg-emerald-400", Developer: "bg-violet-400", other: "bg-slate-400" };

/** Live calendar — hamesha aaj (real device date) ke mahine se shuru hota hai. */
function Calendar({ meetings = [], darkMode = false }) {
  const t = useTheme(darkMode);
  const today = useMemo(() => new Date(), []);
  const [monthOffset, setMonthOffset] = useState(0);
  const viewDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const isCurrentMonth = viewDate.getFullYear() === today.getFullYear() && viewDate.getMonth() === today.getMonth();
  const [selected, setSelected] = useState(today.getDate());

  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const daysInMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0).getDate();
  const prevMonthDays = new Date(viewDate.getFullYear(), viewDate.getMonth(), 0).getDate();

  const cells = [];
  for (let i = firstDay - 1; i >= 0; i--) cells.push({ day: prevMonthDays - i, faded: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, faded: false });
  while (cells.length % 7 !== 0) cells.push({ day: cells.length, faded: true });

  const dayTags = useMemo(() => {
    const map = {};
    meetings.forEach((m) => {
      if (!m.rawDate || m.status === "Declined" || m.status === "Cancelled") return;
      const d = new Date(m.rawDate + "T00:00:00");
      if (d.getFullYear() === viewDate.getFullYear() && d.getMonth() === viewDate.getMonth()) {
        map[d.getDate()] = m.type in dotColor ? m.type : "other";
      }
    });
    return map;
  }, [meetings, viewDate]);

  return (
    <div className={`rounded-xl p-5 shadow-sm ${t.card}`}>
      <div className="flex items-center justify-between mb-4">
        <div className={`flex items-center gap-2 font-semibold ${t.cardText}`}>
          <CalendarDays size={16} className="text-violet-500" />
          Calendar
        </div>
        <div className={`flex items-center gap-2 text-sm ${t.mutedText}`}>
          <button onClick={() => setMonthOffset((m) => m - 1)} className={`p-1 rounded-md ${t.hoverRow}`}>
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[92px] text-center">{viewDate.toLocaleString("en-US", { month: "long", year: "numeric" })}</span>
          <button onClick={() => setMonthOffset((m) => m + 1)} className={`p-1 rounded-md ${t.hoverRow}`}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      <div className={`grid grid-cols-7 text-center text-[11px] mb-2 ${t.subtleText}`}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[13px]">
        {cells.map((c, i) => {
          const tag = !c.faded ? dayTags[c.day] : null;
          const isSelected = !c.faded && c.day === selected && isCurrentMonth;
          const isToday = !c.faded && isCurrentMonth && c.day === today.getDate();
          return (
            <button
              key={i}
              disabled={c.faded}
              onClick={() => !c.faded && setSelected(c.day)}
              className={`relative mx-auto w-8 h-8 rounded-full flex items-center justify-center transition-colors
                ${c.faded ? `${darkMode ? "text-slate-700" : "text-slate-300"} cursor-default` : `${t.cardText} ${t.hoverRow}`}
                ${isSelected ? "bg-violet-600 text-white font-semibold" : ""}
                ${isToday && !isSelected ? "ring-1 ring-violet-400" : ""}`}
            >
              {c.day}
              {tag && !isSelected && (
                <span className={`absolute bottom-0.5 w-1 h-1 rounded-full ${dotColor[tag] || dotColor.other}`} />
              )}
            </button>
          );
        })}
      </div>
      <div className={`flex flex-wrap gap-3 mt-4 pt-4 border-t text-[11px] ${t.border} ${t.mutedText}`}>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-violet-400" />Developer</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-sky-400" />Client Meeting</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Team Meeting</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full ring-1 ring-violet-400" />Today</span>
      </div>
    </div>
  );
}

function MeetingCard({ m, onOpen, onDecline, onReschedule, showDecline = true, darkMode = false }) {
  const t = useTheme(darkMode);
  const declined = m.status === "Declined";
  const cancelled = m.status === "Cancelled";
  const missed = isMeetingMissed(m);
  const today = !missed && isMeetingToday(m);
  const highlightCls = missed
    ? darkMode ? "bg-rose-500/10 border border-rose-500/50" : "bg-rose-50 border border-rose-300"
    : today
    ? darkMode ? "bg-sky-500/10 border border-sky-500/50" : "bg-sky-50 border border-sky-300"
    : t.card;
  return (
    <div className={`rounded-xl p-4 shadow-sm flex flex-col gap-3 ${highlightCls}`}>
      {missed ? (
        <div className={`-mt-1 text-[11px] font-semibold ${darkMode ? "text-rose-300" : "text-rose-600"}`}>
          Missed — this meeting's time has passed
        </div>
      ) : today ? (
        <div className={`-mt-1 text-[11px] font-semibold ${darkMode ? "text-sky-300" : "text-sky-600"}`}>
          Today, this meeting and timing:- Please attend
        </div>
      ) : null}
      <div className="flex items-start justify-between">
        <button onClick={() => onOpen(m)} className="text-left">
          <h4 className={`font-semibold text-[15px] ${t.cardText}`}>{m.title}</h4>
        </button>
        <button className={`text-lg leading-none ${t.mutedText} hover:${t.cardText}`}>⋯</button>
      </div>
      <span className={`w-fit text-[11px] px-2 py-0.5 rounded-full ${typeBadge(m.type, darkMode)}`}>
        <span className="inline-block w-1.5 h-1.5 rounded-full mr-1 bg-current" />
        {m.type}
      </span>
      <div className={`text-[13px] ${t.mutedText}`}>{m.project}</div>
      <div className={`flex items-center gap-4 text-[12px] ${t.subtleText}`}>
        <span className="flex items-center gap-1"><CalendarDays size={12} />{m.date}</span>
        <span className="flex items-center gap-1"><Clock size={12} />{m.time}</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {m.participants.slice(0, 3).map((p, i) => (
            <Avatar key={p} name={p} idx={i} ring={darkMode ? "ring-2 ring-slate-900" : "ring-2 ring-white"} />
          ))}
          {m.participants.length > 3 && (
            <div className={`w-7 h-7 rounded-full text-[10px] flex items-center justify-center ${darkMode ? "bg-slate-700 text-slate-200 ring-2 ring-slate-900" : "bg-slate-200 text-slate-700 ring-2 ring-white"}`}>
              +{m.participants.length - 3}
            </div>
          )}
        </div>
        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(m.status, darkMode)}`}>
          ● {m.status}
        </span>
      </div>
      <div className={`flex items-center justify-between pt-2 border-t text-[12px] ${t.border}`}>
        <button
          onClick={() => onOpen(m)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90"
        >
          <Video size={13} /> Join Meeting
        </button>
        {declined ? (
          <span className="text-rose-500">Declined</span>
        ) : cancelled ? (
          <span className="text-rose-500">Cancelled</span>
        ) : showDecline ? (
          <div className={`text-right leading-tight ${t.mutedText}`}>
            <div>Can't attend?</div>
            <div>
              <button onClick={() => onReschedule && onReschedule(m)} className={`underline hover:${t.cardText}`}>Reschedule</button>{" "}
              /{" "}
              <button onClick={() => onDecline(m.id)} className="underline hover:text-rose-500">
                Decline
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RequestRow({ r, onApprove, onReject, error, darkMode = false }) {
  const t = useTheme(darkMode);
  return (
    <div className={`grid grid-cols-1 md:grid-cols-[1.6fr_2fr_1.3fr_auto] items-start md:items-center gap-3 md:gap-4 py-3 border-b last:border-0 ${t.border}`}>
      <div className="flex items-center gap-3">
        <Avatar name={r.name} size="w-9 h-9" />
        <div>
          <div className={`text-[13px] font-medium ${t.cardText}`}>{r.name}</div>
          <div className={`text-[11px] ${t.mutedText}`}>{r.role}</div>
          <div className={`text-[10px] ${t.subtleText}`}>{r.org}</div>
        </div>
      </div>
      <div className={`text-[12px] pl-12 md:pl-0 ${t.mutedText}`}>
        <span className={t.subtleText}>Reason: </span>
        {r.reason}
      </div>
      <div className={`text-[12px] space-y-0.5 pl-12 md:pl-0 ${t.mutedText}`}>
        <div className="flex items-center gap-1"><CalendarDays size={12} />{r.date} <Clock size={12} className="ml-2" />{r.time}</div>
        <div className={t.subtleText}>Project: <span className={t.mutedText}>{r.project}</span></div>
      </div>
      <div className="flex flex-col items-center md:items-end gap-1 text-[12px] pl-12 md:pl-0">
        {r.status === "pending" ? (
          <>
            <div className="flex flex-row md:flex-col items-center md:items-end gap-2 md:gap-1">
              <button onClick={() => onApprove(r.id)} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white px-4 py-1.5 rounded-lg w-24 font-medium">
                Approve
              </button>
              <div className={`flex gap-2 ${t.mutedText}`}>
                <button onClick={() => onReject(r.id)} className="hover:text-rose-500 underline">Reject</button>
                <button className={`hover:${t.cardText} underline`}>Reschedule</button>
              </div>
            </div>
            {error && <div className="text-[11px] text-rose-500 max-w-[180px] text-right">{error}</div>}
          </>
        ) : (
          <span className={`px-3 py-1 rounded-full text-[11px] font-medium ${r.status === "approved" ? statusBadge("Upcoming", darkMode) : statusBadge("Declined", darkMode)}`}>
            {r.status === "approved" ? "Approved" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  );
}

function MeetingDetailsModal({ meeting, onClose, isAdmin = false, onSetLink, onReschedule, onRequestReschedule, onCancelMeeting, onDeleteMeeting, checkConflict, initialReschedule = false, user, darkMode = false }) {
  const t = useTheme(darkMode);
  const [linkInput, setLinkInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rDate, setRDate] = useState("");
  const [rTime, setRTime] = useState("");
  const [rReason, setRReason] = useState("");
  const [rError, setRError] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setLinkInput(meeting?.meetLink || "");
    setSaved(false);
    setRescheduling(!!initialReschedule && !!meeting);
    setRDate(meeting?.rawDate || "");
    setRTime(meeting?.rawTime || "");
    setRReason("");
    setRError("");
    setRequestSent(false);
    setCancelling(false);
    setDeleting(false);
  }, [meeting, initialReschedule]);

  if (!meeting) return null;
  const hasLink = !!meeting.meetLink;
  const isCancelled = meeting.status === "Cancelled";

  const openReschedule = () => {
    setRDate(meeting.rawDate);
    setRTime(meeting.rawTime);
    setRReason("");
    setRError("");
    setRequestSent(false);
    setRescheduling(true);
  };

  const handleSaveReschedule = () => {
    if (!rDate || !rTime) {
      setRError("Please pick a date and time.");
      return;
    }
    if (isAdmin) {
      if (checkConflict && checkConflict(rDate, rTime, meeting.id)) {
        setRError("There's already a meeting at this date and time — please choose a different slot.");
        return;
      }
      onReschedule && onReschedule(meeting.id, rDate, rTime);
      setRescheduling(false);
    } else {
      if (!rReason.trim()) {
        setRError("Please tell us why you'd like to reschedule.");
        return;
      }
      onRequestReschedule && onRequestReschedule({
        meetingId: meeting.id,
        name: user?.name,
        role: user?.role,
        project: meeting.project,
        reason: rReason,
        rawDate: rDate,
        rawTime: rTime,
      });
      setRError("");
      setRequestSent(true);
    }
  };

  const handleCancelMeeting = () => {
    onCancelMeeting && onCancelMeeting(meeting.id);
    onClose();
  };

  const handleDeleteMeeting = () => {
    onDeleteMeeting && onDeleteMeeting(meeting.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-sm p-5 shadow-2xl relative ${t.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className={`absolute top-4 right-4 ${t.mutedText} hover:${t.cardText}`}>
          <X size={18} />
        </button>
        <div className={`flex items-center gap-2 text-[12px] mb-3 ${t.mutedText}`}>
          <CalendarDays size={14} /> Meeting Details
        </div>
        <div className="flex items-center gap-2 mb-1">
          <h3 className={`font-semibold text-[16px] ${t.cardText}`}>{meeting.title}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${typeBadge(meeting.type, darkMode)}`}>{meeting.type}</span>
        </div>
        <div className={`text-[12px] mb-3 ${t.mutedText}`}>{meeting.project}</div>
        <div className={`flex items-center gap-4 text-[12px] mb-4 ${t.mutedText}`}>
          <span className="flex items-center gap-1"><CalendarDays size={12} />{meeting.date}</span>
          <span className="flex items-center gap-1"><Clock size={12} />{meeting.time}</span>
        </div>

        <div className={`text-[12px] mb-1 ${t.mutedText}`}>Agenda</div>
        <ul className={`text-[13px] space-y-1 mb-4 list-disc list-inside ${t.cardText}`}>
          {meeting.agenda.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>

        <div className={`text-[12px] mb-2 ${t.mutedText}`}>Participants ({meeting.participants.length})</div>
        <div className="flex gap-3 mb-4 flex-wrap">
          {meeting.participants.map((p, i) => (
            <div key={p} className="flex flex-col items-center gap-1">
              <Avatar name={p} size="w-10 h-10" idx={i} />
              <span className={`text-[10px] max-w-[52px] truncate text-center ${t.mutedText}`}>{p}</span>
            </div>
          ))}
        </div>

        {isAdmin && (
          <div className="mb-4">
            <label className={`text-[12px] flex items-center gap-1 ${t.mutedText}`}><LinkIcon size={12} /> Google Meet link</label>
            <div className="flex gap-2 mt-1">
              <input
                value={linkInput}
                onChange={(e) => { setLinkInput(e.target.value); setSaved(false); }}
                placeholder="https://meet.google.com/xxx-xxxx-xxx"
                className={`flex-1 border rounded-lg px-3 py-2 text-[12.5px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`}
              />
              <button
                onClick={() => { onSetLink(meeting.id, linkInput.trim()); setSaved(true); }}
                className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[12px] font-medium px-3 rounded-lg"
              >
                Save
              </button>
            </div>
            {saved && <div className="text-[11px] text-emerald-500 mt-1">Link saved — participants will also see this link now.</div>}
          </div>
        )}

        {rescheduling ? (
          requestSent ? (
            <div className={`rounded-xl p-4 mb-1 text-center ${darkMode ? "bg-emerald-500/10" : "bg-emerald-50"}`}>
              <CheckCircle2 size={22} className="text-emerald-500 mx-auto mb-1.5" />
              <div className={`text-[12.5px] font-medium ${t.cardText}`}>Reschedule request sent</div>
              <div className={`text-[11.5px] mt-1 ${t.mutedText}`}>Waiting for admin approval — you'll see it reflected here once approved.</div>
              <button
                onClick={onClose}
                className="mt-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[12.5px] font-medium px-4 py-1.5 rounded-lg"
              >
                Close
              </button>
            </div>
          ) : (
            <div className={`rounded-xl p-3 mb-1 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
              <div className={`text-[12px] mb-2 ${t.mutedText}`}>
                {isAdmin ? "Pick a new date & time" : "Request a new date & time"}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={rDate}
                  onChange={(e) => { setRDate(e.target.value); setRError(""); }}
                  className={`w-full border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`}
                />
                <input
                  type="time"
                  value={rTime}
                  onChange={(e) => { setRTime(e.target.value); setRError(""); }}
                  className={`w-full border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`}
                />
              </div>
              {!isAdmin && (
                <textarea
                  value={rReason}
                  onChange={(e) => { setRReason(e.target.value); setRError(""); }}
                  rows={2}
                  placeholder="Why would you like to reschedule?"
                  className={`w-full mt-2 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 resize-none ${t.inputCls}`}
                />
              )}
              {rError && <p className="text-[11.5px] text-rose-500 mt-2">{rError}</p>}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setRescheduling(false)}
                  className={`flex-1 text-[12.5px] font-medium py-2 rounded-lg ${darkMode ? "bg-slate-700 hover:bg-slate-600 text-slate-200" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveReschedule}
                  className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[12.5px] font-medium py-2 rounded-lg"
                >
                  {isAdmin ? "Save New Time" : "Send Request"}
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="flex gap-2">
            {hasLink ? (
              <a
                href={meeting.meetLink}
                target="_blank"
                rel="noreferrer"
                className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[13px] font-medium py-2 rounded-lg flex items-center justify-center gap-1.5"
              >
                <Video size={14} /> Join Meeting
              </a>
            ) : (
              <button disabled className={`flex-1 text-[13px] font-medium py-2 rounded-lg flex items-center justify-center gap-1.5 cursor-not-allowed ${darkMode ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-400"}`}>
                <Video size={14} /> {isAdmin ? "Add link above" : "Link not added yet"}
              </button>
            )}
            <button
              onClick={openReschedule}
              disabled={isCancelled}
              className={`flex-1 text-[13px] font-medium py-2 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed ${darkMode ? "bg-slate-800 hover:bg-slate-700 text-slate-200" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}
            >
              Reschedule
            </button>
          </div>
        )}
        {isAdmin && !rescheduling && (
          isCancelled ? (
            <div className="w-full mt-2 text-center text-rose-500 text-[12px] py-1.5">This meeting has been cancelled.</div>
          ) : cancelling ? (
            <div className={`flex items-center justify-center gap-3 mt-2 text-[12px] ${t.mutedText}`}>
              <span>Cancel this meeting?</span>
              <button onClick={handleCancelMeeting} className="text-rose-500 font-medium hover:text-rose-600 underline">Yes, cancel</button>
              <button onClick={() => setCancelling(false)} className={`underline hover:${t.cardText}`}>No</button>
            </div>
          ) : (
            <button onClick={() => setCancelling(true)} className="w-full mt-2 text-rose-500 hover:text-rose-600 text-[12px] py-1.5">
              Cancel Meeting
            </button>
          )
        )}
        {/* Delete: fully removes the meeting record (unlike Cancel, which
            just flips status but keeps it). Always available to admin,
            even for an already-cancelled meeting, so old/cancelled
            entries can actually be cleared out. */}
        {isAdmin && !rescheduling && (
          deleting ? (
            <div className={`flex items-center justify-center gap-3 mt-1 text-[12px] ${t.mutedText}`}>
              <span>Permanently delete this meeting?</span>
              <button onClick={handleDeleteMeeting} className="text-rose-600 font-semibold hover:text-rose-700 underline">Yes, delete</button>
              <button onClick={() => setDeleting(false)} className={`underline hover:${t.cardText}`}>No</button>
            </div>
          ) : (
            <button onClick={() => setDeleting(true)} className={`w-full mt-1 text-[12px] py-1.5 ${t.subtleText} hover:text-rose-600`}>
              Delete Meeting
            </button>
          )
        )}
      </div>
    </div>
  );
}

function ScheduleModal({ open, onClose, onCreate, checkConflict, darkMode = false }) {
  const t = useTheme(darkMode);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Team");
  const [project, setProject] = useState("");
  const [date, setDate] = useState(() => isoDateOffset(1));
  const [time, setTime] = useState("10:00");
  const [error, setError] = useState("");

  // Registered users, for picking WHO (which developer or client) this
  // meeting is actually with — fetched fresh every time the modal opens,
  // not just once, so a just-approved user shows up without a page reload.
  const [registeredUsers, setRegisteredUsers] = useState([]);
  const [withUserId, setWithUserId] = useState("");

  useEffect(() => {
    if (open) getRegisteredUsers().then(setRegisteredUsers);
  }, [open]);

  // Client meeting -> pick from registered Clients; Team/Developer
  // meeting -> pick from registered internal staff (everyone else).
  // Re-filtered on every render from registeredUsers/type, no separate
  // state to keep in sync.
  const matchingUsers = registeredUsers.filter(
    (u) => u.status === "approved" && (type === "Client" ? u.role === "client" : u.role !== "client")
  );

  // Selected person no longer valid after switching Type (client list vs
  // team list) — clear it instead of silently keeping a stale pick.
  useEffect(() => { setWithUserId(""); }, [type]);

  if (!open) return null;

  const handleSchedule = () => {
    if (checkConflict(date, time)) {
      setError("There's already a meeting at this date and time — please choose a different slot.");
      return;
    }
    const withUser = matchingUsers.find((u) => String(u.id) === withUserId);
    onCreate({ title, type, project: project || "Untitled Project", rawDate: date, rawTime: time, withName: withUser?.name });
    setTitle("");
    setProject("");
    setWithUserId("");
    setError("");
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl relative ${t.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className={`absolute top-4 right-4 ${t.mutedText} hover:${t.cardText}`}>
          <X size={18} />
        </button>
        <h3 className={`font-semibold text-[16px] mb-4 flex items-center gap-2 ${t.cardText}`}>
          <CalendarPlus size={18} className="text-violet-500" /> Schedule a New Meeting
        </h3>

        <div className="space-y-3">
          <div>
            <label className={`text-[12px] ${t.mutedText}`}>Meeting title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sprint Planning"
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value)}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`}>
                <option>Team</option>
                <option>Client</option>
                <option>Developer</option>
              </select>
            </div>
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Project</label>
              <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="Project name"
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
          </div>
          <div>
            <label className={`text-[12px] ${t.mutedText}`}>
              With ({type === "Client" ? "registered client" : "registered team member"})
            </label>
            <select value={withUserId} onChange={(e) => setWithUserId(e.target.value)}
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`}>
              <option value="">Select a person (optional)</option>
              {matchingUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
              ))}
            </select>
            {matchingUsers.length === 0 && (
              <p className={`text-[11px] mt-1 ${t.subtleText}`}>
                No registered {type === "Client" ? "clients" : "team members"} found yet.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Date</label>
              <input type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(""); }}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Time</label>
              <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setError(""); }}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
          </div>
          {error && <p className="text-[12px] text-rose-500">{error}</p>}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 text-[13px] font-medium py-2 rounded-lg ${darkMode ? "bg-slate-800 hover:bg-slate-700 text-slate-200" : "bg-slate-100 hover:bg-slate-200 text-slate-700"}`}>
            Cancel
          </button>
          <button
            disabled={!title.trim() || !date || !time}
            onClick={handleSchedule}
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed text-white text-[13px] font-medium py-2 rounded-lg"
          >
            Schedule Meeting
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   CLIENT REQUEST FORM (standalone full page — client portal route)
   ---------------------------------------------------------------------
   import { ClientRequestMeeting } from "./Meetings";
===================================================================== */

export function ClientRequestMeeting({ clientName = "", project = "", darkMode = false }) {
  const t = useTheme(darkMode);
  const [name, setName] = useState(clientName);
  const [projectName, setProjectName] = useState(project);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter your name.");
    if (!projectName.trim()) return setError("Please enter the project name.");
    if (!reason.trim()) return setError("Please tell us what the meeting is about.");
    if (!date || !time) return setError("Please select a date and time for the meeting.");

    setError("");
    submitMeetingRequest({
      name, role: "Client", project: projectName, reason, rawDate: date, rawTime: time,
    })
      .then((request) => setSubmitted(request))
      .catch((err) => setError(err.message));
  };

  const handleAnother = () => {
    setSubmitted(null);
    setReason("");
    setDate("");
    setTime("");
  };

  if (submitted) {
    return (
      <div className={`rounded-2xl w-full max-w-md mx-auto p-8 text-center shadow-sm ${t.card}`}>
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={26} className="text-emerald-500" />
        </div>
        <h2 className={`font-semibold text-[18px] mb-1 ${t.cardText}`}>Request sent</h2>
        <p className={`text-[13px] mb-5 ${t.mutedText}`}>
          Your meeting request has been sent to the team. Please wait for confirmation — you'll be notified of the schedule as soon as it's approved.
        </p>
        <div className={`rounded-xl p-4 text-left text-[12.5px] space-y-1.5 mb-6 ${darkMode ? "bg-slate-800" : "bg-slate-50"} ${t.mutedText}`}>
          <div className="flex items-center gap-2"><CalendarDays size={13} className="text-violet-500" /> {submitted.date}</div>
          <div className="flex items-center gap-2"><Clock size={13} className="text-violet-500" /> {submitted.time}</div>
          <div>Project: <span className={t.cardText}>{submitted.project}</span></div>
        </div>
        <button onClick={handleAnother} className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[13px] font-medium py-2.5 rounded-lg">
          Request another meeting
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`rounded-2xl w-full max-w-md mx-auto p-6 shadow-sm ${t.card}`}>
      <h2 className={`font-semibold text-[17px] mb-1 flex items-center gap-2 ${t.cardText}`}>
        <CalendarPlus size={18} className="text-violet-500" /> Request a Meeting
      </h2>
      <p className={`text-[12.5px] mb-5 ${t.subtleText}`}>
        Need to talk to the team — any issue, feedback, or updates — send a request from here.
      </p>

      {/* Who this request actually goes to — every request is reviewed
          and approved by the Admin, so this is shown up front rather
          than left unstated. */}
      <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2 mb-4 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
        <Avatar name="Admin" size="w-8 h-8" />
        <div>
          <div className={`text-[11px] ${t.mutedText}`}>Meeting with</div>
          <div className={`text-[13px] font-medium ${t.cardText}`}>Admin</div>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label className={`text-[12px] ${t.mutedText}`}>Your name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah Khan"
            className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
        </div>
        <div>
          <label className={`text-[12px] ${t.mutedText}`}>Project</label>
          <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Luxora E-commerce Website"
            className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
        </div>
        <div>
          <label className={`text-[12px] ${t.mutedText}`}>What would you like to discuss?</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Describe your issue or discussion point here..."
            className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 resize-none ${t.inputCls}`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`text-[12px] ${t.mutedText}`}>Preferred date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
          </div>
          <div>
            <label className={`text-[12px] ${t.mutedText}`}>Preferred time</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
          </div>
        </div>
        {error && <p className="text-[12px] text-rose-500">{error}</p>}
      </div>

      <button type="submit" className="w-full mt-5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[13px] font-medium py-2.5 rounded-lg">
        Send Request
      </button>
    </form>
  );
}

/* =====================================================================
   ADMIN AVAILABILITY — shared card (read-only) + admin-only edit modal.
   Same /api/meetings/availability/ row dono taraf (Admin view +
   UserMeetings, jo ClientPortal ke andar bhi embed hoti hai) use karta
   hai, isi liye admin ka "Edit" se saved change (agle poll tick par)
   turant dono jagah dikh jata hai.
===================================================================== */

/** Read-only card — Admin apni khud ki availability yahi se dekhta hai (with Edit button),
 *  aur User/Client view mein bhi yahi card "Admin Availability" ke naam se dikhta hai. */
function AvailabilityCard({ availability, darkMode = false, title = "My Availability", onEdit }) {
  const t = useTheme(darkMode);
  const availableLabel = `${formatAvailabilityDays(availability.days)} \u00a0 ${formatTimePretty(availability.startTime)} – ${formatTimePretty(availability.endTime)}`;
  const unavailableDays = WEEK_DAYS.filter((d) => !(availability.days || []).includes(d));

  return (
    <div className={`rounded-xl p-5 shadow-sm ${t.card}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-semibold text-[14px] ${t.cardText}`}>{title}</h3>
        {onEdit && (
          <button onClick={onEdit} className="text-violet-500 text-[12px] font-medium hover:underline">
            Edit
          </button>
        )}
      </div>
      {availability.active !== false ? (
        <>
          <div className="flex items-start gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5" />
            <div>
              <div className={`text-[12.5px] ${t.cardText}`}>Available for meetings</div>
              <div className={`text-[11px] ${t.subtleText}`}>{availableLabel}</div>
            </div>
          </div>
          {unavailableDays.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="w-2 h-2 rounded-full bg-rose-400 mt-1.5" />
              <div>
                <div className={`text-[12.5px] ${t.cardText}`}>Unavailable</div>
                <div className={`text-[11px] ${t.subtleText}`}>{formatAvailabilityDays(unavailableDays)}</div>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-start gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-400 mt-1.5" />
          <div>
            <div className={`text-[12.5px] ${t.cardText}`}>Currently unavailable</div>
            <div className={`text-[11px] ${t.subtleText}`}>Not accepting meetings right now</div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Admin-only modal — days (multi-select) + start/end time + active toggle. */
function AvailabilityEditModal({ availability, onClose, onSave, darkMode = false }) {
  const t = useTheme(darkMode);
  const [active, setActive] = useState(availability.active !== false);
  const [days, setDays] = useState(availability.days || []);
  const [startTime, setStartTime] = useState(availability.startTime || "09:00");
  const [endTime, setEndTime] = useState(availability.endTime || "18:00");
  const [error, setError] = useState("");

  const toggleDay = (d) => setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (active && days.length === 0) return setError("Please select at least one day.");
    if (active && startTime >= endTime) return setError("End time must be after start time.");
    onSave({ active, days, startTime, endTime });
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} className={`rounded-2xl w-full max-w-md p-5 sm:p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto ${t.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className={`absolute top-4 right-4 ${t.mutedText} hover:${t.cardText}`}>
          <X size={18} />
        </button>
        <h2 className={`font-semibold text-[16px] sm:text-[17px] mb-1 flex items-center gap-2 pr-6 ${t.cardText}`}>
          <CalendarDays size={18} className="text-violet-500 shrink-0" /> Edit Availability
        </h2>
        <p className={`text-[12.5px] mb-5 ${t.subtleText}`}>This will be shown to clients and developers as your "Admin Availability".</p>

        <div className="space-y-4">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span className={`text-[12.5px] font-medium ${t.cardText}`}>Available for meetings</span>
            <button
              type="button"
              role="switch"
              aria-checked={active}
              onClick={() => setActive((a) => !a)}
              className={`relative inline-flex shrink-0 items-center w-11 h-6 rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-1 ${
                active ? "bg-violet-600" : darkMode ? "bg-slate-700" : "bg-slate-300"
              }`}
            >
              <span
                className={`inline-block w-5 h-5 rounded-full bg-white shadow transform transition-transform duration-200 ease-in-out ${
                  active ? "translate-x-[22px]" : "translate-x-0.5"
                }`}
              />
            </button>
          </label>

          <div>
            <label className={`text-[12px] ${t.mutedText}`}>Available days</label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {WEEK_DAYS.map((d) => (
                <button
                  type="button"
                  key={d}
                  onClick={() => toggleDay(d)}
                  className={`text-[12px] px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                    days.includes(d)
                      ? "bg-violet-600 border-violet-600 text-white"
                      : `${t.inputCls} hover:border-violet-400`
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Start time</label>
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>End time</label>
              <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
          </div>
          {error && <p className="text-[12px] text-rose-500">{error}</p>}
        </div>

        <button type="submit" className="w-full mt-5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[13px] font-medium py-2.5 rounded-lg">
          Save Availability
        </button>
      </form>
    </div>
  );
}

/** Row for a pending/handled reschedule request — shows the linked meeting's
 *  current slot alongside the requested new slot + reason, admin approves/rejects. */
function RescheduleRequestRow({ req, meeting, onApprove, onReject, error, darkMode = false }) {
  const t = useTheme(darkMode);
  return (
    <div className={`grid grid-cols-1 md:grid-cols-[1.6fr_2fr_1.3fr_auto] items-start md:items-center gap-3 md:gap-4 py-3 border-b last:border-0 ${t.border}`}>
      <div className="flex items-center gap-3">
        <Avatar name={req.name} size="w-9 h-9" />
        <div>
          <div className={`text-[13px] font-medium ${t.cardText}`}>{req.name}</div>
          <div className={`text-[11px] ${t.mutedText}`}>{req.role}</div>
          <div className={`text-[10px] ${t.subtleText}`}>{meeting ? meeting.title : req.project}</div>
        </div>
      </div>
      <div className={`text-[12px] pl-12 md:pl-0 ${t.mutedText}`}>
        <span className={t.subtleText}>Reason: </span>
        {req.reason}
      </div>
      <div className={`text-[12px] space-y-0.5 pl-12 md:pl-0 ${t.mutedText}`}>
        {meeting && (
          <div className={t.subtleText}>Currently: <span className={t.mutedText}>{meeting.date}, {formatTimePretty(meeting.rawTime)}</span></div>
        )}
        <div className="flex items-center gap-1"><CalendarDays size={12} />Requested: {req.date} <Clock size={12} className="ml-2" />{req.time}</div>
      </div>
      <div className="flex flex-col items-center md:items-end gap-1 text-[12px] pl-12 md:pl-0">
        {req.status === "pending" ? (
          <>
            <div className="flex flex-row md:flex-col items-center md:items-end gap-2 md:gap-1">
              <button onClick={onApprove} className="bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white px-4 py-1.5 rounded-lg w-28 font-medium">
                Approve
              </button>
              <button onClick={onReject} className={`hover:text-rose-500 underline ${t.mutedText}`}>Reject</button>
            </div>
            {error && <div className="text-[11px] text-rose-500 max-w-[180px] text-right">{error}</div>}
          </>
        ) : (
          <span className={`px-3 py-1 rounded-full text-[11px] font-medium ${req.status === "approved" ? statusBadge("Upcoming", darkMode) : statusBadge("Declined", darkMode)}`}>
            {req.status === "approved" ? "Approved" : "Rejected"}
          </span>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   ADMIN MEETINGS PAGE — sab meetings + sab requests dikhta hai.
   ---------------------------------------------------------------------
   Dashboard.jsx isko already is tarah render karta hai:
     {active === "Meetings" && <MeetingsPage darkMode={darkMode} />}
   Isi liye ye component apna koi sidebar/topbar/background nahi
   lagata — Dashboard ka <main> (padding + scroll) aur uska darkMode
   state hi yahan follow hota hai, baaki pages (TasksPage waghera) ki
   tarah.
===================================================================== */

export default function MeetingsDashboard({ darkMode = false }) {
  // Dashboard.jsx renders this same component for EVERY logged-in role
  // (`{active === "Meetings" && <MeetingsPage darkMode={darkMode} />}`) —
  // so the admin-vs-user split has to happen in here, the same way
  // TasksPage.jsx decides `canSeeAllTasks` from the logged-in user's role.
  //
  // Routed through hasFullSubPageAccess("Meetings") (AuthContext) instead
  // of a raw role check, so someone an admin has explicitly granted
  // page-access "Full Access" (described there as "same as Admin"), OR
  // just the more targeted "Full Meetings Access" toggle for this one
  // page (UserPage's Manage Access modal), actually gets the admin-wide
  // Meetings view too — not just a spot in the sidebar. True for real
  // admins/managers always, same as before.
  const { user, hasFullSubPageAccess } = useAuth();
  const isAdminOrManager =
    user?.role === "admin" || getRoleCategory(user?.role) === "manager" || hasFullSubPageAccess("Meetings");

  if (!isAdminOrManager) {
    return (
      <UserMeetings
        darkMode={darkMode}
        user={{ name: user?.name || "You", role: user?.role || "Client" }}
      />
    );
  }

  return <AdminMeetingsView darkMode={darkMode} user={{ name: user?.name || "You", role: user?.role || "admin" }} />;
}

/** Admin/manager view — sab meetings + sab requests. */
function AdminMeetingsView({ darkMode = false, user = { name: "You", role: "admin" } }) {
  const t = useTheme(darkMode);
  const [meetings, setMeetings] = useState([]);
  const [requests, setRequests] = useState([]);
  const [rescheduleRequests, setRescheduleRequests] = useState([]);
  const [approveErrors, setApproveErrors] = useState({});
  const [rescheduleErrors, setRescheduleErrors] = useState({});
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [autoReschedule, setAutoReschedule] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [availability, setAvailability] = useState({ active: true, startTime: "09:00", endTime: "18:00", days: [] });
  const [availabilityEditOpen, setAvailabilityEditOpen] = useState(false);

  // Each subscribe call fires an immediate fetch on mount (covering the
  // initial load) and then keeps polling — see pollResource() above.
  useEffect(() => subscribeToMeetings(setMeetings), []);
  useEffect(() => subscribeToRequests(setRequests), []);
  useEffect(() => subscribeToRescheduleRequests(setRescheduleRequests), []);
  useEffect(() => subscribeToAvailability(setAvailability), []);

  // Belt-and-suspenders: kabhi bhi (network hiccup, kisi bug ki wajah se)
  // ye array na ho, to yahin se hamesha safe array mil jaye — taake neeche
  // .filter/.map/.length kahin bhi crash na kare.
  const safeRescheduleRequests = Array.isArray(rescheduleRequests) ? rescheduleRequests : [];

  const handleSaveAvailability = (data) => {
    saveAvailability(data)
      .then((saved) => { setAvailability(saved); setAvailabilityEditOpen(false); })
      .catch((err) => alert(err.message));
  };

  const pendingCount = useMemo(() => requests.filter((r) => r.status === "pending").length, [requests]);
  const pendingRescheduleCount = useMemo(() => safeRescheduleRequests.filter((r) => r.status === "pending").length, [safeRescheduleRequests]);

  // Passed into modals as `checkConflict` — a synchronous read against
  // whatever `meetings` is already in state, so MeetingDetailsModal /
  // ScheduleModal need zero changes of their own. The server re-checks
  // the exact same rule on every write, so this is purely a fast,
  // optimistic pre-check.
  const checkConflict = (rawDate, rawTime, excludeId) => isSlotTaken(meetings, rawDate, rawTime, excludeId);

  const handleDecline = (id) => {
    updateMeetingStatus(id, "Declined")
      .then((m) => setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x))))
      .catch((err) => alert(err.message));
  };
  const handleCancelMeeting = (id) => {
    updateMeetingStatus(id, "Cancelled")
      .then((m) => setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x))))
      .catch((err) => alert(err.message));
  };
  const handleDeleteMeeting = (id) => {
    deleteMeeting(id)
      .then(() => setMeetings((prev) => prev.filter((x) => x.id !== id)))
      .catch((err) => alert(err.message));
  };
  const handleReschedule = (id, rawDate, rawTime) => {
    rescheduleMeeting(id, rawDate, rawTime)
      .then((m) => setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x))))
      .catch((err) => alert(err.message));
  };
  const handleSetLink = (id, meetLink) => {
    setMeetingLink(id, meetLink)
      .then((m) => setMeetings((prev) => prev.map((x) => (x.id === m.id ? m : x))))
      .catch((err) => alert(err.message));
  };
  const openReschedule = (m) => { setActiveMeeting(m); setAutoReschedule(true); };
  const handleOpenMeeting = (m) => { setActiveMeeting(m); setAutoReschedule(false); };

  const handleApproveReschedule = (req) => {
    if (isSlotTaken(meetings, req.rawDate, req.rawTime, req.meetingId)) {
      setRescheduleErrors((prev) => ({ ...prev, [req.id]: "This slot is already booked — reject or ask for a different time." }));
      return;
    }
    // approveReschedule() moves the underlying Meeting's date/time AND
    // marks the request approved, atomically, server-side — no separate
    // rescheduleMeeting() call needed here.
    approveReschedule(req.id)
      .then((updatedReq) => {
        setRescheduleErrors((prev) => ({ ...prev, [req.id]: undefined }));
        setRescheduleRequests((prev) => prev.map((r) => (r.id === updatedReq.id ? updatedReq : r)));
        setMeetings((prev) => prev.map((m) => (m.id === req.meetingId ? { ...m, rawDate: req.rawDate, rawTime: req.rawTime, date: formatDatePretty(req.rawDate), time: formatTimeRangePretty(req.rawTime) } : m)));
      })
      .catch((err) => setRescheduleErrors((prev) => ({ ...prev, [req.id]: err.message })));
  };

  const handleRejectReschedule = (id) => {
    setRescheduleErrors((prev) => ({ ...prev, [id]: undefined }));
    rejectReschedule(id)
      .then((updatedReq) => setRescheduleRequests((prev) => prev.map((r) => (r.id === updatedReq.id ? updatedReq : r))))
      .catch((err) => alert(err.message));
  };

  const handleApprove = (r) => {
    if (isSlotTaken(meetings, r.rawDate, r.rawTime)) {
      setApproveErrors((prev) => ({ ...prev, [r.id]: "This slot is already booked — please reschedule first." }));
      return;
    }
    // approveRequest() creates the Meeting AND marks the request approved,
    // atomically, server-side — no separate createMeeting() call needed.
    approveRequest(r.id)
      .then((updatedReq) => {
        setApproveErrors((prev) => ({ ...prev, [r.id]: undefined }));
        setRequests((prev) => prev.map((x) => (x.id === updatedReq.id ? updatedReq : x)));
        // Pull the freshly-created meeting in immediately instead of
        // waiting for the next poll tick.
        getMeetings().then(setMeetings).catch(() => {});
      })
      .catch((err) => setApproveErrors((prev) => ({ ...prev, [r.id]: err.message })));
  };

  const handleReject = (id) => {
    setApproveErrors((prev) => ({ ...prev, [id]: undefined }));
    rejectRequest(id)
      .then((updatedReq) => setRequests((prev) => prev.map((x) => (x.id === updatedReq.id ? updatedReq : x))))
      .catch((err) => alert(err.message));
  };

  const handleCreate = ({ title, type, project, rawDate, rawTime, withName }) => {
    // Selected registered developer/client + the admin/manager scheduling
    // it — de-duped in case they pick themselves. Before this, only
    // `user.name` (whoever was scheduling) was ever saved, so the other
    // side of the meeting never actually showed up.
    const participants = [...new Set([user.name, withName].filter(Boolean))];
    createMeeting({ title, type, project, rawDate, rawTime, participants })
      .then((m) => { setMeetings((prev) => [m, ...prev]); setScheduleOpen(false); })
      .catch((err) => alert(err.message));
  };

  const todaysMeetings = useMemo(() => {
    const todayISO = isoDateOffset(0);
    return meetings.filter((m) => m.rawDate === todayISO);
  }, [meetings]);


  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-base font-bold ${t.cardText}`}>Meetings</h2>
          <p className={`text-xs mt-0.5 ${t.subtleText}`}>Admin view — schedule, request and manage every team, client &amp; developer meeting</p>
        </div>
        <button
          onClick={() => setScheduleOpen(true)}
          className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-full transition shrink-0"
        >
          <Plus className="w-4 h-4" /> Schedule Meeting
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4 min-w-0">
          <section className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <div className="mb-4">
              <h3 className={`font-semibold text-[15px] ${t.cardText}`}>All Meetings</h3>
              <p className={`text-[12px] ${t.subtleText}`}>All team, client, and developer meetings in one place</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {meetings.map((m) => (
                <MeetingCard key={m.id} m={m} onOpen={handleOpenMeeting} onDecline={handleDecline} onReschedule={openReschedule} darkMode={darkMode} />
              ))}
              <button
                onClick={() => setScheduleOpen(true)}
                className={`rounded-xl border border-dashed flex flex-col items-center justify-center gap-3 py-8 transition-colors ${darkMode ? "border-slate-700 hover:border-violet-500/60 hover:bg-slate-800/40" : "border-slate-200 hover:border-violet-400 hover:bg-slate-50"}`}
              >
                <div className="w-12 h-12 rounded-xl bg-violet-500/15 flex items-center justify-center">
                  <CalendarPlus size={20} className="text-violet-500" />
                </div>
                <div className={`text-[13px] font-medium ${t.cardText}`}>Schedule a New Meeting</div>
                <div className={`text-[11px] px-4 text-center ${t.subtleText}`}>Plan a meeting with your team, client or developer.</div>
                <span className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[12px] font-medium px-3.5 py-1.5 rounded-lg">
                  <Plus size={13} /> Schedule Meeting
                </span>
              </button>
            </div>
          </section>

          <section className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <div className="mb-2">
              <h3 className={`font-semibold text-[15px] ${t.cardText}`}>Meeting Requests</h3>
              <p className={`text-[12px] ${t.subtleText}`}>Pending requests from developers and clients {pendingCount > 0 && `(${pendingCount} pending)`}</p>
            </div>
            <div>
              {requests.map((r) => (
                <RequestRow key={r.id} r={r} onApprove={() => handleApprove(r)} onReject={() => handleReject(r.id)} error={approveErrors[r.id]} darkMode={darkMode} />
              ))}
            </div>
          </section>

          <section className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <div className="mb-2">
              <h3 className={`font-semibold text-[15px] ${t.cardText}`}>Reschedule Requests</h3>
              <p className={`text-[12px] ${t.subtleText}`}>
                Requests to move an existing meeting to a new date &amp; time {pendingRescheduleCount > 0 && `(${pendingRescheduleCount} pending)`}
              </p>
            </div>
            {safeRescheduleRequests.length === 0 ? (
              <div className={`text-[12.5px] py-4 text-center ${t.subtleText}`}>No reschedule requests yet.</div>
            ) : (
              <div>
                {safeRescheduleRequests.map((req) => (
                  <RescheduleRequestRow
                    key={req.id}
                    req={req}
                    meeting={meetings.find((m) => m.id === req.meetingId)}
                    onApprove={() => handleApproveReschedule(req)}
                    onReject={() => handleRejectReschedule(req.id)}
                    error={rescheduleErrors[req.id]}
                    darkMode={darkMode}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <Calendar meetings={meetings} darkMode={darkMode} />

          <div className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <h3 className={`font-semibold text-[14px] flex items-center gap-2 mb-3 ${t.cardText}`}>
              <CalendarDays size={15} className="text-violet-500" /> Today's Meetings
            </h3>
            <div className="space-y-3">
              {todaysMeetings.length === 0 && <div className={`text-[12px] ${t.subtleText}`}>No meetings scheduled for today.</div>}
              {todaysMeetings.map((mtg) => (
                <div key={mtg.id} className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full mt-0.5 ${mtg.status === "Declined" ? "bg-rose-400" : "bg-emerald-400"}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12.5px] font-medium truncate ${t.cardText}`}>{mtg.title}</div>
                    <div className={`text-[11px] ${t.subtleText}`}>{mtg.participants.length} participants</div>
                  </div>
                  <div className="text-right">
                    <div className={`text-[11px] ${t.mutedText}`}>{mtg.time}</div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${statusBadge(mtg.status, darkMode)}`}>{mtg.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <AvailabilityCard
            availability={availability}
            darkMode={darkMode}
            title="My Availability"
            onEdit={() => setAvailabilityEditOpen(true)}
          />
        </div>
      </div>

      <MeetingDetailsModal
        meeting={activeMeeting}
        onClose={() => { setActiveMeeting(null); setAutoReschedule(false); }}
        isAdmin
        onSetLink={handleSetLink}
        onReschedule={handleReschedule}
        onCancelMeeting={handleCancelMeeting}
        onDeleteMeeting={handleDeleteMeeting}
        checkConflict={checkConflict}
        initialReschedule={autoReschedule}
        darkMode={darkMode}
      />
      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} onCreate={handleCreate} checkConflict={checkConflict} darkMode={darkMode} />
      {availabilityEditOpen && (
        <AvailabilityEditModal
          availability={availability}
          darkMode={darkMode}
          onClose={() => setAvailabilityEditOpen(false)}
          onSave={handleSaveAvailability}
        />
      )}
    </div>
  );
}

/* =====================================================================
   USER VIEW (client/developer) — sirf apni meetings + apni requests,
   aur "Request a Meeting" ka option. Ye bhi Dashboard.jsx ki tarah
   koi bhi parent shell (client-portal wrapper) apna sidebar/topbar aur
   darkMode already de raha ho to seedha embed ho jayega.
   ---------------------------------------------------------------------
   import { UserMeetings } from "./Meetings";
   <UserMeetings user={{ name: "Fatima Khan", role: "Client" }} darkMode={darkMode} />
===================================================================== */

export function UserMeetings({ user = { name: "You", role: "Client" }, darkMode = false }) {
  const t = useTheme(darkMode);
  const [meetings, setMeetings] = useState([]);
  const [requests, setRequests] = useState([]);
  const [rescheduleRequests, setRescheduleRequests] = useState([]);
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [autoReschedule, setAutoReschedule] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [availability, setAvailability] = useState({ active: true, startTime: "09:00", endTime: "18:00", days: [] });

  // Each subscribe call fires an immediate fetch on mount (covering the
  // initial load) and then keeps polling — see pollResource() above.
  useEffect(() => subscribeToMeetings(setMeetings), []);
  useEffect(() => subscribeToRequests(setRequests), []);
  useEffect(() => subscribeToRescheduleRequests(setRescheduleRequests), []);
  useEffect(() => subscribeToAvailability(setAvailability), []);

  // Same optimistic pre-check pattern as AdminMeetingsView — the server
  // re-validates on approve either way.
  const checkConflict = (rawDate, rawTime, excludeId) => isSlotTaken(meetings, rawDate, rawTime, excludeId);

  // submitRescheduleRequest() returns just the new request object (not
  // the whole list) — push it into local state immediately for a snappy
  // "My Reschedule Requests" update instead of waiting for the next poll.
  // MeetingDetailsModal calls this fire-and-forget (it shows its own
  // "request sent" confirmation right away), so a failure surfaces via
  // alert() here rather than an inline field in the modal.
  const handleRequestReschedule = (payload) => {
    submitRescheduleRequest(payload)
      .then((req) => setRescheduleRequests((prev) => [req, ...prev]))
      .catch((err) => alert(err.message));
  };
  const openReschedule = (m) => { setActiveMeeting(m); setAutoReschedule(true); };
  const handleOpenMeeting = (m) => { setActiveMeeting(m); setAutoReschedule(false); };

  const myMeetings = useMemo(
    () => meetings.filter((m) => m.participants.includes(user.name)),
    [meetings, user.name]
  );
  const myRequests = useMemo(
    () => requests.filter((r) => r.name === user.name),
    [requests, user.name]
  );
  const myRescheduleRequests = useMemo(
    () => (Array.isArray(rescheduleRequests) ? rescheduleRequests : []).filter((r) => r.name === user.name),
    [rescheduleRequests, user.name]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-base font-bold ${t.cardText}`}>My Meetings</h2>
          <p className={`text-xs mt-0.5 ${t.subtleText}`}>Only the meetings and requests linked to you</p>
        </div>
        <button
          onClick={() => setRequestOpen(true)}
          className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2 rounded-full transition shrink-0"
        >
          <CalendarPlus className="w-4 h-4" /> Request a Meeting
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4 min-w-0">
          <section className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <h3 className={`font-semibold text-[15px] mb-1 ${t.cardText}`}>My Upcoming Meetings</h3>
            <p className={`text-[12px] mb-4 ${t.subtleText}`}>Only the meetings you're part of</p>
            {myMeetings.length === 0 ? (
              <div className={`text-[12.5px] py-6 text-center ${t.subtleText}`}>No meetings scheduled yet.</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {myMeetings.map((m) => (
                  <MeetingCard key={m.id} m={m} onOpen={handleOpenMeeting} onReschedule={openReschedule} showDecline={false} darkMode={darkMode} />
                ))}
              </div>
            )}
          </section>

          <section className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <h3 className={`font-semibold text-[15px] mb-1 ${t.cardText}`}>My Requests</h3>
            <p className={`text-[12px] mb-2 ${t.subtleText}`}>Status of the meeting requests you've sent</p>
            {myRequests.length === 0 ? (
              <div className={`text-[12.5px] py-6 text-center ${t.subtleText}`}>You haven't sent any requests yet.</div>
            ) : (
              <div>
                {myRequests.map((r) => (
                  <div key={r.id} className={`flex items-center justify-between py-3 border-b last:border-0 ${t.border}`}>
                    <div>
                      <div className={`text-[13px] font-medium ${t.cardText}`}>{r.project}</div>
                      <div className={`text-[11px] ${t.subtleText}`}>{r.reason}</div>
                      <div className={`text-[11px] flex items-center gap-1 mt-0.5 ${t.mutedText}`}><CalendarDays size={11} />{r.date} <Clock size={11} className="ml-2" />{r.time}</div>
                    </div>
                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                      r.status === "pending" ? (darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-600") : r.status === "approved" ? statusBadge("Upcoming", darkMode) : statusBadge("Declined", darkMode)
                    }`}>
                      {r.status === "pending" ? "Pending" : r.status === "approved" ? "Approved" : "Rejected"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`rounded-xl p-5 shadow-sm ${t.card}`}>
            <h3 className={`font-semibold text-[15px] mb-1 ${t.cardText}`}>My Reschedule Requests</h3>
            <p className={`text-[12px] mb-2 ${t.subtleText}`}>Status of the reschedule requests you've sent — approved once the admin confirms</p>
            {myRescheduleRequests.length === 0 ? (
              <div className={`text-[12.5px] py-6 text-center ${t.subtleText}`}>You haven't requested a reschedule yet.</div>
            ) : (
              <div>
                {myRescheduleRequests.map((r) => (
                  <div key={r.id} className={`flex items-center justify-between py-3 border-b last:border-0 ${t.border}`}>
                    <div>
                      <div className={`text-[13px] font-medium ${t.cardText}`}>{r.project}</div>
                      <div className={`text-[11px] ${t.subtleText}`}>{r.reason}</div>
                      <div className={`text-[11px] flex items-center gap-1 mt-0.5 ${t.mutedText}`}><CalendarDays size={11} />Requested: {r.date} <Clock size={11} className="ml-2" />{r.time}</div>
                    </div>
                    <span className={`text-[11px] px-2.5 py-1 rounded-full font-medium ${
                      r.status === "pending" ? (darkMode ? "bg-amber-500/15 text-amber-300" : "bg-amber-50 text-amber-600") : r.status === "approved" ? statusBadge("Upcoming", darkMode) : statusBadge("Declined", darkMode)
                    }`}>
                      {r.status === "pending" ? "Pending" : r.status === "approved" ? "Approved" : "Rejected"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4 min-w-0">
          <Calendar meetings={myMeetings} darkMode={darkMode} />
          <AvailabilityCard availability={availability} darkMode={darkMode} title="Admin Availability" />
        </div>
      </div>

      <MeetingDetailsModal
        meeting={activeMeeting}
        onClose={() => { setActiveMeeting(null); setAutoReschedule(false); }}
        isAdmin={false}
        onRequestReschedule={handleRequestReschedule}
        checkConflict={checkConflict}
        initialReschedule={autoReschedule}
        user={user}
        darkMode={darkMode}
      />

      {requestOpen && (
        <UserRequestModal
          user={user}
          darkMode={darkMode}
          onClose={() => setRequestOpen(false)}
          onSubmitted={(req) => { setRequestOpen(false); if (req) setRequests((prev) => [req, ...prev]); }}
        />
      )}
    </div>
  );
}

function UserRequestModal({ user, onClose, onSubmitted, darkMode = false }) {
  const t = useTheme(darkMode);
  const [projectName, setProjectName] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!projectName.trim()) return setError("Please enter the project name.");
    if (!reason.trim()) return setError("Please tell us what the meeting is about.");
    if (!date || !time) return setError("Please select a date and time for the meeting.");

    setError("");
    submitMeetingRequest({
      name: user.name, role: user.role, project: projectName, reason, rawDate: date, rawTime: time,
    })
      .then((req) => onSubmitted(req))
      .catch((err) => setError(err.message));
  };

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={handleSubmit} className={`rounded-2xl w-full max-w-md p-6 shadow-2xl relative ${t.modalCard}`} onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className={`absolute top-4 right-4 ${t.mutedText} hover:${t.cardText}`}>
          <X size={18} />
        </button>
        <h2 className={`font-semibold text-[17px] mb-1 flex items-center gap-2 ${t.cardText}`}>
          <CalendarPlus size={18} className="text-violet-500" /> Request a Meeting
        </h2>
        <p className={`text-[12.5px] mb-5 ${t.subtleText}`}>Need to talk to the team — send a request from here.</p>

        <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2 mb-4 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
          <Avatar name="Admin" size="w-8 h-8" />
          <div>
            <div className={`text-[11px] ${t.mutedText}`}>Meeting with</div>
            <div className={`text-[13px] font-medium ${t.cardText}`}>Admin</div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className={`text-[12px] ${t.mutedText}`}>Project</label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="e.g. Luxora E-commerce Website"
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
          </div>
          <div>
            <label className={`text-[12px] ${t.mutedText}`}>What would you like to discuss?</label>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Describe your issue or discussion point here..."
              className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 resize-none ${t.inputCls}`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Preferred date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
            <div>
              <label className={`text-[12px] ${t.mutedText}`}>Preferred time</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
                className={`w-full mt-1 border rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-violet-400 ${t.inputCls}`} />
            </div>
          </div>
          {error && <p className="text-[12px] text-rose-500">{error}</p>}
        </div>

        <button type="submit" className="w-full mt-5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-[13px] font-medium py-2.5 rounded-lg">
          Send Request
        </button>
      </form>
    </div>
  );
}