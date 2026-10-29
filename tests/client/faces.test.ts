/**
 * Face avatars on the client (src/client/art/faces.ts): key format, URL of an imported face, fallback to the `normal`
 * face for a missing expression, null for a class without any face, loads only what exists, and an empty manifest
 * queueing nothing.
 */
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {setArtIndex,parseArtIndex} from '../../src/client/art/manifest.ts';
import {FACE_EXPRESSIONS,FACE_GROUP,faceKey,faceUrl,faceLoads,queueFaceTextures,resolveFaceKey} from '../../src/client/art/faces.ts';

afterEach(()=>setArtIndex(parseArtIndex({version:2,groups:{}})));

const face=(id:string)=>({kind:'icon',files:{sheet:{file:`${id}.webp`,cell:[256,256],frames:1}},meta:{}});
const load=(ids:string[])=>setArtIndex(parseArtIndex({version:2,groups:{
  rostos:{output:'public/art/rostos',pieces:Object.fromEntries(ids.map(id=>[id,face(id)]))},
}}));
/** A scene stub: records loads, knows the textures in `loaded`. */
const scene=(loaded:string[]=[])=>{
  const queued:[string,string][]=[];
  return {queued,scene:{textures:{exists:(k:string)=>loaded.includes(k)},load:{image:(k:string,u:string)=>{queued.push([k,u]);}}} as any};
};

test('expressions and key format',()=>{
  assert.deepEqual([...FACE_EXPRESSIONS],['normal','ferido','caido','rindo','bravo']);
  assert.equal(FACE_GROUP,'rostos');
  assert.equal(faceKey('cidadao-comum','rindo'),'rosto:cidadao-comum:rindo');
  assert.equal(faceKey('mendigo','normal'),'rosto:mendigo:normal');
});

test('faceUrl: the imported file; a missing expression falls back to normal; null without any face',()=>{
  load(['cidadao-comum-normal','cidadao-comum-rindo','mendigo-normal','streamer-bravo']);
  assert.equal(faceUrl('cidadao-comum','rindo'),'/art/rostos/cidadao-comum-rindo.webp');
  assert.equal(faceUrl('cidadao-comum'),'/art/rostos/cidadao-comum-normal.webp');
  assert.equal(faceUrl('cidadao-comum','ferido'),'/art/rostos/cidadao-comum-normal.webp');
  assert.equal(faceUrl('mendigo','caido'),'/art/rostos/mendigo-normal.webp');
  assert.equal(faceUrl('motogirl','normal'),null);
  assert.equal(faceUrl('motogirl','rindo'),null);
  // Only a non-normal face: that expression shows, the others have nothing to fall back to.
  assert.equal(faceUrl('streamer','bravo'),'/art/rostos/streamer-bravo.webp');
  assert.equal(faceUrl('streamer','rindo'),null);
});

test('faceLoads / queueFaceTextures: only delivered faces of playable classes, under rosto:<id>:<expr>; already-loaded keys skipped',()=>{
  load(['maromba-normal','maromba-rindo','clt-cansado-normal','mendigo-normal','cidadao-comum-normal','palhaco-normal']);
  assert.deepEqual(faceLoads(),[
    {key:'rosto:clt-cansado:normal',url:'/art/rostos/clt-cansado-normal.webp'},
    {key:'rosto:maromba:normal',url:'/art/rostos/maromba-normal.webp'},
    {key:'rosto:maromba:rindo',url:'/art/rostos/maromba-rindo.webp'},
  ],'a legacy hero (the Mendigo, the Cidadão) or a piece outside the class catalog is never loaded');
  const s=scene(['rosto:clt-cansado:normal']);
  assert.equal(queueFaceTextures(s.scene),2);
  assert.deepEqual(s.queued.map(q=>q[0]),['rosto:maromba:normal','rosto:maromba:rindo']);
});

test('resolveFaceKey: the loaded key, else the normal key, else null',()=>{
  const textures={exists:(k:string)=>['rosto:cidadao-comum:normal','rosto:cidadao-comum:rindo','rosto:streamer:bravo'].includes(k)};
  assert.equal(resolveFaceKey(textures,'cidadao-comum','rindo'),'rosto:cidadao-comum:rindo');
  assert.equal(resolveFaceKey(textures,'cidadao-comum','caido'),'rosto:cidadao-comum:normal');
  assert.equal(resolveFaceKey(textures,'cidadao-comum'),'rosto:cidadao-comum:normal');
  assert.equal(resolveFaceKey(textures,'mendigo','normal'),null);
  assert.equal(resolveFaceKey(textures,'streamer','ferido'),null);
});

test('empty manifest: no URL, no load, nothing queued',()=>{
  assert.equal(faceUrl('cidadao-comum'),null);
  assert.deepEqual(faceLoads(),[]);
  const s=scene();
  assert.equal(queueFaceTextures(s.scene),0);
  assert.deepEqual(s.queued,[]);
});
