// Prints of the phone's profile screen (etapa 4) at DPR 2, side by side with the user's reference scaled to the same
// card width and top, with guide lines at the reference's bands (card px of 734x1415).
//   node print.cjs <url> <saida-prefixo> [WxH ...] [--hero id] [--locked] [--nome]
// Takes the browser slot (viagem-board/locks/browser-1 or -2) and frees it at the end.
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const [url, prefix, ...rest] = process.argv.slice(2);
const sizes = rest.filter(a => /^\d+x\d+$/.test(a)).map(s => s.split('x').map(Number));
const hero = rest.includes('--hero') ? rest[rest.indexOf('--hero') + 1] : undefined;
const nome = rest.includes('--nome');
const REF = path.join(__dirname, 'referencia-usuario.jpg');
const CARD = { left: 221, top: 517, width: 734, height: 1415 };
const BANDS = [17, 135, 151, 366, 377, 397, 418, 441, 458, 778, 782, 852, 880, 955, 967, 1232, 1251, 1373];

function slot() {
  for (const n of [1, 2]) { const dir = `D:/Gits/viagem-board/locks/browser-${n}`; try { fs.mkdirSync(dir); return dir; } catch {} }
  throw new Error('sem vaga de navegador');
}

(async () => {
  const lock = slot();
  const browser = await chromium.launch();
  try {
    for (const [w, h] of sizes.length ? sizes : [[390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      if (hero) await page.addInitScript(id => localStorage.setItem('viagem:hero:v1', JSON.stringify({ version: 1, classId: id, name: 'Teste', color: '#75b8a6' })), hero);
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      if (hero) await page.evaluate(id => document.querySelector(`.insta-story[data-hero="${id}"]`)?.click(), hero);
      if (nome) await page.click('#confirm');
      await page.waitForTimeout(1500);
      await page.evaluate(() => document.fonts.ready);
      const info = await page.evaluate(() => {
        const col = document.querySelector('.insta-topo').getBoundingClientRect();
        return { top: col.top, left: col.left, width: col.width, scroll: document.scrollingElement.scrollHeight - innerHeight,
          u: parseFloat(getComputedStyle(document.querySelector('.estadio-escolha')).getPropertyValue('--u')) };
      });
      const shot = `${prefix}-${w}x${h}.png`;
      await page.screenshot({ path: shot });
      await page.close();
      // The reference card scaled to the column's width (734 card px = col.width CSS px), its top on the column's top.
      const k = info.width * 2 / CARD.width, refW = Math.round(CARD.width * k), refH = Math.round(CARD.height * k);
      const ref = await sharp(REF).extract(CARD).resize(refW, refH).toBuffer();
      const H = h * 2, W = w * 2, gap = 24, top = Math.round(info.top * 2), left = Math.round(info.left * 2);
      const lines = BANDS.map(y => `<line x1="0" x2="${W * 2 + gap}" y1="${top + y * k}" y2="${top + y * k}" stroke="#ff2d55" stroke-width="1" stroke-opacity=".55"/>`).join('');
      const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2 + gap}" height="${H}">${lines}</svg>`);
      await sharp({ create: { width: W * 2 + gap, height: H, channels: 4, background: '#2a2638' } })
        .composite([{ input: ref, left, top: Math.max(0, top) }, { input: shot, left: W + gap, top: 0 }, { input: svg, left: 0, top: 0 }])
        .png().toFile(`${prefix}-${w}x${h}-lado-a-lado.png`);
      console.log(JSON.stringify({ w, h, ...info }));
    }
  } finally { await browser.close(); fs.rmSync(lock, { recursive: true, force: true }); }
})();
