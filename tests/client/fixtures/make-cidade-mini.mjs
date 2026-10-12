// Builds tests/client/fixtures/cidade-mini.json: a 32×32-cell stand-in for the Cidade Nevada asset
// (card cidade-03a) until the importer (cidade-01) ships. Deterministic; run with `node` from the repo root.
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const W=32,H=32,CELL=0.88;
const ground=Array.from({length:W*H},()=> 's');
const heights=Array.from({length:W*H},()=>0);
const set=(x,y,letter)=>{if(x>=0&&y>=0&&x<W&&y<H)ground[y*W+x]=letter;};
const rect=(x0,y0,x1,y1,letter)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)set(x,y,letter);};

// Avenues in a cross (packed snow) and the ring road inside the wall.
rect(14,1,18,31,'p');rect(1,14,31,18,'p');
rect(1,1,31,3,'p');rect(1,29,31,31,'p');rect(1,1,3,31,'p');rect(29,1,31,31,'p');
// Plaza (cobble) with the fountain (water) in the middle; a frozen puddle and rubble ground.
rect(12,12,20,20,'c');rect(15,15,17,17,'w');rect(22,22,25,24,'i');rect(5,22,9,25,'r');
// A small hill in the east quarter.
for(let y=4;y<10;y++)for(let x=21;x<27;x++)heights[y*W+x]=Math.max(0,0.6-0.12*Math.hypot(x-24,y-7));

const blocks=[
  // Perimeter wall (4 segments), gaps at the avenue mouths for the spawns.
  {id:'wall-n-w',kind:'wall',x:0,y:0,w:14,h:1,height:1.6},{id:'wall-n-e',kind:'wall',x:18,y:0,w:14,h:1,height:1.6},
  {id:'wall-s-w',kind:'wall',x:0,y:31,w:14,h:1,height:1.6},{id:'wall-s-e',kind:'wall',x:18,y:31,w:14,h:1,height:1.6},
  {id:'wall-w-n',kind:'wall',x:0,y:1,w:1,h:13,height:1.6},{id:'wall-w-s',kind:'wall',x:0,y:18,w:1,h:13,height:1.6},
  {id:'wall-e-n',kind:'wall',x:31,y:1,w:1,h:13,height:1.6},{id:'wall-e-s',kind:'wall',x:31,y:18,w:1,h:13,height:1.6},
  // Buildings in the four quarters (some ruined), plus a low rubble block.
  {id:'bld-nw-1',kind:'building',x:4,y:4,w:6,h:4,height:3.2},
  {id:'bld-nw-2',kind:'building',x:4,y:9,w:4,h:3,height:2.2,ruined:true},
  {id:'bld-ne-1',kind:'building',x:20,y:10,w:7,h:3,height:2.6},
  {id:'bld-sw-1',kind:'building',x:4,y:19,w:5,h:2,height:2.4},
  {id:'bld-se-1',kind:'building',x:20,y:19,w:4,h:6,height:3.6,ruined:true},
  {id:'bld-se-2',kind:'building',x:25,y:25,w:3,h:3,height:1.8},
  {id:'cliff-e',kind:'cliff',x:27,y:4,w:2,h:6,height:1.2},
  {id:'rubble-s',kind:'rubble',x:10,y:24,w:3,h:2,height:0.3},
];
const p=(id,kind,cx,cy,r)=>({id,kind,x:+(cx*CELL).toFixed(3),y:+(cy*CELL).toFixed(3),r});
const props=[
  p('car-1','car',16.5,8.5,0.55),p('lamp-1','lamp',12.5,12.5,0.12),p('lamp-2','lamp',19.5,19.5,0.12),
  p('pine-1','pine',11.5,5.5,0.35),p('pine-2','pine',26.5,27.5,0.35),p('crate-1','crate',6.5,26.5,0.25),
  p('barrel-1','barrel',9.5,27.5,0.18),p('debris-1','debris',13.2,22.4,0.3),p('bench-1','bench',13,16,0.3),
  p('rubble-1','rubble',7.5,23.5,0.4),
];
const pt=(cx,cy)=>({x:+(cx*CELL).toFixed(3),y:+(cy*CELL).toFixed(3)});
const asset={
  version:1,name:'cidade-mini (fixture)',cell:CELL,width:W,height:H,origin:{x:0,y:0},
  heights:heights.map(h=>+h.toFixed(3)),ground:ground.join(''),blocks,props,
  points:{spawnN:pt(16,0.5),spawnS:pt(16,31.5),spawnL:pt(31.5,16),spawnO:pt(0.5,16),praca:pt(16,16),inicio:pt(16,28),
    bocaN:pt(16,12),bocaS:pt(16,20),bocaL:pt(20,16),bocaO:pt(12,16)},
};
const out=fileURLToPath(new URL('./cidade-mini.json',import.meta.url));
writeFileSync(out,JSON.stringify(asset)+'\n');
console.log(`wrote ${out}`);
