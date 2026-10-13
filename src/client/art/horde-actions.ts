/**
 * Action animations of the imported enemy art (NEW-20261012-ORQ-importar-arte-c-completa, item 1): which simulation
 * event makes which enemy play which one-shot animation of its `inimigos` piece (scripts/art-v2/spec.mjs anims).
 * Pure (no Phaser): layers.ts gives a small ActionWorld (its pooled actors, the view's telegraphs) and plays the cue
 * through art/horde-art.ts playEnemyAction, which ignores a cue whose animation is not in the manifest (the enemy keeps
 * walking/idling), so an empty manifest changes nothing.
 *
 * The contract does not say who owns a telegraph or a projectile (TelegraphView and ProjectileView carry no owner, and
 * the contract is frozen), so those cues go to the NEAREST live enemy of the kind that makes that hazard, within the
 * distance the simulation allows (sim/enemies/catalog.ts and sim/boss.ts, copied here: the client never imports the sim).
 */
import type {SimEvent,TelegraphKind} from '../../contract/index.ts';
import type {EnemyKind} from '../render/keys.ts';

/** Every action animation of the spec's enemies; `hit` is the lowest priority (see playEnemyAction). */
export const ENEMY_ACTIONS=['attack','throw','shove','joke','poop','slam','charge','summon','hit'] as const;
export type EnemyAction=typeof ENEMY_ACTIONS[number];
/** An enemy kind that may own a hazard, the animation it plays and how far (world units) from the hazard's x,y it can be. */
export interface ActionOwner {kind:EnemyKind;action:EnemyAction;max:number}

/**
 * Telegraph kind → who made it. Positions (sim): the burp cone and the pigeon poop start at the enemy; the Tio's
 * joke line starts one body behind him; the anão's molotov lands on the player, up to MOLOTOV.fireRange (7.5) away;
 * the chefe's stamps land on players (any distance: there is one boss), his charge and sweep start at him.
 * 'fogo' (pulses of a landed molotov) and 'explosao' (the anão's belt, after he died) have no actor.
 */
export const TELEGRAPH_ACTIONS:Readonly<Partial<Record<TelegraphKind,readonly ActionOwner[]>>>={
  arroto:[{kind:'bebado',action:'attack',max:1.5}],
  coco:[{kind:'pombos',action:'poop',max:2}],
  molotov:[{kind:'anao-molotov',action:'throw',max:9}],
  investida:[{kind:'tio-pave',action:'joke',max:2.5},{kind:'chefe',action:'charge',max:3}],
  pancada:[{kind:'chefe',action:'slam',max:40}],
  carimbo:[{kind:'chefe',action:'slam',max:40}],
  // No sweep animation in the spec: the closest one is the slam (both swing at the players around him).
  varredura:[{kind:'chefe',action:'slam',max:3}],
};
/** Hostile projectile source → who shoots it (the agiota's boleto starts one body radius ahead of him). */
export const PROJECTILE_ACTIONS:Readonly<Record<string,readonly ActionOwner[]>>={
  'boleto-juros':[{kind:'agiota',action:'throw',max:2}],
};
/**
 * Damage on a player whose `source` is an enemy id. Contact hits and the burp/stamps (telegraph damage carries its
 * owner) arrive the same way; the agiota and the anão are left out because their shots and bombs hurt with their own
 * id too (a projectile hit is not a melee swing), and the bêbado too: his only attack is the burp, whose telegraph
 * already played 'attack' (its damage would play it a second time).
 */
export const CONTACT_ACTIONS:Readonly<Partial<Record<EnemyKind,EnemyAction>>>={'tio-pave':'shove'};
/** A bark of these kinds is their joke (the Tio stops to tell it, sim/enemies/ai.ts 'joker'). */
export const BARK_ACTIONS:Readonly<Partial<Record<EnemyKind,EnemyAction>>>={'tio-pave':'joke'};
/** The chefe's summon: one spawn-warning per minion, 2.5 u around him (sim/boss.ts summon), only from phase 2. */
export const SUMMON_ACTION:ActionOwner={kind:'chefe',action:'summon',max:3.2};
/** Boss phase from which the chefe idles with 'phase2-idle' and summons (sim/boss.ts PHASE_ASSEMBLY). */
export const BOSS_PHASE2=2;

export interface ActionActor {id:string;kind:EnemyKind;nx:number;ny:number;bossPhase?:number}
/** What the event mapping needs from the renderer (no allocation: it returns its own pooled actors). */
export interface ActionWorld {
  enemy(id:string):ActionActor|undefined;
  /** Nearest live actor of `kind` to (x, y) within `max` world units. */
  nearest(kind:EnemyKind,x:number,y:number,max:number):ActionActor|undefined;
  telegraph(id:string):{kind?:TelegraphKind;x:number;y:number}|undefined;
}
export interface ActionCue {enemy:string;action:EnemyAction}

/** The nearest owner among `owners` (several kinds may make the same hazard, e.g. the investida). */
export function ownerOf(owners:readonly ActionOwner[]|undefined,x:number,y:number,world:ActionWorld,out:ActionCue):ActionCue|undefined{
  if(!owners)return undefined;
  let best=Infinity,found=false;
  for(let i=0;i<owners.length;i++){
    const o=owners[i],a=world.nearest(o.kind,x,y,o.max);if(!a)continue;
    const d=Math.hypot(a.nx-x,a.ny-y);
    if(d<best){best=d;found=true;out.enemy=a.id;out.action=o.action;}
  }
  return found?out:undefined;
}

/**
 * The action an event makes an enemy play, or undefined. `kill` is not here: the death plays on a pooled death actor.
 * - damage on an enemy → that enemy's 'hit'; damage on a player from an enemy → CONTACT_ACTIONS of its kind;
 * - telegraph → TELEGRAPH_ACTIONS (nearest owner); bark → BARK_ACTIONS; spawn-warning next to a phase-2 chefe → summon.
 */
export function eventAction(event:SimEvent,world:ActionWorld,out:ActionCue):ActionCue|undefined{
  switch(event.type){
    case 'damage':{
      if(world.enemy(event.target)){out.enemy=event.target;out.action='hit';return out;}
      const by=event.source!==undefined?world.enemy(event.source):undefined,action=by&&CONTACT_ACTIONS[by.kind];
      if(!by||!action)return undefined;
      out.enemy=by.id;out.action=action;return out;
    }
    case 'telegraph':{
      const t=world.telegraph(event.telegraph);
      return t&&t.kind?ownerOf(TELEGRAPH_ACTIONS[t.kind],t.x,t.y,world,out):undefined;
    }
    case 'bark':{
      const a=world.enemy(event.enemy),action=a&&BARK_ACTIONS[a.kind];
      if(!a||!action)return undefined;
      out.enemy=a.id;out.action=action;return out;
    }
    case 'spawn-warning':{
      if(event.count!==1)return undefined;
      const boss=world.nearest(SUMMON_ACTION.kind,event.x,event.y,SUMMON_ACTION.max);
      if(!boss||(boss.bossPhase??1)<BOSS_PHASE2)return undefined;
      out.enemy=boss.id;out.action=SUMMON_ACTION.action;return out;
    }
  }
  return undefined;
}
/** A hostile projectile just appeared: who threw it (PROJECTILE_ACTIONS), or undefined. */
export function projectileAction(source:string,hostile:boolean,x:number,y:number,world:ActionWorld,out:ActionCue):ActionCue|undefined{
  return hostile?ownerOf(PROJECTILE_ACTIONS[source],x,y,world,out):undefined;
}

// ---------- timing (pure): an action plays its frames once at its fps, then the loop comes back ----------
/** Duration (ms) of a one-shot animation of `frames` frames at `fps`. */
export const actionDuration=(frames:number,fps:number)=>Math.max(1,frames)/Math.max(1e-6,fps)*1000;
/** Column of a one-shot animation `elapsedMs` after it started: clamped on the last frame (never loops). */
export const onceColumn=(elapsedMs:number,frames:number,fps:number)=>Math.min(Math.max(1,frames)-1,Math.floor(Math.max(0,elapsedMs)/1000*fps));
/** A death holds its last frame this long while fading out, then the death actor is released. */
export const DEATH_FADE_MS=320;
/** Alpha of a death actor `elapsedMs` after the kill (1 while playing; fades over DEATH_FADE_MS; ≤ 0 = release). */
export const deathAlpha=(elapsedMs:number,durationMs:number)=>elapsedMs<=durationMs?1:1-(elapsedMs-durationMs)/DEATH_FADE_MS;
