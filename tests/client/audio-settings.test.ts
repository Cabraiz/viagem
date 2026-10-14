// config-audio-musica-efeitos: the v2 sound settings (Música, Efeitos, vibration), the v1 migration, the mix and the UI texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUS_LABELS,DEFAULT_SETTINGS,LEGACY_SETTINGS_KEY,SETTINGS_KEY,busGain,busQuiet,loadSettings,migrateV1,parseSettingsV2,
  percentText,saveSettings,trackGain,volumeValueText,type AudioSettings,
} from '../../src/client/audio/settings.ts';
import {BOSS_TRACK,THEME_TRACK} from '../../src/client/audio/music.ts';
import {MENU_TRACK} from '../../src/client/audio/menu-music.ts';

function memStorage(){const map=new Map<string,string>();return {map,getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);}};}
const throwing={getItem():string|null{throw new Error('blocked');},setItem(){throw new Error('blocked');}};
const near=(a:number,b:number)=>Math.abs(a-b)<1e-9;

test('keys and defaults',()=>{
  assert.equal(SETTINGS_KEY,'viagem:audio:v2');
  assert.equal(LEGACY_SETTINGS_KEY,'viagem:audio:v1');
  assert.deepEqual(DEFAULT_SETTINGS,{music:{volume:.7,muted:false},effects:{volume:.7,muted:false},vibration:true});
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS)&&Object.isFrozen(DEFAULT_SETTINGS.music)&&Object.isFrozen(DEFAULT_SETTINGS.effects));
  assert.deepEqual(BUS_LABELS,{music:'Música',effects:'Efeitos'});
});

test('v1 -> v2: both buses keep the player level and mute; garbage fields take their defaults',()=>{
  assert.deepEqual(migrateV1({volume:.3,muted:true,vibration:false}),{music:{volume:.3,muted:true},effects:{volume:.3,muted:true},vibration:false});
  assert.deepEqual(migrateV1({volume:0}),{music:{volume:0,muted:false},effects:{volume:0,muted:false},vibration:true});
  assert.deepEqual(migrateV1({volume:9,muted:'yes',vibration:null}),{music:{volume:1,muted:false},effects:{volume:1,muted:false},vibration:true});
  assert.deepEqual(migrateV1({volume:-2}).music.volume,0);
  for(const junk of [null,undefined,42,'x',[],{},{volume:NaN},{volume:'0.5'}])assert.deepEqual(migrateV1(junk),DEFAULT_SETTINGS,String(JSON.stringify(junk)));
});

test('v2 parse: each field on its own, garbage never resets the rest',()=>{
  const full:AudioSettings={music:{volume:.2,muted:true},effects:{volume:.9,muted:false},vibration:false};
  assert.deepEqual(parseSettingsV2(full),full);
  assert.deepEqual(parseSettingsV2({music:{volume:.2},effects:'no',vibration:false}),{music:{volume:.2,muted:false},effects:{...DEFAULT_SETTINGS.effects},vibration:false});
  assert.deepEqual(parseSettingsV2({music:{volume:Infinity,muted:1}}),DEFAULT_SETTINGS);
  for(const junk of [null,7,'x',[],{}])assert.deepEqual(parseSettingsV2(junk),DEFAULT_SETTINGS);
});

test('load: v2 wins; else v1 is migrated and written as v2; else defaults (nothing written)',()=>{
  const v2=memStorage();
  const saved:AudioSettings={music:{volume:.15,muted:false},effects:{volume:.85,muted:true},vibration:true};
  assert.equal(saveSettings(v2,saved),true);
  v2.map.set(LEGACY_SETTINGS_KEY,JSON.stringify({volume:.5}));
  assert.deepEqual(loadSettings(v2),{settings:saved,from:'v2'},'round trip; v1 ignored once v2 exists');

  const v1=memStorage();
  v1.map.set(LEGACY_SETTINGS_KEY,JSON.stringify({volume:.4,muted:false,vibration:false}));
  const migrated=loadSettings(v1);
  assert.equal(migrated.from,'v1');
  assert.deepEqual(migrated.settings,{music:{volume:.4,muted:false},effects:{volume:.4,muted:false},vibration:false});
  assert.deepEqual(JSON.parse(v1.map.get(SETTINGS_KEY)!),migrated.settings,'v2 written');
  assert.ok(v1.map.has(LEGACY_SETTINGS_KEY),'v1 left alone');
  assert.equal(loadSettings(v1).from,'v2','next start reads v2');

  const corruptV1=memStorage();corruptV1.map.set(LEGACY_SETTINGS_KEY,'{oops');
  assert.deepEqual(loadSettings(corruptV1),{settings:DEFAULT_SETTINGS,from:'v1'});

  const corruptV2=memStorage();corruptV2.map.set(SETTINGS_KEY,'nope');corruptV2.map.set(LEGACY_SETTINGS_KEY,JSON.stringify({volume:.1}));
  assert.deepEqual(loadSettings(corruptV2).settings,DEFAULT_SETTINGS,'a broken v2 is still v2');

  const empty=memStorage();
  assert.deepEqual(loadSettings(empty),{settings:DEFAULT_SETTINGS,from:'default'});
  assert.equal(empty.map.size,0);
  const fresh=loadSettings(null).settings;fresh.music.volume=0;
  assert.equal(DEFAULT_SETTINGS.music.volume,.7,'defaults are copied');
});

test('storage that throws: defaults, never an exception',()=>{
  assert.doesNotThrow(()=>loadSettings(throwing));
  assert.deepEqual(loadSettings(throwing).settings,DEFAULT_SETTINGS);
  assert.equal(saveSettings(throwing,DEFAULT_SETTINGS),false);
  assert.equal(saveSettings(null,DEFAULT_SETTINGS),false);
});

test('mix: a track reaches the master at its relative level times the music bus (volume squared); mute is 0',()=>{
  const s=(music:{volume:number;muted:boolean},effects={volume:.7,muted:false}):AudioSettings=>({music,effects,vibration:true});
  assert.equal(MENU_TRACK.level,.35);assert.equal(THEME_TRACK.level,.25);assert.equal(BOSS_TRACK.level,.6);
  assert.ok(near(trackGain(MENU_TRACK.level,s({volume:1,muted:false})),.35));
  assert.ok(near(trackGain(THEME_TRACK.level,s({volume:1,muted:false})),.25));
  assert.ok(near(trackGain(BOSS_TRACK.level,s({volume:.5,muted:false})),.15));
  assert.equal(trackGain(BOSS_TRACK.level,s({volume:1,muted:true})),0);
  // Order between tracks holds at any music volume.
  for(const v of [.1,.5,.9]){const set=s({volume:v,muted:false});assert.ok(trackGain(THEME_TRACK.level,set)<trackGain(MENU_TRACK.level,set)&&trackGain(MENU_TRACK.level,set)<trackGain(BOSS_TRACK.level,set));}
  // The effects bus never enters a track's gain, and the music bus never enters the effects'.
  assert.equal(trackGain(.6,s({volume:.8,muted:false},{volume:0,muted:true})),trackGain(.6,s({volume:.8,muted:false},{volume:1,muted:false})));
  assert.ok(near(busGain({volume:.6,muted:false}),.36));
  assert.equal(busGain({volume:.6,muted:true}),0);
  assert.equal(busQuiet({volume:0,muted:false}),true);assert.equal(busQuiet({volume:.1,muted:true}),true);assert.equal(busQuiet({volume:.1,muted:false}),false);
});

test('UI texts: "60 %", rounding, clamping and the muted value text',()=>{
  assert.equal(percentText(.6),'60 %');
  assert.equal(percentText(0),'0 %');
  assert.equal(percentText(1),'100 %');
  assert.equal(percentText(.456),'46 %');
  assert.equal(percentText(2),'100 %');
  assert.equal(percentText(-1),'0 %');
  assert.equal(percentText(NaN),'0 %');
  assert.equal(volumeValueText({volume:.6,muted:false}),'60 %');
  assert.equal(volumeValueText({volume:.6,muted:true}),'60 %, sem som');
});
