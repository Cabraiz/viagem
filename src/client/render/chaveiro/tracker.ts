/**
 * What the chaveiro renderer remembers between views (card NEW-20261013-ORQ-chaveiro-render): the parts falling now,
 * since when the alarm sounds and the run ended (renderer clock), the moto's heading, and the route and stops, which
 * protocol 15 sends on the keyframe and when they change only (RouteMemo). Pure, so the state machine is tested.
 */
import {headingOf,newlyFallen,PART_FALL_MS,alarmOn} from './rules.ts';
import type {ChaveiroView} from './view.ts';

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
  private parts=0;
  private motoAt?:{x:number;y:number};
  private memo=new RouteMemo();

  /** A new view at server tick `tick`, seen at `now`. With `reduced` effects parts do not fall (they are just down). */
  push(next:ChaveiroView|undefined,tick:number,now:number,reduced:boolean){
    this.tick=tick;
    const view=this.memo.fill(next);
    if(!view){this.view=undefined;this.parts=0;this.falling.clear();this.alarmSince=this.endedAt=this.motoAt=undefined;this.heading=0;return;}
    // Parts that fell since the last view fall now (the first view shows the fallen ones already down).
    if(this.view&&!reduced)for(const i of newlyFallen(this.parts,view.car.parts))this.falling.set(1<<i,now);
    this.parts=view.car.parts;
    const alarm=alarmOn(view,tick);
    if(alarm&&this.alarmSince===undefined)this.alarmSince=now;else if(!alarm)this.alarmSince=undefined;
    if(view.ended&&this.endedAt===undefined)this.endedAt=now;else if(!view.ended)this.endedAt=undefined;
    if(this.motoAt)this.heading=headingOf(this.motoAt,view.moto,this.heading);
    else if(view.route&&view.route.length>1)this.heading=headingOf(view.route[0],view.route[1],this.heading);
    this.motoAt={x:view.moto.x,y:view.moto.y};
    this.view=view;
  }
  /** Drops the parts that finished falling by `now`; the bits still falling. */
  settle(now:number):number{
    let bits=0;
    for(const [bit,at] of this.falling){if(now-at>=PART_FALL_MS)this.falling.delete(bit);else bits|=bit;}
    return bits;
  }
}
