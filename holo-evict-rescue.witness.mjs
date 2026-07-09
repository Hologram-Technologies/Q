// holo-evict-rescue.witness.mjs — proves the shared rescue: apps + TREES, restart-safe, fail-closed.
// Run from the bundle root: node holo-evict-rescue.witness.mjs   (offline; fetch is injected)
import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { blake3hex } = await import("./usr/lib/holo/holo-blake3.mjs");
const { makeEvictRescue } = await import("./usr/lib/holo/holo-evict-rescue.mjs");

let pass = 0, fail = 0;
const T = (n, ok, x = "") => { (ok ? pass++ : fail++); console.log(`${ok ? "✓" : "✗"} ${n}${x ? " — " + x : ""}`); };
const te = new TextEncoder();

const appBytes = te.encode("app file bytes");
const treeBytes = te.encode("tree file bytes — voice vendor blob");
const appHex = await blake3hex(appBytes), treeHex = await blake3hex(treeBytes);
const MIRROR = "https://mirror.test/b/";

const WORLD = {
  "/evicted.json": JSON.stringify({ apps: ["gone"], trees: [{ prefix: "_shared/voice/vendor/", closure: "_shared/voice/holo-evicted.json" }] }),
  "/apps/gone/holo-evicted.json": JSON.stringify({ axis: "blake3", mirror: MIRROR, files: { "index.html": appHex } }),
  "/_shared/voice/holo-evicted.json": JSON.stringify({ axis: "blake3", mirror: MIRROR, files: { "kokoro/model.bin": treeHex } }),
};
const BLOBS = { [MIRROR + appHex]: appBytes, [MIRROR + treeHex]: treeBytes };
let tamper = false;

globalThis.fetch = async (input) => {
  const u = typeof input === "string" ? input : input.url;
  if (BLOBS[u]) { let b = BLOBS[u]; if (tamper) { b = b.slice(); b[0] ^= 0xff; }
    return new Response(new Blob([b]).stream(), { status: 200 }); }
  const p = u.replace(/^https?:\/\/[^/]+/, "");
  if (WORLD[p]) return new Response(WORLD[p], { status: 200 });
  return new Response("origin:" + p, { status: 200, headers: { "x-origin": "1" } });   // origin fallback marker
};
const drain = async (res) => { const rd = res.body.getReader(); const parts = []; for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(...value); } return new Uint8Array(parts); };

// T1 app rescue serves + verifies (registry resolved first = sync fast path)
{
  const R = makeEvictRescue({ base: "" });
  await R.registry();
  const cand = R.matchSync("/apps/gone/index.html");
  const res = await R.rescue(new Request("https://x/apps/gone/index.html"), cand);
  const got = await drain(res);
  T("T1 app rescue via sync path", !!cand && res.headers.get("x-holo-kappa") === "blake3:" + appHex && (await blake3hex(got)) === appHex);
}
// T2 TREE rescue serves + verifies
{
  const R = makeEvictRescue({ base: "" });
  await R.registry();
  const cand = R.matchSync("/_shared/voice/vendor/kokoro/model.bin");
  const res = await R.rescue(new Request("https://x/_shared/voice/vendor/kokoro/model.bin"), cand);
  T("T2 tree rescue (evicted TREES grammar)", !!cand && cand.kind === "tree" && (await blake3hex(await drain(res))) === treeHex);
}
// T3 tampered mirror bytes → stream ERRORS (fail-closed, L5)
{
  const R = makeEvictRescue({ base: "" });
  await R.registry(); tamper = true;
  const res = await R.rescue(new Request("https://x/apps/gone/index.html"), R.matchSync("/apps/gone/index.html"));
  let refused = false; try { await drain(res); } catch (e) { refused = /refused|mismatch/i.test(String(e)); }
  tamper = false;
  T("T3 tampered bytes refused mid-stream", refused);
}
// T4 RESTART: fresh instance, fetch BEFORE registry resolves — tentative match, correct rescue
{
  const R = makeEvictRescue({ base: "" });                       // registry NOT awaited = restarted worker
  const capp = R.matchSync("/apps/gone/index.html");
  const ctree = R.matchSync("/_shared/voice/vendor/kokoro/model.bin");
  const res = await R.rescue(new Request("https://x/apps/gone/index.html"), capp);
  const res2 = ctree ? await R.rescue(new Request("https://x/_shared/voice/vendor/kokoro/model.bin"), ctree) : null;
  T("T4 restart-safe (registry unknown → still rescues)", !!capp && (await blake3hex(await drain(res))) === appHex && !!res2 && (await blake3hex(await drain(res2))) === treeHex);
}
// T5 non-evicted app → passthrough to origin
{
  const R = makeEvictRescue({ base: "" });
  await R.registry();
  const cand = R.matchSync("/apps/still-here/index.html");
  const viaAsync = makeEvictRescue({ base: "" });                // and via the restart path
  const res = await viaAsync.rescue(new Request("https://x/apps/still-here/index.html"), viaAsync.matchSync("/apps/still-here/index.html"));
  T("T5 non-evicted passes through", cand === null && res.headers.get("x-origin") === "1");
}
// T6 closure lacks the file → passthrough
{
  const R = makeEvictRescue({ base: "" });
  await R.registry();
  const res = await R.rescue(new Request("https://x/apps/gone/missing.js"), R.matchSync("/apps/gone/missing.js"));
  T("T6 file not in closure → origin fallback", res.headers.get("x-origin") === "1");
}

console.log(`\n${pass}/${pass + fail} green${fail ? " — " + fail + " RED" : ""}`);
process.exit(fail ? 1 : 0);
