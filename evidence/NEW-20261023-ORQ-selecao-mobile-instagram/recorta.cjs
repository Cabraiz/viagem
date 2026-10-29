// Splits Codex sheets into cells by finding near-white gutters; writes recorte/<name>-<i>.png
const sharp = require('D:/Gits/viagem/node_modules/sharp');
const path = require('path');
const dir = path.join(__dirname, 'gerar');
const white = (d, i) => d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235;
function runs(prof, thr, minLen) {
  const out = []; let s = -1;
  for (let i = 0; i <= prof.length; i++) {
    const on = i < prof.length && prof[i] < thr;
    if (on && s < 0) s = i;
    if (!on && s >= 0) { if (i - s >= minLen) out.push([s, i]); s = -1; }
  }
  return out;
}
async function split(name) {
  const f = path.join(dir, name + '.png');
  const { data, info } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const col = new Array(w).fill(0), row = new Array(h).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!white(data, (y * w + x) * 3)) { col[x]++; row[y]++; }
  }
  const xs = runs(col.map(v => 1 - v / h), 0.6, 60), ys = runs(row.map(v => 1 - v / w), 0.6, 60);
  const cells = [];
  for (const [y0, y1] of ys) for (const [x0, x1] of xs) cells.push({ left: x0 + 3, top: y0 + 3, width: x1 - x0 - 6, height: y1 - y0 - 6 });
  let i = 0;
  for (const c of cells) {
    i++;
    await sharp(f).extract(c).png().toFile(path.join(dir, 'recorte', `${name}-${i}.png`));
  }
  console.log(name, cells.map(c => `${c.width}x${c.height}@${c.left},${c.top}`).join(' '));
}
(async () => { for (const n of process.argv.slice(2)) await split(n); })();
