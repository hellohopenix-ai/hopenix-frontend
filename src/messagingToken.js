// Which auth token the messaging stack (messagesApi, callsApi, websocket,
// push) should use.
//
// Staff: the normal "hopenix_auth_token" from localStorage — unchanged.
// Client Portal: the portal has its OWN session/token (clientportal_session_v1),
// kept separate so it never overwrites a staff login in the same browser.
// While the portal's Messages page is open it registers that token here, so
// the very same Messages UI + API works for a client.
let override = null;

export function setMessagingTokenOverride(getter) {
  override = typeof getter === "function" ? getter : null;
}

export function getMessagingToken() {
  if (override) {
    const t = override();
    if (t) return t;
  }
  return localStorage.getItem("hopenix_auth_token");
}
