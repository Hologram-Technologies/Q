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
//   • BOOT CHOREOGRAPHY — cold open: black + the splash dead-center, exactly like the metal. When the
//     greeter panel rises, the splash recedes into a living wallpaper behind it; the biometric moment
//     (Plymouth's password prompt) brings it back to attention; success flares it out with the unfog.
//   • PICKED FROM THE LOGIN SCREEN — a quiet "Boot style" door opens the gallery (upstream's own GIF
//     previews), pick → streams → sealed → worn. Persisted in holo.plymouth.v1; frame-0 is cached as a
//     data URL so the NEXT cold boot paints the splash at literal first frame, zero network.
//
// Fail-open everywhere: no network + no seal → the wallpaper greeter, unchanged. Reduced motion → the
// splash holds frame 0. Consumed by holo-signin.mjs (one call: attachPlymouth(overlay)).

const KEY = "holo.plymouth.v1";
const FRK = (t) => "holo.plymouth.frames:" + t;     // per-theme sealed-frame manifest (array of κ)
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
const mb = (kb) => (kb >= 1000 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB");

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

// ── frame loading: κ store first (offline), CDN stream + seal on a miss (self-heal, Law L5) ───────────
// onFrame(i, img) fires as frames become drawable — playback starts on the first one, torrent-style.
async function loadFrames(theme, onFrame, cancelled) {
  const t = themeOf(theme); if (!t) throw new Error("unknown theme " + theme);
  const st = await store();
  let manifest = null; try { manifest = JSON.parse(localStorage.getItem(FRK(theme)) || "null"); } catch {}
  const total = (manifest && manifest.length) || t.frames;
  const kappas = new Array(total).fill(null);
  let firstBytes = null, loaded = 0, missing = 0;

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
    let bytes = null;
    if (manifest && manifest[i]) { try { bytes = await st.get(manifest[i]); } catch {} }
    if (!bytes) {
      try { const r = await fetch(frameUrl(t, i), { cache: "force-cache" }); if (r.ok) bytes = new Uint8Array(await r.arrayBuffer()); } catch {}
      if (bytes) { try { kappas[i] = await st.put(bytes); } catch {} }
    } else kappas[i] = manifest[i];
    if (!bytes) { missing++; return; }
    if (i === 0) firstBytes = bytes;
    loaded++;
    await toImage(bytes, i);
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

// ── styles: the splash layer + its choreography + the gallery — self-contained, injected once ─────────
const CSS = `
#holo-login .hlp{position:fixed;inset:0;z-index:0;pointer-events:none;background:#000;opacity:0;transition:opacity .5s ease}
#holo-login .hlp.on{opacity:1}
#holo-login .hlp canvas{position:absolute;inset:0;width:100%;height:100%;transition:opacity .9s ease,filter .9s ease,transform .9s cubic-bezier(.4,0,.2,1)}
#holo-login .hlp.greet canvas{opacity:.42;filter:blur(1.2px) brightness(.85);transform:scale(1.06)}
#holo-login .hlp.verify canvas{opacity:.9;filter:none;transform:scale(1)}
#holo-login .hlp.done canvas{opacity:0;filter:brightness(1.7);transform:scale(1.1);transition:opacity .62s ease,filter .62s ease,transform .62s ease}
#holo-login.hl-boot .hl-panel{opacity:0!important;pointer-events:none!important}
#holo-login .hl-panel{transition:opacity .55s ease}
#holo-login .hlp-btn{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(18px,env(safe-area-inset-bottom));z-index:4;
  pointer-events:auto;display:inline-flex;align-items:center;gap:.5em;background:rgba(10,14,20,.42);border:1px solid rgba(255,255,255,.14);
  color:rgba(231,237,250,.78);font:500 12.5px/1 "Segoe UI",system-ui,sans-serif;padding:9px 14px;border-radius:999px;cursor:pointer;
  backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:color .15s,border-color .15s,background .15s;opacity:0;animation:hlp-in .6s ease 1.1s forwards}
#holo-login .hlp-btn:hover{color:#fff;border-color:rgba(125,239,201,.55);background:rgba(10,14,20,.62)}
#holo-login .hlp-btn svg{width:1.1em;height:1.1em}
@keyframes hlp-in{to{opacity:1}}
#holo-login .hlp-gal{position:fixed;inset:0;z-index:6;pointer-events:auto;background:rgba(1,4,9,.66);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  display:grid;place-items:center;animation:hlp-fade .22s ease}
@keyframes hlp-fade{from{opacity:0}}
#holo-login .hlp-sheet{width:min(58rem,94vw);max-height:84vh;display:flex;flex-direction:column;overflow:hidden;background:rgba(8,12,18,.92);
  border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 28px 80px rgba(0,0,0,.6);color:#e6edf3;font-family:"Segoe UI",system-ui,sans-serif}
#holo-login .hlp-head{display:flex;align-items:center;gap:12px;padding:16px 18px 10px}
#holo-login .hlp-title{font-size:1.06rem;font-weight:600}
#holo-login .hlp-sub{font-size:.78rem;color:#8b949e}
#holo-login .hlp-x{margin-left:auto;width:30px;height:30px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:#c9d1d9;cursor:pointer;font-size:15px}
#holo-login .hlp-x:hover{background:rgba(255,255,255,.16)}
#holo-login .hlp-srch{padding:0 18px 12px}
#holo-login .hlp-srch input{width:100%;background:rgba(1,4,9,.6);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:9px 15px;color:#e6edf3;font:inherit;font-size:.85rem;outline:none}
#holo-login .hlp-srch input:focus{border-color:#34d3a6}
#holo-login .hlp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11.5rem,1fr));gap:12px;padding:4px 18px 16px;overflow:auto}
#holo-login .hlp-tile{display:flex;flex-direction:column;border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden;cursor:pointer;background:#05070c;text-align:left;padding:0;color:inherit;font:inherit;transition:transform .1s,border-color .12s;position:relative}
#holo-login .hlp-tile:hover{transform:translateY(-2px);border-color:#34d3a6}
#holo-login .hlp-tile.sel{border-color:#34d3a6;box-shadow:0 0 0 2px rgba(52,211,166,.45)}
#holo-login .hlp-tile.sel::after{content:"\\2713";position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:#34d3a6;color:#06140f;display:grid;place-content:center;font-size:14px;font-weight:700}
#holo-login .hlp-prev{height:104px;background:#000;display:grid;place-items:center;overflow:hidden}
#holo-login .hlp-prev img{max-width:100%;max-height:100%;object-fit:contain}
#holo-login .hlp-prev.off{color:#6e7681;font-size:24px}
#holo-login .hlp-meta{padding:8px 11px;display:flex;flex-direction:column;gap:2px}
#holo-login .hlp-name{font-size:.83rem;font-weight:600;color:#e6edf3}
#holo-login .hlp-k{font-size:.72rem;color:#8b949e;font-family:ui-monospace,monospace}
#holo-login .hlp-tile.sealed .hlp-k{color:#3fb950}
#holo-login .hlp-foot{padding:10px 18px 14px;font-size:.72rem;color:#6e7681;border-top:1px solid rgba(255,255,255,.07)}
#holo-login .hlp-foot a{color:#58a6ff;text-decoration:none}
#holo-login .hlp-toast{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:7;background:rgba(13,17,23,.95);color:#e6edf3;
  border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 16px;font:.82rem "Segoe UI",system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.6);
  pointer-events:none;animation:hlp-toast 2.6s ease both}
@keyframes hlp-toast{0%{opacity:0;transform:translate(-50%,8px)}10%,82%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#holo-login .hlp canvas,#holo-login .hlp,#holo-login .hlp-btn{transition:none;animation:none;opacity:1}}
`;
function injectCss() {
  try { if (document.getElementById("holo-plymouth-css")) return; const s = document.createElement("style"); s.id = "holo-plymouth-css"; s.textContent = CSS; document.head.appendChild(s); } catch {}
}

const reducedMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// ── the player: one canvas, the Plymouth template verbatim (centered sprite, 25 fps, over black) ──────
function makePlayer(layer, canvas) {
  const ctx = canvas.getContext("2d");
  const images = [];            // sparse, filled as frames land
  let prefix = 0;               // contiguous playable prefix — the loop only plays what has landed
  let raf = 0, t0 = 0, lastIdx = -1, alive = true;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  function size() { canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr); lastIdx = -1; }
  size(); addEventListener("resize", size);
  function draw(idx) {
    const img = images[idx]; if (!img) return;
    const cw = canvas.width / dpr, ch = canvas.height / dpr;
    // Plymouth centers the sprite at its natural size on the boot display; cap at 62vmin so phones fit
    const s = Math.min(1, (Math.min(cw, ch) * 0.62) / Math.max(img.naturalWidth, img.naturalHeight));
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(img, (cw - w) / 2, (ch - h) / 2, w, h);
  }
  function loop(now) {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    if (document.hidden || prefix === 0) return;
    if (!t0) t0 = now;
    const idx = Math.floor((now - t0) / (1000 / FPS)) % Math.max(prefix, 1);
    if (idx !== lastIdx) { lastIdx = idx; draw(idx); }
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
    reset() { images.length = 0; prefix = 0; t0 = 0; lastIdx = -1; },
    destroy() { alive = false; cancelAnimationFrame(raf); removeEventListener("resize", size); },
  };
}

// ── the gallery: pick a boot style from the login screen — upstream's own GIF previews, live apply ────
function openGallery(overlay, current, onPick) {
  const gal = document.createElement("div"); gal.className = "hlp-gal";
  const sealedSet = new Set(CATALOG.filter((t) => { try { return !!localStorage.getItem(FRK(t.name)); } catch { return false; } }).map((t) => t.name));
  gal.innerHTML = `<div class="hlp-sheet" role="dialog" aria-label="Boot style">
    <div class="hlp-head"><div><div class="hlp-title">Boot style</div>
      <div class="hlp-sub">how this computer wakes up — streamed once, then sealed to κ on this device</div></div>
      <button class="hlp-x" aria-label="Close">✕</button></div>
    <div class="hlp-srch"><input type="search" placeholder="Search 80 boot animations — hud, hexagon, seal…" spellcheck="false"></div>
    <div class="hlp-grid"></div>
    <div class="hlp-foot">Animations: <a href="https://github.com/adi1090x/plymouth-themes" target="_blank" rel="noopener">adi1090x/plymouth-themes</a> · GPL-3.0 · every frame is a content-addressed object (Law L2) — once sealed, your boot works fully offline</div>
  </div>`;
  const grid = gal.querySelector(".hlp-grid");
  const close = () => { gal.remove(); document.removeEventListener("keydown", esc, true); };
  const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
  document.addEventListener("keydown", esc, true);
  gal.addEventListener("pointerdown", (e) => { if (e.target === gal) close(); });
  gal.querySelector(".hlp-x").onclick = close;

  function tile(t) {
    const el = document.createElement("button"); el.type = "button";
    el.className = "hlp-tile" + (current === (t ? t.name : null) ? " sel" : "") + (t && sealedSet.has(t.name) ? " sealed" : "");
    if (!t) el.innerHTML = `<div class="hlp-prev off">◌</div><div class="hlp-meta"><span class="hlp-name">Off</span><span class="hlp-k">wallpaper only</span></div>`;
    else el.innerHTML = `<div class="hlp-prev"><img loading="lazy" src="${t.preview}" alt=""></div>
      <div class="hlp-meta"><span class="hlp-name">${pretty(t.name)}</span>
      <span class="hlp-k">${sealedSet.has(t.name) ? "sealed to κ ✓" : t.frames + " frames · ~" + mb(t.kb)}</span></div>`;
    el.onclick = () => { close(); onPick(t ? t.name : null); };
    return el;
  }
  function draw(q) {
    grid.innerHTML = "";
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
    loadFrames(theme, (i, img) => { if (my === gen) player.frame(i, img); }, () => my !== gen)
      .catch(() => { if (my === gen && state.on) layer.classList.remove("on"); });   // no frames at all → wallpaper stays
  }

  // the boot beat: a moment of pure splash before the greeter rises — skippable, never a lock-out. Only
  // when the beat is ALREADY running (the host baseline started it at 0 ms) or the panel hasn't painted
  // yet (primitive-owned overlay): a panel the human can already see is never re-hidden.
  const endBoot = () => { try { overlay.classList.remove("hl-boot"); layer && layer.classList.add("greet"); } catch {} };
  const panelEl = overlay.querySelector("#holo-login-panel");
  const bootable = overlay.classList.contains("hl-boot") || !panelEl || !panelEl.childElementCount;
  if (state.on && bootable && !reducedMotion()) {
    overlay.classList.add("hl-boot");
    const t = setTimeout(endBoot, 1000);
    overlay.addEventListener("pointerdown", () => { clearTimeout(t); endBoot(); }, { once: true, capture: true });
    document.addEventListener("keydown", () => { clearTimeout(t); endBoot(); }, { once: true, capture: true });
  } else if (state.on) { setTimeout(endBoot, 0); }
  if (state.on) play(state.theme);

  // the door: pick the boot style right here, on the login screen
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "hlp-btn"; btn.title = "Choose how this computer boots";
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>Boot style`;
  btn.onclick = () => openGallery(overlay, readState().on ? readState().theme : null, (name) => api.setTheme(name));
  overlay.appendChild(btn);

  const api = {
    setTheme(name) {
      const s = readState();
      if (!name) {
        writeState({ ...s, on: false, firstFrame: undefined });
        gen++; if (layer) layer.classList.remove("on");
        toast(overlay, "Boot splash off — wallpaper only");
        return;
      }
      writeState({ ...s, on: true, theme: name, firstFrame: undefined });
      state.on = true; state.theme = name;
      layer && layer.classList.add("greet");
      const sealed = (() => { try { return !!localStorage.getItem(FRK(name)); } catch { return false; } })();
      toast(overlay, pretty(name) + (sealed ? " — from your κ store" : " — streaming, sealing to κ…"));
      play(name);
    },
    // choreography hooks for the greeter — all fail-open no-ops when the splash is off
    verify() { try { layer && layer.classList.add("verify"); } catch {} },
    calm() { try { layer && layer.classList.remove("verify"); } catch {} },
    complete() { try { endBoot(); if (layer) { layer.classList.remove("verify"); layer.classList.add("done"); } setTimeout(() => api.destroy(), 900); } catch {} },   // overlay is removed right after — stop the loop with it
    destroy() { gen++; try { player && player.destroy(); } catch {} },
  };
  try { window.HoloPlymouth = { open: () => btn.click(), set: (n) => api.setTheme(n), themes: CATALOG.map((t) => t.name), state: readState }; } catch {}
  return api;
}
export default attachPlymouth;
