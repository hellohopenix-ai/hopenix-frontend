import React, { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../AuthContext.jsx";
import {
  UserPlus2,
  Search,
  UserCircle2,
  Phone,
  CreditCard,
  Building2,
  FileText,
  CalendarClock,
  Send,
  Bell,
  CheckCircle2,
  Clock3,
  XCircle,
  MoreHorizontal,
  History,
  ArrowRight,
  ChevronDown,
  Trash2,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  VisitorsPage                                                       */
/*                                                                      */
/*  Reception / front-desk visitor management, styled to match the      */
/*  rest of the Hopenix dashboard (same card, input, and button          */
/*  language as Dashboard.jsx / EmployeesPage.jsx / ClientsPage.jsx).    */
/*  The page inherits the sidebar + topbar automatically — it only       */
/*  renders the content area, exactly like every other page component    */
/*  Dashboard.jsx mounts inside <main>.                                  */
/*                                                                      */
/*  Two views, driven by the logged-in user's role (same convention      */
/*  Dashboard.jsx already uses: `user?.role === "admin"`):                */
/*                                                                      */
/*   - Admin  : Register form + live "Host Approval" panel (approve /    */
/*              ask to wait / reject) + full Recent Visitor Records      */
/*              table with a review action. Only admin can decide an     */
/*              approval — this is enforced here, not just hidden in     */
/*              the UI, so a non-admin can never call decide()/askToWait.*/
/*   - Manager (and any other non-admin role): Register form + a         */
/*              read-only Recent Visitor Records table. No approval      */
/*              panel, no approve/reject controls at all.                */
/*                                                                      */
/*  Data persists locally (localStorage) so the page behaves like a      */
/*  real, working front desk without needing a backend yet. Swap the     */
/*  localStorage read/write below for real API calls whenever the        */
/*  visitors backend endpoint exists — everything else stays the same.   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Backend wiring — visitors/ Django app (VisitorViewSet). Same         */
/*  fetch-with-token pattern TasksPage.jsx's tasksApiFetch already uses,  */
/*  so auth stays consistent across pages. Every visitor object coming    */
/*  back already matches this page's existing field names exactly        */
/*  (name, phone, cnic, company, meetingWith, purpose, purposeNote,       */
/*  apptStatus, status, reviewed, visits, date, requestedAt) — see        */
/*  visitors/serializers.py — so nothing below this needed to change      */
/*  shape, only where the data comes from.                                */
/* ------------------------------------------------------------------ */
const rawVisitorsBase = import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";
const API_BASE = rawVisitorsBase.endsWith("/api") ? rawVisitorsBase : `${rawVisitorsBase.replace(/\/$/, "")}/api`;
const VISITORS_API_BASE = `${API_BASE}/visitors`;

async function visitorsApiFetch(path, options = {}) {
  const token = localStorage.getItem("hopenix_auth_token");
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers["Authorization"] = `Token ${token}`;

  const res = await fetch(`${VISITORS_API_BASE}${path}`, { ...options, headers });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // some responses (e.g. 204 No Content) have no body
  }
  if (!res.ok) {
    const message =
      (data && (data.error || data.detail || Object.values(data)[0])) || `Request failed (${res.status}).`;
    throw new Error(Array.isArray(message) ? message[0] : message);
  }
  return data;
}

const PURPOSE_OPTIONS = ["Business Meeting", "Interview", "Delivery / Vendor", "Personal Visit", "Other"];
const APPOINTMENT_STATUS_OPTIONS = ["Scheduled", "Walk-in", "Confirmed"];

const EMPTY_FORM = {
  name: "",
  phone: "",
  cnic: "",
  meetingWith: "",
  company: "",
  purpose: "",
  apptStatus: "Scheduled",
};

/* ------------------------------------------------------------------ */
/*  Admin alert: a new visitor approval request should reach the admin  */
/*  even if they aren't sitting on this tab — and now it actually does. */
/*                                                                      */
/*  The REAL cross-device notification (phone or laptop, tab/app fully  */
/*  closed included) is sent by the BACKEND the moment a visitor is     */
/*  registered — see visitors/views.py's _notify_admins_of_visitor,     */
/*  which reuses the exact same Web Push pipe (VAPID + PushSubscription  */
/*  + messaging/push_utils.py) that incoming calls already ring through, */
/*  landing as a real OS notification via the app's service worker.      */
/*                                                                      */
/*  What's left here is just a same-tab, same-second fallback: while an  */
/*  admin is actively on this page, polling (see the effect below) can    */
/*  notice a brand-new pending request slightly before/independently of   */
/*  the push round-trip, and firing a local Notification() for it costs   */
/*  nothing and never duplicates in a confusing way (same visitor id =    */
/*  same `tag`, so a second call just replaces the banner, not stacks it).*/
/* ------------------------------------------------------------------ */
function ensureNotificationPermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {
      /* user dismissed the prompt — silently keep working without alerts */
    });
  }
}

function notifyAdminOfVisitorRequest(visitor) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const n = new Notification("New Visitor Approval Request", {
      body: `${visitor.name}${visitor.company ? ` — ${visitor.company}` : ""} is waiting for approval to meet ${visitor.meetingWith || "you"}.`,
      tag: `visitor-request-${visitor.id}`,
      renotify: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers (notably iOS Safari outside a PWA install) don't
       support the constructor form at all — fail quietly rather than
       breaking the approval flow over a missing alert */
  }
}

function initials(name = "") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

const AVATAR_GRADIENTS = [
  "from-violet-500 to-indigo-500",
  "from-sky-500 to-cyan-500",
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
];

function Avatar({ name, size = 44 }) {
  const idx = (name?.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length;
  return (
    <div
      className={`shrink-0 rounded-full bg-gradient-to-br ${AVATAR_GRADIENTS[idx]} text-white flex items-center justify-center font-bold`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name) || "?"}
    </div>
  );
}

function Field({ label, icon: Icon, darkMode, children, error }) {
  const inputWrap = darkMode
    ? "bg-slate-800 border-slate-700 focus-within:border-violet-500"
    : "bg-slate-50 border-slate-200 focus-within:border-violet-400";
  // Same shape as inputWrap, just swapped to a rose border so an invalid
  // field is obvious even before the message below it is read.
  const errorWrap = darkMode
    ? "bg-slate-800 border-rose-500/70 focus-within:border-rose-500"
    : "bg-rose-50/40 border-rose-400 focus-within:border-rose-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const labelText = darkMode ? "text-slate-300" : "text-slate-600";
  return (
    <div>
      <label className={`block text-xs font-semibold mb-1.5 ${labelText}`}>{label}</label>
      <div className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${error ? errorWrap : inputWrap}`}>
        {Icon && <Icon size={15} className={`${subtleText} shrink-0`} />}
        {children}
      </div>
      {error && <p className="mt-1 text-[11px] font-medium text-rose-500">{error}</p>}
    </div>
  );
}

/* Turns an AuthContext role into what should show after "—" in the host
   picker. Specific job titles an admin assigned via UserPage (e.g. "UI/UX
   Designer") are already display-ready and pass through unchanged; only
   the generic role-category buckets need prettifying. */
function formatRoleLabel(role = "") {
  const buckets = { admin: "Admin", manager: "Manager", employee: "Employee", client: "Client", accountant: "Accountant" };
  return buckets[role] || role;
}
function StatusBadge({ status, darkMode }) {
  const map = {
    Approved: darkMode ? "bg-emerald-500/15 text-emerald-400" : "bg-emerald-100 text-emerald-700",
    Waiting: darkMode ? "bg-amber-500/15 text-amber-400" : "bg-amber-100 text-amber-700",
    Rejected: darkMode ? "bg-rose-500/15 text-rose-400" : "bg-rose-100 text-rose-700",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap ${map[status] || ""}`}>
      {status}
    </span>
  );
}

export default function VisitorsPage({ darkMode = false }) {
  const { user, approvedUsers } = useAuth();
  // Same convention Dashboard.jsx already uses for admin-only checks.
  // Everyone who isn't "admin" (manager, employee, etc.) gets the
  // reception-only view: register + read-only records, no approval.
  const isAdmin = user?.role === "admin";

  // Real "Person to Meet" list — the company's own approved team members
  // (AuthContext's approvedUsers), not made-up placeholder names. Each
  // option is keyed by user id so two people with the same name never
  // collide, and displayed as "Name — Role/Designation".
  const hostOptions = useMemo(
    () =>
      (approvedUsers || [])
        .filter((u) => u?.name)
        .map((u) => ({
          id: String(u.id ?? u.name),
          label: u.role ? `${u.name} — ${formatRoleLabel(u.role)}` : u.name,
        })),
    [approvedUsers]
  );

  const [visitors, setVisitors] = useState([]);
  const [visitorsLoading, setVisitorsLoading] = useState(true);
  const [visitorsError, setVisitorsError] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [tableSearch, setTableSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  // Which Host Approval action is in flight, if any — disables the
  // Approve/Wait/Reject buttons for that one request while its API call
  // is out, so an admin double-clicking can't fire it twice.
  const [decidingId, setDecidingId] = useState(null);
  // Which row's "..." actions menu is open (holds a delete option), and
  // which row is mid-delete (disables the menu item + shows a spinas-text
  // state so a slow connection can't get double-clicked into a second
  // DELETE call for the same record).
  const [openMenuId, setOpenMenuId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const menuRef = useRef(null);

  const fetchVisitors = async () => {
    try {
      const data = await visitorsApiFetch("/visitors/");
      setVisitors(Array.isArray(data) ? data : data?.results || []);
      setVisitorsError("");
    } catch (err) {
      setVisitorsError(err.message || "Could not load visitor records.");
    } finally {
      setVisitorsLoading(false);
    }
  };

  useEffect(() => {
    fetchVisitors();
    // Keeps the Host Approval queue and Records table live for whoever
    // has this page open, without needing a websocket wired into this
    // component specifically — the same "REST polling is the fallback"
    // approach messaging/views.py documents for its own real-time paths.
    // Reaching someone who ISN'T on this page (or whose app is fully
    // closed) is the backend's Web Push, not this poll — see the comment
    // above notifyAdminOfVisitorRequest.
    const interval = setInterval(fetchVisitors, 12000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ask for notification permission once, right when the admin opens this
  // page, instead of waiting for the first visitor and asking mid-flow
  // (by then the browser's permission prompt would just be one more thing
  // stealing focus at the exact moment they need to see the request).
  useEffect(() => {
    if (isAdmin) ensureNotificationPermission();
  }, [isAdmin]);

  // Only the admin gets alerted (they're the one who approves), and only
  // for a request that's genuinely NEW since this tab opened — otherwise
  // every already-Waiting record already on file would re-fire a
  // notification the moment the page loads. `null` means "haven't seen a
  // real fetch yet"; the first successful load just records what's
  // already pending without alerting on any of it.
  const notifiedVisitorIdsRef = useRef(null);
  useEffect(() => {
    if (!isAdmin) return;
    const pending = visitors.filter((v) => v.status === "Waiting" && !v.reviewed);
    if (notifiedVisitorIdsRef.current === null) {
      notifiedVisitorIdsRef.current = new Set(pending.map((v) => v.id));
      return;
    }
    pending.forEach((v) => {
      if (notifiedVisitorIdsRef.current.has(v.id)) return;
      notifiedVisitorIdsRef.current.add(v.id);
      notifyAdminOfVisitorRequest(v);
    });
  }, [visitors, isAdmin]);

  // Close the row "..." menu on an outside click, same convention a
  // native <select>/dropdown already gives you for free.
  useEffect(() => {
    if (!openMenuId) return;
    const onClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [openMenuId]);

  /* Returning-visitor detection: as soon as the typed phone number
     matches someone already in the records, show the banner + let the
     receptionist pull that person's saved details in one click. */
  const matchedVisitor = useMemo(() => {
    const phone = form.phone.replace(/\s/g, "");
    if (phone.length < 6) return null;
    return visitors.find((v) => v.phone.replace(/\s/g, "") === phone);
  }, [form.phone, visitors]);

  const useExistingProfile = () => {
    if (!matchedVisitor) return;
    setForm((f) => ({
      ...f,
      name: matchedVisitor.name,
      cnic: matchedVisitor.cnic || f.cnic,
      company: matchedVisitor.company,
      meetingWith: matchedVisitor.meetingWith,
    }));
  };

  const updateField = (key) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [key]: value }));
    // Clear that one field's error the moment the person edits it, rather
    // than making them re-submit just to see the red border go away.
    setErrors((er) => (er[key] ? { ...er, [key]: undefined } : er));
  };

  // Name only ever accepts letters, spaces, dots and apostrophes — same
  // filter-as-you-type approach as phone/CNIC below.
  const updateNameField = (e) => {
    const value = e.target.value.replace(/[^A-Za-z\s.'-]/g, "");
    setForm((f) => ({ ...f, name: value }));
    setErrors((er) => (er.name ? { ...er, name: undefined } : er));
  };

  // Phone field only ever accepts digits, "+", "-" and spaces — filtered
  // as they type rather than just flagged after the fact on submit, so
  // typing a letter simply doesn't appear instead of showing up and then
  // getting rejected later.
  const updatePhoneField = (e) => {
    const value = e.target.value.replace(/[^0-9+\-\s]/g, "");
    setForm((f) => ({ ...f, phone: value }));
    setErrors((er) => (er.phone ? { ...er, phone: undefined } : er));
  };

  // CNIC only ever accepts digits and "-" (people type it as
  // XXXXX-XXXXXXX-X), same letter-blocking treatment as phone above.
  const updateCnicField = (e) => {
    const value = e.target.value.replace(/[^0-9\-]/g, "");
    setForm((f) => ({ ...f, cnic: value }));
    setErrors((er) => (er.cnic ? { ...er, cnic: undefined } : er));
  };

  // Full validation pass over the register form. Returns a { field:
  // message } map — empty object means the form is clean. CNIC and
  // Company are the only genuinely optional fields (matches what the
  // backend's serializer requires vs. allow_blank); everything else here
  // mirrors visitors/serializers.py's own required/choice constraints so
  // a bad submission never reaches the API only to bounce back.
  const validateForm = () => {
    const errs = {};

    const name = form.name.trim();
    if (!name) errs.name = "Full name is required.";
    else if (name.length < 3) errs.name = "Name must be at least 3 characters.";
    else if (!/^[A-Za-z\s.'-]+$/.test(name)) errs.name = "Name can only contain letters.";

    const phone = form.phone.trim();
    const phoneDigits = phone.replace(/\D/g, "");
    if (!phone) errs.phone = "Phone number is required.";
    else if (!/^[0-9+\-\s]+$/.test(phone)) errs.phone = "Enter a valid phone number.";
    else if (phoneDigits.length < 10 || phoneDigits.length > 13) errs.phone = "Enter a valid phone number.";

    const cnic = form.cnic.trim();
    if (cnic) {
      const cnicDigits = cnic.replace(/\D/g, "");
      if (cnicDigits.length !== 13) errs.cnic = "CNIC must be 13 digits (XXXXX-XXXXXXX-X).";
    }

    if (!form.meetingWith) errs.meetingWith = "Select who the visitor is meeting.";
    if (!form.purpose) errs.purpose = "Select a purpose of visit.";

    return errs;
  };

  const submitVisitor = async (e) => {
    e.preventDefault();
    const validationErrors = validateForm();
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      // The backend computes `visits` (from real prior records), `date`,
      // `requestedAt`, `id` (its "HV-..." code) and the initial
      // Waiting/unreviewed state itself — see visitors/models.py and
      // serializers.py — so the form only ever sends what the person
      // actually typed. Registering also fires the admin push
      // notification server-side (visitors/views.py).
      const created = await visitorsApiFetch("/visitors/", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone.trim(),
          cnic: form.cnic.trim(),
          company: form.company.trim(),
          meetingWith: form.meetingWith,
          purpose: form.purpose,
          apptStatus: form.apptStatus,
        }),
      });
      setVisitors((list) => [created, ...list]);
      setForm(EMPTY_FORM);
      setErrors({});
    } catch (err) {
      setSubmitError(err.message || "Could not save this visitor. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Only Waiting + not-yet-reviewed entries surface as a "Live Request".
  const pendingQueue = visitors.filter((v) => v.status === "Waiting" && !v.reviewed);
  const liveRequest = pendingQueue[0] || null;

  // Approval actions — admin-only. Guarded here as well as by the UI
  // (the buttons that call these simply don't render for non-admins) AND
  // on the backend (visitors/permissions.py's can_approve_visitors), so
  // approval can never happen from anywhere but the admin view. Each
  // updates optimistically (instant feedback) and rolls back if the API
  // call fails, rather than waiting on the round-trip to show anything.
  const decide = async (id, status) => {
    if (!isAdmin || decidingId) return;
    const previous = visitors;
    setDecidingId(id);
    setVisitors((list) => list.map((v) => (v.id === id ? { ...v, status, reviewed: true } : v)));
    try {
      const updated = await visitorsApiFetch(`/visitors/${id}/decide/`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setVisitors((list) => list.map((v) => (v.id === id ? updated : v)));
    } catch (err) {
      setVisitors(previous);
      setVisitorsError(err.message || "Could not update this request. Please try again.");
    } finally {
      setDecidingId(null);
    }
  };

  const askToWait = async (id) => {
    if (!isAdmin || decidingId) return;
    const previous = visitors;
    setDecidingId(id);
    setVisitors((list) => list.map((v) => (v.id === id ? { ...v, reviewed: true } : v)));
    try {
      const updated = await visitorsApiFetch(`/visitors/${id}/wait/`, { method: "POST" });
      setVisitors((list) => list.map((v) => (v.id === id ? updated : v)));
    } catch (err) {
      setVisitors(previous);
      setVisitorsError(err.message || "Could not update this request. Please try again.");
    } finally {
      setDecidingId(null);
    }
  };

  const reopenForReview = async (id) => {
    if (!isAdmin) return;
    const previous = visitors;
    setVisitors((list) => list.map((v) => (v.id === id ? { ...v, reviewed: false } : v)));
    try {
      const updated = await visitorsApiFetch(`/visitors/${id}/reopen/`, { method: "POST" });
      setVisitors((list) => list.map((v) => (v.id === id ? updated : v)));
    } catch (err) {
      setVisitors(previous);
      setVisitorsError(err.message || "Could not reopen this record. Please try again.");
    }
  };

  // Delete a visitor record — admin can delete any record, and the
  // backend (visitors/permissions.py's can_delete_visitor) also lets
  // whoever registered a visitor delete their own entry, so this isn't
  // gated to isAdmin here the way decide/askToWait/reopen are; the
  // "..." menu that calls this just happens to only render in the admin
  // records table today. A native confirm() guards the irreversible
  // action, then it's the same optimistic-update-with-rollback pattern
  // as decide/askToWait/reopen above.
  const deleteVisitor = async (id) => {
    if (deletingId) return;
    setOpenMenuId(null);
    if (!window.confirm("Delete this visitor record? This can't be undone.")) return;
    const previous = visitors;
    setDeletingId(id);
    setVisitors((list) => list.filter((v) => v.id !== id));
    try {
      await visitorsApiFetch(`/visitors/${id}/`, { method: "DELETE" });
    } catch (err) {
      setVisitors(previous);
      setVisitorsError(err.message || "Could not delete this visitor record. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredVisitors = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return visitors;
    return visitors.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.company?.toLowerCase().includes(q) ||
        v.phone.toLowerCase().includes(q) ||
        v.meetingWith?.toLowerCase().includes(q)
    );
  }, [visitors, tableSearch]);

  /* ---- shared style tokens — mirror Dashboard.jsx exactly ---- */
  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100";
  const headingText = darkMode ? "text-white" : "text-slate-900";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const borderColor = darkMode ? "border-slate-800" : "border-slate-100";
  const inputWrap = darkMode
    ? "bg-slate-800 border-slate-700 focus-within:border-violet-500"
    : "bg-slate-50 border-slate-200 focus-within:border-violet-400";
  const inputText = darkMode ? "text-slate-100 placeholder:text-slate-500" : "text-slate-800 placeholder:text-slate-400";
  const rowHover = darkMode ? "hover:bg-slate-800/60" : "hover:bg-slate-50";

  // Native <select> dropdown popups (the list of options) are drawn by
  // the browser/OS, not by our CSS. color-scheme tells the browser to
  // draw its own controls in dark colors, but on some browsers (Chrome
  // in particular) that alone isn't enough — the popup still renders
  // white-on-white unless the <select>/<option> elements also carry
  // real background/text colors themselves (not "transparent", which
  // the popup can't resolve to anything readable). These two objects
  // are spread onto every <select> and every <option> below.
  const selectStyle = {
    colorScheme: darkMode ? "dark" : "light",
    backgroundColor: darkMode ? "#1e293b" : "#ffffff",
    color: darkMode ? "#f1f5f9" : "#1e293b",
  };
  const optionStyle = {
    backgroundColor: darkMode ? "#1e293b" : "#ffffff",
    color: darkMode ? "#f1f5f9" : "#1e293b",
  };

  /* ---------------------------------------------------------------- */
  /*  Register Visitor form — shown in both admin and manager views.    */
  /* ---------------------------------------------------------------- */
  const RegisterForm = (
    <div className={`rounded-2xl p-5 sm:p-6 shadow-sm ${card}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
            <UserPlus2 size={18} />
          </div>
          <div className="min-w-0">
            <h2 className={`text-base font-bold truncate ${headingText}`}>Visitor Management</h2>
            <p className={`text-xs ${mutedText}`}>Register a visitor</p>
          </div>
        </div>
        <button
          type="button"
          className={`w-full sm:w-auto flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
            darkMode ? "border-slate-700 text-slate-300 hover:bg-slate-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
          }`}
        >
          <Search size={14} /> Search Visitor
        </button>
      </div>

      {matchedVisitor && (
        <div
          className={`mt-4 flex flex-wrap items-center gap-3 justify-between rounded-xl px-4 py-3 ${
            darkMode ? "bg-violet-500/10 border border-violet-500/20" : "bg-violet-50 border border-violet-100"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={matchedVisitor.name} size={40} />
            <div className="min-w-0">
              <p className={`text-sm font-semibold ${darkMode ? "text-violet-300" : "text-violet-700"}`}>
                Returning Visitor{" "}
                <span className={mutedText}>
                  • {matchedVisitor.visits} Previous Visit{matchedVisitor.visits > 1 ? "s" : ""}
                </span>
              </p>
              <p className={`text-xs ${subtleText}`}>Last visit: {matchedVisitor.date.split(",")[0]}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs ${mutedText}`}>Same person?</span>
            <button
              type="button"
              onClick={useExistingProfile}
              className="text-xs font-semibold px-3 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:opacity-90 transition-opacity"
            >
              Use Existing Profile
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submitVisitor} className="mt-5 grid sm:grid-cols-2 gap-4">
        <Field label="Full Name" icon={UserCircle2} darkMode={darkMode} error={errors.name}>
          <input
            value={form.name}
            onChange={updateNameField}
            placeholder="Enter full name"
            className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${inputText}`}
          />
        </Field>

        <Field label="Phone Number" icon={Phone} darkMode={darkMode} error={errors.phone}>
          <input
            value={form.phone}
            onChange={updatePhoneField}
            inputMode="tel"
            placeholder="+92 3XX XXXXXXX"
            className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${inputText}`}
          />
        </Field>

        <Field label="CNIC / ID Number" icon={CreditCard} darkMode={darkMode} error={errors.cnic}>
          <input
            value={form.cnic}
            onChange={updateCnicField}
            inputMode="numeric"
            maxLength={15}
            placeholder="XXXXX-XXXXXXX-X"
            className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${inputText}`}
          />
        </Field>

        <Field label="Person to Meet" icon={UserCircle2} darkMode={darkMode} error={errors.meetingWith}>
          <select
            value={form.meetingWith}
            onChange={updateField("meetingWith")}
            style={selectStyle}
            className={`flex-1 min-w-0 bg-transparent outline-none text-sm appearance-none ${inputText}`}
          >
            <option value="" style={optionStyle}>
              {hostOptions.length ? "Select host" : "No team members found"}
            </option>
            {hostOptions.map((h) => (
              <option key={h.id} value={h.label} style={optionStyle}>
                {h.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={`${subtleText} shrink-0`} />
        </Field>

        <Field label="Company / Organization" icon={Building2} darkMode={darkMode}>
          <input
            value={form.company}
            onChange={updateField("company")}
            placeholder="Company name"
            className={`flex-1 min-w-0 bg-transparent outline-none text-sm ${inputText}`}
          />
        </Field>

        <Field label="Purpose of Visit" icon={FileText} darkMode={darkMode} error={errors.purpose}>
          <select
            value={form.purpose}
            onChange={updateField("purpose")}
            style={selectStyle}
            className={`flex-1 min-w-0 bg-transparent outline-none text-sm appearance-none ${inputText}`}
          >
            <option value="" style={optionStyle}>Select purpose</option>
            {PURPOSE_OPTIONS.map((p) => (
              <option key={p} value={p} style={optionStyle}>
                {p}
              </option>
            ))}
          </select>
          <ChevronDown size={14} className={`${subtleText} shrink-0`} />
        </Field>

        <div className="sm:col-span-2 grid sm:grid-cols-2 gap-4 items-end">
          <Field label="Appointment Status" icon={CalendarClock} darkMode={darkMode}>
            <select
              value={form.apptStatus}
              onChange={updateField("apptStatus")}
              style={selectStyle}
              className={`flex-1 min-w-0 bg-transparent outline-none text-sm appearance-none ${inputText}`}
            >
              {APPOINTMENT_STATUS_OPTIONS.map((s) => (
                <option key={s} value={s} style={optionStyle}>
                  {s}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className={`${subtleText} shrink-0`} />
          </Field>

          <button
            type="submit"
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Send size={15} /> {submitting ? "Sending..." : "Save & Send Approval Request"}
          </button>
        </div>
        {submitError && (
          <p className={`sm:col-span-2 text-xs ${darkMode ? "text-rose-400" : "text-rose-600"}`}>{submitError}</p>
        )}
      </form>
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  Host Approval — admin view ONLY.                                  */
  /* ---------------------------------------------------------------- */
  const HostApproval = (
    <div className={`rounded-2xl p-5 sm:p-6 shadow-sm flex flex-col ${card}`}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
            <Bell size={17} />
          </div>
          <h2 className={`text-base font-bold ${headingText}`}>Host Approval</h2>
        </div>
        {liveRequest && (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live Request
          </span>
        )}
      </div>

      {typeof window !== "undefined" && "Notification" in window && Notification.permission === "denied" && (
        <p className={`text-[11px] mb-3 -mt-1 ${darkMode ? "text-amber-400" : "text-amber-600"}`}>
          Desktop notifications are blocked for this site — new visitor requests will only show here, not as an alert. Enable
          notifications for this site in your browser settings to get alerted even when this tab isn't focused.
        </p>
      )}

      {!liveRequest ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-10 gap-2">
          <CheckCircle2 size={30} className={subtleText} />
          <p className={`text-sm font-semibold ${headingText}`}>All caught up</p>
          <p className={`text-xs max-w-[220px] ${mutedText}`}>No pending approval requests right now.</p>
        </div>
      ) : (
        <>
          <div className={`rounded-xl p-4 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={liveRequest.name} size={52} />
                <div className="min-w-0">
                  <p className={`text-sm font-bold truncate ${headingText}`}>{liveRequest.name}</p>
                  <p className={`text-xs truncate ${mutedText}`}>{liveRequest.company}</p>
                  {liveRequest.visits > 1 && (
                    <span
                      className={`inline-block mt-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        darkMode ? "bg-violet-500/15 text-violet-300" : "bg-violet-100 text-violet-700"
                      }`}
                    >
                      Returning Visitor • {liveRequest.visits} Previous Visits
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[11px] ${subtleText}`}>Request ID</p>
                <p className={`text-xs font-semibold ${headingText}`}>#{liveRequest.id}</p>
                <p className={`text-[11px] mt-1 font-medium ${darkMode ? "text-violet-400" : "text-violet-600"}`}>
                  {liveRequest.requestedAt || "Just now"}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <UserCircle2 size={16} className={`mt-0.5 shrink-0 ${subtleText}`} />
                <div>
                  <p className={`text-[11px] ${mutedText}`}>Meeting With</p>
                  <p className={`text-sm font-semibold ${headingText}`}>{liveRequest.meetingWith || "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <FileText size={16} className={`mt-0.5 shrink-0 ${subtleText}`} />
                <div>
                  <p className={`text-[11px] ${mutedText}`}>Purpose</p>
                  <p className={`text-sm font-semibold ${headingText}`}>{liveRequest.purpose || "—"}</p>
                  {liveRequest.purposeNote && (
                    <p className={`text-xs mt-0.5 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>{liveRequest.purposeNote}</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
            <button
              onClick={() => decide(liveRequest.id, "Approved")}
              disabled={decidingId === liveRequest.id}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <CheckCircle2 size={15} /> Approve
            </button>
            <button
              onClick={() => askToWait(liveRequest.id)}
              disabled={decidingId === liveRequest.id}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Clock3 size={15} /> Wait
            </button>
            <button
              onClick={() => decide(liveRequest.id, "Rejected")}
              disabled={decidingId === liveRequest.id}
              className="flex items-center justify-center gap-1.5 rounded-lg py-2.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <XCircle size={15} /> Reject
            </button>
          </div>

          {pendingQueue.length > 1 && (
            <p className={`text-[11px] mt-3 text-center ${subtleText}`}>+{pendingQueue.length - 1} more waiting in queue</p>
          )}
        </>
      )}
    </div>
  );

  /* ---------------------------------------------------------------- */
  /*  Recent Visitor Records — shown in both views. Admin gets a        */
  /*  "Review" action to re-open a Waiting entry into Host Approval;     */
  /*  manager sees the same data fully read-only.                        */
  /* ---------------------------------------------------------------- */
  const RecordsTable = (
    <div className={`rounded-2xl shadow-sm overflow-hidden ${card}`}>
      <div className={`flex items-center justify-between gap-3 flex-wrap px-5 sm:px-6 py-4 border-b ${borderColor}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <History size={17} className={`${mutedText} shrink-0`} />
          <h2 className={`text-sm font-bold uppercase tracking-wide truncate ${headingText}`}>Recent Visitor Records</h2>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 ${inputWrap}`}>
            <Search size={13} className={`${subtleText} shrink-0`} />
            <input
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Search records..."
              className={`bg-transparent outline-none text-xs w-24 sm:w-32 ${inputText}`}
            />
          </div>
          <button className="hidden sm:flex items-center gap-1 text-xs font-semibold text-violet-500 hover:text-violet-600 shrink-0">
            View All Records <ArrowRight size={13} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[820px]">
          <thead>
            <tr className={`text-[11px] uppercase tracking-wide ${subtleText}`}>
              <th className="px-5 sm:px-6 py-3 font-semibold">Visitor</th>
              <th className="px-3 py-3 font-semibold">Phone</th>
              <th className="px-3 py-3 font-semibold">Meeting With</th>
              <th className="px-3 py-3 font-semibold">Date &amp; Time</th>
              <th className="px-3 py-3 font-semibold">Visits</th>
              <th className="px-3 py-3 font-semibold">Status</th>
              {isAdmin && <th className="px-3 py-3 font-semibold text-right pr-5 sm:pr-6">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {visitorsLoading && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className={`px-6 py-8 text-center text-sm ${mutedText}`}>
                  Loading visitor records...
                </td>
              </tr>
            )}
            {!visitorsLoading && filteredVisitors.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 7 : 6} className={`px-6 py-8 text-center text-sm ${mutedText}`}>
                  {visitorsError || "No visitor records found."}
                </td>
              </tr>
            )}
            {!visitorsLoading && filteredVisitors.map((v) => (
              <tr key={v.id} className={`border-t text-sm ${borderColor} ${rowHover} transition-colors`}>
                <td className="px-5 sm:px-6 py-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={v.name} size={32} />
                    <div>
                      <p className={`font-semibold ${headingText}`}>{v.name}</p>
                      <p className="text-xs text-violet-500">{v.company || "—"}</p>
                    </div>
                  </div>
                </td>
                <td className={`px-3 py-3 whitespace-nowrap ${mutedText}`}>{v.phone}</td>
                <td className={`px-3 py-3 whitespace-nowrap ${mutedText}`}>{v.meetingWith || "—"}</td>
                <td className={`px-3 py-3 whitespace-nowrap ${mutedText}`}>{v.date}</td>
                <td className={`px-3 py-3 ${mutedText}`}>{v.visits}</td>
                <td className="px-3 py-3">
                  <StatusBadge status={v.status} darkMode={darkMode} />
                </td>
                {isAdmin && (
                  <td className="px-3 py-3 text-right pr-5 sm:pr-6">
                    {v.status === "Waiting" && v.reviewed ? (
                      <button
                        onClick={() => reopenForReview(v.id)}
                        className="text-xs font-semibold text-violet-500 hover:text-violet-600"
                      >
                        Review
                      </button>
                    ) : (
                      <div className="relative inline-block text-left" ref={openMenuId === v.id ? menuRef : null}>
                        <button
                          onClick={() => setOpenMenuId((cur) => (cur === v.id ? null : v.id))}
                          disabled={deletingId === v.id}
                          className={`p-1.5 rounded-md disabled:opacity-50 ${darkMode ? "hover:bg-slate-800" : "hover:bg-slate-100"} ${subtleText}`}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {openMenuId === v.id && (
                          <div
                            className={`absolute right-0 z-10 mt-1 w-36 rounded-lg shadow-lg border py-1 ${
                              darkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-200"
                            }`}
                          >
                            <button
                              onClick={() => deleteVisitor(v.id)}
                              disabled={deletingId === v.id}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                            >
                              <Trash2 size={13} />
                              {deletingId === v.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {visitorsError && !visitorsLoading && visitors.length > 0 && (
        <div
          className={`rounded-xl px-4 py-2.5 text-xs font-medium ${
            darkMode ? "bg-rose-500/10 text-rose-300 border border-rose-500/20" : "bg-rose-50 text-rose-700 border border-rose-100"
          }`}
        >
          {visitorsError}
        </div>
      )}
      <div className={`grid gap-5 ${isAdmin ? "lg:grid-cols-[1.6fr_1fr]" : "grid-cols-1"}`}>
        {RegisterForm}
        {isAdmin && HostApproval}
      </div>
      {RecordsTable}
    </div>
  );
}