# Q — the universal resolver

**[hologram-technologies.github.io/Q](https://hologram-technologies.github.io/Q)** — a very lean,
very-low-latency, 100% serverless resolver for the κ-addressable substrate. Everything is an object
addressed by its attributes (a BLAKE3 κ), not its location. Paste any name and it resolves; drop any
file and it seals. Runs entirely in your browser — mobile or desktop, no backend, no account.

## Five things to try at the front door
- **Project** — paste a κ and it paints as a live projection, streamed from an untrusted mirror and
  **verified on the GPU** before a pixel shows (the readout tells you: bytes · tier · ms · painted).
- **The bind** — project the same κ again: *0 bytes moved, ~0 ms*. A repeat is a texture bind, not a
  download. This is what content-addressing buys.
- **Seal** — drop any file: it becomes a κ and a link that **carries the file itself** (no host,
  anywhere). Open the link on another device and the bytes arrive verified. `unseal(seal(x)) === x`.
- **Refuse** — the forgery never paints: bytes that don't re-derive to their κ are refused, named, mid
  stream (Law L5 — verify by re-derivation).
- **Instant** — the GPU verifier warms while the page settles, so your first projection is fast, and
  hovering primes the next.

## How it holds together
- **Content, not location (L1).** The URL names an object. The resolver opens it; the default surface
  (Holo Messenger) is itself resolved by its signed κ, not a path.
- **Verify by re-derivation (L5).** Every byte — app, runtime, wallpaper, a file you drop — is refused
  unless it re-derives to the requested κ. Untrusted infrastructure is therefore free capacity.
- **A resolver holds κs, not bytes.** Apps and media stream by κ from a mirror; the runtime is consumed
  by reference from the upstream `holospaces` repo (bump one signed pointer, everything runs the new
  engine). The tree stays lean by a standing gate — it cannot silently regrow.

**Open it:** serve this tree from any static host (GitHub Pages works as-is, root or subpath). The root
is the resolver; the default surface is `apps/holo-messenger/app.html`. Ephemeral tour: `?guest=1`.

## What holds it together
- **κ-verified shell (Law L5).** `apps/holo-messenger/shell-manifest.json` commits the SHA-256 of every
  shell byte. The service worker refuses any byte that does not re-derive to its committed κ, and can
  recover the whole shell from the content-addressed store in `b/` — the origin is untrusted plumbing.
- **Sovereign identity.** Sign-in is your device's authenticator; fail-closed, nothing confidential
  paints before identity. Guest sessions persist nothing.
- **Serverless by construction.** Assembled by dependency-closure inclusion from the Hologram OS tree —
  dev servers, platform bridges, and credentials are structurally absent.
