# HOLO TV G2 — SEAMLESS + Q PRESENT (the channel becomes magical)

> THE CHANNEL is LIVE (G1, Q manifest 8859592): "Evening, Ilya — your channel is ready" → one press →
> the pure sequencer plays your library across kinds; → vetoes; taste learns. But it is mechanical, not
> yet magical: handoffs are plain switches (not gapless crossfades), films and games don't know when they
> end (only books flow on), and Q — the soul of the experience — is still silent inside it. G2 closes
> exactly those three gaps. Nothing new is invented; every seam already exists and is named below.

## North star (one sentence)
An item ends → the next is ALREADY warm → a 400ms crossfade carries one spoken line from Q — "Back to the
lighthouse, chapter four" — and the evening continues without a seam, a menu, or a decision; tap the orb
any time and Q tells you truthfully what's playing, what's next, and why.

## Honest current state (post-G1, all LIVE unless noted)
- `window.HoloFlow{start,stop,next,mood}` + flowbar pill + channelStrip greeting — live, verified.
- `holo-flow.mjs` (pure sequencer, 9/9 witness) + `holo-continue.mjs` (one sealed store + taste) — live.
- **Gap 1 — no end-detection:** books chain via `audio.onended → __flowNext` ✓; films play in the player's
  own video stage (its `ended` event is NOT hooked); games/live are open-ended (need a "next when I say" or
  timed-slot policy).
- **Gap 2 — no prewarm/crossfade:** `flowStep` calls `selectItem(next)` cold. K3's piece cache + K1's art
  cache mean warmth is a few fetches away; nothing does them ahead of time. No visual crossfade.
- **Gap 3 — Q absent in the hub:** no orb, no announcer, no verbs. Seams pinned: brain =
  `apps/q/core/engine.js` `engine()/create()` (same-origin import, TTFT ~302ms claimed ◇); voice =
  `q/core/voice-out.js` (Kokoro ◇); orb pattern = messenger q-summon; intent = `holo-intent-classify.mjs`;
  the player's own mic + phrase grammar (~line 3335). ◇ = verify before depending; text fallback is law.
- **Publish door:** `holo-evicted-publish.mjs` (G0 tool) — blake3 → HF mirror → re-derive → manifest. Works.

## Why this is the highest-value next step
1. **Seamlessness IS the product promise** — "state of flow" fails at every visible seam. The <700ms
   handoff gate is the single most felt metric in the whole vision.
2. **Q's presence converts automation into companionship** — the same transition, silent, feels like a
   playlist; with one spoken line it feels like someone who knows you is hosting your evening.
3. Everything else (learning already works; surface already ships) compounds these two.

## Architecture decisions (decided — don't relitigate)
- **End-detection per kind, honestly:**
  film → hook the player's video `ended` (find the stage `<video>` teardown path in P0; attach once per
  flow item, detach on veto/stop) · book → done ✓ · live/game → OPEN-ENDED by nature: the flowbar gains a
  quiet slot timer ("20 min of news, then onward" — plan-declared, skippable), never a hard cut mid-game;
  a game slot advances only on idle/exit or the timer WITH a 10s "staying?" whisper. Say this in the UI.
- **Prewarm = the K6 pattern, one item deep:** when item N starts, warm N+1: resolve its manifest κ,
  fetch+verify chunk-0 (audio/film), warm its art object-URL, and for games write nothing (they're warm).
  Mobile: exactly ONE prewarmed item (memory law).
- **Crossfade without a compositor rewrite:** a 400ms full-screen fade layer (opacity on a fixed black
  div) bridging teardown→start, with the announcer line spoken OVER it — perceived-gapless even when the
  underlying switch takes ~600ms. Measure real gap via `performance.mark` beacons; the gate is the number,
  not the trick.
- **The announcer is ONE line, garnish, skippable:** template-first ("Next: <title>" / "Back to <title> —
  <why>"), spoken via `voice-out.js` IF reachable (probe in P0; budget: load lazily on flow start, never
  on boot), else a caption on the fade layer. `engine()` may REWRITE the template line (one short call,
  150ms budget, race-with-timeout → template wins) — the brain garnish, never blocking.
- **The orb is q-summon's, not a new one:** dock the messenger orb visual in the hub corner; tap → a
  compact sheet answering from GROUNDED state (current item, plan.why[], up-next) — deterministic answers
  first; brain paraphrase optional. When embedded in the messenger, defer to the real Q drawer
  (`__holoOpenSpace` exists) — never two Qs on screen.
- **Verbs ride the existing mic/search grammar:** add `continue`, `next/skip`, `play <fuzzy index title>`,
  `something <mood>` → `HoloFlow.mood(m)`, `why this?` → plan.why. One verb table, routed through
  `selectItem`/`HoloFlow` — no capability exists twice.

## Milestones
- **P0 — probe (no code):** film-stage `ended` hook point + teardown path; `voice-out.js` speak-one-line
  API + cost; `engine()` in-player load cost (if >2s or >200MB, brain garnish is OFF this milestone —
  say so); orb embed seam. Gate: seam table with refs.
- **P1 — ends + slots:** film `ended` → `__flowNext`; live/game slot timer + "staying?" whisper. Gate:
  a film finishing advances the flow hands-free; a game slot never hard-cuts.
- **P2 — prewarm + crossfade:** warm N+1 (manifest+chunk0+art); fade layer + beacons. Gate: measured
  handoff gap < 700ms median across 10 transitions on the live site (books/films); veto feels instant.
- **P3 — the announcer:** template line on the fade (caption), voice when P0 proved it, brain rewrite
  behind a 150ms race. Gate: narrated transitions add 0ms to the measured gap; voice off → identical flow.
- **P4 — the orb + verbs:** docked orb + grounded sheet; verb table into mic/search. Gate: "why this?"
  cites plan.why verbatim; "play <title>"/"something calmer"/"skip" all work typed; orb absent inside
  the messenger embed (the drawer owns Q there).
- **P5 — witness + ship:** 30-min unattended leg (≥4 items, ≥3 kinds, gaps measured, 0 menus) + privacy
  fetch-spy (0 egress of plan/stats/continue) + K-regressions (κ-rows · verified audio · drop-torrent ·
  flow G1). Ship via `holo-evicted-publish.mjs`. Gate: all green on the LIVE site, phone + desktop.

## Gotchas (scar tissue — heed)
- **Canonical, never dist**; the player is ~4,400 lines — additive edits; regression-check after each.
- **The lean-gate door:** player files ship ONLY via holo-evicted-publish (blake3→HF→re-derive→manifest).
  Never hand-push player bytes to Q.
- **No Date.now()/random in the sequencer** (witness law); hour/seed are inputs at the call site.
- **Two MediaSources during a crossfade** — close the outgoing AFTER the fade; one prewarm on mobile.
- **Voice/brain are garnish**: every gate must pass with them absent; a model never blocks a transition.
- **Autoplay law:** the crossfade must not re-trigger gesture requirements (keep one AudioContext/element
  chain alive across items where possible).
- **Small-library truth** stays in the UI copy; Pages CDN lag > liveVerify → re-poll, trust git.

## Definition of done (the demo)
Live site, evening: press play. A chapter ends — the screen breathes dark for half a second while Q says
"Next: Popeye for President — something new," and the film is already playing. It ends; the news comes on
with "twenty minutes of the world"; → skips it instantly. Tap the orb: "You're watching Popeye — it's the
wildcard slot; next is your book, chapter five." Type "something calmer": the plan visibly reshapes.
Every gap under 700ms measured, zero menus, zero personal bytes leaving the device, and with voice and
brain both disabled the same evening plays identically, silently captioned.

## Scorecard
| Metric | Now (G1) | Target (G2) |
|---|---|---|
| Film end → next | manual | hands-free (ended hook) |
| Live/game slots | open-ended, manual | timed + "staying?" whisper, never hard-cut |
| Handoff gap | unmeasured switch | < 700ms median, beacon-proven |
| Transition voice | none | one line, 0ms gap cost, fallback caption |
| Q in the hub | absent | orb + grounded answers + verbs |
| "why this?" | — | cites the sealed plan verbatim |
| Brain/voice off | — | byte-identical channel |
| Privacy | unproven | fetch-spy 0-egress leg green |
