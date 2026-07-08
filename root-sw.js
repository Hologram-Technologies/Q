// root-sw.js — mount-base rescue worker + VERIFIED κ-delivery + EVICTED-APP rescue (B3.1 + M3). MODULE SW.
//
// Three jobs:
//   · PATH RESCUE — map the flat URL space onto the FHS tree at a /<repo>/ mount (unchanged).
//   · κ-DELIVERY — /.holo/blake3/<hex> streamed through an incremental-BLAKE3 verifier, fail-closed on
//     mismatch (a tampered κ-object is refused, never served). blake3 imported lazily; load hiccup → passthrough.
//   · EVICTED-APP RESCUE (M3) — a file whose BYTES were moved OUT of Q (leanness) still resolves: for an app
//     listed in /evicted.json, a request under apps/<app>/ is served from the κ-MIRROR by its blake3 κ (from
//     apps/<app>/holo-evicted.json), streamed through the SAME verifier (Law L5). So the tree shrinks while
//     every evicted app opens byte-identically, each file proven on arrival. Registration falls back to
//     root-sw-classic.js where module workers are unsupported (no boot regression).
const BASE = new URL("./", self.location.href).pathname.replace(/\/$/, "");
const RESCUE = ["/apps/", "/usr/", "/_shared/", "/vendor/", "/sbin/", "/ui/"];
const ROOT_FILES = { "/holo-resolver.mjs": 1, "/holo-fabric.mjs": 1, "/manifest.webmanifest": 1 };
const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", wasm: "application/wasm", html: "text/html" };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EV_RE = new RegExp("^" + esc(BASE) + "/apps/([a-z0-9-]+)/(.+)$");

self.addEventListener("install", () => self.skipWaiting());
// on activate, load the evicted-apps registry so the fetch handler can decide SYNCHRONOUSLY (zero overhead
// for non-evicted apps: they never enter the rescue path).
let _evicted = null;   // Set<appName> | null (untried)
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  try { const r = await fetch(BASE + "/evicted.json", { cache: "no-store" }); _evicted = new Set(r.ok ? ((await r.json()).apps || []) : []); } catch (x) { _evicted = new Set(); }
  await self.clients.claim();
})()));

const _closures = new Map();   // app → { mirror, files } | null
async function evictedClosure(app) {
  if (!_closures.has(app)) { try { const r = await fetch(BASE + "/apps/" + app + "/holo-evicted.json", { cache: "no-store" }); _closures.set(app, r.ok ? await r.json() : null); } catch (x) { _closures.set(app, null); } }
  return _closures.get(app);
}

// lazy, fault-tolerant blake3 verifier (shared by κ-route + evicted rescue): pass bytes through, error the
// stream if the incremental digest ≠ wantHex (Law L5). Null if blake3 can't load → same-origin passthrough.
let _createBlake3 = null;   // null=untried · false=unavailable · fn=loaded
async function verifierFor(wantHex) {
  if (_createBlake3 === null) { try { _createBlake3 = (await import("./usr/lib/holo/holo-blake3.mjs")).createBlake3; } catch (e) { _createBlake3 = false; } }
  if (!_createBlake3) return null;
  const h = _createBlake3();
  return new TransformStream({
    transform(chunk, ctrl) { h.update(chunk); ctrl.enqueue(chunk); },
    flush(ctrl) { if (h.hex() !== wantHex) ctrl.error(new Error("κ mismatch — refused (L5): " + wantHex.slice(0, 12) + "…")); },
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  // κ-route: serve an object BY ITS CONTENT ADDRESS, verified (fail-closed on the blake3 axis)
  const kap = p.match(/\/\.holo\/(sha256|blake3)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/i);
  if (kap) {
    e.respondWith((async () => {
      const axis = kap[1].toLowerCase(), hex = kap[2].toLowerCase();
      const r = await fetch(BASE + "/b/" + hex);
      if (!r.ok) return r;
      const headers = { "content-type": MIME[(kap[3] || "").toLowerCase()] || r.headers.get("content-type") || "application/octet-stream" };
      let body = r.body;
      if (axis === "blake3" && r.body) { const v = await verifierFor(hex); if (v) body = r.body.pipeThrough(v); }
      return new Response(body, { status: 200, headers });
    })());
    return;
  }

  // evicted-app rescue: bytes moved to the κ-mirror still resolve, by blake3 κ, verified (M3)
  if (_evicted && _evicted.size) {
    const ev = p.match(EV_RE);
    if (ev && _evicted.has(ev[1]) && ev[2] !== "holo-evicted.json") {
      e.respondWith((async () => {
        const cl = await evictedClosure(ev[1]);
        const rel = ev[2].split("?")[0];
        const b3 = cl && cl.files && cl.files[rel];
        if (!b3) return fetch(req);                                  // not in closure → origin (real 404 if truly gone)
        const r = await fetch((cl.mirror || "") + b3);              // from the κ-mirror, by content address
        if (!r.ok) return fetch(req);                                // mirror miss → fall back to origin
        const ext = (rel.split(".").pop() || "").toLowerCase();
        const v = await verifierFor(b3);                            // fail-closed verify (Law L5)
        return new Response(v && r.body ? r.body.pipeThrough(v) : r.body, { status: 200, headers: { "content-type": MIME[ext] || r.headers.get("content-type") || "application/octet-stream" } });
      })());
      return;
    }
  }

  if (!BASE || p.startsWith(BASE + "/")) return;   // at a root mount, or already on the base — untouched
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d))) e.respondWith(fetch(BASE + p + url.search));
});
