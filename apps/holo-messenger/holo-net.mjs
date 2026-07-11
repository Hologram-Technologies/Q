// holo-net.mjs — the native-net SPINE, one call: makeSpine(). Everything above this file sees a lean API;
// everything below it is the holospaces browser peer (wasm, `_vendor/native-net/`) — WebRtcLink (serverless
// P2P data channel), the content network (cn_* — κ announce/discover/fetch with verify-on-receipt, Law L5),
// and κ itself. No transport detail leaks upward: holo-direct composes THIS the way it composes holo-seal.
//
//   const spine = await makeSpine();
//   spine.kappa(bytes)                      → κ-label for bytes (the substrate's own addressing)
//   spine.verify(bytes, kappa)              → true iff bytes re-derive to κ (L5 — refuse otherwise)
//   spine.put(bytes) / spine.resolve(κ)     → local κ-store (the store is the memory, L3)
//   spine.announce(κ) / spine.discover()    → tell peers what we hold / what peers hold
//   spine.fetch(κ)                          → Promise<bytes> — from ANY connected peer, verified on receipt
//   const link = await spine.dial({ initiator, signal })   → open a P2P link; `signal` carries the SDP/ICE
//       out of band (N3 welds this to the blind mailbox — sealed offers through holo-dm; NEVER a server we run)
//   link.send(bytes) / link.onFrame(fn) / link.close()     → raw sealed-envelope frames (holo-seal wire)
//
// LEAN: the wasm is fetched ONCE from the app's own sealed image (relative path — no external origin, L1),
// instantiated lazily, shared by every caller (one peer per tab). The module carries more surface than the
// messenger uses (the emulator rides along, ~3 MB); thinning to a net-only build is a later lean pass —
// the API above is already the narrow waist, so that pass changes no caller.

let _spine = null;   // one peer per tab — every caller shares it (and its κ-store and links)

export async function makeSpine({ base = new URL("./_vendor/native-net/", import.meta.url) } = {}) {
  if (_spine) return _spine;
  const glue = await import(new URL("holospaces_web.js", base));
  await glue.default({ module_or_path: new URL("holospaces_web_bg.wasm", base) });   // instantiate — same-origin bytes only
  const console_ = new glue.Console();

  const PUMP_MS = 20;            // cn pump cadence while any link is up — low latency without a busy-loop
  const links = new Set();
  let pumping = null;
  // ONE reader per inbound queue (N7 discovery): WebRtcLink has a single inbound VecDeque, and
  // Console.cn_pump's RX drains it WHOLESALE — running it beside the app's rtc.recv() drain made the two
  // consumers RACE and steal each other's frames (cn frames starved; ~5% of sealed app frames silently
  // eaten). So: the per-link rx drain below is the ONLY consumer, and it DEMUXES by the content-network
  // frame codec (`u32 LE len | u8 kind | payload`, kinds append-only) — cn frames feed Console.cn_inbound,
  // everything else goes to the app's frame handlers. The pump is TX-ONLY via Console.cn_outbound.
  const CN_KINDS = new Set([0x01, 0x02, 0x03, 0x10, 0x20, 0x21]);   // fetch req/ok/404, announce, discover req/res
  const isCnFrame = (f) => f.length >= 5 && CN_KINDS.has(f[4]) &&
    (((f[0] | (f[1] << 8) | (f[2] << 16)) + f[3] * 0x1000000) === f.length - 4);
  const pump = () => {
    // TX only. Frames stay queued until a link is open (cn_pump's own is_open guard, kept); with several
    // links they BROADCAST — honest for ≤ a few links (fetch verifies on receipt; duplicate responses are
    // dropped by the fetcher), named limitation until the substrate grows per-peer wires.
    if (![...links].some((l) => l.open)) return;
    let f;
    try {
      while ((f = console_.cn_outbound()) !== undefined && f !== null) {
        for (const l of links) { if (l.open) { try { l.send(f); } catch {} } }
      }
    } catch {}
  };
  const ensurePump = () => { if (!pumping && links.size) pumping = setInterval(pump, PUMP_MS); };
  const stopPump = () => { if (pumping && !links.size) { clearInterval(pumping); pumping = null; } };

  async function dial({ initiator, signal, stun = null }) {
    // `signal` is the out-of-band channel: { send(obj), on(fn) } — N3 makes this sealed envelopes over the
    // blind mailbox. The spine never sees WHERE signaling travels; it only speaks SDP/ICE JSON through it.
    // `stun` (optional url) adds server-reflexive candidates for NAT traversal — a STUN server sees
    // addresses, never content; omit it and the dial is host-candidates-only (LAN / same machine).
    const rtc = new glue.WebRtcLink(initiator, stun ?? undefined);
    const drainIce = () => { for (const c of rtc.take_ice()) signal.send({ t: "ice", c }); };
    signal.on(async (m) => {
      try {
        if (m.t === "offer" && !initiator) signal.send({ t: "answer", sdp: await rtc.accept_offer(m.sdp) });
        else if (m.t === "answer" && initiator) await rtc.accept_answer(m.sdp);
        else if (m.t === "ice") await rtc.add_ice(m.c);
        drainIce();
      } catch (e) { link._err = String(e); }
    });
    if (initiator) signal.send({ t: "offer", sdp: await rtc.create_offer() });
    const iceTimer = setInterval(drainIce, 50);      // candidates trickle over a few event-loop turns

    const frameHandlers = [];
    const rxTimer = setInterval(() => {              // the ONE inbound consumer: demux cn frames vs app frames
      let f;
      while ((f = rtc.recv()) !== undefined && f !== null) {
        if (isCnFrame(f)) { try { console_.cn_inbound(f); } catch {} }
        else for (const h of frameHandlers) { try { h(f); } catch {} }
      }
    }, PUMP_MS);

    const link = {
      rtc,
      get open() { return rtc.is_open(); },
      send: (bytes) => rtc.send(bytes),
      onFrame: (fn) => frameHandlers.push(fn),
      close: () => { clearInterval(iceTimer); clearInterval(rxTimer); links.delete(link); stopPump(); try { rtc.close(); } catch {} },
    };
    links.add(link); ensurePump();
    // resolve once the channel is open (or fail loudly — a dial that never opens must not hang forever)
    await new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (rtc.is_open()) { clearInterval(iv); res(); }
        else if (Date.now() - t0 > 30000) { clearInterval(iv); link.close(); rej(new Error("dial timeout" + (link._err ? ": " + link._err : ""))); }
      }, 25);
    });
    return link;
  }

  let _fetchChain = Promise.resolve();   // fetch mutex — the Console has one cn_pending slot
  _spine = {
    kappa: (bytes) => glue.kappa(bytes),
    verify: (bytes, kappa) => { try { return glue.verify_kappa(bytes, kappa) === true; } catch { return false; } },
    put: (bytes) => console_.cn_put(bytes),
    resolve: (kappa) => console_.resolve(kappa),
    announce: (kappa) => console_.cn_announce(kappa),
    discover: () => JSON.parse(console_.cn_discover() || "[]"),
    // κ-fetch from any peer; verified on receipt inside the peer. The Console carries ONE in-flight
    // fetch (cn_fetch_start overwrites cn_pending) — so fetches SERIALIZE here; a caller never corrupts
    // another's fetch, it just waits its turn.
    fetch: (kappa, { timeoutMs = 15000 } = {}) => {
      const run = async () => {
        console_.cn_fetch_start(kappa);
        const t0 = Date.now();
        for (;;) {
          const r = console_.cn_fetch_poll();
          if (r !== undefined && r !== null) return r;
          if (Date.now() - t0 > timeoutMs) throw new Error("κ-fetch timeout: " + kappa.slice(0, 16));
          await new Promise((res) => setTimeout(res, PUMP_MS));
        }
      };
      const p = _fetchChain.then(run, run);
      _fetchChain = p.then(() => {}, () => {});
      return p;
    },
    dial,
    _console: console_,   // escape hatch for witnesses; app code uses the surface above
  };
  return _spine;
}
