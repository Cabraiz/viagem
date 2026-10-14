/**
 * The chaveiro objective's provisional figures as boxes (iso.ts), in metres × M (the hero's 1.75 m is 1.245 u).
 * - The Quadradão 1.0: an old square hatch, generic (no maker, no real model), faded "azul calcinha". It loses its
 *   bumper, mirror, door and hood (CAR_PARTS); the fallen ones lie on the ground around it.
 * - The moto: a generic 125 falling apart, the chaveiro with the delivery bag on his back, Dona Cida on the back seat
 *   with the tray of sweets on her head.
 * Pure data (tested); the renderer turns them with iso.ts boxFaces.
 */
import {M,type Box} from './iso.ts';
import {CAR_PARTS,type CarPart} from './view.ts';

/** The provisional palette of the objective's figures (scenery colours, not the UI tokens). */
export const COLORS=Object.freeze({
  paint:0x7fa7b5,paintPanel:0x8fb3c0,glass:0x5d6f86,tire:0x2b2533,chrome:0x9a9aa0,headlight:0xfff2c0,taillight:0xb8443a,
  engine:0x4a4350,interior:0x3a3344,lid:0x7fa7b5,charger:0xf2ece0,
  moto:0xa8493d,seat:0x2b2533,jacket:0x6b4a33,helmet:0xd9d4c7,jeans:0x4a5a7a,bag:0x4f8a5b,
  dress:0xd77fa1,skin:0xc68e6a,hair:0x3a2a2a,tray:0xa77b4f,brigadeiro:0x4a2c20,pacoca:0xcfae7a,cocada:0xf2ece0,
});
const C=COLORS;
/** Metres → a box in units. */
const m=(x:number,y:number,z:number,l:number,w:number,h:number,color:number,extra?:Partial<Box>):Box=>({x:x*M,y:y*M,z:z*M,l:l*M,w:w*M,h:h*M,color,...extra});

/** Bit of CAR_PARTS in ObjectiveView.car.parts. */
export const partBit=(part:CarPart)=>1<<CAR_PARTS.indexOf(part);
/** The car's half length and half width (units), for its shadow, depth corner and cover box. */
export const CAR_HALF={l:1.85*M,w:.82*M};
/** Height of the car's roof (units): the life bar and the alarm waves sit above it. */
export const CAR_TOP=1.45*M;

/** Where each part sits on the car (it falls from there). */
const PART_ON:Readonly<Record<CarPart,readonly Box[]>>={
  'para-choque':[m(1.86,0,.28,.16,1.64,.22,C.chrome,{layer:1})],
  retrovisor:[m(.62,.9,1.0,.14,.22,.13,C.paint,{layer:2}),m(.62,-.9,1.0,.14,.22,.13,C.paint,{layer:2})],
  porta:[m(.15,.81,.3,1.0,.06,.56,C.paintPanel,{layer:1})],
  capo:[m(1.28,0,.86,.95,1.52,.05,C.paintPanel,{layer:2})],
};
/** Where each fallen part lies on the ground around the car (flat, turned; same order as CAR_PARTS). */
const PART_DOWN:Readonly<Record<CarPart,readonly Box[]>>={
  'para-choque':[m(2.5,.5,0,1.64,.22,.12,C.chrome,{turn:.45})],
  retrovisor:[m(.9,1.55,0,.22,.14,.12,C.paint,{turn:1.1})],
  porta:[m(-.2,1.75,0,1.0,.56,.06,C.paintPanel,{turn:.18})],
  capo:[m(2.7,-1.15,0,.95,1.52,.05,C.paintPanel,{turn:-.5})],
};

export interface CarPose {
  /** Bits of CAR_PARTS that fell (ObjectiveView.car.parts). */
  parts:number;
  /** Hazard lights lit this frame (the alarm blinks). */
  hazard:boolean;
  /** The trunk lid, 0 closed .. 1 open (the end scene); the charger rises with it. */
  trunk:number;
  /** Perda total: darker paint. */
  wrecked:boolean;
}

/** The car's boxes, without the fallen parts (those are carParts' 'down' set). */
export function carBoxes(pose:CarPose):Box[]{
  const paint=pose.wrecked?0x5f7c86:C.paint,lamp=pose.hazard?0xff7a1f:C.headlight,tail=pose.hazard?0xff7a1f:C.taillight;
  const b:Box[]=[
    // wheels (a square hatch: the wheels at the corners)
    m(1.2,.72,0,.62,.22,.62,C.tire),m(-1.2,.72,0,.62,.22,.62,C.tire),m(1.2,-.72,0,.62,.22,.62,C.tire),m(-1.2,-.72,0,.62,.22,.62,C.tire),
    // body, rear bumper, lights (the lights stick out of the body's faces, so the far ones stay hidden behind it)
    m(0,0,.25,3.6,1.6,.6,paint,{layer:1}),m(-1.86,0,.28,.16,1.64,.22,C.chrome,{layer:1}),
    m(1.82,.55,.62,.06,.32,.13,lamp,{bare:true,layer:1}),m(1.82,-.55,.62,.06,.32,.13,lamp,{bare:true,layer:1}),
    m(-1.82,.6,.62,.06,.26,.16,tail,{bare:true,layer:1}),m(-1.82,-.6,.62,.06,.26,.16,tail,{bare:true,layer:1}),
    // the engine shows where the hood fell; the dark hole of the door
    m(1.28,0,.85,.9,1.4,.02,C.engine,{layer:2}),m(.15,.81,.32,.96,.04,.52,C.interior,{layer:1,bare:true}),
    // the square cabin: glass, then the roof
    m(-.3,0,.85,2.0,1.46,.55,C.glass,{layer:2}),m(-.3,0,1.4,2.06,1.5,.07,paint,{layer:3}),
  ];
  for(const part of CAR_PARTS)if(!(pose.parts&partBit(part)))b.push(...PART_ON[part]);
  if(pose.trunk>0){
    // The hatch swings up from the roof's back edge (closed: upright on the back; open: flat over the back); the
    // charger (cable and the wrong plug) comes out of the trunk.
    const t=pose.trunk;
    if(t<.5)b.push(m(-1.88-.3*t,0,.85+.9*t,.06+.8*t,1.44,.55-.8*t,C.lid,{layer:4}));
    else b.push(m(-1.6-.5*t,0,1.42+.15*t,.85,1.44,.06,C.lid,{layer:4}));
    b.push(m(-1.7,0,.9,.08,.08,.35*t+.02,C.tire,{layer:4}),m(-1.7,0,.92+.35*t,.18,.12,.12,C.charger,{layer:4}));
  }
  return b;
}
/** The fallen parts' boxes on the ground (`except`: a part still falling, drawn by the renderer's animation). */
export function fallenParts(parts:number,except=0):Box[]{
  const b:Box[]=[];
  for(const part of CAR_PARTS){const bit=partBit(part);if(parts&bit&&!(except&bit))b.push(...PART_DOWN[part]);}
  return b;
}
/** A part between its place on the car (t = 0) and the ground (t = 1), with a small bounce. */
export function fallingPart(part:CarPart,t:number):Box[]{
  const on=PART_ON[part],down=PART_DOWN[part],k=Math.max(0,Math.min(1,t)),hop=Math.sin(Math.min(1,k*1.25)*Math.PI)*.35*M;
  return on.map((a,i)=>{
    const d=down[Math.min(i,down.length-1)];
    const lerp=(p:number,q:number)=>p+(q-p)*k;
    return {...a,x:lerp(a.x,d.x),y:lerp(a.y,d.y),z:Math.max(0,lerp(a.z,d.z)+hop*(1-k)),l:lerp(a.l,d.l),w:lerp(a.w,d.w),h:lerp(a.h,d.h),turn:(d.turn??0)*k};
  });
}

/** The chaveiro and Cida as the moto's riders, sitting (lift: the moto's bounce, units). */
function riders(lift:number,withChaveiro:boolean):Box[]{
  const r=(x:number,y:number,z:number,l:number,w:number,h:number,color:number,layer:number)=>({...m(x,y,z,l,w,h,color,{layer}),z:z*M+lift});
  const b:Box[]=[];
  if(withChaveiro)b.push(
    r(-.05,0,.78,.5,.36,.15,C.jeans,2),r(-.15,0,.84,.3,.4,.55,C.jacket,3),r(.15,0,1.18,.45,.52,.1,C.jacket,3),
    r(-.12,0,1.38,.3,.3,.3,C.helmet,4),
    // the delivery bag on his back (why he is late)
    r(-.48,0,1.0,.42,.44,.46,C.bag,3));
  b.push(
    r(-.72,0,.78,.42,.38,.15,C.dress,2),r(-.78,0,.84,.3,.42,.55,C.dress,3),r(-.78,0,1.39,.26,.26,.26,C.skin,4),
    r(-.8,0,1.65,.16,.16,.08,C.hair,5),
    // the tray of sweets balanced on her head
    r(-.78,0,1.73,.6,.6,.05,C.tray,6),r(-.66,.12,1.78,.1,.1,.08,C.brigadeiro,7),r(-.9,.12,1.78,.1,.1,.08,C.pacoca,7),
    r(-.78,-.14,1.78,.1,.1,.08,C.cocada,7),r(-.66,-.14,1.78,.1,.1,.08,C.brigadeiro,7));
  return b;
}
/** The 125's own boxes (lift: its bounce, units). */
function motoFrame(lift:number):Box[]{
  const r=(x:number,y:number,z:number,l:number,w:number,h:number,color:number,extra?:Partial<Box>)=>({...m(x,y,z,l,w,h,color,{layer:1,...extra}),z:z*M+lift});
  return [
    m(.65,0,0,.56,.1,.56,C.tire),m(-.65,0,0,.56,.1,.56,C.tire),
    r(-.45,-.18,.3,.5,.08,.08,C.chrome),r(.05,0,.45,1.0,.24,.28,C.moto),r(-.3,0,.73,.75,.28,.1,C.seat),
    r(.48,0,.95,.1,.7,.06,C.chrome),r(.62,0,.82,.08,.16,.13,C.headlight,{bare:true}),
    // the rack under Cida, held with wire
    r(-.75,0,.72,.45,.32,.05,C.chrome),
  ];
}
/** The chaveiro standing (beside the moto at a delivery, or at the car's door opening it): bag in hand when `bag`. */
export function standingChaveiro(x:number,y:number,bag:boolean,toolUp=0):Box[]{
  const b=[m(x,y,0,.3,.38,.85,C.jeans),m(x,y,.85,.3,.42,.58,C.jacket,{layer:1}),m(x,y,1.43,.3,.3,.3,C.helmet,{layer:2})];
  if(bag)b.push(m(x+.35,y,.7,.42,.44,.46,C.bag,{layer:1}));
  // the arm with the tool at the lock (abrindo): it jiggles with toolUp
  else b.push(m(x+.3,y,1.15+.06*toolUp,.35,.12,.1,C.jacket,{layer:2}),m(x+.5,y,1.17+.06*toolUp,.12,.04,.04,C.chrome,{layer:2}));
  return b;
}

export type MotoPose='sitting'|'parked'|'fallen';
/**
 * The moto with its riders. sitting: both on it (riding, stopped, dead); parked: Cida alone on it (he is away:
 * delivering or opening the car); fallen: on its side, the riders sitting on the ground and the sweets spilled.
 */
export function motoBoxes(pose:MotoPose,lift=0):Box[]{
  if(pose==='fallen'){
    const flat:Box[]=motoFrame(0).map(b=>({...b,layer:0,y:-(b.z+b.h/2)*.9,w:b.h,z:Math.max(0,b.y+.12*M),h:Math.max(.04*M,b.w)}));
    return [...flat,
      // the chaveiro sitting on the snow, Cida beside him, the tray upside down and the sweets around
      m(.1,.85,0,.45,.4,.15,C.jeans,{layer:1}),m(-.05,.85,.1,.3,.4,.55,C.jacket,{layer:2}),m(-.05,.85,.65,.3,.3,.3,C.helmet,{layer:3}),
      m(-.75,.9,0,.42,.38,.15,C.dress,{layer:1}),m(-.8,.9,.1,.3,.42,.55,C.dress,{layer:2}),m(-.8,.9,.65,.26,.26,.26,C.skin,{layer:3}),
      m(-1.3,-.2,0,.6,.6,.05,C.tray,{turn:.6}),m(-1.6,.3,0,.1,.1,.08,C.brigadeiro),m(-1.1,-.75,0,.1,.1,.08,C.pacoca),
      m(-1.75,-.4,0,.1,.1,.08,C.cocada),m(.4,-.6,0,.1,.1,.08,C.brigadeiro)];
  }
  return [...motoFrame(lift),...riders(lift,pose==='sitting')];
}
