/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1: the chefão's arrival scene. On the tick he appears (sim/ninhos/chefao.ts
 * arrival) the room stops stepping the simulation for CENA.totalMs, exactly like the level-up pause (D-050: every
 * combat deadline is an absolute tick, so nothing moves, no telegraph fires, nobody takes damage), and tells the phones
 * (RunState.cena): each takes its camera to him, holds on his name and comes back (rules/chefao-onda.ts CENA). One
 * scene per arrival (his enemy id); a new run forgets it. Wall clock (ms, the room's `now`), not ticks.
 */
import type {RunCena} from '../src/contract/index.ts';
import {CENA} from '../src/rules/index.ts';

/** What the scene needs of the room's simulation (Simulation implements it; tests use a fake). */
export interface SceneSim {
  readonly tick:number;
  readonly run:{chefao?:{arrival(tick:number):{enemy:string;who:string;x:number;y:number}|undefined}};
}
interface Open {startedAt:number;who:string;enemy:string;x:number;y:number;tick:number}
export class BossScene {
  private open?:Open;
  private played=new Set<string>();
  /** A new run: no scene, none played. */
  reset(){this.open=undefined;this.played.clear();}
  get playing(){return !!this.open;}
  /** After a sim step: opens the scene when the chefão appeared on this tick. */
  noteStep(sim:SceneSim,now:number){
    const a=sim.run.chefao?.arrival(sim.tick);
    if(!a||this.played.has(a.enemy))return;
    this.played.add(a.enemy);
    this.open={startedAt:now,...a,tick:sim.tick};
  }
  /** Per room tick in combat, before the sim would step: true while the scene holds it. */
  update(now:number):boolean{
    if(!this.open)return false;
    if(now-this.open.startedAt<CENA.totalMs)return true;
    this.open=undefined;
    return false;
  }
  /** For RunState.cena (whole ms left, never negative); undefined outside the scene. */
  view(now:number):RunCena|undefined{
    const o=this.open;if(!o)return undefined;
    return {who:o.who,enemy:o.enemy,x:o.x,y:o.y,leftMs:Math.max(0,Math.round(CENA.totalMs-(now-o.startedAt))),totalMs:CENA.totalMs,tick:o.tick};
  }
}
