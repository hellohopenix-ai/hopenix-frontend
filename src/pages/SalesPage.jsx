import React, { useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { API_BASE_URL as API_BASE } from "../apiConfig.js";
// Real Companies (dashboard.Client) + Projects (projects.Project) — so
// the Add/Edit Sale form only offers a client/project that actually
// exists in the system, and picking a company narrows the project list
// down to that company's own real projects.
import { listClients } from "../api/clientsApi.js";
import { listProjects } from "../projectsApi.js";
import { useLiveRefresh, sameJson } from "../useLiveRefresh.js";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  MoreVertical,
  SlidersHorizontal,
  RotateCcw,
  TrendingUp,
  Calendar,
  Clock3,
  ClipboardList,
  ShoppingBag,
  BarChart3,
  Wallet2,
  HandCoins,
  CalendarDays,
  Sparkles,
  FolderKanban,
  X,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  This is the CONTENT-ONLY version of the Sales page — no sidebar,    */
/*  no topbar. It's meant to be rendered inside Dashboard.jsx's <main>  */
/*  area, exactly like ExpensesPage / IncomePage / TasksPage, so it     */
/*  inherits the sidebar + header that Dashboard.jsx already renders.   */
/*                                                                      */
/*  DATA SOURCE: this page now talks to the real Django backend         */
/*  (`sales` app — /api/sales/sales/) instead of localStorage. See the  */
/*  "API layer" section right below for the base URL / auth token      */
/*  wiring — adjust API_BASE and the token key to match your app if    */
/*  they differ.                                                        */
/* ------------------------------------------------------------------ */

const STATUS_STYLES = {
  Paid: "bg-emerald-50 text-emerald-600",
  Partial: "bg-amber-50 text-amber-600",
  Pending: "bg-rose-50 text-rose-600",
};

const AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-700",
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
  "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700",
  "bg-violet-100 text-violet-700",
];

const PROJECT_ICONS = [ShoppingBag, BarChart3, FolderKanban, ClipboardList, Sparkles];
const PROJECT_ICON_BGS = [
  "bg-emerald-50 text-emerald-600",
  "bg-indigo-50 text-indigo-600",
  "bg-amber-50 text-amber-600",
  "bg-sky-50 text-sky-600",
  "bg-rose-50 text-rose-600",
];

function avatarStyle(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function projectIconFor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % PROJECT_ICONS.length;
  return { Icon: PROJECT_ICONS[idx], bg: PROJECT_ICON_BGS[idx] };
}

const DATE_RANGE_OPTIONS = ["All Dates", "This Week", "This Month", "This Quarter", "This Year"];

const PAGE_SIZE = 7;

/* ------------------------------------------------------------------ */
/*  API layer — talks to the Django `sales` app                       */
/*  (backend/hopenix-backend/sales/…). Every Sale row there is exactly */
/*  { id, client, project, amount, date, status } — the same shape    */
/*  this page already worked with, just persisted for real now.       */
/* ------------------------------------------------------------------ */

// API base URL comes from src/apiConfig.js (VITE_API_BASE_URL).

// Adjust this key if the rest of your app stores the auth token under a
// different localStorage key (e.g. "authToken", "hopenix_token").
function getAuthToken() {
  try {
    const raw = window.localStorage.getItem("hopenix_auth_token");
    if (!raw) return "";
    // Stored as a plain token string (most likely case).
    if (!raw.startsWith("{") && !raw.startsWith('"')) return raw;
    // Stored as JSON — either a JSON-encoded string, or an object with
    // the token under a field like token/key/access.
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") return parsed;
    return parsed.token || parsed.key || parsed.access || "";
  } catch (e) {
    return window.localStorage.getItem("hopenix_auth_token") || "";
  }
}

async function apiRequest(path, options = {}) {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (res.status === 204) return null;

  let body = null;
  try {
    body = await res.json();
  } catch (e) {
    /* empty/non-JSON body — fine for 204s, unexpected otherwise */
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (body && typeof body === "object") {
      const flat = Object.values(body).flat().filter(Boolean);
      if (flat.length) message = flat.join(" ");
      else if (body.detail) message = body.detail;
    }
    if (res.status === 401) message = "Please log in again to manage sales.";
    throw new Error(message);
  }

  return body;
}

const fetchSalesFromApi = () => apiRequest("/sales/sales/");
const createSaleOnApi = (payload) =>
  apiRequest("/sales/sales/", { method: "POST", body: JSON.stringify(payload) });
const updateSaleOnApi = (id, payload) =>
  apiRequest(`/sales/sales/${id}/`, { method: "PATCH", body: JSON.stringify(payload) });
const deleteSaleOnApi = (id) => apiRequest(`/sales/sales/${id}/`, { method: "DELETE" });

// API amount comes back as a decimal string ("120000.00") and date as
// ISO ("2025-05-31") — normalize to the shape the rest of the page uses.
function normalizeSale(row) {
  return {
    id: row.id,
    client: row.client,
    project: row.project,
    amount: Number(row.amount) || 0,
    date: row.date,
    status: row.status,
  };
}

function emptyForm() {
  return {
    client: "",
    project: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    status: "Pending",
  };
}

function formatDisplayDate(isoDate) {
  const d = isoDate ? new Date(isoDate) : new Date();
  if (isNaN(d.getTime())) return isoDate || "";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function startOfWeek(d) {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day + 6) % 7; // days since Monday
  const start = new Date(d);
  start.setDate(d.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function resolveDateRange(label) {
  const now = new Date();
  if (label === "This Week") {
    const start = startOfWeek(now);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }
  if (label === "This Month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { start, end };
  }
  if (label === "This Quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), q * 3, 1);
    const end = new Date(now.getFullYear(), q * 3 + 3, 1);
    return { start, end };
  }
  if (label === "This Year") {
    const start = new Date(now.getFullYear(), 0, 1);
    const end = new Date(now.getFullYear() + 1, 0, 1);
    return { start, end };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function ActionsMenu({ darkMode, onEdit, onDelete }) {
  return (
    <div className={`menu-anchor absolute right-0 top-9 z-30 w-32 rounded-lg shadow-lg border py-1 ${darkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"}`}>
      <button onClick={onEdit} className={`w-full flex items-center gap-2 px-3 py-2 text-xs ${darkMode ? "text-slate-300 hover:bg-slate-700" : "text-slate-600 hover:bg-slate-50"}`}>
        <Pencil size={12} /> Edit
      </button>
      <button onClick={onDelete} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-rose-500 hover:bg-rose-50">
        <Trash2 size={12} /> Delete
      </button>
    </div>
  );
}

function FilterSelect({ value, onChange, options, card, mutedText }) {
  return (
    <div className={`relative flex items-center rounded-lg shadow-sm ${card}`}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`appearance-none bg-transparent pl-3 pr-7 py-2 text-xs font-medium rounded-lg outline-none cursor-pointer max-w-[160px] truncate ${mutedText}`}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={12} className={`absolute right-2 pointer-events-none ${mutedText}`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function SalesPage({ darkMode = false }) {
  const [sales, setSales] = useState([]);
  const [page, setPage] = useState(1);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [selectedDateRange, setSelectedDateRange] = useState(DATE_RANGE_OPTIONS[0]);
  const [clientFilter, setClientFilter] = useState("All Clients");
  const [projectFilter, setProjectFilter] = useState("All Projects");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [filtersOpen, setFiltersOpen] = useState(true);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [openMenuId, setOpenMenuId] = useState(null);
  const [showClientsModal, setShowClientsModal] = useState(false);

  // Real companies + projects, for the Add/Edit form's Company/Project
  // dropdowns (see companyNames / projectNamesForCompany below).
  const [realCompanies, setRealCompanies] = useState([]);
  const [realProjects, setRealProjects] = useState([]);

  useEffect(() => {
    let cancelled = false;
    listClients()
      .then((rows) => {
        if (!cancelled) setRealCompanies(Array.isArray(rows) ? rows : rows?.results || []);
      })
      .catch((err) => console.error("Clients fetch failed, Company dropdown will be empty:", err));
    listProjects()
      .then((rows) => {
        if (!cancelled) setRealProjects(Array.isArray(rows) ? rows : rows?.results || []);
      })
      .catch((err) => console.error("Projects fetch failed, Project dropdown will fall back to existing sales:", err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Company dropdown options for the form — real client names, plus the
  // form's current value (so editing an older free-text entry doesn't
  // hide/clear it).
  const companyNames = useMemo(() => {
    const real = realCompanies.map((c) => c.name).filter(Boolean);
    return Array.from(new Set([...real, ...(form.client ? [form.client] : [])]));
  }, [realCompanies, form.client]);

  // Project dropdown options for the form — real projects belonging to
  // the selected company (or company-wide projects with no client),
  // plus the form's current value.
  const projectNamesForCompany = useMemo(() => {
    const matching = realProjects.filter((p) => {
      if (!form.client) return true;
      if (!p.client_name) return true;
      return p.client_name.toLowerCase() === form.client.toLowerCase();
    });
    const names = matching.map((p) => p.name).filter(Boolean);
    return Array.from(new Set([...names, ...(form.project ? [form.project] : [])]));
  }, [realProjects, form.client, form.project]);

  // Changing the company clears a previously-picked project that no
  // longer belongs to it, so a mismatched client/project pair can't be
  // saved together.
  function updateFormClient(value) {
    setForm((f) => {
      const stillValid =
        !f.project ||
        realProjects.some(
          (p) => p.name === f.project && (!p.client_name || p.client_name.toLowerCase() === value.toLowerCase())
        );
      return { ...f, client: value, project: stillValid ? f.project : "" };
    });
  }

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const headingText = darkMode ? "text-white" : "text-slate-900";
  const border = darkMode ? "border-slate-800" : "border-slate-100";

  /* load real sales from the backend on mount (and whenever Retry is hit) */
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const data = await fetchSalesFromApi();
        if (!cancelled) setSales((Array.isArray(data) ? data : []).map(normalizeSale));
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Couldn't load sales from the server.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Live: sales added/edited on another device appear without a reload.
  // Paused while the Add/Edit modal is open so it can't disturb a form.
  useLiveRefresh(
    async () => {
      if (showAddModal) return;
      const data = await fetchSalesFromApi();
      if (!Array.isArray(data)) return;
      const next = data.map(normalizeSale);
      setSales((prev) => (sameJson(prev, next) ? prev : next));
    },
    { interval: 20000 }
  );

  /* close 3-dot menu on outside click */
  useEffect(() => {
    function handleClick(e) {
      if (!e.target.closest?.(".menu-anchor") && !e.target.closest?.(".menu-trigger")) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  /* reset to page 1 whenever a filter changes */
  useEffect(() => {
    setPage(1);
  }, [clientFilter, projectFilter, statusFilter, selectedDateRange]);

  const clientOptions = ["All Clients", ...Array.from(new Set(sales.map((s) => s.client))).sort()];
  const projectOptions = ["All Projects", ...Array.from(new Set(sales.map((s) => s.project))).sort()];
  const statusOptions = ["All Statuses", ...Object.keys(STATUS_STYLES)];

  const filteredSales = useMemo(() => {
    const range = resolveDateRange(selectedDateRange);
    return sales.filter((row) => {
      if (clientFilter !== "All Clients" && row.client !== clientFilter) return false;
      if (projectFilter !== "All Projects" && row.project !== projectFilter) return false;
      if (statusFilter !== "All Statuses" && row.status !== statusFilter) return false;
      if (range) {
        const d = new Date(row.date);
        if (d < range.start || d >= range.end) return false;
      }
      return true;
    });
  }, [sales, clientFilter, projectFilter, statusFilter, selectedDateRange]);

  const totalPages = Math.max(1, Math.ceil(filteredSales.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredSales.slice(start, start + PAGE_SIZE);
  }, [filteredSales, safePage]);

  const pageNumbers = useMemo(() => {
    const nums = [1, 2, 3].filter((n) => n <= totalPages);
    if (totalPages > 3) nums.push("...", totalPages);
    return nums;
  }, [totalPages]);

  /* ---- derived stats (from the full data set) ---- */
  const now = new Date();
  const totalSales = sales.reduce((s, e) => s + e.amount, 0);
  const thisMonthSales = sales
    .filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((s, e) => s + e.amount, 0);
  const pendingRows = sales.filter((e) => e.status !== "Paid");
  const pendingAmount = pendingRows.reduce((s, e) => s + e.amount, 0);
  const totalOrders = sales.length;

  const STAT_CARDS = [
    { key: "total", label: "Total Sales", value: `PKR ${totalSales.toLocaleString()}`, note: "All time", icon: TrendingUp, iconBg: "bg-emerald-50 text-emerald-600" },
    { key: "month", label: "This Month", value: `PKR ${thisMonthSales.toLocaleString()}`, note: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }), icon: Calendar, iconBg: "bg-sky-50 text-sky-600" },
    { key: "pending", label: "Pending Payments", value: `PKR ${pendingAmount.toLocaleString()}`, note: `${pendingRows.length} sales`, icon: Clock3, iconBg: "bg-amber-50 text-amber-600" },
    { key: "orders", label: "Total Orders", value: String(totalOrders), note: "Tap to view all", icon: ClipboardList, iconBg: "bg-violet-50 text-violet-600" },
  ];

  const clientTotals = useMemo(() => {
    const totals = {};
    sales.forEach((s) => {
      const key = `${s.client}::${s.project}`;
      totals[key] = (totals[key] || 0) + s.amount;
    });
    return Object.entries(totals)
      .map(([key, amount]) => {
        const [client, project] = key.split("::");
        return { client, project, amount };
      })
      .sort((a, b) => b.amount - a.amount);
  }, [sales]);
  const topClients = clientTotals.slice(0, 5);

  /* real daily totals for the current calendar month — feeds the chart */
  const chartData = useMemo(() => {
    const byDay = {};
    sales.forEach((s) => {
      const d = new Date(s.date);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        const key = d.getDate();
        byDay[key] = (byDay[key] || 0) + s.amount;
      }
    });
    return Object.keys(byDay)
      .map(Number)
      .sort((a, b) => a - b)
      .map((day) => ({
        day: `${now.toLocaleString("en-US", { month: "short" })} ${day}`,
        value: byDay[day],
      }));
  }, [sales]);

  const activeFilterCount = [
    clientFilter !== "All Clients",
    projectFilter !== "All Projects",
    statusFilter !== "All Statuses",
    selectedDateRange !== DATE_RANGE_OPTIONS[0],
  ].filter(Boolean).length;
  const hasActiveFilters = activeFilterCount > 0;

  function handleReset() {
    setClientFilter("All Clients");
    setProjectFilter("All Projects");
    setStatusFilter("All Statuses");
    setSelectedDateRange(DATE_RANGE_OPTIONS[0]);
    setPage(1);
  }

  function handleStatClick(key) {
    if (key === "total" || key === "month" || key === "orders") {
      handleReset();
    } else if (key === "pending") {
      handleReset();
      setStatusFilter("Partial");
    }
  }

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm());
    setFormError("");
    setShowAddModal(true);
  }

  function openEditModal(row) {
    setForm({
      client: row.client,
      project: row.project,
      amount: String(row.amount),
      date: row.date,
      status: row.status,
    });
    setEditingId(row.id);
    setFormError("");
    setShowAddModal(true);
    setOpenMenuId(null);
  }

  async function handleDelete(id) {
    setOpenMenuId(null);
    const previous = sales;
    setSales((prev) => prev.filter((x) => x.id !== id));
    try {
      await deleteSaleOnApi(id);
    } catch (err) {
      setSales(previous); // rollback — the server rejected the delete
      setLoadError(err.message || "Couldn't delete that sale.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.client.trim() || !form.project.trim() || !form.amount || Number(form.amount) <= 0) return;

    setSaving(true);
    setFormError("");
    const payload = {
      client: form.client.trim(),
      project: form.project.trim(),
      amount: Number(form.amount),
      date: form.date,
      status: form.status,
    };

    try {
      if (editingId) {
        const updated = await updateSaleOnApi(editingId, payload);
        setSales((prev) => prev.map((x) => (x.id === editingId ? normalizeSale(updated) : x)));
      } else {
        const created = await createSaleOnApi(payload);
        setSales((prev) => [normalizeSale(created), ...prev]);
      }
      setShowAddModal(false);
      setEditingId(null);
      setForm(emptyForm());
      setPage(1);
    } catch (err) {
      setFormError(err.message || "Couldn't save this sale — please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Real PDF export (jsPDF + autoTable) — builds an actual PDF document
  // with a title and a formatted table, then saves it as a genuine .pdf.
  function handleExport() {
    const header = ["Client", "Project", "Amount (PKR)", "Date", "Status"];
    const rows = filteredSales.map((r) => [r.client, r.project, r.amount.toLocaleString(), formatDisplayDate(r.date), r.status]);

    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Sales Report", 14, 15);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Exported ${new Date().toLocaleDateString()} · ${filteredSales.length} sales`, 14, 21);

    autoTable(doc, {
      head: [header],
      body: rows,
      startY: 26,
      styles: { fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [124, 58, 237] }, // violet-600
      alternateRowStyles: { fillColor: [248, 250, 252] },
    });

    doc.save("sales-report.pdf");
  }

  return (
    <div className="space-y-4">
      {/* Load-error banner (e.g. backend unreachable / not logged in) */}
      {loadError && (
        <div className={`flex items-center justify-between gap-3 rounded-lg px-3.5 py-2.5 text-xs font-medium ${darkMode ? "bg-rose-950/40 text-rose-300 border border-rose-900" : "bg-rose-50 text-rose-600 border border-rose-100"}`}>
          <span>{loadError}</span>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="font-semibold underline shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* Page actions */}
      <div className="flex justify-end gap-2 flex-wrap">
        <button
          onClick={handleExport}
          disabled={loading}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium shadow-sm disabled:opacity-50 ${card} ${mutedText}`}
        >
          <Download size={13} />
          Export Report
          <ChevronDown size={12} />
        </button>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
        >
          <Plus size={14} />
          Add Sale
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {STAT_CARDS.map(({ key, label, value, note, icon: Icon, iconBg }) => (
          <button
            key={label}
            onClick={() => handleStatClick(key)}
            className={`text-left rounded-xl p-3 sm:p-4 shadow-sm ${card} hover:ring-2 hover:ring-violet-200 transition-shadow ${
              key === "pending" && statusFilter === "Partial" ? "ring-2 ring-violet-400" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <span className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 ${iconBg}`}>
                <Icon size={16} />
              </span>
              <div className="min-w-0">
                <p className={`text-[11px] sm:text-xs font-medium ${mutedText}`}>{label}</p>
                <p className={`text-base sm:text-xl font-bold mt-0.5 truncate ${headingText}`}>{value}</p>
              </div>
            </div>
            <p className={`text-[10px] sm:text-[10.5px] mt-2 ${subtleText}`}>{note}</p>
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setDateRangeOpen((v) => !v)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm ${card} ${mutedText}`}
            >
              <Calendar size={13} />
              <span className="max-w-[140px] truncate">{selectedDateRange}</span>
              <ChevronDown size={12} className={`transition-transform ${dateRangeOpen ? "rotate-180" : ""}`} />
            </button>
            {dateRangeOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDateRangeOpen(false)} />
                <div className={`absolute left-0 top-full mt-1.5 w-52 rounded-lg shadow-xl z-50 overflow-hidden ${card}`}>
                  {DATE_RANGE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => {
                        setSelectedDateRange(opt);
                        setDateRangeOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-[11.5px] font-medium transition-colors ${
                        opt === selectedDateRange ? "bg-violet-600 text-white" : darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm transition-colors ${
                filtersOpen ? "bg-violet-600 text-white" : `${card} ${mutedText}`
              }`}
            >
              <SlidersHorizontal size={13} />
              Filter
              {activeFilterCount > 0 && (
                <span className={`text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center ${
                  filtersOpen ? "bg-white/25 text-white" : "bg-violet-600 text-white"
                }`}>
                  {activeFilterCount}
                </span>
              )}
              <ChevronDown size={12} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
            <button
              onClick={handleReset}
              disabled={!hasActiveFilters}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm transition-opacity ${card} ${
                hasActiveFilters ? mutedText : `${mutedText} opacity-40 cursor-not-allowed`
              }`}
            >
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </div>

        {filtersOpen && (
          <div className={`flex items-center gap-2 flex-wrap rounded-lg p-2.5 ${darkMode ? "bg-slate-800/40" : "bg-slate-50"}`}>
            <FilterSelect value={clientFilter} onChange={setClientFilter} options={clientOptions} card={card} mutedText={mutedText} />
            <FilterSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} card={card} mutedText={mutedText} />
            <FilterSelect value={statusFilter} onChange={setStatusFilter} options={statusOptions} card={card} mutedText={mutedText} />
          </div>
        )}
      </div>

      {/* Chart + Top clients */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`xl:col-span-2 rounded-xl p-4 shadow-sm ${card}`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className={`font-semibold text-sm ${cardText}`}>Sales This Month</h3>
            <button className={`flex items-center gap-1 text-[10px] font-medium border rounded-md px-2 py-1 ${mutedText} ${border}`}>
              Daily <ChevronDown size={10} />
            </button>
          </div>
          <div className="h-[240px] sm:h-[280px] mt-2 -ml-2 relative">
            {chartData.length === 0 && !loading && (
              <div className={`absolute inset-0 flex items-center justify-center text-xs ${subtleText}`}>
                No sales recorded this month yet.
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={darkMode ? "#1e293b" : "#eef0f6"} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: darkMode ? "#64748b" : "#94a3b8" }} tickLine={false} axisLine={false} interval={2} />
                <YAxis
                  tickFormatter={(v) => `${v / 1000}K`}
                  tick={{ fontSize: 10, fill: darkMode ? "#64748b" : "#94a3b8" }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  formatter={(v) => [`PKR ${v.toLocaleString()}`, "Sales"]}
                  contentStyle={{
                    borderRadius: 10,
                    border: "none",
                    boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
                    fontSize: 11,
                    background: darkMode ? "#1e293b" : "#fff",
                    color: darkMode ? "#e2e8f0" : "#1e293b",
                  }}
                />
                <Area
                  type="linear"
                  dataKey="value"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fill="url(#salesFill)"
                  dot={{ r: 4, fill: "#6366f1", strokeWidth: 2, stroke: darkMode ? "#0f172a" : "#fff" }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`rounded-xl p-4 shadow-sm ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold text-sm ${cardText}`}>Top Clients / Projects</h3>
            <button onClick={() => setShowClientsModal(true)} className="text-[11px] font-semibold text-violet-500 hover:text-violet-600">
              View All
            </button>
          </div>
          <div className="mt-3 space-y-3.5">
            {topClients.length === 0 && (
              <p className={`text-[11.5px] ${subtleText}`}>{loading ? "Loading…" : "No sales yet."}</p>
            )}
            {topClients.map(({ client, project, amount }) => {
              const { Icon, bg } = projectIconFor(project);
              return (
                <button
                  key={`${client}-${project}`}
                  onClick={() => {
                    handleReset();
                    setClientFilter(client);
                    setProjectFilter(project);
                  }}
                  className="w-full flex items-center gap-2.5 text-left hover:opacity-80 transition-opacity"
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
                    <Icon size={14} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[11.5px] font-semibold truncate ${cardText}`}>{project}</p>
                    <p className={`text-[10.5px] truncate ${subtleText}`}>{client}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[11.5px] font-bold ${cardText}`}>PKR {amount.toLocaleString()}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent sales + Summary */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`xl:col-span-2 rounded-xl p-4 shadow-sm ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className={`font-semibold text-sm ${cardText}`}>Recent Sales</h3>
            <button onClick={handleReset} className="text-[11px] font-semibold text-violet-500 hover:text-violet-600">
              View All
            </button>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className={`text-left text-[10.5px] uppercase tracking-wide ${subtleText}`}>
                  <th className="py-2 pr-2 font-semibold">#</th>
                  <th className="py-2 pr-2 font-semibold">Client</th>
                  <th className="py-2 pr-2 font-semibold">Project / Service</th>
                  <th className="py-2 pr-2 font-semibold">Amount</th>
                  <th className="py-2 pr-2 font-semibold">Date</th>
                  <th className="py-2 pr-2 font-semibold">Payment Status</th>
                  <th className="py-2 pr-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={7} className={`py-10 text-center text-xs ${mutedText}`}>
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 size={14} className="animate-spin" /> Loading sales…
                        </span>
                      ) : (
                        "No sales match these filters."
                      )}
                    </td>
                  </tr>
                )}
                {pageRows.map((row, idx) => (
                  <tr key={row.id} className={`border-t ${border} ${darkMode ? "hover:bg-slate-800/40" : "hover:bg-slate-50"} transition-colors`}>
                    <td className={`py-2.5 pr-2 text-[11.5px] ${mutedText}`}>{(safePage - 1) * PAGE_SIZE + idx + 1}</td>
                    <td className="py-2.5 pr-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${avatarStyle(row.client)}`}>
                          {row.client.charAt(0)}
                        </span>
                        <span className={`text-[11.5px] font-medium whitespace-nowrap ${cardText}`}>{row.client}</span>
                      </div>
                    </td>
                    <td className={`py-2.5 pr-2 text-[11.5px] whitespace-nowrap ${mutedText}`}>{row.project}</td>
                    <td className={`py-2.5 pr-2 text-[11.5px] font-bold whitespace-nowrap ${cardText}`}>PKR {row.amount.toLocaleString()}</td>
                    <td className={`py-2.5 pr-2 text-[11.5px] whitespace-nowrap ${mutedText}`}>{formatDisplayDate(row.date)}</td>
                    <td className="py-2.5 pr-2">
                      <span className={`text-[10.5px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLES[row.status]}`}>{row.status}</span>
                    </td>
                    <td className="py-2.5 pr-2 text-right relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === row.id ? null : row.id)}
                        className={`menu-trigger ${mutedText} hover:text-violet-500`}
                        aria-label="Row actions"
                      >
                        <MoreVertical size={14} />
                      </button>
                      {openMenuId === row.id && (
                        <ActionsMenu darkMode={darkMode} onEdit={() => openEditModal(row)} onDelete={() => handleDelete(row.id)} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className={`md:hidden mt-2 divide-y ${border}`}>
            {pageRows.length === 0 && (
              <p className={`py-10 text-center text-xs ${mutedText}`}>
                {loading ? "Loading sales…" : "No sales match these filters."}
              </p>
            )}
            {pageRows.map((row) => (
              <div key={row.id} className="py-3.5 flex items-start gap-3">
                <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarStyle(row.client)}`}>
                  {row.client.charAt(0)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${cardText}`}>{row.client}</p>
                      <p className={`text-[11px] mt-0.5 truncate ${mutedText}`}>{row.project} · {formatDisplayDate(row.date)}</p>
                    </div>
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === row.id ? null : row.id)}
                        className={`menu-trigger ${mutedText} hover:text-violet-500 p-1`}
                        aria-label="Row actions"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {openMenuId === row.id && (
                        <ActionsMenu darkMode={darkMode} onEdit={() => openEditModal(row)} onDelete={() => handleDelete(row.id)} />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2.5">
                    <span className={`text-sm font-bold ${cardText}`}>PKR {row.amount.toLocaleString()}</span>
                    <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLES[row.status]}`}>{row.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 mt-3">
            <p className={`text-[11px] ${subtleText}`}>
              Showing {filteredSales.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} to{" "}
              {Math.min(safePage * PAGE_SIZE, filteredSales.length)} of {filteredSales.length} sales
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={`w-7 h-7 rounded-md flex items-center justify-center border ${border} ${mutedText}`}
              >
                <ChevronLeft size={13} />
              </button>
              {pageNumbers.map((n, i) =>
                n === "..." ? (
                  <span key={`dots-${i}`} className={`text-[11px] px-1 ${subtleText}`}>…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-7 h-7 rounded-md text-[11px] font-semibold flex items-center justify-center ${
                      safePage === n ? "bg-violet-600 text-white" : `${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`
                    }`}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className={`w-7 h-7 rounded-md flex items-center justify-center border ${border} ${mutedText}`}
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className={`rounded-xl p-4 shadow-sm ${card}`}>
          <h3 className={`font-semibold text-sm ${cardText}`}>Sales Summary</h3>
          <div className="mt-3 space-y-1">
            {[
              { label: "Total Sales (This Month)", value: thisMonthSales, icon: BarChart3, iconBg: "bg-sky-50 text-sky-600" },
              { label: "Total Sales (All Time)", value: totalSales, icon: CalendarDays, iconBg: "bg-indigo-50 text-indigo-600" },
              { label: "Average Sale Value", value: totalOrders ? Math.round(totalSales / totalOrders) : 0, icon: Wallet2, iconBg: "bg-emerald-50 text-emerald-600" },
              { label: "Payment Received", value: sales.filter((s) => s.status === "Paid").reduce((a, s) => a + s.amount, 0), icon: HandCoins, iconBg: "bg-emerald-50 text-emerald-600" },
              { label: "Pending Payments", value: pendingAmount, icon: Clock3, iconBg: "bg-amber-50 text-amber-600" },
            ].map(({ label, value, icon: Icon, iconBg }) => (
              <div key={label} className={`flex items-center gap-3 py-2 rounded-lg ${darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50"} transition-colors`}>
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
                  <Icon size={14} />
                </span>
                <span className={`text-[11.5px] flex-1 ${mutedText}`}>{label}</span>
                <span className={`text-[11.5px] font-bold whitespace-nowrap ${cardText}`}>PKR {value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ---------------- Add / Edit Sale Modal ---------------- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className={`w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto ${darkMode ? "bg-slate-900" : "bg-white"}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
              <h3 className={`text-sm font-semibold ${cardText}`}>{editingId ? "Edit Sale" : "Add Sale"}</h3>
              <button onClick={() => setShowAddModal(false)} className={mutedText}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
              {formError && (
                <div className={`rounded-lg px-3 py-2 text-[11.5px] font-medium ${darkMode ? "bg-rose-950/40 text-rose-300" : "bg-rose-50 text-rose-600"}`}>
                  {formError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Client / Company</label>
                  <select
                    required
                    value={form.client}
                    onChange={(e) => updateFormClient(e.target.value)}
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  >
                    <option value="">Select company…</option>
                    {companyNames.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Project / Service</label>
                  <select
                    required
                    value={form.project}
                    onChange={(e) => setForm({ ...form, project: e.target.value })}
                    disabled={!form.client}
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  >
                    <option value="">{form.client ? "Select project…" : "Select a company first"}</option>
                    {projectNamesForCompany.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Amount (PKR)</label>
                  <input
                    required
                    type="number"
                    min="1"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="50000"
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  />
                </div>
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  />
                </div>
              </div>
              <div>
                <label className={`text-[11px] font-medium ${mutedText}`}>Payment Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                >
                  {Object.keys(STATUS_STYLES).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  disabled={saving}
                  className={`flex-1 rounded-lg py-2.5 text-xs font-semibold border disabled:opacity-50 ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving && <Loader2 size={13} className="animate-spin" />}
                  {editingId ? "Save Changes" : "Add Sale"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- All Clients Modal ---------------- */}
      {showClientsModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className={`w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto ${darkMode ? "bg-slate-900" : "bg-white"}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
              <h3 className={`text-sm font-semibold ${cardText}`}>All Clients / Projects</h3>
              <button onClick={() => setShowClientsModal(false)} className={mutedText}>
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-2">
              {clientTotals.map(({ client, project, amount }) => {
                const { Icon, bg } = projectIconFor(project);
                return (
                  <button
                    key={`${client}-${project}`}
                    onClick={() => {
                      handleReset();
                      setClientFilter(client);
                      setProjectFilter(project);
                      setShowClientsModal(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg p-2.5 text-left ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${bg}`}>
                      <Icon size={14} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-semibold truncate ${cardText}`}>{project}</p>
                      <p className={`text-[10.5px] truncate ${subtleText}`}>{client}</p>
                    </div>
                    <span className={`text-xs font-bold shrink-0 ${cardText}`}>PKR {amount.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}