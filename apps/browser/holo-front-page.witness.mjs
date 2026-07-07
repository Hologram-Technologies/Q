// holo-front-page.witness.mjs — the Lens derives DETERMINISTICALLY, with ZERO network, from a fixed
// fixture: same graph + same hour → same page (same κ); a different hour → a different page; the
// network is poisoned for the whole run so any fetch inside derive is a loud failure, not a maybe.
//   node holo-front-page.witness.mjs
import { deriveFrontPage, foldHistory } from "./_shared/holo-front-page.mjs";
import { createHash } from "node:crypto";

let fails = 0;
const ok = (name, cond) => { console.log((cond ? "  ✓ " : "  ✗ ") + name); if (!cond) fails++; };
const kappa = (s) => createHash("sha256").update(s).digest("hex");

// poison the network — a derive that touches it fails the witness, not just the vibe (zero-egress BY PROOF)
globalThis.fetch = () => { throw new Error("WITNESS: derive touched the network"); };

// fixture: a week of synthetic visits with a morning habit (news at 8), an evening habit (video at 21),
// a frequent site, and something from an hour ago. Anchored at LOCAL NOON of a fixed instant so day
// arithmetic never straddles midnight in any timezone (derive buckets hours via local getHours()).
const H = 36e5, D = 864e5;
const _anchor = new Date(1783400000000); _anchor.setHours(12, 0, 0, 0);
const NOW = _anchor.getTime();                   // fixed — the witness never reads the clock
const at = (daysAgo, hour) => { const d = new Date(NOW - daysAgo * D); d.setHours(hour, 12, 0, 0); return d.getTime(); };
const fx = [];
// habits live 3-7 days back — clear of the 48h "continue" window even at hour 21, so the rhythm row
// (derived after continue, which consumes its tiles first) is what surfaces them. That order is the
// design: where you JUST were beats what you USUALLY open, and no tile repeats across rows.
for (let d = 3; d <= 7; d++) fx.push({ url: "https://news.ycombinator.com/", title: "Hacker News", ts: at(d, 8) });
for (let d = 3; d <= 7; d++) fx.push({ url: "https://www.youtube.com/", title: "YouTube", ts: at(d, 21) });
for (let d = 1; d <= 4; d++) fx.push({ url: "https://en.wikipedia.org/wiki/Hologram", title: "Hologram - Wikipedia", ts: at(d, 14) });
fx.push({ url: "https://github.com/Hologram-Technologies", title: "GitHub", ts: NOW - H / 2 });
fx.push({ url: "holo://abc", title: "not-web", ts: NOW });                    // must be excluded
const apps = [{ url: "/apps/holo-money/index.html", title: "Holo Money" }, { url: "/apps/music/index.html", title: "Holo Music" }];

console.log("holo-front-page witness — the Lens is a pure derivation");

// 1 · deterministic: two derives of the same inputs → identical canonical → identical κ
const a = deriveFrontPage({ history: fx, apps, hour: 8, now: NOW });
const b = deriveFrontPage({ history: fx, apps, hour: 8, now: NOW });
ok("same graph + same hour → same canonical (same κ " + kappa(a.canonical).slice(0, 12) + "…)", a.canonical === b.canonical);

// 2 · the hour is a real input: morning ≠ evening (the rhythm row follows the habit)
const evening = deriveFrontPage({ history: fx, apps, hour: 21, now: NOW });
ok("hour changes the page (κ morning ≠ κ evening)", a.canonical !== evening.canonical);
const rhythmAt = (m, want) => { const r = m.rows.find((x) => x.key === "rhythm"); return !!r && r.tiles[0] && r.tiles[0].url === want; };
ok("8am rhythm leads with the morning habit (HN)", rhythmAt(a, "https://news.ycombinator.com/"));
ok("9pm rhythm leads with the evening habit (YouTube)", rhythmAt(evening, "https://www.youtube.com/"));

// 3 · continue row surfaces where you just were
const cont = a.rows.find((r) => r.key === "continue");
ok("continue row leads with the visit from an hour ago (GitHub)", !!cont && cont.tiles[0].url === "https://github.com/Hologram-Technologies");

// 4 · hygiene: non-web entries never surface; no tile repeats across rows
const all = a.rows.flatMap((r) => r.tiles.map((t) => t.url));
ok("non-http(s) history excluded", !all.some((u) => u.startsWith("holo:")));
ok("no tile appears twice across rows", new Set(all.filter((u) => u.startsWith("http"))).size === all.filter((u) => u.startsWith("http")).length);

// 5 · empty graph: still a page (apps + greeting), never a crash
const cold = deriveFrontPage({ history: [], apps, hour: 8, now: NOW });
ok("cold start derives a page (apps row present)", cold.rows.length === 1 && cold.rows[0].key === "apps");

// 6 · foldHistory stats are what the rows rank on
const folded = foldHistory(fx).find((c) => c.url === "https://news.ycombinator.com/");
ok("fold: visit count + hour histogram", folded.visits === 5 && folded.hours[8] === 5);

console.log(fails === 0 ? "\nALL GREEN — the front page is a deterministic, zero-network derivation." : "\n" + fails + " FAILED");
process.exit(fails ? 1 : 0);
