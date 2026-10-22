/**
 * BUG heroi-vai-e-volta lab: the local hero's drawn position on a phone link (latency, jitter, uneven frames), in node.
 *
 * The real room simulation (multiplayer/simulation.ts with its InputTrack), the real client pieces (InputBatcher,
 * maps/prediction.ts reconcile, smoothing.ts SelfCorrection, framing.ts StepLerp) and a model of the rest:
 * - room: TickClock on a wall clock whose fires come a little late (and now and then very late: a busy isolate),
 *   one frame every 2 ticks (own position = Simulation.confirmed or the live one);
 * - link: one-way latency + jitter, order kept (TCP);
 * - phone: rAF frames of ~16.7 ms with jitter and now and then a long frame (GC, a busy main thread); messages are
 *   handled at the start of a frame, the scene's 50 ms accumulator (capped at 200 ms) steps the prediction.
 * It counts recuos: frames where the drawn hero moves against the stick's direction (dot < -eps) while walking.
 *
 * node --experimental-strip-types scripts/lab-recuo.ts [seconds] [seed]
 */
import {Simulation} from '../multiplayer/simulation.ts';
import {TickClock} from '../multiplayer/tick-clock.ts';
import {reconcile,simulate,STEP} from '../src/maps/prediction.ts';
import {InputBatcher} from '../src/protocol/input-track.ts';
import {SelfCorrection} from '../src/client/net/smoothing.ts';
import {StepLerp,stepClock} from '../src/client/framing.ts';
import type {PlayerInput,Point} from '../src/contract/index.ts';
import {setRosterOnlyWithArt} from '../src/rules/enemy-rotation.ts';
setRosterOnlyWithArt(false);

export interface LinkOptions {
  /** One-way latency (ms) and extra random delay on top (ms, uniform 0..jitter). */
  latency:number;jitter:number;
  /** Phone: chance per frame of a long frame and its length (ms). */
  longFrameChance:number;longFrameMs:number;
  /** Room: chance per fire of a busy isolate and how late (ms). */
  busyChance:number;busyMs:number;
  seconds:number;seed:number;
  /** The stick: walks `legMs` one way, then turns around (0: always east); `turns`: a thumb turning at random instead. */
  legMs:number;turns?:boolean;
  /** Link: chance per message of a spike (a retransmit, a radio wake-up) and how long (ms); later messages wait behind it. */
  spikeChance?:number;spikeMs?:number;
  /** The scene's step clock before the fix: Phaser's smoothed delta, capped at 200 ms. */
  phaserClock?:boolean;
}
export const PHONE_4G:LinkOptions={latency:60,jitter:60,longFrameChance:.02,longFrameMs:120,busyChance:.01,busyMs:80,seconds:30,seed:1,legMs:0};

export interface LabResult {frames:number;walkingFrames:number;recuos:number;worstBack:number;
  /** Backward distance summed over the run (units). */
  backTotal:number;corrections:number;worstCorrection:number;
  /** Frames whose own position came live (not confirmed) with an ack ahead of the client. */
  aheadAcks:number}

export function runLab(o:LinkOptions):LabResult{
  let r=o.seed*7919+13;const rnd=()=>{r=(r*1103515245+12345)%2147483648;return r/2147483648;};
  const sim=new Simulation();const p=sim.add('p','T','cidadao-comum');sim.resetRun();
  const clock=new TickClock();clock.start(0);
  const b=new InputBatcher();b.reset(0);
  const correction=new SelfCorrection(),steps=new StepLerp();
  let predicted:Point={x:p.x,y:p.y},pending:PlayerInput[]=[],tick=0;
  let up:{at:number;batch:unknown}[]=[],down:{at:number;x:number;y:number;ack:number;tick:number}[]=[];
  let prevSmooth:Point|undefined,lastUp=0,lastDown=0,nextFire=50,nextFrame=0,accumulator=0,lastFrameAt=0,prevDrawn:Point|undefined,flushAt:number|undefined;
  const res:LabResult={frames:0,walkingFrames:0,recuos:0,worstBack:0,backTotal:0,corrections:0,worstCorrection:0,aheadAcks:0};
  const delay=()=>o.latency+rnd()*o.jitter+(rnd()<(o.spikeChance??0)?o.spikeMs??0:0);
  const send=(now:number)=>{
    const batch=b.take(now);flushAt=b.waitingUntil;
    if(batch){lastUp=Math.max(lastUp,now+delay());up.push({at:lastUp,batch});}
  };
  let angle=0,nextTurn=1000,turnedAt=-Infinity;
  const stick=(now:number):Point=>{
    if(o.turns){
      if(now>=nextTurn){angle+=(rnd()<.5?-1:1)*(Math.PI/4+rnd()*Math.PI*.75);nextTurn=now+400+rnd()*1600;turnedAt=now;}
      return {x:Math.cos(angle),y:Math.sin(angle)};
    }
    if(!o.legMs)return {x:1,y:0};
    const leg=Math.floor(now/o.legMs);if(leg>0)turnedAt=leg*o.legMs;
    return leg%2===0?{x:1,y:0}:{x:-1,y:0};
  };
  // Phaser's TimeStep.smoothDelta (smoothStep, the default): a frame over 200 ms takes the last sane delta, then the
  // average of the last 10 deltas is what the scene sees.
  const history:number[]=Array(10).fill(1000/60);let hIdx=0;
  const phaserDelta=(raw:number)=>{let d=raw;if(d>200)d=Math.min(history[hIdx],200);history[hIdx]=d;hIdx=(hIdx+1)%10;return history.reduce((a,v)=>a+v,0)/10;};
  const end=o.seconds*1000;
  for(let now=0;now<=end;now++){
    // Room side.
    while(up.length&&up[0].at<=now)sim.input('p',up.shift()!.batch,now);
    if(now>=nextFire){
      const n=clock.due(now);
      for(let k=0;k<n;k++){
        sim.step(now);tick=sim.tick;
        if(k===n-1&&tick%2===0){
          const own=sim.confirmed('p');
          lastDown=Math.max(lastDown,now+delay());
          down.push({at:lastDown,x:own?.x??p.x,y:own?.y??p.y,ack:own?.ack??p.ack,tick});
        }
      }
      nextFire=now+Math.max(1,clock.delay(now))+Math.floor(rnd()*4)+(rnd()<o.busyChance?o.busyMs:0);
    }
    // Phone: the 10 Hz slot flush timer (client.ts flushTimer).
    if(flushAt!==undefined&&now>=flushAt)send(now);
    if(now<nextFrame)continue;
    const raw=now-lastFrameAt;lastFrameAt=now;const delta=phaserDelta(raw);
    nextFrame=now+(rnd()<o.longFrameChance?o.longFrameMs:16+Math.floor(rnd()*3));
    // Messages first (they waited in the socket while the main thread was busy).
    while(down.length&&down[0].at<=now){
      const f=down.shift()!;
      b.catchUp(f.ack);
      if(f.ack>b.seq)res.aheadAcks++;
      pending=pending.filter(i=>i.seq>f.ack);
      const from=predicted,to=reconcile(f,pending,sim.terrain,{tick:f.tick});
      predicted=to;
      if(from.x!==to.x||from.y!==to.y){
        const d=Math.hypot(from.x-to.x,from.y-to.y);res.corrections++;res.worstCorrection=Math.max(res.worstCorrection,d);
        if(correction.absorb(from,to)==='hide')steps.sync(to,0);else steps.shift(to.x-from.x,to.y-from.y);
      }
    }
    // Scene update (scene.ts): accumulator, steps, draw.
    accumulator=o.phaserClock?Math.min(accumulator+delta/1000,.2):stepClock(accumulator,raw);
    steps.sync(predicted);
    const dir=stick(now);
    while(accumulator>=STEP){
      const {input,active}=b.step(dir,false);
      if(active){pending.push(input);predicted=simulate(predicted,input,sim.terrain,tick+pending.length);}
      accumulator-=STEP;steps.push(predicted);send(now);
    }
    const smooth=steps.at(accumulator/STEP);
    correction.step(raw,40,prevSmooth&&{x:smooth.x-prevSmooth.x,y:smooth.y-prevSmooth.y});prevSmooth=smooth;
    const drawn={x:smooth.x+correction.x,y:smooth.y+correction.y};
    res.frames++;
    if(prevDrawn&&now>1500&&now-turnedAt>150){
      res.walkingFrames++;
      const along=(drawn.x-prevDrawn.x)*dir.x+(drawn.y-prevDrawn.y)*dir.y;
      if(along< -1e-4){res.recuos++;res.backTotal-=along;res.worstBack=Math.max(res.worstBack,-along);}
    }
    prevDrawn=drawn;
  }
  return res;
}

if(import.meta.url===`file:///${process.argv[1].replace(/\\/g,'/')}`||process.argv[1]?.endsWith('lab-recuo.ts')){
  const seconds=Number(process.argv[2]??30),seed=Number(process.argv[3]??1);
  const cases:[string,Partial<LinkOptions>][]=[
    ['local',{latency:0,jitter:0,longFrameChance:0,busyChance:0}],
    ['4g 100ms rtt',{latency:50,jitter:20}],
    ['4g 200ms rtt + jitter',{latency:80,jitter:80}],
    ['4g + vira a cada 2s',{latency:80,jitter:80,legMs:2000}],
    ['celular lento',{latency:80,jitter:80,longFrameChance:.05,longFrameMs:250}],
    ['sala ocupada',{latency:80,jitter:80,busyChance:.05,busyMs:150}],
    ['polegar 4g',{latency:60,jitter:60,turns:true}],
    ['polegar 4g picos',{latency:60,jitter:60,turns:true,spikeChance:.03,spikeMs:200}],
    ['polegar celular lento',{latency:80,jitter:80,turns:true,longFrameChance:.05,longFrameMs:300}],
    ['polegar tudo',{latency:80,jitter:80,turns:true,longFrameChance:.03,longFrameMs:300,spikeChance:.03,spikeMs:200,busyChance:.02,busyMs:100}],
  ];
  for(const [name,c] of cases){
    const res=runLab({...PHONE_4G,seconds,seed,...c});
    console.log(name.padEnd(24),JSON.stringify({...res,worstBack:+res.worstBack.toFixed(4),backTotal:+res.backTotal.toFixed(3),worstCorrection:+res.worstCorrection.toFixed(3)}));
  }
}
