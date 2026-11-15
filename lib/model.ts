const MAX_VALUE = 100_000_000_000_000;
const UNKNOWN_AGE_DAYS = null;

function finitePositive(value) {
  return Number.isFinite(value) && value > 0;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function observedDays(asOf, listedAt) {
  if (!asOf || !listedAt) return UNKNOWN_AGE_DAYS;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return UNKNOWN_AGE_DAYS;
  return Math.max(0, Math.floor((end - start) / 86_400_000));
}

export function classifyTokenStatus(protocol) {
  if (finitePositive(protocol?.mcap_usd)) return 'trading';
  if (protocol?.gecko_id != null || protocol?.symbol != null) return 'recorded-no-market-cap';
  return 'no-token-recorded';
}

function categoryAction(category) {
  const c = String(category ?? '').toLowerCase();
  if (c.includes('lending')) return 'If the app and terms check out, supply a small liquid asset, do not borrow, then test a withdrawal.';
  if (c.includes('dex') || c.includes('exchange')) return 'Start with one small spot swap; avoid LP positions until you understand pool depth and impermanent-loss exposure.';
  if (c.includes('yield') || c.includes('vault') || c.includes('curator') || c.includes('allocator')) return 'Inspect the strategy and manager first; if risks and exits are clear, test one small deposit and withdrawal.';
  if (c.includes('rwa')) return 'Check jurisdiction, eligibility and redemption terms first; skip the interaction if you are not explicitly eligible.';
  if (c.includes('restak') || c.includes('staking')) return 'Read slashing, lock-up and withdrawal rules first; avoid leverage and skip deposits if the exit window is unclear.';
  if (c.includes('basis') || c.includes('derivative') || c.includes('perp')) return 'Paper-test the strategy and liquidation path; do not use leverage or funds you cannot afford to lose.';
  if (c.includes('bridge') || c.includes('chain')) return 'Verify the official network and bridge route; do not bridge until both endpoints and the exit route are confirmed.';
  if (c.includes('insurance')) return 'Read exclusions, claim triggers and payout terms; request a quote before considering any coverage purchase.';
  if (c.includes('payment')) return 'Test one low-value payment and confirm settlement and refund behavior before using it for anything important.';
  return 'Use only the app’s core, documented action; start with a reversible, low-value test and avoid leverage.';
}

function farmPlan(protocol, snapshot) {
  const chain = Array.isArray(protocol.chains) && protocol.chains.length ? protocol.chains[0] : 'the listed chain';
  const action = categoryAction(protocol.category);
  return [
    `Verify ${protocol.name} in its official documentation and confirm ${chain} is supported. Cost: $0. Time: 10 minutes.`,
    `Cross-check the app’s contract addresses against its own docs and at least one official announcement; do not follow unsolicited links. Cost: $0. Time: 5 minutes.`,
    `Read the ${protocol.category ?? 'protocol'} risk, custody and exit terms; confirm the action is reversible and there is no hidden lock. Cost: $0. Time: 10 minutes.`,
    `${action} Cost: $10–$25 maximum test capital at risk, plus the chain’s variable transaction fee. Time: 10–20 minutes.`,
    `If you interacted, test the exit path with the smallest practical withdrawal or reversal and keep the transaction IDs. Cost: one variable network fee; capital remains at risk until settled. Time: 5–15 minutes.`,
    `Re-check official updates before repeating; the snapshot records no points or airdrop eligibility, so assume no reward. Cost: $0. Time: 3 minutes weekly. Snapshot: ${snapshot.as_of}.`,
  ];
}

function peerCalibration(protocols) {
  const logs = [];
  const byCategory = new Map();
  for (const p of protocols) {
    if (!finitePositive(p.tvl_usd) || !finitePositive(p.mcap_usd)) continue;
    if (p.gecko_id == null && p.symbol == null) continue;
    const logRatio = Math.log(p.mcap_usd / p.tvl_usd);
    if (!Number.isFinite(logRatio)) continue;
    logs.push(logRatio);
    if (p.category != null) {
      if (!byCategory.has(p.category)) byCategory.set(p.category, []);
      byCategory.get(p.category).push(logRatio);
    }
  }
  const globalLog = median(logs) ?? Math.log(0.25);
  return { globalLog, byCategory, peerCount: logs.length };
}

function multipleFor(category, calibration) {
  const peers = category == null ? [] : (calibration.byCategory.get(category) ?? []);
  const categoryLog = median(peers);
  const priorWeight = 4;
  const categoryWeight = categoryLog == null ? 0 : peers.length / (peers.length + priorWeight);
  const logMultiple = categoryLog == null
    ? calibration.globalLog
    : categoryWeight * categoryLog + (1 - categoryWeight) * calibration.globalLog;
  return { value: Math.exp(logMultiple), peerCount: peers.length, categoryWeight };
}

function growthFactor(change7d) {
  if (!Number.isFinite(change7d)) return 1;
  const bounded = Math.max(-50, Math.min(100, change7d));
  return Math.exp(0.25 * Math.tanh(bounded / 25));
}

function maturityFactor(days) {
  if (days == null) return 0.90;
  return 0.75 + 0.25 * (1 - Math.exp(-days / 365));
}

export const MODEL = Object.freeze({
  id: 'radar-comps-1',
  method: 'Scenario FDV = TVL × snapshot live-token market-cap/TVL comparable multiple × a capped seven-day growth factor × an observed tracking-age factor. Comparable multiples are medians in log space by category, shrunk toward the snapshot-wide median with four prior peers. Tracking age is only the time DefiLlama has observed the protocol; it is not its true launch date. This is a scenario, not a prediction of a token launch or airdrop.',
  prior_peers: 4,
  growth_clamp_percent: [-50, 100],
  max_value_usd: MAX_VALUE,
});

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;

function isPreTokenCandidate(protocol) {
  const name = String(protocol.name ?? '');
  return classifyTokenStatus(protocol) === 'no-token-recorded'
    && !EXCLUDED_CATEGORIES.has(protocol.category)
    && !EXCHANGE_PREFIX.test(name)
    && !WRAPPED_OR_STAKED.test(name)
    && !VERSION_SUFFIX.test(name);
}

export function buildBoard(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new TypeError('Snapshot must contain protocols and watchlist arrays.');
  }
  const calibration = peerCalibration(snapshot.protocols);
  const rows = snapshot.protocols
    .filter(isPreTokenCandidate)
    .map(p => {
      const comps = multipleFor(p.category, calibration);
      const days = observedDays(snapshot.as_of, p.listed_at);
      const growth = growthFactor(p.change_7d);
      const maturity = maturityFactor(days);
      const scenarioValue = p.tvl_usd * comps.value * growth * maturity;
      const impliedValue = Math.max(1, Math.min(MAX_VALUE, Math.round(Number.isFinite(scenarioValue) ? scenarioValue : 1)));
      const confidence = comps.peerCount >= 12 ? 'stronger comps' : comps.peerCount >= 5 ? 'some comps' : 'thin comps';
      return {
        slug: p.slug,
        name: p.name,
        category: p.category,
        chains: p.chains,
        tvl_usd: p.tvl_usd,
        change_7d: p.change_7d,
        listed_at: p.listed_at,
        observed_days: days,
        token_status: classifyTokenStatus(p),
        implied_value_usd: impliedValue,
        model_multiple: Number(comps.value.toFixed(6)),
        growth_factor: Number(growth.toFixed(4)),
        maturity_factor: Number(maturity.toFixed(4)),
        comparable_count: comps.peerCount,
        category_comparable_weight: Number(comps.categoryWeight.toFixed(4)),
        confidence,
        farm_steps: farmPlan(p, snapshot),
      };
    })
    .sort((a, b) => b.implied_value_usd - a.implied_value_usd || a.slug.localeCompare(b.slug));
  for (let i = 0; i < rows.length; i++) rows[i].rank = i + 1;
  const rowSlugs = new Set(rows.map(r => r.slug));
  const missingWatchlist = snapshot.watchlist.filter(slug => !rowSlugs.has(slug));
  if (missingWatchlist.length) throw new Error(`Snapshot watchlist coverage failure: ${missingWatchlist.join(', ')}`);
  return {
    rows,
    model: {
      ...MODEL,
      as_of: snapshot.as_of,
      live_comparables: calibration.peerCount,
      global_multiple: Number(Math.exp(calibration.globalLog).toFixed(6)),
      watchlist_count: snapshot.watchlist.length,
      ranked_count: rows.length,
      disclaimer: 'DefiLlama snapshot labels are evidence of what is recorded, not proof that a protocol has no token. No launch date, airdrop or reward is predicted.',
    },
  };
}
