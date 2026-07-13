// holo-seal2.mjs — the SEAL waist over vodozemac (M3.1). Owns the operator's Olm account + per-peer sessions,
// publishes/consumes prekey bundles, and seals/opens 1:1 messages as {t,c}. ZERO hand-written crypto — it
// only drives vodozemac (via the injected `voz` glue = the wasm from _vendor/vodozemac). It REPLACES
// holo-seal.mjs for the new (seal:"olm") path; the legacy ECIES path keeps working alongside.
//
// HARD-1 — the Olm Double Ratchet advances on EVERY encrypt AND decrypt, so the session pickle is
// re-persisted after every op (mutate-then-persist as ONE unit) or the two ends desync and can't decrypt.
// HARD-2 — OTK dispensing on a serverless mesh has NO atomic prekey server. publishBundle offers many
// one-time keys; an initiator picks one by hash(myIdentity)%n to spread simultaneous initiators; Olm
// tolerates the rare reuse (a small forward-secrecy cost on the FIRST message only). No distributed lock —
// that trade-off is the honest cost of being serverless. Recipients republish a fresh bundle when low.
//
//   makeSeal2({ voz, getState, putState, pickleKey })
//     voz            = the loaded vodozemac glue { HoloAccount, HoloSession } (browser: load like the spine; node: init with bytes)
//     getState(k)    → Promise<string|null>   (an encrypted pickle string, keyed e.g. "voz:account" / "voz:session:<cid>")
//     putState(k, v) → Promise                (persist it — the holospace vault store in prod)
//     pickleKey      = a base64 32-byte key derived from the operator vault (vodozemac encrypts the pickle with it)

export function makeSeal2({ voz, getState, putState, pickleKey } = {}) {
  if (!voz || !voz.HoloAccount) throw new Error("holo-seal2 needs the vodozemac glue (voz)");
  if (!pickleKey) throw new Error("holo-seal2 needs a base64 32-byte pickleKey");
  let account = null;
  const sessions = new Map();   // cid → HoloSession (in-memory front; the store is the durable truth)

  const _saveAccount = () => putState("voz:account", account.pickle(pickleKey));
  const _saveSession = (cid) => { const s = sessions.get(cid); return s ? putState("voz:session:" + cid, s.pickle(pickleKey)) : Promise.resolve(); };

  async function init() {
    if (account) return;
    const p = await getState("voz:account");
    if (p) { try { account = voz.HoloAccount.fromPickle(p, pickleKey); return; } catch {} }
    account = new voz.HoloAccount();
    await _saveAccount();
  }

  async function _session(cid) {
    if (sessions.has(cid)) return sessions.get(cid);
    const p = await getState("voz:session:" + cid);
    if (p) { try { const s = voz.HoloSession.fromPickle(p, pickleKey); sessions.set(cid, s); return s; } catch {} }
    return null;
  }

  const identityKey = () => account.curve25519Key();

  // publish a prekey bundle (identity + n one-time keys). Caller puts it on the mesh as a κ-blob (HARD-2).
  async function publishBundle(n = 20) {
    const otks = JSON.parse(account.generateOneTimeKeys(n));
    account.markPublished();
    await _saveAccount();
    return { v: 1, identityKey: account.curve25519Key(), otks };
  }

  // establish an OUTBOUND session to a peer from their bundle. Deterministic OTK pick spreads collisions.
  async function startOutbound(cid, bundle) {
    const idx = _pick(account.curve25519Key(), bundle.otks.length);
    sessions.set(cid, account.createOutbound(bundle.identityKey, bundle.otks[idx]));
    await _saveSession(cid);
    return true;
  }

  // seal to an ESTABLISHED session (encrypt → persist the advanced ratchet, HARD-1). → {t,c}
  async function sealTo(cid, text) {
    const s = await _session(cid); if (!s) throw new Error("holo-seal2: no session for " + cid);
    const msg = JSON.parse(s.encrypt(text));
    await _saveSession(cid);
    return msg;
  }

  // open the FIRST (pre-key, t=0) message from a peer → establishes the inbound session + yields plaintext.
  // The OTK is consumed on the account, so persist BOTH account and session.
  async function openFirst(cid, peerIdentityKey, msg) {
    const inb = account.createInbound(peerIdentityKey, msg.t, msg.c);
    sessions.set(cid, inb.session());
    await _saveAccount(); await _saveSession(cid);
    return inb.plaintext;
  }

  // open on an existing session (decrypt → persist).
  async function open(cid, msg) {
    const s = await _session(cid); if (!s) throw new Error("holo-seal2: no session for " + cid);
    const pt = s.decrypt(msg.t, msg.c);
    await _saveSession(cid);
    return pt;
  }

  // one unified receive gate the engine can call: establish-or-decrypt by session presence + message type.
  async function receive(cid, peerIdentityKey, msg) {
    if (await _session(cid)) return open(cid, msg);
    if (msg.t === 0) return openFirst(cid, peerIdentityKey, msg);
    throw new Error("holo-seal2: no session and not a pre-key message");
  }

  const hasSession = async (cid) => !!(await _session(cid));

  // ── MEGOLM (rooms, M4) — one OUTBOUND group session per room (mine); one INBOUND per (room, sender).
  // Same waist discipline: every op re-pickles the advanced ratchet (HARD-1 holds for Megolm too). The
  // session KEY that `groupKey` returns is the thing the engine distributes to members over the PAIRWISE
  // Olm channels — never a server. ZERO hand-written crypto — vodozemac's audited Megolm only.
  const groupOut = new Map();   // room → HoloGroupSession (mine)
  const groupIn = new Map();    // room|senderId → HoloGroupInbound
  const _gOutKey = (room) => "voz:group:out:" + room;
  const _gInKey = (room, sid) => "voz:group:in:" + room + "|" + sid;
  const _saveGOut = (room) => { const g = groupOut.get(room); return g ? putState(_gOutKey(room), g.pickle(pickleKey)) : Promise.resolve(); };
  const _saveGIn = (room, sid) => { const g = groupIn.get(room + "|" + sid); return g ? putState(_gInKey(room, sid), g.pickle(pickleKey)) : Promise.resolve(); };

  async function _gOut(room) {
    if (groupOut.has(room)) return groupOut.get(room);
    const p = await getState(_gOutKey(room));
    if (p) { try { const g = voz.HoloGroupSession.fromPickle(p, pickleKey); groupOut.set(room, g); return g; } catch {} }
    return null;
  }
  async function _gIn(room, sid) {
    const k = room + "|" + sid;
    if (groupIn.has(k)) return groupIn.get(k);
    const p = await getState(_gInKey(room, sid));
    if (p) { try { const g = voz.HoloGroupInbound.fromPickle(p, pickleKey); groupIn.set(k, g); return g; } catch {} }
    return null;
  }

  // mint (or rotate) MY outbound session for a room → returns { id, key } to hand to members. Rotate = the
  // PCS/kick primitive: a fresh session whose key the removed member never receives.
  async function groupCreate(room) {
    const g = new voz.HoloGroupSession();
    groupOut.set(room, g);
    await _saveGOut(room);
    return { id: g.sessionId(), key: g.sessionKey() };
  }
  async function groupKey(room) {
    const g = (await _gOut(room)) || null;
    return g ? { id: g.sessionId(), key: g.sessionKey(), index: g.messageIndex() } : null;
  }
  async function groupSeal(room, text) {
    const g = await _gOut(room); if (!g) throw new Error("holo-seal2: no outbound group session for " + room);
    const c = g.encrypt(text);
    await _saveGOut(room);
    return { id: g.sessionId(), c };
  }
  // accept a sender's session key → build/replace their inbound view. Idempotent-ish: a NEWER key (rotation)
  // replaces the old one; the firstKnownIndex on the fresh key seals everything before it.
  async function groupAddInbound(room, sid, sessionKey) {
    try {
      const g = new voz.HoloGroupInbound(sessionKey);
      groupIn.set(room + "|" + sid, g);
      await _saveGIn(room, sid);
      return { id: g.sessionId(), firstKnownIndex: g.firstKnownIndex() };
    } catch { return null; }
  }
  async function groupOpen(room, sid, ct) {
    const g = await _gIn(room, sid); if (!g) throw new Error("holo-seal2: no inbound group session for " + room + "|" + sid);
    const d = JSON.parse(g.decrypt(ct));       // {i, p}
    await _saveGIn(room, sid);
    return d;
  }
  const hasGroupInbound = async (room, sid) => !!(await _gIn(room, sid));
  // rotate MY outbound (kick/PCS) and drop every inbound for this room I currently hold whose sender is not
  // in `keep` — after a kick, the removed sender's stream must go silent to me too. Returns the fresh key.
  async function groupRotate(room, keep = null) {
    if (keep) { for (const k of [...groupIn.keys()]) { const [r, sid] = k.split("|"); if (r === room && !keep.includes(sid)) { groupIn.delete(k); putState(_gInKey(room, sid), "").catch(() => {}); } } }
    return groupCreate(room);
  }

  return { init, identityKey, publishBundle, startOutbound, sealTo, openFirst, open, receive, hasSession,
           groupCreate, groupKey, groupSeal, groupAddInbound, groupOpen, hasGroupInbound, groupRotate };
}

// a cheap deterministic string hash (FNV-1a) → OTK index; spreads simultaneous initiators across the bundle.
function _pick(s, n) {
  if (n <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n;
}
