// holo-onion-endpoint.node.mjs — the HOST half of rung 1. Mount this next to the host's /web handler so
// the browser page's hostOnionFetch("/onion?url=…") reaches a real Tor/Arti client running in this process.
//
// Split of concerns: RTC + the exit-peer framing live in the browser page (peer-host.html); the raw SOCKS5
// socket to Arti lives HERE, in the host process, behind one same-origin endpoint. Keeps the browser bundle
// free of node:net and the host free of RTC.
//
// Mount (any node:http server that already serves /web):
//     import { onionRequestHandler } from "./_shared/holo-onion-endpoint.node.mjs";
//     const onion = onionRequestHandler();               // or ({ socksHost, socksPort })
//     // inside your request router:
//     if (url.pathname === "/onion") return onion(req, res);
//
// Requires a running Arti with a SOCKS listener:  arti proxy   (default 127.0.0.1:9150).
// If Arti is down / the onion is unreachable, responds 502 so hostOnionFetch throws and the ladder falls
// past this device to arti-wasm. STATUS: UNVERIFIED in this build env (no Arti daemon here).

import { nodeArtiFetch } from "./holo-onion-arti.node.mjs";

export function onionRequestHandler({ socksHost = "127.0.0.1", socksPort = 9150 } = {}) {
  const onionFetch = nodeArtiFetch({ socksHost, socksPort });
  return async function handle(req, res) {
    try {
      const u = new URL(req.url, "http://host");
      const target = u.searchParams.get("url");
      if (!target) { res.writeHead(400, { "content-type": "text/plain" }); return res.end("missing ?url="); }
      // guard: this endpoint serves ONLY .onion — clearnet stays on /web (never proxy the open web through Tor here)
      const host = target.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].split(":")[0].toLowerCase();
      if (!/^[a-z2-7]{16}\.onion$|^[a-z2-7]{56}\.onion$/i.test(host)) { res.writeHead(400, { "content-type": "text/plain" }); return res.end("not a .onion"); }

      const r = await onionFetch(target);
      const headers = Object.assign({}, r.headers || {});
      headers["x-holo-onion"] = "routed";
      headers["x-holo-onion-verified"] = r.verified ? "1" : "0";
      delete headers["content-length"]; // we set our own from the buffer
      res.writeHead(r.status || 200, headers);
      res.end(Buffer.from(r.bytes));
    } catch (e) {
      // Arti down or onion unreachable → 502 so the caller's hostOnionFetch throws and the ladder falls past.
      res.writeHead(502, { "content-type": "text/plain", "x-holo-onion": "unavailable" });
      res.end("onion route failed: " + (e && e.message || e));
    }
  };
}

export default { onionRequestHandler };
