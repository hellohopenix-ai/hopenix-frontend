import React, { useEffect, useState } from "react";
import { canInstallApp, installHopenixApp, isStandalone, PHONE_TIPS } from "../installApp.js";

// Settings → Notifications: what to do when notifications reach the laptop but
// not the phone while the phone is locked / Hopenix is closed.
export default function PhoneNotificationHelp({ darkMode }) {
  const [canInstall, setCanInstall] = useState(canInstallApp());
  useEffect(() => {
    const sync = () => setCanInstall(canInstallApp());
    window.addEventListener("hopenix-install-ready", sync);
    return () => window.removeEventListener("hopenix-install-ready", sync);
  }, []);

  return (
    <div className={`mt-3 rounded-lg p-3 border ${darkMode ? "border-slate-800 bg-slate-800/40 text-slate-200" : "border-slate-100 bg-slate-50 text-slate-700"}`}>
      <p className="text-[12px] font-semibold">Notifications don't arrive on your phone when it is locked or Hopenix is closed?</p>
      <p className={`text-[10.5px] mt-0.5 mb-2 ${darkMode ? "text-slate-400" : "text-slate-500"}`}>
        Almost always the phone is putting the browser to sleep. Please check:
      </p>
      <ol className="list-decimal pl-5 space-y-1 text-[11px]">
        {PHONE_TIPS.map((t) => <li key={t}>{t}</li>)}
      </ol>
      {canInstall && !isStandalone && (
        <button
          type="button"
          onClick={installHopenixApp}
          className="mt-3 text-[11px] font-semibold rounded-md px-3 py-1.5 text-white bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-90"
        >
          Install Hopenix app
        </button>
      )}
    </div>
  );
}
