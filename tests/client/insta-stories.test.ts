import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {INSTA_ART, INSTA_PERFIS, INSTA_STORIES, perfilHtml, perfilUrl, storiesDe, storiesTelaHtml, storyUrl} from '../../src/client/ui/insta.ts';
import {SEGURAR_MS, STORY_MS, toqueOf, VOLTAR_LADO} from '../../src/client/ui/insta-stories.ts';

// NEW-20261023-ORQ-insta-stories-4-herois: the profile photo opens the hero's stories, like Instagram. The art's
// choices: viagem-board/evidence/<ID>/README.md; prints and video of the viewer there too.
const css=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const pub=(url:string)=>new URL(`../../public${url}`,import.meta.url);

test('each of the four heroes has 3-4 stories with a short sticker, their art in WebP + lite',()=>{
  assert.deepEqual(Object.keys(INSTA_STORIES),INSTA_PERFIS.map(p=>p.id));
  for(const p of INSTA_PERFIS){
    const lista=storiesDe(p.id);
    assert.ok(lista.length>=3&&lista.length<=4,`${p.id}: ${lista.length}`);
    for(const [k,s] of lista.entries()){
      assert.ok(s.legenda.length<=42,`${p.id}: "${s.legenda}" fits the sticker`);
      assert.match(s.quando,/^\d+ (h|min)$/);
      const url=storyUrl(p.id,k);
      assert.equal(url,`${INSTA_ART}story-${p.id}-${k+1}.webp`);
      assert.ok(existsSync(pub(url)),`lite ${url}`);
      const fonte=pub(url.replace('/art/lite/menu/','/art/menu/'));
      assert.ok(existsSync(fonte),`fonte ${url}`);
      assert.ok(statSync(pub(url)).size<=240_000,`${url}: light enough to open on a phone`);
    }
  }
  assert.deepEqual(storiesDe('feirante'),[]);
});

test('the viewer: one bar per story, the pictures with no src (loaded on open), the sticker, @ and the X',()=>{
  for(const p of INSTA_PERFIS){
    const html=storiesTelaHtml(p),n=storiesDe(p.id).length;
    assert.match(html,new RegExp(`role="dialog" aria-modal="true" aria-label="Stories de ${p.handle}"`));
    assert.equal(html.match(/class="insta-sv-barra"/g)?.length,n);
    assert.equal(html.match(/class="insta-sv-story"/g)?.length,n);
    assert.ok(!html.includes('story-'),`${p.id}: no story picture is requested with the HTML`);
    assert.ok(!/class="insta-sv-foto"[^>]*src=/.test(html));
    for(const s of storiesDe(p.id))assert.ok(html.includes(s.legenda),s.legenda);
    assert.ok(html.includes(perfilUrl(p.id))&&html.includes(`<b>${p.handle}</b>`));
    assert.match(html,/class="insta-sv-fechar" aria-label="Fechar"/);
  }
});

test('the profile photo opens the stories only for a released hero; watched, its ring goes grey',()=>{
  const viciado=INSTA_PERFIS[0]!;
  assert.match(perfilHtml(viciado),/<button type="button" class="insta-foto insta-foto-botao" aria-label="Ver os stories de @VICIADO" aria-haspopup="dialog">/);
  assert.match(perfilHtml(viciado,true,true),/insta-foto-botao" data-visto/);
  const privado=perfilHtml(viciado,false);
  assert.ok(!privado.includes('insta-foto-botao')&&privado.startsWith('<div class="insta-foto">'),'a locked hero: a private account');
  assert.match(css,/\.insta-foto-botao\[data-visto\] \.insta-anel \{ background: var\(--insta-linha\); \}/);
  // Wired: the photo opens them; turning the phone closes them.
  assert.match(main,/perfilHtml\(perfil,isLiberado\(perfil\.id\),instaVistos\.has\(perfil\.id\)\)/);
  assert.match(main,/abrirStories\(perfil,foto,/);
  assert.match(main,/fecharStories\(true\)/);
});

test('taps: the left third goes back (the first story restarts), elsewhere forward, past the last closes',()=>{
  const w=390,esquerda=w*VOLTAR_LADO-1,direita=w*VOLTAR_LADO+1;
  assert.deepEqual(toqueOf(esquerda,w,2,4),{ir:1});
  assert.deepEqual(toqueOf(10,w,0,4),{ir:0});
  assert.deepEqual(toqueOf(direita,w,0,4),{ir:1});
  assert.deepEqual(toqueOf(w-1,w,2,4),{ir:3});
  assert.equal(toqueOf(w-1,w,3,4),'fechar');
  assert.equal(STORY_MS,5000);
  assert.ok(SEGURAR_MS>=150&&SEGURAR_MS<=300);
});

test('fades: in and out on opening and closing, between stories; none with reduced motion',()=>{
  assert.match(css,/\.insta-sv-story \{[^}]*opacity: 0; transition: opacity \.35s ease;/);
  assert.match(css,/\.insta-sv-story\.ativo \{ opacity: 1;/);
  assert.match(css,/prefers-reduced-motion: reduce\) \{ \.insta-sv-story \{ transition: none; \} \}/);
  const viewer=readFileSync(new URL('../../src/client/ui/insta-stories.ts',import.meta.url),'utf8');
  assert.match(viewer,/tela\.animate\(\[\{opacity:0\},\{opacity:1\}\]/);
  assert.match(viewer,/tela\.animate\(\[\{opacity:1\},\{opacity:0\}\]/);
  assert.match(viewer,/history\.pushState\(\{\.\.\.\(history\.state as object\|null\),instaStory:true\}/,'the back button closes it');
});
