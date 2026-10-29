// compartilhar-avisa-falha: the "Foto" button on the result says when sharing failed or the picture was saved instead,
// short on the button and whole to the screen reader; a share or a cancel the player saw stay quiet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {shareOutcome,SHARE_LABEL,SHARE_OUTCOME_MS} from '../../src/client/hud/result.ts';

test('share outcome: failed and downloaded speak, shared and cancelled stay quiet',()=>{
  assert.deepEqual(shareOutcome('failed'),{label:'Não deu',say:'Não deu pra compartilhar. Tente de novo.'});
  assert.deepEqual(shareOutcome('downloaded'),{label:'Salva',say:'Imagem salva'});
  assert.equal(shareOutcome('shared'),undefined);
  assert.equal(shareOutcome('cancelled'),undefined);
  for(const how of ['failed','downloaded'] as const)assert.ok(shareOutcome(how)!.label.length<=SHARE_LABEL.length+3,'fits where "Foto" fits');
  assert.ok(SHARE_OUTCOME_MS>=2000,'long enough to read');
});

test('share button: the result is read, a rejected promise counts as failed, a status line speaks it',()=>{
  const src=fs.readFileSync('src/client/hud/result.ts','utf8');
  assert.match(src,/shareResultImage\([^;]*\)\s*\.then\(shareSay,\(\)=>shareSay\('failed'\)\)\.finally/);
  assert.match(src,/shareSaid=el\('span','rh-sr'\);shareSaid\.setAttribute\('role','status'\)/);
});
