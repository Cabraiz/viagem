/**
 * NEW-20261025-ORQ-uno-caminho-caixas-vender, item 2 (the user, 25/10: "rodei pelo mapa e só achei 3 caixas"). Measured
 * before (scripts/diag-caixas-visiveis.ts): 50-60 crates alive, but a person who had opened 4-6 saw 9-24 of them (the
 * caixa-gamble hides the colours he took, caixa-sem-item-repetido the items he holds). On the REAL Cidade Nevada, a real
 * match (chaveiro, ninhos, manual) with 3 room bots:
 *  - the floor: a person who keeps opening crates still sees at least VISIBLE_FLOOR on the map;
 *  - (c) the bots leave the crates a person sees within BOT_LEAVES_CRATE u of them.
 * Results only (D-031).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {cityTerrainFrom} from '../../src/maps/city/terrain.ts';
import {cityAsField} from '../../src/maps/index.ts';
import {ticks} from '../../src/contract/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots} from '../../multiplayer/room-bots.ts';
import {VISIBLE_FLOOR} from '../../src/sim/crates.ts';
import {MAP_CRATES} from '../../src/sim/crates-abate.ts';
import {BOT_LEAVES_CRATE,forAPerson,planLoot} from '../../src/sim/bot-loot.ts';

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
const loaded=await cityTerrainFrom(readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8'),(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash);
if(!loaded.ok)throw new Error(loaded.error);
const field=cityAsField(loaded.terrain);
type Chest={kind:string;id:string;x:number;y:number;value:number;hiddenFor?:string[]};

test(`a person who opens crate after crate still sees at least ${VISIBLE_FLOOR} on the map`,{skip:!MAP_CRATES&&'itens-so-de-monstro: the map crates are off (crates-abate.ts MAP_CRATES), this is the legacy'},()=>{
  for(const seed of [1,2]){
    const s=new Simulation(seed,{world:'cidade',terrain:field,cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
    s.add('p0','P0','cidadao-comum');
    const rb=new RoomBots();
    for(let i=0;i<3;i++){s.addBot(`b${i}`,`B${i}`,'cidadao-comum');rb.add(`b${i}`,i);}
    s.resetRun();
    const pickups=()=>(s as unknown as {world:{pickups:Map<string,Chest>}}).world.pickups;
    const p0=s.players.get('p0')!;
    let now=1000,opened=0,target:string|undefined,least=Infinity,since=0;const skip=new Set<string>();
    for(let t=0;t<ticks(240);t++){
      rb.think(s);
      const mine=[...pickups().values()].filter(k=>k.kind==='chest'&&!k.hiddenFor?.includes('p0')&&!skip.has(k.id));
      // He goes from crate to crate (stands on it until it opens): the hiding grows with every one. One he cannot open
      // in 8 s (a band beside it hits him: opening starts over) he leaves (mapa-conexoes-sem-beco: on asset v5 a band
      // sleeps by seed 1's second crate).
      if(target&&pickups().has(target)&&t-since>ticks(8)){skip.add(target);target=undefined;}
      if(!target||!pickups().has(target)){if(target)opened++;target=mine.find(k=>k.id!==target)?.id;since=t;if(target){const k=pickups().get(target)!;p0.x=k.x;p0.y=k.y;}}
      // Untouchable (so-3-inimigos: the mendigo runners chase him and every hit starts the opening over): the floor is the
      // subject here, not the fight.
      p0.hp=p0.stats.maxHp;p0.invulnerableUntil=Infinity;delete (p0 as {fear?:unknown}).fear;
      s.step(now+=50);
      if(t>ticks(5)&&t%ticks(1)===0)least=Math.min(least,[...pickups().values()].filter(k=>k.kind==='chest'&&!k.hiddenFor?.includes('p0')).length);
    }
    assert.ok(opened>=6,`seed ${seed}: opened ${opened}`);
    // The floor tops up every VISIBLE_FLOOR_S; this walker opens one every ~1.5 s (a person, one per ~20 s), so between two
    // checks he may have just opened one.
    assert.ok(least>=VISIBLE_FLOOR-1,`seed ${seed}: at one moment he saw only ${least} crates (opened ${opened})`);
  }
});

test('(c) a bot leaves a crate to a person who sees it nearby; not one hidden from her, nor one far from her',()=>{
  const bot={id:'b',bot:true,online:true,spectator:false,eliminated:false,downed:false,hp:100,maxHp:100,weapons:[],x:0,y:0} as never;
  const ana={id:'ana',online:true,spectator:false,eliminated:false,downed:false,hp:100,maxHp:100,weapons:[],x:20,y:0} as never;
  const crate={id:'bau-1',kind:'chest',value:2,x:2,y:0};
  assert.equal(forAPerson([bot,ana],crate,'b'),true);
  assert.equal(forAPerson([bot,ana],{...crate,hiddenFor:['ana']},'b'),false,'she does not see it');
  assert.equal(forAPerson([bot,{...(ana as object),x:2+BOT_LEAVES_CRATE} as never],crate,'b'),false,'she is far');
  assert.equal(forAPerson([bot,{...(ana as object),bot:true} as never],crate,'b'),false,'another bot');
  const armed={...(bot as object),weapons:[{id:'pistola',level:1}]} as never;
  assert.equal(planLoot({players:[armed,ana],pickups:[crate],enemies:[]} as never,armed,{x:0,y:0}).goal,undefined,'the bot does not walk to her crate');
  assert.equal(planLoot({players:[armed],pickups:[crate],enemies:[]} as never,armed,{x:0,y:0}).goal?.id,'bau-1','alone, it takes it');
  // auditoria-primeira-partida-30-10 item 8: a bot with no weapon at all takes one (it cannot hit without it).
  assert.equal(planLoot({players:[bot,ana],pickups:[crate],enemies:[]} as never,bot,{x:0,y:0}).goal?.id,'bau-1','unarmed, it takes it');
});
