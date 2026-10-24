import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {abasHtml, barraHtml, chipsHtml, gradeHtml, gradeUrls, handleFit, INSTA_ART, INSTA_PERFIS, INSTA_QUERY, instaPerfil, logoUrl, perfilHtml, perfilUrl, postTelaHtml, postUrl, storiesOf, storyHtml} from '../../src/client/ui/insta.ts';
import {gestoOf, SWIPE} from '../../src/client/ui/insta-post.ts';
import {STADIUM_TALL_QUERY} from '../../src/client/ui/stadium.ts';
import {getClass, isLiberado, PLAYABLE_CLASS_IDS} from '../../src/rules/index.ts';

// NEW-20261023-ORQ-selecao-mobile-instagram: the phone held upright picks the hero on an Instagram profile, one screen
// with exactly 3 photos. Prints beside the user's reference: evidence/NEW-20261023-ORQ-selecao-mobile-instagram/.
const css=readFileSync(new URL('../../src/client/ui/insta.css',import.meta.url),'utf8');
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const pub=(url:string)=>new URL(`../../public${url}`,import.meta.url);

test('the six profiles are heroes of the game, with the texts of step 2 and their art in WebP + lite',()=>{
  assert.deepEqual(INSTA_PERFIS.map(p=>p.id),['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado']);
  for(const p of INSTA_PERFIS){
    assert.ok(getClass(p.id)&&PLAYABLE_CLASS_IDS.includes(p.id),p.id);
    assert.equal(p.handle,`@${p.nome}`);
    // The Vendedor's first line ("Olha a água, olha o mate!", 25) is the longest; it fits one line at 390 px (print 24/10).
    for(const linha of p.bio.split('\n'))assert.ok(linha.length<=25,`${p.id}: linha da bio de ${linha.length} letras`);
    assert.equal(p.bio.split('\n').length,2,`${p.id}: the bio in 2 lines`);
    assert.deepEqual(p.chips.map(c=>c.label),['Estilo','Especialidade','Status']);
    // "Contando história" (the Aposentado, 17) is the longest chip; the row still fits at 390 px (print 24/10).
    for(const c of p.chips)assert.ok(c.valor.length<=17,`${p.id}: ${c.valor}`);
    for(const url of [perfilUrl(p.id),logoUrl(p.id),...gradeUrls(p.id,true),...[0,1,2].map(i=>postUrl(p.id,i))]){
      assert.ok(url.startsWith(INSTA_ART),url);
      assert.ok(existsSync(pub(url)),`lite ${url}`);
      assert.ok(existsSync(pub(url.replace('/art/lite/menu/','/art/menu/'))),`fonte ${url}`);
    }
  }
  assert.equal(instaPerfil('gato-nada-pra-comer')?.bio,'Sete vidas.\nZero boletos.');
  assert.equal(instaPerfil('feirante'),undefined);
  for(const icon of ['icone-cadeado','icone-verificado','icone-oculos','icone-coroa','icone-pata'])
    assert.ok(existsSync(pub(`${INSTA_ART}${icon}.webp`)),icon);
});

test('a released hero shows exactly 3 photos; a locked one shows none (a private account), not even their URLs',()=>{
  for(const p of INSTA_PERFIS){
    const urls=gradeUrls(p.id,true),html=gradeHtml(p,true);
    assert.equal(urls.length,3);
    assert.equal(html.match(/class="insta-post"/g)?.length,3,p.id);
    assert.equal(html.match(/<button type="button" class="insta-post-botao" data-post="\d"/g)?.length,3,`${p.id}: each photo opens`);
    for(const url of urls)assert.ok(html.includes(url));
    const locked=gradeHtml(p,false);
    assert.deepEqual(gradeUrls(p.id,false),[]);
    assert.ok(!locked.includes('grade-')&&!locked.includes('insta-post'),`${p.id}: the locked grid leaked a photo`);
    assert.match(locked,/Esta conta é privada/);
  }
  // The game's own lock decides: all six are released (the maromba since 23/10, for the play test; the vendedor and the aposentado since 24/10).
  assert.deepEqual(INSTA_PERFIS.filter(p=>isLiberado(p.id)).map(p=>p.id),['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado']);
  assert.match(main,/gradeHtml\(perfil,isLiberado\(perfil\.id\)\)/);
});

test('the stories are the other heroes with a profile; a locked one has the lock over his face',()=>{
  const ids=INSTA_PERFIS.map(p=>p.id);
  assert.deepEqual(storiesOf('gato-nada-pra-comer',ids).map(p=>p.nome),['VICIADO','CLT','MAROMBA','VENDEDOR','APOSENTADO']);
  assert.deepEqual(storiesOf('viciado-em-bet',ids).map(p=>p.nome),['CLT','GATO','MAROMBA','VENDEDOR','APOSENTADO']);
  assert.equal(storiesOf('feirante',ids).length,6);
  assert.deepEqual(storiesOf('viciado-em-bet',['viciado-em-bet','maromba']).map(p=>p.id),['maromba'],'only heroes this build has');
  const maromba=instaPerfil('maromba')!;
  assert.match(storyHtml(maromba,false),/data-bloqueado[^>]*aria-label="MAROMBA \(em breve\)"/);
  assert.match(storyHtml(maromba,false),/icone-cadeado/);
  assert.ok(!storyHtml(instaPerfil('clt-cansado')!,true).includes('cadeado'));
});

test('the profile: badge, followers | following, bio, the three chips; the handle never wraps',()=>{
  const gato=instaPerfil('gato-nada-pra-comer')!,html=perfilHtml(gato);
  for(const piece of ['@GATO','12,4 mil','seguidores','3','seguindo','Sete vidas.\nZero boletos.','icone-verificado'])assert.ok(html.includes(piece),piece);
  assert.match(css,/\.insta-bio \{[^}]*white-space: pre-line;/,'the bio breaks at its line feed');
  assert.equal(chipsHtml(gato).match(/class="insta-chip"/g)?.length,3);
  // The chips' icons in the reference's flat dark grey (the user, 23/10): a mask in --insta-icone, never the colour drawing.
  assert.ok(!chipsHtml(gato).includes('<img'),'no coloured icon');
  assert.deepEqual([...chipsHtml(gato).matchAll(/data-icone="(\w+)"/g)].map(m=>m[1]),['oculos','coroa','pata']);
  assert.match(css,/\.insta-chip-icone \{[^}]*background: var\(--insta-icone\); mask: var\(--icone\)/);
  for(const icone of ['oculos','coroa','pata'])assert.ok(css.includes(`[data-icone="${icone}"] { --icone: url('${INSTA_ART}icone-${icone}.webp'); }`),icone);
  assert.equal(handleFit('@GATO'),1);
  assert.ok(handleFit('@MAROMBA')<1&&handleFit('@MAROMBA')>.8);
  assert.match(barraHtml(),/class="insta-menu" aria-label="Configurações"/);
  assert.match(barraHtml(),/<img class="insta-logo" alt=""/);
  assert.ok(!/insta-logo"[^>]*src=/.test(barraHtml()),'the stadium never downloads a logo: main.ts sets it on the profile');
  assert.equal(abasHtml().match(/class="insta-aba[ "]/g)?.length,3);
  // The measured fit (main.ts fitHandle) after the font is in.
  assert.match(main,/document\.fonts\.ready\.then\(fitHandle\)/);
});

test('only on the phone held upright; the stadium keeps desktop and the phone on its side',()=>{
  assert.equal(INSTA_QUERY,STADIUM_TALL_QUERY);
  assert.ok(css.includes(`@media ${INSTA_QUERY} {`));
  assert.match(css,/^\.insta-topo, \.insta-grade-area \{ display: none; \}/m,'hidden outside the query');
  // Nothing of the profile downloads on the stadium, and the dancer and portrait wait while the profile is up.
  assert.match(main,/if\(instaScreen\.matches\) renderInsta\(\); else showPortrait\(selected,announce\);/);
  assert.match(main,/instaHold=menuDance\.hold\(\)/);
});

// Every vertical size of the profile, in the reference's card px (insta.css: calc(var(--u) * N)).
function u(selector:string,prop:string,nth=0):number{
  const at=css.indexOf(`\n  ${selector} {`);
  assert.ok(at>=0,selector);
  const body=css.slice(at,css.indexOf('}',at));
  const m=[...body.matchAll(new RegExp(`(?:^|[;{\\s])${prop}:([^;]+);`,'g'))][0];
  assert.ok(m,`${selector} ${prop}`);
  const values=[...m[1].matchAll(/calc\(var\(--u\) \* (\d+(?:\.\d+)?)\)/g)].map(x=>Number(x[1]));
  return values[nth];
}
test('one screen, no scroll: the bands add up to the reference card (734x1415) and --u fits it in 390x844 and 360x780',()=>{
  assert.match(css,/--u: calc\(min\(100vw, 51\.873dvh\) \/ 734\);/);
  assert.ok(Math.abs(51.873-734/1415*100)<.001);
  const total=
    u('.insta-barra','margin-top')+u('.insta-barra','height')+                                      // 17..135
    u('.insta-stories','margin-top')+u('.insta-anel','height')+u('.estadio .insta-story','gap')+28+  // ..402 (the name: 28, line-height 1)
    u('.insta-trocar','margin',0)+25+                                                                // ..442
    u('.insta-perfil','margin-top')+u('.insta-foto .insta-anel','height')+                          // ..778
    u('.insta-chips','margin',0)+u('.insta-chip','height')+                                          // ..852
    u('.insta-grade-area','margin-top')+u('.insta-aba','height')+2*3+u('.insta-grade','margin',0)+u('.insta-grade','height')+ // ..1232
    u('.estadio .estadio-escolha > .estadio-confirmar','margin',0)+u('.estadio .estadio-escolha > .estadio-confirmar','--bh')+
    u('.estadio .estadio-escolha > .estadio-confirmar','margin',1);                                  // ..1415
  assert.equal(total,1415);
  assert.match(css,/font: 400 max\(10px, calc\(var\(--u\) \* 28\)\)\/1 var\(--f-botao\)/,'the story name is 28 tall');
  assert.match(css,/font: 400 max\(10px, calc\(var\(--u\) \* 25\)\)\/1 var\(--f-sistema\)/,'"Toque para trocar" is 25 tall');
  for(const [w,h] of [[390,844],[360,780],[375,667],[412,915]]){
    const k=Math.min(w,h*734/1415)/734;
    assert.ok(1415*k<=h+1e-9&&734*k<=w+1e-9,`${w}x${h}`);
  }
  // Step 2: the name row takes exactly the tabs and the grid's place.
  assert.equal(u('.estadio .estadio-escolha:has(.insta-topo) > .estadio-nome','height')+u('.estadio .estadio-escolha:has(.insta-topo) > .estadio-nome','margin-top'),
    u('.insta-grade-area','margin-top')+u('.insta-aba','height')+2*3+u('.insta-grade','margin',0)+u('.insta-grade','height'));
});

// BUG-20261023-ORQ-instagram-letreiro-do-perfil: the user's prints (evidence/<ID>/print-usuario-*.jpg).
test('the top bar shows the letreiro of the profile on screen, and it changes with the story tapped',()=>{
  assert.deepEqual(INSTA_PERFIS.map(p=>logoUrl(p.id)),INSTA_PERFIS.map(p=>`${INSTA_ART}logo-${p.id}.webp`));
  assert.ok(!existsSync(pub(`${INSTA_ART}logo.webp`)),'the old fixed logo (always the viciado) is gone');
  // renderInsta sets it with the profile (a story's tap renders the new one).
  assert.match(main,/insta\.logo\.src=logoUrl\(perfil\.id\);insta\.logo\.alt=perfil\.letreiro;/);
  // One size for every hero's canvas (scripts/insta-logo-medida.mjs LOGO_CAIXA, LOGO_H): the lightest's drawing 112 tall.
  assert.match(css,/\.insta-logo \{ display: block; height: calc\(var\(--u\) \* 112 \* 200 \/ 168\); width: auto; margin: calc\(var\(--u\) \* \(62 - 112 \* 100 \/ 168\)\)/,'one height for every hero');
});

test('a grid photo opens as a post: header, the 3 photos side by side, actions, likes, a caption each',()=>{
  for(const p of INSTA_PERFIS){
    const html=postTelaHtml(p);
    assert.match(html,/role="dialog" aria-modal="true"/);
    assert.match(html,/class="insta-ver-voltar" aria-label="Voltar"/);
    assert.ok(html.includes(perfilUrl(p.id))&&html.includes(`<b>${p.handle}</b>`)&&html.includes('icone-verificado'),p.id);
    assert.equal(html.match(/class="insta-ver-slide"/g)?.length,3);
    for(let i=0;i<3;i++)assert.ok(html.includes(postUrl(p.id,i)),`${p.id} ${i}`);
    assert.equal(p.posts.length,3);
    for(const post of p.posts){
      assert.ok(html.includes(post.legenda),post.legenda);
      assert.ok(post.legenda.length<=40,`${p.id}: "${post.legenda}" fits 2 lines`);
      assert.ok(html.includes(`Curtido por <b>${post.curtidoPor}</b> e <b>outras ${post.curtidas} pessoas</b>`));
    }
    assert.match(html,/class="insta-ver-curtir" aria-label="Curtir" aria-pressed="false"/);
  }
  // Wired: a tap on a photo opens it; turning the phone closes it.
  assert.match(main,/abrirPost\(perfil,Number\(foto\.dataset\.post\)/);
  assert.match(main,/function syncInsta\(\) \{\n  fecharPost\(true\);/);
});

test('the post\'s gestures: to the side passes the photos (not past the ends), down or a flick down closes',()=>{
  const w=390;
  assert.equal(gestoOf('x',-w*SWIPE.lado-1,0,w,0,3),'proximo');
  assert.equal(gestoOf('x',w*SWIPE.lado+1,0,w,1,3),'anterior');
  assert.equal(gestoOf('x',w*SWIPE.lado+1,0,w,0,3),'ficar','no photo before the first');
  assert.equal(gestoOf('x',-200,0,w,2,3),'ficar','no photo after the third');
  assert.equal(gestoOf('x',-30,-.8,w,0,3),'proximo','a flick');
  assert.equal(gestoOf('x',-30,.8,w,0,3),'ficar','a flick back the other way');
  assert.equal(gestoOf('x',-20,0,w,0,3),'ficar');
  assert.equal(gestoOf('y',SWIPE.baixo+1,0,w,0,3),'fechar');
  assert.equal(gestoOf('y',40,.9,w,0,3),'fechar','a flick down');
  assert.equal(gestoOf('y',60,.1,w,0,3),'ficar');
});
