// holo-autofill-origin.witness.mjs — the SOVEREIGN anti-phishing core: Holo Pass fills a saved login
// ONLY at the exact registrable origin. A look-alike (IDN homograph, extra subdomain, typosquat) gets
// NOTHING — the vault is asked getCredential(origin) and returns null for any origin but the real one,
// so the password never enters a phishing page. This is the property that makes "your logins on every
// site" safe. Isomorphic module, tiny DOM shim — no browser, no egress. (SEC-5, SEC-2, L5.)
//   node holo-autofill-origin.witness.mjs
import { installAutofill, findLoginForms } from "../../../holo-os/system/os/usr/lib/holo/holo-autofill.mjs";

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "  ✓ " : "  ✗ ") + name); if (!cond) fails++; };

// ── a minimal DOM: just enough for the autofill engine (querySelectorAll, addEventListener, inputs) ──
function makeInput(attrs = {}) {
  return { tagName: "INPUT", type: attrs.type || "text", name: attrs.name || "", id: attrs.id || "",
    value: "", autocomplete: attrs.autocomplete || "", _attrs: attrs,
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : (k === "autocomplete" ? this.autocomplete : null); },
    setAttribute(k, v) { this._attrs[k] = v; }, dispatchEvent() {}, focus() {},
    get labels() { return []; } };
}
function makeForm(inputs) {
  return { tagName: "FORM", _inputs: inputs,
    querySelectorAll(sel) { return sel === "input" || sel.includes("input") ? inputs : []; },
    addEventListener() {}, removeEventListener() {}, getAttribute() { return null; }, contains() { return true; } };
}
function makeDoc(form) {
  const inputs = form._inputs;
  return { body: form, forms: [form],
    querySelectorAll(sel) { if (sel === "form") return [form]; if (sel.includes("input")) return inputs; return []; },
    addEventListener() {}, removeEventListener() {}, readyState: "complete" };
}
const loginDoc = () => makeDoc(makeForm([
  makeInput({ type: "text", name: "email", autocomplete: "username" }),
  makeInput({ type: "password", name: "password", autocomplete: "current-password" }),
]));

console.log("holo-autofill origin-binding witness — Holo Pass fills only at the exact origin");

// the VAULT (host side): one saved login, bound to the exact real origin. getCredential(origin) is the
// only door to the secret — it returns null for ANY origin that is not the exact match (fail-closed).
const REAL = "https://accounts.example.com";
const VAULT = { [REAL]: { username: "ilya@uor.example", secret: "correct-horse-battery-staple" } };
let stepUps = 0;
async function getCredential(origin) {
  // in production this is behind the biometric step-up gate; here we count the gate + do exact match.
  stepUps++;
  return VAULT[origin] || null;   // EXACT origin only — no normalization, no suffix match, no wildcard
}

// 1 · the engine finds the login form
ok("finds a login form (user + password)", findLoginForms(loginDoc()).length === 1);

// 2 · REAL origin → filled from the vault
{
  const doc = loginDoc(); installAutofill({ doc, origin: REAL, getCredential });
  await new Promise((r) => setTimeout(r, 10));
  const pass = doc.forms[0]._inputs.find((i) => i.type === "password");
  const user = doc.forms[0]._inputs.find((i) => i.type === "text");
  ok("real origin → password + username filled", pass.value === VAULT[REAL].secret && user.value === VAULT[REAL].username);
}

// 3 · LOOK-ALIKES → nothing filled, secret never touches the page (the whole point)
for (const bad of [
  "https://accounts.exampIe.com",         // capital-I homograph
  "https://accounts.example.com.evil.co",  // suffix trick
  "https://accounts-example.com",          // hyphen typosquat
  "http://accounts.example.com",           // scheme downgrade
  "https://login.example.com",             // sibling subdomain not saved
]) {
  const doc = loginDoc(); installAutofill({ doc, origin: bad, getCredential });
  await new Promise((r) => setTimeout(r, 10));
  const pass = doc.forms[0]._inputs.find((i) => i.type === "password");
  ok("look-alike inert: " + bad.replace("https://", "").replace("http://", "http:"), pass.value === "");
}

// 4 · a signup form (two password fields) is NOT auto-filled (never inject into account creation)
{
  const signup = makeDoc(makeForm([
    makeInput({ type: "text", name: "email" }),
    makeInput({ type: "password", name: "password" }),
    makeInput({ type: "password", name: "confirm" }),
  ]));
  ok("signup form (2 passwords) is not treated as a login", findLoginForms(signup).length === 0);
}

// 5 · guest / no vault → getCredential returns null everywhere → nothing fills (fail-closed)
{
  const doc = loginDoc(); installAutofill({ doc, origin: REAL, getCredential: async () => null });
  await new Promise((r) => setTimeout(r, 10));
  const pass = doc.forms[0]._inputs.find((i) => i.type === "password");
  ok("no vault (guest) → nothing filled, fail-closed", pass.value === "");
}

console.log(fails === 0 ? "\nALL GREEN — the password fills only at the exact origin; every look-alike is inert." : "\n" + fails + " FAILED");
process.exit(fails ? 1 : 0);
