// holo-dm.mjs - the DELIVERY layer for Holo Direct: how a sealed envelope (holo-seal.mjs) actually reaches someone.
// Fast path is P2P over the proven datachannel (holo-together-rtc) when both are online; this module adds the OFFLINE
// path via the blind mailbox (holo-mailbox connector). The mailbox is addressed by a `tag` both sides derive from the
// recipient's public box key - the store never learns the sender, the content, or the keys.

const _te = new TextEncoder();
const _subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || (typeof crypto !== "undefined" && crypto.subtle);
async function _sha256hex(s) { const h = await _subtle().digest("SHA-256", _te.encode(s)); return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

// the mailbox address for a recipient - derived from their PUBLIC box key, so the sender (who has it, to encrypt) and
// the recipient (who has their own) both compute the same opaque tag. Rotating per-conversation tags = a later refinement.
export async function mailboxTag(recipientBoxPub) { return _sha256hex("holo-mbox-v1|" + recipientBoxPub); }
// a DISTINCT lane over the same drop-box (e.g. "holo-rdv-v1" for rendezvous signaling - holo-rendezvous.mjs):
// dial traffic never mixes with message delivery, so each lane can poll at its own cadence.
export async function laneTag(lane, recipientBoxPub) { return _sha256hex(lane + "|" + recipientBoxPub); }

function _base(mailboxBase) { return mailboxBase || (typeof location !== "undefined" ? location.origin : ""); }

// ── the transport gate (N8/GL1): a STATIC origin (github.io) serves no /mbox — the same three verbs ride
// public Nostr relays instead (holo-dm-nostr.mjs, lazy: localhost/witness paths never load it). An explicit
// mailboxBase always wins (every witness passes one or runs on localhost — their behavior is untouched).
// `?net=nostr` forces the relay transport on localhost (the S2 witness drives the REAL live path with it);
// `?net=origin` forces HTTP back. Everything above this file — lane owners, glare, dual-path, poll — is
// transport-blind by construction.
let _nostrP = null;
const _nostr = () => (_nostrP || (_nostrP = import("./holo-dm-nostr.mjs")));
function _useNostr(mailboxBase) {
  if (mailboxBase || typeof location === "undefined") return false;
  try {
    const forced = new URLSearchParams(location.search).get("net");
    if (forced === "nostr") return true;
    if (forced === "origin") return false;
    return !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
  } catch { return false; }
}

// drop a sealed envelope for `recipientBoxPub` into the mailbox (recipient offline). `wire` = holo-seal.toWire(env).
// `tag` overrides the lane (default: the message lane derived from the recipient's box key).
export async function mailboxDrop(recipientBoxPub, wire, { mailboxBase = null, tag = null } = {}) {
  tag = tag || await mailboxTag(recipientBoxPub);
  if (_useNostr(mailboxBase)) return (await _nostr()).drop(tag, wire);
  const r = await fetch(_base(mailboxBase) + "/mbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, blob: wire }) });
  return r.json();
}
// pull every waiting blob for MY box key → [{ id, blob, ts }] (blob = the sealed wire; open with holo-seal.open).
export async function mailboxPull(myBoxPub, { mailboxBase = null, tag = null } = {}) {
  tag = tag || await mailboxTag(myBoxPub);
  if (_useNostr(mailboxBase)) return (await _nostr()).pull(tag);
  const r = await fetch(_base(mailboxBase) + "/mbox?tag=" + tag);
  const d = await r.json(); return (d && d.items) || [];
}
// acknowledge delivered blobs so the mailbox drops them (it holds nothing longer than it must; on relays,
// where a recipient cannot delete, ack = the durable seen-set — GL2, honest).
export async function mailboxAck(myBoxPub, ids, { mailboxBase = null, tag = null } = {}) {
  if (!ids || !ids.length) return { ok: true };
  tag = tag || await mailboxTag(myBoxPub);
  if (_useNostr(mailboxBase)) return (await _nostr()).ack(tag, ids);
  const r = await fetch(_base(mailboxBase) + "/mbox/ack", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, ids }) });
  return r.json();
}
// live push (N8/GL3, relay transport only): cb fires when a blob lands for me — the caller polls NOW
// instead of waiting its cadence. Returns unsubscribe, or null on the HTTP transport (no push there).
export async function mailboxLive(myBoxPub, cb, { mailboxBase = null, tag = null } = {}) {
  if (!_useNostr(mailboxBase)) return null;
  tag = tag || await mailboxTag(myBoxPub);
  return (await _nostr()).live(tag, cb);
}

// convenience: pull + open + ack in one call. Returns [{ id, result }] where result is holo-seal.open()'s output.
export async function receiveOffline(myKeys, myBoxPub, openFn, { mailboxBase = null, ackOnOpen = true } = {}) {
  const items = await mailboxPull(myBoxPub, { mailboxBase });
  const out = [], acked = [];
  for (const it of items) {
    let env = null; try { env = JSON.parse(it.blob); } catch {}
    const result = env ? await openFn(env, { myKeys }) : { ok: false, error: "corrupt" };
    out.push({ id: it.id, ts: it.ts, result });
    if (ackOnOpen && result.ok) acked.push(it.id);
  }
  if (acked.length) await mailboxAck(myBoxPub, acked, { mailboxBase });
  return out;
}
