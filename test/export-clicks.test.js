import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { clicksCsv, exportClickRows } from '../src/reporting/export-clicks.js';
import { generateMockClicks, createMockClickReader } from '../src/reporting/mock-clicks.js';
import { createApp } from '../src/app.js';

const now = Date.parse('2026-10-15T15:00:00Z');
const options = { domain: 'all', startAt: now - 90 * 86400000, endAt: now };

test('CSV quotes commas, quotation marks and newlines, labels dataset and protects spreadsheet formulas', () => {
  const csv = clicksCsv([{ id: 'example', name: 'Quoted "name", next\nline', source: '=SUM(1,2)', campaign: '  @formula', dest: 'https://example.org/', entry: null }], 'mock');
  assert.ok(csv.startsWith('\uFEFF"dataset"'));
  assert.ok(csv.includes('"mock"'));
  assert.ok(csv.includes('"Quoted ""name"", next\nline"'));
  assert.ok(csv.includes('"\'=SUM(1,2)"'));
  assert.ok(csv.includes('"\'  @formula"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('mock export includes all filtered rows regardless of requested page', async () => {
  const events = generateMockClicks({ now });
  const reader = createMockClickReader({ events });
  const filters = { source: 'facebook', place: 'header' };
  const report = await reader.readClicks({ ...options, page: 2, pageSize: 1, filters });
  const rows = await exportClickRows(reader, { ...options, page: 2, pageSize: 1, filters });
  assert.equal(rows.length, report.count);
  assert.ok(rows.length > 1);
  assert.ok(rows.every(row => row.source === 'facebook' && row.place === 'header'));
});

test('collected-data export reads all pages and rejects capped or incomplete results', async () => {
  const calls = [];
  const events = Array.from({ length: 205 }, (_, i) => ({ id: `local-${i}` }));
  const reader = { readClicks: async query => {
    calls.push(query);
    return { count: events.length, events: events.slice((query.page - 1) * 100, query.page * 100), isCapped: false };
  } };
  const rows = await exportClickRows(reader, options);
  assert.equal(rows.length, 205);
  assert.deepEqual(calls.map(call => call.page), [1, 2, 3]);
  assert.ok(calls.every(call => call.pageSize === 100));
  await assert.rejects(exportClickRows({ readClicks: async () => ({ count: 2, events: [{ id: 'one' }], isCapped: false }) }, options), /export_incomplete/);
  await assert.rejects(exportClickRows({ readClicks: async () => ({ count: 5, events: [], isCapped: true }) }, options), /export_too_large/);
});

async function serve(t, options) {
  const server = createApp(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('CSV endpoint exports every mock row with attachment headers and stays development-only', async t => {
  const events = generateMockClicks({ now });
  const mockReporting = createMockClickReader({ events });
  let localCalls = 0;
  const localReporting = { readClicks: () => { localCalls++; throw new Error('Must not touch Umami'); } };
  const base = await serve(t, { enableLocalPreview: true, localReporting, mockReporting });
  const query = new URLSearchParams({ dataset: 'mock', format: 'csv', domain: 'all', startAt: String(options.startAt), endAt: String(now), page: '2', pageSize: '1' });
  const response = await fetch(base + '/reports/clicks?' + query);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="die-mock-clicks-/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const csv = await response.text();
  assert.equal(csv.split('\r\n').length - 2, 12000);
  assert.equal(localCalls, 0);
  const production = await serve(t, { localReporting, mockReporting });
  assert.equal((await fetch(production + '/reports/clicks?' + query)).status, 404);
});
