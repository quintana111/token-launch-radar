const data = window.RADAR_DATA;
const params = new URLSearchParams(window.location.search);
const byId = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const money = value => {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
};
const fullMoney = value => Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const pct = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}%` : '—';
const shortDate = value => value ? new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'NOT RECORDED';
const chainText = chains => Array.isArray(chains) && chains.length ? chains.slice(0, 2).join(' · ') + (chains.length > 2 ? ` +${chains.length - 2}` : '') : 'Chain not listed';

function fillSummary() {
  byId('snapshot-date').textContent = data.snapshot.as_of;
  byId('footer-asof').textContent = `AS OF ${data.snapshot.as_of}`;
  byId('nav-count').textContent = data.counts.no_token_recorded;
  byId('stat-rows').textContent = data.counts.no_token_recorded;
  byId('stat-watchlist').textContent = `${data.counts.watchlist} / ${data.counts.watchlist}`;
  byId('stat-comps').textContent = data.counts.trading_references;
  byId('stat-floor').textContent = money(data.snapshot.floor_usd);
  byId('global-multiple').textContent = `${Number(data.model.global_multiple).toFixed(2)}× mcap/TVL`;
  byId('model-id').textContent = String(data.model.id).toUpperCase();
  byId('method-version').textContent = String(data.model.id).toUpperCase();
  byId('method-formula').textContent = `TVL × peer multiple × growth × observed tenure`;
  byId('method-copy').textContent = data.model.method;
  byId('data-source').textContent = data.snapshot.source;
  byId('method-date').textContent = data.snapshot.as_of;
  byId('method-comps').textContent = `${data.model.live_comparables} positive-MCap peers`;
  byId('benchmark-count').textContent = `${data.benchmarks.length} references`;
  byId('stat-rows').title = `${data.counts.no_token_recorded} protocols with no token identifier in this snapshot`;
}

function fillFilters() {
  const categories = [...new Set(data.rows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const chains = [...new Set(data.rows.flatMap(row => row.chains ?? []))].sort((a, b) => a.localeCompare(b));
  for (const category of categories) byId('category').insertAdjacentHTML('beforeend', `<option value="${esc(category)}">${esc(category)}</option>`);
  for (const chain of chains) byId('chain').insertAdjacentHTML('beforeend', `<option value="${esc(chain)}">${esc(chain)}</option>`);
}

function sortRows(rows) {
  const mode = byId('sort').value;
  const values = {
    value: (a, b) => b.implied_value_usd - a.implied_value_usd,
    growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    age: (a, b) => (b.observed_days ?? -1) - (a.observed_days ?? -1),
  };
  return [...rows].sort((a, b) => values[mode](a, b) || a.rank - b.rank || a.slug.localeCompare(b.slug));
}

function rowMarkup(row) {
  const changeClass = row.change_7d == null ? 'delta-flat' : row.change_7d > 0 ? 'delta-up' : row.change_7d < 0 ? 'delta-down' : 'delta-flat';
  const shortName = String(row.name).trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').slice(0, 2);
  const watched = data.watchlist.includes(row.slug);
  return `<tr tabindex="0" data-slug="${esc(row.slug)}" aria-label="Open ${esc(row.name)} details">
    <td class="rank-cell"><span class="rank-mark">${row.rank <= 3 ? '◆' : '·'}</span>${String(row.rank).padStart(2, '0')}</td>
    <td><div class="protocol-link"><span class="protocol-symbol">${esc(shortName)}</span><span class="name-line"><span>${esc(row.name)}</span>${watched ? '<span class="watch-badge">WATCHLIST</span>' : ''}</span></div></td>
    <td class="category-cell">${esc(row.category ?? 'Uncategorized')}<small>${esc(chainText(row.chains))}</small></td>
    <td class="money-cell">${money(row.tvl_usd)}</td>
    <td class="${changeClass}">${pct(row.change_7d)}</td>
    <td class="value-cell">${money(row.implied_value_usd)}</td>
    <td class="record-cell"><span class="record-dot"></span>NO TOKEN REC.</td>
  </tr>`;
}

function renderBoard() {
  const query = byId('search').value.trim().toLowerCase();
  const category = byId('category').value;
  const chain = byId('chain').value;
  document.body.dataset.category = category || 'all';
  const matches = sortRows(data.rows).filter(row => {
    const haystack = `${row.name} ${row.slug} ${row.category ?? ''} ${(row.chains ?? []).join(' ')}`.toLowerCase();
    return (!query || haystack.includes(query))
      && (!category || row.category === category)
      && (!chain || (row.chains ?? []).includes(chain));
  });
  byId('protocol-rows').innerHTML = matches.map(rowMarkup).join('');
  byId('results-count').textContent = `${matches.length} shown`;
  byId('results-count').dataset.visible = String(matches.length);
  byId('result-count-label').textContent = `${matches.length} protocols`;
  byId('empty-state').hidden = matches.length > 0;
}

function renderBenchmarks() {
  const peers = data.benchmarks.slice(-80).reverse();
  byId('benchmark-rows').innerHTML = peers.map((row, index) => `<tr>
    <td class="rank-cell">${String(index + 1).padStart(2, '0')}</td>
    <td><div class="protocol-link"><span class="protocol-symbol">${esc(row.symbol ?? row.name.slice(0, 2))}</span><span>${esc(row.name)}</span></div></td>
    <td class="category-cell">${esc(row.category ?? 'Uncategorized')}</td>
    <td class="money-cell">${money(row.tvl_usd)}</td>
    <td class="money-cell">${money(row.mcap_usd)}</td>
    <td class="value-cell">${Number(row.market_cap_to_tvl).toFixed(2)}×</td>
    <td class="record-cell"><span class="record-dot"></span>TRADING</td>
  </tr>`).join('');
}

function fillDetail(slug) {
  const row = data.rows.find(item => item.slug === slug);
  if (!row) return false;
  byId('detail-rank').textContent = `· GLOBAL RANK ${String(row.rank).padStart(2, '0')}`;
  byId('detail-name').textContent = row.name;
  byId('detail-category').textContent = `${row.category ?? 'Uncategorized'}  /  ${chainText(row.chains)}`;
  byId('detail-value').textContent = fullMoney(row.implied_value_usd);
  byId('detail-tvl').textContent = money(row.tvl_usd);
  byId('detail-growth').textContent = pct(row.change_7d);
  byId('detail-age').textContent = row.observed_days == null ? 'Not recorded' : `${row.observed_days.toLocaleString('en-US')} days`;
  byId('detail-multiple').textContent = `${Number(row.model_multiple).toFixed(3)}×`;
  byId('detail-growth-factor').textContent = `${Number(row.growth_factor).toFixed(3)}×`;
  byId('detail-age-factor').textContent = `${Number(row.maturity_factor).toFixed(3)}×`;
  byId('detail-peers').textContent = `${row.comparable_count} · ${row.confidence}`;
  byId('detail-status').textContent = 'NO TOKEN RECORDED';
  byId('farm-steps').innerHTML = row.farm_steps.map(step => `<li>${esc(step)}</li>`).join('');
  byId('detail-panel').hidden = false;
  byId('scrim').hidden = false;
  document.body.dataset.view = 'detail';
  byId('close-detail').focus({ preventScroll: true });
  return true;
}

function closeDetail() {
  byId('detail-panel').hidden = true;
  byId('scrim').hidden = true;
  if (document.body.dataset.view === 'detail') document.body.dataset.view = 'board';
}

function setTab(tab) {
  closeDetail();
  document.body.dataset.view = tab;
  byId('radar-view').hidden = tab !== 'radar';
  byId('benchmarks-view').hidden = tab !== 'benchmarks';
  byId('method-view').hidden = tab !== 'method';
  document.querySelectorAll('[data-tab]').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
  if (tab === 'benchmarks') renderBenchmarks();
}

function connectControls() {
  ['search', 'category', 'chain', 'sort'].forEach(id => byId(id).addEventListener(id === 'search' ? 'input' : 'change', renderBoard));
  byId('clear-filters').addEventListener('click', () => {
    byId('search').value = '';
    byId('category').value = '';
    byId('chain').value = '';
    byId('sort').value = 'value';
    renderBoard();
  });
  document.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => setTab(button.dataset.tab)));
  byId('protocol-rows').addEventListener('click', event => {
    const row = event.target.closest('tr[data-slug]');
    if (row) fillDetail(row.dataset.slug);
  });
  byId('protocol-rows').addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('tr[data-slug]')) {
      event.preventDefault();
      fillDetail(event.target.dataset.slug);
    }
  });
  byId('close-detail').addEventListener('click', closeDetail);
  byId('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeDetail();
    if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      event.preventDefault();
      byId('search').focus();
    }
  });
}

if (!data || !Array.isArray(data.rows)) {
  document.body.innerHTML = '<main class="shell"><h1>Radar data is missing</h1><p>Run <code>node main.ts</code> to generate the local dashboard data.</p></main>';
} else {
  fillSummary();
  fillFilters();
  connectControls();
  const category = params.get('category');
  if (category && [...byId('category').options].some(option => option.value === category)) byId('category').value = category;
  const view = params.get('view') ?? 'board';
  renderBoard();
  if (view === 'detail') {
    setTab('radar');
    if (!fillDetail(params.get('slug'))) document.body.dataset.view = 'board';
  } else if (['benchmarks', 'method'].includes(view)) setTab(view);
}
