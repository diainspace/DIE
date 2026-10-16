import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { compareClicks } from '../src/reporting/compare-clicks.js';
import { compareContributions } from '../src/reporting/compare-contributions.js';
import { createMockClickReader } from '../src/reporting/mock-clicks.js';

const DAY = 86400000;
const startAt = 10 * DAY, endAt = 12 * DAY;
const event = (day, source, campaign, dest = 'https://example.org/', extra = {}) => ({
  id: `${day}-${source}-${campaign}`, timestamp: new Date(day * DAY).toISOString(),
  source, campaign, dest, origin: 'bio.test', path: '/', place: 'header', name: 'Explore', ...extra,
});
const options = { domain: 'all', startAt, endAt, pageSize: 1 };
function compare(events) {
  const comparison = compareClicks({ events, startAt, endAt, coverageStart: 0 });
  return { comparison, ...compareContributions({ events, comparison }) };
}

test('each contribution grouping reconciles with the same period totals and net change', () => {
  const events = [event(11, 'facebook', 'launch'), event(11.1, 'facebook', 'launch'),
    event(9, 'newsletter', 'notes'), event(9.1, 'facebook', 'launch')];
  const result = compare(events);
  for (const rows of Object.values(result.groups)) {
    assert.equal(rows.reduce((sum, row) => sum + row.currentCount, 0), result.comparison.currentCount);
    assert.equal(rows.reduce((sum, row) => sum + row.previousCount, 0), result.comparison.previousCount);
    assert.equal(rows.reduce((sum, row) => sum + row.difference, 0), result.comparison.difference);
  }
  assert.ok(result.groups.source.some(row => row.difference > 0));
  assert.ok(result.groups.source.some(row => row.difference < 0));
});

test('new and disappearing groups keep zero-baseline percentages honest', () => {
  const result = compare([event(11, 'facebook', 'new_campaign'), event(9, 'newsletter', 'old_campaign')]);
  const added = result.groups.campaign.find(row => row.value === 'new_campaign');
  const removed = result.groups.campaign.find(row => row.value === 'old_campaign');
  assert.equal(added.status, 'new');
  assert.equal(added.percentChange, null);
  assert.equal(removed.status, 'gone');
  assert.equal(removed.percentChange, -100);
  assert.equal(removed.currentCount, 0);
});

test('missing attribution remains a separate unknown group, not a guessed source or campaign', () => {
  const result = compare([event(11, null, null), event(9, 'facebook', 'launch')]);
  const unknown = result.groups.source.find(row => row.value === null);
  assert.equal(unknown.currentCount, 1);
  assert.equal(unknown.previousCount, 0);
  assert.equal(result.groups.source.some(row => row.value === 'direct'), false);
});

test('offsetting group changes remain visible when the overall total is unchanged', () => {
  const result = compare([event(11, 'facebook', 'launch'), event(9, 'newsletter', 'notes')]);
  assert.equal(result.comparison.difference, 0);
  assert.equal(result.groups.source.length, 2);
  assert.ok(result.largestSourceChange);
  assert.ok(result.groups.source.every(row => Math.abs(row.difference) === 1));
});

test('insufficient history produces no fabricated contribution numbers', () => {
  const result = compareContributions({ events: [event(11, 'facebook', 'launch')], comparison: { available: false } });
  assert.deepEqual(result, { available: false, groups: {}, largestSourceChange: null });
});

test('contribution calculations use full matching periods rather than the visible event page', async () => {
  const reader = createMockClickReader({ events: [event(11, 'facebook', 'launch'), event(11.1, 'facebook', 'launch'),
    event(11.2, 'instagram', 'launch')], historyEvents: [event(9, 'facebook', 'launch'), event(9.1, 'facebook', 'other')], coverageStart: 0 });
  const filters = { source: 'facebook', campaign: 'launch', path: '/', place: 'header' };
  const first = await reader.readClicks({ ...options, filters });
  const next = await reader.readClicks({ ...options, filters, page: 2 });
  assert.equal(first.events.length, 1);
  assert.equal(first.contributions.groups.source[0].currentCount, 2);
  assert.equal(first.contributions.groups.source[0].previousCount, 1);
  assert.deepEqual(next.contributions, first.contributions);
});

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Contribution view did not update');
}

test('a disappearing campaign can be selected even when absent from current-period facets', async t => {
  const reader = createMockClickReader({ events: [event(11, 'facebook', 'new_campaign'), event(11.1, 'facebook', 'new_campaign')],
    historyEvents: [event(9, 'newsletter', 'old_campaign'), event(9.1, 'newsletter', 'old_campaign'), event(9.2, 'newsletter', 'old_campaign')], coverageStart: 0 });
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/report.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://die.test/report', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = async url => {
    const query = new URL(url, 'http://die.test').searchParams;
    calls.push(query);
    const filters = Object.fromEntries(['source', 'campaign', 'place', 'path', 'dest'].filter(key => query.has(key)).map(key => [key, query.get(key)]));
    return { ok: true, json: async () => reader.readClicks({ ...options, pageSize: 25, filters }) };
  };
  dom.window.eval(script);
  const d = dom.window.document;
  await waitFor(() => !d.getElementById('report').hidden);
  assert.equal(d.getElementById('contributions-panel').hidden, false);
  assert.match(d.getElementById('contributions-summary').textContent, /newsletter.*3 fewer/);
  const button = [...d.querySelectorAll('#campaign-changes button')].find(node => node.textContent === 'old_campaign');
  assert.ok(button);
  button.click();
  await waitFor(() => calls.length === 2 && !d.getElementById('refresh').disabled);
  assert.equal(calls[1].get('campaign'), 'old_campaign');
  assert.equal(d.getElementById('filter-campaign').value, 'old_campaign');
  assert.match(d.getElementById('filter-campaign').selectedOptions[0].textContent, /no clicks this period/);
  assert.equal(d.getElementById('loaded').textContent, '0');
  assert.match(d.getElementById('campaign-changes').textContent, /3 previously/);
  assert.equal(d.getElementById('drilldown').open, false);
});
