// holo-runtime.mjs — the upstream holospace runtime, resolved BY ITS κ (never by a path).
//
// Law L4 (everything through the substrate): the runtime that verifies content must itself arrive as
// verified content. Until now the wasm runtime (holospaces_web glue + wasm) was imported by PATH and
// executed unverified — the one component the resolver trusted on location. This module closes that:
//
//   holo-runtime.json (root)  =  ONE Ed25519-SIGNED POINTER  { name, channel, seq, assets{glue,wasm} }
//                                 each asset = { blake3, sha256, bytes, hint }  — κ is the truth,
//                                 the hint path is only a place to look (SEC-6: verify against the κ,
//                                 never trust the reference).
//
//   loadRuntime()             =  pointer → verify signature → resolve each asset (CacheStorage κ-tier
//                                 first — L3, the store is the memory — then the hint path) → RE-DERIVE
//                                 blake3 before a single byte executes (L5/SEC-1) → import the glue from
//                                 a blob URL → init the wasm FROM THE VERIFIED BYTES (wasm-bindgen
//                                 module_or_path accepts BufferSource — the glue never fetches on its own).
//
// Bumping the runtime = re-signing the pointer at a new seq with new κs. No consumer changes, no app
// re-seal, no Q re-bundle: every surface that resolves the runtime through here picks the new engine up
// on its next load. That is "downstream dependency" made literal (SEC-3: one runtime, resolved once,
// shared — the per-copy skew this replaces had three different builds in one tree).
//
// Fail-closed: bad signature, missing asset, or κ mismatch → throw (callers fall back to the pure-JS
// hasher ladder exactly as before — the runtime is an upgrade, never a dependency for correctness).

import { jcs } from "./holo-object.mjs";
import { blake3hex } from "./holo-blake3.mjs";

const te = new TextEncoder();
const CACHE = "holo-runtime-v1";                      // CacheStorage bucket: κ-keyed, immutable entries
const PTR_LS = "holo-runtime/pointer";                // last verified pointer (offline fallback)

const b64u8 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");

// ── the pointer ────────────────────────────────────────────────────────────────────────────────────────

async function verifyPointer(doc) {
  if (!doc || !doc.payload || !doc.sig || !doc.pub || doc.alg !== "Ed25519") throw new Error("runtime-pointer: malformed");
  const key = await crypto.subtle.importKey("raw", b64u8(doc.pub), { name: "Ed25519" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64u8(doc.sig), te.encode(jcs(doc.payload)));
  if (!ok) throw new Error("runtime-pointer: signature does not verify");
  const p = doc.payload;
  for (const k of ["glue", "wasm"]) {
    const a = p.assets && p.assets[k];
    if (!a || !/^[0-9a-f]{64}$/.test(a.blake3 || "") || !a.hint) throw new Error(`runtime-pointer: asset ${k} malformed`);
  }
  return p;
}

export async function fetchPointer({ base, fetchFn = null } = {}) {
  const f = fetchFn || fetch.bind(globalThis);
  const url = new URL("holo-runtime.json", base).href;
  try {
    const r = await f(url, { cache: "no-cache" });                       // a pointer is MUTABLE: revalidate
    if (!r.ok) throw new Error(`pointer http ${r.status}`);
    const doc = await r.json();
    const p = await verifyPointer(doc);
    try { localStorage.setItem(PTR_LS, JSON.stringify(doc)); } catch {}
    return p;
  } catch (e) {
    // offline / rung down → the LAST VERIFIED pointer still opens the runtime (verified again below)
    let saved = null; try { saved = JSON.parse(localStorage.getItem(PTR_LS) || "null"); } catch {}
    if (saved) return verifyPointer(saved);
    throw e;
  }
}

// ── κ-resolve one asset: store tier, then the hint — every byte re-derives (L5) ───────────────────────

async function resolveAsset(a, { base, fetchFn }) {
  const f = fetchFn || fetch.bind(globalThis);
  const key = `/.holo/blake3/${a.blake3}`;                               // the store speaks κ, not paths
  let store = null;
  try { store = await caches.open(CACHE); } catch {}                     // no CacheStorage (node/private) → network only
  if (store) {
    const hit = await store.match(key);
    if (hit) return new Uint8Array(await hit.arrayBuffer());             // admitted-verified once (L3)
  }
  const r = await f(new URL(a.hint, base).href);
  if (!r.ok) throw new Error(`runtime asset ${a.blake3.slice(0, 12)}…: hint http ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  const got = await blake3hex(bytes);
  if (got !== a.blake3) throw new Error(`runtime asset REFUSED: re-derived ${got.slice(0, 12)}… ≠ pinned ${a.blake3.slice(0, 12)}… (L5)`);
  if (store) { try { await store.put(key, new Response(bytes, { headers: { "x-holo-kappa": `blake3:${a.blake3}` } })); } catch {} }
  return bytes;
}

// ── load: pointer → verified bytes → module (one flight per document — SEC-3) ─────────────────────────

let _flight = null;

export function loadRuntime({ base, fetchFn = null } = {}) {
  return (_flight ||= (async () => {
    const p = await fetchPointer({ base, fetchFn });
    const [glue, wasm] = await Promise.all([
      resolveAsset(p.assets.glue, { base, fetchFn }),
      resolveAsset(p.assets.wasm, { base, fetchFn }),
    ]);
    // Import the VERIFIED glue bytes — blob: in the browser; data: where blob imports are refused
    // (node witnesses). Either way the module graph never touches the hint path again.
    let mod = null, url = null;
    try {
      url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
      mod = await import(/* @vite-ignore */ url);
    } catch {
      let b64; try { b64 = Buffer.from(glue).toString("base64"); }
      catch { let s = ""; for (let i = 0; i < glue.length; i += 0x8000) s += String.fromCharCode.apply(null, glue.subarray(i, i + 0x8000)); b64 = btoa(s); }
      mod = await import(/* @vite-ignore */ "data:text/javascript;base64," + b64);
    } finally { if (url) URL.revokeObjectURL(url); }
    if (mod.default) await mod.default({ module_or_path: wasm });        // wasm from OUR verified bytes
    return { module: mod, meta: { name: p.name, channel: p.channel, seq: p.seq, glue: p.assets.glue.blake3, wasm: p.assets.wasm.blake3 } };
  })().catch((e) => { _flight = null; throw e; }));                      // a failed flight never sticks
}

// The shape holo-names-host's wasmGlue option wants: an async () => module with kappa()/verify_kappa().
export const runtimeModule = (opts) => loadRuntime(opts).then((r) => r.module);
