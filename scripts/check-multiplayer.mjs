import WebSocket from 'ws';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const endpoint=process.argv[2];if(!endpoint)throw new Error('Pass the multiplayer HTTPS endpoint.');
const origin=process.argv[3]??'https://viagem.cyou';
const peers=[],checks=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate,label,timeout=10000){const start=Date.now();while(!predicate()){if(Date.now()-start>timeout)throw new Error(`Timeout: ${label}`);await wait(30);}}
async function create(){const r=await fetch(`${endpoint}/rooms`,{method:'POST',headers:{Origin:origin}});assert.equal(r.status,201);return (await r.json()).code;}
function connect(code,name,token){
  const url=new URL(`/room/${code}`,endpoint);url.protocol=url.protocol==='https:'?'wss:':'ws:';
  const p={ws:new WebSocket(url,{origin}),players:new Map(),enemies:new Map(),frames:new Map(),bytes:0,seq:0,code};peers.push(p);
  p.ws.on('open',()=>p.ws.send(JSON.stringify({t:'join',name,classId:'cidadao-comum',...(token?{token}:{})})));
  p.ws.on('error',e=>{p.error=e.message;});p.ws.on('close',(code)=>{p.closed=code;});
  p.ws.on('message',data=>{p.bytes+=data.length;const m=JSON.parse(data);if(m.t==='error'){p.error=m.message;return;}let s=m;
    if(m.t==='welcome'){p.id=m.id;p.token=m.token;s=m.state;p.seq=s.players.find(v=>v[0]===p.id)[4];}
    if(s.t!=='state')return;if(s.full){p.players.clear();p.enemies.clear();}for(const v of s.players)p.players.set(v[0],v);for(const v of s.enemies)p.enemies.set(v[0],v);for(const id of s.removed)p.players.delete(id);
    p.tick=s.tick;p.frames.set(s.tick,JSON.stringify({players:[...p.players.values()].sort(),enemies:[...p.enemies.values()].sort(),victory:s.victory}));if(p.frames.size>80)p.frames.delete(p.frames.keys().next().value);
  });return p;
}
let timer;
try{
  const code=await create(),group=Array.from({length:6},(_,i)=>connect(code,`Prova ${i+1}`));
  await until(()=>group.every(p=>p.id&&p.players.size===6),'six joined');checks.push('six WebSocket clients in one room');
  const seventh=connect(code,'Seventh');await until(()=>seventh.error,'seventh rejected');assert.match(seventh.error,/cheia/);checks.push('seventh player rejected');
  const isolated=connect(await create(),'Separate');await until(()=>isolated.id,'isolated joined');assert.equal(isolated.players.size,1);assert.equal(group[0].players.has(isolated.id),false);checks.push('room isolation');
  const original={x:group[0].players.get(group[0].id)[1],y:group[0].players.get(group[0].id)[2]},start=Date.now();
  timer=setInterval(()=>{for(const [index,p] of group.entries())if(p.ws.readyState===WebSocket.OPEN)p.ws.send(JSON.stringify({t:'input',seq:++p.seq,x:index===0&&Date.now()-start<800?1:0,y:0,attack:true,hp:999999,damage:999999,position:{x:999,y:999}}));},50);
  await until(()=>group.every(p=>p.tick>100),'100 simulation ticks');
  const latest=group[0].players.get(group[0].id);assert.ok(Math.hypot(latest[1]-original.x,latest[2]-original.y)>.3);assert.ok(latest[3]<=100);assert.ok(Math.abs(latest[1])<30);checks.push('server movement, ignored forged position/hp/damage');
  await until(()=>group[0].players.get(group[0].id)[6]>0,'cooperative kill reward',12000);checks.push('server enemies, damage and shared kill reward');
  const common=[...group[0].frames.keys()].reverse().find(t=>group.every(p=>p.frames.has(t)));
  assert.ok(common);assert.equal(new Set(group.map(p=>p.frames.get(common))).size,1);checks.push('all six reconstruct exactly the same players/enemies at one tick');
  assert.ok(group.every(p=>p.players.get(group[0].id)[9]>0));checks.push('accepted attack animation tick reaches every observer');
  const dropped=group[2],before=[...dropped.players.get(dropped.id)],enemyBefore=[...dropped.enemies.values()].map(e=>[e[0],e[3]]);
  dropped.ws.terminate();await until(()=>group[0].players.get(dropped.id)?.[5]===false,'disconnect visible');
  const returned=connect(code,'Ignored on resume',dropped.token);await until(()=>returned.id,'reconnected');assert.equal(returned.id,dropped.id);assert.equal(returned.players.size,6);assert.equal(returned.players.get(returned.id)[6],before[6]);assert.ok(returned.players.get(returned.id)[3]<=before[3]);
  for(const [id,hp] of enemyBefore)assert.ok(returned.enemies.get(id)[3]<=hp);group[2]=returned;checks.push('real connection drop and token resume without duplicate or reset');
  clearInterval(timer);timer=undefined;
  const report={checkedAt:new Date().toISOString(),endpoint,origin,transport:'WebSocket',clients:6,checks,commonTick:common,incomingBytes:group.map(p=>p.bytes),note:'Node protocol clients, not six phones or browser rendering. No account/database writes. Tokens excluded.'};
  await writeFile('docs/multiplayer-websocket-proof.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{clearInterval(timer);for(const p of peers){if(p.ws.readyState===WebSocket.OPEN){p.ws.send(JSON.stringify({t:'leave'}));p.ws.close();}else if(p.ws.readyState!==WebSocket.CLOSED)p.ws.terminate();}}
