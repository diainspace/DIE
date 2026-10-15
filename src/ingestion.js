import { readDomainRegistry } from './domain-registry.js';
import { sendClick } from './send-click.js';

export class IngestionError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

// A conservative local-development limit; production limits remain a deployment decision.
const MAX_BODY_BYTES = 16 * 1024;

export async function readClickBody(request) {
  const type = request.headers['content-type']?.split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    request.resume();
    throw new IngestionError(415, 'json_required');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new IngestionError(413, 'payload_too_large');
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new IngestionError(400, 'invalid_json');
  }
}

export function createIngestion({ registryFile, forwardClick = sendClick }) {
  async function domains() {
    try {
      return await readDomainRegistry(registryFile);
    } catch {
      throw new IngestionError(503, 'registry_unavailable');
    }
  }

  async function ingest(click, userAgent) {
    if (!click || typeof click !== 'object' || Array.isArray(click) ||
        click.event !== 'click' ||
        !['url', 'origin', 'path', 'dest'].every(key => typeof click[key] === 'string') ||
        !Object.values(click).every(value => value === null ||
          ['string', 'boolean'].includes(typeof value) ||
          (typeof value === 'number' && Number.isFinite(value))) || !userAgent) {
      throw new IngestionError(400, 'invalid_click');
    }
    let page;
    try {
      page = new URL(click.url);
      new URL(click.dest);
    } catch {
      throw new IngestionError(400, 'invalid_url');
    }
    if (!['http:', 'https:'].includes(page.protocol) || page.username || page.password ||
        page.hostname !== click.origin || page.pathname !== click.path) {
      throw new IngestionError(400, 'inconsistent_page');
    }
    const registry = await domains();
    if (!registry.has(page.hostname)) {
      throw new IngestionError(403, 'unregistered_property');
    }
    try {
      await forwardClick(click, registry, userAgent);
    } catch {
      // No API keys, upstream response bodies, or connection strings in browser errors.
      throw new IngestionError(502, 'umami_unavailable');
    }
    return { accepted: true };
  }

  return { domains, ingest };
}
