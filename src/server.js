import { createApp } from './app.js';
import { createDatabase } from './database.js';
import { createIngestion } from './ingestion.js';

const host = '127.0.0.1';
const port = 3002;
let database;
try {
  database = createDatabase(process.env.DIE_DATABASE_URL);
} catch {
  console.error('DIE_DATABASE_URL must be configured in the private environment.');
  process.exit(1);
}
const isDevelopment = process.env.NODE_ENV === 'development';
const registryFile = process.env.DIE_DOMAIN_REGISTRY_FILE?.trim() ||
  (isDevelopment ? new URL('../config/domains.local.json', import.meta.url) : undefined);
const ingestion = registryFile ? createIngestion({ registryFile }) : undefined;
const server = createApp({
  ingestion,
  enableTracker: Boolean(ingestion),
  checkDatabase: () => database.check(),
  enableLocalPreview: isDevelopment,
});

server.on('error', async error => {
  console.error(`DIE could not start (${error.code ?? 'unknown error'}).`);
  process.exitCode = 1;
  await database.close();
});

server.listen(port, host, () => {
  console.log(`DIE interface ready at http://${host}:${port}/health`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(async () => { await database.close(); });
    server.closeIdleConnections();
  });
}
