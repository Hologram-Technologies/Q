// holo-machine-witness.mjs — THIS MACHINE, read live and shown back: the manifesto's living proof.
//
// Lifted from the docs site (download.html — "The power is already here.") into ONE canonical module so
// the manifesto reader can prove its first section on the reader's own silicon. Every figure is measured
// on this device, right now (Law L5: state only what is measured): cores / memory / GPU / display are real
// API reads with honest fallbacks ("Multi core", "or more", "No WebGPU"); the live line counts REAL
// floating point operations — a timed CPU multiply-add burst immediately, then a real WebGPU FMA dispatch
// when the device has one — so the "ASCI Red · 1997 world record" hairline (1.068 TFLOP/s, TOP500) can
// only ever be crossed by a genuine measurement. Nothing is simulated; the record caption renders ONLY
// when the measured line truly crosses it.
//
// Lifecycle-honest (the download.html original runs forever — this one must not): bursts arm when the
// panel enters the viewport, pause when it leaves, and stop() tears everything down. One call:
//   const w = mountWitness(hostEl, { root: scrollContainer });  …  w.stop();
// Self-contained CSS (greeter tokens with fallbacks), fail-open, zero dependencies.

const RECORD = 1.068e12; // ASCI Red, Sandia — first machine past 1 TFLOP/s, world's fastest 1997–2000 (TOP500)

const ICONS = {
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.4"/><path d="M10 2.5v3M14 2.5v3M10 18.5v3M14 18.5v3M2.5 10h3M2.5 14h3M18.5 10h3M18.5 14h3"/></svg>',
  mem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M6 7v10M10 7v10M14 7v10M18 7v10M5 17v2.5M19 17v2.5"/></svg>',
  gpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><circle cx="9" cy="12" r="2.4"/><circle cx="15.5" cy="10.5" r="1.4"/></svg>',
  disp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="4" width="19" height="13" rx="1.6"/><path d="M9 21h6M12 17v4"/></svg>',
};

const CSS = `
.hmw{border:1px solid var(--glass-border,rgba(255,255,255,.11));border-radius:14px;background:rgba(255,255,255,.025);
  padding:clamp(18px,2.6vw,28px);color:var(--ink,#e6edf3);font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
  opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s ease}
.hmw.on{opacity:1;transform:none}
.hmw-label{font:600 11px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.24em;color:var(--muted,#8b949e);margin:0 0 8px}
.hmw-head{font-size:clamp(20px,2.6vw,25px);font-weight:700;letter-spacing:-.01em;color:var(--ink,#f4f7fc);margin:0 0 18px}
.hmw-specs{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 12px}
.hmw-spec{border:1px solid var(--glass-border,rgba(255,255,255,.09));border-radius:10px;padding:12px 14px;background:rgba(255,255,255,.02)}
.hmw-spec .r{display:flex;align-items:center;gap:8px;font:600 10.5px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.16em;color:var(--muted,#8b949e);text-transform:uppercase}
.hmw-spec .r svg{width:15px;height:15px;color:#7defc9;opacity:.9}
.hmw-spec .v{margin:7px 0 2px;font-size:clamp(17px,2vw,21px);font-weight:700;color:var(--ink,#f4f7fc);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hmw-spec .s{font-size:12px;color:var(--muted,#8b949e)}
.hmw-live{border:1px solid var(--glass-border,rgba(255,255,255,.09));border-radius:10px;padding:14px 16px 12px;background:rgba(255,255,255,.02)}
.hmw-live-head{display:flex;align-items:center;gap:10px}
.hmw-live-l{display:inline-flex;align-items:center;gap:7px;font:600 10.5px/1 "Segoe UI",system-ui,sans-serif;letter-spacing:.16em;color:var(--muted,#8b949e);text-transform:uppercase}
.hmw-dot{width:7px;height:7px;border-radius:50%;background:#7defc9;box-shadow:0 0 8px rgba(125,239,201,.7)}
.hmw-chips{margin-left:auto;display:inline-flex;gap:6px}
.hmw-chip{font-size:11.5px;padding:3px 9px;border-radius:999px;border:1px solid var(--glass-border,rgba(255,255,255,.12));color:var(--ink-dim,rgba(231,237,250,.8))}
.hmw-chip.ok{border-color:rgba(125,239,201,.4)}
.hmw-val{margin:10px 0 6px;color:var(--ink,#f4f7fc)}
.hmw-val b{font-size:clamp(26px,3.4vw,34px);font-weight:700;letter-spacing:-.01em}
.hmw-val .u{margin-left:7px;font-size:13px;color:var(--muted,#8b949e)}
.hmw-canvas{display:block;width:100%;height:clamp(150px,24vh,220px)}
.hmw-caption{margin:14px 2px 2px;font-size:15px;line-height:1.6;color:var(--ink-dim,rgba(231,237,250,.87));
  opacity:0;transition:opacity .8s ease;min-height:1.6em}
.hmw-caption.on{opacity:1}
@media (max-width:560px){.hmw-specs{grid-template-columns:1fr}.hmw-canvas{height:140px}}
@media (prefers-reduced-motion:reduce){.hmw{opacity:1;transform:none;transition:none}.hmw-caption{transition:none}}
`;

function injectCss(doc) {
  try { if (doc.getElementById("holo-machine-witness-css")) return; const s = doc.createElement("style"); s.id = "holo-machine-witness-css"; s.textContent = CSS; doc.head.appendChild(s); } catch {}
}

// Chrome wraps the real GPU name as "ANGLE (Vendor, Name Direct3D11 vs_5_0 ps_5_0, D3D11)"; names can
// contain their own parens ("Radeon(TM)"), so unwrap the ANGLE shell by its ends, not a [^)] match.
function cleanGPU(s) {
  if (!s) return null;
  let core = s.replace(/^ANGLE\s*\(/i, "").replace(/\)\s*$/, "");
  core = core.replace(/,\s*(D3D11|D3D9|OpenGL|Vulkan|Metal)[^,]*$/i, "");
  core = core.replace(/\b(Direct3D11|Direct3D9|OpenGL ES[\d.]*|vs_\d_\d|ps_\d_\d)\b/ig, " ");
  core = core.replace(/\(0x[0-9a-f]+\)/ig, "");
  const name = core.split(",").map((x) => x.trim()).filter(Boolean).sort((a, b) => b.length - a.length)[0] || core;
  return name.replace(/\s{2,}/g, " ").trim() || null;
}
function gpuName(doc) {
  try {
    const c = doc.createElement("canvas");
    const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return cleanGPU(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch { return null; }
}

// the real WebGPU measurement: a genuine FMA dispatch, FLOPs counted from the dispatch dimensions,
// timed around onSubmittedWorkDone. Results land in a storage buffer so the work cannot be elided.
async function gpuComputeInit() {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const GROUPS = 1024, WG = 64, INV = GROUPS * WG;
  const code = `
struct P { k : u32, pad0 : u32, pad1 : u32, pad2 : u32 };
@group(0) @binding(0) var<uniform> p : P;
@group(0) @binding(1) var<storage, read_write> out : array<vec4f>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g : vec3u) {
  var a0 = vec4f(f32(g.x % 977u) * 0.000001 + 1.0);
  var a1 = a0 + vec4f(0.25); var a2 = a0 + vec4f(0.5); var a3 = a0 + vec4f(0.75);
  let b = vec4f(1.0000001);
  let c = vec4f(0.5);
  // four independent chains per invocation — throughput-bound, not latency-bound (a single dependent
  // chain measures FMA latency, which understates the machine; the count stays exact: 32 FLOPs/iter).
  for (var i = 0u; i < p.k; i = i + 1u) { a0 = fma(a0, b, c); a1 = fma(a1, b, c); a2 = fma(a2, b, c); a3 = fma(a3, b, c); }
  out[g.x % 4096u] = a0 + a1 + a2 + a3;
}`;
  const module = device.createShaderModule({ code });
  const pipeline = await device.createComputePipelineAsync({ layout: "auto", compute: { module, entryPoint: "main" } });
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const out = device.createBuffer({ size: 4096 * 16, usage: GPUBufferUsage.STORAGE });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: out } }] });
  let k = 4096;
  const info = adapter.info || null;
  return {
    label: info && (info.architecture || info.vendor) ? String(info.architecture || info.vendor) : null,
    destroy() { try { device.destroy(); } catch {} },
    async burst() {
      device.queue.writeBuffer(uni, 0, new Uint32Array([k, 0, 0, 0]));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(GROUPS); pass.end();
      const t0 = performance.now();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
      const dt = performance.now() - t0;
      if (!(dt > 0)) return null;
      const flops = INV * k * 32; // 4 chains × vec4 fma (4 mul + 4 add) per iteration
      k = Math.max(1024, Math.min(1 << 20, Math.round(k * (7 / dt)))); // aim ~7ms next burst
      return flops / (dt / 1000);
    },
  };
}

export function mountWitness(host, opts = {}) {
  const doc = host.ownerDocument || document;
  injectCss(doc);
  const reduced = (() => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } })();

  host.innerHTML = `<div class="hmw" role="group" aria-label="This machine, measured live">
    <div class="hmw-label">THIS MACHINE</div>
    <div class="hmw-head">The power is already here.</div>
    <div class="hmw-specs">
      <div class="hmw-spec"><div class="r">${ICONS.cpu}<span>Processor</span></div><div class="v" data-w="cpu">Reading</div><div class="s" data-w="cpu-s">parallel cores</div></div>
      <div class="hmw-spec"><div class="r">${ICONS.mem}<span>Memory</span></div><div class="v" data-w="mem">Reading</div><div class="s" data-w="mem-s">of memory</div></div>
      <div class="hmw-spec"><div class="r">${ICONS.gpu}<span>Graphics</span></div><div class="v" data-w="gpu">Reading</div><div class="s" data-w="gpu-s">GPU accelerated</div></div>
      <div class="hmw-spec"><div class="r">${ICONS.disp}<span>Display</span></div><div class="v" data-w="disp">Reading</div><div class="s" data-w="disp-s">native resolution</div></div>
    </div>
    <div class="hmw-live">
      <div class="hmw-live-head"><span class="hmw-live-l"><span class="hmw-dot"></span>Live compute</span>
        <span class="hmw-chips"><span class="hmw-chip" data-w="chip">WebGPU</span><span class="hmw-chip"><b data-w="fps">&mdash;</b> fps</span></span></div>
      <div class="hmw-val"><b data-w="ops">&mdash;</b><span class="u" data-w="unit">measuring</span></div>
      <canvas class="hmw-canvas" data-w="canvas"></canvas>
    </div>
    <div class="hmw-caption" data-w="caption" aria-live="polite"></div>
  </div>`;

  const $ = (n) => host.querySelector(`[data-w="${n}"]`);
  const rootEl = host.querySelector(".hmw");
  const canvas = $("canvas"), ctx = canvas.getContext("2d");
  const opsEl = $("ops"), unitEl = $("unit"), fpsEl = $("fps"), chipEl = $("chip"), capEl = $("caption");

  // ── state ──
  let alive = true, visible = false, revealed = false, raf = 0, timer = 0;
  const N = 72, vals = new Array(N).fill(0), disp = new Array(N).fill(0);
  let peak = 1, dispPeak = 1, W = 1, H = 1;
  let mode = "cpu", cpuOps = 0, gpuOps = 0, cores = 0, crossedRuns = 0, captioned = false, startedAt = 0;
  let gpuCtx = null, gpuBusy = false, iters = 1000000;
  let frames = 0, fpsT0 = 0;

  function countUp(el, target, fmt) {
    el.textContent = fmt(target);
    if (reduced || doc.hidden || !(target > 0)) return;
    let t0 = null;
    const tick = (now) => {
      if (!alive) return;
      if (t0 === null) t0 = now;
      const p = Math.min(1, (now - t0) / 850), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(Math.round(target * e));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(target);
    };
    requestAnimationFrame(tick);
  }

  function scan() {
    const dpr = window.devicePixelRatio || 1;
    cores = navigator.hardwareConcurrency || 0;
    const mem = navigator.deviceMemory || 0; // GB, a LOWER bound (Chrome caps at 8) — hence "or more"
    const gpu = gpuName(doc);
    const sw = screen.width || window.innerWidth || 0, sh = screen.height || window.innerHeight || 0;
    const pw = Math.round(sw * dpr), ph = Math.round(sh * dpr);
    if (cores) countUp($("cpu"), cores, (n) => n + (n === 1 ? " core" : " cores")); else $("cpu").textContent = "Multi core";
    if (mem) { countUp($("mem"), mem, (n) => n + " GB"); $("mem-s").textContent = mem >= 8 ? "or more" : "of memory"; } else $("mem").textContent = "Ample";
    if (gpu) $("gpu").textContent = gpu; else $("gpu").textContent = "Hardware accelerated";
    if (pw && ph) { $("disp").textContent = pw + " × " + ph; $("disp-s").textContent = dpr >= 2 ? "high density" : "native resolution"; }
    else $("disp").textContent = "Sharp";
  }

  // ── the CPU measurement: a tight multiply-add loop, timed; self-tunes toward ~4ms. ──
  function cpuBurst() {
    const n = iters; let x = 1.0;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { x = x * 1.0000001 + 0.5; }
    const dt = performance.now() - t0;
    window.__holoSink = x; // read the result so the loop cannot be elided
    if (dt > 0) { cpuOps = (n * 2) / (dt / 1000); iters = Math.max(200000, Math.min(8000000, Math.round(n * (4 / dt)))); }
  }

  function fmtUnit(v) {
    if (v >= 1e12) return [(v / 1e12).toFixed(2), "TFLOP/s"];
    if (v >= 1e9) return [(v / 1e9).toFixed(2), "GFLOP/s"];
    if (v >= 1e6) return [(v / 1e6).toFixed(0), "MFLOP/s"];
    return [String(Math.round(v / 1e3)), "kFLOP/s"];
  }
  function fmtWords(v) {
    if (v >= 1e12) return (v / 1e12).toFixed(1) + " trillion";
    if (v >= 1e9) return (v / 1e9).toFixed(1) + " billion";
    return Math.round(v / 1e6) + " million";
  }

  function pushSample() {
    const v = mode === "gpu" ? gpuOps : cpuOps;
    if (!(v > 0)) return;
    vals.push(v); vals.shift();
    peak = Math.max(peak * 0.9, Math.max.apply(null, vals)) || 1;
    const [t, u] = fmtUnit(v);
    opsEl.textContent = t; unitEl.textContent = u;
    if (mode === "gpu") { crossedRuns = v > RECORD ? crossedRuns + 1 : 0; }
    if (reduced) { for (let i = 0; i < N; i++) disp[i] = vals[i]; dispPeak = peak; render(); }
    maybeCaption();
  }

  // the words respond — one sentence, manifesto voice, only what was measured. The sentence is written
  // once, and may STRENGTHEN once: the burst self-tunes upward for a few seconds, so a machine that
  // crosses the 1997 record just after the first sentence gets the sentence it earned.
  let captionCrossed = false;
  function maybeCaption() {
    if (!startedAt || performance.now() - startedAt < 3200) return;
    const v = mode === "gpu" ? gpuOps : cpuOps;
    if (!(v > 0)) return;
    const crossed = mode === "gpu" && crossedRuns >= 4;
    if (captioned && (!crossed || captionCrossed)) return;
    let text;
    if (crossed) {
      text = "This device just passed the fastest computer on Earth in 1997. Not our claim. Your measurement.";
      captionCrossed = true;
    } else if (mode === "gpu") {
      text = "You just watched this device do " + fmtWords(v) + " calculations per second, measured live. Not our claim. Your measurement.";
    } else {
      text = "That was a single thread of this device doing " + fmtWords(v) + " calculations per second, measured live" +
        (cores > 1 ? ", and it has " + cores + " of them." : ".");
    }
    capEl.textContent = text; capEl.classList.add("on"); captioned = true;
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    if (!(W > 1 && H > 1)) return;
    ctx.clearRect(0, 0, W, H);
    const showRecord = mode === "gpu";
    const top = Math.max((dispPeak > 0 ? dispPeak : 1) * 1.15, showRecord ? RECORD * 1.28 : 0) || 1;
    const pad = 14, h = H - pad - 2;
    const X = (i) => (i / (N - 1)) * W;
    const Y = (v) => pad + h - Math.max(0, Math.min(1, v / top)) * h;
    if (showRecord) { // the 1997 world record, drawn where it truly sits on this scale
      const ry = Y(RECORD);
      ctx.save(); ctx.setLineDash([6, 5]); ctx.strokeStyle = "rgba(231,237,250,.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(W, ry); ctx.stroke(); ctx.restore();
      ctx.font = '600 12.5px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = "right";
      const lbl = "ASCI Red · 1997 world record", tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "rgba(13,16,20,.82)"; ctx.fillRect(W - 12 - tw - 7, ry - 21, tw + 14, 18);
      ctx.fillStyle = "rgba(231,237,250,.85)"; ctx.fillText(lbl, W - 12, ry - 7);
    }
    ctx.beginPath(); ctx.moveTo(0, H);
    for (let i = 0; i < N; i++) ctx.lineTo(X(i), Y(disp[i]));
    ctx.lineTo(W, H); ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, H);
    fill.addColorStop(0, "rgba(125,239,201,0.30)"); fill.addColorStop(1, "rgba(125,239,201,0)");
    ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath();
    for (let j = 0; j < N; j++) { const px = X(j), py = Y(disp[j]); j ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    const line = ctx.createLinearGradient(0, 0, W, 0);
    line.addColorStop(0, "#5b8cff"); line.addColorStop(1, "#7defc9");
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    const lx = X(N - 1), ly = Y(disp[N - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 6.5, 0, 6.2832); ctx.fillStyle = "rgba(125,239,201,0.22)"; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 2.6, 0, 6.2832); ctx.fillStyle = "#7defc9"; ctx.fill();
  }

  function draw(now) {
    if (!alive || !visible) { raf = 0; return; }
    frames++;
    if (!fpsT0) fpsT0 = now;
    if (now - fpsT0 >= 500) { fpsEl.textContent = String(Math.round(frames * 1000 / (now - fpsT0))); frames = 0; fpsT0 = now; }
    dispPeak += (peak - dispPeak) * 0.07;
    for (let i = 0; i < N; i++) disp[i] += (vals[i] - disp[i]) * 0.16;
    render();
    raf = requestAnimationFrame(draw);
  }

  async function tick() {
    timer = 0; // the scheduling id has fired — never let a stale handle read as "measuring"
    if (!alive || !visible) return;
    cpuBurst();
    if (gpuCtx && !gpuBusy) {
      gpuBusy = true;
      try { const v = await gpuCtx.burst(); if (v > 0) { gpuOps = v; mode = "gpu"; } } catch { gpuCtx = null; }
      gpuBusy = false;
    }
    pushSample();
    if (alive && visible) timer = setTimeout(tick, 380);
  }

  function arm() { // (re)start the measured loop — idempotent
    if (!alive || !visible) return;
    if (!startedAt) startedAt = performance.now();
    resize();
    if (!timer) tick();
    if (!reduced && !raf) raf = requestAnimationFrame(draw);
  }
  function pause() {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    fpsT0 = 0; frames = 0;
  }

  function reveal() {
    if (revealed) return; revealed = true;
    rootEl.classList.add("on");
    scan();
    // the honest probe first (chip), then the real compute context (the record line's only key)
    if (!navigator.gpu) { chipEl.textContent = "No WebGPU"; }
    else {
      gpuComputeInit().then((g) => {
        if (!alive) { if (g) g.destroy(); return; }
        if (!g) { chipEl.textContent = "No WebGPU"; return; }
        gpuCtx = g; chipEl.classList.add("ok");
        chipEl.textContent = g.label ? "WebGPU · " + g.label : "WebGPU";
      }).catch(() => { chipEl.textContent = "No WebGPU"; });
    }
  }

  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    if (v) { reveal(); arm(); } else pause();
  }
  // IO is the arm-on-first-layout signal; the scroll fallback is the truth under throttled frames
  // (IntersectionObserver callbacks ride on rendering frames — a starved/backgrounded tab can stop
  // delivering them entirely, which would leave the bursts running offscreen. Geometry never lies.)
  function geomVisible() {
    try {
      const r = rootEl.getBoundingClientRect();
      const b = opts.root ? opts.root.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      return r.bottom > b.top + 30 && r.top < b.bottom - 30;
    } catch { return visible; }
  }
  let io = null, ro = null, lastGeom = 0, scrolls = 0;
  const onScroll = () => {
    scrolls++;
    const now = performance.now();
    if (now - lastGeom < 140) return;
    lastGeom = now;
    setVisible(geomVisible());
  };
  try {
    io = new IntersectionObserver((es) => { for (const e of es) setVisible(e.isIntersecting); },
      { root: opts.root || null, threshold: 0.18 });
    io.observe(rootEl);
  } catch { setVisible(true); }
  try { (opts.root || window).addEventListener("scroll", onScroll, { passive: true }); } catch {}
  try { ro = new ResizeObserver(resize); ro.observe(canvas); } catch {}

  // instrumentation for gates: the ceremony/film can assert measurement + teardown without sleeping.
  const state = () => ({ revealed, visible, measuring: !!(timer || raf), mode, cpuOps, gpuOps, crossed: crossedRuns >= 4, scrolls, geom: geomVisible() });
  try { (window.__holoWitness = window.__holoWitness || []).push(state); } catch {}

  return {
    state,
    stop() {
      alive = false; visible = false; pause();
      try { (opts.root || window).removeEventListener("scroll", onScroll); } catch {}
      try { io && io.disconnect(); } catch {}
      try { ro && ro.disconnect(); } catch {}
      if (gpuCtx) { try { gpuCtx.destroy(); } catch {} gpuCtx = null; }
      try { window.__holoWitness = (window.__holoWitness || []).filter((f) => f !== state); } catch {}
    },
  };
}
export default mountWitness;
