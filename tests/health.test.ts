import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import handler from '../backend/api/health.ts';

test('health returns service state and permits the production frontend', async () => {
  const result = handler.fetch(new Request('https://api.viagem.cyou/api/health', { headers: { origin: 'https://viagem.cyou' } }));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Access-Control-Allow-Origin'), 'https://viagem.cyou');
  assert.deepEqual(await result.json(), { status: 'ok', service: 'viagem-api' });
});
test('unexpected origins and write methods are rejected', () => {
  const denied = handler.fetch(new Request('https://api.viagem.cyou/api/health', { headers: { origin: 'https://example.org' } }));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal(handler.fetch(new Request('https://api.viagem.cyou/api/health', { method: 'POST' })).status, 405);
});
test('preflight succeeds and HEAD has no response body', async () => {
  const preflight = handler.fetch(new Request('https://api.viagem.cyou/api/health', { method: 'OPTIONS', headers: { origin: 'https://www.viagem.cyou' } }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://www.viagem.cyou');
  assert.equal(await handler.fetch(new Request('https://api.viagem.cyou/api/health', { method: 'HEAD' })).text(), '');
});
