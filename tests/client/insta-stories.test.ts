import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
import {camadaHtml, INSTA_ART, INSTA_PERFIS, INSTA_STORIES, perfilHtml, perfilUrl, storiesDe, storiesTelaHtml, storyUrl, textoDe, type StoryCamada} from '../../src/client/ui/insta.ts';
import {LETRAS_STORIES, SEGURAR_MS, STORY_MS, toqueOf, VOLTAR_LADO} from '../../src/client/ui/insta-stories.ts';

// NEW-20261023-ORQ-insta-stories-4-herois: the profile photo opens the hero's stories, like Instagram. The art's
// choices: viagem-board/evidence/<ID>/README.md; prints and video of the viewer there too.
const css=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const pub=(url:string)=>new URL(`../../public${url}`,import.meta.url);
const COM_STORIES=INSTA_PERFIS.filter(p=>storiesDe(p.id).length>0);

test('each of the six heroes has 3-4 stories with a short sticker, their art in WebP + lite',()=>{
  // NEW-20261024-ORQ-stories-vendedor-aposentado: the vendedor and the aposentado too, every profile opens its stories.
  assert.deepEqual(Object.keys(INSTA_STORIES),['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado']);
  assert.deepEqual(COM_STORIES.map(p=>p.id),INSTA_PERFIS.map(p=>p.id));
  for(const p of COM_STORIES){
    const lista=storiesDe(p.id);
    assert.ok(lista.length>=3&&lista.length<=4,`${p.id}: ${lista.length}`);
    for(const [k,s] of lista.entries()){
      assert.ok(s.camadas.length>=1&&s.camadas.length<=2,`${p.id} ${k+1}: one text or sticker, two at most`);
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
  for(const p of COM_STORIES){
    const html=storiesTelaHtml(p),n=storiesDe(p.id).length;
    assert.match(html,new RegExp(`role="dialog" aria-modal="true" aria-label="Stories de ${p.handle}"`));
    assert.equal(html.match(/class="insta-sv-barra"/g)?.length,n);
    assert.equal(html.match(/class="insta-sv-story"/g)?.length,n);
    assert.ok(!html.includes('story-'),`${p.id}: no story picture is requested with the HTML`);
    assert.ok(!/class="insta-sv-foto"[^>]*src=/.test(html));
    for(const [k,s] of storiesDe(p.id).entries())assert.ok(html.includes(`alt="Story ${k+1} de ${n} de ${p.handle}: ${textoDe(s)}"`),textoDe(s));
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

// BUG-20261024-ORQ-stories-texto-estilo-instagram (the user 24/10: "Odiei o texto desse jeito, você deveria copiar esses
// dois exemplos ... fonte, cor, jeito, opções"): no more one dark box under every story; Instagram's own looks, fixed per
// story. References and before/after prints: viagem-board/evidence/<ID>/.
test('the stories\' texts look like Instagram\'s: every way, letter and sticker is used, each story its own, off the bar',()=>{
  const todas=INSTA_PERFIS.flatMap(p=>storiesDe(p.id).flatMap(s=>s.camadas)) as StoryCamada[];
  const textos=todas.filter(c=>c.tipo==='texto');
  assert.deepEqual(new Set(textos.map(c=>c.jeito)),new Set(['faixa','sombra','caixa']),'a band per line, a bare shadowed text, a box');
  assert.deepEqual(new Set(textos.map(c=>c.fonte)),new Set(['classica','moderna','forte','maquina']),'the 4 letters');
  for(const t of ['enquete','pergunta','hashtag','curtidas'])assert.ok(todas.some(c=>c.tipo===t),`a ${t} sticker`);
  assert.ok(new Set(textos.filter(c=>c.jeito==='faixa').map(c=>c.fundo)).size>=4,'bands of several colours');
  for(const c of todas){
    assert.ok(c.y>=15&&c.y<=86&&c.x>=20&&c.x<=80,`${textoDe({quando:'',camadas:[c]})}: on the picture, clear of the top bar`);
    if(c.tipo==='texto'){
      assert.ok(c.jeito!=='faixa'||c.fundo,'a band has its colour');
      for(const l of c.linhas)assert.ok(l.length<=20,`"${l}": a short line, broken by hand`);
      if(c.fonte==='forte')assert.equal(c.linhas.join(),c.linhas.join().toUpperCase(),'the strong letter in caps, written (design lint)');
    }
  }
  // Same story, same look on every opening: nothing random in the data or the HTML.
  for(const p of INSTA_PERFIS)assert.equal(storiesTelaHtml(p),storiesTelaHtml(p));
  // Nothing of the old dark box is left.
  assert.ok(!css.includes('.insta-sv-legenda')&&!storiesTelaHtml(INSTA_PERFIS[0]!).includes('insta-sv-legenda'));
});

test('a layer\'s HTML: its place and colours in custom properties, the poll\'s A/B, the question box with the face',()=>{
  const p=INSTA_PERFIS[2]!;
  assert.equal(camadaHtml({tipo:'texto',fonte:'classica',jeito:'faixa',cor:'branco',fundo:'azul',linhas:['O jantar','<passou>'],x:50,y:80,giro:-3},p),
    '<p class="insta-st insta-st-texto" data-fonte="classica" data-jeito="faixa" style="left:50%;top:80%;--giro:-3deg;--st-cor:var(--insta-st-branco);--st-fundo:var(--insta-st-azul)"><span>O jantar<br>&lt;passou&gt;</span></p>');
  assert.match(camadaHtml({tipo:'enquete',pergunta:'POTE VAZIO?',a:'Sim',b:'Não',x:50,y:70},p),/<p>POTE VAZIO\?<\/p><ol><li><i>A<\/i>Sim<\/li><li><i>B<\/i>Não<\/li><\/ol>/);
  const pergunta=camadaHtml({tipo:'pergunta',pergunta:'Quem tem sachê?',x:50,y:79},p);
  assert.ok(pergunta.includes(`src="${perfilUrl(p.id)}"`)&&pergunta.includes('Digite algo...'));
  assert.match(camadaHtml({tipo:'hashtag',tag:'#MARMITAFIT',cor:'rosa',x:60,y:80},p),/--st-cor:var\(--insta-st-rosa\)">#MARMITAFIT</);
  assert.match(camadaHtml({tipo:'curtidas',n:21,x:70,y:80},p),/insta-st-curtidas[^>]*><svg[^]*<b>21<\/b>/);
});

test('the letters: OFL, pt-BR subset, declared in tokens.css, asked for only when the stories open',()=>{
  const tokens=readFileSync(new URL('../../src/client/ui/tokens.css',import.meta.url),'utf8');
  const arquivos=['inter-400','inter-800','archivo-expandido-800','bebas-neue-400','courier-prime-400','courier-prime-700'];
  let total=0;
  for(const f of arquivos){total+=statSync(pub(`/fonts/${f}.woff2`)).size;assert.ok(tokens.includes(`/fonts/${f}.woff2`),f);}
  assert.ok(total<=100_000,`${total} B`);
  for(const f of ['inter','archivo','bebas-neue','courier-prime'])assert.match(readFileSync(pub(`/fonts/OFL-${f}.txt`),'utf8'),/SIL OPEN FONT LICENSE/i);
  for(const f of ['classica','moderna','forte','maquina'])assert.match(tokens,new RegExp(`--f-insta-${f}:`));
  assert.ok(!readFileSync(new URL('../../index.html',import.meta.url),'utf8').match(/inter|bebas|courier|archivo/i),'never preloaded with the page');
  const viewer=readFileSync(new URL('../../src/client/ui/insta-stories.ts',import.meta.url),'utf8');
  assert.match(viewer,/LETRAS_STORIES\.map\(f=>document\.fonts\.load\(f\)\)/);
  assert.equal(LETRAS_STORIES.length,5);
  assert.match(css,/\.insta-sv:not\(\.letras\) \.insta-sv-camadas \{ visibility: hidden; \}/,'no fallback letter flashes');
});
