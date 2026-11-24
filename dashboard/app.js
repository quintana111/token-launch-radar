// Token Launch Radar dashboard. Loads the local board.json and renders the
// board, detail drawer, scatter, filters, and methodology. No network use.
"use strict";
const $ = (id) => document.getElementById(id);
const JUDGE = "This radar recomputes its board and validation from the sealed 14 Nov 2026 snapshot. Implied values are size-curve estimates calibrated on traded market caps, not FDVs, launch probabilities, or promised airdrops. Farming returns assume a hypothetical 10% depositor allocation and a $1,000 position; token eligibility, execution routes, and unobserved costs require independent verification. Negative economics and unsuccessful validation comparisons are shown, not filtered out.";
const GAS = [["Ethereum", 4, 2.5, 3, 4], ["Base", .08, .04, .06, .08], ["Arbitrum", .15, .08, .1, .15], ["Optimism", .12, .06, .08, .12], ["Solana", .02, .01, .02, .02], ["BSC / BNB Chain", .15, .08, .1, .15], ["Polygon", .03, .02, .03, .03], ["Tron", 2.5, 1.5, 2, 2.5], ["Ink", .05, .03, .04, .05], ["Bittensor", .15, .1, .15, .15], ["Avalanche", .08, .04, .06, .08], ["Sonic / Fantom", .04, .02, .03, .04], ["Linea / Scroll", .15, .08, .1, .15], ["zkSync Era", .12, .06, .08, .12], ["Mantle", .08, .04, .06, .08], ["Gnosis", .02, .01, .02, .02], ["Hyperliquid L1 / HyperEVM", .1, .05, .08, .1], ["Sei / Sui / Aptos", .03, .02, .03, .03], ["Berachain", .08, .04, .06, .08], ["Other recognized chain", 1, .5, .75, 1]];
const fmt$ = (v) => v == null ? "—" : v >= 1e9 ? "$" + (v / 1e9).toFixed(2) + "B" : v >= 1e6 ? "$" + (v / 1e6).toFixed(2) + "M" : v >= 1e3 ? "$" + (v / 1e3).toFixed(1) + "K" : "$" + Math.round(v);
const fmtInt = (v) => v == null ? "—" : Math.round(v).toLocaleString("en-US");
const fmt2 = (v) => (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const log10 = Math.log10;
let BOARD = null, META = null, ROWS = [], SORT = { k: "implied_value_usd", dir: -1 };

function verify(rows, meta) {
  if (rows.length !== 198) return "rows " + rows.length + "/198";
  const ranks = new Set(rows.map((r) => r.rank));
  if (ranks.size !== 198 || Math.min(...ranks) !== 1 || Math.max(...ranks) !== 198) return "rank sequence broken";
  if (rows.filter((r) => r.tier === "WATCHLIST").length !== 40) return "watchlist != 40";
  if (rows.some((r) => !Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0)) return "bad implied value";
  if (rows.some((r, i) => i && rows[i - 1].implied_value_usd < r.implied_value_usd)) return "not sorted by value";
  if (meta.counts.records !== 758) return "records != 758";
  return null;
}

function scatter() {
  const svg = $("scatter"), W = 460, H = 300, P = 34;
  const comps = META.scatter_comps || [];
  const allX = comps.map((c) => log10(c[0])).concat(ROWS.map((r) => log10(r.tvl_usd)));
  const allY = comps.map((c) => log10(c[1])).concat(ROWS.map((r) => log10(r.implied_value_usd)));
  const x0 = Math.floor(Math.min(...allX)), x1 = Math.ceil(Math.max(...allX));
  const y0 = Math.floor(Math.min(...allY)), y1 = Math.ceil(Math.max(...allY));
  const X = (v) => P + (log10(v) - x0) / (x1 - x0) * (W - 2 * P);
  const Y = (v) => H - P - (log10(v) - y0) / (y1 - y0) * (H - 2 * P);
  const ax = (v) => v >= 1e9 ? "$" + (v / 1e9) + "B" : v >= 1e6 ? "$" + (v / 1e6) + "M" : "$" + v;
  let s = "";
  for (let g = x0; g <= x1; g++) s += `<line x1="${X(10 ** g)}" y1="${P}" x2="${X(10 ** g)}" y2="${H - P}" stroke="#e3ded0"/><text x="${X(10 ** g)}" y="${H - 12}" font-size="9" fill="#5c665e" text-anchor="middle">${ax(10 ** g)}</text>`;
  for (let g = y0; g <= y1; g++) s += `<line x1="${P}" y1="${Y(10 ** g)}" x2="${W - P}" y2="${Y(10 ** g)}" stroke="#e3ded0"/><text x="6" y="${Y(10 ** g) + 3}" font-size="9" fill="#5c665e">${ax(10 ** g)}</text>`;
  const a = META.model.a, b = META.model.b;
  let path = "";
  for (let t = x0; t <= x1; t += 0.1) { const tv = 10 ** t, mv = 10 ** a * (tv / 1e8) ** b; path += (path ? "L" : "M") + X(tv).toFixed(1) + "," + Y(mv).toFixed(1); }
  s += `<path d="${path}" fill="none" stroke="#24634C" stroke-width="2"/>`;
  for (const c of comps) s += `<circle cx="${X(c[0]).toFixed(1)}" cy="${Y(c[1]).toFixed(1)}" r="2.4" fill="#8a938c"/>`;
  for (const r of ROWS) s += `<circle data-slug="${esc(r.slug)}" cx="${X(r.tvl_usd).toFixed(1)}" cy="${Y(r.implied_value_usd).toFixed(1)}" r="2.6" fill="none" stroke="#B86739" stroke-width="1.2"><title>${esc(r.name)}</title></circle>`;
  s += `<text x="${P}" y="14" font-size="10" fill="#5c665e">TVL → · market cap / implied value ↑ (log scale)</text>`;
  svg.innerHTML = s;
  svg.querySelectorAll("circle[data-slug]").forEach((c) => c.addEventListener("click", () => openDetail(c.getAttribute("data-slug"))));
}

function rowHtml(r, lo, hi) {
  const pct7 = r.change_7d == null ? "—" : fmt2(r.change_7d / 100);
  const age = r.age_days == null ? "—" : r.age_days + "d";
  const w = Math.max(0, Math.min(100, (log10(r.p90_usd) - log10(lo)) / (log10(hi) - log10(lo)) * 100));
  const wl = Math.max(0, Math.min(100, (log10(r.p10_usd) - log10(lo)) / (log10(hi) - log10(lo)) * 100));
  const mid = Math.max(0, Math.min(100, (log10(r.implied_value_usd) - log10(lo)) / (log10(hi) - log10(lo)) * 100));
  const flags = r.flags.length ? `<span class="flag" title="${esc(r.flags.join("; "))}">⚑ ${r.flags.length}</span>` : "";
  return `<tr data-slug="${esc(r.slug)}"><td><span class="name">${esc(r.name)}</span><span class="tier${r.tier === "EARLY" ? " early" : ""}">${r.tier}</span><span class="sub">${esc(r.category)} · ${esc(r.chains.join(", ") || "—")}</span>${flags}</td><td>${fmt$(r.tvl_usd)}</td><td>${pct7}</td><td>${age}</td><td>${fmt$(r.implied_value_usd)}<div class="bar" title="P10 ${fmt$(r.p10_usd)} – P90 ${fmt$(r.p90_usd)}"><i style="left:${wl}%;width:${Math.max(1, w - wl)}%"></i><b style="left:${mid}%"></b></div><span class="sub">${fmt$(r.p10_usd)} – ${fmt$(r.p90_usd)}</span></td><td>${fmt$(r.slice_usd)}</td><td>${r.net_usd < 0 ? "−" : ""}${fmt$(Math.abs(r.net_usd))}</td><td><span class="v-${r.verdict}">${r.verdict}</span><span class="sub">fees ${fmt$(r.fees_usd)} · ${r.hours.toFixed(1)}h</span></td></tr>`;
}

function filtered() {
  const q = $("q").value.trim().toLowerCase(), tier = $("fTier").value, cat = $("fCat").value, ch = $("fChain").value;
  const sz = $("fSize").value, vd = $("fVerdict").value, miss = $("fMissing").checked, sib = $("fSibling").checked, rt = $("fRoute").checked;
  return ROWS.filter((r) => {
    if (q && !(r.name + " " + r.slug + " " + r.category).toLowerCase().includes(q)) return false;
    if (tier && r.tier !== tier) return false;
    if (cat && r.category !== cat) return false;
    if (ch && !r.chains.includes(ch)) return false;
    if (sz === "above" && !r.above_50m) return false;
    if (sz === "below" && r.above_50m) return false;
    if (vd && r.verdict !== vd) return false;
    if (miss && !r.flags.some((f) => f.startsWith("Missing") || f === "CHAIN UNVERIFIED")) return false;
    if (sib && r.sibling_k === 0) return false;
    if (rt && r.route_verified) return false;
    return true;
  });
}

function render() {
  const list = filtered().sort((a, b) => {
    const k = SORT.k, av = a[k], bv = b[k];
    const c = (av == null ? -1 : av) < (bv == null ? -1 : bv) ? -1 : (av == null ? -1 : av) > (bv == null ? -1 : bv) ? 1 : 0;
    return (c || (a.slug < b.slug ? -1 : 1)) * SORT.dir;
  });
  const lo = Math.min(...ROWS.map((r) => r.p10_usd)), hi = Math.max(...ROWS.map((r) => r.p90_usd));
  $("board").querySelector("tbody").innerHTML = list.map((r) => rowHtml(r, lo, hi)).join("") || `<tr><td colspan="8">No rows match the filters.</td></tr>`;
  $("count").textContent = list.length + " of " + ROWS.length + " rows";
  $("board").querySelectorAll("tbody tr[data-slug]").forEach((tr) => tr.addEventListener("click", () => openDetail(tr.getAttribute("data-slug"))));
}

function wfRow(label, v, mult) { return `<tr><td>${label}</td><td>${fmt$(v)}</td><td>${mult == null ? "" : "×" + mult.toFixed(4)}</td></tr>`; }

function openDetail(slug) {
  const r = ROWS.find((x) => x.slug === slug); if (!r) return;
  const peers = r.peers.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(p.category)}</td><td>${fmt$(p.tvl_usd)}</td><td>${fmt$(p.mcap_usd)}</td><td>${p.ratio.toFixed(2)}</td></tr>`).join("");
  const steps = r.farm_steps.map((s, i) => `<li><b>Step ${i + 1}.</b> ${esc(s)}</li>`).join("");
  const flags = r.flags.length ? `<ul>${r.flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "<p>None.</p>";
  $("detail").innerHTML = `<h2>${esc(r.name)}</h2><p>${esc(r.category)} · <span class="tier${r.tier === "EARLY" ? " early" : ""}">${r.tier}</span> · TVL ${fmt$(r.tvl_usd)} · chains: ${esc(r.chains.join(", ") || "—")}</p>
  <h3>Implied value</h3><p><b>${fmt$(r.implied_value_usd)}</b> · P10–P90 ${fmt$(r.p10_usd)} – ${fmt$(r.p90_usd)} <span class="fn">(nominal 80% range, ±1.2816 residual SD, assuming approximately normal log residuals)</span></p>
  <h3>Value waterfall</h3><table class="wf">${wfRow("Size estimate", r.size_usd)}${wfRow("× family (" + esc(r.category) + ")", r.size_usd * r.family_mult, r.family_mult)}${wfRow("× growth", r.size_usd * r.family_mult * r.growth_mult, r.growth_mult)}${wfRow("× seasoning", r.size_usd * r.family_mult * r.growth_mult * r.seasoning_mult, r.seasoning_mult)}${wfRow("× siblings (k=" + r.sibling_k + (r.sibling_names.length ? ": " + esc(r.sibling_names.join(", ")) : "") + ")", r.size_usd * r.family_mult * r.growth_mult * r.seasoning_mult * r.sibling_mult, r.sibling_mult)}${wfRow("× breadth", r.implied_value_usd, r.breadth_mult)}</table>
  <h3>Nearest traded peers</h3><p class="fn">Nearest by TVL, not necessarily business-model equivalents.</p><table class="wf"><tr><td><b>Peer</b></td><td><b>Category</b></td><td><b>TVL</b></td><td><b>Mcap</b></td><td><b>Mcap/TVL</b></td></tr>${peers}</table>
  <h3>Farm scenario — $1,000 for 56 days, ${esc(r.play_type)}, cheapest chain ${esc(r.farm_chain || "unverified")} (${esc(r.chain_label)})</h3>
  <p>$1K modeled allocation ${fmt$(r.slice_usd)} − modeled fees ${fmt$(r.fees_usd)} − T-bill forgone ${fmt$(r.tbill_usd)} = <b>net ${r.net_usd < 0 ? "−" : ""}${fmt$(Math.abs(r.net_usd))}</b> · ${r.hours.toFixed(1)} hands-on hours · net/hour ${fmt$(r.net_per_hour_usd)} · verdict <span class="v-${r.verdict}">${r.verdict}</span>${r.route_verified ? "" : " · Route unverified—do not execute this template."}</p>
  <h3>Seven-step plan</h3><ol>${steps}</ol>
  <h3>Missing-data flags &amp; caveats</h3>${flags}
  <h3>Source record</h3><pre>${esc(JSON.stringify({ slug: r.slug, name: r.name, category: r.category, chains: r.chains, tvl_usd: r.tvl_usd, change_7d: r.change_7d, listed_at: r.listed_at }, null, 2))}</pre>`;
  $("drawer").hidden = false;
}

function methodology() {
  const fam = META.family.map((f) => `<tr><td>${esc(f.category)}</td><td>${f.n}</td><td>${f.mean_resid.toFixed(3)}</td><td>${f.delta.toFixed(3)}</td><td>×${f.mult.toFixed(3)}</td></tr>`).join("");
  const gas = GAS.map((g) => `<tr><td>${g[0]}</td><td>$${g[1].toFixed(2)}</td><td>$${g[2].toFixed(2)}</td><td>$${g[3].toFixed(2)}</td><td>$${g[4].toFixed(2)}</td></tr>`).join("");
  const c = META.counts, v = META.validation;
  $("methodBody").innerHTML = `<h3>Model</h3><p>log10(mcap USD) = ${META.model.a.toFixed(4)} + ${META.model.b.toFixed(4)} × log10(TVL/$100M), fitted by OLS on ${META.model.calibration_n} traded comps (finite TVL &gt; 0, mcap ≥ $1M, unique slug). Base OLS residual SD ${META.model.resid_sd_ols.toFixed(4)}; full-model residual SD ${META.model.resid_sd_full.toFixed(4)} (mean ${META.model.mean_resid_full.toFixed(4)}). Equivalent unnormalized intercept aUSD = ${META.model.a_usd.toFixed(4)}. House exclusions shape board eligibility, not calibration membership: a traded bridge or liquid-staking protocol can inform the size relationship without becoming an eligible recommendation.</p>
  <h3>Family offsets (category, n, mean residual, shrunk δ, multiplier)</h3><table><tr><th>Category</th><th>n</th><th>Mean resid</th><th>δ</th><th>×</th></tr>${fam}</table>
  <p>Prior strength 8 observations; minimum evidence 4 comps; clamp 0.70–1.40. Unknown category: ×1.</p>
  <h3>Validation</h3><p>Leave-one-out (n=${v.loo.testN}): curve median error ×${v.loo.curve.medianError.toFixed(2)}, within 3× ${(v.loo.curve.within3x * 100).toFixed(1)}%, coverage ${(v.loo.curve.coverage * 100).toFixed(1)}% · flat median error ×${v.loo.flat.medianError.toFixed(2)}, within 3× ${(v.loo.flat.within3x * 100).toFixed(1)}%, coverage ${(v.loo.flat.coverage * 100).toFixed(1)}% · improvement ${v.loo.improvementPct.toFixed(1)}%.</p>
  <p>Listing-cohort holdout, using snapshot-date TVL and market cap. This is not a historical trading backtest. Train ${v.cohort.trainN} (listed before 2024-01-01), test ${v.cohort.testN} (listed 2024-01-01 or later), omitted ${v.cohort.omittedN} (unknown/invalid dates). Curve median error ×${v.cohort.curve.medianError.toFixed(2)}, within 3× ${(v.cohort.curve.within3x * 100).toFixed(1)}%, coverage ${(v.cohort.curve.coverage * 100).toFixed(1)}% · flat ×${v.cohort.flat.medianError.toFixed(2)} · improvement ${v.cohort.improvementPct.toFixed(1)}%.</p>
  <h3>Gas table (USD per modeled transaction)</h3><table><tr><th>Chain</th><th>Deposit</th><th>Weekly</th><th>Claim</th><th>Exit</th></tr>${gas}</table>
  <p>Cheapest listed chain by total modeled plan cost. Unlisted chains use the “Other recognized chain” fallback and are flagged CHAIN UNVERIFIED.</p>
  <h3>House exclusions</h3><p>Categories: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX. Names containing standalone wrapped / staked / staking; versioned names (v + digits, version + digits); exchange-name prefixes (binance, coinbase, kraken, okx, bybit, bitget, kucoin, gate.io, gemini, bitfinex, htx, huobi, mexc, upbit, bithumb). No undocumented exclusions.</p>
  <h3>Reconciliation (758 records)</h3><p>Invalid/duplicate/invalid TVL: ${c.invalid} · traded or token-evidenced: ${c.traded} · excluded by house rule: ${c.excluded} · board rows: ${c.board} (${c.watchlist} WATCHLIST, ${c.early} EARLY, ${c.above_50m} above $50M). 110 is the calibration subset, not all traded records.</p>`;
}

async function init() {
  $("judge").textContent = JUDGE;
  let data;
  try { data = await (await fetch("../board.json")).json(); }
  catch (e) { document.body.innerHTML = "<p style='padding:20px'>Could not load ../board.json — serve the output directory over HTTP and reload.</p>"; return; }
  BOARD = data; META = data.meta; ROWS = data.rows;
  $("modelBadge").textContent = "model " + META.model_version;
  $("equation").textContent = META.model.equation + "  ·  N = " + META.model.calibration_n + " traded comps  ·  $10^" + META.model.a.toFixed(4) + " × (TVL/$100M)^" + META.model.b.toFixed(4);
  const v = META.validation;
  $("valid").innerHTML = `<div>Leave-one-out: curve median error <b>×${v.loo.curve.medianError.toFixed(2)}</b>, within 3× <b>${(v.loo.curve.within3x * 100).toFixed(1)}%</b>, coverage <b>${(v.loo.curve.coverage * 100).toFixed(1)}%</b> · flat ×${v.loo.flat.medianError.toFixed(2)} (improvement ${v.loo.improvementPct.toFixed(1)}%)</div><div>Listing-cohort: curve <b>×${v.cohort.curve.medianError.toFixed(2)}</b>, within 3× <b>${(v.cohort.curve.within3x * 100).toFixed(1)}%</b>, coverage <b>${(v.cohort.curve.coverage * 100).toFixed(1)}%</b> · flat ×${v.cohort.flat.medianError.toFixed(2)} (train ${v.cohort.trainN}, test ${v.cohort.testN})</div>`;
  const problem = verify(ROWS, META);
  const c = META.counts;
  $("receipts").innerHTML = `<span>Page = board.json · <b>${problem ? "NOT verified: " + esc(problem) : "198/198 rows verified"}</b></span><span>Watchlist <b>${c.watchlist}/40 covered</b></span><span>Recomputed from sealed snapshot</span><span>Snapshot <b>${esc(META.snapshot_hash.slice(0, 12))}…</b></span><span>Model <b>${esc(META.model_version)}</b></span>`;
  $("stats").innerHTML = `<span>Eligible pre-token <b>${c.board}</b></span><span>Watchlist <b>${c.watchlist}</b></span><span>EARLY <b>${c.early}</b></span><span>Above-$50M EARLY <b>${ROWS.filter((r) => r.tier === "EARLY" && r.above_50m).length}</b></span><span>FARM <b>${META.verdicts.FARM}</b> · THIN <b>${META.verdicts.THIN}</b> · SKIP <b>${META.verdicts.SKIP}</b> · VERIFY <b>${META.verdicts.VERIFY}</b></span><span>Traded set aside <b>${c.traded}</b> · house-rule set aside <b>${c.excluded}</b></span>`;
  const cats = [...new Set(ROWS.map((r) => r.category))].sort();
  const chains = [...new Set(ROWS.flatMap((r) => r.chains))].sort();
  for (const cat of cats) { const o = document.createElement("option"); o.textContent = cat; $("fCat").appendChild(o); }
  for (const ch of chains) { const o = document.createElement("option"); o.textContent = ch; $("fChain").appendChild(o); }
  $("live").querySelector("tbody").innerHTML = (META.live_top24 || []).map((p) => `<tr><td><span class="name">${esc(p.name)}</span><span class="sub">${esc(p.slug)}</span></td><td>${esc(p.category)}</td><td>${fmt$(p.tvl_usd)}</td><td>${fmt$(p.mcap_usd)}</td><td>${p.ratio.toFixed(2)}</td></tr>`).join("");
  scatter(); render(); methodology();
  // Deep links for sharing a view: #detail=<slug>, #verdict=FARM, #tier=WATCHLIST.
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get("verdict")) { $("fVerdict").value = hash.get("verdict"); render(); }
  if (hash.get("tier")) { $("fTier").value = hash.get("tier"); render(); }
  if (hash.get("detail")) setTimeout(() => openDetail(hash.get("detail")), 150);
  for (const id of ["q", "fTier", "fCat", "fChain", "fSize", "fVerdict", "fMissing", "fSibling", "fRoute"]) $(id).addEventListener("input", render);
  $("reset").addEventListener("click", () => { $("q").value = ""; for (const id of ["fTier", "fCat", "fChain", "fSize", "fVerdict"]) $(id).value = ""; for (const id of ["fMissing", "fSibling", "fRoute"]) $(id).checked = false; render(); });
  $("board").querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => { const k = th.getAttribute("data-k"); SORT.dir = SORT.k === k ? -SORT.dir : (k === "name" ? 1 : -1); SORT.k = k; render(); }));
  $("close").addEventListener("click", () => { $("drawer").hidden = true; });
  $("tabBoard").addEventListener("click", () => { $("tabBoard").classList.add("on"); $("tabLive").classList.remove("on"); $("boardPane").hidden = false; $("livePane").hidden = true; });
  $("tabLive").addEventListener("click", () => { $("tabLive").classList.add("on"); $("tabBoard").classList.remove("on"); $("livePane").hidden = false; $("boardPane").hidden = true; });
}
init();
