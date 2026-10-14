/**
 * Art cache (NEW-20261013-ORQ-3g-precarga-partida): the build's per-file versions (scripts/art-versions.mjs) and the
 * service worker's pure decisions (public/sw.js, run here with a stub `self`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
// @ts-expect-error plain ESM build helper without typings
import {artVersions,writeArtVersions,shortHash,artVersionsPlugin} from '../../scripts/art-versions.mjs';

test('versions: 8 hex of the content per public path, under /art and /assets only; written to dist/art-versions.json',()=>{
  const dist=mkdtempSync(join(tmpdir(),'art-versions-'));
  try{
    mkdirSync(join(dist,'art','lite','sprites'),{recursive:true});mkdirSync(join(dist,'assets'));
    writeFileSync(join(dist,'art','lite','sprites','a.webp'),'one');
    writeFileSync(join(dist,'art','manifest.json'),'{}');
    writeFileSync(join(dist,'assets','index-abc.js'),'js');
    mkdirSync(join(dist,'audio'));writeFileSync(join(dist,'audio','boss.webm'),'opus');
    writeFileSync(join(dist,'index.html'),'<html>');
    const map=artVersions(dist);
    assert.deepEqual(Object.keys(map),['/art/lite/sprites/a.webp','/art/manifest.json','/assets/index-abc.js','/audio/boss.webm']);
    assert.equal(map['/art/lite/sprites/a.webp'],shortHash('one'));
    assert.match(shortHash('one'),/^[0-9a-f]{8}$/);
    assert.notEqual(shortHash('one'),shortHash('two'));
    writeArtVersions(dist);
    assert.deepEqual(JSON.parse(readFileSync(join(dist,'art-versions.json'),'utf8')),map);
    const plugin=artVersionsPlugin();
    assert.equal(plugin.apply,'build');
    plugin.configResolved({root:dist,build:{outDir:'.'}});
    rmSync(join(dist,'art-versions.json'));plugin.closeBundle();
    assert.deepEqual(JSON.parse(readFileSync(join(dist,'art-versions.json'),'utf8')),map);
  }finally{rmSync(dist,{recursive:true,force:true});}
});

interface Sw {route(r:{method:string;url:string;range?:boolean},origin:string):string;fresh(path:string,stored:string|null,versions?:Record<string,string>):boolean;storable(r:unknown):boolean}
function loadSw():{sw:Sw;events:string[]}{
  const events:string[]=[];
  const self:Record<string,unknown>={addEventListener:(name:string)=>events.push(name)};
  new Function('self',readFileSync('public/sw.js','utf8'))(self);
  return {sw:self.__viagemSw as Sw,events};
}

test('service worker: only same-origin GETs of /art and /assets go through the cache',()=>{
  const {sw,events}=loadSw();
  assert.deepEqual(events.sort(),['activate','fetch','install']);
  const o='https://viagem.example';
  assert.equal(sw.route({method:'GET',url:`${o}/art/lite/sprites/a.webp`},o),'cache');
  assert.equal(sw.route({method:'GET',url:`${o}/assets/index-abc.js`},o),'cache');
  assert.equal(sw.route({method:'GET',url:`${o}/audio/boss.webm`},o),'cache');
  for(const r of [
    {method:'POST',url:`${o}/art/a.webp`},
    {method:'GET',url:`${o}/art/a.webp`,range:true},
    {method:'GET',url:`${o}/audio/boss.webm`,range:true},
    {method:'GET',url:`${o}/multiplayer.json`},
    {method:'GET',url:`${o}/version.json`},
    {method:'GET',url:`${o}/`},
    {method:'GET',url:`${o}/art/a.webp?x=1`},
    {method:'GET',url:'https://salas.example/rooms'},
    {method:'GET',url:'https://outro.example/art/a.webp'},
    {method:'GET',url:'not a url'},
  ])assert.equal(sw.route(r,o),'network',JSON.stringify(r));
});

test('service worker: a stored copy is served only at the current version',()=>{
  const {sw}=loadSw();
  const v={'/art/a.webp':'aaaa1111','/assets/x.js':'bbbb2222'};
  assert.equal(sw.fresh('/art/a.webp','aaaa1111',v),true);
  assert.equal(sw.fresh('/art/a.webp','00000000',v),false,'changed in a new deploy: downloaded again');
  assert.equal(sw.fresh('/art/a.webp',null,v),false,'nothing stored');
  assert.equal(sw.fresh('/art/new.webp','-',v),false,'unknown art is not trusted');
  assert.equal(sw.fresh('/art/a.webp','aaaa1111',undefined),false,'no versions file: art goes to the network');
  assert.equal(sw.fresh('/assets/y.js','-',undefined),true,'hashed chunk names never change content');
  assert.equal(sw.storable({type:'basic',status:200}),true);
  for(const r of [{type:'opaque',status:0},{type:'basic',status:404},{type:'basic',status:206},{type:'cors',status:200},undefined])assert.equal(sw.storable(r),false,JSON.stringify(r));
});
