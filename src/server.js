import { createApp } from './app.js';
import { createDatabase } from './database.js';

const host = '127.0.0.1';
const port = 3002;
let database;
try {
  database = createDatabase(process.env.DIE_DATABASE_URL);
} catch {
  console.error('DIE_DATABASE_URL must be configured in the private environment.');
  process.exit(1);
}
const server = createApp({
  checkDatabase: () => database.check(),
  enableLocalPreview: process.env.NODE_ENV === 'development',
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
