import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {treeCatalog} from '../src/game/tree-catalog.ts';

test('all 40 trees ship as transparent four-view atlases with varied heights',async()=>{
  assert.equal(treeCatalog.length,40);
  assert.equal(new Set(treeCatalog.map(t=>t.id)).size,40);
  assert.ok(Math.min(...treeCatalog.map(t=>t.height))<=100);
  assert.ok(Math.max(...treeCatalog.map(t=>t.height))>=210);
  for(const tree of treeCatalog){
    const meta=await sharp(`public/art/trees/${tree.id}.webp`).metadata();
    assert.equal(meta.width,512,tree.id);assert.equal(meta.height,768,tree.id);assert.ok(meta.hasAlpha,tree.id);
    assert.ok(tree.pixelHeight>0&&tree.height>0);
    assert.equal(tree.status,'perspective-4-5',tree.id);
    const hashes=[];
    for(let frame=0;frame<4;frame++){
      const data=await sharp(`public/art/trees/${tree.id}.webp`).extract({left:frame%2*256,top:Math.floor(frame/2)*384,width:256,height:384}).ensureAlpha().raw().toBuffer();
      let bottom=-1,visible=0,contact=0;
      for(let y=0;y<384;y++)for(let x=0;x<256;x++)if(data[(y*256+x)*4+3]>16){
        visible++;bottom=y;
        assert.ok(x>=7&&x<=248&&y>=7&&y<=376,`${tree.id}/${frame}: clipped art`);
        if(y===353&&Math.abs(x-128)<40)contact++;
      }
      assert.ok(visible>400&&visible<256*384*.85,`${tree.id}/${frame}: actual transparent cutout`);
      assert.ok(bottom>=363&&bottom<=367,`${tree.id}/${frame}: root alignment`);
      assert.ok(contact>0,`${tree.id}/${frame}: trunk must meet ground pivot`);
      hashes.push(createHash('sha256').update(data).digest('hex'));
    }
    assert.equal(new Set(hashes).size,4,`${tree.id}: four distinct views`);
  }
});
