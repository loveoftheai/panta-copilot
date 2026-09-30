#!/usr/bin/env node
// Panta snapshot pipeline (credential-free repo copy) — deduped catalog +
// details + quote probes + quote matrix + positions -> data/ (snapshot.json + brief.md)
// Usage: PANTA_API_KEY=pk_live_… node pipeline/panta_snapshot.mjs   (from repo root)
// The live site is refreshed by a scheduled run of this same script.
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";

const BASE = "https://live-api.panta.market/api/v1";
const KEY = process.env.PANTA_API_KEY;
if (!KEY) {
  console.error("set PANTA_API_KEY=pk_live_… (get one from Panta docs)");
  process.exit(1);
}
const OUT = (name) =>
  fileURLToPath(new URL("../data/" + name, import.meta.url));
const H = { "X-Api-Key": KEY, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function jget(path) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(BASE + path, { headers: H });
      if (r.status === 429) {
        await sleep(3000 * (i + 1));
        continue;
      }
      if (!r.ok) {
        console.error(`GET ${path} -> ${r.status}`);
        return null;
      }
      return await r.json();
    } catch (e) {
      console.error(`GET ${path} err ${e.message}`);
      await sleep(2000);
    }
  }
  return null;
}

async function quoteReq(marketId, side, amountUsdc) {
  let rec = { marketId, side, amountUsdc };
  try {
    const r = await fetch(`${BASE}/primaryorderquote/`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({
        wallet: "9KTwcJwYXZnQaVQ3QRDeoK2Mn3zKcthjzsWjwj2subC8",
        marketId,
        side,
        amountUsdc,
      }),
    });
    let b = null;
    try {
      b = await r.json();
    } catch {}
    if (r.ok && b && !b.code) {
      rec.ok = true;
      rec.shares = b.estimatedShares ?? b.shares ?? null;
      rec.avgPrice = b.avgPrice ?? b.averagePrice ?? null;
      rec.feeUsdc = b.feeUsdc ?? null;
    } else {
      rec.ok = false;
      rec.http = r.status;
      rec.error = (b && (b.code || b.message)) || `HTTP ${r.status}`;
    }
  } catch (e) {
    rec.ok = false;
    rec.error = e.message;
  }
  return rec;
}

// 1. catalog — cursor endpoint is broken server-side (nextCursor never advances);
//    limit caps at 50 per response. One pull gets the whole live catalog.
const seen = new Set();
const items = [];
{
  const d = await jget(`/markets/?limit=50`);
  if (d && d.items)
    for (const m of d.items)
      if (!seen.has(m.marketId)) {
        seen.add(m.marketId);
        items.push(m);
      }
}
// guard: never overwrite a good snapshot with an empty pull
if (!items.length) {
  console.error(
    "catalog came back empty — keeping previous snapshot, aborting",
  );
  process.exit(1);
}
console.log(`catalog: ${items.length} unique markets`);

// 1a. persistent registry — Panta's list pages rotate; union every market ever
//     seen across daily pulls so tracked coverage grows instead of resetting.
const stamp = new Date().toISOString();
let registry = { firstSeen: {}, lastSeen: {}, pulls: 0 };
try {
  registry = JSON.parse(readFileSync(OUT("registry.json"), "utf8"));
} catch {}
registry.pulls = (registry.pulls || 0) + 1;
for (const m of items) {
  registry.firstSeen[m.marketId] = registry.firstSeen[m.marketId] || stamp;
  registry.lastSeen[m.marketId] = stamp;
}
const regCount = Object.keys(registry.firstSeen).length;
console.log(
  `registry: ${regCount} markets tracked after ${registry.pulls} pulls`,
);

// 2. details for up to 40 non-cancelled (title/phase/times live from detail endpoint)
const open = items
  .filter((m) => m.phase !== "cancelled" && m.status !== "closed")
  .slice(0, 40);
const details = [];
for (const m of open) {
  const d = await jget(`/markets/${m.marketId}/`);
  if (d) details.push(d);
  await sleep(300);
}
const dseen = new Set();
const uniq = details.filter(
  (d) => !dseen.has(d.marketId) && dseen.add(d.marketId),
);
console.log(`details: ${uniq.length} unique`);

// 3. real tradability probes — POST /primaryorderquote/ $5 YES on primary markets.
//    Honest by design: record rejections too (pre-open -> INVALID_MARKET_PARAMS,
//    stale phase -> MARKET_NOT_IN_PRIMARY). No broadcast; quotes are read-only.
const probes = [];
for (const m of uniq.filter((d) => d.phase === "primary").slice(0, 6)) {
  probes.push(await quoteReq(m.marketId, "yes", "5.00"));
  await sleep(300);
}
console.log(
  `probes: ${probes.length} (${probes.filter((p) => p.ok).length} fillable)`,
);

// 3a. recorded quote matrix — market × side × amount, one POST each (distinct
//     questions; quotes are read-only). Front-end Quotes console serves these
//     as timestamped records, clearly not live quotes.
const quoteMatrix = [];
for (const m of uniq.filter((d) => d.phase === "primary").slice(0, 3)) {
  for (const side of ["yes", "no"]) {
    for (const amt of ["5.00", "25.00", "100.00"]) {
      quoteMatrix.push(await quoteReq(m.marketId, side, amt));
      await sleep(300);
    }
  }
}
console.log(
  `quoteMatrix: ${quoteMatrix.length} (${quoteMatrix.filter((p) => p.ok).length} fillable)`,
);

// 3b. desk wallet positions — real read-only GET /positions/ (honest even when empty)
let positions = null;
{
  const d = await jget(
    `/positions/?wallet=9KTwcJwYXZnQaVQ3QRDeoK2Mn3zKcthjzsWjwj2subC8`,
  );
  if (d && d.summary)
    positions = {
      wallet: d.wallet,
      summary: d.summary,
      positions: (d.positions || []).slice(0, 20).map((p) => ({
        marketId: p.marketId,
        side: p.side,
        shares: p.shares,
        valueUsdc: p.valueUsdc ?? p.currentValueUsdc,
        claimable: p.claimable ?? p.claimEligible ?? null,
      })),
    };
}
console.log(
  `positions: ${positions ? positions.positions.length + " open, value " + positions.summary.currentValueUsdc + " USDC" : "unavailable"}`,
);

// 4. snapshot
const now = new Date();
const nowS = now.getTime() / 1000;
// 3c. day-over-day diff vs the previous snapshot (new / phase-changed / rotated out)
const changes = {
  prevGeneratedAt: null,
  newIds: [],
  phaseChanged: [],
  notSeenToday: 0,
};
try {
  const prev = JSON.parse(readFileSync(OUT("snapshot.json"), "utf8"));
  changes.prevGeneratedAt = prev.generatedAt;
  const prevById = new Map((prev.markets || []).map((m) => [m.id, m]));
  const todayIds = new Set(uniq.map((d) => d.marketId));
  for (const d of uniq) {
    const p = prevById.get(d.marketId);
    if (!p) {
      if (registry.firstSeen[d.marketId] === stamp)
        changes.newIds.push(d.marketId);
    } else if (p.phase !== d.phase) {
      changes.phaseChanged.push({ id: d.marketId, from: p.phase, to: d.phase });
    }
  }
  changes.notSeenToday = [...prevById.keys()].filter(
    (id) => !todayIds.has(id),
  ).length;
} catch {}
console.log(
  `diff vs prev: +${changes.newIds.length} first-seen, ${changes.phaseChanged.length} phase changes, ${changes.notSeenToday} rotated out of today's list`,
);
const snap = {
  agent: "loveoftheai agent pipeline (Claude Code on DGX Spark)",
  generatedAt: now.toISOString(),
  source: "Panta API v1 (live-api.panta.market)",
  marketCount: items.length,
  registry: {
    marketsTracked: regCount,
    pulls: registry.pulls,
    since: Object.values(registry.firstSeen).sort()[0],
  },
  changes,
  detailCount: uniq.length,
  probes,
  quoteMatrix,
  deskPositions: positions,
  markets: uniq.map((d) => ({
    id: d.marketId,
    category: d.category,
    title: d.title || (d.description || "").slice(0, 90) || "(untitled)",
    description: (d.description || "").slice(0, 300),
    phase: d.phase,
    status: d.status,
    resolved: d.resolved,
    startTime: d.startTime,
    endTime: d.endTime,
    oracle: d.oracle,
    yesPrice: d.yesPrice ?? d.primaryYesPrice ?? null,
    noPrice: d.noPrice ?? d.primaryNoPrice ?? null,
    primaryVolume: d.primaryVolume,
    secondaryVolume: d.secondaryVolume,
    isGraduated: d.isGraduated,
  })),
  notes:
    "Catalog endpoint returns up to 50 per pull (server cursor never advances); this snapshot is deduped. A persistent registry accumulates every market ever seen across daily pulls (marketsTracked counts it) because the live list rotates. Catalog phase can be stale vs per-market detail; detail endpoint wins here. Quote probes and the quote matrix are real POST /primaryorderquote/ calls ($5 YES plus market × side × amount, never broadcast) — rejections recorded as-is.",
};
writeFileSync(OUT("snapshot.json"), JSON.stringify(snap, null, 1));
writeFileSync(OUT("registry.json"), JSON.stringify(registry));

// 4. regenerate brief
const ms = snap.markets;
const byCat = {},
  byPhase = {};
for (const m of ms) {
  byCat[m.category || "—"] = (byCat[m.category || "—"] || 0) + 1;
  byPhase[m.phase || "—"] = (byPhase[m.phase || "—"] || 0) + 1;
}
const cats = Object.entries(byCat)
  .sort((a, b) => b[1] - a[1])
  .map(([c, n]) => `${c} *${n}`)
  .join(", ");
const phases = Object.entries(byPhase)
  .map(([p, n]) => `${p}: ${n}`)
  .join(" · ");
const preopen = ms
  .filter((m) => m.phase === "primary" && (m.startTime || 0) > nowS)
  .sort((a, b) => a.startTime - b.startTime);
const fmt = (u) =>
  u
    ? new Date(u * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC"
    : "—";
const probeNote = probes.length
  ? `Real quote probes ($5 YES) this pull: ${probes.map((p) => (p.ok ? "fillable" : p.error)).join(" · ")}. Rejections recorded as-is — the answer to "can I buy YES right now" is whatever the quote endpoint says, never a guess.`
  : "No primary-phase markets to probe this pull.";
const nxt = preopen[0];
const t = (m) =>
  m && m.title
    ? m.title.length > 60
      ? m.title.slice(0, 60) + "…"
      : m.title
    : "—";
const date = now.toISOString().slice(0, 10);
const diffNote = changes.prevGeneratedAt
  ? `Since the ${changes.prevGeneratedAt.slice(0, 10)} pull: **${changes.newIds.length} market(s) seen for the first time**, ${changes.phaseChanged.length} phase change(s)${changes.phaseChanged.length ? " — " + changes.phaseChanged.map((c) => `${String(c.id).slice(0, 6)}… ${c.from}→${c.to}`).join(", ") : ""}, and ${changes.notSeenToday} market(s) from yesterday's detailed list rotated out of today's live catalog. Registry now tracks **${regCount} markets** across ${registry.pulls} pulls (the live list caps at 50 and rotates; the registry is the union of everything ever seen).`
  : `First pull with the persistent registry: tracking **${regCount} markets**. Tomorrow's brief gains a day-over-day diff (new / phase-changed / rotated-out) from this baseline.`;
const brief = `# Daily Brief — ${date}

*Written by the agent pipeline from a live Panta API pull at ${snap.generatedAt} · catalog ${snap.marketCount} unique markets, ${snap.detailCount} detailed, ${regCount} tracked in registry.*

## Since the last pull

${diffNote}

## The catalog this morning

- Categories among detailed markets: ${cats}
- Phases: ${phases}
- Earliest pre-open primary: **${fmt(nxt && nxt.startTime)}** — ${t(nxt)}

## What that means for traders

- ${probeNote}
- Secondary trading lives on the official Panta UI; the API exposes spot prices (yesPrice on details).
- Resolved markets settle at 1 / 0 strings; claim flow (claim/build) applies to winning shares.

## One honest observation

Catalog is young: ${snap.marketCount} listed, but the detailed sample is dominated by low-volume pairs. The real API alpha right now is the **market-creation flow** (see the real create-quote artifact in How-it-works) and read integrations like this one.
`;
writeFileSync(OUT("brief.md"), brief);
console.log("snapshot + brief -> data/");
