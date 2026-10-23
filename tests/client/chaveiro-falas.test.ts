// D-047, card NEW-20261013-ORQ-chaveiro-falas: the chaveiro's cast's lines (render/chaveiro/lines.ts), the picker, and
// when they speak (render/chaveiro/talk.ts): from protocol 15's events, from the objective view, and from the result.
import test from 'node:test';
import assert from 'node:assert/strict';
import {CHAVEIRO_LINES,END_EVENTS,LINE_EVENTS,MAX_LINE_CHARS,SPEAKER_SPOT,hash32,pickLine,talkSeed,type LineEvent} from '../../src/client/render/chaveiro/lines.ts';
import {ChaveiroTalk,DEDUPE_MS,LINE_GAP_MS,PENDING_MS,REPEAT_MS,eventMoment,resultMoment,viewEndMoment,type LooseEvent} from '../../src/client/render/chaveiro/talk.ts';
import type {ChaveiroView,MotoMode} from '../../src/client/render/chaveiro/view.ts';
import {fakeTalkEvents,FALA_AT_MS,FALA_EVERY_MS} from '../../src/client/sandboxes/sandbox-chaveiro.ts';
import {TIO_SPOT,tioSpot} from '../../src/client/render/chaveiro/rules.ts';
import {CAR_HALF,CAR_TOP} from '../../src/client/render/chaveiro/figures.ts';
import {isoOffset} from '../../src/client/render/chaveiro/iso.ts';

const ALL=LINE_EVENTS.flatMap(e=>CHAVEIRO_LINES[e].map(([speaker,text])=>({event:e,speaker,text})));
/** The balloon wraps at 280 px of 20 px bold system-ui (layers.ts BUBBLE_STYLE): ~11 px a character, 25 a row. */
const ROW_CHARS=25,MAX_ROWS=3;
function rows(text:string){
  let n=1,row=0;
  for(const word of text.split(' ')){
    if(row&&row+1+word.length>ROW_CHARS){n++;row=word.length;}else row+=(row?1:0)+word.length;
  }
  return n;
}

test('falas: every line is short (≤ 60 chars) and fits the balloon at 390 px (3 rows of its 280 px wrap)',()=>{
  for(const {event,text} of ALL){
    assert.ok([...text].length<=MAX_LINE_CHARS,`${event}: ${text} (${[...text].length})`);
    assert.ok(rows(text)<=MAX_ROWS,`${event}: ${text} wraps to ${rows(text)} rows`);
    // 280 px wrap + 2×10 px padding + edge, at the city's ui scale 1: inside a 390 px phone with its 16 px gutters.
    assert.ok(280+2*10+2*2<=390-2*16);
  }
});

test('falas: 4 to 8 variations per moment, each moment its own (tranco-sozinha does not borrow tranco\'s)',()=>{
  assert.deepEqual([...LINE_EVENTS].sort(),['abrindo','acordou','buy','chefe','chegou','conector','divida','empurra','entrega','lombada','morta','part','perda-total','puxa','sale','tombo','tranco','tranco-sozinha','volta'].sort());
  for(const e of LINE_EVENTS)assert.ok(CHAVEIRO_LINES[e].length>=4&&CHAVEIRO_LINES[e].length<=8,`${e}: ${CHAVEIRO_LINES[e].length}`);
  assert.deepEqual([...END_EVENTS].sort(),['conector','divida','perda-total']);
});

test('falas: no empty line, no line twice in the whole table, a known speaker each, plain text',()=>{
  const seen=new Set<string>();
  for(const {event,speaker,text} of ALL){
    assert.ok(text.trim().length>0&&text===text.trim(),`${event}: empty or padded`);
    assert.ok(!seen.has(text.toLowerCase()),`duplicate: ${text}`);seen.add(text.toLowerCase());
    assert.ok(Object.hasOwn(SPEAKER_SPOT,speaker),`${event}: speaker ${speaker}`);
    // No markup, no line breaks, no URL or handle (nothing that is not a spoken line).
    assert.doesNotMatch(text,/[<>\n\r\t@#]|https?:|www\./,`${event}: ${text}`);
  }
  // Who speaks where: the riders over the moto, the Tio beside the car, the alarm over the car.
  assert.deepEqual(SPEAKER_SPOT,{chaveiro:'moto',cida:'moto',tio:'car-side',carro:'car'});
});

test('falas: the picker is deterministic by seed and never says the same line twice in a row for a moment',()=>{
  for(const e of LINE_EVENTS){
    const n=CHAVEIRO_LINES[e].length;
    for(let seed=0;seed<400;seed++){
      const a=pickLine(e,seed),b=pickLine(e,seed);
      assert.deepEqual(a,b);
      assert.ok(a.index>=0&&a.index<n);
      assert.equal(a.text,CHAVEIRO_LINES[e][a.index][1]);assert.equal(a.spot,SPEAKER_SPOT[a.speaker]);
      for(let last=0;last<n;last++)assert.notEqual(pickLine(e,seed,last).index,last,`${e} seed ${seed} repeated ${last}`);
    }
  }
  // A run of picks as the talk makes them (counter in the seed, the last one excluded): never twice in a row, and
  // every line of the moment comes up.
  for(const e of LINE_EVENTS){
    let last:number|undefined;const used=new Set<number>();
    for(let k=0;k<200;k++){const p=pickLine(e,hash32(talkSeed('ABCD',7),k),last);assert.notEqual(p.index,last);last=p.index;used.add(p.index);}
    assert.equal(used.size,CHAVEIRO_LINES[e].length,`${e}: some line never comes up`);
  }
  assert.notEqual(talkSeed('ABCD',7),talkSeed('ABCE',7));assert.notEqual(talkSeed('ABCD',7),talkSeed('ABCD',8));
});

/** An objective view with the moto in `mode` (and these parts down). */
function view(mode:MotoMode,extra:Partial<ChaveiroView>&{grana?:number;budget?:number}={}):ChaveiroView{
  return {moto:{x:0,y:0,mode},etaS:300,alarmUntil:0,car:{x:5,y:5,hits:0,limit:80,parts:0},...extra};
}
/** The talk fed `steps` (view + events at `at` ms), returning every line it said (asking each 100 ms). */
function run(steps:{at:number;view?:ChaveiroView;events?:LooseEvent[];result?:unknown}[],until?:number,seed=1){
  const talk=new ChaveiroTalk(seed),out:{at:number;event:LineEvent;text:string;priority:boolean}[]=[];
  const end=until??Math.max(...steps.map(s=>s.at))+PENDING_MS+LINE_GAP_MS;
  let i=0,tick=0;
  for(let now=0;now<=end;now+=100){
    while(i<steps.length&&steps[i].at<=now){const s=steps[i++];tick++;talk.push('view' in s?s.view:view('anda'),s.events??[],tick,now);if(s.result)talk.result(s.result,now);}
    const said=talk.take(now);if(said)out.push({at:now,event:said.event,text:said.text,priority:said.priority});
  }
  return out;
}

test('falas: protocol 15 events → their moment (alarm volta, part, moto moments, tranco alone, sale, buy), loosely by type',()=>{
  const cases:[LooseEvent,LineEvent|undefined][]=[
    [{type:'alarm',untilTick:90},'volta'],[{type:'part',name:'porta'},'part'],[{type:'sale',enemy:'e3'},'sale'],
    [{type:'buy',player:'p1',item:'cocada'},'buy'],[{type:'moto',mode:'tranco'},'tranco'],[{type:'moto',mode:'tranco',alone:true},'tranco-sozinha'],
    [{type:'moto',mode:'morta'},'morta'],[{type:'moto',mode:'lombada'},'lombada'],[{type:'moto',mode:'entrega'},'entrega'],
    [{type:'moto',mode:'tombo'},'tombo'],[{type:'moto',mode:'volta'},'volta'],[{type:'moto',mode:'abrindo'},'abrindo'],
    [{type:'moto',mode:'chegou'},'chegou'],[{type:'moto',mode:'anda'},undefined],[{type:'damage'},undefined],
  ];
  for(const [event,moment] of cases)assert.equal(eventMoment(event),moment,JSON.stringify(event));
  for(const [event,moment] of cases)if(moment){
    const said=run([{at:0,view:view('anda')},{at:500,events:[{...event,eventId:1}]}]);
    assert.deepEqual(said.map(s=>s.event),[moment],JSON.stringify(event));
    assert.ok(CHAVEIRO_LINES[moment].some(([,t])=>t===said[0].text));
  }
  // The boss's arrival (main's boss-phase at phase 1, a boss not seen before) → chefe; its later phases say nothing.
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,events:[{type:'boss-phase',enemy:'b1',phase:1,eventId:1}]},{at:6000,events:[{type:'boss-phase',enemy:'b1',phase:2,eventId:2}]}]).map(s=>s.event),['chefe']);
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,events:[{type:'boss-phase',enemy:'b2',phase:3,eventId:1}]}]).map(s=>s.event),[]);
  // D-051: a nest's band woke (acordou) → acordou, without muting the view's moments (it is not a chaveiro event).
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,events:[{type:'acordou',x:1,y:2,n:5,eventId:1}]},{at:6000,view:view('morta')}]).map(s=>s.event),['acordou','morta']);
  // An event already seen (same eventId) is not heard again.
  assert.equal(run([{at:0,view:view('anda')},{at:500,events:[{type:'sale',enemy:'e',eventId:4}]},{at:6000,events:[{type:'sale',enemy:'e',eventId:4}]}]).length,1);
});

test('falas: the view speaks until the events arrive: mode changes, morta → anda is the tranco, a new part',()=>{
  for(const mode of ['volta','morta','lombada','entrega','tombo','abrindo'] as const)
    assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view(mode)}]).map(s=>s.event),[mode],mode);
  assert.deepEqual(run([{at:0,view:view('morta')},{at:500,view:view('anda')}]).map(s=>s.event),['tranco']);
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('anda',{car:{x:5,y:5,hits:20,limit:80,parts:1}})}]).map(s=>s.event),['part']);
  // The first view (joining mid-run) says nothing: its mode and parts are the state, not a change.
  assert.deepEqual(run([{at:0,view:view('morta',{car:{x:5,y:5,hits:40,limit:80,parts:3}})}]).map(s=>s.event),[]);
  // Event and view of the same moment speak once; once the events came, the view's changes are theirs.
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('morta'),events:[{type:'moto',mode:'morta',eventId:1}]}]).map(s=>s.event),['morta']);
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('anda'),events:[{type:'sale',enemy:'e',eventId:1}]},{at:9000,view:view('lombada')},{at:20000,view:view('lombada',{car:{x:5,y:5,hits:20,limit:80,parts:1}})}]).map(s=>s.event),['sale']);
  // The alarm and the lap it starts (event + mode) are one moment.
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('volta'),events:[{type:'alarm',untilTick:9,eventId:1},{type:'moto',mode:'volta',eventId:2}]}]).map(s=>s.event),['volta']);
});

test('falas: D-052, the team moves the Quadradão: someone starts pushing → empurra, the rope hooked → puxa, not every step',()=>{
  const car=(movers?:string[],rope?:string)=>({car:{x:5,y:5,hits:0,limit:80,parts:0,...(movers?{movers}:{}),...(rope?{rope}:{})}});
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('anda',car(['p1']))}]).map(s=>s.event),['empurra']);
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('anda',car(['p1'],'p1'))}]).map(s=>s.event),['puxa']);
  // The rope holder is on the movers list: alone, it is a pull, not a push; a second hero pushing too is the push.
  assert.deepEqual(run([{at:0,view:view('anda',car(['p1'],'p1'))},{at:500,view:view('anda',car(['p1','p2'],'p1'))}]).map(s=>s.event),['empurra']);
  // Joining with the car already moving says nothing (the state, not a change).
  assert.deepEqual(run([{at:0,view:view('anda',car(['p1','p2'],'p2'))}]).map(s=>s.event),[]);
  // The push comes and goes (a hero steps off to fight and back): once per REPEAT_MS, then again with another line.
  const repeat=REPEAT_MS.empurra??0;
  assert.ok(repeat>=4*LINE_GAP_MS);
  const flicker=[{at:0,view:view('anda')},...Array.from({length:40},(_,i)=>({at:500+i*1000,view:view('anda',i%2?{}:car(['p1']))}))];
  const said=run(flicker,500+40*1000+repeat);
  assert.equal(said.length,Math.ceil(40*1000/repeat));
  for(let i=1;i<said.length;i++){assert.ok(said[i].at-said[i-1].at>=repeat);assert.notEqual(said[i].text,said[i-1].text);}
  // Pushing does not mute the moto's own moments (the view still tells them).
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('anda',car(['p1']))},{at:6000,view:view('lombada',car(['p1']))}]).map(s=>s.event),['empurra','lombada']);
});

test('falas: the end: conector, divida (Grana short of the budget), perda-total; from the view or the result, once',()=>{
  assert.equal(viewEndMoment(view('abrindo',{ended:'victory'})),'conector');
  assert.equal(viewEndMoment(view('abrindo',{ended:'victory',grana:50,budget:80})),'divida');
  assert.equal(viewEndMoment(view('abrindo',{ended:'victory',grana:80,budget:80})),'conector');
  assert.equal(viewEndMoment(view('anda',{ended:'defeat',car:{x:5,y:5,hits:80,limit:80,parts:15}})),'perda-total');
  assert.equal(viewEndMoment(view('anda',{ended:'defeat'})),undefined); // the team fell: the car is fine
  assert.equal(resultMoment({outcome:'victory',cause:'opened',debt:0}),'conector');
  assert.equal(resultMoment({outcome:'victory',cause:'opened',debt:12}),'divida');
  assert.equal(resultMoment({outcome:'defeat',cause:'car',debt:0}),'perda-total');
  assert.equal(resultMoment({outcome:'defeat',cause:'team'}),undefined);
  assert.equal(resultMoment(undefined),undefined);
  // From the result; right after another line (no gap: priority); then nothing more, whatever comes.
  const said=run([{at:0,view:view('anda')},{at:500,events:[{type:'sale',enemy:'e',eventId:1}]},{at:700,result:{cause:'opened',debt:5}},
    {at:900,view:view('abrindo',{ended:'victory'}),events:[{type:'part',name:'porta',eventId:2}]}]);
  assert.deepEqual(said.map(s=>[s.event,s.priority]),[['sale',false],['divida',true]]);
  assert.ok(said[1].at-said[0].at<LINE_GAP_MS);
  // From the view, when the result is not there yet.
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,view:view('anda',{ended:'defeat',car:{x:5,y:5,hits:80,limit:80,parts:15}})}]).map(s=>s.event),['perda-total']);
});

test('falas: one line every LINE_GAP_MS; a moment in the gap waits PENDING_MS, the most important first; repeats deduped',()=>{
  // Three moments 1 s apart: the first now, the most important waiting one at the gap's end, the other dropped.
  const said=run([{at:0,view:view('anda')},{at:500,events:[{type:'buy',player:'p',item:'cocada',eventId:1}]},
    {at:1500,events:[{type:'sale',enemy:'e',eventId:2}]},{at:2500,events:[{type:'part',name:'porta',eventId:3}]},{at:3500,events:[{type:'sale',enemy:'f',eventId:4}]}]);
  assert.deepEqual(said.map(s=>s.event),['buy','part']);
  assert.equal(said[1].at-said[0].at,LINE_GAP_MS);
  // Equal weights: the newest waiting one.
  assert.deepEqual(run([{at:0,view:view('anda')},{at:500,events:[{type:'buy',player:'p',item:'cocada',eventId:1}]},
    {at:1500,events:[{type:'sale',enemy:'e',eventId:2}]},{at:2500,events:[{type:'moto',mode:'lombada',eventId:3}]}]).map(s=>s.event),['buy','lombada']);
  // A moment older than PENDING_MS when the talk is next asked (a hidden tab) is old news.
  const talk=new ChaveiroTalk(1);talk.push(view('anda'),[],1,0);talk.push(view('anda'),[{type:'sale',enemy:'e',eventId:1}],2,100);
  assert.equal(talk.take(100+PENDING_MS+1),undefined);
  // The same moment twice within DEDUPE_MS is once; later, it speaks again with another line.
  const twice=run([{at:0,view:view('anda')},{at:500,events:[{type:'sale',enemy:'e',eventId:1}]},{at:500+DEDUPE_MS-100,events:[{type:'sale',enemy:'f',eventId:2}]},
    {at:20000,events:[{type:'sale',enemy:'g',eventId:3}]}]);
  assert.equal(twice.length,2);assert.notEqual(twice[0].text,twice[1].text);
  // A spam of alarms over a minute: never closer than the gap, and never the same line twice in a row.
  const steps=[{at:0,view:view('anda')},...Array.from({length:60},(_,i)=>({at:1000+i*1000,events:[{type:'alarm',untilTick:0,eventId:i+1}]}))];
  const spam=run(steps);
  assert.ok(spam.length>=8);
  for(let i=1;i<spam.length;i++){assert.ok(spam[i].at-spam[i-1].at>=LINE_GAP_MS);assert.notEqual(spam[i].text,spam[i-1].text);}
});

test('falas: deterministic by seed (two phones, same room: same lines), a new run starts clean',()=>{
  const steps=[{at:0,view:view('anda')},...Array.from({length:20},(_,i)=>({at:1000+i*5000,events:[{type:i%2?'sale':'alarm',enemy:'e',untilTick:0,eventId:i+1}]}))];
  assert.deepEqual(run(steps,undefined,42),run(steps,undefined,42));
  assert.notDeepEqual(run(steps,undefined,42).map(s=>s.text),run(steps,undefined,43).map(s=>s.text));
  // The objective gone (undefined view) forgets the run: a new run's first view says nothing, its end speaks again.
  const talk=new ChaveiroTalk(1);
  talk.push(view('anda'),[],1,0);talk.push(view('anda',{ended:'victory'}),[],2,100);
  assert.equal(talk.take(100)?.event,'conector');
  talk.push(undefined,[],3,200);talk.result({cause:'opened',debt:0},250);assert.equal(talk.take(300),undefined);
  talk.push(view('morta'),[],4,400);assert.equal(talk.take(500),undefined);
  talk.push(view('abrindo',{ended:'victory',grana:1,budget:9}),[],5,600);assert.equal(talk.take(700)?.event,'divida');
});

test('falas: the sandbox fires its fake moments once each, FALA_EVERY_MS apart',()=>{
  const params=new URLSearchParams('fala=alarme,venda,peca,nada');
  assert.deepEqual(fakeTalkEvents(params,0,FALA_AT_MS-1),[]);
  assert.deepEqual(fakeTalkEvents(params,FALA_AT_MS-1,FALA_AT_MS).map(e=>e.type),['alarm']);
  assert.deepEqual(fakeTalkEvents(params,FALA_AT_MS,FALA_AT_MS+2*FALA_EVERY_MS).map(e=>e.type),['sale','part']);
  assert.ok(FALA_EVERY_MS>=LINE_GAP_MS);
  assert.deepEqual(fakeTalkEvents(params,0,1e6).map(e=>eventMoment(e)),['volta','sale','part']);
});

test('falas: the Tio speaks from a fixed point beside the car, off its body and apart from the alarm over the roof',()=>{
  assert.ok(TIO_SPOT.fwd>CAR_HALF.l&&TIO_SPOT.left>CAR_HALF.w); // a corner just off the car's body
  assert.ok(TIO_SPOT.top>CAR_TOP); // a standing head over the roof line, like the hero's
  const car={x:10,y:20};
  for(let view=0;view<4;view++){
    const p=tioSpot(car,view),dx=p.x-car.x,dy=p.y-car.y;
    // Outside the footprint, at a corner; the same point every frame of a view (fixed, not following anyone).
    assert.ok(Math.abs(dx)>CAR_HALF.l&&Math.abs(dy)>CAR_HALF.w,`view ${view}`);
    assert.deepEqual(tioSpot(car,view),p);
    // The corner nearest the viewer (lowest on screen of the four), so it is never far out to the side.
    for(const [cx,cy] of [[1,1],[1,-1],[-1,1],[-1,-1]])assert.ok(isoOffset(dx,dy,0,view).y>=isoOffset(cx*TIO_SPOT.fwd,cy*TIO_SPOT.left,0,view).y-1e-9);
    assert.ok(Math.abs(isoOffset(dx,dy,0,view).x)<Math.abs(isoOffset(TIO_SPOT.fwd,-TIO_SPOT.left,0,0).x));
    // The balloon tails (Tio's head vs the roof's centre, where the alarm speaks) are apart on screen: > 40 world px.
    const tio=isoOffset(dx,dy,TIO_SPOT.top,view),roof=isoOffset(0,0,CAR_TOP,view);
    assert.ok(Math.hypot(tio.x-roof.x,tio.y-roof.y)>40,`view ${view}: ${Math.hypot(tio.x-roof.x,tio.y-roof.y)}`);
  }
  // D-052: the car turns as it moves; the Tio keeps to one of its corners, still off its turned body.
  for(let view=0;view<4;view++)for(let k=0;k<16;k++){
    const h=k/16*Math.PI*2,p=tioSpot(car,view,h),dx=p.x-car.x,dy=p.y-car.y;
    const fwd=dx*Math.cos(h)+dy*Math.sin(h),left=-dx*Math.sin(h)+dy*Math.cos(h);
    assert.ok(Math.abs(Math.abs(fwd)-TIO_SPOT.fwd)<1e-9&&Math.abs(Math.abs(left)-TIO_SPOT.left)<1e-9,`view ${view} heading ${k}`);
    for(const [cx,cy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
      const f=cx*TIO_SPOT.fwd,l=cy*TIO_SPOT.left;
      assert.ok(isoOffset(dx,dy,0,view).y>=isoOffset(f*Math.cos(h)-l*Math.sin(h),f*Math.sin(h)+l*Math.cos(h),0,view).y-1e-9);
    }
  }
  assert.deepEqual(tioSpot(car,2,0),tioSpot(car,2));
});
