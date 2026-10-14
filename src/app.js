import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const previewFiles = new Map([
  ['/test-clicks', [new URL('../public/test-clicks.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/tracker/click-listener.js', [new URL('./tracker/click-listener.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/tracker/classify-link.js', [new URL('./tracker/classify-link.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/tracker/infer-place.js', [new URL('./tracker/infer-place.js', import.meta.url), 'text/javascript; charset=utf-8',]],
]); 

// Liveness is independent of database readiness.
export function createApp({ enableLocalPreview = false, checkDatabase = async () => { throw new Error('Not configured'); } } = {}) {
  return createServer(async (request, response) => {
    const path = request.url?.split('?')[0];
    let statusCode = 200;
    let body = { service: 'die-interface', status: 'ok' };

    const preview = enableLocalPreview ? previewFiles.get(path) : undefined;
    if (preview && ['GET', 'HEAD'].includes(request.method)) {
      try {
        const payload = await readFile(preview[0]);
        response.writeHead(200, {
          'Content-Type': preview[1],
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
