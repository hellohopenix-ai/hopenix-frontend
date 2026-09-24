import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.jsx";
import { Clock, LogOut, RefreshCw, XCircle, ShieldCheck } from "lucide-react";
import phoenixLogo from "../assets/phoenix-logo.png";

/* ===========================================================================
   PendingApprovalPage - shown to a user who is logged in but whose account
   is not approved yet. Matches the dark/violet Hopenix auth-page language
   used by LoginPage / RegisterPage (same background, card, and phoenix
   glow treatment) so it doesn't feel like a different app.
   =========================================================================== */

export default function PendingApprovalPage() {
  const navigate = useNavigate();
  const { user, users, logout } = useAuth();

  // Re-read this user's live status from the shared users list every time
  // it changes (e.g. an admin approves them in another tab) so this screen
  // updates itself instead of needing a manual refresh.
  const liveUser = users?.find((u) => u.id === user?.id) || user;

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    if (liveUser?.status === "approved") {
      navigate("/dashboard");
    }
  }, [user, liveUser, navigate]);

  const isRejected = liveUser?.status === "rejected";

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen w-full bg-[#07060f] flex items-center justify-center overflow-y-auto p-4">
      <style>{`
        @keyframes pendingPulse {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.06); }
        }
        .pending-glow {
          animation: pendingPulse 2.6s ease-in-out infinite;
        }
      `}</style>

      <div className="w-full max-w-md bg-[#0d0c18] border border-[#232134] rounded-3xl p-8 shadow-2xl text-center">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <img
            src={phoenixLogo}
            alt="Hopenix"
            className="w-8 h-8 object-contain drop-shadow-[0_0_12px_rgba(139,92,246,0.5)]"
          />
          <span className="text-lg font-extrabold tracking-tight text-white">
            HOPE<span className="text-violet-400">NIX</span>
          </span>
        </div>

        <div className="relative w-16 h-16 mx-auto mb-6 flex items-center justify-center">
          <span
            className={`pending-glow absolute inset-0 rounded-full blur-md ${
              isRejected ? "bg-rose-500/30" : "bg-violet-500/30"
            }`}
          />
          <span
            className={`relative w-16 h-16 rounded-2xl flex items-center justify-center border ${
              isRejected
                ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                : "bg-violet-600/15 border-violet-500/30 text-violet-300"
            }`}
          >
            {isRejected ? <XCircle className="w-7 h-7" /> : <Clock className="w-7 h-7" />}
          </span>
        </div>

        {isRejected ? (
          <>
            <h1 className="text-xl font-extrabold text-white mb-2">
              Access request declined
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-6">
              Your admin hasn&apos;t approved this account. If you think this is a
              mistake, reach out to your company&apos;s Hopenix admin directly.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-extrabold text-white mb-2">
              Waiting for admin approval
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed mb-1">
              Your account has been created for
            </p>
            <p className="text-violet-300 text-sm font-semibold mb-6 break-all">
              {liveUser?.email}
            </p>
            <p className="text-slate-500 text-xs leading-relaxed mb-6">
              An admin needs to approve your account before you can access
              tasks, projects, and the rest of Hopenix. You&apos;ll be moved
              to your dashboard automatically the moment you&apos;re approved.
            </p>
          </>
        )}

        <div className="flex flex-col gap-3">
          {!isRejected && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-fuchsia-500 hover:from-violet-500 hover:to-fuchsia-400 text-white font-semibold py-3 rounded-xl transition shadow-lg shadow-violet-900/40"
            >
              <RefreshCw className="w-4 h-4" />
              Check status again
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 border border-[#2a2740] text-slate-200 hover:bg-[#141225] font-semibold py-3 rounded-xl transition"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>

        <div className="flex items-center justify-center gap-2 mt-6 text-xs text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5" />
          Your data is protected with enterprise-grade security
        </div>
      </div>
    </div>
  );
}
