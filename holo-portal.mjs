// holo-portal.mjs — THE PORTAL. The ONE canonical entry to Hologram.
//
// The URL names a holospace κ; the portal MOUNTS it through the self-contained holospace runtime
// (holospace.mjs `mount(κ)`) — one verb, governed by the holospace laws L1–L5 (content-not-location ·
// canonical forms · the store is the memory · everything through the substrate · verify by re-derivation).
// The device is a portal streaming κ-addressable objects into that runtime; the machine is a κ too, so
// adding a machine (or nesting a whole holospace) is registering one κ — zero change to this door.
//
// Four shapes, one verb:
//   • an APP (default surface, ?app=<κ|dir>, or an app κ) → a `web` holospace. THE BROWSER IS THE MACHINE:
//     the tab BECOMES the app — its own origin, its own SW, its full boot ceremony. A hand-off, not a
//     wrapper (identical to the door's resolve-by-κ, now expressed as mount(κ) — ceremony untouched).
//   • a SINGLE-κ HOLOSPACE in the link (#space=<κ>.<bytes>) → the WHOLE, possibly-nested holospace rides
//     self-contained in the URL, re-derived-or-refused (L5) and mounted. Serverless: opens in ANY fresh
//     browser with no store. THIS IS THE UNIVERSAL RESOLVER — one κ names a whole experience.
//   • a COMPOSITION (?tile=<dir,dir,…>) → a `compositor` holospace tiling child holospaces IN PLACE, then
//     the address bar becomes that composition's single-κ link (compose → share). Nesting falls out: a
//     child that is itself a compositor recurses through the same verb.
//   • any OTHER name → the universal resolver, mounted INLINE at the root (ungated, no boot, every visitor).
//
// Thin browser glue; pure decisions live in holo-root-resolver.mjs (node-testable). CSP-safe: one external
// module, zero inline script (Discord Activities allow same-origin external scripts only).

import { mount, kappaOf, serialize, makeResolver } from "./usr/lib/holo/holospace.mjs";
import { WEB } from "./usr/lib/holo/machine-web.mjs";                            // import = register the `web` machine
import { kappoVerify } from "./usr/lib/holo/holo-kappa.mjs";                     // Law L5 admission (blake3 re-derive)
import { loadAppIndex, findApp } from "./usr/lib/holo/holo-app-index.mjs";
import { parseIntent, chooseTarget, entryFor } from "./holo-root-resolver.mjs";
// machine-compositor is loaded LAZILY (only a composition / κ-space needs it) so the default hand-off stays minimal.

const here = new URL("./", location.href);
const carry = location.search + location.hash;
const beacon = (p) => { try { window.HoloLife && window.HoloLife.mark("portal: " + p); } catch (e) {} };

// url-safe base64 of raw bytes ⇄ bytes (a whole holospace rides in the URL; the manifests are small).
const b64url = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
const unb64url = (str) => { const b = atob(str.replace(/-/g, "+").replace(/_/g, "/")); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
// the canonical single-κ link for a locally-built holospace: #space=<κhex>.<b64url canonical bytes>. The κ
// is the identity of the whole (nested) arrangement (Law L1); the bytes ride along so it needs no store.
const spaceLink = (manifest) => "#space=" + kappaOf(manifest).replace(/^did:holo:blake3:/, "") + "." + b64url(serialize(manifest));

// a web-app holospace: addressed by its signed κ (IDENTITY, Law L1), carrying the index-DERIVED entry URL
// as params.url (convenience). fill:true (default) → the tab becomes it (carry the query/hash across the
// hand-off); fill:false → a tiled pane (no parent carry — the child app owns its own query).
const appWeb = (app, variant, fill = true) => ({
  "@type": "holospace.v1", name: app.title || app.dir, machine: WEB,
  image: "did:holo:" + String(app.kappa || ("sha256:" + app.hex)),
  params: { url: entryFor(app, variant) + (fill ? carry : ""), name: app.title || app.dir, fill },
});

// a name that is not an app → the universal resolver, mounted INLINE at the root (unchanged from the door).
async function resolveHere(nameStr) {
  try { const m = await import("./holo-resolve-view.mjs"); m.mount(document.body, nameStr || ""); }
  catch (e) {
    document.body.innerHTML = '<main style="max-width:720px;margin:9vh auto;padding:0 20px;color:#e9edef;' +
      'font:15px system-ui,sans-serif"><h1 style="font-size:20px">Hologram</h1><p style="color:#8696a0">' +
      'The portal could not load here. Reload, or check your connection.</p></main>';
  }
}

// mount a holospace built HERE (its bytes are warm — held in memory, resolved with zero network, Law L3:
// RAM is the cache, the store is the memory). Returns the mount result; the manifest's κ IS its identity.
async function mountLocal(manifest) {
  const k = kappaOf(manifest), seed = serialize(manifest);
  const resolve = makeResolver(async (kk) => (kk === k ? seed : null));
  return mount(k, document.body, { resolve });
}

(async () => {
  beacon("boot");
  // a CARRY LINK at the root (#recv=1.<axis>.<payload>.<name>): the bytes are IN THE LINK — resolve inline.
  if ((location.hash || "").startsWith("#recv=1.")) return resolveHere("");

  // A SINGLE-κ HOLOSPACE IN THE LINK — the whole (nested) arrangement rides self-contained, verified (L5).
  const spaceM = /^#space=([0-9a-f]{64})\.(.+)$/i.exec(location.hash || "");
  if (spaceM) {
    beacon("space");
    const k = "did:holo:blake3:" + spaceM[1].toLowerCase();
    let bytes = null; try { bytes = unb64url(spaceM[2]); } catch (e) {}
    if (bytes && kappoVerify(bytes, k)) {                              // the link cannot lie — re-derive or refuse
      const { configure } = await import("./usr/lib/holo/machine-compositor.mjs");  // registers the compositor machine
      const resolve = makeResolver(async (kk) => (kk === k ? bytes : null));
      configure({ resolve });
      const r = await mount(k, document.body, { resolve });
      if (r.ok) return beacon("space:mounted");
    }
    return resolveHere("");                                           // tampered / unknown machine → honest fallback
  }

  let frame = false, tile = "";
  try { const q = new URLSearchParams(location.search); frame = q.has("frame_id"); tile = (q.get("tile") || "").trim(); } catch (e) {}

  let index = null;
  try { index = await loadAppIndex({ base: here }); } catch (e) { index = null; }

  // COMPOSITION — ?tile=<dir,dir,…>: open several apps as ONE tiled holospace, in place (the host runtime),
  // then REWRITE the address bar to the composition's single-κ link so it is instantly shareable (compose →
  // share). Opening that link in any fresh browser re-derives + mounts the exact arrangement, serverless.
  if (tile && index) {
    const apps = tile.split(",").map((d) => findApp(index, d.trim())).filter(Boolean);
    if (apps.length) {
      beacon("compose:" + apps.length);
      const { COMPOSITOR, configure } = await import("./usr/lib/holo/machine-compositor.mjs");  // lazy: only a composition needs it
      const space = { "@type": "holospace.v1", name: "Hologram", machine: COMPOSITOR,
        image: apps.map((a) => appWeb(a, null, false)), params: { layout: apps.length === 1 ? "single" : "grid" } };
      const k = kappaOf(space), seed = serialize(space);
      const resolve = makeResolver(async (kk) => (kk === k ? seed : null));
      configure({ resolve });                                          // let the compositor resolve any κ-children
      const r = await mount(k, document.body, { resolve });
      if (r.ok) { try { history.replaceState(null, "", location.pathname + spaceLink(space)); } catch (e) {} return beacon("composed"); }
    }
    // no resolvable tiles → fall through to the default surface
  }

  // APP / NAME — the door's pure decision, now realized as mount(κ).
  const intent = parseIntent({ search: location.search, hash: location.hash, host: location.hostname, frame });
  if (!index) return resolveHere(intent.name || decodeURIComponent((location.hash || "").replace(/^#/, "")));
  const target = chooseTarget({ index, intent, findApp });
  if (target.kind !== "app") return resolveHere(target.name);        // any non-app name → inline resolver

  // an app → a `web` holospace. The browser is the machine: the tab BECOMES it (hand-off, ceremony intact).
  beacon("app:" + (target.app.dir || "app"));
  const r = await mountLocal(appWeb(target.app, target.variant, true));
  if (!r.ok) return resolveHere(target.app.dir || "");              // fail-soft → the inline resolver
})();
