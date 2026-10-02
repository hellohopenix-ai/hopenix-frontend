import React, { useRef, useState, useEffect, useContext, createContext } from "react";
import { useAuth } from "../AuthContext.jsx";
import { useBrand, DEFAULT_LOGO, uploadCompanyLogo, removeCompanyLogo } from "../brand.js";
import { ensurePushSubscribed, sendTestPush } from "../pushSubscription.js";
import PhoneNotificationHelp from "../components/PhoneNotificationHelp.jsx";
import {
  Settings as SettingsIcon,
  User,
  Users,
  Building2,
  FolderKanban,
  CheckSquare,
  DollarSign,
  Receipt,
  ShoppingBag,
  Bell,
  Shield,
  CreditCard,
  Upload,
  Camera,
  Check,
  HardDrive,
  Crown,
  Info,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  Search,
  X,
  Key,
  Smartphone,
  Monitor,
  LogOut,
  RefreshCw,
  Download,
  Calendar,
  Eye,
  EyeOff,
  Filter,
  ShieldCheck,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Static option lists                                                */
/* ------------------------------------------------------------------ */
const SETTINGS_NAV = [
  { id: "general", label: "General", desc: "Company details & basic settings", icon: SettingsIcon },
  { id: "profile", label: "Profile", desc: "Update your profile information", icon: User },
  { id: "users", label: "Users & Roles", desc: "Manage users and set permissions", icon: Users },
  { id: "departments", label: "Departments", desc: "Manage departments and teams", icon: Building2 },
  { id: "projects", label: "Projects", desc: "Project settings and preferences", icon: FolderKanban },
  { id: "tasks", label: "Tasks", desc: "Task settings and workflows", icon: CheckSquare },
  { id: "income", label: "Income", desc: "Income categories and settings", icon: DollarSign },
  { id: "expenses", label: "Expenses", desc: "Expense categories and settings", icon: Receipt },
  { id: "sales", label: "Sales", desc: "Sales settings and preferences", icon: ShoppingBag },
  { id: "notifications", label: "Notifications", desc: "Email and in-app notifications", icon: Bell },
  { id: "security", label: "Security", desc: "Password, 2FA and sessions", icon: Shield },
  { id: "billing", label: "Billing", desc: "Subscription and payment", icon: CreditCard },
];

const TIMEZONES = ["(GMT+05:00) Asia/Karachi", "(GMT+00:00) UTC", "(GMT-05:00) America/New_York", "(GMT+01:00) Europe/London", "(GMT+04:00) Asia/Dubai"];
const CURRENCIES = ["PKR - Pakistani Rupee (₨)", "USD - US Dollar ($)", "EUR - Euro (€)", "GBP - British Pound (£)", "AED - UAE Dirham (د.إ)"];
const DATE_FORMATS = ["MMM DD, YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"];
const TIME_FORMATS = ["12 Hour (10:30 AM)", "24 Hour (22:30)"];
const LANGUAGES = ["English", "Urdu", "Arabic", "French"];
const DEFAULT_DASHBOARDS = ["Dashboard", "Projects", "Tasks", "Reports"];
const COUNTRIES = ["Pakistan", "United States", "United Kingdom", "United Arab Emirates", "Canada"];
// Compact Mode toggle (General tab) reads/sets company.compactMode, which
// lives deep inside the main component's state. SettingRow (used by
// every ToggleRow/setting row across every tab, ~30+ call sites) is
// declared as its own function below, so it can't see that state
// directly — this context is how it gets it, without having to thread a
// `compact` prop through every single call site individually.
const CompactModeContext = createContext(false);

const USER_ROLES = ["Admin", "Manager", "Employee", "Client", "Accountant"];
const DEPARTMENT_NAMES = ["Management", "Development", "Design", "Sales", "Marketing", "Support", "Finance"];
const SWATCHES = ["#7c3aed", "#4f46e5", "#0ea5e9", "#059669", "#d97706", "#e11d48", "#64748b"];

const DEFAULT_COMPANY = {
  name: "Hopenix Technologies",
  email: "info@hopenix.com",
  phone: "+92 300 1234567",
  website: "https://hopenix.com",
  timezone: TIMEZONES[0],
  currency: CURRENCIES[0],
  dateFormat: DATE_FORMATS[0],
  timeFormat: TIME_FORMATS[0],
  defaultDashboard: DEFAULT_DASHBOARDS[0],
  language: LANGUAGES[0],
  compactMode: false,
  emailNotifications: true,
  autoCurrencyUpdate: true,
  street: "123, Business Avenue, Gulberg III",
  city: "Lahore",
  state: "Punjab",
  zip: "54000",
  country: COUNTRIES[0],
};

const DEFAULT_PROFILE = {
  name: "Hamna Jameel",
  email: "hamna.jameel@hopenix.com",
  phone: "+92 301 9876543",
  role: "Admin",
};

const DEFAULT_USERS = [
  { id: 1, name: "Hamna Jameel", email: "hamna.jameel@hopenix.com", role: "Admin", department: "Management", status: "Active" },
  { id: 2, name: "Ali Raza", email: "ali.raza@hopenix.com", role: "Manager", department: "Sales", status: "Active" },
  { id: 3, name: "Sara Khan", email: "sara.khan@hopenix.com", role: "Employee", department: "Development", status: "Active" },
  { id: 4, name: "Bilal Ahmed", email: "bilal.ahmed@hopenix.com", role: "Employee", department: "Design", status: "Inactive" },
  { id: 5, name: "Ayesha Tariq", email: "ayesha.tariq@hopenix.com", role: "Client", department: "Marketing", status: "Active" },
];

// Backend User.role is always lowercase ("admin", "manager", ...) — the
// UI shows Title Case ("Admin", "Manager", ...). These two maps convert
// both ways so the Users & Roles tab can keep its existing look while
// actually talking to the real backend.
const ROLE_DISPLAY_TO_BACKEND = { Admin: "admin", Manager: "manager", Employee: "employee", Client: "client", Accountant: "accountant" };
const ROLE_BACKEND_TO_DISPLAY = { admin: "Admin", manager: "Manager", employee: "Employee", client: "Client", accountant: "Accountant" };

// Backend User.status is pending/approved/rejected/deactivated — the old
// demo data only ever had a binary Active/Inactive toggle. Approved maps
// to "Active"; everything else (deactivated/rejected/pending) shows as
// "Inactive" so the existing toggle button still makes sense, but pending
// invites are visually distinguishable via their own label.
function statusToDisplay(status) {
  if (status === "approved") return "Active";
  if (status === "pending") return "Pending";
  return "Inactive";
}

const DEFAULT_DEPARTMENTS = []; // real ones are loaded from the backend

const DEFAULT_PROJECT_SETTINGS = {
  defaultView: "Kanban Board",
  autoArchive: true,
  requireCode: false,
  allowGuestAccess: false,
  timeTracking: true,
  categories: [
    { id: 1, name: "Web Development", color: "#7c3aed" },
    { id: 2, name: "Mobile App", color: "#0ea5e9" },
    { id: 3, name: "Design", color: "#e11d48" },
    { id: 4, name: "Marketing", color: "#d97706" },
  ],
};

const DEFAULT_TASK_SETTINGS = {
  defaultView: "Board View",
  autoAssignLead: false,
  allowSubtasks: true,
  requireDueDate: false,
  sendReminders: true,
  statuses: [
    { id: 1, name: "To Do", color: "#64748b" },
    { id: 2, name: "In Progress", color: "#0ea5e9" },
    { id: 3, name: "In Review", color: "#d97706" },
    { id: 4, name: "Done", color: "#059669" },
  ],
};

const DEFAULT_INCOME_SETTINGS = {
  defaultAccount: "Bank - HBL",
  recurringIncome: true,
  autoInvoice: false,
  categories: [
    { id: 1, name: "Sales Revenue", color: "#059669" },
    { id: 2, name: "Service Income", color: "#0ea5e9" },
    { id: 3, name: "Investment Returns", color: "#7c3aed" },
    { id: 4, name: "Other Income", color: "#64748b" },
  ],
};

const DEFAULT_EXPENSE_SETTINGS = {
  approvalThreshold: 50000,
  requireReceipt: true,
  autoCategorize: false,
  categories: [
    { id: 1, name: "Salaries", color: "#e11d48" },
    { id: 2, name: "Office Rent", color: "#d97706" },
    { id: 3, name: "Utilities", color: "#0ea5e9" },
    { id: 4, name: "Software & Tools", color: "#7c3aed" },
    { id: 5, name: "Travel", color: "#64748b" },
  ],
};

const DEFAULT_SALES_SETTINGS = {
  taxRate: 17,
  invoicePrefix: "INV-",
  paymentTerms: "Net 15",
  discount: 0,
  autoInvoiceNumber: true,
  paymentReminders: true,
};

const DEFAULT_NOTIFICATIONS = [
  { id: "task_assigned", label: "Task Assigned", email: true, push: true, sms: false },
  { id: "task_completed", label: "Task Completed", email: true, push: false, sms: false },
  { id: "project_update", label: "Project Update", email: true, push: true, sms: false },
  { id: "invoice_paid", label: "Invoice Paid", email: true, push: true, sms: true },
  { id: "new_message", label: "New Message", email: false, push: true, sms: false },
  { id: "system_alerts", label: "System Alerts", email: true, push: true, sms: true },
];

const DEFAULT_SECURITY = {
  twoFactor: false,
  sessions: [], // real sign-in history is loaded from the server (GET /security/sessions/)
};
const formatDateTime = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

// Billing is entirely server-driven (GET /api/settings/billing/): plan, price,
// storage allowance, renewal date, plan catalog and history all come from the
// backend. This is just the empty shape shown until the first response lands.
const DEFAULT_BILLING = {
  plan: "",
  price: 0,
  cardLast4: "",
  cardBrand: "",
  cardExpiry: "",
  nextBillingDate: "",
  storageLimitGb: 0,
  features: [],
  plans: [],
  history: [],
};

const formatMoney = (n) => (Number(n) > 0 ? `₨ ${Number(n).toLocaleString()}` : "—");
const formatPlanPrice = (p) => (p?.price ? `₨${Number(p.price).toLocaleString()}/mo` : "Custom");
const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
};


// Real storage numbers come from the backend (GET /api/settings/storage/).
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore storage errors (e.g. private browsing) */
  }
}

function nextId(list) {
  return list.length ? Math.max(...list.map((i) => i.id)) + 1 : 1;
}

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */
function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium mb-1.5 text-slate-500 dark:text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors ${checked ? "bg-violet-600" : "bg-slate-300"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
    </button>
  );
}

function Badge({ children, tone = "slate", darkMode }) {
  const tones = {
    emerald: darkMode ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-50 text-emerald-600",
    rose: darkMode ? "bg-rose-500/15 text-rose-400" : "bg-rose-50 text-rose-600",
    amber: darkMode ? "bg-amber-500/15 text-amber-400" : "bg-amber-50 text-amber-600",
    violet: darkMode ? "bg-violet-500/15 text-violet-300" : "bg-violet-50 text-violet-700",
    slate: darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600",
  };
  return <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${tones[tone] || tones.slate}`}>{children}</span>;
}

/* Consistent "label / description / control" row used across many tabs */
function SettingRow({ title, desc, children, darkMode, last }) {
  // Reads Compact Mode from context instead of a prop so every existing
  // call site (there are ~30+ across every tab) automatically respects
  // the toggle without having to be touched individually.
  const compact = useContext(CompactModeContext);
  return (
    <div className={`flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap ${compact ? "py-1.5" : "py-3"} ${last ? "" : `border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}`}>
      <div className="min-w-0 flex-1 basis-40">
        <p className={`text-[12px] font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{title}</p>
        {desc && !compact && <p className={`text-[10.5px] mt-0.5 ${darkMode ? "text-slate-500" : "text-slate-400"}`}>{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleRow({ title, desc, checked, onChange, darkMode, last }) {
  return (
    <SettingRow title={title} desc={desc} darkMode={darkMode} last={last}>
      <Toggle checked={checked} onChange={onChange} />
    </SettingRow>
  );
}

function SectionHeading({ title, subtitle, darkMode, action }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <h2 className={`text-base font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{title}</h2>
        {subtitle && <p className={`text-xs mt-1 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

function IconBtn({ icon: Icon, onClick, tone = "slate", darkMode, title, size = 13 }) {
  const tones = {
    slate: darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100",
    rose: darkMode ? "text-rose-400 hover:bg-rose-500/10" : "text-rose-500 hover:bg-rose-50",
    violet: darkMode ? "text-violet-400 hover:bg-violet-500/10" : "text-violet-600 hover:bg-violet-50",
  };
  return (
    <button type="button" title={title} onClick={onClick} className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${tones[tone]}`}>
      <Icon size={size} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal system                                                       */
/* ------------------------------------------------------------------ */
function Modal({ open, onClose, title, children, darkMode, widthClass = "max-w-md" }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={onClose} />
      <div className={`relative w-full ${widthClass} rounded-xl shadow-xl p-5 max-h-[85vh] overflow-y-auto ${darkMode ? "bg-slate-900 border border-slate-800" : "bg-white"}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`text-sm font-bold ${darkMode ? "text-white" : "text-slate-900"}`}>{title}</h3>
          <button onClick={onClose} className={`w-7 h-7 rounded-md flex items-center justify-center ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-400 hover:bg-slate-100"}`}>
            <X size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ConfirmModal({ open, onClose, onConfirm, title, message, confirmLabel = "Confirm", danger, darkMode, children }) {
  return (
    <Modal open={open} onClose={onClose} title={title} darkMode={darkMode} widthClass="max-w-sm">
      <p className={`text-xs leading-relaxed ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{message}</p>
      {children}
      <div className="flex items-center gap-2 mt-5">
        <button
          onClick={onClose}
          className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className={`flex-1 text-xs font-semibold rounded-lg py-2 text-white ${danger ? "bg-rose-600 hover:bg-rose-700" : "bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  Reusable colour-tagged list manager (categories / statuses)        */
/* ------------------------------------------------------------------ */
function TagListManager({ items, onAdd, onDelete, darkMode, placeholder = "Add new..." }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(SWATCHES[0]);
  const inputClass = `flex-1 rounded-lg px-3 py-2 text-xs outline-none border transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500 ${
    darkMode ? "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
  }`;

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ id: nextId(items), name: trimmed, color });
    setName("");
  }

  return (
    <div>
      <div className="space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
            <span className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: it.color }} />
              <span className={`text-[11.5px] font-medium truncate ${darkMode ? "text-slate-200" : "text-slate-700"}`}>{it.name}</span>
            </span>
            <IconBtn icon={Trash2} tone="rose" darkMode={darkMode} title="Remove" onClick={() => onDelete(it.id)} />
          </div>
        ))}
        {items.length === 0 && <p className={`text-[11px] italic ${darkMode ? "text-slate-500" : "text-slate-400"}`}>No entries yet.</p>}
      </div>
      <div className="flex items-center gap-1.5 mt-2.5">
        <div className="flex items-center gap-1 shrink-0">
          {SWATCHES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setColor(s)}
              className={`w-4 h-4 rounded-full transition-transform ${color === s ? "scale-110 ring-2 ring-offset-1 ring-violet-500" : ""}`}
              style={{ backgroundColor: s }}
              aria-label={`Choose ${s}`}
            />
          ))}
        </div>
        <input
          className={inputClass}
          placeholder={placeholder}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button onClick={submit} className="shrink-0 w-8 h-8 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white flex items-center justify-center hover:opacity-90">
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Avatar image compression                                           */
/* ------------------------------------------------------------------ */
/*
 * Why this exists: the previous flow read the picked file straight into a
 * base64 data URL with FileReader and handed that (up to ~5MB source file,
 * which becomes ~6.7MB once base64-encoded) to updateUserProfile, which
 * stores the ENTIRE users array (every user, every field) under a single
 * "hopenix_users" localStorage key. Most browsers cap localStorage at
 * 5-10MB per origin, so a single oversized avatar could blow the whole
 * users table past quota. When that happens, localStorage.setItem throws
 * (see AuthContext.jsx's persistUsers), which is caught and only
 * console.error'd — so the in-memory React state (and therefore your own
 * screen) still shows the new photo, but nothing was actually written to
 * disk. Refresh, or check from another login/session, and the DP is gone.
 *
 * Fix: before ever turning the picked file into a data URL, draw it onto a
 * canvas capped at AVATAR_MAX_DIMENSION on its longest side, then export it
 * as a compressed JPEG. A profile photo doesn't need to be pixel-perfect at
 * full camera resolution, so this brings basically any picked photo down
 * to a few hundred KB, which keeps the whole users table safely inside
 * localStorage's quota no matter how many users/avatars accumulate.
 */
const AVATAR_MAX_DIMENSION = 320; // px, longest side
const AVATAR_JPEG_QUALITY = 0.82;

function compressImageFile(file, maxDimension = AVATAR_MAX_DIMENSION, quality = AVATAR_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that image — please try another one."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't read that image — please try another one."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        // Fill white first in case the source has transparency (PNG/GIF) —
        // otherwise transparent areas turn black once flattened to JPEG.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ==================================================================== */
export default function SettingsPage({ darkMode, setDarkMode, avatar, onAvatarChange }) {
  const {
    user,
    updateUserProfile,
    changePassword,
    getCompanySettings,
    updateCompanySettings,
    getNotificationPreferences,
    updateNotificationPreferences,
    getNotificationStatus,
    sendTestNotification,
    getDepartments,
    createDepartment,
    updateDepartment,
    deleteDepartment,
    getStorageUsage,
    getSecuritySettings,
    setupTwoFactor,
    enableTwoFactor,
    disableTwoFactor,
    regenerateBackupCodes,
    getSessions,
    signOutOtherDevices,
    getSystemLogs,
    getSystemInfo,
    getAccountDeletion,
    requestAccountDeletion,
    cancelAccountDeletion,
    resetSettingsOnServer,
    getBillingInfo,
    updateBillingInfo,
    getProjectSettings,
    updateProjectSettings,
    getTaskSettings,
    updateTaskSettings,
    getIncomeSettings,
    updateIncomeSettings,
    getExpenseSettings,
    updateExpenseSettings,
    getSalesSettings,
    updateSalesSettings,
    users: realUsers,
    refreshUsers,
    inviteUser,
    updateUserRole,
    setUserStatus,
    removeUser: removeRealUser,
    hasFullSubPageAccess,
  } = useAuth();
  // Non-admin (Manager, Employee, Client, Accountant) only ever get
  // Profile + Security here, plus a trimmed-down General tab (see below).
  // Real admins always keep every tab. On top of that, an admin can grant
  // one specific non-admin person the same full tab set via Individual
  // User Access → "Full Settings Access" (or plain page-access "Full
  // Access") — see AuthContext's hasFullSubPageAccess/getSubPageAccess —
  // without making them an admin, so this is no longer a plain role check.
  const hasFullSettingsAccess = hasFullSubPageAccess("Settings");
  // "notifications" is per-user (each person only edits their OWN toggles and
  // registers THEIR OWN device), so every role gets it by default.
  const NON_ADMIN_TAB_IDS = ["general", "profile", "notifications", "security"];
  const [tab, setTab] = useState("general");
  // If access changes, or someone somehow ends up on a tab they're not
  // (or no longer) allowed to see (e.g. was on "billing" while granted
  // full access, then that override got reset), bounce back to a tab
  // they're actually allowed to see.
  useEffect(() => {
    if (!hasFullSettingsAccess && !NON_ADMIN_TAB_IDS.includes(tab)) {
      setTab("general");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFullSettingsAccess, tab]);
  // The main settings panel (Profile, Users, Departments, etc.) — on
  // desktop (lg+) it sits in a 3-column layout next to the nav, always in
  // view. On mobile the layout collapses to a single stacked column (nav
  // list on top, then this panel), so tapping a nav item like "Profile"
  // can leave the newly-active section below the fold if the nav list
  // itself fills the screen. We smooth-scroll this panel into view on
  // mobile only — desktop keeps its current behavior untouched.
  const contentPanelRef = useRef(null);
  const scrollToContentOnMobile = () => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 1024) return; // lg breakpoint — desktop layout, no scroll needed
    if (contentPanelRef.current) {
      contentPanelRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };
  const [company, setCompany] = useState(() => loadJSON("hopenix_company", DEFAULT_COMPANY));
  // Profile starts from the REAL logged-in user's own account (AuthContext)
  // instead of a static demo default, so this tab always shows/edits the
  // actual person's name/email/phone — the same record Messages/Employees
  // read from, not a disconnected local copy.
  const [profile, setProfile] = useState(() =>
    user
      ? { name: user.name || "", email: user.email || "", phone: user.phone || "", role: user.role || "" }
      : loadJSON("hopenix_profile", DEFAULT_PROFILE)
  );
  // Real, backend-backed user list (admin-only — empty for non-admins,
  // same as everywhere else in the app that reads AuthContext's users).
  // Mapped once here into the exact display shape this tab's JSX already
  // expects (Title Case role, Active/Inactive/Pending status) so nothing
  // below has to change just because the data source changed.
  const users = (realUsers || []).map((u) => ({
    id: u.id,
    name: u.name || u.email,
    email: u.email,
    role: ROLE_BACKEND_TO_DISPLAY[u.role] || u.role,
    department: u.department || "—",
    status: statusToDisplay(u.status),
    _backendRole: u.role,
    _backendStatus: u.status,
  }));

  // Settings page might be the first place a freshly-logged-in admin
  // lands — make sure the real user list is loaded rather than relying
  // on whatever AuthContext already had in memory.
  useEffect(() => {
    refreshUsers?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [departments, setDepartments] = useState([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [departmentsError, setDepartmentsError] = useState("");
  const [projectSettings, setProjectSettings] = useState(() => loadJSON("hopenix_project_settings", DEFAULT_PROJECT_SETTINGS));
  const [taskSettings, setTaskSettings] = useState(() => loadJSON("hopenix_task_settings", DEFAULT_TASK_SETTINGS));
  const [incomeSettings, setIncomeSettings] = useState(() => loadJSON("hopenix_income_settings", DEFAULT_INCOME_SETTINGS));
  const [expenseSettings, setExpenseSettings] = useState(() => loadJSON("hopenix_expense_settings", DEFAULT_EXPENSE_SETTINGS));
  const [salesSettings, setSalesSettings] = useState(() => loadJSON("hopenix_sales_settings", DEFAULT_SALES_SETTINGS));
  const [notifications, setNotifications] = useState(() => loadJSON("hopenix_notifications", DEFAULT_NOTIFICATIONS));
  const [security, setSecurity] = useState(() => loadJSON("hopenix_security", DEFAULT_SECURITY));
  const [billing, setBilling] = useState(DEFAULT_BILLING);

  // Load Company / Notifications / Security(2FA) / Billing from the real
  // backend once, on mount — this OVERRIDES whatever loadJSON() above
  // pulled from localStorage/defaults, the same way a page refresh should
  // show the real saved values instead of stale local demo data. If any
  // call fails (backend not running, offline, etc.) that tab's state just
  // stays whatever loadJSON already gave it — this never blocks the page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [companyRes, notifRes, secRes, billingRes, projRes, taskRes, incomeRes, expenseRes, salesRes] = await Promise.all([
        getCompanySettings(),
        getNotificationPreferences(),
        getSecuritySettings(),
        getBillingInfo(),
        getProjectSettings(),
        getTaskSettings(),
        getIncomeSettings(),
        getExpenseSettings(),
        getSalesSettings(),
      ]);
      if (cancelled) return;
      if (companyRes.success && companyRes.data) setCompany((c) => ({ ...c, ...companyRes.data }));
      if (notifRes.success && Array.isArray(notifRes.data) && notifRes.data.length) setNotifications(notifRes.data);
      if (secRes.success && secRes.data) {
        setSecurity((s) => ({ ...s, twoFactor: !!secRes.data.two_factor_enabled }));
        setBackupLeft(Number(secRes.data.backup_codes_left) || 0);
      }
      if (billingRes.success && billingRes.data) setBilling(billingRes.data);
      if (projRes.success && projRes.data) setProjectSettings((s) => ({ ...s, ...projRes.data }));
      if (taskRes.success && taskRes.data) setTaskSettings((s) => ({ ...s, ...taskRes.data }));
      if (incomeRes.success && incomeRes.data) setIncomeSettings((s) => ({ ...s, ...incomeRes.data }));
      if (expenseRes.success && expenseRes.data) setExpenseSettings((s) => ({ ...s, ...expenseRes.data }));
      if (salesRes.success && salesRes.data) setSalesSettings((s) => ({ ...s, ...salesRes.data }));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [storage, setStorage] = useState(null); // real numbers from the backend
  const [storageError, setStorageError] = useState("");
  const [storageLoading, setStorageLoading] = useState(false);
  const [notifStatus, setNotifStatus] = useState(null);
  const [notifBusy, setNotifBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const brand = useBrand();
  const logoInputRef = useRef(null);

  const [saved, setSaved] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null); // { type, data }
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm, danger, confirmLabel }
  const [userSearch, setUserSearch] = useState("");
  const [logFilter, setLogFilter] = useState("all");
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [sysInfo, setSysInfo] = useState(null);
  const [sysInfoError, setSysInfoError] = useState("");
  const [twoFa, setTwoFa] = useState({ setup: null, code: "", busy: false, error: "", backupCodes: null });
  const [twoFaOff, setTwoFaOff] = useState({ password: "", code: "", busy: false, error: "" });
  const [backupLeft, setBackupLeft] = useState(0);
  const [deletion, setDeletion] = useState({ requested: false, requested_at: null });
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);
  const fileInputRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  }

  /* ---------------- Real system logs / system information ---------------- */
  async function loadLogs(level = logFilter) {
    setLogsLoading(true);
    const res = await getSystemLogs(level);
    if (res.success) {
      setLogs(res.data.logs || []);
      setLogsError("");
    } else {
      setLogsError(res.error || "Couldn't load the logs.");
    }
    setLogsLoading(false);
  }
  useEffect(() => {
    if (modal?.type === "logs") loadLogs(logFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal?.type, logFilter]);

  async function loadSysInfo() {
    const res = await getSystemInfo();
    if (res.success) {
      setSysInfo(res.data);
      setSysInfoError("");
    } else {
      setSysInfoError(res.error || "Unavailable");
    }
  }
  useEffect(() => {
    if (hasFullSettingsAccess) loadSysInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFullSettingsAccess]);

  /* ---------------- Real sign-in history ---------------- */
  async function loadSessions() {
    setSessionsLoading(true);
    const res = await getSessions();
    if (res.success) {
      setSessions(res.data.sessions || []);
      setSessionsError("");
    } else {
      setSessionsError(res.error || "Couldn't load sign-ins.");
    }
    setSessionsLoading(false);
  }
  useEffect(() => {
    if (tab === "security") loadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function handleSignOutOthers() {
    const res = await signOutOtherDevices();
    closeConfirm();
    showToast(res.success ? "Signed out of all other devices" : res.error || "Couldn't sign out other devices");
    if (res.success) loadSessions();
  }

  /* ---------------- Real two-factor authentication ---------------- */
  async function startTwoFactor() {
    setTwoFa({ setup: null, code: "", busy: true, error: "", backupCodes: null });
    setModal({ type: "enable2fa" });
    const res = await setupTwoFactor();
    setTwoFa((t) => ({ ...t, busy: false, setup: res.success ? res.data : null, error: res.success ? "" : res.error || "Couldn't start setup." }));
  }
  async function confirmTwoFactor() {
    setTwoFa((t) => ({ ...t, busy: true, error: "" }));
    const res = await enableTwoFactor(twoFa.code);
    if (res.success) {
      setSecurity((sec) => ({ ...sec, twoFactor: true }));
      setBackupLeft((res.data.backup_codes || []).length);
      setTwoFa((t) => ({ ...t, busy: false, backupCodes: res.data.backup_codes || [], setup: null, code: "" }));
    } else {
      setTwoFa((t) => ({ ...t, busy: false, error: res.error || "That code isn't right." }));
    }
  }
  async function confirmDisableTwoFactor() {
    setTwoFaOff((t) => ({ ...t, busy: true, error: "" }));
    const res = await disableTwoFactor(twoFaOff.password, twoFaOff.code);
    if (res.success) {
      setSecurity((sec) => ({ ...sec, twoFactor: false }));
      setBackupLeft(0);
      closeModal();
      showToast("Two-factor authentication turned off");
    } else {
      setTwoFaOff((t) => ({ ...t, busy: false, error: res.error || "Couldn't turn it off." }));
    }
  }
  async function newBackupCodes() {
    setTwoFaOff((t) => ({ ...t, busy: true, error: "" }));
    const res = await regenerateBackupCodes(twoFaOff.password, twoFaOff.code);
    if (res.success) {
      setBackupLeft((res.data.backup_codes || []).length);
      setTwoFa({ setup: null, code: "", busy: false, error: "", backupCodes: res.data.backup_codes || [] });
      setTwoFaOff({ password: "", code: "", busy: false, error: "" });
      setModal({ type: "enable2fa" });
    } else {
      setTwoFaOff((t) => ({ ...t, busy: false, error: res.error || "Couldn't create new codes." }));
    }
  }

  /* ---------------- Account deletion REQUEST (nothing is deleted automatically) ---------------- */
  useEffect(() => {
    if (!hasFullSettingsAccess) return;
    getAccountDeletion().then((r) => r.success && setDeletion(r.data));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFullSettingsAccess]);

  async function submitDeletionRequest() {
    setDeleteBusy(true);
    setDeleteError("");
    const res = await requestAccountDeletion(deletePassword);
    setDeleteBusy(false);
    if (res.success) {
      setDeletion(res.data);
      setDeletePassword("");
      closeModal();
      showToast("Deletion request recorded. Nothing has been deleted.");
    } else {
      setDeleteError(res.error || "Couldn't record the request.");
    }
  }
  async function withdrawDeletionRequest() {
    const res = await cancelAccountDeletion();
    if (res.success) {
      setDeletion(res.data);
      showToast("Deletion request cancelled");
    } else {
      showToast(res.error || "Couldn't cancel the request");
    }
  }

  /* ---------------- Real departments ---------------- */
  async function loadDepartments() {
    const res = await getDepartments();
    if (res.success) {
      setDepartments(res.data);
      setDepartmentsError("");
    } else {
      setDepartmentsError(res.error || "Couldn't load departments.");
    }
    setDepartmentsLoading(false);
  }
  useEffect(() => {
    loadDepartments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- Real storage (admin only) ---------------- */
  async function loadStorage(refresh = false) {
    if (!hasFullSettingsAccess) return;
    setStorageLoading(true);
    const res = await getStorageUsage(refresh);
    if (res.success) {
      setStorage(res.data);
      setStorageError("");
    } else {
      setStorageError(res.error || "Couldn't read storage usage.");
    }
    setStorageLoading(false);
  }
  useEffect(() => {
    loadStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFullSettingsAccess]);

  /* ---------------- Notifications ---------------- */
  async function loadNotifStatus() {
    const res = await getNotificationStatus();
    if (res.success) setNotifStatus(res.data);
  }
  useEffect(() => {
    if (tab === "notifications") loadNotifStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Every toggle saves immediately (no need to remember "Save Changes").
  async function toggleNotification(id, channel, value) {
    const next = notifications.map((x) => (x.id === id ? { ...x, [channel]: value } : x));
    setNotifications(next);
    saveJSON("hopenix_notifications", next);
    const res = await updateNotificationPreferences(next);
    if (res?.success === false) showToast(res.error || "Couldn't save — check your connection");
  }

  async function enableBrowserNotifications() {
    setNotifBusy(true);
    let result;
    try {
      // prompt:true = ask for permission right now (we're inside a tap/click)
      result = await ensurePushSubscribed({ prompt: true });
    } finally {
      await loadNotifStatus();
      setNotifBusy(false);
    }
    showToast(result?.ok ? "Notifications enabled on this device" : result?.message || "Couldn't enable notifications");
  }

  // Sent by the server 15 s later, so the person can close Hopenix / lock the
  // phone first and see whether a notification really arrives while it is closed.
  async function runClosedAppTest() {
    setNotifBusy(true);
    try {
      const sub = await ensurePushSubscribed({ prompt: true });
      if (!sub.ok) {
        showToast(sub.message || "This device isn't registered for notifications.");
        return;
      }
      const r = await sendTestPush({ delay: 15 });
      if (!r.configured) showToast(`Server can't send notifications: ${r.reason}`);
      else if (!r.subscriptions) showToast("The server has no device registered for you. Tap “Enable on this device”.");
      else showToast("Now close Hopenix and lock the phone. A test notification arrives in ~15 seconds.");
    } catch (err) {
      showToast(err?.message || "Test failed");
    } finally {
      setNotifBusy(false);
      loadNotifStatus();
    }
  }

  async function runNotificationTest() {
    setNotifBusy(true);
    const res = await sendTestNotification();
    setNotifBusy(false);
    showToast(res.success ? res.data.message : res.error || "Test failed");
    loadNotifStatus();
  }

  /* ---------------- Company logo ---------------- */
  async function handleLogoPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!/^image\//.test(file.type)) return showToast("Please choose an image file");
    if (file.size > 2 * 1024 * 1024) return showToast("Logo must be 2MB or smaller");
    setLogoBusy(true);
    try {
      await uploadCompanyLogo(file);
      showToast("Logo updated everywhere");
    } catch (err) {
      showToast(err.message || "Couldn't upload the logo");
    } finally {
      setLogoBusy(false);
    }
  }
  async function handleLogoRemove() {
    setLogoBusy(true);
    try {
      await removeCompanyLogo();
      showToast("Logo reset to default");
    } catch (err) {
      showToast(err.message || "Couldn't remove the logo");
    } finally {
      setLogoBusy(false);
    }
  }

  function closeModal() {
    setModal(null);
  }
  function closeConfirm() {
    setConfirm(null);
  }

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const headingText = darkMode ? "text-white" : "text-slate-900";
  const inputClass = `w-full rounded-lg px-3 py-2 text-xs outline-none border transition-colors focus:border-violet-500 focus:ring-1 focus:ring-violet-500 ${
    darkMode ? "bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500" : "bg-white border-slate-200 text-slate-700 placeholder:text-slate-400"
  }`;
  const selectClass = inputClass + " appearance-none";
  const borderClass = darkMode ? "border-slate-800" : "border-slate-100";

  function setCompanyField(key, value) {
    setCompany((c) => ({ ...c, [key]: value }));
  }
  function setProfileField(key, value) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setAvatarError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Image must be smaller than 5MB.");
      return;
    }
    setAvatarError("");
    setAvatarUploading(true);
    try {
      // Compress/resize BEFORE it ever becomes a stored data URL — this is
      // what keeps a picked 4-5MB phone photo from blowing past
      // localStorage's quota once it's sitting inside the shared
      // "hopenix_users" record alongside every other user. See the
      // compressImageFile comment above for the full explanation.
      const compressedDataUrl = await compressImageFile(file);
      onAvatarChange?.(compressedDataUrl);
    } catch (err) {
      setAvatarError(err?.message || "Couldn't read that image — please try another one.");
    } finally {
      setAvatarUploading(false);
    }
  }

  /* Persist every settings bucket + surface a save confirmation */
  async function saveChanges() {
    // Real profile fields go to AuthContext, so they show up as this
    // user's actual info everywhere else in the app (Messages, Employees,
    // the header avatar, etc) — not just saved into this page's own local
    // copy.
    //
    // IMPORTANT: `avatar` (and `email`) are included here too, not just
    // name/phone. Picking a new photo already saves immediately via
    // onAvatarChange/updateAvatar in Dashboard.jsx, but if that very first
    // save ever silently failed (e.g. a localStorage quota error — see the
    // compressImageFile note above, and AuthContext.jsx's persistUsers),
    // clicking "Save Changes" is now a guaranteed second chance to
    // (re-)persist the current avatar/email instead of only touching
    // name/phone and leaving a stale or missing photo in place.
    if (user) {
      const profileUpdate = {
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
      };
      // BUG FIX: `avatar` here is whatever's currently showing — once a
      // photo's been saved, that's the backend's own URL
      // (http://127.0.0.1:8000/media/.../avatar.jpg), NOT a fresh
      // upload. The backend only understands a base64 "data:image/..."
      // string (see UpdateOwnProfileView.patch — it tries to
      // avatar_data_url.split(",", 1), which throws on a plain URL,
      // which is why EVERY save — even just typing a new name — was
      // failing with 400 "Invalid image data.". Only send `avatar` when
      // it's actually a fresh, unsaved pick.
      if (typeof avatar === "string" && avatar.startsWith("data:")) {
        profileUpdate.avatar = avatar;
      }
      updateUserProfile(user.id, profileUpdate);
    }
    // Push Company / Notifications / Security(2FA) / Billing to the real
    // backend too — best-effort, in parallel. This is on top of (not
    // instead of) the localStorage saves below, which keep working as an
    // instant local cache even if the backend call for a given tab fails
    // (e.g. it's an admin-only field and this user isn't an admin — the
    // Company/Billing PUTs are admin-only server-side).
    const results = await Promise.allSettled([
      updateCompanySettings(company),
      updateNotificationPreferences(notifications),
      updateProjectSettings(projectSettings),
      updateTaskSettings(taskSettings),
      updateIncomeSettings(incomeSettings),
      updateExpenseSettings(expenseSettings),
      updateSalesSettings(salesSettings),
    ]);
    const failed = results.some((r) => r.status === "rejected" || r.value?.success === false);
    if (failed) {
      console.warn("Some settings couldn't be saved to the server — saved locally instead.", results);
    }
    saveJSON("hopenix_company", company);
    saveJSON("hopenix_profile", profile);
    // NOTE: Users & Roles no longer has anything to save here — invite,
    // role change, status toggle, and remove all call the real backend
    // immediately (see the Users & Roles tab below), same as everywhere
    // else admin actions happen in this app. There's no local draft state
    // left to persist for that tab.
    saveJSON("hopenix_project_settings", projectSettings);
    saveJSON("hopenix_task_settings", taskSettings);
    saveJSON("hopenix_income_settings", incomeSettings);
    saveJSON("hopenix_expense_settings", expenseSettings);
    saveJSON("hopenix_sales_settings", salesSettings);
    saveJSON("hopenix_notifications", notifications);
    saveJSON("hopenix_security", security);
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  async function resetEverything() {
    // Resets the saved preferences on the SERVER (Projects/Tasks/Income/Expenses/Sales,
    // General display options, your notification choices), then reloads so every tab
    // shows what is really stored. Company name/contact, logo, billing, users and
    // departments are not touched.
    const res = await resetSettingsOnServer();
    closeConfirm();
    if (!res.success) {
      showToast(res.error || "Couldn't reset settings");
      return;
    }
    [
      "hopenix_company", "hopenix_profile", "hopenix_project_settings", "hopenix_task_settings",
      "hopenix_income_settings", "hopenix_expense_settings", "hopenix_sales_settings", "hopenix_notifications",
    ].forEach((k) => localStorage.removeItem(k));
    showToast("Settings reset to defaults");
    setTimeout(() => window.location.reload(), 700);
  }

  function downloadInvoice(row) {
    const text = `${(company.name || "HOPENIX").toUpperCase()}\nInvoice #${row.id}\nDescription: ${row.description}\nDate: ${formatDate(row.date)}\nAmount: ${formatMoney(row.amount)}\nStatus: ${row.status}\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `invoice-${row.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Invoice downloaded");
  }

  function copyToClipboard(text, label = "Copied to clipboard") {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast(label)).catch(() => showToast("Couldn't copy — copy it manually"));
    } else {
      showToast("Copy isn't supported in this browser");
    }
  }

  const filteredUsers = users.filter(
    (u) => u.name.toLowerCase().includes(userSearch.toLowerCase()) || u.email.toLowerCase().includes(userSearch.toLowerCase())
  );
  const storagePct = storage ? Math.min(100, Math.max(storage.used_bytes > 0 ? 1 : 0, Math.round(storage.percent || 0))) : 0;

  const saveBtn = (
    <button
      onClick={saveChanges}
      className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-4 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
    >
      {saved ? <Check size={13} /> : null}
      {saved ? "Saved" : "Save Changes"}
    </button>
  );

  return (
    <CompactModeContext.Provider value={company.compactMode}>
    <div className={`grid grid-cols-1 gap-4 items-start relative w-full max-w-full min-w-0 overflow-x-clip [&>*]:min-w-0 ${hasFullSettingsAccess ? "lg:grid-cols-[220px_1fr_280px]" : "lg:grid-cols-[220px_1fr]"}`}>
      {/* ---------------------------------------------- Settings sub-nav */}
      <div className={`rounded-xl p-2 shadow-sm lg:sticky lg:top-0 ${card}`}>
        <p className={`hidden lg:block px-2.5 pt-1.5 pb-2 text-[11px] font-semibold ${headingText}`}>Settings</p>
        <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0 lg:block lg:space-y-0.5 lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SETTINGS_NAV.filter(({ id }) => hasFullSettingsAccess || NON_ADMIN_TAB_IDS.includes(id)).map(({ id, label, desc, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={(e) => {
                  e.currentTarget.scrollIntoView?.({ behavior: "smooth", inline: "center", block: "nearest" });
                  setTab(id);
                  scrollToContentOnMobile();
                }}
                className={`shrink-0 lg:shrink lg:w-full flex items-center lg:items-start gap-2 lg:gap-2.5 text-left px-3 lg:px-2.5 py-2 rounded-full lg:rounded-lg whitespace-nowrap lg:whitespace-normal transition-colors ${
                  isActive
                    ? darkMode
                      ? "bg-violet-600/15 text-violet-300"
                      : "bg-violet-50 text-violet-700"
                    : darkMode
                    ? "text-slate-400 hover:bg-slate-800"
                    : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                <Icon size={15} className={`mt-0.5 shrink-0 ${isActive ? "text-violet-500" : subtleText}`} />
                <span className="min-w-0">
                  <span className={`block text-[12px] font-semibold lg:truncate ${isActive ? "" : cardText}`}>{label}</span>
                  <span className={`hidden lg:block text-[10px] truncate ${subtleText}`}>{desc}</span>
                </span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* ---------------------------------------------- Main settings panel */}
      <div ref={contentPanelRef} className="space-y-4 min-w-0">
        {tab === "general" && (
          <>
            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <SectionHeading title="General Settings" subtitle="Manage your company information and basic system preferences." darkMode={darkMode} action={saveBtn} />

              {hasFullSettingsAccess && (
                <div className={`mt-5 pt-4 border-t ${borderClass}`}>
                  <h3 className={`text-[13px] font-semibold mb-3 ${cardText}`}>Company Information</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                    <Field label="Company Name">
                      <input className={inputClass} value={company.name} onChange={(e) => setCompanyField("name", e.target.value)} />
                    </Field>

                    <div className="row-span-3 sm:row-span-3">
                      <span className="block text-[11px] font-medium mb-1.5 text-slate-500 dark:text-slate-400">Company Logo</span>
                      <div className="flex items-center gap-3">
                        <span className={`w-14 h-14 rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-violet-50"}`}>
                          <img src={brand.logo || DEFAULT_LOGO} alt="Company logo" className="w-full h-full object-contain p-1" />
                        </span>
                        <div>
                          <p className={`text-[10.5px] ${subtleText}`}>Recommended size: 200x200px</p>
                          <p className={`text-[10.5px] ${subtleText}`}>PNG, JPG or SVG. Max size 2MB</p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <button
                              type="button"
                              disabled={logoBusy}
                              onClick={() => logoInputRef.current?.click()}
                              className={`text-[11px] font-semibold rounded-md px-2.5 py-1 border disabled:opacity-60 ${
                                darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                              }`}
                            >
                              {logoBusy ? "Uploading..." : "Change Logo"}
                            </button>
                            {brand.logo && (
                              <button
                                type="button"
                                disabled={logoBusy}
                                onClick={handleLogoRemove}
                                className="text-[11px] font-semibold rounded-md px-2.5 py-1 text-rose-500 hover:bg-rose-500/10 disabled:opacity-60"
                              >
                                Remove
                              </button>
                            )}
                            <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={handleLogoPick} className="hidden" />
                          </div>
                        </div>
                      </div>
                    </div>

                    <Field label="Email">
                      <input type="email" className={inputClass} value={company.email} onChange={(e) => setCompanyField("email", e.target.value)} />
                    </Field>
                    <Field label="Timezone">
                      <select className={selectClass} value={company.timezone} onChange={(e) => setCompanyField("timezone", e.target.value)}>
                        {TIMEZONES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </Field>
                    <Field label="Phone">
                      <input className={inputClass} value={company.phone} onChange={(e) => setCompanyField("phone", e.target.value)} />
                    </Field>
                    <Field label="Currency">
                      <select className={selectClass} value={company.currency} onChange={(e) => setCompanyField("currency", e.target.value)}>
                        {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                      </select>
                    </Field>
                    <Field label="Website">
                      <input className={inputClass} value={company.website} onChange={(e) => setCompanyField("website", e.target.value)} />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Date Format">
                        <select className={selectClass} value={company.dateFormat} onChange={(e) => setCompanyField("dateFormat", e.target.value)}>
                          {DATE_FORMATS.map((d) => <option key={d}>{d}</option>)}
                        </select>
                      </Field>
                      <Field label="Time Format">
                        <select className={selectClass} value={company.timeFormat} onChange={(e) => setCompanyField("timeFormat", e.target.value)}>
                          {TIME_FORMATS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                      </Field>
                    </div>
                  </div>
                </div>
              )}

              <div className={`mt-5 pt-4 border-t ${borderClass}`}>
                <h3 className={`text-[13px] font-semibold mb-1 ${cardText}`}>System Preferences</h3>
                <div>
                  <SettingRow title="Default Dashboard" desc="Choose the default page after login" darkMode={darkMode}>
                    <select className={selectClass + " w-36 shrink-0"} value={company.defaultDashboard} onChange={(e) => setCompanyField("defaultDashboard", e.target.value)}>
                      {DEFAULT_DASHBOARDS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </SettingRow>
                  <SettingRow title="Language" desc="Choose your preferred language" darkMode={darkMode}>
                    <select className={selectClass + " w-36 shrink-0"} value={company.language} onChange={(e) => setCompanyField("language", e.target.value)}>
                      {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                    </select>
                  </SettingRow>
                  <ToggleRow title="Light Mode" desc="Black theme is the default — turn on for a light appearance" checked={!darkMode} onChange={(v) => setDarkMode(!v)} darkMode={darkMode} />
                  <ToggleRow title="Compact Mode" desc="Reduce spacing for more content on screen" checked={company.compactMode} onChange={(v) => setCompanyField("compactMode", v)} darkMode={darkMode} />
                  <ToggleRow title="Allow Email Notifications" desc="Receive important updates via email" checked={company.emailNotifications} onChange={(v) => setCompanyField("emailNotifications", v)} darkMode={darkMode} />
                  <ToggleRow title="Auto Currency Update" desc="Automatically update exchange rates" checked={company.autoCurrencyUpdate} onChange={(v) => setCompanyField("autoCurrencyUpdate", v)} darkMode={darkMode} last />
                </div>
              </div>
            </div>

            {hasFullSettingsAccess && (
              <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
                <h3 className={`text-[13px] font-semibold mb-3 ${cardText}`}>Company Address</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                  <Field label="Street Address">
                    <input className={inputClass} value={company.street} onChange={(e) => setCompanyField("street", e.target.value)} />
                  </Field>
                  <Field label="City">
                    <input className={inputClass} value={company.city} onChange={(e) => setCompanyField("city", e.target.value)} />
                  </Field>
                  <Field label="State / Province">
                    <input className={inputClass} value={company.state} onChange={(e) => setCompanyField("state", e.target.value)} />
                  </Field>
                  <Field label="Zip / Postal Code">
                    <input className={inputClass} value={company.zip} onChange={(e) => setCompanyField("zip", e.target.value)} />
                  </Field>
                  <Field label="Country">
                    <select className={selectClass} value={company.country} onChange={(e) => setCompanyField("country", e.target.value)}>
                      {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "profile" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Profile" subtitle="Update your profile picture and personal information." darkMode={darkMode} action={saveBtn} />

            <div className={`mt-5 pt-4 border-t flex items-center gap-4 flex-wrap ${borderClass}`}>
              <div className="relative shrink-0">
                <img src={avatar} alt={profile.name} className={`w-20 h-20 rounded-full object-cover ring-4 ${darkMode ? "ring-slate-800" : "ring-violet-50"} ${avatarUploading ? "opacity-50" : ""}`} />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow ring-2 ring-white disabled:opacity-60"
                  aria-label="Change profile picture"
                >
                  {avatarUploading ? (
                    <span className="w-3 h-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                  ) : (
                    <Camera size={12} />
                  )}
                </button>
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleAvatarPick} className="hidden" />
              </div>
              <div>
                <p className={`text-[12.5px] font-semibold ${cardText}`}>{profile.name}</p>
                <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>JPG, PNG or GIF. Max size 5MB.</p>
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarUploading}
                    className={`flex items-center gap-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1.5 border disabled:opacity-60 ${
                      darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Upload size={12} /> {avatarUploading ? "Processing..." : "Choose from gallery"}
                  </button>
                </div>
                {avatarError && <p className="text-[10.5px] text-rose-500 mt-1.5">{avatarError}</p>}
              </div>
            </div>

            <div className={`mt-5 pt-4 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 ${borderClass}`}>
              <Field label="Full Name">
                <input className={inputClass} value={profile.name} onChange={(e) => setProfileField("name", e.target.value)} />
              </Field>
              <Field label="Role">
                <input className={inputClass} value={profile.role} disabled />
              </Field>
              <Field label="Email">
                <input type="email" className={inputClass} value={profile.email} onChange={(e) => setProfileField("email", e.target.value)} />
              </Field>
              <Field label="Phone">
                <input className={inputClass} value={profile.phone} onChange={(e) => setProfileField("phone", e.target.value)} />
              </Field>
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Users & Roles */}
        {tab === "users" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading
              title="Users & Roles"
              subtitle={`${users.length} team members · manage access and permissions`}
              darkMode={darkMode}
              action={
                <button
                  onClick={() => setModal({ type: "user", data: null })}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
                >
                  <Plus size={13} /> Add User
                </button>
              }
            />

            <div className={`mt-4 relative`}>
              <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${subtleText}`} />
              <input className={inputClass + " pl-8"} placeholder="Search by name or email..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
            </div>

            <div className="mt-3 -mx-1 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[560px]">
                <thead>
                  <tr className={`text-[10.5px] uppercase tracking-wide ${subtleText}`}>
                    <th className="px-1 py-2 font-semibold">User</th>
                    <th className="px-1 py-2 font-semibold">Role</th>
                    <th className="px-1 py-2 font-semibold">Department</th>
                    <th className="px-1 py-2 font-semibold">Status</th>
                    <th className="px-1 py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className={`border-t ${borderClass}`}>
                      <td className="px-1 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${darkMode ? "bg-violet-600/20 text-violet-300" : "bg-violet-50 text-violet-700"}`}>
                            {u.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                          </span>
                          <span className="min-w-0">
                            <span className={`block text-[12px] font-semibold truncate ${cardText}`}>{u.name}</span>
                            <span className={`block text-[10.5px] truncate ${subtleText}`}>{u.email}</span>
                          </span>
                        </div>
                      </td>
                      <td className="px-1 py-2.5">
                        <select
                          className={selectClass + " w-32 py-1.5"}
                          value={u.role}
                          onChange={async (e) => {
                            const displayRole = e.target.value;
                            const result = await updateUserRole(u.id, ROLE_DISPLAY_TO_BACKEND[displayRole] || displayRole.toLowerCase(), u.department);
                            if (result?.success === false) showToast(result.error || "Couldn't update role");
                          }}
                        >
                          {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className={`px-1 py-2.5 text-[11.5px] ${mutedText}`}>{u.department}</td>
                      <td className="px-1 py-2.5">
                        <button
                          onClick={async () => {
                            const nextBackendStatus = u._backendStatus === "approved" ? "deactivated" : "approved";
                            const result = await setUserStatus(u.id, nextBackendStatus);
                            if (result?.success === false) showToast(result.error || "Couldn't update status");
                          }}
                        >
                          <Badge tone={u.status === "Active" ? "emerald" : u.status === "Pending" ? "amber" : "slate"} darkMode={darkMode}>{u.status}</Badge>
                        </button>
                      </td>
                      <td className="px-1 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <IconBtn icon={Pencil} darkMode={darkMode} title="Edit user" onClick={() => setModal({ type: "user", data: u })} />
                          <IconBtn
                            icon={Trash2}
                            tone="rose"
                            darkMode={darkMode}
                            title="Remove user"
                            onClick={() =>
                              setConfirm({
                                title: "Remove user",
                                message: `Remove ${u.name} from your organization? They will lose access immediately.`,
                                danger: true,
                                confirmLabel: "Remove",
                                onConfirm: async () => {
                                  const result = await removeRealUser(u.id);
                                  closeConfirm();
                                  if (result?.success === false) {
                                    showToast(result.error || "Couldn't remove user");
                                  } else {
                                    showToast("User removed");
                                  }
                                },
                              })
                            }
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={5} className={`text-center py-8 text-xs ${subtleText}`}>No users match "{userSearch}".</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Departments */}
        {tab === "departments" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading
              title="Departments"
              subtitle={departmentsLoading ? "Loading departments..." : `${departments.length} department${departments.length === 1 ? "" : "s"} · from the people in your workspace`}
              darkMode={darkMode}
              action={hasFullSettingsAccess && (
                <button
                  onClick={() => setModal({ type: "department", data: null })}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
                >
                  <Plus size={13} /> Add Department
                </button>
              )}
            />
            {departmentsError && <p className="mt-3 text-[11.5px] text-rose-500">{departmentsError}</p>}
            {!departmentsLoading && !departmentsError && departments.length === 0 && (
              <p className={`mt-4 text-[12px] ${subtleText}`}>No departments yet. Add one, or assign a department to a user and it will show up here.</p>
            )}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {departments.map((d) => (
                <div key={d.id} className={`rounded-lg p-3.5 border ${darkMode ? "border-slate-800 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${darkMode ? "bg-slate-800" : "bg-white"}`}>
                        <Building2 size={15} className="text-violet-500" />
                      </span>
                      <span className="min-w-0">
                        <span className={`block text-[12.5px] font-semibold truncate ${cardText}`}>{d.name}</span>
                        <span className={`block text-[10.5px] truncate ${subtleText}`}>Head: {d.head || "Not assigned"}</span>
                      </span>
                    </div>
                    {hasFullSettingsAccess && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <IconBtn icon={Pencil} darkMode={darkMode} title="Edit" onClick={() => setModal({ type: "department", data: d })} />
                      <IconBtn
                        icon={Trash2}
                        tone="rose"
                        darkMode={darkMode}
                        title="Delete"
                        onClick={() =>
                          setConfirm({
                            title: "Delete department",
                            message: d.totalUsers > 0
                              ? `"${d.name}" still has ${d.totalUsers} user${d.totalUsers === 1 ? "" : "s"}. Move them to another department first — it can't be deleted while anyone is in it.`
                              : `Delete "${d.name}"?`,
                            danger: true,
                            confirmLabel: "Delete",
                            onConfirm: async () => {
                              const res = await deleteDepartment(d.id);
                              closeConfirm();
                              if (res.success) {
                                setDepartments((list) => list.filter((x) => x.id !== d.id));
                                showToast("Department deleted");
                              } else {
                                showToast(res.error || "Couldn't delete the department");
                              }
                            },
                          })
                        }
                      />
                    </div>
                    )}
                  </div>
                  <div className={`flex items-center justify-between mt-3 pt-2.5 border-t text-[11px] ${borderClass} ${mutedText}`}>
                    <span>{d.members} member{d.members === 1 ? "" : "s"}</span>
                    <span className="font-semibold">{d.budget > 0 ? `₨ ${d.budget.toLocaleString()} / mo` : "No budget set"}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Projects */}
        {tab === "projects" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Project Settings" subtitle="Control defaults and behavior for every project." darkMode={darkMode} action={saveBtn} />
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <SettingRow title="Default Project View" desc="Layout used when opening a project" darkMode={darkMode}>
                <select className={selectClass + " w-40"} value={projectSettings.defaultView} onChange={(e) => setProjectSettings((p) => ({ ...p, defaultView: e.target.value }))}>
                  {["Kanban Board", "List View", "Calendar", "Gantt Chart"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </SettingRow>
              <ToggleRow title="Auto-archive Completed Projects" desc="Move finished projects to archive after 30 days" checked={projectSettings.autoArchive} onChange={(v) => setProjectSettings((p) => ({ ...p, autoArchive: v }))} darkMode={darkMode} />
              <ToggleRow title="Require Project Code" desc="Enforce a unique code when creating a project — not active yet" checked={projectSettings.requireCode} onChange={(v) => setProjectSettings((p) => ({ ...p, requireCode: v }))} darkMode={darkMode} />
              <ToggleRow title="Allow Guest Access" desc="Let clients view project progress without an account — not active yet" checked={projectSettings.allowGuestAccess} onChange={(v) => setProjectSettings((p) => ({ ...p, allowGuestAccess: v }))} darkMode={darkMode} />
              <ToggleRow title="Enable Time Tracking" desc="Track hours logged against project tasks — not active yet" checked={projectSettings.timeTracking} onChange={(v) => setProjectSettings((p) => ({ ...p, timeTracking: v }))} darkMode={darkMode} last />
            </div>
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <h3 className={`text-[13px] font-semibold mb-2.5 ${cardText}`}>Project Categories</h3>
              <TagListManager
                items={projectSettings.categories}
                darkMode={darkMode}
                placeholder="Add project category..."
                onAdd={(item) => setProjectSettings((p) => ({ ...p, categories: [...p.categories, item] }))}
                onDelete={(id) => setProjectSettings((p) => ({ ...p, categories: p.categories.filter((c) => c.id !== id) }))}
              />
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Tasks */}
        {tab === "tasks" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Task Settings" subtitle="Configure workflows and default task behavior." darkMode={darkMode} action={saveBtn} />
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <SettingRow title="Default Task View" desc="Layout used when opening the task list" darkMode={darkMode}>
                <select className={selectClass + " w-36"} value={taskSettings.defaultView} onChange={(e) => setTaskSettings((t) => ({ ...t, defaultView: e.target.value }))}>
                  {["Board View", "List View", "Calendar"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </SettingRow>
              <ToggleRow title="Auto-assign to Project Lead" desc="New tasks default to the project's lead" checked={taskSettings.autoAssignLead} onChange={(v) => setTaskSettings((t) => ({ ...t, autoAssignLead: v }))} darkMode={darkMode} />
              <ToggleRow title="Allow Subtasks" desc="Let users break tasks into smaller subtasks" checked={taskSettings.allowSubtasks} onChange={(v) => setTaskSettings((t) => ({ ...t, allowSubtasks: v }))} darkMode={darkMode} />
              <ToggleRow title="Require Due Date" desc="Tasks can't be created without a due date" checked={taskSettings.requireDueDate} onChange={(v) => setTaskSettings((t) => ({ ...t, requireDueDate: v }))} darkMode={darkMode} />
              <ToggleRow title="Send Reminders" desc="Notify assignees before a task is due — not active yet" checked={taskSettings.sendReminders} onChange={(v) => setTaskSettings((t) => ({ ...t, sendReminders: v }))} darkMode={darkMode} last />
            </div>
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <h3 className={`text-[13px] font-semibold mb-2.5 ${cardText}`}>Task Workflow Statuses</h3>
              <TagListManager
                items={taskSettings.statuses}
                darkMode={darkMode}
                placeholder="Add task status..."
                onAdd={(item) => setTaskSettings((t) => ({ ...t, statuses: [...t.statuses, item] }))}
                onDelete={(id) => setTaskSettings((t) => ({ ...t, statuses: t.statuses.filter((s) => s.id !== id) }))}
              />
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Income */}
        {tab === "income" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Income Settings" subtitle="Manage income categories and recording preferences." darkMode={darkMode} action={saveBtn} />
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <SettingRow title="Default Income Account" desc="Account new income entries are posted to" darkMode={darkMode}>
                <select className={selectClass + " w-40"} value={incomeSettings.defaultAccount} onChange={(e) => setIncomeSettings((s) => ({ ...s, defaultAccount: e.target.value }))}>
                  {["Cash", "Bank - HBL", "Bank - Meezan", "PayPal"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </SettingRow>
              <ToggleRow title="Enable Recurring Income" desc="Allow income entries to repeat automatically — not active yet" checked={incomeSettings.recurringIncome} onChange={(v) => setIncomeSettings((s) => ({ ...s, recurringIncome: v }))} darkMode={darkMode} />
              <ToggleRow title="Auto-generate Invoice" desc="Create an invoice automatically for new income — not active yet" checked={incomeSettings.autoInvoice} onChange={(v) => setIncomeSettings((s) => ({ ...s, autoInvoice: v }))} darkMode={darkMode} last />
            </div>
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <h3 className={`text-[13px] font-semibold mb-2.5 ${cardText}`}>Income Categories</h3>
              <TagListManager
                items={incomeSettings.categories}
                darkMode={darkMode}
                placeholder="Add income category..."
                onAdd={(item) => setIncomeSettings((s) => ({ ...s, categories: [...s.categories, item] }))}
                onDelete={(id) => setIncomeSettings((s) => ({ ...s, categories: s.categories.filter((c) => c.id !== id) }))}
              />
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Expenses */}
        {tab === "expenses" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Expense Settings" subtitle="Manage expense categories and approval rules." darkMode={darkMode} action={saveBtn} />
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <SettingRow title="Approval Threshold" desc="Expenses above this amount need manager approval" darkMode={darkMode}>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] ${mutedText}`}>₨</span>
                  <input
                    type="number"
                    className={inputClass + " w-28"}
                    value={expenseSettings.approvalThreshold}
                    onChange={(e) => setExpenseSettings((s) => ({ ...s, approvalThreshold: Number(e.target.value) }))}
                  />
                </div>
              </SettingRow>
              <ToggleRow title="Require Receipt Upload" desc="No expense can be approved until a receipt is uploaded" checked={expenseSettings.requireReceipt} onChange={(v) => setExpenseSettings((s) => ({ ...s, requireReceipt: v }))} darkMode={darkMode} />
              <ToggleRow title="Auto-categorize Expenses" desc="Let the AI Assistant suggest a category — not active yet" checked={expenseSettings.autoCategorize} onChange={(v) => setExpenseSettings((s) => ({ ...s, autoCategorize: v }))} darkMode={darkMode} last />
            </div>
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <h3 className={`text-[13px] font-semibold mb-2.5 ${cardText}`}>Expense Categories</h3>
              <TagListManager
                items={expenseSettings.categories}
                darkMode={darkMode}
                placeholder="Add expense category..."
                onAdd={(item) => setExpenseSettings((s) => ({ ...s, categories: [...s.categories, item] }))}
                onDelete={(id) => setExpenseSettings((s) => ({ ...s, categories: s.categories.filter((c) => c.id !== id) }))}
              />
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Sales */}
        {tab === "sales" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Sales Settings" subtitle="Defaults used on quotes, orders and invoices." darkMode={darkMode} action={saveBtn} />
            <div className={`mt-4 pt-4 border-t grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 ${borderClass}`}>
              <Field label="Tax Rate (%)">
                <input type="number" className={inputClass} value={salesSettings.taxRate} onChange={(e) => setSalesSettings((s) => ({ ...s, taxRate: Number(e.target.value) }))} />
              </Field>
              <Field label="Invoice Prefix">
                <input className={inputClass} value={salesSettings.invoicePrefix} onChange={(e) => setSalesSettings((s) => ({ ...s, invoicePrefix: e.target.value }))} />
              </Field>
              <Field label="Payment Terms">
                <select className={selectClass} value={salesSettings.paymentTerms} onChange={(e) => setSalesSettings((s) => ({ ...s, paymentTerms: e.target.value }))}>
                  {["Due on Receipt", "Net 15", "Net 30", "Net 60"].map((v) => <option key={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Default Discount (%)">
                <input type="number" className={inputClass} value={salesSettings.discount} onChange={(e) => setSalesSettings((s) => ({ ...s, discount: Number(e.target.value) }))} />
              </Field>
            </div>
            <div className={`mt-4 pt-4 border-t ${borderClass}`}>
              <ToggleRow title="Auto-generate Invoice Number" desc="Number new invoices sequentially — not active yet" checked={salesSettings.autoInvoiceNumber} onChange={(v) => setSalesSettings((s) => ({ ...s, autoInvoiceNumber: v }))} darkMode={darkMode} />
              <ToggleRow title="Send Payment Reminders" desc="Remind clients automatically before due date — not active yet" checked={salesSettings.paymentReminders} onChange={(v) => setSalesSettings((s) => ({ ...s, paymentReminders: v }))} darkMode={darkMode} last />
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Notifications */}
        {tab === "notifications" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Notifications" subtitle="Choose how you're notified for each event. Changes save instantly." darkMode={darkMode} />
            <div className={`mt-4 rounded-lg p-3 border flex flex-wrap items-center justify-between gap-3 ${darkMode ? "border-slate-800 bg-slate-800/40" : "border-slate-100 bg-slate-50"}`}>
              <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                <p className={`text-[12px] font-semibold ${cardText}`}>
                  {!notifStatus
                    ? "Checking push status..."
                    : !notifStatus.push_configured
                    ? "Push isn't set up on the server"
                    : notifStatus.devices > 0
                    ? `Push is on for ${notifStatus.devices} of your device${notifStatus.devices === 1 ? "" : "s"}`
                    : "Push isn't enabled on this device yet"}
                </p>
                <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>
                  {notifStatus && !notifStatus.push_configured
                    ? notifStatus.push_problem || "Ask your developer to set the VAPID keys in the backend settings."
                    : "Email is sent only when \"Allow Email Notifications\" is on in General."}
                  {notifStatus && !notifStatus.company_email_enabled ? " It is currently OFF, so no emails are being sent." : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                {notifStatus?.push_configured && (
                  <button
                    disabled={notifBusy}
                    onClick={enableBrowserNotifications}
                    className={`text-[11px] font-semibold rounded-md px-3 py-1.5 border disabled:opacity-60 ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-white"}`}
                  >
                    Enable on this device
                  </button>
                )}
                <button
                  disabled={notifBusy}
                  onClick={runNotificationTest}
                  className="text-[11px] font-semibold rounded-md px-3 py-1.5 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-60"
                >
                  {notifBusy ? "Working..." : "Send test notification"}
                </button>
                <button
                  disabled={notifBusy}
                  onClick={runClosedAppTest}
                  className={`text-[11px] font-semibold rounded-md px-3 py-1.5 border disabled:opacity-60 ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-white"}`}
                >
                  Test with app closed (15s)
                </button>
              </div>
            </div>
            <PhoneNotificationHelp darkMode={darkMode} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[300px]">
                <thead>
                  <tr className={`text-[10.5px] uppercase tracking-wide ${subtleText}`}>
                    <th className="py-2 font-semibold">Event</th>
                    <th className="py-2 font-semibold text-center w-14 sm:w-20">Email</th>
                    <th className="py-2 font-semibold text-center w-14 sm:w-20">Push</th>
                    <th className="py-2 font-semibold text-center w-14 sm:w-20" title="SMS delivery needs an SMS provider, which isn't connected yet">SMS*</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((n) => (
                    <tr key={n.id} className={`border-t ${borderClass}`}>
                      <td className={`py-2.5 text-[12px] font-medium ${cardText}`}>{n.label}</td>
                      {["email", "push", "sms"].map((ch) => (
                        <td key={ch} className="py-2.5 text-center">
                          <div className="flex justify-center">
                            <Toggle checked={n[ch]} onChange={(v) => toggleNotification(n.id, ch, v)} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={`mt-3 text-[10.5px] ${subtleText}`}>* SMS choices are saved, but text messages can't be sent until an SMS provider is connected.</p>
          </div>
        )}

        {/* ---------------------------------------------- Security */}
        {tab === "security" && (
          <>
            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <h2 className={`text-base font-bold ${headingText}`}>Change Password</h2>
              <p className={`text-xs mt-1 ${mutedText}`}>Use a strong password you don't use elsewhere.</p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
                {[
                  { key: "current", label: "Current Password" },
                  { key: "next", label: "New Password" },
                  { key: "confirm", label: "Confirm New Password" },
                ].map(({ key, label }) => (
                  <Field key={key} label={label}>
                    <div className="relative">
                      <input
                        type={showPw[key] ? "text" : "password"}
                        className={inputClass + " pr-8"}
                        value={pwForm[key]}
                        onChange={(e) => setPwForm((f) => ({ ...f, [key]: e.target.value }))}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw((s) => ({ ...s, [key]: !s[key] }))}
                        className={`absolute right-2 top-1/2 -translate-y-1/2 ${subtleText}`}
                      >
                        {showPw[key] ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </Field>
                ))}
              </div>
              <button
                disabled={pwSaving}
                onClick={async () => {
                  if (!pwForm.current || !pwForm.next) {
                    showToast("Fill in all password fields");
                    return;
                  }
                  if (pwForm.next.length < 8) {
                    showToast("New password should be at least 8 characters");
                    return;
                  }
                  if (pwForm.next !== pwForm.confirm) {
                    showToast("New passwords don't match");
                    return;
                  }
                  if (!user) {
                    showToast("You need to be logged in to change your password.");
                    return;
                  }
                  // FIX: this used to compare pwForm.current straight against
                  // user.password in local state — but the backend NEVER
                  // sends the password back to the frontend (UserSerializer
                  // deliberately omits it, and it's hashed anyway), so that
                  // comparison was always against `undefined` and could
                  // never succeed. The real check now happens server-side,
                  // via POST /api/auth/change-password/ (users/views.py ->
                  // ChangePasswordView), which verifies pwForm.current with
                  // Django's check_password() against the real hashed
                  // password and only then hashes + saves pwForm.next. See
                  // AuthContext's changePassword() for the actual call.
                  if (typeof changePassword !== "function") {
                    showToast("Couldn't update your password right now. Try again later.");
                    return;
                  }
                  setPwSaving(true);
                  const result = await changePassword(pwForm.current, pwForm.next);
                  setPwSaving(false);
                  if (!result?.success) {
                    showToast(result?.error || "Couldn't save your new password. Try again.");
                    return;
                  }
                  setPwForm({ current: "", next: "", confirm: "" });
                  showToast("Password updated successfully");
                }}
                className="mt-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-4 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition disabled:opacity-60"
              >
                {pwSaving ? "Updating..." : "Update Password"}
              </button>
            </div>

            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <h3 className={`text-[13px] font-semibold ${cardText}`}>Two-Factor Authentication</h3>
              <ToggleRow
                title={security.twoFactor ? "2FA is enabled" : "Enable Two-Factor Authentication"}
                desc={security.twoFactor ? "A code from your authenticator app is asked at every sign-in" : "Ask for an authenticator-app code at sign-in (Google Authenticator, Authy, Microsoft Authenticator...)"}
                checked={security.twoFactor}
                onChange={(v) => {
                  if (v) return startTwoFactor();
                  setTwoFaOff({ password: "", code: "", busy: false, error: "" });
                  setModal({ type: "disable2fa" });
                }}
                darkMode={darkMode}
                last
              />
              {security.twoFactor && (
                <p className={`mt-2 text-[10.5px] ${subtleText}`}>
                  {backupLeft} backup code{backupLeft === 1 ? "" : "s"} left.{" "}
                  <button
                    onClick={() => {
                      setTwoFaOff({ password: "", code: "", busy: false, error: "" });
                      setModal({ type: "backupCodes" });
                    }}
                    className="font-semibold text-violet-500 hover:text-violet-400"
                  >
                    Get new backup codes
                  </button>
                </p>
              )}
            </div>

            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-[13px] font-semibold ${cardText}`}>Recent Sign-ins</h3>
                <button
                  onClick={() =>
                    setConfirm({
                      title: "Sign out other devices",
                      message: "Every other device and browser signed in to your account will be signed out. This device stays signed in.",
                      danger: true,
                      confirmLabel: "Sign out others",
                      onConfirm: handleSignOutOthers,
                    })
                  }
                  className={`text-[11px] font-semibold ${darkMode ? "text-rose-400 hover:text-rose-300" : "text-rose-500 hover:text-rose-600"}`}
                >
                  Sign out other devices
                </button>
              </div>
              <div className="mt-3 space-y-1.5">
                {sessionsLoading && sessions.length === 0 && <p className={`text-[11px] ${subtleText}`}>Loading...</p>}
                {sessionsError && <p className="text-[11px] text-rose-500">{sessionsError}</p>}
                {!sessionsLoading && !sessionsError && sessions.length === 0 && <p className={`text-[11px] ${subtleText}`}>No sign-ins recorded yet.</p>}
                {sessions.map((s) => {
                  const DeviceIcon = /iphone|android/i.test(s.device) ? Smartphone : Monitor;
                  return (
                    <div key={s.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <DeviceIcon size={15} className="text-violet-500 shrink-0" />
                        <span className="min-w-0">
                          <span className={`flex items-center gap-1.5 text-[11.5px] font-semibold truncate ${cardText}`}>
                            {s.device} {s.current && <Badge tone="violet" darkMode={darkMode}>This device</Badge>}
                          </span>
                          <span className={`block text-[10.5px] truncate ${subtleText}`}>
                            {s.ip || "IP unknown"} · signed in {formatDateTime(s.signed_in_at)} · {s.method}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className={`mt-2 text-[10px] ${subtleText}`}>All your devices share one sign-in, so they can be signed out together but not one by one.</p>
            </div>
          </>
        )}

        {/* ---------------------------------------------- Billing */}
        {tab === "billing" && (
          <>
            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <SectionHeading
                title="Billing"
                subtitle="Manage your subscription, payment method and invoices."
                darkMode={darkMode}
                action={
                  <button
                    onClick={() => setModal({ type: "changePlan" })}
                    className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
                  >
                    <Crown size={13} /> Change Plan
                  </button>
                }
              />
              <div className={`mt-4 pt-4 border-t flex items-center justify-between flex-wrap gap-3 ${borderClass}`}>
                <div>
                  <p className={`text-[11px] ${subtleText}`}>Current Plan</p>
                  <p className={`text-sm font-bold flex items-center gap-1.5 mt-0.5 ${cardText}`}>
                    <Crown size={14} className="text-amber-500" /> {billing.plan ? `${billing.plan} Plan` : "No plan selected"}
                  </p>
                  {billing.plan && <p className={`text-[10.5px] mt-0.5 ${subtleText}`}>{billing.price ? `${formatMoney(billing.price)} / month` : "Custom pricing"}{billing.nextBillingDate ? ` · renews ${formatDate(billing.nextBillingDate)}` : ""}</p>}
                </div>
                <div>
                  <p className={`text-[11px] ${subtleText}`}>Payment Method</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className={`text-sm font-bold ${cardText}`}>{billing.cardLast4 ? `${billing.cardBrand || "Card"} •••• ${billing.cardLast4}` : "No card on file"}</p>
                    <button onClick={() => setModal({ type: "payment" })} className="text-[11px] font-semibold text-violet-500 hover:text-violet-600">
                      Update
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <h3 className={`text-[13px] font-semibold mb-3 ${cardText}`}>Billing History</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[420px]">
                  <thead>
                    <tr className={`text-[10.5px] uppercase tracking-wide ${subtleText}`}>
                      <th className="py-2 font-semibold">Date</th>
                      <th className="py-2 font-semibold">Description</th>
                      <th className="py-2 font-semibold">Amount</th>
                      <th className="py-2 font-semibold">Status</th>
                      <th className="py-2 font-semibold text-right">Invoice</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billing.history.length === 0 && (
                      <tr className={`border-t ${borderClass}`}>
                        <td colSpan={5} className={`py-6 text-center text-[11.5px] ${subtleText}`}>No billing activity yet. Plan and payment-method changes will appear here.</td>
                      </tr>
                    )}
                    {billing.history.map((row) => (
                      <tr key={row.id} className={`border-t ${borderClass}`}>
                        <td className={`py-2.5 text-[11.5px] ${mutedText}`}>{formatDate(row.date)}</td>
                        <td className={`py-2.5 text-[11.5px] font-medium ${cardText}`}>{row.description}</td>
                        <td className={`py-2.5 text-[11.5px] ${mutedText}`}>{formatMoney(row.amount)}</td>
                        <td className="py-2.5"><Badge tone="emerald" darkMode={darkMode}>{row.status}</Badge></td>
                        <td className="py-2.5 text-right">
                          <IconBtn icon={Download} darkMode={darkMode} title="Download invoice" onClick={() => downloadInvoice(row)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ---------------------------------------------- Right rail */}
      {/* Storage, Subscription, System Information and the Danger Zone are
          account/company-level controls — visible to Admin only. Non-admin
          users never see this column at all (grid template above drops the
          280px track for them too, so no empty gap is left behind). */}
      {hasFullSettingsAccess && (
      <div className="space-y-4">
        <div className={`rounded-xl p-4 shadow-sm ${card}`}>
          <h3 className={`text-[12.5px] font-semibold flex items-center gap-1.5 ${cardText}`}>
            <HardDrive size={13} className="text-violet-500" /> Storage Usage
          </h3>
          <div className="flex items-center justify-between mt-3">
            <span className={`text-[11px] ${mutedText}`}>Company Storage</span>
            <span className={`text-[10.5px] ${subtleText}`}>
              {storage ? `${formatBytes(storage.used_bytes)} of ${formatBytes(storage.limit_bytes)} used` : storageError ? "Unavailable" : "Calculating..."}
            </span>
          </div>
          <div className={`w-full h-2 rounded-full mt-2 overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
            <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-indigo-500" style={{ width: `${storagePct}%` }} />
          </div>
          <button
            onClick={() => setModal({ type: "storage" })}
            className={`mt-3 w-full text-[11px] font-semibold rounded-lg py-2 ${darkMode ? "bg-slate-800 text-violet-300 hover:bg-slate-700" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}
          >
            Manage Storage
          </button>
          {storageError && <p className="text-[10.5px] mt-2 text-rose-500">{storageError}</p>}
        </div>

        <div className={`rounded-xl p-4 shadow-sm ${card}`}>
          <h3 className={`text-[12.5px] font-semibold ${cardText}`}>Subscription Plan</h3>
          <div className="flex items-center justify-between mt-3">
            <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${cardText}`}>
              <Crown size={13} className="text-amber-500" /> {billing.plan ? `${billing.plan} Plan` : "No plan"}
            </span>
            {billing.plan && <Badge tone="emerald" darkMode={darkMode}>Active</Badge>}
          </div>
          <p className={`text-[10.5px] mt-1 ${subtleText}`}>Next billing date: {formatDate(billing.nextBillingDate)}</p>
          <ul className="mt-3 space-y-1.5">
            {billing.features.map((f) => (
              <li key={f} className={`flex items-center gap-1.5 text-[11px] ${mutedText}`}>
                <Check size={12} className="text-emerald-500 shrink-0" /> {f}
              </li>
            ))}
          </ul>
          <button
            onClick={() => {
              setTab("billing");
              setModal({ type: "changePlan" });
            }}
            className="mt-3 w-full text-[11px] font-semibold rounded-lg py-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90"
          >
            Manage Subscription
          </button>
        </div>

        <div className={`rounded-xl p-4 shadow-sm ${card}`}>
          <h3 className={`text-[12.5px] font-semibold flex items-center gap-1.5 ${cardText}`}>
            <Info size={13} className="text-violet-500" /> System Information
          </h3>
          <div className="mt-3 space-y-2">
            {(sysInfo
              ? [
                  ["System Version", sysInfo.version || "Not reported"],
                  ["Last Restart", sysInfo.started_at ? formatDateTime(sysInfo.started_at) : "—"],
                  ["System Status", sysInfo.status === "operational" ? "All Systems Operational" : "Degraded", sysInfo.status === "operational" ? "ok" : "bad"],
                  ["Database", sysInfo.database.ok ? `Connected${sysInfo.database.latency_ms != null ? ` · ${sysInfo.database.latency_ms} ms` : ""}` : "Unavailable", sysInfo.database.ok ? "ok" : "bad"],
                  ["Push", sysInfo.push_configured ? "Configured" : "Not configured", sysInfo.push_configured ? "ok" : "bad"],
                  ["Backups", "Handled by your database host"],
                ]
              : [["Status", sysInfoError || "Checking...", sysInfoError ? "bad" : undefined]]
            ).map(([label, value, kind]) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <span className={`text-[11px] ${mutedText}`}>{label}</span>
                <span className={`text-[10.5px] font-medium flex items-center gap-1 text-right ${kind === "ok" ? "text-emerald-600" : kind === "bad" ? "text-rose-500" : cardText}`}>
                  {kind && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${kind === "ok" ? "bg-emerald-500" : "bg-rose-500"}`} />}
                  {value}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setModal({ type: "logs" })}
            className={`mt-3 w-full text-[11px] font-semibold rounded-lg py-2 ${darkMode ? "bg-slate-800 text-violet-300 hover:bg-slate-700" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}
          >
            View System Logs
          </button>
        </div>

        <div className="rounded-xl p-4 shadow-sm bg-rose-50/60 border border-rose-100">
          <h3 className="text-[12.5px] font-semibold flex items-center gap-1.5 text-rose-600">
            <AlertTriangle size={13} /> Danger Zone
          </h3>
          <div className="mt-3">
            <p className="text-[11.5px] font-semibold text-rose-600">Reset System Settings</p>
            <p className="text-[10.5px] text-rose-400 mt-0.5">This will reset all settings to default values.</p>
            <button
              onClick={() =>
                setConfirm({
                  title: "Reset system settings",
                  message: "This puts the saved preferences — Projects, Tasks, Income, Expenses, Sales, display options and your notification choices — back to their defaults. Your company name and details, logo, billing, users, departments and all your data stay exactly as they are.",
                  danger: true,
                  confirmLabel: "Reset Settings",
                  onConfirm: resetEverything,
                })
              }
              className="mt-2 w-full text-[11px] font-semibold rounded-lg py-2 border border-rose-200 text-rose-600 bg-white hover:bg-rose-50"
            >
              Reset Settings
            </button>
          </div>
          <div className="mt-4">
            <p className="text-[11.5px] font-semibold text-rose-600">Delete Account</p>
            <p className="text-[10.5px] text-rose-400 mt-0.5">
              {deletion.requested
                ? `Deletion requested ${formatDateTime(deletion.requested_at)}. Nothing has been deleted — your other admins were told.`
                : "Ask to delete the company account. This only records a request; nothing is deleted automatically."}
            </p>
            {deletion.requested ? (
              <button
                onClick={withdrawDeletionRequest}
                className="mt-2 w-full text-[11px] font-semibold rounded-lg py-2 border border-rose-200 text-rose-600 bg-white hover:bg-rose-50"
              >
                Cancel deletion request
              </button>
            ) : (
              <button
                onClick={() => {
                  setDeleteConfirmText("");
                  setDeletePassword("");
                  setDeleteError("");
                  setModal({ type: "deleteAccount" });
                }}
                className="mt-2 w-full text-[11px] font-semibold rounded-lg py-2 bg-rose-600 text-white hover:bg-rose-700"
              >
                Request Account Deletion
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ================================================ Modals ================================================ */}

      {/* Add / edit user */}
      <Modal open={modal?.type === "user"} onClose={closeModal} title={modal?.data ? "Edit User" : "Add User"} darkMode={darkMode}>
        <UserForm
          darkMode={darkMode}
          inputClass={inputClass}
          selectClass={selectClass}
          initial={modal?.data}
          departments={departments}
          onCancel={closeModal}
          onSubmit={async (data) => {
            const backendRole = ROLE_DISPLAY_TO_BACKEND[data.role] || data.role.toLowerCase();
            if (modal?.data) {
              // Editing an existing user — role/department change only.
              const result = await updateUserRole(modal.data.id, backendRole, data.department);
              if (result?.success === false) {
                showToast(result.error || "Couldn't update user");
                return;
              }
              showToast("User updated");
            } else {
              // New user — real invite, sends them a real login email
              // (see InviteUserView on the backend).
              const result = await inviteUser({ name: data.name, email: data.email, role: backendRole, department: data.department });
              if (result?.success === false) {
                showToast(result.error || "Couldn't invite user");
                return;
              }
              showToast("Invitation sent");
            }
            closeModal();
          }}
        />
      </Modal>

      {/* Add / edit department */}
      <Modal open={modal?.type === "department"} onClose={closeModal} title={modal?.data ? "Edit Department" : "Add Department"} darkMode={darkMode}>
        <DepartmentForm
          darkMode={darkMode}
          inputClass={inputClass}
          initial={modal?.data}
          onCancel={closeModal}
          people={users.filter((u) => u._backendStatus === "approved")}
          onSubmit={async (data) => {
            const res = modal?.data ? await updateDepartment(modal.data.id, data) : await createDepartment(data);
            if (!res.success) return res.error || "Couldn't save the department";
            // renaming also renames it on every user, so re-read both lists
            await loadDepartments();
            refreshUsers?.();
            showToast(modal?.data ? "Department updated" : "Department added");
            closeModal();
          }}
        />
      </Modal>

      {/* Enable 2FA — real authenticator setup */}
      <Modal open={modal?.type === "enable2fa"} onClose={closeModal} title={twoFa.backupCodes ? "Save your backup codes" : "Enable Two-Factor Authentication"} darkMode={darkMode} widthClass="max-w-sm">
        {twoFa.backupCodes ? (
          <div className="space-y-3">
            <p className={`text-[11.5px] ${mutedText}`}>
              Two-factor is on. Keep these one-time codes somewhere safe — each works once if you lose your phone. They are shown only now.
            </p>
            <div className={`grid grid-cols-2 gap-1.5 rounded-lg p-3 font-mono text-[12px] ${darkMode ? "bg-slate-800 text-slate-100" : "bg-slate-100 text-slate-800"}`}>
              {twoFa.backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(twoFa.backupCodes.join("\n"));
                showToast("Backup codes copied");
              }}
              className={`w-full text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              Copy codes
            </button>
            <button
              onClick={() => {
                setTwoFa((t) => ({ ...t, backupCodes: null }));
                closeModal();
              }}
              className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg py-2 text-xs font-semibold hover:opacity-90"
            >
              I've saved them
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-3">
            {twoFa.setup ? (
              <>
                <img src={twoFa.setup.qr} alt="Authenticator QR code" className="w-40 h-40 rounded-lg bg-white p-1" />
                <p className={`text-[11.5px] ${mutedText}`}>Scan this with your authenticator app, then type the 6-digit code it shows.</p>
                <p className={`text-[10.5px] break-all ${subtleText}`}>
                  Can't scan? Enter this key by hand: <span className="font-mono font-semibold">{twoFa.setup.secret}</span>
                </p>
                <input
                  className={inputClass + " text-center tracking-[0.3em]"}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={twoFa.code}
                  onChange={(e) => setTwoFa((t) => ({ ...t, code: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
                />
              </>
            ) : (
              <p className={`text-[11.5px] ${twoFa.error ? "text-rose-500" : mutedText}`}>{twoFa.error || "Preparing your setup..."}</p>
            )}
            {twoFa.setup && twoFa.error && <p className="text-[11px] text-rose-500">{twoFa.error}</p>}
            {twoFa.setup && (
              <button
                disabled={twoFa.busy || twoFa.code.length !== 6}
                onClick={confirmTwoFactor}
                className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg py-2 text-xs font-semibold hover:opacity-90 disabled:opacity-60"
              >
                {twoFa.busy ? "Checking..." : "Verify & Enable"}
              </button>
            )}
          </div>
        )}
      </Modal>

      {/* Turn 2FA off / new backup codes — both need password + a current code */}
      <Modal open={modal?.type === "disable2fa" || modal?.type === "backupCodes"} onClose={closeModal} title={modal?.type === "backupCodes" ? "New backup codes" : "Turn off Two-Factor Authentication"} darkMode={darkMode} widthClass="max-w-sm">
        <div className="space-y-3">
          <p className={`text-[11.5px] ${mutedText}`}>
            {modal?.type === "backupCodes"
              ? "Confirm it's you. This replaces your old backup codes with 8 new ones."
              : "Confirm it's you. Your account will go back to password-only sign-in."}
          </p>
          <input type="password" className={inputClass} placeholder="Account password" value={twoFaOff.password} onChange={(e) => setTwoFaOff((t) => ({ ...t, password: e.target.value }))} />
          <input className={inputClass} inputMode="numeric" autoComplete="one-time-code" placeholder="Code from your authenticator app" value={twoFaOff.code} onChange={(e) => setTwoFaOff((t) => ({ ...t, code: e.target.value.slice(0, 12) }))} />
          {twoFaOff.error && <p className="text-[11px] text-rose-500">{twoFaOff.error}</p>}
          <button
            disabled={twoFaOff.busy || !twoFaOff.password || !twoFaOff.code}
            onClick={modal?.type === "backupCodes" ? newBackupCodes : confirmDisableTwoFactor}
            className={`w-full text-xs font-semibold rounded-lg py-2 text-white disabled:opacity-60 ${modal?.type === "backupCodes" ? "bg-gradient-to-r from-violet-600 to-indigo-600" : "bg-rose-600 hover:bg-rose-700"}`}
          >
            {twoFaOff.busy ? "Working..." : modal?.type === "backupCodes" ? "Create new codes" : "Turn off"}
          </button>
        </div>
      </Modal>

      {/* Change plan */}
      <Modal open={modal?.type === "changePlan"} onClose={closeModal} title="Choose a Plan" darkMode={darkMode} widthClass="max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {billing.plans.length === 0 && <p className={`text-[11.5px] sm:col-span-3 ${subtleText}`}>Couldn't load plans from the server. Check your connection and reopen this window.</p>}
          {billing.plans.map((p) => {
            const isCurrent = p.name === billing.plan;
            return (
              <div key={p.name} className={`rounded-lg p-3.5 border flex flex-col ${isCurrent ? "border-violet-500" : darkMode ? "border-slate-800" : "border-slate-200"}`}>
                <p className={`text-[12.5px] font-bold ${cardText}`}>{p.name}</p>
                <p className={`text-[15px] font-extrabold mt-1 ${cardText}`}>{formatPlanPrice(p)}</p>
                <ul className="mt-2.5 space-y-1.5 flex-1">
                  {p.features.map((f) => (
                    <li key={f} className={`flex items-start gap-1.5 text-[10.5px] ${mutedText}`}>
                      <Check size={11} className="text-emerald-500 shrink-0 mt-0.5" /> {f}
                    </li>
                  ))}
                </ul>
                <button
                  disabled={isCurrent}
                  onClick={async () => {
                    // Saved on the server (price, storage limit and renewal date
                    // are decided there); the response replaces local billing state.
                    const result = await updateBillingInfo({ plan: p.name });
                    if (result?.success === false) {
                      showToast(result.error || "Couldn't switch plans");
                      return;
                    }
                    if (result?.data) setBilling(result.data);
                    loadStorage(true);
                    closeModal();
                    showToast(`Switched to the ${p.name} plan`);
                  }}
                  className={`mt-3 w-full text-[11px] font-semibold rounded-md py-2 ${
                    isCurrent
                      ? `cursor-default ${darkMode ? "bg-slate-800 text-slate-500" : "bg-slate-100 text-slate-400"}`
                      : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90"
                  }`}
                >
                  {isCurrent ? "Current Plan" : "Select"}
                </button>
              </div>
            );
          })}
        </div>
      </Modal>

      {/* Update payment method */}
      <Modal open={modal?.type === "payment"} onClose={closeModal} title="Update Payment Method" darkMode={darkMode}>
        <PaymentForm
          darkMode={darkMode}
          inputClass={inputClass}
          onCancel={closeModal}
          onSubmit={async (last4, cardBrand, cardExpiry) => {
            // Only the masked card (last 4, brand, expiry) is sent — never the
            // full number or CVV.
            const result = await updateBillingInfo({ cardLast4: last4, cardBrand, cardExpiry });
            if (result?.success === false) {
              showToast(result.error || "Couldn't update payment method");
              return;
            }
            if (result?.data) setBilling(result.data);
            closeModal();
            showToast("Payment method updated");
          }}
        />
      </Modal>

      {/* Storage manager — real numbers from the backend */}
      <Modal open={modal?.type === "storage"} onClose={closeModal} title="Manage Storage" darkMode={darkMode}>
        {!storage ? (
          <p className={`text-[11.5px] ${storageError ? "text-rose-500" : subtleText}`}>{storageError || "Calculating storage..."}</p>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-3">
              <span className={`text-sm font-bold ${cardText}`}>{formatBytes(storage.used_bytes)} <span className={`text-[11px] font-medium ${subtleText}`}>of {formatBytes(storage.limit_bytes)}</span></span>
              <span className={`text-[10.5px] ${subtleText}`}>{storage.file_count.toLocaleString()} files · {storage.source}</span>
            </div>
            <div className="space-y-2.5">
              {storage.breakdown.map((b) => (
                <div key={b.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[11.5px] font-medium ${cardText}`}>{b.label}</span>
                    <span className={`text-[10.5px] ${subtleText}`}>{formatBytes(b.bytes)} · {b.files.toLocaleString()} file{b.files === 1 ? "" : "s"}</span>
                  </div>
                  <div className={`w-full h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                    <div className="h-full rounded-full" style={{ width: `${storage.used_bytes ? Math.max(b.bytes ? 2 : 0, (b.bytes / storage.used_bytes) * 100) : 0}%`, backgroundColor: b.color }} />
                  </div>
                </div>
              ))}
            </div>
            {storage.note && <p className="text-[10.5px] mt-3 text-amber-500">{storage.note}</p>}
            <p className={`text-[10.5px] mt-3 ${subtleText}`}>Storage limit comes from your {billing.plan || "current"} plan. Updated {new Date(storage.measured_at * 1000).toLocaleTimeString()}.</p>
          </>
        )}
        <button
          disabled={storageLoading}
          onClick={async () => {
            await loadStorage(true);
            showToast("Storage usage refreshed");
          }}
          className={`mt-4 w-full text-[11px] font-semibold rounded-lg py-2 disabled:opacity-60 ${darkMode ? "bg-slate-800 text-violet-300 hover:bg-slate-700" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}
        >
          {storageLoading ? "Recalculating..." : "Recalculate Now"}
        </button>
      </Modal>

      {/* System logs */}
      <Modal open={modal?.type === "logs"} onClose={closeModal} title="System Logs" darkMode={darkMode} widthClass="max-w-lg">
        <div className="flex items-center gap-1.5 mb-3">
          <Filter size={12} className={subtleText} />
          {["all", "info", "warning", "error"].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLogFilter(lvl)}
              className={`text-[10.5px] font-semibold px-2.5 py-1 rounded-full capitalize ${
                logFilter === lvl
                  ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                  : darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"
              }`}
            >
              {lvl}
            </button>
          ))}
          <button
            onClick={() => loadLogs(logFilter)}
            className={`ml-auto w-7 h-7 rounded-md flex items-center justify-center ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
            title="Refresh"
          >
            <RefreshCw size={13} className={logsLoading ? "animate-spin" : ""} />
          </button>
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {logsError && <p className="text-[11px] text-rose-500 py-2">{logsError}</p>}
          {logs.map((log) => (
            <div key={log.id} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${log.level === "error" ? "bg-rose-500" : log.level === "warning" ? "bg-amber-500" : "bg-emerald-500"}`} />
              <span className="min-w-0">
                <span className={`block text-[11.5px] font-medium ${cardText}`}>{log.message}</span>
                <span className={`block text-[10px] ${subtleText}`}>{formatDateTime(log.time)} · {log.actor}{log.module ? ` · ${log.module}` : ""}</span>
              </span>
            </div>
          ))}
          {!logsLoading && !logsError && logs.length === 0 && <p className={`text-[11px] italic text-center py-6 ${subtleText}`}>No {logFilter === "all" ? "" : logFilter + " "}logs yet.</p>}
        </div>
      </Modal>

      {/* Delete account — records a request only */}
      <Modal open={modal?.type === "deleteAccount"} onClose={closeModal} title="Request Account Deletion" darkMode={darkMode} widthClass="max-w-sm">
        <p className={`text-xs leading-relaxed ${mutedText}`}>
          This records a request to delete the company account and tells your other admins. <b>Nothing is deleted</b> — removing company data is a separate, deliberate step. You can cancel the request any time. Type <span className="font-bold text-rose-500">DELETE</span> and your password to continue.
        </p>
        <input className={inputClass + " mt-3"} value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="Type DELETE" />
        <input type="password" className={inputClass + " mt-2"} value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Your password" />
        {deleteError && <p className="text-[11px] text-rose-500 mt-2">{deleteError}</p>}
        <div className="flex items-center gap-2 mt-4">
          <button onClick={closeModal} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            Cancel
          </button>
          <button
            disabled={deleteConfirmText !== "DELETE" || !deletePassword || deleteBusy}
            onClick={submitDeletionRequest}
            className={`flex-1 text-xs font-semibold rounded-lg py-2 text-white ${deleteConfirmText === "DELETE" && deletePassword ? "bg-rose-600 hover:bg-rose-700" : "bg-rose-300 cursor-not-allowed"}`}
          >
            {deleteBusy ? "Sending..." : "Send Request"}
          </button>
        </div>
      </Modal>

      {/* Generic confirm dialog */}
      <ConfirmModal
        open={!!confirm}
        onClose={closeConfirm}
        onConfirm={confirm?.onConfirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmLabel={confirm?.confirmLabel}
        danger={confirm?.danger}
        darkMode={darkMode}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-[60] flex items-center gap-2 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-lg">
          <ShieldCheck size={14} className="text-emerald-400" /> {toast}
        </div>
      )}

    </div>
    </CompactModeContext.Provider>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal form components                                              */
/* ------------------------------------------------------------------ */
function UserForm({ initial, departments, onSubmit, onCancel, darkMode, inputClass, selectClass }) {
  const [form, setForm] = useState({
    name: initial?.name || "",
    email: initial?.email || "",
    role: initial?.role || USER_ROLES[2],
    department: initial?.department || departments[0]?.name || "",
  });
  const [error, setError] = useState("");
  const isEditing = !!initial;
  return (
    <div className="space-y-3">
      <Field label="Full Name">
        <input disabled={isEditing} className={inputClass + (isEditing ? " opacity-60 cursor-not-allowed" : "")} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Email">
        <input disabled={isEditing} type="email" className={inputClass + (isEditing ? " opacity-60 cursor-not-allowed" : "")} value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
      </Field>
      {isEditing && <p className="text-[10.5px] text-slate-400 -mt-1.5">Name and email can't be changed here — only role and department.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role">
          <select className={selectClass} value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
            {USER_ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Department">
          <select className={selectClass} value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}>
            {departments.map((d) => <option key={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cancel
        </button>
        <button
          onClick={() => {
            if (!form.name.trim() || !form.email.trim()) {
              setError("Name and email are required.");
              return;
            }
            onSubmit(form);
          }}
          className="flex-1 text-xs font-semibold rounded-lg py-2 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"
        >
          {initial ? "Save Changes" : "Add User"}
        </button>
      </div>
    </div>
  );
}

function DepartmentForm({ initial, people = [], onSubmit, onCancel, darkMode, inputClass }) {
  const [form, setForm] = useState({ name: initial?.name || "", headId: initial?.headId || "", budget: initial?.budget ?? 0 });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The head must be a real person in the system. Non-admins can't fetch the
  // user list, so keep the current head selectable from what we know.
  const options = people.some((p) => p.id === initial?.headId) || !initial?.headId ? people : [{ id: initial.headId, name: initial.head }, ...people];

  async function submit() {
    if (!form.name.trim()) return setError("Department name is required.");
    if (Number(form.budget) < 0) return setError("Budget can't be negative.");
    setSaving(true);
    const message = await onSubmit({ name: form.name.trim(), headId: form.headId ? Number(form.headId) : null, budget: Number(form.budget) || 0 });
    setSaving(false);
    if (message) setError(message);
  }

  return (
    <div className="space-y-3">
      <Field label="Department Name">
        <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Department Head">
        <select className={inputClass} value={form.headId} onChange={(e) => setForm((f) => ({ ...f, headId: e.target.value }))}>
          <option value="">No head assigned</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Monthly Budget (₨)">
        <input type="number" min="0" className={inputClass} value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))} />
      </Field>
      {initial && initial.name !== form.name.trim() && form.name.trim() && (
        <p className="text-[10.5px] text-amber-500">Renaming also updates the department on all {initial.totalUsers} user{initial.totalUsers === 1 ? "" : "s"} in it.</p>
      )}
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={submit}
          className="flex-1 text-xs font-semibold rounded-lg py-2 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving..." : initial ? "Save Changes" : "Add Department"}
        </button>
      </div>
    </div>
  );
}

function detectCardBrand(digits) {
  if (/^4/.test(digits)) return "Visa";
  if (/^(5[1-5]|2(2[2-9][1-9]|2[3-9]|[3-6]|7[01]|720))/.test(digits)) return "Mastercard";
  if (/^3[47]/.test(digits)) return "American Express";
  if (/^(6011|65|64[4-9])/.test(digits)) return "Discover";
  if (/^35(2[89]|[3-8])/.test(digits)) return "JCB";
  if (/^3(0[0-5]|[68])/.test(digits)) return "Diners Club";
  if (/^62/.test(digits)) return "UnionPay";
  return "Card";
}

function passesLuhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function PaymentForm({ onSubmit, onCancel, darkMode, inputClass }) {
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const digits = number.replace(/\D/g, "");
  const brand = detectCardBrand(digits);

  async function submit() {
    const m = expiry.match(/^(0[1-9]|1[0-2])\/(\d{2})$/);
    const cvvLen = brand === "American Express" ? 4 : 3;
    if (digits.length < 12 || digits.length > 19 || !passesLuhn(digits)) return setError("That card number doesn't look valid.");
    if (!m) return setError("Enter the expiry as MM/YY.");
    const now = new Date();
    const year = 2000 + Number(m[2]);
    if (year < now.getFullYear() || (year === now.getFullYear() && Number(m[1]) < now.getMonth() + 1)) {
      return setError("That card has expired.");
    }
    if (cvv.length !== cvvLen) return setError(`Enter the ${cvvLen}-digit security code.`);
    setError("");
    setSaving(true);
    await onSubmit(digits.slice(-4), brand, expiry);
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <Field label={`Card Number${digits ? ` · ${brand}` : ""}`}>
        <input
          className={inputClass}
          inputMode="numeric"
          autoComplete="off"
          placeholder="4242 4242 4242 4242"
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/[^\d ]/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").slice(0, 23))}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiry">
          <input
            className={inputClass}
            inputMode="numeric"
            autoComplete="off"
            placeholder="MM/YY"
            value={expiry}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, "").slice(0, 4);
              setExpiry(v.length > 2 ? `${v.slice(0, 2)}/${v.slice(2)}` : v);
            }}
            maxLength={5}
          />
        </Field>
        <Field label="CVV">
          <input className={inputClass} type="password" inputMode="numeric" autoComplete="off" placeholder="123" value={cvv} onChange={(e) => setCvv(e.target.value.replace(/\D/g, ""))} maxLength={4} />
        </Field>
      </div>
      <p className={`text-[10.5px] ${darkMode ? "text-slate-500" : "text-slate-400"}`}>Only the card brand, last 4 digits and expiry are saved. The full number and CVV never leave this window.</p>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={submit}
          className="flex-1 text-xs font-semibold rounded-lg py-2 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving..." : "Save Card"}
        </button>
      </div>
    </div>
  );
}