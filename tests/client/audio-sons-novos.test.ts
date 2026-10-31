/**
 * NEW-20261029-ORQ-sons-novos-tangoflux (auditoria de som, itens 18, 21, 22, 23, 25 e 26): which SimEvents play the new
 * TangoFlux files. Three takes of the critter's hit and death and of the boss's death; the last critter's tcham; the
 * happenings' jingles; a car part's clank; the money; and a nest waking from its side. The chaveiro's moto and the PIX
 * keep NEW-20261030-ORQ-sons-nos-eventos' choice (tests/client/audio-sons-nos-eventos.test.ts).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import type {SimEvent} from '../../src/contract/index.ts';
import type {SoundId} from '../../src/client/audio/types.ts';
import {FILE_SOUND_IDS} from '../../src/client/audio/types.ts';
import {SFX,sfxNames} from '../../src/client/audio/sfx.ts';
import {GemCombo} from '../../src/client/audio/recipes.ts';
import {cueForEvent,soundForEvent,playEvents,WarnGate,BANK_CASH_CUE,NEST_RANGE,WARN_PAN,TEAM_MONEY_GAIN,
  type EventWorld} from '../../src/client/audio/events.ts';

const ME='p1';
const NEW:readonly SoundId[]=['ultimo-bicho','apagao','caixa-registradora','peca-cai','ninho-acordou'];
const id=(event:SimEvent,world?:EventWorld)=>cueForEvent(event,ME,undefined,world)?.id;

test('item 18: three takes each of the critter hit, the critter death and the boss death, every take on disk',()=>{
  for(const sound of ['bicho-acerto','bicho-morte','chefe-morte'] as const)assert.equal(SFX[sound].takes,3,sound);
  for(const name of sfxNames())for(const ext of ['webm','m4a'])assert.ok(existsSync(`public/audio/sfx/${name}.${ext}`),`${name}.${ext}`);
});

test('the new files are file sounds with a throttle, at the neighbours\' level',()=>{
  for(const sound of NEW){
    assert.ok((FILE_SOUND_IDS as readonly string[]).includes(sound),sound);
    assert.ok(SFX[sound].gain>=.4&&SFX[sound].gain<=.8,`${sound} gain ${SFX[sound].gain}`);
  }
  for(const sound of NEW.filter(s=>s!=='ultimo-bicho'))assert.ok(SFX[sound].throttleMs>=200,`${sound} is throttled`);
  assert.ok(SFX['ninho-acordou'].throttleMs>=2000,'a nest growls at most once per 2 s');
});

test('item 21: the last critter of the round plays the tcham for everyone',()=>{
  assert.equal(id({type:'last-bicho',kind:'pombo',x:1,y:2,round:3,by:'p2'}),'ultimo-bicho');
  assert.equal(id({type:'last-bicho',kind:'pombo',x:1,y:2,round:3}),'ultimo-bicho');
});

test('item 22: each happening has its jingle',()=>{
  assert.equal(id({type:'happening',kind:'apagao',endsTick:9}),'apagao');
  assert.equal(id({type:'happening',kind:'promo',endsTick:9}),'caixa-registradora');
  assert.equal(id({type:'happening',kind:'boletos',endsTick:9}),'carimbo');
});

test('item 23: a falling car part clanks',()=>{
  assert.equal(id({type:'part',name:'roda'}),'peca-cai');
});

test('item 25: money: my purchase rings full, the team\'s and Cida\'s sale quieter',()=>{
  assert.deepEqual(cueForEvent({type:'buy',player:ME,item:'brigadeiro'},ME),{id:'caixa-registradora'});
  assert.deepEqual(cueForEvent({type:'buy',player:'p2',item:'brigadeiro'},ME),{id:'caixa-registradora',gain:TEAM_MONEY_GAIN});
  const sale=cueForEvent({type:'sale',enemy:'e1'},ME)!;
  assert.equal(sale.id,'caixa-registradora');assert.ok(sale.gain!<1);
  assert.equal(id({type:'bank-cash',bank:'b1',amount:10,by:'enemy',enemy:'e1'}),'tsc');
  assert.equal(id({type:'bank-prime',bank:'b1',enemy:'e1'}),'caixa-registradora');
  const empty=cueForEvent({type:'bank-empty',bank:'b1',until:99},ME)!;
  assert.equal(empty.id,'tsc');assert.ok(empty.rate!<1,'low');
});

test('item 25: a hero cashing at a bank clinks high and leaves the gem combo alone',()=>{
  const gems=new GemCombo(),calls:[SoundId,Record<string,unknown>][]=[];
  playEvents({play:(sound,opts)=>{calls.push([sound,{...opts}]);return true;}},[{type:'bank-cash',bank:'b1',amount:10,by:'hero'}],ME,
    undefined,undefined,{gems,warn:new WarnGate(),now:()=>0});
  assert.deepEqual(calls,[['gema',{rate:BANK_CASH_CUE.rate,gain:BANK_CASH_CUE.gain}]]);
  assert.equal(gems.next(0),new GemCombo().next(0),'the combo did not climb');
});

test('item 26: a nest waking growls from its side, quieter far away; none past NEST_RANGE',()=>{
  const world:EventWorld={hero:{x:0,y:0},side:p=>Math.sign(p.x)};
  const near=cueForEvent({type:'acordou',x:3,y:0,n:4},ME,undefined,world)!;
  assert.equal(near.id,'ninho-acordou');assert.equal(near.pan,WARN_PAN);
  const far=cueForEvent({type:'acordou',x:-15,y:0,n:4},ME,undefined,world)!;
  assert.equal(far.pan,-WARN_PAN);assert.ok(far.gain!<near.gain!&&near.gain!<=1);
  assert.equal(cueForEvent({type:'acordou',x:NEST_RANGE+1,y:0,n:4},ME,undefined,world),undefined);
  assert.equal(soundForEvent({type:'acordou',x:1,y:0,n:1},ME),'ninho-acordou','without a world it plays centred');
});
