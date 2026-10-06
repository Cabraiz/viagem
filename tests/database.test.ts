import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { databaseConfig } from '../backend/lib/database.ts';
import { readiness } from '../backend/api/ready.ts';

test('database rejects missing credentials and insecure transport', () => {
  assert.throws(() => databaseConfig({}));
  for (const url of ['file:local.db', 'http://example.org', 'https://user:pass@example.org']) {
    assert.throws(() => databaseConfig({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: 'test' }));
  }
  assert.deepEqual(databaseConfig({ TURSO_DATABASE_URL: 'libsql://test.turso.io', TURSO_AUTH_TOKEN: 'test' }),
    { url: 'libsql://test.turso.io', authToken: 'test' });
});

test('readiness checks storage and never exposes internal errors or credentials', async () => {
  const request = new Request('https://example.org/api/ready', { headers: { origin: 'https://viagem.cyou' } });
  let calls = 0;
  const ok = await readiness(request, async () => { calls++; });
  assert.equal(ok.status, 200);
  assert.equal(calls, 1);
  assert.equal((await ok.json()).database, 'ready');
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://viagem.cyou');
  const failed = await readiness(request, async () => { throw Error('secret-token-and-internal-host'); });
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /secret-token|internal-host/);
});

test('rejected requests and preflight do not query the database; HEAD has no body', async () => {
  let calls = 0;
  const check = async () => { calls++; };
  for (const [init, expected] of [
    [{ headers: { origin: 'https://untrusted.example' } }, 403],
    [{ method: 'POST' }, 405],
    [{ method: 'OPTIONS' }, 204],
  ] as const) {
    const response = await readiness(new Request('https://example.org/api/ready', init), check);
    assert.equal(response.status, expected);
  }
  assert.equal(calls, 0);
  const head = await readiness(new Request('https://example.org/api/ready', { method: 'HEAD' }), check);
  assert.equal(calls, 1);
  assert.equal(await head.text(), '');
});
