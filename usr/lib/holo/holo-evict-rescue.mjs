// holo-evict-rescue.mjs — THE evicted-bytes rescue, shared by every service worker (root-sw, holo-sw).
//
// Bytes that leave Q for the κ-mirror still resolve, byte-identical, fail-closed (Law L5): a request
// under an evicted prefix is answered BY ITS blake3 κ through THE rung ladder (holo-rungs.mjs, G0 —
// device store → per-closure mirror → the shared rung table), verified before serving. This module
// keeps only the RESCUE semantics (registry, closures, path→κ); how bytes are fetched and proven
// lives in the ladder. One grammar, two shapes:
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

import { makeLadder } from "./holo-rungs.mjs";

export function makeEvictRescue({ base, blake3Import, rung } = {}) {
  // base = bundle-root pathname, no trailing slash ("" at a root mount, "/Q" on Pages subpath)
  // rung (O2, optional): async () => device-store rung | null — the persistent κ-store as a serving
  // tier. Store-first (an evicted byte already on the device serves with ZERO network); mirror wins
  // are INDEPENDENTLY re-derived (their own verifier pass) before entering the store. No rung, or any
  // rung trouble → exactly the pre-O2 behavior (fail-soft).
  const ladder = makeLadder({ base, rung });
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
    } else if (p.startsWith(base + "/_shared/") || p.startsWith(base + "/usr/share/") || p.startsWith(base + "/usr/lib/holo/holowhat/")) {
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
    // THE ladder does the rest: device store first, then the closure's OWN mirror, then the shared
    // rung table — every byte re-derived before it ships, verified bytes entering the store. A miss
    // everywhere falls back to fetch(req): the origin stays the honest fallback.
    const ext = (cand.rel.split(".").pop() || "").toLowerCase();
    try {
      const r = await ladder.resolve("blake3", hex, { ext, extraMirrors: cl.mirror ? [cl.mirror] : [], skipOrigin: true });
      if (r && r.ok) return r;
    } catch {}
    return fetch(req);
  }

  return { registry, matchSync, rescue, verifierFor: ladder.verifierFor };
}
