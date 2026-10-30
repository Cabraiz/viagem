/** Quality levels (Q3, NEW-20261021-E6-q3-niveis-qualidade): the device's level, the saved choice, the watch's step down. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ECONOMY_KEY,FpsWatch,type KeyValue} from '../../src/client/economy.ts';
import {QUALITY_KEY,QUALITY_WATCH,chooseQuality,detectQuality,loadQuality,qualityFromUrl,qualityProfile,saveQuality,stepDown,undoQuality,type QualitySettings} from '../../src/client/quality.ts';

const memory=():KeyValue&{data:Map<string,string>}=>{const data=new Map<string,string>();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>{data.set(k,v);}};};
const broken:KeyValue={getItem:()=>{throw new Error('SecurityError');},setItem:()=>{throw new Error('QuotaExceededError');}};

test('1. the device picks the level: weak → Leve, a mouse → Alta, phones → Normal',()=>{
  const cases:[Parameters<typeof detectQuality>[0],string,string][]=[
    [{memory:2,cores:8,fine:false},'leve','2 GB phone'],
    [{memory:1,cores:4,fine:true},'leve','1 GB, even with a mouse'],
    [{memory:8,cores:2,fine:true},'leve','2 cores'],
    [{cores:2},'leve','2 cores, no deviceMemory (Safari)'],
    [{memory:4,cores:8,fine:false},'normal','4 GB phone'],
    [{memory:8,cores:8,fine:false},'normal','8 GB phone: touch is Normal'],
    [{cores:6,fine:false},'normal','iPhone (no deviceMemory)'],
    [{memory:8,cores:8,fine:true},'alta','PC'],
    [{cores:8,fine:true},'alta','PC on Firefox (no deviceMemory)'],
    [{memory:3,cores:4,fine:true},'normal','a weak notebook'],
    [{},'normal','nothing known'],
    [{memory:0,cores:NaN,fine:false},'normal','junk hints are ignored'],
  ];
  for(const [hints,want,why] of cases)assert.equal(detectQuality(hints),want,why);
});

test('2. saved: a pick survives a reload, the old economy carries over, broken storage falls back to the device',()=>{
  const store=memory();
  assert.deepEqual(loadQuality(store,'normal'),{level:'normal',chosen:false,auto:false,declined:false});
  const picked=chooseQuality(loadQuality(store,'normal'),'alta');
  assert.equal(saveQuality(store,picked),true);
  assert.deepEqual(loadQuality(store,'leve'),{level:'alta',chosen:true,auto:false,declined:false},'the pick wins over the device');
  // Not picked and not stepped: the device decides again.
  store.data.set(QUALITY_KEY,JSON.stringify({level:'leve',chosen:false,auto:false,declined:false}));
  assert.equal(loadQuality(store,'alta').level,'alta');
  // Stepped by the watch: it stays down.
  store.data.set(QUALITY_KEY,JSON.stringify({level:'leve',chosen:false,auto:true,declined:false}));
  assert.deepEqual(loadQuality(store,'normal'),{level:'leve',chosen:false,auto:true,declined:false});
  // The old economy setting (VGM-048).
  const old=memory();
  old.data.set(ECONOMY_KEY,'{"on":true,"auto":false,"declined":false}');
  assert.deepEqual(loadQuality(old,'alta'),{level:'leve',chosen:true,auto:false,declined:false},'economy by a tap = Leve picked');
  old.data.set(ECONOMY_KEY,'{"on":true,"auto":true,"declined":false}');
  assert.deepEqual(loadQuality(old,'normal'),{level:'leve',chosen:false,auto:true,declined:false},'economy by the watch = Leve stepped');
  old.data.set(ECONOMY_KEY,'{"on":false,"auto":false,"declined":true}');
  assert.deepEqual(loadQuality(old,'normal'),{level:'normal',chosen:false,auto:false,declined:true},'a "no" to the watch stays');
  // Never throws.
  assert.deepEqual(loadQuality(broken,'normal'),{level:'normal',chosen:false,auto:false,declined:false});
  assert.equal(saveQuality(broken,picked),false);assert.equal(saveQuality(null,picked),false);
  for(const junk of ['{','null','42','{"level":"ultra","chosen":true}','{"level":3}']){store.data.set(QUALITY_KEY,junk);assert.equal(loadQuality(store,'normal').level,'normal',junk);}
});

test('3. the watch: 10 s of combat at 25 fps steps one level down; a 30 Hz cap, a pick or a "no" never',()=>{
  const feed=(w:FpsWatch,fps:number,ms:number,jitter=0)=>{
    let fired=0,seed=7;const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648-.5)*2;
    for(let t=0;t<ms;){const d=1000/fps+jitter*rnd();t+=d;if(w.frame(d))fired++;}
    return fired;
  };
  const w=new FpsWatch(QUALITY_WATCH);
  assert.equal(feed(w,25,9_500,6),0,'not before 10 s');
  assert.equal(feed(w,25,600,6),1,'at 10 s');
  assert.equal(feed(w,25,60_000,6),0,'once per match (one watch per scene)');
  assert.equal(feed(new FpsWatch(QUALITY_WATCH),30,60_000,1.5),0,'a steady 30 Hz (iOS Low Power Mode) is not choking');
  assert.equal(feed(new FpsWatch(QUALITY_WATCH),55,60_000,4),0,'a good phone');
  const auto:QualitySettings={level:'alta',chosen:false,auto:false,declined:false};
  const one=stepDown(auto)!;assert.deepEqual(one,{level:'normal',chosen:false,auto:true,declined:false});
  assert.equal(stepDown(one)!.level,'leve','next match, still choking');
  assert.equal(stepDown({...auto,level:'leve'}),undefined,'nothing under Leve');
  assert.equal(stepDown(chooseQuality(auto,'alta')),undefined,'a pick stays');
  // "Desfazer" on the toast, or going back up in the gear: the watch never steps again.
  assert.deepEqual(undoQuality(one,'alta'),{level:'alta',chosen:true,auto:false,declined:true});
  assert.equal(chooseQuality(one,'alta').declined,true,'back up from a stepped level');
  assert.equal(chooseQuality(one,'leve').declined,false,'further down is not a "no"');
});

test('what each level turns on: Leve = the old economy + a still scenery; Normal and Alta the full game',()=>{
  assert.deepEqual(qualityProfile('leve'),{fps:30,effects:'reduced',economy:true,still:true,enemyCap:150});
  assert.deepEqual(qualityProfile('normal'),{fps:60,effects:'full',economy:false,still:false,enemyCap:300});
  assert.deepEqual(qualityProfile('alta'),{fps:60,effects:'full',economy:false,still:false,enemyCap:3000});
  assert.equal(qualityFromUrl('?qualidade=leve'),'leve');assert.equal(qualityFromUrl('?x=1&qualidade=alta'),'alta');
  assert.equal(qualityFromUrl('?qualidade=ultra'),undefined);assert.equal(qualityFromUrl(''),undefined);
});

test('wiring: the scene applies the level live (economy look, still city, 10 s watch); the gear shows the three levels',()=>{
  const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  assert.match(scene,/new FpsWatch\(QUALITY_WATCH\)/);
  assert.match(scene,/setQuality\(level:QualityLevel\)\{[^]*?this\.city\?\.setStill\(profile\.still\)/);
  assert.match(scene,/this\.quality==='leve'\|\|this\.fpsWatch\.done/,'Leve has nowhere lower to go');
  const live=readFileSync(new URL('../../src/client/render/city/live/layer.ts',import.meta.url),'utf8');
  assert.match(live,/if\(this\.reduced\)\{if\(a\.still\)continue;a\.still=true;\}/,'held still: no setFrame per frame');
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.match(explore,/quality:quality\.level,slow/);
  assert.match(explore,/QUALITY_LEVELS\.map\(l=>`<button type="button" data-level="\$\{l\}"/);
});
