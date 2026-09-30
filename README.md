# Panta Copilot

**The prediction-market desk that talks** — an agent-fed front end for [Panta](https://www.panta.market/) binary YES/NO prediction markets on Solana.

- **Copilot** — rule-based NL layer over an agent snapshot: browse, match markets, closing-soon, explain the primary/secondary/claim flow, quote walkthrough
- **Markets** — deduped catalog wall with phase badges (primary · pre-open / secondary / resolved) and countdowns, plus real `primaryorderquote` probes on primary markets (rejections recorded as-is)
- **Quotes** — a recorded quote matrix (market × side × amount) captured at snapshot time: pick a combination, see the recorded estimate (shares/avg price/fee) or the recorded rejection, timestamped — quotes are not refreshed on demand. Untitled markets are labeled `category · oracle · id` so every row stays identifiable.
- **Positions** — the desk wallet read via `GET /positions/` at refresh time (agent-fed each snapshot)
- **Daily Brief** — written by the pipeline from real API pulls (category mix, phases, one honest observation)

## Architecture (honest AI disclosure)

```
Panta API v1 ──(daily schedule)──> data pipeline (built and supervised by an AI agent, Claude Code on DGX Spark)
   catalog pull (one request, capped at 50 — the server cursor endpoint never advances) + per-market details + quote probes + quote matrix
        │
        ├─> data/snapshot.json  ──> GitHub Pages frontend
        └─> data/brief.md       ──> Daily Brief tab
```

The chat layer is transparent intent classification + fuzzy matching over the snapshot — no hidden LLM calls, no invented prices. Market numbers are derived from Panta API responses recorded in the snapshot (computed stats and formatting aside).

Trading flow per the API's design: quote → unsigned transaction → your wallet signs → broadcast on your RPC → report signature. This app implements the quote-record step only (timestamped, not on-demand); transaction building, signing, and broadcasting are not implemented, and it never holds keys.

**Demo video:** 45s app walkthrough (Copilot → Markets → Quotes → Brief) — [demo.webm](https://loveoftheai.github.io/panta-copilot/demo.webm) (plays in-browser; same recording as the submission video).

**Powered by Panta** · built for the Colosseum Crypto World's Fair / Panta API Sidetrack · agent-built, human-directed.

## Run locally

Static site — serve the folder (`python3 -m http.server`) and open. Refresh the data yourself with an API key from [Panta](https://docs.panta.market/):

```sh
PANTA_API_KEY=pk_live_… node pipeline/panta_snapshot.mjs
```

That rewrites `data/snapshot.json` + `data/brief.md` in place (it aborts without touching existing data if the catalog pull comes back empty). The live site is refreshed by a scheduled run of the same script around submission windows.
