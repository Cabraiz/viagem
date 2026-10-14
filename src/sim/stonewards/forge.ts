/** Forge: three recipes bought from the team balance during the intermission. */
import {walkable} from '../../maps/index.ts';
import {Rng} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {ticks} from '../../contract/index.ts';
import {itemMaxLevel,isEvolutionId} from '../evolutions.ts';
import {isStanding} from '../revive.ts';
import type {StonewardsState} from './state.ts';
import type {CellRect} from '../../maps/index.ts';
import {barricadeOccupied,findBarricade,setBlocking} from './barricades.ts';
import {CAMP_RADIUS,RECIPES,TOWER_SECONDS,canPay,type RecipeId} from '../../rules/index.ts';

export const REPAIR_FRACTION=.25;
export const TOWER_DURATION=ticks(TOWER_SECONDS);
export const TOWER_RANGE=3;
export const TOWER_DAMAGE=12;
export const TOWER_COOLDOWN=ticks(.6);
export const TOWER_HP=80;
export const MAX_TOWERS=3;
/** Remembered purchase ids; older ones fall off (a resend that late is a new purchase). */
export const HANDLED_LIMIT=256;

export {RECIPES,RECIPE_IDS,type Recipe,type RecipeId} from '../../rules/index.ts';

export type BuyResult=
  | {ok:true;recipe:RecipeId;line:string;item?:string;level?:number;tower?:string}
  | {ok:false;reason:'phase'|'player'|'recipe'|'balance'|'full'|'no-weapon'|'duplicate'|'wall-down'|'away'|'target'|'blocked'};

/**
 * Buys a recipe for the team, validated on the server. Commands are applied one at a time, so two
 * players buying in the same tick are charged in order and the second fails if the balance ran out.
 * A resent command with the same requestId is refused without charging again.
 */
/** Draws from the state's own serializable stream (D-011) so a checkpoint restore replays the same picks. */
export function draw<T>(ctx:SimContext,state:StonewardsState,items:readonly T[]):T{
  const rng=state.rng===null?ctx.rng.fork('structures'):new Rng(state.rng);
  const item=rng.pick(items);
  state.rng=rng.state;
  return item;
}

/**
 * `targetId` (cidade-06) picks what 'reparo' repairs: the wall when omitted (or 'muralha'), else a city barricade by id
 * ('target' when there is none). `onTerrainChanged` gets the cells a rebuilt barricade closes again.
 */
export function buy(ctx:SimContext,state:StonewardsState,playerId:string,recipeId:string,requestId?:string,targetId?:string,onTerrainChanged?:(rect:CellRect)=>void):BuyResult{
  const key=requestId===undefined?undefined:`${playerId}:${requestId}`;
  if(key!==undefined&&state.handled.includes(key))return {ok:false,reason:'duplicate'};
  const result=apply(ctx,state,playerId,recipeId,targetId,onTerrainChanged);
  if(result.ok&&key!==undefined){
    state.handled.push(key);
    if(state.handled.length>HANDLED_LIMIT)state.handled.splice(0,state.handled.length-HANDLED_LIMIT);
  }
  return result;
}

function apply(ctx:SimContext,state:StonewardsState,playerId:string,recipeId:string,targetId:string|undefined,onTerrainChanged:((rect:CellRect)=>void)|undefined):BuyResult{
  if(state.wallDown)return {ok:false,reason:'wall-down'};
  if(ctx.round.phase!=='prepare')return {ok:false,reason:'phase'};
  const player=ctx.players.get(playerId);
  if(!player||!isStanding(player))return {ok:false,reason:'player'};
  if(!Object.hasOwn(RECIPES,recipeId))return {ok:false,reason:'recipe'};
  const recipe=RECIPES[recipeId as RecipeId];
  // A barricade repair is done at that barricade (cidade-06); everything else at the forge.
  const barricade=recipe.id==='reparo'&&targetId!==undefined&&targetId!==state.wall.id?findBarricade(state,targetId):undefined;
  if(recipe.id==='reparo'&&targetId!==undefined&&targetId!==state.wall.id&&!barricade)return {ok:false,reason:'target'};
  // The forge stands in the camp (base-stonewards-mapa): what was gathered out there is spent back home.
  const site=barricade??state.wall;
  if(!(Math.hypot(player.x-site.x,player.y-site.y)<=CAMP_RADIUS))return {ok:false,reason:'away'};
  if(!canPay(state.balance,recipe.cost))return {ok:false,reason:'balance'};
  // Drawn only after validation, so refused purchases do not shift the stream.
  const line=()=>draw(ctx,state,recipe.lines);
  const charge=()=>{state.balance.units-=recipe.cost;};
  if(barricade){
    // A fallen barricade is rebuilt only on a clear mouth: never inside a body (it would trap it in the blocker).
    if(barricade.down&&barricadeOccupied(ctx,barricade))return {ok:false,reason:'blocked'};
    if(!barricade.down&&barricade.hp>=barricade.maxHp)return {ok:false,reason:'full'};
    charge();
    barricade.hp=Math.min(barricade.maxHp,barricade.hp+Math.ceil(barricade.maxHp*REPAIR_FRACTION));
    if(barricade.down){barricade.down=false;setBlocking(ctx.terrain,barricade,onTerrainChanged);}
    ctx.emit({type:'structure',id:barricade.id,hp:barricade.hp,maxHp:barricade.maxHp});
    return {ok:true,recipe:recipe.id,line:line()};
  }
  if(recipe.id==='reparo'){
    const w=state.wall;
    if(w.hp>=w.maxHp)return {ok:false,reason:'full'};
    charge();
    w.hp=Math.min(w.maxHp,w.hp+Math.ceil(w.maxHp*REPAIR_FRACTION));
    ctx.emit({type:'structure',id:w.id,hp:w.hp,maxHp:w.maxHp});
    return {ok:true,recipe:recipe.id,line:line()};
  }
  if(recipe.id==='gambiarra'){
    // Weapons offered in a pending upgrade card are left alone, so that card stays valid.
    const offered=new Set((ctx.offers.get(player.id)??[]).flatMap(o=>o.choices.map(c=>c.itemId)));
    const seen=new Set<string>(offered);
    const options=player.build.weapons.filter(w=>{
      if(seen.has(w.id))return false;
      seen.add(w.id);
      return !isEvolutionId(w.id)&&Number.isInteger(w.level)&&w.level<itemMaxLevel(w.id);
    });
    if(!options.length)return {ok:false,reason:'no-weapon'};
    charge();
    const weapon=draw(ctx,state,options);
    weapon.level++;
    ctx.emit({type:'upgrade',player:player.id,item:weapon.id,level:weapon.level});
    return {ok:true,recipe:recipe.id,line:line(),item:weapon.id,level:weapon.level};
  }
  if(state.towers.length>=MAX_TOWERS)return {ok:false,reason:'full'};
  charge();
  const at=walkable(player,ctx.terrain)?{x:player.x,y:player.y}:{x:state.wall.x,y:state.wall.y};
  const tower={id:ctx.nextId('torre-'),kind:'torre-chinelo' as const,owner:player.id,x:at.x,y:at.y,
    hp:TOWER_HP,maxHp:TOWER_HP,untilTick:ctx.tick+TOWER_DURATION,readyTick:ctx.tick};
  state.towers.push(tower);
  ctx.emit({type:'structure',id:tower.id,hp:tower.hp,maxHp:tower.maxHp});
  return {ok:true,recipe:recipe.id,line:line(),tower:tower.id};
}

/** Ends every tower (e.g. when the wall falls), telling clients they are gone. */
export function clearTowers(ctx:SimContext,state:StonewardsState){
  for(const t of state.towers.splice(0))ctx.emit({type:'structure',id:t.id,hp:0,maxHp:t.maxHp});
}

/** Towers throw chinelos at the nearest live enemy in range, then expire. */
export function towerStep(ctx:SimContext,state:StonewardsState){
  const alive=(e:{id:string;hp:number})=>e.hp>0&&ctx.enemies.has(e.id);
  for(let i=0;i<state.towers.length;i++){
    const t=state.towers[i];
    if(ctx.tick>=t.untilTick){
      state.towers.splice(i--,1);
      ctx.emit({type:'structure',id:t.id,hp:0,maxHp:t.maxHp});
      continue;
    }
    if(ctx.tick<t.readyTick)continue;
    const target=ctx.enemyIndex.nearest(t.x,t.y,TOWER_RANGE,alive);
    if(!target)continue;
    t.readyTick=ctx.tick+TOWER_COOLDOWN;
    const len=Math.hypot(target.x-t.x,target.y-t.y)||1;
    ctx.emit({type:'fire',player:t.owner,weapon:'torre-chinelo',x:t.x,y:t.y,dx:(target.x-t.x)/len,dy:(target.y-t.y)/len});
    ctx.damageEnemy(target.id,TOWER_DAMAGE,t.owner,'torre-chinelo');
  }
}
