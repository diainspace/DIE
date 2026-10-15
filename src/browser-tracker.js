import { installClickTracker } from './tracker/click-listener.js';

// Relative to the module's gateway, never the page's hostname or a fixed server.
export async function startTracker({
  scriptUrl = import.meta.url,
  request = globalThis.fetch,
  install = installClickTracker,
} = {}) {
  const registryUrl = new URL('/api/domains', scriptUrl);
  const clickUrl = new URL('/api/click', scriptUrl);
  const response = await request(registryUrl, { mode: 'cors', credentials: 'omit' });
  if (!response.ok) throw new Error('Registry unavailable');
  const { domains } = await response.json();
  if (!Array.isArray(domains) || !domains.length ||
      !domains.every(domain => typeof domain === 'string' && domain.length > 0)) {
    throw new Error('Invalid registry');
  }
  return install({
    domains,
    onClick(event) {
      // Collection must never delay navigation or show diagnostics to visitors.
      void request(clickUrl, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        keepalive: true,
      }).catch(() => {});
    },
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  void startTracker().catch(() => {});
}
