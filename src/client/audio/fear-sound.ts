/**
 * The sound of the dark (card NEW-20261023-ORQ-fear-escuridao-sozinho, etapa 3): a low whisper that grows with the fear
 * while the hero is alone, and over the last stretch (render/fear-rules.ts) a heartbeat on every beat of the clock that
 * makes the circle throb, louder and faster toward the end.
 * - both synthesized here (no file to fetch, nothing to license): the whisper is a breathy noise band with slow,
 *   syllable-like swells (a loop whose ends meet at zero), the beat a "lub-dub" of two low thumps;
 * - they play into the effects bus (engine.ts effectsOutput): the effects volume, the mute and the ad break's hush apply.
 * Pure samples and levels (tested) plus one small WebAudio part (FearSound).
 */
import {FEAR_SECONDS,FEAR_SHOW_SECONDS} from '../../rules/index.ts';

/** The whisper's loudest level (under the effects bus), at the end of the minute. */
export const WHISPER_MAX=.22;
/** The heartbeat's level at the start and at the end of the last stretch. */
export const BEAT_LEVEL={from:.35,to:.75} as const;
/** How fast the whisper's level follows (s, time constant). */
export const WHISPER_RAMP_S=.25;
/** The whisper loop's length (s). */
export const WHISPER_LOOP_S=4;

/** The whisper's level for `seconds` alone: silent until the dark shows, then rising (slow at first) to WHISPER_MAX. */
export function whisperLevel(seconds:number):number{
  if(!(seconds>FEAR_SHOW_SECONDS))return 0;
  const t=Math.min(1,(seconds-FEAR_SHOW_SECONDS)/(FEAR_SECONDS-FEAR_SHOW_SECONDS));
  return WHISPER_MAX*t*t;
}
/** The heartbeat's level at `final` (0..1) through the last stretch. */
export const beatLevel=(final:number)=>BEAT_LEVEL.from+(BEAT_LEVEL.to-BEAT_LEVEL.from)*Math.max(0,Math.min(1,final));

/** A small seeded generator (mulberry32): the same loop on every phone. */
function rng(seed:number){
  let a=seed>>>0;
  return ()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
}

/**
 * The whisper loop at `rate` Hz (mono): white noise through a band-pass (two one-pole stages around 350–1400 Hz, the
 * breath of a voice) under an envelope of soft swells (2–5 per second, like syllables) on a slow breathing rise and fall.
 * The loop starts and ends at zero (FADE_S), so it repeats without a click. Peak ≤ 0.8.
 */
export function whisperSamples(rate:number,seed=7):Float32Array{
  const n=Math.max(1,Math.round(WHISPER_LOOP_S*rate)),out=new Float32Array(n),rand=rng(seed),FADE_S=.05;
  // Swells: random centres and widths over the loop.
  const swells:{at:number;width:number;gain:number}[]=[];
  for(let t=.1;t<WHISPER_LOOP_S-.1;t+=.2+rand()*.3)swells.push({at:t,width:.06+rand()*.1,gain:.4+rand()*.6});
  const hp=Math.exp(-2*Math.PI*350/rate),lp=Math.exp(-2*Math.PI*1400/rate);
  let low=0,lowHp=0,peak=0;
  for(let i=0;i<n;i++){
    const t=i/rate,white=rand()*2-1;
    lowHp=lowHp*hp+white*(1-hp); // ~350 Hz low-pass, subtracted below = high-pass
    low=low*lp+(white-lowHp)*(1-lp); // then ~1400 Hz low-pass
    let env=0;
    for(const s of swells){const d=(t-s.at)/s.width;if(d>-3&&d<3)env+=s.gain*Math.exp(-d*d);}
    const breath=.6+.4*Math.sin(2*Math.PI*t/WHISPER_LOOP_S-Math.PI/2);
    const edge=Math.min(1,t/FADE_S,(WHISPER_LOOP_S-t)/FADE_S);
    out[i]=low*Math.min(1.4,env)*breath*edge;
    peak=Math.max(peak,Math.abs(out[i]));
  }
  if(peak>0)for(let i=0;i<n;i++)out[i]*=.8/peak;
  return out;
}

/**
 * One heartbeat at `rate` Hz (mono, ~0.5 s): a "lub" (a 62→38 Hz sine thump with a soft click of 120 Hz on top) and,
 * 0.28 s later, a weaker "dub" (70→44 Hz), each with a 5 ms attack and a fast decay. Starts and ends at zero. Peak ≤ 0.9.
 */
export function heartbeatSamples(rate:number):Float32Array{
  const LEN_S=.55,n=Math.max(1,Math.round(LEN_S*rate)),out=new Float32Array(n);
  const thump=(t:number,from:number,to:number,decay:number,gain:number,phase:{v:number})=>{
    if(t<0)return 0;
    const f=to+(from-to)*Math.exp(-t/.05);phase.v+=f/rate;
    const env=Math.min(1,t/.005)*Math.exp(-t/decay);
    return gain*env*(Math.sin(2*Math.PI*phase.v)+.25*Math.sin(2*Math.PI*phase.v*3.1)*Math.exp(-t/.012));
  };
  const lub={v:0},dub={v:0};
  for(let i=0;i<n;i++){
    const t=i/rate,edge=Math.min(1,(LEN_S-t)/.03);
    out[i]=Math.max(-.9,Math.min(.9,(thump(t,62,38,.07,.9,lub)+thump(t-.28,70,44,.06,.6,dub))*edge));
  }
  return out;
}

/** The engine's surface the voices need (getAudio() gives it; tests pass a stand-in). */
export interface FearAudio {readonly unlocked:boolean;readonly context:AudioContext|undefined;readonly effectsOutput:AudioNode|undefined}

/**
 * The two voices, one per run screen: the whisper loop made on the first audible frame, its level eased every frame;
 * the heartbeat a one-shot per thump. Stopped (graph dropped) once the dark is gone.
 */
export class FearSound {
  private whisper?:{src:AudioBufferSourceNode;gain:GainNode};
  private whisperBuffer?:AudioBuffer;
  private beatBuffer?:AudioBuffer;
  private readonly audio:FearAudio;
  constructor(audio:FearAudio){this.audio=audio;}
  /** Every frame: seconds alone (drawn), whether a heartbeat starts now and how far through the last stretch. */
  update(seconds:number,thump:boolean,final:number){
    const level=whisperLevel(seconds);
    const ctx=this.audio.context,out=this.audio.effectsOutput;
    if(!this.audio.unlocked||!ctx||!out){if(level<=0)this.stop();return;}
    if(level<=0&&!thump){if(this.whisper)this.whisper.gain.gain.setTargetAtTime?.(0,ctx.currentTime,WHISPER_RAMP_S/2);if(seconds<=0)this.stop();return;}
    try{
      if(!this.whisper&&level>0){
        const buffer=this.whisperBuffer??=this.buffer(ctx,whisperSamples(ctx.sampleRate));
        const gain=ctx.createGain();gain.gain.value=0;gain.connect(out);
        const src=ctx.createBufferSource();src.buffer=buffer;src.loop=true;src.connect(gain);src.start();
        this.whisper={src,gain};
      }
      this.whisper?.gain.gain.setTargetAtTime?.(level,ctx.currentTime,WHISPER_RAMP_S);
      if(thump){
        const buffer=this.beatBuffer??=this.buffer(ctx,heartbeatSamples(ctx.sampleRate));
        const gain=ctx.createGain();gain.gain.value=beatLevel(final);gain.connect(out);
        const src=ctx.createBufferSource();src.buffer=buffer;src.connect(gain);
        src.onended=()=>{try{src.disconnect();gain.disconnect();}catch{/* already */}};
        src.start();
      }
    }catch{this.stop();}
  }
  stop(){
    const w=this.whisper;this.whisper=undefined;
    if(!w)return;
    try{w.src.stop();}catch{/* never started */}
    try{w.src.disconnect();w.gain.disconnect();}catch{/* already */}
  }
  private buffer(ctx:AudioContext,data:Float32Array):AudioBuffer{
    const buffer=ctx.createBuffer(1,data.length,ctx.sampleRate);
    buffer.getChannelData(0).set(data);
    return buffer;
  }
}
