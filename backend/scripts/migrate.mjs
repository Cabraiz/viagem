import { readdir, readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client/web';
import { databaseConfig } from '../lib/database.ts';

const client = createClient(databaseConfig(process.env));
try {
  const folder = new URL('../migrations/', import.meta.url);
  // Applied in name order; each file is idempotent and runs in its own transaction.
  for (const name of (await readdir(folder)).filter(file => /^\d{3}-.+\.sql$/.test(file)).sort()) {
    const sql = await readFile(new URL(name, folder), 'utf8');
    // Statements in these migrations do not contain semicolons inside strings.
    const statements = sql.split(';').map(statement => statement.trim()).filter(Boolean);
    await client.batch(statements, 'write');
  }
  const result = await client.execute('SELECT version FROM schema_migrations ORDER BY version');
  console.log(JSON.stringify({ status: 'ok', versions: result.rows.map(row => row.version) }));
} catch {
  console.error('Database migration failed. Check credentials, connectivity, and schema. Secrets were not logged.');
  process.exitCode = 1;
} finally { client.close(); }
