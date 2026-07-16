// holo-pocket-voice.mjs — Q's live streaming voice (kyutai pocket-tts, on-device, 100% serverless).
// Client half: owns a module worker (pocket-worker.js), schedules decoded Float32 chunks GAPLESSLY on an
// AudioContext clock, and drives the orb via an AnalyserNode level callback. First audio ≈ 240ms after
// generate on a warm engine; weights persist in the Cache API so returning users warm with zero network.
//
//   createPocketVoice({ ctx }) → { warm(onProgress), isReady(), speak(text,{ctx,onLevel}), stop(), engine() }
//
// Fail-soft everywhere: any error → warm() resolves false / speak() resolves false, caller falls to its
// next rung. This module never throws into the caller.

const MIRROR = "https://huggingface.co/HOLOGRAMTECH/q-pocket-tts/resolve/main/";
const ORT_BASE = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.0/dist/";

export function createPocketVoice(opts = {}) {
  const base = opts.base || (typeof window !== "undefined" && window.__HOLO_POCKET_BASE) || MIRROR;
  const ortBase = opts.ortBase || ORT_BASE;
  let worker = null, ready = false, warming = null, engineInfo = null;
  let seq = 0;
  let session = null;   // active playback session

  // Worker boot needs a REAL served path: SW-synthetic root-abs urls (/usr/…) load fine as page fetches
  // but FAIL as worker-destination requests. So try each candidate and require its "boot" ack; a dead
  // candidate is terminated and the next tried. Relative-to-module first (real path when the module was
  // imported relatively), then root-abs, then a mount-prefixed guess derived from this module's own url.
  function bootWorker(url, ackMs) {
    return new Promise((res) => {
      let w = null;
      try { w = new Worker(url, { type: "module" }); } catch (e) { res(null); return; }
      const t = setTimeout(() => { try { w.terminate(); } catch (e) {} res(null); }, ackMs || 5000);
      w.addEventListener("message", function ack(e) {
        if ((e.data || {}).type === "boot") { clearTimeout(t); w.removeEventListener("message", ack); res(w); }
      });
      w.addEventListener("error", () => { clearTimeout(t); try { w.terminate(); } catch (e) {} res(null); });
    });
  }
  async function ensureWorker() {
    if (worker) return worker;
    const candidates = [];
    try { candidates.push(new URL("./pocket-worker.js", import.meta.url).href); } catch (e) {}
    candidates.push("/usr/lib/holo/voice/pocket/pocket-worker.js");
    try {
      const mount = (typeof location !== "undefined" ? location.pathname : "/").split("/")[1];
      if (mount) candidates.push(`/${mount}/usr/lib/holo/voice/pocket/pocket-worker.js`);
    } catch (e) {}
    for (const u of candidates) {
      const w = await bootWorker(u);
      if (w) { worker = w; break; }
    }
    if (!worker) return null;
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", () => { /* fail-soft: pending speaks resolve via their own timeouts */ });
    return worker;
  }

  const progressCbs = new Set();
  function onMessage(e) {
    const m = e.data || {};
    if (m.type === "progress") { for (const cb of progressCbs) { try { cb(m); } catch (err) {} } }
    if (m.type === "ready") { ready = true; engineInfo = m; }
    if (m.type === "chunk" && session && m.seq === session.seq) session.onChunk(m);
    if (m.type === "done" && session && m.seq === session.seq) session.onDone(m);
    if (m.type === "error") { if (session && (!m.seq || m.seq === session.seq)) session.onError(m.error); }
  }

  function warm(onProgress) {
    if (ready) return Promise.resolve(true);
    if (warming) { if (onProgress) progressCbs.add(onProgress); return warming; }
    if (onProgress) progressCbs.add(onProgress);
    warming = ensureWorker().then((w) => {
      if (!w) { warming = null; return false; }   // no memoized absence — a later warm() retries
      return new Promise((res) => {
      const done = (ok) => { progressCbs.clear(); if (!ok) warming = null; res(ok); };   // failure never memoizes
      const onReady = (e) => {
        const m = e.data || {};
        if (m.type === "ready") { w.removeEventListener("message", onReady); done(true); }
        if (m.type === "error") { w.removeEventListener("message", onReady); done(false); }
      };
      w.addEventListener("message", onReady);
      try {
        w.postMessage({ type: "load", data: { base, ortBase, ep: opts.ep || "auto", threads: opts.threads || 0 } });
      } catch (e) { done(false); }
      setTimeout(() => { w.removeEventListener("message", onReady); done(ready); }, opts.warmTimeoutMs || 300000);
      });
    });
    return warming;
  }

  // speak: stream chunks from the worker onto the AudioContext clock. Resolves true once the last
  // scheduled sample has PLAYED (or false if nothing was produced / stopped before first audio).
  function speak(text, o = {}) {
    text = String(text || "").trim();
    if (!text || !ready) return Promise.resolve(false);
    stop();   // one utterance at a time (latest wins)

    const ctx = o.ctx || new (window.AudioContext || window.webkitAudioContext)();
    const onLevel = typeof o.onLevel === "function" ? o.onLevel : null;
    const mySeq = ++seq;

    return new Promise((resolve) => {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.6;
      analyser.connect(ctx.destination);
      const bins = new Uint8Array(analyser.frequencyBinCount);
      let metering = true;
      const meter = () => {
        if (!metering) return;
        try { analyser.getByteFrequencyData(bins); let s = 0; for (let i = 0; i < bins.length; i++) s += bins[i]; if (onLevel) onLevel(Math.min(1, (s / bins.length) / 90 * 1.6)); } catch (e) {}
        requestAnimationFrame(meter);
      };
      requestAnimationFrame(meter);

      const s = {
        seq: mySeq,
        sources: [],
        cursor: 0,
        gotAudio: false,
        lastEnd: 0,
        settled: false,
        settle(ok) {
          if (s.settled) return; s.settled = true;
          metering = false;
          try { analyser.disconnect(); } catch (e) {}
          if (onLevel) { try { onLevel(0); } catch (e) {} }
          if (session === s) session = null;
          resolve(ok);
        },
        onChunk(m) {
          try {
            if (typeof o.onChunk === "function") { try { o.onChunk(m); } catch (e) {} }
            const buf = ctx.createBuffer(1, m.audio.length, m.sampleRate || 24000);
            buf.getChannelData(0).set(m.audio);
            const src = ctx.createBufferSource();
            src.buffer = buf; src.connect(analyser);
            const now = ctx.currentTime;
            if (s.cursor < now + 0.06) s.cursor = now + 0.06;   // small lead so the first chunk never clips
            src.start(s.cursor);
            s.cursor += buf.duration;
            s.sources.push(src);
            s.gotAudio = true;
          } catch (e) {}
        },
        onDone() {
          // resolve when the audio clock passes the last scheduled sample
          const waitMs = Math.max(0, (s.cursor - ctx.currentTime) * 1000) + 200;
          setTimeout(() => s.settle(s.gotAudio), waitMs);
        },
        onError() { if (!s.gotAudio) s.settle(false); else s.onDone(); },
        halt() {
          for (const src of s.sources) { try { src.stop(); } catch (e) {} }
          s.sources.length = 0;
          s.settle(s.gotAudio);
        },
      };
      session = s;

      const kick = () => { try { worker.postMessage({ type: "generate", data: { text, seq: mySeq } }); } catch (e) { s.settle(false); } };
      if (ctx.state === "suspended") ctx.resume().then(kick, kick); else kick();
      setTimeout(() => { if (!s.gotAudio) { try { worker.postMessage({ type: "stop" }); } catch (e) {} s.settle(false); } }, o.firstAudioTimeoutMs || 20000);
    });
  }

  function stop() {
    try { if (worker) worker.postMessage({ type: "stop" }); } catch (e) {}
    if (session) session.halt();
  }

  return {
    warm,
    speak,
    stop,
    isReady: () => ready,
    engine: () => engineInfo,
  };
}

export default createPocketVoice;
