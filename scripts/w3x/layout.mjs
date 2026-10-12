// Turns a ParsedMap (Warcraft III world units, see formats.mjs) into our own "viagem-map" CityAsset.
// Only the LAYOUT is kept (D-026): heights, walkability, solid areas, generic props, points and loot spots.
// No source names, ids, model names, rect names or texts are written into the asset.
//
// Our units: 1 cell = 0.88 u, so k = 0.88 / 128 = 0.006875 per WC3 unit.
//   X = (wx - offsetX) * k,  Y = (offsetY + (h - 1) * 128 - wy) * k   (origin NW corner, x east, y SOUTH)
// Every grid in the asset is stored with row 0 = NORTH (WC3 files store row 0 = south).
// Deterministic: no clocks, no randomness, stable orderings, emitted floats rounded to 3 decimals.
import { deflateSync } from 'node:zlib';

export const PER_CELL = 0.88;
export const WC3_CELL = 128;
export const K = PER_CELL / WC3_CELL; // 0.006875 our units per WC3 unit
export const CLASS = Object.freeze({ WALK: 0, BLOCK: 1, SHALLOW: 2, DEEP: 3 });
export const CLASS_NAMES = Object.freeze({ 0: 'walk', 1: 'block', 2: 'shallow', 3: 'deep' });
export const HEIGHT_SCALE = 0.001; // heights are stored as round(z / 0.001) in int16

export const isWalkableClass = (c) => c === CLASS.WALK || c === CLASS.SHALLOW;

/** Rounds to 3 decimals and never returns -0 (keeps the JSON byte-identical between runs). */
export function r3(v) {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
}

// ---------------------------------------------------------------------------------------------
// Coordinate transforms
// ---------------------------------------------------------------------------------------------

/**
 * World <-> our units for a terrain (offsetX/offsetY = SW corner, h corners tall).
 * Pixel helpers use the pathing grid (default 32 WC3 units per pixel) in asset orientation (row 0 = north).
 */
export function makeTransform(terrain, pathingPixel = 32) {
  const cs = terrain.cellSize ?? WC3_CELL;
  const ox = terrain.offsetX;
  const topY = terrain.offsetY + (terrain.h - 1) * cs;
  const pxRows = Math.round(((terrain.h - 1) * cs) / pathingPixel);
  const step = pathingPixel * K;
  return {
    k: K,
    step,
    toX: (wx) => (wx - ox) * K,
    toY: (wy) => (topY - wy) * K,
    toWorldX: (X) => X / K + ox,
    toWorldY: (Y) => topY - Y / K,
    /** World point -> pathing pixel (col, row) in asset orientation (row 0 = north). */
    worldToPixel: (wx, wy) => ({
      c: Math.floor((wx - ox) / pathingPixel),
      r: pxRows - 1 - Math.floor((wy - terrain.offsetY) / pathingPixel),
    }),
    /** Pathing pixel centre -> our units. */
    pixelToUnits: (c, r) => ({ x: (c + 0.5) * step, y: (r + 0.5) * step }),
    /** Our units -> pathing pixel. */
    unitsToPixel: (x, y) => ({ c: Math.floor(x / step), r: Math.floor(y / step) }),
  };
}

// ---------------------------------------------------------------------------------------------
// Encodings (also used by tests to decode the asset)
// ---------------------------------------------------------------------------------------------

/** RLE: pairs (value u8, run length as LEB128 varint). Runs may cross row boundaries. */
export function rleEncode(bytes) {
  const out = [];
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const v = bytes[i];
    let j = i + 1;
    while (j < n && bytes[j] === v) j++;
    out.push(v);
    let run = j - i;
    do {
      let b = run & 0x7f;
      run = Math.floor(run / 128);
      if (run) b |= 0x80;
      out.push(b);
    } while (run);
    i = j;
  }
  return Uint8Array.from(out);
}

export function rleDecode(buf, expectedLength) {
  const parts = [];
  let total = 0;
  let p = 0;
  while (p < buf.length) {
    const v = buf[p++];
    let run = 0;
    let mul = 1;
    for (;;) {
      if (p >= buf.length) throw new Error('rle: truncated varint');
      const b = buf[p++];
      run += (b & 0x7f) * mul;
      mul *= 128;
      if (!(b & 0x80)) break;
    }
    parts.push(v, run);
    total += run;
  }
  if (expectedLength != null && total !== expectedLength) throw new Error(`rle: decoded ${total} bytes, expected ${expectedLength}`);
  const out = new Uint8Array(total);
  let o = 0;
  for (let q = 0; q < parts.length; q += 2) {
    out.fill(parts[q], o, o + parts[q + 1]);
    o += parts[q + 1];
  }
  return out;
}

export const encodeRleBase64 = (bytes) => Buffer.from(rleEncode(bytes)).toString('base64');
export const decodeRleBase64 = (b64, expectedLength) => rleDecode(Buffer.from(b64, 'base64'), expectedLength);

export function encodeI16Base64(values) {
  const b = Buffer.alloc(values.length * 2);
  for (let i = 0; i < values.length; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(values[i]))), i * 2);
  return b.toString('base64');
}

export function decodeI16Base64(b64) {
  const b = Buffer.from(b64, 'base64');
  const out = new Int16Array(b.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = b.readInt16LE(i * 2);
  return out;
}

/** Decodes the asset's pathing grid (Uint8Array, row 0 = north) and corner heights (Float32Array, our units). */
export function decodeAssetGrids(asset) {
  const pathing = decodeRleBase64(asset.pathing.data, asset.pathing.w * asset.pathing.h);
  const raw = decodeI16Base64(asset.heights.data);
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] * asset.heights.scale;
  return { pathing, heights };
}

// ---------------------------------------------------------------------------------------------
// PNG (truecolour + alpha, no dependencies)
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encodes RGBA pixels (Uint8Array/Buffer, width*height*4) as a PNG Buffer. */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: rgba length mismatch');
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Grid algorithms
// ---------------------------------------------------------------------------------------------

function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--;
      else break;
    }
    if (s <= z[k]) { // k === 0 and still dominated: replace
      v[0] = q;
      z[0] = -Infinity;
      z[1] = Infinity;
      continue;
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}

/** Exact Euclidean distance (in pixels) from every pixel to the nearest pixel where source[i] != 0. */
export function distanceTransform(source, w, h) {
  const BIG = 1e12;
  const m = Math.max(w, h);
  const f = new Float64Array(m), d = new Float64Array(m), z = new Float64Array(m + 1);
  const v = new Int32Array(m);
  const g = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = source[y * w + x] ? 0 : BIG;
    dt1d(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    dt1d(f, w, d, v, z);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}

/**
 * 4-neighbour connected components of mask (labels in row-major discovery order, -1 = not in mask).
 * Non-zero mask values are groups: neighbours join only when their values are equal.
 */
export function labelComponents(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const sizes = [];
  let count = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || labels[i] !== -1) continue;
    let sp = 0;
    stack[sp++] = i;
    labels[i] = count;
    let n = 0;
    while (sp) {
      const p = stack[--sp];
      n++;
      const x = p % w, y = (p - x) / w;
      if (x > 0 && mask[p - 1] === mask[p] && labels[p - 1] === -1) { labels[p - 1] = count; stack[sp++] = p - 1; }
      if (x < w - 1 && mask[p + 1] === mask[p] && labels[p + 1] === -1) { labels[p + 1] = count; stack[sp++] = p + 1; }
      if (y > 0 && mask[p - w] === mask[p] && labels[p - w] === -1) { labels[p - w] = count; stack[sp++] = p - w; }
      if (y < h - 1 && mask[p + w] === mask[p] && labels[p + w] === -1) { labels[p + w] = count; stack[sp++] = p + w; }
    }
    sizes.push(n);
    count++;
  }
  return { labels, count, sizes };
}

/**
 * Geodesic distance (pixels) over passable pixels from a source pixel: 8-neighbour moves (cost 1 / sqrt 2)
 * without cutting corners, so connectivity equals plain 4-neighbour BFS. Unreachable = Infinity.
 * maxDist stops the search early (pixels beyond it may stay Infinity or hold an upper bound).
 */
export function geodesic(passable, w, h, src, maxDist = Infinity) {
  const dist = new Float64Array(w * h).fill(Infinity);
  if (!passable[src]) return dist;
  // binary heap of (dist, index), lazy deletion
  let hd = new Float64Array(1 << 16), hi = new Int32Array(1 << 16), hn = 0;
  const push = (dv, iv) => {
    if (hn === hd.length) {
      const nd = new Float64Array(hn * 2); nd.set(hd); hd = nd;
      const ni = new Int32Array(hn * 2); ni.set(hi); hi = ni;
    }
    let c = hn++;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (hd[p] < dv || (hd[p] === dv && hi[p] <= iv)) break;
      hd[c] = hd[p]; hi[c] = hi[p]; c = p;
    }
    hd[c] = dv; hi[c] = iv;
  };
  const pop = () => {
    const iv = hi[0];
    const ld = hd[--hn], li = hi[hn];
    let c = 0;
    for (;;) {
      let s = 2 * c + 1;
      if (s >= hn) break;
      if (s + 1 < hn && (hd[s + 1] < hd[s] || (hd[s + 1] === hd[s] && hi[s + 1] < hi[s]))) s++;
      if (ld < hd[s] || (ld === hd[s] && li <= hi[s])) break;
      hd[c] = hd[s]; hi[c] = hi[s]; c = s;
    }
    hd[c] = ld; hi[c] = li;
    return iv;
  };
  const SQ2 = Math.SQRT2;
  dist[src] = 0;
  push(0, src);
  while (hn) {
    const dv = hd[0];
    const p = pop();
    if (dv > dist[p]) continue;
    if (dv > maxDist) break;
    const x = p % w, y = (p - x) / w;
    const L = x > 0 && passable[p - 1], R = x < w - 1 && passable[p + 1];
    const U = y > 0 && passable[p - w], D = y < h - 1 && passable[p + w];
    const relax = (q, cost) => {
      const nd = dv + cost;
      if (nd < dist[q]) { dist[q] = nd; push(nd, q); }
    };
    if (L) relax(p - 1, 1);
    if (R) relax(p + 1, 1);
    if (U) relax(p - w, 1);
    if (D) relax(p + w, 1);
    if (U && L && passable[p - w - 1]) relax(p - w - 1, SQ2);
    if (U && R && passable[p - w + 1]) relax(p - w + 1, SQ2);
    if (D && L && passable[p + w - 1]) relax(p + w - 1, SQ2);
    if (D && R && passable[p + w + 1]) relax(p + w + 1, SQ2);
  }
  return dist;
}

/** Nearest pixel (Euclidean, ties: smaller row then column) satisfying ok(i), searching up to maxR pixels. */
function nearestPixel(w, h, c0, r0, ok, maxR = 256) {
  let best = -1, bestD = Infinity;
  for (let rad = 0; rad <= maxR; rad++) {
    if (best >= 0 && (rad - 1) * (rad - 1) > bestD) break;
    for (let r = r0 - rad; r <= r0 + rad; r++) {
      if (r < 0 || r >= h) continue;
      const edge = r === r0 - rad || r === r0 + rad;
      for (let c = c0 - rad; c <= c0 + rad; c += edge ? 1 : 2 * rad || 1) {
        if (c < 0 || c >= w) continue;
        const i = r * w + c;
        if (!ok(i)) continue;
        const d2 = (c - c0) * (c - c0) + (r - r0) * (r - r0);
        if (d2 < bestD || (d2 === bestD && i < best)) { bestD = d2; best = i; }
      }
    }
  }
  return best;
}

/** Splits the pixels of one component (label === id) inside bbox into rectangles by merging identical row runs. */
function componentRects(labels, w, id, x0, y0, x1, y1) {
  const rects = [];
  let open = new Map(); // "a,b" -> rect [x, y, w, h]
  for (let y = y0; y <= y1 + 1; y++) {
    const next = new Map();
    if (y <= y1) {
      let x = x0;
      while (x <= x1) {
        if (labels[y * w + x] !== id) { x++; continue; }
        let e = x;
        while (e + 1 <= x1 && labels[y * w + e + 1] === id) e++;
        const key = x + ',' + e;
        const prev = open.get(key);
        if (prev) { prev[3]++; next.set(key, prev); open.delete(key); }
        else next.set(key, [x, y, e - x + 1, 1]);
        x = e + 1;
      }
    }
    for (const r of open.values()) rects.push(r);
    open = next;
  }
  rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return rects;
}

// ---------------------------------------------------------------------------------------------
// Doodad / destructable classification (source ids stay in this code and the report only)
// ---------------------------------------------------------------------------------------------

/**
 * Generic kind from the 4-char id. Convention of the source editor: 2nd char 'T' = destructable family
 * (trees, gates, walls, pathing blockers 'YT..'), otherwise doodad category letter
 * (R rocks/rubble, S structures, C cliff/terrain pieces, P props, O environment, W water).
 */
export function classifyType(id) {
  if (/^YT[a]/.test(id)) return { kind: 'blocker', blocker: 'air' };
  if (/^YT[pfl]/.test(id)) return { kind: 'blocker', blocker: 'ground' };
  if (/^.O(fo|fn)/.test(id)) return { kind: 'fountain' };
  const cat = id[1];
  if (cat === 'T') {
    if (/^.T(t.|lt)/.test(id)) return { kind: 'tree' };
    if (/^.T(w|g|d)/.test(id)) return { kind: 'ruin', shape: 'wall' }; // walls / gates / doors
    return { kind: 'rock' };
  }
  if (cat === 'R') return { kind: 'rock' };
  if (cat === 'S' || cat === 'C') return { kind: 'ruin' };
  if (cat === 'W') return { kind: 'water' };
  return { kind: 'prop' };
}

// Base radius in WC3 units (multiplied by the instance's max(sx, sy) scale) for the emitted prop radius.
const PROP_BASE_R = { tree: 64, rock: 48, ruin: 80, prop: 40, fountain: 160, wreck: 96, water: 64, blocker: 32 };
// Footprints rasterized for NON-baked solid destructables (WC3 units). Pathing blockers use their texture size
// (the map lays them in chains 64 apart => 64x64); the rest use a disc of PROP_BASE_R * scale clamped to
// [RASTER_MIN_R, RASTER_MAX_R], and wall-like pieces an oriented 256*scale x 64 bar across their facing.
const BLOCKER_SIZE_SMALL = 64, BLOCKER_SIZE_LARGE = 128;
const RASTER_MIN_R = 32, RASTER_MAX_R = 128;
// Source scales are untrusted: clamp so a hostile .doo cannot blow up raster loops.
const SCALE_MIN = 0.1, SCALE_MAX = 4;
const clampScale = (sc) => { const s = Math.max(sc[0], sc[1]); return Number.isFinite(s) ? Math.min(SCALE_MAX, Math.max(SCALE_MIN, s)) : 1; };
// Script-created doors: the doorway gap is found by marching from the door centre; wider gaps are left open.
const DOOR_MAX_GAP_PX = 24, DOOR_THICK_PX = 4;
const BAKED_THRESHOLD = 0.75; // a type counts as "baked into wpm" if >= 75% of its instances sit on unwalkable pixels

// ---------------------------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------------------------

const DEFAULT_ROLES = { praca: 'rect10', spawnN: 'rect19', spawnS: 'rect12', spawnL: 'rect15', spawnO: 'rect13' };

function getRect(rects, name) {
  return rects[name] ?? rects['udg_' + name] ?? null;
}

/**
 * Full analysis: returns { asset, report, debug }. `report` may mention source ids (it is NOT the asset);
 * `debug` holds typed arrays for preview images.
 * opts: roles (rect names per point), lootCount (48), lootSpacing (8 u), lootClear (6 u),
 *       streetRadius (7 px), throatMax (24 px), mouthSearch (120 px).
 */
export function analyzeCity(parsed, opts = {}) {
  const T = parsed.terrain, P = parsed.pathing;
  const W = P.w, H = P.h, pixel = P.pixel ?? 32;
  const tf = makeTransform(T, pixel);
  const step = tf.step; // 0.22 u per pathing pixel
  const cellPx = Math.round((T.cellSize ?? WC3_CELL) / pixel); // 4
  const roles = { ...DEFAULT_ROLES, ...(opts.roles ?? {}) };
  const report = { pathing: {}, doodadTypes: {}, blocks: {}, points: {}, paths: {}, loot: {}, warnings: [] };

  // 1. pathing classes from wpm (flipped to row 0 = north)
  const grid = new Uint8Array(W * H);
  const rawBlocked = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) {
    const src = (H - 1 - r) * W;
    for (let c = 0; c < W; c++) {
      const v = P.data[src + c];
      const nowalk = (v & 0x02) !== 0, water = (v & 0x40) === 0;
      grid[r * W + c] = nowalk ? (water ? CLASS.DEEP : CLASS.BLOCK) : (water ? CLASS.SHALLOW : CLASS.WALK);
      rawBlocked[r * W + c] = nowalk ? 1 : 0;
    }
  }

  // 2. outside the playable area => block
  const [ml, mr, mb, mt] = parsed.info?.margins ?? [0, 0, 0, 0];
  const pl = ml * cellPx, pr = W - mr * cellPx, pt = mt * cellPx, pb = H - mb * cellPx; // [pl,pr) x [pt,pb)
  let forced = 0;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (c >= pl && c < pr && r >= pt && r < pb) continue;
      const i = r * W + c;
      if (grid[i] !== CLASS.BLOCK) { grid[i] = CLASS.BLOCK; forced++; }
    }
  }
  report.pathing.forcedOutsidePlayable = forced;

  // 3. doodads: per-type statistics ("baked" = instance centre already unwalkable in the raw wpm)
  const inst = parsed.doodads.map((d, idx) => {
    const { c, r } = tf.worldToPixel(d.x, d.y);
    const inside = c >= 0 && c < W && r >= 0 && r < H;
    const cls = classifyType(d.id);
    // doodads are stored with life = -1 (255); destructables carry a life percentage
    const destructable = d.life !== 255 && d.life !== -1;
    return { d, idx, c, r, inside, ...cls, destructable, baked: inside ? rawBlocked[r * W + c] === 1 : false };
  });
  const types = new Map();
  for (const it of inst) {
    let t = types.get(it.d.id);
    if (!t) { t = { n: 0, baked: 0, destructable: 0, dead: 0, kind: it.kind }; types.set(it.d.id, t); }
    t.n++;
    if (it.baked) t.baked++;
    if (it.destructable) t.destructable++;
    if (it.destructable && it.d.life === 0) t.dead++;
  }

  // 4. rasterize NON-baked solid destructables into the block class
  const rasterCount = new Map();
  const setBlock = (c, r) => {
    if (c < 0 || r < 0 || c >= W || r >= H) return 0;
    const i = r * W + c;
    if (grid[i] === CLASS.BLOCK || grid[i] === CLASS.DEEP) return 0;
    // blocked water stays water (deep) so the water bitset keeps it
    grid[i] = grid[i] === CLASS.SHALLOW ? CLASS.DEEP : CLASS.BLOCK;
    return 1;
  };
  for (const it of inst) {
    const t = types.get(it.d.id);
    const d = it.d;
    it.solidSource = it.destructable && d.life > 0 && (d.flags & 0x02) !== 0 && it.blocker !== 'air';
    if (!it.destructable) continue;
    const bakedType = t.baked / t.n >= BAKED_THRESHOLD;
    t.decision = it.blocker === 'air' ? 'ignored (air-only blocker)'
      : d.life === 0 ? 'dead/open (life 0): not solid'
      : bakedType ? 'baked in wpm: not rasterized' : 'rasterized';
    if (!it.solidSource || bakedType) continue;
    const s = clampScale(d.scale);
    let changed = 0;
    if (it.blocker === 'ground') {
      const size = /^YT.c/.test(d.id) || /^YTl/.test(d.id) ? BLOCKER_SIZE_LARGE : BLOCKER_SIZE_SMALL;
      t.footprint = `${size}x${size} square`;
      const x0 = Math.round((d.x - size / 2 - T.offsetX) / pixel), x1 = Math.round((d.x + size / 2 - T.offsetX) / pixel);
      const y0 = Math.round((d.y - size / 2 - T.offsetY) / pixel), y1 = Math.round((d.y + size / 2 - T.offsetY) / pixel);
      for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) changed += setBlock(px, H - 1 - py);
    } else if (it.shape === 'wall') {
      const len = 256 * s, thick = 64;
      t.footprint = `bar ${Math.round(len)}x${thick} across facing`;
      const ux = -Math.sin(d.angle), uy = Math.cos(d.angle); // long axis = perpendicular to facing
      const vx = Math.cos(d.angle), vy = Math.sin(d.angle);
      const ext = Math.ceil(len / 2 / pixel) + 1;
      const { c: cc, r: rr } = tf.worldToPixel(d.x, d.y);
      for (let r = rr - ext; r <= rr + ext; r++) {
        for (let c = cc - ext; c <= cc + ext; c++) {
          const wx = T.offsetX + (c + 0.5) * pixel - d.x, wy = T.offsetY + (H - 1 - r + 0.5) * pixel - d.y;
          if (Math.abs(wx * ux + wy * uy) <= len / 2 && Math.abs(wx * vx + wy * vy) <= thick / 2) changed += setBlock(c, r);
        }
      }
    } else {
      const rad = Math.max(RASTER_MIN_R, Math.min(RASTER_MAX_R, (PROP_BASE_R[it.kind] ?? 48) * s));
      it.rasterR = rad;
      t.footprint = `disc r=${PROP_BASE_R[it.kind] ?? 48}*scale clamped [${RASTER_MIN_R},${RASTER_MAX_R}]`;
      const ext = Math.ceil(rad / pixel) + 1;
      const { c: cc, r: rr } = tf.worldToPixel(d.x, d.y);
      for (let r = rr - ext; r <= rr + ext; r++) {
        for (let c = cc - ext; c <= cc + ext; c++) {
          const wx = T.offsetX + (c + 0.5) * pixel - d.x, wy = T.offsetY + (H - 1 - r + 0.5) * pixel - d.y;
          if (wx * wx + wy * wy <= rad * rad) changed += setBlock(c, r);
        }
      }
    }
    rasterCount.set(d.id, (rasterCount.get(d.id) ?? 0) + changed);
  }
  for (const [id, t] of [...types.entries()].sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))) {
    report.doodadTypes[id] = {
      n: t.n, kind: t.kind, destructable: t.destructable > 0, bakedFrac: r3(t.baked / t.n),
      decision: t.destructable ? t.decision : 'doodad: not rasterized (the editor bakes doodad pathing into wpm)',
      ...(t.footprint ? { footprint: t.footprint, pixelsAdded: rasterCount.get(id) ?? 0 } : {}),
    };
  }

  // 4b. keyed doors created by the map script (absent from war3map.doo). Keys are out of the MVP (D-026), so by
  // default doors stay CLOSED as in the source: the doorway gap across the door is filled. opts.doors = 'open'
  // leaves them walkable. The gap axis is the shorter bounded walkable span through the door centre.
  const doorProps = [];
  report.doors = [];
  const placed = new Set(inst.map((it) => `${it.d.id}@${Math.round(it.d.x / 64)},${Math.round(it.d.y / 64)}`));
  for (const sd of parsed.scriptDestructables ?? []) {
    if (placed.has(`${sd.id}@${Math.round(sd.x / 64)},${Math.round(sd.y / 64)}`)) continue; // also placed in .doo
    if (!/^.T(g|d|s|tg)/.test(sd.id)) continue; // only gates/doors; other script destructables are cosmetic
    const { c: dc, r: dr } = tf.worldToPixel(sd.x, sd.y);
    if (dc < 0 || dr < 0 || dc >= W || dr >= H) continue;
    const span = (sx, sy) => {
      let a = 0, b = 0;
      const free = (k) => { const c = dc + sx * k, r = dr + sy * k; return c >= 0 && r >= 0 && c < W && r < H && grid[r * W + c] !== CLASS.BLOCK && grid[r * W + c] !== CLASS.DEEP; };
      while (a < DOOR_MAX_GAP_PX && free(-(a + 1))) a++;
      while (b < DOOR_MAX_GAP_PX && free(b + 1)) b++;
      return { a, b, closed: a < DOOR_MAX_GAP_PX && b < DOOR_MAX_GAP_PX };
    };
    const hx = span(1, 0), vy = span(0, 1);
    const cands = [hx.closed && { axis: 'x', ...hx, len: hx.a + hx.b + 1 }, vy.closed && { axis: 'y', ...vy, len: vy.a + vy.b + 1 }].filter(Boolean);
    if (!cands.length) { report.warnings.push(`door ${sd.id}: no bounded gap, left open`); continue; }
    const g = cands.sort((p, q) => p.len - q.len || (p.axis < q.axis ? -1 : 1))[0];
    let changed = 0;
    if (opts.doors !== 'open') {
      const half = DOOR_THICK_PX >> 1;
      for (let k = -g.a; k <= g.b; k++) for (let t = -half; t < DOOR_THICK_PX - half; t++) {
        changed += g.axis === 'x' ? setBlock(dc + k, dr + t) : setBlock(dc + t, dr + k);
      }
    }
    const mid = (g.b - g.a) / 2;
    const u = tf.pixelToUnits(g.axis === 'x' ? dc + mid : dc, g.axis === 'y' ? dr + mid : dr);
    doorProps.push({ x: r3(u.x), y: r3(u.y), kind: 'door', r: r3((g.len * step) / 2), solid: opts.doors !== 'open' });
    report.doors.push({ id: sd.id, axis: g.axis, gapPx: g.len, pixelsAdded: changed });
  }

  const counts = [0, 0, 0, 0];
  for (let i = 0; i < W * H; i++) counts[grid[i]]++;
  report.pathing.counts = { walk: counts[0], block: counts[1], shallow: counts[2], deep: counts[3] };

  const walkable = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) walkable[i] = isWalkableClass(grid[i]) ? 1 : 0;
  const notWalk = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) notWalk[i] = walkable[i] ? 0 : 1;
  const clearance = distanceTransform(notWalk, W, H); // px from a walkable pixel to the nearest non-walkable

  // 5. points
  const pixOf = (i) => ({ c: i % W, r: Math.floor(i / W) });
  const ptOf = (i) => { const { c, r } = pixOf(i); const u = tf.pixelToUnits(c, r); return { x: r3(u.x), y: r3(u.y) }; };
  const rectCenter = (name) => {
    const rc = getRect(parsed.rects ?? {}, name);
    if (!rc) return null;
    return { wx: (rc[0] + rc[2]) / 2, wy: (rc[1] + rc[3]) / 2 };
  };

  // plaza anchor: a fountain near the plaza rect centre (if any), else the rect centre
  const plazaRc = rectCenter(roles.praca);
  if (!plazaRc) throw new Error(`layout: plaza rect ${roles.praca} not found`);
  let anchor = plazaRc;
  {
    let best = null, bestD = 1024 * 1024; // within 1024 WC3 units (8 cells)
    for (const it of inst) {
      if (it.kind !== 'fountain') continue;
      const dd = (it.d.x - plazaRc.wx) ** 2 + (it.d.y - plazaRc.wy) ** 2;
      const sc = Math.max(it.d.scale[0], it.d.scale[1]);
      // prefer the biggest fountain, then the nearest
      if (!best || sc > best.sc + 1e-6 || (Math.abs(sc - best.sc) <= 1e-6 && dd < bestD)) {
        if (dd <= 1024 * 1024) { best = { wx: it.d.x, wy: it.d.y, sc }; bestD = dd; }
      }
    }
    if (best) anchor = best;
    report.points.plazaAnchor = best ? 'fountain near plaza rect' : 'plaza rect centre';
  }
  // main network = the largest 4-connected walkable component (small sealed pockets, e.g. inside the
  // fountain basin, are ignored); every point is snapped into it
  const wl = labelComponents(walkable, W, H);
  let mainId = 0;
  for (let k = 1; k < wl.count; k++) if (wl.sizes[k] > wl.sizes[mainId]) mainId = k;
  report.pathing.walkComponents = wl.count;
  report.pathing.mainComponentPx = wl.sizes[mainId];
  // points stand on dry ground of the main network with room for a hero (>= 2 px = 0.44 u from any wall)
  const standOk = (i) => wl.labels[i] === mainId && grid[i] === CLASS.WALK && clearance[i] >= 2;
  // the start and the plaza (boss arena) need room for big bodies: >= 4 px = 0.88 u from any wall
  const standWide = (i) => standOk(i) && clearance[i] >= 4;
  const anchorPx = tf.worldToPixel(anchor.wx, anchor.wy);
  const snap = (wx, wy, label) => {
    const { c, r } = tf.worldToPixel(wx, wy);
    const i = nearestPixel(W, H, c, r, standOk);
    if (i < 0) throw new Error(`layout: cannot snap ${label}`);
    const p = pixOf(i);
    report.points[label] = { snappedPx: r3(Math.hypot(p.c - c, p.r - r)) };
    return i;
  };
  const start = parsed.info?.starts?.[0];
  if (!start) throw new Error('layout: no player start');
  const inicioI = (() => {
    const { c, r } = tf.worldToPixel(start.x, start.y);
    const i = nearestPixel(W, H, c, r, standWide);
    if (i < 0) throw new Error('layout: cannot snap inicio');
    report.points.inicio = { snappedPx: r3(Math.hypot((i % W) - c, Math.floor(i / W) - r)) };
    return i;
  })();
  const spawnI = {};
  for (const key of ['spawnN', 'spawnS', 'spawnL', 'spawnO']) {
    const rc = rectCenter(roles[key]);
    if (!rc) throw new Error(`layout: spawn rect ${roles[key]} not found`);
    spawnI[key] = snap(rc.wx, rc.wy, key);
  }

  // bocas: walk outwards from the plaza centre along each cardinal axis and measure the walkable width across
  // the axis. A mouth is the innermost "throat": a run of narrow (<= throatMax) cross-sections whose inner AND
  // outer neighbours are wide open (plaza interior on one side, the avenue crossing on the other).
  const throatMax = opts.throatMax ?? 24, searchT = opts.mouthSearch ?? 120, band = 8, cap = 64;
  const ac = anchorPx.c, ar = anchorPx.r;
  const crossWidth = (c, r, horizontalAxis) => {
    // horizontalAxis: the walk direction is E/W, so the cross-section is vertical
    const dc = horizontalAxis ? 0 : 1, dr = horizontalAxis ? 1 : 0;
    let o = null;
    for (let k = 0; k <= band && o === null; k++) {
      for (const s of k === 0 ? [0] : [-k, k]) {
        const cc = c + dc * s, rr = r + dr * s;
        if (cc >= 0 && rr >= 0 && cc < W && rr < H && walkable[rr * W + cc]) { o = s; break; }
      }
    }
    if (o === null) return { w: 0, mid: 0 };
    let a = o, b = o;
    while (a - 1 >= o - cap) { const cc = c + dc * (a - 1), rr = r + dr * (a - 1); if (cc < 0 || rr < 0 || cc >= W || rr >= H || !walkable[rr * W + cc]) break; a--; }
    while (b + 1 <= o + cap) { const cc = c + dc * (b + 1), rr = r + dr * (b + 1); if (cc < 0 || rr < 0 || cc >= W || rr >= H || !walkable[rr * W + cc]) break; b++; }
    return { w: b - a + 1, mid: (a + b) / 2 };
  };
  const bocaI = {};
  const DIRS = { N: [0, -1], S: [0, 1], L: [1, 0], O: [-1, 0] };
  for (const [key, [dx, dy]] of Object.entries(DIRS)) {
    const horiz = dx !== 0;
    const prof = [];
    for (let t = 0; t <= searchT; t++) prof.push(crossWidth(ac + dx * t, ar + dy * t, horiz));
    let found = null;
    for (let t = 1; t < searchT && !found; t++) {
      if (!(prof[t].w > 0 && prof[t].w <= throatMax)) continue;
      let e = t;
      while (e + 1 < searchT && prof[e + 1].w > 0 && prof[e + 1].w <= throatMax) e++;
      const wMax = Math.max(...prof.slice(t, e + 1).map((p) => p.w));
      const wide = Math.max(2 * wMax, 28);
      if (prof[t - 1].w >= wide && prof[e + 1].w >= wide) found = { t0: t, t1: e, w: wMax };
      t = e;
    }
    let i;
    if (found) {
      const tm = Math.round((found.t0 + found.t1) / 2);
      const mid = prof[tm].mid;
      const c = Math.round(ac + dx * tm + (horiz ? 0 : mid)), r = Math.round(ar + dy * tm + (horiz ? mid : 0));
      i = nearestPixel(W, H, c, r, standOk);
      const wMin = Math.min(...prof.slice(found.t0, found.t1 + 1).map((p) => p.w));
      report.points['boca' + key] = { throatFromCentrePx: [found.t0, found.t1], minWidthU: r3(wMin * step), maxWidthU: r3(found.w * step) };
    } else {
      report.warnings.push(`boca ${key}: no throat found, using the axis point at 40 px`);
      i = nearestPixel(W, H, ac + dx * 40, ar + dy * 40, standOk);
    }
    bocaI[key] = i;
  }

  // praca: the stand-able pixel nearest to the fountain (the fountain itself and the pool basin around it are
  // blocked or shallow water), i.e. dry ground on the plaza axis
  // the most central stand-able spot of the plaza: minimises the farthest mouth (the fountain fills the true
  // centre), with room for the boss; ties -> more clearance -> smaller index
  const bocaPx = Object.values(bocaI).map(pixOf);
  const cx = Math.round(bocaPx.reduce((n, p) => n + p.c, 0) / bocaPx.length), cy = Math.round(bocaPx.reduce((n, p) => n + p.r, 0) / bocaPx.length);
  const reachR = Math.max(...bocaPx.map((p) => Math.hypot(p.c - cx, p.r - cy)));
  let pracaI = -1, bestCost = Infinity;
  for (let r = Math.max(0, Math.floor(cy - reachR)); r <= Math.min(H - 1, Math.ceil(cy + reachR)); r++) {
    for (let c = Math.max(0, Math.floor(cx - reachR)); c <= Math.min(W - 1, Math.ceil(cx + reachR)); c++) {
      const i = r * W + c;
      if (!standWide(i)) continue;
      const cost = Math.max(...bocaPx.map((p) => Math.hypot(p.c - c, p.r - r)));
      if (cost < bestCost - 1e-9 || (Math.abs(cost - bestCost) <= 1e-9 && clearance[i] > clearance[pracaI])) { bestCost = cost; pracaI = i; }
    }
  }
  if (pracaI < 0) throw new Error('layout: no walkable pixel near the plaza');
  report.points.praca = { snappedPx: r3(Math.hypot((pracaI % W) - cx, Math.floor(pracaI / W) - cy)) };
  const gPraca = geodesic(walkable, W, H, pracaI);
  const reach = (i) => Number.isFinite(gPraca[i]);

  // 6. connectivity + path lengths
  const fromInicio = geodesic(walkable, W, H, inicioI);
  const len = (g, i) => (Number.isFinite(g[i]) ? r3(g[i] * step) : null);
  report.paths.inicioToPraca = len(fromInicio, pracaI);
  for (const k of Object.keys(spawnI)) report.paths['pracaTo' + k[0].toUpperCase() + k.slice(1)] = len(gPraca, spawnI[k]);
  for (const k of Object.keys(bocaI)) report.paths['pracaToBoca' + k] = len(gPraca, bocaI[k]);
  for (const [k, v] of Object.entries(report.paths)) if (v === null) report.warnings.push(`path ${k}: unreachable`);

  // 7. street network (avenues, ring road, plaza): morphological opening of the walkable area with a disc of
  // radius streetRadius px; the opened components that contain a spawn, a boca or the start are "streets".
  const Ro = opts.streetRadius ?? 7;
  const seeds = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) seeds[i] = clearance[i] >= Ro ? 1 : 0;
  const dSeed = distanceTransform(seeds, W, H);
  const open = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) open[i] = walkable[i] && dSeed[i] <= Ro ? 1 : 0;
  const openLab = labelComponents(open, W, H);
  const streetIds = new Set();
  const keyPts = [inicioI, ...Object.values(spawnI), ...Object.values(bocaI)];
  for (const i of keyPts) {
    const near = nearestPixel(W, H, i % W, Math.floor(i / W), (q) => open[q] === 1, 24);
    if (near >= 0) streetIds.add(openLab.labels[near]);
  }
  let biggest = -1;
  for (let k = 0; k < openLab.count; k++) if (biggest < 0 || openLab.sizes[k] > openLab.sizes[biggest]) biggest = k;
  if (biggest >= 0) streetIds.add(biggest);
  const street = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) street[i] = open[i] && streetIds.has(openLab.labels[i]) ? 1 : 0;

  // plaza box: bounding box of the 4 bocas + margin (the base area)
  const bc = Object.values(bocaI).map(pixOf);
  const plazaBox = {
    c0: Math.min(...bc.map((p) => p.c)) - 8, c1: Math.max(...bc.map((p) => p.c)) + 8,
    r0: Math.min(...bc.map((p) => p.r)) - 8, r1: Math.max(...bc.map((p) => p.r)) + 8,
  };

  // 8. loot: farthest-point sampling over candidate pixels, seeded with the key points
  const lootCount = opts.lootCount ?? 48;
  const spacingPx = (opts.lootSpacing ?? 8) / step;
  const clearPx = (opts.lootClear ?? 6) / step;
  const edgePx = Math.round((opts.lootEdgeMargin ?? 8) / step); // keeps crates out of the outer city wall rooms
  const streetGapPx = (opts.lootStreetGap ?? 2) / step; // crates sit inside the blocks, not on a street's edge
  const streetDist = distanceTransform(street, W, H);
  const avoid = [pracaI, inicioI, ...Object.values(spawnI), ...Object.values(bocaI)].map(pixOf);
  const cand = [];
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const i = r * W + c;
      if (grid[i] !== CLASS.WALK || clearance[i] < 2 || !reach(i) || streetDist[i] < streetGapPx) continue;
      if (c < pl + edgePx || c >= pr - edgePx || r < pt + edgePx || r >= pb - edgePx) continue;
      if (c >= plazaBox.c0 && c <= plazaBox.c1 && r >= plazaBox.r0 && r <= plazaBox.r1) continue;
      let ok = true;
      for (const p of avoid) if ((p.c - c) ** 2 + (p.r - r) ** 2 < clearPx * clearPx) { ok = false; break; }
      if (ok) cand.push(i);
    }
  }
  const minD = new Float64Array(cand.length);
  for (let q = 0; q < cand.length; q++) {
    const c = cand[q] % W, r = Math.floor(cand[q] / W);
    let m = Infinity;
    for (const p of avoid) m = Math.min(m, Math.hypot(p.c - c, p.r - r));
    minD[q] = m;
  }
  const lootI = [];
  while (lootI.length < lootCount) {
    let best = -1;
    for (let q = 0; q < cand.length; q++) if (best < 0 || minD[q] > minD[best]) best = q;
    if (best < 0 || minD[best] < spacingPx) break;
    const i = cand[best];
    lootI.push(i);
    const c = i % W, r = Math.floor(i / W);
    for (let q = 0; q < cand.length; q++) {
      const cc = cand[q] % W, rr = Math.floor(cand[q] / W);
      const dd = Math.hypot(cc - c, rr - r);
      if (dd < minD[q]) minD[q] = dd;
    }
  }
  lootI.sort((a, b) => a - b);
  report.loot = { candidates: cand.length, picked: lootI.length, streetPixels: street.reduce((a, v) => a + v, 0) };
  if (lootI.length < 30) report.warnings.push(`loot: only ${lootI.length} spots`);

  // 9. blocks: 4-neighbour components of the block class, split into rectangles and classified
  // The component touching the playable border (outer city wall) also swallows interior ruins attached to it:
  // its pixels within edgeBand of the border stay 'edge', the rest is relabelled and classified like any block.
  const blockMask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) blockMask[i] = grid[i] === CLASS.BLOCK ? 1 : 0;
  const lab0 = labelComponents(blockMask, W, H);
  const touches = new Uint8Array(lab0.count);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const id = lab0.labels[r * W + c];
    if (id >= 0 && (c <= pl || c >= pr - 1 || r <= pt || r >= pb - 1)) touches[id] = 1;
  }
  const edgeBand = Math.round((opts.edgeBand ?? 8) / step);
  const group = new Uint8Array(W * H); // 1 normal, 2 edge band, 3 interior part of an edge component
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c, id = lab0.labels[i];
    if (id < 0) continue;
    if (!touches[id]) { group[i] = 1; continue; }
    const borderDist = Math.min(c - pl, pr - 1 - c, r - pt, pb - 1 - r);
    group[i] = borderDist <= edgeBand ? 2 : 3;
  }
  const lab = labelComponents(group, W, H);
  const NC = lab.count;
  const bb = Array.from({ length: NC }, () => ({ x0: W, y0: H, x1: -1, y1: -1, area: 0, per: 0, edge: false, nb: [] }));
  // terrain height (WC3 units) at a pathing pixel centre, bilinear over the 4 corners of its cell
  const heightAt = (c, r) => {
    const fx = ((c + 0.5) * pixel) / (T.cellSize ?? WC3_CELL), fy = ((r + 0.5) * pixel) / (T.cellSize ?? WC3_CELL);
    const cx = Math.min(T.w - 2, Math.floor(fx)), cy = Math.min(T.h - 2, Math.floor(fy));
    const tx = fx - cx, ty = fy - cy;
    const g = (x, y) => T.height[(T.h - 1 - y) * T.w + x];
    return g(cx, cy) * (1 - tx) * (1 - ty) + g(cx + 1, cy) * tx * (1 - ty) + g(cx, cy + 1) * (1 - tx) * ty + g(cx + 1, cy + 1) * tx * ty;
  };
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const id = lab.labels[r * W + c];
      if (id < 0) continue;
      const b = bb[id];
      b.area++;
      if (c < b.x0) b.x0 = c; if (c > b.x1) b.x1 = c;
      if (r < b.y0) b.y0 = r; if (r > b.y1) b.y1 = r;
      if (group[r * W + c] === 2) b.edge = true;
      const i = r * W + c;
      for (const [j, ok] of [[i - 1, c > 0], [i + 1, c < W - 1], [i - W, r > 0], [i + W, r < H - 1]]) {
        if (ok && lab.labels[j] === id) continue;
        b.per++;
        if (ok && walkable[j]) b.nb.push(heightAt(j % W, Math.floor(j / W)));
      }
    }
  }
  const quart = (arr, f) => arr[Math.min(arr.length - 1, Math.floor(f * (arr.length - 1)))];
  const RUBBLE_MAX = opts.rubbleMax ?? 64; // px (<= 3.1 u², e.g. 8x8 px pillars)
  const CLIFF_IQR = opts.cliffIqr ?? 96; // WC3 units (one cliff level = 128)
  const BLOCKY_FILL = 0.5;
  const blocks = [];
  const kindCount = {};
  let rectTotal = 0;
  for (let id = 0; id < NC; id++) {
    const b = bb[id];
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    // kinds: edge = touches the playable border; rubble = small; cliff = the walkable ground around it sits on
    // different levels (inter-quartile range of the neighbouring heights >= ~0.75 cliff level), i.e. a terrace
    // edge; building = blocky (fills >= 50% of its bbox); wall = the rest (thin outlines of ruins and wall runs).
    b.nb.sort((x, y) => x - y);
    const iqr = b.nb.length ? quart(b.nb, 0.75) - quart(b.nb, 0.25) : 0;
    const fill = b.area / (bw * bh);
    let kind;
    if (b.edge) kind = 'edge';
    else if (b.area <= RUBBLE_MAX) kind = 'rubble';
    else if (iqr >= CLIFF_IQR) kind = 'cliff';
    else if (fill >= BLOCKY_FILL && Math.min(bw, bh) >= 2 * cellPx) kind = 'building';
    else kind = 'wall';
    const rects = componentRects(lab.labels, W, id, b.x0, b.y0, b.x1, b.y1);
    rectTotal += rects.length;
    kindCount[kind] = (kindCount[kind] ?? 0) + 1;
    blocks.push({
      sortY: b.y0, sortX: b.x0, id,
      out: {
        kind,
        bbox: [r3(b.x0 * step), r3(b.y0 * step), r3(bw * step), r3(bh * step)],
        rects: rects.map(([x, y, w, h]) => [r3(x * step), r3(y * step), r3(w * step), r3(h * step)]),
      },
    });
  }
  blocks.sort((a, b) => a.sortY - b.sortY || a.sortX - b.sortX || a.id - b.id);
  const blocksOut = blocks.map((b, n) => ({ id: 'b-' + String(n + 1).padStart(4, '0'), ...b.out }));
  report.blocks = { components: NC, rects: rectTotal, kinds: kindCount };

  // 10. props (pathing blockers are dropped: they only shape the pathing)
  const props = [];
  for (const it of inst) {
    if (it.kind === 'blocker' || !it.inside) continue;
    const d = it.d;
    const s = clampScale(d.scale);
    let kind = it.kind;
    if (it.destructable && s >= 3) kind = 'wreck'; // oversized custom destructable (the crashed vehicle)
    const dead = it.destructable && d.life === 0;
    const solid = !dead && grid[it.r * W + it.c] === CLASS.BLOCK;
    // A rasterized destructable collides exactly as rasterized, so its emitted radius matches the footprint.
    const r = it.rasterR ?? (PROP_BASE_R[kind] ?? 40) * s;
    props.push({ x: r3(tf.toX(d.x)), y: r3(tf.toY(d.y)), kind: dead ? 'ruin' : kind, r: r3(r * K), solid });
  }
  props.push(...doorProps);
  props.sort((a, b) => a.y - b.y || a.x - b.x || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.r - b.r);
  const propKinds = {};
  for (const p of props) propKinds[p.kind] = (propKinds[p.kind] ?? 0) + 1;
  report.props = { count: props.length, kinds: propKinds, solid: props.filter((p) => p.solid).length };

  // 11. water summary (components of shallow / deep pixels)
  const waterAreas = [];
  for (const cls of [CLASS.SHALLOW, CLASS.DEEP]) {
    const m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) m[i] = grid[i] === cls ? 1 : 0;
    const wl = labelComponents(m, W, H);
    const boxes = Array.from({ length: wl.count }, () => [W, H, -1, -1]);
    for (let i = 0; i < W * H; i++) {
      const id = wl.labels[i];
      if (id < 0) continue;
      const c = i % W, r = (i - c) / W, bx = boxes[id];
      if (c < bx[0]) bx[0] = c; if (r < bx[1]) bx[1] = r; if (c > bx[2]) bx[2] = c; if (r > bx[3]) bx[3] = r;
    }
    boxes.forEach((bx, id) => waterAreas.push({
      kind: CLASS_NAMES[cls], bbox: [r3(bx[0] * step), r3(bx[1] * step), r3((bx[2] - bx[0] + 1) * step), r3((bx[3] - bx[1] + 1) * step)],
      area: r3(wl.sizes[id] * step * step),
    }));
  }
  waterAreas.sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0] || (a.kind < b.kind ? -1 : 1));

  // 12. heights (corners, row 0 = north) in our units, quantized
  const hq = new Int16Array(T.w * T.h);
  for (let r = 0; r < T.h; r++) for (let c = 0; c < T.w; c++) hq[r * T.w + c] = Math.round((T.height[(T.h - 1 - r) * T.w + c] * K) / HEIGHT_SCALE);

  const cellsW = T.w - 1, cellsH = T.h - 1;
  const asset = {
    format: 'viagem-map',
    version: 1,
    id: 'cidade-nevada',
    name: 'Cidade Nevada',
    units: { perCell: PER_CELL, perWc3Unit: K },
    axes: 'x east, y south, origin NW',
    size: { w: r3(cellsW * PER_CELL), h: r3(cellsH * PER_CELL) },
    cells: { w: cellsW, h: cellsH },
    playable: { x: r3(ml * PER_CELL), y: r3(mt * PER_CELL), w: r3((cellsW - ml - mr) * PER_CELL), h: r3((cellsH - mt - mb) * PER_CELL) },
    heights: { w: T.w, h: T.h, step: PER_CELL, scale: HEIGHT_SCALE, encoding: 'i16le-base64', data: encodeI16Base64(hq) },
    pathing: { w: W, h: H, step: r3(step), encoding: 'u8-rle-base64', classes: { ...CLASS_NAMES }, data: encodeRleBase64(grid) },
    blocks: blocksOut,
    props,
    points: {
      inicio: ptOf(inicioI),
      praca: ptOf(pracaI),
      spawnN: ptOf(spawnI.spawnN),
      spawnS: ptOf(spawnI.spawnS),
      spawnL: ptOf(spawnI.spawnL),
      spawnO: ptOf(spawnI.spawnO),
      bocas: { N: ptOf(bocaI.N), S: ptOf(bocaI.S), L: ptOf(bocaI.L), O: ptOf(bocaI.O) },
    },
    loot: lootI.map(ptOf),
    water: { shallow: counts[CLASS.SHALLOW], deep: counts[CLASS.DEEP], areas: waterAreas },
  };
  return { asset, report, debug: { grid, street, clearance, W, H, plazaBox } };
}

/** Builds the CityAsset (plain JSON-safe object) from a ParsedMap. */
export function buildCityAsset(parsed, opts = {}) {
  return analyzeCity(parsed, opts).asset;
}

// ---------------------------------------------------------------------------------------------
// Conference / evidence image from the asset alone (north up)
// ---------------------------------------------------------------------------------------------

const KIND_COLORS = {
  edge: [120, 120, 130], cliff: [150, 100, 60], wall: [230, 140, 30], building: [210, 60, 60], rubble: [150, 80, 200],
};
const PROP_COLORS = {
  tree: [40, 150, 60], rock: [130, 110, 90], ruin: [180, 160, 130], prop: [90, 90, 160], fountain: [60, 160, 230],
  wreck: [255, 90, 0], water: [60, 120, 220],
};

/**
 * Renders the asset to RGBA: pathing classes, block outlines coloured by kind, props (dots), loot (cyan squares),
 * points (inicio green, praca magenta, spawns red, bocas yellow). opts: scale (2), crop {x,y,w,h} in our units,
 * overlay(rgba, toPx) hook for extra debug drawing.
 */
export function renderCityPreview(asset, opts = {}) {
  const S = opts.scale ?? 2;
  const PW = asset.pathing.w, PH = asset.pathing.h, step = asset.pathing.step;
  const grid = decodeRleBase64(asset.pathing.data, PW * PH);
  const crop = opts.crop
    ? { c0: Math.floor(opts.crop.x / step), r0: Math.floor(opts.crop.y / step), cw: Math.ceil(opts.crop.w / step), ch: Math.ceil(opts.crop.h / step) }
    : { c0: 0, r0: 0, cw: PW, ch: PH };
  const width = crop.cw * S, height = crop.ch * S;
  const rgba = new Uint8Array(width * height * 4);
  const BASE = { 0: [226, 226, 216], 1: [38, 38, 44], 2: [140, 190, 240], 3: [40, 90, 200] };
  // block label image for outlines
  const blab = new Int32Array(PW * PH).fill(-1);
  asset.blocks.forEach((b, n) => {
    for (const [x, y, w, h] of b.rects) {
      const c0 = Math.round(x / step), r0 = Math.round(y / step), c1 = c0 + Math.round(w / step), r1 = r0 + Math.round(h / step);
      for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) blab[r * PW + c] = n;
    }
  });
  const put = (x, y, col, a = 255) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const o = (y * width + x) * 4;
    const t = a / 255;
    rgba[o] = Math.round(rgba[o] * (1 - t) + col[0] * t);
    rgba[o + 1] = Math.round(rgba[o + 1] * (1 - t) + col[1] * t);
    rgba[o + 2] = Math.round(rgba[o + 2] * (1 - t) + col[2] * t);
    rgba[o + 3] = 255;
  };
  for (let r = 0; r < crop.ch; r++) {
    for (let c = 0; c < crop.cw; c++) {
      const gc = c + crop.c0, gr = r + crop.r0;
      if (gc < 0 || gr < 0 || gc >= PW || gr >= PH) continue;
      const i = gr * PW + gc;
      let col = BASE[grid[i]];
      const id = blab[i];
      if (id >= 0) {
        const kc = KIND_COLORS[asset.blocks[id].kind] ?? [255, 255, 255];
        const border = (gc > 0 && blab[i - 1] !== id) || (gc < PW - 1 && blab[i + 1] !== id) || (gr > 0 && blab[i - PW] !== id) || (gr < PH - 1 && blab[i + PW] !== id);
        col = border ? kc : [Math.round(col[0] * 0.6 + kc[0] * 0.4 * 0.5), Math.round(col[1] * 0.6 + kc[1] * 0.4 * 0.5), Math.round(col[2] * 0.6 + kc[2] * 0.4 * 0.5)];
      }
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) put(c * S + dx, r * S + dy, col);
    }
  }
  const toPx = (x, y) => [Math.round((x / step - crop.c0) * S), Math.round((y / step - crop.r0) * S)];
  const disc = (x, y, rad, col, a = 255) => {
    const [px, py] = toPx(x, y);
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) if (dx * dx + dy * dy <= rad * rad) put(px + dx, py + dy, col, a);
  };
  const ring = (x, y, rad, col, th = 2) => {
    const [px, py] = toPx(x, y);
    for (let dy = -rad - th; dy <= rad + th; dy++) for (let dx = -rad - th; dx <= rad + th; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= rad - th / 2 && d <= rad + th / 2) put(px + dx, py + dy, col);
    }
  };
  const square = (x, y, half, col, border = [0, 0, 0]) => {
    const [px, py] = toPx(x, y);
    for (let dy = -half - 1; dy <= half + 1; dy++) for (let dx = -half - 1; dx <= half + 1; dx++) {
      put(px + dx, py + dy, Math.abs(dx) > half || Math.abs(dy) > half ? border : col);
    }
  };
  for (const p of asset.props) {
    const col = PROP_COLORS[p.kind] ?? [200, 200, 200];
    disc(p.x, p.y, Math.max(1, Math.round((p.r / step) * S * 0.5)), col, p.solid ? 230 : 120);
  }
  if (opts.overlay) opts.overlay(put, toPx, S);
  const U = Math.max(3, 2 * S); // marker size in image pixels
  for (const l of asset.loot) square(l.x, l.y, Math.max(2, S + 1), [0, 230, 230]);
  const pts = asset.points;
  for (const k of ['N', 'S', 'L', 'O']) { disc(pts.bocas[k].x, pts.bocas[k].y, U, [255, 220, 0]); ring(pts.bocas[k].x, pts.bocas[k].y, U + 2, [0, 0, 0], 1); }
  for (const k of ['spawnN', 'spawnS', 'spawnL', 'spawnO']) { disc(pts[k].x, pts[k].y, U + 2, [230, 30, 30]); ring(pts[k].x, pts[k].y, U + 4, [0, 0, 0], 1); }
  disc(pts.praca.x, pts.praca.y, U + 2, [230, 0, 200]); ring(pts.praca.x, pts.praca.y, U + 4, [0, 0, 0], 1);
  disc(pts.inicio.x, pts.inicio.y, U + 2, [0, 200, 60]); ring(pts.inicio.x, pts.inicio.y, U + 4, [0, 0, 0], 1);
  return { width, height, rgba };
}
