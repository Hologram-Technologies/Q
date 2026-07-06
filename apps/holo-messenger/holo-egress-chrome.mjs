// HOLO EGRESS — browser-grade egress for the `/web?url=` dumb pipe.
//
// The Node `fetch` egress in holo-web-route.mjs works, but a server-side fetch is
// fingerprintable (Node undici TLS/JA3, not Chrome), cookie-poor (RAM jar, no persistence),
// and cannot execute JS. Sites that demand a real browser degrade: Google /search is
// JS-walled (no-JS search retired; a proof-of-JS interstitial redeems a one-shot sg_ss token),
// Cloudflare "checking your browser" pages never clear, and logins never stick.
//
// This answers the SAME contract from a REAL, dedicated headless Chromium, driven over CDP:
//   egressRender(url)  → navigates a real tab, lets JS run, auto-rejects consent, waits for the
//                        navigation to settle, and returns the RENDERED outerHTML.
// The seam is unchanged: browser-sw.js still mints + re-derives (Law L5) whatever bytes we
// return; this only changes WHO answers the pipe (the header comment in holo-web-route.mjs
// anticipated exactly this — "only *who* answers changes, not the browser").
//
// Persistent profile dir ⇒ durable cookies: the consent-reject below is saved ONCE (SOCS
// cookie) and every later request skips the wall. That same persistence is the T3 foundation
// (one profile per operator ⇒ logins survive). Set HOLO_EGRESS_PROFILE to key it per operator.
//
// Fail-OPEN throughout: if Chrome can't be found/spawned or CDP misbehaves, every entry point
// returns null and the caller falls back to the Node path — this can only ADD reach, never
// regress it.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const CDP_PORT = Number(process.env.HOLO_EGRESS_CDP || 9356);   // distinct from host :9333 / look :9334
const PROFILE = process.env.HOLO_EGRESS_PROFILE || join(os.tmpdir(), "holo-egress-profile");
const MAX_TABS = Number(process.env.HOLO_EGRESS_MAX_TABS || 4);
// A normal Chrome UA (headless Chrome otherwise leaks "HeadlessChrome/…", an instant bot tell).
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.HOLO_CHROME && existsSync(process.env.HOLO_CHROME)) return process.env.HOLO_CHROME;
  const c = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(os.homedir(), "AppData\\Local\\Google\\Chrome\\Application\\chrome.exe"),
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return c.find((p) => { try { return existsSync(p); } catch { return false; } }) || null;
}

// ── consent auto-reject, injected at document-start into EVERY document/frame of the egress
// tab (Page.addScriptToEvaluateOnNewDocument). Same intent as browser-sw.js's page guard, but
// here it runs in a REAL browser so the reject POST lands in a persistent cookie store and the
// wall never returns. Self-disarms after 8s. ──
const CONSENT_REJECT = `(function(){
  try{
    var STRONG=/^(reject all|refuse all|deny all|decline all|reject non-essential|alle ablehnen|tout refuser|rechazar todo|rifiuta tutti|отклонить все|alles afwijzen)$/i;
    var WEAK=/^(reject|decline|deny|disagree|only (necessary|essential|required)( cookies)?|necessary (cookies )?only|continue without (accepting|agreeing))$/i;
    var SEL="#onetrust-reject-all-handler,.ot-pc-refuse-all-handler,#CybotCookiebotDialogBodyButtonDecline,.cc-deny,button[aria-label*='Reject all' i]";
    var done=false;
    function scented(el){var n=el,d=0;while(n&&n.getAttribute&&d++<10){var s=((n.id||'')+' '+(n.getAttribute('class')||'')+' '+(n.getAttribute('aria-label')||'')).toLowerCase();if(/cookie|consent|gdpr|privacy|\\bcmp\\b|onetrust|didomi|cookiebot|usercentrics|truste/.test(s))return true;n=n.parentElement;}return false;}
    function pass(){
      if(done)return;
      var b=null;try{b=document.querySelector(SEL);}catch(e){}
      if(!b){var cs=document.querySelectorAll("button,[role=button],input[type=submit],input[type=button],a,div[jsname]");
        for(var i=0;i<cs.length&&i<800;i++){var t=(cs[i].innerText||cs[i].value||cs[i].getAttribute&&cs[i].getAttribute('aria-label')||'').trim().replace(/\\s+/g,' ');
          if(t&&t.length<48&&(STRONG.test(t)||(WEAK.test(t)&&scented(cs[i])))){b=cs[i];break;}}}
      if(b){done=true;try{b.click();}catch(e){}}
    }
    if(document.readyState!=='loading')pass();else document.addEventListener('DOMContentLoaded',pass);
    var iv=setInterval(pass,300);
    try{var mo=new MutationObserver(pass);mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
    setTimeout(function(){clearInterval(iv);try{mo.disconnect();}catch(e){}},8000);
  }catch(e){}
})();`;

// A rendered block/challenge page is not the site — detect the common ones so the caller falls
// back honestly (Google /sorry reCAPTCHA, Cloudflare "Just a moment", generic "unusual traffic").
function looksBlocked(html, finalUrl) {
  try { if (/\/sorry\/|\/recaptcha\/|__cf_chl|\/cdn-cgi\/challenge/i.test(finalUrl)) return true; } catch {}
  const head = String(html).slice(0, 4000);
  return /our systems have detected unusual traffic|before you continue to google|id="recaptcha|please (show you'?re|verify you are) (a )?human|Just a moment\.\.\.|Attention Required! \| Cloudflare|Checking your browser before/i.test(head);
}

// ── CDP plumbing (per-target WebSocket, flat protocol not needed) ────────────────────────────
let _browser = null;   // { proc, wsBase } singleton promise-guard
let _starting = null;

async function cdpVersion(port) {
  try { return await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { return null; }
}

async function ensureBrowser() {
  if (_browser) return _browser;
  if (_starting) return _starting;
  _starting = (async () => {
    // Reuse an egress Chrome already listening (same persistent profile → only one may run).
    let v = await cdpVersion(CDP_PORT);
    if (!v) {
      const bin = findChrome();
      if (!bin) { _starting = null; return null; }
      const args = [
        "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio",
        `--remote-debugging-port=${CDP_PORT}`, "--remote-allow-origins=*",
        `--user-data-dir=${PROFILE}`,
        "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
        "--disable-features=Translate,MediaRouter,OptimizationHints",
        "--disable-extensions", "--window-size=1280,900", "--lang=en-US",
        "about:blank",
      ];
      let proc;
      try { proc = spawn(bin, args, { stdio: "ignore", windowsHide: true }); }
      catch { _starting = null; return null; }
      proc.on("exit", () => { _browser = null; });
      // wait for the CDP endpoint to come up
      for (let i = 0; i < 40; i++) { v = await cdpVersion(CDP_PORT); if (v) break; await sleep(250); }
      if (!v) { try { proc.kill(); } catch {} _starting = null; return null; }
      _browser = { proc, port: CDP_PORT };
    } else {
      _browser = { proc: null, port: CDP_PORT };   // adopted an already-running egress Chrome
    }
    _starting = null;
    return _browser;
  })();
  return _starting;
}

function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const listeners = new Set();
  ws.addEventListener("message", (m) => {
    let msg; try { msg = JSON.parse(m.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) { for (const l of listeners) try { l(msg); } catch {} }
  });
  const ready = new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
  const send = (method, params, timeoutMs = 15000) => new Promise((resolve) => {
    const myId = ++id; pending.set(myId, (m) => resolve(m.result !== undefined ? m.result : m));
    try { ws.send(JSON.stringify({ id: myId, method, params: params || {} })); }
    catch { pending.delete(myId); resolve({}); return; }
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); resolve({}); } }, timeoutMs);
  });
  return { ready, send, on: (fn) => listeners.add(fn), close: () => { try { ws.close(); } catch {} } };
}

async function evalInPage(cli, expression, awaitPromise = false, timeoutMs = 8000) {
  const r = await cli.send("Runtime.evaluate", { expression, awaitPromise, returnByValue: true }, timeoutMs);
  return r && r.result ? r.result.value : undefined;
}

// ── tab pool (cap concurrency; each render gets a fresh target) ──────────────────────────────
let _active = 0; const _wait = [];
async function acquire() { if (_active < MAX_TABS) { _active++; return; } await new Promise((r) => _wait.push(r)); _active++; }
function release() { _active--; const n = _wait.shift(); if (n) n(); }

async function newTab(br) {
  const created = await fetch(`http://127.0.0.1:${br.port}/json/new`, { method: "PUT" }).then((r) => r.json()).catch(() => null);
  const t = created && created.id ? created : await (async () => {
    // older Chrome: PUT unsupported → GET /json/new
    try { return await (await fetch(`http://127.0.0.1:${br.port}/json/new`)).json(); } catch { return null; }
  })();
  if (!t || !t.webSocketDebuggerUrl) return null;
  return t;
}
async function closeTab(br, targetId) { try { await fetch(`http://127.0.0.1:${br.port}/json/close/${targetId}`); } catch {} }

/**
 * Render a live document in a real headless Chrome and return its settled outerHTML.
 * @returns {Promise<null | {status:number, contentType:string, buffer:Buffer, finalUrl:string}>}
 */
export async function egressRender(url, { timeoutMs = 22000 } = {}) {
  let t;
  const parsed = (() => { try { return new URL(url); } catch { return null; } })();
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) return null;
  const br = await ensureBrowser();
  if (!br) return null;
  await acquire();
  let cli = null;
  try {
    t = await newTab(br);
    if (!t) return null;
    cli = cdpClient(t.webSocketDebuggerUrl);
    await cli.ready;
    await cli.send("Page.enable");
    await cli.send("Runtime.enable");
    await cli.send("Network.enable");
    await cli.send("Network.setUserAgentOverride", { userAgent: UA, acceptLanguage: "en-US,en;q=0.9", platform: "Windows" });
    await cli.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await cli.send("Page.addScriptToEvaluateOnNewDocument", { source: CONSENT_REJECT });

    const nav = await cli.send("Page.navigate", { url }, timeoutMs);
    if (nav && nav.errorText) return null;   // ERR_NAME_NOT_RESOLVED etc. → let Node path report honestly

    // Settle: poll until the document is complete, off any consent host, and its URL is stable
    // for ~1s (the consent reject + sg_ss redemption both resolve as real navigations here).
    const deadline = Date.now() + timeoutMs;
    let prev = "", stable = 0, sawComplete = false;
    while (Date.now() < deadline) {
      await sleep(500);
      const raw = await evalInPage(cli, `JSON.stringify({href:location.href,host:location.hostname,rs:document.readyState})`, false, 4000);
      let s; try { s = JSON.parse(raw); } catch { continue; }
      const onConsent = /(^|\.)consent\.|(^|\.)cookiepolicy|consent\.google\./i.test(s.host || "");
      if (s.rs === "complete" && !onConsent) {
        sawComplete = true;
        if (s.href === prev) stable++; else { stable = 0; prev = s.href; }
        if (stable >= 2) break;
      } else { stable = 0; prev = s.href; }
    }
    if (!sawComplete) return null;

    // Small extra beat so late-painting results (Google injects <h3>s post-load) are captured.
    await sleep(600);
    const html = await evalInPage(cli, "document.documentElement.outerHTML", false, 8000);
    const finalUrl = await evalInPage(cli, "location.href", false, 3000) || url;
    if (typeof html !== "string" || html.length < 64) return null;
    // A real Chrome still can't pass an IP-level block / interactive CAPTCHA / CF challenge — a
    // rendered "sorry" page is a dead end, so treat it as a soft miss and let the caller fall
    // back (DuckDuckGo html). Never serve a challenge page as if it were the site.
    if (looksBlocked(html, finalUrl)) return null;
    return { status: 200, contentType: "text/html; charset=utf-8", buffer: Buffer.from("<!doctype html>\n" + html), finalUrl };
  } catch {
    return null;
  } finally {
    try { if (cli) cli.close(); } catch {}
    try { if (t && t.id) await closeTab(br, t.id); } catch {}
    release();
  }
}

export function egressConfig() { return { port: CDP_PORT, profile: PROFILE, chrome: findChrome() }; }
