import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildBoard, classifyTokenStatus } from '../lib/model.ts';

const snapshot = JSON.parse(await readFile(new URL('../input/snapshot.json', import.meta.url), 'utf8'));

const makeProtocol = (slug, category, tvl, mcap, change7d, listedAt, geckoId = null, symbol = null) => ({
  slug, name: slug, category, chains: ['Ethereum'], tvl_usd: tvl, change_7d: change7d,
  mcap_usd: mcap, listed_at: listedAt, gecko_id: geckoId, symbol,
});

test('the real snapshot board covers every recorded pre-token protocol and every watchlist slug', () => {
  const { rows } = buildBoard(snapshot);
  assert.ok(rows.length >= 100);
  assert.ok(rows.every(r => r.token_status === 'no-token-recorded'));
  assert.ok(rows.every(r => snapshot.protocols.some(p => p.slug === r.slug)));
  for (const slug of snapshot.watchlist) assert.ok(rows.some(r => r.slug === slug), `missing watchlist slug: ${slug}`);
});

test('rank and value are strictly well-formed, non-increasing, and deterministic', () => {
  const first = buildBoard(snapshot).rows;
  const second = buildBoard(snapshot).rows;
  assert.deepEqual(first, second);
  assert.ok(first.length >= 100);
  assert.deepEqual(first.map(r => r.rank), first.map((_, i) => i + 1));
  assert.equal(new Set(first.map(r => r.slug)).size, first.length);
  for (let i = 0; i < first.length; i++) {
    assert.ok(Number.isSafeInteger(first[i].implied_value_usd) && first[i].implied_value_usd > 0);
    assert.ok(Array.isArray(first[i].farm_steps) && first[i].farm_steps.length >= 3);
    assert.ok(first[i].farm_steps.every(s => typeof s === 'string' && s.trim().length >= 20 && s.trim().length <= 600));
    if (i) assert.ok(first[i - 1].implied_value_usd >= first[i].implied_value_usd);
  }
});

test('token status distinguishes a live market cap from an unpriced token record', () => {
  assert.equal(classifyTokenStatus(makeProtocol('live', 'Dexs', 1000, 250, 0, null, 'live-id', 'LIVE')), 'trading');
  assert.equal(classifyTokenStatus(makeProtocol('recorded', 'Dexs', 1000, null, 0, null, 'token-id', 'REC')), 'recorded-no-market-cap');
  assert.equal(classifyTokenStatus(makeProtocol('unknown', 'Dexs', 1000, null, 0, null)), 'no-token-recorded');
});

test('snapshot comparables, growth, and observed tracking age drive a finite positive scenario value', () => {
  const common = [
    makeProtocol('lend-a', 'Lending', 1000, 500, 0, '2024-01-01', 'a', 'A'),
    makeProtocol('lend-b', 'Lending', 1000, 1000, 0, '2024-01-01', 'b', 'B'),
    makeProtocol('lend-c', 'Lending', 1000, 1500, 0, '2024-01-01', 'c', 'C'),
  ];
  const target = makeProtocol('new', 'Lending', 1000, null, 0, '2026-11-14');
  const growing = makeProtocol('growing', 'Lending', 1000, null, 50, '2025-11-14');
  const data = { as_of: '2026-11-14', floor_usd: 500, protocols: [...common, target, growing], watchlist: ['new', 'growing'] };
  const { rows, model } = buildBoard(data);
  const now = rows.find(r => r.slug === 'new');
  const grow = rows.find(r => r.slug === 'growing');
  assert.ok(now.model_multiple > 0);
  assert.ok(now.implied_value_usd > 0 && now.implied_value_usd < 1000);
  assert.ok(grow.implied_value_usd > now.implied_value_usd);
  assert.match(model.method, /market-cap/i);
  assert.match(model.method, /growth/i);
  assert.match(model.method, /tracking age/i);
});
