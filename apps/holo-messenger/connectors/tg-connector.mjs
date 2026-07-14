// tg-connector.mjs — the SERVERLESS, in-browser Telegram connector.
//
// Talks straight to Telegram's own DCs over WSS via vendored gramjs (../_vendor/telegram/boot.mjs). No server of
// ours, no native app, no relay. This is the ONE major network a browser can honestly connect: Telegram publishes
// an official open API and sanctions third-party clients. (WhatsApp/Signal/Instagram/iMessage/… are Matrix bridge
// SERVERS in Beeper's model — no browser client — so they ride the on-device native hub instead, never this.)
//
// Our code is a thin ADAPTER: gramjs owns MTProto/auth/updates/media; we map it onto the messenger's
// registerConnector/ingestExternal seam + drive the QR login. PERSISTENCE IS THE APP'S JOB: the login STRING is a
// bearer credential for the whole Telegram account, so the messenger seals it in the TEE-backed vault
// (saveSession/loadSession) — this module never writes it to localStorage and never transmits it anywhere but
// Telegram. Every inbound message still rides ingestExternal → κ (Law L5, verify-before-render). The user's
// "credential" is their own Telegram account, authorized by scanning a QR on their phone — no password is ever
// typed into the page.

const VENDOR = "../_vendor/telegram/boot.mjs";
const APIID_KEY = "holo.tg.apiId", APIHASH_KEY = "holo.tg.apiHash";

// Default Telegram-Web api pair — an APP identity (embedded in every client, not a user secret), fine for build.
// Ship Hologram's OWN registered pair (my.telegram.org) for production to avoid a shared-id flood-wait. A
// sovereignty-minded user may drop their own into localStorage (holo.tg.apiId/apiHash) — an optional override,
// never a required step (that would break "seamless"). The SESSION, not the api_id, is the sensitive value.
const DEFAULT_API_ID = 2496, DEFAULT_API_HASH = "8da85b0d5bfe62527e5b244c209159c3";

let _tg = null;
async function vendor() { if (!_tg) _tg = await import(VENDOR); return _tg; }   // lazy: ~1.9MB, only on Telegram tap

function creds(apiId, apiHash) {
  let id = apiId, hash = apiHash;
  try { id = id || Number(localStorage.getItem(APIID_KEY)) || DEFAULT_API_ID; } catch { id = id || DEFAULT_API_ID; }
  try { hash = hash || localStorage.getItem(APIHASH_KEY) || DEFAULT_API_HASH; } catch { hash = hash || DEFAULT_API_HASH; }
  return { apiId: id, apiHash: hash };
}
function b64url(u8) {
  const B = globalThis.Buffer;
  return B.from(u8).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── T1 — login (QR: seamless + secure; the user authorizes their OWN account on their phone) ─────────────────────
// gramjs owns the whole ceremony (exportLoginToken → poll → importLoginToken → 2FA SRP). `session` is the vaulted
// StringSession the app hands us (empty for a first login). Returns:
//   { client, tg, already, getSession, done? }
//   • already:true  → the vaulted session is still valid → connected, no QR (returning user, ZERO taps)
//   • else          → `done` resolves once the operator scans; `onQr(url)` fires with each rotating tg://login QR
// The app calls getSession() after a successful login and seals the result in the vault.
export async function loginTelegram({ apiId, apiHash, session = "", onQr, onPassword } = {}) {
  const { apiId: id, apiHash: hash } = creds(apiId, apiHash);
  const tg = await vendor();
  const client = new tg.TelegramClient(new tg.sessions.StringSession(session || ""), id, hash, {
    useWSS: true, connectionRetries: 3, deviceModel: "Hologram", systemVersion: "web", appVersion: "1.0", langCode: "en",
  });
  try { client.setLogLevel && client.setLogLevel("none"); } catch {}
  await client.connect();
  const getSession = () => { try { return client.session.save(); } catch { return ""; } };

  let authed = false;
  try { authed = await client.isUserAuthorized(); } catch {}
  if (authed) return { client, tg, already: true, getSession };

  const done = client.signInUserWithQrCode(
    { apiId: id, apiHash: hash },
    {
      qrCode: async (code) => { try { onQr && onQr("tg://login?token=" + b64url(code.token)); } catch {} },
      onError: async (err) => { try { window.__tgErr = String(err); } catch {} return false; },   // false = keep rotating the token
      password: async () => { try { return onPassword ? (await onPassword()) || "" : ""; } catch { return ""; } },   // 2FA cloud password (SRP)
    }
  );
  return { client, tg, done, already: false, getSession };
}

// ── the connector object (registerConnector contract) ────────────────────────────────────────────────────────
// platform-bound; start(api) wires the live update loop; send/sendMedia route outbound. pull() is T2 (dialogs +
// history), fetchMedia is T3 (media on demand), the update handler is T4 (live), send/sendMedia are T5.
export function createTelegramConnector({ client, tg }) {
  let _api = null;
  const entby = new Map();

  const peerId = (e) => { try { return String(e.id || (e.userId ?? e.chatId ?? e.channelId) || ""); } catch { return ""; } };
  const nameOf = (e) => {
    if (!e) return "Telegram";
    if (e.title) return e.title;
    const n = [e.firstName, e.lastName].filter(Boolean).join(" ").trim();
    return n || e.username || ("Telegram " + peerId(e));
  };
  const remember = (e) => { const k = peerId(e); if (k) entby.set(k, e); return k; };

  const ingestMessage = async (msg, entity) => {
    if (!_api || !msg) return;
    const ent = entity || msg.chat || msg.sender || null;
    const key = remember(ent) || String(msg.chatId || msg.peerId || "tg");
    const d = {
      platform: "telegram",
      jid: key,
      chat: nameOf(ent),
      text: msg.message || msg.text || "",
      sentAt: (msg.date ? msg.date * 1000 : Date.now()),
      fromMe: !!msg.out,
      extId: msg.id != null ? String(msg.id) : undefined,
      group: !!(ent && ent.title != null),
    };
    if (msg.media) d.media = { id: d.extId, kind: (msg.photo ? "photo" : msg.document ? "file" : "media"), _tg: true };
    try { _api.ingest(d); } catch {}
  };

  const resolveEntity = async (convoKey, hint) => {
    if (entby.has(convoKey)) return entby.get(convoKey);
    try { const e = await client.getEntity(hint || convoKey); remember(e); return e; } catch { return convoKey; }
  };

  return {
    platform: "telegram",
    label: "Telegram",
    echoes: true,
    _client: client,
    start(api) {
      _api = api;
      try {
        const NewMessage = (tg.events && tg.events.NewMessage) || tg.NewMessage || null;
        if (NewMessage) {
          client.addEventHandler(async (ev) => { try { await ingestMessage(ev.message, ev.message && (ev.message.chat || ev.message.sender)); } catch {} }, new NewMessage({}));
        } else {
          client.addEventHandler(async (update) => {
            try { const m = update && update.message; if (m && (m.message != null || m.media)) await ingestMessage(m, m.chat || m.sender); } catch {}
          });
        }
      } catch {}
    },
    async pull({ dialogs = 40, perChat = 15 } = {}) {
      let n = 0;
      try {
        const ds = await client.getDialogs({ limit: dialogs });
        for (const d of ds) {
          const ent = d.entity; remember(ent);
          const msgs = await client.getMessages(ent, { limit: perChat });
          for (let i = msgs.length - 1; i >= 0; i--) { await ingestMessage(msgs[i], ent); n++; }
        }
      } catch (e) { try { window.__tgPullErr = String(e); } catch {} }
      return n;
    },
    async send({ chat, text }) {
      try { const e = await resolveEntity(chat); await client.sendMessage(e, { message: String(text ?? "") }); return true; } catch { return false; }
    },
    async sendMedia({ chat, file, caption }) {
      try { const e = await resolveEntity(chat); await client.sendFile(e, { file, caption: caption || "" }); return true; } catch { return false; }
    },
    async fetchMedia(extId, convoKey) {
      try { const e = await resolveEntity(convoKey); const msgs = await client.getMessages(e, { ids: [Number(extId)] });
        const m = msgs && msgs[0]; if (!m) return null; const buf = await client.downloadMedia(m, {}); return buf ? new Uint8Array(buf) : null; } catch { return null; }
    },
  };
}
