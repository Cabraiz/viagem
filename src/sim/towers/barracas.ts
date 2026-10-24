/**
 * NEW-20261023-ORQ-barracas-no-caminho (user, 23/10 ~17:40Z): "barracas aleatórias que ficam de ponta a ponta em alguns
 * lugares do jogo". The rows are PieceState kind 'barraca' (free-build.ts: a soft wall, the enemies bash it on their way
 * to the car; the heroes walk through at BARRACA_HERO_SLOW) with owner TRALHA_OWNER, collected and destroyed like the
 * barricada de tralha (tralha.ts).
 * - Laid once (TowersState.tralha.barracas), on the first step of a city run with the car, after the tralha: BARRACA_ROWS
 *   rows, row g on the shortest walk to the car from a source (free-build wayCells: the streets the critters take):
 *   the living nests in mode 'ninhos' (BARRACA_ROWS of them drawn by the run's rng), else the four spawns; the
 *   run's rng: where on it, BARRACA_ROW_AT of its length from the car). The row runs ACROSS the walk there (its
 *   direction over a few cells decides: an east-west street gets a north-south row), from the start square both ways,
 *   square by square, until a wall or BARRACA_ROW_MAX squares: "de ponta a ponta" of the street.
 * - A square is skipped off walkable ground, over another piece, within UNO_BUILD_CELLS (+1) of the car's body, within
 *   CAR_NEST_KEEP_OUT of a living nest, or where, with the barracas counted as walls, the car would be cut off from a
 *   spawn or the moto: the rows never shut the map (the enemies may bash through, the heroes may walk around).
 */
import {CAR_NEST_KEEP_OUT} from '../../contract/index.ts';
import {BARRACA_ROWS,BARRACA_ROW_AT,BARRACA_ROW_MAX,FREE_PIECE_DEFS,UNO_BUILD_CELLS} from '../../rules/index.ts';
import type {SimContext} from '../context.ts';
import type {StonewardsState} from '../stonewards/state.ts';
import {towersOf} from './system.ts';
import {FREE_CELL,blockDisc,locks,onGround,pieceRect,pieceRectOf,rectsOverlap,setMuro,wayCells,type PieceState} from './free-build.ts';
import {TRALHA_OWNER,type TralhaWorld} from './tralha.ts';

export const BARRACA_PREFIX='barraca';
/** Flow cells each way along the walk that tell the street's direction at a row. */
const WAY_LOOK=3;
const gap=(r:{x:number;y:number;w:number;h:number},p:{x:number;y:number})=>Math.hypot(Math.max(r.x-p.x,0,p.x-(r.x+r.w)),Math.max(r.y-p.y,0,p.y-(r.y+r.h)));

/** Lays the map's barracas once (see the header); returns the barracas laid (0 when already done). */
export function placeBarracas(ctx:SimContext,state:StonewardsState,world:TralhaWorld):number{
  const towers=towersOf(state),t=towers.tralha??={};
  if(t.barracas)return 0;
  t.barracas=true;
  const {city,car}=world,P=city.asset.points,spawns=[P.spawnN,P.spawnS,P.spawnL,P.spawnO];
  const rng=ctx.rng.fork('barracas'),def=FREE_PIECE_DEFS.barraca,[n]=def.footprint,keep=car.radius+(UNO_BUILD_CELLS+1)*FREE_CELL;
  const pieces=towers.pieces??=[];
  const discs:{x:number;y:number;r:number}[]=[];
  let laid=0;
  const fits=(cell:{c:number;r:number})=>{
    if(!onGround(city,cell,n,n))return false;
    const rect=pieceRect(cell,n,n);
    if(gap(rect,car)<keep)return false;
    if(pieces.some(p=>rectsOverlap(pieceRectOf(p),rect)))return false;
    for(const nest of world.nests??[])if(gap(rect,nest)<CAR_NEST_KEEP_OUT)return false;
    return !locks(city,state,cell,car,world.moto,n,n,discs);
  };
  const lay=(cell:{c:number;r:number})=>{
    const rect=pieceRect(cell,n,n);
    const p:PieceState={id:ctx.nextId(BARRACA_PREFIX),kind:'barraca',cell,owner:TRALHA_OWNER,x:rect.x+rect.w/2,y:rect.y+rect.h/2,
      hp:def.hp,maxHp:def.hp,startTick:ctx.tick,readyTick:ctx.tick};
    pieces.push(p);discs.push(blockDisc(cell,n,n));setMuro(city,p,false,world.onTerrainChanged);laid++;
  };
  // Where the critters come from: the living nests (a draw of BARRACA_ROWS of them, in their order), else the spawns.
  const nests=[...world.nests??[]];
  for(let i=nests.length-1;i>0;i--){const j=rng.int(0,i);[nests[i],nests[j]]=[nests[j],nests[i]];}
  const sources=nests.length?nests:spawns;
  for(let g=0;g<BARRACA_ROWS;g++){
    const s=sources[g%sources.length],at=rng.range(BARRACA_ROW_AT[0],BARRACA_ROW_AT[1]),way=wayCells(city,s,car);
    if(way.length<2)continue;
    // `way` runs spawn → car: the point `at` of its length from the car, and the street's direction there (±WAY_LOOK cells).
    const k=Math.round((way.length-1)*(1-at)),p=way[k],q0=way[Math.max(0,k-WAY_LOOK)],q1=way[Math.min(way.length-1,k+WAY_LOOK)];
    // The row runs across the street: an east-west one (longer in x) gets a north-south row.
    const down=Math.abs(q1.x-q0.x)>=Math.abs(q1.y-q0.y),step={c:down?0:n,r:down?n:0};
    const c0=Math.floor(p.x/FREE_CELL),r0=Math.floor(p.y/FREE_CELL);
    let start:{c:number;r:number}|undefined;
    for(let k=0;k<=3&&!start;k++)for(let dr=-k;dr<=k&&!start;dr++)for(let dc=-k;dc<=k&&!start;dc++){
      if(Math.max(Math.abs(dc),Math.abs(dr))!==k)continue;
      const o={c:c0+dc,r:r0+dr};
      if(fits(o))start=o;
    }
    if(!start)continue;
    lay(start);
    // Both ways from the start, alternately, until a wall (or a refused square) ends each side.
    let open=[1,-1],i=1,row=1;
    while(open.length&&row<BARRACA_ROW_MAX){
      const next:number[]=[];
      for(const dir of open){
        if(row>=BARRACA_ROW_MAX)break;
        const cell={c:start.c+dir*i*step.c,r:start.r+dir*i*step.r};
        if(fits(cell)){lay(cell);row++;next.push(dir);}
      }
      open=next;i++;
    }
  }
  return laid;
}
