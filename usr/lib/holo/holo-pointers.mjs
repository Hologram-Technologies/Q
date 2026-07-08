// holo-pointers.mjs — SELF-AUTHENTICATING pointers (V2). The magic case: a Nostr note. Its id IS a
// sha256 of the note (NIP-01: sha256 of [0,pubkey,created_at,kind,tags,content]), so `note1…`/`nevent1…`
// is just a κ on our sha256 axis — fetch it from ANY untrusted relay and re-derive; a relay that lies is
// refused, not trusted (L5/SEC-1). Dep-free + isomorphic (sha256 + WebSocket INJECTED). IPNS/Bluesky next.

const hx = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

// ── bech32 (BIP-173) decode — Nostr's NIP-19 names (note/npub/nevent/nprofile) ────────────────────────
const B32 = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Words(str) {
  const s = String(str).toLowerCase(); const pos = s.lastIndexOf("1");
  if (pos < 1) throw new Error("not bech32");
  const vals = [];
  for (const c of s.slice(pos + 1)) { const i = B32.indexOf(c); if (i < 0) throw new Error("bad bech32 char"); vals.push(i); }
  return { hrp: s.slice(0, pos), words: vals.slice(0, -6) };          // drop the 6-word checksum
}
function words5to8(words) {                                           // 5-bit groups → bytes
  let acc = 0, bits = 0; const out = [];
  for (const w of words) { acc = (acc << 5) | w; bits += 5; while (bits >= 8) { bits -= 8; out.push((acc >> bits) & 0xff); } }
  return Uint8Array.from(out);
}

// decodeNostr(name) → { type, id? (32-byte hex), pubkey?, relays[], author? }. Never decodes a secret.
export function decodeNostr(name) {
  const { hrp, words } = bech32Words(name);
  const bytes = words5to8(words);
  if (hrp === "note") return { type: "note", id: hx(bytes.slice(0, 32)) };
  if (hrp === "npub") return { type: "npub", pubkey: hx(bytes.slice(0, 32)) };
  if (hrp === "nsec") return { type: "nsec" };                        // a secret is NEVER resolved
  if (hrp === "nevent" || hrp === "nprofile" || hrp === "naddr") {
    const relays = []; let special = null, author = null, i = 0;
    while (i + 2 <= bytes.length) {                                   // TLV: type,len,value…
      const t = bytes[i], l = bytes[i + 1], v = bytes.slice(i + 2, i + 2 + l); i += 2 + l;
      if (t === 0) special = v; else if (t === 1) relays.push(new TextDecoder().decode(v)); else if (t === 2) author = hx(v);
    }
    if (hrp === "nevent") return { type: "nevent", id: special ? hx(special) : null, relays, author };
    if (hrp === "nprofile") return { type: "nprofile", pubkey: special ? hx(special) : null, relays };
    return { type: hrp, relays };
  }
  return { type: hrp };
}

// ── NIP-01 event id = sha256 of the canonical serialization. THIS is the self-authentication. ─────────
export async function nostrEventId(ev, sha256hex) {
  const ser = JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags || [], ev.content || ""]);
  return await sha256hex(new TextEncoder().encode(ser));
}
export async function verifyNostrEvent(ev, sha256hex) {
  if (!ev || typeof ev.id !== "string" || typeof ev.pubkey !== "string" || typeof ev.created_at !== "number") return { ok: false, why: "malformed event" };
  const id = await nostrEventId(ev, sha256hex);
  return id === ev.id.toLowerCase() ? { ok: true, id } : { ok: false, why: "event-id-mismatch", got: id, want: ev.id };
}

// ── fetch from raced UNTRUSTED relays (injected WebSocket); first matching id wins, silence otherwise ──
export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band", "wss://relay.primal.net"];
export function fetchNostrEvent(id, relays, { WebSocket: WS = null, timeout = 5000 } = {}) {
  const Sock = WS || (typeof WebSocket !== "undefined" ? WebSocket : null);
  if (!Sock) return Promise.resolve(null);
  const urls = relays && relays.length ? relays : DEFAULT_RELAYS;
  return new Promise((resolve) => {
    let done = false, pending = urls.length; const socks = [];
    const finish = (v) => { if (done) return; done = true; for (const w of socks) { try { w.close(); } catch {} } resolve(v); };
    const timer = setTimeout(() => finish(null), timeout);
    for (const url of urls) {
      try {
        const ws = new Sock(url); socks.push(ws); const sub = "h" + id.slice(0, 12);
        ws.onopen = () => { try { ws.send(JSON.stringify(["REQ", sub, { ids: [id] }])); } catch {} };
        ws.onmessage = (m) => { try { const d = JSON.parse(typeof m.data === "string" ? m.data : ""); if (d[0] === "EVENT" && d[2] && String(d[2].id).toLowerCase() === id) { clearTimeout(timer); finish(d[2]); } } catch {} };
        ws.onerror = () => { if (--pending <= 0) { clearTimeout(timer); finish(null); } };
      } catch { if (--pending <= 0) { clearTimeout(timer); finish(null); } }
    }
  });
}

// resolveNostr(name, {sha256hex, WebSocket, timeout}) → the verified note as a κ object, or an honest refusal.
export async function resolveNostr(name, { sha256hex, WebSocket = null, timeout } = {}) {
  const d = decodeNostr(name);
  if (d.type === "nsec") return { ok: false, why: "a Nostr secret is never resolved" };
  if (!d.id) return { ok: false, why: d.pubkey ? "a Nostr identity — resolve its notes, not the key" : "unsupported Nostr name" };
  const ev = await fetchNostrEvent(d.id, d.relays, { WebSocket, timeout });
  if (!ev) return { ok: false, why: "no relay produced this note" };
  const v = await verifyNostrEvent(ev, sha256hex);
  if (!v.ok) return { ok: false, why: "a relay served a note that does not match its id (" + v.why + ") — refused" };
  return {
    ok: true, kappa: "sha256:" + d.id, bytes: new TextEncoder().encode(ev.content || ""), event: ev,
    via: "nostr-relay", author: ev.pubkey,
    trust: "self-verifying — the note's id is a sha256 of the note itself (NIP-01); no relay was trusted",
  };
}

export default { decodeNostr, nostrEventId, verifyNostrEvent, fetchNostrEvent, resolveNostr, DEFAULT_RELAYS };
