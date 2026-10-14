/**
 * Menu music (NEW-20261014-ORQ-musica-do-menu): "Escolhe Logo, Rapaz", looping on the creation, classes and waiting-room
 * screens. One MusicTrack like the match's (element -> gain -> the engine's music bus, the same iOS unlock, the same whole-file
 * blob fetch the service worker keeps).
 * - Network: nothing before boot() (src/client/ui/menu-music-boot.ts calls it after the page's load, idle time and a
 *   delay, never on 2g/slow-2g or Save-Data). Then one priority:'low' fetch that yields: a hold (the waiting room's match
 *   pre-download running, lobby.ts) or the match scene aborts it (AbortController, the worker forwards the abort). It
 *   starts again (from the worker's cache once it finished) back in the menu with no hold.
 * - Sound: only after a gesture (the engine's unlock). One owner decides menu vs match: setMusicScene (explore.ts, from
 *   the room's phase). 'menu' fades in (MENU_IN_S); 'match' fades out (MENU_OUT_S) while the HUD's GameMusic takes over
 *   (its theme waits THEME_LOAD_DELAY_MS, so the two never overlap at full volume). The "Música" mute and volume and a hidden tab apply
 *   as in the match.
 */
import {bindPage,defaultElement,musicHost,MusicTrack,type MusicOptions,type Page,type TrackSpec} from './music.ts';
import {getAudio} from './engine.ts';

/** ~35 % of the music bus: louder than the match's theme (0.25), there are no effects over it. */
export const MENU_LEVEL=.35;
export const MENU_TRACK:Readonly<TrackSpec>=Object.freeze({webm:'/audio/menu.webm',m4a:'/audio/menu.m4a',level:MENU_LEVEL,rewind:false});
export const MENU_IN_S=2;
export const MENU_OUT_S=1.5;
export type MusicScene='menu'|'match';
export interface MenuMusicOptions extends Omit<MusicOptions,'sources'> {
  /** Overrides the format pick (tests); null silences the menu. */
  source?:string|null;
}

export class MenuMusic {
  private scn:MusicScene='menu';
  private holds=0;
  private page:Page|undefined;
  private music:MusicTrack|undefined;
  private detachers:(()=>void)[]=[];

  get scene(){return this.scn;}
  /** Something more important is downloading: the menu file waits. */
  get held(){return this.holds>0;}
  /** Undefined until boot(). */
  get track(){return this.music;}

  /** The menu is interactive: from now the file may download and the first gesture starts it. Once. */
  boot(page:Page,opts:MenuMusicOptions={engine:getAudio()}){
    if(this.music)return;
    const host=musicHost(opts,()=>this.page);
    let el;
    try{el=(opts.createElement??defaultElement)(MENU_TRACK);}catch{el=undefined;}
    const track=this.music=new MusicTrack(MENU_TRACK,host,el,opts.source);
    if(!track.source)return;
    this.page=page;
    this.detachers.push(bindPage(opts.engine,page,()=>track.gesture(),()=>track.follow()),opts.engine.onChange(()=>track.follow()));
    this.sync();
  }

  setScene(scene:MusicScene){
    if(scene===this.scn)return;
    this.scn=scene;this.sync();
  }

  /** Holds the menu's download (aborting a running one) until the returned release runs; releasing twice is harmless. */
  hold():()=>void{
    this.holds++;this.sync();
    let on=true;
    return ()=>{if(!on)return;on=false;this.holds--;this.sync();};
  }

  dispose(){
    for(const detach of this.detachers.splice(0))detach();
    this.music?.dispose();
  }

  private sync(){
    const track=this.music;
    if(!track?.source)return;
    const menu=this.scn==='menu';
    if(menu&&!this.holds)track.load();else track.cancelLoad();
    if(menu)track.play(MENU_IN_S);else track.stop(MENU_OUT_S);
  }
}

let shared:MenuMusic|undefined;
/** The page's one menu music (no element, no engine and no network until boot). */
export const menuMusic=()=>shared??=new MenuMusic();
export const bootMenuMusic=(page:Page)=>menuMusic().boot(page);
export const setMusicScene=(scene:MusicScene)=>menuMusic().setScene(scene);
export const holdMenuDownload=()=>menuMusic().hold();
/** A room phase's music: the waiting room (lobby, countdown) is the menu's; combat and the result screen the match's. */
export const sceneOfPhase=(phase:string|undefined):MusicScene=>phase==='combat'||phase==='result'?'match':'menu';
