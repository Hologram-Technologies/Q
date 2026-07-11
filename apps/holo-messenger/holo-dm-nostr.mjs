// holo-dm-nostr.mjs — N8/GL1: the blind drop-box for STATIC origins. github.io serves no /mbox — so the
// same three verbs (drop / pull / ack) ride PUBLIC Nostr relays instead: the tag (already a blind sha256
// lane address) becomes a "#t" topic, the sealed wire becomes the event content, and the event is signed
// by a THROWAWAY key per tab (the signature satisfies relay acceptance; trust stays in the holo-seal
// envelope). Relays see exactly what /mbox saw: ciphertext + a blind tag + timing. Nothing above holo-dm
// knows the transport changed.
//
// PERSISTENT kind (1) + NIP-40 expiration (72 h) — NOT the ephemeral 20001 the rendezvous mailbox uses:
// store-and-forward needs relays to HOLD the event for an offline recipient; honoring relays purge at
// expiry, others age it out.
//
// ACK IS HONEST (GL2): a public relay won't delete a sender's event for the recipient. ack = a durable
// local seen-set + a since-cursor; the relay may re-show what you've seen and the engine's durable κ-dedup
// already doesn't care. LIMITS, plainly: delivery depends on ≥1 shared public relay staying up and
// accepting ~4 KB kind-1 events; if every relay is down, drop() THROWS (the caller sees the truth).

const RELAY_MODULE = "/usr/lib/holo/holo-rendezvous.mjs";   // Web REACH's proven pool + schnorr (IMPORT-ONLY)
const MSG_KIND = 1;
const TTL_SEC = 72 * 3600;

let _rdvP = null;
function _rdv() {
  // browser: the served module (works at /, /Q, localhost dist). node witness: the canonical OS tree.
  if (!_rdvP) _rdvP = import(RELAY_MODULE).catch(() =>
    import(new URL("../../../holo-os/system/os/usr/lib/holo/holo-rendezvous.mjs", import.meta.url).href));
  return _rdvP;
}

// durable ack state — localStorage in a browser, in-memory in the node witness (its runs are single-life)
const _mem = new Map();
const _store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return _mem.get(k) || null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { _mem.set(k, v); } },
};
const _seenKey = (tag) => "holo.dm.nostr.seen." + tag.slice(0, 16);
const _sinceKey = (tag) => "holo.dm.nostr.since." + tag.slice(0, 16);
const _loadSeen = (tag) => new Set(JSON.parse(_store.get(_seenKey(tag)) || "[]"));
const _saveSeen = (tag, set) => _store.set(_seenKey(tag), JSON.stringify([...set].slice(-800)));

// ── one relay pool per tab, rebuilt if every socket died ─────────────────────────────────────────────────
let _poolP = null;
async function _pool() {
  if (_poolP) { const p = await _poolP; if (p.live().length) return p; _poolP = null; for (const s of p.socks) { try { s.ws.close(); } catch {} } }
  _poolP = (async () => {
    const { DEFAULT_RELAYS, holoSchnorr } = await _rdv();
    const socks = [];
    for (const url of DEFAULT_RELAYS) {
      try { const ws = new WebSocket(url); ws.binaryType = "arraybuffer"; socks.push({ url, ws, open: false }); } catch {}
    }
    await Promise.all(socks.map((s) => new Promise((res) => {
      let done = false; const fin = (ok) => { if (!done) { done = true; s.open = ok; res(); } };
      try { s.ws.addEventListener("open", () => fin(true)); s.ws.addEventListener("error", () => fin(false)); s.ws.addEventListener("close", () => { s.open = false; }); } catch { fin(false); }
      setTimeout(() => fin(false), 4000);
    })));
    const sk = (globalThis.crypto || crypto).getRandomValues(new Uint8Array(32));
    const pk = holoSchnorr.getPublicKey(sk);
    // live() trusts readyState, NOT the initial open-race flag: a busy main thread (the 3 MB spine wasm
    // instantiating) can delay the `open` event past the settle timeout — the socket is still perfectly
    // good, just late. The flag only gated the initial await.
    return { socks, sk, pk, holoSchnorr, live: () => socks.filter((s) => s.ws.readyState === 1) };
  })();
  return _poolP;
}
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// wait briefly for at least one relay — the pool may still be connecting when the first verb lands
async function _liveWait(p, waitMs = 8000) {
  const t0 = Date.now();
  for (;;) { const l = p.live(); if (l.length) return l; if (Date.now() - t0 > waitMs) return []; await _sleep(250); }
}

// ── one persistent subscription per tag: pull() drains its buffer; live() rides the same stream ─────────
let _subCtr = 0;
const _subs = new Map();   // tag → { buf: [{id,blob,ts}], seen: Set, cbs: [fn] }
async function _sub(tag) {
  let st = _subs.get(tag);
  if (st) return st;
  const p = await _pool();
  st = { buf: [], seen: _loadSeen(tag), cbs: [] };
  _subs.set(tag, st);
  const since = Math.max(+(_store.get(_sinceKey(tag)) || 0), Math.floor(Date.now() / 1000) - TTL_SEC) - 600;
  const subId = "hdm-" + tag.slice(0, 10) + "-" + _subCtr++;
  const filter = { kinds: [MSG_KIND], "#t": [tag], since };
  const onMsg = (e) => {
    try {
      const m = JSON.parse(typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data));
      if (m[0] !== "EVENT" || m[1] !== subId || !m[2]) return;
      const ev = m[2];
      if (st.seen.has(ev.id) || st.buf.some((x) => x.id === ev.id)) return;   // cross-relay + replay dedup
      st.buf.push({ id: ev.id, blob: ev.content, ts: (ev.created_at || 0) * 1000 });
      for (const cb of st.cbs) { try { cb(); } catch {} }
    } catch {}
  };
  // subscribe every relay that is live NOW — and keep offering the REQ to relays that open LATE (the
  // wasm-busy main thread delays their open event; they are still good). One REQ per socket, ever.
  const reqd = new Set();
  const subscribe = () => {
    for (const s of p.live()) {
      if (reqd.has(s)) continue;
      reqd.add(s);
      try { s.ws.send(JSON.stringify(["REQ", subId, filter])); s.ws.addEventListener("message", onMsg); } catch {}
    }
  };
  subscribe();
  const iv = setInterval(subscribe, 1000);
  setTimeout(() => clearInterval(iv), 20000);
  return st;
}

// ── the three verbs (holo-dm's exact shapes) ─────────────────────────────────────────────────────────────
export async function drop(tag, wire) {
  const p = await _pool();
  const nowSec = Math.floor(Date.now() / 1000);
  const ev = await p.holoSchnorr.finalizeEvent(
    { kind: MSG_KIND, created_at: nowSec, tags: [["t", tag], ["expiration", String(nowSec + TTL_SEC)]], content: wire }, p.sk, p.pk);
  const msg = JSON.stringify(["EVENT", ev]);
  let sent = 0;
  for (const s of await _liveWait(p)) { try { s.ws.send(msg); sent++; } catch {} }
  if (!sent) throw new Error("no relay reachable — the word did not leave this device");
  return { ok: true, id: ev.id };
}

export async function pull(tag) {
  const st = await _sub(tag);
  return st.buf.slice();
}

export async function ack(tag, ids) {
  if (!ids || !ids.length) return { ok: true };
  const st = await _sub(tag);
  let newest = +(_store.get(_sinceKey(tag)) || 0);
  for (const id of ids) {
    st.seen.add(id);
    const it = st.buf.find((x) => x.id === id);
    if (it && it.ts / 1000 > newest) newest = Math.floor(it.ts / 1000);
  }
  st.buf = st.buf.filter((x) => !ids.includes(x.id));
  _saveSeen(tag, st.seen);
  if (newest) _store.set(_sinceKey(tag), String(newest));
  return { ok: true, remaining: st.buf.length };
}

// live push (GL3): fire cb whenever a new blob lands on this tag — the caller polls IMMEDIATELY instead of
// waiting its cadence out. Returns unsubscribe.
export async function live(tag, cb) {
  const st = await _sub(tag);
  st.cbs.push(cb);
  return () => { const i = st.cbs.indexOf(cb); if (i >= 0) st.cbs.splice(i, 1); };
}

export async function relayCount() { return (await _pool()).live().length; }
