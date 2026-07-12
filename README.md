# Q — the universal resolver

### → **[hologram-technologies.github.io/Q](https://hologram-technologies.github.io/Q)**

Paste any name and it resolves. Drop any file and it seals. Everything is an object addressed by its
attributes — a BLAKE3 κ — not its location. Runs entirely in your browser: no backend, no account,
mobile or desktop. Untrusted infrastructure is free capacity, because every byte is refused unless it
re-derives to the κ you asked for (Law L5).

That link **is** the product. This page is the door; the machine reads the URL as an object and opens it.

---

**Where things live** — a resolver holds κs, not bytes, so this branch is deliberately empty:

- **The OS tree** — the resolver runtime, the signed release chain, the default surface — is on the
  [`main`](https://github.com/Hologram-Technologies/Q/tree/main) branch. GitHub Pages serves it; the
  root there is the resolver.
- **The apps** stream by κ from [`hologram-apps`](https://github.com/Hologram-Technologies/hologram-apps),
  each rendered in its own isolated holospace, verified-or-refused mid-stream.

Serve `main` from any static host and it runs as-is (GitHub Pages, root or subpath). The default surface
is `apps/holo-messenger/app.html`; an ephemeral tour is `?guest=1`.

MIT licensed.
