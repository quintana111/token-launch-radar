// Token Launch Radar — valuation model, validation, farm economics.
// Fresh implementation from the design spec. No entry code is copied here.
export const MODEL_VERSION = "token-radar-v3.1";
export const SNAPSHOT_DATE = "2026-11-14";
export const SNAPSHOT_DAY = Date.UTC(2026, 10, 14);
export const DAY_MS = 86400000;
export const DEPOSIT_USD = 1000;
export const HOLD_DAYS = 56;
export const ALLOC_SHARE = 0.10;
export const TBILL_RATE = 0.04;
export const Z80 = 1.2815515655;

export interface SnapRecord {
  slug: string; name: string; category: string | null; chains: string[] | null;
  tvl_usd: number | null; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface SnapFile {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapRecord[]; watchlist: string[];
}

export const log10 = (x: number) => Math.log10(x);
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const finiteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** UTC whole days between a YYYY-MM-DD listing date and the snapshot date. */
export function ageDays(listedAt: string | null | undefined): number | null {
  if (!listedAt || typeof listedAt !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(listedAt.trim());
  if (!m) return null;
  const day = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (!Number.isFinite(day)) return null;
  return Math.floor((SNAPSHOT_DAY - day) / DAY_MS);
}

export function growthFactor(change7d: number | null | undefined): number {
  if (!finiteNum(change7d)) return 1;
  return 1 + 0.5 * (clamp(change7d, -30, 30) / 100);
}

export function seasoningFactor(days: number | null | undefined): number {
  if (days === null || days === undefined || !Number.isFinite(days)) return 1;
  const d = Math.max(0, days);
  if (d <= 548) return clamp(0.90 + 0.15 * (d / 548), 0.90, 1.05);
  if (d <= 1095) return clamp(1.05 - 0.10 * ((d - 548) / 547), 0.90, 1.05);
  return 0.95;
}

/** Flat-baseline maturity curve (v1-style), used only inside validation. */
export function maturityFactor(days: number | null | undefined): number {
  if (days === null || days === undefined || !Number.isFinite(days)) return 1;
  return 0.75 + 0.35 * (clamp(days, 0, 1095) / 1095);
}

export function breadthFactor(chains: string[] | null | undefined): number {
  if (!chains || !Array.isArray(chains)) return 1;
  const uniq = new Set(chains.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim().toLowerCase()));
  if (uniq.size === 0) return 1;
  return 1 + 0.03 * Math.log2(clamp(uniq.size, 1, 8));
}

export function chainCount(chains: string[] | null | undefined): number {
  if (!chains || !Array.isArray(chains)) return 0;
  return new Set(chains.filter((c) => typeof c === "string" && c.trim()).map((c) => c.trim().toLowerCase())).size;
}

/** Normalise a protocol name for sibling matching (NFKD, strip marks, lower, punctuation to spaces). */
export function normaliseName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\s+v\d+(\.\d+)*$/, "").replace(/\s+version\s+\d+$/, "").replace(/\s+protocol$/, "");
}

const FIRST_WORD_STOP = new Set(["the", "defi", "yield", "liquid", "staked", "staking", "wrapped", "finance", "protocol", "vault", "vaults", "pool", "pools"]);

export function namesAreSiblings(a: string, b: string): boolean {
  const na = normaliseName(a), nb = normaliseName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const fa = na.split(" ")[0], fb = nb.split(" ")[0];
  return fa === fb && fa.length >= 4 && !FIRST_WORD_STOP.has(fa);
}

/** Count other records (from `pool`) that are name siblings of `rec`. */
export function siblingCount(rec: SnapRecord, pool: SnapRecord[]): number {
  let k = 0;
  for (const other of pool) {
    if (other.slug === rec.slug) continue;
    if (namesAreSiblings(rec.name, other.name)) k++;
  }
  return k;
}

export function siblingFactor(k: number): number {
  return 1 - 0.04 * Math.min(k, 2);
}

export interface OlsFit { a: number; b: number; n: number; meanX: number; meanY: number; residSd: number; }

export function fitOls(rows: SnapRecord[]): OlsFit {
  if (rows.length < 3) throw new Error(`OLS needs at least 3 observations, got ${rows.length}`);
  const xs = rows.map((r) => log10(r.tvl_usd! / 100_000_000));
  const ys = rows.map((r) => log10(r.mcap_usd!));
  const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - meanX) * (ys[i] - meanY); den += (x - meanX) * (x - meanX); });
  if (den === 0) throw new Error("OLS failed: zero variance in log TVL");
  const b = num / den;
  const a = meanY - b * meanX;
  let ss = 0;
  xs.forEach((x, i) => { const e = ys[i] - (a + b * x); ss += e * e; });
  return { a, b, n: rows.length, meanX, meanY, residSd: Math.sqrt(ss / (rows.length - 2)) };
}

export interface FamilyInfo { n: number; meanResid: number; delta: number; mult: number; }

/** Category-family offsets with shrinkage prior strength 8 and clamp [log10(0.70), log10(1.40)]. */
export function familyOffsets(rows: SnapRecord[], fit: OlsFit): Map<string, FamilyInfo> {
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    const cat = (r.category || "").trim();
    const resid = log10(r.mcap_usd!) - (fit.a + fit.b * log10(r.tvl_usd! / 100_000_000));
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(resid);
  }
  const out = new Map<string, FamilyInfo>();
  const lo = log10(0.70), hi = log10(1.40);
  for (const [cat, rs] of byCat) {
    const n = rs.length;
    const meanResid = rs.reduce((s, v) => s + v, 0) / n;
    const delta = n < 4 ? 0 : clamp((n / (n + 8)) * meanResid, lo, hi);
    out.set(cat, { n, meanResid, delta, mult: Math.pow(10, delta) });
  }
  return out;
}

export function familyMult(category: string | null | undefined, table: Map<string, FamilyInfo>): number {
  const info = table.get((category || "").trim());
  return info ? info.mult : 1;
}

/** Full-model residual scale: sample SD of log residuals around their own mean. */
export function residualScale(errors: number[]): { mean: number; sd: number } {
  const n = errors.length;
  const mean = errors.reduce((s, v) => s + v, 0) / n;
  let ss = 0;
  for (const e of errors) ss += (e - mean) * (e - mean);
  return { mean, sd: n > 1 ? Math.sqrt(ss / (n - 1)) : 0 };
}

export interface FactorBreakdown {
  size: number; family: number; growth: number; seasoning: number; sibling: number; breadth: number;
  value: number; siblingK: number; siblingNames: string[];
}

/** Complete estimator for one record, given a fit, family table and a sibling pool. */
export function estimateValue(rec: SnapRecord, fit: OlsFit, fam: Map<string, FamilyInfo>, pool: SnapRecord[]): FactorBreakdown {
  const size = Math.pow(10, fit.a) * Math.pow(rec.tvl_usd! / 100_000_000, fit.b);
  const family = familyMult(rec.category, fam);
  const growth = growthFactor(rec.change_7d);
  const seasoning = seasoningFactor(ageDays(rec.listed_at));
  const k = siblingCount(rec, pool);
  const sibling = siblingFactor(k);
  const breadth = breadthFactor(rec.chains);
  const siblingNames: string[] = [];
  for (const other of pool) {
    if (other.slug !== rec.slug && namesAreSiblings(rec.name, other.name)) siblingNames.push(other.name);
  }
  const value = size * family * growth * seasoning * sibling * breadth;
  return { size, family, growth, seasoning, sibling, breadth, value, siblingK: k, siblingNames };
}

// ---------------------------------------------------------------------------
// Eligibility, house exclusions, reconciliation
// ---------------------------------------------------------------------------

const NULL_SYMBOL = new Set(["-", "—", "n/a", "none", "null"]);

/** True when the record shows evidence of an already-live token. */
export function hasLiveTokenEvidence(rec: SnapRecord): boolean {
  if (rec.mcap_usd !== null && rec.mcap_usd !== undefined) return true;
  if (typeof rec.gecko_id === "string" && rec.gecko_id.trim() !== "") return true;
  if (typeof rec.symbol === "string") {
    const s = rec.symbol.trim();
    if (s !== "" && !NULL_SYMBOL.has(s.toLowerCase())) return true;
  }
  return false;
}

const EXCLUDED_CATEGORIES = new Set(["bridge", "canonical bridge", "liquid staking", "liquid restaking", "restaked btc", "cex"]);
const EXCLUDED_WORDS = new Set(["wrapped", "staked", "staking"]);
const EXCHANGE_PREFIXES = ["binance", "coinbase", "kraken", "okx", "bybit", "bitget", "kucoin", "gate.io", "gateio", "crypto.com", "cryptocom", "gemini", "bitfinex", "htx", "huobi", "mexc", "upbit", "bithumb"];

function slugWords(rec: SnapRecord): string[] {
  const joined = normaliseName(rec.name) + " " + normaliseName(rec.slug);
  return joined.split(" ").filter(Boolean);
}

function hasVersionedName(rec: SnapRecord): boolean {
  for (const text of [normaliseName(rec.name), normaliseName(rec.slug)]) {
    if (/\bv\d+(\.\d+)*\b/.test(text)) return true;
    if (/\bversion\s+\d+/.test(text)) return true;
  }
  return false;
}

function hasExchangePrefix(rec: SnapRecord): boolean {
  for (const text of [normaliseName(rec.name), normaliseName(rec.slug)]) {
    for (const p of EXCHANGE_PREFIXES) {
      const esc = p.replace(/\./g, "\\.");
      if (new RegExp("^" + esc + "\\b").test(text)) return true;
    }
  }
  return false;
}

/** House-rule exclusion reasons (empty = not excluded). Each reason is independent. */
export function houseExclusionReasons(rec: SnapRecord): string[] {
  const reasons: string[] = [];
  const cat = (rec.category || "").trim().toLowerCase();
  if (EXCLUDED_CATEGORIES.has(cat)) reasons.push("category:" + rec.category);
  const words = new Set(slugWords(rec));
  for (const w of EXCLUDED_WORDS) if (words.has(w)) reasons.push("name-word:" + w);
  if (hasVersionedName(rec)) reasons.push("versioned-name");
  if (hasExchangePrefix(rec)) reasons.push("exchange-prefix");
  return reasons;
}

export type Disposition = "invalid" | "traded" | "excluded" | "board";

export interface LedgerRow { rec: SnapRecord; disposition: Disposition; reasons: string[]; }

/** Assign every record exactly one primary disposition, in spec order. */
export function reconcile(records: SnapRecord[]): LedgerRow[] {
  const seen = new Set<string>();
  return records.map((rec) => {
    const reasons: string[] = [];
    if (!rec.slug || typeof rec.slug !== "string" || seen.has(rec.slug) || !finiteNum(rec.tvl_usd) || (rec.tvl_usd as number) <= 0) {
      reasons.push(!rec.slug ? "missing-slug" : seen.has(rec.slug) ? "duplicate-slug" : "invalid-tvl");
      return { rec, disposition: "invalid", reasons };
    }
    seen.add(rec.slug);
    if (hasLiveTokenEvidence(rec)) {
      if (rec.mcap_usd !== null && rec.mcap_usd !== undefined) reasons.push("has-mcap");
      if (typeof rec.gecko_id === "string" && rec.gecko_id.trim()) reasons.push("has-gecko-id");
      if (typeof rec.symbol === "string" && rec.symbol.trim() && !NULL_SYMBOL.has(rec.symbol.trim().toLowerCase())) reasons.push("has-symbol");
      return { rec, disposition: "traded", reasons };
    }
    const house = houseExclusionReasons(rec);
    if (house.length) return { rec, disposition: "excluded", reasons: house };
    return { rec, disposition: "board", reasons: [] };
  });
}

/** Calibration universe: finite TVL > 0, mcap >= $1M, unique slug. */
export function calibrationSet(records: SnapRecord[]): SnapRecord[] {
  const seen = new Set<string>();
  const out: SnapRecord[] = [];
  for (const rec of records) {
    if (!finiteNum(rec.tvl_usd) || (rec.tvl_usd as number) <= 0) continue;
    if (!finiteNum(rec.mcap_usd) || (rec.mcap_usd as number) < 1_000_000) continue;
    if (!rec.slug || seen.has(rec.slug)) continue;
    seen.add(rec.slug);
    out.push(rec);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Farm economics
// ---------------------------------------------------------------------------

export interface GasRow { deposit: number; weekly: number; claim: number; exit: number; label: string; }
const FALLBACK_GAS: GasRow = { deposit: 1.0, weekly: 0.5, claim: 0.75, exit: 1.0, label: "Other recognized chain" };

const GAS_TABLE: Array<[string[], GasRow]> = [
  [["ethereum"], { deposit: 4.0, weekly: 2.5, claim: 3.0, exit: 4.0, label: "Ethereum" }],
  [["base"], { deposit: 0.08, weekly: 0.04, claim: 0.06, exit: 0.08, label: "Base" }],
  [["arbitrum", "arbitrum nova"], { deposit: 0.15, weekly: 0.08, claim: 0.1, exit: 0.15, label: "Arbitrum" }],
  [["optimism"], { deposit: 0.12, weekly: 0.06, claim: 0.08, exit: 0.12, label: "Optimism" }],
  [["solana"], { deposit: 0.02, weekly: 0.01, claim: 0.02, exit: 0.02, label: "Solana" }],
  [["bsc", "bnb chain", "binance", "op_bnb", "opbnb", "bnb smart chain"], { deposit: 0.15, weekly: 0.08, claim: 0.1, exit: 0.15, label: "BSC / BNB Chain" }],
  [["polygon", "polygon zkevm"], { deposit: 0.03, weekly: 0.02, claim: 0.03, exit: 0.03, label: "Polygon" }],
  [["tron"], { deposit: 2.5, weekly: 1.5, claim: 2.0, exit: 2.5, label: "Tron" }],
  [["ink"], { deposit: 0.05, weekly: 0.03, claim: 0.04, exit: 0.05, label: "Ink" }],
  [["bittensor", "bittensor evm"], { deposit: 0.15, weekly: 0.1, claim: 0.15, exit: 0.15, label: "Bittensor" }],
  [["avalanche"], { deposit: 0.08, weekly: 0.04, claim: 0.06, exit: 0.08, label: "Avalanche" }],
  [["sonic", "fantom"], { deposit: 0.04, weekly: 0.02, claim: 0.03, exit: 0.04, label: "Sonic / Fantom" }],
  [["linea", "scroll"], { deposit: 0.15, weekly: 0.08, claim: 0.1, exit: 0.15, label: "Linea / Scroll" }],
  [["zksync era", "zksync"], { deposit: 0.12, weekly: 0.06, claim: 0.08, exit: 0.12, label: "zkSync Era" }],
  [["mantle"], { deposit: 0.08, weekly: 0.04, claim: 0.06, exit: 0.08, label: "Mantle" }],
  [["gnosis", "xdai"], { deposit: 0.02, weekly: 0.01, claim: 0.02, exit: 0.02, label: "Gnosis" }],
  [["hyperliquid l1", "hyperevm", "hyperliquid"], { deposit: 0.1, weekly: 0.05, claim: 0.08, exit: 0.1, label: "Hyperliquid L1 / HyperEVM" }],
  [["sei", "sui", "aptos"], { deposit: 0.03, weekly: 0.02, claim: 0.03, exit: 0.03, label: "Sei / Sui / Aptos" }],
  [["berachain"], { deposit: 0.08, weekly: 0.04, claim: 0.06, exit: 0.08, label: "Berachain" }],
];

export function gasForChain(chain: string): GasRow {
  const key = chain.trim().toLowerCase();
  for (const [names, row] of GAS_TABLE) if (names.includes(key)) return row;
  return FALLBACK_GAS;
}

export function isNamedGasRow(chain: string): boolean {
  const key = chain.trim().toLowerCase();
  return GAS_TABLE.some(([names]) => names.includes(key));
}

const NON_EVM = new Set(["solana", "sui", "aptos", "sei", "bitcoin", "cardano", "near", "cosmos", "osmosis", "injective", "celestia", "movement", "starknet", "fuel", "mina", "aleo", "kaspa", "ton", "xrp", "xrpl evm", "stellar", "hedera", "algorand", "tezos", "flow", "elrond", "multiversx", "zilliqa", "waves", "radix", "kadena", "ergo", "litecoin", "dogecoin", "doge", "bitcoincash", "dash", "zcash", "decred", "nem", "symbol"]);

/** Approval-unit flag: 1 for EVM chains, 0 otherwise; unknown chains default to 1. */
export function evmFlag(chain: string | null): number {
  if (!chain) return 1;
  return NON_EVM.has(chain.trim().toLowerCase()) ? 0 : 1;
}

export type PlayType = "vault" | "delta-neutral" | "supply-and-borrow" | "mint-and-save" | "liquidity" | "strategy-vault";
export interface PlaySpec { dep: (a: number) => number; maint: number; claim: number; exit: number; setupMin: number; weeklyMin: number; claimExitMin: number; }

export const PLAY_SPECS: Record<PlayType, PlaySpec> = {
  "vault": { dep: (a) => 1 + a, maint: 0, claim: 1, exit: 1, setupMin: 20, weeklyMin: 3, claimExitMin: 15 },
  "delta-neutral": { dep: (a) => 3 + 2 * a, maint: 2, claim: 1, exit: 3, setupMin: 45, weeklyMin: 12, claimExitMin: 30 },
  "supply-and-borrow": { dep: (a) => 2 + a, maint: 1, claim: 1, exit: 2, setupMin: 35, weeklyMin: 8, claimExitMin: 25 },
  "mint-and-save": { dep: (a) => 2 + a, maint: 0, claim: 1, exit: 2, setupMin: 25, weeklyMin: 4, claimExitMin: 20 },
  "liquidity": { dep: (a) => 2 + 2 * a, maint: 1, claim: 1, exit: 2, setupMin: 35, weeklyMin: 10, claimExitMin: 25 },
  "strategy-vault": { dep: (a) => 2 + a, maint: 1, claim: 1, exit: 2, setupMin: 30, weeklyMin: 6, claimExitMin: 20 },
};

/** Priority-ordered play-type mapping over normalised category text. */
export function playTypeFor(category: string | null | undefined): PlayType {
  const c = (category || "").toLowerCase();
  if (c.includes("delta neutral")) return "delta-neutral";
  if (c.includes("lending") || c.includes("money market") || c.includes("borrow")) return "supply-and-borrow";
  if (c.includes("cdp") || c.includes("stablecoin issuer") || c.includes("mint")) return "mint-and-save";
  if (c.includes("dex") || c.includes("amm") || c.includes("liquidity") || c.includes("liquidation")) return "liquidity";
  if (c.includes("yield aggregator") || c.includes("leveraged farming") || c.includes("strategy")) return "strategy-vault";
  return "vault";
}

const UNVERIFIED_ROUTE = ["prediction", "derivativ", "curator", "insurance", "payment", "governance", "otc", "card issuer", "interest rate", "cross chain"];
/** Deposit route is unverified for prediction markets, derivatives, curators and similar non-deposit categories. */
export function routeVerified(category: string | null | undefined): boolean {
  const c = (category || "").trim().toLowerCase();
  if (c === "chain") return false;
  if (c.includes("index")) return false;
  return !UNVERIFIED_ROUTE.some((p) => c.includes(p));
}

export interface FarmScenario {
  playType: PlayType; chain: string | null; chainLabel: string; chainVerified: boolean;
  routeVerified: boolean; slice: number; fees: number; tbill: number; net: number;
  hours: number; netPerHour: number; verdict: "FARM" | "THIN" | "SKIP" | "VERIFY";
  weeklyEvents: number; depUnits: number; maintUnits: number; claimUnits: number; exitUnits: number;
}

export function weeklyEvents(days: number): number { return Math.floor((days - 1) / 7); }

export function farmScenario(rec: SnapRecord, value: number): FarmScenario {
  const playType = playTypeFor(rec.category);
  const spec = PLAY_SPECS[playType];
  const days = HOLD_DAYS;
  const w = weeklyEvents(days);
  const chains = (rec.chains || []).filter((c) => typeof c === "string" && c.trim());
  const chainVerified = chains.length > 0;
  const routeOk = routeVerified(rec.category);
  let best: { chain: string | null; gas: GasRow; total: number; dep: number } | null = null;
  for (const ch of chains) {
    const gas = gasForChain(ch);
    const a = evmFlag(ch);
    const dep = spec.dep(a);
    const total = dep * gas.deposit + w * spec.maint * gas.weekly + spec.claim * gas.claim + spec.exit * gas.exit;
    if (!best || total < best.total) best = { chain: ch, gas, total, dep };
  }
  const gas = best ? best.gas : FALLBACK_GAS;
  const aFlag = best && best.chain ? evmFlag(best.chain) : 1;
  const depUnits = spec.dep(aFlag);
  const fees = depUnits * gas.deposit + w * spec.maint * gas.weekly + spec.claim * gas.claim + spec.exit * gas.exit;
  const slice = ALLOC_SHARE * value * (DEPOSIT_USD / (rec.tvl_usd as number));
  const tbill = DEPOSIT_USD * TBILL_RATE * days / 365;
  const net = slice - fees - tbill;
  const hours = (spec.setupMin + w * spec.weeklyMin + spec.claimExitMin) / 60;
  const netPerHour = net / hours;
  let verdict: FarmScenario["verdict"];
  if (!chainVerified || !routeOk) verdict = "VERIFY";
  else if (net > 0) verdict = "FARM";
  else if (net > -10) verdict = "THIN";
  else verdict = "SKIP";
  return {
    playType, chain: best ? best.chain : null, chainLabel: gas.label, chainVerified,
    routeVerified: routeOk, slice, fees, tbill, net, hours, netPerHour, verdict,
    weeklyEvents: w, depUnits, maintUnits: spec.maint, claimUnits: spec.claim, exitUnits: spec.exit,
  };
}

// ---------------------------------------------------------------------------
// Seven-step farm plans
// ---------------------------------------------------------------------------

const PLAY_VERBS: Record<PlayType, { entry: string; watch: string; exit: string }> = {
  "vault": { entry: "Deposit into the verified vault on the cheapest listed chain", watch: "inspect withdrawals and share price each week", exit: "redeem the vault position in full" },
  "delta-neutral": { entry: "Establish both legs of the hedge in the verified app", watch: "inspect hedge drift, margin, and funding each week", exit: "unwind both legs of the hedge" },
  "supply-and-borrow": { entry: "Supply collateral; borrow only if required and understood", watch: "monitor the liquidation buffer and borrow rate each week", exit: "repay any borrow before withdrawing collateral" },
  "mint-and-save": { entry: "Mint against verified collateral and enter the savings route", watch: "monitor the peg and collateral ratio each week", exit: "redeem savings and repay or redeem the minted debt" },
  "liquidity": { entry: "Select the pair and fee tier, then add liquidity", watch: "monitor divergence loss and range position each week", exit: "remove liquidity and collect accrued fees" },
  "strategy-vault": { entry: "Inspect the underlying strategy and lockups, then deposit", watch: "monitor allocations and the withdrawal queue each week", exit: "request and complete the withdrawal" },
};

function money(x: number): string { return "$" + x.toFixed(2); }

/** The seven-step plan for one board row; every step is 20–600 chars. */
export function farmSteps(rec: SnapRecord, farm: FarmScenario): string[] {
  const v = PLAY_VERBS[farm.playType];
  const chain = farm.chain ?? "unverified chain";
  const depCost = money(farm.depUnits * gasForChain(farm.chain ?? "").deposit);
  const maintCost = farm.maintUnits > 0 ? `, ${farm.weeklyEvents} modeled maintenance events at ${money(farm.maintUnits * gasForChain(farm.chain ?? "").weekly)} each` : ", no modeled maintenance transactions";
  const steps = [
    `Day 0 (~10 min, 0 tx): verify the official app, the supported ${chain} route, that no token is live, and the campaign terms. Do not proceed on an unverified link or contract.`,
    `Day 0 (~${Math.max(5, Math.round(PLAY_SPECS[farm.playType].setupMin / 2))} min, ${farm.depUnits} tx, ${depCost} modeled): prepare the $1,000 on ${chain} and approve only the verified contracts needed for entry.`,
    `Day 0: ${v.entry}. Record the entry transaction hashes and the position size before leaving the app.`,
    `Day 0–1 (~5 min, 0 tx): confirm receipt, position, or health factor in the app and note the starting share price or balance for later comparison.`,
    `Weekly, ${farm.weeklyEvents} events (~${PLAY_SPECS[farm.playType].weeklyMin} min each${maintCost}): ${v.watch}; check that the position still matches the plan and that no new campaign terms appeared.`,
    `Day ${HOLD_DAYS} (~5 min, 1 tx, ${money(gasForChain(farm.chain ?? "").claim)} modeled): claim only if a legitimate claim exists; otherwise retain the claim budget as hypothetical and do not chase an unverified drop.`,
    `Day ${HOLD_DAYS} (~${PLAY_SPECS[farm.playType].claimExitMin} min, ${farm.exitUnits} tx, ${money(farm.exitUnits * gasForChain(farm.chain ?? "").exit)} modeled): ${v.exit}, revoke unnecessary approvals, and record realized costs against the modeled ${money(farm.fees)} fees.`,
  ];
  return steps.map((s) => s.trim().slice(0, 600));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

export interface ModelMetrics { n: number; medianError: number; within3x: number; coverage: number; }
export interface ValidationRun { curve: ModelMetrics; flat: ModelMetrics; improvementPct: number; trainN: number; testN: number; omittedN: number; }

interface FlatModel { q0: number; catQ: Map<string, number>; }

function fitFlat(rows: SnapRecord[]): FlatModel {
  const qs = rows.map((r) => (r.mcap_usd as number) / (r.tvl_usd as number));
  const q0 = median(qs);
  const byCat = new Map<string, number[]>();
  for (const r of rows) {
    const c = (r.category || "").trim();
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push((r.mcap_usd as number) / (r.tvl_usd as number));
  }
  const catQ = new Map<string, number>();
  for (const [c, vals] of byCat) {
    const qc = median(vals);
    const nc = vals.length;
    catQ.set(c, clamp((nc * qc + 8 * q0) / (nc + 8), 0.05, 1.0));
  }
  return { q0, catQ };
}

function predictFlat(rec: SnapRecord, flat: FlatModel): number {
  const q = flat.catQ.get((rec.category || "").trim()) ?? clamp(flat.q0, 0.05, 1.0);
  return (rec.tvl_usd as number) * q * growthFactor(rec.change_7d) * maturityFactor(ageDays(rec.listed_at)) * breadthFactor(rec.chains);
}

interface FoldModels { fit: OlsFit; fam: Map<string, FamilyInfo>; curveS: number; flat: FlatModel; flatS: number; }

function fitFold(train: SnapRecord[]): FoldModels {
  const fit = fitOls(train);
  const fam = familyOffsets(train, fit);
  const curveErrs = train.map((r) => log10(r.mcap_usd as number) - log10(estimateValue(r, fit, fam, train).value));
  const flat = fitFlat(train);
  const flatErrs = train.map((r) => log10(r.mcap_usd as number) - log10(predictFlat(r, flat)));
  return { fit, fam, curveS: residualScale(curveErrs).sd, flat, flatS: residualScale(flatErrs).sd };
}

function metricsFor(preds: number[], actuals: number[], s: number): ModelMetrics {
  const errs = preds.map((p, i) => Math.max(p / actuals[i], actuals[i] / p));
  const within = errs.filter((e) => e <= 3).length / errs.length;
  let covered = 0;
  preds.forEach((p, i) => {
    const lo = p * Math.pow(10, -Z80 * s), hi = p * Math.pow(10, Z80 * s);
    if (actuals[i] >= lo && actuals[i] <= hi) covered++;
  });
  return { n: preds.length, medianError: median(errs), within3x: within, coverage: covered / preds.length };
}

/** Leave-one-token-out over the calibration set. */
export function looValidation(comps: SnapRecord[]): ValidationRun {
  const curvePred: number[] = [], flatPred: number[] = [], actual: number[] = [];
  const curveSs: number[] = [], flatSs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const held = comps[i];
    const m = fitFold(train);
    curvePred.push(estimateValue(held, m.fit, m.fam, train).value);
    flatPred.push(predictFlat(held, m.flat));
    actual.push(held.mcap_usd as number);
    curveSs.push(m.curveS); flatSs.push(m.flatS);
  }
  const curve = metricsFor(curvePred, actual, median(curveSs));
  const flat = metricsFor(flatPred, actual, median(flatSs));
  return { curve, flat, improvementPct: 100 * (1 - curve.medianError / flat.medianError), trainN: comps.length - 1, testN: comps.length, omittedN: 0 };
}

/** Listing-cohort split: train on listed < 2024-01-01, test on listed >= 2024-01-01. */
export function cohortValidation(comps: SnapRecord[]): ValidationRun {
  const train: SnapRecord[] = [], test: SnapRecord[] = [];
  let omitted = 0;
  for (const r of comps) {
    const d = ageDays(r.listed_at);
    if (r.listed_at === null || r.listed_at === undefined || d === null) { omitted++; continue; }
    const listed = r.listed_at.slice(0, 10);
    if (listed < "2024-01-01") train.push(r);
    else if (listed <= SNAPSHOT_DATE) test.push(r);
    else omitted++;
  }
  if (train.length < 3 || test.length === 0) {
    return { curve: { n: test.length, medianError: NaN, within3x: NaN, coverage: NaN }, flat: { n: test.length, medianError: NaN, within3x: NaN, coverage: NaN }, improvementPct: NaN, trainN: train.length, testN: test.length, omittedN: omitted };
  }
  const m = fitFold(train);
  const curvePred = test.map((r) => estimateValue(r, m.fit, m.fam, train).value);
  const flatPred = test.map((r) => predictFlat(r, m.flat));
  const actual = test.map((r) => r.mcap_usd as number);
  const curve = metricsFor(curvePred, actual, m.curveS);
  const flat = metricsFor(flatPred, actual, m.flatS);
  return { curve, flat, improvementPct: 100 * (1 - curve.medianError / flat.medianError), trainN: train.length, testN: test.length, omittedN: omitted };
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

export interface Peer { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number; ratio: number; }
export interface BoardRow {
  rank: number; slug: string; name: string; category: string; tier: "WATCHLIST" | "EARLY";
  chains: string[]; tvl_usd: number; change_7d: number | null; age_days: number | null; listed_at: string | null;
  implied_value_usd: number; p10_usd: number; p90_usd: number;
  size_usd: number; family_mult: number; growth_mult: number; seasoning_mult: number; sibling_mult: number; breadth_mult: number;
  sibling_k: number; sibling_names: string[];
  slice_usd: number; fees_usd: number; tbill_usd: number; net_usd: number; net_per_hour_usd: number; hours: number;
  verdict: "FARM" | "THIN" | "SKIP" | "VERIFY"; play_type: PlayType; farm_chain: string | null; chain_label: string;
  chain_verified: boolean; route_verified: boolean; above_50m: boolean; flags: string[];
  peers: Peer[]; farm_steps: string[];
}

export function nearestPeers(row: SnapRecord, comps: SnapRecord[]): Peer[] {
  const target = log10(row.tvl_usd as number);
  return [...comps]
    .map((p) => ({ p, d: Math.abs(log10(p.tvl_usd as number) - target) }))
    .sort((x, y) => x.d - y.d || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0))
    .slice(0, 4)
    .map(({ p }) => ({ slug: p.slug, name: p.name, category: p.category ?? "", tvl_usd: p.tvl_usd as number, mcap_usd: p.mcap_usd as number, ratio: (p.mcap_usd as number) / (p.tvl_usd as number) }));
}

export function rowFlags(rec: SnapRecord, est: FactorBreakdown, farm: FarmScenario): string[] {
  const flags: string[] = [];
  if (!finiteNum(rec.change_7d)) flags.push("Missing 7D change; neutral growth factor");
  const days = ageDays(rec.listed_at);
  if (days === null) flags.push("Missing listing date; neutral seasoning factor");
  else if (days < 0) flags.push("Listing date after snapshot; age treated as zero");
  if (!rec.chains || rec.chains.length === 0) flags.push("Missing chain data; fallback gas costs used");
  if (!farm.chainVerified) flags.push("CHAIN UNVERIFIED");
  if (!farm.routeVerified) flags.push("Route unverified—do not execute this template");
  if (est.siblingK > 0) flags.push("Name matches; affiliation unverified");
  return flags;
}

export function buildRows(boardRecs: SnapRecord[], watchlist: Set<string>, fit: OlsFit, fam: Map<string, FamilyInfo>, comps: SnapRecord[], curveS: number): BoardRow[] {
  const rows: BoardRow[] = boardRecs.map((rec) => {
    const est = estimateValue(rec, fit, fam, comps);
    const farm = farmScenario(rec, est.value);
    const band = Math.pow(10, Z80 * curveS);
    const days = ageDays(rec.listed_at);
    return {
      rank: 0, slug: rec.slug, name: rec.name, category: rec.category ?? "", tier: watchlist.has(rec.slug) ? "WATCHLIST" : "EARLY",
      chains: (rec.chains || []).filter((c) => typeof c === "string"),
      tvl_usd: rec.tvl_usd as number, change_7d: finiteNum(rec.change_7d) ? rec.change_7d : null,
      age_days: days !== null && days >= 0 ? days : days, listed_at: rec.listed_at,
      implied_value_usd: Math.max(1, Math.round(est.value)),
      p10_usd: Math.max(1, Math.round(est.value / band)), p90_usd: Math.max(1, Math.round(est.value * band)),
      size_usd: est.size, family_mult: est.family, growth_mult: est.growth, seasoning_mult: est.seasoning,
      sibling_mult: est.sibling, breadth_mult: est.breadth, sibling_k: est.siblingK, sibling_names: est.siblingNames,
      slice_usd: farm.slice, fees_usd: farm.fees, tbill_usd: farm.tbill, net_usd: farm.net,
      net_per_hour_usd: farm.netPerHour, hours: farm.hours, verdict: farm.verdict, play_type: farm.playType,
      farm_chain: farm.chain, chain_label: farm.chainLabel, chain_verified: farm.chainVerified,
      route_verified: farm.routeVerified, above_50m: (rec.tvl_usd as number) >= 50_000_000,
      flags: rowFlags(rec, est, farm), peers: nearestPeers(rec, comps), farm_steps: farmSteps(rec, farm),
    };
  });
  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
