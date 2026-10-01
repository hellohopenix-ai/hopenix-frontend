import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { API_ROOT } from "../apiConfig.js";
import {
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  LineChart,
  Users,
  Briefcase,
  Sparkles,
  ShieldCheck,
  KeyRound,
  Loader2,
  CheckCircle2,
  XCircle,
  PartyPopper,
} from "lucide-react";
import BrandImg from "../components/BrandImg.jsx";

/* ===========================================================================
   ForgotPasswordPage - fully self-contained, matching the same dark
   auth-shell visual language as LoginPage.jsx / RegisterPage.jsx (its own
   copy of the brand panel + styles, on purpose, per this project's
   "each auth page stands alone" convention).

   Flow: enter email (validated) -> "send" a reset code (simulated, since
   there's no email server here — the code is shown on-screen, the same
   way the social-login buttons simulate a provider round trip) -> enter
   the code + a new password -> success.

   If your AuthContext.jsx exposes a `resetPassword(email, newPassword)`
   function, this page will call it so the new password actually takes
   effect for later logins. If it doesn't exist yet, the flow still runs
   end-to-end as a demo and tells you so, instead of silently failing.
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
   password-rule logic as LoginPage.jsx / RegisterPage.jsx.
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
    return null;
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

function PasswordChecklist({ password }) {
  const c = getPasswordChecks(password);
  const Item = ({ ok, label }) => (
    <li className={`flex items-center gap-1.5 ${ok ? "text-emerald-400" : "text-slate-500"}`}>
      {ok ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <XCircle className="w-3 h-3 shrink-0" />}
      {label}
    </li>
  );
  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
      <Item ok={c.length} label="8+ characters" />
      <Item ok={c.uppercase} label="One uppercase letter" />
      <Item ok={c.lowercase} label="One lowercase letter" />
    </ul>
  );
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

function FeatureRow({ icon: Icon, title, desc }) {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      <div className="shrink-0 w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-violet-600/30 to-violet-900/40 border border-violet-500/20 flex items-center justify-center">
        <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-violet-300" />
      </div>
      <div>
        <p className="text-white font-semibold text-sm sm:text-[15px]">{title}</p>
        <p className="text-slate-400 text-xs sm:text-sm leading-snug mt-0.5">{desc}</p>
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
        stroke="url(#forgotArcGradient)"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="380" r="4" fill="#8b5cf6" className="phoenix-glow-dot" />
      <defs>
        <linearGradient id="forgotArcGradient" x1="0" y1="0" x2="0" y2="380" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function PhoenixHero() {
  return (
    <div className="relative mt-8 sm:mt-10 flex flex-col items-center justify-end w-full max-w-xs sm:max-w-sm mx-auto pb-4">
      <div className="phoenix-stage relative w-full flex flex-col items-center">
        <div className="phoenix-ambient-glow" />
        <BrandImg
          
          alt="Hopenix phoenix"
          className="phoenix-hero-img relative z-10 w-40 h-40 xs:w-48 xs:h-48 sm:w-56 sm:h-56 md:w-60 md:h-60 object-contain"
        />
        <div className="phoenix-pedestal-wrap">
          <div className="phoenix-pedestal-ring" />
          <div className="phoenix-pedestal-glow" />
        </div>
      </div>
    </div>
  );
}

function BrandPanel({ navigate }) {
  return (
    <div className="relative px-1 sm:px-2 lg:px-6 py-2">
      <DotGrid />
      <DecorativeArc />

      <button
        type="button"
        onClick={() => navigate("/")}
        className="flex items-center gap-3 mb-5 sm:mb-6"
        aria-label="Hopenix home"
      >
        <BrandImg
          
          alt="Hopenix"
          className="w-8 h-8 sm:w-9 sm:h-9 object-contain drop-shadow-[0_0_12px_rgba(139,92,246,0.5)]"
        />
        <span className="text-lg sm:text-xl font-extrabold tracking-tight text-white">
          HOPE<span className="text-violet-400">NIX</span>
        </span>
      </button>

      <h1 className="text-[clamp(1.5rem,5vw,2rem)] font-extrabold text-white leading-tight mb-3">
        Manage your business
        <br className="hidden xs:block" />
        {" "}smarter with <span className="text-violet-400">Hopenix</span>
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

      <PhoenixHero />
    </div>
  );
}

/* ----------------------------------------------------------------------
   REAL BACKEND CALLS — same /send-otp/ endpoint the login flow uses
   (so this reuses the same OtpCode model/6-digit-code logic), plus a
   dedicated /reset-password/ endpoint that verifies the code and sets
   the new password in one request.
---------------------------------------------------------------------- */

const API_BASE_URL = `${API_ROOT}/api/auth`;

async function sendResetOtp(email) {
  const res = await fetch(`${API_BASE_URL}/send-otp/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, check_user: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not send the reset code.");
  return data;
}

async function resetPasswordWithCode(email, code, newPassword) {
  const res = await fetch(`${API_BASE_URL}/reset-password/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code, new_password: newPassword }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not reset your password.");
  return data;
}

export default function ForgotPasswordPage() {
  const navigate = useNavigate();

  const [step, setStep] = useState("email"); // "email" | "code" | "success"
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const resendTimer = useRef(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  const emailStatus = useEmailVerification(email);

  useEffect(() => {
    return () => clearInterval(resendTimer.current);
  }, []);

  const startResendCooldown = () => {
    setResendCooldown(30);
    clearInterval(resendTimer.current);
    resendTimer.current = setInterval(() => {
      setResendCooldown((s) => {
        if (s <= 1) {
          clearInterval(resendTimer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const handleSendCode = async (e) => {
    e.preventDefault();
    setError("");

    if (!isValidEmailFormat(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    if (emailStatus === "checking") {
      setError("Still verifying your email address — please wait a moment.");
      return;
    }
    if (emailStatus === "invalid-domain") {
      setError("This email domain doesn't appear to exist. Please double-check it.");
      return;
    }

    setSending(true);
    try {
      await sendResetOtp(email);
      setStep("code");
      startResendCooldown();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setError("");
    setCodeInput("");
    try {
      await sendResetOtp(email);
      startResendCooldown();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");

    if (codeInput.trim().length < 6) {
      setError("Please enter the full 6-digit code.");
      return;
    }
    if (!isPasswordValid(newPassword)) {
      setError("Password must be at least 8 characters and include an uppercase and a lowercase letter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setResetting(true);
    try {
      await resetPasswordWithCode(email, codeInput.trim(), newPassword);
      setStep("success");
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#07060f] flex items-center justify-center overflow-y-auto p-3 sm:p-4 lg:p-6">
      <style>{`
        @keyframes phoenixFloat {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-14px); }
        }
        @keyframes phoenixGlowPulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.08); }
        }
        @keyframes pedestalPulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 0.9; }
        }
        .phoenix-hero-img {
          filter: drop-shadow(0 0 25px rgba(139,92,246,0.55)) drop-shadow(0 0 55px rgba(139,92,246,0.35));
          animation: phoenixFloat 4.5s ease-in-out infinite;
        }
        .phoenix-ambient-glow {
          position: absolute;
          top: 8%;
          left: 50%;
          transform: translateX(-50%);
          width: 220px;
          height: 220px;
          border-radius: 9999px;
          background: radial-gradient(circle, rgba(139,92,246,0.35) 0%, rgba(139,92,246,0) 70%);
          filter: blur(6px);
          animation: phoenixGlowPulse 4.5s ease-in-out infinite;
          pointer-events: none;
        }
        .phoenix-pedestal-wrap {
          position: relative;
          width: 180px;
          max-width: 80%;
          margin-top: -6px;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        .phoenix-pedestal-ring {
          width: 100%;
          height: 14px;
          border-radius: 9999px;
          border: 1px solid rgba(139,92,246,0.45);
          background: radial-gradient(ellipse at center, rgba(139,92,246,0.25) 0%, rgba(139,92,246,0.05) 60%, transparent 80%);
          animation: pedestalPulse 4.5s ease-in-out infinite;
        }
        .phoenix-pedestal-glow {
          margin-top: 6px;
          width: 60%;
          height: 6px;
          border-radius: 9999px;
          background: radial-gradient(ellipse at center, rgba(196,181,253,0.9) 0%, rgba(139,92,246,0.3) 45%, transparent 75%);
          filter: blur(3px);
          animation: pedestalPulse 4.5s ease-in-out infinite;
        }
        .phoenix-glow-dot {
          animation: phoenixGlowPulse 3s ease-in-out infinite;
        }
      `}</style>

      <div className="w-full max-w-6xl grid lg:grid-cols-2 gap-8 lg:gap-10 items-center py-4">
        <BrandPanel navigate={navigate} />

        <div className="bg-[#0d0c18] border border-[#232134] rounded-3xl p-5 xs:p-6 sm:p-8 shadow-2xl">
          {step === "email" && (
            <>
              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-2xl bg-violet-600/15 border border-violet-500/30 flex items-center justify-center mx-auto mb-4">
                  <KeyRound className="w-5 h-5 text-violet-400" />
                </div>
                <p className="text-violet-400 text-xs font-bold tracking-widest uppercase mb-2">
                  Reset Your Password
                </p>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white mb-1.5">
                  Forgot your <span className="text-violet-400">password?</span>
                </h2>
                <p className="text-slate-400 text-sm">
                  Enter the email on your account and we'll send you a reset code.
                </p>
              </div>

              <form onSubmit={handleSendCode} className="space-y-4">
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

                {error && <p className="text-sm text-rose-400">{error}</p>}

                <button
                  type="submit"
                  disabled={sending}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40 disabled:opacity-60"
                >
                  {sending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Sending code...
                    </>
                  ) : (
                    <>
                      Send Reset Code
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-sm text-slate-400 mt-6">
                Remembered your password?{" "}
                <button
                  type="button"
                  onClick={() => navigate("/login")}
                  className="text-violet-400 hover:text-violet-300 font-medium transition"
                >
                  Back to sign in
                </button>
              </p>
            </>
          )}

          {step === "code" && (
            <>
              <button
                type="button"
                onClick={() => setStep("email")}
                className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition mb-4"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </button>

              <div className="text-center mb-6">
                <div className="w-12 h-12 rounded-2xl bg-violet-600/15 border border-violet-500/30 flex items-center justify-center mx-auto mb-4">
                  <KeyRound className="w-5 h-5 text-violet-400" />
                </div>
                <p className="text-violet-400 text-xs font-bold tracking-widest uppercase mb-2">
                  Check Your Code
                </p>
                <h2 className="text-xl sm:text-2xl font-extrabold text-white mb-1.5">
                  Enter reset <span className="text-violet-400">code</span>
                </h2>
                <p className="text-slate-400 text-sm">
                  We sent a 6-digit code to <span className="text-slate-200">{email}</span>.
                </p>
              </div>

              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    6-Digit Code
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-full bg-[#121022] border border-[#2a2740] rounded-xl py-3 px-4 text-center text-lg tracking-[0.5em] text-white placeholder:text-slate-600 placeholder:tracking-[0.5em] outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
                  />
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendCooldown > 0}
                    className="mt-2 text-xs text-violet-400 hover:text-violet-300 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : "Resend code"}
                  </button>
                </div>

                <div>
                  <div className="flex flex-col xs:flex-row xs:items-center xs:justify-between mb-2 gap-1 xs:gap-2">
                    <label className="block text-sm font-medium text-slate-200">New Password</label>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      minLength={8}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Create a new password"
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
                  {newPassword.length > 0 && <PasswordChecklist password={newPassword} />}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-200 mb-2">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showConfirm ? "text" : "password"}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your new password"
                      className={`w-full bg-[#121022] border rounded-xl py-3 pl-11 pr-11 text-sm text-white placeholder:text-slate-500 outline-none focus:ring-1 transition ${
                        confirmPassword && confirmPassword !== newPassword
                          ? "border-rose-500/70 focus:border-rose-500 focus:ring-rose-500"
                          : "border-[#2a2740] focus:border-violet-500 focus:ring-violet-500"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirm((s) => !s)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                      aria-label={showConfirm ? "Hide password" : "Show password"}
                    >
                      {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {confirmPassword && confirmPassword !== newPassword && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-400">
                      <XCircle className="w-3 h-3" /> Passwords don't match.
                    </p>
                  )}
                </div>

                {error && <p className="text-sm text-rose-400">{error}</p>}

                <button
                  type="submit"
                  disabled={resetting}
                  className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40 disabled:opacity-60"
                >
                  {resetting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      Reset Password
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>
            </>
          )}

          {step === "success" && (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto mb-5">
                <PartyPopper className="w-6 h-6 text-emerald-400" />
              </div>
              <p className="text-emerald-400 text-xs font-bold tracking-widest uppercase mb-2">
                Password Reset
              </p>
              <h2 className="text-xl sm:text-2xl font-extrabold text-white mb-2">
                You're all <span className="text-violet-400">set!</span>
              </h2>
              <p className="text-slate-400 text-sm max-w-sm mx-auto leading-relaxed mb-1">
                Your password has been changed successfully.
              </p>
              <button
                type="button"
                onClick={() => navigate("/login")}
                className="mt-5 w-full max-w-xs mx-auto flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40"
              >
                Back to Sign In
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {step !== "success" && (
            <div className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5" />
              Your data is protected with enterprise-grade security
            </div>
          )}
        </div>
      </div>
    </div>
  );
}