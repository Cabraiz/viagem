import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DICAS_KEY,GAP_MS,START_MS,TIPS,TIP_MS,TIP_ORDER,TipCoach,loadLearned,resetTipMemory,type Tip,type TipInput} from '../../src/client/hud/coach/dicas.ts';
import {AIM_DEAD_ZONE_PX,BLOCKERS,DRAG_PX,FILLED_SLOT,HOLD_DROP_MS,WALK_LIGHT,dicaFor} from '../../src/client/hud/coach/dicas-dom.ts';
import {applyControls,controlsFor} from '../../src/client/controls-phase.ts';

function memStore(init?:string){
  const map=new Map<string,string>();if(init!==undefined)map.set(DICAS_KEY,init);
  return {map,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};
}
const ALL=new Set<Tip>(TIP_ORDER);
const input=(now:number,over:Partial<TipInput>={}):TipInput=>({now,kind:'touch',blocked:false,ready:true,can:ALL,...over});

test('copy: pt-BR, one short row each, the phone has all three, the desktop only the drop',()=>{
  assert.deepEqual(TIPS.touch,{aim:'Arrasta o Atacar pra mirar',zoom:'Dois dedos no mapa: zoom',drop:'Segura o item pra largar'});
  assert.deepEqual(Object.keys(TIPS.mouse),['drop']);
  for(const kind of ['touch','mouse'] as const)for(const text of Object.values(TIPS[kind]))assert.ok(text.length<=34,text);
});
test('one at a time, in order, after the start quiet; each leaves after TIP_MS and the gap',()=>{
  resetTipMemory();const store=memStore(),coach=new TipCoach(store);
  assert.equal(coach.step(input(0)),undefined,'start quiet');
  assert.equal(coach.step(input(START_MS)),'aim');
  assert.equal(coach.step(input(START_MS+TIP_MS-1)),'aim');
  assert.equal(coach.step(input(START_MS+TIP_MS)),undefined,'shown long enough');
  assert.deepEqual(JSON.parse(store.map.get(DICAS_KEY)!),['aim'],'seen counts as learned');
  const t=START_MS+TIP_MS;
  assert.equal(coach.step(input(t+GAP_MS-1)),undefined,'gap');
  assert.equal(coach.step(input(t+GAP_MS)),'zoom');
});
test('the gesture takes its tip away at once, even before it shows',()=>{
  resetTipMemory();const coach=new TipCoach(memStore());
  coach.step(input(0));assert.equal(coach.step(input(START_MS)),'aim');
  coach.done('aim',START_MS+100);
  assert.equal(coach.step(input(START_MS+100)),undefined);
  coach.done('zoom',START_MS+200);
  assert.equal(coach.step(input(START_MS+100+GAP_MS)),'drop','zoom was done unseen');
});
test('a pause or level-up hides the tip and stops its clock; the walk light holds them back',()=>{
  resetTipMemory();const coach=new TipCoach(memStore());
  assert.equal(coach.step(input(0,{ready:false})),undefined);
  assert.equal(coach.step(input(10_000,{ready:false})),undefined,'still the walk light');
  coach.step(input(10_000));assert.equal(coach.step(input(10_000+START_MS)),'aim');
  const s=10_000+START_MS;
  assert.equal(coach.step(input(s+1000,{blocked:true})),undefined);
  assert.equal(coach.step(input(s+60_000,{blocked:true})),undefined);
  assert.equal(coach.step(input(s+60_000)),'aim','the clock waited');
  assert.equal(coach.step(input(s+60_000+TIP_MS-1500)),'aim','1 s before + this 4.5 s < 6 s');
});
test('only what makes sense: no aim in auto combat, no drop with the backpack empty; the desktop only drops',()=>{
  resetTipMemory();const coach=new TipCoach(memStore());
  coach.step(input(0,{can:new Set(['zoom'])}));
  assert.equal(coach.step(input(START_MS,{can:new Set(['zoom'])})),'zoom');
  assert.equal(coach.step(input(START_MS+100,{can:new Set([])})),undefined,'gone when it stops applying');
  resetTipMemory();const pc=new TipCoach(memStore());
  pc.step(input(0,{kind:'mouse'}));
  assert.equal(pc.step(input(START_MS,{kind:'mouse'})),'drop');
});
test('first match only: the result closes it; storage broken or off still works for the page',()=>{
  resetTipMemory();const store=memStore(),coach=new TipCoach(store);
  coach.endRun();assert.equal(store.map.has(DICAS_KEY),false,'a match that never ran the coach teaches nothing');
  coach.step(input(0));coach.endRun();
  assert.deepEqual(JSON.parse(store.map.get(DICAS_KEY)!),[...TIP_ORDER]);
  assert.equal(new TipCoach(store).over,true);
  resetTipMemory();
  assert.equal(loadLearned(memStore('{oops')).size,0);
  const broken={getItem:()=>{throw new Error('private');},setItem:()=>{throw new Error('quota');}};
  const c=new TipCoach(broken);c.step(input(0));c.endRun();
  assert.equal(new TipCoach(broken).over,true,'remembered in memory');
  resetTipMemory();
});

/** The shell stand-in: dataset, the etiqueta and a set of selectors that match. */
function fakeShell(matches:string[]=[]){
  const hint={dataset:{} as Record<string,string>,hidden:true,rows:[] as string[],
    ownerDocument:{createElement:()=>({textContent:''})},
    replaceChildren(...rows:{textContent:string}[]){this.rows=rows.map(r=>r.textContent);}};
  const on=new Set(matches);
  const root={dataset:{combat:'manual'} as Record<string,string>,on,
    querySelector:(s:string)=>s==='.explore-stick-hint'?hint:on.has(s)?{}:null};
  return {root:root as unknown as HTMLElement&{on:Set<string>},hint};
}
test('applyControls in the round: the etiqueta shows the tip above the stick, hides it for a level-up',()=>{
  resetTipMemory();
  const {root,hint}=fakeShell([FILLED_SLOT]);const combat=controlsFor({phase:'combat'});
  const tip=(at:number)=>dicaFor(root,combat,at);
  assert.equal(tip(0),undefined);
  assert.deepEqual(tip(START_MS),{tip:'aim',text:TIPS.touch.aim});
  applyControls(root,combat);
  assert.equal(hint.hidden,false);assert.equal(hint.dataset.dica,'aim');assert.deepEqual(hint.rows,[TIPS.touch.aim]);
  root.on.add(BLOCKERS);
  assert.equal(tip(START_MS+1000),undefined,'sensed again after SENSE_MS: blocked');
  applyControls(root,combat);assert.equal(hint.hidden,true);
  root.on.delete(BLOCKERS);assert.deepEqual(tip(START_MS+2000)?.tip,'aim');
  // The lobby words still win outside the round, and drop the tip mark.
  applyControls(root,controlsFor({phase:'lobby'}));assert.equal(hint.dataset.dica,undefined);assert.equal(hint.hidden,false);
  resetTipMemory();
});
test('the walk light holds the tips; the result ends the first match for good',()=>{
  resetTipMemory();
  const {root}=fakeShell([WALK_LIGHT]);const combat=controlsFor({phase:'combat'});
  assert.equal(dicaFor(root,combat,0),undefined);assert.equal(dicaFor(root,combat,START_MS*4),undefined);
  root.on.add('.rh-ended');
  dicaFor(root,controlsFor({phase:'result'}),START_MS*5);
  const {root:next}=fakeShell();
  for(const at of [0,START_MS,TIP_MS*3])assert.equal(dicaFor(next,combat,at),undefined,'the next match has none');
  resetTipMemory();
});
test('design: the tips ride above the stick, tokens only; the css is loaded by the HUD, not by explore',()=>{
  const css=readFileSync('src/client/hud/coach/dicas.css','utf8');
  assert.match(css,/\.explore-stick-hint\[data-dica\]\{bottom:calc\(100% \+ 8px\)\}/);
  assert.match(readFileSync('src/client/hud/hud.ts','utf8'),/import '\.\/coach\/dicas\.css';/);
  assert.doesNotMatch(readFileSync('src/client/hud/coach/dicas-dom.ts','utf8'),/\.css'/);
});
test('the gesture thresholds match the controls they watch',()=>{
  const num=(file:string,name:string)=>Number(readFileSync(file,'utf8').match(new RegExp(`export const ${name}=([0-9]+)`))?.[1]);
  assert.equal(num('src/client/hud/attack-button.ts','AIM_DEAD_ZONE_PX'),AIM_DEAD_ZONE_PX);
  assert.equal(num('src/client/hud/inventory.ts','HOLD_DROP_MS'),HOLD_DROP_MS);
  assert.equal(num('src/client/hud/inventory.ts','DRAG_PX'),DRAG_PX);
});
