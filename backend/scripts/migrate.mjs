import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client/web';
import { databaseConfig } from '../lib/database.ts';

const client = createClient(databaseConfig(process.env));
try {
  const sql = await readFile(new URL('../migrations/001-initial.sql', import.meta.url), 'utf8');
  // Statements in this migration do not contain semicolons inside strings.
  const statements = sql.split(';').map(statement => statement.trim()).filter(Boolean);
  await client.batch(statements, 'write');
  const result = await client.execute('SELECT version FROM schema_migrations ORDER BY version');
  console.log(JSON.stringify({ status: 'ok', versions: result.rows.map(row => row.version) }));
} catch {
  console.error('Database migration failed. Check credentials, connectivity, and schema. Secrets were not logged.');
  process.exitCode = 1;
} finally { client.close(); }
