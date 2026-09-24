# Panta Copilot

**The prediction-market desk that talks** — an agent-fed front end for [Panta](https://www.panta.market/) binary YES/NO prediction markets on Solana.

- **Copilot** — rule-based NL layer over an agent snapshot: browse, match markets, closing-soon, explain the primary/secondary/claim flow, quote walkthrough
- **Markets** — deduped catalog wall with phase badges (primary · pre-open / secondary / resolved) and live countdowns
- **Daily Brief** — written by the agent pipeline from real API pulls (category mix, phases, one honest observation)

## Architecture (honest AI disclosure)

```
Panta API v1 ──(schedule)──> agent (Claude Code, DGX Spark)
   catalog pagination + per-market details + quote probes
        │
        ├─> data/snapshot.json  ──> GitHub Pages frontend
        └─> data/brief.md       ──> Daily Brief tab
```

The chat layer is transparent intent classification + fuzzy matching over the snapshot — no hidden LLM calls, no invented prices. Every number traces to a Panta API response.

Trading flow per the API's design: quote → unsigned transaction → your wallet signs → broadcast on your RPC → report signature. This app never holds keys.

**Demo video:** 39s app walkthrough — [demo.webm](https://loveoftheai.github.io/panta-copilot/demo.webm) (plays in-browser; same recording as the submission video).

**Powered by Panta** · built for the Colosseum Crypto World's Fair / Panta API Sidetrack · agent-built, human-directed.

## Run locally

Static site — serve the folder (`python3 -m http.server`) and open. Refresh data with `node ../panta_snapshot.mjs` (needs `wallets/panta.json`).
