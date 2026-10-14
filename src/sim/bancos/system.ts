/**
 * Bancos (card NEW-20261014-ORQ-bancos-e-veiculos, part 1; proposal viagem-board/plans/bancos-e-veiculos-proposta.md §1):
 * the "Caixa 24 h que só dá nota de 2". City only, in BOTH city modes (the chaveiro and the wall); the island and the
 * endless world have none (no system, nothing in the state: their digests do not move). Every number is rules/bancos.ts
 * BANCO; the names are contract BANK_IDS.
 *
 * API (what the tests and the rooms use):
 *  - planBanks(seed, candidates, car, anchor) → BankPlace[] (pure): the BANCO.count banks of a run, drawn with
 *    Rng(seed).fork('bancos') among `candidates` (the city's loot points as cityLoot(terrain).crates place them). One
 *    per third of the map (three 120° sectors around the car, their start angle drawn), ≥ BANCO.distCarro from the car,
 *    and BANCO.desvio[0]..[1] from the anchor: the moto's route (anchor.route, chaveiro) or the plaza (anchor.plaza,
 *    wall mode). A sector with no candidate that fits drops the desvio rule, then the car rule. Ids 'banco-1'..,
 *    names BANK_IDS in sector order.
 *  - createBanks(options, restore?) → BanksSystem. options: {seed, candidates, car, route? | plaza, wallet:{add(n)}}.
 *    `restore`: a checkpointed BanksState (deep-copied by the caller); the places come back from the seed (never stored).
 *  - The crate at a bank's loot point is not in the run (BankPlace.crate), nor any other candidate crate a hero could
 *    work while holding the bank (its point within CRATE_CLEAR of the bank): BanksSystem.crates, which stonewards
 *    hiddenNodes and the Simulation's node views skip, in both city modes. Else gathering there withdrew for free.
 *  - BanksSystem: places (static), state (BanksState, JSON-safe), step(ctx) once a tick (assemble.ts: in the
 *    'structures' slot, after the stonewards and the chaveiro), view(tick) → contract BankView[].
 *  - In a run: createRunSystems(...) on a city terrain → RunSystems.banks (the system), RunSystems.bankViews(),
 *    RunSystemsState.banks (present only in the city). Simulation.view()/frame()/botView() carry RunView.banks.
 *  - BanksState: {list:BankRow[] (same order as places), paid (R$ the heroes took into the Grana), taken (R$ the
 *    critters took), primes (Cliente Prime made)}. BankRow: {saldo, state, until (tick, 0 unless 'sem-cedulas'),
 *    drawer? (enemy id while 'bicho'), clock (ticks toward the next note), held (0 nobody, 1 a hero, 2 a critter)}.
 *  - Critters: EnemyState extras (D-002, JSON-safe) bankTake (R$ it withdrew) and prime (true once a Cliente Prime);
 *    isPrime(e) reads it (EnemyView.prime). The lure is enemies/ai.ts baitEnemy (memory baitX, baitY, baitUntil).
 *
 * Rules (a tick):
 *  - 'sem-cedulas': nothing until `until`; then saldo = BANCO.saldo, 'aberto', event bank-refill.
 *  - A standing hero within holdR holds it (more heroes are not faster). With no live critter within filaR ("tem gente
 *    na fila") it is 'sacando' and every saqueS pays min(nota, saldo) into the team's Grana (wallet), event bank-cash
 *    by 'hero', and lures every critter within iscaR (not the boss, not a retreater) to the bank for iscaS (baitEnemy).
 *    With a critter in the queue it is 'aberto' and the count waits (it is kept while a hero holds it).
 *  - No hero within holdR and a live critter within bichoR (not the boss, not a retreater): 'bicho', drawer = it (kept
 *    while it stays in reach, else the nearest); every bichoSaqueS it withdraws min(nota, saldo) (the money goes
 *    nowhere: it keeps it, bankTake), event bank-cash by 'enemy'. At primeCada withdrawn (once: a Prime stays one, it
 *    never grows again) maxHp and hp × primeVida, prime, event bank-prime.
 *  - Nobody: 'aberto', the count starts over.
 *  - saldo 0 after a note: 'sem-cedulas' until now + recargaS, event bank-empty.
 * Deterministic: the placement stream is forked from the seed, the step reads ctx (players and enemies in their order).
 */
import type {Point} from '../../maps/index.ts';
import {BANK_IDS,Rng,ticks,type BankName,type BankState,type BankView,type EnemyState} from '../../contract/index.ts';
import {BANCO} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import {isStanding} from '../revive.ts';
import {baitEnemy} from '../enemies/ai.ts';

/** crate: the id of the loot crate whose point the bank took (that crate is not in this run). */
export interface BankPlace {id:string;x:number;y:number;name:BankName;crate?:string}
export interface BankRow {saldo:number;state:BankState;until:number;drawer?:string;clock:number;held:0|1|2}
/** JSON-safe bank state (RunSystemsState.banks). */
export interface BanksState {list:BankRow[];paid:number;taken:number;primes:number}
/** EnemyState extras of the critters that rob a bank (D-002). */
export interface BankEnemy {bankTake?:number;prime?:true}
export const isPrime=(enemy:object)=>(enemy as BankEnemy).prime===true;

export type BankAnchor={route:readonly Point[]}|{plaza:Point};
export interface BanksOptions {
  seed:number;
  /** Where a bank may stand (the city's loot points, cityLoot(terrain).crates nodes). */
  candidates:readonly (Point&{id?:string})[];
  /** The car (the wall's spot). */
  car:Point;
  /** The moto's route (chaveiro mode); without it, the plaza is the anchor. */
  route?:readonly Point[];
  plaza:Point;
  /** The team's Grana (stonewards state, D-048). */
  wallet:{add(amount:number):void};
}
export interface BanksSystem {
  readonly places:readonly BankPlace[];
  /** The loot crates the banks took the place of (not gathered in this run: stonewards hiddenNodes, Simulation nodeViews). */
  readonly crates:ReadonlySet<string>;
  readonly state:BanksState;
  step(ctx:SimContext):void;
  view(tick:number):BankView[];
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

/** The run's banks: a pure function of the seed, the candidates, the car and the anchor (see the module doc). */
export function planBanks(seed:number,candidates:readonly (Point&{id?:string})[],car:Point,anchor:BankAnchor):BankPlace[]{
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
    const tiers=[
      inSector.filter(c=>fromCar(c.p)>=BANCO.distCarro&&fromAnchor(c.p)>=lo&&fromAnchor(c.p)<=hi),
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

export function createBanksState(places:readonly BankPlace[]):BanksState{
  return {list:places.map(()=>({saldo:BANCO.saldo,state:'aberto' as BankState,until:0,clock:0,held:0 as const})),paid:0,taken:0,primes:0};
}

const SAQUE=ticks(BANCO.saqueS),BICHO_SAQUE=ticks(BANCO.bichoSaqueS),ISCA=ticks(BANCO.iscaS),RECARGA=ticks(BANCO.recargaS);
const retreating=(e:EnemyState)=>e.memory?.retreat===1;
const robber=(ctx:SimContext,e:EnemyState)=>e.hp>0&&!e.boss&&!retreating(e)&&ctx.enemies.has(e.id);

export function createBanks(options:BanksOptions,restore?:BanksState):BanksSystem{
  const places=planBanks(options.seed,options.candidates,options.car,options.route?{route:options.route}:{plaza:options.plaza});
  const state=restore??createBanksState(places);
  const near:EnemyState[]=[];

  function note(ctx:SimContext,i:number,amount:number){
    const row=state.list[i];
    row.saldo-=amount;
    if(row.saldo>0)return;
    row.saldo=0;row.state='sem-cedulas';row.until=ctx.tick+RECARGA;row.clock=0;row.held=0;delete row.drawer;
    ctx.emit({type:'bank-empty',bank:places[i].id,until:row.until});
  }
  function heroAt(ctx:SimContext,b:BankPlace){
    for(const p of ctx.players.values())if(isStanding(p)&&Math.hypot(p.x-b.x,p.y-b.y)<=BANCO.holdR)return true;
    return false;
  }
  function lure(ctx:SimContext,b:BankPlace){
    ctx.enemyIndex.query(b.x,b.y,BANCO.iscaR,near);
    for(const e of near)if(robber(ctx,e)&&Math.hypot(e.x-b.x,e.y-b.y)<=BANCO.iscaR)baitEnemy(e,b.x,b.y,ctx.tick+ISCA);
  }
  function stepBank(ctx:SimContext,i:number){
    const b=places[i],row=state.list[i];
    if(row.state==='sem-cedulas'){
      if(ctx.tick<row.until)return;
      row.saldo=BANCO.saldo;row.state='aberto';row.until=0;row.clock=0;row.held=0;delete row.drawer;
      ctx.emit({type:'bank-refill',bank:b.id});
    }
    if(heroAt(ctx,b)){
      delete row.drawer;
      if(row.held!==1){row.held=1;row.clock=0;}
      const queue=ctx.enemyIndex.nearest(b.x,b.y,BANCO.filaR,e=>robber(ctx,e));
      if(queue){row.state='aberto';return;}
      row.state='sacando';
      if(++row.clock<SAQUE)return;
      row.clock=0;
      const amount=Math.min(BANCO.nota,row.saldo);
      options.wallet.add(amount);state.paid+=amount;
      ctx.emit({type:'bank-cash',bank:b.id,amount,by:'hero'});
      lure(ctx,b);
      note(ctx,i,amount);
      return;
    }
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
    step(ctx){for(let i=0;i<places.length;i++)stepBank(ctx,i);},
    view(){
      return places.map((b,i)=>{
        const row=state.list[i];
        return {id:b.id,x:b.x,y:b.y,name:b.name,saldo:row.saldo,state:row.state,
          ...(row.state==='sem-cedulas'?{until:row.until}:{}),...(row.state==='bicho'&&row.drawer!==undefined?{drawer:row.drawer}:{})};
      });
    },
  };
}
