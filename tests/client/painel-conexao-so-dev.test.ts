// painel-conexao-so-dev: the room's connection panel ("Conexão da sala", "Testar reconexão") is a dev tool; the
// published game (vite build, import.meta.env.DEV false, no ?perf=1) never builds it, and nothing breaks without it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');

test('the panel is built only in dev or with ?perf=1',()=>{
  const at=explore.indexOf('<summary>Conexão da sala</summary>');
  assert.ok(at>0,'the panel still exists for dev');
  assert.equal(explore.indexOf('<summary>Conexão da sala',at+1),-1,'built in one place only');
  const line=explore.slice(explore.lastIndexOf('\n',at),at);
  assert.match(line,/if\(import\.meta\.env\.DEV\|\|SHELL_DEBUG\)\{const debug=document\.createElement\('details'\)/);
});

test('without the panel the game runs: no hard lookup of its button or its line',()=>{
  assert.doesNotMatch(explore,/\$\('#coop-reconnect'\)/);
  assert.match(explore,/document\.querySelector\('#coop-reconnect'\)\?\.addEventListener/);
  assert.match(explore,/const diagnostics=find\('#coop-diagnostics'\);\s*if\(slow&&diagnostics&&/);
  assert.doesNotMatch(explore,/\$\('#coop-diagnostics'\)/);
});
