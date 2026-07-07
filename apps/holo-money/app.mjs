// Holo Money — the neobank surface of Hologram OS.
// One responsive column: the SAME app is the phone screen, the desktop right carriage
// (?panel=1, mounted by the shell like Holo Wallet), and a full-page holospace.
// Every number is real: balances/history/prices ride the sovereign wallet gate
// (/_shared/holo-wallet-bridge.js — keys never come here); money moves as Holo Pay
// κ-links; cards are κ-objects with faces derived from their κ (cards.mjs).
// When the wallet is not reachable the UI says so — nothing is simulated.

import { mintCard, renderFace, EDITIONS } from "./cards.mjs";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ── environment: panel (desktop carriage) · mobile · full page ───── */
const params = new URLSearchParams(location.search);
const PANEL = params.get("panel") === "1";
const KIND = params.get("kind") || "open";
const isMobile = matchMedia("(max-width: 560px)").matches;
document.body.classList.add(PANEL ? "panel" : isMobile ? "mobile" : "page");

/* ── optional substrate modules (each degrades honestly if absent) ── */
const wallet = await import("../../_shared/holo-wallet-bridge.js").catch(() => null);
const pay = await import("../holo-messenger/holo-pay.mjs").catch(() => null);
const identity = await import("../self/holo-identity.mjs").catch(() => null);
const tee = await import("../holo-linux/holo-linux-tee.mjs").catch(() => null);

const CHAINS = ["ethereum", "arbitrum", "solana", "bitcoin"];
const SYM = { ethereum: "ETH", arbitrum: "ETH", solana: "SOL", bitcoin: "BTC" };

/* ── local store (cards, prefs, links) — one namespace ────────────── */
const store = {
  key: "holo-money.v1",
  read() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; } },
  write(patch) { const s = { ...this.read(), ...patch }; localStorage.setItem(this.key, JSON.stringify(s)); return s; },
};

const state = {
  walletLive: false,
  accounts: [],          // [{chain, amount, usd}]
  totalUsd: null,
  txs: [],
  cards: store.read().cards || [],
  links: store.read().links || [],
  holder: store.read().holder || "",
  sovereign: false,
};

/* ── wallet probe + reads (bounded — the bridge itself waits 30s) ─── */
const bounded = (p, ms = 3500) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const num = (v) => { const n = typeof v === "object" && v ? (v.balance ?? v.value ?? v.amount ?? v.usd) : v; const f = parseFloat(n); return Number.isFinite(f) ? f : null; };

async function readWallet() {
  if (!wallet) return;
  // probe with ONE cheap read; if nobody answers, the wallet is closed/absent — say so.
  try { await bounded(wallet.requestAddresses(), 3500); state.walletLive = true; } catch { state.walletLive = false; }
  if (!state.walletLive) { renderHome(); return; }

  let prices = {};
  try { const p = await bounded(wallet.requestPrice(CHAINS), 6000); if (p && typeof p === "object") prices = p; } catch {}
  const px = (chain) => num(prices[chain]) ?? num(prices[SYM[chain]]);

  state.accounts = [];
  await Promise.all(CHAINS.map(async (chain) => {
    try {
      const amount = num(await bounded(wallet.requestBalance(chain), 8000));
      if (amount === null) return;
      const p = px(chain);
      state.accounts.push({ chain, amount, usd: p !== null ? amount * p : null });
    } catch {}
  }));
  state.accounts.sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0));
  const usable = state.accounts.filter((a) => a.usd !== null);
  state.totalUsd = usable.length ? usable.reduce((s, a) => s + a.usd, 0) : null;
  renderHome();

  // history: merge across chains, newest first (shape-tolerant)
  const txs = [];
  await Promise.all(CHAINS.map(async (chain) => {
    try {
      const h = await bounded(wallet.requestHistory(chain, 12), 9000);
      for (const t of Array.isArray(h) ? h : h?.items || h?.txs || []) {
        txs.push({
          chain,
          hash: t.hash || t.txid || t.signature || "",
          peer: t.to || t.from || t.counterparty || "",
          out: t.direction ? t.direction === "out" : !!t.to,
          amount: num(t.amount ?? t.value),
          ts: +new Date(t.ts ?? t.time ?? t.timestamp ?? t.blockTime ?? Date.now()),
        });
      }
    } catch {}
  }));
  state.txs = txs.sort((a, b) => b.ts - a.ts).slice(0, 40);
  renderTxs(); renderStats();
}

/* ── formatting ───────────────────────────────────────────────────── */
const fmtUsd = (v) => v === null ? "—" : "$" + v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });
const fmtAmt = (v, chain) => v === null ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${SYM[chain] || ""}`;
const fmtTime = (ts) => new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
  new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const short = (s, n = 10) => s && s.length > n ? s.slice(0, 6) + "…" + s.slice(-4) : s || "";

/* balance roll-up — the Revolut number feel */
function rollBalance(el, to) {
  if (to === null) { el.textContent = "—"; return; }
  const from = parseFloat(el.dataset.v || "0") || 0;
  el.dataset.v = to;
  const t0 = performance.now(), dur = 700;
  (function tick(t) {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmtUsd(from + (to - from) * e);
    if (k < 1) requestAnimationFrame(tick);
  })(t0);
}

/* ── HOME ─────────────────────────────────────────────────────────── */
function renderHome() {
  rollBalance($("#balance"), state.totalUsd ?? (state.walletLive ? null : 0));
  const ws = $("#wallet-state");
  if (!wallet) { ws.hidden = false; ws.innerHTML = "<b>Wallet bridge unavailable</b> — running outside the OS."; }
  else if (!state.walletLive) { ws.hidden = false; ws.innerHTML = "<b>Wallet locked or closed</b> — open Holo Wallet to see live balances."; }
  else ws.hidden = true;

  const acc = $("#accounts");
  acc.innerHTML = state.accounts.length
    ? state.accounts.map((a) => `
      <div class="acct-row">
        <span class="a-ic">${esc(SYM[a.chain])}</span>
        <span class="a-nm">${esc(a.chain)}</span>
        <span class="a-amt">${esc(fmtAmt(a.amount, a.chain))}<span class="a-fiat">${esc(fmtUsd(a.usd))}</span></span>
      </div>`).join("")
    : `<div class="acct-row"><span class="a-nm">${state.walletLive ? "No balances yet" : "Wallet offline"}</span></div>`;

  $$(".quick button").forEach((b) => { if (b.dataset.act === "add" || b.dataset.act === "move") b.disabled = !state.walletLive && b.dataset.act === "move"; });
  const av = $("#avatar");
  av.textContent = ((state.holder || "").trim()[0] || "O").toUpperCase();
  av.title = state.holder || "Operator";
}

function renderTxs() {
  const list = $("#tx-list");
  if (!state.txs.length) {
    list.innerHTML = `<div class="empty">${state.walletLive ? "No activity yet — add money to begin." : "Activity appears when the wallet is open."}</div>`;
    $("#tx-all").hidden = true; return;
  }
  const hue = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const row = (t) => `
    <button class="tx" data-hash="${esc(t.hash)}">
      <span class="t-av" style="background:hsl(${hue(t.peer || t.hash)},45%,38%)">${esc((t.peer || "?").replace(/^0x/, "").slice(0, 2).toUpperCase())}</span>
      <span class="t-body"><span class="t-nm">${esc(short(t.peer) || "Transaction")}</span>
      <span class="t-sub">${esc(t.chain)} · ${esc(fmtTime(t.ts))}</span></span>
      <span class="t-amt ${t.out ? "" : "in"}">${t.out ? "−" : "+"}${esc(fmtAmt(t.amount, t.chain))}</span>
    </button>`;
  list.innerHTML = state.txs.slice(0, 6).map(row).join("");
  const all = $("#tx-all");
  all.hidden = state.txs.length <= 6;
  all.onclick = () => { list.innerHTML = state.txs.map(row).join(""); all.hidden = true; };
  $$(".tx", list).forEach((b) => b.onclick = () => {
    const t = state.txs.find((x) => x.hash === b.dataset.hash); if (t) txSheet(t);
  });
}

/* ── CARDS ────────────────────────────────────────────────────────── */
let cardIdx = 0;
function renderCards() {
  const rail = $("#card-rail");
  if (!state.cards.length) {
    rail.innerHTML = `<div class="empty" style="flex:1">No cards yet — mint your first. Each card is a κ-object; its face is derived from its κ.</div>`;
    $("#card-meta").innerHTML = ""; return;
  }
  rail.innerHTML = "";
  state.cards.forEach((card, i) => {
    const d = document.createElement("div");
    d.className = "card-face" + (card.frozen ? " frozen" : "");
    const cv = document.createElement("canvas");
    d.appendChild(cv); rail.appendChild(d);
    renderFace(cv, card);
    d.onclick = () => { cardIdx = i; renderCardMeta(); d.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); };
    // subtle 3D tilt on pointer — the premium feel, no library
    d.onpointermove = (e) => {
      const r = d.getBoundingClientRect();
      const rx = ((e.clientY - r.top) / r.height - 0.5) * -8, ry = ((e.clientX - r.left) / r.width - 0.5) * 10;
      d.style.transform = `perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg)`;
    };
    d.onpointerleave = () => { d.style.transform = ""; };
  });
  renderCardMeta();
}

function renderCardMeta() {
  const card = state.cards[cardIdx]; const meta = $("#card-meta");
  if (!card) { meta.innerHTML = ""; return; }
  meta.innerHTML = `
    <div class="cm-row"><span class="k">Name</span><span class="v">${esc(card.label)}</span></div>
    <div class="cm-row"><span class="k">Edition</span><span class="v">${esc(EDITIONS[card.edition]?.name || card.edition)}</span></div>
    <div class="cm-row"><span class="k">Chain</span><span class="v">${esc(card.chain)}</span></div>
    <div class="cm-row"><span class="k">Address</span><span class="v">${esc(card.address || "unbound (wallet was offline at mint)")}</span></div>
    <div class="cm-row"><span class="k">κ</span><span class="v">${esc(card.kappa)}</span></div>
    <div class="cm-actions">
      <button class="ghost" id="cm-freeze">${card.frozen ? "Unfreeze" : "Freeze"}</button>
      <button class="ghost" id="cm-copy">Copy address</button>
    </div>`;
  $("#cm-freeze").onclick = () => { card.frozen = !card.frozen; store.write({ cards: state.cards }); renderCards(); };
  $("#cm-copy").onclick = async (e) => {
    try { await navigator.clipboard.writeText(card.address || card.kappa); e.target.textContent = "Copied ✓"; setTimeout(() => (e.target.textContent = "Copy address"), 1200); } catch {}
  };
}

async function mintFlow(sheetEl, { holder, onDone }) {
  let edition = "standard";
  const editionsHtml = Object.entries(EDITIONS).map(([id, ed]) => `
    <div class="ed ${id === edition ? "sel" : ""} ${ed.locked && !state.sovereign ? "locked" : ""}" data-ed="${id}">
      <canvas></canvas><span class="ed-nm">${esc(ed.name)}</span>${ed.locked && !state.sovereign ? '<span class="ed-lock">🔒 TEE</span>' : ""}
    </div>`).join("");
  sheetEl.innerHTML = `
    <div class="grab"></div><h2>Get card</h2>
    <label>Card name</label><input id="mint-nm" placeholder="Everyday" maxlength="24" />
    <label>Edition</label><div class="editions">${editionsHtml}</div>
    <label>Chain</label><select id="mint-ch">${CHAINS.map((c) => `<option>${c}</option>`).join("")}</select>
    <p class="sheet-note">A card is a receive/spend handle bound to a wallet address. Spending is always gated by Holo Wallet — biometric on every send.</p>
    <button class="cta" id="mint-go">Mint card</button>`;
  // live face previews — the customization dopamine
  for (const el of $$(".ed", sheetEl)) {
    const prev = await mintCard({ edition: el.dataset.ed, label: "Preview", holder: holder || "You", address: "" });
    renderFace($("canvas", el), prev);
    el.onclick = () => {
      if (el.classList.contains("locked")) return;
      edition = el.dataset.ed;
      $$(".ed", sheetEl).forEach((x) => x.classList.toggle("sel", x === el));
    };
  }
  $("#mint-go").onclick = async () => {
    const btn = $("#mint-go"); btn.disabled = true; btn.textContent = "Minting…";
    const chain = $("#mint-ch").value;
    let address = "";
    if (state.walletLive) { try { const a = await bounded(wallet.requestAddress(chain), 8000); address = a?.address || (typeof a === "string" ? a : ""); } catch {} }
    const card = await mintCard({ chain, address, label: $("#mint-nm").value.trim() || "Everyday", edition, holder: holder || state.holder || "Operator" });
    state.cards.push(card); store.write({ cards: state.cards });
    cardIdx = state.cards.length - 1;
    onDone(card);
  };
}

/* ── PAY (Holo Pay κ-links) ───────────────────────────────────────── */
function renderLinks() {
  const box = $("#pay-links");
  if (!state.links.length) return; // keep the explainer
  box.innerHTML = state.links.slice().reverse().map((l) => `
    <div class="pl-row">
      <span class="t-body"><span class="t-nm">${l.kind === "send" ? "Send" : "Request"} · ${esc(l.amount)} ${esc(l.asset)}</span>
      <span class="t-sub">${esc(l.memo || "")} ${esc(fmtTime(l.created))}</span></span>
      <button class="cta-sm" data-url="${esc(l.url)}">Copy link</button>
    </div>`).join("");
  $$("[data-url]", box).forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = "Copy link"), 1200); } catch {}
  });
}

let _signer = null;
async function paySigner() { if (!_signer && pay) _signer = await pay.createSigner(); return _signer; }

function paySheet(kind) {
  openSheet((el) => {
    el.innerHTML = `
      <div class="grab"></div><h2>${kind === "send" ? "Send money" : "Request money"}</h2>
      <label>Amount</label><input id="pay-amt" inputmode="decimal" placeholder="0.00" />
      <label>Asset</label><select id="pay-asset"><option>USDC</option><option>ETH</option><option>SOL</option><option>BTC</option></select>
      <label>Note</label><input id="pay-memo" placeholder="What's it for?" maxlength="80" />
      ${pay ? "" : '<p class="sheet-note">Holo Pay module not reachable — links unavailable here.</p>'}
      <p class="sheet-note">This mints a κ-link: the link IS the ${kind === "send" ? "payment — whoever holds it can claim" : "request"}. Paste it in any chat; Messenger renders it as a live money card. <span class="test">Settlement is testnet escrow unless the wallet funds an HTLC.</span></p>
      <button class="cta" id="pay-go" ${pay ? "" : "disabled"}>Create link</button>`;
    $("#pay-go").onclick = async () => {
      const amount = parseFloat($("#pay-amt").value);
      if (!Number.isFinite(amount) || amount <= 0) { $("#pay-amt").focus(); return; }
      const btn = $("#pay-go"); btn.disabled = true; btn.textContent = "Sealing…";
      try {
        const intent = await pay.createPayment({
          kind, amount, asset: $("#pay-asset").value, memo: $("#pay-memo").value.trim(),
          fromName: state.holder || "Operator",
          signer: await paySigner(),   // sealed: verifiers re-derive κ + check this sig (Law L5)
        });
        const link = pay.buildLink(intent, { origin: location.origin });
        const url = link.https;   // PAY-E opening: claims in ANY browser, no Hologram needed
        state.links.push({ kind, amount, asset: intent.asset, memo: intent.memo, created: Date.now(), expires: intent.expires || null, url, kappa: intent.kappa });
        store.write({ links: state.links });
        renderLinks(); closeSheet();
        showScreen("pay");
        try { await navigator.clipboard.writeText(url); } catch {}
      } catch (e) {
        btn.disabled = false; btn.textContent = "Create link";
        el.insertAdjacentHTML("beforeend", `<p class="sheet-note test">Could not seal the link: ${esc(e.message)}</p>`);
      }
    };
  });
}

/* ── quick-action sheets ──────────────────────────────────────────── */
function addMoneySheet() {
  openSheet(async (el) => {
    el.innerHTML = `<div class="grab"></div><h2>Add money</h2>
      <label>Chain</label><select id="add-ch">${CHAINS.map((c) => `<option>${c}</option>`).join("")}</select>
      <label>Your address</label><div class="addr" id="add-addr">${state.walletLive ? "…" : "Wallet offline — open Holo Wallet first."}</div>
      <button class="cta" id="add-copy" ${state.walletLive ? "" : "disabled"}>Copy address</button>
      <p class="sheet-note">Send to this address from any wallet or exchange. It lands in YOUR vault — Holo Money never holds funds.</p>`;
    const load = async () => {
      if (!state.walletLive) return;
      $("#add-addr").textContent = "…";
      try { const a = await bounded(wallet.requestAddress($("#add-ch").value), 8000); $("#add-addr").textContent = a?.address || (typeof a === "string" ? a : "unavailable"); }
      catch { $("#add-addr").textContent = "unavailable (wallet closed?)"; }
    };
    $("#add-ch").onchange = load; load();
    $("#add-copy").onclick = async (e) => { try { await navigator.clipboard.writeText($("#add-addr").textContent); e.target.textContent = "Copied ✓"; } catch {} };
  });
}

function moveSheet() {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>Move</h2>
      <label>Chain</label><select id="mv-ch">${CHAINS.map((c) => `<option>${c}</option>`).join("")}</select>
      <label>To (address)</label><input id="mv-to" placeholder="0x… / address" />
      <label>Amount</label><input id="mv-amt" inputmode="decimal" placeholder="0.00" />
      <p class="sheet-note">Holo Wallet gates this send — you approve with biometrics there. Keys never touch Holo Money.</p>
      <button class="cta" id="mv-go">Send via wallet</button>
      <button class="ghost" id="mv-link" style="width:100%;margin-top:10px">…or send as a κ-link instead</button>`;
    $("#mv-link").onclick = () => paySheet("send");
    $("#mv-go").onclick = async () => {
      const to = $("#mv-to").value.trim(), amt = parseFloat($("#mv-amt").value);
      if (!to || !Number.isFinite(amt) || amt <= 0) return;
      const btn = $("#mv-go"); btn.disabled = true; btn.textContent = "Waiting for wallet approval…";
      try {
        const r = await wallet.requestSend($("#mv-ch").value, to, amt);
        el.innerHTML = `<div class="grab"></div><h2>Sent ✓</h2><div class="addr">${esc(r?.hash || "submitted")}</div>`;
        readWallet();
      } catch (e) { btn.disabled = false; btn.textContent = "Send via wallet"; el.insertAdjacentHTML("beforeend", `<p class="sheet-note test">${esc(e.message)}</p>`); }
    };
  });
}

function txSheet(t) {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>${t.out ? "Sent" : "Received"} ${esc(fmtAmt(t.amount, t.chain))}</h2>
      <div class="cm-row"><span class="k">Chain</span><span class="v">${esc(t.chain)}</span></div>
      <div class="cm-row"><span class="k">Counterparty</span><span class="v">${esc(t.peer || "—")}</span></div>
      <div class="cm-row"><span class="k">When</span><span class="v">${esc(fmtTime(t.ts))}</span></div>
      <div class="cm-row"><span class="k">Hash</span><span class="v">${esc(t.hash || "—")}</span></div>`;
  });
}

function detailsSheet() {
  openSheet((el) => {
    el.innerHTML = `<div class="grab"></div><h2>Details</h2>
      <div class="cm-row"><span class="k">Operator</span><span class="v">${esc(state.holder || "Operator")}</span></div>
      <div class="cm-row"><span class="k">Wallet</span><span class="v">${state.walletLive ? "live" : "offline"}</span></div>
      <div class="cm-row"><span class="k">TEE sovereign</span><span class="v">${state.sovereign ? "yes" : "no"}</span></div>
      <div class="cm-row"><span class="k">Cards</span><span class="v">${state.cards.length}</span></div>
      <div class="cm-row"><span class="k">Surface</span><span class="v">${PANEL ? "desktop carriage" : isMobile ? "mobile" : "page"}</span></div>
      <button class="ghost" id="dt-wallet" style="width:100%;margin-top:14px">Open Holo Wallet</button>`;
    $("#dt-wallet").onclick = () => { try { parent.postMessage({ type: "holo-identity", action: "open-wallet" }, location.origin); } catch {} };
  });
}

/* ── STATS ────────────────────────────────────────────────────────── */
function renderStats() {
  const body = $("#stats-body");
  const out = state.txs.filter((t) => t.out && t.amount !== null);
  if (!out.length) { body.innerHTML = `<div class="empty">No outgoing activity yet — spending analytics build from your real on-chain history.</div>`; return; }
  const byMonth = new Map();
  for (const t of out) {
    const k = new Date(t.ts).toLocaleDateString(undefined, { month: "short" });
    byMonth.set(k, (byMonth.get(k) || 0) + (t.amount || 0));
  }
  const max = Math.max(...byMonth.values());
  body.innerHTML = `<div class="bars">${[...byMonth].map(([m, v]) =>
    `<div class="bar"><i style="height:${Math.max(6, (v / max) * 100)}%"></i><span>${esc(m)}</span></div>`).join("")}</div>
    <p class="stat-note">Native units summed per month across chains — an honest first cut. Fiat-weighted categories arrive with price history.</p>`;
}

/* ── sheet + navigation plumbing ──────────────────────────────────── */
function openSheet(fill) {
  const sheet = $("#sheet"), card = $("#sheet-card");
  sheet.hidden = false; fill(card);
  sheet.onclick = (e) => { if (e.target === sheet) closeSheet(); };
}
function closeSheet() { $("#sheet").hidden = true; $("#sheet-card").innerHTML = ""; }

function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.toggle("on", s.id === "scr-" + name));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.scr === name));
  if (name === "cards") renderCards();
  if (name === "pay") renderLinks();
  if (name === "stats") renderStats();
  publishContext(name);
}

/* ── Q context — expose live state so Q can see what you see ──────── */
function publishContext(screen = "home") {
  const ctx = {
    app: "holo-money", screen,
    walletLive: state.walletLive, totalUsd: state.totalUsd,
    accounts: state.accounts.length, cards: state.cards.length,
    pendingLinks: state.links.length,
  };
  try { if (window.HoloQ) window.HoloQ.qFocusContext = ctx; } catch {}
  try { parent.postMessage({ type: "holo-money", action: "context", ctx }, location.origin); } catch {}
}

/* ── onboarding — the TEE IS the KYC; every step demos a feature ──── */
async function maybeOnboard() {
  if (store.read().onboarded || params.get("guest") === "1") return;
  const ob = $("#onboard"); ob.hidden = false;

  // detect what's REALLY here — badges never lie
  let rosterLabel = "";
  try { const r = identity ? await identity.roster() : []; rosterLabel = r?.[0]?.label || ""; } catch {}
  try { state.sovereign = !!(tee && await tee.teeAvailable()); } catch {}

  const step = (html) => new Promise((done) => {
    ob.innerHTML = html;
    ob.querySelector("[data-next]")?.addEventListener("click", () => done("next"));
    ob.querySelector("[data-skip]")?.addEventListener("click", () => done("skip"));
    ob._done = done;
  });

  // 1 — welcome
  const r1 = await step(`<div class="ob"><h1>Ready to change the way you money?</h1>
    <p>Real balances. Money as links. Cards that are math, not plastic.</p></div>
    <div class="ob-foot"><button class="cta" data-next>Begin</button>
    <button class="ob-skip" data-skip>Skip for now</button></div>`);
  if (r1 === "skip") return finish();

  // 2 — identity: your κ replaces the account number
  await step(`<div class="ob"><h1>You are the bank.</h1>
    <p>No account number — your identity is a key you hold. ${rosterLabel ? "Welcome back," : "Name your operator."}</p>
    <div class="ob-badges">
      <span class="badge ${rosterLabel ? "ok" : ""}">${rosterLabel ? "Identity: " + esc(rosterLabel) : "New operator"}</span>
      <span class="badge ${state.sovereign ? "ok" : ""}">${state.sovereign ? "TEE: sovereign device" : "TEE: not detected"}</span>
      <span class="badge ${state.walletLive ? "ok" : ""}">${state.walletLive ? "Wallet: live" : "Wallet: closed"}</span>
    </div>
    <input id="ob-nm" placeholder="Your name" value="${esc(rosterLabel)}" maxlength="24" /></div>
    <div class="ob-foot"><button class="cta" data-next>Continue</button></div>`);
  state.holder = ($("#ob-nm")?.value || rosterLabel || "Operator").trim() || "Operator";
  store.write({ holder: state.holder });

  // 3 — first card, face renders live while they choose
  ob.innerHTML = `<div class="ob"><h1>Pick your first card.</h1>
    <p>The face is derived from the card's κ — yours is one of a kind.</p>
    <div class="editions"></div><div class="ob-kappa"></div></div>
    <div class="ob-foot"><button class="cta" id="ob-mint">Mint it</button>
    <button class="ob-skip" data-skip>Later</button></div>`;
  let chosen = "standard";
  const edBox = $(".editions", ob);
  for (const [id, ed] of Object.entries(EDITIONS)) {
    if (ed.locked && !state.sovereign) continue;
    const d = document.createElement("div");
    d.className = "ed" + (id === chosen ? " sel" : ""); d.dataset.ed = id;
    d.innerHTML = `<canvas></canvas><span class="ed-nm">${esc(ed.name)}</span>`;
    edBox.appendChild(d);
    const prev = await mintCard({ edition: id, label: "First card", holder: state.holder });
    renderFace($("canvas", d), prev);
    $(".ob-kappa", ob).textContent = "κ " + prev.kappa;
    d.onclick = () => { chosen = id; $$(".ed", edBox).forEach((x) => x.classList.toggle("sel", x === d)); };
  }
  await new Promise((done) => {
    ob.querySelector("[data-skip]").onclick = () => done();
    $("#ob-mint").onclick = async () => {
      let address = "";
      if (state.walletLive) { try { const a = await bounded(wallet.requestAddress("ethereum"), 8000); address = a?.address || (typeof a === "string" ? a : ""); } catch {} }
      const card = await mintCard({ chain: "ethereum", address, label: "First card", edition: chosen, holder: state.holder });
      state.cards.push(card); store.write({ cards: state.cards });
      done();
    };
  });
  finish();

  function finish() { store.write({ onboarded: true }); ob.hidden = true; ob.innerHTML = ""; renderHome(); }
}

/* ── wire + boot ──────────────────────────────────────────────────── */
$$("#tabs button").forEach((b) => (b.onclick = () => showScreen(b.dataset.scr)));
$("#stats-ic").onclick = () => showScreen("stats");
$("#accounts-pill").onclick = (e) => {
  const acc = $("#accounts"); acc.hidden = !acc.hidden;
  e.target.setAttribute("aria-expanded", String(!acc.hidden));
};
$("#avatar").onclick = detailsSheet;
$$(".quick button").forEach((b) => (b.onclick = () => {
  ({ add: addMoneySheet, move: moveSheet, details: detailsSheet, more: () => showScreen("pay") })[b.dataset.act]?.();
}));
$("#card-add").onclick = () => openSheet((el) => mintFlow(el, { holder: state.holder, onDone: () => { closeSheet(); renderCards(); } }));
$("#pay-send").onclick = () => paySheet("send");
$("#pay-request").onclick = () => paySheet("request");
addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });

state.holder = store.read().holder || "";
renderHome(); renderTxs();
if (KIND === "pay" || KIND === "request") paySheet(KIND === "pay" ? "send" : "request");
if (KIND === "card") showScreen("cards");
maybeOnboard();
readWallet();
publishContext();
$("#app").removeAttribute("aria-busy");
