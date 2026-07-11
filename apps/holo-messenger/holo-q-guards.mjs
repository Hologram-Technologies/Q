// holo-q-guards.mjs - RE-EXPORT SHIM (U3a of Q-ONE: the safety spine is UN-FORKED). This file used to be a
// full COPY of the guard spine, and it drifted: the 260-char WhatsApp bubble cap landed in the q/core copy
// while the drawer kept importing this one's old 420-char splitter - a silent, live divergence in the exact
// module whose whole point is "ONE place every Q surface shares, so the gate can prove they sound the same."
// There is now exactly ONE implementation - apps/q/core/holo-q-guards.mjs - and this path re-exports it, so
// every existing import (the messenger app, the witness) keeps working while a future edit lands EVERYWHERE.
export * from "../q/core/holo-q-guards.mjs";
