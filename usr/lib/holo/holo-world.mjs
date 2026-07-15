// holo-world.mjs — THE ONE resolver over THE WORLD (HOLO-ONE-OBJECT W1b/W2).
//
// The OS's whole object graph is one signed κ-object (payload.world in the release pointer). This
// module loads it, re-derives it (Law L5), and answers every question the eleven legacy manifest
// species used to answer — registry / closureFor / rungs / name / appEntry — from ONE object.
//
// DUAL-RUN (W1b): the accessors have a SYNC variant that answers ONLY when the world is already
// warm (returns undefined when cold), so a consumer consults the world with ZERO added latency and
// falls through to its legacy fetch on a cold arrival. warm() loads in the background (release.json
// → b/<κ>, re-derived); once warm, subsequent resolves are served + counted (stats()). Fail-soft:
// no world / unverifiable → every accessor is null-ish and the caller keeps today's behavior.
// Restart-safe (no activate-time state); the hasher defaults to crypto.subtle (SW/window) and is
// injectable for Node (Law L4: one implementation, no per-host fork).

const _subtleSha256 = async (u8) => {
  const d = await (self.crypto || crypto).subtle.digest("SHA-256", u8);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export function makeWorld({ base = "", fetchFn = fetch, hashSha256 = _subtleSha256 } = {}) {
  let _world = null, _worldP = null, _names = null, _namesP = null, _warmed = false;
  const stats = { load: 0, hit: 0, miss: 0, byFacet: {} };
  const bump = (facet, hit) => { stats[hit ? "hit" : "miss"]++; (stats.byFacet[facet] ||= { hit: 0, miss: 0 })[hit ? "hit" : "miss"]++; };

  async function load() {
    if (_world) return _world;
    if (!_worldP) _worldP = (async () => {
      try {
        const rp = await fetchFn(base + "/release.json", { cache: "no-store" });
        if (!rp.ok) return null;
        const wk = ((await rp.json())["holstr:payload"] || {}).world;
        if (!/^[0-9a-f]{64}$/.test(String(wk || ""))) return null;
        const wr = await fetchFn(base + "/b/" + wk, { cache: "force-cache" });
        if (!wr.ok) return null;
        const buf = new Uint8Array(await wr.arrayBuffer());
        if ((await hashSha256(buf)) !== wk) return null;      // L5: refuse a world that isn't its name
        _world = JSON.parse(new TextDecoder().decode(buf));
        stats.load++;
        return _world;
      } catch { _worldP = null; return null; }
    })();
    return _worldP;
  }
  // fire-and-forget background load — never blocks the caller (the W1b non-blocking contract).
  function warm() { if (!_warmed) { _warmed = true; load().catch(() => {}); } return _world != null; }
  const loaded = () => _world != null;

  async function names() {
    if (_names) return _names;
    if (!_namesP) _namesP = (async () => {
      const w = await load();
      const nk = w && w.names && w.names.kappa;
      if (!/^[0-9a-f]{64}$/.test(String(nk || ""))) return null;
      try {
        const r = await fetchFn(base + "/b/" + nk, { cache: "force-cache" });
        if (!r.ok) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        if ((await hashSha256(buf)) !== nk) return null;
        _names = JSON.parse(new TextDecoder().decode(buf)).files || {};
        return _names;
      } catch { _namesP = null; return null; }
    })();
    return _namesP;
  }

  // most-specific closure match (exact prefix/path/app wins; else longest containing prefix — never
  // a narrow closure answering a broad query, the bug the W1b coverage proof caught).
  const wrap = (x) => ({ axis: x.axis, mirror: x.mirror, files: x.files || {}, ...(x.bootFloor ? { bootFloor: x.bootFloor } : {}) });
  function closureFromWorld(w, key) {
    const k = String(key).replace(base, "").replace(/^\//, "");
    const trees = w.rescue.trees || [];
    for (const t of trees) if (k === t.prefix || k === t.path) return wrap(t);
    for (const [app, m] of Object.entries(w.rescue.appMaps || {})) if (k === app || k === "apps/" + app || k === m.path) return wrap(m);
    let best = null;
    for (const t of trees) if (k.startsWith(t.prefix) && (!best || t.prefix.length > best.prefix.length)) best = t;
    const appHit = Object.entries(w.rescue.appMaps || {}).find(([app]) => k.startsWith("apps/" + app + "/"));
    if (appHit && (!best || ("apps/" + appHit[0] + "/").length > best.prefix.length)) return wrap(appHit[1]);
    return best ? wrap(best) : null;
  }
  const registryFromWorld = (w) => ({ apps: new Set(w.rescue.apps || []), trees: (w.rescue.trees || []).map((t) => ({ prefix: t.prefix, closure: t.path })) });

  return {
    warm, loaded, load,
    stats: () => ({ ...stats, byFacet: { ...stats.byFacet } }),

    // SYNC accessors (dual-run): answer iff warm, else undefined → caller uses its legacy path.
    registrySync() { if (!_world) return undefined; bump("registry", true); return registryFromWorld(_world); },
    closureSync(key) { if (!_world) return undefined; const c = closureFromWorld(_world, key); bump("closure", !!c); return c; },
    rungsSync() { if (!_world) return undefined; bump("rungs", !!_world.rungs); return _world.rungs || null; },

    // ASYNC accessors (W2 consumers): load-then-answer, for paths that can await.
    async registry() { const w = await load(); if (!w || !w.rescue) { bump("registry", false); return null; } bump("registry", true); return registryFromWorld(w); },
    async closureFor(key) { const w = await load(); if (!w || !w.rescue) { bump("closure", false); return null; } const c = closureFromWorld(w, key); bump("closure", !!c); return c; },
    async rungs() { const w = await load(); if (!w || !w.rungs) { bump("rungs", false); return null; } bump("rungs", true); return w.rungs; },
    async name(rel) { const n = await names(); const e = n && n[String(rel).replace(/^\//, "")]; bump("name", !!e); return e ? { sha256: e.sha256, blake3: e.blake3, bytes: e.bytes } : null; },
    async appEntry(dir) { const w = await load(); if (!w) { bump("app", false); return null; } const e = (w.apps.entries || []).find((x) => x.dir === dir); const hex = (e && e.blake3Entry) || (w.rescue.appIndex && w.rescue.appIndex.extra && w.rescue.appIndex.extra[dir]) || null; bump("app", !!hex); return hex; },
  };
}
