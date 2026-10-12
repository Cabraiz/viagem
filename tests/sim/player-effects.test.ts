/**
 * D-036 (NEW-20261012-ORQ-elenco-fase-b): telegraph kinds set where each hazard is born, and the player effects of
 * the burp ('arroto' → slow) and the poop ('coco' → slip): applied on hit (even at 0 damage), refreshed not stacked,
 * dodged by i-frames, cleared on fall, revive and rematch; the room's movement with them; what the views carry.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {BASE_STATS,PLAYER_SLIP_SPEED,PLAYER_SLOW_MULT,TELEGRAPH_KINDS,type SimPlayer,type Telegraph,type TelegraphKind} from '../../src/contract/index.ts';
import {SimWorld} from '../../src/sim/core.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';
import {EnemyAi} from '../../src/sim/enemies/ai.ts';
import {createProjectileSystem} from '../../src/sim/projectiles.ts';
import {addTelegraph,createTelegraphSystem,MIN_TELEGRAPH_TICKS} from '../../src/sim/telegraphs.ts';
import {createBoss,PHASE_ASSEMBLY} from '../../src/sim/boss.ts';
import {createReviveSystem,downPlayer,REVIVE_TICKS} from '../../src/sim/revive.ts';
import {SLIP_GRID,SLIP_TICKS,SLOW_TICKS,activeMoveEffects,applyTelegraphEffect,clearMoveEffects} from '../../src/sim/player-effects.ts';
import {MAX_PROJECTILES} from '../../src/rules/budget.ts';
import {Simulation,telegraphView} from '../../multiplayer/simulation.ts';
import {VEL_SCALE} from '../../src/protocol/index.ts';
import {SPEED,walkable,type Point} from '../../src/maps/world.ts';
import {STEP} from '../../src/maps/prediction.ts';
import {DEFAULT_SEED,TerrainField,defaultTerrain} from '../../src/maps/terrain/field.ts';

const ENDLESS=new TerrainField(DEFAULT_SEED,{world:'infinito'});
function openSpot(r:number):Point{
  const clear=(c:Point)=>{
    for(let dx=-r;dx<=r;dx+=.5)for(let dy=-r;dy<=r;dy+=.5)if(dx*dx+dy*dy<=r*r&&!walkable({x:c.x+dx,y:c.y+dy},ENDLESS))return false;
    return true;
  };
  for(let x=-60;x<=60;x+=2)for(let y=-60;y<=60;y+=2)if(clear({x,y}))return {x,y};
  throw new Error(`no open disc of radius ${r}`);
}
const O=openSpot(9);
const at=(dx:number,dy=0):Point=>({x:O.x+dx,y:O.y+dy});
function addPlayer(world:SimWorld,id:string,p:Point,extra:Partial<SimPlayer>={}){
  const player:SimPlayer={id,classId:'test',x:p.x,y:p.y,hp:100,online:true,spectator:false,facing:{x:1,y:0},
    build:{weapons:[],passives:[]},stats:{...BASE_STATS},weaponReady:{},...extra};
  world.players.set(id,player);
  return player;
}
/** enemy-ai + projectiles + telegraphs on open ground; every telegraph born is recorded with its kind. */
function arena(seed:number,round=3){
  const world=new SimWorld({terrain:ENDLESS,seed});
  world.round.index=round;world.round.phase='wave';
  const ai=new EnemyAi({projectileCap:MAX_PROJECTILES});
  world.register(ai).register(createProjectileSystem({cap:MAX_PROJECTILES})).register(createTelegraphSystem());
  world.onKill((enemy,_by,ctx)=>ai.onKill(ctx,enemy));
  const made:Telegraph[]=[];
  const record=(events:readonly {type:string}[])=>{for(const e of events)if(e.type==='telegraph'){const t=world.telegraphs.get((e as {telegraph:string}).telegraph);if(t)made.push({...t});}};
  const step=(n:number,each?:()=>void)=>{for(let i=0;i<n;i++){record(world.step());each?.();}};
  return {world,made,step,flush:()=>record(world.flush())};
}
const heal=(world:SimWorld)=>()=>{for(const p of world.players.values()){p.hp=p.stats.maxHp;clearMoveEffects(p);}};

// ---------- Kinds at the source ----------
test('enemy hazards carry their kind: burp arroto, poop coco, molotov landing molotov, its pulses fogo, the belt explosao',()=>{
  const burp=arena(1);addPlayer(burp.world,'p',at(2));const b=createEnemy(burp.world,'bebado',O);
  burp.step(600,()=>{b.x=O.x;b.y=O.y;heal(burp.world)();});
  const burps=burp.made.filter(t=>t.owner===b.id);
  assert.ok(burps.length>0);assert.ok(burps.every(t=>t.kind==='arroto'));

  const poop=arena(9);addPlayer(poop.world,'p',at(1));const bird=createEnemy(poop.world,'pombos',O);
  poop.step(600,heal(poop.world));
  const poops=poop.made.filter(t=>t.owner===`env:poop:${bird.id}`);
  assert.ok(poops.length>0);assert.ok(poops.every(t=>t.kind==='coco'));

  const fire=arena(4);addPlayer(fire.world,'p',at(5));const anao=createEnemy(fire.world,'anao-molotov',O);
  for(let i=0;i<400&&!fire.made.some(t=>t.owner===`env:molotov:${anao.id}`);i++)fire.step(1,heal(fire.world));
  anao.memory!.actReady=1e9;
  fire.step(200,heal(fire.world));
  const chain=fire.made.filter(t=>t.owner===`env:molotov:${anao.id}`);
  assert.ok(chain.length>1);
  assert.equal(chain[0].kind,'molotov');assert.ok(chain.slice(1).every(t=>t.kind==='fogo'),'the pulses are fire');
  fire.world.damageEnemy(anao.id,1e9,'p');fire.flush();
  const blast=fire.made.find(t=>t.owner===`env:explosion:${anao.id}`);
  assert.equal(blast?.kind,'explosao');
});

test('boss attacks carry their kind: slam and stomp pancada, charge investida, sweep varredura, fines carimbo',()=>{
  const world=new SimWorld({terrain:defaultTerrain,seed:7});
  world.round.index=10;world.round.phase='wave';world.round.phaseEndsTick=1e9;
  // Spread around the island like sim-boss.test.ts's squad, so the charge has room.
  for(const [i,[x,y]] of [[12,6.5],[17.5,12],[12,17.5],[6.5,12]].entries())addPlayer(world,`p${i}`,{x,y});
  const boss=createBoss();world.register(boss).register(createTelegraphSystem());
  const made:Telegraph[]=[];
  const step=(n:number)=>{for(let i=0;i<n;i++){for(const e of world.step())if(e.type==='telegraph'){const t=world.telegraphs.get(e.telegraph);if(t)made.push({...t});}heal(world)();}};
  const e=boss.spawnBoss(world)!;
  step(20*60);
  const phase1=made.filter(t=>t.owner===e.id);
  e.hp=Math.floor(e.maxHp*.5);
  step(20*60);
  const phase2=made.filter(t=>t.owner===e.id).slice(phase1.length);
  assert.ok(e.phase!>=PHASE_ASSEMBLY,'phase 2 (or the enraged 3, same attacks)');
  const kinds=(list:Telegraph[])=>new Set(list.map(t=>`${t.shape}:${t.kind}`));
  for(const k of kinds(phase1))assert.ok(['circle:pancada','line:investida'].includes(k),`phase 1 ${k}`);
  assert.ok(kinds(phase1).has('circle:pancada')&&kinds(phase1).has('line:investida'));
  for(const k of kinds(phase2))assert.ok(['circle:pancada','circle:carimbo','line:investida','cone:varredura'].includes(k),`phase 2 ${k}`);
  assert.ok(kinds(phase2).has('cone:varredura')&&kinds(phase2).has('circle:carimbo'));
  // The fine: carimbo circles on players, one pancada at the boss's own feet, all firing together.
  const fines=phase2.filter(t=>t.kind==='carimbo');
  for(const f of fines)assert.ok(phase2.some(t=>t.kind==='pancada'&&t.fireTick===f.fireTick),'the stomp at his feet goes with the fines');
});

// ---------- Effects on hit ----------
function range(){
  const world=new SimWorld({terrain:ENDLESS,seed:3});
  world.round.index=3;world.round.phase='wave';
  world.register(createTelegraphSystem());
  const fire=(kind:TelegraphKind|undefined,where:Point,damage=0,radius=2)=>{
    const t=addTelegraph(world,{shape:'circle',x:where.x,y:where.y,radius,damage,owner:'env:test',...(kind?{kind}:{})},0);
    while(world.tick<t.fireTick)world.step();
    return t.fireTick;
  };
  return {world,fire};
}

test('arroto slows for PLAYER_SLOW_SECONDS from the hit, also at 0 damage; a second burp refreshes, never stacks',()=>{
  const {world,fire}=range();const p=addPlayer(world,'p',O);
  const t1=fire('arroto',O,0);
  assert.equal(p.slowUntil,t1+SLOW_TICKS,'0-damage burp still slows');assert.equal(SLOW_TICKS,30);
  for(let i=0;i<10;i++)world.step();
  const t2=fire('arroto',O,0);
  assert.equal(p.slowUntil,t2+SLOW_TICKS,'refreshed from the second hit, not added to the first');
  assert.equal(p.hp,100);
  // Armor eats the whole hit: the slow still lands.
  const tank=addPlayer(world,'tank',at(4),{stats:{...BASE_STATS,armor:99}});
  const t3=fire('arroto',tank,6);
  assert.equal(tank.hp,100);assert.equal(tank.slowUntil,t3+SLOW_TICKS);
  // Generic, fire and boss telegraphs move nobody.
  const plain=addPlayer(world,'plain',at(-4));
  for(const k of [undefined,'molotov','fogo','explosao','pancada','investida','varredura','carimbo'] as const)fire(k,plain,0);
  assert.equal(plain.slowUntil,undefined);assert.equal(plain.slipUntil,undefined);
});

test('coco: slide along the facing (on the wire grid) for PLAYER_SLIP_SECONDS; away from the poop when facing is unusable',()=>{
  const {world,fire}=range();
  const p=addPlayer(world,'p',O,{facing:{x:.6,y:.8}});
  const t=fire('coco',at(.5),3);
  assert.equal(p.slipUntil,t+SLIP_TICKS);assert.equal(SLIP_TICKS,10);
  assert.deepEqual(p.slip,{x:Math.round(.6*SLIP_GRID)/SLIP_GRID,y:Math.round(.8*SLIP_GRID)/SLIP_GRID});
  assert.equal(SLIP_GRID,VEL_SCALE,'the wire carries the slide vector exactly');
  const q=addPlayer(world,'q',at(5),{facing:{x:0,y:0}});
  fire('coco',at(4,0),0);
  assert.ok(q.slip!.x>.99&&Math.abs(q.slip!.y)<.01,'away from the poop center');
  // Degenerate: no facing and standing on the center: nothing.
  const r=addPlayer(world,'r',at(-5),{facing:{x:0,y:0}});
  assert.equal(applyTelegraphEffect(r,{kind:'coco',x:r.x,y:r.y},world.tick),false);assert.equal(r.slipUntil,undefined);
});

test('no effect on the invulnerable, the downed, spectators; a hit that downs the player leaves nothing behind',()=>{
  const {world,fire}=range();
  const inv=addPlayer(world,'inv',O,{invulnerableUntil:1e9});
  const watcher=addPlayer(world,'w',O,{spectator:true});
  fire('arroto',O,5);fire('coco',O,5);
  for(const p of [inv,watcher]){assert.equal(p.slowUntil,undefined);assert.equal(p.slipUntil,undefined);}
  const low=addPlayer(world,'low',at(3),{hp:4});
  world.onPlayerZero((p,by,ctx)=>{downPlayer(ctx,p,by);});
  fire('coco',low,10);
  assert.ok(low.downed,'downed by the poop');
  assert.equal(low.slipUntil,undefined);assert.equal(low.slip,undefined);
  assert.equal(applyTelegraphEffect(low,{kind:'arroto',x:0,y:0},world.tick),false,'downed: no slow');
});

test('falling, getting up and a rematch clear slow and slip',()=>{
  const world=new SimWorld({terrain:ENDLESS,seed:5});
  world.round.index=3;world.round.phase='wave';
  world.register(createReviveSystem());
  const down=addPlayer(world,'down',O),helper=addPlayer(world,'helper',at(.5));
  down.slowUntil=world.tick+100;down.slipUntil=world.tick+100;down.slip={x:1,y:0};
  downPlayer(world,down);
  assert.deepEqual([down.slowUntil,down.slipUntil,down.slip],[undefined,undefined,undefined],'cleared on the fall');
  // Even if something set one while down, getting up starts clean.
  down.slowUntil=world.tick+1000;
  for(let i=0;i<REVIVE_TICKS+2&&down.downed;i++)world.step();
  assert.ok(!down.downed&&down.hp>0,'revived');assert.equal(down.slowUntil,undefined);
  void helper;

  const sim=new Simulation(7);sim.add('a','Ana','pedreiro');sim.resetRun();
  for(let i=0;i<200;i++)sim.step();
  const p=sim.players.get('a')!;
  p.slowUntil=sim.tick+30;p.slipUntil=sim.tick+10;p.slip={x:0,y:1};
  sim.resetRun();
  assert.deepEqual([p.slowUntil,p.slipUntil,p.slip],[undefined,undefined,undefined],'the rematch restarts the clock at 0: no stale tick');
});

// ---------- Movement in the room ----------
test('the room walks a slowed player at × PLAYER_SLOW_MULT and slides a slipping one whatever the stick; standing, no slide',()=>{
  const sim=new Simulation(11);sim.add('a','Ana','cidadao-comum');sim.resetRun();
  const p=sim.players.get('a')!;
  const clean=()=>{for(const e of [...sim.world.enemies.values()])sim.world.enemies.delete(e.id);p.hp=p.stats.maxHp;};
  let seq=0;
  const walk=(x:number,y:number)=>{clean();sim.input('a',{seq:++seq,x,y,attack:false});const from={x:p.x,y:p.y};sim.step();return {from,to:{x:p.x,y:p.y}};};
  walk(1,0);
  p.slowUntil=sim.tick+5;
  const slow=walk(1,0);
  assert.ok(Math.abs(Math.hypot(slow.to.x-slow.from.x,slow.to.y-slow.from.y)-SPEED*PLAYER_SLOW_MULT*STEP)<1e-9,'slowed step');
  for(let i=0;i<5;i++)walk(1,0);
  const after=walk(1,0);
  assert.ok(Math.abs(Math.hypot(after.to.x-after.from.x,after.to.y-after.from.y)-SPEED*STEP)<1e-9,'plain once it ends');
  p.slipUntil=sim.tick+4;p.slip={x:0,y:-1};p.facing={x:0,y:-1};
  const slide=walk(1,0);
  assert.ok(Math.abs(slide.to.x-slide.from.x)<1e-9&&Math.abs(slide.from.y-slide.to.y-PLAYER_SLIP_SPEED*STEP)<1e-9,'slides, stick ignored');
  assert.deepEqual(p.facing,{x:0,y:-1},'facing kept while sliding');
  // The stick let go (a stop segment): no step, so no slide, like walking.
  clean();sim.input('a',{seq:++seq,x:0,y:0,attack:false});const still={x:p.x,y:p.y};sim.step();
  assert.ok(sim.tick<p.slipUntil,'still inside the slip');
  assert.deepEqual({x:p.x,y:p.y},still);
});

// ---------- Views ----------
test('views carry the telegraph kind and only the active effects; confirmed goes live while an effect touches the replay',()=>{
  const sim=new Simulation(11);sim.add('a','Ana','cidadao-comum');sim.resetRun();
  const p=sim.players.get('a')!;
  const t=addTelegraph(sim.world,{shape:'circle',x:p.x,y:p.y,radius:1,damage:0,owner:'env:test',kind:'coco'},MIN_TELEGRAPH_TICKS);
  const plain=addTelegraph(sim.world,{shape:'circle',x:p.x+3,y:p.y,radius:1,damage:0,owner:'env:test'},MIN_TELEGRAPH_TICKS);
  assert.equal(sim.view('a').telegraphs.find(v=>v.id===t.id)?.kind,'coco');
  assert.equal(sim.frame().telegraphs.find(v=>v.id===t.id)?.kind,'coco');
  assert.ok(!('kind' in sim.frame().telegraphs.find(v=>v.id===plain.id)!),'no kind, no field');
  assert.deepEqual(telegraphView(t),{id:t.id,shape:'circle',x:t.x,y:t.y,radius:1,dx:undefined,dy:undefined,width:undefined,fireTick:t.fireTick,kind:'coco'});
  for(const k of TELEGRAPH_KINDS)assert.equal(telegraphView({...t,kind:k}).kind,k);

  const self=()=>sim.frame().players.find(x=>x.id==='a')!;
  assert.equal(self().slowUntil,undefined);
  p.slowUntil=sim.tick+3;p.slipUntil=sim.tick+2;p.slip={x:1,y:0};
  assert.deepEqual([self().slowUntil,self().slipUntil,self().slip],[p.slowUntil,p.slipUntil,{x:1,y:0}]);
  assert.equal(sim.view('a').players[0].slowUntil,p.slowUntil);
  for(let i=0;i<3;i++)sim.step();
  assert.deepEqual([self().slowUntil,self().slipUntil,self().slip],[undefined,undefined,undefined],'expired: nothing on the wire');
  assert.deepEqual([p.slowUntil,p.slipUntil,p.slip],[undefined,undefined,undefined],'the players system drops what is over');
  p.slowUntil=50;p.slipUntil=40;p.slip={x:1,y:0};
  assert.deepEqual(activeMoveEffects(p,0),{slowUntil:50,slipUntil:40,slip:{x:1,y:0}});
  assert.deepEqual(activeMoveEffects(p,45),{slowUntil:50});
  clearMoveEffects(p);

  // Confirmed: the room walks past the client's last report (input-10hz); with an effect over those steps it goes live.
  sim.input('a',{seq:1,steps:[[1,1,0,0]]},sim.tick*50);
  for(let i=0;i<12;i++)sim.step((sim.tick+1)*50+10*50);
  const own=sim.confirmed('a');
  assert.ok(own,'confirmed position while guessing past the report');
  p.slowUntil=sim.tick+5;
  assert.equal(sim.confirmed('a'),undefined,'slow over the guessed steps: live frame');
  const liveAck=p.ack;
  clearMoveEffects(p);
  // Review B1: the live frame carried ack=liveAck; going back to the older confirmed ack would snap the phone back.
  assert.equal(sim.confirmed('a'),undefined,'stays live while the report is behind the live ack');
  sim.step((sim.tick+1)*50+10*50);
  assert.equal(sim.confirmed('a'),undefined);
  // The client reports past it (a keepalive); once the room guesses past that report again, confirmed comes back.
  const report=liveAck+5;
  sim.input('a',{seq:report,steps:[]},sim.tick*50);
  for(let i=0;i<20&&!sim.confirmed('a');i++)sim.step((sim.tick+1)*50+10*50);
  const back=sim.confirmed('a');
  assert.ok(back&&back.ack>=liveAck,`confirmed again at ack ${back?.ack} ≥ ${liveAck}`);
  void own;
});
