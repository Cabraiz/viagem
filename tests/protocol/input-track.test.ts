import test from 'node:test';
import assert from 'node:assert/strict';
import {Simulation} from '../../multiplayer/simulation.ts';
import {simulate,reconcile,STEP} from '../../src/maps/prediction.ts';
import {type Input,ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {InputBatcher,InputTrack,DIRECTIONS,DIRECTION_BUCKETS,quantizeDirection,SEND_MIN_MS,KEEPALIVE_MS,HORIZON_STEPS,MAX_SEGMENTS,LEAD_STEPS} from '../../src/protocol/input-track.ts';
import {SPEED,type Point} from '../../src/maps/world.ts';
import {Room} from '../../multiplayer/room.ts';
import {createEnemy} from '../../src/sim/enemies/catalog.ts';

const dist=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
const at=(angle:number)=>({x:Math.cos(angle),y:Math.sin(angle)});

test('directions: 32 buckets, exact on the wire, a stopped stick is -1 and the held bucket has hysteresis',()=>{
  assert.equal(DIRECTIONS.length,DIRECTION_BUCKETS);
  for(const d of DIRECTIONS){assert.ok(Math.abs(Math.hypot(d.x,d.y)-1)<1e-3);assert.deepEqual(JSON.parse(JSON.stringify(d)),d);assert.ok(!Object.is(d.x,-0)&&!Object.is(d.y,-0));}
  assert.equal(quantizeDirection({x:0,y:0}),-1);assert.equal(quantizeDirection({x:NaN,y:1}),-1);
  assert.equal(quantizeDirection({x:1,y:0}),0);assert.equal(quantizeDirection({x:0,y:1}),8);assert.equal(quantizeDirection({x:1,y:-1e-9}),0);
  const step=2*Math.PI/DIRECTION_BUCKETS;
  // Past the half bucket but inside the hysteresis: the held bucket stays; past it, the stick moves on.
  assert.equal(quantizeDirection(at(step*.6)),1);assert.equal(quantizeDirection(at(step*.6),0),0);assert.equal(quantizeDirection(at(step*.8),0),1);
  assert.equal(quantizeDirection(at(-step*.7),0),0);assert.equal(quantizeDirection(at(Math.PI*2-step*.2)),0);
});

test('batcher: a still stick sends nothing, a change goes at once, the next one waits the 10 Hz slot, walking keeps alive each second',()=>{
  const b=new InputBatcher();b.reset(0);
  for(let i=0;i<40;i++){const {active}=b.step({x:0,y:0},false);assert.equal(active,false);assert.equal(b.take(i*50),undefined,'still: no message');}
  let r=b.step({x:1,y:0},false);assert.equal(r.active,true);
  const first=b.take(2000)!;assert.deepEqual(first,{seq:41,steps:[[41,1,0,0]]});
  b.step({x:0,y:1},false);assert.equal(b.take(2050),undefined,'second change inside 100 ms waits');assert.equal(b.waitingUntil,2000+SEND_MIN_MS);
  b.step({x:0,y:1},false);const second=b.take(2100)!;assert.deepEqual(second.steps,[[42,0,1,0]]);assert.equal(second.seq,43);
  // Same bucket for a second: one keepalive, with no steps.
  let sent:number[]=[];
  for(let t=2150;t<=4200;t+=50){b.step({x:.01,y:1},false);if(b.take(t))sent.push(t);}
  assert.deepEqual(sent,[2100+KEEPALIVE_MS,2100+2*KEEPALIVE_MS]);
  // A skill press is a change, its release too; the skill alone (standing) keeps the room stepping.
  r=b.step({x:0,y:0},true);assert.equal(r.active,true);assert.equal(r.input.skill,true);
  const press=b.take(5000)!;assert.deepEqual(press.steps.at(-1)!.slice(1),[0,0,1]);
  b.step({x:0,y:0},false);assert.equal(b.active,false);
});

test('batcher: a stick sweeping fast still sends at most 10 messages per second, every change kept in order',()=>{
  const b=new InputBatcher();b.reset(0);let messages=0;const froms:number[]=[];
  for(let t=0;t<10_000;t+=50){b.step(at(t/1000*6),false);const m=b.take(t);if(m){messages++;for(const w of m.steps)froms.push(w[0]);}}
  assert.ok(messages<=100,`${messages} messages in 10 s`);assert.ok(messages>=90);
  assert.deepEqual(froms,[...froms].sort((x,y)=>x-y));
  assert.ok(new Set(froms).size===froms.length);
});

/** Client steps every tick; batches and frames each travel `lat` (+ up to `jit`) ticks, in order. */
function pipeline({lat,jit,ticks=1500,seed=7}:{lat:number;jit:number;ticks?:number;seed?:number}){
  let r=seed;const rnd=()=>{r=(r*1103515245+12345)%2147483648;return r/2147483648;};
  const s=new Simulation();const p=s.add('p','T','cidadao-comum');s.resetRun();
  const b=new InputBatcher();b.reset(0);
  let predicted={x:p.x,y:p.y},pending:Input[]=[],up:{at:number;batch:unknown}[]=[],down:{at:number;x:number;y:number;ack:number}[]=[],angle=0,stopUntil=-1,lastUp=0,lastDown=0,messages=0;
  const corrections:number[]=[];
  for(let t=0;t<ticks;t++){
    if(rnd()<.01)stopUntil=t+20+Math.floor(rnd()*40);
    if(rnd()<.05)angle+=Math.PI*(rnd()<.2?1:.3)*(rnd()<.5?-1:1);else angle+=.25*(rnd()-.5);
    const {input,active}=b.step(t<stopUntil?{x:0,y:0}:at(angle),false);
    if(active){pending.push(input);predicted=simulate(predicted,input,s.terrain);}
    const batch=b.take(t*50);
    if(batch){messages++;lastUp=Math.max(lastUp,t+lat+Math.floor(rnd()*(jit+1)));up.push({at:lastUp,batch});}
    for(const m of up.filter(m=>m.at<=t))assert.ok(s.input('p',m.batch));
    up=up.filter(m=>m.at>t);
    s.step();
    if(t%2===0){lastDown=Math.max(lastDown,t+lat+Math.floor(rnd()*(jit+1)));down.push({at:lastDown,x:p.x,y:p.y,ack:p.ack,...s.confirmed('p')});}
    for(const f of down.filter(f=>f.at<=t)){
      b.catchUp(f.ack);pending=pending.filter(i=>i.seq>f.ack);
      const re=reconcile(f,pending,s.terrain);corrections.push(dist(re,predicted));predicted=re;
    }
    down=down.filter(f=>f.at>t);
  }
  return {corrections,messages,seconds:ticks/20};
}

test('prediction stays exact through batching and latency: the room applies the client steps in order, late changes rewound',()=>{
  for(const lat of [0,1,3]){
    const {corrections,messages,seconds}=pipeline({lat,jit:0});
    assert.equal(Math.max(...corrections),0,`latency ${lat} ticks: no correction`);
    assert.ok(messages/seconds<=10,`${(messages/seconds).toFixed(1)} msg/s`);
  }
  // 4G-like jitter (up to 50 ms on top of 150 ms RTT): rare corrections, never more than one step.
  const jittery=pipeline({lat:2,jit:1});
  assert.ok(Math.max(...jittery.corrections)<=SPEED*STEP+1e-9);
  assert.ok(jittery.corrections.filter(c=>c>.01).length<=jittery.corrections.length*.01);
});

test('no speed from forged batches: one step per tick, each at most one step long',()=>{
  const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();const start={x:p.x,y:p.y};
  // Eight segments, far-future seq, max direction, then a flood of keepalives claiming huge client steps.
  const steps=Array.from({length:MAX_SEGMENTS},(_,i)=>[i+1,1,0,0]);
  assert.equal(s.input('p',{seq:2**31-1,steps}),true);
  for(let i=0;i<40;i++)s.input('p',{seq:2**31-1,steps:[]});
  for(let t=0;t<60;t++){const before={x:p.x,y:p.y};s.step();assert.ok(dist(p,before)<=SPEED*STEP+1e-9,'one step per tick');}
  assert.ok(dist(p,start)<=60*SPEED*STEP+1e-9);
});

test('fuzz: no forged sequence moves a player more than one step in a tick (review onda 5: no rewind, no rewriting reported steps)',()=>{
  for(let seed=1;seed<=40;seed++){
    let r=seed;const rnd=()=>{r=(r*1103515245+12345)%2147483648;return r/2147483648;};
    const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
    let now=0,maxSeq=1;
    for(let t=0;t<300;t++){
      // Anything goes: late or early `from`, reversed directions, tiny or huge seq, legacy steps (skills move by design: left out).
      for(let k=Math.floor(rnd()*4);k>0;k--){
        const seq=Math.max(1,Math.floor(rnd()<.3?maxSeq+rnd()*60:maxSeq*rnd()));maxSeq=Math.max(maxSeq,seq);
        const n=Math.floor(rnd()*MAX_SEGMENTS),froms=Array.from({length:n},()=>Math.max(1,Math.floor(seq-rnd()*40))).sort((a,b)=>a-b);
        const steps=froms.map(f=>{const a=rnd()*7;return [f,Math.round(Math.cos(a)*1e4)/1e4,Math.round(Math.sin(a)*1e4)/1e4,0];});
        if(rnd()<.2)s.input('p',{seq,x:rnd()*2-1,y:rnd()*2-1,attack:false},now);
        else s.input('p',{seq,steps},now);
      }
      const before={x:p.x,y:p.y};now+=50;s.step(now);
      assert.ok(dist(p,before)<=SPEED*STEP+1e-9,`seed ${seed}, tick ${t}: ${dist(p,before).toFixed(3)} u`);
    }
  }
});

test('a segment may not rewrite steps the client already reported',()=>{
  const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
  assert.equal(s.input('p',{seq:10,steps:[[1,1,0,0]]},0),true);
  for(let t=1;t<=12;t++)s.step(t*50);
  // The client said it was at step 10 walking east; a change "from step 5" contradicts it.
  assert.equal(s.input('p',{seq:12,steps:[[5,-1,0,0]]},600),false);
  assert.equal(s.input('p',{seq:12,steps:[[10,-1,0,0]]},600),false);
  assert.equal(s.input('p',{seq:12,steps:[[11,-1,0,0]]},600),true);
});

test('skill tap: one-shot, cast on the next step (in place when standing), answered once, ids only grow',()=>{
  const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
  assert.equal(s.tap('p',1),true);s.step(50);
  assert.deepEqual(s.casts.map(c=>[c.id,c.seq,c.ok]),[['p',1,true]]);assert.ok(p.skillTick);
  assert.equal(p.ack,0,'standing: cast in place, no step spent');
  s.step(100);assert.deepEqual(s.casts,[]);
  assert.equal(s.tap('p',1),false,'a repeated id is refused');
  // On cooldown: answered with ok false (the button never guesses).
  assert.equal(s.tap('p',2),true);s.step(150);
  assert.deepEqual(s.casts.map(c=>[c.seq,c.ok]),[[2,false]]);assert.ok(s.casts[0].readyTick>s.tick);
});

test('malformed or out-of-order batches are refused whole',()=>{
  const s=new Simulation();s.add('p','T','cidadao-comum');s.resetRun();
  const refuse=(v:unknown)=>assert.equal(s.input('p',v),false,JSON.stringify(v));
  refuse({seq:0,steps:[]});refuse({seq:1.5,steps:[]});refuse({seq:2**31,steps:[]});
  refuse({seq:5,steps:[[6,1,0,0]]});
  refuse({seq:5,steps:[[2,1,0,0],[2,0,1,0]]});
  refuse({seq:5,steps:[[1,2,0,0]]});refuse({seq:5,steps:[[1,1,0,2]]});refuse({seq:5,steps:[[1,1,0,0,{id:'x'}]]});refuse({seq:5,steps:[[1,1,0,0,'bad id!']]});
  refuse({seq:9,steps:Array.from({length:MAX_SEGMENTS+1},(_,i)=>[i+1,1,0,0])});
  refuse({seq:5,steps:[[1,Infinity,0,0]]});refuse({seq:5,steps:'1,1,0,0'});
  assert.equal(s.input('p',{seq:5,steps:[[3,1,0,0]]}),true);
  refuse({seq:6,steps:[[3,0,1,0]]});
});

test('the room stops guessing past its horizon when the client goes quiet, and a still stick costs no steps',()=>{
  const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
  s.input('p',{seq:1,steps:[[1,1,0,0]]});
  for(let t=0;t<LEAD_STEPS+HORIZON_STEPS+20;t++)s.step();
  assert.equal(p.ack,1+HORIZON_STEPS,'walked to the horizon, then stood');
  const still={x:p.x,y:p.y};s.step();assert.deepEqual({x:p.x,y:p.y},still);
  // The client walked until 39 and stopped at 40: the room walks those steps, then stands without stepping.
  s.input('p',{seq:40,steps:[[40,0,0,0]]});
  for(let t=0;t<20;t++)s.step();
  assert.equal(p.ack,39);
  // Back walking at 500, long after: no lag from the idle stretch, only the LEAD_STEPS wait on the client's clock.
  s.input('p',{seq:500,steps:[[500,0,1,0]]});
  for(let t=0;t<LEAD_STEPS;t++){s.step();assert.equal(p.ack,39);}
  const y=p.y;s.step();assert.equal(p.ack,500);assert.ok(p.y>y);
});

test('the room never walks ahead of the client clock, and the owner sees only the steps it reported',()=>{
  const s=new Simulation(),p=s.add('p','T','cidadao-comum');s.resetRun();
  // A phone that lost steps in long frames: it reports seq 10 and then, a second later, only seq 15.
  s.input('p',{seq:10,steps:[[1,1,0,0]]},0);
  for(let t=1;t<=20;t++)s.step(t*50);
  assert.ok(p.ack<=10+20-LEAD_STEPS,'bounded by the clock since the report');
  const guessed=p.ack;
  const own=s.confirmed('p')!;assert.equal(own.ack,10,'the owner frame carries the last reported step');
  // The position after step 10: exactly ten steps from the start.
  const fresh=new Simulation(),q=fresh.add('p','T','cidadao-comum');fresh.resetRun();
  for(let i=1;i<=10;i++){fresh.input('p',{seq:i,x:1,y:0,attack:false});fresh.step();}
  assert.deepEqual({x:own.x,y:own.y},{x:q.x,y:q.y});
  assert.ok(guessed>10);
});

test('a skill press that arrives after its steps still casts once; tap targets ride the segments',()=>{
  const room=new Room(1000),a={messages:[] as any[],closes:[] as any[],send(d:any){if(typeof d==='string')this.messages.push(JSON.parse(d));},close(code:number,reason:string){this.closes.push({code,reason});}};
  room.connect(a,1000);room.receive(a,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum'}),1000);
  room.receive(a,JSON.stringify({t:'ready',round:1,ready:true}),1050);
  for(let t=1100;t<=4200;t+=50)room.advance(t);
  assert.equal(room.run.snapshot().phase,'combat');
  const id=a.messages.find(m=>m.t==='welcome').id,p=room.sim.players.get(id)!;
  room.receive(a,JSON.stringify({t:'input',round:1,seq:1,steps:[[1,1,0,0]]}),4250);
  for(let t=4300;t<4600;t+=50)room.advance(t);
  const applied=p.ack;assert.ok(applied>1);
  // Pressed and released at step 2, long passed.
  room.receive(a,JSON.stringify({t:'input',round:1,seq:applied,steps:[[2,1,0,1],[3,1,0,0]]}),4600);
  const casts=p.skillTick;room.advance(4650);assert.notEqual(p.skillTick,casts,'cast on the next tick');
  // A tap target travels as a client id inside a segment and reaches the simulation as the server id.
  const enemy=createEnemy(room.sim.world,'bebado',{x:p.x+3,y:p.y});
  room.advance(4700);room.advance(4750);
  const label=room.ids.label('enemies',enemy.id);
  // Segments start after the last step reported (`applied` above): the room reaches them on the client's clock.
  let next=applied+1;
  room.receive(a,JSON.stringify({t:'input',round:1,seq:next,steps:[[next,0,0,0,label]]}),4800);
  for(let t=4850;t<=5000;t+=50)room.advance(t);
  assert.equal(p.target,enemy.id);
  // An unknown label only drops the target, the step still counts.
  next+=1;room.receive(a,JSON.stringify({t:'input',round:1,seq:next,steps:[[next,0,1,0,'e999999']]}),5050);
  const ack=p.ack;for(let t=5100;t<=5250;t+=50)room.advance(t);
  assert.equal(p.target,undefined);assert.ok(p.ack>ack);
});

test('room frames: the owner gets its confirmed step and position, the others the live (guessed) walk',async()=>{
  const {FrameRunFeed}=await import('../../src/client/net/run-feed.ts');
  const peer=()=>{const messages:any[]=[],frames:Uint8Array[]=[];return {messages,frames,send(d:string|Uint8Array){if(typeof d==='string')messages.push(JSON.parse(d));else frames.push(d);},close(){}};};
  const room=new Room(1000),a=peer(),b=peer();
  for(const [p,name] of [[a,'Ana'],[b,'Bia']] as const){room.connect(p,1000);room.receive(p,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name,classId:'cidadao-comum'}),1000);}
  for(const p of [a,b])room.receive(p,JSON.stringify({t:'ready',round:1,ready:true}),1050);
  let t=1100;for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const id=a.messages.find(m=>m.t==='welcome').id,p=room.sim.players.get(id)!;
  // Ana reports step 5 (walking since 1) and then nothing for a second: the room keeps walking on the clock.
  room.receive(a,JSON.stringify({t:'input',round:1,seq:5,steps:[[1,1,0,0]]}),t);
  const fa=new FrameRunFeed(),fb=new FrameRunFeed();
  const last=(feed:InstanceType<typeof FrameRunFeed>,p:{frames:Uint8Array[]})=>{let r:any;for(const f of p.frames.splice(0)){r=feed.decode(f);assert.ok(r.ok);}return r?.view.players.find((q:any)=>q.id===id);};
  for(let i=0;i<20;i++){t+=50;room.advance(t);last(fa,a);last(fb,b);}
  room.advance(t+=50);room.advance(t+=50);
  const own=last(fa,a),seen=last(fb,b);
  assert.ok(p.ack>5,'the room walked past the report');
  assert.equal(own.ack,5,'Ana sees the step she reported');
  assert.ok(Math.abs(seen.x-p.x)<=2*SPEED*STEP+.01,'Bia sees the live walk (her last frame is at most a tick old)');
  assert.ok(own.x<seen.x-.1,'Ana\'s confirmed position is behind the guess');
});
