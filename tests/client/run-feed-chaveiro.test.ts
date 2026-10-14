// D-047 (card chaveiro-render): the chaveiro objective reaches the client's run view. A city Room with the objective
// streams protocol 15 frames; the client's FrameRunFeed must hand RunView.objective (moto, car, route, stops) to the
// scene and the HUD on every view, also between keyframes. (It was decoded but dropped by the feed's view.)
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Room,OWNER_GAP_MS,type Peer} from '../../multiplayer/room.ts';
import {ROOM_PROTOCOL} from '../../src/protocol/room.ts';
import {clientCatalog} from '../../src/protocol/map-catalog.ts';
import type {MapRef} from '../../src/protocol/map-select.ts';
import {FrameRunFeed} from '../../src/client/net/run-feed.ts';
import {objectiveOf} from '../../src/client/render/chaveiro/view.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/maps/cidade-nevada.manifest.json',import.meta.url),'utf8'));
const cityText=readFileSync(new URL('../../public/maps/cidade-nevada.json',import.meta.url),'utf8');
const CITY:MapRef={id:'cidade-nevada',version:manifest.version,hash:manifest.hash};

test('the feed hands the chaveiro objective to every view: moto, car, and the route and stops between keyframes',async()=>{
  let n=0;
  const room=new Room(1000,77,{cityText,cityRef:CITY,cityPlayable:true,map:'cidade-nevada',objective:'chaveiro',newId:()=>`pessoa-${++n}`});
  await room.ready();
  const frames:Uint8Array[]=[],messages:any[]=[];
  const p:Peer={send:(s:string|Uint8Array)=>{if(typeof s==='string')messages.push(JSON.parse(s));else frames.push(s);},close:()=>{}} as Peer;
  let t=1000;
  const say=(m:object)=>room.receive(p,JSON.stringify(m),t);
  room.connect(p,t);say({t:'join',protocol:ROOM_PROTOCOL,name:'Ana',classId:'cidadao-comum',maps:clientCatalog(CITY)});
  t+=OWNER_GAP_MS;say({t:'ready',round:room.run.snapshot().round,ready:true});
  for(;room.run.snapshot().phase!=='combat';t+=50)room.advance(t);
  const feed=new FrameRunFeed();
  let read=0,seen=0,withRoute=0;
  for(let i=0;i<120;i++){
    room.advance(t+=50);
    let last=0;
    for(;read<frames.length;read++){const r=feed.decode(frames[read]);assert.ok(r.ok,r.ok?'':r.error);last=r.seq;}
    if(last)say({t:'ack',seq:last});
    const view=feed.take(),objective=objectiveOf(view);
    if(!view.tick)continue;
    assert.ok(objective,`tick ${view.tick}: the view carries the objective`);
    seen++;
    assert.ok(Number.isFinite(objective.moto.x)&&Number.isFinite(objective.car.y));
    if(objective.route&&objective.route.length>1&&objective.stops&&objective.stops.length>0)withRoute++;
  }
  assert.ok(seen>50,`${seen} views`);
  assert.equal(withRoute,seen,'route and stops on every view (the decoder keeps them between keyframes)');
});
