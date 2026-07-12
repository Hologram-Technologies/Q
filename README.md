# Q

**The universal resolver.** &nbsp; [Open it →](https://hologram-technologies.github.io/Q)

This branch *is* the resolver — the whole tree GitHub Pages serves. Everything here is identified by
**what it is** (a fingerprint of its bytes), never **where it lives**. Ask for something and Q streams it
from wherever it can, checks it against its fingerprint, and shows it only if the bytes match. Nothing
loads unverified — so Q never has to trust any single server to be online, or honest.

## What's in the tree

| Path | What it is |
|------|------------|
| `index.html` | the front door — reads any name or link as an object and resolves it |
| `apps/` | the surfaces (messenger, files, games…) — most stream on demand from [hologram-apps](https://github.com/Hologram-Technologies/hologram-apps) |
| `b/` | the content store — every file named by its own fingerprint |
| `usr/` · `_shared/` · `sbin/` | the runtime that resolves and verifies |
| `vendor/` | third-party libraries |
| `release.json` · `os-closure.json` | the signed record of exactly what this release contains |

## How it holds together

- **Content, not location.** The URL names an object; the resolver opens it. No server is trusted.
- **Verify by re-derivation.** Every byte — an app, the runtime, a file you drop — is refused unless it
  re-derives to the fingerprint asked for. Untrusted infrastructure is therefore free capacity.
- **Nothing to install.** Runs in any modern browser, mobile or desktop — no backend, no account.

## Run it

Serve this tree from any static host (GitHub Pages works as-is, root or subpath). The front door is
`index.html`; the default surface is `apps/holo-messenger/`. Try it without signing in: `?guest=1`.

The engine underneath updates upstream from [holospaces](https://github.com/Hologram-Technologies/holospaces) —
improvements arrive with nothing to update.

<sub>MIT licensed · the canonical entry point lives on the <a href="https://github.com/Hologram-Technologies/Q">home</a> branch.</sub>
