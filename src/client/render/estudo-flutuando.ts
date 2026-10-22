/**
 * Debug-only variants of the study "inimigos flutuando" (card NEW-20261022-ORQ-estudo-inimigos-flutuando). `?estudo=` takes
 * comma-separated tokens; without it nothing here changes the game. Pure (no Phaser) except ensureStudyContact.
 *  - `cheia`        V4: the approved sheets instead of the lite copies (the lite cell is upscaled ~1.6× on screen).
 *  - `aro=breu`     V1a: the city's 2 px Breu ring on every enemy (today only on dark ground).
 *  - `contato`      V2: a small dark soft contact shadow under the feet (Breu, ~70% at the centre, soft edge).
 *  - `amb`          V3: the sprite multiplied by the snow's ambient (cool, a touch darker): it takes the map's light.
 *  - `ps=a1|a2|a3`  V6a: pseudo-shadow by vertex tint: shade side (right) and feet darker, three strengths.
 *  - `folha=<dir>`  V6b / V1b: enemy sheets from public/art/estudo/<dir>/ (scripts/pseudo-sombra.mjs output).
 *  - `sil=0`        no cast silhouette (to isolate the contact shadow).
 *  - `semcontato`   no contact ellipse (the silhouette alone, like E4's sombra-silhueta branch).
 */
export interface Study {cheia:boolean;aro:'breu'|undefined;contato:boolean;amb:boolean;ps:0|1|2|3;folha:string|undefined;sil:boolean;semContato:boolean}
export function parseStudy(search:string):Study|undefined{
  const raw=new URLSearchParams(search).get('estudo');if(!raw)return undefined;
  const t=raw.split(',').map(s=>s.trim()).filter(Boolean),get=(k:string)=>t.find(s=>s.startsWith(k+'='))?.slice(k.length+1);
  const ps=get('ps'),folha=get('folha');
  return {cheia:t.includes('cheia'),aro:get('aro')==='breu'?'breu':undefined,contato:t.includes('contato'),amb:t.includes('amb'),
    ps:ps==='a1'?1:ps==='a2'?2:ps==='a3'?3:0,folha:folha&&/^[a-z0-9-]+$/.test(folha)?folha:undefined,sil:get('sil')!=='0',semContato:t.includes('semcontato')};
}
export const STUDY:Study|undefined=parseStudy(typeof location==='undefined'?'':location.search);

/** The enemy sheet URL under the study (`url` is the approved file's): lite by default, the full sheet, or a processed copy. */
export function studyEnemyUrl(url:string,lite:string):string{
  if(!STUDY)return lite;
  if(STUDY.folha)return url.replace('/art/enemies/',`/art/estudo/${STUDY.folha}/`);
  return STUDY.cheia?url:lite;
}

const mul=(a:number,b:number)=>((((a>>16&255)*(b>>16&255)/255)|0)<<16)|((((a>>8&255)*(b>>8&255)/255)|0)<<8)|(((a&255)*(b&255)/255)|0);
const grey=(v:number)=>{const c=Math.max(0,Math.min(255,Math.round(v*255)));return c<<16|c<<8|c;};
/** Snow ambient (V3): the light under a cold sky, a little below white, bluish. */
export const STUDY_AMBIENT=0xd8deec;
/** V6a: [lit top-left, top-right, bottom-left, bottom-right] brightness per strength. */
export const PSEUDO_CORNERS:Readonly<Record<1|2|3,readonly [number,number,number,number]>>=Object.freeze({
  1:[1,.9,.82,.72],2:[1,.84,.7,.58],3:[1,.76,.58,.44],
});
/** Extra corner tints (unflipped: tl, tr, bl, br) the study multiplies over the sun tint; undefined = none. */
export function studyCorners():[number,number,number,number]|undefined{
  if(!STUDY||(!STUDY.amb&&!STUDY.ps))return undefined;
  const c=STUDY.ps?PSEUDO_CORNERS[STUDY.ps].map(grey) as [number,number,number,number]:[0xffffff,0xffffff,0xffffff,0xffffff] as [number,number,number,number];
  return STUDY.amb?c.map(v=>mul(v,STUDY_AMBIENT)) as [number,number,number,number]:c;
}
export const studyMul=mul;

/** V2 contact shadow texture: a soft dark ellipse (radial falloff), drawn once on a canvas. */
export const STUDY_CONTACT_KEY='estudo-contato';
export const STUDY_CONTACT={w:64,h:24,color:[30,21,48] as const,alpha:.72};
export function ensureStudyContact(textures:{exists(key:string):boolean;addCanvas(key:string,c:HTMLCanvasElement):unknown}){
  if(textures.exists(STUDY_CONTACT_KEY))return;
  const {w,h,color,alpha}=STUDY_CONTACT,c=document.createElement('canvas');c.width=w;c.height=h;
  const g=c.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(1,0,0,h/w,0,0);
  const r=g.createRadialGradient(w/2,w/2,0,w/2,w/2,w/2),rgb=color.join(',');
  r.addColorStop(0,`rgba(${rgb},${alpha})`);r.addColorStop(.45,`rgba(${rgb},${alpha*.8})`);r.addColorStop(1,`rgba(${rgb},0)`);
  g.fillStyle=r;g.fillRect(0,0,w,w);
  textures.addCanvas(STUDY_CONTACT_KEY,c);
}
