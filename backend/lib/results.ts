/**
 * Run results (VGM-049A): written only by the room server, idempotent by runId, read publicly.
 * The room signs `${timestamp}.${body}` with HMAC-SHA256 using RESULTS_SECRET (server env only).
 * No per-frame data: only the summary the result screen needs.
 */

export const MAX_BODY_BYTES = 16384;
export const SIGNATURE_WINDOW_SECONDS = 300;
export const MIN_SECRET_LENGTH = 32;
export const TIMESTAMP_HEADER = 'x-viagem-timestamp';
export const SIGNATURE_HEADER = 'x-viagem-signature';

export type ResultItem = { id: string; level: number };
export type ResultPlayer = {
  name: string; classId: string; weapons: ResultItem[]; passives: ResultItem[]; awards: string[];
  stats: { damage: number; kills: number; revives: number; pickups: number };
};
export type RunResult = {
  version: 1; runId: string; victory: boolean; rounds: number; durationSeconds: number; seed?: number;
  players: ResultPlayer[];
};

/** Minimal slice of the libsql Client used here, so tests can run against node:sqlite. */
export type ResultsDatabase = {
  execute(statement: { sql: string; args: (string | number | null)[] }): Promise<{ rows: ArrayLike<Record<string, unknown>>; rowsAffected: number }>;
};

// ---------- Validation ----------
const RUN_ID = /^[A-Za-z0-9_-]{8,64}$/;
const ITEM_ID = /^[a-z0-9-]{1,32}$/;
const CLASS_ID = /^[a-z0-9-]{1,40}$/;
// Control, invisible, line-separator and bidi characters, Unicode tags and lone surrogates have no
// place in names or awards shown to other players. They are stripped, not rejected: the room accepts
// some of them in names, and one odd nickname must not lose the whole run's result.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0e\ufeff\uffa0\ufff9-\ufffb\u{e0000}-\u{e007f}\ud800-\udfff]/gu;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

type Check<T> = (value: unknown) => T | undefined;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, allowed: readonly string[]) => Object.keys(v).every(k => allowed.includes(k));
const int = (min: number, max: number): Check<number> => v => Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v as number : undefined;
const text = (min: number, max: number): Check<string> => v => {
  if (typeof v !== 'string') return undefined;
  const t = v.replace(UNSAFE_TEXT, '').normalize('NFC').trim();
  const length = [...t].length;
  return length >= min && length <= max && VISIBLE.test(t) ? t : undefined;
};
const list = <T>(item: Check<T>, max: number): Check<T[]> => v => {
  if (!Array.isArray(v) || v.length > max) return undefined;
  const out: T[] = [];
  for (const entry of v) { const parsed = item(entry); if (parsed === undefined) return undefined; out.push(parsed); }
  return out;
};
const item = (maxLevel: number): Check<ResultItem> => v => {
  if (!isRecord(v) || !onlyKeys(v, ['id', 'level'])) return undefined;
  const id = typeof v.id === 'string' && ITEM_ID.test(v.id) ? v.id : undefined, level = int(1, maxLevel)(v.level);
  return id === undefined || level === undefined ? undefined : { id, level };
};
const counter = int(0, 1_000_000_000);
const player: Check<ResultPlayer> = v => {
  if (!isRecord(v) || !onlyKeys(v, ['name', 'classId', 'weapons', 'passives', 'awards', 'stats'])) return undefined;
  const name = text(1, 40)(v.name);
  const classId = typeof v.classId === 'string' && CLASS_ID.test(v.classId) ? v.classId : undefined;
  const weapons = list(item(8), 6)(v.weapons), passives = list(item(8), 6)(v.passives);
  const awards = list(text(1, 60), 4)(v.awards ?? []);
  const s = v.stats;
  if (!isRecord(s) || !onlyKeys(s, ['damage', 'kills', 'revives', 'pickups'])) return undefined;
  const stats = { damage: counter(s.damage), kills: counter(s.kills), revives: counter(s.revives), pickups: counter(s.pickups) };
  if (name === undefined || classId === undefined || !weapons || !passives || !awards || Object.values(stats).some(n => n === undefined)) return undefined;
  return { name, classId, weapons, passives, awards, stats: stats as ResultPlayer['stats'] };
};

/** Strict parse: unknown keys, wrong types or out-of-range values reject the whole payload. */
export function parseRunResult(value: unknown): RunResult | undefined {
  if (!isRecord(value) || !onlyKeys(value, ['version', 'runId', 'victory', 'rounds', 'durationSeconds', 'seed', 'players'])) return undefined;
  if (value.version !== 1 || typeof value.victory !== 'boolean') return undefined;
  const runId = typeof value.runId === 'string' && RUN_ID.test(value.runId) ? value.runId : undefined;
  const rounds = int(0, 10)(value.rounds), durationSeconds = int(0, 7200)(value.durationSeconds);
  const seed = value.seed === undefined ? undefined : int(0, 0xffffffff)(value.seed);
  const players = list(player, 6)(value.players);
  if (runId === undefined || rounds === undefined || durationSeconds === undefined || !players || !players.length) return undefined;
  if (value.seed !== undefined && seed === undefined) return undefined;
  // Fixed key order makes the stored JSON canonical, so retries hash identically.
  return { version: 1, runId, victory: value.victory, rounds, durationSeconds, ...(seed === undefined ? {} : { seed }), players };
}

// ---------- Signing (Web Crypto: same code runs on Vercel and in the Cloudflare room) ----------
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
// Trimmed on both sides: a trailing newline from `wrangler secret put` or `vercel env add` must not break auth.
const hmacKey = (secret: string, usage: KeyUsage) =>
  crypto.subtle.importKey('raw', encoder.encode(secret.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);

/** For the room server: headers to send with a POST of `body`. */
export async function signResult(secret: string, body: string, timestamp: number) {
  const signature = hex(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(`${timestamp}.${body}`)));
  return { [TIMESTAMP_HEADER]: String(timestamp), [SIGNATURE_HEADER]: signature };
}

/** Constant-time check (subtle.verify) of the signature and a ±5 min timestamp window. */
export async function verifySignature(secret: string, body: string, timestampHeader: string | null, signatureHeader: string | null, nowSeconds: number) {
  if (!timestampHeader || !/^\d{1,12}$/.test(timestampHeader) || !signatureHeader || !/^[0-9a-f]{64}$/.test(signatureHeader)) return false;
  if (Math.abs(nowSeconds - Number(timestampHeader)) > SIGNATURE_WINDOW_SECONDS) return false;
  const signature = new Uint8Array(signatureHeader.match(/../g)!.map(h => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), signature, encoder.encode(`${timestampHeader}.${body}`));
}

// ---------- HTTP handler ----------
const allowedOrigins = new Set(['https://viagem.cyou', 'https://www.viagem.cyou']);

export type ResultsOptions = {
  database: () => ResultsDatabase;
  /** RESULTS_SECRET; missing or short means writes are refused. */
  secret: string | undefined;
  nowSeconds?: () => number;
};

const json = (status: number, body: unknown, headers: Headers) => {
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
};

/** null: no id given; false: malformed encoding, or path and query ids disagree. */
function runIdFrom(url: URL): string | null | false {
  const rawPath = /^\/api\/results\/([^/]+)$/.exec(url.pathname)?.[1];
  let fromPath: string | null = null;
  if (rawPath !== undefined) { try { fromPath = decodeURIComponent(rawPath); } catch { return false; } }
  const fromQuery = url.searchParams.get('runId');
  if (fromPath !== null && fromQuery !== null && fromPath !== fromQuery) return false;
  return fromQuery ?? fromPath;
}

async function sha256(textValue: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(textValue))); }

/** Reads at most `limit` bytes; null if the body is larger. Never buffers more than limit + one chunk. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  // ignoreBOM keeps the exact signed bytes: a BOM is part of the body, not stripped before verification.
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
}

/** Never throws: unexpected failures become a bare 500, and HEAD responses never carry a body. */
export async function handleResults(request: Request, options: ResultsOptions): Promise<Response> {
  let response: Response;
  try { response = await route(request, options); } catch {
    response = new Response(JSON.stringify({ error: 'internal' }), { status: 500, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } });
  }
  return request.method === 'HEAD' && response.body ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

async function route(request: Request, options: ResultsOptions): Promise<Response> {
  const origin = request.headers.get('origin');
  const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
  if (origin && !allowedOrigins.has(origin)) return new Response(null, { status: 403, headers });
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    return new Response(null, { status: 204, headers });
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    const runId = runIdFrom(url);
    if (typeof runId !== 'string' || !RUN_ID.test(runId)) return json(400, { error: 'invalid-run-id' }, headers);
    let stored: Record<string, unknown>, createdAt: string;
    try {
      const rows = (await options.database().execute({ sql: 'SELECT payload, created_at FROM run_results WHERE run_id = ?', args: [runId] })).rows;
      if (!rows.length) return json(404, { error: 'not-found' }, headers);
      stored = JSON.parse(String(rows[0].payload));
      createdAt = String(rows[0].created_at);
    } catch { return json(503, { error: 'unavailable' }, headers); }
    // A stored result never changes, so browsers and the CDN may keep it.
    headers.set('Cache-Control', 'public, max-age=300, s-maxage=86400');
    return json(200, { ...stored, createdAt }, headers);
  }

  if (request.method !== 'POST') {
    headers.set('Allow', 'GET, HEAD, POST, OPTIONS');
    return new Response(null, { status: 405, headers });
  }
  // Writes come from the room server, never from a browser.
  if (origin) return new Response(null, { status: 403, headers });
  if (runIdFrom(url) !== null) return json(404, { error: 'not-found' }, headers);
  const secret = options.secret?.trim();
  if (!secret || secret.length < MIN_SECRET_LENGTH) return json(503, { error: 'writes-disabled' }, headers);
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'too-large' }, headers);
  let body: string | null;
  try { body = await readCapped(request, MAX_BODY_BYTES); } catch { return json(400, { error: 'unreadable-body' }, headers); }
  if (body === null) return json(413, { error: 'too-large' }, headers);
  const now = (options.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
  if (!await verifySignature(secret, body, request.headers.get(TIMESTAMP_HEADER), request.headers.get(SIGNATURE_HEADER), now)) {
    return json(401, { error: 'unauthorized' }, headers);
  }
  let parsed: RunResult | undefined;
  try { parsed = parseRunResult(JSON.parse(body)); } catch { parsed = undefined; }
  if (!parsed) return json(400, { error: 'invalid-result' }, headers);

  const payload = JSON.stringify(parsed), hash = await sha256(payload);
  try {
    const db = options.database();
    const inserted = await db.execute({
      sql: 'INSERT INTO run_results (run_id, victory, rounds, duration_seconds, player_count, payload, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id) DO NOTHING',
      args: [parsed.runId, parsed.victory ? 1 : 0, parsed.rounds, parsed.durationSeconds, parsed.players.length, payload, hash],
    });
    if (inserted.rowsAffected === 1) return json(201, { status: 'created', runId: parsed.runId }, headers);
    const existing = await db.execute({ sql: 'SELECT payload_hash FROM run_results WHERE run_id = ?', args: [parsed.runId] });
    if (existing.rows.length && String(existing.rows[0].payload_hash) === hash) return json(200, { status: 'duplicate', runId: parsed.runId }, headers);
    return json(409, { error: 'conflict', runId: parsed.runId }, headers);
  } catch { return json(503, { error: 'unavailable' }, headers); }
}
