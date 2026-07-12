# The five laws

The whole system is held to five rules. They are the contract every layer keeps — and the reason
untrusted infrastructure is safe to use.

1. **Content, not location.** A thing is identified by what it is, never by a host, path, or URL.

2. **Canonical form only.** Work on the exact, agreed bytes; hold the fingerprint, not a copy — and settle
   the form once, at the door.

3. **The store is the memory.** The content store *is* the address space; memory is just a cache of it.
   A miss is a lookup; forgetting is cleanup.

4. **Everything through the substrate.** One store, one way to compute, one way to move bytes — no side
   channels. The system is a thin layer over that foundation.

5. **Verify by re-derivation.** Re-compute the fingerprint of every byte you receive before you accept it.
   If it doesn't match, it doesn't load.

These are the laws declared by [holospaces](https://github.com/Hologram-Technologies/holospaces); the
resolver conforms to all five.
