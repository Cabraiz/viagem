// site-textos-404-sobre (NEW-20261029-ORQ-site-textos-404-sobre): the site around the game. The 404 sends a mistyped
// room link into the room, /sobre/ has the contact, the head and the manifest say what is true today, and the iOS
// home screen shortcut has its name, status bar and startup screens.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import sharp from 'sharp';
import {formatRoomCode,inviteCode,isRoomCode} from '../../src/client/ui/invite.ts';
import {PERSONAGENS_LIBERADOS} from '../../src/rules/personagens-liberados.ts';
import {splashes} from '../../scripts/ios-splash.mjs';

const page404=fs.readFileSync('public/404.html','utf8');
const sobre=fs.readFileSync('public/sobre/index.html','utf8');
const index=fs.readFileSync('index.html','utf8');
const manifest=JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));
const EMAIL='contact@cabraiz.com';

/** Runs the 404's inline script at a URL; the address it goes to, or null when it stays on the page. */
function from404(url:string){
  const script=page404.match(/<script>([\s\S]*?)<\/script>/)![1];
  const {pathname,search}=new URL(url,'https://viagem.cyou');
  let went:string|null=null;
  vm.runInNewContext(script,{location:{pathname,search,replace:(to:string)=>{went=to;}}});
  return went;
}

test('404: a mistyped room link opens the room the main page reads', () => {
  for (const url of ['/3103-A23-B68','/3103a23b68','/sala/3103-A23-B68','/s/3103.a23.b68/','/3103%E2%80%93A23%E2%80%93B68','/x?sala=3103-a23-b68','/entrar?c=3103A23B68']) {
    const went=from404(url);
    assert.equal(went,'/?sala=3103A23B68',url);
    assert.equal(inviteCode(new URL(went!,'https://viagem.cyou').search),'3103A23B68',url);
  }
  assert.ok(isRoomCode('3103A23B68'));
  assert.equal(formatRoomCode('3103A23B68'),'3103-A23-B68');
});

test('404: old addresses go to the pages; anything else stays on the 404', () => {
  assert.equal(from404('/contato'),'/sobre/');
  assert.equal(from404('/About/'),'/sobre/');
  assert.equal(from404('/privacy.html'),'/privacidade/');
  for (const url of ['/nada','/3103-A23','/3103A23B68FF','/assets/velho-abc123.js','/']) assert.equal(from404(url),null,url);
});

test('404: short, pt and en, the logo, a way into the game, not indexed', () => {
  assert.match(page404,/<html lang="pt-BR">/);
  assert.match(page404,/<meta name="robots" content="noindex">/);
  assert.match(page404,/<img src="\/icon-192\.png"[^>]* alt="[^"]+"/);
  assert.match(page404,/<a class="ir" href="\/">Ir para o viagem<\/a>/);
  assert.match(page404,/<section class="en" lang="en">[\s\S]*Page not found[\s\S]*<a href="\/">Go to viagem<\/a>/);
  // GitHub Pages serves it at any depth: nothing relative.
  for (const [,url] of page404.matchAll(/(?:src|href)="([^"]*)"/g)) assert.match(url,/^\//,url);
  assert.doesNotMatch(page404,/style="/);
});

test('/sobre/: what the game is, who makes it, the contact e-mail, the privacy policy', () => {
  assert.match(sobre,/<link rel="canonical" href="https:\/\/viagem\.cyou\/sobre\/">/);
  assert.match(sobre,new RegExp(`<a href="mailto:${EMAIL}">${EMAIL}</a>`));
  assert.match(sobre,/desenvolvedor independente/);
  assert.match(sobre,/<a href="\/privacidade\/">Política de Privacidade<\/a>/);
  assert.match(sobre,/<article class="panel" id="english" lang="en">[\s\S]*independent developer[\s\S]*mailto:contact@cabraiz\.com/);
  assert.match(sobre,/<a class="back" href="\/">/);
  assert.match(sobre,/<meta property="og:url" content="https:\/\/viagem\.cyou\/sobre\/">/);
  assert.doesNotMatch(sobre,/<script/);
});

test('/sobre/: linked from the menu footer, next to the privacy policy', () => {
  const menu=fs.readFileSync('src/main.ts','utf8');
  assert.match(menu,/<nav class="menu-rodape" aria-label="[^"]+"><a class="menu-privacidade" href="\/privacidade\/">Privacidade<\/a><a class="menu-sobre" href="\/sobre\/">Sobre<\/a><\/nav>/);
});

test('privacy pages: /sobre/ in the footer and the sitemap, og and twitter in the head', () => {
  for(const dir of ['privacidade','privacy','privacy/ja']){
    const html=fs.readFileSync(`public/${dir}/index.html`,'utf8');
    assert.match(html,/<a class="back" href="\/sobre\/">/,dir);
    assert.match(html,new RegExp(`<meta property="og:url" content="https://viagem\.cyou/${dir}/">`),dir);
    assert.match(html,/<meta property="og:title" content="viagem · [^"]+">/,dir);
    assert.match(html,/<meta property="og:image" content="https:\/\/viagem\.cyou\/og\.jpg\?v=2c">/,dir);
    assert.match(html,/<meta name="twitter:card" content="summary_large_image">/,dir);
  }
  assert.match(fs.readFileSync('public/privacidade/index.html','utf8'),/<meta property="og:locale" content="pt_BR">/);
  assert.match(fs.readFileSync('public/sitemap.xml','utf8'),/<loc>https:\/\/viagem\.cyou\/sobre\/<\/loc>/);
});

test('head and manifest: the number of heroes is the open ones', () => {
  const six=['','one','two','three','four','five','six','seven','eight'][PERSONAGENS_LIBERADOS.length];
  const description=index.match(/<meta name="description" content="([^"]*)"/)![1];
  assert.match(description,new RegExp(`as one of ${six} city characters`));
  assert.equal(manifest.description,description);
  assert.match(index,new RegExp(`the ${six} open heroes \\(rules/personagens-liberados\\.ts`));
  assert.doesNotMatch(index+JSON.stringify(manifest),/tired office worker or a hungry cat|three open heroes/);
});

test('manifest: id, lang, categories and two real screenshots', async () => {
  assert.equal(manifest.id,'/');
  assert.equal(manifest.lang,'pt-BR');
  assert.deepEqual(manifest.categories,['games']);
  assert.deepEqual(manifest.screenshots.map((s:{form_factor:string})=>s.form_factor),['narrow','wide']);
  for (const shot of manifest.screenshots) {
    const {width,height,format}=await sharp(`public${shot.src}`).metadata();
    assert.equal(`${width}x${height}`,shot.sizes,shot.src);
    assert.equal(`image/${format}`,shot.type,shot.src);
    assert.ok(shot.label,shot.src);
  }
});

test('iOS: home screen name, status bar and a startup screen per iPhone size', async () => {
  assert.match(index,/<meta name="apple-mobile-web-app-title" content="viagem" \/>/);
  assert.match(index,/<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" \/>/);
  assert.match(index,/<meta name="apple-mobile-web-app-capable" content="yes" \/>/);
  const links=[...index.matchAll(/<link rel="apple-touch-startup-image" href="([^"]*)" media="([^"]*)" \/>/g)].map(([,href,media])=>({href,media}));
  const expected=splashes();
  assert.deepEqual(links,expected.map(({href,media})=>({href,media})),'node scripts/ios-splash.mjs');
  for (const {href,width,height} of expected) {
    const meta=await sharp(`public${href}`).metadata();
    assert.deepEqual([meta.width,meta.height,meta.format],[width,height,'png'],href);
  }
  assert.ok(expected.some((s)=>s.media.includes('device-width: 390px') && s.media.includes('portrait')));
});
