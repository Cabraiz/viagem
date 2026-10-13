// E5-checkpoint-por-round: the "a sala caiu e voltou" news shows once over the match, as a row of the HUD's slot.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RESUMED_ROW_MS,resumedOnce} from '../../src/client/ui/resumed-row.ts';
import {resumedNotice} from '../../src/protocol/room.ts';

test('the resumed news shows once: the field read when the match opens and the message itself are one news',()=>{
  const shown:string[]=[],show=resumedOnce(news=>shown.push(news.title));
  const news=resumedNotice(3);
  assert.equal(show(undefined),false);
  assert.equal(show({title:news.title,body:news.body}),true);
  assert.equal(show({title:news.title,body:news.body}),false,'the same news again');
  assert.equal(show({title:resumedNotice(4).title,body:resumedNotice(4).body}),true,'a later restart, another round');
  assert.deepEqual(shown,[resumedNotice(3).title,resumedNotice(4).title]);
  assert.ok(RESUMED_ROW_MS>=5000&&RESUMED_ROW_MS<=10_000,'long enough to read two short lines, gone on its own');
  assert.ok(news.title.length<=50&&news.body.length<=70,'short enough for one row on a phone');
});

test('the match wires it: the client\'s onResumed and its stored notice go to the HUD slot (queueRow) for RESUMED_ROW_MS',()=>{
  const explore=readFileSync(new URL('../../src/client/explore.ts',import.meta.url),'utf8');
  assert.ok(explore.includes('net.onResumed=news=>{skill?.reset();showResumed(news);};if(net.resumedNotice)skill?.reset();showResumed(net.resumedNotice);'),'the news goes to the slot, and the skill button forgets its pre-crash answer (review)');
  assert.match(explore,/runHud\.queueRow\(resumedRow,RESUMED_ROW_MS\)/);
  assert.match(explore,/textContent=news\.title[^]*textContent=news\.body/,'text, never HTML');
});
