// holo-aim.mjs — the AIM EXPERIENCE layer (A0/A2/A4/A5): buddy list with groups, sign-on moment, away
// messages, door sounds, buddy info. 100% presentation over the existing sealed door — the engine work
// (presence beacons, away auto-reply) lives in holo-direct.mjs; this module only renders and rings.
// Additive, guarded, DOM-only (the holo-direct-mount idiom: foreign DOM inside the React container heals
// on a 2 s re-attach). Active ONLY under <html data-skin="aim"> (messenger-skin.mjs loads us there);
// every other skin is pixel-untouched. No AOL property anywhere: the sounds are synthesized homages,
// the marks are ours.

const DOC = typeof document !== "undefined" ? document : null;
const $ = (s, r) => (r || DOC).querySelector(s);
const _htm = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const _on = () => DOC && DOC.documentElement.getAttribute("data-skin") === "aim";
const HD = () => (typeof window !== "undefined" ? window.HoloDirect : null);

// ── A2: the sounds — synthesized in WebAudio (zero shipped assets, license-clean by construction; the
// original wavs are AOL's). Evocative, not sampled: a door creaks OPEN when a buddy arrives, SLAMS when
// one leaves, a bright ding for an instant message. Kill switch: the messenger's own holo.msgr.sounds.
const Sound = (() => {
  let ctx = null;
  const C = () => { try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; } catch { return null; } };
  const off = () => { try { return localStorage.getItem("holo.msgr.sounds") === "off"; } catch { return false; } };
  let lastAt = 0;
  const gate = () => { if (off() || !_on()) return false; const n = Date.now(); if (n - lastAt < 250) return false; lastAt = n; return true; };   // a sign-on burst rings once, not a drumroll
  const noise = (c, t0, dur, f0, f1, vol) => {           // filtered noise sweep — the door's voice
    const n = c.createBufferSource(), buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    n.buffer = buf;
    const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 2.2;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    n.connect(f); f.connect(g); g.connect(c.destination); n.start(t0); n.stop(t0 + dur);
  };
  const tone = (c, t0, dur, f0, f1, vol, type = "sine") => {
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur);
  };
  return {
    buddyIn() { if (!gate()) return; const c = C(); if (!c) return; const t = c.currentTime;   // creak up + a warm hello
      noise(c, t, 0.28, 300, 900, 0.10); tone(c, t + 0.10, 0.16, 523, 659, 0.07, "triangle"); },
    buddyOut() { if (!gate()) return; const c = C(); if (!c) return; const t = c.currentTime;  // thump + short slam burst
      tone(c, t, 0.18, 140, 55, 0.16); noise(c, t + 0.02, 0.12, 1200, 240, 0.09); },
    ding() { if (!gate()) return; const c = C(); if (!c) return; const t = c.currentTime;      // one bright IM blip
      tone(c, t, 0.09, 1318, null, 0.07, "triangle"); tone(c, t + 0.09, 0.14, 1760, null, 0.06, "triangle"); },
  };
})();

// ── state glue ──────────────────────────────────────────────────────────────────────────────────────────
const GROUPS = ["Buddies", "Family", "Co-Workers"];
let _groups = null;                                     // cid → group name (vault meta aim:groups)
async function groups() {
  if (_groups) return _groups;
  try { _groups = JSON.parse((await HD().getMeta("aim:groups")) || "{}") || {}; } catch { _groups = {}; }
  return _groups;
}
async function setGroup(cid, g) { const m = await groups(); if (g && GROUPS.includes(g)) m[cid] = g; else delete m[cid]; try { await HD().setMeta("aim:groups", JSON.stringify(m)); } catch {} render(); }
const _collKey = "holo.aim.collapsed";                  // presentation glue → localStorage (the alias rule)
const _coll = () => { try { return JSON.parse(localStorage.getItem(_collKey) || "{}"); } catch { return {}; } };
const _profile = () => { try { return (localStorage.getItem("holo.aim.profile") || "").trim() || null; } catch { return null; } };
const _label = (cid) => { try { const a = (localStorage.getItem("holo.direct.alias." + cid) || "").trim(); if (a) return a; } catch {} return /^direct:/.test(cid) ? "Buddy · " + cid.replace(/^direct:/, "").slice(0, 4).toUpperCase() : String(cid); };
// setPresence always re-carries my profile link — the beacon is how Buddy Info finds my YourSpace (A4)
const announce = (state, msg) => { const hd = HD(); if (hd) hd.setPresence({ state, msg: msg || null, profile: _profile() }).catch(() => {}); };

// ── A0: the sign-on moment — ceremony only, skippable, never blocks; once per device ────────────────────
function signOn() {
  if (!_on() || !DOC.body) return;
  try { if (localStorage.getItem("holo.aim.signedon")) return; } catch {}
  if ($(".holo-aim-signon")) return;
  const ov = DOC.createElement("div"); ov.className = "holo-aim-signon";
  ov.innerHTML = `<div class="holo-aim-signon-card">
    <div class="holo-aim-signon-mark">⚡ Instant Messenger</div>
    <label>Screen Name</label>
    <input class="holo-aim-sn" maxlength="48" value="${_htm((() => { try { return localStorage.getItem("holo.direct.name") || ""; } catch { return ""; } })())}" placeholder="ScreenName">
    <button class="holo-aim-go">Sign On</button>
    <button class="holo-aim-skip">skip</button>
  </div>`;
  const done = () => {
    const nm = ($(".holo-aim-sn", ov) || {}).value || "";
    try { if (nm.trim()) localStorage.setItem("holo.direct.name", nm.trim()); localStorage.setItem("holo.aim.signedon", "1"); } catch {}
    ov.remove(); announce("online"); Sound.buddyIn(); render();
  };
  $(".holo-aim-go", ov).onclick = done;
  $(".holo-aim-sn", ov).onkeydown = (e) => { if (e.key === "Enter") done(); };
  $(".holo-aim-skip", ov).onclick = () => { try { localStorage.setItem("holo.aim.signedon", "1"); } catch {} ov.remove(); };
  DOC.body.append(ov);
}

// ── A3 UI: the away ritual ──────────────────────────────────────────────────────────────────────────────
const AWAY_PRESETS = ["I am away from my computer right now.", "brb", "gone to get food", "out for the night — leave a message"];
function awaySheet() {
  const ov = DOC.createElement("div"); ov.className = "holo-aim-awaysheet";
  ov.innerHTML = `<div class="holo-aim-away-card"><div class="holo-aim-away-title">Set Away Message</div>
    <textarea class="holo-aim-away-msg" maxlength="240" placeholder="${_htm(AWAY_PRESETS[0])}"></textarea>
    <div class="holo-aim-away-presets">${AWAY_PRESETS.map((p) => `<button data-p="${_htm(p)}">${_htm(p)}</button>`).join("")}</div>
    <div class="holo-aim-away-row"><button class="holo-aim-away-go">I'm Away</button><button class="holo-aim-away-x">Cancel</button></div></div>`;
  ov.querySelectorAll(".holo-aim-away-presets button").forEach((b) => { b.onclick = () => { $(".holo-aim-away-msg", ov).value = b.dataset.p; }; });
  $(".holo-aim-away-go", ov).onclick = () => { announce("away", ($(".holo-aim-away-msg", ov).value || "").trim() || AWAY_PRESETS[0]); ov.remove(); render(); };
  $(".holo-aim-away-x", ov).onclick = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  DOC.body.append(ov);
}

// ── A4: Buddy Info — screen name, state, away message, κ-verify badge, "View Profile" (YourSpace link
// rides the presence beacon — never a lookup service). Group assignment lives here too.
async function buddyInfo(cid, pub) {
  const hd = HD(); if (!hd) return;
  const p = hd.presenceOf(cid);
  const vs = hd.verifyStatus(cid);
  const g = (await groups())[cid] || "Buddies";
  const ov = DOC.createElement("div"); ov.className = "holo-aim-awaysheet";
  ov.innerHTML = `<div class="holo-aim-away-card holo-aim-info-card">
    <div class="holo-aim-away-title">Buddy Info</div>
    <div class="holo-aim-info-name">${_htm(_label(cid))} <span class="holo-aim-dot ${p.state}"></span> <span class="holo-aim-info-state">${p.state}</span></div>
    ${p.msg ? `<div class="holo-aim-info-away">“${_htm(p.msg)}”</div>` : ""}
    <div class="holo-aim-info-verify">${vs.status === "same" && vs.verified ? "✓ κ-verified buddy" : vs.status === "changed" ? "⚠ key changed — verify before trusting" : "sealed end-to-end (unverified)"}</div>
    <label class="holo-aim-info-grouplab">Group</label>
    <select class="holo-aim-info-group">${GROUPS.map((x) => `<option ${x === g ? "selected" : ""}>${x}</option>`).join("")}</select>
    <div class="holo-aim-away-row">
      ${p.profile ? `<button class="holo-aim-info-profile">View Profile</button>` : ""}
      <button class="holo-aim-away-x">Close</button></div></div>`;
  $(".holo-aim-info-group", ov).onchange = (e) => setGroup(cid, e.target.value);
  const pb = $(".holo-aim-info-profile", ov);
  if (pb) pb.onclick = () => { try { window.open(p.profile, "_blank", "noopener"); } catch {} };
  $(".holo-aim-away-x", ov).onclick = () => ov.remove();
  ov.onclick = (e) => { if (e.target === ov) ov.remove(); };
  DOC.body.append(ov);
}

// ── A0: the Buddy List — groups (Buddies / Family / Co-Workers / Offline), online→idle→away sort,
// away note icon, idle grey. Rendered into the same list wrap the Direct section uses; under the aim
// skin CSS hides the Direct section so the Buddy List is the ONE surface. Room-only transport contacts
// are filtered exactly like the mount does (or ghosts appear in Offline — the paid-for gotcha).
let _busy = false;
async function render() {
  if (_busy || !_on() || !DOC) return;
  const hd = HD(); if (!hd) return;
  _busy = true;
  try {
    const wrap = $(".holo-convlist-wrap"); if (!wrap) return;
    let sec = wrap.querySelector(".holo-aim-buddylist");
    let convs = [];
    try { convs = await hd.conversations(); } catch {}
    try {
      const roomSigns = new Set();
      for (const r of (await hd.rooms().catch(() => [])) || []) for (const m of (r.members || [])) roomSigns.add(m.sign);
      convs = convs.filter((c) => c.last || !(c.pub && roomSigns.has(c.pub.sign)));
    } catch {}
    if (!sec) { sec = DOC.createElement("div"); sec.className = "holo-aim-buddylist"; wrap.prepend(sec); }
    const me = hd.myPresence();
    const gmap = await groups();
    const coll = _coll();
    const buckets = new Map(GROUPS.map((g) => [g, []]).concat([["Offline", []]]));
    for (const c of convs) {
      const cid = c.name || c.contactId;
      const p = hd.presenceOf(cid);
      (p.state === "offline" ? buckets.get("Offline") : buckets.get(gmap[cid] && buckets.has(gmap[cid]) ? gmap[cid] : "Buddies")).push({ cid, pub: c.pub, p });
    }
    const rank = { online: 0, idle: 1, away: 2 };
    const myName = (() => { try { return localStorage.getItem("holo.direct.name") || "me"; } catch { return "me"; } })();
    let html = `<div class="holo-aim-head"><span class="holo-aim-mark">⚡</span><span class="holo-aim-me">${_htm(myName)}</span>
      <span class="holo-aim-mystate ${me.state}">${me.state}</span>
      ${me.state === "away" ? `<button class="holo-aim-return">Return</button>` : `<button class="holo-aim-away-btn">Away…</button>`}</div>`;
    if (me.state === "away") html += `<div class="holo-aim-awaybar">“${_htm(me.msg || "")}”</div>`;
    for (const [g, list] of buckets) {
      if (g !== "Buddies" && !list.length && g !== "Offline") continue;   // empty custom groups fold away
      list.sort((a, b) => (rank[a.p.state] ?? 3) - (rank[b.p.state] ?? 3) || _label(a.cid).localeCompare(_label(b.cid)));
      const on = list.filter((x) => x.p.state !== "offline").length;
      const c = !!coll[g];
      html += `<div class="holo-aim-group ${c ? "closed" : ""}" data-g="${_htm(g)}"><span class="holo-aim-tri">${c ? "▸" : "▾"}</span> ${g} (${g === "Offline" ? list.length : on + "/" + list.length})</div>`;
      if (!c) for (const x of list) html += `<button class="holo-aim-buddy ${x.p.state}" data-cid="${_htm(x.cid)}">
        <span class="holo-aim-dot ${x.p.state}"></span><span class="holo-aim-bname">${_htm(_label(x.cid))}</span>
        ${x.p.state === "away" ? `<span class="holo-aim-note" title="${_htm(x.p.msg || "away")}">✎</span>` : ""}
        <span class="holo-aim-info" data-cid="${_htm(x.cid)}" title="Buddy Info">ℹ</span></button>`;
    }
    if (sec._aimHtml === html) return;                  // unchanged → DON'T rebuild (clicks/hover survive the 2s heal)
    sec._aimHtml = html;
    sec.innerHTML = html;
    const b1 = $(".holo-aim-away-btn", sec); if (b1) b1.onclick = awaySheet;
    const b2 = $(".holo-aim-return", sec); if (b2) b2.onclick = () => { announce("online"); render(); };
    sec.querySelectorAll(".holo-aim-group").forEach((el) => { el.onclick = () => { const c = _coll(); c[el.dataset.g] = !c[el.dataset.g]; try { localStorage.setItem(_collKey, JSON.stringify(c)); } catch {} render(); }; });
    const byCid = new Map(convs.map((c) => [c.name || c.contactId, c]));
    sec.querySelectorAll(".holo-aim-info").forEach((el) => { el.onclick = (e) => { e.stopPropagation(); const c = byCid.get(el.dataset.cid); buddyInfo(el.dataset.cid, c && c.pub); }; });
    sec.querySelectorAll(".holo-aim-buddy").forEach((el) => { el.onclick = () => { const c = byCid.get(el.dataset.cid); if (c && c.pub && c.pub.box) hd.open(c.pub, { name: el.dataset.cid }); }; });
  } finally { _busy = false; }
}

// ── A5: room doors — "X has entered the room" as a toast + the door sounds; zero engine change ──────────
function toast(text) {
  if (!_on() || !DOC.body) return;
  const t = DOC.createElement("div"); t.className = "holo-aim-toast"; t.textContent = text;
  DOC.body.append(t); setTimeout(() => t.remove(), 3500);
}

function start() {
  if (!DOC || typeof window === "undefined") return;
  if (window.__holoAim) return; window.__holoAim = true;
  (function wire() {
    const hd = HD(); if (!hd) { setTimeout(wire, 800); return; }   // the mount defines window.HoloDirect; wait for it
    // presence → repaint + the doors (engine emits TRANSITIONS ONLY, so a keepalive can never re-ring)
    hd.onPresence((p) => {
      if (p.state === "online") Sound.buddyIn();
      if (p.state === "offline") Sound.buddyOut();
      render();
    });
    hd.onMessage((m) => { if (m && !m.auto) Sound.ding(); });
    hd.onRoomEvent((e) => {
      if (e.kind === "add") { Sound.buddyIn(); toast("A buddy has entered the room."); }
      if (e.kind === "remove") { Sound.buddyOut(); toast("A buddy has left the room."); }
    });
    signOn();
    render();
    setInterval(render, 2000);                          // the React-reconciliation heal (the mount idiom)
  })();
}
start();
