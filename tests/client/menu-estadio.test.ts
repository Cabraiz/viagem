import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {barTop, CUTOUT_QUERY, cutoutMargin, cutoutOf, fitCutout, placeCutout, placeOnBar, RECORTES, STADIUM, STADIUM_TALL_QUERY} from '../../src/client/ui/stadium.ts';
import {APELIDOS, ARTE_NOVA, BIG_CHARS, LETREIROS, MIN_FIT, TOP_CHARS, hasNewArt, letreiroOf, plaqueText, titleFit, titleLines} from '../../src/client/ui/apelidos.ts';
import {playableClasses} from '../../src/rules/index.ts';
import {CONFIRM_TEXT, etapaOf, nameKey, showEtapa} from '../../src/client/ui/menu-etapa.ts';

// menu-estadio (the user, 21/10): no Personagem/Classes tabs; one screen with the approved stadium, the chosen hero big
// on the bar, the row of heroes and "Selecionar". Prints: evidence/NEW-20261021-ORQ-menu-estadio.
const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const css=readFileSync(new URL('../../src/client/estadio.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../../index.html',import.meta.url),'utf8');

test('one screen: no tabs, no catalog search; title, class, row, name and confirm are HTML over the stadium',()=>{
  for(const gone of ['role="tablist"','role="tab"','id="classes"','id="search"','data-role','page-next','setupSections','back-to-classes'])
    assert.ok(!main.includes(gone),`${gone} left the menu`);
  for(const piece of ['class="estadio-palco"','id="portrait"','id="screen-title"','id="class-name"','id="class-list"','id="previous"','id="next"','id="nickname"','id="confirm"','SELECIONAR'])
    assert.ok(main.includes(piece),piece);
  assert.ok(!main.includes('BORA PRA')&&!main.includes('ESSE SOU EU'),'the old letreiro and button text left (botao-selecionar)');
  // The scripts that play the menu (smoke-prod, folha-prints, perf-andar) click a `.class-card` and then #confirm.
  assert.match(main,/class="class-card" data-hero="\$\{hero\.id\}"/);
});

test('the CSS shows the stadium files that exist, the tall crop on a phone held upright, and preloads them',async()=>{
  assert.ok(css.includes(`@media ${STADIUM_TALL_QUERY} {`),'the CSS and main.ts agree on when the tall crop shows');
  for(const [file,art] of [['estadio-1920',STADIUM.wide],['estadio-1280',undefined],['estadio-retrato-768',STADIUM.tall]] as const){
    assert.ok(css.includes(`/art/ui-extra/${file}.webp`),file);
    assert.match(html,new RegExp(`<link rel="preload" href="/art/ui-extra/${file}\\.webp" as="image"`),file);
    const meta=await sharp(new URL(`../../public/art/ui-extra/${file}.webp`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')).metadata();
    if(art)assert.deepEqual([meta.width,meta.height],[art.w,art.h],`${file} matches STADIUM`);
  }
});

test('placeOnBar puts the feet on the bar wherever cover crops the picture',()=>{
  assert.equal(barTop(-1),barTop(0));assert.equal(barTop(2),barTop(.86));
  assert.ok(barTop(.3)<barTop(.65),'the bar falls to the right');
  // 1920x1080 window: the picture as it is, x=70% → the bar at that x of the picture.
  const full=placeOnBar({w:1920,h:1080},STADIUM.wide,1344)!;
  assert.equal(full.x,1344);assert.ok(Math.abs(full.y-barTop(.7)*1080)<.01);
  // 1280x800 (narrower than 16:9): the sides are cut, the height fits, so the bar sits at the same fraction of the height.
  const pc=placeOnBar({w:1280,h:800},STADIUM.wide,896)!;
  const s=800/1080,ox=(1280-1920*s)/2;
  assert.ok(Math.abs(pc.y-barTop((896-ox)/(1920*s))*800)<.01);
  // A wide, short window: the top is cut (anchored at the bottom), the bar stays inside the box.
  const wide=placeOnBar({w:1920,h:600},STADIUM.wide,1344)!;
  assert.ok(wide.y>500&&wide.y<600,String(wide.y));
  // The phone's crop: its x is a part of the whole picture.
  const phone=placeOnBar({w:390,h:548},STADIUM.tall,195)!;
  const whole=STADIUM.tall.crop[0]+(STADIUM.tall.crop[2]-STADIUM.tall.crop[0])*.5;
  assert.ok(Math.abs(phone.y-barTop(whole)*548)<1,String(phone.y));
  assert.equal(placeOnBar({w:0,h:500},STADIUM.wide,0),undefined);
});

test('botao-selecionar: the letreiro is the hero name (last word big), the plaque his nickname or subtitle',()=>{
  const bet=playableClasses.find(c=>c.id==='viciado-em-bet')!;
  assert.deepEqual(titleLines(bet.name),['VICIADO EM','BET']);
  assert.equal(plaqueText(bet),'O REI DA PICARETAGEM');
  assert.deepEqual(titleLines('Mendigo'),['','MENDIGO']);
  const clt=playableClasses.find(c=>c.id==='clt-cansado')!;
  assert.ok(!APELIDOS[clt.id]);assert.equal(plaqueText(clt),'TANQUE EM HORÁRIO COMERCIAL');
  assert.equal(titleFit(['BORA PRA','TORCIDA!']),1,'the approved sign keeps its size');
  // Every hero of the cast: a long name shrinks the sign so no line is wider than the approved one.
  for(const hero of playableClasses){
    const lines=titleLines(hero.name),fit=titleFit(lines);
    assert.ok(fit>=MIN_FIT&&fit<=1,hero.id);
    assert.ok(lines[0].length*fit<=TOP_CHARS+.01&&lines[1].length*fit<=BIG_CHARS+.01||fit===MIN_FIT,`${hero.id}: ${lines.join(' / ')} at ${fit}`);
  }
  // Today's longest names fit at full size; a longer future one shrinks.
  assert.equal(titleFit(titleLines('Passageira do Busão')),1);assert.equal(titleFit(titleLines('Caça-Promoção')),1);
  assert.ok(titleFit(titleLines('Desenvolvedora Fullstack Sênior'))<1);
  assert.ok(titleFit(titleLines('Supercalifragilisticoexpialidoso'))<1);
});

test('botao-selecionar: the row shows a "?" until a hero has new art; a letreiro picture per hero replaces the HTML sign',()=>{
  // Nobody has the new row face yet (every tile a "?"); only the viciado has his letreiro picture (menu-arte-viciado).
  assert.equal(ARTE_NOVA.size,0);assert.deepEqual(Object.keys(LETREIROS),['viciado-em-bet']);
  for(const hero of playableClasses){assert.equal(hasNewArt(hero.id),false);if(hero.id!=='viciado-em-bet')assert.equal(letreiroOf(hero.id),undefined);}
  assert.match(main,/hasNewArt\(hero\.id\)[\s\S]*card-portrait[\s\S]*card-misterio" aria-hidden="true">\?</);
  assert.match(main,/class="estadio-letreiro" alt="" hidden/);
  assert.ok(css.includes('.estadio .card-misterio'));
});

// nome-depois-de-selecionar (the user, 21/10): the name field only after SELECIONAR; then the button enters.
function fakeEtapa(value=''){
  const focused:Array<{preventScroll?:boolean}|undefined>=[];let selected=0;
  const parts={section:{dataset:{etapa:'escolher'} as Record<string,string|undefined>},row:{hidden:false},nameRow:{hidden:true},
    input:{value,focus:(o?:{preventScroll?:boolean})=>{focused.push(o);},select:()=>{selected++;}},label:{textContent:'SELECIONAR' as string|null}};
  return {parts,focused,selected:()=>selected};
}

test('nome-depois-de-selecionar: no name field before SELECIONAR; after it the field shows, focused, and the button enters',()=>{
  // The page as it opens: the name row (with #nickname inside) hidden, the step "escolher", the button SELECIONAR.
  assert.match(main,/data-etapa="escolher"/);
  assert.match(main,/<div class="estadio-nome" hidden>[\s\S]*?<input id="nickname"[\s\S]*?<\/div>\s*<button id="confirm"/);
  assert.ok(css.includes('.estadio-fileira[hidden], .estadio-nome[hidden] { display: none; }'),'the flex rows really hide');
  const {parts,focused,selected}=fakeEtapa();
  assert.equal(etapaOf(parts),'escolher');assert.equal(parts.nameRow.hidden,true);assert.equal(parts.row.hidden,false);
  // SELECIONAR: the row gives its place to the name, which gets the focus; the button says it enters.
  showEtapa(parts,'nome');
  assert.equal(etapaOf(parts),'nome');assert.equal(parts.nameRow.hidden,false);assert.equal(parts.row.hidden,true);
  assert.deepEqual(focused,[{preventScroll:true}]);assert.equal(parts.label.textContent,CONFIRM_TEXT.nome);
  assert.equal(selected(),0,'an empty field has nothing to select');
  // ‹ / Escape: back to the row, the name hidden again, the button SELECIONAR.
  showEtapa(parts,'escolher');
  assert.equal(parts.nameRow.hidden,true);assert.equal(parts.row.hidden,false);assert.equal(parts.label.textContent,'SELECIONAR');
  // A saved name comes filled and selected (typing replaces it); on a touch with a saved name, no focus (no keyboard).
  const saved=fakeEtapa('Zé');showEtapa(saved.parts,'nome');assert.equal(saved.selected(),1);
  const touch=fakeEtapa('Zé');showEtapa(touch.parts,'nome',{focusName:false});assert.deepEqual(touch.focused,[]);assert.equal(touch.parts.nameRow.hidden,false);
  assert.match(main,/focusName:matchMedia\('\(pointer: fine\)'\)\.matches\|\|!nameInput\.value\.trim\(\)/);
  assert.match(main,/nameInput\.value=nickname;/,'the saved name fills the field');
});

test('nome-depois-de-selecionar: Enter in the field enters, Escape goes back, the confirm click follows the step',()=>{
  assert.equal(nameKey({key:'Enter'}),'entrar');assert.equal(nameKey({key:'Escape'}),'voltar');
  assert.equal(nameKey({key:'Enter',isComposing:true}),undefined,'Enter that ends an IME word does not enter');
  assert.equal(nameKey({key:'a'}),undefined);
  assert.match(main,/if\(key==='entrar'\) document\.getElementById\('confirm'\)!\.click\(\); else backToRow\(\);/);
  // Step 1: the click only locks the hero; step 2: the name check and the dialog as before.
  assert.match(main,/if\(etapaOf\(etapa\)==='escolher'\) \{chooseHero\(\);return;\}\s*if\(!nickname\.trim\(\)\)/);
  assert.match(main,/getElementById\('trocar'\)!\.addEventListener\('click',backToRow\)/);
  assert.match(main,/'back-to-menu'\)!\.addEventListener\('click',\(\)=>\{dialog\.close\(\);backToRow\(\);\}\)/,'"Trocar de personagem" goes back to the row');
  // The scripts that play the menu click #confirm again when the first click only selected.
  for(const script of ['smoke-prod','folha-prints','perf-andar','abertura-ci']){
    const src=readFileSync(new URL(`../../scripts/${script}.mjs`,import.meta.url),'utf8');
    assert.ok(src.includes("c.click();if(!document.getElementById('confirmation').open)c.click();"),script);
  }
});

const publicFile=(url:string)=>new URL(`../../public${url}`,import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1');

test('menu-arte-viciado: the letreiro picture and the hero cut out of the 1920x1080, put back in place on the PC',async()=>{
  // The files exist, light, the sizes the code says.
  const sign=await sharp(publicFile(letreiroOf('viciado-em-bet')!)).metadata();
  assert.equal(sign.width,1000);assert.ok(sign.hasAlpha);
  const cut=cutoutOf('viciado-em-bet')!;
  assert.deepEqual([cut.x,cut.y,cut.w,cut.h],[955,21,788,1053],'the box scripts/menu-arte.mjs checks against the art');
  for(const [w,file] of cut.files){
    const meta=await sharp(publicFile(file)).metadata();
    assert.equal(meta.width,w,file);assert.ok(Math.abs(meta.height!-cut.h*w/cut.w)<1,file);assert.ok(meta.hasAlpha,file);
  }
  assert.ok(readFileSync(new URL('../../scripts/menu-arte.mjs',import.meta.url),'utf8').includes('box:{left:955,top:21,width:788,height:1053}'));
  assert.equal(cutoutOf('clt-cansado'),undefined,'the others keep the dance');
  // 1920x1080: exactly where the approved screen has him; 1280x720: the same, 2/3.
  assert.deepEqual(placeCutout({w:1920,h:1080},STADIUM.wide,cut),{x:955,y:21,w:788,h:1053});
  const small=placeCutout({w:1280,h:720},STADIUM.wide,cut)!;
  for(const [k,v] of Object.entries({x:955,y:21,w:788,h:1053}))assert.ok(Math.abs(small[k as keyof typeof small]-v*2/3)<1e-9,k);
  // A narrower window (16:10): cover cuts the sides, the hero moves with the picture, his feet keep the bar.
  const pc=placeCutout({w:1280,h:800},STADIUM.wide,cut)!,s=800/1080,ox=(1280-1920*s)/2;
  assert.ok(Math.abs(pc.x-(ox+955*s))<1e-9&&Math.abs(pc.y-21*s)<1e-9&&Math.abs(pc.h-1053*s)<1e-9);
  assert.equal(placeCutout({w:0,h:0},STADIUM.wide,cut),undefined);
  // PC only: the phone (upright or on its side, under 521 px tall) keeps the dance; the dance is held while he stands.
  assert.equal(CUTOUT_QUERY,'(orientation: landscape) and (min-height: 521px)');
  assert.ok(css.includes(`@media ${CUTOUT_QUERY} {`),'the CSS and main.ts agree on what a PC is');
  assert.match(main,/const cut=cutoutScreen\.matches\?cutoutOf\(selected\.id\):undefined;/);
  assert.match(main,/if\(spot&&!cutoutHold\) cutoutHold=menuDance\.hold\(\);/);
  assert.match(main,/showCutout\(\); \/\/ first[^\n]*\n\s*showPortrait\(selected,announce\);/,'the cutout before the portrait: no dance started for nothing');
  assert.ok(css.includes('.estadio-palco.com-recorte .estadio-heroi { visibility: hidden; }'));
  // With the picture the plaque hides: on the phone held upright the row takes its push under the bar.
  assert.ok(css.includes('.estadio-escolha:has(.com-letreiro) :is(.estadio-fileira, .estadio-nome) { margin-top: auto; }'));
  assert.ok(css.includes('.estadio .estadio-confirmar > span[aria-hidden] {'),'only the star is styled, not the button text');
  assert.deepEqual(Object.keys(RECORTES),['viciado-em-bet']);
});

test('menu-1080-720-menino-inteiro: the whole boy on screen at 1080p and 720p, the letreiro 15% smaller',()=>{
  const cut=cutoutOf('viciado-em-bet')!;
  // The user's screens: 1080p, 1080p with the browser's bar (his print, 1917x948), 768p and 720p. Cap, horn and sneakers
  // (the file's alpha fills its box) inside the stage with the margin, the feet never lower than the picture puts them.
  for(const [w,h] of [[1920,1080],[1920,950],[1917,948],[1366,768],[1280,720],[1280,800],[2560,1080]]){
    const box={w,h},placed=placeCutout(box,STADIUM.wide,cut)!,fit=fitCutout(box,placed),m=cutoutMargin(h);
    assert.ok(fit.y>=m-1e-9&&fit.y+fit.h<=h-m+1e-9,`${w}x${h}: top ${fit.y}, bottom ${fit.y+fit.h}`);
    assert.ok(fit.x>=m-1e-9&&fit.x+fit.w<=w-m+1e-9,`${w}x${h}: left ${fit.x}, right ${fit.x+fit.w}`);
    assert.ok(Math.abs(fit.w/fit.h-cut.w/cut.h)<1e-9,'contain: never stretched');
    assert.ok(fit.h<=placed.h+1e-9&&fit.y+fit.h<=placed.y+placed.h+1e-9,'never bigger, never lower than cover put him');
    assert.ok(Math.abs(fit.x+fit.w/2-(placed.x+placed.w/2))<1e-9,'his middle stays');
  }
  // 1920x950 was the cut one: cover put his cap 109 px above the screen; now he is ~87% of that, the cap on screen.
  const bar=fitCutout({w:1920,h:950},placeCutout({w:1920,h:950},STADIUM.wide,cut)!);
  assert.ok(Math.abs(bar.y-19)<1e-9&&Math.abs(bar.h-912)<1e-9,JSON.stringify(bar));
  assert.match(main,/placed=cut&&placeCutout\(box,STADIUM\.wide,cut\),spot=placed&&fitCutout\(box,placed\);/);
  // The letreiro: 46vw / 78vh x .85 (the user, 21/10); the phone keeps its own sizes.
  assert.ok(css.includes('.estadio-titulo.com-letreiro .estadio-letreiro { width: min(39.1vw, 66.3vh);'));
  assert.ok(Math.abs(46*.85-39.1)<1e-9&&Math.abs(78*.85-66.3)<1e-9);
  assert.ok(css.includes('.estadio-titulo.com-letreiro .estadio-letreiro { width: auto; max-width: 100%; max-height: 16vh; margin-inline: auto; }'));
});

test('menu-arte-viciado: the confirm button is E7\'s art (9-slice pill, star, burst), the text stays HTML, every hero',async()=>{
  const pill=await sharp(publicFile('/art/menu/botao/pilula.webp')).metadata();
  assert.deepEqual([pill.width,pill.height],[742,149]);
  // The caps: 259 px of the 1483 px original = 130 of the half-size copy, as wide as .872 of the height.
  assert.ok(css.includes("border-image: url('/art/menu/botao/pilula.webp') 0 130 fill / 0 calc(var(--bh) * .872) stretch;"));
  assert.ok(Math.abs(130/149-.872)<.002);
  for(const file of ['estrela','icone-direita'])assert.ok(css.includes(`url('/art/menu/botao/${file}.webp')`),file);
  assert.match(main,/<button id="confirm" class="primary-button estadio-confirmar"><span aria-hidden="true">★<\/span><span class="estadio-confirmar-texto">SELECIONAR<\/span><\/button>/);
});
