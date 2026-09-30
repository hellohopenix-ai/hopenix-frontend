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
 */

// Take over immediately when a new version of this file is deployed, so
// devices never keep running an old worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function classify(data) {
  if (data.type === "call.incoming") return "call";
  if (data.type === "call.missed") return "missed";
  if (data.type === "task.assigned") return "task";
  if (data.type === "project.assigned") return "project";
  if (data.type === "visitor.request") return "visitor";
  if (data.type === "coworking.application") return "coworking";
  if (typeof data.type === "string" && data.type.startsWith("meeting.")) return "meeting";
  return "message";
}

self.addEventListener("push", (event) => {
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

  const kind = classify(data);
  let title =
    data.title ||
    (kind === "call" ? "Incoming call" : kind === "missed" ? "Missed call" : "Hopenix");
  const body =
    data.body ||
    (kind === "call"
      ? "Tap to open Hopenix"
      : kind === "missed"
      ? "You have a missed call"
      : kind === "task"
      ? "You have a new task"
      : kind === "project"
      ? "You were added to a project"
      : kind === "visitor"
      ? "A visitor is waiting for approval"
      : kind === "coworking"
      ? "A new coworking application needs approval"
      : kind === "meeting"
      ? "You have a meeting update"
      : "You have a new message");

  // Same tag = newest notification for that call / sender / task / project
  // replaces the older one. A missed call reuses the ringing call's tag, so
  // "Incoming call" turns into "Missed call".
  const tag = data.call
    ? `call-${data.call.id}`
    : kind === "task"
    ? `task-${data.taskId || Date.now()}`
    : kind === "project"
    ? `project-${data.projectId || Date.now()}`
    : kind === "meeting"
    ? `meeting-${data.type}-${data.meetingId || Date.now()}`
    : kind === "visitor" || kind === "coworking"
    ? `${kind}-${Date.now()}`
    : data.senderId
    ? `message-${data.senderId}`
    : `hopenix-${Date.now()}`;

  event.waitUntil(
    (async () => {
      let appFocused = false;
      try {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        appFocused = wins.some((c) => c.visibilityState === "visible" && c.focused);
      } catch {
        /* treat as not focused */
      }

      // Several messages from one person: keep ONE notification, show the
      // latest text and a counter, like WhatsApp ("Ali (3 messages)").
      let count = 1;
      if (kind === "message" && data.senderId) {
        try {
          const prev = (await self.registration.getNotifications({ tag }))[0];
          count = ((prev && prev.data && prev.data.count) || 0) + 1;
          if (count > 1) title = `${title} (${count} messages)`;
        } catch {
          /* fine */
        }
      }

      const options = {
        body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag,
        renotify: true, // alert (sound + vibrate) again even when replacing a same-tag notification
        silent: appFocused, // the open page plays its own sound; otherwise use the OS notification sound
        // An incoming call, a waiting visitor and "meeting starting soon" stay on screen until tapped.
        requireInteraction: kind === "call" || kind === "visitor" || data.type === "meeting.soon",
        vibrate:
          kind === "call"
            ? [400, 200, 400, 200, 400, 200, 400]
            : kind === "missed"
            ? [300, 150, 300]
            : [200, 100, 200],
        timestamp: Date.now(),
        data: { ...data, count },
      };

      // Chrome requires every push to show a notification (else it shows its
      // own blank "site updated in the background" one). If the app is open
      // and focused the person already sees it, so it's removed shortly after.
      await self.registration.showNotification(title, options);
      if (appFocused && kind !== "call") {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const shown = await self.registration.getNotifications({ tag });
        shown.forEach((n) => n.close());
      }
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const kind = classify(data);
  const callId = data.call && data.call.id;

  // Only "/dashboard" is a real route; the sections are tabs inside it.
  let targetUrl = "/dashboard?tab=Messages";
  if (kind === "call") targetUrl = `/dashboard?tab=Messages&incomingCall=${callId}`;
  else if (kind === "missed") {
    const who = data.callerId || (data.call && data.call.callerId);
    targetUrl = who ? `/dashboard?tab=Messages&openThread=${who}` : "/dashboard?tab=Messages";
  } else if (kind === "task") targetUrl = "/dashboard?tab=Tasks";
  else if (kind === "project") targetUrl = "/dashboard?tab=Projects";
  else if (kind === "visitor") targetUrl = "/dashboard?tab=Visitors";
  else if (kind === "coworking") targetUrl = "/dashboard?tab=Coworking%20Space";
  else if (kind === "meeting") targetUrl = "/dashboard?tab=Meetings";
  else if (data.senderId) targetUrl = `/dashboard?tab=Messages&openThread=${data.senderId}`;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientsArr) => {
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