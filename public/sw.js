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
    data = { title: "Hopenix", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Hopenix";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // Groups/replaces older notifications for the SAME call, sender or task
    // instead of piling up a separate banner each time.
    tag: data.call
      ? `call-${data.call.id}`
      : data.type === "task.assigned"
      ? `task-${data.taskId || "batch"}`
      : data.senderId
      ? `message-${data.senderId}`
      : undefined,
    requireInteraction: data.type === "call.incoming", // stays like a real incoming call
    data,
  };

  event.waitUntil(
    (async () => {
      // WhatsApp-Web behaviour: if the app is open, visible AND focused the
      // user already sees the message / ringer / red dot in the page, so no
      // OS banner. (Browsers allow skipping the banner in exactly this case.)
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const appFocused = wins.some((c) => c.visibilityState === "visible" && c.focused);
      if (appFocused) return;
      await self.registration.showNotification(title, options);
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