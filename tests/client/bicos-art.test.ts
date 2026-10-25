// The bicos' pixel-art shops (card bancos-viram-bicos, etapa 2): one piece per shop in the group `bicos`
// (scripts/import-bicos.mjs), looked up in any group; the building stands behind the bank's rings, along the screen's
// down-left whatever the camera's turn; the lit door's quad around the anchor.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import type {ArtIndex} from '../../src/client/art/manifest.ts';
import {BICO_BACK,BICO_PX,SHOP_IDS,bicoArt,bicoSpots,doorQuad,frontNormal,shopOf} from '../../src/client/render/bancos/bico-art.ts';
import {BICO_IDS} from '../../src/contract/objective.ts';
import {Projector} from '../../src/client/render/projector.ts';

const piece=(porta:unknown=[72,164,24,36])=>({kind:'views',files:{sheet:{file:'bico-24-7.webp',cell:[232,211] as [number,number],views:1,anchor:[84/232,170/211] as [number,number]}},meta:{pixelArt:true,porta}});
const index=(p:Record<string,unknown>):ArtIndex=>({version:2,groups:{bicos:{output:'public/art/city/bicos',pieces:p as never}}});

test('bico art: the piece in any group → url, cell, anchor and door; no door or no piece → undefined (the kiosk stays)',()=>{
  const art=bicoArt(index({'bico-24-7':piece()}),'24-7');
  assert.deepEqual(art,{id:'24-7',key:'art:bicos:24-7',url:'/art/city/bicos/bico-24-7.webp',cell:[232,211],anchor:[84/232,170/211],porta:[72,164,24,36]});
  assert.equal(bicoArt(index({'bico-24-7':piece(null)}),'24-7'),undefined);
  assert.equal(bicoArt(index({'bico-24-7':piece([1,2,3])}),'24-7'),undefined);
  assert.equal(bicoArt(index({}),'24-7'),undefined);
});

test('bico art: every gig opens in one of the shops, each shop has a gig, and the shipped manifest has all six with a door',()=>{
  for(const id of BICO_IDS)assert.ok((SHOP_IDS as readonly string[]).includes(shopOf(id)),id);
  for(const shop of SHOP_IDS)assert.ok(BICO_IDS.some(id=>shopOf(id)===shop),`${shop}: some gig opens in it`);
  const shipped=JSON.parse(readFileSync('public/art/manifest.json','utf8')) as ArtIndex;
  for(const id of SHOP_IDS){
    const art=bicoArt(shipped,id);
    assert.ok(art,id);
    assert.ok(existsSync(`public${art.url}`),art.url);
    const [x,y,w,h]=art.porta;
    assert.ok(x>=0&&x+w<=art.cell[0]&&y-h>=0&&y+w/2<=art.cell[1],`${id}: door inside the sprite`);
  }
});

test('bico spots: the door stands BICO_BACK units up-right of the rings on the screen, in every camera turn',()=>{
  for(let view=0;view<4;view++){
    const p=new Projector(view),s=bicoSpots(20,30,view);
    const bank=p.project(20,30,{x:0,y:0}),door=p.project(s.door.x,s.door.y,{x:0,y:0}),mid=p.project(s.middle.x,s.middle.y,{x:0,y:0});
    // the front's normal is the rotated +y: (−42, +21) px per unit on the screen
    assert.ok(Math.abs(door.x-bank.x-42*BICO_BACK)<1e-6&&Math.abs(door.y-bank.y+21*BICO_BACK)<1e-6,`view ${view}`);
    assert.ok(p.depth(s.middle.x,s.middle.y)<p.depth(s.door.x,s.door.y)&&p.depth(s.door.x,s.door.y)<p.depth(20,30),`view ${view}: behind`);
    assert.ok(mid.x>door.x&&mid.y<door.y);
    assert.equal(Math.hypot(frontNormal(view,2).x,frontNormal(view,2).y),2);
  }
});

test('door quad: around the anchor at BICO_PX, along the front (1 down per 2 right)',()=>{
  const q=doorQuad({cell:[100,100],anchor:[.5,.5],porta:[40,60,20,30]},2);
  assert.deepEqual(q,[{x:-20,y:20},{x:20,y:40},{x:20,y:-20},{x:-20,y:-40}]);
  assert.equal(doorQuad({cell:[100,100],anchor:[0,0],porta:[0,10,4,4]})[1].x,4*BICO_PX);
});
