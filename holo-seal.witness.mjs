// holo-seal.witness.mjs — the spine identity: unseal(seal(x)) === x, byte-exact, plus honest edges.
// Run from the bundle root: node holo-seal.witness.mjs   (offline; OPFS absent in node → held:false honest)
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { seal, unseal } = await import("./usr/lib/holo/holo-seal.mjs");
const { blake3hex } = await import("./usr/lib/holo/holo-blake3.mjs");

let pass = 0, fail = 0;
const T = (n, ok, x = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// W1 — identity across the corpus (text · json-ld · binary · a real wasm slice)
import fs from "node:fs";
const wasm = new Uint8Array(fs.readFileSync("usr/lib/holo/holowhat/holospaces_web_bg.wasm")).slice(0, 200000);
const CORPUS = [
  ["text", new TextEncoder().encode("the link IS the file — sealed at " + "x".repeat(2000))],
  ["json-ld", new TextEncoder().encode(JSON.stringify({ "@context": "https://schema.org", name: "κ", n: [...Array(500).keys()] }))],
  ["binary", (() => { const b = new Uint8Array(50000); for (let o = 0; o < b.length; o += 65536) crypto.getRandomValues(b.subarray(o, Math.min(o + 65536, b.length))); return b; })()],
  ["wasm-200k", wasm],
];
for (const [label, bytes] of CORPUS) {
  const s = await seal(bytes, { name: label, base: "https://hologram-technologies.github.io/Q/" });
  if (!s.link) { T(`W1 ${label} identity`, false, "no link (unexpected ceiling)"); continue; }
  const u = await unseal(s.link.url);
  T(`W1 ${label} identity`, !u.error && eq(u.bytes, bytes) && u.kappa === s.kappa, `${bytes.length}B → ${s.link.chars} chars (${s.link.tier}) → byte-exact, κ match`);
}

// W2 — κ is the canonical blake3 of the exact bytes
{
  const b = new TextEncoder().encode("attribute-addressed");
  const s = await seal(b);
  T("W2 κ = blake3(bytes)", s.kappa === "blake3:" + (await blake3hex(b)));
}

// W3 — the ceiling declines HONESTLY (incompressible > LINK_PAYLOAD_MAX → link:null, never truncated)
{
  const big = new Uint8Array(700000);
  for (let o = 0; o < big.length; o += 65536) crypto.getRandomValues(big.subarray(o, Math.min(o + 65536, big.length)));
  const s = await seal(big);
  T("W3 ceiling honest", s.link === null && s.kappa.startsWith("blake3:"), `${big.length}B incompressible → link:null (κ still minted)`);
}

// W4 — a tampered link cannot deliver bytes (carry's sha256 re-derive = L5 on the wire)
{
  const s = await seal(new TextEncoder().encode("do not tamper"), { name: "t" });
  const evil = s.link.url.replace(/#recv=1\.([0-9a-f]{8})/, (m, h) => "#recv=1." + (h[0] === "0" ? "1" : "0") + h.slice(1));
  const u = await unseal(evil);
  T("W4 tampered link refused", u.error === "verify" && !u.bytes);
}

// W5 — qr tier for small payloads (scan = receive)
{
  const s = await seal(new TextEncoder().encode("tiny"), { base: "https://x.y/" });
  T("W5 qr tier small", s.link.tier === "qr" && s.link.chars <= 2300, s.link.chars + " chars");
}

console.log(`\n${pass}/${pass + fail} green${fail ? " — " + fail + " RED" : ""}`);
process.exit(fail ? 1 : 0);
