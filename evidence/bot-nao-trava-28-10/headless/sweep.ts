import fs from 'node:fs';
const R=process.env.ROOT??'D:/Gits/viagem-wt/bots-resgatam';
const U=(p:string)=>'file:///'+R+'/'+p;
const {cityTerrainFrom,cityAsField}=await import(U('src/maps/index.ts'));
const {BOT_CLASS_IDS}=await import(U('src/rules/index.ts'));
const {Simulation}=await import(U('multiplayer/simulation.ts'));
const {RoomBots,botIdentity}=await import(U('multiplayer/room-bots.ts'));
const {LevelupPause}=await import(U('multiplayer/levelup-pause.ts'));
const {STEP_MS}=await import(U('src/protocol/index.ts'));
const HZ=20;
const argv=process.argv.slice(2),get=(n:string)=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:undefined;};
const players=Number(get('--players')??1),seeds=(get('--seeds')??'6').split(',').map(Number),capS=Number(get('--cap-s')??60),verbose=argv.includes('-v');
const city=await cityTerrainFrom(fs.readFileSync(R+'/public/maps/cidade-nevada.json','utf8'),JSON.parse(fs.readFileSync(R+'/public/maps/cidade-nevada.manifest.json','utf8')).hash);
const d=(a:any,b:any)=>Math.hypot(a.x-b.x,a.y-b.y),r1=(v:number)=>Math.round(v*10)/10;
for(const seed of seeds){
  const sim=new Simulation(seed,{world:'cidade',terrain:cityAsField(city.terrain),cityStructures:true,objective:'chaveiro',mode:'ninhos',combat:'manual'});
  const room=new RoomBots();
  for(let i=0;i<players;i++){const id=`bot${i+1}`,{name,classId}=botIdentity(seed,i,[...BOT_CLASS_IDS],new Set([...sim.players.values()].map((p:any)=>p.name)));sim.addBot(id,name,classId);room.add(id,i);if(i===0)sim.personPace.add(id);}
  sim.botState=()=>room.state();sim.resetRun();room.reset();
  const lu=new LevelupPause();let clock=0,armed:any={},last:any={},flips:any={},seq:any={},ft:any={};const partner=(id:string)=>(room as any).modes.get(id)==='escort';const wasEsc:any={};const hist:any={};
  while(!sim.outcome&&sim.tick<capS*HZ){
    clock+=STEP_MS;if(lu.update(sim,clock))continue;
    room.think(sim);sim.step();const tick=sim.world.tick;
    const car=(sim as any).world?.objective?.car??(sim as any).run?.objective?.car;
    for(const [id,p] of sim.players as Map<string,any>){
      const m=room.modes.get(id);if(m==='escort')wasEsc[id]=true;if(m!==last[id])(hist[id]??=[]).push([tick,m]);
      if(armed[id]===undefined&&p.build.weapons.length)armed[id]=r1(tick/HZ);
      if(m!==last[id]){if((m==='home'&&last[id]==='loot')||(m==='loot'&&last[id]==='home')){flips[id]=(flips[id]??0)+1;(ft[id]??=[]).push(tick);}last[id]=m;
        (seq[id]??=[]).push(`${r1(tick/HZ)}:${m}`);}
      if(verbose&&id==='bot1'&&tick%10===0){
        const ws=[...(sim as any).world.pickups?.values?.()??[]].filter((k:any)=>k.kind==='chest'||k.kind==='item').map((k:any)=>`${k.kind}${k.resource?'/'+k.resource:''}@${r1(d(k,p))}`).sort((a:string,b:string)=>parseFloat(a.split('@')[1])-parseFloat(b.split('@')[1])).slice(0,3);
        const mem=room.state().find((x:any)=>x.id===id)?.memory,rd=sim.world.round,en=[...sim.world.enemies.values()].filter((e:any)=>e.hp>0).map((e:any)=>d(e,p)).sort((a:number,b:number)=>a-b)[0];
        console.log(`${r1(tick/HZ)} ${m} ph ${rd?.phase}/${rd?r1((rd.phaseEndsTick-tick)/HZ):'-'} en ${en?r1(en):'-'} ${(()=>{const e=[...sim.world.enemies.values()].filter((e:any)=>e.hp>0).sort((a:any,b:any)=>d(a,p)-d(b,p))[0];return e?`${e.id}/${e.kind??e.type}@${r1(e.x)},${r1(e.y)} hp${e.hp} mem${JSON.stringify(e.memory??{}).slice(0,80)}`:''})()} obj ${JSON.stringify((sim as any).world.objective??null).slice(0,120)} skip ${JSON.stringify(mem?.skip??{})} trk ${mem?.track?.key??''} arr ${mem?.arrived?r1(d(mem.arrived,p)):'-'} at ${r1(p.x)},${r1(p.y)} car ${car?r1(d(car,p)):'-'} weap ${p.build.weapons.map((w:any)=>w.id).join('/')} ${ws.join(' ')}`);
      }
    }
  }
  for(const id of Object.keys(last)){const t=ft[id]??[];let w=0;for(let i=0;i<t.length;i++){let j=i;while(j<t.length&&t[j]-t[i]<5*HZ)j++;w=Math.max(w,j-i);}
    // merged: drop stints shorter than 0.5 s (one think), then count home<->loot swaps after the first 1 s
    const h=hist[id]??[],kept:any[]=[];for(let i=0;i<h.length;i++){const dur=(h[i+1]?.[0]??Infinity)-h[i][0];if(dur<10&&i+1<h.length)continue;if(kept.length&&kept[kept.length-1][1]===h[i][1])continue;kept.push(h[i]);}
    const ft2:number[]=[];for(let i=1;i<kept.length;i++){const a=kept[i-1][1],b=kept[i][1];if((a==='home'&&b==='loot')||(a==='loot'&&b==='home'))if(kept[i][0]>=HZ)ft2.push(kept[i][0]);}
    let w2=0;for(let i=0;i<ft2.length;i++){let j=i;while(j<ft2.length&&ft2[j]-ft2[i]<5*HZ)j++;w2=Math.max(w2,j-i);}
    let w30=0;const t30=t.filter((x:number)=>x>=HZ&&x<30*HZ);for(let i=0;i<t30.length;i++){let j=i;while(j<t30.length&&t30[j]-t30[i]<5*HZ)j++;w30=Math.max(w30,j-i);}
    console.log(JSON.stringify({seed,players,id,partner:!!wasEsc[id],armed:armed[id]??null,flips:flips[id]??0,max5s:w,max5sMerged:w2,max5s30:w30}));}
}
