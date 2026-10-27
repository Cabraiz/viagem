/**
 * "Momento mais vergonhoso" of a run (VGM-053B): the server watches each tick's events and keeps the single most
 * embarrassing moment, which the room hands to every client with the result (RunState.shame). Same events, same
 * moment on every phone, whatever each one saw. Never decides a future tick (kept outside stateHash, like the prize
 * counters).
 *
 * Moments, most embarrassing first (score):
 *   recaida 60   fell again within RECAIDA_SECONDS of being rescued
 *   apagao 55    fell during the blackout
 *   coxinha 50   fell with a coxinha on the ground within COXINHA_REACH
 *   pombos 45    fell to the pombos (the frailest critter; D-036 renamed the key from 'pernilongo')
 *   cedo 40      fell in round 1
 *   sem-boleto 25 retired with the boleto rain (NEW-20261024-ORQ-tirar-drops-cedula-girando); the key stays in the contract
 *   coxinha-cheia 15 ate a coxinha with full life
 *   caiu 10      any other fall
 * Ties: higher score, then the earlier tick, then the smaller player id.
 * Consent (design review D7): a player who turned "my embarrassing moment" off never is the moment; the run's moment is
 * the worst among the others. The tracker keeps each player's worst so that choice can be made at the end.
 */
import type {PickupState,ShameKey,ShameMoment,SimEvent} from '../contract/index.ts';
import type {SimContext} from './context.ts';
export type {ShameKey,ShameMoment} from '../contract/index.ts';
import type {ActiveHappening} from './zueira.ts';

export const SHAME_SCORE:Readonly<Record<ShameKey,number>>={recaida:60,apagao:55,coxinha:50,pombos:45,cedo:40,'sem-boleto':25,'coxinha-cheia':15,caiu:10};
export const RECAIDA_SECONDS=5,COXINHA_REACH=2.5;

const SIM_HZ=20;
export function worse(a:ShameMoment,b:ShameMoment|undefined){
  if(!b)return true;
  const d=SHAME_SCORE[a.key]-SHAME_SCORE[b.key];
  return d>0||(d===0&&(a.tick<b.tick||(a.tick===b.tick&&a.player<b.player)));
}

export class ShameTracker {
  /** Each player's worst moment of the run. */
  private best=new Map<string,ShameMoment>();
  private revivedAt=new Map<string,number>();
  private hp=new Map<string,{hp:number;max:number}>();

  get moment(){return this.momentWithout();}
  /** The run's moment, leaving out the players who did not want theirs shown. */
  momentWithout(optOut?:ReadonlySet<string>){
    let pick:ShameMoment|undefined;
    for(const m of this.best.values())if(!optOut?.has(m.player)&&worse(m,pick))pick=m;
    return pick&&{...pick};
  }
  /** A player who left the room for good: none of their moments can be the run's (they are not on the result). */
  forget(id:string){this.best.delete(id);this.revivedAt.delete(id);this.hp.delete(id);}
  reset(){this.best.clear();this.revivedAt.clear();this.hp.clear();}
  private offer(m:ShameMoment){if(worse(m,this.best.get(m.player)))this.best.set(m.player,m);}

  /** After every step: that step's events, the world after it and the zueira event on now (if any). */
  observe(ctx:Pick<SimContext,'tick'|'round'|'players'|'pickups'>,events:readonly SimEvent[],active?:ActiveHappening){
    const tick=ctx.tick,round=ctx.round.index;
    for(const e of events){
      if(e.type==='revived')this.revivedAt.set(e.player,tick);
      else if(e.type==='downed'){
        const p=ctx.players.get(e.player),base={player:e.player,round,tick,...(e.source?{source:e.source}:{})};
        const since=this.revivedAt.get(e.player);
        if(since!==undefined&&tick-since<=RECAIDA_SECONDS*SIM_HZ)this.offer({...base,key:'recaida',seconds:Math.max(1,Math.round((tick-since)/SIM_HZ))});
        if(active?.kind==='apagao')this.offer({...base,key:'apagao'});
        if(p&&nearCoxinha(ctx.pickups,p))this.offer({...base,key:'coxinha'});
        if(e.source==='pombos')this.offer({...base,key:'pombos'});
        if(round===1)this.offer({...base,key:'cedo'});
        this.offer({...base,key:'caiu'});
      }else if(e.type==='pickup'&&e.kind==='heal'){const before=this.hp.get(e.player);if(before&&before.hp>=before.max)this.offer({player:e.player,key:'coxinha-cheia',round,tick});}
    }
    // Life before the next tick's coxinhas.
    for(const p of ctx.players.values())this.hp.set(p.id,{hp:p.hp,max:p.stats.maxHp});
  }
}

function nearCoxinha(pickups:ReadonlyMap<string,PickupState>,p:{x:number;y:number}){
  for(const pickup of pickups.values())if(pickup.kind==='heal'&&(pickup.x-p.x)**2+(pickup.y-p.y)**2<=COXINHA_REACH**2)return true;
  return false;
}
