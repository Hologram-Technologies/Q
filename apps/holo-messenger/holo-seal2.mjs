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

  return { init, identityKey, publishBundle, startOutbound, sealTo, openFirst, open, receive, hasSession };
}

// a cheap deterministic string hash (FNV-1a) → OTK index; spreads simultaneous initiators across the bundle.
function _pick(s, n) {
  if (n <= 1) return 0;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n;
}
