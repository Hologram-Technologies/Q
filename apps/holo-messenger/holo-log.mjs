// holo-log.mjs — the conversation IS an append-only, hash-linked DAG of BLAKE3 κ-objects (M2).
//
// Every record references its parent κ(s); the "head" is the current frontier (latest κs). This gives
// ordering, tamper-evidence, and offline causal consistency for free — content-addressed history, like a
// hypercore/OrbitDB log but κ-native. SYNC = κ-diff: given a peer's head, walk back fetching ONLY the κs we
// lack, verify each by re-derivation (L5 — a tampered byte changes the κ, refused), converge to identical
// ordered history. Store-and-forward across a team falls out: any peer that holds a κ can serve it (L3).
//
// The log ADDRESSES and ORDERS; it never reads content. The `payload` is an OPAQUE sealed blob (holo-seal2 /
// vodozemac put it there). Transport + store are INJECTED so this module is pure and testable:
//   makeLog({ kappa, put, get, verify })
//     kappa(bytes) → "blake3:<hex>"            (spine.kappa)
//     put(κ, bytes) → Promise                  (spine.put + store — we hold it, and announce it on the mesh)
//     get(κ) → Promise<Uint8Array|null>        (local store else spine.fetch over the mesh; null = holder offline)
//     verify(bytes, κ) → bool                  (spine.verify — re-derivation, L5)
//
// Canonicalization (L2): a record serializes to canonical JSON (sorted keys, no whitespace) → the SAME bytes
// → the SAME κ on every peer, so two peers that build the same record agree on its address.

const _enc = new TextEncoder(), _dec = new TextDecoder();

function _canon(v) {
  if (Array.isArray(v)) return "[" + v.map(_canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + _canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}

export function makeLog({ kappa, put, get, verify = null } = {}) {
  const heads = new Map();   // conv → Set(κ): the DAG frontier (records no later record parents)
  const recs = new Map();    // κ → { record, bytes } we hold locally
  const has = (k) => recs.has(k);
  const headArr = (conv) => [...(heads.get(conv) || [])];

  // append a record (payload already sealed + base64 by the caller). Parents = the current head → the new
  // record supersedes them as the frontier. Returns its κ.
  async function append(conv, payload, { author, ts }) {
    const parents = headArr(conv).sort();
    const record = { v: 1, conv, ts, author, parents, payload };
    const bytes = _enc.encode(_canon(record));
    const k = kappa(bytes);
    await put(k, bytes);
    recs.set(k, { record, bytes });
    const h = heads.get(conv) || new Set();
    for (const p of parents) h.delete(p);
    h.add(k); heads.set(conv, h);
    return k;
  }

  // ingest a record we already have the bytes for (e.g. hydrated from the local store on reload).
  function _admit(k, bytes) {
    if (verify && !verify(bytes, k)) throw new Error("holo-log: κ does not re-derive — refused (L5): " + String(k).slice(0, 20));
    const record = JSON.parse(_dec.decode(bytes));
    recs.set(k, { record, bytes });
    return record;
  }
  function hydrate(entries) {   // [{κ, bytes}] from the store → rebuild the DAG + heads with ZERO network
    for (const { k, bytes } of entries) _admit(k, bytes);
    _recomputeHeads();
  }
  function _recomputeHeads() {
    heads.clear();
    const parented = new Set();
    for (const { record } of recs.values()) for (const p of record.parents || []) parented.add(p);
    for (const [k, { record }] of recs) { if (!parented.has(k)) { const h = heads.get(record.conv) || new Set(); h.add(k); heads.set(record.conv, h); } }
  }

  // κ-diff: pull everything reachable from `remoteHeads` we lack, verify + store each, then return the whole
  // conv history in deterministic causal order. `get` fetches over the mesh (or local); a missing holder
  // just leaves that κ unfetched (caught up later) — the walk never blocks the rest.
  async function sync(conv, remoteHeads) {
    const stack = [...remoteHeads];
    const seen = new Set();
    while (stack.length) {
      const k = stack.pop();
      if (has(k) || seen.has(k)) continue;
      seen.add(k);
      const bytes = await get(k);
      if (!bytes) continue;                                   // holder offline — will resolve on a later sync
      const record = _admit(k, bytes);
      await put(k, bytes);                                    // PERSIST locally + re-announce → we now hold it too (store-and-forward, L3; survives reload)
      for (const p of record.parents || []) if (!has(p)) stack.push(p);
    }
    _recomputeHeads();
    return order(conv);
  }

  // deterministic causal order: topological (a record never precedes its parents), tie-broken by (ts, κ) so
  // every peer that holds the same records produces the SAME ordering.
  function order(conv) {
    const nodes = [...recs.entries()].filter(([, v]) => v.record.conv === conv).map(([k, v]) => [k, v.record]);
    const set = new Set(nodes.map(([k]) => k));
    const indeg = new Map(nodes.map(([k, r]) => [k, (r.parents || []).filter((p) => set.has(p)).length]));
    const children = new Map(nodes.map(([k]) => [k, []]));
    for (const [k, r] of nodes) for (const p of r.parents || []) if (children.has(p)) children.get(p).push(k);
    const byK = new Map(nodes);
    const cmp = (a, b) => { const ra = byK.get(a), rb = byK.get(b); return (ra.ts - rb.ts) || (a < b ? -1 : a > b ? 1 : 0); };
    let ready = nodes.filter(([k]) => indeg.get(k) === 0).map(([k]) => k).sort(cmp);
    const out = [];
    while (ready.length) {
      const k = ready.shift();
      out.push({ kappa: k, ...byK.get(k) });
      for (const c of children.get(k)) { indeg.set(c, indeg.get(c) - 1); if (indeg.get(c) === 0) ready.push(c); }
      ready.sort(cmp);
    }
    return out;
  }

  return { append, sync, hydrate, order, head: headArr, has, record: (k) => (recs.get(k) || {}).record || null };
}
