// holo-rungs.mjs — THE rung ladder (G0 of HOLO-GENESIS-SEED). ONE implementation of
// "resolve a κ from capacity, fail-closed" for every consumer (root-sw κ-route, the evicted-bytes
// rescue, and anything else that fetches by hash):
//
//     device κ-store  →  origin b/<hex>  →  mirror rungs (per axis, DATA not code)
//
// Every rung is UNTRUSTED capacity: a byte only ships after it re-derives to its κ (Law L5/SEC-1).
// Objects ≤ CAP are buffered + verified BEFORE serving — so a poisoned rung's bytes are refused and
// the ladder simply tries the NEXT rung (failover-before-serve), and verified bytes enter the device
// store with no tee gymnastics. Objects > CAP stream through the incremental verifier (fail-closed
// mid-stream; no failover once streaming — the pre-G0 semantics, kept only for the rare giant).
// sha256 > CAP has no streaming verifier: origin may stream it (origin = same-origin trust class),
// a mirror may NOT (refused).
//
// Rungs are DATA: BUILTIN_RUNGS is the bootstrap table; a `/rungs.json` at the bundle root
// ({ "blake3": ["https://…/b/"], "sha256": ["https://…/sha256/"] }) overrides per axis — adding
// capacity (IPFS gateway, a second mirror, a peer) is an append + reseal, zero code. rungs.json is
// deliberately LOW-stakes: it can only add/remove capacity, never corrupt a byte — verification is
// independent of where bytes came from. Fetch trouble → BUILTIN (fail-soft), lazy + memoized,
// restart-safe (no activate-time state; a restarted worker re-fetches once).
import { createBlake3 } from "./holo-blake3.mjs";

export const MIME = { js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json",
  svg: "image/svg+xml", wasm: "application/wasm", html: "text/html", png: "image/png", jpg: "image/jpeg",
  jpeg: "image/jpeg", webp: "image/webp", woff2: "font/woff2", bin: "application/octet-stream" };

export const BUILTIN_RUNGS = {
  blake3: [
    "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/b/",
    "https://hologram-technologies.github.io/hologram-apps/b/",
  ],
  sha256: [
    "https://huggingface.co/HOLOGRAMTECH/holo-messenger-shell/resolve/main/sha256/",
  ],
  // IPFS — the PERMISSIONLESS rung. A BLAKE3 κ IS natively an IPFS CIDv1 (raw codec 0x55, blake3-256
  // multihash 0x1e): no index, no translation — the same content-address, CID-encoded. These gateways
  // address by CID (not raw hex), so the ladder transforms hex→CID below and appends "/ipfs/<cid>".
  // Tried LAST (after the origin + the shell mirrors), so zero hot-path cost; it heals when the
  // centralized rungs miss/censor AND any peer on the decentralized web holds the object. Bounded to
  // single raw blocks (≤ ~1 MiB); larger objects are UnixFS-chunked on IPFS (root CID ≠ κ) and simply
  // miss here → the caller falls through, exactly as before.
  ipfs: [
    "https://ipfs.io",
    "https://dweb.link",
    "https://cloudflare-ipfs.com",
  ],
};

// blake3-hex (32-byte digest) → IPFS CIDv1(raw, blake3-256) → multibase-base32 "b…". Deterministic,
// index-free: this IS the κ, wearing a CID. (varint of 0x01/0x55/0x1e/0x20 is one byte each.)
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function blake3ToCid(hex) {
  const digest = []; for (let i = 0; i < 64; i += 2) digest.push(parseInt(hex.slice(i, i + 2), 16));
  const bytes = [0x01, 0x55, 0x1e, 0x20, ...digest];   // cidv1 · raw · blake3-256 · len 32 · digest
  let bits = 0, val = 0, out = "b";
  for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

const CAP = 64 * 1024 * 1024;   // buffered-verify ceiling — everything in today's closures fits
const IPFS_TIMEOUT = 4000;      // a decentralized-web gateway is best-effort — never hang the ladder on it

export function makeLadder({ base = "", rung = null } = {}) {
  let _rungs = null, _rungsP = null;
  const rungs = () => _rungs || (_rungsP ||= fetch(base + "/rungs.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (_rungs = { ...BUILTIN_RUNGS, ...(j && typeof j === "object" && !Array.isArray(j) ? j : {}) }))
    .catch(() => { _rungsP = null; return BUILTIN_RUNGS; }));

  async function sha256hex(u8) {
    const d = await crypto.subtle.digest("SHA-256", u8);
    return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const derive = async (axis, u8) => (axis === "blake3" ? (() => { const h = createBlake3(); h.update(u8); return h.hex(); })() : await sha256hex(u8));

  // incremental blake3 verifier for the >CAP streaming path (errors the stream on mismatch)
  function verifierFor(hex) {
    const h = createBlake3();
    return new TransformStream({
      transform(chunk, ctrl) { h.update(chunk); ctrl.enqueue(chunk); },
      flush(ctrl) { if (h.hex() !== hex) ctrl.error(new Error("κ mismatch — refused (L5): " + hex.slice(0, 12) + "…")); },
    });
  }

  const R = async () => { if (!rung) return null; try { return await rung(); } catch { return null; } };
  const headersFor = (ext, r) => ({ "content-type": MIME[ext] || (r && r.headers.get("content-type")) || "application/octet-stream" });

  // resolve(axis, hex, { ext, extraMirrors, skipOrigin }) →
  //   verified Response (200) · last MISS Response (a 404 the caller may pass through) · null (all rungs dead).
  // A response that reaches the caller with .ok either re-derived here or is the >CAP streaming path.
  async function resolve(axis, hex, { ext = "", extraMirrors = [], skipOrigin = false } = {}) {
    const store = await R();
    if (store) {   // O2: the device store answers first — warm boot must never add a network hop
      try { const u8 = await store.get(axis, hex); if (u8) return new Response(u8, { status: 200, headers: { ...headersFor(ext), "x-holo-source": "device-store", "x-holo-kappa": axis + ":" + hex } }); } catch {}
    }
    const table = await rungs();
    const bases = [...(skipOrigin ? [] : [base + "/b/"]), ...extraMirrors, ...(table[axis] || [])];
    let miss = null;

    // buffer + re-derive + serve one rung response. Returns a verified Response, or null (miss/poisoned/
    // giant-unverifiable) so the caller tries the next rung. `origin` = same-origin trust class.
    const serveVerified = async (r, srcLabel, origin) => {
      const len = Number(r.headers.get("content-length") || 0);
      const headers = { ...headersFor(ext, r), "x-holo-kappa": axis + ":" + hex, "x-holo-source": srcLabel };
      if (len > CAP || !r.body) {                              // the rare giant — pre-G0 semantics
        if (axis === "blake3" && r.body) return new Response(r.body.pipeThrough(verifierFor(hex)), { status: 200, headers });
        if (origin) return new Response(r.body, { status: 200, headers });   // origin sha256 giant: streamed, origin trust class
        store && store.witness && store.witness("kappa-rung-oversize", { axis, hex, rung: srcLabel });
        return null;                                           // mirror sha256 giant: unverifiable → next rung
      }
      let u8;
      try { u8 = new Uint8Array(await r.arrayBuffer()); } catch { return null; }
      if (u8.length > CAP) { if (origin && axis !== "blake3") return new Response(u8, { status: 200, headers }); return null; }
      if ((await derive(axis, u8)) !== hex) {                  // poisoned rung: refuse ITS bytes, try the next
        store && store.witness && store.witness("kappa-route-mismatch", { axis, want: hex, source: srcLabel });
        return null;
      }
      if (store) { try { store.put(axis, hex, u8); } catch {} }
      return new Response(u8, { status: 200, headers });
    };

    for (let i = 0; i < bases.length; i++) {
      const origin = !skipOrigin && i === 0;
      let r = null;
      try { r = await fetch(bases[i] + hex); } catch { continue; }
      if (!r.ok) { miss = miss || r; continue; }
      const served = await serveVerified(r, origin ? "origin-b" : "rung-" + i, origin);
      if (served) return served;
    }

    // IPFS — the permissionless, decentralized-web rung (blake3 only: κ IS a CIDv1). Tried LAST, so it
    // costs nothing on the hot path; it heals when the centralized rungs miss AND any peer holds the κ.
    if (axis === "blake3") {
      const gws = table.ipfs || [];
      if (gws.length) {
        const cid = blake3ToCid(hex);
        for (const gw of gws) {
          let r = null;
          try {
            const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
            const t = ac && setTimeout(() => ac.abort(), IPFS_TIMEOUT);
            r = await fetch(gw.replace(/\/$/, "") + "/ipfs/" + cid, ac ? { signal: ac.signal } : {});
            if (t) clearTimeout(t);
          } catch { continue; }
          if (!r || !r.ok) { if (r) miss = miss || r; continue; }
          const served = await serveVerified(r, "ipfs:" + gw.replace(/^https?:\/\//, "").replace(/\/.*/, ""), false);
          if (served) return served;
        }
      }
    }
    return miss;
  }

  return { resolve, rungs, verifierFor };
}
