// holo-meet-ui.mjs - the IMMERSIVE call surface. Full-bleed video (the focused participant fills the whole
// screen), your self-view as a draggable picture-in-picture, controls + chrome that FADE and return on tap,
// and a front/back camera flip - the real mobile-video-call feel (FaceTime / WhatsApp). Own DOM + inline
// styles (zero React / main.jsx conflict). The app owns the mesh (holo-call-mesh.joinMesh) and feeds streams.
//
//   1 remote  → that person fills the screen, you are the PiP (the 1:1 call everyone knows).
//   N remotes → the active speaker fills the screen, the rest are a thin filmstrip (tap one to pin it),
//               you are still the PiP.
//   audio     → EVERY remote's audio plays via its own hidden <audio> (the on-screen video is muted), so
//               sound never depends on who's on the stage.

export function openMeetUI({ name = "Call", video = true, inviteLink = "", onLeave = () => {}, onToggleMute = () => {}, onToggleCamera = () => {}, onFlipCamera = null } = {}) {
  if (typeof document === "undefined") return { addParticipant() {}, removeParticipant() {}, setActiveSpeaker() {}, setLabel() {}, attachLocal() {}, setSelfMirror() {}, setPhase() {}, close() {}, tileCount: () => 0 };
  const el = (t, css, html) => { const n = document.createElement(t); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };
  const coarse = (typeof matchMedia !== "undefined" && matchMedia("(pointer:coarse)").matches) || (typeof window !== "undefined" && "ontouchstart" in window);
  const ini = (s) => (String(s || "").trim()[0] || "·").toUpperCase();

  const overlay = el("div", "position:fixed;inset:0;z-index:2147483600;background:#000;overflow:hidden;font:14px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;-webkit-tap-highlight-color:transparent;touch-action:none");

  // ── STAGE: the focused participant, edge to edge ──
  const stage = el("div", "position:absolute;inset:0;background:#05070a"); stage.dataset.holo = "stage";
  const stageVideo = el("video", "width:100%;height:100%;object-fit:cover;background:#05070a;display:none"); stageVideo.autoplay = true; stageVideo.muted = true; stageVideo.setAttribute("playsinline", "");
  const stageAvatar = el("div", "position:absolute;inset:0;display:flex;align-items:center;justify-content:center");
  const stageOrb = el("div", "width:112px;height:112px;border-radius:50%;display:grid;place-items:center;font-size:46px;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3)", "·");
  stageAvatar.append(stageOrb);
  const stageName = el("div", "position:absolute;left:16px;bottom:calc(env(safe-area-inset-bottom,0px) + 104px);padding:5px 12px;border-radius:10px;background:rgba(0,0,0,.42);font-size:14px;font-weight:600;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .2s");
  stage.append(stageVideo, stageAvatar, stageName);

  // ── SELF PiP (draggable) ──
  const pipW = coarse ? 104 : 168, pipH = coarse ? 150 : 108;
  const pip = el("div", `position:absolute;right:14px;top:calc(env(safe-area-inset-top,0px) + 62px);width:${pipW}px;height:${pipH}px;border-radius:16px;overflow:hidden;border:2px solid rgba(255,255,255,.45);background:#0a0f14;box-shadow:0 12px 32px rgba(0,0,0,.55);cursor:grab;z-index:7;touch-action:none;display:none`); pip.dataset.holo = "pip";
  const pipVideo = el("video", "width:100%;height:100%;object-fit:cover;transform:scaleX(-1);background:#0a0f14"); pipVideo.autoplay = true; pipVideo.muted = true; pipVideo.setAttribute("playsinline", "");
  const pipOrb = el("div", "position:absolute;inset:0;display:grid;place-items:center;font-size:24px;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3)", "·");
  pip.append(pipVideo, pipOrb);

  // ── TOP BAR (fades): LIVE · name · count ──
  const topbar = el("div", "position:absolute;left:0;right:0;top:0;padding:calc(env(safe-area-inset-top,0px) + 12px) 16px 22px;display:flex;align-items:center;gap:9px;background:linear-gradient(180deg,rgba(0,0,0,.5),transparent);transition:opacity .25s;z-index:8;pointer-events:none");
  topbar.innerHTML = '<span style="display:flex;align-items:center;gap:6px;color:#00e6a7;font-weight:700;font-size:12px"><span style="width:8px;height:8px;border-radius:50%;background:#00e6a7;box-shadow:0 0 8px #00e6a7"></span>LIVE</span>';
  const titleEl = el("b", "font-size:15px;font-weight:600;max-width:52vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap", name);
  const countEl = el("span", "color:rgba(255,255,255,.6);font-size:13px");
  const statusEl = el("span", "margin-left:auto;color:rgba(255,255,255,.65);font-size:12px");
  topbar.append(titleEl, countEl, statusEl);

  // ── FILMSTRIP (fades): the non-focused remotes ──
  const strip = el("div", "position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 96px);display:flex;gap:8px;padding:0 12px;overflow-x:auto;justify-content:center;transition:opacity .25s;z-index:6");

  // ── CONTROLS (fade) ──
  const controls = el("div", "position:absolute;left:0;right:0;bottom:0;padding:14px 12px calc(env(safe-area-inset-bottom,0px) + 16px);display:flex;gap:12px;justify-content:center;align-items:center;background:linear-gradient(0deg,rgba(0,0,0,.62),transparent);transition:opacity .25s;z-index:8"); controls.dataset.holo = "controls";
  const round = (bg, glyph, title) => { const b = el("button", `border:0;border-radius:999px;width:58px;height:58px;font-size:23px;line-height:1;cursor:pointer;background:${bg};color:#fff;display:grid;place-items:center;transition:transform .08s,background .15s;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)`, glyph); b.title = title; b.onpointerdown = (e) => e.stopPropagation(); b.onmousedown = (e) => e.stopPropagation(); return b; };
  const glass = "rgba(255,255,255,.14)";

  let muted = false, camOff = false;
  const bMute = round(glass, "🎙", "Mute");
  bMute.onclick = () => { muted = !muted; onToggleMute(muted); bMute.textContent = muted ? "🔇" : "🎙"; bMute.style.background = muted ? "#e0533f" : glass; };
  controls.append(bMute);
  if (video) {
    const bCam = round(glass, "📷", "Camera");
    bCam.onclick = () => { camOff = !camOff; onToggleCamera(camOff); bCam.textContent = camOff ? "🚫" : "📷"; bCam.style.background = camOff ? "#e0533f" : glass; pip.style.opacity = camOff ? ".4" : "1"; };
    controls.append(bCam);
    if (onFlipCamera) { const bFlip = round(glass, "🔄", "Flip camera"); bFlip.onclick = () => { try { onFlipCamera(); } catch {} }; controls.append(bFlip); }
  }
  if (inviteLink) {
    const bInv = round(glass, "🔗", "Invite");
    bInv.onclick = async () => {
      let done = false; try { await navigator.clipboard.writeText(inviteLink); done = true; } catch {}
      if (!done) { try { const ta = el("textarea", "position:fixed;opacity:0"); ta.value = inviteLink; document.body.append(ta); ta.select(); done = document.execCommand("copy"); ta.remove(); } catch {} }
      bInv.textContent = done ? "✓" : "🔗"; setTimeout(() => { bInv.textContent = "🔗"; }, 1500);
    };
    controls.append(bInv);
  }
  const bLeave = round("#e0533f", "📞", "Leave"); bLeave.style.transform = "rotate(135deg)"; bLeave.onclick = () => { onLeave(); close(); }; controls.append(bLeave);

  overlay.append(stage, pip, strip, topbar, controls); document.body.append(overlay);

  // ── chrome auto-fade: tap the stage toggles; any move brings it back; hides after a few seconds ──
  let hideT = null, chromeOn = false;
  const chrome = [topbar, controls, strip];
  function showChrome() { chromeOn = true; for (const c of chrome) { c.style.opacity = "1"; } controls.style.pointerEvents = "auto"; strip.style.pointerEvents = "auto"; stageName.style.opacity = stageVideo.style.display === "block" ? "1" : "0"; overlay.style.cursor = "default"; clearTimeout(hideT); hideT = setTimeout(hideChrome, 3800); }
  function hideChrome() { chromeOn = false; for (const c of chrome) { c.style.opacity = "0"; } controls.style.pointerEvents = "none"; strip.style.pointerEvents = "none"; stageName.style.opacity = "0"; overlay.style.cursor = "none"; }
  stage.addEventListener("click", () => { chromeOn ? hideChrome() : showChrome(); });
  overlay.addEventListener("pointermove", () => { if (!dragging) { if (!chromeOn) showChrome(); else { clearTimeout(hideT); hideT = setTimeout(hideChrome, 3800); } } });

  // ── self PiP drag ──
  let dragging = false, dx = 0, dy = 0;
  pip.addEventListener("pointerdown", (e) => { dragging = true; pip.style.cursor = "grabbing"; const r = pip.getBoundingClientRect(); dx = e.clientX - r.left; dy = e.clientY - r.top; pip.style.right = "auto"; pip.setPointerCapture && pip.setPointerCapture(e.pointerId); e.stopPropagation(); });
  pip.addEventListener("pointermove", (e) => { if (!dragging) return; const w = pip.offsetWidth, h = pip.offsetHeight; let left = Math.min(Math.max(6, e.clientX - dx), window.innerWidth - w - 6); let top = Math.min(Math.max(6, e.clientY - dy), window.innerHeight - h - 6); pip.style.left = left + "px"; pip.style.top = top + "px"; e.preventDefault(); });
  const endDrag = () => { dragging = false; pip.style.cursor = "grab"; };
  pip.addEventListener("pointerup", endDrag); pip.addEventListener("pointercancel", endDrag);

  // ── participant model ──
  const remotes = new Map();   // id → { stream, label, audio }
  let selfLabel = "You", focusId = null, pinned = false, alone = true;

  function playAudio(id, stream) { const r = remotes.get(id); if (!r) return; let a = r.audio; if (!a) { a = el("audio"); a.autoplay = true; a.setAttribute("playsinline", ""); overlay.append(a); r.audio = a; } try { a.srcObject = stream; a.play && a.play().catch(() => {}); } catch {} }

  function hasLiveVideo(stream) { try { return !!stream && stream.getVideoTracks().some((t) => t.enabled && t.readyState === "live"); } catch { return false; } }

  function paintStage() {
    const r = focusId && remotes.get(focusId);
    if (r && r.stream) {
      try { if (stageVideo.srcObject !== r.stream) stageVideo.srcObject = r.stream; } catch {}
      stageVideo.style.display = "block";
      stageOrb.textContent = ini(r.label); stageName.textContent = r.label || "Guest";
      const live = hasLiveVideo(r.stream); stageAvatar.style.display = live ? "none" : "flex"; if (chromeOn) stageName.style.opacity = "1";
    } else {
      // nobody remote yet → your own view fills the stage (no PiP), avatar until camera frames arrive
      stageVideo.style.display = "none"; stageAvatar.style.display = "flex"; stageOrb.textContent = ini(selfLabel); stageName.style.opacity = "0";
    }
  }
  stageVideo.addEventListener("loadeddata", () => { if (stageVideo.videoWidth > 0) stageAvatar.style.display = "none"; });

  function rebuildStrip() {
    strip.innerHTML = "";
    const others = [...remotes.keys()].filter((id) => id !== focusId);
    strip.style.display = others.length ? "flex" : "none";
    for (const id of others) {
      const r = remotes.get(id);
      const tile = el("div", "position:relative;flex:0 0 auto;width:84px;height:112px;border-radius:12px;overflow:hidden;background:#0a0f14;border:1px solid rgba(255,255,255,.14);cursor:pointer");
      const v = el("video", "width:100%;height:100%;object-fit:cover;background:#0a0f14"); v.autoplay = true; v.muted = true; v.setAttribute("playsinline", ""); try { v.srcObject = r.stream; } catch {}
      const orb = el("div", "position:absolute;inset:0;display:grid;place-items:center;font-size:22px;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3)", ini(r.label));
      v.addEventListener("loadeddata", () => { if (v.videoWidth > 0) orb.style.display = "none"; });
      const tag = el("div", "position:absolute;left:4px;bottom:4px;right:4px;font-size:11px;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,.8);overflow:hidden;text-overflow:ellipsis;white-space:nowrap", r.label || "Guest");
      tile.append(v, orb, tag);
      tile.onclick = (e) => { e.stopPropagation(); pinned = true; focusId = id; paintStage(); rebuildStrip(); };
      strip.append(tile);
    }
  }

  function relayout() {
    const n = remotes.size;
    alone = n === 0;
    pip.style.display = alone ? "none" : "block";
    countEl.textContent = (n + 1) + (n + 1 === 1 ? " person" : " people");
  }

  function close() { try { for (const [, r] of remotes) { try { r.audio && (r.audio.srcObject = null); } catch {} } } catch {} try { stageVideo.srcObject = null; pipVideo.srcObject = null; } catch {} clearTimeout(hideT); try { overlay.remove(); } catch {} }

  showChrome();

  return {
    overlay,
    attachLocal(stream, label = "You", mirror = true) {
      selfLabel = label; pipOrb.textContent = ini(label); stageOrb.textContent = focusId ? stageOrb.textContent : ini(label);
      pipVideo.style.transform = mirror ? "scaleX(-1)" : "none";
      try { pipVideo.srcObject = stream; } catch {}
      pipVideo.addEventListener("loadeddata", () => { if (pipVideo.videoWidth > 0) pipOrb.style.display = "none"; }, { once: true });
      if (!hasLiveVideo(stream)) pipOrb.style.display = "grid";
      paintStage();
    },
    setSelfMirror(on) { pipVideo.style.transform = on ? "scaleX(-1)" : "none"; },
    addParticipant(id, stream, label = "Guest") {
      const r = remotes.get(id) || {}; r.stream = stream; if (label) r.label = label; remotes.set(id, r);
      playAudio(id, stream);
      if (!focusId || !remotes.has(focusId)) { focusId = id; pinned = false; }
      paintStage(); rebuildStrip(); relayout();
    },
    removeParticipant(id) {
      const r = remotes.get(id); if (r && r.audio) { try { r.audio.srcObject = null; r.audio.remove(); } catch {} }
      remotes.delete(id);
      if (focusId === id) { focusId = remotes.keys().next().value || null; pinned = false; }
      paintStage(); rebuildStrip(); relayout();
    },
    setActiveSpeaker(id) { if (!remotes.has(id) || pinned || id === focusId) return; focusId = id; paintStage(); rebuildStrip(); },
    setLabel(id, label) { const r = remotes.get(id); if (r && label) { r.label = label; if (id === focusId) { stageName.textContent = label; stageOrb.textContent = ini(label); } rebuildStrip(); } },
    setPhase(p) { if (p === "connecting") statusEl.textContent = "Connecting…"; else if (p === "connected") statusEl.textContent = ""; else if (p === "ended") { statusEl.textContent = "Ended"; setTimeout(close, 600); } },
    tileCount: () => remotes.size + 1,
    close,
  };
}
