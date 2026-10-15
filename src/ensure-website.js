import { umamiRequest } from './umami-api.js';

const pending = new Map();

async function findOrCreate(domain) {
  for (let page = 1; ; page++) {
    const query = new URLSearchParams({
      search: domain,
      page: String(page),
      pageSize: '100'
    });

    const result = await umamiRequest(`/api/websites?${query}`);

    if (
      !Array.isArray(result.data) ||
      !Number.isInteger(result.count) ||
      !Number.isInteger(result.pageSize) ||
      result.pageSize < 1
    ) {
      throw new Error('Unexpected Umami website-list response');
    }

    const existing = result.data.find(
      website => website.domain?.toLowerCase() === domain
    );

    if (existing) return existing;

    if (page * result.pageSize >= result.count) break;
  }

  return umamiRequest('/api/websites', {
    method: 'POST',
    body: { name: domain, domain }
  });
}

export async function ensureWebsite(hostname, registry) {
  const domain = hostname.trim().toLowerCase();

  if (!registry.has(domain)) {
    throw new Error('Property is not in the domain registry');
  }

  if (pending.has(domain)) return pending.get(domain);

  const operation = findOrCreate(domain);
  pending.set(domain, operation);

  try {
    return await operation;
  } finally {
    pending.delete(domain);
  }
}
