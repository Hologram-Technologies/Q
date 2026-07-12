// holo-rungs.mjs — THE rung ladder (G0 of HOLO-GENESIS-SEED). ONE implementation of
// "resolve a κ from capacity, fail-closed" for every consumer (root-sw κ-route, the evicted-bytes
// rescue, and anything else that fetches by hash):
//
//     device κ-store  →  origin b/<hex>  →  mirror rungs (per axis, DATA not code)
//
// Every rung is UNTRUSTED capacity: a byte only ships after it re-derives to its κ (Law L5/SEC-1).
// Objects ≤ CAP are buffered + verified BEFORE serving — so a poisoned rung's bytes are refused and
// the ladder simply tries the NEXT rung (failover-before-serve), and verified bytes enter the device
// store with no tee gymnastics. Objects > CAP stream through the incremental verifier (fail-closed
// mid-stream; no failover once streaming — the pre-G0 semantics, kept only for the rare giant).
// sha256 > CAP has no streaming verifier: origin may stream it (origin = same-origin trust class),
// a mirror may NOT (refused).
//
// Rungs are DATA: BUILTIN_RUNGS is the bootstrap table; a `/rungs.json` at the bundle root
// ({ "blake3": ["https://…/b/"], "sha256": ["https://…/sha256/"] }) overrides per axis — adding
// capacity (IPFS gateway, a second mirror, a peer) is an append + reseal, zero code. rungs.json is
// deliberately LOW-stakes: it can only add/remove capacity, never corrupt a byte — verification is
// independent of where bytes came from. Fetch trouble → BUILTIN (fail-soft), lazy + memoized,
// restart-safe (no activate-time state; a restarted worker re-fetches once).
import { createBlake3 } from "./holo-blake3.mjs";

export const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  svg: "image/svg+xml", wasm: "application/wasm", html: "text/html", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", webp: "image/webp", woff2: "font/woff2", bin: "application/octet-stream" };

export const BUILTIN_RUNGS = {
  blake3: [
    "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/",
    "https://hologram-technologies.github.io/hologram-apps/b/",
  ],
  sha256: [
    "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/sha256/",
  ],
};

const CAP = 64 * 1024 * 1024;   // buffered-verify ceiling — everything in today's closures fits

export function makeLadder({ base = "", rung = null } = {}) {
  let _rungs = null, _rungsP = null;
  const rungs = () => _rungs || (_rungsP ||= fetch(base + "/rungs.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (_rungs = { ...BUILTIN_RUNGS, ...(j && typeof j === "object" && !Array.isArray(j) ? j : {}) }))
    .catch(() => { _rungsP = null; return BUILTIN_RUNGS; }));

  async function sha256hex(u8) {
    const d = await crypto.subtle.digest("SHA-256", u8);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const derive = async (axis, u8) => (axis === "blake3" ? (() => { const h = createBlake3(); h.update(u8); return h.hex(); })() : await sha256hex(u8));

  // incremental blake3 verifier for the >CAP streaming path (errors the stream on mismatch)
  function verifierFor(hex) {
    const h = createBlake3();
    return new TransformStream({
      transform(chunk, ctrl) { h.update(chunk); ctrl.enqueue(chunk); },
      flush(ctrl) { if (h.hex() !== hex) ctrl.error(new Error("κ mismatch — refused (L5): " + hex.slice(0, 12) + "…")); },
    });
  }

  const R = async () => { if (!rung) return null; try { return await rung(); } catch { return null; } };
  const headersFor = (ext, r) => ({ "content-type": MIME[ext] || (r && r.headers.get("content-type")) || "application/octet-stream" });

  // resolve(axis, hex, { ext, extraMirrors, skipOrigin }) →
  //   verified Response (200) · last MISS Response (a 404 the caller may pass through) · null (all rungs dead).
  // A response that reaches the caller with .ok either re-derived here or is the >CAP streaming path.
  async function resolve(axis, hex, { ext = "", extraMirrors = [], skipOrigin = false } = {}) {
    const store = await R();
    if (store) {   // O2: the device store answers first — warm boot must never add a network hop
      try { const u8 = await store.get(axis, hex); if (u8) return new Response(u8, { status: 200, headers: { ...headersFor(ext), "x-holo-source": "device-store", "x-holo-kappa": axis + ":" + hex } }); } catch {}
    }
    const table = await rungs();
    const bases = [...(skipOrigin ? [] : [base + "/b/"]), ...extraMirrors, ...(table[axis] || [])];
    let miss = null;
    for (let i = 0; i < bases.length; i++) {
      const origin = !skipOrigin && i === 0;
      let r = null;
      try { r = await fetch(bases[i] + hex); } catch { continue; }
      if (!r.ok) { miss = miss || r; continue; }
      const len = Number(r.headers.get("content-length") || 0);
      const headers = { ...headersFor(ext, r), "x-holo-kappa": axis + ":" + hex, "x-holo-source": origin ? "origin-b" : "rung-" + i };
      if (len > CAP || !r.body) {                              // the rare giant — pre-G0 semantics
        if (axis === "blake3" && r.body) return new Response(r.body.pipeThrough(verifierFor(hex)), { status: 200, headers });
        if (origin) return new Response(r.body, { status: 200, headers });   // origin sha256 giant: streamed, origin trust class
        store && store.witness && store.witness("kappa-rung-oversize", { axis, hex, rung: bases[i] });
        continue;                                              // mirror sha256 giant: unverifiable → next rung
      }
      let u8;
      try { u8 = new Uint8Array(await r.arrayBuffer()); } catch { continue; }
      if (u8.length > CAP) { if (origin && axis !== "blake3") return new Response(u8, { status: 200, headers }); continue; }
      if ((await derive(axis, u8)) !== hex) {                  // poisoned rung: refuse ITS bytes, try the next
        store && store.witness && store.witness("kappa-route-mismatch", { axis, want: hex, source: headers["x-holo-source"] });
        continue;
      }
      if (store) { try { store.put(axis, hex, u8); } catch {} }
      return new Response(u8, { status: 200, headers });
    }
    return miss;
  }

  return { resolve, rungs, verifierFor };
}
