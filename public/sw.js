/* Hopenix service worker — served as /sw.js (public/sw.js).
 *
 * Shows WhatsApp-style OS notifications (with sound/vibration and icon) for
 * messages, incoming calls, missed calls, tasks and projects — also when the
 * site / browser is closed — and routes a tap on them back into the app.
 * Pushes are sent by the backend: messaging/push_utils.py.
 *
 * Sound note: the sound of a web-push notification is the phone's / OS's own
 * notification sound (Android: Settings > Apps > Chrome (or Hopenix) >
 * Notifications). A web page cannot pick or force a custom sound while it is
 * closed; we only make sure the notification is NOT silent and vibrates.
 *
 * FIX (this version): the old code sent `silent: true` TOGETHER WITH
 * `vibrate` whenever the app was open and focused. Browsers reject that
 * combination with a TypeError ("Silent notifications must not specify
 * vibration patterns"), so the whole push handler failed. Now `vibrate` is
 * only ever added to NON-silent notifications, and if showNotification()
 * still throws for any reason we retry with a minimal, always-valid option
 * set — a push can no longer end without a visible notification.
 */

// Take over immediately when a new version of this file is deployed, so
// devices never keep running an old worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function classify(data) {
  if (data.type === "test") return "test";
  if (data.type === "call.incoming") return "call";
  if (data.type === "call.missed") return "missed";
  if (data.type === "task.assigned") return "task";
  if (data.type === "project.assigned") return "project";
  if (data.type === "visitor.request") return "visitor";
  if (typeof data.type === "string" && data.type.startsWith("birthday.")) return "birthday";
  if (data.type === "coworking.application") return "coworking";
  if (typeof data.type === "string" && data.type.startsWith("meeting.")) return "meeting";
  return "message";
}

function defaultBody(kind) {
  switch (kind) {
    case "test":
      return "Notifications are working on this device 🎉";
    case "call":
      return "Tap to open Hopenix";
    case "missed":
      return "You have a missed call";
    case "task":
      return "You have a new task";
    case "project":
      return "You were added to a project";
    case "visitor":
      return "A visitor is waiting for approval";
    case "coworking":
      return "A new coworking application needs approval";
    case "meeting":
      return "You have a meeting update";
    case "birthday":
      return "It's a birthday today 🎂";
    default:
      return "You have a new message";
  }
}

// Same tag = newest notification for that call / sender / task / project
// replaces the older one. A missed call reuses the ringing call's tag, so
// "Incoming call" turns into "Missed call". Never returns "" (an empty tag
// together with renotify:true is itself a TypeError).
function buildTag(kind, data) {
  if (kind === "test") return "hopenix-test";
  // The server can name the notification's tag itself (Client Portal pushes do).
  if (typeof data.tag === "string" && data.tag && data.tag.length <= 100) return data.tag;
  if (data.call && data.call.id != null) return `call-${data.call.id}`;
  if (kind === "task") return `task-${data.taskId || Date.now()}`;
  if (kind === "project") return `project-${data.projectId || Date.now()}`;
  if (kind === "meeting") return `meeting-${data.type}-${data.meetingId || Date.now()}`;
  if (kind === "visitor" || kind === "coworking") return `${kind}-${Date.now()}`;
  if (kind === "birthday") return `birthday-${data.type}-${data.userId || data.clientId || "me"}`;
  // Every chat message gets its OWN notification (unique tag). The old
  // "one notification per sender, updated in place" approach stopped showing
  // new texts after a few messages on some phones, because an update of an
  // existing notification is not always re-displayed / re-alerted.
  if (data.senderId) return `message-${data.senderId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  return `hopenix-${Date.now()}`;
}

async function isAppFocused() {
  try {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    return wins.some((c) => c.visibilityState === "visible" && c.focused);
  } catch {
    return false; // treat as not focused -> show the notification
  }
}

async function handlePush(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    let text = "";
    try {
      text = event.data ? event.data.text() : "";
    } catch {
      /* unreadable payload */
    }
    data = { title: "Hopenix", body: text };
  }
  if (!data || typeof data !== "object") data = {};

  const kind = classify(data);
  const title =
    data.title || (kind === "call" ? "Incoming call" : kind === "missed" ? "Missed call" : "Hopenix");
  const body = data.body || defaultBody(kind);
  const tag = buildTag(kind, data);

  // A test push must ALWAYS be visible, even while the app is open, or the
  // "did you see it?" check would be meaningless.
  const appFocused = kind === "test" ? false : await isAppFocused();

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    renotify: true, // alert (sound + vibrate) again even when replacing a same-tag notification
    // An incoming call, a waiting visitor and "meeting starting soon" stay on screen until tapped.
    // Stays on screen until the person taps or swipes it away (desktop
    // browsers otherwise hide it after a few seconds).
    requireInteraction: true,
    timestamp: Date.now(),
    data: { ...data },
  };

  if (appFocused) {
    // The open page plays its own sound. `vibrate` must NOT be set on a
    // silent notification (that combination throws a TypeError).
    options.silent = true;
  } else {
    options.silent = false; // use the OS notification sound
    options.vibrate =
      kind === "call"
        ? [400, 200, 400, 200, 400, 200, 400]
        : kind === "missed"
        ? [300, 150, 300]
        : [200, 100, 200];
  }

  // Chrome requires every push to show a notification (else it shows its
  // own blank "site updated in the background" one).
  try {
    await self.registration.showNotification(title, options);
  } catch {
    try {
      await self.registration.showNotification(title, {
        body,
        icon: "/icon-192.png",
        tag,
        data: options.data,
      });
    } catch {
      await self.registration.showNotification("Hopenix", { body: body || "You have a new notification" });
    }
  }

  // Many messages from one person: keep the 6 newest visible, drop older ones
  // so the shade doesn't fill up (they stay in the chat itself).
  if (kind === "message" && data.senderId) {
    try {
      const mine = (await self.registration.getNotifications())
        .filter((n) => n.data && n.data.senderId === data.senderId && classify(n.data) === "message")
        .sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
      mine.slice(6).forEach((n) => n.close());
    } catch {
      /* fine */
    }
  }

  // If the app is open and focused the person already sees the change, so
  // the (silent) notification is removed shortly after.
  if (appFocused && kind !== "call") {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    try {
      const shown = await self.registration.getNotifications({ tag });
      shown.forEach((n) => n.close());
    } catch {
      /* fine */
    }
  }
}

// The browser/push service rotated or dropped this device's registration.
// The worker has no login token, so it asks any open Hopenix window to
// re-register (EnableNotificationsBanner listens); if none is open, the next
// time the app is opened it repairs itself silently.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => wins.forEach((c) => c.postMessage({ type: "hopenix.resubscribe" })))
      .catch(() => {})
  );
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    handlePush(event).catch(async () => {
      // Absolute last resort: never end a push without a visible notification.
      try {
        await self.registration.showNotification("Hopenix", { body: "You have a new notification" });
      } catch {
        /* nothing more we can do */
      }
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  if (data.senderId) {
    // Opening the chat reads all of that person's messages: clear their other banners.
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((list) => list.filter((n) => n.data && n.data.senderId === data.senderId).forEach((n) => n.close()))
        .catch(() => {})
    );
  }
  const kind = classify(data);
  const callId = data.call && data.call.id;

  // Only "/dashboard" is a real route; the sections are tabs inside it.
  let targetUrl = "/dashboard?tab=Messages";
  // The server can say where a tap should land (Client Portal pushes use
  // "/client-portal?view=..."). Same-site paths only, never another origin.
  if (typeof data.url === "string" && /^\/(?!\/)/.test(data.url)) targetUrl = data.url;
  else if (kind === "test") targetUrl = "/dashboard";
  else if (kind === "call") targetUrl = `/dashboard?tab=Messages&incomingCall=${callId}`;
  else if (kind === "missed") {
    const who = data.callerId || (data.call && data.call.callerId);
    targetUrl = who ? `/dashboard?tab=Messages&openThread=${who}` : "/dashboard?tab=Messages";
  } else if (kind === "task") targetUrl = "/dashboard?tab=Tasks";
  else if (kind === "project") targetUrl = "/dashboard?tab=Projects";
  else if (kind === "visitor") targetUrl = "/dashboard?tab=Visitors";
  else if (kind === "coworking") targetUrl = "/dashboard?tab=Coworking%20Space";
  else if (kind === "meeting") targetUrl = "/dashboard?tab=Meetings";
  else if (data.type === "birthday.team" && data.userId) targetUrl = `/dashboard?tab=Messages&openThread=${data.userId}`;
  else if (data.type === "birthday.client") targetUrl = "/dashboard?tab=Clients";
  else if (kind === "birthday") targetUrl = "/dashboard";
  else if (data.senderId) targetUrl = `/dashboard?tab=Messages&openThread=${data.senderId}`;

  // Staff and Client Portal live in the same browser origin. A tap should
  // reuse a window of ITS OWN area (staff /dashboard, or /client-portal) and
  // never navigate someone else's open window to the wrong place.
  const areaOf = (path) => (String(path).startsWith("/client-portal") ? "portal" : "staff");
  const wantedArea = areaOf(new URL(targetUrl, self.location.origin).pathname);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (allClients) => {
      const clientsArr = allClients.filter((c) => {
        try {
          return areaOf(new URL(c.url).pathname) === wantedArea;
        } catch {
          return false;
        }
      });
      for (const client of clientsArr) {
        if ("focus" in client) {
          client.postMessage({ type: "hopenix.notificationClick", callId, senderId: data.senderId });
          if ("navigate" in client) {
            try {
              const c = await client.navigate(targetUrl);
              return c && c.focus ? c.focus() : client.focus();
            } catch {
              return client.focus();
            }
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});