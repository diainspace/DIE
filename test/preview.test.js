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
