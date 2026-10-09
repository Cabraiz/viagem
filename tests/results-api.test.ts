import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  handleResults, parseRunResult, signResult, verifySignature,
  MAX_BODY_BYTES, SIGNATURE_HEADER, TIMESTAMP_HEADER, type ResultsDatabase,
} from '../backend/lib/results.ts';

const SECRET = 'test-only-secret-for-results-api-0123456789';
const NOW = 1_790_000_000;
const URL_BASE = 'https://example.org/api/results';

/** Real SQLite in memory with every backend migration applied, behind the libsql execute() shape. */
function database() {
  const db = new DatabaseSync(':memory:');
  const folder = new URL('../backend/migrations/', import.meta.url);
  for (const name of readdirSync(folder).filter(f => /^\d{3}-.+\.sql$/.test(f)).sort()) db.exec(readFileSync(new URL(name, folder), 'utf8'));
  let calls = 0;
  const adapter: ResultsDatabase & { calls: () => number; raw: DatabaseSync } = {
    raw: db,
    calls: () => calls,
    async execute({ sql, args }) {
      calls++;
      const statement = db.prepare(sql);
      if (/^\s*select/i.test(sql)) return { rows: statement.all(...args) as Record<string, unknown>[], rowsAffected: 0 };
      return { rows: [], rowsAffected: Number(statement.run(...args).changes) };
    },
  };
  return adapter;
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    version: 1, runId: 'run_abc12345', victory: true, rounds: 10, durationSeconds: 612, seed: 1234,
    players: [{
      name: 'Tio do Pavê', classId: 'cidadao-comum',
      weapons: [{ id: 'chinelo', level: 8 }, { id: 'boleto-evo', level: 1 }], passives: [{ id: 'tenis', level: 5 }],
      awards: ['Rei do resgate', 'Build mais sem sentido'],
      stats: { damage: 12345, kills: 321, revives: 4, pickups: 88 },
    }],
    ...overrides,
  };
}

async function post(db: ResultsDatabase, body: string, init: { secret?: string; timestamp?: number; headers?: Record<string, string>; signWith?: string } = {}) {
  const timestamp = init.timestamp ?? NOW;
  const signed = await signResult(init.signWith ?? SECRET, body, timestamp);
  return handleResults(new Request(URL_BASE, { method: 'POST', body, headers: { ...signed, ...init.headers } }), {
    database: () => db, secret: 'secret' in init ? init.secret : SECRET, nowSeconds: () => NOW,
  });
}
const get = (db: ResultsDatabase, path: string, headers: Record<string, string> = {}, method = 'GET') =>
  handleResults(new Request(`https://example.org${path}`, { method, headers }), { database: () => db, secret: SECRET });

test('signed result is stored once; a retry is idempotent and a different payload conflicts', async () => {
  const db = database(), body = JSON.stringify(result());
  const first = await post(db, body);
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { status: 'created', runId: 'run_abc12345' });
  // Same content re-signed later (a retry after a timeout) is recognised, not duplicated.
  const retry = await post(db, JSON.stringify(result()), { timestamp: NOW + 30 });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).status, 'duplicate');
  const forged = await post(db, JSON.stringify(result({ victory: false })));
  assert.equal(forged.status, 409);
  const rows = db.raw.prepare('SELECT run_id, victory, rounds, player_count FROM run_results').all();
  assert.deepEqual(rows.map(r => ({ ...r })), [{ run_id: 'run_abc12345', victory: 1, rounds: 10, player_count: 1 }]);
});

test('concurrent retries of the same result store one row', async () => {
  const db = database(), body = JSON.stringify(result());
  const statuses = (await Promise.all([1, 2, 3, 4].map(() => post(db, body)))).map(r => r.status).sort();
  assert.deepEqual(statuses, [200, 200, 200, 201]);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM run_results').get()!.n, 1);
});

test('writes without the secret, with a bad signature, stale timestamp or from a browser are refused before the database', async () => {
  const db = database(), body = JSON.stringify(result());
  const cases: [Promise<Response>, number][] = [
    [post(db, body, { secret: undefined }), 503],
    [post(db, body, { secret: 'too-short' }), 503],
    [post(db, body, { signWith: 'another-secret-that-is-long-enough-0000' }), 401],
    [post(db, body, { timestamp: NOW - 301 }), 401],
    [post(db, body, { timestamp: NOW + 301 }), 401],
    [post(db, body, { headers: { [SIGNATURE_HEADER]: 'zz' } }), 401],
    [post(db, body, { headers: { [TIMESTAMP_HEADER]: '' } }), 401],
    [post(db, body, { headers: { origin: 'https://viagem.cyou' } }), 403],
    [post(db, body, { headers: { origin: 'https://evil.example' } }), 403],
  ];
  for (const [response, status] of cases) assert.equal((await response).status, status);
  // A valid signature over a tampered body fails too.
  const signed = await signResult(SECRET, body, NOW);
  const tampered = await handleResults(new Request(URL_BASE, { method: 'POST', body: body.replace('"victory":true', '"victory":false'), headers: signed }),
    { database: () => db, secret: SECRET, nowSeconds: () => NOW });
  assert.equal(tampered.status, 401);
  assert.equal(db.calls(), 0);
});

test('payloads with per-frame data, unknown keys or bad values are rejected', async () => {
  const db = database();
  const bad = [
    result({ positions: [{ x: 1, y: 2 }] }),
    result({ runId: 'short' }), result({ runId: '../../etc' }), result({ rounds: 11 }), result({ rounds: 2.5 }),
    result({ durationSeconds: -1 }), result({ version: 2 }), result({ victory: 'yes' }), result({ seed: -1 }),
    result({ players: [] }), result({ players: Array(7).fill(result().players[0]) }),
    result({ players: [{ ...result().players[0], x: 3 }] }),
    result({ players: [{ ...result().players[0], name: '' }] }),
    result({ players: [{ ...result().players[0], name: '\u202E\u0007' }] }),
    result({ players: [{ ...result().players[0], weapons: [{ id: 'chinelo', level: 9 }] }] }),
    result({ players: [{ ...result().players[0], stats: { damage: 1, kills: 1, revives: 1 } }] }),
  ];
  for (const payload of bad) assert.equal((await post(db, JSON.stringify(payload))).status, 400, JSON.stringify(payload).slice(0, 120));
  assert.equal((await post(db, '{not json')).status, 400);
  assert.equal((await post(db, ' '.repeat(MAX_BODY_BYTES + 1))).status, 413);
  assert.equal(db.raw.prepare('SELECT count(*) AS n FROM run_results').get()!.n, 0);
});

test('public read is lean, cacheable and CORS-limited; unknown or invalid ids are not found', async () => {
  const db = database();
  await post(db, JSON.stringify(result({ players: [{ ...result().players[0], name: '  Tio do Pavê  ' }] })));
  const response = await get(db, '/api/results/run_abc12345', { origin: 'https://viagem.cyou' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://viagem.cyou');
  assert.match(response.headers.get('Cache-Control')!, /public/);
  const body = await response.json();
  assert.equal(body.players[0].name, 'Tio do Pavê');
  assert.deepEqual(Object.keys(body).sort(), ['createdAt', 'durationSeconds', 'players', 'rounds', 'runId', 'seed', 'version', 'victory']);
  assert.equal((await get(db, '/api/results?runId=run_abc12345')).status, 200);
  assert.equal((await get(db, '/api/results/run_missing99')).status, 404);
  assert.equal((await get(db, '/api/results/bad')).status, 400);
  assert.equal((await get(db, '/api/results')).status, 400);
  assert.equal((await get(db, '/api/results/run_abc12345', { origin: 'https://evil.example' })).status, 403);
  const head = await get(db, '/api/results/run_abc12345', {}, 'HEAD');
  assert.equal(head.status, 200);assert.equal(await head.text(), '');
  const options = await get(db, '/api/results/run_abc12345', { origin: 'https://viagem.cyou' }, 'OPTIONS');
  assert.equal(options.status, 204);assert.doesNotMatch(options.headers.get('Access-Control-Allow-Methods')!, /POST/);
  assert.equal((await get(db, '/api/results/run_abc12345', {}, 'DELETE')).status, 405);
});

test('names the room may accept are cleaned, not rejected; the secret tolerates surrounding whitespace', async () => {
  const db = database();
  const named = result({ players: [{ ...result().players[0], name: 'Zé\u202E do\u0085 Coco', awards: ['Mais\u2066 caiu'] }] });
  const response = await post(db, JSON.stringify(named), { secret: `  ${SECRET}
`, signWith: `${SECRET}
` });
  assert.equal(response.status, 201);
  const body = await (await get(db, '/api/results/run_abc12345')).json();
  assert.equal(body.players[0].name, 'Zé do Coco');
  assert.deepEqual(body.players[0].awards, ['Mais caiu']);
});

test('migrations can be re-applied and writes only go to the collection path', async () => {
  const db = database();
  const folder = new URL('../backend/migrations/', import.meta.url);
  for (const name of readdirSync(folder).filter(f => /^\d{3}-.+\.sql$/.test(f)).sort()) db.raw.exec(readFileSync(new URL(name, folder), 'utf8'));
  assert.deepEqual(db.raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(r => r.version), [1, 2]);
  const body = JSON.stringify(result()), signed = await signResult(SECRET, body, NOW);
  const wrongPath = await handleResults(new Request(`${URL_BASE}/run_abc12345`, { method: 'POST', body, headers: signed }),
    { database: () => db, secret: SECRET, nowSeconds: () => NOW });
  assert.equal(wrongPath.status, 404);
  assert.equal(db.calls(), 0);
});

test('hardening: malformed ids, HEAD without body, conflicting ids, invisible names, broken bodies and rows', async () => {
  const db = database();
  await post(db, JSON.stringify(result()));
  for (const path of ['/api/results/%E0%A4%A', '/api/results/%', '/api/results/run_missing99?runId=run_abc12345']) {
    assert.equal((await get(db, path)).status, 400, path);
  }
  const malformedPost = await handleResults(new Request(`${URL_BASE}/%`, { method: 'POST', body: '{}' }), { database: () => db, secret: SECRET });
  assert.equal(malformedPost.status, 404);
  for (const path of ['/api/results/run_missing99', '/api/results/bad']) {
    const head = await get(db, path, {}, 'HEAD');
    assert.ok(head.status >= 400);assert.equal(await head.text(), '');
  }
  // Invisible-only names are rejected; invisible characters inside a name are stripped.
  const invisible = ['​‍', 'ㅤ', '⠀', '\u{E0041}', '\uD800'];
  for (const name of invisible) {
    assert.equal((await post(db, JSON.stringify(result({ runId: 'run_invisible', players: [{ ...result().players[0], name }] })))).status, 400, JSON.stringify(name));
  }
  assert.equal((await post(db, JSON.stringify(result({ runId: 'run_zwsp0001', players: [{ ...result().players[0], name: 'Ti​o ' }] })))).status, 201);
  assert.equal((await (await get(db, '/api/results/run_zwsp0001')).json()).players[0].name, 'Tio');
  // A body that fails mid-stream is a client error, with no internals in the response.
  const broken = new ReadableStream({ start(c) { c.error(new Error('conn reset at 10.0.0.5')); } });
  const aborted = await handleResults(new Request(URL_BASE, { method: 'POST', body: broken, duplex: 'half', headers: await signResult(SECRET, '', NOW) } as RequestInit),
    { database: () => db, secret: SECRET, nowSeconds: () => NOW });
  assert.equal(aborted.status, 400);assert.doesNotMatch(await aborted.text(), /10\.0\.0\.5/);
  // A corrupted stored row does not crash the read.
  db.raw.prepare("UPDATE run_results SET payload = '{oops' WHERE run_id = 'run_abc12345'").run();
  const corrupted = await get(db, '/api/results/run_abc12345');
  assert.equal(corrupted.status, 503);
});

test('database failures never leak internals', async () => {
  const broken: ResultsDatabase = { async execute() { throw new Error('secret-token at internal-host'); } };
  const write = await post(broken, JSON.stringify(result()));
  assert.equal(write.status, 503);
  assert.doesNotMatch(await write.text(), /secret-token|internal-host/);
  const read = await get(broken, '/api/results/run_abc12345');
  assert.equal(read.status, 503);
});

test('signature helpers round-trip and the parser canonicalises key order', async () => {
  const headers = await signResult(SECRET, 'x', NOW);
  assert.equal(await verifySignature(SECRET, 'x', headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], NOW), true);
  assert.equal(await verifySignature(SECRET, 'y', headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], NOW), false);
  const shuffled = JSON.parse(JSON.stringify(result()), (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v);
  assert.equal(JSON.stringify(parseRunResult(shuffled)), JSON.stringify(parseRunResult(result())));
});
