/* Hopenix service worker — place this at hopenix-frontend/public/sw.js
 * (served as /sw.js, required for its push scope to cover the whole
 * site). Its only job: handle OS-level Web Push notifications for
 * incoming calls when the site itself isn't open, and route a click on
 * one back into the app — see pushSubscription.js (registers this) and
 * messaging/push_utils.py (sends the pushes).
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

  const title = data.title || "Incoming call";
  const options = {
    body: data.body || "",
    icon: "/logo192.png", // swap for whatever app icon actually exists in /public
    badge: "/logo192.png",
    tag: data.call ? `call-${data.call.id}` : undefined, // replaces any older notification for the same call
    requireInteraction: true, // stays on screen until the user acts, like a real incoming call
    data,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const callId = event.notification.data && event.notification.data.call && event.notification.data.call.id;
  const targetUrl = callId ? `/messages?incomingCall=${callId}` : "/messages";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ("focus" in client) {
          client.postMessage({ type: "hopenix.incomingCallClick", callId });
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
