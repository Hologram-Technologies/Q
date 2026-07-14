// holo-call-mesh.mjs - group calls: an N-peer WebRTC MESH over the together-signal relay. Adapted from the Player's
// working reaction-camera mesh (apps/player/holo-watch.js) but on the shared `/signal` relay and the kind:"meet" κ-link,
// so a room is joinable in any browser (off-Hologram). Each peer holds one RTCPeerConnection to EVERY other peer; both
// sides use WebRTC "perfect negotiation" (polite = me<other by id) so they can both offer without glare. Media is E2E
// P2P (DTLS-SRTP); the relay only shuttles SDP/ICE. Mesh is fine to ~6 peers; beyond that an SFU forwards (MEET-E seam).

import * as Together from "./holo-together.mjs";
import { openSignal, tunePeer } from "./holo-call.mjs?v=8c1a249f8792";   // THE ONE SIGNAL DOOR — origin /signal on desktop, sealed Nostr rendezvous on hosted static; ?v matches app.mjs's pin so the SW serves ONE fresh copy, never a stale bare-URL cache hit

const ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: ["turn:openrelay.metered.ca:80", "turn:openrelay.metered.ca:443", "turns:openrelay.metered.ca:443"], username: "openrelayproject", credential: "openrelayproject" },
];
const _rid = () => "m" + Math.random().toString(36).slice(2, 10);

// ── link layer (kind:"meet") ──
export async function createMeet({ hostName = "", video = true, title = "", ttlSeconds = 8 * 3600, signal = null, room = null } = {}) {
  return Together.createSession({ kind: "meet", title, hostName, capability: "control", content: video ? "video" : "audio", signal, room, ttlSeconds });
}
// call-view.html = the participant page (lobby → grid, any browser). NEW path so no SW serves it stale; anchored to
// this module's own URL (normalization-proof across /Q → /hologram-os → root).
const _VIEW_URL = (() => { try { return new URL("./call-view.html", import.meta.url).pathname; } catch { return "/apps/holo-messenger/call-view.html"; } })();
export function buildMeetLink(intent, opts = {}) { return Together.buildLink(intent, { viewPath: _VIEW_URL, ...opts }); }
export function parseMeet(input) { return Together.parseSession(input); }
export function describeMeet(intent) { return { video: intent.content === "video", host: intent.hostName || "Someone", headline: intent.title || ((intent.hostName || "Someone") + "'s room") }; }
// SYNC detector for a GROUP-call link in a message body (the meet twin of holo-call.callLinkInText — same URL shapes,
// the decoded payload's kind==="meet" is the real gate, so a watch/doc together link never rings a group call).
const _MEET_RE = /(\S*(?:call|together)-view\.html#([A-Za-z0-9_-]+))|(holo:\/\/together\/\S*#([A-Za-z0-9_-]+))/;
export function meetLinkInText(text) {
  const m = String(text || "").match(_MEET_RE); if (!m) return null;
  const payload = m[2] || m[4], url = m[0];
  try { const it = JSON.parse(decodeURIComponent(escape(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))))); if (it && it.kind === "meet" && it.room) return { intent: it, url, payload }; } catch {}
  return null;
}

// (the per-module EventSource _connect was deleted — the mesh now signals through holo-call's shared openSignal,
//  so 1:1 calls and group meets ride ONE transport: /signal on an origin, the sealed Nostr rendezvous on hosted static)

// Join the meeting mesh with your local `media`. Returns controls + emits per-participant streams.
export async function joinMesh(intent, { media = null, displayName = "", onParticipant = () => {}, onParticipantLeave = () => {}, onState = () => {}, onActiveSpeaker = () => {}, onName = () => {} } = {}) {
  const base = intent.signal || (typeof location !== "undefined" ? location.origin : "");
  const room = intent.room, me = _rid();
  const peers = new Map();   // other → { pc, makingOffer, ignoreOffer, polite, stream }
  const names = new Map();   // other → display name (rides the sealed signal, never the media path)
  let left = false;

  // QUALITY, mesh-aware: every peer costs an uplink copy, so the per-peer video cap scales down as the room grows —
  // total uplink stays ~constant (≈2.5 Mbps) and nobody's connection melts. Retuned on every join/leave.
  const _vCap = () => { const n = Math.max(1, peers.size); return n <= 1 ? 2500 : n <= 3 ? 1200 : n <= 5 ? 800 : 500; };
  function retune() { const kbps = _vCap(); for (const [, st] of peers) tunePeer(st.pc, { videoKbps: kbps }); }

  const sig = await openSignal(base, room, me, async (d) => {
    if (left) return;
    if (d.kind === "ready") { for (const p of (d.peers || [])) ensure(p); }
    else if (d.kind === "peer-join") ensure(d.from);
    else if (d.kind === "peer-leave") drop(d.from);
    else if (d.kind === "bye") drop(d.from);
    else if (d.kind === "name" && d.from && d.from !== me) { if (d.name && names.get(d.from) !== d.name) { names.set(d.from, String(d.name).slice(0, 40)); onName(d.from, names.get(d.from)); } }
    // ensure on signal receipt too - with simultaneous joins an offer can arrive BEFORE peer-join; dropping it would
    // deadlock (both sides offered, neither applied). Perfect negotiation resolves the resulting glare.
    else if (d.kind === "sdp" && d.from && d.from !== me) { ensure(d.from); onSignal(d.from, { sdp: d.data }); }
    else if (d.kind === "ice" && d.from && d.from !== me) { ensure(d.from); onSignal(d.from, { ice: d.data }); }
  });
  const sayName = () => { if (displayName) { try { sig.post({ kind: "name", name: String(displayName).slice(0, 40) }); } catch {} } };
  sayName();   // introduce yourself; re-said whenever a NEW peer appears so late joiners always learn every name

  function ensure(other) {
    if (other === me || peers.has(other) || left) return;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const st = { pc, makingOffer: false, ignoreOffer: false, polite: me < other, stream: null };
    peers.set(other, st);
    sayName();
    if (media) for (const t of media.getTracks()) pc.addTrack(t, media);
    pc.ontrack = ({ streams }) => { if (streams && streams[0]) { st.stream = streams[0]; onParticipant(other, streams[0], names.get(other) || null); } };
    pc.onnegotiationneeded = async () => { try { st.makingOffer = true; await pc.setLocalDescription(); sig.post({ to: other, kind: "sdp", data: pc.localDescription }); } catch {} finally { st.makingOffer = false; } };
    pc.onicecandidate = ({ candidate }) => { if (candidate) sig.post({ to: other, kind: "ice", data: candidate }); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === "connected") retune(); onState({ peer: other, state: pc.connectionState }); };
  }
  async function onSignal(other, d) {
    const st = peers.get(other); if (!st) return; const pc = st.pc;
    try {
      if (d.sdp) {
        const collision = d.sdp.type === "offer" && (st.makingOffer || pc.signalingState !== "stable");
        st.ignoreOffer = !st.polite && collision; if (st.ignoreOffer) return;
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === "offer") { await pc.setLocalDescription(); sig.post({ to: other, kind: "sdp", data: pc.localDescription }); }
      } else if (d.ice) { try { await pc.addIceCandidate(d.ice); } catch (e) { if (!st.ignoreOffer) throw e; } }
    } catch {}
  }
  function drop(other) { const st = peers.get(other); if (!st) return; try { st.pc.close(); } catch {} peers.delete(other); names.delete(other); analysers.delete(other); onParticipantLeave(other); retune(); }

  // active-speaker: RMS of each remote stream via an AudioContext analyser; loudest above a floor wins.
  let ac = null, asTimer = null, lastAS = null; const analysers = new Map();
  function startActiveSpeaker() {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume && ac.resume(); } catch { return; }
    asTimer = setInterval(() => {
      let best = null, bestLvl = 0;
      for (const [other, st] of peers) {
        if (!st.stream || !st.stream.getAudioTracks().length) continue;
        let an = analysers.get(other);
        if (!an) { try { const src = ac.createMediaStreamSource(st.stream); an = ac.createAnalyser(); an.fftSize = 256; src.connect(an); analysers.set(other, an); } catch { continue; } }
        const buf = new Uint8Array(an.frequencyBinCount); an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const rms = Math.sqrt(sum / buf.length);
        if (rms > bestLvl) { bestLvl = rms; best = other; }
      }
      if (best && bestLvl > 0.012 && best !== lastAS) { lastAS = best; onActiveSpeaker(best); }
    }, 400);
  }
  if (typeof window !== "undefined") startActiveSpeaker();

  onState({ phase: "connecting" });
  return {
    me,
    participants: () => [...peers.keys()],
    count: () => peers.size,
    nameOf: (other) => names.get(other) || null,
    mute(on) { if (media) media.getAudioTracks().forEach((t) => (t.enabled = !on)); },
    setCamera(on) { if (media) media.getVideoTracks().forEach((t) => (t.enabled = on)); },
    // camera flip (front↔back): swap the outgoing VIDEO track on every peer without renegotiation
    // (replaceTrack is seamless), and keep the local `media` object consistent so mute/setCamera still work.
    async replaceVideoTrack(track) {
      if (!track) return;
      for (const [, st] of peers) { const s = st.pc.getSenders().find((x) => x.track && x.track.kind === "video"); if (s) { try { await s.replaceTrack(track); } catch {} } }
      if (media) { const old = media.getVideoTracks()[0]; if (old && old !== track) { try { media.removeTrack(old); old.stop(); } catch {} } try { media.addTrack(track); } catch {} }
    },
    streamOf: (other) => { const st = peers.get(other); return st ? st.stream : null; },
    _pcs: () => [...peers.values()].map((st) => st.pc),   // debug/witness: the raw peer connections (bitrate-cap gate)
    leave() { left = true; try { sig.post({ kind: "bye" }); } catch {} try { clearInterval(asTimer); } catch {} for (const [, st] of peers) { try { st.pc.close(); } catch {} } peers.clear(); try { sig.close(); } catch {} try { ac && ac.close(); } catch {} onState({ phase: "ended" }); },
  };
}
