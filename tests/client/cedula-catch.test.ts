// BUG-20261025-ORQ-ima-dinheiro-demora: the local hero takes a cédula on the client the moment he enters the room's
// magnet (nearest standing hero), its R$ shown at once until the room's view settles it; never spent, never doubled.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CATCH_FLY_MS,CATCH_GIVE_UP_MS,CATCH_RADIUS,CedulaCatch,catchFlight} from '../../src/client/render/cedula-catch.ts';
import {CEDULA_PULL_RADIUS} from '../../src/sim/progression.ts';
import {playEvents} from '../../src/client/audio/events.ts';
import type {SimEvent} from '../../src/contract/index.ts';

const note=(id:string,value:number,x=0,y=0)=>({id,kind:'grana',value,x,y});

test('the client\'s catch is the room\'s magnet: same radius, so what flies on screen is what the room pulls',()=>{
  assert.equal(CATCH_RADIUS,CEDULA_PULL_RADIUS);
});

test('a note within the magnet is caught at once and its R$ count; outside, or with another hero nearer, it is not',()=>{
  const c=new CedulaCatch();
  assert.equal(c.near(0,'a',5,0,0,{x:CATCH_RADIUS+.01,y:0},[]),undefined,'just outside');
  assert.equal(c.near(0,'a',5,0,0,{x:1,y:0},[{x:.5,y:0}]),undefined,'a friend is nearer: the room gives it to them');
  assert.equal(c.near(0,'a',5,0,0,undefined,[]),undefined,'no standing hero (down, watching)');
  assert.equal(c.pending(),0);
  const got=c.near(100,'a',5,0,0,{x:1.5,y:0},[{x:3,y:0}]);
  assert.deepEqual(got,{id:'a',value:5,at:100,x:0,y:0});
  assert.equal(c.pending(),5);
  assert.equal(c.near(120,'a',5,0,0,{x:0,y:0},[]),undefined,'caught once');
  assert.equal(c.pending(),5,'never counted twice');
});

test('the room settles it: gone from its view, the R$ leave the pending count (they are in the wallet of that same view)',()=>{
  const c=new CedulaCatch();
  c.near(0,'a',5,0,0,{x:0,y:0},[]);c.near(0,'b',3,4,0,{x:4,y:0},[]);
  assert.equal(c.pending(),8);
  assert.deepEqual(c.push(100,[note('a',5),note('b',3,4)]),[],'still flying in the room');
  assert.equal(c.pending(),8);
  c.push(200,[note('b',3,4)]);
  assert.equal(c.pending(),3,'a: paid by the room');
  assert.equal(c.get('a'),undefined);
  c.push(250,[]);
  assert.equal(c.pending(),0);
  assert.equal(c.size,0);
});

test('a cédula that joined a caught note in the room counts with its new value',()=>{
  const c=new CedulaCatch();
  c.near(0,'a',5,0,0,{x:0,y:0},[]);
  c.push(50,[note('a',7)]);
  assert.equal(c.pending(),7);
});

test('a caught note the room never takes comes back after CATCH_GIVE_UP_MS, and its R$ leave the count',()=>{
  const c=new CedulaCatch();
  c.near(0,'a',5,0,0,{x:1.55,y:0},[]);
  assert.deepEqual(c.push(CATCH_GIVE_UP_MS-1,[note('a',5)]),[]);
  assert.deepEqual(c.push(CATCH_GIVE_UP_MS,[note('a',5)]),['a']);
  assert.equal(c.pending(),0);
  assert.equal(c.get('a'),undefined,'drawn on the ground again');
  assert.equal(c.near(CATCH_GIVE_UP_MS+10,'a',5,0,0,{x:0,y:0},[]),undefined,'not caught again at once (no catch-and-back loop)');
  assert.ok(c.near(2*CATCH_GIVE_UP_MS,'a',5,0,0,{x:0,y:0},[]),'later, catchable again');
});

test('the clink plays at the catch: the room\'s own pickup event of that note is heard once, and only for cédulas',()=>{
  const c=new CedulaCatch();
  c.near(0,'a',5,0,0,{x:0,y:0},[]);
  assert.equal(c.heardBefore({type:'pickup',player:'p1',pickup:'a',kind:'grana'}),true);
  assert.equal(c.heardBefore({type:'pickup',player:'p1',pickup:'a',kind:'grana'}),false,'once');
  assert.equal(c.heardBefore({type:'pickup',player:'p1',pickup:'b',kind:'grana'}),false,'a note not caught here keeps its clink');
  assert.equal(c.heardBefore({type:'pickup',player:'p1',pickup:'a',kind:'heal'}),false);
});

test('playEvents: the room\'s pickup of a cédula clinked at the catch plays nothing; the others still clink',()=>{
  const played:string[]=[],audio={play:(id:string)=>{played.push(id);return true;}};
  const c=new CedulaCatch();c.near(0,'a',5,0,0,{x:0,y:0},[]);
  const events=[{type:'pickup',player:'me',pickup:'a',kind:'grana',value:5},{type:'pickup',player:'me',pickup:'b',kind:'grana',value:2}] as unknown as SimEvent[];
  assert.equal(playEvents(audio,events,'me',e=>c.heardBefore(e)),1);
  assert.deepEqual(played,['gema']);
});

test('the flight: 0 at the catch, eases in, gone at CATCH_FLY_MS; reduced motion: gone at once',()=>{
  assert.equal(catchFlight(0),0);
  assert.ok(catchFlight(CATCH_FLY_MS/2)<.5,'leaves slowly');
  assert.equal(catchFlight(CATCH_FLY_MS),1);
  assert.equal(catchFlight(CATCH_FLY_MS*3),1);
  assert.equal(catchFlight(0,true),1);
  assert.ok(CATCH_FLY_MS<=200,'a short flight');
});

test('the hero still on a caught note: never given back (the room pays it the next view), so the R$ never blink',()=>{
  const c=new CedulaCatch();
  c.near(0,'a',5,0,0,{x:0,y:0},[]);
  assert.deepEqual(c.push(CATCH_GIVE_UP_MS*2,[note('a',5)],{x:.5,y:0}),[],'standing within its magnet');
  assert.equal(c.pending(),5);
  assert.deepEqual(c.push(CATCH_GIVE_UP_MS*2+50,[note('a',5)],{x:CATCH_RADIUS+.5,y:0}),['a'],'walked away: back to the ground');
  assert.equal(c.pending(),0);
});

test('reset forgets everything (a new run)',()=>{
  const c=new CedulaCatch();
  c.near(0,'a',5,0,0,{x:0,y:0},[]);
  c.reset();
  assert.equal(c.pending(),0);assert.equal(c.size,0);
  assert.equal(c.heardBefore({type:'pickup',pickup:'a',kind:'grana'}),false);
});
