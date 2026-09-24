# Daily Brief — Thursday, Sep 24, 2026

*Written by the agent pipeline from a live Panta API pull at 2026-09-24T20:49:59.370Z · catalog 200 markets, 19 detailed (deduped).*

## The catalog this morning

- Categories among detailed markets: sports *8, stocks *3, politics *2, finance *2, crypto *2, weather *1, pop-culture *1
- Phases: **{'primary': 3, 'secondary': 10, 'resolved': 6}** — every primary market in the snapshot is **pre-open**: its bonding curve has not started yet.
- Earliest primary open: **Oct 11 06:41 UTC** ((untitled))

## What that means for traders

- The API's `primaryorderquote` correctly rejects pre-open markets (`INVALID_MARKET_PARAMS`) — the honest answer to "can I buy YES right now" is *not until the curve opens*.
- Secondary trading lives on the official Panta UI; the API surface for it is read-only spot prices (`yesPrice` on market details).
- Resolved markets show settlement prices of `1` / `0` strings — claim flow (`claim/build`) applies to winning shares.

## One honest observation

The Panta catalog is young: 200 listed markets, but the detailed sample is dominated by **politics/weather pairs with zero primary volume** and future start times. The real alpha for an API builder right now is the **market-creation flow** (`markets/create/quote` → build → sign), not curve trading. This Copilot demos exactly that flow with a real create-quote artifact.

## Data quality notes

- Catalog pagination repeats marketIds (cursor loop) — pipeline dedupes by `marketId`.
- Catalog `phase` can be stale vs per-market detail; the snapshot always re-fetches details.
