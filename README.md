<div align="center">

# Q

### The universal resolver

Paste any name and it opens. Drop any file and it becomes a link that carries the file itself.
It runs entirely in your browser — no server, no account, nothing to install.

[**Open Q →**](https://hologram-technologies.github.io/Q)

</div>

---

Q identifies everything by what it **is**, not where it lives. When you open something, Q streams it
from wherever it can, checks it against its own fingerprint, and shows it only if the bytes match.
Nothing loads unverified — so Q never has to trust any single server to be online, or honest.

- **Open anything** — a name, a file, or a link resolves in place, in real time.
- **Every app streams in** — nothing is installed; each app arrives on demand and runs in its own isolated space.
- **Share without a host** — any file becomes a self-contained link that arrives, verified, on any device.
- **Always current** — the engine lives upstream; every improvement reaches every experience the moment it ships, with nothing to update.

## How it fits together

Three layers, one idea — **everything is a verifiable object:**

| Layer | What it is | Where |
|-------|-----------|-------|
| **Resolver** | reads any name as an object, resolves, verifies, renders | this project · served from [`main`](https://github.com/Hologram-Technologies/Q/tree/main) |
| **Apps** | the surfaces, streamed on demand as objects | [hologram-apps](https://github.com/Hologram-Technologies/hologram-apps) |
| **Engine** | the runtime that resolves and verifies, updated upstream | [holospaces](https://github.com/Hologram-Technologies/holospaces) |

Read more in [`system/`](system/) — the [architecture](system/architecture.md), the [five laws](system/laws.md)
it holds to, and [how it builds and ships](system/build.md).

<sub>MIT licensed · <a href="https://github.com/Hologram-Technologies/Q/tree/main"><code>main</code></a> is the running resolver.</sub>
