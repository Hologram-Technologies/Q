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
// MIME + the κ-CAS rung table live in ONE place now: holo-rungs.mjs (G0 — one ladder, rungs are data).

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
// G0 (HOLO-GENESIS-SEED): THE rung ladder — device store → origin b/ → mirror rungs (data), every
// byte re-derived before it ships. STATIC import (SWs disallow dynamic import); ships same-commit.
import { makeLadder, MIME } from "./usr/lib/holo/holo-rungs.mjs";
let _rung = null;
const rung = async () => { try { return (_rung ||= makeStoreRung()); } catch { return null; } };
const LADDER = makeLadder({ base: BASE, rung });
const RESCUER = makeEvictRescue({ base: BASE, rung });

// ── PRISM (HOLO-PLAYGROUND-LIVE L1): the operator's personal refraction, NAME-keyed. The sealed
// base is NEVER mutated: an edit mints κ-atoms into the device store and the prism maps a PATH →
// the edited document's attribute-tree ROOT κ (holo-dag-io materializes it, every atom re-derived —
// L5 at the atom). Read from OPFS (holo-prism/prism.json, written by the page's token door);
// preloaded at activate and reloaded on the page's "holo-prism-updated" message so the fetch hot
// path is ONE sync Map lookup. Any damage folds to EMPTY → the base experience, never a broken one.
import { materialize as prismMaterialize } from "./usr/lib/holo/holo-dag-io.mjs";
let _pnames = null;   // Map (loaded) | null (loading/not yet) | false (none)
function loadPrismNames() {
  _pnames = null;
  (async () => {
    try {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("holo-prism");
      const j = JSON.parse(await (await (await dir.getFileHandle("prism.json")).getFile()).text());
      const m = new Map();
      if (j && j.v === 1 && j.names && typeof j.names === "object")
        for (const [n, r] of Object.entries(j.names))
          if (n && /^[0-9a-f]{64}$/.test(String(r))) m.set(String(n).replace(/^\/+/, "").split("?")[0], r);
      _pnames = m.size ? m : false;
    } catch { _pnames = false; }
  })();
}
self.addEventListener("message", (ev) => { if (ev.data && ev.data.type === "holo-prism-updated") { loadPrismNames(); try { caches.delete("holo-prism-derived"); } catch {} } });

self.addEventListener("activate", (e) => e.waitUntil(RESCUER.registry().then(() => { loadPrismNames(); return self.clients.claim(); })));

// ── O3: the PINNED CLOSURE as the SW's offline path→κ map ──────────────────────────────────────────────
// holo-pin.mjs verifies os-closure.json against the SIGNED head and hands it to this worker through the
// "holo-pin" cache. Before trusting it we re-derive its sha256 against payload.closure from the sealed
// release pointer (network-first tier keeps that honest; offline, the sealed copy answers). Memoized per
// worker life; a restarted worker re-loads once. No pin yet → null → today's behavior exactly.
let _cl = null, _clP = null;
function pinnedClosure() {
  if (_cl !== null) return Promise.resolve(_cl);
  return (_clP ||= (async () => {
    try {
      const c = await caches.open("holo-pin");
      const hit = await c.match(BASE + "/os-closure.json");
      if (!hit) return (_cl = false);
      const bytes = new Uint8Array(await hit.arrayBuffer());
      let want = null;
      try { const rr = await caches.match(BASE + "/release.json", { ignoreSearch: true }); if (rr) want = (JSON.parse(await rr.clone().text())["holstr:payload"] || {}).closure; } catch {}
      if (want) {
        const d = await crypto.subtle.digest("SHA-256", bytes);
        const hex = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
        if (hex !== want) { const R = await rung(); R && R.witness("pin-closure-mismatch", { want, got: hex }); return (_cl = false); }
      }
      return (_cl = JSON.parse(new TextDecoder().decode(bytes)));
    } catch { return (_cl = false); }
  })());
}
// serve a mount path from the pinned closure → device store (verified by the rung). null = not ours.
async function pathFallback(p) {
  try {
    const cl = await pinnedClosure();
    if (!cl || !cl.files) return null;
    let rel = decodeURIComponent(p.slice(BASE.length)).replace(/^\//, "").split("?")[0];
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    let e = cl.files[rel];
    if (!e && !/\.[a-z0-9]{2,8}$/i.test(rel)) e = cl.files[rel + "/index.html"] || cl.files[rel + ".html"];
    if (!e || !e.blake3) return null;
    const R = await rung();
    if (!R) return null;
    const u8 = await R.get("blake3", e.blake3);
    if (!u8) return null;
    const ext = (rel.split(".").pop() || "").toLowerCase();
    return new Response(u8, { status: 200, headers: { "content-type": MIME[ext] || "application/octet-stream", "x-holo-source": "device-store", "x-holo-kappa": "blake3:" + e.blake3 } });
  } catch { return null; }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url; try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;

  // κ-route: serve an object BY ITS CONTENT ADDRESS — ONE call into the ladder (G0). Device store
  // first, then origin b/, then the mirror rungs; every rung fail-closed verified, a poisoned rung's
  // bytes refused and the next rung tried. Network throws (radio dead) must answer 504, never reject
  // the respondWith (offline honesty).
  const kap = p.match(/\/\.holo\/(sha256|blake3)\/([0-9a-f]{64})(?:\.([a-z0-9]+))?$/i);
  if (kap) {
    e.respondWith((async () => {
      try {
        const r = await LADDER.resolve(kap[1].toLowerCase(), kap[2].toLowerCase(), { ext: (kap[3] || "").toLowerCase() });
        return r || new Response("unresolvable offline — not in the device store (O2)", { status: 504 });
      } catch { return new Response("unresolvable offline — not in the device store (O2)", { status: 504 }); }
    })());
    return;
  }

  // evicted rescue (apps + trees): bytes on the kappa-mirror still resolve, verified (M3/U1).
  // O3: with the radio dead the rescue's network fallbacks reject — the pinned closure answers instead.
  {
    const cand = RESCUER.matchSync(p);
    if (cand) { e.respondWith(RESCUER.rescue(req, cand).catch(async () => (await pathFallback(p)) || Response.error())); return; }
  }

  // ── PRISM refraction (before the sealed boot cache, which would otherwise answer with the BASE
  // bytes). Names refract; κ-routes above never do. Sync Map guard — zero cost when no prism. The
  // derived doc caches under a synthetic key including the ROOT κ (a new edit = a new key; the
  // message handler also drops the whole derived cache). ANY failure → fetch(req) → base experience.
  if (_pnames && _pnames.size) {
    const relp = decodeURIComponent(p.startsWith(BASE + "/") ? p.slice(BASE.length + 1) : p.replace(/^\/+/, "")).split("?")[0];
    const prk = req.headers.get("x-holo-base") ? null : _pnames.get(relp);   // the token door's base-css fetch bypasses refraction
    if (prk) {
      e.respondWith((async () => {
        try {
          const c = await caches.open("holo-prism-derived");
          const key = BASE + "/.holo/prism/" + prk;
          const hit = await c.match(key);
          if (hit) return hit;
          const R = await rung();
          if (!R) return fetch(req);
          const text = await prismMaterialize({ getByKey: (a, h) => R.get(a, h) }, prk);   // throws on missing/tampered atom
          const ext = (relp.split(".").pop() || "").toLowerCase();
          const resp = new Response(text, { status: 200, headers: { "content-type": MIME[ext] || "text/plain", "x-holo-prism": prk, "x-holo-prism-mode": "dag" } });
          try { await c.put(key, resp.clone()); } catch {}
          return resp;
        } catch { return fetch(req); }
      })());
      return;
    }
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
      // O3/O5: network gone AND not sealed → the pinned closure serves the path from the device store
      // (this is what makes a cold offline deeplink into ANY pinned app entry paint, not 404).
      return fetch(req).catch(async () => (await pathFallback(p)) || Response.error());
    })());
    return;
  }

  // ── O3 OFFLINE TOTALITY — every other same-origin GET under the mount: network first (byte-identical
  // to today online; fetch(req) resolving — even a 404 — passes straight through), and ONLY a network
  // REJECTION (radio dead) falls to the pinned closure → device store, verified. Prefix check only —
  // no manifest lookup on the hot path (§3.5).
  if (p.startsWith(BASE + "/")) {
    e.respondWith(fetch(req).catch(async () => (await pathFallback(p)) || Response.error()));
    return;
  }

  if (!BASE) return;   // at a root mount — untouched
  // ROOT-RESCUE: a CANONICAL absolute path ("/apps/…", "/usr/…") emitted by runtime code resolves against
  // the document — on the /Q mount it escapes the bundle, so remap it onto BASE. O5: this was network-ONLY
  // (fetch(BASE+p)); offline it rejected and the asset (a wallpaper, a login module addressed absolutely)
  // died even though the pin holds it. Now the remapped path falls back to the pinned closure → store.
  if (ROOT_FILES[p] || RESCUE.some((d) => p.startsWith(d))) {
    const rp = BASE + p;
    e.respondWith(fetch(rp + url.search).catch(async () => (await pathFallback(rp)) || Response.error()));
  }
});
