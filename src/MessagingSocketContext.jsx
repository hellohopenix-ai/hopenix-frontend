import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { PhoneIncoming, PhoneOff, Mic, MicOff } from "lucide-react";
import { useAuth } from "./AuthContext.jsx";
import {
  startCall as apiStartCall,
  respondToCall as apiRespondToCall,
  endCall as apiEndCall,
  sendCallSignal as apiSendCallSignal,
  fetchActiveIncomingCall as apiFetchActiveIncomingCall,
} from "./callsApi.js";
import { ensurePushSubscribed } from "./pushSubscription.js";
import { playNotificationSound } from "./notificationSound.js";
import { API_ROOT } from "./apiConfig.js";
import { getMessagingToken } from "./messagingToken.js";
import ringtoneAssetSrc from "./assets/ringtone..mp4";

/* ---------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------
 * The per-user websocket (what makes consumers.is_user_online() — and
 * therefore "are they reachable for a call right now" — true) used to be
 * opened INSIDE MessagesPage.jsx. That meant it only existed while the
 * Messages tab itself was mounted: the moment someone switched to
 * Dashboard/Tasks/anything else, MessagesPage unmounted, the socket
 * closed, and the backend immediately saw them as offline — even though
 * they were still logged in and using the app right in front of you.
 * Same story for calls: an incoming call's popup only rendered inside
 * MessagesPage, so a call arriving while you were on another tab was
 * silently missed with no UI to answer it.
 *
 * This provider is mounted ONCE, at the top of Dashboard.jsx, OUTSIDE
 * the `{active === "..."}` conditional rendering — so it (and the
 * websocket, and the incoming-call popup) stays alive for as long as
 * the person is logged into the app, no matter which page they're
 * looking at. MessagesPage.jsx now just calls useMessagingSocket() to
 * get the same call controls it used to own directly, and subscribes to
 * message/thread events instead of managing the socket itself.
 * ------------------------------------------------------------------- */

const MessagingSocketContext = createContext(null);

export function useMessagingSocket() {
  const ctx = useContext(MessagingSocketContext);
  if (!ctx) {
    throw new Error("useMessagingSocket() must be called inside <MessagingSocketProvider>");
  }
  return ctx;
}

// -- tiny local avatar helpers (deliberately duplicated from
// MessagesPage.jsx rather than imported — this file needs to stay
// mountable independently of that page, and it's a handful of lines) --
const AVATAR_PALETTE = [
  "bg-rose-500", "bg-blue-500", "bg-amber-500", "bg-emerald-500",
  "bg-violet-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500",
];
function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}
function isUploadedPhoto(avatar) {
  return typeof avatar === "string" && avatar.trim().length > 0;
}
function CallAvatar({ name, avatar, darkMode }) {
  if (isUploadedPhoto(avatar)) {
    const src = avatar.includes("?v=") ? avatar : `${avatar}?v=${Date.now()}`;
    return <img src={src} alt={name} className="h-20 w-20 rounded-full object-cover" />;
  }
  return (
    <div className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold text-white ${avatarColor(name || "")}`}>
      {initials(name || "?")}
    </div>
  );
}

function formatCallDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function MessagingSocketProvider({ darkMode, children }) {
  const { user: currentUser } = useAuth();

  // -- websocket plumbing --------------------------------------------
  const wsRef = useRef(null);
  const wsReconnectTimerRef = useRef(null);
  const wsReconnectAttemptRef = useRef(0);
  const subscribersRef = useRef(new Set());

  /** Any other part of the app (MessagesPage, notification badges, etc.)
   * can call this to get every raw event pushed over the socket —
   * message.new, thread.read, and the call.* events too. Returns an
   * unsubscribe function, so pair it with useEffect's cleanup. */
  const subscribe = useCallback((callback) => {
    subscribersRef.current.add(callback);
    return () => subscribersRef.current.delete(callback);
  }, []);

  // -- call state -------------------------------------------------------
  // null | { phase: "outgoing"|"incoming"|"connecting"|"active", call, partnerId, partnerName, partnerAvatar }
  const [activeCall, setActiveCall] = useState(null);
  const activeCallRef = useRef(null);
  activeCallRef.current = activeCall;
  const [callMuted, setCallMuted] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [callToast, setCallToast] = useState("");

  const callPcRef = useRef(null);
  const callLocalStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const callRingTimeoutRef = useRef(null);
  const callTimerIntervalRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  // Id of the incoming call THIS tab/device tapped "Accept" on. Only that tab
  // answers the caller's offer (a second open tab must not also answer).
  const acceptedCallIdRef = useRef(null);

  // -- ringing sound --------------------------------------------------
  // Neither phase ("incoming" popup, "outgoing" · Ringing…) ever actually
  // played any sound before this — the call UI just sat there silently,
  // so a call was easy to miss entirely and gave no feedback that dialing
  // was actually happening. Two different sounds, same as a real phone:
  // the callee hears the ringtone asset (also used by BirthdayCard.jsx),
  // the caller hears a synthesized ringback tone (no extra asset needed).
  const incomingRingtoneRef = useRef(null);
  const ringbackAudioCtxRef = useRef(null);
  const ringbackIntervalRef = useRef(null);

  useEffect(() => {
    if (!callToast) return;
    const t = setTimeout(() => setCallToast(""), 4000);
    return () => clearTimeout(t);
  }, [callToast]);

  // See the note on MessagesPage.jsx's version of this constant: STUN
  // alone fails as soon as either side is behind a NAT it can't
  // traverse (mobile data, many corporate/public Wi-Fi networks) — the
  // TURN entry is OpenRelay's free public demo server, fine for testing
  // but shared/rate-limited; swap in real TURN credentials for production.
  //
  // For reliable calls over mobile data set your own TURN server in the
  // frontend env (Vercel): VITE_TURN_URLS (comma separated),
  // VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL. Without them the free demo
  // server below is used, exactly as before.
  const ENV_TURN_URLS = (import.meta.env?.VITE_TURN_URLS || "").split(",").map((u) => u.trim()).filter(Boolean);
  const ICE_SERVERS = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    ENV_TURN_URLS.length
      ? {
          urls: ENV_TURN_URLS,
          username: import.meta.env?.VITE_TURN_USERNAME || "",
          credential: import.meta.env?.VITE_TURN_CREDENTIAL || "",
        }
      : {
          urls: [
            "turn:openrelay.metered.ca:80",
            "turn:openrelay.metered.ca:443",
            "turn:openrelay.metered.ca:443?transport=tcp",
          ],
          username: "openrelayproject",
          credential: "openrelayproject",
        },
  ];

  const stopCallTimer = () => {
    if (callTimerIntervalRef.current) {
      clearInterval(callTimerIntervalRef.current);
      callTimerIntervalRef.current = null;
    }
  };

  const startCallTimer = () => {
    stopCallTimer();
    setCallSeconds(0);
    callTimerIntervalRef.current = setInterval(() => setCallSeconds((s) => s + 1), 1000);
  };

  const cleanupCall = useCallback(() => {
    if (callRingTimeoutRef.current) {
      clearTimeout(callRingTimeoutRef.current);
      callRingTimeoutRef.current = null;
    }
    stopCallTimer();
    if (callPcRef.current) {
      try {
        callPcRef.current.close();
      } catch {
        /* already closed */
      }
      callPcRef.current = null;
    }
    if (callLocalStreamRef.current) {
      callLocalStreamRef.current.getTracks().forEach((t) => t.stop());
      callLocalStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    pendingIceCandidatesRef.current = [];
    acceptedCallIdRef.current = null;
    setCallMuted(false);
    setCallSeconds(0);
    setActiveCall(null);
  }, []);

  const stopIncomingRingtone = useCallback(() => {
    if (incomingRingtoneRef.current) {
      incomingRingtoneRef.current.pause();
      incomingRingtoneRef.current.currentTime = 0;
      incomingRingtoneRef.current = null;
    }
  }, []);

  const stopRingback = useCallback(() => {
    if (ringbackIntervalRef.current) {
      clearInterval(ringbackIntervalRef.current);
      ringbackIntervalRef.current = null;
    }
    if (ringbackAudioCtxRef.current) {
      try {
        ringbackAudioCtxRef.current.close();
      } catch {
        /* already closed */
      }
      ringbackAudioCtxRef.current = null;
    }
  }, []);

  const startIncomingRingtone = useCallback(() => {
    stopIncomingRingtone();
    const audio = new Audio(ringtoneAssetSrc);
    audio.loop = true;
    audio.volume = 0.85;
    incomingRingtoneRef.current = audio;
    // Autoplay can be blocked until the user has interacted with the page
    // at all — harmless to swallow; the visible incoming-call popup still
    // shows either way, this is just the sound on top of it.
    audio.play().catch(() => {});
  }, [stopIncomingRingtone]);

  // Real phone lines use a two-tone ringback (US: 440Hz+480Hz, ~2s on/4s
  // off). A single 425Hz burst repeated every 3s reads close enough as
  // "ringing" without needing an extra bundled audio asset for it.
  const startRingback = useCallback(() => {
    stopRingback();
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      ringbackAudioCtxRef.current = ctx;
      const playBurst = () => {
        if (ringbackAudioCtxRef.current !== ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 425;
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 1.2);
      };
      playBurst();
      ringbackIntervalRef.current = setInterval(playBurst, 3000);
    } catch {
      /* non-essential — a failed ringback should never break the call */
    }
  }, [stopRingback]);

  // Plays/stops the right sound purely off the call's current phase, so
  // every place that can change `activeCall.phase` (incoming, accepted,
  // rejected, ended, connected, cleaned up) automatically gets the sound
  // right without each of those call sites having to remember to do it.
  useEffect(() => {
    const phase = activeCall?.phase;
    if (phase === "incoming") {
      stopRingback();
      startIncomingRingtone();
    } else if (phase === "outgoing") {
      stopIncomingRingtone();
      startRingback();
    } else {
      stopIncomingRingtone();
      stopRingback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.phase]);

  useEffect(() => {
    return () => {
      stopIncomingRingtone();
      stopRingback();
    };
  }, [stopIncomingRingtone, stopRingback]);

  const flushPendingIce = (pc) => {
    pendingIceCandidatesRef.current.forEach((c) => pc.addIceCandidate(c).catch(() => {}));
    pendingIceCandidatesRef.current = [];
  };

  const createPeerConnection = (callId) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // A shared "we're actually connected now" marker — called from
    // ontrack AND both connection-state events below, whichever fires
    // first/at all. Some browsers never fire connectionState==="connected"
    // even with media flowing fine, so actually RECEIVING the remote
    // audio track is treated as good enough proof on its own too.
    const markConnected = () => {
      setActiveCall((c) => (c && c.call.id === callId ? { ...c, phase: "active" } : c));
      if (!callTimerIntervalRef.current) startCallTimer();
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        apiSendCallSignal(callId, { type: "candidate", candidate: e.candidate.toJSON() }).catch(() => {});
      }
    };
    pc.ontrack = (e) => {
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = e.streams[0];
        remoteAudioRef.current.play().catch(() => {
          const retryOnGesture = () => {
            remoteAudioRef.current && remoteAudioRef.current.play().catch(() => {});
          };
          document.addEventListener("click", retryOnGesture, { once: true });
        });
      }
      markConnected();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        markConnected();
      } else if (pc.connectionState === "failed") {
        setCallToast("Call failed — connection issue");
        apiEndCall(callId).catch(() => {});
        cleanupCall();
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
        markConnected();
      } else if (pc.iceConnectionState === "failed") {
        setCallToast("Call failed — connection issue");
        apiEndCall(callId).catch(() => {});
        cleanupCall();
      }
    };
    callPcRef.current = pc;
    return pc;
  };

  const getMicStream = async () => {
    if (callLocalStreamRef.current) return callLocalStreamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error("Microphone not available");
      e.name = "NotFoundError";
      throw e;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    callLocalStreamRef.current = stream;
    return stream;
  };

  const releaseMic = () => {
    if (callLocalStreamRef.current) {
      callLocalStreamRef.current.getTracks().forEach((t) => t.stop());
      callLocalStreamRef.current = null;
    }
  };

  // Real reason for a failure, instead of calling every error "Could not
  // access microphone" (a dropped network request during call setup used to
  // be reported that way and silently hang the call up).
  const callErrorText = (err) => {
    switch (err?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "Microphone is blocked — allow it in your browser's site settings";
      case "NotFoundError":
        return "No microphone found on this device";
      case "NotReadableError":
      case "AbortError":
        return "Microphone is being used by another app";
      default:
        return "Call setup failed — please try again";
    }
  };

  const beginOfferAsCaller = useCallback(async (call) => {
    try {
      const stream = await getMicStream();
      const pc = createPeerConnection(call.id);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await apiSendCallSignal(call.id, { type: "offer", sdp: offer.sdp });
    } catch (err) {
      setCallToast(callErrorText(err));
      apiEndCall(call.id).catch(() => {});
      cleanupCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupCall]);

  const answerAsCallee = useCallback(async (call, offerSdp) => {
    try {
      const stream = await getMicStream();
      const pc = createPeerConnection(call.id);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
      flushPendingIce(pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await apiSendCallSignal(call.id, { type: "answer", sdp: answer.sdp });
      setActiveCall((c) => (c ? { ...c, phase: "connecting" } : c));
    } catch (err) {
      setCallToast(callErrorText(err));
      apiEndCall(call.id).catch(() => {});
      cleanupCall();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupCall]);

  function handleCallEvent(data) {
    const current = activeCallRef.current;
    switch (data.type) {
      case "call.incoming": {
        const call = data.call;
        // The same ringing call reported again (e.g. the "recover a ringing
        // call" check re-running) must NOT be treated as a second call —
        // that used to auto-decline the very call being answered.
        if (current && current.call.id === call.id) return;
        // Already on another call — auto-decline instead of leaving the
        // caller ringing forever with no response.
        if (current) {
          apiRespondToCall(call.id, "reject").catch(() => {});
          return;
        }
        setActiveCall({
          phase: "incoming",
          call,
          partnerId: call.callerId,
          partnerName: call.callerName,
          partnerAvatar: call.callerAvatar || "",
        });
        break;
      }
      case "call.accepted": {
        const call = data.call;
        if (!current || current.call.id !== call.id) return;
        if (callRingTimeoutRef.current) {
          clearTimeout(callRingTimeoutRef.current);
          callRingTimeoutRef.current = null;
        }
        setActiveCall((c) => (c ? { ...c, phase: "connecting", call } : c));
        beginOfferAsCaller(call);
        break;
      }
      case "call.rejected": {
        const call = data.call;
        if (!current || current.call.id !== call.id) return;
        setCallToast(`${current.partnerName || "User"} declined the call`);
        cleanupCall();
        break;
      }
      case "call.ended": {
        const call = data.call;
        if (!current || current.call.id !== call.id) return;
        if (call.status === "missed") {
          setCallToast(current.phase === "incoming" ? "Missed call" : "No answer");
        } else {
          setCallToast("Call ended");
        }
        cleanupCall();
        break;
      }
      case "call.signal": {
        if (!current || current.call.id !== data.call_id) return;
        const payload = data.data || {};
        if (payload.type === "offer") {
          if (acceptedCallIdRef.current !== current.call.id) return; // not the tab/device that picked up
          if (callPcRef.current) return; // already answering
          answerAsCallee(current.call, payload.sdp);
        } else if (payload.type === "answer") {
          const pc = callPcRef.current;
          if (pc) pc.setRemoteDescription({ type: "answer", sdp: payload.sdp }).then(() => flushPendingIce(pc)).catch(() => {});
        } else if (payload.type === "candidate" && payload.candidate) {
          const pc = callPcRef.current;
          if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            pc.addIceCandidate(payload.candidate).catch(() => {});
          } else {
            pendingIceCandidatesRef.current.push(payload.candidate);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  const callEventHandlerRef = useRef(null);
  callEventHandlerRef.current = handleCallEvent;

  // -- the websocket itself: connects once per login, stays open for as
  // long as the person is on ANY page in the app -----------------------
  useEffect(() => {
    if (!currentUser?.id) return;

    const API_HTTP_BASE = API_ROOT;
    const WS_URL = API_HTTP_BASE.replace(/^http/, "ws") + "/ws/messages/";
    let cancelled = false;

    async function fetchTicket() {
      const token = getMessagingToken();
      if (!token) return null;
      const res = await fetch(`${API_HTTP_BASE}/api/auth/ws-ticket/`, {
        method: "POST",
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.ticket || null;
    }

    function scheduleReconnect() {
      if (cancelled) return;
      const attempt = wsReconnectAttemptRef.current + 1;
      wsReconnectAttemptRef.current = attempt;
      const delay = Math.min(15000, 1000 * 2 ** attempt);
      wsReconnectTimerRef.current = setTimeout(connect, delay);
    }

    async function connect() {
      if (cancelled) return;
      let ticket;
      try {
        ticket = await fetchTicket();
      } catch {
        scheduleReconnect();
        return;
      }
      if (cancelled) return;
      if (!ticket) {
        scheduleReconnect();
        return;
      }

      const socket = new WebSocket(`${WS_URL}?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = socket;

      socket.onopen = () => {
        wsReconnectAttemptRef.current = 0;
      };

      socket.onmessage = (event) => {
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
        if (typeof data.type === "string" && data.type.startsWith("call.")) {
          callEventHandlerRef.current && callEventHandlerRef.current(data);
        }
        // "You were assigned a task" — Dashboard listens for this window
        // event and lights the Tasks sidebar dot instantly.
        if (data.type === "message.new" || data.type === "thread.read") {
          window.dispatchEvent(new Event("hopenix:messages-changed"));
        }
        // Sound for things that arrive while the app is open and visible
        // (when it's hidden/closed the OS push notification makes the sound).
        if (document.visibilityState === "visible") {
          const mine = data.message && data.message.senderId === currentUser.id;
          if ((data.type === "message.new" && !mine) ||
            data.type === "task.assigned" ||
            data.type === "project.assigned" ||
            data.type === "visitor.request" ||
            data.type === "coworking.application" ||
            (typeof data.type === "string" && data.type.startsWith("birthday.")) ||
            (typeof data.type === "string" && data.type.startsWith("meeting."))
          ) {
            playNotificationSound();
          }
        }
        if (data.type === "task.assigned") {
          window.dispatchEvent(new CustomEvent("hopenix:task-assigned", { detail: data }));
        }
        // Every subscriber (MessagesPage's message/thread handling, the
        // per-conversation call-history refresh, anything else that
        // shows up later) gets the raw event too.
        subscribersRef.current.forEach((cb) => cb(data));
      };

      socket.onclose = (event) => {
        wsRef.current = null;
        if (cancelled || event.code === 4001) return; // 4001 = auth failed, don't retry
        scheduleReconnect();
      };

      socket.onerror = () => socket.close();
    }

    connect();

    return () => {
      cancelled = true;
      if (wsReconnectTimerRef.current) clearTimeout(wsReconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
    // Keyed on the user's id, not the user object: the object is replaced on
    // every profile refresh, which used to close and reopen the socket and
    // could drop a call event in the gap.
  }, [currentUser?.id]);

  // Ask for notification permission / subscribe to Web Push once per
  // login (idempotent — see pushSubscription.js), and recover any call
  // that's still RINGING for this user (e.g. opened the app from the
  // push notification itself, after missing the live event because the
  // tab/browser was closed when it was sent).
  useEffect(() => {
    if (!currentUser?.id) return;
    ensurePushSubscribed();
    apiFetchActiveIncomingCall()
      .then((call) => {
        if (call) handleCallEvent({ type: "call.incoming", call });
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Cleanup the peer connection / mic on logout or unmount.
  useEffect(() => {
    return () => {
      if (callPcRef.current) {
        try {
          callPcRef.current.close();
        } catch {
          /* already closed */
        }
      }
      if (callLocalStreamRef.current) callLocalStreamRef.current.getTracks().forEach((t) => t.stop());
      if (callRingTimeoutRef.current) clearTimeout(callRingTimeoutRef.current);
      if (callTimerIntervalRef.current) clearInterval(callTimerIntervalRef.current);
    };
  }, []);

  async function startCall(partner) {
    if (!partner?.otherUserId) return;
    if (activeCallRef.current) {
      setCallToast("You're already on a call");
      return;
    }
    // Ask for the microphone right now, while the tap is fresh (phones only
    // show the permission dialog reliably for a direct tap) — not later in
    // the middle of call setup.
    try {
      await getMicStream();
    } catch (err) {
      setCallToast(callErrorText(err));
      return;
    }
    try {
      const call = await apiStartCall(partner.otherUserId, "audio");
      if (call.status === "missed") {
        releaseMic();
        setCallToast(`${partner.name || "User"} is offline — call not delivered`);
        return;
      }
      setActiveCall({
        phase: "outgoing",
        call,
        partnerId: partner.otherUserId,
        partnerName: partner.name,
        partnerAvatar: call.calleeAvatar || partner.avatar,
      });
      callRingTimeoutRef.current = setTimeout(() => {
        const c = activeCallRef.current;
        if (c && c.call.id === call.id && c.phase === "outgoing") {
          apiEndCall(call.id).catch(() => {});
          setCallToast("No answer");
          cleanupCall();
        }
      }, 35000);
    } catch (err) {
      releaseMic();
      setCallToast(err.message || "Could not start call");
    }
  }

  async function acceptCall() {
    const c = activeCallRef.current;
    if (!c) return;
    // Microphone first, inside the tap. If it can't be had, decline cleanly
    // and say why, instead of "accepting" and then hanging up a moment later.
    try {
      await getMicStream();
    } catch (err) {
      setCallToast(callErrorText(err));
      apiRespondToCall(c.call.id, "reject").catch(() => {});
      cleanupCall();
      return;
    }
    acceptedCallIdRef.current = c.call.id;
    try {
      await apiRespondToCall(c.call.id, "accept");
      setActiveCall((cur) => (cur && cur.call.id === c.call.id && cur.phase === "incoming" ? { ...cur, phase: "connecting" } : cur));
    } catch (err) {
      setCallToast(err.message || "Could not accept call");
      cleanupCall();
    }
  }

  function rejectCall() {
    const c = activeCallRef.current;
    if (!c) return;
    apiRespondToCall(c.call.id, "reject").catch(() => {});
    cleanupCall();
  }

  function endCall() {
    const c = activeCallRef.current;
    if (!c) return;
    apiEndCall(c.call.id).catch(() => {});
    cleanupCall();
  }

  function toggleMute() {
    const stream = callLocalStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCallMuted(!track.enabled);
  }

  const mutedText = darkMode ? "text-slate-400" : "text-slate-500";

  return (
    <MessagingSocketContext.Provider
      value={{ activeCall, callSeconds, callMuted, subscribe, startCall, acceptCall, rejectCall, endCall, toggleMute }}
    >
      {children}

      {callToast && (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center px-2">
          <div className="flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-lg">
            {callToast}
          </div>
        </div>
      )}

      {/* Call overlay — incoming/outgoing/connecting/active. Rendered here
          (not inside MessagesPage) so it shows up no matter which page of
          the app is open when a call comes in. */}
      {activeCall && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4">
          <div className={`w-full max-w-xs rounded-2xl p-6 text-center shadow-2xl ${darkMode ? "bg-slate-900 text-slate-100" : "bg-white text-slate-800"}`}>
            <div className="mx-auto w-fit">
              <CallAvatar name={activeCall.partnerName || "User"} avatar={activeCall.partnerAvatar} darkMode={darkMode} />
            </div>
            <p className="mt-4 text-sm font-bold">{activeCall.partnerName || "User"}</p>
            <p className={`mt-1 text-[11px] ${mutedText}`}>
              {activeCall.phase === "incoming" && "Incoming call…"}
              {activeCall.phase === "outgoing" && "Ringing…"}
              {activeCall.phase === "connecting" && "Connecting…"}
              {activeCall.phase === "active" && formatCallDuration(callSeconds)}
            </p>

            {activeCall.phase === "incoming" ? (
              <div className="mt-6 flex items-center justify-center gap-6">
                <button
                  onClick={rejectCall}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg transition-colors hover:bg-rose-600"
                  aria-label="Decline call"
                  title="Decline"
                >
                  <PhoneOff size={20} />
                </button>
                <button
                  onClick={acceptCall}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-colors hover:bg-emerald-600"
                  aria-label="Accept call"
                  title="Accept"
                >
                  <PhoneIncoming size={20} />
                </button>
              </div>
            ) : (
              <div className="mt-6 flex items-center justify-center gap-4">
                {activeCall.phase === "active" && (
                  <button
                    onClick={toggleMute}
                    className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                      callMuted ? "bg-amber-500 text-white" : darkMode ? "bg-slate-800 text-slate-200" : "bg-slate-100 text-slate-700"
                    }`}
                    aria-label={callMuted ? "Unmute microphone" : "Mute microphone"}
                    title={callMuted ? "Unmute" : "Mute"}
                  >
                    {callMuted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                )}
                <button
                  onClick={endCall}
                  className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg transition-colors hover:bg-rose-600"
                  aria-label="End call"
                  title="End call"
                >
                  <PhoneOff size={20} />
                </button>
              </div>
            )}
          </div>
          <audio ref={remoteAudioRef} autoPlay />
        </div>
      )}
    </MessagingSocketContext.Provider>
  );
}