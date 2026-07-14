// holo-status.mjs — WhatsApp STATUS as sealed κ-objects over Holo Direct (HOLO-MESSENGER-STATUS T1).
//
// A story is EPHEMERAL SOCIAL BROADCAST with no server anywhere: the author fans ONE sealed frame to every
// contact over the existing Direct rail (p2p when warm, blind mailbox when not — offline contacts see it on
// their next open, inside its 24h ttl). The story IS its hash: id = sha256 of the canonical content (Law L5 —
// a receiver re-derives before trusting; a tampered story simply does not exist). Photos travel embedded as a
// compressed JPEG data-URL capped WhatsApp-tight (≤ ~135KB) — v1 deliberately trades κ-ref streaming for a
// self-contained frame the mailbox already carries. Text stories are pure JSON on a colored card.
//
// This module owns the SHELF: OPFS (quota-safe for photo bodies; localStorage would burst at ~5MB) with an
// in-memory index, 24h expiry enforced at ingest AND render, seen-state, viewer receipts (story-ack rides
// back to the author over the same rail) and revoke (author fans story-revoke; expiry deletes regardless).
// The transport engine (holo-direct.mjs) only CARRIES — it holds no story state at all.
//
//   const st = await getStatusEngine();          // singleton; boots Direct lazily
//   await st.post({ kind:"text", text, bg })     // or { kind:"photo", dataUrl, caption }
//   st.feed()                                    // Map: "me" | authorSign → [stories, oldest→newest]
//   await st.markSeen(id)                        // ring greys + receipt to the author
//   await st.revoke(id)                          // my story: gone everywhere
//   st.onChange(cb)                              // re-render signal (ingest/ack/expiry/post)

const TTL_MS = 86400e3;                            // WhatsApp's 24 hours
const MAX_DATAURL = 200000;                        // ~150KB of JPEG — the mailbox-friendly ceiling
const MAX_TEXT = 700;                              // WhatsApp's status text cap ballpark
const enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// the canonical content string the id commits to — field order is FROZEN (changing it orphans every live story)
const idOf = (s) => sha256hex(JSON.stringify([s.v, s.kind, s.text || "", s.bg || "", s.caption || "", s.dataUrl || "", s.at, s.ttl, s.author, s.name || ""]));

export async function createStatusEngine({ hd = null, now = () => Date.now(), ttlMs = TTL_MS } = {}) {
  hd = hd || (typeof window !== "undefined" ? window.HoloDirect : null);
  if (!hd || !hd.onStory) throw new Error("status needs the HoloDirect story rail");
  const mySign = hd.mySign ? await hd.mySign() : null;
  const myName = () => { try { return (localStorage.getItem("holo.direct.name") || "").trim() || null; } catch { return null; } };

  // ── the shelf: OPFS dir (photo bodies are heavy) + memory index; absent OPFS ⇒ memory-only (still works, no persistence)
  let dir = null;
  try { dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-status", { create: true }); } catch {}
  const mem = new Map();                           // id → rec {…story, authorCid, mine, seen, viewers:{sign:ts}}
  const subs = new Set();
  const ping = () => { for (const cb of subs) { try { cb(); } catch {} } };
  const fresh = (s) => s && (s.at + (s.ttl || ttlMs)) > now();
  async function _save(rec) {
    mem.set(rec.id, rec);
    if (dir) try { const fh = await dir.getFileHandle(rec.id, { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(rec)); await w.close(); } catch {}
  }
  async function _drop(id) { mem.delete(id); if (dir) try { await dir.removeEntry(id); } catch {} }
  if (dir) try {                                    // reload the unexpired shelf; expired bodies clean themselves
    for await (const [name, h] of dir.entries()) {
      try { const rec = JSON.parse(await (await h.getFile()).text()); if (fresh(rec)) mem.set(rec.id, rec); else await dir.removeEntry(name); } catch {}
    }
  } catch {}

  // ── post: mint (id = κ of content) → shelf → fan to every contact over the sealed rail
  async function post({ kind, dataUrl = null, text = null, bg = null, caption = null }) {
    if (kind !== "photo" && kind !== "text") return { ok: false, error: "kind must be photo|text" };
    if (kind === "photo" && (!dataUrl || String(dataUrl).length > MAX_DATAURL)) return { ok: false, error: "photo missing or too large — downscale to ≤1080px JPEG first" };
    if (kind === "text" && !(text || "").trim()) return { ok: false, error: "text story needs text" };
    const story = { v: 1, kind, dataUrl: kind === "photo" ? dataUrl : null, text: text ? String(text).slice(0, MAX_TEXT) : null,
      bg: bg || null, caption: caption ? String(caption).slice(0, MAX_TEXT) : null, at: now(), ttl: ttlMs, author: mySign, name: myName() };
    story.id = await idOf(story);
    await _save({ ...story, mine: true, seen: true, viewers: {} }); ping();
    let fan = { sent: 0, contacts: 0 };
    try { fan = await hd.postStory(story); } catch {}
    return { ok: true, id: story.id, ...fan };
  }

  // ── ingest: the door already verified the sender; we re-derive the κ and enforce author = sealed sender
  async function ingest({ contactId, sign, frame }) {
    if (frame.t === "story") {
      const s = frame.story;
      if (!s || s.v !== 1 || s.author !== sign || !fresh(s)) return;
      if (String(s.dataUrl || "").length > MAX_DATAURL || String(s.text || "").length > MAX_TEXT) return;
      if ((await idOf(s)) !== s.id) return;         // Law L5: a story that does not re-derive does not exist
      if (mem.has(s.id)) return;                    // mailbox redelivery is idempotent
      await _save({ ...s, authorCid: contactId || null, mine: false, seen: false, viewers: {} }); ping();
    } else if (frame.t === "story-ack") {
      const rec = mem.get(frame.id);
      if (rec && rec.mine && sign) { rec.viewers[sign] = frame.ts || now(); await _save(rec); ping(); }
    } else if (frame.t === "story-revoke") {
      const rec = mem.get(frame.id);
      if (rec && rec.author === sign && !rec.mine) { await _drop(frame.id); ping(); }
    }
  }
  hd.onStory((ev) => { ingest(ev).catch(() => {}); });

  // ── the feed: "me" first, then authors by their newest story (WhatsApp's Recent ordering); expired never renders
  function feed() {
    const groups = new Map();
    for (const s of mem.values()) { if (!fresh(s)) continue; const k = s.mine ? "me" : s.author; (groups.get(k) || groups.set(k, []).get(k)).push(s); }
    for (const g of groups.values()) g.sort((a, b) => a.at - b.at);
    const entries = [...groups.entries()].sort(([ka, a], [kb, b]) => (ka === "me" ? -1 : kb === "me" ? 1 : b[b.length - 1].at - a[a.length - 1].at));
    return new Map(entries);
  }
  const unseenCount = () => { let n = 0; for (const s of mem.values()) if (fresh(s) && !s.mine && !s.seen) n++; return n; };

  async function markSeen(id) {
    const rec = mem.get(id); if (!rec || rec.mine || rec.seen) return;
    rec.seen = true; await _save(rec); ping();
    try { await hd.storyCtl(rec.authorCid || rec.author, { t: "story-ack", id, ts: now() }); } catch {}
  }
  async function revoke(id) {
    const rec = mem.get(id); if (!rec || !rec.mine) return { ok: false, error: "not yours" };
    await _drop(id); ping();
    try { await hd.storyFan({ t: "story-revoke", id, ts: now() }); } catch {}
    return { ok: true };
  }
  const viewersOf = (id) => { const rec = mem.get(id); return rec && rec.mine ? Object.entries(rec.viewers).map(([sign, ts]) => ({ sign, ts })) : []; };

  const sweep = setInterval(() => { let dropped = 0; for (const [id, s] of mem) if (!fresh(s)) { _drop(id); dropped++; } if (dropped) ping(); }, 60000);
  return { post, feed, unseenCount, markSeen, revoke, viewersOf, mySign,
    onChange: (cb) => { subs.add(cb); return () => subs.delete(cb); },
    _ingest: ingest,                                // witness door (drives frames without a live wire)
    destroy: () => { clearInterval(sweep); subs.clear(); } };
}

// singleton for the app surface — one shelf, one subscription, however many React renders
let _engine = null;
export function getStatusEngine(opts) { return (_engine = _engine || createStatusEngine(opts)); }
