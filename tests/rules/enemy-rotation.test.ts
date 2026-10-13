/**
 * NEW-20261013-ORQ-papeis-de-inimigo step 3 (D-040): the run's rotation and the rounds composed from it.
 *  - every rotation has 12 to 18 entries (both ends happen), by role, each entry of its role, no repeats, P0 first
 *  - band rules: rounds 1-3 corredores, enxames and exactly one palhaço; 4-6 add arremessador, atirador(es), suporte
 *    (maybe a voador); 7-9 add kamikaze, refletor, invocador, brutamontes; mini-chefes in rounds 5 (the elite) and 8
 *    (alone); round 10 keeps the boss
 *  - deterministic by seed, JSON round-trip (checkpoint), isRotation guards a stored one
 *  - planRound with the rotation: members are the round's entries, the threat budget holds, rounds 1-2 lay out exactly
 *    like the table (same groups, same times), the table's plan is unchanged without it
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../../src/contract/index.ts';
import {MINI_ROUNDS,MODIFIERS,ROLE_PROFILES,ROSTER,ROTATION_SIZE,ROTATION_SLOTS,ROTATION_WEIGHTS,THREAT,bandOf,drawRotation,isRotation,planRound,
  roleOf,rosterEntry,rotationIds,rotationSize,roundRoster,type EnemyRole,type RegularKind,type Rotation} from '../../src/rules/index.ts';

const SEEDS=Array.from({length:300},(_,i)=>i*7919+13);
const rotations=SEEDS.map(s=>drawRotation(new Rng(s)));

test('size 12-18 (both ends drawn), slots within their ranges, entries of their role, no repeats',()=>{
  const sizes=new Set<number>();
  for(const r of rotations){
    const n=rotationSize(r);sizes.add(n);
    assert.ok(n>=ROTATION_SIZE.min&&n<=ROTATION_SIZE.max,`size ${n}`);
    for(const s of ROTATION_SLOTS){const k=r.roles[s.role]?.length??0;assert.ok(k>=s.min&&k<=s.max,`${s.role}: ${k}`);}
    for(const [role,ids] of Object.entries(r.roles))for(const id of ids!)assert.equal(roleOf(id),role,id);
    assert.equal(r.mini.length,2);for(const id of r.mini)assert.equal(roleOf(id),'mini-chefe');
    const ids=rotationIds(r);assert.equal(new Set(ids).size,ids.length,'no entry twice');
    assert.ok(!ids.some(id=>roleOf(id)==='chefe'),'the boss is not in the rotation');
  }
  assert.ok(sizes.has(12)&&sizes.has(18),`sizes drawn: ${[...sizes].sort((a,b)=>a-b).join(',')}`);
  // The minimums add up to 12 with the two mini-chefes; the maximums to 18.
  assert.equal(ROTATION_SLOTS.reduce((n,s)=>n+s.min,0)+2,12);assert.equal(ROTATION_SLOTS.reduce((n,s)=>n+s.max,0)+2,18);
});

test('P0 first: every role has enough P0 entries for its slots, so a rotation is all P0; the cast varies across runs',()=>{
  for(const s of ROTATION_SLOTS)assert.ok(ROSTER.filter(e=>e.role===s.role&&e.priority==='P0').length>=s.max,`${s.role}: P0 ≥ ${s.max}`);
  const seen=new Set<string>();
  for(const r of rotations)for(const id of rotationIds(r)){assert.equal(rosterEntry(id)!.priority,'P0',id);seen.add(id);}
  const p0=ROSTER.filter(e=>e.priority==='P0'&&e.role!=='chefe').length;
  assert.ok(seen.size>=p0-2,`300 runs used ${seen.size} of the ${p0} P0 entries`);
});

test('band rules: early corredores + enxames + one palhaço; mid adds arremessador/atirador/suporte(/voador); late the rest; minis in 5 and 8',()=>{
  const EARLY=['corredor','enxame','palhaco'],MID=[...EARLY,'arremessador','atirador','suporte','voador'];
  for(const r of rotations){
    for(let round=1;round<=10;round++){
      const rr=roundRoster(r,round),roles=Object.keys(rr.roles);
      const allowed=round<=3?EARLY:round<=6?MID:Object.keys(r.roles);
      for(const role of roles)assert.ok(allowed.includes(role),`round ${round}: ${role}`);
      for(const role of allowed)if(r.roles[role as EnemyRole]?.length)assert.ok(roles.includes(role),`round ${round} has its ${role}`);
      assert.equal(rr.roles.palhaco?.length,1,'exactly one palhaço entry');
      if(round>=7)for(const role of ['kamikaze','refletor','invocador','brutamontes'])assert.ok(rr.roles[role as EnemyRole]?.length,`round ${round}: ${role}`);
      assert.equal(rr.elite,round===5?r.mini[0]:undefined,`round ${round} elite`);
      assert.equal(rr.solo,round===8?r.mini[1]:undefined,`round ${round} solo`);
    }
  }
  assert.deepEqual([bandOf(1),bandOf(3),bandOf(4),bandOf(6),bandOf(7),bandOf(10)],['early','early','mid','mid','late','late']);
  assert.deepEqual([...MINI_ROUNDS],[5,8]);
});

test('determinism and checkpoint: same seed same rotation, JSON round-trip, isRotation refuses a tampered one',()=>{
  assert.deepEqual(drawRotation(new Rng(77)),drawRotation(new Rng(77)));
  assert.ok(rotations.filter((r,i)=>i&&JSON.stringify(r)!==JSON.stringify(rotations[i-1])).length>250,'seeds differ');
  for(const r of rotations.slice(0,20)){
    const back=JSON.parse(JSON.stringify(r)) as Rotation;
    assert.deepEqual(back,r);assert.ok(isRotation(back));
    for(let round=1;round<=10;round++)assert.deepEqual(roundRoster(back,round),roundRoster(r,round));
  }
  assert.ok(!isRotation(null)&&!isRotation({roles:{},mini:'x'}));
  assert.ok(!isRotation({roles:{corredor:['tio-pave']},mini:[]}),'an entry under another role');
  assert.ok(!isRotation({roles:{},mini:['bebado']}),'a mini-chefe that is not one');
});

const threatOf=(kind:string)=>kind in THREAT?THREAT[kind as RegularKind]:ROLE_PROFILES[roleOf(kind)!].threat;
const regularThreat=(plan:ReturnType<typeof planRound>)=>plan.groups.filter(g=>!g.boss&&!g.elite&&!g.solo).flatMap(g=>g.members).reduce((n,k)=>n+threatOf(k),0);
test('planRound with the rotation: the round\'s entries by role, threat budget kept, minis as their own groups',()=>{
  for(const [i,r] of rotations.slice(0,40).entries())for(let round=1;round<=10;round++)for(const players of [1,3,6]){
    const roster=roundRoster(r,round),seed=1000+i*10+round;
    const table=planRound(round,players,{name:'x'},new Rng(seed)),rot=planRound(round,players,{name:'x'},new Rng(seed),roster);
    const allowed=new Set(Object.values(roster.roles).flat());
    for(const g of rot.groups){
      if(g.boss){assert.deepEqual(g.members,['chefe']);continue;}
      if(g.elite){assert.deepEqual(g.members,[roster.elite]);continue;}
      if(g.solo){assert.deepEqual(g.members,[roster.solo]);continue;}
      for(const k of g.members)assert.ok(allowed.has(k),`round ${round}: ${k} is not in the round's rotation`);
    }
    // The regular threat stays within ~10% of the table's (count normalized), less the lone mini-chefe's share.
    const want=regularThreat(table)-(roster.solo?ROLE_PROFILES['mini-chefe'].threat*(1+.5*(players-1)):0),got=regularThreat(rot);
    assert.ok(Math.abs(got-want)<=Math.max(3,want*.1),`round ${round} ${players}p: threat ${got.toFixed(1)} vs ${want.toFixed(1)}`);
    if(round===8){assert.equal(rot.groups.filter(g=>g.solo).length,1);assert.ok(rot.miniHp!>0&&rot.miniHp!<rot.eliteHp);}
    else assert.ok(!rot.groups.some(g=>g.solo)&&rot.miniHp===undefined);
    assert.equal(rot.groups.filter(g=>g.elite).length,round===5?1:0);
    // Rounds 1-2 have the table's threat per member: the same groups at the same times, only the kinds change.
    if(round<=2)assert.deepEqual(rot.groups.map(g=>[g.at,g.members.length]),table.groups.map(g=>[g.at,g.members.length]));
  }
});

test('planRound with the rotation reads the modifiers by role (uncle-party → palhaços, bug-spray → no enxame, taxman → no atirador)',()=>{
  const r=rotations[3];
  const plan=(round:number,mod:string)=>planRound(round,1,{name:'x',modifierId:mod},new Rng(5),roundRoster(r,round));
  const roles=(p:ReturnType<typeof planRound>)=>p.groups.filter(g=>!g.elite&&!g.solo&&!g.boss).flatMap(g=>g.members).map(k=>roleOf(k));
  const uncle=roles(plan(7,'uncle-party'));assert.ok(uncle.filter(x=>x==='palhaco').length/uncle.length>.3,'uncle-party: a third or more palhaços');
  assert.ok(!roles(plan(7,'bug-spray')).includes('enxame'),'bug-spray: no enxame');
  assert.ok(!roles(plan(7,'taxman-day-off')).includes('atirador'),'taxman-day-off: no atirador');
  assert.ok(MODIFIERS.every(m=>{for(let round=3;round<=9;round++)if(!m.banRounds.includes(round))plan(round,m.id);return true;}),'every modifier plans');
  // Without a rotation the round table is untouched: its nine kinds only.
  for(let round=1;round<=10;round++)for(const g of planRound(round,6,{name:'x'},new Rng(round)).groups)
    for(const k of g.members)assert.ok(k==='chefe'||k in THREAT,`table round ${round}: ${k}`);
  assert.equal(ROTATION_WEIGHTS.length,10);
});
