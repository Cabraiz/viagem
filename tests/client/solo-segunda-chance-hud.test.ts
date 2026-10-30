// NEW-20261029-ORQ-solo-segunda-chance: alone in the run the fall's banner says the hero is getting up by himself
// (not "Grita por socorro"), and right after the get-up a short line says it was the last chance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeView} from '../../src/client/hud/fixtures.ts';
import {LAST_CHANCE_TEXT,LAST_CHANCE_TICKS,lastChanceUntil,reviveBanner,soloRun} from '../../src/client/hud/model.ts';
import {SIM_HZ} from '../../src/contract/types.ts';

const down=(view:ReturnType<typeof fakeView>,index:number,seconds:number,progress=0)=>{const p=view.players[index];p.hp=0;p.downed={progress,bleedOutTick:view.tick+seconds*SIM_HZ};};

test('solo: the get-up reads as the second chance, with and without the world rescue; with a partner the old copy stays',()=>{
  const solo=fakeView('wave',1);
  assert.ok(soloRun(solo));
  down(solo,0,28,.4);
  for(const world of [false,true]){
    const banner=reviveBanner(solo,'p1',undefined,undefined,undefined,world)!;
    assert.equal(banner.text,'Segunda chance! Levantando… 40%');
    assert.equal(banner.kind,'self');assert.equal(banner.progress,.4);assert.ok(Number.isFinite(banner.seconds),'the bar fills');
  }
  const duo=fakeView('wave',2);
  assert.ok(!soloRun(duo));
  down(duo,0,28,.4);
  assert.match(reviveBanner(duo,'p1')!.text,/^Te salvando… 40%$/);
  assert.equal(reviveBanner(duo,'p1',undefined,undefined,undefined,true),undefined,'the world rescue keeps the fall in the world');
  // A spectator watching does not make the run less lonely.
  const watched=fakeView('wave',2);watched.players[1].spectator=true;
  assert.ok(soloRun(watched));
});

test('the last-chance line: set by the own solo get-up, shown 3 s while standing, never for a rescue or with a partner',()=>{
  const view=fakeView('wave',1);
  view.events=[{type:'revived',player:'p1'}];
  const until=lastChanceUntil(view,'p1')!;
  assert.equal(until,view.tick+LAST_CHANCE_TICKS);
  const banner=reviveBanner(view,'p1',undefined,undefined,undefined,true,until)!;
  assert.equal(banner.text,LAST_CHANCE_TEXT);assert.equal(banner.urgent,true);assert.equal(banner.seconds,Infinity);
  view.tick=until;
  assert.equal(reviveBanner(view,'p1',undefined,undefined,undefined,true,until),undefined,'gone after 3 s');
  assert.equal(reviveBanner(view,'p1','Reconectando…',undefined,undefined,true,Infinity)!.text,'Reconectando…','the connection wins');
  // A rescue (by someone) or a partner in the run is no last chance.
  view.events=[{type:'revived',player:'p1',by:'p2'}];
  assert.equal(lastChanceUntil(view,'p1'),undefined);
  const duo=fakeView('wave',2);duo.events=[{type:'revived',player:'p1'}];
  assert.equal(lastChanceUntil(duo,'p1'),undefined);
});
