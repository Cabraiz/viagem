/**
 * Minimap WC3: what the frame loop (rescue.ts) hands the minimap at ≤ 10 Hz. Picks the frame (the whole city; a window
 * around the hero on the endless map, its terrain built again when the hero walks a quarter of it away; the island),
 * the ally colours (by join order), the hero's heading (from its last steps) and the marks, into reused buffers.
 */
import {cameraQuad,cityFrame,windowFrame,type MiniFrame,type Pt} from './geometry.ts';
import {cityTerrainImage,endlessTerrainImage,islandTerrainImage,type TerrainImage} from './terrain.ts';
import {isAsleep} from '../../render/wake-rules.ts';
import {teamColor,type MmAlly,type MmEnemy,type MmExtra,type MmStructure,type WcMinimap} from './minimap.ts';
import type {CityAsset as MapsCityAsset,TerrainField} from '../../../maps/index.ts';

/** Logical side of the drawing (the canvas scales it to the element's size). */
export const MM_SIDE=120;
/** The endless map's window: world units across, and how far the hero walks before the terrain is built again. */
export const ENDLESS_SPAN=110,ENDLESS_REBUILD=ENDLESS_SPAN/4,ENDLESS_UNIT=.75;
/** A wall hit in the last this many ms blinks the base. */
export const BASE_HIT_BLINK_MS=1500;

export interface MmPlayer {id:string;x:number;y:number;online:boolean;spectator?:boolean}
export interface MmState {downed?:unknown;eliminated?:boolean}
/** `ninho` (D-051): drawn only once `seen` (the fog: someone in the team has seen it), its roof by `size`. */
export interface MmStructureView {kind:string;x:number;y:number;phase?:string;size?:string;seen?:boolean}
export interface DriverInput {
  minimap:WcMinimap;terrain:TerrainField;city?:MapsCityAsset;view:number;nowMs:number;
  selfId:string;self:Pt;players:readonly MmPlayer[];states:ReadonlyMap<string,MmState>;
  enemies:Iterable<{x:number;y:number;hp?:number;boss?:boolean}>;structures:readonly MmStructureView[];
  /** The viewport's world corners (city/wiring.ts screenCorners). */
  corners:readonly Pt[];wallHitAt:number;extras?:readonly MmExtra[];
}

/** How the terrain images are made (canvas in the browser; the tests pass stand-ins). */
export interface TerrainImages {city:typeof cityTerrainImage;endless:typeof endlessTerrainImage;island:typeof islandTerrainImage}
const IMAGES:TerrainImages={city:cityTerrainImage,endless:endlessTerrainImage,island:islandTerrainImage};

export class WcMinimapDriver {
  private readonly images:TerrainImages;
  constructor(images:TerrainImages=IMAGES){this.images=images;}
  private endless?:{image:TerrainImage;center:Pt;terrain:TerrainField};
  private island?:{image:TerrainImage;terrain:TerrainField};
  private last?:Pt;private heading={x:0,y:1};
  private readonly allies:MmAlly[]=[];private readonly enemies:MmEnemy[]=[];private readonly structures:MmStructure[]=[];

  private players:readonly {id:string}[]=[];
  /** A player's colour (teamColor: their place in the run's list, as the team strip shows it). */
  colorOf(id:string){return teamColor(this.players,id);}
  frameFor(input:Pick<DriverInput,'terrain'|'city'|'view'|'self'>):{frame:MiniFrame;terrain:TerrainImage;border?:{x:number;y:number;w:number;h:number}}{
    const {terrain,city,view,self}=input;
    if(city)return {frame:cityFrame(city.size,MM_SIDE,view,city.playable),terrain:this.images.city(city),border:city.playable};
    if(terrain.chunks){
      let e=this.endless;
      if(!e||e.terrain!==terrain||Math.hypot(self.x-e.center.x,self.y-e.center.y)>ENDLESS_REBUILD){
        const center={x:Math.round(self.x),y:Math.round(self.y)};
        e=this.endless={image:this.images.endless(terrain,center,ENDLESS_SPAN*1.5,ENDLESS_UNIT),center,terrain};
      }
      return {frame:windowFrame(self,MM_SIDE,view,ENDLESS_SPAN),terrain:e.image};
    }
    if(!this.island||this.island.terrain!==terrain)this.island={image:this.images.island(terrain),terrain};
    return {frame:windowFrame({x:12,y:12},MM_SIDE,view,30),terrain:this.island.image};
  }
  draw(input:DriverInput){
    const {frame,terrain,border}=this.frameFor(input),me=input.self;
    if(this.last){const dx=me.x-this.last.x,dy=me.y-this.last.y;if(Math.hypot(dx,dy)>.05){const l=Math.hypot(dx,dy);this.heading={x:dx/l,y:dy/l};}}
    this.last={x:me.x,y:me.y};
    this.players=input.players;
    let n=0;
    for(const p of input.players){
      if(p.id===input.selfId||p.spectator)continue;
      const st=input.states.get(p.id);if(st?.eliminated)continue;
      const downed=!!st?.downed;if(!downed&&!p.online)continue;
      const a=this.allies[n]??={x:0,y:0,color:''};n++;a.x=p.x;a.y=p.y;a.color=this.colorOf(p.id);a.downed=downed||undefined;
    }
    this.allies.length=n;
    let m=0;
    // D-051: a nest's sleepers stay off the dots (the nest mark stands for them) until they wake.
    for(const e of input.enemies){if((e.hp??1)<=0||isAsleep(e))continue;const q=this.enemies[m]??={x:0,y:0};m++;q.x=e.x;q.y=e.y;q.boss=e.boss||undefined;}
    this.enemies.length=m;
    let s=0;
    const hit=input.nowMs-input.wallHitAt<BASE_HIT_BLINK_MS;
    for(const st of input.structures){
      if(st.kind==='ninho'){
        if(!st.seen)continue;
        const q=this.structures[s]??={x:0,y:0,kind:'nest'};s++;q.x=st.x;q.y=st.y;q.kind='nest';q.hit=undefined;
        q.size=st.size==='P'||st.size==='G'?st.size:'M';continue;
      }
      const kind=st.kind==='muralha'?'base':st.kind==='barricade'||st.kind.startsWith('barricada')?'barricade':'tower';
      const q=this.structures[s]??={x:0,y:0,kind:'tower'};s++;q.x=st.x;q.y=st.y;q.kind=kind;q.hit=kind==='base'&&hit||undefined;q.size=undefined;
    }
    this.structures.length=s;
    input.minimap.render({frame,terrain,border,camera:input.corners.length===4?cameraQuad(input.corners,frame):undefined,
      self:{x:me.x,y:me.y,dx:this.heading.x,dy:this.heading.y},allies:this.allies,enemies:this.enemies,structures:this.structures,
      extras:input.extras,nowMs:input.nowMs});
  }
}
