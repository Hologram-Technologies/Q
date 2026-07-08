// root-sw-classic.js — the CLASSIC rescue worker (mount-base path rescue + κ-passthrough), kept as the
// FALLBACK for browsers without module-Service-Worker support (pre-2023 Firefox / pre-2022 Safari). The
// module root-sw.js adds fail-closed BLAKE3 verification on the κ-route; where a module worker won't
// register, this preserves EXACTLY the prior behavior (rescue + unverified passthrough) so boot never
// regresses. Byte-for-byte the pre-B3.1 root-sw.js. (assembled artifact; see assemble-q-bundle.mjs.)
const BASE = new URL("./", self.location.href).pathname.replace(/\/$/, "");
const RESCUE = ["/apps/", "/usr/", "/_shared/", "/vendor/", "/sbin/", "/ui/"];
const ROOT_FILES = { "/holo-resolver.mjs": 1, "/holo-fabric.mjs": 1, "/manifest.webmanifest": 1 };
const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", wasm: "application/wasm", html: "text/html" };
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  const kap = p.match(/\/\.holo\/(?:sha256|blake3)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/i);
  if (kap) {
    e.respondWith((async () => {
      const r = await fetch(BASE + "/b/" + kap[1].toLowerCase());
      if (!r.ok) return r;
      return new Response(r.body, { status: 200, headers: { "content-type": MIME[(kap[2] || "").toLowerCase()] || r.headers.get("content-type") || "application/octet-stream" } });
    })());
    return;
  }
  if (!BASE || p.startsWith(BASE + "/")) return;   // at a root mount, or already on the base — untouched
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d))) e.respondWith(fetch(BASE + p + url.search));
});
