// Manual check of a rooms Worker with six protocol clients (room protocol 6: JSON control + binary frames).
// Usage: node --experimental-strip-types scripts/check-multiplayer.mjs <https endpoint> [origin] [--lab] [--map <id>]
// Ported from the protocol 3 JSON script (E7-skill-hud-wiring, rodada 4); the frames are decoded with the client's own
// decoder. --lab (a local Worker with ALLOW_LOCAL, npm run test:multiplayer:local) adds the run's end and the rematch
// (NEW-20261006-E5-check-multiplayer-horde): the lab puts the whole team down, the room answers {t:'result'} with the
// simulation's defeat, and the rematch starts a fresh run. A whole run played to its end is the bots' job (VGM-045,
// scripts/bots/run.ts): it takes about 13 minutes.
// Maps (D-026/D-035, cidade-10): every join sends `maps` like a current build (the endless map and the city of
// public/maps/cidade-nevada.manifest.json), so a room on the city seats them. The room plays the Worker's default map
// (ROOM_DEFAULT_MAP); --map <id> has the owner pick that map in the lobby first (the city only once it is playable).
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {FrameDecoder,PROTOCOL_VERSION} from '../src/protocol/protocol4.ts';
import {clientCatalog} from '../src/protocol/map-catalog.ts';
import {isMapId,readMapRef} from '../src/protocol/map-select.ts';
const argv=process.argv.slice(2),mapAt=argv.indexOf('--map'),wantMap=mapAt>=0?argv[mapAt+1]:undefined;
if(mapAt>=0&&!isMapId(wantMap))throw new Error(`--map takes infinito or cidade-nevada, not ${wantMap}.`);
const args=argv.filter((a,i)=>a!=='--lab'&&!(mapAt>=0&&(i===mapAt||i===mapAt+1))),labMode=argv.includes('--lab');
const manifest=JSON.parse(readFileSync(new URL('../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityRef=readMapRef({id:manifest.id,version:manifest.version,hash:manifest.hash});
const maps=clientCatalog(cityRef);
const endpoint=args[0];if(!endpoint)throw new Error('Pass the multiplayer HTTPS endpoint.');
const origin=args[1]??'https://viagem.cyou';
const peers=[],checks=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,timeout=10000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error(`Timeout: ${label}`);await wait(30);}}
async function create(){const r=await fetch(`${endpoint}/rooms`,{method:'POST',headers:{Origin:origin}});assert.equal(r.status,201);return (await r.json()).code;}
function connect(code,name,token){
  const url=new URL(`/room/${code}`,endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const p={ws:new WebSocket(url,{origin}),dec:new FrameDecoder(),players:new Map(),enemies:new Map(),bytes:0,seq:0,code,decodeErrors:0,results:[],offersAnswers:0,notices:[]};peers.push(p);
  p.ws.on('open',()=>p.ws.send(JSON.stringify({t:'join',protocol:PROTOCOL_VERSION,name,classId:'cidadao-comum',maps,...(token?{token}:{})})));
  p.ws.on('error',e=>{p.error=e.message;});p.ws.on('close',(code)=>{p.closed=code;});
  p.ws.on('message',(data,binary)=>{
    p.bytes+=data.length;
    if(binary){
      const r=p.dec.decode(new Uint8Array(data));
      if(!r.ok){p.decodeErrors++;if(p.ws.readyState===WebSocket.OPEN)p.ws.send('{"t":"resync"}');return;}
      p.tick=r.view.tick;p.players=new Map(r.view.players.map(v=>[v.id,v]));p.enemies=new Map(r.view.enemies.map(e=>[e.id,e]));
      // The ack goes alone here (these clients send few inputs): deltas go against the last acked frame (D-018).
      if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify({t:'ack',seq:r.seq}));
      return;
    }
    const m=JSON.parse(data);
    if(m.t==='error'){p.error=m.message;return;}
    if(m.t==='welcome'){p.id=m.id;p.token=m.token;p.run=m.run;p.world=m.world;p.map=m.map;p.seq=m.ack??0;p.dec.reset();}
    else if(m.t==='map'){p.map=m.map;p.world=m.world;}
    else if(m.t==='run'&&m.run)p.run=m.run;
    else if(m.t==='result')p.results.push(m);
    else if(m.t==='offers'){p.offersAnswers++;p.offers=m.offers;}
    else if(m.t==='notice')p.notices.push(m.message);
  });
  return p;
}
let timer;
try{
  const health=await (await fetch(`${endpoint}/health`)).json();assert.equal(health.protocol,PROTOCOL_VERSION,`Requires room protocol ${PROTOCOL_VERSION}`);
  checks.push(`/health speaks room protocol ${PROTOCOL_VERSION}`);
  const code=await create(),group=Array.from({length:6},(_,i)=>connect(code,`Prova ${i+1}`));
  await until(()=>group.every(p=>p.id&&p.players.size===6),'six joined');checks.push('six WebSocket clients in one room, six players in every decoded frame');
  checks.push(`the room opened on ${group[0].map?.id??'(no map in the welcome)'}`);
  if(wantMap&&group[0].map?.id!==wantMap){
    // The owner picks the map in the lobby; everyone gets the same {t:'map'} (or the owner hears why not).
    const owner=group.find(p=>p.run?.owner===p.id);assert.ok(owner,'one of the six owns the room');
    owner.ws.send(JSON.stringify({t:'setMap',map:wantMap}));
    await until(()=>group.every(p=>p.map?.id===wantMap)||owner.notices.length>0,`switch to ${wantMap}`);
    assert.ok(group.every(p=>p.map?.id===wantMap),`the room refused ${wantMap}: ${owner.notices.at(-1)}`);
    await until(()=>group.every(p=>p.players.size===6),'six on the new map');
    checks.push(`the owner switched the room to ${wantMap}, all six got the same {t:"map"}`);
  }
  // The class kit's max hp as the room said it right after the welcome (cidadao-comum: 110), before any forged input.
  const startMaxHp=group[0].players.get(group[0].id).maxHp;assert.ok(startMaxHp>0);
  assert.ok(group[0].world?.signature);for(const p of group)assert.deepEqual(p.world,group[0].world);checks.push('all six receive identical world descriptor (seed, versions, signature)');
  const seventh=connect(code,'Seventh');await until(()=>seventh.error,'seventh rejected');assert.match(seventh.error,/cheia/);checks.push('seventh player rejected');
  const old=new WebSocket(Object.assign(new URL(`/room/${code}`,endpoint),{protocol:endpoint.startsWith('https')?'wss:':'ws:'}),{origin});
  const oldAnswer=await new Promise(resolve=>{old.on('open',()=>old.send(JSON.stringify({t:'join',protocol:PROTOCOL_VERSION-1,name:'Velho',classId:'cidadao-comum'})));old.on('message',(d,b)=>{if(!b)resolve(JSON.parse(d));});old.on('close',c=>resolve({closed:c}));});
  assert.equal(oldAnswer.t,'error');checks.push(`a protocol ${PROTOCOL_VERSION-1} tab is refused with a readable message`);
  const isolated=connect(await create(),'Separate');await until(()=>isolated.id&&isolated.players.size===1,'isolated joined');assert.equal(group[0].players.has(isolated.id),false);checks.push('separate room isolated');
  for(const p of group)p.ws.send(JSON.stringify({t:'ready',round:p.run.round,ready:true}));
  await until(()=>group.every(p=>p.run?.phase==='countdown'||p.run?.phase==='combat'),'shared countdown');
  await until(()=>group.every(p=>p.run?.phase==='combat'),'shared combat',20000);checks.push('six ready, shared countdown and authoritative combat start');
  const me=()=>group[0].players.get(group[0].id),original={x:me().x,y:me().y},start=Date.now();
  // A legacy single step per message (still accepted next to the input-10hz segments), with forged fields the room ignores.
  timer=setInterval(()=>{for(const [index,p] of group.entries())if(p.ws.readyState===WebSocket.OPEN&&p.run?.phase==='combat')
    p.ws.send(JSON.stringify({t:'input',round:p.run.round,seq:++p.seq,x:index===0&&Date.now()-start<800?1:0,y:0,attack:false,hp:999999,damage:999999}));},50);
  await wait(2000);
  const latest=me();assert.ok(Math.hypot(latest.x-original.x,latest.y-original.y)>.3,'the room walked the first client');
  assert.ok(latest.hp<=startMaxHp&&latest.maxHp===startMaxHp,'forged hp ignored');checks.push(`server movement, forged hp/damage ignored (hp ${latest.hp} ≤ ${startMaxHp}, the max hp after the welcome)`);
  // A forged pick (an offer this player never got) reaches the simulation, is refused there and answered with the
  // peer's real queue; nothing changes in its build.
  const chooser=group[1],before=JSON.stringify(chooser.players.get(chooser.id).weapons),answers=chooser.offersAnswers;
  chooser.ws.send(JSON.stringify({t:'choose',round:chooser.run.round,offer:'lvl-9-forjado',index:0}));
  await until(()=>chooser.offersAnswers>answers,'forged choose answered');
  assert.ok(!chooser.offers.some(o=>o.id==='lvl-9-forjado'),'no forged offer in the queue');await wait(300);
  assert.equal(JSON.stringify(chooser.players.get(chooser.id).weapons),before,'forged choose changed nothing');checks.push('forged {t:"choose"} refused (answered with the real queue, build unchanged)');
  const dropped=group[2];
  dropped.ws.terminate();await until(()=>group[0].players.get(dropped.id)?.online===false,'disconnect visible');
  const returned=connect(code,'Ignored on resume',dropped.token);await until(()=>returned.id&&returned.players.size===6,'reconnected');
  assert.equal(returned.id,dropped.id);assert.deepEqual(returned.world,dropped.world);group[2]=returned;checks.push('real connection drop and token resume without duplicate');
  clearInterval(timer);timer=undefined;
  if(labMode){
    // Run end through the simulation: the lab puts every player down (wrangler dev with ALLOW_LOCAL only), the team is
    // defeated on the next tick and the room announces {t:'result'} with the run state.
    const round=group[0].run.round;
    for(const p of group)p.ws.send(JSON.stringify({t:'lab',down:true}));
    await until(()=>group.every(p=>p.results.length>0),'result announced',10000);
    for(const p of group){assert.equal(p.results[0].outcome,'defeat');assert.equal(p.results[0].round,round);assert.equal(p.run.phase,'result');assert.equal(p.run.outcome,'defeat');}
    checks.push('run end through sim.outcome: whole team down -> {t:"result",outcome:"defeat"} and the result phase on all six');
    const resultId=group[0].results[0].resultId;assert.ok(group.every(p=>p.results.length===1&&p.results[0].resultId===resultId));
    checks.push('one result per run, same resultId on all six');
    for(const p of group)p.ws.send(JSON.stringify({t:'rematch',round}));
    await until(()=>group.every(p=>p.run.round===round+1&&p.run.phase==='lobby'),'rematch lobby');
    // A repeated rematch for the old round changes nothing.
    group[0].ws.send(JSON.stringify({t:'rematch',round}));await wait(300);assert.equal(group[0].run.round,round+1);
    checks.push('rematch: next round in the lobby, a repeated rematch ignored');
    for(const p of group)p.ws.send(JSON.stringify({t:'ready',round:round+1,ready:true}));
    await until(()=>group.every(p=>p.run.phase==='combat'),'rematch combat',20000);
    await until(()=>group.every(p=>[...p.players.values()].every(v=>!v.downed&&v.hp===v.maxHp&&v.maxHp===startMaxHp)),'fresh players',5000);
    checks.push(`rematch run starts fresh: everyone standing at full hp (${startMaxHp}, as after the welcome)`);
  }
  assert.ok(group.every(p=>p.decodeErrors===0),'no frame failed to decode');checks.push('every frame decoded on all six clients');
  const report={checkedAt:new Date().toISOString(),endpoint,origin,transport:'WebSocket',protocol:PROTOCOL_VERSION,clients:6,map:group[0].map,world:group[0].world,checks,incomingBytes:group.map(p=>p.bytes),
    note:`Node protocol clients, not six phones or browser rendering.${labMode?' The run end is the lab\'s quick defeat;':''} whole runs: scripts/bots/run.ts (VGM-045).`};
  await writeFile('docs/multiplayer-websocket-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{clearInterval(timer);for(const p of peers){if(p.ws.readyState===WebSocket.OPEN){p.ws.send(JSON.stringify({t:'leave'}));p.ws.close();}else if(p.ws.readyState!==WebSocket.CLOSED)p.ws.terminate();}}
