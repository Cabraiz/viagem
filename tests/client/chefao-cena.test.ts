/**
 * The chefão's arrival scene on the phone (card NEW-20261023-ORQ-boss-fim-onda-1, src/client/render/chefao-cena.ts and
 * hud/chefao-cena.ts): the camera goes to him, holds and comes back on the scene's clock; a phone joining mid-scene
 * starts there; one scene per arrival; the skip only from the 2nd scene this browser saw; his name on the boss bar and
 * the death sound of a boss.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CENA_SEEN_KEY,CenaClock,cenaWeight,type CenaStore} from '../../src/client/render/chefao-cena.ts';
import {cenaTitle} from '../../src/client/hud/chefao-cena.ts';
import {bossInfo,BOSS_NAME} from '../../src/client/hud/model.ts';
import {soundForEvent} from '../../src/client/audio/events.ts';
import {CENA,WAVE_BOSSES,WAVE_BOSS} from '../../src/rules/index.ts';
const HD_BOSSES=WAVE_BOSSES.filter(b=>b.size===undefined);
import type {RunCena,RunView} from '../../src/contract/index.ts';
import {waveBossTuning} from '../../src/sim/ninhos/chefao.ts';
import {BOSS_TUNING} from '../../src/sim/boss.ts';

const memory=(seen?:number):CenaStore&{map:Map<string,string>}=>{
  const map=new Map<string,string>();if(seen!==undefined)map.set(CENA_SEEN_KEY,String(seen));
  return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v);}};
};
const cena=(leftMs=CENA.totalMs,enemy='e9'):RunCena=>({who:'mapinguari-do-shopping',enemy,x:40,y:12,leftMs,totalMs:CENA.totalMs,tick:900});

test('the camera: 0 → 1 over goMs, holds, back to 0 over backMs, 0 outside',()=>{
  assert.equal(cenaWeight(-1),0);
  assert.equal(cenaWeight(0),0);
  assert.ok(cenaWeight(CENA.goMs/2)>.4&&cenaWeight(CENA.goMs/2)<.6);
  assert.equal(cenaWeight(CENA.goMs),1);
  assert.equal(cenaWeight(CENA.goMs+CENA.holdMs-1),1);
  assert.ok(cenaWeight(CENA.goMs+CENA.holdMs+CENA.backMs/2)<.6);
  assert.equal(cenaWeight(CENA.totalMs),0);
  assert.equal(CENA.goMs+CENA.holdMs+CENA.backMs,CENA.totalMs);
});

test('the clock: opens on the first sight, holds with the title, comes back, closes for good',()=>{
  const c=new CenaClock(memory());
  assert.equal(c.frame(0),undefined);
  assert.equal(c.sync(undefined,0),false);
  assert.equal(c.sync(cena(),1000),true);
  // The room resends it each second: the same scene, the clock goes on.
  assert.equal(c.sync(cena(2000),2200),false);
  assert.equal(c.frame(1000)!.weight,0);
  const hold=c.frame(1000+CENA.goMs+100)!;
  assert.equal(hold.weight,1);assert.equal(hold.hold,true);assert.equal(hold.title,true);
  const back=c.frame(1000+CENA.goMs+CENA.holdMs+100)!;
  assert.equal(back.hold,false);assert.equal(back.title,false);assert.ok(back.weight<1&&back.weight>0);
  assert.equal(c.frame(1000+CENA.totalMs),undefined);
  // Over: the room's late resend never replays it (one scene per arrival).
  assert.equal(c.sync(cena(100),1000+CENA.totalMs+10),false);
  assert.equal(c.frame(1000+CENA.totalMs+20),undefined);
  // Another arrival (a rematch's) does; a new run forgets the old.
  c.reset();
  assert.equal(c.sync(cena(),9000),true);
});

test('a phone that sees the scene late starts where the room is (leftMs)',()=>{
  const c=new CenaClock(memory());
  c.sync(cena(CENA.totalMs-CENA.goMs-500),5000);
  const f=c.frame(5000)!;
  assert.equal(f.ms,CENA.goMs+500);assert.equal(f.weight,1);assert.equal(f.hold,true);
});

test('the skip: never on the first scene ever, from the 2nd on; the camera comes back over backMs',()=>{
  const store=memory();
  const first=new CenaClock(store);first.sync(cena(),0);
  assert.equal(first.frame(CENA.goMs+10)!.skippable,false);
  assert.equal(first.skip(CENA.goMs+10),false);
  assert.equal(store.map.get(CENA_SEEN_KEY),'1');
  const again=new CenaClock(store);again.sync(cena(CENA.totalMs,'e10'),0);
  assert.equal(store.map.get(CENA_SEEN_KEY),'2');
  const at=CENA.goMs+100;
  assert.equal(again.frame(at)!.skippable,true);
  assert.equal(again.skip(at),true);
  const after=again.frame(at+CENA.backMs/2)!;
  assert.equal(after.title,false);assert.equal(after.skippable,false);assert.ok(after.weight>0&&after.weight<1);
  assert.equal(again.frame(at+CENA.backMs),undefined);
  // No storage (private mode): always the first time, never skipped.
  const none=new CenaClock(null);none.sync(cena(),0);
  assert.equal(none.frame(CENA.goMs)!.skippable,false);
});

test('the title and the bar say who came; a boss death sounds like one',()=>{
  for(const b of WAVE_BOSSES){
    assert.deepEqual(cenaTitle(b.id),{name:b.name,subtitle:b.subtitle});
    assert.ok(b.bar.length<=24,b.bar);
    const view={enemies:[{id:'e1',kind:b.id,hp:50,maxHp:100,boss:true,x:0,y:0,spawnTick:0}]} as unknown as RunView;
    assert.equal(bossInfo(view)?.name,b.bar);
    assert.equal(soundForEvent({type:'kill',enemy:'e1',kind:b.id,x:0,y:0}),'chefe-morte');
  }
  assert.equal(cenaTitle('nobody'),undefined);
  const sindico={enemies:[{id:'e1',kind:'chefe',hp:50,maxHp:100,boss:true,x:0,y:0,spawnTick:0}]} as unknown as RunView;
  assert.equal(bossInfo(sindico)?.name,BOSS_NAME);
  // His arrival's sound: the boss-phase event of the tick he appears on.
  assert.equal(soundForEvent({type:'boss-phase',enemy:'e1',phase:1}),'chefe');
});

test('his size (the user: 2× to 3×): body and charge × drawScale, the areas on the ground × (1 + it) / 2',()=>{
  for(const s of [2,3]){
    const t=waveBossTuning(BOSS_TUNING,s);
    assert.equal(t.radius,BOSS_TUNING.radius*s);
    assert.equal(t.chargeWidth,BOSS_TUNING.chargeWidth*s);
    assert.equal(t.slamRadius,BOSS_TUNING.slamRadius*(1+s)/2);
    assert.equal(t.fineRadius,BOSS_TUNING.fineRadius*(1+s)/2);
  }
  assert.ok(WAVE_BOSS.drawScale>=2&&WAVE_BOSS.drawScale<=3);
  assert.equal(waveBossTuning().radius,BOSS_TUNING.radius*WAVE_BOSS.drawScale);
});

test('his art in HD (AI copy of idle/walk/slam, the rest at the approved cell; tests/tools/art-hd-chefao) and a ground shadow that stays short at his size',async()=>{
  const {HD_ENEMIES,parseArtIndex,setArtIndex}=await import('../../src/client/art/manifest.ts');
  const {enemyPieceLoads,artShadowLength}=await import('../../src/client/art/horde-art.ts');
  const {readFileSync}=await import('node:fs');
  // The 4 legacy chefões; the saci (SACI_BOSS.size, card saci-chefe-2x) keeps his own sheet and shadow.
  assert.deepEqual([...HD_ENEMIES].sort(),[...HD_BOSSES.map(b=>b.id)].sort());
  setArtIndex(parseArtIndex(JSON.parse(readFileSync('public/art/manifest.json','utf8'))));
  try{
    for(const b of HD_BOSSES){
      const loads=enemyPieceLoads(b.id);
      assert.ok(loads.length,b.id);
      for(const l of loads){
        const hd=/:(idle|walk|slam)(:p\d)?$/.test(l.key);
        assert.ok(hd?l.url.startsWith('/art/hd/enemies/'):/^\/art\/(enemies|lite\/enemies-pc)\//.test(l.url),l.url);
        assert.equal(l.cell[1],hd?512:384,l.url);
      }
      assert.ok(artShadowLength(b.id)<1&&artShadowLength(b.id)>0);
    }
    // Everyone else: still the lite copies, the shadow as long as the figure.
    assert.ok(enemyPieceLoads('bebado').every(l=>l.url.includes('/lite/')));
    assert.equal(artShadowLength('bebado'),1);
    assert.equal(artShadowLength('aberracao-saci'),1);
  }finally{setArtIndex(parseArtIndex({version:2,groups:{}}));}
});
