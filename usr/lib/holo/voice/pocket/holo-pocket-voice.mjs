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
  const base = opts.base || MIRROR;
  const ortBase = opts.ortBase || ORT_BASE;
  let worker = null, ready = false, warming = null, engineInfo = null;
  let seq = 0;
  let session = null;   // active playback session

  function ensureWorker() {
    if (worker) return worker;
    const candidates = [];
    try { candidates.push(new URL("./pocket-worker.js", import.meta.url).href); } catch (e) {}
    candidates.push("/usr/lib/holo/voice/pocket/pocket-worker.js");
    for (const u of candidates) {
      try { worker = new Worker(u, { type: "module" }); break; } catch (e) {}
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
    const w = ensureWorker();
    if (!w) return Promise.resolve(false);
    warming = new Promise((res) => {
      const done = (ok) => { progressCbs.clear(); res(ok); };
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
