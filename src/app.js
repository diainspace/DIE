import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { IngestionError, readClickBody } from './ingestion.js';

const previewFiles = new Map([
  ['/test-clicks', [new URL('../public/test-clicks.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/tracker/click-listener.js', [new URL('./tracker/click-listener.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/tracker/classify-link.js', [new URL('./tracker/classify-link.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/tracker/infer-place.js', [new URL('./tracker/infer-place.js', import.meta.url), 'text/javascript; charset=utf-8',]],
]); 

const trackerFiles = new Map([
  ['/tracker.js', [new URL('./browser-tracker.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ...[...previewFiles].filter(([path]) => path.startsWith('/tracker/')),
]);

// Liveness is independent of database readiness.
export function createApp({ ingestion, enableTracker = false, enableLocalPreview = false, checkDatabase = async () => { throw new Error('Not configured'); } } = {}) {
  return createServer(async (request, response) => {
    const path = request.url?.split('?')[0];
    let statusCode = 200;
    let body = { service: 'die-interface', status: 'ok' };

    if (ingestion && ['/api/click', '/api/domains'].includes(path)) {
      const expectedMethod = path === '/api/click' ? 'POST' : 'GET';
      let result;
      try {
        const origin = request.headers.origin;
        let crossOrigin = false;
        if (origin) {
          let parsed;
          try { parsed = new URL(origin); } catch {
            throw new IngestionError(403, 'origin_not_allowed');
          }
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
            throw new IngestionError(403, 'origin_not_allowed');
          }
          crossOrigin = parsed.host !== request.headers.host;
          if (crossOrigin && !(await ingestion.domains()).has(parsed.hostname)) {
            throw new IngestionError(403, 'origin_not_allowed');
          }
          response.setHeader('Access-Control-Allow-Origin', origin);
        }
        response.setHeader('Vary', 'Origin');
        if (request.method === 'OPTIONS' && origin) {
          const headers = (request.headers['access-control-request-headers'] || '')
            .toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
          if (request.headers['access-control-request-method'] !== expectedMethod ||
              headers.some(header => header !== 'content-type')) {
            throw new IngestionError(403, 'preflight_not_allowed');
          }
          response.writeHead(204, {
            'Access-Control-Allow-Methods': expectedMethod,
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '300',
            'Cache-Control': 'no-store',
          });
          response.end();
          return;
        }
        if (request.method !== expectedMethod) {
          response.setHeader('Allow', `${expectedMethod}, OPTIONS`);
          throw new IngestionError(405, 'method_not_allowed');
        }
        if (path === '/api/click') {
          const click = await readClickBody(request);
          if (crossOrigin) {
            let pageOrigin;
            try { pageOrigin = new URL(click?.url).origin; } catch {
              throw new IngestionError(400, 'invalid_url');
            }
            if (pageOrigin !== origin) throw new IngestionError(403, 'origin_mismatch');
          }
          result = await ingestion.ingest(click, request.headers['user-agent']);
        } else {
          result = { domains: [...await ingestion.domains()] };
        }
      } catch (error) {
        statusCode = error instanceof IngestionError ? error.status : 500;
        result = { error: error instanceof IngestionError ? error.message : 'ingestion_failed' };
      }
      const payload = JSON.stringify(result);
      response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : payload);
      return;
    }

    const productionAsset = enableTracker ? trackerFiles.get(path) : undefined;
    const preview = productionAsset || (enableLocalPreview ? previewFiles.get(path) : undefined);
    if (preview && ['GET', 'HEAD'].includes(request.method)) {
      try {
        const payload = await readFile(preview[0]);
        response.writeHead(200, {
          'Content-Type': preview[1],
          ...(productionAsset ? { 'Access-Control-Allow-Origin': '*' } : {}),
          'Content-Length': payload.length,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        response.end(request.method === 'HEAD' ? undefined : payload);
      } catch {
        response.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ error: 'preview_unavailable' }));
      }
      return;
    }

    if (!['/health', '/ready'].includes(path) && !preview) {
      statusCode = 404;
      body = { error: 'not_found' };
    } else if (!['GET', 'HEAD'].includes(request.method)) {
      statusCode = 405;
      response.setHeader('Allow', 'GET, HEAD');
      body = { error: 'method_not_allowed' };
    } else if (path === '/ready') {
      try {
        await checkDatabase();
        body = { service: 'die-interface', status: 'ready', database: 'ok' };
      } catch {
        statusCode = 503;
        body = { service: 'die-interface', status: 'not_ready', database: 'unavailable' };
      }
    }

    const payload = JSON.stringify(body);
    response.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : payload);
  });
}
