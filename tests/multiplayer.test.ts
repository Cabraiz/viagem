import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation,STEP,reconcile,simulate,delta,type Input} from '../src/game/net/shared.ts';
import {Room,type Peer} from '../multiplayer/room.ts';
import {walkable,SPEED} from '../src/game/world.ts';

function peer(){const messages:any[]=[],closes:any[]=[];return {messages,closes,send:(s:string)=>messages.push(JSON.parse(s)),close:(code:number,reason:string)=>closes.push({code,reason})};}
const join=(r:Room,p:Peer,n='Amigo',now=1000)=>{r.connect(p,now);r.receive(p,JSON.stringify({t:'join',name:n,classId:'cidadao-comum'}),now);};
test('six slots, seventh refused, and rooms isolated',()=>{
  const r=new Room(1000),peers=Array.from({length:7},()=>peer());peers.forEach((p,i)=>join(r,p,`Amigo ${i}`));
  assert.equal(r.sim.players.size,6);assert.equal(peers[6].closes[0].code,4003);
  const other=new Room(1000),p=peer();join(other,p);assert.equal(other.sim.players.size,1);assert.equal(r.sim.players.size,6);
});
test('reconnect preserves identity, health, score, enemies and refuses stolen display name',()=>{
  const r=new Room(1000),a=peer();join(r,a);const w=a.messages.find(m=>m.t==='welcome');
  const original=r.sim.players.get(w.id)!;original.hp=64;original.score=10;r.sim.enemies[0].hp=20;
  r.disconnect(a,1500);const b=peer();r.connect(b,1600);r.receive(b,JSON.stringify({t:'join',token:w.token}),1600);
  assert.equal(b.messages[0].id,w.id);assert.equal(r.sim.players.size,1);assert.equal(original.hp,64);assert.equal(original.score,10);assert.equal(r.sim.enemies[0].hp,20);
  const duplicate=peer();r.connect(duplicate,1600);r.receive(duplicate,JSON.stringify({t:'join',token:w.token}),1600);assert.equal(duplicate.closes[0].code,4003);
  const fake=peer();r.connect(fake,1600);r.receive(fake,JSON.stringify({t:'join',token:'invalid',name:'Amigo'}),1600);assert.equal(fake.closes[0].code,4003);
});
test('expired token cannot reclaim a slot or create a duplicate',()=>{
  const r=new Room(1000),p=peer();join(r,p);const token=p.messages[0].token;r.disconnect(p,1100);
  const back=peer();r.connect(back,32100);r.receive(back,JSON.stringify({t:'join',token}),32100);assert.equal(back.closes[0].code,4003);assert.equal(r.sim.players.size,0);
});
test('movement ignores position/hp/damage fields and is capped per server tick',()=>{
  const s=new Simulation();const p=s.add('p','Tester','cidadao-comum'),start={...p};s.enemies=[];
  assert.equal(s.input('p',{seq:1,x:Infinity,y:0,attack:false}),false);
  assert.equal(s.input('p',{seq:1,x:1000,y:1000,attack:false}),false);
  for(let seq=1;seq<=30;seq++)s.input('p',{seq,x:1,y:1,attack:false,hp:99999,position:{x:50,y:50},damage:100000});
  s.step();assert.ok(Math.hypot(p.x-start.x,p.y-start.y)<=SPEED*STEP+.000001);assert.equal(p.hp,100);assert.equal(p.ack,1);
  assert.equal(s.input('p',{seq:1,x:1,y:0,attack:false}),false);
  for(let i=0;i<400;i++){s.input('p',{seq:Math.max(p.ack+1,i+31),x:1,y:1,attack:false});s.step();assert.ok(walkable(p));}
});
test('prediction replay produces same state after delayed acknowledgement',()=>{
  const s=new Simulation();s.enemies=[];const p=s.add('p','Tester','cidadao-comum');
  const inputs:Input[]=Array.from({length:12},(_,i)=>({seq:i+1,x:i<6?1:0,y:i<6?0:1,attack:false}));
  const predicted=inputs.reduce((p,i)=>simulate(p,i),{x:p.x,y:p.y});
  for(const i of inputs.slice(0,5)){s.input('p',i);s.step();}
  const replay=reconcile(p,inputs.filter(i=>i.seq>p.ack));assert.deepEqual(replay,predicted);
});
test('combat checks range, cooldown, shared reward and no duplicate kill reward',()=>{
  const s=new Simulation(),p=s.add('p','Tester','cidadao-comum'),q=s.add('q','Ally','mendigo');
  s.enemies=[{id:'enemy',x:p.x+.6,y:p.y,hp:60}];
  for(let seq=1;seq<=25;seq++){s.input('p',{seq,x:0,y:0,attack:true});s.step();}
  assert.equal(s.enemies[0].hp,0);assert.equal(p.score,10);assert.equal(q.score,10);assert.equal(s.victory,true);
  for(let seq=26;seq<80;seq++){s.input('p',{seq,x:0,y:0,attack:true});s.step();}assert.equal(p.score,10);
  const far=new Simulation(),a=far.add('a','Tester','cidadao-comum');far.enemies=[{id:'enemy',x:12,y:5,hp:60}];far.input(a.id,{seq:1,x:0,y:0,attack:true});far.step();assert.equal(far.enemies[0].hp,60);
});
test('delta can reconstruct full state and removes departed players',()=>{
  const s=new Simulation();s.add('a','A','cidadao-comum');s.add('b','B','mendigo');const before=s.snapshot();s.remove('b');s.input('a',{seq:1,x:1,y:0,attack:false});s.step();const after=s.snapshot(),patch=delta(before,after);
  const players=new Map(before.players.map(p=>[p[0],p]));for(const p of patch.players)players.set(p[0],p);for(const id of patch.removed)players.delete(id);
  assert.deepEqual([...players.values()],after.players);assert.ok(JSON.stringify(patch).length<JSON.stringify(after).length+100);
});

test('explicit target hits the selected enemy instead of a closer enemy',()=>{
  const s=new Simulation(),p=s.add('p','Tester','cidadao-comum');
  s.enemies=[{id:'near',x:p.x+.4,y:p.y,hp:60},{id:'chosen',x:p.x+1,y:p.y,hp:60}];
  s.input(p.id,{seq:1,x:0,y:0,attack:true,target:'chosen'});s.step();
  assert.equal(s.enemies[0].hp,60);assert.equal(s.enemies[1].hp,40);
});
test('target identifier cannot bypass range or damage an unrelated enemy',()=>{
  for(const target of ['far','missing']){
    const s=new Simulation(),p=s.add('p','Tester','cidadao-comum');
    s.enemies=[{id:'near',x:p.x+.4,y:p.y,hp:60},{id:'far',x:12,y:5,hp:60}];
    s.input(p.id,{seq:1,x:0,y:0,attack:true,target});s.step();
    assert.deepEqual(s.enemies.map(e=>e.hp),[60,60]);
    assert.equal(s.input(p.id,{seq:2,x:0,y:0,attack:true,target:{id:'near'}}),false);
  }
});
test('message flooding and oversized payloads close connection',()=>{
  const r=new Room(1000),a=peer();join(r,a);for(let i=0;i<50;i++)r.receive(a,'{"t":"ping","at":1}',1000);assert.equal(a.closes[0].code,4008);
  const b=peer();join(r,b,'B',1000);r.receive(b,'a'.repeat(1025),1000);assert.equal(b.closes[0].code,1009);
});
