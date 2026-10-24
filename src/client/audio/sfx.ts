/**
 * The sound files (NEW-20261022-ORQ-sons-ia-ace-step): every SoundId has one or more takes in public/audio/sfx/, made by
 * TangoFlux (scripts/import-sfx.mjs: Opus .webm and AAC .m4a, the loudest 400 ms at -16 LUFS, peak <= -1 dBFS). Loaded on
 * demand by the engine (engine.ts); the 13 procedural sounds (recipes.ts) stand in while a file loads or when it fails.
 * Pure data, no WebAudio.
 */
import {ALL_SOUND_IDS,type ProceduralId,type SoundId} from './types.ts';
import {RECIPES} from './recipes.ts';

export interface SfxSpec {
  /** Takes of the sound: 1 = `<id>.webm`, n = `<id>-1.webm` … `<id>-n.webm`, drawn at random without repeating the last. */
  takes:number;
  /** Minimum milliseconds between two plays (the procedural recipe's for its 13). */
  throttleMs:number;
  /** Higher survives voice stealing (recipes.ts scale: 0 spam, 3 must be heard). */
  priority:number;
  /** Level of the file under the effects bus, before the play's own gain (the files are all at the same loudness). */
  gain:number;
  /**
   * Plays from the take's attack, each take at one level (alignTake): a sound that must land on a frame, the footstep
   * (BUG-20261024-ORQ-som-passos-fora-do-eixo: its crunch came 44 to 137 ms after the play, by take, and 5 dB apart).
   */
  align?:boolean;
}

export const SFX_DIR='/audio/sfx/';
export type SfxFormat='webm'|'m4a';

const spec=(throttleMs:number,priority:number,gain:number,takes=1,align=false):SfxSpec=>Object.freeze({takes,throttleMs,priority,gain,...(align?{align}:{})});
/** The groups' levels: spam (hits, footsteps, every shot) under the moments (chests, level up, the boss). */
const UI=spec(40,2,.6),SHOT=spec(70,0,.45),PACK=spec(90,0,.4),TOWER=spec(120,0,.32);
const own=(id:ProceduralId,gain:number)=>spec(RECIPES[id].throttleMs,RECIPES[id].priority,gain);

export const SFX:Readonly<Record<SoundId,SfxSpec>>=Object.freeze({
  golpe:own('golpe',.4),gema:own('gema',.45),nivel:own('nivel',.7),upgrade:own('upgrade',.6),queda:own('queda',.75),
  resgate:own('resgate',.7),chefe:own('chefe',.85),'round-inicio':own('round-inicio',.7),'round-fim':own('round-fim',.7),
  buzina:own('buzina',.6),boing:own('boing',.6),risada:own('risada',.6),carimbo:own('carimbo',.6),
  'ui-botao':UI,'ui-abrir':UI,'ui-fechar':UI,'ui-carta':UI,'ui-erro':UI,
  // Six takes of the step (footsteps.ts draws one per contact of the foot, never the same twice in a row), each from
  // its crunch, at one level.
  'passo-neve':spec(0,0,.35,6,true),empurrar:spec(600,1,.5),levantar:spec(300,1,.55),'dano-heroi':spec(250,2,.55),
  faca:SHOT,pistola:SHOT,escopeta:SHOT,submetralhadora:SHOT,rifle:SHOT,macarico:spec(180,0,.4),rojao:spec(200,1,.55),
  chinelo:SHOT,boleto:SHOT,cafe:SHOT,'guarda-chuva':SHOT,pombo:SHOT,audio:spec(400,0,.45),
  'p12-tiro':PACK,'p12-leque':PACK,'p12-orbita':spec(400,0,.3),'p12-ricochete':PACK,'p12-bumerangue':PACK,'p12-teleguiado':PACK,
  'p12-lancado':PACK,'p12-mina':PACK,'p12-torreta':PACK,'p12-aura':spec(500,0,.3),'p12-nuvem':spec(300,0,.4),
  'torre-construir':spec(150,2,.65),'torre-pistola':TOWER,'torre-fuzil':TOWER,'torre-metralhadora':TOWER,'torre-rotativa':TOWER,
  'torre-sniper':TOWER,'torre-antimaterial':TOWER,'torre-rojao':TOWER,'torre-morteiro':TOWER,'torre-foguete':TOWER,
  'torre-obus':TOWER,'torre-gustavao':spec(300,1,.45),'torre-holofote':spec(600,0,.3),'torre-arame':spec(400,0,.3),
  'torre-antiaerea':TOWER,'torre-radar':spec(900,0,.25),
  'bicho-acerto':spec(50,0,.3),'bicho-morte':spec(60,0,.4),'chefe-acerto':spec(120,1,.5),'chefe-morte':spec(0,3,.85),'chefe-passo':spec(250,1,.5),
  'bau-comum':spec(100,2,.65),'bau-raro':spec(100,2,.7),'bau-epico':spec(100,2,.75),'bau-lendario':spec(100,3,.8),
  coxinha:spec(60,1,.5),ima:spec(300,1,.55),
});

/**
 * Fetched at unlock, before anyone asks (~40 KB): the first footstep, click and hit of a match are heard. The rest
 * load the first time they play (that one time the recipe plays, or silence for a file-only sound).
 */
export const SFX_WARM:readonly SoundId[]=['passo-neve','ui-botao','golpe','dano-heroi','bicho-acerto','bicho-morte','gema','pistola','faca'];

/** The file of one take (0-based) of a sound. */
export function sfxUrl(id:SoundId,take:number,format:SfxFormat):string{
  const n=SFX[id].takes;
  return `${SFX_DIR}${n>1?`${id}-${Math.min(n,Math.max(1,Math.floor(take)+1))}`:id}.${format}`;
}
/** Every file name (no folder, no extension) the sounds need: the import must have made each one. */
export function sfxNames():string[]{
  return ALL_SOUND_IDS.flatMap(id=>SFX[id].takes>1?Array.from({length:SFX[id].takes},(_,i)=>`${id}-${i+1}`):[id]);
}
/** Opus when the browser decodes it, else AAC (Safari before 17), else none (the procedural ones only). */
export function pickSfxFormat(canPlay:(type:string)=>string):SfxFormat|null{
  const ok=(type:string)=>{try{return canPlay(type)!=='';}catch{return false;}};
  return ok('audio/webm; codecs="opus"')?'webm':ok('audio/mp4; codecs="mp4a.40.2"')?'m4a':null;
}
/** A take drawn at random among `takes`, never `last` again when there is another (rnd in [0, 1)). */
export function drawTake(takes:number,last:number|undefined,rnd:number):number{
  if(takes<=1)return 0;
  if(last===undefined||last<0||last>=takes)return Math.min(takes-1,Math.floor(rnd*takes));
  const pick=Math.min(takes-2,Math.floor(rnd*(takes-1)));
  return pick>=last?pick+1:pick;
}
/** alignTake: a little of the rise kept before the attack, how far back the attack may start, and the level it brings the takes to. */
export const ALIGN_PREROLL_S=.004,ALIGN_RISE_S=.04,ALIGN_LEVEL_DB=-14;
/**
 * Where a take's attack starts and the gain that brings it to ALIGN_LEVEL_DB (the mean of the six snow takes): the loudest
 * 5 ms window, back while within 12 dB of it (at most ALIGN_RISE_S), less ALIGN_PREROLL_S; the level is the 40 ms from
 * there (gain within ±6 dB). Measured on the takes: the crunch at 45 to 135 ms of the file, take 4 holding two (the
 * second, louder, is the one kept).
 */
export function alignTake(x:ArrayLike<number>,rate:number):{offset:number;gain:number}{
  const w=Math.max(1,Math.round(rate*.005)),n=Math.floor(x.length/w);
  if(n<1)return {offset:0,gain:1};
  const e=new Float64Array(n);
  for(let k=0;k<n;k++){let s=0;for(let j=k*w;j<(k+1)*w;j++)s+=x[j]*x[j];e[k]=s/w;}
  let p=0;for(let k=1;k<n;k++)if(e[k]>e[p])p=k;
  if(!(e[p]>0))return {offset:0,gain:1};
  let k=p;const back=Math.round(ALIGN_RISE_S*rate/w);
  while(k>0&&p-k<back&&e[k-1]>=e[p]/16)k--;
  const start=k*w,end=Math.min(x.length,start+Math.round(rate*.04));let s=0;
  for(let j=start;j<end;j++)s+=x[j]*x[j];
  const db=10*Math.log10(s/Math.max(1,end-start));
  return {offset:Math.max(0,start/rate-ALIGN_PREROLL_S),gain:Math.min(2,Math.max(.5,10**((ALIGN_LEVEL_DB-db)/20)))};
}
