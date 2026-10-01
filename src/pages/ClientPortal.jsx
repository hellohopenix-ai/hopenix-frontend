import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ClientBirthdayCelebration from "../ClientBirthdayCelebration.jsx";
import { getPendingClientBirthdayMessages, markBirthdayMessageDelivered } from "../birthdayMessageDelivery.js";
import { FLAG_KEYS, syncFlag, hydrateFlags, flushFlags, clearLocalFlags } from "../userFlags.js";
import {
  LogOut,
  Lock,
  Mail,
  Phone,
  MapPin,
  IdCard,
  Eye,
  EyeOff,
  CheckCircle2,
  Circle,
  Activity as ActivityIcon,
  AlertCircle,
  RefreshCw,
  Briefcase,
  UserCheck,
  CalendarDays,
  ClipboardList,
  TrendingUp,
  Home,
  Calendar,
  FileText,
  MessageSquare,
  HelpCircle,
  ChevronRight,
  ChevronDown,
  Crown,
  Rocket,
  PieChart,
  BarChart3,
  Sparkles,
  Headphones,
  ShieldCheck,
  ExternalLink,
  Send,
  CheckCircle,
  Image as ImageIcon,
  Video,
  Link2,
  Archive,
  File as FileIcon,
  X as XIcon,
  Mic,
  CreditCard,
  PlusCircle,
  Upload,
  Download,
  Trash2,
} from "lucide-react";
import phoenixLogo from "../assets/phoenix-logo.png";
import birthdayTune from "../assets/happy-birthday-voice.mp3";
import { useResolvedAttachments } from "../attachmentStorage.js";
import { UserMeetings } from "./Meetings";
import { InvoiceDocumentPreview } from "./ClientsPage.jsx";
import * as portalApi from "./clientPortalApi.js";
import ClientPortalMessages from "./ClientPortalMessages.jsx";
import EnableNotificationsBanner from "../components/EnableNotificationsBanner.jsx";
import { ensurePushSubscribed, clearPushSubscription } from "../pushSubscription.js";

/* ======================================================================
   BRAND
====================================================================== */

const BRAND_NAME = "Hopnix";
const BRAND_TAGLINE = "Client Portal";

// Single source of truth for the support inbox — update here only and
// every mailto link / support form on this page stays in sync.
const SUPPORT_EMAIL = "hello.hopenix@gmail.com";

/* ======================================================================
   DATA SOURCE — backed by the Django/PostgreSQL dashboard app (real
   Client/Invoice/ModuleRequest/ActivityLogEntry/ClientMessage rows via
   clientPortalApi.js). The only thing kept in the browser now is the
   session token; every read and write is scoped server-side to
   whichever client that token belongs to.
====================================================================== */

const SESSION_STORAGE_KEY = "clientportal_session_v1";

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // storage unavailable — session just won't survive a refresh
  }
}

// The write helpers further down (submitPaymentProof, submitModuleRequest,
// etc.) live at module scope and need the current session's token + client
// id without threading them through every component prop. setCurrentSession()
// is called once from the root ClientPortal component on login/logout.
let currentToken = loadSession()?.token || null;
let currentClientId = loadSession()?.clientId || null;
function setCurrentSession(token, clientId) {
  currentToken = token;
  currentClientId = clientId;
  saveSession(token ? { token, clientId } : null);
}

/* ----------------------------------------------------------------
   UNSEEN-ACTIVITY RED DOT (Projects / Billing nav items)
   The client's activity feed (client.activity) is one flat, unlabeled
   list shared by every kind of update — module progress, payments,
   attachments, etc — so there's no ready-made "this many are new" count
   per section. This buckets each entry into "billing" or "projects" by
   a simple keyword match, then compares that bucket's current size
   against how many of that bucket this client last actually saw (kept
   in localStorage, per client + section) to decide whether a small red
   dot should show on that nav item. Opening the matching tab marks the
   current count as seen, so the dot clears until something NEW happens.
---------------------------------------------------------------- */
const SEEN_ACTIVITY_STORAGE_KEY = FLAG_KEYS.portalSeenActivity; // synced per account via /api/flags/ (userFlags.js)
const BILLING_ACTIVITY_RE = /invoice|payment|milestone|paid|submitted|balance|billing/i;

function categorizeActivity(text) {
  return BILLING_ACTIVITY_RE.test(text || "") ? "billing" : "projects";
}

function countActivityFor(client, section) {
  return (client.activity || []).filter((a) => categorizeActivity(a.text) === section).length;
}

function loadSeenActivity() {
  try {
    const raw = localStorage.getItem(SEEN_ACTIVITY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function markActivitySeen(clientId, section, count) {
  try {
    const all = loadSeenActivity();
    const forClient = { ...(all[clientId] || {}), [section]: count };
    localStorage.setItem(SEEN_ACTIVITY_STORAGE_KEY, JSON.stringify({ ...all, [clientId]: forClient }));
    syncFlag(SEEN_ACTIVITY_STORAGE_KEY, "portal");
  } catch {
    // best-effort only — the dot just won't stay cleared across a refresh
  }
}

function hasUnseenActivity(client, section) {
  const seen = loadSeenActivity();
  const seenCount = seen?.[client.id]?.[section] || 0;
  return countActivityFor(client, section) > seenCount;
}

/* ----------------------------------------------------------------
   FINAL DELIVERABLE VISIBILITY
   A project's final zip (uploaded from the admin's Clients page once
   every module is done) only becomes visible here once the client has
   made a payment — mirrors ClientsPage.jsx's own hasReceivedPayment()
   check exactly, so both pages agree on when it unlocks. Invoices
   aren't tied to one specific project in this app's data model, so
   this checks the client's payment history as a whole: once any
   invoice has money against it, every completed project's zip becomes
   visible on the portal.
---------------------------------------------------------------- */
function hasReceivedPayment(client) {
  return (client.invoices || []).some((inv) => (inv.paidAmount || 0) > 0 || inv.status === "Paid");
}

// Mirrors ClientsPage.jsx's own isPaymentComplete() exactly: whether the
// client's whole running balance is settled. Used as the gate for the
// final deliverable ZIP now that projects can have any number of
// milestones (not always a fixed "Milestone 4") — fully paid is the one
// signal that works regardless of how many milestones a project has.
function isFullyPaid(client) {
  return (client?.outstanding || 0) <= 0;
}

/* ----------------------------------------------------------------
   4-MILESTONE PAYMENT PLAN (client side)
   Mirrors ClientsPage.jsx exactly: milestone 1 = project assigned,
   2 = Frontend delivery, 3 = Backend delivery, 4 = final ZIP. When the
   admin tags an invoice with a milestone, that invoice is what gates
   the matching deliverable here (Frontend/Backend attachments, or the
   final ZIP) until it's marked "Paid". If a project has no
   milestone-tagged invoices at all (older/manual data), we fall back
   to the looser "has this client paid anything at all" check so
   nothing that used to be visible suddenly locks itself.
---------------------------------------------------------------- */
const MILESTONE_LABELS = {
  1: "Milestone 1 · Project Assigned",
  2: "Milestone 2 · Frontend Delivery",
  3: "Milestone 3 · Backend Delivery",
  4: "Milestone 4 · Final Deliverable (ZIP)",
};

// FIX (Clients page PKR mein calculate karta hai, lekin portal mein wohi
// number seedha "$" laga kar dikhta tha — PKR 100 ka "$100" ban jata tha):
// every amount stored on the client/invoices is in PKR (see ClientsPage's
// fmtMoney), so it's now converted to USD here before display.
// Update PKR_PER_USD whenever you want a fresher rate (1 USD = 277 PKR
// at time of writing). Two decimals so small amounts (PKR 100 = $0.36)
// don't round down to $0.
const PKR_PER_USD = 277;

function fmtMoney(n) {
  const usd = Number(n || 0) / PKR_PER_USD;
  return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// FIX (assigned manager ka naam portal mein show nahi hota tha): the
// backend's client payload carries `manager` as just the manager's numeric
// user id, plus a separate `manager_name` string — but every place in this
// portal reads `client.manager.name` / `.role` (Overview card, the chat
// assistant's "Who is my account manager?"). A number has no `.name`, so
// the name came out blank. This turns that into the {name, role, ...}
// object the rest of the portal already expects, without touching any
// data that already arrives in that shape.
function normalizePortalClient(c) {
  if (!c || typeof c !== "object") return c;
  const m = c.manager;
  // clientPortalApi.js's normalizeClient hands `manager` over as a plain
  // string (the manager's name), so that case is handled first.
  const name =
    (m && typeof m === "object" && m.name) ||
    (typeof m === "string" ? m.trim() : "") ||
    c.manager_name ||
    c.managerName ||
    "";
  if (!name) return m && typeof m === "object" ? c : { ...c, manager: null };
  if (m && typeof m === "object" && m.name) return c;
  return {
    ...c,
    manager: {
      ...(m && typeof m === "object" ? m : {}),
      name,
      role: (m && typeof m === "object" && m.role) || c.manager_role || "Account Manager",
      email: (m && typeof m === "object" && m.email) || c.manager_email || "",
      phone: (m && typeof m === "object" && m.phone) || c.manager_phone || "",
    },
  };
}

// Most recent invoice tagged with a given milestone (1-4), if any.
function getMilestoneInvoice(client, milestone) {
  const matches = (client.invoices || []).filter((inv) => inv.milestone === milestone);
  return matches[0] || null;
}

// Frontend -> milestone 2, Backend -> milestone 3 (mirrors isModuleUnlocked
// above / ClientsPage.jsx's own milestone numbering). Any other module
// name (Deployment, UI/UX Design, custom modules added via a request,
// ...) has no fixed milestone number of its own.
function getModuleMilestone(moduleName) {
  const n = (moduleName || "").trim().toLowerCase();
  if (n === "frontend") return 2;
  if (n === "backend") return 3;
  return null;
}

// FIX (locked module files weren't clickable): a locked Frontend/Backend/
// Deployment attachments block used to always get `invoice={null}`
// passed down, and LockedMilestoneBlock only becomes clickable when it
// actually has an invoice — so tapping "<Module> files locked" silently
// did nothing. This finds the real invoice that unlocking this module's
// files depends on, so the block can open the actual PaymentModal for
// it: first the invoice tagged with this module's own milestone (if
// any), then any other unpaid/not-yet-submitted invoice for the same
// project, then any unpaid invoice on the account at all. Returns null
// only when there's genuinely no open invoice yet for the client to pay
// (admin hasn't generated one) — the block stays a plain locked card in
// that case, same as before.
function getPayableInvoiceForModule(client, projectName, moduleName) {
  const invoices = client.invoices || [];
  const isOpen = (inv) => inv.status !== "Submitted" && (inv.amount || 0) - (inv.paidAmount || 0) > 0;

  const milestone = getModuleMilestone(moduleName);
  if (milestone) {
    const milestoneInv = invoices.find((inv) => inv.milestone === milestone && isOpen(inv));
    if (milestoneInv) return milestoneInv;
  }

  const projectInv = invoices.find((inv) => inv.projectName === projectName && isOpen(inv));
  if (projectInv) return projectInv;

  return invoices.find(isOpen) || null;
}

function isInvoicePaid(inv) {
  if (!inv) return false;
  return inv.status === "Paid" || (inv.paidAmount || 0) >= inv.amount;
}

// Whether a Frontend/Backend module's attachments should be visible yet.
// `moduleName` should be the exact module name ("Frontend" / "Backend");
// any other module name is never gated.
// Kept for reference/possible reuse — no longer called from this file
// now that module/file unlocking uses the simpler hasReceivedPayment /
// isFullyPaid checks above, which work for any milestone count.
function isModuleUnlocked(moduleName, client) {
  const milestone = moduleName === "Frontend" ? 2 : moduleName === "Backend" ? 3 : null;
  if (!milestone) return true;
  const inv = getMilestoneInvoice(client, milestone);
  if (inv) return isInvoicePaid(inv);
  return hasReceivedPayment(client);
}

/* ----------------------------------------------------------------
   PAYMENT DETAILS — single source of truth for the bank account the
   payment popup tells clients to send money to. Update here only and
   every payment popup on this page stays in sync. Swap in the real
   account details before going live.
---------------------------------------------------------------- */
const PAYMENT_BANK_NAME = "Meezan Bank";
const PAYMENT_ACCOUNT_TITLE = "Hopnix Pvt Ltd";
const PAYMENT_ACCOUNT_NUMBER = "PK36 MEZN 0001 2300 4567 891";
const PAYMENT_IBAN_NOTE = "Please include the invoice number in your transfer note if your bank allows it.";

// InvoiceDocumentPreview (imported from ClientsPage.jsx, the admin side)
// expects a `theme` object shaped like ClientsPage's own dark/light
// theme — this Portal doesn't have one (it's hard-coded dark throughout,
// bg-[#15101f]/border-white/10/text-slate-*), so this is just that same
// shape built once from the Portal's own existing palette, purely so
// the shared invoice document renders correctly in here too.
const PORTAL_INVOICE_THEME = {
  card: "bg-[#15101f] border border-white/10",
  headingText: "text-white",
  cardText: "text-slate-200",
  mutedText: "text-slate-400",
  subtleText: "text-slate-500",
  border: "border-white/10",
  borderLight: "border-white/10",
  inputBg: "bg-white/5",
  hoverIconBg: "bg-white/10",
};

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5MB, same ceiling ClientsPage.jsx uses for attachments

// The compression below is now purely for a fast, lightweight preview
// in the UI (PaymentModal shows this as the screenshot thumbnail) —
// the actual upload sends the original File straight to the Django API
// (see portalApi.submitPaymentProof), so there's no localStorage quota
// to worry about on that end anymore.
function loadImageElement(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not process image."));
    img.src = dataUrl;
  });
}

// One resize+quality pass isn't always enough — a single wide/tall
// photo can still land near 1MB even at quality 0.72. So this steps
// DOWN through progressively smaller/rougher passes until the result
// is comfortably under targetBytes, instead of gambling on one pass
// and hoping it's small enough.
async function compressImageDataUrl(dataUrl, targetBytes = 350 * 1024) {
  let img;
  try {
    img = await loadImageElement(dataUrl);
  } catch {
    return dataUrl; // couldn't decode it — let the original try its luck
  }
  const passes = [
    { maxDimension: 1280, quality: 0.72 },
    { maxDimension: 1000, quality: 0.6 },
    { maxDimension: 800, quality: 0.5 },
    { maxDimension: 640, quality: 0.4 },
    { maxDimension: 480, quality: 0.35 },
    { maxDimension: 360, quality: 0.3 },
    { maxDimension: 260, quality: 0.25 },
  ];
  let smallest = dataUrl;
  for (const { maxDimension, quality } of passes) {
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;
    if (!width || !height) return dataUrl;
    if (width > maxDimension || height > maxDimension) {
      const scale = maxDimension / Math.max(width, height);
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, width, height);
    const candidate = canvas.toDataURL("image/jpeg", quality);
    smallest = candidate;
    // base64 is ~4/3 the size of the raw bytes it encodes
    const approxBytes = candidate.length * 0.75;
    if (approxBytes <= targetBytes) return candidate;
  }
  return smallest; // as small as we could get it
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PROOF_BYTES) {
      reject(new Error("File is too large (max 5MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const compact = await compressImageDataUrl(reader.result);
        resolve(compact);
      } catch {
        resolve(reader.result);
      }
    };
    reader.onerror = () => reject(new Error("Could not read file."));
    reader.readAsDataURL(file);
  });
}

// Attaches a payment screenshot to one invoice via the Django API and
// flips it to "Submitted" — staff still has to confirm it from the
// admin panel before it counts as Paid. `proof` is the raw File object
// picked in PaymentModal.
async function submitPaymentProof(invoiceId, proof) {
  try {
    await portalApi.submitPaymentProof(currentToken, invoiceId, proof);
    return true;
  } catch (err) {
    console.error("submitPaymentProof: failed:", err);
    return false;
  }
}

// Client asking for a module. Pass `existingModuleId` for a locked
// module already in the project's plan (the common "Request to start"
// click); leave it out and pass `projectId` + `moduleName` instead for
// a brand-new module that isn't in the plan yet.
async function submitModuleRequest({ existingModuleId, projectId, moduleName, note, attachment }) {
  try {
    if (existingModuleId) {
      await portalApi.requestExistingModule(currentToken, currentClientId, existingModuleId);
    } else {
      await portalApi.requestCustomModule(currentToken, {
        clientId: currentClientId,
        projectId,
        moduleName,
        note,
        attachmentFile: attachment?.type === "image" ? attachment.file : null,
        attachmentLink: attachment?.type === "link" ? attachment.url : "",
      });
    }
    return { ok: true };
  } catch (err) {
    // FIX (client had no way to know "Request to start" actually
    // failed): every caller used to get back a plain boolean, so a real
    // failure — a permission error, a validation error, the request
    // never reaching the server — looked EXACTLY like nothing happening:
    // the button/form just quietly reset with no message anywhere. That's
    // very likely why requests looked like they "weren't going through"
    // even when the client genuinely tried. Now the real error message
    // comes back too, so both call sites below can actually show it.
    console.error("submitModuleRequest: failed:", err);
    return { ok: false, error: err.message || "Something went wrong. Please try again." };
  }
}

// Client updating their own profile picture from Profile Settings.
// Pass `null` to remove the photo.
async function updateClientProfilePic(file) {
  try {
    await portalApi.updateProfilePic(currentToken, currentClientId, file);
    return true;
  } catch (err) {
    console.error("updateClientProfilePic: failed:", err);
    return false;
  }
}

/* ----------------------------------------------------------------
   REMEMBERED LOGIN — separate from the active session above. This is
   what "Remember me" actually controls: the Client ID + email the
   client typed in, kept in the browser so the login fields are still
   pre-filled next time even after they log out. Logging out clears
   the active session but deliberately leaves this alone.
---------------------------------------------------------------- */
const REMEMBERED_LOGIN_STORAGE_KEY = "clientportal_remembered_login_v1";

function loadRememberedLogin() {
  try {
    const raw = localStorage.getItem(REMEMBERED_LOGIN_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveRememberedLogin(data) {
  try {
    if (data) localStorage.setItem(REMEMBERED_LOGIN_STORAGE_KEY, JSON.stringify(data));
    else localStorage.removeItem(REMEMBERED_LOGIN_STORAGE_KEY);
  } catch {
    // storage unavailable — nothing will be pre-filled next visit
  }
}

/* ----------------------------------------------------------------
   CLIENT MESSAGE THREAD — persisted server-side now (dashboard.
   ClientMessage), scoped to whoever the session token belongs to.
   Support requests are logged into this same thread too.
---------------------------------------------------------------- */
function fetchClientMessages() {
  return portalApi.fetchMessages(currentToken, currentClientId).catch(() => []);
}

function sendClientMessage(text) {
  return portalApi.sendMessage(currentToken, currentClientId, text);
}

function nowLabel() {
  return new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// A link shared from the admin panel looks like ?id=CLT-1024 (see the
// "Share portal link" control in ClientsPage.jsx). We only use it to
// pre-fill the Client ID field — the client still has to enter their
// email AND portal password, so a leaked link alone can't log anyone in.
function clientIdFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || params.get("client") || "";
  } catch {
    return "";
  }
}

// A tapped push notification opens /client-portal?view=messages (or
// projects / billing / support / activity) — see messaging/push_utils.py. The
// session is restored from localStorage, so the right page opens directly.
function initialPortalView() {
  try {
    const v = new URLSearchParams(window.location.search).get("view");
    if (["messages", "billing", "support", "documents", "meetings"].includes(v)) return { view: v, tab: "overview" };
    if (v === "projects" || v === "activity") return { view: "dashboard", tab: v };
  } catch {
    // ignore — fall back to the normal landing page
  }
  return { view: "dashboard", tab: "overview" };
}

/* ======================================================================
   AI ASSISTANT
   Client-facing chatbot — same idea as the AI Assistant panel in the
   admin Dashboard, but scoped to read-only, client-safe answers (no
   actions like adding expenses etc.). It reads the same live client
   data (projects/activity/manager) that's already on screen, so
   answers stay in sync with whatever the admin panel last updated.
   Two entry points share one brain: the floating chat bubble (bottom
   right, opens a full panel) and a slim "Ask AI" bar docked to the
   bottom of the page — the kind of always-visible AI box most sites
   have now. Sending from either one opens/uses the same conversation.
====================================================================== */

const AI_QUICK_COMMANDS = [
  "What's my project progress?",
  "Show me recent activity",
  "Who is my account manager?",
  "I need help / support",
];

function buildAiReply(rawText, ctx) {
  const text = (rawText || "").toLowerCase().trim();
  const { client, firstName, projects, activity, avgProgress, totalProjects, completedProjects, inProgressProjects, primaryProject, onNavigate } = ctx;

  const has = (...words) => words.some((w) => text.includes(w));

  if (!text) {
    return "Sure! What would you like to know?";
  }

  if (has("hi", "hello", "hey", "salam", "assalam")) {
    return `Hey ${firstName}! I can fill you in on your project progress, recent activity, your account manager, or connect you with support. What do you need?`;
  }

  if (has("progress", "status", "how's my project", "how is my project")) {
    if (!totalProjects) return "You don't have any projects on file yet — once your team starts one, it'll show up here.";
    const lines = projects
      .slice(0, 5)
      .map((p) => `• ${p.name || "Untitled project"} — ${p.progress ?? 0}% complete`)
      .join("\n");
    return `Here's where things stand:\n${lines}\n\nOverall average progress is ${avgProgress}% across ${totalProjects} project${totalProjects === 1 ? "" : "s"} (${completedProjects} completed, ${inProgressProjects} in progress).`;
  }

  if (has("project", "projects")) {
    if (!totalProjects) return "No projects are linked to your account yet.";
    return `You currently have ${totalProjects} project${totalProjects === 1 ? "" : "s"}${primaryProject ? `, most recently "${primaryProject.name}" at ${primaryProject.progress ?? 0}% complete` : ""}. Open the Projects tab for the full breakdown, or ask me for your progress.`;
  }

  if (has("module", "modules", "task", "tasks", "frontend", "backend", "database", "deployment", "api integration", "testing", "next step", "next steps", "what's left", "whats left", "remaining", "start work")) {
    if (!totalProjects) return "You don't have any projects on file yet — once your team starts one, it'll show up here.";
    const proj = primaryProject || projects[0];
    const modules = proj?.modules || [];
    const pending = [];
    modules.forEach((m) => {
      if (m.subModules && m.subModules.length) {
        m.subModules.forEach((s) => {
          if (!s.done) pending.push(s.name);
        });
      } else if (!m.done) {
        pending.push(m.name);
      }
    });
    onNavigate?.("projects");
    if (!pending.length) {
      return `Every module on "${proj?.name || "your project"}" is done — nice! I've opened the Projects tab so you can take a look.`;
    }
    const lines = pending.slice(0, 6).map((n) => `• ${n}`).join("\n");
    return `Here's what's still pending on "${proj?.name || "your project"}":\n${lines}\n\nI've opened the Projects tab — tap "Request to start" next to any of these to let your team know you're ready for them to begin. No file or attachment needed.`;
  }

  if (has("activity", "update", "updates", "recent", "what's new", "whats new")) {
    if (!activity.length) return "No activity updates have been posted yet — check back soon.";
    const lines = activity
      .slice(0, 3)
      .map((a) => `• ${a.text}${a.time ? ` (${a.time})` : ""}`)
      .join("\n");
    return `Latest updates from your team:\n${lines}`;
  }

  if (has("manager", "account manager", "who is my", "point of contact")) {
    if (client.manager?.name) {
      return `Your account manager is ${client.manager.name}${client.manager.role ? ` (${client.manager.role})` : ""}.${client.manager.email ? ` You can reach them at ${client.manager.email}.` : ""}`;
    }
    return "You don't have an account manager assigned yet — support can help connect you with one.";
  }

  if (has("support", "help", "issue", "problem", "contact", "human", "agent", "talk to someone")) {
    onNavigate?.("support");
    return `I've opened the Support tab for you. You can also reach the team any time at ${SUPPORT_EMAIL}.`;
  }

  if (has("invoice", "payment", "bill", "billing")) {
    onNavigate?.("billing");
    const invoices = client.invoices || [];
    const due = invoices.filter((inv) => inv.status !== "Paid" && Math.max(0, (inv.amount || 0) - (inv.paidAmount || 0)) > 0);
    if (!invoices.length) return "You don't have any invoices yet — I've opened the Billing tab, and your 4-milestone payment schedule will show up there once your team generates the first one.";
    if (!due.length) return "You're all paid up! I've opened the Billing tab so you can see your full payment history.";
    return `I've opened the Billing tab for you — you have ${due.length} invoice${due.length === 1 ? "" : "s"} awaiting payment. Tap "Pay Now" on any of them to see the account details and submit your payment screenshot.`;
  }

  if (has("thank", "thanks", "shukriya")) {
    return "Anytime! Let me know if there's anything else you need.";
  }

  return "I can help with your project progress, recent activity, your account manager, or connecting you to support — try one of the quick options below, or just ask.";
}

function ClientAiAssistant({ client, projects, activity, stats, onNavigate, open, setOpen }) {
  const [messages, setMessages] = useState([
    { from: "ai", text: "Hi! I'm your AI assistant. Ask me about your project progress, recent activity, or support.", time: nowLabel() },
  ]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [listening, setListening] = useState(false);
  const firstName = (client.contactPerson || "there").split(" ")[0];
  const messagesEndRef = useRef(null);

  // Auto-scroll to the newest message whenever the thread grows or the
  // panel opens — the client shouldn't have to scroll down manually to
  // see their own message or the AI's reply.
  useEffect(() => {
    if (!open) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, typing, open]);

  const ctx = { client, firstName, projects, activity, onNavigate, ...stats };

  function sendMessage(rawText) {
    const text = (rawText ?? input).trim();
    if (!text) return;
    setMessages((prev) => [...prev, { from: "user", text, time: nowLabel() }]);
    setInput("");
    setTyping(true);
    setTimeout(() => {
      const reply = buildAiReply(text, ctx);
      setMessages((prev) => [...prev, { from: "ai", text: reply, time: nowLabel() }]);
      setTyping(false);
    }, 550);
  }

  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Voice input isn't supported in this browser.");
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onresult = (e) => {
      const finalTranscript = e.results?.[0]?.[0]?.transcript;
      if (finalTranscript) sendMessage(finalTranscript);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    setListening(true);
    recognition.start();
  }

  return (
    <>
      {/* Floating toggle bubble */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-24 right-5 sm:bottom-6 sm:right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 text-white shadow-xl shadow-violet-900/40 flex items-center justify-center hover:opacity-90 transition"
        aria-label={open ? "Close AI Assistant" : "Open AI Assistant"}
      >
        {open ? <XIcon className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
      </button>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-40 right-5 sm:bottom-24 sm:right-6 z-50 w-[92vw] max-w-sm h-[65vh] max-h-[520px] bg-[#15101f] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-2.5 px-4 py-3.5 border-b border-white/10 bg-gradient-to-r from-violet-600/20 to-purple-600/10 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-violet-500/20 text-violet-300 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-white truncate">AI Assistant</p>
              <p className="text-[10.5px] text-slate-500 truncate">Ask about your project, anytime</p>
            </div>
            <button onClick={() => setOpen(false)} className="w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10">
              <XIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-2">
            {AI_QUICK_COMMANDS.map((cmd) => (
              <button
                key={cmd}
                onClick={() => sendMessage(cmd)}
                className="w-full flex items-center justify-between gap-2 text-left text-[11px] font-medium rounded-lg px-3 py-2.5 bg-white/5 text-slate-300 hover:bg-violet-500/15 hover:text-violet-300 transition-colors"
              >
                <span>{cmd}</span>
                <Send className="w-3 h-3 shrink-0 text-violet-400" />
              </button>
            ))}

            <div className="pt-1.5 space-y-2.5">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2.5 text-[11.5px] whitespace-pre-line ${
                      m.from === "user"
                        ? "bg-gradient-to-br from-violet-600 to-purple-600 text-white rounded-br-sm"
                        : "bg-white/5 text-slate-300 rounded-bl-sm"
                    }`}
                  >
                    {m.from === "ai" && (
                      <p className="font-semibold text-violet-400 mb-1 flex items-center gap-1 text-[10.5px]">
                        <Sparkles className="w-2.5 h-2.5" /> AI Assistant
                      </p>
                    )}
                    <p>{m.text}</p>
                    <p className={`mt-1 text-[9px] ${m.from === "user" ? "text-violet-100/80" : "text-slate-500"}`}>{m.time}</p>
                  </div>
                </div>
              ))}
              {typing && (
                <div className="flex justify-start">
                  <div className="rounded-xl rounded-bl-sm px-3 py-2.5 flex gap-1 items-center bg-white/5">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="p-3 border-t border-white/10 shrink-0">
            <div className="flex items-center gap-2 rounded-xl px-3 py-1.5 bg-white/5">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                placeholder={listening ? "Listening..." : "Type your question..."}
                className="flex-1 bg-transparent text-[11.5px] outline-none placeholder:text-slate-500 min-w-0 text-slate-100"
              />
              <button
                onClick={toggleVoiceInput}
                className={`shrink-0 rounded-full p-1 transition-colors ${listening ? "text-rose-400 bg-rose-500/10 animate-pulse" : "text-slate-400 hover:text-slate-200"}`}
                aria-label={listening ? "Stop recording" : "Record voice question"}
                title={listening ? "Listening… tap to stop" : "Tap to speak"}
              >
                <Mic className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => sendMessage(input)}
                className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-purple-600 text-white flex items-center justify-center hover:opacity-90"
                aria-label="Send"
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ======================================================================
   SMALL UI HELPERS
====================================================================== */

const AVATAR_PALETTE = [
  "bg-indigo-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-teal-500",
  "bg-orange-500",
];

function colorFor(str) {
  let hash = 0;
  const s = str || "?";
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function companyCode(name) {
  const words = (name || "?").split(" ").filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (name || "??").slice(0, 2).toUpperCase();
}

// FEATURE (client profile picture): pass `imageUrl` (the client's own
// `profilePic`, set from the Add/Edit Client form on the admin side, or
// updated by the client themself from Profile Settings below) and this
// renders that photo instead of the initials tile. No imageUrl falls
// back to the exact same colored-initials look as before.
function CompanyAvatar({ name, size = "w-12 h-12", text = "text-sm", imageUrl }) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={name || "Client"}
        className={`${size} rounded-xl object-cover shrink-0 ring-1 ring-white/10`}
      />
    );
  }
  return (
    <div className={`${size} ${colorFor(name)} rounded-xl flex items-center justify-center font-bold text-white shrink-0 ${text}`}>
      {companyCode(name)}
    </div>
  );
}

const STATUS_STYLES = {
  Active: "bg-emerald-500/15 text-emerald-400",
  Inactive: "bg-rose-500/15 text-rose-400",
};

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${STATUS_STYLES[status] || "bg-white/10 text-slate-300"}`}>
      {status}
    </span>
  );
}

// Counts leaf-level tasks — a module broken into sub-tasks (e.g.
// "Development" → Frontend/Backend/etc) contributes one unit per sub-task
// instead of one for the whole module, matching how progress % ic
// computed on the admin side.
function moduleTaskCounts(modules) {
  let total = 0;
  let done = 0;
  (modules || []).forEach((m) => {
    if (m.subModules && m.subModules.length) {
      total += m.subModules.length;
      done += m.subModules.filter((s) => s.done).length;
    } else {
      total += 1;
      if (m.done) done += 1;
    }
  });
  return { total, done };
}

/* ----------------------------------------------------------------------
   FINAL DELIVERABLE — the single zip the admin uploads once every module
   on a project is done. Stays locked (no download, no filename shown)
   until hasReceivedPayment() is true for this client, so a client can't
   grab the finished work before paying.
---------------------------------------------------------------------- */
/* ----------------------------------------------------------------------
   PAYMENT MODAL
   Opens when a client taps a locked milestone (a Lock icon, or a "Pay
   Now" button on the Billing tab). Shows the company logo/details and
   the bank account to send money to, then lets the client upload a
   screenshot as proof once they've sent it. Submitting doesn't mark
   the invoice Paid by itself — it flips it to "Submitted" and staff
   confirms it from the admin Billing tab, same as ClientsPage.jsx's
   own "Confirm Payment" flow expects.
---------------------------------------------------------------------- */
function PaymentModal({ client, invoice, onClose, onSubmitted }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!invoice) return null;

  const balance = Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0));
  const milestoneLabel = invoice.milestone ? MILESTONE_LABELS[invoice.milestone] : "";
  const alreadySubmitted = invoice.status === "Submitted";

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setError("");
    if (!f.type.startsWith("image/")) {
      setError("Please upload an image (screenshot) of the payment.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(f);
      setFile(f);
      setPreview(dataUrl);
    } catch (err) {
      setError(err.message || "Could not read that file.");
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      setError("Upload a screenshot of your payment first.");
      return;
    }
    setSubmitting(true);
    const ok = await submitPaymentProof(invoice.id, file);
    setSubmitting(false);
    if (!ok) {
      setError("Couldn't submit right now — please try again.");
      return;
    }
    setDone(true);
    onSubmitted?.();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[#15101f] border border-white/10 rounded-2xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
              <img src={phoenixLogo} alt={`${BRAND_NAME} logo`} className="w-full h-full object-contain p-1" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-white truncate">{BRAND_NAME}</p>
              <p className="text-[11px] text-slate-500 truncate">Complete your payment</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white shrink-0">
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        {done || alreadySubmitted ? (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto mb-3">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <p className="text-sm font-bold text-white">Payment submitted</p>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              We've received your screenshot for {invoice.number}. Our team will confirm it shortly and this milestone will unlock automatically —
              no need to do anything else.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 mb-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-slate-200">{invoice.number}</p>
                <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{invoice.status}</span>
              </div>
              {(milestoneLabel || invoice.projectName) && (
                <p className="text-[11px] mt-1 font-semibold text-violet-400">
                  {milestoneLabel}
                  {milestoneLabel && invoice.projectName ? " · " : ""}
                  {invoice.projectName}
                </p>
              )}
              <p className="text-[11px] text-slate-500 mt-1">Due {invoice.dueDate}</p>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                <span className="text-xs text-slate-400">Amount due</span>
                <span className="text-base font-extrabold text-white">{fmtMoney(balance)}</span>
              </div>
            </div>

            <p className="text-xs font-semibold text-slate-300 mb-2">Send payment to</p>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3.5 mb-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">Bank</span>
                <span className="text-xs font-semibold text-slate-200">{PAYMENT_BANK_NAME}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500">Account title</span>
                <span className="text-xs font-semibold text-slate-200">{PAYMENT_ACCOUNT_TITLE}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 shrink-0">Account no.</span>
                <span className="text-xs font-semibold text-slate-200 text-right break-all">{PAYMENT_ACCOUNT_NUMBER}</span>
              </div>
              <p className="text-[10.5px] text-slate-500 pt-1.5 border-t border-white/10 leading-relaxed">{PAYMENT_IBAN_NOTE}</p>
            </div>

            <p className="text-xs font-semibold text-slate-300 mb-2">Upload proof of payment</p>
            <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-white/15 rounded-xl p-5 cursor-pointer hover:border-violet-500/50 hover:bg-white/5 transition">
              {preview ? (
                <img src={preview} alt="Payment screenshot preview" className="w-full max-h-48 object-contain rounded-lg" />
              ) : (
                <>
                  <ImageIcon className="w-6 h-6 text-slate-500" />
                  <span className="text-xs text-slate-400 text-center">Tap to upload a screenshot of your bank transfer / receipt</span>
                </>
              )}
              <input type="file" accept="image/*" className="hidden" onChange={handleFile} />
            </label>
            {file && <p className="text-[11px] text-slate-500 mt-1.5 truncate">{file.name}</p>}
            {error && <p className="text-[11px] text-rose-400 mt-1.5">{error}</p>}

            <button
              onClick={handleSubmit}
              disabled={!preview || submitting}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90 mt-4"
            >
              <CheckCircle className="w-4 h-4" />
              {submitting ? "Submitting..." : "I've Made the Payment"}
            </button>
            <p className="text-[10.5px] text-slate-600 text-center mt-2.5">
              Your team will confirm this manually — the milestone unlocks as soon as it's approved.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------
   LOCKED MILESTONE BLOCK — shared "locked" card for a Frontend/Backend
   module or the final ZIP. Shows different states depending on where
   the matching invoice is at: no invoice yet, unpaid (tap to pay),
   awaiting confirmation, or (handled by the caller) unlocked.
---------------------------------------------------------------------- */
function LockedMilestoneBlock({ title, subtitle, invoice, onOpenPayment }) {
  const awaitingConfirmation = invoice?.status === "Submitted";
  const clickable = !!invoice && !awaitingConfirmation;

  return (
    <button
      type="button"
      onClick={clickable ? () => onOpenPayment(invoice) : undefined}
      className={`w-full flex items-center gap-2.5 rounded-xl bg-white/5 border border-white/10 p-3 text-left transition ${
        clickable ? "hover:border-violet-500/50 hover:bg-white/[0.07] cursor-pointer" : "cursor-default"
      }`}
    >
      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${awaitingConfirmation ? "bg-blue-500/15 text-blue-400" : "bg-amber-500/15 text-amber-400"}`}>
        <Lock className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-slate-200">{title}</p>
        <p className="text-[11px] text-slate-500">
          {awaitingConfirmation
            ? "Payment submitted — awaiting confirmation from our team."
            : invoice
            ? `${fmtMoney(Math.max(0, (invoice.amount || 0) - (invoice.paidAmount || 0)))} due · tap to pay`
            : subtitle}
        </p>
      </div>
      {clickable && <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
    </button>
  );
}

function FinalDeliverableBlock({ deliverableZip, client, onOpenPayment }) {
  // FIX (works for any milestone count now): used to gate on a
  // hardcoded "Milestone 4" invoice, which no longer means anything
  // once a project can have 2, 6, or any custom number of milestones.
  // Fully settled (isFullyPaid) is the one signal that's always correct
  // regardless of how the project's billing was split up.
  const paid = isFullyPaid(client);
  const resolved = useResolvedAttachments([deliverableZip]);
  const file = resolved[0];

  if (!paid) {
    return (
      <div className="mt-3 pt-3 border-t border-white/10">
        <LockedMilestoneBlock
          title="Final deliverable ready"
          subtitle="Available for download once your balance is fully paid."
          invoice={null}
          onOpenPayment={onOpenPayment}
        />
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      <a
        href={file?.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 hover:bg-emerald-500/15 transition"
      >
        <span className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
          <Archive className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-100 truncate">{deliverableZip.name}</p>
          <p className="text-[11px] text-emerald-400">Final deliverable — download</p>
        </div>
      </a>
    </div>
  );
}

// FIX (view the live URL before paying, download files only after):
// a module's attachments can mix a real link (a live/staging URL pasted
// by the team) with actual files (screenshots, videos, zips). The link
// is always safe to show — it just points somewhere, it doesn't hand
// over any deliverable — so a client can preview the work before ever
// paying. Real files (the actual deliverable) stay locked behind a
// payment the same as before. Frontend/Backend/Deployment are the
// modules a link is expected on (see ClientsPage.jsx's own
// LINK_REQUIRED_MODULES), but this applies to any module's link the
// same way.
function GatedModuleAttachments({ name, attachments = [], client, project, onOpenPayment }) {
  if (!attachments.length) return null;
  const links = attachments.filter((a) => a.type === "link");
  const files = attachments.filter((a) => a.type !== "link");
  const filesUnlocked = hasReceivedPayment(client);
  // FIX (see getPayableInvoiceForModule above): resolve the real invoice
  // this module's files unlock behind, so tapping the locked card opens
  // the actual payment popup instead of doing nothing.
  const payableInvoice = filesUnlocked ? null : getPayableInvoiceForModule(client, project?.name, name);
  return (
    <div className="mt-1.5 space-y-1.5">
      {links.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold text-slate-500 mb-1">Live URL — viewable before payment</p>
          <AttachmentGallery attachments={links} />
        </div>
      )}
      {files.length > 0 &&
        (filesUnlocked ? (
          <AttachmentGallery attachments={files} />
        ) : (
          <LockedMilestoneBlock
            title={`${name} files locked`}
            subtitle={payableInvoice ? "Tap to pay and unlock these files." : "Unlocks once your first payment is received."}
            invoice={payableInvoice}
            onOpenPayment={onOpenPayment}
          />
        ))}
    </div>
  );
}

// FIX (accepted module requests vanished into thin air): once the admin
// accepted a request on the Clients page, the client had no way of
// knowing — the pending notice above disappears the moment it's no
// longer "pending", and nothing ever took its place. This picks out
// this project's accepted-but-not-yet-finished requests so the client
// gets a clear "we're on it" instead of silence. It clears itself
// automatically once the matching module (or all its sub-tasks, for a
// module like "Development") is actually marked done — at that point
// the module's own row already shows it's complete, so the banner would
// just be stale noise.
function acceptedInProgressRequests(client, project) {
  return (client.moduleRequests || []).filter((r) => {
    if (r.projectName !== project.name || r.status !== "accepted") return false;
    const mod = (project.modules || []).find((m) => (m.name || "").toLowerCase() === (r.moduleName || "").toLowerCase());
    if (!mod) return true; // module not synced onto this project yet — still in progress
    if (mod.subModules && mod.subModules.length) return !mod.subModules.every((s) => s.done);
    return !mod.done;
  });
}

// FIX (couldn't request a "start" on a module the project already has):
// RequestModuleBlock below only ever offers module names the project
// does NOT already have (it deliberately filters existingModuleNames
// out), so a module like "Backend" that's already sitting on the
// project — just not started/finished yet — could never be nudged from
// here. This checks whether that exact module already has a pending
// request, so a quick one-tap "Request to start" button can be shown
// right on the module's own row instead.
function hasPendingRequestForModule(client, project, moduleName) {
  return (client.moduleRequests || []).some(
    (r) =>
      r.projectName === project.name &&
      r.status === "pending" &&
      (r.moduleName || "").trim().toLowerCase() === (moduleName || "").trim().toLowerCase()
  );
}

// FIX (client couldn't request "Frontend" once UI/UX Design was
// delivered): the quick "Request to start" button above only ever
// renders for a module that's already sitting in project.modules — so a
// project that jumps straight from "UI/UX Design" to "Backend" (no
// separate "Frontend" row yet) never offered a way to ask for Frontend
// at all. This checks whether the project already has a module (top-level
// or a sub-task) by this name, same lookup RequestModuleBlock's own
// "existing module" list already uses.
function projectHasModule(project, moduleName) {
  const target = (moduleName || "").trim().toLowerCase();
  return (project.modules || []).some(
    (m) => (m.name || "").trim().toLowerCase() === target || (m.subModules || []).some((s) => (s.name || "").trim().toLowerCase() === target)
  );
}

// Common module names offered as quick-pick options so a client can ask
// to start one of the "usual" modules (matching the exact names
// ClientsPage.jsx's own project-type checklists are built from) instead
// of always having to type one out by hand. Kept as a plain list here —
// this portal has no import path to that file's own PROJECT_TYPES
// catalog — but the names match verbatim, so picking "Backend" here
// lines up with the same "Backend" the Tasks page already knows how to
// gate/require a link for.
const COMMON_MODULE_OPTIONS = ["UI/UX Design", "Frontend", "Backend", "Database", "API Integration", "Testing", "Deployment"];

// FIX (client-initiated "start the next module" requests): once a
// module's work is visibly moving along (or already paid for), the
// client can ask for another module to be kicked off — e.g. "start
// Backend now that Frontend is live" — right from their own portal,
// instead of emailing/calling the team. Submits into the shared
// clientspage_clients_v1 record as a pending request; the admin Accepts
// or Declines it from the Clients page, and Accepting is what actually
// adds the module and gets a task assigned.
//
// FIX (only ever offered a brand-new custom module name): this used to
// be a single free-text field, so a client wanting the perfectly
// ordinary "Backend" or "Deployment" module had to type it out exactly
// right themselves. It now offers a quick-pick list of the common
// modules this project doesn't already have (top-level OR as one of
// "Development"'s own sub-tasks) alongside a "custom name" option for
// anything genuinely new/one-off.
function RequestModuleBlock({ client, project, isOpen, onOpenChange, onSubmitted }) {
  const existingModuleNames = useMemo(() => {
    const names = new Set();
    (project.modules || []).forEach((m) => {
      names.add((m.name || "").trim().toLowerCase());
      (m.subModules || []).forEach((s) => names.add((s.name || "").trim().toLowerCase()));
    });
    return names;
  }, [project]);

  const availableExisting = useMemo(
    () => COMMON_MODULE_OPTIONS.filter((n) => !existingModuleNames.has(n.toLowerCase())),
    [existingModuleNames]
  );

  const [mode, setMode] = useState(availableExisting.length > 0 ? "existing" : "custom");
  const [selectedExisting, setSelectedExisting] = useState(availableExisting[0] || "");
  const [moduleName, setModuleName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // FIX (describe a brand-new module with a picture or a reference URL):
  // when a client is asking for a genuinely new module (not one of the
  // common quick-picks), a note alone is often not enough — they may
  // want to show a screenshot of what they mean, or link a site/example.
  // Only offered in "custom" (New module) mode; picking one of the
  // common quick-pick modules doesn't need it.
  const [attachMode, setAttachMode] = useState("none"); // "none" | "image" | "link"
  const [attachFile, setAttachFile] = useState(null);
  const [attachPreview, setAttachPreview] = useState("");
  const [attachUrl, setAttachUrl] = useState("");
  const [attachError, setAttachError] = useState("");
  // Surfaces a real submit failure (permission/validation/network) — see
  // submitModuleRequest's comment: this used to be swallowed entirely,
  // so the form just silently sat there with no sign anything went wrong.
  const [submitError, setSubmitError] = useState("");

  const handleAttachFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAttachError("");
    if (!f.type.startsWith("image/")) {
      setAttachError("Please upload an image file.");
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(f);
      setAttachFile(f);
      setAttachPreview(dataUrl);
    } catch (err) {
      setAttachError(err.message || "Could not read that image.");
    }
  };

  // Keeps the dropdown's selected value valid if the project's own
  // module list changes while this form happens to be open (e.g. an
  // earlier request for "Backend" gets accepted elsewhere while this
  // form is still sitting open) — falls back to whatever's left, or
  // over to the custom-name tab if nothing "existing" remains at all.
  useEffect(() => {
    if (mode !== "existing") return;
    if (availableExisting.includes(selectedExisting)) return;
    if (availableExisting.length > 0) setSelectedExisting(availableExisting[0]);
    else setMode("custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableExisting]);

  const trimmedCustomName = moduleName.trim();
  const finalModuleName = mode === "existing" ? selectedExisting : trimmedCustomName;

  const pendingForThisProject = (client.moduleRequests || []).filter(
    (r) => r.projectName === project.name && r.status === "pending"
  );

  const handleSubmit = async () => {
    if (!finalModuleName) return;
    if (attachMode === "link" && attachUrl.trim() && !/^https?:\/\//i.test(attachUrl.trim())) {
      setAttachError("Link should start with http:// or https://");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    let attachment = null;
    if (mode === "custom") {
      if (attachMode === "image" && attachFile) {
        attachment = { type: "image", file: attachFile };
      } else if (attachMode === "link" && attachUrl.trim()) {
        attachment = { type: "link", url: attachUrl.trim() };
      }
    }
    const { ok, error } = await submitModuleRequest({ projectId: project.id, moduleName: finalModuleName, note, attachment });
    setSubmitting(false);
    if (ok) {
      setDone(true);
      setModuleName("");
      setNote("");
      setAttachMode("none");
      setAttachFile(null);
      setAttachPreview("");
      setAttachUrl("");
      setAttachError("");
      onSubmitted?.();
      setTimeout(() => {
        setDone(false);
        onOpenChange(false);
      }, 1600);
    } else {
      setSubmitError(error || "Couldn't send this request. Please try again.");
    }
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="mt-3 pt-3 border-t border-white/10 w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-violet-400 hover:text-violet-300"
      >
        <PlusCircle className="w-3.5 h-3.5" /> Request to start a module
      </button>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      {done ? (
        <p className="text-xs font-semibold text-emerald-400 text-center py-2">Request sent — our team will review it shortly.</p>
      ) : (
        <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
          {pendingForThisProject.length > 0 && (
            <p className="text-[10.5px] text-amber-400">
              {pendingForThisProject.length} request{pendingForThisProject.length > 1 ? "s" : ""} already pending review.
            </p>
          )}

          {availableExisting.length > 0 && (
            <div className="flex gap-1.5 p-0.5 rounded-lg bg-black/20">
              <button
                type="button"
                onClick={() => setMode("existing")}
                className={`flex-1 text-[10.5px] font-semibold rounded-md py-1.5 transition ${
                  mode === "existing" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Existing module
              </button>
              <button
                type="button"
                onClick={() => setMode("custom")}
                className={`flex-1 text-[10.5px] font-semibold rounded-md py-1.5 transition ${
                  mode === "custom" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                New module
              </button>
            </div>
          )}

          {mode === "existing" && availableExisting.length > 0 ? (
            <div>
              <label className="text-[10.5px] font-semibold text-slate-400 mb-1 block">Choose a module</label>
              <select
                value={selectedExisting}
                onChange={(e) => setSelectedExisting(e.target.value)}
                className="w-full text-xs rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 text-slate-100 outline-none focus:border-violet-500/50"
              >
                {availableExisting.map((name) => (
                  <option key={name} value={name} className="bg-[#15101f]">
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="text-[10.5px] font-semibold text-slate-400 mb-1 block">Module name</label>
              <input
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                placeholder="e.g. Custom module name"
                className="w-full text-xs rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 text-slate-100 outline-none focus:border-violet-500/50"
              />
            </div>
          )}

          <div>
            <label className="text-[10.5px] font-semibold text-slate-400 mb-1 block">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add any specific details here"
              className="w-full text-xs rounded-lg bg-white/5 border border-white/10 px-2.5 py-2 text-slate-100 outline-none focus:border-violet-500/50 resize-none break-words"
            />
          </div>

          {/* Reference image or URL — only for a genuinely new (custom)
              module, so the team can see exactly what the client has in
              mind before accepting. */}
          {mode === "custom" && (
            <div>
              <label className="text-[10.5px] font-semibold text-slate-400 mb-1 block">Add a reference (optional)</label>
              <div className="flex gap-1.5 p-0.5 rounded-lg bg-black/20 mb-1.5">
                {[
                  { key: "none", label: "None" },
                  { key: "image", label: "Image" },
                  { key: "link", label: "URL" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setAttachMode(opt.key);
                      setAttachError("");
                    }}
                    className={`flex-1 text-[10.5px] font-semibold rounded-md py-1.5 transition ${
                      attachMode === opt.key ? "bg-violet-600 text-white" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {attachMode === "image" && (
                <label className="flex flex-col items-center justify-center gap-1.5 border border-dashed border-white/15 rounded-lg p-3 cursor-pointer hover:border-violet-500/50 hover:bg-white/5 transition">
                  {attachPreview ? (
                    <img src={attachPreview} alt="Reference preview" className="w-full max-h-32 object-contain rounded-md" />
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4 text-slate-500" />
                      <span className="text-[10.5px] text-slate-400 text-center">Tap to attach an image of what you mean</span>
                    </>
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAttachFile} />
                </label>
              )}

              {attachMode === "link" && (
                <div className="relative">
                  <Link2 className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={attachUrl}
                    onChange={(e) => setAttachUrl(e.target.value)}
                    placeholder="https://example.com/reference"
                    className="w-full text-xs rounded-lg bg-white/5 border border-white/10 pl-8 pr-2.5 py-2 text-slate-100 outline-none focus:border-violet-500/50"
                  />
                </div>
              )}

              {attachError && <p className="text-[10.5px] text-rose-400 mt-1">{attachError}</p>}
            </div>
          )}

          {submitError && <p className="text-[10.5px] text-rose-400 mt-1">{submitError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setAttachMode("none");
                setAttachFile(null);
                setAttachPreview("");
                setAttachUrl("");
                setAttachError("");
                onOpenChange(false);
              }}
              className="flex-1 text-[11px] font-semibold text-slate-300 border border-white/10 rounded-full py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!finalModuleName || submitting}
              onClick={handleSubmit}
              className="flex-1 text-[11px] font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 disabled:opacity-40 rounded-full py-1.5"
            >
              {submitting ? "Sending..." : "Send Request"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ value }) {
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10">
        <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-400 transition-all duration-500" style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10.5px] font-semibold w-8 text-right shrink-0 text-slate-400">{value}%</span>
    </div>
  );
}

/* ----------------------------------------------------------------------
   ATTACHMENT GALLERY — renders whatever the team uploaded against a
   module/sub-task from the Tasks page (screenshots, short videos, or
   links) so the client can actually open and view it, not just see a
   checkmark. Images/videos open in a lightweight in-page lightbox;
   links open in a new tab.
---------------------------------------------------------------------- */
function AttachmentGallery({ attachments: rawAttachments = [] }) {
  const [preview, setPreview] = useState(null); // the attachment currently shown full-size
  const attachments = useResolvedAttachments(rawAttachments);
  if (!attachments.length) return null;
  // Only image/video get the in-page lightbox — links, zips, and any
  // other file type just open/download in a new tab like a link does.
  const isPreviewable = (a) => a.type === "image" || a.type === "video";
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {attachments.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => (isPreviewable(a) ? setPreview(a) : window.open(a.url, "_blank", "noopener,noreferrer"))}
            className="group relative inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 hover:border-violet-400/50 transition overflow-hidden"
            title={a.name}
          >
            {a.type === "image" ? (
              <img src={a.url} alt={a.name} className="w-9 h-9 object-cover" />
            ) : a.type === "video" ? (
              <span className="w-9 h-9 flex items-center justify-center bg-violet-500/15 text-violet-400">
                <Video className="w-4 h-4" />
              </span>
            ) : a.type === "zip" ? (
              <span className="w-9 h-9 flex items-center justify-center bg-violet-500/15 text-violet-400">
                <Archive className="w-4 h-4" />
              </span>
            ) : a.type === "link" ? (
              <span className="w-9 h-9 flex items-center justify-center bg-violet-500/15 text-violet-400">
                <Link2 className="w-4 h-4" />
              </span>
            ) : (
              <span className="w-9 h-9 flex items-center justify-center bg-violet-500/15 text-violet-400">
                <FileIcon className="w-4 h-4" />
              </span>
            )}
            <span className="pr-2.5 text-[10.5px] font-medium text-slate-300 max-w-[100px] truncate">{a.name}</span>
          </button>
        ))}
      </div>

      {preview && (
        <div className="fixed inset-0 z-[200] bg-black/80 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="max-w-lg w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-white truncate pr-3">{preview.name}</p>
              <button onClick={() => setPreview(null)} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20">
                <XIcon className="w-4 h-4" />
              </button>
            </div>
            {preview.type === "image" ? (
              <img src={preview.url} alt={preview.name} className="w-full rounded-xl border border-white/10" />
            ) : (
              <video src={preview.url} controls autoPlay className="w-full rounded-xl border border-white/10" />
            )}
            <a
              href={preview.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-400 hover:text-violet-300"
            >
              Open in new tab <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </>
  );
}

function StatCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-[#15101f] border border-white/10 rounded-2xl p-4 flex items-center gap-3">
      <span className="w-11 h-11 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-extrabold leading-tight text-white">{value}</p>
        <p className="text-xs font-semibold text-slate-300 truncate">{label}</p>
        {sub && <p className="text-[11px] text-slate-500 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3">
      <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] text-slate-400 leading-tight">{label}</p>
        <p className="text-sm font-medium text-slate-100 truncate">{value}</p>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="bg-[#15101f] border border-white/10 rounded-2xl p-10 text-center">
      <div className="w-12 h-12 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-5 h-5" />
      </div>
      <p className="text-sm font-semibold text-slate-200">{title}</p>
      {text && <p className="text-xs text-slate-500 mt-1">{text}</p>}
    </div>
  );
}

/* ======================================================================
   ANIMATED BRAND MARK
   Same glowing/floating phoenix treatment used on the landing page,
   rebuilt here with the real logo asset — a big center bird with a
   soft pulsing glow, flanked by two smaller, fainter birds drifting up
   and down out of phase so the whole thing feels alive instead of a
   static image.
====================================================================== */

function PhoenixKeyframes() {
  return (
    <style>{`
      @keyframes phxFloat { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
      @keyframes phxFloatSmA { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-7px); } }
      @keyframes phxFloatSmB { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
      @keyframes phxGlow {
        0%, 100% { filter: drop-shadow(0 0 16px rgba(139,92,246,0.55)) drop-shadow(0 0 34px rgba(139,92,246,0.25)); }
        50% { filter: drop-shadow(0 0 28px rgba(168,85,247,0.85)) drop-shadow(0 0 52px rgba(139,92,246,0.45)); }
      }
      @keyframes phxFade { 0%, 100% { opacity: 0.35; } 50% { opacity: 0.7; } }
    `}</style>
  );
}

function HangingSpotlightBird() {
  return (
    <div className="relative bg-[#0d0818] overflow-hidden w-full h-full min-h-[420px] flex items-center justify-center">
      <PhoenixKeyframes />
      <style>{`
        /* --- one-time intro: the fixture drops in and the bulb switches on --- */
        @keyframes lampDrop {
          0% { transform: translateY(-70px); opacity: 0; }
          65% { transform: translateY(8px); opacity: 1; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes wireDrop {
          0% { height: 0; opacity: 0; }
          100% { height: 2.5rem; opacity: 1; }
        }
        @keyframes bulbTurnOn {
          0%, 60% { opacity: 0; filter: none; }
          80% { opacity: 1; filter: drop-shadow(0 0 32px rgba(233,213,255,1)) drop-shadow(0 0 64px rgba(139,92,246,1)); }
          100% { opacity: 0.85; filter: drop-shadow(0 0 10px rgba(233,213,255,0.9)) drop-shadow(0 0 26px rgba(139,92,246,0.6)); }
        }
        @keyframes beamAppear {
          0%, 60% { opacity: 0; }
          100% { opacity: 0.5; }
        }
        @keyframes birdAwaken {
          0%, 60% { opacity: 0; transform: translateY(16px) scale(0.85); filter: drop-shadow(0 0 0 transparent); }
          85% { opacity: 1; transform: translateY(-6px) scale(1.05); filter: drop-shadow(0 0 34px rgba(168,85,247,0.9)); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }

        /* --- continuous ambient motion, picks up once the intro ends --- */
        @keyframes lampSwing { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
        @keyframes bulbPulse {
          0%, 100% { opacity: 0.85; filter: drop-shadow(0 0 10px rgba(233,213,255,0.9)) drop-shadow(0 0 26px rgba(139,92,246,0.6)); }
          50% { opacity: 1; filter: drop-shadow(0 0 16px rgba(233,213,255,1)) drop-shadow(0 0 40px rgba(139,92,246,0.85)); }
        }
        @keyframes beamPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.85; } }
      `}</style>

      {/* soft ambient glow filling the card, behind everything */}
      <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(circle at 50% 30%, rgba(124,58,237,0.18), transparent 60%)" }} />

      <div className="relative w-72 h-[26rem] shrink-0">
        {/* ceiling wire — grows in as the fixture drops */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-px bg-white/15"
          style={{ animation: "wireDrop 1s ease-out forwards" }}
        />

        {/* lamp shade + bulb — drops in on the wire, then swings gently */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2">
          <div style={{ animation: "lampDrop 1s cubic-bezier(0.34,1.56,0.64,1) forwards" }}>
            <div
              className="flex flex-col items-center"
              style={{ transformOrigin: "top center", animation: "lampSwing 6s ease-in-out infinite", animationDelay: "1s" }}
            >
              <div
                className="w-20 h-9 bg-gradient-to-b from-slate-600 to-slate-900 border-x border-t border-white/10"
                style={{ clipPath: "polygon(32% 0%, 68% 0%, 100% 100%, 0% 100%)" }}
              />
              <div
                className="w-5 h-5 rounded-full bg-violet-100 -mt-1"
                style={{ animation: "bulbTurnOn 1.6s ease-out forwards, bulbPulse 3s ease-in-out infinite 1.6s" }}
              />

              {/* pull-chain, offset to the side like a real fixture */}
              <div className="absolute left-[68%] top-9 w-px h-10 bg-white/10" />
              <div className="absolute left-[68%] top-[76px] -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-violet-400/70" />
            </div>
          </div>
        </div>

        {/* light beam cone — fades in the moment the bulb switches on */}
        <div
          className="absolute top-16 left-1/2 -translate-x-1/2 w-64 h-80"
          style={{
            clipPath: "polygon(47% 0%, 53% 0%, 94% 100%, 6% 100%)",
            background: "linear-gradient(to bottom, rgba(221,214,254,0.5), rgba(139,92,246,0.16) 55%, transparent 90%)",
            animation: "beamAppear 1.6s ease-out forwards, beamPulse 3.5s ease-in-out infinite 1.6s",
          }}
        />

        {/* the phoenix, awakening in the light as it comes on — centering
            transform lives on this wrapper (static) so the animation on
            the image below (which sets its own `transform`) can't knock
            the bird off-center under the beam. */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-36">
          <img
            src={phoenixLogo}
            alt={`${BRAND_NAME} logo`}
            className="w-full h-auto"
            style={{ animation: "birdAwaken 1.8s ease-out forwards, phxFloat 4s ease-in-out infinite 1.8s, phxGlow 3.5s ease-in-out infinite 1.8s" }}
          />
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   LOGIN SCREEN
====================================================================== */

const LOGIN_FEATURES = [
  {
    icon: BarChart3,
    title: "Real-time Updates",
    text: "Get instant updates on your project progress and activity.",
  },
  {
    icon: Briefcase,
    title: "All-in-One Access",
    text: "Access project details, documents, invoices and more in one place.",
  },
  {
    icon: MessageSquare,
    title: "Direct Communication",
    text: "Message your team and get quick responses.",
  },
];

function LoginScreen({ onLogin }) {
  // A remembered login (from a previous "Remember me" checkbox) wins over
  // a bare ?id= link, since it's a more specific, deliberate choice by the
  // client — but the link is still honored when nothing is remembered.
  const remembered = typeof window !== "undefined" ? loadRememberedLogin() : null;
  const [clientId, setClientId] = useState(() => remembered?.clientId || clientIdFromUrl());
  const [email, setEmail] = useState(() => remembered?.email || "");
  // Never persisted anywhere (not even with "Remember me") — typed fresh each time.
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(() => !!remembered);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const id = clientId.trim();
    const mail = email.trim().toLowerCase();
    if (!id || !mail || !password) {
      setError("Please enter your Client ID, email address and password.");
      return;
    }
    setSubmitting(true);
    try {
      const { token, client } = await portalApi.login(id, mail, password);
      // "Remember me" controls ONLY this — whether the Client ID + email
      // (never the password) stay saved in the browser for next time. The
      // active session below is separate and always keeps them logged in
      // until they log out.
      saveRememberedLogin(remember ? { clientId: client.id, email: mail } : null);
      onLogin(token, client);
    } catch (err) {
      setPassword("");
      setError(
        err.status === 429
          ? "Too many login attempts. Please wait a minute and try again."
          : err.message || "Invalid Client ID, email or password. Please confirm your details with your project team."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-[#0a0613] relative flex items-center justify-center overflow-x-hidden py-10 px-4 sm:px-6 lg:px-10"
      style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* ambient glow — sits behind the whole centered group, not just one side */}
      <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 50% 20%, rgba(124,58,237,0.22), transparent 55%)" }} />

      <div className="relative w-full max-w-6xl xl:max-w-[78rem] flex flex-col lg:flex-row items-center lg:items-stretch justify-center gap-10 xl:gap-14">
        {/* Pitch panel — stretches to match the card's height so "Need
            help?" and the copyright line sit at the bottom, same as before. */}
        <div className="hidden lg:flex lg:flex-col lg:justify-between w-full max-w-sm shrink-0">
          <div>
            <div className="flex items-center gap-3 mb-6">
              <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
                <img src={phoenixLogo} alt={`${BRAND_NAME} logo`} className="w-full h-full object-contain p-1.5" />
              </div>
              <div>
                <p className="text-lg font-extrabold text-white leading-tight">{BRAND_NAME}</p>
                <p className="text-[11px] tracking-wide text-slate-400 leading-tight">CLIENT PORTAL</p>
              </div>
            </div>

            <h1 className="text-4xl font-extrabold text-white leading-tight mb-3">
              Welcome to
              <br />
              <span className="bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">{BRAND_NAME}</span> Client Portal
            </h1>
            <p className="text-slate-400 mb-10">Stay updated with your projects, track progress, and collaborate with your team effortlessly.</p>

            <div className="space-y-5">
              {LOGIN_FEATURES.map((f) => (
                <div key={f.title} className="flex items-start gap-3.5">
                  <span className="w-10 h-10 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                    <f.icon className="w-4.5 h-4.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{f.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{f.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="bg-[#121020] border border-white/10 rounded-2xl p-4 flex items-center gap-3 mt-10">
              <span className="w-11 h-11 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                <Headphones className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white">Need help?</p>
                <p className="text-xs text-slate-400">Our support team is here for you 24/7.</p>
              </div>
              <a href={`mailto:${SUPPORT_EMAIL}`} title="Contact Support" className="shrink-0 text-violet-400 hover:text-violet-300">
                <ChevronRight className="w-4 h-4" />
              </a>
            </div>

            <p className="text-[11px] text-slate-600 mt-8">
              © 2026 <span className="text-violet-400">{BRAND_NAME}</span>. All rights reserved.
            </p>
          </div>
        </div>

        {/* Illustration + sign-in card, joined as ONE unit (same treatment
            as the Contact page: the hanging-light illustration and the
            form share a single rounded card, edge to edge, at equal
            height) — and now centered in the page instead of pinned to
            the right half. */}
        <div className="w-full max-w-md xl:max-w-4xl xl:flex rounded-3xl border border-white/10 overflow-hidden shadow-2xl bg-[#121020]">
          {/* illustration half — hanging light + phoenix, same height as the form */}
          <div className="hidden xl:flex xl:w-[44%] shrink-0">
            <HangingSpotlightBird />
          </div>

          {/* form half */}
          <div className="w-full xl:w-[56%] p-8 sm:p-10 xl:border-l xl:border-white/10 flex flex-col justify-center">
            {/* mobile-only brand mark */}
            <div className="lg:hidden flex items-center gap-2 mb-8 justify-center">
              <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center overflow-hidden">
                <img src={phoenixLogo} alt={`${BRAND_NAME} logo`} className="w-full h-full object-contain p-1" />
              </div>
              <span className="text-base font-extrabold text-white">{BRAND_NAME}</span>
            </div>

            <PhoenixKeyframes />
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4 overflow-hidden">
              <img
                src={phoenixLogo}
                alt={`${BRAND_NAME} logo`}
                className="w-full h-full object-contain p-2"
                style={{ animation: "phxFloat 4s ease-in-out infinite, phxGlow 3.5s ease-in-out infinite" }}
              />
            </div>
            <h2 className="text-xl font-extrabold text-white text-center">Welcome Back!</h2>
            <p className="text-sm text-slate-400 text-center mt-1 mb-6">Sign in to your client portal to continue</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-slate-300">Client ID</label>
                <div className="relative">
                  <IdCard className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="e.g. CLT-1024"
                    className="w-full text-sm border border-white/10 rounded-xl pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-white/5 text-white placeholder:text-slate-500"
                    autoFocus
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-slate-300">Email Address</label>
                <div className="relative">
                  <Mail className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@company.com"
                    autoComplete="username"
                    className="w-full text-sm border border-white/10 rounded-xl pl-10 pr-3 py-3 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-white/5 text-white placeholder:text-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block text-slate-300">Password</label>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Portal password from your account manager"
                    autoComplete="current-password"
                    className="w-full text-sm border border-white/10 rounded-xl pl-10 pr-11 py-3 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-white/5 text-white placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-2 text-slate-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-violet-500"
                  />
                  Remember me
                </label>
                <a href={`mailto:${SUPPORT_EMAIL}?subject=Client%20Portal%20login%20help`} className="font-semibold text-violet-400 hover:text-violet-300">
                  Forgot ID or password?
                </a>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 hover:opacity-90 disabled:opacity-60 text-white text-sm font-semibold py-3 rounded-xl transition"
              >
                <Lock className="w-3.5 h-3.5" />
                {submitting ? "Checking..." : "Log In to Portal"}
              </button>

              <div className="flex items-center gap-3 py-1">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-[11px] text-slate-500">or</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="w-full flex items-center justify-center gap-2 border border-white/10 hover:bg-white/5 text-slate-200 text-sm font-semibold py-3 rounded-xl transition"
              >
                <Mail className="w-3.5 h-3.5" />
                Contact Support
              </a>

              <p className="flex items-start gap-2 text-[11px] text-center text-slate-500 pt-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                <span>Your data is secure with us. We never share your information with anyone.</span>
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   SIDEBAR NAV
====================================================================== */

function NavItem({ icon: Icon, label, badge, dot, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition ${
        active ? "bg-gradient-to-r from-violet-600 to-purple-600 text-white" : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      <span className="relative shrink-0">
        <Icon className="w-4 h-4" />
        {dot && (
          <span
            className={`absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 ring-2 ${active ? "ring-violet-600" : "ring-[#0d0818]"}`}
          />
        )}
      </span>
      <span className="flex-1 text-left truncate">{label}</span>
      {!!badge && (
        <span className={`text-[10.5px] font-bold rounded-full min-w-[18px] h-[18px] px-1 flex items-center justify-center ${active ? "bg-white/25 text-white" : "bg-violet-600 text-white"}`}>
          {badge}
        </span>
      )}
    </button>
  );
}

function Sidebar({ client, view, onNavigate, mobileOpen, onCloseMobile, onLogout, onOpenProfile }) {
  const activityCount = (client.activity || []).length;
  // Invoices sitting in the client's court — unpaid and not yet submitted
  // for review — surfaced as a badge so a due milestone doesn't get missed.
  const billingActionCount = (client.invoices || []).filter(
    (inv) => inv.status !== "Paid" && inv.status !== "Submitted" && Math.max(0, (inv.amount || 0) - (inv.paidAmount || 0)) > 0
  ).length;
  // A quick, unmissable red dot alongside Projects/Billing whenever
  // something new landed there since the client last opened that tab —
  // see hasUnseenActivity above. Cleared by Dashboard's handleNavigate
  // the moment the client actually opens the matching tab.
  const showProjectsDot = hasUnseenActivity(client, "projects");
  const showBillingDot = hasUnseenActivity(client, "billing");

  const items = [
    { key: "dashboard", label: "Dashboard", icon: Home },
    { key: "projects", label: "Projects", icon: Calendar, dot: showProjectsDot },
    { key: "activity", label: "Activity Updates", icon: ActivityIcon, badge: activityCount },
    { key: "billing", label: "Billing", icon: CreditCard, badge: billingActionCount, dot: showBillingDot },
    { key: "documents", label: "Documents", icon: FileText },
    { key: "messages", label: "Messages", icon: MessageSquare },
    { key: "meetings", label: "Meetings", icon: CalendarDays },
    { key: "support", label: "Support", icon: HelpCircle },
  ];

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={onCloseMobile} />}
      <aside
        className={`fixed lg:static z-50 lg:z-auto top-0 left-0 h-full w-72 bg-[#0d0818] border-r border-white/10 flex flex-col p-5 transition-transform duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center gap-2.5 px-1 mb-8">
          <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
            <img src={phoenixLogo} alt={`${BRAND_NAME} logo`} className="w-full h-full object-contain p-1" />
          </div>
          <div className="min-w-0">
            <p className="text-base font-extrabold text-white leading-tight truncate">{BRAND_NAME}</p>
            <p className="text-[11px] text-slate-500 leading-tight truncate">{BRAND_TAGLINE}</p>
          </div>
        </div>

        <nav className="space-y-1 flex-1 overflow-y-auto">
          {items.map((it) => (
            <NavItem
              key={it.key}
              icon={it.icon}
              label={it.label}
              badge={it.badge}
              dot={it.dot}
              active={view === it.key}
              onClick={() => {
                onNavigate(it.key);
                onCloseMobile?.();
              }}
            />
          ))}
        </nav>

        {/* Pinned to the absolute bottom of the sidebar with mt-auto, so
            Need Help / profile / Log Out always sit at the very end —
            regardless of how tall the nav list above ends up being. */}
        <div className="mt-auto">
          <div className="bg-gradient-to-br from-violet-600/20 to-purple-600/10 border border-violet-500/20 rounded-2xl p-4 mt-4">
            <p className="text-sm font-bold text-white">Need Help?</p>
            <p className="text-xs text-slate-400 mt-1 mb-3">Our support team is here to help you 24/7</p>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold py-2.5 rounded-xl hover:opacity-90"
            >
              <Headphones className="w-3.5 h-3.5" />
              Contact Support
            </a>
          </div>

          <button
            type="button"
            onClick={onOpenProfile}
            className="w-full flex items-center gap-2.5 mt-4 px-1 pt-4 border-t border-white/10 hover:opacity-90 transition"
            title="Profile settings"
          >
            <CompanyAvatar name={client.contactPerson || client.name} size="w-9 h-9" text="text-xs" imageUrl={client.profilePic} />
            <div className="min-w-0 flex-1 text-left">
              <p className="text-xs font-bold text-slate-100 truncate">{client.contactPerson || client.name}</p>
              <p className="text-[11px] text-slate-500 truncate">Client</p>
            </div>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          </button>

          <button
            onClick={onLogout}
            className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-semibold text-slate-400 hover:bg-rose-500/10 hover:text-rose-400 transition mt-2"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left truncate">Log Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

/* ======================================================================
   PROFILE SETTINGS MODAL — opened from the Sidebar's bottom profile
   row. Lets the client view their own details and upload, change, or
   remove their profile picture, saving straight back into their own
   record via updateClientProfilePic() above so it shows up on the
   admin's Clients page immediately too.
====================================================================== */

const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024; // 8MB raw upload ceiling, before compression

function readAvatarFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type?.startsWith("image/")) {
      reject(new Error("Please choose an image file."));
      return;
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      reject(new Error("Image is too large (max 8MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        // Same downscale-then-encode pass compressImageDataUrl already
        // uses for payment screenshots, just aimed at a much smaller
        // target since this only ever needs to look good as an avatar.
        resolve(await compressImageDataUrl(reader.result, 180 * 1024));
      } catch {
        resolve(reader.result);
      }
    };
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

function ClientProfileModal({ client, open, onClose, onRefresh }) {
  const inputRef = useRef(null);
  // Local preview of a newly picked (not yet saved) photo — null means
  // "no pending change, show client.profilePic as-is". pendingFile holds
  // the raw File for that same pick (needed for the actual upload).
  const [pendingPic, setPendingPic] = useState(undefined);
  const [pendingFile, setPendingFile] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (!open) return null;

  const currentPic = pendingPic !== undefined ? pendingPic : client.profilePic || null;
  const dirty = pendingPic !== undefined && pendingPic !== (client.profilePic || null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    setSaved(false);
    setLoading(true);
    try {
      const dataUrl = await readAvatarFile(file);
      setPendingPic(dataUrl);
      setPendingFile(file);
    } catch (err) {
      setError(err?.message || "Could not load that image.");
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!dirty) return;
    setSaving(true);
    const ok = await updateClientProfilePic(pendingPic ? pendingFile : null);
    setSaving(false);
    if (ok) {
      setPendingPic(undefined);
      setSaved(true);
      onRefresh?.();
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError("Couldn't save your photo right now — please try again.");
    }
  };

  const handleClose = () => {
    setPendingPic(undefined);
    setPendingFile(null);
    setError("");
    setSaved(false);
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={handleClose}>
      <div className="w-full max-w-sm bg-[#121020] border border-white/10 rounded-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-bold text-white">Profile Settings</h3>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5"
          >
            <XIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 mb-5">
          {currentPic ? (
            <img src={currentPic} alt="Your profile" className="w-24 h-24 rounded-2xl object-cover ring-1 ring-white/10" />
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-violet-500/15 text-violet-300 flex items-center justify-center font-bold text-2xl">
              {companyCode(client.contactPerson || client.name)}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={loading || saving}
              className="text-xs font-semibold px-3.5 py-2 rounded-lg bg-violet-600 text-white hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Uploading…" : currentPic ? "Change photo" : "Upload photo"}
            </button>
            {currentPic && !loading && (
              <button
                type="button"
                onClick={() => {
                  setPendingPic(null);
                  setPendingFile(null);
                  setSaved(false);
                }}
                disabled={saving}
                className="text-xs font-semibold px-3.5 py-2 rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
              >
                Remove
              </button>
            )}
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          {error && <p className="text-[11px] text-rose-400 text-center">{error}</p>}
        </div>

        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Name</span>
            <span className="text-slate-200 font-medium truncate ml-3">{client.contactPerson || client.name}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Company</span>
            <span className="text-slate-200 font-medium truncate ml-3">{client.name}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Email</span>
            <span className="text-slate-200 font-medium truncate ml-3">{client.email}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Client ID</span>
            <span className="text-slate-200 font-medium truncate ml-3">{client.id}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 border border-white/10 text-slate-300 text-sm font-semibold py-2.5 rounded-full hover:bg-white/5"
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="flex-1 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-sm font-semibold py-2.5 rounded-full hover:opacity-90 disabled:opacity-40"
          >
            {saving ? "Saving…" : saved ? "Saved ✓" : "Save changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ======================================================================
   RIGHT RAIL — project progress donut, quick links, promo banner
====================================================================== */

function ProgressDonut({ completedPct, inProgressPct, pendingPct, centerPct }) {
  const size = 128;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  const seg = (pct) => (pct / 100) * c;
  const completedLen = seg(completedPct);
  const inProgressLen = seg(inProgressPct);
  const pendingLen = seg(pendingPct);

  return (
    <div className="relative w-32 h-32 shrink-0">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#231b36" strokeWidth={stroke} />
        {pendingPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#f59e0b"
            strokeWidth={stroke}
            strokeDasharray={`${pendingLen} ${c - pendingLen}`}
            strokeLinecap="round"
          />
        )}
        {inProgressPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={stroke}
            strokeDasharray={`${inProgressLen} ${c - inProgressLen}`}
            strokeDashoffset={-pendingLen}
            strokeLinecap="round"
          />
        )}
        {completedPct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#22c55e"
            strokeWidth={stroke}
            strokeDasharray={`${completedLen} ${c - completedLen}`}
            strokeDashoffset={-(pendingLen + inProgressLen)}
            strokeLinecap="round"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-extrabold text-white">{centerPct ?? completedPct}%</span>
        <span className="text-[10px] text-slate-500">Progress</span>
      </div>
    </div>
  );
}

function RightRail({ client, projects, activity, onNavigate }) {
  const totalProjects = projects.length;

  // Real work-done percentages — this used to count how many WHOLE
  // projects fall into each bucket (e.g. a single project sitting at
  // 40% progress showed as "0% Completed / 100% In Progress" because
  // it was just one "active" project out of one). Instead, this sums
  // each project's own progress value: the done portion of every
  // project counts toward Completed, the remaining portion of a
  // started project counts toward In Progress, and the remaining
  // portion of an unstarted (0%) project counts toward Pending — so
  // the three segments now reflect actual progress data.
  const totalCapacity = totalProjects * 100;
  const completedPct = totalCapacity
    ? Math.round((projects.reduce((sum, p) => sum + (p.progress || 0), 0) / totalCapacity) * 100)
    : 0;
  const inProgressPct = totalCapacity
    ? Math.round(
        (projects.reduce((sum, p) => sum + ((p.progress || 0) > 0 ? 100 - (p.progress || 0) : 0), 0) / totalCapacity) * 100
      )
    : 0;
  const pendingPct = Math.max(0, 100 - completedPct - inProgressPct);

  // Real work-done percentage — the average of each project's own
  // progress (task/module completion), same figure the Overview tab's
  // "Avg. Progress" stat card shows. completedPct/inProgressPct/pendingPct
  // above are a project-count breakdown (how many projects fall in each
  // bucket), not actual progress, so the donut's center used to read 0%
  // for a single in-progress project even though real work was done —
  // this is what the center number shows instead now.
  const avgProgress = totalProjects ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / totalProjects) : 0;

  const quickLinks = [
    { key: "projects", label: "View Project Details", icon: FileText },
    { key: "activity", label: "Activity Updates", icon: ActivityIcon, badge: activity.length },
    { key: "support", label: "Contact Support", icon: HelpCircle },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-[#15101f] border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
            <PieChart className="w-4 h-4" />
          </span>
          <p className="text-sm font-bold text-white">Project Progress</p>
        </div>
        <div className="flex items-center gap-5">
          <ProgressDonut completedPct={completedPct} inProgressPct={inProgressPct} pendingPct={pendingPct} centerPct={avgProgress} />
          <div className="space-y-2.5 text-xs flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-300 truncate">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> Completed
              </span>
              <span className="font-semibold text-slate-100 shrink-0">{completedPct}%</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-300 truncate">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" /> In Progress
              </span>
              <span className="font-semibold text-slate-100 shrink-0">{inProgressPct}%</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-slate-300 truncate">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" /> Pending
              </span>
              <span className="font-semibold text-slate-100 shrink-0">{pendingPct}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#15101f] border border-white/10 rounded-2xl p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
            <ExternalLink className="w-4 h-4" />
          </span>
          <p className="text-sm font-bold text-white">Quick Links</p>
        </div>
        <div className="space-y-0.5">
          {quickLinks.map((l) => (
            <button
              key={l.key}
              onClick={() => onNavigate(l.key)}
              className="w-full flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-sm text-slate-300 hover:bg-white/5 hover:text-white transition"
            >
              <l.icon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="flex-1 text-left truncate">{l.label}</span>
              {!!l.badge && <span className="text-[10px] font-bold bg-violet-600 text-white rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{l.badge}</span>}
              <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />
            </button>
          ))}
        </div>
      </div>

      <div className="relative overflow-hidden bg-gradient-to-br from-violet-700 to-purple-700 rounded-2xl p-5">
        <Crown className="w-4 h-4 text-amber-300 mb-2" />
        <p className="text-sm font-extrabold text-white leading-snug">We're Building Something Great!</p>
        <p className="text-xs text-violet-100/80 mt-1.5 leading-relaxed max-w-[70%]">
          Our team is working hard to deliver an amazing experience.
        </p>
        <Rocket className="w-14 h-14 text-white/90 absolute -right-2 -bottom-2 rotate-[20deg] opacity-90" />
        <Sparkles className="w-3.5 h-3.5 text-white/70 absolute right-8 top-4" />
      </div>
    </div>
  );
}

/* ======================================================================
   DOCUMENTS VIEW — portal client's own document library
   Fetches /api/dashboard/documents/ scoped to this client by the token
   (server enforces it — no client id needed on the request). Supports
   list, upload, download and delete.
====================================================================== */

function DocumentsView({ client }) {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  const reload = () => {
    setLoading(true);
    setLoadError(null);
    portalApi
      .fetchDocuments(currentToken)
      .then((rows) => {
        setDocs(Array.isArray(rows) ? rows : (rows.results || []));
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    portalApi
      .uploadDocument(currentToken, file)
      .then(() => reload())
      .catch((err) => setUploadError(err.message))
      .finally(() => {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      });
  };

  const handleDelete = (docId) => {
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    portalApi
      .deleteDocument(currentToken, docId)
      .then(() => setDocs((prev) => prev.filter((d) => d.id !== docId)))
      .catch((err) => alert("Delete failed: " + err.message));
  };

  return (
    <div>
      <h2 className="text-xl font-extrabold text-white mb-4">Documents</h2>
      <div className="bg-[#15101f] border border-white/10 rounded-2xl p-5">
        {/* Upload */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="text-sm font-semibold text-slate-300">Your Files</p>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              id="portal-doc-upload"
              className="hidden"
              onChange={handleUpload}
              disabled={uploading}
            />
            <label
              htmlFor="portal-doc-upload"
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl cursor-pointer transition bg-violet-600 hover:bg-violet-500 text-white ${uploading ? "opacity-50 pointer-events-none" : ""}`}
            >
              <Upload className="w-3.5 h-3.5" />
              {uploading ? "Uploading…" : "Upload File"}
            </label>
          </div>
        </div>

        {/* Errors */}
        {loadError && (
          <p className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 mb-3">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> Couldn't load documents: {loadError}
          </p>
        )}
        {uploadError && (
          <p className="flex items-center gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 mb-3">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {uploadError}
          </p>
        )}

        {/* List */}
        {loading && <p className="text-sm text-slate-500">Loading…</p>}
        {!loading && docs.length === 0 && !loadError && (
          <div className="text-center py-8">
            <div className="w-12 h-12 rounded-xl bg-white/5 text-slate-500 flex items-center justify-center mx-auto mb-3">
              <FileText className="w-5 h-5" />
            </div>
            <p className="text-sm text-slate-400">No documents uploaded yet.</p>
            <p className="text-xs text-slate-600 mt-1">Upload a file using the button above.</p>
          </div>
        )}
        <div className="space-y-2">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
              <span className="w-9 h-9 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-100 truncate">{d.file_name}</p>
                <p className="text-[11px] text-slate-500">
                  {d.file_size && <>{d.file_size} · </>}
                  {new Date(d.uploaded_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  {d.project_name && <> · {d.project_name}</>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {d.file_url && (
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={d.file_name}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-violet-400 transition"
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-slate-500 hover:text-rose-400 transition"
                  title="Delete document"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   DASHBOARD (READ-ONLY)
====================================================================== */

function Dashboard({ client, onLogout, onRefresh }) {
  const [view, setView] = useState(() => initialPortalView().view); // dashboard | billing | support
  const [tab, setTab] = useState(() => initialPortalView().tab); // overview | projects | activity (used when view === "dashboard")
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The invoice currently open in the payment popup (or null when closed).
  // Any locked milestone — a Frontend/Backend module, the final ZIP, or a
  // "Pay Now" button on the Billing tab — sets this to open the same modal.
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  // Full branded invoice document — opened by "View Invoice" on the
  // Billing tab below, same InvoiceDocumentPreview the admin side uses.
  const [viewingInvoice, setViewingInvoice] = useState(null);
  // Which project's "request a module" mini-form is currently open (by
  // project name), or null when none is open.
  const [requestingKey, setRequestingKey] = useState(null);
  // One-tap "Request to start" on a module the project already has (see
  // hasPendingRequestForModule above) — tracks each button's own local
  // status by moduleKey so tapping one doesn't affect any other row.
  const [quickStartStatus, setQuickStartStatus] = useState({}); // { [moduleKey]: "submitting" | "sent" }
  // FIX (a failed request silently reset the button with no explanation):
  // see submitModuleRequest's comment above — this is what actually
  // surfaces that error next to the button now instead of swallowing it.
  const [quickStartError, setQuickStartError] = useState({}); // { [moduleKey]: message }
  const requestModuleStart = async (moduleKey, projectName, moduleName, moduleId, projectId) => {
    if (quickStartStatus[moduleKey]) return;
    setQuickStartStatus((s) => ({ ...s, [moduleKey]: "submitting" }));
    setQuickStartError((e) => (e[moduleKey] ? { ...e, [moduleKey]: undefined } : e));
    const { ok, error } = moduleId
      ? await submitModuleRequest({ existingModuleId: moduleId })
      : await submitModuleRequest({ projectId, moduleName });
    if (ok) {
      setQuickStartStatus((s) => ({ ...s, [moduleKey]: "sent" }));
      onRefresh?.();
    } else {
      setQuickStartStatus((s) => {
        const next = { ...s };
        delete next[moduleKey];
        return next;
      });
      setQuickStartError((e) => ({ ...e, [moduleKey]: error }));
    }
  };
  // Controls the AI assistant panel — lifted up here (instead of living
  // only inside ClientAiAssistant) so the sparkle icon in the header can
  // open it too, in addition to the floating bubble button.
  const [aiOpen, setAiOpen] = useState(false);
  // Profile Settings modal — opened from the Sidebar's bottom profile row.
  const [profileOpen, setProfileOpen] = useState(false);

  const projects = client.projects || [];
  const activity = client.activity || [];

  // Support tab: composes a real email to hello.hopenix@gmail.com (the
  // only genuine way to "send" mail from a page with no backend) AND
  // logs the request into this client's message thread, so there's a
  // persisted record of support requests even though there's no
  // Messages tab to display it in anymore.
  const [supportSubject, setSupportSubject] = useState("");
  const [supportMessage, setSupportMessage] = useState("");
  const [supportSent, setSupportSent] = useState(false);
  const [supportError, setSupportError] = useState("");
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const sendSupportRequest = async (e) => {
    e.preventDefault();
    const text = supportMessage.trim();
    if (!text) return;
    const subject = supportSubject.trim() || `Support request from ${client.name || client.id}`;

    setSupportSubmitting(true);
    setSupportError("");
    try {
      await portalApi.sendSupportRequest(currentToken, subject, text);
      setSupportSubject("");
      setSupportMessage("");
      setSupportSent(true);
      setTimeout(() => setSupportSent(false), 5000);
      onRefresh?.();
    } catch (err) {
      setSupportError(err.message || "Couldn't send that right now — please try again.");
    } finally {
      setSupportSubmitting(false);
    }
  };

  const totalProjects = projects.length;
  const completedProjects = projects.filter((p) => p.progress >= 100).length;
  const inProgressProjects = totalProjects - completedProjects;
  const avgProgress = totalProjects ? Math.round(projects.reduce((sum, p) => sum + (p.progress || 0), 0) / totalProjects) : 0;

  const primaryProject = projects[0];

  // Sidebar / quick-link items that map to a project-focused tab live
  // under the "dashboard" view; everything else is its own page.
  const handleNavigate = (key) => {
    if (["projects", "activity"].includes(key)) {
      setView("dashboard");
      setTab(key);
      // Clears that section's red dot the moment the client actually
      // opens it — see hasUnseenActivity/markActivitySeen above.
      if (key === "projects") markActivitySeen(client.id, "projects", countActivityFor(client, "projects"));
    } else if (key === "dashboard") {
      setView("dashboard");
      setTab("overview");
    } else {
      setView(key);
      if (key === "billing") markActivitySeen(client.id, "billing", countActivityFor(client, "billing"));
    }
  };

  const firstName = (client.contactPerson || "there").split(" ")[0];

  return (
    <div className="min-h-screen bg-[#0a0613] flex" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      <Sidebar
        client={client}
        view={view}
        onNavigate={handleNavigate}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onLogout={onLogout}
        onOpenProfile={() => setProfileOpen(true)}
      />
      <ClientProfileModal client={client} open={profileOpen} onClose={() => setProfileOpen(false)} onRefresh={onRefresh} />

      <div className="flex-1 min-w-0">
        <div className="max-w-6xl mx-auto p-4 sm:p-8 pb-24 sm:pb-8">
          {/* mobile menu button */}
          <button
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden mb-4 flex items-center gap-2 text-xs font-semibold text-slate-300 border border-white/10 rounded-lg px-3 py-2"
          >
            <Home className="w-3.5 h-3.5" /> Menu
          </button>

          {/* Turn on phone/laptop notifications for messages, project updates and birthday wishes,
              and test that they arrive. Uses the PORTAL token (separate from any staff login). */}
          <EnableNotificationsBanner darkMode audience="client" token={currentToken} className="rounded-xl mb-4" />

          {view === "dashboard" && (
            <>
              {/* Welcome header */}
              <div className="bg-[#121020] border border-white/10 rounded-2xl p-6 mb-5 flex flex-wrap items-center justify-between gap-5">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm text-slate-400">Welcome back,</p>
                  <h1 className="flex flex-wrap items-baseline gap-2 text-2xl font-extrabold text-white mt-0.5 break-words">
                    <span>{client.contactPerson || client.name || "there"}</span>
                    <span className="text-xl">👋</span>
                  </h1>
                  <p className="text-sm text-slate-400 mt-1">Here's what's happening with your project today.</p>
                </div>
                <div className="hidden md:flex items-center gap-2.5 shrink-0">
                  <span className="w-11 h-11 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center">
                    <PieChart className="w-5 h-5" />
                  </span>
                  <span className="w-11 h-11 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center">
                    <BarChart3 className="w-5 h-5" />
                  </span>
                  <button
                    onClick={() => setAiOpen(true)}
                    title="Open AI Assistant"
                    className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600 to-purple-600 text-white flex items-center justify-center hover:opacity-90 transition"
                  >
                    <Sparkles className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Active project strip */}
              {primaryProject ? (
                <div className="bg-[#15101f] border border-white/10 rounded-2xl p-4 mb-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-orange-500 flex items-center justify-center font-bold text-white text-sm shrink-0">
                      {companyCode(primaryProject.name)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-sm text-white truncate">{primaryProject.name}</p>
                        <StatusBadge status={client.status || "Active"} />
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {primaryProject.progress >= 100 ? "Your project has been completed." : "Your project is currently in progress."}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={onRefresh} title="Refresh" className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-violet-400">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button onClick={onLogout} title="Log out" className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-rose-400">
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="bg-[#15101f] border border-white/10 rounded-2xl p-4 mb-5 flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400">No active project yet.</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button onClick={onRefresh} title="Refresh" className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-violet-400">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button onClick={onLogout} title="Log out" className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-rose-400">
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Quick stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <StatCard icon={Briefcase} label="Total Projects" value={totalProjects} sub="All your projects in one place" />
                <StatCard icon={CheckCircle2} label="Completed" value={completedProjects} sub="Projects completed" />
                <StatCard icon={ClipboardList} label="Pending / In Progress" value={inProgressProjects} sub="Projects in progress" />
                <StatCard icon={TrendingUp} label="Avg. Progress" value={`${avgProgress}%`} sub="Average project progress" />
              </div>

              <div className="grid lg:grid-cols-3 gap-5 items-start">
                <div className="lg:col-span-2">
                  {/* Tabs */}
                  <div className="flex items-center gap-1 border-b border-white/10 mb-4">
                    <button
                      onClick={() => setTab("overview")}
                      className={`px-3 py-2 text-sm font-semibold border-b-2 transition ${tab === "overview" ? "text-violet-400 border-violet-500" : "text-slate-500 border-transparent hover:text-slate-300"}`}
                    >
                      Overview
                    </button>
                    <button
                      onClick={() => setTab("projects")}
                      className={`px-3 py-2 text-sm font-semibold border-b-2 transition ${tab === "projects" ? "text-violet-400 border-violet-500" : "text-slate-500 border-transparent hover:text-slate-300"}`}
                    >
                      Projects ({totalProjects})
                    </button>
                    <button
                      onClick={() => setTab("activity")}
                      className={`px-3 py-2 text-sm font-semibold border-b-2 transition ${tab === "activity" ? "text-violet-400 border-violet-500" : "text-slate-500 border-transparent hover:text-slate-300"}`}
                    >
                      Activity Updates ({activity.length})
                    </button>
                  </div>

                  {tab === "overview" && (
                    <div className="space-y-4">
                      <div className="bg-[#15101f] border border-white/10 rounded-2xl p-5">
                        <div className="flex items-center gap-2.5 mb-3">
                          <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                            <UserCheck className="w-4 h-4" />
                          </span>
                          <p className="text-sm font-bold text-white">Account Details</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          <DetailRow icon={IdCard} label="Client ID" value={client.id} />
                          <DetailRow icon={Briefcase} label="Industry" value={client.industry} />
                          <DetailRow icon={CalendarDays} label="Client Since" value={client.since} />
                          <DetailRow icon={Mail} label="Contact Email" value={client.email} />
                          <DetailRow icon={Phone} label="Contact Phone" value={client.phone} />
                          <DetailRow icon={MapPin} label="Address" value={[client.address, client.country].filter(Boolean).join(", ")} />
                        </div>
                      </div>

                      {client.manager && (
                        <div className="bg-[#15101f] border border-white/10 rounded-2xl p-5">
                          <div className="flex items-center gap-2.5 mb-3">
                            <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                              <UserCheck className="w-4 h-4" />
                            </span>
                            <p className="text-sm font-bold text-white">Your Account Manager</p>
                          </div>
                          <div className="flex items-center justify-between gap-2.5 rounded-xl bg-white/5 p-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <CompanyAvatar name={client.manager.name} size="w-9 h-9" text="text-xs" />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-100 truncate">{client.manager.name}</p>
                                <p className="text-xs text-slate-500 truncate">{client.manager.role}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {client.manager.email && (
                                <a href={`mailto:${client.manager.email}`} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-violet-400">
                                  <Mail className="w-4 h-4" />
                                </a>
                              )}
                              {client.manager.phone && (
                                <a href={`tel:${client.manager.phone}`} className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/5 text-slate-300 hover:text-violet-400">
                                  <Phone className="w-4 h-4" />
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {activity.length > 0 && (
                        <div className="bg-[#15101f] border border-white/10 rounded-2xl p-5">
                          <div className="flex items-center gap-2.5 mb-3">
                            <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                              <ActivityIcon className="w-4 h-4" />
                            </span>
                            <p className="text-sm font-bold text-white">Latest Update</p>
                          </div>
                          <div className="flex items-start gap-3 rounded-xl bg-white/5 p-3">
                            <span className="w-2 h-2 rounded-full bg-violet-500 mt-1.5 shrink-0" />
                            <div className="min-w-0 flex-1 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm text-slate-100">{activity[0].text}</p>
                              </div>
                              <p className="text-[11px] text-slate-500 shrink-0 whitespace-nowrap">{activity[0].time}</p>
                            </div>
                          </div>
                          <button onClick={() => setTab("activity")} className="text-xs font-semibold text-violet-400 hover:text-violet-300 mt-3">
                            View All Updates
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {tab === "projects" && (
                    <div className="space-y-3">
                      {projects.length === 0 && <EmptyState icon={Calendar} title="No project records yet." />}
                      {projects.map((p) => {
                        const done = p.progress >= 100;
                        const modules = p.modules || [];
                        return (
                          <div key={p.name} className="bg-[#15101f] border border-white/10 rounded-2xl p-4">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="text-sm font-semibold text-white truncate">{p.name}</p>
                                {p.type && <span className="shrink-0 text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-300">{p.type}</span>}
                              </div>
                              <span
                                className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-semibold whitespace-nowrap ${
                                  done ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                                }`}
                              >
                                {done ? "Completed" : "Pending"}
                              </span>
                            </div>
                            {modules.length > 0 && (
                              <p className="text-[11px] text-slate-500 mb-2">
                                {moduleTaskCounts(modules).done}/{moduleTaskCounts(modules).total} tasks complete
                              </p>
                            )}
                            <ProgressBar value={p.progress} />
                            {acceptedInProgressRequests(client, p).map((r) => (
                              <p
                                key={r.id}
                                className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2 mt-2.5"
                              >
                                <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>
                                  "{r.moduleName}" request accepted — your work is in progress. Thanks for your request!
                                </span>
                              </p>
                            ))}
                            {modules.length > 0 && (
                              <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
                                {modules.map((m) => {
                                  const hasSubs = m.subModules && m.subModules.length > 0;
                                  const moduleKey = `${p.name}::${m.id || m.name}`;
                                  return (
                                    <div key={m.id || m.name}>
                                      <div className="flex items-center gap-1.5 text-xs">
                                        {m.done ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <Circle className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                                        <span className={`truncate font-medium ${m.done ? "text-slate-200" : "text-slate-500"}`}>{m.name}</span>
                                        {hasSubs && (
                                          <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                                            ({m.subModules.filter((s) => s.done).length}/{m.subModules.length})
                                          </span>
                                        )}
                                        {!m.done && (
                                          hasPendingRequestForModule(client, p, m.name) ? (
                                            <span className="shrink-0 ml-auto text-[10px] font-semibold text-amber-400">Request pending</span>
                                          ) : quickStartStatus[moduleKey] === "sent" ? (
                                            <span className="shrink-0 ml-auto text-[10px] font-semibold text-emerald-400">Request sent</span>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={() => requestModuleStart(moduleKey, p.name, m.name, m.id, p.id)}
                                              disabled={quickStartStatus[moduleKey] === "submitting"}
                                              className="shrink-0 ml-auto text-[10px] font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-60"
                                            >
                                              Request to start
                                            </button>
                                          )
                                        )}
                                      </div>
                                      {quickStartError[moduleKey] && (
                                        <p className="text-[10px] font-semibold text-rose-400 mt-0.5">{quickStartError[moduleKey]}</p>
                                      )}
                                      {!hasSubs && (
                                        <GatedModuleAttachments name={m.name} attachments={m.attachments} client={client} project={p} onOpenPayment={setPaymentInvoice} />
                                      )}
                                      {/* Once "UI/UX Design" is delivered, offer a one-tap
                                          "Request to start Frontend" right here — same as any
                                          other module's own "Request to start" button, just
                                          usable even before this project has a "Frontend" row
                                          of its own yet. No file attachment required, exactly
                                          like every other quick-start request. */}
                                      {m.name.trim().toLowerCase() === "ui/ux design" && m.done && !projectHasModule(p, "Frontend") && (
                                        hasPendingRequestForModule(client, p, "Frontend") ? (
                                          <p className="text-[10px] font-semibold text-amber-400 mt-1.5">"Frontend" request pending</p>
                                        ) : quickStartStatus[`${p.name}::__frontend`] === "sent" ? (
                                          <p className="text-[10px] font-semibold text-emerald-400 mt-1.5">"Frontend" request sent</p>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => requestModuleStart(`${p.name}::__frontend`, p.name, "Frontend", null, p.id)}
                                            disabled={quickStartStatus[`${p.name}::__frontend`] === "submitting"}
                                            className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-60"
                                          >
                                            <PlusCircle className="w-3 h-3" /> Request to start Frontend
                                          </button>
                                        )
                                      )}
                                      {quickStartError[`${p.name}::__frontend`] && (
                                        <p className="text-[10px] font-semibold text-rose-400 mt-0.5">{quickStartError[`${p.name}::__frontend`]}</p>
                                      )}
                                      {hasSubs && (
                                        <div className="ml-5 mt-1 grid grid-cols-2 gap-x-3 gap-y-2">
                                          {m.subModules.map((s) => {
                                            const subKey = `${p.name}::${s.id || s.name}`;
                                            return (
                                              <div key={s.id || s.name}>
                                                <div className="flex items-center gap-1.5 text-xs">
                                                  {s.done ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> : <Circle className="w-3 h-3 text-slate-600 shrink-0" />}
                                                  <span className={`truncate ${s.done ? "text-slate-200" : "text-slate-500"}`}>{s.name}</span>
                                                </div>
                                                {!s.done && (
                                                  hasPendingRequestForModule(client, p, s.name) ? (
                                                    <p className="text-[10px] font-semibold text-amber-400 mt-0.5">Request pending</p>
                                                  ) : quickStartStatus[subKey] === "sent" ? (
                                                    <p className="text-[10px] font-semibold text-emerald-400 mt-0.5">Request sent</p>
                                                  ) : (
                                                    <button
                                                      type="button"
                                                      onClick={() => requestModuleStart(subKey, p.name, s.name, s.id, p.id)}
                                                      disabled={quickStartStatus[subKey] === "submitting"}
                                                      className="text-[10px] font-semibold text-violet-400 hover:text-violet-300 disabled:opacity-60 mt-0.5"
                                                    >
                                                      Request to start
                                                    </button>
                                                  )
                                                )}
                                                {quickStartError[subKey] && (
                                                  <p className="text-[10px] font-semibold text-rose-400 mt-0.5">{quickStartError[subKey]}</p>
                                                )}
                                                <GatedModuleAttachments name={s.name} attachments={s.attachments} client={client} project={p} onOpenPayment={setPaymentInvoice} />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      {/* FIX ("request new module" should sit alongside every
                                          module, not just once at the very bottom of the whole
                                          project): each module now gets its own request trigger
                                          right under it, once the client has paid for at least
                                          one milestone. `requestingKey` is scoped per-module (not
                                          per-project) so opening one module's form doesn't affect
                                          any other module's. */}
                                      {!done && (
                                        <RequestModuleBlock
                                          client={client}
                                          project={p}
                                          isOpen={requestingKey === moduleKey}
                                          onOpenChange={(open) => setRequestingKey(open ? moduleKey : null)}
                                          onSubmitted={onRefresh}
                                        />
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {p.details && <p className="text-xs text-slate-400 mt-2.5 pt-2.5 border-t border-white/10 leading-relaxed">{p.details}</p>}
                            {done && p.deliverableZip && (
                              <FinalDeliverableBlock
                                deliverableZip={p.deliverableZip}
                                client={client}
                                onOpenPayment={setPaymentInvoice}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {tab === "activity" && (
                    <div className="space-y-2.5">
                      {activity.length === 0 && <EmptyState icon={ActivityIcon} title="No activity updates yet." />}
                      {activity.map((a, i) => (
                        <div key={i} className="flex items-start gap-2.5 bg-[#15101f] border border-white/10 rounded-2xl p-3.5">
                          <span className="w-8 h-8 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0 mt-0.5">
                            <ActivityIcon className="w-4 h-4" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-100">{a.text}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{a.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <RightRail client={client} projects={projects} activity={activity} onNavigate={handleNavigate} />
              </div>
            </>
          )}

          {view === "meetings" && (
            <div>
              <h2 className="text-xl font-extrabold text-white mb-4">Meetings</h2>
              <UserMeetings
                darkMode
                user={{ name: client.contactPerson || client.name || "Client", role: "Client" }}
              />
            </div>
          )}

          {view === "billing" && (
            <div>
              <h2 className="text-xl font-extrabold text-white mb-4">Billing</h2>
              {(client.invoices || []).length === 0 ? (
                <EmptyState icon={CreditCard} title="No invoices yet." text="Your project's 4-milestone payment schedule will show up here once your team generates the first invoice." />
              ) : (
                <div className="space-y-3">
                  {(client.invoices || []).map((inv) => {
                    const balance = Math.max(0, (inv.amount || 0) - (inv.paidAmount || 0));
                    const milestoneLabel = inv.milestone ? MILESTONE_LABELS[inv.milestone] : "";
                    const statusStyles =
                      inv.status === "Paid"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : inv.status === "Submitted"
                        ? "bg-blue-500/15 text-blue-400"
                        : inv.status === "Partial"
                        ? "bg-amber-500/15 text-amber-400"
                        : "bg-white/10 text-slate-300";
                    return (
                      <div key={inv.id} className="bg-[#15101f] border border-white/10 rounded-2xl p-4">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-bold text-white">{inv.number}</p>
                          <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusStyles}`}>{inv.status}</span>
                        </div>
                        {/* FIX (show "Clear Payment" once settled, not a
                            milestone label): once an invoice is fully
                            paid, the milestone wording ("Milestone 2 ·
                            Frontend Delivery") stops being useful to the
                            client — what matters to them now is simply
                            that this payment is cleared. Projects can
                            also have any custom number of milestones, so
                            leaning on milestone language after payment is
                            confusing. Still-unpaid/awaiting invoices keep
                            showing the milestone label as before. */}
                        {inv.status === "Paid" ? (
                          <p className="flex items-center gap-1 text-[11px] mt-1 font-semibold text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Clear Payment
                            {inv.projectName ? ` · ${inv.projectName}` : ""}
                          </p>
                        ) : (
                          (milestoneLabel || inv.projectName) && (
                            <p className="text-[11px] mt-1 font-semibold text-violet-400">
                              {milestoneLabel}
                              {milestoneLabel && inv.projectName ? " · " : ""}
                              {inv.projectName}
                            </p>
                          )
                        )}
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Issued {inv.issueDate} · Due {inv.dueDate}
                        </p>
                        {inv.note && <p className="text-xs text-slate-400 mt-1.5 break-words">{inv.note}</p>}
                        <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-white/10 text-xs">
                          <span className="text-slate-500">
                            Amount <span className="font-semibold text-slate-200">{fmtMoney(inv.amount)}</span>
                          </span>
                          <span className="text-slate-500">
                            Paid <span className="font-semibold text-emerald-400">{fmtMoney(inv.paidAmount || 0)}</span>
                          </span>
                        </div>
                        <button
                          onClick={() => setViewingInvoice(inv)}
                          className="w-full mt-2.5 flex items-center justify-center gap-1.5 border border-white/10 text-slate-200 text-xs font-semibold py-2 rounded-xl hover:bg-white/5"
                        >
                          <FileText className="w-3.5 h-3.5" /> View Invoice
                        </button>
                        {balance > 0 && inv.status !== "Submitted" && (
                          <button
                            onClick={() => setPaymentInvoice(inv)}
                            className="w-full mt-3 flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold py-2.5 rounded-xl hover:opacity-90"
                          >
                            <CreditCard className="w-3.5 h-3.5" /> Pay Now · {fmtMoney(balance)} due
                          </button>
                        )}
                        {inv.status === "Submitted" && (
                          <p className="flex items-center gap-1.5 text-[11px] text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 mt-3">
                            <CheckCircle className="w-3.5 h-3.5 shrink-0" /> Payment submitted — awaiting confirmation.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {view === "messages" && <ClientPortalMessages token={currentToken} />}

          {view === "support" && (
            <div>
              <h2 className="text-xl font-extrabold text-white mb-4">Support</h2>
              <div className="bg-[#15101f] border border-white/10 rounded-2xl p-6 sm:p-8">
                <div className="text-center mb-6">
                  <div className="w-12 h-12 rounded-xl bg-violet-500/15 text-violet-400 flex items-center justify-center mx-auto mb-3">
                    <Headphones className="w-5 h-5" />
                  </div>
                  <p className="text-sm font-semibold text-slate-200">Need a hand, {firstName}?</p>
                  <p className="text-xs text-slate-500 mt-1">Our support team is here for you 24/7.</p>
                </div>

                <form onSubmit={sendSupportRequest} className="max-w-md mx-auto space-y-3.5">
                  <div>
                    <label className="text-xs font-semibold mb-1.5 block text-slate-300">Subject</label>
                    <input
                      value={supportSubject}
                      onChange={(e) => setSupportSubject(e.target.value)}
                      placeholder="What's this about?"
                      className="w-full text-sm border border-white/10 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-white/5 text-white placeholder:text-slate-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold mb-1.5 block text-slate-300">Message</label>
                    <textarea
                      value={supportMessage}
                      onChange={(e) => setSupportMessage(e.target.value)}
                      placeholder="Tell us what's going on..."
                      rows={4}
                      className="w-full text-sm border border-white/10 rounded-xl px-3.5 py-2.5 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-white/5 text-white placeholder:text-slate-500 resize-none break-words"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={!supportMessage.trim() || supportSubmitting}
                    className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-purple-600 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-xl hover:opacity-90"
                  >
                    <Send className="w-4 h-4" /> {supportSubmitting ? "Sending…" : "Send to Support"}
                  </button>

                  {supportError && (
                    <p className="flex items-start gap-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{supportError}</span>
                    </p>
                  )}

                  {supportSent && (
                    <p className="flex items-start gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2.5">
                      <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>Your message has been sent to our support team — we'll get back to you shortly.</span>
                    </p>
                  )}

                  <div className="flex items-center gap-3 py-1">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[11px] text-slate-500">or email us directly</span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>

                  <div className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="w-9 h-9 rounded-lg bg-violet-500/15 text-violet-400 flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </span>
                      <span className="text-sm font-medium text-slate-200 truncate">{SUPPORT_EMAIL}</span>
                    </div>
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className="shrink-0 flex items-center gap-1.5 bg-white/10 text-white text-xs font-semibold px-3.5 py-2 rounded-lg hover:bg-white/15"
                    >
                      Open Email
                    </a>
                  </div>
                </form>
              </div>
            </div>
          )}

          {view === "documents" && (
            <DocumentsView client={client} />
          )}

          <p className="text-[11px] text-center text-slate-600 mt-8">This data syncs automatically with updates from your project team.</p>
          <p className="text-[11px] text-center text-slate-700 mt-2">© 2026 {BRAND_NAME}. All rights reserved.</p>
        </div>
      </div>

      <ClientAiAssistant
        client={client}
        projects={projects}
        activity={activity}
        onNavigate={handleNavigate}
        stats={{ avgProgress, totalProjects, completedProjects, inProgressProjects, primaryProject }}
        open={aiOpen}
        setOpen={setAiOpen}
      />

      {paymentInvoice && (
        <PaymentModal
          client={client}
          invoice={paymentInvoice}
          onClose={() => setPaymentInvoice(null)}
          onSubmitted={onRefresh}
        />
      )}

      {viewingInvoice && (
        <InvoiceDocumentPreview
          client={client}
          invoice={viewingInvoice}
          theme={PORTAL_INVOICE_THEME}
          onClose={() => setViewingInvoice(null)}
        />
      )}
    </div>
  );
}

/* ======================================================================
   ROOT — handles session, login/logout, and live-refreshing client data
====================================================================== */

export default function ClientPortal() {
  const [token, setToken] = useState(() => loadSession()?.token || null);
  const [client, setClient] = useState(null);
  // true while the very first /me/ fetch (on load, with an existing
  // token) is in flight — avoids flashing the login screen for someone
  // who's already logged in.
  const [loading, setLoading] = useState(() => !!loadSession()?.token);

  // `background` = true for the automatic re-checks below. A background
  // check only logs the client out when the server really rejected the
  // token (401/403) — a dropped connection or a server hiccup must never
  // kick a logged-in client back to the login screen.
  const refresh = (background = false) => {
    if (!token) return;
    portalApi
      .fetchMe(token)
      .then((data) => {
        const next = normalizePortalClient(data);
        setClient((prev) => {
          try {
            return prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
          } catch {
            return next;
          }
        });
      })
      .catch((err) => {
        if (background === true && !(err && (err.status === 401 || err.status === 403))) return;
        // Token invalid/expired — bounce back to login.
        setCurrentSession(null, null);
        setToken(null);
        setClient(null);
      })
      .finally(() => setLoading(false));
  };

  // Fetch on load (if there's a saved token) and again whenever the
  // token changes (login/logout). FIX: it also used to re-fetch ONLY on
  // window focus, so an admin changing something on another device
  // (project progress, a module, an invoice, activity) never reached an
  // already-open client portal. Now it also re-checks every 15s while the
  // tab is visible, when the tab becomes visible again, and on reconnect.
  useEffect(() => {
    if (!token) {
      setLoading(false);
      return undefined;
    }
    refresh();
    const bg = () => {
      if (document.visibilityState === "hidden") return;
      refresh(true);
    };
    const timer = setInterval(bg, 15000);
    window.addEventListener("focus", bg);
    window.addEventListener("online", bg);
    document.addEventListener("visibilitychange", bg);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", bg);
      window.removeEventListener("online", bg);
      document.removeEventListener("visibilitychange", bg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Pull this account's saved flags (seen-activity dots, birthday popup
  // dismissed, ...) from the server once the client is known, then bump a
  // counter so the dots re-evaluate against the merged data.
  const [, setFlagsVersion] = useState(0);
  const hydratedForRef = useRef(null);
  useEffect(() => {
    if (!token || !client?.id || hydratedForRef.current === `${token}:${client.id}`) return;
    hydratedForRef.current = `${token}:${client.id}`;
    hydrateFlags({ kind: "portal", ownerId: client.id }).then(() => setFlagsVersion((v) => v + 1));
  }, [token, client?.id]);

  // Any queued "it's this client's birthday today" entry (written by
  // ClientBirthdayCelebration.jsx below) just needs marking delivered
  // so the celebration doesn't replay — it isn't tied to the server
  // message thread.
  useEffect(() => {
    if (!client) return;
    const pending = getPendingClientBirthdayMessages().filter((m) => m.userId === client.id);
    pending.forEach((msg) => markBirthdayMessageDelivered(msg.userId, msg.dateKey, "client"));
  }, [client]);

  // Already allowed on this device -> make sure the push subscription exists
  // and is saved for THIS client (never prompts; the banner does that).
  useEffect(() => {
    if (!token || !client?.id) return;
    ensurePushSubscribed({ token });
  }, [token, client?.id]);

  const handleLogin = (newToken, clientData) => {
    setCurrentSession(newToken, clientData.id);
    setToken(newToken);
    setClient(normalizePortalClient(clientData));
    setLoading(false);
  };

  const handleLogout = async () => {
    await flushFlags(); // must run before portalApi.logout() revokes the token
    await clearPushSubscription({ token }); // same: needs the token, so before logout
    clearLocalFlags("portal");
    hydratedForRef.current = null;
    portalApi.logout();
    setCurrentSession(null, null);
    setToken(null);
    setClient(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0613] flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (!client) return <LoginScreen onLogin={handleLogin} />;

  return (
    <>
      <ClientBirthdayCelebration client={client} soundSrc={birthdayTune} />
      <Dashboard client={client} onLogout={handleLogout} onRefresh={refresh} />
    </>
  );
}