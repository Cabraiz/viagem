import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import sharp from 'sharp';
import {barTop, CUTOUT_QUERY, cutoutFile, cutoutMargin, cutoutOf, FEET_MARGIN, fitCutout, frameArt, frameMoved, moveOf, MURETA_TOPO, muretaTopo, placeCutout, placeOnBar, RECORTES, rostoNoPalco, SEM_MOVE, STADIUM, STADIUM_TALL_QUERY} from '../../src/client/ui/stadium.ts';
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
  // Nobody has the new row face yet (every tile a "?"); only the viciado (menu-arte-viciado) and the CLT
  // (letreiro-clt-na-cena) have their letreiro picture.
  assert.equal(ARTE_NOVA.size,0);assert.deepEqual(Object.keys(LETREIROS),['viciado-em-bet','clt-cansado']);
  for(const hero of playableClasses){assert.equal(hasNewArt(hero.id),false);if(!(hero.id in LETREIROS))assert.equal(letreiroOf(hero.id),undefined);}
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
  // letreiro-na-cena: cut out of the stadium Codex redrew with the sign inside, 2x the most the PC shows (56.4vh of 2160
  // = 1218 px), so a 200 % zoom on a 4K screen still has a pixel per pixel.
  assert.deepEqual([sign.width,sign.height],[2436,1698]);assert.ok(sign.hasAlpha);assert.ok(2*Math.floor(.564*2160)<=2436&&2*.332*3840<=2436*1.05);
  // letreiro-clt-na-cena: the CLT's office plaque, cut out of his sunset the same way, as wide (flatter, so shorter).
  const clt=await sharp(publicFile(letreiroOf('clt-cansado')!)).metadata();
  assert.deepEqual([clt.width,clt.height],[2436,1368]);assert.ok(clt.hasAlpha);
  const cut=cutoutOf('viciado-em-bet')!;
  assert.deepEqual([cut.x,cut.y,cut.w,cut.h],[953,19,793,1058],'the box scripts/menu-arte.mjs checks against the art');
  for(const [w,file] of cut.files){
    const meta=await sharp(publicFile(file)).metadata();
    assert.equal(meta.width,w,file);assert.ok(Math.abs(meta.height!-cut.h*w/cut.w)<1,file);assert.ok(meta.hasAlpha,file);
  }
  assert.ok(readFileSync(new URL('../../scripts/menu-arte.mjs',import.meta.url),'utf8').includes('box:{left:953,top:19,width:793,height:1058}'));
  assert.equal(cutoutOf('motogirl'),undefined,'the others keep the dance');
  // 1920x1080: exactly where the approved screen has him; 1280x720: the same, 2/3.
  // mureta-camada-frente: 4 px lower (desce), his front sole on the bar's padded top.
  assert.equal(cut.desce,4);
  assert.deepEqual(placeCutout({w:1920,h:1080},STADIUM.wide,cut),{x:953,y:23,w:793,h:1058});
  const small=placeCutout({w:1280,h:720},STADIUM.wide,cut)!;
  for(const [k,v] of Object.entries({x:953,y:23,w:793,h:1058}))assert.ok(Math.abs(small[k as keyof typeof small]-v*2/3)<1e-9,k);
  // A narrower window (16:10): cover cuts the sides, the hero moves with the picture, his feet keep the bar.
  const pc=placeCutout({w:1280,h:800},STADIUM.wide,cut)!,s=800/1080,ox=(1280-1920*s)/2;
  assert.ok(Math.abs(pc.x-(ox+953*s))<1e-9&&Math.abs(pc.y-23*s)<1e-9&&Math.abs(pc.h-1058*s)<1e-9);
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
  assert.deepEqual(Object.keys(RECORTES),['viciado-em-bet','clt-cansado']);
});

test("tela-clt-pose2: the CLT cut out of his scene, on his own background without him (a bleed like the stadium's)",async()=>{
  const cut=cutoutOf('clt-cansado')!;
  assert.deepEqual([cut.x,cut.y,cut.w,cut.h],[792,73,635,865],'the box scripts/menu-arte.mjs checks against the art');
  assert.ok(readFileSync(new URL('../../scripts/menu-arte.mjs',import.meta.url),'utf8').includes('box:{left:792,top:73,width:635,height:865}'));
  for(const [w,file] of cut.files){
    const meta=await sharp(publicFile(file)).metadata();
    assert.equal(meta.width,w,file);assert.ok(Math.abs(meta.height!-cut.h*w/cut.w)<1,file);assert.ok(meta.hasAlpha,file);
  }
  // His background has the stadium bleed's geometry, so frameArt/placeCutout(STADIUM.bleed) fit it as they are.
  for(const file of [cut.fundo!,cut.fundo!.replace('/lite/','/')]){
    const meta=await sharp(publicFile(file)).metadata();
    assert.deepEqual([meta.width,meta.height],[STADIUM.bleed.w,STADIUM.bleed.h],file);
  }
  assert.equal(cutoutOf('viciado-em-bet')!.fundo,undefined,'the viciado keeps the stadium');
  // Every window keeps him whole (contain) with his feet on the plateau (clt-mesmo-lugar: in the viciado's place).
  for(const [w,h] of [[1920,1080],[1920,950],[1590,903],[1366,768],[1280,720],[1024,768],[2560,1080]]){
    const box={w,h},placed=placeCutout(box,STADIUM.bleed,cut)!,fit=fitCutout(box,placed),m=cutoutMargin(h),e=1e-9;
    assert.ok(fit.y>=Math.min(m,placed.y)-e&&fit.y+fit.h<=h+e&&fit.x>=-e&&fit.x+fit.w<=w+e,`${w}x${h}: CLT whole`);
    assert.ok(Math.abs(fit.y+fit.h-(placed.y+placed.h))<1e-9,`${w}x${h}: his feet on the plateau, where the framing puts it`);
  }
  // Wired: the stage swaps to his background once decoded while he stands there, and back to the stadium after.
  assert.match(main,/showStageFundo\(spot\?cut\?\.fundo:undefined,cut\?moveOf\(cut\):SEM_MOVE\);/);
  assert.match(main,/img\.decode\(\)\.catch\(\(\)=>\{\}\)\.then\(\(\)=>\{ if\(stageFundo===want\) swap\(want,move\); \}\);/);
});

test("clt-mesmo-lugar: the CLT's face and body where the viciado's are, his plateau moved with him under his feet",async()=>{
  const clt=cutoutOf('clt-cansado')!,vic=cutoutOf('viciado-em-bet')!,move=moveOf(clt);
  assert.deepEqual(clt.lugar,{de:'viciado-em-bet',k:1.12,dy:26});
  assert.equal(moveOf(vic),SEM_MOVE,'the viciado stays where his picture has him');
  // The faces (eyes to chin, cheek to cheek) are faces: skin-and-features boxes inside each 1x file, not hair or cap.
  for(const cut of [vic,clt]){
    const r=cut.rosto;
    assert.ok(r.x>cut.x&&r.y>cut.y&&r.x+r.w<cut.x+cut.w&&r.y+r.h<cut.y+cut.h*.45,`${cut.files[0][1]}: face in the top of the box`);
    assert.ok(r.w>=120&&r.w<=220&&r.h>=110&&r.h<=200);
  }
  // On the stage's picture his face's middle is the viciado's, dy lower; scaled by k.
  const there=rostoNoPalco(vic),mine=rostoNoPalco(clt);
  assert.ok(Math.abs(mine.x+mine.w/2-(there.x+there.w/2))<1e-9&&Math.abs(mine.y+mine.h/2-(there.y+there.h/2)-26)<1e-9);
  // Every window (PC: the cutouts; the phone keeps the dance, both on the same spot of the bar): the faces' middles
  // within 3% of the width and of the height, the faces as tall within 10%, his hair as far under the top as the cap.
  for(const [w,h] of [[1920,1080],[1920,1000],[1920,950],[1917,948],[1590,903],[1366,768],[1280,720],[1280,800],[1280,1024],[2560,1080],[1024,768],[3440,1440]]){
    const box={w,h},on=(cut:typeof vic)=>{
      const fit=fitCutout(box,placeCutout(box,STADIUM.bleed,cut)!),k=fit.w/cut.w,r=cut.rosto;
      return {cx:fit.x+(r.x-cut.x+r.w/2)*k,cy:fit.y+(r.y-cut.y+r.h/2)*k,h:r.h*k,top:fit.y,bottom:fit.y+fit.h};
    };
    const a=on(vic),b=on(clt);
    assert.ok(Math.abs(a.cx-b.cx)<=.03*w,`${w}x${h}: faces ${a.cx.toFixed(0)} × ${b.cx.toFixed(0)} across`);
    assert.ok(Math.abs(a.cy-b.cy)<=.03*h,`${w}x${h}: faces ${a.cy.toFixed(0)} × ${b.cy.toFixed(0)} down`);
    assert.ok(b.h/a.h>=.9&&b.h/a.h<=1.1,`${w}x${h}: faces as big`);
    assert.ok(b.top>=a.top-1.5&&b.bottom<=h,`${w}x${h}: CLT whole, his hair no closer to the top than the viciado's cap`);
    // His background where his move puts it, always covering the box; he stands in it exactly where his scene had him.
    const {s,ox,oy}=frameMoved(box,STADIUM.bleed,move),f=STADIUM.bleed.focal,e=1e-6;
    assert.ok(ox<=e&&oy<=e&&ox+STADIUM.bleed.w*s>=w-e&&oy+STADIUM.bleed.h*s>=h-e,`${w}x${h}: his background covers the box`);
    const placed=placeCutout(box,STADIUM.bleed,clt)!;
    assert.ok(Math.abs(placed.x-(ox+(f.x+clt.x)*s))<e&&Math.abs(placed.y+placed.h-(oy+(f.y+clt.y+clt.h)*s))<e,`${w}x${h}: feet on his plateau`);
  }
  // 1920x1080: the stadium's framing moved by k, his box 12% bigger, right of where his scene had him (whole-picture px
  // 950..970, through the stadium's framing: estadio-folga-topo stands it further back).
  const at=placeCutout({w:1920,h:1080},STADIUM.bleed,clt)!,stadium=frameArt({w:1920,h:1080},STADIUM.bleed),px=(X:number)=>stadium.ox+(STADIUM.bleed.focal!.x+X)*stadium.s;
  assert.ok(Math.abs(at.w-635*1.12*stadium.s)<1e-9&&at.x>px(950)&&at.x<px(970),JSON.stringify(at));
  // Wired: the stage's background framed with the shown picture's move, set together with the picture.
  assert.match(main,/frame=art\.focal&&box\.w>0&&box\.h>0\?frameMoved\(box,art,stageMove\):undefined;/);
  assert.match(main,/const swap=\(image:string,m:Move\)=>\{stage\.style\.backgroundImage=image;stageMove=m;frameStage\(\{w:stage\.clientWidth,h:stage\.clientHeight\}\);\};/);
});

test('menu-1080-720-menino-inteiro: the whole boy on screen at 1080p and 720p, the letreiro 15% smaller',()=>{
  const cut=cutoutOf('viciado-em-bet')!;
  // The user's screens: 1080p, 1080p with the browser's bar (his print, 1917x948), 768p and 720p. Cap, horn and sneakers
  // (the file's alpha fills its box) inside the stage, the head under the margin, the feet where the picture puts them.
  for(const [w,h] of [[1920,1080],[1920,950],[1917,948],[1366,768],[1280,720],[1280,800],[2560,1080]]){
    const box={w,h},placed=placeCutout(box,STADIUM.wide,cut)!,fit=fitCutout(box,placed),m=cutoutMargin(h);
    assert.ok(fit.y>=Math.min(m,placed.y)-1e-9&&fit.y+fit.h<=h+1e-9,`${w}x${h}: top ${fit.y}, bottom ${fit.y+fit.h}`);
    assert.ok(Math.abs(fit.y+fit.h-Math.min(h,placed.y+placed.h))<1e-9,`${w}x${h}: feet where the picture has them`);
    assert.ok(fit.x>=-1e-9&&fit.x+fit.w<=w+1e-9,`${w}x${h}: left ${fit.x}, right ${fit.x+fit.w}`);
    assert.ok(Math.abs(fit.w/fit.h-cut.w/cut.h)<1e-9,'contain: never stretched');
    assert.ok(fit.h<=placed.h+1e-9&&fit.y+fit.h<=placed.y+placed.h+1e-9,'never bigger, never lower than cover put him');
    assert.ok(Math.abs(fit.x+fit.w/2-(placed.x+placed.w/2))<1e-9,'his middle stays');
  }
  // 1920x950 was the cut one: cover put his cap 111 px above the screen; now ~88% of that, the cap on screen, feet put.
  const bar=fitCutout({w:1920,h:950},placeCutout({w:1920,h:950},STADIUM.wide,cut)!);
  assert.ok(Math.abs(bar.y-19)<1e-9&&Math.abs(bar.y+bar.h-950)<1e-9,JSON.stringify(bar));
  assert.match(main,/placed=cut&&placeCutout\(box,STADIUM\.bleed,cut\),spot=placed&&fitCutout\(box,placed\);/);
  // The letreiro: 46vw / 78vh x .85 (the user, 21/10); the phone keeps its own sizes.
  // Then 15% smaller again (menu-fundo-sangria): 46vw / 78vh x .85 x .85.
  assert.ok(css.includes('.estadio-titulo.com-letreiro .estadio-letreiro { width: min(33.2vw, 56.4vh);'));
  assert.ok(Math.abs(46*.85*.85-33.2)<.05&&Math.abs(78*.85*.85-56.4)<.05);
  // The button right under the row (fileira-botao-maiores-embaixo: both low, pinned to the bottom on the PC).
  assert.ok(css.includes('.estadio-escolha:has(.com-letreiro)::after { display: none; }'));
  assert.ok(!/\.estadio-confirmar \{[^}]*margin-top: auto/.test(css));
  assert.ok(!css.includes('margin-bottom: 5vh'));
  assert.ok(css.includes('.estadio-titulo.com-letreiro .estadio-letreiro { width: auto; max-width: 100%; max-height: 16vh; margin-inline: auto; }'));
});

test('menu-fundo-sangria: on the PC the E6 bleed is framed so the approved picture is whole and no edge shows',async()=>{
  const art=STADIUM.bleed,f=art.focal!;
  const meta=await sharp(publicFile('/art/lite/menu/fundo-estadio-viciado.webp')).metadata();
  assert.deepEqual([meta.width,meta.height],[art.w,art.h],'the file is the size STADIUM.bleed says');
  for(const [w,h] of [[1920,1080],[1920,950],[1917,948],[1590,903],[1366,768],[1280,720],[1280,800],[1280,1024],[1024,768],[2560,1080],[3440,1440],[1600,521]]){
    const box={w,h},{s,ox,oy}=frameArt(box,art),e=1e-9;
    assert.ok(ox<=e&&oy<=e&&ox+art.w*s>=w-e&&oy+art.h*s>=h-e,`${w}x${h}: the file covers the box`);
    // The approved 1920x1080 inside the box (21:9 and wider: as wide as the box, the sky/feet past it never matter),
    // but for the few px of sky raised out at the top to keep FEET_MARGIN under the lowest sole (heroi-esrgan-no-ar).
    const fx=ox+f.x*s,fy=oy+f.y*s;
    if(w/h<=2560/1080+e) assert.ok(fx>=-.5&&fy>=-(FEET_MARGIN+(art.feet!-f.h)*s)-.5&&fx+f.w*s<=w+.5&&fy+f.h*s<=h+.5,`${w}x${h}: approved picture whole`);
    assert.ok(oy+(f.y+art.feet!)*s<=h-FEET_MARGIN+1e-6,`${w}x${h}: ${FEET_MARGIN} px under the lowest sole`);
    // The boy (in the approved picture) whole, and still where the picture has him before the margin's fit.
    const placed=placeCutout(box,art,cutoutOf('viciado-em-bet')!)!;
    assert.ok(Math.abs(placed.x-(fx+953*s))<1e-6&&Math.abs(placed.y-(fy+23*s))<1e-6&&Math.abs(placed.h-1058*s)<1e-6,`${w}x${h}`);
    const fit=fitCutout(box,placed);
    assert.ok(fit.y>=Math.min(cutoutMargin(h),placed.y)-e&&fit.y+fit.h<=h+e,`${w}x${h}: boy whole`);
    // menu-pes-nitidez: up to 21:9 he is exactly where the approved picture has him, his soles on its floor.
    if(w/h<=2560/1080+e) assert.deepEqual(fit,placed,`${w}x${h}: not lifted, not shrunk`);
    else assert.ok(Math.abs(fit.y+fit.h-(placed.y+placed.h))<1e-6,`${w}x${h}: wider, he shrinks around his feet`);
    // The bar under the hero: inside the box, at the approved picture's bar.
    const bar=placeOnBar(box,art,w*.7)!;
    assert.ok(bar.y>0&&bar.y<h,`${w}x${h}: bar ${bar.y}`);
  }
  // 1920x1080: the approved screen plus 10% of the bleed above and to the left (estadio-folga-topo: scale 1/1.1), its right
  // edge on the window's, raised 9 px: the back sneaker (4 px lower, desce) 8 px above the bottom.
  const round=(o:Record<string,number>)=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,Math.round(v*1000)/1000]));
  assert.deepEqual(round(frameArt({w:1920,h:1080},art)),{s:.909,ox:-116.364,oy:-195.273});
  assert.deepEqual(round(placeCutout({w:1920,h:1080},art,cutoutOf('viciado-em-bet')!)!),{x:1040.909,y:110.182,w:720.909,h:961.818});
  assert.deepEqual(art.view,{x:f.x-f.w*.1,y:f.y-f.h*.1,w:f.w*1.1,h:f.h*1.1},'view: 10% more above and to the left');
  assert.equal(FEET_MARGIN,8);
  assert.equal(art.feet,Math.max(...Object.values(RECORTES).map(c=>c.y+(c.desce??0)+c.h)),'feet: the lowest sole of every hero drawn in place');
  // The plain files keep `cover` (the phone).
  assert.deepEqual(frameArt({w:1920,h:1080},STADIUM.wide),{s:1,ox:0,oy:0});
  // Wired: the PC block shows the file, main.ts frames it and puts the boy on it; the preload only where it shows.
  assert.ok(css.includes(`@media ${CUTOUT_QUERY} {\n  /* E6's stadium`));
  assert.ok(css.includes(".estadio-palco { background-image: url('/art/lite/menu/fundo-estadio-viciado.webp'); background-position: 50% 50%; }"));
  assert.match(main,/const stageArt=\(\):StadiumArt=>tallStadium\.matches\?STADIUM\.tall:cutoutScreen\.matches\?STADIUM\.bleed:STADIUM\.wide;/);
  assert.match(main,/placed=cut&&placeCutout\(box,STADIUM\.bleed,cut\)/);
  assert.match(html,/<link rel="preload" href="\/art\/lite\/menu\/fundo-estadio-viciado\.webp" as="image" fetchpriority="high" media="\(orientation: landscape\) and \(min-height: 521px\)" \/>/);
});

test('estadio-folga-topo: on the PC every hero has >= 6% of the window over his head, his feet still on the bar',()=>{
  // The user (22/10, 1920x946): the viciado's cap ~15 px under the top. The scene now stands ~9% further back (view).
  const art=STADIUM.bleed,e=1e-9;
  for(const [w,h] of [[1920,1080],[1920,1000],[1920,950],[1917,948],[1590,903],[1366,768],[1280,720],[1280,800],[1600,900]]){
    const box={w,h};
    for(const id of Object.keys(RECORTES)){
      const placed=placeCutout(box,art,cutoutOf(id)!)!,fit=fitCutout(box,placed);
      assert.ok(fit.y>=h*.06-e,`${id} ${w}x${h}: ${fit.y.toFixed(1)} px over his head (${(fit.y/h*100).toFixed(1)}%)`);
      assert.ok((['x','y','w','h'] as const).every(k=>Math.abs(fit[k]-placed[k])<1e-6),`${id} ${w}x${h}: not lifted, not shrunk (his feet where the framing puts them)`);
    }
    // The lowest sole at least FEET_MARGIN over the bottom, exactly that from 16:9 up (narrower: the bleed's floor under
    // the bar shows, as before); the bar's layer and scripts/pes-no-chao.mjs measure the rest.
    const {s,oy}=frameArt(box,art),sole=oy+(art.focal!.y+art.feet!)*s;
    assert.ok(sole<=h-FEET_MARGIN+1e-6&&(w/h<16/9-.01||sole>=h-FEET_MARGIN-1e-6),`${w}x${h}: lowest sole ${(h-sole).toFixed(1)} px over the bottom`);
  }
});

test('menu-pes-nitidez + heroi-esrgan-no-ar: the hero file by the shown width x DPR (2/3, 1x, 4/3, 2x), q95 files',async()=>{
  for(const id of ['viciado-em-bet','clt-cansado']){
    const cut=cutoutOf(id)!,ws=cut.files.map(([w])=>w);
    assert.deepEqual(ws,[2/3,1,4/3,2].map(k=>Math.round(cut.w*k)),`${id}: the box at 2/3, 1x, 4/3 and 2x`);
    const [small,one,,big]=cut.files;
    assert.equal(cutoutFile(cut,small[0]-10,1),small[1],`${id}: small window, the small file`);
    assert.equal(cutoutFile(cut,small[0]+1,1),one[1],`${id}: over the small one, the 1x one (not the 2x)`);
    assert.equal(cutoutFile(cut,cut.w*.8,2),big[1],`${id}: HiDPI counts device pixels`);
    assert.equal(cutoutFile(cut,cut.w*.9,1.25),cut.files[2][1],`${id}: Windows at 125%, the 4/3 one`);
    assert.equal(cutoutFile(cut,big[0]*2,1),big[1],`${id}: bigger than every file, the biggest`);
    const meta=await sharp(publicFile(one[1])).metadata();
    assert.deepEqual([meta.width,meta.height],[cut.w,cut.h],`${id}: the 1x file is the box`);
    const top=await sharp(publicFile(big[1])).metadata();
    assert.deepEqual([top.width,top.height],[cut.w*2,cut.h*2],`${id}: the 2x file is Real-ESRGAN's, the box twice`);
  }
  // The user's 1590x903 (DPR 1): the viciado shows ~657 px wide, so the 1x file; the 2x one only where it is needed.
  const box={w:1590,h:903},cut=cutoutOf('viciado-em-bet')!,fit=fitCutout(box,placeCutout(box,STADIUM.bleed,cut)!);
  assert.equal(cutoutFile(cut,fit.w,1),'/art/menu/heroi/viciado-em-bet-793.webp');assert.ok(fit.w<=793);
  assert.match(main,/const file=cutoutFile\(cut,spot\.w,devicePixelRatio\);/);
  assert.ok(!/cutoutImg\.srcset/.test(main),'no srcset: the choice is the one above');
  const arte=readFileSync(new URL('../../scripts/menu-arte.mjs',import.meta.url),'utf8');
  assert.ok(arte.includes('const HERO_WEBP={quality:95,alphaQuality:100,smartSubsample:true,effort:6};'));
  assert.ok(arte.includes("esrgan:'viciado-2x-x4plus-anime.png'")&&arte.includes("esrgan:'clt-2x-x4plus-anime.png'"));
});

test('heroi-esrgan-no-ar: the feet scripts/pes-no-chao.mjs checks are the soles in the approved picture, 8 px above the bottom',async()=>{
  const src=readFileSync(new URL('../../scripts/pes-no-chao.mjs',import.meta.url),'utf8');
  const pes=JSON.parse(src.match(/const PES=(\{[^\n]*\});/)![1]) as Record<string,[number,number,number][]>;
  const naMureta=JSON.parse(src.match(/const NA_MURETA=(\{[^\n]*\});/)![1]) as Record<string,{frente:[number,number];tras:[number,number,number]}>;
  // A hero on his own floor (PES) or behind a front layer (NA_MURETA), never both, never neither.
  assert.deepEqual([...Object.keys(pes),...Object.keys(naMureta)].sort(),Object.keys(RECORTES).sort());
  for(const id of Object.keys(naMureta))assert.ok(cutoutOf(id)!.frente,`${id}: NA_MURETA only for a hero with a front layer`);
  for(const [id,feet] of Object.entries(pes)){
    // Each foot's floor: the bottom edge of the sole's lowest row with alpha >= 128 in its columns of the 1x file.
    const cut=cutoutOf(id)!,one=cut.files.find(([w])=>w===cut.w)!;
    assert.equal(cut.desce??0,0,`${id}: PES is the approved picture's floor, not moved`);
    const {data,info}=await sharp(publicFile(one[1])).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    assert.equal(feet.length,2,id);
    for(const [x0,x1,floor] of feet){
      let low=-1;
      for(let x=Math.max(0,x0-cut.x);x<=Math.min(info.width-1,x1-cut.x);x++)for(let y=info.height-1;y>low;y--)if(data[(y*info.width+x)*4+3]>=128){low=y;break;}
      assert.ok(low>=0&&Math.abs(cut.y+low+1-floor)<=1,`${id} ${x0}-${x1}: the sole ends at ${cut.y+low+1}, PES says ${floor}`);
    }
  }
  // The viciado's columns hold his sneakers: the front one's sole within ±4 px of the bar's top (desce included), the
  // back one's partly under it (what the layer hides: its heel and side, ~22%; the bar's top falls faster than it).
  const cut=cutoutOf('viciado-em-bet')!,one=cut.files.find(([w])=>w===cut.w)!,{frente,tras}=naMureta['viciado-em-bet'];
  const {data,info}=await sharp(publicFile(one[1])).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const sole=(x:number)=>{for(let y=info.height-1;y>=0;y--)if(data[(y*info.width+x-cut.x)*4+3]>=128)return cut.y+cut.desce!+y+1;return NaN;};
  const front=[];for(let x=frente[0];x<=frente[1];x++)front.push(sole(x)-muretaTopo(x+.5));
  front.sort((a,b)=>a-b);
  assert.ok(Math.abs(front[front.length>>1])<=4,`front sole ${front[front.length>>1]} px from the bar's top`);
  let total=0,hidden=0;
  for(let x=tras[0];x<=tras[1];x++)for(let y=Math.max(0,tras[2]-cut.y-cut.desce!);y<info.height;y++)
    if(data[(y*info.width+x-cut.x)*4+3]>=128){total++;if(cut.y+cut.desce!+y+.5>muretaTopo(x+.5))hidden++;}
  assert.ok(hidden/total>=.2&&hidden/total<=.3,`the back sneaker ${(100*hidden/total).toFixed(0)}% under the bar's top`);
  assert.match(src,/const VIEWPORTS=\[\[1920,1080\],\[1920,1000\],\[1920,950\],\[1590,903\],\[1366,768\],\[1280,720\],\[2560,1080\],\[1024,768\]\];/);
  assert.match(src,/const TOLERANCIA=4,ALPHA=128,ALINHA=1\.5,ESCONDIDO=\.15,MESMO_LUGAR=\.03;\nconst PHONE=\[390,844\];/);
  // clt-mesmo-lugar: the faces compared at every window, his background checked by the moved framing.
  assert.match(src,/if\(Math\.abs\(dx\)>MESMO_LUGAR\|\|Math\.abs\(dy\)>MESMO_LUGAR\)/);
  assert.match(src,/frame=frameMoved\(drawn\.box,art,cut\.fundo\?moveOf\(cut\):SEM_MOVE\);/);
  assert.match(src,/margin<FEET_MARGIN-1/);
  assert.match(readFileSync(new URL('../../.github/workflows/prints.yml',import.meta.url),'utf8'),/node \.\.\/scripts\/pes-no-chao\.mjs \.\.\/folha-out/,'it runs in CI with the sheet');
});

test('mureta-camada-frente: the stadium bar cut out of the background, drawn over the viciado, framed like the background',async()=>{
  const cut=cutoutOf('viciado-em-bet')!,front=cut.frente!;
  // Over the whole hero, down past his lowest sole.
  assert.ok(front.x<=cut.x&&front.x+front.w>=cut.x+cut.w&&front.y+front.h>=cut.y+cut.desce!+cut.h,'the layer covers his box');
  const edges=Array.from({length:front.w},(_,i)=>muretaTopo(front.x+i));
  assert.ok(front.y<=Math.min(...edges)-4&&front.y+front.h>=Math.max(...edges)+4,'the whole edge inside the layer');
  // The file: the background's own px (the lite one the page draws), transparent above the edge, opaque under it.
  const meta=await sharp(publicFile(front.file)).metadata();
  assert.deepEqual([meta.width,meta.height],[front.w,front.h]);assert.ok(meta.hasAlpha);
  const layer=await sharp(publicFile(front.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const bg=await sharp(publicFile('/art/lite/menu/fundo-estadio-viciado.webp')).extract({left:STADIUM.bleed.focal!.x+front.x,top:STADIUM.bleed.focal!.y+front.y,width:front.w,height:front.h}).removeAlpha().raw().toBuffer();
  let diff=0,n=0;
  for(let x=10;x<front.w;x+=40){
    const edge=muretaTopo(front.x+x+.5)-front.y,above=Math.floor(edge)-3,below=Math.ceil(edge)+3;
    assert.ok(layer.data[(above*front.w+x)*4+3]<=8,`x ${front.x+x}: clear above the edge`);
    assert.ok(layer.data[(below*front.w+x)*4+3]>=247,`x ${front.x+x}: opaque under the edge`);
    for(let y=below;y<front.h;y+=7){for(let c=0;c<3;c++)diff+=Math.abs(layer.data[(y*front.w+x)*4+c]-bg[(y*front.w+x)*3+c]);n+=3;}
  }
  assert.ok(diff/n<4,`the layer is the background's own px (mean diff ${(diff/n).toFixed(1)})`);
  // The edge stadium.ts has is the one scripts/menu-arte.mjs measures (--mede) and cuts by.
  const arte=readFileSync(new URL('../../scripts/menu-arte.mjs',import.meta.url),'utf8');
  assert.ok(arte.includes("if(part('mureta')){")&&arte.includes('muretaTopo(box.x+x+.5)'));
  assert.deepEqual(MURETA_TOPO.coef,[997.463,94.02,38.785,-2.987]);
  assert.ok(Math.abs(muretaTopo(1277)-981)<2,'the bar under the front heel');
  // Wired: over the hero (after it in the stage), framed by the background's own rounded px, only with his cutout.
  assert.match(main,/<img class="estadio-recorte"[^>]*><img class="estadio-mureta" alt="" aria-hidden="true" decoding="async" hidden><\/div>/);
  assert.match(main,/const \{s,ox,oy\}=frameArt\(box,art\),sx=Math\.round\(art\.w\*s\)\/art\.w,sy=Math\.round\(art\.h\*s\)\/art\.h,f=art\.focal;/);
  assert.match(main,/if\(!cut\|\|!spot\) \{showFront\(box,undefined\);return;\}/);
  assert.ok(css.includes('.estadio-mureta { position: absolute; z-index: 1; pointer-events: none; }'));
  assert.equal(cutoutOf('clt-cansado')!.frente,undefined,'the CLT stands on his plateau: nothing in front of him');
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

test('botao-igual-gerado: the star, text and burst sit in the pill where the generated screen has them, at any size',()=>{
  // The rule's numbers, in --bh (the button's height).
  const rule=(sel:string)=>css.slice(css.indexOf(sel+' {')).split('\n}')[0];
  const num=(src:string,re:RegExp)=>{const m=src.match(re);assert.ok(m,String(re));return Number(m![1]);};
  const btn=rule('.estadio .estadio-confirmar'),star=rule('.estadio .estadio-confirmar > span[aria-hidden]');
  const text=rule('.estadio .estadio-confirmar-texto'),burst=rule('.estadio .estadio-confirmar::after');
  const pad=btn.match(/padding: 0 calc\(var\(--bh\) \* ([.\d]+)\) calc\(var\(--bh\) \* ([.\d]+)\) calc\(var\(--bh\) \* ([.\d]+)\);/);
  assert.ok(pad,'padding in --bh');
  const [padR,padB,padL]=pad!.slice(1).map(Number);
  const sw=num(star,/width: calc\(var\(--bh\) \* ([.\d]+)\)/),sh=num(star,/height: calc\(var\(--bh\) \* ([.\d]+)\)/);
  const textUp=num(text,/translate: 0 calc\(var\(--bh\) \* (-[.\d]+)\)/);
  const bw=num(burst,/width: calc\(var\(--bh\) \* ([.\d]+)\)/),bh=num(burst,/height: calc\(var\(--bh\) \* ([.\d]+)\)/);
  const burstUp=num(burst,/translate: 0 calc\(var\(--bh\) \* (-[.\d]+)\)/);
  // The pill art (742x149, caps 130 px = .872 --bh) is opaque on rows 3..144 and from column 3 on each side.
  const top=3/149,H=142/149,cap=.872/130;
  const middle=(1-padB)/2;
  // estrela.webp 224x211, opaque columns 8..215: `contain` in the span.
  const k=Math.min(sw/224,sh/211);
  const starBox={x0:padL+(sw-224*k)/2+8*k-3*cap,x1:padL+(sw-224*k)/2+216*k-3*cap,y0:middle-211*k/2-top,y1:middle+211*k/2-top};
  const rel=(v:number)=>v/H;
  // tela-1080p.png (evidence/NEW-20261021-ORQ-elenco-cartoon-estadio): pill x 62..877, y 863..1014 (151 px); star
  // 142..236 x 889..983; text centred at y 925.5; the burst 892..962 tall, its right edge 53 px from the pill's.
  const R=151,near=(got:number,want:number,what:string)=>assert.ok(Math.abs(got-want)<=.03,`${what}: ${got.toFixed(3)} vs ${want.toFixed(3)} (pill heights)`);
  near(rel(starBox.x0),80/R,'star left margin');near(rel(starBox.x1),174/R,'star right edge');
  near(rel(starBox.y0),26/R,'star top');near(rel(starBox.y1),120/R,'star bottom');
  near(rel(middle+textUp-top),62.5/R,'text centre');
  near(rel(bh)*191/198,70/R,'burst height (its opaque rows)');near(rel(middle+burstUp-top),64/R,'burst centre');
  near(rel(padR-3*cap),53/R,'burst right margin');
  // Whole inside the pill, on every screen (the ratios hold at any --bh: 1920x1080 … 390x844).
  for(const [w,h,px] of [[1920,1080,108],[2560,1440,120],[1366,768,76.8],[1280,720,72],[1280,800,80],[844,390,46],[390,844,71.7],[360,740,62.9]] as const){
    const s=(v:number)=>v*px,screen=`${w}x${h}`;
    assert.ok(s(starBox.y0)>=0&&s(starBox.y1)<=s(H),`${screen}: the star inside the pill, top to bottom`);
    assert.ok(s(starBox.x0)>=s(.25*H),`${screen}: air left of the star`);
  }
  // The text shrinks before it reaches the burst: SELECIONAR is 4.63 em of ink, the cap leaves 5.
  assert.ok(text.includes('font-size: min(calc(var(--bh) * .54), calc((100cqi - var(--bh) * .924) / 5));'));
  assert.ok(Math.abs(sw+bw-.924)<.001,'the cap subtracts the star and the burst');
  assert.ok(btn.includes('container-type: inline-size;'));
});

test('fileira-botao-maiores-embaixo: on the PC the row and the button 30% bigger and low, the title where it was, the block 2vw right; phones as they were',async()=>{
  const pc=css.slice(css.indexOf(`@media ${CUTOUT_QUERY} {`)).split('\n}')[0];
  const vh=(re:RegExp)=>{const m=pc.match(re);assert.ok(m,String(re));return Number(m![1])/100;};
  const pinned='.estadio-escolha > :is(.estadio-fileira, .estadio-nome, .estadio-confirmar) { position: absolute; left: 0; width: min(77vh, 60vw); }';
  assert.ok(pc.includes(pinned),'the row and the button pinned to the bottom of the column, out of its flow');
  assert.ok(pc.includes('.estadio .estadio-confirmar { --bh: max(52px, 13vh); max-width: none; bottom: max(6.2vh, env(safe-area-inset-bottom)); }'));
  const padB=.062;
  const bh=vh(/--bh: max\(52px, ([.\d]+)vh\); max-width: none;/),colW=.77;
  const gap=vh(/:is\(\.estadio-fileira, \.estadio-nome\) \{ bottom: calc\(max\(6\.2vh, env\(safe-area-inset-bottom\)\) \+ max\(52px, 13vh\) \+ ([.\d]+)vh\); \}/);
  const tile=vh(/\.estadio \.class-card \{ width: ([.\d]+)vh; \}/),arrow=vh(/\.estadio \.round-button \{ width: ([.\d]+)vh;/);
  const rowGap=vh(/\.estadio \.class-list \{ gap: ([.\d]+)vh; \}/);
  // The title and the pill where they were (round 2, "por que você desceu?"): the column keeps its old width and
  // centring, and the spacer is exactly the old row + gap + button (rules above the PC block, the old PC button).
  assert.ok(!/\.estadio-escolha \{[^}]*width:/.test(pc)&&!/\.estadio-escolha \{[^}]*justify-content: flex-end/.test(pc),'the column as it was');
  assert.ok(pc.includes(".estadio-escolha::after { content: ''; flex: none; height: calc(clamp(54px, 9vh, 80px) / .82 + 14px + clamp(8px, 1.8vh, 18px) + clamp(52px, 10vh, 120px)); }"));
  assert.ok(css.includes('.estadio .class-card {\n  flex: none; position: relative; width: clamp(54px, 9vh, 80px); height: auto; aspect-ratio: .82;'),'the spacer uses the old tile');
  assert.ok(css.includes('padding: 6px 4px 8px; margin: 0;')&&css.includes('gap: clamp(8px, 1.8vh, 18px);'),'the spacer uses the old row padding and gap');
  // The whole block a little to the right ("mover levemente para a direita"): 2vw, ~38 px at 1920.
  assert.ok(pc.includes('.estadio-escolha { left: calc(max(3vw, 16px, env(safe-area-inset-left)) + 2vw); }'));
  // 1920x1080: 30% over the old sizes (button 640x108, tiles 80, arrows 44, gaps 8), ±3%.
  const near=(got:number,want:number,what:string)=>assert.ok(Math.abs(got/want-1)<=.03,`${what}: ${got.toFixed(1)} vs ${want}`);
  near(colW*1080,832,'button width');near(bh*1080,140.4,'button height');near(tile*1080,104,'tile width');
  near(arrow*1080,57.2,'arrow');near(rowGap*1080,10.4,'gap between tiles');
  // Where tela-1080p has it: the button's bottom at 1013 (67 px of air), the row right over it.
  near(1080-padB*1080,1013,'button bottom');
  // Every PC screen: inside the window, the row under the letreiro picture and under the old title block, left of the hero.
  const sign=await sharp(publicFile('/art/menu/letreiro/viciado-em-bet.webp')).metadata(),signK=sign.height!/sign.width!;
  for(const [w,h] of [[1920,1080],[2560,1440],[1366,768],[1280,720],[1280,800]] as const){
    const screen=`${w}x${h}`,left=Math.max(.03*w,16)+.02*w,width=Math.min(colW*h,.6*w);
    const buttonTop=h-padB*h-Math.max(52,bh*h),rowTop=buttonTop-gap*h-(tile*h/.82+14);
    const signBottom=Math.max(.02*h,0)+Math.min(.332*w,.564*h)*signK;
    // The old block (title + pill + old row + old button, centred): its row's top is where the pill ended plus a gap.
    const oldBtn=Math.min(Math.max(52,.1*h),120),oldRow=Math.min(Math.max(54,.09*h),80)/.82+14,g=Math.min(Math.max(8,.018*h),18);
    const titleAndPill=.3*h,pillBottom=h/2+(titleAndPill-g-(oldRow+g+oldBtn))/2; // 1080p: measured 229 px, here 324
    assert.ok(left+width<=w*.56,`${screen}: the column ends left of the hero (${(left+width).toFixed(0)})`);
    assert.ok(rowTop>signBottom+8,`${screen}: the row (${rowTop.toFixed(0)}) under the sign (${signBottom.toFixed(0)})`);
    assert.ok(rowTop>pillBottom,`${screen}: the row (${rowTop.toFixed(0)}) under the title and the pill (${pillBottom.toFixed(0)})`);
    assert.ok(h-padB*h>=h-.07*h&&h-padB*h<=h-.05*h,`${screen}: air under the button`);
    const fit=Math.floor((width-2*arrow*h-2*rowGap*h-8)/(tile*h+rowGap*h));
    assert.ok(fit>=5,`${screen}: ${fit} tiles in the row`);
  }
  // Phones (390x844, 360x740 upright; 844x390 on its side) keep their own rules: the new sizes only in the PC block.
  for(const rule of ['width: 9.63vh','--bh: max(52px, 13vh)','width: 5.3vh','position: absolute; left: 0; width: min(77vh, 60vw)'])assert.equal(css.split(rule).length,2,`${rule} only once (the PC)`);
  assert.equal(css.split('gap: .96vh;').length,3,'the row gaps only in the PC block');
  const shortLand=css.slice(css.indexOf('@media (max-height: 520px) and (orientation: landscape) {')).split('\n}')[0];
  assert.ok(shortLand.includes('.estadio .estadio-confirmar { --bh: 46px; }')&&shortLand.includes('.estadio .class-card { width: 48px; }'));
  const tall=css.slice(css.indexOf('@media (orientation: portrait) and (max-width: 820px) {')).split('\n}')[0];
  assert.ok(tall.includes('.estadio .class-card { width: 58px; }'));
});
