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
// boot-sequence directories served CACHE-FIRST from the versioned boot cache (see the fetch tier below)
const BOOT_DIRS = ["/usr/lib/holo/", "/usr/share/plymouth/", "/apps/holo-messenger/", "/_shared/"];
// the DOOR's own closure at the root scope — sealed by app.html into holo-boot-<stamp>; without these the
// offline root navigation paints a door that 404s its own module graph and dead-ends at the floor line.
const BOOT_FILES = { "/root-door.mjs": 1, "/holo-root-resolver.mjs": 1, "/holo-resolve-view.mjs": 1, "/apps/index.jsonld": 1, "/apps-blake3.json": 1 };
const ROOT_FILES = { "/holo-resolver.mjs": 1, "/holo-fabric.mjs": 1, "/manifest.webmanifest": 1 };
const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", wasm: "application/wasm", html: "text/html" };

self.addEventListener("install", () => self.skipWaiting());
// THE rescue lives in ONE shared module (holo-evict-rescue.mjs) — root-sw and the messenger's holo-sw
// import the same code: lazy+memoized registry (restart-safe), per-closure cache, mirror fetch through
// the incremental-blake3 verifier, generalized to apps AND arbitrary evicted TREES.
import { makeEvictRescue } from "./usr/lib/holo/holo-evict-rescue.mjs";
// O2 (HOLO-SOVEREIGN-OFFLINE): the device κ-store as a VERIFIED serving rung. STATIC import — dynamic
// import() is disallowed in SWs, and static module-SW imports are cached WITH the registration, so the
// rung exists with the radio dead (the whole point). It ships in the SAME commit as this worker.
// Reads re-derive before serving (warm ≠ trusted); a tampered entry is purged + witnessed by the rung.
// Runtime rung trouble (IDB gone, private mode) → null per call → exactly the pre-O2 network path.
import { makeStoreRung } from "./usr/lib/holo/holo-store-rung.mjs";
let _rung = null;
const rung = async () => { try { return (_rung ||= makeStoreRung()); } catch { return null; } };
const RESCUER = makeEvictRescue({ base: BASE, rung });
const verifierFor = (hex) => RESCUER.verifierFor(hex);
self.addEventListener("activate", (e) => e.waitUntil(RESCUER.registry().then(() => self.clients.claim())));

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
      const R = await rung();
      // O2 TIER: device store FIRST — rung.get re-derives on the requested axis before returning
      // (tamper → purge + witness + null); a hit serves with ZERO network, airplane mode included.
      if (R) { try { const u8 = await R.get(axis, hex); if (u8) return new Response(u8, { status: 200, headers: { "content-type": MIME[(kap[3] || "").toLowerCase()] || "application/octet-stream", "x-holo-source": "device-store" } }); } catch {} }
      // origin b/ next; PRUNED objects fall to the kappa-mirror (U5) — same fail-closed verify below,
      // so the store can shrink while every kappa keeps resolving (the mirror is untrusted capacity).
      // Network throws (radio dead) must answer 504, never reject the respondWith (offline honesty).
      let r = null; try { r = await fetch(BASE + "/b/" + hex); } catch {}
      // mirror rung is blake3-only: that axis re-derives through the verifier below; sha256 has no
      // streaming verify here, and an UNVERIFIED untrusted-mirror byte must never ship (L5/SEC-1).
      if ((!r || !r.ok) && axis === "blake3") { try { r = await fetch("https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/" + hex); } catch {} }
      if (!r || !r.ok) return r || new Response("unresolvable offline — not in the device store (O2)", { status: 504 });
      const headers = { "content-type": MIME[(kap[3] || "").toLowerCase()] || r.headers.get("content-type") || "application/octet-stream" };
      let body = r.body;
      if (axis === "blake3" && r.body) {
        const v = await verifierFor(hex);
        if (v) {
          // write-back rides a tee'd branch through its OWN verifier inside the rescuer — only bytes
          // that fully re-derive enter the store; the serve stream stays untouched (no added latency).
          if (R && body.tee) { const [serve, capture] = body.tee(); body = serve; RESCUER.captureInto?.(R, "blake3", hex, capture); }
          body = body.pipeThrough(v);
        }
      } else if (axis === "sha256" && R && r.body) {
        // sha256 has no streaming verifier here — buffer (bounded), re-derive, THEN serve + store.
        // Oversized or hash-trouble falls back to today's streamed origin response (origin-only rung).
        try {
          const buf = new Uint8Array(await r.clone().arrayBuffer());
          if (buf.length <= 64 * 1024 * 1024) {
            const d = await crypto.subtle.digest("SHA-256", buf);
            const got = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
            if (got !== hex) { R.witness?.("kappa-route-mismatch", { axis, want: hex, got, source: "origin-b" }); return new Response("kappa mismatch — refused (L5)", { status: 502 }); }
            R.put("sha256", hex, buf);
            return new Response(buf, { status: 200, headers });
          }
        } catch {}
      }
      return new Response(body, { status: 200, headers });
    })());
    return;
  }

  // evicted rescue (apps + trees): bytes on the kappa-mirror still resolve, verified (M3/U1)
  {
    const cand = RESCUER.matchSync(p);
    if (cand) { e.respondWith(RESCUER.rescue(req, cand)); return; }
  }

  // ── INSTANT RETURN + OFFLINE BOOT — the root-scope shell cache (M1's contract at "/") ──────────────
  // The login document at the mount root is controlled by THIS worker (holo-sw's scope cannot reach it).
  // app.html seals the whole boot sequence — the document itself, the login-chain modules, frames.pack,
  // the wallpaper — into a versioned "holo-boot-<release-stamp>" cache after first paint; here every
  // navigation and every request under the boot directories is answered CACHE-FIRST from Cache Storage.
  // A returning operator boots with ZERO network; fully offline, the same sealed bytes answer — document
  // included (ignoreSearch lets ?guest=1 land on the sealed page). A miss falls through to the network
  // untouched, so before the first seal this tier is invisible. Freshness is the PAGE's job: a new signed
  // release pointer mints a new cache name and purges the old — the worker never guesses.
  // release.json is the UPDATE FEED — network-FIRST so a new signed head is never masked by a stale
  // cache; only when the network is actually gone does the sealed copy answer (the door then still
  // resolves the messenger by its signed κ with the radio dead).
  if (p === BASE + "/release.json") {
    e.respondWith(fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || Response.error()));
    return;
  }

  if (req.mode === "navigate" || BOOT_FILES[p.slice(BASE.length)] || BOOT_DIRS.some((d) => p.startsWith(BASE + d))) {
    e.respondWith((async () => {
      try {
        const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
        if (hit) return hit;
        // a module cache-buster (?v=markN) must never miss the sealed set: match SEARCH-BLIND inside the
        // release-stamped boot cache only — its consistency is governed by the release pointer, not the query.
        const bn = (await caches.keys()).find((k) => k.indexOf("holo-boot-") === 0);
        if (bn) { const h2 = await (await caches.open(bn)).match(req, { ignoreSearch: true }); if (h2) return h2; }
      } catch {}
      return fetch(req);
    })());
    return;
  }

  if (!BASE || p.startsWith(BASE + "/")) return;   // at a root mount, or already on the base — untouched
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d))) e.respondWith(fetch(BASE + p + url.search));
});
