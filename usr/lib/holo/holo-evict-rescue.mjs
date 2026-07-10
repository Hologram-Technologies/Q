// holo-evict-rescue.mjs — THE evicted-bytes rescue, shared by every service worker (root-sw, holo-sw).
//
// Bytes that leave Q for the κ-mirror still resolve, byte-identical, fail-closed (Law L5): a request
// under an evicted prefix is answered from the mirror BY ITS blake3 κ, streamed through an incremental
// verifier that errors the response on mismatch. One grammar, two shapes:
//
//   evicted.json  { apps:  ["player", …],                                  // apps/<app>/** rescued
//                   trees: [{ prefix: "_shared/voice/vendor/",             // ANY tree rescued
//                             closure: "_shared/voice/holo-evicted.json" }] }
//
//   closure (per app or tree) = { axis:"blake3", mirror:"https://…/b/", files:{ "<rel>": "<hex>" } }
//
// RESTART-SAFE by construction: the browser kills an idle worker and restarts it on the next fetch;
// "activate" fires once per VERSION — so nothing here depends on activate-time state. The registry and
// closures are lazy + memoized; a restarted worker re-fetches each once. (This class of bug shipped
// once: activate-only state made the rescue silently dead for long-lived registrations.)
//
// Scope-independent: pass the BUNDLE ROOT path (root-sw: its own dir; holo-sw: ../../ from its scope).
// SW fetch events fire for every request from a controlled client regardless of URL path, so a deeper-
// scope worker (the messenger's) rescues /apps/ui/* with the same module.

import { createBlake3 } from "./holo-blake3.mjs";

const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  svg: "image/svg+xml", wasm: "application/wasm", html: "text/html", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", webp: "image/webp", woff2: "font/woff2", bin: "application/octet-stream" };

export function makeEvictRescue({ base, blake3Import, rung } = {}) {
  // base = bundle-root pathname, no trailing slash ("" at a root mount, "/Q" on Pages subpath)
  // rung (O2, optional): async () => device-store rung | null — the persistent κ-store as a serving
  // tier. Store-first (an evicted byte already on the device serves with ZERO network); mirror wins
  // are INDEPENDENTLY re-derived (their own verifier pass) before entering the store. No rung, or any
  // rung trouble → exactly the pre-O2 behavior (fail-soft).
  let _reg = null;          // resolved { apps:Set, trees:[{prefix,closure}] } — sync fast path
  let _regP = null;         // in-flight (dedup)
  const registry = () => _reg || (_regP ||= fetch(base + "/evicted.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => (_reg = { apps: new Set(j.apps || []), trees: (j.trees || []).filter((t) => t && t.prefix && t.closure) }))
    .catch(() => { _regP = null; return { apps: new Set(), trees: [] }; }));

  const _closures = new Map();   // closureUrl → Promise<closure|null>
  const closure = (url) => {
    if (!_closures.has(url)) _closures.set(url, fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null));
    return _closures.get(url);
  };

  // O2 HARDENING: blake3 is a STATIC import now — dynamic import() is DISALLOWED in service workers
  // (spec), so the old lazy path could never load there and the verifier silently degraded to
  // passthrough (unverified mirror bytes — a live L5 hole). Static module-SW imports are cached with
  // the registration, so the verifier also exists with the radio dead. blake3Import stays accepted
  // for callers that inject their own (κ-resolved runtime), used only when it actually loads.
  let _b3 = null;
  async function verifierFor(wantHex) {
    if (_b3 === null) { if (blake3Import) { try { _b3 = (await blake3Import()).createBlake3; } catch { _b3 = createBlake3; } } else _b3 = createBlake3; }
    const h = _b3();
    return new TransformStream({
      transform(chunk, ctrl) { h.update(chunk); ctrl.enqueue(chunk); },
      flush(ctrl) { if (h.hex() !== wantHex) ctrl.error(new Error("κ mismatch — refused (L5): " + wantHex.slice(0, 12) + "…")); },
    });
  }

  // matchSync(pathname) → candidate | null. NON-BLOCKING: with the registry unresolved it returns a
  // tentative candidate for any apps/<x>/ path (resolved inside the async rescue — identical semantics,
  // one memoized registry fetch per worker lifetime).
  const appRe = new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/apps/([a-z0-9-]+)/(.+)$");
  function matchSync(p) {
    const m = p.match(appRe);
    if (m && m[2] !== "holo-evicted.json" && (_reg ? _reg.apps.has(m[1]) : true))
      return { kind: "app", key: m[1], rel: m[2].split("?")[0], closureUrl: base + "/apps/" + m[1] + "/holo-evicted.json" };
    if (_reg) {
      for (const t of _reg.trees) {
        const pref = base + "/" + t.prefix;
        if (p.startsWith(pref) && !p.endsWith("holo-evicted.json"))
          return { kind: "tree", key: t.prefix, rel: p.slice(pref.length).split("?")[0], closureUrl: base + "/" + t.closure };
      }
    } else if (p.startsWith(base + "/_shared/") || p.startsWith(base + "/usr/share/")) {
      // registry unknown (fresh restart): tentatively claim the tree-capable prefixes too
      return { kind: "tree?", key: null, rel: null, closureUrl: null, path: p };
    }
    return null;
  }

  // rescue(req, cand) → Response. Falls back to fetch(req) whenever the candidate turns out not evicted,
  // the closure lacks the file, or the mirror misses — the origin stays the honest fallback.
  async function rescue(req, cand) {
    const reg = await registry();
    if (cand.kind === "app" && !reg.apps.has(cand.key)) return fetch(req);
    if (cand.kind === "tree?") {   // resolve the tentative claim now that the registry is known
      const p = cand.path;
      cand = null;
      for (const t of reg.trees) {
        const pref = base + "/" + t.prefix;
        if (p.startsWith(pref) && !p.endsWith("holo-evicted.json")) { cand = { kind: "tree", rel: p.slice(pref.length).split("?")[0], closureUrl: base + "/" + t.closure }; break; }
      }
      if (!cand) return fetch(req);
    }
    const cl = await closure(cand.closureUrl);
    const hex = cl && cl.files && cl.files[cand.rel];
    if (!hex) return fetch(req);
    const ext = (cand.rel.split(".").pop() || "").toLowerCase();
    const headers = { "content-type": MIME[ext] || "application/octet-stream", "x-holo-kappa": "blake3:" + hex };
    let R = null;
    if (rung) { try { R = await rung(); } catch {} }
    if (R) {                                              // O2 store-first: rung.get re-derives before serving
      try { const u8 = await R.get("blake3", hex); if (u8) return new Response(u8, { status: 200, headers: { ...headers, "x-holo-source": "device-store" } }); } catch {}
    }
    const r = await fetch((cl.mirror || "") + hex);
    if (!r.ok) return fetch(req);
    if (!headers["content-type"] || headers["content-type"] === "application/octet-stream")
      headers["content-type"] = r.headers.get("content-type") || "application/octet-stream";
    const v = await verifierFor(hex);
    let body = r.body;
    if (R && v && body) {                                 // write-back branch verifies INDEPENDENTLY (own pass)
      const [serve, capture] = body.tee();
      body = serve;
      captureVerifiedInto(R, "blake3", hex, capture).catch(() => {});
    }
    return new Response(v && body ? body.pipeThrough(v) : body, { status: 200, headers });
  }

  // read a tee'd branch through its OWN verifier; only bytes that fully re-derive enter the store.
  // A mismatch errors the read (nothing stored); oversized objects are skipped, never truncated.
  async function captureVerifiedInto(R, axis, hex, stream) {
    const CAP = 64 * 1024 * 1024;
    const v = await verifierFor(hex);
    if (!v) { try { await stream.cancel(); } catch {} return; }
    const rd = stream.pipeThrough(v).getReader();
    const chunks = []; let n = 0;
    for (;;) {
      const { done, value } = await rd.read();
      if (done) break;
      n += value.length;
      if (n > CAP) { try { await rd.cancel(); } catch {} return; }
      chunks.push(value);
    }
    const u8 = new Uint8Array(n); let o = 0;
    for (const c of chunks) { u8.set(c, o); o += c.length; }
    await R.put(axis, hex, u8);
  }

  return { registry, matchSync, rescue, verifierFor, captureInto: (R, axis, hex, stream) => captureVerifiedInto(R, axis, hex, stream).catch(() => {}) };
}
