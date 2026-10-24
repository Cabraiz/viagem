// Card BUG-20261024-ORQ-uno-bloqueio-corpo-em-cima: how far bodies get into the Uno's lataria in the REAL sim (the run
// systems of the city with the chaveiro), before × after. One hero walks at the car from 8 sides in turn (3 s each),
// one leans on its rear and pushes, 16 bebados focused on the Uno besiege it. Per tick: each body's overlap with the
// drawn footprint (CAR_HALF 1.316 × 0.583 u at the heading), its radius less its gap to the box.
//   node --experimental-strip-types medir-lataria.ts <root> [segundos=30]
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const [ROOT,SECS='30']=process.argv.slice(2);
const imp=(p:string)=>import(pathToFileURL(join(ROOT,p)).href);
const {cityTerrainFrom}=await imp('src/maps/city/terrain.ts');
const {walkable}=await imp('src/maps/index.ts');
const {BASE_STATS,SIM_HZ}=await imp('src/contract/index.ts');
const {SimWorld}=await imp('src/sim/core.ts');
const {SpatialHash}=await imp('src/sim/spatial.ts');
const {RUN_ORDER}=await imp('src/sim/systems/players.ts');
const {createRunSystems}=await imp('src/sim/assemble.ts');
const {FOCO,FOCO_UNO}=await imp('src/sim/enemies/foco.ts');
const {SIEGE_FLAG}=await imp('src/sim/stonewards/wall.ts');

const loaded=await cityTerrainFrom(readFileSync(join(ROOT,'public/maps/cidade-nevada.json'),'utf8'),JSON.parse(readFileSync(join(ROOT,'public/maps/cidade-nevada.manifest.json'),'utf8')).hash);
if(!loaded.ok)throw new Error(loaded.error);
const city=loaded.terrain;
const HL=1.85*1.245/1.75,HW=.82*1.245/1.75,R=.22;
type P={x:number;y:number};
const gap=(car:{x:number;y:number;heading?:number},p:P)=>{
  const c=Math.cos(car.heading??0),s=Math.sin(car.heading??0),rx=p.x-car.x,ry=p.y-car.y,l=rx*c+ry*s,w=-rx*s+ry*c;
  return Math.hypot(Math.max(0,Math.abs(l)-HL),Math.max(0,Math.abs(w)-HW));
};
const inputs=new Map<string,{x:number;y:number}>();
let seq=0;
const world=new SimWorld({terrain:city.fork(),seed:5,players:new Map(),order:RUN_ORDER,enemyIndex:new SpatialHash()});
const sys=createRunSystems(world,{takeInput:(id:string)=>{const i=inputs.get(id);return i?{seq:++seq,x:i.x,y:i.y}:undefined;},onOutcome:()=>{},cityTutorial:false,objective:'chaveiro'});
const car=sys.chaveiro!.state.car;
const addPlayer=(id:string,p:P)=>{const pl={id,classId:'x',hp:1e6,online:true,spectator:false,facing:{x:1,y:0},build:{weapons:[],passives:[]},
  stats:{...BASE_STATS,maxHp:1e6},weaponReady:{},x:p.x,y:p.y,ack:0,score:0};world.players.set(id,pl);return pl;};
const walker=addPlayer('anda',{x:car.x-4,y:car.y}),pusher=addPlayer('empurra',{x:car.x-HL-.3,y:car.y});
world.step();
for(let i=0;i<16;i++){
  const a=i/16*Math.PI*2;let p={x:car.x+Math.cos(a)*6,y:car.y+Math.sin(a)*6};
  for(let k=6;k<12&&!walkable(p,world.terrain);k++)p={x:car.x+Math.cos(a)*k,y:car.y+Math.sin(a)*k};
  world.enemies.set(`e${i}`,{id:`e${i}`,kind:'bebado',x:p.x,y:p.y,hp:1e6,maxHp:1e6,speed:1.4,damage:0,radius:.32,xp:1,spawnTick:0,readyTick:0,memory:{[SIEGE_FLAG]:1,[FOCO]:FOCO_UNO}});
}
const n=Math.round(+SECS*SIM_HZ),side=3*SIM_HZ;
let endTick:number|null=null,ran=0;let hero=0,heroMax=0,crit=0,critMax=0,samples=0,pushTicks=0;const x0=car.x,y0=car.y;
for(let t=0;t<n;t++){
  // The walker: every 3 s from another of 8 sides, 3.5 u out, walking at the car's centre.
  if(t%side===0){const a=(t/side)*Math.PI/4+(car.heading??0),q={x:car.x+Math.cos(a)*3.5,y:car.y+Math.sin(a)*3.5};if(walkable(q,world.terrain)){walker.x=q.x;walker.y=q.y;}}
  const d=Math.hypot(car.x-walker.x,car.y-walker.y)||1;inputs.set('anda',{x:(car.x-walker.x)/d,y:(car.y-walker.y)/d});
  // The pusher leans on the rear for the first half, pushing along the heading; then it lets go.
  const h=car.heading??0;inputs.set('empurra',t<n/2?{x:Math.cos(h),y:Math.sin(h)}:{x:0,y:0});
  if(t<n/2&&gap(car,pusher)>1){pusher.x=car.x-Math.cos(h)*(HL+.3);pusher.y=car.y-Math.sin(h)*(HL+.3);}
  for(const p of world.players.values())p.hp=p.stats.maxHp;
  world.step();
  // The run over (the chaveiro opened the car, or it broke): nothing is measured past the end screen.
  if(sys.chaveiro!.state.ended){endTick=t;break;}
  ran++;
  if(car.movers?.length)pushTicks++;
  for(const p of world.players.values()){const o=R-gap(car,p);heroMax=Math.max(heroMax,o);if(o>.05)hero++;}
  for(const e of world.enemies.values()){if(!(e.hp>0))continue;const o=e.radius-gap(car,e);critMax=Math.max(critMax,o);if(o>.05){crit++;if(process.env.DEBUG&&crit<=12){const c=Math.cos(car.heading??0),s=Math.sin(car.heading??0),rx=e.x-car.x,ry=e.y-car.y;
  console.log(t,e.id,'l',(rx*c+ry*s).toFixed(2),'w',(-rx*s+ry*c).toFixed(2),'h',(car.heading??0).toFixed(2),'movers',car.movers?.length??0,'clear',world.terrain.clearDisc?.(e.x,e.y,e.radius));}}samples++;}
}
console.log(JSON.stringify({root:ROOT,segundos:+SECS,
  heroi:{ticksDentro:hero,de:ran*2,maiorEntrada:+heroMax.toFixed(2)},
  bichos:{amostrasDentro:crit,de:samples,maiorEntrada:+critMax.toFixed(2)},
  carroAndou:+Math.hypot(car.x-x0,car.y-y0).toFixed(2),ticksEmpurrando:pushTicks,fim:sys.chaveiro!.state.ended??null,fimTick:endTick}));
