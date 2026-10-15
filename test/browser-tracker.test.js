import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startTracker } from '../src/browser-tracker.js';

test('browser tracker uses its gateway for registry and nonblocking credential-free delivery', async () => {
  const requests = [];
  let listener;
  const stop = () => {};
  const returned = await startTracker({
    scriptUrl: 'https://analytics.example.org/tracker.js',
    request: async (url, options) => {
      requests.push({ url: url.href, options });
      return { ok: true, json: async () => ({ domains: ['bio.example.org'] }) };
    },
    install: ({ domains, onClick }) => {
      assert.deepEqual(domains, ['bio.example.org']);
      listener = onClick;
      return stop;
    },
  });
  assert.equal(returned, stop);
  assert.equal(requests[0].url, 'https://analytics.example.org/api/domains');
  assert.equal(requests[0].options.credentials, 'omit');
  const event = { event: 'click', source: 'facebook', place: 'footer' };
  assert.equal(listener(event), undefined);
  assert.equal(requests[1].url, 'https://analytics.example.org/api/click');
  assert.equal(requests[1].options.credentials, 'omit');
  assert.equal(requests[1].options.keepalive, true);
  assert.deepEqual(JSON.parse(requests[1].options.body), event);
});

test('browser tracker does not install when registry loading fails', async () => {
  let installed = false;
  await assert.rejects(startTracker({
    request: async () => ({ ok: false }),
    install: () => { installed = true; },
  }), /Registry unavailable/);
  assert.equal(installed, false);
});

test('browser tracker absorbs delivery rejection without changing navigation', async () => {
  let listener;
  let calls = 0;
  await startTracker({
    request: async () => {
      if (++calls > 1) throw new Error('offline');
      return { ok: true, json: async () => ({ domains: ['bio.example.org'] }) };
    },
    install: ({ onClick }) => { listener = onClick; },
  });
  assert.equal(listener({ event: 'click' }), undefined);
  await new Promise(resolve => setImmediate(resolve));
});
