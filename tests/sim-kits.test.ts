import test from 'node:test';
import assert from 'node:assert/strict';
import {Rng} from '../src/game/sim/rng.ts';
import {ticks,type EnemyState,type PickupState,type PlayerBuild,type RoundPhase,type SimContext,type SimEvent,type SimPlayer} from '../src/game/sim/types.ts';
import {clearSegment,moveDirection,walkable,type Point} from '../src/game/world.ts';
import {STAT_KEYS,STAT_LIMITS,computeStats} from '../src/game/sim/stats.ts';
import {WEAPON_IDS} from '../src/game/sim/evolutions.ts';
import {DEFAULT_KIT,KITS,classBonusOf,kitFor,startingBuild} from '../src/game/sim/kits.ts';
import {ANNUL_IMMUNITY_SECONDS,FOUND_PICKUP_SECONDS,REFUNDERS,REFUND_FLOOR_SHARE,SKILL_PICKUP_CAP,castSkill,hasSkill,resetSkill,skillReadyTick,type DiceOutcome,type SkillCast,type SkillPlayer,type TauntedEnemy} from '../src/game/sim/skills.ts';
import {classes,getClass,roles} from '../src/classes.ts';
import {BLEED_OUT_TICKS} from '../src/game/sim/revive.ts';

// ---------- Fakes ----------
const FIXED_WEAPONS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio'];
const SKILL_IDS=['cidadao-comum','mendigo','viciado-em-bet','clt-cansado','motogirl','vizinha-fofoqueira'];
interface Hit {id:string;amount:number;src?:string;weapon?:string;killed:boolean}
interface FakeCtx {tick:number;rng:Rng;players:Map<string,SimPlayer>;enemies:Map<string,EnemyState>;pickups:Map<string,PickupState>;
  projectiles:Map<string,unknown>;telegraphs:Map<string,unknown>;team:{xp:number;level:number;nextXp:number};offers:Map<string,unknown>;
  round:{index:number;total:number;phase:RoundPhase;phaseEndsTick:number;remaining:number};events:SimEvent[];hits:Hit[];
  enemyIndex:{rebuild():void;query(x:number,y:number,r:number,out?:EnemyState[]):EnemyState[];nearest(x:number,y:number,r:number,filter?:(e:EnemyState)=>boolean):EnemyState|undefined};
  nextId(prefix:string):string;emit(e:SimEvent):void;damageEnemy(id:string,amount:number,src?:string,weapon?:string):boolean;damagePlayer():void}
const makeCtx=(seed=1,tick=100)=>{
  let counter=0;const events:SimEvent[]=[],hits:Hit[]=[];const enemies=new Map<string,EnemyState>();
  const within=(e:EnemyState,x:number,y:number,r:number)=>Math.hypot(e.x-x,e.y-y)<=r;
  const fake:FakeCtx={tick,rng:new Rng(seed),players:new Map(),enemies,pickups:new Map(),projectiles:new Map(),telegraphs:new Map(),
    team:{xp:0,level:1,nextXp:10},offers:new Map(),round:{index:0,total:5,phase:'wave',phaseEndsTick:0,remaining:0},events,hits,
    enemyIndex:{
      rebuild(){},
      query(x,y,r,out=[]){out.length=0;for(const e of enemies.values())if(within(e,x,y,r))out.push(e);return out;},
      nearest(x,y,r,filter){let best:EnemyState|undefined,bd=Infinity;
        for(const e of enemies.values()){const d=Math.hypot(e.x-x,e.y-y);if(d<=r&&d<bd&&(!filter||filter(e))){best=e;bd=d;}}return best;},
    },
    nextId:prefix=>`${prefix}${++counter}`,emit:e=>{events.push(e);},
    damageEnemy(id,amount,src,weapon){
      const e=enemies.get(id);if(!e){hits.push({id,amount,src,weapon,killed:false});return false;}
      e.hp-=amount;const killed=e.hp<=0;if(killed)enemies.delete(id);
      hits.push({id,amount,src,weapon,killed});return killed;
    },
    damagePlayer(){throw new Error('skills must not hurt players');},
  };
  return {fake,ctx:fake as unknown as SimContext,events,hits};
};
const NO_BUILD=():PlayerBuild=>({weapons:[],passives:[]});
const addPlayer=(fake:FakeCtx,id:string,classId:string,x=10,y=10,extra:Partial<SimPlayer>={},build:PlayerBuild=NO_BUILD()):SimPlayer=>{
  const stats=computeStats(build,classBonusOf(classId));
  const p:SimPlayer={id,classId,x,y,hp:stats.maxHp,online:true,spectator:false,facing:{x:1,y:0},build,stats,weaponReady:{},...extra};
  fake.players.set(id,p);return p;
};
const addEnemy=(fake:FakeCtx,id:string,x:number,y:number,hp=100):EnemyState=>{
  const e:EnemyState={id,kind:'rato',x,y,hp,maxHp:hp,speed:1,damage:1,radius:0.3,xp:1,spawnTick:0,readyTick:0};
  fake.enemies.set(id,e);return e;
};
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
/** Casts with Math.random poisoned: skills must only use the seeded RNG. */
const cast=(ctx:SimContext,p:SimPlayer):SkillCast|null=>{
  const original=Math.random;
  Math.random=()=>{throw new Error('Math.random used in a skill');};
  try{return castSkill(ctx,p);}finally{Math.random=original;}
};
const dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const near=(a:number,b:number,eps=1e-9)=>Math.abs(a-b)<eps;

// ---------- 1. Kit data ----------
test('kits: 36 valid kits, one per class, fixed weapons, 6-30 s cooldowns',()=>{
  assert.equal(KITS.length,36);
  assert.deepEqual([...WEAPON_IDS].sort(),[...FIXED_WEAPONS].sort());
  for(const kit of KITS){
    assert.ok(getClass(kit.classId),`class ${kit.classId} exists`);
    assert.ok(FIXED_WEAPONS.includes(kit.weapon),`${kit.classId} weapon ${kit.weapon}`);
    assert.ok(Number.isFinite(kit.skill.cooldown)&&kit.skill.cooldown>=6&&kit.skill.cooldown<=30,`${kit.classId} cd ${kit.skill.cooldown}`);
    assert.ok(roles.includes(kit.role));
    assert.equal(kit.role,getClass(kit.classId)!.role,`${kit.classId} role matches class card`);
    assert.ok(kit.skill.effect.trim().length>0);
    assert.equal(kitFor(kit.classId),kit);
    assert.ok(hasSkill(kit.classId),kit.classId);
  }
  assert.equal(new Set(KITS.map(k=>k.classId)).size,36);
  assert.deepEqual(KITS.map(k=>k.classId).sort(),classes.map(c=>c.id).sort());
  for(const id of SKILL_IDS)assert.ok(kitFor(id),id);
});
test('kits: all 4 roles covered, every fixed weapon is a starting weapon for 4-7 classes, required classes present',()=>{
  assert.deepEqual([...new Set(KITS.map(k=>k.role))].sort(),[...roles].sort());
  for(const w of FIXED_WEAPONS){const n=KITS.filter(k=>k.weapon===w).length;assert.ok(n>=4&&n<=7,`${w} starts ${n} classes`);}
  for(const id of ['cidadao-comum','mendigo','viciado-em-bet'])assert.ok(kitFor(id),id);
});
test('kits: >=3 distinct pt-BR lines and skill name equals the class card',()=>{
  for(const kit of KITS){
    const lines=kit.lines.map(l=>l.trim());
    assert.ok(lines.length>=3&&lines.every(l=>l.length>0),kit.classId);
    assert.equal(new Set(lines).size,lines.length,`${kit.classId} distinct lines`);
    assert.equal(kit.skill.name,getClass(kit.classId)!.skill,kit.classId);
  }
  // Every card class with the same skill name maps 1:1.
  assert.equal(classes.filter(c=>kitFor(c.id)).length,36);
  // Lines fit the phone balloon and never repeat across classes.
  const all=KITS.flatMap(k=>k.lines.map(l=>l.trim().toLocaleLowerCase('pt-BR')));
  assert.equal(new Set(all).size,all.length,'no line repeated across classes');
  for(const kit of KITS)for(const l of kit.lines)assert.ok(l.length<=60,`${kit.classId}: ${l}`);
});
test('kits: classBonus only uses PlayerStats keys and stays within STAT_LIMITS',()=>{
  for(const kit of KITS){
    for(const [k,v] of Object.entries(kit.classBonus)){
      assert.ok((STAT_KEYS as string[]).includes(k),`${kit.classId}.${k}`);
      assert.ok(typeof v==='number'&&Number.isFinite(v),`${kit.classId}.${k}=${v}`);
    }
    const s=computeStats(NO_BUILD(),kit.classBonus);
    for(const k of STAT_KEYS){
      const [min,max]=STAT_LIMITS[k];
      assert.ok(s[k]>=min&&s[k]<=max,`${kit.classId}.${k}=${s[k]}`);
      // Unclamped: the bonus is applied as designed, not silently cut.
      const raw=computeStats(NO_BUILD())[k]+(kit.classBonus[k]??0);
      assert.ok(near(s[k],raw,1e-6),`${kit.classId}.${k} not clamped`);
    }
  }
});
test('kits: classBonusOf returns a copy, unknown class falls back, startingBuild uses the kit weapon',()=>{
  for(const kit of KITS){
    const before=clone(kit.classBonus);
    const bonus=classBonusOf(kit.classId);
    assert.deepEqual(bonus,before);assert.notEqual(bonus,kit.classBonus);
    bonus.maxHp=999;bonus.might=99;
    assert.deepEqual(kit.classBonus,before);
    assert.deepEqual(classBonusOf(kit.classId),before);
    assert.deepEqual(startingBuild(kit.classId),{weapons:[{id:kit.weapon,level:1}],passives:[]});
  }
  for(const id of ['nope','','PEDREIRO']){
    const bonus=classBonusOf(id);
    assert.deepEqual(bonus,{});
    bonus.might=5;
    assert.deepEqual(classBonusOf(id),{});
    assert.deepEqual(DEFAULT_KIT.classBonus,{});
    assert.deepEqual(startingBuild(id),{weapons:[{id:'chinelo',level:1}],passives:[]});
    assert.equal(kitFor(id),undefined);assert.equal(hasSkill(id),false);
  }
  const a=startingBuild('mendigo'),b=startingBuild('mendigo');
  a.weapons[0].level=8;assert.equal(b.weapons[0].level,1);
});

// ---------- 2. cidadao-comum ----------
/** Where Só Estou de Passagem lands: 4 walkable steps of 0.1 s along facing (no terrain: fallback island). */
const stepped=(from:Point,facing:Point):Point=>{
  let at={x:from.x,y:from.y};
  for(let i=0;i<4;i++){const next=moveDirection(at,facing,0.1);if(next===at)break;at=next;}
  return at;
};
const DOWNED={downed:{sinceTick:0,bleedOutTick:999,progress:0}};
test('cidadao-comum: steps ~1.2 forward, hits within 2.5 of the new spot, knocks away and shields allies within 3',()=>{
  const {fake,ctx,hits,events}=makeCtx(1,100);
  const start={x:10,y:10};
  const n=stepped(start,{x:1,y:0});
  assert.ok(walkable(start)&&walkable(n)&&clearSegment(start,n));
  assert.ok(near(n.x,11.24,1e-9)&&n.y===10,`${n.x},${n.y}`);
  const p=addPlayer(fake,'p1','cidadao-comum',start.x,start.y);
  const ally=addPlayer(fake,'p2','mendigo',n.x-2.9,10);
  const oldOnly=addPlayer(fake,'p3','motogirl',n.x-3.1,10);
  const downed=addPlayer(fake,'p4','clt-cansado',n.x+1,10,DOWNED);
  const top=addEnemy(fake,'top',n.x,n.y),e1=addEnemy(fake,'e1',n.x+1,10),e2=addEnemy(fake,'e2',n.x,8),e3=addEnemy(fake,'e3',n.x+2.49,10);
  addEnemy(fake,'weak',n.x-1.5,10,5);
  // 1.36 from the start: only hit if the skill ignored the step.
  const behind=addEnemy(fake,'behind',n.x-2.6,10);
  const res=cast(ctx,p);
  assert.ok(res);
  assert.deepEqual(res.movedTo,n);assert.equal(p.x,n.x);assert.equal(p.y,n.y);
  assert.deepEqual(res.hits,['top','e1','weak','e2','e3']);
  assert.deepEqual(hits.map(h=>[h.id,h.amount,h.src,h.weapon]),res.hits.map(id=>[id,8,'p1','skill:cidadao-comum']));
  assert.ok(!fake.enemies.has('weak'));
  assert.equal(behind.hp,100);assert.equal(behind.knock,undefined);
  for(const e of [e1,e2,e3]){
    assert.equal(e.hp,92);assert.ok(e.knock,e.id);
    assert.ok(e.knock.x*(e.x-p.x)+e.knock.y*(e.y-p.y)>0,`${e.id} pushed away`);
    assert.ok(near(Math.hypot(e.knock.x,e.knock.y),0.8));
  }
  assert.ok(near(e2.knock!.y,-0.8)&&near(e2.knock!.x,0));
  // Exactly on top: pushed along facing.
  assert.deepEqual(top.knock,{x:0.8,y:0});assert.equal(top.hp,92);
  const until=100+ticks(Math.min(1.5,0.8+0.1*5));
  assert.equal(until,100+ticks(1.3));
  assert.equal(p.invulnerableUntil,until);assert.equal(ally.invulnerableUntil,until);
  assert.equal(oldOnly.invulnerableUntil,undefined);assert.equal(downed.invulnerableUntil,undefined);
  assert.deepEqual(res.helped,['p1','p2']);
  // The fire event marks where the step started.
  assert.equal(events.length,1);const fire=events[0];
  assert.ok(fire.type==='fire');assert.equal(fire.x,10);assert.equal(fire.y,10);assert.equal(fire.dx,1);
});
test('cidadao-comum: shield = min(1.5, 0.8 + 0.1 per enemy) s, works with no enemies, never shortens',()=>{
  const shieldFor=(count:number,duration=1)=>{
    const {fake,ctx}=makeCtx(2,50);
    const p=addPlayer(fake,'p1','cidadao-comum');
    p.stats={...p.stats,duration};
    const n=stepped(p,p.facing);
    for(let i=0;i<count;i++)addEnemy(fake,`e${i}`,n.x+Math.cos(i)*2,n.y+Math.sin(i)*2);
    const res=cast(ctx,p);
    assert.ok(res);assert.equal(res.hits.length,count);
    return p.invulnerableUntil!-50;
  };
  assert.deepEqual([0,1,3,5,7,10,20].map(c=>shieldFor(c)),[0.8,0.9,1.1,1.3,1.5,1.5,1.5].map(ticks));
  assert.equal(shieldFor(0,3),ticks(0.8),'invulnerability ignores stats.duration');
  assert.equal(shieldFor(20,3),ticks(1.5));
  const {fake,ctx}=makeCtx(2,50);
  const p=addPlayer(fake,'p1','cidadao-comum',10,10,{invulnerableUntil:500});
  assert.ok(cast(ctx,p));assert.equal(p.invulnerableUntil,500);
});
test('cidadao-comum: the step only crosses walkable ground (blocked → no move, shore → partial)',()=>{
  // Rock at (11,12): stepping south from (11,11) is blocked and there is no sideways slide.
  {
    const {fake,ctx}=makeCtx(3,100);
    assert.ok(walkable({x:11,y:11}));assert.ok(!clearSegment({x:11,y:11},{x:11,y:11.31}));
    const p=addPlayer(fake,'p1','cidadao-comum',11,11,{facing:{x:0,y:1}});
    const e=addEnemy(fake,'e',11,9);
    const res=cast(ctx,p);
    assert.ok(res);assert.equal(res.movedTo,undefined);
    assert.equal(p.x,11);assert.equal(p.y,11);
    assert.deepEqual(res.hits,['e']);assert.deepEqual(e.knock,{x:0,y:-0.8});
  }
  // North shore: stops at the last walkable step.
  {
    const {fake,ctx}=makeCtx(3,100);
    const p=addPlayer(fake,'p1','cidadao-comum',12,2.6,{facing:{x:0,y:-1}});
    assert.ok(walkable({x:12,y:2.6}));
    const res=cast(ctx,p);
    assert.ok(res&&res.movedTo);
    assert.deepEqual(res.movedTo,{x:p.x,y:p.y});
    assert.equal(p.x,12);assert.ok(p.y<2.6&&2.6-p.y<1.2,`${p.y}`);
    assert.ok(walkable(p));
  }
  // No facing: stays put.
  {
    const {fake,ctx}=makeCtx(3,100);
    const p=addPlayer(fake,'p1','cidadao-comum',10,10,{facing:{x:0,y:0}});
    const res=cast(ctx,p);
    assert.ok(res);assert.equal(res.movedTo,undefined);assert.equal(p.x,10);assert.equal(p.y,10);
  }
});

// ---------- 3. mendigo ----------
test('mendigo: heals 20 and shields 1 s standing allies within 3.5, never downed ones',()=>{
  const {fake,ctx}=makeCtx(3,100);
  const p=addPlayer(fake,'p1','mendigo',10,10);p.hp=50;p.stats={...p.stats,duration:3};
  const a=addPlayer(fake,'p2','cidadao-comum',13.5,10);a.hp=a.stats.maxHp-5;
  const b=addPlayer(fake,'p3','clt-cansado',10,12);b.hp=20;
  const far=addPlayer(fake,'p4','motogirl',13.6,10);far.hp=10;
  const d=addPlayer(fake,'p5','motogirl',10,11,{hp:10,...DOWNED});
  const off=addPlayer(fake,'p6','motogirl',10,11,{hp:10,online:false});
  const res=cast(ctx,p);
  assert.ok(res);
  assert.equal(p.hp,70);assert.equal(a.hp,a.stats.maxHp);assert.equal(b.hp,40);
  assert.equal(far.hp,10);assert.equal(d.hp,10);assert.equal(off.hp,10);
  for(const x of [p,a,b])assert.equal(x.invulnerableUntil,100+ticks(1),x.id);
  for(const x of [far,d,off])assert.equal(x.invulnerableUntil,undefined,x.id);
  assert.deepEqual(res.helped,['p1','p2','p3']);
  assert.deepEqual(res.hits,[]);
});
test('mendigo: during a wave finds one heal(30)/magnet(1) pickup that expires, never xp; none at the cap',()=>{
  const kinds=new Set<string>();
  for(let seed=1;seed<=80;seed++){
    const {fake,ctx,events}=makeCtx(seed,100);
    const p=addPlayer(fake,'p1','mendigo',7,9);
    const res=cast(ctx,p);
    assert.ok(res&&res.pickup);
    assert.equal(fake.pickups.size,1);
    const pick=fake.pickups.get(res.pickup)!;
    assert.ok(pick);assert.equal(pick.id,res.pickup);
    assert.ok(pick.kind==='heal'||pick.kind==='magnet',pick.kind);
    assert.equal(pick.value,pick.kind==='heal'?30:1);
    kinds.add(pick.kind);
    assert.ok(dist(pick,p)<=1,`pickup near player: ${dist(pick,p)}`);
    assert.equal(pick.spawnTick,100);
    assert.equal(pick.expiresTick,100+ticks(FOUND_PICKUP_SECONDS));
    assert.equal(events.filter(e=>e.type==='fire').length,1);
  }
  assert.deepEqual([...kinds].sort(),['heal','magnet']);
  const {fake,ctx}=makeCtx(4,100);
  for(let i=0;i<SKILL_PICKUP_CAP;i++)fake.pickups.set(`x${i}`,{id:`x${i}`,kind:'xp',value:1,x:0,y:0,spawnTick:0});
  const p=addPlayer(fake,'p1','mendigo');p.hp=10;
  const res=cast(ctx,p);
  assert.ok(res);assert.equal(res.pickup,undefined);
  assert.equal(fake.pickups.size,SKILL_PICKUP_CAP);
  assert.equal(p.hp,30);
});
test('mendigo: no pickup during the prepare phase (cannot be farmed between rounds)',()=>{
  for(let seed=1;seed<=20;seed++){
    const {fake,ctx}=makeCtx(seed,100);
    fake.round.phase='prepare';
    const p=addPlayer(fake,'p1','mendigo');p.hp=10;
    const res=cast(ctx,p);
    assert.ok(res);assert.equal(res.pickup,undefined);
    assert.equal(fake.pickups.size,0);assert.equal(p.hp,30);
    assert.ok(skillReadyTick(p)>100);
  }
});

// ---------- 4. viciado-em-bet ----------
const DICE_DAMAGE:Record<DiceOutcome,number>={flop:15,hit:30,miracle:60};
test('viciado-em-bet: hits a valid player.target within 7, else the nearest enemy',()=>{
  const scenario=(target:string|undefined,setup?:(fake:FakeCtx)=>void)=>{
    const {fake,ctx,hits}=makeCtx(5,100);
    const p=addPlayer(fake,'p1','viciado-em-bet',10,10,{target});
    addEnemy(fake,'near',11,10,1000);addEnemy(fake,'mid',10,15,1000);addEnemy(fake,'far',18,10,1000);
    setup?.(fake);
    const res=cast(ctx,p);
    assert.ok(res);assert.equal(hits.length,1);assert.deepEqual(res.hits,[hits[0].id]);
    assert.equal(hits[0].src,'p1');assert.equal(hits[0].weapon,'skill:viciado-em-bet');
    return hits[0].id;
  };
  assert.equal(scenario(undefined),'near');
  assert.equal(scenario('mid'),'mid');
  assert.equal(scenario('far'),'near');
  assert.equal(scenario('ghost'),'near');
  assert.equal(scenario('mid',f=>{f.enemies.get('mid')!.hp=0;}),'near');
  assert.equal(scenario(undefined,f=>{f.enemies.get('near')!.hp=0;}),'mid');
  assert.equal(scenario('mid',f=>{f.enemies.get('mid')!.y=17;}),'mid');
  assert.equal(scenario('mid',f=>{f.enemies.get('mid')!.y=17.01;}),'near');
});
test('viciado-em-bet: dice deal 15/30/60 for flop/hit/miracle at ~50/35/15',()=>{
  const counts:Record<DiceOutcome,number>={flop:0,hit:0,miracle:0};const N=3000;
  for(let seed=1;seed<=N;seed++){
    const {fake,ctx,hits}=makeCtx(seed,100+(seed%7));
    const p=addPlayer(fake,'p1','viciado-em-bet');
    addEnemy(fake,'e1',12,10,1000);
    const res=cast(ctx,p);
    assert.ok(res&&res.outcome);
    assert.ok(res.outcome in DICE_DAMAGE,res.outcome);
    assert.equal(hits.length,1);
    assert.equal(hits[0].amount,DICE_DAMAGE[res.outcome],`${seed}:${res.outcome}`);
    assert.equal(fake.enemies.get('e1')!.hp,1000-DICE_DAMAGE[res.outcome]);
    counts[res.outcome]++;
  }
  assert.ok(counts.flop>0&&counts.hit>0&&counts.miracle>0,JSON.stringify(counts));
  assert.ok(Math.abs(counts.flop/N-0.5)<0.04,JSON.stringify(counts));
  assert.ok(Math.abs(counts.hit/N-0.35)<0.04,JSON.stringify(counts));
  assert.ok(Math.abs(counts.miracle/N-0.15)<0.03,JSON.stringify(counts));
});
test('viciado-em-bet: no target in range returns null and spends no cooldown',()=>{
  const {fake,ctx,events,hits}=makeCtx(6,100);
  const p=addPlayer(fake,'p1','viciado-em-bet',10,10,{target:'far'});
  addEnemy(fake,'far',17.5,10);addEnemy(fake,'dead',11,10,0);
  const rngBefore=fake.rng.state;
  assert.equal(cast(ctx,p),null);
  assert.equal(skillReadyTick(p),0);assert.equal((p as SkillPlayer).skillReady,undefined);
  assert.equal(events.length,0);assert.equal(hits.length,0);assert.equal(fake.rng.state,rngBefore);
  addEnemy(fake,'e1',12,10);
  assert.ok(cast(ctx,p));
});

// ---------- 5. clt-cansado ----------
test('clt-cansado: 2.5 s invulnerable and taunts enemies within 5 for 4 s',()=>{
  const {fake,ctx,hits}=makeCtx(7,200);
  const p=addPlayer(fake,'p1','clt-cansado',10,10);
  const ally=addPlayer(fake,'p2','mendigo',11,10);
  const a=addEnemy(fake,'a',12,10),b=addEnemy(fake,'b',10,15),c=addEnemy(fake,'c',15.1,10),d=addEnemy(fake,'d',3,3);
  const res=cast(ctx,p);
  assert.ok(res);
  assert.equal(p.invulnerableUntil,200+ticks(2.5));
  assert.equal(ally.invulnerableUntil,undefined);
  for(const e of [a,b]){
    assert.deepEqual((e as TauntedEnemy).taunt,{player:'p1',untilTick:200+ticks(4)},e.id);
    assert.equal(e.hp,100);
  }
  assert.equal((c as TauntedEnemy).taunt,undefined);assert.equal((d as TauntedEnemy).taunt,undefined);
  assert.deepEqual(res.hits,['a','b']);assert.deepEqual(res.helped,['p1']);
  assert.equal(hits.length,0);
});

// ---------- 6. motogirl ----------
test('motogirl: dashes to the most hurt standing ally in 8, lands 0.5 short, heals 25, hits enemies near the path',()=>{
  const {fake,ctx,hits}=makeCtx(8,100);
  const p=addPlayer(fake,'p1','motogirl',10,10);
  // Ratio decides, not absolute hp: a=40/110 (0.36), b=50/190 (0.26), b has more absolute hp.
  const a=addPlayer(fake,'a','cidadao-comum',10,13);a.hp=40;
  const b=addPlayer(fake,'b','clt-cansado',16,10,{},{weapons:[],passives:[{id:'marmita',level:3}]});
  assert.equal(b.stats.maxHp,190);b.hp=50;
  const downed=addPlayer(fake,'d','mendigo',11,10,{hp:1,...DOWNED});
  const off=addPlayer(fake,'o','mendigo',11,11,{hp:1,online:false});
  const spec=addPlayer(fake,'s','mendigo',11,12,{hp:1,spectator:true});
  const away=addPlayer(fake,'far','mendigo',18.1,10);away.hp=1;
  const onPath=addEnemy(fake,'onPath',13,10.5),edge=addEnemy(fake,'edge',14,9.25);
  const offPath=addEnemy(fake,'offPath',12,11.0001),behind=addEnemy(fake,'behind',9,10),beyond=addEnemy(fake,'beyond',16.9,10);
  assert.ok(clearSegment({x:16,y:10},{x:15.5,y:10}));
  const res=cast(ctx,p);
  assert.ok(res);
  assert.deepEqual(res.helped,['b']);
  assert.deepEqual(res.movedTo,{x:15.5,y:10});
  assert.equal(p.x,15.5);assert.equal(p.y,10);
  assert.deepEqual(p.facing,{x:1,y:0});
  assert.equal(b.hp,75);
  assert.equal(a.hp,40);assert.equal(downed.hp,1);assert.equal(off.hp,1);assert.equal(spec.hp,1);assert.equal(away.hp,1);
  assert.deepEqual([...res.hits].sort(),['edge','onPath']);
  for(const h of hits){assert.equal(h.amount,12);assert.equal(h.src,'p1');assert.equal(h.weapon,'skill:motogirl');}
  assert.equal(onPath.hp,88);assert.equal(edge.hp,88);
  for(const e of [offPath,behind,beyond])assert.equal(e.hp,100,e.id);
  const fire=fake.events.find(e=>e.type==='fire');
  assert.ok(fire&&fire.type==='fire');assert.equal(fire.x,10);assert.equal(fire.y,10);
});
test('motogirl: lands on the ally when the spot 0.5 short is not walkable',()=>{
  const {fake,ctx}=makeCtx(8,100);
  // Rock at (11,12) blocks (11,12.5).
  const p=addPlayer(fake,'p1','motogirl',11,9);
  const ally=addPlayer(fake,'a','mendigo',11,13);ally.hp=10;
  assert.ok(walkable(ally));assert.ok(!clearSegment({x:11,y:13},{x:11,y:12.5}));
  const res=cast(ctx,p);
  assert.ok(res);
  assert.deepEqual(res.movedTo,{x:11,y:13});assert.equal(p.x,11);assert.equal(p.y,13);
  assert.deepEqual(p.facing,{x:0,y:1});
  assert.equal(ally.hp,35);
});
test('motogirl: heal is capped and ratio ties break by id',()=>{
  const {fake,ctx}=makeCtx(9,100);
  const p=addPlayer(fake,'p1','motogirl',10,10);
  const z=addPlayer(fake,'z','mendigo',12,10);z.hp=z.stats.maxHp-5;
  const y=addPlayer(fake,'y','mendigo',8,10);y.hp=y.stats.maxHp-5;
  const res=cast(ctx,p);
  assert.ok(res);assert.deepEqual(res.helped,['y']);
  assert.equal(y.hp,y.stats.maxHp);assert.equal(z.hp,z.stats.maxHp-5);
  assert.deepEqual(res.movedTo,{x:8.5,y:10});
  assert.deepEqual(p.facing,{x:-1,y:0});
});
test('motogirl: with no hurt ally heals self 15 without moving; at full HP returns null and spends nothing',()=>{
  const {fake,ctx,hits,events}=makeCtx(10,100);
  const p=addPlayer(fake,'p1','motogirl',10,10);p.hp=50;
  addPlayer(fake,'d','mendigo',11,10,{hp:1,...DOWNED});
  addPlayer(fake,'far','mendigo',18.5,10,{hp:1});
  const full=addPlayer(fake,'full','mendigo',12,10);
  addEnemy(fake,'e1',11,10);
  const res=cast(ctx,p);
  assert.ok(res);
  assert.equal(p.hp,65);assert.equal(p.x,10);assert.equal(p.y,10);
  assert.equal(res.movedTo,undefined);assert.deepEqual(res.helped,['p1']);assert.deepEqual(res.hits,[]);
  assert.equal(full.hp,full.stats.maxHp);
  assert.equal(hits.length,0);
  fake.tick=res.readyTick;p.hp=p.stats.maxHp-3;
  const capped=cast(ctx,p);
  assert.ok(capped);assert.equal(p.hp,p.stats.maxHp);
  // Everyone full: nothing to deliver.
  fake.tick=capped.readyTick;
  const n=events.length,ready=skillReadyTick(p);
  assert.equal(cast(ctx,p),null);
  assert.equal(events.length,n);assert.equal(skillReadyTick(p),ready);
  assert.equal(p.x,10);assert.equal(p.y,10);
  // Hurt ally appears: works on the same tick.
  full.hp=1;
  const go=cast(ctx,p);
  assert.ok(go);assert.deepEqual(go.helped,['full']);assert.equal(full.hp,26);
});

// ---------- 7. vizinha-fofoqueira ----------
test('vizinha-fofoqueira: slows 3 s and damages at most the 5 nearest enemies within 6 * area (6.9 with the kit)',()=>{
  const {fake,ctx,hits}=makeCtx(11,300);
  const p=addPlayer(fake,'p1','vizinha-fofoqueira',10,10);
  assert.ok(near(p.stats.area,1.15));
  const ds=[5.9,1,4,2,3,5,0.5,6.5,8];
  ds.forEach((d,i)=>addEnemy(fake,`e${i}`,10+d,10));
  addEnemy(fake,'dead',10.2,10,0);
  const res=cast(ctx,p);
  assert.ok(res);
  assert.deepEqual(res.hits,['e6','e1','e3','e4','e2']);
  assert.deepEqual(hits.map(h=>[h.id,h.amount,h.src,h.weapon]),res.hits.map(id=>[id,5,'p1','skill:vizinha-fofoqueira']));
  for(const id of res.hits){const e=fake.enemies.get(id)!;assert.equal(e.slowUntil,300+ticks(3));assert.equal(e.hp,95);}
  for(const id of ['e0','e5','e7','e8']){const e=fake.enemies.get(id)!;assert.equal(e.slowUntil,undefined,id);assert.equal(e.hp,100);}
  // Fewer than 5 in range: all hit; the kit area bonus reaches 6.9.
  const two=makeCtx(11,300);
  const q=addPlayer(two.fake,'p1','vizinha-fofoqueira');
  addEnemy(two.fake,'a',11,10);addEnemy(two.fake,'b',10,16.85);addEnemy(two.fake,'c',10,16.95);
  assert.deepEqual(cast(two.ctx,q)?.hits,['a','b']);
  // A longer slow is kept.
  const keep=makeCtx(11,300);
  const r=addPlayer(keep.fake,'p1','vizinha-fofoqueira');
  const slowed=addEnemy(keep.fake,'s',11,10);slowed.slowUntil=9999;
  assert.ok(cast(keep.ctx,r));assert.equal(slowed.slowUntil,9999);
});
test('vizinha-fofoqueira: no enemy in range returns null without cooldown',()=>{
  const {fake,ctx,events}=makeCtx(12,100);
  const p=addPlayer(fake,'p1','vizinha-fofoqueira');
  addEnemy(fake,'far',17,10);
  assert.equal(cast(ctx,p),null);
  assert.equal(skillReadyTick(p),0);assert.equal(events.length,0);
  assert.equal(fake.enemies.get('far')!.slowUntil,undefined);
});

// ---------- 7b. stats.area / stats.duration scaling ----------
const MEGAFONE=():PlayerBuild=>({weapons:[],passives:[{id:'megafone',level:5}]});
test('scaling: skill radii grow with stats.area (megafone 5 → area 1.5)',()=>{
  const reach=(classId:string,big:boolean,setup:(fake:FakeCtx,p:SimPlayer)=>void)=>{
    const {fake,ctx}=makeCtx(21,100);
    const p=addPlayer(fake,'p1',classId,10,10,{},big?MEGAFONE():NO_BUILD());
    if(big)assert.ok(near(p.stats.area,classId==='vizinha-fofoqueira'?1.65:1.5),`${classId} area ${p.stats.area}`);
    setup(fake,p);
    return {fake,res:cast(ctx,p),p};
  };
  // cidadao-comum: enemies 2.5 → 3.75 and allies 3 → 4.5 around the spot after the step.
  for(const big of [false,true]){
    const {fake,res}=reach('cidadao-comum',big,(f,p)=>{
      const n=stepped(p,p.facing);
      addEnemy(f,'e',n.x,n.y+3.7);addPlayer(f,'a','mendigo',n.x,n.y-4.4);
    });
    assert.ok(res);
    assert.deepEqual(res.hits,big?['e']:[]);
    assert.deepEqual(res.helped,big?['a','p1']:['p1']);
    assert.equal(fake.enemies.get('e')!.hp,big?92:100);
  }
  // mendigo: 3.5 → 5.25.
  for(const big of [false,true]){
    const {fake,res}=reach('mendigo',big,f=>{const a=addPlayer(f,'a','cidadao-comum',10,15.2);a.hp=10;});
    assert.ok(res);assert.equal(fake.players.get('a')!.hp,big?30:10);
  }
  // viciado-em-bet: 7 → 10.5, both for the tapped target and the nearest fallback.
  for(const big of [false,true]){
    const {res}=reach('viciado-em-bet',big,f=>{addEnemy(f,'e',10,20);});
    assert.deepEqual(res?.hits??null,big?['e']:null);
    const tapped=reach('viciado-em-bet',big,(f,p)=>{addEnemy(f,'close',11,10);addEnemy(f,'t',20.4,10);p.target='t';});
    assert.deepEqual(tapped.res?.hits,big?['t']:['close']);
  }
  // clt-cansado: 5 → 7.5.
  for(const big of [false,true]){
    const {fake,res}=reach('clt-cansado',big,f=>{addEnemy(f,'e',17.4,10);});
    assert.ok(res);assert.equal(!!(fake.enemies.get('e') as TauntedEnemy).taunt,big);
  }
  // vizinha-fofoqueira: 6 * 1.15 = 6.9 → 6 * 1.65 = 9.9.
  for(const big of [false,true]){
    const {res}=reach('vizinha-fofoqueira',big,f=>{addEnemy(f,'e',10,19.8);});
    assert.deepEqual(res?.hits??null,big?['e']:null);
  }
});
test('scaling: slow and taunt last longer with stats.duration; invulnerability does not',()=>{
  for(const duration of [1,2,0.5]){
    const withDuration=(classId:string)=>{
      const {fake,ctx}=makeCtx(22,100);
      const p=addPlayer(fake,'p1',classId);p.stats={...p.stats,duration};
      const e=addEnemy(fake,'e',11,10) as TauntedEnemy;
      const res=cast(ctx,p);
      assert.ok(res,classId);
      return {p,e};
    };
    const v=withDuration('vizinha-fofoqueira');
    assert.equal(v.e.slowUntil,100+ticks(3*duration));
    const c=withDuration('clt-cansado');
    assert.equal(c.e.taunt?.untilTick,100+ticks(4*duration));
    assert.equal(c.p.invulnerableUntil,100+ticks(2.5));
    const m=withDuration('mendigo');
    assert.equal(m.p.invulnerableUntil,100+ticks(1));
  }
});

// ---------- 8. Common rules ----------
/** Adds enemies around so every skill has something to act on. */
const populate=(fake:FakeCtx)=>{
  addEnemy(fake,'e1',11,10,500);addEnemy(fake,'e2',10,12,500);addEnemy(fake,'e3',13,13,500);addEnemy(fake,'e4',7,9,500);
};
test('common: cooldown enforced, readyTick = tick + ticks(cooldown * stats.cooldown), cast at readyTick works',()=>{
  for(const kit of KITS){
    for(const build of [NO_BUILD(),{weapons:[],passives:[{id:'cafe-forte',level:5}]}]){
      const {fake,ctx,events}=makeCtx(13,1000);
      populate(fake);
      const p=addPlayer(fake,'p1',kit.classId,10,10,{},build);
      addPlayer(fake,'p2','mendigo',11,11,{hp:50});
      const res=cast(ctx,p);
      assert.ok(res,kit.classId);
      const expected=1000+ticks(kit.skill.cooldown*p.stats.cooldown);
      assert.equal(res.readyTick,expected,`${kit.classId} cd=${p.stats.cooldown}`);
      assert.equal(skillReadyTick(p),expected);
      if(build.passives.length){
        assert.ok(near(p.stats.cooldown,computeStats(NO_BUILD(),kit.classBonus).cooldown-0.4,1e-6),`${kit.classId} cd ${p.stats.cooldown}`);
        assert.ok(expected<1000+ticks(kit.skill.cooldown));
      }
      const n=events.length;
      for(const t of [1000,1001,expected-1]){
        fake.tick=t;
        assert.equal(cast(ctx,p),null,`${kit.classId}@${t}`);
      }
      assert.equal(events.length,n);
      assert.equal(skillReadyTick(p),expected);
      p.x=10;p.y=10;populate(fake);
      fake.tick=expected;
      const again=cast(ctx,p);
      assert.ok(again,`${kit.classId} ready again`);
      assert.equal(again.readyTick,expected+ticks(kit.skill.cooldown*p.stats.cooldown));
    }
  }
});
test('common: resetSkill clears the cooldown (e.g. rematch with ticks restarting)',()=>{
  const {fake,ctx}=makeCtx(16,1000);
  const p=addPlayer(fake,'p1','viciado-em-bet');
  addEnemy(fake,'e1',11,10,1e6);
  const res=cast(ctx,p);
  assert.ok(res);assert.ok(skillReadyTick(p)>1000);
  fake.tick=1001;
  assert.equal(cast(ctx,p),null);
  resetSkill(p);
  assert.equal(skillReadyTick(p),0);assert.ok(!('skillReady' in p));
  assert.ok(cast(ctx,p));
  // New match: ticks restart at 0, an old cooldown would lock the skill for the whole run.
  fake.tick=0;
  assert.equal(cast(ctx,p),null);
  resetSkill(p);
  const fresh=cast(ctx,p);
  assert.ok(fresh);assert.equal(fresh.readyTick,ticks(15));
  resetSkill(addPlayer(fake,'p2','mendigo'));
  assert.equal(skillReadyTick(fake.players.get('p2')!),0);
});
test('common: downed, eliminated, spectator, offline and 0-hp players cannot cast',()=>{
  for(const classId of SKILL_IDS){
    const blocked:Partial<SimPlayer>[]=[
      {downed:{sinceTick:0,bleedOutTick:999,progress:0}},{eliminated:true},{spectator:true},{online:false},{hp:0},
    ];
    for(const extra of blocked){
      const {fake,ctx,events,hits}=makeCtx(14,100);
      populate(fake);
      const p=addPlayer(fake,'p1',classId,10,10,extra);
      addPlayer(fake,'p2','mendigo',11,11,{hp:50});
      const before=clone({players:[...fake.players.values()],enemies:[...fake.enemies.values()],pickups:[...fake.pickups.values()]});
      assert.equal(cast(ctx,p),null,`${classId} ${JSON.stringify(extra)}`);
      assert.deepEqual(clone({players:[...fake.players.values()],enemies:[...fake.enemies.values()],pickups:[...fake.pickups.values()]}),before);
      assert.equal(events.length,0);assert.equal(hits.length,0);
    }
  }
});
test('common: classes without a kit cannot cast',()=>{
  for(const classId of ['nope','','Pedreiro']){
    const {fake,ctx,events}=makeCtx(15,100);
    populate(fake);
    const p=addPlayer(fake,'p1',classId);
    assert.equal(hasSkill(classId),false);
    assert.equal(cast(ctx,p),null);
    assert.equal(events.length,0);assert.equal(skillReadyTick(p),0);
  }
});
test('common: exactly one fire event with weapon skill:<classId>, line from kit.lines, skill name from the kit',()=>{
  for(const kit of KITS){
    const lines=new Set<string>();
    for(let seed=1;seed<=40;seed++){
      const {fake,ctx,events}=makeCtx(seed,100);
      populate(fake);
      const p=addPlayer(fake,'p1',kit.classId,10,10);
      addPlayer(fake,'p2','mendigo',11,11,{hp:50});
      const res=cast(ctx,p);
      assert.ok(res,kit.classId);
      assert.equal(res.player,'p1');assert.equal(res.classId,kit.classId);assert.equal(res.skill,kit.skill.name);
      assert.ok(kit.lines.includes(res.line),res.line);
      lines.add(res.line);
      assert.equal(events.length,1);
      const fire=events[0];
      assert.ok(fire.type==='fire');
      assert.equal(fire.player,'p1');assert.equal(fire.weapon,`skill:${kit.classId}`);
      assert.ok(Number.isFinite(fire.x)&&Number.isFinite(fire.y));
    }
    assert.ok(lines.size>1,`${kit.classId} lines vary across seeds`);
  }
});
test('common: same seed and state give deep-equal results; Math.random is never used',()=>{
  const run=(seed:number)=>{
    const {fake,ctx,events,hits}=makeCtx(seed,240);
    for(let i=0;i<14;i++)addEnemy(fake,`e${i}`,10+Math.cos(i*1.7)*(1+i*0.4),10+Math.sin(i*1.7)*(1+i*0.4),20+i*3);
    KITS.map(k=>k.classId).forEach((classId,i)=>{const p=addPlayer(fake,`p${i}`,classId,10+(i%6)*0.7,10-Math.floor(i/6)*0.3);p.hp=p.stats.maxHp-30-(i%7);});
    const results=[...fake.players.values()].map(p=>cast(ctx,p));
    fake.tick=2000;
    const second=[...fake.players.values()].map(p=>cast(ctx,p));
    return clone({results,second,events,hits,players:[...fake.players.values()],enemies:[...fake.enemies.values()],pickups:[...fake.pickups.values()],rng:fake.rng.state});
  };
  const seen=new Set<string>();
  for(let seed=1;seed<=15;seed++){
    const a=run(seed);
    assert.deepEqual(run(seed),a);
    // Early casts kill most of the 14 weak enemies, so later damage skills may find nothing (null, no cooldown).
    assert.ok(a.results.filter(r=>r!==null).length>=24,`seed ${seed}`);
    seen.add(JSON.stringify(a.results));
  }
  assert.ok(seen.size>1,'different seeds should differ somewhere');
  // Sanity: the Math.random trap really fires.
  const original=Math.random;
  Math.random=()=>{throw new Error('trap');};
  try{assert.throws(()=>Math.random(),/trap/);}finally{Math.random=original;}
});

// ---------- VGM-044B: new effects ----------
const shot=(fake:FakeCtx,id:string,x:number,y:number,hostile:boolean)=>{
  fake.projectiles.set(id,{id,owner:hostile?'e':'p',source:'t',x,y,vx:0,vy:0,radius:.2,damage:5,pierce:0,untilTick:999,hostile,hit:[]});
};
const armed=(fake:FakeCtx,id:string,classId:string,x:number,y:number,ready=900)=>
  addPlayer(fake,id,classId,x,y,{weaponReady:{chinelo:ready}},{weapons:[{id:'chinelo',level:1}],passives:[]});

test('cone (Maromba): heavy hit only in the front arc, pushes survivors away; nothing in front = no cooldown',()=>{
  const {fake,ctx,hits}=makeCtx(1,100);
  const front=addEnemy(fake,'front',11.5,10,500),side=addEnemy(fake,'side',10,11.5,500),behind=addEnemy(fake,'behind',8.6,10,500);
  const p=addPlayer(fake,'p1','maromba',10,10);
  const res=cast(ctx,p)!;
  assert.deepEqual(res.hits,['front']);
  assert.deepEqual(hits.map(h=>[h.id,h.amount]),[['front',40]]);
  assert.ok(front.knock&&front.knock.x>0.8&&near(front.knock.y,0));
  assert.equal(side.hp,500);assert.equal(behind.hp,500);
  const lone=makeCtx(1,100);addEnemy(lone.fake,'behind',8.6,10);
  const q=addPlayer(lone.fake,'p1','maromba',10,10);
  assert.equal(cast(lone.ctx,q),null);assert.equal(skillReadyTick(q),0);
});

test('cone with clearShots (Goleira, Faxineira, Pedreiro): swats hostile shots in the arc only and shields',()=>{
  const {fake,ctx}=makeCtx(2,100);
  shot(fake,'hostile-front',11.5,10.2,true);shot(fake,'hostile-behind',8,10,true);shot(fake,'friendly-front',11,10,false);
  const p=addPlayer(fake,'p1','goleira',10,10);
  const ally=addPlayer(fake,'p2','mendigo',10,12.5),far=addPlayer(fake,'p3','mendigo',10,15);
  const res=cast(ctx,p)!;
  assert.equal(res.blocked,1);
  assert.deepEqual([...fake.projectiles.keys()].sort(),['friendly-front','hostile-behind']);
  assert.ok((ally.invulnerableUntil??0)>100&&(p.invulnerableUntil??0)>100);
  assert.equal(far.invulnerableUntil,undefined);
  assert.deepEqual(res.helped.sort(),['p1','p2']);
  // Pedreiro shields himself even with nothing around, so the cast is never wasted.
  const empty=makeCtx(2,100);const ped=addPlayer(empty.fake,'p1','pedreiro',10,10);
  const built=cast(empty.ctx,ped)!;
  assert.deepEqual(built.helped,['p1']);assert.equal(built.blocked,0);assert.ok((ped.invulnerableUntil??0)>=100+ticks(1.5));
  const swept=makeCtx(2,100);shot(swept.fake,'h',11,11,true);
  const fax=addPlayer(swept.fake,'p1','faxineira',10,10);fax.facing={x:0,y:1};
  assert.equal(cast(swept.ctx,fax)!.blocked,1,'wide arc reaches the diagonal');
});

test('cone with a full circle (Rei do Arraiá) pushes enemies on every side',()=>{
  const {fake,ctx}=makeCtx(3,100);
  const e=[addEnemy(fake,'a',11.5,10),addEnemy(fake,'b',8.5,10),addEnemy(fake,'c',10,11.5),addEnemy(fake,'d',10,8.5)];
  const res=cast(ctx,addPlayer(fake,'p1','rei-arraia',10,10))!;
  assert.equal(res.hits.length,4);
  for(const enemy of e){const away={x:enemy.x-10,y:enemy.y-10};assert.ok(enemy.knock!.x*away.x+enemy.knock!.y*away.y>0,enemy.id);}
});

test('burst on a target (Concurseira): cancels only that enemy\'s telegraphs, freezes it and hits nobody else',()=>{
  const {fake,ctx,hits}=makeCtx(4,100);
  const boss=addEnemy(fake,'boss',12,10,4000),other=addEnemy(fake,'other',12.05,10.05,30);
  fake.telegraphs.set('t1',{id:'t1',owner:'boss',shape:'circle',x:0,y:0,radius:1,fireTick:120,damage:20});
  fake.telegraphs.set('t2',{id:'t2',owner:'other',shape:'circle',x:0,y:0,radius:1,fireTick:120,damage:20});
  const p=addPlayer(fake,'p1','concurseira',10,10,{target:'boss'});
  const res=cast(ctx,p)!;
  assert.deepEqual(res.hits,['boss']);
  assert.deepEqual(hits.map(h=>h.id),['boss']);
  assert.deepEqual([...fake.telegraphs.keys()],['t2']);
  assert.ok((boss.frozenUntil??0)>=100+ticks(1.5));assert.equal(other.frozenUntil,undefined);
  const idle=makeCtx(4,100);
  assert.equal(cast(idle.ctx,addPlayer(idle.fake,'p1','concurseira',10,10)),null,'no enemy, no cast');
});

test('burst variants: Aposentado pushes and freezes one, Gambiarreiro traps the 4 nearest, Rei do Pastel slows around the target',()=>{
  const a=makeCtx(5,100);const old=addEnemy(a.fake,'e1',12,10);
  cast(a.ctx,addPlayer(a.fake,'p1','aposentado',10,10));
  assert.ok(old.knock!.x>0&&(old.frozenUntil??0)>100);
  const g=makeCtx(5,100);
  const ring=[1,1.5,2,2.5,3,3.5].map((r,i)=>addEnemy(g.fake,`r${i}`,10+r,10));
  const trap=cast(g.ctx,addPlayer(g.fake,'p1','gambiarreiro',10,10))!;
  assert.deepEqual(trap.hits,['r0','r1','r2','r3']);
  assert.deepEqual(ring.map(e=>(e.frozenUntil??0)>100),[true,true,true,true,false,false]);
  const r=makeCtx(5,100);
  const t=addEnemy(r.fake,'t',15,10),n=addEnemy(r.fake,'n',16,10.5),far=addEnemy(r.fake,'far',19,10);
  const oil=cast(r.ctx,addPlayer(r.fake,'p1','rei-pastel',10,10,{target:'t'}))!;
  assert.deepEqual(oil.hits.sort(),['n','t']);
  assert.ok((t.slowUntil??0)>100&&(n.slowUntil??0)>100);assert.equal(far.slowUntil,undefined);
});

test('rally (Tia da Festa): heals standing allies and helps downed ones without finishing the rescue itself',()=>{
  const {fake,ctx}=makeCtx(6,100);
  const p=addPlayer(fake,'p1','tia-festa',10,10);p.hp-=40;
  const down=addPlayer(fake,'p2','mendigo',11,10,{hp:0,downed:{sinceTick:50,bleedOutTick:650,progress:0.8}});
  const res=cast(ctx,p)!;
  assert.equal(p.hp,p.stats.maxHp-28);
  assert.ok(near(down.downed!.progress,0.95),'capped below 1');
  assert.equal(down.downed!.bleedOutTick,650+ticks(5));
  assert.deepEqual(res.helped,['p1','p2']);
});

test('rally (Pagodeiro, Caça-Promoção, Feirante): refunds the others\' skills and readies everyone\'s weapons',()=>{
  const {fake,ctx}=makeCtx(7,100);
  const p=armed(fake,'p1','pagodeiro',10,10);(p as SkillPlayer).skillReady=0;
  const friend=armed(fake,'p2','mendigo',11,10);(friend as SkillPlayer).skillReady=300;
  const soon=armed(fake,'p3','mendigo',10,11);(soon as SkillPlayer).skillReady=130;
  cast(ctx,p);
  assert.equal(skillReadyTick(friend),300-ticks(3));
  assert.equal(skillReadyTick(soon),100,'never earlier than now');
  assert.equal(skillReadyTick(p),100+ticks(18*p.stats.cooldown),'the caster pays the full cooldown');
  const c=makeCtx(7,100);
  const promo=armed(c.fake,'p1','caca-promocao',10,10),mate=armed(c.fake,'p2','mendigo',12,10),out=armed(c.fake,'p3','mendigo',20,10);
  cast(c.ctx,promo);
  assert.equal(promo.weaponReady.chinelo,100);assert.equal(mate.weaponReady.chinelo,100);assert.equal(out.weaponReady.chinelo,900);
  const f=makeCtx(7,100);const fe=armed(f.fake,'p1','feirante',10,10,50);
  cast(f.ctx,fe);assert.equal(fe.weaponReady.chinelo,50,'an already ready weapon is not delayed');
});

test('rally mostHurt (Merendeira): feeds only the most hurt ally; nobody hurt = no cooldown',()=>{
  const {fake,ctx}=makeCtx(8,100);
  const p=addPlayer(fake,'p1','merendeira',10,10);
  const a=addPlayer(fake,'p2','mendigo',11,10,{hp:60}),b=addPlayer(fake,'p3','mendigo',10,11,{hp:30});
  const res=cast(ctx,p)!;
  assert.deepEqual(res.helped,['p3']);assert.equal(b.hp,65);assert.equal(a.hp,60);assert.ok((b.invulnerableUntil??0)>100);
  const full=makeCtx(8,100);addPlayer(full.fake,'p2','mendigo',11,10);
  const m=addPlayer(full.fake,'p1','merendeira',10,10);
  assert.equal(cast(full.ctx,m),null);assert.equal(skillReadyTick(m),0);
});

test('volley: Sensei combos one target and stuns it; Streamer starts on the tapped enemy and readies weapons',()=>{
  const s=makeCtx(9,100);
  const tough=addEnemy(s.fake,'tough',11,10,100),near2=addEnemy(s.fake,'near',10.5,10,100);
  const sen=cast(s.ctx,addPlayer(s.fake,'p1','sensei',10,10))!;
  assert.deepEqual(sen.hits,['near','near','near']);
  assert.equal(near2.hp,64);assert.ok((near2.frozenUntil??0)>100);assert.equal(tough.hp,100);
  const weak=makeCtx(9,100);const w=addEnemy(weak.fake,'w',10.5,10,20);
  assert.deepEqual(cast(weak.ctx,addPlayer(weak.fake,'p1','sensei',10,10))!.hits,['w','w'],'stops when the target dies');
  assert.equal(w.frozenUntil,undefined);
  const st=makeCtx(9,100);
  for(let i=0;i<6;i++)addEnemy(st.fake,`e${i}`,10.5+i*0.5,10,100);
  const streamer=armed(st.fake,'p1','streamer',10,10);streamer.target='e5';
  const res=cast(st.ctx,streamer)!;
  assert.deepEqual(res.hits,['e5','e0','e1','e2']);
  assert.equal(streamer.weaponReady.chinelo,100);
});

test('rescue (Salva-Vidas): pulls the most hurt ally closer over walkable ground, heals and shields; alone = no cooldown',()=>{
  const {fake,ctx}=makeCtx(10,100);
  const p=addPlayer(fake,'p1','salva-vidas',10,10);
  const hurt=addPlayer(fake,'p2','mendigo',16,10,{hp:20}),fine=addPlayer(fake,'p3','mendigo',12,10);
  const before=dist(hurt,p);
  const res=cast(ctx,p)!;
  assert.deepEqual(res.helped,['p2']);
  assert.ok(near(before-dist(hurt,p),3,0.11),`pulled ${before-dist(hurt,p)}`);
  assert.ok(walkable(hurt));assert.equal(hurt.hp,30);assert.ok((hurt.invulnerableUntil??0)>100);
  assert.equal(fine.x,12);
  // Never through obstacles: the rock at (11,12) stops the pull short.
  const rock=makeCtx(10,100);const guard=addPlayer(rock.fake,'p1','salva-vidas',11,10);
  const behind=addPlayer(rock.fake,'p2','mendigo',11,14.5,{hp:20});
  cast(rock.ctx,guard);
  assert.ok(walkable(behind)&&behind.y>12.5&&behind.y<14.5,`stopped at ${behind.y}`);
  const alone=makeCtx(10,100);const lone=addPlayer(alone.fake,'p1','salva-vidas',10,10);
  assert.equal(cast(alone.ctx,lone),null);assert.equal(skillReadyTick(lone),0);
  const close=makeCtx(10,100);const lifeguard=addPlayer(close.fake,'p1','salva-vidas',10,10);
  const next=addPlayer(close.fake,'p2','mendigo',10.5,10,{hp:20});
  cast(close.ctx,lifeguard);assert.equal(next.x,10.5,'already close: not pulled on top');
});

test('fetch (Mãe de Pet): coxinha next to the most hurt ally during a wave only',()=>{
  const {fake,ctx}=makeCtx(11,100);
  const p=addPlayer(fake,'p1','mae-pet',10,10);
  const hurt=addPlayer(fake,'p2','mendigo',14,10,{hp:20});
  const res=cast(ctx,p)!;
  const coxinha=fake.pickups.get(res.pickup!)!;
  assert.equal(coxinha.kind,'heal');assert.equal(coxinha.value,30);
  assert.ok(dist(coxinha,hurt)<=0.5+1e-9);assert.equal(coxinha.expiresTick,100+ticks(FOUND_PICKUP_SECONDS));
  const prep=makeCtx(11,100);prep.fake.round.phase='prepare';
  addPlayer(prep.fake,'p2','mendigo',14,10,{hp:20});
  const pet=addPlayer(prep.fake,'p1','mae-pet',10,10);
  assert.equal(cast(prep.ctx,pet),null,'no farming between rounds');assert.equal(prep.fake.pickups.size,0);
  const healthy=makeCtx(11,100);const pet2=addPlayer(healthy.fake,'p1','mae-pet',10,10);
  assert.equal(cast(healthy.ctx,pet2),null);
});

test('reused effects with new numbers: Passageira dashes ~3 and only shields herself; Porteiro taunts and slows',()=>{
  const {fake,ctx}=makeCtx(12,100);
  const p=addPlayer(fake,'p1','passageira',10,10);
  const ally=addPlayer(fake,'p2','mendigo',10.2,10.2);
  const res=cast(ctx,p)!;
  assert.ok(res.movedTo&&res.movedTo.x-10>2.5,`moved ${res.movedTo?.x}`);
  assert.deepEqual(res.helped,['p1']);assert.equal(ally.invulnerableUntil,undefined);
  const g=makeCtx(12,100);const e=addEnemy(g.fake,'e',12,10);
  cast(g.ctx,addPlayer(g.fake,'p1','porteiro',10,10));
  assert.equal((e as TauntedEnemy).taunt?.player,'p1');assert.ok((e.slowUntil??0)>100);
});

test('no real-betting vocabulary anywhere in the 36 kits',()=>{
  const banned=/\b(aposta\w*|apostar|bet|cassino|odds?|tigrinho|roleta|jackpot|loteria|bingo)\b/i;
  for(const kit of KITS){
    for(const text of [kit.skill.effect,...kit.lines])assert.ok(!banned.test(text),`${kit.classId}: ${text}`);
  }
});

// ---------- VGM-044B review regressions ----------
test('refunds cannot chain: refunders never refund each other and nobody drops below half the paid cooldown',()=>{
  const {fake,ctx}=makeCtx(21,0);
  const team=['caca-promocao','caca-promocao','pagodeiro','pagodeiro','coach','coach'].map((c,i)=>
    addPlayer(fake,`p${i}`,c,10+(i%3)*0.4,10+Math.floor(i/3)*0.4,{},{weapons:[],passives:[{id:'cafe-forte',level:5}]}));
  const casts=new Map<string,number>();let shielded=0;const span=ticks(60);
  for(fake.tick=0;fake.tick<span;fake.tick++){
    for(const p of team){p.hp=Math.max(1,p.hp-1);if(cast(ctx,p))casts.set(p.id,(casts.get(p.id)??0)+1);}
    if(team.every(p=>(p.invulnerableUntil??-1)>fake.tick))shielded++;
  }
  for(const p of team){
    const paid=ticks(kitFor(p.classId)!.skill.cooldown*p.stats.cooldown);
    const max=Math.ceil(span/Math.ceil(paid*REFUND_FLOOR_SHARE))+1;
    assert.ok((casts.get(p.id)??0)<=max,`${p.id} ${p.classId} cast ${casts.get(p.id)} > ${max}`);
  }
  for(const p of team.filter(p=>REFUNDERS.has(p.classId))){
    const paid=ticks(kitFor(p.classId)!.skill.cooldown*p.stats.cooldown);
    assert.ok((casts.get(p.id)??0)<=Math.ceil(span/paid)+1,`${p.classId} is never refunded`);
  }
  assert.ok(shielded<span*0.5,`team invulnerable ${shielded}/${span} ticks`);
  // resetSkill also clears the floor.
  resetSkill(team[4]);assert.equal((team[4] as SkillPlayer).skillFloor,undefined);
});

test('Concurseira annuls only the soonest attack, once per enemy every 6 s, so several players cannot lock the boss',()=>{
  const {fake,ctx}=makeCtx(22,100);
  addEnemy(fake,'boss',12,10,4000);
  for(const [id,fire] of [['late',140],['soon',118],['mid',125]] as const)
    fake.telegraphs.set(id,{id,owner:'boss',shape:'circle',x:0,y:0,radius:1,fireTick:fire,damage:20});
  const a=addPlayer(fake,'p1','concurseira',10,10,{target:'boss'}),b=addPlayer(fake,'p2','concurseira',10,10.2,{target:'boss'});
  cast(ctx,a);
  assert.deepEqual([...fake.telegraphs.keys()].sort(),['late','mid']);
  assert.ok(cast(ctx,b),'second cast still lands its hit');
  assert.deepEqual([...fake.telegraphs.keys()].sort(),['late','mid'],'immune for 6 s');
  fake.tick=100+ticks(ANNUL_IMMUNITY_SECONDS);resetSkill(a);
  cast(ctx,a);
  assert.deepEqual([...fake.telegraphs.keys()],['late']);
});

test('freeze traps skip the boss first; Salva-Vidas needs a hurt ally and leaves rescuers in place',()=>{
  const g=makeCtx(23,100);
  addEnemy(g.fake,'boss',10.5,10,4000);(g.fake.enemies.get('boss')!).boss=true;
  for(let i=0;i<4;i++)addEnemy(g.fake,`m${i}`,11+i*0.5,10);
  assert.deepEqual(cast(g.ctx,addPlayer(g.fake,'p1','gambiarreiro',10,10))!.hits,['m0','m1','m2','m3']);
  const s=makeCtx(23,100);
  const guard=addPlayer(s.fake,'p1','salva-vidas',10,10);
  addPlayer(s.fake,'p2','mendigo',15,10);
  assert.equal(cast(s.ctx,guard),null,'nobody hurt: no pull, no cooldown');assert.equal(skillReadyTick(guard),0);
  const r=makeCtx(23,100);
  const lifeguard=addPlayer(r.fake,'p1','salva-vidas',10,10);
  const rescuer=addPlayer(r.fake,'p2','mendigo',15,10,{hp:20});
  addPlayer(r.fake,'p3','mendigo',15.8,10,{hp:0,downed:{sinceTick:50,bleedOutTick:650,progress:0.6}});
  const res=cast(r.ctx,lifeguard)!;
  assert.deepEqual(res.pulled,{player:'p2',x:15,y:10},'healed in place');
  assert.equal(rescuer.hp,30);assert.equal(res.movedTo,undefined,'movedTo is only for the caster');
});

test('Tia da Festa: bleed bonus capped at twice the normal bleed-out and never for offline downed players',()=>{
  const {fake,ctx}=makeCtx(24,100);
  const tia=addPlayer(fake,'p1','tia-festa',10,10);
  const down=addPlayer(fake,'p2','mendigo',11,10,{hp:0,downed:{sinceTick:100,bleedOutTick:100+BLEED_OUT_TICKS,progress:0}});
  const away=addPlayer(fake,'p3','mendigo',10,11,{hp:0,online:false,downed:{sinceTick:100,bleedOutTick:100+BLEED_OUT_TICKS,progress:0.2}});
  for(let i=0;i<20;i++){resetSkill(tia);cast(ctx,tia);fake.tick++;}
  assert.equal(down.downed!.bleedOutTick,100+2*BLEED_OUT_TICKS);
  assert.equal(away.downed!.bleedOutTick,100+BLEED_OUT_TICKS);assert.equal(away.downed!.progress,0.2);
});

test('a refunded skill never comes back before half of the cooldown its owner paid',()=>{
  const {fake,ctx}=makeCtx(25,100);
  const coach=addPlayer(fake,'p1','coach',10,10),promo=addPlayer(fake,'p2','caca-promocao',10.5,10);
  assert.ok(cast(ctx,coach));
  const paid=ticks(kitFor('coach')!.skill.cooldown*coach.stats.cooldown);
  for(let i=0;i<10;i++){resetSkill(promo);cast(ctx,promo);}
  assert.equal(skillReadyTick(coach),100+Math.ceil(paid*REFUND_FLOOR_SHARE));
});
