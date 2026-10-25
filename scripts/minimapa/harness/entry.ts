/**
 * Minimap harness (card NEW-20261025-ORQ-minimapa-arte-chatgpt): the real WcMinimap + driver on the real city, with a
 * fixed scene (4 heroes, critters, a boss, barricades, a tower, nests, banks, the chaveiro), in a phone-sized slot.
 * Bundled by esbuild (print.mjs), no vite. `?side=124` the slot in CSS px, `?bench=1` times render() and writes
 * window.__bench. window.__pronto once the art (or its absence) settled.
 */
import {decodeCityAsset} from '../../../src/maps/index.ts';
import {WcMinimap} from '../../../src/client/hud/wc-minimap/minimap.ts';
import {WcMinimapDriver} from '../../../src/client/hud/wc-minimap/driver.ts';
import {bankExtras} from '../../../src/client/hud/bancos.ts';
import {chaveiroExtras} from '../../../src/client/hud/chaveiro-extras.ts';
import * as maps from '../../../src/maps/index.ts';

declare global {interface Window {__pronto?:boolean;__bench?:{ms:number;n:number}}}
const q=new URLSearchParams(location.search),side=Number(q.get('side')??124);
const decoded=decodeCityAsset(await (await fetch('/maps/cidade-nevada.json')).text());
if(!decoded.ok)throw new Error(decoded.error);
const city=decoded.asset,P=city.points.praca;
const mm=new WcMinimap(document),driver=new WcMinimapDriver();
Object.assign(mm.el.style,{position:'absolute',left:'8px',top:'8px',width:`${side}px`,height:`${side}px`,border:'2px solid #fff4d6',borderRadius:'4px',boxShadow:'0 0 0 2px #1d1830',overflow:'hidden'});
Object.assign(mm.el.querySelector('canvas')!.style,{display:'block',width:'100%',height:'100%',imageRendering:'pixelated'});
document.body.append(mm.el);
const at=(dx:number,dy:number)=>({x:P.x+dx,y:P.y+dy});
const players=[
  {id:'p1',classId:'viciado-em-bet',...at(-4,-6),online:true},
  {id:'p2',classId:'coach',...at(-30,10),online:true},
  {id:'p3',classId:'gato-nada-pra-comer',...at(25,-30),online:true},
  {id:'p4',classId:'maromba',...at(10,35),online:true},
];
const states=new Map<string,{downed?:unknown}>([['p4',{downed:true}]]);
const enemies=[...Array.from({length:14},(_,i)=>({...at(-50+i*7,-45+(i%4)*6),hp:5})),{...at(45,45),hp:900,boss:true}];
const structures=[
  {kind:'barricada',...at(-22,-2)},{kind:'barricada',...at(22,22)},{kind:'torre-chinelo',...at(-25,-25)},
  {kind:'ninho',...at(-55,40),size:'G',seen:true},{kind:'ninho',...at(50,-55),size:'P',seen:true},{kind:'ninho',...at(30,10),size:'M',seen:true},
];
const extras=[
  ...bankExtras([{id:'b1',...at(-40,25),state:'normal',saldo:5},{id:'b2',...at(40,-10),state:'bicho',saldo:5},{id:'b3',...at(-35,-30),state:'sem-cedulas',saldo:0}] as never),
  ...chaveiroExtras({ended:false,route:[at(0,-60),at(0,-30),at(20,-30)],moto:{...at(0,-60),mode:'morta'},car:at(14,8),delivery:at(20,-30)} as never),
];
const corners=[at(-12,-20),at(8,-20),at(8,8),at(-12,8)];
const draw=(now:number)=>driver.draw({minimap:mm,terrain:maps.defaultTerrain,city,view:0,nowMs:now,selfId:'p1',self:players[0],players,states,
  enemies,structures,corners,wallHitAt:-1e9,extras});
draw(0);
// The art loads on the first paint: wait for it (or for its absence), then a still frame.
const imgs=()=>[...performance.getEntriesByType('resource')].filter(e=>e.name.includes('/art/minimapa/'));
for(let i=0;i<40&&imgs().length<2;i++)await new Promise(r=>setTimeout(r,50));
await new Promise(r=>setTimeout(r,400));
draw(0);
if(q.get('bench')==='1'){
  for(let i=0;i<50;i++)draw(i*100);
  const n=600,t0=performance.now();for(let i=0;i<n;i++)draw(i*100);
  // getImageData forces the GPU work queued by the draws to finish inside the timing.
  mm.el.querySelector('canvas')!.getContext('2d')!.getImageData(0,0,1,1);
  window.__bench={ms:(performance.now()-t0)/n,n};
  draw(0);
}
window.__pronto=true;
