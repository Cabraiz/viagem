/**
 * The phone's minimal HUD as geometry (card NEW-20261014-ORQ-hud-mobile-minimo), pure, so node pins its guarantees down
 * the way city/layout.ts does for the desktop's layout: the numbers here are the ones fone.css and explore.css draw
 * (tests/client/hud-mobile-minimo.test.ts reads both files and checks they agree), the zones come from computeZones.
 * - Minimap top-left (wcMinimapSide square at the HUD's 8 px floor), gear top-right (explore.css .explore-config).
 * - Between them, the top band's centre: the level glued to the team's bar (row 1) and the team's fan (portrait: row 2;
 *   landscape: the same row, after the bar). The boss bar, in a boss fight, is one more row under them.
 * - Portrait: the minimap is part of the band (the announcement slot starts under it). Landscape: it floats in the left
 *   EDGE_COLUMN above the joystick, as the desktop's minimap floats (zones.ts ZoneInput.minimap).
 * The real layout is measured in the browser (zones.ts measureZoneInput); this is its reference.
 */
import {computeZones,minimapInBand,orientationOf,right,type Rect,type ScreenZones} from './zones.ts';
import {wcMinimapSide,HUD_FLOOR,HERO_SIDE} from './city/layout.ts';

/** fone.css numbers (checked against the file by the tests). */
export const FONE={
  /** The band starts this far right of the minimap (.rh-top left: --rh-l + --rh-mm + 6px). */
  bandGap:6,
  /** The band ends this far left of the right edge (.rh-top right: --rh-r + 66px): the gear's 48 px and its room. */
  gearRoom:66,
  /** Row 1: the team's bar (a 34 px ficha). The level badge is hidden (BUG-20261023-ORQ-hud-tirar-nivel-e-ninhos): 0 px. */
  row:34,levelWidth:0,
  /** The bar's ficha: grows from 88 px up to 150 px in portrait, 160–180 px in landscape. */
  bar:{portrait:{min:88,max:150},landscape:{min:160,max:180}},
  /** Gap between the band's rows (.rh-top row-gap) and, in landscape, between the bar and the fan (margin-left). */
  rowGap:4,fanGap:12,
  /** The boss bar's own margin over the row gap (fone.css: clear of a caído's seconds under its portrait). */
  bossGap:6,
  /** The fan: a 24 px portrait ring (half the desktop's 44) in a 28 px card, overlapping its neighbours 2 px a side (4 with 5–6). */
  ring:24,card:28,overlap:{upTo4:2,more:4},
  /** The fan's height: the card (ring + 1 px + the 4 px life bar), the ends dropped 3 px and turned (measured ≤ 34). */
  fanHeight:34,
} as const;
/** The desktop's portrait ring, for "50 % menores" (hud.css .rh-member-ring). */
export const DESKTOP_RING=44;

export interface FoneInsets {top:number;right:number;bottom:number;left:number}
const NO_INSETS:FoneInsets={top:0,right:0,bottom:0,left:0};
const floor8=(v:number)=>Math.max(HUD_FLOOR,v);

/** The gear (explore.css .explore-config: 48 px at max(18, safe) from the top-right; ≤ 370 px wide or landscape: 12 / 14). */
export function gearRect(viewport:{width:number;height:number},safe:FoneInsets=NO_INSETS):Rect{
  const tight=viewport.width<=370||viewport.height<=500;
  const r=Math.max(tight?14:18,safe.right),t=Math.max(tight?12:18,safe.top);
  return {x:viewport.width-r-48,y:t,width:48,height:48};
}
/** The minimap: top-left at the HUD's floor (fone.css: top --rh-t, left --rh-l), wcMinimapSide square. */
export function foneMinimapRect(viewport:{width:number;height:number},safe:FoneInsets=NO_INSETS):Rect{
  const s=wcMinimapSide(viewport);
  return {x:floor8(safe.left),y:floor8(safe.top),width:s,height:s};
}
/** The fan's width for n players (each card 28 px, overlapping its neighbours). */
export function fanWidth(players:number){
  const n=Math.max(1,Math.min(6,Math.round(players))),o=n>4?FONE.overlap.more:FONE.overlap.upTo4;
  return n*(FONE.card-2*o)+2*o;
}

export interface FoneLayout {
  orientation:'portrait'|'landscape';
  minimap:Rect;gear:Rect;
  /** The band's centre column (between the minimap and the gear). */
  band:Rect;
  /** Row 1: level + bar, centred in the band. */
  level:Rect;bar:Rect;
  /** The team's fan. */
  fan:Rect;
  /** The boss bar's row, in a boss fight. */
  boss?:Rect;
  zones:ScreenZones;
  /** The hero's box: the follow camera puts the body at the viewport centre (BUG-20261013-ORQ-camera-centro-heroi). */
  hero:Rect;
}
export interface FoneLayoutInput {
  viewport:{width:number;height:number};safe?:FoneInsets;players:number;boss?:boolean;
  /** The thumb controls as measured (joystick, skill), for the useful area. */
  joystick?:Rect;skill?:Rect;
}

export function foneLayout(input:FoneLayoutInput):FoneLayout{
  const {viewport}=input,safe=input.safe??NO_INSETS,orientation=orientationOf(viewport);
  const minimap=foneMinimapRect(viewport,safe),gear=gearRect(viewport,safe);
  const bx=floor8(safe.left)+minimap.width+FONE.bandGap,bRight=viewport.width-floor8(safe.right)-FONE.gearRoom;
  const band={x:bx,y:floor8(safe.top),width:Math.max(0,bRight-bx),height:0};
  const k=FONE.bar[orientation],fan=fanWidth(input.players);
  let level:Rect,bar:Rect,fanRect:Rect,bottomY:number;
  if(orientation==='portrait'){
    const w=Math.max(0,Math.min(k.max,band.width-FONE.levelWidth)),row=FONE.levelWidth+w,x=band.x+(band.width-row)/2;
    level={x,y:band.y,width:FONE.levelWidth,height:FONE.row};bar={x:x+FONE.levelWidth,y:band.y,width:w,height:FONE.row};
    fanRect={x:band.x+(band.width-fan)/2,y:band.y+FONE.row+FONE.rowGap,width:fan,height:FONE.fanHeight};
    bottomY=fanRect.y+fanRect.height;
  }else{
    const row=FONE.levelWidth+k.max+FONE.fanGap+fan,x=band.x+(band.width-row)/2;
    level={x,y:band.y,width:FONE.levelWidth,height:FONE.row};bar={x:x+FONE.levelWidth,y:band.y,width:k.max,height:FONE.row};
    fanRect={x:right(bar)+FONE.fanGap,y:band.y,width:fan,height:FONE.fanHeight};
    bottomY=band.y+Math.max(FONE.row,FONE.fanHeight);
  }
  const boss=input.boss?{x:band.x,y:bottomY+FONE.rowGap+FONE.bossGap,width:band.width,height:40}:undefined;
  band.height=(boss?boss.y+boss.height:bottomY)-band.y;
  // Standing: the minimap is a status row of the band (the slot under it); lying down: it floats (trims nothing).
  const status=[gear,level,bar,fanRect,boss,...(minimapInBand(viewport)?[minimap]:[])];
  const zones=computeZones({viewport,safe,status,joystick:input.joystick,skill:input.skill,minimap});
  const hero={x:Math.round(viewport.width/2-HERO_SIDE/2),y:Math.round(viewport.height/2-HERO_SIDE/2),width:HERO_SIDE,height:HERO_SIDE};
  return {orientation,minimap,gear,band,level,bar,fan:fanRect,...(boss?{boss}:{}),zones,hero};
}

/**
 * The --rh-coluna the HUD writes from the team strip's width (NEW-UX-nome-do-time-na-coluna): the desktop's column only.
 * On the phone the strip is the fan inside the top band (as wide as the band), not a column: no value (hud.css falls
 * back to 54 px and fone.css starts the windows at the left edge), or the 125 % combat strip would be squeezed.
 */
export const teamColumnVar=(phone:boolean,teamWidth:number):string|undefined=>phone?undefined:`${Math.ceil(teamWidth)}px`;

/**
 * The phone's footer as explore.css and inventory.css draw it (BUG-20261024-ORQ-joystick-maior-inventario-direita, after
 * BUG-20261022-ORQ-hud-mobile-rodape): the stick at the left, the attack at the right, both 20 % bigger than the
 * desktop's (tokens.css --controle-fone) and centred on one axis; the inventory a column right-aligned with the attack,
 * RODAPE.lift px above it, only the filled slots, 3 a row, rows from the bottom up (slots 1–3, the weapons, next to the
 * thumb). A slot's tap area stays RODAPE.hit px. `coluna` is inventory.css --inv-coluna: the room it keeps above the
 * attack (two rows and the lift), by which Dona Cida's button, the emotes and the combat offer go up.
 */
export const RODAPE={
  /** tokens.css --controle-fone: the phone's stick and attack over the desktop's 112/96 px and 14 + 80 × scale. */
  scale:1.2,
  /** explore.css .explore-controls padding and --joystick / --joystick-justo; ≤ 370 px wide or landscape: the tight values. */
  pad:{x:24,y:24},tightPad:{x:18,y:16},stick:112*1.2,tightStick:96*1.2,
  /** inventory.css: the gap over the attack (12 px, the hand slot's 1.1 lift fits), the slot's side and gap. */
  lift:12,slot:34,tightSlot:32,gap:4,tightGap:3,perRow:3,hit:44,handScale:1.1,
} as const;
/** --botao-habilidade on the phone (tokens.css): the desktop's 94 px × 1.2, or 14 + 80 × text scale when that is bigger. */
export const foneSkillSide=(scale=1)=>Math.max(94*RODAPE.scale,14+80*scale);
export interface FoneFooter {stick:Rect;attack:Rect;box:Rect;slots:Rect[];slotSide:number;coluna:number}
export function foneFooter(input:{viewport:{width:number;height:number};safe?:FoneInsets;scale?:number;items:number}):FoneFooter{
  const {viewport}=input,safe=input.safe??NO_INSETS,k=RODAPE;
  const tight=viewport.width<=370||viewport.height<=500;
  const pad=tight?k.tightPad:k.pad,stickSide=tight?k.tightStick:k.stick,skillSide=foneSkillSide(input.scale??1);
  const left=Math.max(pad.x,safe.left),rightPad=Math.max(pad.x,safe.right),bottomPad=Math.max(pad.y,safe.bottom);
  const axis=viewport.height-bottomPad-Math.max(stickSide,skillSide)/2;
  const stick={x:left,y:axis-stickSide/2,width:stickSide,height:stickSide};
  const attack={x:viewport.width-rightPad-skillSide,y:axis-skillSide/2,width:skillSide,height:skillSide};
  const gap=tight?k.tightGap:k.gap,side=tight?k.tightSlot:k.slot;
  const n=Math.max(0,Math.min(6,Math.round(input.items))),rows=Math.ceil(n/k.perRow);
  const colRight=right(attack),colBottom=attack.y-k.lift,colWidth=Math.max(skillSide,k.perRow*side+(k.perRow-1)*gap);
  const slots:Rect[]=[];
  for(let i=0;i<n;i++){
    const row=Math.floor(i/k.perRow),inRow=Math.min(k.perRow,n-row*k.perRow),col=i-row*k.perRow;
    const x0=colRight-(inRow*side+(inRow-1)*gap);
    slots.push({x:x0+col*(side+gap),y:colBottom-(row+1)*side-row*gap,width:side,height:side});
  }
  const boxHeight=rows?rows*side+(rows-1)*gap:0;
  const box={x:colRight-colWidth,y:colBottom-boxHeight,width:colWidth,height:boxHeight};
  return {stick,attack,box,slots,slotSide:side,coluna:2*side+gap+k.lift};
}
