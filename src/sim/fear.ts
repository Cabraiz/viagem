/**
 * Fear (card NEW-20261023-ORQ-fear-escuridao-sozinho, numbers in rules/fear.ts): each hero on their feet with nobody
 * near builds one tick of dark per tick (SimPlayer.fear); with company it backs off FEAR_CALM_RATE times faster. At
 * FEAR_TICKS the dark consumes them: the normal fall (downPlayer, source FEAR_SOURCE), so an ally can still pick them up.
 * Company: another hero (or bot) on their feet within FEAR_ALLY_RADIUS, or the Uno / the base within FEAR_BASE_RADIUS.
 * Every phase counts (the user's choice (b), 24/10: the Minerva minute and the explore interval too); while exploring
 * (options.exploring) the dark grows at FEAR_EXPLORE_RATE a tick (card escuridao-justa: 2 minutes to fetch crates).
 * Room bots never build fear (the solo with bots stays playable: they wander for loot); they are company all the same.
 * An offline hero keeps the fear they had (frozen) until they are back; the room's autopilot still makes them company.
 */
import type {Point,SimPlayer} from '../contract/index.ts';
import type {SimContext,SimSystem} from './context.ts';
import {FEAR_ALLY_RADIUS,FEAR_BASE_RADIUS,FEAR_CALM_RATE,FEAR_EXPLORE_RATE,FEAR_SOURCE,FEAR_TICKS} from '../rules/index.ts';
import {downPlayer,isStanding} from './revive.ts';

export interface FearOptions {
  /** The Uno (the chaveiro's car) or else the base: company within FEAR_BASE_RADIUS. Undefined: none. */
  base?():Point|undefined;
  /** A room bot: company, never afraid. */
  bot?(playerId:string):boolean;
  /** An offline hero the room plays meanwhile (multiplayer autopilot): still a body on the map, so company. */
  autopilot?(playerId:string):boolean;
  /** True while the team explores (the minuto de Minerva, the time to explore, the intermission): the dark grows slower. */
  exploring?(ctx:SimContext):boolean;
  /** True once the run is over: the dark stops. */
  runEnded?():boolean;
}

/** Absorbs float drift so the boundary (exactly FEAR_ALLY_RADIUS or FEAR_BASE_RADIUS away) counts as company. */
const EPS=1e-9;
const byId=(a:SimPlayer,b:SimPlayer)=>a.id<b.id?-1:a.id>b.id?1:0;
const near=(a:Point,b:Point,r:number)=>Math.hypot(a.x-b.x,a.y-b.y)<=r+EPS;

/** The fear 0..1 the client sees (PlayerRunView.fear), absent at 0. */
export const fearOf=(p:Pick<SimPlayer,'fear'>)=>p.fear!==undefined&&p.fear>0?Math.min(1,p.fear/FEAR_TICKS):undefined;

export function createFearSystem(options:FearOptions={}):SimSystem{
  return {
    id:'fear',
    step(ctx:SimContext){
      if(options.runEnded?.())return;
      const players=[...ctx.players.values()].sort(byId);
      // Company is fixed for the tick: a hero the dark takes now still counted for the others this tick.
      const bodies=players.filter(p=>!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0&&(p.online||!!options.autopilot?.(p.id)));
      const base=options.base?.(),grow=options.exploring?.(ctx)?FEAR_EXPLORE_RATE:1;
      for(const p of players){
        if(p.spectator||p.downed||p.eliminated||p.hp<=0){if(p.fear!==undefined)delete p.fear;continue;}
        if(options.bot?.(p.id)){if(p.fear!==undefined)delete p.fear;continue;}
        if(!isStanding(p))continue;
        const company=(base!==undefined&&near(p,base,FEAR_BASE_RADIUS))||bodies.some(o=>o!==p&&near(p,o,FEAR_ALLY_RADIUS));
        const next=company?Math.max(0,(p.fear??0)-FEAR_CALM_RATE):Math.min(FEAR_TICKS,(p.fear??0)+grow);
        if(next>=FEAR_TICKS){delete p.fear;downPlayer(ctx,p,undefined,FEAR_SOURCE);continue;}
        if(next>0)p.fear=next;else if(p.fear!==undefined)delete p.fear;
      }
    },
  };
}
