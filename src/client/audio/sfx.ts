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
}

export const SFX_DIR='/audio/sfx/';
export type SfxFormat='webm'|'m4a';

const spec=(throttleMs:number,priority:number,gain:number,takes=1):SfxSpec=>Object.freeze({takes,throttleMs,priority,gain});
/** The groups' levels: spam (hits, footsteps, every shot) under the moments (chests, level up, the boss). */
const UI=spec(40,2,.6),SHOT=spec(70,0,.45),PACK=spec(90,0,.4),TOWER=spec(120,0,.32);
const own=(id:ProceduralId,gain:number)=>spec(RECIPES[id].throttleMs,RECIPES[id].priority,gain);

export const SFX:Readonly<Record<SoundId,SfxSpec>>=Object.freeze({
  golpe:own('golpe',.4),gema:own('gema',.45),nivel:own('nivel',.7),upgrade:own('upgrade',.6),queda:own('queda',.75),
  resgate:own('resgate',.7),chefe:own('chefe',.85),'round-inicio':own('round-inicio',.7),'round-fim':own('round-fim',.7),
  buzina:own('buzina',.6),boing:own('boing',.6),risada:own('risada',.6),carimbo:own('carimbo',.6),
  'ui-botao':UI,'ui-abrir':UI,'ui-fechar':UI,'ui-carta':UI,'ui-erro':UI,
  // Six takes of the step (footsteps.ts draws one per contact of the foot, never the same twice in a row).
  'passo-neve':spec(0,0,.35,6),empurrar:spec(600,1,.5),levantar:spec(300,1,.55),'dano-heroi':spec(250,2,.55),
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
