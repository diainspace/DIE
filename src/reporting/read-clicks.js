import { umamiRequest } from '../umami-api.js';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const FIELDS = ['source', 'campaign', 'entry', 'origin', 'path', 'place', 'dest', 'name', 'scope'];

function invalidResponse() {
  throw new Error('Unexpected Umami reporting response');
}

function validatePage(result, page, pageSize) {
  if (!result || !Array.isArray(result.data) ||
      !Number.isSafeInteger(result.count) || result.count < 0 ||
      result.page !== page || result.pageSize !== pageSize || result.data.length > pageSize) {
    invalidResponse();
  }
}

// Private server-side reader. It does not create websites, send events, or write a database.
export function createClickReader({ request = umamiRequest } = {}) {
  async function get(path) {
    try {
      return await request(path, { method: 'GET' });
    } catch {
      // Never forward upstream bodies, API keys, or transport details to a future UI.
      throw new Error('Umami reporting request failed');
    }
  }

  async function findWebsite(domain) {
    // Bound discovery requests; fail explicitly rather than returning partial results.
    for (let page = 1; page <= 10; page++) {
      const query = new URLSearchParams({ search: domain, page: String(page), pageSize: '100' });
      const result = await get(`/api/websites?${query}`);
      validatePage(result, page, 100);
      const website = result.data.find(site => site.domain?.toLowerCase() === domain);
      if (website) {
        if (!UUID.test(website.id)) invalidResponse();
        return website;
      }
      if (page * 100 >= result.count) throw new Error('Umami property not found');
    }
    throw new Error('Umami property search limit exceeded');
  }

  async function readClicks({ domain, startAt, endAt, page = 1, pageSize = 25 } = {}) {
    if (typeof domain !== 'string' || !domain.trim() ||
        !Number.isSafeInteger(startAt) || startAt < 0 ||
        !Number.isSafeInteger(endAt) || endAt < startAt || endAt > 8640000000000000 ||
        !Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new Error('Invalid click-report options');
    }
    domain = domain.trim().toLowerCase();
    const website = await findWebsite(domain);
    const query = new URLSearchParams({
      startAt: String(startAt), endAt: String(endAt),
      event: 'click', page: String(page), pageSize: String(pageSize),
    });
    const result = await get(`/api/websites/${website.id}/events?${query}`);
    validatePage(result, page, pageSize);
    const ids = new Set();
    for (const event of result.data) {
      if (!event || !UUID.test(event.id) || event.websiteId !== website.id ||
          event.eventName !== 'click' || !Number.isFinite(Date.parse(event.createdAt)) ||
          ids.has(event.id)) invalidResponse();
      ids.add(event.id);
    }

    const events = new Array(result.data.length);
    let next = 0;
    async function worker() {
      while (next < result.data.length) {
        const index = next++;
        const event = result.data[index];
        const rows = event.hasData
          ? await get(`/api/websites/${website.id}/event-data/${event.id}`) : [];
        if (!Array.isArray(rows)) invalidResponse();
        const keys = new Set();
        for (const row of rows) {
          if (!row || row.websiteId !== website.id || row.eventId !== event.id ||
              typeof row.dataKey !== 'string' || keys.has(row.dataKey)) invalidResponse();
          keys.add(row.dataKey);
        }
        // Canonical click fields are strings. Keep original typed rows for future extensions.
        const strings = new Map(rows.filter(row => row.dataType === 1 &&
          typeof row.stringValue === 'string').map(row => [row.dataKey, row.stringValue]));
        const fields = Object.fromEntries(FIELDS.map(field => [field, strings.get(field) ?? null]));
        events[index] = {
          id: event.id,
          event: 'click',
          timestamp: new Date(event.createdAt).toISOString(),
          ...fields,
          // Native event context is separate: do not invent missing entry/source attribution.
          page: { hostname: event.hostname ?? null, path: event.urlPath ?? null },
          properties: rows.map(row => ({
            key: row.dataKey, type: row.dataType,
            stringValue: row.stringValue ?? null,
            numberValue: row.numberValue ?? null,
            dateValue: row.dateValue ?? null,
          })),
        };
      }
    }
    // Bounded parallel property reads, preserving upstream event order.
    await Promise.all(Array.from({ length: Math.min(4, events.length) }, worker));
    return {
      property: { id: website.id, domain },
      range: { startAt, endAt },
      page, pageSize, count: result.count,
      isCapped: result.isCapped === true,
      hasNextPage: page * pageSize < result.count,
      events,
    };
  }

  return { readClicks };
}
