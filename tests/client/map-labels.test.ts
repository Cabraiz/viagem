import test from 'node:test';
import assert from 'node:assert/strict';
import {LABEL_BORDER_CSS,LABEL_CSS,LABEL_STACK_GAP_CSS,allyLabelText,plateRings,ringReachCss,stackedLabelOffsetCss,labelScale,mapLabelVisible,placeYieldsToSos,railName,shortName} from '../../src/client/render/map-label-rules.ts';

test('place names leave the screen during a wave; ally names stay before the run and for who is caído',()=>{
  for(const phase of [undefined,'lobby','countdown','interval','result'])assert.equal(mapLabelVisible('place',phase),true,String(phase));
  assert.equal(mapLabelVisible('place','combat'),false);
  for(const phase of [undefined,'lobby','countdown'])assert.equal(mapLabelVisible('ally',phase),true,String(phase));
  for(const phase of ['combat','interval','result'])assert.equal(mapLabelVisible('ally',phase),false,phase);
  for(const phase of ['combat','interval'])assert.equal(mapLabelVisible('ally',phase,true),true,phase);
});

test('ally fichas use one glossary word, no "A · B", and long names are cut',()=>{
  assert.equal(allyLabelText('Zé',{}),'Zé');
  // Caído: rail name and seconds (the SOS tag says caído), same name as the team rail.
  assert.equal(allyLabelText('Zé',{downed:true},18),'Zé, 18 s');
  assert.equal(allyLabelText('Zé',{downed:true}),'Zé');
  assert.equal(allyLabelText('Zé',{eliminated:true,downed:true}),'Zé, fora');
  assert.equal(allyLabelText('Zé',{spectator:true}),'Zé, assistindo');
  assert.equal(allyLabelText('Zé',{online:false}),'Zé, voltando');
  const long=allyLabelText('Tia da Festa Junina',{downed:true},6);
  assert.ok(!long.includes('·')&&!long.includes('♥'));
  assert.equal(long,'Tia, 6 s');
  // NEW-20261009-N5-resultado-nomes-longos: the first word whole up to 11 letters, else 7 and a dot (never cut unmarked).
  assert.equal(railName('Concurseira Eterna'),'Concurseira');assert.equal(railName('Washington Luís'),'Washington');
  assert.equal(railName('Maximilianos Neto'),'Maximil.');assert.equal(railName('  Zé  do Pix'),'Zé');
  for(const name of ['Concurseira Eterna da Silva','Maximilianos','Wwwwwwwwwwwwwwwwwwww','😀'.repeat(14)]){
    const r=[...railName(name)],first=[...name.trim().split(/\s+/)[0]];
    assert.ok(r.length<=11,name);assert.ok(r.join('')===first.join('')||r.at(-1)==='.',`${name}: cut without a mark`);
  }
  assert.equal(allyLabelText('Tia da Festa Junina',{spectator:true}),'Tia da Fest…, assistindo');
  assert.equal(shortName('Maria Aparecida dos Santos'),'Maria Aparecida…');
  assert.equal([...shortName('Maria Aparecida dos Santos')].length<=16,true);
  assert.equal(shortName('  Rainha da Bateria '),'Rainha da Bater…');assert.equal(shortName(' Zé do Pix '),'Zé do Pix');
});

test('fichas keep 13 px CSS at any zoom (the whole-island zoom made the old labels ~4 px)',()=>{
  for(const zoom of [.26,.5,1,2])assert.ok(Math.abs(LABEL_CSS*labelScale(zoom)*zoom-13)<1e-9,String(zoom));
  assert.ok(Number.isFinite(labelScale(0)));
});

test('place fichas step aside near a caído ficha (160 px CSS)',()=>{
  assert.equal(placeYieldsToSos({x:100,y:100},[{x:200,y:180}]),true);
  assert.equal(placeYieldsToSos({x:100,y:100},[{x:300,y:100}]),false);
  assert.equal(placeYieldsToSos({x:100,y:100},[]),false);
});

test('a stacked ficha clears the ring of the one above it plus a gap (item 12)',()=>{
  for(const city of [false,true])for(const sos of [false,true]){
    const reach=Math.max(0,...plateRings(sos,city).map(r=>(r.out+.5)*LABEL_BORDER_CSS));
    assert.equal(ringReachCss(sos,city),reach);
    assert.equal(stackedLabelOffsetCss(20,sos,city),20+reach+ringReachCss(false,city)+LABEL_STACK_GAP_CSS);
  }
  assert.ok(ringReachCss(true,true)>=ringReachCss(false,true),'the SOS ring reaches at least as far');
  assert.ok(stackedLabelOffsetCss(20,true,true)>20+LABEL_STACK_GAP_CSS);
});
