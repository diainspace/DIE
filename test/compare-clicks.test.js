import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { compareClicks } from '../src/reporting/compare-clicks.js';
import { createMockClickReader } from '../src/reporting/mock-clicks.js';

const DAY = 86400000;
const startAt = 10 * DAY;
const endAt = 12 * DAY;
const event = (time, extra = {}) => ({ id: `test-${time}`, timestamp: new Date(time).toISOString(),
  source: 'facebook', campaign: 'launch', origin: 'bio.test', path: '/', place: 'header', ...extra });

test('comparison uses adjacent equal periods without counting boundary events twice', () => {
  const result = compareClicks({ events: [8, 9, 10, 11, 12].map(day => event(day * DAY)), startAt, endAt, coverageStart: 0 });
  assert.equal(result.available, true);
  assert.deepEqual(result.current.map(day => day.count), [1, 1]);
  assert.deepEqual(result.previous.map(day => day.count), [1, 1]);
  assert.equal(result.currentCount, 2);
  assert.equal(result.previousCount, 2);
  assert.equal(result.percentChange, 0);
  assert.equal(result.currentRange.endAt - result.currentRange.startAt, result.previousRange.endAt - result.previousRange.startAt);
});

test('missing baseline coverage is unavailable, not zero', () => {
  const result = compareClicks({ events: [event(11 * DAY)], startAt, endAt, coverageStart: 9 * DAY });
  assert.equal(result.available, false);
  assert.equal(result.previousCount, null);
  assert.equal(result.previous, null);
  assert.equal(result.percentChange, null);
  assert.equal(result.currentCount, 1);
});

test('zero baselines never produce fabricated percentages or infinity', () => {
  const growing = compareClicks({ events: [event(11 * DAY)], startAt, endAt, coverageStart: 0 });
  assert.equal(growing.previousCount, 0);
  assert.equal(growing.difference, 1);
  assert.equal(growing.percentChange, null);
  const empty = compareClicks({ events: [], startAt, endAt, coverageStart: 0 });
  assert.equal(empty.percentChange, 0);
  const declining = compareClicks({ events: [event(9 * DAY), event(9 * DAY + 1), event(11 * DAY)], startAt, endAt, coverageStart: 0 });
  assert.equal(declining.percentChange, -50);
});

test('unsupported huge and zero ranges do not allocate unbounded daily series', () => {
  for (const end of [startAt, startAt + 400 * DAY]) {
    const result = compareClicks({ events: [], startAt, endAt: end, coverageStart: 0 });
    assert.equal(result.available, false);
    assert.deepEqual(result.current, []);
  }
});

test('mock reader applies identical subject and metadata filters to both full periods, independently of pagination', async () => {
  const events = [event(11 * DAY), event(11 * DAY + 1), event(11 * DAY + 2, { source: 'instagram' })];
  const historyEvents = [event(9 * DAY), event(9 * DAY + 1, { origin: 'other.test' }), event(9 * DAY + 2, { place: 'footer' })];
  const reader = createMockClickReader({ events, historyEvents, coverageStart: 0 });
  const options = { domain: 'bio.test', startAt, endAt, pageSize: 1,
    filters: { source: 'facebook', campaign: 'launch', path: '/', place: 'header' } };
  const report = await reader.readClicks(options);
  assert.equal(report.count, 2);
  assert.equal(report.events.length, 1);
  assert.equal(report.trend.currentCount, 2);
  assert.equal(report.trend.previousCount, 1);
  assert.equal(report.trend.percentChange, 100);
  const next = await reader.readClicks({ ...options, page: 2 });
  assert.deepEqual(next.trend, report.trend);
});

test('default mock data includes older history for a 90-day comparison', async () => {
  const reader = createMockClickReader();
  const end = Date.now();
  const report = await reader.readClicks({ domain: 'all', startAt: end - 90 * DAY, endAt: end });
  assert.equal(report.generatedCount, 20000);
  assert.equal(report.mockSpanDays, 180);
  assert.equal(report.trend.available, true);
  assert.ok(report.trend.previousCount > 0);
  assert.equal(report.trend.currentCount, report.count);
  assert.equal(report.trend.current.length, 90);
  assert.equal(report.trend.previous.length, 90);
});

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Trend view did not render');
}

test('daily chart uses distinct line styles, human-readable change, and accessible daily values', async t => {
  const trend = compareClicks({ events: [event(9 * DAY), event(11 * DAY), event(11 * DAY + 1)], startAt, endAt, coverageStart: 0 });
  const reader = createMockClickReader({ events: [event(11 * DAY), event(11 * DAY + 1)], coverageStart: 0 });
  const report = await reader.readClicks({ domain: 'all', startAt, endAt });
  report.trend = trend;
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/report.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://die.test/report', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => ({ ok: true, json: async () => report });
  dom.window.eval(script);
  const d = dom.window.document;
  await waitFor(() => !d.getElementById('report').hidden);
  assert.equal(d.getElementById('trend-panel').hidden, false);
  assert.equal(d.querySelectorAll('#trend-chart path.trend-line').length, 2);
  assert.equal(d.querySelectorAll('#trend-chart path.previous').length, 1);
  assert.match(d.getElementById('trend-change').textContent, /100% more link clicks/);
  assert.equal(d.querySelectorAll('#trend-values table tr').length, 3);
  assert.equal(d.getElementById('drilldown').open, false);
});
