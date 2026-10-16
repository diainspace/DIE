import { clicksCsv, exportClickRows } from './export-clicks.js';

function optionsFrom(url) {
  const query = new URL(url, 'http://local.invalid').searchParams;
  const fields = ['source', 'campaign', 'origin', 'path', 'place', 'dest', 'scope'];
  const allowed = ['format', 'dataset', 'domain', 'startAt', 'endAt', 'page', 'pageSize', ...fields];
  if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)) {
    throw new Error('Invalid report query');
  }
  const number = (key, fallback) => {
    if (!query.has(key)) return fallback;
    const value = query.get(key);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Invalid report query');
    return Number(value);
  };
  const format = query.get('format') ?? 'json';
  if (!['json', 'csv'].includes(format)) throw new Error('Invalid report query');
  const dataset = query.get('dataset') ?? 'local';
  if (!['local', 'mock'].includes(dataset)) throw new Error('Invalid report query');
  const filters = Object.fromEntries(fields.filter(field => query.get(field)).map(field => [field, query.get(field)]));
  if (Object.values(filters).some(value => value.length > 2048) ||
      (dataset === 'local' && Object.keys(filters).length)) throw new Error('Invalid report query');
  const endAt = number('endAt', Date.now());
  const options = {
    domain: (query.get('domain') ?? (dataset === 'mock' ? 'all' : 'die.test')).trim().toLowerCase(),
    startAt: number('startAt', Math.max(0, endAt - 30 * 86400000)),
    endAt,
    page: number('page', 1),
    pageSize: number('pageSize', 25),
  };
  if (!options.domain || options.domain.length > 253 || /[\s/:?#]/.test(options.domain) ||
      options.startAt > endAt || endAt > 8640000000000000 ||
      options.page < 1 || options.page > 1000000 || options.pageSize < 1 || options.pageSize > 100) {
    throw new Error('Invalid report query');
  }
  return { dataset, options, filters, format };
}

export async function serveLocalReport(request, response, reader, mockReader) {
  let status = 200;
  let result;
  try {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      status = 405;
      result = { error: 'method_not_allowed' };
    } else {
      if (request.headers.origin && new URL(request.headers.origin).host !== request.headers.host) {
        status = 403;
        result = { error: 'origin_not_allowed' };
      } else {
        let options;
        try { options = optionsFrom(request.url); } catch {
          status = 400;
          result = { error: 'invalid_report_query' };
        }
        if (options?.format === 'csv') {
          const selectedReader = options.dataset === 'mock' ? mockReader : reader;
          if (!selectedReader) throw new Error('Export unavailable');
          const rows = await exportClickRows(selectedReader, { ...options.options, filters: options.filters });
          const csv = clicksCsv(rows, options.dataset);
          const day = time => new Date(time).toISOString().slice(0, 10);
          const filename = `die-${options.dataset}-clicks-${day(options.options.startAt)}-to-${day(options.options.endAt)}.csv`;
          response.writeHead(200, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Content-Length': Buffer.byteLength(csv),
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(csv);
          return;
        }
        if (options) {
          if (options.dataset === 'mock') {
            if (!mockReader) throw new Error('Mock reporting unavailable');
            result = await mockReader.readClicks({ ...options.options, filters: options.filters });
          } else {
            result = { ...await reader.readClicks(options.options), dataset: 'local' };
          }
        }
      }
    }
  } catch (error) {
    status = error.message === 'export_too_large' ? 413 : error.message === 'Umami property not found' ? 404 : 503;
    result = { error: status === 413 ? 'export_too_large' : status === 404 ? 'property_not_found' : 'report_unavailable' };
  }
  const body = JSON.stringify(result);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}
