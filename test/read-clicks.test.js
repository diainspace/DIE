import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClickReader } from '../src/reporting/read-clicks.js';

const website = { id: '11111111-1111-4111-8111-111111111111', domain: 'die.test' };
const id = n => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`;
const event = n => ({ id: id(n), websiteId: website.id, eventName: 'click',
  createdAt: '2026-10-15T12:00:00.000Z', hostname: 'die.test', urlPath: '/', hasData: true });
const row = (n, key, value) => ({ websiteId: website.id, eventId: id(n),
  dataKey: key, dataType: 1, stringValue: value });
const options = { domain: 'die.test', startAt: 0, endAt: 1792100000000, pageSize: 2 };

function setup({ data = [event(1)], count = data.length, properties = [row(1, 'source', 'facebook')], handle } = {}) {
  const calls = [];
  const reader = createClickReader({ request: async (path, config) => {
    calls.push({ path, config });
    const url = new URL(path, 'http://local.test');
    const custom = await handle?.(url);
    if (custom !== undefined) return custom;
    if (url.pathname === '/api/websites') return { data: [website], count: 1, page: 1, pageSize: 100 };
    if (url.pathname.endsWith('/events')) return { data, count, page: Number(url.searchParams.get('page')), pageSize: Number(url.searchParams.get('pageSize')), isCapped: false };
    return properties.filter(p => url.pathname.endsWith(p.eventId));
  } });
  return { ...reader, calls };
}

test('report reader combines click properties, preserves unknowns and only issues GET requests', async () => {
  const { readClicks, calls } = setup({ properties: [
    row(1, 'source', 'facebook'), row(1, 'campaign', 'test'), row(1, 'name', 'GitHub'),
    row(1, 'place', 'header'), row(1, 'dest', 'https://github.com/diainspace/'),
  ] });
  const report = await readClicks({ ...options, domain: ' DIE.TEST ' });
  assert.equal(report.events[0].source, 'facebook');
  assert.equal(report.events[0].campaign, 'test');
  assert.equal(report.events[0].name, 'GitHub');
  assert.equal(report.events[0].entry, null);
  assert.equal(report.events[0].origin, null);
  assert.equal(report.events[0].page.hostname, 'die.test');
  assert.equal(report.events[0].properties.length, 5);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.config.method === 'GET' && !call.config.body));
  const query = new URL(calls[1].path, 'http://local.test').searchParams;
  assert.equal(query.get('event'), 'click');
  assert.equal(query.get('startAt'), '0');
});

test('report reader retains page metadata and skips property calls for events without data', async () => {
  const { readClicks, calls } = setup({ data: [{ ...event(1), hasData: false }], count: 5 });
  const report = await readClicks({ ...options, page: 2 });
  assert.equal(report.page, 2);
  assert.equal(report.count, 5);
  assert.equal(report.hasNextPage, true);
  assert.equal(report.events[0].source, null);
  assert.equal(calls.length, 2);
});

test('empty event pages are valid and require no property requests', async () => {
  const { readClicks, calls } = setup({ data: [] });
  const report = await readClicks(options);
  assert.deepEqual(report.events, []);
  assert.equal(report.hasNextPage, false);
  assert.equal(calls.length, 2);
});

test('property lookup requires an exact domain match and follows list pagination', async () => {
  const { readClicks, calls } = setup({ handle: url => {
    if (url.pathname !== '/api/websites') return;
    const page = Number(url.searchParams.get('page'));
    return { data: page === 1 ? [{ ...website, domain: 'other.die.test' }] : [website], count: 101, page, pageSize: 100 };
  } });
  await readClicks(options);
  assert.equal(calls.filter(c => c.path.startsWith('/api/websites?')).length, 2);
});

test('missing properties never trigger automatic website creation', async () => {
  const { readClicks, calls } = setup({ handle: url => url.pathname === '/api/websites'
    ? { data: [], count: 0, page: 1, pageSize: 100 } : undefined });
  await assert.rejects(readClicks(options), /property not found/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.method, 'GET');
});

test('invalid report options fail before any API request', async () => {
  const { readClicks, calls } = setup();
  for (const change of [{ pageSize: 101 }, { page: 0 }, { startAt: -1 }, { endAt: -1 }, { domain: '' }, { startAt: 5, endAt: 4 }]) {
    await assert.rejects(readClicks({ ...options, ...change }), /Invalid click-report options/);
  }
  assert.equal(calls.length, 0);
});

test('malformed pages and mismatched event properties fail instead of producing misleading reports', async () => {
  await assert.rejects(setup({ count: -1 }).readClicks(options), /Unexpected/);
  await assert.rejects(setup({ data: [{ ...event(1), eventName: 'pageview' }] }).readClicks(options), /Unexpected/);
  await assert.rejects(setup({ properties: [{ ...row(1, 'source', 'test'), websiteId: id(9) }] }).readClicks(options), /Unexpected/);
  await assert.rejects(setup({ properties: [row(1, 'source', 'one'), row(1, 'source', 'two')] }).readClicks(options), /Unexpected/);
});

test('property fetches have bounded concurrency and preserve event order', async () => {
  const data = Array.from({ length: 9 }, (_, i) => event(i + 1));
  let active = 0;
  let peak = 0;
  const { readClicks } = setup({ data, handle: async url => {
    if (!url.pathname.includes('/event-data/')) return;
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
    return [];
  } });
  const report = await readClicks({ ...options, pageSize: 10 });
  assert.ok(peak <= 4 && peak > 1);
  assert.deepEqual(report.events.map(e => e.id), data.map(e => e.id));
});

test('upstream failures remain generic rather than leaking private details', async () => {
  const { readClicks } = createClickReader({ request: async () => { throw new Error('private API secret'); } });
  await assert.rejects(readClicks(options), { message: 'Umami reporting request failed' });
});
