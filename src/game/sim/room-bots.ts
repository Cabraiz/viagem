/**
 * Room bots (D-025, NEW-20261011-ORQ-dono-sala-bots): the owner fills the room up to six with bots that the Durable
 * Object plays itself, without a socket. Every few ticks each bot reads the world (Simulation.botView) through the same
 * brain as the protocol bots of VGM-045 (bot-brain.ts) and sets its stick before the step; offers, forge buys and the
 * skill go straight into the simulation. No WebSocket message is ever received for a bot, so they cost nothing of
 * the free plan's request quota (only CPU, measured in done/).
 *
 * Deterministic: names and classes come from the room seed and how many bots were added; the brain has no randomness
 * and decides on fixed ticks (staggered by slot), so the same seed and the same commands give the same run.
 */
import {decide,newMemory,HZ,type BrainMemory} from './bot-brain.ts';
import type {Simulation} from '../net/shared.ts';
import type {RecipeId} from './stonewards/rules.ts';

/** A bot looks at the world this often (ticks): 200 ms, like a thumb (VGM-045 DECISION_MS). Slots are staggered. */
export const BOT_THINK_EVERY=4;
/**
 * The forger bot leaves the first part of each intermission to the people: it only buys with this little left
 * (ticks), so a person who wants the tower gets there first ("compra na forja de vez em quando").
 */
export const BOT_FORGE_LEFT=15*HZ;
/** Funny names, all within NICK_MAX (20) and marked as bot on screen anyway. */
export const BOT_NAMES:readonly string[]=Object.freeze([
  'Robô do Gás','Bot da Firma','Robozinho Carente','Bot Sem Bateria','Robô Estagiário','Bot Pamonha',
  'Robô do Churrasco','Bot Pé de Pano','Robô Tio do Zap','Bot Mil Grau','Robô Sem Wi-Fi','Bot do Bairro',
  'Robô Cansado','Bot Fujão','Robô de Feira','Bot Lendário',
]);
/** Forge refusals about the recipe itself: not asked again this intermission (the rest may pass next tap). */
const RECIPE_REFUSALS=new Set(['no-weapon','full','balance','recipe']);

/** 32-bit mix of the room seed and a counter (cosmetic picks, never the simulation's RNG). */
export function botHash(seed:number,n:number){
  let h=(seed^Math.imul(n+1,0x9e3779b9))>>>0;
  h=Math.imul(h^(h>>>16),0x85ebca6b)>>>0;h=Math.imul(h^(h>>>13),0xc2b2ae35)>>>0;
  return (h^(h>>>16))>>>0;
}
/** Name and class of the n-th bot of a room: a name nobody in the room uses, any class. */
export function botIdentity(seed:number,n:number,classIds:readonly string[],taken:ReadonlySet<string>){
  const h=botHash(seed,n);
  let name=BOT_NAMES[h%BOT_NAMES.length];
  for(let i=1;i<=BOT_NAMES.length&&taken.has(name);i++)name=BOT_NAMES[(h+i)%BOT_NAMES.length];
  if(taken.has(name))name=`Bot ${n+1}`;
  return {name,classId:classIds[(h>>>8)%classIds.length]};
}

interface BotMind {id:string;slot:number;memory:BrainMemory;req:number}

export class RoomBots {
  private minds=new Map<string,BotMind>();
  /** Ticks spent thinking (ms), for the lab: the cost of the bots inside the room tick. */
  thinkMs=0;thinks=0;
  /** Forge buys that went through (lab and bench). */
  forged=0;
  get ids(){return [...this.minds.keys()];}
  get size(){return this.minds.size;}
  has(id:string){return this.minds.has(id);}
  /** `slot`: the bot's number in the room (staggers the thinking and spreads the gather nodes and the orbit). */
  add(id:string,slot:number){this.minds.set(id,{id,slot,memory:newMemory(slot),req:0});}
  remove(id:string){this.minds.delete(id);}
  slotOf(id:string){return this.minds.get(id)?.slot??0;}
  /** The lowest slot no bot holds (0..5). */
  freeSlot(){const used=new Set([...this.minds.values()].map(m=>m.slot));let slot=0;while(used.has(slot))slot++;return slot;}
  /** New run: fresh memories (forge refusals, offers seen, unstick), same slots. */
  reset(){for(const m of this.minds.values()){m.memory=newMemory(m.slot);m.req=0;}}
  /**
   * Before each combat step: the bots due this tick decide. Returns the bots that ask for help ("Me salva"), which
   * the room relays to the people like a phone's ping.
   */
  think(sim:Simulation):string[]{
    if(!this.minds.size)return [];
    const started=performance.now(),tick=sim.tick,sos:string[]=[];
    const minds=[...this.minds.values()].sort((a,b)=>a.slot-b.slot);
    let view:ReturnType<Simulation['botView']>|undefined,forger:string|null|undefined;
    for(const mind of minds){
      if((tick+mind.slot)%BOT_THINK_EVERY!==0)continue;
      const p=sim.players.get(mind.id);
      if(!p)continue;
      view??=sim.botView();
      if(forger===undefined)forger=this.forger(view,minds);
      const d=decide({view:{...view,offers:sim.offers(mind.id)},selfId:mind.id,at:{x:p.x,y:p.y},index:mind.slot,terrain:sim.terrain,memory:mind.memory,forger});
      sim.setBotInput(mind.id,d.direction,d.cast);
      if(d.choose)sim.choose(mind.id,d.choose.offer,d.choose.index);
      if(d.forge){
        const result=sim.forge(mind.id,d.forge,`bot-${mind.id}-${++mind.req}`);
        if(result.ok)this.forged++;
        else if(RECIPE_REFUSALS.has(result.reason))mind.memory.refused[d.forge as RecipeId]=view.round?.index??0;
      }
      if(d.sos)sos.push(mind.id);
    }
    if(view){this.thinkMs+=performance.now()-started;this.thinks++;}
    return sos;
  }
  /** The bot that may buy now: the first standing bot by slot, and only in the late part of an intermission. */
  private forger(view:ReturnType<Simulation['botView']>,minds:readonly BotMind[]):string|null{
    const round=view.round;
    if(round?.phase!=='prepare'||round.phaseEndsTick-view.tick>BOT_FORGE_LEFT)return null;
    for(const m of minds){
      const p=view.players.find(q=>q.id===m.id);
      if(p&&p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0)return m.id;
    }
    return null;
  }
}
