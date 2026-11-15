import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const root = resolve(new URL('..', import.meta.url).pathname);

function runInto(dir) {
  execFileSync(process.execPath, ['main.ts', '--input', 'input/snapshot.json', '--output', dir], {
    cwd: root,
    stdio: 'pipe',
  });
}

test('main writes deterministic, self-consistent board, data, dashboard and dossier artifacts', () => {
  const temp = mkdtempSync(join(tmpdir(), 'radar-output-'));
  try {
    const a = join(temp, 'a');
    const b = join(temp, 'b');
    runInto(a);
    runInto(b);
    for (const file of ['board.json', 'data.js', 'dossier.json']) {
      assert.deepEqual(readFileSync(join(a, file)), readFileSync(join(b, file)), `${file} changed between runs`);
    }
    const board = JSON.parse(readFileSync(join(a, 'board.json'), 'utf8'));
    assert.ok(board.rows.length >= 100);
    const dossier = readFileSync(join(a, 'dossier.json'));
    assert.ok(dossier.equals(Buffer.from(buildDossier(a, {
      text_max_bytes: 65_536,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }))));
    assert.equal(readdirSync(join(a, 'screenshots')).length, 3);
    assert.ok(JSON.parse(dossier.toString('utf8')).images.length === 3);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('main rejects a snapshot without a valid as_of date before creating output', () => {
  const temp = mkdtempSync(join(tmpdir(), 'radar-invalid-'));
  try {
    const input = join(temp, 'invalid.json');
    const output = join(temp, 'output');
    const snapshot = JSON.parse(readFileSync(join(root, 'input/snapshot.json'), 'utf8'));
    delete snapshot.as_of;
    writeFileSync(input, JSON.stringify(snapshot));
    let failure;
    try {
      execFileSync(process.execPath, ['main.ts', '--input', input, '--output', output], {
        cwd: root,
        stdio: 'pipe',
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, 'invalid snapshot unexpectedly succeeded');
    assert.equal(failure.status, 1);
    assert.match(failure.stderr.toString(), /snapshot\.as_of must be a valid date/);
    assert.equal(existsSync(output), false, 'invalid input left partial output behind');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
