import test from 'node:test';
import assert from 'node:assert/strict';
import {FEAR_ALPHA,FEAR_ARROW_SECONDS,FEAR_HOLE,FEAR_SAY_MS,FEAR_SAY_TEXT,FEAR_WARN_MS,FEAR_WARN_TEXT,FearClock,fearBpm,fearLook,heartPulse,safeSpots} from '../../src/client/render/fear-rules.ts';
import {BEAT_LEVEL,WHISPER_MAX,beatLevel,heartbeatSamples,whisperLevel,whisperSamples} from '../../src/client/audio/fear-sound.ts';
import {causeCopy,DARK_COPY} from '../../src/client/hud/cause.ts';
import {FEAR_ALLY_RADIUS,FEAR_BASE_RADIUS,FEAR_FINAL_SECONDS,FEAR_SECONDS,FEAR_SHOW_SECONDS,FEAR_SOURCE} from '../../src/rules/index.ts';

const fearAt=(seconds:number)=>seconds/FEAR_SECONDS;
/** Steps a clock through `seconds` of wire values at 60 fps from `from` (s alone) going up or down. */
function run(clock:FearClock,from:number,to:number,seconds:number,startMs=0){
  const frames=Math.round(seconds*60),out=[];
  for(let i=1;i<=frames;i++){const s=from+(to-from)*i/frames;out.push(clock.step(fearAt(s),1000/60,startMs+i*1000/60));}
  return out;
}

test('the dark: nothing before FEAR_SHOW_SECONDS, then it thickens and the clear circle shrinks to the end',()=>{
  assert.equal(fearLook(0).alpha,0);
  assert.equal(fearLook(FEAR_SHOW_SECONDS).alpha,0);
  let last=fearLook(FEAR_SHOW_SECONDS+.01);
  assert.ok(last.alpha>0&&last.alpha<.05,'fades in, no pop');
  for(let s=FEAR_SHOW_SECONDS+.5;s<=FEAR_SECONDS;s+=.5){
    const look=fearLook(s);
    assert.ok(look.alpha>=last.alpha-1e-9,`alpha grows at ${s}`);
    assert.ok(look.hole<=last.hole+1e-9,`hole shrinks at ${s}`);
    last=look;
  }
  assert.ok(Math.abs(fearLook(FEAR_SHOW_SECONDS+1).hole-FEAR_HOLE.start)<.01,'starts at the edges only');
  const finalAt=FEAR_SECONDS-FEAR_FINAL_SECONDS;
  assert.equal(fearLook(finalAt-.01).final,0);
  assert.ok(Math.abs(fearLook(finalAt).hole-FEAR_HOLE.final)<1e-9);
  assert.ok(Math.abs(fearLook(FEAR_SECONDS).hole-FEAR_HOLE.end)<1e-9);
  assert.ok(Math.abs(fearLook(FEAR_SECONDS).alpha-FEAR_ALPHA.end)<1e-9);
  assert.equal(fearLook(FEAR_SECONDS).final,1);
});

test('the heartbeat: lub then a softer dub, faster toward the end',()=>{
  assert.ok(heartPulse(0)>.99);
  assert.ok(heartPulse(.15)<.1,'quiet between');
  const dub=heartPulse(.28);assert.ok(dub>.5&&dub<heartPulse(0));
  assert.ok(heartPulse(.9)<.01);
  assert.ok(Math.abs(heartPulse(1.28)-dub)<1e-9,'periodic');
  assert.ok(fearBpm(1)>fearBpm(0));
});

test('the clock: the first beat as the last stretch starts, one per period after, none with company',()=>{
  const clock=new FearClock(),finalAt=FEAR_SECONDS-FEAR_FINAL_SECONDS;
  const before=run(clock,0,finalAt-.05,10);
  assert.ok(before.every(f=>!f.thump&&f.beat===0));
  const last=run(clock,finalAt-.05,FEAR_SECONDS-.05,FEAR_FINAL_SECONDS);
  const beats=last.filter(f=>f.thump).length;
  // Between 72 and 140 bpm over ~10 s: 12 to 24 beats.
  assert.ok(beats>=12&&beats<=24,`beats ${beats}`);
  assert.ok(last.some(f=>f.beat>.5));
  // Reduced motion: the sound still beats, the circle stays.
  const calm=new FearClock(),frames=[];
  for(let i=0;i<120;i++)frames.push(calm.step(fearAt(finalAt+i/60),1000/60,i*16,true));
  assert.ok(frames.some(f=>f.thump)&&frames.every(f=>f.beat===0));
});

test('the arrow and the notice: right from the start alone, once; nothing on top over the last stretch',()=>{
  const clock=new FearClock();
  const early=run(clock,0,FEAR_ARROW_SECONDS-.1,FEAR_ARROW_SECONDS-.1);
  assert.ok(early.every(f=>!f.alone),'not in the first second');
  const alone=run(clock,FEAR_ARROW_SECONDS-.1,FEAR_SHOW_SECONDS,2,1000);
  assert.ok(alone.at(-1)!.alone,'the arrow shows before the dark');
  assert.equal(alone.at(-1)!.notice?.text,FEAR_WARN_TEXT);
  // The notice goes after FEAR_WARN_MS, the arrow stays while it grows.
  const later=run(clock,FEAR_SHOW_SECONDS,20,FEAR_WARN_MS/1000+1,3000);
  assert.equal(later.at(-1)!.notice,undefined);
  assert.ok(later.at(-1)!.alone);
  // Company: the dark backs off (30×): the arrow goes at once.
  const back=run(clock,20,10,.5,9000);
  assert.ok(back.every(f=>!f.alone));
  // Alone again: no second "Não se afaste" in the same run…
  const again=run(clock,10,20,2,10000);
  assert.ok(again.every(f=>f.notice===undefined));
  // …nor on top over the last stretch (card heroi-fala-cade-amigos: the hero says it in a balloon).
  const end=run(clock,20,FEAR_SECONDS-1,5,13000);
  assert.ok(end.every(f=>f.notice===undefined));
  // A new run: the first notice again.
  clock.reset();
  const next=run(clock,0,2,2,60000);
  assert.equal(next.at(-1)!.notice?.text,FEAR_WARN_TEXT);
});

test('card heroi-fala-cade-amigos: over the last stretch the hero says "Cadê meus amigos?" once, the top stays clean',()=>{
  assert.ok(FEAR_SAY_TEXT.length<=20,'a short line');
  const finalAt=FEAR_SECONDS-FEAR_FINAL_SECONDS,clock=new FearClock();
  // Alone from the start to the full dark (it never takes anyone: it stays there), well past the first notice.
  const before=run(clock,0,finalAt-1,finalAt-1);
  assert.ok(before.every(f=>f.say===undefined),'not before the last stretch');
  const last=[...run(clock,finalAt-1,FEAR_SECONDS,FEAR_FINAL_SECONDS+1,60000),...run(clock,FEAR_SECONDS,FEAR_SECONDS,5,80000)];
  assert.equal(last.filter(f=>f.say!==undefined).length,1,'once');
  assert.equal(last.find(f=>f.say)!.say,FEAR_SAY_TEXT);
  assert.ok(last.every(f=>f.notice===undefined),'no notice on top');
  // The arrow waits while the line is up (it would cross the balloon), then comes back.
  const said=last.findIndex(f=>f.say!==undefined),gap=Math.round(FEAR_SAY_MS*60/1000);
  assert.ok(last.slice(0,said).every(f=>!f.saying)&&last.slice(said,said+gap-1).every(f=>f.saying&&f.alone));
  assert.ok(last.slice(said+gap+1).every(f=>!f.saying),'the arrow comes back');
  // Still alone in the full dark: no second balloon (it waits for company).
  const flat=run(clock,FEAR_SECONDS,FEAR_SECONDS,3,90000);
  assert.ok(flat.every(f=>f.say===undefined));
  // Company found (the dark backs off), then alone again into the last stretch: it is said again, once.
  run(clock,FEAR_SECONDS,10,2,100000);
  const again=run(clock,10,FEAR_SECONDS,FEAR_SECONDS-10,110000);
  assert.equal(again.filter(f=>f.say===FEAR_SAY_TEXT).length,1,'again after company, once');
  // A new run says it again too.
  clock.reset();
  const next=run(clock,0,FEAR_SECONDS,FEAR_SECONDS,200000);
  assert.equal(next.filter(f=>f.say===FEAR_SAY_TEXT).length,1);
});

test('the clock eases the wire and lets go of the dark when company is found',()=>{
  const clock=new FearClock();
  const up=run(clock,0,30,30);
  assert.ok(Math.abs(up.at(-1)!.seconds-30)<1,'follows the wire');
  // The server drops 60 s in 2 s with company; the drawing gets there within a moment.
  const down=run(clock,30,0,1);
  const after=[];for(let i=0;i<30;i++)after.push(clock.step(0,1000/60,2000+i*16));
  assert.equal(after.at(-1)!.seconds,0);
  assert.equal(after.at(-1)!.look.alpha,0);
  assert.ok(down.at(-1)!.seconds<5);
  // Junk on the wire reads as no fear.
  assert.equal(new FearClock().step(Number.NaN,16,0).seconds,0);
});

test('safe spots: allies on their feet within reach and the Uno, nearest edge first, same company as the sim',()=>{
  const me={x:0,y:0};
  const players=[
    {id:'me',x:0,y:0,hp:10},
    {id:'longe',x:40,y:0,hp:10},
    {id:'perto',x:0,y:20,hp:10},
    {id:'caido',x:1,y:0,hp:10,downed:{progress:0,bleedOutTick:9}},
    {id:'fora',x:1,y:1,hp:10,eliminated:true},
    {id:'assiste',x:1,y:2,hp:10,spectator:true},
    {id:'morto',x:2,y:0,hp:0},
    {id:'sem-posicao',hp:10},
  ];
  const spots=safeSpots('me',me,players,{x:16,y:0});
  assert.deepEqual(spots.map(s=>s.id??s.kind),['uno','perto','longe']);
  assert.equal(spots[0].radius,FEAR_BASE_RADIUS);assert.equal(spots[0].gap,16-FEAR_BASE_RADIUS);
  assert.equal(spots[1].radius,FEAR_ALLY_RADIUS);assert.equal(spots[1].gap,20-FEAR_ALLY_RADIUS);
  assert.deepEqual(safeSpots('me',me,[]),[]);
});

test('the sound of the dark: whisper silent until the dark shows and rising to its top; the beat louder at the end',()=>{
  assert.equal(whisperLevel(0),0);
  assert.equal(whisperLevel(FEAR_SHOW_SECONDS),0);
  assert.ok(whisperLevel(30)>0&&whisperLevel(30)<whisperLevel(50));
  assert.ok(Math.abs(whisperLevel(FEAR_SECONDS)-WHISPER_MAX)<1e-9);
  assert.equal(beatLevel(0),BEAT_LEVEL.from);assert.equal(beatLevel(1),BEAT_LEVEL.to);
});

test('the synthesized voices: bounded, loop ends at zero, deterministic',()=>{
  const rate=8000,w=whisperSamples(rate);
  assert.equal(w.length,4*rate);
  let peak=0;for(const v of w)peak=Math.max(peak,Math.abs(v));
  assert.ok(peak<=.8+1e-6&&peak>.5,`peak ${peak}`);
  assert.ok(Math.abs(w[0])<.01&&Math.abs(w[w.length-1])<.02,'no click at the seam');
  assert.deepEqual(whisperSamples(rate).slice(0,64),w.slice(0,64));
  const h=heartbeatSamples(rate);
  let hp=0;for(const v of h)hp=Math.max(hp,Math.abs(v));
  assert.ok(hp<=.9&&hp>.3);
  assert.ok(Math.abs(h[0])<.05&&Math.abs(h[h.length-1])<.01);
  // Two thumps: energy right after 0 and after 0.28 s, quiet in between.
  const energy=(a:number,b:number)=>{let e=0;for(let i=Math.round(a*rate);i<Math.round(b*rate);i++)e+=h[i]*h[i];return e/((b-a)*rate);};
  assert.ok(energy(0,.08)>4*energy(.2,.27));
  assert.ok(energy(.28,.36)>4*energy(.2,.27));
});

test('the result names the dark',()=>{
  assert.equal(causeCopy(FEAR_SOURCE),DARK_COPY);
  assert.equal(DARK_COPY.name,'Escuridão');
});

test('a stalled page (one frame every 3 s) still follows the wire: the dark is not stuck seconds behind',()=>{
  const clock=new FearClock();
  let f;
  for(let i=1;i<=3;i++)f=clock.step(fearAt(i*3-1),3000,i*3000);
  assert.ok(Math.abs(f!.seconds-8)<1,`8 s alone drawn as ${f!.seconds}`);
  assert.ok(f!.look.alpha>0,'the dark shows');
});

test('the result\'s embarrassing moment blames the dark, not a critter',async()=>{
  const {shameText}=await import('../../src/client/fun/zueira.ts');
  const early=shameText({key:'cedo',player:'a',round:1,source:FEAR_SOURCE} as Parameters<typeof shameText>[0],'Tia','ninhos');
  assert.match(early.text,/escuridão/);assert.doesNotMatch(early.text,/bicho/);
  const late=shameText({key:'caiu',player:'a',round:3,source:FEAR_SOURCE} as Parameters<typeof shameText>[0],'Tia','onda');
  assert.match(late.text,/escuridão levou na Onda 3/);
  // A critter's fall is unchanged.
  assert.match(shameText({key:'cedo',player:'a',round:1,source:'bebado'} as Parameters<typeof shameText>[0],'Tia','ninhos').text,/Bêbado|bêbado/i);
});
