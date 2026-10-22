// Prints do botão SELECIONAR (vaga locks/browser-1|2, DPR 2) + vão entre letras medido pelo canvas.
// uso: node print.mjs <url> <pasta-saida> <prefixo>
import {mkdirSync, rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
const [url, out, pre] = process.argv.slice(2);
let vaga;
for (const v of ['browser-1', 'browser-2']) { try { mkdirSync(`D:/Gits/viagem-board/locks/${v}`); vaga = v; break; } catch {} }
if (!vaga) throw new Error('as duas vagas de navegador estão ocupadas');
try {
  const browser = await chromium.launch();
  for (const [nome, width, height] of [['pc-1920x1080', 1920, 1080], ['celular-390x844', 390, 844]]) {
    const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 2});
    await page.goto(url, {waitUntil: 'load', timeout: 60000});
    await page.waitForSelector('.estadio-confirmar', {state: 'visible', timeout: 60000});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2500);
    const m = await page.$eval('.estadio-confirmar-texto', e => {
      const cs = getComputedStyle(e), px = parseFloat(cs.fontSize), ls = parseFloat(cs.letterSpacing) || 0;
      const ctx = document.createElement('canvas').getContext('2d'); ctx.font = `400 ${px}px "Lilita One"`;
      const t = 'SELECIONAR'; let x = 0; const box = [];
      for (let i = 0; i < t.length; i++) {
        const mm = ctx.measureText(t[i]);
        const pre = i ? ctx.measureText(t.slice(0, i)).width : 0; // kerned advance
        box.push([pre + i * ls - mm.actualBoundingBoxLeft, pre + i * ls + mm.actualBoundingBoxRight]);
      }
      const gaps = box.slice(1).map((b, i) => b[0] - box[i][1]);
      const r = e.getBoundingClientRect(), b = e.parentElement.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(e); const ink = range.getBoundingClientRect();
      return {px, ls, gapMedio: gaps.reduce((a, g) => a + g, 0) / gaps.length, gaps: gaps.map(g => +g.toFixed(1)),
        span: [r.left, r.right], texto: [ink.left, ink.right, ink.top, ink.bottom], botao: [b.left, b.right, b.top, b.bottom]};
    });
    console.log(nome, JSON.stringify(m));
    await page.locator('.estadio-confirmar').screenshot({path: `${out}/${pre}-${nome}-botao.png`});
    await page.close();
  }
  await browser.close();
} finally { rmSync(`D:/Gits/viagem-board/locks/${vaga}`, {recursive: true, force: true}); }
