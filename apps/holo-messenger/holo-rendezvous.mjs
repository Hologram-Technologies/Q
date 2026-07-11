// holo-rendezvous.mjs — W2: the blind mailbox IS the signaling channel. Two verbs, nothing else:
//   await rendezvousDial(peerPub, { identity, myPub, mailboxBase, spine, stun })  → open P2P link (caller side)
//   const stop = onRendezvous({ identity, myPub, mailboxBase, spine, stun }, accept, onLink)  → answer incoming dials
//
// Every signal message ({t:"offer"|"answer"|"ice-batch"}) is holo-seal'ed to the peer and dropped on a DISTINCT
// mailbox lane ("holo-rdv-v1" — holo-dm.laneTag): the drop-box sees only sealed bytes (SDP leaks IPs; here it
// never leaves the envelope), and dial traffic never mixes with message delivery. The envelope's own signature
// is the rendezvous auth: signaling that does not VERIFY is dropped before any RTC state exists (anti-MITM at
// the front door), and TOFU/key-change fires BEFORE accept_offer — the fast path is never a downgrade path.
//
// ONE LANE OWNER PER IDENTITY (the hard-won bit): a single poller pulls my rdv lane and DISPATCHES — offers to
// the listener, answer/ICE to the active dial's handler, keyed by the verified sender. Two independent pollers
// on one tag RACE on ack and silently swallow each other's envelopes (the listener acks an ICE batch it can't
// route → the dial wedges while the mailbox fallback carries the word). One owner, no race, and the cadence
// self-tunes: ~400 ms while any dial is in flight, 1 s idle listening — fast when it matters, cheap when not.
// ICE candidates batch into one envelope per flush tick. A dial that cannot complete fails LOUDLY, naming the
// failing leg — that is what Q narrates (N7).

import * as Seal from "./holo-seal.mjs?v=n8";
import * as DM from "./holo-dm.mjs?v=n8";
import * as Verify from "./holo-verify.mjs?v=n8";

const LANE = "holo-rdv-v1";
const DIAL_POLL_MS = 400, IDLE_POLL_MS = 1000, ICE_FLUSH_MS = 250, TIMEOUT_MS = 30000;

// seal one signal message to the peer and drop it on THEIR rdv lane
async function _drop(peerPub, msg, { identity, myPub, mailboxBase }) {
  const env = await Seal.seal(JSON.stringify(msg), { toBoxPub: peerPub.box, fromKeys: identity, fromPub: myPub });
  await DM.mailboxDrop(peerPub.box, Seal.toWire(env), { mailboxBase, tag: await DM.laneTag(LANE, peerPub.box) });
}

// pull MY rdv lane once; open + verify each envelope; hand VERIFIED messages (with sender) to sink; ack all.
async function _pullOnce(ctx, sink) {
  const tag = await DM.laneTag(LANE, ctx.myPub.box);
  const items = await DM.mailboxPull(ctx.myPub.box, { mailboxBase: ctx.mailboxBase, tag });
  const acked = [];
  for (const it of items) {
    acked.push(it.id);                                   // ack everything — a forged blob must not loop forever
    const env = Seal.fromWire(it.blob); if (!env) continue;
    const r = await Seal.open(env, { myKeys: ctx.identity });
    if (!r.ok || !r.verified) continue;                  // unverified signaling DIES here — before any RTC state
    let msg = null; try { msg = JSON.parse(r.plaintext); } catch {}
    if (msg && msg.t) sink(msg, r.from);
  }
  if (acked.length) await DM.mailboxAck(ctx.myPub.box, acked, { mailboxBase: ctx.mailboxBase, tag });
}

// ---- the lane owner: ONE poller per (identity, drop-box), dispatching to listener + active dials ----------
const _lanes = new Map();   // mailboxBase|myBox → lane
function _lane(ctx) {
  const key = (ctx.mailboxBase || "") + "|" + ctx.myPub.box;
  let L = _lanes.get(key); if (L) return L;
  L = { handlers: new Map() /* peerSign → fn(msg) */, aborts: new Map() /* peerSign → abort my dial */, onOffer: null, active: 0, started: false };
  let to = null, inFlight = false;
  const tick = async () => {
    if (inFlight) return; inFlight = true;
    try {
      await _pullOnce(ctx, (msg, from) => {
        if (msg.t === "offer") {
          // GLARE (both sides dialed at once — e.g. two chats opened simultaneously): the offers would swallow
          // each other and both dials wedge. Polite-peer election, deterministic on the identity itself: the
          // lexicographically LOWER sign key stays the initiator; the other side ABORTS its own dial and answers.
          if (L.aborts.has(from)) {
            if (ctx.myPub.sign < from) return;                    // I win — drop their offer; they yield to mine
            const abort = L.aborts.get(from); L.aborts.delete(from); abort();   // they win — abandon my dial…
          }
          if (L.onOffer) L.onOffer(msg, from);                    // …and answer theirs (self-guarded per peer)
          return;
        }
        const h = L.handlers.get(from);
        if (h) for (const m of (msg.t === "ice-batch" ? msg.items : [msg])) h(m);
        // no handler + not an offer → a straggler from a finished dial; acked above, dropped here — harmless
      });
    } catch {} finally { inFlight = false; schedule(); }
  };
  const schedule = () => { clearTimeout(to); to = setTimeout(tick, L.active > 0 ? DIAL_POLL_MS : IDLE_POLL_MS); };
  L.start = () => { if (!L.started) { L.started = true; tick(); } };
  L.bump = () => { clearTimeout(to); tick(); };          // a dial just started — pull NOW, not next tick
  _lanes.set(key, L); return L;
}

// the per-dial signal adapter: seals outbound (batching ICE), receives via the lane's dispatch
function _signal(peerPub, ctx, { legs }) {
  const L = _lane(ctx);
  let onFn = null, ice = [], flusher = null, myFn = null, myAbort = null;
  const flushIce = () => { if (ice.length) { const items = ice.splice(0); _drop(peerPub, { t: "ice-batch", items }, ctx).catch((e) => { legs.dropErr = String(e); }); } };
  return {
    // the OFFER carries the caller's box key — the listener needs it to seal the answer back (strangers share
    // only public keys; the offer is the introduction).
    send: (m) => { legs.sent = m.t; if (m.t === "ice") ice.push(m); else _drop(peerPub, m.t === "offer" ? { ...m, fromBox: ctx.myPub.box } : m, ctx).catch((e) => { legs.dropErr = String(e); }); },
    on: (fn) => { onFn = fn; },
    inject: (m) => { onFn && onFn(m); },                 // re-deliver the offer that woke the listener into its dial
    start: (abort = null) => { myFn = (m) => { legs.got = m.t; onFn && onFn(m); }; L.handlers.set(peerPub.sign, myFn); if (abort) { myAbort = abort; L.aborts.set(peerPub.sign, abort); } L.active++; L.start(); L.bump(); flusher = setInterval(flushIce, ICE_FLUSH_MS); },
    // delete ONLY what THIS signal registered — on a glare yield, the answer's signal re-registers the same peer
    // before the aborted dial's finally runs; a blind delete would clobber the live answer's handler.
    stop: () => { flushIce(); clearInterval(flusher); if (L.handlers.get(peerPub.sign) === myFn) L.handlers.delete(peerPub.sign); if (myAbort && L.aborts.get(peerPub.sign) === myAbort) L.aborts.delete(peerPub.sign); L.active = Math.max(0, L.active - 1); },
  };
}

function _legName(legs) {
  if (legs.dropErr || legs.pullErr) return "mailbox unreachable (" + (legs.dropErr || legs.pullErr) + ")";
  if (!legs.sent) return "offer never sent";
  if (!legs.got) return "no reply pulled (peer not listening?)";
  return "signaling exchanged (" + legs.got + ") but ICE never connected — NAT beyond STUN? (TURN is the opt-in tier)";
}

// ---- verb 1: dial a peer you know the public keys of ------------------------------------------------------
export async function rendezvousDial(peerPub, { identity, myPub, mailboxBase = null, spine, stun = null, trust = null } = {}) {
  const t = trust || Verify.makeTrustStore({});
  if (t.check(peerPub.sign, peerPub).status === "changed") throw new Error("key CHANGE for peer — refusing to auto-dial (verify the safety number first)");
  t.record(peerPub.sign, peerPub);
  const legs = {}, ctx = { identity, myPub, mailboxBase };
  const sig = _signal(peerPub, ctx, { legs });
  let yieldGlare;                                        // fires if BOTH sides dialed and the peer won the election
  const glareP = new Promise((_, rej) => { yieldGlare = () => rej(new Error("glare-yield: peer is initiator; answering their dial instead")); });
  sig.start(yieldGlare);
  try {
    return await Promise.race([
      spine.dial({ initiator: true, signal: sig, stun }),
      glareP,
      new Promise((_, rej) => setTimeout(() => rej(new Error("rendezvous timeout: " + _legName(legs))), TIMEOUT_MS)),
    ]);
  } finally { sig.stop(); }
}

// ---- verb 2: answer incoming dials (the "ringing" side) ---------------------------------------------------
// `accept(peerPub, trustStatus)` decides (sync or async). Each accepted dial resolves through `onLink(link, peerPub)`.
// Returns stop().
export function onRendezvous({ identity, myPub, mailboxBase = null, spine, stun = null, trust = null } = {}, accept, onLink) {
  const t = trust || Verify.makeTrustStore({});
  const ctx = { identity, myPub, mailboxBase };
  const L = _lane(ctx);
  const answering = new Set();     // one answer per offering peer at a time
  L.onOffer = async (msg, fromSign) => {
    if (answering.has(fromSign) || !msg.fromBox) return;
    const peerPub = { sign: fromSign, box: msg.fromBox };
    const st = t.check(fromSign, peerPub);
    if (st.status === "changed") return;                 // a changed key never auto-answers
    if (!(await accept(peerPub, st))) return;
    t.record(fromSign, peerPub);
    answering.add(fromSign);
    const legs = {}, sig = _signal(peerPub, ctx, { legs });
    sig.start();
    try {
      // spine.dial registers signal.on synchronously (before its first await), so the offer that woke us can be
      // re-delivered on the next tick and is guaranteed a listening handler.
      const linkP = spine.dial({ initiator: false, signal: sig, stun });
      setTimeout(() => sig.inject(msg), 0);
      const link = await linkP;
      onLink && onLink(link, peerPub);
    } catch (e) { console.warn("[rendezvous] answer failed:", String(e)); }
    finally { sig.stop(); answering.delete(fromSign); }
  };
  L.start();
  return () => { if (L.onOffer) L.onOffer = null; };
}
