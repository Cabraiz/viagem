import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {treeCatalog} from '../../src/maps/tree-catalog.ts';

// Light under memory pressure (many test processes at once): no libvips operation cache, one libvips thread.
sharp.cache(false);sharp.concurrency(1);

test('all 40 trees ship as transparent four-view atlases with varied heights',async()=>{
  assert.equal(treeCatalog.length,40);
  assert.equal(new Set(treeCatalog.map(t=>t.id)).size,40);
  assert.ok(Math.min(...treeCatalog.map(t=>t.height))<=100);
  assert.ok(Math.max(...treeCatalog.map(t=>t.height))>=210);
  for(const tree of treeCatalog){
    const image=sharp(`public/art/trees/${tree.id}.webp`);
    const meta=await image.metadata();
    assert.equal(meta.width,512,tree.id);assert.equal(meta.height,768,tree.id);assert.ok(meta.hasAlpha,tree.id);
    assert.ok(tree.pixelHeight>0&&tree.height>0);
    assert.equal(tree.status,'perspective-4-5',tree.id);
    // The atlas is decoded once and each 256×384 view is read in place: the same bytes extract() of that view gives,
    // hashed row by row (the same SHA-256 as hashing the extracted view in one piece).
    const atlas=await image.ensureAlpha().raw().toBuffer();
    const hashes=[];
    for(let frame=0;frame<4;frame++){
      const left=frame%2*256,top=Math.floor(frame/2)*384,at=(x:number,y:number)=>((top+y)*512+left+x)*4,hash=createHash('sha256');
      let bottom=-1,visible=0,contact=0;
      for(let y=0;y<384;y++){
        hash.update(atlas.subarray(at(0,y),at(256,y)));
        for(let x=0;x<256;x++)if(atlas[at(x,y)+3]>16){
          visible++;bottom=y;
          assert.ok(x>=7&&x<=248&&y>=7&&y<=376,`${tree.id}/${frame}: clipped art`);
          if(y===353&&Math.abs(x-128)<40)contact++;
        }
      }
      assert.ok(visible>400&&visible<256*384*.85,`${tree.id}/${frame}: actual transparent cutout`);
      assert.ok(bottom>=363&&bottom<=367,`${tree.id}/${frame}: root alignment`);
      assert.ok(contact>0,`${tree.id}/${frame}: trunk must meet ground pivot`);
      hashes.push(hash.digest('hex'));
    }
    assert.equal(new Set(hashes).size,4,`${tree.id}: four distinct views`);
  }
});
