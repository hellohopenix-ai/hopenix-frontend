import { useEffect, useMemo, useState } from "react";
import BirthdayCard from "./BirthdayCard.jsx";
import {
  isBirthdayToday,
  queueClientBirthdayMessage,
  isCelebrationDismissedToday,
  markCelebrationDismissedToday,
} from "./birthdayMessageDelivery.js";

/* ===========================================================================
   ClientBirthdayCelebration
   ---------------------------------------------------------------------------
   Same idea as BirthdayCelebration.jsx (used on the employee Dashboard),
   but for the Client Portal — which has its own session/`client` object
   instead of the employee AuthContext. Pass the logged-in `client` in as a
   prop; if `client.dateOfBirth` matches today, shows the advanced 3D
   envelope/letter + photo + confetti-popper celebration (BirthdayCard).
   Renders nothing any other day, or if the field isn't set yet.

   Also queues a "pending birthday wish" into localStorage — so ClientPortal
   can turn it into a real message in their thread.

   Dismissal is remembered for the rest of the day (see
   isCelebrationDismissedToday/markCelebrationDismissedToday in
   birthdayMessageDelivery.js) — otherwise this only lived in React state,
   so it popped back up every time the client logged in again (or the
   portal remounted) even though they'd already closed it once today.
   =========================================================================== */

// FIX (birthday card never appeared on the Client Portal): the portal's own
// `client` object is built by clientPortalApi.js, which doesn't carry the
// date of birth through. The real value now lives on the backend
// (Client.date_of_birth), so when the `client` prop has no DOB this asks
// the server for it directly — the logged-in client can read their own row
// (GET /api/dashboard/clients/<id>/, same session token the portal uses).
const rawApiBase = import.meta.env?.VITE_API_BASE_URL || "http://127.0.0.1:8000/api";
const API_HOST = rawApiBase.replace(/\/api\/?$/, "").replace(/\/$/, "");
const PORTAL_SESSION_KEY = "clientportal_session_v1";

async function fetchOwnDateOfBirth(clientId) {
  try {
    const session = JSON.parse(localStorage.getItem(PORTAL_SESSION_KEY) || "null");
    const token = session?.token;
    if (!token || clientId == null) return "";
    const res = await fetch(`${API_HOST}/api/dashboard/clients/${clientId}/`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) return "";
    const data = await res.json();
    return data?.date_of_birth || data?.dateOfBirth || "";
  } catch {
    return "";
  }
}

export default function ClientBirthdayCelebration({ client, soundSrc }) {
  const [dismissed, setDismissed] = useState(() => isCelebrationDismissedToday("client", client?.id));
  const [fetchedDob, setFetchedDob] = useState("");

  const propDob = client?.dateOfBirth || client?.date_of_birth || client?.dob;
  const dobValue = propDob || fetchedDob;

  useEffect(() => {
    if (propDob || client?.id == null) return;
    let cancelled = false;
    fetchOwnDateOfBirth(client.id).then((dob) => {
      if (!cancelled && dob) setFetchedDob(dob);
    });
    return () => {
      cancelled = true;
    };
  }, [propDob, client?.id]);
  const shouldCelebrate = useMemo(() => isBirthdayToday(dobValue), [dobValue]);

  useEffect(() => {
    if (shouldCelebrate && client) {
      queueClientBirthdayMessage(client);
    }
  }, [shouldCelebrate, client]);

  // `client` can arrive a tick after mount, in which case the lazy
  // useState initializer above ran with no id yet — re-check once the
  // real id is available.
  useEffect(() => {
    if (client?.id != null && isCelebrationDismissedToday("client", client.id)) {
      setDismissed(true);
    }
  }, [client?.id]);

  if (!shouldCelebrate || dismissed) return null;

  const displayName = client?.contactPerson || client?.name || "there";

  return (
    <BirthdayCard
      name={displayName}
      // FIX (show the client's real dp, not a fallback): the client's
      // actual uploaded photo lives in `profilePic` — the same field
      // ClientsPage.jsx's Add/Edit Client forms write to and the Client
      // Portal's own Profile Settings modal updates. `avatar`/`logo`
      // never actually get set anywhere, so this always fell through to
      // BirthdayCard's initials-avatar placeholder even for clients who
      // do have a photo on file. `profilePic` is checked first now, with
      // the old fields kept as harmless fallbacks in case either is ever
      // populated some other way.
      avatarUrl={client?.profilePic || client?.avatar || client?.logo}
      greeting="HAPPY BIRTHDAY"
      subtitle={`— ${displayName}, from the Hopenix family —`}
      message={`Hey ${displayName}! Wishing you a wonderful birthday. It's been a pleasure working with you, and we're grateful to have you as part of the Hopenix family. Enjoy your day, and here's to another great year ahead!`}
      accent="#2563eb"
      soundSrc={soundSrc}
      onDismiss={() => {
        markCelebrationDismissedToday("client", client?.id);
        setDismissed(true);
      }}
    />
  );
}