// The caça-níquel of the dourada escondida (NEW-20261023-ORQ-caixa-gamble-raridade, hud/caca-niquel.ts).
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {RunView,SimEvent} from '../../src/contract/index.ts';
import {FADE_IN_MS,FADE_OUT_AT_MS,REEL_CELLS,REEL_STOP_MS,SLOT_MS,cratesOf,createCacaNiquel,goldTurn,reelStrip} from '../../src/client/hud/caca-niquel.ts';
import {itemDisplay} from '../../src/client/hud/items.ts';
import {GOLD_HIDDEN_FROM,GOLD_RARITY} from '../../src/sim/crates.ts';
import {KIT_POOL,kitId} from '../../src/rules/tower-kits.ts';

const chest=(over:Partial<Extract<SimEvent,{type:'pickup'}>>={},eventId=1):SimEvent=>
  ({type:'pickup',player:'eu',pickup:'k1',kind:'chest',value:4,eventId,...over} as SimEvent);
const seen=(value:number,resource='pistola')=>new Map([['k1',{value,resource}]]);

test('goldTurn: my crate that showed verde/azul/roxa and gave dourada; nothing else',()=>{
  assert.equal(GOLD_RARITY,4);
  for(const shown of GOLD_HIDDEN_FROM)assert.equal(goldTurn(chest(),seen(shown),'eu'),'pistola',`shown ${shown}`);
  assert.equal(goldTurn(chest(),seen(4),'eu'),undefined,'a dourada on the map is no surprise');
  assert.equal(goldTurn(chest({value:2}),seen(2),'eu'),undefined,'it did not turn');
  assert.equal(goldTurn(chest({player:'outro'}),seen(1),'eu'),undefined,'another hero opened it');
  assert.equal(goldTurn(chest(),new Map(),'eu'),undefined,'a crate this client never saw');
  assert.equal(goldTurn(chest(),seen(1,kitId(KIT_POOL[1][0])),'eu'),undefined,'a kit never turns');
  assert.equal(goldTurn({type:'kill',enemy:'e',kind:'bebado',x:0,y:0,eventId:1} as SimEvent,seen(1),'eu'),undefined);
});

test('cratesOf: the crates of a view by id, with their colour and item',()=>{
  const view={pickups:[{id:'k1',kind:'chest',x:0,y:0,value:2,resource:'pistola'},{id:'x1',kind:'xp',x:0,y:0,value:1}]} as Pick<RunView,'pickups'>;
  assert.deepEqual([...cratesOf(view)],[['k1',{value:2,resource:'pistola'}]]);
});

test('reelStrip: REEL_CELLS weapons ending on the weapon, never the same twice in a row, seeded',()=>{
  for(let seed=1;seed<50;seed++){
    const strip=reelStrip('pistola',seed);
    assert.equal(strip.length,REEL_CELLS);
    assert.equal(strip.at(-1),'pistola');
    for(let i=1;i<strip.length;i++)assert.notEqual(strip[i],strip[i-1],`${seed}: ${strip.join()}`);
    for(const id of strip)assert.equal(itemDisplay(id).kind,'weapon');
  }
  assert.deepEqual(reelStrip('pistola',7),reelStrip('pistola',7));
  assert.notDeepEqual(reelStrip('pistola',7),reelStrip('pistola',8));
});

// ---------- the part, on a minimal fake DOM ----------
class FakeEl {
  hidden=false;innerHTML='';className='';dataset:Record<string,string>={};attrs=new Map<string,string>();
  setAttribute(k:string,v:string){this.attrs.set(k,v);}
  querySelectorAll(){return [];}
}
const fakeDoc={createElement:()=>new FakeEl()} as unknown as Document;
const view=(events:SimEvent[],pickups:RunView['pickups']=[])=>({events,pickups} as unknown as RunView);
const ctx={localId:'eu'} as never;

test('the part: plays when my crate turns dourada (colour from the view before), hides after SLOT_MS, each event once',()=>{
  mock.timers.enable({apis:['setTimeout']});
  try{
    const played:string[]=[];
    const part=createCacaNiquel(fakeDoc,{onPlay:item=>played.push(item)}),el=part.el as unknown as FakeEl;
    assert.equal(el.hidden,true);
    part.update(view([],[{id:'k1',kind:'chest',x:0,y:0,value:1,resource:'pistola'}]),ctx);
    part.update(view([chest()]),ctx);
    assert.deepEqual(played,['pistola']);
    assert.equal(part.playing,true);assert.equal(el.hidden,false);
    assert.match(el.innerHTML,/DOURADA!/);
    assert.equal((el.innerHTML.match(/rh-cn-reel"/g)??[]).length,REEL_STOP_MS.length,'three reels');
    assert.equal(el.attrs.get('aria-label'),`${itemDisplay('pistola').name} dourada!`);
    part.update(view([chest()]),ctx);
    assert.equal(played.length,1,'the same event (resent) plays once');
    mock.timers.tick(SLOT_MS-1);assert.equal(part.playing,true);
    mock.timers.tick(1);assert.equal(part.playing,false);assert.equal(el.hidden,true);assert.equal(el.innerHTML,'');
    // A crate that showed dourada, or a hero who is not me: nothing.
    part.update(view([],[{id:'k2',kind:'chest',x:0,y:0,value:4,resource:'pistola'}]),ctx);
    part.update(view([chest({pickup:'k2'},2)]),ctx);
    assert.equal(played.length,1);
  }finally{mock.timers.reset();}
});

test('the CSS runs SLOT_MS, fades in FADE_IN_MS and out from FADE_OUT_AT_MS, stops the reels at REEL_STOP_MS, never takes the pointer',()=>{
  const css=readFileSync(new URL('../../src/client/hud/caca-niquel.css',import.meta.url),'utf8');
  assert.match(css,/\.rh \.rh-cn\{[^}]*pointer-events:none/);
  assert.match(css,new RegExp(`animation:rh-cn-fade ${SLOT_MS}ms`));
  const pct=(ms:number)=>`${+(ms/SLOT_MS*100).toFixed(1)}%`;
  assert.match(css,new RegExp(`@keyframes rh-cn-fade\\{0%\\{opacity:0\\}${pct(FADE_IN_MS)}\\{opacity:1\\}${pct(FADE_OUT_AT_MS)}\\{opacity:1\\}100%\\{opacity:0\\}\\}`));
  assert.match(css,new RegExp(`rh-cn-banner 500ms [^;]* ${REEL_STOP_MS.at(-1)}ms`),'the banner when the last reel stops');
  assert.match(css,/prefers-reduced-motion/);
});
