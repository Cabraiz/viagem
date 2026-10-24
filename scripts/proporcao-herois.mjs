// Card NEW-20261024-ORQ-maromba-cabeca-proporcao: the head of each hero against its own body, and against the other heroes.
// proporcao.mjs checks that every clip draws the hero's head at its REST pose's size (the same hero, ±4 %); it never asked
// whether the rest pose itself has a sensible head. The user saw the maromba "with a head out of proportion in almost
// everything": his rest pose had a head ~20 % lower and ~25 % narrower than the viciado's and the CLT's (etapa 1,
// docs/proporcao-herois.md).
//
// On the rest pose seen from the front (S, SE, N: from the side there is no narrow chin and the measure hits its ceiling),
// median over the rest's frames:
//   - cab/alt: head height (top down to the chin) over the figure's height (alpha > 128);
//   - cab/ombro: the head's widest solid stretch over the shoulders' (the widest stretch in the rows under the chin, down
//     to +25 % of the height).
// The chin is the LOWEST row between 22 % and 45 % of the height whose widest stretch is ≤ the band's minimum + 2 (the
// last narrow row before the shoulders; the neck of a thick-necked hero is several rows of the same width).
//
//   node scripts/proporcao-herois.mjs [--ids maromba,viciado-em-bet | --todos] [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// @ts-ignore plain ESM
import {cells,median} from './proporcao.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const SPRITES=path.join(ROOT,'public/art/sprites');
export const FRONT=['S','SE','N'];
/** R06's idle8 column order (sprite-motion.ts HERO_DIRECTIONS). */
const IDLE8=['S','SW','W','NW','N','NE','E','SE'];
const CELL=96,SOLID=128;
/**
 * Each hero's proportions, read on its rest pose from the front (the median of S, SE and N). A sheet that redraws a
 * hero must keep them within TOL (relative); a new hero must be added here, and a human's cab/alt must fall in HUMAN.
 * `chad`: drawn bigger on purpose (the user, 24/10: "deixar ele chad com cabeça maior"), outside HUMAN by design.
 */
export const HEROES={
  'viciado-em-bet':{cabAlt:.38,cabOmbro:.85},
  'clt-cansado':{cabAlt:.41,cabOmbro:.81},
  // etapa 3 of the card replaces this with the Chad head the user picks; until then his current head, too small (`small`)
  maromba:{cabAlt:.31,cabOmbro:.57,small:true},
  // a cat's head, no neck: its own rule, not HUMAN
  'gato-nada-pra-comer':{cabAlt:.28,cabOmbro:.61,animal:true},
};
/** ±3 % of the hero's declared value (relative). */
export const TOL=.03;
/** The band of a human hero's cab/alt (viciado .38, vendedor .39, CLT .41): a cartoon head, never a pin head. */
export const HUMAN={cabAlt:[.36,.45]};

/** cab/alt and cab/ombro of one soft-alpha cell (0..1), or undefined when it is empty. */
export function headBox(a,n=CELL){
  const seg=new Array(n).fill(0);let top=-1,bot=-1;
  for(let y=0;y<n;y++){
    let run=0,best=0;
    for(let x=0;x<n;x++){if(a[y*n+x]*255>SOLID){run++;if(run>best)best=run;}else run=0;}
    seg[y]=best;if(best){if(top<0)top=y;bot=y;}
  }
  if(top<0||bot-top<9)return undefined;
  const H=bot-top+1,lo=top+Math.round(H*.22),hi=top+Math.round(H*.45);
  let mn=Infinity;for(let y=lo;y<=hi;y++)mn=Math.min(mn,seg[y]);
  let chin=lo;for(let y=lo;y<=hi;y++)if(seg[y]<=mn+2)chin=y;
  const head=Math.max(...seg.slice(top,chin)),shoulder=Math.max(...seg.slice(chin+1,Math.min(bot,chin+Math.round(H*.25))+1));
  return {H,cab:chin-top,cabAlt:(chin-top)/H,cabW:head,ombro:shoulder,cabOmbro:shoulder?head/shoulder:NaN};
}

/** The rest cells of direction d: idle16-<d>'s frames, else the idle8 column. */
async function restCells(files,d,dir){
  const c=files[`idle16-${d}`];
  if(c)return cells(path.join(dir,c.file),c.frames);
  if(files.idle8){const all=await cells(path.join(dir,files.idle8.file),8);return [all[IDLE8.indexOf(d)]];}
  return [];
}

/** Front-rest proportions of class id: per direction and their median. */
export async function measureHero(manifest,id,dir=SPRITES){
  const files=manifest.pieces?.[id]?.files??{},dirs={};
  for(const d of FRONT){
    const q=(await restCells(files,d,dir)).map(a=>headBox(a)).filter(Boolean);
    if(q.length)dirs[d]={cabAlt:+median(q.map(x=>x.cabAlt)).toFixed(3),cabOmbro:+median(q.map(x=>x.cabOmbro)).toFixed(3),cab:median(q.map(x=>x.cab)),H:median(q.map(x=>x.H))};
  }
  const v=Object.values(dirs),pick=k=>+median(v.map(x=>x[k])).toFixed(3);
  return {id,dirs,cabAlt:pick('cabAlt'),cabOmbro:pick('cabOmbro')};
}

/**
 * The heroes the gate covers: every one declared in HEROES and every class with an M16 rest (idle16-*: a sheet drawn
 * since movimento16). The R06 placeholders (idle8 only: coach, pedreiro…) are measured with --todos, not gated.
 */
export const gatedHeroes=manifest=>[...new Set([...Object.keys(HEROES),...Object.keys(manifest.pieces).filter(id=>Object.keys(manifest.pieces[id].files??{}).some(k=>k.startsWith('idle16-')))])];

/** Failures of a measured hero against its declared proportions and HUMAN (empty = passes). */
export function verdictHero(m,rule=HEROES[m.id]){
  if(!rule)return [`${m.id}: no declared proportions (add it to HEROES in scripts/proporcao-herois.mjs)`];
  const bad=[];
  for(const k of ['cabAlt','cabOmbro'])if(Math.abs(m[k]/rule[k]-1)>TOL+1e-9)bad.push(`${m.id} ${k} ${m[k]} (declared ${rule[k]} ±${TOL*100}%)`);
  if(!rule.animal&&!rule.chad&&!rule.small&&(m.cabAlt<HUMAN.cabAlt[0]||m.cabAlt>HUMAN.cabAlt[1]))bad.push(`${m.id} cabAlt ${m.cabAlt} out of the human band ${HUMAN.cabAlt.join('–')}`);
  return bad;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=k=>{const i=process.argv.indexOf(k);return i>0?process.argv[i+1]:undefined;};
  const manifest=JSON.parse(fs.readFileSync(path.join(SPRITES,'manifest.json'),'utf8'));
  const ids=arg('--ids')?.split(',')??(process.argv.includes('--todos')?Object.keys(manifest.pieces).filter(id=>manifest.pieces[id].files?.idle8):gatedHeroes(manifest));
  const all=[];
  console.log('| herói | S | SE | N | cab/alt | cab/ombro | regra |\n|---|---|---|---|---|---|---|');
  for(const id of ids){
    const m=await measureHero(manifest,id);all.push(m);const bad=verdictHero(m);
    console.log(`| ${id} | ${FRONT.map(d=>m.dirs[d]?m.dirs[d].cabAlt.toFixed(2):'–').join(' | ')} | ${m.cabAlt.toFixed(2)} | ${m.cabOmbro.toFixed(2)} | ${bad.length?bad.join('; '):'ok'} |`);
  }
  if(arg('--json'))fs.writeFileSync(arg('--json'),JSON.stringify(all,null,1));
}
