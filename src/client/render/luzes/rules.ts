/**
 * Muitas luzes (card NEW-20261029-ORQ-muitas-luzes), the pure half: which halos a decor piece lights, where on its art
 * cell, how bright they breathe or blink, and how many the screen can afford. No Phaser here: layer.ts places them.
 *
 * Every halo is a frame of one ChatGPT atlas (public/art/luzes/halos.webp, scripts/import-luzes.mjs): additive, from
 * one texture, so the halos of a depth band batch together. Nothing is drawn by code. The game does not get darker:
 * the lights only add warm points over E5's light sepia fog (render/nevoa.ts).
 */
import {hashId} from '../city/chunks.ts';
import {LIGHT_LOOK,lightHead,lightKind,lightScale,viewIndex,type ArtView,type LightKind} from '../city/live/rules.ts';
import {JANELAS} from './janelas.ts';

interface Pt {x:number;y:number}

/**
 * Over the fog (render/nevoa-rules.ts NEVOA_DEPTH 93900, its bands 93901 and ash 93902), under the apagão (94000),
 * the hero (96500) and the telegraphs (99000). Same value as E5's nevoa-rules LUZES_DEPTH: whoever merges second
 * keeps one of the two.
 */
export const LUZES_DEPTH=93950;

/** The atlas: 3×2 frames of 256 px. */
export const LUZES_ATLAS={key:'luzes:halos',url:'/art/luzes/halos.webp',frame:256} as const;
/** Frames of the atlas, in its order. */
export const LUZ={lamp:0,bloom:1,window:2,cone:3,fire:4,lantern:5} as const;
export type LuzFrame=typeof LUZ[keyof typeof LUZ];
/**
 * The lit core of each frame (alpha > 60) as fractions of the frame, measured on halos.webp: a window glow is sized so
 * its core covers the painted window, not the whole frame.
 */
export const LUZ_CORE:Readonly<Record<LuzFrame,readonly [number,number]>>=Object.freeze({0:[.52,.5],1:[.65,.64],2:[.42,.58],3:[.57,.31],4:[.57,.67],5:[.36,.33]});

/** `?luzes=0` turns the lights off (before × after prints); `?luz=0` (the whole night look off, nevoa-rules) too. */
export function luzesEnabled(search:string):boolean{
  const q=new URLSearchParams(search);
  return q.get('luzes')!=='0'&&q.get('luz')!=='0';
}

export type Flicker='steady'|'breath'|'pisca'|'tv'|'neon';
/**
 * One halo of a piece: `at` on its art cell (fractions), `size` in art px (display width × height), `over` = drawn
 * over the fog (LUZES_DEPTH, the big soft blooms) or with its piece (the small points, hidden by what stands before).
 */
export interface LuzSpot {
  at:readonly [number,number];frame:LuzFrame;size:readonly [number,number];tint:number;alpha:number;flicker:Flicker;over:boolean;
  /** Image origin (default the centre); the headlight cone starts at its lamp. */
  origin?:readonly [number,number];
  /** Radians (the cone follows the car's heading on screen). */
  angle?:number;flipX?:boolean;
}

const WARM=0xffd9a0,AMBER=0xffc070,TV=0xb8d4ff,NEON=0x9fe0ff,RED=0xff5040,WHITE=0xffffff;

/** Windows found on each building sheet (scripts/luzes-janelas.mjs): per view, [x, y, w, h] as fractions of the cell. */
const WINDOWS=JANELAS;
/** Share of the found windows lit (by hash: the same windows every visit). */
export const WINDOW_LIT=.5;
/** A building with this many lit windows also glows into the fog. */
const BLOOM_WINDOWS=3;

const unit=(key:string)=>(hashId(key)%1000)/1000;
const isWall=(id:string)=>/^(muro-pichado|muro-condominio|grade|tapume|alambrado|cerca-madeira)-/.test(id);
/** Sidewalk pieces with a lantern hanging (their lit point near the top of the cell). */
const LANTERNS:Readonly<Record<string,readonly [number,number]>>=Object.freeze({
  'carrinho-pipoca':[.5,.38],'barraca-feira':[.5,.3],'ponto-mototaxi':[.5,.3],'banca-jornal':[.5,.4],
});
/** Lit signs: a soft glow over the fog at the sign (fractions of the cell) and its colour. */
const SIGNS:Readonly<Record<string,{at:readonly [number,number];tint:number;flicker:Flicker}>>=Object.freeze({
  'outdoor-1':{at:[.5,.3],tint:WARM,flicker:'steady'},'outdoor-2':{at:[.5,.3],tint:WARM,flicker:'steady'},
  'lan-house':{at:[.5,.42],tint:NEON,flicker:'neon'},'loterica':{at:[.5,.42],tint:WARM,flicker:'neon'},
  'farmacia':{at:[.5,.42],tint:0xb0ffd0,flicker:'steady'},'boteco-apocaliptico':{at:[.5,.45],tint:AMBER,flicker:'neon'},
});
/** Kombi lights per view (fractions of its cell, measured on kombi-velha-1): headlights and the cone's screen angle, or taillights. */
const KOMBI:Readonly<Record<ArtView,{heads?:readonly (readonly [number,number])[];angle?:number;flip?:boolean;tails?:readonly (readonly [number,number])[]}>>=Object.freeze({
  0:{heads:[[.58,.82],[.77,.77]],angle:Math.atan2(1,2)},
  270:{heads:[[.37,.82],[.53,.77]],angle:-Math.atan2(1,2),flip:true},
  90:{tails:[[.24,.82]]},
  180:{tails:[[.76,.82]]},
});
/** Kind of piece without the variant number (`padaria-1` → `padaria`). */
const family=(id:string)=>id.replace(/-\d+$/,'');

/**
 * The halos of a decor piece in a view. `cell` = its art cell (px); `key` = its decor key (the hash that picks lit
 * windows and lantern walls). Lamps of lit poles, broken lamps and fire barrels keep their own head glow (CityLive,
 * now from the atlas): here they only add the big bloom into the fog.
 */
export function luzSpots(id:string,view:ArtView,cell:readonly [number,number],key:string):LuzSpot[]{
  const out:LuzSpot[]=[],fam=family(id),kind=lightKind(id);
  if(kind){
    const h=lightHead(id,view,cell),r=LIGHT_LOOK[kind].halo*lightScale(kind,cell)*5.5;
    out.push({at:[h[0]/cell[0],h[1]/cell[1]],frame:LUZ.bloom,size:[r,r],tint:WHITE,alpha:kind==='poste'?.32:.26,flicker:kindFlicker(kind),over:true});
    return out;
  }
  const wins=WINDOWS[id]?.[viewIndex(view)];
  if(wins){
    let sx=0,sy=0,n=0;
    wins.forEach((w,i)=>{
      const u=unit(`${key}:w${i}`);
      if(u>=WINDOW_LIT)return;
      // Mostly warm lamps; one window in eight is a TV's cold blink.
      const tv=u<WINDOW_LIT/8,big=Math.max(w[2]*cell[0]/LUZ_CORE[2][0],w[3]*cell[1]/LUZ_CORE[2][1])*1.25;
      out.push({at:[w[0],w[1]],frame:LUZ.window,size:[big*.75,big],tint:tv?TV:i%3?WARM:AMBER,alpha:tv?.7:.85,flicker:tv?'tv':'steady',over:false});
      sx+=w[0];sy+=w[1];n++;
    });
    if(n>=BLOOM_WINDOWS){const r=cell[0]*.8;out.push({at:[sx/n,sy/n],frame:LUZ.bloom,size:[r,r*.8],tint:WARM,alpha:.16,flicker:'steady',over:true});}
  }
  const sign=SIGNS[fam];
  if(sign){const r=cell[0]*.7;out.push({at:sign.at,frame:LUZ.bloom,size:[r,r*.7],tint:sign.tint,alpha:.3,flicker:sign.flicker,over:true});}
  const lantern=LANTERNS[fam];
  if(lantern){
    out.push({at:lantern,frame:LUZ.lantern,size:[70,70],tint:WHITE,alpha:.9,flicker:'breath',over:false});
    out.push({at:lantern,frame:LUZ.bloom,size:[240,200],tint:WARM,alpha:.22,flicker:'breath',over:true});
  }
  if(fam==='kombi-velha'){
    const k=KOMBI[view];
    for(const p of k.heads??[])out.push({at:p,frame:LUZ.lamp,size:[44,44],tint:WHITE,alpha:.9,flicker:'steady',over:false});
    if(k.heads){
      const p=k.heads[0]!,q=k.heads[1]!,mid:[number,number]=[(p[0]+q[0])/2,(p[1]+q[1])/2];
      out.push({at:mid,frame:LUZ.cone,size:[300,160],tint:WHITE,alpha:.45,flicker:'steady',over:true,origin:[.12,.5],angle:k.angle,flipX:k.flip});
    }
    for(const p of k.tails??[])out.push({at:p,frame:LUZ.lamp,size:[36,36],tint:RED,alpha:.8,flicker:'steady',over:false});
  }
  // One wall in ten has a lantern hung at its top.
  if(isWall(id)&&unit(`${key}:lanterna`)<.1){
    out.push({at:[.5,.22],frame:LUZ.lantern,size:[60,60],tint:WHITE,alpha:.9,flicker:'breath',over:false});
    out.push({at:[.5,.22],frame:LUZ.bloom,size:[220,190],tint:WARM,alpha:.2,flicker:'breath',over:true});
  }
  return out;
}

const kindFlicker=(k:LightKind):Flicker=>k==='fogueira'?'breath':k==='pisca'?'pisca':'steady';

/**
 * Brightness (0..1) of a halo at `nowMs`. Breath: a slow double sine (fire, lanterns); TV: shifting brightness with
 * the odd cut; neon: a rare short blink; pisca follows the broken lamp's own level (CityLive passes it as `level`).
 * Reduced motion and the Leve quality keep every light steady.
 */
export function luzLevel(flicker:Flicker,nowMs:number,key:string,reduced:boolean,level=1):number{
  if(flicker==='pisca')return level;
  if(reduced||flicker==='steady')return 1;
  const t=nowMs/1000+(hashId(key)%997)/97;
  if(flicker==='breath')return .85+.1*Math.sin(t*4.1)+.05*Math.sin(t*11.3);
  if(flicker==='tv'){const s=Math.floor(t*3);return (hashId(`${key}:${s}`)%100)<8?.35:.7+.3*((hashId(`${key}:${s}`)>>>8)%100)/100;}
  // neon: off for one tenth of a second about every 4 s.
  return (t%4)<.1||((t+.25)%4)<.06?.25:1;
}

/**
 * Halo groups (one per lit decor piece) the screen draws at once: the nearest to the camera centre win. Leve keeps a
 * few; a phone (coarse pointer) half of a computer's. Each group is 1 to ~12 sprites of one texture.
 */
export const LUZES_BUDGET={leve:12,phone:28,desktop:56} as const;
export function luzesBudget(still:boolean,coarse:boolean):number{
  return still?LUZES_BUDGET.leve:coarse?LUZES_BUDGET.phone:LUZES_BUDGET.desktop;
}

export interface LuzGroupPos {key:string;x:number;y:number}
/** The `budget` groups nearest to (cx, cy), as a set of keys (ties by key: the same pick every frame). */
export function pickGroups(groups:readonly LuzGroupPos[],cx:number,cy:number,budget:number):Set<string>{
  if(groups.length<=budget)return new Set(groups.map(g=>g.key));
  const d=(g:LuzGroupPos)=>(g.x-cx)**2+(g.y-cy)**2;
  return new Set([...groups].sort((a,b)=>d(a)-d(b)||(a.key<b.key?-1:1)).slice(0,budget).map(g=>g.key));
}

/** Fade of a halo entering or leaving the budget (per ms): no light pops on or off. */
export const LUZ_FADE_MS=250;
export const stepFade=(cur:number,target:number,dtMs:number)=>{
  const s=dtMs/LUZ_FADE_MS;
  return target>cur?Math.min(target,cur+s):Math.max(target,cur-s);
};

/** Screen points of the car (projector px): both lamps, the nose's middle and a point ahead of it on the ground. */
export interface FaroisAt {left:Pt;right:Pt;nose:Pt;ahead:Pt;tail:Pt}
export interface FaroisPose {
  /** Lamp points visible (the nose is nearer the screen than the tail). */
  facing:boolean;
  /** The cone's screen angle (radians) and size (px), its origin at the nose. */
  angle:number;length:number;width:number;
  /** Lamp point size (px). */
  lamp:number;
}

/** Uno headlights (farois.ts): cone length and width, lamp size: fractions of the car's screen length (nose to tail). */
const CONE_LEN=2.4,CONE_W=1.1,LAMP=.34;

/** Where the cone points and how big things draw, from the car's screen points (pure, for tests). */
export function faroisPose(at:FaroisAt):FaroisPose{
  const car=Math.max(8,Math.hypot(at.nose.x-at.tail.x,at.nose.y-at.tail.y));
  return {
    facing:at.nose.y>=at.tail.y,
    angle:Math.atan2(at.ahead.y-at.nose.y,at.ahead.x-at.nose.x),
    length:car*CONE_LEN/LUZ_CORE[LUZ.cone][0],width:car*CONE_W,lamp:car*LAMP/LUZ_CORE[LUZ.lamp][0],
  };
}
