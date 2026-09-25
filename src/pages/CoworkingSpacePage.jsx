import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Armchair,
  Users,
  Calendar,
  ShieldCheck,
  Wifi,
  PenSquare,
  Coffee,
  Clock3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  FileText,
  User,
  Briefcase,
  ClipboardList,
  Wallet,
  Plus,
  Trash2,
  Camera,
  BadgeCheck,
  XCircle,
  Eye,
  X,
  Search,
  Sparkles,
  Zap,
  Lock,
  UsersRound,
  ChevronDown,
  IdCard,
  AlertCircle,
} from "lucide-react";

import image1 from "../assets/image1.jpg";
import image2 from "../assets/image2.jpg";
import image3 from "../assets/image3.jpg";
import phoenixLogo from "../assets/phoenix-logo.png";
import { API_BASE_URL } from "../apiConfig.js";

/* ------------------------------------------------------------------ */
/*  Coworking backend wiring — Django app `coworking`                   */
/*  (/api/coworking/applications/). Applications, admin approvals and   */
/*  monthly rent ticks are all stored server-side now. Ticking a month  */
/*  as received also writes the matching dashboard.Income row on the    */
/*  server, so IncomePage shows it without any refresh on this side.    */
/* ------------------------------------------------------------------ */
const COWORKING_ENDPOINT = `${API_BASE_URL}/coworking/applications/`;
const COWORKING_SETTINGS_ENDPOINT = `${API_BASE_URL}/coworking/settings/`;

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
  const headers = authHeaders(options.headers);
  // FormData (the application submit) must NOT carry a JSON Content-Type —
  // the browser adds multipart/form-data with the right boundary itself.
  if (typeof FormData !== "undefined" && options.body instanceof FormData) delete headers["Content-Type"];
  const res = await fetch(url, { ...options, headers });
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

// The form keeps the three uploaded images as base64 data URLs (for the
// on-screen previews). The API takes them as real file parts instead —
// three phone photos as base64-in-JSON would exceed Django's 10MB body limit.
function dataUrlToBlob(dataUrl) {
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// The server only accepts image files that carry a real extension, so the
// part's filename is built from the image's own MIME type.
function appendImage(body, field, dataUrl, baseName) {
  const blob = dataUrlToBlob(dataUrl);
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" }[blob.type] || "jpg";
  body.append(field, blob, `${baseName}.${ext}`);
}

// Fields travel as one JSON string in `data`; the three images as real file
// parts. The server recomputes every money total itself, so none are sent.
function buildApplicationFormData(form) {
  const { photo, cnicFront, cnicBack, ...fields } = form;
  const body = new FormData();
  body.append("data", JSON.stringify(fields));
  if (photo) appendImage(body, "photo", photo, "photo");
  appendImage(body, "cnicFront", cnicFront, "cnic-front");
  appendImage(body, "cnicBack", cnicBack, "cnic-back");
  return body;
}

/* ------------------------------------------------------------------ */
/*  Hopenix — Coworking Space / Chair Rental                            */
/*                                                                      */
/*  This page is content-only: the sidebar and topbar it appears        */
/*  inside of are inherited from Dashboard.jsx exactly like every       */
/*  other page (Sales, Clients, Projects, etc). Wire-up notes are at    */
/*  the bottom of this file.                                            */
/*                                                                      */
/*  It reproduces the HOPENIX "Coworking Space Form" (CWS-01) end to    */
/*  end: every section A–J from the PDF is captured somewhere in the    */
/*  4-step application wizard, or in the office-use Review panel on     */
/*  each record. Submitted applications are kept as proper records      */
/*  (Django-backed) with each occupant's monthly payment shown    */
/*  and totalled.                                                       */
/* ------------------------------------------------------------------ */

// Shown until the real values load from the server, and used if that load
// ever fails — same shape /api/coworking/settings/ returns.
const DEFAULT_HERO_SETTINGS = {
  totalChairs: 12,
  monthlyRate: 25000,
  minDurationMonths: 1,
  maxDurationMonths: 12,
  durationNote: "Custom options available",
  securityFeatures: "Access control, CCTV",
  supportHours: "24/7 Support",
};

const PLANS = [
  { id: "monthly", name: "Monthly Plan", rate: 25000, months: 1, tag: "Most Popular", perks: ["1 Month Duration", "Flexible / Dedicated Seating", "Full Access to Facilities"] },
  { id: "quarterly", name: "3 Months Plan", rate: 23333, months: 3, tag: null, perks: ["3 Months Duration", "Flexible / Dedicated Seating", "Full Access to Facilities"] },
  { id: "biannual", name: "6 Months Plan", rate: 21667, months: 6, tag: null, perks: ["6 Months Duration", "Flexible / Dedicated Seating", "Full Access to Facilities"] },
];

const APPLICANT_TYPES = ["Individual", "Freelancer", "Startup", "Company", "Agency", "Other"];
const DOCUMENT_LIST = ["Address Proof", "Company Registration", "NTN", "Authority Letter"];
const APPROVER_ROLES = ["CEO", "MD", "Manager", "PM", "Admin"];

// Auto-sliding hero gallery. These are CSS-drawn placeholder slides (no
// external photo hotlinked — a guessed stock-photo URL risks pulling in
// the wrong or copyrighted image, which isn't safe to ship). Swap `photo:
// "/media/space-1.jpg"` (or a real https URL of your own hosted photo)
// into each slide below to replace a placeholder with a real one — the
// carousel code doesn't need to change, it already prefers `photo` over
// the gradient+icon when present.
const SPACE_IMAGES = [
  { icon: Armchair, caption: "Open Floor Seating", gradient: "from-[#3a2a7a] via-[#4c2f8f] to-[#1c1440]", photo: image1 },
  { icon: Users, caption: "Meeting Rooms", gradient: "from-[#2a1f57] via-[#3d2a8f] to-[#160f33]", photo: image2 },
  { icon: Wifi, caption: "High-Speed WiFi Everywhere", gradient: "from-[#241a4a] via-[#5b3aa8] to-[#1c1440]", photo: image3 },
  { icon: Coffee, caption: "Pantry & Lounge", gradient: "from-[#1c1440] via-[#4433a0] to-[#241a4a]", photo: phoenixLogo },
];

// Single feature panel for the "Our Workspace" card.
const WORKSPACE_VISUAL = { photo: image1 };

const CNIC_RE = /^\d{5}-?\d{7}-?\d{1}$/;
const PASSPORT_RE = /^[A-Za-z]{1,2}\d{6,8}$/;
const PHONE_RE = /^(\+92|0)?3\d{2}-?\d{7}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STEPS = [
  { id: 1, label: "Personal Details", icon: User },
  { id: 2, label: "Work Profile", icon: Briefcase },
  { id: 3, label: "Workspace Needs", icon: ClipboardList },
  { id: 4, label: "Summary", icon: Wallet },
];

const emptyMember = () => ({ id: crypto.randomUUID(), name: "", cnic: "", phone: "", chairNo: "" });

function emptyForm(formNo, defaultRate = 25000) {
  return {
    // A. Application Record
    formNo,
    applicationDate: new Date().toISOString().slice(0, 10),
    agreementId: "",
    startDate: "",
    // B. Applicant / Occupant Details
    fullName: "",
    fatherName: "",
    cnic: "",
    dob: "",
    mobile: "",
    whatsapp: "",
    email: "",
    address: "",
    photo: null,
    cnicFront: null,
    cnicBack: null,
    // C. Work / Business Profile
    applicantType: [],
    companyName: "",
    legalStatus: "",
    registrationNo: "",
    natureOfWork: "",
    website: "",
    teamSize: "",
    // D. Workspace Requirements
    chairs: 1,
    ratePerChair: defaultRate,
    duration: 1,
    expectedEndDate: "",
    seating: "Dedicated",
    access: "Office Hours",
    assignedChairs: "",
    specialNotes: "",
    // E. Member / Seat Allocation
    members: [emptyMember()],
    // G. Required Documents & Emergency Contact
    documents: [],
    emergencyName: "",
    emergencyRelation: "",
    emergencyPhone: "",
    emergencyAltPhone: "",
    // F. Monthly Rent & Payment Summary
    discountPercent: 0,
    securityDeposit: 0,
    otherCharges: 0,
    paymentMethod: "Bank Transfer",
    transactionNo: "",
    billingDueDay: "5th",
    billingCycle: "Monthly",
    // H / I. Terms & Declaration
    termsAgreed: false,
    declarationName: "",
    declarationDate: new Date().toISOString().slice(0, 10),
  };
}

function money(n) {
  const num = Number(n) || 0;
  return "PKR " + num.toLocaleString("en-PK", { maximumFractionDigits: 0 });
}

// Recurring monthly-rent helpers — a chair rental bills every month for
// `duration` months, so payment status is tracked per calendar month
// rather than as one lump sum against the grand total.
function monthKeysFrom(dateStr, count) {
  let base;
  if (dateStr) {
    base = dateStr.length <= 10 ? new Date(`${dateStr}T00:00:00`) : new Date(dateStr);
  }
  if (!base || Number.isNaN(base.getTime())) base = new Date();
  const keys = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function CoworkingSpacePage({ darkMode, onNavigate, role }) {
  const isAdmin = role === "admin"; // Admin: full access (form + approvals). Manager: everything except approvals.
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(() => emptyForm(""));
  const [errors, setErrors] = useState({});
  const [openReviewId, setOpenReviewId] = useState(null);
  const [viewRecordId, setViewRecordId] = useState(null);
  // Applicant photo / CNIC front / CNIC back for the View record modal.
  // These come back from the server as authenticated URLs (see
  // ApplicationRecordSerializer's docstring) — a bare <img src> can't send
  // the Authorization header, so they're fetched as blobs and swapped in
  // as object URLs once loaded. `zoomImage` is the optional full-size
  // lightbox shown when one of the three thumbnails is clicked.
  const [viewFiles, setViewFiles] = useState({ photo: null, cnicFront: null, cnicBack: null });
  const [viewFilesLoading, setViewFilesLoading] = useState(false);
  const [zoomImage, setZoomImage] = useState(null);
  const [toast, setToast] = useState(null);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const [slideIndex, setSlideIndex] = useState(0);
  const formTopRef = useRef(null);

  // The 4 hero stat cards (Total Chairs / Monthly Rate / Flexible Duration /
  // Secure & Professional) — server-backed via /api/coworking/settings/ so
  // an admin can change them from the page instead of editing source code.
  const [heroSettings, setHeroSettings] = useState(DEFAULT_HERO_SETTINGS);
  const [heroSettingsLoading, setHeroSettingsLoading] = useState(true);
  const [showHeroSettingsModal, setShowHeroSettingsModal] = useState(false);
  const [heroSettingsForm, setHeroSettingsForm] = useState(DEFAULT_HERO_SETTINGS);
  const [heroSettingsErrors, setHeroSettingsErrors] = useState({});
  const [savingHeroSettings, setSavingHeroSettings] = useState(false);

  // Load every application from the backend once when the page opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiRequest(COWORKING_ENDPOINT);
        if (!cancelled) setRecords(Array.isArray(list) ? list : []);
      } catch (err) {
        if (!cancelled) setToast({ type: "error", text: err.message || "Couldn't load applications — check connection." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the hero stat-card values from the same backend.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiRequest(COWORKING_SETTINGS_ENDPOINT);
        if (!cancelled && data) setHeroSettings({ ...DEFAULT_HERO_SETTINGS, ...data });
      } catch (err) {
        // Non-fatal — the page still works with the built-in defaults above.
        if (!cancelled) console.warn("Couldn't load coworking settings, using defaults:", err.message);
      } finally {
        if (!cancelled) setHeroSettingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openHeroSettingsModal() {
    setHeroSettingsForm(heroSettings);
    setHeroSettingsErrors({});
    setShowHeroSettingsModal(true);
  }

  async function saveHeroSettings() {
    const errs = {};
    const totalChairs = Number(heroSettingsForm.totalChairs);
    const monthlyRate = Number(heroSettingsForm.monthlyRate);
    const minMonths = Number(heroSettingsForm.minDurationMonths);
    const maxMonths = Number(heroSettingsForm.maxDurationMonths);
    if (!totalChairs || totalChairs < 1) errs.totalChairs = "Enter at least 1 chair";
    if (!monthlyRate || monthlyRate <= 0) errs.monthlyRate = "Enter a valid rate";
    if (!minMonths || minMonths < 1) errs.minDurationMonths = "Enter a valid minimum";
    if (!maxMonths || maxMonths < minMonths) errs.maxDurationMonths = "Must be at least the minimum";
    if (occupiedChairs > totalChairs) errs.totalChairs = `${occupiedChairs} chairs are already approved and in use`;
    setHeroSettingsErrors(errs);
    if (Object.keys(errs).length) return;

    setSavingHeroSettings(true);
    try {
      const saved = await apiRequest(COWORKING_SETTINGS_ENDPOINT, {
        method: "PUT",
        body: JSON.stringify({
          totalChairs,
          monthlyRate,
          minDurationMonths: minMonths,
          maxDurationMonths: maxMonths,
          durationNote: heroSettingsForm.durationNote || "",
          securityFeatures: heroSettingsForm.securityFeatures || "",
          supportHours: heroSettingsForm.supportHours || "",
        }),
      });
      setHeroSettings({ ...DEFAULT_HERO_SETTINGS, ...saved });
      setShowHeroSettingsModal(false);
      setToast({ type: "success", text: "Workspace details updated." });
    } catch (err) {
      setToast({ type: "error", text: err.message || "Couldn't save changes." });
    } finally {
      setSavingHeroSettings(false);
    }
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // One deliberate page-load reveal for the hero (see frontend-design
  // guidance: a single orchestrated entrance beats effects on every card).
  useEffect(() => {
    const t = setTimeout(() => setHeroLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  // Auto-advancing company photo slideshow — pauses on hover/touch so
  // someone reading a caption or looking closely isn't fighting the timer.
  const [slidesPaused, setSlidesPaused] = useState(false);
  useEffect(() => {
    if (slidesPaused) return;
    const t = setInterval(() => setSlideIndex((i) => (i + 1) % SPACE_IMAGES.length), 4500);
    return () => clearInterval(t);
  }, [slidesPaused]);

  /* ---------------------------------------------------------- theming */
  const page = darkMode ? "bg-slate-950 text-slate-200" : "bg-[#f4f5fa] text-slate-800";
  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100";
  const cardText = darkMode ? "text-slate-200" : "text-slate-800";
  const heading = darkMode ? "text-white" : "text-slate-900";
  const subtle = darkMode ? "text-slate-500" : "text-slate-400";
  const muted = darkMode ? "text-slate-400" : "text-slate-500";
  const inputBase = `w-full rounded-lg px-3 py-2.5 sm:py-2 text-[16px] sm:text-[12px] outline-none transition-colors border ${
    darkMode
      ? "bg-slate-800/70 border-slate-700 text-slate-200 placeholder:text-slate-500 focus:border-violet-500"
      : "bg-slate-50 border-slate-200 text-slate-800 placeholder:text-slate-400 focus:border-violet-400"
  }`;
  const errorInputBase = `w-full rounded-lg px-3 py-2.5 sm:py-2 text-[16px] sm:text-[12px] outline-none transition-colors border ${
    darkMode ? "bg-slate-800/70 border-rose-500 text-slate-200 placeholder:text-slate-500" : "bg-rose-50/50 border-rose-400 text-slate-800 placeholder:text-slate-400"
  }`;
  const labelBase = `block text-[10.5px] font-semibold uppercase tracking-wide mb-1.5 ${muted}`;

  /* ---------------------------------------------------------- derived */
  const approvedRecords = records.filter((r) => r.status === "Approved");
  const occupiedChairs = approvedRecords.reduce((sum, r) => sum + Number(r.application.chairs || 0), 0);
  const availableChairs = Math.max(Number(heroSettings.totalChairs) - occupiedChairs, 0);
  const monthlyRevenue = approvedRecords.reduce((sum, r) => sum + Number(r.application.chairs || 0) * Number(r.application.ratePerChair || 0), 0);

  const subtotal = Number(form.chairs || 0) * Number(form.ratePerChair || 0) * Number(form.duration || 0);
  const discountAmount = (subtotal * Number(form.discountPercent || 0)) / 100;
  const grandTotal = subtotal - discountAmount + Number(form.securityDeposit || 0) + Number(form.otherCharges || 0);
  const monthlyPayment = Number(form.chairs || 0) * Number(form.ratePerChair || 0);

  /* ---------------------------------------------------------- helpers */
  const set = (key) => (e) => {
    const value = e && e.target ? e.target.value : e;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => (er[key] ? { ...er, [key]: undefined } : er));
  };
  const toggleInArray = (key, value) =>
    setForm((f) => {
      const arr = f[key] || [];
      return { ...f, [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value] };
    });

  function updateMember(id, key, value) {
    setForm((f) => ({ ...f, members: f.members.map((m) => (m.id === id ? { ...m, [key]: value } : m)) }));
  }
  function addMember() {
    setForm((f) => ({ ...f, members: [...f.members, emptyMember()] }));
  }
  function removeMember(id) {
    setForm((f) => ({ ...f, members: f.members.length > 1 ? f.members.filter((m) => m.id !== id) : f.members }));
  }

  function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, photo: reader.result }));
    reader.readAsDataURL(file);
  }

  function handleCnicUpload(side) {
    return (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) {
        setToast({ type: "error", text: "Image is too large — please use a file under 5MB." });
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setForm((f) => ({ ...f, [side]: reader.result }));
        setErrors((er) => ({ ...er, [side]: undefined }));
      };
      reader.readAsDataURL(file);
    };
  }

  function applyPlan(plan) {
    setForm((f) => ({ ...f, chairs: f.chairs || 1, ratePerChair: plan.rate, duration: plan.months }));
    // BUG FIX: this used to jump to Step 1 (Personal Details) — but
    // chairs/rate/duration, the actual fields this changes, live in
    // Step 3 (Workspace Needs). Landing on Step 1 meant the applied
    // plan was invisible, so clicking "Apply Now" looked like it did
    // nothing. Now it jumps straight to where the change is visible,
    // plus a toast confirms it explicitly.
    setStep(3);
    setToast({ type: "success", text: `${plan.name} applied — ${money(plan.rate)}/chair for ${plan.months} month${plan.months > 1 ? "s" : ""}.` });
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function validateStep(current) {
    const errs = {};

    if (current === 1) {
      if (!form.fullName.trim()) errs.fullName = "Full name is required";
      if (!form.cnic.trim()) {
        errs.cnic = "CNIC / Passport No. is required";
      } else if (!CNIC_RE.test(form.cnic.trim()) && !PASSPORT_RE.test(form.cnic.trim())) {
        errs.cnic = "Use CNIC format 12345-1234567-1, or a valid passport number";
      }
      if (!form.mobile.trim()) {
        errs.mobile = "Mobile No. is required";
      } else if (!PHONE_RE.test(form.mobile.trim())) {
        errs.mobile = "Use format 03XX-XXXXXXX";
      }
      if (form.whatsapp.trim() && !PHONE_RE.test(form.whatsapp.trim())) errs.whatsapp = "Use format 03XX-XXXXXXX";
      if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) errs.email = "Enter a valid email address";
      if (!form.address.trim()) errs.address = "Residential address is required";
      if (!form.cnicFront) errs.cnicFront = "Upload the front of your CNIC";
      if (!form.cnicBack) errs.cnicBack = "Upload the back of your CNIC";
    }

    if (current === 2) {
      if (!form.applicantType.length) errs.applicantType = "Select at least one applicant type";
      if ((form.applicantType.includes("Company") || form.applicantType.includes("Agency")) && !form.companyName.trim()) {
        errs.companyName = "Company / Agency name is required for this applicant type";
      }
      if (form.website.trim() && !/^https?:\/\/.+\..+/.test(form.website.trim())) errs.website = "Include https:// and a valid domain";
      if (form.teamSize && Number(form.teamSize) < 1) errs.teamSize = "Team size must be at least 1";
    }

    if (current === 3) {
      if (!form.chairs || Number(form.chairs) < 1) errs.chairs = "At least 1 chair is required";
      if (Number(form.chairs) > Number(heroSettings.totalChairs)) errs.chairs = `Only ${heroSettings.totalChairs} chairs total are available`;
      if (!form.ratePerChair || Number(form.ratePerChair) <= 0) errs.ratePerChair = "Enter a valid rate";
      if (!form.duration || Number(form.duration) < 1) errs.duration = "Duration must be at least 1 month";
      const namedMembers = form.members.filter((m) => m.name.trim());
      form.members.forEach((m, i) => {
        if (!m.name.trim() && !m.cnic.trim() && !m.phone.trim() && !m.chairNo.trim()) return; // fully blank row, ignore
        if (!m.name.trim()) errs[`member_${i}_name`] = "Name required";
        if (m.cnic.trim() && !CNIC_RE.test(m.cnic.trim()) && !PASSPORT_RE.test(m.cnic.trim())) errs[`member_${i}_cnic`] = "Invalid CNIC/passport format";
        if (m.phone.trim() && !PHONE_RE.test(m.phone.trim())) errs[`member_${i}_phone`] = "Invalid phone format";
      });
      if (!namedMembers.length) errs.members = "Add at least one member/occupant";
    }

    if (current === 4) {
      if (!form.emergencyName.trim()) errs.emergencyName = "Emergency contact name is required";
      if (!form.emergencyPhone.trim()) {
        errs.emergencyPhone = "Emergency contact phone is required";
      } else if (!PHONE_RE.test(form.emergencyPhone.trim())) {
        errs.emergencyPhone = "Use format 03XX-XXXXXXX";
      }
      if (!form.termsAgreed) errs.termsAgreed = "Please accept the terms & conditions";
      if (!form.declarationName.trim()) errs.declarationName = "Type your name to sign the declaration";
    }

    setErrors(errs);
    if (Object.keys(errs).length) {
      setToast({ type: "error", text: "Please fix the highlighted fields before continuing." });
      return false;
    }
    return true;
  }

  function goNext() {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, 4));
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
    formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function submitApplication() {
    if (submitting) return;
    const step1Ok = validateStep(1);
    const step2Ok = step1Ok && validateStep(2);
    const step3Ok = step2Ok && validateStep(3);
    const step4Ok = step3Ok && validateStep(4);
    if (!step4Ok) {
      const firstBadStep = !step1Ok ? 1 : !step2Ok ? 2 : !step3Ok ? 3 : 4;
      setStep(firstBadStep);
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setSubmitting(true);
    try {
      const record = await apiRequest(COWORKING_ENDPOINT, { method: "POST", body: buildApplicationFormData(form) });
      setRecords((rs) => [record, ...rs]);
      setForm(emptyForm("", Number(heroSettings.monthlyRate) || 25000));
      setErrors({});
      setStep(1);
      setToast({ type: "success", text: `Application ${record.application.formNo} submitted for review.` });
      formTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      setToast({ type: "error", text: err.message || "Couldn't submit the application — check connection." });
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteRecord(id) {
    try {
      await apiRequest(`${COWORKING_ENDPOINT}${id}/`, { method: "DELETE" });
      setRecords((rs) => rs.filter((r) => r.id !== id));
      setToast({ type: "success", text: "Record deleted." });
    } catch (err) {
      setToast({ type: "error", text: err.message || "Couldn't delete the record." });
    }
  }

  // Admin only (the server enforces it too). The response is the whole
  // updated record, so status / review / billing months stay in sync.
  async function saveReview(id, review) {
    try {
      const updated = await apiRequest(`${COWORKING_ENDPOINT}${id}/review/`, {
        method: "POST",
        body: JSON.stringify(review),
      });
      setRecords((rs) => rs.map((r) => (r.id === id ? updated : r)));
      setOpenReviewId(null);
      setToast({ type: "success", text: `Application marked ${review.decision.toLowerCase()}.` });
    } catch (err) {
      setToast({ type: "error", text: err.message || "Couldn't save the decision." });
    }
  }

  // Tick a specific month's rent as received on an Approved record. The
  // server records that amount against the month AND adds the matching
  // Income row in one transaction (it also maps Cash/Card to the methods
  // the Income table accepts). The checks below just give instant feedback.
  async function recordPayment(id, amountInput, monthKey) {
    const target = records.find((r) => r.id === id);
    if (!target) return;
    const amt = Number(amountInput);
    if (!amt || amt <= 0) {
      setToast({ type: "error", text: "Enter a valid payment amount." });
      return;
    }
    const monthlyDue = Number(target.application.monthlyPayment) || 0;
    const paidThisMonth = (target.payments || []).filter((p) => p.month === monthKey).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const remainingThisMonth = monthlyDue - paidThisMonth;
    if (amt > remainingThisMonth + 0.5) {
      setToast({ type: "error", text: `Only ${money(remainingThisMonth)} is due for ${monthLabel(monthKey)}.` });
      return;
    }
    try {
      const updated = await apiRequest(`${COWORKING_ENDPOINT}${id}/payments/`, {
        method: "POST",
        body: JSON.stringify({ month: monthKey, amount: amt }),
      });
      setRecords((rs) => rs.map((r) => (r.id === id ? updated : r)));
      setToast({ type: "success", text: `${money(amt)} marked received for ${monthLabel(monthKey)} — added to Income.` });
    } catch (err) {
      setToast({ type: "error", text: err.message || "Couldn't record payment — check connection." });
    }
  }

  const viewRecord = records.find((r) => r.id === viewRecordId);

  // Fetch the applicant photo + CNIC front/back for the View record modal
  // as authenticated blobs (see note on viewFiles above) whenever a
  // different record is opened. Object URLs are revoked on cleanup so we
  // don't leak memory as the admin clicks through several applications.
  useEffect(() => {
    if (!viewRecordId) {
      setViewFiles({ photo: null, cnicFront: null, cnicBack: null });
      return;
    }
    const record = records.find((r) => r.id === viewRecordId);
    if (!record) return;
    let cancelled = false;
    const createdUrls = [];
    async function loadFile(url) {
      if (!url) return null;
      try {
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) return null;
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        createdUrls.push(objectUrl);
        return objectUrl;
      } catch {
        return null;
      }
    }
    setViewFilesLoading(true);
    (async () => {
      const [photo, cnicFront, cnicBack] = await Promise.all([
        loadFile(record.application.photoUrl),
        loadFile(record.application.cnicFrontUrl),
        loadFile(record.application.cnicBackUrl),
      ]);
      if (!cancelled) {
        setViewFiles({ photo, cnicFront, cnicBack });
        setViewFilesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      createdUrls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [viewRecordId]);

  /* ==================================================================== */
  return (
    <div className={`${page} -m-4 sm:-m-6 p-4 sm:p-6 min-h-full`}>
      <style>{`
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
      `}</style>
      {/* Back link */}
      <button
        onClick={() => onNavigate && onNavigate("Dashboard")}
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-violet-500 hover:text-violet-400 mb-4"
      >
        <ArrowLeft size={14} /> Back to Dashboard
      </button>

      {/* Hero */}
      <div ref={formTopRef} />
      <div className="mb-5">
        <h1
          className={`text-[26px] sm:text-[30px] font-extrabold leading-tight ${heading} transition-all duration-700 ease-out ${
            heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          Coworking Space
          <br />
          <span className="bg-gradient-to-r from-violet-500 to-indigo-500 bg-clip-text text-transparent">Chair Rental</span>
        </h1>
        <p
          className={`text-[12.5px] mt-2 max-w-xl ${muted} transition-all duration-700 ease-out delay-100 ${
            heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          Flexible workspace for freelancers, startups and growing businesses. Rent a chair and be part of our professional community.
        </p>
        <div
          className={`flex flex-wrap gap-5 mt-3 transition-all duration-700 ease-out delay-200 ${
            heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          {[
            { icon: Zap, label: "Modern Workspace" },
            { icon: ShieldCheck, label: "Secure Access" },
            { icon: UsersRound, label: "Networking Opportunity" },
          ].map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-1.5 text-[11.5px] font-medium">
              <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-600/15 to-indigo-600/15 text-violet-500 flex items-center justify-center">
                <Icon size={13} />
              </span>
              <span className={cardText}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Hero banner — auto-advancing slideshow of the space */}
      <div
        className="relative rounded-2xl overflow-hidden mb-5 h-52 sm:h-64 flex items-end sm:items-center px-5 sm:px-10 pb-5 sm:pb-0"
        onMouseEnter={() => setSlidesPaused(true)}
        onMouseLeave={() => setSlidesPaused(false)}
        onTouchStart={() => setSlidesPaused(true)}
      >
        {/* Crossfading slide layers, each with a slow Ken-Burns zoom while active */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#241a4a] via-[#2f2160] to-[#160f33]">
          {SPACE_IMAGES.map((slide, i) => {
            const Icon = slide.icon;
            const active = i === slideIndex;
            return (
              <div key={slide.caption} className="absolute inset-0 transition-opacity duration-1000 ease-in-out" style={{ opacity: active ? 1 : 0 }}>
                {slide.photo ? (
                  <img
                    src={slide.photo}
                    alt={slide.caption}
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-[5000ms] ease-out"
                    style={{ transform: active ? "scale(1.06)" : "scale(1)" }}
                  />
                ) : (
                  <div
                    className={`absolute inset-0 bg-gradient-to-br ${slide.gradient} flex items-center justify-center transition-transform duration-[5000ms] ease-out`}
                    style={{ transform: active ? "scale(1.08)" : "scale(1)" }}
                  >
                    <Icon size={72} className="text-white/10" />
                  </div>
                )}
                <span className="absolute bottom-4 left-5 sm:bottom-5 sm:left-8 text-white/70 text-[10px] font-semibold uppercase tracking-wide">{slide.caption}</span>
              </div>
            );
          })}
        </div>
        {/* Brand-tinted overlay so headline text stays legible over any slide */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#160f33]/90 via-[#1e1547]/50 to-[#241a4a]/20" />
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "radial-gradient(circle at 20% 30%, rgba(139,92,246,0.35), transparent 45%), radial-gradient(circle at 80% 70%, rgba(99,102,241,0.3), transparent 45%)" }} />

        <div
          className={`relative z-10 transition-all duration-700 ease-out delay-300 ${heroLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
        >
          <Armchair className="text-violet-300 mb-2 animate-[float_4s_ease-in-out_infinite]" size={30} />
          <p className="text-white text-[14px] sm:text-[13px] font-medium max-w-[240px] leading-snug">A quiet, well-lit desk waiting for your next big idea.</p>
        </div>
        <p className="hidden sm:block absolute right-10 top-1/2 -translate-y-1/2 text-right text-white text-xl sm:text-2xl font-extrabold leading-tight opacity-90">
          GOOD
          <br />
          IDEAS
          <br />
          <span className="text-violet-300">GROW</span>
          <br />
          HERE
        </p>

        {/* Slide indicators */}
        <div className="absolute bottom-3 right-4 sm:bottom-4 sm:right-5 z-10 flex items-center gap-1.5">
          {SPACE_IMAGES.map((slide, i) => (
            <button
              key={slide.caption}
              type="button"
              aria-label={`Show slide ${i + 1}: ${slide.caption}`}
              onClick={() => setSlideIndex(i)}
              className={`h-1.5 rounded-full transition-all duration-300 ${i === slideIndex ? "w-5 bg-white" : "w-1.5 bg-white/40 hover:bg-white/60"}`}
            />
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="flex items-center justify-between mb-2">
        {heroSettingsLoading && <span className={`text-[10.5px] ${subtle}`}>Loading workspace details…</span>}
        {isAdmin && !heroSettingsLoading && (
          <button
            type="button"
            onClick={openHeroSettingsModal}
            className={`ml-auto flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
              darkMode ? "text-violet-300 hover:bg-slate-800" : "text-violet-600 hover:bg-violet-50"
            }`}
          >
            <PenSquare size={12} /> Edit Details
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          { icon: Armchair, label: "Total Chairs", value: heroSettings.totalChairs, sub: `${availableChairs} Available`, subColor: "text-emerald-500" },
          { icon: Users, label: "Monthly Rate", value: money(heroSettings.monthlyRate), sub: "per chair" },
          { icon: Calendar, label: "Flexible Duration", value: `${heroSettings.minDurationMonths} – ${heroSettings.maxDurationMonths} Months`, sub: heroSettings.durationNote || "Custom options available" },
          { icon: ShieldCheck, label: "Secure & Professional", value: heroSettings.supportHours || "24/7 Support", sub: heroSettings.securityFeatures || "Access control, CCTV" },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl p-4 shadow-sm flex items-start gap-3 ${card}`}>
            <span className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center">
              <s.icon size={17} />
            </span>
            <div className="min-w-0">
              <p className={`text-[10.5px] font-medium ${muted}`}>{s.label}</p>
              <p className={`text-[16px] font-bold leading-tight mt-0.5 ${heading}`}>{s.value}</p>
              <p className={`text-[10.5px] mt-0.5 ${s.subColor || subtle}`}>{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Edit hero details modal (admin only) */}
      {showHeroSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => !savingHeroSettings && setShowHeroSettingsModal(false)}>
          <div
            className={`w-full max-w-md rounded-xl shadow-xl p-5 ${card}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-[14px] font-bold ${heading}`}>Edit Workspace Details</h3>
              <button type="button" onClick={() => !savingHeroSettings && setShowHeroSettingsModal(false)} className={muted}>
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={labelBase}>Total Chairs</label>
                <input
                  type="number"
                  min="1"
                  className={heroSettingsErrors.totalChairs ? errorInputBase : inputBase}
                  value={heroSettingsForm.totalChairs}
                  onChange={(e) => setHeroSettingsForm((f) => ({ ...f, totalChairs: e.target.value }))}
                />
                {heroSettingsErrors.totalChairs && <p className="text-[10px] text-rose-500 mt-1">{heroSettingsErrors.totalChairs}</p>}
              </div>

              <div>
                <label className={labelBase}>Monthly Rate (PKR per chair)</label>
                <input
                  type="number"
                  min="1"
                  className={heroSettingsErrors.monthlyRate ? errorInputBase : inputBase}
                  value={heroSettingsForm.monthlyRate}
                  onChange={(e) => setHeroSettingsForm((f) => ({ ...f, monthlyRate: e.target.value }))}
                />
                {heroSettingsErrors.monthlyRate && <p className="text-[10px] text-rose-500 mt-1">{heroSettingsErrors.monthlyRate}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelBase}>Min Duration (months)</label>
                  <input
                    type="number"
                    min="1"
                    className={heroSettingsErrors.minDurationMonths ? errorInputBase : inputBase}
                    value={heroSettingsForm.minDurationMonths}
                    onChange={(e) => setHeroSettingsForm((f) => ({ ...f, minDurationMonths: e.target.value }))}
                  />
                  {heroSettingsErrors.minDurationMonths && <p className="text-[10px] text-rose-500 mt-1">{heroSettingsErrors.minDurationMonths}</p>}
                </div>
                <div>
                  <label className={labelBase}>Max Duration (months)</label>
                  <input
                    type="number"
                    min="1"
                    className={heroSettingsErrors.maxDurationMonths ? errorInputBase : inputBase}
                    value={heroSettingsForm.maxDurationMonths}
                    onChange={(e) => setHeroSettingsForm((f) => ({ ...f, maxDurationMonths: e.target.value }))}
                  />
                  {heroSettingsErrors.maxDurationMonths && <p className="text-[10px] text-rose-500 mt-1">{heroSettingsErrors.maxDurationMonths}</p>}
                </div>
              </div>

              <div>
                <label className={labelBase}>Duration Note</label>
                <input
                  type="text"
                  className={inputBase}
                  placeholder="Custom options available"
                  value={heroSettingsForm.durationNote}
                  onChange={(e) => setHeroSettingsForm((f) => ({ ...f, durationNote: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelBase}>Support Hours</label>
                <input
                  type="text"
                  className={inputBase}
                  placeholder="24/7 Support"
                  value={heroSettingsForm.supportHours}
                  onChange={(e) => setHeroSettingsForm((f) => ({ ...f, supportHours: e.target.value }))}
                />
              </div>

              <div>
                <label className={labelBase}>Security Features (Access control, CCTV, etc.)</label>
                <input
                  type="text"
                  className={inputBase}
                  placeholder="Access control, CCTV"
                  value={heroSettingsForm.securityFeatures}
                  onChange={(e) => setHeroSettingsForm((f) => ({ ...f, securityFeatures: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                type="button"
                onClick={() => setShowHeroSettingsModal(false)}
                disabled={savingHeroSettings}
                className={`px-3.5 py-2 rounded-lg text-[12px] font-semibold ${darkMode ? "bg-slate-800 text-slate-300" : "bg-slate-100 text-slate-600"}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveHeroSettings}
                disabled={savingHeroSettings}
                className="px-3.5 py-2 rounded-lg text-[12px] font-semibold text-white bg-gradient-to-br from-violet-600 to-indigo-600 disabled:opacity-60"
              >
                {savingHeroSettings ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Workspace + Application form */}
      <div className="grid lg:grid-cols-5 gap-4 mb-5 items-start">
        {/* Our Workspace */}
        <div className={`lg:col-span-2 rounded-xl p-4 shadow-sm ${card}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
              <Armchair size={15} />
            </span>
            <div>
              <h3 className={`text-[13.5px] font-bold ${heading}`}>Our Workspace</h3>
              <p className={`text-[10.5px] ${muted}`}>Comfortable chairs, high-speed internet and a productive environment.</p>
            </div>
          </div>

          <div className="relative rounded-lg overflow-hidden h-36 mt-3">
            {WORKSPACE_VISUAL.photo ? (
              <img src={WORKSPACE_VISUAL.photo} alt="Inside the Hopenix coworking space" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#1c1440] via-[#2f2160] to-[#241a4a] flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "radial-gradient(circle at 25% 25%, rgba(139,92,246,0.4), transparent 50%), radial-gradient(circle at 75% 75%, rgba(99,102,241,0.35), transparent 50%)" }} />
                <Armchair className="relative text-violet-300/60 animate-[float_4s_ease-in-out_infinite]" size={48} />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#160f33]/70 via-transparent to-transparent" />
          </div>

          <div className="mt-3 space-y-2.5">
            {[
              { icon: Armchair, label: "Ergonomic Chairs" },
              { icon: Wifi, label: "High-Speed WiFi" },
              { icon: Users, label: "Meeting Rooms" },
              { icon: Coffee, label: "Pantry & Refreshments" },
              { icon: Clock3, label: "24/7 Access (if approved)" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2.5">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-600/10 to-indigo-600/10 text-violet-500 flex items-center justify-center shrink-0">
                  <Icon size={13} />
                </span>
                <span className={`text-[11.5px] font-medium ${cardText}`}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Application form */}
        <div className={`lg:col-span-3 rounded-xl p-4 sm:p-5 shadow-sm ${card}`}>
          <div className="flex items-center gap-2 mb-4">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
              <FileText size={15} />
            </span>
            <div>
              <h3 className={`text-[13.5px] font-bold ${heading}`}>Chair Rental Application</h3>
              <p className={`text-[10.5px] ${muted}`}>Fill out the form to apply for a coworking chair. Form: CWS-01</p>
            </div>
          </div>

          {/* Stepper */}
          <div className="flex items-center justify-between mb-5 px-1">
            {STEPS.map((s, i) => (
              <React.Fragment key={s.id}>
                <div className="flex flex-col items-center gap-1 min-w-[44px] sm:min-w-[56px]">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                      step === s.id
                        ? "bg-gradient-to-br from-violet-600 to-indigo-600 text-white"
                        : step > s.id
                        ? "bg-emerald-500 text-white"
                        : darkMode
                        ? "bg-slate-800 text-slate-500"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {step > s.id ? <CheckCircle2 size={14} /> : s.id}
                  </div>
                  <span className={`text-[9.5px] font-medium text-center leading-tight ${step === s.id ? "text-violet-500" : subtle}`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && <div className={`flex-1 h-[2px] mx-1 mb-4 ${step > s.id ? "bg-emerald-500" : darkMode ? "bg-slate-800" : "bg-slate-200"}`} />}
              </React.Fragment>
            ))}
          </div>

          {/* ---------------- Step 1: Personal Details (A + B) ---------------- */}
          {step === 1 && (
            <div className="space-y-4">
              <SectionLabel letter="A" title="Application Record" muted={muted} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Field label="Form No.">
                  <input className={inputBase} value="Assigned on submit" disabled />
                </Field>
                <Field label="Application Date">
                  <input type="date" className={inputBase} value={form.applicationDate} onChange={set("applicationDate")} />
                </Field>
                <Field label="Agreement ID">
                  <input className={inputBase} placeholder="Enter ID" value={form.agreementId} onChange={set("agreementId")} />
                </Field>
                <Field label="Start Date">
                  <input type="date" className={inputBase} value={form.startDate} onChange={set("startDate")} />
                </Field>
              </div>

              <SectionLabel letter="B" title="Applicant / Occupant Details" muted={muted} />
              <div className="grid sm:grid-cols-[1fr_110px] gap-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <Field label="Full Name (as per CNIC / Passport)" full error={errors.fullName}>
                    <input className={errors.fullName ? errorInputBase : inputBase} placeholder="Enter full name" value={form.fullName} onChange={set("fullName")} />
                  </Field>
                  <Field label="Father / Husband Name" full>
                    <input className={inputBase} placeholder="Enter name" value={form.fatherName} onChange={set("fatherName")} />
                  </Field>
                  <Field label="CNIC / Passport No." error={errors.cnic}>
                    <input className={errors.cnic ? errorInputBase : inputBase} placeholder="XXXXX-XXXXXXX-X" value={form.cnic} onChange={set("cnic")} />
                  </Field>
                  <Field label="Date of Birth">
                    <input type="date" className={inputBase} value={form.dob} onChange={set("dob")} />
                  </Field>
                  <Field label="Mobile No." error={errors.mobile}>
                    <input className={errors.mobile ? errorInputBase : inputBase} placeholder="03XX-XXXXXXX" value={form.mobile} onChange={set("mobile")} />
                  </Field>
                  <Field label="WhatsApp No." error={errors.whatsapp}>
                    <input className={errors.whatsapp ? errorInputBase : inputBase} placeholder="03XX-XXXXXXX" value={form.whatsapp} onChange={set("whatsapp")} />
                  </Field>
                </div>
                <div className="flex sm:flex-col items-center gap-2 sm:gap-0">
                  <label className={`w-24 sm:w-full aspect-[3/4] rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer overflow-hidden shrink-0 ${darkMode ? "border-slate-700 hover:border-violet-600" : "border-slate-200 hover:border-violet-400"}`}>
                    {form.photo ? (
                      <img src={form.photo} alt="Applicant" className="w-full h-full object-cover" />
                    ) : (
                      <>
                        <Camera size={18} className={subtle} />
                        <span className={`text-[9.5px] text-center px-2 hidden sm:block ${subtle}`}>Passport-size photo</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
                  </label>
                  <p className={`text-[9.5px] text-center mt-1.5 sm:hidden ${subtle}`}>Passport-size photo</p>
                </div>
              </div>
              <Field label="Email Address" error={errors.email}>
                <input type="email" className={errors.email ? errorInputBase : inputBase} placeholder="Enter email address" value={form.email} onChange={set("email")} />
              </Field>
              <Field label="Residential Address" error={errors.address}>
                <textarea rows={2} className={errors.address ? errorInputBase : inputBase} placeholder="Enter complete address" value={form.address} onChange={set("address")} />
              </Field>

              <SectionLabel letter="B·1" title="CNIC Upload" muted={muted} />
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="CNIC — Front Side" error={errors.cnicFront}>
                  <label
                    className={`relative flex flex-col items-center justify-center gap-1.5 w-full aspect-[16/10] rounded-lg border-2 border-dashed cursor-pointer overflow-hidden ${
                      errors.cnicFront ? "border-rose-400" : darkMode ? "border-slate-700 hover:border-violet-600" : "border-slate-200 hover:border-violet-400"
                    }`}
                  >
                    {form.cnicFront ? (
                      <img src={form.cnicFront} alt="CNIC front" className="w-full h-full object-cover" />
                    ) : (
                      <>
                        <IdCard size={18} className={subtle} />
                        <span className={`text-[9.5px] text-center px-2 ${subtle}`}>Upload front</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handleCnicUpload("cnicFront")} />
                  </label>
                </Field>
                <Field label="CNIC — Back Side" error={errors.cnicBack}>
                  <label
                    className={`relative flex flex-col items-center justify-center gap-1.5 w-full aspect-[16/10] rounded-lg border-2 border-dashed cursor-pointer overflow-hidden ${
                      errors.cnicBack ? "border-rose-400" : darkMode ? "border-slate-700 hover:border-violet-600" : "border-slate-200 hover:border-violet-400"
                    }`}
                  >
                    {form.cnicBack ? (
                      <img src={form.cnicBack} alt="CNIC back" className="w-full h-full object-cover" />
                    ) : (
                      <>
                        <IdCard size={18} className={subtle} />
                        <span className={`text-[9.5px] text-center px-2 ${subtle}`}>Upload back</span>
                      </>
                    )}
                    <input type="file" accept="image/*" className="hidden" onChange={handleCnicUpload("cnicBack")} />
                  </label>
                </Field>
              </div>
            </div>
          )}

          {/* ---------------- Step 2: Work Profile (C) ---------------- */}
          {step === 2 && (
            <div className="space-y-4">
              <SectionLabel letter="C" title="Work / Business Profile" muted={muted} />
              <div>
                <span className={labelBase}>Applicant Type</span>
                <div className="flex flex-wrap gap-2">
                  {APPLICANT_TYPES.map((type) => (
                    <button
                      type="button"
                      key={type}
                      onClick={() => {
                        toggleInArray("applicantType", type);
                        setErrors((er) => (er.applicantType ? { ...er, applicantType: undefined } : er));
                      }}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
                        form.applicantType.includes(type)
                          ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent"
                          : darkMode
                          ? "border-slate-700 text-slate-300 hover:border-violet-600"
                          : "border-slate-200 text-slate-600 hover:border-violet-400"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                {errors.applicantType && (
                  <p className="flex items-center gap-1 text-[10px] font-medium text-rose-500 mt-1.5">
                    <AlertCircle size={10} className="shrink-0" /> {errors.applicantType}
                  </p>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <Field label="Company / Agency / Brand Name" full error={errors.companyName}>
                  <input className={errors.companyName ? errorInputBase : inputBase} placeholder="If applicable" value={form.companyName} onChange={set("companyName")} />
                </Field>
                <Field label="Legal Status">
                  <input className={inputBase} placeholder="Sole prop., Pvt Ltd..." value={form.legalStatus} onChange={set("legalStatus")} />
                </Field>
                <Field label="Registration / NTN">
                  <input className={inputBase} placeholder="Enter number" value={form.registrationNo} onChange={set("registrationNo")} />
                </Field>
              </div>
              <Field label="Nature of Work / Services">
                <textarea rows={2} className={inputBase} placeholder="Briefly describe the work" value={form.natureOfWork} onChange={set("natureOfWork")} />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Field label="Website / Social Link" error={errors.website}>
                  <input className={errors.website ? errorInputBase : inputBase} placeholder="https://" value={form.website} onChange={set("website")} />
                </Field>
                <Field label="Team Size" error={errors.teamSize}>
                  <input type="number" min="1" className={errors.teamSize ? errorInputBase : inputBase} placeholder="e.g. 1" value={form.teamSize} onChange={set("teamSize")} />
                </Field>
              </div>
            </div>
          )}

          {/* ---------------- Step 3: Workspace Needs (D + E) ---------------- */}
          {step === 3 && (
            <div className="space-y-4">
              <SectionLabel letter="D" title="Workspace Requirements" muted={muted} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Field label="No. of Chairs" error={errors.chairs}>
                  <input type="number" min="1" className={errors.chairs ? errorInputBase : inputBase} value={form.chairs} onChange={set("chairs")} />
                </Field>
                <Field label="Rate / Chair / Month" error={errors.ratePerChair}>
                  <input type="number" min="0" className={errors.ratePerChair ? errorInputBase : inputBase} value={form.ratePerChair} onChange={set("ratePerChair")} />
                </Field>
                <Field label="Duration (Months)" error={errors.duration}>
                  <input type="number" min="1" className={errors.duration ? errorInputBase : inputBase} value={form.duration} onChange={set("duration")} />
                </Field>
                <Field label="Expected End Date">
                  <input type="date" className={inputBase} value={form.expectedEndDate} onChange={set("expectedEndDate")} />
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <span className={labelBase}>Seating</span>
                  <div className="flex gap-2">
                    {["Dedicated", "Flexible / Hot Desk"].map((opt) => (
                      <button
                        type="button"
                        key={opt}
                        onClick={() => setForm((f) => ({ ...f, seating: opt }))}
                        className={`flex-1 px-2.5 py-2 rounded-lg text-[11px] font-medium border transition-colors ${
                          form.seating === opt
                            ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent"
                            : darkMode
                            ? "border-slate-700 text-slate-300"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <span className={labelBase}>Access</span>
                  <div className="flex gap-2">
                    {["Office Hours", "Extended (if approved)"].map((opt) => (
                      <button
                        type="button"
                        key={opt}
                        onClick={() => setForm((f) => ({ ...f, access: opt }))}
                        className={`flex-1 px-2.5 py-2 rounded-lg text-[11px] font-medium border transition-colors ${
                          form.access === opt
                            ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white border-transparent"
                            : darkMode
                            ? "border-slate-700 text-slate-300"
                            : "border-slate-200 text-slate-600"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-2.5">
                <Field label="Assigned Chair / Workstation No(s).">
                  <input className={inputBase} placeholder="e.g. C-04" value={form.assignedChairs} onChange={set("assignedChairs")} />
                </Field>
                <Field label="Special Requirements / Notes">
                  <input className={inputBase} placeholder="Optional" value={form.specialNotes} onChange={set("specialNotes")} />
                </Field>
              </div>

              <div className="flex items-center justify-between pt-1">
                <SectionLabel letter="E" title="Member / Seat Allocation" muted={muted} />
                <button type="button" onClick={addMember} className="flex items-center gap-1 text-[10.5px] font-semibold text-violet-500 hover:text-violet-400">
                  <Plus size={12} /> Add Member
                </button>
              </div>
              {errors.members && (
                <p className="flex items-center gap-1 text-[10px] font-medium text-rose-500 -mt-2">
                  <AlertCircle size={10} className="shrink-0" /> {errors.members}
                </p>
              )}
              <div className="space-y-2.5">
                {form.members.map((m, idx) => (
                  <div key={m.id} className={`rounded-lg p-2.5 sm:p-0 sm:rounded-none ${darkMode ? "bg-slate-800/40 sm:bg-transparent" : "bg-slate-50 sm:bg-transparent"}`}>
                    <div className="grid grid-cols-1 sm:grid-cols-[20px_1fr_1fr_0.7fr_0.6fr_24px] gap-1.5 sm:items-center">
                      <div className="flex items-center justify-between sm:block">
                        <span className={`text-[10px] font-semibold sm:hidden ${subtle}`}>Member {idx + 1}</span>
                        <span className={`hidden sm:block text-[10px] text-center ${subtle}`}>{idx + 1}</span>
                        <button type="button" onClick={() => removeMember(m.id)} className="sm:hidden text-rose-500 hover:text-rose-400 disabled:opacity-30" disabled={form.members.length === 1}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div>
                        <input className={errors[`member_${idx}_name`] ? errorInputBase : inputBase} placeholder="Member name" value={m.name} onChange={(e) => updateMember(m.id, "name", e.target.value)} />
                        {errors[`member_${idx}_name`] && <p className="text-[10px] text-rose-500 mt-1 sm:hidden">{errors[`member_${idx}_name`]}</p>}
                      </div>
                      <div>
                        <input className={errors[`member_${idx}_cnic`] ? errorInputBase : inputBase} placeholder="CNIC / Passport" value={m.cnic} onChange={(e) => updateMember(m.id, "cnic", e.target.value)} />
                        {errors[`member_${idx}_cnic`] && <p className="text-[10px] text-rose-500 mt-1 sm:hidden">{errors[`member_${idx}_cnic`]}</p>}
                      </div>
                      <div>
                        <input className={errors[`member_${idx}_phone`] ? errorInputBase : inputBase} placeholder="Phone" value={m.phone} onChange={(e) => updateMember(m.id, "phone", e.target.value)} />
                        {errors[`member_${idx}_phone`] && <p className="text-[10px] text-rose-500 mt-1 sm:hidden">{errors[`member_${idx}_phone`]}</p>}
                      </div>
                      <input className={inputBase} placeholder="Chair No." value={m.chairNo} onChange={(e) => updateMember(m.id, "chairNo", e.target.value)} />
                      <button type="button" onClick={() => removeMember(m.id)} className="hidden sm:block text-rose-500 hover:text-rose-400 disabled:opacity-30" disabled={form.members.length === 1}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ---------------- Step 4: Summary (G + F + H + I) ---------------- */}
          {step === 4 && (
            <div className="space-y-4">
              <SectionLabel letter="G" title="Required Documents & Emergency Contact" muted={muted} />
              <div className="flex flex-wrap gap-2">
                {DOCUMENT_LIST.map((doc) => (
                  <button
                    type="button"
                    key={doc}
                    onClick={() => toggleInArray("documents", doc)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10.5px] font-medium border transition-colors ${
                      form.documents.includes(doc)
                        ? "border-emerald-500 text-emerald-500 bg-emerald-500/10"
                        : darkMode
                        ? "border-slate-700 text-slate-400"
                        : "border-slate-200 text-slate-500"
                    }`}
                  >
                    {form.documents.includes(doc) ? <CheckCircle2 size={12} /> : <span className="w-3 h-3 rounded-sm border border-current" />}
                    {doc}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Field label="Emergency Contact Name" error={errors.emergencyName}>
                  <input className={errors.emergencyName ? errorInputBase : inputBase} value={form.emergencyName} onChange={set("emergencyName")} />
                </Field>
                <Field label="Relationship">
                  <input className={inputBase} value={form.emergencyRelation} onChange={set("emergencyRelation")} />
                </Field>
                <Field label="Phone No." error={errors.emergencyPhone}>
                  <input className={errors.emergencyPhone ? errorInputBase : inputBase} value={form.emergencyPhone} onChange={set("emergencyPhone")} />
                </Field>
                <Field label="Alternate No.">
                  <input className={inputBase} value={form.emergencyAltPhone} onChange={set("emergencyAltPhone")} />
                </Field>
              </div>

              <SectionLabel letter="F" title="Monthly Rent & Payment Summary (PKR)" muted={muted} />
              <div className={`rounded-lg p-3 grid grid-cols-2 sm:grid-cols-3 gap-2.5 ${darkMode ? "bg-slate-800/50" : "bg-slate-50"}`}>
                <MiniStat label="Chairs" value={form.chairs} muted={muted} heading={heading} />
                <MiniStat label="Rate / Chair" value={money(form.ratePerChair)} muted={muted} heading={heading} />
                <MiniStat label="Months" value={form.duration} muted={muted} heading={heading} />
                <MiniStat label="Subtotal" value={money(subtotal)} muted={muted} heading={heading} />
                <MiniStat label="Monthly Payment" value={money(monthlyPayment)} muted={muted} heading="text-violet-500" />
                <MiniStat label="Grand Total" value={money(grandTotal)} muted={muted} heading={heading} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <Field label="Discount %">
                  <input type="number" min="0" max="100" className={inputBase} value={form.discountPercent} onChange={set("discountPercent")} />
                </Field>
                <Field label="Security Deposit">
                  <input type="number" min="0" className={inputBase} value={form.securityDeposit} onChange={set("securityDeposit")} />
                </Field>
                <Field label="Other Charges">
                  <input type="number" min="0" className={inputBase} value={form.otherCharges} onChange={set("otherCharges")} />
                </Field>
                <Field label="Billing Due Day">
                  <input className={inputBase} value={form.billingDueDay} onChange={set("billingDueDay")} />
                </Field>
                <Field label="Payment Method">
                  <select className={inputBase} value={form.paymentMethod} onChange={set("paymentMethod")}>
                    {["Bank Transfer", "Cash", "Card", "JazzCash", "Easypaisa"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Transaction / Receipt No.">
                  <input className={inputBase} value={form.transactionNo} onChange={set("transactionNo")} />
                </Field>
                <Field label="Billing Cycle">
                  <select className={inputBase} value={form.billingCycle} onChange={set("billingCycle")}>
                    {["Monthly", "Quarterly", "Bi-Annually"].map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <SectionLabel letter="H · I" title="Terms & Applicant Declaration" muted={muted} />
              <div className={`rounded-lg p-3 text-[10.5px] leading-relaxed max-h-24 overflow-y-auto ${darkMode ? "bg-slate-800/50 text-slate-400" : "bg-slate-50 text-slate-500"}`}>
                This arrangement is for workspace/chair use only. Monthly rent is payable by the agreed due date; delayed dues may
                result in access suspension. The chair, access card or workspace may not be transferred or sublet without prior
                written approval. HOPENIX may withdraw access for non-payment, misconduct or safety concerns.
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={form.termsAgreed} onChange={(e) => { setForm((f) => ({ ...f, termsAgreed: e.target.checked })); setErrors((er) => ({ ...er, termsAgreed: undefined })); }} className="w-4 h-4 mt-0.5 accent-violet-600 shrink-0" />
                <span className={`text-[11px] font-medium ${cardText}`}>I have read and accept the terms above and consent to identity verification.</span>
              </label>
              {errors.termsAgreed && (
                <p className="flex items-center gap-1 text-[10px] font-medium text-rose-500 -mt-2">
                  <AlertCircle size={10} className="shrink-0" /> {errors.termsAgreed}
                </p>
              )}
              <div className="grid sm:grid-cols-2 gap-2.5">
                <Field label="Applicant Name (Signature)" error={errors.declarationName}>
                  <input className={errors.declarationName ? errorInputBase : inputBase} placeholder="Type full name to sign" value={form.declarationName} onChange={set("declarationName")} />
                </Field>
                <Field label="Date">
                  <input type="date" className={inputBase} value={form.declarationDate} onChange={set("declarationDate")} />
                </Field>
              </div>
            </div>
          )}

          {/* Nav buttons */}
          <div className={`flex items-center justify-between mt-5 pt-4 border-t ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
            <button
              type="button"
              onClick={goBack}
              disabled={step === 1}
              className={`flex items-center gap-1 text-[11.5px] font-semibold px-3 py-2 rounded-lg disabled:opacity-30 ${darkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <ChevronLeft size={14} /> Back
            </button>
            {step < 4 ? (
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-4 py-2 text-[11.5px] font-semibold shadow-sm hover:opacity-90"
              >
                Next Step <ChevronRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={submitApplication}
                disabled={submitting}
                className="flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white rounded-lg px-4 py-2 text-[11.5px] font-semibold shadow-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={14} /> {submitting ? "Submitting…" : "Submit Application"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Plans */}
      <div className={`rounded-xl p-4 shadow-sm mb-5 ${card}`}>
        <div className="flex items-center gap-2 mb-4">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
            <Armchair size={15} />
          </span>
          <div>
            <h3 className={`text-[13.5px] font-bold ${heading}`}>Chair Rental Plans</h3>
            <p className={`text-[10.5px] ${muted}`}>Choose the plan that fits your needs.</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {PLANS.map((plan) => {
            const isApplied = Number(form.ratePerChair) === plan.rate && Number(form.duration) === plan.months;
            return (
              <div
                key={plan.id}
                className={`relative rounded-xl p-4 border-2 transition-colors ${
                  isApplied ? "border-emerald-500" : plan.tag ? "border-violet-500" : darkMode ? "border-slate-800" : "border-slate-100"
                }`}
              >
                {isApplied ? (
                  <span className="absolute -top-2.5 right-4 bg-emerald-500 text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                    <CheckCircle2 size={10} /> Applied
                  </span>
                ) : (
                  plan.tag && (
                    <span className="absolute -top-2.5 right-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full">{plan.tag}</span>
                  )
                )}
                <p className={`text-[13px] font-bold ${heading}`}>{plan.name}</p>
                <p className={`text-[19px] font-extrabold mt-1 ${heading}`}>
                  {money(plan.rate)} <span className={`text-[10.5px] font-medium ${muted}`}>/chair</span>
                </p>
                <ul className="mt-2.5 space-y-1.5">
                  {plan.perks.map((perk) => (
                    <li key={perk} className="flex items-center gap-1.5 text-[10.5px]">
                      <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                      <span className={cardText}>{perk}</span>
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => applyPlan(plan)}
                  className={`mt-3.5 w-full flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-semibold transition-opacity hover:opacity-90 ${
                    isApplied ? "bg-emerald-500 text-white" : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white"
                  }`}
                >
                  {isApplied ? "Applied to Form" : "Apply Now"} <ArrowRight size={13} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Records */}
      <div className={`rounded-xl p-4 shadow-sm ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white shrink-0">
              <ClipboardList size={15} />
            </span>
            <div>
              <h3 className={`text-[13.5px] font-bold ${heading}`}>Applicant Records</h3>
              <p className={`text-[10.5px] ${muted}`}>{records.length} application{records.length !== 1 ? "s" : ""} • {approvedRecords.length} active occupant{approvedRecords.length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className={`text-right rounded-lg px-3 py-1.5 ${darkMode ? "bg-slate-800/60" : "bg-slate-50"}`}>
            <p className={`text-[9.5px] font-medium ${muted}`}>Total Monthly Revenue</p>
            <p className="text-[13px] font-bold text-violet-500">{money(monthlyRevenue)}</p>
          </div>
        </div>

        {records.length === 0 ? (
          <div className={`text-center py-10 rounded-lg ${darkMode ? "bg-slate-800/40" : "bg-slate-50"}`}>
            <Armchair size={26} className={`mx-auto mb-2 ${subtle}`} />
            <p className={`text-[12px] font-medium ${muted}`}>{loading ? "Loading applications…" : "No applications yet"}</p>
            <p className={`text-[10.5px] mt-0.5 ${subtle}`}>Submitted chair rental applications will appear here as records.</p>
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-[11.5px] min-w-[760px]">
              <thead>
                <tr className={`text-left border-b ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                  {["Form No.", "Applicant", "Chairs", "Rate/Chair", "Duration", "Monthly Payment", "Grand Total", "Status", ""].map((h) => (
                    <th key={h} className={`px-4 sm:px-2 py-2 font-semibold ${muted}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className={`border-b ${darkMode ? "border-slate-800/60" : "border-slate-50"}`}>
                      <td className={`px-4 sm:px-2 py-2.5 font-semibold ${cardText}`}>{r.application.formNo}</td>
                      <td className="px-4 sm:px-2 py-2.5">
                        <p className={`font-medium ${cardText}`}>{r.application.fullName || "—"}</p>
                        <p className={`text-[10px] ${subtle}`}>{r.application.mobile}</p>
                      </td>
                      <td className={`px-4 sm:px-2 py-2.5 ${cardText}`}>{r.application.chairs}</td>
                      <td className={`px-4 sm:px-2 py-2.5 ${cardText}`}>{money(r.application.ratePerChair)}</td>
                      <td className={`px-4 sm:px-2 py-2.5 ${cardText}`}>{r.application.duration} mo</td>
                      <td className="px-4 sm:px-2 py-2.5 font-semibold text-violet-500">{money(r.application.monthlyPayment)}</td>
                      <td className={`px-4 sm:px-2 py-2.5 font-semibold ${cardText}`}>{money(r.application.grandTotal)}</td>
                      <td className="px-4 sm:px-2 py-2.5">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="px-4 sm:px-2 py-2.5">
                        <div className="flex items-center gap-2 justify-end">
                          <button onClick={() => setViewRecordId(r.id)} title="View" className="text-violet-500 hover:text-violet-400">
                            <Eye size={15} />
                          </button>
                          <button onClick={() => setOpenReviewId(openReviewId === r.id ? null : r.id)} title="Review / Payment" className={muted}>
                            <ChevronDown size={15} className={`transition-transform ${openReviewId === r.id ? "rotate-180" : ""}`} />
                          </button>
                          {isAdmin && (
                            <button onClick={() => deleteRecord(r.id)} title="Delete" className="text-rose-500 hover:text-rose-400">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {openReviewId === r.id && (
                      <tr>
                        <td colSpan={9} className={`px-4 sm:px-2 pb-4 ${darkMode ? "bg-slate-800/30" : "bg-slate-50/60"}`}>
                          <ReviewPanel
                            record={r}
                            darkMode={darkMode}
                            inputBase={inputBase}
                            labelBase={labelBase}
                            muted={muted}
                            isAdmin={isAdmin}
                            onSave={(review) => saveReview(r.id, review)}
                            onRecordPayment={(amount, monthKey) => recordPayment(r.id, amount, monthKey)}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* View record modal — full application: every field + applicant
          photo / CNIC front / CNIC back (click any thumbnail to zoom). */}
      {viewRecord && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4" onClick={() => setViewRecordId(null)}>
          <div className={`w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl p-5 shadow-xl ${card}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className={`text-[14px] font-bold ${heading}`}>{viewRecord.application.formNo} — {viewRecord.application.fullName}</h3>
              <button onClick={() => setViewRecordId(null)} className={muted}>
                <X size={18} />
              </button>
            </div>

            {/* Photo + CNIC front/back thumbnails */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <ViewFileThumb
                label="Applicant Photo"
                loading={viewFilesLoading}
                src={viewFiles.photo}
                available={!!viewRecord.application.photoUrl}
                onZoom={() => viewFiles.photo && setZoomImage({ url: viewFiles.photo, label: "Applicant Photo" })}
                darkMode={darkMode}
                subtle={subtle}
              />
              <ViewFileThumb
                label="CNIC — Front"
                loading={viewFilesLoading}
                src={viewFiles.cnicFront}
                available={!!viewRecord.application.cnicFrontUrl}
                onZoom={() => viewFiles.cnicFront && setZoomImage({ url: viewFiles.cnicFront, label: "CNIC — Front" })}
                darkMode={darkMode}
                subtle={subtle}
              />
              <ViewFileThumb
                label="CNIC — Back"
                loading={viewFilesLoading}
                src={viewFiles.cnicBack}
                available={!!viewRecord.application.cnicBackUrl}
                onZoom={() => viewFiles.cnicBack && setZoomImage({ url: viewFiles.cnicBack, label: "CNIC — Back" })}
                darkMode={darkMode}
                subtle={subtle}
              />
            </div>

            <SectionLabel letter="A" title="Application" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2 mb-3">
              <DetailRow label="Status"><StatusBadge status={viewRecord.status} /></DetailRow>
              <DetailRow label="Application Date" value={viewRecord.application.applicationDate || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Agreement ID" value={viewRecord.application.agreementId || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Start Date" value={viewRecord.application.startDate || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Submitted" value={new Date(viewRecord.submittedAt).toLocaleString()} muted={muted} cardText={cardText} />
            </div>

            <SectionLabel letter="B" title="Applicant / Occupant Details" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2 mb-3">
              <DetailRow label="Full Name" value={viewRecord.application.fullName || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Father's Name" value={viewRecord.application.fatherName || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="CNIC / Passport" value={viewRecord.application.cnic} muted={muted} cardText={cardText} />
              <DetailRow label="Date of Birth" value={viewRecord.application.dob || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Mobile" value={viewRecord.application.mobile} muted={muted} cardText={cardText} />
              <DetailRow label="WhatsApp" value={viewRecord.application.whatsapp || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Email" value={viewRecord.application.email || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Address" value={viewRecord.application.address || "—"} muted={muted} cardText={cardText} />
            </div>

            <SectionLabel letter="C" title="Work / Business Profile" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2 mb-3">
              <DetailRow label="Applicant Type" value={viewRecord.application.applicantType.join(", ") || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Company" value={viewRecord.application.companyName || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Legal Status" value={viewRecord.application.legalStatus || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Registration No." value={viewRecord.application.registrationNo || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Nature of Work" value={viewRecord.application.natureOfWork || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Website" value={viewRecord.application.website || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Team Size" value={viewRecord.application.teamSize || "—"} muted={muted} cardText={cardText} />
            </div>

            <SectionLabel letter="D" title="Workspace Requirements" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2 mb-3">
              <DetailRow label="Chairs" value={viewRecord.application.chairs} muted={muted} cardText={cardText} />
              <DetailRow label="Rate / Chair" value={money(viewRecord.application.ratePerChair)} muted={muted} cardText={cardText} />
              <DetailRow label="Duration" value={`${viewRecord.application.duration} month(s)`} muted={muted} cardText={cardText} />
              <DetailRow label="Expected End Date" value={viewRecord.application.expectedEndDate || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Seating" value={viewRecord.application.seating} muted={muted} cardText={cardText} />
              <DetailRow label="Access" value={viewRecord.application.access} muted={muted} cardText={cardText} />
              <DetailRow label="Assigned Chairs" value={viewRecord.application.assignedChairs || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Special Notes" value={viewRecord.application.specialNotes || "—"} muted={muted} cardText={cardText} />
            </div>

            {viewRecord.application.members.filter((m) => m.name).length > 0 && (
              <>
                <SectionLabel letter="E" title="Member / Seat Allocation" muted={muted} />
                <div className={`mt-2 mb-3 rounded-lg border divide-y text-[11px] ${darkMode ? "border-slate-800 divide-slate-800" : "border-slate-100 divide-slate-100"}`}>
                  {viewRecord.application.members.filter((m) => m.name).map((m) => (
                    <div key={m.id} className="px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-1">
                      <span className={cardText}><span className={muted}>Name: </span>{m.name}</span>
                      <span className={cardText}><span className={muted}>CNIC: </span>{m.cnic || "—"}</span>
                      <span className={cardText}><span className={muted}>Phone: </span>{m.phone || "—"}</span>
                      <span className={cardText}><span className={muted}>Chair: </span>{m.chairNo || "—"}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <SectionLabel letter="F" title="Rent & Payment Summary" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2 mb-3">
              <DetailRow label="Monthly Payment" value={money(viewRecord.application.monthlyPayment)} muted={muted} cardText="text-violet-500 font-semibold" />
              <DetailRow label="Subtotal" value={money(viewRecord.application.subtotal)} muted={muted} cardText={cardText} />
              <DetailRow label="Discount %" value={`${viewRecord.application.discountPercent || 0}%`} muted={muted} cardText={cardText} />
              <DetailRow label="Discount Amount" value={money(viewRecord.application.discountAmount)} muted={muted} cardText={cardText} />
              <DetailRow label="Security Deposit" value={money(viewRecord.application.securityDeposit)} muted={muted} cardText={cardText} />
              <DetailRow label="Other Charges" value={money(viewRecord.application.otherCharges)} muted={muted} cardText={cardText} />
              <DetailRow label="Grand Total" value={money(viewRecord.application.grandTotal)} muted={muted} cardText={cardText} />
              <DetailRow label="Payment Method" value={viewRecord.application.paymentMethod || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Transaction No." value={viewRecord.application.transactionNo || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Billing Due Day" value={viewRecord.application.billingDueDay || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Billing Cycle" value={viewRecord.application.billingCycle || "—"} muted={muted} cardText={cardText} />
            </div>

            <SectionLabel letter="G" title="Documents & Emergency Contact" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2 mb-3">
              <DetailRow label="Documents" value={viewRecord.application.documents.join(", ") || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Emergency Contact" value={viewRecord.application.emergencyName || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Relation" value={viewRecord.application.emergencyRelation || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Emergency Phone" value={viewRecord.application.emergencyPhone || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Alt. Phone" value={viewRecord.application.emergencyAltPhone || "—"} muted={muted} cardText={cardText} />
            </div>

            <SectionLabel letter="H·I" title="Terms & Declaration" muted={muted} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11.5px] mt-2">
              <DetailRow label="Terms Agreed" value={viewRecord.application.termsAgreed ? "Yes" : "No"} muted={muted} cardText={cardText} />
              <DetailRow label="Declaration Name" value={viewRecord.application.declarationName || "—"} muted={muted} cardText={cardText} />
              <DetailRow label="Declaration Date" value={viewRecord.application.declarationDate || "—"} muted={muted} cardText={cardText} />
            </div>

            {viewRecord.review && (
              <div className={`mt-3 pt-3 border-t text-[11px] ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
                <p className={`font-semibold mb-1 ${heading}`}>Office Approval & Access Issue</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                  <p className={muted}>Approved by {viewRecord.review.approvedBy || "—"} ({viewRecord.review.approverRole || "—"}) on {viewRecord.review.approvalDate || "—"}</p>
                  <p className={muted}>Designation: {viewRecord.review.designation || "—"}</p>
                  <p className={muted}>Approved Chairs: {viewRecord.review.approvedChairs || "—"} @ {viewRecord.review.approvedRate ? money(viewRecord.review.approvedRate) : "—"}</p>
                  <p className={muted}>Approved Grand Total: {viewRecord.review.approvedGrandTotal ? money(viewRecord.review.approvedGrandTotal) : "—"}</p>
                  <p className={muted}>Chair No(s): {viewRecord.review.chairNos || "—"}</p>
                  <p className={muted}>Access Card No.: {viewRecord.review.accessCardNo || "—"}</p>
                  <p className={muted}>WiFi Issued: {viewRecord.review.wifiIssued ? "Yes" : "No"}</p>
                  <p className={muted}>Effective From: {viewRecord.review.effectiveFrom || "—"}</p>
                </div>
                {viewRecord.review.remarks && <p className={`mt-1 ${muted}`}>Remarks: {viewRecord.review.remarks}</p>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-size lightbox for the photo / CNIC front / CNIC back thumbnails */}
      {zoomImage && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 px-4" onClick={() => setZoomImage(null)}>
          <div className="max-w-2xl w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white text-[12px] font-semibold">{zoomImage.label}</p>
              <button onClick={() => setZoomImage(null)} className="text-white">
                <X size={20} />
              </button>
            </div>
            <img src={zoomImage.url} alt={zoomImage.label} className="w-full max-h-[75vh] object-contain rounded-lg bg-black" />
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-[80] max-w-xs rounded-lg px-4 py-3 shadow-xl text-[12px] font-medium flex items-center gap-2 ${
            toast.type === "error" ? "bg-rose-600 text-white" : "bg-emerald-600 text-white"
          }`}
        >
          {toast.type === "error" ? <XCircle size={15} /> : <CheckCircle2 size={15} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Small presentational helpers                                        */
/* ------------------------------------------------------------------ */
function SectionLabel({ letter, title, muted }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <span className="w-5 h-5 rounded bg-gradient-to-br from-violet-600 to-indigo-600 text-white text-[9.5px] font-bold flex items-center justify-center shrink-0">{letter}</span>
      <p className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>{title}</p>
    </div>
  );
}

function Field({ label, children, full, error }) {
  return (
    <div className={full ? "col-span-2 sm:col-span-full" : ""}>
      <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{label}</label>
      {children}
      {error && (
        <p className="flex items-center gap-1 text-[10px] font-medium text-rose-500 mt-1">
          <AlertCircle size={10} className="shrink-0" /> {error}
        </p>
      )}
    </div>
  );
}

function MiniStat({ label, value, muted, heading }) {
  return (
    <div>
      <p className={`text-[9.5px] font-medium ${muted}`}>{label}</p>
      <p className={`text-[13px] font-bold ${heading}`}>{value}</p>
    </div>
  );
}

function DetailRow({ label, value, children, muted, cardText }) {
  return (
    <div>
      <p className={`text-[9.5px] font-medium ${muted}`}>{label}</p>
      {children || <p className={`font-medium ${cardText}`}>{value}</p>}
    </div>
  );
}

// Thumbnail for the applicant photo / CNIC front / CNIC back in the View
// record modal. `src` is an authenticated blob object-URL (or null while
// it's still loading, or if the applicant never uploaded that file).
function ViewFileThumb({ label, src, loading, available, onZoom, darkMode, subtle }) {
  return (
    <div>
      <button
        type="button"
        onClick={onZoom}
        disabled={!src}
        className={`w-full aspect-[4/3] rounded-lg overflow-hidden border flex items-center justify-center ${
          darkMode ? "border-slate-700 bg-slate-800/50" : "border-slate-200 bg-slate-50"
        } ${src ? "cursor-zoom-in hover:opacity-90" : ""}`}
        title={src ? `View ${label}` : undefined}
      >
        {src ? (
          <img src={src} alt={label} className="w-full h-full object-cover" />
        ) : (
          <span className={`text-[9.5px] text-center px-2 ${subtle}`}>
            {loading ? "Loading…" : available ? "Couldn't load" : "Not uploaded"}
          </span>
        )}
      </button>
      <p className={`text-[9.5px] text-center mt-1 ${subtle}`}>{label}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    Pending: "bg-amber-500/15 text-amber-500",
    Approved: "bg-emerald-500/15 text-emerald-500",
    Rejected: "bg-rose-500/15 text-rose-500",
  };
  return <span className={`px-2 py-1 rounded-full text-[10px] font-semibold ${map[status] || map.Pending}`}>{status}</span>;
}

/* Office Approval & Access Issue — Section J, shown per-record.
   Admin sees the full decision form; Manager sees a read-only summary
   plus the Payment Tracking section (can view + mark payments received). */
function ReviewPanel({ record, darkMode, inputBase, labelBase, muted, isAdmin, onSave, onRecordPayment }) {
  const [review, setReview] = useState(
    record.review || {
      decision: "Pending",
      approverRole: "Admin",
      approvedBy: "",
      designation: "",
      approvalDate: new Date().toISOString().slice(0, 10),
      approvedChairs: record.application.chairs,
      approvedRate: record.application.ratePerChair,
      discount: record.application.discountAmount,
      deposit: record.application.securityDeposit,
      approvedGrandTotal: record.application.grandTotal,
      chairNos: record.application.assignedChairs,
      accessCardNo: "",
      wifiIssued: false,
      effectiveFrom: record.application.startDate,
      remarks: "",
    }
  );
  const [monthInputs, setMonthInputs] = useState({}); // { [monthKey]: string }
  const set = (key) => (e) => setReview((r) => ({ ...r, [key]: e && e.target ? (e.target.type === "checkbox" ? e.target.checked : e.target.value) : e }));

  const duration = Number(record.application.duration) || 1;
  const monthlyDue = Number(record.application.monthlyPayment) || 0;
  // The server sends the billing calendar it validates payments against.
  const months = record.billingMonths?.length
    ? record.billingMonths
    : monthKeysFrom(record.review?.effectiveFrom || record.application.startDate || record.submittedAt, duration);
  const paymentsByMonth = (record.payments || []).reduce((acc, p) => {
    const key = p.month || "unassigned";
    acc[key] = (acc[key] || 0) + Number(p.amount || 0);
    return acc;
  }, {});
  const totalDue = monthlyDue * duration;
  const totalPaid = Object.values(paymentsByMonth).reduce((s, v) => s + v, 0);

  function submitMonthPayment(monthKey, remainingDue) {
    const raw = monthInputs[monthKey];
    const amt = raw && raw !== "" ? raw : String(remainingDue);
    onRecordPayment(amt, monthKey);
    setMonthInputs((m) => ({ ...m, [monthKey]: "" }));
  }

  return (
    <div className="pt-3 space-y-3">
      {isAdmin ? (
        <>
          <p className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>J. Office Approval & Access Issue — Office Use Only</p>
          <div className="flex flex-wrap gap-2">
            {["Approved", "Pending", "Rejected"].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setReview((r) => ({ ...r, decision: d }))}
                className={`px-3 py-1.5 rounded-full text-[10.5px] font-semibold border ${
                  review.decision === d
                    ? d === "Approved"
                      ? "bg-emerald-500 text-white border-transparent"
                      : d === "Rejected"
                      ? "bg-rose-500 text-white border-transparent"
                      : "bg-amber-500 text-white border-transparent"
                    : darkMode
                    ? "border-slate-700 text-slate-300"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div>
              <span className={labelBase}>Approver Role</span>
              <select className={inputBase} value={review.approverRole} onChange={set("approverRole")}>
                {APPROVER_ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <span className={labelBase}>Approved By</span>
              <input className={inputBase} value={review.approvedBy} onChange={set("approvedBy")} />
            </div>
            <div>
              <span className={labelBase}>Designation</span>
              <input className={inputBase} value={review.designation} onChange={set("designation")} />
            </div>
            <div>
              <span className={labelBase}>Approval Date</span>
              <input type="date" className={inputBase} value={review.approvalDate} onChange={set("approvalDate")} />
            </div>
            <div>
              <span className={labelBase}>Approved Chairs</span>
              <input type="number" className={inputBase} value={review.approvedChairs} onChange={set("approvedChairs")} />
            </div>
            <div>
              <span className={labelBase}>Approved Rate / Chair</span>
              <input type="number" className={inputBase} value={review.approvedRate} onChange={set("approvedRate")} />
            </div>
            <div>
              <span className={labelBase}>Discount</span>
              <input type="number" className={inputBase} value={review.discount} onChange={set("discount")} />
            </div>
            <div>
              <span className={labelBase}>Deposit</span>
              <input type="number" className={inputBase} value={review.deposit} onChange={set("deposit")} />
            </div>
            <div>
              <span className={labelBase}>Approved Grand Total</span>
              <input type="number" className={inputBase} value={review.approvedGrandTotal} onChange={set("approvedGrandTotal")} />
            </div>
            <div>
              <span className={labelBase}>Chair / Workstation No(s).</span>
              <input className={inputBase} value={review.chairNos} onChange={set("chairNos")} />
            </div>
            <div>
              <span className={labelBase}>Access Card / Key No.</span>
              <input className={inputBase} value={review.accessCardNo} onChange={set("accessCardNo")} />
            </div>
            <div>
              <span className={labelBase}>Effective From</span>
              <input type="date" className={inputBase} value={review.effectiveFrom} onChange={set("effectiveFrom")} />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={review.wifiIssued} onChange={set("wifiIssued")} className="w-4 h-4 accent-violet-600" />
            <span className={`text-[11px] font-medium ${muted}`}>WiFi / Access Issued</span>
          </label>
          <div>
            <span className={labelBase}>Approval Remarks / Special Conditions</span>
            <textarea rows={2} className={inputBase} value={review.remarks} onChange={set("remarks")} />
          </div>
          <button
            type="button"
            onClick={() => onSave(review)}
            className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 text-white rounded-lg px-4 py-2 text-[11px] font-semibold hover:opacity-90"
          >
            <BadgeCheck size={14} /> Save Decision
          </button>
        </>
      ) : (
        <div className="flex items-center justify-between">
          <p className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Office Approval Status</p>
          <StatusBadge status={record.status} />
        </div>
      )}

      {!isAdmin && record.status !== "Approved" && (
        <p className={`text-[11px] ${muted}`}>Waiting for admin approval before payment can be recorded.</p>
      )}

      {record.status === "Approved" && (
        <div className={`pt-3 mt-1 border-t space-y-2.5 ${darkMode ? "border-slate-800" : "border-slate-100"}`}>
          <div className="flex items-center justify-between">
            <p className={`text-[10.5px] font-bold uppercase tracking-wide ${muted}`}>Payment Tracking — Month by Month</p>
            <span className={`text-[10.5px] font-semibold ${totalPaid >= totalDue ? "text-emerald-500" : "text-amber-500"}`}>
              {money(totalPaid)} / {money(totalDue)}
            </span>
          </div>

          <div className="space-y-1.5">
            {months.map((mKey) => {
              const paidThisMonth = paymentsByMonth[mKey] || 0;
              const remainingThisMonth = Math.max(monthlyDue - paidThisMonth, 0);
              const isPaid = remainingThisMonth <= 0;
              return (
                <div key={mKey} className={`rounded-lg px-2.5 py-2 ${darkMode ? "bg-slate-800/50" : "bg-slate-50"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[11px] font-semibold ${darkMode ? "text-slate-200" : "text-slate-800"}`}>{monthLabel(mKey)}</span>
                    {isPaid ? (
                      <span className="flex items-center gap-1 text-[10.5px] font-semibold text-emerald-500">
                        <CheckCircle2 size={12} /> Paid
                      </span>
                    ) : (
                      <span className="text-[10.5px] font-semibold text-amber-500">
                        {paidThisMonth > 0 ? `${money(remainingThisMonth)} left` : `${money(remainingThisMonth)} due`}
                      </span>
                    )}
                  </div>
                  {!isPaid && (
                    <div className="flex gap-2 mt-1.5">
                      <input
                        type="number"
                        min="1"
                        max={remainingThisMonth}
                        placeholder={`Tick as-is for ${money(remainingThisMonth)}`}
                        className={inputBase}
                        value={monthInputs[mKey] ?? ""}
                        onChange={(e) => setMonthInputs((m) => ({ ...m, [mKey]: e.target.value }))}
                      />
                      <button
                        type="button"
                        onClick={() => submitMonthPayment(mKey, remainingThisMonth)}
                        className="flex items-center justify-center gap-1.5 bg-emerald-600 text-white rounded-lg px-3 py-2 text-[10.5px] font-semibold hover:opacity-90 shrink-0"
                      >
                        <CheckCircle2 size={13} /> Tick
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  WIRE-UP NOTES (do this inside Dashboard.jsx)                        */
/* ------------------------------------------------------------------ */
/*
1. Import it near the other page imports:
     import CoworkingSpacePage from "./CoworkingSpacePage";

2. Add it to NAV_ITEMS (pick any icon already imported, e.g. Armchair —
   add Armchair to the lucide-react import list at the top of Dashboard.jsx):
     { label: "Coworking Space", icon: Armchair },

3. Render it next to the other `active === "..."` lines, e.g.:
     {active === "Coworking Space" && <CoworkingSpacePage darkMode={darkMode} onNavigate={setActive} />}

4. If your AuthContext.jsx's getAllowedPages() whitelists pages per role,
   add "Coworking Space" to whichever roles should see it (e.g. admin/manager).

No other changes are needed — the sidebar, topbar, dark-mode toggle and
notification bell you already have will apply to this page automatically,
exactly like Sales, Clients or Projects do today.
*/