// escolha-subtitulo-3-linhas (NEW-20261031-ORQ-escolha-subtitulo-3-linhas): the chosen popup no longer repeats the hero's
// long name, and the role's line on the right is at most 3 lines, whole words, at every width.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ROLE_LINE} from '../../src/client/ui/suit.ts';
import {roles} from '../../src/rules/index.ts';

const main=readFileSync(new URL('../../src/main.ts',import.meta.url),'utf8');
const style=readFileSync(new URL('../../src/client/style.css',import.meta.url),'utf8');
const escolha=readFileSync(new URL('../../src/client/ui/escolha.css',import.meta.url),'utf8');

test('showChosen: the badge and the role\'s line, no hero name',()=>{
  const body=main.slice(main.indexOf('function showChosen'));
  const html=body.slice(0,body.indexOf('\n}'));
  assert.match(html,/<span class="chosen-role" title="\$\{line\}">\$\{suit\(selected\.role\)\}\$\{selected\.role\}<\/span><small class="chosen-role-linha">\$\{line\}<\/small>/);
  assert.doesNotMatch(html,/selected\.name/);
});

test('the role\'s line: 3 lines at most, never cut mid-word',()=>{
  assert.match(style,/#confirmation \.chosen-role-linha\{[^}]*-webkit-line-clamp:3;line-clamp:3;overflow:hidden;overflow-wrap:normal/);
  // 29 characters is the longest that fit 3 lines in the 76 px beside the hero at 320x568 (the evidence's popup.mjs).
  for(const role of roles)assert.ok(ROLE_LINE[role].length<=29&&!ROLE_LINE[role].includes('…'),`${role}: ${ROLE_LINE[role]}`);
});

test('the hero art beside it is capped by the width too, or a tall phone leaves the text 54 px',()=>{
  assert.match(escolha,/\.chosen-card \.class-art\{--arte:clamp\(110px,min\(24dvh,40vw\),190px\)/);
});
