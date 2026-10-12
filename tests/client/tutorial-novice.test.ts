// VGM-056 playtest under node: the real simulation (round 1 of a fresh run) and the first-run coach of the novice's phone.
// "Novato" stands still for 15 s whatever the screen says, then does what the hint on screen says: walks, walks over the
// XP drops, taps the "+N" chip (and picks after a beat, the window open), walks to a caído. Teammates walk in circles
// and take the default offers. The HUD's slot rules are played too: the street banner (MARQUEE_MS after a round or zueira
// event), the kill-cam (KILLCAM_MS) and the open offer window hold the hint back, and only "andar" takes the banner's place.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORLD,Simulation} from '../../multiplayer/simulation.ts';
import {ticks} from '../../src/contract/types.ts';
import {downPlayer} from '../../src/sim/revive.ts';
import {Coach,LESSONS,XP_NEAR,resetSessionMemory,type CoachShow,type Lesson} from '../../src/client/hud/coach.ts';
import {MARQUEE_MS} from '../../src/client/hud/zones.ts';
import {KILLCAM_MS} from '../../src/client/fun/zueira.ts';
import {ROUNDS,TUTORIAL_CRUMBS} from '../../src/rules/waves.ts';

const MS_PER_TICK=1000/20;
const STAND_MS=15000;
/** A person needs a moment to read and react (to the chip, the window). */
const REACT_MS=800,PICK_MS=1500;

/** A novice of BUG-round1-letal on the rooms' world: stops 8 s at every new offer (the crumbs' early level included). */
function pauseAtOffers(seed:number,team:readonly string[]){
  const sim=new Simulation(seed,{world:DEFAULT_WORLD});
  const ids=team.map((_,i)=>`b${i}`);ids.forEach((id,i)=>sim.add(id,id,team[i]));sim.resetRun();
  const seq=new Map(ids.map(id=>[id,0])),paused=new Map(ids.map(id=>[id,0])),seen=new Set<string>();
  let minHp=1;const downs:string[]=[];
  for(let t=0;t<ticks(3+45+20)&&!(sim.world.round.index===2);t++){
    ids.forEach((id,i)=>{if(paused.get(id)!>0){paused.set(id,paused.get(id)!-1);return;}
      const a=2*Math.PI*(sim.tick/160+i/ids.length),next=seq.get(id)!+1;if(sim.input(id,{seq:next,x:Math.cos(a),y:Math.sin(a),attack:false}))seq.set(id,next);});
    for(const e of sim.step())if(e.type==='downed')downs.push(e.player);
    for(const id of ids){
      const p=sim.players.get(id)!;if(sim.world.round.phase==='wave')minHp=Math.min(minHp,p.hp/p.stats.maxHp);
      const head=sim.offers(id)[0];if(!head)continue;
      if(!seen.has(`${id}:${head.id}`)){seen.add(`${id}:${head.id}`);paused.set(id,ticks(8));continue;}
      if(paused.get(id)!>0)continue;
      sim.choose(id,head.id,head.defaultIndex);
    }
  }
  return {minHp,downs};
}

const memory=()=>{const store=new Map<string,string>();return {store,getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};};

interface Playtest {
  /** ms from the run's first tick to the first hint, to each lesson learned, to the first step. */
  firstHintMs?:number;firstStepMs?:number;learned:Map<Lesson,number>;
  /** Lessons shown at least once, and every frame the hint was not what it should be while the novice stood. */
  shown:Set<Lesson>;walkGaps:number;
  downs:string[];minHp:number;round1EndMs?:number;
  /** Two hints at once never happen by construction; this counts hints over a held slot (must stay 0). */
  overHeld:number;
}

/**
 * Plays round 1 (and the next intermission when `untilRound` is 2) with `team` (novice first) on `seed`.
 * `downAlly`: after the chip lesson a teammate falls 2 units from the novice, to teach the rescue (6 players only).
 */
function playtest(seed:number,team:readonly string[],coach:Coach,{downAlly=false,untilRound=1}={}):Playtest{
  // The rooms' world (endless, D-019): spawns on the off-screen ring, as players meet them.
  const sim=new Simulation(seed,{world:DEFAULT_WORLD});
  const ids=team.map((_,i)=>`bot${i}`);
  ids.forEach((id,i)=>sim.add(id,i?`Bot ${i}`:'Novato',team[i]));
  sim.resetRun();
  const me=ids[0];
  const seq=new Map(ids.map(id=>[id,0]));
  const r:Playtest={learned:new Map(),shown:new Set(),walkGaps:0,downs:[],minHp:1,overHeld:0};
  let bannerUntil=-1,killcamUntil=-1,panel:{openedAt:number}|undefined,chipSeenAt:number|undefined,waveAt:number|undefined;
  let center:{x:number;y:number}|undefined,downed=false,show:CoachShow|undefined;
  const send=(id:string,x:number,y:number)=>{const next=seq.get(id)!+1;if(sim.input(id,{seq:next,x,y,attack:false}))seq.set(id,next);};
  const toward=(id:string,to:{x:number;y:number})=>{const p=sim.players.get(id)!,dx=to.x-p.x,dy=to.y-p.y,d=Math.hypot(dx,dy);if(d>.15)send(id,dx/d,dy/d);else send(id,0,0);};
  for(let t=0;t<ticks(3+50+25+60);t++){
    const now=sim.tick*MS_PER_TICK;
    // Teammates: the circle of sim-run.test.ts, and the default pick.
    ids.slice(1).forEach((id,i)=>{const a=2*Math.PI*(sim.tick/160+i/ids.length);send(id,Math.cos(a),Math.sin(a));});
    // The novice: stands 15 s (counted from the wave, like the sim-run novice), then follows the hint on screen.
    const hero=sim.players.get(me)!;
    const standing=waveAt===undefined||now-waveAt<STAND_MS;
    if(!standing&&!hero.downed){
      center??={x:hero.x,y:hero.y};
      if(r.firstStepMs===undefined)r.firstStepMs=now;
      const view=sim.view(me);
      const xp=view.pickups.filter(p=>p.kind==='xp'&&Math.hypot(p.x-hero.x,p.y-hero.y)<=XP_NEAR).sort((a,b)=>Math.hypot(a.x-hero.x,a.y-hero.y)-Math.hypot(b.x-hero.x,b.y-hero.y))[0];
      const ally=view.players.find(p=>p.id!==me&&p.downed&&!p.eliminated);
      const allyAt=ally&&sim.players.get(ally.id);
      if(show?.lesson==='rescue'&&allyAt)toward(me,allyAt);
      else if(xp&&(show?.lesson==='xp'||r.learned.has('xp')))toward(me,xp);
      else{const a=Math.atan2(hero.y-center.y,hero.x-center.x),d=Math.hypot(hero.x-center.x,hero.y-center.y);
        const x=-Math.sin(a)+(4-d)*.3*Math.cos(a),y=Math.cos(a)+(4-d)*.3*Math.sin(a),n=Math.hypot(x,y)||1;send(me,x/n,y/n);}
    }
    const events=sim.step();
    for(const e of events){
      if(e.type==='round'&&(e.phase==='wave'||e.phase==='prepare')||e.type==='happening')bannerUntil=now+MARQUEE_MS;
      if(e.type==='round'&&e.phase==='wave'&&e.index===1)waveAt??=now;
      if(e.type==='round'&&e.phase==='end'&&e.index===1)r.round1EndMs??=now;
      if(e.type==='last-bicho')killcamUntil=now+KILLCAM_MS;
      if(e.type==='downed'||e.type==='eliminated')r.downs.push(`${e.player}@R${sim.world.round.index}`);
    }
    for(const id of ids){const p=sim.players.get(id)!;if(sim.world.round.index===1&&sim.world.round.phase==='wave')r.minHp=Math.min(r.minHp,p.hp/p.stats.maxHp);}
    // The phone: the head offer in combat is the chip; a tap opens the window (held slot), the pick closes it.
    const view=sim.view(me),wave=view.round?.phase==='wave';
    if(panel&&now-panel.openedAt>=PICK_MS){const head=sim.offers(me)[0];if(head)sim.choose(me,head.id,head.defaultIndex);panel=undefined;}
    // Teammates pick at once; the novice's round offers (intermission) too: the coach is about combat here.
    for(const id of ids.slice(1)){const head=sim.offers(id)[0];if(head)sim.choose(id,head.id,head.defaultIndex);}
    if(!wave&&!panel){const head=sim.offers(me)[0];if(head)sim.choose(me,head.id,head.defaultIndex);}
    const chip=wave&&!panel&&view.offers.length>0;
    const banner=now<bannerUntil,blocked=now<killcamUntil||!!panel;
    show=coach.step({view,localId:me,hero:{x:hero.x,y:hero.y},chip,blocked,banner},now);
    if(show){
      r.firstHintMs??=now;r.shown.add(show.lesson);
      if(blocked||banner&&!LESSONS[show.lesson].overBanner)r.overHeld++;
    }
    if(standing&&!blocked&&waveAt!==undefined&&show?.lesson!=='walk')r.walkGaps++;
    for(const lesson of coach.done)if(!r.learned.has(lesson))r.learned.set(lesson,now);
    if(show?.lesson==='chip'&&!show.done){
      chipSeenAt??=now;
      if(now-chipSeenAt>=REACT_MS){coach.did('chip');panel={openedAt:now};}
    }
    // The rescue moment: once the chip is learned, a teammate falls 2 units away (what the room's lab does in the prints).
    if(downAlly&&!downed&&r.learned.has('chip')&&wave){
      const ally=sim.players.get(ids[1])!;ally.x=hero.x+2;ally.y=hero.y;downPlayer(sim.world,ally);downed=true;
    }
    if(sim.world.round.index>untilRound)break;
  }
  return r;
}

const SEEDS=[0x056,0x0de1,0x7a2b,0x51d1];
const SOLO=['cidadao-comum','roqueira','universitario','mendigo'];
const SIX=['universitario','roqueira','mendigo','viciado-em-bet','pedreiro','cidadao-comum'];

test('novato (stands 15 s, then follows the hints) survives round 1 and learns to walk, pick XP and tap the chip within 12 s of moving (solo, 4 classes x 4 seeds)',t=>{
  const rows:string[]=[];
  for(const cls of SOLO)for(const seed of SEEDS){
    resetSessionMemory();
    const coach=new Coach(memory());
    const r=playtest(seed,[cls],coach);
    const at=`${cls} seed ${seed}`,s=(ms?:number)=>ms===undefined?'-':(ms/1000).toFixed(1);
    rows.push(`${at}: 1ª dica ${s(r.firstHintMs)} s, passo ${s(r.firstStepMs)}, andar ${s(r.learned.get('walk'))}, xp ${s(r.learned.get('xp'))}, chip ${s(r.learned.get('chip'))}, fim R1 ${s(r.round1EndMs)}, vida mín ${(r.minHp*100).toFixed(0)}%`);
    assert.deepEqual(r.downs,[],`${at}: nobody falls in round 1`);
    assert.ok(r.minHp>=.25,`${at}: hp left (${(r.minHp*100).toFixed(0)}%)`);
    assert.ok(r.firstHintMs!==undefined&&r.firstHintMs<=1000,`${at}: "andar" shows in the first second of the run (${r.firstHintMs} ms)`);
    assert.equal(r.walkGaps,0,`${at}: "andar" stays on screen the whole 15 s the novice stands (no time cap)`);
    assert.equal(r.overHeld,0,`${at}: no hint over the kill-cam, an open window or (but "andar") the banner`);
    const step=r.firstStepMs!;
    assert.ok(r.learned.get('walk')!-step<=1500,`${at}: "andar" goes within 1.5 s of the first step`);
    assert.ok(r.learned.has('xp')&&r.learned.get('xp')!<=r.round1EndMs!,`${at}: XP learned in round 1`);
    assert.ok(r.learned.has('chip')&&r.learned.get('chip')!<=r.round1EndMs!,`${at}: the chip comes and is learned in round 1`);
    assert.ok(r.learned.get('chip')!-step<=12000,`${at}: walk, XP and chip within 12 s of moving (${s(r.learned.get('chip')!-step)} s)`);
  }
  for(const row of rows)t.diagnostic(row);
});

test('six players: the novice still sees one hint at a time, learns in round 1, and the rescue lesson comes and goes when a teammate falls',t=>{
  for(const seed of SEEDS.slice(0,2)){
    resetSessionMemory();
    const coach=new Coach(memory());
    const r=playtest(seed,SIX,coach,{downAlly:true});
    const s=(ms?:number)=>ms===undefined?'-':(ms/1000).toFixed(1);
    t.diagnostic(`seed ${seed}: passo ${s(r.firstStepMs)}, andar ${s(r.learned.get('walk'))}, xp ${s(r.learned.get('xp'))}, chip ${s(r.learned.get('chip'))}, resgate ${s(r.learned.get('rescue'))}, fim R1 ${s(r.round1EndMs)}, quedas ${r.downs.join(' ')}`);
    assert.deepEqual(r.downs,['bot1@R1'],'only the staged fall');
    assert.equal(r.walkGaps,0);assert.equal(r.overHeld,0);
    for(const lesson of ['walk','xp','chip','rescue'] as const)assert.ok(r.learned.has(lesson),`seed ${seed}: ${lesson} learned`);
  }
});

test('the crumbs do not make round 1 letal: novices who stop 8 s at every offer still walk out (rooms\' world, 1 and 6 bots)',t=>{
  let worst=1;
  for(const team of [['streamer'],['mendigo'],['viciado-em-bet','universitario','roqueira','streamer','gamer-mobile','coach'],SIX])for(const seed of SEEDS){
    const r=pauseAtOffers(seed,team);worst=Math.min(worst,r.minHp);
    assert.deepEqual(r.downs,[],`${team.join('+')} seed ${seed}: nobody falls`);
    assert.ok(r.minHp>=.25,`${team.join('+')} seed ${seed}: hp left (${(r.minHp*100).toFixed(0)}%)`);
  }
  t.diagnostic(`lowest hp ${(worst*100).toFixed(0)}%`);
});

test('first run of the phone only: the second run with the same storage shows nothing that was already shown',()=>{
  resetSessionMemory();
  const store=memory();
  const first=playtest(SEEDS[0],['cidadao-comum'],new Coach(store),{untilRound:2});
  for(const lesson of ['walk','xp','chip'] as const)assert.ok(first.learned.has(lesson),`first run: ${lesson} learned`);
  const coach=new Coach(store);coach.endRun();
  resetSessionMemory();
  const second=playtest(SEEDS[1],['cidadao-comum'],new Coach(store));
  assert.deepEqual([...second.shown].filter(l=>l!=='rescue'&&l!=='gather'),[],'nothing but lessons whose moment never came');
});

/** Round 1's crumbs right after the wave starts (the director lays them on the 'wave' round event). */
function crumbsAt(seed:number,players:number){
  const sim=new Simulation(seed,{world:DEFAULT_WORLD});
  for(let i=0;i<players;i++)sim.add(`p${i}`,`P${i}`,SIX[i]);
  sim.resetRun();
  while(sim.world.round.phase!=='wave')sim.step();
  return {sim,crumbs:[...sim.world.pickups.values()].filter(p=>p.id.startsWith('migalha-'))};
}

test('round 1 lays the XP crumbs: one more than the first level, on walkable ground, on screen, out of every magnet',()=>{
  for(const seed of SEEDS)for(const players of [1,2,3,6]){
    const {sim,crumbs}=crumbsAt(seed,players);
    const at=`seed ${seed}, ${players}p`;
    assert.equal(crumbs.length,TUTORIAL_CRUMBS.count,`${at}: every crumb found ground`);
    assert.ok(crumbs.every(c=>c.kind==='xp'));
    assert.ok(crumbs.reduce((n,p)=>n+p.value,0)>sim.world.team.nextXp,'enough for the first level');
    const hero=sim.players.get('p0')!;
    const team=[...sim.players.values()],mid={x:team.reduce((s,p)=>s+p.x,0)/team.length,y:team.reduce((s,p)=>s+p.y,0)/team.length};
    for(const c of crumbs){
      const d=Math.hypot(c.x-mid.x,c.y-mid.y);
      assert.ok(d>=TUTORIAL_CRUMBS.radius[0]-.01&&d<=TUTORIAL_CRUMBS.radius[1]+3,`${at}: crumb ${d.toFixed(1)} u from the team`);
      assert.ok(Math.hypot(c.x-hero.x,c.y-hero.y)<=XP_NEAR,`${at}: close enough to call the XP hint`);
      for(const p of team)assert.ok(Math.hypot(c.x-p.x,c.y-p.y)>p.stats.magnet,`${at}: out of ${p.id}'s magnet`);
    }
    // A team standing still never gets them (no magnet reaches, mendigo's bonus included): the lesson needs a step.
    for(let t=0;t<ticks(10);t++)sim.step();
    assert.equal([...sim.world.pickups.keys()].filter(id=>id.startsWith('migalha-')).length,TUTORIAL_CRUMBS.count,`${at}: standing 10 s, none picked`);
    assert.equal(sim.world.team.xp,0,`${at}: standing still, no XP`);
  }
});

test('the crumbs are deterministic and move nothing else: same seed, same crumbs; the bichos and their ids are the same without them',()=>{
  const key=(c:{id:string;x:number;y:number;value:number})=>`${c.id}@${c.x.toFixed(4)},${c.y.toFixed(4)}=${c.value}`;
  for(const seed of SEEDS)for(const players of [1,6])assert.deepEqual(crumbsAt(seed,players).crumbs.map(key),crumbsAt(seed,players).crumbs.map(key),`seed ${seed}, ${players}p`);
  /** The first 30 s of round 1 with a team standing still: every bicho as it shows up (id, kind, spot). */
  const spawns=(seed:number,players:number)=>{
    const sim=new Simulation(seed,{world:DEFAULT_WORLD});
    for(let i=0;i<players;i++)sim.add(`p${i}`,`P${i}`,SIX[i]);
    sim.resetRun();
    const seen=new Map<string,string>();
    for(let t=0;t<ticks(3+30);t++){sim.step();for(const e of sim.world.enemies.values())if(!seen.has(e.id))seen.set(e.id,`${e.kind}@${e.x.toFixed(3)},${e.y.toFixed(3)}`);}
    return [...seen];
  };
  const round1=ROUNDS[0] as {crumbs?:typeof TUTORIAL_CRUMBS};
  for(const seed of SEEDS)for(const players of [1,6]){
    const withCrumbs=spawns(seed,players);
    round1.crumbs=undefined;
    try{assert.deepEqual(spawns(seed,players),withCrumbs,`seed ${seed}, ${players}p: same bichos, same ids, same spots`);}
    finally{round1.crumbs=TUTORIAL_CRUMBS;}
    assert.ok(withCrumbs.length>0,'bichos came');
  }
});

test('the crumbs only exist in the endless world, only in round 1',()=>{
  // The island (lab world) has no crumbs: its bichos come from the coast in a few seconds, the level comes from them.
  const island=new Simulation(SEEDS[0]);island.add('p0','P0','cidadao-comum');island.resetRun();
  while(island.world.round.phase!=='wave')island.step();
  assert.equal([...island.world.pickups.values()].filter(p=>p.kind==='xp').length,0);
  assert.equal(ROUNDS[0].crumbs,TUTORIAL_CRUMBS);
  assert.ok(ROUNDS.slice(1).every(r=>!r.crumbs),'only round 1 teaches');
});
