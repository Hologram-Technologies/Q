<div align="center">

# Q

### An operating system that unfolds from a seed.

Open one link. A few hundred bytes verify themselves, re-derive the next stage, and — with nothing
installed, no server, no account — **unfold into a complete operating system, in your browser.**

[ **▶ Boot it** ](https://hologram-technologies.github.io/Q)

<sub>Paste that link into any chat or feed. It boots into existence for whoever opens it.</sub>

</div>

---

There is no download, and no backend. **The link is the software.**

From the very first byte, nothing is trusted by where it lives — only by what it **is**. Each stage is
named by a fingerprint of its own bytes and refuses to run unless it re-derives to that fingerprint. The
seed proves its own genesis; the runtime it unfolds re-derives everything after. Tamper is refused, not
rendered.

- **Self-declaring** — the first bytes read a signed record of what the OS is, and unfold it.
- **Self-verifying** — every stage re-derives to its fingerprint, or nothing runs (from byte one).
- **Serverless** — it runs entirely in the browser, mobile or desktop. Any host is just untrusted capacity.
- **Portable** — one link carries it, anywhere. No install, no account, no origin it depends on.

## Everything is a verifiable object

Three layers, one idea:

| Layer | What it is | Where |
|-------|-----------|-------|
| **Resolver** | reads any name as an object, resolves, verifies, unfolds | this project → [`main`](https://github.com/Hologram-Technologies/Q/tree/main) |
| **Apps** | surfaces streamed on demand as objects | [hologram-apps](https://github.com/Hologram-Technologies/hologram-apps) |
| **Engine** | the runtime that resolves and verifies, updated upstream | [holospaces](https://github.com/Hologram-Technologies/holospaces) |

The story in [`system/`](system/): [**genesis**](system/genesis.md) — how a seed becomes an OS ·
[**architecture**](system/architecture.md) · [**the five laws**](system/laws.md) · [**build**](system/build.md).

<sub>κ-addressable from the first byte · BLAKE3 · 100% serverless · MIT · the running resolver lives on <a href="https://github.com/Hologram-Technologies/Q/tree/main"><code>main</code></a></sub>
