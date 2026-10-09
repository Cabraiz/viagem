import test from 'node:test';
import assert from 'node:assert/strict';
import {NICK_MAX,suggestNickname,WAITING_LINES,WAITING_LINE_SECONDS,waitingLine,countdownJoke,shareLink,waitingRoomView} from '../src/game/lobby.ts';
import {RunLifecycle,RUN_HZ,RUN_COUNTDOWN_TICKS} from '../src/game/net/run.ts';
import type {RunMember,RunState} from '../src/game/net/run.ts';

const lcg=(seed:number)=>{let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/2**32;};};
const constant=(value:number)=>()=>value;
function assertNick(nick:string){
  assert.equal(typeof nick,'string');assert.ok(nick.length>0&&nick.length<=NICK_MAX,nick);
  const space=nick.indexOf(' ');assert.ok(space>0&&space<nick.length-1,`head + tail: ${nick}`);
  assert.doesNotMatch(nick,/undefined/);
}

test('suggestNickname: valid head + tail for seeded and edge random sources',()=>{
  for(const seed of [1,42,2026,0xdeadbeef]){const random=lcg(seed);for(let i=0;i<200;i++)assertNick(suggestNickname(random));}
  for(const value of [0,0.5,0.999999])assertNick(suggestNickname(constant(value)));
  for(let i=0;i<200;i++)assertNick(suggestNickname());
});
test('suggestNickname: never repeats avoid, even when the source is stuck on it',()=>{
  for(const value of [0,0.3,0.999999]){
    const usual=suggestNickname(constant(value));
    const other=suggestNickname(constant(value),usual);
    assertNick(other);assert.notEqual(other,usual);
  }
  const random=lcg(7);let previous='';
  for(let i=0;i<500;i++){const nick=suggestNickname(random,previous);assertNick(nick);assert.notEqual(nick,previous);previous=nick;}
  for(let i=0;i<100;i++){const nick=suggestNickname(Math.random,previous);assert.notEqual(nick,previous);previous=nick;}
});
test('suggestNickname: many distinct results and every combination fits NICK_MAX',()=>{
  const seen=new Set<string>();const random=lcg(123);
  for(let i=0;i<500;i++)seen.add(suggestNickname(random));
  assert.ok(seen.size>=100,`only ${seen.size} distinct nicknames`);
  // Sweep head/tail indexes exhaustively: every pair must fit (no silent fallback).
  const all=new Set<string>();
  for(let h=0;h<64;h++)for(let t=0;t<64;t++){
    const draws=[h/64,t/64];let k=0;all.add(suggestNickname(()=>draws[k++%2]));
  }
  for(const nick of all)assertNick(nick);
  const heads=new Set([...all].map(n=>n.slice(0,n.indexOf(' ')))),tails=new Set([...all].map(n=>n.slice(n.indexOf(' ')+1)));
  assert.equal(all.size,heads.size*tails.size);assert.ok(heads.size>=10&&tails.size>=10);
});

test('WAITING_LINES: at least six distinct pt-BR lines',()=>{
  assert.ok(WAITING_LINES.length>=6);assert.equal(new Set(WAITING_LINES).size,WAITING_LINES.length);
  for(const line of WAITING_LINES)assert.ok(typeof line==='string'&&line.trim().length>0);
  assert.ok(WAITING_LINES.some(l=>/[ãçéêíóõúâ…]/i.test(l)),'expected pt-BR text');
  assert.ok(Object.isFrozen(WAITING_LINES));
});
test('waitingLine: rotates every WAITING_LINE_SECONDS and wraps around',()=>{
  const n=WAITING_LINES.length,step=WAITING_LINE_SECONDS;
  assert.ok(step>0);
  assert.equal(waitingLine(0),WAITING_LINES[0]);
  assert.equal(waitingLine(step-0.001),WAITING_LINES[0]);
  for(let i=0;i<n;i++)assert.equal(waitingLine(i*step),WAITING_LINES[i]);
  assert.equal(waitingLine(n*step),WAITING_LINES[0]);assert.equal(waitingLine((n+2)*step+0.5),WAITING_LINES[2]);
  for(const s of [-1,-1e9,-0])assert.equal(waitingLine(s),WAITING_LINES[0]);
  for(const s of [1e9,1e15,Number.MAX_SAFE_INTEGER])assert.ok(WAITING_LINES.includes(waitingLine(s)),String(s));
});

test('countdownJoke: distinct jokes for 3 (and above), 2, 1 and 0',()=>{
  const jokes=[3,2,1,0].map(countdownJoke);
  for(const joke of jokes)assert.ok(joke.length>0);
  assert.equal(new Set(jokes).size,4);
  assert.equal(countdownJoke(4),countdownJoke(3));assert.equal(countdownJoke(99),countdownJoke(3));
});

test('shareLink: invite format, trimmed origin, encoded code round-trips',()=>{
  assert.equal(shareLink('https://viagem.example','ABCDEF0123'),'https://viagem.example/?room=ABCDEF0123#personagem');
  assert.equal(shareLink('https://viagem.example///','ABCDEF0123'),'https://viagem.example/?room=ABCDEF0123#personagem');
  assert.equal(shareLink('http://127.0.0.1:5173/','A B&C'),'http://127.0.0.1:5173/?room=A%20B%26C#personagem');
  for(const code of ['ABCDEF0123','A B&C=#?','çé/%']){
    const url=new URL(shareLink('https://viagem.example/',code));
    assert.equal(url.searchParams.get('room'),code);assert.equal(url.hash,'#personagem');assert.equal(url.pathname,'/');
  }
});

const member=(id:string,ready=false,online=true,spectator=false):RunMember=>({id,ready,online,spectator});
const state=(phase:RunState['phase'],members:RunMember[],remaining=0):RunState=>({round:1,phase,elapsed:0,remaining,members});
const names=new Map([['me',{name:'Eu'}],['b',{name:'Bia'}],['c',{name:'Caio'}],['a',{name:'Ana'}],['blank',{name:''}]]);

test('waitingRoomView: hidden without run or outside lobby/countdown',()=>{
  for(const run of [undefined,state('combat',[member('me',true)]),state('result',[member('me')])]){
    const view=waitingRoomView(run,names,'me');
    assert.equal(view.visible,false);assert.equal(view.phase,'hidden');assert.equal(view.headline,'');assert.equal(view.seconds,undefined);
  }
});
test('waitingRoomView: lobby members, ordering, fallbacks and counts',()=>{
  const alone=waitingRoomView(state('lobby',[member('me')]),names,'me');
  assert.equal(alone.visible,true);assert.equal(alone.phase,'lobby');assert.match(alone.headline,/^Só você aqui/);
  assert.equal(alone.total,1);assert.equal(alone.readyCount,0);assert.equal(alone.selfReady,false);
  const run=state('lobby',[member('c',true),member('ghost',true,false),member('spec',true,true,true),member('me',true),member('a'),member('blank',true)]);
  const view=waitingRoomView(run,names,'me');
  assert.deepEqual(view.members.map(m=>m.id),['me','blank','ghost','a','c']);
  assert.deepEqual(view.members.map(m=>m.name),['Eu','Alguém','Alguém','Ana','Caio']);
  assert.ok(!view.members.some(m=>m.id==='spec'));assert.equal(view.total,5);
  assert.equal(view.readyCount,3,'ready and online only: me, blank, c');
  assert.deepEqual(view.members.map(m=>m.self),[true,false,false,false,false]);
  assert.equal(view.selfReady,true);assert.equal(view.seconds,undefined);
  // Spectators alone do not make a crowd.
  assert.match(waitingRoomView(state('lobby',[member('me'),member('spec',false,true,true)]),names,'me').headline,/^Só você aqui/);
  // Self missing from the run (e.g. still joining) → nobody is self.
  const outsider=waitingRoomView(state('lobby',[member('a',true),member('b')]),names,'me');
  assert.equal(outsider.selfReady,false);assert.ok(outsider.members.every(m=>!m.self));
});
test('waitingRoomView: headline variants',()=>{
  const all=waitingRoomView(state('lobby',[member('me',true),member('b',true)]),names,'me');
  assert.equal(all.headline,'Todo mundo pronto. Milagre!');assert.equal(all.readyCount,2);
  const selfMissing=waitingRoomView(state('lobby',[member('me'),member('b',true)]),names,'me');
  assert.match(selfMissing.headline,/você/);assert.doesNotMatch(selfMissing.headline,/Bia/);assert.equal(selfMissing.selfReady,false);
  const otherMissing=waitingRoomView(state('lobby',[member('me',true),member('b')]),names,'me');
  assert.match(otherMissing.headline,/Bia/);assert.notEqual(otherMissing.headline,selfMissing.headline);
  const offline=waitingRoomView(state('lobby',[member('me',true),member('c',true,false)]),names,'me');
  assert.match(offline.headline,/Caio/,'ready but offline still counts as missing');assert.equal(offline.readyCount,1);
  const several=waitingRoomView(state('lobby',[member('me'),member('b'),member('c',true)]),names,'me');
  assert.match(several.headline,/2/);
  for(const v of [all,selfMissing,otherMissing,several])assert.equal(v.visible,true);
  assert.equal(new Set([all,selfMissing,otherMissing,several].map(v=>v.headline)).size,4);
});
test('waitingRoomView: countdown seconds follow server ticks',()=>{
  const run=new RunLifecycle('room');run.join('me');run.join('b');run.ready('me',1,true);run.ready('b',1,true);
  const at=()=>waitingRoomView(run.snapshot(),names,'me',RUN_HZ);
  let view=at();
  assert.equal(view.phase,'countdown');assert.equal(view.visible,true);assert.equal(view.seconds,3);
  assert.equal(view.seconds,Math.ceil(RUN_COUNTDOWN_TICKS/RUN_HZ));assert.equal(view.headline,countdownJoke(3));
  assert.equal(view.selfReady,true);assert.equal(view.readyCount,2);
  const seen:number[]=[];
  for(let remaining=RUN_COUNTDOWN_TICKS;remaining>1;remaining--){
    view=at();assert.equal(view.seconds,Math.ceil(remaining/RUN_HZ));assert.equal(view.headline,countdownJoke(view.seconds!));
    if(seen.at(-1)!==view.seconds)seen.push(view.seconds!);run.step();
  }
  view=at();assert.equal(view.seconds,1);assert.equal(view.headline,countdownJoke(1));
  assert.deepEqual(seen,[3,2,1]);
  run.step();assert.equal(at().visible,false,'combat hides the waiting room');
  const zero=waitingRoomView(state('countdown',[member('me',true)],0),names,'me');
  assert.equal(zero.seconds,0);assert.equal(zero.headline,countdownJoke(0));
  assert.equal(waitingRoomView(state('countdown',[member('me',true)],RUN_COUNTDOWN_TICKS),names,'me').seconds,3,'default hz matches RUN_HZ');
});

test('waitingRoomView: a spectator watches, cannot ready, and non-finite elapsed time still gives a line',()=>{
  const run:RunState={round:1,phase:'lobby',elapsed:0,remaining:0,members:[
    {id:'a',online:true,ready:true,spectator:false},{id:'me',online:true,ready:false,spectator:true}]};
  const view=waitingRoomView(run,new Map([['a',{name:'Bia'}],['me',{name:'Eu'}]]),'me');
  assert.equal(view.visible,true);assert.equal(view.selfSpectator,true);assert.equal(view.selfReady,false);
  assert.equal(view.total,1);assert.match(view.headline,/assiste/);
  const countdown=waitingRoomView({...run,phase:'countdown',remaining:RUN_COUNTDOWN_TICKS},new Map(),'me');
  assert.equal(countdown.selfSpectator,true);assert.equal(countdown.seconds,3);
  assert.equal(waitingRoomView({...run,members:[{id:'me',online:true,ready:false,spectator:false}]},new Map(),'me').selfSpectator,false);
  for(const v of [NaN,Infinity,-Infinity])assert.ok(WAITING_LINES.includes(waitingLine(v)));
});
