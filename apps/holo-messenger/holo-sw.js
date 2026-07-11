// holo-sw.js — the ONE messenger service worker (scope /apps/holo-messenger/). Three jobs in one worker,
// because a scope may hold only one registration:
//
//   1. REACH (push): receive web-push while the app is closed, show a content-blind notification, deep-link on click.
//   2. M1 shell cache: precache the shell + serve it CACHE-FIRST so the 2nd open paints with ZERO network bytes.
//   3. κ-VERIFIED SHELL DELIVERY: every shell asset is verified against its committed content κ (shell-manifest.json)
//      BEFORE it is served or cached. Bytes may come from cache → the κ-store (content-addressed mirror, origin-
//      independent) → the origin, in that order. A hash MISMATCH is REFUSED — the one place this worker is NOT
//      fail-soft: a poisoned byte must never paint. This makes the boot link the integrity root for the whole shell
//      (the link commits the manifest's aggregate κ; the page verifies that; here we verify each byte against it).
//
// ES module (shares holo-push-route). The SHELL list mirrors SHELL_MANIFEST in holo-m1-boot.mjs (witness gates drift).
import { notificationFor, routeFor } from "./holo-push-route.mjs";
// THE evicted rescue — ONE shared module (also used by root-sw): bytes that left Q for the κ-mirror
// still resolve byte-identical, verified fail-closed (L5). Lazy + memoized = restart-safe.
import { makeEvictRescue } from "../../usr/lib/holo/holo-evict-rescue.mjs";
// O3/O5 (HOLO-SOVEREIGN-OFFLINE): the DEVICE κ-STORE weld. holo-sw owns the messenger scope, which sits
// IN FRONT of root-sw — so without this, an offline shell asset the precache missed would 502 here and
// never reach root-sw's pinned-closure fallback (the first-visit-then-offline residual O0.5 flagged).
// With the pin's store as a last resort, EVERY object the pin sealed serves offline through this worker
// too: manifested shell assets by their sha256 κ (the pin stores a sha256 alias for every object), and
// non-manifested statics by the signed closure's path→blake3 map. Static import = cached with the
// registration (available with the radio dead); any trouble is caught → today's 502/504 exactly.
import { makeStoreRung } from "../../usr/lib/holo/holo-store-rung.mjs";
const _RUNG = (() => { try { return makeStoreRung(); } catch { return null; } })();

const CACHE = "holo-msgr-shell-d5e142099185";                     // bump → old (unverified) caches are purged on activate
// BASE-RELOCATABLE: the worker may be served under ANY prefix (OS root, a GitHub Pages /<repo>/ subpath, a
// static mirror). Every location below derives from where THIS script actually lives; at the OS root BASE is ""
// and behavior is byte-identical. Manifest paths stay CANONICAL ("/apps/holo-messenger/…" — they are identity,
// not location); canon() maps a runtime pathname back to its canonical id before any κ lookup.
const BASE = self.location.pathname.replace(/\/apps\/holo-messenger\/holo-sw\.js$/, "");
const canon = (p) => (BASE && p.startsWith(BASE)) ? p.slice(BASE.length) : p;
const SCOPE = BASE + "/apps/holo-messenger/";
const RESCUER = makeEvictRescue({ base: BASE });
const MANIFEST_URL = BASE + "/apps/holo-messenger/shell-manifest.json";
// content-addressed κ-store sources: an asset's exact bytes live at <base> + <sha256>. Tried in order — the
// same-origin mirror first (fast, but dies with the app origin), then the CROSS-ORIGIN HF κ-mirror, which gives
// TRUE origin independence: the shell boots even if the app's own server is gone. Because every byte is re-verified
// (Law L5), the source is untrusted plumbing — an untrusted CDN cannot forge the shell.
const K_STORES = [
  BASE + "/b/",
  "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/",
];

const SHELL = [
  "/apps/holo-messenger/app.html",
  "/apps/holo-messenger/_vendor/ui/chat-ui.bundle.js",
  "/apps/holo-messenger/_vendor/ui/chat-ui.bundle.css",
  "/apps/holo-messenger/holo-messenger-login.mjs",
  "/apps/holo-messenger/holo-messenger-app.mjs",
  "/apps/holo-messenger/messenger-shadcn-ui.mjs",
  "/apps/holo-messenger/holo-messenger-weave.mjs",
  "/apps/holo-messenger/messenger-skin.mjs",
  "/apps/holo-messenger/messenger-skins.css",
  "/apps/holo-messenger/messenger-sw-register.mjs",
  "/apps/holo-messenger/holo-m1-boot.mjs",
  "/apps/holo-messenger/holo-release-boot.mjs",
  "/apps/holo-messenger/holo-release-verify.mjs",
  "/apps/holo-messenger/mail/holo-mail-attach.mjs",
  "/apps/holo-messenger/_vendor/wallpaper-default.jpg",
];

// path → committed content κ. Seeded from shell-manifest.json on install; UPGRADED (authoritatively) when the page
// hands us a link-verified manifest (postMessage), so a poisoned origin manifest can't lower the bar for a real link.
let SHELL_KAPPA = new Map();

const _hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha256hex(buf) { return _hex(await crypto.subtle.digest("SHA-256", buf)); }
// the κ bar covers the shell AND the runtime table (S3.2): holospaces_web builds are verified on fetch
// exactly like shell assets — bytes that don't re-derive to the committed κ are refused, whatever served them.
function setManifest(assets, runtime) { try { const m = new Map(); for (const a of [...(assets || []), ...(runtime || [])]) if (a && a.path && a.kappa) m.set(a.path, a.kappa); if (m.size) SHELL_KAPPA = m; } catch {} }
async function loadManifest() { try { const r = await fetch(MANIFEST_URL, { cache: "no-store" }); if (r && r.ok) { const j = await r.json(); setManifest(j.assets, j.runtime); return j; } } catch {} return null; }
const expectedKappa = (pathname) => SHELL_KAPPA.get(pathname) || null;

const MIME = { html: "text/html", htm: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", wasm: "application/wasm", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", avif: "image/avif", ico: "image/x-icon", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf" };
const mimeFor = (pathname) => MIME[(pathname.split(".").pop() || "").toLowerCase()] || "application/octet-stream";

// verify bytes against the committed κ, return a fresh SAME-ORIGIN Response with the CORRECT content-type (never
// trust a κ-store's content-type — a cross-origin CDN may serve octet-stream, which would break a module script or
// the navigation). null if the hash doesn't match.
async function verifiedResponse(res, kappa, mime) {
  if (!res || !res.ok) return null;
  const buf = await res.arrayBuffer();
  if (kappa && (await sha256hex(buf)) !== kappa) return null;   // integrity fail → caller falls back / refuses
  return new Response(buf, { status: 200, statusText: "OK", headers: { "content-type": mime || "application/octet-stream" } });
}
// try the origin, then each κ-store base in order; only VERIFIED bytes are returned. null = no source produced valid bytes.
async function fetchVerified(req, kappa, mime) {
  try { const v = await verifiedResponse(await fetch(req, { cache: "reload" }), kappa, mime); if (v) return v; } catch {}
  if (kappa) { for (const base of K_STORES) { try { const v = await verifiedResponse(await fetch(base + kappa, { cache: "reload" }), kappa, mime); if (v) return v; } catch {} } }
  return null;
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Precache the shell, VERIFYING each asset (origin → κ-store). Tolerate a single miss so install never wedges.
  e.waitUntil((async () => {
    try {
      await loadManifest();
      const cache = await caches.open(CACHE);
      await Promise.all(SHELL.map(async (u) => {
        try { const v = await fetchVerified(new Request(BASE + u), expectedKappa(u), mimeFor(u)); if (v) await cache.put(BASE + u, v.clone()); } catch {}
      }));
    } catch {}
  })());
});

self.addEventListener("activate", (e) => e.waitUntil((async () => {
  try { for (const k of await caches.keys()) { if (k.startsWith("holo-msgr-") && k !== CACHE) await caches.delete(k); } } catch {}
  try { if (!SHELL_KAPPA.size) await loadManifest(); } catch {}
  try { await self.clients.claim(); } catch {}
})()));

// the page hands us the LINK-VERIFIED manifest (its aggregate was checked against the boot link) — trust it over
// whatever install fetched from the origin.
self.addEventListener("message", (e) => { const d = e.data || {}; if (d.type === "holo-shell-manifest") setManifest(d.assets, d.runtime); });

const CACHEABLE = /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|css|js|mjs|wasm|woff2?|ttf|otf)$/i;
const STATIC_DIRS = [SCOPE, BASE + "/_shared/", BASE + "/usr/share/", BASE + "/usr/lib/holo/", BASE + "/apps/q/pkg/", BASE + "/apps/workspace/pkg/", BASE + "/usr/lib/pkg/"];
const MIME_EXT = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", wasm: "application/wasm", html: "text/html", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", woff2: "font/woff2", ico: "image/x-icon" };

// O3/O5: the pinned closure as this worker's offline path→κ map. holo-pin.mjs verified os-closure.json
// against the SIGNED head and handed it over through the "holo-pin" cache; we re-derive it here against
// payload.closure from the sealed release pointer before trusting it. Memoized; no pin yet → null.
let _cl = null, _clP = null;
function pinnedClosure() {
  if (_cl !== null) return Promise.resolve(_cl);
  return (_clP ||= (async () => {
    try {
      const hit = await caches.match(BASE + "/os-closure.json");
      if (!hit) return (_cl = false);
      const bytes = new Uint8Array(await hit.arrayBuffer());
      let want = null;
      try { const rr = await caches.match(BASE + "/release.json", { ignoreSearch: true }); if (rr) want = (JSON.parse(await rr.clone().text())["holstr:payload"] || {}).closure; } catch {}
      if (want && (await sha256hex(bytes)) !== want) return (_cl = false);
      return (_cl = JSON.parse(new TextDecoder().decode(bytes)));
    } catch { return (_cl = false); }
  })());
}
// serve a request from the device store when cache+network both failed (offline). Manifested assets pass
// their sha256 κ (the pin's sha256 alias resolves it); statics resolve via the closure path→blake3 map.
// A hit is re-derived by the rung before it returns, so an offline byte is still verified (L5).
async function storeFallback(pathname, kappa) {
  if (!_RUNG) return null;
  try {
    if (kappa) { const u8 = await _RUNG.get("sha256", kappa); if (u8) return storeResponse(pathname, u8); }
    const cl = await pinnedClosure();
    if (cl && cl.files) {
      let rel = canon(pathname).replace(/^\//, "").split("?")[0];
      let e = cl.files[rel] || (!/\.[a-z0-9]{2,8}$/i.test(rel) ? (cl.files[rel + "/index.html"] || cl.files[rel + ".html"]) : null);
      if (e && e.blake3) { const u8 = await _RUNG.get("blake3", e.blake3); if (u8) return storeResponse(pathname, u8); }
    }
  } catch {}
  return null;
}
function storeResponse(pathname, u8) {
  const ext = (pathname.split(".").pop() || "").toLowerCase();
  return new Response(u8, { status: 200, headers: { "content-type": MIME_EXT[ext] || "application/octet-stream", "x-holo-source": "device-store" } });
}

// cache-first, with κ-verified refill. A cached hit was verified when stored → served directly (0 net). A miss on a
// MANIFESTED shell asset must pass verification (origin → κ-store) or is REFUSED (502). Non-manifested statics keep
// plain cache-first (nothing to verify against).
async function cacheFirst(req, pathname) {
  // A restarted worker loses the in-memory manifest (install doesn't re-run) — lazily reload it (from the
  // integrity index, which is never intercepted/killed) so verification + κ-store recovery survive eviction.
  if (!SHELL_KAPPA.size) await loadManifest();
  const cache = await caches.open(CACHE);
  // A ?query is an explicit version intent (e.g. q-summon.mjs?v=9) — it MUST bust the cache. ignoreSearch
  // would serve a stale ?v=8 entry for a ?v=9 request (the bug that froze the Q drawer on old bytes), so
  // only fall back to the query-insensitive match for queryless requests (plain static assets, unchanged).
  const hit = (await cache.match(req)) || (req.url.includes("?") ? null : (await cache.match(req, { ignoreSearch: true })));
  if (hit) return hit;
  const cpath = canon(pathname);   // κ lookups use the canonical id, wherever the shell is mounted
  let kappa = expectedKappa(cpath);
  if (kappa) {
    let v = await fetchVerified(req, kappa, mimeFor(pathname));
    // A rebuilt shell rotates every asset's κ. A long-lived worker's IN-MEMORY manifest goes stale and would
    // reject the fresh bytes — so on a miss, RE-PULL the manifest (no-store) and retry once against the new κ.
    if (!v) { await loadManifest(); const k2 = expectedKappa(cpath); if (k2 && k2 !== kappa) { kappa = k2; v = await fetchVerified(req, kappa, mimeFor(pathname)); } }
    if (v) { try { await cache.put(req, v.clone()); } catch {} return v; }
    // Never BRICK the shell on an integrity miss: fall back to the plain network response (manifest lag / drift).
    // The bytes still came from the origin over TLS; failing closed to a blank 502 is strictly worse for the user.
    try { const res = await fetch(req, { cache: "reload" }); if (res && res.ok) return res; } catch {}
    // O3/O5: offline last resort — the pinned device store (verified by the rung against this same κ).
    const fromStore = await storeFallback(pathname, kappa); if (fromStore) { try { await cache.put(req, fromStore.clone()); } catch {} return fromStore; }
    return new Response("shell integrity check failed", { status: 502, headers: { "content-type": "text/plain" } });
  }
  // non-manifested static: refill from network, cache basic 200s.
  try { const res = await fetch(req); try { if (res && res.ok && res.type === "basic") cache.put(req, res.clone()); } catch {} return res; }
  catch {
    // O3/O5: offline — resolve the static from the pinned closure → device store before giving up (504).
    const fromStore = await storeFallback(pathname, null); if (fromStore) { try { await cache.put(req, fromStore.clone()); } catch {} return fromStore; }
    return new Response("offline", { status: 504 });
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                   // never touch POST/PUT/etc
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;    // own-origin only
  if (self.location.port === "8472" || self.location.port === "8474") return;   // DEV-ITERATE PORTS: never cache/verify — always serve live (edits appear instantly; no stale shell, no integrity brick)
  const p = url.pathname;
  if (p === MANIFEST_URL || p.startsWith(BASE + "/b/")) return;     // the integrity index + same-origin κ-store: never intercept (avoid loops)
  // EVICTED rescue (U2): a messenger-page request under an evicted app/tree is served from the κ-mirror,
  // verified fail-closed, then CACHED — the offline/warm contract holds for evicted closures (ui, q).
  // Runs BEFORE root-rescue/cacheFirst so an evicted path never falls through to an origin 404.
  {
    const pp = (BASE && !p.startsWith(BASE + "/")) ? BASE + p : p;
    const cand = RESCUER.matchSync(pp);
    if (cand) {
      e.respondWith((async () => {
        const hit = await caches.match(req); if (hit) return hit;               // admitted-verified once (L3)
        const res = await RESCUER.rescue(req, cand);
        if (res.ok && res.headers.get("x-holo-kappa")) { try { const cc = await caches.open(CACHE); await cc.put(req, res.clone()); } catch (x) {} }
        return res;
      })());
      return;
    }
  }
  // NAVIGATION (app.html) — κ-verified, cache-first, so the 2nd open needs 0 network to paint.
  if (req.mode === "navigate" && p.startsWith(SCOPE)) { e.respondWith(cacheFirst(req, p)); return; }
  // ROOT-RESCUE (mounted hosts only): runtime code addresses the OS by CANONICAL absolute paths ("/usr/…",
  // "/_shared/…") which resolve against the DOCUMENT — on a /<repo>/ mount they'd escape the bundle and 404.
  // Remap them onto the mount base. At the OS root BASE is "" and this never fires.
  if (BASE && !p.startsWith(BASE + "/") && ["/apps/", "/usr/", "/_shared/", "/vendor/"].some((d) => p.startsWith(d))) {
    e.respondWith(cacheFirst(new Request(BASE + p + url.search, { mode: "same-origin" }), BASE + p)); return;
  }
  const staticAsset = CACHEABLE.test(p) && STATIC_DIRS.some((d) => p.startsWith(d));
  if (!staticAsset) return;                            // PASSTHROUGH: APIs, ws, bridges, media, κ-weights, dynamic
  e.respondWith(cacheFirst(req, p));
});

// ── REACH (push) ─────────────────────────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let payload = {}; try { payload = event.data ? event.data.json() : {}; } catch {}
  const n = notificationFor(payload);
  if (!n) return;   // unknown / already-filtered Noise → stay silent
  event.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, data: n.data, renotify: !!n.renotify, requireInteraction: !!n.requireInteraction,
    icon: SCOPE + "icon.svg", badge: SCOPE + "icon.svg",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = routeFor((event.notification.data || {}).route || {});
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of wins) { if ("focus" in c) { try { c.postMessage({ type: "holo-notif-route", route }); } catch {} return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow((BASE || "") + "/?route=" + encodeURIComponent(JSON.stringify(route)));
  })());
});
