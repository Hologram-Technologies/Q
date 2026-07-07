// holo-peer-egress.mjs — the DEVICE-MESH exit peer: run the web?url= contract over a holo-together-rtc
// data channel, so a browsing device (a phone on the serverless bundle) exits the real web through the
// OWNER'S OTHER DEVICE (a desktop running a Hologram host that already answers /web) — dialed by κ,
// authenticated by the sovereign identity, with a signaling relay that only swaps ICE and never sees a
// payload byte (SEC-7). This is one more egress TIER, not a new network: it composes the SAME transport
// (holo-together-rtc host/join), the SAME signaling (together-signal), the SAME /web contract. The only
// thing added on top is request/response framing (a reqId per fetch) and chunked base64 body transfer.
//
// TRUST: the bytes that arrive here are minted + re-derived against their κ by browser-sw's serveWeb/serveSub
// EXACTLY like every other tier (Law L5). A malicious peer cannot forge content — the worst it does is refuse
// or stall, and the ladder falls past it. The peer is untrusted transport, like every carrier; trust is in the κ.
//
// ROOM: derived from the owner identity so it is not guessable from nothing — blake3(identKappa || "egress").
// Both devices that share the identity derive the same room and find each other; a stranger who guesses the
// room still cannot open the /web bridge on the answerer (auth is a separate, caller-supplied verify hook).

import { host as rtcHost, join as rtcJoin } from "../../holo-messenger/holo-together-rtc.mjs";

const MAX_BODY = 24 * 1024 * 1024;    // SEC-8: reassembly bounded by RECEIVED bytes, never a length the peer declares
const CHUNK = 48 * 1024;              // base64 chunk of raw bytes per ctl frame (~64KB on the wire)
const _b64 = { enc: (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
               dec: (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; } };

// derive the mesh room from an owner-identity κ (or a raw string) — content-addressed, not a secret.
export async function egressRoom(identKappa) {
  const seed = "holo-egress-mesh:" + String(identKappa || "");
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
    return "egr-" + [...new Uint8Array(buf)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch { return "egr-" + seed.replace(/[^a-z0-9]/gi, "").slice(0, 32); }
}

// ── ANSWERER — runs on the DEVICE THAT HAS EGRESS (the desktop host). For each request received, it calls
// its OWN /web?url=… (same origin — it IS the host) and streams the response back to that one peer, chunked.
// It is content-blind: it pipes bytes, it does not parse them (SEC-7). `verify(viewer, req)` is the auth hook
// (caller wires holo-direct/holo-verify); returning false refuses the request without ever touching /web. ──
// fetchImpl(url,{doc,op}) → { status, headers, bytes } lets a witness inject an echo transport; the DEFAULT
// calls the host's OWN /web (same origin — it IS the host), which is the whole point in production.
export async function serveAsExitPeer({ identKappa = "", signal = null, webBase = "/apps/browser/web?url=",
                                        verify = null, fetchImpl = null, onState = () => {} } = {}) {
  const room = await egressRoom(identKappa);
  const viaWeb = async (url, { doc, op }) => {
    const q = encodeURIComponent(url) + (doc ? "&doc=1" : "") + (op ? "&op=" + encodeURIComponent(op) : "");
    const r = await fetch(webBase + q);
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    return { status: r.status, headers, bytes: new Uint8Array(await r.arrayBuffer()) };
  };
  const doFetch = fetchImpl || viaWeb;
  let api = null;
  async function handle(msg, viewer) {
    if (!msg || msg.t !== "req" || !msg.id || !msg.url) return;
    const reply = (o) => api && api.send(viewer, o);
    try {
      if (verify) { const ok = await verify(viewer, msg); if (!ok) { reply({ t: "res", id: msg.id, error: "refused: peer not authorized (SEC-2/4)" }); return; } }
      const { status, headers, bytes } = await doFetch(msg.url, { doc: msg.doc, op: msg.op });
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (buf.length > MAX_BODY) { reply({ t: "res", id: msg.id, error: "over cap" }); return; }
      reply({ t: "res", id: msg.id, status, headers: headers || {}, len: buf.length, chunks: Math.ceil(buf.length / CHUNK) });
      for (let i = 0, seq = 0; i < buf.length; i += CHUNK, seq++) reply({ t: "chunk", id: msg.id, seq, b: _b64.enc(buf.subarray(i, i + CHUNK)) });
    } catch (e) { reply({ t: "res", id: msg.id, error: "exit-peer fetch failed: " + (e && e.message || e) }); }
  }
  api = await rtcHost({ room, control: true, signal, onControl: handle, onState });
  return { ok: !!(api && api.ok), room, stop: () => api && api.stop(), peers: () => (api ? api.peers() : 0) };
}

// ── REQUESTER — runs on the BROWSING DEVICE (the page context; RTC belongs in the page, not the SW). Dials the
// room, and exposes peerFetch(url,{doc,op}) → { status, headers, bytes } when the framed reply completes, or
// rejects on timeout so browser-sw's ladder falls past. Correlated by reqId; chunks reassembled under the cap. ──
export async function connectExitPeer({ identKappa = "", signal = null, timeoutMs = 12000, onState = () => {} } = {}) {
  const room = await egressRoom(identKappa);
  const pending = new Map();   // reqId → { resolve, reject, meta, chunks:[], got, timer }
  function onControl(msg) {
    if (!msg || !msg.id) return;
    const p = pending.get(msg.id); if (!p) return;
    if (msg.t === "res") {
      if (msg.error) { clearTimeout(p.timer); pending.delete(msg.id); p.reject(new Error(msg.error)); return; }
      p.meta = { status: msg.status, headers: msg.headers || {}, len: msg.len | 0, chunks: msg.chunks | 0 };
      p.chunks = new Array(p.meta.chunks); p.got = 0;
      if (p.meta.chunks === 0) finish(msg.id);       // empty body
    } else if (msg.t === "chunk" && p.meta) {
      if (p.chunks[msg.seq] == null) { p.chunks[msg.seq] = _b64.dec(msg.b); p.got++; if (p.got >= p.meta.chunks) finish(msg.id); }
    }
  }
  function finish(id) {
    const p = pending.get(id); if (!p) return; clearTimeout(p.timer); pending.delete(id);
    let total = 0; for (const c of p.chunks) total += (c ? c.length : 0);
    if (total > MAX_BODY) { p.reject(new Error("over cap")); return; }
    const bytes = new Uint8Array(total); let o = 0; for (const c of p.chunks) { if (c) { bytes.set(c, o); o += c.length; } }
    p.resolve({ status: p.meta.status, headers: p.meta.headers, bytes });
  }
  const link = await rtcJoin({ room, signal, onControl, onState });
  let ready = false;
  function peerFetch(url, { doc = false, op = "" } = {}) {
    return new Promise((resolve, reject) => {
      if (!link || !link.ok) return reject(new Error("no peer link"));
      const id = "r" + Math.random().toString(36).slice(2, 10);
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("peer egress timeout")); }, timeoutMs);
      pending.set(id, { resolve, reject, meta: null, chunks: [], got: 0, timer });
      link.send({ t: "req", id, url, doc: !!doc, op });
    });
  }
  return { ok: !!(link && link.ok), room, peerFetch, leave: () => link && link.leave(),
           markReady: () => { ready = true; }, isReady: () => ready };
}
