/* Panta Copilot — rule-based NL layer over an agent-fed snapshot.
   Every number traces to the Panta API via data/snapshot.json. */
"use strict";

let SNAP = null;
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const fmtT = (unix) =>
  unix
    ? new Date(unix * 1000).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const countdown = (unix) => {
  if (!unix) return "";
  const s = unix - Date.now() / 1000;
  if (s <= 0) return "ended";
  const d = Math.floor(s / 86400),
    h = Math.floor((s % 86400) / 3600);
  return d > 0
    ? `${d}d ${h}h left`
    : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`;
};
const price = (m) =>
  m.yesPrice != null ? `YES ${Number(m.yesPrice).toFixed(2)}` : null;
/* many live Panta markets carry no title — label them category · oracle · id
   instead of showing three indistinguishable "(untitled)" rows */
const mTitle = (m) => {
  const t = m?.title;
  if (t && t !== "(untitled)") return t;
  return `${m?.category || "market"} · ${m?.oracle || "no oracle"} · ${String(m?.id || "").slice(0, 4)}…`;
};

/* plain-language rejection decoder — the API's own codes, translated.
   Unmapped codes render raw; nothing is ever invented. */
const REJ = {
  INVALID_MARKET_PARAMS:
    "the API rejected these params at request time — reasons vary (amount, market state, config); the raw message is preserved in the snapshot",
  MARKET_NOT_IN_PRIMARY:
    "the primary-buy route was unavailable for this market at observation time — it does not prove secondary trading is unavailable",
  INSUFFICIENT_FUNDS: "desk wallet lacks the USDC for this amount",
  MARKET_NOT_FOUND: "market id is no longer in the live catalog",
  AMOUNT_TOO_SMALL:
    "this amount was rejected; a larger amount is a possible next check, not a promise of success",
};
const decodeRej = (r) => {
  const c = String(r?.error || "");
  if (REJ[c]) return REJ[c];
  if (r?.http === 401)
    return "API key rejected — auth issue, not a market issue";
  if (r?.http === 429) return "rate limited — back off and retry";
  return c ? `unmapped code, shown raw: ${c}` : "no error body returned";
};

/* ---------- boot ---------- */
async function boot() {
  try {
    const r = await fetch("data/snapshot.json");
    SNAP = await r.json();
  } catch (e) {
    $("#stamp").textContent = "snapshot unavailable";
    return;
  }
  fetch("data/create-quote.json")
    .then((r) => r.json())
    .then((cq) => {
      const u = (x) =>
        (Number(x) / 1e6).toLocaleString(undefined, {
          maximumFractionDigits: 2,
        });
      $("#cqbox").innerHTML =
        `<b class="stat">${esc(cq.response.createId)}</b> · standard market · ` +
        `creation fee <b class="stat">${u(cq.response.paymentUsdc)} USDC</b> ` +
        `(${u(cq.response.liquidityInjectionUsdc)} liquidity + ${u(cq.response.platformRevenueUsdc)} platform).` +
        `<div class="sub" style="margin-top:6px">Historical test quote captured 2026-09-25 and kept verbatim — it expired ${esc(cq.response.expiresAt)}, and its request params were internally inconsistent (question says “close”, the rule tests the candle open; end timestamp ≠ Oct 31). Shown for the endpoint's real response shape and fee split, not as a valid market.</div>`;
    })
    .catch(() => {});
  $("#stamp").textContent =
    `agent snapshot · ${new Date(SNAP.generatedAt).toLocaleString()}`;
  $("#stamp").classList.add("live");
  $("#counts").textContent =
    `${SNAP.marketCount} markets in catalog · ${SNAP.detailCount} detailed${SNAP.registry ? ` · ${SNAP.registry.marketsTracked} tracked in registry` : ""}`;
  renderFilters();
  renderWall("all");
  renderRegistry();
  renderQuotes();
  renderPositions();
  loadBrief();
  seedChat();
}

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    document
      .querySelectorAll(".tab")
      .forEach((x) => x.classList.remove("active"));
    document
      .querySelectorAll(".panel")
      .forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("#" + t.dataset.tab).classList.add("active");
  }),
);

/* ---------- markets wall ---------- */
let FILTER = "all";
function renderFilters() {
  const cats = [
    ...new Set(SNAP.markets.map((m) => m.category).filter(Boolean)),
  ].sort();
  const wrap = $("#filters");
  wrap.innerHTML = "";
  const mk = (label, key) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (key === FILTER) b.classList.add("active");
    b.onclick = () => {
      FILTER = key;
      renderFilters();
      renderWall(key);
    };
    wrap.appendChild(b);
  };
  mk("all", "all");
  mk("open (primary)", "primary");
  mk("trading (secondary)", "secondary");
  mk("resolved", "resolved");
  cats.forEach((c) => mk(c, "cat:" + c));
}
function marketBadge(m) {
  const now = Date.now() / 1000;
  if (m.phase === "resolved")
    return '<span class="badge resolved">resolved</span>';
  if (m.phase === "primary")
    return m.startTime > now
      ? '<span class="badge preopen">primary · pre-open</span>'
      : '<span class="badge primary">primary · open</span>';
  if (m.phase === "secondary")
    return '<span class="badge secondary">secondary trading</span>';
  return `<span class="badge">${esc(m.phase)}</span>`;
}
function renderWall(key) {
  const wall = $("#wall");
  let ms = [...SNAP.markets];
  if (key === "primary" || key === "secondary" || key === "resolved")
    ms = ms.filter((m) => m.phase === key);
  else if (key.startsWith("cat:"))
    ms = ms.filter((m) => m.category === key.slice(4));
  ms.sort(
    (a, b) =>
      (a.phase === "resolved") - (b.phase === "resolved") ||
      (b.primaryVolume || 0) - (a.primaryVolume || 0),
  );
  wall.innerHTML =
    ms
      .slice(0, 60)
      .map(
        (m) => `
    <div class="mcard">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="cat">${esc(m.category || "—")}</span>${marketBadge(m)}
      </div>
      <div class="title">${esc(mTitle(m))}</div>
      <div class="row"><span>${price(m) || "price via quote"}</span><span>${countdown(m.endTime) || fmtT(m.endTime)}</span></div>
      <div class="row"><span>oracle: ${esc(m.oracle || "—")}</span><span>vol ${Number(m.primaryVolume || 0).toLocaleString()}</span></div>
    </div>`,
      )
      .join("") || '<p style="color:var(--dim)">no markets in this filter.</p>';
}

/* ---------- registry (2h-cadence sweep, agent-fed) ---------- */
function sparkSVG(h) {
  const W = 110,
    H = 26;
  const idx = h
    .map((p, i) => (p[1] == null ? null : [i, Number(p[1])]))
    .filter(Boolean);
  if (idx.length < 2)
    return `<span style="color:var(--dim);font-size:11px">≥2 pts needed</span>`;
  const vs = idx.map(([, v]) => v);
  const min = Math.min(...vs),
    max = Math.max(...vs);
  const x = (i) => ((i / (h.length - 1)) * W).toFixed(1);
  const y = (v) =>
    (H - 3 - ((v - min) / (max - min || 1)) * (H - 6)).toFixed(1);
  const poly = idx.map(([i, v]) => `${x(i)},${y(v)}`).join(" ");
  const up = vs[vs.length - 1] >= vs[0];
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block"><polyline points="${poly}" fill="none" stroke="${up ? "#3fb27f" : "#d0665f"}" stroke-width="1.5"/></svg>`;
}
async function renderRegistry() {
  const stats = $("#regstats"),
    wallEl = $("#regwall");
  if (!stats || !wallEl) return;
  let reg = null;
  try {
    reg = await (await fetch("data/registry.json")).json();
  } catch {
    stats.textContent = "registry unavailable in this build.";
    return;
  }
  const meta = reg.meta || {};
  const hist = reg.history || {};
  const ids = Object.keys(reg.firstSeen || {});
  const pts = Object.values(hist).reduce((a, h) => a + h.length, 0);
  const priceObs = Object.values(hist)
    .flat()
    .filter((p) => p[1] != null).length;
  const lastSweep =
    Object.values(reg.lastSeen || {})
      .sort()
      .pop() || "";
  stats.innerHTML = `<div class="row"><span>markets ever seen</span><b class="stat">${ids.length}</b></div>
    <div class="row"><span>catalog pulls</span><b>${reg.pulls ?? "?"}</b></div>
    <div class="row"><span>change-only observations</span><b>${pts}</b><span class="sub" style="margin-left:6px">${priceObs} with a price</span></div>
    <div class="row"><span>tracking since</span><b>${esc(
      String(Object.values(reg.firstSeen).sort()[0] || "")
        .slice(0, 16)
        .replace("T", " "),
    )} UTC</b></div>
    <div class="row"><span>last sweep</span><b>${esc(String(lastSweep).slice(0, 16).replace("T", " "))} UTC</b></div>`;
  const label = (id) => {
    const m = SNAP.markets.find((x) => x.id === id);
    if (m && m.title && m.title !== "(untitled)") return m.title;
    return (
      meta[id]?.title ||
      `${meta[id]?.cat || "market"} · ${String(id).slice(0, 4)}…`
    );
  };
  const rows = Object.entries(hist)
    .filter(([, h]) => h.length)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 48);
  wallEl.innerHTML =
    rows
      .map(([id, h]) => {
        const fp = h[0][1] != null ? Number(h[0][1]) : null;
        const lp =
          h[h.length - 1][1] != null ? Number(h[h.length - 1][1]) : null;
        const d =
          fp != null && lp != null && fp > 0 ? ((lp - fp) / fp) * 100 : null;
        return `<div class="mcard">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="cat">${esc(meta[id]?.cat || "—")}</span><span class="badge">${esc(h[h.length - 1][4] || meta[id]?.phase || "?")}</span>
      </div>
      <div class="title">${esc(label(id))}</div>
      ${sparkSVG(h)}
      <div class="row"><span>YES ${fp != null ? fp.toFixed(3) : "—"} → ${lp != null ? lp.toFixed(3) : "—"}</span><b class="stat">${d != null ? (d >= 0 ? "+" : "") + d.toFixed(1) + "%" : "—"}</b></div>
      <div class="row"><span>${h.length} obs (${h.filter((p) => p[1] != null).length} priced)</span><span>vol ${Number(h[h.length - 1][3] || 0).toLocaleString()}</span></div>
    </div>`;
      })
      .join("") ||
    '<p style="color:var(--dim)">no history points yet — the 2h sweep is accumulating.</p>';
}

/* ---------- recorded quotes (agent-fed matrix, not live) ---------- */
function renderQuotes() {
  const Q = SNAP.quoteMatrix || [];
  const sel = $("#qsel");
  const res = $("#qres");
  if (!sel || !res) return;
  if (!Q.length) {
    res.innerHTML =
      "<p>no quote matrix in this snapshot — the pipeline records market × side × amount quotes daily.</p>";
    $("#qtable").innerHTML = "";
    return;
  }
  const mIds = [...new Set(Q.map((q) => q.marketId))];
  const title = (id) => {
    const m = SNAP.markets.find((x) => x.id === id);
    return (m ? mTitle(m) : id).slice(0, 70);
  };
  sel.innerHTML =
    `<select id="qm">${mIds.map((i) => `<option value="${i}">${esc(title(i))}</option>`).join("")}</select>` +
    `<select id="qs"><option value="yes">YES</option><option value="no">NO</option></select>` +
    `<select id="qa"><option value="5.00">$5</option><option value="25.00">$25</option><option value="100.00">$100</option></select>` +
    `<span class="fineprint" style="align-self:center">recorded ${fmtT(Date.parse(SNAP.generatedAt) / 1000)}</span>`;
  const show = () => {
    const r =
      Q.find(
        (q) =>
          q.marketId === $("#qm").value &&
          q.side === $("#qs").value &&
          q.amountUsdc === $("#qa").value,
      ) || null;
    res.innerHTML = !r
      ? "<p>not recorded in this snapshot.</p>"
      : r.ok
        ? `<div class="row"><span>recorded estimate</span><b class="stat">${esc(r.shares ?? "?")} shares @ ${esc(r.avgPrice ?? "?")} avg${r.feeUsdc ? ` · fee ${esc(r.feeUsdc)} USDC` : ""}</b></div>
           <div class="row"><span>as of</span><b>${esc(SNAP.generatedAt)}</b></div>
           <p class="fineprint">Recorded by the pipeline at snapshot time — not a live quote.</p>`
        : `<div class="row"><span>rejected</span><b class="stat">HTTP ${esc(r.http ?? "?")} · ${esc(r.error)}</b></div>
           <div class="row"><span>in plain words</span><b>${esc(decodeRej(r))}</b></div>
           <p class="fineprint">Rejections are recorded as-is — the desk never invents prices.</p>`;
  };
  ["qm", "qs", "qa"].forEach((id) =>
    $("#" + id).addEventListener("change", show),
  );
  show();
  $("#qtable").innerHTML = `<table class="qt"><tbody>${Q.map(
    (q) =>
      `<tr><td>${esc(title(q.marketId).slice(0, 40))}</td><td>${q.side.toUpperCase()}</td><td>$${Number(q.amountUsdc).toFixed(0)}</td><td>${
        q.ok
          ? `<b class="stat">${esc(q.shares ?? "?")} sh @ ${esc(q.avgPrice ?? "?")}</b>`
          : `<span style="color:var(--dim)" title="${esc(decodeRej(q))}">${esc(q.http ?? "")} ${esc(q.error || "")}</span>`
      }</td></tr>`,
  ).join("")}</tbody></table>`;
}

/* ---------- positions (desk wallet, agent-fed) ---------- */
function renderPositions() {
  const el = $("#posbody");
  const p = SNAP.deskPositions;
  if (!p || !p.summary) {
    el.innerHTML =
      "<h2>Desk wallet positions</h2><p>positions unavailable in this snapshot.</p>";
    return;
  }
  const s = p.summary;
  const rows = (p.positions || [])
    .map(
      (x) =>
        `<div class="row"><span>${esc(x.marketId.slice(0, 10))}… · ${esc(x.side || "?")}</span><b>${esc(x.shares ?? "?")} sh · ${esc(x.valueUsdc ?? "?")} USDC${x.claimable ? " · claimable" : ""}</b></div>`,
    )
    .join("");
  el.innerHTML = `<h2>Desk wallet — agent-fed snapshot (GET /positions/ at refresh time)</h2>
    <div class="row"><span>wallet</span><b style="font-family:ui-monospace;font-size:11px">${esc(p.wallet.slice(0, 14))}…</b></div>
    <div class="row"><span>current value</span><b class="stat">${esc(s.currentValueUsdc)} USDC</b></div>
    <div class="row"><span>primary contributed</span><b>${esc(s.primaryContributedUsdc)} USDC</b></div>
    <div class="row"><span>positions</span><b>${s.valuedPositions} valued · ${s.unvaluedPositions} unvalued</b></div>
    ${rows || "<p>This desk wallet held no open positions at the last snapshot (the pipeline re-reads this endpoint every refresh; any wallet can be checked the same way). Trading would require signing an unsigned transaction in a real wallet — see How it works; this app never holds keys.</p>"}`;
}

/* ---------- daily brief ---------- */
async function loadBrief() {
  try {
    const r = await fetch("data/brief.md");
    const md = await r.text();
    $("#briefbody").innerHTML = renderMD(md);
  } catch {
    $("#briefbody").textContent =
      "brief pending — agent hasn't shipped today's edition yet.";
  }
}
function renderMD(md) {
  const lines = md.split("\n");
  const out = [];
  let inList = false;
  const inline = (s) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`(.+?)`/g, "<code>$1</code>")
      .replace(/\*(\d+)/g, '<span class="stat">*$1');
  for (const L of lines) {
    const t = L.trim();
    const li = t.startsWith("- ") || /^\d+\. /.test(t);
    if (li && !inList) {
      out.push("<ul>");
      inList = true;
    }
    if (!li && inList) {
      out.push("</ul>");
      inList = false;
    }
    if (t.startsWith("## ")) out.push(`<h2>${inline(t.slice(3))}</h2>`);
    else if (t.startsWith("### ")) out.push(`<h3>${inline(t.slice(4))}</h3>`);
    else if (t.startsWith("- ")) out.push(`<li>${inline(t.slice(2))}</li>`);
    else if (/^\d+\. /.test(t))
      out.push(`<li>${inline(t.replace(/^\d+\. /, ""))}</li>`);
    else if (t === "---") out.push("<hr>");
    else if (t) out.push(`<p>${inline(t)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

/* ---------- copilot chat ---------- */
const chatEl = $("#chat");
function say(text, html) {
  const d = document.createElement("div");
  d.className = "msg bot";
  d.innerHTML = html || esc(text);
  chatEl.appendChild(d);
  chatEl.scrollTop = chatEl.scrollHeight;
}
function userSay(text) {
  const d = document.createElement("div");
  d.className = "msg user";
  d.textContent = text;
  chatEl.appendChild(d);
  chatEl.scrollTop = chatEl.scrollHeight;
}
function seedChat() {
  say(
    "",
    `<h4>Panta Copilot</h4>I read the agent's latest snapshot of the Panta catalog — ${SNAP.marketCount} markets. Ask me things like:
  <div class="sub">“show me crypto markets” · “what's closing soon” · “tell me about the BBC oracle market” · “explain bonding curve”</div>`,
  );
  renderChips();
}
const CHIPS = [
  "sports markets",
  "closing soon",
  "crypto markets",
  "explain primary vs secondary",
  "how do I buy YES",
  "daily brief",
];
function renderChips() {
  const w = $("#chips");
  w.innerHTML = "";
  CHIPS.forEach((c) => {
    const b = document.createElement("button");
    b.textContent = c;
    b.onclick = () => handleAsk(c);
    w.appendChild(b);
  });
}

/* fuzzy title match */
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function findMarket(q) {
  const nq = norm(q);
  if (!nq) return null;
  const words = nq.split(" ").filter((w) => w.length > 2);
  let best = null,
    bestScore = 0;
  for (const m of SNAP.markets) {
    const t =
      norm(m.title) +
      " " +
      norm(m.description) +
      " " +
      norm(m.category) +
      " " +
      norm(m.oracle);
    let score = 0;
    for (const w of words) if (t.includes(w)) score += w.length;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return bestScore >= 6 ? best : null;
}
function probeFor(id) {
  return (SNAP.probes || []).find((p) => p.marketId === id) || null;
}
function probeLine(m) {
  const p = probeFor(m.id);
  if (!p) return "";
  return p.ok
    ? `<div class="row"><span>separate $5 YES probe</span><b class="stat">${esc(p.shares ?? "?")} sh @ ${esc(p.avgPrice ?? "?")}${p.feeUsdc ? " · fee " + esc(p.feeUsdc) : ""}</b></div>`
    : `<div class="row"><span>separate $5 YES probe</span><b>rejected · ${esc(p.error)}</b></div>`;
}
function marketCard(m, extra) {
  const p = price(m);
  return `<h4>${esc(mTitle(m))}</h4>
    <div class="row"><span>category</span><b>${esc(m.category || "—")}</b></div>
    <div class="row"><span>phase</span><b>${esc(m.phase)}${m.phase === "primary" && m.startTime > Date.now() / 1000 ? " · pre-open" : ""}</b></div>
    <div class="row"><span>spot</span><b>${p ? esc(p) : "via quote"}</b></div>
    <div class="row"><span>ends</span><b>${fmtT(m.endTime)} (${countdown(m.endTime)})</b></div>
    <div class="row"><span>oracle</span><b>${esc(m.oracle || "—")}</b></div>
    <div class="row"><span>market id</span><b style="font-family:ui-monospace;font-size:11px">${esc(m.id.slice(0, 18))}…</b></div>
    ${probeLine(m)}
    ${extra || ""}`;
}

/* concepts (static, honest) */
const CONCEPTS = [
  {
    k: ["bonding curve", "bonding"],
    a: `**Bonding curve (primary phase).**\nEvery YES/NO market starts in *primary*: you deposit USDC and the curve mints YES+NO share pairs. Price starts near 50/50 and moves as the pool grows. Quote first (POST /primaryorderquote/) — it returns estimated shares, avg price and the protocol fee for your amount.`,
  },
  {
    k: ["primary vs secondary", "primary", "secondary", "graduat"],
    a: `**Primary → secondary.**\n*Primary*: buy fresh YES/NO shares from the bonding curve (API builds a \`primary_order_usdc\` instruction). When a market graduates, *secondary* trading opens: prices move like an order book, spot prices come from RPC. A market later *resolves* YES or NO via its oracle, and winning shares get claimed (claim_win_usdc).`,
  },
  {
    k: ["oracle", "resolve", "resolution"],
    a: `**Oracles.**\nEach market names its resolution source (e.g. \`af-news-bbc-africa\` — an agent-fed BBC Africa news oracle). At resolutionTime the oracle settles the market YES or NO; then \`POST /claim/build/\` builds the unsigned claim for winning shares.`,
  },
  {
    k: ["buy", "yes", "no", "trade", "order"],
    a: `**Buying YES/NO — 4 steps, keys never leave your wallet.**\n1. \`primaryorderquote\` — simulate the fill (shares, avg price, fee) for your USDC amount\n2. \`primaryorderbuild\` — Panta returns an unsigned Solana tx from the live quote\n3. your wallet signs; you broadcast on your own RPC\n4. \`primaryordersubmit\` — report the signature; Panta confirms async\n\nIn this demo the Copilot shows step 1 against real markets; signing stays in a real wallet.`,
  },
  {
    k: ["fee", "cost", "creation"],
    a: `**Fees.**\nPrimary buys pay a protocol fee returned in the quote (feeUsdc) — see any recorded quote in the Quotes tab. Creating a market costs USDC, quoted via \`marketquote\` before you build: the How-it-works tab shows a real recorded creation quote and its fee split (liquidity + platform).`,
  },
  {
    k: ["brief", "daily"],
    a: `**Daily Brief.**\nThe agent pipeline writes a morning read of the catalog — category mix, what's trading, what's resolving, and one honest observation. Open the *Daily Brief* tab; it's refreshed with every snapshot.`,
  },
];
function conceptFor(q) {
  const nq = q.toLowerCase();
  for (const c of CONCEPTS) if (c.k.some((k) => nq.includes(k))) return c.a;
  return null;
}

function handleAsk(qRaw) {
  const q = (qRaw || "").trim();
  if (!q) return;
  userSay(q);
  const nq = q.toLowerCase();
  const now = Date.now() / 1000;

  // 1. closing soon
  if (/clos|ending|end soon|deadline|about to/.test(nq)) {
    const ms = SNAP.markets
      .filter((m) => m.phase !== "resolved" && m.endTime > now)
      .sort((a, b) => a.endTime - b.endTime)
      .slice(0, 5);
    if (!ms.length)
      return say("Nothing open is ending within the snapshot window.");
    say(
      "",
      `<h4>Closing soonest (open markets)</h4>` +
        ms
          .map(
            (m, i) =>
              `<div class="row"><span>${i + 1}. ${esc(mTitle(m).slice(0, 64))}</span><b>${countdown(m.endTime)}</b></div>`,
          )
          .join("") +
        `<div class="sub">ask “tell me about …” for any of these</div>`,
    );
    return;
  }
  // 2. category browse
  const catMap = {
    crypto: "crypto",
    sports: "sports",
    politics: "politics",
    weather: "weather",
    finance: "finance",
    stocks: "stocks",
    pop: "pop-culture",
    culture: "pop-culture",
  };
  const catHit = Object.keys(catMap).find((k) => nq.includes(k));
  if (
    /(show|list|what|browse|open).*market|market.*(show|list)/.test(nq) ||
    (catHit && /market|show|list/.test(nq))
  ) {
    const cat = catHit ? catMap[catHit] : null;
    let ms = SNAP.markets.filter((m) => m.phase !== "resolved");
    if (cat) ms = ms.filter((m) => m.category === cat);
    ms = ms.slice(0, 6);
    say(
      "",
      `<h4>${cat ? cat + " markets" : "open markets"} · ${ms.length} shown</h4>` +
        ms
          .map(
            (m) =>
              `<div class="row"><span>${marketBadge(m)} ${esc(mTitle(m).slice(0, 58))}</span><b>${countdown(m.endTime) || "—"}</b></div>`,
          )
          .join("") +
        `<div class="sub">say “tell me about …” for a full card, with its market id</div>`,
    );
    return;
  }
  // 3. quote intent — served from the recorded quote matrix (not live)
  const qm = nq.match(/quote\s*\$?(\d+(?:\.\d+)?)\s*(yes|no)?/);
  if (qm) {
    const amt = Number(qm[1]).toFixed(2),
      side = qm[2] || "yes";
    const m =
      findMarket(
        q
          .replace(/quote\s*\$?\d+(\.\d+)?\s*(yes|no)?/i, "")
          .replace(/on|for|market/gi, ""),
      ) || findMarket(q);
    const Q = SNAP.quoteMatrix || [];
    const mine = m ? Q.filter((x) => x.marketId === m.id) : [];
    const rec =
      mine.find((x) => x.side === side && x.amountUsdc === amt) ||
      mine.find((x) => x.side === side) ||
      null;
    if (m && rec) {
      const near =
        rec.amountUsdc === amt
          ? ""
          : ` Your exact ask ($${Number(amt).toFixed(0)} ${side.toUpperCase()}) wasn't recorded — this is the nearest recorded request for this market on the ${side.toUpperCase()} side.`;
      say(
        "",
        marketCard(
          m,
          rec.ok
            ? `<div class="row"><span>recorded ${esc(rec.side.toUpperCase())} $${Number(rec.amountUsdc).toFixed(0)} estimate</span><b class="stat">${esc(rec.shares ?? "?")} shares @ ${esc(rec.avgPrice ?? "?")} avg${rec.feeUsdc ? ` · fee ${esc(rec.feeUsdc)} USDC` : ""}</b></div>
               <div class="sub">Recorded by the pipeline at snapshot time (${esc(SNAP.generatedAt)}) — not a live quote.${near} Full matrix in the Quotes tab.</div>`
            : `<div class="row"><span>recorded ${esc(rec.side.toUpperCase())} $${Number(rec.amountUsdc).toFixed(0)} request</span><b>rejected · HTTP ${esc(rec.http ?? "?")} · ${esc(rec.error)}</b></div>
               <div class="sub">Plain words: ${esc(decodeRej(rec))}. Rejection recorded as-is at snapshot time — not a live quote.${near} Full matrix in the Quotes tab.</div>`,
        ),
      );
    } else if (m && mine.length) {
      say(
        "",
        marketCard(
          m,
          `<div class="sub">No ${side.toUpperCase()} quote recorded for this market in the current snapshot (recorded sides: ${[...new Set(mine.map((x) => x.side))].map((s) => s.toUpperCase()).join(", ")}). The Quotes tab shows the full matrix; on-demand quoting isn't implemented in this build.</div>`,
        ),
      );
    } else if (m) {
      say(
        "",
        marketCard(
          m,
          `<div class="sub">This market isn't in the current quote matrix — the pipeline records a fixed market × side × amount set each refresh. See the Quotes tab for everything recorded. This market is ${m.phase === "primary" && m.startTime > now ? "pre-open (trading starts " + fmtT(m.startTime) + ")" : m.phase + " phase"}.</div>`,
        ),
      );
    } else {
      say(
        `I couldn't match a market from “${q}”. Try “show me markets” and pick one by name.`,
      );
    }
    return;
  }
  // 4. concepts
  const concept = conceptFor(nq);
  if (concept && !findMarket(q)) return say(concept);
  // 5. specific market
  const m = findMarket(q);
  if (m) return say("", marketCard(m));
  // 6. fallback
  say(
    "",
    `No direct match in the snapshot for “${esc(q)}”.\n<div class="sub">try: “show me markets” · “closing soon” · a few words from a market title · “explain bonding curve”</div>`,
  );
}

$("#askform").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#ask").value;
  $("#ask").value = "";
  handleAsk(v);
});

boot();
