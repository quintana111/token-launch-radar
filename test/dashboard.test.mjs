import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(new URL('..', import.meta.url).pathname);
const browser = '/snap/bin/chromium';

function render(page) {
  return execFileSync(browser, [
    '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--virtual-time-budget=3000', '--dump-dom', page,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

test('dashboard renders its board, a protocol detail route, and a live category filter offline', () => {
  const temp = mkdtempSync(join(root, 'radar-browser-test-'));
  try {
    const out = join(temp, 'out');
    execFileSync(process.execPath, ['main.ts', '--input', 'input/snapshot.json', '--output', out], { cwd: root, stdio: 'pipe' });
    const app = join(out, 'dashboard', 'index.html');
    const data = JSON.parse(readFileSync(join(out, 'board.json'), 'utf8'));
    const model = data.rows[0];
    const boardHtml = render(pathToFileURL(app).href + '?view=board');
    assert.match(boardHtml, /data-view="board"/);
    assert.match(boardHtml, /data-visible="\d+"/);
    const detailHtml = render(pathToFileURL(app).href + `?view=detail&slug=${encodeURIComponent(model.slug)}`);
    assert.match(detailHtml, /data-view="detail"/);
    assert.ok(detailHtml.includes(model.name));
    const filtered = data.rows.filter(row => row.category === 'RWA').length;
    const filterHtml = render(pathToFileURL(app).href + '?view=board&category=RWA');
    assert.match(filterHtml, /data-category="RWA"/);
    assert.match(filterHtml, new RegExp(`data-visible="${filtered}"`));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
