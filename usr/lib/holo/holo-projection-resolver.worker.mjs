// holo-projection-resolver.worker.mjs — the fabric's RESOLVER lane (F1). A module worker: every κ
// resolve, fetch, and verify happens HERE — the main thread never touches a content byte.
//
// Capabilities (SEC-2): the façade mints one MessagePort per experience, granted a NAME-SET. This
// worker refuses any project outside the grant; a revoked port's experience is dead — authority only
// attenuates, enforced at the only place bytes can enter.
//
// The lane speaks want/need/bytes: a "project" first sends WANT to the present worker; if the κ is
// RESIDENT there the projection is a BIND and no fetch happens at all (SEC-3 — the InfiniBand moment).
// Only a NEED comes back here, and then: fetch (the SW's κ-route/rescue rungs answer underneath) →
// re-derive against the κ IN THIS WORKER (L5 — F2 moves big objects onto the GPU) → ownership of the
// buffer MOVES across the lane (zero-copy Transferable).

import { blake3hex } from "./holo-blake3.mjs";

let BASE = "";
let lane = null;
const grants = new Map();           // id → { names:Set, port, revoked }

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.op === "init") {
    BASE = m.base; lane = m.lane;
    lane.onmessage = (ev) => { const n = ev.data || {}; if (n.op === "need") produce(n.id, n.kappa); };
    return;
  }
  if (m.op === "grant") {
    const g = { names: new Set(m.names || []), port: m.port, revoked: false };
    grants.set(m.id, g);
    g.port.onmessage = (ev) => onCap(m.id, g, ev.data || {});
  }
};

function onCap(id, g, m) {
  if (m.op === "revoke") { g.revoked = true; try { g.port.close(); } catch (e) {} return; }
  if (m.op !== "project") return;
  if (g.revoked) return self.postMessage({ op: "refused", id, why: "capability revoked (SEC-2)" });
  if (!g.names.has(m.name)) return self.postMessage({ op: "refused", id, why: "name outside this experience's grant (SEC-2)" });
  const hex = String(m.name).replace(/^blake3:/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) return self.postMessage({ op: "refused", id, why: "F1 speaks blake3 κs (the name plane joins at F5)" });
  lane.postMessage({ op: "want", id, kappa: hex });                       // resident? → bind, no fetch
}

async function produce(id, hex) {
  try {
    const t0 = performance.now();
    // κ-route first: under SW control it verifies + falls to the mirror for pruned objects; the plain
    // b/ path is the uncontrolled-page floor. Either way L5 re-derives below — rungs are hints (SEC-6).
    let r = await fetch(new URL(".holo/blake3/" + hex, BASE), { cache: "no-store" }).catch(() => null);
    if (!r || !r.ok) r = await fetch(new URL("b/" + hex, BASE), { cache: "no-store" });
    if (!r.ok) throw new Error("no rung produced the object (http " + r.status + ")");
    const bytes = new Uint8Array(await r.arrayBuffer());
    const tFetch = performance.now();
    const got = await blake3hex(bytes);                                   // L5 — off-main, before the lane
    if (got !== hex) throw new Error("REFUSED: re-derived " + got.slice(0, 12) + "… ≠ " + hex.slice(0, 12) + "… (L5)");
    const tVerify = performance.now();
    lane.postMessage({ op: "bytes", id, kappa: hex, buf: bytes.buffer,
      fetch_ms: +(tFetch - t0).toFixed(1), verify_ms: +(tVerify - tFetch).toFixed(1) }, [bytes.buffer]);
  } catch (err) {
    lane.postMessage({ op: "fail", id, why: String(err.message || err) });
  }
}
