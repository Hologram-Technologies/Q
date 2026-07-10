# HOLO FLOW — SCORECARD (flow-verify, 2026-07-10)

`node apps/player/holo-flow-verify.mjs [--base url] [--minutes N] [--mobile] [--skip-voice]`
Run: canonical bytes (index κ sha256:0e6c8181…), desktop profile, 2-min quick leg, voice skipped (headless).

| Leg | Result | Number |
|---|---|---|
| K0 cards vs current bytes | ✓ | 8/8 |
| F2 sequencer | ✓ | 9/9 |
| Channel starts (greeting + one press) | ✓ | "Afternoon, Witness — your channel is ready" |
| Unattended flow | ✓ | 5 items · 3 kinds (live, film, audiobook) · **0 menus** |
| Media-to-media handoff gap | ✓ | **median 206ms** (gate < 700ms) · n=1 |
| Verbs (why · mood · next · fuzzy-play · stop · start) | ✓ | 6/6 |
| Taste drift (vetoes recorded) | ✓ | skips → stats |
| Voice HD warm | SKIPPED (flagged, never silent) | audible check = human, real device |
| Privacy spy (payload-aware) | ✓ | **0 personal-signal egress** (content-API hosts logged, non-fatal) |

**Bugs the witness caught and killed (fix-forward):**
1. A game item in standalone flow NAVIGATED away (launch fallback) and destroyed the channel → games now
   join the flow only when the OS space bridge exists (messenger embed); standalone flows films/live/books.
2. Films in flow opened the DETAIL view (a menu — 8 counted in 2 min) instead of playing → in flow, films
   `play()` directly. Zero menus is the law.

**Known-open (honest):** 30-min + mobile + messenger-embed legs exist as flags, not yet run long-form;
voice audible-check is a human step; gap n grows with longer runs; --gate wiring into holo-evicted-publish
is the next increment (W4).
