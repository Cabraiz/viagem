// Parsers for the Warcraft III map files needed by the city importer.
// Port of design/w3x-ref/scripts/analyze.py. All reads are bounds-checked: corrupt input throws.
// World units throughout (y = north, grid row 0 = south).
import { openMpq } from './mpq.mjs';

/** Little-endian cursor over a Buffer that throws on any out-of-range read. */
class Reader {
  constructor(buf, label) { this.d = buf; this.p = 0; this.label = label; }
  need(n) {
    if (n < 0 || this.p + n > this.d.length) throw new Error(`${this.label}: unexpected end of data at byte ${this.p}`);
    const p = this.p; this.p += n; return p;
  }
  i32() { return this.d.readInt32LE(this.need(4)); }
  u32() { return this.d.readUInt32LE(this.need(4)); }
  f32() { return this.d.readFloatLE(this.need(4)); }
  u8() { return this.d[this.need(1)]; }
  c4() { const p = this.need(4); return this.d.toString('latin1', p, p + 4); }
  /** Non-negative element count, sanity-checked against the bytes left (minBytes per element). */
  count(minBytes) {
    const n = this.i32();
    if (n < 0 || n * minBytes > this.d.length - this.p) throw new Error(`${this.label}: bad count ${n} at byte ${this.p - 4}`);
    return n;
  }
  /** Skips a NUL-terminated string (contents are not needed). */
  skipStr() {
    const e = this.d.indexOf(0, this.p);
    if (e < 0) throw new Error(`${this.label}: unterminated string at byte ${this.p}`);
    this.p = e + 1;
  }
  magic(m) { const v = this.c4(); if (v !== m) throw new Error(`${this.label}: bad magic ${JSON.stringify(v)} (expected ${m})`); }
}

/** war3map.w3e: corner grid (heights, cliff layers, ground tiles, flags, water). */
export function parseW3e(buf) {
  const b = new Reader(buf, 'war3map.w3e');
  b.magic('W3E!');
  b.i32(); b.u8(); b.i32(); // version, main tileset, custom-tileset flag
  const tiles = Array.from({ length: b.count(4) }, () => b.c4());
  const cliffTiles = Array.from({ length: b.count(4) }, () => b.c4());
  const w = b.i32(), h = b.i32();
  const offsetX = b.f32(), offsetY = b.f32();
  if (w <= 0 || h <= 0) throw new Error(`war3map.w3e: bad size ${w}x${h}`);
  const n = w * h;
  let p = b.need(n * 7);
  const height = new Float32Array(n), water = new Float32Array(n);
  const layer = new Uint8Array(n), ground = new Uint8Array(n), flags = new Uint8Array(n);
  for (let k = 0; k < n; k++, p += 7) {
    const gh = buf.readInt16LE(p), wv = buf.readUInt16LE(p + 2), f1 = buf[p + 4], ly = buf[p + 6] & 0x0f;
    height[k] = (gh - 0x2000 + (ly - 2) * 0x200) / 4;
    water[k] = ((wv & 0x3fff) - 0x2000) / 4 - 89.6;
    layer[k] = ly;
    ground[k] = f1 & 0x0f;
    flags[k] = (f1 & 0x10 ? 1 : 0) | (f1 & 0x20 ? 2 : 0) | (f1 & 0x40 ? 4 : 0) | (f1 & 0x80 || wv & 0x4000 ? 8 : 0);
  }
  return { w, h, offsetX, offsetY, cellSize: 128, tiles, cliffTiles, height, layer, ground, flags, water };
}

/** war3map.wpm: pathing pixels (4 per cell side). Raw flags: 0x02 no walk, 0x08 no build, 0x40 NOT water. */
export function parseWpm(buf) {
  const b = new Reader(buf, 'war3map.wpm');
  b.magic('MP3W');
  b.i32(); // version
  const w = b.i32(), h = b.i32();
  if (w <= 0 || h <= 0) throw new Error(`war3map.wpm: bad size ${w}x${h}`);
  const p = b.need(w * h);
  return { w, h, pixel: 32, data: Uint8Array.from(buf.subarray(p, p + w * h)) };
}

/** war3map.doo: doodads/destructables in file order (the special-doodad section is ignored). */
export function parseDoo(buf) {
  const b = new Reader(buf, 'war3map.doo');
  b.magic('W3do');
  const version = b.i32();
  b.i32(); // subversion
  const n = b.count(42);
  const out = [];
  for (let i = 0; i < n; i++) {
    const id = b.c4(), variation = b.i32();
    const x = b.f32(), y = b.f32(), z = b.f32(), angle = b.f32();
    const scale = [b.f32(), b.f32(), b.f32()];
    const flags = b.u8(), life = b.u8();
    if (version >= 8) { // item table pointer + dropped-item sets
      b.i32();
      for (let s = b.count(4); s > 0; s--) b.need(8 * b.count(8));
    }
    b.i32(); // editor id
    out.push({ id, variation, x, y, z, angle, scale, flags, life });
  }
  return out;
}

/** war3map.w3i (v25 TFT; v28/v31 layout additions included but only v25 is verified). */
export function parseW3i(buf) {
  const b = new Reader(buf, 'war3map.w3i');
  const version = b.i32();
  if (version < 25) throw new Error(`war3map.w3i: unsupported version ${version}`);
  b.i32(); b.i32(); // saves, editor version
  if (version >= 28) for (let i = 0; i < 4; i++) b.i32(); // game build version
  for (let i = 0; i < 4; i++) b.skipStr(); // name, author, description, recommended players
  const camera = Array.from({ length: 8 }, () => b.f32());
  const margins = Array.from({ length: 4 }, () => b.i32());
  const playable = { w: b.i32(), h: b.i32() };
  b.i32(); b.u8(); // flags, tileset
  b.i32(); for (let i = 0; i < 4; i++) b.skipStr(); // loading screen: number, model, text, title, subtitle
  b.i32(); for (let i = 0; i < 4; i++) b.skipStr(); // game data set, prologue: model, text, title, subtitle
  b.i32(); b.f32(); b.f32(); b.f32(); b.need(4); b.need(4); // terrain fog style, z start/end, density, color; weather id
  b.skipStr(); b.u8(); b.need(4); // sound environment, light environment tileset, water color
  if (version >= 28) b.i32(); // script language
  if (version >= 31) { b.i32(); b.i32(); } // supported modes, game data version
  const starts = [];
  for (let i = b.count(4); i > 0; i--) {
    const id = b.i32();
    b.i32(); b.i32(); b.i32(); b.skipStr(); // type, race, fixed start, name
    const x = b.f32(), y = b.f32();
    b.i32(); b.i32(); // ally low / high priority flags
    if (version >= 31) { b.i32(); b.i32(); } // enemy low / high priority flags
    starts.push({ id, x, y });
  }
  return { playable, margins, camera, starts };
}

/** Named rects from the map script: `set udg_rectNN=Rect(minX,minY,maxX,maxY)`. Later assignments win. */
export function parseRects(jassText) {
  const rects = {};
  for (const m of jassText.matchAll(/set udg_(rect\d+)=Rect\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/g)) {
    rects[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  }
  return rects;
}

/** Parses a .w3x buffer into the ParsedMap shape (see the importer interface doc). */
/**
 * Destructables created by the map script: `CreateDestructable[Z]('id', x, y, [z,] facingDeg, scale, variation)`.
 * Keyed doors/gates live only here, not in war3map.doo. Angle is returned in radians like parseDoo.
 */
export function parseScriptDestructables(jassText) {
  const re = /CreateDestructable(Z?)\('(\w{4})',(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)(?:,(\d+))?\)/g;
  const out = [];
  for (const m of jassText.matchAll(re)) {
    const v = m.slice(3, 9).map((x) => (x === undefined ? undefined : Number(x)));
    // The Z variant carries an extra z before the facing.
    const [x, y, face, scale, variation] = m[1] ? [v[0], v[1], v[3], v[4], v[5] ?? 0] : [v[0], v[1], v[2], v[3], v[4]];
    if (![x, y, face, scale].every(Number.isFinite)) continue;
    out.push({ id: m[2], x, y, angle: (face * Math.PI) / 180, scale, variation: variation | 0 });
  }
  return out;
}

export function parseW3x(buffer) {
  const mpq = openMpq(buffer);
  const need = (name) => {
    const d = mpq.read(name);
    if (!d) throw new Error(`w3x: missing ${name}`);
    return d;
  };
  const jass = mpq.read('scripts\\war3map.j') ?? mpq.read('war3map.j');
  return {
    terrain: parseW3e(need('war3map.w3e')),
    pathing: parseWpm(need('war3map.wpm')),
    doodads: parseDoo(need('war3map.doo')),
    rects: jass ? parseRects(jass.toString('latin1')) : {},
    scriptDestructables: jass ? parseScriptDestructables(jass.toString('latin1')) : [],
    info: parseW3i(need('war3map.w3i')),
  };
}
