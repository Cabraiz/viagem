/**
 * NEW-20261030-ORQ-sons-nos-eventos (auditoria-sons-30-10, P2): the silent events get their sound. A bicho's hit and a
 * melee wind-up are 'bicho-ataque', the saci whistles, the sanfoneiro plays, the chaveiro arrives, my PIX is a short
 * caca-niquel, a magnet is the 'ima'; bicho-ataque and the PIX are capped per second; the run's end plays its stinger
 * once. Legacy (hidden) kinds and hazards stay as they were. Only the active cast: mendigo, aberracao-saci, sanfoneiro.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type {SimEvent} from '../../src/contract/index.ts';
import type {SoundId} from '../../src/client/audio/types.ts';
import {GemCombo} from '../../src/client/audio/recipes.ts';
import {cueForEvent,playEvents,rateGates,RateGate,WarnGate,PIX_CUE,PER_SECOND,SACI_KIND,WARN_RANGE,WARN_PAN,
  type EventWorld} from '../../src/client/audio/events.ts';
import {GameMusic,STINGER,musicCue,type MusicEngine} from '../../src/client/audio/music.ts';
import type {RunView} from '../../src/contract/view.ts';

const ME='p1';
const ENEMIES:Record<string,{kind:string;x:number;y:number;boss?:boolean}>={
  m1:{kind:'mendigo',x:3,y:0},sa:{kind:SACI_KIND,x:-3,y:0},sf:{kind:'sanfoneiro',x:6,y:0},
  // Hidden legacy kinds and the boss: no attack sound of their own.
  lg:{kind:'agiota',x:1,y:0},bo:{kind:'chefe',x:2,y:0,boss:true},far:{kind:'sanfoneiro',x:WARN_RANGE+5,y:0},
};
const TELEGRAPHS:Record<string,{x:number;y:number;kind?:string}>={
  pa:{x:2,y:0,kind:'pancada'},iv:{x:-2,y:0,kind:'investida'},va:{x:0,y:2,kind:'varredura'},
  mo:{x:2,y:0,kind:'molotov'},ar:{x:2,y:0,kind:'arroto'},cb:{x:2,y:0,kind:'carimbo'},
};
const world:EventWorld={hero:{x:0,y:0},side:p=>Math.sign(p.x),enemy:id=>ENEMIES[id],telegraph:id=>TELEGRAPHS[id]};
const cue=(event:SimEvent,w:EventWorld|null=world)=>cueForEvent(event,ME,undefined,w??undefined);
const hit=(source:string):SimEvent=>({type:'damage',target:ME,amount:2,source});

function rig(){
  let now=0;const calls:[SoundId,Record<string,unknown>][]=[];const warn=new WarnGate(),rates=rateGates();
  const play=(events:SimEvent[])=>playEvents({play:(id,opts)=>{calls.push([id,{...opts}]);return true;}},events,ME,
    undefined,undefined,{gems:new GemCombo(),warn,rates,now:()=>now},world);
  const ids=()=>calls.map(c=>c[0]);
  return {calls,ids,play,at:(ms:number)=>{now=ms;}};
}

test("a bicho's hit on me: the hurt with bicho-ataque; the saci's whistles; the boss and unknown sources only hurt",()=>{
  assert.deepEqual(cue(hit('m1')),{id:'dano-heroi',with:{id:'bicho-ataque'}});
  assert.deepEqual(cue(hit('sf')),{id:'dano-heroi',with:{id:'bicho-ataque'}},'the sanfoneiro is a bicho too');
  assert.deepEqual(cue(hit('sa')),{id:'dano-heroi',with:{id:'saci-assobio'}});
  assert.deepEqual(cue(hit('bo')),{id:'dano-heroi'},'the boss has his own sounds');
  assert.deepEqual(cue(hit('gone')),{id:'dano-heroi'},'not in the feed (a hazard, gone)');
  assert.deepEqual(cue(hit('m1'),null),{id:'dano-heroi'},'no world: as before');
  assert.equal(cue({type:'damage',target:'p2',amount:2,source:'m1'}),undefined,"a teammate's hurt: silent");
});

test('a legacy kind never whistles: only the saci kind does',()=>{
  assert.equal(cue(hit('lg'))!.with!.id,'bicho-ataque');
  for(const id of ['m1','sf','lg'])assert.notEqual(cue(hit(id))!.with?.id,'saci-assobio',id);
});

test('a melee wind-up is bicho-ataque from its side; legacy hazards keep the old warning',()=>{
  const pa=cue({type:'telegraph',telegraph:'pa'})!;
  assert.equal(pa.id,'bicho-ataque');assert.equal(pa.pan,WARN_PAN);assert.ok(pa.gain!<1&&pa.gain!>0);
  assert.equal(cue({type:'telegraph',telegraph:'iv'})!.pan,-WARN_PAN);
  assert.equal(cue({type:'telegraph',telegraph:'va'})!.id,'bicho-ataque');
  for(const t of ['mo','ar','cb'])assert.equal(cue({type:'telegraph',telegraph:t})!.id,'chefe-passo',t);
  assert.equal(cue({type:'telegraph',telegraph:'out-of-view'}),undefined);
});

test("the sanfoneiro's playing is 'sanfona' from his side; his warning and his stop are silent; far away, none",()=>{
  const toca=cue({type:'sanfona',enemy:'sf',what:'toca'})!;
  assert.equal(toca.id,'sanfona');assert.equal(toca.pan,WARN_PAN);
  assert.equal(cue({type:'sanfona',enemy:'sf',what:'aviso'}),undefined);
  assert.equal(cue({type:'sanfona',enemy:'sf',what:'para'}),undefined);
  assert.equal(cue({type:'sanfona',enemy:'far',what:'toca'}),undefined);
  assert.equal(cue({type:'sanfona',enemy:'gone',what:'toca'}),undefined,'not in the feed');
  assert.deepEqual(cue({type:'sanfona',enemy:'sf',what:'toca'},null),{id:'sanfona'},'no world: plain');
});

test("the chaveiro's arrival is chaveiro-chega for everyone; his other moments stay silent",()=>{
  assert.deepEqual(cue({type:'moto',mode:'chegou'}),{id:'chaveiro-chega'});
  assert.deepEqual(cueForEvent({type:'moto',mode:'chegou'}),{id:'chaveiro-chega'},'a spectator too');
  for(const mode of ['morta','tranco','lombada','entrega','tombo','volta','abrindo'] as const)
    assert.equal(cue({type:'moto',mode}),undefined,mode);
});

test('my PIX, sent or got, is a short caca-niquel; a PIX between others is silent',()=>{
  assert.deepEqual(cue({type:'pix',from:ME,to:'p2',amount:10,memo:0}),PIX_CUE);
  assert.deepEqual(cue({type:'pix',from:'p2',to:ME,amount:10,memo:0}),PIX_CUE);
  assert.ok(PIX_CUE.rate>1&&PIX_CUE.gain<1,'shorter (higher) and quieter than the jackpot');
  assert.equal(cue({type:'pix',from:'p2',to:'p3',amount:10,memo:0}),undefined);
});

test("a magnet is the 'ima', never the gema; a cédula still clinks",()=>{
  const magnet={type:'pickup',player:ME,pickup:'k1',kind:'magnet',value:0} as unknown as SimEvent;
  assert.equal(cue(magnet)!.id,'ima');
  assert.equal(cue({type:'pickup',player:ME,pickup:'k2',kind:'grana',value:1})!.id,'gema');
  assert.equal(cue({...magnet,player:'p2'} as SimEvent),undefined,"another's magnet");
});

test('rate limit: at most PER_SECOND bicho-ataque and PIX per second; the hurt under a capped attack still plays',()=>{
  const r=rig(),n=PER_SECOND['bicho-ataque']!,p=PER_SECOND['caca-niquel']!;
  r.play(Array.from({length:n+5},()=>hit('m1')));
  assert.equal(r.ids().filter(id=>id==='bicho-ataque').length,n);
  assert.equal(r.ids().filter(id=>id==='dano-heroi').length,n+5);
  r.play(Array.from({length:p+4},()=>({type:'pix',from:ME,to:'p2',amount:1,memo:0}) as SimEvent));
  assert.equal(r.ids().filter(id=>id==='caca-niquel').length,p);
  r.at(999);r.play([hit('m1'),{type:'telegraph',telegraph:'pa'}]);
  assert.equal(r.ids().filter(id=>id==='bicho-ataque').length,n,'still inside the second');
  r.at(1000);r.play([hit('m1'),{type:'telegraph',telegraph:'pa'}]);
  assert.equal(r.ids().filter(id=>id==='bicho-ataque').length,n+2,'a new second');
  const gate=new RateGate(2);
  assert.deepEqual([0,10,20,1000,1010,1011].map(t=>gate.open(t)),[true,true,false,true,true,false]);
});

test("a melee wind-up does not eat the danger warning's slot",()=>{
  const r=rig();
  r.play([{type:'telegraph',telegraph:'pa'},{type:'spawn-warning',x:1,y:0,members:['m1'],group:0} as unknown as SimEvent]);
  assert.deepEqual(r.ids(),['bicho-ataque','chefe-passo']);
});

class StingEngine implements MusicEngine {
  unlocked=false;context=undefined;musicOutput=undefined;settings={music:{volume:.7,muted:false}};
  played:SoundId[]=[];
  onChange(){return ()=>{};}
  attachUnlock(){return ()=>{};}
  play(id:SoundId){this.played.push(id);return true;}
}

test('the stinger: vitoria or derrota once per run, with the fade, even without music files',()=>{
  for(const outcome of ['victory','defeat'] as const){
    const engine=new StingEngine();
    const music=new GameMusic({engine,createElement:()=>undefined,sources:{boss:null,theme:null}});
    music.update({boss:false,round:3});
    assert.deepEqual(engine.played,[]);
    music.update({boss:false,ended:true});
    assert.deepEqual(engine.played,[],'the result screen\'s cue does not say how');
    music.update({boss:false,ended:true,outcome});
    music.update({boss:false,ended:true,outcome});
    music.update({boss:false,ended:true});
    assert.deepEqual(engine.played,[STINGER[outcome]],'once');
    music.update({boss:false,round:1});music.update({boss:false,ended:true,outcome:'defeat'});
    assert.deepEqual(engine.played,[STINGER[outcome],'derrota'],'a new run, a new stinger');
    music.dispose();music.update({boss:false,round:1});music.update({boss:false,ended:true,outcome});
    assert.equal(engine.played.length,2,'disposed: silent');
  }
  assert.deepEqual(STINGER,{victory:'vitoria',defeat:'derrota'});
});

test("the view's outcome reaches the cue; an engine without play has no stinger",()=>{
  const view={round:{index:4},enemies:[],objective:{etaS:0,ended:'defeat'}} as unknown as RunView;
  assert.equal(musicCue(view,false).outcome,'defeat');
  assert.equal(musicCue({...view,objective:{etaS:30}} as unknown as RunView,true).outcome,undefined);
  const {play:_,...silent}=new StingEngine();
  const music=new GameMusic({engine:silent as unknown as MusicEngine,createElement:()=>undefined,sources:{boss:null,theme:null}});
  assert.doesNotThrow(()=>music.update({boss:false,ended:true,outcome:'victory'}));
});
