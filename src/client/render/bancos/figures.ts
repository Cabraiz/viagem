/**
 * The bank's provisional figure (card bancos-e-veiculos), boxes in metres × M like the chaveiro's (render/chaveiro):
 * a "Caixa 24 h" kiosk on a concrete slab, its screen and keypad on the front (+x), snow on its roof, and a pole with
 * the bank's sign in its colour (never a real brand). Pure data (tested); the renderer turns it with iso.ts boxFaces.
 * The final art comes from the user's tool (design/proximos).
 */
import {M,type Box} from '../chaveiro/iso.ts';
import type {BankName} from '../../../contract/index.ts';
import type {ScreenLook} from './rules.ts';

export const BANK_COLORS=Object.freeze({
  slab:0x9a968e,body:0x8d8f99,bodyDark:0x6f7180,keypad:0x3a3344,slot:0x2b2533,snow:0xf2f4f6,pole:0x5d5a66,
  screen:Object.freeze({azul:0x3c6fa8,verde:0x4f9a5b,vermelho:0xc0443a,apagado:0x2b2533} as Record<ScreenLook,number>),
  sign:Object.freeze({'pao-duro':0xe0b84a,juros:0x8a63b8,posto:0xd9763a} as Record<BankName,number>),
  note:0x7fc28a,
});
const C=BANK_COLORS;
const m=(x:number,y:number,z:number,l:number,w:number,h:number,color:number,extra?:Partial<Box>):Box=>({x:x*M,y:y*M,z:z*M,l:l*M,w:w*M,h:h*M,color,...extra});

/** The kiosk's height (units): the sign, its name and the balloons sit above it. */
export const ATM_TOP=2.6*M;
/** Half its footprint (units), for the shadow and the cover box. */
export const ATM_HALF={l:.7*M,w:.6*M};
/** Where the screen's centre is (forward, left, up in units): the screen's text and the notes leave from there. */
export const SCREEN_AT={fwd:.36*M,left:0,z:1.22*M};

/** The kiosk's boxes, its screen in `look`; the sign in the bank's colour. */
export function atmBoxes(name:BankName,look:ScreenLook):Box[]{
  return [
    m(0,0,0,1.4,1.2,.1,C.slab),
    m(0,0,.1,.7,.62,1.65,C.body,{layer:1}),
    m(-.05,0,1.75,.8,.72,.08,C.snow,{layer:2}),
    // the face: a dark frame, the screen in it, the keypad and the note slot under it
    m(.36,0,1.0,.04,.5,.42,C.bodyDark,{layer:2}),
    m(.385,0,1.05,.02,.42,.32,C.screen[look],{layer:3}),
    m(.39,0,.72,.12,.32,.06,C.keypad,{layer:2}),
    m(.37,0,.86,.03,.3,.05,C.slot,{layer:3}),
    // the pole and the sign, beside the kiosk
    m(-.2,.5,0,.08,.08,2.35,C.pole,{layer:1}),
    m(-.2,.5,2.2,.12,.95,.42,C.sign[name],{layer:2}),
  ];
}
