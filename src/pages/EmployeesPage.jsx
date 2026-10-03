import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../AuthContext.jsx";
import TeamBirthdayConfetti, { isBirthdayToday } from "../TeamBirthdayConfetti.jsx";
import * as employeesApi from "../api/employeesApi.js";
import * as messagesApi from "../messagesApi.js";
import {
  Calendar,
  Plus,
  MoreVertical,
  Filter,
  Users2,
  UserCheck,
  Clock3,
  Code2,
  Palette,
  ClipboardCheck,
  Briefcase,
  Megaphone,
  GitBranch,
  UserCog,
  LifeBuoy,
  X,
  Eye,
  Pencil,
  UserX,
  Trash2,
  Mail,
  Phone,
  MapPin,
  FolderOpen,
  ListChecks,
  ChevronDown,
  DollarSign,
  CalendarPlus,
  Check,
  XCircle,
  MessageSquareText,
  Send,
  Star,
  Trophy,
  Gift,
  PartyPopper,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Download,
} from "lucide-react";

/* ======================================================================
   STATIC CONFIG
====================================================================== */

const DEPARTMENTS = [
  { name: "Development", icon: Code2, color: "text-blue-500", bar: "bg-blue-500" },
  { name: "Design", icon: Palette, color: "text-pink-500", bar: "bg-pink-500" },
  { name: "QA & Testing", icon: ClipboardCheck, color: "text-emerald-500", bar: "bg-emerald-500" },
  { name: "Business", icon: Briefcase, color: "text-amber-500", bar: "bg-amber-500" },
  { name: "Marketing", icon: Megaphone, color: "text-fuchsia-500", bar: "bg-fuchsia-500" },
  { name: "DevOps", icon: GitBranch, color: "text-cyan-500", bar: "bg-cyan-500" },
  { name: "HR", icon: UserCog, color: "text-rose-500", bar: "bg-rose-500" },
  { name: "Support", icon: LifeBuoy, color: "text-orange-500", bar: "bg-orange-500" },
];
const DEPT_MAP = Object.fromEntries(DEPARTMENTS.map((d) => [d.name, d]));

const ROLE_BY_DEPT = {
  Development: ["Developer", "Backend Developer", "Frontend Developer", "Project Manager"],
  Design: ["UI/UX Designer", "Graphic Designer"],
  "QA & Testing": ["QA Engineer", "Automation Engineer"],
  Business: ["Business Analyst", "Product Owner"],
  Marketing: ["Content Writer", "Marketing Executive"],
  DevOps: ["DevOps Engineer", "Site Reliability Engineer"],
  HR: ["HR Manager", "HR Executive"],
  Support: ["Support Engineer", "Support Lead"],
};

const ROLE_STYLES = {
  "Project Manager": "bg-violet-50 text-violet-600",
  Developer: "bg-blue-50 text-blue-600",
  "Backend Developer": "bg-blue-50 text-blue-600",
  "Frontend Developer": "bg-blue-50 text-blue-600",
  "UI/UX Designer": "bg-pink-50 text-pink-600",
  "Graphic Designer": "bg-pink-50 text-pink-600",
  "Business Analyst": "bg-amber-50 text-amber-600",
  "Product Owner": "bg-amber-50 text-amber-600",
  "QA Engineer": "bg-emerald-50 text-emerald-600",
  "Automation Engineer": "bg-emerald-50 text-emerald-600",
  "DevOps Engineer": "bg-cyan-50 text-cyan-600",
  "Site Reliability Engineer": "bg-cyan-50 text-cyan-600",
  "Content Writer": "bg-fuchsia-50 text-fuchsia-600",
  "Marketing Executive": "bg-fuchsia-50 text-fuchsia-600",
  "HR Manager": "bg-rose-50 text-rose-600",
  "HR Executive": "bg-rose-50 text-rose-600",
  "Support Engineer": "bg-orange-50 text-orange-600",
  "Support Lead": "bg-orange-50 text-orange-600",
};

const STATUS_STYLES = {
  Active: "bg-emerald-50 text-emerald-600",
  "On Leave": "bg-amber-50 text-amber-600",
};

const AVATAR_PALETTE = [
  "bg-rose-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-violet-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500", "bg-orange-500", "bg-fuchsia-500",
];

function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

/* Same formatting UserPage uses for the salary it assigns, so the number
   looks identical on both pages. */
function fmtMoney(n) {
  return `PKR ${Number(n || 0).toLocaleString()}`;
}

/* "Per project" employees have no fixed monthly salary — their pay is the
   running total of the commissions added on the projects / tasks they were
   assigned (see the commission box in the Projects / Tasks popups). */
const isPerProject = (e) => e?.payType === "per_project";

/* Basic, forgiving email check — good enough to catch typos without being
   a strict RFC validator. */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/* ----------------------------------------------------------------------
   LEAVE HELPERS
   A leave request looks like:
   {
     id, type: "Half Day" | "Full Day",
     startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD",
     days: number (0.5 for half day, integer count for full day range),
     reason: string,
     status: "pending" | "approved" | "rejected",
     requestedAt: ISO string, decidedAt: ISO string | null,
   }
   Only "approved" requests count toward the monthly total that payroll
   uses to cut salary — pending/rejected ones never affect the count.
---------------------------------------------------------------------- */

/* Ensures every employee row has a leaveRequests array, even ones loaded
   from older localStorage data saved before this feature existed. */
function withLeaveDefaults(e) {
  return { ...e, leaveRequests: Array.isArray(e.leaveRequests) ? e.leaveRequests : [] };
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/* "YYYY-MM" for whichever date a leave request is grouped/counted under
   (its start date) — used to bucket leaves into calendar months. */
function yearMonthOf(dateStr) {
  return (dateStr || "").slice(0, 7);
}
function currentYearMonth() {
  return yearMonthOf(todayISO());
}

/* Inclusive day count between two YYYY-MM-DD strings, e.g. Mon->Wed = 3. */
function inclusiveDayCount(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diff = Math.round((end - start) / 86400000) + 1;
  return Math.max(1, diff);
}

function computeLeaveDays(type, startDate, endDate) {
  if (type === "Half Day") return 0.5;
  return inclusiveDayCount(startDate, endDate || startDate);
}

/* Nicely formats a leave-day count: 0.5 -> "0.5 day", 3 -> "3 days". */
function fmtLeaveDays(n) {
  const num = Number(n || 0);
  const trimmed = Number.isInteger(num) ? String(num) : num.toFixed(1);
  return `${trimmed} ${num === 1 ? "day" : "days"}`;
}

/* Total APPROVED leave days an employee has for a given "YYYY-MM" month
   (defaults to the current month) — this is the number payroll uses. */
function monthlyApprovedLeaveDays(emp, ym = currentYearMonth()) {
  return (emp.leaveRequests || [])
    .filter((r) => r.status === "approved" && yearMonthOf(r.startDate) === ym)
    .reduce((sum, r) => sum + r.days, 0);
}

function pendingLeaveRequestsOf(emp) {
  return (emp.leaveRequests || []).filter((r) => r.status === "pending");
}

/* ----------------------------------------------------------------------
   PROJECTS & PERFORMANCE RATING
   Every employee carries a running project count — `projectsAssigned`
   (total projects ever given to them) and `projectsCompleted` (how many
   of those they've finished) — plus a 1-5 star `rating`. Neither is
   computed automatically: the admin looks at the assigned/completed
   numbers and sets the star rating by hand from the employee's profile.
   A brand-new employee always starts at a 5-star rating.
---------------------------------------------------------------------- */

/* Ensures every employee row has the performance fields, even ones
   loaded from older localStorage data saved before this feature existed. */
function withPerformanceDefaults(e) {
  return {
    ...e,
    projectsAssigned: Number.isFinite(e.projectsAssigned) ? e.projectsAssigned : (e.projects || 0),
    projectsCompleted: Number.isFinite(e.projectsCompleted) ? e.projectsCompleted : 0,
    projectsRemaining: Number.isFinite(e.projectsRemaining) ? e.projectsRemaining : Math.max(0, (Number.isFinite(e.projectsAssigned) ? e.projectsAssigned : (e.projects || 0)) - (Number.isFinite(e.projectsCompleted) ? e.projectsCompleted : 0)),
    tasksCompleted: Number.isFinite(e.tasksCompleted) ? e.tasksCompleted : 0,
    tasksRemaining: Number.isFinite(e.tasksRemaining) ? e.tasksRemaining : Math.max(0, (e.tasks || 0) - (Number.isFinite(e.tasksCompleted) ? e.tasksCompleted : 0)),
    rating: Number.isFinite(e.rating) ? Math.min(5, Math.max(1, e.rating)) : 5,
  };
}

/* % of assigned projects finished, clamped so a bad completed count
   (e.g. from stale data) can never push the bar past 100%. */
function completionPct(emp) {
  const total = emp.projectsAssigned || 0;
  if (!total) return 0;
  return Math.round((Math.min(emp.projectsCompleted || 0, total) / total) * 100);
}

/* How many projects/tasks this employee still has open right now — lets
   the admin spot who's behind at a glance instead of reading every row's
   numbers by hand. */
function openWorkCount(emp) {
  const projects = emp.projectsRemaining ?? Math.max(0, (emp.projectsAssigned || 0) - (emp.projectsCompleted || 0));
  const tasks = emp.tasksRemaining ?? Math.max(0, (emp.tasks || 0) - (emp.tasksCompleted || 0));
  return { projects, tasks, total: projects + tasks };
}

/* Flags an employee whose star rating has dropped to 2 or below, so the
   admin can quickly see who's at risk before it reaches the last star. */
function isLowPerformance(emp) {
  return (emp.rating ?? 5) <= 2;
}

/* ----------------------------------------------------------------------
   PROMOTIONS, BONUSES & COMPANY POSTS
   One shared announcement feed, admin-authored, visible to EVERY
   employee (not just admin) — same spirit as the holiday banner below.
   Three kinds of entries:
     "promotion" - tied to one employee, optional new job title
     "bonus"     - tied to one employee, optional bonus amount
     "post"      - a general company announcement (e.g. a party),
                   not tied to any specific employee
   An entry looks like:
   { id, type, employeeId, employeeName, detail, message, createdAt,
     seenBy: string[] }  // ids/emails that already got the 🥳 popup
---------------------------------------------------------------------- */
// Announcements now live in Postgres (employees.Announcement) — see
// src/api/employeesApi.js fetchAnnouncements/postAnnouncement/etc. Loaded
// into state from the API on mount instead of localStorage.

/* ----------------------------------------------------------------------
   HOLIDAY ANNOUNCEMENTS
   Sunday is always a company-wide off day automatically — no admin
   action needed. On top of that, an admin can announce an extra holiday
   for any specific date (Eid, a public holiday, an office closure...)
   with a short reason. Both kinds show up as the same "Today is Off"
   card on this page for every employee, not just admin.
   A holiday entry looks like: { id, date: "YYYY-MM-DD", reason: string }
---------------------------------------------------------------------- */
// Holidays now live in Postgres (employees.Holiday) — see
// src/api/employeesApi.js fetchHolidays/announceHoliday/cancelHoliday.
// Loaded into state from the API on mount instead of localStorage.

function isSunday(dateStr) {
  if (!dateStr) return false;
  return new Date(dateStr + "T00:00:00").getDay() === 0;
}

/* The admin-announced holiday entry for this exact date, if any. */
function announcedHolidayOn(dateStr, holidays) {
  return (holidays || []).find((h) => h.date === dateStr) || null;
}

/* Single source of truth for "is this date off, and why" — an announced
   holiday takes its own reason; otherwise Sunday is always the automatic
   weekly off; otherwise it's a normal working day. */
function holidayInfoFor(dateStr, holidays) {
  const announced = announcedHolidayOn(dateStr, holidays);
  if (announced) return { isOff: true, reason: announced.reason || "Company Holiday" };
  if (isSunday(dateStr)) return { isOff: true, reason: "Weekly Off (Sunday)" };
  return { isOff: false, reason: "" };
}

/* Employees now come straight from GET /api/employees/ (Postgres) — see
   src/api/employeesApi.js fetchEmployees(). It already returns every
   approved, non-admin/non-client account merged with rating, Active/On
   Leave status, location, live project/task counts and leave requests,
   so the old localStorage cache and the withLeaveDefaults/
   withPerformanceDefaults backfill below are no longer needed for it —
   those two helpers are kept only because a couple of other spots still
   read employee.leaveRequests defensively. */

// Live project/task counts (projectsAssigned/projectsCompleted/tasks/
// tasksCompleted) now come straight from GET /api/employees/, computed
// server-side from the real projects.Project / tasks.Task tables (see
// hopenix-backend/employees/serializers.py) — the client-side
// localStorage mirroring that used to live here is gone.

/* Turns an AuthContext role ("employee" | "manager" | "accountant" | ...)
   into a nicer display label for the RoleBadge. Falls back to the raw
   role string (capitalized) for anything not in this map. */
function displayRoleFor(role) {
  const map = {
    employee: "Employee",
    manager: "Manager",
    accountant: "Accountant",
  };
  if (map[role]) return map[role];
  if (!role) return "Employee";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/* ======================================================================
   SMALL PIECES
====================================================================== */

function Avatar({ name, avatar, size = "w-9 h-9", text = "text-xs" }) {
  if (typeof avatar === "string" && avatar.trim().length > 0) {
    const src = avatar.includes("?v=") ? avatar : `${avatar}?v=${Date.now()}`;
    return <img src={src} alt={name} className={`${size} rounded-full object-cover shrink-0`} />;
  }
  return (
    <div className={`${size} rounded-full flex items-center justify-center font-bold text-white shrink-0 ${avatarColor(name)} ${text}`}>
      {initials(name)}
    </div>
  );
}

function RoleBadge({ role }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${ROLE_STYLES[role] || "bg-slate-100 text-slate-500"}`}>
      {role}
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLES[status] || "bg-slate-100 text-slate-500"}`}>
      {status}
    </span>
  );
}

function DeptTag({ department, theme }) {
  const d = DEPT_MAP[department];
  if (!d) return <span className={`text-sm ${theme.mutedText}`}>{department}</span>;
  const Icon = d.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${theme.cardText}`}>
      <Icon className={`w-3.5 h-3.5 ${d.color}`} />
      {department}
    </span>
  );
}

function StatCard({ icon: Icon, iconBg, iconText, label, value, delta, up, active, onClick, theme }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-2xl p-4 ${theme.card} ${onClick ? "cursor-pointer transition hover:-translate-y-0.5 hover:shadow-md" : ""} ${active ? "ring-2 ring-violet-500" : ""}`}
    >
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${iconBg} ${iconText}`}>
        <Icon className="w-5 h-5" />
      </span>
      <p className={`text-xs mt-2.5 truncate ${theme.mutedText}`}>{label}</p>
      <p className={`text-xl sm:text-2xl font-extrabold mt-0.5 ${theme.headingText}`}>{value}</p>
      {delta && (
        <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold mt-2 ${up === null ? theme.subtleText : up ? "text-emerald-600" : "text-rose-600"}`}>
          {up === null ? "—" : up ? "↑" : "↓"} {delta} <span className={`font-normal ${theme.subtleText}`}>vs last month</span>
        </span>
      )}
    </button>
  );
}

/* Donut chart built with a conic-gradient ring (no chart library needed) */
function DonutChart({ segments, centerLabel, centerValue, theme }) {
  let acc = 0;
  const stops = segments.map((s) => {
    const start = acc;
    acc += s.pct;
    return `${s.color} ${start}% ${acc}%`;
  });
  return (
    <div className="relative w-[110px] h-[110px] shrink-0">
      <div className="w-full h-full rounded-full" style={{ background: `conic-gradient(${stops.join(",")})` }} />
      <div className={`absolute inset-[14px] rounded-full flex flex-col items-center justify-center ${theme.card}`}>
        <span className={`text-xl font-extrabold ${theme.headingText}`}>{centerValue}</span>
        <span className={`text-[10px] ${theme.subtleText}`}>{centerLabel}</span>
      </div>
    </div>
  );
}

/* Banner shown to EVERY employee (admin and regular users alike) whenever
   today counts as a day off — either the automatic Sunday weekly-off, or
   a date the admin specifically announced. */
function TodayOffBanner({ theme, reason }) {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3 bg-gradient-to-r from-emerald-500 to-teal-500 text-white shadow-sm">
      <span className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
        <Calendar className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="font-bold text-sm">Today is Off</p>
        <p className="text-xs text-white/90 truncate">{reason}</p>
      </div>
    </div>
  );
}

/* Admin-only card for announcing a company holiday on a specific date
   (anything other than Sunday, which is already automatic), plus a small
   list of what's already been announced so admin can cancel one if
   plans change. */
function AnnounceHolidayCard({ theme, form, setForm, onAnnounce, upcoming, onCancel }) {
  return (
    <div className={`rounded-2xl p-4 ${theme.card}`}>
      <h3 className={`font-bold text-sm mb-3 flex items-center gap-1.5 ${theme.headingText}`}>
        <CalendarPlus className="w-4 h-4 text-violet-500" /> Announce Holiday
      </h3>
      <div className="space-y-2">
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
        />
        <input
          value={form.reason}
          onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          placeholder="Reason (e.g. Eid Holiday)"
          className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
        />
        <button
          onClick={() => onAnnounce(form.date, form.reason)}
          disabled={!form.date}
          className="w-full text-sm font-semibold py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 text-white hover:opacity-90 transition"
        >
          Announce
        </button>
        <p className={`text-[11px] ${theme.subtleText}`}>Sunday is already an automatic weekly off — no need to announce it.</p>
      </div>
      {upcoming.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <p className={`text-[11px] font-semibold uppercase tracking-wide ${theme.subtleText}`}>Announced</p>
          {upcoming.map((h) => (
            <div key={h.id} className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 ${theme.inputBg}`}>
              <span className={`truncate ${theme.cardText}`}>{fmtDate(h.date)} — {h.reason}</span>
              <button onClick={() => onCancel(h.id)} className="text-rose-500 hover:text-rose-600 shrink-0" aria-label="Cancel this holiday">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* 1-5 star rating. Read-only by default; pass onChange to make it
   admin-clickable (used wherever an admin is allowed to set it). */
function StarRating({ value = 0, onChange, size = "w-4 h-4", theme }) {
  const interactive = typeof onChange === "function";
  return (
    <div className="flex items-center gap-0.5" onClick={(e) => interactive && e.stopPropagation()}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!interactive}
          onClick={() => interactive && onChange(n)}
          className={`${size} flex items-center justify-center ${interactive ? "cursor-pointer hover:scale-110 transition" : "cursor-default"}`}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          <Star className={`${size} ${n <= value ? "fill-amber-400 text-amber-400" : `fill-transparent ${theme ? theme.subtleText : "text-slate-300"}`}`} />
        </button>
      ))}
    </div>
  );
}

/* Compact "needs attention" badge — shown next to an employee wherever
   the admin scans the list, so who's behind on work or on a low rating
   stands out without opening every row. Purely informational; doesn't
   change any data. */
function AttentionBadge({ emp }) {
  const { total } = openWorkCount(emp);
  const low = isLowPerformance(emp);
  if (!low && total <= 0) return null;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {low && (
        <span
          title="Performance rating is 2 stars or below"
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-50 text-rose-600 whitespace-nowrap"
        >
          Low performance
        </span>
      )}
      {total > 0 && (
        <span
          title={`${openWorkCount(emp).projects} project(s) and ${openWorkCount(emp).tasks} task(s) still incomplete`}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600 whitespace-nowrap"
        >
          {total} incomplete
        </span>
      )}
    </span>
  );
}

/* Small "X of Y completed" progress bar for an employee's project load. */
function ProjectsProgress({ emp, theme }) {
  const pct = completionPct(emp);
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className={theme.subtleText}>{emp.projectsCompleted || 0} of {emp.projectsAssigned || 0} projects completed</span>
        <span className={`font-semibold ${theme.cardText}`}>{pct}%</span>
      </div>
      <span className={`block h-1.5 rounded-full overflow-hidden ${theme.inputBg}`}>
        <span className="block h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/* Admin-only composer for the shared announcement feed: a Promotion or
   Bonus tied to one employee, or a general company Post (party, news,
   etc.) that isn't tied to anyone specific. */
function RecognitionCard({ theme, employees, form, setForm, onSubmit }) {
  const TYPES = [
    { key: "promotion", label: "Promotion", icon: Trophy },
    { key: "bonus", label: "Bonus", icon: Gift },
    { key: "post", label: "Post", icon: Megaphone },
  ];
  const canSubmit = form.type === "post" ? form.message.trim().length > 0 : Boolean(form.employeeId);

  // Keeps the real File object picked from the admin's desktop on the
  // form — a Post/Bonus gets a photo, a Promotion gets a PDF (e.g. the
  // signed letter). These are uploaded as real files and stored on disk
  // by the backend (see employees/views.py AnnouncementListCreateView),
  // not base64 data URLs, so we must not convert them here.
  const handleImagePick = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    setForm((f) => ({ ...f, image: file }));
  };
  const handlePdfPick = (file) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return;
    setForm((f) => ({ ...f, pdfFile: file }));
  };

  // Local-only preview URLs for the File objects above (revoked on
  // change/unmount so we don't leak blob: URLs).
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  useEffect(() => {
    if (!form.image) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(form.image);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [form.image]);

  return (
    <div className={`rounded-2xl p-4 ${theme.card}`}>
      <h3 className={`font-bold text-sm mb-3 flex items-center gap-1.5 ${theme.headingText}`}>
        <PartyPopper className="w-4 h-4 text-violet-500" /> Promotion, Bonus &amp; Posts
      </h3>
      <div className={`flex rounded-lg p-1 mb-2.5 ${theme.inputBg}`}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setForm((f) => ({ ...f, type: t.key }))}
            className={`flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-md transition ${
              form.type === t.key ? `${theme.card} text-violet-600 shadow` : theme.mutedText
            }`}
          >
            <t.icon className="w-3 h-3" /> {t.label}
          </button>
        ))}
      </div>
      {form.type !== "post" && (
        <select
          value={form.employeeId}
          onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
          className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 mb-2 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
        >
          <option value="">Select employee</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      )}
      {form.type === "promotion" && (
        <input
          value={form.detail}
          onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
          placeholder="New role (e.g. Senior Developer)"
          className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 mb-2 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
        />
      )}
      {form.type === "bonus" && (
        <input
          value={form.detail}
          onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
          placeholder="Bonus amount (e.g. $500)"
          className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 mb-2 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
        />
      )}
      {(form.type === "post" || form.type === "bonus" || form.type === "promotion") && (
        <div className="mb-2">
          {form.image ? (
            <div className={`relative rounded-lg overflow-hidden border mb-1.5 inline-block ${theme.border}`}>
              <img src={imagePreviewUrl} alt={form.image.name} className="w-32 h-24 object-cover block" />
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, image: null }))}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center"
                aria-label="Remove image"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <label
              className={`flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg border border-dashed py-2 cursor-pointer ${theme.border} ${theme.mutedText}`}
            >
              <ImageIcon className="w-3.5 h-3.5" /> Add a photo (optional)
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleImagePick(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
      )}
      {form.type === "promotion" && (
        <div className="mb-2">
          {form.pdfFile ? (
            <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${theme.border} ${theme.inputBg}`}>
              <FileText className="w-4 h-4 text-rose-500 shrink-0" />
              <span className={`text-xs truncate flex-1 ${theme.cardText}`}>{form.pdfFile.name}</span>
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, pdfFile: null }))}
                className="text-rose-500 hover:text-rose-600 shrink-0"
                aria-label="Remove PDF"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <label
              className={`flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg border border-dashed py-2 cursor-pointer ${theme.border} ${theme.mutedText}`}
            >
              <Paperclip className="w-3.5 h-3.5" /> Attach promotion letter (PDF, optional)
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => handlePdfPick(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
      )}
      <textarea
        value={form.message}
        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        placeholder={form.type === "post" ? "What's the announcement? (e.g. Company party this Friday!)" : "A short congratulatory note..."}
        rows={2}
        className={`w-full text-sm border rounded-lg px-2.5 py-2 outline-none focus:ring-2 focus:ring-violet-300 mb-2 resize-none ${theme.border} ${theme.inputBg} ${theme.cardText}`}
      />
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="w-full text-sm font-semibold py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 text-white hover:opacity-90 transition"
      >
        {form.type === "post" ? "Publish Post" : "Announce"}
      </button>
    </div>
  );
}

/* Shared feed — shown to EVERY employee (admin and regular users alike)
   so a promotion/bonus/post encourages the whole team, not just the
   person it's about. Admin can remove an entry; everyone else just reads. */
function AnnouncementsFeed({ theme, feed, onCancel, isAdmin }) {
  // Facebook-style: the posted image shows as a short, cropped preview in
  // the feed card; tapping it opens the full image so nothing is lost.
  const [lightboxImage, setLightboxImage] = useState(null);
  if (feed.length === 0) return null;
  const iconFor = (type) => (type === "promotion" ? Trophy : type === "bonus" ? Gift : Megaphone);
  const colorFor = (type) => (type === "promotion" ? "bg-violet-50 text-violet-600" : type === "bonus" ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600");
  const titleFor = (a) => {
    if (a.type === "promotion") return `${a.employeeName} got promoted${a.detail ? ` to ${a.detail}` : ""} 🎉`;
    if (a.type === "bonus") return `${a.employeeName} received a bonus${a.detail ? ` of ${a.detail}` : ""} 💰`;
    return "Company Announcement 📢";
  };
  return (
    <div className={`rounded-2xl p-4 ${theme.card}`}>
      <h3 className={`font-bold text-sm mb-3 flex items-center gap-1.5 ${theme.headingText}`}>
        <PartyPopper className="w-4 h-4 text-violet-500" /> Company Announcements
      </h3>
      <div className="space-y-2.5 max-h-72 overflow-y-auto">
        {feed.map((a) => {
          const Icon = iconFor(a.type);
          return (
            <div key={a.id} className={`rounded-xl border p-2.5 flex items-start gap-2.5 ${theme.borderLight}`}>
              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${colorFor(a.type)}`}>
                <Icon className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold ${theme.headingText}`}>{titleFor(a)}</p>
                {a.message && <p className={`text-[11px] mt-0.5 ${theme.subtleText}`}>{a.message}</p>}
                {a.image && (
                  <button
                    type="button"
                    onClick={() => setLightboxImage({ src: a.image, alt: "Post image" })}
                    className="mt-1.5 block rounded-lg overflow-hidden border border-black/5"
                    aria-label="View full image"
                  >
                    <img
                      src={a.image}
                      alt="Post image"
                      className="w-28 h-20 object-cover hover:opacity-90 transition"
                    />
                  </button>
                )}
                {a.pdfFile && (
                  <a
                    href={a.pdfFile}
                    download="promotion-letter.pdf"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" /> View letter (PDF) <Download className="w-3 h-3" />
                  </a>
                )}
                <p className={`text-[10px] mt-1 ${theme.subtleText}`}>{fmtDate(a.createdAt)}</p>
              </div>
              {isAdmin && (
                <button onClick={() => onCancel(a.id)} className="text-rose-500 hover:text-rose-600 shrink-0" aria-label="Remove this announcement">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <button
            onClick={() => setLightboxImage(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white"
            aria-label="Close image"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={lightboxImage.src}
            alt={lightboxImage.alt}
            className="max-w-full max-h-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

/* Shown the moment an admin drags an employee's rating down to the last
   (1) star. Rather than saving that silently, we stop and make the admin
   choose right here: remove the employee, or give them one more chance
   — which restores the rating to 2 stars instead of leaving it at 1. */
function LastStarDecisionModal({ theme, employeeName, onGiveChance, onRemove, onCancel }) {
  return (
    <div className="fixed inset-0 z-[95] bg-black/40 flex items-center justify-center p-4" onClick={onCancel}>
      <div className={`rounded-2xl w-full max-w-sm p-6 shadow-2xl ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-9 h-9 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
            <Star className="w-4 h-4 fill-rose-500 text-rose-500" />
          </span>
          <h3 className={`text-base font-bold ${theme.headingText}`}>Last Star Reached</h3>
        </div>
        <p className={`text-sm mb-5 ${theme.mutedText}`}>
          <strong className={theme.cardText}>{employeeName}</strong>'s performance rating has dropped to the last star.
          Do you want to remove this employee, or give them one more chance?
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={onGiveChance}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            Give One More Chance (2 Stars)
          </button>
          <button
            onClick={onRemove}
            className="w-full border border-rose-300 text-rose-600 text-sm font-semibold py-2.5 rounded-full hover:bg-rose-50 transition"
          >
            Remove Employee
          </button>
          <button
            onClick={onCancel}
            className={`w-full border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/* Celebration popup with a bouncing 🥳 — shown to the employee themself
   the moment they open the page after being given a promotion or bonus.
   Dismissing it marks that announcement "seen" so it never pops again. */
function CongratsPopup({ announcement, onClose }) {
  if (!announcement) return null;
  const isPromotion = announcement.type === "promotion";
  return (
    <div className="fixed inset-0 z-[110] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative bg-gradient-to-br from-violet-600 via-indigo-600 to-fuchsia-600 text-white rounded-3xl w-full max-w-sm p-8 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-6xl mb-3 animate-bounce">🥳</div>
        <h3 className="text-xl font-extrabold mb-1">Congratulations!</h3>
        <p className="text-sm text-white/90">
          {isPromotion
            ? `You've been promoted${announcement.detail ? ` to ${announcement.detail}` : ""}!`
            : `You've received a bonus${announcement.detail ? ` of ${announcement.detail}` : ""}!`}
        </p>
        {announcement.message && <p className="text-xs text-white/80 mt-2 italic">"{announcement.message}"</p>}
        {announcement.image && (
          <img
            src={announcement.image}
            alt="Attached image"
            className="mt-3 rounded-xl w-full h-32 object-cover"
          />
        )}
        {announcement.pdfFile && (
          <a
            href={announcement.pdfFile}
            download="promotion-letter.pdf"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-full transition"
          >
            <FileText className="w-3.5 h-3.5" /> View your letter (PDF)
          </a>
        )}
        <button
          onClick={onClose}
          className="mt-5 bg-white text-violet-700 text-sm font-bold px-6 py-2.5 rounded-full hover:opacity-90 transition"
        >
          Thank you! 🎉
        </button>
      </div>
    </div>
  );
}

/* ======================================================================
   MY PROFILE (non-admin interface)
   A regular employee/user gets ONLY this — their own department, tasks,
   projects, status, joined date, leaves, and salary. No one else's data,
   and no way to change their own status (that's admin-only, from the
   full Employees table).
====================================================================== */
function MyProfileSection({ theme, employee, onRequestLeave }) {
  if (!employee) {
    return (
      <div className={`rounded-2xl p-6 text-center ${theme.card}`}>
        <p className={`text-sm ${theme.mutedText}`}>No employee profile is linked to your account yet.</p>
      </div>
    );
  }

  const d = DEPT_MAP[employee.department];
  const monthlyLeaves = monthlyApprovedLeaveDays(employee);
  const pendingLeaves = pendingLeaveRequestsOf(employee);
  const leaveHistory = (employee.leaveRequests || []).filter((r) => r.status !== "pending");

  return (
    <div className={`rounded-2xl p-5 sm:p-6 ${theme.card}`}>
      <div className="flex items-center gap-3 mb-5">
        <Avatar name={employee.name} avatar={employee.avatar} size="w-14 h-14" text="text-base" />
        <div className="min-w-0">
          <h3 className={`font-bold text-base ${theme.headingText}`}>{employee.name}</h3>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <RoleBadge role={employee.role} />
            {d && (
              <span className={`inline-flex items-center gap-1 text-[11px] ${theme.mutedText}`}>
                <d.icon className={`w-3 h-3 ${d.color}`} />{employee.department}
              </span>
            )}
            <StatusBadge status={employee.status} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
          <span className="w-9 h-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><FolderOpen className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className={`text-[11px] ${theme.subtleText}`}>Active Projects</p>
            <p className={`font-bold ${theme.headingText}`}>{employee.projectsAssigned ?? 0}</p>
          </div>
        </div>
        <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
          <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className={`text-[11px] ${theme.subtleText}`}>Assigned Tasks</p>
            <p className={`font-bold ${theme.headingText}`}>{employee.tasks}</p>
          </div>
        </div>
        <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
          <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><FolderOpen className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className={`text-[11px] ${theme.subtleText}`}>Completed Projects</p>
            <p className={`font-bold ${theme.headingText}`}>{employee.projectsCompleted ?? 0}</p>
          </div>
        </div>
        <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
          <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><FolderOpen className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className={`text-[11px] ${theme.subtleText}`}>Remaining Projects</p>
            <p className={`font-bold ${theme.headingText}`}>{employee.projectsRemaining ?? 0}</p>
          </div>
        </div>
        <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
          <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className={`text-[11px] ${theme.subtleText}`}>Completed Tasks</p>
            <p className={`font-bold ${theme.headingText}`}>{employee.tasksCompleted ?? 0}</p>
          </div>
        </div>
        <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
          <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><ListChecks className="w-4 h-4" /></span>
          <div className="min-w-0">
            <p className={`text-[11px] ${theme.subtleText}`}>Remaining Tasks</p>
            <p className={`font-bold ${theme.headingText}`}>{employee.tasksRemaining ?? 0}</p>
          </div>
        </div>
      </div>

      {(employee.rating ?? 5) <= 2 && (
        <div
          className={`rounded-xl border p-3 mb-3 flex items-start gap-2.5 ${
            (employee.rating ?? 5) === 1 ? "border-rose-200 bg-rose-50" : "border-amber-200 bg-amber-50"
          }`}
        >
          <span
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              (employee.rating ?? 5) === 1 ? "bg-rose-100 text-rose-600" : "bg-amber-100 text-amber-600"
            }`}
          >
            <XCircle className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className={`text-xs font-bold ${(employee.rating ?? 5) === 1 ? "text-rose-700" : "text-amber-700"}`}>
              Your performance is too low
            </p>
            <p className={`text-[11px] mt-0.5 ${(employee.rating ?? 5) === 1 ? "text-rose-600" : "text-amber-600"}`}>
              Improve your performance{(employee.rating ?? 5) === 1 ? " immediately" : ""} — otherwise you will be terminated.
            </p>
          </div>
        </div>
      )}

      <div className={`rounded-xl border p-3 mb-3 ${theme.borderLight}`}>
        <div className="flex items-center justify-between mb-2.5">
          <p className={`text-xs font-semibold ${theme.headingText}`}>Performance Rating</p>
          <StarRating value={employee.rating ?? 5} theme={theme} />
        </div>
        <ProjectsProgress emp={employee} theme={theme} />
      </div>

      <div className={`rounded-xl border p-3 flex items-center gap-2.5 mb-3 ${theme.borderLight}`}>
        <span className="w-9 h-9 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0"><Calendar className="w-4 h-4" /></span>
        <div className="min-w-0">
          <p className={`text-[11px] ${theme.subtleText}`}>Joined</p>
          <p className={`font-bold ${theme.headingText}`}>{fmtDate(employee.joined)}</p>
        </div>
      </div>

      <div className={`rounded-xl border p-3 flex items-center gap-2.5 mb-3 ${theme.borderLight}`}>
        <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><CalendarPlus className="w-4 h-4" /></span>
        <div className="min-w-0 flex-1">
          <p className={`text-[11px] ${theme.subtleText}`}>Approved Leaves This Month</p>
          <p className={`font-bold ${theme.headingText}`}>{fmtLeaveDays(monthlyLeaves)}</p>
        </div>
        <button
          onClick={onRequestLeave}
          className="ml-auto shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90"
        >
          Request Leave
        </button>
      </div>

      {pendingLeaves.length > 0 && (
        <div className="mb-3">
          <p className={`text-xs font-semibold mb-2 ${theme.headingText}`}>Pending Leave Requests</p>
          <div className="space-y-2">
            {pendingLeaves.map((r) => (
              <div key={r.id} className={`rounded-xl border p-2.5 text-xs ${theme.borderLight} ${theme.mutedText}`}>
                {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""} · Awaiting approval
              </div>
            ))}
          </div>
        </div>
      )}

      {leaveHistory.length > 0 && (
        <div className="mb-3">
          <p className={`text-xs font-semibold mb-2 ${theme.headingText}`}>Leave History</p>
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {leaveHistory.map((r) => (
              <div key={r.id} className={`flex items-center justify-between text-[11px] rounded-lg px-2.5 py-1.5 ${theme.inputBg}`}>
                <span className={theme.cardText}>
                  {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                  {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""}
                </span>
                <span className={`font-semibold ${r.status === "approved" ? "text-emerald-600" : "text-rose-500"}`}>
                  {r.status === "approved" ? "Approved" : "Rejected"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
        <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><DollarSign className="w-4 h-4" /></span>
        <div className="min-w-0">
          <p className={`text-[11px] ${theme.subtleText}`}>{isPerProject(employee) ? "Per-Project Earnings" : "Monthly Salary"}</p>
          <p className={`font-bold ${theme.headingText}`}>
            {isPerProject(employee) ? fmtMoney(employee.commissionTotal) : employee.salary != null ? fmtMoney(employee.salary) : "Not set"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   MAIN PAGE
   Note: sidebar/topbar removed — this page now renders inside Dashboard's
   layout (Dashboard.jsx already provides the sidebar and header), so this
   component only returns its own content (stat cards, table, side panels,
   modals, toasts).
====================================================================== */

export default function EmployeesPage({ darkMode = false }) {
  const [dark, setDark] = useState(darkMode);
  useEffect(() => setDark(darkMode), [darkMode]);

  const theme = {
    card: dark ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200",
    headingText: dark ? "text-white" : "text-slate-900",
    cardText: dark ? "text-slate-200" : "text-slate-800",
    mutedText: dark ? "text-slate-400" : "text-slate-500",
    subtleText: dark ? "text-slate-500" : "text-slate-400",
    border: dark ? "border-slate-800" : "border-slate-200",
    borderLight: dark ? "border-slate-800" : "border-slate-100",
    divide: dark ? "divide-slate-800" : "divide-slate-100",
    inputBg: dark ? "bg-slate-800" : "bg-slate-50",
    hoverRow: dark ? "hover:bg-slate-800/60" : "hover:bg-slate-50",
    hoverIconBg: dark ? "bg-slate-800" : "bg-slate-50",
  };

  // Employees now come straight from Postgres via GET /api/employees/ —
  // that response already includes live projectsAssigned/projectsCompleted/
  // tasks/tasksCompleted numbers (computed server-side from the real
  // Projects and Tasks apps), so there's no more localStorage mirroring or
  // client-side merge needed for any of that.
  const [employees, setEmployees] = useState([]);
  const [employeesLoading, setEmployeesLoading] = useState(true);
  const [employeesError, setEmployeesError] = useState(null);

  const refreshEmployees = async () => {
    try {
      const data = await employeesApi.fetchEmployees();
      setEmployees(Array.isArray(data) ? data : []);
      setEmployeesError(null);
    } catch (err) {
      setEmployeesError(err.message || "Couldn't load employees.");
    } finally {
      setEmployeesLoading(false);
    }
  };

  useEffect(() => {
    refreshEmployees();
    // Light poll + refresh on focus so an approval made in Users & Roles
    // (a different tab/page) shows up here without a manual reload —
    // same responsiveness the old localStorage-mirror approach had.
    window.addEventListener("focus", refreshEmployees);
    document.addEventListener("visibilitychange", refreshEmployees);
    const interval = setInterval(refreshEmployees, 8000);
    return () => {
      window.removeEventListener("focus", refreshEmployees);
      document.removeEventListener("visibilitychange", refreshEmployees);
      clearInterval(interval);
    };
  }, []);

  // Kept as an alias — the rest of this file already reads `employeesLive`
  // in dozens of spots expecting the "with live project/task stats"
  // version; now that the API always returns live stats, both names refer
  // to the exact same array.
  const employeesLive = employees;

  // Real, admin-approved accounts from Users & Roles (AuthContext). This is
  // what makes approving someone in UserPage actually make them show up
  // here as a real employee, instead of the two pages staying disconnected.
  // `updateUserProfile` (if AuthContext exposes it) is also used so that
  // editing a linked employee's identity fields here can push the change
  // back onto their real account too, not just this page's local copy.
  const { approvedUsers, updateUserProfile, users, setUserStatus, inviteUser, user: currentUser, canCreate, canEdit, canDelete } = useAuth();

  // Real, per-role module permission gates (set from Users & Roles ->
  // Module Access Control). Inviting/editing/removing an employee is only
  // allowed if the current user's role has that permission turned on for
  // the "Employees" module.
  const canCreateEmployees = canCreate("Employees");
  const canEditEmployees = canEdit("Employees");
  const canDeleteEmployees = canDelete("Employees");

  // Salary is sensitive. Admins can see everyone's salary. Everyone else
  // (managers, employees, etc.) may ONLY see their own salary — never a
  // co-worker's — so visibility is checked per-row, not just per-page.
  const isAdmin = currentUser?.role === "admin";

  // Is this particular employee row "me"? Matched via the linked auth
  // account id first, falling back to email (covers manually-added rows
  // that don't have an authId but share the logged-in user's email).
  const canSeeSalary = (emp) => {
    if (isAdmin) return true;
    if (!currentUser || !emp) return false;
    if (emp.authId && currentUser.id && emp.authId === currentUser.id) return true;
    if (emp.email && currentUser.email && emp.email.toLowerCase() === currentUser.email.toLowerCase()) return true;
    return false;
  };

  // Whether to render the Salary column/section at all. Admins always get
  // it; a non-admin only gets it if their own row is actually present in
  // the list (otherwise it'd just be an empty "Hidden" column for them).
  const showSalaryColumn = isAdmin || employees.some(canSeeSalary);

  // Same "is this row me?" match as canSeeSalary, reused to decide who can
  // hit "Request Leave" on a row — employees request their OWN leave only.
  const isOwnRow = (emp) => {
    if (!currentUser || !emp) return false;
    if (emp.authId && currentUser.id && emp.authId === currentUser.id) return true;
    if (emp.email && currentUser.email && emp.email.toLowerCase() === currentUser.email.toLowerCase()) return true;
    return false;
  };
  const myEmployeeRow = employeesLive.find(isOwnRow) || null;

  // Anyone who can approve/reject requests should also be able to review
  // them — reuse the existing "edit employees" permission for this rather
  // than inventing a brand-new permission key.
  const canReviewLeaves = canEditEmployees;

  // Flat list of every pending leave request across all employees, newest
  // first, each tagged with its owning employee — feeds the "Leave
  // Requests" panel so an approver doesn't have to open each profile.
  const allPendingLeaveRequests = useMemo(() => {
    const out = [];
    employees.forEach((e) => {
      pendingLeaveRequestsOf(e).forEach((r) => out.push({ ...r, employee: e }));
    });
    return out.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  }, [employees]);

  // Whenever the approved-users list changes (someone gets approved,
  // rejected/deleted, or their role/department is edited in Users &
  // Roles), just re-fetch from the API — GET /api/employees/ already
  // recomputes the whole merged list (identity fields straight from
  // users.User/Profile, live project/task stats, this app's rating/
  // status/location/leave requests) on every call, so there's nothing
  // left to merge client-side.
  useEffect(() => {
    refreshEmployees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approvedUsers]);
  const [activeTab, setActiveTab] = useState("all");
  const [deptFilter, setDeptFilter] = useState("All Departments");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [openActionMenu, setOpenActionMenu] = useState(null);
  const [actionMenuPos, setActionMenuPos] = useState(null);
  const actionMenuRef = useRef(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState(null);
  const [editEmp, setEditEmp] = useState(null);
  const [detailsEmp, setDetailsEmp] = useState(null);
  const [leaveTargetEmp, setLeaveTargetEmp] = useState(null);
  // When an admin drags a star rating down to the last star (1), we hold
  // off saving it and ask them to decide first: remove the employee, or
  // give one more chance (which bumps the rating back up to 2 instead).
  const [lastStarPrompt, setLastStarPrompt] = useState(null); // { id, name } | null
  const [toasts, setToasts] = useState([]);
  const filtersRef = useRef(null);

  // Admin-announced holidays (Sunday is automatic and never stored here).
  // Loaded from the employees API (Postgres) on mount.
  const [holidays, setHolidays] = useState([]);
  const [holidayForm, setHolidayForm] = useState({ date: todayISO(), reason: "" });

  // Shared Promotion/Bonus/Post announcement feed — same API-backed
  // pattern as holidays above, but visible to every employee, not just
  // admin (see AnnouncementsFeed further down).
  const [announcements, setAnnouncements] = useState([]);
  const [recognitionForm, setRecognitionForm] = useState({
    type: "promotion", employeeId: "", detail: "", message: "",
    image: null,   // File — attached to a "Post"/"Bonus"
    pdfFile: null, // File — attached to a "Promotion"
  });

  useEffect(() => {
    employeesApi.fetchHolidays().then(setHolidays).catch(() => {});
    employeesApi.fetchAnnouncements().then(setAnnouncements).catch(() => {});
  }, []);

  // The table/card-list section (left column on desktop, but stacks BELOW
  // the stat cards + "Department Wise" panel on mobile since the layout is
  // a single-column grid there). On mobile, tapping a stat card, a
  // department row, or "View All" changes the filter but the filtered list
  // can end up off-screen, so we smooth-scroll it into view. Desktop (lg+)
  // already shows the table and the Department Wise panel side by side, so
  // this is deliberately skipped there — laptop layout/behavior stays
  // exactly the same as before.
  const tableSectionRef = useRef(null);
  const scrollToTableOnMobile = () => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return; // lg breakpoint — desktop layout, no scroll needed
    if (tableSectionRef.current) {
      tableSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Every change (approve, reject, add, remove, edit) now writes straight
  // to Postgres through the API calls in the handlers below — no more
  // localStorage persistence effects needed here.

  // Newest first, for the feed everyone sees.
  const announcementsFeed = useMemo(
    () => [...announcements].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [announcements]
  );

  // Which identity string ties an announcement to "me" — same matching
  // AuthContext id (preferred) falling back to email, exactly like
  // isOwnRow/canSeeSalary above.
  const myIdentityKey = currentUser?.id || currentUser?.email || null;

  // The most recent promotion/bonus that targets the logged-in employee
  // and hasn't been shown to them yet — drives the 🥳 congrats popup.
  const myPendingCelebration = useMemo(() => {
    if (!myIdentityKey) return null;
    const mine = announcements.filter((a) => {
      if (a.type !== "promotion" && a.type !== "bonus") return false;
      if ((a.seenBy || []).some((k) => String(k) === String(myIdentityKey))) return false;
      const targetEmp = employees.find((e) => e.id === a.employeeId);
      if (!targetEmp) return false;
      if (targetEmp.authId && currentUser?.id && targetEmp.authId === currentUser.id) return true;
      if (targetEmp.email && currentUser?.email && targetEmp.email.toLowerCase() === currentUser.email.toLowerCase()) return true;
      return false;
    });
    return mine.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0] || null;
  }, [announcements, employees, currentUser, myIdentityKey]);

  // Whether TODAY counts as a day off, and why — drives the "Today is
  // Off" banner shown to every employee, admin included.
  const todayHoliday = useMemo(() => holidayInfoFor(todayISO(), holidays), [holidays]);

  // Already-announced holidays from today onward, soonest first — lets
  // admin see (and cancel) what's already been announced, not just add
  // new ones blind.
  const upcomingHolidays = useMemo(
    () => holidays.filter((h) => h.date >= todayISO()).sort((a, b) => a.date.localeCompare(b.date)),
    [holidays]
  );

  const showToast = (message, tone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  };

  useEffect(() => setPage(1), [activeTab, deptFilter, roleFilter, search, rowsPerPage]);

  useEffect(() => {
    function onClickOutside(e) {
      if (filtersRef.current && !filtersRef.current.contains(e.target)) setFiltersOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // The row-actions menu is portaled to <body> (so it can float above the
  // scrollable table instead of being clipped by it), so it needs its own
  // outside-click/scroll/resize handling to close since it's no longer a
  // DOM descendant of the row that opened it.
  useEffect(() => {
    if (!openActionMenu) return;
    function onClickOutside(e) {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) {
        setOpenActionMenu(null);
      }
    }
    function onScrollOrResize() {
      setOpenActionMenu(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [openActionMenu]);

  const counts = useMemo(() => {
    const active = employees.filter((e) => e.status === "Active").length;
    const onLeave = employees.filter((e) => e.status === "On Leave").length;
    return { total: employees.length, active, onLeave };
  }, [employees]);

  const deptCounts = useMemo(() => {
    return DEPARTMENTS.map((d) => ({
      ...d,
      count: employees.filter((e) => e.department === d.name).length,
    })).sort((a, b) => b.count - a.count);
  }, [employees]);

  const maxDeptCount = Math.max(1, ...deptCounts.map((d) => d.count));

  const roleOptions = useMemo(() => Array.from(new Set(employees.map((e) => e.role))).sort(), [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employeesLive.filter((e) => {
      const matchesTab =
        activeTab === "all" ||
        (activeTab === "active" && e.status === "Active") ||
        (activeTab === "leave" && e.status === "On Leave");
      const matchesSearch = !q || e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q) || e.email.toLowerCase().includes(q);
      const matchesDept = deptFilter === "All Departments" || e.department === deptFilter;
      const matchesRole = roleFilter === "All Roles" || e.role === roleFilter;
      return matchesTab && matchesSearch && matchesDept && matchesRole;
    });
  }, [employeesLive, activeTab, search, deptFilter, roleFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const pageStart = (page - 1) * rowsPerPage;
  const paged = filtered.slice(pageStart, pageStart + rowsPerPage);

  const setEmpStatus = (id, status) => {
    setEmployees((list) => list.map((e) => (e.id === id ? { ...e, status } : e))); // optimistic
    setOpenActionMenu(null);
    employeesApi.setEmployeeStatus(id, status).catch((err) => {
      showToast(err.message || "Couldn't update status.", "error");
      refreshEmployees();
    });
  };

  // "Don't off today" — admin asks one employee (politely) to work today
  // instead of taking the day off (e.g. a Sunday they don't want to give
  // off). Sent as a normal direct message so it lands in their Messages.
  const sendDontOffRequest = async (emp) => {
    setOpenActionMenu(null);
    if (!emp?.authId) {
      showToast("This employee has no linked account to message.", "error");
      return;
    }
    const first = (emp.name || "").trim().split(/\s+/)[0] || "there";
    const dayPhrase = isSunday(todayISO()) ? "today (Sunday)" : "today";
    const text =
      `Hi ${first}, hope you're doing well. We have some important work that needs to be completed ${dayPhrase}, ` +
      `so we would like to politely request you to please work ${dayPhrase} instead of taking the day off. ` +
      `We truly appreciate your understanding, support and dedication. Thank you so much!`;
    try {
      await messagesApi.sendMessage({ recipientId: emp.authId, text });
      showToast(`Request sent to ${emp.name}.`, "success");
    } catch (err) {
      showToast(err.message || "Couldn't send the request.", "error");
    }
  };

  // Admin announces a company-wide holiday for a specific date. Sunday
  // doesn't need this — it's already automatically off — so this covers
  // everything else (Eid, a public holiday, an office closure, etc.).
  // Announcing again for a date that's already announced just replaces
  // its reason instead of creating a duplicate entry.
  const announceHoliday = (date, reason) => {
    if (!date) return;
    if (isSunday(date)) {
      showToast("Sunday is already an automatic weekly off.", "error");
      return;
    }
    employeesApi
      .announceHoliday(date, reason.trim() || "Company Holiday")
      .then((saved) => {
        setHolidays((list) => [...list.filter((h) => h.date !== date), saved]);
        setHolidayForm({ date: todayISO(), reason: "" });
        showToast(`Holiday announced for ${fmtDate(date)}.`, "success");
      })
      .catch((err) => showToast(err.message || "Couldn't announce holiday.", "error"));
  };

  const cancelHoliday = (id) => {
    setHolidays((list) => list.filter((h) => h.id !== id)); // optimistic
    employeesApi
      .cancelHoliday(id)
      .then(() => showToast("Holiday announcement removed.", "error"))
      .catch((err) => {
        showToast(err.message || "Couldn't remove holiday.", "error");
        employeesApi.fetchHolidays().then(setHolidays).catch(() => {});
      });
  };

  // Admin gives a promotion/bonus to one employee, or publishes a
  // general company post — either way it lands in the shared feed that
  // every employee sees, and (for promotion/bonus) queues the 🥳 popup
  // for that specific employee the next time they open the page.
  const giveRecognition = () => {
    const f = recognitionForm;
    if (f.type === "post") {
      if (!f.message.trim()) return;
    } else if (!f.employeeId) {
      return;
    }
    const emp = f.type !== "post" ? employees.find((e) => String(e.id) === String(f.employeeId)) : null;

    employeesApi
      .postAnnouncement({
        type: f.type,
        employeeId: emp ? emp.id : null,
        detail: f.detail.trim(),
        message: f.message.trim(),
        // A Post, Bonus or Promotion can all carry a photo; a Promotion can
        // additionally carry a PDF (e.g. the signed promotion/offer
        // letter). Both are real File objects, uploaded and stored on
        // disk by the backend — not base64 data URLs.
        image: f.image || null,
        pdfFile: f.type === "promotion" ? f.pdfFile || null : null,
      })
      .then((entry) => {
        setAnnouncements((list) => [entry, ...list]);
        setRecognitionForm({ type: f.type, employeeId: "", detail: "", message: "", image: null, pdfFile: null });
        showToast(
          f.type === "post"
            ? "Post published to all employees."
            : `${emp?.name || "Employee"} ${f.type === "promotion" ? "promoted" : "given a bonus"} — announced to everyone.`,
          "success"
        );
      })
      .catch((err) => showToast(err.message || "Couldn't publish announcement.", "error"));
  };

  const cancelAnnouncement = (id) => {
    setAnnouncements((list) => list.filter((a) => a.id !== id)); // optimistic
    employeesApi
      .cancelAnnouncement(id)
      .then(() => showToast("Announcement removed.", "error"))
      .catch((err) => {
        showToast(err.message || "Couldn't remove announcement.", "error");
        employeesApi.fetchAnnouncements().then(setAnnouncements).catch(() => {});
      });
  };

  // Marks the currently-shown celebration as seen for this user so the
  // popup doesn't reappear on the next visit/refresh.
  const dismissCelebration = () => {
    if (!myPendingCelebration) return;
    const id = myPendingCelebration.id;
    // Optimistic hide (myIdentityKey is a locally-computed guess), then
    // reconcile with the server's own seenBy list once it responds.
    setAnnouncements((list) =>
      list.map((a) => (a.id === id ? { ...a, seenBy: [...(a.seenBy || []), String(myIdentityKey)] } : a))
    );
    employeesApi
      .markAnnouncementSeen(id)
      .then((saved) => setAnnouncements((list) => list.map((a) => (a.id === id ? saved : a))))
      .catch(() => {});
  };

  // Admin manually sets an employee's star rating based on how their
  // assigned-vs-completed projects look. Not auto-computed on purpose.
  // Dropping to the very last star (1) is a big enough moment that we
  // don't save it silently — instead we pause and ask the admin to
  // decide right then: remove the employee, or give one more chance.
  const setEmployeeRating = (id, rating) => {
    if (rating === 1) {
      const emp = employees.find((e) => e.id === id);
      setLastStarPrompt({ id, name: emp?.name || "This employee" });
      return;
    }
    setEmployees((list) => list.map((e) => (e.id === id ? { ...e, rating } : e))); // optimistic
    employeesApi.setEmployeeRating(id, rating).catch((err) => {
      showToast(err.message || "Couldn't update rating.", "error");
      refreshEmployees();
    });
  };

  // Admin's decision once an employee hits the last star: either remove
  // them outright, or give them one more chance — which restores the
  // rating to 2 stars rather than leaving it at the terminal 1.
  const resolveLastStarPrompt = (decision) => {
    if (!lastStarPrompt) return;
    const { id, name } = lastStarPrompt;
    if (decision === "remove") {
      removeEmployee(id);
    } else if (decision === "chance") {
      setEmployees((list) => list.map((e) => (e.id === id ? { ...e, rating: 2 } : e))); // optimistic
      employeesApi.setEmployeeRating(id, 2).catch((err) => {
        showToast(err.message || "Couldn't update rating.", "error");
        refreshEmployees();
      });
      showToast(`${name} given one more chance — rating set to 2 stars.`, "success");
    }
    setLastStarPrompt(null);
  };

  // Admin manually updates an employee's total assigned / completed
  // project counts (field is "projectsAssigned" or "projectsCompleted").
  const setEmployeeProjects = (id, field, value) => {
    const num = Math.max(0, Math.round(Number(value) || 0));
    setEmployees((list) => list.map((e) => (e.id === id ? { ...e, [field]: num } : e))); // optimistic
    // Only takes effect on the backend while this employee has no
    // matching real project/task yet — see employees/serializers.py.
    employeesApi.setEmployeePerformance(id, { [field]: num }).catch((err) => {
      showToast(err.message || "Couldn't update that.", "error");
      refreshEmployees();
    });
  };

  // Admin gives (or increases) an employee's monthly salary from right
  // here on the Employees page — no need to go back to Users & Roles for
  // a raise. Pushes the new number back onto the real linked account too
  // (updateUserProfile), so Users & Roles / the User page shows the same
  // updated salary immediately — and the next GET /api/employees/ refetch
  // picks up the same number from there too, so a raise given from either
  // page always ends up agreeing with the other.
  const setEmployeeSalary = async (id, value) => {
    const num = Math.max(0, Math.round(Number(value) || 0));
    const emp = employees.find((e) => e.id === id);
    const previousSalary = emp?.salary ?? null;
    setEmployees((list) =>
      list.map((e) => (e.id === id ? { ...e, salary: num } : e))
    );
    // FIX: updateUserProfile() resolves to true/false (never a
    // {success:false} object), so the old `result.success === false` check
    // could never fire — a rejected save still toasted "salary updated"
    // and the number only existed in this browser. Now a `false` result
    // rolls the local value back and says so, so what you see is what is
    // really stored (and therefore what every other device will see).
    let saved = true;
    if (emp?.authId && typeof updateUserProfile === "function") {
      try {
        saved = (await updateUserProfile(emp.authId, { salary: num })) === true;
      } catch {
        saved = false;
      }
    }
    if (!saved) {
      setEmployees((list) =>
        list.map((e) => (e.id === id ? { ...e, salary: previousSalary } : e))
      );
      if (detailsEmp?.id === id) setDetailsEmp({ ...detailsEmp, salary: previousSalary });
      showToast("Couldn't save the salary — the employee may not have completed their profile yet.", "error");
      return;
    }
    if (detailsEmp?.id === id) setDetailsEmp({ ...detailsEmp, salary: num });
    showToast(`${emp?.name || "Employee"}'s salary updated to ${fmtMoney(num)}.`, "success");
  };

  // Removing an employee here only ever touched this page's local list. For
  // a row linked to a real Users & Roles account (`authId`), that left the
  // real account untouched — still logged in, still active — while the
  // person quietly vanished from Employees. Now we also deactivate the real
  // account (reversible from Users & Roles), so removing someone here
  // actually removes their access too. Manually-added employees (no
  // authId) just get removed locally, same as before.
  const removeEmployee = async (id) => {
    const emp = employees.find((e) => e.id === id);

    if (emp?.authId && typeof setUserStatus === "function") {
      // Same fix again — setUserStatus() is async.
      try {
        const result = await setUserStatus(emp.authId, "deactivated");
        if (result && result.success === false) {
          showToast(result.error || "Removed here, but couldn't deactivate the linked account.", "error");
        }
      } catch {
        // local removal below still goes through regardless
      }
    }

    setEmployees((list) => list.filter((e) => e.id !== id));
    setOpenActionMenu(null);
    if (detailsEmp?.id === id) setDetailsEmp(null);
    showToast(
      emp?.authId ? `${emp?.name || "Employee"} removed and account deactivated.` : `${emp?.name || "Employee"} removed.`,
      "error"
    );
  };

  // Used by the Edit modal's duplicate-email guard. Checks both the local
  // employees list (covers manually-added rows) and AuthContext's full
  // `users` list (covers real accounts that aren't in `employees` yet),
  // excluding the row/account currently being edited.
  const isEmailTaken = (email, employeeId, authId) => {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return false;
    const dupeInEmployees = employees.some(
      (e) => e.id !== employeeId && e.email.trim().toLowerCase() === normalized
    );
    if (dupeInEmployees) return true;
    if (Array.isArray(users)) {
      return users.some(
        (u) => u.id !== authId && (u.email || "").trim().toLowerCase() === normalized
      );
    }
    return false;
  };

  // "Add Employee" no longer creates a fake local-only row. It sends a real
  // invite (via AuthContext's inviteUser), which creates a "pending"
  // account in Users & Roles — same approval queue as a self-signup. This
  // row only appears here once an admin approves it from Users & Roles;
  // the sync effect above already watches `approvedUsers` and will pick it
  // up automatically at that point, so nothing else needs to change here.
  const handleAdd = async (data) => {
    if (typeof inviteUser !== "function") {
      setAddError("Invites aren't available right now.");
      return;
    }
    // inviteUser() is async (it's a real POST to the backend) — this MUST
    // be awaited, otherwise `result` is still a pending Promise (which has
    // no `.success`/`.error`), so the check below would always read as a
    // failure even when the invite actually went through.
    const result = await inviteUser({
      name: data.name.trim(),
      email: data.email.trim(),
      role: data.role,
      department: data.department,
    });
    if (!result?.success) {
      setAddError(result?.error || "Could not send the invite.");
      return;
    }
    setAddError(null);
    setAddOpen(false);
    showToast(`Invite sent to ${data.email.trim()} — they'll appear here once approved from Users & Roles.`, "success");
  };

  // Saves edits from the "Edit employee" modal. The local employee row is
  // updated optimistically, then reconciled with the server via
  // refreshEmployees(). If this row is linked to a real Users & Roles
  // account and AuthContext exposes a way to update a user's profile, we
  // also push the identity fields back onto that account so both pages
  // agree — if that function isn't available for some reason, the local
  // edit on this page still goes through fine. `location` has no home on
  // users.User/Profile, so it's saved separately via the employees API.
  const handleEditSubmit = async (id, data) => {
    const emp = employees.find((e) => e.id === id);
    const updated = {
      name: data.name.trim(),
      email: data.email.trim(),
      phone: data.phone.trim() || "—",
      location: data.location.trim(),
      department: data.department,
      role: data.role,
    };

    setEmployees((list) =>
      list.map((e) => (e.id === id ? { ...e, ...updated } : e))
    ); // optimistic — refreshEmployees() below reconciles with the server

    if (emp?.authId && typeof updateUserProfile === "function") {
      // updateUserProfile() is async (a real PATCH to the backend) — this
      // needs to be awaited, otherwise the try/catch below can never
      // actually catch anything (the function returns instantly with a
      // pending Promise, so control moves straight past the catch block
      // before the request has even finished).
      try {
        const result = await updateUserProfile(emp.authId, {
          name: updated.name,
          email: updated.email,
          phone: updated.phone,
          department: updated.department,
        });
        if (result && result.success === false) {
          showToast(result.error || "Saved here, but couldn't update the linked account.", "error");
        }
      } catch {
        // local employee record is already updated regardless
      }
    }
    // location has no home on users.User/Profile — it's this app's own
    // EmployeeExtra field.
    employeesApi
      .setEmployeeLocation(id, updated.location)
      .catch((err) => showToast(err.message || "Couldn't save location.", "error"))
      .finally(refreshEmployees);

    setEditEmp(null);
    if (detailsEmp?.id === id) setDetailsEmp({ ...detailsEmp, ...updated });
    showToast(`${updated.name} updated.`, "success");
  };

  // Employee files a new leave request against their own row. It starts
  // "pending" — it has zero effect on the monthly count (and therefore
  // salary) until an approver acts on it.
  const submitLeaveRequest = (employeeId, data) => {
    const days = computeLeaveDays(data.type, data.startDate, data.endDate);
    const endDate = data.type === "Half Day" ? data.startDate : data.endDate || data.startDate;

    employeesApi
      .submitLeaveRequest(employeeId, {
        type: data.type,
        startDate: data.startDate,
        endDate,
        reason: data.reason.trim(),
      })
      .then((request) => {
        setEmployees((list) =>
          list.map((e) =>
            e.id === employeeId ? { ...e, leaveRequests: [request, ...(e.leaveRequests || [])] } : e
          )
        );
        setLeaveTargetEmp(null);
        showToast(`Leave request sent — ${fmtLeaveDays(days)} pending approval.`, "success");
      })
      .catch((err) => showToast(err.message || "Couldn't send leave request.", "error"));
  };

  // Approver acts on a pending request. Approving is what actually adds
  // those days to the employee's monthly leave count (used for salary
  // cutting) — rejecting leaves the count untouched.
  const decideLeaveRequest = (employeeId, requestId, decision) => {
    const emp = employees.find((e) => e.id === employeeId);
    const pending = (emp?.leaveRequests || []).find((r) => r.id === requestId);
    const empName = emp?.name || "";
    const days = pending?.days || 0;

    employeesApi
      .decideLeaveRequest(requestId, decision)
      .then((decidedRequest) => {
        setEmployees((list) =>
          list.map((e) => {
            if (e.id !== employeeId) return e;
            const leaveRequests = (e.leaveRequests || []).map((r) =>
              r.id === requestId ? decidedRequest : r
            );
            // If the approved leave covers today, reflect it immediately on
            // the employee's status — that's what drives the "On Leave"
            // stat card and tab. The backend already flips this server-side
            // too; this just avoids waiting on the next refresh to see it.
            const today = todayISO();
            const isOnLeaveNow =
              decision === "approved" &&
              today >= decidedRequest.startDate &&
              today <= decidedRequest.endDate;
            return { ...e, leaveRequests, status: isOnLeaveNow ? "On Leave" : e.status };
          })
        );
        showToast(
          decision === "approved"
            ? `Approved ${fmtLeaveDays(days)} leave for ${empName}.`
            : `Rejected leave request for ${empName}.`,
          decision === "approved" ? "success" : "error"
        );
      })
      .catch((err) => showToast(err.message || "Couldn't decide that leave request.", "error"));
  };

  const tabDefs = [
    { key: "all", label: "All Employees" },
    { key: "active", label: "Active" },
    { key: "leave", label: "On Leave" },
  ];

  const donutSegments = [
    { color: "#10b981", pct: counts.total ? Math.round((counts.active / counts.total) * 100) : 0 },
    { color: "#f59e0b", pct: counts.total ? Math.round((counts.onLeave / counts.total) * 100) : 0 },
  ];

  return (
    <div className={theme.headingText} style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      <TeamBirthdayConfetti people={employees} />
      <div className="space-y-4">
        {/* Shown to EVERYONE — admin and regular employees alike — the
            moment today counts as a day off, whether that's the automatic
            Sunday weekly-off or a date the admin specifically announced. */}
        {todayHoliday.isOff && <TodayOffBanner theme={theme} reason={todayHoliday.reason} />}

        {/* Promotions, bonuses and company posts — visible to EVERY
            employee (not just admin), so recognizing one person's
            work encourages the whole team. Shown after the stat cards /
            Invite Employee row below, not before. */}

        {/* FIX (role-based interface): a regular employee/user gets ONLY
            their own profile — no stat cards, no other employees' data,
            and no way to change their own status (that's admin-only, from
            the full table below). Admin keeps the exact page it always
            had, plus the new "Announce Holiday" card further down. */}
        {!isAdmin ? (
          <>
            <AnnouncementsFeed theme={theme} feed={announcementsFeed} onCancel={cancelAnnouncement} isAdmin={isAdmin} />
            <MyProfileSection
              theme={theme}
              employee={myEmployeeRow}
              onRequestLeave={() => myEmployeeRow && setLeaveTargetEmp(myEmployeeRow)}
            />
          </>
        ) : (
        <>
        {/* Stat cards + Add Employee / Request Leave row */}
        {(canCreateEmployees || myEmployeeRow) && (
          <div className="flex justify-end gap-2">
            {myEmployeeRow && (
              <button
                onClick={() => setLeaveTargetEmp(myEmployeeRow)}
                className={`flex items-center gap-1.5 border text-sm font-semibold px-4 py-2.5 rounded-full transition shrink-0 ${theme.border} ${theme.cardText} hover:${theme.hoverIconBg}`}
              >
                <CalendarPlus className="w-4 h-4" /> Request Leave
              </button>
            )}
            {canCreateEmployees && (
              <button
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold px-4 py-2.5 rounded-full transition shrink-0"
              >
                <Plus className="w-4 h-4" /> Invite Employee
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <StatCard
            theme={theme}
            icon={Users2} iconBg="bg-violet-50" iconText="text-violet-600"
            label="Total Employees" value={counts.total} delta="12%" up
            active={activeTab === "all"} onClick={() => { setActiveTab("all"); scrollToTableOnMobile(); }}
          />
          <StatCard
            theme={theme}
            icon={UserCheck} iconBg="bg-emerald-50" iconText="text-emerald-600"
            label="Active Employees" value={counts.active} delta="8%" up
            active={activeTab === "active"} onClick={() => { setActiveTab("active"); scrollToTableOnMobile(); }}
          />
          <StatCard
            theme={theme}
            icon={Clock3} iconBg="bg-blue-50" iconText="text-blue-600"
            label="On Leave" value={counts.onLeave} delta="5%" up
            active={activeTab === "leave"} onClick={() => { setActiveTab("leave"); scrollToTableOnMobile(); }}
          />
        </div>

        {/* Promotions, bonuses and company posts — visible to EVERY
            employee (not just admin), so recognizing one person's
            work encourages the whole team. Now shown below the stat
            cards / Invite Employee row instead of above them. */}
        <AnnouncementsFeed theme={theme} feed={announcementsFeed} onCancel={cancelAnnouncement} isAdmin={isAdmin} />

        {/* CONTENT GRID */}
        <div className="grid gap-4 items-start lg:grid-cols-[1fr,320px]">
          {/* LEFT: table card */}
          <div ref={tableSectionRef} className={`rounded-2xl overflow-hidden ${theme.card}`}>
            {/* Tabs */}
            <div className={`flex items-center gap-1 px-4 pt-3 overflow-x-auto whitespace-nowrap border-b ${theme.borderLight}`}>
              {tabDefs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-2 text-sm font-semibold border-b-2 transition shrink-0 ${
                    activeTab === t.key ? "text-violet-600 border-violet-600" : `${theme.mutedText} border-transparent hover:text-violet-500`
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              >
                <option>All Departments</option>
                {DEPARTMENTS.map((d) => <option key={d.name}>{d.name}</option>)}
              </select>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className={`text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              >
                <option>All Roles</option>
                {roleOptions.map((r) => <option key={r}>{r}</option>)}
              </select>
              <div className="relative" ref={filtersRef}>
                <button
                  onClick={() => setFiltersOpen((v) => !v)}
                  className={`flex items-center gap-1.5 text-sm border rounded-lg px-3 py-1.5 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                >
                  <Filter className="w-3.5 h-3.5" /> Filter
                  <ChevronDown size={12} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
                </button>
                {filtersOpen && (
                  <div className={`absolute left-0 sm:right-0 sm:left-auto top-full mt-1.5 w-56 rounded-xl shadow-xl z-30 p-3 space-y-2 ${theme.card}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wide ${theme.subtleText}`}>Status</p>
                    <select
                      value={activeTab}
                      onChange={(e) => setActiveTab(e.target.value)}
                      className={`w-full text-sm border rounded-lg px-2.5 py-1.5 outline-none ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                    >
                      <option value="all">All</option>
                      <option value="active">Active</option>
                      <option value="leave">On Leave</option>
                    </select>
                    <button
                      onClick={() => {
                        setDeptFilter("All Departments");
                        setRoleFilter("All Roles");
                        setActiveTab("all");
                        setSearch("");
                      }}
                      className="w-full text-xs font-semibold text-violet-600 hover:text-violet-700 text-left"
                    >
                      Clear all filters
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Desktop table — full list, no inner scroll cap (page itself
                scrolls); the max-height inner-scroll box is a mobile-only
                pattern, kept below for the card list. */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className={`text-left text-xs border-y ${theme.mutedText} ${theme.borderLight} ${theme.inputBg}`}>
                    <th className="py-2.5 pl-5 pr-2 font-semibold">Employee</th>
                    <th className="py-2.5 px-2 font-semibold">Role</th>
                    <th className="py-2.5 px-2 font-semibold">Department</th>
                    <th className="py-2.5 px-2 font-semibold">Projects</th>
                    <th className="py-2.5 px-2 font-semibold">Tasks</th>
                    <th className="py-2.5 px-2 font-semibold">Rating</th>
                    <th className="py-2.5 px-2 font-semibold">Status</th>
                    <th className="py-2.5 px-2 font-semibold">Joined</th>
                    <th className="py-2.5 px-2 font-semibold">Leaves (mo.)</th>
                    {showSalaryColumn && <th className="py-2.5 px-2 font-semibold">Salary</th>}
                    <th className="py-2.5 pr-5 pl-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${theme.divide}`}>
                  {paged.map((e) => (
                    <Fragment key={e.id}>
                    <tr onClick={() => setDetailsEmp(e)} className={`cursor-pointer ${theme.hoverRow}`}>
                      <td className="py-2.5 pl-5 pr-2">
                        <div className="flex items-center gap-2.5 min-w-[190px]">
                          <Avatar name={e.name} avatar={e.avatar} />
                          <div className="min-w-0">
                            <p className={`font-semibold truncate ${theme.headingText}`}>
                              {e.name} {isBirthdayToday(e.dateOfBirth) && <span title="Birthday today!">🎂</span>}
                            </p>
                            <p className={`text-xs truncate ${theme.subtleText}`}>{e.email}</p>
                            <div className="mt-1"><AttentionBadge emp={e} /></div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-2"><RoleBadge role={e.role} /></td>
                      <td className="py-2.5 px-2 whitespace-nowrap"><DeptTag department={e.department} theme={theme} /></td>
                      <td className={`py-2.5 px-2 whitespace-nowrap font-medium ${theme.cardText}`} title="Completed / Assigned">
                        {e.projectsCompleted || 0}/{e.projectsAssigned || 0}
                      </td>
                      <td className={`py-2.5 px-2 whitespace-nowrap font-medium ${theme.cardText}`}>{e.tasks}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap" onClick={(ev) => ev.stopPropagation()}>
                        <StarRating value={e.rating ?? 5} onChange={(n) => setEmployeeRating(e.id, n)} size="w-3.5 h-3.5" theme={theme} />
                      </td>
                      <td className="py-2.5 px-2"><StatusBadge status={e.status} /></td>
                      <td className={`py-2.5 px-2 whitespace-nowrap ${theme.mutedText}`}>{fmtDate(e.joined)}</td>
                      <td className="py-2.5 px-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-medium ${theme.cardText}`}>{fmtLeaveDays(monthlyApprovedLeaveDays(e))}</span>
                          {pendingLeaveRequestsOf(e).length > 0 && canReviewLeaves && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600 whitespace-nowrap">
                              {pendingLeaveRequestsOf(e).length} pending
                            </span>
                          )}
                        </div>
                      </td>
                      {showSalaryColumn && (
                        <td className={`py-2.5 px-2 whitespace-nowrap font-semibold ${theme.cardText}`}>
                          {canSeeSalary(e)
                            ? (isPerProject(e)
                                ? <>{fmtMoney(e.commissionTotal)}<span className={`block text-[10px] font-medium ${theme.subtleText}`}>Per project</span></>
                                : (e.salary != null ? fmtMoney(e.salary) : <span className={theme.subtleText}>—</span>))
                            : <span className={theme.subtleText}>Hidden</span>}
                        </td>
                      )}
                      <td className="py-2.5 pr-5 pl-2 text-right relative" onClick={(ev) => ev.stopPropagation()}>
                        <button
                          onClick={(ev) => {
                            if (openActionMenu === e.id) {
                              setOpenActionMenu(null);
                              return;
                            }
                            const rect = ev.currentTarget.getBoundingClientRect();
                            setActionMenuPos({ top: rect.bottom + 6, left: rect.right - 176 });
                            setOpenActionMenu(e.id);
                          }}
                          className={`w-8 h-8 inline-flex items-center justify-center rounded-lg ${theme.mutedText} hover:${theme.hoverIconBg}`}
                          aria-label="Row actions"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </button>
                        {openActionMenu === e.id && actionMenuPos && createPortal(
                          <div
                            ref={actionMenuRef}
                            style={{ position: "fixed", top: actionMenuPos.top, left: actionMenuPos.left }}
                            className={`z-[100] w-44 rounded-xl shadow-lg py-1 text-left ${theme.card}`}
                            onClick={(ev) => ev.stopPropagation()}
                          >
                            <button onClick={() => { setDetailsEmp(e); setOpenActionMenu(null); }} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}>
                              <Eye className="w-3.5 h-3.5" /> View profile
                            </button>
                            {canEditEmployees && (
                              <button onClick={() => { setEditEmp(e); setOpenActionMenu(null); }} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}>
                                <Pencil className="w-3.5 h-3.5" /> Edit employee
                              </button>
                            )}
                            {isOwnRow(e) && (
                              <button onClick={() => { setLeaveTargetEmp(e); setOpenActionMenu(null); }} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}>
                                <CalendarPlus className="w-3.5 h-3.5" /> Request leave
                              </button>
                            )}
                            {/* FIX (only admin can change status): this menu only ever
                                renders inside the admin-only table, but gate it
                                explicitly too so it can never drift out of sync with
                                that rule later. */}
                            {isAdmin && (e.status !== "On Leave" ? (
                              <button onClick={() => setEmpStatus(e.id, "On Leave")} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}>
                                <Clock3 className="w-3.5 h-3.5" /> Mark on leave
                              </button>
                            ) : (
                              <button onClick={() => setEmpStatus(e.id, "Active")} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}>
                                <UserCheck className="w-3.5 h-3.5" /> Mark active
                              </button>
                            ))}
                            {isAdmin && !isOwnRow(e) && (
                              <button onClick={() => sendDontOffRequest(e)} className={`w-full flex items-center gap-2 text-left px-3 py-2 text-sm ${theme.cardText} ${theme.hoverRow}`}>
                                <Send className="w-3.5 h-3.5" /> Don't off today
                              </button>
                            )}
                            {canDeleteEmployees && (
                              <button onClick={() => removeEmployee(e.id)} className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                                <Trash2 className="w-3.5 h-3.5" /> Remove employee
                              </button>
                            )}
                          </div>,
                          document.body
                        )}
                      </td>
                    </tr>
                    {canReviewLeaves && pendingLeaveRequestsOf(e).length > 0 && (
                      <tr className="bg-amber-50/60">
                        <td colSpan={showSalaryColumn ? 11 : 10} className="py-2.5 px-5">
                          <div className="space-y-2">
                            {pendingLeaveRequestsOf(e).map((r) => (
                              <div key={r.id} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-amber-700">
                                    {e.name} requested {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                                    {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""}
                                  </p>
                                  {r.reason && (
                                    <p className="text-xs text-amber-800/80 mt-0.5 flex items-start gap-1">
                                      <MessageSquareText className="w-3 h-3 mt-0.5 shrink-0" /> "{r.reason}"
                                    </p>
                                  )}
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    onClick={() => decideLeaveRequest(e.id, r.id, "approved")}
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                  >
                                    <Check className="w-3 h-3" /> Approve
                                  </button>
                                  <button
                                    onClick={() => decideLeaveRequest(e.id, r.id, "rejected")}
                                    className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50"
                                  >
                                    <XCircle className="w-3 h-3" /> Reject
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                  {paged.length === 0 && (
                    <tr>
                      <td colSpan={showSalaryColumn ? 11 : 10} className={`text-center py-14 text-sm ${theme.subtleText}`}>No employees match these filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className={`md:hidden divide-y ${theme.divide} overflow-y-auto max-h-[600px]`}>
              {paged.map((e) => (
                <Fragment key={e.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailsEmp(e)}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") setDetailsEmp(e);
                  }}
                  className={`w-full text-left p-4 cursor-pointer ${theme.hoverRow}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar name={e.name} avatar={e.avatar} />
                      <div className="min-w-0">
                        <p className={`font-semibold text-sm truncate ${theme.headingText}`}>
                          {e.name} {isBirthdayToday(e.dateOfBirth) && <span title="Birthday today!">🎂</span>}
                        </p>
                        <p className={`text-xs truncate ${theme.subtleText}`}>{e.email}</p>
                      </div>
                    </div>
                    <StatusBadge status={e.status} />
                  </div>
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <RoleBadge role={e.role} />
                    <DeptTag department={e.department} theme={theme} />
                  </div>
                  <div className="mb-2"><AttentionBadge emp={e} /></div>
                  <div className={`flex items-center justify-between text-xs ${theme.mutedText}`}>
                    <span>{e.projectsCompleted || 0}/{e.projectsAssigned || 0} projects · {e.tasks} tasks</span>
                    <span>Joined {fmtDate(e.joined)}</span>
                  </div>
                  <div className="mt-1.5" onClick={(ev) => ev.stopPropagation()}>
                    <StarRating value={e.rating ?? 5} onChange={(n) => setEmployeeRating(e.id, n)} size="w-3.5 h-3.5" theme={theme} />
                  </div>
                  <div className={`flex items-center gap-1.5 text-xs mt-1.5 ${theme.mutedText}`}>
                    <CalendarPlus className="w-3.5 h-3.5 text-amber-500" />
                    {fmtLeaveDays(monthlyApprovedLeaveDays(e))} this month
                    {pendingLeaveRequestsOf(e).length > 0 && canReviewLeaves && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-600">
                        {pendingLeaveRequestsOf(e).length} pending
                      </span>
                    )}
                  </div>
                  {showSalaryColumn && (
                    <div className={`flex items-center gap-1.5 text-xs font-semibold mt-1.5 ${theme.cardText}`}>
                      <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
                      {canSeeSalary(e) ? (isPerProject(e) ? `${fmtMoney(e.commissionTotal)} · per project` : e.salary != null ? fmtMoney(e.salary) : "—") : "Hidden"}
                    </div>
                  )}
                </div>
                {canReviewLeaves && pendingLeaveRequestsOf(e).length > 0 && (
                  <div className="bg-amber-50/60 px-4 py-2.5 space-y-2">
                    {pendingLeaveRequestsOf(e).map((r) => (
                      <div key={r.id}>
                        <p className="text-xs font-semibold text-amber-700">
                          {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                          {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""}
                        </p>
                        {r.reason && (
                          <p className="text-xs text-amber-800/80 mt-0.5 flex items-start gap-1">
                            <MessageSquareText className="w-3 h-3 mt-0.5 shrink-0" /> "{r.reason}"
                          </p>
                        )}
                        <div className="flex gap-1.5 mt-1.5">
                          <button
                            onClick={() => decideLeaveRequest(e.id, r.id, "approved")}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            onClick={() => decideLeaveRequest(e.id, r.id, "rejected")}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50"
                          >
                            <XCircle className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                </Fragment>
              ))}
              {paged.length === 0 && <p className={`text-center py-12 text-sm ${theme.subtleText}`}>No employees match these filters.</p>}
            </div>

            {/* Pagination */}
            <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t ${theme.borderLight} text-sm`}>
              <p className={`text-xs ${theme.subtleText}`}>
                Showing {filtered.length === 0 ? 0 : pageStart + 1} to {Math.min(pageStart + rowsPerPage, filtered.length)} of {filtered.length} employees
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className={`w-8 h-8 flex items-center justify-center rounded-lg border ${theme.border} disabled:opacity-40`}>‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-semibold ${page === p ? "bg-violet-600 text-white" : `border ${theme.border} ${theme.cardText}`}`}>
                    {p}
                  </button>
                ))}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className={`w-8 h-8 flex items-center justify-center rounded-lg border ${theme.border} disabled:opacity-40`}>›</button>
              </div>
              <div className={`flex items-center gap-2 text-xs ${theme.subtleText}`}>
                Rows per page:
                <select value={rowsPerPage} onChange={(e) => setRowsPerPage(Number(e.target.value))} className={`border rounded-lg px-2 py-1 outline-none ${theme.border} ${theme.inputBg} ${theme.cardText}`}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* RIGHT: side panels */}
          <div className="space-y-4">
            {/* Employee Overview */}
            <div className={`rounded-2xl p-4 ${theme.card}`}>
              <h3 className={`font-bold text-sm mb-3 ${theme.headingText}`}>Employee Overview</h3>
              <div className="flex items-center gap-4">
                <DonutChart segments={donutSegments} centerValue={counts.total} centerLabel="Total" theme={theme} />
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className={theme.mutedText}>Active</span>
                    <span className={`font-semibold ml-auto ${theme.headingText}`}>{counts.active} ({counts.total ? Math.round((counts.active / counts.total) * 1000) / 10 : 0}%)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    <span className={theme.mutedText}>On Leave</span>
                    <span className={`font-semibold ml-auto ${theme.headingText}`}>{counts.onLeave} ({counts.total ? Math.round((counts.onLeave / counts.total) * 1000) / 10 : 0}%)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Announce Holiday — admin-only, always available regardless
                of the per-module Employees permissions above, since
                announcing a company holiday isn't the same thing as
                editing an employee record. */}
            <AnnounceHolidayCard
              theme={theme}
              form={holidayForm}
              setForm={setHolidayForm}
              onAnnounce={announceHoliday}
              upcoming={upcomingHolidays}
              onCancel={cancelHoliday}
            />

            {/* Promotion / Bonus / Post — admin-only composer for the
                shared announcement feed shown at the top of the page. */}
            <RecognitionCard
              theme={theme}
              employees={employees}
              form={recognitionForm}
              setForm={setRecognitionForm}
              onSubmit={giveRecognition}
            />

            {/* Leave Requests — pending approvals across all employees */}
            {canReviewLeaves && (
              <div className={`rounded-2xl p-4 ${theme.card}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className={`font-bold text-sm ${theme.headingText}`}>Leave Requests</h3>
                  {allPendingLeaveRequests.length > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-600">
                      {allPendingLeaveRequests.length} pending
                    </span>
                  )}
                </div>
                {allPendingLeaveRequests.length === 0 ? (
                  <p className={`text-xs ${theme.subtleText}`}>No pending leave requests.</p>
                ) : (
                  <div className="space-y-2.5 max-h-72 overflow-y-auto">
                    {allPendingLeaveRequests.map((r) => (
                      <div key={r.id} className={`rounded-xl border p-2.5 ${theme.borderLight}`}>
                        <div className="flex items-center gap-2 mb-1">
                          <Avatar name={r.employee.name} avatar={r.employee.avatar} size="w-6 h-6" text="text-[10px]" />
                          <p className={`text-xs font-semibold truncate ${theme.headingText}`}>{r.employee.name}</p>
                        </div>
                        <p className={`text-[11px] ${theme.mutedText}`}>
                          {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                          {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""}
                        </p>
                        {r.reason && (
                          <p className={`text-[11px] mt-1 flex items-start gap-1 ${theme.subtleText}`}>
                            <MessageSquareText className="w-3 h-3 mt-0.5 shrink-0" /> {r.reason}
                          </p>
                        )}
                        <div className="flex gap-1.5 mt-2">
                          <button
                            onClick={() => decideLeaveRequest(r.employee.id, r.id, "approved")}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                          >
                            <Check className="w-3 h-3" /> Approve
                          </button>
                          <button
                            onClick={() => decideLeaveRequest(r.employee.id, r.id, "rejected")}
                            className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100"
                          >
                            <XCircle className="w-3 h-3" /> Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Department Wise */}
            <div className={`rounded-2xl p-4 ${theme.card}`}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`font-bold text-sm ${theme.headingText}`}>Department Wise</h3>
                <button
                  type="button"
                  onClick={() => { setDeptFilter("All Departments"); setActiveTab("all"); scrollToTableOnMobile(); }}
                  className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 py-1.5 px-1 -m-1 cursor-pointer"
                >
                  View All
                </button>
              </div>
              <div className="space-y-2.5">
                {deptCounts.map((d) => (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => { setDeptFilter(d.name); setActiveTab("all"); scrollToTableOnMobile(); }}
                    className="w-full flex items-center gap-2.5 text-xs group py-1 cursor-pointer"
                  >
                    <d.icon className={`w-3.5 h-3.5 shrink-0 ${d.color}`} />
                    <span className={`w-[92px] text-left truncate group-hover:text-violet-600 ${theme.mutedText}`}>{d.name}</span>
                    <span className={`flex-1 h-1.5 rounded-full overflow-hidden ${theme.inputBg}`}>
                      <span className={`block h-full rounded-full ${d.bar}`} style={{ width: `${(d.count / maxDeptCount) * 100}%` }} />
                    </span>
                    <span className={`font-semibold w-5 text-right ${theme.cardText}`}>{d.count}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      {isAdmin && addOpen && (
        <AddEmployeeModal
          theme={theme}
          onClose={() => { setAddOpen(false); setAddError(null); }}
          onSubmit={handleAdd}
          isEmailTaken={(email) => isEmailTaken(email, null, null)}
          error={addError}
        />
      )}
      {isAdmin && editEmp && (
        <EditEmployeeModal
          theme={theme}
          employee={editEmp}
          onClose={() => setEditEmp(null)}
          onSubmit={handleEditSubmit}
          isEmailTaken={(email) => isEmailTaken(email, editEmp.id, editEmp.authId)}
        />
      )}
      {isAdmin && detailsEmp && (
        <EmployeeDetailsModal
          theme={theme}
          employee={employeesLive.find((e) => e.id === detailsEmp.id) || detailsEmp}
          canSeeSalary={canSeeSalary(detailsEmp)}
          onClose={() => setDetailsEmp(null)}
          onSetStatus={(status) => { setEmpStatus(detailsEmp.id, status); setDetailsEmp({ ...detailsEmp, status }); }}
          onEdit={() => { setEditEmp(detailsEmp); setDetailsEmp(null); }}
          onRemove={() => removeEmployee(detailsEmp.id)}
          canEdit={canEditEmployees}
          canDelete={canDeleteEmployees}
          canReviewLeaves={canReviewLeaves}
          isOwnRow={isOwnRow(detailsEmp)}
          onRequestLeave={() => { setLeaveTargetEmp(detailsEmp); setDetailsEmp(null); }}
          onDecideLeave={decideLeaveRequest}
          canSetStatus={isAdmin}
          onSetRating={(rating) => setEmployeeRating(detailsEmp.id, rating)}
          onSetProjects={(field, value) => setEmployeeProjects(detailsEmp.id, field, value)}
          onSetSalary={canEditEmployees ? (value) => setEmployeeSalary(detailsEmp.id, value) : undefined}
        />
      )}
      {leaveTargetEmp && (
        <RequestLeaveModal
          theme={theme}
          employee={leaveTargetEmp}
          onClose={() => setLeaveTargetEmp(null)}
          onSubmit={submitLeaveRequest}
        />
      )}

      {/* Last-star decision — pauses the rating change instead of saving
          it silently once an admin drags someone down to 1 star. */}
      {isAdmin && lastStarPrompt && (
        <LastStarDecisionModal
          theme={theme}
          employeeName={lastStarPrompt.name}
          onGiveChance={() => resolveLastStarPrompt("chance")}
          onRemove={() => resolveLastStarPrompt("remove")}
          onCancel={() => setLastStarPrompt(null)}
        />
      )}

      {/* 🥳 Congratulations popup — pops for the employee themself the
          moment they open the page after being promoted or given a
          bonus, wherever they are (admin or regular employee view). */}
      <CongratsPopup announcement={myPendingCelebration} onClose={dismissCelebration} />

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 w-[calc(100%-2rem)] max-w-sm">
        {toasts.map((t) => (
          <div key={t.id} className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-white ${t.tone === "error" ? "bg-rose-600" : "bg-emerald-600"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ======================================================================
   EMPLOYEE DETAILS MODAL
====================================================================== */

function EmployeeDetailsModal({
  employee, onClose, onSetStatus, onEdit, onRemove, theme, canSeeSalary,
  canEdit: canEditEmp = true, canDelete: canDeleteEmp = true,
  canReviewLeaves = false, isOwnRow = false, onRequestLeave, onDecideLeave,
  // FIX (only admin can change status): nobody could self-mark
  // Active/On Leave before — this now gates those buttons so a regular
  // employee viewing their own profile can see their status but never
  // change it themselves.
  canSetStatus = false,
  onSetRating,
  onSetProjects,
  onSetSalary,
}) {
  const d = DEPT_MAP[employee.department];
  const monthlyLeaves = monthlyApprovedLeaveDays(employee);
  const pendingLeaves = pendingLeaveRequestsOf(employee);
  const leaveHistory = (employee.leaveRequests || []).filter((r) => r.status !== "pending");
  // Local draft for the salary input — resyncs whenever a different
  // employee's modal opens or their stored salary changes elsewhere.
  const [salaryInput, setSalaryInput] = useState(employee.salary != null ? String(employee.salary) : "");
  useEffect(() => {
    setSalaryInput(employee.salary != null ? String(employee.salary) : "");
  }, [employee.id, employee.salary]);
  // Per-project employees: the project / task commissions that add up to
  // what they earn (only fetched when the viewer is allowed to see pay).
  const [commissionRows, setCommissionRows] = useState([]);
  useEffect(() => {
    if (!canSeeSalary || !isPerProject(employee)) {
      setCommissionRows([]);
      return undefined;
    }
    let alive = true;
    employeesApi
      .fetchCommissions({ employee: employee.authId ?? employee.id })
      .then((rows) => {
        if (alive) setCommissionRows(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canSeeSalary, employee.id, employee.authId, employee.payType, employee.commissionTotal]);
  return (
    <div className="fixed inset-0 z-[95] bg-black/50 flex items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto shadow-2xl ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-start justify-between gap-3 p-5 sm:p-6 border-b ${theme.borderLight}`}>
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={employee.name} avatar={employee.avatar} size="w-14 h-14" text="text-base" />
            <div className="min-w-0">
              <h3 className={`font-bold text-base ${theme.headingText}`}>{employee.name}</h3>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <RoleBadge role={employee.role} />
                {d && (
                  <span className={`inline-flex items-center gap-1 text-[11px] ${theme.mutedText}`}>
                    <d.icon className={`w-3 h-3 ${d.color}`} />{employee.department}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg shrink-0 ${theme.mutedText} hover:${theme.hoverIconBg}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <Mail className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>{employee.email}</span>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <Phone className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>{employee.phone}</span>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <MapPin className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>{employee.location}</span>
            </div>
            <div className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${theme.inputBg}`}>
              <Calendar className="w-3.5 h-3.5 text-violet-500 shrink-0" />
              <span className={`truncate ${theme.cardText}`}>Joined {fmtDate(employee.joined)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
              <span className="w-9 h-9 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center"><FolderOpen className="w-4 h-4" /></span>
              <div>
                <p className={`text-[11px] ${theme.subtleText}`}>Active Projects</p>
                <p className={`font-bold ${theme.headingText}`}>{employee.projectsAssigned ?? 0}</p>
              </div>
            </div>
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
              <span className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><ListChecks className="w-4 h-4" /></span>
              <div>
                <p className={`text-[11px] ${theme.subtleText}`}>Assigned Tasks</p>
                <p className={`font-bold ${theme.headingText}`}>{employee.tasks}</p>
              </div>
            </div>
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
              <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><FolderOpen className="w-4 h-4" /></span>
              <div>
                <p className={`text-[11px] ${theme.subtleText}`}>Completed Projects</p>
                <p className={`font-bold ${theme.headingText}`}>{employee.projectsCompleted ?? 0}</p>
              </div>
            </div>
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
              <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><FolderOpen className="w-4 h-4" /></span>
              <div>
                <p className={`text-[11px] ${theme.subtleText}`}>Remaining Projects</p>
                <p className={`font-bold ${theme.headingText}`}>{employee.projectsRemaining ?? 0}</p>
              </div>
            </div>
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
              <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center"><ListChecks className="w-4 h-4" /></span>
              <div>
                <p className={`text-[11px] ${theme.subtleText}`}>Completed Tasks</p>
                <p className={`font-bold ${theme.headingText}`}>{employee.tasksCompleted ?? 0}</p>
              </div>
            </div>
            <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
              <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center"><ListChecks className="w-4 h-4" /></span>
              <div>
                <p className={`text-[11px] ${theme.subtleText}`}>Remaining Tasks</p>
                <p className={`font-bold ${theme.headingText}`}>{employee.tasksRemaining ?? 0}</p>
              </div>
            </div>
          </div>

          {/* Performance — admin sets the star rating manually, by hand,
              based on how the assigned-vs-completed project numbers look.
              New employees always start at 5 stars. */}
          <div className={`rounded-xl border p-3 ${theme.borderLight}`}>
            <div className="flex items-center justify-between mb-2.5">
              <p className={`text-xs font-semibold ${theme.headingText}`}>Performance Rating</p>
              {typeof onSetRating === "function" ? (
                <StarRating value={employee.rating ?? 5} onChange={onSetRating} size="w-4 h-4" theme={theme} />
              ) : (
                <StarRating value={employee.rating ?? 5} theme={theme} />
              )}
            </div>
            <div className="mb-2.5"><AttentionBadge emp={employee} /></div>
            <div className="grid grid-cols-2 gap-2.5 mb-1">
              <div className={`rounded-lg px-2.5 py-2 ${theme.inputBg}`}>
                <p className={`text-[10px] ${theme.subtleText}`}>Projects Assigned</p>
                <p className={`text-sm font-bold ${theme.headingText}`}>{employee.projectsAssigned ?? 0}</p>
              </div>
              <div className={`rounded-lg px-2.5 py-2 ${theme.inputBg}`}>
                <p className={`text-[10px] ${theme.subtleText}`}>Projects Completed</p>
                <p className={`text-sm font-bold ${theme.headingText}`}>{employee.projectsCompleted ?? 0}</p>
              </div>
            </div>
            <p className={`text-[10px] mb-2.5 flex items-center gap-1 ${theme.subtleText}`}>
              <FolderOpen className="w-3 h-3" /> Synced live from the Projects page
            </p>
            <ProjectsProgress emp={employee} theme={theme} />
          </div>

          {/* Leaves this month — the number payroll uses to cut salary */}
          <div className={`rounded-xl border p-3 flex items-center gap-2.5 ${theme.borderLight}`}>
            <span className="w-9 h-9 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0"><CalendarPlus className="w-4 h-4" /></span>
            <div className="min-w-0">
              <p className={`text-[11px] ${theme.subtleText}`}>Approved Leaves This Month</p>
              <p className={`font-bold ${theme.headingText}`}>{fmtLeaveDays(monthlyLeaves)}</p>
            </div>
            {isOwnRow && typeof onRequestLeave === "function" && (
              <button
                onClick={onRequestLeave}
                className="ml-auto shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90"
              >
                Request Leave
              </button>
            )}
          </div>

          {canReviewLeaves && pendingLeaves.length > 0 && (
            <div>
              <p className={`text-xs font-semibold mb-2 ${theme.headingText}`}>Pending Leave Requests</p>
              <div className="space-y-2">
                {pendingLeaves.map((r) => (
                  <div key={r.id} className={`rounded-xl border p-2.5 ${theme.borderLight}`}>
                    <p className={`text-xs font-semibold ${theme.cardText}`}>
                      {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                      {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""}
                    </p>
                    {r.reason && <p className={`text-[11px] mt-1 ${theme.subtleText}`}>{r.reason}</p>}
                    <div className="flex gap-1.5 mt-2">
                      <button
                        onClick={() => onDecideLeave(employee.id, r.id, "approved")}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                      >
                        <Check className="w-3 h-3" /> Approve
                      </button>
                      <button
                        onClick={() => onDecideLeave(employee.id, r.id, "rejected")}
                        className="flex-1 flex items-center justify-center gap-1 text-[11px] font-semibold py-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100"
                      >
                        <XCircle className="w-3 h-3" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {leaveHistory.length > 0 && (
            <div>
              <p className={`text-xs font-semibold mb-2 ${theme.headingText}`}>Leave History</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {leaveHistory.map((r) => (
                  <div key={r.id} className={`flex items-center justify-between text-[11px] rounded-lg px-2.5 py-1.5 ${theme.inputBg}`}>
                    <span className={theme.cardText}>
                      {r.type} · {fmtLeaveDays(r.days)} · {fmtDate(r.startDate)}
                      {r.endDate !== r.startDate ? ` – ${fmtDate(r.endDate)}` : ""}
                    </span>
                    <span className={`font-semibold ${r.status === "approved" ? "text-emerald-600" : "text-rose-500"}`}>
                      {r.status === "approved" ? "Approved" : "Rejected"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canSeeSalary && (
            <div className={`rounded-xl border p-3 ${theme.borderLight}`}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0"><DollarSign className="w-4 h-4" /></span>
                <div>
                  <p className={`text-[11px] ${theme.subtleText}`}>{isPerProject(employee) ? "Per-Project Earnings" : "Monthly Salary"}</p>
                  <p className={`font-bold ${theme.headingText}`}>
                    {isPerProject(employee) ? fmtMoney(employee.commissionTotal) : employee.salary != null ? fmtMoney(employee.salary) : "Not set"}
                  </p>
                </div>
              </div>
              {isPerProject(employee) && (
                <div className="space-y-1.5">
                  {commissionRows.length === 0 ? (
                    <p className={`text-xs ${theme.subtleText}`}>No project or task commission added yet.</p>
                  ) : (
                    commissionRows.map((r) => (
                      <div key={r.id} className={`flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 ${theme.inputBg}`}>
                        <span className={`min-w-0 truncate ${theme.cardText}`}>
                          <span className="font-semibold">{r.label || (r.kind === "task" ? "Task" : "Project")}</span>
                          <span className={theme.subtleText}> · {r.kind === "task" ? "Task" : "Project"}{r.status ? ` · ${r.status}` : ""}</span>
                        </span>
                        <span className={`font-semibold shrink-0 ${theme.cardText}`}>{fmtMoney(r.amount)}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
              {!isPerProject(employee) && typeof onSetSalary === "function" && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={salaryInput}
                    onChange={(e) => setSalaryInput(e.target.value)}
                    placeholder="New monthly salary"
                    className={`flex-1 text-sm border rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
                  />
                  <button
                    onClick={() => onSetSalary(salaryInput)}
                    disabled={salaryInput === "" || Number(salaryInput) < 0}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 text-white hover:opacity-90 transition"
                  >
                    {employee.salary != null ? "Update" : "Set"}
                  </button>
                </div>
              )}
            </div>
          )}

          <div>
            <p className={`text-xs font-semibold mb-2 ${theme.headingText}`}>Status</p>
            <div className="flex flex-wrap gap-2">
              {canSetStatus &&
                ["Active", "On Leave"].filter((s) => s !== employee.status).map((s) => (
                  <button
                    key={s}
                    onClick={() => onSetStatus(s)}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-full border hover:${theme.hoverIconBg} ${theme.border} ${theme.cardText}`}
                  >
                    Mark as {s}
                  </button>
                ))}
              <StatusBadge status={employee.status} />
            </div>
          </div>
        </div>

        <div className={`flex gap-2 p-5 sm:p-6 border-t ${theme.borderLight}`}>
          {canDeleteEmp && (
            <button onClick={onRemove} className="flex-1 flex items-center justify-center gap-1.5 border border-rose-200 text-rose-600 text-sm font-semibold py-2.5 rounded-full hover:bg-rose-50 transition">
              <UserX className="w-4 h-4" /> Remove Employee
            </button>
          )}
          {canEditEmp && (
            <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 border border-violet-200 text-violet-600 text-sm font-semibold py-2.5 rounded-full hover:bg-violet-50 transition">
              <Pencil className="w-4 h-4" /> Edit
            </button>
          )}
          <button onClick={onClose} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   REQUEST LEAVE MODAL
   Lets an employee ask for a Half Day off, or a Full Day / multi-day
   range (2-3 days, a week, etc.) with a short message explaining why.
   Submits as "pending" — it only starts counting toward the employee's
   monthly leave total (and salary cut) once an approver approves it.
====================================================================== */

function RequestLeaveModal({ employee, onClose, onSubmit, theme }) {
  const [form, setForm] = useState({
    type: "Half Day",
    startDate: todayISO(),
    endDate: todayISO(),
    reason: "",
  });

  const isHalfDay = form.type === "Half Day";
  const days = computeLeaveDays(form.type, form.startDate, form.endDate);
  const datesValid = isHalfDay || !form.endDate || form.endDate >= form.startDate;
  const canSubmit = form.startDate && (isHalfDay || form.endDate) && datesValid && form.reason.trim().length > 0;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[93] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Request Leave</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-xs mb-4 ${theme.mutedText}`}>
          For {employee.name} — this goes to an approver, then counts toward this month's leave total once approved.
        </p>

        <div className="space-y-3">
          <div>
            <label className={labelCls}>Leave type</label>
            <div className="grid grid-cols-2 gap-2">
              {["Half Day", "Full Day"].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t, endDate: t === "Half Day" ? f.startDate : f.endDate }))}
                  className={`text-sm font-semibold py-2.5 rounded-lg border transition ${
                    form.type === t ? "bg-violet-600 border-violet-600 text-white" : `${theme.border} ${theme.cardText}`
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className={`text-[11px] mt-1 ${theme.subtleText}`}>
              Use "Full Day" for a single day too — just set start and end to the same date. For 2-3 days (or more), pick the date range.
            </p>
          </div>

          <div className={`grid ${isHalfDay ? "grid-cols-1" : "grid-cols-2"} gap-3`}>
            <div>
              <label className={labelCls}>{isHalfDay ? "Date" : "Start date"}</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value, endDate: isHalfDay ? e.target.value : f.endDate }))}
                className={inputCls}
              />
            </div>
            {!isHalfDay && (
              <div>
                <label className={labelCls}>End date</label>
                <input
                  type="date"
                  value={form.endDate}
                  min={form.startDate}
                  onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  className={inputCls}
                />
              </div>
            )}
          </div>
          {!isHalfDay && (
            <div className="flex flex-wrap gap-1.5">
              <span className={`text-[11px] mr-0.5 self-center ${theme.subtleText}`}>Quick pick:</span>
              {[
                { label: "1 Day", days: 1 },
                { label: "2-3 Days", days: 3 },
                { label: "1 Week", days: 7 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    const start = form.startDate || todayISO();
                    const end = new Date(start);
                    end.setDate(end.getDate() + p.days - 1);
                    setForm((f) => ({ ...f, startDate: start, endDate: end.toISOString().slice(0, 10) }));
                  }}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border hover:${theme.hoverIconBg} ${theme.border} ${theme.mutedText}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {!datesValid && <p className="text-[11px] text-rose-500">End date can't be before the start date.</p>}

          <div>
            <label className={labelCls}>Message / reason</label>
            <textarea
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Let your approver know why you need this leave…"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div className={`flex items-center justify-between text-xs rounded-lg px-3 py-2.5 ${theme.inputBg}`}>
            <span className={theme.mutedText}>This request counts as</span>
            <span className={`font-bold ${theme.headingText}`}>{fmtLeaveDays(days)}</span>
          </div>
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>Cancel</button>
          <button
            disabled={!canSubmit}
            onClick={() => onSubmit(employee.id, form)}
            className="flex-1 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            <Send className="w-3.5 h-3.5" /> Send Request
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   ADD EMPLOYEE MODAL
====================================================================== */

function AddEmployeeModal({ onClose, onSubmit, theme, isEmailTaken, error }) {
  const [form, setForm] = useState({ name: "", department: "", role: "", email: "" });
  const [emailTouched, setEmailTouched] = useState(false);
  const roleOptions = form.department ? ROLE_BY_DEPT[form.department] || [] : [];
  const emailOk = isValidEmail(form.email);
  const emailDuplicate = emailOk && typeof isEmailTaken === "function" && isEmailTaken(form.email);
  const canSubmit = form.name.trim() && form.department && form.role && emailOk && !emailDuplicate;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[90] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Invite Employee</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className={`text-xs mb-4 -mt-2 ${theme.mutedText}`}>
          This sends an invite to Users &amp; Roles for approval — they'll show up here as an employee once approved, not before.
        </p>
        {error && (
          <p className="text-xs text-rose-500 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3">{error}</p>
        )}
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kamran Sheikh" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email address</label>
            <div className="relative">
              <Mail className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@company.com"
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.inputBg} ${theme.cardText} ${
                  emailTouched && form.email && (!emailOk || emailDuplicate) ? "border-rose-400" : theme.border
                }`}
              />
            </div>
            {emailTouched && form.email && !emailOk && (
              <p className="text-[11px] text-rose-500 mt-1">Enter a valid email address.</p>
            )}
            {emailTouched && form.email && emailOk && emailDuplicate && (
              <p className="text-[11px] text-rose-500 mt-1">This email is already in use by another account.</p>
            )}
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value, role: "" })} className={inputCls}>
              <option value="">Select department</option>
              {DEPARTMENTS.map((d) => <option key={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              disabled={!form.department}
              className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <option value="">{form.department ? "Select role" : "Select a department first"}</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>Cancel</button>
          <button disabled={!canSubmit} onClick={() => onSubmit(form)} className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition">
            Send Invite
          </button>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   EDIT EMPLOYEE MODAL
   Reuses the same layout/validation pattern as AddEmployeeModal, just
   pre-filled with the employee's current data and calling
   onSubmit(employeeId, formData) instead of creating a brand-new row.
====================================================================== */

function EditEmployeeModal({ employee, onClose, onSubmit, theme, isEmailTaken }) {
  const [form, setForm] = useState({
    name: employee.name || "",
    email: employee.email || "",
    phone: employee.phone && employee.phone !== "—" ? employee.phone : "",
    location: employee.location || "",
    department: employee.department || "",
    role: employee.role || "",
  });
  const [emailTouched, setEmailTouched] = useState(false);
  const roleOptions = form.department ? ROLE_BY_DEPT[form.department] || [] : [];
  const emailOk = isValidEmail(form.email);
  const emailDuplicate = emailOk && typeof isEmailTaken === "function" && isEmailTaken(form.email);
  const canSubmit = form.name.trim() && form.department && form.role.trim() && emailOk && !emailDuplicate;

  const inputCls = `w-full text-sm border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`;
  const labelCls = `text-xs font-semibold mb-1 block ${theme.mutedText}`;

  return (
    <div className="fixed inset-0 z-[92] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[90vh] overflow-y-auto ${theme.card}`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-lg font-bold ${theme.headingText}`}>Edit Employee</h3>
          <button onClick={onClose} className={`w-8 h-8 flex items-center justify-center rounded-lg hover:${theme.hoverIconBg} ${theme.mutedText}`}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Full name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kamran Sheikh" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Email address</label>
            <div className="relative">
              <Mail className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                onBlur={() => setEmailTouched(true)}
                placeholder="name@company.com"
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.inputBg} ${theme.cardText} ${
                  emailTouched && form.email && (!emailOk || emailDuplicate) ? "border-rose-400" : theme.border
                }`}
              />
            </div>
            {emailTouched && form.email && !emailOk && (
              <p className="text-[11px] text-rose-500 mt-1">Enter a valid email address.</p>
            )}
            {emailTouched && form.email && emailOk && emailDuplicate && (
              <p className="text-[11px] text-rose-500 mt-1">This email is already in use by another account.</p>
            )}
            {employee.authId && form.email.trim().toLowerCase() !== (employee.email || "").trim().toLowerCase() && (
              <p className={`text-[11px] mt-1 ${theme.subtleText}`}>
                Changing this may log the employee out if they're currently signed in.
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Phone</label>
            <div className="relative">
              <Phone className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+92 3xx xxxxxxx"
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Location</label>
            <div className="relative">
              <MapPin className={`w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 ${theme.subtleText}`} />
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="City, Country"
                className={`w-full text-sm border rounded-lg pl-9 pr-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-300 ${theme.border} ${theme.inputBg} ${theme.cardText}`}
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <select
              value={form.department}
              onChange={(e) => setForm({ ...form, department: e.target.value, role: "" })}
              className={inputCls}
            >
              <option value="">Select department</option>
              {DEPARTMENTS.map((d) => <option key={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              disabled={!form.department}
              className={`${inputCls} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <option value="">{form.department ? "Select role" : "Select a department first"}</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              {/* Keeps whatever the employee's current role text is selectable
                  even if it's not one of this department's predefined
                  titles (e.g. a generic "Employee"/"Manager" label synced
                  in from Users & Roles) — so opening Edit never silently
                  blanks out their existing role. */}
              {form.role && !roleOptions.includes(form.role) && (
                <option value={form.role}>{form.role}</option>
              )}
            </select>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className={`flex-1 border text-sm font-semibold py-2.5 rounded-full ${theme.border} ${theme.cardText}`}>Cancel</button>
          <button
            disabled={!canSubmit}
            onClick={() => onSubmit(employee.id, form)}
            className="flex-1 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}