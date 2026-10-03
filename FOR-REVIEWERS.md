# For reviewers — how to check what this site claims

Site: https://loveoftheai.github.io/panta-copilot/ · repo: loveoftheai/panta-copilot · listing: Panta API side-track.
This page tells you where each number comes from and what it does not show. Source code and the data JSONs are in the repo, so implementation-vs-data consistency is checkable directly; API-response provenance and recording cadence you take on the evidence shown (timestamps, raw code/message pairs), not on our word.

**1. Timestamps mean what they say.**
The page stamp is the **snapshot generation time** (`data/snapshot.json` → `generatedAt`). Individual recorded quotes carry their own request time; registry history points carry their own observation times. The About tab also shows historical quotes from earlier snapshot generations (e.g. Sep 25). The sweep/snapshot cadence (~2h sweep, daily snapshot) is a configuration target documented in `COLLECTOR.md`, not a guarantee you can verify from outside.

**2. "What changed" — two sources, stated precisely.**
The landing panel's _new markets_ and _phase changes_ come from `snapshot.changes`, which the pipeline computes by comparing consecutive snapshots (with `registry.firstSeen` to help classify new markets). _Biggest movers_ are computed from `registry.history` price points (first vs last non-null within the retained history). There is no per-market observation count on the landing panel — find that on each Registry card.

**3. Registry scope.**
The Registry tab count equals `Object.keys(registry.firstSeen).length` (53 at the time of writing; grows as the sweep sees more). It shows up to 48 cards per view. The Markets tab shows the **detailed sample in the current snapshot** (last pull's detail set), not a live "everything Panta returns right now"; a market absent from that sample is "not observed in this sample", not provably delisted.

**4. Quotes: recorded, never live.**
Quotes rows show recorded side, amount and result, including stored error text for rejections. Per-request timestamps (`ts`) are collector-generated and available in the JSON; the UI displays snapshot generation time. Missing shares/average price render as `?`; absent fees are omitted. The decoder matches exact stored error strings and specially explains HTTP 401/429; other errors fall back to raw text. Nothing is synthesized. On-demand quoting is **not implemented in this build** — the site says so where relevant, and markets without a recorded side display "no quote recorded" rather than any price.

**5. Watchlist — local by design.**
Starring a market (Registry tab) writes `localStorage.pc_watch`; the watchlist strip is labeled this-browser-only (no backend, no accounts). The "since your last visit" summary line is computed over the whole registry against `localStorage.pc_lastVisit`; individual watch rows show +N only when that market gained observations since your last visit (nothing on your first visit). Clear site data → both are gone.

**6. Pipeline: scripts are in the repo; the runner environment is ours.**
`COLLECTOR.md` + `pipeline/` document and contain both jobs (catalog/detail sweep with pacing; snapshot build). They are the scripts that produced `data/`. They are not yet turnkey from a clean checkout (they reference a local wallets file and push to our Pages repo), so treat "reproducible" as "auditable": you can read exactly what ran, not re-run it blind. `TESTERS.md` is the 2-minute external check (compare the Quotes tab against panta.market directly); its evidence table fills as testers reply.

**7. What this project does not claim.**
No live price feed, no on-demand quote engine, no trading, no traction numbers. The demo video is a screen recording of this site's tabs and UI as of its recording date — the data shown updates with each snapshot, so treat the video as a UI walkthrough, not a data snapshot you can diff against the live site.
