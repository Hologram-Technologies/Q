// holo-transport-tier.mjs — the ONE honest report of how data ACTUALLY travels right now (bare-metal P3).
//
// The serverless goal: device-to-device, no bound server, no cloud relay on the default path. This names the
// ACTIVE transport so the P0 ruler + Q.health tell the truth (not just capability):
//   p2p             — a direct device↔device link (WebRTC DataChannel / holo-dial). Serverless. ✓
//   loopback        — same-device local (BroadcastChannel cross-tab). No server, not cross-device.
//   relay           — routed through a coordinator/TURN/signal server. NOT serverless (a server is in the path).
//   localhost-bridge— an on-device daemon bound to 127.0.0.1 (e.g. a messenger connector). NOT serverless.
//   unknown         — not yet classified.
// CAPABILITY lives in holo-fidelity.tiers(); THIS is what's live. Pure + dependency-free (node + browser).

export function classifyEndpoint(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return "unknown";
  if (/^(rtc|webrtc|datachannel)/.test(u) || u.includes("rtcdatachannel")) return "p2p";
  if (/(127\.0\.0\.1|localhost|\[::1\]):\d+/.test(u)) return "localhost-bridge";   // a bound local daemon = a server
  if (/(turn:|coturn|relay|rendezvous|\/signal)/.test(u)) return "relay";
  if (/^broadcast:|broadcastchannel/.test(u)) return "loopback";
  return "unknown";
}

// serverless(tier) — is this transport free of any server in the path? p2p + loopback = yes; relay +
// localhost-bridge = no (a bound server sits between the peers).
export function serverless(tier) { return tier === "p2p" || tier === "loopback"; }

// reportTransport({ tier, via, platform }) — merge-publish the ACTIVE transport to window.__holoTransport so the
// honesty channel names it. Fully guarded; a report never throws and never changes behavior.
export function reportTransport({ tier, via = null, platform = null } = {}) {
  const t = tier || "unknown";
  const info = { tier: t, via, platform, serverless: serverless(t) };
  try { if (typeof window !== "undefined") window.__holoTransport = Object.assign(window.__holoTransport || {}, info); } catch (e) {}
  return info;
}

export default { classifyEndpoint, serverless, reportTransport };
