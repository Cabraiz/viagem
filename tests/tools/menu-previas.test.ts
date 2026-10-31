// menu-imagens-sem-buraco: the menu's previews are fresh, tiny, and cover what the popup and the profile show.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gerar,HEROIS,urls} from '../../scripts/menu-previas.mjs';
import {ESCOLHA_HEROIS} from '../../src/client/ui/escolha-popup.ts';
import {PREVIAS} from '../../src/client/ui/menu-previas.ts';
import {chosenArtUrl,popupArtUrls,POPUP_FIXOS} from '../../src/client/preload/menu-art-preload.ts';

test('menu-previas.ts is what the script makes from public/ today (run node scripts/menu-previas.mjs)',async()=>{
  assert.equal(readFileSync('src/client/ui/menu-previas.ts','utf8'),await gerar());
});

test('every escolha hero has a preview of each popup art and of his picture on a plain screen; each is tiny',()=>{
  assert.deepEqual([...HEROIS].sort(),[...ESCOLHA_HEROIS].sort());
  for(const id of ESCOLHA_HEROIS)for(const deitado of [false,true])
    for(const url of popupArtUrls(id,deitado,1).filter(u=>!POPUP_FIXOS.includes(u)))assert.ok(PREVIAS[url],`${url}: no preview`);
  assert.deepEqual(Object.keys(PREVIAS),urls());
  for(const [url,data] of Object.entries(PREVIAS)){
    assert.match(data,/^data:image\/webp;base64,/);
    assert.ok(data.length<1200,`${url}: ${data.length} chars, a preview must stay tiny`);
  }
  assert.ok(!PREVIAS[chosenArtUrl('maromba',2)],'the 768 picture has none (it is only for a sharp screen)');
});

test('the previews never ride in the menu first chunk: they come only through a dynamic import (ui/menu-art-boot.ts)',()=>{
  for(const f of ['src/main.ts','src/client/ui/menu-art-boot.ts','src/client/preload/menu-art-preload.ts'])
    assert.doesNotMatch(readFileSync(f,'utf8'),/^import[^\n]*menu-previas/m,f);
  assert.match(readFileSync('src/client/ui/menu-art-boot.ts','utf8'),/import\('\.\/menu-previas\.ts'\)/);
  assert.match(readFileSync('src/main.ts','utf8'),/menuArtNoNavegador\(/);
});
