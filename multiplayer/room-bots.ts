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
import {decide,granaReserve,newMemory,towerBrainView,HZ,type BrainMemory,type Decision,type TowerBrainView} from '../src/sim/index.ts';
import {PIX_MAX} from '../src/contract/index.ts';
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
 * With a person in the room (bot-gasta-material) the bot spends only in the last seconds of the intermission: the
 * team's material and Grana are the people's first (a 13 s intermission left them no window when the bot went at 15 s).
 */
export const BOT_FORGE_LEFT_WITH_PEOPLE=5*HZ;
/**
 * torres-ajustes: the sim takes a tower order only from next to the obra (BUILD_REACH), a 7–20 s walk from the
 * fountain. The builder (the same first standing bot) gets the tower view this long before the end (a whole city
 * intermission: its first trip may start at once). Alone with bots it
 * orders as soon as it gets there; with a person only in the last BOT_FORGE_LEFT_WITH_PEOPLE (orderFrom). Either way
 * bot-brain decide only takes a trip (there, the order, back into the base) that ends before the round.
 */
export const BOT_BUILD_LEFT=60*HZ;
/**
 * Funny names, all within NICK_MAX (20). The HUD rail and the caído ficha show only the first word (railName, 9
 * letters), so every first word is its own and none is "Bot": the robot sticker already says bot.
 */
export const BOT_NAMES:readonly string[]=Object.freeze([
  'Parafuso Solto','Pamonha 3000','Geladeira Fofa','Fusquinha Turbo','Trainee 2.0','Wi-Fi Fraco',
  'Chaleira Elétrica','Robozinho Carente','Bateria 1%','Pisca Alerta','Cafeteira Mil Grau','Controle Sem Pilha',
  'Antena de Bombril','Fujão 3000','Rodinho Turbo','Zapeiro 2.0',
]);
/**
 * Forge refusals about the recipe itself: not asked again this intermission (the rest may pass next tap). Not 'balance'
 * (short of Grana since D-048): pickRecipe already checks the price on the view, so such a refusal only means the view
 * was a frame behind, and it must not lock the wall's repair out for the whole intermission (review).
 */
const RECIPE_REFUSALS=new Set(['no-weapon','full','recipe']);

/**
 * NEW-20261014-ORQ-carteira-e-pix: a bot that is not the forger sends what its wallet holds above its part of the
 * chaveiro's bill (bot-brain granaReserve) to the forger by PIX (Simulation.pix: validated and evented like a
 * person's), at most once every BOT_PIX_GAP ticks and only BOT_PIX_MIN R$ or more (a toast for every R$ 1 kill would
 * be noise). Bots never send a PIX to a person (v1); people may send to bots, who spend it by their rule.
 */
export const BOT_PIX_GAP=5*HZ,BOT_PIX_MIN=5;

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

/**
 * City (BUG-20261013-E4-corneta-jogador-longe): a person who has not moved more than ESCORT_IDLE_REACH (units) in the
 * last ESCORT_IDLE_TICKS is idle (left at the helicopter spawn, AFK) and the bots do not walk with them: a roamer
 * escorting an idle person far from the plaza ended every wave there and was the far hero the horn waited for.
 */
export const ESCORT_IDLE_REACH=.5;
export const ESCORT_IDLE_TICKS=10*HZ;
/** Where a person was last seen to move: the spot and the tick they got there (ESCORT_IDLE_REACH). */
interface PersonTrack {x:number;y:number;tick:number}
/**
 * `people` (city only, absent elsewhere so the island and endless stateHash do not move): per person id, their
 * PersonTrack as this bot saw it when it thought. Plain JSON, part of state().
 */
interface BotMind {id:string;slot:number;memory:BrainMemory;req:number;people?:Record<string,PersonTrack>;
  /** Tick of this bot's last PIX to the forger (BOT_PIX_GAP); absent before the first. */
  pixTick?:number}

export class RoomBots {
  private minds=new Map<string,BotMind>();
  /** Picks level-up offers (room bots); the autopilot of a person away leaves them for the person (3g-rede-sem-teleporte). */
  private readonly chooses:boolean;
  constructor(options:{chooses?:boolean}={}){this.chooses=options.chooses??true;}
  /** Ticks spent thinking (ms), for the lab: the cost of the bots inside the room tick. */
  thinkMs=0;thinks=0;
  /** Forge buys that went through (lab and bench). */
  forged=0;
  /** Tower builds, upgrades and repairs that went through (torres-fio: lab and tests). */
  built=0;
  /** PIX from a bot to the forger that went through (lab, bench and tests): count and R$. */
  pixes=0;pixed=0;
  /** Bench --no-towers (scripts/bench-city-run.ts): the builder never gets the tower view, so no bot builds. */
  towersOff=false;
  /** What each bot was last up to (Decision.mode; the bench steers by it). Not part of state(): it decides nothing. */
  readonly modes=new Map<string,Decision['mode']>();
  get ids(){return [...this.minds.keys()];}
  get size(){return this.minds.size;}
  has(id:string){return this.minds.has(id);}
  /** `slot`: the bot's number in the room (staggers the thinking and spreads the gather nodes and the orbit). */
  add(id:string,slot:number){this.minds.set(id,{id,slot,memory:newMemory(slot),req:0});}
  remove(id:string){this.minds.delete(id);this.modes.delete(id);}
  slotOf(id:string){return this.minds.get(id)?.slot??0;}
  /** The lowest slot no bot holds (0..5), or the first free one of from, from+step… */
  freeSlot(from=0,step=1){const used=new Set([...this.minds.values()].map(m=>m.slot));let slot=from;while(used.has(slot))slot+=step;return slot;}
  /** What decides the bots' next choices (Simulation.stateHash): each mind by slot, plain JSON. */
  state(){return [...this.minds.values()].sort((a,b)=>a.slot-b.slot).map(m=>({id:m.id,slot:m.slot,req:m.req,memory:m.memory,...(m.people?{people:m.people}:{}),...(m.pixTick!==undefined?{pixTick:m.pixTick}:{})}));}
  /** New run: fresh memories (forge refusals, offers seen, unstick, who moved), same slots. */
  reset(){for(const m of this.minds.values()){m.memory=newMemory(m.slot);m.req=0;delete m.people;delete m.pixTick;}this.modes.clear();}
  /**
   * Before each combat step: the bots due this tick decide. Returns the bots that ask for help ("Me salva"), which
   * the room relays to the people like a phone's ping.
   */
  think(sim:Simulation):string[]{
    if(!this.minds.size)return [];
    const started=performance.now(),tick=sim.tick,sos:string[]=[];
    const minds=[...this.minds.values()].sort((a,b)=>a.slot-b.slot);
    let view:ReturnType<Simulation['botView']>|undefined,forger:string|null|undefined,builder:string|null|undefined,towers:TowerBrainView|undefined;
    let people:boolean|undefined,bank:string|null|undefined;
    for(const mind of minds){
      if((tick+mind.slot)%BOT_THINK_EVERY!==0)continue;
      const p=sim.players.get(mind.id);
      if(!p)continue;
      view??=sim.botView();
      people??=view.players.some(q=>!sim.bots.has(q.id)&&q.online&&!q.spectator);
      if(forger===undefined)forger=this.forger(view,minds,people);
      if(builder===undefined)builder=this.towersOff?null:this.forger(view,minds,people,BOT_BUILD_LEFT);
      // torres-fio: the forger also builds and evolves the tower defenses (bot-brain pickTowerOrder); torres-ajustes: it
      // walks to the obra first, so it gets the view earlier; with a person here it orders only in their last seconds.
      // D-048: the view carries the material (roots, the Gustavão) and the Grana (evolutions, repairs: the builder's
      // own wallet); decide keeps its part of the chaveiro's bill out of it from view.objective (granaReserve).
      if(builder===mind.id&&!towers){
        const st=sim.run.stonewards,round=view.round,person=(owner:string)=>!sim.bots.has(owner)&&!!sim.players.get(owner)?.online;
        towers=towerBrainView(st.state,st.plan,view.tick,round?.index??0,person,
          people?(round?.phaseEndsTick??view.tick)-BOT_FORGE_LEFT_WITH_PEOPLE:undefined,sim.granaOf(mind.id));
      }
      // City: who moved lately (ESCORT_IDLE_REACH), this bot's track of each person here; the ones gone are dropped.
      const tracks=sim.terrain.world==='cidade'?this.track(mind,view,sim,tick):undefined;
      // The person to walk with: the nearest one standing, not idle in the city (bots follow people, never each other).
      let escort:{x:number;y:number}|undefined,near=Infinity;
      for(const q of view.players){
        if(sim.bots.has(q.id)||!q.online||q.spectator||q.downed||q.eliminated||q.hp<=0)continue;
        if(tracks&&Object.hasOwn(tracks,q.id)&&tick-tracks[q.id].tick>=ESCORT_IDLE_TICKS)continue;
        const at=q as typeof q&{x:number;y:number},d=Math.hypot(at.x-p.x,at.y-p.y);
        if(d<near){near=d;escort={x:at.x,y:at.y};}
      }
      // Each bot sees its own wallet as the camp's Grana (NEW-20261014-ORQ-carteira-e-pix), like a phone sees its own.
      const own={...view,...(view.camp?{camp:{...view.camp,grana:sim.granaOf(mind.id)}}:{}),offers:sim.offers(mind.id)};
      const d=decide({view:own,selfId:mind.id,at:{x:p.x,y:p.y},index:mind.slot,terrain:sim.terrain,memory:mind.memory,forger,escort,
        // D-047: the chaveiro objective's tasks (push the dead moto, clear the next delivery) are shared out among the bots.
        // Bancos: so are the ATMs (bankTask), in both city modes.
        ...(view.objective||view.banks?{teamBots:minds.map(m=>m.id)}:{}),
        // D-051: in the manual combat the bots hold the attack with a critter in reach (and cast nothing).
        ...(sim.combat?{combat:sim.combat}:{}),
        ...(builder===mind.id&&towers?{towers}:{})});
      this.modes.set(mind.id,d.mode);
      sim.setBotInput(mind.id,d.direction,d.cast,d.attack);
      if(d.choose&&this.chooses)sim.choose(mind.id,d.choose.offer,d.choose.index);
      // D-051 manual combat: the bot's inventory (an autopilot leaves the person's alone, like their offers).
      if(d.inventory&&this.chooses)sim.inventory(mind.id,d.inventory);
      if(d.forge){
        const result=sim.forge(mind.id,d.forge,`bot-${mind.id}-${++mind.req}`);
        if(result.ok)this.forged++;
        else if(RECIPE_REFUSALS.has(result.reason))mind.memory.refused[d.forge as RecipeId]=view.round?.index??0;
      }
      if(d.build){
        const order=d.build,req=`bot-${mind.id}-${++mind.req}`;
        const result='build' in order?sim.build(mind.id,order.build,req):'upgrade' in order?sim.upgrade(mind.id,order.upgrade,order.branch,req):sim.repair(mind.id,order.repair,req);
        if(result.ok){this.built++;towers=undefined;}
      }
      if(d.sos)sos.push(mind.id);
      // The surplus to the forger (BOT_PIX_GAP, BOT_PIX_MIN): bot to bot only.
      if(bank===undefined)bank=this.forger(view,minds,people,Infinity,true);
      if(bank&&bank!==mind.id&&sim.bots.has(bank)&&(mind.pixTick===undefined||tick-mind.pixTick>=BOT_PIX_GAP)){
        const amount=Math.min(PIX_MAX,sim.granaOf(mind.id)-granaReserve(view));
        if(amount>=BOT_PIX_MIN){
          const result=sim.pix(mind.id,bank,amount,`bot-${mind.id}-${++mind.req}`);
          if(result.ok){mind.pixTick=tick;this.pixes++;this.pixed+=amount;}
        }
      }
    }
    if(view){this.thinkMs+=performance.now()-started;this.thinks++;}
    return sos;
  }
  /** City: updates and returns `mind.people` from the people in `view` (a move beyond ESCORT_IDLE_REACH restarts a track). */
  private track(mind:BotMind,view:ReturnType<Simulation['botView']>,sim:Simulation,tick:number){
    const was=mind.people??{},people:Record<string,PersonTrack>={};
    for(const q of view.players){
      if(sim.bots.has(q.id))continue;
      const at=q as typeof q&{x:number;y:number},old=Object.hasOwn(was,q.id)?was[q.id]:undefined;
      const track=old&&Math.hypot(at.x-old.x,at.y-old.y)<=ESCORT_IDLE_REACH?old:{x:at.x,y:at.y,tick};
      Object.defineProperty(people,q.id,{value:track,enumerable:true,writable:true,configurable:true});
    }
    return mind.people=people;
  }
  /**
   * The bot that may buy now: the first standing bot by slot, and only in the last `left` ticks of an intermission
   * (BOT_FORGE_LEFT, or BOT_FORGE_LEFT_WITH_PEOPLE with a person here). `anyPhase`: that bot whatever the time (the
   * forger-to-be, who gets the other bots' PIX).
   */
  private forger(view:ReturnType<Simulation['botView']>,minds:readonly BotMind[],people=false,left=people?BOT_FORGE_LEFT_WITH_PEOPLE:BOT_FORGE_LEFT,anyPhase=false):string|null{
    const round=view.round;
    if(!anyPhase&&(round?.phase!=='prepare'||round.phaseEndsTick-view.tick>left))return null;
    for(const m of minds){
      const p=view.players.find(q=>q.id===m.id);
      if(p&&p.online&&!p.spectator&&!p.downed&&!p.eliminated&&p.hp>0)return m.id;
    }
    return null;
  }
}
