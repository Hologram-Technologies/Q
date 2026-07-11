// holo-direct-id.mjs — the identity that SURVIVES: one sovereign holo-seal identity per operator, persisted
// as CryptoKeys in IndexedDB (structured clone — the NON-EXTRACTABLE private halves never exist as bytes the
// page can read, so nothing here can be exfiltrated, logged, or synced by accident). Same operator tomorrow →
// same keys → same safety number → verified STAYS verified. Without this, every reload minted a fresh identity
// and a returning operator LOOKED like a key-change to every contact (K1, HOLO-NATIVE-NET-ONE-LINK-PROMPT).
//
//   const { identity, myPub } = await getIdentity({ ns });
//
// `ns` is the operator namespace: the signed-in sovereign identity's stable id when there is one, else "guest"
// — a guest device keeps ONE stable identity per origin ("this device"), never per session. Key roam across
// devices is the sovereign-identity/TEE roadmap, deliberately NOT this file.

import * as Seal from "./holo-seal.mjs?v=n8";

const DB = "holo-direct-id", STORE = "ids", VER = 1;

function _open() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => { if (!rq.result.objectStoreNames.contains(STORE)) rq.result.createObjectStore(STORE); };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
function _get(db, key) {
  return new Promise((res, rej) => { const rq = db.transaction(STORE, "readonly").objectStore(STORE).get(key); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
}
function _put(db, key, val) {
  return new Promise((res, rej) => { const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(val, key); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}

// the operator's VAULT key — AES-GCM-256, non-extractable, lives beside the identity in the same IDB.
// holo-direct-store encrypts every record body under it ("sealed at rest"). Same namespace rule.
export async function getVaultKey({ ns = "guest" } = {}) {
  const key = ns + "|vault";
  try {
    const db = await _open();
    let k = await _get(db, key);
    if (!k) { k = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); await _put(db, key, k); }
    db.close(); return k;
  } catch { return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
}

export async function getIdentity({ ns = "guest" } = {}) {
  let identity = null;
  try {
    const db = await _open();
    identity = await _get(db, ns);
    if (!identity || !identity.sign || !identity.box) {
      identity = await Seal.generateIdentity();
      await _put(db, ns, identity);              // CryptoKeys structured-clone; no serialization ever
    }
    db.close();
  } catch {
    // IDB unavailable (rare: private-mode quirks) → honest degradation to a session identity; the caller's
    // UX still works, it just won't survive reload — same behavior as before this module existed.
    identity = identity || await Seal.generateIdentity();
  }
  return { identity, myPub: await Seal.exportPublic(identity) };
}
