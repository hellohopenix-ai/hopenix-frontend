import React, { useRef, useState, useEffect, useContext, createContext } from "react";
import { useAuth } from "../AuthContext.jsx";
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

const DEFAULT_DEPARTMENTS = [
  { id: 1, name: "Management", head: "Hamna Jameel", members: 4, budget: 500000 },
  { id: 2, name: "Development", head: "Sara Khan", members: 12, budget: 1200000 },
  { id: 3, name: "Design", head: "Bilal Ahmed", members: 6, budget: 600000 },
  { id: 4, name: "Sales", head: "Ali Raza", members: 8, budget: 800000 },
  { id: 5, name: "Marketing", head: "Ayesha Tariq", members: 5, budget: 450000 },
];

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
  { id: 1, label: "Task Assigned", email: true, push: true, sms: false },
  { id: 2, label: "Task Completed", email: true, push: false, sms: false },
  { id: 3, label: "Project Update", email: true, push: true, sms: false },
  { id: 4, label: "Invoice Paid", email: true, push: true, sms: true },
  { id: 5, label: "New Message", email: false, push: true, sms: false },
  { id: 6, label: "System Alerts", email: true, push: true, sms: true },
];

const DEFAULT_SECURITY = {
  twoFactor: false,
  sessions: [
    { id: 1, device: "Chrome on Windows", location: "Lahore, Pakistan", lastActive: "Active now", current: true },
    { id: 2, device: "Safari on iPhone", location: "Lahore, Pakistan", lastActive: "2 hours ago", current: false },
    { id: 3, device: "Chrome on MacOS", location: "Karachi, Pakistan", lastActive: "3 days ago", current: false },
  ],
};

const DEFAULT_BILLING = {
  plan: "Business",
  cardLast4: "4242",
  cardBrand: "Visa",
  history: [
    { id: 1, date: "May 1, 2025", desc: "Business Plan - Monthly", amount: "₨ 24,999", status: "Paid" },
    { id: 2, date: "Apr 1, 2025", desc: "Business Plan - Monthly", amount: "₨ 24,999", status: "Paid" },
    { id: 3, date: "Mar 1, 2025", desc: "Business Plan - Monthly", amount: "₨ 24,999", status: "Paid" },
  ],
};

const PLANS = [
  { name: "Starter", price: "₨9,999/mo", features: ["10 Projects", "20 Users", "Basic AI Assistant", "Email Support"] },
  { name: "Business", price: "₨24,999/mo", features: ["Unlimited Projects", "Unlimited Users", "AI Assistant (Advanced)", "Priority Support"] },
  { name: "Enterprise", price: "Custom", features: ["Everything in Business", "Dedicated Manager", "Custom Integrations", "SLA & Onboarding"] },
];

const SYSTEM_LOGS = [
  { id: 1, level: "info", message: "Backup completed successfully", time: "Today, 03:00 AM" },
  { id: 2, level: "warning", message: "Storage usage exceeded 20%", time: "Yesterday, 6:45 PM" },
  { id: 3, level: "info", message: "12 users logged in", time: "Yesterday, 9:00 AM" },
  { id: 4, level: "error", message: "Failed payment attempt for invoice #1042", time: "2 days ago" },
  { id: 5, level: "info", message: "System updated to v2.4.1", time: "May 20, 2025" },
  { id: 6, level: "warning", message: "Unusual login location detected", time: "May 19, 2025" },
];

const STORAGE_BREAKDOWN = [
  { label: "Documents", size: 1.1, color: "#7c3aed" },
  { label: "Images", size: 0.75, color: "#0ea5e9" },
  { label: "Backups", size: 0.4, color: "#059669" },
  { label: "Other", size: 0.2, color: "#64748b" },
];

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
    <div className={`flex items-center justify-between gap-3 ${compact ? "py-1.5" : "py-3"} ${last ? "" : `border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}`}>
      <div className="min-w-0">
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
    getSecuritySettings,
    updateSecuritySettings,
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
  const NON_ADMIN_TAB_IDS = ["general", "profile", "security"];
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
  const [departments, setDepartments] = useState(() => loadJSON("hopenix_departments", DEFAULT_DEPARTMENTS));
  const [projectSettings, setProjectSettings] = useState(() => loadJSON("hopenix_project_settings", DEFAULT_PROJECT_SETTINGS));
  const [taskSettings, setTaskSettings] = useState(() => loadJSON("hopenix_task_settings", DEFAULT_TASK_SETTINGS));
  const [incomeSettings, setIncomeSettings] = useState(() => loadJSON("hopenix_income_settings", DEFAULT_INCOME_SETTINGS));
  const [expenseSettings, setExpenseSettings] = useState(() => loadJSON("hopenix_expense_settings", DEFAULT_EXPENSE_SETTINGS));
  const [salesSettings, setSalesSettings] = useState(() => loadJSON("hopenix_sales_settings", DEFAULT_SALES_SETTINGS));
  const [notifications, setNotifications] = useState(() => loadJSON("hopenix_notifications", DEFAULT_NOTIFICATIONS));
  const [security, setSecurity] = useState(() => loadJSON("hopenix_security", DEFAULT_SECURITY));
  const [billing, setBilling] = useState(() => loadJSON("hopenix_billing", DEFAULT_BILLING));

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
      }
      if (billingRes.success && billingRes.data) setBilling((b) => ({ ...b, ...billingRes.data }));
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
  const [storageUsedGb, setStorageUsedGb] = useState(() => Number(localStorage.getItem("hopenix_storage_used")) || 2.45);

  const [saved, setSaved] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [toast, setToast] = useState("");
  const [modal, setModal] = useState(null); // { type, data }
  const [confirm, setConfirm] = useState(null); // { title, message, onConfirm, danger, confirmLabel }
  const [userSearch, setUserSearch] = useState("");
  const [logFilter, setLogFilter] = useState("all");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [accountDeleted, setAccountDeleted] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);
  const fileInputRef = useRef(null);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
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
      updateSecuritySettings({ two_factor_enabled: security.twoFactor }),
      updateBillingInfo(billing),
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
    saveJSON("hopenix_departments", departments);
    saveJSON("hopenix_project_settings", projectSettings);
    saveJSON("hopenix_task_settings", taskSettings);
    saveJSON("hopenix_income_settings", incomeSettings);
    saveJSON("hopenix_expense_settings", expenseSettings);
    saveJSON("hopenix_sales_settings", salesSettings);
    saveJSON("hopenix_notifications", notifications);
    saveJSON("hopenix_security", security);
    saveJSON("hopenix_billing", billing);
    localStorage.setItem("hopenix_storage_used", String(storageUsedGb));
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  }

  function resetEverything() {
    setCompany(DEFAULT_COMPANY);
    setProfile(DEFAULT_PROFILE);
    // Users & Roles is real backend data now — nothing local to reset it
    // to, and doing so would just mismatch the display from the actual
    // database until the next refreshUsers() call anyway.
    setDepartments(DEFAULT_DEPARTMENTS);
    setProjectSettings(DEFAULT_PROJECT_SETTINGS);
    setTaskSettings(DEFAULT_TASK_SETTINGS);
    setIncomeSettings(DEFAULT_INCOME_SETTINGS);
    setExpenseSettings(DEFAULT_EXPENSE_SETTINGS);
    setSalesSettings(DEFAULT_SALES_SETTINGS);
    setNotifications(DEFAULT_NOTIFICATIONS);
    setSecurity(DEFAULT_SECURITY);
    setBilling(DEFAULT_BILLING);
    setStorageUsedGb(2.45);
    [
      "hopenix_company", "hopenix_profile", "hopenix_users", "hopenix_departments", "hopenix_project_settings",
      "hopenix_task_settings", "hopenix_income_settings", "hopenix_expense_settings", "hopenix_sales_settings",
      "hopenix_notifications", "hopenix_security", "hopenix_billing",
      "hopenix_storage_used",
    ].forEach((k) => localStorage.removeItem(k));
    closeConfirm();
    showToast("All settings reset to default");
  }

  function downloadInvoice(row) {
    const text = `HOPENIX TECHNOLOGIES\nInvoice: ${row.desc}\nDate: ${row.date}\nAmount: ${row.amount}\nStatus: ${row.status}\n`;
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
  const filteredLogs = logFilter === "all" ? SYSTEM_LOGS : SYSTEM_LOGS.filter((l) => l.level === logFilter);
  const storagePct = Math.min(100, Math.round((storageUsedGb / 10) * 100));

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
    <div className={`grid grid-cols-1 gap-4 items-start relative ${hasFullSettingsAccess ? "lg:grid-cols-[220px_1fr_280px]" : "lg:grid-cols-[220px_1fr]"}`}>
      {/* ---------------------------------------------- Settings sub-nav */}
      <div className={`rounded-xl p-2 shadow-sm lg:sticky lg:top-0 ${card}`}>
        <p className={`px-2.5 pt-1.5 pb-2 text-[11px] font-semibold ${headingText}`}>Settings</p>
        <nav className="space-y-0.5">
          {SETTINGS_NAV.filter(({ id }) => hasFullSettingsAccess || NON_ADMIN_TAB_IDS.includes(id)).map(({ id, label, desc, icon: Icon }) => {
            const isActive = tab === id;
            return (
              <button
                key={id}
                onClick={() => { setTab(id); scrollToContentOnMobile(); }}
                className={`w-full flex items-start gap-2.5 text-left px-2.5 py-2 rounded-lg transition-colors ${
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
                  <span className={`block text-[12px] font-semibold truncate ${isActive ? "" : cardText}`}>{label}</span>
                  <span className={`block text-[10px] truncate ${subtleText}`}>{desc}</span>
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
                          <SettingsIcon size={20} className="text-violet-500" />
                        </span>
                        <div>
                          <p className={`text-[10.5px] ${subtleText}`}>Recommended size: 200x200px</p>
                          <p className={`text-[10.5px] ${subtleText}`}>PNG, JPG or SVG. Max size 2MB</p>
                          <button
                            type="button"
                            onClick={() => showToast("Logo upload coming soon")}
                            className={`mt-1.5 text-[11px] font-semibold rounded-md px-2.5 py-1 border ${
                              darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            Change Logo
                          </button>
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
                  <ToggleRow title="Enable Dark Mode" desc="Switch between light and dark appearance" checked={darkMode} onChange={setDarkMode} darkMode={darkMode} />
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
              subtitle={`${departments.length} departments · organize your teams`}
              darkMode={darkMode}
              action={
                <button
                  onClick={() => setModal({ type: "department", data: null })}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-3.5 py-2 text-xs font-semibold shadow-sm hover:opacity-90 transition"
                >
                  <Plus size={13} /> Add Department
                </button>
              }
            />
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
                        <span className={`block text-[10.5px] truncate ${subtleText}`}>Head: {d.head}</span>
                      </span>
                    </div>
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
                            message: `Delete "${d.name}"? Members will need to be reassigned.`,
                            danger: true,
                            confirmLabel: "Delete",
                            onConfirm: () => {
                              setDepartments((list) => list.filter((x) => x.id !== d.id));
                              closeConfirm();
                              showToast("Department deleted");
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className={`flex items-center justify-between mt-3 pt-2.5 border-t text-[11px] ${borderClass} ${mutedText}`}>
                    <span>{d.members} members</span>
                    <span className="font-semibold">₨ {d.budget.toLocaleString()} / mo</span>
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
              <ToggleRow title="Require Project Code" desc="Enforce a unique code when creating a project" checked={projectSettings.requireCode} onChange={(v) => setProjectSettings((p) => ({ ...p, requireCode: v }))} darkMode={darkMode} />
              <ToggleRow title="Allow Guest Access" desc="Let clients view project progress without an account" checked={projectSettings.allowGuestAccess} onChange={(v) => setProjectSettings((p) => ({ ...p, allowGuestAccess: v }))} darkMode={darkMode} />
              <ToggleRow title="Enable Time Tracking" desc="Track hours logged against project tasks" checked={projectSettings.timeTracking} onChange={(v) => setProjectSettings((p) => ({ ...p, timeTracking: v }))} darkMode={darkMode} last />
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
              <ToggleRow title="Send Reminders" desc="Notify assignees before a task is due" checked={taskSettings.sendReminders} onChange={(v) => setTaskSettings((t) => ({ ...t, sendReminders: v }))} darkMode={darkMode} last />
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
              <ToggleRow title="Enable Recurring Income" desc="Allow income entries to repeat automatically" checked={incomeSettings.recurringIncome} onChange={(v) => setIncomeSettings((s) => ({ ...s, recurringIncome: v }))} darkMode={darkMode} />
              <ToggleRow title="Auto-generate Invoice" desc="Create an invoice automatically for new income" checked={incomeSettings.autoInvoice} onChange={(v) => setIncomeSettings((s) => ({ ...s, autoInvoice: v }))} darkMode={darkMode} last />
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
              <ToggleRow title="Require Receipt Upload" desc="A receipt image is mandatory for every expense" checked={expenseSettings.requireReceipt} onChange={(v) => setExpenseSettings((s) => ({ ...s, requireReceipt: v }))} darkMode={darkMode} />
              <ToggleRow title="Auto-categorize Expenses" desc="Let the AI Assistant suggest a category" checked={expenseSettings.autoCategorize} onChange={(v) => setExpenseSettings((s) => ({ ...s, autoCategorize: v }))} darkMode={darkMode} last />
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
              <ToggleRow title="Auto-generate Invoice Number" desc="Number new invoices sequentially" checked={salesSettings.autoInvoiceNumber} onChange={(v) => setSalesSettings((s) => ({ ...s, autoInvoiceNumber: v }))} darkMode={darkMode} />
              <ToggleRow title="Send Payment Reminders" desc="Remind clients automatically before due date" checked={salesSettings.paymentReminders} onChange={(v) => setSalesSettings((s) => ({ ...s, paymentReminders: v }))} darkMode={darkMode} last />
            </div>
          </div>
        )}

        {/* ---------------------------------------------- Notifications */}
        {tab === "notifications" && (
          <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
            <SectionHeading title="Notifications" subtitle="Choose how you're notified for each event." darkMode={darkMode} action={saveBtn} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[420px]">
                <thead>
                  <tr className={`text-[10.5px] uppercase tracking-wide ${subtleText}`}>
                    <th className="py-2 font-semibold">Event</th>
                    <th className="py-2 font-semibold text-center w-20">Email</th>
                    <th className="py-2 font-semibold text-center w-20">Push</th>
                    <th className="py-2 font-semibold text-center w-20">SMS</th>
                  </tr>
                </thead>
                <tbody>
                  {notifications.map((n) => (
                    <tr key={n.id} className={`border-t ${borderClass}`}>
                      <td className={`py-2.5 text-[12px] font-medium ${cardText}`}>{n.label}</td>
                      {["email", "push", "sms"].map((ch) => (
                        <td key={ch} className="py-2.5 text-center">
                          <div className="flex justify-center">
                            <Toggle checked={n[ch]} onChange={(v) => setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, [ch]: v } : x)))} />
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
                desc="Add an extra layer of security to your account"
                checked={security.twoFactor}
                onChange={(v) =>
                  v
                    ? setModal({ type: "enable2fa" })
                    : setConfirm({
                        title: "Disable 2FA",
                        message: "Turning off two-factor authentication makes your account easier to compromise. Continue?",
                        danger: true,
                        confirmLabel: "Disable",
                        onConfirm: () => {
                          setSecurity((s) => ({ ...s, twoFactor: false }));
                          closeConfirm();
                          showToast("Two-factor authentication disabled");
                        },
                      })
                }
                darkMode={darkMode}
                last
              />
            </div>

            <div className={`rounded-xl ${company.compactMode ? "p-3 sm:p-3.5" : "p-4 sm:p-5"} shadow-sm ${card}`}>
              <div className="flex items-center justify-between">
                <h3 className={`text-[13px] font-semibold ${cardText}`}>Active Sessions</h3>
                <button
                  onClick={() =>
                    setConfirm({
                      title: "Revoke other sessions",
                      message: "You'll be signed out on all other devices except this one.",
                      danger: true,
                      confirmLabel: "Revoke All",
                      onConfirm: () => {
                        setSecurity((s) => ({ ...s, sessions: s.sessions.filter((x) => x.current) }));
                        closeConfirm();
                        showToast("Other sessions revoked");
                      },
                    })
                  }
                  className={`text-[11px] font-semibold ${darkMode ? "text-rose-400 hover:text-rose-300" : "text-rose-500 hover:text-rose-600"}`}
                >
                  Revoke All Others
                </button>
              </div>
              <div className="mt-3 space-y-1.5">
                {security.sessions.map((s) => {
                  const DeviceIcon = s.device.toLowerCase().includes("iphone") || s.device.toLowerCase().includes("android") ? Smartphone : Monitor;
                  return (
                    <div key={s.id} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <DeviceIcon size={15} className="text-violet-500 shrink-0" />
                        <span className="min-w-0">
                          <span className={`flex items-center gap-1.5 text-[11.5px] font-semibold truncate ${cardText}`}>
                            {s.device} {s.current && <Badge tone="violet" darkMode={darkMode}>This device</Badge>}
                          </span>
                          <span className={`block text-[10.5px] truncate ${subtleText}`}>{s.location} · {s.lastActive}</span>
                        </span>
                      </div>
                      {!s.current && (
                        <button
                          onClick={() => {
                            setSecurity((sec) => ({ ...sec, sessions: sec.sessions.filter((x) => x.id !== s.id) }));
                            showToast("Session revoked");
                          }}
                          className={`text-[11px] font-semibold shrink-0 ${darkMode ? "text-rose-400 hover:text-rose-300" : "text-rose-500 hover:text-rose-600"}`}
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
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
                    <Crown size={14} className="text-amber-500" /> {billing.plan} Plan
                  </p>
                </div>
                <div>
                  <p className={`text-[11px] ${subtleText}`}>Payment Method</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className={`text-sm font-bold ${cardText}`}>{billing.cardBrand} •••• {billing.cardLast4}</p>
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
                    {billing.history.map((row) => (
                      <tr key={row.id} className={`border-t ${borderClass}`}>
                        <td className={`py-2.5 text-[11.5px] ${mutedText}`}>{row.date}</td>
                        <td className={`py-2.5 text-[11.5px] font-medium ${cardText}`}>{row.desc}</td>
                        <td className={`py-2.5 text-[11.5px] ${mutedText}`}>{row.amount}</td>
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
            <span className={`text-[10.5px] ${subtleText}`}>{storageUsedGb.toFixed(2)} GB of 10 GB used</span>
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
        </div>

        <div className={`rounded-xl p-4 shadow-sm ${card}`}>
          <h3 className={`text-[12.5px] font-semibold ${cardText}`}>Subscription Plan</h3>
          <div className="flex items-center justify-between mt-3">
            <span className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${cardText}`}>
              <Crown size={13} className="text-amber-500" /> {billing.plan} Plan
            </span>
            <Badge tone="emerald" darkMode={darkMode}>Active</Badge>
          </div>
          <p className={`text-[10.5px] mt-1 ${subtleText}`}>Next billing date: Jun 25, 2025</p>
          <ul className="mt-3 space-y-1.5">
            {(PLANS.find((p) => p.name === billing.plan)?.features || []).map((f) => (
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
            {[
              ["System Version", "v2.4.1"],
              ["Last Updated", "May 20, 2025"],
              ["System Status", "All Systems Operational", "ok"],
              ["Database", "Connected", "ok"],
              ["Backup Status", "Last backup May 24, 2025"],
            ].map(([label, value, kind]) => (
              <div key={label} className="flex items-center justify-between">
                <span className={`text-[11px] ${mutedText}`}>{label}</span>
                <span className={`text-[10.5px] font-medium flex items-center gap-1 ${kind === "ok" ? "text-emerald-600" : cardText}`}>
                  {kind === "ok" && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
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
                  message: "This resets every setting in this panel — company info, users, categories, and more — back to their defaults. This cannot be undone.",
                  danger: true,
                  confirmLabel: "Reset Everything",
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
            <p className="text-[10.5px] text-rose-400 mt-0.5">This action cannot be undone. All data will be permanently deleted.</p>
            <button
              onClick={() => {
                setDeleteConfirmText("");
                setModal({ type: "deleteAccount" });
              }}
              className="mt-2 w-full text-[11px] font-semibold rounded-lg py-2 bg-rose-600 text-white hover:bg-rose-700"
            >
              Delete Account
            </button>
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
          onSubmit={(data) => {
            if (modal?.data) {
              setDepartments((list) => list.map((x) => (x.id === modal.data.id ? { ...x, ...data } : x)));
              showToast("Department updated");
            } else {
              setDepartments((list) => [...list, { id: nextId(list), members: 0, ...data }]);
              showToast("Department added");
            }
            closeModal();
          }}
        />
      </Modal>

      {/* Enable 2FA */}
      <Modal open={modal?.type === "enable2fa"} onClose={closeModal} title="Enable Two-Factor Authentication" darkMode={darkMode} widthClass="max-w-sm">
        <div className="flex flex-col items-center text-center gap-3">
          <div className={`w-32 h-32 rounded-lg grid grid-cols-5 grid-rows-5 gap-1 p-2 ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
            {Array.from({ length: 25 }).map((_, i) => (
              <span key={i} className={`rounded-sm ${(i * 7) % 3 === 0 ? "bg-slate-900 dark:bg-white" : ""}`} />
            ))}
          </div>
          <p className={`text-[11.5px] ${mutedText}`}>Scan this code with your authenticator app, then confirm below to finish setup.</p>
          <button
            onClick={() => {
              setSecurity((s) => ({ ...s, twoFactor: true }));
              closeModal();
              showToast("Two-factor authentication enabled");
            }}
            className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg py-2 text-xs font-semibold hover:opacity-90"
          >
            I've scanned it — Enable
          </button>
        </div>
      </Modal>

      {/* Change plan */}
      <Modal open={modal?.type === "changePlan"} onClose={closeModal} title="Choose a Plan" darkMode={darkMode} widthClass="max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PLANS.map((p) => {
            const isCurrent = p.name === billing.plan;
            return (
              <div key={p.name} className={`rounded-lg p-3.5 border flex flex-col ${isCurrent ? "border-violet-500" : darkMode ? "border-slate-800" : "border-slate-200"}`}>
                <p className={`text-[12.5px] font-bold ${cardText}`}>{p.name}</p>
                <p className={`text-[15px] font-extrabold mt-1 ${cardText}`}>{p.price}</p>
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
                    // BUG FIX: this used to only call local setBilling(...)
                    // — nothing on this tab ever actually reached the
                    // backend (the Billing tab has no "Save Changes"
                    // button of its own; "Change Plan" is its header
                    // action instead), so a plan switch always looked
                    // like it worked (toast + UI update) but silently
                    // reverted on next login/refresh. Now it saves for
                    // real, immediately.
                    const result = await updateBillingInfo({ ...billing, plan: p.name });
                    if (result?.success === false) {
                      showToast(result.error || "Couldn't switch plans");
                      return;
                    }
                    setBilling((b) => ({ ...b, plan: p.name }));
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
          onSubmit={async (last4, brand) => {
            // Same bug, same fix as Change Plan above — this only ever
            // did setBilling(...) locally, never actually saved.
            const result = await updateBillingInfo({ ...billing, cardLast4: last4, cardBrand: brand });
            if (result?.success === false) {
              showToast(result.error || "Couldn't update payment method");
              return;
            }
            setBilling((b) => ({ ...b, cardLast4: last4, cardBrand: brand }));
            closeModal();
            showToast("Payment method updated");
          }}
        />
      </Modal>

      {/* Storage manager */}
      <Modal open={modal?.type === "storage"} onClose={closeModal} title="Manage Storage" darkMode={darkMode}>
        <div className="space-y-2.5">
          {STORAGE_BREAKDOWN.map((b) => (
            <div key={b.label}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-[11.5px] font-medium ${cardText}`}>{b.label}</span>
                <span className={`text-[10.5px] ${subtleText}`}>{b.size.toFixed(2)} GB</span>
              </div>
              <div className={`w-full h-1.5 rounded-full overflow-hidden ${darkMode ? "bg-slate-800" : "bg-slate-100"}`}>
                <div className="h-full rounded-full" style={{ width: `${(b.size / 10) * 100}%`, backgroundColor: b.color }} />
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            setStorageUsedGb((v) => Math.max(0, v - 0.6));
            showToast("Cache and temporary files cleared");
          }}
          className={`mt-4 w-full text-[11px] font-semibold rounded-lg py-2 ${darkMode ? "bg-slate-800 text-violet-300 hover:bg-slate-700" : "bg-violet-50 text-violet-700 hover:bg-violet-100"}`}
        >
          Clear Cache & Temporary Files
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
            onClick={() => showToast("Logs refreshed")}
            className={`ml-auto w-7 h-7 rounded-md flex items-center justify-center ${darkMode ? "text-slate-400 hover:bg-slate-800" : "text-slate-500 hover:bg-slate-100"}`}
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {filteredLogs.map((log) => (
            <div key={log.id} className={`flex items-start gap-2.5 rounded-lg px-3 py-2 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${log.level === "error" ? "bg-rose-500" : log.level === "warning" ? "bg-amber-500" : "bg-emerald-500"}`} />
              <span className="min-w-0">
                <span className={`block text-[11.5px] font-medium ${cardText}`}>{log.message}</span>
                <span className={`block text-[10px] ${subtleText}`}>{log.time}</span>
              </span>
            </div>
          ))}
          {filteredLogs.length === 0 && <p className={`text-[11px] italic text-center py-6 ${subtleText}`}>No {logFilter} logs.</p>}
        </div>
      </Modal>

      {/* Delete account */}
      <Modal open={modal?.type === "deleteAccount"} onClose={closeModal} title="Delete Account" darkMode={darkMode} widthClass="max-w-sm">
        <p className={`text-xs leading-relaxed ${mutedText}`}>
          This permanently deletes your account and all company data. This action cannot be undone. Type <span className="font-bold text-rose-500">DELETE</span> to confirm.
        </p>
        <input className={inputClass + " mt-3"} value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)} placeholder="Type DELETE" />
        <div className="flex items-center gap-2 mt-4">
          <button onClick={closeModal} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            Cancel
          </button>
          <button
            disabled={deleteConfirmText !== "DELETE"}
            onClick={() => {
              closeModal();
              setAccountDeleted(true);
            }}
            className={`flex-1 text-xs font-semibold rounded-lg py-2 text-white ${deleteConfirmText === "DELETE" ? "bg-rose-600 hover:bg-rose-700" : "bg-rose-300 cursor-not-allowed"}`}
          >
            Delete Permanently
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

      {/* Account deleted overlay */}
      {accountDeleted && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div className={`w-full max-w-sm rounded-xl p-6 text-center shadow-xl ${darkMode ? "bg-slate-900 border border-slate-800" : "bg-white"}`}>
            <span className="w-12 h-12 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle size={20} />
            </span>
            <h3 className={`text-sm font-bold ${headingText}`}>Account Scheduled for Deletion</h3>
            <p className={`text-xs mt-2 ${mutedText}`}>Your account and data will be permanently removed in 14 days. You can cancel this anytime before then.</p>
            <button
              onClick={() => setAccountDeleted(false)}
              className="mt-4 w-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg py-2 text-xs font-semibold hover:opacity-90"
            >
              Undo — Keep My Account
            </button>
          </div>
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

function DepartmentForm({ initial, onSubmit, onCancel, darkMode, inputClass }) {
  const [form, setForm] = useState({ name: initial?.name || "", head: initial?.head || "", budget: initial?.budget ?? 0 });
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Department Name">
        <input className={inputClass} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Department Head">
        <input className={inputClass} value={form.head} onChange={(e) => setForm((f) => ({ ...f, head: e.target.value }))} />
      </Field>
      <Field label="Monthly Budget (₨)">
        <input type="number" className={inputClass} value={form.budget} onChange={(e) => setForm((f) => ({ ...f, budget: Number(e.target.value) }))} />
      </Field>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cancel
        </button>
        <button
          onClick={() => {
            if (!form.name.trim() || !form.head.trim()) {
              setError("Name and head are required.");
              return;
            }
            onSubmit(form);
          }}
          className="flex-1 text-xs font-semibold rounded-lg py-2 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"
        >
          {initial ? "Save Changes" : "Add Department"}
        </button>
      </div>
    </div>
  );
}

function PaymentForm({ onSubmit, onCancel, darkMode, inputClass }) {
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Card Number">
        <input className={inputClass} placeholder="4242 4242 4242 4242" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={19} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Expiry">
          <input className={inputClass} placeholder="MM/YY" value={expiry} onChange={(e) => setExpiry(e.target.value)} maxLength={5} />
        </Field>
        <Field label="CVV">
          <input className={inputClass} placeholder="123" value={cvv} onChange={(e) => setCvv(e.target.value)} maxLength={4} />
        </Field>
      </div>
      {error && <p className="text-[11px] text-rose-500">{error}</p>}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={onCancel} className={`flex-1 text-xs font-semibold rounded-lg py-2 border ${darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
          Cancel
        </button>
        <button
          onClick={() => {
            const digits = number.replace(/\s/g, "");
            if (digits.length < 12 || !expiry || cvv.length < 3) {
              setError("Enter a valid card number, expiry and CVV.");
              return;
            }
            onSubmit(digits.slice(-4), "Visa");
          }}
          className="flex-1 text-xs font-semibold rounded-lg py-2 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"
        >
          Save Card
        </button>
      </div>
    </div>
  );
}