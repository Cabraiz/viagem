// icones-no-hud on the action HUD (D-051 step 2): the attack button, the dead-moto row and the moto's arrow wear their
// art-v2 stickers (ui/atacar, ui/empurrar, ui/chaveiro) once the art is in, and today's icon without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setArtIndex,type ArtIndex} from '../../src/client/art/manifest.ts';
import {stickerOrIcon} from '../../src/client/ui/sticker.ts';

const index=JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8')) as ArtIndex;

test('stickerOrIcon: the imported sticker with the art, the system icon without it (never the "mistério" box)',()=>{
  setArtIndex(index);
  try{
    for(const [name,file] of [['atacar','atacar'],['empurrar','empurrar'],['chaveiro','chaveiro']] as const){
      const html=stickerOrIcon(name,'moto',{size:40,className:'skillbtn-icon'});
      assert.match(html,new RegExp(`<img class="ic ic-adesivo ic-40 skillbtn-icon" src="[^"]*/${file}\\.webp"`),name);
    }
  }finally{setArtIndex({version:2,groups:{}});}
  const bare=stickerOrIcon('atacar','chinelo',{size:40,className:'skillbtn-icon'});
  assert.match(bare,/href="#i-chinelo"|data-icon="chinelo"|chinelo/);
  assert.doesNotMatch(bare,/misterio/);
});
