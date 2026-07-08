// holo-verified-stream-witness.mjs — proves BLAKE3 verified streaming (B3): a κ-object is admitted
// CHUNK BY CHUNK against its root κ, and a tampered chunk is refused AT ITS BOUNDARY, not after the whole
// object. Run: node holo-verified-stream-witness.mjs
import { readFileSync, readdirSync } from "node:fs";
import { blake3hex } from "./usr/lib/holo/holo-blake3.mjs";
import { admitVerified, toBaoStream, consumeStream, resolveStreamVerified, chunkCount } from "./_shared/holo-verified-stream.mjs";

let pass = 0, fail = 0;
const ok = (n, c, got) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + "  got: " + JSON.stringify(got))); };
const eqBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const B = new URL("./b/", import.meta.url);
const files = readdirSync(B).filter((n) => /^[0-9a-f]{64}$/.test(n)).map((n) => [n, readFileSync(new URL(n, B))]);
// pick a big multi-chunk object and a tiny one
const big = files.filter(([, b]) => b.length > 100000).sort((a, b) => b[1].length - a[1].length)[0];
const small = files.filter(([, b]) => b.length > 0 && b.length <= 1024)[0] || files.sort((a, b) => a[1].length - b[1].length)[0];
const bigK = "blake3:" + blake3hex(big[1]), bigN = chunkCount(big[1].length);
console.log("verified-stream witness — big object " + big[1].length + "B (" + bigN + " chunks), small " + small[1].length + "B\n");

// 1 — admitVerified reconstructs byte-identically + re-derives to κ, firing onChunk per chunk
{ let chunks = 0; const out = await admitVerified(bigK, big[1], () => chunks++);
  ok("admitVerified rebuilds the object byte-identically", eqBytes(out, big[1]), { outLen: out.length });
  ok("rebuilt object re-derives to its κ", "blake3:" + blake3hex(out) === bigK, null);
  ok("onChunk fired once per chunk (" + bigN + ")", chunks === bigN, chunks); }
{ const out = await admitVerified("blake3:" + blake3hex(small[1]), small[1]);
  ok("single/small object admits", eqBytes(out, small[1]), null); }

// 2 — wrong κ (bytes' root ≠ named) is refused up front
{ let threw = false; try { await admitVerified("blake3:" + "0".repeat(64), big[1]); } catch { threw = true; }
  ok("bytes whose root ≠ named κ are refused", threw, null); }

// 3 — the self-verifying wire form round-trips
{ const stream = toBaoStream(big[1]); const out = await consumeStream(bigK, stream.chunks);
  ok("toBaoStream → consumeStream round-trips byte-identically", eqBytes(out, big[1]), null);
  ok("bao stream carries the object's true root", stream.root === blake3hex(big[1]), null); }

// 4 — THE headline: a tampered chunk is refused AT ITS BOUNDARY, earlier chunks already admitted
{ const stream = toBaoStream(big[1]);
  const k = Math.floor(bigN / 2);                        // tamper a middle chunk's bytes (proofs stay honest)
  const bad = stream.chunks.map((ev) => (ev.index === k ? { ...ev, bytes: Uint8Array.from(ev.bytes, (x, i) => (i === 0 ? x ^ 0xff : x)) } : ev));
  let admitted = 0, threw = false, threwAt = -1;
  try { await consumeStream(bigK, bad, (idx) => { admitted++; }); }
  catch (e) { threw = true; threwAt = admitted; }
  ok("a tampered chunk is REFUSED (L5)", threw, null);
  ok("refused AT the tampered chunk, not after the whole object", threwAt === k, { threwAt, k, total: bigN });
  ok("chunks BEFORE the tamper were admitted (progressive)", threwAt > 0 && threwAt < bigN, threwAt); }

// 5 — resolveStreamVerified fetches from the store (b/<blake3hex>) and admits
{ const diskFetch = (u) => { try { const b = readFileSync(new URL(u)); return { ok: true, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }; } catch { return { ok: false }; } };
  const out = await resolveStreamVerified({ base: new URL("./", import.meta.url).href, kappa: bigK, fetchFn: diskFetch });
  ok("resolveStreamVerified pulls the κ-object from the store + admits it", eqBytes(out, big[1]), null); }

console.log("\n" + (fail === 0 ? "GREEN" : "RED") + " — " + pass + "/" + (pass + fail) + " witnessed");
process.exit(fail === 0 ? 0 : 1);
