// The HUD's contrast over the real map (NEW-20261009-DSG-contraste-mapa, redone 23/10 for the snowy city): the HUD was
// approved over a blue mock, and on the light snow a light chip with a light edge vanishes. In a running match, for each
// visible HUD piece (HUD_PARTS): its body (background), its outer edge (the outermost hard ring: a `0 0 0 Npx` box-shadow,
// else the border) and the colour of each text inside it, read by the browser itself (a 1 px canvas fill, so color-mix
// and rgba come out as plain pixels). The map under it: the page printed again with everything but the game's canvas
// hidden, 8 points just outside the piece's edge. A piece fails when, at one of those points, BOTH its body and its edge
// are under 3:1 against the map (the "borda dupla" rule: light body + Breu edge reads on any ground), or when a text is
// under 4.5:1 against its own body (composited over the map when the body is see-through).
// Used by scripts/folha-prints.mjs (the hero standing in the solo match); the math below is node-only and tested.

/** The HUD pieces drawn over the map in a match: [selector, name on the sheet]. Every visible match is measured. */
export const HUD_PARTS = [
  ['.rh-round', 'onda'],
  ['.rh-xp-level', 'nível'],
  ['.rh-xp-track', 'barra de XP'],
  ['.rh-boss', 'chefe'],
  ['.rh-marquee', 'letreiro'],
  ['.rh-alert', 'alerta'],
  ['.rh-member-ring', 'retrato'],
  ['.rh-member-name', 'nome do retrato'],
  ['.rh-edge', 'seta da borda'],
  ['.rh-edge-tag', 'etiqueta da seta'],
  ['.rh-minimap', 'minimapa'],
  ['.rh-offer-chip', 'ficha da oferta'],
  ['.rh-cida-btn', 'botão da cidade'],
  ['.rh-camp-relogio', 'relógio'],
  ['.rh-camp-track', 'barra do acampamento'],
  ['.rh-killcam-tv', 'killcam'],
  ['.explore-stick', 'joystick'],
  ['.explore-notice', 'aviso do mapa'],
  ['[data-hud-contraste]', 'peça marcada'],
];
export const MIN_EDGE = 3, MIN_TEXT = 4.5, POINTS = 8;

/** sRGB channel 0–255 → linear. */
const lin = c => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
/** WCAG relative luminance of [r,g,b] (0–255). */
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG contrast ratio of two [r,g,b] colours, 1–21. */
export function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
/** [r,g,b,a] (a 0–255) painted over an opaque [r,g,b]. */
export function over(top, under) {
  const a = (top[3] ?? 255) / 255;
  return [0, 1, 2].map(i => Math.round(top[i] * a + under[i] * (1 - a)));
}
const hex = c => '#' + c.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
const fix = n => n.toFixed(1).replace('.', ',');

/**
 * One piece against the map points under it. part: {name, body:[r,g,b,a], edge:[r,g,b,a]|null, texts:[{text, color,
 * layers:[[r,g,b,a]…] (the backgrounds from the piece's body down to the text's own, outermost first)}]}; bg: [[r,g,b]…].
 * → {fails:[string], worstEdge, worstText}: worstEdge is the best of body/edge at the worst point.
 */
export function judge(part, bg) {
  const fails = [];
  let worstEdge = Infinity, worstAt = null;
  for (const p of bg) {
    const body = over(part.body, p);
    // A see-through body (alpha < 0.5) is the map itself: only its edge separates it.
    const vs = [part.body[3] >= 128 ? ratio(body, p) : 1, part.edge && part.edge[3] >= 128 ? ratio(over(part.edge, body), p) : 1];
    const best = Math.max(...vs);
    if (best < worstEdge) { worstEdge = best; worstAt = p; }
  }
  if (bg.length && worstEdge < MIN_EDGE)
    fails.push(`${part.name}: corpo ${hex(part.body)} e contorno ${part.edge ? hex(part.edge) : 'nenhum'} com ${fix(worstEdge)}:1 sobre o mapa ${hex(worstAt)} (mín. ${MIN_EDGE}:1)`);
  let worstText = Infinity;
  for (const t of part.texts ?? []) {
    let low = Infinity, lowBg = null;
    for (const p of bg.length ? bg : [[255, 255, 255]]) {
      const under = [part.body, ...t.layers].reduce((acc, layer) => over(layer, acc), p);
      const r = ratio(over(t.color, under), under);
      if (r < low) { low = r; lowBg = under; }
    }
    worstText = Math.min(worstText, low);
    if (low < MIN_TEXT) fails.push(`${part.name}: texto "${t.text.slice(0, 24)}" ${hex(t.color)} com ${fix(low)}:1 sobre ${hex(lowBg)} (mín. ${MIN_TEXT}:1)`);
  }
  return { fails, worstEdge, worstText };
}

/** 8 points just outside a rect (pad px out), corners and edge middles, inside the viewport. */
export function ringPoints(r, pad, w, h) {
  const xs = [r.left - pad, r.left + r.width / 2, r.right + pad], ys = [r.top - pad, r.top + r.height / 2, r.bottom + pad];
  const pts = [];
  for (const y of ys) for (const x of xs) if (!(x === xs[1] && y === ys[1])) pts.push([Math.round(x), Math.round(y)]);
  return pts.filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h);
}

/**
 * In the page: every visible HUD piece with its colours, read as pixels (a 1×1 canvas fill of the computed colour).
 * arg: HUD_PARTS. → [{name, rect:{left,top,right,bottom,width,height}, pad, body, edge, texts}].
 */
export const COLLECT = parts => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const px = css => { if (!css || css === 'transparent') return [0, 0, 0, 0]; cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = css; cx.fillRect(0, 0, 1, 1); return [...cx.getImageData(0, 0, 1, 1).data]; };
  const shown = el => { if (el.closest('[hidden]') || !el.getClientRects().length) return false; for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) return false; } return true; };
  // Hard rings: `color 0px 0px 0px Npx` parts of the computed box-shadow (not inset); the widest is the outer edge.
  const rings = sh => (sh && sh !== 'none' ? sh.split(/,(?![^(]*\))/) : []).filter(s => !/inset/.test(s)).map(s => {
    const color = (s.match(/(rgba?\([^)]*\)|color\([^)]*\)|#[0-9a-f]+)/i) || [])[0];
    const n = (s.replace(color ?? '', '').match(/-?[\d.]+px/g) || []).map(parseFloat);
    return n.length === 4 && n[0] === 0 && n[1] === 0 && n[2] === 0 && n[3] > 0 ? { color, spread: n[3] } : null;
  }).filter(Boolean).sort((a, b) => b.spread - a.spread);
  const out = [], seen = new Set();
  for (const [sel, name] of parts) for (const el of document.querySelectorAll(sel)) {
    if (seen.has(el) || !shown(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const ring = rings(s.boxShadow)[0], bw = parseFloat(s.borderTopWidth) || 0;
    const edge = ring ? px(ring.color) : bw >= 1 ? px(s.borderTopColor) : null;
    const texts = [];
    const walk = node => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3 && c.textContent.trim()) {
          const host = c.parentElement; if (!shown(host)) continue;
          const layers = []; for (let e = host; e && e !== el; e = e.parentElement) { const b = px(getComputedStyle(e).backgroundColor); if (b[3]) layers.unshift(b); }
          texts.push({ text: c.textContent.trim(), color: px(getComputedStyle(host).color), layers });
        } else if (c.nodeType === 1) walk(c);
      }
    };
    walk(el);
    out.push({ name, sel, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }, pad: (ring?.spread ?? 0) + 3, body: px(s.backgroundColor), edge, texts: texts.slice(0, 6) });
  }
  return out;
};
/** In the page: the HUD hidden (only the game's canvas drawn) or back. */
export const HIDE_HUD = on => {
  let st = document.getElementById('folha-contraste-esconde');
  if (!on) { st?.remove(); return; }
  if (!st) { st = document.createElement('style'); st.id = 'folha-contraste-esconde'; st.textContent = 'body *{visibility:hidden!important}canvas{visibility:visible!important}'; document.head.append(st); }
};
/** In the page: the pixels of a PNG (base64) at the given points → [[r,g,b]…]. */
export const PIXELS = async ([b64, pts]) => {
  const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  return pts.map(([x, y]) => [...cx.getImageData(x, y, 1, 1).data].slice(0, 3));
};

/**
 * Measures the HUD of a Playwright page now: → {parts:[{name, worstEdge, worstText, fails}], fails:[string]}.
 * The map is printed with the HUD hidden right after the colours are read (the camera barely moves in that time).
 */
export async function measure(p) {
  const vp = p.viewportSize();
  const parts = await p.evaluate(COLLECT, HUD_PARTS);
  if (!parts.length) return { parts: [], fails: [] };
  await p.evaluate(HIDE_HUD, true);
  let png;
  try { png = await p.screenshot({ type: 'png', timeout: 30000 }); } finally { await p.evaluate(HIDE_HUD, false).catch(() => {}); }
  const pts = parts.map(part => ringPoints(part.rect, part.pad, vp.width, vp.height));
  const flat = await p.evaluate(PIXELS, [png.toString('base64'), pts.flat()]);
  let k = 0;
  const res = parts.map((part, i) => { const bg = flat.slice(k, k += pts[i].length); return { name: part.name, ...judge(part, bg) }; });
  return { parts: res.map(r => ({ name: r.name, worstEdge: +r.worstEdge.toFixed(2), worstText: Number.isFinite(r.worstText) ? +r.worstText.toFixed(2) : null, fails: r.fails })), fails: [...new Set(res.flatMap(r => r.fails))] };
}
