import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMockClicks, createMockClickReader } from '../src/reporting/mock-clicks.js';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

const now = Date.parse('2026-10-15T15:00:00Z');
const events = generateMockClicks({ now });
const reader = createMockClickReader({ events });
const options = { domain: 'all', startAt: now - 90 * 86400000, endAt: now, page: 1, pageSize: 25 };

test('mock dataset is large, varied, deterministic, and explicitly fictional', async () => {
  assert.equal(events.length, 12000);
  assert.equal(new Set(events.map(e => e.id)).size, 12000);
  assert.equal(new Set(events.map(e => e.origin)).size, 8);
  assert.ok(new Set(events.map(e => e.source)).size >= 10);
  assert.ok(new Set(events.map(e => e.campaign)).size >= 10);
  assert.ok(new Set(events.map(e => e.path)).size >= 6);
  assert.deepEqual(new Set(events.map(e => e.scope)), new Set(['internal', 'external', 'same-page']));
  assert.ok(events.every(e => e.id.startsWith('mock-') && e.entry === null));
  assert.ok(events.some(e => e.source === null) && events.some(e => e.name === ''));
  assert.deepEqual(generateMockClicks({ count: 10, now }), generateMockClicks({ count: 10, now }));
  const report = await reader.readClicks(options);
  assert.equal(report.dataset, 'mock');
  assert.equal(report.synthetic, true);
  assert.equal(report.count, 12000);
  assert.equal(report.events.length, 25);
  assert.equal(report.breakdowns.source.reduce((sum, row) => sum + row.count, 0), 12000);
});

test('mock filters combine across source, campaign, path and placement over the complete dataset', async () => {
  const filters = { source: 'facebook', campaign: 'kling_video', path: '/', place: 'header' };
  const report = await reader.readClicks({ ...options, filters });
  const expected = events.filter(e => Object.entries(filters).every(([field, value]) => e[field] === value));
  assert.ok(expected.length > 0);
  assert.equal(report.count, expected.length);
  assert.deepEqual(report.events, expected.slice(0, 25));
  assert.equal(report.breakdowns.campaign[0].value, 'kling_video');
  assert.equal(report.breakdowns.source.reduce((sum, row) => sum + row.count, 0), expected.length);
});

test('mock pagination does not change aggregate charts and unknown filters remain honest', async () => {
  const first = await reader.readClicks(options);
  const second = await reader.readClicks({ ...options, page: 2 });
  assert.deepEqual(first.breakdowns, second.breakdowns);
  assert.equal(first.count, second.count);
  assert.equal(first.events.some(a => second.events.some(b => a.id === b.id)), false);
  const unknown = await reader.readClicks({ ...options, filters: { source: '__unknown__' } });
  assert.ok(unknown.count > 0);
  assert.ok(unknown.events.every(event => event.source === null));
  const empty = await reader.readClicks({ ...options, filters: { source: 'nonexistent-source' } });
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.events, []);
});

test('mock website and date filters change the actual result set', async () => {
  const report = await reader.readClicks({ ...options, domain: 'bio.diainspace.com', startAt: now - 7 * 86400000 });
  assert.ok(report.count > 0 && report.count < 12000);
  assert.ok(report.events.every(event => event.origin === 'bio.diainspace.com' && Date.parse(event.timestamp) >= now - 7 * 86400000));
  assert.equal(report.summary.websites, 1);
});

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Mock view did not update');
}

test('mock preview defaults to clearly marked mock data and applies and clears combined filters', async t => {
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/report.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://die.test/report', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  const calls = [];
  dom.window.fetch = async url => {
    const query = new URL(url, 'http://die.test').searchParams;
    calls.push(query);
    const filters = Object.fromEntries(['source', 'campaign', 'origin', 'path', 'place', 'dest', 'scope'].filter(key => query.has(key)).map(key => [key, query.get(key)]));
    const result = await reader.readClicks({ ...options, page: Number(query.get('page')), filters });
    return { ok: true, json: async () => result };
  };
  dom.window.eval(script);
  const d = dom.window.document;
  await waitFor(() => !d.getElementById('report').hidden);
  assert.equal(calls[0].get('dataset'), 'mock');
  assert.match(d.getElementById('data-badge').textContent, /MOCK/);
  assert.equal(d.getElementById('mock-notice').hidden, false);
  assert.match(d.getElementById('scope-note').textContent, /all 12,000 mock clicks in this view/);
  assert.equal(d.querySelectorAll('#clicks details').length, 0);
  assert.equal(d.getElementById('drilldown').open, false);
  assert.equal(d.getElementById('clicks'), null);
  assert.ok(d.getElementById('export-clicks'));
  d.getElementById('filter-source').value = 'facebook';
  d.getElementById('filter-campaign').value = 'kling_video';
  d.getElementById('filter-place').value = 'header';
  d.getElementById('filters').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await waitFor(() => calls.length === 2 && !d.getElementById('refresh').disabled);
  assert.equal(calls[1].get('source'), 'facebook');
  assert.equal(calls[1].get('campaign'), 'kling_video');
  assert.equal(calls[1].get('place'), 'header');
  assert.equal(d.querySelectorAll('#active-filters button').length, 3);
  assert.equal(d.querySelectorAll('#source-chart li').length, 1);
  d.getElementById('clear').click();
  await waitFor(() => calls.length === 3 && !d.getElementById('refresh').disabled);
  assert.equal(calls[2].has('source'), false);
  assert.equal(d.querySelectorAll('#active-filters button').length, 0);
});


async function subjectView(t, saved, blocked = false) {
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/report.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://die.test/report', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  if (blocked) Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('Blocked'); } });
  else if (saved) dom.window.localStorage.setItem('die.report.subject.v1', saved);
  const calls = [];
  dom.window.fetch = async url => {
    const query = new URL(url, 'http://die.test').searchParams;
    calls.push(query);
    const result = await reader.readClicks({ ...options, domain: query.get('domain'), page: Number(query.get('page')) });
    return { ok: true, json: async () => result };
  };
  dom.window.eval(script);
  await waitFor(() => !dom.window.document.getElementById('report').hidden);
  return { window: dom.window, document: dom.window.document, calls };
}

test('subject selection is primary, drilldown starts closed, and applied subject is remembered', async t => {
  const { window, document: d, calls } = await subjectView(t);
  assert.equal(d.getElementById('drilldown').open, false);
  assert.equal(d.getElementById('refresh').closest('.primary-filters'), d.getElementById('domain').closest('.primary-filters'));
  d.getElementById('domain').value = 'bio.diainspace.com';
  d.getElementById('domain').dispatchEvent(new window.Event('change'));
  assert.equal(calls.length, 1);
  assert.equal(d.getElementById('selection-hint').hidden, false);
  assert.equal(d.getElementById('subject-title').textContent, 'All websites');
  d.getElementById('period').value = '90';
  d.getElementById('filters').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await waitFor(() => calls.length === 2 && !d.getElementById('refresh').disabled);
  assert.equal(d.getElementById('subject-title').textContent, 'bio.diainspace.com');
  assert.match(d.getElementById('subject-context').textContent, /Last 90 days/);
  assert.equal(d.getElementById('selection-hint').hidden, true);
  const saved = window.localStorage.getItem('die.report.subject.v1');
  assert.deepEqual(JSON.parse(saved), { dataset: 'mock', domain: 'bio.diainspace.com', period: '90' });
  const reopened = await subjectView(t, saved);
  assert.equal(reopened.calls[0].get('domain'), 'bio.diainspace.com');
  assert.equal(reopened.document.getElementById('period').value, '90');
  assert.equal(reopened.document.getElementById('subject-title').textContent, 'bio.diainspace.com');
  assert.equal(reopened.document.getElementById('drilldown').open, false);
});

test('report stays usable with invalid saved preferences or unavailable browser storage', async t => {
  for (const [saved, blocked] of [['{broken', false], [JSON.stringify({ dataset: 'mock', domain: '<img src=x>', period: '90' }), false], [null, true]]) {
    const view = await subjectView(t, saved, blocked);
    assert.equal(view.calls[0].get('domain'), 'all');
    assert.equal(view.document.getElementById('report').hidden, false);
  }
});
