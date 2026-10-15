import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';
import { createIngestion } from '../src/ingestion.js';

const fixture = {
  event: 'click', url: 'http://die.test/test-clicks?source=test',
  origin: 'die.test', path: '/test-clicks', dest: 'http://die.test/health',
  scope: 'internal', place: 'nav', name: 'Test', source: 'test', campaign: null,
};

async function setup(t, forwardClick) {
  const ingestion = createIngestion({
    registryFile: new URL('../config/domains.local.json', import.meta.url),
    forwardClick,
  });
  const server = createApp({ ingestion });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

function post(base, click, headers = {}) {
  return fetch(base + '/api/click', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'test browser', ...headers },
    body: typeof click === 'string' ? click : JSON.stringify(click),
  });
}

test('ingestion reads the registry and forwards a valid click with browser context', async t => {
  const received = [];
  const base = await setup(t, async (...args) => { received.push(args); return { accepted: true }; });
  const registry = await fetch(base + '/api/domains');
  assert.equal(registry.status, 200);
  assert.deepEqual((await registry.json()).domains, ['die.test', 'labs.diainspace.com']);
  const result = await post(base, fixture);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { accepted: true });
  assert.equal(received.length, 1);
  assert.deepEqual(received[0][0], fixture);
  assert.equal(received[0][1].has('die.test'), true);
  assert.equal(received[0][2], 'test browser');
});

test('invalid, oversized, unregistered and cross-origin clicks are not forwarded', async t => {
  let calls = 0;
  const base = await setup(t, async () => { calls++; });
  assert.equal((await post(base, '{broken')).status, 400);
  assert.equal((await post(base, { ...fixture, name: 'x'.repeat(17000) })).status, 413);
  assert.equal((await post(base, { ...fixture, origin: 'wrong.test' })).status, 400);
  assert.equal((await post(base, { ...fixture, url: 'http://outside.test/test-clicks', origin: 'outside.test' })).status, 403);
  assert.equal((await post(base, fixture, { Origin: 'http://outside.test' })).status, 403);
  assert.equal((await post(base, fixture, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(base + '/api/click')).status, 405);
  assert.equal(calls, 0);
});

test('upstream failure returns a safe error while health remains live', async t => {
  const base = await setup(t, async () => { throw new Error('private API key and connection details'); });
  const result = await post(base, fixture);
  assert.equal(result.status, 502);
  assert.deepEqual(await result.json(), { error: 'umami_unavailable' });
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('ingestion routes are absent unless explicitly wired', async t => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await post(base, fixture)).status, 404);
  assert.equal((await fetch(base + '/api/domains')).status, 404);
});
