// holo-sovereign.witness.mjs — the broker's guarantees, proven headless (no DOM, no biometric).
// The properties that make "your logins on every site" SAFE: exact-origin reveal, fail-closed on guest,
// and capability isolation (a look-alike can't reuse a saved login; a page-declared origin can't spoof).
//   node holo-sovereign.witness.mjs
import { makeBroker, makeLocalStore, sameOrigin } from "./_shared/holo-sovereign.mjs";

let fails = 0;
const ok = (n, c) => { console.log((c ? "  ✓ " : "  ✗ ") + n); if (!c) fails++; };

// in-memory store (no localStorage in node)
function memStore() { const m = new Map(); return { kind: "local",
  async get(o){ const k = new URL(o).origin; return m.get(k) || null; },
  async put(o,c){ m.set(new URL(o).origin, { username:c.username, secret:c.secret, totp:c.totp||null }); },
  async list(){ return [...m.keys()].map(o=>({origin:o})); }, async has(){ return m.size>0; } }; }

const REAL = "https://securebank.example";
const FAKE = "https://securebank.example.evil.com";     // different host — a look-alike
const store = memStore();
let stepUps = 0;
const stepUp = async () => { stepUps++; return true; };

console.log("holo-sovereign broker witness");

// 0 · sameOrigin is exact (scheme+host), not a suffix/normalization match
ok("sameOrigin: exact match true", sameOrigin(REAL + "/login", REAL + "/account"));
ok("sameOrigin: look-alike false", !sameOrigin(REAL, FAKE));
ok("sameOrigin: scheme downgrade false", !sameOrigin("https://a.com", "http://a.com"));

// 1 · save a login at REAL, then fill REAL → the credential, behind a step-up
{
  const b = makeBroker({ store, operator: "op1", stepUp, hostOrigin: () => REAL });
  const s = await b.save(REAL, { username: "you@holo.id", secret: "hunter2" });
  ok("save at real origin ok", s.ok);
  const f = await b.fill(REAL);
  ok("fill at real origin returns the credential", f.ok && f.credential.secret === "hunter2");
  ok("fill went through the step-up gate", stepUps >= 1);
}

// 2 · THE MONEY SHOT: a look-alike origin fills NOTHING (SEC-5), even though the vault has the login
{
  const b = makeBroker({ store, operator: "op1", stepUp, hostOrigin: () => FAKE });
  const f = await b.fill(FAKE);
  ok("look-alike origin → refused, no credential", !f.ok && f.refused === "no-login-for-origin");
  ok("look-alike reveal exposes NO secret", !f.credential);
}

// 3 · a page that DECLARES a false origin (spoof) is refused — broker trusts hostOrigin, not the page
{
  const b = makeBroker({ store, operator: "op1", stepUp, hostOrigin: () => FAKE });   // really on FAKE
  const f = await b.fill(REAL);   // page CLAIMS to be REAL
  ok("page-declared origin ≠ host origin → refused (SEC-5 spoof-proof)", !f.ok && f.refused === "origin-mismatch");
}

// 4 · fail-closed: a guest (no operator) never reveals a secret
{
  const b = makeBroker({ store, operator: null, stepUp, hostOrigin: () => REAL });
  const f = await b.fill(REAL);
  ok("guest (no operator) → fill refused, fail-closed", !f.ok && f.refused === "no-identity");
  const p = await b.presentFor(REAL);
  ok("guest presence: seam knows a login exists but operator:false", p.present && p.hasLogin && !p.operator);
}

// 5 · SEC-2: presence (read) never returns the secret — only whether one exists
{
  const b = makeBroker({ store, operator: "op1", stepUp, hostOrigin: () => REAL });
  const p = await b.presentFor(REAL);
  ok("presentFor discloses existence, never the secret", p.hasLogin === true && p.secret === undefined && p.credential === undefined);
}

console.log(fails === 0 ? "\nALL GREEN — reveals only at the exact origin, spoof-proof, fail-closed for guests." : "\n" + fails + " FAILED");
process.exit(fails ? 1 : 0);
