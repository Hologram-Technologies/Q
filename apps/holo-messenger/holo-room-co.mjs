// holo-room-co.mjs — TOGETHER IN THE PORTAL (ONE ROOM R4). When two members of a sealed room open the
// SAME experience pane, this welds them together: live named cursors and last-actor-wins <video> playback
// sync — with ZERO cooperation from the app inside (the pane is a same-origin frame, so we tap its
// document from outside). Transport = the room's sealed `room-co` frames (ephemeral, membership-gated,
// never persisted — holo-direct.mjs); protocol = the proven copresence core (vendored, transport-injected).
// Revocation is the room's own: a kicked member's keys die, their frames stop, the reaper clears them.
//
//   joinCo({ room, url, self:{id,name}, frameEl, stage, bar }) → { stop, onCount }
//
// Honest scope: cross-origin frames get no cursors/sync (the overlay is simply absent); audio sync targets
// felt-sync (<1s), not broadcast lip-sync; sessions are fan-out — fine for rooms ≤ ~16.
import { makeCopresence, colourFor } from "./holo-copresence.mjs";

const sessions = new Map();   // room + "|" + url → session (module-owned: the mount's onRoomEvent has no off())
let _wired = false;
function _wire() {
  if (_wired || typeof window === "undefined") return;
  const H = window.HoloDirect; if (!H || !H.onRoomEvent) return;
  _wired = true;
  H.onRoomEvent((e) => {
    if (!e || e.kind !== "co" || !e.url) return;
    const s = sessions.get(e.room + "|" + e.url);
    if (s) s._rx(e.member, e.data);
  });
}

const CURSOR_MS = 80;      // ≤ 12.5 cursor frames/s
const VIDEO_REBEAT = 5000; // playing-state re-broadcast (late joiners + drift)
const DRIFT_S = 0.6;       // re-seek beyond this; below it we let it ride (felt-sync)

export function joinCo({ room, url, self, frameEl, stage, bar } = {}) {
  if (!room || !url || !self || !self.id || typeof window === "undefined") return null;
  const H = window.HoloDirect; if (!H || !H.roomCo) return null;
  const key = room + "|" + url;
  const prev = sessions.get(key); if (prev) prev.stop();
  _wire();

  // ── transport over the sealed room frames. sendTo ≡ broadcast (hello replies are idempotent `touch`es;
  //    the engine has no per-member door on this surface, and correctness only needs delivery).
  const handlers = new Set();
  const fan = (payload) => { try { H.roomCo(room, url, payload); } catch {} };
  const transport = {
    broadcast: (m) => fan({ m }),
    sendTo: (_id, m) => fan({ m }),
    onMessage: (cb) => { handlers.add(cb); return () => handlers.delete(cb); },
    close: () => {},
  };
  const co = makeCopresence({ self: { id: self.id, name: self.name || "Someone", colour: colourFor(self.id) }, transport });

  // ── the cursor overlay (pointer-events:none, floats over the stage — panes below stay fully interactive)
  const overlay = document.createElement("div");
  overlay.className = "holo-co-overlay";
  overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden";
  try { if (stage && getComputedStyle(stage).position === "static") stage.style.position = "relative"; } catch {}
  if (stage) stage.appendChild(overlay);
  const cursorEls = new Map();   // peer id → el
  const renderCursors = (roster) => {
    const seen = new Set();
    for (const p of roster) {
      if (p.me || p.x == null || p.y == null) continue;
      seen.add(p.id);
      let el = cursorEls.get(p.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "holo-co-cursor";
        el.style.cssText = "position:absolute;transform:translate(-4px,-4px);transition:left .12s linear,top .12s linear;display:flex;align-items:center;gap:5px;pointer-events:none";
        el.innerHTML = `<span style="width:10px;height:10px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);box-shadow:0 1px 6px rgba(0,0,0,.45)"></span><span class="holo-co-name" style="font:600 11px ui-sans-serif,system-ui;color:#fff;background:rgba(11,20,26,.85);border-radius:9px;padding:2px 8px;white-space:nowrap"></span>`;
        overlay.appendChild(el); cursorEls.set(p.id, el);
      }
      el.firstChild.style.background = p.colour || "#00d09c";
      el.lastChild.textContent = p.name || "Someone";
      el.style.left = (Math.max(0, Math.min(1, p.x)) * overlay.clientWidth) + "px";
      el.style.top = (Math.max(0, Math.min(1, p.y)) * overlay.clientHeight) + "px";
    }
    for (const [id, el] of cursorEls) if (!seen.has(id)) { el.remove(); cursorEls.delete(id); }
  };

  // ── the truth badge ("● together · N") in the space bar — appears only when someone is actually here
  let badge = null;
  const renderBadge = (n) => {
    if (n > 1 && !badge && bar) { badge = document.createElement("span"); badge.className = "holo-co-count"; badge.style.cssText = "font:600 11px ui-sans-serif,system-ui;color:#00d09c;border:1px solid rgba(0,168,132,.4);border-radius:999px;padding:2px 10px;flex:0 0 auto;margin-left:4px"; bar.insertBefore(badge, bar.lastElementChild); }
    if (badge) { badge.textContent = "● together · " + n; badge.style.display = n > 1 ? "" : "none"; }
    for (const cb of countCbs) { try { cb(n); } catch {} }
  };
  const countCbs = new Set();

  // ── tap the same-origin frame: local pointer → normalized cursor; find <video> → last-actor-wins sync.
  //    Poll a few seconds (SPAs mount late, frames reload); every access is try-guarded (cross-origin = no-op).
  let doc = null, video = null, lastCursor = 0, applying = false, rebeat = null;
  const onMove = (e) => {
    const t = Date.now(); if (t - lastCursor < CURSOR_MS || document.hidden) return; lastCursor = t;
    try {
      const de = doc.documentElement;
      co.moveCursor(e.clientX / Math.max(1, de.clientWidth), e.clientY / Math.max(1, de.clientHeight));
    } catch {}
  };
  const sendVideoState = () => { if (!video || applying) return; try { fan({ v: { paused: video.paused, t: video.currentTime, ts: Date.now() } }); } catch {} };
  const onVideoEvent = () => { if (!applying) sendVideoState(); };
  const applyVideoState = (s) => {
    if (!video || !s) return;
    applying = true;
    try {
      const target = s.paused ? s.t : s.t + Math.max(0, (Date.now() - (s.ts || Date.now())) / 1000);
      if (Math.abs(video.currentTime - target) > DRIFT_S) video.currentTime = target;
      if (s.paused && !video.paused) video.pause();
      else if (!s.paused && video.paused) video.play().catch(() => {});
    } catch {}
    setTimeout(() => { applying = false; }, 120);   // the applied seek/play fires events — they must not re-broadcast
  };
  const attach = setInterval(() => {
    try {
      const d = frameEl && frameEl.contentDocument;
      if (d && d !== doc) { if (doc) try { doc.removeEventListener("pointermove", onMove); } catch {} ; doc = d; doc.addEventListener("pointermove", onMove); video = null; }
      const v = doc && doc.querySelector("video");
      if (v && v !== video) {
        video = v;
        for (const ev of ["play", "pause", "seeked"]) video.addEventListener(ev, onVideoEvent);
      }
    } catch {}   // cross-origin / not loaded yet → honestly no cursors, no sync
  }, 1500);
  rebeat = setInterval(() => { if (video && !video.paused) sendVideoState(); }, VIDEO_REBEAT);

  // ── receive: {m} → copresence protocol · {v} → video state. A NEW peer (roster grew) gets a state snapshot.
  let peersSeen = 1;
  const session = {
    _rx: (member, data) => {
      if (!data) return;
      if (data.m) { for (const cb of handlers) { try { cb(member, data.m); } catch {} } }
      if (data.v) applyVideoState(data.v);
    },
    onCount: (cb) => { countCbs.add(cb); return () => countCbs.delete(cb); },
    stop: () => {
      try { co.stop(); } catch {}                                   // broadcasts bye → peers drop us at once
      clearInterval(attach); clearInterval(rebeat);
      try { if (doc) doc.removeEventListener("pointermove", onMove); } catch {}
      try { if (video) for (const ev of ["play", "pause", "seeked"]) video.removeEventListener(ev, onVideoEvent); } catch {}
      try { overlay.remove(); } catch {}
      try { if (badge) badge.remove(); } catch {}
      sessions.delete(key);
    },
  };
  sessions.set(key, session);
  co.onChange((roster) => {
    renderCursors(roster);
    renderBadge(roster.length);
    if (roster.length > peersSeen) sendVideoState();               // late joiner lands on the right frame
    peersSeen = roster.length;
  });
  co.start();
  return session;
}

export default { joinCo };
