// Minimal read-only MPQ (v0, as used by Warcraft III .w3x maps) reader.
// Port of design/w3x-ref/scripts/mpqread.py with bounds checks everywhere:
// corrupt input throws an Error and never hangs. Zero dependencies.
import { inflateSync } from 'node:zlib';

// ---- crypto ----
const CT = (() => {
  const t = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) {
    for (let k = 0, idx = i; k < 5; k++, idx += 0x100) {
      seed = (seed * 125 + 3) % 0x2aaaab;
      const a = (seed & 0xffff) << 16;
      seed = (seed * 125 + 3) % 0x2aaaab;
      t[idx] = (a | (seed & 0xffff)) >>> 0;
    }
  }
  return t;
})();

/** MPQ string hash. Names are latin1 bytes; only ASCII a-z is uppercased and '/' maps to '\'. */
export function hashString(name, type) {
  let s1 = 0x7fed7fed, s2 = 0xeeeeeeee;
  for (let i = 0; i < name.length; i++) {
    let c = name.charCodeAt(i) & 0xff;
    if (c >= 0x61 && c <= 0x7a) c -= 0x20;
    else if (c === 0x2f) c = 0x5c;
    s1 = (CT[(type << 8) + c] ^ (s1 + s2)) >>> 0;
    s2 = (c + s1 + s2 + (s2 << 5) + 3) >>> 0;
  }
  return s1;
}

/** Decrypts whole 32-bit words of `src` (a copy is returned; trailing bytes are kept as-is). */
function decrypt(src, key) {
  const out = Buffer.from(src);
  let s2 = 0xeeeeeeee;
  for (let p = 0; p + 4 <= out.length; p += 4) {
    s2 = (s2 + CT[0x400 + (key & 0xff)]) >>> 0;
    const r = (out.readUInt32LE(p) ^ (key + s2)) >>> 0;
    out.writeUInt32LE(r, p);
    key = (((~key << 0x15) + 0x11111111) | (key >>> 0x0b)) >>> 0;
    s2 = (r + s2 + (s2 << 5) + 3) >>> 0;
  }
  return out;
}

// ---- PKWARE DCL explode (port of zlib contrib/blast/blast.c) ----
function construct(rep) {
  const length = [];
  for (const b of rep) for (let n = (b >> 4) + 1; n > 0; n--) length.push(b & 15);
  const count = new Uint16Array(14), offs = new Uint16Array(14), symbol = new Uint16Array(length.length);
  for (const l of length) count[l]++;
  for (let i = 1; i < 13; i++) offs[i + 1] = offs[i] + count[i];
  length.forEach((l, s) => { if (l) symbol[offs[l]++] = s; });
  return { count, symbol };
}
const LITCODE = construct([11, 124, 8, 7, 28, 7, 188, 13, 76, 4, 10, 8, 12, 10, 12, 10, 8, 23, 8, 9, 7, 6, 7, 8, 7, 6, 55, 8, 23, 24, 12, 11, 7, 9, 11, 12, 6, 7, 22, 5, 7, 24, 6, 11, 9, 6, 7, 22, 7, 11, 38, 7, 9, 8, 25, 11, 8, 11, 9, 12, 8, 12, 5, 38, 5, 38, 5, 11, 7, 5, 6, 21, 6, 10, 53, 8, 7, 24, 10, 27, 44, 253, 253, 253, 252, 252, 252, 13, 12, 45, 12, 45, 12, 61, 12, 45, 44, 173]);
const LENCODE = construct([2, 35, 36, 53, 38, 23]);
const DISTCODE = construct([2, 20, 53, 230, 247, 151, 248]);
const LEN_BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Largest file the reader will unpack; war3map files are a few MB at most. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

/** Decompresses a PKWARE "imploded" stream; output is capped at `maxOut` bytes. */
export function explode(buf, maxOut) {
  let pos = 0, bitbuf = 0, bitcnt = 0;
  const next = () => {
    if (pos >= buf.length) throw new Error('explode: unexpected end of input');
    return buf[pos++];
  };
  const bits = (need) => {
    let val = bitbuf;
    while (bitcnt < need) { val |= next() << bitcnt; bitcnt += 8; }
    bitbuf = val >>> need;
    bitcnt -= need;
    return val & ((1 << need) - 1);
  };
  const decode = ({ count, symbol }) => {
    let code = 0, first = 0, index = 0, len = 1;
    let bb = bitbuf, left = bitcnt;
    for (;;) {
      while (left) {
        code |= (bb & 1) ^ 1; // codes are stored bit-inverted
        bb >>>= 1;
        const c = count[len];
        if (code < first + c) {
          bitbuf = bb;
          bitcnt = (bitcnt - len) & 7;
          return symbol[index + (code - first)];
        }
        index += c; first = (first + c) << 1; code <<= 1; len++; left--;
      }
      left = 14 - len; // MAXBITS + 1 - len
      if (left <= 0) throw new Error('explode: invalid code');
      bb = next();
      if (left > 8) left = 8;
    }
  };
  const lit = bits(8), dict = bits(8);
  if (lit > 1 || dict < 4 || dict > 6) throw new Error('explode: bad header');
  const out = Buffer.alloc(maxOut);
  let n = 0;
  while (n < maxOut) {
    if (bits(1)) {
      const sym = decode(LENCODE);
      const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
      if (len === 519) break; // end-of-stream code
      const dbits = len === 2 ? 2 : dict;
      const dist = (decode(DISTCODE) << dbits) + bits(dbits) + 1;
      if (dist > n) throw new Error('explode: distance too far back');
      for (let i = 0; i < len && n < maxOut; i++, n++) out[n] = out[n - dist];
    } else {
      out[n++] = lit ? decode(LITCODE) : bits(8);
    }
  }
  return out.subarray(0, n);
}

/** Multi-method sector decompression (first byte = compression mask). */
function decompress(d, maxOut, name) {
  if (d.length < 1) throw new Error(`mpq: empty compressed sector in ${name}`);
  const mask = d[0];
  if (mask & ~0x0a) {
    // Only zlib (0x02) and PKWARE (0x08) are needed by WC3 map data; bzip2 (0x10),
    // huffman (0x01), ADPCM (0x40/0x80), sparse (0x20) and LZMA (0x12) are not implemented.
    throw new Error(`mpq: unsupported compression mask 0x${mask.toString(16)} in ${name}`);
  }
  let out = d.subarray(1);
  try {
    if (mask & 0x08) out = explode(out, maxOut);
    if (mask & 0x02) out = inflateSync(out, { maxOutputLength: Math.max(maxOut, 1) });
  } catch (e) {
    throw new Error(`mpq: decompression (mask 0x${mask.toString(16)}) failed in ${name}: ${e.message}`);
  }
  return out;
}

// Names that maps usually contain but that (listfile) often omits.
export const KNOWN_NAMES = ['(listfile)', '(attributes)', '(signature)', 'war3map.w3i', 'war3map.w3e', 'war3map.doo', 'war3mapUnits.doo', 'war3map.w3r', 'war3map.w3c', 'war3map.wpm', 'war3map.shd', 'war3map.mmp', 'war3mapMap.blp', 'war3mapMap.tga', 'war3mapPreview.tga', 'war3map.j', 'scripts\\war3map.j', 'war3map.wts', 'war3map.w3u', 'war3map.w3t', 'war3map.w3a', 'war3map.w3b', 'war3map.w3d', 'war3map.w3h', 'war3map.w3q', 'war3map.imp', 'war3mapMisc.txt', 'war3mapSkin.txt', 'war3map.wtg', 'war3map.wct', 'war3map.lua', 'war3mapExtra.txt', 'war3map.w3s'];

const F_IMPLODE = 0x100, F_COMPRESS = 0x200, F_ENCRYPTED = 0x10000, F_FIX_KEY = 0x20000;
const F_SINGLE = 0x01000000, F_EXISTS = 0x80000000;

/**
 * Opens an MPQ archive held in memory.
 * @param {Uint8Array} input
 * @returns {{ read(name: string): Buffer|null, list(): string[] }}
 */
export function openMpq(input) {
  const f = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const slice = (start, len, what) => {
    if (!(start >= 0 && len >= 0 && start + len <= f.length)) throw new Error(`mpq: ${what} out of bounds`);
    return f.subarray(start, start + len);
  };

  // Header search on 512-byte boundaries, bounded by the buffer length.
  let base = -1;
  for (let off = 0; off + 32 <= f.length; off += 0x200) {
    if (f.readUInt32LE(off) === 0x1a51504d) { base = off; break; } // "MPQ\x1a"
    if (f.readUInt32LE(off) === 0x1b51504d) { // "MPQ\x1b" user-data header -> follow its offset
      const h = off + f.readUInt32LE(off + 8);
      if (h + 32 <= f.length && f.readUInt32LE(h) === 0x1a51504d) { base = h; break; }
    }
  }
  if (base < 0) throw new Error('mpq: archive header not found');
  const sshift = f.readUInt16LE(base + 14);
  if (sshift > 20) throw new Error(`mpq: bad sector shift ${sshift}`);
  const sector = 512 * 2 ** sshift;
  const hpos = f.readUInt32LE(base + 16), bpos = f.readUInt32LE(base + 20);
  const hcount = f.readUInt32LE(base + 24), bcount = f.readUInt32LE(base + 28);
  if (hcount === 0) throw new Error('mpq: empty hash table');
  const ht = decrypt(slice(base + hpos, hcount * 16, 'hash table'), hashString('(hash table)', 3));
  const bt = decrypt(slice(base + bpos, bcount * 16, 'block table'), hashString('(block table)', 3));

  const find = (name) => {
    const a = hashString(name, 1), b = hashString(name, 2), start = hashString(name, 0) % hcount;
    let i = start;
    do {
      const p = i * 16, block = ht.readUInt32LE(p + 12);
      if (block === 0xffffffff) return null; // empty slot ends the probe chain
      if (ht.readUInt32LE(p) === a && ht.readUInt32LE(p + 4) === b && block !== 0xfffffffe) return block;
      i = (i + 1) % hcount;
    } while (i !== start);
    return null;
  };

  const read = (name) => {
    const bi = find(name);
    if (bi === null || bi >= bcount) return null;
    const boff = bt.readUInt32LE(bi * 16), csize = bt.readUInt32LE(bi * 16 + 4);
    const fsize = bt.readUInt32LE(bi * 16 + 8), flags = bt.readUInt32LE(bi * 16 + 12);
    if (fsize > MAX_FILE_BYTES) throw new Error(`mpq: ${name} declares ${fsize} bytes (> ${MAX_FILE_BYTES})`);
    if (!(flags & F_EXISTS)) return null;
    const raw = slice(base + boff, csize, `data of ${name}`);
    let key = null;
    if (flags & F_ENCRYPTED) {
      key = hashString(name.replace(/\//g, '\\').split('\\').pop(), 3);
      if (flags & F_FIX_KEY) key = ((key + boff) ^ fsize) >>> 0;
    }
    const unpack = (s, want) => (flags & F_COMPRESS ? decompress(s, want, name) : explode(s, want));

    if (flags & F_SINGLE) {
      const d = key === null ? raw : decrypt(raw, key);
      const out = flags & (F_COMPRESS | F_IMPLODE) && csize < fsize ? unpack(d, fsize) : d.subarray(0, fsize);
      return Buffer.from(out);
    }
    const ns = Math.ceil(fsize / sector);
    if (!(flags & (F_COMPRESS | F_IMPLODE))) {
      if (csize < fsize) throw new Error(`mpq: truncated data of ${name}`);
      if (key === null) return Buffer.from(raw.subarray(0, fsize));
      const parts = [];
      for (let i = 0; i < ns; i++) parts.push(decrypt(raw.subarray(i * sector, (i + 1) * sector), (key + i) >>> 0));
      return Buffer.concat(parts).subarray(0, fsize);
    }
    if ((ns + 1) * 4 > raw.length) throw new Error(`mpq: sector table of ${name} out of bounds`);
    let tbl = raw.subarray(0, (ns + 1) * 4);
    if (key !== null) tbl = decrypt(tbl, (key - 1) >>> 0);
    const out = Buffer.alloc(fsize);
    let n = 0;
    for (let i = 0; i < ns; i++) {
      const a = tbl.readUInt32LE(i * 4), b = tbl.readUInt32LE(i * 4 + 4);
      if (a > b || b > raw.length) throw new Error(`mpq: sector ${i} of ${name} out of bounds`);
      let s = raw.subarray(a, b);
      if (key !== null) s = decrypt(s, (key + i) >>> 0);
      const want = Math.min(sector, fsize - i * sector);
      if (s.length < want) s = unpack(s, want);
      n += s.copy(out, n, 0, Math.min(s.length, fsize - n));
    }
    if (n !== fsize) throw new Error(`mpq: ${name} decompressed to ${n} of ${fsize} bytes`);
    return out;
  };

  // Known names + (listfile) entries that resolve, deduplicated by their hashed form.
  const list = () => {
    const lf = read('(listfile)');
    const extra = lf ? lf.toString('latin1').split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
    const seen = new Set(), names = [];
    for (const n of [...KNOWN_NAMES, ...extra]) {
      const k = n.replace(/[a-z]/g, (c) => c.toUpperCase()).replace(/\//g, '\\');
      if (seen.has(k) || find(n) === null) continue;
      seen.add(k);
      names.push(n);
    }
    return names;
  };

  return { read, list };
}
