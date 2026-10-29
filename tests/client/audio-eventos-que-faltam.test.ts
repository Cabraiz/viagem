/**
 * NEW-20261029-ORQ-som-eventos-que-faltam (auditoria de som, itens 15, 16, 19 e 24): which SimEvents play what, with
 * files that already exist. A hit on the boss or an elite is chefe-acerto, the rescued hero gets up ('levantar' with
 * the 'ufa'), a danger warning thumps low from its side (one per WARN_MS, none far away), and a barricade, the wall or
 * the Uno breaking is a heavy golpe (a tower's end of life stays silent).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {SimEvent} from '../../src/contract/index.ts';
import {CAR_ID} from '../../src/contract/index.ts';
import type {SoundId} from '../../src/client/audio/types.ts';
import {SFX} from '../../src/client/audio/sfx.ts';
import {GemCombo} from '../../src/client/audio/recipes.ts';
import {cueForEvent,playEvents,WarnGate,CRIT_CUE,HIT_RATES,BREAK_CUE,WARN_MS,WARN_RANGE,WARN_PAN,WARN_SPAWN_RATE,WARN_ATTACK_RATE,
  type EventWorld} from '../../src/client/audio/events.ts';

const ME='p1';
function rig(world?:EventWorld){
  let now=0;const calls:[SoundId,Record<string,unknown>][]=[];const warn=new WarnGate();
  const play=(events:SimEvent[],elite?:(id:string)=>boolean)=>playEvents({play:(id,opts)=>{calls.push([id,{...opts}]);return true;}},events,ME,
    undefined,elite,{gems:new GemCombo(),warn,now:()=>now},world);
  return {calls,play,at:(ms:number)=>{now=ms;}};
}

test('item 15: my hit on an elite or the boss lands with chefe-acerto; a crit keeps its low, loud pitch',()=>{
  const elite=(id:string)=>id==='el',world:EventWorld={boss:id=>id==='bo'};
  for(const target of ['el','bo']){
    const hit=cueForEvent({type:'damage',target,amount:3,source:ME,weapon:'faca'},ME,elite,world)!;
    assert.equal(hit.id,'chefe-acerto',target);assert.ok(HIT_RATES.includes(hit.rate!));
    assert.deepEqual(cueForEvent({type:'damage',target,amount:9,source:ME,weapon:'pistola',crit:true},ME,elite,world),{id:'chefe-acerto',...CRIT_CUE});
  }
  assert.equal(cueForEvent({type:'damage',target:'e1',amount:3,source:ME,weapon:'pistola'},ME,elite,world)!.id,'bicho-acerto');
  assert.equal(cueForEvent({type:'damage',target:'e1',amount:3,source:ME,weapon:'faca'},ME,elite,world)!.id,'golpe');
  assert.equal(cueForEvent({type:'damage',target:'bo',amount:3,source:'p2'},ME,elite,world),undefined,"another's hit: silent");
  assert.ok(SFX['chefe-acerto'].throttleMs>=100,'a crowd of hits on the boss is throttled');
});

test('item 16: the rescued hero hears the ufa and gets up; the rescuer and the team do not',()=>{
  const r=rig();
  r.play([{type:'revived',player:ME,by:'p2'}]);
  assert.deepEqual(r.calls.map(c=>c[0]),['ufa','levantar']);
  r.calls.length=0;r.play([{type:'revived',player:'p2',by:ME},{type:'revived',player:'p3',by:'p2'}]);
  assert.deepEqual(r.calls.map(c=>c[0]),['resgate','resgate']);
});

test('item 19: a spawn warning thumps low, quieter far away, from its side of the screen; none past WARN_RANGE',()=>{
  const world:EventWorld={hero:{x:0,y:0},side:p=>Math.sign(p.x)};
  const near=cueForEvent({type:'spawn-warning',x:4,y:0,atTick:10,count:5},ME,undefined,world)!;
  assert.equal(near.id,'chefe-passo');assert.equal(near.rate,WARN_SPAWN_RATE);assert.equal(near.pan,WARN_PAN);
  const far=cueForEvent({type:'spawn-warning',x:-12,y:0,atTick:10,count:5},ME,undefined,world)!;
  assert.equal(far.pan,-WARN_PAN);assert.ok(far.gain!<near.gain!&&near.gain!<=1,'quieter with distance, never above the file');
  assert.equal(cueForEvent({type:'spawn-warning',x:WARN_RANGE+1,y:0,atTick:10,count:5},ME,undefined,world),undefined);
  assert.ok(WARN_SPAWN_RATE<1&&WARN_ATTACK_RATE<1,'slower (lower) than the boss step itself');
});

test('item 19: a telegraph thumps from its place in the view; one out of view is silent',()=>{
  const world:EventWorld={hero:{x:0,y:0},side:()=>0,telegraph:id=>id==='tg1'?{x:2,y:0}:undefined};
  const cue=cueForEvent({type:'telegraph',telegraph:'tg1'},ME,undefined,world)!;
  assert.equal(cue.id,'chefe-passo');assert.equal(cue.rate,WARN_ATTACK_RATE);assert.equal(cue.pan,undefined,'centred');
  assert.equal(cueForEvent({type:'telegraph',telegraph:'tg9'},ME,undefined,world),undefined);
  assert.deepEqual(cueForEvent({type:'telegraph',telegraph:'tg1'},ME),{id:'chefe-passo',rate:WARN_ATTACK_RATE},'no view: centred, full');
});

test('item 19: one warning per WARN_MS for the whole match, however many spawns and telegraphs arrive',()=>{
  const r=rig({hero:{x:0,y:0},telegraph:()=>({x:1,y:1})});
  const burst:SimEvent[]=[...Array.from({length:8},(_,i)=>({type:'spawn-warning',x:i,y:0,atTick:10,count:3}) as SimEvent),{type:'telegraph',telegraph:'tg1'}];
  r.at(1000);r.play(burst);r.at(1000+WARN_MS-1);r.play(burst);
  assert.equal(r.calls.length,1,'one thump for the burst and its echo');
  r.at(1000+WARN_MS);r.play(burst);
  assert.equal(r.calls.length,2);
  r.at(5000);r.play([{type:'spawn-warning',x:WARN_RANGE*2,y:0,atTick:10,count:3},{type:'spawn-warning',x:1,y:0,atTick:10,count:3}]);
  assert.equal(r.calls.length,3,'a far warning does not take the gate from a near one');
});

test('item 24: a barricade, the wall or the Uno at hp 0 is a heavy golpe; the tralha a plain one; towers and hits are silent',()=>{
  const at=(id:string,hp=0)=>cueForEvent({type:'structure',id,hp,maxHp:100},ME);
  for(const id of ['barricada-norte','muralha',CAR_ID])assert.deepEqual(at(id),{...BREAK_CUE},id);
  assert.deepEqual(at('tralha12'),{id:'golpe'});
  assert.equal(at('torre-3'),undefined,'a tower expiring or cleared is not a break');
  assert.equal(at('barricada-norte',40),undefined,'a hit, not a break');
  assert.ok(BREAK_CUE.rate<1&&BREAK_CUE.gain*SFX.golpe.gain<=SFX['chefe-morte'].gain,'heavier than the tralha, under the boss death');
});
