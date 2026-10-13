// BUG (live, 13/10): in landscape the countdown layout (.coop-wait[data-phase=countdown]{display:flex}) came after
// .coop-wait[hidden]{display:none} with the same specificity and won, so the waiting window stayed on screen, frozen on
// "1", over the whole match. A hidden waiting window must never be shown by any phase or orientation rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const css=readFileSync(new URL('../../src/client/coop.css',import.meta.url),'utf8');

test('a hidden waiting window stays hidden over every phase/orientation display rule (landscape countdown bug)',()=>{
  assert.match(css,/\.coop-wait\[hidden\]\{display:none!important\}/,'the hidden rule must win over .coop-wait[data-phase=…]{display:…}');
  // Every rule that gives the waiting window itself a display is a phase/orientation layout the hidden rule must beat.
  const shows=[...css.matchAll(/(^|[},])\s*\.coop-wait(\[[^\]]+\])*\s*\{[^}]*display:(?!none)/gm)];
  assert.ok(shows.length>=1,'the countdown layout rule still exists (this test guards it)');
});
