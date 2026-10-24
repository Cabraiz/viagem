// BUG-20261022-ORQ-heroi-some-atras-predio: behind a dense block the see-through's faded layers stack and hide the
// hero, so in the city the scene also draws the hero's (and each ally's) 85% copy on top, as behind a canopy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {CityAsset,CityBlock} from '../../src/client/render/city/asset.ts';
import {FADE_ALPHA,coveringColumns,occluderFor,type ColumnRef} from '../../src/client/render/city/occlusion.ts';
import {VIEW_PIVOT,depth,unrotate} from '../../src/client/render/city/projection.ts';

const src=(p:string)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
const CELL=1.496;
const asset:CityAsset={version:1,name:'bloco',cell:CELL,width:40,height:40,origin:{x:0,y:0},heights:new Array(1600).fill(0),
  ground:'s'.repeat(1600),blocks:[],props:[],points:{}};
/** Three tall buildings one behind the other along the view's depth axis, like the apartment block of the bug. */
const row:CityBlock[]=[0,1,2].map(i=>({id:`p${i}`,kind:'building',x:20-3*i,y:20-3*i,w:2,h:2,height:7}));

test('a hero behind a dense block is covered by several faded pieces: stacked, they leave too little of the hero',()=>{
  for(const view of [0,1,2,3]){
    const cols:ColumnRef[]=row.map(b=>({key:depth(b.x*CELL,b.y*CELL,view),occ:occluderFor(b,asset,0,view),fade:b.id}));
    // Just behind the farthest building along the view's depth axis.
    const far=cols.reduce((a,c)=>c.occ.q.x0+c.occ.q.y0<a.occ.q.x0+a.occ.q.y0?c:a),q=far.occ.q;
    const w=unrotate((q.x0+q.x1)/2-.3-VIEW_PIVOT.x,q.y0-.3-VIEW_PIVOT.y,view),hero={x:w.x+VIEW_PIVOT.x,y:w.y+VIEW_PIVOT.y,z:0};
    const covered=coveringColumns(cols,hero,view,new Set(),VIEW_PIVOT,{w:58,h:96});
    assert.ok(covered.size>=1,`view ${view}: some piece covers the hero`);
  }
  // Each faded layer lets 1 - FADE_ALPHA through: three of them leave about a quarter of the hero.
  assert.ok((1-FADE_ALPHA)**3<.3);
});

test('CityLayer.covers: the see-through\'s own test (collectCovering) for one figure, false before the first view',()=>{
  const layer=src('src/client/render/city/city-layer.ts');
  const body=layer.slice(layer.indexOf('  covers(x:number,y:number'),layer.indexOf('  private collectCovering('));
  assert.ok(body.length>0,'covers() sits right before collectCovering');
  assert.match(body,/if\(this\.view<0\)return false;/);
  assert.match(body,/this\.collectCovering\(\{x,y,z\},this\.view,out\);/);
});

test('scene: in the city the hero and the allies get the copy on top whenever a city piece covers them',()=>{
  const scene=src('src/client/scene.ts');
  const place=scene.slice(scene.indexOf('  private place(){'),scene.indexOf('  private propCovers('));
  // mapa-175-com-viaduto: under a viaduct's deck (on the street) too.
  const cover=place.indexOf('if(this.city)covered=this.city.covers(this.position.x,this.position.y)||this.position.andar!==1&&!!this.viaduct?.under(this.position.x,this.position.y);');
  assert.ok(cover>0&&cover<place.indexOf('this.selfCovered=covered;'),'the hero: covered by the city before selfCovered');
  assert.match(place,/setDepth\(this\.city\?depth:/,'the sprite keeps its actor depth (the copy is what shows on top)');
  assert.match(scene,/covered=this\.city\?this\.city\.covers\(player\.x,player\.y\)\|\|player\.andar!==1&&!!this\.viaduct\?\.under\(player\.x,player\.y\):this\.treeCovers\(q,depth\)/,'each ally too');
  assert.match(scene,/covered&&!this\.city\?depth\+2:ALLY_DEPTH\+1/,'an ally\'s ficha stays over the buildings');
  assert.match(src('src/client/sandboxes/sandbox-cidade.ts'),/covered:this\.layer\?\.covers\(this\.at\.x,this\.at\.y\)\?\?false/,'the sandbox draws the same copy');
});
