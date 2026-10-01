import { useState } from "react";
import {
  User,
  Building2,
  MapPin,
  Phone,
  Mail,
  Briefcase,
  FileText,
  Clock,
  Target,
  Wallet,
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ImageIcon,
} from "lucide-react";
import BrandImg from "../components/BrandImg.jsx";
// STEP 7 of the real-backend rollout: this public form now also
// dual-writes to Postgres (dashboard.IntakeRequest) alongside its
// existing localStorage flow. See ClientsPage.jsx (Steps 2-4) and
// MIGRATIONS.md/GUIDE.md for the full staged plan.
import * as clientsApi from "../api/clientsApi.js";

/* ======================================================================
   BRAND — kept in sync with ClientPortal.jsx's own BRAND_NAME/logo so
   this public form looks like it belongs to the same product.
====================================================================== */
const BRAND_NAME = "Hopnix";

/* ======================================================================
   STORAGE — writes into the exact same localStorage key/event ClientsPage
   .jsx reads from (see INTAKE_REQUESTS_STORAGE_KEY / INTAKE_REQUESTS_EVENT
   there). Keep these two strings identical in both files if either ever
   changes — that's the only thing wiring this form to the admin panel's
   "Requests" list.
---------------------------------------------------------------------- */
const INTAKE_REQUESTS_STORAGE_KEY = "clientspage_intake_requests_v1";
const INTAKE_REQUESTS_EVENT = "intakerequests:updated";

const PROJECT_TYPE_OPTIONS = ["Website", "Mobile App", "E-commerce", "Custom Software", "Graphic Design", "Other"];

const TIMELINE_OPTIONS = ["Less than 2 weeks", "2–4 weeks", "1–2 months", "2–4 months", "4+ months", "Not sure yet"];

function genRequestId() {
  const n = Math.floor(1000 + Math.random() * 9000);
  return `REQ-${n}`;
}

function loadIntakeRequests() {
  try {
    const raw = localStorage.getItem(INTAKE_REQUESTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveIntakeRequest(request) {
  try {
    const list = loadIntakeRequests();
    list.unshift(request);
    localStorage.setItem(INTAKE_REQUESTS_STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(INTAKE_REQUESTS_EVENT));
    return true;
  } catch {
    return false;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

const EMPTY_FORM = {
  contactPerson: "",
  companyName: "",
  city: "",
  phone: "",
  email: "",
  projectName: "",
  projectType: PROJECT_TYPE_OPTIONS[0],
  requirements: "",
  timeline: TIMELINE_OPTIONS[0],
  purpose: "",
  budget: "",
};

/* ======================================================================
   FIELD SHELL — matching the dark/violet input style ClientPortal.jsx's
   LoginScreen already uses, so this form reads as the same product.
====================================================================== */
function TextField({ icon: Icon, label, required, textarea, ...props }) {
  const Tag = textarea ? "textarea" : "input";
  return (
    <div>
      <label className="text-xs font-semibold mb-1.5 block text-slate-300">
        {label}
        {required && <span className="text-rose-400"> *</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className={`w-4 h-4 absolute left-3.5 ${textarea ? "top-3.5" : "top-1/2 -translate-y-1/2"} text-slate-500`} />}
        <Tag
          {...props}
          rows={textarea ? 4 : undefined}
          className={`w-full text-sm border border-white/10 rounded-xl ${Icon ? "pl-10" : "pl-3.5"} pr-3 ${
            textarea ? "py-3" : "py-3"
          } outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-white/5 text-white placeholder:text-slate-500 resize-none break-words`}
        />
      </div>
    </div>
  );
}

function SelectField({ icon: Icon, label, required, children, ...props }) {
  return (
    <div>
      <label className="text-xs font-semibold mb-1.5 block text-slate-300">
        {label}
        {required && <span className="text-rose-400"> *</span>}
      </label>
      <div className="relative">
        {Icon && <Icon className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />}
        <select
          {...props}
          className={`w-full text-sm border border-white/10 rounded-xl ${Icon ? "pl-10" : "pl-3.5"} pr-3 py-3 outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 bg-[#161328] text-white appearance-none`}
        >
          {children}
        </select>
      </div>
    </div>
  );
}

export default function ClientIntakeForm() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [screenshot, setScreenshot] = useState(null); // { file, dataUrl }
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null); // { id } once saved

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

  const handleScreenshotChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please upload the payment screenshot as an image (JPG, PNG, etc).");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setScreenshot({ file, dataUrl });
      setError("");
    } catch {
      setError("Couldn't read that image — please try a different file.");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const required = [
      ["contactPerson", "Your name"],
      ["companyName", "Company name"],
      ["city", "City"],
      ["phone", "Phone number"],
      ["email", "Email address"],
      ["projectName", "Project name"],
      ["requirements", "Project details / requirements"],
      ["purpose", "Purpose / goal"],
      ["budget", "Estimated budget"],
    ];
    for (const [key, label] of required) {
      if (!String(form[key] || "").trim()) {
        setError(`${label} is required.`);
        return;
      }
    }
    if (!isValidEmail(form.email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!(Number(form.budget) > 0)) {
      setError("Please enter a valid estimated budget (a number greater than 0).");
      return;
    }
    if (!screenshot) {
      setError("Please attach a screenshot of your 30% advance payment — this is required before we can start.");
      return;
    }

    setSubmitting(true);
    const request = {
      id: genRequestId(),
      submittedAt: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
      status: "Pending",
      contactPerson: form.contactPerson.trim(),
      companyName: form.companyName.trim(),
      city: form.city.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      projectName: form.projectName.trim(),
      projectType: form.projectType,
      requirements: form.requirements.trim(),
      timeline: form.timeline,
      purpose: form.purpose.trim(),
      budget: Number(form.budget),
      paymentScreenshot: screenshot.dataUrl,
    };

    // BUG 3 FIX: this used to be fire-and-forget — the confirmation
    // screen showed instantly off a local save, and the real server
    // submission ran in the background with only a `.catch(console.error)`.
    // If the server was down/unreachable, the client still saw "Request
    // Submitted!" while nothing existed on ClientsPage.jsx's Requests
    // panel (which now reads from the backend via listIntakeRequests, not
    // this localStorage cache — see there). Now we await the real
    // request first: the confirmation only shows on a genuine server
    // success, and a failure surfaces as a retryable error instead of a
    // false positive.
    const payload = new FormData();
    payload.append("company_name", request.companyName);
    payload.append("contact_person", request.contactPerson);
    payload.append("email", request.email);
    payload.append("phone", request.phone);
    payload.append("city", request.city);
    payload.append("project_name", request.projectName);
    payload.append("project_type", request.projectType);
    payload.append("budget", String(request.budget));
    payload.append("requirements", request.requirements);
    if (screenshot?.file) payload.append("payment_proof", screenshot.file);

    try {
      const created = await clientsApi.submitIntakeRequest(payload);
      // Server confirmed — use its real id as the reference where
      // available, and keep the existing local cache write (harmless,
      // best-effort) now that it reflects an actually-saved request.
      const referenceId = created?.id ? `REQ-${created.id}` : request.id;
      saveIntakeRequest({ ...request, id: referenceId });
      setSubmitting(false);
      setSubmitted({ id: referenceId });
    } catch (err) {
      setSubmitting(false);
      setError(
        err?.message
          ? `Couldn't submit your request: ${err.message}. Please try again.`
          : "Couldn't reach the server. Please check your connection and try again."
      );
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0a0613] flex items-center justify-center px-4 py-10" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
        <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 50% 20%, rgba(124,58,237,0.22), transparent 55%)" }} />
        <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#121020] p-8 text-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>
          <h2 className="text-xl font-extrabold text-white">Request Submitted!</h2>
          <p className="text-sm text-slate-400 mt-2 leading-relaxed">
            Thanks — we've received your project request and payment confirmation. Our team will review it and reach out on WhatsApp with your Client Portal login shortly.
          </p>
          <div className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[11px] text-slate-500">Reference ID</p>
            <p className="text-sm font-bold text-violet-300 tracking-wide">{submitted.id}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0613] px-4 py-10 sm:px-6 lg:px-10" style={{ fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
      <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 50% 20%, rgba(124,58,237,0.22), transparent 55%)" }} />

      <div className="relative max-w-2xl mx-auto">
        {/* brand header */}
        <div className="flex items-center gap-3 justify-center mb-6">
          <div className="w-11 h-11 rounded-xl bg-white/5 flex items-center justify-center shrink-0 overflow-hidden">
            <BrandImg alt={`${BRAND_NAME} logo`} className="w-full h-full object-contain p-1.5" />
          </div>
          <div>
            <p className="text-lg font-extrabold text-white leading-tight">{BRAND_NAME}</p>
            <p className="text-[11px] tracking-wide text-slate-400 leading-tight">NEW PROJECT REQUEST</p>
          </div>
        </div>

        <div className="rounded-3xl border border-white/10 overflow-hidden shadow-2xl bg-[#121020] p-6 sm:p-8">
          <h1 className="text-2xl font-extrabold text-white text-center">Tell us about your project</h1>
          <p className="text-sm text-slate-400 text-center mt-1.5 mb-6">
            Fill this out and attach your 30% advance payment screenshot — once approved, you'll get your Client Portal login on WhatsApp.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Contact details */}
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField icon={User} label="Your Name" required value={form.contactPerson} onChange={set("contactPerson")} placeholder="e.g. Ahmed Khan" />
              <TextField icon={Building2} label="Company Name" required value={form.companyName} onChange={set("companyName")} placeholder="e.g. Khan Traders" />
              <TextField icon={MapPin} label="City" required value={form.city} onChange={set("city")} placeholder="e.g. Lahore" />
              <TextField icon={Phone} label="Phone Number" required value={form.phone} onChange={set("phone")} placeholder="e.g. 03001234567" />
            </div>
            <TextField icon={Mail} label="Email Address" required type="email" value={form.email} onChange={set("email")} placeholder="name@company.com" />

            <div className="h-px bg-white/10" />

            {/* Project details */}
            <div className="grid sm:grid-cols-2 gap-4">
              <TextField icon={Briefcase} label="Project Name" required value={form.projectName} onChange={set("projectName")} placeholder="e.g. Company Website Redesign" />
              <SelectField icon={Briefcase} label="Project Type" required value={form.projectType} onChange={set("projectType")}>
                {PROJECT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectField>
            </div>
            <TextField
              icon={FileText}
              label="Project Details / Requirements"
              required
              textarea
              value={form.requirements}
              onChange={set("requirements")}
              placeholder="Describe what you need built — pages/features, references, anything important."
            />
            <div className="grid sm:grid-cols-2 gap-4">
              <SelectField icon={Clock} label="Timeline Needed" required value={form.timeline} onChange={set("timeline")}>
                {TIMELINE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </SelectField>
              <TextField icon={Wallet} label="Estimated Budget (PKR)" required type="number" min="1" value={form.budget} onChange={set("budget")} placeholder="e.g. 150000" />
            </div>
            <TextField
              icon={Target}
              label="Purpose / Goal"
              required
              textarea
              value={form.purpose}
              onChange={set("purpose")}
              placeholder="Why do you need this? e.g. to sell products online, build brand presence, automate a process..."
            />

            <div className="h-px bg-white/10" />

            {/* Payment proof */}
            <div>
              <label className="text-xs font-semibold mb-1.5 block text-slate-300">
                30% Advance Payment Screenshot <span className="text-rose-400">*</span>
              </label>
              <label
                htmlFor="payment-screenshot"
                className="flex flex-col items-center justify-center gap-2 border border-dashed border-white/15 rounded-xl px-4 py-6 cursor-pointer hover:border-violet-500/50 hover:bg-white/5 transition text-center"
              >
                {screenshot ? (
                  <img src={screenshot.dataUrl} alt="Payment screenshot preview" className="max-h-40 rounded-lg" />
                ) : (
                  <>
                    <Upload className="w-5 h-5 text-slate-500" />
                    <span className="text-xs text-slate-400">Tap to upload a screenshot of your 30% advance payment</span>
                  </>
                )}
                <input id="payment-screenshot" type="file" accept="image/*" className="hidden" onChange={handleScreenshotChange} />
              </label>
              {screenshot && (
                <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500">
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span className="truncate">{screenshot.file.name}</span>
                  <button type="button" onClick={() => setScreenshot(null)} className="text-rose-400 hover:text-rose-300 font-semibold ml-auto">
                    Remove
                  </button>
                </div>
              )}
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
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                "Submit Request"
              )}
            </button>

            <p className="text-[11px] text-center text-slate-500">Your details are only shared with the {BRAND_NAME} team.</p>
          </form>
        </div>
      </div>
    </div>
  );
}