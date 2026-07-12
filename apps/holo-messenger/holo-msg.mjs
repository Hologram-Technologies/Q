// holo-msg.mjs — the APP waist (M3.2): composes seal2 (Olm secrecy) + log (κ-DAG ordering/sync/integrity)
// into the messenger's engine surface. Peers are addressed by their Olm identity key (the cid). A 1:1
// conversation id `conv` = blake3 of the sorted identity-key pair, so both ends derive the SAME conv (L2).
//
// HARD-3 — the κ-DAG log stores the SEALED record ({t,c} ciphertext) for transport/sync/integrity; but Olm
// decrypt ADVANCES the ratchet and can run only ONCE per message, so the decrypted plaintext is kept in a
// SEPARATE store (the vault history) for display. `history()` reads plaintext; it never re-decrypts the log.
// Decrypt happens once per record (tracked by κ), in the log's causal order.

import { makeSeal2 } from "./holo-seal2.mjs";
import { makeLog } from "./holo-log.mjs";

const _enc = new TextEncoder(), _dec = new TextDecoder();
const _b64 = (u8) => btoa(String.fromCharCode(...u8));
const _ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const _packPayload = (msg) => _b64(_enc.encode(JSON.stringify({ t: msg.t, c: msg.c })));
const _unpackPayload = (p) => JSON.parse(_dec.decode(_ub64(p)));

// mesh = { kappa, put, get, verify } (spine in prod; a shared map in the witness)
// seal2Store = { getState, putState } for account/session pickles (the holospace vault in prod)
// now() → ts (injected so the caller controls time; no Date in this module)
export function makeMsg({ voz, mesh, seal2Store, pickleKey, now = () => 0, saveMsg = null } = {}) {
  const seal = makeSeal2({ voz, getState: seal2Store.getState, putState: seal2Store.putState, pickleKey });
  const log = makeLog({ kappa: mesh.kappa, put: mesh.put, get: mesh.get, verify: mesh.verify });
  const plain = new Map();       // conv → [{ from, text, ts, kappa }]  (display history)
  const decrypted = new Set();   // record κs already decrypted (Olm can't decrypt twice)
  const peerBundle = new Map();   // cid(peerId) → true once a session is established
  const listeners = [];
  let myId = null;

  const _conv = (peerId) => mesh.kappa(_enc.encode([myId, peerId].sort().join("|")));
  const _hist = (conv) => plain.get(conv) || plain.set(conv, []).get(conv);
  const emit = (m) => listeners.forEach((f) => { try { f(m); } catch {} });

  async function init() {
    await seal.init();
    myId = seal.identityKey();
    const bundle = await seal.publishBundle(20);
    const bytes = _enc.encode(JSON.stringify(bundle));
    const kappa = mesh.kappa(bytes);
    await mesh.put(kappa, bytes);                              // publish the prekey bundle on the mesh (κ-addressed)
    return { id: myId, bundleKappa: kappa };
  }

  // introduce: fetch a peer's bundle by κ and open an outbound session (cid = the peer's identity key).
  async function open(peerId, bundleKappa) {
    const bytes = await mesh.get(bundleKappa);
    if (!bytes) throw new Error("holo-msg: peer bundle not on the mesh yet");
    const bundle = JSON.parse(_dec.decode(bytes));
    await seal.startOutbound(peerId, bundle);
    peerBundle.set(peerId, true);
    return _conv(peerId);
  }

  // send: seal → append a log record → return its κ + the conv head (the caller announces + beacons it).
  async function send(peerId, text) {
    const msg = await seal.sealTo(peerId, text);
    const conv = _conv(peerId);
    const ts = now();
    const kappa = await log.append(conv, _packPayload(msg), { author: myId, ts });
    decrypted.add(kappa);                                     // my own record — plaintext is already known
    _hist(conv).push({ from: "me", text, ts, kappa });
    if (saveMsg) await saveMsg(conv, { from: "me", text, ts, kappa });
    return { kappa, conv, head: log.head(conv) };
  }

  // deliver: κ-diff sync a conv from a peer's head, then decrypt (ONCE, in causal order) every NEW record
  // that isn't mine → store plaintext + emit. Returns the freshly-delivered messages.
  async function deliver(conv, remoteHeads) {
    const records = await log.sync(conv, remoteHeads);        // ordered; verified (L5) inside sync
    const out = [];
    for (const r of records) {
      if (decrypted.has(r.kappa)) continue;
      if (r.author === myId) { decrypted.add(r.kappa); continue; }
      let text;
      try { text = await seal.receive(r.author, r.author, _unpackPayload(r.payload)); }
      catch { decrypted.add(r.kappa); continue; }             // undecryptable (out-of-order/tampered) — skip, retry later never re-adds
      decrypted.add(r.kappa);
      const m = { from: r.author, text, ts: r.ts, kappa: r.kappa, conv };
      _hist(conv).push({ from: r.author, text, ts: r.ts, kappa: r.kappa });
      if (saveMsg) await saveMsg(conv, { from: r.author, text, ts: r.ts, kappa: r.kappa });
      emit(m); out.push(m);
    }
    return out;
  }

  // hydrate the display history + decrypted-set from the vault store on reload (plaintext, zero network).
  function hydrate(conv, msgs) {
    plain.set(conv, msgs.slice());
    for (const m of msgs) if (m.kappa) decrypted.add(m.kappa);
  }

  const history = (peerId) => (_hist(_conv(peerId))).slice();
  const historyByConv = (conv) => (plain.get(conv) || []).slice();

  return { init, open, send, deliver, hydrate, history, historyByConv, on: (f) => listeners.push(f), id: () => myId, conv: _conv };
}
