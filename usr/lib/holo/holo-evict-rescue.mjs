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

const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  svg: "image/svg+xml", wasm: "application/wasm", html: "text/html", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", webp: "image/webp", woff2: "font/woff2", bin: "application/octet-stream" };

export function makeEvictRescue({ base, blake3Import }) {
  // base = bundle-root pathname, no trailing slash ("" at a root mount, "/Q" on Pages subpath)
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

  let _b3 = null;   // null=untried · false=unavailable · fn=createBlake3
  async function verifierFor(wantHex) {
    if (_b3 === null) { try { _b3 = (await (blake3Import ? blake3Import() : import("./holo-blake3.mjs"))).createBlake3; } catch (e) { _b3 = false; } }
    if (!_b3) return null;                                   // verifier unavailable → caller passes through
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
    const r = await fetch((cl.mirror || "") + hex);
    if (!r.ok) return fetch(req);
    const ext = (cand.rel.split(".").pop() || "").toLowerCase();
    const v = await verifierFor(hex);
    return new Response(v && r.body ? r.body.pipeThrough(v) : r.body, { status: 200,
      headers: { "content-type": MIME[ext] || r.headers.get("content-type") || "application/octet-stream", "x-holo-kappa": "blake3:" + hex } });
  }

  return { registry, matchSync, rescue, verifierFor };
}
