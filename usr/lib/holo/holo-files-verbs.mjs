// holo-files-verbs.mjs — Q's HANDS in Files (Q-Soul Q2): a small typed table of PLANS over the
// engine verbs the user already has. The model (or the bar's intent heuristic) only ever PRODUCES a
// plan; it never touches bytes. Every mutating plan is PREVIEWED before it runs (preview() is pure —
// says exactly what would change), APPLIED through the same engine code paths as manual actions
// (seals, chips, Recycle-Bin semantics all hold), and JOURNALED so undo() can put things back.
//
//   plan   = { verb, targets:[homePath…], dest?, name? }
//   verbs  : move · rename · newFolder · zip · trash · keepOne (dedupe)
//   preview(F, plan) → { ok, title, lines:[…], count } | { ok:false, why }   (NEVER throws)
//   apply(F, plan)   → { ok, done, journal } — journal feeds undo(F, journal)
//
// F = the HoloFiles facade (injected — node-witnessable with a fake). Paths are HOME paths
// ("/home/user/…") only: real device mounts stay manual-first (sacred), Q acts in the sovereign home.

const parentOf = (p) => String(p).replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/home/user";
const nameOf = (p) => String(p).replace(/\/+$/, "").split("/").pop();
const isHome = (p) => String(p || "").startsWith("/home/user/");
export const VERBS = ["move", "rename", "newFolder", "zip", "trash", "keepOne"];

// validate targets exist (via F.list of each parent) — a plan referencing a missing file REFUSES early.
async function stat(F, p) {
  try { const rows = await F.list({ path: parentOf(p), kind: "dir", source: "opfs" }); return rows.find((r) => r.name === nameOf(p)) || null; }
  catch { return null; }
}

export async function preview(F, plan) {
  try {
    const p = plan || {};
    if (!VERBS.includes(p.verb)) return { ok: false, why: "I don't know how to do that here." };
    const targets = (p.targets || []).filter(isHome);
    if (p.verb === "newFolder") {
      if (!p.dest || !p.name) return { ok: false, why: "Needs a place and a name." };
      return { ok: true, title: `New folder “${p.name}”`, lines: [`in ${nameOf(p.dest) || "Home"}`], count: 1 };
    }
    if (!targets.length) return { ok: false, why: "Nothing selected that I can act on here." };
    const found = [];
    for (const t of targets) { const s = await stat(F, t); if (!s) return { ok: false, why: `“${nameOf(t)}” isn't there any more.` }; found.push(s); }
    const names = found.map((f) => f.name);
    const label = names.length <= 3 ? names.join(", ") : `${names.length} items`;
    switch (p.verb) {
      case "move": {
        if (!isHome(p.dest || "")) return { ok: false, why: "Needs a folder to move into." };
        return { ok: true, title: `Move ${label}`, lines: [`→ ${nameOf(p.dest)}`], count: names.length };
      }
      case "rename": {
        if (names.length !== 1 || !p.name) return { ok: false, why: "Rename works on one item." };
        return { ok: true, title: `Rename “${names[0]}”`, lines: [`→ “${p.name}”`], count: 1 };
      }
      case "zip": return { ok: true, title: `Compress ${label}`, lines: [`→ ${(p.name || nameOf(targets[0]) || "archive")}.zip`], count: names.length };
      case "trash": return { ok: true, title: `Move ${label} to the Recycle Bin`, lines: ["you can restore it any time"], count: names.length };
      case "keepOne": {
        if (names.length < 2) return { ok: false, why: "Only one copy — nothing to tidy." };
        return { ok: true, title: `Keep “${names[0]}”`, lines: [`the other ${names.length - 1} identical ${names.length - 1 === 1 ? "copy goes" : "copies go"} to the Recycle Bin`], count: names.length - 1 };
      }
    }
    return { ok: false, why: "I don't know how to do that here." };
  } catch (e) { return { ok: false, why: "Couldn't check that: " + (e.message || e) }; }
}

export async function apply(F, plan) {
  const pv = await preview(F, plan);
  if (!pv.ok) return { ok: false, why: pv.why };
  const j = [];   // journal entries {undo:"move"|"restore"|"remove", …}
  try {
    const p = plan, targets = (p.targets || []).filter(isHome);
    switch (p.verb) {
      case "newFolder": await F.mkdir(p.dest, p.name); j.push({ undo: "remove", parent: p.dest, name: p.name }); break;
      case "move": {
        let destPath = p.dest;
        if (p.name) { try { await F.mkdir(p.dest, p.name); j.push({ undo: "remove", parent: p.dest, name: p.name }); destPath = p.dest.replace(/\/$/, "") + "/" + p.name; } catch {} }
        for (const t of targets) { await F.moveHome(t, destPath); j.push({ undo: "move", from: destPath.replace(/\/$/, "") + "/" + nameOf(t), to: parentOf(t) }); }
        break;
      }
      case "rename": { const t = targets[0]; await F.rename(parentOf(t), nameOf(t), p.name); j.push({ undo: "rename", parent: parentOf(t), from: p.name, to: nameOf(t) }); break; }
      case "zip": { const node = await stat(F, targets[0]); await F.compressToZip(node); j.push({ undo: "note", text: "zip created" }); break; }
      case "trash": case "keepOne": {
        const doomed = p.verb === "keepOne" ? targets.slice(1) : targets;
        for (const t of doomed) { const node = await stat(F, t); if (node) { await F.recycle(node); j.push({ undo: "restoreBin", name: nameOf(t) }); } }
        break;
      }
    }
    return { ok: true, done: pv.title, journal: j };
  } catch (e) { return { ok: false, why: "Couldn't finish: " + (e.message || e), journal: j }; }
}

// undo(F, journal) — best-effort exact reversal, newest first. Bin restores go through the bin API.
export async function undo(F, journal) {
  let ok = 0;
  for (const j of [...(journal || [])].reverse()) {
    try {
      if (j.undo === "move") { await F.moveHome(j.from, j.to); ok++; }
      else if (j.undo === "rename") { await F.rename(j.parent, j.from, j.to); ok++; }
      else if (j.undo === "remove") { await F.remove(j.parent, j.name); ok++; }
      else if (j.undo === "restoreBin") { const rows = await F.list({ path: "trash:", kind: "location", source: "trash" }).catch(() => []); const n = rows.find((r) => r.name === j.name); if (n) { await F.restoreTrash(n); ok++; } }
    } catch {}
  }
  return { ok: true, reverted: ok };
}

// ── κ-FACTS (deterministic whisper fuel — no model, ever) ─────────────────────────────────────────
// duplicateGroups(index) → [{hex, paths:[…]}] where 2+ HOME paths share one sha256 (identical κ IS
// identical content — a fact, not a guess).
export function duplicateGroups(index) {
  const by = new Map();
  for (const [path, e] of Object.entries(index || {})) {
    const hex = String((e && e.kappa) || "").split(":").pop();
    if (!/^[0-9a-f]{64}$/.test(hex)) continue;
    if (!by.has(hex)) by.set(hex, []);
    by.get(hex).push(path);
  }
  return [...by.entries()].filter(([, ps]) => ps.length > 1).map(([hex, paths]) => ({ hex, paths: paths.sort() }));
}
