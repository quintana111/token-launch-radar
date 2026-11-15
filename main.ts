import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, classifyTokenStatus } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function option(name, fallback) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const equals = process.argv.find(value => value.startsWith(`${flag}=`));
  return equals ? equals.slice(flag.length + 1) : fallback;
}

function copyTree(source, target) {
  if (!existsSync(source)) throw new Error(`Required directory is missing: ${relative(ROOT, source)}`);
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
    else throw new Error(`Refusing non-regular entry: ${relative(ROOT, from)}`);
  }
}

function publicReference(protocol) {
  return {
    slug: protocol.slug,
    name: protocol.name,
    category: protocol.category,
    chains: protocol.chains,
    tvl_usd: protocol.tvl_usd,
    mcap_usd: protocol.mcap_usd,
    change_7d: protocol.change_7d,
    listed_at: protocol.listed_at,
    symbol: protocol.symbol,
    token_status: classifyTokenStatus(protocol),
    market_cap_to_tvl: protocol.tvl_usd > 0 && protocol.mcap_usd > 0
      ? Number((protocol.mcap_usd / protocol.tvl_usd).toFixed(6))
      : null,
  };
}

function makeDashboardData(snapshot, board) {
  const benchmarks = snapshot.protocols
    .filter(p => classifyTokenStatus(p) === 'trading')
    .map(publicReference)
    .filter(p => p.market_cap_to_tvl !== null)
    .sort((a, b) => a.market_cap_to_tvl - b.market_cap_to_tvl || a.slug.localeCompare(b.slug));
  const recorded = snapshot.protocols
    .filter(p => classifyTokenStatus(p) === 'recorded-no-market-cap')
    .map(publicReference)
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    snapshot: { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd },
    model: board.model,
    watchlist: snapshot.watchlist,
    rows: board.rows,
    benchmarks,
    recorded,
    counts: {
      protocols_in_snapshot: snapshot.protocols.length,
      watchlist: snapshot.watchlist.length,
      no_token_recorded: board.rows.length,
      trading_references: benchmarks.length,
      token_recorded_no_market_cap: recorded.length,
      protocols_over_floor: snapshot.protocols.filter(p => p.tvl_usd >= snapshot.floor_usd).length,
    },
  };
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.protocols) || !Array.isArray(snapshot.watchlist)) {
    throw new Error('snapshot must contain protocols and watchlist arrays');
  }
  const asOf = snapshot.as_of;
  const parsed = typeof asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? new Date(`${asOf}T00:00:00Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== asOf) {
    throw new Error('snapshot.as_of must be a valid date in YYYY-MM-DD form');
  }
}

function writeOutput(snapshot, board, outputDir) {
  const out = resolve(outputDir);
  if (out === ROOT || ROOT.startsWith(`${out}${sep}`)) {
    throw new Error('Output directory must not be the repository root or one of its parents. Use a separate directory such as ./out.');
  }
  mkdirSync(out, { recursive: true });
  for (const name of ['board.json', 'data.js', 'dossier.json']) rmSync(join(out, name), { force: true });
  for (const name of ['dashboard', 'screenshots']) rmSync(join(out, name), { recursive: true, force: true });

  writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: board.model, rows: board.rows }, null, 2)}\n`);
  const data = makeDashboardData(snapshot, board);
  const safeJson = JSON.stringify(data).replaceAll('<', '\\u003c');
  writeFileSync(join(out, 'data.js'), `window.RADAR_DATA = ${safeJson};\n`);
  copyTree(join(ROOT, 'dashboard'), join(out, 'dashboard'));
  copyTree(join(ROOT, 'screenshots'), join(out, 'screenshots'));

  const imageNames = readdirSync(join(out, 'screenshots')).sort();
  if (imageNames.length < 3 || imageNames.length > SCREENSHOT_CAPS.max) {
    throw new Error(`screenshots/: expected 3–4 images, found ${imageNames.length}.`);
  }
  for (const name of imageNames) {
    if (!IMAGE_NAME.test(name)) throw new Error(`Invalid screenshot filename: ${name}`);
    const st = statSync(join(out, 'screenshots', name));
    if (!st.isFile() || st.size > SCREENSHOT_CAPS.max_bytes) throw new Error(`Invalid screenshot file: ${name} (${st.size} bytes).`);
  }
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
  return { out, imageNames, dossierBytes: Buffer.byteLength(dossier) };
}

function main() {
  const inputArg = option('input', process.env.MAKEFUN_INPUT_DIR ?? (existsSync('/input/snapshot.json') ? '/input' : join(ROOT, 'input')));
  const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputPath)) throw new Error(`No snapshot at ${inputPath}; pass --input <snapshot.json|directory> or mount /input.`);
  const outputDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
  const snapshot = JSON.parse(readFileSync(inputPath, 'utf8'));
  validateSnapshot(snapshot);
  const board = buildBoard(snapshot);
  if (board.rows.length < 100) throw new Error(`snapshot produced only ${board.rows.length} candidates; at least 100 are required`);
  const result = writeOutput(snapshot, board, outputDir);
  process.stdout.write(`radar-comps-1 · ${snapshot.protocols.length} snapshot protocols · ${snapshot.watchlist.length}/${board.model.watchlist_count} watchlist covered · ${board.rows.length} no-token-recorded rows · ${board.model.live_comparables} live comparables\n`);
  process.stdout.write(`Output: ${result.out} · ${result.imageNames.length} screenshots · dossier ${result.dossierBytes} bytes\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`token radar: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
