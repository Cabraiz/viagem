/**
 * Cidade Nevada palette (draft from the art lane, Executor-8: board design/cidade-nevada/palette.json, section "render"
 * plus the materials used by props). Copy, don't invent: when the art lane closes the palette after the contrast
 * check, regenerate these values from that file. Our own procedural art in the Trickster snow look; nothing from WC3.
 */
import type {BlockKind,GroundKind,PropKind} from './asset.ts';
import type {FaceKind} from './faces.ts';

const hex=(v:string)=>parseInt(v.slice(1),16);

/** Role name -> colour, exactly the "render" map of palette.json. */
export const CITY_PALETTE=Object.freeze({
  neve:hex('#E3E6F2'),'neve-detalhe':hex('#C9CEE6'),
  'neve-pisada':hex('#A8A5BD'),'neve-pisada-detalhe':hex('#8D89A6'),
  gelo:hex('#BFE3F0'),'gelo-detalhe':hex('#8FC3D9'),'gelo-brilho':hex('#F3FBFF'),
  agua:hex('#3F8EC0'),'agua-raso':hex('#69BEDD'),'agua-espuma':hex('#E8F5FB'),
  calcada:hex('#B5ADA7'),'calcada-junta':hex('#8C837E'),
  'entulho-chao':hex('#9C919C'),'entulho-chao-detalhe':hex('#7B6F7E'),
  tampa:hex('#F4F5FB'),'parede-clara':hex('#C46D59'),'parede-escura':hex('#93504A'),'parede-detalhe':hex('#E6C7A2'),
  'muro-tampa':hex('#F4F5FB'),'muro-clara':hex('#9B95B0'),'muro-escura':hex('#757090'),
  'penhasco-tampa':hex('#DADEEE'),'penhasco-clara':hex('#9B95B0'),'penhasco-escura':hex('#605A78'),
  'entulho-tampa':hex('#B9BFDC'),'entulho-clara':hex('#C46D59'),'entulho-escura':hex('#757090'),
  breu:hex('#1E1530'),
});
export type CityRole=keyof typeof CITY_PALETTE;

/** Ground fill and its detail tone per ground kind. */
export const GROUND_COLORS:Readonly<Record<GroundKind,{base:number;detail:number}>>=Object.freeze({
  snow:{base:CITY_PALETTE.neve,detail:CITY_PALETTE['neve-detalhe']},
  packed:{base:CITY_PALETTE['neve-pisada'],detail:CITY_PALETTE['neve-pisada-detalhe']},
  ice:{base:CITY_PALETTE.gelo,detail:CITY_PALETTE['gelo-brilho']},
  water:{base:CITY_PALETTE.agua,detail:CITY_PALETTE['agua-espuma']},
  rubble:{base:CITY_PALETTE['entulho-chao'],detail:CITY_PALETTE['entulho-chao-detalhe']},
  cobble:{base:CITY_PALETTE.calcada,detail:CITY_PALETTE['calcada-junta']},
});

/** Face colour per block kind: cap, wall facing screen left-down (light), wall facing screen right-down (dark). */
export const BLOCK_COLORS:Readonly<Record<BlockKind,Readonly<Record<FaceKind,number>>>>=Object.freeze({
  building:{cap:CITY_PALETTE.tampa,wallLight:CITY_PALETTE['parede-clara'],wallDark:CITY_PALETTE['parede-escura']},
  wall:{cap:CITY_PALETTE['muro-tampa'],wallLight:CITY_PALETTE['muro-clara'],wallDark:CITY_PALETTE['muro-escura']},
  cliff:{cap:CITY_PALETTE['penhasco-tampa'],wallLight:CITY_PALETTE['penhasco-clara'],wallDark:CITY_PALETTE['penhasco-escura']},
  rubble:{cap:CITY_PALETTE['entulho-tampa'],wallLight:CITY_PALETTE['entulho-clara'],wallDark:CITY_PALETTE['entulho-escura']},
});

/** Prop body (light/dark) and accent colours, from the palette materials. */
export const PROP_COLORS:Readonly<Record<PropKind,{light:number;dark:number;accent:number}>>=Object.freeze({
  car:{light:hex('#8CA6D6'),dark:hex('#536A9E'),accent:CITY_PALETTE.tampa},
  lamp:{light:hex('#8CA6D6'),dark:hex('#536A9E'),accent:hex('#FFE6A3')},
  pine:{light:hex('#5E8C6A'),dark:hex('#3D6450'),accent:CITY_PALETTE.tampa},
  crate:{light:hex('#C99266'),dark:hex('#83573B'),accent:CITY_PALETTE.tampa},
  barrel:{light:hex('#C47A4C'),dark:hex('#774236'),accent:CITY_PALETTE.tampa},
  debris:{light:hex('#B3AEC4'),dark:hex('#757090'),accent:CITY_PALETTE['neve-detalhe']},
  rubble:{light:hex('#9C919C'),dark:hex('#7B6F7E'),accent:CITY_PALETTE['neve-detalhe']},
  bench:{light:hex('#C99266'),dark:hex('#83573B'),accent:CITY_PALETTE.tampa},
});

export const SHADOW=Object.freeze({color:CITY_PALETTE.breu,alpha:0.22});
export const OUTSIDE_CITY=hex('#2B2542');
/** Outline widths from the art bible: 1.5 px on block edges, 2 px on props. */
export const OUTLINE_PX=Object.freeze({block:1.5,prop:2});

/** Multiplies an RGB colour by k (k<1 darker, k>1 lighter, clamped). Used for slope shading on the ground. */
export function shadeColor(color:number,k:number):number{
  const c=(v:number)=>Math.max(0,Math.min(255,Math.round(v*k)));
  return (c(color>>16&255)<<16)|(c(color>>8&255)<<8)|c(color&255);
}
