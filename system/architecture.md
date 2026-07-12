# Architecture

One idea runs through everything: **an object is what it is, not where it lives.** Every file, app, and
piece of the engine is named by a fingerprint of its own bytes. Ask for that fingerprint and you can fetch
the bytes from anywhere, then prove they're right by re-computing the fingerprint. Trust the math, not the
source.

That single principle is what makes the system serverless, fast, and self-healing.

## Three layers

**Resolver — this project.** The front door. It reads a URL as an object (a name or a fingerprint), finds
it, verifies it, and renders it. It holds pointers, not bulk: almost nothing is stored here directly.

**Apps — [hologram-apps](https://github.com/Hologram-Technologies/hologram-apps).** Every surface — messenger,
files, games — is an object streamed on demand. Each runs in its own isolated space and is refused unless it
matches its fingerprint. Apps aren't installed; they arrive.

**Engine — [holospaces](https://github.com/Hologram-Technologies/holospaces).** The runtime that does the
resolving and verifying. The resolver *follows* it: when the engine improves upstream, every experience
inherits the improvement on next load, with nothing to re-publish.

## How it unfolds

Open one address and a whole system unfolds from it:

1. **The front door** reads the URL as an object.
2. **The store answers by fingerprint** — from your device's cache first (instant, offline), then the network.
3. **Every byte is re-verified** before it's used. A repeat open moves zero bytes — it's a cache bind, not a download.
4. **The surface paints**, streaming the rest of what it needs the same way.

No step trusts a location. Any host is just untrusted capacity — which is why there doesn't need to be one.

## Why it stays fast and lean

- **Content-addressed** — the second time you open anything, it's already verified and cached: 0 bytes, ~0 ms.
- **Streamed, not bundled** — the resolver ships pointers; bulk arrives only when needed.
- **Verified, not trusted** — no allow-lists or origins to secure. Re-derivation *is* the security, which
  deletes whole categories of code.
