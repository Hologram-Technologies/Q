// holo-copresence.mjs — TOGETHER: multiple people in one holospace, live. The magical layer over the
// existing sealed peer mesh (holo-sealed-neighbourhood · holo-rendezvous · holo-together-relay): a live
// ROSTER of who's here, everyone's CURSOR and NAVIGATION in real time, and a HOST who can MONITOR and KICK
// anyone instantly. It invents no transport — it rides the E2E DataChannel's { broadcast, sendTo, onMessage,
// onPeer, close } seam. Kick is REVOCATION BY RE-ADDRESSING (Law L1): the host re-keys the remaining peers
// and severs the kicked one, whose old key is dead — out at once, cannot read new bytes, cannot rejoin.
//
// Pure + isomorphic + transport-injected (browser mesh in prod, a mock in the witness). The space's κ is the
// room; a member is a κ identity (the device authenticator); presence from a non-member κ is dropped.
//
//   makeCopresence({ self, transport, host, now, timeoutMs }) →
//     { start, stop, moveCursor(x,y), navigate(view), roster(), onChange(cb), kick(id) }
//   transport (from the sealed neighbourhood): broadcast(msg) · sendTo(id,msg) · onMessage((id,msg)=>) ·
//     onPeer((id,'up'|'down')=>) · close(id) · rekey(secret)   (rekey optional; host-only path)

const HEARTBEAT_MS = 4000;   // presence ping cadence
const TIMEOUT_MS = 12000;    // no ping in this long → gone

export function makeCopresence({ self, transport, host = false, now = () => Date.now(), timeoutMs = TIMEOUT_MS } = {}) {
  if (!self || !self.id) throw new Error("copresence: self.id (a κ identity) is required");
  const peers = new Map();                    // id → { id, name, colour, host, lastSeen, x, y, view }
  const listeners = new Set();
  let hb = null, reaper = null, off = null, offPeer = null, running = false;

  const emit = () => { const r = roster(); for (const cb of listeners) { try { cb(r); } catch {} } };
  const roster = () => [{ ...self, host, me: true }, ...[...peers.values()].map((p) => ({ ...p }))]
    .sort((a, b) => (b.host - a.host) || String(a.id).localeCompare(String(b.id)));

  const touch = (id, patch) => {
    const p = peers.get(id) || { id, name: id.slice(0, 6), colour: colourFor(id), host: false, x: null, y: null, view: null };
    Object.assign(p, patch, { lastSeen: now() });
    peers.set(id, p);
  };

  function onMsg(fromId, msg) {
    if (!msg || typeof msg !== "object" || msg.id !== fromId) return;   // a message's id MUST match its channel (no spoofing another κ)
    switch (msg.t) {
      case "hello": { const isNew = !peers.has(fromId); touch(fromId, { name: msg.name, colour: msg.colour, host: !!msg.host }); if (isNew) transport.sendTo(fromId, selfHello()); emit(); break; }   // reply ONLY to a new peer → the handshake converges
      case "ping":  touch(fromId, {}); break;
      case "cursor": touch(fromId, { x: msg.x, y: msg.y }); emit(); break;
      case "nav":   touch(fromId, { view: msg.view }); emit(); break;
      case "bye":   if (peers.delete(fromId)) emit(); break;
      case "rekey": { const from = peers.get(fromId); if (from && from.host && transport.rekey) transport.rekey(msg.secret); break; }   // host re-addressed the space → migrate to the new key

      case "kick": {                                                     // ONLY the host may kick; verified by role, not a server ACL
        const from = peers.get(fromId);
        if (from && from.host && msg.target === self.id) { stop(); for (const cb of listeners) { try { cb(roster(), { kickedBy: fromId }); } catch {} } }
        else if (from && from.host && peers.delete(msg.target)) emit();
        break;
      }
    }
  }

  const selfHello = () => ({ t: "hello", id: self.id, name: self.name, colour: self.colour, host });

  function start() {
    if (running) return; running = true;
    off = transport.onMessage(onMsg);
    offPeer = transport.onPeer && transport.onPeer((id, dir) => { if (dir === "up") transport.sendTo(id, selfHello()); else if (peers.delete(id)) emit(); });
    transport.broadcast(selfHello());
    hb = setInterval(() => transport.broadcast({ t: "ping", id: self.id }), HEARTBEAT_MS);
    reaper = setInterval(() => { const t = now(); let changed = false; for (const [id, p] of peers) if (t - p.lastSeen > timeoutMs) { peers.delete(id); changed = true; } if (changed) emit(); }, timeoutMs / 2);
  }
  function stop() {
    if (!running) return; running = false;
    try { transport.broadcast({ t: "bye", id: self.id }); } catch {}
    clearInterval(hb); clearInterval(reaper); if (off) off(); if (offPeer) offPeer();
    peers.clear(); emit();
  }

  const moveCursor = (x, y) => running && transport.broadcast({ t: "cursor", id: self.id, x, y });
  const navigate = (view) => running && transport.broadcast({ t: "nav", id: self.id, view });

  // HOST ONLY — remove a participant in real time. Revoke = re-address: sever their channel, then re-key the
  // rest so the removed peer's old key is dead. Without transport.rekey it still severs + tells peers to drop.
  function kick(id) {
    if (!host) throw new Error("copresence: only the host can kick");
    if (id === self.id) return;
    transport.broadcast({ t: "kick", id: self.id, target: id });        // tell everyone to drop them (authenticated: sender is host)
    try { transport.close(id); } catch {}                               // sever the kicked peer's channel
    if (transport.rekey) { const secret = randSecret(); for (const pid of peers.keys()) if (pid !== id) transport.sendTo(pid, { t: "rekey", id: self.id, secret }); transport.rekey(secret); }
    if (peers.delete(id)) emit();
  }

  const onChange = (cb) => { listeners.add(cb); cb(roster()); return () => listeners.delete(cb); };
  return { start, stop, moveCursor, navigate, roster, onChange, kick };
}

// deterministic, pleasant per-identity colour (HSL from the κ) — same κ → same colour everywhere (Law L2)
export function colourFor(id) { let h = 0; const s = String(id); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return `hsl(${h % 360} 70% 62%)`; }
function randSecret() { const u = globalThis.crypto.getRandomValues(new Uint8Array(16)); return Array.from(u, (b) => b.toString(16).padStart(2, "0")).join(""); }

export default { makeCopresence, colourFor };
