/**
 * VGM-045: the protocol bots' pure parts (brain, metrics, free-plan arithmetic) and the lab network (delay, outage,
 * drop) against a local ws server. The whole runs against `wrangler dev` live in scripts/bots/run.ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {WebSocketServer} from 'ws';
import {decide,newMemory,pickRecipe,nodeFor,forgerId,SOS_GAP,PICK_DELAY_COMBAT,PICK_DELAY_PREPARE,type BrainInput} from '../../scripts/bots/brain.ts';
import {percentile,rates,TickStitcher,freePlan,FREE_PLAN} from '../../scripts/bots/metrics.ts';
import {Link,OrderedDelay,OUTAGE_CONNECT_FAIL_MS} from '../../scripts/bots/lab-socket.ts';
import type {RunView,PlayerRunView,NodeView} from '../../src/contract/view.ts';

const player=(id:string,x:number,y:number,extra:Partial<PlayerRunView>={}):PlayerRunView=>({id,name:id,classId:'cidadao-comum',hp:100,maxHp:100,online:true,spectator:false,weapons:[],passives:[],...extra,...{x,y}} as PlayerRunView);
function view(extra:Partial<RunView>={}):RunView{
  return {tick:1000,team:{xp:0,level:1,nextXp:5},round:{index:2,total:10,phase:'wave',phaseEndsTick:2000,remaining:0},enemies:[],pickups:[],projectiles:[],telegraphs:[],
    structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600}],players:[player('a',0,3),player('b',1,3)],offers:[],events:[],camp:{coco:0,pedra:0},...extra};
}
const input=(v:RunView,at={x:0,y:3},memory=newMemory(0),selfId='a'):BrainInput=>({view:v,selfId,at,index:0,memory});

test('brain: a critter on top pushes the bot away from it',()=>{
  const d=decide(input(view({enemies:[{id:'e1',kind:'bebado',x:.5,y:3,hp:10,maxHp:10}]})));
  assert.equal(d.mode,'fight');assert.ok(d.direction.x<-.5,`moves away (x ${d.direction.x})`);
});
test('brain: far from the wall in combat, the bot walks home',()=>{
  const d=decide(input(view(),{x:20,y:0}));
  assert.ok(d.direction.x<-.8,`toward the wall (x ${d.direction.x})`);assert.equal(d.mode,'home');
});
test('brain: inside a telegraph, the bot steps out of it',()=>{
  const v=view({telegraphs:[{id:'t',shape:'circle',x:0,y:3,radius:1.5,fireTick:1010}]});
  const d=decide(input(v));
  assert.equal(d.mode,'dodge');
  const next={x:0+d.direction.x*1.6,y:3+d.direction.y*1.6};assert.ok(Math.hypot(next.x,next.y-3)>1.5);
});
test('brain: fallen, it asks for help once per SOS_GAP and does not walk',()=>{
  const memory=newMemory(0),v=view({players:[player('a',0,3,{hp:0,downed:{progress:0,bleedOutTick:1600}}),player('b',1,3)]});
  const first=decide(input(v,undefined,memory));assert.equal(first.mode,'down');assert.equal(first.sos,true);assert.deepEqual(first.direction,{x:0,y:0});
  assert.equal(decide(input({...v,tick:1000+SOS_GAP-1},undefined,memory)).sos,false);
  assert.equal(decide(input({...v,tick:1000+SOS_GAP},undefined,memory)).sos,true);
});
test('brain: a fallen friend within reach is rescued',()=>{
  const v=view({players:[player('a',0,3),player('b',5,3,{hp:0,downed:{progress:0,bleedOutTick:1600}})]});
  const d=decide(input(v));assert.equal(d.mode,'rescue');assert.ok(d.direction.x>.8);
});
test('brain: the offer is picked (default card) after the reaction delay, not at once',()=>{
  const memory=newMemory(0),offer={id:'lvl-2-a',source:'level' as const,level:2,choices:[{itemId:'x',level:1},{itemId:'y',level:1}],deadlineTick:5000,defaultIndex:1};
  const v=view({offers:[offer]});
  assert.equal(decide(input(v,undefined,memory)).choose,undefined);
  assert.deepEqual(decide(input({...v,tick:1000+PICK_DELAY_COMBAT},undefined,memory)).choose,{offer:'lvl-2-a',index:1});
  assert.equal(decide(input({...v,tick:1001+PICK_DELAY_COMBAT},undefined,memory)).choose,undefined,'not again right away');
  const prepare=newMemory(0),pv=view({offers:[offer],round:{index:2,total:10,phase:'prepare',phaseEndsTick:2000,remaining:0}});
  decide(input(pv,undefined,prepare));
  assert.ok(decide(input({...pv,tick:1000+PICK_DELAY_PREPARE},undefined,prepare)).choose,'faster in the intermission');
});
const node=(id:string,x:number,y:number,remaining=4):NodeView=>({id,kind:'coco',x,y,remaining,capacity:4,value:1,progress:0});
test('brain: intermission — gather at its own node, home on the horn',()=>{
  const prepare={index:3,total:10,phase:'prepare' as const,phaseEndsTick:1000+30*20,remaining:0};
  const nodes=[node('n1',8,0),node('n2',-8,0),node('n3',0,-8,0)];
  assert.equal(nodeFor(nodes,{x:0,y:0},0)?.id,'n1');assert.equal(nodeFor(nodes,{x:0,y:0},1)?.id,'n2');assert.equal(nodeFor(nodes,{x:0,y:0},2)?.id,'n1','empty nodes are skipped');
  // 'b' is the forger (sorted ids: a < b... here the bot is 'b' so it gathers).
  const v=view({round:prepare,nodes,players:[player('a',0,3),player('b',0,3)]});
  const d=decide({...input(v,{x:0,y:3},newMemory(0),'b')});
  assert.equal(d.mode,'gather');assert.ok(d.direction.x>.5);
  const horn=decide({...input({...v,camp:{coco:0,pedra:0,hornEndsTick:1500}},{x:8,y:1},newMemory(0),'b')});
  assert.equal(horn.mode,'home');assert.ok(horn.direction.x<-.5);
});
test('brain: the forger spends the balance at the camp (repair first when the wall is hurt)',()=>{
  const prepare={index:3,total:10,phase:'prepare' as const,phaseEndsTick:1600,remaining:0};
  const rich={coco:10,pedra:10};
  assert.equal(pickRecipe(view({camp:rich,structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:300,maxHp:600}]})),'reparo');
  assert.equal(pickRecipe(view({camp:rich})),'torre-chinelo');
  const towers=[1,2,3].map(i=>({id:'t'+i,kind:'torre-chinelo',x:i,y:0,hp:1,maxHp:1,untilTick:2000}));
  assert.equal(pickRecipe(view({camp:rich,structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:600,maxHp:600},...towers]})),'gambiarra');
  assert.equal(pickRecipe(view({camp:rich,structures:[{id:'muralha',kind:'muralha',x:0,y:0,hp:590,maxHp:600},...towers]}),{gambiarra:2}),'reparo','a refused gambiarra falls back to topping the wall up');
  assert.equal(pickRecipe(view({camp:{coco:1,pedra:1}})),undefined);
  assert.equal(forgerId(view()),'a');
  const memory=newMemory(0),v=view({round:prepare,camp:rich});
  const d=decide(input(v,{x:0,y:2},memory));
  assert.equal(d.mode,'forge');assert.equal(d.forge,'torre-chinelo');
  assert.equal(decide(input({...v,tick:1001},{x:0,y:2},memory)).forge,undefined,'one tap per FORGE_GAP');
  const away=decide(input(v,{x:15,y:0},newMemory(0)));assert.equal(away.forge,undefined);assert.ok(away.direction.x<-.5,'walks back to the camp first');
});

test('metrics: percentile, per-second rates, stitched tick samples',()=>{
  assert.equal(percentile([5,1,3,2,4],.5),3);assert.equal(percentile([],.5),0);assert.equal(percentile([1,2,3,4,5,6,7,8,9,10],.95),10);
  const seconds=[0,1,2,3].map(s=>({second:s,up:s,down:10,upBytes:100,downBytes:1000*s,frames:10}));
  const r=rates(seconds,1,5);assert.equal(r.seconds,4);assert.equal(r.upMsgs.mean,1.5,'a missing second counts as zero');assert.equal(r.totalUp,6);
  const t=new TickStitcher();
  t.add(100,[1,1,1]);
  t.add(103,[1,1,1,2,3,4]);assert.deepEqual(t.samples,[2,3,4]);
  t.add(110,[5,6,7]);assert.equal(t.missed,4);assert.deepEqual(t.samples,[2,3,4,5,6,7]);
  assert.equal(t.summary().max,7);
});
test('free plan: connections + messages/20 + the create and alarm; duration on 128 MB; the tighter limit wins',()=>{
  const plan=freePlan({incomingMessages:40_000,connections:8,otherRequests:2,activeSeconds:1000,rowsWritten:30});
  assert.equal(plan.requests,8+2+2000);
  assert.equal(plan.byRequests,Math.floor(100_000/2010));
  assert.equal(plan.gbSeconds,125);assert.equal(plan.byDuration,104);
  assert.equal(plan.matchesPerDay,49);assert.equal(plan.limit,'requests');
  assert.equal(FREE_PLAN.messagesPerRequest,20);
  assert.equal(freePlan({incomingMessages:2000,connections:6,otherRequests:2,activeSeconds:1000,rowsWritten:30}).limit,'duration');
});
test('lab network: delivery order survives a shrinking delay',()=>{
  let t=0;const q=new OrderedDelay(()=>t);
  assert.equal(q.due(100),100);t=10;assert.equal(q.due(5),100,'never before the previous one');t=200;assert.equal(q.due(5),205);
});

const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(predicate:()=>boolean,label:string,timeoutMs=3000){
  const start=performance.now();
  while(!predicate()){if(performance.now()-start>timeoutMs)throw new Error(`timeout: ${label}`);await wait(10);}
}
test('lab network: delay, drop and outage against a real ws server',async()=>{
  const server=new WebSocketServer({port:0,host:'127.0.0.1'});
  await new Promise(r=>server.once('listening',r));
  const port=(server.address() as {port:number}).port,serverCloses:number[]=[];let origin='';
  server.on('connection',(ws,req)=>{origin=req.headers.origin??'';ws.on('message',d=>ws.send(String(d)));ws.on('close',()=>serverCloses.push(performance.now()));});
  try{
    const link=new Link('http://127.0.0.1:4187',{rttMs:200});
    const Socket=link.socketClass();
    const open=(s:InstanceType<typeof Socket>)=>new Promise<void>(r=>{s.onopen=()=>r();});
    const ws=new Socket(`ws://127.0.0.1:${port}`);ws.binaryType='arraybuffer';
    await open(ws);assert.equal(origin,'http://127.0.0.1:4187');
    const echo=new Promise<number>(r=>{const start=performance.now();ws.onmessage=()=>r(performance.now()-start);ws.send('{"t":"ping"}');});
    const rtt=await echo;assert.ok(rtt>=190&&rtt<1000,`echo took ${rtt} ms with 200 ms of added RTT`);
    assert.equal(link.stats.sentByType.ping,1);assert.equal(link.stats.recvJson,1);
    // Drop: both ends see the close.
    const closed=new Promise<number>(r=>{ws.onclose=e=>r(e.code);});
    link.drop();assert.equal(await closed,1006);await until(()=>serverCloses.length===1,'room hears the drop');
    // Outage: the open socket goes silent (no close on either side), new attempts fail; the end cuts it.
    const ws2=new Socket(`ws://127.0.0.1:${port}`);await open(ws2);
    let heard=0;ws2.onmessage=()=>{heard++;};
    const outage=link.outage(600);
    ws2.send('{"t":"ack"}');await wait(300);assert.equal(heard,0,'nothing crosses');assert.equal(serverCloses.length,1,'the room does not hear a close');
    const failed=new Promise<number>(r=>{const s=new Socket(`ws://127.0.0.1:${port}`);s.onclose=e=>r(e.code);});
    assert.equal(await failed,1006);assert.ok(OUTAGE_CONNECT_FAIL_MS<=1000);assert.equal(link.stats.failedConnects,1);
    await outage;await until(()=>serverCloses.length===2,'cut at the end of the outage');
    const ws3=new Socket(`ws://127.0.0.1:${port}`);await open(ws3);ws3.close();
  }finally{for(const c of server.clients)c.terminate();server.close();}
});

test('N27 lab link: items due on the same millisecond still go in the order they were handed in',async()=>{
  const q=new OrderedDelay();const got:number[]=[];
  // 200 items with random delays inside 2 ms: due() makes most of them share a time; one timer keeps the order.
  for(let i=0;i<200;i++)q.schedule(5+Math.random()*2,()=>got.push(i));
  await new Promise(r=>setTimeout(r,60));
  assert.deepEqual(got,Array.from({length:200},(_,i)=>i));
});
