// hashfix.mjs — real SYNCHRONOUS crypto for the vendored gramjs browser build.
//
// gramjs speaks MTProto with Node-style `crypto.createHash/createHmac/pbkdf2Sync`, all SYNCHRONOUS. The esm.sh
// bundle shimmed Node's `crypto` with unenv (m4.mjs), which left exactly those as throwing stubs
// ("[unenv] crypto.createHash is not implemented yet"). WebCrypto can't rescue them — `subtle.digest` is async,
// and gramjs hashes inline during the auth-key / msg-key path. So the whole encrypted session never establishes
// (connect() completes the plaintext handshake, then every encrypted invoke hangs).
//
// Fix: bind the audited, dependency-free @noble/hashes (vendored self-contained in ./noble/) into Node-shaped
// helpers. No hand-rolled crypto — noble owns SHA-1/256/512, HMAC, PBKDF2; this file is only the Node-API adapter
// (update()/digest() chaining, Buffer-returning digests) that m4.mjs re-exports in place of the stubs.
import { sha1 } from "./noble/sha1.bundle.mjs";
import { sha256 } from "./noble/sha256.bundle.mjs";
import { sha512 } from "./noble/sha512.bundle.mjs";
import { hmac } from "./noble/hmac.bundle.mjs";
import { pbkdf2 as noblePbkdf2 } from "./noble/pbkdf2.bundle.mjs";

const HASHERS = { sha1, "sha-1": sha1, sha256, "sha-256": sha256, sha512, "sha-512": sha512 };
const pick = (alg) => { const h = HASHERS[String(alg || "").toLowerCase()]; if (!h) throw new Error("hashfix: unsupported hash " + alg); return h; };
const bytes = (d) => typeof d === "string" ? new TextEncoder().encode(d) : (d instanceof Uint8Array ? d : new Uint8Array(d.buffer || d));
const asBuf = (u8) => (globalThis.Buffer ? globalThis.Buffer.from(u8) : u8);
const hex = (u8) => { let s = ""; for (const b of u8) s += b.toString(16).padStart(2, "0"); return s; };
const out = (u8, enc) => (enc === "hex" ? hex(u8) : enc === "base64" ? asBuf(u8).toString("base64") : asBuf(u8));

// Node's createHash(alg).update(data).digest([enc]) — synchronous, chainable, Buffer by default.
export function createHash(alg) {
  const h = pick(alg).create();
  return { update(d) { h.update(bytes(d)); return this; }, digest(enc) { return out(h.digest(), enc); } };
}
// Node's createHmac(alg, key).update(data).digest([enc]) — used by Telegram SRP (2FA) + general MTProto helpers.
export function createHmac(alg, key) {
  const h = hmac.create(pick(alg), bytes(key));
  return { update(d) { h.update(bytes(d)); return this; }, digest(enc) { return out(h.digest(), enc); } };
}
// Node's pbkdf2Sync(pass, salt, iterations, keylen, digest) — Telegram 2FA cloud-password (SRP) key derivation.
export function pbkdf2Sync(pass, salt, iterations, keylen, digest) {
  return asBuf(noblePbkdf2(pick(digest || "sha512"), bytes(pass), bytes(salt), { c: iterations, dkLen: keylen }));
}
// Node's async pbkdf2(...) → callback(err, derivedKey). Kept for API-shape parity; SRP uses the sync path.
export function pbkdf2(pass, salt, iterations, keylen, digest, cb) {
  try { const r = pbkdf2Sync(pass, salt, iterations, keylen, digest); queueMicrotask(() => cb(null, r)); }
  catch (e) { queueMicrotask(() => cb(e)); }
}
