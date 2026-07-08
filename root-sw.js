// root-sw.js — mount-base rescue worker + VERIFIED κ-delivery (B3.1). MODULE service worker.
//
// Two jobs, unchanged rescue + one addition:
//   · PATH RESCUE — map the flat URL space (/apps/…, /usr/…, /_shared/…) onto the FHS tree at a /<repo>/
//     mount, so absolute-path imports resolve on a project site (github.io/Q). Identical to before.
//   · κ-DELIVERY — /.holo/<axis>/<hex> serves an object BY ITS CONTENT ADDRESS from the store, and — new —
//     STREAMS THE blake3 ROUTE THROUGH A BLAKE3 VERIFIER: the bytes flow to the consumer as they arrive AND
//     are hashed incrementally; if the final digest ≠ <hex> the response is ERRORED (Law L5, fail-closed on
//     mismatch — a tampered κ-object is refused, never served). blake3 is imported LAZILY per κ-request, so
//     SW install never depends on it and a load hiccup degrades to same-origin passthrough (never breaks the
//     worker). Registration falls back to root-sw-classic.js where module workers are unsupported (no boot
//     regression). (assembled artifact; see assemble-q-bundle.mjs.)
const BASE = new URL("./", self.location.href).pathname.replace(/\/$/, "");
const RESCUE = ["/apps/", "/usr/", "/_shared/", "/vendor/", "/sbin/", "/ui/"];
const ROOT_FILES = { "/holo-resolver.mjs": 1, "/holo-fabric.mjs": 1, "/manifest.webmanifest": 1 };
const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", wasm: "application/wasm", html: "text/html" };
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// lazy, fault-tolerant verifier factory: load the ONE canonical blake3 once (Law L2). Returns a
// TransformStream that passes bytes through and errors the stream if the incremental digest ≠ wantHex.
// Null if blake3 can't load → caller passes bytes through unverified (same-origin bytes; never break boot).
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
  const kap = p.match(/\/\.holo\/(sha256|blake3)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/i);
  if (kap) {
    e.respondWith((async () => {
      const axis = kap[1].toLowerCase(), hex = kap[2].toLowerCase();
      const r = await fetch(BASE + "/b/" + hex);
      if (!r.ok) return r;
      const headers = { "content-type": MIME[(kap[3] || "").toLowerCase()] || r.headers.get("content-type") || "application/octet-stream" };
      let body = r.body;
      // blake3 route → verified passthrough (fail-closed on mismatch). sha256 (legacy) → passthrough until B4.
      if (axis === "blake3" && r.body) { const v = await verifierFor(hex); if (v) body = r.body.pipeThrough(v); }
      return new Response(body, { status: 200, headers });
    })());
    return;
  }
  if (!BASE || p.startsWith(BASE + "/")) return;   // at a root mount, or already on the base — untouched
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d))) e.respondWith(fetch(BASE + p + url.search));
});
