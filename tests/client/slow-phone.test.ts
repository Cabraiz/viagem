/**
 * N27 · celular lento: the room keeps a phone that is only slow (late, sparse messages), the page measures how far
 * behind it runs and stops drawing to catch up, and frames are chained so a late ack never makes them bigger.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Room,type Peer,SILENT_MS,SLOW_SILENT_MAX_MS,silenceLimit} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {Backlog,CatchUp,ANCHOR_WINDOW_MS,CATCH_UP_ON_MS,CATCH_UP_OFF_MS,CATCH_UP_HOLD_MS} from '../../src/client/net/backlog.ts';

/** A room with one person on a fake peer (frames counted, closes recorded). */
function seated(t0:number){
  const room=new Room(t0,7);const closed:{code:number}[]=[];
  const peer:Peer={send:()=>{},close:code=>{closed.push({code});}};
  room.connect(peer,t0);room.receive(peer,JSON.stringify({t:'join',protocol:ROOM_PROTOCOL,name:'Tia lenta',classId:'cidadao-comum'}),t0);
  return {room,peer,closed,c:room.connections.get(peer)!};
}

test('silence limit: 12 s unless the acks keep naming old frames (two in a row 2 s late), then 12 s + the lag, never past the cap',()=>{
  assert.equal(silenceLimit({lag:0,lateAcks:0}),SILENT_MS);
  assert.equal(silenceLimit({lag:11_000,lateAcks:1}),SILENT_MS,'one late ack (an antenna change) extends nothing');
  assert.equal(silenceLimit({lag:10_000,lateAcks:2}),22_000);
  assert.equal(silenceLimit({lag:120_000,lateAcks:9}),SLOW_SILENT_MAX_MS);
});

test('room: a phone silent from the start is cut at 12 s; one that slows down bit by bit (gaps up to 15 s) is not',()=>{
  const t0=1_000_000;
  const quiet=seated(t0);
  quiet.room.advance(t0+SILENT_MS-50);assert.equal(quiet.closed.length,0);
  quiet.room.advance(t0+SILENT_MS+50);assert.equal(quiet.closed[0]?.code,4004);

  const slow=seated(t0);
  const sent:{seq:number;at:number}[]=[];
  // The phone's answers: [every ms, naming the frame it decoded this long ago], 30 s each. CPU 6× in the lab:
  // timers starve, the queue grows, messages come later and farther apart.
  const phases=[[1000,100],[10_000,8000],[15_000,12_000]];
  let t=t0,next=t0;
  for(const [every,late] of phases){
    const end=t+30_000;
    while(t<end){
      t+=50;slow.room.advance(t);sent.push({seq:slow.c.encoder!.lastSeq,at:t});
      if(t>=next){const old=sent.find(s=>s.at>=t-late)!;slow.room.receive(slow.peer,JSON.stringify({t:'ack',seq:old.seq}),t);next=t+every;}
    }
  }
  assert.equal(slow.closed.length,0,'gaps of 15 s with frames decoded 12 s late: slow, still there');
  assert.ok(slow.c.lag>=11_900&&slow.c.lag<=12_100,`lag ${slow.c.lag}`);
  assert.ok(slow.c.lateAcks>=2,`late acks ${slow.c.lateAcks}`);
  // Gone for good now: cut within the cap.
  slow.room.advance(t+SLOW_SILENT_MAX_MS+100);assert.equal(slow.closed[0]?.code,4004);
});

test('room: two antenna changes of 11 s, then the phone dies for real: cut within 15 s of its last message',()=>{
  const t0=2_000_000,{room,peer,closed,c}=seated(t0);
  const sent:{seq:number;at:number}[]=[];
  let t=t0,lastMsg=t0;
  const tick=()=>{t+=50;room.advance(t);sent.push({seq:c.encoder!.lastSeq,at:t});};
  const ack=(late=0)=>{const f=sent.find(s=>s.at>=t-late-25)!;room.receive(peer,JSON.stringify({t:'ack',seq:f.seq}),t);lastMsg=t;};
  const normal=(ms:number)=>{const end=t+ms;while(t<end){tick();if((t-t0)%1000===0)ack();}};
  normal(10_000);
  for(let swap=0;swap<2;swap++){
    // 11 s with no network: nothing reaches the room; then the keepalive names the frame decoded before the swap.
    const end=t+11_000;while(t<end)tick();
    assert.equal(closed.length,0,'11 s is under the 12 s limit');
    ack(11_000);assert.ok(c.lag>=10_900,`late ack ${c.lag}`);
    normal(8000);
    assert.equal(silenceLimit(c),SILENT_MS,'fresh acks again: back to 12 s');
  }
  // Dead for real.
  while(!closed.length&&t<lastMsg+60_000)tick();
  assert.equal(closed[0]?.code,4004);
  assert.ok(t-lastMsg<=15_000,`cut ${t-lastMsg} ms after its last message`);
});

test('backlog: steady frames read 0; a growing queue shows; a step of the room clock is forgotten; settle and reset',()=>{
  const b=new Backlog();
  let now=0,tick=0;
  for(let i=0;i<100;i++){now+=100;tick+=2;b.frame(tick,now+Math.random()*30);}
  assert.ok(b.ms<40,`steady: ${b.ms}`);
  // The page handles 5 of the 10 frames a second: each one later than the last.
  for(let i=0;i<60;i++){now+=200;tick+=2;b.frame(tick,now);}
  assert.ok(b.ms>5000,`a queue 6 s deep: ${b.ms}`);
  b.settle(now);assert.equal(b.ms,0);
  // The room dropped 1.5 s of ticks for good: read as backlog at first, gone once the window passed it.
  const c=new Backlog();now=0;tick=0;
  for(let i=0;i<50;i++){now+=100;tick+=2;c.frame(tick,now);}
  now+=1500;
  for(let i=0;i<20;i++){now+=100;tick+=2;c.frame(tick,now);}
  assert.ok(c.ms>1400&&c.ms<1600,`step: ${c.ms}`);
  for(let i=0;i<ANCHOR_WINDOW_MS/100+10;i++){now+=100;tick+=2;c.frame(tick,now);}
  assert.ok(c.ms<1,`forgotten: ${c.ms}`);
  // A new run: the tick goes back.
  c.frame(5,now+100);assert.equal(c.ms,0);
});

test('catch-up: a 4G hiccup on a healthy phone never stops the drawing; a backlog that stays does, with hysteresis',()=>{
  const u=new CatchUp();
  // Healthy phone, 60 Hz draws: one draw sees the burst of late frames (5 s), the next ones see it handled.
  let now=0;
  for(let i=0;i<10;i++){now+=16;u.update(0,now);}
  now+=16;assert.equal(u.update(5000,now),false);
  for(let i=0;i<100;i++){now+=16;assert.equal(u.update(40,now),false);}
  // Slow phone: draws 1.5 s apart, every one 4 s behind.
  for(let i=0;i<3;i++){now+=1500;u.update(CATCH_UP_ON_MS+1000,now);}
  assert.equal(u.on,true,`on after ${CATCH_UP_HOLD_MS} ms over the line`);
  assert.equal(u.update(CATCH_UP_OFF_MS+100,now+2500),true,'still above the lower line');
  assert.equal(u.update(CATCH_UP_OFF_MS-100,now+5000),false);
});
