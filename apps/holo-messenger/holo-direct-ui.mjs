// holo-direct-ui.mjs - the native Holo Direct chat surface: a self-contained sealed-conversation panel (OWN DOM, inline
// styles → zero React conflict). Shows the 🔒 end-to-end state, a tap-to-verify SAFETY NUMBER (emoji strip + 60 digits),
// a KEY-CHANGE warning banner (anti-MITM), message bubbles (with a per-message unverified flag), and a composer. The app
// wires it to the holo-direct engine (onSend → engine.send; engine "message"/"keychange" → addMessage/showKeyChange).
//
// KEYS: handing a live power is as native here as sending a photo — a 🗝 composer button mints a Key (holo-key.mjs,
// the SAME framework-free core the React bridged-chat card uses) and sends it as a message; a received/sent key link
// renders as a live control CARD in the thread (holder taps drive the issuer's device over this very sealed channel;
// the sender can Take it back). No card render = no card here; the whole surface is OWN DOM, so the card is too.

import { keyLinkInText, mintKey, invoke as keyInvoke, revokeKey, keyring as keyRing, buildKeyLink, keyMessageText, onKeyRevoked, keyRevoked, VERBS as KEY_VERBS } from "./holo-key.mjs?v=k1";

export function openDirectChat({ name = "Contact", onSend = () => {}, onVerify = () => {}, onClose = () => {}, onTyping = () => {}, onAttach = null, onRename = null, myPub = null } = {}) {
  if (typeof document === "undefined") return { addMessage() {}, addMedia() {}, setMedia() {}, notice() {}, setName() {}, setSafety() {}, showKeyChange() {}, setVerified() {}, setTick() {}, setTyping() {}, close() {} };
  const el = (t, css, html) => { const n = document.createElement(t); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; };
  const _esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const overlay = el("div", "position:fixed;inset:0;z-index:2147483500;background:rgba(4,7,11,.72);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif");
  // WhatsApp dark-theme palette (styling our own components — familiar look, no copied assets):
  //   chat bg #0b141a · header/composer bars #202c33 · incoming bubble #202c33 · outgoing #005c4b ·
  //   ink #e9edef · dim rgba(233,237,239,.6) · accent #00a884 · read-tick blue #53bdeb · input #2a3942
  const card = el("div", "width:min(420px,96vw);height:min(720px,92vh);background:#0b141a;border:0;border-radius:14px;box-shadow:0 32px 90px rgba(0,0,0,.6);display:flex;flex-direction:column;color:#e9edef;overflow:hidden");

  let curName = name;
  const initial = (String(name).trim()[0] || "·").toUpperCase();
  const head = el("div", "display:flex;align-items:center;gap:11px;padding:10px 14px;background:#202c33;flex:0 0 auto");
  const avatar = el("div", "width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;color:#04110d;background:linear-gradient(135deg,#00d09c,#27e3b3);flex:0 0 auto", initial);
  const idwrap = el("div", "flex:1;min-width:0");
  // the name is TAP-TO-RENAME (WhatsApp: open a chat, tap the name to set who it is). Rename is a LOCAL
  // label only — it never touches the sealed key or forks the thread; onRename persists it.
  const nameEl = el("div", "font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" + (onRename ? ";cursor:text" : ""), _esc(name));
  if (onRename) { nameEl.title = "Tap to rename"; nameEl.className = "hd-name"; }
  const sub = el("div", "font-size:12px;color:rgba(233,237,239,.6)", "🔒 end-to-end encrypted");
  idwrap.append(nameEl, sub);
  const doRename = () => {
    if (!onRename) return;
    const inp = el("input", "font:700 14px system-ui;background:#0a1119;border:1px solid #00d09c;border-radius:8px;color:#e9f1f5;padding:3px 7px;width:100%;outline:none");
    inp.className = "hd-name-input"; inp.value = curName; idwrap.replaceChild(inp, nameEl); inp.focus(); inp.select();
    let done = false;   // Enter AND blur both fire (removing a focused input triggers blur) — commit ONCE, never throw
    const commit = (save) => {
      if (done) return; done = true;
      const v = inp.value.trim();
      if (inp.parentElement === idwrap) idwrap.replaceChild(nameEl, inp);
      if (save && v && v !== curName) { curName = v; nameEl.textContent = v; avatar.textContent = (v[0] || "·").toUpperCase(); try { onRename(v); } catch {} }
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") commit(true); else if (e.key === "Escape") commit(false); };
    inp.onblur = () => commit(true);
  };
  nameEl.onclick = doRename;
  head.append(avatar, idwrap);
  const shield = el("button", "background:transparent;border:0;color:#aebac1;padding:4px 6px;font-size:17px;cursor:pointer", "🛡");
  shield.title = "Verify security code";
  const closeBtn = el("button", "background:transparent;border:0;color:#aebac1;font-size:20px;cursor:pointer;padding:0 6px", "✕");
  closeBtn.className = "hd-close";
  head.append(shield, closeBtn); closeBtn.onclick = () => { onClose(); close(); };

  const banner = el("div", "display:none;background:rgba(233,111,111,.14);border-bottom:1px solid rgba(233,111,111,.4);color:#ffd7d7;padding:9px 14px;font-size:12.5px");
  const typing = el("div", "display:none;padding:2px 16px 0;font-size:12px;color:#00d09c;font-style:italic", `typing…`);
  const list = el("div", "flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px");
  const notice = el("div", "display:none;padding:4px 16px 0;font-size:12px;color:#ffd7a8");
  const composer = el("div", "display:flex;gap:8px;padding:8px 10px;background:#202c33;align-items:center;flex:0 0 auto");
  const input = el("input", "flex:1;background:#2a3942;border:0;border-radius:20px;padding:10px 15px;color:#e9edef;outline:none;font-size:14px"); input.placeholder = "Message";
  const sendBtn = el("button", "background:#00a884;color:#0b141a;border:0;border-radius:50%;width:40px;height:40px;font-size:17px;cursor:pointer;flex:0 0 auto;display:grid;place-items:center", "➤");
  sendBtn.className = "hd-send"; sendBtn.title = "Send";
  // 📎 (N7/MD4): a hidden file input — images and any file; the engine seals + κ-ships the bytes
  const fileIn = el("input", "display:none"); fileIn.type = "file"; fileIn.className = "hd-file";
  const attach = el("button", "background:transparent;border:0;color:#8696a0;padding:0 4px;font-size:20px;cursor:pointer;flex:0 0 auto", "📎");
  attach.className = "hd-attach"; attach.title = "Attach a file (sealed, peer-to-peer)";
  attach.onclick = () => fileIn.click();
  fileIn.onchange = () => { const f = fileIn.files && fileIn.files[0]; fileIn.value = ""; if (f && onAttach) onAttach(f); };
  if (onAttach) composer.append(attach);
  // 🗝 KEYS: hand a live power over your device — as native as 📎. Needs myPub (to mint on your own identity).
  const keyBtn = el("button", "background:transparent;border:0;color:#8696a0;padding:0 4px;font-size:19px;cursor:pointer;flex:0 0 auto", "🗝");
  keyBtn.className = "hd-key"; keyBtn.title = "Hand a key — a live power on your device, revocable any time";
  keyBtn.onclick = () => openKeySheet();
  if (myPub) composer.append(keyBtn);
  composer.append(input, sendBtn, fileIn);

  // safety sheet (tap 🛡)
  const sheet = el("div", "display:none;position:absolute;inset:0;background:rgba(4,7,11,.92);flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:26px;text-align:center");
  card.style.position = "relative";
  const sheetBody = el("div", "max-width:320px");
  sheet.append(sheetBody);

  card.append(head, banner, list, typing, notice, composer, sheet); overlay.append(card); document.body.append(overlay);

  const doSend = () => { const t = input.value.trim(); if (!t) return; input.value = ""; onSend(t); };
  sendBtn.onclick = doSend; input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };
  input.oninput = () => { try { onTyping(); } catch {} };
  let _typeT = null;

  let safety = { emojis: "", digits: "", status: "new" };
  shield.onclick = () => {
    const verified = safety.status === "same-verified";
    sheetBody.innerHTML = `<div style="font-size:15px;font-weight:700;margin-bottom:4px">Verify ${_esc(curName)}</div>
      <div style="color:#8aa0ad;font-size:12.5px;margin-bottom:14px">Compare this in person or over a call. If it matches, no one is in the middle.</div>
      <div style="font-size:30px;letter-spacing:4px;margin:8px 0">${safety.emojis}</div>
      <div style="font-family:ui-monospace,monospace;font-size:12px;color:#cfe;word-spacing:4px;line-height:1.8">${safety.digits}</div>`;
    const vb = el("button", `margin-top:16px;background:${verified ? "#1f2c35" : "#00d09c"};color:${verified ? "#8aa0ad" : "#04110d"};border:0;border-radius:12px;padding:11px 18px;font-weight:700;cursor:pointer`, verified ? "✓ Verified" : "Mark verified");
    const cb = el("button", "margin-top:8px;background:transparent;border:0;color:#8aa0ad;cursor:pointer;display:block;width:100%", "Close");
    cb.className = "hd-sheet-close";   // witnesses click by class — `text=Close` collides with app chrome
    vb.onclick = () => { if (!verified) { onVerify(); } sheet.style.display = "none"; };
    cb.onclick = () => { sheet.style.display = "none"; };
    sheetBody.append(vb, cb); sheet.style.display = "flex";
  };

  const _tick = (s) => (s === "delivered" ? "✓✓" : "✓");
  const _bubbleCss = (mine) => `max-width:80%;padding:6px 9px 8px;border-radius:8px;font-size:14.2px;line-height:1.32;box-shadow:0 1px .5px rgba(0,0,0,.13);${mine ? "background:#005c4b;color:#e9edef;border-top-right-radius:2px" : "background:#202c33;color:#e9edef;border-top-left-radius:2px"}`;
  const _addTick = (b, m) => { const t = el("span", `font-size:11px;margin-left:6px;vertical-align:-1px;color:${m.status === "delivered" ? "#53bdeb" : "rgba(233,237,239,.55)"}`, _tick(m.status)); t.className = "hd-tick"; b.append(t); };
  function bubble(m) {
    const mine = m.from === "me";
    const row = el("div", `display:flex;${mine ? "justify-content:flex-end" : "justify-content:flex-start"}`);
    // 🗝 KEYS: a message carrying a key link renders as the live control card, not raw text (parity with the
    // React bridged-chat bubble). The card IS the message. Everything else falls through to a normal bubble.
    const kc = keyLinkInText(m.text);
    if (kc) { const kcard = keyCardDom(kc, mine); if (m.kappa) kcard.dataset.kappa = m.kappa; row.append(kcard); return row; }
    const b = el("div", _bubbleCss(mine));
    b.className = "hd-bubble";
    if (m.kappa) b.dataset.kappa = m.kappa;
    const txt = el("span", null); txt.textContent = m.text; b.append(txt);
    if (!mine && m.verified === false) { const w = el("div", "font-size:11px;color:#ffb0b0;margin-top:3px", "⚠ unverified sender"); b.append(w); }
    if (mine) _addTick(b, m);   // ✓ sent / ✓✓ delivered (blue when read) — WhatsApp read receipts
    row.append(b); return row;
  }

  // a media bubble (N7/MD4): an <img> for image/*, a name+size chip with save for everything else, and —
  // when the bytes haven't fetched yet — an HONEST placeholder ("appears when <name> is online"), never a
  // spinner that lies. The bubble IS the feature: no gallery, no viewer.
  const _fmtSize = (n) => (n == null ? "" : n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  function _mediaContent(m) {
    if (m.url && /^image\//.test(m.mime || "")) {
      const img = el("img", "display:block;max-width:100%;max-height:280px;border-radius:10px");
      img.src = m.url; img.alt = m.name || "image"; img.className = "hd-media-img";
      return img;
    }
    if (m.url) {
      const chip = el("div", "display:flex;align-items:center;gap:8px");
      const a = el("a", "color:inherit;text-decoration:none;font-weight:600;font-size:13px", "📎 " + (m.name || "file"));
      a.href = m.url; a.download = m.name || "file"; a.className = "hd-media-save"; a.title = "Save";
      chip.append(a, el("span", "font-size:11px;opacity:.7", _fmtSize(m.size)));
      return chip;
    }
    const ph = el("div", "font-size:13px;opacity:.85");
    ph.className = "hd-media-pending";
    ph.textContent = "📎 " + (m.name || "file") + " — appears when " + curName + " is online";
    return ph;
  }
  function mediaBubble(m) {
    const mine = m.from === "me";
    const row = el("div", `display:flex;${mine ? "justify-content:flex-end" : "justify-content:flex-start"}`);
    const b = el("div", _bubbleCss(mine).replace("padding:6px 9px 8px", "padding:4px 4px 6px"));
    b.className = "hd-bubble hd-media";
    if (m.kappa) b.dataset.kappa = m.kappa;
    b.append(_mediaContent(m));
    if (mine) _addTick(b, m);
    row.append(b); return row;
  }

  // ── 🗝 KEYS ────────────────────────────────────────────────────────────────────────────────────────────────
  // openKeySheet(): the mint form, in the same modal `sheet` the safety number uses. P0 verb = music.control
  // (one power done well). Mint on MY identity (myPub), send the key as a message → it renders as the card below.
  function openKeySheet() {
    const verb = KEY_VERBS["music.control"];
    let ttl = 7 * 24 * 3600e3;   // default: this week
    sheetBody.innerHTML = "";
    const wrap = el("div", "width:min(340px,86vw);text-align:left");
    wrap.append(el("div", "font-size:15px;font-weight:700;margin-bottom:2px", "🗝 Hand a key"));
    wrap.append(el("div", "color:#8aa0ad;font-size:12.5px;margin-bottom:12px", "A live power on your device — sealed, serverless, revocable any time."));
    const verbRow = el("div", "display:flex;gap:10px;align-items:center;background:#0e1a16;border:1px solid #1f3a30;border-radius:12px;padding:10px 12px;margin-bottom:10px");
    verbRow.append(el("span", "font-size:22px", verb.glyph), el("div", null, `<b style="font-size:13.5px">${_esc(verb.label)}</b><div style="color:#8aa0ad;font-size:11.5px">${_esc(verb.blurb || "")}</div>`));
    wrap.append(verbRow);
    const noteIn = el("input", "width:100%;box-sizing:border-box;background:#2a3942;border:0;border-radius:10px;padding:9px 12px;color:#e9edef;outline:none;font-size:13px;margin-bottom:10px");
    noteIn.placeholder = "A note with it (optional)"; noteIn.maxLength = 120;
    wrap.append(noteIn);
    const ttlRow = el("div", "display:flex;gap:6px;margin-bottom:12px");
    const ttls = [["1 hour", 3600e3], ["today", 24 * 3600e3], ["this week", 7 * 24 * 3600e3]];
    const ttlBtns = ttls.map(([lbl, ms]) => {
      const b = el("button", `flex:1;background:${ms === ttl ? "#00a884" : "#1f2c33"};color:${ms === ttl ? "#04110d" : "#cfe"};border:0;border-radius:9px;padding:8px 0;font-size:12px;font-weight:600;cursor:pointer`, lbl);
      b.onclick = () => { ttl = ms; ttlBtns.forEach(([bb, mms]) => { bb.style.background = mms === ttl ? "#00a884" : "#1f2c33"; bb.style.color = mms === ttl ? "#04110d" : "#cfe"; }); };
      return [b, ms];
    });
    ttlBtns.forEach(([b]) => ttlRow.append(b)); wrap.append(ttlRow);
    const err = el("div", "display:none;color:#ffb0b0;font-size:12px;margin-bottom:8px");
    const go = el("button", "width:100%;background:linear-gradient(90deg,#00d09c,#1fd6ac);color:#04110d;border:0;border-radius:12px;padding:11px;font-weight:700;cursor:pointer", "Hand this key");
    go.onclick = async () => {
      go.disabled = true; go.textContent = "Minting…"; err.style.display = "none";
      try {
        const issName = (localStorage.getItem("holo.direct.name") || "").trim() || null;
        const grant = await mintKey({ verb: "music.control", note: noteIn.value.trim() || null, ttlMs: ttl, myPub, issName });
        onSend(keyMessageText(grant, buildKeyLink(grant)));   // sends into the thread → renders as the card below
        sheet.style.display = "none";
      } catch (e) { err.style.display = "block"; err.textContent = String((e && e.message) || e); go.disabled = false; go.textContent = "Hand this key"; }
    };
    const cancel = el("button", "width:100%;margin-top:8px;background:transparent;border:0;color:#8aa0ad;cursor:pointer", "Cancel");
    cancel.className = "hd-sheet-close"; cancel.onclick = () => { sheet.style.display = "none"; };
    wrap.append(err, go, cancel);
    sheetBody.append(wrap); sheet.style.display = "flex";
  }

  // keyCardDom(kc, mine): the live control card, OWN DOM (mirrors the React KeyCard, shares holo-key.mjs). Holder:
  // "Use key" → invoke("now") over THIS sealed channel → controls + now-playing, honest states (asleep/revoked/
  // expired). Sender (mine): "You handed this key" + Take it back → revokeKey flips the issuer-local ring → the
  // very next holder tap is refused at the door.
  function keyCardDom(kc, mine) {
    const g = kc.grant, verb = KEY_VERBS[g.verb] || { glyph: "🗝", label: g.verb, blurb: "", methods: [] };
    const expired = !!(g.expires && Date.now() > g.expires);
    const card = el("div", `max-width:300px;background:#0e1a16;border:1px solid #1f3a30;border-radius:14px;padding:12px 13px;font-size:13px;color:#e9edef;${mine ? "margin-left:auto" : ""}`);
    card.className = "hd-key-card";
    const top = el("div", "display:flex;align-items:center;gap:8px;margin-bottom:3px");
    top.append(el("span", "font-size:18px", verb.glyph), el("b", "font-size:13.5px", _esc(g.name || "Key")));
    card.append(top);
    const foot = el("div", "font-size:11px;color:#7f97a0;margin-top:8px");
    if (mine) {
      let row = keyRing().find((r) => r.id === g.id) || null;
      const revoked = row && row.status === "revoked";
      card.append(el("div", "color:#9fdac8;font-size:12px", revoked ? "You took this key back" : "You handed this key" + (expired ? " · expired" : "")));
      if (g.note) card.append(el("div", "color:#8aa0ad;font-size:12px;font-style:italic;margin-top:2px", "“" + _esc(g.note) + "”"));
      const uses = el("div", "font-size:11px;color:#8aa0ad;margin-top:4px");
      if (row && row.uses) uses.textContent = "used " + row.uses + "×"; card.append(uses);
      if (!revoked && !expired) {
        const rv = el("button", "margin-top:8px;background:rgba(233,111,111,.14);border:1px solid rgba(233,111,111,.4);color:#ffd7d7;border-radius:9px;padding:7px 12px;font-size:12px;font-weight:600;cursor:pointer", "Take it back");
        rv.onclick = () => { revokeKey(g.id); card.style.opacity = ".55"; rv.remove(); card.querySelector(".hd-key-lbl2") || card.insertBefore(el("div", "color:#ffb0b0;font-size:12px;margin-top:6px", "◌ taken back"), foot); };
        card.append(rv);
      }
      foot.textContent = "Holo Keys · a live power on your device · revocable any time"; card.append(foot);
      return card;
    }
    // holder side
    card.append(el("div", "color:#cfe;font-size:12.5px", _esc(g.issName || "Someone") + " handed you a key — " + _esc(verb.blurb || verb.label)));
    if (g.note) card.append(el("div", "color:#8aa0ad;font-size:12px;font-style:italic;margin-top:2px", "“" + _esc(g.note) + "”"));
    const now = el("div", "display:none;font-size:12px;color:#9fdac8;margin-top:6px");
    const ctl = el("div", "display:none;gap:6px;align-items:center;margin-top:9px");
    const errL = el("div", "display:none;color:#ffb0b0;font-size:12px;margin-top:6px");
    const use = el("button", "margin-top:9px;background:#00a884;color:#04110d;border:0;border-radius:9px;padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer", "Use key");
    const setState = (s) => { foot.textContent = s === "live" ? "● live — their device answered" : s === "busy" ? "dialing their device…" : s === "revoked" ? "◌ taken back" : s === "expired" ? "◌ expired" : s === "asleep" ? "◌ asleep" : "◈ self-verifying · κ " + (g.id || "").slice(0, 8); };
    const paint = (n) => { if (n && n.name) { now.style.display = "block"; now.textContent = "♪ " + n.name + (n.artist ? " — " + n.artist : "") + (n.playing === false ? " (paused)" : ""); } };
    const invoke = async (method, args = []) => {
      errL.style.display = "none"; setState("busy"); use.disabled = true; use.textContent = "Dialing…";
      try {
        const v = await keyInvoke(g, method, args);
        setState("live"); use.style.display = "none"; ctl.style.display = "flex";
        if (method === "now") paint(v && typeof v === "object" ? v : null);
        else keyInvoke(g, "now").then((n) => paint(n)).catch(() => {});
      } catch (e) {
        const msg = String((e && e.message) || e), st = /revoked|unknown-key/.test(msg) ? "revoked" : /expired/.test(msg) ? "expired" : "asleep";
        setState(st); use.disabled = false; use.textContent = "Use key"; errL.style.display = "block";
        errL.textContent = st === "revoked" ? "This key was taken back." : st === "expired" ? "This key has expired." : /music isn't open/.test(msg) ? "Their music isn't playing right now." : "Their device is asleep — the key wakes when they're back.";
        if (st === "revoked" || st === "expired") { ctl.style.display = "none"; card.style.opacity = ".6"; }
      }
    };
    use.onclick = () => invoke("now");
    // L2 — the issuer took it back: fold the surface the MOMENT the push lands (the door refuses regardless).
    const foldRevoked = () => { setState("revoked"); use.style.display = "none"; ctl.style.display = "none"; now.style.display = "none"; card.style.opacity = ".6"; errL.style.display = "block"; errL.textContent = "This key was taken back."; };
    if (keyRevoked(g.id)) foldRevoked();
    else { const off = onKeyRevoked((rid) => { if (rid === g.id) foldRevoked(); }); const mo = new MutationObserver(() => { if (!document.body.contains(card)) { off(); mo.disconnect(); } }); mo.observe(document.body, { childList: true, subtree: true }); }
    const cbtn = (label, title, fn) => { const b = el("button", "background:#1f2c33;border:0;color:#cfe;border-radius:8px;width:34px;height:30px;font-size:14px;cursor:pointer", label); b.title = title; b.onclick = fn; return b; };
    let playing = true;
    const playBtn = cbtn("⏸", "Play/Pause", () => { invoke(playing ? "pause" : "resume"); playing = !playing; playBtn.textContent = playing ? "⏸" : "▶"; });
    const vol = el("input", "flex:1;accent-color:#00a884"); vol.type = "range"; vol.min = 0; vol.max = 100; vol.value = 70; vol.title = "Volume on their device";
    vol.onchange = () => invoke("volume", [Number(vol.value)]);
    ctl.append(cbtn("⏮", "Previous", () => invoke("prev")), playBtn, cbtn("⏭", "Next", () => invoke("next")), vol);
    if (!expired) card.append(use);
    card.append(now, ctl, errL); setState(expired ? "expired" : "idle"); card.append(foot);
    if (expired) { errL.style.display = "block"; errL.textContent = "This key has expired."; }
    return card;
  }

  function close() { try { overlay.remove(); } catch {} }
  let _noticeT = null;
  return {
    overlay,
    addMessage(m) { list.append(bubble(m)); list.scrollTop = list.scrollHeight; },
    addMedia(m) { list.append(mediaBubble(m)); list.scrollTop = list.scrollHeight; },
    setMedia(kappa, m) {   // pending → real: swap the placeholder for the image/chip once the bytes fetched
      const b = list.querySelector(`.hd-bubble[data-kappa="${kappa}"]`);
      if (!b) { this.addMedia({ ...m, kappa }); return; }
      const ph = b.querySelector(".hd-media-pending, .hd-media-img, .hd-media-save");
      const content = _mediaContent(m);
      if (ph && ph.parentElement === b) b.replaceChild(content, ph);
      else { const old = b.firstChild; if (old) b.replaceChild(content, old); else b.append(content); }
      list.scrollTop = list.scrollHeight;
    },
    notice(text) { notice.textContent = text; notice.style.display = "block"; clearTimeout(_noticeT); _noticeT = setTimeout(() => { notice.style.display = "none"; }, 6000); },
    setTick(kappa, status) { const b = list.querySelector(`.hd-bubble[data-kappa="${kappa}"] .hd-tick`); if (b) { b.textContent = _tick(status); b.style.color = status === "delivered" ? "#53bdeb" : "rgba(233,237,239,.55)"; } },
    setTyping(on) { typing.style.display = on ? "block" : "none"; if (on) { clearTimeout(_typeT); _typeT = setTimeout(() => { typing.style.display = "none"; }, 4000); } },
    setSafety({ emojis, digits, status }) { safety = { emojis, digits, status }; shield.textContent = status === "same-verified" ? "🛡 Verified" : (status === "changed" ? "⚠ Verify" : "🛡 Verify"); shield.style.color = status === "same-verified" ? "#00d09c" : (status === "changed" ? "#ffb0b0" : "#e9f1f5"); },
    setName(nm) { if (!nm) return; curName = nm; nameEl.textContent = nm; avatar.textContent = (String(nm).trim()[0] || "·").toUpperCase(); },
    // TRUTHFUL lock (R5): the sub-line states the ACTUAL seal — "forward secret" only once the Olm ratchet is
    // established with this contact; plain "end-to-end encrypted" (holo-seal) otherwise. Never claims more than holds.
    setSeal(ratchet) { sub.textContent = ratchet ? "🔒 end-to-end encrypted · forward secret" : "🔒 end-to-end encrypted"; },
    showKeyChange(on) { banner.style.display = on ? "block" : "none"; if (on) banner.innerHTML = `⚠ <b>${_esc(curName)}'s security code changed.</b> Verify again before trusting new messages.`; },
    setVerified(v) { this.setSafety({ ...safety, status: v ? "same-verified" : safety.status }); },
    close,
  };
}
