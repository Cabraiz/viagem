/**
 * Desktop controls (NEW-20261013-ORQ-controles-desktop, D-044): WASD or the arrows, Q/E to turn the camera, Space for
 * the skill, T for the emote bar, and the mouse like Warcraft 3 (click the ground to walk there, hold to follow the
 * cursor). The phone keeps the joystick (D-009). Pure helpers only: explore.ts and scene.ts wire them to the DOM and
 * to Phaser; the input still leaves through the joystick's path (net.input, input-10hz), no protocol change.
 */

/** Which controls the shell shows: 'mouse' hides the joystick and speaks of keys and clicks. */
export type InputKind='mouse'|'touch';
interface Pt {x:number;y:number}

/**
 * The input kind, never from the user agent: a fine pointer at start (matchMedia('(pointer:fine)')), or the first real
 * mouse event or game key, makes it 'mouse'; a finger on the screen (touch pointerdown) puts it back to 'touch'.
 */
export class InputKindWatch {
  kind:InputKind;
  constructor(finePointer:boolean){this.kind=finePointer?'mouse':'touch';}
  /** A pointer event (down: pointerdown; else a move). True when the kind changed. */
  pointer(pointerType:string,down:boolean):boolean{
    if(pointerType==='mouse')return this.set('mouse');
    if(pointerType==='touch'&&down)return this.set('touch');
    return false;
  }
  /** A keydown: only the game's own keys count (a phone's on-screen keyboard sends none of them). */
  key(code:string,key=''):boolean{return isGameKey(code,key)?this.set('mouse'):false;}
  private set(kind:InputKind){if(this.kind===kind)return false;this.kind=kind;return true;}
}
/** The fine-pointer media query, read once when the shell opens (false where matchMedia is missing). */
export function finePointer(match:((query:string)=>{matches:boolean})|undefined=globalThis.matchMedia?.bind(globalThis)):boolean{
  try{return !!match?.('(pointer:fine)').matches;}catch{return false;}
}

/** Movement keys by KeyboardEvent.code (the arrows, and W,A,S,D on a QWERTY board). */
export const MOVE_KEYS:Readonly<Record<'up'|'down'|'left'|'right',readonly string[]>>={
  up:['KeyW','ArrowUp'],down:['KeyS','ArrowDown'],left:['KeyA','ArrowLeft'],right:['KeyD','ArrowRight'],
};
/** The movement letters as Phaser's addKeys('W,A,S,D') reads them: by the layout's letter, not the key's place. */
const MOVE_LETTERS=new Set(['w','a','s','d']);
/**
 * The hotkeys: Q/E turn the camera like its ↶ ↷ buttons (data-turn -1/1), T the emote bar, matched by the layout's
 * letter (KeyboardEvent.key) like Phaser's W,A,S,D, so on AZERTY the "A" key (code KeyQ) walks and never turns.
 * Space casts the skill, matched by its code (its key is " ").
 */
export const HOTKEY_LETTERS:Readonly<Record<string,Hotkey>>={q:{kind:'turn',turn:-1},e:{kind:'turn',turn:1},t:{kind:'emote'}};
export const HOTKEY_CODES:Readonly<Record<string,Hotkey>>={Space:{kind:'skill'}};
export type Hotkey={kind:'turn';turn:-1|1}|{kind:'skill'}|{kind:'emote'};
/** The hotkey a key stands for, with no other check (hotkeyOf adds the page's). */
export function hotkeyFor(code:string,key=''):Hotkey|undefined{return HOTKEY_CODES[code]??(key.length===1?HOTKEY_LETTERS[key.toLowerCase()]:undefined);}
/** A key the game answers: movement (by code or by letter) or a hotkey. */
export function isGameKey(code:string,key=''):boolean{
  return Object.values(MOVE_KEYS).some(codes=>codes.includes(code))||MOVE_LETTERS.has(key.toLowerCase())||!!hotkeyFor(code,key);
}

/**
 * Held movement keys to a screen vector (the stick's frame: +x right, +y down). Eight directions, unit length;
 * opposite keys cancel (W+S: no vertical part). scene.ts adds it to the stick and turns it with screenDirection.
 */
export function keyVector(held:{up?:boolean;down?:boolean;left?:boolean;right?:boolean}):{sx:number;sy:number}{
  const x=Number(!!held.right)-Number(!!held.left),y=Number(!!held.down)-Number(!!held.up);
  const length=Math.hypot(x,y);
  return length?{sx:x/length,sy:y/length}:{sx:0,sy:0};
}
/** Q/E (the layout's letters) to the camera turn (the data-turn of the button it presses), undefined for any other key. */
export function turnFor(key:string):-1|1|undefined{const hotkey=hotkeyFor('',key);return hotkey?.kind==='turn'?hotkey.turn:undefined;}

/** What a keydown is aimed at, as much as the hotkeys need to know. */
export interface KeyLike {code:string;key?:string;ctrlKey?:boolean;altKey?:boolean;metaKey?:boolean;target?:EventTarget|{tagName?:string;isContentEditable?:boolean}|null}
/**
 * The hotkey of a keydown, or undefined when the key must stay with the page: a modifier held (browser shortcuts), the
 * settings window open, or typing in a field. A focused button does not keep Space: Phaser captures Space (it prevents
 * the default of its keydown and keyup), so the browser never presses that button and Space would be dead after a click
 * on the emote toggle; explore.ts also prevents Space's keyup default, so a focused skill button never casts twice.
 * Escape is never a hotkey: the windows (offer, obra) and the shell keep it.
 */
export function hotkeyOf(event:KeyLike,settingsOpen:boolean):Hotkey|undefined{
  const hotkey=hotkeyFor(event.code,event.key);
  if(!hotkey||settingsOpen||event.ctrlKey||event.altKey||event.metaKey)return undefined;
  const target=event.target as {tagName?:string;isContentEditable?:boolean}|null|undefined,tag=target?.tagName?.toUpperCase();
  if(target?.isContentEditable||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return undefined;
  return hotkey;
}

/** The game's own window: the whole match is a modal <dialog> (explore.ts showModal), so it never blocks a game key. */
export const SHELL_DIALOG='.explore-shell';
/** Dona Cida's keys (D-047, hud/cida.ts): C opens or closes her tray, 1–3 buy the sweet in that place, Esc closes. */
export type CidaKey={kind:'toggle'}|{kind:'buy';index:0|1|2}|{kind:'close'};
type KeyTarget={tagName?:string;isContentEditable?:boolean;closest?(selector:string):unknown};
/**
 * The Cida key of a keydown, or undefined when the key stays with the page: a repeat, a modifier held, typing in a
 * field, or another window open over the match (the settings dialog: `otherDialogOpen`, or the key coming from inside
 * a dialog that is not the game's shell). C goes by the layout's letter like Q/E/T (by the key code when there is no
 * letter); the digits by code (top row or numpad).
 */
export function cidaKeyOf(event:KeyLike&{repeat?:boolean},otherDialogOpen:boolean):CidaKey|undefined{
  if(event.repeat||otherDialogOpen||event.ctrlKey||event.altKey||event.metaKey)return undefined;
  const target=event.target as KeyTarget|null|undefined,tag=target?.tagName?.toUpperCase();
  if(target?.isContentEditable||tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return undefined;
  if(target?.closest?.(`dialog[open]:not(${SHELL_DIALOG})`))return undefined;
  const key=event.key??'';
  if(key.length===1?key.toLowerCase()==='c':event.code==='KeyC')return {kind:'toggle'};
  if(event.code==='Escape'||key==='Escape')return {kind:'close'};
  const n=/^(?:Digit|Numpad)([1-3])$/.exec(event.code)?.[1];
  return n?{kind:'buy',index:(Number(n)-1) as 0|1|2}:undefined;
}

/**
 * Focus lost (window blur, tab hidden). Touch keeps today's pause ("Controles pausados", the stick brings it back).
 * Mouse never pauses: everything held is let go (keys, stick, the held mouse button) so nothing walks on by itself, and
 * the game goes on as normal when the focus comes back.
 */
export function focusLost(kind:InputKind,actions:{pause:()=>void;release:()=>void}){
  if(kind==='mouse')actions.release();else actions.pause();
}

/** Hold-to-follow: the ground point under a held button is walked to again at most this often… */
export const HOLD_RETARGET_MS=150;
/** …and only when it moved at least this far (world units) from the last one. */
export const HOLD_MIN_MOVE=.3;
/** The destination marker of a mouse click (or of letting go of the button) shows this long; a tap keeps it to the end. */
export const MARKER_MS=600;

/**
 * Warcraft 3 hold: press on the ground starts it (the click's own walk is the first target); while the button stays down,
 * move() hands back a new target no more often than HOLD_RETARGET_MS and only past HOLD_MIN_MOVE of change; release()
 * ends it and hands back the last target (where the release marker goes).
 */
export class HoldFollow {
  held=false;
  private at=-Infinity;
  private last?:Pt;
  readonly intervalMs:number;
  readonly minMove:number;
  constructor(intervalMs=HOLD_RETARGET_MS,minMove=HOLD_MIN_MOVE){this.intervalMs=intervalMs;this.minMove=minMove;}
  press(point:Pt,now:number){this.held=true;this.at=now;this.last={x:point.x,y:point.y};}
  move(point:Pt,now:number):Pt|undefined{
    if(!this.held||now-this.at<this.intervalMs)return undefined;
    if(this.last&&Math.hypot(point.x-this.last.x,point.y-this.last.y)<this.minMove)return undefined;
    this.at=now;this.last={x:point.x,y:point.y};
    return this.last;
  }
  release():Pt|undefined{const last=this.held?this.last:undefined;this.held=false;this.last=undefined;this.at=-Infinity;return last;}
}
/** Whether the destination marker shows: until the end of the walk (no deadline, a tap), or until its deadline (mouse). */
export function markerVisible(until:number|undefined,now:number):boolean{return until===undefined||now<until;}

/** The explore shell's walk texts per input kind (the phone's are the ones it always had). */
export const INPUT_TEXTS:Readonly<Record<InputKind,{soloNotice:string;soloHelp:string;coopNotice:string}>>={
  touch:{soloNotice:'Toque na trilha para caminhar.',soloHelp:'Toque no chão ou use o direcional.',
    coopNotice:'Arraste para andar. A arma atira sozinha; toque num bicho para priorizar o alvo.'},
  mouse:{soloNotice:'Clique na trilha para caminhar.',soloHelp:'Clique no chão ou use WASD e as setas.',
    coopNotice:'WASD, setas ou clique pra andar. A arma atira sozinha; clique num bicho para priorizar o alvo.'},
};
