import React, { useMemo, useState, useEffect, useRef } from "react";
import { useAuth } from "../AuthContext.jsx";
import {
  DollarSign,
  Briefcase,
  CheckCircle2,
  Users,
  FolderKanban,
  Building2,
  BarChart2,
  ClipboardList,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Calendar,
  Download,
  MoreHorizontal,
  FilePlus2,
  CalendarClock,
  FolderCog,
  Settings,
  Eye,
  MoreVertical,
  FileText,
  ArrowUpRight,
  ArrowUp,
  X,
  Search,
  Pencil,
  Copy,
  Trash2,
  Check,
  UploadCloud,
  Video,
  Image as ImageIcon,
  PlayCircle,
  MessageSquare,
  Send,
  Paperclip,
  FileArchive,
} from "lucide-react";
import { sendReportMessage } from "./MessagesPage.jsx";
import * as reportsApi from "./reportsApi.js";
import ActivitySection from "./ReportsActivity.jsx";
import AssetsSection from "./AssetsSection.jsx";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Report category definitions — labels/desc/icon are fixed UI copy,   */
/*  but the actual COUNT is always computed live from real generated   */
/*  reports further down (see `reportsForCategory`). There is no       */
/*  hardcoded fallback number here anymore — if a category legitimately */
/*  has 0 reports, it now shows 0 instead of a stale fake number.       */
/* ------------------------------------------------------------------ */

const REPORT_CATEGORIES = [
  { label: "Financial Reports", key: "Financial", desc: "Budget, spend and profit summaries across all projects.", icon: DollarSign, tint: "violet" },
  { label: "Project Reports", key: "Project", desc: "Project progress, budget, time tracking and status.", icon: FolderKanban, tint: "emerald" },
  { label: "Employee Reports", key: "Employee", desc: "Performance, attendance, workload and activity.", icon: Users, tint: "sky" },
  { label: "Client Reports", key: "Client", desc: "Client details, projects, revenue and activity.", icon: Building2, tint: "amber" },
  { label: "Sales Reports", key: "Sales", desc: "Revenue by client and by project, at a glance.", icon: BarChart2, tint: "rose" },
  { label: "Task Reports", key: "Task", desc: "Task status, completion, overdue and productivity.", icon: ClipboardList, tint: "indigo" },
];

const TINT_STYLES = {
  violet: { bg: "bg-violet-50", text: "text-violet-600", link: "text-violet-600", ring: "ring-violet-200" },
  emerald: { bg: "bg-emerald-50", text: "text-emerald-600", link: "text-emerald-600", ring: "ring-emerald-200" },
  sky: { bg: "bg-sky-50", text: "text-sky-600", link: "text-sky-600", ring: "ring-sky-200" },
  amber: { bg: "bg-amber-50", text: "text-amber-600", link: "text-amber-600", ring: "ring-amber-200" },
  rose: { bg: "bg-rose-50", text: "text-rose-600", link: "text-rose-600", ring: "ring-rose-200" },
  indigo: { bg: "bg-indigo-50", text: "text-indigo-600", link: "text-indigo-600", ring: "ring-indigo-200" },
};

// Label shown in the dropdown -> preset understood by the backend
// (?range=...). "All Time" has no start date at all.
const RANGE_PRESETS = {
  Today: "today",
  "This Week": "week",
  "This Month": "month",
  "This Quarter": "quarter",
  "This Year": "year",
  "Last 30 Days": "last30",
  "All Time": "all",
};
const DATE_RANGE_OPTIONS = Object.keys(RANGE_PRESETS);

const QUICK_ACTIONS = [
  { key: "uploadDaily", label: "Upload Daily Report", icon: UploadCloud },
  { key: "generate", label: "Generate Custom Report", icon: FilePlus2 },
  { key: "schedule", label: "Schedule Report", icon: CalendarClock },
  { key: "templates", label: "Manage Report Templates", icon: FolderCog },
  { key: "settings", label: "Report Settings", icon: Settings },
];

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

// Company currency comes from the backend summary (Settings -> General).
let currencySymbol = "$";
function setCurrencySymbol(sym) {
  if (sym) currencySymbol = sym;
}
function fmtCurrency(n) {
  return `${currencySymbol}${currencySymbol.length > 1 ? " " : ""}${Math.round(n || 0).toLocaleString()}`;
}

const EMPTY_STATS = {
  totalEmployees: 0, totalProjects: 0, activeProjects: 0, completedProjects: 0,
  totalTasks: 0, completedTasks: 0, overdueTasks: 0,
  totalBudget: 0, totalSpent: 0, netRemaining: 0, activeClients: 0,
};

// Backend row -> the shape the "All Reports" table already renders.
function toReportRow(r) {
  return {
    ...r,
    date: fmtDateTime(r.dateRaw),
    avatar: r.avatar || avatarUrlFor((r.name || "").split(" — ")[0]),
    manualEdit: !!r.manualEdit,
  };
}

/* Generates a real (not fake-random) avatar image for a person, based on
   their actual name's initials — used for employees/reports where we
   don't have an uploaded profile photo. */
function avatarUrlFor(name) {
  const safe = (name || "?").trim() || "?";
  return `https://ui-avatars.com/api/?background=random&bold=true&name=${encodeURIComponent(safe)}`;
}

const CATEGORY_CHIP = {
  Financial: "bg-violet-50 text-violet-600",
  Project: "bg-emerald-50 text-emerald-600",
  Employee: "bg-sky-50 text-sky-600",
  Client: "bg-amber-50 text-amber-600",
  Sales: "bg-rose-50 text-rose-600",
  Task: "bg-indigo-50 text-indigo-600",
};

const FORMAT_STYLES = {
  PDF: "bg-rose-50 text-rose-600",
  Excel: "bg-emerald-50 text-emerald-600",
};

const PAGE_SIZE = 8;

/* ------------------------------------------------------------------ */
/*  DAILY REPORTS — every employee logs what they worked on today,      */
/*  optionally with photo/video proof. Admins can browse every          */
/*  employee's submissions and open each media file separately.        */
/*                                                                      */
/*  Everything is stored by the Django backend now: the note/date/who   */
/*  in the database, the photos/videos on disk. Files are served        */
/*  through an authenticated endpoint, so only the owner and people     */
/*  with Full Reports Access can open them.                             */
/* ------------------------------------------------------------------ */

// Copied EXACTLY from ProjectsPage.jsx's own PROJECT_FOCUS_LS_KEY constant —
// ProjectsPage writes the project name here right before it navigates over
// via "View Daily Reports", so both pages agree on where that hand-off lives.
const PROJECT_FOCUS_LS_KEY = "reportspage_project_focus_v1";

function todayStr() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function fileKind(mimeType, name = "") {
  const lower = String(name || "").toLowerCase();
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    lower.endsWith(".zip") ||
    mimeType === "application/zip" ||
    mimeType === "application/x-zip-compressed"
  ) return "zip";
  return "file";
}

// Small icon for one attached file (photo / video / PDF / ZIP).
function DailyFileIcon({ kind, size = 13, className = "" }) {
  if (kind === "video") return <Video size={size} className={className} />;
  if (kind === "pdf") return <FileText size={size} className={className} />;
  if (kind === "zip") return <FileArchive size={size} className={className} />;
  return <ImageIcon size={size} className={className} />;
}

function fmtBytes(n) {
  if (!n) return "0 KB";
  const kb = n / 1024;
  return kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/*  Small reusable bits                                                */
/* ------------------------------------------------------------------ */

function Toast({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-4 right-4 left-4 sm:left-auto z-[100] flex flex-col gap-2 items-stretch sm:items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2 bg-slate-900 text-white text-[12px] font-medium px-3.5 py-2.5 rounded-lg shadow-xl animate-[fadeIn_.15s_ease-out] max-w-full sm:max-w-xs"
        >
          <span className="w-4 h-4 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
            <Check size={10} />
          </span>
          <span className="truncate">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children, wide, darkMode }) {
  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const border = darkMode ? "border-slate-800" : "border-slate-100";

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`relative w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} max-h-[88vh] sm:max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl ${card}`}
      >
        <div className={`flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b sticky top-0 z-10 ${card} ${border}`}>
          <div className="min-w-0">
            <h3 className={`font-semibold text-sm ${cardText}`}>{title}</h3>
            {subtitle && <p className={`text-[11px] mt-0.5 ${mutedText}`}>{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"}`}
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-4 sm:px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function openPdfWindow(title, bodyHtml) {
  const printWindow = window.open("", "_blank", "width=900,height=1000");
  if (!printWindow) return false;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title)}</title>
        <style>
          * { box-sizing: border-box; }
          body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; padding: 32px; }
          h1 { font-size: 20px; margin: 0 0 4px; }
          .meta { font-size: 11px; color: #64748b; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }
          th { background: #f8fafc; font-weight: 700; width: 32%; }
          .section-title { font-size: 13px; font-weight: 700; margin: 22px 0 8px; }
          .empty-note { font-size: 11.5px; color: #94a3b8; margin: 0 0 8px; }
          @media print {
            body { padding: 12px; }
          }
        </style>
      </head>
      <body>
        ${bodyHtml}
      </body>
    </html>
  `);
  printWindow.document.close();

  printWindow.onload = () => {
    printWindow.focus();
    printWindow.print();
  };
  printWindow.onafterprint = () => printWindow.close();

  return true;
}

function downloadReport(report) {
  const generatedOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const rows = [
    ["Report Name", report.name],
    ["Category", report.category],
    ["Description", report.desc],
    ["Generated On", report.date],
    ["Generated By", report.by],
    ["Format", report.format],
  ];
  const rowsHtml = rows.map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`).join("");

  const bodyHtml = `
    <h1>${escapeHtml(report.name)}</h1>
    <div class="meta">Exported on ${escapeHtml(generatedOn)}</div>
    <table>${rowsHtml}</table>
  `;

  if (!openPdfWindow(report.name, bodyHtml)) {
    alert("Please allow pop-ups to export as PDF");
  }
}

function exportSummaryCsv(dateRange, keySummary, reportsByCategory, dailyReportRows, isAdmin) {
  const generatedOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const summaryRowsHtml = keySummary
    .map(
      (k) => `
        <tr>
          <td>${escapeHtml(k.label)}</td>
          <td>${escapeHtml(k.value)}</td>
          <td>${escapeHtml(k.delta || "—")}</td>
          <td>${escapeHtml(k.note || "")}</td>
        </tr>`
    )
    .join("");

  const categorySectionsHtml = reportsByCategory
    .map(({ label, rows }) => {
      if (!rows.length) {
        return `
          <div class="section-title">${escapeHtml(label)}</div>
          <p class="empty-note">No ${escapeHtml(label.toLowerCase())} yet.</p>
        `;
      }
      const rowsHtml = rows
        .map(
          (r) => `
            <tr>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.desc)}</td>
              <td>${escapeHtml(r.date)}</td>
              <td>${escapeHtml(r.by)}</td>
              <td>${escapeHtml(r.format)}</td>
            </tr>`
        )
        .join("");
      return `
        <div class="section-title">${escapeHtml(label)} (${rows.length})</div>
        <table>
          <thead>
            <tr><th style="width:auto;">Name</th><th style="width:auto;">Description</th><th style="width:auto;">Generated On</th><th style="width:auto;">Generated By</th><th style="width:auto;">Format</th></tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      `;
    })
    .join("");

  const dailyRowsHtml = dailyReportRows
    .map(
      (d) => `
        <tr>
          ${isAdmin ? `<td>${escapeHtml(d.userName)}</td>` : ""}
          <td>${escapeHtml(d.date)}</td>
          <td>${escapeHtml(d.note || "—")}</td>
          <td>${d.files?.length || 0} file${(d.files?.length || 0) === 1 ? "" : "s"}</td>
        </tr>`
    )
    .join("");

  const dailySectionHtml = dailyReportRows.length
    ? `
      <div class="section-title">Daily Reports (${dailyReportRows.length})</div>
      <table>
        <thead>
          <tr>
            ${isAdmin ? '<th style="width:auto;">Employee</th>' : ""}
            <th style="width:auto;">Date</th>
            <th style="width:auto;">Note</th>
            <th style="width:auto;">Attachments</th>
          </tr>
        </thead>
        <tbody>${dailyRowsHtml}</tbody>
      </table>
    `
    : `
      <div class="section-title">Daily Reports</div>
      <p class="empty-note">No daily reports yet.</p>
    `;

  const bodyHtml = `
    <h1>Reports Summary</h1>
    <div class="meta">${escapeHtml(dateRange)} &middot; Exported on ${escapeHtml(generatedOn)}</div>
    <div class="section-title">Overview</div>
    <table>
      <thead>
        <tr><th style="width:auto;">Metric</th><th style="width:auto;">Value</th><th style="width:auto;">Change</th><th style="width:auto;">Comparison</th></tr>
      </thead>
      <tbody>
        ${summaryRowsHtml}
      </tbody>
    </table>
    ${categorySectionsHtml}
    ${dailySectionHtml}
  `;

  if (!openPdfWindow(`Reports Summary — ${dateRange}`, bodyHtml)) {
    alert("Please allow pop-ups to export as PDF");
  }
}

/* ------------------------------------------------------------------ */

export default function ReportsPage({
  darkMode = false,
  onNavigate = () => {},
  // Shared conversations state, owned by Dashboard.jsx and passed down to
  // MessagesPage.jsx the same way — pass the identical props here too so a
  // message sent from a daily-report row lands straight in that employee's
  // Messages thread. If this page is ever mounted without them (e.g. in
  // isolation), the "Message" action safely no-ops instead of crashing.
  conversations = [],
  setConversations = () => {},
}) {
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [selectedDateRange, setSelectedDateRange] = useState("This Month");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [rowMenuOpen, setRowMenuOpen] = useState(null);
  const [reports, setReports] = useState([]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [categoryModal, setCategoryModal] = useState(null); // category object
  const [previewReport, setPreviewReport] = useState(null); // report object
  const [renameTarget, setRenameTarget] = useState(null); // report object
  const [renameValue, setRenameValue] = useState("");
  const [quickActionModal, setQuickActionModal] = useState(null); // key
  const [toasts, setToasts] = useState([]);
  const toastTimers = useRef({});

  // ---- Daily Reports (per-employee work log with photo/video uploads) ----
  const [dailyReports, setDailyReports] = useState([]);
  const [dailyModalOpen, setDailyModalOpen] = useState(false);
  const [dailyDate, setDailyDate] = useState(() => todayStr());
  const [dailyNote, setDailyNote] = useState("");
  const [dailyPendingFiles, setDailyPendingFiles] = useState([]); // [{id, file, previewUrl, kind, name, type, size}]
  const [dailyDragActive, setDailyDragActive] = useState(false);
  const [dailySubmitting, setDailySubmitting] = useState(false);
  const [viewingMedia, setViewingMedia] = useState(null); // {id, name, kind, size, url}
  const [dailyProject, setDailyProject] = useState(""); // which project this new report is being logged against
  const [adminUserFilter, setAdminUserFilter] = useState("All");
  const [adminDateFilter, setAdminDateFilter] = useState("");
  const [adminProjectFilter, setAdminProjectFilter] = useState("All");
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  // Picked up from ProjectsPage's "View Daily Reports" hand-off (see
  // PROJECT_FOCUS_LS_KEY above) — pre-filters the Daily Reports section to
  // whichever project the admin/employee jumped over from. Read once on
  // mount, then the key is cleared immediately so it doesn't stick around
  // and re-apply on some unrelated future visit.
  const [dailyProjectFocus, setDailyProjectFocus] = useState(() => {
    try {
      const v = window.localStorage.getItem(PROJECT_FOCUS_LS_KEY);
      if (v) window.localStorage.removeItem(PROJECT_FOCUS_LS_KEY);
      return v || "";
    } catch {
      return "";
    }
  });

  // ---- Admin-only: message an employee about one of their daily reports ----
  const [messageTarget, setMessageTarget] = useState(null); // daily report entry
  const [messageDraft, setMessageDraft] = useState("");
  const [messageScreenshots, setMessageScreenshots] = useState([]); // [{id, name, url (preview only), file (raw Blob, sent to IndexedDB), isImage, size, note}]
  const [messageSending, setMessageSending] = useState(false);
  const messageFileInputRef = useRef(null);

  // On mobile, the date-range / upload-daily-report dropdowns are re-anchored
  // to a fixed, horizontally-centered position (instead of being pinned to
  // the trigger button's own edge) so a wide panel can never poke off the
  // side of a narrow screen. Holds {top} when centered-mobile mode is active
  // for that menu, or null to use the normal desktop anchor (absolute,
  // right-aligned under the button — unchanged).
  const [dateMenuPos, setDateMenuPos] = useState(null);
  const [uploadMenuPos, setUploadMenuPos] = useState(null);

  // Scroll target for the "Key Summary" cards — the All Reports table below,
  // i.e. where that summary data actually lives.
  const allReportsRef = useRef(null);
  const scrollToAllReports = () => {
    allReportsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const headingText = darkMode ? "text-white" : "text-slate-900";
  const rowHover = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";
  const border = darkMode ? "border-slate-800" : "border-slate-100";
  const inputCls = darkMode
    ? "bg-slate-800 border-slate-700 text-slate-200 placeholder:text-slate-500"
    : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400";

  function pushToast(message) {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message }]);
    toastTimers.current[id] = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      delete toastTimers.current[id];
    }, 2800);
  }

  useEffect(() => {
    return () => {
      Object.values(toastTimers.current).forEach(clearTimeout);
    };
  }, []);

  // Applies a project hand-off from ProjectsPage's "View Daily Reports"
  // action: opens the Daily Reports section, pre-filters it, and scrolls
  // it into view. Runs once for whatever was already picked up on mount,
  // and again any time ProjectsPage signals a fresh hand-off while this
  // page happens to already be mounted.
  useEffect(() => {
    const applyFocus = (projectName) => {
      if (!projectName) return;
      setDailyProjectFocus(projectName);
      setAdminProjectFilter(projectName);
      setDailyProject((prev) => prev || projectName);
      setDailyModalOpen(true);
      setTimeout(() => document.getElementById("daily-reports-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    };
    if (dailyProjectFocus) applyFocus(dailyProjectFocus);
    const onHandOff = () => {
      try {
        const v = window.localStorage.getItem(PROJECT_FOCUS_LS_KEY);
        if (v) {
          window.localStorage.removeItem(PROJECT_FOCUS_LS_KEY);
          applyFocus(v);
        }
      } catch {
        // storage unavailable — nothing to pick up
      }
    };
    window.addEventListener("reports-project-focus-changed", onHandOff);
    return () => window.removeEventListener("reports-project-focus-changed", onHandOff);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------- */
  /*  REAL DATA — pulled from AuthContext (employees) + localStorage    */
  /*  (projects), same pattern EmployeesPage.jsx already uses for       */
  /*  syncing with real, admin-approved accounts.                      */
  /* ---------------------------------------------------------------- */

  const { user: authUser, hasFullSubPageAccess } = useAuth();

  // Who's looking at the page right now — drives whether they see the
  // "submit today's work" form or the admin-wide review view below.
  // Routed through hasFullSubPageAccess("Reports") (AuthContext) instead
  // of a raw `role === "admin"` check, so someone an admin has explicitly
  // granted page-access "Full Access" (described there as "same as
  // Admin"), OR just the more targeted "Full Reports Access" toggle for
  // this one page, actually gets the admin-wide Reports view too — not
  // just a spot in the sidebar.
  const currentUser = authUser || {};
  const isAdmin = hasFullSubPageAccess("Reports");
  const currentUserId = currentUser?.id || currentUser?.email || "me";

  /* ---------------------------------------------------------------- */
  /*  Everything below comes from the Django backend (reports app):     */
  /*  summary + charts + "All Reports" rows for admins, daily reports   */
  /*  for everyone (own only, unless Full Reports Access).              */
  /* ---------------------------------------------------------------- */

  const rangePreset = RANGE_PRESETS[selectedDateRange] || "month";
  const rangeParams = useMemo(() => ({ range: rangePreset, tz: reportsApi.browserTz }), [rangePreset]);

  const [summary, setSummary] = useState(null);
  const [projects, setProjects] = useState([]); // [{id, name}] — options for the Project dropdown
  const [refreshTick, setRefreshTick] = useState(0);

  function reloadDaily() {
    reportsApi
      .listAllDaily()
      .then((res) => setDailyReports(res.results))
      .catch((err) => pushToast(err.message || "Could not load daily reports"));
  }

  // Daily reports + project names — for everyone.
  useEffect(() => {
    reloadDaily();
    reportsApi.listProjectNames().then(setProjects).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Something outside this page (e.g. ProjectsPage) changed daily reports.
  useEffect(() => {
    const bump = () => setRefreshTick((n) => n + 1);
    window.addEventListener("daily-reports-changed", bump);
    return () => window.removeEventListener("daily-reports-changed", bump);
  }, []);

  // Summary cards + charts + report rows — full-access users only (the
  // backend returns 403 to anyone else).
  useEffect(() => {
    if (!isAdmin) return undefined;
    let cancelled = false;
    Promise.all([reportsApi.getSummary(rangeParams), reportsApi.getCatalog(rangeParams)])
      .then(([sum, cat]) => {
        if (cancelled) return;
        setCurrencySymbol(sum.currency); // before setSummary so the very next render already uses it
        setSummary(sum);
        setReports(cat.results.map(toReportRow));
      })
      .catch((err) => !cancelled && pushToast(err.message || "Could not load reports"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, rangeParams, refreshTick]);

  // One "opened the Reports page" entry in the activity log (the backend
  // drops repeats within 20s, so React StrictMode's double-run is harmless).
  useEffect(() => {
    reportsApi.trackActivity({ module: "Reports", action: "view", description: "Opened Reports page", page: "/reports" });
  }, []);

  const stats = useMemo(() => ({ ...EMPTY_STATS, ...(summary?.stats || {}) }), [summary]);

  function exportReport() {
    setExporting(true);
    setTimeout(() => {
      setExporting(false);
      const reportsByCategory = REPORT_CATEGORIES.map((c) => ({ label: c.label, rows: reportsForCategory(c.key) }));
      const dailyReportRows = isAdmin ? filteredAdminDailyReports : myDailyReports;
      exportSummaryCsv(selectedDateRange, keySummary, reportsByCategory, dailyReportRows, isAdmin);
      pushToast(`Exported summary for ${selectedDateRange}`);
    }, 650);
  }

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      const matchesQuery =
        !query.trim() ||
        r.name.toLowerCase().includes(query.trim().toLowerCase()) ||
        r.by.toLowerCase().includes(query.trim().toLowerCase());
      const matchesCategory = categoryFilter === "All" || r.category === categoryFilter;
      return matchesQuery && matchesCategory;
    });
  }, [reports, query, categoryFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageReports = filteredReports.slice(startIdx, startIdx + PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [query, categoryFilter]);

  async function handleDeleteReport(report) {
    setRowMenuOpen(null);
    try {
      // Auto-generated rows are live data, so "delete" hides them (saved on
      // the server, so they stay hidden after a refresh); manually added or
      // duplicated rows are removed for good.
      await reportsApi.deleteCatalogItem(report.id);
      setReports((rs) => rs.filter((r) => r.id !== report.id));
      pushToast(`Deleted "${report.name}"`);
    } catch (err) {
      pushToast(err.message || "Could not delete report");
    }
  }

  async function handleDuplicateReport(report) {
    setRowMenuOpen(null);
    try {
      const created = await reportsApi.createCatalogItem({
        name: `${report.name} (Copy)`,
        category: report.category,
        desc: report.desc,
        format: report.format,
        sourceKey: String(report.id),
      });
      const copy = toReportRow(created);
      setReports((rs) => {
        const idx = rs.findIndex((r) => r.id === report.id);
        const next = [...rs];
        next.splice(idx + 1, 0, copy);
        return next;
      });
      pushToast(`Duplicated "${report.name}"`);
    } catch (err) {
      pushToast(err.message || "Could not duplicate report");
    }
  }

  function openRename(report) {
    setRenameTarget(report);
    setRenameValue(report.name);
    setRowMenuOpen(null);
  }

  async function submitRename(e) {
    e.preventDefault();
    const name = renameValue.trim();
    if (!name) return;
    try {
      await reportsApi.renameCatalogItem(renameTarget.id, name);
      setReports((rs) => rs.map((r) => (r.id === renameTarget.id ? { ...r, name, manualEdit: true } : r)));
      pushToast(`Renamed to "${name}"`);
      setRenameTarget(null);
    } catch (err) {
      pushToast(err.message || "Could not rename report");
    }
  }

  function reportsForCategory(catKey) {
    return reports.filter((r) => r.category === catKey);
  }

  /* ---------------------------------------------------------------- */
  /*  Daily Reports handlers                                            */
  /* ---------------------------------------------------------------- */

  function handleAddDailyFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => ["image", "video", "pdf", "zip"].includes(fileKind(f.type, f.name)));
    if (!files.length) {
      pushToast("Only photos, videos, PDF and ZIP files can be attached");
      return;
    }
    const next = files.map((file) => ({
      id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      kind: fileKind(file.type, file.name),
      name: file.name,
      type: file.type,
      size: file.size,
    }));
    setDailyPendingFiles((prev) => [...prev, ...next]);
  }

  function handleDailyDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    setDailyDragActive(true);
  }

  function handleDailyDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    setDailyDragActive(false);
  }

  function handleDailyDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDailyDragActive(false);
    handleAddDailyFiles(e.dataTransfer?.files);
  }

  function removeDailyPendingFile(id) {
    setDailyPendingFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  }

  function resetDailyForm() {
    dailyPendingFiles.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setDailyPendingFiles([]);
    setDailyNote("");
    setDailyDate(todayStr());
    // Keep the project pre-selected if the user arrived here via "View
    // Daily Reports" for a specific project — convenient for logging
    // several reports against it in a row. Otherwise clear it.
    setDailyProject(dailyProjectFocus || "");
  }

  async function submitDailyReport(e) {
    e.preventDefault();
    if (!dailyNote.trim() && dailyPendingFiles.length === 0) {
      pushToast("Add a note or upload a photo, video, PDF or ZIP first");
      return false;
    }
    setDailySubmitting(true);
    try {
      const entry = await reportsApi.createDaily({
        date: dailyDate || todayStr(),
        note: dailyNote.trim(),
        project: dailyProject || "",
        files: dailyPendingFiles.map((pf) => pf.file),
      });
      setDailyReports((prev) => [entry, ...prev]);
      resetDailyForm();
      pushToast("Daily report submitted");
      return true;
    } catch (err) {
      pushToast(err.message || "Could not submit daily report");
      return false;
    } finally {
      setDailySubmitting(false);
    }
  }

  async function submitDailyReportFromMenu(e) {
    const ok = await submitDailyReport(e);
    if (ok) setUploadMenuOpen(false);
  }

  async function handleDeleteDailyReport(entry) {
    try {
      await reportsApi.deleteDaily(entry.id);
      setDailyReports((prev) => prev.filter((r) => r.id !== entry.id));
      pushToast("Daily report removed");
    } catch (err) {
      pushToast(err.message || "Could not remove report");
    }
  }

  // Bulk-delete every daily report tagged with one project — the same
  // cleanup ProjectsPage does automatically when the project itself is
  // deleted, offered here too so an admin/employee can clear a project's
  // reports without deleting the project.
  async function deleteAllDailyReportsForProject(projectName, scopedList) {
    if (!projectName) return;
    const targets = (scopedList || dailyReports).filter((r) => r.project === projectName);
    if (targets.length === 0) return;
    try {
      const { deleted } = await reportsApi.bulkDeleteDaily(targets.map((r) => r.id));
      const targetIds = new Set(targets.map((r) => r.id));
      setDailyReports((prev) => prev.filter((r) => !targetIds.has(r.id)));
      pushToast(`Deleted ${deleted} report${deleted === 1 ? "" : "s"} for ${projectName}`);
    } catch (err) {
      pushToast(err.message || "Could not delete reports");
    }
  }

  // ---- Admin-only: approve a daily report -------------------------------
  async function handleApproveDailyReport(entry) {
    if (!isAdmin) return;
    try {
      const updated = await reportsApi.approveDaily(entry.id);
      setDailyReports((prev) => prev.map((r) => (r.id === entry.id ? updated : r)));
      pushToast(`Approved ${entry.userName}'s report for ${entry.date}`);
    } catch (err) {
      pushToast(err.message || "Could not approve report");
    }
  }

  // ---- Admin-only: message an employee about one of their daily reports -
  function openMessageModal(entry) {
    if (!isAdmin) return;
    setMessageTarget(entry);
    setMessageDraft("");
    setMessageScreenshots([]);
  }

  function closeMessageModal() {
    setMessageTarget(null);
    setMessageDraft("");
    setMessageScreenshots([]);
    setMessageSending(false);
  }

  function handleMessageScreenshotsChosen(e) {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      pushToast("Only image screenshots can be attached");
      return;
    }
    files.forEach((file) => {
      const id = `msgshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const reader = new FileReader();
      reader.onload = () => {
        // `url` here is a data: URL used ONLY for the local preview in this
        // modal (kept in React state, never written to localStorage). The
        // raw `file` (the actual File/Blob) is kept alongside it so
        // sendReportMessage can move the real bytes into IndexedDB when
        // this screenshot is actually sent — embedding the data: URL
        // itself into the saved conversation is what silently broke
        // delivery once a screenshot or two pushed localStorage over its
        // quota (see the big comment above idbPutMessageMedia in
        // MessagesPage.jsx).
        setMessageScreenshots((prev) => [
          ...prev,
          { id, name: file.name, url: reader.result, file, isImage: true, size: fmtBytes(file.size), note: "" },
        ]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }

  function updateMessageScreenshotNote(id, note) {
    setMessageScreenshots((prev) => prev.map((s) => (s.id === id ? { ...s, note } : s)));
  }

  function removeMessageScreenshot(id) {
    setMessageScreenshots((prev) => prev.filter((s) => s.id !== id));
  }

  async function sendDailyReportMessage(e) {
    e.preventDefault();
    if (!isAdmin || !messageTarget) return;
    const text = messageDraft.trim();
    if (!text && messageScreenshots.length === 0) {
      pushToast("Write a message or attach a screenshot first");
      return;
    }
    setMessageSending(true);
    // sendReportMessage is async — it moves each screenshot's real bytes
    // into IndexedDB before saving the message, so it must be awaited.
    const ok = await sendReportMessage(conversations, setConversations, {
      userId: messageTarget.userId,
      userName: messageTarget.userName,
      userAvatar: messageTarget.userAvatar,
      userEmail: messageTarget.userEmail,
      text: text ? `Re: your ${messageTarget.date} daily report — ${text}` : `Re: your ${messageTarget.date} daily report`,
      attachments: messageScreenshots,
    });
    setMessageSending(false);
    if (ok) {
      pushToast(`Message sent to ${messageTarget.userName} — check the Messages page`);
      closeMessageModal();
      // If your app's sidebar/router uses a different key for the
      // Messages page than "Dashboard" (see the button above), update
      // this call to match — it's what jumps the admin there after sending.
      onNavigate?.("Messages");
    } else {
      pushToast(`No message thread found for ${messageTarget.userName} yet`);
    }
  }

  async function openMediaViewer(fileMeta) {
    try {
      // The endpoint needs the auth header, so fetch it as a blob first.
      const blob = await reportsApi.fetchBlob(fileMeta.url);
      setViewingMedia({ ...fileMeta, url: URL.createObjectURL(blob) });
    } catch (err) {
      pushToast(err.message || "That file is no longer available");
    }
  }

  function closeMediaViewer() {
    if (viewingMedia?.url) URL.revokeObjectURL(viewingMedia.url);
    setViewingMedia(null);
  }

  // This employee's own submission history, most recent first. When they
  // arrived here via "View Daily Reports" for a specific project, it's
  // pre-filtered to that project too.
  const myDailyReports = useMemo(
    () =>
      dailyReports
        .filter((r) => String(r.userId) === String(currentUserId))
        .filter((r) => (dailyProjectFocus ? r.project === dailyProjectFocus : true))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [dailyReports, currentUserId, dailyProjectFocus]
  );

  // Distinct employees who've ever submitted a daily report — powers the
  // admin "filter by employee" dropdown.
  const dailyReportUserOptions = useMemo(() => {
    const seen = new Map();
    dailyReports.forEach((r) => seen.set(r.userId, r.userName));
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [dailyReports]);

  // Every project name worth offering in the admin "filter by project"
  // dropdown — every real project, plus any project name a report happens
  // to be tagged with (covers reports logged against a project that's
  // since been renamed or removed).
  const dailyReportProjectOptions = useMemo(() => {
    const names = new Set();
    projects.forEach((p) => p.name && names.add(p.name));
    dailyReports.forEach((r) => r.project && names.add(r.project));
    return Array.from(names);
  }, [projects, dailyReports]);

  const filteredAdminDailyReports = useMemo(
    () =>
      dailyReports
        .filter((r) => (adminUserFilter === "All" ? true : String(r.userId) === String(adminUserFilter)))
        .filter((r) => (adminDateFilter ? r.date === adminDateFilter : true))
        .filter((r) => (adminProjectFilter === "All" ? true : r.project === adminProjectFilter))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [dailyReports, adminUserFilter, adminDateFilter, adminProjectFilter]
  );

  /* ---------------------------------------------------------------- */
  /*  Display data derived entirely from `stats` / `projects` / reports  */
  /*  above — no hardcoded numbers, no fake deltas. Cards/charts that     */
  /*  don't have enough real data to compute a meaningful value degrade   */
  /*  gracefully (0, "—", or an empty-state) rather than showing         */
  /*  something made up.                                                */
  /* ---------------------------------------------------------------- */

  const keySummary = useMemo(
    () => [
      { label: "Total Employees", value: String(stats.totalEmployees), icon: Users, tint: "sky" },
      { label: "Total Projects", value: String(stats.totalProjects), icon: Briefcase, tint: "violet" },
      { label: "Active Projects", value: String(stats.activeProjects), icon: FolderKanban, tint: "emerald" },
      { label: "Tasks Completed", value: `${stats.completedTasks}/${stats.totalTasks}`, icon: CheckCircle2, tint: "emerald" },
      { label: "Active Clients", value: String(stats.activeClients), icon: Building2, tint: "amber" },
      { label: "Budget Utilized", value: stats.totalBudget > 0 ? fmtCurrency(stats.totalSpent) : "$0", note: stats.totalBudget > 0 ? `of ${fmtCurrency(stats.totalBudget)} budget` : "No budget data yet", icon: DollarSign, tint: "rose" },
    ],
    [stats]
  );

  // Budget vs Spent per project — real per-project numbers from the backend.
  const budgetVsSpent = useMemo(
    () =>
      (summary?.charts?.budgetVsSpent || []).map((p) => ({
        project: p.project.length > 14 ? `${p.project.slice(0, 13)}…` : p.project,
        budget: p.budget,
        spent: p.spent,
      })),
    [summary]
  );

  // Projects grouped by status.
  const projectsByStatus = useMemo(() => {
    const palette = ["#6366f1", "#22c55e", "#f97316", "#38bdf8", "#f43f5e", "#a855f7"];
    return (summary?.charts?.projectsByStatus || []).map((g, i) => ({ ...g, color: palette[i % palette.length] }));
  }, [summary]);

  // Top 5 projects by budget.
  const topProjectsByBudget = useMemo(
    () => (summary?.charts?.topProjectsByBudget || []).map((p) => ({ name: p.name, short: p.name.replace(/\s+/g, "\n"), value: p.value })),
    [summary]
  );

  const recentReports = useMemo(
    () =>
      [...reports]
        .sort((a, b) => new Date(b.dateRaw || 0).getTime() - new Date(a.dateRaw || 0).getTime())
        .slice(0, 5),
    [reports]
  );

  const reportInsights = useMemo(() => {
    const lines = [];
    lines.push(`${stats.totalEmployees} employee${stats.totalEmployees === 1 ? "" : "s"} currently in the system.`);
    lines.push(`${stats.totalProjects} project${stats.totalProjects === 1 ? "" : "s"} tracked, ${stats.activeProjects} active.`);
    if (stats.totalTasks > 0) {
      lines.push(`${stats.completedTasks} of ${stats.totalTasks} tasks completed so far.`);
    }
    if (stats.overdueTasks > 0) {
      lines.push(`${stats.overdueTasks} task${stats.overdueTasks === 1 ? "" : "s"} overdue and need attention.`);
    }
    if (stats.totalBudget > 0) {
      const pct = Math.round((stats.totalSpent / stats.totalBudget) * 100);
      lines.push(`${pct}% of total budget spent so far.`);
    }
    if (stats.activeClients > 0) {
      lines.push(`${stats.activeClients} active client${stats.activeClients === 1 ? "" : "s"} across all projects.`);
    }
    if (lines.length <= 2) {
      lines.push("Add projects and approve employees to unlock richer insights here.");
    }
    return lines.slice(0, 5);
  }, [stats]);

  return (
    <div className="space-y-4">
      {/* Header row: breadcrumb, date range + export. Stacks on small screens. */}
      <div className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 text-[11px] ${mutedText}`}>
        <p>
          <button onClick={() => onNavigate("Dashboard")} className="hover:underline">
            Dashboard
          </button>{" "}
          <span className="mx-1">›</span>
          <span className={`font-medium ${cardText}`}>Reports</span>
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
          <div className="relative">
            <button
              onClick={(e) => {
                if (dateRangeOpen) {
                  setDateRangeOpen(false);
                  return;
                }
                // Below the sm breakpoint, anchor the panel to the viewport
                // (centered, clamped inside the screen) instead of to this
                // button's own edge — desktop keeps the original behavior.
                if (window.innerWidth < 640) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDateMenuPos({ top: rect.bottom + 8 });
                } else {
                  setDateMenuPos(null);
                }
                setDateRangeOpen(true);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm ${card} ${mutedText}`}
            >
              <Calendar size={13} />
              <span className="max-w-[140px] sm:max-w-none truncate">{selectedDateRange}</span>
              <ChevronDown size={12} className={`shrink-0 transition-transform ${dateRangeOpen ? "rotate-180" : ""}`} />
            </button>
            {dateRangeOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDateRangeOpen(false)} />
                <div
                  style={dateMenuPos ? { position: "fixed", top: dateMenuPos.top, left: "50%", transform: "translateX(-50%)" } : undefined}
                  className={`${
                    dateMenuPos ? "w-[calc(100vw-2rem)] max-w-xs" : "absolute right-0 top-full mt-1.5 w-48"
                  } rounded-lg shadow-xl z-50 overflow-hidden ${card}`}
                >
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setSelectedDateRange(opt);
                        setDateRangeOpen(false);
                        pushToast(`Showing data for ${opt}`);
                      }}
                      className={`w-full text-left px-3 py-2 text-[11.5px] font-medium transition-colors ${
                        opt === selectedDateRange
                          ? "bg-violet-600 text-white"
                          : darkMode
                          ? "text-slate-300 hover:bg-slate-800"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          )}

          <div className="relative">
            <button
              onClick={(e) => {
                if (uploadMenuOpen) {
                  setUploadMenuOpen(false);
                  return;
                }
                // Same viewport-centered anchoring as the date-range menu on
                // mobile, so this (wider) panel can't run off the side either.
                if (window.innerWidth < 640) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setUploadMenuPos({ top: rect.bottom + 8 });
                } else {
                  setUploadMenuPos(null);
                }
                setUploadMenuOpen(true);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm bg-violet-600 hover:bg-violet-500 text-white transition-colors`}
            >
              <UploadCloud size={13} />
              Upload Daily Report
              <ChevronDown size={12} className={`shrink-0 transition-transform ${uploadMenuOpen ? "rotate-180" : ""}`} />
            </button>
            {uploadMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setUploadMenuOpen(false)} />
                <form
                  onSubmit={submitDailyReportFromMenu}
                  style={uploadMenuPos ? { position: "fixed", top: uploadMenuPos.top, left: "50%", transform: "translateX(-50%)" } : undefined}
                  className={`${
                    uploadMenuPos ? "w-[calc(100vw-2rem)] max-w-sm" : "absolute right-0 top-full mt-1.5 w-72 sm:w-80"
                  } rounded-lg shadow-xl z-50 p-3.5 max-h-[80vh] overflow-y-auto ${card}`}
                >
                  <p className={`text-[10.5px] font-semibold uppercase tracking-wide mb-2 ${subtleText}`}>Quick Upload</p>

                  <div
                    onDragOver={handleDailyDragOver}
                    onDragEnter={handleDailyDragOver}
                    onDragLeave={handleDailyDragLeave}
                    onDrop={handleDailyDrop}
                    className={`rounded-lg transition-colors ${dailyDragActive ? "ring-2 ring-violet-300 bg-violet-50/50" : ""}`}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <label
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-3 text-[10.5px] font-medium cursor-pointer text-center ${
                          darkMode ? "border-slate-700 text-slate-400 hover:bg-slate-800/50" : "border-slate-300 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <ImageIcon size={16} />
                        Upload Photo
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            handleAddDailyFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label
                        className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-2 py-3 text-[10.5px] font-medium cursor-pointer text-center ${
                          darkMode ? "border-slate-700 text-slate-400 hover:bg-slate-800/50" : "border-slate-300 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <Video size={16} />
                        Upload Video
                        <input
                          type="file"
                          accept="video/*"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            handleAddDailyFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label
                        className={`col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 py-2.5 text-[10.5px] font-medium cursor-pointer text-center ${
                          darkMode ? "border-slate-700 text-slate-400 hover:bg-slate-800/50" : "border-slate-300 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        <FileText size={14} />
                        <FileArchive size={14} />
                        Upload PDF / ZIP
                        <input
                          type="file"
                          accept=".pdf,application/pdf,.zip,application/zip,application/x-zip-compressed"
                          multiple
                          className="hidden"
                          onChange={(e) => {
                            handleAddDailyFiles(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <p className={`text-[9.5px] mt-1.5 ${subtleText}`}>
                      {dailyDragActive ? "Drop to add" : "Choose from your gallery, or drag & drop from your desktop."}
                    </p>
                  </div>

                  {dailyPendingFiles.length > 0 && (
                    <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                      {dailyPendingFiles.map((f) => (
                        <div key={f.id} className={`relative rounded-md overflow-hidden border aspect-square ${border}`}>
                          {f.kind === "image" ? (
                            <img src={f.previewUrl} alt={f.name} className="w-full h-full object-cover" />
                          ) : f.kind === "pdf" || f.kind === "zip" ? (
                            <div className={`w-full h-full flex flex-col items-center justify-center gap-0.5 px-0.5 ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-50 text-slate-500"}`} title={f.name}>
                              <DailyFileIcon kind={f.kind} size={16} />
                              <span className="text-[8px] font-semibold uppercase leading-none">{f.kind}</span>
                              <span className="text-[7.5px] leading-tight w-full text-center truncate">{f.name}</span>
                            </div>
                          ) : (
                            <video src={f.previewUrl} className="w-full h-full object-cover" muted />
                          )}
                          {f.kind === "video" && (
                            <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white pointer-events-none">
                              <PlayCircle size={13} />
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeDailyPendingFile(f.id)}
                            aria-label={`Remove ${f.name}`}
                            className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-slate-900/70 text-white flex items-center justify-center"
                          >
                            <X size={9} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <label className={`block text-[10px] font-semibold uppercase tracking-wide mt-3 mb-1 ${subtleText}`}>Project</label>
                  <select
                    value={dailyProject}
                    onChange={(e) => setDailyProject(e.target.value)}
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id || p.name} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <label className={`block text-[10px] font-semibold uppercase tracking-wide mt-3 mb-1 ${subtleText}`}>Info</label>
                  <textarea
                    value={dailyNote}
                    onChange={(e) => setDailyNote(e.target.value)}
                    rows={2}
                    placeholder="What did you work on today?"
                    className={`w-full rounded-lg border px-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 resize-none ${inputCls}`}
                  />

                  <button
                    type="submit"
                    disabled={dailySubmitting}
                    className="w-full mt-2.5 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3 py-1.5 text-[11.5px] font-semibold disabled:opacity-70"
                  >
                    {dailySubmitting ? (
                      <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                    ) : (
                      <UploadCloud size={13} />
                    )}
                    Add Daily Report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadMenuOpen(false);
                      setDailyModalOpen(true);
                      setTimeout(() => document.getElementById("daily-reports-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                    }}
                    className={`w-full mt-1.5 text-[10.5px] font-semibold ${TINT_STYLES.sky.link} hover:underline`}
                  >
                    View full Daily Reports history →
                  </button>
                </form>
              </>
            )}
          </div>

          {isAdmin && (
          <button
            onClick={exportReport}
            disabled={exporting}
            className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-70"
          >
            {exporting ? (
              <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
            ) : (
              <Download size={13} />
            )}
            Export Report
          </button>
          )}
        </div>
      </div>

      {/* ---------------------------------------------- Report Categories */}
      <div className={`rounded-xl p-4 shadow-sm ${card}`}>
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className={`font-semibold text-sm ${cardText}`}>{isAdmin ? "Report Categories" : "Daily Reports"}</h3>
            <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>
              {isAdmin ? "Choose a report type to view detailed insights and analytics." : "Log today's work — attach photos, a short video, PDF or ZIP as proof."}
            </p>
          </div>
          {isAdmin && categoryFilter !== "All" && (
            <button
              onClick={() => setCategoryFilter("All")}
              className={`shrink-0 text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
            >
              Clear filter ({categoryFilter}) ×
            </button>
          )}
        </div>

        <div className={`grid grid-cols-1 ${isAdmin ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:max-w-sm"} gap-3 mt-3.5`}>
          {isAdmin && REPORT_CATEGORIES.map((cat) => {
            const { label, desc, icon: Icon, tint, key } = cat;
            const t = TINT_STYLES[tint];
            const actualCount = reportsForCategory(key).length;
            return (
              <button
                key={label}
                type="button"
                onClick={() => setCategoryModal(cat)}
                className={`text-left rounded-xl p-3.5 border transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 min-w-0 ${t.ring} ${
                  darkMode ? "border-slate-800 hover:bg-slate-800/40" : "border-slate-100 hover:bg-slate-50/70"
                }`}
              >
                <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${t.bg} ${t.text}`}>
                  <Icon size={16} />
                </span>
                <p className={`text-[12.5px] font-semibold mt-2.5 ${cardText}`}>{label}</p>
                <p className={`text-[10.5px] mt-1 leading-snug ${subtleText}`}>{desc}</p>
                <p className={`text-[10.5px] font-semibold mt-1.5 ${t.link}`}>{actualCount} Report{actualCount === 1 ? "" : "s"}</p>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              setDailyModalOpen((v) => !v);
              setTimeout(() => document.getElementById("daily-reports-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
            }}
            className={`text-left rounded-xl p-3.5 border transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 ring-cyan-200 min-w-0 ${
              darkMode ? "border-slate-800 hover:bg-slate-800/40" : "border-slate-100 hover:bg-slate-50/70"
            }`}
          >
            <span className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-cyan-50 text-cyan-600">
              <UploadCloud size={16} />
            </span>
            <p className={`text-[12.5px] font-semibold mt-2.5 ${cardText}`}>Daily Reports</p>
            <p className={`text-[10.5px] mt-1 leading-snug ${subtleText}`}>
              {isAdmin
                ? "Review every employee's daily work uploads — photos and videos."
                : "Log today's work — attach photos, a short video, PDF or ZIP as proof."}
            </p>
            <p className="text-[10.5px] font-semibold mt-1.5 text-cyan-600">
              {isAdmin ? `${dailyReports.length} Submission${dailyReports.length === 1 ? "" : "s"}` : `${myDailyReports.length} Submitted`}
            </p>
          </button>
        </div>
      </div>

      {/* ---------------------------------------------- Daily Reports (inline, like All Reports below) */}
      {dailyModalOpen && (
        <div id="daily-reports-anchor" className={`rounded-xl p-4 shadow-sm ${card}`}>
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5">
            <div>
              <h3 className={`font-semibold text-sm ${cardText}`}>Daily Reports</h3>
              <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>
                {isAdmin ? "Every employee's daily work uploads, newest first." : "Your daily work log, with photo/video proof."}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {isAdmin && (
                <>
                  <select
                    value={adminUserFilter}
                    onChange={(e) => setAdminUserFilter(e.target.value)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                  >
                    <option value="All">All employees</option>
                    {dailyReportUserOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    value={adminDateFilter}
                    onChange={(e) => setAdminDateFilter(e.target.value)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                  />
                  <select
                    value={adminProjectFilter}
                    onChange={(e) => setAdminProjectFilter(e.target.value)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                  >
                    <option value="All">All projects</option>
                    {dailyReportProjectOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  {adminProjectFilter !== "All" && (
                    <button
                      onClick={() => deleteAllDailyReportsForProject(adminProjectFilter, filteredAdminDailyReports)}
                      className="flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                    >
                      <Trash2 size={11} /> Delete all for this project
                    </button>
                  )}
                  {(adminUserFilter !== "All" || adminDateFilter || adminProjectFilter !== "All") && (
                    <button
                      onClick={() => {
                        setAdminUserFilter("All");
                        setAdminDateFilter("");
                        setAdminProjectFilter("All");
                        setDailyProjectFocus("");
                      }}
                      className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
                    >
                      Clear filters ×
                    </button>
                  )}
                </>
              )}
              {!isAdmin && dailyProjectFocus && (
                <>
                  <span className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}>
                    Filtered to {dailyProjectFocus}
                  </span>
                  <button
                    onClick={() => deleteAllDailyReportsForProject(dailyProjectFocus, myDailyReports)}
                    className="flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    <Trash2 size={11} /> Delete all for this project
                  </button>
                  <button
                    onClick={() => setDailyProjectFocus("")}
                    className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
                  >
                    Clear filter ×
                  </button>
                </>
              )}
              <button
                onClick={() => setDailyModalOpen(false)}
                className={`flex items-center gap-1 text-[10.5px] font-semibold px-2.5 py-1.5 rounded-lg ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
              >
                <X size={11} /> Close
              </button>
            </div>
          </div>

          {(isAdmin ? filteredAdminDailyReports : myDailyReports).length === 0 ? (
            <div className={`flex flex-col items-center justify-center text-center py-14 ${mutedText}`}>
              <span className={`w-11 h-11 rounded-full flex items-center justify-center mb-3 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                <UploadCloud size={18} />
              </span>
              <p className={`text-[12.5px] font-semibold ${cardText}`}>
                {isAdmin ? "No daily reports submitted yet." : "You haven't submitted a daily report yet"}
              </p>
              <p className="text-[11px] mt-1">Use "Upload Daily Report" above to add photos, video, PDF/ZIP and info.</p>
            </div>
          ) : (
            <>
              {/* Desktop / tablet table */}
              <div className="overflow-x-auto mt-3.5 hidden sm:block">
                <table className="w-full min-w-[640px] border-collapse">
                  <thead>
                    <tr className={`text-left border-b ${border}`}>
                      {[isAdmin ? "Employee" : null, "Date", "Info", "Media", "Actions"].filter(Boolean).map((h) => (
                        <th key={h} className={`text-[10px] font-semibold uppercase tracking-wide py-2 px-2 whitespace-nowrap ${subtleText}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(isAdmin ? filteredAdminDailyReports : myDailyReports).map((entry) => (
                      <tr key={entry.id} className={`border-b last:border-b-0 align-top ${border} ${rowHover} transition-colors`}>
                        {isAdmin && (
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-2">
                              <img src={entry.userAvatar} alt={entry.userName} className="w-7 h-7 rounded-full object-cover shrink-0" />
                              <span className={`text-[11.5px] font-semibold whitespace-nowrap ${cardText}`}>{entry.userName}</span>
                            </div>
                          </td>
                        )}
                        <td className={`py-2.5 px-2 text-[11px] whitespace-nowrap ${mutedText}`}>
                          {entry.date}
                          <br />
                          <span className={subtleText}>{fmtDateTime(entry.createdAt)}</span>
                        </td>
                        <td className={`py-2.5 px-2 text-[11px] max-w-[260px] ${mutedText}`}>
                          {entry.note || "—"}
                          <br />
                          <span
                            className={`inline-flex items-center gap-1 mt-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                              entry.status === "approved"
                                ? "bg-emerald-50 text-emerald-600"
                                : darkMode
                                ? "bg-slate-800 text-slate-400"
                                : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {entry.status === "approved" ? <CheckCircle2 size={9} /> : null}
                            {entry.status === "approved" ? "Approved" : "Pending"}
                          </span>
                          {entry.project && (
                            <span
                              className={`inline-flex items-center gap-1 mt-1 ml-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                                darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              <FolderKanban size={9} /> {entry.project}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          {entry.files.length === 0 ? (
                            <span className={`text-[10.5px] ${subtleText}`}>No media</span>
                          ) : (
                            <div className="flex items-center gap-1.5 flex-wrap max-w-[220px]">
                              {entry.files.map((f) => (
                                <button
                                  key={f.id}
                                  type="button"
                                  onClick={() => openMediaViewer(f)}
                                  title={`View ${f.name}`}
                                  className={`w-8 h-8 rounded-md border flex items-center justify-center shrink-0 ${border} ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}
                                >
                                  <DailyFileIcon kind={f.kind} size={13} className={subtleText} />
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-1">
                            {/* Approve + Message are admin-only actions — an employee
                                viewing their own daily reports never sees them. */}
                            {isAdmin && entry.status !== "approved" && (
                              <button
                                onClick={() => handleApproveDailyReport(entry)}
                                aria-label="Approve report"
                                title="Approve"
                                className={`w-6 h-6 rounded-md flex items-center justify-center text-emerald-600 ${rowHover}`}
                              >
                                <CheckCircle2 size={13} />
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                onClick={() => openMessageModal(entry)}
                                aria-label="Message employee about this report"
                                title="Message"
                                className={`w-6 h-6 rounded-md flex items-center justify-center text-violet-600 ${rowHover}`}
                              >
                                <MessageSquare size={13} />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteDailyReport(entry)}
                              aria-label="Delete report"
                              title="Delete"
                              className={`w-6 h-6 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="sm:hidden mt-3.5 space-y-2.5">
                {(isAdmin ? filteredAdminDailyReports : myDailyReports).map((entry) => (
                  <div key={entry.id} className={`rounded-lg border p-3 ${border}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isAdmin && <img src={entry.userAvatar} alt={entry.userName} className="w-8 h-8 rounded-full shrink-0" />}
                        <div className="min-w-0">
                          {isAdmin && <p className={`text-[12px] font-semibold truncate ${cardText}`}>{entry.userName}</p>}
                          <p className={`text-[10.5px] ${mutedText}`}>
                            {entry.date} · {fmtDateTime(entry.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Approve + Message are admin-only actions — an employee
                            viewing their own daily reports never sees them. */}
                        {isAdmin && entry.status !== "approved" && (
                          <button
                            onClick={() => handleApproveDailyReport(entry)}
                            aria-label="Approve report"
                            className={`w-7 h-7 rounded-md flex items-center justify-center text-emerald-600 ${rowHover}`}
                          >
                            <CheckCircle2 size={14} />
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => openMessageModal(entry)}
                            aria-label="Message employee about this report"
                            className={`w-7 h-7 rounded-md flex items-center justify-center text-violet-600 ${rowHover}`}
                          >
                            <MessageSquare size={14} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteDailyReport(entry)}
                          aria-label="Delete report"
                          className={`w-7 h-7 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 mt-2 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                        entry.status === "approved"
                          ? "bg-emerald-50 text-emerald-600"
                          : darkMode
                          ? "bg-slate-800 text-slate-400"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {entry.status === "approved" ? <CheckCircle2 size={9} /> : null}
                      {entry.status === "approved" ? "Approved" : "Pending"}
                    </span>
                    {entry.project && (
                      <span
                        className={`inline-flex items-center gap-1 mt-2 ml-1 text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full ${
                          darkMode ? "bg-slate-800 text-slate-400" : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        <FolderKanban size={9} /> {entry.project}
                      </span>
                    )}
                    {entry.note && <p className={`text-[11px] mt-2 leading-snug ${mutedText}`}>{entry.note}</p>}
                    {entry.files.length > 0 && (
                      <div className="grid grid-cols-4 gap-1.5 mt-2.5">
                        {entry.files.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => openMediaViewer(f)}
                            className={`relative rounded-md overflow-hidden border aspect-square flex items-center justify-center ${border} ${
                              darkMode ? "bg-slate-800" : "bg-slate-50"
                            }`}
                          >
                            <DailyFileIcon kind={f.kind} size={14} className={subtleText} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ---------------------------------------------- Activity Log (everyone: own trail; full access: every user) */}
      <ActivitySection darkMode={darkMode} isAdmin={isAdmin} rangeParams={rangeParams} rangeLabel={selectedDateRange} />

      {/* ---------------------------------------------- Company Assets (everyone: assigned to them; full access: every asset) */}
      <AssetsSection darkMode={darkMode} isAdmin={isAdmin} />

      {isAdmin && (
      <>
      {/* ---------------------------------------------- Key Summary */}
      <div>
        <div className="flex items-baseline gap-2 mb-2.5">
          <h3 className={`font-semibold text-sm ${cardText}`}>Key Summary</h3>
          <span className={`text-[10.5px] ${subtleText}`}>({selectedDateRange})</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          {keySummary.map(({ label, value, note, icon: Icon, tint }) => {
            const t = TINT_STYLES[tint];
            return (
              <button
                key={label}
                type="button"
                onClick={scrollToAllReports}
                className={`text-left rounded-xl p-3.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 min-w-0 ${t.ring} ${card}`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.bg} ${t.text}`}>
                  <Icon size={14} />
                </span>
                <p className={`text-[10.5px] mt-2.5 ${mutedText}`}>{label}</p>
                <p className={`text-lg font-bold mt-0.5 ${headingText}`}>{value}</p>
                {note && (
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    <span className={`text-[9.5px] ${subtleText}`}>{note}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---------------------------------------------- Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 xl:items-stretch">
        {/* Budget vs Spent (per real project) */}
        <div className={`xl:col-span-1 rounded-xl p-4 shadow-sm flex flex-col ${card}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className={`font-semibold text-sm ${cardText}`}>Budget vs Spent</h3>
            <span className={`flex items-center gap-1 text-[10px] font-medium border rounded-md px-2 py-1 ${mutedText} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {stats.totalProjects} project{stats.totalProjects === 1 ? "" : "s"}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className={`flex items-center gap-1.5 text-[10.5px] font-medium ${mutedText}`}>
              <span className="w-2 h-2 rounded-full bg-violet-600" /> Budget
            </span>
            <span className={`flex items-center gap-1.5 text-[10.5px] font-medium ${mutedText}`}>
              <span className="w-2 h-2 rounded-full bg-rose-500" /> Spent
            </span>
          </div>
          {budgetVsSpent.length === 0 ? (
            <div className={`flex-1 flex items-center justify-center text-center py-10 ${subtleText}`}>
              <p className="text-[11px]">No project budget data yet.</p>
            </div>
          ) : (
            <div className="h-[220px] mt-2 -ml-2 flex-1 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={budgetVsSpent} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={darkMode ? "#1e293b" : "#eef0f6"} />
                  <XAxis dataKey="project" tick={{ fontSize: 9, fill: darkMode ? "#64748b" : "#94a3b8" }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 9, fill: darkMode ? "#64748b" : "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    width={34}
                    tickFormatter={(v) => `$${v / 1000}K`}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 10,
                      border: "none",
                      boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
                      fontSize: 11,
                      background: darkMode ? "#1e293b" : "#fff",
                      color: darkMode ? "#e2e8f0" : "#1e293b",
                    }}
                    formatter={(v) => `$${v.toLocaleString()}`}
                  />
                  <Line type="monotone" dataKey="budget" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 2.5, fill: "#7c3aed" }} activeDot={{ r: 4 }} />
                  <Line type="monotone" dataKey="spent" stroke="#f43f5e" strokeWidth={2.5} dot={{ r: 2.5, fill: "#f43f5e" }} activeDot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Projects by Status */}
        <div className={`rounded-xl p-4 shadow-sm flex flex-col ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold text-sm ${cardText}`}>Projects by Status</h3>
            <MoreHorizontal size={16} className={subtleText} />
          </div>
          {projectsByStatus.length === 0 ? (
            <div className={`flex-1 flex items-center justify-center text-center py-10 ${subtleText}`}>
              <p className="text-[11px]">No projects yet.</p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col sm:flex-row items-center gap-4 mt-2">
              <div className="relative w-[140px] h-[140px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={projectsByStatus}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={44}
                      outerRadius={64}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {projectsByStatus.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: 10,
                        border: "none",
                        boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
                        fontSize: 11,
                        background: darkMode ? "#1e293b" : "#fff",
                        color: darkMode ? "#e2e8f0" : "#1e293b",
                      }}
                      formatter={(v) => `${v} project${v === 1 ? "" : "s"}`}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className={`text-base font-bold ${headingText}`}>{stats.totalProjects}</span>
                  <span className={`text-[9.5px] ${subtleText}`}>Total Projects</span>
                </div>
              </div>
              <div className="flex-1 w-full space-y-2 min-w-0">
                {projectsByStatus.map((s) => (
                  <div key={s.name} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                    <span className={`text-[11px] font-medium flex-1 truncate ${cardText}`}>{s.name}</span>
                    <span className={`text-[10.5px] font-semibold w-16 text-right ${cardText}`}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top Projects by Budget */}
        <div className={`rounded-xl p-4 shadow-sm flex flex-col ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold text-sm ${cardText}`}>Top Projects by Budget</h3>
            <span className={`flex items-center gap-1 text-[10px] font-medium border rounded-md px-2 py-1 ${mutedText} ${darkMode ? "border-slate-700" : "border-slate-200"}`}>
              {selectedDateRange}
            </span>
          </div>
          {topProjectsByBudget.length === 0 ? (
            <div className={`flex-1 flex items-center justify-center text-center py-10 ${subtleText}`}>
              <p className="text-[11px]">No project budgets recorded yet.</p>
            </div>
          ) : (
            <div className="h-[220px] mt-2 flex-1 min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProjectsByBudget} margin={{ top: 20, right: 4, left: -18, bottom: 0 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke={darkMode ? "#1e293b" : "#eef0f6"} />
                  <XAxis
                    dataKey="short"
                    tick={{ fontSize: 8.5, fill: darkMode ? "#64748b" : "#94a3b8" }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tickFormatter={(v) => v.split("\n")[0]}
                  />
                  <YAxis tick={{ fontSize: 9, fill: darkMode ? "#64748b" : "#94a3b8" }} tickLine={false} axisLine={false} width={34} tickFormatter={(v) => `$${v / 1000}K`} />
                  <Tooltip
                    cursor={{ fill: darkMode ? "rgba(148,163,184,0.08)" : "rgba(99,102,241,0.06)" }}
                    contentStyle={{
                      borderRadius: 10,
                      border: "none",
                      boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
                      fontSize: 11,
                      background: darkMode ? "#1e293b" : "#fff",
                      color: darkMode ? "#e2e8f0" : "#1e293b",
                    }}
                    formatter={(v) => [`$${v.toLocaleString()}`, "Budget"]}
                    labelFormatter={(_, p) => p?.[0]?.payload?.name || ""}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} fill="#6366f1" label={{ position: "top", fontSize: 9, fill: darkMode ? "#94a3b8" : "#64748b", formatter: (v) => `$${(v / 1000).toFixed(1)}K` }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* ---------------------------------------------- All Reports + right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 items-start">
        {/* All Reports table */}
        <div ref={allReportsRef} className={`xl:col-span-3 rounded-xl p-4 shadow-sm ${card}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div>
              <h3 className={`font-semibold text-sm ${cardText}`}>All Reports</h3>
              <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>View, download and manage all available reports.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:flex-none">
                <Search size={13} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${subtleText}`} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search reports..."
                  className={`w-full sm:w-48 rounded-lg border pl-8 pr-2.5 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className={`rounded-lg border px-2 py-1.5 text-[11.5px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
              >
                <option value="All">All Categories</option>
                {REPORT_CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.key}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {pageReports.length === 0 ? (
            <div className={`flex flex-col items-center justify-center text-center py-14 ${mutedText}`}>
              <span className={`w-11 h-11 rounded-full flex items-center justify-center mb-3 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                <FileText size={18} />
              </span>
              <p className={`text-[12.5px] font-semibold ${cardText}`}>No reports match your search</p>
              <p className="text-[11px] mt-1">Try a different keyword or clear the category filter.</p>
            </div>
          ) : (
            <>
              {/* Desktop / tablet table */}
              <div className="overflow-x-auto mt-3.5 hidden sm:block">
                <table className="w-full min-w-[720px] border-collapse">
                  <thead>
                    <tr className={`text-left border-b ${border}`}>
                      {["Report Name", "Category", "Description", "Generated On", "Generated By", "Format", "Actions"].map((h) => (
                        <th key={h} className={`text-[10px] font-semibold uppercase tracking-wide py-2 px-2 whitespace-nowrap ${subtleText}`}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pageReports.map((r) => (
                      <tr key={r.id} className={`border-b last:border-b-0 ${border} ${rowHover} transition-colors`}>
                        <td className="py-2.5 px-2">
                          <button onClick={() => setPreviewReport(r)} className="flex items-center gap-2 text-left">
                            <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                              <FileText size={13} />
                            </span>
                            <span className={`text-[11.5px] font-semibold whitespace-nowrap hover:underline ${cardText}`}>{r.name}</span>
                          </button>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${CATEGORY_CHIP[r.category] || "bg-slate-50 text-slate-600"}`}>
                            {r.category}
                          </span>
                        </td>
                        <td className={`py-2.5 px-2 text-[11px] max-w-[220px] truncate ${mutedText}`}>{r.desc}</td>
                        <td className={`py-2.5 px-2 text-[11px] whitespace-nowrap ${mutedText}`}>{r.date}</td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-1.5 whitespace-nowrap">
                            <img src={r.avatar} alt={r.by} className="w-5 h-5 rounded-full object-cover" />
                            <span className={`text-[11px] font-medium ${cardText}`}>{r.by}</span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${FORMAT_STYLES[r.format]}`}>{r.format}</span>
                        </td>
                        <td className="py-2.5 px-2">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                downloadReport(r);
                                pushToast(`Downloaded "${r.name}"`);
                              }}
                              className={`w-6 h-6 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                              aria-label={`Download ${r.name}`}
                              title="Download"
                            >
                              <Download size={12} />
                            </button>
                            <button
                              onClick={() => setPreviewReport(r)}
                              className={`w-6 h-6 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                              aria-label={`Preview ${r.name}`}
                              title="Preview"
                            >
                              <Eye size={12} />
                            </button>
                            <div className="relative">
                              <button
                                onClick={() => setRowMenuOpen((v) => (v === r.id ? null : r.id))}
                                className={`w-6 h-6 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                                aria-label={`More actions for ${r.name}`}
                              >
                                <MoreVertical size={12} />
                              </button>
                              {rowMenuOpen === r.id && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setRowMenuOpen(null)} />
                                  <div className={`absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl z-50 overflow-hidden ${card}`}>
                                    <button
                                      onClick={() => openRename(r)}
                                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] font-medium ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"}`}
                                    >
                                      <Pencil size={11} /> Rename
                                    </button>
                                    <button
                                      onClick={() => handleDuplicateReport(r)}
                                      className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] font-medium ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"}`}
                                    >
                                      <Copy size={11} /> Duplicate
                                    </button>
                                    <button
                                      onClick={() => handleDeleteReport(r)}
                                      className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                                    >
                                      <Trash2 size={11} /> Delete
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="sm:hidden mt-3.5 space-y-2.5">
                {pageReports.map((r) => (
                  <div key={r.id} className={`rounded-lg border p-3 ${border}`}>
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => setPreviewReport(r)} className="flex items-start gap-2.5 text-left min-w-0">
                        <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                          <FileText size={14} />
                        </span>
                        <span className="min-w-0">
                          <span className={`block text-[12px] font-semibold truncate ${cardText}`}>{r.name}</span>
                          <span className={`block text-[10.5px] mt-0.5 ${mutedText}`}>{r.date}</span>
                        </span>
                      </button>
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setRowMenuOpen((v) => (v === r.id ? null : r.id))}
                          className={`w-7 h-7 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                          aria-label={`More actions for ${r.name}`}
                        >
                          <MoreVertical size={13} />
                        </button>
                        {rowMenuOpen === r.id && (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setRowMenuOpen(null)} />
                            <div className={`absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl z-50 overflow-hidden ${card}`}>
                              <button onClick={() => openRename(r)} className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] font-medium ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"}`}>
                                <Pencil size={11} /> Rename
                              </button>
                              <button onClick={() => handleDuplicateReport(r)} className={`w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] font-medium ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"}`}>
                                <Copy size={11} /> Duplicate
                              </button>
                              <button onClick={() => handleDeleteReport(r)} className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-[11px] font-medium text-rose-600 hover:bg-rose-50">
                                <Trash2 size={11} /> Delete
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <p className={`text-[11px] mt-2 leading-snug ${mutedText}`}>{r.desc}</p>

                    <div className="flex items-center flex-wrap gap-1.5 mt-2.5">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_CHIP[r.category] || "bg-slate-50 text-slate-600"}`}>{r.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${FORMAT_STYLES[r.format]}`}>{r.format}</span>
                    </div>

                    <div className={`flex items-center justify-between gap-2 mt-3 pt-2.5 border-t ${border}`}>
                      <div className="flex items-center gap-1.5">
                        <img src={r.avatar} alt={r.by} className="w-5 h-5 rounded-full object-cover" />
                        <span className={`text-[11px] font-medium ${cardText}`}>{r.by}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPreviewReport(r)}
                          className={`flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-md ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
                        >
                          <Eye size={11} /> View
                        </button>
                        <button
                          onClick={() => {
                            downloadReport(r);
                            pushToast(`Downloaded "${r.name}"`);
                          }}
                          className="flex items-center gap-1 text-[10.5px] font-semibold px-2 py-1 rounded-md bg-violet-600 text-white"
                        >
                          <Download size={11} /> Save
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex items-center justify-between flex-wrap gap-2 mt-3.5">
            <p className={`text-[10.5px] ${subtleText}`}>
              {filteredReports.length === 0
                ? "No reports found"
                : `Showing ${startIdx + 1} to ${Math.min(startIdx + PAGE_SIZE, filteredReports.length)} of ${filteredReports.length} reports`}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className={`w-6 h-6 rounded-md flex items-center justify-center disabled:opacity-40 ${mutedText} ${rowHover}`}
                aria-label="Previous page"
              >
                <ChevronLeft size={13} />
              </button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setPage(i + 1)}
                  className={`w-6 h-6 rounded-md text-[11px] font-semibold flex items-center justify-center ${
                    safePage === i + 1 ? "bg-violet-600 text-white" : `${mutedText} ${rowHover}`
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className={`w-6 h-6 rounded-md flex items-center justify-center disabled:opacity-40 ${mutedText} ${rowHover}`}
                aria-label="Next page"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Right rail: Quick Actions / Recent Reports / Report Insights */}
        <div className="space-y-4">
          <div className={`rounded-xl p-4 shadow-sm ${card}`}>
            <h3 className={`font-semibold text-sm ${cardText}`}>Quick Actions</h3>
            <div className="space-y-1.5 mt-2.5">
              {QUICK_ACTIONS.map(({ key, label, icon: Icon }) => (
                <button
                  key={label}
                  onClick={() => (key === "uploadDaily" ? setDailyModalOpen(true) : setQuickActionModal(key))}
                  className={`w-full flex items-center gap-2.5 text-left rounded-lg px-3 py-2 text-[11.5px] font-medium transition-colors ${
                    darkMode ? "text-slate-300 bg-slate-800 hover:bg-violet-900/30 hover:text-violet-300" : "text-slate-600 bg-slate-50 hover:bg-violet-50 hover:text-violet-700"
                  }`}
                >
                  <Icon size={14} className="text-violet-500 shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={`rounded-xl p-4 shadow-sm ${card}`}>
            <h3 className={`font-semibold text-sm ${cardText}`}>Recent Reports</h3>
            <div className="space-y-2.5 mt-2.5">
              {recentReports.length === 0 && (
                <p className={`text-[11px] ${subtleText}`}>No reports yet — add projects or approve employees to generate some.</p>
              )}
              {recentReports.map((r) => {
                const catTint = REPORT_CATEGORIES.find((c) => c.key === r.category)?.tint || "violet";
                const t = TINT_STYLES[catTint];
                return (
                  <button
                    key={r.id}
                    onClick={() => setPreviewReport(r)}
                    className="w-full flex items-center gap-2.5 text-left"
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${t.bg} ${t.text}`}>
                      <FileText size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[11px] font-semibold truncate ${cardText}`}>{r.name}</p>
                      <p className={`text-[10px] ${subtleText}`}>{r.date}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => {
                setCategoryFilter("All");
                setQuery("");
                setPage(1);
                pushToast("Showing all reports");
                document.getElementById("all-reports-anchor")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-violet-600 mt-3 hover:underline"
            >
              View All Reports <ArrowUpRight size={12} />
            </button>
          </div>

          <div className={`rounded-xl p-4 shadow-sm ${card}`}>
            <h3 className={`font-semibold text-sm ${cardText}`}>Report Insights</h3>
            <ul className="space-y-2 mt-2.5">
              {reportInsights.map((line, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                    {i < 3 ? <ArrowUp size={9} /> : <CheckCircle2 size={9} />}
                  </span>
                  <span className={`text-[11px] leading-snug ${mutedText}`}>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      </>
      )}

      {/* ---------------------------------------------- Modals ---------------------------------------------- */}

      {categoryModal && (
        <Modal
          title={categoryModal.label}
          subtitle={`${reportsForCategory(categoryModal.key).length} reports in this category`}
          onClose={() => setCategoryModal(null)}
          wide
          darkMode={darkMode}
        >
          <div className="space-y-2">
            {reportsForCategory(categoryModal.key).length === 0 && (
              <p className={`text-[11.5px] ${mutedText}`}>No reports in this category yet.</p>
            )}
            {reportsForCategory(categoryModal.key).map((r) => (
              <div key={r.id} className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 ${border}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <FileText size={14} />
                  </span>
                  <div className="min-w-0">
                    <p className={`text-[11.5px] font-semibold truncate ${cardText}`}>{r.name}</p>
                    <p className={`text-[10.5px] ${subtleText}`}>{r.date}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setCategoryModal(null);
                      setPreviewReport(r);
                    }}
                    className={`w-7 h-7 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                    aria-label={`Preview ${r.name}`}
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    onClick={() => {
                      downloadReport(r);
                      pushToast(`Downloaded "${r.name}"`);
                    }}
                    className={`w-7 h-7 rounded-md flex items-center justify-center ${mutedText} ${rowHover}`}
                    aria-label={`Download ${r.name}`}
                  >
                    <Download size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {previewReport && (
        <Modal
          title={previewReport.name}
          subtitle={`Generated ${previewReport.date} by ${previewReport.by}`}
          onClose={() => setPreviewReport(null)}
          wide
          darkMode={darkMode}
        >
          <div className="flex items-center gap-2 flex-wrap mb-3.5">
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${CATEGORY_CHIP[previewReport.category] || "bg-slate-50 text-slate-600"}`}>
              {previewReport.category}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${FORMAT_STYLES[previewReport.format]}`}>{previewReport.format}</span>
          </div>
          <p className={`text-[12px] leading-relaxed ${mutedText}`}>{previewReport.desc}</p>

          <div className={`mt-4 rounded-lg border p-3 ${border}`}>
            <p className={`text-[10.5px] font-semibold uppercase tracking-wide mb-2 ${subtleText}`}>Preview</p>
            <div className={`h-40 rounded-md flex items-center justify-center ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
              <div className="text-center">
                <FileText size={24} className={`mx-auto ${subtleText}`} />
                <p className={`text-[10.5px] mt-1.5 ${subtleText}`}>Full preview available after download</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 mt-4">
            <button
              onClick={() => {
                downloadReport(previewReport);
                pushToast(`Downloaded "${previewReport.name}"`);
              }}
              className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-[11.5px] font-semibold"
            >
              <Download size={13} /> Download
            </button>
            <button
              onClick={() => {
                openRename(previewReport);
                setPreviewReport(null);
              }}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[11.5px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
            >
              <Pencil size={13} /> Rename
            </button>
          </div>
        </Modal>
      )}

      {renameTarget && (
        <Modal title="Rename report" onClose={() => setRenameTarget(null)} darkMode={darkMode}>
          <form onSubmit={submitRename} className="space-y-3.5">
            <div>
              <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>Report name</label>
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className={`w-full rounded-lg border px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
              />
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" className="bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-[11.5px] font-semibold">
                Save changes
              </button>
              <button
                type="button"
                onClick={() => setRenameTarget(null)}
                className={`rounded-lg px-3.5 py-2 text-[11.5px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {quickActionModal && (
        <Modal
          title={QUICK_ACTIONS.find((q) => q.key === quickActionModal)?.label}
          onClose={() => setQuickActionModal(null)}
          darkMode={darkMode}
        >
          {quickActionModal === "generate" && (
            <form
              className="space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const cat = REPORT_CATEGORIES.find((c) => c.key === form.get("category"));
                try {
                  const created = await reportsApi.createCatalogItem({
                    name: `Custom ${cat?.label || "Report"} — ${new Date().toLocaleDateString()}`,
                    category: form.get("category"),
                    desc: `Custom ${cat?.label?.toLowerCase() || "report"} generated on demand.`,
                    format: form.get("format"),
                  });
                  setReports((rs) => [...rs, toReportRow(created)]);
                  setQuickActionModal(null);
                  pushToast("Custom report added to All Reports");
                } catch (err) {
                  pushToast(err.message || "Could not generate report");
                }
              }}
            >
              <div>
                <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>Report type</label>
                <select name="category" className={`w-full rounded-lg border px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}>
                  {REPORT_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>Format</label>
                <select name="format" className={`w-full rounded-lg border px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}>
                  <option>PDF</option>
                  <option>Excel</option>
                </select>
              </div>
              <button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-[11.5px] font-semibold">
                Generate report
              </button>
            </form>
          )}

          {quickActionModal === "schedule" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                setQuickActionModal(null);
                pushToast("Report scheduled");
              }}
            >
              <div>
                <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>Frequency</label>
                <select className={`w-full rounded-lg border px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}>
                  <option>Daily</option>
                  <option>Weekly</option>
                  <option>Monthly</option>
                </select>
              </div>
              <div>
                <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>Send to (email)</label>
                <input type="email" required placeholder="you@company.com" className={`w-full rounded-lg border px-3 py-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`} />
              </div>
              <button type="submit" className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-[11.5px] font-semibold">
                Confirm schedule
              </button>
            </form>
          )}

          {quickActionModal === "templates" && (
            <div className="space-y-2">
              {REPORT_CATEGORIES.map((c) => (
                <div key={c.key} className={`flex items-center justify-between rounded-lg border p-2.5 ${border}`}>
                  <span className={`text-[11.5px] font-medium ${cardText}`}>{c.label} Template</span>
                  <button
                    onClick={() => pushToast(`Opened "${c.label} Template" for editing`)}
                    className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-md ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
                  >
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}

          {quickActionModal === "settings" && (
            <div className="space-y-3.5">
              {["Auto-generate monthly summary", "Email reports to managers", "Include archived projects"].map((s) => (
                <label key={s} className="flex items-center justify-between gap-3 cursor-pointer">
                  <span className={`text-[12px] ${cardText}`}>{s}</span>
                  <input type="checkbox" defaultChecked={s !== "Include archived projects"} className="w-4 h-4 accent-violet-600" />
                </label>
              ))}
              <button
                onClick={() => {
                  setQuickActionModal(null);
                  pushToast("Report settings saved");
                }}
                className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-[11.5px] font-semibold"
              >
                Save settings
              </button>
            </div>
          )}
        </Modal>
      )}

      {viewingMedia && (
        <Modal title={viewingMedia.name} onClose={closeMediaViewer} wide darkMode={darkMode}>
          <div className={`rounded-lg overflow-hidden flex items-center justify-center ${darkMode ? "bg-slate-950" : "bg-slate-900"}`}>
            {viewingMedia.kind === "video" ? (
              <video src={viewingMedia.url} controls autoPlay className="max-h-[70vh] w-full" />
            ) : viewingMedia.kind === "pdf" ? (
              <iframe src={viewingMedia.url} title={viewingMedia.name} className="h-[70vh] w-full bg-white" />
            ) : viewingMedia.kind === "zip" ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-slate-200">
                <FileArchive size={40} />
                <p className="text-xs text-center break-all">{viewingMedia.name}</p>
                <p className="text-[10.5px] text-slate-400">ZIP files can't be previewed — download it to open.</p>
              </div>
            ) : (
              <img src={viewingMedia.url} alt={viewingMedia.name} className="max-h-[70vh] w-full object-contain" />
            )}
          </div>
          <div className="flex items-center justify-between gap-2 mt-2">
            <p className={`text-[10.5px] ${mutedText}`}>{fmtBytes(viewingMedia.size)}</p>
            {(viewingMedia.kind === "pdf" || viewingMedia.kind === "zip") && (
              <a
                href={viewingMedia.url}
                download={viewingMedia.name}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white"
              >
                <Download size={13} /> Download
              </a>
            )}
          </div>
        </Modal>
      )}

      {/* Admin-only: message an employee about one of their daily reports —
          type a note, optionally attach a screenshot, and it's sent straight
          into that employee's Messages thread. */}
      {isAdmin && messageTarget && (
        <Modal
          title={`Message ${messageTarget.userName}`}
          subtitle={`About their ${messageTarget.date} daily report`}
          onClose={closeMessageModal}
          darkMode={darkMode}
        >
          <form onSubmit={sendDailyReportMessage} className="space-y-3.5">
            <div>
              <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>Message</label>
              <textarea
                autoFocus
                rows={4}
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="Write feedback about this report..."
                className={`w-full rounded-lg border px-3 py-2 text-[12px] resize-none focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
              />
            </div>

            <div>
              <label className={`block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${subtleText}`}>
                Screenshots (optional) — attach as many as you need, add a note under each
              </label>
              <input
                ref={messageFileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleMessageScreenshotsChosen}
                className="hidden"
              />

              {messageScreenshots.length > 0 && (
                <div className="space-y-2.5 mb-2.5">
                  {messageScreenshots.map((shot) => (
                    <div key={shot.id} className={`relative rounded-lg border overflow-hidden ${border}`}>
                      <img src={shot.url} alt={shot.name} className="max-h-40 w-full object-contain bg-slate-950/5" />
                      <button
                        type="button"
                        onClick={() => removeMessageScreenshot(shot.id)}
                        aria-label={`Remove ${shot.name}`}
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-slate-900/70 text-white flex items-center justify-center hover:bg-slate-900"
                      >
                        <X size={12} />
                      </button>
                      <div className={`p-2 ${darkMode ? "bg-slate-800" : "bg-slate-50"}`}>
                        <input
                          type="text"
                          value={shot.note}
                          onChange={(e) => updateMessageScreenshotNote(shot.id, e.target.value)}
                          placeholder="What's the mistake in this screenshot?"
                          className={`w-full rounded-md border px-2.5 py-1.5 text-[11px] focus:outline-none focus:ring-2 focus:ring-violet-300 ${inputCls}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => messageFileInputRef.current?.click()}
                className={`flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-2 text-[11.5px] font-semibold w-full justify-center ${border} ${mutedText} ${rowHover}`}
              >
                <Paperclip size={13} /> {messageScreenshots.length > 0 ? "Attach another screenshot" : "Attach screenshot(s)"}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={messageSending || (!messageDraft.trim() && messageScreenshots.length === 0)}
                className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-[11.5px] font-semibold disabled:opacity-50"
              >
                <Send size={13} /> {messageSending ? "Sending..." : "Send"}
              </button>
              <button
                type="button"
                onClick={closeMessageModal}
                className={`rounded-lg px-3.5 py-2 text-[11.5px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div id="all-reports-anchor" />
      <Toast toasts={toasts} />
    </div>
  );
}