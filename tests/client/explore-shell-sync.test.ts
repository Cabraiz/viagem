import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// lobby.ts calls openExploration() and right away looks for `dialog.explore-shell .explore-layout` to mount the
// waiting room. Any `await` before the shell is in the document leaves the room without its "Tô pronto!" panel
// (regression of 9b27ceb: `await artReady()` at the top of openExploration).
test('openExploration puts the shell in the document before its first await (lobby mounts the waiting room on it)',()=>{
  const src=readFileSync('src/client/explore.ts','utf8');
  const start=src.indexOf('export async function openExploration');
  assert.ok(start>=0,'openExploration not found');
  const body=src.slice(start);
  const append=body.indexOf('document.body.append(shell)');
  assert.ok(append>0,'shell append not found');
  // Statements of the function body itself are indented 2 spaces (awaits inside nested callbacks do not count).
  const before=body.slice(0,append).split(/\r?\n/).filter(line=>/^ {2}(?! )(?:.*[^.\w])?await\s/.test(line));
  assert.deepEqual(before,[],'top-level await before the shell is appended');
});
