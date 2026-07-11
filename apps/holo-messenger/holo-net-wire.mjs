// holo-net-wire.mjs — the seal⇄wire bridge: a sealed envelope (holo-seal) as BYTES for the spine's data
// channel (holo-net link.send / link.onFrame). This file does exactly one thing and stays under 50 lines:
// encryption/signing live in holo-seal, transport lives in holo-net — this is only the byte boundary.
// Wire input is hostile by definition: decode NEVER throws, it returns null and the caller drops the frame
// (the envelope's own three checks — κ, signature, AES-GCM — then refuse anything that survived a bad decode).

import { toWire, fromWire } from "./holo-seal.mjs?v=n8";

const _enc = new TextEncoder();
const _dec = new TextDecoder();

// envelope → Uint8Array for link.send()
export function wireEncode(env) { return _enc.encode(toWire(env)); }

// bytes off the channel → envelope, or null on garbage (drop the frame; never throw on wire input)
export function wireDecode(bytes) {
  try { return fromWire(_dec.decode(bytes)); } catch { return null; }
}
