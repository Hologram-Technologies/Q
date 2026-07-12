# Genesis

An operating system usually needs a server, an installer, or a store. This one needs a link.

Open it, and a few hundred bytes arrive first — **the seed**. Before any of the OS exists, the seed does
one thing: it reads the signed record of what comes next, fetches it, and re-derives its fingerprint. If
the bytes match, it runs them. If they don't, nothing runs — the seed refuses, and says so plainly.

That single act — **re-derive before you run** — repeats all the way down. The stage the seed unfolds
re-derives the next; a service worker re-derives every byte after that. No step trusts *where* a byte came
from; every step trusts only that it **is** what it claims to be. The chain is verified from its first byte
to its last.

So the OS is never *installed*. It **declares and verifies itself into existence** — on whatever device
opened the link, from nothing but content that proves itself.

That is the whole trick, and it is why a link is enough:

- it needs **no server** — the bytes carry their own truth;
- it needs **no install** — it runs where it is opened;
- it needs **no trust in the host** — a poisoned mirror cannot forge a fingerprint;
- and it works the same on **any modern browser, on any device**.

Share the link anywhere and it unfolds the same operating system, verified, for whoever opens it. Content
that proves itself, becoming a computer. That is genesis.
