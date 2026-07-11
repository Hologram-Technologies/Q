// holo-direct-store.mjs — the conversation that SURVIVES: contacts + messages in IndexedDB, every record
// body VAULT-ENCRYPTED at rest (AES-GCM-256 under a non-extractable CryptoKey — holo-direct-id holds it the
// same way it holds the identity: structured clone only, key material can never serialize). Only the fields
// that must index stay plaintext: κ (already public on the wire), contactId, ts.
//
// HONESTY (write this into any UI that claims "encrypted at rest"): the vault protects the words from
// casual exfiltration — another origin, a copied profile folder read elsewhere, a backup blob. It does NOT
// protect against code running AS this origin or an attacker inside this OS profile; the OS login/TEE is
// that boundary. Name it, don't imply more.
//
//   const store = await openStore({ ns, vaultKey });
//   store.putContact(id, {pub, name}) · store.contacts() · store.putMsg({kappa, contactId, ts, dir, text,
//   status}) · store.msgs(contactId, {limit}) · store.hasMsg(κ) · store.markDelivered(κ) ·
//   store.lastMsg(contactId) · store.getMeta(k)/setMeta(k,v) · store.close()
//
// One operator namespace per store (same rule as identity): operator `ns` prefixes every IDB key, so two
// operators on one device never see each other's threads.

const DB = "holo-direct-store", VER = 2;
const _te = new TextEncoder(), _td = new TextDecoder();

function _open() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB, VER);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains("contacts")) db.createObjectStore("contacts");           // key: ns|contactId
      if (!db.objectStoreNames.contains("msgs")) {
        const s = db.createObjectStore("msgs");                                                   // key: ns|κ
        s.createIndex("byContact", ["nsContact", "ts"]);                                          // [ns|contactId, ts]
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");                    // key: ns|name
      if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");                  // key: ns|κ_ct (N7)
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
const _tx = (db, store, mode, fn) => new Promise((res, rej) => {
  const tx = db.transaction(store, mode); const out = fn(tx.objectStore(store));
  tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
  tx.onerror = () => rej(tx.error);
});
const _req = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

export async function openStore({ ns = "guest", vaultKey } = {}) {
  if (!vaultKey) throw new Error("openStore needs the operator's vault key (holo-direct-id.getVaultKey)");
  const db = await _open();
  const K = (s) => ns + "|" + s;

  async function _seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultKey, _te.encode(JSON.stringify(obj)));
    return { iv: [...iv], ct: new Uint8Array(ct) };
  }
  async function _openRec(rec) {
    if (!rec) return null;
    try { return JSON.parse(_td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, vaultKey, rec.ct))); }
    catch { return null; }   // wrong vault (other operator's record) or corruption → absent, never garbage
  }

  return {
    async putContact(contactId, body) {                       // body = {pub:{sign,box}, name?, addedTs}
      const rec = await _seal(body); await _tx(db, "contacts", "readwrite", (s) => s.put(rec, K(contactId)));
    },
    async contacts() {                                        // → [{contactId, pub, name?, addedTs}]
      const keys = await _tx(db, "contacts", "readonly", (s) => _req(s.getAllKeys())).then((p) => p);
      const recs = await _tx(db, "contacts", "readonly", (s) => _req(s.getAll())).then((p) => p);
      const out = [];
      for (let i = 0; i < keys.length; i++) {
        if (!String(keys[i]).startsWith(ns + "|")) continue;
        const body = await _openRec(recs[i]); if (body) out.push({ contactId: String(keys[i]).slice(ns.length + 1), ...body });
      }
      return out;
    },
    async putMsg({ kappa, contactId, ts, dir, text, status = null, media = null }) {
      const rec = await _seal({ dir, text, status, ...(media ? { media } : {}) });   // media = the sealed descriptor {kappa,key,iv,name,mime,size} (N7)
      rec.nsContact = K(contactId); rec.ts = ts || Date.now(); rec.kappa = kappa;
      await _tx(db, "msgs", "readwrite", (s) => s.put(rec, K(kappa)));
    },
    async hasMsg(kappa) {
      return (await _tx(db, "msgs", "readonly", (s) => _req(s.getKey(K(kappa))))) !== undefined;
    },
    async msgs(contactId, { limit = 200 } = {}) {             // → oldest→newest [{kappa, ts, dir, text, status}]
      const recs = await _tx(db, "msgs", "readonly", (s) =>
        _req(s.index("byContact").getAll(IDBKeyRange.bound([K(contactId), -Infinity], [K(contactId), Infinity]))));
      const out = [];
      for (const r of recs.slice(-limit)) { const body = await _openRec(r); if (body) out.push({ kappa: r.kappa, ts: r.ts, ...body }); }
      return out;
    },
    async markDelivered(kappa) {
      const rec = await _tx(db, "msgs", "readonly", (s) => _req(s.get(K(kappa)))); if (!rec) return false;
      const body = await _openRec(rec); if (!body || body.dir !== "out") return false;
      body.status = "delivered";
      const sealed = await _seal(body); sealed.nsContact = rec.nsContact; sealed.ts = rec.ts; sealed.kappa = rec.kappa;
      await _tx(db, "msgs", "readwrite", (s) => s.put(sealed, K(kappa)));
      return true;
    },
    async setMsgStatus(kappa, status) {                       // any-direction status flip (N7: pending-bytes → fetched)
      const rec = await _tx(db, "msgs", "readonly", (s) => _req(s.get(K(kappa)))); if (!rec) return false;
      const body = await _openRec(rec); if (!body) return false;
      body.status = status;
      const sealed = await _seal(body); sealed.nsContact = rec.nsContact; sealed.ts = rec.ts; sealed.kappa = rec.kappa;
      await _tx(db, "msgs", "readwrite", (s) => s.put(sealed, K(kappa)));
      return true;
    },
    async lastMsg(contactId) { const m = await this.msgs(contactId, { limit: 1 }); return m[m.length - 1] || null; },
    // ── media BYTES (N7/MD3): plaintext lives ONLY here, vault-encrypted like every other body. Binary
    // framing (not JSON — bytes must not round-trip through strings): [u32 headLen][head JSON][raw bytes].
    async putMedia(kappa, { bytes, name, mime }) {
      const head = _te.encode(JSON.stringify({ name, mime, len: bytes.length }));
      const buf = new Uint8Array(4 + head.length + bytes.length);
      new DataView(buf.buffer).setUint32(0, head.length);
      buf.set(head, 4); buf.set(bytes, 4 + head.length);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, vaultKey, buf));
      await _tx(db, "media", "readwrite", (s) => s.put({ iv: [...iv], ct }, K(kappa)));
    },
    async getMedia(kappa) {                                   // → {bytes, name, mime} | null
      const rec = await _tx(db, "media", "readonly", (s) => _req(s.get(K(kappa)))); if (!rec) return null;
      try {
        const buf = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(rec.iv) }, vaultKey, rec.ct));
        const headLen = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
        const head = JSON.parse(_td.decode(buf.subarray(4, 4 + headLen)));
        return { bytes: buf.slice(4 + headLen), name: head.name, mime: head.mime };
      } catch { return null; }                                // wrong vault or corruption → absent, never garbage
    },
    async hasMedia(kappa) {
      return (await _tx(db, "media", "readonly", (s) => _req(s.getKey(K(kappa))))) !== undefined;
    },
    async getMeta(name) { return _openRec(await _tx(db, "meta", "readonly", (s) => _req(s.get(K(name))))); },
    async setMeta(name, val) { const rec = await _seal(val); await _tx(db, "meta", "readwrite", (s) => s.put(rec, K(name))); },
    close: () => db.close(),
  };
}
