import { useState, useEffect } from "react";
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
  User,
  Building2,
  Loader2,
  CheckCircle2,
  XCircle,
  Check,
} from "lucide-react";
import phoenixLogo from "../assets/phoenix-logo.png";

/* ===========================================================================
   RegisterPage - fully self-contained. Matches the reference design 1:1:
   left panel = logo, heading, feature list, then a large glowing phoenix
   sitting on a light pedestal (NO dashboard preview card anymore).
   Fully responsive: phoenix + everything else scales/stacks down to
   small mobile widths.
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
   VALIDATION HELPERS — email format + real-world domain check (via a
   key-less, CORS-enabled DNS-over-HTTPS lookup, since a browser can't
   actually contact a mailbox to confirm delivery) and password rules.
   Duplicated in LoginPage.jsx / ForgotPasswordPage.jsx on purpose — each
   auth page stays self-contained per this project's convention.
---------------------------------------------------------------------- */

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function isValidEmailFormat(email) {
  return EMAIL_REGEX.test((email || "").trim());
}

// Verifies the email's domain actually has mail servers configured
// (MX record), falling back to an A record. This is the closest a
// browser can get to confirming an address "really exists" without a
// backend mail server of its own — it can't check a specific mailbox,
// but it reliably catches typos, fake, and non-existent domains.
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
        stroke="url(#registerArcGradient)"
        strokeWidth="1.5"
      />
      <circle cx="10" cy="380" r="4" fill="#8b5cf6" className="phoenix-glow-dot" />
      <defs>
        <linearGradient id="registerArcGradient" x1="0" y1="0" x2="0" y2="380" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* Large floating phoenix on a lit pedestal — replaces the old dashboard
   preview card entirely, matching the reference image. Pure CSS
   (keyframes injected via a scoped <style> tag below) so no extra
   dependencies are required. */
function PhoenixHero() {
  return (
    <div className="relative mt-8 sm:mt-10 flex flex-col items-center justify-end w-full max-w-xs sm:max-w-sm mx-auto pb-4">
      <div className="phoenix-stage relative w-full flex flex-col items-center">
        {/* ambient glow behind the bird */}
        <div className="phoenix-ambient-glow" />

        {/* the bird itself, floating */}
        <img
          src={phoenixLogo}
          alt="Hopenix phoenix"
          className="phoenix-hero-img relative z-10 w-40 h-40 xs:w-48 xs:h-48 sm:w-56 sm:h-56 md:w-60 md:h-60 object-contain"
        />

        {/* pedestal light */}
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

function CheckBox({ checked }) {
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

export default function RegisterPage() {
  const navigate = useNavigate();
  const { registerUser, signupWithGoogle } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [skill, setSkill] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [agree, setAgree] = useState(true);
  const [error, setError] = useState("");
  const [socialLoading, setSocialLoading] = useState(null);

  const emailStatus = useEmailVerification(email);
  const emailIsUsable = emailStatus === "valid" || emailStatus === "unknown";

  const handleSubmit = async (e) => {
    e.preventDefault();

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
    if (!isPasswordValid(password)) {
      setError("Password must be at least 8 characters and include an uppercase and a lowercase letter.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (!agree) {
      setError("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }

    const result = await registerUser({
      name: fullName,
      email: email || "you@hopenix.com",
      password,
      skill,
    });

    if (!result.success) {
      setError(result.error);
      return;
    }

    setError("");
    // Signup succeeded — the account exists but still needs profile
    // details (personal info, education/experience, ID card, bank
    // account) before it goes into the approval queue.
    navigate("/complete-profile");
  };

  const handleGoogleSignup = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setSocialLoading("google");
      const result = await signupWithGoogle(tokenResponse.access_token);
      setSocialLoading(null);
      if (!result.success) {
        setError(result.error);
        return;
      }
      // Always straight to Complete Profile, same as a normal signup.
      navigate("/complete-profile");
    },
    onError: () => {
      setSocialLoading(null);
      setError("Google Sign-Up failed (Origin Mismatch). Please make sure http://localhost:5173 and http://127.0.0.1:5173 are registered under Authorized JavaScript Origins in Google Cloud Console.");
    },
  });

  const handleSocialSignup = (provider) => {
    if (provider === "google") {
      setError("");
      handleGoogleSignup();
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#07060f] flex items-start lg:items-center justify-center overflow-y-auto p-3 sm:p-4 lg:p-6">
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

        <div className="order-1 lg:order-2 bg-[#0d0c18] border border-[#232134] rounded-3xl p-5 xs:p-6 sm:p-8 shadow-2xl">
          <div className="text-center mb-6">
            <p className="text-violet-400 text-xs font-bold tracking-widest uppercase mb-2">
              Create Your Account
            </p>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white mb-1.5">
              Let&apos;s get you <span className="text-violet-400">started</span>
            </h2>
            <p className="text-slate-400 text-sm">Create your Hopenix account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-200 mb-2">
                  Full Name
                </label>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full bg-[#121022] border border-[#2a2740] rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
                  />
                </div>
              </div>

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
            </div>

            <div>
              <div className="flex flex-col xs:flex-row xs:items-center xs:justify-between mb-2 gap-1 xs:gap-2">
                <label className="block text-sm font-medium text-slate-200">Password</label>
                <span className="text-xs text-slate-500 xs:text-right">
                  Use 8+ characters with letters &amp; numbers
                </span>
              </div>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a password"
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
              {password.length > 0 && <PasswordChecklist password={password} />}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type={showConfirm ? "text" : "password"}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className={`w-full bg-[#121022] border rounded-xl py-3 pl-11 pr-11 text-sm text-white placeholder:text-slate-500 outline-none focus:ring-1 transition ${
                    confirmPassword && confirmPassword !== password
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
              {confirmPassword && confirmPassword !== password && (
                <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-rose-400">
                  <XCircle className="w-3 h-3" /> Passwords don't match.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-200 mb-2">
                Skills <span className="text-slate-500 font-normal">(Optional)</span>
              </label>
              <div className="relative">
                <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={skill}
                  onChange={(e) => setSkill(e.target.value)}
                  placeholder="Enter your skill"
                  className="w-full bg-[#121022] border border-[#2a2740] rounded-xl py-3 pl-11 pr-4 text-sm text-white placeholder:text-slate-500 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition"
                />
              </div>
            </div>

            {error && <p className="text-sm text-rose-400">{error}</p>}

            <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={agree}
                onChange={(e) => setAgree(e.target.checked)}
                className="peer sr-only"
              />
              <span className="mt-0.5">
                <CheckBox checked={agree} />
              </span>
              <span className="text-sm text-slate-300 leading-snug">
                I agree to the{" "}
                <button type="button" className="text-violet-400 hover:text-violet-300 transition">
                  Terms of Service
                </button>{" "}
                and{" "}
                <button type="button" className="text-violet-400 hover:text-violet-300 transition">
                  Privacy Policy
                </button>
              </span>
            </label>

            <button
              type="submit"
              disabled={!emailIsUsable && emailTouched}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Account
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <div className="flex items-center gap-4 my-5">
            <div className="h-px flex-1 bg-[#232134]" />
            <span className="text-xs text-slate-500 whitespace-nowrap">or sign up with</span>
            <div className="h-px flex-1 bg-[#232134]" />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:gap-4">
            <button
              type="button"
              onClick={() => handleSocialSignup("google")}
              disabled={socialLoading !== null}
              className="flex items-center justify-center gap-2 border border-[#2a2740] rounded-xl py-2.5 text-sm text-slate-200 hover:bg-[#141225] transition disabled:opacity-60"
            >
              {socialLoading === "google" ? (
                <span className="w-4 h-4 rounded-full border-2 border-slate-500 border-t-violet-400 animate-spin" />
              ) : (
                <GoogleIcon />
              )}
              Sign up with Google
            </button>
          </div>

          <p className="text-center text-sm text-slate-400 mt-5">
            Already have an account?{" "}
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="text-violet-400 hover:text-violet-300 font-medium transition"
            >
              Sign in
            </button>
          </p>

          <div className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5" />
            Your data is protected with enterprise-grade security
          </div>
        </div>
      </div>
    </div>
  );
}