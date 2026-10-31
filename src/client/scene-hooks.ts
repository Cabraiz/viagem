/** The hooks the shell (explore.ts) gives the island scene (scene.ts createIsland). Moved out of scene.ts as is. */
import type {FearFrame} from './render/fear-rules.ts';
import type {Rect} from './framing.ts';
import type {CoopClient} from './net/client.ts';
import type {Point} from '../maps/index.ts';
import type {RunView} from '../contract/index.ts';
import type {QualityLevel} from './quality.ts';
import type {CenaClock} from './render/chefao-cena.ts';

export interface SceneHooks {
  classId:string;
  direction:()=>Point;
  position:(point:Point)=>void;
  discovered:(index:number)=>void;
  ready:()=>void;
  terrain?:(seed:number,signature:string)=>void;
  message:(text:string)=>void;
  /** The hero's animation for tests and scripts, at most every VISUAL_HOOK_MS (it lists every texture to count the sheets). */
  visual?:(animation:string,frame:string,sheets:number)=>void;
  net?:CoopClient;
  /** The chefão's arrival scene (render/chefao-cena.ts): the camera goes to him, holds and comes back. Absent: none. */
  cena?:CenaClock;
  /**
   * D-051 manual combat: one input step's attack (hud/attack-button.ts take(): held, or tapped since the last step),
   * sent as PlayerInput.attack. Absent or false: no attack (the automatic weapons fire on their own).
   */
  attacking?:()=>boolean;
  /** Whether the attack is held now, without spending a tap (attacking() latches it for the next input step). */
  attackHeld?:()=>boolean;
  /** The scene-clock time of hero `id`'s last "Dançar" (empty hands, own or relayed): it dances from it, like a cheer. */
  danceAt?:(id:string)=>number|undefined;
  /** The auto aim's pick (world), for the predicted shot's direction (tiro-delay-1s-predicao). */
  aimPick?:()=>Point|undefined;
  /** Bicos (hud/bicos.ts WorkLatch): one input step's Trabalhar, given that step's direction (moving lets it go). */
  working?:(direction:Point)=>boolean;
  /** D-051 manual combat: a click or tap on an enemy chose it; the button attacks it once. Absent: only the target. */
  enemyPicked?:(id:string)=>void;
  /** D-051: the right mouse button pressed (true) or let go (false) holds the attack like Space. Absent: no manual attack. */
  attackHold?:(down:boolean)=>void;
  /** The phone's aim stick over the attack button (tiro-na-direcao-mobile): its world direction while it aims, else undefined. */
  aimStick?:()=>Point|undefined;
  /** D-051: the room plays the manual combat (the target words say "ataque", not "a arma atira sozinha"). */
  manual?:()=>boolean;
  /** Each new authoritative RunView (coop only), right after the horde renderer got it: the HUD consumes it. */
  runView?:(view:RunView)=>void;
  /** The HUD's kill-cam picture (CSS px, viewport coordinates) while it shows, VGM-053B. */
  killcamRect?:()=>Rect|undefined;
  /** Quality level at start (Q3: Leve is the old economy mode plus a still scenery; default Normal); setQuality changes it live. */
  quality?:QualityLevel;
  /** The FPS watch saw the first 10 s of combat under 40 fps (coop, above Leve): the shell steps the level down and says so. */
  slow?:()=>void;
  /**
   * Fear (card fear-escuridao-sozinho): every frame of a run once the dark has shown, what it is now (seconds alone,
   * the notice, a heartbeat starting): the HUD writes the notice and dims the portraits, the sound plays the beat.
   */
  fear?:(frame:FearFrame,far:readonly string[])=>void;
  /** The player's zoom at start (camera-zoom.ts: a factor on the follow zoom; default ZOOM_DEFAULT). */
  zoom?:number;
  /** The wheel or a pinch changed the wanted zoom (the shell saves it). */
  zoomChanged?:(k:number)=>void;
  /** The computer's fixed zoom (zoom-fixo-pc): `zoom` as given (camera-zoom.ts ZOOM_DESKTOP), the wheel and pinch do nothing. */
  zoomLocked?:boolean;
}
