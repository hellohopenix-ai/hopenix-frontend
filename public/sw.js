/* Hopenix service worker — place this at hopenix-frontend/public/sw.js
 * (served as /sw.js, required for its push scope to cover the whole
 * site). Its only job: handle OS-level Web Push notifications — incoming
 * calls AND new messages — when the site itself isn't open, and route a
 * click on one back into the app — see pushSubscription.js (registers
 * this) and messaging/push_utils.py (sends the pushes).
 *
 * HARD LIMIT: this can show a notification and, on click, open/focus the
 * app — it can NOT auto-answer a call, play ringtone audio, or open a
 * WebRTC connection while the site is closed. No JS runs outside this
 * file's tiny event-driven lifecycle when the site isn't open; that's a
 * browser sandboxing limit, the same reason no web app can run fully in
 * the background the way a native phone app can.
 */

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

  // Never leave the notification empty: a push that ends without a readable
  // title/body is what showed up as a blank notification.
  const title = data.title || (data.call ? "Incoming call" : "Hopenix");
  const body =
    data.body ||
    (data.call ? "Tap to open Hopenix" : data.type === "task.assigned" ? "You have a new task" : "You have a new message");

  // Same tag = the newest notification for that call / sender / task replaces
  // the older one (and renotify makes the phone alert again).
  const tag = data.call
    ? `call-${data.call.id}`
    : data.type === "task.assigned"
    ? `task-${data.taskId || "batch"}`
    : data.senderId
    ? `message-${data.senderId}`
    : `hopenix-${Date.now()}`;

  const options = {
    body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag,
    renotify: true,
    requireInteraction: data.type === "call.incoming", // stays like a real incoming call
    // Phone buzzes like a ring for a call (a short single buzz for the rest).
    vibrate: data.type === "call.incoming" ? [400, 200, 400, 200, 400, 200, 400] : [200],
    data,
  };

  event.waitUntil(
    (async () => {
      let appFocused = false;
      try {
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        appFocused = wins.some((c) => c.visibilityState === "visible" && c.focused);
      } catch {
        /* treat as not focused */
      }
      // Always show something: Chrome insists every push produces a visible
      // notification and otherwise shows its own blank "site updated in the
      // background" one. When the app is open and focused the person already
      // sees the message / ringer in the page, so the banner is removed again
      // after a moment instead of being skipped.
      await self.registration.showNotification(title, options);
      if (appFocused && data.type !== "call.incoming") {
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
  const callId = data.call && data.call.id;
  // NOTE: "/messages" is not a real route in this app — only "/dashboard"
  // is, with Messages as a tab inside it (?tab=Messages). Sending a push
  // notification's click anywhere else used to land on a blank page and,
  // worse, never even reconnected the websocket or recovered the call,
  // since MessagingSocketProvider only mounts inside Dashboard.
  const targetUrl = callId
    ? `/dashboard?tab=Messages&incomingCall=${callId}`
    : data.type === "task.assigned"
    ? "/dashboard?tab=Tasks"
    : data.senderId
    ? `/dashboard?tab=Messages&openThread=${data.senderId}`
    : "/dashboard?tab=Messages";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ("focus" in client) {
          client.postMessage({ type: "hopenix.notificationClick", callId, senderId: data.senderId });
          if ("navigate" in client) {
            return client.navigate(targetUrl).then((c) => c.focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});