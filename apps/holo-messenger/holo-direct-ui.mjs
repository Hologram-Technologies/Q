// holo-direct-ui.mjs - the native Holo Direct chat surface: a self-contained sealed-conversation panel (OWN DOM, inline
// styles → zero React conflict). Shows the 🔒 end-to-end state, a tap-to-verify SAFETY NUMBER (emoji strip + 60 digits),
// a KEY-CHANGE warning banner (anti-MITM), message bubbles (with a per-message unverified flag), and a composer. The app
// wires it to the holo-direct engine (onSend → engine.send; engine "message"/"keychange" → addMessage/showKeyChange).

export function openDirectChat({ name = "Contact", onSend = () => {}, onVerify = () => {}, onClose = () => {}, onTyping = () => {}, onAttach = null, onRename = null } = {}) {
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
