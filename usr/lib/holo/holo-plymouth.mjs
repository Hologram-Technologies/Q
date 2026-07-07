// holo-plymouth.mjs — Plymouth boot splashes for the Hologram greeter. The real thing, serverless.
//
// Every theme in adi1090x/plymouth-themes (the canonical Linux boot-splash pack, GPL-3.0) is ONE engine:
// a centered sprite cycling progress-0..N-1.png at 25 fps over black — the .script files differ only in
// frame count. So this module IS Plymouth for the web: one tiny player reproduces all 80 themes exactly,
// no interpreter, no daemon, no server.
//
//   • STREAMED, THEN SOVEREIGN — frames stream straight from the theme pack's public CDN (CORS-open) the
//     first time, playing progressively as they arrive; every frame is SEALED into the SAME durable κ
//     store the wallpapers live in (holo-store.js · IDB "holo"/"kappa" · sha256 axis). From then on the
//     boot splash is content-addressed and fully offline — identity is content (Law L2), lost bytes
//     self-heal by re-fetch + re-seal (Law L5).
//   • POWER-ON CHOREOGRAPHY — cold open: pure black + the splash dead-center, exactly like the metal.
//     Then the machine HANDS YOU THE KEYS: the animation glides up and shrinks into a small living
//     emblem above your identity while the black dissolves to your own wallpaper — boot becomes login
//     becomes desktop, one continuous motion. The biometric moment pulses the emblem (Plymouth's
//     password prompt); success flares it out with the glass unfog.
//   • PICKED FROM THE LOGIN SCREEN — a quiet "Boot style" door opens the gallery: frame-0 stills
//     (streamed once, sealed to κ — the gallery itself works offline), the upstream GIF plays on hover,
//     pick → streams → sealed → worn live behind the sheet. Persisted in holo.plymouth.v1; frame-0 is
//     cached as a data URL so the NEXT cold boot paints the splash at literal first frame, zero network.
//
// Fail-open everywhere: no network + no seal → the wallpaper greeter, unchanged. Reduced motion → the
// splash holds frame 0, poses jump instead of glide. Consumed by holo-signin.mjs (attachPlymouth(overlay)).

const KEY = "holo.plymouth.v1";
const FRK = (t) => "holo.plymouth.frames:" + t;     // per-theme sealed-frame manifest (array of κ)
const THK = "holo.plymouth.thumbs";                  // theme → κ of its sealed frame-0 still
const FPS = 25;                                      // the template: 50 Hz refresh / SPEED 2
const RAW = "https://raw.githubusercontent.com/adi1090x/plymouth-themes/master/";
const PREVIEW = "https://raw.githubusercontent.com/adi1090x/files/master/plymouth-themes/previews/";
const DEFAULT_THEME = "circle_hud";

// ── the catalog: all 80 themes, README order (= preview GIF numbering) — name:pack:frames:~KB ─────────
const CATALOG = (
  "abstract_ring:1:41:3586 abstract_ring_alt:1:76:3752 alienware:1:24:1700 angular:1:30:1049 angular_alt:1:61:1075 " +
  "black_hud:1:164:750 blockchain:1:68:576 circle:1:101:2054 circle_alt:1:48:3492 circle_flow:1:72:886 " +
  "circle_hud:1:156:640 circuit:1:96:3787 colorful:1:375:4555 colorful_loop:1:89:625 colorful_sliced:1:120:4594 " +
  "connect:1:120:2148 cross_hud:1:210:352 cubes:1:81:985 cuts:1:63:130 cuts_alt:1:41:172 " +
  "cyanide:2:24:2116 cybernetic:2:201:2239 dark_planet:2:160:10230 darth_vader:2:115:1160 deus_ex:2:375:3365 " +
  "dna:2:26:600 double:2:40:282 dragon:2:94:3473 flame:2:25:1108 glitch:2:33:1307 " +
  "glowing:2:38:8141 green_blocks:2:125:1645 green_loader:2:40:275 hexagon:2:16:542 hexagon_2:2:100:2000 " +
  "hexagon_alt:2:119:1650 hexagon_dots:2:32:472 hexagon_dots_alt:2:181:1525 hexagon_hud:2:205:780 hexagon_red:2:75:433 " +
  "hexa_retro:3:90:2254 hud:3:20:1000 hud_2:3:40:3009 hud_3:3:125:3256 hud_space:3:119:1660 " +
  "ibm:3:48:441 infinite_seal:3:540:20211 ironman:3:100:18032 liquid:3:19:280 loader:3:105:3180 " +
  "loader_2:3:50:843 loader_alt:3:87:1590 lone:3:64:772 metal_ball:3:100:8300 motion:3:60:1534 " +
  "optimus:3:163:1781 owl:3:151:14817 pie:3:120:847 pixels:3:240:11051 polaroid:3:392:1508 " +
  "red_loader:4:53:474 rings:4:220:2254 rings_2:4:270:6376 rog:4:130:12229 rog_2:4:15:1421 " +
  "seal:4:400:3159 seal_2:4:399:5886 seal_3:4:323:6730 sliced:4:45:2476 sphere:4:36:460 " +
  "spin:4:169:7011 spinner_alt:4:60:939 splash:4:65:469 square:4:45:1144 square_hud:4:173:272 " +
  "target:4:138:3716 target_2:4:90:2889 tech_a:4:166:6053 tech_b:4:192:8918 unrap:4:150:3474"
).split(" ").map((row, i) => {
  const [name, pack, frames, kb] = row.split(":");
  return { name, pack: +pack, frames: +frames, kb: +kb, preview: PREVIEW + (i + 1) + ".gif" };
});
export const PLYMOUTH_THEMES = CATALOG;
const themeOf = (name) => CATALOG.find((t) => t.name === name) || null;
const frameUrl = (t, i) => RAW + "pack_" + t.pack + "/" + t.name + "/progress-" + i + ".png";
const pretty = (n) => n.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// ── persisted state — tiny, non-secret, read synchronously by the greeter baseline for 0-ms paint ─────
export function readState() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || "null"); if (s && typeof s === "object") return s; } catch {}
  return { v: 1, on: true, theme: DEFAULT_THEME };     // first boot: the OS boots like an OS
}
function writeState(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

// ── the κ store — the SAME durable store the wallpapers seal into (IDB "holo" / "kappa", sha256 axis) ──
let _storeP = null;
function store() {
  if (_storeP) return _storeP;
  _storeP = import("./holo-store.js").then(({ makeStore, idbBackend }) => makeStore({
    axis: "sha256", backend: idbBackend(),
    hash: async (u8) => { const d = await crypto.subtle.digest("SHA-256", u8); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); },
  })).catch(() => {   // store unreachable → same contract in-memory (session-scoped; the splash still plays)
    const m = new Map();
    return { async put(u8) { const d = await crypto.subtle.digest("SHA-256", u8); const k = "sha256:" + [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join(""); m.set(k, u8); return k; }, async get(k) { return m.get(k) || null; } };
  });
  return _storeP;
}
// κ-first bytes: durable store → CDN re-fetch + re-seal (Law L5 self-heal). Returns { bytes, kappa }.
async function kBytes(kappa, url) {
  const st = await store();
  if (kappa) { try { const b = await st.get(kappa); if (b) return { bytes: b, kappa }; } catch {} }
  try {
    const r = await fetch(url, { cache: "force-cache" });
    if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); let k = kappa; try { k = await st.put(b); } catch {} return { bytes: b, kappa: k }; }
  } catch {}
  return null;
}

// ── frame loading: κ store first (offline), CDN stream + seal on a miss ───────────────────────────────
// onFrame(i, img) fires as frames become drawable — playback starts on the first one, torrent-style.
async function loadFrames(theme, onFrame, cancelled) {
  const t = themeOf(theme); if (!t) throw new Error("unknown theme " + theme);
  let manifest = null; try { manifest = JSON.parse(localStorage.getItem(FRK(theme)) || "null"); } catch {}
  const total = (manifest && manifest.length) || t.frames;
  const kappas = new Array(total).fill(null);
  let firstBytes = null, loaded = 0;

  const toImage = (bytes, i) => new Promise((res) => {
    const img = new Image();
    // decode() is a fire-and-forget WARM-UP only — in a hidden tab it never settles (deferred decode), and
    // drawImage decodes synchronously anyway. Gating on it would freeze the whole splash for background tabs.
    img.onload = () => { try { if (img.decode) img.decode().catch(() => {}); } catch {} onFrame(i, img); res(img); };
    img.onerror = () => res(null);
    img.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  });
  const one = async (i) => {
    if (cancelled()) return;
    const got = await kBytes(manifest && manifest[i], frameUrl(t, i));
    if (!got) return;
    kappas[i] = got.kappa;
    if (i === 0) firstBytes = got.bytes;
    loaded++;
    await toImage(got.bytes, i);
  };
  // ordered small batches so the playable prefix grows monotonically (the loop plays what has landed)
  const CONC = 6;
  for (let base = 0; base < total && !cancelled(); base += CONC) {
    await Promise.all(Array.from({ length: Math.min(CONC, total - base) }, (_, j) => one(base + j)));
  }
  if (cancelled()) return { loaded, total };
  // seal the manifest once whole (or whole-minus-holes: a 404'd tail clamps the loop, not the theme)
  if (loaded > 0 && !manifest) {
    const solid = kappas.slice(0, kappas.indexOf(null) === -1 ? kappas.length : kappas.indexOf(null));
    if (solid.length > 4) { try { localStorage.setItem(FRK(theme), JSON.stringify(solid)); } catch {} }
  }
  // cache frame-0 small → the NEXT cold boot paints the splash synchronously, before any module loads
  if (firstBytes && firstBytes.length < 80000) {
    try {
      const fr = new FileReader();
      fr.onload = () => { const s = readState(); if (s.theme === theme) { s.firstFrame = fr.result; writeState(s); } };
      fr.readAsDataURL(new Blob([firstBytes], { type: "image/png" }));
    } catch {}
  }
  return { loaded, total };
}

// ── styles — self-contained, px-based (immune to host font resets), injected once ─────────────────────
const CSS = `
#holo-login .hlp{position:fixed;inset:0;z-index:0;pointer-events:none;background:#000;opacity:0;transition:opacity .5s ease,background-color 1.1s ease}
#holo-login .hlp.on{opacity:1}
#holo-login .hlp canvas{position:absolute;inset:0;width:100%;height:100%}
/* greet: the black dissolves — your wallpaper IS the login; the splash lives on as a small emblem above you */
#holo-login .hlp.greet{background:rgba(0,0,0,0)}
#holo-login .hlp.verify canvas{animation:hlp-pulse 1.4s ease-in-out infinite}
@keyframes hlp-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}
#holo-login .hlp.done{opacity:0;transition:opacity .62s ease}
#holo-login .hlp.done canvas{animation:none;filter:brightness(1.7);transition:filter .5s ease}
#holo-login.hl-boot .hl-panel{opacity:0!important;pointer-events:none!important}
#holo-login .hl-panel{transition:opacity .55s ease}
#holo-login .hlp-btn{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:4;
  pointer-events:auto;display:inline-flex;align-items:center;gap:9px;background:rgba(10,14,20,.42);border:1px solid rgba(255,255,255,.14);
  color:rgba(231,237,250,.8);font:500 16px/1 "Segoe UI",system-ui,sans-serif;padding:11px 18px;border-radius:999px;cursor:pointer;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:color .15s,border-color .15s,background .15s;opacity:0;animation:hlp-in .6s ease 1.2s forwards}
#holo-login .hlp-btn:hover{color:#fff;border-color:rgba(125,239,201,.55);background:rgba(10,14,20,.62)}
#holo-login .hlp-btn svg{width:17px;height:17px}
@keyframes hlp-in{to{opacity:1}}
#holo-login .hlp-gal{position:fixed;inset:0;z-index:6;pointer-events:auto;background:rgba(1,4,9,.6);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  display:grid;place-items:center;animation:hlp-fade .22s ease}
@keyframes hlp-fade{from{opacity:0}}
#holo-login .hlp-sheet{width:min(920px,94vw);max-height:84vh;display:flex;flex-direction:column;overflow:hidden;background:rgba(8,12,18,.94);
  border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.6);color:#e6edf3;font-family:"Segoe UI",system-ui,sans-serif}
#holo-login .hlp-head{display:flex;align-items:center;gap:12px;padding:20px 22px 14px;flex:0 0 auto}
#holo-login .hlp-title{font-size:20px;font-weight:600}
#holo-login .hlp-x{margin-left:auto;width:34px;height:34px;flex:0 0 auto;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#c9d1d9;cursor:pointer;font-size:16px}
#holo-login .hlp-x:hover{background:rgba(255,255,255,.16)}
#holo-login .hlp-srch{padding:0 22px 16px;flex:0 0 auto}
#holo-login .hlp-srch input{width:100%;box-sizing:border-box;background:rgba(1,4,9,.6);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:11px 18px;color:#e6edf3;font:inherit;font-size:16px;outline:none}
#holo-login .hlp-srch input:focus{border-color:#34d3a6}
/* grid-auto-rows is EXPLICIT — Chromium computes a <button> grid item's intrinsic content height as 0,
   so content-sized rows collapse to the border (the "80 empty bars" failure). Fixed rows are immune. */
#holo-login .hlp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(198px,1fr));grid-auto-rows:186px;gap:14px;padding:4px 22px 20px;overflow-y:auto;flex:1 1 auto;min-height:0}
#holo-login .hlp-tile{appearance:none;-webkit-appearance:none;display:flex;flex-direction:column;height:186px;box-sizing:border-box;border:1px solid rgba(255,255,255,.1);border-radius:14px;overflow:hidden;cursor:pointer;background:#05070c;text-align:left;padding:0;margin:0;color:inherit;font:inherit;transition:transform .1s,border-color .12s;position:relative}
#holo-login .hlp-tile:hover{transform:translateY(-2px);border-color:#34d3a6}
#holo-login .hlp-tile.sel{border-color:#34d3a6;box-shadow:0 0 0 2px rgba(52,211,166,.45)}
#holo-login .hlp-tile.sel::after{content:"\\2713";position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;background:#34d3a6;color:#06140f;display:grid;place-content:center;font-size:16px;font-weight:700}
#holo-login .hlp-prev{flex:1 1 auto;min-height:0;background:#000;display:grid;place-items:center;overflow:hidden;position:relative}
#holo-login .hlp-prev img{max-width:90%;max-height:90%;object-fit:contain;display:block}
#holo-login .hlp-prev .hlp-shim{position:absolute;inset:0;background:linear-gradient(100deg,#05070c 30%,#101722 50%,#05070c 70%);background-size:220% 100%;animation:hlp-shimmer 1.2s ease-in-out infinite}
@keyframes hlp-shimmer{to{background-position:-220% 0}}
#holo-login .hlp-prev.off{color:#6e7681;font-size:30px}
#holo-login .hlp-name{flex:0 0 auto;padding:11px 14px 12px;background:rgba(5,7,12,.9);font-size:16px;font-weight:600;color:#e6edf3;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#holo-login .hlp-foot{padding:12px 22px 16px;font-size:16px;color:#6e7681;border-top:1px solid rgba(255,255,255,.07);flex:0 0 auto}
#holo-login .hlp-foot a{color:#58a6ff;text-decoration:none}
#holo-login .hlp-toast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:7;background:rgba(13,17,23,.95);color:#e6edf3;
  border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:10px 20px;font:16px "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6);
  pointer-events:none;animation:hlp-toast 2.6s ease both}
@keyframes hlp-toast{0%{opacity:0;transform:translate(-50%,8px)}10%,82%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#holo-login .hlp,#holo-login .hlp canvas,#holo-login .hlp-btn,#holo-login .hlp-prev .hlp-shim{transition:none;animation:none;opacity:1}}
`;
function injectCss() {
  try { if (document.getElementById("holo-plymouth-css")) return; const s = document.createElement("style"); s.id = "holo-plymouth-css"; s.textContent = CSS; document.head.appendChild(s); } catch {}
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── the player: one canvas, the Plymouth template + the power-on choreography ──────────────────────────
// Poses are draw-space (crisp at any scale — CSS transforms would blur the canvas):
//   boot   — dead-center, up to 62vmin: the machine booting, exactly like the metal
//   greet  — a small living emblem ABOVE the identity panel: the machine handing you the keys
//   verify — the emblem leans in slightly while the enclave checks you (CSS pulses brightness)
const POSES = {
  boot:   { cy: 0.46, cap: 0.62 },
  greet:  { cy: 0.215, cap: 0.22 },
  verify: { cy: 0.215, cap: 0.26 },
};
function makePlayer(layer, canvas) {
  const ctx = canvas.getContext("2d");
  const images = [];            // sparse, filled as frames land
  let prefix = 0;               // contiguous playable prefix — the loop only plays what has landed
  let raf = 0, t0 = 0, alive = true, last = 0;
  const pose = { ...POSES.boot };          // current, eased toward target every frame
  let target = POSES.boot;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function size() { canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); }
  size(); addEventListener("resize", size);
  function draw(idx) {
    const img = images[idx]; if (!img) return;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const vmin = Math.min(cw, ch);
    // Plymouth centers the sprite at its natural size; the pose caps it (boot ≈ the metal, greet = emblem)
    const s = Math.min(1, (vmin * pose.cap) / Math.max(img.naturalWidth, img.naturalHeight));
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const cx = cw / 2, cy = ch * pose.cy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // a soft dark halo under the sprite — keeps the emblem legible over ANY wallpaper without a scrim,
    // so the lock keeps wearing the exact same sharp wallpaper as home
    const r = Math.max(w, h) * 0.85;
    const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    g.addColorStop(0, "rgba(0,0,0,.5)"); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
  function loop(now) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || prefix === 0) { last = now; return; }
    if (!t0) t0 = now;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    // glide the pose toward its target (exp ease ≈ 750ms settle); reduced motion snaps
    const k = reducedMotion() ? 1 : Math.min(1, dt * 5.5);
    pose.cy += (target.cy - pose.cy) * k;
    pose.cap += (target.cap - pose.cap) * k;
    const idx = Math.floor((now - t0) / (1000 / FPS)) % Math.max(prefix, 1);
    draw(idx);
  }
  return {
    frame(i, img) {
      images[i] = img;
      while (images[prefix]) prefix++;
      if (prefix === 1) {                                  // first drawable frame → the splash is alive
        layer.classList.add("on");
        if (reducedMotion()) draw(0); else raf = requestAnimationFrame(loop);
      }
    },
    pose(name) { target = POSES[name] || POSES.greet; if (reducedMotion()) { pose.cy = target.cy; pose.cap = target.cap; if (images[0]) draw(0); } },
    reset() { images.length = 0; prefix = 0; t0 = 0; },
    destroy() { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}

// ── gallery thumbnails: each tile wears the theme's REAL frame-0 (streamed once, sealed to κ) — the
// gallery itself becomes offline-capable. The upstream GIF preview plays on hover only. ────────────────
let _thumbMap = null;   // ONE shared map — concurrent loaders mutate it; each write persists the whole map
function thumbMap() { if (!_thumbMap) { try { _thumbMap = JSON.parse(localStorage.getItem(THK) || "{}") || {}; } catch { _thumbMap = {}; } } return _thumbMap; }
const _thumbURL = new Map();   // theme → objectURL (session)
async function thumbFor(t) {
  if (_thumbURL.has(t.name)) return _thumbURL.get(t.name);
  const m = thumbMap();
  const got = await kBytes(m[t.name], frameUrl(t, 0));
  if (!got) return null;
  if (m[t.name] !== got.kappa) { m[t.name] = got.kappa; try { localStorage.setItem(THK, JSON.stringify(m)); } catch {} }
  const url = URL.createObjectURL(new Blob([got.bytes], { type: "image/png" }));
  _thumbURL.set(t.name, url);
  return url;
}

// ── the gallery: pick a boot style from the login screen — live apply behind the sheet ────────────────
function openGallery(overlay, current, onPick) {
  const gal = document.createElement("div"); gal.className = "hlp-gal";
  gal.innerHTML = `<div class="hlp-sheet" role="dialog" aria-label="Boot style">
    <div class="hlp-head"><div class="hlp-title">Boot style</div>
      <button class="hlp-x" aria-label="Close">✕</button></div>
    <div class="hlp-srch"><input type="search" placeholder="Search" spellcheck="false"></div>
    <div class="hlp-grid"></div>
    <div class="hlp-foot">Animations by <a href="https://github.com/adi1090x/plymouth-themes" target="_blank" rel="noopener">adi1090x</a> · GPL 3.0</div>
  </div>`;
  const grid = gal.querySelector(".hlp-grid");
  const close = () => { gal.remove(); document.removeEventListener("keydown", esc, true); try { clearTimeout(sweep); io && io.disconnect(); } catch {} };
  const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc, true);
  gal.addEventListener("pointerdown", (e) => { if (e.target === gal) close(); });
  gal.querySelector(".hlp-x").onclick = close;

  // thumbnail loader — a small queue (never stampedes the CDN). IntersectionObserver PRIORITIZES what's
  // on screen; a fallback sweep enqueues the rest regardless (IO callbacks pause in hidden tabs, and 80
  // frame-0 stills are ~1–2 MB total — worth having them all sealed for the offline gallery anyway).
  const pending = [];
  let inFlight = 0;
  const pump = () => {
    while (inFlight < 4 && pending.length) {
      const job = pending.shift();
      if (job.queued === 2) continue;                     // already loaded via the other path
      job.queued = 2;
      const { t, img, shim } = job;
      inFlight++;
      thumbFor(t).then((url) => {
        if (url) { img.src = url; img.dataset.still = url; }
        if (shim) shim.remove();
      }).catch(() => { if (shim) shim.remove(); }).finally(() => { inFlight--; pump(); });
    }
  };
  const allJobs = [];
  const io = ("IntersectionObserver" in window) ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const job = e.target.__hlpJob; if (job && !job.queued) { job.queued = 1; pending.unshift(job); }   // visible first
    }
    pump();
  }, { root: grid, rootMargin: "240px" }) : null;
  const sweep = setTimeout(() => { for (const j of allJobs) if (!j.queued) { j.queued = 1; pending.push(j); } pump(); }, 900);

  function tile(t) {
    const el = document.createElement("button"); el.type = "button";
    el.className = "hlp-tile" + (current === (t ? t.name : null) ? " sel" : "");
    if (!t) {
      el.innerHTML = `<div class="hlp-prev off">◌</div><div class="hlp-name">Off</div>`;
    } else {
      el.innerHTML = `<div class="hlp-prev"><div class="hlp-shim"></div><img alt="" draggable="false"></div>
        <div class="hlp-name">${pretty(t.name)}</div>`;
      const img = el.querySelector("img"), shim = el.querySelector(".hlp-shim");
      el.__hlpJob = { t, img, shim, queued: 0 };
      allJobs.push(el.__hlpJob);
      if (io) io.observe(el); else { el.__hlpJob.queued = 1; pending.push(el.__hlpJob); pump(); }
      // hover = the theme comes alive (upstream GIF); leave = back to the sealed still
      el.addEventListener("pointerenter", () => { img.src = t.preview; }, { passive: true });
      el.addEventListener("pointerleave", () => { if (img.dataset.still) img.src = img.dataset.still; }, { passive: true });
    }
    el.onclick = () => { close(); onPick(t ? t.name : null); };
    return el;
  }
  function draw(q) {
    grid.innerHTML = "";
    allJobs.length = 0; pending.length = 0;
    grid.appendChild(tile(null));
    const needle = (q || "").toLowerCase().trim();
    for (const t of CATALOG) if (!needle || t.name.includes(needle.replace(/\s+/g, "_")) || pretty(t.name).toLowerCase().includes(needle)) grid.appendChild(tile(t));
  }
  draw("");
  const inp = gal.querySelector("input");
  inp.addEventListener("input", () => draw(inp.value));
  overlay.appendChild(gal);
  setTimeout(() => { try { inp.focus(); } catch {} }, 60);
}

function toast(overlay, msg) {
  try { const t = document.createElement("div"); t.className = "hlp-toast"; t.textContent = msg; overlay.appendChild(t); setTimeout(() => t.remove(), 2600); } catch {}
}

// ── attachPlymouth(overlay) — the ONE call the greeter makes. Returns the choreography controller. ────
export function attachPlymouth(overlay) {
  if (!overlay || overlay.querySelector(".hlp-btn")) return null;
  injectCss();
  const state = readState();
  try { if (!localStorage.getItem(KEY)) writeState(state); } catch {}   // persist the default → next cold boot gets the 0-ms baseline
  let layer = null, canvas = null, player = null, gen = 0;

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement("div"); layer.className = "hlp";
    canvas = document.createElement("canvas");
    layer.appendChild(canvas);
    const wall = overlay.querySelector(".hl-wall");
    if (wall && wall.nextSibling) overlay.insertBefore(layer, wall.nextSibling); else overlay.prepend(layer);
    player = makePlayer(layer, canvas);
  }
  function play(theme) {
    ensureLayer();
    const my = ++gen;
    player.reset();
    layer.classList.remove("done");
    loadFrames(theme, (i, img) => {
      if (my !== gen) return;
      player.frame(i, img);
      if (i === 0) dropBaseline();                        // the live canvas has the frame — the 0-ms still yields
    }, () => my !== gen)
      .catch(() => { if (my === gen && state.on) layer.classList.remove("on"); });   // no frames at all → wallpaper stays
  }
  // the host baseline (app.html) may have painted a synchronous frame-0 still; remove it once live
  function dropBaseline() { try { const b = document.getElementById("hl-plymouth-base"); if (b) { b.style.opacity = "0"; setTimeout(() => b.remove(), 900); } } catch {} }

  // the boot beat: a moment of pure splash before the greeter rises — skippable, never a lock-out. Only
  // when the beat is ALREADY running (the host baseline started it at 0 ms) or the panel hasn't painted
  // yet (primitive-owned overlay): a panel the human can already see is never re-hidden.
  const endBoot = () => { try { overlay.classList.remove("hl-boot"); if (layer) { layer.classList.add("greet"); player.pose("greet"); } dropBaseline(); } catch {} };
  const panelEl = overlay.querySelector("#holo-login-panel");
  const bootable = overlay.classList.contains("hl-boot") || !panelEl || !panelEl.childElementCount;
  if (state.on && bootable && !reducedMotion()) {
    overlay.classList.add("hl-boot");
    const t = setTimeout(endBoot, 1100);
    overlay.addEventListener("pointerdown", () => { clearTimeout(t); endBoot(); }, { once: true, capture: true });
    document.addEventListener("keydown", () => { clearTimeout(t); endBoot(); }, { once: true, capture: true });
  } else if (state.on) { setTimeout(endBoot, 0); }
  if (state.on) play(state.theme);

  // the door: pick the boot style right here, on the login screen
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "hlp-btn"; btn.title = "Choose how this computer boots";
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>Boot style`;
  btn.onclick = () => openGallery(overlay, readState().on ? readState().theme : null, (name) => api.setTheme(name));
  btn.addEventListener("pointerenter", () => { try { store(); } catch {} }, { passive: true, once: true });   // warm the κ store during hover intent
  overlay.appendChild(btn);

  const api = {
    setTheme(name) {
      const s = readState();
      if (!name) {
        writeState({ ...s, on: false, firstFrame: undefined });
        gen++; if (layer) layer.classList.remove("on");
        toast(overlay, "Boot splash off");
        return;
      }
      writeState({ ...s, on: true, theme: name, firstFrame: undefined });
      state.on = true; state.theme = name;
      if (layer) { layer.classList.add("greet"); player.pose("greet"); }
      toast(overlay, pretty(name));
      play(name);
    },
    // choreography hooks for the greeter — all fail-open no-ops when the splash is off
    verify() { try { if (layer) { layer.classList.add("verify"); player.pose("verify"); } } catch {} },
    calm() { try { if (layer) { layer.classList.remove("verify"); player.pose("greet"); } } catch {} },
    complete() { try { endBoot(); if (layer) { layer.classList.remove("verify"); layer.classList.add("done"); } setTimeout(() => api.destroy(), 900); } catch {} },   // overlay is removed right after — stop the loop with it
    destroy() { gen++; try { player && player.destroy(); } catch {} },
  };
  try { window.HoloPlymouth = { open: () => btn.click(), set: (n) => api.setTheme(n), themes: CATALOG.map((t) => t.name), state: readState }; } catch {}
  return api;
}
export default attachPlymouth;
