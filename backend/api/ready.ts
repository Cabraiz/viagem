import { getDatabase } from '../lib/database.ts';

const allowedOrigins = new Set(['https://viagem.cyou', 'https://www.viagem.cyou']);

export async function readiness(request: Request, check: () => Promise<unknown>): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403, headers });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    return new Response(null, { status: 204, headers });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD, OPTIONS');
    return new Response(null, { status: 405, headers });
  }
  let status = 200;
  try { await check(); } catch { status = 503; }
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(request.method === 'HEAD' ? null : JSON.stringify({
    status: status === 200 ? 'ok' : 'unavailable', service: 'viagem-api',
    database: status === 200 ? 'ready' : 'unavailable',
  }), { status, headers });
}

export default {
  fetch(request: Request) {
    return readiness(request, async () => {
      const result = await getDatabase().execute({
        sql: 'SELECT version FROM schema_migrations WHERE version = ?', args: [1],
      });
      if (result.rows.length !== 1) throw new Error('Schema not initialized');
    });
  },
};
