import React, { useState, useEffect, useMemo, useRef } from "react";
import { API_BASE_URL } from "../apiConfig.js";
import {
  DollarSign,
  Wallet,
  Clock,
  CreditCard,
  PiggyBank,
  ArrowUp,
  ArrowDown,
  Filter,
  Download,
  Plus,
  Search,
  ChevronDown,
  MoreVertical,
  Calendar,
  X,
  Pencil,
  Trash2,
  Moon,
  Sun,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

/* ------------------------------------------------------------------ */
/*  Real backend wiring — Django REST + Postgres (dashboard.Income)   */
/* ------------------------------------------------------------------ */
// API base URL comes from src/apiConfig.js (VITE_API_BASE_URL).
const INCOME_ENDPOINT = `${API_BASE_URL}/dashboard/incomes/`;

// AuthContext.jsx isi exact key ke naam se login token localStorage mein
// rakhta hai — baaki app (Dashboard stats, users, etc.) sab yahi key
// padhte hain, isliye Income bhi wahi use karta hai (warna 401 aata hai).
function getAuthToken() {
  return localStorage.getItem("hopenix_auth_token") || "";
}

function authHeaders(extra = {}) {
  const token = getAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Token ${token}` } : {}),
    ...extra,
  };
}

async function apiRequest(url, options = {}) {
  const res = await fetch(url, { ...options, headers: authHeaders(options.headers) });
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body?.detail || Object.values(body || {}).flat().join(" ") || "";
    } catch {
      // response body JSON nahi tha — plain status text par gira do
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Postgres row (dashboard.Income) -> IncomePage ka internal entry shape.
// "desc"/"date"/"receivedOn" ke alawa sab keys backend se seedhi aati hain.
function mapApiEntry(row) {
  return {
    id: row.id,
    date: formatDisplayDate(row.date),
    sortDate: row.date,
    desc: row.desc,
    project: row.project || "",
    client: row.client || "",
    amount: Number(row.amount) || 0,
    method: row.method,
    status: row.status,
    receivedOn: row.received_on ? formatDisplayDate(row.received_on) : "—",
  };
}

const PROJECTS_BASE = ["E-Commerce Website", "Mobile App Development", "Brand Identity Design", "CRM System", "Inventory Management System"];
const METHOD_OPTIONS = ["Bank Transfer", "JazzCash", "Easypaisa", "Cash in Hand"];
const STATUS_OPTIONS = ["Received", "Pending", "Overdue"];
const TABS = ["All Incomes", "Received", "Pending", "Overdue"];
const PROJECT_COLORS = ["#10b981", "#6366f1", "#0ea5e9", "#f97316", "#eab308", "#ec4899", "#8b5cf6", "#14b8a6"];

const STATUS_STYLES = {
  Received: "bg-emerald-50 text-emerald-600",
  Pending: "bg-amber-50 text-amber-600",
  Overdue: "bg-rose-50 text-rose-600",
};

const METHOD_DOT = {
  "Bank Transfer": "bg-violet-500",
  JazzCash: "bg-orange-500",
  Easypaisa: "bg-emerald-500",
  "Cash in Hand": "bg-teal-500",
};

function fmt(n) {
  return `PKR ${Number(n || 0).toLocaleString()}`;
}

function formatDisplayDate(iso) {
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

/* ------------------------------------------------------------------ */
/*  Reusable Modal shell (top-level so form state never remounts)     */
/* ------------------------------------------------------------------ */
function Modal({ title, onClose, children, theme, maxWidth = "max-w-lg" }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="fixed inset-0 bg-black/40" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} sm:mx-4 ${theme.card} rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b sticky top-0 z-10 ${theme.card} ${theme.border}`}>
          <h3 className={`font-semibold text-sm ${theme.headingText}`}>{title}</h3>
          <button onClick={onClose} className={`${theme.mutedText} hover:text-rose-500 transition-colors`} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Add / Edit form — top-level component so keystrokes never reset   */
/* ------------------------------------------------------------------ */
function IncomeFormModal({ theme, initialEntry, projectOptions, onClose, onSubmit }) {
  const isEdit = !!initialEntry;
  const [form, setForm] = useState(() => ({
    date: initialEntry ? initialEntry.sortDate : todayIso(),
    desc: initialEntry ? initialEntry.desc : "",
    project: initialEntry ? initialEntry.project : "",
    client: initialEntry ? initialEntry.client : "",
    amount: initialEntry ? String(initialEntry.amount) : "",
    method: initialEntry ? initialEntry.method : "Bank Transfer",
    status: initialEntry ? initialEntry.status : "Received",
  }));
  const [error, setError] = useState("");

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubmit(ev) {
    ev.preventDefault();
    if (!form.date) {
      setError("Please choose a date.");
      return;
    }
    if (!form.desc.trim() || !form.project.trim() || !form.client.trim()) {
      setError("Please fill in description, project and client.");
      return;
    }
    const amountNum = Number(form.amount);
    if (!amountNum || amountNum <= 0) {
      setError("Enter a valid amount greater than 0.");
      return;
    }
    setError("");
    onSubmit(form);
  }

  const inputCls = `w-full rounded-lg px-3 py-2 text-sm outline-none border focus:ring-2 focus:ring-violet-500/30 focus:border-violet-500 transition-colors ${theme.inputBg} ${theme.border} ${theme.cardText}`;
  const labelCls = `block text-xs font-medium mb-1 ${theme.mutedText}`;

  return (
    <Modal title={isEdit ? "Edit Income" : "Add Income"} onClose={onClose} theme={theme}>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Amount (PKR)</label>
            <input type="number" min="0" step="1" inputMode="numeric" value={form.amount} onChange={(e) => update("amount", e.target.value)} placeholder="e.g. 25000" className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Description</label>
          <input type="text" value={form.desc} onChange={(e) => update("desc", e.target.value)} placeholder="e.g. Milestone 1 Payment" className={inputCls} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Project</label>
            <input
              list="income-project-options"
              type="text"
              value={form.project}
              onChange={(e) => update("project", e.target.value)}
              placeholder="e.g. CRM System"
              className={inputCls}
            />
            <datalist id="income-project-options">
              {projectOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Client</label>
            <input type="text" value={form.client} onChange={(e) => update("client", e.target.value)} placeholder="e.g. Global Solutions" className={inputCls} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Payment Method</label>
            <select value={form.method} onChange={(e) => update("method", e.target.value)} className={inputCls}>
              {METHOD_OPTIONS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select value={form.status} onChange={(e) => update("status", e.target.value)} className={inputCls}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-xs font-medium text-rose-500">{error}</p>}

        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold border ${theme.border} ${theme.mutedText}`}>
            Cancel
          </button>
          <button type="submit" className="px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 shadow-sm">
            {isEdit ? "Save Changes" : "Add Income"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Per-row actions dropdown (3 dots)                                 */
/* ------------------------------------------------------------------ */
function ActionMenu({ theme, open, onToggle, onEdit, onDelete }) {
  return (
    <div className="relative inline-block">
      <button
        onClick={onToggle}
        className={`p-1 rounded-md ${theme.mutedText} hover:text-violet-600 hover:bg-violet-50 transition-colors`}
        aria-label="Row actions"
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className={`absolute right-0 top-full mt-1 w-36 rounded-lg shadow-xl z-50 overflow-hidden border ${theme.card} ${theme.border}`}>
            <button onClick={onEdit} className={`w-full flex items-center gap-2 text-left px-3 py-2.5 text-[11px] font-medium ${theme.mutedText} ${theme.hoverRow}`}>
              <Pencil size={12} /> Edit
            </button>
            <button onClick={onDelete} className="w-full flex items-center gap-2 text-left px-3 py-2.5 text-[11px] font-medium text-rose-500 hover:bg-rose-50">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function IncomePage({ darkMode = false }) {
  const [dark, setDark] = useState(darkMode);
  const [entries, setEntries] = useState(null); // null while loading
  const [saveError, setSaveError] = useState(false);

  const [activeTab, setActiveTab] = useState("All Incomes");
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState("All Projects");
  const [methodFilter, setMethodFilter] = useState("All Payment Methods");
  const [projectOpen, setProjectOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [page, setPage] = useState(1);

  const [dateOpen, setDateOpen] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  const [formOpen, setFormOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [viewAllModal, setViewAllModal] = useState(null); // "project" | "recent" | null
  const [toast, setToast] = useState(null);

  const tableRef = useRef(null);
  const toastTimer = useRef(null);

  /* ---------------- load once from Postgres via the Django API -------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await apiRequest(INCOME_ENDPOINT);
        if (cancelled) return;
        setEntries(Array.isArray(rows) ? rows.map(mapApiEntry) : []);
        setSaveError(false);
      } catch {
        if (!cancelled) {
          setEntries([]);
          setSaveError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function showToast(msg) {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }

  function scrollToTable() {
    window.setTimeout(() => {
      tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  /* ---------------- CRUD handlers — talk to Postgres via the API ------ */
  async function handleFormSubmit(form) {
    const payload = {
      date: form.date,
      desc: form.desc.trim(),
      project: form.project.trim(),
      client: form.client.trim(),
      amount: Number(form.amount) || 0,
      method: form.method,
      status: form.status,
      // received_on jaanboojh kar nahi bheja — backend hi status ke
      // hisaab se ye field set karta hai (Income.save() dekhein).
    };

    try {
      if (editEntry) {
        const updated = await apiRequest(`${INCOME_ENDPOINT}${editEntry.id}/`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setEntries((prev) => prev.map((e) => (e.id === editEntry.id ? mapApiEntry(updated) : e)));
        showToast("Income updated");
      } else {
        const created = await apiRequest(INCOME_ENDPOINT, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setEntries((prev) => [mapApiEntry(created), ...prev]);
        showToast("Income added");
      }
      setSaveError(false);
      setFormOpen(false);
      setEditEntry(null);
    } catch (err) {
      setSaveError(true);
      showToast(err.message || "Could not save — check your connection");
    }
  }

  async function handleDelete(id) {
    try {
      await apiRequest(`${INCOME_ENDPOINT}${id}/`, { method: "DELETE" });
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setSaveError(false);
      showToast("Income entry deleted");
    } catch (err) {
      setSaveError(true);
      showToast(err.message || "Could not delete — check your connection");
    } finally {
      setConfirmDeleteId(null);
      setOpenMenuId(null);
    }
  }

  function openAdd() {
    setEditEntry(null);
    setFormOpen(true);
  }
  function openEdit(entry) {
    setEditEntry(entry);
    setFormOpen(true);
    setOpenMenuId(null);
  }

  /* ---------------- derived data ---------------- */
  const stats = useMemo(() => {
    if (!entries) return { total: 0, received: 0, pending: 0, overdue: 0, avg: 0, count: 0 };
    const total = entries.reduce((s, e) => s + e.amount, 0);
    const received = entries.filter((e) => e.status === "Received").reduce((s, e) => s + e.amount, 0);
    const pending = entries.filter((e) => e.status === "Pending").reduce((s, e) => s + e.amount, 0);
    const overdue = entries.filter((e) => e.status === "Overdue").reduce((s, e) => s + e.amount, 0);
    const avg = entries.length ? Math.round(total / entries.length) : 0;
    return { total, received, pending, overdue, avg, count: entries.length };
  }, [entries]);

  const projectOptions = useMemo(() => {
    const fromEntries = entries ? entries.map((e) => e.project) : [];
    return Array.from(new Set([...PROJECTS_BASE, ...fromEntries])).filter(Boolean);
  }, [entries]);

  const projectBreakdown = useMemo(() => {
    if (!entries) return [];
    const map = new Map();
    entries.forEach((e) => map.set(e.project, (map.get(e.project) || 0) + e.amount));
    const total = [...map.values()].reduce((a, b) => a + b, 0) || 1;
    return [...map.entries()]
      .map(([name, amount], i) => ({
        name,
        amount,
        pct: +((amount / total) * 100).toFixed(1),
        color: PROJECT_COLORS[i % PROJECT_COLORS.length],
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [entries]);

  const overviewSlices = useMemo(() => {
    const total = stats.total || 1;
    return [
      { key: "Received", value: stats.received, pct: Math.round((stats.received / total) * 100), color: "#10b981" },
      { key: "Pending", value: stats.pending, pct: Math.round((stats.pending / total) * 100), color: "#f97316" },
      { key: "Overdue", value: stats.overdue, pct: Math.round((stats.overdue / total) * 100), color: "#f43f5e" },
    ];
  }, [stats]);

  const recentIncomes = useMemo(() => {
    if (!entries) return [];
    return [...entries].sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate)).slice(0, 5);
  }, [entries]);

  const allProjects = useMemo(() => ["All Projects", ...projectOptions], [projectOptions]);
  const allMethods = ["All Payment Methods", ...METHOD_OPTIONS];

  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries
      .filter((e) => {
        if (activeTab !== "All Incomes" && e.status !== activeTab) return false;
        if (projectFilter !== "All Projects" && e.project !== projectFilter) return false;
        if (methodFilter !== "All Payment Methods" && e.method !== methodFilter) return false;
        if (search && !e.desc.toLowerCase().includes(search.toLowerCase())) return false;
        if (dateStart && e.sortDate < dateStart) return false;
        if (dateEnd && e.sortDate > dateEnd) return false;
        if (amountMin && e.amount < Number(amountMin)) return false;
        if (amountMax && e.amount > Number(amountMax)) return false;
        return true;
      })
      .sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate));
  }, [entries, activeTab, projectFilter, methodFilter, search, dateStart, dateEnd, amountMin, amountMax]);

  const activeFilterCount =
    (dateStart || dateEnd ? 1 : 0) + (amountMin || amountMax ? 1 : 0);

  function clearAllFilters() {
    setActiveTab("All Incomes");
    setProjectFilter("All Projects");
    setMethodFilter("All Payment Methods");
    setSearch("");
    setDateStart("");
    setDateEnd("");
    setAmountMin("");
    setAmountMax("");
    showToast("Filters cleared");
  }

  function applyDatePreset(preset) {
    const today = new Date();
    if (preset === "all") {
      setDateStart("");
      setDateEnd("");
    } else if (preset === "thisMonth") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      setDateStart(first.toISOString().slice(0, 10));
      setDateEnd(last.toISOString().slice(0, 10));
    } else if (preset === "last30") {
      const past = new Date(today);
      past.setDate(past.getDate() - 30);
      setDateStart(past.toISOString().slice(0, 10));
      setDateEnd(today.toISOString().slice(0, 10));
    }
  }

  const dateRangeLabel = useMemo(() => {
    if (dateStart && dateEnd) return `${formatDisplayDate(dateStart)} - ${formatDisplayDate(dateEnd)}`;
    if (dateStart) return `From ${formatDisplayDate(dateStart)}`;
    if (dateEnd) return `Until ${formatDisplayDate(dateEnd)}`;
    return "All Dates";
  }, [dateStart, dateEnd]);

  useEffect(() => {
    setPage(1);
  }, [activeTab, projectFilter, methodFilter, search, rowsPerPage, dateStart, dateEnd, amountMin, amountMax]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * rowsPerPage, currentPage * rowsPerPage);
  const startIdx = filtered.length === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1;
  const endIdx = Math.min(currentPage * rowsPerPage, filtered.length);

  function exportPdf() {
    if (!entries || entries.length === 0) {
      showToast("No income entries to export");
      return;
    }

    const rowsHtml = entries
      .map(
        (e) => `
          <tr>
            <td>${escapeHtml(e.date)}</td>
            <td>${escapeHtml(e.desc)}</td>
            <td>${escapeHtml(e.project)}</td>
            <td>${escapeHtml(e.client)}</td>
            <td class="num">${escapeHtml(fmt(e.amount))}</td>
            <td>${escapeHtml(e.method)}</td>
            <td>${escapeHtml(e.status)}</td>
            <td>${escapeHtml(e.receivedOn)}</td>
          </tr>`
      )
      .join("");

    const generatedOn = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      showToast("Please allow pop-ups to export as PDF");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Income Report</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; padding: 32px; }
            h1 { font-size: 20px; margin: 0 0 4px; }
            .meta { font-size: 11px; color: #64748b; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
            th { background: #f8fafc; font-weight: 700; }
            td.num, th.num { text-align: right; }
            .summary { margin-top: 18px; font-size: 12px; }
            .summary span { margin-right: 24px; }
            .summary b { color: #0f172a; }
            @media print {
              body { padding: 12px; }
            }
          </style>
        </head>
        <body>
          <h1>Income Report</h1>
          <div class="meta">Generated on ${escapeHtml(generatedOn)} &middot; ${entries.length} entries</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Project</th>
                <th>Client</th>
                <th class="num">Amount</th>
                <th>Method</th>
                <th>Status</th>
                <th>Received On</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">
            <span>Total: <b>${escapeHtml(fmt(stats.total))}</b></span>
            <span>Received: <b>${escapeHtml(fmt(stats.received))}</b></span>
            <span>Pending: <b>${escapeHtml(fmt(stats.pending))}</b></span>
            <span>Overdue: <b>${escapeHtml(fmt(stats.overdue))}</b></span>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.onafterprint = () => printWindow.close();

    showToast("Report exported");
  }

  function goStatCard(tab) {
    setActiveTab(tab);
    scrollToTable();
  }

  function goProject(name) {
    setProjectFilter(name);
    setActiveTab("All Incomes");
    scrollToTable();
  }

  function goRecent(entry) {
    setActiveTab("All Incomes");
    setProjectFilter("All Projects");
    setMethodFilter("All Payment Methods");
    setSearch(entry.desc);
    scrollToTable();
  }

  /* ---------------- theme classes ---------------- */
  const theme = {
    card: dark ? "bg-slate-900 border border-slate-800" : "bg-white",
    cardText: dark ? "text-slate-200" : "text-slate-800",
    subtleText: dark ? "text-slate-500" : "text-slate-400",
    mutedText: dark ? "text-slate-400" : "text-slate-500",
    headingText: dark ? "text-white" : "text-slate-900",
    border: dark ? "border-slate-800" : "border-slate-100",
    hoverRow: dark ? "hover:bg-slate-800/60" : "hover:bg-slate-50",
    inputBg: dark ? "bg-slate-800" : "bg-slate-50",
  };
  const { card, cardText, subtleText, mutedText, headingText, border, hoverRow, inputBg } = theme;

  const STAT_CARD_DEFS = [
    { key: "total", label: "Total Income", value: stats.total, delta: "32%", up: true, note: "vs Apr 1 - Apr 30, 2025", icon: DollarSign, tint: "emerald", tab: "All Incomes" },
    { key: "received", label: "Received", value: stats.received, delta: "28%", up: true, note: "vs Apr 1 - Apr 30, 2025", icon: Wallet, tint: "emerald", tab: "Received" },
    { key: "pending", label: "Pending", value: stats.pending, delta: "50%", up: true, note: "vs Apr 1 - Apr 30, 2025", icon: Clock, tint: "amber", tab: "Pending" },
    { key: "overdue", label: "Overdue", value: stats.overdue, delta: "0%", up: false, note: "vs Apr 1 - Apr 30, 2025", icon: CreditCard, tint: "rose", tab: "Overdue" },
    { key: "avg", label: "This Month's Avg.", value: stats.avg, delta: "20%", up: true, note: `Based on ${stats.count} incomes`, icon: PiggyBank, tint: "sky", tab: "All Incomes" },
  ];
  const TINTS = {
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
    sky: "bg-sky-50 text-sky-600",
  };

  if (!entries) {
    return (
      <div className="p-8 text-center">
        <p className={`text-sm ${mutedText}`}>Loading income data…</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
        <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
          <button
            onClick={() => setDark((v) => !v)}
            className={`w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium shadow-sm ${card} ${mutedText}`}
          >
            {dark ? <Sun size={13} /> : <Moon size={13} />}
            {dark ? "Light" : "Dark"}
          </button>
          <div className="relative">
            <button
              onClick={() => {
                setDateOpen((v) => !v);
                setFilterOpen(false);
              }}
              className={`w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium shadow-sm ${card} ${mutedText} ${
                dateStart || dateEnd ? "ring-2 ring-violet-500/40" : ""
              }`}
            >
              <Calendar size={13} />
              <span className="truncate">{dateRangeLabel}</span>
              <ChevronDown size={12} className={`shrink-0 transition-transform ${dateOpen ? "rotate-180" : ""}`} />
            </button>
            {dateOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDateOpen(false)} />
                <div className={`absolute right-0 left-auto top-full mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-lg shadow-xl z-50 p-4 space-y-3 ${card} border ${border}`}>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={`block text-[10px] font-medium mb-1 ${mutedText}`}>Start date</label>
                      <input
                        type="date"
                        value={dateStart}
                        onChange={(e) => setDateStart(e.target.value)}
                        className={`w-full rounded-md px-2 py-1.5 text-xs outline-none border ${inputBg} ${border} ${cardText}`}
                      />
                    </div>
                    <div>
                      <label className={`block text-[10px] font-medium mb-1 ${mutedText}`}>End date</label>
                      <input
                        type="date"
                        value={dateEnd}
                        onChange={(e) => setDateEnd(e.target.value)}
                        className={`w-full rounded-md px-2 py-1.5 text-xs outline-none border ${inputBg} ${border} ${cardText}`}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button onClick={() => applyDatePreset("thisMonth")} className={`px-2 py-1 rounded-md text-[10px] font-medium ${inputBg} ${mutedText}`}>
                      This month
                    </button>
                    <button onClick={() => applyDatePreset("last30")} className={`px-2 py-1 rounded-md text-[10px] font-medium ${inputBg} ${mutedText}`}>
                      Last 30 days
                    </button>
                    <button onClick={() => applyDatePreset("all")} className={`px-2 py-1 rounded-md text-[10px] font-medium ${inputBg} ${mutedText}`}>
                      All dates
                    </button>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      onClick={() => {
                        setDateStart("");
                        setDateEnd("");
                      }}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium border ${border} ${mutedText}`}
                    >
                      Clear
                    </button>
                    <button
                      onClick={() => setDateOpen(false)}
                      className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setFilterOpen((v) => !v);
                setDateOpen(false);
              }}
              className={`w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium shadow-sm ${card} ${mutedText} ${
                activeFilterCount ? "ring-2 ring-violet-500/40" : ""
              }`}
            >
              <Filter size={13} />
              Filter
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-violet-600 text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setFilterOpen(false)} />
                <div className={`absolute right-0 left-auto top-full mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-lg shadow-xl z-50 p-4 space-y-3 ${card} border ${border}`}>
                  <div>
                    <label className={`block text-[10px] font-medium mb-1 ${mutedText}`}>Amount range (PKR)</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        min="0"
                        placeholder="Min"
                        value={amountMin}
                        onChange={(e) => setAmountMin(e.target.value)}
                        className={`w-full rounded-md px-2 py-1.5 text-xs outline-none border ${inputBg} ${border} ${cardText}`}
                      />
                      <input
                        type="number"
                        min="0"
                        placeholder="Max"
                        value={amountMax}
                        onChange={(e) => setAmountMax(e.target.value)}
                        className={`w-full rounded-md px-2 py-1.5 text-xs outline-none border ${inputBg} ${border} ${cardText}`}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      onClick={() => {
                        clearAllFilters();
                        setFilterOpen(false);
                      }}
                      className={`px-3 py-1.5 rounded-md text-[11px] font-medium border ${border} ${mutedText}`}
                    >
                      Reset all filters
                    </button>
                    <button
                      onClick={() => setFilterOpen(false)}
                      className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600"
                    >
                      Apply
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            onClick={exportPdf}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium shadow-sm ${card} ${mutedText}`}
          >
            <Download size={13} />
            Export PDF
          </button>
          <button
            onClick={openAdd}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3 py-2 sm:py-1.5 text-xs font-medium shadow-sm"
          >
            <Plus size={13} />
            Add Income
          </button>
        </div>
      </div>

      {saveError && (
        <div className="rounded-lg px-3 py-2 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
          Couldn't reach the server right now — check your connection and try again.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 sm:gap-4">
        {STAT_CARD_DEFS.map(({ key, label, value, delta, up, note, icon: Icon, tint, tab }) => (
          <button
            key={key}
            onClick={() => goStatCard(tab)}
            className={`text-left rounded-xl p-3.5 sm:p-4 shadow-sm ${card} hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer ${
              activeTab === tab ? "ring-2 ring-violet-500/40" : ""
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center shrink-0 ${TINTS[tint]}`}>
                <Icon size={16} />
              </span>
              <span className={`text-[11px] sm:text-xs font-medium ${mutedText}`}>{label}</span>
            </div>
            <p className={`text-base sm:text-lg lg:text-xl font-bold mt-3 ${headingText} truncate`}>{fmt(value)}</p>
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${up ? "text-emerald-500" : "text-rose-500"}`}>
                {up ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                {delta}
              </span>
              <span className={`text-[10px] ${subtleText} truncate`}>{note}</span>
            </div>
          </button>
        ))}
      </div>

        {/* Table + sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
          {/* Left: tabs, filters, table */}
          <div ref={tableRef} className={`rounded-xl shadow-sm overflow-hidden ${card} scroll-mt-4`}>
            <div className={`flex items-center gap-4 sm:gap-5 px-3 sm:px-4 pt-3 border-b overflow-x-auto ${border}`}>
              {TABS.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`pb-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab ? "border-violet-600 text-violet-600" : `border-transparent ${mutedText} hover:text-violet-500`
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 px-3 sm:px-4 py-3 flex-wrap">
              <div className={`flex items-center gap-2 rounded-lg px-3 py-2 flex-1 min-w-[140px] ${inputBg}`}>
                <Search size={13} className={subtleText} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search income..."
                  className={`flex-1 bg-transparent outline-none text-xs placeholder:text-slate-400 min-w-0 ${cardText}`}
                />
              </div>

              <div className="relative">
                <button
                  onClick={() => {
                    setProjectOpen((v) => !v);
                    setMethodOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${inputBg} ${mutedText}`}
                >
                  <span className="max-w-[110px] sm:max-w-none truncate">{projectFilter}</span>
                  <ChevronDown size={12} className={`transition-transform shrink-0 ${projectOpen ? "rotate-180" : ""}`} />
                </button>
                {projectOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProjectOpen(false)} />
                    <div className={`absolute right-0 top-full mt-1.5 w-56 max-h-64 overflow-y-auto rounded-lg shadow-xl z-50 ${card}`}>
                      {allProjects.map((p) => (
                        <button
                          key={p}
                          onClick={() => {
                            setProjectFilter(p);
                            setProjectOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-[11px] font-medium transition-colors ${
                            p === projectFilter ? "bg-violet-600 text-white" : `${mutedText} ${hoverRow}`
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="relative">
                <button
                  onClick={() => {
                    setMethodOpen((v) => !v);
                    setProjectOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${inputBg} ${mutedText}`}
                >
                  <span className="max-w-[110px] sm:max-w-none truncate">{methodFilter}</span>
                  <ChevronDown size={12} className={`transition-transform shrink-0 ${methodOpen ? "rotate-180" : ""}`} />
                </button>
                {methodOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMethodOpen(false)} />
                    <div className={`absolute right-0 top-full mt-1.5 w-48 rounded-lg shadow-xl z-50 ${card}`}>
                      {allMethods.map((m) => (
                        <button
                          key={m}
                          onClick={() => {
                            setMethodFilter(m);
                            setMethodOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-[11px] font-medium transition-colors ${
                            m === methodFilter ? "bg-violet-600 text-white" : `${mutedText} ${hoverRow}`
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Desktop / tablet table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs min-w-[820px]">
                <thead>
                  <tr className={`border-t border-b ${border}`}>
                    {["Date", "Description", "Project", "Client", "Amount", "Method", "Status", "Received On", "Actions"].map((h) => (
                      <th key={h} className={`text-left font-semibold px-4 py-2.5 whitespace-nowrap ${mutedText}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((e) => (
                    <tr key={e.id} className={`border-b last:border-b-0 transition-colors ${border} ${hoverRow}`}>
                      <td className={`px-4 py-3 whitespace-nowrap ${mutedText}`}>{e.date}</td>
                      <td className={`px-4 py-3 font-medium max-w-[220px] truncate ${cardText}`}>{e.desc}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button onClick={() => goProject(e.project)} className="text-violet-600 font-medium hover:underline">
                          {e.project}
                        </button>
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap ${mutedText}`}>{e.client}</td>
                      <td className={`px-4 py-3 font-semibold whitespace-nowrap ${cardText}`}>{fmt(e.amount)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 ${mutedText}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${METHOD_DOT[e.method]}`} />
                          {e.method}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[10.5px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                      </td>
                      <td className={`px-4 py-3 whitespace-nowrap ${mutedText}`}>{e.receivedOn}</td>
                      <td className="px-4 py-3">
                        <ActionMenu
                          theme={theme}
                          open={openMenuId === e.id}
                          onToggle={() => setOpenMenuId(openMenuId === e.id ? null : e.id)}
                          onEdit={() => openEdit(e)}
                          onDelete={() => {
                            setConfirmDeleteId(e.id);
                            setOpenMenuId(null);
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                  {paginated.length === 0 && (
                    <tr>
                      <td colSpan={9} className={`px-4 py-10 text-center ${subtleText}`}>
                        No income entries match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className={`md:hidden divide-y ${border}`}>
              {paginated.map((e) => (
                <div key={e.id} className={`p-4 space-y-2.5 ${hoverRow}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${cardText}`}>{e.desc}</p>
                      <button onClick={() => goProject(e.project)} className="text-[11px] text-violet-600 font-medium hover:underline">
                        {e.project}
                      </button>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLES[e.status]}`}>{e.status}</span>
                      <ActionMenu
                        theme={theme}
                        open={openMenuId === e.id}
                        onToggle={() => setOpenMenuId(openMenuId === e.id ? null : e.id)}
                        onEdit={() => openEdit(e)}
                        onDelete={() => {
                          setConfirmDeleteId(e.id);
                          setOpenMenuId(null);
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className={mutedText}>{e.client}</span>
                    <span className={`font-bold ${cardText}`}>{fmt(e.amount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className={`inline-flex items-center gap-1.5 ${mutedText}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${METHOD_DOT[e.method]}`} />
                      {e.method}
                    </span>
                    <span className={mutedText}>{e.date}</span>
                  </div>
                </div>
              ))}
              {paginated.length === 0 && <div className={`px-4 py-10 text-center text-xs ${subtleText}`}>No income entries match these filters.</div>}
            </div>

            <div className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t ${border}`}>
              <p className={`text-[11px] ${subtleText}`}>
                Showing {startIdx} to {endIdx} of {filtered.length} entries
              </p>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className={`w-7 h-7 rounded-md flex items-center justify-center border ${border} ${subtleText} disabled:opacity-40`}
                  >
                    ‹
                  </button>
                  <span className="px-2 h-7 rounded-md flex items-center justify-center bg-violet-600 text-white text-[11px] font-semibold whitespace-nowrap">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className={`w-7 h-7 rounded-md flex items-center justify-center border ${border} ${subtleText} disabled:opacity-40`}
                  >
                    ›
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] ${subtleText}`}>Rows</span>
                  <select
                    value={rowsPerPage}
                    onChange={(e) => setRowsPerPage(Number(e.target.value))}
                    className={`text-[11px] font-medium rounded-md px-1.5 py-1 outline-none ${inputBg} ${mutedText}`}
                  >
                    {[10, 25, 50].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            {/* Income Overview donut */}
            <div className={`rounded-xl p-4 shadow-sm ${card}`}>
              <h3 className={`font-semibold text-sm ${cardText}`}>Income Overview</h3>
              <div className="flex items-center gap-4 mt-2">
                <div className="relative w-[110px] h-[110px] sm:w-[120px] sm:h-[120px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={overviewSlices.filter((s) => s.value > 0)}
                        dataKey="value"
                        innerRadius={36}
                        outerRadius={52}
                        paddingAngle={2}
                        startAngle={90}
                        endAngle={-270}
                      >
                        {overviewSlices.filter((s) => s.value > 0).map((s) => (
                          <Cell key={s.key} fill={s.color} stroke="none" />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-xs font-bold leading-tight ${headingText}`}>PKR</span>
                    <span className={`text-sm font-bold leading-tight ${headingText}`}>{stats.total.toLocaleString()}</span>
                    <span className={`text-[9px] ${subtleText}`}>Total Income</span>
                  </div>
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                  {overviewSlices.map((s) => (
                    <button key={s.key} onClick={() => goStatCard(s.key)} className="flex items-center gap-1.5 text-[11px] w-full text-left">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className={mutedText}>{s.key}</span>
                      <span className={`ml-auto font-semibold whitespace-nowrap ${cardText}`}>
                        {fmt(s.value)} ({s.pct}%)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Income by Project */}
            <div className={`rounded-xl p-4 shadow-sm ${card}`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold text-sm ${cardText}`}>Income by Project</h3>
                <button onClick={() => setViewAllModal("project")} className="text-[11px] font-semibold text-violet-600 hover:underline">
                  View All
                </button>
              </div>
              <div className="mt-3 space-y-2.5">
                {projectBreakdown.slice(0, 5).map((p) => (
                  <button key={p.name} onClick={() => goProject(p.name)} className="flex items-center gap-2 text-[11px] w-full text-left">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
                    <span className={`flex-1 min-w-0 truncate ${mutedText}`}>{p.name}</span>
                    <span className={`font-semibold whitespace-nowrap ${cardText}`}>
                      {fmt(p.amount)} ({p.pct}%)
                    </span>
                  </button>
                ))}
                <div className={`flex items-center justify-between pt-2 mt-2 border-t text-xs font-bold ${border} ${headingText}`}>
                  <span>Total</span>
                  <span>{fmt(stats.total)}</span>
                </div>
              </div>
            </div>

            {/* Recent Incomes */}
            <div className={`rounded-xl p-4 shadow-sm ${card}`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold text-sm ${cardText}`}>Recent Incomes</h3>
                <button onClick={() => setViewAllModal("recent")} className="text-[11px] font-semibold text-violet-600 hover:underline">
                  View All
                </button>
              </div>
              <div className="mt-3 space-y-3">
                {recentIncomes.map((e) => (
                  <button key={e.id} onClick={() => goRecent(e)} className="flex items-start gap-2.5 w-full text-left">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${e.status === "Received" ? "bg-emerald-500" : e.status === "Pending" ? "bg-amber-500" : "bg-rose-500"}`} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11.5px] font-semibold truncate ${cardText}`}>{e.desc}</p>
                      <p className={`text-[10.5px] ${subtleText}`}>{e.client}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-[11.5px] font-bold ${cardText}`}>{fmt(e.amount)}</p>
                      <p className={`text-[9.5px] ${subtleText}`}>{e.date}</p>
                    </div>
                  </button>
                ))}
                {recentIncomes.length === 0 && <p className={`text-[11px] ${subtleText}`}>No income entries yet.</p>}
              </div>
            </div>
          </div>
        </div>

      {/* Add / Edit modal */}
      {formOpen && (
        <IncomeFormModal
          key={editEntry ? editEntry.id : "new"}
          theme={theme}
          initialEntry={editEntry}
          projectOptions={projectOptions}
          onClose={() => {
            setFormOpen(false);
            setEditEntry(null);
          }}
          onSubmit={handleFormSubmit}
        />
      )}

      {/* Delete confirmation */}
      {confirmDeleteId != null && (
        <Modal title="Delete Income Entry" onClose={() => setConfirmDeleteId(null)} theme={theme} maxWidth="max-w-sm">
          <p className={`text-sm ${mutedText}`}>Are you sure you want to delete this income entry? This action can't be undone.</p>
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-5">
            <button onClick={() => setConfirmDeleteId(null)} className={`px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold border ${border} ${mutedText}`}>
              Cancel
            </button>
            <button onClick={() => handleDelete(confirmDeleteId)} className="px-4 py-2.5 sm:py-2 rounded-lg text-xs font-semibold text-white bg-rose-600">
              Delete
            </button>
          </div>
        </Modal>
      )}

      {/* View All: Income by Project */}
      {viewAllModal === "project" && (
        <Modal title="Income by Project — Full Breakdown" onClose={() => setViewAllModal(null)} theme={theme} maxWidth="max-w-lg">
          <div className="space-y-3">
            {projectBreakdown.map((p) => (
              <div key={p.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className={`font-medium ${cardText}`}>{p.name}</span>
                  <span className={mutedText}>{fmt(p.amount)} ({p.pct}%)</span>
                </div>
                <div className={`h-2 rounded-full overflow-hidden ${inputBg}`}>
                  <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                </div>
              </div>
            ))}
            {projectBreakdown.length === 0 && <p className={`text-xs ${subtleText}`}>No projects yet.</p>}
            <div className={`flex items-center justify-between pt-3 mt-1 border-t text-sm font-bold ${border} ${headingText}`}>
              <span>Total</span>
              <span>{fmt(stats.total)}</span>
            </div>
          </div>
        </Modal>
      )}

      {/* View All: Recent Incomes (full history) */}
      {viewAllModal === "recent" && (
        <Modal title="All Income Entries" onClose={() => setViewAllModal(null)} theme={theme} maxWidth="max-w-xl">
          <div className={`divide-y ${border} -mx-5`}>
            {[...entries]
              .sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate))
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setViewAllModal(null);
                    goRecent(e);
                  }}
                  className={`w-full flex items-start gap-3 px-5 py-3 text-left ${hoverRow}`}
                >
                  <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${e.status === "Received" ? "bg-emerald-500" : e.status === "Pending" ? "bg-amber-500" : "bg-rose-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-semibold truncate ${cardText}`}>{e.desc}</p>
                    <p className={`text-[10.5px] ${subtleText}`}>{e.client} · {e.project}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-xs font-bold ${cardText}`}>{fmt(e.amount)}</p>
                    <p className={`text-[9.5px] ${subtleText}`}>{e.date}</p>
                  </div>
                </button>
              ))}
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:right-4 sm:translate-x-0 z-[80]">
          <div className="bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl">{toast}</div>
        </div>
      )}
    </div>
  );
}