// Prints do menu (vaga locks/browser-1|2): título → fileira → botão, por personagem e tela, com as medidas.
// uso: node print.mjs <url> <pasta-saida> <prefixo> [dpr]
import {mkdirSync, rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
const [url, out, pre, dpr = '1'] = process.argv.slice(2);
const telas = process.env.TELAS ? JSON.parse(process.env.TELAS) : [[1920, 1000]];
const herois = process.env.HEROIS ? process.env.HEROIS.split(',') : ['viciado-em-bet', 'clt-cansado', 'mendigo'];
let vaga;
for (const v of ['browser-1', 'browser-2']) { try { mkdirSync(`D:/Gits/viagem-board/locks/${v}`); vaga = v; break; } catch {} }
if (!vaga) throw new Error('as duas vagas de navegador estão ocupadas');
try {
  const browser = await chromium.launch();
  for (const [width, height] of telas) {
    const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: +dpr});
    await page.goto(url, {waitUntil: 'load', timeout: 60000});
    await page.waitForSelector('.estadio-confirmar', {state: 'visible', timeout: 60000});
    await page.evaluate(() => document.fonts.ready);
    for (const h of herois) {
      await page.click(`.class-card[data-hero="${h}"]`);
      await page.waitForTimeout(1800);
      const m = await page.evaluate(() => {
        const box = s => { const e = [...document.querySelectorAll(s)].find(e => e.offsetParent); if (!e) return null; const r = e.getBoundingClientRect(); return [r.top, r.bottom, r.left, r.right].map(Math.round); };
        const t = document.querySelector('.estadio-titulo'), sign = t.classList.contains('com-letreiro');
        return {letreiro: sign, titulo: box(sign ? '.estadio-letreiro' : '.estadio-titulo'), classe: box('.estadio-classe'), fileira: box('.estadio-fileira'), botao: box('.estadio-confirmar')};
      });
      const above = (m.classe ?? m.titulo)[1];
      console.log(`${width}x${height} ${h}`, JSON.stringify(m), 'vão título→fileira', m.fileira[0] - above, 'fileira→botão', m.botao[0] - m.fileira[1], 'folga embaixo', height - m.botao[1]);
      await page.screenshot({path: `${out}/${pre}-${h}-${width}x${height}.png`});
    }
    await page.close();
  }
  await browser.close();
} finally { rmSync(`D:/Gits/viagem-board/locks/${vaga}`, {recursive: true, force: true}); }
