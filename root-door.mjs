// root-door.mjs — the ROOT DOOR is a UNIVERSAL RESOLVER, not a location redirect.
//
// CSP-safe by construction (external module, no inline script: Discord Activities block inline).
// It reads the URL as an OBJECT — a κ or a name, never a path — and resolves it through the
// UPSTREAM HOLOSPACE RUNTIME: holo-app-index maps a signed κ → its re-derived entry (launching IS
// resolving), and the universal name plane (apps/resolve) inspects any other name (content κ · web
// · chain · ipfs), re-deriving-or-refusing every byte (L5). No `apps/<dir>/` pointer lives here:
// the default surface (the messenger app) is opened BY ITS κ, and its path is what the signed index
// derives from that κ. Axis-agnostic — sha256 today, blake3 the instant the release re-seals.
//
// The query string + hash survive every hop (the Embedded App SDK reads frame_id from the document
// it boots in, and a shared object link carries its κ in the hash).

import { loadAppIndex, findApp } from "./usr/lib/holo/holo-app-index.mjs";
import { parseIntent, chooseTarget, entryFor, nameplaneEntry } from "./holo-root-resolver.mjs";

const here = new URL("./", location.href);
let frame = false;
try { frame = new URLSearchParams(location.search).has("frame_id"); } catch (e) {}

const intent = parseIntent({ search: location.search, hash: location.hash, host: location.hostname, frame });
const carry = location.search + location.hash;
const go = (u) => location.replace(new URL(u, here).href);

(async () => {
  try {
    const index = await loadAppIndex({ base: here });          // the SIGNED apps table → one κ per app
    const target = chooseTarget({ index, intent, findApp });
    if (target.kind === "app") return go(entryFor(target.app, target.variant) + carry);
    // a name/κ that is not an app → the universal name plane, itself opened BY ITS κ (never a path)
    const plane = nameplaneEntry(index, findApp, target.name);
    if (plane) return go(plane);
    throw new Error("resolve app not in signed index");        // → the bootstrap floor below
  } catch (e) {
    // IRREDUCIBLE BOOTSTRAP FLOOR: the signed index (release.json) is the map from κ → path; if it
    // itself can't load, there is no κ to resolve, so this ONE literal is the only honest fallback.
    return go("apps/resolve/index.html" + (intent.name ? "?resolve=" + encodeURIComponent(intent.name) : ""));
  }
})();
