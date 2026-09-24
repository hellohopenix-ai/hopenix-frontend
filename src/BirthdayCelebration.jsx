import { useEffect, useMemo, useState } from "react";
import BirthdayCard from "./BirthdayCard.jsx";
import {
  isBirthdayToday,
  queueEmployeeBirthdayMessage,
  isCelebrationDismissedToday,
  markCelebrationDismissedToday,
} from "./birthdayMessageDelivery.js";

/* ===========================================================================
   BirthdayCelebration
   ---------------------------------------------------------------------------
   Employee Dashboard's birthday celebration. Pass the logged-in `user`
   (from AuthContext) in as a prop; if `user.dateOfBirth` matches today,
   shows the advanced 3D envelope/letter + photo + confetti-popper
   celebration (BirthdayCard). Renders nothing any other day, or if the
   field isn't set yet.

   Also queues a "pending birthday wish" into localStorage — so MessagesPage
   or Dashboard can turn it into a real message in that employee's thread.

   Dismissal is remembered for the rest of the day (see
   isCelebrationDismissedToday/markCelebrationDismissedToday in
   birthdayMessageDelivery.js) — otherwise this only lived in React state,
   so it popped back up every time the person logged in again (or the
   Dashboard remounted) even though they'd already closed it once today.
   =========================================================================== */

export default function BirthdayCelebration({ user, soundSrc }) {
  const [dismissed, setDismissed] = useState(() => isCelebrationDismissedToday("employee", user?.id));

  const dobValue = user?.dateOfBirth || user?.date_of_birth || user?.dob;
  const shouldCelebrate = useMemo(() => isBirthdayToday(dobValue), [dobValue]);

  useEffect(() => {
    if (shouldCelebrate && user) {
      queueEmployeeBirthdayMessage(user);
    }
  }, [shouldCelebrate, user]);

  // `user` can arrive a tick after mount (e.g. still loading from
  // AuthContext), in which case the lazy useState initializer above ran
  // with no id yet — re-check once the real id is available.
  useEffect(() => {
    if (user?.id != null && isCelebrationDismissedToday("employee", user.id)) {
      setDismissed(true);
    }
  }, [user?.id]);

  if (!shouldCelebrate || dismissed) return null;

  const displayName = user?.name || "there";

  return (
    <BirthdayCard
      name={displayName}
      avatarUrl={user?.avatar}
      greeting="HAPPY BIRTHDAY"
      subtitle={`— ${displayName}, from the Hopenix family —`}
      message={`Hey ${displayName}! Wishing you a fantastic birthday. Thank you for everything you bring to the team — your hard work and energy don't go unnoticed. Enjoy your day, and here's to an amazing year ahead!`}
      accent="#7c3aed"
      soundSrc={soundSrc}
      onDismiss={() => {
        markCelebrationDismissedToday("employee", user?.id);
        setDismissed(true);
      }}
    />
  );
}