/**
 * Face-only avatars in the HUD (NEW-20261012-ORQ-rostos-hud, board design/PACOTE-ROSTOS.md): the team strip, the result
 * cards, the ally edge arrow and the waiting room's chips show a face in a circle, not the whole body squeezed in it.
 *
 * Until the face art arrives (group `rostos`), the face is a crop of today's portrait thumb (/art/portraits/<id>-thumb.webp,
 * 256², transparent, full body, head in the top ~25-30%): FACE_CROP says, per class, where the face is (centre and side,
 * as fractions of the square image). A square <img> of side zoom×100% placed absolutely inside an overflow:hidden circle
 * (ui/face.css) shows exactly that square. With an imported face the whole image fills the circle, no crop.
 *
 * The expression follows the player's state (faceExpression); with no imported art every expression shows the same crop
 * (the downed/eliminated greys of the team strip stay in CSS).
 *
 * Minimap marks (6-12 px) and emote balloons (drawn over the hero itself) get no face on purpose.
 *
 * Pure (no DOM globals: the DOM helpers take the document), so it runs in node tests.
 * Superseded in part by src/client/art/faces.ts (E7, importar-arte-d) once merged: its `faceUrl` is the same lookup as
 * `importedFaceUrl` here (exact expression, else the class's `normal`, else null); keep one of them then.
 */
import type {EmoteId} from '../fun/emotes.ts';
import {artPages,artPiece,artUrl} from '../art/manifest.ts';
import {thumbUrl} from '../sprites/art-urls.ts';

/** Where the face is in the square portrait: centre (cx, cy) and side (size), all fractions of the image side. */
export interface FaceCrop {cx:number;cy:number;size:number}
/** A class missing from FACE_CROP (or an unknown id): the head sits centred in the top of the image. */
export const DEFAULT_FACE:FaceCrop=Object.freeze({cx:.5,cy:.2,size:.42});

/**
 * Face crop per class id, sorted by id: head and top of the shoulders of each `<id>-thumb.webp` (head ≈ 62% of the crop),
 * measured from the portraits' alpha (head top, neck, head centre) and checked by eye on a contact sheet of all 36.
 * One place, one line per class; re-measure when a portrait changes.
 */
export const FACE_CROP:Readonly<Record<string,Readonly<FaceCrop>>>=Object.freeze({
  'aposentado':{cx:.509,cy:.178,size:.334},
  'astrologa':{cx:.52,cy:.217,size:.435},
  'caca-promocao':{cx:.463,cy:.23,size:.46},
  'cidadao-comum':{cx:.474,cy:.195,size:.391},
  'clt-cansado':{cx:.487,cy:.221,size:.441},
  'coach':{cx:.466,cy:.217,size:.435},
  'concurseira':{cx:.484,cy:.23,size:.46},
  'conspiracionista':{cx:.502,cy:.23,size:.46},
  'faxineira':{cx:.491,cy:.202,size:.403},
  'feirante':{cx:.478,cy:.227,size:.454},
  'gambiarreiro':{cx:.467,cy:.176,size:.353},
  'gamer-mobile':{cx:.499,cy:.242,size:.435},
  'gato-nada-pra-comer':{cx:.48,cy:.25,size:.5},
  'goleira':{cx:.456,cy:.21,size:.359},
  'mae-pet':{cx:.42,cy:.214,size:.429},
  'maromba':{cx:.475,cy:.227,size:.454},
  'mendigo':{cx:.505,cy:.224,size:.447},
  'merendeira':{cx:.462,cy:.198,size:.397},
  'motogirl':{cx:.518,cy:.17,size:.34},
  'pagodeiro':{cx:.46,cy:.214,size:.428},
  'passageira':{cx:.541,cy:.224,size:.447},
  'pedreiro':{cx:.484,cy:.186,size:.372},
  'porteiro':{cx:.493,cy:.23,size:.46},
  'rainha-bateria':{cx:.495,cy:.161,size:.321},
  'rei-arraia':{cx:.522,cy:.202,size:.403},
  'rei-pastel':{cx:.504,cy:.224,size:.447},
  'roqueira':{cx:.491,cy:.249,size:.498},
  'salva-vidas':{cx:.483,cy:.192,size:.384},
  'sensei':{cx:.467,cy:.23,size:.46},
  'streamer':{cx:.466,cy:.23,size:.46},
  'tecnico-ti':{cx:.476,cy:.197,size:.395},
  'tio-do-churrasco':{cx:.517,cy:.23,size:.46},
  'universitario':{cx:.492,cy:.214,size:.429},
  'vendedor-praia':{cx:.497,cy:.195,size:.391},
  'viciado-em-bet':{cx:.532,cy:.202,size:.403},
  'vizinha-fofoqueira':{cx:.465,cy:.233,size:.466},
});

/** Smallest crop side (5% of the image): a typo in the table never zooms 100× into a few pixels. */
const MIN_SIZE=.05;
const finite=(v:unknown,fallback:number)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
const clamp=(v:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,v));

/**
 * The crop of a class, made safe: the side within [5%, 100%] and the centre moved so the whole square lies inside the
 * image (the circle never shows the transparent outside of the portrait or an empty band).
 */
export type FaceTable=Readonly<Record<string,Readonly<FaceCrop>>>;
export function faceCrop(classId:string,table:FaceTable=FACE_CROP):FaceCrop{
  const raw=Object.hasOwn(table,classId)?table[classId]:DEFAULT_FACE;
  const size=clamp(finite(raw.size,DEFAULT_FACE.size),MIN_SIZE,1),half=size/2;
  return {cx:clamp(finite(raw.cx,DEFAULT_FACE.cx),half,1-half),cy:clamp(finite(raw.cy,DEFAULT_FACE.cy),half,1-half),size};
}

/**
 * How the <img> sits in the circle: side zoom×100% of the circle, left/top offsets in % of the circle side, so the crop's
 * centre lands on the circle's centre and the crop's side equals the circle's side. Always left,top ≤ 0 and
 * left/top + zoom×100 ≥ 100 (the image covers the circle).
 */
export interface FaceFrame {zoom:number;left:number;top:number}
/** The whole image in the circle (an imported face is already framed for it). */
export const FULL_FRAME:Readonly<FaceFrame>=Object.freeze({zoom:1,left:0,top:0});
const round=(v:number)=>Math.round(v*1e5)/1e5||0;
export function faceFrame(classId:string,table:FaceTable=FACE_CROP):FaceFrame{
  // Offsets from the rounded zoom (the written values keep the crop centre on the circle centre), then held inside
  // [100 - side, 0] so rounding never opens a hairline at the circle's edge.
  const {cx,cy,size}=faceCrop(classId,table),zoom=round(1/size),side=zoom*100;
  const offset=(c:number)=>round(clamp(50-c*side,100-side,0));
  return {zoom,left:offset(cx),top:offset(cy)};
}

export type FaceVars={'--face-z':string;'--face-x':string;'--face-y':string};
/** The frame as the custom properties ui/face.css reads. */
export const frameVars=(frame:FaceFrame):FaceVars=>({'--face-z':String(frame.zoom),'--face-x':`${frame.left}%`,'--face-y':`${frame.top}%`});
/** The portrait crop of a class as CSS custom properties (--face-z, --face-x, --face-y). */
export const faceVars=(classId:string):FaceVars=>frameVars(faceFrame(classId));
/** The same, as an inline style text ("--face-z:2.381;--face-x:-69.0476%;--face-y:0%"). */
export const varsText=(vars:FaceVars)=>Object.entries(vars).map(([k,v])=>`${k}:${v}`).join(';');

// ---------- Expression by state ----------

/** Expressions, in the brief's order (same list as art/faces.ts and scripts/art-v2/spec.mjs FACE_EXPRESSIONS). */
export const FACE_EXPRESSIONS=['normal','ferido','caido','rindo','bravo'] as const;
export type FaceExpression=typeof FACE_EXPRESSIONS[number];
/** The art v2 group of the faces. */
export const FACE_GROUP='rostos';
/** Phaser texture key of a face (same as art/faces.ts). */
export const faceKey=(id:string,expr:FaceExpression)=>`rosto:${id}:${expr}`;
/** At or below this share of max HP the face is `ferido` (the team strip's "low" state uses the same 30%). */
export const HURT_FRACTION=.3;

export interface FaceState {
  hp:number;maxHp:number;downed?:boolean;eliminated?:boolean;
  /** The emote the player is showing now, if any. */
  emote?:EmoteId;
  /** The run's end, passed by the result screen only. `timeout` counts as neither. */
  outcome?:'victory'|'defeat'|'timeout';
}
/**
 * The face for a state. Priority, first match wins:
 *   1. the run's outcome (result screen only): bravo on defeat, rindo on victory. It beats caido because a normal defeat
 *      ends with everyone down or out, and the result must still show the team's mood;
 *   2. caido: downed or eliminated (during the run the team must see who needs help);
 *   3. rindo while showing the KKKK emote;
 *   4. ferido at or below 30% of max HP, alive (hp > 0, maxHp > 0: a spectator or offline player at 0 HP stays normal);
 *   5. normal.
 */
export function faceExpression(state:FaceState):FaceExpression{
  if(state.outcome==='defeat')return 'bravo';
  if(state.outcome==='victory')return 'rindo';
  if(state.downed||state.eliminated)return 'caido';
  if(state.emote==='kkkk')return 'rindo';
  if(state.maxHp>0&&Number.isFinite(state.hp)&&state.hp>0&&state.hp/state.maxHp<=HURT_FRACTION)return 'ferido';
  return 'normal';
}

// ---------- Which image ----------

/** URL of the imported face of exactly this class and expression, or null (the manifest is empty today). */
export type ExactFace=(classId:string,expr:FaceExpression)=>string|null;
export const manifestFace:ExactFace=(classId,expr)=>{
  const piece=artPiece(FACE_GROUP,`${classId}-${expr}`);
  if(!piece)return null;
  const file=piece.files.sheet??Object.values(piece.files)[0];
  const page=file&&artPages(file)[0];
  return (page&&artUrl(FACE_GROUP,page.file))??null;
};
/** The imported face for (class, expression): itself, else the class's `normal`, else null (the portrait crop). */
export function importedFaceUrl(classId:string,expr:FaceExpression='normal',exact:ExactFace=manifestFace):string|null{
  return exact(classId,expr)??(expr!=='normal'?exact(classId,'normal'):null);
}

/** Side of the portrait thumb (scripts/prepare-portraits.mjs `-thumb`). */
export const THUMB_PX=256;
/** Device pixel ratio planned for (phones at DPR 3) and the upscale tolerated before the bigger portrait is used. */
export const FACE_DPR=3,FACE_UPSCALE=1.2;
/** The 768 px copy of a portrait (scripts/prepare-portraits.mjs `-768`): same framing as the thumb, so the same crop. */
export const portrait768=(classId:string)=>`/art/portraits/${classId}-768.webp`;
/**
 * Whether a face drawn `px` CSS px wide needs the 768 portrait: the crop holds size×256 thumb pixels, and at DPR 3 the
 * circle wants px×3; past 1.2× upscale the thumb blurs. Result cards (40-64 px) pass px; the team strip (38 px), the edge
 * arrows (26) and the chips (24) keep the thumb (one small file for the always-on HUD).
 */
export const needsLargePortrait=(classId:string,px:number)=>px*FACE_DPR>faceCrop(classId).size*THUMB_PX*FACE_UPSCALE;

export interface FaceOptions {
  expression?:FaceExpression;
  /** Imported-face lookup (default: the art manifest). */
  exact?:ExactFace;
  /** Portrait thumb URL of a class (default /art/portraits/<id>-thumb.webp; the HUD passes its ctx.portrait). */
  portrait?:(classId:string)=>string;
  /** CSS px side of the circle: when the thumb crop would upscale too much, the 768 portrait is used (needsLargePortrait). */
  px?:number;
  /** The bigger portrait URL (default portrait768). */
  portraitLarge?:(classId:string)=>string;
}
export interface FaceSource {src:string;frame:FaceFrame;art:boolean;expression:FaceExpression}
/**
 * What a face shows: the imported face (whole image) when there is one, else the portrait with the class crop (the thumb,
 * or the 768 copy when `px` asks for more pixels than the thumb's crop holds).
 */
export function faceSource(classId:string,options:FaceOptions={}):FaceSource{
  const expression=options.expression??'normal';
  const art=importedFaceUrl(classId,expression,options.exact);
  if(art)return {src:art,frame:{...FULL_FRAME},art:true,expression};
  const large=options.px!==undefined&&needsLargePortrait(classId,options.px);
  const src=large?(options.portraitLarge??portrait768)(classId):(options.portrait??thumbUrl)(classId);
  return {src,frame:faceFrame(classId),art:false,expression};
}

/** Class id of a portrait URL (/art/portraits/<id>[-thumb|-768].webp), for parts handed a URL only (the edge arrows). */
export function portraitClass(url:string|undefined):string|undefined{
  return /\/portraits\/([a-z0-9-]+?)(?:-thumb|-768)?\.webp(?:[?#].*)?$/.exec(url??'')?.[1];
}

// ---------- DOM ----------

const escape=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]!);
export interface FaceElementOptions extends FaceOptions {
  /** Extra classes on the circle (the part's own size, ring and filters). */
  className?:string;
  /** Alt text; empty (decorative) by default, since the name sits next to the face everywhere. */
  alt?:string;
  /** The image URL to show instead of faceSource's (a part handed a URL); still cropped as a portrait. */
  src?:string;
  /** faceHtml's circle element: `i` where the part styles its `>span` children (the waiting room's name). */
  tag?:'span'|'i';
}
const resolve=(classId:string,options:FaceElementOptions):FaceSource=>{
  const source=faceSource(classId,options);
  return options.src&&!source.art?{...source,src:options.src}:source;
};

/**
 * HTML of a face: `<span class="face …"><img class="face-img"></span>`, for parts that build innerHTML (lobby chips,
 * edge arrows). `classId` undefined: an empty circle of the same size (the class not known yet), never a jump.
 */
export function faceHtml(classId:string|undefined,options:FaceElementOptions={}):string{
  const cls=`face${options.className?` ${options.className}`:''}`,tag=options.tag??'span';
  if(classId===undefined)return `<${tag} class="${escape(cls)}" aria-hidden="true"></${tag}>`;
  const s=resolve(classId,options);
  return `<${tag} class="${escape(cls)}" data-face="${s.expression}" data-art="${s.art}" style="${varsText(frameVars(s.frame))}"${options.alt?'':' aria-hidden="true"'}>`+
    `<img class="face-img" alt="${escape(options.alt??'')}" decoding="async" draggable="false" src="${escape(s.src)}"></${tag}>`;
}

/** Writes a face on an element made by faceImg; touches the DOM only for what changed. */
export function setFace(node:HTMLElement,classId:string,options:FaceElementOptions={}){
  const s=resolve(classId,options);
  if(node.dataset.face!==s.expression)node.dataset.face=s.expression;
  if(node.dataset.art!==String(s.art))node.dataset.art=String(s.art);
  for(const [k,v] of Object.entries(frameVars(s.frame)))if(node.style.getPropertyValue(k)!==v)node.style.setProperty(k,v);
  const img=node.querySelector<HTMLImageElement>('.face-img');
  if(img&&img.getAttribute('src')!==s.src)img.src=s.src;
}

/** A face element (span.face with its img), for parts that build with createElement (team strip, result cards). */
export function faceImg(doc:Document,classId:string,options:FaceElementOptions={}):HTMLElement{
  const node=doc.createElement('span');node.className=`face${options.className?` ${options.className}`:''}`;
  if(!options.alt)node.setAttribute('aria-hidden','true');
  const img=doc.createElement('img');img.className='face-img';img.alt=options.alt??'';img.decoding='async';img.draggable=false;
  node.append(img);
  setFace(node,classId,options);
  return node;
}
