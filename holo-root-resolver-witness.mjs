// holo-root-resolver-witness.mjs — proves the ROOT is a universal κ-resolver, not a redirect.
// Run: node holo-root-resolver-witness.mjs   (green ⇒ the contract holds against the SIGNED index)
//
// It asserts, against the real release.json + apps/index.jsonld:
//   1. the door source holds ZERO `apps/<dir>/` location literals (identity is κ, not path)
//   2. empty intent → the default surface (messenger) resolved BY ITS SIGNED κ
//   3. a discord frame → the same κ, discord variant (app-internal, still κ-addressed)
//   4. a name/κ that IS an app (by dir OR by its κ) → launch=resolve to its re-derived entry
//   5. a content name/κ that is NOT an app → the universal name plane (never a dead end)
//   6. isKappa recognises did:holo:/sha256:/blake3:/bare-hex — axis-agnostic, location-free

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadAppIndex, findApp } from "./usr/lib/holo/holo-app-index.mjs";
import { DEFAULT_APP, isKappa, parseIntent, chooseTarget, entryFor, nameplaneEntry } from "./holo-root-resolver.mjs";

const BASE = pathToFileURL(fileURLToPath(new URL("./", import.meta.url))).href;
const diskFetch = (u) => ({ json: async () => JSON.parse(readFileSync(fileURLToPath(new URL(u)), "utf8")) });

let pass = 0, fail = 0;
const ok = (name, cond, got) => { (cond ? (pass++, console.log("  ✓ " + name)) : (fail++, console.log("  ✗ " + name + "  got: " + JSON.stringify(got)))); };

const index = await loadAppIndex({ base: BASE, fetchFn: diskFetch });
const msg = findApp(index, DEFAULT_APP);
const msgKappa = msg && msg.kappa;                         // sha256:766064… today, blake3:… after re-seal

console.log("root-resolver witness — signed index has " + index.apps.length + " apps\n");

// 1 — zero PER-APP location pointers in the door (the old redirect's `apps/holo-messenger/app.html`
//     and the app.html/discord.html hardcodes are gone; identity is κ, path is index-derived)
const doorSrc = readFileSync(fileURLToPath(new URL("./root-door.mjs", import.meta.url)), "utf8");
const codeLines = doorSrc.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");   // ignore comments
ok("door holds no per-app pointer (no messenger/app.html/discord.html literal)", !/apps\/holo-messenger|["'`][^"'`]*(?:app|discord)\.html/.test(codeLines), codeLines.match(/apps\/\S+|\w+\.html/g));
ok("door references the app-index (launch=resolve)", /holo-app-index/.test(doorSrc), null);
// the ONLY structural path literal is the bootstrap floor: apps/resolve/index.html, reached solely
// when the SIGNED INDEX itself can't load (no κ exists to resolve). Assert there is exactly one.
const literals = (codeLines.match(/apps\/[a-z0-9-]+\/[a-z0-9-]+\.html/g) || []);
ok("exactly one path literal, the resolve-surface bootstrap floor", literals.length === 1 && literals[0] === "apps/resolve/index.html", literals);

// 2 — empty → default surface by its SIGNED κ
{ const t = chooseTarget({ index, intent: parseIntent({}), findApp });
  ok("empty intent → app messenger", t.kind === "app" && t.app.dir === "holo-messenger", t);
  ok("default resolves BY its signed κ", t.app && t.app.kappa === msgKappa, t.app && t.app.kappa);
  ok("default entry is app.html (κ-derived path)", /app\.html$/.test(entryFor(t.app, t.variant)), entryFor(t.app, t.variant)); }

// 3 — discord frame → same κ, discord variant
{ const t = chooseTarget({ index, intent: parseIntent({ frame: true }), findApp });
  ok("discord frame → same messenger κ", t.kind === "app" && t.app.kappa === msgKappa, t.app && t.app.kappa);
  ok("discord variant → discord.html", /discord\.html$/.test(entryFor(t.app, "discord")), entryFor(t.app, "discord")); }
{ const t = chooseTarget({ index, intent: parseIntent({ host: "x.discordsays.com" }), findApp });
  ok("discordsays host → discord variant", /discord\.html$/.test(entryFor(t.app, t.variant)), entryFor(t.app, t.variant)); }

// 4 — an app named by dir OR by its κ → launch=resolve
{ const t = chooseTarget({ index, intent: parseIntent({ search: "?app=q" }), findApp });
  ok("?app=q → app q", t.kind === "app" && t.app.dir === "q", t); }
{ const t = chooseTarget({ index, intent: parseIntent({ hash: "#" + msgKappa }), findApp });
  ok("#<messenger κ> → the messenger app (resolve by content address)", t.kind === "app" && t.app.dir === "holo-messenger", t); }

// 5 — a content name/κ that is NOT an app → the universal name plane
{ const t = chooseTarget({ index, intent: parseIntent({ search: "?resolve=vitalik.eth" }), findApp });
  ok("?resolve=vitalik.eth → name plane (not a dead end)", t.kind === "name" && t.name === "vitalik.eth", t); }
{ const stray = "blake3:" + "a".repeat(64);
  const t = chooseTarget({ index, intent: parseIntent({ hash: "#" + stray }), findApp });
  ok("#<unknown blake3 κ> → name plane (verified-or-refused downstream)", t.kind === "name", t); }
{ const e = nameplaneEntry(index, findApp, "vitalik.eth");    // the name plane is itself opened BY ITS κ
  ok("name plane entry is κ-derived from the signed 'resolve' app", /apps\/resolve\/(?:index\.html)?\?resolve=vitalik\.eth$/.test(e), e); }

// 6 — isKappa is axis-agnostic + location-free
ok("isKappa: bare hex", isKappa("a".repeat(64)) === "a".repeat(64), null);
ok("isKappa: sha256:", !!isKappa("sha256:" + "b".repeat(64)), null);
ok("isKappa: blake3:", !!isKappa("blake3:" + "c".repeat(64)), null);
ok("isKappa: did:holo:blake3:", !!isKappa("did:holo:blake3:" + "d".repeat(64)), null);
ok("isKappa: a path is NOT a κ", isKappa("apps/holo-messenger/app.html") === null, null);

console.log("\n" + (fail === 0 ? "GREEN" : "RED") + " — " + pass + "/" + (pass + fail) + " witnessed");
process.exit(fail === 0 ? 0 : 1);
