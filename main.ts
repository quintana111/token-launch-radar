// Token Launch Radar — entrypoint. Reads the sealed snapshot, fits the size
// curve, validates the estimator, ranks the pre-token board, and writes the
// output bundle (board.json, dashboard, screenshots, dossier.json).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  MODEL_VERSION, SNAPSHOT_DATE, Z80, ageDays, buildRows, calibrationSet, cohortValidation,
  estimateValue, familyOffsets, fitOls, log10, looValidation, reconcile, residualScale,
} from "./lib/model.ts";
import type { BoardRow, SnapFile, SnapRecord } from "./lib/model.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string; output: string } {
  let input = process.env.MAKEFUN_INPUT ?? "/input/snapshot.json";
  let output = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && argv[i + 1]) input = argv[++i];
    else if (argv[i] === "--output" && argv[i + 1]) output = argv[++i];
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("usage: node main.ts [--input <snapshot.json>] [--output <dir>]");
      process.exit(0);
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { input: resolve(input), output: resolve(output) };
}

function sha256File(path: string): { hex: string; raw: string } {
  const raw = readFileSync(path, "utf8");
  return { hex: createHash("sha256").update(raw, "utf8").digest("hex"), raw };
}

function fail(msg: string): never { throw new Error(msg); }

function main(): void {
  const { input, output } = parseArgs(process.argv.slice(2));
  if (!existsSync(input)) fail(`snapshot not found: ${input}`);
  const { hex: snapshotHash, raw } = sha256File(input);
  const snap = JSON.parse(raw) as SnapFile;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) fail("snapshot shape invalid: expected protocols[] and watchlist[]");
  const records: SnapRecord[] = snap.protocols;
  const watchlist = new Set(snap.watchlist);

  // Reconciliation ledger: every record gets exactly one disposition.
  const ledger = reconcile(records);
  const tally = { invalid: 0, traded: 0, excluded: 0, board: 0 };
  for (const row of ledger) tally[row.disposition]++;
  if (tally.invalid + tally.traded + tally.excluded + tally.board !== records.length) fail("reconciliation does not sum to record count");
  const boardRecs = ledger.filter((r) => r.disposition === "board").map((r) => r.rec);

  // Calibration universe and size-curve fit.
  const comps = calibrationSet(records);
  if (comps.length !== 110) fail(`calibration count ${comps.length}, expected 110`);
  const fit = fitOls(comps);
  const fam = familyOffsets(comps, fit);
  const fullErrs = comps.map((r) => log10(r.mcap_usd as number) - log10(estimateValue(r, fit, fam, comps).value));
  const fullScale = residualScale(fullErrs);

  // Validation: leave-one-out plus listing-cohort split.
  const loo = looValidation(comps);
  const cohort = cohortValidation(comps);

  // Board rows, ranked by implied value.
  const rows: BoardRow[] = buildRows(boardRecs, watchlist, fit, fam, comps, fullScale.sd);
  if (rows.length !== 198) fail(`board has ${rows.length} rows, expected 198 (reconciliation: ${JSON.stringify(tally)})`);
  const watchCovered = rows.filter((r) => r.tier === "WATCHLIST").length;
  if (watchCovered !== 40) fail(`watchlist coverage ${watchCovered}/40`);
  rows.forEach((r, i) => {
    if (r.rank !== i + 1) fail(`rank sequence broken at index ${i}`);
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) fail(`bad implied value for ${r.slug}`);
    if (r.farm_steps.length !== 7) fail(`farm_steps != 7 for ${r.slug}`);
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) fail(`farm step length ${s.length} for ${r.slug}`);
  });
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0, VERIFY: 0 };
  for (const r of rows) verdicts[r.verdict]++;
  const above50 = rows.filter((r) => r.above_50m).length;
  // Display-only live-token tab (top 24 by market cap) and scatter points.
  const liveTop24 = [...comps]
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map((r) => ({ slug: r.slug, name: r.name, category: r.category ?? "", tvl_usd: r.tvl_usd as number, mcap_usd: r.mcap_usd as number, ratio: (r.mcap_usd as number) / (r.tvl_usd as number) }));
  const scatterComps: Array<[number, number]> = comps.map((r) => [r.tvl_usd as number, r.mcap_usd as number]);

  const meta = {
    snapshot_hash: snapshotHash,
    snapshot_as_of: snap.as_of ?? SNAPSHOT_DATE,
    snapshot_source: snap.source ?? "",
    model_version: MODEL_VERSION,
    model: {
      equation: `log10(mcap USD) = ${fit.a.toFixed(4)} + ${fit.b.toFixed(4)} x log10(TVL/$100M)`,
      a: +fit.a.toFixed(4), b: +fit.b.toFixed(4), a_usd: +(fit.a - 8 * fit.b).toFixed(4),
      calibration_n: comps.length, resid_sd_ols: fit.residSd, resid_sd_full: fullScale.sd,
      mean_resid_full: fullScale.mean, z80: Z80,
    },
    family: [...fam.entries()].map(([category, f]) => ({ category, n: f.n, mean_resid: f.meanResid, delta: f.delta, mult: f.mult }))
      .sort((x, y) => y.n - x.n || (x.category < y.category ? -1 : 1)),
    validation: { loo, cohort },
    counts: {
      records: records.length, calibration: comps.length, board: rows.length,
      watchlist: watchCovered, early: rows.length - watchCovered, above_50m: above50,
      invalid: tally.invalid, traded: tally.traded, excluded: tally.excluded,
    },
    verdicts,
    live_top24: liveTop24,
    scatter_comps: scatterComps,
    reconciliation: {
      invalid: tally.invalid, traded: tally.traded, excluded: tally.excluded, board: tally.board,
      note: "110 is the calibration subset, not all traded records; top 24 live tokens are a display subset, not the entire traded count.",
    },
  };

  mkdirSync(output, { recursive: true });
  const board = { meta, rows };
  writeFileSync(join(output, "board.json"), JSON.stringify(board, null, 2) + "\n", "utf8");

  // Post-write verification: the shipped file must read back exactly as built.
  const shipped = JSON.parse(readFileSync(join(output, "board.json"), "utf8")) as typeof board;
  if (shipped.rows.length !== 198) fail("shipped board.json row count mismatch");
  if (shipped.rows.some((r, i) => r.rank !== i + 1)) fail("shipped board.json rank mismatch");
  if (shipped.meta.snapshot_hash !== snapshotHash) fail("shipped board.json hash mismatch");

  // Static assets shipped from the repo directory (never from cwd).
  cpSync(join(HERE, "dashboard"), join(output, "dashboard"), { recursive: true });
  cpSync(join(HERE, "screenshots"), join(output, "screenshots"), { recursive: true });

  // Dossier: built from the finished output directory by the kit library.
  const dossier = buildDossier(output, { text_max_bytes: 65536 });
  writeFileSync(join(output, "dossier.json"), dossier);

  console.log(`board: ${rows.length} rows (${watchCovered} WATCHLIST, ${rows.length - watchCovered} EARLY), a=${fit.a.toFixed(4)} b=${fit.b.toFixed(4)}`);
  console.log(`verdicts: FARM ${verdicts.FARM} THIN ${verdicts.THIN} SKIP ${verdicts.SKIP} VERIFY ${verdicts.VERIFY}`);
  console.log(`LOO median error curve x${loo.curve.medianError.toFixed(2)} vs flat x${loo.flat.medianError.toFixed(2)}; cohort train ${cohort.trainN} test ${cohort.testN}`);
  console.log(`wrote ${output}`);
}

main();
