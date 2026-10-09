import test from 'node:test';
import assert from 'node:assert/strict';
import {classes} from '../src/classes.ts';
import {EMOTES,EMOTE_COOLDOWN_MS,EmoteGate,isEmoteId,placeBalloon} from '../src/game/fun/emotes.ts';
import {FALLBACK_LINES,LINE_MAX,LineThrottle,SITUATIONS,UPGRADE_TALK_CHANCE,lineForEvent,linesFor,pickLine,resultLine} from '../src/game/fun/lines.ts';
import {CLASS_LINES} from '../src/game/fun/lines.data.ts';

const normalize=(s:string)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g,' ').trim();

test('every one of the 36 classes has short lines for all situations',()=>{
  assert.equal(classes.length,36);
  assert.deepEqual(Object.keys(CLASS_LINES).sort(),classes.map(c=>c.id).sort());
  for(const hero of classes)for(const situation of SITUATIONS){
    const lines=CLASS_LINES[hero.id][situation];
    assert.ok(lines.length>=2,`${hero.id}.${situation}`);
    for(const line of lines){
      assert.ok(line.trim().length>0,`${hero.id}.${situation} empty`);
      assert.ok(line.length<=LINE_MAX,`${hero.id}.${situation} too long: ${line}`);
      assert.equal(line,line.trim());
    }
  }
});

test('no line repeats anywhere, even ignoring case, accents and punctuation',()=>{
  const seen=new Map<string,string>();
  for(const [id,bySituation] of Object.entries(CLASS_LINES))for(const [situation,lines] of Object.entries(bySituation))for(const line of lines){
    const key=normalize(line);
    assert.ok(!seen.has(key),`"${line}" (${id}.${situation}) repeats ${seen.get(key)}`);
    seen.set(key,`${id}.${situation}`);
  }
  for(const hero of classes)assert.ok(!seen.has(normalize(hero.quote)),`${hero.id} reuses its quote`);
  assert.ok(seen.size>=36*6*2);
});

test('pickLine is deterministic, stays in the class list and falls back for unknown classes',()=>{
  for(const hero of classes.slice(0,6))for(const situation of SITUATIONS){
    const a=pickLine(hero.id,situation,42),b=pickLine(hero.id,situation,42);
    assert.equal(a,b);assert.ok(CLASS_LINES[hero.id][situation].includes(a));
  }
  // Golden values: server and every client build must pick the same line for the same seed.
  assert.equal(pickLine('mendigo','down',1),'Me ajuda, eu sei um atalho!');
  assert.equal(pickLine('tecnico-ti','revive','t120|p2'),'Desliga e liga de novo!');
  assert.equal(pickLine('clt-cansado','upgrade',7),'Esse card podia ser um e-mail.');
  const spread=new Set(Array.from({length:40},(_,i)=>pickLine('mendigo','down',i)));
  assert.equal(spread.size,CLASS_LINES.mendigo.down.length,'seeds reach every line');
  assert.equal(linesFor('classe-nova','win'),FALLBACK_LINES.win);
  assert.ok(FALLBACK_LINES.win.includes(pickLine('classe-nova','win',1)));
});

test('simulation events map to the right speaker and situation',()=>{
  const crew=[{id:'b',classId:'tecnico-ti'},{id:'a',classId:'clt-cansado'},{id:'c',classId:'motogirl'}];
  const down=lineForEvent({type:'downed',player:'a'},crew,1)!;
  assert.equal(down.speaker,'a');assert.equal(down.situation,'down');assert.ok(CLASS_LINES['clt-cansado'].down.includes(down.text));
  const revive=lineForEvent({type:'revived',player:'a',by:'b'},crew,1)!;
  assert.equal(revive.speaker,'b');assert.equal(revive.situation,'revive');assert.ok(CLASS_LINES['tecnico-ti'].revive.includes(revive.text));
  assert.equal(lineForEvent({type:'revived',player:'a'},crew,1),undefined,'no rescuer, no line');
  // Upgrades also come from chests, forge and default picks: only about a third talk, deterministically.
  const ups=Array.from({length:300},(_,i)=>lineForEvent({type:'upgrade',player:'c',item:'chinelo',level:2},crew,i));
  const talked=ups.filter(Boolean);
  assert.ok(Math.abs(talked.length/ups.length-UPGRADE_TALK_CHANCE)<.1,`upgrade talk rate ${talked.length/ups.length}`);
  assert.ok(talked.every(l=>l!.situation==='upgrade'&&l!.speaker==='c'));
  assert.deepEqual(ups,Array.from({length:300},(_,i)=>lineForEvent({type:'upgrade',player:'c',item:'chinelo',level:2},crew,i)));
  assert.equal(lineForEvent({type:'evolve',player:'c',from:'chinelo',to:'chinelo-evo'},crew,1)!.speaker,'c');
  assert.equal(lineForEvent({type:'downed',player:'ghost'},crew,1),undefined);
  assert.equal(lineForEvent({type:'kill',enemy:'e1',kind:'gosma',x:0,y:0},crew,1),undefined);
  // Team level-up: exactly one speaker, the same on every client regardless of list order.
  const up=lineForEvent({type:'levelup',level:3},crew,9)!,again=lineForEvent({type:'levelup',level:3},[...crew].reverse(),9)!;
  assert.equal(up.situation,'levelUp');assert.deepEqual(up,again);
  const speakers=new Set(Array.from({length:30},(_,i)=>lineForEvent({type:'levelup',level:i+2},crew,i)!.speaker));
  assert.ok(speakers.size>1,'level-ups rotate between players');
  assert.equal(lineForEvent({type:'levelup',level:2},[],1),undefined);
  assert.ok(CLASS_LINES.motogirl.win.includes(resultLine(crew[2],true,5)));
  assert.ok(CLASS_LINES.motogirl.lose.includes(resultLine(crew[2],false,5)));
});

test('four emotes with the agreed labels',()=>{
  assert.deepEqual(EMOTES.map(e=>e.label),['KKKK','Me salva','Vem','Foi mal']);
  assert.equal(new Set(EMOTES.map(e=>e.id)).size,4);
  assert.ok(isEmoteId('kkkk'));assert.ok(!isEmoteId('KKKK'));assert.ok(!isEmoteId(undefined));assert.ok(!isEmoteId({id:'kkkk'}));
});

test('emote gate allows one emote per player every 2 s',()=>{
  const gate=new EmoteGate();
  assert.equal(EMOTE_COOLDOWN_MS,2000);
  assert.ok(gate.tryUse('a',1000));
  assert.ok(!gate.tryUse('a',1500),'spam blocked');
  assert.equal(gate.remaining('a',1500),1500);
  assert.ok(gate.tryUse('b',1500),'other players are independent');
  assert.ok(!gate.tryUse('a',2999));
  assert.ok(gate.tryUse('a',3000),'allowed again after exactly 2 s');
  assert.ok(!gate.tryUse('c',Number.NaN),'garbage clock refused');
  gate.forget('a');assert.ok(gate.tryUse('a',3001));
  // Clock stepping back (time base reset) never locks a player for longer than one cooldown.
  const back=new EmoteGate();assert.ok(back.tryUse('a',1e6));
  assert.ok(back.remaining('a',1e5)<=EMOTE_COOLDOWN_MS);
  assert.ok(!back.tryUse('a',1e5));assert.ok(back.tryUse('a',1e5+EMOTE_COOLDOWN_MS));
  assert.equal(back.remaining('a',Number.NaN),EMOTE_COOLDOWN_MS,'NaN clock reads as blocked');
  assert.equal(new EmoteGate(Number.NaN).cooldownMs,EMOTE_COOLDOWN_MS,'invalid cooldown falls back');
  // A flood of 100 taps in 1 s yields a single emote.
  const flood=new EmoteGate();let sent=0;
  for(let t=0;t<1000;t+=10)if(flood.tryUse('x',t))sent++;
  assert.equal(sent,1);
});

test('balloons stay inside the phone screen and point at the speaker',()=>{
  const balloon={width:150,height:34};
  for(const view of [{width:390,height:844},{width:844,height:390}]){
    for(const [x,y] of [[195,400],[5,300],[view.width-3,200],[200,10],[100,view.height-2]]){
      const p=placeBalloon(x,y,balloon,view);
      assert.ok(p.left>=8&&p.left+balloon.width<=view.width-8,`x inside at ${x},${y}`);
      assert.ok(p.top>=8&&p.top+balloon.height<=view.height-8,`y inside at ${x},${y}`);
      assert.ok(p.tail>=12&&p.tail<=balloon.width-12);
    }
  }
  const above=placeBalloon(195,400,balloon,{width:390,height:844});
  assert.equal(above.below,false);assert.equal(above.top,400-10-34);assert.equal(above.tail,75);
  assert.equal(placeBalloon(195,20,balloon,{width:390,height:844}).below,true,'flips below near the top edge');
  assert.equal(placeBalloon(4,400,balloon,{width:390,height:844}).tail,12,'tail clamps toward the edge speaker');
});

test('line throttle keeps balloons rare but never mutes falls and rescues',()=>{
  const t=new LineThrottle(6000,1500);
  const line=(speaker:string,situation:'levelUp'|'upgrade'|'down'|'revive')=>({speaker,situation,text:'x'});
  assert.ok(t.allow(line('a','upgrade'),0));
  assert.ok(!t.allow(line('b','upgrade'),1000),'global gap');
  assert.ok(t.allow(line('b','levelUp'),1600));
  assert.ok(!t.allow(line('a','upgrade'),4000),'same speaker waits 6 s');
  assert.ok(t.allow(line('a','down'),4100),'falls always talk');
  assert.ok(t.allow(line('c','revive'),4200),'rescues always talk');
  assert.ok(t.allow(line('a','levelUp'),10200));
  assert.ok(!t.allow(line('d','levelUp'),Number.NaN));
  // A burst of 6 upgrades in one tick (chest/forge) yields one balloon.
  const burst=new LineThrottle();let shown=0;
  for(const id of ['p1','p2','p3','p4','p5','p6'])if(burst.allow(line(id,'upgrade'),5000))shown++;
  assert.equal(shown,1);
  // Clock stepping back does not mute anyone.
  const back=new LineThrottle();assert.ok(back.allow(line('a','levelUp'),1e6));assert.ok(back.allow(line('a','levelUp'),10));
});
