import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { API_ROOT } from "../apiConfig.js";
import {
  User,
  MapPin,
  GraduationCap,
  Briefcase,
  Languages,
  Sparkles,
  CreditCard,
  Landmark,
  UploadCloud,
  FileText,
  Plus,
  Trash2,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  ShieldCheck,
  Phone,
  Calendar,
  Building2,
  AlertCircle,
  Code2,
  Camera,
} from "lucide-react";
import BrandImg from "../components/BrandImg.jsx";

/* ----------------------------------------------------------------------
   REAL BACKEND CALL — POST /api/auth/complete-profile/ as multipart
   form-data (the CV file rules out a plain JSON body). Reads the saved
   auth token directly from localStorage the same way AuthContext.jsx's
   apiFetch() does, since apiFetch itself always forces a JSON
   Content-Type header, which would break the file upload here.
---------------------------------------------------------------------- */

const API_BASE_URL = `${API_ROOT}/api/auth`;

async function submitProfile(formData) {
  const token = localStorage.getItem("hopenix_auth_token");
  const res = await fetch(`${API_BASE_URL}/complete-profile/`, {
    method: "POST",
    headers: token ? { Authorization: `Token ${token}` } : {},
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error || Object.values(data)[0] || "Could not submit your profile. Please try again.";
    throw new Error(Array.isArray(message) ? message[0] : String(message));
  }
  return data;
}

/* ===========================================================================
   CompleteProfilePage — shown right after registration, before the account
   goes to "pending approval". Collects everything an admin needs to review
   the applicant: personal info, address, education, experience, skills /
   work type, languages, CV, and bank details for salary. Same visual
   language as RegisterPage.jsx: dark canvas, violet accents, rounded-3xl
   card, #121022 inputs with #2a2740 borders.

   VALIDATION:
   - Every step is fully gated: the Next / Submit button is disabled until
     every required field on that step is filled in and passes its format
     check — not just checked on click.
   - EVERY required field (not just the format-checked ones) shows its own
     red error message + red border the moment the user leaves it blank
     (on blur), or immediately if they try to hit Next/Submit while it's
     still incomplete — so nothing "silently" blocks the button; the user
     always sees exactly what's missing.
   - CNIC, phone, IBAN, and bank account number are validated for real,
     well-formed values (correct digit counts / checksums / not obviously
     fake patterns), not just "not empty" — see the validators block below.
   - CV upload is COMPULSORY — the "Skills & Work" step cannot be passed
     (Next stays disabled) until a valid CV file has been selected. The
     file is also checked for type/size so garbage uploads are rejected
     immediately. This is a sanity check only — it doesn't verify the CV's
     actual content; that's still part of admin review.
   =========================================================================== */

const STEPS = [
  { id: "personal", label: "Personal", icon: User },
  { id: "address", label: "Address", icon: MapPin },
  { id: "background", label: "Education & Experience", icon: GraduationCap },
  { id: "skills", label: "Skills & Work", icon: Sparkles },
  { id: "documents", label: "Bank Details", icon: ShieldCheck },
];

const WORK_TYPES = [
  "Frontend Development",
  "Backend Development",
  "Full Stack Development",
  "Web Development",
  "Mobile App Development",
  "WordPress Development",
  "Game Development",
  "DevOps / Cloud",
  "QA / Software Testing",
  "Graphic Design",
  "UI / UX Design",
  "Video Editing",
  "SEO (Search Engine Optimization)",
  "Digital Marketing",
  "Social Media Marketing",
  "Content Writing",
  "Copywriting",
  "Accounting & Finance",
  "Sales",
  "Customer Support",
  "Project Management",
  "Data Entry",
  "HR & Admin",
];

const LANGUAGES = ["English", "Urdu", "Punjabi", "Pashto", "Sindhi", "Arabic"];

// Programming / technical languages & tools — a separate chip-select list
// from the spoken LANGUAGES above, for applicants applying to dev roles.
// Fully optional, same pattern as Work Type / Languages toggles.
const PROGRAMMING_LANGUAGES = [
  "HTML",
  "CSS",
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "PHP",
  "C",
  "C++",
  "C#",
  "SQL",
  "React",
  "Node.js",
  "Swift",
  "Kotlin",
  "Ruby",
  "Go",
  "Dart / Flutter",
];

// Total years of experience — a single, quick-pick summary field that sits
// alongside the detailed per-company Work Experience list below. Fully
// optional, same as the rest of the "background" step's experience data.
const EXPERIENCE_LEVELS = [
  "Fresher / No experience",
  "Less than 1 year",
  "1 - 2 years",
  "3 - 5 years",
  "5 - 10 years",
  "10+ years",
];

const emptyEducation = () => ({
  id: crypto.randomUUID(),
  degree: "",
  institute: "",
  year: "",
  grade: "",
});

const emptyExperience = () => ({
  id: crypto.randomUUID(),
  company: "",
  role: "",
  duration: "",
  description: "",
});

/* =============================== validators =============================
   Real format/checksum validation — not just "field is non-empty".
   ========================================================================= */

/* Generic "this field is required" check, reused for every plain-text /
   select / date field so each one gets its own red message instead of
   only a single generic error at the bottom of the step. */
function requiredError(value, label) {
  if (!value || !String(value).trim()) return `${label} is required.`;
  return "";
}

/* CNIC — Pakistani ID card number, always 13 digits, conventionally shown
   as 5-7-1 (e.g. 42101-1234567-1). We store/display it pre-formatted with
   dashes as the user types, and only accept it once all 13 digits are in.
   There's no public checksum algorithm for CNIC (unlike IBAN), so on top
   of the digit-count check we reject obviously-fake patterns: all-zero,
   all-the-same-digit, and simple ascending/descending runs. This won't
   catch every fake number, but it stops the "1111111111111" / "0000..."
   style placeholders people type to skip the field. */
function formatCNIC(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 13);
  const p1 = digits.slice(0, 5);
  const p2 = digits.slice(5, 12);
  const p3 = digits.slice(12, 13);
  return [p1, p2, p3].filter(Boolean).join("-");
}
function cnicError(value) {
  if (!value) return "CNIC number is required.";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13) return `Enter the full 13-digit CNIC number (${digits.length}/13 digits so far).`;
  if (digits.length > 13) return "CNIC number should only contain 13 digits.";
  if (/^(\d)\1{12}$/.test(digits)) return "Enter a valid CNIC number — this doesn't look like a real one.";
  const ascendingRun = "01234567890123";
  const descendingRun = "98765432109876";
  if (ascendingRun.includes(digits) || descendingRun.includes(digits)) {
    return "Enter a valid CNIC number — this doesn't look like a real one.";
  }
  return "";
}

/* Phone — Pakistani mobile format: 03xx-xxxxxxx (11 digits total,
   starting with 03). */
function formatPhone(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  const p1 = digits.slice(0, 4);
  const p2 = digits.slice(4, 11);
  return [p1, p2].filter(Boolean).join("-");
}
function phoneError(value, { optional = false } = {}) {
  if (!value) return optional ? "" : "Phone number is required.";
  const digits = value.replace(/\D/g, "");
  if (!digits) return optional ? "" : "Phone number is required.";
  if (!digits.startsWith("03")) return "Mobile number must start with 03 (e.g. 0300-1234567).";
  if (digits.length < 11) return `Enter the full 11-digit number (${digits.length}/11 digits so far).`;
  if (digits.length > 11) return "Mobile number should only contain 11 digits.";
  if (/^(\d)\1{10}$/.test(digits)) return "Enter a valid mobile number — this doesn't look like a real one.";
  return "";
}

/* IBAN — real mod-97 checksum validation (the actual algorithm banks use
   to detect a mistyped IBAN — ISO 7064 MOD97-10), plus a Pakistan-specific
   length check (PK IBANs are always exactly 24 characters: PK + 2 check
   digits + 4-letter bank code + 16-digit account number). */
function formatIBAN(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 34);
}
function ibanChecksumValid(iban) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const converted = rearranged
    .split("")
    .map((ch) => (/[0-9]/.test(ch) ? ch : (ch.charCodeAt(0) - 55).toString()))
    .join("");
  let remainder = converted;
  while (remainder.length > 2) {
    const chunk = remainder.slice(0, 9);
    remainder = String(parseInt(chunk, 10) % 97) + remainder.slice(chunk.length);
  }
  return parseInt(remainder, 10) % 97 === 1;
}
function ibanError(value) {
  if (!value) return ""; // optional field
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (iban.startsWith("PK") && iban.length !== 24) {
    return `Pakistani IBAN must be 24 characters (currently ${iban.length}).`;
  }
  if (iban.length < 15 || iban.length > 34) return "IBAN length looks incorrect.";
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) {
    return "IBAN must start with a 2-letter country code and 2 check digits (e.g. PK36...).";
  }
  if (!ibanChecksumValid(iban)) return "This IBAN doesn't check out — please re-check the digits.";
  return "";
}

/* Cross-check: if both an account number and an IBAN are provided, the
   account number should actually appear inside the IBAN's numeric
   portion (that's how PK IBANs are constructed — bank code + account
   number). Catches copy-paste mistakes / mismatched details. */
function accountIbanMismatchError(accountNumber, iban) {
  if (!accountNumber || !iban) return "";
  const accDigits = accountNumber.replace(/\D/g, "");
  const ibanDigits = iban.replace(/[^0-9]/g, "");
  if (accDigits.length >= 5 && ibanDigits && !ibanDigits.includes(accDigits)) {
    return "This account number doesn't appear to match the IBAN you entered.";
  }
  return "";
}

/* Bank account number — digits only, realistic length range, and reject
   obviously-fake repeated-digit numbers the same way we do for CNIC. Note:
   there's no universal public checksum for Pakistani bank account numbers
   (each bank has its own internal scheme), so this is format validation —
   confirming the account actually exists/belongs to the applicant still
   needs a real bank-side verification (e.g. title-match via 1Link/RAAST)
   during admin review. */
function formatAccountNumber(raw) {
  return raw.replace(/[^\d-]/g, "").slice(0, 24);
}
function accountNumberError(value) {
  if (!value) return "Account number is required.";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 5) return "Account number looks too short.";
  if (digits.length > 20) return "Account number looks too long.";
  if (/^(\d)\1+$/.test(digits)) return "Enter a valid account number — this doesn't look like a real one.";
  return "";
}

/* Uploaded CV — type/size sanity checks. This only stops empty, corrupt,
   wrong-format, or absurdly tiny/huge uploads from going through; it does
   NOT verify the CV's actual content. The CV is compulsory: see cvFile in
   the errors object below, which reports "required" when no file has been
   chosen at all, separately from this format check. */
const MAX_FILE_MB = 5;
const CV_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
function cvFileErrorCheck(file) {
  if (!file) return "";
  if (!CV_TYPES.includes(file.type)) return "Please upload a PDF or Word document (.pdf, .doc, .docx).";
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `File is too large — keep it under ${MAX_FILE_MB}MB.`;
  if (file.size < 2 * 1024) return "This file looks empty or corrupted — please upload a valid CV.";
  return "";
}

/* Profile photo — same size-sanity approach as the CV check above, but
   restricted to actual image types since this is the picture shown next
   to the applicant's name everywhere in the app (Users table, user
   detail card, access modal, etc. — see Avatar() in UserPage.jsx, which
   already renders any data:/blob: avatar URL it's given). Compulsory:
   see profilePhoto in the errors object below. */
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
function profilePhotoErrorCheck(file) {
  if (!file) return "";
  if (!PHOTO_TYPES.includes(file.type)) return "Please upload a JPG, PNG or WEBP image.";
  if (file.size > MAX_FILE_MB * 1024 * 1024) return `File is too large — keep it under ${MAX_FILE_MB}MB.`;
  if (file.size < 1024) return "This file looks empty or corrupted — please upload a valid photo.";
  return "";
}

/* Education / experience entries — every row that exists must be complete
   (or removed). Experience as a whole stays optional, but a half-filled
   row isn't allowed to slide through. */
function educationEntryError(edu) {
  if (!edu.degree.trim() || !edu.institute.trim() || !edu.year.trim()) {
    return "Please complete degree, institute and year for every qualification (or remove the row).";
  }
  return "";
}
function experienceEntryError(exp) {
  const hasAny = exp.company.trim() || exp.role.trim() || exp.duration.trim() || exp.description.trim();
  if (!hasAny) return ""; // untouched blank row is fine — treated as "no experience"
  if (!exp.company.trim() || !exp.role.trim() || !exp.duration.trim()) {
    return "Please complete company, role and duration for every experience entry (or remove the row).";
  }
  return "";
}

/* ---------------------------- shared bits ---------------------------- */

function Field({ label, icon: Icon, children, optional, hint, error }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-slate-200">
          {label} {optional && <span className="text-slate-500 font-normal">(Optional)</span>}
        </label>
        {hint && !error && <span className="text-[11px] text-slate-500">{hint}</span>}
      </div>
      <div className="relative">
        {Icon && <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />}
        {children}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400 mt-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

const inputCls =
  "w-full bg-[#121022] border border-[#2a2740] rounded-xl py-3 pl-4 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition";
const inputWithIconCls = inputCls.replace("pl-4", "pl-11");
const inputErrorCls =
  "border-rose-500/60 focus:border-rose-500 focus:ring-rose-500/60";

function TextInput({ icon, hasError, ...props }) {
  const base = icon ? inputWithIconCls : inputCls;
  return <input {...props} className={`${base} ${hasError ? inputErrorCls : ""}`} />;
}

function TextArea({ icon, hasError, ...props }) {
  const base = icon ? inputWithIconCls : inputCls;
  return <textarea {...props} className={`${base} ${hasError ? inputErrorCls : ""} resize-none`} />;
}

function SectionCard({ title, subtitle, children }) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-semibold text-base">{title}</h3>
        {subtitle && <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function FileDropBox({ label, file, onFile, accept, icon: Icon = UploadCloud, preview, error, onBlur }) {
  const inputRef = useRef(null);
  return (
    <div>
      <label className="block text-sm font-medium text-slate-200 mb-2">{label}</label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onBlur={onBlur}
        className={`w-full border border-dashed ${
          error ? "border-rose-500/60" : "border-[#2a2740] hover:border-violet-500/60"
        } bg-[#121022] rounded-xl p-4 flex items-center gap-3 text-left transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-0`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0] || null);
            // allow re-selecting the same file after a rejection
            e.target.value = "";
          }}
        />
        <span className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-violet-900/40 border border-violet-500/20 flex items-center justify-center overflow-hidden">
          {preview ? (
            <img src={preview} alt="" className="w-full h-full object-cover" />
          ) : (
            <Icon className="w-4.5 h-4.5 text-violet-300" />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-sm text-slate-200 truncate">
            {file ? file.name : "Click to upload"}
          </span>
          <span className="block text-[11px] text-slate-500">
            {file ? `${(file.size / 1024).toFixed(0)} KB` : "PNG, JPG or PDF, up to 5MB"}
          </span>
        </span>
        {file && !error && <CheckCircle2 className="ml-auto w-4 h-4 text-emerald-400 shrink-0" />}
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400 mt-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/* Circular avatar-style uploader for the compulsory profile photo — kept
   visually distinct from FileDropBox (CV) since this preview needs to
   read like a profile picture (round, front-and-center) rather than a
   generic file row. Same click-to-open-file-input / error pattern. */
function ProfilePhotoUpload({ file, previewUrl, onFile, onBlur, error }) {
  const inputRef = useRef(null);
  return (
    <div className="flex flex-col items-center mb-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0] || null);
          // allow re-selecting the same file after a rejection
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onBlur={onBlur}
        className={`relative w-24 h-24 rounded-full overflow-hidden flex items-center justify-center border-2 ${
          error ? "border-rose-500/60" : "border-[#2a2740] hover:border-violet-500/60"
        } bg-[#121022] transition outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-0`}
      >
        {previewUrl ? (
          <img src={previewUrl} alt="Profile preview" className="w-full h-full object-cover" />
        ) : (
          <User className="w-9 h-9 text-slate-500" />
        )}
        <span className="absolute bottom-0 inset-x-0 bg-black/60 py-1 flex items-center justify-center">
          <Camera className="w-3.5 h-3.5 text-white" />
        </span>
      </button>
      <span className="text-xs text-slate-400 mt-2">
        {file ? file.name : "Upload profile photo (required)"}
      </span>
      {error && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400 mt-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

function StepIndicator({ activeIndex }) {
  return (
    <div className="flex items-center gap-1.5 sm:gap-2 mb-7 overflow-x-auto pb-1">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
        return (
          <div key={step.id} className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div
              className={`w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center border transition ${
                state === "active"
                  ? "bg-gradient-to-br from-violet-600 to-fuchsia-500 border-transparent text-white"
                  : state === "done"
                  ? "bg-violet-600/20 border-violet-500/50 text-violet-300"
                  : "bg-[#121022] border-[#2a2740] text-slate-500"
              }`}
              title={step.label}
            >
              {state === "done" ? <CheckCircle2 className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px w-4 sm:w-8 ${i < activeIndex ? "bg-violet-500/60" : "bg-[#2a2740]"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// AuthContext persists everything to localStorage as plain JSON, so files
// (ID card photos, CV) are stored the same way the avatar already is
// elsewhere in this app: as a base64 data URL on the user record. Large
// files can hit localStorage's ~5-10MB quota (see AuthContext's own
// warning on this) - keep uploads reasonably small.
function fileToDataUrl(file) {
  if (!file) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------- page ------------------------------- */

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [stepIndex, setStepIndex] = useState(0);
  // Always show each step from the top (on first open and every Next / Back),
  // so on mobile the person doesn't land halfway down the page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const toTop = () => {
      window.scrollTo(0, 0);
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    };
    toTop();
    const raf = requestAnimationFrame(toTop);
    return () => cancelAnimationFrame(raf);
  }, [stepIndex]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Tracks which fields the user has actually interacted with, so format
  // errors (e.g. "CNIC must be 13 digits") only show up once they've
  // started typing / left the field — not the instant the step loads.
  const [touched, setTouched] = useState({});
  const touch = (key) => setTouched((t) => ({ ...t, [key]: true }));

  // Once a user tries to leave a step (Next/Submit) while it's still
  // incomplete, we mark that step as "attempted" so EVERY required field
  // on it shows its red error immediately — not just the ones they've
  // individually blurred. This is what makes "can't submit until every
  // field is actually complete, and the user can see exactly what's
  // missing in red" work reliably instead of only showing one generic
  // message at the bottom.
  const [attemptedSteps, setAttemptedSteps] = useState({});

  // File-upload rejection messages (wrong type / too big / too small) live
  // separately from the "errors" derived object below, because a rejected
  // file is never stored in `form` in the first place.
  const [fileErrors, setFileErrors] = useState({ cv: "", photo: "" });

  // Object URL for the live preview shown in ProfilePhotoUpload. Kept
  // separate from `form.profilePhoto` (the actual File) since the <img>
  // src needs a browser URL, not the File object itself. Revoked below
  // whenever it changes/unmounts so we don't leak blob URLs.
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState(null);
  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  // Route guard: this page only makes sense for someone who just signed
  // up and hasn't been reviewed yet. No session -> back to login. Already
  // approved -> straight to the dashboard, nothing to complete. Rejected
  // -> back to login, where that status can be surfaced. Already
  // submitted their details once -> skip straight to the waiting screen
  // instead of making them fill the form again.
  useEffect(() => {
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    if (user.status === "approved") {
      navigate("/dashboard", { replace: true });
      return;
    }
    if (user.status === "rejected") {
      navigate("/login", { replace: true });
      return;
    }
    if (user.profileCompleted) {
      navigate("/pending-approval", { replace: true });
    }
  }, [user, navigate]);

  const [form, setForm] = useState({
    profilePhoto: null,
    fatherName: "",
    dob: "",
    gender: "",
    maritalStatus: "",
    phone: "",
    cnic: "",
    currentAddress: "",
    permanentAddress: "",
    city: "",
    country: "",
    emergencyContact: "",
    education: [emptyEducation()],
    totalExperience: "",
    experience: [emptyExperience()],
    workTypes: [],
    languages: [],
    programmingLanguages: [],
    skillsInput: "",
    skills: [],
    cvFile: null,
    bankName: "",
    accountTitle: "",
    accountNumber: "",
    iban: "",
    branchCode: "",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const setCvFile = (file) => {
    touch("cvFile");
    const err = cvFileErrorCheck(file);
    setFileErrors((fe) => ({ ...fe, cv: err }));
    if (err) return;
    set("cvFile", file);
  };

  const setProfilePhoto = (file) => {
    touch("profilePhoto");
    const err = profilePhotoErrorCheck(file);
    setFileErrors((fe) => ({ ...fe, photo: err }));
    if (err) return;
    set("profilePhoto", file);
    setPhotoPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const toggleFromList = (key, value) => {
    touch(key);
    setForm((f) => {
      const has = f[key].includes(value);
      return { ...f, [key]: has ? f[key].filter((v) => v !== value) : [...f[key], value] };
    });
  };

  const addSkill = () => {
    const val = form.skillsInput.trim();
    if (!val) return;
    if (!form.skills.includes(val)) set("skills", [...form.skills, val]);
    set("skillsInput", "");
  };

  const removeSkill = (val) => set("skills", form.skills.filter((s) => s !== val));

  const updateListItem = (key, id, field, value) => {
    setForm((f) => ({
      ...f,
      [key]: f[key].map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    }));
  };

  const addListItem = (key, makeEmpty) =>
    setForm((f) => ({ ...f, [key]: [...f[key], makeEmpty()] }));

  const removeListItem = (key, id) =>
    setForm((f) => ({ ...f, [key]: f[key].filter((item) => item.id !== id) }));

  /* Live field-by-field errors — every required field gets its own entry
     here now, not just the format-validated ones. This is what lets each
     field show its own red message instead of one generic step-level
     message at the bottom. */
  const errors = {
    profilePhoto: !form.profilePhoto
      ? "Profile photo is required — please upload a clear photo of yourself."
      : fileErrors.photo || "",
    fatherName: requiredError(form.fatherName, "Father / Guardian name"),
    dob: requiredError(form.dob, "Date of birth"),
    gender: requiredError(form.gender, "Gender"),
    maritalStatus: requiredError(form.maritalStatus, "Marital status"),
    phone: phoneError(form.phone),
    cnic: cnicError(form.cnic),
    currentAddress: requiredError(form.currentAddress, "Current address"),
    city: requiredError(form.city, "City"),
    country: requiredError(form.country, "Country"),
    emergencyContact: phoneError(form.emergencyContact),
    workTypes: form.workTypes.length === 0 ? "Select at least one type of work you can do." : "",
    languages: form.languages.length === 0 ? "Select at least one language." : "",
    cvFile: !form.cvFile ? "CV / Resume is required — please upload your CV to continue." : fileErrors.cv || "",
    bankName: requiredError(form.bankName, "Bank name"),
    accountTitle: requiredError(form.accountTitle, "Account title"),
    accountNumber: accountNumberError(form.accountNumber),
    iban: ibanError(form.iban) || accountIbanMismatchError(form.accountNumber, form.iban),
  };

  const educationErrors = form.education.map(educationEntryError);
  const experienceErrors = form.experience.map(experienceEntryError);

  const currentStepId = STEPS[stepIndex].id;

  // A field's red error only shows once the user has actually left it
  // (touched) OR they tried to move past this step while it was still
  // incomplete (attemptedSteps) — so the form doesn't look broken/red
  // the instant a fresh step loads, but nothing incomplete can hide once
  // Next has been pressed.
  const fieldError = (name) =>
    touched[name] || attemptedSteps[currentStepId] ? errors[name] : "";

  /* Full per-step gate: returns an error string ("" means the step is
     complete and valid). Used both to block Next/Submit on click AND to
     disable the button proactively, so users can't skip ahead at all. */
  const validateStep = () => {
    const s = currentStepId;

    if (s === "personal") {
      return errors.profilePhoto || errors.fatherName || errors.dob || errors.gender || errors.maritalStatus || errors.phone || errors.emergencyContact || errors.cnic || "";
    }

    if (s === "address") {
      return errors.currentAddress || errors.city || errors.country || "";
    }

    if (s === "background") {
      const eduErr = educationErrors.find(Boolean);
      if (eduErr) return eduErr;
      const expErr = experienceErrors.find(Boolean);
      if (expErr) return expErr;
      return "";
    }

    if (s === "skills") {
      return errors.workTypes || errors.languages || errors.cvFile || "";
    }

    if (s === "documents") {
      return (
        errors.bankName ||
        errors.accountTitle ||
        errors.accountNumber ||
        errors.iban ||
        ""
      );
    }

    return "";
  };

  const stepError = validateStep();
  const isStepValid = !stepError;

  const touchStepFields = () => {
    const s = currentStepId;
    if (s === "personal") {
      touch("profilePhoto");
      touch("fatherName");
      touch("dob");
      touch("gender");
      touch("maritalStatus");
      touch("phone");
      touch("emergencyContact");
      touch("cnic");
    }
    if (s === "address") {
      touch("currentAddress");
      touch("city");
      touch("country");
    }
    if (s === "skills") {
      touch("workTypes");
      touch("languages");
      touch("cvFile");
    }
    if (s === "documents") {
      touch("bankName");
      touch("accountTitle");
      touch("accountNumber");
      touch("iban");
    }
  };

  const goNext = () => {
    // Mark every field on this step as touched so any format errors are
    // visible if the user tries to skip past them.
    touchStepFields();

    if (stepError) {
      setAttemptedSteps((a) => ({ ...a, [currentStepId]: true }));
      setError(stepError);
      return;
    }
    setError("");
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError("");
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  // Validates every step, not just the current one — protects against a
  // user submitting from the last step after having, e.g., navigated back
  // and broken data on an earlier step (which can't happen via the UI
  // today since Next is gated, but keeps handleSubmit safe on its own).
  const validateAllSteps = () => {
    for (let i = 0; i < STEPS.length; i++) {
      const s = STEPS[i].id;
      if (s === "personal") {
        const e = errors.profilePhoto || errors.fatherName || errors.dob || errors.gender || errors.maritalStatus || errors.phone || errors.emergencyContact || errors.cnic;
        if (e) return { index: i, message: e };
      }
      if (s === "address") {
        const e = errors.currentAddress || errors.city || errors.country;
        if (e) return { index: i, message: e };
      }
      if (s === "background") {
        const eduErr = educationErrors.find(Boolean);
        if (eduErr) return { index: i, message: eduErr };
        const expErr = experienceErrors.find(Boolean);
        if (expErr) return { index: i, message: expErr };
      }
      if (s === "skills") {
        const e = errors.workTypes || errors.languages || errors.cvFile;
        if (e) return { index: i, message: e };
      }
      if (s === "documents") {
        const e =
          errors.bankName ||
          errors.accountTitle ||
          errors.accountNumber ||
          errors.iban;
        if (e) return { index: i, message: e };
      }
    }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Touch + mark every step as "attempted" so, no matter which step the
    // problem is on, every incomplete field across the whole form is
    // shown in red once Submit is pressed — approval never goes through
    // on incomplete data.
    setTouched((t) => ({
      ...t,
      profilePhoto: true,
      fatherName: true,
      dob: true,
      gender: true,
      maritalStatus: true,
      phone: true,
      cnic: true,
      currentAddress: true,
      city: true,
      country: true,
      emergencyContact: true,
      workTypes: true,
      languages: true,
      cvFile: true,
      bankName: true,
      accountTitle: true,
      accountNumber: true,
      iban: true,
    }));
    setAttemptedSteps((a) => ({
      ...a,
      personal: true,
      address: true,
      background: true,
      skills: true,
      documents: true,
    }));

    const problem = validateAllSteps();
    if (problem) {
      setStepIndex(problem.index);
      setError(problem.message);
      return;
    }
    if (!user) {
      navigate("/login", { replace: true });
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (form.profilePhoto) fd.append("profile_photo", form.profilePhoto);
      fd.append("father_name", form.fatherName);
      fd.append("dob", form.dob);
      fd.append("gender", form.gender);
      fd.append("marital_status", form.maritalStatus);
      fd.append("phone", form.phone);
      fd.append("cnic", form.cnic);
      fd.append("emergency_contact", form.emergencyContact);
      fd.append("current_address", form.currentAddress);
      fd.append("permanent_address", form.permanentAddress);
      fd.append("city", form.city);
      fd.append("country", form.country);
      fd.append("education", JSON.stringify(form.education));
      fd.append("total_experience", form.totalExperience);
      fd.append("experience", JSON.stringify(form.experience));
      fd.append("work_types", JSON.stringify(form.workTypes));
      fd.append("languages", JSON.stringify(form.languages));
      fd.append("programming_languages", JSON.stringify(form.programmingLanguages));
      fd.append("skills", JSON.stringify(form.skills));
      if (form.cvFile) fd.append("cv_file", form.cvFile);
      fd.append("bank_name", form.bankName);
      fd.append("account_title", form.accountTitle);
      fd.append("account_number", form.accountNumber);
      fd.append("iban", form.iban);
      fd.append("branch_code", form.branchCode);

      await submitProfile(fd);
      navigate("/pending-approval");
    } catch (err) {
      setSubmitting(false);
      setError(err.message || "Something went wrong saving your documents. Please try again.");
    }
  };

  const isLastStep = stepIndex === STEPS.length - 1;

  // Redirect effect above handles navigation; avoid flashing the form
  // for a frame while that happens.
  if (!user || user.status === "approved" || user.status === "rejected" || user.profileCompleted) {
    return null;
  }

  return (
    <div className="min-h-screen w-full bg-[#07060f] flex items-center justify-center overflow-y-auto overflow-x-hidden p-3 sm:p-4 lg:p-6">
      <div className="w-full max-w-3xl py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex items-center gap-3"
            aria-label="Hopenix home"
          >
            <BrandImg
              
              alt="Hopenix"
              className="w-8 h-8 object-contain drop-shadow-[0_0_12px_rgba(139,92,246,0.5)]"
            />
            <span className="text-lg font-extrabold tracking-tight text-white">
              HOPE<span className="text-violet-400">NIX</span>
            </span>
          </button>

          {user && (
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="text-xs text-slate-500 hover:text-slate-300 transition"
            >
              Sign out
            </button>
          )}
        </div>

        <div className="bg-[#0d0c18] border border-[#232134] rounded-3xl p-5 xs:p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <p className="text-violet-400 text-xs font-bold tracking-widest uppercase mb-2">
              Complete Your Profile
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white mb-1.5">
              Just a few more <span className="text-violet-400">details</span>
            </h2>
            <p className="text-slate-400 text-sm">
              We need this information to review and approve your account
            </p>
          </div>

          <StepIndicator activeIndex={stepIndex} />

          <form onSubmit={handleSubmit} className="space-y-7">
            {STEPS[stepIndex].id === "personal" && (
              <SectionCard title="Personal Information" subtitle="Tell us a bit about yourself">
                <ProfilePhotoUpload
                  file={form.profilePhoto}
                  previewUrl={photoPreviewUrl}
                  onFile={setProfilePhoto}
                  onBlur={() => touch("profilePhoto")}
                  error={fieldError("profilePhoto")}
                />
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Father / Guardian Name" icon={User} error={fieldError("fatherName")}>
                    <TextInput
                      icon
                      hasError={!!fieldError("fatherName")}
                      value={form.fatherName}
                      onChange={(e) => set("fatherName", e.target.value)}
                      onBlur={() => touch("fatherName")}
                      placeholder="Enter father's name"
                    />
                  </Field>
                  <Field label="Date of Birth" icon={Calendar} error={fieldError("dob")}>
                    <TextInput
                      icon
                      hasError={!!fieldError("dob")}
                      type="date"
                      value={form.dob}
                      onChange={(e) => set("dob", e.target.value)}
                      onBlur={() => touch("dob")}
                    />
                  </Field>
                  <Field label="Gender" error={fieldError("gender")}>
                    <select
                      value={form.gender}
                      onChange={(e) => {
                        set("gender", e.target.value);
                        touch("gender");
                      }}
                      onBlur={() => touch("gender")}
                      className={`${inputCls} ${fieldError("gender") ? inputErrorCls : ""}`}
                    >
                      <option value="">Select gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </Field>
                  <Field label="Marital Status" error={fieldError("maritalStatus")}>
                    <select
                      value={form.maritalStatus}
                      onChange={(e) => {
                        set("maritalStatus", e.target.value);
                        touch("maritalStatus");
                      }}
                      onBlur={() => touch("maritalStatus")}
                      className={`${inputCls} ${fieldError("maritalStatus") ? inputErrorCls : ""}`}
                    >
                      <option value="">Select marital status</option>
                      <option value="single">Single</option>
                      <option value="married">Married</option>
                      <option value="divorced">Divorced</option>
                      <option value="widowed">Widowed</option>
                    </select>
                  </Field>
                  <Field
                    label="Phone Number"
                    icon={Phone}
                    hint="Format: 03xx-xxxxxxx"
                    error={fieldError("phone")}
                  >
                    <TextInput
                      icon
                      hasError={!!fieldError("phone")}
                      type="tel"
                      inputMode="numeric"
                      value={form.phone}
                      onChange={(e) => set("phone", formatPhone(e.target.value))}
                      onBlur={() => touch("phone")}
                      placeholder="0300-1234567"
                      maxLength={12}
                    />
                  </Field>
                  <Field
                    label="Emergency Contact"
                    icon={Phone}
                    hint="Format: 03xx-xxxxxxx"
                    error={fieldError("emergencyContact")}
                  >
                    <TextInput
                      icon
                      hasError={!!fieldError("emergencyContact")}
                      inputMode="numeric"
                      value={form.emergencyContact}
                      onChange={(e) => set("emergencyContact", formatPhone(e.target.value))}
                      onBlur={() => touch("emergencyContact")}
                      placeholder="0300-1234567"
                      maxLength={12}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field
                      label="CNIC / ID Card Number"
                      icon={CreditCard}
                      hint="13 digits, as printed on your ID card"
                      error={fieldError("cnic")}
                    >
                      <TextInput
                        icon
                        hasError={!!fieldError("cnic")}
                        inputMode="numeric"
                        value={form.cnic}
                        onChange={(e) => set("cnic", formatCNIC(e.target.value))}
                        onBlur={() => touch("cnic")}
                        placeholder="42101-1234567-1"
                        maxLength={15}
                      />
                    </Field>
                  </div>
                </div>
              </SectionCard>
            )}

            {STEPS[stepIndex].id === "address" && (
              <SectionCard title="Address & Contact" subtitle="Where can we reach you">
                <Field label="Current Address" icon={MapPin} error={fieldError("currentAddress")}>
                  <TextArea
                    icon
                    hasError={!!fieldError("currentAddress")}
                    rows={2}
                    value={form.currentAddress}
                    onChange={(e) => set("currentAddress", e.target.value)}
                    onBlur={() => touch("currentAddress")}
                    placeholder="House / street / area"
                  />
                </Field>
                <Field label="Permanent Address" icon={MapPin} optional>
                  <TextArea
                    icon
                    rows={2}
                    value={form.permanentAddress}
                    onChange={(e) => set("permanentAddress", e.target.value)}
                    placeholder="If different from current address"
                  />
                </Field>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="City" error={fieldError("city")}>
                    <TextInput
                      hasError={!!fieldError("city")}
                      value={form.city}
                      onChange={(e) => set("city", e.target.value)}
                      onBlur={() => touch("city")}
                      placeholder="Enter your city"
                    />
                  </Field>
                  <Field label="Country" error={fieldError("country")}>
                    <TextInput
                      hasError={!!fieldError("country")}
                      value={form.country}
                      onChange={(e) => set("country", e.target.value)}
                      onBlur={() => touch("country")}
                      placeholder="Enter your country"
                    />
                  </Field>
                </div>
              </SectionCard>
            )}

            {STEPS[stepIndex].id === "background" && (
              <div className="space-y-8">
                <SectionCard title="Education" subtitle="Add your qualifications, most recent first">
                  <div className="space-y-4">
                    {form.education.map((edu, idx) => {
                      const entryError = attemptedSteps.background ? educationErrors[idx] : "";
                      return (
                        <div
                          key={edu.id}
                          className={`bg-[#121022] border rounded-xl p-4 space-y-3 ${
                            entryError ? "border-rose-500/60" : "border-[#2a2740]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-violet-300 uppercase tracking-wide">
                              Qualification {idx + 1}
                            </span>
                            {form.education.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeListItem("education", edu.id)}
                                className="text-slate-500 hover:text-rose-400 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <input
                              className={`${inputCls} ${entryError && !edu.degree.trim() ? inputErrorCls : ""}`}
                              placeholder="Degree / Certificate"
                              value={edu.degree}
                              onChange={(e) => updateListItem("education", edu.id, "degree", e.target.value)}
                            />
                            <input
                              className={`${inputCls} ${entryError && !edu.institute.trim() ? inputErrorCls : ""}`}
                              placeholder="Institute name"
                              value={edu.institute}
                              onChange={(e) => updateListItem("education", edu.id, "institute", e.target.value)}
                            />
                            <input
                              className={`${inputCls} ${entryError && !edu.year.trim() ? inputErrorCls : ""}`}
                              placeholder="Year of completion"
                              value={edu.year}
                              onChange={(e) => updateListItem("education", edu.id, "year", e.target.value)}
                            />
                            <input
                              className={inputCls}
                              placeholder="Grade / GPA (optional)"
                              value={edu.grade}
                              onChange={(e) => updateListItem("education", edu.id, "grade", e.target.value)}
                            />
                          </div>
                          {entryError && (
                            <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              {entryError}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => addListItem("education", emptyEducation)}
                      className="flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition"
                    >
                      <Plus className="w-4 h-4" /> Add another qualification
                    </button>
                  </div>
                </SectionCard>

                <SectionCard title="Work Experience" subtitle="Add relevant jobs or internships, if any — leave blank if none">
                  <Field label="Total Years of Experience" icon={Briefcase} optional>
                    <select
                      value={form.totalExperience}
                      onChange={(e) => set("totalExperience", e.target.value)}
                      className={inputWithIconCls}
                    >
                      <option value="">Select your experience level</option>
                      {EXPERIENCE_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="space-y-4">
                    {form.experience.map((exp, idx) => {
                      const entryError = attemptedSteps.background ? experienceErrors[idx] : "";
                      return (
                        <div
                          key={exp.id}
                          className={`bg-[#121022] border rounded-xl p-4 space-y-3 ${
                            entryError ? "border-rose-500/60" : "border-[#2a2740]"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-violet-300 uppercase tracking-wide">
                              Experience {idx + 1}
                            </span>
                            {form.experience.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeListItem("experience", exp.id)}
                                className="text-slate-500 hover:text-rose-400 transition"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                          <div className="grid sm:grid-cols-2 gap-3">
                            <input
                              className={`${inputCls} ${entryError && !exp.company.trim() ? inputErrorCls : ""}`}
                              placeholder="Company name"
                              value={exp.company}
                              onChange={(e) => updateListItem("experience", exp.id, "company", e.target.value)}
                            />
                            <input
                              className={`${inputCls} ${entryError && !exp.role.trim() ? inputErrorCls : ""}`}
                              placeholder="Role / position"
                              value={exp.role}
                              onChange={(e) => updateListItem("experience", exp.id, "role", e.target.value)}
                            />
                            <input
                              className={`${inputCls} sm:col-span-2 ${entryError && !exp.duration.trim() ? inputErrorCls : ""}`}
                              placeholder="Duration (e.g. Jan 2023 – Present)"
                              value={exp.duration}
                              onChange={(e) => updateListItem("experience", exp.id, "duration", e.target.value)}
                            />
                            <textarea
                              className={`${inputCls} sm:col-span-2 resize-none`}
                              rows={2}
                              placeholder="Brief description of your responsibilities"
                              value={exp.description}
                              onChange={(e) => updateListItem("experience", exp.id, "description", e.target.value)}
                            />
                          </div>
                          {entryError && (
                            <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400">
                              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                              {entryError}
                            </p>
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => addListItem("experience", emptyExperience)}
                      className="flex items-center gap-1.5 text-sm text-violet-400 hover:text-violet-300 transition"
                    >
                      <Plus className="w-4 h-4" /> Add another experience
                    </button>
                  </div>
                </SectionCard>
              </div>
            )}

            {STEPS[stepIndex].id === "skills" && (
              <div className="space-y-8">
                <SectionCard title="Work Type" subtitle="Select all the kind of work you can do">
                  <div
                    className={`flex flex-wrap gap-2 p-2 rounded-xl border ${
                      fieldError("workTypes") ? "border-rose-500/60" : "border-transparent"
                    }`}
                  >
                    {WORK_TYPES.map((type) => {
                      const active = form.workTypes.includes(type);
                      return (
                        <button
                          type="button"
                          key={type}
                          onClick={() => toggleFromList("workTypes", type)}
                          className={`px-3.5 py-2 rounded-full text-xs font-medium border transition flex items-center gap-1.5 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-0 ${
                            active
                              ? "bg-violet-600 border-violet-600 text-white"
                              : "bg-[#121022] border-[#2a2740] text-slate-300 hover:border-violet-500/50"
                          }`}
                        >
                          {active && <CheckCircle2 className="w-3.5 h-3.5" />}
                          {type}
                        </button>
                      );
                    })}
                  </div>
                  {fieldError("workTypes") && (
                    <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400 mt-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {fieldError("workTypes")}
                    </p>
                  )}
                </SectionCard>

                <SectionCard title="Skills & Expertise" subtitle="Type a skill and press Enter to add it (optional)">
                  <div className="relative">
                    <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      className={inputWithIconCls}
                      placeholder="e.g. React, Bookkeeping, Photoshop..."
                      value={form.skillsInput}
                      onChange={(e) => set("skillsInput", e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addSkill();
                        }
                      }}
                    />
                  </div>
                  {form.skills.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {form.skills.map((skill) => (
                        <span
                          key={skill}
                          className="flex items-center gap-1.5 bg-violet-600/15 border border-violet-500/30 text-violet-300 text-xs font-medium px-3 py-1.5 rounded-full"
                        >
                          {skill}
                          <button
                            type="button"
                            onClick={() => removeSkill(skill)}
                            className="text-violet-400 hover:text-white transition"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Languages" subtitle="Which languages can you work in">
                  <div
                    className={`flex flex-wrap gap-2 p-2 rounded-xl border ${
                      fieldError("languages") ? "border-rose-500/60" : "border-transparent"
                    }`}
                  >
                    {LANGUAGES.map((lang) => {
                      const active = form.languages.includes(lang);
                      return (
                        <button
                          type="button"
                          key={lang}
                          onClick={() => toggleFromList("languages", lang)}
                          className={`px-3.5 py-2 rounded-full text-xs font-medium border transition flex items-center gap-1.5 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-0 ${
                            active
                              ? "bg-violet-600 border-violet-600 text-white"
                              : "bg-[#121022] border-[#2a2740] text-slate-300 hover:border-violet-500/50"
                          }`}
                        >
                          <Languages className="w-3.5 h-3.5" />
                          {lang}
                        </button>
                      );
                    })}
                  </div>
                  {fieldError("languages") && (
                    <p className="flex items-center gap-1.5 text-[11.5px] text-rose-400 mt-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {fieldError("languages")}
                    </p>
                  )}
                </SectionCard>

                <SectionCard
                  title="Programming / Technical Languages"
                  subtitle="Select any programming languages or tools you know (optional)"
                >
                  <div className="flex flex-wrap gap-2">
                    {PROGRAMMING_LANGUAGES.map((lang) => {
                      const active = form.programmingLanguages.includes(lang);
                      return (
                        <button
                          type="button"
                          key={lang}
                          onClick={() => toggleFromList("programmingLanguages", lang)}
                          className={`px-3.5 py-2 rounded-full text-xs font-medium border transition flex items-center gap-1.5 outline-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 focus-visible:ring-offset-0 ${
                            active
                              ? "bg-violet-600 border-violet-600 text-white"
                              : "bg-[#121022] border-[#2a2740] text-slate-300 hover:border-violet-500/50"
                          }`}
                        >
                          <Code2 className="w-3.5 h-3.5" />
                          {lang}
                        </button>
                      );
                    })}
                  </div>
                </SectionCard>

                <SectionCard title="CV / Resume" subtitle="Upload your CV so we can review your background — required">
                  <FileDropBox
                    label="Upload CV"
                    file={form.cvFile}
                    onFile={setCvFile}
                    onBlur={() => touch("cvFile")}
                    accept=".pdf,.doc,.docx"
                    icon={FileText}
                    error={fieldError("cvFile")}
                  />
                </SectionCard>
              </div>
            )}

            {STEPS[stepIndex].id === "documents" && (
              <div className="space-y-8">
                <SectionCard title="Bank Account Details" subtitle="Your salary will be paid into this account">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Field label="Bank Name" icon={Landmark} error={fieldError("bankName")}>
                      <TextInput
                        icon
                        hasError={!!fieldError("bankName")}
                        value={form.bankName}
                        onChange={(e) => set("bankName", e.target.value)}
                        onBlur={() => touch("bankName")}
                        placeholder="e.g. HBL, UBL, Meezan..."
                      />
                    </Field>
                    <Field label="Account Title" icon={User} error={fieldError("accountTitle")}>
                      <TextInput
                        icon
                        hasError={!!fieldError("accountTitle")}
                        value={form.accountTitle}
                        onChange={(e) => set("accountTitle", e.target.value)}
                        onBlur={() => touch("accountTitle")}
                        placeholder="Name on the account"
                      />
                    </Field>
                    <Field
                      label="Account Number"
                      icon={CreditCard}
                      error={fieldError("accountNumber")}
                    >
                      <TextInput
                        icon
                        hasError={!!fieldError("accountNumber")}
                        inputMode="numeric"
                        value={form.accountNumber}
                        onChange={(e) => set("accountNumber", formatAccountNumber(e.target.value))}
                        onBlur={() => touch("accountNumber")}
                        placeholder="Enter account number"
                      />
                    </Field>
                    <Field
                      label="IBAN"
                      icon={CreditCard}
                      optional
                      hint="24 characters for Pakistan, e.g. PK36SCBL..."
                      error={fieldError("iban")}
                    >
                      <TextInput
                        icon
                        hasError={!!fieldError("iban")}
                        value={form.iban}
                        onChange={(e) => set("iban", formatIBAN(e.target.value))}
                        onBlur={() => touch("iban")}
                        placeholder="PK36SCBL0000001123494301"
                        maxLength={34}
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Branch Code" icon={Building2} optional>
                        <TextInput
                          icon
                          value={form.branchCode}
                          onChange={(e) => set("branchCode", e.target.value)}
                          placeholder="Enter branch code"
                        />
                      </Field>
                    </div>
                  </div>
                </SectionCard>
              </div>
            )}

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={goBack}
                disabled={stepIndex === 0}
                className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition px-4 py-2.5"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              {!isLastStep ? (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!isStepValid}
                  className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-lg shadow-violet-900/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-violet-600 disabled:hover:to-fuchsia-500"
                >
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting || !isStepValid}
                  className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold px-6 py-2.5 rounded-xl transition shadow-lg shadow-violet-900/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-violet-600 disabled:hover:to-fuchsia-500"
                >
                  {submitting ? "Submitting..." : "Submit for Approval"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5" />
          Your documents are stored securely and only used for account verification
        </div>
      </div>
    </div>
  );
}