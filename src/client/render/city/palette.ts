/**
 * Cidade Nevada palette, closed by the art lane (Executor-8) after the contrast check: board
 * design/cidade-nevada/palette.json (section "render" plus the materials used by props) and contraste.md.
 * Copy, don't invent: if the art lane changes the palette, regenerate these values from that file.
 * Rule from the contrast check: a large face with something in front keeps relative luminance >= 0.131
 * (3:1 against the Breu outline), so the render never darkens palette colours, it only lightens or blends
 * between two measured palette tones. Our own procedural art in the Trickster snow look; nothing from WC3.
 */
import type {BlockKind,GroundKind,PropKind} from './asset.ts';
import type {FaceKind} from './faces.ts';

const hex=(v:string)=>parseInt(v.slice(1),16);

/** Role name -> colour, exactly the "render" map of palette.json. */
export const CITY_PALETTE=Object.freeze({
  neve:hex('#E3E6F2'),'neve-detalhe':hex('#C9CEE6'),
  'neve-pisada':hex('#A8A5BD'),'neve-pisada-detalhe':hex('#8D89A6'),
  gelo:hex('#AEDEF0'),'gelo-detalhe':hex('#8FC3D9'),'gelo-brilho':hex('#F3FBFF'),
  agua:hex('#3F8EC0'),'agua-raso':hex('#69BEDD'),'agua-espuma':hex('#E8F5FB'),
  calcada:hex('#B5ADA7'),'calcada-junta':hex('#8C837E'),
  'entulho-chao':hex('#9A8580'),'entulho-chao-detalhe':hex('#7A6763'),
  tampa:hex('#F4F5FB'),'parede-clara':hex('#C46D59'),'parede-escura':hex('#9B5750'),'parede-detalhe':hex('#E6C7A2'),
  'muro-tampa':hex('#F4F5FB'),'muro-clara':hex('#9B95B0'),'muro-escura':hex('#757090'),
  'penhasco-tampa':hex('#DADEEE'),'penhasco-clara':hex('#9B95B0'),'penhasco-escura':hex('#6C6684'),
  'entulho-tampa':hex('#B9BFDC'),'entulho-clara':hex('#C46D59'),'entulho-escura':hex('#757090'),
  breu:hex('#1E1530'),
  'pinheiro-clara':hex('#5E8C6A'),'pinheiro-escura':hex('#4E7A63'),'pinheiro-luz':hex('#6E9C78'),
});
export type CityRole=keyof typeof CITY_PALETTE;

/** Ground fill and its detail tone per ground kind. */
export const GROUND_COLORS:Readonly<Record<GroundKind,{base:number;detail:number}>>=Object.freeze({
  snow:{base:CITY_PALETTE.neve,detail:CITY_PALETTE['neve-detalhe']},
  packed:{base:CITY_PALETTE['neve-pisada'],detail:CITY_PALETTE['neve-pisada-detalhe']},
  ice:{base:CITY_PALETTE.gelo,detail:CITY_PALETTE['gelo-detalhe']},
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
  pine:{light:CITY_PALETTE['pinheiro-clara'],dark:CITY_PALETTE['pinheiro-escura'],accent:CITY_PALETTE.tampa},
  crate:{light:hex('#C99266'),dark:hex('#8D6043'),accent:CITY_PALETTE.tampa},
  barrel:{light:hex('#C47A4C'),dark:hex('#985A38'),accent:CITY_PALETTE.tampa},
  debris:{light:hex('#B3AEC4'),dark:hex('#757090'),accent:CITY_PALETTE['neve-detalhe']},
  rubble:{light:CITY_PALETTE['entulho-chao'],dark:CITY_PALETTE['entulho-chao-detalhe'],accent:CITY_PALETTE['neve-detalhe']},
  bench:{light:hex('#C99266'),dark:hex('#8D6043'),accent:CITY_PALETTE.tampa},
});

export const SHADOW=Object.freeze({color:CITY_PALETTE.breu,alpha:0.22});
export const OUTSIDE_CITY=hex('#2B2542');
/** Outline widths from the art bible: 1.5 px on block edges, 2 px on props. */
export const OUTLINE_PX=Object.freeze({block:1.5,prop:2});

/** Linear RGB mix of two colours, t in [0,1]. */
export function mixColor(a:number,b:number,t:number):number{
  const k=Math.max(0,Math.min(1,t)),m=(s:number)=>Math.round((a>>s&255)+((b>>s&255)-(a>>s&255))*k);
  return (m(16)<<16)|(m(8)<<8)|m(0);
}
/** WCAG relative luminance of an RGB colour. */
export function luminance(color:number):number{
  const lin=(v:number)=>{const c=v/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;};
  return 0.2126*lin(color>>16&255)+0.7152*lin(color>>8&255)+0.0722*lin(color&255);
}
/** Lit slopes lighten at most this much toward white. */
export const GROUND_LIGHTEN=0.12;
/** Shaded slopes blend at most this much toward the kind's measured detail tone. */
export const GROUND_TOWARD_DETAIL=0.6;
/**
 * Ground colour for a slope shade in [-1,1] (faces.ts groundQuads): lit slopes lighten toward white, slopes facing
 * away blend toward the measured detail tone. Never darker than the darker of the two palette tones (contrast rule).
 */
export function groundColor(kind:GroundKind,shade:number):number{
  const {base,detail}=GROUND_COLORS[kind];
  if(!(shade<0||shade>0))return base;
  return shade>0?mixColor(base,0xffffff,GROUND_LIGHTEN*Math.min(1,shade)):mixColor(base,detail,GROUND_TOWARD_DETAIL*Math.min(1,-shade));
}
