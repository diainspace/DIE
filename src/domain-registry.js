import { readFile } from 'node:fs/promises';

export async function readDomainRegistry(file) {
  const registry = JSON.parse(await readFile(file, 'utf8'));

  if (
    !Array.isArray(registry.domains) ||
    !registry.domains.every(domain =>
      typeof domain === 'string' && domain.trim().length > 0
    )
  ) {
    throw new Error('Invalid domain registry');
  }

  return new Set(
    registry.domains.map(domain => domain.trim().toLowerCase())
  );
}
