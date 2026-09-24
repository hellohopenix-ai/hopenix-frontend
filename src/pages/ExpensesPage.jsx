import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  ChevronDown,
  Download,
  Plus,
  Filter,
  RotateCcw,
  Fuel,
  Utensils,
  Wifi,
  Package,
  Plane,
  Megaphone,
  FileText,
  Upload,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Info,
  ArrowRight,
  X,
  Pencil,
  Trash2,
  Calendar,
} from "lucide-react";
import {
  fetchExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  uploadReceipt,
  removeReceipt,
} from "../expensesApi"; // expensesApi.js lives at src/ root — adjust this path if you move it

/* ------------------------------------------------------------------ */
/*  Category / payment / status display metadata                        */
/* ------------------------------------------------------------------ */

const CATEGORY_META = {
  Transport: { icon: Fuel, bg: "bg-orange-50", text: "text-orange-500", chip: "bg-orange-50 text-orange-600" },
  Meals: { icon: Utensils, bg: "bg-amber-50", text: "text-amber-500", chip: "bg-amber-50 text-amber-600" },
  Utilities: { icon: Wifi, bg: "bg-sky-50", text: "text-sky-500", chip: "bg-sky-50 text-sky-600" },
  Office: { icon: Package, bg: "bg-rose-50", text: "text-rose-500", chip: "bg-rose-50 text-rose-600" },
  Travel: { icon: Plane, bg: "bg-emerald-50", text: "text-emerald-500", chip: "bg-emerald-50 text-emerald-600" },
  Marketing: { icon: Megaphone, bg: "bg-violet-50", text: "text-violet-500", chip: "bg-violet-50 text-violet-600" },
  Software: { icon: FileText, bg: "bg-indigo-50", text: "text-indigo-500", chip: "bg-indigo-50 text-indigo-600" },
};

const PAYMENT_STYLES = {
  Cash: "bg-slate-100 text-slate-600",
  Card: "bg-blue-50 text-blue-600",
  "Bank Transfer": "bg-violet-50 text-violet-600",
  "Cash in Hand": "bg-teal-50 text-teal-600",
};

const STATUS_STYLES = {
  Approved: "bg-emerald-50 text-emerald-600",
  Pending: "bg-amber-50 text-amber-600",
  Rejected: "bg-rose-50 text-rose-600",
};

const PAGE_SIZE = 7;
const CATEGORIES_STORAGE_KEY = "expenses_custom_categories_v1";

function loadStoredCategories() {
  try {
    const raw = window.localStorage.getItem(CATEGORIES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (e) {
    /* ignore corrupt storage, fall back to none */
  }
  return [];
}

function persistCategories(list) {
  try {
    window.localStorage.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    /* storage full/unavailable — fail silently, app still works in-memory */
  }
}

function emptyForm() {
  return {
    title: "",
    category: "Transport",
    project: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    payment: "Cash",
    status: "Pending",
    receiptType: "upload",
    receiptFile: null, // a real File picked in this session, not yet uploaded
    receiptUrl: null, // existing server file (when editing), until removed
    receiptName: "",
    receiptRemove: false, // true = user cleared an existing server receipt
  };
}

function formatDisplayDate(isoDate) {
  const d = isoDate ? new Date(isoDate) : new Date();
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function toInputDate(displayDate) {
  const d = new Date(displayDate);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function normalizeExpense(e) {
  // DRF sends DecimalField amounts as strings ("5000.00") — every total/
  // sum below (totalAmount, categoryTotals, row.amount.toLocaleString(),
  // etc.) needs a real number, not a string, or "+" silently concatenates.
  return { ...e, amount: Number(e.amount) };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function StatIcon({ icon }) {
  const wrap = "w-11 h-11 rounded-xl flex items-center justify-center shrink-0";
  if (icon === "money") return <span className={`${wrap} bg-violet-50 text-violet-600`}><Sparkles size={18} /></span>;
  if (icon === "calendar") return <span className={`${wrap} bg-emerald-50 text-emerald-600`}><FileText size={18} /></span>;
  if (icon === "hourglass") return <span className={`${wrap} bg-amber-50 text-amber-600`}><Package size={18} /></span>;
  return <span className={`${wrap} bg-sky-50 text-sky-600`}><FileText size={18} /></span>;
}

function ReceiptCell({ expense, darkMode, onUpload, onView }) {
  const inputRef = useRef(null);
  const hasFile = !!expense.receiptUrl;
  const type = expense.receiptType;

  const openPicker = () => inputRef.current?.click();
  const onChange = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload?.(file);
    e.target.value = "";
  };

  const handleMainClick = () => {
    if (hasFile) onView?.(expense);
    else openPicker();
  };

  const replaceBadge = hasFile && (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openPicker();
      }}
      title="Replace receipt"
      className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center border ${darkMode ? "bg-slate-700 border-slate-600 text-slate-300" : "bg-white border-slate-200 text-slate-500"}`}
    >
      <Pencil size={8} />
    </button>
  );

  const hiddenInput = <input ref={inputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={onChange} />;

  if (type === "image") {
    return (
      <div className="relative inline-block">
        <button
          onClick={handleMainClick}
          title={hasFile ? "View receipt" : "Upload receipt"}
          className={`w-9 h-9 rounded-lg border flex items-center justify-center overflow-hidden ${darkMode ? "border-slate-700 bg-slate-800" : "border-slate-200 bg-slate-50"}`}
        >
          <FileText size={14} className={hasFile ? "text-emerald-500" : darkMode ? "text-slate-500" : "text-slate-300"} />
        </button>
        {hiddenInput}
        {replaceBadge}
      </div>
    );
  }
  if (type === "pdf") {
    return (
      <div className="relative inline-block">
        <button onClick={handleMainClick} title={hasFile ? "View receipt" : "Upload receipt"} className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center">
          <FileText size={15} className="text-rose-500" />
        </button>
        {hiddenInput}
        {replaceBadge}
      </div>
    );
  }
  return (
    <div className="relative inline-block">
      <button
        onClick={handleMainClick}
        title="Upload receipt"
        className={`w-9 h-9 rounded-lg border border-dashed flex items-center justify-center ${darkMode ? "border-slate-700 text-slate-500 hover:border-violet-500" : "border-slate-300 text-slate-400 hover:border-violet-400 hover:text-violet-500"} transition-colors`}
      >
        <Upload size={13} />
      </button>
      {hiddenInput}
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

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function ExpensesPage({ darkMode }) {
  const [expenses, setExpenses] = useState([]);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [customCategories, setCustomCategories] = useState(loadStoredCategories);
  const [page, setPage] = useState(1);

  // filters
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All Categories");
  const [projectFilter, setProjectFilter] = useState("All Projects");
  const [paymentFilter, setPaymentFilter] = useState("All Payment Methods");
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // add / edit modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [addingCustomCategory, setAddingCustomCategory] = useState(false);

  // row actions + categories modal
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  const containerRef = useRef(null);
  // Scroll target for the stat cards above the filters — clicking one
  // applies its filter and smooth-scrolls the expense list into view
  // (mainly useful on mobile, where the list sits below the stat cards).
  const expensesListRef = useRef(null);
  const scrollToExpensesList = () => {
    setTimeout(() => expensesListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const headingText = darkMode ? "text-white" : "text-slate-900";
  const border = darkMode ? "border-slate-800" : "border-slate-100";

  /* load expenses from the real backend (Postgres via the Django API) */
  async function reloadExpenses() {
    try {
      setLoadError("");
      const data = await fetchExpenses();
      setExpenses(Array.isArray(data) ? data.map(normalizeExpense) : []);
    } catch (err) {
      setLoadError(err.message || "Could not load expenses.");
    } finally {
      setLoadingExpenses(false);
    }
  }

  useEffect(() => {
    reloadExpenses();
  }, []);

  /* persist any change to manually-added categories */
  useEffect(() => {
    persistCategories(customCategories);
  }, [customCategories]);

  /* close the 3-dot menu on outside click */
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
  }, [search, categoryFilter, projectFilter, paymentFilter, statusFilter, dateFrom, dateTo]);

  const allCategoryNames = [...Object.keys(CATEGORY_META), ...customCategories];
  const categoryOptions = ["All Categories", ...allCategoryNames];
  const projectOptions = ["All Projects", ...Array.from(new Set(expenses.map((e) => e.project))).sort()];
  const paymentOptions = ["All Payment Methods", ...Object.keys(PAYMENT_STYLES)];
  const statusOptions = ["All Statuses", ...Object.keys(STATUS_STYLES)];

  const filteredExpenses = useMemo(() => {
    return expenses.filter((row) => {
      if (categoryFilter !== "All Categories" && row.category !== categoryFilter) return false;
      if (projectFilter !== "All Projects" && row.project !== projectFilter) return false;
      if (paymentFilter !== "All Payment Methods" && row.payment !== paymentFilter) return false;
      if (statusFilter !== "All Statuses" && row.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (!row.title.toLowerCase().includes(q) && !row.project.toLowerCase().includes(q)) return false;
      }
      if (dateFrom) {
        const d = new Date(row.date);
        if (d < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const d = new Date(row.date);
        if (d > new Date(dateTo + "T23:59:59")) return false;
      }
      return true;
    });
  }, [expenses, categoryFilter, projectFilter, paymentFilter, statusFilter, search, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filteredExpenses.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredExpenses.slice(start, start + PAGE_SIZE);
  }, [filteredExpenses, safePage]);

  const pageNumbers = useMemo(() => {
    const nums = [1, 2, 3].filter((n) => n <= totalPages);
    if (totalPages > 3) nums.push("...", totalPages);
    return nums;
  }, [totalPages]);

  /* ---- derived stats (always from the full data set, not filtered) ---- */
  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0);
  const pendingRows = expenses.filter((e) => e.status === "Pending");
  const pendingAmount = pendingRows.reduce((s, e) => s + e.amount, 0);
  const categoriesCount = new Set(expenses.map((e) => e.category)).size;

  const categoryTotals = useMemo(() => {
    const totals = {};
    expenses.forEach((e) => {
      totals[e.category] = (totals[e.category] || 0) + e.amount;
    });
    const total = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(totals)
      .map(([name, amount]) => ({ name, amount, pct: Math.round((amount / total) * 100) }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses]);
  const topCategories = categoryTotals.slice(0, 5);

  const approvedSum = expenses.filter((e) => e.status === "Approved").reduce((s, e) => s + e.amount, 0);
  const rejectedSum = expenses.filter((e) => e.status === "Rejected").reduce((s, e) => s + e.amount, 0);

  const STAT_CARDS = [
    { key: "total", label: "Total Expenses", value: `PKR ${totalAmount.toLocaleString()}`, note: "All time", isNote: true, icon: "money" },
    { key: "month", label: "This Month", value: `PKR ${totalAmount.toLocaleString()}`, note: "May 2025", isNote: true, icon: "calendar" },
    { key: "pending", label: "Pending Approval", value: `PKR ${pendingAmount.toLocaleString()}`, note: `${pendingRows.length} Expenses`, isNote: true, icon: "hourglass" },
    { key: "categories", label: "Total Categories", value: String(categoriesCount), note: "Tap to view all", isNote: true, icon: "categories" },
  ];

  function handleStatClick(key) {
    if (key === "total" || key === "month") {
      handleReset();
      scrollToExpensesList();
    } else if (key === "pending") {
      handleReset();
      setStatusFilter("Pending");
      scrollToExpensesList();
    } else if (key === "categories") {
      setShowCategoriesModal(true);
    }
  }

  function handleReset() {
    setSearch("");
    setCategoryFilter("All Categories");
    setProjectFilter("All Projects");
    setPaymentFilter("All Payment Methods");
    setStatusFilter("All Statuses");
    setDateFrom("");
    setDateTo("");
    setPage(1);
  }

  function openAddModal() {
    setEditingId(null);
    setForm(emptyForm());
    setAddingCustomCategory(false);
    setShowAddModal(true);
  }

  function openEditModal(row) {
    setAddingCustomCategory(false);
    setForm({
      title: row.title,
      category: row.category,
      project: row.project,
      amount: String(row.amount),
      date: toInputDate(row.date),
      payment: row.payment,
      status: row.status,
      receiptType: row.receiptType || "upload",
      receiptFile: null,
      receiptUrl: row.receiptUrl || null,
      receiptName: row.receiptName || "",
      receiptRemove: false,
    });
    setEditingId(row.id);
    setShowAddModal(true);
    setOpenMenuId(null);
  }

  async function handleDelete(id) {
    setOpenMenuId(null);
    try {
      await deleteExpense(id);
      setExpenses((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      alert(err.message || "Could not delete this expense.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const categoryName = form.category.trim();
    if (!form.title.trim() || !form.amount || Number(form.amount) <= 0 || !categoryName) return;

    /* if this category was typed in manually and isn't known yet, remember it
       so it shows up in the dropdown/filters from now on */
    if (!CATEGORY_META[categoryName] && !customCategories.includes(categoryName)) {
      setCustomCategories((prev) => [...prev, categoryName]);
    }

    const payload = {
      title: form.title.trim(),
      category: categoryName,
      project: form.project.trim() || "Office",
      amount: Number(form.amount),
      date: form.date, // already "YYYY-MM-DD" from the <input type="date">
      payment: form.payment,
      status: form.status,
    };

    try {
      let saved = editingId ? await updateExpense(editingId, payload) : await createExpense(payload);

      // receipt is a separate upload step, since it needs the expense's id
      if (form.receiptFile) {
        saved = await uploadReceipt(saved.id, form.receiptFile);
      } else if (form.receiptRemove && editingId) {
        saved = await removeReceipt(saved.id);
      }
      saved = normalizeExpense(saved);

      setExpenses((prev) =>
        editingId ? prev.map((x) => (x.id === editingId ? saved : x)) : [saved, ...prev]
      );

      setShowAddModal(false);
      setEditingId(null);
      setAddingCustomCategory(false);
      setForm(emptyForm());
      setPage(1);
    } catch (err) {
      alert(err.message || "Could not save this expense.");
    }
  }

  function handleFormReceiptChange(file) {
    if (!file) return;
    const type = file.type === "application/pdf" ? "pdf" : "image";
    setForm((f) => ({ ...f, receiptType: type, receiptFile: file, receiptUrl: null, receiptName: file.name, receiptRemove: false }));
  }

  function handleFormReceiptClear() {
    setForm((f) => ({ ...f, receiptType: "upload", receiptFile: null, receiptUrl: null, receiptName: "", receiptRemove: true }));
  }

  async function handleReceiptUpload(id, file) {
    try {
      const saved = await uploadReceipt(id, file);
      setExpenses((prev) => prev.map((x) => (x.id === id ? normalizeExpense(saved) : x)));
    } catch (err) {
      alert(err.message || "Could not upload this receipt.");
    }
  }

  function handleReceiptView(expense) {
    // works for both a row (expense.receiptUrl) and the in-progress form
    // (form.receiptUrl for an existing server file, or a freshly picked
    // form.receiptFile that hasn't been uploaded yet)
    if (expense.receiptFile) {
      const url = URL.createObjectURL(expense.receiptFile);
      const win = window.open(url, "_blank");
      if (!win) alert("Please allow pop-ups to view the receipt.");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    if (!expense.receiptUrl) return;
    const win = window.open(expense.receiptUrl, "_blank");
    if (!win) alert("Please allow pop-ups to view the receipt.");
  }

  function handleExport() {
    if (!filteredExpenses.length) {
      alert("No expenses to export.");
      return;
    }

    const rowsHtml = filteredExpenses
      .map(
        (r) => `
          <tr>
            <td>${escapeHtml(r.title)}</td>
            <td>${escapeHtml(r.category)}</td>
            <td>${escapeHtml(r.project)}</td>
            <td class="num">PKR ${Number(r.amount).toLocaleString()}</td>
            <td>${escapeHtml(formatDisplayDate(r.date))}</td>
            <td>${escapeHtml(r.payment)}</td>
            <td>${escapeHtml(r.status)}</td>
          </tr>`
      )
      .join("");

    const total = filteredExpenses.reduce((s, r) => s + Number(r.amount), 0);
    const generatedOn = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) {
      alert("Please allow pop-ups to export as PDF");
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Expenses Report</title>
          <style>
            * { box-sizing: border-box; }
            body { font-family: Arial, Helvetica, sans-serif; color: #1e293b; padding: 32px; }
            h1 { font-size: 20px; margin: 0 0 4px; }
            .meta { font-size: 11px; color: #64748b; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 11px; }
            th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: left; }
            th { background: #f8fafc; font-weight: 700; }
            td.num, th.num { text-align: right; }
            .summary { margin-top: 18px; font-size: 12px; font-weight: 700; }
            @media print {
              body { padding: 12px; }
            }
          </style>
        </head>
        <body>
          <h1>Expenses Report</h1>
          <div class="meta">Generated on ${escapeHtml(generatedOn)} &middot; ${filteredExpenses.length} entries</div>
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Category</th>
                <th>Project</th>
                <th class="num">Amount</th>
                <th>Date</th>
                <th>Payment Method</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <div class="summary">Total: PKR ${total.toLocaleString()}</div>
        </body>
      </html>
    `);
    printWindow.document.close();

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
    };
    printWindow.onafterprint = () => printWindow.close();
  }

  return (
    <div className="space-y-4 overflow-x-hidden" ref={containerRef}>
      {/* Header row */}
      <div className="flex items-center justify-end gap-2 flex-wrap">
        <button
          onClick={handleExport}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm ${card} ${mutedText}`}
        >
          <Download size={13} />
          Export PDF
        </button>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
        >
          <Plus size={14} />
          Add Expense
        </button>
      </div>

      {loadingExpenses && (
        <p className={`text-xs ${mutedText}`}>Loading expenses…</p>
      )}
      {!loadingExpenses && loadError && (
        <div className={`rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2 ${darkMode ? "bg-rose-950/40 text-rose-300" : "bg-rose-50 text-rose-600"}`}>
          <span>{loadError}</span>
          <button onClick={reloadExpenses} className="font-semibold underline shrink-0">Retry</button>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {STAT_CARDS.map((s) => (
          <button
            key={s.label}
            onClick={() => handleStatClick(s.key)}
            className={`text-left rounded-xl p-3 sm:p-4 shadow-sm flex items-center gap-3 min-w-0 ${card} hover:ring-2 hover:ring-violet-200 transition-shadow ${
              (s.key === "pending" && statusFilter === "Pending") ? "ring-2 ring-violet-400" : ""
            }`}
          >
            <StatIcon icon={s.icon} />
            <div className="min-w-0">
              <p className={`text-[11px] sm:text-xs font-medium ${mutedText}`}>{s.label}</p>
              <p className={`text-base sm:text-xl font-bold mt-0.5 truncate ${headingText}`}>{s.value}</p>
              <p className={`text-[10px] sm:text-[10.5px] mt-1 ${subtleText}`}>{s.note}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 sm:hidden">
          <button
            onClick={() => setShowMobileFilters((v) => !v)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm ${card} ${mutedText}`}
          >
            <Filter size={13} />
            Filters
            <ChevronDown size={12} className={`transition-transform ${showMobileFilters ? "rotate-180" : ""}`} />
          </button>
          <button
            onClick={handleReset}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm ${card} ${mutedText}`}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>

        <div className={`${showMobileFilters ? "flex" : "hidden"} sm:flex flex-wrap gap-2 items-center`}>
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 shadow-sm ${card}`}>
            <Search size={13} className={mutedText} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search expenses..."
              className={`bg-transparent text-xs outline-none w-28 sm:w-36 ${darkMode ? "placeholder:text-slate-500 text-slate-200" : "placeholder:text-slate-400 text-slate-700"}`}
            />
          </div>

          <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 shadow-sm ${card}`}>
            <Calendar size={13} className={mutedText} />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              aria-label="From date"
              className={`bg-transparent text-[11px] outline-none w-[104px] ${mutedText}`}
            />
            <span className={mutedText}>–</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              aria-label="To date"
              className={`bg-transparent text-[11px] outline-none w-[104px] ${mutedText}`}
            />
          </div>

          <FilterSelect value={categoryFilter} onChange={setCategoryFilter} options={categoryOptions} card={card} mutedText={mutedText} />
          <FilterSelect value={projectFilter} onChange={setProjectFilter} options={projectOptions} card={card} mutedText={mutedText} />
          <FilterSelect value={paymentFilter} onChange={setPaymentFilter} options={paymentOptions} card={card} mutedText={mutedText} />
          <FilterSelect value={statusFilter} onChange={setStatusFilter} options={statusOptions} card={card} mutedText={mutedText} />

          <button
            onClick={handleReset}
            className={`hidden sm:flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium shadow-sm ${card} ${mutedText}`}
          >
            <RotateCcw size={13} />
            Reset
          </button>
        </div>
      </div>

      {/* Table + right rail */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4 items-start">
        {/* Expenses list */}
        <div ref={expensesListRef} className={`rounded-xl shadow-sm min-w-0 ${card}`}>
          <div className="flex items-center justify-between px-4 pt-4 pb-3">
            <h3 className={`font-semibold text-sm ${cardText}`}>All Expenses</h3>
            <button
              onClick={() => setShowGuideModal(true)}
              className={`flex items-center gap-1.5 text-[10.5px] font-medium border rounded-md px-2.5 py-1.5 ${mutedText} ${darkMode ? "border-slate-700" : "border-slate-200"}`}
            >
              <Upload size={11} />
              <span className="hidden sm:inline">Upload Receipt Guide</span>
              <span className="sm:hidden">Guide</span>
              <Info size={11} className="opacity-60" />
            </button>
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[820px]">
              <thead>
                <tr className={`text-[10.5px] uppercase tracking-wide ${subtleText}`}>
                  {["#", "Title", "Category", "Project", "Amount", "Date", "Payment Method", "Receipt", "Status", "Actions"].map((h) => (
                    <th key={h} className={`px-4 py-2.5 font-semibold whitespace-nowrap ${border} border-b`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={10} className={`px-4 py-10 text-center text-xs ${mutedText}`}>
                      No expenses match these filters.
                    </td>
                  </tr>
                )}
                {pageRows.map((row, idx) => {
                  const meta = CATEGORY_META[row.category] || CATEGORY_META.Office;
                  const Icon = meta.icon;
                  return (
                    <tr key={row.id} className={`${darkMode ? "hover:bg-slate-800/50" : "hover:bg-slate-50"} transition-colors`}>
                      <td className={`px-4 py-3 text-xs ${mutedText} border-b ${border}`}>{(safePage - 1) * PAGE_SIZE + idx + 1}</td>
                      <td className={`px-4 py-3 border-b ${border}`}>
                        <div className="flex items-center gap-2.5">
                          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.bg} ${meta.text}`}>
                            <Icon size={14} />
                          </span>
                          <span className={`text-xs font-semibold whitespace-nowrap ${cardText}`}>{row.title}</span>
                        </div>
                      </td>
                      <td className={`px-4 py-3 border-b ${border}`}>
                        <span className={`text-[10.5px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${meta.chip}`}>{row.category}</span>
                      </td>
                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${mutedText} border-b ${border}`}>{row.project}</td>
                      <td className={`px-4 py-3 text-xs font-bold whitespace-nowrap ${cardText} border-b ${border}`}>PKR {row.amount.toLocaleString()}</td>
                      <td className={`px-4 py-3 text-xs whitespace-nowrap ${mutedText} border-b ${border}`}>{formatDisplayDate(row.date)}</td>
                      <td className={`px-4 py-3 border-b ${border}`}>
                        <span className={`text-[10.5px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${PAYMENT_STYLES[row.payment]}`}>{row.payment}</span>
                      </td>
                      <td className={`px-4 py-3 border-b ${border}`}>
                        <ReceiptCell expense={row} darkMode={darkMode} onUpload={(file) => handleReceiptUpload(row.id, file)} onView={handleReceiptView} />
                      </td>
                      <td className={`px-4 py-3 border-b ${border}`}>
                        <span className={`text-[10.5px] font-semibold px-2 py-1 rounded-full whitespace-nowrap ${STATUS_STYLES[row.status]}`}>{row.status}</span>
                      </td>
                      <td className={`px-4 py-3 border-b ${border} relative`}>
                        <button
                          onClick={() => setOpenMenuId(openMenuId === row.id ? null : row.id)}
                          className={`menu-trigger ${subtleText} hover:text-violet-500`}
                        >
                          <MoreVertical size={14} />
                        </button>
                        {openMenuId === row.id && (
                          <ActionsMenu
                            darkMode={darkMode}
                            onEdit={() => openEditModal(row)}
                            onDelete={() => handleDelete(row.id)}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile card list */}
          <div className={`md:hidden divide-y ${border}`}>
            {pageRows.length === 0 && (
              <p className={`px-4 py-10 text-center text-xs ${mutedText}`}>No expenses match these filters.</p>
            )}
            {pageRows.map((row) => {
              const meta = CATEGORY_META[row.category] || CATEGORY_META.Office;
              const Icon = meta.icon;
              return (
                <div key={row.id} className="p-4 flex items-start gap-3">
                  <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${meta.bg} ${meta.text}`}>
                    <Icon size={15} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold truncate ${cardText}`}>{row.title}</p>
                        <p className={`text-[11px] mt-0.5 truncate ${mutedText}`}>{row.project} · {formatDisplayDate(row.date)}</p>
                      </div>
                      <div className="relative shrink-0">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === row.id ? null : row.id)}
                          className={`menu-trigger ${subtleText} hover:text-violet-500 p-1`}
                        >
                          <MoreVertical size={16} />
                        </button>
                        {openMenuId === row.id && (
                          <ActionsMenu
                            darkMode={darkMode}
                            onEdit={() => openEditModal(row)}
                            onDelete={() => handleDelete(row.id)}
                          />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.chip}`}>{row.category}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${PAYMENT_STYLES[row.payment]}`}>{row.payment}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[row.status]}`}>{row.status}</span>
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      <span className={`text-sm font-bold ${cardText}`}>PKR {row.amount.toLocaleString()}</span>
                      <ReceiptCell expense={row} darkMode={darkMode} onUpload={(file) => handleReceiptUpload(row.id, file)} onView={handleReceiptView} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between px-4 py-3.5 flex-wrap gap-2">
            <p className={`text-[11px] ${subtleText}`}>
              Showing {filteredExpenses.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1} to{" "}
              {Math.min(safePage * PAGE_SIZE, filteredExpenses.length)} of {filteredExpenses.length} expenses
            </p>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
              >
                <ChevronLeft size={14} />
              </button>
              {pageNumbers.map((n, i) =>
                n === "..." ? (
                  <span key={`dots-${i}`} className={`text-xs px-1 ${subtleText}`}>…</span>
                ) : (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`w-7 h-7 rounded-lg text-xs font-semibold flex items-center justify-center transition-colors ${
                      n === safePage ? "bg-violet-600 text-white" : `${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`
                    }`}
                  >
                    {n}
                  </button>
                )
              )}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className={`w-7 h-7 rounded-lg flex items-center justify-center ${mutedText} ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {/* Expense Summary */}
          <div className={`rounded-xl p-4 shadow-sm ${card}`}>
            <div className="flex items-center justify-between">
              <h3 className={`font-semibold text-sm ${cardText}`}>Expense Summary</h3>
            </div>
            <div className="mt-3.5 flex items-center justify-between">
              <span className={`text-xs ${mutedText}`}>Total Expenses</span>
              <span className={`text-sm font-bold ${headingText}`}>PKR {totalAmount.toLocaleString()}</span>
            </div>
            <div className={`mt-3 pt-3 border-t space-y-2.5 ${border}`}>
              {[
                { label: "Approved", value: approvedSum, dot: "bg-emerald-500", status: "Approved" },
                { label: "Pending", value: pendingAmount, dot: "bg-amber-500", status: "Pending" },
                { label: "Rejected", value: rejectedSum, dot: "bg-rose-500", status: "Rejected" },
              ].map((r) => (
                <button
                  key={r.label}
                  onClick={() => {
                    handleReset();
                    setStatusFilter(r.status);
                  }}
                  className="flex items-center justify-between w-full hover:opacity-70 transition-opacity"
                >
                  <span className={`flex items-center gap-2 text-xs ${mutedText}`}>
                    <span className={`w-2 h-2 rounded-full ${r.dot}`} />
                    {r.label}
                  </span>
                  <span className={`text-xs font-semibold ${cardText}`}>PKR {r.value.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Top Categories */}
          <div className={`rounded-xl p-4 shadow-sm ${card}`}>
            <div className="flex items-center justify-between">
              <h3 className={`font-semibold text-sm ${cardText}`}>Top Categories</h3>
            </div>
            <div className="mt-3.5 space-y-3">
              {topCategories.map((c) => {
                const meta = CATEGORY_META[c.name] || CATEGORY_META.Office;
                const Icon = meta.icon;
                return (
                  <button
                    key={c.name}
                    onClick={() => {
                      handleReset();
                      setCategoryFilter(c.name);
                    }}
                    className="flex items-center gap-2.5 w-full text-left hover:opacity-80 transition-opacity"
                  >
                    <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${meta.bg} ${meta.text}`}>
                      <Icon size={12} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-xs font-medium truncate ${cardText}`}>{c.name}</span>
                        <span className={`text-[10.5px] ${mutedText} whitespace-nowrap`}>PKR {c.amount.toLocaleString()} · {c.pct}%</span>
                      </div>
                      <div className={`w-full h-1.5 rounded-full mt-1.5 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500" style={{ width: `${Math.min(100, c.pct * 3)}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowCategoriesModal(true)}
              className="mt-3.5 flex items-center gap-1 text-xs font-semibold text-violet-600 hover:text-violet-700"
            >
              View All Categories <ArrowRight size={12} />
            </button>
          </div>

          {/* Need Help */}
          <div className={`rounded-xl p-4 shadow-sm ${card}`}>
            <h3 className={`font-semibold text-sm ${cardText}`}>Need Help?</h3>
            <p className={`text-[11px] mt-1.5 leading-relaxed ${mutedText}`}>
              Upload clear receipt images or PDF for accurate record keeping.
            </p>
            <button
              onClick={() => setShowGuideModal(true)}
              className={`mt-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              View Upload Guide <Info size={12} className="opacity-60" />
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- Add / Edit Expense Modal ---------------- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className={`w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto ${darkMode ? "bg-slate-900" : "bg-white"}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
              <h3 className={`text-sm font-semibold ${cardText}`}>{editingId ? "Edit Expense" : "Add Expense"}</h3>
              <button onClick={() => setShowAddModal(false)} className={mutedText}>
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
              <div>
                <label className={`text-[11px] font-medium ${mutedText}`}>Title</label>
                <input
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="e.g. Petrol"
                  className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Category</label>
                  <select
                    value={addingCustomCategory ? "__add_new__" : form.category}
                    onChange={(e) => {
                      if (e.target.value === "__add_new__") {
                        setAddingCustomCategory(true);
                        setForm({ ...form, category: "" });
                      } else {
                        setAddingCustomCategory(false);
                        setForm({ ...form, category: e.target.value });
                      }
                    }}
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  >
                    {Object.keys(CATEGORY_META).map((c) => <option key={c} value={c}>{c}</option>)}
                    {customCategories.map((c) => <option key={c} value={c}>{c}</option>)}
                    <option value="__add_new__">+ Add New Category</option>
                  </select>
                  {addingCustomCategory && (
                    <input
                      required
                      autoFocus
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                      placeholder="Type category name"
                      className={`mt-2 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                    />
                  )}
                </div>
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Project</label>
                  <input
                    value={form.project}
                    onChange={(e) => setForm({ ...form, project: e.target.value })}
                    placeholder="e.g. Office"
                    list="project-options"
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  />
                  <datalist id="project-options">
                    {projectOptions.filter((p) => p !== "All Projects").map((p) => <option key={p} value={p} />)}
                  </datalist>
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
                    placeholder="5000"
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Payment Method</label>
                  <select
                    value={form.payment}
                    onChange={(e) => setForm({ ...form, payment: e.target.value })}
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  >
                    {Object.keys(PAYMENT_STYLES).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={`text-[11px] font-medium ${mutedText}`}>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className={`mt-1 w-full rounded-lg px-3 py-2 text-xs outline-none border ${darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-slate-50 border-slate-200 text-slate-700"}`}
                  >
                    {Object.keys(STATUS_STYLES).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={`text-[11px] font-medium ${mutedText}`}>Receipt (optional)</label>
                {form.receiptFile || form.receiptUrl ? (
                  <div className={`mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 border ${darkMode ? "bg-slate-800 border-slate-700" : "bg-slate-50 border-slate-200"}`}>
                    <span className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${form.receiptType === "pdf" ? "bg-rose-50 text-rose-500" : "bg-emerald-50 text-emerald-600"}`}>
                      <FileText size={14} />
                    </span>
                    <span className={`flex-1 min-w-0 text-xs truncate ${cardText}`}>{form.receiptName || "Receipt attached"}</span>
                    <button
                      type="button"
                      onClick={() => handleReceiptView({ receiptFile: form.receiptFile, receiptUrl: form.receiptUrl })}
                      className="text-[11px] font-semibold text-violet-600 hover:text-violet-700 shrink-0"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={handleFormReceiptClear}
                      className="text-[11px] font-semibold text-rose-500 hover:text-rose-600 shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <label
                    className={`mt-1 flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-xs font-medium border border-dashed cursor-pointer ${darkMode ? "border-slate-700 text-slate-400 hover:border-violet-500" : "border-slate-300 text-slate-500 hover:border-violet-400 hover:text-violet-500"} transition-colors`}
                  >
                    <Upload size={13} />
                    Upload receipt image or PDF
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFormReceiptChange(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className={`flex-1 rounded-lg py-2.5 text-xs font-semibold border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"
                >
                  {editingId ? "Save Changes" : "Add Expense"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- All Categories Modal ---------------- */}
      {showCategoriesModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className={`w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto ${darkMode ? "bg-slate-900" : "bg-white"}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
              <h3 className={`text-sm font-semibold ${cardText}`}>All Categories</h3>
              <button onClick={() => setShowCategoriesModal(false)} className={mutedText}>
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {categoryTotals.map((c) => {
                const meta = CATEGORY_META[c.name] || CATEGORY_META.Office;
                const Icon = meta.icon;
                return (
                  <button
                    key={c.name}
                    onClick={() => {
                      handleReset();
                      setCategoryFilter(c.name);
                      setShowCategoriesModal(false);
                      scrollToExpensesList();
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg p-2.5 text-left ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-50"}`}
                  >
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${meta.bg} ${meta.text}`}>
                      <Icon size={14} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${cardText}`}>{c.name}</span>
                        <span className={`text-xs font-bold ${cardText}`}>PKR {c.amount.toLocaleString()}</span>
                      </div>
                      <div className={`w-full h-1.5 rounded-full mt-1.5 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                        <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500" style={{ width: `${Math.min(100, c.pct * 3)}%` }} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Upload Guide Modal ---------------- */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4">
          <div className={`w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl ${darkMode ? "bg-slate-900" : "bg-white"}`}>
            <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
              <h3 className={`text-sm font-semibold ${cardText}`}>Upload Receipt Guide</h3>
              <button onClick={() => setShowGuideModal(false)} className={mutedText}>
                <X size={18} />
              </button>
            </div>
            <div className={`p-5 space-y-2 text-xs leading-relaxed ${mutedText}`}>
              <p>• Use clear, well-lit photos or scanned PDFs.</p>
              <p>• Make sure the amount, date, and vendor name are readable.</p>
              <p>• Tap the receipt icon on any expense to upload or replace it.</p>
              <p>• Accepted formats: JPG, PNG, PDF.</p>
            </div>
            <div className="px-5 pb-5">
              <button
                onClick={() => setShowGuideModal(false)}
                className="w-full rounded-lg py-2.5 text-xs font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}