# Collector

Two scheduled jobs refresh the live site (both run from the builder's
machine; the site itself stays static):

| job | cadence | what it does | script |
|---|---|---|---|
| daily full pull | daily | catalog pull → up to 40 details → quote probes + quote matrix (paced ≤27/min under the docs' 30 quotes/min default) → positions read → snapshot.json + brief.md | `pipeline/panta_snapshot.mjs` |
| registry sweep | every 2h | 1 catalog pull (discovery) + up to 12 rotating per-market detail pulls — the list endpoint returns null prices, details are the only price source → appends change-only history points → registry.json | `pipeline/panta_sweep.mjs` |

Local run of the daily pull (from the repo root):

```sh
PANTA_API_KEY=pk_live_… node pipeline/panta_snapshot.mjs
```

Notes on API behavior we recorded empirically (see `data/snapshot.json`
`notes`):

- `GET /markets/` ignores `offset`/`ordering` server-side (one rotating
  50-market page) — that's why a persistent registry exists.
- List items carry **null** `yesPrice`/`noPrice`; per-market detail is the
  price source.
- Quote rejections are kept verbatim (code + message + per-request
  timestamp). A rejection is an observation, never a reason to invent a
  price.
- Request families are paced separately (reads ~300 ms apart, quotes 2.2 s
  apart) per the documented per-family defaults.
