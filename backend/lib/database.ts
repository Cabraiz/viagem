import { createClient, type Client } from '@libsql/client/web';

export type DatabaseEnvironment = {
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
};

export function databaseConfig(env: DatabaseEnvironment) {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) throw new Error('Database configuration is missing');
  const parsed = new URL(url);
  if (!['libsql:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Database requires an authenticated TLS connection');
  }
  return { url, authToken };
}

let client: Client | undefined;
export function getDatabase(): Client {
  return client ??= createClient(databaseConfig(process.env));
}
