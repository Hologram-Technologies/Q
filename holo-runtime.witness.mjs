// holo-runtime.witness.mjs — proves the runtime pointer: signed, κ-true, fail-closed, bump-able.
// Run: node holo-runtime.witness.mjs   (from the bundle root; offline — no network, fetch is injected)
//
// W1  pointer parses + Ed25519 signature verifies over JCS(payload)
// W2  a tampered payload (seq flip) REFUSES — the pointer cannot be silently rewritten
// W3  both assets at their hints RE-DERIVE to the pinned blake3 κs (and sha256 cross-checks)
// W4  a tampered asset byte REFUSES at load (L5/SEC-1) — the runtime never executes unverified
// W5  loadRuntime resolves pointer→bytes through injected fetch; glue+wasm bytes = pinned κs
// W6  THE BUMP: a seq-2 pointer naming DIFFERENT κs (the lean holowhat build) makes the SAME
//     loader return the NEW bytes — zero consumer changes. Runtime-by-reference, proven.
// W7  names-host accepts a function wasmGlue (the weld shape) and uses its kappa()

import fs from "node:fs";
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { jcs } = await import("./usr/lib/holo/holo-object.mjs");
const { blake3hex } = await import("./usr/lib/holo/holo-blake3.mjs");
const te = new TextEncoder();
const b64u8 = (s) => Uint8Array.from(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64"));

let pass = 0, fail = 0;
const T = (name, ok, extra = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const doc = JSON.parse(fs.readFileSync("holo-runtime.json", "utf8"));

// W1 signature
const key = await crypto.subtle.importKey("raw", b64u8(doc.pub), { name: "Ed25519" }, false, ["verify"]);
const sigOk = await crypto.subtle.verify({ name: "Ed25519" }, key, b64u8(doc.sig), te.encode(jcs(doc.payload)));
T("W1 pointer signature verifies", sigOk, `seq=${doc.payload.seq} channel=${doc.payload.channel}`);

// W2 tamper the payload → must refuse
const evil = JSON.parse(JSON.stringify(doc.payload)); evil.seq = 99;
const evilOk = await crypto.subtle.verify({ name: "Ed25519" }, key, b64u8(doc.sig), te.encode(jcs(evil)));
T("W2 tampered payload refused", !evilOk);

// W3 assets re-derive on both axes
for (const k of ["glue", "wasm"]) {
  const a = doc.payload.assets[k];
  const bytes = new Uint8Array(fs.readFileSync(a.hint));
  const b3 = await blake3hex(bytes);
  const sha = Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
  T(`W3 ${k} re-derives`, b3 === a.blake3 && sha === a.sha256 && bytes.length === a.bytes, `${a.bytes}B blake3 ${b3.slice(0, 12)}…`);
}

// A fetch that serves the repo tree (and lies when told to) — no network, no CacheStorage in node.
const fetchTree = (tamper = null) => async (url) => {
  const rel = String(url).replace(/^file:\/\/\/?|^https?:\/\/[^/]+\//, "").replace(/^.*?q-s1\//, "");
  const p = decodeURIComponent(rel.startsWith("holo-runtime.json") ? "holo-runtime.json" : rel);
  if (!fs.existsSync(p)) return { ok: false, status: 404 };
  let bytes = new Uint8Array(fs.readFileSync(p));
  if (tamper && p === tamper) { bytes = bytes.slice(); bytes[100] ^= 0xff; }
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer, json: async () => JSON.parse(Buffer.from(bytes).toString("utf8")) };
};

// W4/W5 via the REAL loader (blob import of 6MB wasm works in node 22; localStorage absent → guarded)
const BASE = "file:///" + process.cwd().replace(/\\/g, "/") + "/";
const rt = await import("./usr/lib/holo/holo-runtime.mjs");

// W4 tampered wasm refuses
try {
  await rt.loadRuntime({ base: BASE, fetchFn: fetchTree(doc.payload.assets.wasm.hint) });
  T("W4 tampered wasm asset refused", false);
} catch (e) { T("W4 tampered wasm asset refused", /REFUSED/.test(String(e)), String(e.message || e).slice(0, 60)); }

// W5 clean load returns the runtime with kappa()
let loaded = null;
try {
  loaded = await rt.loadRuntime({ base: BASE, fetchFn: fetchTree() });
  const probe = String(loaded.module.kappa(te.encode("holo"))).replace(/^blake3:/, "");
  const want = await blake3hex(te.encode("holo"));
  T("W5 loadRuntime → live kappa()", probe === want, `kappa("holo")=${probe.slice(0, 12)}… seq=${loaded.meta.seq}`);
} catch (e) { T("W5 loadRuntime → live kappa()", false, String(e.message || e).slice(0, 90)); }

// W6 THE BUMP — seq 2 names the lean holowhat build; same loader, new engine, no consumer change.
{
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["../seal-runtime-pointer.mjs", ".", "usr/lib/holo/holowhat/holospaces_web.js", "usr/lib/holo/holowhat/holospaces_web_bg.wasm", "resolver", "2"], { stdio: "pipe" });
  const doc2 = JSON.parse(fs.readFileSync("holo-runtime.json", "utf8"));
  try {
    // fresh module instance (the loader memoizes per-document) — same CODE, new pointer
    const rt2 = await import("./usr/lib/holo/holo-runtime.mjs?bump=1");
    const l2 = await rt2.loadRuntime({ base: BASE, fetchFn: fetchTree() });
    const bumped = l2.meta.seq === 2 && l2.meta.wasm === doc2.payload.assets.wasm.blake3 && l2.meta.wasm !== doc.payload.assets.wasm.blake3;
    const probe = String(l2.module.kappa(te.encode("holo"))).replace(/^blake3:/, "");
    const want = await blake3hex(te.encode("holo"));
    T("W6 pointer bump swaps the runtime (no consumer change)", bumped && probe === want, `wasm ${doc.payload.assets.wasm.blake3.slice(0, 8)}→${l2.meta.wasm.slice(0, 8)} kappa parity ✓`);
  } catch (e) { T("W6 pointer bump swaps the runtime (no consumer change)", false, String(e.message || e).slice(0, 90)); }
  // restore seq 1 (the shipped pointer)
  execFileSync(process.execPath, ["../seal-runtime-pointer.mjs", ".", doc.payload.assets.glue.hint, doc.payload.assets.wasm.hint, "resolver", "1"], { stdio: "pipe" });
}

// W7 names-host weld: a FUNCTION wasmGlue is invoked for >256KB blake3 — resolve a big object end-to-end.
{
  const { makeHostResolver } = await import("./usr/lib/holo/holo-names-host.mjs");
  const big = new Uint8Array(300 * 1024).map((_, i) => i & 0xff);
  const hex = await blake3hex(big);
  let used = false;
  const glue = async () => ({ kappa: (b) => { used = true; return "blake3:" + hex; } });   // κ-true, so re-derive passes
  const serveBig = async (url) => {
    if (String(url).includes(hex)) return { ok: true, status: 200, arrayBuffer: async () => big.buffer.slice(0) };
    return { ok: false, status: 404 };
  };
  const R = makeHostResolver({ base: "https://example.test/", wasmGlue: glue, fetchFn: serveBig });
  try {
    const res = await R.resolve("blake3:" + hex);
    T("W7 names-host uses function wasmGlue for >256KB blake3", !!res && used, `resolved ${((res && res.bytes && res.bytes.length) || 0)}B, glue invoked=${used}`);
  } catch (e) { T("W7 names-host uses function wasmGlue for >256KB blake3", false, String(e.message || e).slice(0, 80)); }
}

console.log(`\n${pass}/${pass + fail} green${fail ? " — " + fail + " RED" : ""}`);
process.exit(fail ? 1 : 0);
