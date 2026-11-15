import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBoard } from '../lib/model.ts';

const snapshot = JSON.parse(await readFile(new URL('../input/snapshot.json', import.meta.url), 'utf8'));

test('candidate board excludes bridges, exchange products, wrappers and versioned entries', () => {
  const rows = buildBoard(snapshot).rows;
  const excludedCategories = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
  const exchange = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const wrapper = /\b(wrapped|staked|staking)\b/i;
  const version = /\s(?:V\d+(?:\.\d+)?|v\d+(?:\.\d+)?|\d+\.\d+)$/;
  for (const row of rows) {
    assert.ok(!excludedCategories.has(row.category), `${row.slug} has excluded category ${row.category}`);
    assert.ok(!exchange.test(row.name), `${row.slug} is an exchange-named product`);
    assert.ok(!wrapper.test(row.name), `${row.slug} looks like a wrapped or staked product`);
    assert.ok(!version.test(row.name), `${row.slug} is a versioned product`);
  }
  for (const slug of snapshot.watchlist) assert.ok(rows.some(row => row.slug === slug), `watchlist lost ${slug}`);
});
