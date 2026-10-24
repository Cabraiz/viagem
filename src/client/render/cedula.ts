/**
 * The kill's cédula (NEW-20261024-ORQ-tirar-drops-cedula-girando; the user: "1 segundo depois dele morrer deve aparecer
 * flutuante, que nem o novo item, uma cédula de dinheiro rodando"): a 'grana' pickup (sim/progression.ts) drawn as a
 * banknote that floats and turns like a coin, with the crate item's float and turn (arsenal-rules.ts floatPose /
 * floatSpin, the same speeds) at a note's size, and the same phone legibility (floatLegible).
 * Art by ChatGPT (Codex): the front (a capivara de óculos) and the back (a coxinha) of one stylized note, one frame each;
 * the back shows while the turn faces it away. Without the art: textures.ts's procedural note (pickupTexture('grana')),
 * mirrored on its back. Pure (no Phaser): tested in tests/client/cedula.test.ts.
 */
import {FLOAT_LIFT,floatPose} from './arsenal-rules.ts';

export const CEDULA_ART={key:'horde:pickup:cedula',url:'/art/lite/itens/cedula.webp',cell:[192,102] as const};
/** CSS px at body 1: the note's width and its centre over the ground (its bob scales with it). */
export const CEDULA_PX=54,CEDULA_LIFT=26;
/** It pops in over this long when it appears (reduced motion: just there). */
export const CEDULA_POP_MS=240;
/** A pile (cédulas joined, value in R$) grows a little: × (1 + CEDULA_PILE_GROWTH · log2 value), at most CEDULA_PILE_MAX. */
export const CEDULA_PILE_GROWTH=.1,CEDULA_PILE_MAX=1.5;

export const cedulaPile=(value:number)=>Math.min(CEDULA_PILE_MAX,1+CEDULA_PILE_GROWTH*Math.log2(Math.max(1,value)));
/** Pop-in: 0 → a small overshoot → 1 over CEDULA_POP_MS (ease-out back). */
export function cedulaPop(age:number,reduced=false){
  if(reduced||age>=CEDULA_POP_MS)return 1;
  const t=Math.max(0,age)/CEDULA_POP_MS,c=1.7,u=t-1;
  return Math.max(0,1+(c+1)*u*u*u+c*u*u);
}
/**
 * The note's pose at `now` (ms): `lift` (CSS px over the ground at body 1), `turn` (its width, always > 0), `back` (the
 * back faces us), `scale` (pop-in × pile) and `shadow` (the ground shadow's scale). `angle`: its coin turn (floatSpin).
 */
export function cedulaPose(now:number,born:number,phase:number,angle:number,value:number,reduced=false){
  const pose=floatPose(now,phase,angle,reduced);
  const scale=cedulaPop(now-born,reduced)*cedulaPile(value);
  return {lift:pose.lift*CEDULA_LIFT/FLOAT_LIFT*scale,turn:Math.abs(pose.turn),back:pose.turn<0,scale,shadow:pose.shadow*scale};
}
