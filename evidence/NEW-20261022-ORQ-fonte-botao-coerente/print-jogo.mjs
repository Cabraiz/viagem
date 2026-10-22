// Prints do menu no jogo real (vaga locks/browser-1|2, uma página por vez, DPR 2).
// uso: node print-jogo.mjs <url> <pasta-saida>
import {mkdirSync, rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
const [url, out] = process.argv.slice(2);
let vaga;
for (const v of ['browser-1', 'browser-2']) {
  try { mkdirSync(`D:/Gits/viagem-board/locks/${v}`); vaga = v; break; } catch {}
}
if (!vaga) throw new Error('as duas vagas de navegador estão ocupadas');
try {
  const browser = await chromium.launch();
  for (const [nome, width, height] of [['pc-1920x1080', 1920, 1080], ['celular-390x844', 390, 844]]) {
    const page = await browser.newPage({viewport: {width, height}, deviceScaleFactor: 2});
    await page.goto(url, {waitUntil: 'load', timeout: 60000});
    await page.waitForSelector('.estadio-confirmar', {state: 'visible', timeout: 60000});
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(2500);
    const fonte = await page.$eval('.estadio-confirmar-texto', e => [getComputedStyle(e).fontFamily, document.fonts.check(`400 40px "Lilita One"`, 'SELECIONAR')]);
    console.log(nome, fonte);
    await page.screenshot({path: `${out}/${nome}.png`});
    await page.locator('.estadio-confirmar').screenshot({path: `${out}/${nome}-botao.png`});
    await page.close();
  }
  await browser.close();
} finally {
  rmSync(`D:/Gits/viagem-board/locks/${vaga}`, {recursive: true, force: true});
}
