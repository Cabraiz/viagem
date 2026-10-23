// Contact sheet: per character 4 circular profile options + 3 square grid photos; icons row at the bottom
const sharp = require('D:/Gits/viagem/node_modules/sharp');
const path = require('path');
const R = path.join(__dirname, 'gerar', 'recorte');
const chars = ['viciado', 'clt', 'gato', 'maromba'];
const pick = { viciado: 1, clt: 1, gato: 1, maromba: 4 };
const ring = Buffer.from(`<svg width="${230+16}" height="${230+16}"><circle cx="${123}" cy="${123}" r="${119}" fill="none" stroke="#3cff7a" stroke-width="8"/></svg>`);
const C = 230, S = 230, G = 20, LBL = 200, ROW = C + 50;
const W = LBL + 4 * (C + G) + 30 + 3 * (S + G), H = chars.length * ROW + 330;
const circle = Buffer.from(`<svg width="${C}" height="${C}"><circle cx="${C/2}" cy="${C/2}" r="${C/2}" fill="#fff"/></svg>`);
const txt = (s, w, h, size = 28, anchor = 'start') => Buffer.from(`<svg width="${w}" height="${h}"><text x="${anchor === 'middle' ? w/2 : 4}" y="${h - 10}" font-family="Arial" font-weight="bold" font-size="${size}" fill="#fff" text-anchor="${anchor}">${s}</text></svg>`);
async function sq(f, size) {
  const m = await sharp(f).metadata(); const s = Math.min(m.width, m.height);
  return sharp(f).extract({ left: Math.floor((m.width - s) / 2), top: Math.floor((m.height - s) / 2), width: s, height: s }).resize(size, size).png().toBuffer();
}
(async () => {
  const comp = [];
  for (const [r, n] of chars.entries()) {
    const y = 20 + r * ROW;
    comp.push({ input: txt('@' + n.toUpperCase(), LBL, 60, 30), left: 10, top: y + C / 2 - 30 });
    for (let i = 1; i <= 4; i++) {
      const b = await sharp(await sq(path.join(R, `perfil-${n}-${i}.png`), C)).composite([{ input: circle, blend: 'dest-in' }]).png().toBuffer();
      const x = LBL + (i - 1) * (C + G);
      if (pick[n] === i) comp.push({ input: ring, left: x - 8, top: y - 8 });
      comp.push({ input: b, left: x, top: y }, { input: txt(pick[n] === i ? i + ' ✔ escolhida' : String(i), C, 44, 30, 'middle'), left: x, top: y + C });
    }
    for (let i = 1; i <= 3; i++) comp.push({ input: await sq(path.join(R, `grade-${n}-${i}.png`), S), left: LBL + 4 * (C + G) + 30 + (i - 1) * (S + G), top: y });
  }
  const icf = path.join(__dirname, 'gerar', 'icones.png');
  for (let k = 0; k < 2; k++) {
    const half = await sharp(icf).extract({ left: 0, top: k * 512, width: 1536, height: 512 }).resize(null, 290).png().toBuffer();
    comp.push({ input: half, left: 20 + k * ((W - 40) / 2 + 10) | 0, top: H - 310 });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#2a2238' } }).composite(comp).png().toFile(path.join(__dirname, 'folha-contato.png'));
  console.log(W, H);
})();
