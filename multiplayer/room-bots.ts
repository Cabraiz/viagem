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
import {decide,newMemory,HZ,type BrainMemory} from '../src/sim/index.ts';
import type {Simulation} from './simulation.ts';
import type {RecipeId} from '../src/rules/index.ts';
import {railName} from '../src/rules/index.ts';

/** A bot looks at the world this often (ticks): 200 ms, like a thumb (VGM-045 DECISION_MS). Slots are staggered. */
export const BOT_THINK_EVERY=4;
/**
 * The forger bot leaves the first part of each intermission to the people: it only buys with this little left
 * (ticks), so a person who wants the tower gets there first ("compra na forja de vez em quando").
 */
export const BOT_FORGE_LEFT=15*HZ;
/**
 * Funny names, all within NICK_MAX (20). The HUD rail and the caído ficha show only the first word (railName, 9
 * letters), so every first word is its own and none is "Bot": the robot sticker already says bot.
 */
export const BOT_NAMES:readonly string[]=Object.freeze([
  'Parafuso Solto','Pamonha 3000','Geladeira Fofa','Fusquinha Turbo','Trainee 2.0','Wi-Fi Fraco',
  'Chaleira Elétrica','Robozinho Carente','Bateria 1%','Pisca Alerta','Cafeteira Mil Grau','Controle Sem Pilha',
  'Antena de Bombril','Fujão 3000','Rodinho Turbo','Zapeiro 2.0',
]);
/** Forge refusals about the recipe itself: not asked again this intermission (the rest may pass next tap). */
const RECIPE_REFUSALS=new Set(['no-weapon','full','balance','recipe']);

/** 32-bit mix of the room seed and a counter (cosmetic picks, never the simulation's RNG). */
export function botHash(seed:number,n:number){
  let h=(seed^Math.imul(n+1,0x9e3779b9))>>>0;
  h=Math.imul(h^(h>>>16),0x85ebca6b)>>>0;h=Math.imul(h^(h>>>13),0xc2b2ae35)>>>0;
  return (h^(h>>>16))>>>0;
}
/**
 * Name and class of the n-th bot of a room: a name whose short form (railName) nobody seated has, any class.
 * `taken`: the names already seated.
 */
export function botIdentity(seed:number,n:number,classIds:readonly string[],taken:ReadonlySet<string>){
  const h=botHash(seed,n),short=(name:string)=>railName(name).toLocaleLowerCase('pt-BR');
  const shorts=new Set([...taken].map(short)),free=(name:string)=>!taken.has(name)&&!shorts.has(short(name));
  let name=BOT_NAMES[h%BOT_NAMES.length];
  for(let i=1;i<=BOT_NAMES.length&&!free(name);i++)name=BOT_NAMES[(h+i)%BOT_NAMES.length];
  if(!free(name))name=`Robô${n+1}`;
  return {name,classId:classIds[(h>>>8)%classIds.length]};
}

interface BotMind {id:string;slot:number;memory:BrainMemory;req:number}

export class RoomBots {
  private minds=new Map<string,BotMind>();
  /** Picks level-up offers (room bots); the autopilot of a person away leaves them for the person (3g-rede-sem-teleporte). */
  private readonly chooses:boolean;
  constructor(options:{chooses?:boolean}={}){this.chooses=options.chooses??true;}
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
  /** The lowest slot no bot holds (0..5), or the first free one of from, from+step… */
  freeSlot(from=0,step=1){const used=new Set([...this.minds.values()].map(m=>m.slot));let slot=from;while(used.has(slot))slot+=step;return slot;}
  /** What decides the bots' next choices (Simulation.stateHash): each mind by slot, plain JSON. */
  state(){return [...this.minds.values()].sort((a,b)=>a.slot-b.slot).map(m=>({id:m.id,slot:m.slot,req:m.req,memory:m.memory}));}
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
      // The person to walk with: the nearest one standing (bots follow people, never each other).
      let escort:{x:number;y:number}|undefined,near=Infinity;
      for(const q of view.players){
        if(sim.bots.has(q.id)||!q.online||q.spectator||q.downed||q.eliminated||q.hp<=0)continue;
        const at=q as typeof q&{x:number;y:number},d=Math.hypot(at.x-p.x,at.y-p.y);
        if(d<near){near=d;escort={x:at.x,y:at.y};}
      }
      const d=decide({view:{...view,offers:sim.offers(mind.id)},selfId:mind.id,at:{x:p.x,y:p.y},index:mind.slot,terrain:sim.terrain,memory:mind.memory,forger,escort});
      sim.setBotInput(mind.id,d.direction,d.cast);
      if(d.choose&&this.chooses)sim.choose(mind.id,d.choose.offer,d.choose.index);
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
