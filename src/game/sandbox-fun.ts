/**
 * Fun sandbox (VGM-053A): `?sandbox=fun&players=1..6&state=idle|open|balloons|cooldown[&frozen=1]`.
 * Mock island with the real control positions (joystick, attack) to check overlaps on phones,
 * the emote button and speech balloons with class lines. Fake data only; nothing talks to the server.
 */
import './fun/fun.css';
import {classes} from '../classes.ts';
import {BalloonLayer,EMOTES,EmoteBar,EmoteGate,emoteDef,type EmoteId} from './fun/emotes.ts';
import {LineThrottle,SITUATIONS,SITUATION_LABELS,lineForEvent,pickLine,type Situation} from './fun/lines.ts';

const params=new URLSearchParams(location.search);
const count=Math.max(1,Math.min(6,Number(params.get('players'))||6));
const state=params.get('state')??'balloons';
const frozen=params.has('frozen');
const crew=['cidadao-comum','tio-do-churrasco','viciado-em-bet','motogirl','clt-cansado','tecnico-ti'].slice(0,count)
  .map((classId,i)=>({id:i?`p${i+1}`:'me',classId,name:i?classes.find(c=>c.id===classId)!.name.split(' ')[0]:'Você'}));
// Spots around the island center as fractions of the viewport.
const spots=[[.5,.56],[.3,.42],[.7,.4],[.24,.66],[.76,.64],[.5,.3]];

const style=document.createElement('style');
style.textContent=`
html,body{margin:0;height:100%;overflow:hidden;background:#8dcecc}
body>:not(.fs-world){display:none!important}
.fs-world{position:fixed;inset:0;z-index:5;background:radial-gradient(ellipse 48% 32% at 50% 50%,#7cbf6a 0 62%,#e9d79a 63% 70%,#a6e0dc 72%,#8dcecc 100%);font-family:system-ui,sans-serif}
.fs-hero{position:absolute;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;border:3px solid #fffdf6;background:#f4c9a8 center/cover;box-shadow:0 4px 0 #30253640}
.fs-hero b{position:absolute;left:50%;top:50px;transform:translateX(-50%);padding:1px 6px;border-radius:8px;background:#302536b0;color:#fff9ed;font:700 10px system-ui;white-space:nowrap}
.fs-hero.me{border-color:#edc66a}
.fs-mock{position:absolute;box-sizing:border-box;border:2px solid #fff8e9b0;background:#6550807a;color:#fff9ed;font:700 12px system-ui;display:grid;place-items:center;border-radius:50%;text-shadow:0 1px 3px #302536}
.fs-stick{left:max(24px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom));width:112px;height:112px;background:#ffffff1f}
.fs-attack{right:max(24px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));width:82px;height:82px}
@media(max-width:370px),(max-height:500px){.fs-stick{width:96px;height:96px;left:max(18px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom))}.fs-attack{right:max(18px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}}
.fs-bar{position:absolute;z-index:20;left:50%;top:max(6px,env(safe-area-inset-top));transform:translateX(-50%);display:flex;flex-wrap:wrap;justify-content:center;gap:4px;max-width:calc(100% - 140px);opacity:.9}
.fs-bar button{min-height:28px;font:600 10px system-ui;padding:2px 6px;border-radius:7px;border:1px solid #fff8;background:#302536cc;color:#fff}
.fs-bar[hidden]{display:none}
`;
document.head.append(style);

const world=document.createElement('div');world.className='fs-world';
world.innerHTML='<div class="fs-mock fs-stick">●</div><div class="fs-mock fs-attack">✦ Atacar</div>';
document.body.append(world);
const heroes=new Map(crew.map(p=>{
  const el=document.createElement('div');el.className=`fs-hero${p.id==='me'?' me':''}`;
  el.style.backgroundImage=`url('/art/portraits/${p.classId}-thumb.webp')`;
  el.innerHTML=`<b>${p.name}</b>`;world.append(el);return [p.id,el] as const;
}));
const layer=new BalloonLayer(world);
const head=(id:string)=>{const i=crew.findIndex(p=>p.id===id);const [fx,fy]=spots[i];return {x:fx*innerWidth,y:fy*innerHeight-26};};
function layout(){
  crew.forEach((p,i)=>{const el=heroes.get(p.id)!;el.style.left=`${spots[i][0]*innerWidth}px`;el.style.top=`${spots[i][1]*innerHeight}px`;const h=head(p.id);layer.place(p.id,h.x,h.y);});
}
addEventListener('resize',layout);layout();

const forever=frozen?1e12:undefined;
function emote(id:string,emoteId:EmoteId){const def=emoteDef(emoteId),h=head(id);layer.show(id,def.label,h.x,h.y,{kind:def.tone==='help'?'help':'emote',tone:def.tone,icon:def.icon,ms:forever});}
function speak(id:string,situation:Situation,seed:number){
  const p=crew.find(c=>c.id===id)!,h=head(id);
  layer.show(id,pickLine(p.classId,situation,seed),h.x,h.y,{kind:situation==='down'?'help':'line',ms:forever});
}
const gate=new EmoteGate();
const bar=new EmoteBar(world,{playerId:'me',gate,onEmote:id=>emote('me',id)});

if(state==='open')bar.setOpen(true);
if(state==='cooldown'){bar.send('kkkk');bar.setOpen(true);}
if(state==='balloons'){
  emote('me','kkkk');
  const script:[string,Situation|EmoteId][]=[['p2','down'],['p3','upgrade'],['p4','vem'],['p5','revive'],['p6','foimal']];
  script.forEach(([id,what],i)=>{if(!heroes.has(id))return;if(EMOTES.some(e=>e.id===what))emote(id,what as EmoteId);else speak(id,what as Situation,i+7);});
}

// Debug bar: trigger each situation on a random friend (debug aid only; not a requirement on phones).
const debug=document.createElement('div');debug.className='fs-bar';debug.hidden=frozen;
debug.innerHTML=SITUATIONS.map(s=>`<button data-s="${s}">${SITUATION_LABELS[s]}</button>`).join('');
let seed=1;
debug.addEventListener('click',e=>{
  const s=(e.target as HTMLElement).dataset.s as Situation|undefined;if(!s)return;
  const p=crew[seed++%crew.length];speak(p.id,s,seed);
});
world.append(debug);

const throttle=new LineThrottle();
if(!frozen){
  // Friends react on their own, using the same event mapping the real client will use.
  setInterval(()=>{
    seed++;
    const others=crew.filter(p=>p.id!=='me');
    if(!others.length)return;
    const p=others[seed%others.length];
    if(seed%3===0){emote(p.id,EMOTES[seed%EMOTES.length].id);return;}
    const events=[{type:'downed',player:p.id},{type:'revived',player:'me',by:p.id},{type:'upgrade',player:p.id,item:'chinelo',level:2},{type:'levelup',level:seed}] as const;
    const line=lineForEvent(events[seed%events.length],crew,seed);
    if(line&&throttle.allow(line,performance.now())){const h=head(line.speaker);layer.show(line.speaker,line.text,h.x,h.y,{kind:line.situation==='down'?'help':'line'});}
  },1600);
  const loop=()=>{layer.update();requestAnimationFrame(loop);};loop();
}
document.body.dataset.funReady='1';
