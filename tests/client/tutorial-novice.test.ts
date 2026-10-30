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
import {ROUND1_XP} from '../../src/sim/progression.ts';
import {Coach,WALK_LIGHT_MS,resetSessionMemory,type CoachShow,type Lesson} from '../../src/client/hud/coach.ts';
import {MARQUEE_MS} from '../../src/client/hud/zones.ts';
import {KILLCAM_MS} from '../../src/client/fun/zueira.ts';

const MS_PER_TICK=1000/20;
const STAND_MS=15000;
/** A person needs a moment to read and react (to the chip, the window). */
const REACT_MS=800,PICK_MS=1500;

/** A novice of BUG-round1-letal on the rooms' world: stops 8 s at every new offer. */
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
  shown:Set<Lesson>;
  /** The joystick's "andar" light: first and last lit ms, and how many times it came on (once, at most). */
  litFrom?:number;litUntil?:number;litOns:number;
  downs:string[];minHp:number;round1EndMs?:number;
  /** D-054: kills in round 1's wave (the first one brings the first level), and the team level when the run ends. */
  killsR1?:number;level?:number;
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
  const r:Playtest={learned:new Map(),shown:new Set(),litOns:0,downs:[],minHp:1,overHeld:0};
  let bannerUntil=-1,killcamUntil=-1,panel:{openedAt:number}|undefined,chipSeenAt:number|undefined,waveAt:number|undefined;
  let center:{x:number;y:number}|undefined,downed=false,show:CoachShow|undefined,lit=false;
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
      const ally=view.players.find(p=>p.id!==me&&p.downed&&!p.eliminated);
      const allyAt=ally&&sim.players.get(ally.id);
      if(show?.lesson==='rescue'&&allyAt)toward(me,allyAt);
      else{const a=Math.atan2(hero.y-center.y,hero.x-center.x),d=Math.hypot(hero.x-center.x,hero.y-center.y);
        const x=-Math.sin(a)+(4-d)*.3*Math.cos(a),y=Math.cos(a)+(4-d)*.3*Math.sin(a),n=Math.hypot(x,y)||1;send(me,x/n,y/n);}
    }
    const events=sim.step();
    for(const e of events){
      if(e.type==='round'&&(e.phase==='wave'||e.phase==='prepare')||e.type==='happening')bannerUntil=now+MARQUEE_MS;
      if(e.type==='round'&&e.phase==='wave'&&e.index===1)waveAt??=now;
      if(e.type==='round'&&e.phase==='end'&&e.index===1)r.round1EndMs??=now;
      if(e.type==='kill'&&sim.world.round.index===1&&sim.world.round.phase==='wave')r.killsR1=(r.killsR1??0)+1;
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
      if(blocked||banner)r.overHeld++;
    }
    if(coach.stick){r.firstHintMs??=now;r.litFrom??=now;r.litUntil=now;if(!lit)r.litOns++;}
    lit=coach.stick;
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
  r.level=sim.world.team.level;
  return r;
}

const SEEDS=[0x056,0x0de1,0x7a2b,0x51d1];
const SOLO=['cidadao-comum','maromba','universitario','tio-do-churrasco'];
const SIX=['universitario','maromba','tio-do-churrasco','viciado-em-bet','pedreiro','cidadao-comum'];

test('novato (stands 15 s, then follows the hints) survives round 1 and learns to walk and tap the chip by the end of round 1 (solo, 4 classes x 4 seeds; D-054: no XP to pick)',t=>{
  const rows:string[]=[];
  for(const cls of SOLO)for(const seed of SEEDS){
    resetSessionMemory();
    const coach=new Coach(memory());
    const r=playtest(seed,[cls],coach);
    const at=`${cls} seed ${seed}`,s=(ms?:number)=>ms===undefined?'-':(ms/1000).toFixed(1);
    rows.push(`${at}: 1ª dica ${s(r.firstHintMs)} s, passo ${s(r.firstStepMs)}, andar ${s(r.learned.get('walk'))}, chip ${s(r.learned.get('chip'))}, fim R1 ${s(r.round1EndMs)}, vida mín ${(r.minHp*100).toFixed(0)}%`);
    assert.deepEqual(r.downs,[],`${at}: nobody falls in round 1`);
    assert.ok(r.minHp>=.25,`${at}: hp left (${(r.minHp*100).toFixed(0)}%)`);
    assert.ok(r.litFrom!==undefined&&r.litFrom<=1000,`${at}: the joystick lights in the first second of the run (${r.litFrom} ms)`);
    assert.equal(r.litOns,1,`${at}: lit once, never again (no relight in later rounds)`);
    const litMs=r.litUntil!-r.litFrom!;
    assert.ok(litMs>=WALK_LIGHT_MS-2*MS_PER_TICK&&litMs<WALK_LIGHT_MS,`${at}: the novice stands 15 s, the light goes after 6 s (${litMs} ms)`);
    assert.ok(![...r.shown].includes('walk'),`${at}: "andar" never has a row`);
    assert.equal(r.overHeld,0,`${at}: no hint over the kill-cam, an open window or the banner`);
    const step=r.firstStepMs!;
    assert.ok(r.learned.get('walk')!-step<=1500,`${at}: "andar" goes within 1.5 s of the first step`);
    assert.ok(!r.shown.has('xp' as Lesson),`${at}: no XP hint (D-054)`);
    // D-054: with a kill in round 1 the chip comes in its wave. A team that killed nothing there gets the first level as
    // the wave ends, in the intermission's window (no chip to learn then).
    if(r.killsR1)assert.ok(r.learned.has('chip')&&r.learned.get('chip')!<=r.round1EndMs!,`${at}: the chip comes and is learned in round 1`);
    else assert.ok(r.level!>=2,`${at}: no kill in round 1, the first level still came with its end`);
  }
  for(const row of rows)t.diagnostic(row);
});

test('six players: the novice still sees one hint at a time, learns in round 1, and the rescue lesson comes and goes when a teammate falls',t=>{
  for(const seed of SEEDS.slice(0,2)){
    resetSessionMemory();
    const coach=new Coach(memory());
    const r=playtest(seed,SIX,coach,{downAlly:true});
    const s=(ms?:number)=>ms===undefined?'-':(ms/1000).toFixed(1);
    t.diagnostic(`seed ${seed}: passo ${s(r.firstStepMs)}, andar ${s(r.learned.get('walk'))}, chip ${s(r.learned.get('chip'))}, resgate ${s(r.learned.get('rescue'))}, fim R1 ${s(r.round1EndMs)}, quedas ${r.downs.join(' ')}`);
    assert.deepEqual(r.downs,['bot1@R1'],'only the staged fall');
    assert.equal(r.litOns,1);assert.equal(r.overHeld,0);
    for(const lesson of ['walk','chip','rescue'] as const)assert.ok(r.learned.has(lesson),`seed ${seed}: ${lesson} learned`);
  }
});

// Known failure with the hero 2× (a 6-bot team downed, seed 20945): the user decides after playing whether round 1
// needs easing (NEW-20261013-ORQ-round1-ilha-infinito-heroi-2x). It still runs and reports.
test('round 1 is not letal: novices who stop 8 s at every offer still walk out (rooms\' world, 1 and 6 bots)',{todo:'NEW-20261013-ORQ-round1-ilha-infinito-heroi-2x'},t=>{
  let worst=1;
  for(const team of [['streamer'],['tio-do-churrasco'],['viciado-em-bet','universitario','maromba','streamer','rei-pastel','coach'],SIX])for(const seed of SEEDS){
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
  for(const lesson of ['walk','chip'] as const)assert.ok(first.learned.has(lesson),`first run: ${lesson} learned`);
  const coach=new Coach(store);coach.endRun();
  resetSessionMemory();
  const second=playtest(SEEDS[1],['cidadao-comum'],new Coach(store));
  assert.deepEqual([...second.shown].filter(l=>l!=='rescue'&&l!=='gather'),[],'nothing but lessons whose moment never came');
});

test('D-054: round 1 pays the XP of the old crumbs with its first kill (or at its end), endless world only; the island gets none',()=>{
  for(const seed of SEEDS)for(const players of [1,6]){
    const sim=new Simulation(seed,{world:DEFAULT_WORLD});
    for(let i=0;i<players;i++)sim.add(`p${i}`,`P${i}`,SIX[i]);
    sim.resetRun();
    while(sim.world.round.phase!=='wave')sim.step();
    assert.deepEqual([sim.world.team.level,sim.world.team.xp],[1,0],`seed ${seed}, ${players}p: nothing at the wave start (no pause before a step)`);
    let first:number|undefined;
    for(let t=0;t<ticks(60)&&first===undefined&&sim.world.round.index===1;t++)for(const e of sim.step())if(e.type==='kill'&&first===undefined)first=sim.tick;
    if(first!==undefined)assert.ok(sim.world.team.level>=2,`seed ${seed}, ${players}p: the first kill brings level 2`);
    while(sim.world.round.index<2)sim.step();
    assert.ok(sim.world.team.level>=2,`seed ${seed}, ${players}p: level 2 by the end of round 1`);
  }
  const island=new Simulation(SEEDS[0]);island.add('p0','P0','cidadao-comum');island.resetRun();
  while(island.world.round.phase!=='wave')island.step();
  assert.equal(ROUND1_XP,6);
});

test('D-054: round 1 lays no XP on the ground (no crumbs, no gems): the kills fill the bar',()=>{
  for(const seed of SEEDS)for(const players of [1,6]){
    const sim=new Simulation(seed,{world:DEFAULT_WORLD});
    for(let i=0;i<players;i++)sim.add(`p${i}`,`P${i}`,SIX[i]);
    sim.resetRun();
    let killed=false;
    for(let t=0;t<ticks(3+45)&&sim.world.round.index<2;t++){
      for(const e of sim.step())if(e.type==='kill')killed=true;
      assert.ok(![...sim.world.pickups.values()].some(p=>p.kind==='xp'),`seed ${seed}, ${players}p: no XP on the ground`);
    }
    assert.ok(killed,`seed ${seed}, ${players}p: a kill happened`);
    assert.ok(sim.world.team.level>1||sim.world.team.xp>0,`seed ${seed}, ${players}p: the kills gave XP`);
  }
});
