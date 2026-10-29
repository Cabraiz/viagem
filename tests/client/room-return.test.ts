// F5 volta pra sala (auditoria multijogador 29/10): the seat token per room in localStorage, the room in the address,
// and the one short retry of "Criar sala" (achado 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import {SEAT_KEY,readSeat,saveSeat,forgetSeat,pruneSeats,withRoom,markRoom,unmarkRoom} from '../../src/client/net/room-return.ts';
import {createRoom,CREATE_RETRY_MS} from '../../src/client/lobby.ts';

function fakeStore(){
  const map=new Map<string,string>();
  return {map,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);},
    get length(){return map.size;},key:(i:number)=>[...map.keys()][i]??null};
}
const NOW=1_800_000_000_000;

test('room-return: a saved seat is read back by any tab of the device until it expires',()=>{
  const local=fakeStore(),session=fakeStore();
  saveSeat('ABCDEF1234','tok',NOW+60_000,local);
  assert.equal(readSeat('ABCDEF1234',NOW,local,session),'tok');
  assert.equal(readSeat('ZZZZZZ9999',NOW,local,session),undefined,'another room: nothing');
  assert.equal(readSeat('ABCDEF1234',NOW+60_001,local,session),undefined,'expired');
  assert.equal(local.map.has(SEAT_KEY+'ABCDEF1234'),false,'and dropped');
});

test('room-return: a token from before the deploy (sessionStorage) still takes the seat, and moves to localStorage',()=>{
  const local=fakeStore(),session=fakeStore();
  session.setItem(SEAT_KEY+'ABCDEF1234',JSON.stringify({token:'old',until:NOW+5000}));
  assert.equal(readSeat('ABCDEF1234',NOW,local,session),'old');
  assert.equal(JSON.parse(local.map.get(SEAT_KEY+'ABCDEF1234')!).token,'old');
  forgetSeat('ABCDEF1234',local,session);
  assert.equal(local.map.size+session.map.size,0,'leaving forgets it in both');
});

test('room-return: expired seats of other rooms leave localStorage; other keys stay',()=>{
  const local=fakeStore();
  saveSeat('AAAAAAAAAA','a',NOW-1,local);saveSeat('BBBBBBBBBB','b',NOW+1000,local);
  local.setItem(SEAT_KEY+'CCCCCCCCCC','not json');local.setItem('viagem:apelido','Ana');
  pruneSeats(NOW,local);
  assert.deepEqual([...local.map.keys()].sort(),['viagem:apelido',SEAT_KEY+'BBBBBBBBBB']);
});

test('room-return: storage that throws (private window) costs only the reload, never the join',()=>{
  const broken={getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');},removeItem:()=>{throw new Error('denied');}};
  assert.doesNotThrow(()=>saveSeat('ABCDEF1234','t',NOW+1,broken));
  assert.equal(readSeat('ABCDEF1234',NOW,broken,broken),undefined);
  assert.doesNotThrow(()=>forgetSeat('ABCDEF1234',broken,broken));
  assert.equal(readSeat('ABCDEF1234',NOW,undefined,undefined),undefined);
});

test('room-return: the address gets ?sala=CODE (the old ?room= goes) and loses it; the rest of the query stays',()=>{
  assert.equal(withRoom('https://viagem.cyou/?ux=1','ABCDEF1234'),'https://viagem.cyou/?ux=1&sala=ABCDEF1234');
  assert.equal(withRoom('https://viagem.cyou/?room=X&ux=1','ABCDEF1234'),'https://viagem.cyou/?ux=1&sala=ABCDEF1234');
  assert.equal(withRoom('https://viagem.cyou/?sala=ABCDEF1234&ux=1',undefined),'https://viagem.cyou/?ux=1');
  assert.equal(withRoom('https://viagem.cyou/#x',undefined),'https://viagem.cyou/#x');
});

test('room-return: markRoom replaces the history entry only when the address changes; unmarkRoom only for its own room',()=>{
  const location={href:'https://viagem.cyou/',search:''};const urls:string[]=[];
  const history={state:{keep:1},replaceState:(data:unknown,_u:string,url?:string)=>{assert.deepEqual(data,{keep:1});urls.push(url!);location.href=url!;location.search=new URL(url!).search;}};
  const at={location,history};
  markRoom('ABCDEF1234',at);markRoom('ABCDEF1234',at);
  assert.deepEqual(urls,['https://viagem.cyou/?sala=ABCDEF1234']);
  unmarkRoom('ZZZZZZ9999',at);
  assert.equal(urls.length,1,'another room in the address (opened a new invite): left alone');
  unmarkRoom('ABCDEF1234',at);
  assert.equal(location.href,'https://viagem.cyou/');
  assert.doesNotThrow(()=>{markRoom('ABCDEF1234',undefined);unmarkRoom('ABCDEF1234',undefined);});
});

type Fetcher=typeof fetch;
const ok=(code:string)=>new Response(JSON.stringify({code}),{status:200});
function scripted(...steps:(Response|Error)[]){
  const calls:{url:string;method?:string}[]=[];
  const fetcher=(async(url:URL,init?:RequestInit)=>{calls.push({url:String(url),method:init?.method});const s=steps.shift()!;if(s instanceof Error)throw s;return s;}) as unknown as Fetcher;
  return {calls,fetcher};
}

test('createRoom: a timeout or a dropped network gets one short retry, with the notice on screen',async()=>{
  for(const failure of [new DOMException('timed out','TimeoutError'),new TypeError('Failed to fetch')]){
    const {calls,fetcher}=scripted(failure,ok('ABCDEF1234'));const waits:number[]=[];let notices=0;
    const code=await createRoom('https://salas.viagem.cyou',{},{fetcher,wait:async ms=>{waits.push(ms);},onRetry:()=>{notices++;}});
    assert.equal(code,'ABCDEF1234');assert.equal(calls.length,2);assert.equal(calls[0].url,'https://salas.viagem.cyou/rooms');assert.equal(calls[0].method,'POST');
    assert.deepEqual(waits,[CREATE_RETRY_MS]);assert.equal(notices,1);
  }
});

test('createRoom: a second failure gives up (no third try)',async()=>{
  const {calls,fetcher}=scripted(new TypeError('Failed to fetch'),new TypeError('Failed to fetch'),ok('NEVER'));
  await assert.rejects(createRoom('https://x',{},{fetcher,wait:async()=>{}}),/Failed to fetch/);
  assert.equal(calls.length,2);
});

test('createRoom: an answer from the server (4xx, 429, 5xx) is not retried: the error text is shown as it came',async()=>{
  for(const status of [400,429,503]){
    const {calls,fetcher}=scripted(new Response(JSON.stringify({error:`erro ${status}`}),{status}),ok('NEVER'));let notices=0;
    await assert.rejects(createRoom('https://x',{},{fetcher,wait:async()=>{},onRetry:()=>{notices++;}}),new RegExp(`erro ${status}`));
    assert.equal(calls.length,1);assert.equal(notices,0);
  }
  const {fetcher}=scripted(new Response('<html>',{status:502}));
  await assert.rejects(createRoom('https://x',{},{fetcher}),/Não foi possível criar a sala/);
});
