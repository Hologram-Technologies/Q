// holo-keys.mjs — Holo Keys core: a LIVE POWER as a universal κ-link. THE LINK IS THE KEY.
//
// Design (the holo-pay idiom, generalized from nouns to verbs): a Key is a grant the issuer MINTS into a link —
// base64url positional JSON in the fragment, κ = SHA-256 of the canonical public fields — and hands over any
// channel like a photo. Redeeming it is DIALING HOME: the holder's device opens the existing Holo Direct sealed
// channel to the issuer (the grant carries the issuer's PUBLIC keys — the same one-link introduction Direct
// already does) and sends a key-invoke control frame. The issuer's KEYRING is the enforcement truth: a frame is
// honored only if the grant id is one THIS device minted, unexpired, and not revoked — nothing a holder can
// forge matters, because authority is issuer-local lookup, never bearer-side proof. Revoking = flipping one
// keyring row; the next invoke is refused at the door and the holder's surface folds to "revoked". 100%
// serverless: transport is Holo Direct's dual path (P2P WebRTC when warm, blind mailbox when not), and when the
// issuer's device sleeps the Key sleeps — that is the sovereignty, so surfaces must say "asleep", never "broken".
//
// Two module instances may coexist (one bundled into chat-ui, one runtime-imported by the engine) — ALL mutable
// state (verb handlers, pending invokes, engine handle) lives on window.__holoKeysState so they are ONE system.
// Framework-free: this same module powers the React card, the engine dispatch, and a Node witness.

export const KEY_VERSION = 1;
const LINK_PIN = "k1";                       // the ?v= pin siblings import us with (cache-truth, like ?v=n8)

// ── shared state across instances (bundle + runtime) ──
function _S() {
  const g = typeof window !== "undefined" ? window : globalThis;
  if (!g.__holoKeyState) g.__holoKeyState = { handlers: new Map(), pending: new Map(), direct: null, nextId: 1, listeners: [],
    liveHolders: new Map() /* grantId → Set(cid) — who redeemed, for the instant-revoke push */,
    revokeListeners: [] /* holder-side: (grantId) => void when a key-revoked push lands */, revokedSeen: new Set() };
  return g.__holoKeyState;
}
// the engine registers itself here so BOTH invoke (holder) and the instant-revoke push (issuer) can reach the
// wire without waiting for a first invoke. Called by holo-direct-mount after boot. One handle, shared state.
export function attachDirect(d) { _S().direct = d; }
// holder-side: subscribe a card to the instant "taken back" push for its grant id (fires the moment the issuer
// revokes, if we're reachable; the door still refuses on the next tap regardless — push is UX, not authority).
export function onKeyRevoked(fn) { _S().revokeListeners.push(fn); return () => { const a = _S().revokeListeners; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
export function keyRevoked(grantId) { return _S().revokedSeen.has(grantId); }

// ── base64url (unicode-safe) + κ — byte-identical to holo-pay's so the two links age the same way ──
function _b64urlEncode(obj) {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function _b64urlDecode(str) {
  return JSON.parse(decodeURIComponent(escape(atob(str.replace(/-/g, "+").replace(/_/g, "/")))));
}
async function _sha256hex(str) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(hash)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function _randHex(n) { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => x.toString(16).padStart(2, "0")).join(""); }

// ── the grant record ──────────────────────────────────────────────────────────────────────────────────────────
// Positional wire (no repeated keys — short, money-like link). Order is APPEND-ONLY. κ is NOT transmitted; the
// verifier derives it from the canonical fields, so a tampered link simply is a different (unknown) key and the
// issuer refuses it — integrity enforcement and authority enforcement are the SAME lookup.
const _ORDER = ["v", "verb", "name", "issName", "iss", "issBox", "created", "expires", "nonce", "note"];
function _packPayload(g) { return _b64urlEncode(_ORDER.map((k) => (g[k] == null ? null : g[k]))); }
function _unpackPayload(payload) {
  const v = _b64urlDecode(payload);
  if (!Array.isArray(v)) return v;
  const o = {}; _ORDER.forEach((k, i) => { if (v[i] != null) o[k] = v[i]; });
  return o;
}
// canonical string for the κ — stable order, every public field. The nonce makes two otherwise-identical
// grants distinct keys (mint two, revoke one, the other still opens).
function _canon(g) {
  return [g.v, g.verb, g.name || "", g.issName || "", g.iss, g.issBox, g.created, g.expires || "", g.nonce, g.note || ""].join("|");
}
export async function grantKappa(g) { return _sha256hex(_canon(g)); }

// ── the VERBS a device can extend (P0: music). A verb names an interface, methods name the moves. ──
export const VERBS = {
  "music.control": {
    glyph: "🎵", label: "My music",
    blurb: "play · pause · skip · volume — on my device",
    methods: ["now", "play", "pause", "resume", "next", "prev", "volume"],
  },
};

// ── mint / keyring / revoke (issuer side) ─────────────────────────────────────────────────────────────────────
// The keyring is the truth and lives per-device (localStorage — present before any engine boots, survives
// reloads; the strand mirror below is the OS-unification hook). Row: {id, verb, name, issName, created,
// expires, nonce, note, status:"live"|"revoked", uses, lastUsed, lastFrom}.
const RING = "holo.keys.ring.v1";
function _ring() { try { return JSON.parse(localStorage.getItem(RING) || "[]"); } catch { return []; } }
function _saveRing(rows) {
  try { localStorage.setItem(RING, JSON.stringify(rows)); } catch {}
  for (const fn of _S().listeners) { try { fn(rows); } catch {} }
}
export function keyring() { return _ring(); }
export function onKeyring(fn) { _S().listeners.push(fn); }

// mirror a keyring event onto the operator's strand when the OS spine is mounted (kind: "key.mint"/"key.revoke"
// — the same open-schema family as zone.bind/zone.revoke). Fail-soft: no strand → the keyring alone is truth.
function _strand(kind, payload) {
  try { const st = typeof window !== "undefined" && window.HoloStrand; if (st && st.append) st.append({ kind, payload }); } catch {}
}

export async function mintKey({ verb = "music.control", name = null, note = null, ttlMs = 7 * 24 * 3600e3, myPub, issName = null } = {}) {
  if (!VERBS[verb]) throw new Error("Holo Keys: unknown verb " + verb);
  if (!myPub || !myPub.sign || !myPub.box) throw new Error("Holo Keys: minting needs my Direct public keys");
  const now = Date.now();
  const grant = {
    v: KEY_VERSION, verb, name: name || VERBS[verb].label, issName: issName || null,
    iss: myPub.sign, issBox: myPub.box,
    created: now, expires: ttlMs ? now + ttlMs : null, nonce: _randHex(8), note: note || null,
  };
  grant.id = await grantKappa(grant);
  const rows = _ring();
  rows.unshift({ ...grant, status: "live", uses: 0, lastUsed: null, lastFrom: null });
  _saveRing(rows);
  _strand("key.mint", { id: grant.id, verb, name: grant.name, expires: grant.expires });
  return grant;
}

export function revokeKey(id) {
  const rows = _ring();
  const row = rows.find((r) => r.id === id);
  if (!row || row.status === "revoked") return false;
  row.status = "revoked"; row.revokedAt = Date.now();
  _saveRing(rows);
  _strand("key.revoke", { id });
  // L2 — INSTANT: push a "taken back" to every holder who has redeemed this key, so their surface folds NOW,
  // not on their next tap. Best-effort (offline holders are caught at the door when they return). The push is
  // never authority — the keyring flip above already made the next invoke fail closed.
  const S = _S();
  const holders = S.liveHolders.get(id);
  if (holders && S.direct && S.direct.keySend) { for (const cid of holders) { try { S.direct.keySend(cid, { t: "key-revoked", grantId: id }); } catch {} } }
  return true;
}

// ── link + message text (the three openings of one key) ──
export function buildKeyLink(grant) {
  const payload = _packPayload(grant);
  return { kappa: grant.id, payload, holo: `holo://key/${grant.id}#${payload}` };
}
export function keyMessageText(grant, link) {
  const v = VERBS[grant.verb] || { glyph: "🗝", label: grant.verb };
  const who = (grant.issName || "Someone").trim();
  const note = grant.note ? `\n“${grant.note}”` : "";
  return `🗝 ${who} handed you a key: ${grant.name}${note}\nA live power on their device — use it right here; they can take it back any time.\n${link.holo}`;
}

// ── parse / detect (holder side — display + dial info; AUTHORITY stays issuer-side) ──
export async function parseKeyLink(input) {
  let payload = String(input || "");
  if (payload.includes("#")) payload = payload.split("#").pop();
  let grant;
  try { grant = _unpackPayload(payload); } catch { return { ok: false, error: "unreadable key link" }; }
  if (!grant || grant.v !== KEY_VERSION || !grant.iss || !grant.issBox || !grant.verb) return { ok: false, error: "not a key link" };
  grant.id = await grantKappa(grant);
  const expired = !!(grant.expires && Date.now() > grant.expires);
  return { ok: true, grant, expired };
}
// SYNC detection inside a message body → { grant (unverified, for display), url, payload }. null if not a key
// link. The κ from the LINK PATH is carried onto grant.id so the render path can act (revoke / keyring lookup /
// invoke) without awaiting the digest — the path id is an ADDRESS, not a proof: the issuer's keyring gates on it
// (a forged id matches no row → unknown-key refusal), and parseKeyLink() re-derives the κ for the trust path.
const _KEY_RE = /holo:\/\/key\/([a-f0-9]{16,64})#([A-Za-z0-9_-]+)/;
export function keyLinkInText(text) {
  const m = String(text || "").match(_KEY_RE); if (!m) return null;
  try {
    const grant = _unpackPayload(m[2]);
    if (grant && grant.v === KEY_VERSION && grant.iss && grant.verb) { grant.id = m[1].toLowerCase(); return { grant, url: m[0], payload: m[2] }; }
  } catch {}
  return null;
}

// ── the verb HOST (issuer side): serve(verb, handler) + the music bridge ─────────────────────────────────────
// A handler is (method, args) → value|Promise. music.control bridges over BroadcastChannel("holo-music-ctl") to
// the player app (same origin, sibling frame — the holo-wallet seam idiom): request {id, cmd, args} → reply
// {re, ok, value}. Player closed → timeout → an HONEST refusal ("music isn't open on their device"), never a hang.
export function serve(verb, handler) { _S().handlers.set(verb, handler); }
function _musicBridge(method, args = []) {
  return new Promise((resolve, reject) => {
    let bc; try { bc = new BroadcastChannel("holo-music-ctl"); } catch { return reject(new Error("no music seam")); }
    const id = _randHex(8);
    const to = setTimeout(() => { try { bc.close(); } catch {} reject(new Error("music isn't open on their device")); }, 4000);
    bc.onmessage = (e) => {
      const d = e.data || {}; if (d.re !== id) return;
      clearTimeout(to); try { bc.close(); } catch {}
      d.ok ? resolve(d.value == null ? true : d.value) : reject(new Error(d.error || "the music app refused"));
    };
    bc.postMessage({ id, cmd: method, args });
  });
}
serve("music.control", (method, args) => {
  if (!VERBS["music.control"].methods.includes(method)) throw new Error("that move isn't part of this key");
  return _musicBridge(method, args);
});

// ── frame handling (wired by holo-direct's receive gate) ─────────────────────────────────────────────────────
// handleFrame(payload, {from, cid, reply}) — the engine hands us every {t:"key-*"} control frame.
//   key-invoke  {t, id, grantId, payload?, method, args} → verify against MY keyring → run verb → key-result
//   key-result  {t, id, ok, value|error, state?}         → resolve the matching pending invoke
// The refusal path always answers (the holder's card must fold honestly, not spin).
export async function handleFrame(frame, { from, cid, reply } = {}) {
  const S = _S();
  if (frame.t === "key-result") {
    const p = S.pending.get(frame.id);
    if (p) { S.pending.delete(frame.id); clearTimeout(p.to); frame.ok ? p.resolve(frame.value) : p.reject(new Error(frame.error || "refused")); }
    return true;
  }
  // HOLDER side: the issuer took this key back — fold the surface NOW. Idempotent; also refuse any in-flight
  // invoke for this grant so a mid-flight tap doesn't resolve stale. Authority still lives at the issuer's door.
  if (frame.t === "key-revoked" && frame.grantId) {
    if (!S.revokedSeen.has(frame.grantId)) { S.revokedSeen.add(frame.grantId); for (const fn of S.revokeListeners) { try { fn(frame.grantId); } catch {} } }
    for (const [pid, p] of S.pending) { if (p.grantId === frame.grantId) { S.pending.delete(pid); clearTimeout(p.to); p.reject(new Error("revoked")); } }
    return true;
  }
  if (frame.t !== "key-invoke" || !frame.id) return false;
  // exactly-once for a NON-idempotent move (a redelivered "next" must not skip twice): replay the cached
  // answer for a frame id we've already served. Bounded LRU, in shared state so both instances agree.
  const seen = S.seen || (S.seen = new Map());
  if (seen.has(frame.id)) { reply && reply(seen.get(frame.id)); return true; }
  const answer = (ok, extra) => {
    const res = { t: "key-result", id: frame.id, ok, ...extra };
    seen.set(frame.id, res); if (seen.size > 128) seen.delete(seen.keys().next().value);
    return reply && reply(res);
  };
  const rows = _ring();
  const row = rows.find((r) => r.id === frame.grantId);
  if (!row) return answer(false, { error: "unknown-key", state: "revoked" });          // not mine / tampered → same refusal
  if (row.status === "revoked") return answer(false, { error: "revoked", state: "revoked" });
  if (row.expires && Date.now() > row.expires) return answer(false, { error: "expired", state: "expired" });
  const handler = S.handlers.get(row.verb);
  if (!handler) return answer(false, { error: "no backend for " + row.verb, state: "asleep" });
  try {
    const value = await handler(String(frame.method || ""), Array.isArray(frame.args) ? frame.args : []);
    row.uses = (row.uses || 0) + 1; row.lastUsed = Date.now(); row.lastFrom = from || null;
    _saveRing(rows);
    // remember this holder so an instant-revoke push can reach them (keyed by the contact we replied over).
    if (cid) { let h = S.liveHolders.get(frame.grantId); if (!h) { h = new Set(); S.liveHolders.set(frame.grantId, h); } h.add(cid); }
    return answer(true, { value, state: "live" });
  } catch (e) { return answer(false, { error: String((e && e.message) || e), state: "asleep" }); }
}

// ── invoke (holder side): dial home + one round trip ─────────────────────────────────────────────────────────
// The grant carries the issuer's public keys — the SAME introduction a Direct link carries, so redeeming a key
// and answering a sealed chat are one trust model (TOFU, safety numbers, key-change refusal all apply).
async function _direct() {
  const S = _S();
  if (S.direct) return S.direct;
  const hd = typeof window !== "undefined" && window.HoloDirect;
  if (!hd || !hd.boot) throw new Error("Holo Direct isn't mounted");
  S.direct = await hd.boot();
  return S.direct;
}
export function issuerCid(grant) { return (grant.issName || null) || "direct:" + String(grant.iss || "").slice(0, 12); }
export async function invoke(grant, method, args = [], { timeoutMs = 12000 } = {}) {
  const S = _S();
  const direct = await _direct();
  // MY OWN key on MY OWN device: no transport at all — straight through the same keyring gate (a revoked
  // key refuses its own issuer too; one truth). This is also why your keys keep working fully offline.
  if (direct.myPub && direct.myPub.sign === grant.iss) {
    let res = null;
    await handleFrame({ t: "key-invoke", id: _randHex(8), grantId: grant.id, method, args }, { from: grant.iss, cid: "me", reply: (f) => { res = f; } });
    if (!res) throw new Error("no answer");
    if (!res.ok) throw new Error(res.error || "refused");
    return res.value;
  }
  const cid = issuerCid(grant);
  direct.addContact(cid, { sign: grant.iss, box: grant.issBox });   // introduction (TOFU) — a no-op when known
  direct.warm(cid);                                                 // P2P when possible; the mailbox carries it regardless
  const id = _randHex(8);
  const p = new Promise((resolve, reject) => {
    const to = setTimeout(() => { S.pending.delete(id); reject(new Error("no answer — their device is asleep")); }, timeoutMs);
    S.pending.set(id, { resolve, reject, to, grantId: grant.id });   // grantId so an instant-revoke push can kill an in-flight tap
  });
  const sent = await direct.keySend(cid, { t: "key-invoke", id, grantId: grant.id, method, args });
  if (!sent) { const pd = S.pending.get(id); if (pd) { S.pending.delete(id); clearTimeout(pd.to); } throw new Error("could not reach their device"); }
  return p;
}

// summary() — a Q.health-shaped glance at every power you've extended: what's live, who's holding, how used.
// The keyring IS the OS surface (a view over the same rows the strand mirrors); this is Q's read hook so it can
// notice + narrate ("Ben used your music key twice"; "a key you handed out expires tonight") in its own voice.
export function summary() {
  const rows = _ring(), now = Date.now();
  const live = rows.filter((r) => r.status !== "revoked" && !(r.expires && now > r.expires));
  return {
    total: rows.length,
    live: live.length,
    revoked: rows.filter((r) => r.status === "revoked").length,
    expired: rows.filter((r) => r.status !== "revoked" && r.expires && now > r.expires).length,
    uses: rows.reduce((a, r) => a + (r.uses || 0), 0),
    expiringSoon: live.filter((r) => r.expires && r.expires - now < 6 * 3600e3).map((r) => ({ name: r.name, expires: r.expires })),
    keys: live.map((r) => ({ id: r.id, verb: r.verb, name: r.name, uses: r.uses || 0, lastUsed: r.lastUsed || null, expires: r.expires || null })),
  };
}

// self-describe for harnesses + the OS shell. window.HoloKey — SINGULAR: window.HoloKeys is already the
// OS command-bar (keyboard) module; one letter is the difference between a power and a shortcut.
if (typeof window !== "undefined") {
  window.HoloKey = Object.assign(window.HoloKey || {}, {
    mintKey, revokeKey, keyring, onKeyring, buildKeyLink, keyMessageText, parseKeyLink, keyLinkInText,
    invoke, serve, handleFrame, attachDirect, onKeyRevoked, keyRevoked, summary, VERBS, version: KEY_VERSION, pin: LINK_PIN,
  });
}
