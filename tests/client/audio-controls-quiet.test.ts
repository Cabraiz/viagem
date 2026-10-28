/**
 * BUG-20261025-ORQ-celular-travando: the audio engine emits on every sound it plays; the sound controls (mounted in the
 * match's settings) write their rows only when the settings changed, not on every sound (it restyled the HUD each frame).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('the audio controls skip a render whose settings did not change',()=>{
  const src=readFileSync(new URL('../../src/client/audio/controls.ts',import.meta.url),'utf8');
  assert.match(src,/const key=JSON\.stringify\(\[BUSES\.map\(bus=>engine\.settings\[bus\]\),engine\.settings\.vibration\]\);\s*if\(key===shown\)return;/);
  assert.match(src,/engine\.onChange\(render\)/);
});
