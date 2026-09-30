// Registry sweep v3 — every 2h: 1 catalog pull (discovery) + a rotating
// detail pull for up to 12 markets (the list endpoint returns null prices —
// only per-market details carry yesPrice/volumeUsdc) -> merge registry
// (firstSeen/lastSeen/meta) + per-market price-history points from detail
// responses (change-only, capped, source-tagged), surgical snapshot.registry
// refresh, push both to GitHub.
// Run by panta_sweep_loop.sh. Reads stay ≥300ms apart (docs default: reads
// 120/min). Quotes are NOT touched here — they live in the daily full pull,
// paced ≤27/min under the 30/min quote default.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const KEY = JSON.parse(readFileSync("wallets/panta.json", "utf8")).pk_live;
const BASE = "https://live-api.panta.market/api/v1";
const DATA = (f) => resolve("panta-copilot/data", f);
const stamp = new Date().toISOString();
const MAXPTS = 240; // ~10 days of change-only points per market
const ENRICH = 12; // detail pulls per sweep (reads family)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const H = { "X-Api-Key": KEY, "Content-Type": "application/json" };
const r = await fetch(`${BASE}/markets/?limit=50`, { headers: H });
if (!r.ok) {
  console.error(`sweep abort: catalog HTTP ${r.status}`);
  process.exit(1);
}
const items = (await r.json()).items || [];
if (!items.length) {
  console.error("sweep abort: empty catalog (guard)");
  process.exit(1);
}

let reg = { firstSeen: {}, lastSeen: {}, meta: {}, history: {}, pulls: 0 };
try {
  reg = JSON.parse(readFileSync(DATA("registry.json"), "utf8"));
} catch {}
reg.meta = reg.meta || {};
reg.history = reg.history || {};
reg.pulls = (reg.pulls || 0) + 1;
let fresh = 0;
for (const m of items) {
  const id = m.marketId;
  if (!reg.firstSeen[id]) {
    reg.firstSeen[id] = stamp;
    fresh++;
  }
  reg.lastSeen[id] = stamp;
  // meta phase from catalog is stale sometimes; keep title sticky (never
  // overwrite a known title with null), refresh cat/end
  reg.meta[id] = {
    cat: m.category ?? (reg.meta[id] && reg.meta[id].cat) ?? null,
    phase: m.phase ?? (reg.meta[id] && reg.meta[id].phase) ?? null,
    end: m.endTime ?? (reg.meta[id] && reg.meta[id].end) ?? null,
    title:
      (m.title || "").slice(0, 90) ||
      (reg.meta[id] && reg.meta[id].title) ||
      null,
  };
}

// ---- detail enrichment: the only reliable price source ----
// prioritize primary-phase (tradable now), then secondary, rotating through
// the rest so every retained market gets a real price observation eventually.
const rank = (id) => {
  const p = reg.meta[id] && reg.meta[id].phase;
  const hasPrice = (reg.history[id] || []).some((x) => x[1] != null);
  if (p === "primary" && !hasPrice) return 0; // never priced primary first
  if (p === "primary") return 1;
  if (p === "secondary" && !hasPrice) return 2;
  if (p === "secondary") return 3;
  return 4;
};
const enrichIds = items
  .map((m) => m.marketId)
  .sort((a, b) => rank(a) - rank(b))
  .slice(0, ENRICH);
let priced = 0;
for (const id of enrichIds) {
  try {
    const d = await fetch(`${BASE}/markets/${id}/`, { headers: H });
    if (d.ok) {
      const j = await d.json();
      const pt = [
        stamp,
        j.yesPrice ?? j.primaryYesPrice ?? null,
        j.noPrice ?? j.primaryNoPrice ?? null,
        j.volumeUsdc ?? null,
        j.phase || null,
        "detail",
      ];
      const h = (reg.history[id] = reg.history[id] || []);
      const last = h[h.length - 1];
      if (
        !last ||
        last[1] !== pt[1] ||
        last[2] !== pt[2] ||
        last[3] !== pt[3] ||
        last[4] !== pt[4]
      )
        h.push(pt);
      if (h.length > MAXPTS) reg.history[id] = h.slice(-MAXPTS);
      if (pt[1] != null) priced++;
      if (j.phase) reg.meta[id].phase = j.phase; // detail wins over catalog
      if (j.title) reg.meta[id].title = String(j.title).slice(0, 90);
    } else {
      console.error(`detail ${id} -> ${d.status}`);
    }
  } catch (e) {
    console.error(`detail ${id} err ${e.message}`);
  }
  await sleep(300);
}
writeFileSync(DATA("registry.json"), JSON.stringify(reg));

// surgical snapshot.registry refresh (market/quote fields stay from last full pull)
let snap = null;
try {
  snap = JSON.parse(readFileSync(DATA("snapshot.json"), "utf8"));
} catch {}
const pricePts = Object.values(reg.history)
  .flat()
  .filter((p) => p[1] != null).length;
if (snap) {
  snap.registry = {
    marketsTracked: Object.keys(reg.firstSeen).length,
    pulls: reg.pulls,
    since: Object.values(reg.firstSeen).sort()[0],
    lastSweepAt: stamp,
    historyPoints: Object.values(reg.history).reduce((a, h) => a + h.length, 0),
    priceObservations: pricePts,
  };
  writeFileSync(DATA("snapshot.json"), JSON.stringify(snap, null, 1));
}

const gh = readFileSync("/home/justin/.git-credentials", "utf8").match(
  /gho_[A-Za-z0-9]+/,
)[0];
const auth = {
  Authorization: `Bearer ${gh}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "panta-sweep",
};
for (const f of ["data/registry.json", "data/snapshot.json"]) {
  const local = resolve("panta-copilot", f);
  const cur = await fetch(
    `https://api.github.com/repos/loveoftheai/panta-copilot/contents/${f}?ref=main`,
    { headers: auth },
  );
  const sha = cur.ok ? (await cur.json()).sha : null;
  const put = await fetch(
    `https://api.github.com/repos/loveoftheai/panta-copilot/contents/${f}`,
    {
      method: "PUT",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `registry sweep: ${Object.keys(reg.firstSeen).length} tracked (+${fresh} new, ${pricePts} price obs) [skip ci]`,
        content: readFileSync(local).toString("base64"),
        sha,
        branch: "main",
      }),
    },
  );
  console.log(put.status, f);
  if (!put.ok) process.exit(1);
  await new Promise((res) => setTimeout(res, 1200));
}
console.log(
  `SWEEP_OK tracked=${Object.keys(reg.firstSeen).length} +${fresh} new priced=${priced}/${ENRICH} priceObs=${pricePts} (pull #${reg.pulls})`,
);
