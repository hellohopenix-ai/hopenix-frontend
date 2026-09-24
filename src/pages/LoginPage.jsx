import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useGoogleLogin } from "@react-oauth/google";
import { useAuth } from "../AuthContext.jsx";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  LineChart,
  Users,
  Briefcase,
  Sparkles,
  ShieldCheck,
  LayoutGrid,
  BarChart3,
  Clock,
  HelpCircle,
  Settings2,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import phoenixLogo from "../assets/phoenix-logo.png";

/* ===========================================================================
   LoginPage - fully self-contained. It does NOT import or share any brand
   panel / dashboard-preview / auth-shell code with RegisterPage.jsx. Each
   page has its own copy below, on purpose, so a bug on one page can never
   be caused by (or leak in from) code the other page also uses.
   =========================================================================== */

const features = [
  {
    icon: LineChart,
    title: "Track Income & Expenses",
    desc: "Stay on top of your cash flow and financial health.",
  },
  {
    icon: Users,
    title: "Manage Employees",
    desc: "Assign tasks, track performance and manage team efficiently.",
  },
  {
    icon: Briefcase,
    title: "Manage Projects",
    desc: "Organize projects, set deadlines and track progress in real-time.",
  },
  {
    icon: Sparkles,
    title: "AI Assistant",
    desc: "Add expenses, income and get insights using natural language.",
  },
];

/* ----------------------------------------------------------------------
   VALIDATION HELPERS — same email-format + real-domain check and
   password-rule logic as RegisterPage.jsx / ForgotPasswordPage.jsx.
   Duplicated on purpose to keep this page self-contained.
---------------------------------------------------------------------- */

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function isValidEmailFormat(email) {
  return EMAIL_REGEX.test((email || "").trim());
}

async function checkEmailDomainExists(email) {
  const domain = (email || "").split("@")[1];
  if (!domain) return false;
  try {
    const mxRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=MX`);
    const mxData = await mxRes.json();
    if (mxData.Status === 0 && Array.isArray(mxData.Answer) && mxData.Answer.length > 0) return true;

    const aRes = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=A`);
    const aData = await aRes.json();
    if (aData.Status === 0 && Array.isArray(aData.Answer) && aData.Answer.length > 0) return true;

    return false;
  } catch {
    return null; // network/DNS lookup failed — treat as "unknown", don't hard-block the user
  }
}

function getPasswordChecks(pw) {
  const value = pw || "";
  return {
    length: value.length >= 8,
    uppercase: /[A-Z]/.test(value),
    lowercase: /[a-z]/.test(value),
  };
}

function isPasswordValid(pw) {
  const c = getPasswordChecks(pw);
  return c.length && c.uppercase && c.lowercase;
}

function EmailStatusHint({ status }) {
  if (status === "checking") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500">
        <Loader2 className="w-3 h-3 animate-spin" /> Verifying this email address exists...
      </p>
    );
  }
  if (status === "invalid-format") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-400">
        <XCircle className="w-3 h-3" /> Enter a valid email address.
      </p>
    );
  }
  if (status === "invalid-domain") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-400">
        <XCircle className="w-3 h-3" /> This email domain doesn't appear to exist or accept mail. Check for typos.
      </p>
    );
  }
  if (status === "valid") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-emerald-400">
        <CheckCircle2 className="w-3 h-3" /> Email looks valid.
      </p>
    );
  }
  if (status === "unknown") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400">
        <XCircle className="w-3 h-3" /> Couldn't verify right now — double-check it's correct.
      </p>
    );
  }
  return null;
}

function useEmailVerification(email) {
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    if (!email) {
      setStatus("idle");
      return;
    }
    if (!isValidEmailFormat(email)) {
      setStatus("invalid-format");
      return;
    }
    setStatus("checking");
    let cancelled = false;
    const timer = setTimeout(async () => {
      const exists = await checkEmailDomainExists(email);
      if (cancelled) return;
      if (exists === true) setStatus("valid");
      else if (exists === false) setStatus("invalid-domain");
      else setStatus("unknown");
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [email]);

  return status;
}

/* ----------------------------------------------------------------------
   OTP EMAIL VERIFICATION — after email + password pass validation, a
   6-digit code is generated and the user must enter it before the login
   actually finalizes. No real backend/email service is wired up yet, so
   the code is simply logged to the console (clearly marked) instead of
   being emailed — swap sendOtpEmail() for a real API call later.
---------------------------------------------------------------------- */

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000") + "/api/auth";

async function sendOtpEmail(email) {
  const res = await fetch(`${API_BASE_URL}/send-otp/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not send the verification email.");
  return data;
}

async function verifyOtpCode(email, code) {
  const res = await fetch(`${API_BASE_URL}/verify-otp/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Incorrect code. Please try again.");
  return data;
}

/* ----------------------------------------------------------------------
   OTP "only ask once" — once an email has completed the OTP step
   successfully on this browser, every login after that for that same
   email skips straight through (no code, no email sent), the same way
   a normal "remember this device" flow works. Keyed by email (not a
   single global flag) so logging in as a different account on the same
   browser still gets verified the first time.
---------------------------------------------------------------------- */
function otpVerifiedStorageKey(email) {
  return `hopenix_otp_verified_${(email || "").trim().toLowerCase()}`;
}

function hasVerifiedOtpBefore(email) {
  try {
    return localStorage.getItem(otpVerifiedStorageKey(email)) === "true";
  } catch {
    return false; // e.g. private browsing with storage blocked — fall back to asking
  }
}

function markOtpVerified(email) {
  try {
    localStorage.setItem(otpVerifiedStorageKey(email), "true");
  } catch {
    // storage blocked — nothing to do, next login will just ask again
  }
}

function OtpVerificationModal({ email, onVerified, onCancel }) {
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(30);
  const [resent, setResent] = useState(false);
  const inputsRef = useState(() => Array(6).fill(null))[0];
  // Guards against the OTP email being sent twice on open. Without this,
  // React 18 Strict Mode (dev) double-invokes effects — setup, cleanup,
  // setup again — and since this effect's job is a real network call
  // with no matching cleanup to "undo" it, that pattern fired
  // sendOtpEmail() twice back-to-back, so the backend generated and
  // emailed two different codes for the same login attempt. The ref
  // makes the actual send idempotent per mount: only the first effect
  // run is allowed through, no matter how many times the effect itself
  // re-executes.
  const otpSentRef = useRef(false);

  useEffect(() => {
    if (otpSentRef.current) return;
    otpSentRef.current = true;
    setSending(true);
    sendOtpEmail(email)
      .catch((err) => setError(err.message))
      .finally(() => setSending(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const focusInput = (i) => {
    const el = inputsRef[i];
    if (el) el.focus();
  };

  const handleDigitChange = (i, val) => {
    const v = val.replace(/\D/g, "").slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
    setError("");
    if (v && i < 5) focusInput(i + 1);
  };

  const handleKeyDown = (i, e) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      focusInput(i - 1);
    }
  };

  const handlePaste = (e) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!text) return;
    e.preventDefault();
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < 6; i++) next[i] = text[i] || "";
      return next;
    });
    setError("");
    focusInput(Math.min(text.length, 5));
  };

  const handleResend = () => {
    if (cooldown > 0) return;
    setDigits(["", "", "", "", "", ""]);
    setError("");
    setResent(false);
    sendOtpEmail(email)
      .then(() => setResent(true))
      .catch((err) => setError(err.message));
    setCooldown(30);
    focusInput(0);
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const entered = digits.join("");
    if (entered.length < 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }
    setVerifying(true);
    try {
      await verifyOtpCode(email, entered);
      setError("");
      onVerified();
    } catch (err) {
      setError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-3 sm:p-4" onClick={onCancel}>
      <form
        onSubmit={handleVerify}
        className="bg-[#0d0c18] border border-[#232134] rounded-3xl w-full max-w-sm p-6 sm:p-7 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600/30 to-violet-900/40 border border-violet-500/20 flex items-center justify-center mb-4 mx-auto">
          <ShieldCheck className="w-6 h-6 text-violet-300" />
        </div>
        <h2 className="text-center text-lg font-extrabold text-white mb-1.5">Verify your email</h2>
        <p className="text-center text-slate-400 text-sm mb-5">
          {sending ? (
            "Sending a code to "
          ) : (
            "We've sent a 6-digit code to "
          )}
          <span className="text-slate-200 font-medium">{email}</span>
        </p>

        <div className="flex items-center justify-center gap-2 mb-2" onPaste={handlePaste}>
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => (inputsRef[i] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="w-10 h-12 sm:w-11 sm:h-13 text-center text-lg font-semibold bg-[#121022] border border-[#2a2740] rounded-xl text-white outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
            />
          ))}
        </div>
        {error && <p className="text-sm text-rose-400 text-center mt-2">{error}</p>}
        {resent && !error && <p className="text-xs text-emerald-400 text-center mt-2">A new code has been sent.</p>}

        <button
          type="submit"
          disabled={verifying}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40 mt-5 disabled:opacity-60"
        >
          {verifying ? "Verifying..." : "Verify & Login"}
          <ArrowRight className="w-4 h-4" />
        </button>

        <div className="flex items-center justify-between mt-4 text-sm">
          <button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-300 transition">
            Change email
          </button>
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0}
            className="text-violet-400 hover:text-violet-300 transition disabled:opacity-50 disabled:hover:text-violet-400"
          >
            {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FeatureRow({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-4">
      <div className="shrink-0 w-11 h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-violet-900/40 border border-violet-500/20 flex items-center justify-center">
        <Icon className="w-5 h-5 text-violet-300" />
      </div>
      <div>
        <p className="text-white font-semibold text-[15px]">{title}</p>
        <p className="text-slate-400 text-sm leading-snug mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function DotGrid() {
  return (
    <div className="absolute right-2 top-2 hidden lg:grid grid-cols-4 gap-2.5 pointer-events-none select-none">
      {Array.from({ length: 16 }).map((_, i) => (
        <span key={i} className="w-1 h-1 rounded-full bg-violet-500/40" />
      ))}
    </div>
  );
}

function DecorativeArc() {
  return (
    <svg
      viewBox="0 0 420 520"
      className="absolute left-[300px] top-[260px] w-[220px] h-[300px] hidden xl:block pointer-events-none select-none overflow-visible"
      fill="none"
    >
      <path
        d="M0 0C60 60 90 140 60 220C35 285 -10 310 10 380"
        stroke="url(#loginArcGradient)"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="380" r="4" fill="#8b5cf6" className="phoenix-glow-dot" />
      <defs>
        <linearGradient id="loginArcGradient" x1="0" y1="0" x2="0" y2="380" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* Dashboard preview card + flying phoenix mascot for the LOGIN page.
   IMPORTANT: the phoenix mascot is a SIBLING of .dashboard-card, not a
   child of it. The card has overflow-hidden + a 3D transform (perspective/
   rotateX/rotateY) + backdrop-blur all at once, and nesting an intentionally
   overflowing, animated element inside that combo is a known cross-browser
   rendering trap (the card's own background/content can silently fail to
   paint). Keeping the phoenix outside the card sidesteps that entirely.

   All of .dashboard-card's tilt + .phoenix-corner/.phoenix-fly/etc.
   animation is defined in the <style> block inside LoginPage below, so
   this component renders correctly on its own without relying on any
   global stylesheet. */
function DashboardPreview() {
  return (
    <div className="relative mt-10 hidden md:block pb-10 sm:pb-14 w-full max-w-md mx-auto md:mx-0">
      <div className="dashboard-card relative w-[82%] rounded-2xl border border-violet-500/20 bg-[#0f0e1c]/90 backdrop-blur-sm shadow-2xl shadow-black/50 overflow-hidden">
        <div className="flex">
          <div className="flex flex-col items-center gap-4 py-5 px-2.5 bg-[#0b0a16]/70 border-r border-white/5">
            <img src={phoenixLogo} alt="" className="w-4 h-4 object-contain" />
            <LayoutGrid className="w-3.5 h-3.5 text-slate-600" />
            <BarChart3 className="w-3.5 h-3.5 text-slate-600" />
            <Clock className="w-3.5 h-3.5 text-slate-600" />
            <HelpCircle className="w-3.5 h-3.5 text-slate-600" />
            <Settings2 className="w-3.5 h-3.5 text-slate-600" />
          </div>

          <div className="flex-1 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-slate-300 font-medium">Dashboard</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-[#151328] rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500">Total Income</p>
                <p className="text-white text-xs font-semibold mt-1">PKR 1,250,000</p>
              </div>
              <div className="bg-[#151328] rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500">Total Expenses</p>
                <p className="text-white text-xs font-semibold mt-1">PKR 520,430</p>
              </div>
              <div className="bg-[#151328] rounded-lg p-2.5">
                <p className="text-[10px] text-slate-500">Projects</p>
                <p className="text-white text-xs font-semibold mt-1">28</p>
              </div>
            </div>
            <div className="bg-[#151328] rounded-lg p-3">
              <p className="text-[10px] text-slate-500 mb-2">Sales Overview</p>
              <svg viewBox="0 0 200 50" className="w-full h-12">
                <polyline
                  fill="none"
                  stroke="#8b5cf6"
                  strokeWidth="2"
                  points="0,35 20,28 40,32 60,15 80,22 100,10 120,18 140,8 160,20 180,12 200,18"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      <div className="phoenix-corner">
        <div className="phoenix-stack">
          <div className="phoenix-glow-ring" />
          <img src={phoenixLogo} alt="" className="phoenix-fly" />
          <div className="phoenix-pedestal-ring" />
          <div className="phoenix-pedestal-glow" />
        </div>
      </div>
    </div>
  );
}

function BrandPanel({ navigate }) {
  return (
    <div className="relative px-1 sm:px-2 lg:px-6 py-2 order-2 lg:order-1">
      <DotGrid />
      <DecorativeArc />

      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex items-center gap-3 mb-5 sm:mb-6"
        aria-label="Hopenix home"
      >
        <img
          src={phoenixLogo}
          alt="Hopenix"
          className="w-9 h-9 object-contain drop-shadow-[0_0_12px_rgba(139,92,246,0.5)]"
        />
        <span className="text-xl font-extrabold tracking-tight text-white">
          HOPE<span className="text-violet-400">NIX</span>
        </span>
      </button>

      <h1 className="text-[clamp(1.6rem,3.2vw,2rem)] font-extrabold text-white leading-tight mb-3">
        Manage your business
        <br />
        smarter with <span className="text-violet-400">Hopenix</span>
      </h1>
      <p className="text-slate-400 max-w-md mb-6 leading-relaxed text-sm">
        All-in-one platform to manage projects, employees, income, expenses
        and grow your business with AI assistance.
      </p>

      <div className="space-y-3.5 max-w-md">
        {features.map((f) => (
          <FeatureRow key={f.title} {...f} />
        ))}
      </div>

      <DashboardPreview />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.89c2.27-2.09 3.57-5.17 3.57-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.89-3.02c-1.08.73-2.46 1.16-4.06 1.16-3.12 0-5.77-2.11-6.71-4.94H1.28v3.11A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.29 14.3a7.2 7.2 0 0 1 0-4.6V6.59H1.28a12 12 0 0 0 0 10.82z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.59l4.01 3.11C6.23 6.87 8.88 4.76 12 4.76z"
      />
    </svg>
  );
}

function CheckBox({ checked, onChange }) {
  return (
    <span
      className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center transition ${
        checked ? "bg-violet-600 border-violet-600" : "bg-transparent border-[#2a2740]"
      }`}
    >
      {checked && (
        <svg viewBox="0 0 12 10" className="w-3 h-3 fill-none stroke-white stroke-[2]">
          <polyline points="1,5 4,8 11,1" />
        </svg>
      )}
    </span>
  );
}

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginUser, loginWithGoogle, logout } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [socialLoading, setSocialLoading] = useState(null); // "google" | null
  const [otpOpen, setOtpOpen] = useState(false);
  const [pendingUser, setPendingUser] = useState(null); // set once loginUser() succeeds, used once OTP is verified

  const emailStatus = useEmailVerification(email);

  const [loggingIn, setLoggingIn] = useState(false);

  // Runs only AFTER the OTP has been verified — routes based on the
  // user object we already got back from loginUser() in handleSubmit.
  function routeAfterLogin(user) {
    if (!user) return;
    if (user.status === "pending") {
      navigate("/pending-approval");
    } else if (user.status === "rejected") {
      setError("Your account request was declined. Contact your admin.");
    } else {
      navigate("/dashboard");
    }
  }

  function finalizeLogin() {
    if (!pendingUser) return;
    // This email just proved it owns the inbox — remember that so future
    // logins for this same email skip the OTP step entirely.
    markOtpVerified(email);
    routeAfterLogin(pendingUser);
    setPendingUser(null);
  }

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!isValidEmailFormat(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (emailStatus === "invalid-domain") {
      setError("This email domain doesn't appear to exist. Please double-check it.");
      return;
    }
    if (!isPasswordValid(password)) {
      setError("Password must be at least 8 characters and include an uppercase and a lowercase letter.");
      return;
    }

    setError("");
    setLoggingIn(true);
    const result = await loginUser(email, password);
    setLoggingIn(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    // Password is correct. Only ask for the OTP if this email hasn't
    // already verified one on this device before — once verified, every
    // login after that for this email goes straight through.
    if (hasVerifiedOtpBefore(email)) {
      routeAfterLogin(result.user);
      return;
    }
    setPendingUser(result.user);
    setOtpOpen(true);
  };

  const handleGoogleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setSocialLoading("google");
      const result = await loginWithGoogle(tokenResponse.access_token);
      setSocialLoading(null);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setError("");
      if (result.user.status === "pending") {
        navigate("/pending-approval");
      } else if (result.user.status === "rejected") {
        setError("Your account request was declined. Contact your admin.");
      } else {
        navigate("/dashboard");
      }
    },
    onError: () => {
      setSocialLoading(null);
      setError("Google Sign-In failed (Origin Mismatch). Please make sure http://localhost:5173 and http://127.0.0.1:5173 are registered under Authorized JavaScript Origins in Google Cloud Console.");
    },
  });

  const handleSocialLogin = (provider) => {
    if (provider === "google") {
      setError("");
      handleGoogleLogin();
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#07060f] flex items-start lg:items-center justify-center overflow-y-auto p-3 sm:p-4 lg:p-6">
      <style>{`
        @keyframes phoenixFloat {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-12px) rotate(-1.5deg); }
        }
        @keyframes beamPulse {
          0%, 100% { opacity: 0.55; }
          50% { opacity: 0.9; }
        }
        @keyframes pedestalPulse {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.05); }
        }

        /* 3D tilt on the dashboard card - RIGHT side recedes "into" the
           screen, LEFT side comes forward toward the viewer, matching the
           reference image exactly. */
        .dashboard-card {
          transform: perspective(900px) rotateY(14deg) rotateX(4deg) scale(0.97);
          transform-origin: left center;
        }

        /* phoenix sits right against the card's bottom-right corner, in
           the space freed up now that the card is only 82% wide */
        .phoenix-corner {
          position: absolute;
          right: -4%;
          bottom: -12px;
          width: 42%;
          min-width: 175px;
          max-width: 240px;
          pointer-events: none;
          z-index: 5;
        }

        /* vertical light beam behind the bird */
        .phoenix-glow-ring {
          position: absolute;
          top: -150px;
          left: calc(50% + 24px);
          transform: translateX(-50%);
          width: 40%;
          height: 260px;
          background: linear-gradient(to bottom, rgba(139,92,246,0.55), rgba(139,92,246,0.08) 65%, transparent 100%);
          clip-path: polygon(38% 0%, 62% 0%, 100% 100%, 0% 100%);
          filter: blur(10px);
          animation: beamPulse 4s ease-in-out infinite;
          z-index: 1;
        }

        /* single relative anchor: the beam, bird, and both pedestal shapes
           all use the exact same "left: 50%; transform: translateX(-50%)"
           rule against THIS one parent, so there is only one possible
           center line and nothing can drift apart. */
        .phoenix-stack {
          position: relative;
          width: 100%;
        }

        .phoenix-fly {
          position: relative;
          z-index: 3;
          display: block;
          margin: 0 auto;
          width: 88%;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 0 22px rgba(139,92,246,0.65)) drop-shadow(0 0 46px rgba(139,92,246,0.4));
          animation: phoenixFloat 4.5s ease-in-out infinite;
        }

        .phoenix-pedestal-ring {
          position: absolute;
          left: calc(50% - 32px);
          transform: translateX(-50%);
          bottom: 6px;
          z-index: 2;
          width: 66%;
          height: 16px;
          border-radius: 9999px;
          border: 1px solid rgba(139,92,246,0.5);
          background: radial-gradient(ellipse at center, rgba(139,92,246,0.3) 0%, rgba(139,92,246,0.05) 60%, transparent 80%);
          animation: pedestalPulse 4.5s ease-in-out infinite;
        }

        .phoenix-pedestal-glow {
          position: absolute;
          left: calc(50% - 32px);
          transform: translateX(-50%);
          bottom: 0px;
          z-index: 2;
          width: 42%;
          height: 8px;
          border-radius: 9999px;
          background: radial-gradient(ellipse at center, rgba(196,181,253,0.9) 0%, rgba(139,92,246,0.3) 50%, transparent 75%);
          filter: blur(3px);
          animation: pedestalPulse 4.5s ease-in-out infinite;
        }

        .phoenix-glow-dot {
          animation: beamPulse 3s ease-in-out infinite;
        }

        @media (max-width: 1024px) {
          .phoenix-corner { right: -8%; bottom: -40px; }
        }
      `}</style>

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-6 lg:gap-10 items-center py-4">
        <BrandPanel navigate={navigate} />

        <div className="order-1 lg:order-2 bg-[#0d0c18] border border-[#232134] rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <p className="text-violet-400 text-xs font-bold tracking-widest uppercase mb-2">
              Welcome Back
            </p>
            <h2 className="text-2xl font-extrabold text-white mb-1.5">
              Glad to see <span className="text-violet-400">you</span> again!
            </h2>
            <p className="text-slate-400 text-sm">Login to your Hopenix account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => setEmailTouched(true)}
                  placeholder="Enter your email"
                  className={`w-full bg-[#121022] border rounded-xl py-3 pl-11 pr-9 text-sm text-white placeholder:text-slate-500 outline-none focus:ring-1 transition ${
                    emailTouched && (emailStatus === "invalid-format" || emailStatus === "invalid-domain")
                      ? "border-rose-500/70 focus:border-rose-500 focus:ring-rose-500"
                      : "border-[#2a2740] focus:border-violet-500 focus:ring-violet-500"
                  }`}
                />
                {emailStatus === "checking" && (
                  <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 animate-spin" />
                )}
                {emailStatus === "valid" && (
                  <CheckCircle2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400" />
                )}
                {(emailStatus === "invalid-format" || emailStatus === "invalid-domain") && emailTouched && (
                  <XCircle className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400" />
                )}
              </div>
              {emailTouched && <EmailStatusHint status={emailStatus} />}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-slate-200">Password</label>
                <button
                  type="button"
                  onClick={() => navigate("/forgot-password")}
                  className="text-sm text-violet-400 hover:text-violet-300 transition"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full bg-[#121022] border border-[#2a2740] rounded-xl py-3 pl-11 pr-11 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">
                Must be 8+ characters with an uppercase and a lowercase letter.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="peer sr-only"
                />
                <CheckBox checked={remember} />
                <span className="text-sm text-slate-200">Remember me</span>
              </label>
              <span className="text-xs text-slate-500 hidden sm:block">
                Keep me signed in on this device
              </span>
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40 disabled:opacity-60"
            >
              {loggingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Login
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="flex items-center gap-4 my-5">
            <div className="h-px flex-1 bg-[#232134]" />
            <span className="text-xs text-slate-500 whitespace-nowrap">or continue with</span>
            <div className="h-px flex-1 bg-[#232134]" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => handleSocialLogin("google")}
              disabled={socialLoading !== null}
              className="flex items-center justify-center gap-2 border border-[#2a2740] rounded-xl py-2.5 text-sm text-slate-200 hover:bg-[#141225] transition disabled:opacity-60"
            >
              {socialLoading === "google" ? (
                <span className="w-4 h-4 rounded-full border-2 border-slate-500 border-t-violet-400 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              Continue with Google
            </button>
          </div>

          <p className="text-center text-sm text-slate-400 mt-5">
            Don&apos;t have an account?{" "}
            <button
              type="button"
              onClick={() => navigate("/register")}
              className="text-violet-400 hover:text-violet-300 font-medium transition"
            >
              Sign up
            </button>
          </p>

          <div className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5" />
            Your data is protected with enterprise-grade security
          </div>
        </div>
      </div>

      {otpOpen && (
        <OtpVerificationModal
          email={email}
          onVerified={() => {
            setOtpOpen(false);
            finalizeLogin();
          }}
          onCancel={() => {
            // Password was already correct at this point (that's the only
            // way this modal opens), so a token + user are already saved.
            // Since OTP wasn't completed, log back out instead of leaving
            // them silently authenticated without finishing verification.
            setOtpOpen(false);
            setPendingUser(null);
            logout();
          }}
        />
      )}
    </div>
  );
}