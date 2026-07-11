// holo-direct-media.mjs — N7/MD1: media travels as CIPHERTEXT on the content network; the KEY travels
// only inside the sealed E2E envelope. The cn store serves raw bytes by κ to ANY peer that asks — so the
// product never puts plaintext media in it: every file is encrypted with a FRESH one-shot AES-GCM-256 key,
// the ciphertext is put+announced (κ_ct addresses it, Law L3), and the {t:"media"} message that rides the
// normal dual-path carries {kappa, key, iv, name, mime, size}. Peers and the drop-box see ciphertext + κ.
// TRADE-OFF (deliberate): re-sending the same file mints a new key → new ciphertext → new κ — cross-send
// dedup is LOST; privacy beats dedup here.
// Receipt is verified twice (Law L5): the content peer re-derives κ on receipt inside the substrate, and
// we re-derive AGAIN locally before decrypting; the decrypted length must match the declared size.
// HONESTY (MD2): a κ-fetch needs the HOLDER online — the sender's tab, or any peer that fetched before.
// The media MESSAGE always arrives (mailbox included); the BYTES resolve when both ends are next up.

const _b64 = (u8) => btoa(String.fromCharCode(...u8));
const _ub64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const TOO_BIG = "That file is over 25 MB — Holo Direct media stops there for now.";
// One cn frame = ONE data-channel message (the substrate does not fragment) and SCTP message size is
// bounded — so the CIPHERTEXT chunks at the media layer: each chunk is its own κ on the content network
// (verified by re-derivation per chunk), the descriptor's `kappa` stays the κ of the WHOLE ciphertext
// (the media id + the final integrity anchor after reassembly). Sequential fetch, no streaming — plain.
export const CHUNK_BYTES = 60 * 1024;

// split the ciphertext into transport-sized chunks — each gets put + announced under its own κ
const _chunks = (ct) => { const out = []; for (let o = 0; o < ct.length; o += CHUNK_BYTES) out.push(ct.subarray(o, Math.min(o + CHUNK_BYTES, ct.length))); return out.length ? out : [ct]; };

// encrypt with a fresh one-shot key, put the CIPHERTEXT (chunked) on the content network, announce it.
// → the descriptor that rides inside the sealed {t:"media"} message (and, vault-sealed, the store).
export async function encryptAndPut(spine, bytes) {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  const kappa = spine.kappa(ct);                              // whole-ciphertext κ — id + reassembly anchor
  const kappas = _chunks(ct).map((c) => { const k = spine.put(c); spine.announce(k); return k; });
  return { kappa, kappas, key: _b64(new Uint8Array(await crypto.subtle.exportKey("raw", key))), iv: _b64(iv), size: bytes.length };
}

// the refusal gate, separable so a witness can drive it without a live fetch: re-derive κ (L5), decrypt,
// size-check — anything that doesn't hold throws and the bytes never reach the UI or the store.
export async function decryptVerified(spine, ct, { kappa, key, iv, size }) {
  if (!spine.verify(ct, kappa)) throw new Error("media refused: bytes do not re-derive to κ");
  const k = await crypto.subtle.importKey("raw", _ub64(key), { name: "AES-GCM" }, false, ["decrypt"]);
  let pt;
  try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: _ub64(iv) }, k, ct)); }
  catch { throw new Error("media refused: decrypt failed (tampered ciphertext or wrong key)"); }
  if (size != null && pt.length !== size) throw new Error("media refused: size mismatch");
  return pt;
}

// fetch the ciphertext chunk-by-chunk from whoever holds it (each chunk verify-on-receipt inside the
// substrate), reassemble, then the refusal gate above re-derives the WHOLE ciphertext's κ.
export async function fetchAndDecrypt(spine, desc, { timeoutMs = 20000 } = {}) {
  const parts = [];
  for (const k of desc.kappas && desc.kappas.length ? desc.kappas : [desc.kappa]) parts.push(await spine.fetch(k, { timeoutMs }));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const ct = new Uint8Array(total);
  let o = 0; for (const p of parts) { ct.set(p, o); o += p.length; }
  return decryptVerified(spine, ct, desc);
}

// re-offer bytes we hold in the vault (sender after reload, or any prior fetcher): AES-GCM is deterministic
// for a fixed key+iv+plaintext, so re-encrypting with the descriptor's own key+iv re-derives the SAME κ —
// the content network sees the identical ciphertext and the peer's pending fetch finds a holder again.
export async function reoffer(spine, bytes, { kappa, key, iv }) {
  try {
    const k = await crypto.subtle.importKey("raw", _ub64(key), { name: "AES-GCM" }, false, ["encrypt"]);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: _ub64(iv) }, k, bytes));
    if (spine.kappa(ct) !== kappa) return false;   // cannot happen unless the vault bytes were altered
    for (const c of _chunks(ct)) spine.announce(spine.put(c));
    return true;
  } catch { return false; }
}
