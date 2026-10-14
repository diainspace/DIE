import pg from 'pg';

export function createDatabase(connectionString) {
  if (!connectionString) throw new Error('DIE_DATABASE_URL is required.');
  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 10000,
    statement_timeout: 2000,
    query_timeout: 2500,
    application_name: 'die-interface',
  });
  // Do not log driver errors: they can contain connection details.
  pool.on('error', () => console.error('DIE database connection interrupted.'));
  return {
    async check() { await pool.query('SELECT 1'); },
    async close() { await pool.end(); },
  };
}
