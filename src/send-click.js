import { ensureWebsite } from './ensure-website.js';
import { umamiRequest } from './umami-api.js';

export async function sendClick(click, registry, userAgent) {
  const page = new URL(click.url);

  if (
    click.event !== 'click' ||
    !['http:', 'https:'].includes(page.protocol) ||
    page.hostname !== click.origin ||
    !registry.has(page.hostname)
  ) {
    throw new Error('Invalid or unregistered click origin');
  }

  if (!userAgent) {
    throw new Error('Browser user agent is required');
  }

  const website = await ensureWebsite(page.hostname, registry);

  const data = Object.fromEntries(
    Object.entries(click).filter(
      ([key, value]) =>
        !['event', 'url'].includes(key) && value != null
    )
  );

  const result = await umamiRequest('/api/send', {
    method: 'POST',
    body: {
      type: 'event',
      payload: {
        website: website.id,
        hostname: page.hostname,
        url: page.href,
        name: 'click',
        userAgent,
        data
      }
    }
  });

  if (!result.sessionId || !result.visitId) {
    throw new Error('Umami did not confirm event collection');
  }

  return { accepted: true };
}
