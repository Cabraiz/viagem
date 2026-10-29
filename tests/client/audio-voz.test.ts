/**
 * NEW-20261029-E8-voz-por-personagem: the voiced classes say their own "ai" when hit and scream at the fall (the
 * mendigo grunts), the saci laughs when it hits me, the generic sound stands in while a voice's file is not ready, and
 * one voice of a kind per VOICE_MS keeps a crowd from becoming a choir.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {SimEvent} from '../../src/contract/index.ts';
import type {SoundId} from '../../src/client/audio/types.ts';
import {FILE_SOUND_IDS} from '../../src/client/audio/types.ts';
import {SFX} from '../../src/client/audio/sfx.ts';
import {GemCombo} from '../../src/client/audio/recipes.ts';
import {PLAYABLE_CLASS_IDS} from '../../src/rules/classes.ts';
import {cueForEvent,playEvents,VoiceGate,HERO_VOICES,ENEMY_VOICES,VOICE_MS,voiceKind,
  type EventWorld} from '../../src/client/audio/events.ts';

const ME='p1';
const CLASSES:Record<string,string>={p1:'clt-cansado',p2:'maromba',p3:'mendigo',p4:'coach',p5:'viciado-em-bet'};
const KINDS:Record<string,string>={e1:'pombo',e2:'saci'};
const world:EventWorld={classOf:id=>CLASSES[id],kindOf:id=>KINDS[id]};
const hit=(source='e1'):SimEvent=>({type:'damage',target:ME,amount:5,source});
const fall=(player:string):SimEvent=>({type:'downed',player});

/** A fake engine: every file is ready unless listed in `missing`; plays are recorded. */
function rig(missing:readonly SoundId[]=[]){
  const played:SoundId[]=[],loading:SoundId[]=[];
  let now=0;
  const clock={gems:new GemCombo(),voice:new VoiceGate(),now:()=>now};
  const audio={play:(id:SoundId)=>{played.push(id);return true;},hasFile:(id:SoundId)=>!missing.includes(id),
    preload:(ids:Iterable<SoundId>)=>{loading.push(...ids);}};
  const run=(events:SimEvent[],at:number)=>{now=at;playEvents(audio,events,ME,undefined,undefined,clock,world);};
  return {played,loading,run};
}

test('the six heroes and the mendigo each have an "ai" and a fall, two takes each, all file sounds',()=>{
  const voiced=['viciado-em-bet','clt-cansado','gato-nada-pra-comer','maromba','vendedor-praia','aposentado','mendigo'];
  assert.deepEqual(Object.keys(HERO_VOICES).sort(),voiced.sort());
  for(const cls of voiced)assert.ok(PLAYABLE_CLASS_IDS.includes(cls),`${cls} is a class id`);
  const ids=[...Object.values(HERO_VOICES).flatMap(v=>[v.hit,v.fall]),...Object.values(ENEMY_VOICES)];
  assert.equal(new Set(ids).size,ids.length,'no voice shared');
  for(const id of ids){
    assert.ok((FILE_SOUND_IDS as readonly string[]).includes(id),id);
    assert.equal(SFX[id].takes,2,`${id} takes`);
    assert.ok(SFX[id].throttleMs>=VOICE_MS,`${id} throttle`);
  }
  for(const v of Object.values(HERO_VOICES)){assert.equal(voiceKind(v.hit),'ai');assert.equal(voiceKind(v.fall),'cai');}
});

test('my hit says my class\'s "ai" over the generic dano-heroi; a class without a voice keeps dano-heroi',()=>{
  assert.deepEqual(cueForEvent(hit(),ME,undefined,world),{id:'voz-clt-ai',fallback:{id:'dano-heroi'}});
  assert.deepEqual(cueForEvent(hit(),'p4',undefined,world),undefined,'only my own hits');
  assert.deepEqual(cueForEvent({type:'damage',target:'p4',amount:1,source:'e1'},'p4',undefined,world),{id:'dano-heroi'});
  assert.deepEqual(cueForEvent(hit(),ME),{id:'dano-heroi'},'no world: the generic sound');
});

test('a fall screams in the fallen hero\'s voice for everyone, the mendigo grunts, the rest whistle',()=>{
  assert.deepEqual(cueForEvent(fall('p2'),ME,undefined,world),{id:'voz-maromba-cai',fallback:{id:'queda'}});
  assert.deepEqual(cueForEvent(fall('p3'),ME,undefined,world),{id:'voz-mendigo-cai',fallback:{id:'queda'}});
  assert.deepEqual(cueForEvent(fall('p4'),ME,undefined,world),{id:'queda'});
  assert.deepEqual(cueForEvent(fall('p9'),ME,undefined,world),{id:'queda'},'unknown player');
});

test('the saci laughs when it hits me, on top of my "ai"',()=>{
  assert.deepEqual(cueForEvent(hit('e2'),ME,undefined,world),{id:'voz-clt-ai',fallback:{id:'dano-heroi'},with:{id:'voz-saci-risada'}});
  const {played,run}=rig();
  run([hit('e2')],0);
  assert.deepEqual(played,['voz-clt-ai','voz-saci-risada']);
});

test('while a voice\'s file is not ready the generic sound plays and the file starts loading',()=>{
  const {played,loading,run}=rig(['voz-clt-ai','voz-maromba-cai','voz-saci-risada']);
  run([hit('e2'),fall('p2'),fall('p5')],0);
  assert.deepEqual(played,['dano-heroi','queda','voz-bet-cai'],'the laugh has no generic: silence');
  assert.deepEqual(loading,['voz-clt-ai','voz-saci-risada','voz-maromba-cai']);
});

test('one voice of a kind per VOICE_MS: two falls at once scream once; the "ai" is a different kind',()=>{
  const {played,run}=rig();
  run([fall('p2'),fall('p5'),hit()],0);
  assert.deepEqual(played,['voz-maromba-cai','voz-clt-ai']);
  run([fall('p5'),hit()],VOICE_MS-1);
  assert.deepEqual(played,['voz-maromba-cai','voz-clt-ai'],'still inside the window');
  run([fall('p5'),hit()],VOICE_MS);
  assert.deepEqual(played,['voz-maromba-cai','voz-clt-ai','voz-bet-cai','voz-clt-ai']);
});

test('a gated voice plays nothing, not its generic (the crowd stays quiet)',()=>{
  const {played,run}=rig();
  run(Array.from({length:10},()=>hit()),0);
  assert.deepEqual(played,['voz-clt-ai']);
});
