// discord-activity-adapter.mjs — the DISCORD host adapter for Holo Messenger.
//
// "One runtime, many hosts." The messenger runtime is the SAME modules the native/CEF and web hosts boot
// (holo-messenger-app.mjs et al). This adapter is the thin Discord-Activity host: it establishes the sandbox
// context, neutralizes host-incompatible dependencies, then calls the canonical boot() seam. No fork.
//
// M1 SCOPE — FIRST PAINT. Prove the runtime paints inside a genuine Discord Activity iframe, zero backend we
// operate. Explicitly deferred: network bridges (M3), Discord OAuth identity (M2), multiplayer/participants
// (M4), warm-boot 0-net + media rail. This adapter must NOT depend on any of them.
//
// SANDBOX FACTS (verified 2026-07, Discord Activities):
//   • Strict CSP: inline <script>, eval(), and injected <script> are BLOCKED. Native ESM import() is allowed
//     (same-origin / proxied modules), which is why every load here is a dynamic import — never eval/inject.
//   • Service Workers: NOT supported. We never register one; the runtime is fail-soft without it (OPFS/Cache
//     still work directly for later warm-boot milestones).
//   • WebGPU: present on desktop Discord (Electron/Chromium); may be ABSENT on Android System WebView. The
//     Q-orb fallback ladder (worker→direct-GPU→WebGL→2D) already handles this — we only feature-detect + record.
//   • WASM compile: the one unresolved GO/NO-GO. We probe it here so a real Activity boot doubles as the
//     kill-test; if blocked, the runtime degrades (Q → seed tier) rather than bricking first-paint.

// ── Capability probe — the researcher's {gpu, wasm} kill-test, folded into the real boot. Two facts that
// convert the remaining CONDITIONALs into a firm verdict, captured on the FIRST real-Activity open. ──
async function probeCaps() {
  const caps = { gpu: false, webgl2: false, wasm: null, host: "discord-activity" };
  try { caps.gpu = typeof navigator !== "undefined" && !!navigator.gpu; } catch {}
  try { const c = document.createElement("canvas"); caps.webgl2 = !!c.getContext("webgl2"); } catch {}
  try {
    // Smallest valid module: the 8-byte wasm header (magic + version). If Discord's CSP lacks
    // 'wasm-unsafe-eval', instantiate throws with a CSP error — that's the NO-GO signal for WASM inference.
    await WebAssembly.instantiate(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    caps.wasm = true;
  } catch (e) { caps.wasm = String((e && e.message) || e); }
  try { window.__holoCaps = caps; } catch {}
  const wasmTag = caps.wasm === true ? "GO" : "NO-GO (" + caps.wasm + ")";
  console.log("%cHOLO-CAPS", "background:#5865F2;color:#fff;padding:2px 6px;font-weight:bold",
    "host=discord | gpu=" + caps.gpu + " | webgl2=" + caps.webgl2 + " | wasm=" + wasmTag);
  return caps;
}

// ── ON-DEVICE CAPABILITY BEACON (M2 kill-test, visible WITHOUT devtools) ──────────────────────────────
// A phone in a real Discord Activity has no console. This tiny dismissible pill surfaces the decisive
// verdicts — wasm (the last GO/NO-GO), gpu/webgl2 (which Q-orb tier the device gets), and the live count
// of real-CSP violations. Built with createElement + textContent + programmatic element.style ONLY, which
// is NOT subject to CSP style-src (only markup/inline <style> is) — so the beacon itself never violates CSP.
const _csp = [];   // real CSP violations, surfaced not swallowed
function _onCSP(e) {
  try { _csp.push((e.effectiveDirective || e.violatedDirective || "?") + " ← " + (e.blockedURI || "inline")); renderBeacon(window.__holoCaps); } catch {}
}
try { if (typeof document !== "undefined") document.addEventListener("securitypolicyviolation", _onCSP); } catch {}
try { window.__holoCSP = _csp; } catch {}

function renderBeacon(caps) {
  if (typeof document === "undefined" || !document.body || (typeof window !== "undefined" && window.__holoNoBeacon)) return;
  caps = caps || {};
  let el = document.getElementById("holo-caps-beacon");
  if (!el) {
    el = document.createElement("div"); el.id = "holo-caps-beacon";
    const s = el.style;
    s.position = "fixed"; s.left = "8px"; s.bottom = "8px"; s.zIndex = "2147483600";
    s.font = "11px/1.4 ui-monospace,Menlo,Consolas,monospace"; s.padding = "6px 9px"; s.borderRadius = "8px";
    s.background = "rgba(8,12,20,.82)"; s.color = "#dbe4f2"; s.maxWidth = "78vw"; s.cursor = "pointer";
    s.userSelect = "none"; s.border = "1px solid rgba(125,239,201,.25)"; s.boxShadow = "0 4px 16px rgba(0,0,0,.4)";
    try { s.backdropFilter = "blur(6px)"; } catch {}
    el.title = "Holo capability beacon — tap to dismiss";
    el.addEventListener("click", () => { try { el.remove(); } catch {} });
    document.body.appendChild(el);
  }
  const wasmOk = caps.wasm === true;
  const t = (label, ok) => label + " " + (ok ? "✓" : "✗");
  el.textContent = "Holo · " + t("wasm", wasmOk) + " · " + t("gpu", !!caps.gpu) + " · " + t("webgl2", !!caps.webgl2) +
    " · csp:" + _csp.length + (wasmOk ? "" : " (Q→seed)");
  el.style.borderColor = wasmOk ? "rgba(52,211,166,.45)" : "rgba(255,120,120,.55)";
}

function inDiscordActivity() {
  try {
    return /(^|\.)discordsays\.com$/.test(location.hostname) ||
      new URLSearchParams(location.search).has("frame_id");   // Discord seeds ?frame_id on the Activity URL
  } catch { return false; }
}

// Load + await the Embedded App SDK IF vendored, and complete the ready() handshake so Discord shows our frame
// instead of the loading spinner. Tolerant of absence: the headless verify and any non-Discord open must still
// boot. NO OAuth here — ready() resolves before authorize(); participant/presence (M4) is unauthenticated too.
async function readySDK() {
  const clientId = new URLSearchParams(location.search).get("client_id") ||
    (typeof window !== "undefined" && window.HOLO_DISCORD_CLIENT_ID) || "";
  try {
    const mod = await import("./_vendor/discord/embedded-app-sdk.mjs");
    const DiscordSDK = mod.DiscordSDK || (mod.default && (mod.default.DiscordSDK || mod.default));
    if (typeof DiscordSDK !== "function") throw new Error("no DiscordSDK export (vendor the SDK)");
    const sdk = new DiscordSDK(clientId);
    // Race ready() against a timeout: in a real Activity the handshake resolves fast; in any non-Discord
    // context (headless verify, plain open) there is no parent to answer, so we must not hang the beacon/boot.
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("ready() timeout — no Discord parent")), 5000));
    await Promise.race([sdk.ready(), timeout]);
    try { window.__discordSDK = sdk; } catch {}
    console.log("[discord-adapter] SDK ready — handshake complete");
    return sdk;
  } catch (e) {
    console.warn("[discord-adapter] SDK unavailable — booting host-agnostic:", (e && e.message) || e);
    return null;
  }
}

export async function mountDiscord() {
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");

  // (1) Neutralize host-incompatible deps BEFORE the runtime module evaluates. These globals are read at the
  //     top of holo-messenger-app.mjs, so they MUST be set before its dynamic import below.
  //   • Bridges: localhost:8788-8793 are unreachable from an iframe AND not serverless. Empty map = no bridge
  //     fetches; bridged chats simply show empty. The connect/health/avatar paths already fail-soft on this.
  window.HoloBridges = {};
  //   • Service worker: Discord blocks SW; mark intent (we also simply never import the SW registrar here).
  window.__holoNoSW = true;
  //   • Q model weights: a direct huggingface.co fetch is connect-src-blocked in the Activity. Route the Q
  //     brain's weight stream through the same-origin "/hf" prefix (Discord URL Mapping /hf → huggingface.co).
  //     The Q loader (q/core/loader.js) reads this global to rebase its model origin; unset = direct (native).
  window.HOLO_HF_PROXY = "/hf";

  // (2) Kick the capability probe + the Discord handshake in parallel with nothing blocking on them.
  //     Render the on-device beacon the moment caps resolve — visible even if boot later hangs.
  const capsP = probeCaps().then((c) => { renderBeacon(c); return c; });
  const sdkP = inDiscordActivity() ? readySDK() : Promise.resolve(null);

  // (3) Load the runtime shell in order (side-effect imports set window.HoloMessengerUI before boot needs it),
  //     then the canonical boot seam. Dynamic import() (not static) guarantees window.HoloBridges is already
  //     set when holo-messenger-app.mjs evaluates.
  await import("./_vendor/ui/chat-ui.bundle.js?v=3ef215ca8472");   // → window.HoloMessengerUI
  await import("./messenger-shadcn-ui.mjs");                       // streaming shadcn κ-UI
  const { boot } = await import("./holo-messenger-app.mjs?v=f94eb36f726b");

  // (4) Boot with DEVICE-STABLE identity: pass a resolved null so boot() uses its own device-stable path
  //     (no biometric gate, no Discord OAuth) — the same fail-soft branch app.html takes when the login
  //     module is absent.
  const bootP = boot(root, Promise.resolve(null)).then(() => {
    try { document.body.classList.add("holo-booted"); } catch {}   // fade the splash once the runtime paints
  });

  await Promise.allSettled([capsP, sdkP, bootP]);
  try { renderBeacon(window.__holoCaps); } catch {}   // final refresh (picks up any CSP violations raised during boot)
  return { ok: true, caps: (typeof window !== "undefined" && window.__holoCaps) || null, csp: _csp.slice() };
}

// Auto-mount when loaded as the Activity entry. A verify harness can set window.__holoDiscordManual = true
// before import to drive mountDiscord() itself.
if (typeof window !== "undefined" && !window.__holoDiscordManual) {
  mountDiscord().catch((e) => {
    try {
      const s = document.getElementById("holo-splash");
      if (s) s.innerHTML = "<pre style='color:#f88;padding:16px;white-space:pre-wrap;max-width:90vw'>discord boot error:\n" +
        ((e && e.stack) || e) + "</pre>";
    } catch {}
    console.error("[discord-adapter] fatal:", e);
  });
}
