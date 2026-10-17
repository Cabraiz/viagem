// Bancos (card bancos-e-veiculos): the city's ATMs reach the client's run view. A city Room streams the banks block in
// both modes (the chaveiro and the wall); FrameRunFeed must hand RunView.banks to the scene and the HUD on every view,
// with their id, place and name also between keyframes (the decoder keeps the static part), and EnemyView.prime too.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {FrameEncoder} from '../../src/protocol/protocol4.ts';
import {BANK_IDS} from '../../src/contract/objective.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};

for(const objective of ['chaveiro',false] as const){
  test(`the feed hands the banks to every view (${objective||'muralha'}): id, place and name between keyframes, saldo and state`,async()=>{
    let n=0;
    const room=new Room(1000,77,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',objective,newId:()=>`pessoa-${++n}`});
    await room.ready();
    const frames:Uint8Array[]=[];
    const p:Peer={send:(s:string|Uint8Array)=>{if(typeof s!=='string')frames.push(s);},close:()=>{}} as Peer;
    let t=1000;
    const say=(m:object)=>room.receive(p,JSON.stringify(m),t);
    room.connect(p,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)});
    t+=OWNER_GAP_MS;say({t:'ready',round:room.run.snapshot().round,ready:true});
    for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
    const want=room.sim.run.banks!.places;
    assert.equal(want.length,3,'three banks in the city');
    const feed=new FrameRunFeed();
    let read=0,seen=0;
    for(let i=0;i<120;i++){
      room.advance(t+=50);
      let last=0;
      for(;read<frames.length;read++){const r=feed.decode(frames[read]);assert.ok(r.ok,r.ok?'':r.error);last=r.seq;}
      if(last)say({t:'ack',seq:last});
      const view=feed.take();
      if(!view.tick)continue;
      seen++;
      assert.equal(view.banks?.length,3,`tick ${view.tick}: the view carries the banks`);
      view.banks!.forEach((b,k)=>{
        assert.equal(b.id,want[k].id);assert.equal(b.name,BANK_IDS[k]);
        assert.ok(Math.abs(b.x-want[k].x)<=1/32&&Math.abs(b.y-want[k].y)<=1/32,`${b.id}: its place`);
        assert.ok(b.saldo>=0&&['aberto','sacando','bicho','sem-cedulas'].includes(b.state));
      });
    }
    assert.ok(seen>50,`${seen} views`);
  });
}

test('EnemyView.prime reaches the run view (and goes away with the critter)',()=>{
  const feed=new FrameRunFeed(),enc=new FrameEncoder();
  const view={tick:100,team:{xp:0,level:1,nextXp:1},players:[],pickups:[],projectiles:[],telegraphs:[],structures:[],nodes:[],
    enemies:[{id:'e-1',kind:'bebado',x:3,y:4,hp:30,maxHp:30,prime:true as const},{id:'e-2',kind:'bebado',x:5,y:4,hp:20,maxHp:20}]};
  const r=feed.decode(enc.encode(view));assert.ok(r.ok,r.ok?'':r.error);
  const got=feed.take().enemies;
  assert.deepEqual(got.map(e=>[enc.ids.resolve(e.id),e.prime??false,e.maxHp]),[['e-1',true,30],['e-2',false,20]]);
});
