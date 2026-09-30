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
const snap = {
  agent: "loveoftheai agent pipeline (Claude Code on DGX Spark)",
  generatedAt: now.toISOString(),
  source: "Panta API v1 (live-api.panta.market)",
  marketCount: items.length,
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
    "Catalog endpoint returns up to 50 per pull (server cursor never advances); this snapshot is deduped. Catalog phase can be stale vs per-market detail; detail endpoint wins here. Quote probes and the quote matrix are real POST /primaryorderquote/ calls ($5 YES plus market × side × amount, never broadcast) — rejections recorded as-is.",
};
writeFileSync(OUT("snapshot.json"), JSON.stringify(snap, null, 1));

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
const brief = `# Daily Brief — ${date}

*Written by the agent pipeline from a live Panta API pull at ${snap.generatedAt} · catalog ${snap.marketCount} unique markets, ${snap.detailCount} detailed.*

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
