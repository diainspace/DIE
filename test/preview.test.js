import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

async function serve(t, options) {
  const server = createApp(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('local preview serves only its exact public files', async t => {
  const base = await serve(t, { enableLocalPreview: true });
  for (const path of ['/test-clicks', '/tracker/click-listener.js', '/tracker/classify-link.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), path === '/test-clicks' ? /text\/html/ : /text\/javascript/);
    assert.ok((await response.text()).length > 0);
  }
  for (const path of ['/.env', '/tracker/../../.env', '/package.json', '/src/database.js']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  assert.equal((await fetch(base + '/test-clicks', { method: 'POST' })).status, 405);
});

test('local preview is disabled by default', async t => {
  const base = await serve(t);
  assert.equal((await fetch(base + '/test-clicks')).status, 404);
  assert.equal((await fetch(base + '/tracker/click-listener.js')).status, 404);
});


test('production tracker exposes only browser modules while local preview stays disabled', async t => {
  const base = await serve(t, { enableTracker: true });
  const entry = await fetch(base + '/tracker.js');
  assert.equal(entry.status, 200);
  const source = await entry.text();
  const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)];
  assert.equal(imports.length, 1);
  const moduleUrl = new URL(imports[0][1], base + '/tracker.js');
  const module = await fetch(moduleUrl);
  assert.equal(module.status, 200);
  for (const path of ['/tracker.js', '/tracker/click-listener.js', '/tracker/classify-link.js', '/tracker/infer-place.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(base + path, { method: 'POST' })).status, 405);
  }
  for (const path of ['/test-clicks', '/.env', '/src/database.js', '/tracker/umami-api.js']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
});
