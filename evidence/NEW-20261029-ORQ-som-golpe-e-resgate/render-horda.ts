// Horda grande, 10 s, antes × depois (NEW-20261029-ORQ-som-golpe-e-resgate). Roda o AudioEngine de verdade num contexto
// falso que só anota cada take tocado (início, fim, altura, nível) e mistura os arquivos reais decodificados pelo ffmpeg.
// "antes" = regras de antes de c545e117 (golpe 45 ms, acerto 50, plop 60, uma altura só); "depois" = a worktree.
// uso (na worktree): node --experimental-strip-types <este> <outDir>
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const imp=(p:string)=>import(pathToFileURL(resolve(p)).href);
const {AudioEngine,DEFAULT_SETTINGS}=await imp('src/client/audio/engine.ts');
const {busGain}=await imp('src/client/audio/settings.ts');
const {SFX}=await imp('src/client/audio/sfx.ts');
const {playEvents,soundForEvent}=await imp('src/client/audio/events.ts');
const SR=48000,SECONDS=10,ME='p1';
class Param {value=1;setValueAtTime(v:number){this.value=v;return this;}linearRampToValueAtTime(){return this;}exponentialRampToValueAtTime(){return this;}setTargetAtTime(){return this;}cancelScheduledValues(){return this;}}
class Node {connected:unknown[]=[];connect(d:unknown){this.connected.push(d);return d;}disconnect(){}}
class Gain extends Node {gain=new Param();}
class Source extends Node {starts:number[]=[];stops:number[]=[];offsets:number[]=[];onended:(()=>void)|null=null;start(t=0,o=0){this.starts.push(t);this.offsets.push(o);}stop(t=0){this.stops.push(t);}}
class BufferSource extends Source {buffer:any=null;loop=false;playbackRate=new Param();}
class Ctx {
  sampleRate=SR;currentTime=0;state='running';destination=new Node();nodes:Node[]=[];
  add<T extends Node>(n:T){this.nodes.push(n);return n;}
  createGain(){return this.add(new Gain());}
  createBufferSource(){return this.add(new BufferSource());}
  createOscillator(){return this.add(Object.assign(new Source(),{type:'sine',frequency:new Param()}));}
  createBiquadFilter(){return this.add(Object.assign(new Node(),{type:'',frequency:new Param(),Q:new Param()}));}
  createDynamicsCompressor(){return this.add(Object.assign(new Node(),{threshold:new Param(),knee:new Param(),ratio:new Param(),attack:new Param(),release:new Param()}));}
  createBuffer(_c:number,length:number){return {length,duration:length/SR,getChannelData:()=>new Float32Array(length)};}
  decodeAudioData(data:ArrayBuffer){
    const url=new TextDecoder().decode(data),file=resolve('public'+url.replace(/^.*?\/audio\//,'/audio/').split('?')[0]);
    const raw=execFileSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-ac','1','-ar',String(SR),'-'],{maxBuffer:1<<26});
    const pcm=new Float32Array(raw.buffer,raw.byteOffset,raw.byteLength/4);
    return Promise.resolve({duration:pcm.length/SR,length:pcm.length,name:url,pcm});
  }
  resume(){return Promise.resolve();}close(){return Promise.resolve();}
}
const settle=()=>new Promise(r=>setTimeout(r,0));
async function render(rodada:'antes'|'depois'){
  const ctx=new Ctx();let now=0;
  const sfx=rodada==='depois'?SFX:{...SFX,golpe:{...SFX.golpe,throttleMs:45},'bicho-acerto':{...SFX['bicho-acerto'],throttleMs:50},'bicho-morte':{...SFX['bicho-morte'],throttleMs:60,priority:0}};
  const engine=new AudioEngine({createContext:()=>ctx as any,nowMs:()=>now,format:'webm',random:Math.random,storage:null,sfx,
    loadFile:(url:string)=>Promise.resolve(new TextEncoder().encode(url).buffer as ArrayBuffer)});
  engine.unlock();engine.preload(['bicho-acerto','bicho-morte','golpe','dano-heroi','gema']);
  for(let i=0;i<20;i++)await settle();
  const audio=rodada==='depois'?engine:{play:(id:string)=>{const e=undefined;return engine.play(id,e);}};
  const before=new Set(ctx.nodes);
  // 300 bichos apanhando a cada quadro de 50 ms (faca e pistola), 20 mortes por quadro, o herói tomando dano.
  for(let f=0;f<SECONDS*20;f++){
    now=f*50;ctx.currentTime=now/1000;
    const events:any[]=[];
    for(let i=0;i<300;i++)events.push({type:'damage',target:`e${(i*7+f*13)%300}`,amount:2,source:ME,weapon:i%2?'pistola':'faca',crit:(i+f)%17===0});
    for(let i=0;i<20;i++)events.push({type:'kill',enemy:`e${(f*20+i)%300}`,kind:'bebado',by:ME,x:0,y:0});
    if(f%10===0)events.push({type:'damage',target:ME,amount:1,source:'e9'});
    if(rodada==='depois')playEvents(audio,events,ME);
    else for(const e of events){const id=soundForEvent(e,ME);if(id)engine.play(id);}
  }
  const mix=new Float32Array(SR*SECONDS+SR);let n=0;
  const bus=busGain(DEFAULT_SETTINGS.effects);
  for(const node of ctx.nodes){
    if(before.has(node)||!(node instanceof BufferSource)||!node.buffer?.pcm||!node.starts.length)continue;
    const src=node as BufferSource,pcm:Float32Array=src.buffer.pcm,rate=src.playbackRate.value,g=(src.connected[0] as Gain).gain.value*bus;
    const t0=Math.round(src.starts[0]*SR),off=(src.offsets[0]??0)*SR,stop=src.stops[0]!==undefined?Math.round(src.stops[0]*SR):Infinity;
    n++;
    for(let k=0;;k++){
      const at=t0+k;if(at>=mix.length||at>=stop)break;
      const pos=off+k*rate,i=Math.floor(pos);if(i+1>=pcm.length)break;
      mix[at]+=g*(pcm[i]+(pcm[i+1]-pcm[i])*(pos-i));
    }
  }
  for(let i=0;i<mix.length;i++)mix[i]=Math.tanh(mix[i]);
  const raw=join(out,`horda-${rodada}.f32`);writeFileSync(raw,Buffer.from(mix.buffer));
  console.log(rodada,`${n} takes em ${SECONDS} s`);
  return raw;
}
const a=await render('antes'),d=await render('depois');
execFileSync('ffmpeg',['-v','error','-y','-f','f32le','-ar',String(SR),'-ac','1','-i',a,'-f','f32le','-ar',String(SR),'-ac','1','-i',d,
  '-filter_complex','[0][1]concat=n=2:v=0:a=1','-c:a','libopus','-b:a','64k',join(out,'horda-antes-depois.webm')]);
for(const [r,f] of [['antes',a],['depois',d]])execFileSync('ffmpeg',['-v','error','-y','-f','f32le','-ar',String(SR),'-ac','1','-i',f,'-c:a','libopus','-b:a','64k',join(out,`horda-${r}.webm`)]);
const {rmSync}=await import('node:fs');rmSync(a);rmSync(d);
process.exit(0);
