// browser-sw.js — Holo Browser's loading seam, as a service worker. This IS Chromium's
// URLLoaderFactory → URLLoader → ResourceHandler chain (the Network Service), realized over
// the κ-store: every resource the renderer iframe is about to see passes through here and is
// content-addressed + VERIFIED BY RE-DERIVATION before it is served (Law L5). A byte that does
// not re-derive to its address is REFUSED with 502. The native CEF build wires the same seam
// with CefResourceHandler; this is the in-OS twin.
//
// Scope: <base>webview/ (derived from the SW's own registration, base-path aware like
// ipfs-sw.js, so it works at the origin root or under /<repo>/ on static hosting).
//
//   <base>webview/h/<κ>            — a holo://<κ> document: served from the κ-store, re-derived.
//   <base>webview/w/<b64url(url)>  — a live http(s) page: fetched once through the dumb /web
//                                    proxy, MINTED into a κ (blake3 over its bytes), cached,
//                                    re-derived, then served. First sighting mints the address;
//                                    every replay re-derives it.
//   any cross-origin request from a webview iframe — a navigation is re-entered into the
//                                    content-addressed renderer (302 → webview/w/…); a
//                                    subresource is proxied + minted + re-derived on the fly.
//
// IPFS/IPNS are handled by the Holo IPFS gateway (ipfs-sw.js, scope <base>ipfsview/), which the
// page registers alongside this one — the dweb protocol handler is reused, not reimplemented.
//
// Module service worker → it imports the SAME engine the page + witness + MCP tools use.

import { kappaOf, verifyKappa } from "./_shared/holo-browser.js";
import { mimeByExt } from "./_shared/holo-ipfs.js";
import { ruleMatches } from "./_shared/holo-crx.js";
import { contentScriptTags } from "./_shared/holo-ext.js";

const KSTORE = "holo-browser-kappa-v1";              // Cache API: minted/owned blocks, keyed by κ
const VIEW = new URL(self.registration.scope).pathname.replace(/\/?$/, "/");   // <base>webview/
const APP_BASE = VIEW.replace(/webview\/$/, "");     // <base>
const WEB_PROXY = APP_BASE + "web?url=";             // holo-serve's dumb-pipe live-web proxy

// ── installed κ-addressed extensions, projected onto the seam (the page posts seamBundle() on any
// install/enable/disable). browser-sw.js IS Chromium's URLLoaderFactory over the κ-store, so MV3's
// declarativeNetRequest maps STRAIGHT onto it: every request is matched against the enabled compiled
// ruleset before it is fetched/minted, and matching content scripts are inlined into served HTML.
// Only bytes that re-derived to a κ-verified extension (holo-ext.install, Law L5) ever reach here. ─
let EXT = { dnr: [], contentScripts: [] };
const REQTYPE = { document: "main_frame", iframe: "sub_frame", frame: "sub_frame", script: "script", style: "stylesheet", image: "image", imageset: "image", font: "font", media: "media", track: "media", object: "object", embed: "object", worker: "script", "": "xmlhttprequest" };
const resourceTypeOf = (req) => req.mode === "navigate" ? (req.destination === "iframe" || req.destination === "frame" ? "sub_frame" : "main_frame") : (REQTYPE[req.destination] || "xmlhttprequest");
// match a request URL against the compiled DNR ruleset → the winning action ({type:"allow"} if none).
function dnrAction(url, resourceType) {
  for (const r of EXT.dnr) { try { if (ruleMatches(r, url, resourceType)) return { ...(r.action || { type: "block" }), extId: r.extId, ruleId: r.id }; } catch {} }
  return { type: "allow" };
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// ── base64url for the web token (isomorphic; no Buffer in a SW) ──────────────────────
const enc = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const dec = (s) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return decodeURIComponent(escape(atob(t.padEnd(Math.ceil(t.length / 4) * 4, "=")))); };

// ── κ-store over the Cache API (shared with the page; both are same-origin) ──────────
async function kPut(kappa, bytes, meta = {}) {
  const cache = await caches.open(KSTORE);
  await cache.put("/__k/" + kappa, new Response(bytes, { headers: { "content-type": meta.contentType || "application/octet-stream", "x-holo-source": meta.source || "" } }));
}
async function kGet(kappa) { const cache = await caches.open(KSTORE); const r = await cache.match("/__k/" + kappa); return r ? new Uint8Array(await r.arrayBuffer()) : null; }

// ── URL→κ index — the L3 line: the store is the memory, a repeat visit is a cache hit.
// Every GET that mints records url → {kappa, contentType, ts}; a later request for the same URL
// serves the κ-store FIRST (re-derived, Law L5) and touches the wire only on a miss. This is
// what makes the browser work on a 100% serverless mount, and offline, by law not by luck. ──
const USTORE = "holo-browser-url-v1";
async function uPut(realUrl, entry) { try { const cache = await caches.open(USTORE); await cache.put("/__u/" + enc(realUrl), new Response(JSON.stringify(entry), { headers: { "content-type": "application/json" } })); } catch {} }
async function uGet(realUrl) { try { const cache = await caches.open(USTORE); const r = await cache.match("/__u/" + enc(realUrl)); return r ? await r.json() : null; } catch { return null; } }
// serve a URL straight from the κ-store if we hold it (verified) — null means "go to the wire".
async function uServe(realUrl, fallbackCt) {
  const u = await uGet(realUrl);
  if (!u || !u.kappa) return null;
  const bytes = await kGet(u.kappa);
  if (!bytes || !verifyKappa(u.kappa, bytes)) return null;   // absent or forged → the wire decides
  return { kappa: u.kappa, bytes, contentType: u.contentType || fallbackCt };
}

// ── egress ladder — WHO answers the web?url= contract is a deployment detail (the SEC-7
// endgame is a content-blind P2P exit-peer; these are the roads that exist today):
//   1 · the local /web route (dev server / desktop host): cookies, POST, headless-Chrome docs.
//       Authoritative IFF the answer carries x-holo-web:1 — a static host (GitHub Pages) answers
//       this path with its own 404 page, which must never be mistaken for the upstream.
//   2 · a straight CORS fetch — CORS-open origins (CDNs, APIs, IPFS gateways) need no middleman.
//   3 · public CORS relays — untrusted TRANSPORT for the serverless mount; L5 mints over the
//       bytes that arrive and the seal is labeled "relay", honest and visible.
// Every tier's product is minted + re-derived identically; only who carried the bytes differs. ──
let PROXY_DOWN_UNTIL = 0;                            // a dead tier-1 is remembered for 60s, then re-probed
const RELAYS = [
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
];
async function egressFetch(realUrl, init) {
  const tiers = [];
  if (Date.now() >= PROXY_DOWN_UNTIL) tiers.push(["proxy", () => fetch(WEB_PROXY + encodeURIComponent(realUrl), init)]);
  // seam-private headers would force a CORS preflight no third party approves — strip them for 2/3
  const dinit = { ...init };
  if (dinit.headers) { const h = { ...dinit.headers }; delete h["x-holo-doc"]; delete h["x-holo-operator"]; dinit.headers = h; }
  tiers.push(["direct", () => fetch(realUrl, dinit)]);
  for (const relay of RELAYS) tiers.push(["relay", () => fetch(relay(realUrl), dinit)]);
  let upstream = null;                               // the best non-ok answer seen, reported honestly if no tier lands
  for (const [via, go] of tiers) {
    let r; try { r = await go(); } catch { if (via === "proxy") PROXY_DOWN_UNTIL = Date.now() + 60_000; continue; }
    if (via === "proxy" && !r.headers.get("x-holo-web")) { PROXY_DOWN_UNTIL = Date.now() + 60_000; continue; }   // a static host's 404, not the proxy
    if (r.ok) return { r, via };
    if (via === "proxy") return { r, via };          // the proxy relays the upstream's real status — authoritative
    if (!upstream) upstream = { r, via };
  }
  return upstream || { r: null, via: "none" };
}

// tell the page what committed (κ, mint/verify state) so the omnibox HUD reflects the load.
async function broadcast(msg) { for (const c of await self.clients.matchAll({ includeUncontrolled: true })) c.postMessage(msg); }

// ── HTML rewrite — the renderer's two seams ─────────────────────────────────────────
// 1) inject <base href=realUrl> so RELATIVE SUBRESOURCES (css/js/img/font) resolve to their
//    real absolute URLs; the SW intercepts those (a controlled client's subresource requests
//    fire the fetch event for ANY origin) and mints each.
// 2) rewrite NAVIGATIONS (<a href>, GET <form action>) to in-scope self-origin /webview/w/…
//    URLs. A service worker only intercepts navigations to IN-SCOPE targets, so a link to the
//    real cross-origin URL would escape (ERR_NAME_NOT_RESOLVED); routing clicks back through
//    the scope keeps every page content-addressed. (JS-driven navigation is a known caveat.)
// We do NOT neutralize scripts — the iframe is sandboxed by the page; this is a browser.
function rewriteHtml(text, realUrl, kappa) {
  const SELF = self.location.origin;
  const wrap = (href) => { try { const abs = new URL(href, realUrl).href; return /^https?:/i.test(abs) ? SELF + VIEW + "w/" + enc(abs) : href; } catch { return href; } };
  // <a ... href="X"> → in-scope wrapper (skip in-page anchors + non-navigational schemes)
  text = text.replace(/(<a\b[^>]*?\shref\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, href) => (/^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(href.trim()) ? m : pre + q + wrap(href) + q));
  text = text.replace(/(<form\b[^>]*?\saction\s*=\s*)(["'])(.*?)\2/gi, (m, pre, q, act) => pre + q + wrap(act) + q);
  const inj = injectContentScripts(realUrl);          // matching MV3 content scripts (DNR's sibling)
  const stamp = `<base href="${realUrl.replace(/"/g, "&quot;")}">`
    + `<meta name="holo-source" content="${realUrl.replace(/"/g, "&quot;")}">`
    + `<meta name="holo-kappa" content="${kappa}">`
    + inj.head;                                        // document_start scripts + content-script css
  const tail = (inj.tail || "") + GUARD_TAG;           // the page-world guard rides every live page
  text = /<\/body>/i.test(text) ? text.replace(/<\/body>/i, tail + "</body>") : text + tail;
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (h) => h + stamp);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (h) => h + "<head>" + stamp + "</head>");
  return stamp + text;
}

// ── page-world guard, injected into every rewritten live-web document ────────────────
// (a) navigation keeper: a form action or <a href> that page JS (re)writes AFTER the static
//     rewrite above would navigate the sandboxed iframe straight to the cross-origin site,
//     where X-Frame-Options kills the render. Re-wrap at use time (submit/click, capture
//     phase) so those navigations re-enter the κ seam too.
// (b) cookie-consent auto-reject: the /web proxy is a stateless dumb pipe (no cookies either
//     way), so consent walls would re-appear on EVERY page. Hide the known CMP shells and
//     click one explicit "reject"-style control (only inside consent-scented containers).
// Injected as (fn)(VIEW) via toString() — page world, fail-open, self-disarms after 20s.
function pageGuard(VIEW) {
  try {
    var enc = function (s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
    var wrap = function (h) { try { if (!h) return null; var a = new URL(h, document.baseURI); if ((a.protocol === "http:" || a.protocol === "https:") && a.origin !== location.origin) return location.origin + VIEW + "w/" + enc(a.href); } catch (e) {} return null; };
    addEventListener("submit", function (e) { try { var f = e.target; if (!f || !f.getAttribute) return; var w = wrap(f.getAttribute("action") || ""); if (w) f.setAttribute("action", w); } catch (_) {} }, true);
    addEventListener("click", function (e) { try { var a = e.target && e.target.closest ? e.target.closest("a[href]") : null; if (!a) return; var w = wrap(a.getAttribute("href") || ""); if (w) a.setAttribute("href", w); } catch (_) {} }, true);
    // consent auto-reject — cosmetic hide for the big CMPs, then one reject click, then stand down.
    var st = document.createElement("style");
    st.textContent = "#onetrust-consent-sdk,#onetrust-banner-sdk,#CybotCookiebotDialog,#CybotCookiebotDialogBodyUnderlay,.qc-cmp2-container,.fc-consent-root,#didomi-host,.didomi-popup-backdrop,[id^=sp_message_container],#cmpbox,#cmpbox2,#usercentrics-root,.truste_box_overlay,.truste_overlay,.cc-window.cc-banner{display:none !important}";
    (document.head || document.documentElement).appendChild(st);
    var RX = /^(reject all|reject|decline( all)?|refuse( all)?|deny( all)?|disagree|only (necessary|essential|required)( cookies)?|(use|accept) (only )?(necessary|essential|required)( cookies)?|necessary (cookies )?only|continue without (accepting|agreeing|consent)|alle ablehnen|ablehnen|tout refuser|rechazar todo|rifiuta tutti|отклонить все|alles afwijzen|weigeren)$/i;
    var SEL = "#onetrust-reject-all-handler,.ot-pc-refuse-all-handler,#CybotCookiebotDialogBodyButtonDecline,.cc-deny";
    var scented = function (el) { var n = el, d = 0; while (n && n.getAttribute && d++ < 8) { var s = ((n.id || "") + " " + (n.getAttribute("class") || "") + " " + (n.getAttribute("aria-label") || "")).toLowerCase(); if (/cookie|consent|gdpr|privacy|\bcmp\b|onetrust|didomi|cookiebot|usercentrics|truste|sp_message/.test(s)) return true; n = n.parentElement; } return false; };
    var done = false;
    var tryReject = function (root) {
      if (done) return;
      var b = null; try { b = root.querySelector(SEL); } catch (_) {}
      if (!b) {
        // an unambiguous "reject all"-class phrase needs no consent-scented ancestor (Google's
        // consent interstitial carries no tell-tale ids); weaker words (decline, deny) do.
        var STRONG = /^(reject all|refuse all|deny all|decline all|alle ablehnen|tout refuser|rechazar todo|rifiuta tutti|отклонить все|alles afwijzen)$/i;
        var cs = root.querySelectorAll("button,[role=button],input[type=submit],input[type=button],a");
        for (var i = 0; i < cs.length && i < 500; i++) {
          var t = (cs[i].innerText || cs[i].value || cs[i].getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
          if (t && t.length < 60 && (STRONG.test(t) || (RX.test(t) && scented(cs[i])))) { b = cs[i]; break; }
        }
      }
      if (b) { done = true; try { b.click(); } catch (_) {} }
    };
    var pass = function () { tryReject(document); var fs = document.querySelectorAll("iframe"); for (var i = 0; i < fs.length; i++) { try { if (fs[i].contentDocument) tryReject(fs[i].contentDocument); } catch (_) {} } };
    if (document.readyState !== "loading") pass(); else addEventListener("DOMContentLoaded", pass);
    var last = 0;
    var mo = new MutationObserver(function () { var n = Date.now(); if (done || n - last < 300) return; last = n; pass(); });
    try { mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}
    setTimeout(function () { try { mo.disconnect(); } catch (_) {} }, 20000);
  } catch (e) {}
}
const GUARD_TAG = `<script data-holo="guard">(${pageGuard.toString()})(${JSON.stringify(VIEW)})</script>`;

// ── content_scripts — inline the enabled scripts that match this page (run_at honoured) ──────────
// document_start → injected at <head> open; document_end/idle → before </body>. A minimal page-world
// chrome.* shim (holo-ext) is prepended so a content script finds chrome.storage/runtime. HONEST
// subset: page world, NOT an isolated world; the hard APIs are native-only (analyzeManifest flags
// them). The native CEF build runs these in a real isolated world via the extension subsystem.
// The rendering logic lives in holo-ext.contentScriptTags() (shared + witnessed), not duplicated here.
const injectContentScripts = (realUrl) => contentScriptTags(EXT.contentScripts, realUrl);
// splice an { head, tail } injection into an HTML string (head at <head> open, tail before </body>).
function injectIntoHtml(text, inj) {
  if (inj.tail) text = /<\/body>/i.test(text) ? text.replace(/<\/body>/i, inj.tail + "</body>") : text + inj.tail;
  if (!inj.head) return text;
  if (/<head[^>]*>/i.test(text)) return text.replace(/<head[^>]*>/i, (h) => h + inj.head);
  if (/<html[^>]*>/i.test(text)) return text.replace(/<html[^>]*>/i, (h) => h + "<head>" + inj.head + "</head>");
  return inj.head + text;
}
// a blocked main_frame (DNR matched the navigation itself) → an honest interstitial, not a dead tab.
function blockedPage(realUrl, act) {
  const safe = String(realUrl).replace(/[<&"]/g, (c) => ({ "<": "&lt;", "&": "&amp;", '"': "&quot;" }[c]));
  const html = `<!doctype html><meta charset=utf-8><title>Blocked by extension</title><style>body{font:15px/1.6 system-ui;background:#0a0e14;color:#e8eef5;margin:0;display:grid;place-items:center;height:100vh}.b{max-width:520px;padding:2rem;text-align:center}h1{color:#ea4335;font-size:1.2rem}code{background:#11151c;padding:.15rem .4rem;border-radius:6px;color:#fbbc04;word-break:break-all}</style><div class=b><h1>Blocked by a κ-verified extension</h1><p>A declarativeNetRequest rule (extension <code>${act.extId || "?"}</code>, rule ${act.ruleId ?? "?"}) blocked this request.</p><p><code>${safe}</code></p></div>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-holo-blocked": String(act.extId || "1"), ...COEPH } });
}

// holo-serve makes the page cross-origin-isolated (COOP same-origin + COEP credentialless), so
// every document/subresource the renderer iframe loads must carry compatible COEP/CORP or it is
// blocked (chrome-error). The SW serves same-origin from the κ-store, so it stamps them itself.
const COEPH = { "cross-origin-embedder-policy": "credentialless", "cross-origin-opener-policy": "same-origin", "cross-origin-resource-policy": "cross-origin" };
const refused = (why) => new Response("Holo Browser refused this resource (Law L5):\n" + why, { status: 502, headers: { "content-type": "text/plain", ...COEPH } });
const KHDR = (kappa, ct, extra = {}) => ({ "content-type": ct, "x-holo-cid": kappa, "x-holo-verified": "L5", "cache-control": "no-store", ...COEPH, ...extra });

// ── serve a holo://<κ> document from the κ-store, re-derived (Law L5) ────────────────
async function serveKappa(kappa, path) {
  const bytes = await kGet(kappa);
  if (!bytes) { await broadcast({ type: "committed", view: VIEW + "h/" + kappa, kappa, verified: false, refused: true, scheme: "holo" }); return refused("κ not in the store (open it from a source that owns the bytes): " + kappa); }
  if (!verifyKappa(kappa, bytes)) { await broadcast({ type: "committed", view: VIEW + "h/" + kappa, kappa, verified: false, refused: true, scheme: "holo" }); return refused("κ re-derivation failed — forged byte: " + kappa); }
  const ct = mimeByExt(path || "") || "text/html; charset=utf-8";
  // The κ verifies the SOURCE (re-derivation above, Law L5). A content-script extension may then
  // transform the rendered VIEW — a labeled, opt-in change, NOT a change to what re-derives: the
  // served κ (x-holo-cid) is still the original source. Only HTML, only if a matching script exists.
  let body = bytes, transformed = null;
  if (/text\/html/i.test(ct)) {
    const inj = injectContentScripts("holo://" + kappa);
    if (inj.head || inj.tail) {
      body = new TextEncoder().encode(injectIntoHtml(new TextDecoder().decode(bytes), inj));
      transformed = [...new Set([...(inj.head + inj.tail).matchAll(/data-holo-ext="([^"]+)"/g)].map((m) => m[1]))];   // the extensions that actually injected
    }
  }
  await broadcast({ type: "committed", view: VIEW + "h/" + kappa, kappa, minted: false, verified: true, scheme: "holo", contentType: ct, transformed });
  return new Response(body, { status: 200, headers: KHDR(kappa, ct, transformed ? { "x-holo-view-transform": "content-scripts" } : {}) });
}

// pass a non-GET (a rewritten <form method=post> — consent saves, searches) through with its
// body; the /web proxy forwards POST upstream. GET/HEAD stay plain proxy fetches.
// isDoc tags the MAIN-FRAME navigation (not subresources) with x-holo-doc so the egress can
// answer just the top document through a real headless Chrome (JS + persistent cookies),
// leaving css/js/img subresources on the cheap byte pipe.
let EGRESS_OPERATOR = "";   // the signed-in operator κ (page posts it via {type:"setop"}); keys the per-identity egress Chrome
async function proxyInit(req, isDoc) {
  const init = { redirect: "follow" };
  const headers = {};
  if (isDoc) { headers["x-holo-doc"] = "1"; if (EGRESS_OPERATOR) headers["x-holo-operator"] = EGRESS_OPERATOR; }
  if (req && req.method && req.method !== "GET" && req.method !== "HEAD") {
    init.method = req.method;
    try { init.body = await req.arrayBuffer(); } catch {}
    const ct = req.headers && req.headers.get("content-type"); if (ct) headers["content-type"] = ct;
  }
  if (Object.keys(headers).length) init.headers = headers;
  return init;
}

// ── serve a live http(s) page: proxy → mint κ → cache → re-derive → serve ────────────
async function serveWeb(realUrl, req) {
  // NOTE on Google search: /search is JS-walled (no-JS search was retired). Google first
  // answers with an interstitial whose JS proves execution and re-navigates with a one-shot
  // sg_ss token. That JS RUNS in our renderer, the relative location update stays on the
  // same-origin wrapper URL, and the query-merge in the fetch handler maps it back onto the
  // real URL — so the redemption flows through the seam naturally. Do not strip sg_ss/sei.
  const act = dnrAction(realUrl, "main_frame");        // an enabled extension may block/redirect the page itself
  if (act.type === "block") { await broadcast({ type: "ext-blocked", url: realUrl, extId: act.extId, ruleId: act.ruleId, resourceType: "main_frame" }); return blockedPage(realUrl, act); }
  if (act.type === "redirect" && act.redirect && act.redirect.url) return Response.redirect(new URL(VIEW + "w/" + enc(act.redirect.url), self.location.origin).href, 302);
  const isGet = !req || !req.method || req.method === "GET" || req.method === "HEAD";
  const { r, via } = await egressFetch(realUrl, await proxyInit(req, true));   // isDoc → egress may render this top document in a real Chrome
  if (!r || !r.ok) {
    // Google rate-limits/JS-walls proxied /search (no-JS search is retired; the sg_ss JS
    // redemption works only when Google isn't punishing the IP). Never leave the user
    // resultless: fall back to DuckDuckGo's html edition with the SAME query, in-seam.
    try {
      const gu = new URL(realUrl); const q = gu.searchParams.get("q");
      if (q && /(^|\.)google\.[a-z.]{2,6}$/.test(gu.hostname) && gu.pathname === "/search")
        return Response.redirect(new URL(VIEW + "w/" + enc("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q)), self.location.origin).href, 302);
    } catch {}
    // L3 fallback: the last-known κ snapshot of this URL — a repeat visit paints with ZERO
    // egress (offline, relay outage, serverless mount with no road out). Re-derived, labeled stale.
    if (isGet) {
      const hit = await uServe(realUrl, "text/html; charset=utf-8");
      if (hit) {
        let body = hit.bytes;
        if (/text\/html/i.test(hit.contentType)) body = new TextEncoder().encode(rewriteHtml(new TextDecoder().decode(hit.bytes), realUrl, hit.kappa));
        await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa: hit.kappa, minted: false, verified: true, stale: true, egress: "kappa-store", scheme: new URL(realUrl).protocol.replace(":", ""), contentType: hit.contentType, source: realUrl });
        return new Response(body, { status: 200, headers: KHDR(hit.kappa, hit.contentType, { "x-holo-stale": "1", "x-holo-egress": "kappa-store" }) });
      }
    }
    // COEPH even on errors — the page is cross-origin isolated, and a document response without
    // CORP is ERR_BLOCKED_BY_RESPONSE (a blank frame instead of an honest upstream error).
    if (!r) return refused("no egress road reached " + realUrl + " (local proxy absent, origin CORS-closed, relays unreachable) and no κ snapshot is held for it");
    return new Response("Holo Browser: upstream " + r.status + " for " + realUrl, { status: r.status === 0 ? 502 : r.status, headers: { "content-type": "text/plain", ...COEPH } });
  }
  let bytes = new Uint8Array(await r.arrayBuffer());
  const kappa = kappaOf(bytes);                                  // the mint IS the re-derivation
  const ctype = (r.headers.get("content-type") || mimeByExt(realUrl) || "text/html; charset=utf-8");
  await kPut(kappa, bytes, { contentType: ctype, source: realUrl });
  if (!verifyKappa(kappa, bytes)) return refused("mint re-derivation failed for " + realUrl);
  if (isGet && r.status === 200) await uPut(realUrl, { kappa, contentType: ctype, ts: Date.now() });   // the L3 edge: url → κ
  let body = bytes;
  if (/text\/html/i.test(ctype)) {
    const text = new TextDecoder().decode(bytes);
    // A Google /search doc that came back as the JS-wall interstitial as a 200 (proof-of-JS
    // bounce, no results) — the egress couldn't clear the IP block and the raw fetch only sees
    // the wall. The !r.ok DDG fallback above catches the 429 case; this catches the 200 case.
    // Redirect (not re-serve) so the iframe's base becomes DuckDuckGo and its result links work.
    try {
      const gu = new URL(realUrl);
      if (/(^|\.)google\.[a-z.]{2,6}$/.test(gu.hostname) && gu.pathname === "/search"
          && /not redirected|enablejs|id="recaptcha|please click here|our systems have detected unusual traffic/i.test(text.slice(0, 4000))) {
        const q = gu.searchParams.get("q");
        if (q) return Response.redirect(new URL(VIEW + "w/" + enc("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q)), self.location.origin).href, 302);
      }
    } catch {}
    body = new TextEncoder().encode(rewriteHtml(text, realUrl, kappa));
  }
  await broadcast({ type: "committed", view: VIEW + "w/" + enc(realUrl), kappa, minted: true, verified: true, egress: via, scheme: new URL(realUrl).protocol.replace(":", ""), contentType: ctype, source: realUrl });
  return new Response(body, { status: 200, headers: KHDR(kappa, ctype, { "x-holo-egress": via }) });
}

// ── serve a subresource of a live page: κ-store FIRST (L3), then the egress ladder ────
async function serveSub(realUrl, req) {
  const isGet = !req || !req.method || req.method === "GET" || req.method === "HEAD";
  const isRange = !!(req && req.headers && req.headers.get("range"));   // a partial slice must never become the URL's identity
  // L3: a repeat subresource is a κ-store hit — zero wire bytes, by law not by optimization.
  // (SEC-3 dedup rides along: one stored copy of a shared lib serves every site that names it.)
  if (isGet && !isRange) {
    const hit = await uServe(realUrl, mimeByExt(realUrl) || "application/octet-stream");
    if (hit) return new Response(hit.bytes, { status: 200, headers: KHDR(hit.kappa, hit.contentType, { "x-holo-egress": "kappa-store" }) });
  }
  const { r, via } = await egressFetch(realUrl, await proxyInit(req));
  if (!r) return refused("subresource egress failed for " + realUrl);
  if (!r.ok) return new Response("", { status: r.status, headers: { "content-type": "text/plain", ...COEPH } });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const kappa = kappaOf(bytes);
  await kPut(kappa, bytes, { source: realUrl });
  const ct = r.headers.get("content-type") || mimeByExt(realUrl) || "application/octet-stream";
  if (isGet && !isRange && r.status === 200) await uPut(realUrl, { kappa, contentType: ct, ts: Date.now() });
  return new Response(bytes, { status: 200, headers: KHDR(kappa, ct, { "x-holo-egress": via }) });
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 1 · navigations + documents inside our renderer scope
  if (url.origin === self.location.origin && url.pathname.startsWith(VIEW)) {
    const rest = url.pathname.slice(VIEW.length);
    let m;
    if ((m = rest.match(/^h\/([0-9a-fA-F]{64})(\/.*)?$/))) { event.respondWith(serveKappa(m[1].toLowerCase(), (m[2] || "").replace(/^\//, "")).catch((e) => refused(String(e)))); return; }
    if ((m = rest.match(/^w\/(.+)$/))) {
      let real; try { real = dec(m[1]); } catch { return; }
      // A GET <form> submit against a rewritten action lands its fields on the WRAPPER's query —
      // the b64 token encodes only the action URL, and the submit replaces the wrapper's search.
      // Carry them onto the real URL or the query never reaches the site (Google → no results).
      if (url.search) { try { const ru = new URL(real); ru.search = url.search; real = ru.href; } catch {} }
      event.respondWith(serveWeb(real, event.request).catch((e) => refused(String(e)))); return;
    }
    return;   // unknown webview path → default
  }
  // 2 · requests the renderer iframe makes to the real web (because of the injected <base>).
  // This SW only ever controls the /webview/ iframes, so EVERY cross-origin http(s) request it
  // sees is webview traffic — no fragile referrer/clientId gate needed (navigations carry an
  // empty clientId + a stripped referrer, which is exactly what broke the gated version).
  if (url.protocol === "http:" || url.protocol === "https:") event.respondWith(handleExternal(event, url));
});
async function handleExternal(event, url) {
  if (url.origin === self.location.origin) return fetch(event.request);   // same-origin, not /webview/ → pass through
  // a top-level navigation to another site → re-enter the content-addressed renderer (serveWeb
  // applies main_frame DNR there, where the real URL is known).
  if (event.request.mode === "navigate" || event.request.destination === "document")
    return Response.redirect(new URL(VIEW + "w/" + enc(url.href), self.location.origin).href, 302);
  // a subresource (css/js/img/font/…) → declarativeNetRequest FIRST (block/redirect), then proxy +
  // mint + re-derive on the fly. This is where uBlock-Origin-Lite-style filtering actually bites.
  const rt = resourceTypeOf(event.request);
  const act = dnrAction(url.href, rt);
  if (act.type === "block") { broadcast({ type: "ext-blocked", url: url.href, extId: act.extId, ruleId: act.ruleId, resourceType: rt }); return new Response(new Uint8Array(), { status: 200, headers: { "content-type": "text/plain", "x-holo-blocked": String(act.extId || "1"), ...COEPH } }); }
  if (act.type === "redirect" && act.redirect && act.redirect.url) return Response.redirect(act.redirect.url, 302);
  return serveSub(url.href, event.request).catch(() => new Response("", { status: 502, headers: COEPH }));
}

self.addEventListener("message", (e) => {
  const m = e.data || {};
  // the page owns/mints a holo://κ document and hands the bytes to the loader's store.
  if (m.type === "kput" && m.kappa && m.bytes) { kPut(m.kappa, m.bytes, m.meta || {}).then(() => { if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true }); }); }
  // the page projects its enabled κ-verified extensions onto the seam (compiled DNR + content scripts).
  if (m.type === "setext") { EXT = { dnr: Array.isArray(m.dnr) ? m.dnr : [], contentScripts: Array.isArray(m.contentScripts) ? m.contentScripts : [] }; if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, dnr: EXT.dnr.length, contentScripts: EXT.contentScripts.length }); }
  // the page tells the seam WHO is signed in (operator κ from the TEE presence) → the egress
  // gives each identity its own persistent Chrome. A SW can't read localStorage, so the page pushes it.
  if (m.type === "setop") { EGRESS_OPERATOR = typeof m.operator === "string" ? m.operator : ""; if (e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true }); }
  if (m.type === "ping" && e.ports && e.ports[0]) e.ports[0].postMessage({ ok: true, view: VIEW });
});
