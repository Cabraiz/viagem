// Debug one seed: node --experimental-strip-types debug.ts <players> <seed> <fromS> <toS> <bots,..> [everyS]
import {cityTerrainFrom,cityAsField} from '../../src/maps/index.ts';
import {BOT_CLASS_IDS} from '../../src/rules/index.ts';
import {STEP_MS} from '../../src/protocol/index.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {RoomBots,botIdentity} from '../../multiplayer/room-bots.ts';
import {LevelupPause} from '../../multiplayer/levelup-pause.ts';
const [players,seed,fromS,toS]=process.argv.slice(2,6).map(Number),watch=(process.argv[6]??'bot1').split(','),every=Number(process.argv[7]??'2');
import fs from 'node:fs';
const city=await cityTerrainFrom(fs.readFileSync('public/maps/cidade-nevada.json','utf8'),JSON.parse(fs.readFileSync('public/maps/cidade-nevada.manifest.json','utf8')).hash) as never as {ok:true;terrain:never};
const r1=(v:number)=>Math.round(v*10)/10,dist=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const sim=new Simulation(seed,{world:'cidade',terrain:cityAsField(city.terrain),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'} as never);
const room=new RoomBots();
for(let i=0;i<players;i++){const id=`bot${i+1}`,{name,classId}=botIdentity(seed,i,[...BOT_CLASS_IDS],new Set([...sim.players.values()].map(p=>p.name)));sim.addBot(id,name,classId);room.add(id,i);if(i===0)sim.personPace.add(id);}
sim.botState=()=>room.state();sim.resetRun();room.reset();
const sticks=new Map<string,{x:number;y:number;a:boolean;t?:string}>();const set=sim.setBotInput.bind(sim);
sim.setBotInput=(id,d,skill=false,attack=false,work=false,target)=>{sticks.set(id,{x:d.x,y:d.y,a:attack,t:target});return set(id,d,skill,attack,work,target);};
const lv=new LevelupPause();let clock=0;
while(!sim.outcome&&sim.tick<toS*20){
  clock+=STEP_MS;if(lv.update(sim,clock))continue;room.think(sim);sim.step();
  const tick=sim.world.tick;if(tick<fromS*20||tick%(every*20))continue;
  const car=sim.run.chaveiro?.state.car,en=[...sim.world.enemies.values()];
  if(process.env.CRATES){const ks=[...(sim.world as never as {pickups:Map<string,{id:string;kind:string;x:number;y:number;value:number;hiddenFor?:string[]}>}).pickups.values()].filter(k=>k.kind==='chest'&&car&&dist(k,car)<30);console.log('  crates',ks.map(k=>`${k.id} v${k.value} car${r1(dist(k,car!))} (${r1(k.x)},${r1(k.y)})${k.hiddenFor?.length?' hid:'+k.hiddenFor.join('/'):''}`).join(' ; '));}
  for(const id of watch){const p=sim.players.get(id);if(!p)continue;const st=sticks.get(id),m=room.state().find(x=>x.id===id)!.memory as Record<string,unknown>;
    const ne=en.map(e=>({e,d:dist(e,p)})).sort((a,b)=>a.d-b.d).slice(0,3).map(x=>`${x.e.id}@${r1(x.d)}${(x.e as {asleep?:boolean}).asleep?'z':''}(${r1(x.e.x)},${r1(x.e.y)})`).join(' ');
    console.log(`${r1(tick/20)}s ${id} ${room.modes.get(id)} (${r1(p.x)},${r1(p.y)}) car ${car?r1(dist(p,car)):'-'} hp ${Math.round(p.hp)} stick ${st?r1(Math.hypot(st.x,st.y)):'-'} atk ${st?.a?1:0} | ${ne} | skip ${JSON.stringify(m.skip??{})} track ${JSON.stringify(m.track??null)} homing ${m.homing}`);}
}
console.log('end',sim.outcome??'-',(sim.tick/20).toFixed(1)+'s');
