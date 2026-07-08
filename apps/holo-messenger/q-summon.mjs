// q-summon.mjs — tap the Q orb and Q slides in as a LEFT DRAWER, seamless with the nav rail — the same
// dimensions as Holo Wallet, the same chrome (#0d1117 = --holo-chrome), no starfield. It is the messenger's
// OWN Q (one brain, one voice, one memory), just re-framed as a docked panel instead of a full-screen morph.
// Four welds, all additive, all fail-soft:
//
//   1. THE DRAWER — the fully-wired hero (`.holo-hero`) is restyled in place into a left panel: width
//      min(94vw,max(440px,44vw)) (wallet parity), left of the 60px rail, background var(--holo-chrome) so it
//      reads as ONE seamless chrome extending the nav. Slides in from the left; the home widgets calm behind it.
//   2. THE VOICE AT t=0 — the tap IS the browser's autoplay gesture, so Q greets you out loud the instant it
//      opens (on-device Kokoro if warm, OS-voice floor otherwise — never mute). Greeting is name-personalized by
//      the hero itself (buildQ seeds "Hey <name>…" / "Welcome back <name>…"). HD voice pre-warms while home idles.
//   3. THE WARM BRAIN — window.HoloQ.warm() (the hero's ~70 tok/s BitNet) + the instant seed first-responder,
//      pre-warmed at home-idle, so even a first-time user gets an instant, spoken, intelligent first reply.
//   4. THE κ-THREAD — every painted message is sealed to a BLAKE3 κ (did:holo:blake3), hash-linked + verified
//      on load. window.QSummon.{thread,verify,kappaOf}.
//
// 100% serverless: Web Audio + vendored Kokoro + WebGPU BitNet + pure-JS BLAKE3. Imports only CANONICAL modules.
import { createVoice } from "../q/core/voice-out.js";
import { kappo, kappoVerify } from "../../_shared/holo-kappa.mjs";

const DOC = document, HTML = DOC.documentElement;
const $ = (s, r) => (r || DOC).querySelector(s);
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── the drawer skin: reshape the hero into a left panel with wallet dimensions + rail chrome ───────────────
const css = DOC.createElement("style");
css.id = "q-summon-css";
css.textContent = `
:root{ --q-rail-w: var(--holo-rail-w, 60px); --q-drawer-w: min(94vw, max(440px, 44vw)); }
/* HOME calms while Q is open (the drawer covers the left; a quiet, dimmed home reads better than a half-covered one) */
html.q-drawer .holo-home-greet,html.q-drawer .holo-home-clock,html.q-drawer .holo-home-quote,
html.q-drawer .holo-home-grid,html.q-drawer .holo-home-menu-fab{opacity:.18!important;transition:opacity .4s ease!important;pointer-events:none}

/* THE DRAWER — the hero, re-framed. Left of the rail, wallet width, chrome background (no starfield). */
html.q-drawer .holo-hero{
  inset:0 auto 0 var(--q-rail-w)!important; width:var(--q-drawer-w)!important;
  background:var(--holo-chrome,#0d1117)!important;
  padding-top:0!important; align-items:stretch!important; justify-content:flex-start!important;
  border-right:1px solid rgba(255,255,255,.06);
  box-shadow:14px 0 54px rgba(0,0,0,.5);
  animation:q-drawer-in .4s cubic-bezier(.4,0,.2,1) both!important; touch-action:auto!important;
}
@media (prefers-reduced-motion: no-preference){ @keyframes q-drawer-in{ from{ transform:translateX(-22px); opacity:0 } to{ transform:none; opacity:1 } } }
@media (prefers-reduced-motion: reduce){ @keyframes q-drawer-in{ from{opacity:0} to{opacity:1} } }
/* header row: a small living orb + the status, top-left (q-chat style) */
html.q-drawer .holo-hero-orb{ position:absolute!important; top:15px!important; left:17px!important; width:42px!important; height:42px!important; min-width:0!important; margin:0!important; filter:drop-shadow(0 0 12px rgba(91,140,255,.5))!important; }
html.q-drawer .holo-hero-orb.listening{ filter:drop-shadow(0 0 20px rgba(125,239,201,.6))!important; }
html.q-drawer .holo-hero-status{ position:absolute!important; top:26px!important; left:70px!important; margin:0!important; font-size:10.5px!important; letter-spacing:.18em!important; }
html.q-drawer .holo-hero-x{ position:absolute!important; top:13px!important; right:13px!important; width:34px; height:34px; }
/* the header title "Q" (injected) */
#q-drawer-title{position:fixed;top:16px;left:calc(var(--q-rail-w) + 70px);z-index:302;color:#f4f7fc;font:650 17px/1 -apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.2px;pointer-events:none;opacity:0;transition:opacity .3s ease}
html.q-drawer #q-drawer-title{opacity:1}
/* the conversation fills the drawer width */
html.q-drawer .holo-hero-stage{ max-width:none!important; width:100%!important; margin-top:62px!important; padding:0 10px!important; align-items:stretch!important; }
html.q-drawer .holo-hero-thread{ max-width:none!important; width:100%!important; padding:8px 8px 88px!important; -webkit-mask-image:none!important; mask-image:none!important; }
html.q-drawer .holo-hero-bubble{ max-width:90%!important; }
html.q-drawer .holo-hero-empty{ max-width:none!important; padding:0 18px; }
/* composer pill: centered WITHIN the drawer, fitting its width */
html.q-drawer .holo-hero-compose{ left:calc(var(--q-rail-w) + var(--q-drawer-w) / 2)!important; width:min(calc(var(--q-drawer-w) - 26px), 92vw)!important; bottom:calc(16px + env(safe-area-inset-bottom))!important; }
html.q-drawer .holo-hero-open{ display:none!important; }   /* "Open in chat" is redundant in the docked panel */
/* CLEAN q-chat look: hide the inbox brief / auto-tidy / ledger panels — the drawer is a conversation, not a dashboard */
html.q-drawer .holo-hero-brief,html.q-drawer .holo-hero-auto,html.q-drawer .holo-hero-ledger{ display:none!important; }

/* κ-chain proof chip — bottom-left, inside the drawer */
#q-kappa-chip{position:fixed;left:calc(var(--q-rail-w) + 12px);bottom:14px;z-index:340;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;
  color:#9fd3ff;background:rgba(10,14,20,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:5px 10px;pointer-events:none;opacity:0;transition:opacity .5s ease .25s}
#q-kappa-chip.on{opacity:.7}
#q-kappa-chip.bad{color:#ffb3c0;border-color:rgba(255,120,140,.4)}

/* SUGGESTION CHIPS — inside the drawer, above the composer */
#q-hero-chips{position:fixed;left:var(--q-rail-w);width:var(--q-drawer-w);box-sizing:border-box;bottom:calc(env(safe-area-inset-bottom) + 74px);z-index:305;
  display:flex;gap:8px;justify-content:center;flex-wrap:wrap;padding:0 14px;pointer-events:none;
  opacity:0;transform:translateY(6px);transition:opacity .45s ease,transform .45s cubic-bezier(.4,0,.2,1)}
#q-hero-chips.on{opacity:1;transform:none}
#q-hero-chips button{pointer-events:auto;white-space:nowrap;color:#eef3fb;border-radius:20px;padding:7px 13px;font-size:12.5px;
  cursor:pointer;border:1px solid rgba(255,255,255,.13);background:rgba(255,255,255,.05);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);transition:transform .14s ease,border-color .16s ease,background .16s ease}
#q-hero-chips button:hover{border-color:rgba(139,123,255,.55);transform:translateY(-1px);background:rgba(255,255,255,.09)}
#q-hero-chips button:active{transform:scale(.96)}
/* the Call button (q-live-hero) rides inside the drawer too */
html.q-drawer #q-call-btn{ right:auto!important; left:calc(var(--q-rail-w) + var(--q-drawer-w) - 96px)!important; }
@media (prefers-reduced-motion:reduce){#q-hero-chips{transition:opacity .2s ease}}
`;
DOC.head.appendChild(css);

// ── Q's summon voice (canonical core voice; HD warms once, floor voice means never mute) ──────────────────
const voice = createVoice({ onLevel: (level) => { try { window.dispatchEvent(new CustomEvent("holo-q-state", { detail: { mode: "speaking", level } })); } catch {} } });
const TTS_URL = new URL("../../usr/lib/holo/voice/holo-voice-tts.mjs", import.meta.url).href;   // mount-safe under /Q/

// The spoken greeting is name-personalized to match the hero's own text bubble. Identity is read the same way
// the home greeting reads it ("Good afternoon, Ilya" ⇒ profile name), so Q greets you by name, out loud, at t=0.
function firstName() {
  const clean = (s) => { s = String(s || "").trim(); const l = s.toLowerCase(); return (s && l !== "you" && l !== "operator" && l !== "guest") ? s.split(/\s+/)[0] : ""; };
  try { const o = JSON.parse(sessionStorage.getItem("holo.identity") || "null"); if (o && !o.guest && clean(o.label)) return clean(o.label); } catch {}
  try { const p = JSON.parse(localStorage.getItem("holo-messenger/profile/v1") || "null"); if (p && clean(p.name)) return clean(p.name); } catch {}
  try { const m = clean(localStorage.getItem("holo.chat.me")); if (m) return m; } catch {}
  try { const o = JSON.parse(localStorage.getItem("holo.lastOperator") || "null"); if (o && clean(o.label)) return clean(o.label); } catch {}
  return "";
}
const GKEY = "holo.q.summon.greeted";
function greetLine() {
  const n = firstName(), who = n ? " " + n : "";
  let first = true; try { first = !localStorage.getItem(GKEY); localStorage.setItem(GKEY, String(Date.now())); } catch {}
  return first
    ? `Hey${who}, I'm Q. I live right here on your device, so whatever you tell me stays with you, always. What's on your mind?`
    : `Welcome back${who}. I'm right here — what's on your mind?`;
}

function warm() {
  try { window.speechSynthesis && speechSynthesis.getVoices(); } catch {}
  try { voice.warmHD({ ttsUrl: TTS_URL }).catch(() => {}); } catch {}
  let tries = 0;
  (function brain() {
    try { if (window.HoloQ && window.HoloQ.warm) { window.HoloQ.warm(); return; } } catch {}
    if (++tries < 40) setTimeout(brain, 700);
  })();
}
function warmWhenIdle() {
  if (DOC.visibilityState !== "visible") { DOC.addEventListener("visibilitychange", warmWhenIdle, { once: true }); return; }
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4500 }); else setTimeout(warm, 2500);
}
warmWhenIdle();

let greeting = false;
function speakGreeting() { greeting = true; Promise.resolve(voice.speak(greetLine())).catch(() => {}).then(() => { greeting = false; }); }
function bargeIn() { if (greeting) { greeting = false; try { voice.stop(); } catch {} } }
window.addEventListener("keydown", bargeIn, { capture: true, passive: true });

// ── open the drawer: add the class BEFORE the hero mounts (no full-screen flash), let the tap open the hero ──
const heroOpen = () => !!$(".holo-hero");
let titleEl = null;
function ensureTitle() { if (!titleEl) { titleEl = DOC.createElement("div"); titleEl.id = "q-drawer-title"; titleEl.textContent = "Q"; DOC.body.appendChild(titleEl); } }
function onOrbDown(e) {
  if (heroOpen()) return;
  const orb = e.target && e.target.closest && e.target.closest(".holo-home-orb, .holo-global-orb");
  if (!orb) return;
  HTML.classList.add("q-drawer");     // the hero will mount already-shaped as the drawer (no flash)
  ensureTitle();
  speakGreeting();                    // the tap IS the gesture → Q speaks by name at t=0
  // safety: if the hero never actually opens, don't leave the home dimmed
  setTimeout(() => { if (!heroOpen()) HTML.classList.remove("q-drawer"); }, 1500);
}
DOC.addEventListener("pointerdown", onOrbDown, { capture: true, passive: true });

// ── the κ-thread: every painted message → did:holo:blake3, hash-linked, verified on every load ────────────
const LKEY = "holo.q.kappa-thread.v1";
const enc = new TextEncoder();
const sealBytes = (m) => enc.encode(JSON.stringify({ v: 1, role: m.role, text: m.text, ts: m.ts, prev: m.prev }));
let ledger = []; try { ledger = JSON.parse(localStorage.getItem(LKEY) || "[]"); } catch {}
const seen = new Set(ledger.map((m) => m.role + " " + m.text));
let chainOk = true, brokenAt = -1;
function verifyChain() {
  let prev = null;
  for (let i = 0; i < ledger.length; i++) {
    const m = ledger[i];
    if (m.prev !== prev || !kappoVerify(sealBytes(m), m.k)) { chainOk = false; brokenAt = i; return false; }
    prev = m.k;
  }
  chainOk = true; brokenAt = -1; return true;
}
verifyChain();
function persist() { try { localStorage.setItem(LKEY, JSON.stringify(ledger.slice(-240))); } catch {} }
function seal(role, text) {
  const key = role + " " + text;
  if (!text || seen.has(key)) return null;
  const m = { v: 1, role, text, ts: Date.now(), prev: ledger.length ? ledger[ledger.length - 1].k : null };
  m.k = kappo(sealBytes(m));
  ledger.push(m); seen.add(key); persist(); chip();
  return m.k;
}
let chipEl = null;
function chip() {
  if (!heroOpen()) { if (chipEl) chipEl.classList.remove("on"); return; }
  if (!chipEl) { chipEl = DOC.createElement("div"); chipEl.id = "q-kappa-chip"; DOC.body.appendChild(chipEl); }
  const last = ledger[ledger.length - 1];
  chipEl.textContent = chainOk ? `⛓ ${ledger.length} sealed · verified` + (last ? ` · κ…${last.k.slice(-8)}` : "")
    : `⛓ chain broken at #${brokenAt} — history was altered`;
  chipEl.classList.toggle("bad", !chainOk); chipEl.classList.add("on");
}

// ── suggestion chips (drawer-docked; drive the hero's React input) ─────────────────────────────────────────
const CHIPS = ["Tell me something amazing", "Write me something beautiful", "Help me think through something", "Tell me a joke"];
let chipsEl = null;
function heroHasUserMsg() { try { return !!DOC.querySelector(".holo-hero-bubble.me"); } catch { return false; } }
function driveSend(text) {
  const inp = DOC.querySelector("#holo-hero-input"); if (!inp) return;
  try {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(inp, text); inp.dispatchEvent(new Event("input", { bubbles: true }));
    const send = DOC.querySelector(".holo-hero-send");
    if (send && !send.disabled) send.click(); else inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  } catch {}
}
function showChips() {
  if (!heroOpen() || heroHasUserMsg()) return;
  if (!chipsEl) {
    chipsEl = DOC.createElement("div"); chipsEl.id = "q-hero-chips";
    for (const c of CHIPS) { const b = DOC.createElement("button"); b.textContent = c; b.onclick = () => { hideChips(); bargeIn(); driveSend(c); }; chipsEl.appendChild(b); }
    DOC.body.appendChild(chipsEl);
  }
  requestAnimationFrame(() => chipsEl && chipsEl.classList.add("on"));
}
function hideChips() { if (chipsEl) chipsEl.classList.remove("on"); }

// observe the hero: seal each bubble; manage the drawer lifecycle (open → chips/chip; close → restore home)
const mo = new MutationObserver((muts) => {
  for (const mut of muts) {
    for (const n of mut.addedNodes) {
      if (!(n instanceof Element)) continue;
      if (n.classList && n.classList.contains("holo-hero")) { HTML.classList.add("q-drawer"); ensureTitle(); verifyChain(); chip(); setTimeout(showChips, 300); }
      const bubbles = n.classList && n.classList.contains("holo-hero-bubble") ? [n] : (n.querySelectorAll ? n.querySelectorAll(".holo-hero-bubble") : []);
      for (const b of bubbles) {
        if (b.classList.contains("typing")) continue;
        const role = b.classList.contains("me") ? "me" : "q";
        const k = seal(role, (b.textContent || "").trim());
        if (role === "me") hideChips();
        if (k && role === "q") bargeIn();
      }
    }
    for (const n of mut.removedNodes) {
      if (n instanceof Element && n.classList && n.classList.contains("holo-hero")) {
        HTML.classList.remove("q-drawer");                 // restore the home (widgets un-dim)
        if (chipEl) chipEl.classList.remove("on");
        hideChips(); bargeIn();
      }
    }
  }
});
mo.observe(DOC.body, { childList: true, subtree: true });

// ── debug/verification surface ────────────────────────────────────────────────────────────────────────────
window.QSummon = {
  thread: () => ledger.slice(),
  verify: () => ({ ok: verifyChain(), brokenAt, sealed: ledger.length }),
  kappaOf: (i) => (ledger[i] || {}).k || null,
  speak: (t) => voice.speak(t),
  name: () => firstName(),
  version: 3,
};
try { console.info("[q-summon] live — LEFT DRAWER (wallet parity) · sealed:", ledger.length, "· chain:", chainOk ? "verified" : "BROKEN@" + brokenAt); } catch {}
