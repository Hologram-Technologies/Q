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
  const _stats = { olmSealed: 0, seal1Sealed: 0, olmOpened: 0, megolmSealed: 0, megolmOpened: 0 };   // honest instrumentation (witness + a truthful lock)
  // ── ROOMS (M4) — a room is a κ-object: { id, name, creator, members }. Megolm seals room words (per-sender
  //    forward secrecy); each member's group session KEY rides the EXISTING pairwise Olm channels (room-key
  //    frames), never a server. Membership change ROTATES every member's session (PCS) so a removed member's
  //    old inbound views go dead — kick is cryptography, not a flag. All room frames are sealed+signed pairwise.
  const rooms = new Map();   // roomId → { id, name, creator, members: Map<sign, {sign, box, name, admin}>, strand: [] }
  const _roomWord = new Set(); const _roomWordQ = [];   // room-msg dedup (mid)
  const _roomDedup = (mid) => { if (_roomWord.has(mid)) return true; _roomWord.add(mid); _roomWordQ.push(mid); if (_roomWordQ.length > 1024) _roomWord.delete(_roomWordQ.shift()); return false; };
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
  const listeners = { message: [], keychange: [], tick: [], typing: [], media: [], room: [], roomevent: [] };
  const emit = (ev, x) => (listeners[ev] || []).forEach((f) => { try { f(x); } catch {} });

  // the durable store (holo-direct-store, optional): contacts + messages survive reload, sealed at rest.
  // Hydrate the address book NOW — identity persistence without contact persistence is a door with no
  // address book. Without a store the engine degrades to exactly the old in-memory behavior.
  if (store) { try { for (const c of await store.contacts()) book.set(c.contactId, c.pub); } catch {} }
  // R2/R4 — rehydrate each contact's Olm prekey bundle so a RETURNING user keeps ratcheting with no fresh
  // handshake (the seal2 account + sessions rehydrate from the vault inside `olm`; this restores the peer half).
  if (olm && store && store.getMeta) { for (const cid of [...book.keys()]) { try { const v = await store.getMeta("voz:peer:" + cid); if (v) vozBook.set(cid, JSON.parse(v)); } catch {} } }
  // R4/T4 — rehydrate ROOMS a returning member belongs to (roster + strand). The Megolm sessions themselves
  // reload LAZILY from the vault inside `olm` (voz:group:out|in pickles) on first send/open — no re-handshake.
  if (olm && store && store.getMeta) { try {
    const idx = JSON.parse((await store.getMeta("rooms:index")) || "[]");
    for (const rid of idx) { try { const snap = JSON.parse(await store.getMeta("room:" + rid)); if (snap && snap.id) {
      const mm = new Map(); for (const m of (snap.members || [])) mm.set(m.sign, m);
      rooms.set(snap.id, { id: snap.id, name: snap.name, creator: snap.creator, members: mm, strand: snap.strand || [] });
    } } catch {} }
  } catch {} }

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

    // ── KEY frames (Holo Keys): a live power, redeemed over this same sealed door. The engine only CARRIES —
    // authority is issuer-local (holo-keys checks MY keyring; unknown/revoked/expired refuse at the door). A
    // key-invoke may arrive from a first-contact holder (the grant introduced us, like a Direct link): the
    // frame's _intro() box key upgrades them to answerable, so the key-result can travel back. Never persisted.
    if (payload.t === "key-invoke" || payload.t === "key-result") {
      const cid = contactId || (_nameFor(payload, r.from) || "direct:" + (r.from || "").slice(0, 12));
      _upgradeFrom(cid, r.from, payload);
      try {
        const Keys = await import("./holo-key.mjs?v=k1");
        await Keys.handleFrame(payload, { from: r.from, cid, reply: (f) => _sendControl(cid, f) });
        emit("key", { contactId: cid, from: r.from, frame: payload.t, grantId: payload.grantId || null });
      } catch (e) { console.warn("[direct] key frame failed:", String(e)); }
      return null;
    }

    // ── ROOM frames (M4): all authenticated (sealed+signed pairwise). r.from is the actor's sign key.
    if (payload.t && payload.t.startsWith("room-")) { await _deliverRoom(payload, r, contactId); return null; }

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

  // ── ROOM ENGINE (M4) ────────────────────────────────────────────────────────────────────────────────
  // Bind a room member as an answerable contact (their sign+box), keyed by their sign so fan-out can reach
  // them. Never overwrites an existing full contact's keys (anti-MITM, same policy as _upgradeFrom).
  function _bindMember(m) {
    if (!m || !m.sign) return null;
    let cid = _findBySign(m.sign);
    if (!cid) { cid = "direct:" + m.sign.slice(0, 12); if (m.box) addContact(cid, { sign: m.sign, box: m.box }); }
    else if (m.box && !(book.get(cid) || {}).box) addContact(cid, { sign: m.sign, box: m.box });
    return cid;
  }
  const _roomMembersArr = (room) => [...room.members.values()];
  const _me = () => ({ sign: myPub.sign, box: myPub.box, name: displayName || null });
  // hand MY current group key for a room to one member (over the pairwise sealed channel).
  async function _sendRoomKey(room, memberSign) {
    if (!olm) return;
    const gk = await olm.groupKey(room.id); if (!gk) return;
    const cid = _findBySign(memberSign); if (!cid) return;
    await _sendControl(cid, { t: "room-key", room: room.id, key: gk.key, sid: gk.id, from: myPub.sign });
  }
  async function _broadcastRoomKey(room, exclude = []) {
    for (const m of _roomMembersArr(room)) if (m.sign !== myPub.sign && !exclude.includes(m.sign)) await _sendRoomKey(room, m.sign);
  }
  // over a LOSSY relay a single key frame can drop, silently missing a sender's whole stream. Re-broadcast a
  // couple of times after a membership change so keys converge without waiting for a can't-decrypt trigger.
  function _broadcastRoomKeySoon(room, exclude = []) {
    for (const ms of [2500, 6000]) setTimeout(() => { const r = rooms.get(room.id); if (r) _broadcastRoomKey(r, exclude).catch(() => {}); }, ms);
  }

  // CREATE a room: I am the admin; mint my Megolm outbound now. Returns the room + its invite link.
  async function createRoom(name) {
    if (!olm) return { ok: false, error: "rooms need the ratchet (olm)" };
    const nonce = (typeof crypto !== "undefined" && crypto.getRandomValues) ? [...crypto.getRandomValues(new Uint8Array(9))].map((b) => b.toString(16).padStart(2, "0")).join("") : String(Date.now());
    const id = "room:" + (await _sha256hex(myPub.sign + "|" + name + "|" + nonce)).slice(0, 24);
    const room = { id, name: String(name || "Room").slice(0, 64), creator: myPub.sign, members: new Map(), strand: [] };
    room.members.set(myPub.sign, { ..._me(), admin: true });
    room.strand.push({ op: "create", by: myPub.sign, ts: Date.now(), name: room.name });
    rooms.set(id, room);
    await olm.groupCreate(id);
    _persistRoom(room);
    return { ok: true, room: _roomView(room), link: roomLink(id) };
  }
  const _roomSnapshot = (room) => ({ id: room.id, name: room.name, creator: room.creator, members: _roomMembersArr(room), strand: room.strand });
  // persist a room snapshot AND keep the rooms:index (the store has no key enumeration) so a returning member
  // rehydrates every room on boot. Fire-and-forget; the Megolm pickles persist separately inside `olm`.
  async function _persistRoom(room) {
    if (!store || !store.setMeta) return;
    try {
      await store.setMeta("room:" + room.id, JSON.stringify(_roomSnapshot(room)));
      const idx = JSON.parse((await store.getMeta("rooms:index")) || "[]");
      if (!idx.includes(room.id)) { idx.push(room.id); await store.setMeta("rooms:index", JSON.stringify(idx)); }
    } catch {}
  }
  const _roomView = (room) => ({ id: room.id, name: room.name, creator: room.creator, admin: (room.members.get(myPub.sign) || {}).admin === true, members: _roomMembersArr(room).map((m) => ({ sign: m.sign, name: m.name, admin: m.admin, me: m.sign === myPub.sign })) });

  // the invite link: keys ride the FRAGMENT (never a request line). Carries the creator's box so a fresh
  // joiner can seal the pairwise join frame to them (TOFU, bound to the creator sign).
  function roomLink(id) {
    const room = rooms.get(id); if (!room) return null;
    const payload = { v: 1, room: id, name: room.name, creator: room.creator, creatorBox: (room.members.get(room.creator) || {}).box || myPub.box };
    const b64 = (typeof btoa !== "undefined")
      ? btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
      : Buffer.from(JSON.stringify(payload)).toString("base64url");
    // point at the /join/ card page (fragment-preserving forward) so a shared room link renders the invite
    // card on social platforms; the #fragment (keys) still travels only to the human's browser. Derive the
    // messenger dir from this page's path (…/apps/holo-messenger/app.html → …/apps/holo-messenger/join/).
    if (typeof location === "undefined") return "#room=v1." + b64;
    const dir = location.pathname.replace(/[^/]*$/, "");        // strip the filename → the app dir (trailing /)
    return location.origin + dir + "join/#room=v1." + b64;
  }

  // JOIN from an invite payload {room,name,creator,creatorBox}: bind the creator as a contact, send them a
  // signed join intent over the pairwise channel. The creator (admin) admits us → room-welcome carries the
  // roster + keys. Fully serverless.
  async function joinRoom(payload) {
    if (!olm) return { ok: false, error: "rooms need the ratchet (olm)" };
    if (!payload || !payload.room || !payload.creator) return { ok: false, error: "bad room invite" };
    const cid = _bindMember({ sign: payload.creator, box: payload.creatorBox, name: null });
    // provisional local room shell (upgraded on welcome)
    if (!rooms.get(payload.room)) rooms.set(payload.room, { id: payload.room, name: payload.name || "Room", creator: payload.creator, members: new Map([[payload.creator, { sign: payload.creator, box: payload.creatorBox, name: null, admin: true }]]), strand: [] });
    await _ensureVoz(cid);   // make sure we can ratchet with the admin
    await _sendControl(cid, { t: "room-join", room: payload.room, member: _me() });
    return { ok: true, room: payload.room, pending: true };
  }

  // SEND a room word: Megolm-seal once, fan the SAME ciphertext to every member over their pairwise channel.
  async function roomSend(roomId, text) {
    const room = rooms.get(roomId); if (!room) return { ok: false, error: "unknown room" };
    if (!olm) return { ok: false, error: "no ratchet" };
    let sealed; try { sealed = await olm.groupSeal(roomId, JSON.stringify({ text, name: displayName || null })); } catch { return { ok: false, error: "no group session — (re)join first" }; }
    const mid = (await _sha256hex(roomId + "|" + myPub.sign + "|" + sealed.c + "|" + Date.now())).slice(0, 24);
    const ts = Date.now();
    _stats.megolmSealed++;
    // echo locally so the sender sees their own word (Megolm can't self-decrypt an outbound session)
    const mine = { room: roomId, from: myPub.sign, name: displayName || null, text, ts, mid, me: true };
    if (store) store.putMsg({ kappa: mid, contactId: roomId, ts, dir: "out", text, room: roomId, status: "sent" }).catch(() => {});
    emit("room", mine);
    for (const m of _roomMembersArr(room)) {
      if (m.sign === myPub.sign) continue;
      const cid = _findBySign(m.sign); if (!cid) continue;
      _sendControl(cid, { t: "room-msg", room: roomId, c: sealed.c, sid: sealed.id, mid, ts, from: myPub.sign });
    }
    return { ok: true, mid, ts };
  }

  // KICK (admin): remove the member, ROTATE my outbound (PCS) and re-key only the REMAINING members. Tell the
  // remaining members to remove + rotate too, so EVERY surviving member's stream is fresh — the kicked key
  // receives nothing after the cut and its old inbound views can't read the new session ids.
  async function roomKick(roomId, memberSign) {
    const room = rooms.get(roomId); if (!room) return { ok: false, error: "unknown room" };
    if ((room.members.get(myPub.sign) || {}).admin !== true) return { ok: false, error: "admin only" };
    if (memberSign === myPub.sign) return { ok: false, error: "cannot kick yourself" };
    room.members.delete(memberSign);
    room.strand.push({ op: "remove", by: myPub.sign, member: memberSign, ts: Date.now() });
    const keep = _roomMembersArr(room).map((m) => m.sign);
    await olm.groupRotate(roomId, keep);                         // fresh outbound; drop kicked sender's inbound
    _persistRoom(room);
    for (const m of _roomMembersArr(room)) {
      if (m.sign === myPub.sign) continue;
      const cid = _findBySign(m.sign); if (!cid) continue;
      await _sendControl(cid, { t: "room-remove", room: roomId, member: memberSign, from: myPub.sign });
      await _sendRoomKey(room, m.sign);                          // my fresh key → remaining only
    }
    emit("roomevent", { room: roomId, kind: "remove", member: memberSign });
    return { ok: true };
  }

  // the ONE room-frame gate. r.from = the authenticated actor sign key.
  async function _deliverRoom(payload, r, contactId) {
    if (!olm || !r.verified) return;
    const roomId = payload.room; if (!roomId) return;
    let room = rooms.get(roomId);

    if (payload.t === "room-join") {                            // admin path: someone opened my link
      if (!room || (room.members.get(myPub.sign) || {}).admin !== true) return;   // only the admin admits
      const nm = payload.member || {}; if (nm.sign !== r.from) return;            // the join must be self-signed
      const cid = _bindMember(nm);
      const existing = _roomMembersArr(room).filter((m) => m.sign !== myPub.sign);
      if (!room.members.has(nm.sign)) { room.members.set(nm.sign, { sign: nm.sign, box: nm.box, name: nm.name || null, admin: false }); room.strand.push({ op: "add", by: myPub.sign, member: nm.sign, ts: Date.now() }); }
      _persistRoom(room);
      // welcome the newcomer: full roster + my group key; then tell every existing member to add them.
      const gk = await olm.groupKey(roomId);
      await _sendControl(cid, { t: "room-welcome", room: roomId, name: room.name, creator: room.creator, roster: _roomMembersArr(room), key: gk && gk.key, sid: gk && gk.id, from: myPub.sign });
      for (const ms of [2500, 6000]) setTimeout(() => { const r = rooms.get(roomId); if (r && r.members.has(nm.sign)) _sendRoomKey(r, nm.sign).catch(() => {}); }, ms);   // re-hand my key (lossy relay)
      for (const m of existing) { const mcid = _findBySign(m.sign); if (mcid) await _sendControl(mcid, { t: "room-add", room: roomId, member: { sign: nm.sign, box: nm.box, name: nm.name || null }, from: myPub.sign }); }
      emit("roomevent", { room: roomId, kind: "add", member: nm.sign });
      return;
    }

    if (payload.t === "room-welcome") {                         // joiner path: I've been admitted
      if (r.from !== payload.creator) return;                   // welcome must come from the room creator (TOFU)
      room = room || { id: roomId, name: payload.name || "Room", creator: payload.creator, members: new Map(), strand: [] };
      room.name = payload.name || room.name; room.creator = payload.creator;
      for (const m of (payload.roster || [])) { room.members.set(m.sign, { sign: m.sign, box: m.box, name: m.name || null, admin: m.sign === payload.creator }); _bindMember(m); }
      room.members.set(myPub.sign, { ..._me(), admin: myPub.sign === payload.creator });
      rooms.set(roomId, room);
      if (payload.key) { await olm.groupAddInbound(roomId, payload.creator, payload.key); }   // read the admin
      await olm.groupCreate(roomId);                            // MY outbound for this room
      _persistRoom(room);
      await _broadcastRoomKey(room);                            // hand my key to everyone (admin + peers)
      _broadcastRoomKeySoon(room);                              // …and again, so a dropped key frame converges
      emit("roomevent", { room: roomId, kind: "joined", view: _roomView(room) });
      return;
    }

    if (payload.t === "room-add") {                            // an existing member learns of a newcomer
      if (!room) return;
      const nm = payload.member || {}; if (!nm.sign) return;
      if (!room.members.has(nm.sign)) { room.members.set(nm.sign, { sign: nm.sign, box: nm.box, name: nm.name || null, admin: false }); room.strand.push({ op: "add", by: r.from, member: nm.sign, ts: Date.now() }); }
      _bindMember(nm);
      _persistRoom(room);
      await _sendRoomKey(room, nm.sign);                        // hand the newcomer MY key so they can read me
      for (const ms of [2500, 6000]) setTimeout(() => { const r = rooms.get(roomId); if (r && r.members.has(nm.sign)) _sendRoomKey(r, nm.sign).catch(() => {}); }, ms);
      emit("roomevent", { room: roomId, kind: "add", member: nm.sign });
      return;
    }

    if (payload.t === "room-key") {                            // a member handed me their Megolm session key
      if (!room) return;
      await olm.groupAddInbound(roomId, r.from, payload.key);
      return;
    }

    if (payload.t === "room-key-req") {                        // a member couldn't open my stream → re-hand my key
      if (!room || !room.members.has(r.from)) return;
      await _sendRoomKey(room, r.from);
      return;
    }

    if (payload.t === "room-remove") {                         // admin removed someone → I rotate too (PCS)
      if (!room || r.from !== room.creator) return;            // only the creator/admin removes
      const gone = payload.member; if (!gone) return;
      room.members.delete(gone);
      room.strand.push({ op: "remove", by: r.from, member: gone, ts: Date.now() });
      const keep = _roomMembersArr(room).map((m) => m.sign);
      await olm.groupRotate(roomId, keep);                     // fresh outbound + drop the kicked sender's inbound
      _persistRoom(room);
      await _broadcastRoomKey(room, [gone]);                   // my fresh key → remaining only
      emit("roomevent", { room: roomId, kind: "remove", member: gone });
      return;
    }

    if (payload.t === "room-msg") {                            // a Megolm room word
      if (!room || !room.members.has(r.from)) return;          // sender must be a current member
      // SELF-HEAL over a lossy relay: if I hold no inbound for this sender (their room-key frame was dropped),
      // ask for it — once per sender per gap — rather than silently missing their whole stream. The word that
      // triggered this is replayed by the sender's next send (Megolm indices let a late inbound catch up).
      if (!(await olm.hasGroupInbound(roomId, r.from))) { const cid = _findBySign(r.from); if (cid) _sendControl(cid, { t: "room-key-req", room: roomId, from: myPub.sign }); return; }
      if (_roomDedup(payload.mid)) return;
      let d; try { d = await olm.groupOpen(roomId, r.from, payload.c); } catch { const cid = _findBySign(r.from); if (cid) _sendControl(cid, { t: "room-key-req", room: roomId, from: myPub.sign }); return; }   // rotated/gap → re-request
      let text = d.p, name = null; try { const pj = JSON.parse(d.p); if (pj && typeof pj.text === "string") { text = pj.text; name = pj.name || null; } } catch {}
      _stats.megolmOpened++;
      const sender = room.members.get(r.from) || {};
      if (name && !sender.name) { sender.name = name; room.members.set(r.from, sender); }
      if (store) store.putMsg({ kappa: payload.mid, contactId: roomId, ts: payload.ts || Date.now(), dir: "in", text, room: roomId }).catch(() => {});
      emit("room", { room: roomId, from: r.from, name: sender.name || name, text, ts: payload.ts || Date.now(), mid: payload.mid, index: d.i });
      return;
    }
  }

  return {
    myPub,
    addContact,
    // rooms (M4)
    createRoom, joinRoom, roomSend, roomKick, roomLink,
    rooms: () => [...rooms.values()].map(_roomView),
    roomView: (id) => { const r = rooms.get(id); return r ? _roomView(r) : null; },
    roomMembers: (id) => { const r = rooms.get(id); return r ? _roomMembersArr(r).map((m) => ({ sign: m.sign, name: m.name, admin: m.admin })) : []; },
    contacts: () => [...book.keys()],
    send, poll, warm, sendTyping, sendMedia,
    // Holo Keys carrier: one sealed control frame to a contact (dual-path like every control frame). The
    // _intro() box key rides inside so a first-contact issuer can answer — the N8 two-way door, reused.
    keySend: (cid, frame) => _sendControl(cid, { ...frame, ..._intro() }),
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
