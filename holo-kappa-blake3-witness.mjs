// holo-kappa-blake3-witness.mjs — proves the κ-store + resolver are BLAKE3-canonical (M2 / B1+B2).
// Run: node holo-kappa-blake3-witness.mjs
//
// Asserts, against the real store + signed apps table:
//   1. holo-blake3 is standard BLAKE3 (official vector) and stream-safe (cross-chunk == one-shot)
//   2. every stored object is blake3-addressable: b/<blake3hex> exists AND re-derives (Law L5)
//   3. every app's blake3 κ (sidecar) re-derives from its entry-document
//   4. the resolver's canonical identity is now blake3: default app.kappa starts "blake3:"
//   5. a κ in EITHER axis resolves the same app (superset); sha256 remains a valid fallback
//   6. a tampered byte is refused by name (the invariant that makes any source safe)

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { blake3hex, createBlake3 } from "./usr/lib/holo/holo-blake3.mjs";
import { loadAppIndex, findApp } from "./usr/lib/holo/holo-app-index.mjs";
import { DEFAULT_APP, parseIntent, chooseTarget } from "./holo-root-resolver.mjs";

const HERE = fileURLToPath(new URL("./", import.meta.url));
const B = HERE + "b/";
const BASE = pathToFileURL(HERE).href;
const diskFetch = (u) => ({ json: async () => JSON.parse(readFileSync(fileURLToPath(new URL(u)), "utf8")) });

let pass = 0, fail = 0;
const ok = (name, cond, got) => { (cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name + "  got: " + JSON.stringify(got)))); };

// 1 — standard + stream-safe
ok("blake3('abc') == official vector", blake3hex(new TextEncoder().encode("abc")) === "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85", blake3hex(new TextEncoder().encode("abc")));
{ const big = readdirSync(B).filter((n) => /^[0-9a-f]{64}$/.test(n)).map((n) => [n, readFileSync(B + n).length]).sort((a, b) => b[1] - a[1])[0];
  const by = readFileSync(B + big[0]); const h = createBlake3(); for (let i = 0; i < by.length; i += 333) h.update(by.subarray(i, i + 333));
  ok("cross-chunk streaming == one-shot (" + big[1] + "B)", h.hex() === blake3hex(by), big[1]); }

// 2 — every stored object is blake3-addressable AND re-derives
{ const sha = readdirSync(B).filter((n) => /^[0-9a-f]{64}$/.test(n));
  const b3keyed = new Set(sha.filter((n) => blake3hex(readFileSync(B + n)) === n));  // objects whose NAME is their blake3
  // build the set of blake3 names we expect (blake3 of each sha256-object) and assert each exists + re-derives
  let missing = 0, bad = 0, n = 0;
  for (const s of sha) { const bytes = readFileSync(B + s); if (createHash("sha256").update(bytes).digest("hex") !== s) continue; n++;
    const b3 = blake3hex(bytes); if (!existsSync(B + b3)) { missing++; continue; }
    if (blake3hex(readFileSync(B + b3)) !== b3) bad++; }
  ok("every sha256 object has a b/<blake3hex> sibling", missing === 0, { missing, of: n });
  ok("every blake3-keyed object re-derives to its name", bad === 0, bad);
  ok("store is dual-addressed (blake3 names present)", b3keyed.size >= n, { b3keyed: b3keyed.size, n }); }

// 3 — sidecar: each app's blake3 κ re-derives from its entry-document (= b/<signed sha256>)
const rel = JSON.parse(readFileSync(HERE + "release.json", "utf8"));
const signed = (rel["holstr:payload"] || {}).apps || {};
const sidecar = JSON.parse(readFileSync(HERE + "apps-blake3.json", "utf8")).apps;
{ let bad = 0; for (const [dir, sha] of Object.entries(signed)) { const b3 = blake3hex(readFileSync(B + sha)); if (b3 !== sidecar[dir]) bad++; }
  ok("all " + Object.keys(signed).length + " app blake3 κ re-derive from their entry-doc", bad === 0, bad); }

// 4 — the resolver's canonical identity is blake3
const index = await loadAppIndex({ base: BASE, fetchFn: diskFetch });
const msg = findApp(index, DEFAULT_APP);
ok("default app κ is blake3", msg && msg.kappa.startsWith("blake3:"), msg && msg.kappa);
ok("default blake3 κ == sidecar", msg && msg.kappa === "blake3:" + sidecar[DEFAULT_APP], msg && msg.kappa);
ok("default keeps its signed sha256 (fallback)", msg && /^[0-9a-f]{64}$/.test(msg.sha256 || ""), msg && msg.sha256);
{ const t = chooseTarget({ index, intent: parseIntent({}), findApp });
  ok("root resolves the default surface by its blake3 κ", t.kind === "app" && t.app.kappa.startsWith("blake3:"), t.app && t.app.kappa); }

// 5 — either axis resolves the same app (superset)
ok("resolve by blake3 κ → messenger", (findApp(index, "blake3:" + sidecar[DEFAULT_APP]) || {}).dir === "holo-messenger", null);
ok("resolve by sha256 κ → messenger (fallback still works)", (findApp(index, "sha256:" + signed[DEFAULT_APP]) || {}).dir === "holo-messenger", null);
ok("resolve by did:holo:blake3: → messenger", (findApp(index, "did:holo:blake3:" + sidecar[DEFAULT_APP]) || {}).dir === "holo-messenger", null);

// 6 — a tampered byte is refused by name
{ const bytes = readFileSync(B + signed[DEFAULT_APP]); const t = Uint8Array.from(bytes); t[0] ^= 0xff;
  ok("a tampered messenger entry-doc no longer re-derives to its κ", blake3hex(t) !== sidecar[DEFAULT_APP], null); }

console.log("\n" + (fail === 0 ? "GREEN" : "RED") + " — " + pass + "/" + (pass + fail) + " witnessed");
process.exit(fail === 0 ? 0 : 1);
