<div align="center">

# Hologram OS

### A whole computer that unfolds from a link.

Open one link. A few hundred bytes verify themselves, re-derive the next stage, and — with nothing
installed, no server, no account — **unfold into a complete operating system, right in your browser.**

[ **▶ Boot it** ](https://hologram-technologies.github.io/hologram-os)

<sub>Paste that link into any chat or feed. It boots into existence for whoever opens it.</sub>

</div>

---

Most computing is borrowed. The real machine lives in someone else's building, and you get a small
window into it. Hologram OS is the opposite — a computer that is wholly yours, held in a single browser
tab. There is no download and no backend. **The link is the software.**

Nothing here is trusted for where it lives, only for what it **is**. Every part carries a name computed
from its own bytes: resolve the name, recompute it, and if the two match you have checked that part
yourself, with no server standing in between. Change one byte and the name changes and the part refuses
to run. You never have to trust it — you can watch it prove itself, live, in front of you.

- **Self-verifying** — every stage recomputes to its own name, or nothing runs, from the first byte.
- **Serverless** — it runs entirely in your browser, mobile or desktop. Any host is just untrusted capacity.
- **Sovereign** — it is yours. Nothing to sign into, nothing watching, nothing you can't take back.
- **Portable** — one link carries it anywhere. No install, no account, no origin it depends on.

Everything inside is one kind of thing — a verifiable object. Three layers compose them into the OS:

| Layer | What it is | Where it lives |
|-------|-----------|----------------|
| **Resolver** | reads any name as an object — resolves it, verifies it, unfolds it | this repo → [`main`](https://github.com/Hologram-Technologies/hologram-os/tree/main) |
| **Apps** | surfaces streamed on demand, each its own verifiable object | [hologram-apps](https://github.com/Hologram-Technologies/hologram-apps) |
| **Engine** | the browser-native runtime that resolves and verifies, updated upstream | [holospaces](https://github.com/Hologram-Technologies/holospaces) |

The full story lives in [`system/`](system/): [**genesis**](system/genesis.md) — how a seed becomes an
OS · [**architecture**](system/architecture.md) · [**the five laws**](system/laws.md) ·
[**build**](system/build.md).

<sub>Content-addressed from the first byte · BLAKE3 · 100% serverless · MIT · the running resolver lives
on <a href="https://github.com/Hologram-Technologies/hologram-os/tree/main"><code>main</code></a></sub>
