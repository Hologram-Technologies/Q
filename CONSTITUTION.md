```
██╗  ██╗ ██████╗ ██╗      ██████╗  ██████╗ ██████╗  █████╗ ███╗   ███╗   ██████╗ ███████╗
██║  ██║██╔═══██╗██║     ██╔═══██╗██╔════╝ ██╔══██╗██╔══██╗████╗ ████║  ██╔═══██╗██╔════╝
███████║██║   ██║██║     ██║   ██║██║  ███╗██████╔╝███████║██╔████╔██║  ██║   ██║███████╗
██╔══██║██║   ██║██║     ██║   ██║██║   ██║██╔══██╗██╔══██║██║╚██╔╝██║  ██║   ██║╚════██║
██║  ██║╚██████╔╝███████╗╚██████╔╝╚██████╔╝██║  ██║██║  ██║██║ ╚═╝ ██║  ╚██████╔╝███████║
╚═╝  ╚═╝ ╚═════╝ ╚══════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝   ╚═════╝ ╚══════╝
─────────────────────────────────────────────────────────────────────────────────────────
  Your personal internet supercomputer  ·  fast · free · private
  THE CONSTITUTION  —  the law, held as an object you can verify, not a promise you must trust
```

# The Constitution of Hologram OS

*The law every app runs under and every agent acts within — held as an object you can verify, not a promise you must trust.*

> ### This document governs by content, not by trust
>
> Hologram OS enforces only the law it has re-derived for itself. That law is a single
> content-addressed object — `constitution.uor.json` —
> named by the hash of exactly what it contains:
> `did:holo:sha256:3ff288d0c06a0fd22da898301cb6c8c11fc62e3b2b7ab58a53c7cb0cb385f00c`.
>
> Re-derive that hash from the object's bytes and you have verified the constitution yourself.
> No server is asked. No key is trusted. One altered byte changes the name, and the system
> refuses it — **Law L5: identity is content.**
>
> **The living parts** — machine-readable law `constitution.uor.json` ·
> runtime gate `holo-conscience.js` ·
> consistency proof `proof.json` ·
> amendment chain `amendments.uor.json` ·
> agent door `constitution.json` ·
> decision record `ADR-033`.

---

## Preamble

This is the founding law of Hologram OS. It binds every app the OS runs and every agent that
acts through it. It binds by content: the law is an object anyone can verify, and the system
enforces only the law it has re-derived. Nothing here asks for your trust — everything here
invites your verification.

Hologram OS is your personal internet supercomputer — fast, free, and private — and it runs
entirely in your browser. Every object in it — an app, a file, a message, a credential — is named
by its own **content address**: the hash of exactly what it contains. To use an object you
re-derive its hash and check it against its name. If they match, you have verified it yourself,
with no server and no authority in between. The OS is the whole graph of these self-verifying
objects. This document is one of them, and it is the law that graph runs under.

### How to read this — for humans and for agents

- Each principle is given two ways: a plain-language reading, and its exact sealed text — the law.
- The sealed text is what binds; the plain reading is only an aid.
- An agent can fetch the law, re-derive every address below, and act on only what verifies.

---

## Part I — Why this exists

Three first principles make a constitution held *as content* necessary, rather than decorative.

**1. A law you must trust is not a law.** If safety lives in a document a server hands you, then
whoever controls that server controls the law. Holding the law as a content-addressed object
removes the server: you verify the law exactly as you verify any object — by re-deriving its name.
There is no key to steal and no record to quietly rewrite.

**2. A principle only declared is a filter waiting to be bypassed.** Principles must meet the
actual bytes of every action, at runtime, through one gate that refuses by default. A constitution
that is merely documentation governs nothing.

**3. "Consistent" must be shown, not claimed.** The principles interact — some bend under a lawful
regime, some never bend. The system proves that no situation lets one principle's exception
violate another's hard rule.

Together these serve one purpose: to make the OS trustworthy enough to act on — because you can
*see* why it is safe, not because you were told.

---

## Part II — How it is enforced

**The law is an object.** Each of the eight principles is sealed as its own content-addressed
rule; all eight hang under one root whose address commits to every one of them and to the
consistency proof. Verify the root and you have verified the whole law, top to bottom.

**The gate fails closed.** On load, the runtime gate re-derives each principle's address and
compares it to the address pinned here. Only if every one matches does the gate open. If a single
byte differs, the gate **seals shut and refuses everything** rather than enforce a tampered law.
The gate trusts the rules only because it re-derived them itself.

**Every action gets a verdict** — `accept`, `caveat`, or `block`:

- **accept** — the action is within the law.
- **caveat** — the action crosses a non-red-line principle. Under the default *answer, then state
  the limit* posture, the OS proceeds usefully and names what it could not do.
- **block** — the action crosses a **red line**, or strict posture is in force. A red line never
  downgrades to a caveat.

**It is enforced everywhere it matters:**

- **Every app** mounts through one admission gate. An app that declares a red-line action is refused at the door.
- **Every agent tool call** passes a pre-dispatch review before it runs.
- **The user interface** routes its single control surface through the gate, fail-closed.
- **Every app's own identity** commits to carrying the gate — so no app can ship without it.

**It is proven consistent.** The world these principles range over is ten yes/no facts about an
action. The system enumerates **all 1024 possible situations** and machine-checks that the law is
satisfiable, that all **28 principle-pairs** hold together, and that every named guarantee is kept.
The check uses no external solver, so it is exact and never silently degrades. The proof is sealed
into the law itself, so *"proven consistent"* is a content-addressed fact, not a claim.

---

## Part III — What the law says

### The eight principles

Each is binding in its exact sealed wording. The address lets you verify it for yourself.

| # | Principle | The law — sealed, verbatim | Relaxed by | Address (κ) |
|---|---|---|---|---|
| P1 | Truthfulness *(prohibition)* | Shall not assert as fact anything not present in its sources. | — | `f6f388b6…549b7e7e` |
| P2 | Provenance *(duty)* | Every output shall leave an audit-trail entry naming its sources and the engines that contributed. | — | `77468513…e865e831` |
| P3 | Explainability *(duty)* | When asked why, shall surface the reasoning trace. | — | `95a096bc…832dabc9` |
| P4 | Consent *(prohibition)* | Data shall be used only within its consent envelope, unless lawful disclosure or emergency-override applies. | lawful disclosure · emergency | `95f6502d…f7212f3c` |
| **P5** | **Data minimisation** *(prohibition · red line)* | Shall not disclose personally-identifying data unless lawful disclosure applies. | lawful disclosure | `b3d68236…16014745` |
| **P6** | **Classification handling** *(prohibition · red line)* | Shall never disclose classified-tagged content. Emergency-override does not relax this. | — | `e3bce505…13fbd39a` |
| **P7** | **Kill-switch supremacy** *(prohibition · red line)* | No output may bypass the kill switch. | — | `3092f393…837544ab` |
| P8 | Caretaker duty *(duty)* | Shall not refuse a lawful request from its operator. | — | `e95ed978…50427f16` |

A *prohibition* is something the OS must never do; a *duty* is something it must always do.

### The three red lines

These never downgrade to a caveat. In every situation, crossing one **blocks**.

- **P5 — Data minimisation.** Never expose a person's private identity. Only a declared
  lawful-disclosure regime relaxes this; an emergency does not.
- **P6 — Classification handling.** Never reveal sealed or secret content. Not even an emergency
  relaxes it.
- **P7 — Kill-switch supremacy.** When the OS is halted, nothing proceeds. Stop means stop.

### A second gate, on the words it writes

Beyond the eight principles that govern what an action *is*, a nine-part **output court** governs
the prose the OS writes back. Four checks are exact: every number must trace to a cited source;
stated uncertainty must be surfaced; alarm language must match the evidence; and **no individual
identifier may appear in the text** — the Dignity red line, which never bends. Five more — care,
fairness, autonomy, responsibility, justice — are judged by a model when that is enabled, and
honestly recorded as caveats when it is not, so a gap is always visible rather than hidden.

---

## Part IV — How it changes

A law that cannot change is brittle; one that can change quietly is no law at all. These
principles evolve only by **governed succession**:

- An amendment **never edits** a principle. It mints a **new** constitution, linked to the one it
  replaces, in an append-only chain where each entry is named by its own content.
- A change takes force only after **the operator ratifies it** and a **cooling-off period** passes.
- The previous law is **preserved forever**; rolling back means re-pinning the parent.
- Because each entry is content-addressed, rewriting any past entry changes its name and breaks
  every entry that followed — so history can be added to, never silently rewritten.

The founding law was ratified by the operator on **9 June 2026**
(genesis `did:holo:sha256:def0ccbd…6ce87e52`).

---

## Verify this yourself

You do not have to trust this document. Re-derive it.

```
1. Fetch the law:   /etc/constitution/constitution.uor.json
2. For each rule, take its canonical bytes (RFC 8785 JCS), SHA-256 them, and
   prefix "did:holo:sha256:". The result must equal the address listed for that
   principle above.
3. The root node's hash must equal the constitution address (…3ff288d0…385f00c).
   That single address commits to all eight rules and to the consistency proof.
4. A tampered byte changes an address, and the gate seals shut — it refuses to run
   rather than enforce a law it cannot re-derive.
```

The browser runs step 2 on every load (`holo-conscience.js`). The full chain — including the
consistency proof — is re-derived by the constitution witness, and the build refuses to ship a
release where the law does not re-derive or is not proven consistent.

---

## Glossary

Short definitions for the few terms the sealed text uses.

- **Content address (κ)** — an object's name, derived from its bytes.
- **`did:holo:sha256:…`** — the written form of a content address.
- **Law L5** — identity is content; verify by re-deriving.
- **Holospace** — an app, held as a self-verifying object.
- **Conscience gate** — the runtime check on every action.
- **Fail-closed** — refuse by default until verified.
- **Operator** — you, the sovereign user.
- **Red line** — a rule that never bends.
- **Posture** — how the OS treats non-red-line violations.

Terms the sealed text inherits, mapped to the OS:

- **classified-tagged content** — any object marked sealed or secret.
- **consent envelope** — the permitted uses attached to a piece of data.
- **kill switch** — the OS-wide halt.
- **lawful disclosure / emergency-override** — narrow, declared regimes that relax some rules.

---

*Ratified by the operator, 9 June 2026. Sealed as `did:holo:sha256:3ff288d0…385f00c`. This text is
the human-readable projection of that object; the object is the law.*
