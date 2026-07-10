# HOLO TV — PROVE THE CHANNEL (flow-verify: the witness that makes the magic un-regressable)

> Everything the vision named is now LIVE: the κ-Home, verified torrent-native bytes, the zero-decision
> channel (one press → flows hands-free), vetoes and moods that teach, spoken handoffs in Kokoro HD,
> verbs for every action. But it is live on FAITH: eight player edits shipped in quick succession, the
> voice has never been heard (headless is mute), real handoff gaps are unmeasured, "zero personal-signal
> egress" is a claim without a spy, mobile is untested, and NOTHING gates the next session from quietly
> breaking any of it. This repo's deepest law is that a thing isn't done until a witness can refuse its
> regression. This milestone builds `flow-verify` — the composite gate — runs it on the LIVE site, fixes
> what it catches, and wires it into the release path so the channel becomes permanent.

## North star (one sentence)
One command (`node holo-flow-verify.mjs --live`) drives the real published channel for 30 unattended
minutes on desktop-and-mobile-sized viewports and returns ONE green/red — covering flow, gaps, voice-warm,
verbs, privacy, offline, and every prior K/G milestone — after which no future publish can silently
regress the channel, because the gate refuses it.

## Why this is the highest-value next step
1. **Trust is the product now.** A magical demo that breaks next Tuesday is a toy. The κ-substrate's whole
   thesis is verify-don't-trust — the EXPERIENCE deserves the same discipline as the bytes.
2. **The repo's own history says so:** every surviving feature here (boot, menus, m1, conformance) is one
   that got a witness + release gate; every regression scar in memory is from a surface that didn't.
3. **It will find real bugs.** Eight rapid live edits + evicted-publish + concurrent sessions — the prior
   (probability of at least one latent break) is high. Finding them NOW, with a harness, is cheap.

## Honest current state (what is claimed vs what is proven)
| Claim (live) | Proven? |
|---|---|
| Channel: press → flows across kinds, ends detected | browser-checked once, per-increment only |
| Handoff gap "<700ms" | plan-step measured (1–2ms); FULL media-to-media gap NEVER measured |
| Kokoro HD announcer, never low-quality | seams verified; NEVER HEARD; warm-time unknown on cold device |
| Verbs (continue/next/why/mood/play <title>) | browser-checked once, desktop only |
| Taste learns / stats | unit-level only |
| Privacy: zero egress of plan/stats/continue | NEVER proven (no fetch-spy run) |
| Offline: browse + replay | κ-rows proven post-K1; NOT re-proven since flow landed |
| Mobile (touch, small viewport, wasm voice) | NEVER tested |
| In-messenger embed (the real front door) | NOT tested since the flow/voice edits |
| Prior gates (K0 cards 8/8 · F2 sequencer 9/9 · K3 stream 6/6) | green, but not re-run against LIVE bytes |

## Architecture decisions (decided — don't relitigate)
- **One driver, Playwright-style, against the LIVE site** (the repo already drives headless Chromium this
  way — reuse that harness pattern, e.g. the mobile-gate/witness-ceremony tooling). Local canonical run is
  the DEV loop; the GATE runs against `https://hologram-technologies.github.io/Q/apps/player/index.html`.
- **Measure the REAL gap:** instrument nothing new — read `window.__flowGaps` AND add one beacon pair in
  the player (media `pause/ended` of item N → first `timeupdate`/frame of item N+1) so the number is
  media-to-media, not plan-to-plan. That beacon is the only feature code this milestone adds.
- **The privacy spy is a wrapped fetch/XHR/sendBeacon** installed before boot: any request whose body or
  URL contains continue/stats/plan payloads (or that leaves the allowed origins list: site + HF mirror +
  archive.org + iptv/logo hosts) while flow runs = RED with the offending URL printed.
- **Voice is witnessed by TELEMETRY, not ears:** assert `loadVoice()` resolves true on a WebGPU desktop
  profile AND a wasm mobile profile, `engine()==="kokoro"`, `speaking` goes true during a handoff, and the
  time-to-first-warm is recorded in the scorecard. (One human listen on a real device stays a checklist
  item — say so, don't fake it.)
- **Composite = additive legs, one verdict:** flow-30min · gaps · voice · verbs · taste-drift · privacy ·
  offline-replay · mobile-viewport · messenger-embed · K/F/G re-runs. Each leg prints its own line; the
  gate is AND. A leg that cannot run in the environment (e.g. true airplane-mode) SAYS SO and substitutes
  the honest nearest proof (fetch-block shim) — no silent skips.
- **Wire the gate into the door:** `holo-evicted-publish.mjs --app player` gains a `--gate` step (on by
  default, `--no-gate` for emergencies, loudly) that runs the fast legs before any manifest push. The
  30-min leg stays manual/nightly. This is how the channel becomes un-regressable in practice.
- **Fix-forward policy:** bugs the witness finds are fixed IN this milestone (they're the milestone's
  yield), each fix re-shipped through the gate it just enabled.

## Milestones
- **W0 — the harness:** the Playwright driver (reuse the repo's existing headless pattern) + the beacon
  pair in the player + the privacy spy + profile matrix (desktop-WebGPU / mobile-wasm 375px).
  Gate: driver runs 3 minutes green locally against canonical.
- **W1 — the legs:** flow-30min (≥4 items · ≥3 kinds · 0 menus · session-dedupe holds) · media-to-media
  gaps (report median/p95) · voice telemetry · all 6 verbs · taste-drift (2 skips → kind demoted in next
  plan) · offline-replay (fetch-shim) · privacy spy. Gate: every leg emits PASS/FAIL + a number.
- **W2 — live + mobile + embed:** the full run against the LIVE site, both profiles, plus the messenger
  embed (`app.html` → tv space → strip present → flow starts). Gate: green, or a fix-list.
- **W3 — fix what it caught:** each finding fixed canonically, re-shipped via the (now-gated) door,
  re-run to green. Gate: LIVE composite green end-to-end.
- **W4 — permanence:** `--gate` wired into holo-evicted-publish (fast legs) + `HOLO-FLOW-SCORECARD.md`
  committed with the measured numbers + memory updated with the one-command recipe.
  Gate: a deliberately-broken canary edit is REFUSED by the gated door, then reverted.

## Deltas (specific)
1. `apps/player/holo-flow-verify.mjs` — the driver + legs (one file, ~300 lines, no new deps).
2. Player: the media-to-media gap beacon pair (only feature code; ~10 lines).
3. `holo-evicted-publish.mjs`: `--gate` (spawns the fast legs; refuses on red).
4. `HOLO-FLOW-SCORECARD.md` — the numbers, committed.
5. Fixes W2/W3 surfaces (unknown by definition — budget the majority of the milestone here).

## Gotchas (scar tissue — heed)
- **Headless lies:** `navigator.gpu` lies headless (memory) — the WebGPU voice leg needs
  `--enable-unsafe-swiftshader` or an honest wasm-only assertion; rAF throttles in background tabs (keep
  the page foregrounded in the driver; the 30-min leg must not sleep the renderer).
- **Autoplay in the driver:** launch with `--autoplay-policy=no-user-gesture-required` for the harness ONLY
  — the production one-tap law stands; assert it separately (flow without gesture starts muted UI).
- **The live SW serves by hash** — after any re-ship, bust caches in the driver (fresh context per run)
  and re-poll the CDN before blaming code (trust git; the lag scar).
- **Concurrent sessions:** snapshot the two published trees (player manifest hex + index κ) at run start
  and print them — a mid-run publish by another session must fail the run LOUDLY as "world moved", not as
  a phantom bug.
- **Live/game slots are 15–20 min** — the 30-min leg must inject short slot overrides (a `?flowTest=1`
  param the player honors ONLY for slot durations; never let test hooks change real behavior otherwise).
- **Canonical, never dist**; player ~4,500 lines, additive edits only; the voice module is SHARED with the
  messenger — do not fork it for the floor-edge; if hardening it, harden it for both.
- **Privacy leg scope:** archive.org/iptv fetches are CONTENT, not personal signals — the spy distinguishes
  by payload, not just host, or it will cry wolf.

## Definition of done
`node apps/player/holo-flow-verify.mjs --live` → thirty unattended minutes later: `FLOW-VERIFY GREEN —
gaps median 412ms p95 640ms · voice kokoro warm 6.2s/18.9s (gpu/wasm) · verbs 6/6 · taste drifts · privacy
0 egress · offline replays · mobile green · embed green · K0 8/8 F2 9/9 K3 6/6` (numbers illustrative —
the real ones go in the scorecard). A sabotage edit is refused by the gated door. The next session that
touches the channel CANNOT ship a regression without deleting the gate in plain sight.

## Scorecard (to be filled by W2's live run)
| Leg | Number | Gate |
|---|---|---|
| Handoff gap media-to-media | median ? / p95 ? ms | median < 700ms |
| Voice warm (gpu / wasm) | ? s / ? s | resolves true, kokoro, speaks |
| 30-min unattended | ? items / ? kinds / ? menus | ≥4 / ≥3 / 0 |
| Verbs | ?/6 | 6/6 |
| Privacy egress | ? requests flagged | 0 |
| Offline replay | ?/2 kinds | 2/2 |
| Mobile 375px | ? | green |
| Messenger embed | ? | green |
| Prior gates vs LIVE bytes | ? | K0 8/8 · F2 9/9 · K3 6/6 |
