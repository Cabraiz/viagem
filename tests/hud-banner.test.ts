import test from 'node:test';
import assert from 'node:assert/strict';
import {fakeView} from '../src/game/hud/fixtures.ts';
import {reviveBanner,OUT_TEXT,WATCH_TEXT} from '../src/game/hud/model.ts';
import {SIM_HZ} from '../src/game/sim/types.ts';

const down=(view:ReturnType<typeof fakeView>,index:number,seconds:number,progress=0)=>{const p=view.players[index];p.hp=0;p.downed={progress,bleedOutTick:view.tick+seconds*SIM_HZ};};

test('one banner: the own fall wins over allies and over a group',()=>{
  const view=fakeView('wave',6);down(view,0,21);down(view,2,12);down(view,3,9);
  const banner=reviveBanner(view,'p1')!;
  assert.equal(banner.kind,'self');assert.match(banner.text,/Você caiu/);
});

test('allies down at the same time are grouped into a single line',()=>{
  const view=fakeView('wave',6);down(view,2,12);down(view,3,9);
  const two=reviveBanner(view,'p1')!;
  assert.equal(two.kind,'ally');assert.match(two.text,/ e .* caíram! Corre lá · 9 s/);assert.equal(two.seconds,9);
  down(view,4,4);
  const three=reviveBanner(view,'p1')!;
  assert.match(three.text,/^3 da turma caíram! Corre lá · 4 s$/);assert.equal(three.urgent,true);
  view.players[3].downed!.progress=.45;
  assert.match(reviveBanner(view,'p1')!.text,/Salvando .*… 45% · \+2 caídos/);
});

test('a single ally keeps the old copy; nobody down means no banner',()=>{
  const view=fakeView('wave',6);
  assert.equal(reviveBanner(view,'p1'),undefined);
  down(view,1,12);
  assert.match(reviveBanner(view,'p1')!.text,/caiu! Corre lá · 12 s/);
});

test('eliminated and watching players are told so; the connection banner beats everything',()=>{
  const view=fakeView('wave',6);down(view,2,12);
  view.players[0].eliminated=true;
  assert.equal(reviveBanner(view,'p1')!.text,OUT_TEXT);
  view.players[0].eliminated=undefined;view.players[0].spectator=true;
  assert.equal(reviveBanner(view,'p1')!.text,WATCH_TEXT);
  down(view,0,20);
  assert.equal(reviveBanner(view,'p1','Reconectando à turma…')!.text,'Reconectando à turma…');
});
