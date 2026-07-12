# Build & ship

This repository is organized like the system it serves: a **clean cover** you read, and a **running
artifact** you don't.

| Branch | Role |
|--------|------|
| **`home`** (this one) | the cover — what the repo shows: the README and this `system/` guide |
| **`main`** | the running resolver — the built, signed tree GitHub Pages serves |

Keeping them apart is the same move the system makes everywhere: **what you show is separate from where it
runs.** The cover stays clean; the served tree is free to be a flat machine artifact.

## The running tree (`main`)

`main` is a build output, not hand-written source. It is a flat, content-addressed tree with a signed
record of exactly what each release contains — every byte re-derives to its fingerprint, or it doesn't ship.
Browse it if you like; it's meant for the browser, not the eye.

## Publishing

Releases go out through one gated command that reseals, re-signs, proves the desktop still paints in a real
browser, and only then flips the live pointer. A build the resolver won't render cannot ship. The origin is
untrusted plumbing: the service worker can rebuild the whole surface from the content store if a byte is
missing.

## The source

The human-facing source of the operating system lives with the engine, in
[holospaces](https://github.com/Hologram-Technologies/holospaces). This repository is the resolver that
serves it.
