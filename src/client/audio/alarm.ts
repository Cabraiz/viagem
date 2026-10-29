/**
 * The Uno's car alarm (card NEW-20261023-ORQ-inimigos-querem-o-uno, etapa 4): the classic siren rising and falling with
 * a short horn between, repeating softly while the objective runs: it is the noise that draws the critters.
 * - one pass, then ALARM_GAP_S of silence, then again (NEW-20261025-ORQ-alarme-uno-pausa: "toca uma vez e espera 4
 *   segundos e toca novamente"): the looped buffer is the pass plus the gap (alarmWithGap), the pass's ends faded so
 *   the step into silence never clicks;
 * - positional: silent beyond ALARM_RADIUS_U from the hero (no constant bed), louder coming close, louder still while
 *   the car takes hits (alarmLevel);
 * - it plays into the effects bus (engine.ts effectsOutput): the game's effects volume and mute apply, and the ad
 *   break's hush (engine.setHushed) silences it with everything else;
 * - the sound: the TangoFlux loop (3.5 s: siren, then "beep beep", ~37 KB; scripts/import-uno-alarme.mjs) fetched
 *   once the objective runs; the synthesized one (alarmSamples) plays instead when the file fails or is still on its
 *   way after ALARM_FILE_WAIT_MS.
 * Pure rules and samples (tested) plus one small WebAudio part (AlarmLoop).
 */
import {SFX_DIR,pickSfxFormat,type SfxFormat} from './sfx.ts';

/** Beyond this distance from the hero (world units) the alarm is silent. */
export const ALARM_RADIUS_U=24;
/** Its loudest level (under the effects bus), right by the car; ×ALARM_HIT_BOOST while it takes hits (capped at 1). */
export const ALARM_MAX=.32,ALARM_HIT_BOOST=1.7;
/** How fast the level follows (s, time constant): no clicks, no lag the ear notices. */
export const ALARM_RAMP_S=.12;
/** The TangoFlux loop's files (no extension). */
export const ALARM_FILE=`${SFX_DIR}uno-alarme`;
/** How long an audible alarm waits for its file before the synthesized loop plays (ms). */
export const ALARM_FILE_WAIT_MS=3000;
/** The synthesized loop's length (s): two siren sweeps, then two horn blasts. */
export const ALARM_LOOP_S=2.4;
/** The silence after each pass of the alarm before the next one (s). */
export const ALARM_GAP_S=4;
/** The fade at each end of a pass (s): the pass meets the gap at zero. */
export const ALARM_EDGE_FADE_S=.01;

/** The alarm stays loud this long after the car's last hit (ms). */
export const ALARM_HIT_MS=1500;
/**
 * Whether the alarm is loud now (ALARM_HIT_BOOST): while the sim's own alarm runs (render/chaveiro/rules.ts alarmOn,
 * the car's hits push it on; card som-alarme-gema-e-chefe) or within ALARM_HIT_MS of a hit the client saw.
 */
export function alarmHit(alarmed:boolean,sinceHitMs:number){return alarmed||sinceHitMs<=ALARM_HIT_MS;}

/** The alarm's level for the hero `distance` units away (0 beyond the radius), louder while `hit`. */
export function alarmLevel(distance:number,hit:boolean):number{
  if(!Number.isFinite(distance)||distance<0||distance>=ALARM_RADIUS_U)return 0;
  const near=1-distance/ALARM_RADIUS_U,level=ALARM_MAX*near*near;
  return Math.min(1,hit?level*ALARM_HIT_BOOST:level);
}

/**
 * The provisional loop at `rate` Hz (mono): 0–1.6 s the siren (a triangle sweeping 650 ↔ 1350 Hz twice, 0.8 s each up
 * and down), 1.7–1.85 s and 2.0–2.15 s the horn (420 Hz + 525 Hz, a soft square), silence between. Every part fades in
 * and out over FADE_S, so the loop's ends meet at zero: no click at the seam. Peak ≤ 0.8.
 */
export function alarmSamples(rate:number):Float32Array{
  const n=Math.max(1,Math.round(ALARM_LOOP_S*rate)),out=new Float32Array(n),FADE_S=.012;
  const env=(t:number,a:number,b:number)=>t<a||t>=b?0:Math.min(1,(t-a)/FADE_S,(b-t)/FADE_S);
  let phase=0;
  for(let i=0;i<n;i++){
    const t=i/rate;
    let v=0;
    const siren=env(t,0,1.6);
    if(siren>0){
      const sweep=(t%.8)/.8,f=650+700*(sweep<.5?sweep*2:2-sweep*2);
      phase+=f/rate;
      const tri=1-4*Math.abs((phase%1)-.5);
      v+=.55*siren*tri;
    }
    const horn=Math.max(env(t,1.7,1.85),env(t,2,2.15));
    if(horn>0){
      const sq=(f:number)=>Math.tanh(3*Math.sin(2*Math.PI*f*t))/Math.tanh(3);
      v+=.4*horn*(sq(420)+sq(525))/2;
    }
    out[i]=Math.max(-.8,Math.min(.8,v));
  }
  return out;
}

/**
 * The buffer the voice loops: one pass of `sound` (per channel, at `rate` Hz) with its ends faded over
 * ALARM_EDGE_FADE_S, then ALARM_GAP_S of silence. Looped, it plays the pass, waits, and plays it again.
 */
export function alarmWithGap(sound:readonly Float32Array[],rate:number):Float32Array[]{
  const gap=Math.round(ALARM_GAP_S*rate),fade=Math.max(1,Math.round(ALARM_EDGE_FADE_S*rate));
  return sound.map(channel=>{
    const n=channel.length,out=new Float32Array(n+gap);
    out.set(channel);
    for(let i=0;i<Math.min(fade,n);i++){const k=i/fade;out[i]*=k;out[n-1-i]*=k;}
    return out;
  });
}

/** The engine's surface the loop needs (getAudio() gives it; tests pass a stand-in). */
export interface AlarmAudio {readonly unlocked:boolean;readonly context:AudioContext|undefined;readonly effectsOutput:AudioNode|undefined}
export interface AlarmOptions {
  /** Downloads the file (default: a low-priority fetch in a browser, none elsewhere); `null` = the synthesized loop only. */
  loadFile?:((url:string)=>Promise<ArrayBuffer>)|null;
  /** The file's format (default: what an <audio> element says it plays). */
  format?:SfxFormat|null;
  nowMs?:()=>number;
}

function defaultLoader():((url:string)=>Promise<ArrayBuffer>)|null{
  if(!globalThis.location||typeof globalThis.fetch!=='function')return null;
  return async url=>{
    const response=await fetch(url,{priority:'low'} as RequestInit);
    if(!response.ok)throw new Error(`${url}: ${response.status}`);
    return response.arrayBuffer();
  };
}
function defaultFormat():SfxFormat|null{
  try{
    const audio=globalThis.document?.createElement?.('audio');
    return audio&&typeof audio.canPlayType==='function'?pickSfxFormat(type=>audio.canPlayType(type)):null;
  }catch{return null;}
}

/**
 * The looping voice: made on the first audible frame (after the unlock), its level eased toward alarmLevel every frame,
 * stopped (and its graph dropped) once the objective goes. One per run screen.
 */
export class AlarmLoop {
  private src?:AudioBufferSourceNode;
  private gain?:GainNode;
  /** The looped buffers (pass + gap): the synthesized one and the file's. */
  private buffer?:AudioBuffer;
  private fileBuffer?:AudioBuffer;
  /** The file: decoded, on its way (since `loadingSince`), failed, or never asked (no loader or format). */
  private file?:AudioBuffer|'loading'|'failed';
  private loadingSince=0;
  private readonly audio:AlarmAudio;
  private readonly loadFile:((url:string)=>Promise<ArrayBuffer>)|null;
  private readonly format:SfxFormat|null;
  private readonly nowMs:()=>number;
  constructor(audio:AlarmAudio,opts:AlarmOptions={}){
    this.audio=audio;
    this.loadFile=opts.loadFile===undefined?defaultLoader():opts.loadFile;
    this.format=opts.format===undefined?(this.loadFile?defaultFormat():null):opts.format;
    this.nowMs=opts.nowMs??(()=>performance.now());
  }

  /** Every frame: `live` the objective runs; the hero's distance to the car; whether it took a hit just now. */
  update(live:boolean,distance:number,hit:boolean){
    const level=live?alarmLevel(distance,hit):0;
    if(!live){this.stop();return;}
    const ctx=this.audio.context,out=this.audio.effectsOutput;
    if(!this.audio.unlocked||!ctx||!out)return;
    this.load(ctx);
    if(!this.src){
      if(level<=0)return; // nothing to hear yet: no voice either
      const buffer=this.pick(ctx);
      if(!buffer)return; // the file is on its way: a moment of silence, then it (or the synthesized loop)
      try{
        const gain=this.gain=ctx.createGain();gain.gain.value=0;gain.connect(out);
        const src=this.src=ctx.createBufferSource();src.buffer=buffer;src.loop=true;src.connect(gain);src.start();
      }catch{this.stop();return;}
    }
    this.gain?.gain.setTargetAtTime?.(level,ctx.currentTime,ALARM_RAMP_S);
  }
  stop(){
    try{this.src?.stop();}catch{/* never started */}
    try{this.src?.disconnect();this.gain?.disconnect();}catch{/* already */}
    this.src=undefined;this.gain=undefined;
  }
  /** Starts fetching and decoding the file once (when there is a loader and a format). */
  private load(ctx:AudioContext){
    const load=this.loadFile,format=this.format;
    if(this.file||!load||!format)return;
    this.file='loading';this.loadingSince=this.nowMs();
    let job:Promise<ArrayBuffer>;
    try{job=load(`${ALARM_FILE}.${format}`);}catch(error){job=Promise.reject(error);}
    job.then(data=>ctx.decodeAudioData(data)).then(buffer=>{this.file=buffer;},()=>{this.file='failed';});
  }
  /** The loop to play now: the file, else (failed, none, or too slow) the synthesized one; undefined = keep waiting. */
  private pick(ctx:AudioContext):AudioBuffer|undefined{
    const file=this.file;
    if(typeof file==='object'){
      const channels=Array.from({length:file.numberOfChannels},(_,c)=>file.getChannelData(c));
      return this.fileBuffer??=makeBuffer(ctx,alarmWithGap(channels,file.sampleRate),file.sampleRate);
    }
    if(file==='loading'&&this.nowMs()-this.loadingSince<ALARM_FILE_WAIT_MS)return undefined;
    return this.buffer??=makeBuffer(ctx,alarmWithGap([alarmSamples(ctx.sampleRate)],ctx.sampleRate),ctx.sampleRate);
  }
}

function makeBuffer(ctx:AudioContext,channels:Float32Array[],rate:number):AudioBuffer{
  const buffer=ctx.createBuffer(channels.length,channels[0].length,rate);
  channels.forEach((data,c)=>buffer.getChannelData(c).set(data));
  return buffer;
}
