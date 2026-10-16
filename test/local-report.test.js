import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createApp } from '../src/app.js';

const example = {
  property: { domain: 'die.test' }, range: { startAt: 0, endAt: 100 },
  page: 1, pageSize: 25, count: 27, isCapped: false, hasNextPage: true,
  events: [{ id: 'test', timestamp: '2026-10-15T12:00:00Z', name: 'GitHub',
    source: 'facebook', campaign: 'test', entry: null, origin: 'die.test',
    path: '/', place: 'header', scope: 'external', dest: 'https://github.com/diainspace/' }],
};
async function serve(t, options) {
  const server = createApp(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('report routes remain unavailable unless local preview and a reader are both enabled', async t => {
  for (const options of [{}, { enableLocalPreview: true }, { localReporting: { readClicks: () => example }, enableTracker: true }]) {
    const base = await serve(t, options);
    for (const path of ['/report', '/report.js', '/report.css', '/reports/clicks']) {
      assert.equal((await fetch(base + path)).status, 404);
    }
  }
});

test('local report serves exact assets and validated read-only JSON without credentials or CORS', async t => {
  const queries = [];
  const base = await serve(t, { enableLocalPreview: true,
    localReporting: { readClicks: async options => { queries.push(options); return example; } } });
  for (const [path, type] of [['/report', 'text/html'], ['/report.js', 'text/javascript'], ['/report.css', 'text/css']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const response = await fetch(base + '/reports/clicks?domain=die.test&startAt=0&endAt=100&page=2&pageSize=10');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(await response.json(), { ...example, dataset: 'local' });
  assert.deepEqual(queries, [{ domain: 'die.test', startAt: 0, endAt: 100, page: 2, pageSize: 10 }]);
  for (const query of ['page=0', 'startAt=20&endAt=10', 'pageSize=101', 'domain=die.test&domain=other.test', 'startAt=no', 'key=secret', 'domain=https://die.test']) {
    assert.equal((await fetch(base + '/reports/clicks?' + query)).status, 400);
  }
  assert.equal((await fetch(base + '/reports/clicks', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/reports/clicks', { headers: { Origin: 'https://outside.test' } })).status, 403);
  assert.equal(queries.length, 1);
  for (const path of ['/.env', '/src/reporting/read-clicks.js', '/public/report.html']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});

test('local report failure does not leak upstream details or affect health', async t => {
  const base = await serve(t, { enableLocalPreview: true,
    localReporting: { readClicks: async () => { throw new Error('secret key and database credentials'); } } });
  const response = await fetch(base + '/reports/clicks');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'report_unavailable' });
  assert.equal((await fetch(base + '/health')).status, 200);
});

async function view(t, request) {
  const html = await readFile(new URL('../public/report.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/report.js', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://die.test/report', runScripts: 'outside-only' });
  t.after(() => dom.window.close());
  dom.window.fetch = request;
  dom.window.eval(script);
  return dom.window;
}
async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('View did not finish rendering');
}

test('report view distinguishes loaded-page charts from totals and safely renders recorded labels', async t => {
  const report = structuredClone(example);
  report.events[0].source = '<img src=x onerror=alert(1)>';
  report.events[0].campaign = null;
  const calls = [];
  const window = await view(t, async url => { calls.push(url); return { ok: true, json: async () => report }; });
  const document = window.document;
  await until(() => !document.getElementById('report').hidden);
  assert.equal(document.getElementById('total').textContent, '27');
  assert.equal(document.getElementById('loaded').textContent, '1');
  assert.match(document.getElementById('scope-note').textContent, /not the entire period/);
  assert.equal(document.querySelector('#source-chart meter').value, 1);
  assert.equal(document.querySelector('#source-chart span').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(document.querySelector('#source-chart img'), null);
  assert.match(document.getElementById('campaign-chart').textContent, /Unknown/);
  assert.equal(document.getElementById('clicks'), null);
  assert.ok(document.getElementById('export-clicks'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  document.getElementById('filters').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => calls.length === 2);
});

test('report view explains empty data and unavailable properties', async t => {
  const empty = { ...example, count: 0, events: [], hasNextPage: false };
  let available = true;
  const window = await view(t, async () => ({ ok: available, json: async () => available ? empty : { error: 'property_not_found' } }));
  const document = window.document;
  await until(() => !document.getElementById('report').hidden);
  assert.match(document.getElementById('source-chart').textContent, /No clicks/);
  assert.equal(document.getElementById('total').textContent, '0');
  available = false;
  document.getElementById('filters').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => !document.getElementById('error').hidden);
  assert.match(document.getElementById('error').textContent, /no local Umami property/);
  assert.equal(document.getElementById('report').hidden, true);
});


test('mock reports never call local Umami and remain inaccessible without the development gate', async t => {
  let calls = 0;
  const localReporting = { readClicks: () => { calls++; throw new Error('Must not read local data'); } };
  const mockReporting = { readClicks: async options => ({ dataset: 'mock', received: options }) };
  const base = await serve(t, { enableLocalPreview: true, localReporting, mockReporting });
  const response = await fetch(base + '/reports/clicks?dataset=mock&source=facebook&campaign=test&place=footer&path=%2F');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.received.filters, { source: 'facebook', campaign: 'test', path: '/', place: 'footer' });
  assert.equal(result.received.domain, 'all');
  assert.equal(calls, 0);
  assert.equal((await fetch(base + '/reports/clicks?dataset=local&source=facebook')).status, 400);
  assert.equal((await fetch(base + '/reports/clicks?dataset=other')).status, 400);
  const production = await serve(t, { localReporting, mockReporting, enableTracker: true });
  assert.equal((await fetch(production + '/reports/clicks?dataset=mock')).status, 404);
});


test('CSV download uses the applied view even when subject controls have pending changes', async t => {
  const calls = [];
  let downloaded;
  const window = await view(t, async url => {
    calls.push(url);
    if (new URL(url, 'http://die.test').searchParams.get('format') === 'csv') {
      return { ok: true, blob: async () => new window.Blob(['csv']),
        headers: { get: () => 'attachment; filename="die-mock-clicks.csv"' } };
    }
    return { ok: true, json: async () => example };
  });
  const d = window.document;
  window.URL.createObjectURL = () => 'blob:local-export';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  await until(() => !d.getElementById('report').hidden);
  d.getElementById('domain').append(new window.Option('other.test', 'other.test'));
  d.getElementById('domain').value = 'other.test';
  d.getElementById('domain').dispatchEvent(new window.Event('change'));
  d.getElementById('export-clicks').click();
  await until(() => downloaded !== undefined);
  const loaded = new URL(calls[0], 'http://die.test').searchParams;
  const exported = new URL(calls[1], 'http://die.test').searchParams;
  assert.equal(exported.get('format'), 'csv');
  assert.equal(exported.get('domain'), loaded.get('domain'));
  assert.equal(exported.get('startAt'), loaded.get('startAt'));
  assert.equal(exported.get('endAt'), loaded.get('endAt'));
  assert.equal(exported.has('page'), false);
  assert.equal(downloaded, 'die-mock-clicks.csv');
});
