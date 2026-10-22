// Print da folha.html (vaga locks/browser-1|2, DPR 1, uma página). uso: node print-folha.mjs <folha.html> <saida.png>
import {mkdirSync, rmSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {chromium} = await import(pathToFileURL('D:/Gits/viagem-tools/node_modules/playwright/index.mjs').href);
const [html, png] = process.argv.slice(2);
let vaga;
for (const v of ['browser-1', 'browser-2']) {
  try { mkdirSync(`D:/Gits/viagem-board/locks/${v}`); vaga = v; break; } catch {}
}
if (!vaga) throw new Error('as duas vagas de navegador estão ocupadas');
try {
  const browser = await chromium.launch({args: ['--allow-file-access-from-files']});
  const page = await browser.newPage({viewport: {width: 2608, height: 800}, deviceScaleFactor: 1});
  await page.goto(pathToFileURL(html).href, {waitUntil: 'load'});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({path: png, fullPage: true});
  await browser.close();
} finally {
  rmSync(`D:/Gits/viagem-board/locks/${vaga}`, {recursive: true, force: true});
}
