// holo-names-host.mjs — THE ONE HOST BINDING for the universal resolver (I1 of the instant milestone,
// E1 of the Q-is-the-resolver fusion). holo-names.mjs stays pure and injected; THIS is the only place
// a browser wires it to the real world — every surface (inspector, omnibox, κ-paste, launcher) builds
// its resolver HERE, and per-page wiring is deleted (L4).
//
//   makeHostResolver({ base, wasmGlue?, fetchFn?, lruSize? }) → { resolve, resolveOrExplain, classify, stats }
//
//   TIER 0 — THE LOCAL STORE (L3): CacheStorage is consulted BEFORE any network rung exists — a warm
//   object fires ZERO requests (latency AND privacy: warm resolves are invisible to every mirror).
//   TIER 1 — THE RACE: `/.holo/<axis>/<hex>` (root-sw) · `b/<hex>` (static) · the HF κ-mirror — the
//   pure verb races them; first bytes that RE-DERIVE win (SEC-1).
//   HASHERS by size, never by hope: sha256 = subtle · blake3 ≤256KB = holo-blake3 pure JS · >256KB =
//   the UPSTREAM RUNTIME's own kappa() (wasmGlue, lazy — downstream consumption made literal); no
//   glue → pure JS still verifies: slow is acceptable, unverified never is (L5).
//
// Glue only (≤5KB). Nothing here can widen what the verb admits — caps attenuate per call (SEC-2/5),
// refusals stay named, the LRU stays bounded (SEC-8).

import { makeNameResolver, classify, AXES } from "./holo-names.mjs";

const hex2 = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
export const SMALL = 262144;   // ≤256KB: hash on the calling thread without jank (I0-measured line)

export function makeHostResolver({ base, wasmGlue = null, fetchFn = null, lruSize = 256, mirrors = null } = {}) {
  const BASE = base ? new URL(String(base)) : (typeof location !== "undefined" ? new URL("./", location.href) : null);
  if (!BASE) throw new Error("makeHostResolver needs base (the bundle root URL)");
  const rawFetch = fetchFn || ((u, o) => fetch(u, o));

  let _b3 = null, _wasm = null;
  const b3small = async (b) => { if (!_b3) _b3 = (await import("./holo-blake3.mjs")).blake3hex; return _b3(b); };
  const hashers = {
    sha256: async (b) => hex2(await crypto.subtle.digest("SHA-256", b)),
    blake3: async (b) => {
      if (b.length > SMALL && wasmGlue) {
        try {
          if (!_wasm) { const m = await import(/* @vite-ignore */ wasmGlue); if (m.default) await m.default(); _wasm = m; }
          return String(_wasm.kappa(b)).replace(/^blake3:/, "");
        } catch {}
      }
      return b3small(b);
    },
  };

  const spellings = (axis, hex) => [new URL("b/" + hex, BASE).href, new URL(".holo/" + axis + "/" + hex, BASE).href];
  const RUNGS = mirrors || [
    { name: "origin", url: ({ axis, hex }) => new URL(".holo/" + axis + "/" + hex, BASE).href },
    { name: "origin-b", url: ({ axis, hex }) => (axis === "sha256" ? new URL("b/" + hex, BASE).href : null) },
    { name: "hf-mirror", url: ({ axis, hex }) => (axis === "sha256" ? "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/" + hex : null) },
  ];
  const store = { name: "store", url: ({ axis, hex }) => "cache://" + axis + "/" + hex };
  const storeFetch = async (url) => {   // TIER 0: CacheStorage only; a miss is silence, never a request
    const m = /^cache:\/\/([^/]+)\/([0-9a-f]+)$/.exec(String(url));
    if (!m || typeof caches === "undefined") return { ok: false };
    try { for (const s of spellings(m[1], m[2])) { const hit = await caches.match(s, { ignoreSearch: true }); if (hit && hit.ok) return hit; } } catch {}
    return { ok: false };
  };

  const R0 = makeNameResolver({ fetchFn: storeFetch, hashers, mirrors: [store], lruSize });
  const R1 = makeNameResolver({ fetchFn: rawFetch, hashers, mirrors: RUNGS, lruSize });

  // THE WARM CACHE (L3 — the store IS the memory). A once-resolved object lives here keyed by its κ; a
  // repeat resolve is a SYNCHRONOUS Map hit (~µs) that fires ZERO network AND skips the async store probe
  // (caches.match is hundreds of µs — it must never be on the warm path). Bounded (SEC-8). Cold falls
  // through: TIER 0 store (0-egress if the SW cached it) → TIER 1 the raced network rungs.
  const warm = new Map();                                  // "axis:hex" → { kind, kappa, bytes }
  const bump = (k, v) => { if (warm.has(k)) warm.delete(k); warm.set(k, v); if (warm.size > lruSize) warm.delete(warm.keys().next().value); };
  const warmKeyOf = (rec) => {                             // the κ a content-derived name commits to
    const hex = rec.hex || (rec.kappa ? rec.kappa.split(":").pop() : null);
    if (!hex) return null;
    const axis = rec.axis || (rec.kappa ? rec.kappa.split(":")[0] : null);
    return (axis || "*") + ":" + hex;                      // bare hex: axis unknown until resolved → probe both
  };

  async function resolve(name, caps = null) {
    if (!caps) {                                           // caps present → honor attenuation, skip the warm shortcut
      const rec = classify(name);
      if (rec && (rec.kappa || rec.hex)) {
        const k = warmKeyOf(rec);
        let hit = k && warm.get(k);
        if (!hit && rec.hex && !rec.axis) for (const a of Object.keys(AXES)) { hit = warm.get(a + ":" + rec.hex); if (hit) break; }   // bare hex: any axis
        if (hit) return { ok: true, kind: hit.kind, kappa: hit.kappa, bytes: hit.bytes, source: "warm" };
      }
    }
    let r = await R0.resolve(name, caps);                  // TIER 0: local store (SW/OPFS), 0-egress
    if (!(r.ok || r.needsIngest || r.kind === "refused" || r.kind === "host-owned" || r.why === "kind-not-admitted")) r = await R1.resolve(name, caps);   // TIER 1: the raced rungs
    if (r.ok && r.kappa && !caps) bump(r.kappa, { kind: r.kind, kappa: r.kappa, bytes: r.bytes });
    return r;
  }

  // the surface-facing sugar: one honest sentence for every non-ok outcome (V-MAGIC — never a term to learn)
  async function resolveOrExplain(name, caps = null) {
    const r = await resolve(name, caps);
    if (r.ok) return r;
    r.explain = r.needsIngest
      ? "This names a place, not bytes — opening it goes through its own door (web, chain, or IPFS)."
      : r.kind === "host-owned"
        ? "This belongs to the open web — the browser opens it."
        : r.kind === "refused"
          ? "Refused: " + (r.why || "this name cannot be verified.")
          : "No source could produce bytes that re-derive to this name — nothing unverified is ever shown.";
    return r;
  }

  return { resolve, resolveOrExplain, classify, stats: () => ({ warm: warm.size, store: R0.stats().cached, net: R1.stats().cached }), AXES };
}

export default { makeHostResolver, SMALL };
