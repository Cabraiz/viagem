import test from 'node:test';
import assert from 'node:assert/strict';
import {SimWorld,NaiveIndex,stateHash} from '../src/game/sim/core.ts';
import type {SimWorldOptions,StampedEvent} from '../src/game/sim/core.ts';
import {Rng} from '../src/game/sim/rng.ts';
import {SYSTEM_ORDER,BASE_STATS} from '../src/game/sim/types.ts';
import type {EnemyState,SimContext,SimPlayer,SimSystem} from '../src/game/sim/types.ts';
import {defaultTerrain} from '../src/game/terrain/field.ts';

const mkWorld=(opts:Partial<SimWorldOptions>={})=>new SimWorld({terrain:defaultTerrain,seed:1,...opts});
const mkPlayer=(id:string,over:Partial<SimPlayer>={}):SimPlayer=>({id,x:0,y:0,classId:'test',hp:100,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...over});
const mkEnemy=(id:string,over:Partial<EnemyState>={}):EnemyState=>({id,kind:'crab',x:0,y:0,hp:10,maxHp:10,speed:1,damage:1,radius:.4,xp:1,spawnTick:0,readyTick:0,...over});
const sys=(id:string,step:(ctx:SimContext)=>void):SimSystem=>({id,step});
const addEnemy=(w:SimWorld,e:EnemyState)=>{w.enemies.set(e.id,e);return e;};
const ofType=<K extends StampedEvent['type']>(events:StampedEvent[],type:K)=>events.filter((e):e is Extract<StampedEvent,{type:K}>=>e.type===type);

test('nextId is deterministic per prefix, reproducible across worlds and restarted by reset',()=>{
  const seq=(w:SimWorld)=>[w.nextId('e'),w.nextId('e'),w.nextId('p'),w.nextId('e'),w.nextId('p')];
  const a=mkWorld(),b=mkWorld();
  assert.deepEqual(seq(a),['e-1','e-2','p-1','e-3','p-2']);
  assert.deepEqual(seq(b),['e-1','e-2','p-1','e-3','p-2']);
  a.reset(1);assert.equal(a.nextId('e'),'e-1');assert.equal(a.nextId('p'),'p-1');
});

test('register validates ids and systems run in order regardless of registration order',()=>{
  const w=mkWorld(),calls:string[]=[];
  assert.throws(()=>w.register(sys('nope',()=>{})),/Unknown system id/);
  for(const id of [...SYSTEM_ORDER].reverse())w.register(sys(id,()=>calls.push(id)));
  assert.throws(()=>w.register(sys('weapons',()=>{})),/already registered/);
  assert.deepEqual(w.registered(),[...SYSTEM_ORDER]);
  w.step();assert.deepEqual(calls,[...SYSTEM_ORDER]);
  const partial=mkWorld(),pc:string[]=[];
  for(const id of ['pickups','director','weapons'])partial.register(sys(id,()=>pc.push(id)));
  assert.deepEqual(partial.registered(),['director','weapons','pickups']);
  partial.step();assert.deepEqual(pc,['director','weapons','pickups']);
  const custom=mkWorld({order:['legacy','director']}),cc:string[]=[];
  custom.register(sys('director',()=>cc.push('director'))).register(sys('legacy',()=>cc.push('legacy')));
  assert.throws(()=>custom.register(sys('weapons',()=>{})),/Unknown system id/);
  assert.deepEqual(custom.registered(),['legacy','director']);
  custom.step();assert.deepEqual(cc,['legacy','director']);
  assert.throws(()=>mkWorld({order:['a','a']}),/Duplicate/);
});

test('events are batched per step with monotonic ids and never leak between ticks',()=>{
  const w=mkWorld();let emitNow=true;
  w.register(sys('director',ctx=>{if(emitNow){ctx.emit({type:'levelup',level:1});ctx.emit({type:'levelup',level:2});}}));
  const first=w.step();
  assert.deepEqual(first.map(e=>e.type),['levelup','levelup']);
  assert.equal(w.lastEvents,first);
  assert.ok(first[1].eventId>first[0].eventId);
  emitNow=false;
  assert.deepEqual(w.step(),[]);assert.deepEqual(w.lastEvents,[]);
  w.emit({type:'wave',index:3,label:'between'});
  assert.deepEqual(w.lastEvents,[]);
  emitNow=true;
  const third=w.step();
  assert.deepEqual(third.map(e=>e.type),['wave','levelup','levelup']);
  const ids=[...first,...third].map(e=>e.eventId);
  assert.ok(ids.every((id,i)=>i===0||id>ids[i-1]));
  emitNow=false;assert.deepEqual(w.step(),[]);
});

test('damageEnemy clamps, kills once, removes the enemy and fires kill hooks exactly once',()=>{
  const w=mkWorld();
  w.players.set('p1',mkPlayer('p1'));w.players.set('p2',mkPlayer('p2'));
  const e=addEnemy(w,mkEnemy('e-1',{hp:10}));
  const kills:string[]=[];w.onKill((enemy,by)=>kills.push(`${enemy.id}:${by}`));
  assert.equal(w.damageEnemy('e-1',4,'p1','sword'),false);
  assert.equal(e.hp,6);
  let ev=w.flush();assert.deepEqual(ev.map(({eventId:_,...rest})=>rest),[{type:'damage',target:'e-1',amount:4,source:'p1',weapon:'sword'}]);
  const results:boolean[]=[];
  w.register(sys('weapons',ctx=>{results.push(ctx.damageEnemy('e-1',100,'p1'));}));
  w.register(sys('projectiles',ctx=>{results.push(ctx.damageEnemy('e-1',100,'p2'));}));
  ev=w.step();
  assert.deepEqual(results,[true,false]);
  assert.equal(e.hp,0);assert.equal(w.enemies.has('e-1'),false);
  assert.deepEqual(ofType(ev,'damage').map(d=>d.amount),[6]);
  assert.deepEqual(ofType(ev,'kill').map(k=>[k.enemy,k.by,k.kind]),[['e-1','p1','crab']]);
  assert.deepEqual(kills,['e-1:p1']);
  assert.deepEqual(w.step(),[]);assert.deepEqual(results,[true,false,false,false]);
});

test('damageEnemy ignores unknown ids and non-positive or non-finite amounts, applies might, and onKill can unsubscribe',()=>{
  const w=mkWorld();
  const e=addEnemy(w,mkEnemy('e-1',{hp:10}));
  assert.equal(w.damageEnemy('ghost',5),false);
  for(const amount of [NaN,Infinity,-Infinity,0,-5])assert.equal(w.damageEnemy('e-1',amount),false);
  assert.equal(e.hp,10);assert.deepEqual(w.flush(),[]);
  w.players.set('strong',mkPlayer('strong',{stats:{...BASE_STATS,might:2.5}}));
  w.damageEnemy('e-1',2,'strong');
  assert.equal(e.hp,5);assert.equal(ofType(w.flush(),'damage')[0].amount,5);
  w.damageEnemy('e-1',1,'nobody');assert.equal(e.hp,4);w.flush();
  let calls=0;const off=w.onKill(()=>{calls++;});off();
  assert.equal(w.damageEnemy('e-1',99),true);
  assert.equal(calls,0);assert.equal(ofType(w.flush(),'kill').length,1);
});

test('damagePlayer applies armor, invulnerability and skips spectators, downed, eliminated and dead players',()=>{
  const w=mkWorld();
  const p=mkPlayer('p1',{hp:50,stats:{...BASE_STATS,armor:3}});w.players.set('p1',p);
  const zero:string[]=[];w.onPlayerZero((pl,src)=>zero.push(`${pl.id}:${src}`));
  w.damagePlayer('p1',10,'e-1');
  assert.equal(p.hp,43);
  assert.deepEqual(w.flush().map(({eventId:_,...rest})=>rest),[{type:'damage',target:'p1',amount:7,source:'e-1'}]);
  w.damagePlayer('p1',2);assert.equal(p.hp,43);assert.deepEqual(w.flush(),[]);
  for(const amount of [NaN,-4,0,Infinity])w.damagePlayer('p1',amount);
  w.damagePlayer('ghost',10);
  assert.equal(p.hp,43);assert.deepEqual(w.flush(),[]);
  w.tick=5;p.invulnerableUntil=6;w.damagePlayer('p1',10);assert.equal(p.hp,43);
  w.tick=6;w.damagePlayer('p1',10);assert.equal(p.hp,36);w.flush();
  const others=[
    mkPlayer('spec',{spectator:true}),mkPlayer('down',{downed:{sinceTick:0,bleedOutTick:100,progress:0}}),
    mkPlayer('elim',{eliminated:true}),mkPlayer('dead',{hp:0}),
  ];
  for(const o of others){w.players.set(o.id,o);w.damagePlayer(o.id,10);}
  assert.deepEqual(others.map(o=>o.hp),[100,100,100,0]);assert.deepEqual(w.flush(),[]);
  w.damagePlayer('p1',1000,'boss');
  assert.equal(p.hp,0);assert.equal(ofType(w.flush(),'damage')[0].amount,36);
  w.damagePlayer('p1',10,'boss');w.damagePlayer('p1',10,'boss');
  assert.deepEqual(zero,['p1:boss']);assert.deepEqual(w.flush(),[]);
});

test('randomized damage: hp loss per target equals damage events every tick and enemies die at most once',()=>{
  for(const seed of [1,7,1234,0xdeadbeef]){
    const w=mkWorld({seed}),known=new Map<string,{hp:number}>(),spawnHp=new Map<string,number>(),kills=new Map<string,number>();
    let hookKills=0;w.onKill(()=>{hookKills++;});
    for(let i=0;i<3;i++){const p=mkPlayer(`p${i}`,{hp:150,stats:{...BASE_STATS,armor:i,might:1+i*.5}});w.players.set(p.id,p);known.set(p.id,p);}
    const ids=()=>[...known.keys()];
    const amount=(r:Rng)=>r.chance(.1)?r.pick([NaN,-3,0,Infinity]):r.range(.1,25);
    w.register(sys('director',ctx=>{
      if(ctx.rng.chance(.5)){const e=mkEnemy(ctx.nextId('e'),{hp:ctx.rng.range(5,40)});ctx.enemies.set(e.id,e);known.set(e.id,e);spawnHp.set(e.id,e.hp);}
    }));
    const hitter=(ctx:SimContext)=>{
      for(let n=ctx.rng.int(0,6);n>0;n--){
        const target=ctx.rng.pick(ids());
        if(target.startsWith('e-'))ctx.damageEnemy(target,amount(ctx.rng),ctx.rng.chance(.7)?ctx.rng.pick(['p0','p1','p2']):undefined);
        else ctx.damagePlayer(target,amount(ctx.rng),'e-x');
      }
    };
    w.register(sys('weapons',hitter)).register(sys('projectiles',hitter));
    for(let t=0;t<200;t++){
      const before=new Map([...known].map(([id,o])=>[id,o.hp]));
      const events=w.step();
      const dealt=new Map<string,number>();
      for(const d of ofType(events,'damage')){assert.ok(d.amount>0);dealt.set(d.target,(dealt.get(d.target)??0)+d.amount);}
      for(const [id,o] of known){
        const loss=(before.get(id)??spawnHp.get(id)!)-o.hp;
        assert.ok(Math.abs(loss-(dealt.get(id)??0))<1e-6,`seed ${seed} tick ${w.tick} ${id}: lost ${loss} vs events ${dealt.get(id)??0}`);
        assert.ok(o.hp>=0);
      }
      for(const k of ofType(events,'kill')){
        kills.set(k.enemy,(kills.get(k.enemy)??0)+1);
        assert.equal(w.enemies.has(k.enemy),false);assert.equal(known.get(k.enemy)!.hp,0);
      }
    }
    assert.ok(kills.size>0);
    assert.ok([...kills.values()].every(n=>n===1));
    assert.equal(hookKills,kills.size);
    for(const [id,o] of known)if(id.startsWith('e-'))assert.equal(w.enemies.has(id),o.hp>0);
  }
});

test('enemyIndex is rebuilt after spawning/moving systems; readers filter deaths (D-004)',()=>{
  const w=mkWorld(),seen:Record<string,unknown>={};
  w.register(sys('director',ctx=>{const e=mkEnemy(ctx.nextId('e'),{x:1,y:1});ctx.enemies.set(e.id,e);}));
  w.register(sys('enemy-ai',ctx=>{
    seen.ai=ctx.enemyIndex.query(1,1,.1).map(e=>e.id);
    for(const e of ctx.enemies.values()){e.x=10;e.y=10;}
  }));
  w.register(sys('weapons',ctx=>{
    seen.oldSpot=ctx.enemyIndex.query(1,1,.5).length;
    const hit=ctx.enemyIndex.nearest(10,10,1);seen.nearest=hit?.id;
    if(hit)ctx.damageEnemy(hit.id,1000);
  }));
  w.register(sys('projectiles',ctx=>{seen.afterKill=ctx.enemyIndex.nearest(10,10,5,e=>ctx.enemies.has(e.id))?.id??null;}));
  w.step();
  assert.deepEqual(seen,{ai:['e-1'],oldSpot:0,nearest:'e-1',afterKill:null});
});

test('NaiveIndex query and nearest honor inclusive radius, reuse out arrays and apply filters',()=>{
  const idx=new NaiveIndex<EnemyState>();
  const a=mkEnemy('a',{x:0,y:0}),b=mkEnemy('b',{x:3,y:4}),c=mkEnemy('c',{x:-3,y:4}),d=mkEnemy('d',{x:1,y:0});
  idx.rebuild([a,b,c,d]);
  assert.deepEqual(idx.query(0,0,5).map(e=>e.id),['a','b','c','d']);
  assert.deepEqual(idx.query(0,0,4.99).map(e=>e.id),['a','d']);
  const out=[b,b,b];assert.equal(idx.query(0,0,0,out),out);assert.deepEqual(out.map(e=>e.id),['a']);
  assert.deepEqual(idx.query(100,100,1),[]);
  assert.equal(idx.nearest(0,0,10)?.id,'a');
  assert.equal(idx.nearest(0,0,10,e=>e.id!=='a')?.id,'d');
  assert.equal(idx.nearest(0,4,3,e=>e.id==='b'||e.id==='c')?.id,'b');
  assert.equal(idx.nearest(0,0,5,e=>e.id==='c')?.id,'c');
  assert.equal(idx.nearest(0,0,4.99,e=>e.id==='c'),undefined);
  assert.equal(idx.nearest(50,50,1),undefined);
  // Equal distance: smallest id wins regardless of insertion order (D-004).
  idx.rebuild([mkEnemy('z',{x:1,y:0}),mkEnemy('m',{x:-1,y:0})]);assert.equal(idx.nearest(0,0,5)?.id,'m');
  idx.rebuild([]);assert.deepEqual(idx.query(0,0,100),[]);assert.equal(idx.nearest(0,0,100),undefined);
});

test('stateHash is key-order independent and world.state() hashes match for identical scripted runs',()=>{
  assert.match(stateHash({a:1}),/^[0-9a-f]{8}$/);
  assert.equal(stateHash({a:1,b:{c:2,d:[1,{e:3,f:4}]}}),stateHash({b:{d:[1,{f:4,e:3}],c:2},a:1}));
  assert.notEqual(stateHash({a:1,b:{c:2}}),stateHash({a:1,b:{c:3}}));
  assert.notEqual(stateHash([1,2]),stateHash([2,1]));
  const scripted=(seed:number)=>{
    const w=mkWorld({seed});w.players.set('p1',mkPlayer('p1'));
    w.register(sys('director',ctx=>{if(ctx.rng.chance(.4)){const e=mkEnemy(ctx.nextId('e'),{x:ctx.rng.range(2,22),y:ctx.rng.range(2,22),hp:ctx.rng.range(3,12)});ctx.enemies.set(e.id,e);}}));
    w.register(sys('weapons',ctx=>{const e=ctx.enemyIndex.nearest(12,12,30);if(e)ctx.damageEnemy(e.id,ctx.rng.range(1,6),'p1');ctx.damagePlayer('p1',ctx.rng.range(0,.5),'e-x');}));
    return w;
  };
  const a=scripted(99),b=scripted(99);
  for(let i=0;i<60;i++){a.step();b.step();}
  assert.equal(stateHash(a.state()),stateHash(b.state()));
  assert.deepEqual(a.lastEvents,b.lastEvents);
  assert.notEqual(stateHash(scripted(100).state()),stateHash(scripted(99).state()));
  a.rng.next();
  assert.notEqual(stateHash(a.state()),stateHash(b.state()));
  // The rng is re-derived from (seed, tick) each step, so a stray draw between ticks does not shift the future.
  for(let i=0;i<30;i++){a.step();b.step();}
  assert.equal(stateHash(a.state()),stateHash(b.state()));
});

test('ctx.rng is re-derived per tick: forks inside a step differ each tick and replay after reset',()=>{
  const rolls=(w:SimWorld)=>{const out:number[]=[];w.register(sys('director',ctx=>{out.push(ctx.rng.fork('director').next());}));for(let i=0;i<5;i++)w.step();return out;};
  const a=rolls(mkWorld());
  assert.equal(new Set(a).size,5);
  assert.deepEqual(rolls(mkWorld()),a);
  const w=mkWorld(),seen:number[]=[];w.register(sys('director',ctx=>{seen.push(ctx.rng.next());}));
  for(let i=0;i<3;i++)w.step();
  w.reset(1);seen.length=0;for(let i=0;i<5;i++)w.step();
  const fresh=mkWorld(),again:number[]=[];fresh.register(sys('director',ctx=>{again.push(ctx.rng.next());}));for(let i=0;i<5;i++)fresh.step();
  assert.deepEqual(seen,again);assert.equal(stateHash(w.state()),stateHash({...fresh.state(),eventSeq:w.state().eventSeq}));
  assert.notEqual(stateHash(mkWorld({seed:2}).state()),stateHash(mkWorld().state()));
});

test('kills caused inside onKill handlers are dispatched after the current kill reaches every handler',()=>{
  const w=mkWorld(),calls:string[]=[];
  addEnemy(w,mkEnemy('a'));addEnemy(w,mkEnemy('b'));
  w.onKill((e,_by,ctx)=>{calls.push('h1:'+e.id);if(e.id==='a')ctx.damageEnemy('b',100);});
  w.onKill(e=>{calls.push('h2:'+e.id);});
  w.register(sys('weapons',ctx=>{ctx.damageEnemy('a',100);}));
  w.step();
  assert.deepEqual(calls,['h1:a','h2:a','h1:b','h2:b']);
  assert.deepEqual(ofType(w.lastEvents,'kill').map(e=>e.enemy),['a','b']);
});

test('enemy stored under a key is removed by that key on kill',()=>{
  const w=mkWorld();w.enemies.set('key',mkEnemy('other'));
  assert.equal(w.damageEnemy('key',100),true);assert.equal(w.enemies.size,0);
});
