/**
 * NEW-20261021-ORQ-barricada-construir part 2 (user, 21/10 ~00h10): barricadas de tralha already on the map. The squares
 * are PieceState kind 'barricada' (free-build.ts: blockers to the enemies, bashed only when a body is cut off from the
 * car, the car's 6 s alert); the map's own have owner TRALHA_OWNER.
 * - Laid once (TowersState.tralha.placed), on the first step of a city run with the car: TRALHA_GROUPS straight rows of
 *   up to TRALHA_GROUP_CELLS squares (BARRICADA_CELLS × BARRICADA_CELLS cells each, barricada-2x), each on the line from the car to a spawn (the run's rng: where on it, which way the
 *   row runs). A square is skipped off walkable ground, over another piece, within UNO_BUILD_CELLS (+1) of the car's
 *   body, within CAR_NEST_KEEP_OUT of a living nest or where it would lock the car off a spawn or the moto (free-build
 *   locks). So the map never starts shut.
 * - destruir: a standing hero within TRALHA_REACH of any barricada square removes it at once and gets DESTRUIR_PIX R$.
 * - coletar: the hero must stand by it COLETAR_SECONDS; a hit (hp below where it started), walking out of reach, falling
 *   or the square going first cancels. Done: the square is removed and the hero gets a kit:barricada (the kit's place
 *   builds it again, free, every free-build rule). CARREGA_MAX kits at most ('cheio'); one coleta per hero and per square.
 *   The outcomes of the tick are drained by the room ({t:'coleta'} to the collector).
 * NEW-20261023-ORQ-barracas-no-caminho: the map's barracas (towers/barracas.ts) are collected and destroyed the same way;
 * the coleta gives the kit of the piece's kind (kit:barraca).
 * Everything here is JSON-safe in TowersState.tralha (checkpoints, stateHash).
 */
import {type CellRect,type CityTerrain,type Point,type TerrainField} from '../../maps/index.ts';
import {CAR_NEST_KEEP_OUT,ticks,type SimPlayer} from '../../contract/index.ts';
import {BARRICADA_CELLS,CARREGA_MAX,COLETAR_SECONDS,DESTRUIR_PIX,FREE_PIECE_DEFS,TRALHA_GROUPS,TRALHA_GROUP_CELLS,TRALHA_REACH,UNO_BUILD_CELLS} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import type {StonewardsState} from '../stonewards/state.ts';
import {isStanding} from '../revive.ts';
import {addGrana} from '../wallet.ts';
import {towersOf} from './system.ts';
import {FREE_CELL,locks,onGround,pieceRect,pieceRectOf,rectsOverlap,setMuro,type PieceState} from './free-build.ts';

export const TRALHA_OWNER='mapa';
export const TRALHA_PREFIX='tralha';
export type TralhaRefusal='player'|'nada'|'longe'|'cheio'|'ocupado';
export interface Coleta {player:string;piece:string;until:number;hp:number;req?:number}
/** `barracas`: the map's barracas were laid (towers/barracas.ts placeBarracas). */
export interface TralhaState {placed?:true;barracas?:true;coletas?:Coleta[]}
/** The map pieces a hero collects or destroys (the barricada de tralha, the barraca). */
export type TralhaKind='barricada'|'barraca';
export const isTralhaKind=(kind:string):kind is TralhaKind=>kind==='barricada'||kind==='barraca';
/** A coleta that ended this tick: done (the kit given) or why not. */
export interface ColetaOutcome {player:string;piece:string;req?:number;ok:boolean;reason?:'apanhou'|'longe'|'sumiu'|'caiu'|'cheio'}

const tralhaOf=(state:StonewardsState)=>state.defenses;
const gap=(r:{x:number;y:number;w:number;h:number},p:Point)=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));

export interface TralhaWorld {
  city:CityTerrain;car:{x:number;y:number;radius:number};moto?:Point;nests?:readonly Point[];
  onTerrainChanged?:(rect:CellRect)=>void;
}
/** Lays the map's barricadas once (see the header); returns the squares laid (0 when already done). */
export function placeTralha(ctx:SimContext,state:StonewardsState,world:TralhaWorld):number{
  const towers=towersOf(state);
  if(towers.tralha?.placed)return 0;
  (towers.tralha??={}).placed=true;
  const {city,car}=world,P=city.asset.points,spawns=[P.spawnN,P.spawnS,P.spawnL,P.spawnO];
  const rng=ctx.rng.fork('tralha'),def=FREE_PIECE_DEFS.barricada,keep=car.radius+(UNO_BUILD_CELLS+1)*FREE_CELL,n=BARRICADA_CELLS;
  const pieces=towers.pieces??=[];
  let laid=0;
  const fits=(cell:{c:number;r:number})=>{
    if(!onGround(city,cell,n,n))return false;
    const rect=pieceRect(cell,n,n);
    if(gap(rect,car)<keep)return false;
    if(pieces.some(p=>rectsOverlap(pieceRectOf(p),rect)))return false;
    for(const n of world.nests??[])if(gap(rect,n)<CAR_NEST_KEEP_OUT)return false;
    return !locks(city,state,cell,car,world.moto,n,n);
  };
  for(let g=0;g<TRALHA_GROUPS;g++){
    const s=spawns[g%spawns.length],t=rng.range(.3,.7),across=rng.chance(.5);
    const at={x:car.x+(s.x-car.x)*t,y:car.y+(s.y-car.y)*t};
    let start:{c:number;r:number}|undefined;
    const c0=Math.floor(at.x/FREE_CELL),r0=Math.floor(at.y/FREE_CELL);
    for(let k=0;k<=3&&!start;k++)for(let dr=-k;dr<=k&&!start;dr++)for(let dc=-k;dc<=k&&!start;dc++){
      if(Math.max(Math.abs(dc),Math.abs(dr))!==k)continue;
      const o={c:c0+dc,r:r0+dr};
      if(fits(o))start=o;
    }
    if(!start)continue;
    for(let i=0;i<TRALHA_GROUP_CELLS;i++){
      const cell={c:start.c+(across?i*n:0),r:start.r+(across?0:i*n)};
      if(!fits(cell))break;
      const rect=pieceRect(cell,n,n);
      const p:PieceState={id:ctx.nextId(TRALHA_PREFIX),kind:'barricada',cell,owner:TRALHA_OWNER,x:rect.x+rect.w/2,y:rect.y+rect.h/2,
        hp:def.hp,maxHp:def.hp,startTick:ctx.tick,readyTick:ctx.tick};
      pieces.push(p);setMuro(city,p,false,world.onTerrainChanged);laid++;
    }
  }
  return laid;
}

/** The barricada square or barraca `id` a standing hero reaches, or why not. */
function reachable(state:StonewardsState,p:SimPlayer|undefined,id:string):{piece:PieceState;index:number}|TralhaRefusal{
  if(!p||p.spectator||!isStanding(p))return 'player';
  const list=tralhaOf(state)?.pieces??[],index=list.findIndex(q=>q.id===id&&isTralhaKind(q.kind));
  if(index<0)return 'nada';
  if(gap(pieceRectOf(list[index]),p)>TRALHA_REACH)return 'longe';
  return {piece:list[index],index};
}

/** DESTRUIR: the square goes at once and the hero gets DESTRUIR_PIX R$. */
export function destruir(ctx:SimContext,terrain:TerrainField|undefined,state:StonewardsState,playerId:string,id:string,onTerrainChanged?:(rect:CellRect)=>void):{ok:true;pix:number}|{ok:false;reason:TralhaRefusal}{
  const p=ctx.players.get(playerId),got=reachable(state,p,id);
  if(typeof got==='string')return {ok:false,reason:got};
  tralhaOf(state)!.pieces!.splice(got.index,1);
  setMuro(terrain,got.piece,true,onTerrainChanged);
  ctx.emit({type:'structure',id,hp:0,maxHp:got.piece.maxHp});
  addGrana(p!,DESTRUIR_PIX);
  return {ok:true,pix:DESTRUIR_PIX};
}

/** COLETAR: starts the hero's coleta of the square (done COLETAR_SECONDS later, see coletaStep). */
export function coletar(ctx:SimContext,state:StonewardsState,playerId:string,id:string,carrying:number,req?:number):{ok:true;until:number}|{ok:false;reason:TralhaRefusal}{
  const p=ctx.players.get(playerId),got=reachable(state,p,id);
  if(typeof got==='string')return {ok:false,reason:got};
  if(carrying>=CARREGA_MAX)return {ok:false,reason:'cheio'};
  const t=tralhaOf(state)!.tralha??={},list=t.coletas??=[];
  if(list.some(c=>c.player===playerId||c.piece===id))return {ok:false,reason:'ocupado'};
  const until=ctx.tick+ticks(COLETAR_SECONDS);
  list.push({player:playerId,piece:id,until,hp:p!.hp,...(req!==undefined?{req}:{})});
  return {ok:true,until};
}

/** The coletas of a hero (the HUD's bar), by player id. */
export const coletasOf=(state:StonewardsState):readonly Coleta[]=>tralhaOf(state)?.tralha?.coletas??[];

/**
 * Runs the coletas: cancelled by a hit, by walking out of reach, by falling or when the square is gone; done at `until`
 * (the square removed, `give` hands the kit of its kind: false = no room, 'cheio'). Returns this tick's outcomes.
 */
export function coletaStep(ctx:SimContext,terrain:TerrainField|undefined,state:StonewardsState,give:(p:SimPlayer,kind:TralhaKind)=>boolean,onTerrainChanged?:(rect:CellRect)=>void):ColetaOutcome[]{
  const t=tralhaOf(state)?.tralha,list=t?.coletas;
  if(!list?.length)return [];
  const out:ColetaOutcome[]=[];
  const end=(c:Coleta,ok:boolean,reason?:ColetaOutcome['reason'])=>out.push({player:c.player,piece:c.piece,...(c.req!==undefined?{req:c.req}:{}),ok,...(reason?{reason}:{})});
  t!.coletas=list.filter(c=>{
    const p=ctx.players.get(c.player),got=reachable(state,p,c.piece);
    if(got==='player'){end(c,false,'caiu');return false;}
    if(got==='nada'){end(c,false,'sumiu');return false;}
    if(got==='longe'||typeof got==='string'){end(c,false,'longe');return false;}
    if(p!.hp<c.hp){end(c,false,'apanhou');return false;}
    if(ctx.tick<c.until)return true;
    if(!give(p!,got.piece.kind as TralhaKind)){end(c,false,'cheio');return false;}
    tralhaOf(state)!.pieces!.splice(got.index,1);
    setMuro(terrain,got.piece,true,onTerrainChanged);
    ctx.emit({type:'structure',id:c.piece,hp:0,maxHp:got.piece.maxHp});
    end(c,true);
    return false;
  });
  if(!t!.coletas.length)delete t!.coletas;
  return out;
}
