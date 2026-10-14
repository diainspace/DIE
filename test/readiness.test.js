import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

test('readiness fails safely while liveness stays available, then recovers', async t => {
  let available = false;
  let calls = 0;
  const server = createApp({ checkDatabase: async () => {
    calls++;
    if (!available) throw new Error('secret connection details must not appear');
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const failed = await fetch(`${base}/ready`);
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), {
    service: 'die-interface', status: 'not_ready', database: 'unavailable',
  });
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal(calls, 1);

  const rejected = await fetch(`${base}/ready`, { method: 'POST' });
  assert.equal(rejected.status, 405);
  assert.equal(calls, 1);

  available = true;
  const recovered = await fetch(`${base}/ready`);
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), {
    service: 'die-interface', status: 'ready', database: 'ok',
  });
  const head = await fetch(`${base}/ready`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});
