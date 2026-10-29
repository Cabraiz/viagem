/**
 * NEW-20261029-ORQ-cidade-decor-alto-e-grafite (colocação): a graffito on a wall's face (render/city/grafite-parede.ts)
 * is seen only from its side, never mirrored, stands on the wall at about 55 % of its height and darkens in the shade.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {GRAFITE_MID,GRAFITE_SHADE,grafiteQuad} from '../../src/client/render/city/grafite-parede.ts';
import {decorRule} from '../../src/client/render/city/art-plan.ts';
import {HEIGHT_PX,project} from '../../src/client/render/city/projection.ts';

const O={x:0,y:0},CELL=1.5,WALL=2;
const quad=(rot:number,view:number)=>grafiteQuad({c:10,r:10,w:1,h:1,rot},view,CELL,O,0,WALL,106/184,O);

test('a face is drawn in exactly the two views that look at it',()=>{
  for(const rot of [0,90,180,270])assert.equal([0,1,2,3].filter(v=>quad(rot,v)).length,2,`rot ${rot}`);
  // The two faces of one wall: never both in one view.
  for(const v of [0,1,2,3]){assert.notEqual(!!quad(0,v),!!quad(180,v));assert.notEqual(!!quad(90,v),!!quad(270,v));}
});

test('never mirrored: the image reads left to right, its top above its bottom',()=>{
  for(const rot of [0,90,180,270])for(const v of [0,1,2,3]){
    const q=quad(rot,v);if(!q)continue;
    const [tl,tr,br,bl]=q.corners;
    assert.ok(tr.x>tl.x&&br.x>bl.x,`rot ${rot} view ${v}`);
    assert.ok(bl.y>tl.y&&br.y>tr.y);
    // The projection shears it along the wall (2:1), never past tan 0.5.
    assert.ok(Math.abs((tr.y-tl.y)/(tr.x-tl.x))<=.5+1e-9);
  }
});

test('on the wall: centred near 55 % of its height, inside it, 0.6–0.9 of a cell long',()=>{
  const q=quad(0,0)!,[tl,tr,br,bl]=q.corners;
  const midY=(tl.y+tr.y+br.y+bl.y)/4,ground=project(10.5*CELL,10.64*CELL,0,0,O).y;
  assert.ok(Math.abs((ground-midY)/HEIGHT_PX-WALL*GRAFITE_MID)<1e-6);
  assert.ok((bl.y-tl.y)/HEIGHT_PX<=WALL*.8+1e-9);
  const len=Math.hypot(tr.x-tl.x,tr.y-tl.y)/Math.hypot(42,21);
  assert.ok(len>=CELL*.6-1e-9&&len<=CELL*.9+1e-9,`${len}`);
});

test('the face turned from the sun is 10–25 % darker, the lit one keeps its colour',()=>{
  const lights=[0,90,180,270].flatMap(rot=>[0,1,2,3].map(v=>quad(rot,v)?.light).filter((l):l is number=>l!==undefined));
  assert.ok(lights.some(l=>l===1));
  for(const l of lights)assert.ok(l===1||(l>=1-GRAFITE_SHADE[1]-1e-9&&l<=1-GRAFITE_SHADE[0]+1e-9),`${l}`);
  assert.ok(lights.some(l=>l<1));
});

test('a graffito is a face, the tall pieces stand as props',()=>{
  assert.equal(decorRule('grafite-oxe'),'face');
  assert.equal(decorRule('caixa-dagua-torre-1',{footprint:[1,1]}),'prop');
  assert.equal(decorRule('muro-pichado-reto-intacto'),'wall');
});
