// holo-direct.mjs - the Holo Direct ENGINE: one clean API the messenger calls, composing the verified primitives -
// holo-seal (sealed+signed+κ envelope), holo-dm (blind mailbox / offline delivery), holo-verify (safety number + TOFU
// trust), the sovereign identity - and, when a spine is passed, the NATIVE P2P fast-path (holo-net WebRtcLink, dialed
// through holo-rendezvous: sealed SDP over the same blind mailbox, W2). send() is DUAL-PATH and the UI never knows:
// a live link carries the envelope in ~30 ms (path:"p2p"); otherwise the mailbox takes it exactly as before
// (path:"mailbox") and a BACKGROUND dial warms the link so the NEXT word is fast. Both carriers drain through ONE
// receive gate (open → verify → κ-dedup → "message") - one canonical message contract, two carriers (L2). Trust is
// unchanged: TOFU + key-change warnings fire before anything is sent or answered, on both paths. Without a spine the
// engine degrades to exactly the old mailbox-only behavior. (holo-ratchet is the stronger per-session mode - enabled
// once prekey publishing lands; per-message ECIES already gives forward secrecy for each message.)

import * as Seal from "./holo-seal.mjs?v=n8";
import * as DM from "./holo-dm.mjs?v=n8";
import * as Verify from "./holo-verify.mjs?v=n8";
import * as RDV from "./holo-rendezvous.mjs";
import { wireEncode, wireDecode } from "./holo-net-wire.mjs";
import * as Media from "./holo-direct-media.mjs";

// STUN opens most links (a STUN server sees addresses, never content); TURN relays ENCRYPTED bytes it
// cannot read, for symmetric/mobile NATs (home↔office↔cellular — the team case) where a direct link never
// forms — Law L1/L5 hold, a relay is a dumb pipe. Open Relay is a shared best-effort PUBLIC TURN
// (rate-limited); a durable owned TURN (Cloudflare Calls) is a later rung. Pass ice:null (or stun:null) to
// go host-only (LAN / same machine — what most witnesses want).
const DEFAULT_ICE = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
  { urls: "turns:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
];

export async function makeDirect({ identity = null, mailboxBase = null, trustStore = null, load = null, save = null,
                                   spine = null, stun = null, ice = DEFAULT_ICE, store = null, displayName = null, olm = null } = {}) {
  const id = identity || await Seal.generateIdentity();
  const myPub = await Seal.exportPublic(id);
  // ── THE SEAL WAIST (R1-R3) — one interface so the door never knows which cipher sealed a message. Default
  //    impl is holo-seal (X25519 box + Ed25519 sign). When an Olm ratchet (`olm` = a seal2 instance) is passed
  //    AND we hold the peer's prekey bundle, outbound seals with vodozemac (envelope tag s:"olm") for forward
  //    secrecy + PCS; inbound routes by the `s` tag. Sessions bootstrap over holo-seal `voz-bundle` control
  //    frames (R2), so holo-seal is BOTH the fallback and the handshake carrier — never removed. An untagged
  //    envelope is holo-seal (backward-compatible with every already-shipped peer).
  let olmId = null;
  if (olm) { try { await olm.init(); olmId = olm.identityKey(); } catch (e) { olm = null; } }
  const vozBook = new Map();   // cid → { bundle, oid } — the peer's Olm prekey bundle + identity key (persisted)
  const _vozSent = new Set();  // contacts we've already handed our bundle to (send it once)
  const _vozPending = new Map();   // signKey → {bundle,oid} — a bundle that arrived BEFORE we knew the contact (race)
  const _stats = { olmSealed: 0, seal1Sealed: 0, olmOpened: 0 };   // honest instrumentation (witness + a truthful lock)
  const sealer = {
    get kind() { return olm ? "olm" : "seal1"; },
    seal: (cid, plaintext, pub) => _sealImpl(cid, plaintext, pub),
    open: (env) => _openImpl(env),
    toWire: (env) => Seal.toWire(env),
    fromWire: (s) => Seal.fromWire(s),
  };
  async function _sha256hex(s) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
  // seal TO a contact: ratchet if we hold their bundle (establish the outbound session on first use), else
  // holo-seal — AND kick off the handshake so the NEXT word ratchets. A ratchet hiccup falls back, never drops.
  async function _sealImpl(cid, plaintext, pub) {
    if (olm && pub && pub.box) {
      const peer = vozBook.get(cid);
      if (peer && peer.bundle) {
        try {
          if (!(await olm.hasSession(cid))) {
            // DETERMINISTIC initiator — avoids Olm's two-way establishment race (both sides createOutbound →
            // mismatched sessions that can't decrypt each other). The smaller sign key initiates; the other
            // WAITS for its pre-key message (→ inbound session), sealing holo-seal until then. One shared session.
            if (myPub.sign < pub.sign) await olm.startOutbound(cid, peer.bundle);
            else throw new Error("await-inbound");
          }
          const m = await olm.sealTo(cid, plaintext);                      // {t,c}; the pickle re-persists (HARD-1)
          const env = { s: "olm", t: m.t, c: m.c, from: myPub.sign, oid: olmId, ts: Date.now() };
          env.kappa = await _sha256hex(JSON.stringify([env.s, env.t, env.c, env.from, env.oid, env.ts]));
          _stats.olmSealed++;
          return env;
        } catch (e) { /* ratchet hiccup → holo-seal keeps the conversation alive (debt=HONESTY) */ }
      } else { _ensureVoz(cid); }                                          // no bundle yet → send ours
    }
    return Seal.seal(plaintext, { toBoxPub: pub.box, fromKeys: id, fromPub: myPub });
  }
  async function _openImpl(env) {
    if (env && env.s === "olm") {
      if (!olm) return { ok: false };
      const cid = _findBySign(env.from); if (!cid) return { ok: false };   // no session route for an unknown sender
      try { const pt = await olm.receive(cid, env.oid, { t: env.t, c: env.c }); _stats.olmOpened++; return { ok: true, from: env.from, verified: true, plaintext: pt }; }
      catch { return { ok: false }; }
    }
    return Seal.open(env, { myKeys: id });
  }
  // hand our Olm prekey bundle to a contact ONCE (a holo-seal-sealed, signed control frame → the bundle is
  // authenticated + bound to our sign key at bootstrap, TOFU). Reciprocated on receipt. No prekey server.
  async function _ensureVoz(cid) {
    if (!olm || _vozSent.has(cid)) return;
    const pub = book.get(cid); if (!pub || !pub.box) return;
    _vozSent.add(cid);
    try { const bundle = await olm.publishBundle(); await _sendControl(cid, { t: "voz-bundle", bundle, oid: olmId }); }
    catch { _vozSent.delete(cid); }
  }
  // a bundle can arrive BEFORE its sender's first message creates the contact (the inviter knows the invitee
  // from the link, so their bundle races their words). We stash such a bundle by sign key; when the contact
  // forms (any inbound message), we bind it → the ratchet becomes symmetric. This fixed a one-way ratchet.
  function _drainVoz(cid, fromSign) {
    const p = _vozPending.get(fromSign); if (!p) return;
    _vozPending.delete(fromSign);
    vozBook.set(cid, p);
    if (store && store.setMeta) store.setMeta("voz:peer:" + cid, JSON.stringify(p)).catch(() => {});
    _ensureVoz(cid);   // reciprocate now that they're answerable
  }
  // each sovereign identity gets its OWN trust store - never a shared global key (else two identities, or a stale entry
  // from a prior session, collide and look like a key change). Namespace the persistence by my own identity.
  const nsKey = "holo.direct.trust." + myPub.sign.slice(0, 22);
  const trust = trustStore || Verify.makeTrustStore({
    load: load || (() => { try { return (typeof localStorage !== "undefined") ? JSON.parse(localStorage.getItem(nsKey) || "{}") : {}; } catch { return {}; } }),
    save: save || ((c) => { try { if (typeof localStorage !== "undefined") localStorage.setItem(nsKey, JSON.stringify(c)); } catch {} }),
  });
  const book = new Map();     // contactId → pub {sign,box}
  const listeners = { message: [], keychange: [], tick: [], typing: [], media: [] };
  const emit = (ev, x) => (listeners[ev] || []).forEach((f) => { try { f(x); } catch {} });

  // the durable store (holo-direct-store, optional): contacts + messages survive reload, sealed at rest.
  // Hydrate the address book NOW — identity persistence without contact persistence is a door with no
  // address book. Without a store the engine degrades to exactly the old in-memory behavior.
  if (store) { try { for (const c of await store.contacts()) book.set(c.contactId, c.pub); } catch {} }
  // R2/R4 — rehydrate each contact's Olm prekey bundle so a RETURNING user keeps ratcheting with no fresh
  // handshake (the seal2 account + sessions rehydrate from the vault inside `olm`; this restores the peer half).
  if (olm && store && store.getMeta) { for (const cid of [...book.keys()]) { try { const v = await store.getMeta("voz:peer:" + cid); if (v) vozBook.set(cid, JSON.parse(v)); } catch {} } }

  // ── ONE wire contract (C3): user text travels as {t:"msg",text}; control frames are {t:"ack"|"typing"}.
  // Legacy inbound bare text is accepted as a message (older peers); outbound always wraps.
  // N8: every outbound user message also carries MY box key (+ display name if set) INSIDE the sealed
  // payload — so the one-link door is TWO-WAY from the first word: the inviter's inbound-only stub
  // upgrades to a full, answerable contact (TOFU, tied to the signature that sealed it). WhatsApp feel.
  const _intro = () => ({ fromBox: myPub.box, ...(displayName ? { fromName: String(displayName).slice(0, 48) } : {}) });
  const _wrap = (text) => JSON.stringify({ t: "msg", text, ..._intro() });
  const _parse = (plaintext) => {
    try { const p = JSON.parse(plaintext); if (p && p.t) return p; } catch {}
    return { t: "msg", text: plaintext };                     // legacy bare string
  };

  // exactly-once across carriers: the p2p frame and the mailbox blob can RACE (a send chose the mailbox while a dial
  // completed). κ is already computed over the canonical envelope - dedup is a Set lookup, marked only AFTER a
  // successful open (a forged κ with different bytes fails open and cannot block the real message).
  const seen = new Set(); const seenQ = [];
  const _dedup = (kappa) => { if (seen.has(kappa)) return true; seen.add(kappa); seenQ.push(kappa); if (seenQ.length > 512) seen.delete(seenQ.shift()); return false; };

  // add / update a contact (pub from the sovereign graph). Detects a KEY CHANGE (anti-MITM) before trusting it.
  function addContact(contactId, pub, { acceptChange = false } = {}) {
    const st = trust.check(contactId, pub);
    if (st.status === "changed" && !acceptChange) { emit("keychange", { contactId, pub, wasVerified: st.wasVerified }); book.set(contactId, pub); return { ...st, blocked: true }; }
    trust.record(contactId, pub); book.set(contactId, pub);
    if (store) store.putContact(contactId, { pub, addedTs: Date.now() }).catch(() => {});   // the address book survives
    return trust.check(contactId, pub);
  }
  function _findBySign(signPub) { for (const [cid, p] of book) if (p.sign === signPub) return cid; return null; }

  // the display name a first-word sender carried (inside the sealed, signed payload). NEVER merge threads:
  // if the name is already a contact under a DIFFERENT key, refuse it and fall back to the key-derived id.
  function _nameFor(payload, fromSign) {
    if (!payload || typeof payload.fromName !== "string") return null;
    const nm = payload.fromName.replace(/\s+/g, " ").trim().slice(0, 48);
    if (!nm) return null;
    const cur = book.get(nm);
    if (cur && cur.sign !== fromSign) return null;
    return nm;
  }
  // one-link two-way (N8): a payload that carries the sender's box key upgrades their inbound-only stub
  // to a full, answerable contact — TOFU, bound to the signature that sealed the very message.
  function _upgradeFrom(contactId, fromSign, payload) {
    if (!payload || !payload.fromBox) return;
    const cur = book.get(contactId);
    if (cur && cur.box) return;                              // full contact already — a payload never overwrites keys
    addContact(contactId, { sign: fromSign, box: payload.fromBox });
  }

  // a tiny sealed control frame back to a KNOWN contact — over the open link when up, the mailbox when not.
  // (An unknown sender can't be acked: we know their sign key from the envelope, not their box key.)
  async function _sendControl(contactId, frame) {
    const pub = book.get(contactId); if (!pub) return false;
    const env = await sealer.seal(contactId, JSON.stringify(frame), pub);
    const link = links.get(contactId);
    if (link && link.open) { try { link.send(wireEncode(env)); return true; } catch { links.delete(contactId); } }
    if (frame.t === "typing") return false;                  // a typing hint is never worth a drop-box round-trip
    await DM.mailboxDrop(pub.box, sealer.toWire(env), { mailboxBase }).catch(() => {});
    return true;
  }

  // ---- the ONE receive gate: both carriers (p2p frame, mailbox blob) end here ----
  async function _deliver(env, ts) {
    if (!env || !env.kappa) return null;
    const r = await sealer.open(env); if (!r.ok) return null;
    const contactId = _findBySign(r.from);
    const known = !!contactId;
    const verified = !!r.verified && known;                  // signature valid AND from a contact we know
    const payload = _parse(r.plaintext);

    // R2 — the SEALED HANDSHAKE: a verified contact handed us their Olm prekey bundle (over holo-seal, so it
    // is authenticated + bound to their sign key, TOFU). Record + persist it, then reciprocate ours. Consumed,
    // never shown. From here the next word to/from this contact rides the ratchet.
    if (payload.t === "voz-bundle") {
      if (olm && payload.bundle && r.verified) {               // sig-valid bundle (known OR not-yet-known sender)
        const peer = { bundle: payload.bundle, oid: payload.oid };
        if (contactId) {
          vozBook.set(contactId, peer);
          if (store && store.setMeta) store.setMeta("voz:peer:" + contactId, JSON.stringify(peer)).catch(() => {});
          _ensureVoz(contactId);                               // reciprocate (once) so BOTH sides can ratchet
        } else { _vozPending.set(r.from, peer); }              // arrived before we knew them → bind when the contact forms
      }
      return null;
    }

    // control frames: consumed, never persisted, never emitted as messages. Idempotent by nature (a
    // redelivered ack re-marks the same κ), so they skip the dedup index entirely.
    if (payload.t === "ack") {
      if (!verified) return null;                            // an ack must be from the known, verified recipient
      if (store) store.markDelivered(payload.kappa).catch(() => {});
      emit("tick", { contactId, kappa: payload.kappa, status: "delivered" });
      return null;
    }
    if (payload.t === "typing") { if (verified) emit("typing", { contactId }); return null; }

    // media (N7): the message is a sealed DESCRIPTOR {κ_ct, key, iv, name, mime, size}; the bytes live on
    // the content network as ciphertext and fetch when a holder is up. Persisted like text; the fetch is
    // background and honest — "pending-bytes" until the κ-fetch lands (MD2).
    if (payload.t === "media") {
      if (!payload.kappa || !payload.key || !payload.iv) return null;
      if (_dedup(env.kappa)) return null;
      if (store && await store.hasMsg(env.kappa).catch(() => false)) return null;
      const cid = contactId || (_nameFor(payload, r.from) || "direct:" + (r.from || "").slice(0, 12));
      _upgradeFrom(cid, r.from, payload);
      _drainVoz(cid, r.from);                                  // apply any bundle that beat this contact into being
      const desc = { kappa: payload.kappa, kappas: payload.kappas || [payload.kappa], key: payload.key, iv: payload.iv,
                     name: payload.name || "file", mime: payload.mime || "application/octet-stream", size: payload.size };
      if (store) {
        store.putMsg({ kappa: env.kappa, contactId: cid, ts: ts || env.ts, dir: "in", text: "📎 " + desc.name, media: desc, status: "pending-bytes" }).catch(() => {});
        if (!known && !payload.fromBox) store.putContact(cid, { pub: { sign: r.from, box: null }, addedTs: Date.now() }).catch(() => {});
      }
      const evt = { contactId: cid, from: r.from, verified, known, ts: ts || env.ts, kappa: env.kappa, media: desc, status: "pending-bytes" };
      emit("media", evt);
      const mAckTo = book.get(cid);
      if (mAckTo && mAckTo.box) _sendControl(cid, { t: "ack", kappa: env.kappa });
      _fetchMedia(cid, env.kappa, desc);                     // background — resolves now if a holder is reachable
      return evt;
    }
    if (payload.t !== "msg" || typeof payload.text !== "string") return null;

    // exactly-once, DURABLY: the in-memory LRU is the fast front; the store is the truth across restarts.
    if (_dedup(env.kappa)) return null;
    if (store && await store.hasMsg(env.kappa).catch(() => false)) return null;

    const cid = contactId || (_nameFor(payload, r.from) || "direct:" + (r.from || "").slice(0, 12));
    _upgradeFrom(cid, r.from, payload);                      // one-link two-way: stub → answerable contact
    _drainVoz(cid, r.from);                                  // apply any Olm bundle that raced ahead of this first word
    if (store) {
      store.putMsg({ kappa: env.kappa, contactId: cid, ts: ts || env.ts, dir: "in", text: payload.text }).catch(() => {});
      if (!known && !payload.fromBox) store.putContact(cid, { pub: { sign: r.from, box: null }, addedTs: Date.now() }).catch(() => {});   // stub: listed, unanswerable until they share their link
    }
    const msg = { contactId: cid, from: r.from, text: payload.text, verified, known, ts: ts || env.ts, kappa: env.kappa };
    emit("message", msg);
    // ✓✓ on their side — fire and forget. The upgrade above may have JUST made a first-word stranger
    // answerable (their box key rode the sealed payload) — ack whoever we can now reach, not only
    // contacts we knew before this message.
    const ackTo = book.get(cid);
    if (ackTo && ackTo.box) _sendControl(cid, { t: "ack", kappa: env.kappa });
    return msg;
  }

  // ---- media bytes (N7): fetch/decrypt/persist in the background; pending fetches retry on link-attach ----
  const pendingMedia = new Map();   // msgKappa → {cid, desc} — bytes not yet fetched (holder was offline)
  const mediaInFlight = new Set();  // a κ-fetch already running keeps polling until its window closes —
                                    // a link-attach retry must not stack a second one on the same message
  async function _fetchMedia(cid, msgKappa, desc) {
    if (!spine) { pendingMedia.set(msgKappa, { cid, desc }); return; }
    if (mediaInFlight.has(msgKappa)) return;
    mediaInFlight.add(msgKappa);
    try {
      const held = store ? await store.getMedia(desc.kappa).catch(() => null) : null;
      const bytes = held ? held.bytes : await Media.fetchAndDecrypt(spine, desc);
      if (!held && store) await store.putMedia(desc.kappa, { bytes, name: desc.name, mime: desc.mime }).catch(() => {});
      pendingMedia.delete(msgKappa);
      if (store) store.setMsgStatus(msgKappa, "fetched").catch(() => {});
      emit("media", { contactId: cid, kappa: msgKappa, media: desc, bytes, status: "fetched" });
    } catch {
      const tries = ((pendingMedia.get(msgKappa) || {}).tries || 0) + 1;
      pendingMedia.set(msgKappa, { cid, desc, tries });      // honest: bytes need a holder online — retry on attach
      const l = links.get(cid);                              // …but if the link is UP and the fetch still failed
      if (l && l.open && tries < 3) setTimeout(() => _fetchMedia(cid, msgKappa, desc), 400);   // (holder mid-boot), retry bounded
    } finally { mediaInFlight.delete(msgKappa); }
  }
  // a link just attached: retry this contact's pending fetches, re-arm any that survived a reload (the
  // store remembers "pending-bytes"), and RE-OFFER our own sent ciphertext so the peer's fetch finds a
  // holder even after we reloaded (the vault has the plaintext; key+iv re-derive the same κ).
  async function _fetchPendingFor(contactId) {
    for (const [mk, p] of pendingMedia) if (p.cid === contactId) _fetchMedia(p.cid, mk, p.desc);
    if (!store || !spine) return;
    for (const m of await store.msgs(contactId).catch(() => [])) {
      if (!m.media) continue;
      if (m.dir === "in" && m.status === "pending-bytes" && !pendingMedia.has(m.kappa)) _fetchMedia(contactId, m.kappa, m.media);
      if (m.dir === "out") {
        const held = await store.getMedia(m.media.kappa).catch(() => null);
        if (held) Media.reoffer(spine, held.bytes, m.media);
      }
    }
  }

  // ---- the native fast-path: one link per contact, opened lazily and kept in a registry ----
  const links = new Map();      // contactId → live link (holo-net dial result)
  const dialing = new Set();    // contactIds with a dial in flight (never stack dials)
  function _attach(contactId, link) {
    links.set(contactId, link);
    link.onFrame((bytes) => { const env = wireDecode(bytes); if (env) _deliver(env, null); });
    _fetchPendingFor(contactId).catch(() => {});             // the reunion: pending bytes fetch NOW (MD2)
  }
  // warm(contactId): call when a chat OPENS - the cold rendezvous happens while the human is still reading, so the
  // first keystroke finds a live link. Failure is silent by design: the mailbox path is always there.
  async function warm(contactId) {
    if (!spine) return false;
    const pub = book.get(contactId); if (!pub) return false;
    const cur = links.get(contactId); if (cur && cur.open) return true;
    if (dialing.has(contactId)) return false;
    if (trust.check(contactId, pub).status === "changed") return false;   // key change never auto-dials
    dialing.add(contactId);
    try { _attach(contactId, await RDV.rendezvousDial(pub, { identity: id, myPub, mailboxBase, spine, stun, ice, trust })); return true; }
    catch { return false; }
    finally { dialing.delete(contactId); }
  }
  // answer incoming dials from KNOWN contacts whose key hasn't changed - same policy as addContact, no new trust logic
  let stopListen = null;
  if (spine) {
    stopListen = RDV.onRendezvous({ identity: id, myPub, mailboxBase, spine, stun, ice, trust },
      (peerPub) => { const cid = _findBySign(peerPub.sign); return !!cid && trust.check(cid, { sign: peerPub.sign, box: peerPub.box }).status !== "changed"; },
      (link, peerPub) => { const cid = _findBySign(peerPub.sign); if (cid) _attach(cid, link); });
  }

  // ---- send: seal once, then the fastest honest carrier ----
  async function send(contactId, text) {
    const pub = book.get(contactId); if (!pub) return { ok: false, error: "unknown contact" };
    if (!pub.box) return { ok: false, error: "no box key — they must share their link first" };   // inbound-only stub
    if (trust.check(contactId, pub).status === "changed") { emit("keychange", { contactId, pub }); return { ok: false, error: "key-changed", keychange: true }; }
    const env = await sealer.seal(contactId, _wrap(text), pub);
    // persist BEFORE transport (✓ = it exists durably and was handed to a carrier; ✓✓ = the ack came back)
    if (store) await store.putMsg({ kappa: env.kappa, contactId, ts: env.ts, dir: "out", text, status: "sent" }).catch(() => {});
    const link = links.get(contactId);
    if (link && link.open) {
      try { link.send(wireEncode(env)); return { ok: true, kappa: env.kappa, ts: env.ts, contactId, path: "p2p" }; }
      catch { links.delete(contactId); }                     // dead link - fall through to the mailbox, re-warm below
    }
    await DM.mailboxDrop(pub.box, sealer.toWire(env), { mailboxBase });   // offline-safe, exactly as always
    if (spine) warm(contactId);                              // background - the NEXT word takes the fast path
    return { ok: true, kappa: env.kappa, ts: env.ts, contactId, path: "mailbox" };
  }

  // ---- sendMedia (N7): encrypt fresh → put ciphertext on the content network → the sealed message
  // carries only the descriptor. Same dual path, same trust gates, same ✓/✓✓ as text. 25 MB cap, plainly.
  async function sendMedia(contactId, file) {
    const pub = book.get(contactId); if (!pub) return { ok: false, error: "unknown contact" };
    if (!pub.box) return { ok: false, error: "no box key — they must share their link first" };
    if (!spine) return { ok: false, error: "media needs the native spine" };
    if (trust.check(contactId, pub).status === "changed") { emit("keychange", { contactId, pub }); return { ok: false, error: "key-changed", keychange: true }; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > Media.MAX_MEDIA_BYTES) return { ok: false, error: Media.TOO_BIG };
    const desc = { ...(await Media.encryptAndPut(spine, bytes)), name: file.name || "file", mime: file.type || "application/octet-stream" };
    const env = await sealer.seal(contactId, JSON.stringify({ t: "media", ...desc, ..._intro() }), pub);
    if (store) {
      await store.putMsg({ kappa: env.kappa, contactId, ts: env.ts, dir: "out", text: "📎 " + desc.name, media: desc, status: "sent" }).catch(() => {});
      await store.putMedia(desc.kappa, { bytes, name: desc.name, mime: desc.mime }).catch(() => {});   // we stay a holder across reloads
    }
    const link = links.get(contactId);
    if (link && link.open) {
      try { link.send(wireEncode(env)); return { ok: true, kappa: env.kappa, mediaKappa: desc.kappa, ts: env.ts, contactId, path: "p2p" }; }
      catch { links.delete(contactId); }
    }
    await DM.mailboxDrop(pub.box, sealer.toWire(env), { mailboxBase });   // the MESSAGE is offline-safe; the bytes wait for a link
    if (spine) warm(contactId);
    return { ok: true, kappa: env.kappa, mediaKappa: desc.kappa, ts: env.ts, contactId, path: "mailbox" };
  }

  // a live typing hint — link-only (never the mailbox), throttled so a fast typist costs ~1 frame / 3 s
  const _typedAt = new Map();
  function sendTyping(contactId) {
    const t = _typedAt.get(contactId) || 0;
    if (Date.now() - t < 3000) return;
    _typedAt.set(contactId, Date.now());
    _sendControl(contactId, { t: "typing" });
  }

  // pull everything waiting in the mailbox, through the SAME gate as the p2p frames (open → verify → dedup → emit)
  async function poll() {
    const items = await DM.mailboxPull(myPub.box, { mailboxBase });
    const out = [], acked = [];
    for (const it of items) {
      acked.push(it.id);                                     // ack even the refused - a corrupt blob must not loop forever
      const env = sealer.fromWire(it.blob); if (!env) continue;
      const msg = await _deliver(env, it.ts);
      if (msg) out.push(msg);
    }
    if (acked.length) await DM.mailboxAck(myPub.box, acked, { mailboxBase });
    return out;
  }

  return {
    myPub,
    addContact,
    contacts: () => [...book.keys()],
    send, poll, warm, sendTyping, sendMedia,
    mediaBytes: (kappaCt) => (store ? store.getMedia(kappaCt) : Promise.resolve(null)),   // → {bytes,name,mime}|null
    history: (contactId, opts) => (store ? store.msgs(contactId, opts) : Promise.resolve([])),
    conversations: async () => {   // the list the sheet renders: contacts + last word, newest first
      if (!store) return [];
      const cs = await store.contacts().catch(() => []);
      const out = [];
      for (const c of cs) out.push({ ...c, last: await store.lastMsg(c.contactId).catch(() => null) });
      return out.sort((a, b) => ((b.last && b.last.ts) || b.addedTs || 0) - ((a.last && a.last.ts) || a.addedTs || 0));
    },
    linkState: (contactId) => { const l = links.get(contactId); return l && l.open ? "p2p" : (dialing.has(contactId) ? "dialing" : "mailbox"); },
    vozReady: async (contactId) => !!olm && !!vozBook.get(contactId) && await olm.hasSession(contactId),   // is this thread on the ratchet?
    sealStats: () => ({ ..._stats, olm: !!olm }),                                                          // honest counters (witness + truthful lock)
    safetyNumber: (contactId) => { const p = book.get(contactId); return p ? Verify.safetyNumber(myPub, p) : Promise.resolve(null); },
    safetyEmojis: Verify.safetyEmojis, safetyDigits: Verify.safetyDigits,
    verifyStatus: (contactId) => { const p = book.get(contactId); return p ? trust.check(contactId, p) : { status: "unknown" }; },
    markVerified: (contactId) => trust.markVerified(contactId),
    on: (ev, cb) => { (listeners[ev] || (listeners[ev] = [])).push(cb); },
    close: () => { if (stopListen) stopListen(); for (const l of links.values()) { try { l.close(); } catch {} } links.clear(); },
  };
}
