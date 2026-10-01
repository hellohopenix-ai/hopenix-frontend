import { useEffect, useMemo, useState } from "react";
import { AuthContext, useAuth } from "../AuthContext.jsx";
import { MessagingSocketProvider } from "../MessagingSocketContext.jsx";
import { setMessagingTokenOverride } from "../messagingToken.js";
import { API_ROOT } from "../apiConfig.js";
import MessagesPage from "./MessagesPage.jsx";

/* ======================================================================
   CLIENT PORTAL -> MESSAGES
   Renders the SAME MessagesPage the admin/staff side uses (identical UI:
   conversation list, chat, attachments, voice notes, emoji, reactions,
   calls), but signed in as the portal client. The backend only lets a
   client see/message ADMINS (see messaging/permissions.py), so the
   conversation list shows just the admin(s).

   The portal keeps its own token (clientportal_session_v1) so it never
   overwrites a staff login — it's handed to the messaging stack through
   messagingToken.js while this page is mounted.
====================================================================== */

const NO_LOCAL_CONVERSATIONS = [];
const noop = () => {};

export default function ClientPortalMessages({ token }) {
  const parentAuth = useAuth();
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");

  // Must be set BEFORE MessagesPage's first fetch runs (children's effects
  // run before this component's own effects), so set it during render —
  // it's idempotent and only stores a getter.
  setMessagingTokenOverride(() => token);

  useEffect(() => {
    return () => setMessagingTokenOverride(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError("");
    fetch(`${API_ROOT}/api/auth/me/`, { headers: { Authorization: `Token ${token}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Could not load your account."))))
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Could not load messages.");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Give MessagesPage / MessagingSocketProvider the portal client as "the
  // current user", regardless of any staff session in the same browser.
  const authValue = useMemo(() => ({ ...(parentAuth || {}), user: me }), [parentAuth, me]);

  if (error) {
    return (
      <div className="bg-[#15101f] border border-white/10 rounded-2xl p-6 text-sm text-rose-400">{error}</div>
    );
  }
  if (!me) {
    return (
      <div className="bg-[#15101f] border border-white/10 rounded-2xl p-6 text-sm text-slate-400">
        Loading messages…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={authValue}>
      <MessagingSocketProvider darkMode>
        <MessagesPage
          darkMode
          conversations={NO_LOCAL_CONVERSATIONS}
          setConversations={noop}
          isPrivilegedViewer={false}
          viewerId={me.id}
        />
      </MessagingSocketProvider>
    </AuthContext.Provider>
  );
}
