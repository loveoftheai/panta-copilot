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
        `(${u(cq.response.liquidityInjectionUsdc)} liquidity + ${u(cq.response.platformRevenueUsdc)} platform) · ` +
        `expires in ${cq.response.blockhashExpiryHintSec}s (unsigned-tx flow — never broadcast)`;
    })
    .catch(() => {});
  $("#stamp").textContent =
    `agent snapshot · ${new Date(SNAP.generatedAt).toLocaleString()}`;
  $("#stamp").classList.add("live");
  $("#counts").textContent =
    `${SNAP.marketCount} markets in catalog · ${SNAP.detailCount} detailed`;
  renderFilters();
  renderWall("all");
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
      <div class="title">${esc(m.title)}</div>
      <div class="row"><span>${price(m) || "price via quote"}</span><span>${countdown(m.endTime) || fmtT(m.endTime)}</span></div>
      <div class="row"><span>oracle: ${esc(m.oracle || "—")}</span><span>vol ${Number(m.primaryVolume || 0).toLocaleString()}</span></div>
    </div>`,
      )
      .join("") || '<p style="color:var(--dim)">no markets in this filter.</p>';
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
function marketCard(m, extra) {
  const p = price(m);
  return `<h4>${esc(m.title)}</h4>
    <div class="row"><span>category</span><b>${esc(m.category || "—")}</b></div>
    <div class="row"><span>phase</span><b>${esc(m.phase)}${m.phase === "primary" && m.startTime > Date.now() / 1000 ? " · pre-open" : ""}</b></div>
    <div class="row"><span>spot</span><b>${p ? esc(p) : "via quote"}</b></div>
    <div class="row"><span>ends</span><b>${fmtT(m.endTime)} (${countdown(m.endTime)})</b></div>
    <div class="row"><span>oracle</span><b>${esc(m.oracle || "—")}</b></div>
    <div class="row"><span>market id</span><b style="font-family:ui-monospace;font-size:11px">${esc(m.id.slice(0, 18))}…</b></div>
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
    a: `**Fees.**\nPrimary buys pay a small protocol fee returned in the quote (feeUsdc). Creating a market has a USDC creation fee quoted via \`marketquote\` before you build (currently 0 for many categories). Trading-fee accrual is visible per market in the snapshot.`,
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
              `<div class="row"><span>${i + 1}. ${esc(m.title.slice(0, 64))}</span><b>${countdown(m.endTime)}</b></div>`,
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
              `<div class="row"><span>${marketBadge(m)} ${esc(m.title.slice(0, 58))}</span><b>${countdown(m.endTime) || "—"}</b></div>`,
          )
          .join("") +
        `<div class="sub">say “tell me about …” for a full card, with its market id</div>`,
    );
    return;
  }
  // 3. quote intent
  const qm = nq.match(/quote\s*\$?(\d+(?:\.\d+)?)\s*(yes|no)?/);
  if (qm) {
    const amt = qm[1],
      side = (qm[2] || "yes").toUpperCase();
    const m =
      findMarket(
        q
          .replace(/quote\s*\$?\d+(\.\d+)?\s*(yes|no)?/i, "")
          .replace(/on|for|market/gi, ""),
      ) || findMarket(q);
    if (m && m.phase === "primary" && m.startTime <= now) {
      say(
        "",
        marketCard(
          m,
          `<div class="sub">Live quote needs an API call per ask — the agent pipeline runs real <code>primaryorderquote</code> probes; the trading tab of the official playground executes steps 2–4 with your wallet. In this demo build, quote cards for ${side} \$${amt} are shown for pre-open markets with their open time.</div>`,
        ),
      );
    } else if (m) {
      say(
        "",
        marketCard(
          m,
          `<div class="sub">This market is ${m.phase === "primary" ? "pre-open (trading starts " + fmtT(m.startTime) + ")" : "past primary — secondary/resolved"}; a ${side} quote for \$${amt} would ${m.phase === "primary" ? "open then" : "not be fillable on the curve"}.</div>`,
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
