/**
 * What the chaveiro renderer remembers between views (card NEW-20261013-ORQ-chaveiro-render): the parts falling now,
 * since when the alarm sounds and the run ended (renderer clock), the moto's heading, and the route and stops, which
 * protocol 15 sends on the keyframe and when they change only (RouteMemo). Pure, so the state machine is tested.
 */
import {headingOf,newlyFallen,PART_FALL_MS,alarmOn,HIT_MERGE_MS,HIT_POPS_MAX,HIT_POP_MS} from './rules.ts';
import type {ChaveiroView} from './view.ts';
import {SIM_HZ} from '../../../contract/index.ts';

/** Keeps the last route and stops seen, and fills a view that came without them. */
export class RouteMemo {
  private route?:ChaveiroView['route'];
  private stops?:ChaveiroView['stops'];
  /** `view` with the last route and stops when it carries none; undefined resets the memory. */
  fill(view:ChaveiroView|undefined):ChaveiroView|undefined{
    if(!view){this.route=this.stops=undefined;return undefined;}
    if(view.route)this.route=view.route;
    if(view.stops)this.stops=view.stops;
    return view.route&&view.stops||!this.route&&!this.stops?view:{...view,...(this.route?{route:this.route}:{}),...(this.stops?{stops:this.stops}:{})};
  }
}

export class ChaveiroTracker {
  /** The current view (route and stops filled in), undefined when the run has no objective. */
  view?:ChaveiroView;
  tick=0;
  /** Parts falling now: bit → when it started. */
  readonly falling=new Map<number,number>();
  alarmSince?:number;
  endedAt?:number;
  /** The moto's heading (radians), from its last move, or the route's first leg before it moved. */
  heading=0;
  /**
   * D-052, the car moves: where its nose points (radians). Card puxar-uno-corda: the room's (view.car.heading, absent =
   * 0), so the rope drawn at the front bumper is the one the room lets a hero take.
   */
  carHeading=0;
  /** How far the car rolled along its heading (units, negative backwards): its wheels turn by it. */
  carRoll=0;
  /**
   * Card inimigos-querem-o-uno: when the car last took a hit (renderer clock) and the hits' numbers in the air. Card
   * missao-proteger-uno-tempo: with them, the seconds those hits added to the clock (its ETA rose over its fall).
   */
  lastHitAt?:number;
  readonly pops:{amount:number;at:number;seconds:number}[]=[];
  private eta?:{etaS:number;tick:number};
  private carAt?:{x:number;y:number};
  private hits?:number;
  private parts=0;
  private motoAt?:{x:number;y:number};
  private memo=new RouteMemo();

  /** A new view at server tick `tick`, seen at `now`. With `reduced` effects parts do not fall (they are just down). */
  push(next:ChaveiroView|undefined,tick:number,now:number,reduced:boolean){
    this.tick=tick;
    const view=this.memo.fill(next);
    if(!view){this.view=undefined;this.parts=0;this.falling.clear();this.alarmSince=this.endedAt=this.motoAt=this.carAt=this.hits=this.lastHitAt=this.eta=undefined;this.pops.length=0;this.heading=this.carHeading=this.carRoll=0;return;}
    // The hits it took since the last view (none on the first view: its old damage is no news).
    const took=this.hits===undefined?0:view.car.hits-this.hits;
    this.hits=view.car.hits;
    const eta=this.eta;this.eta={etaS:view.etaS,tick};
    if(took>0&&!view.ended){
      const seconds=eta&&tick>=eta.tick?Math.max(0,Math.round(view.etaS-(eta.etaS-(tick-eta.tick)/SIM_HZ))):0;
      const last=this.pops[this.pops.length-1];
      if(last&&now-last.at<HIT_MERGE_MS){last.amount+=took;last.seconds+=seconds;}
      else{this.pops.push({amount:took,at:now,seconds});if(this.pops.length>HIT_POPS_MAX)this.pops.shift();}
      this.lastHitAt=now;
    }
    // Parts that fell since the last view fall now (the first view shows the fallen ones already down).
    if(this.view&&!reduced)for(const i of newlyFallen(this.parts,view.car.parts))this.falling.set(1<<i,now);
    this.parts=view.car.parts;
    const alarm=alarmOn(view,tick);
    if(alarm&&this.alarmSince===undefined)this.alarmSince=now;else if(!alarm)this.alarmSince=undefined;
    if(view.ended&&this.endedAt===undefined)this.endedAt=now;else if(!view.ended)this.endedAt=undefined;
    if(this.motoAt)this.heading=headingOf(this.motoAt,view.moto,this.heading);
    else if(view.route&&view.route.length>1)this.heading=headingOf(view.route[0],view.route[1],this.heading);
    this.motoAt={x:view.moto.x,y:view.moto.y};
    this.carHeading=view.car.heading??0;
    if(this.carAt){
      const dx=view.car.x-this.carAt.x,dy=view.car.y-this.carAt.y;
      this.carRoll+=dx*Math.cos(this.carHeading)+dy*Math.sin(this.carHeading);
    }
    this.carAt={x:view.car.x,y:view.car.y};
    this.view=view;
  }
  /** Drops the parts that finished falling by `now`; the bits still falling. */
  settle(now:number):number{
    let bits=0;
    for(const [bit,at] of this.falling){if(now-at>=PART_FALL_MS)this.falling.delete(bit);else bits|=bit;}
    while(this.pops.length&&now-this.pops[0].at>=HIT_POP_MS)this.pops.shift();
    return bits;
  }
}
