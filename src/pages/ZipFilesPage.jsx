import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  Search,
  Download,
  Building2,
  User,
  Calendar,
  ShieldCheck,
  ShieldAlert,
  LogOut,
  FolderKanban,
  Trash2,
  FileText,
  Mail,
} from "lucide-react";
import { useAuth } from "../AuthContext.jsx";
import { API_ROOT } from "../apiConfig.js";
import { useLiveRefresh, sameJson } from "../useLiveRefresh.js";

/* ======================================================================
   ZIP FILES (ADMIN) PAGE — now backed by the real API instead of
   localStorage/IndexedDB.

   BEFORE: every project's completedZip lived inside the giant
   PROJECTS_STORAGE_KEY blob in localStorage (or, for newer uploads, as
   a blob in IndexedDB via attachmentStorage.js). That meant the zip
   bytes only ever existed in ONE browser, on ONE device — clear site
   data, switch browsers, or reinstall, and every uploaded zip was gone
   for good. Nothing was shared between users either.

   NOW: the actual .zip bytes live on the server's disk
   (MEDIA_ROOT/projects/<id>/deliverable/...), and Postgres only stores
   the small stuff — which project it belongs to, the original file
   name, its size, who uploaded it, and when. See projects/models.py
   (Project.completed_zip + zip_original_name/zip_size/zip_uploaded_at)
   on the backend. Nothing is lost on refresh, browser change, or
   deploy, and every teammate with access to a project sees the same
   file.

   Three endpoints from the Django backend drive this page now:
     GET    /api/projects/zip-files/   -> merged list: every Project's
                                          completed_zip AND every Task's
                                          zip attachment you can see
     [file].downloadUrl (from that list) -> download one
     [file].deleteUrl   (from that list) -> delete one
   Each row in the list already carries its own downloadUrl/deleteUrl,
   so this page never needs to know whether a row came from a Project
   or a Task — it just calls whatever URL that row gives it.

   Access is still controlled by the real page-access system
   (canAccessPage from AuthContext) exactly as before, and still gated
   a second time behind the user's own account password before any
   file list or download link is shown — none of that changed, only
   WHERE the file list itself comes from.
====================================================================== */

// Base URL of the Django API. Point this at wherever the backend is
// API root comes from src/apiConfig.js (VITE_API_BASE_URL).
const API_BASE_URL = API_ROOT;

// Remembers that this browser tab already unlocked the page, so
// switching to another sidebar tab and back doesn't ask again — closing
// the tab / signing out clears it, since it's sessionStorage.
const UNLOCK_SESSION_KEY = "hopenix_zipfiles_unlocked";

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function ZipFilesPage({ darkMode = false }) {
  const { user, canAccessPage } = useAuth();
  const hasAccess = canAccessPage("Zip Files");

  // AuthContext.jsx keeps the DRF auth token ONLY in localStorage (key
  // "hopenix_auth_token") — it never puts it on the context value — so
  // this page reads it the same way AuthContext's own internal apiFetch()
  // helper does, instead of destructuring a `token` that doesn't exist.
  const token = localStorage.getItem("hopenix_auth_token");

  const authHeaders = { Authorization: `Token ${token}` };

  const card = darkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-200";
  const cardText = darkMode ? "text-slate-100" : "text-slate-900";
  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";
  const subtleText = darkMode ? "text-slate-500" : "text-slate-400";
  const inputCls = darkMode ? "bg-slate-800 border-slate-700 text-slate-200" : "border-slate-200 bg-white text-slate-900";

  const [unlocked, setUnlocked] = useState(() => {
    try {
      return window.sessionStorage.getItem(UNLOCK_SESSION_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");

  // Email OTP step (comes AFTER the password step). otpStep=false -> password
  // screen, otpStep=true -> "enter the code we emailed you" screen.
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const [otpInfo, setOtpInfo] = useState("");

  const [zipFiles, setZipFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Loads the zip list from the API — only once the page is actually
  // unlocked, exactly like before (no reason to hit the backend before
  // that gate is passed).
  const loadZipFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/zip-files/`, { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load zip files.");
      const data = await res.json();
      setZipFiles(data);
    } catch {
      showToast("Couldn't load zip files from the server.", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (unlocked) loadZipFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);

  // Live: a zip uploaded from another device/browser shows up without a reload.
  useLiveRefresh(
    async () => {
      const res = await fetch(`${API_BASE_URL}/api/projects/zip-files/`, { headers: authHeaders });
      if (!res.ok) return;
      const data = await res.json();
      setZipFiles((prev) => (sameJson(prev, data) ? prev : data));
    },
    { interval: 20000, enabled: unlocked }
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zipFiles;
    return zipFiles.filter(
      (f) =>
        f.projectName?.toLowerCase().includes(q) ||
        f.client?.toLowerCase().includes(q) ||
        f.fileName?.toLowerCase().includes(q) ||
        f.uploadedBy?.toLowerCase().includes(q) ||
        f.projectDetails?.toLowerCase().includes(q)
    );
  }, [zipFiles, search]);

  const totalSizeMb = zipFiles.reduce((sum, f) => sum + (f.size || 0), 0);

  const showToast = (message, tone = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3000);
  };

  // Resend cooldown ticker (seconds).
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  // "abc***@gmail.com" — so the screen can say where the code went.
  const maskedEmail = (() => {
    const em = user?.email || "";
    const [name, domain] = em.split("@");
    if (!name || !domain) return "your email";
    return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
  })();

  // Emails a fresh 6-digit code to the logged-in user's own account email
  // using the existing POST /api/auth/send-otp/ endpoint.
  const sendOtp = async () => {
    const res = await fetch(`${API_BASE_URL}/api/auth/send-otp/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: user?.email }),
    });
    if (res.status === 429) throw new Error("Too many attempts. Please wait a minute and try again.");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Couldn't send the code. Please try again.");
    setResendIn(30);
  };

  const handleUnlock = async (e) => {
    e.preventDefault();
    // Password ab backend se verify hota hai (POST /api/auth/verify-password/)
    // — asal password kabhi bhi frontend ko wapas nahi bheja jaata (security),
    // isliye yahan user.password se compare karna kaam nahi karega.
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/verify-password/`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.valid) {
        // Password is correct -> now email a one-time code. The page only
        // unlocks after that code is entered (see handleVerifyOtp).
        setError("");
        setPassword("");
        setOtp("");
        setOtpInfo("");
        await sendOtp();
        setOtpStep(true);
      } else {
        setError("Incorrect password. Please try again.");
      }
    } catch (err) {
      setError(err?.message && err.message !== "Failed to fetch" ? err.message : "Couldn't verify password. Please try again.");
    }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    if (otpBusy) return;
    setOtpBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/verify-otp/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email, code: otp.trim() }),
      });
      if (res.status === 429) {
        setError("Too many attempts. Please wait a minute and try again.");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setError("");
        setOtp("");
        setOtpStep(false);
        setUnlocked(true);
        try {
          window.sessionStorage.setItem(UNLOCK_SESSION_KEY, "true");
        } catch {
          // sessionStorage unavailable — page just re-asks next time, nothing else breaks
        }
      } else {
        setError(data.error || "Incorrect code. Please try again.");
      }
    } catch {
      setError("Couldn't verify the code. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendIn > 0) return;
    try {
      setError("");
      await sendOtp();
      setOtpInfo("A new code has been sent to your email.");
    } catch (err) {
      setError(err?.message || "Couldn't send the code. Please try again.");
    }
  };

  const handleLock = () => {
    setUnlocked(false);
    setPassword("");
    setOtpStep(false);
    setOtp("");
    setError("");
    try {
      window.sessionStorage.removeItem(UNLOCK_SESSION_KEY);
    } catch {
      // ignore
    }
  };

  // Streams the actual bytes from the server and saves them — this
  // replaces both old paths (IndexedDB blob + base64 dataUrl) with one
  // real network download.
  const handleDownload = async (file) => {
    try {
      const res = await fetch(file.downloadUrl, { headers: authHeaders });
      if (!res.ok) throw new Error("Download failed.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName || "project-files.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showToast(`${file.fileName} downloaded.`, "success");
    } catch {
      showToast("Couldn't download that file.", "error");
    }
  };

  // Deletes the zip on the server (removes the file from disk AND
  // clears the metadata columns on that project row) — no more
  // read-modify-write of the whole projects array back into
  // localStorage.
  const handleDelete = async (file) => {
    try {
      const res = await fetch(file.deleteUrl, { method: "DELETE", headers: authHeaders });
      if (!res.ok) throw new Error("Delete failed.");
      setZipFiles((prev) => prev.filter((f) => f.id !== file.id));
      showToast(`${file.fileName} deleted.`, "success");
    } catch {
      showToast("Couldn't delete that file.", "error");
    }
    setConfirmDeleteId(null);
  };

  /* -------------------------------------------------------------- */
  /*  No page access — never even see the password screen.           */
  /* -------------------------------------------------------------- */
  if (!hasAccess) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className={`text-base font-bold ${cardText}`}>Zip Files</h2>
          <p className={`text-xs mt-0.5 ${subtleText}`}>Completed project files, stored securely</p>
        </div>
        <div className={`rounded-2xl p-8 flex flex-col items-center text-center gap-3 ${card}`}>
          <span className="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </span>
          <p className={`text-sm font-semibold ${cardText}`}>Restricted</p>
          <p className={`text-xs max-w-sm ${mutedText}`}>
            This page holds every project's completed ZIP files and you don't currently have access to it. Contact an admin if you need a file from here.
          </p>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /*  Has access, but not unlocked yet — password gate.               */
  /* -------------------------------------------------------------- */
  if (!unlocked) {
    return (
      <div className="space-y-4">
        <div>
          <h2 className={`text-base font-bold ${cardText}`}>Zip Files</h2>
          <p className={`text-xs mt-0.5 ${subtleText}`}>Completed project files, stored securely</p>
        </div>
        <div className="flex items-center justify-center py-10">
          {otpStep ? (
          <form onSubmit={handleVerifyOtp} className={`w-full max-w-sm rounded-2xl p-6 ${card}`}>
            <div className="flex flex-col items-center text-center gap-2 mb-5">
              <span className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
                <Mail className="w-6 h-6" />
              </span>
              <p className={`text-sm font-bold ${cardText}`}>Check your email</p>
              <p className={`text-xs ${mutedText}`}>We sent a 6-digit code to {maskedEmail}. Enter it below to open Zip Files. The code expires in 10 minutes.</p>
            </div>

            <label className={`text-xs font-semibold mb-1 block ${cardText}`}>Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={6}
              value={otp}
              onChange={(e) => { setOtp(e.target.value.replace(/\D/g, "")); setError(""); setOtpInfo(""); }}
              placeholder="123456"
              className={`w-full text-center tracking-[0.5em] text-lg font-semibold border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
            />
            {error && <p className="text-[11px] text-rose-500 mt-1.5">{error}</p>}
            {!error && otpInfo && <p className="text-[11px] text-emerald-600 mt-1.5">{otpInfo}</p>}

            <button
              type="submit"
              disabled={otp.length !== 6 || otpBusy}
              className="w-full mt-4 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
            >
              <ShieldCheck className="w-4 h-4" /> {otpBusy ? "Verifying..." : "Verify & Unlock"}
            </button>

            <div className="flex items-center justify-between mt-3">
              <button
                type="button"
                onClick={() => { setOtpStep(false); setOtp(""); setError(""); }}
                className={`text-xs font-semibold ${mutedText} hover:underline`}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={resendIn > 0}
                className="text-xs font-semibold text-violet-600 hover:underline disabled:opacity-50 disabled:no-underline"
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </button>
            </div>
          </form>
          ) : (
          <form onSubmit={handleUnlock} className={`w-full max-w-sm rounded-2xl p-6 ${card}`}>
            <div className="flex flex-col items-center text-center gap-2 mb-5">
              <span className="w-12 h-12 rounded-2xl bg-violet-50 text-violet-600 flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </span>
              <p className={`text-sm font-bold ${cardText}`}>Enter your account password</p>
              <p className={`text-xs ${mutedText}`}>Use the same password you log into Hopenix with — this just double-checks it's really you.</p>
            </div>

            <label className={`text-xs font-semibold mb-1 block ${cardText}`}>Password</label>
            <div className="relative">
              <KeyRound className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 ${subtleText}`} />
              <input
                type={showPassword ? "text" : "password"}
                autoFocus
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                className={`w-full text-sm border rounded-lg pl-9 pr-9 py-2.5 outline-none focus:ring-2 focus:ring-violet-400 ${inputCls}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className={`absolute right-3 top-1/2 -translate-y-1/2 ${subtleText}`}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {error && <p className="text-[11px] text-rose-500 mt-1.5">{error}</p>}

            <button
              type="submit"
              disabled={!password}
              className="w-full mt-4 flex items-center justify-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white text-sm font-semibold py-2.5 rounded-full transition"
            >
              <ShieldCheck className="w-4 h-4" /> Unlock
            </button>
          </form>
          )}
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------- */
  /*  Unlocked — the actual file list.                                */
  /* -------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className={`text-base font-bold ${cardText}`}>Zip Files</h2>
          <p className={`text-xs mt-0.5 ${subtleText}`}>Completed project files, stored securely</p>
        </div>
        <button
          onClick={handleLock}
          className={`flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-full border transition ${inputCls}`}
        >
          <LogOut className="w-4 h-4" /> Lock page
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
        <div className={`rounded-2xl p-4 ${card}`}>
          <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-violet-50 text-violet-600">
            <Archive className="w-5 h-5" />
          </span>
          <p className={`text-xs mt-2.5 ${mutedText}`}>Total Zip Files</p>
          <p className={`text-xl sm:text-2xl font-extrabold mt-0.5 ${cardText}`}>{zipFiles.length}</p>
        </div>
        <div className={`rounded-2xl p-4 ${card}`}>
          <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-emerald-50 text-emerald-600">
            <FolderKanban className="w-5 h-5" />
          </span>
          <p className={`text-xs mt-2.5 ${mutedText}`}>Total Size</p>
          <p className={`text-xl sm:text-2xl font-extrabold mt-0.5 ${cardText}`}>{totalSizeMb.toFixed(1)} MB</p>
        </div>
      </div>

      {/* Search */}
      <div className={`flex items-center gap-2 rounded-full px-4 py-2.5 border ${inputCls}`}>
        <Search className={`w-4 h-4 ${subtleText}`} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by project, client, uploader or file name..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>

      {/* List */}
      {loading ? (
        <div className={`rounded-2xl p-10 flex flex-col items-center text-center gap-2 ${card}`}>
          <p className={`text-sm font-semibold ${cardText}`}>Loading...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={`rounded-2xl p-10 flex flex-col items-center text-center gap-2 ${card}`}>
          <span className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center">
            <Archive className="w-6 h-6" />
          </span>
          <p className={`text-sm font-semibold ${cardText}`}>
            {zipFiles.length === 0 ? "No zip files uploaded yet" : "No matches found"}
          </p>
          <p className={`text-xs max-w-sm ${mutedText}`}>
            {zipFiles.length === 0
              ? "Once a project's completed files are uploaded from its details page, they'll show up here."
              : "Try a different search term."}
          </p>
        </div>
      ) : (
        <div className={`rounded-2xl overflow-hidden ${card}`}>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map((f) => (
              <div key={f.id} className="px-4 py-3.5">
                <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                  <span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
                    <Archive className="w-4.5 h-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm font-semibold truncate ${cardText}`}>{f.projectName}</p>
                      {/* source badge — batata hai ye zip Project ki completed_zip hai
                          ya kisi Task se attach hui hai */}
                      <span
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                          f.source === "task" ? "bg-amber-50 text-amber-600" : "bg-violet-50 text-violet-600"
                        }`}
                      >
                        {f.source === "task" ? "Task" : "Project"}
                      </span>
                    </div>
                    <p className={`text-[11px] truncate ${subtleText}`}>{f.fileName}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Building2 className={`w-3.5 h-3.5 ${subtleText}`} />
                    <span className={`text-xs ${mutedText}`}>{f.client}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <User className={`w-3.5 h-3.5 ${subtleText}`} />
                    <span className={`text-xs ${mutedText}`}>{f.uploadedBy}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Calendar className={`w-3.5 h-3.5 ${subtleText}`} />
                    <span className={`text-xs ${mutedText}`}>{fmtDate(f.uploadedOn)}</span>
                  </div>
                  <span className={`text-xs font-semibold shrink-0 ${mutedText}`}>{(f.size || 0).toFixed(1)} MB</span>
                  <button
                    onClick={() => handleDownload(f)}
                    className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" /> Download
                  </button>

                  {confirmDeleteId === f.id ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`text-[11px] ${mutedText}`}>Delete?</span>
                      <button
                        onClick={() => handleDelete(f)}
                        className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold px-2.5 py-1.5 rounded-full"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${inputCls}`}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(f.id)}
                      aria-label="Delete zip file"
                      className="flex items-center justify-center w-8 h-8 rounded-full border border-rose-200 text-rose-500 hover:bg-rose-50 shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Project details — shown underneath so the row above stays
                    scannable, but the full description is still right here. */}
                {f.projectDetails && (
                  <div className="flex items-start gap-1.5 mt-2 pl-[52px]">
                    <FileText className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${subtleText}`} />
                    <p className={`text-xs ${mutedText}`}>{f.projectDetails}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[100] w-[calc(100%-2rem)] max-w-sm">
          <div className={`rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-white ${toast.tone === "error" ? "bg-rose-600" : "bg-emerald-600"}`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}