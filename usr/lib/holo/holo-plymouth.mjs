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
// onFrame(i, bytes) fires with raw PNG bytes as frames land — the PLAYER decodes on its own thread
// (worker createImageBitmap, or the 2D floor's Image path); playback starts on the first drawable one.
async function loadFrames(theme, onFrame, cancelled) {
  const t = themeOf(theme); if (!t) throw new Error("unknown theme " + theme);
  let manifest = null; try { manifest = JSON.parse(localStorage.getItem(FRK(theme)) || "null"); } catch {}
  const total = (manifest && manifest.length) || t.frames;
  const kappas = new Array(total).fill(null);
  let firstBytes = null, loaded = 0;

  const one = async (i) => {
    if (cancelled()) return;
    const got = await kBytes(manifest && manifest[i], frameUrl(t, i));
    if (!got) return;
    kappas[i] = got.kappa;
    if (i === 0) firstBytes = got.bytes;
    loaded++;
    onFrame(i, got.bytes);
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
/* greet: the black dissolves — your wallpaper IS the login; the splash lives on as your identity emblem */
#holo-login .hlp.greet{background:rgba(0,0,0,0)}
/* while the emblem is alive it REPLACES the avatar circle — the slot keeps its layout, the paint is the animation */
#holo-login.hlp-anchor .hl-avatar{visibility:hidden}
#holo-login .hlp.verify canvas{animation:hlp-pulse 1.4s ease-in-out infinite}
@keyframes hlp-pulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.45)}}
#holo-login .hlp.done{opacity:0;transition:opacity .62s ease}
#holo-login .hlp.done canvas{animation:none;filter:brightness(1.7);transition:filter .5s ease}
#holo-login.hl-boot .hl-panel{opacity:0!important;pointer-events:none!important}
#holo-login .hl-panel{transition:opacity .55s ease}
/* the ⋯ door — the SAME quiet affordance the home screen wears, top-right: everything about how this
   computer looks and wakes lives behind it. One circle, no words. */
#holo-login .hlp-btn{position:fixed;right:max(20px,env(safe-area-inset-right));top:max(18px,env(safe-area-inset-top));z-index:4;
  pointer-events:auto;display:grid;place-items:center;width:44px;height:44px;background:var(--glass,rgba(10,14,20,.42));border:1px solid var(--glass-border,rgba(255,255,255,.14));
  color:var(--glass-ink,rgba(231,237,250,.8));border-radius:50%;cursor:pointer;font-size:var(--u,16px);
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:color .15s,border-color .15s,background .15s;opacity:0;animation:hlp-in .6s ease 1.2s forwards}
#holo-login .hlp-btn:hover{color:var(--ink,#fff);border-color:rgba(52,211,166,.55)}
#holo-login .hlp-btn svg{width:20px;height:20px}
@keyframes hlp-in{to{opacity:1}}
#holo-login .hlp-modes{display:flex;gap:4px;margin:0 22px 16px;padding:4px;border-radius:999px;background:var(--field-bg,rgba(255,255,255,.07));border:1px solid var(--field-border,rgba(255,255,255,.12));flex:0 0 auto}
#holo-login .hlp-modes button{flex:1 1 0;border:0;background:none;color:var(--muted,#9fb3d0);font:500 var(--u,16px)/1 "Segoe UI",system-ui,sans-serif;padding:10px 0;border-radius:999px;cursor:pointer;transition:color .15s,background .15s}
#holo-login .hlp-modes button:hover{color:var(--ink,#fff)}
#holo-login .hlp-modes button.on{background:var(--ink,#f4f7fc);color:var(--wall,#05070c);font-weight:600}
#holo-login .hlp-gal{position:fixed;inset:0;z-index:6;pointer-events:auto;background:var(--glass,rgba(1,4,9,.6));backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
  display:grid;place-items:center;animation:hlp-fade .22s ease}
@keyframes hlp-fade{from{opacity:0}}
#holo-login .hlp-sheet{width:min(920px,94vw);max-height:84vh;display:flex;flex-direction:column;overflow:hidden;background:var(--sheet,rgba(8,12,18,.94));
  border:1px solid var(--glass-border,rgba(255,255,255,.12));border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.6);color:var(--ink,#e6edf3);font-family:"Segoe UI",system-ui,sans-serif}
#holo-login .hlp-head{display:flex;align-items:center;gap:12px;padding:20px 22px 14px;flex:0 0 auto}
#holo-login .hlp-title{font-size:var(--u,16px);font-weight:700}
#holo-login .hlp-x{margin-left:auto;width:34px;height:34px;flex:0 0 auto;border:0;border-radius:50%;background:var(--field-bg,rgba(255,255,255,.08));color:var(--ink,#c9d1d9);cursor:pointer;font-size:var(--u,16px)}
#holo-login .hlp-x:hover{background:var(--field-border,rgba(255,255,255,.16))}
#holo-login .hlp-srch{padding:0 22px 16px;flex:0 0 auto}
#holo-login .hlp-srch input{width:100%;box-sizing:border-box;background:var(--field-bg,rgba(1,4,9,.6));border:1px solid var(--field-border,rgba(255,255,255,.12));border-radius:999px;padding:11px 18px;color:var(--ink,#e6edf3);font:inherit;font-size:var(--u,16px);outline:none}
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
#holo-login .hlp-name{flex:0 0 auto;padding:11px 14px 12px;background:rgba(5,7,12,.9);font-size:var(--u,16px);font-weight:600;color:#e6edf3;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#holo-login .hlp-acts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;padding:2px 22px 16px;flex:0 0 auto}
#holo-login .hlp-acts button{border:1px solid var(--field-border,rgba(255,255,255,.14));background:var(--field-bg,rgba(255,255,255,.06));color:var(--glass-ink,rgba(231,237,250,.8));font:500 var(--u,16px)/1 "Segoe UI",system-ui,sans-serif;padding:11px 20px;border-radius:999px;cursor:pointer;transition:color .15s,border-color .15s}
#holo-login .hlp-acts button:hover{color:var(--ink,#fff);border-color:rgba(52,211,166,.55)}
#holo-login .hlp-foot{padding:12px 22px 16px;font-size:var(--u,16px);color:var(--muted,#6e7681);border-top:1px solid var(--glass-border,rgba(255,255,255,.07));flex:0 0 auto}
#holo-login .hlp-foot a{color:var(--link,#58a6ff);text-decoration:none}
#holo-login .hlp-toast{position:fixed;left:50%;bottom:74px;transform:translateX(-50%);z-index:7;background:var(--sheet,rgba(13,17,23,.95));color:var(--ink,#e6edf3);
  border:1px solid var(--glass-border,rgba(255,255,255,.14));border-radius:999px;padding:10px 20px;font:var(--u,16px) "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6);
  pointer-events:none;animation:hlp-toast 2.6s ease both}
@keyframes hlp-toast{0%{opacity:0;transform:translate(-50%,8px)}10%,82%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#holo-login .hlp,#holo-login .hlp canvas,#holo-login .hlp-btn,#holo-login .hlp-prev .hlp-shim{transition:none;animation:none;opacity:1}}
`;
function injectCss() {
  try { if (document.getElementById("holo-plymouth-css")) return; const s = document.createElement("style"); s.id = "holo-plymouth-css"; s.textContent = CSS; document.head.appendChild(s); } catch {}
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── the player: ONE facade, two backends, the same choreography ────────────────────────────────────────
// Poses are draw-space (crisp at any scale — CSS transforms would blur the canvas):
//   boot   — dead-center, up to 62vmin: the machine booting, exactly like the metal
//   greet  — the living emblem IS your identity: it lands on the avatar slot (anchored, a touch larger)
//   verify — the emblem leans in slightly while the enclave checks you (CSS pulses brightness)
// Anchored poses track the .hl-avatar rect live (the circle itself is hidden — the animation replaces it);
// the fraction values are only the fallback for a greeter without an avatar in its panel.
//
// GPU backend (default): decode + chroma-key + temporal blend + present live on an OffscreenCanvas in a
// dedicated Worker — the main thread never decodes or keys a pixel (the witnessed source of boot-beat
// jank), and consecutive 25 fps sprite frames are crossfaded by fractional phase so motion presents at
// the display's own rate. dpr up to 3 for device-pixel sharpness. Probe-BEFORE-transfer (a transferred
// canvas is consumed); any missing capability falls open to the proven 2D player below, byte-identical
// behavior. Force a rung: ?emblem=gpu | ?emblem=2d.
const POSES = {
  boot:   { cx: 0.5, cy: 0.46, cap: 0.62 },
  greet:  { cx: 0.5, cy: 0.20, cap: 0.38, anchor: true, mult: 2.6 },
  verify: { cx: 0.5, cy: 0.20, cap: 0.42, anchor: true, mult: 2.8 },
};
// anchored poses GROW UPWARD from the avatar slot: the emblem's bottom edge stays pinned to the slot's
// bottom, so a larger emblem rises toward the sky and never crowds the identity button beneath it. The
// clamp keeps its top on screen on short windows (it can never grow past the slot-bottom-to-sky span).
function anchorTarget(overlay, p, fallback) {
  try {
    const a = overlay.querySelector(".hl-avatar");
    if (a) {
      const r = a.getBoundingClientRect();
      if (r.width) {
        const cap = Math.min(r.width * (p.mult || 2.6), Math.max(r.width, r.top + r.height - 24));
        return { cx: r.left + r.width / 2, cy: r.top + r.height - cap / 2, cap };
      }
    }
  } catch {}
  return fallback;
}
// Plymouth sprites bake their black screen into the PNG; over the wallpaper that black must be AIR.
// The GPU backend keys in the fragment shader (zero main-thread cost); this CPU twin serves the 2D floor.
// `ink` = the light appearance: a mostly-white sprite would vanish on paper, so the keyed emblem is
// PRINTED — every pixel darkened to ink weight with its hue kept (white → near-black, green → deep green).
// Fail-open: any canvas trouble keeps the original image.
function keyBlack(img, ink) {
  try {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return img;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, w, h), p = d.data;
    for (let i = 0; i < p.length; i += 4) {
      const v = Math.max(p[i], p[i + 1], p[i + 2]);
      if (v < 48) p[i + 3] = Math.min(p[i + 3], Math.max(0, ((v - 12) / 36) * 255) | 0);
      if (ink && v > 0) { const f = 46 / Math.max(v, 31); p[i] = (p[i] * f) | 0; p[i + 1] = (p[i + 1] * f) | 0; p[i + 2] = (p[i + 2] * f) | 0; }
    }
    x.putImageData(d, 0, 0);
    return c;
  } catch { return img; }
}
// ── the 2D floor: the proven player, unchanged physics (25 fps stepped, CPU key, dpr ≤ 2) ─────────────
function make2dPlayer(overlay, layer, canvas, onLive) {
  const ctx = canvas.getContext("2d");
  const images = [];            // sparse, filled as frames land
  let prefix = 0;               // contiguous playable prefix — the loop only plays what has landed
  let raf = 0, t0 = 0, alive = true, last = 0, started = false, inkOn = false;
  const pose = { ...POSES.boot };          // current, eased toward target every frame
  let target = POSES.boot;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function size() { canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); }
  size(); addEventListener("resize", size);
  // anchored poses resolve to the avatar slot's live rect (panel rise/resize tracked every frame)
  function liveTarget() {
    if (!target.anchor) return target;
    const cw = canvas.width / dpr, ch = canvas.height / dpr, vmin = Math.min(cw, ch);
    const px = anchorTarget(overlay, target, null);
    if (!px) return target;
    return { cx: px.cx / cw, cy: px.cy / ch, cap: px.cap / vmin };
  }
  function draw(idx) {
    const img = images[idx]; if (!img) return;
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    const vmin = Math.min(cw, ch);
    // Plymouth centers the sprite at its natural size; the pose caps it (boot ≈ the metal, greet = emblem)
    const s = Math.min(1, (vmin * pose.cap) / Math.max(iw, ih));
    const w = iw * s, h = ih * s;
    const cx = cw * pose.cx, cy = ch * pose.cy;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }
  function loop(now) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || prefix === 0) { last = now; return; }
    if (!t0) t0 = now;
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    // glide the pose toward its target (exp ease ≈ 750ms settle); reduced motion snaps
    const tgt = liveTarget();
    const k = reducedMotion() ? 1 : Math.min(1, dt * 5.5);
    pose.cx += (tgt.cx - pose.cx) * k;
    pose.cy += (tgt.cy - pose.cy) * k;
    pose.cap += (tgt.cap - pose.cap) * k;
    const idx = Math.floor((now - t0) / (1000 / FPS)) % Math.max(prefix, 1);
    draw(idx);
  }
  function wake() {
    while (images[prefix]) prefix++;
    if (!started && prefix > 0) {                          // first drawable frame → the splash is alive
      started = true;
      try { onLive(); } catch {}
      if (reducedMotion()) draw(0); else raf = requestAnimationFrame(loop);
    }
  }
  return {
    mode: "2d",
    frame(i, bytes) {
      const img = new Image();
      img.onload = () => { try { URL.revokeObjectURL(img.src); } catch {} if (!alive) return; images[i] = keyBlack(img, inkOn); wake(); };
      img.onerror = () => { try { URL.revokeObjectURL(img.src); } catch {} };
      img.src = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    },
    pose(name) { target = POSES[name] || POSES.greet; if (reducedMotion()) { const t = liveTarget(); pose.cx = t.cx; pose.cy = t.cy; pose.cap = t.cap; if (images[0]) draw(0); } },
    ink(on) { const flip = inkOn !== !!on; inkOn = !!on; return flip && started; },   // true → frames need a re-key (caller replays)
    reset() { images.length = 0; prefix = 0; t0 = 0; started = false; },
    destroy() { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}

// ── the GPU worker: decode (createImageBitmap — no hidden-tab decode() trap), shader chroma-key,
// frame-pair temporal blend to display rate, pose easing, present. Classic worker from a Blob URL
// (no import map, no extra manifest asset — works on any mount). No template literals inside. ─────────
const GPU_WORKER_SRC =
  '"use strict";\n' +
  "var device=null,ctx=null,canvas=null,pipeline=null,sampler=null,ubuf=null;\n" +
  "var dpr=1,reduced=false,cw=0,chh=0;\n" +
  "var tex=[],pend=[];\n" +
  "var prefix=0,started=false,t0=0,raf=0,last=0;\n" +
  "var pose={cx:0,cy:0,cap:0},target=null,ink=0;\n" +
  "var WGSL=''+\n" +
  "'struct U { rect: vec4<f32>, misc: vec4<f32> };\\n'+\n" +
  "'@group(0) @binding(0) var<uniform> u: U;\\n'+\n" +
  "'@group(0) @binding(1) var smp: sampler;\\n'+\n" +
  "'@group(0) @binding(2) var texA: texture_2d<f32>;\\n'+\n" +
  "'@group(0) @binding(3) var texB: texture_2d<f32>;\\n'+\n" +
  "'struct VOut { @builtin(position) pos: vec4<f32>, @location(0) uv: vec2<f32> };\\n'+\n" +
  "'@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {\\n'+\n" +
  "'  var c = array<vec2<f32>,6>(vec2<f32>(-1.,-1.), vec2<f32>(1.,-1.), vec2<f32>(-1.,1.), vec2<f32>(-1.,1.), vec2<f32>(1.,-1.), vec2<f32>(1.,1.));\\n'+\n" +
  "'  let k = c[vi];\\n'+\n" +
  "'  let px = u.rect.xy + k * u.rect.zw * 0.5;\\n'+\n" +
  "'  var o: VOut;\\n'+\n" +
  "'  o.pos = vec4<f32>(px.x / u.misc.y * 2. - 1., 1. - px.y / u.misc.z * 2., 0., 1.);\\n'+\n" +
  "'  o.uv = k * 0.5 + vec2<f32>(0.5, 0.5);\\n'+\n" +
  "'  return o;\\n'+\n" +
  "'}\\n'+\n" +
  "'@fragment fn fs(i: VOut) -> @location(0) vec4<f32> {\\n'+\n" +
  "'  let a = textureSample(texA, smp, i.uv);\\n'+\n" +
  "'  let b = textureSample(texB, smp, i.uv);\\n'+\n" +
  "'  let c = mix(a, b, u.misc.x);\\n'+\n" +
  "'  let v = max(c.r, max(c.g, c.b));\\n'+\n" +
  "'  let alpha = min(c.a, clamp((v - 0.047) / 0.141, 0., 1.));\\n'+\n" +
  "'  var rgb = c.rgb;\\n'+\n" +
  "'  if (u.misc.w > 0.5) { rgb = rgb * (0.18 / max(v, 0.12)); }\\n'+\n" +
  "'  return vec4<f32>(rgb * alpha, alpha);\\n'+\n" +
  "'}\\n';\n" +
  "self.onmessage=function(e){var d=e.data||{};\n" +
  " if(d.t==='probe'){Promise.resolve().then(async function(){var ok=false;try{ok=!!(self.navigator&&navigator.gpu&&await navigator.gpu.requestAdapter());}catch(err){}self.postMessage({t:'probe',ok:ok});});}\n" +
  " else if(d.t==='init'){init(d).catch(function(err){self.postMessage({t:'err',m:String(err)});});}\n" +
  " else if(d.t==='frame'){frame(d.i,d.buf);}\n" +
  " else if(d.t==='pose'){target={cx:d.cx,cy:d.cy,cap:d.cap};if(!pose.cap){pose.cx=d.cx;pose.cy=d.cy;pose.cap=d.cap;}if(reduced&&started){pose.cx=d.cx;pose.cy=d.cy;pose.cap=d.cap;render(0,0,0.016,0);}}\n" +
  " else if(d.t==='ink'){ink=d.on?1:0;if(reduced&&started)render(0,0,0.016,0);}\n" +
 " else if(d.t==='resize'){dpr=d.dpr;cw=d.w;chh=d.h;if(canvas&&ctx){canvas.width=Math.max(1,Math.round(cw*dpr));canvas.height=Math.max(1,Math.round(chh*dpr));}}\n" +
  " else if(d.t==='reset'){for(var i=0;i<tex.length;i++){if(tex[i]){try{tex[i].tex.destroy();}catch(err){}}}tex.length=0;pend.length=0;prefix=0;started=false;t0=0;}\n" +
  "};\n" +
  "async function init(d){\n" +
  " canvas=d.canvas;dpr=d.dpr;reduced=!!d.reduced;cw=d.w;chh=d.h;\n" +
  " var adapter=await navigator.gpu.requestAdapter();\n" +
  " device=await adapter.requestDevice();\n" +
  " ctx=canvas.getContext('webgpu');\n" +
  " var format=navigator.gpu.getPreferredCanvasFormat();\n" +
  " canvas.width=Math.max(1,Math.round(cw*dpr));canvas.height=Math.max(1,Math.round(chh*dpr));\n" +
  " ctx.configure({device:device,format:format,alphaMode:'premultiplied'});\n" +
  " sampler=device.createSampler({magFilter:'linear',minFilter:'linear'});\n" +
  " ubuf=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});\n" +
  " var mod=device.createShaderModule({code:WGSL});\n" +
  " pipeline=device.createRenderPipeline({layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:format,blend:{color:{srcFactor:'one',dstFactor:'one-minus-src-alpha'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha'}}}]},primitive:{topology:'triangle-list'}});\n" +
  " var p=pend.splice(0,pend.length);\n" +
  " for(var j=0;j<p.length;j++)frame(p[j][0],p[j][1]);\n" +
  "}\n" +
  "async function frame(i,buf){\n" +
  " if(!device){pend.push([i,buf]);return;}\n" +
  " var bmp=null;\n" +
  " try{bmp=await createImageBitmap(new Blob([buf],{type:'image/png'}),{premultiplyAlpha:'none',colorSpaceConversion:'none'});}catch(err){return;}\n" +
  " var t=device.createTexture({size:[bmp.width,bmp.height],format:'rgba8unorm',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});\n" +
  " device.queue.copyExternalImageToTexture({source:bmp},{texture:t,premultipliedAlpha:false},[bmp.width,bmp.height]);\n" +
  " var rec={tex:t,w:bmp.width,h:bmp.height};\n" +
  " try{bmp.close();}catch(err){}\n" +
  " tex[i]=rec;\n" +
  " while(tex[prefix])prefix++;\n" +
  " if(!started&&prefix>0){started=true;self.postMessage({t:'first'});if(reduced){render(0,0,0.016,0);}else{raf=requestAnimationFrame(loop);}}\n" +
  "}\n" +
  "function loop(now){\n" +
  " raf=requestAnimationFrame(loop);\n" +
  " if(prefix===0){last=now;return;}\n" +
  " if(!t0)t0=now;\n" +
  " var dt=Math.min((now-last)/1000,0.1);last=now;\n" +
  " var tt=(now-t0)/40;\n" +
  " var idx=Math.floor(tt)%prefix;\n" +
  " var phase=tt-Math.floor(tt);\n" +
  " render(idx,prefix>1?(idx+1)%prefix:idx,dt,phase);\n" +
  "}\n" +
  "function render(idx,nxt,dt,phase){\n" +
  " var a=tex[idx];if(!a||!ctx||!pipeline)return;\n" +
  " var b=tex[nxt]||a;\n" +
  " if(target){var k=reduced?1:Math.min(1,(dt||0.016)*5.5);\n" +
  "  pose.cx+=(target.cx-pose.cx)*k;pose.cy+=(target.cy-pose.cy)*k;pose.cap+=(target.cap-pose.cap)*k;}\n" +
  " var s=Math.min(1,pose.cap/Math.max(a.w,a.h));\n" +
  " var w=a.w*s*dpr,h=a.h*s*dpr;\n" +
  " var u=new Float32Array([pose.cx*dpr,pose.cy*dpr,w,h,phase||0,canvas.width,canvas.height,ink]);\n" +
  " device.queue.writeBuffer(ubuf,0,u);\n" +
  " var bg=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ubuf}},{binding:1,resource:sampler},{binding:2,resource:a.tex.createView()},{binding:3,resource:b.tex.createView()}]});\n" +
  " var enc=device.createCommandEncoder();\n" +
  " var pass=enc.beginRenderPass({colorAttachments:[{view:ctx.getCurrentTexture().createView(),loadOp:'clear',clearValue:{r:0,g:0,b:0,a:0},storeOp:'store'}]});\n" +
  " pass.setPipeline(pipeline);pass.setBindGroup(0,bg);pass.draw(6);pass.end();\n" +
  " device.queue.submit([enc.finish()]);\n" +
  "}\n";

// main-side controller: probes the worker's adapter BEFORE transferring the canvas (a consumed canvas
// can't fall back), then only reads the avatar rect + posts pose targets — the sole main-thread work.
async function makeGpuPlayer(overlay, layer, canvas, onLive) {
  if (typeof Worker === "undefined" || !("gpu" in navigator) || !canvas.transferControlToOffscreen || typeof createImageBitmap === "undefined") return null;
  let worker = null, url = null;
  try {
    url = URL.createObjectURL(new Blob([GPU_WORKER_SRC], { type: "text/javascript" }));
    worker = new Worker(url);
  } catch { try { if (url) URL.revokeObjectURL(url); } catch {} return null; }
  const ok = await new Promise((res) => {
    const to = setTimeout(() => res(false), 4500);
    const h = (e) => { if (e.data && e.data.t === "probe") { worker.removeEventListener("message", h); clearTimeout(to); res(!!e.data.ok); } };
    worker.addEventListener("message", h);
    try { worker.postMessage({ t: "probe" }); } catch { clearTimeout(to); res(false); }
  });
  try { URL.revokeObjectURL(url); } catch {}
  if (!ok) { try { worker.terminate(); } catch {} return null; }
  const off = canvas.transferControlToOffscreen();       // point of no return — the worker owns the pixels
  const dpr = () => Math.min(window.devicePixelRatio || 1, 3);
  worker.postMessage({ t: "init", canvas: off, w: innerWidth, h: innerHeight, dpr: dpr(), reduced: reducedMotion() }, [off]);
  worker.addEventListener("message", (e) => { if (e.data && e.data.t === "first") { try { onLive(); } catch {} } });
  let target = POSES.boot, watch = 0, last = null;
  const send = () => {
    const p = target, cw = innerWidth, ch = innerHeight, vmin = Math.min(cw, ch);
    let t = { cx: cw * p.cx, cy: ch * p.cy, cap: vmin * p.cap };
    if (p.anchor) t = anchorTarget(overlay, p, t);
    if (!last || Math.abs(t.cx - last.cx) > 0.25 || Math.abs(t.cy - last.cy) > 0.25 || Math.abs(t.cap - last.cap) > 0.25) {
      last = t;
      try { worker.postMessage({ t: "pose", cx: t.cx, cy: t.cy, cap: t.cap }); } catch {}
    }
  };
  const tick = () => { watch = requestAnimationFrame(tick); send(); };   // one rect read per frame — nothing else
  send(); watch = requestAnimationFrame(tick);
  const onRs = () => { try { worker.postMessage({ t: "resize", w: innerWidth, h: innerHeight, dpr: dpr() }); } catch {} };
  addEventListener("resize", onRs);
  return {
    mode: "gpu-worker",
    frame(i, bytes) { try { const buf = bytes.slice().buffer; worker.postMessage({ t: "frame", i, buf }, [buf]); } catch {} },
    pose(name) { target = POSES[name] || POSES.greet; last = null; send(); },
    ink(on) { try { worker.postMessage({ t: "ink", on: !!on }); } catch {} return false; },   // shader-side — never needs a replay
    reset() { try { worker.postMessage({ t: "reset" }); } catch {} },
    destroy() { cancelAnimationFrame(watch); removeEventListener("resize", onRs); try { worker.terminate(); } catch {} },
  };
}

// the facade: same synchronous API the choreography uses; the backend resolves async (frames queue).
function makePlayer(overlay, layer, canvas, onLive) {
  let backend = null, queue = [], lastPose = null, lastInk = null, dead = false;
  let forced = null; try { forced = new URLSearchParams(location.search).get("emblem"); } catch {}
  (async () => {
    let b = null;
    if (forced !== "2d") { try { b = await makeGpuPlayer(overlay, layer, canvas, onLive); } catch { b = null; } }
    if (!b) b = make2dPlayer(overlay, layer, canvas, onLive);
    if (dead) { try { b.destroy(); } catch {} return; }
    backend = b;
    if (lastInk != null && b.ink) b.ink(lastInk);
    if (lastPose) b.pose(lastPose);
    const q = queue; queue = [];
    for (const [i, bytes] of q) b.frame(i, bytes);
  })();
  return {
    mode: () => (backend ? backend.mode : "pending"),
    frame(i, bytes) { if (backend) backend.frame(i, bytes); else queue.push([i, bytes]); },
    pose(name) { lastPose = name; if (backend) backend.pose(name); },
    ink(on) { lastInk = !!on; return backend && backend.ink ? backend.ink(on) : false; },   // truthy → caller replays (2D re-key)
    reset() { queue = []; if (backend) backend.reset(); },
    destroy() { dead = true; if (backend) backend.destroy(); },
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

// ── APPEARANCE — the ONE panel behind the ⋯ door: how your computer looks (Dark · Light · Immersive,
// the SAME holo.theme.v1 row home wears, via the canonical HoloTheme.setMode contract) and how it wakes
// (the boot styles). No login-only state anywhere: pick here, the whole OS follows. ────────────────────
const THEME_MODES = ["dark", "light", "immersive"];
function themeMode() {
  try { const t = JSON.parse(localStorage.getItem("holo.theme.v1") || "{}") || {}; return t.immersive === false ? (t.palette === "light" ? "light" : "dark") : "immersive"; } catch { return "immersive"; }
}
function themeWallSrc() {
  let w = ""; try { w = (JSON.parse(localStorage.getItem("holo.theme.v1") || "{}") || {}).wallpaper || ""; } catch {}
  const m = String(w).match(/^(sha256|blake3|sha512):([0-9a-f]+)$/i);
  let src = m ? ("/.holo/" + m[1].toLowerCase() + "/" + m[2]) : ((!w || w === "plain" || /^live:/i.test(w)) ? "" : w);
  if (!src) { try { src = localStorage.getItem("holo-messenger/wallpaper-src") || ""; } catch {} }
  return src || "/apps/holo-messenger/_vendor/wallpaper-default.jpg";
}
function applyMode(overlay, m) {
  try {
    if (window.HoloTheme && window.HoloTheme.setMode) window.HoloTheme.setMode(m);
    else { const t = JSON.parse(localStorage.getItem("holo.theme.v1") || "{}") || {}; if (m === "immersive") t.immersive = true; else { t.palette = m; t.immersive = false; } localStorage.setItem("holo.theme.v1", JSON.stringify(t)); }
  } catch {}
  overlay.setAttribute("data-appearance", m);
  const wall = overlay.querySelector(".hl-wall");
  if (wall) wall.style.backgroundImage = m === "immersive" ? 'url("' + themeWallSrc() + '")' : "none";
}

// ── the panel: modes on top, boot styles beneath, the host's rare doors at the bottom — everything
// applies LIVE behind the sheet. `host.actions` is whatever the greeter offers (recovery flows today);
// read at open time, rendered as one quiet row, gone when empty. ───────────────────────────────────────
function openGallery(overlay, current, onPick, host) {
  const gal = document.createElement("div"); gal.className = "hlp-gal";
  gal.innerHTML = `<div class="hlp-sheet" role="dialog" aria-label="Appearance">
    <div class="hlp-head"><div class="hlp-title">Appearance</div>
      <button class="hlp-x" aria-label="Close">✕</button></div>
    <div class="hlp-modes" role="radiogroup" aria-label="Theme"></div>
    <div class="hlp-srch"><input type="search" placeholder="Search" spellcheck="false"></div>
    <div class="hlp-grid"></div>
    <div class="hlp-acts"></div>
    <div class="hlp-foot">Animations by <a href="https://github.com/adi1090x/plymouth-themes" target="_blank" rel="noopener">adi1090x</a> · GPL 3.0</div>
  </div>`;
  const acts = gal.querySelector(".hlp-acts");
  const hostActs = (host && Array.isArray(host.actions)) ? host.actions : [];
  if (!hostActs.length) acts.remove();
  else for (const a of hostActs) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = a.label;
    b.onclick = () => { close(); try { a.run(); } catch {} };
    acts.appendChild(b);
  }
  const modes = gal.querySelector(".hlp-modes");
  const drawModes = () => { const cur = themeMode(); modes.querySelectorAll("button").forEach((b) => { const on = b.dataset.mode === cur; b.classList.toggle("on", on); b.setAttribute("aria-checked", String(on)); }); };
  for (const m of THEME_MODES) {
    const b = document.createElement("button");
    b.type = "button"; b.dataset.mode = m; b.setAttribute("role", "radio");
    b.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    b.onclick = () => { applyMode(overlay, m); drawModes(); };   // live — the lock re-inks behind the sheet
    modes.appendChild(b);
  }
  drawModes();
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

// ── attachPlymouth(overlay, host) — the ONE call the greeter makes. Returns the choreography controller.
// `host.actions` (optional, read lazily at panel-open) = rare doors the greeter wants inside the ⋯ panel. ──
export function attachPlymouth(overlay, host) {
  if (!overlay || overlay.querySelector(".hlp-btn")) return null;
  injectCss();
  const state = readState();
  try { if (!localStorage.getItem(KEY)) writeState(state); } catch {}   // persist the default → next cold boot gets the 0-ms baseline
  try { if (!overlay.getAttribute("data-appearance")) overlay.setAttribute("data-appearance", themeMode()); } catch {}   // primitive overlays get the mode too
  let layer = null, canvas = null, player = null, gen = 0;

  function ensureLayer() {
    if (layer) return;
    layer = document.createElement("div"); layer.className = "hlp";
    canvas = document.createElement("canvas");
    layer.appendChild(canvas);
    const wall = overlay.querySelector(".hl-wall");
    if (wall && wall.nextSibling) overlay.insertBefore(layer, wall.nextSibling); else overlay.prepend(layer);
    // onLive fires at the backend's FIRST drawable frame (whichever backend won the ladder):
    // the splash is alive — it wears the avatar slot and the 0-ms baseline still yields.
    player = makePlayer(overlay, layer, canvas, () => {
      try { layer.classList.add("on"); overlay.classList.add("hlp-anchor"); dropBaseline(); } catch {}
    });
    player.ink(isInk());
  }
  // the LIGHT appearance prints the emblem in ink (a white sprite on paper would vanish). The signal is
  // the overlay's [data-appearance] — the appearance switch flips it; observing keeps the modules decoupled.
  const isInk = () => { try { return overlay.getAttribute("data-appearance") === "light"; } catch { return false; } };
  try {
    new MutationObserver(() => {
      if (!player) return;
      if (player.ink(isInk())) play(state.theme);          // 2D floor re-keys by replaying (κ-local, fast)
    }).observe(overlay, { attributes: true, attributeFilter: ["data-appearance"] });
  } catch {}
  function play(theme) {
    ensureLayer();
    const my = ++gen;
    player.reset();
    layer.classList.remove("done");
    loadFrames(theme, (i, bytes) => { if (my === gen) player.frame(i, bytes); }, () => my !== gen)
      .catch(() => { if (my === gen && state.on) { layer.classList.remove("on"); overlay.classList.remove("hlp-anchor"); } });   // no frames at all → wallpaper + circle stay
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
    // one 5s boot beat, counted from the baseline's 0-ms frame (window.__hlBootT0) — not from module load,
    // so the module's endBoot (pose glide + baseline drop) lands together with the panel's rise
    let bootLeft = 5000;
    try { if (window.__hlBootT0) bootLeft = Math.max(250, 5000 - (Date.now() - window.__hlBootT0)); } catch {}
    const t = setTimeout(endBoot, bootLeft);
    overlay.addEventListener("pointerdown", () => { clearTimeout(t); endBoot(); }, { once: true, capture: true });
    document.addEventListener("keydown", () => { clearTimeout(t); endBoot(); }, { once: true, capture: true });
  } else if (state.on) { setTimeout(endBoot, 0); }
  if (state.on) play(state.theme);

  // the ⋯ door — appearance + boot style in ONE panel, same affordance as the home screen
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "hlp-btn"; btn.title = "Appearance"; btn.setAttribute("aria-label", "Appearance");
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`;
  btn.onclick = () => openGallery(overlay, readState().on ? readState().theme : null, (name) => api.setTheme(name), host);
  btn.addEventListener("pointerenter", () => { try { store(); } catch {} }, { passive: true, once: true });   // warm the κ store during hover intent
  overlay.appendChild(btn);

  const api = {
    setTheme(name) {
      const s = readState();
      if (!name) {
        writeState({ ...s, on: false, firstFrame: undefined });
        gen++; if (layer) layer.classList.remove("on");
        overlay.classList.remove("hlp-anchor");           // splash off → the avatar circle returns
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
  try { window.HoloPlymouth = { open: () => btn.click(), set: (n) => api.setTheme(n), themes: CATALOG.map((t) => t.name), state: readState, mode: () => (player ? player.mode() : "none") }; } catch {}
  return api;
}
export default attachPlymouth;
