/**
 * Ficha de torre and Grana in the HUD (D-048): the top bar shows the team's Grana ("R$ N") and its one material pile as
 * whole fichas (tokensOf) with a ring filling to the next one (tokenProgress), one line, spoken in pt-BR; the prices go
 * through price.ts: fichas for building (the Vigia 1, the Gustavão 3), "🗼⬆ R$ N" for an evolution, "R$ N" for the
 * forge. The player never reads coco, pedra, "unidades" nor material.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {granaReadout,tokenMarkup,tokenReadout} from '../../src/client/hud/camp.ts';
import {EVOLVE_ARROW,FREE_PRICE,evolvePriceLabel,fichasText,forgePriceLabel,granaShort,granaText,reaisText,tokenPriceLabel} from '../../src/client/hud/price.ts';
import {blockSpeech,blockText,canEvolve,selectable,treeFor,type ObraView} from '../../src/client/hud/towers/model.ts';
import {DEFENSES,EVOLVE_PRICE,RECIPES,RECIPE_IDS,TOWER_TOKENS,UNITS_PER_TOKEN,forgePrice,priceOf,tokenProgress,tokensOf} from '../../src/rules/index.ts';
import {icon} from '../../src/client/ui/icon.ts';
import {fakeView} from '../../src/client/hud/fixtures.ts';

const read=(path:string)=>readFileSync(new URL(`../../src/client/hud/${path}`,import.meta.url),'utf8');

test('the top bar counts whole fichas and fills the ring to the next one (tokensOf / tokenProgress)',()=>{
  const U=UNITS_PER_TOKEN;
  assert.deepEqual(tokenReadout(0),{tokens:0,progress:0,percent:0,label:'0 fichas de torre, próxima em 0%'});
  assert.deepEqual(tokenReadout(.9*U),{tokens:0,progress:.9,percent:90,label:'0 fichas de torre, próxima em 90%'},'"falta pouco"');
  assert.deepEqual(tokenReadout(U),{tokens:1,progress:0,percent:0,label:'1 ficha de torre, próxima em 0%'});
  assert.equal(tokenReadout(3.75*U).label,'3 fichas de torre, próxima em 75%');
  assert.equal(tokenReadout(.725*U).percent,72,'rounds down (72.5)');
  assert.equal(tokenReadout(U-.01).percent,99,'never "próxima em 100%" before the ficha shows');
  for(const bad of [Number.NaN,-5,Number.POSITIVE_INFINITY])assert.equal(tokenReadout(bad).tokens,0,String(bad));
  for(let u=0;u<=10*U;u+=7){const r=tokenReadout(u);assert.equal(r.tokens,tokensOf(u),String(u));assert.equal(r.progress,tokenProgress(u),String(u));}
});

test('the top bar markup: the tower sticker in its ring and the count, one line, no coco or pedra',()=>{
  const html=tokenMarkup(.9*UNITS_PER_TOKEN);
  assert.ok(html.includes(icon('torre')),'the tower sticker (icon sprite, art when imported)');
  assert.match(html,/^<span class="rh-camp-anel" aria-hidden="true">.*<\/span><b>0<\/b>$/,'ring first, then the count');
  assert.match(html,/class="rh-camp-anel-fundo"/,'the track always shows (N=0 at 90% still reads)');
  assert.match(html,/class="rh-camp-anel-cheio"[^>]*pathLength="100" stroke-dasharray="90 100"/);
  assert.match(tokenMarkup(0),/stroke-dasharray="0 100"/);assert.match(tokenMarkup(3.75*UNITS_PER_TOKEN),/stroke-dasharray="75 100"[^]*<b>3<\/b>$/);
  // One line: only inline pieces, no line break, no block element.
  assert.doesNotMatch(html,/\n|<br|<div|<p[ >]/);
  assert.doesNotMatch(html,/coco|pedra|unidade/i);
  const camp=read('camp.ts');
  assert.match(camp,/token\.setAttribute\('role','img'\)/);
  assert.match(camp,/token\.innerHTML=tokenMarkup\(camp\.units\);token\.setAttribute\('aria-label',tokenReadout\(camp\.units\)\.label\)/,'the label rides with the markup');
  assert.doesNotMatch(camp,/icon\('(coco|pedra)'/,'the two piles are gone from the HUD');
  const css=read('camp.css');
  assert.match(css,/\.rh-camp-token\{flex:none;white-space:nowrap\}/,'the token never wraps');
  assert.match(css,/\.rh-camp-anel\{[^}]*width:30px;height:30px\}/,'a 30 px ring fits the 40 px band');
  assert.doesNotMatch(css.match(/\.rh-camp\{[^}]*\}/)![0],/flex-wrap:wrap/);
});

test('fixtures: the "falta pouco" ring outside the forge scene, R$ 23 of Grana, and one forge tag short in its scene',()=>{
  const camp=fakeView('camp-horn',1).camp!,ring=tokenReadout(camp.units);
  assert.deepEqual([ring.tokens,ring.progress],[tokensOf(camp.units),tokenProgress(camp.units)]);
  assert.ok(ring.tokens>=1&&ring.progress>=.75,`"falta pouco": some fichas and the ring nearly full (${ring.label})`);
  assert.equal(camp.grana,23);
  // R$ 23: some evolutions yes (tiers 2 and 3), some not (tiers 4 and 5).
  assert.deepEqual(([2,3,4,5] as const).map(t=>camp.grana>=EVOLVE_PRICE[t]),[true,true,false,false]);
  const forge=fakeView('camp-forge',1).camp!,pays=RECIPE_IDS.map(id=>forge.grana>=forgePrice(id,forge.forge));
  assert.ok(pays.includes(true)&&pays.includes(false),`the forge scene shows tags both buyable and short (R$ ${forge.grana}: ${pays})`);
});

test('the top bar\'s Grana: "R$ N" in .rh-camp-grana before the fichas, spoken "R$ N do time", always shown',()=>{
  assert.deepEqual(granaReadout(120),{text:'R$ 120',label:'R$ 120 do time'});
  assert.deepEqual(granaReadout(0),{text:'R$ 0',label:'R$ 0 do time'},'none yet: still shown');
  for(const bad of [Number.NaN,-5])assert.equal(granaReadout(bad).text,'R$ 0',String(bad));
  assert.equal(granaReadout(7.4).text,'R$ 7');
  const camp=read('camp.ts');
  // The markup order in the pill: the wall (sticker, .rh-camp-barra, .rh-camp-num), the Grana, the fichas.
  const order=['rh-camp-wall','rh-camp-barra','rh-camp-num','rh-camp-grana','rh-camp-token'].map(c=>camp.indexOf(`el('span','${c}'`));
  assert.ok(order.every(i=>i>0),String(order));
  assert.deepEqual([...order].sort((a,b)=>a-b),order,'wall, bar, number, Grana, fichas');
  assert.match(camp,/el\('span','rh-camp-barra',wallRow\),num=el\('span','rh-camp-num',wallRow\)/,'the bar and the number in their own boxes (Executor-4 swaps them)');
  assert.match(camp,/el\('span','rh-camp-track',barra\)[^\n]*el\('b','rh-camp-hp',num\)/);
  assert.match(camp,/const grana=el\('span','rh-camp-grana',readout\);grana\.setAttribute\('role','img'\)/);
  assert.match(camp,/granaValue\.textContent=money\.text;grana\.setAttribute\('aria-label',money\.label\)/,'the label rides with the text');
  assert.doesNotMatch(camp,/grana\.hidden/,'never hidden');
  const css=read('camp.css');
  assert.match(css,/\.rh-camp-grana\{flex:none;[^}]*white-space:nowrap\}/,'the Grana never shrinks nor wraps');
  assert.match(css,/\.rh-camp-barra\{[^}]*flex:0 1 auto;min-width:16px\}/,'the bar gives way first');
  assert.match(css,/\.rh-camp-wall>\.ic,\.rh-camp-num\{flex:none\}/,'the sticker and the life never shrink');
  assert.match(read('hud.css'),/\.rh-top \.rh-camp-barra\{flex:0 1 auto;min-width:16px\}/);
});

test('prices: fichas for building, "🗼⬆ R$ N" for an evolution, "R$ N" for the forge, no material crate',()=>{
  assert.deepEqual(tokenPriceLabel(TOWER_TOKENS.root),{html:`<b>1</b>${icon('torre')}`,speech:'1 ficha de torre'});
  assert.equal(tokenPriceLabel(TOWER_TOKENS.gustavao).speech,'3 fichas de torre');
  assert.equal(fichasText(0),'0 fichas de torre');
  assert.deepEqual([granaText(12),reaisText(12),reaisText(1),reaisText(0)],['R$ 12','12 reais','1 real','0 reais']);
  const reparo=RECIPES.reparo.cost;
  assert.deepEqual(forgePriceLabel(reparo),{html:`<b>R$ ${reparo}</b>`,speech:`${reparo} reais`});
  // The evolve price: the tower sticker and the up arrow, then "R$ N"; spoken as the whole verb.
  const evolve=evolvePriceLabel(EVOLVE_PRICE[2]);
  assert.deepEqual(evolve,{html:`<span class="rh-preco-evoluir">${icon('torre')}${EVOLVE_ARROW}</span><b>R$ ${EVOLVE_PRICE[2]}</b>`,speech:`Evoluir por ${EVOLVE_PRICE[2]} reais`});
  assert.match(EVOLVE_ARROW,/^<svg class="rh-preco-sobe"[^>]*aria-hidden="true"/,'the arrow is decorative');
  assert.ok(evolve.html.indexOf(icon('torre'))<evolve.html.indexOf('rh-preco-sobe')&&evolve.html.indexOf('rh-preco-sobe')<evolve.html.indexOf('R$'),'🗼 ⬆ R$');
  assert.equal(evolvePriceLabel(1).speech,'Evoluir por 1 real');
  assert.deepEqual(granaShort(3),{html:'Falta R$ 3',speech:'Faltam 3 reais'});assert.equal(granaShort(1).speech,'Falta 1 real');
  assert.equal(FREE_PRICE.speech,'grátis');
  for(const p of [tokenPriceLabel(3),forgePriceLabel(7),evolvePriceLabel(35),FREE_PRICE,granaShort(2)]){
    assert.doesNotMatch(`${p.html} ${p.speech}`,/coco|pedra|unidade|material/i);
    assert.ok(!p.html.includes(icon('material')),'the crate is gone from prices');
  }
  // Every price in the forge and the obra goes through these helpers.
  const camp=read('camp.ts'),obra=read('towers/obra.ts'),price=read('price.ts');
  assert.doesNotMatch(price,/icon\('material'\)/);
  assert.match(camp,/forgePriceLabel\(r\.cost\)\.html/);assert.match(camp,/Custa \$\{forgePriceLabel\(cost\)\.speech\}/);
  assert.match(obra,/const priceOf=\(c:ObraCard\):PriceLabel=>c\.tokens!==undefined\?tokenPriceLabel\(c\.tokens\):c\.grana!==undefined\?evolvePriceLabel\(c\.grana\):FREE_PRICE;/);
  assert.doesNotMatch(obra,/rh-obra-mat|icon\('(coco|pedra|material)'\)/,'the two-icon material display is gone');
  // The evolve button reads only "🗼⬆ R$ N" (spoken "Evoluir por N reais"); a build or the Gustavão keep the verb.
  assert.match(obra,/const bare=!!price&&!v\.readOnly&&chosen\?\.grana!==undefined;/);
  assert.match(obra,/ok\.innerHTML=`\$\{bare\?'':`<span>\$\{verb\}<\/span>`\}/);
  assert.match(obra,/bare\?`\$\{price\.speech\}, \$\{chosen\.name\}`/);
});

const obraView=(over:Partial<ObraView>={}):ObraView=>({prepare:true,sites:[],balance:{units:0},grana:0,standing:0,gustavoes:0,...over});
test('the obra gates on Grana: an evolution is open when the Grana pays its tier\'s price; "Falta R$ N"',()=>{
  const vigia={id:'obra-01',x:0,y:0,maxSize:3 as const,tower:{id:'d',kind:'vigia-do-predio' as const}};
  for(const d of Object.values(DEFENSES)){
    const p=priceOf(d);
    if(d.id==='gustavao'||d.tier===1)assert.ok('tokens' in p,d.id);else assert.ok('grana' in p&&p.grana===EVOLVE_PRICE[d.tier as 2|3|4|5],d.id);
  }
  const short=treeFor(vigia,obraView({balance:{units:400},grana:EVOLVE_PRICE[2]-4}));
  assert.ok(short.branches.every(b=>b.block==='grana'&&b.missing===4&&!selectable(b)),'10 fichas do not pay an evolution');
  assert.equal(blockText(short.branches[0]),'Falta R$ 4');assert.equal(blockSpeech(short.branches[0]),'Faltam 4 reais');
  assert.equal(canEvolve(vigia,obraView({grana:EVOLVE_PRICE[2]-1})),false);
  const paid=treeFor(vigia,obraView({grana:EVOLVE_PRICE[2]}));
  assert.ok(paid.branches.every(b=>selectable(b)&&b.grana===EVOLVE_PRICE[2]&&b.tokens===undefined));
  assert.equal(canEvolve(vigia,obraView({grana:EVOLVE_PRICE[2]})),true);
  // The root stays "1 🗼" from the pile (tokensOf), whatever the Grana.
  const root=treeFor({id:'obra-02',x:0,y:0,maxSize:3},obraView({balance:{units:UNITS_PER_TOKEN},grana:0})).head;
  assert.deepEqual([root.tokens,root.grana,selectable(root)],[TOWER_TOKENS.root,undefined,true]);
  const noFicha=treeFor({id:'obra-02',x:0,y:0,maxSize:3},obraView({balance:{units:UNITS_PER_TOKEN-1},grana:999})).head;
  assert.deepEqual([noFicha.block,blockText(noFicha)],['balance','Falta 1 ficha'],'Grana never pays a ficha');
});
