// arte-do-roster-no-render (the user's request): the rotation draws only the enemies with imported art
// (ROSTER_ONLY_WITH_ART), from a list the importer writes next to the art index (rules/enemy-art-ids.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Rng} from '../../src/contract/index.ts';
import {BORROW_TUNE,ENEMY_ART_IDS,MINI_COUNT,ROSTER,ROSTER_ONLY_WITH_ART,ROTATION_SLOTS,drawRotation,isRotation,planRound,roleOf,
  rosterEntry,rotationIds,roundRoster,slotPools,type Rotation} from '../../src/rules/index.ts';
// @ts-expect-error: a plain .mjs script (no types)
import {enemyArtIds,enemyArtIdsSource} from '../../scripts/art-v2/enemy-art-ids.mjs';

const index=JSON.parse(readFileSync('public/art/manifest.json','utf8'));
const SEEDS=Array.from({length:200},(_,i)=>i*104729+7);

test('the generated list is the art index\'s inimigos group, every id a roster entry; the file is what the generator writes',()=>{
  assert.deepEqual([...ENEMY_ART_IDS],enemyArtIds(index),'run `node scripts/art-v2/enemy-art-ids.mjs` after changing the index');
  assert.equal(readFileSync('src/rules/enemy-art-ids.ts','utf8'),enemyArtIdsSource(enemyArtIds(index)));
  for(const id of ENEMY_ART_IDS)assert.ok(rosterEntry(id),`${id} is a roster id`);
  assert.deepEqual(enemyArtIds({version:2,groups:{}}),[]);
});

test('on by default: every regular entry has art; the minis keep today\'s draw while fewer than two have art',()=>{
  assert.equal(ROSTER_ONLY_WITH_ART,true);
  const art=new Set(ENEMY_ART_IDS),artMinis=ROSTER.filter(e=>e.role==='mini-chefe'&&art.has(e.id)).length;
  const {slots}=slotPools();
  for(const r of SEEDS.map(s=>drawRotation(new Rng(s)))){
    assert.ok(isRotation(r),'a valid rotation (checkpoints keep it)');
    for(const [role,ids] of Object.entries(r.roles)){
      const pool=slots.find(p=>p.slot.role===role)!;
      for(const id of ids!){assert.equal(roleOf(id),role);if(pool.only)assert.ok(art.has(id),`${role}: ${id} has art`);}
    }
    assert.equal(r.mini.length,MINI_COUNT);
    if(artMinis>=MINI_COUNT)for(const id of r.mini)assert.ok(art.has(id));
    // Every round plans (a band without corredores spreads their share over the roles it has).
    for(let round=1;round<=10;round++){
      const plan=planRound(round,4,{name:'x'},new Rng(round),roundRoster(r,round));
      for(const g of plan.groups)for(const id of g.members)assert.ok(rosterEntry(id),`round ${round}: ${id}`);
    }
  }
  // Today's 16 (pack 04): no corredor, palhaço or refletor has art, so those slots are empty; the early band keeps
  // its enxame, so no band falls back.
  if(!ENEMY_ART_IDS.some(id=>['corredor','palhaco','refletor'].includes(roleOf(id)!))){
    for(const role of ['corredor','palhaco','refletor'])assert.equal(slots.find(p=>p.slot.role===role)!.max,0,role);
  }
});

test('the art-only draw: slot limits from the art entries, a band without art keeps today\'s draw, flag off = whole roster',()=>{
  // Two corredores and one enxame with art only: the early band draws only them, mid and late keep today's draw.
  const corr=ROSTER.filter(e=>e.role==='corredor'&&!e.legacy).slice(0,2).map(e=>e.id),enx=ROSTER.find(e=>e.role==='enxame'&&!e.legacy)!.id;
  const artIds=[...corr,enx],opts={artIds};
  const {slots,mini}=slotPools(opts);
  for(const p of slots){
    if(p.slot.band==='early'){assert.ok(p.only,p.slot.role);assert.equal(p.max,Math.min(p.slot.max,p.slot.role==='corredor'?2:p.slot.role==='enxame'?1:0));}
    else{assert.equal(p.only,undefined,`${p.slot.role}: band without art`);assert.equal(p.min,p.slot.min);}
  }
  assert.equal(mini,undefined,'no mini-chefe with art: today\'s draw');
  for(const s of SEEDS.slice(0,50)){
    const r=drawRotation(new Rng(s),opts);
    assert.ok(isRotation(r,opts));
    assert.equal(r.roles.palhaco,undefined,'no palhaço with art');
    for(const id of r.roles.corredor??[])assert.ok(corr.includes(id));
    assert.deepEqual(r.roles.enxame,[enx]);
    for(const role of ['arremessador','atirador','suporte','kamikaze','refletor','invocador','brutamontes'] as const)assert.ok(r.roles[role]?.length,role);
  }
  // Off: today's whole-roster draw (a rotation drawn with it is also valid with it on: fewer is the only relaxation).
  const full=drawRotation(new Rng(5),{onlyWithArt:false});
  assert.ok(rotationIds(full).length>=12);assert.ok(isRotation(full,{onlyWithArt:false}));assert.ok(isRotation(full));
  // Deterministic for the same rng and list.
  assert.deepEqual(drawRotation(new Rng(9),opts),drawRotation(new Rng(9),opts));
  // A short slot is refused when the flag is off (the design's minimums), accepted with art only.
  const short:Rotation={roles:{...full.roles,palhaco:undefined} as Rotation['roles'],mini:full.mini};
  delete (short.roles as Record<string,unknown>).palhaco;
  assert.equal(isRotation(short,{onlyWithArt:false}),false);
  assert.equal(isRotation(short,{artIds:[]}),false,'no art at all: every band keeps today\'s draw and its minimums');
  assert.ok(ROTATION_SLOTS.find(s=>s.role==='palhaco')!.min>0);
});

// Decision D (Orquestrador, 13/10/2026): only the artist's enemies; a band short of art borrows lighter roles at its
// band's numbers, and no round spawns more bodies than the table's. One test per band, flag on (the default).
const artRotation=(seed:number)=>drawRotation(new Rng(seed));
const tableBodies=(round:number,players:number,seed:number)=>planRound(round,players,{name:'x'},new Rng(seed)).groups.filter(g=>!g.elite&&!g.boss&&!g.solo).reduce((n,g)=>n+g.members.length,0);
const regular=(p:ReturnType<typeof planRound>)=>p.groups.filter(g=>!g.elite&&!g.boss&&!g.solo).flatMap(g=>g.members);
const art=new Set(ENEMY_ART_IDS);

test('flag on, early band (rounds 1-3): the rat plus borrowed throwers and shooters (the kamikaze from round 2), weaker, no more bodies than the table',()=>{
  for(const seed of SEEDS.slice(0,40)){
    const r=artRotation(seed);
    for(const round of [1,2,3]){
      const rr=roundRoster(r,round);
      assert.ok(rr.short&&rr.borrowed?.length,`seed ${seed} round ${round}: short and borrowing`);
      assert.deepEqual([...rr.borrowed!],round===1?['arremessador','atirador']:['arremessador','atirador','kamikaze']);
      for(const role of rr.borrowed!)assert.equal(rr.roles[role]!.length,1,'one entry per borrowed role');
      for(const players of [1,4,6]){
        const plan=planRound(round,players,{name:'x'},new Rng(seed+round),rr),members=regular(plan);
        for(const id of members)assert.ok(art.has(id),`${id} has art`);
        assert.ok(members.length<=tableBodies(round,players,seed+round),`round ${round} ${players}p: ${members.length} bodies`);
        assert.ok(members.some(id=>roleOf(id)==='enxame'),'the rat swarm');
        assert.ok(members.some(id=>rr.borrowed!.includes(roleOf(id)!)),'borrowed entries play');
        if(round===1)assert.ok(!members.some(id=>roleOf(id)==='kamikaze'),'no kamikaze in round 1');
        assert.deepEqual(plan.borrowed,{roles:[...rr.borrowed!],tune:BORROW_TUNE.early});
      }
    }
  }
  assert.ok(BORROW_TUNE.early.damage<1&&BORROW_TUNE.early.cadence>1&&BORROW_TUNE.early.hp<1,'weaker in the early band');
});

test('flag on, mid band (rounds 4-6): its own art roles, nothing borrowed, the corredores\' share spread, no more bodies than the table',()=>{
  for(const seed of SEEDS.slice(0,40)){
    const r=artRotation(seed);
    for(const round of [4,5,6]){
      const rr=roundRoster(r,round);
      assert.equal(rr.borrowed,undefined,'its own roles are all there');
      const plan=planRound(round,4,{name:'x'},new Rng(seed),rr),members=regular(plan);
      for(const id of members)assert.ok(art.has(id),`round ${round}: ${id}`);
      assert.ok(members.length<=tableBodies(round,4,seed),`round ${round}: ${members.length} bodies`);
      assert.equal(plan.borrowed,undefined);
      if(round===5)assert.ok(plan.groups.some(g=>g.elite&&roleOf(g.members[0])==='mini-chefe'),'the mini-chefe elite (today\'s draw until minis have art)');
    }
  }
});

test('flag on, late band (rounds 7-9): kamikazes, invocadores and brutamontes with art, the lone mini in round 8, no more bodies than the table',()=>{
  for(const seed of SEEDS.slice(0,40)){
    const r=artRotation(seed);
    for(const round of [7,8,9]){
      const rr=roundRoster(r,round),plan=planRound(round,4,{name:'x'},new Rng(seed),rr),members=regular(plan);
      for(const id of members)assert.ok(art.has(id),`round ${round}: ${id}`);
      assert.ok(members.length<=tableBodies(round,4,seed),`round ${round}: ${members.length} bodies`);
      for(const role of ['kamikaze','invocador','brutamontes'] as const)assert.ok(rr.roles[role]?.length,role);
      if(round===8)assert.equal(plan.groups.filter(g=>g.solo).length,1);
    }
    // Round 10 keeps the boss (today's chefe until he has art).
    assert.ok(planRound(10,4,{name:'x'},new Rng(seed),roundRoster(r,10)).groups.some(g=>g.boss&&g.members[0]==='chefe'));
  }
});
