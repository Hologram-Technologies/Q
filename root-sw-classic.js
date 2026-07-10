// root-sw-classic.js — the CLASSIC rescue worker (mount-base path rescue + κ-passthrough), kept as the
// FALLBACK for browsers without module-Service-Worker support (pre-2023 Firefox / pre-2022 Safari). The
// module root-sw.js adds fail-closed BLAKE3 verification on the κ-route; where a module worker won't
// register, this preserves the prior behavior (rescue + unverified passthrough) so boot never regresses —
// plus the SAME dependency-free offline boot tier as the module worker (cache-first from the sealed
// holo-boot set), so an old browser still boots offline. (assembled artifact; see assemble-q-bundle.mjs.)
const BASE = new URL("./", self.location.href).pathname.replace(/\/$/, "");
const RESCUE = ["/apps/", "/usr/", "/_shared/", "/vendor/", "/sbin/", "/ui/"];
const BOOT_DIRS = ["/usr/lib/holo/", "/usr/share/plymouth/", "/apps/holo-messenger/", "/_shared/"];
const BOOT_FILES = { "/root-door.mjs": 1, "/holo-root-resolver.mjs": 1, "/holo-resolve-view.mjs": 1, "/apps/index.jsonld": 1, "/apps-blake3.json": 1 };
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
  // release.json: network-first, sealed fallback — mirrors the module worker (never mask a new head).
  if (p === BASE + "/release.json") {
    e.respondWith(fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || Response.error()));
    return;
  }
  // offline boot tier — cache-first from the sealed holo-boot set (see root-sw.js for the contract).
  if (req.mode === "navigate" || BOOT_FILES[p.slice(BASE.length)] || BOOT_DIRS.some((d) => p.startsWith(BASE + d))) {
    e.respondWith((async () => {
      try {
        const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
        if (hit) return hit;
        const bn = (await caches.keys()).find((k) => k.indexOf("holo-boot-") === 0);
        if (bn) { const h2 = await (await caches.open(bn)).match(req, { ignoreSearch: true }); if (h2) return h2; }
      } catch (e2) {}
      return fetch(req);
    })());
    return;
  }
  if (!BASE || p.startsWith(BASE + "/")) return;   // at a root mount, or already on the base — untouched
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d))) e.respondWith(fetch(BASE + p + url.search));
});
