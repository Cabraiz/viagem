// Manual check of a rooms Worker with six protocol clients (room protocol 5: JSON control + binary frames).
// Usage: node --experimental-strip-types scripts/check-multiplayer.mjs <https endpoint> [origin]
// Ported from the protocol 3 JSON script (E7-skill-hud-wiring, rodada 4): the run no longer ends in seconds, so
// the old "shared victory" and "rematch" checks are gone; the frames are decoded with the client's own decoder.
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {FrameDecoder,PROTOCOL_VERSION} from '../src/game/net/protocol4.ts';
const endpoint=process.argv[2];if(!endpoint)throw new Error('Pass the multiplayer HTTPS endpoint.');
const origin=process.argv[3]??'https://viagem.cyou';
const peers=[],checks=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,timeout=10000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error(`Timeout: ${label}`);await wait(30);}}
async function create(){const r=await fetch(`${endpoint}/rooms`,{method:'POST',headers:{Origin:origin}});assert.equal(r.status,201);return (await r.json()).code;}
function connect(code,name,token){
  const url=new URL(`/room/${code}`,endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const p={ws:new WebSocket(url,{origin}),dec:new FrameDecoder(),players:new Map(),enemies:new Map(),bytes:0,seq:0,code,decodeErrors:0};peers.push(p);
  p.ws.on('open',()=>p.ws.send(JSON.stringify({t:'join',protocol:PROTOCOL_VERSION,name,classId:'cidadao-comum',...(token?{token}:{})})));
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
    if(m.t==='welcome'){p.id=m.id;p.token=m.token;p.run=m.run;p.world=m.world;p.seq=m.ack??0;p.dec.reset();}
    else if(m.t==='run'&&m.run)p.run=m.run;
  });
  return p;
}
let timer;
try{
  const health=await (await fetch(`${endpoint}/health`)).json();assert.equal(health.protocol,PROTOCOL_VERSION,`Requires room protocol ${PROTOCOL_VERSION}`);
  checks.push(`/health speaks room protocol ${PROTOCOL_VERSION}`);
  const code=await create(),group=Array.from({length:6},(_,i)=>connect(code,`Prova ${i+1}`));
  await until(()=>group.every(p=>p.id&&p.players.size===6),'six joined');checks.push('six WebSocket clients in one room, six players in every decoded frame');
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
  assert.ok(latest.hp<=latest.maxHp,'forged hp ignored');checks.push('server movement, forged hp/damage ignored');
  const dropped=group[2];
  dropped.ws.terminate();await until(()=>group[0].players.get(dropped.id)?.online===false,'disconnect visible');
  const returned=connect(code,'Ignored on resume',dropped.token);await until(()=>returned.id&&returned.players.size===6,'reconnected');
  assert.equal(returned.id,dropped.id);assert.deepEqual(returned.world,dropped.world);group[2]=returned;checks.push('real connection drop and token resume without duplicate');
  clearInterval(timer);timer=undefined;
  assert.ok(group.every(p=>p.decodeErrors===0),'no frame failed to decode');checks.push('every frame decoded on all six clients');
  const report={checkedAt:new Date().toISOString(),endpoint,origin,transport:'WebSocket',protocol:PROTOCOL_VERSION,clients:6,world:group[0].world,checks,incomingBytes:group.map(p=>p.bytes),
    note:'Node protocol clients, not six phones or browser rendering. The run is not played to its end (about 13 minutes).'};
  await writeFile('docs/multiplayer-websocket-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{clearInterval(timer);for(const p of peers){if(p.ws.readyState===WebSocket.OPEN){p.ws.send(JSON.stringify({t:'leave'}));p.ws.close();}else if(p.ws.readyState!==WebSocket.CLOSED)p.ws.terminate();}}
