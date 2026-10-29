/**
 * Bancos (card NEW-20261014-ORQ-bancos-e-veiculos, part 1; proposal viagem-board/plans/bancos-e-veiculos-proposta.md §1):
 * the "Caixa 24 h que só dá nota de 2", now the BICOS (card NEW-20261024-ORQ-bancos-viram-bicos: the same places are
 * shops with a gig; a hero clocks in with Trabalhar). City only, in BOTH city modes (the chaveiro and the wall); the
 * island and the endless world have none (no system, nothing in the state: their digests do not move). The places and
 * the critters' numbers are rules/bancos.ts BANCO, the shift's rules/bicos.ts BICO; the names are contract BANK_IDS and
 * BICO_IDS.
 *
 * API (what the tests and the rooms use):
 *  - planBanks(seed, candidates, car, anchor) → BankPlace[] (pure): the BANCO.count banks of a run, drawn with
 *    Rng(seed).fork('bancos') among `candidates` (the city's loot points as cityLoot(terrain).crates place them). One
 *    per third of the map (three 120° sectors around the car, their start angle drawn), BANCO.distCarro..distCarroMax from the car,
 *    and BANCO.desvio[0]..[1] from the anchor: the moto's route (anchor.route, chaveiro) or the plaza (anchor.plaza,
 *    wall mode). In each sector a spot where the whole shop fits (candidate.lot: a BICO.lote disc clear; ringCandidates
 *    marks it) comes first; with none, the desvio rule drops, then the car rule. Ids 'banco-1'..,
 *    names BANK_IDS in sector order.
 *  - createBanks(options, restore?) → BanksSystem. options: {seed, candidates, car, route? | plaza, wallet:{add(n)},
 *    work?(id)}: work is a player's Trabalhar this tick (assemble.ts: the input, held and standing still; undefined
 *    with no input this tick).
 *    `restore`: a checkpointed BanksState (deep-copied by the caller); the places come back from the seed (never stored).
 *  - The crate at a bank's loot point is not in the run (BankPlace.crate), nor any other candidate crate a hero could
 *    work while holding the bank (its point within CRATE_CLEAR of the bank): BanksSystem.crates, which stonewards
 *    hiddenNodes and the Simulation's node views skip, in both city modes. Else gathering there withdrew for free.
 *  - BanksSystem: places (static), state (BanksState, JSON-safe), step(ctx) once a tick (assemble.ts: in the
 *    'structures' slot, after the stonewards and the chaveiro), view(tick) → contract BankView[], working(id) → the
 *    bank a player works in (assemble.ts: the weapons' busy, nobody fires from inside).
 *  - In a run: createRunSystems(...) on a city terrain → RunSystems.banks (the system), RunSystems.bankViews(),
 *    RunSystemsState.banks (present only in the city). Simulation.view()/frame()/botView() carry RunView.banks.
 *  - BanksState: {list:BankRow[] (same order as places), paid (R$ the heroes took into the Grana), taken (R$ the
 *    critters took), primes (Cliente Prime made)}. BankRow: {saldo, state, until (tick, 0 unless 'sem-cedulas'),
 *    drawer? (enemy id while 'bicho'), clock (ticks toward the critter's next note), held (0 nobody, 1 a shift, 2 a
 *    critter), bico, opened, workers?, earn?, fila?}; banned? (player → the tick they may clock in again).
 *  - firstBicos(seed, n) / nextBico(seed, shop, opened, now, others): the gigs, drawn by the seed (all different at the
 *    start; on each reopening, one neither the shop had nor another shop has).
 *  - Critters: EnemyState extras (D-002, JSON-safe) bankTake (R$ it withdrew) and prime (true once a Cliente Prime);
 *    isPrime(e) reads it (EnemyView.prime). The lure is enemies/ai.ts baitEnemy (memory baitX, baitY, baitUntil).
 *
 * Rules (a tick):
 *  - 'sem-cedulas' (closed): nothing until `until`; then another gig (nextBico), saldo = BICO.saldo, 'aberto', event
 *    bank-refill.
 *  - The shift: a worker stays while standing, within holdR and work is not false (moving or letting go: event bico
 *    'saiu'); a standing hero within holdR with work true clocks in (event bico 'entrou') unless banned or working
 *    another shop. Workers are invulnerable through the next tick (core damagePlayer skips them) and do not fire.
 *  - With workers it is 'sacando': fila = live critters within filaR (not the boss, not a retreater). At
 *    BICO.filaExpulsa the manager throws them out (event bico 'expulso', slowed BICO.expulsoS, banned BICO.banidoS).
 *    Else each worker earns bicoPay(bico, workers, fila) a tick (thousandths of R$: porSegundo alone, dupla each when
 *    shared, × (1 − filaCorte × fila)); every BICO.nota earned pays min(nota, saldo) into their wallet (carteira-e-pix),
 *    event bank-cash by 'hero', and lures every critter within iscaR (not the boss, not a retreater) to the bank for
 *    iscaS (baitEnemy).
 *  - No worker but a standing hero within holdR: 'aberto', nobody draws ("tem gente").
 *  - No hero within holdR and a live critter within bichoR (not the boss, not a retreater): 'bicho', drawer = it (kept
 *    while it stays in reach, else the nearest); every bichoSaqueS it withdraws min(nota, saldo) (the money goes
 *    nowhere: it keeps it, bankTake), event bank-cash by 'enemy'. At primeCada withdrawn (once: a Prime stays one, it
 *    never grows again) maxHp and hp × primeVida, prime, event bank-prime.
 *  - Nobody: 'aberto', the count starts over.
 *  - saldo 0 after a note: 'sem-cedulas' until now + recargaS, the shift out (bico 'saiu'), event bank-empty.
 * Deterministic: the placement stream is forked from the seed, the step reads ctx (players and enemies in their order).
 */
import type {Point} from '../../maps/index.ts';
import {BANK_IDS,BICO_IDS,Rng,SIM_HZ,ticks,type BankName,type BankState,type BankView,type BicoId,type EnemyState,type SimPlayer} from '../../contract/index.ts';
import {BANCO,BICO,BICOS,bicoSaldo} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';
import {baitEnemy} from '../enemies/ai.ts';

/** crate: the id of the loot crate whose point the bank took (that crate is not in this run). */
export interface BankPlace {id:string;x:number;y:number;name:BankName;crate?:string}
/**
 * Bicos: bico (the gig now), opened (times it opened again: the reopen's draw), workers (player ids in the shift, clock-in
 * order) and earn (their pay toward the next note, in thousandths of R$), absent when nobody works it.
 */
export interface BankRow {saldo:number;state:BankState;until:number;drawer?:string;clock:number;held:0|1|2;
  bico:BicoId;opened:number;workers?:string[];earn?:Record<string,number>;
  /** The critters in the queue at the last step, while someone works it (absent: none). */
  fila?:number}
/** JSON-safe bank state (RunSystemsState.banks). banned: player id → the tick they may clock in again (thrown out). */
export interface BanksState {list:BankRow[];paid:number;taken:number;primes:number;banned?:Record<string,number>}
/** EnemyState extras of the critters that rob a bank (D-002). */
export interface BankEnemy {bankTake?:number;prime?:true}
export const isPrime=(enemy:object)=>(enemy as BankEnemy).prime===true;

export type BankAnchor={route:readonly Point[]}|{plaza:Point};
export interface BanksOptions {
  seed:number;
  /** Where a bank may stand (the city's loot points, cityLoot(terrain).crates nodes). */
  candidates:readonly BankCandidate[];
  /** The car (the wall's spot). */
  car:Point;
  /** The moto's route (chaveiro mode); without it, the plaza is the anchor. */
  route?:readonly Point[];
  plaza:Point;
  /** The team's Grana (stonewards state, D-048). */
  /** Pays a note to the hero holding the ATM (carteira-e-pix: each player's own wallet). */
  wallet:{add(amount:number,to:SimPlayer):void};
  /**
   * Bicos: this tick's Trabalhar of a player (the players system's input: true held and standing still, false otherwise),
   * undefined when no input came this tick (a worker stays in).
   */
  work?(playerId:string):boolean|undefined;
}
export interface BanksSystem {
  readonly places:readonly BankPlace[];
  /** The loot crates the banks took the place of (not gathered in this run: stonewards hiddenNodes, Simulation nodeViews). */
  readonly crates:ReadonlySet<string>;
  readonly state:BanksState;
  step(ctx:SimContext):void;
  view(tick:number):BankView[];
  /** Bicos: the bank `playerId` works in now (they do not fire: weapons busy), else undefined. */
  working(playerId:string):string|undefined;
}

const TAU=Math.PI*2;
/**
 * A crate whose point is this close (u) to a bank is not in the run: a hero working it (within its radius + the gather
 * reach, stonewards/resources.ts GATHER_REACH 0.9, CRATE_RADIUS 0.35) would stand within holdR of the bank.
 */
export const CRATE_CLEAR=BANCO.holdR+1.25;
/** Distance from p to the polyline (its first point when it has one). */
export function distanceToPolyline(p:Point,line:readonly Point[]){
  if(!line.length)return Infinity;
  let best=Math.hypot(p.x-line[0].x,p.y-line[0].y);
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
    const t=l2>1e-12?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0;
    best=Math.min(best,Math.hypot(p.x-(a.x+dx*t),p.y-(a.y+dy*t)));
  }
  return best;
}

/**
 * The bank spots on the streets around the car: a ring BANCO.distCarro..distCarroMax sampled every RING_STEP_DEG degrees
 * and RING_STEP_U units, kept where a hero-size disc RING_CLEAR is clear (`clear`, the city terrain). Deterministic order.
 */
export const RING_STEP_DEG=5,RING_STEP_U=2,RING_CLEAR=1.5;
/** A bank spot; `lot`: the whole shop fits there (a BICO.lote disc is clear), so planBanks takes it first. */
export type BankCandidate=Point&{id?:string;lot?:true};
export function ringCandidates(car:Point,clear:(x:number,y:number,r:number)=>boolean):BankCandidate[]{
  const out:BankCandidate[]=[];
  for(let r=BANCO.distCarro;r<=BANCO.distCarroMax+1e-9;r+=RING_STEP_U)for(let a=0;a<360;a+=RING_STEP_DEG){
    const t=a*Math.PI/180,x=car.x+Math.cos(t)*r,y=car.y+Math.sin(t)*r;
    if(clear(x,y,RING_CLEAR))out.push(clear(x,y,BICO.lote)?{x,y,lot:true}:{x,y});
  }
  return out;
}

/** The run's banks: a pure function of the seed, the candidates, the car and the anchor (see the module doc). */
export function planBanks(seed:number,candidates:readonly BankCandidate[],car:Point,anchor:BankAnchor):BankPlace[]{
  const rng=new Rng(seed>>>0).fork('bancos'),count=Math.max(0,Math.min(BANCO.count,BANK_IDS.length));
  const offset=rng.range(0,TAU),width=TAU/Math.max(1,count);
  const sectorOf=(p:Point)=>{const a=((Math.atan2(p.y-car.y,p.x-car.x)-offset)%TAU+TAU)%TAU;return Math.min(count-1,Math.floor(a/width));};
  const fromCar=(p:Point)=>Math.hypot(p.x-car.x,p.y-car.y);
  const fromAnchor=(p:Point)=>'route' in anchor?distanceToPolyline(p,anchor.route):Math.hypot(p.x-anchor.plaza.x,p.y-anchor.plaza.y);
  const [lo,hi]=BANCO.desvio;
  const taken=new Set<number>(),out:BankPlace[]=[];
  for(let k=0;k<count;k++){
    const pool=candidates.map((p,i)=>({p,i})).filter(c=>!taken.has(c.i));
    const inSector=pool.filter(c=>sectorOf(c.p)===k);
    const ring=inSector.filter(c=>fromCar(c.p)>=BANCO.distCarro&&fromCar(c.p)<=BANCO.distCarroMax);
    const tiers=[
      // Bicos: a spot where the whole shop fits first (the desvio rule, then without it).
      ring.filter(c=>c.p.lot&&fromAnchor(c.p)>=lo&&fromAnchor(c.p)<=hi),
      ring.filter(c=>c.p.lot),
      ring.filter(c=>fromAnchor(c.p)>=lo&&fromAnchor(c.p)<=hi),
      ring,
      inSector.filter(c=>fromCar(c.p)>=BANCO.distCarro),
      inSector,
      pool,
    ];
    const list=tiers.find(t=>t.length);
    if(!list)break;
    const c=rng.pick(list);taken.add(c.i);
    out.push({id:`banco-${k+1}`,x:c.p.x,y:c.p.y,name:BANK_IDS[k],...(c.p.id!==undefined?{crate:c.p.id}:{})});
  }
  return out;
}

/** The run's first gigs: one per shop, all different, drawn by the seed. */
export function firstBicos(seed:number,count:number):BicoId[]{
  const rng=new Rng(seed>>>0).fork('bicos'),pool=[...BICO_IDS],out:BicoId[]=[];
  for(let i=0;i<count;i++){out.push(pool.splice(rng.int(0,pool.length-1),1)[0]);if(!pool.length)pool.push(...BICO_IDS);}
  return out;
}
/** The gig a shop opens with again: drawn by (seed, shop, times opened), never the one it had nor one another shop has. */
export function nextBico(seed:number,bank:number,opened:number,now:BicoId,others:readonly BicoId[]):BicoId{
  const pool=BICO_IDS.filter(b=>b!==now&&!others.includes(b));
  return new Rng(seed>>>0).fork(`bico-${bank}-${opened}`).pick(pool.length?pool:BICO_IDS.filter(b=>b!==now));
}

export function createBanksState(places:readonly BankPlace[],seed=0):BanksState{
  const bicos=firstBicos(seed,places.length);
  return {list:places.map((_,i)=>({saldo:BICO.saldo,state:'aberto' as BankState,until:0,clock:0,held:0 as const,bico:bicos[i],opened:0})),paid:0,taken:0,primes:0};
}

const BICHO_SAQUE=ticks(BANCO.bichoSaqueS),ISCA=ticks(BANCO.iscaS),RECARGA=ticks(BANCO.recargaS);
const EXPULSO=ticks(BICO.expulsoS),BANIDO=ticks(BICO.banidoS),NOTA_MIL=BICO.nota*1000;
/** A worker's pay this tick, in thousandths of R$: alone or shared, cut by the queue (rules/bicos.ts). */
export function bicoPay(bico:BicoId,workers:number,fila:number){
  const rate=workers>1?BICO.dupla:BICO.porSegundo,cut=Math.max(0,1-(BICOS[bico].filaCorte??BICO.filaCorte)*fila);
  return Math.round(rate*cut*1000/SIM_HZ);
}
const retreating=(e:EnemyState)=>e.memory?.retreat===1;
const robber=(ctx:SimContext,e:EnemyState)=>e.hp>0&&!e.boss&&!retreating(e)&&ctx.enemies.has(e.id);

export function createBanks(options:BanksOptions,restore?:BanksState):BanksSystem{
  const places=planBanks(options.seed,options.candidates,options.car,options.route?{route:options.route}:{plaza:options.plaza});
  const state=restore??createBanksState(places,options.seed);
  // A checkpoint from before the bicos: each shop gets its first gig.
  {const first=firstBicos(options.seed,places.length);state.list.forEach((row,i)=>{if(row.bico===undefined){row.bico=first[i];row.opened=0;}});}
  const near:EnemyState[]=[];

  function note(ctx:SimContext,i:number,amount:number){
    const row=state.list[i];
    row.saldo-=amount;
    if(row.saldo>0)return;
    row.saldo=0;row.state='sem-cedulas';row.until=ctx.tick+RECARGA;row.clock=0;row.held=0;delete row.drawer;
    for(const id of row.workers??[])ctx.emit({type:'bico',bank:places[i].id,player:id,what:'saiu'});
    delete row.workers;delete row.earn;
    ctx.emit({type:'bank-empty',bank:places[i].id,until:row.until});
  }
  /** Bicos: who stays in the shift (Trabalhar not let go, standing, in the ring) and who clocks in now. */
  function shift(ctx:SimContext,i:number){
    const b=places[i],row=state.list[i],keep:string[]=[];
    const inRing=(p:SimPlayer)=>Math.hypot(p.x-b.x,p.y-b.y)<=BANCO.holdR;
    for(const id of row.workers??[]){
      const p=ctx.players.get(id);
      if(p&&isStanding(p)&&options.work?.(id)!==false&&inRing(p))keep.push(id);
      else{ctx.emit({type:'bico',bank:b.id,player:id,what:'saiu'});if(row.earn)delete row.earn[id];}
    }
    for(const p of ctx.players.values()){
      if(keep.includes(p.id)||options.work?.(p.id)!==true||!isStanding(p)||!inRing(p))continue;
      if(ctx.tick<(state.banned?.[p.id]??-Infinity)||state.list.some(r=>r!==row&&r.workers?.includes(p.id)))continue;
      keep.push(p.id);ctx.emit({type:'bico',bank:b.id,player:p.id,what:'entrou'});
    }
    if(keep.length)row.workers=keep;else{delete row.workers;delete row.earn;}
    return keep;
  }
  /** The manager throws the shift out: slowed a moment, kept out a while. */
  function expel(ctx:SimContext,i:number,workers:readonly string[]){
    const row=state.list[i],banned=state.banned??={};
    for(const id of workers){
      const p=ctx.players.get(id);
      if(p)p.slowUntil=Math.max(p.slowUntil??0,ctx.tick+EXPULSO);
      banned[id]=ctx.tick+BANIDO;
      ctx.emit({type:'bico',bank:places[i].id,player:id,what:'expulso'});
    }
    delete row.workers;delete row.earn;
  }
  /** The live critters in a shop's queue (within filaR of it). */
  function fila(ctx:SimContext,b:BankPlace){
    ctx.enemyIndex.query(b.x,b.y,BANCO.filaR,near);
    let n=0;
    for(const e of near)if(robber(ctx,e)&&Math.hypot(e.x-b.x,e.y-b.y)<=BANCO.filaR)n++;
    return n;
  }
  /** The standing hero holding the ATM: the nearest within holdR (ties by id), or undefined. */
  function heroAt(ctx:SimContext,b:BankPlace):SimPlayer|undefined{
    let best:SimPlayer|undefined,bestD=Infinity;
    for(const p of ctx.players.values()){
      if(!isStanding(p))continue;
      const d=Math.hypot(p.x-b.x,p.y-b.y);
      if(d<=BANCO.holdR&&(d<bestD||d===bestD&&best!==undefined&&p.id<best.id)){best=p;bestD=d;}
    }
    return best;
  }
  function lure(ctx:SimContext,b:BankPlace){
    ctx.enemyIndex.query(b.x,b.y,BANCO.iscaR,near);
    for(const e of near)if(robber(ctx,e)&&Math.hypot(e.x-b.x,e.y-b.y)<=BANCO.iscaR)baitEnemy(e,b.x,b.y,ctx.tick+ISCA);
  }
  function stepBank(ctx:SimContext,i:number){
    const b=places[i],row=state.list[i];
    if(row.state==='sem-cedulas'){
      if(ctx.tick<row.until)return;
      row.opened++;
      row.bico=nextBico(options.seed,i,row.opened,row.bico,state.list.filter(r=>r!==row).map(r=>r.bico));
      row.saldo=BICO.saldo;row.state='aberto';row.until=0;row.clock=0;row.held=0;delete row.drawer;
      ctx.emit({type:'bank-refill',bank:b.id});
    }
    // The shift by seat (bicoSaldo): a team's shop holds less; one who joins mid-shift trims what is left.
    row.saldo=Math.min(row.saldo,bicoSaldo(ctx.players.size));
    delete row.fila;
    const workers=shift(ctx,i);
    if(workers.length){
      delete row.drawer;row.held=1;row.clock=0;
      // Inside: no hit lands on them (core damagePlayer and the effects skip the invulnerable) through the next tick.
      for(const id of workers){const p=ctx.players.get(id)!;p.invulnerableUntil=Math.max(p.invulnerableUntil??0,ctx.tick+2);}
      const queue=fila(ctx,b);
      if(queue>=BICO.filaExpulsa){expel(ctx,i,workers);row.state='aberto';row.held=0;return;}
      row.state='sacando';
      if(queue)row.fila=queue;
      const pay=bicoPay(row.bico,workers.length,queue),earn=row.earn??={};
      for(const id of workers){
        earn[id]=(earn[id]??0)+pay;
        if(earn[id]<NOTA_MIL||row.state!=='sacando')continue;
        earn[id]-=NOTA_MIL;
        const amount=Math.min(BICO.nota,row.saldo);
        options.wallet.add(amount,ctx.players.get(id)!);state.paid+=amount;
        ctx.emit({type:'bank-cash',bank:b.id,amount,by:'hero'});
        lure(ctx,b);
        note(ctx,i,amount);
      }
      return;
    }
    // A hero standing in the ring who does not work still keeps the critters off the money ("tem gente").
    if(heroAt(ctx,b)){row.state='aberto';row.held=0;row.clock=0;delete row.drawer;return;}
    // A critter alone at the ATM: the one already drawing while it stays in reach, else the nearest.
    const kept=row.drawer!==undefined?ctx.enemies.get(row.drawer):undefined;
    const drawer=kept&&robber(ctx,kept)&&Math.hypot(kept.x-b.x,kept.y-b.y)<=BANCO.bichoR?kept:ctx.enemyIndex.nearest(b.x,b.y,BANCO.bichoR,e=>robber(ctx,e));
    if(!drawer){row.state='aberto';row.held=0;row.clock=0;delete row.drawer;return;}
    if(row.held!==2||row.drawer!==drawer.id){row.held=2;row.clock=0;row.drawer=drawer.id;}
    row.state='bicho';
    if(++row.clock<BICHO_SAQUE)return;
    row.clock=0;
    const amount=Math.min(BANCO.nota,row.saldo),rich=drawer as EnemyState&BankEnemy;
    rich.bankTake=(rich.bankTake??0)+amount;state.taken+=amount;
    ctx.emit({type:'bank-cash',bank:b.id,amount,by:'enemy',enemy:drawer.id});
    if(!rich.prime&&rich.bankTake>=BANCO.primeCada){
      rich.prime=true;drawer.maxHp*=BANCO.primeVida;drawer.hp*=BANCO.primeVida;state.primes++;
      ctx.emit({type:'bank-prime',bank:b.id,enemy:drawer.id});
    }
    note(ctx,i,amount);
  }

  return {
    places,state,
    crates:new Set([...places.flatMap(b=>b.crate!==undefined?[b.crate]:[]),
      ...options.candidates.filter(c=>c.id!==undefined&&places.some(b=>Math.hypot(c.x-b.x,c.y-b.y)<=CRATE_CLEAR)).map(c=>c.id!)]),
    step(ctx){
      for(let i=0;i<places.length;i++)stepBank(ctx,i);
      const banned=state.banned;
      if(banned){for(const [id,until] of Object.entries(banned))if(ctx.tick>=until)delete banned[id];if(!Object.keys(banned).length)delete state.banned;}
    },
    working(id){const i=state.list.findIndex(r=>r.workers?.includes(id));return i<0?undefined:places[i].id;},
    view(){
      return places.map((b,i)=>{
        const row=state.list[i];
        return {id:b.id,x:b.x,y:b.y,name:b.name,saldo:row.saldo,state:row.state,
          ...(row.state==='sem-cedulas'?{until:row.until}:{}),...(row.state==='bicho'&&row.drawer!==undefined?{drawer:row.drawer}:{}),
          bico:row.bico,...(row.workers?.length?{workers:[...row.workers]}:{}),...(row.fila?{fila:row.fila}:{})};
      });
    },
  };
}
