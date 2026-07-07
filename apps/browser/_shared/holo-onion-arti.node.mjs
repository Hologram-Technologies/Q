// holo-onion-arti.node.mjs — PRODUCTION onionFetch for the desktop host (Node/Tauri side of rung 1).
//
// Routes a .onion through a locally-running Tor/Arti SOCKS5 proxy using ONLY Node built-ins (net, tls) —
// zero npm deps, serverless in spirit. socks5h semantics: we send the .onion as a DOMAIN address so the
// PROXY (Arti) resolves + rendezvous-connects it; the host never leaks a DNS lookup. A successful CONNECT
// to a v3 .onion means Tor's rendezvous authenticated the service's ed25519 key — that IS the end-to-end
// verification (the address is the key), so we return verified:true on success.
//
// Wire it into the exit peer:
//     import { serveAsExitPeer } from "./holo-peer-egress.mjs";
//     import { onionExitFetch } from "./holo-onion-exit.mjs";
//     import { nodeArtiFetch } from "./holo-onion-arti.node.mjs";
//     serveAsExitPeer({ identKappa, signal, fetchImpl: onionExitFetch({ onionFetch: nodeArtiFetch() }) });
//
// Requires a running Arti (or tor) with a SOCKS listener (Arti default 127.0.0.1:9150). Run:  arti proxy
// STATUS: UNVERIFIED in this build env (no Arti daemon here). Protocol is RFC-1928 SOCKS5 + HTTP/1.1.

import net from "node:net";
import tls from "node:tls";

const MAX_BODY = 24 * 1024 * 1024; // match holo-peer-egress SEC-8 cap

function socks5Connect({ socksHost, socksPort, host, port }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: socksHost, port: socksPort });
    const fail = (e) => { try { sock.destroy(); } catch {} reject(e instanceof Error ? e : new Error(String(e))); };
    sock.once("error", fail);
    sock.once("connect", () => {
      sock.write(Buffer.from([0x05, 0x01, 0x00])); // VER=5, 1 method, NO-AUTH
      sock.once("data", (m) => {
        if (m[0] !== 0x05 || m[1] !== 0x00) return fail("socks5: no acceptable auth method");
        const h = Buffer.from(host, "ascii");
        const req = Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, h.length]), h, Buffer.from([(port >> 8) & 0xff, port & 0xff])]);
        sock.write(req); // CMD=CONNECT, ATYP=DOMAINNAME → socks5h: proxy resolves the .onion
        sock.once("data", (r) => {
          if (r[0] !== 0x05 || r[1] !== 0x00) return fail("socks5: connect refused (rep=" + (r[1]) + ") — is Arti running + the onion reachable?");
          sock.removeListener("error", fail);
          resolve(sock);
        });
      });
    });
  });
}

function httpOverSocket(socket, { host, path }) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0, headerDone = false, head = "", status = 0, headers = {};
    const onData = (buf) => {
      if (!headerDone) {
        head += buf.toString("latin1");
        const i = head.indexOf("\r\n\r\n");
        if (i >= 0) {
          headerDone = true;
          const raw = head.slice(0, i).split("\r\n");
          status = parseInt((raw[0].split(" ")[1]) || "0", 10);
          for (const line of raw.slice(1)) { const k = line.indexOf(":"); if (k > 0) headers[line.slice(0, k).trim().toLowerCase()] = line.slice(k + 1).trim(); }
          const rest = Buffer.from(head.slice(i + 4), "latin1");
          if (rest.length) { chunks.push(rest); total += rest.length; }
          head = "";
        }
      } else { chunks.push(buf); total += buf.length; }
      if (total > MAX_BODY) { socket.destroy(); reject(new Error("over cap")); }
    };
    socket.on("data", onData);
    socket.once("error", (e) => reject(e));
    socket.once("end", () => resolve({ status, headers, bytes: new Uint8Array(Buffer.concat(chunks, total)) }));
    socket.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: Hologram/onion\r\nAccept: */*\r\n\r\n`);
  });
}

// nodeArtiFetch({ socksHost, socksPort }) → onionFetch(url) → { status, headers, bytes, verified }
export function nodeArtiFetch({ socksHost = "127.0.0.1", socksPort = 9150 } = {}) {
  return async function onionFetch(url) {
    const u = new URL(/^https?:\/\//i.test(url) ? url : "http://" + url);
    const https = u.protocol === "https:";
    const port = u.port ? parseInt(u.port, 10) : (https ? 443 : 80);
    const path = u.pathname + u.search || "/";
    let socket = await socks5Connect({ socksHost, socksPort, host: u.hostname, port });
    if (https) socket = tls.connect({ socket, servername: u.hostname, rejectUnauthorized: false }); // onion self-auths via rendezvous, not CA
    const res = await httpOverSocket(socket, { host: u.hostname, path });
    // reached the .onion over a Tor circuit → the rendezvous authenticated the ed25519 key (address IS key)
    return { ...res, verified: true };
  };
}

export default { nodeArtiFetch };
