import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAP,MAP_IDS,MAP_TEXT,MAX_SET_MAP_LENGTH,
  checkClientMap,checkJoinMaps,isMapId,isMapRef,parseClientMaps,parseWelcomeMap,playersMissingMap,readMapRef,sameMap,validateSetMap,welcomeMap,
} from '../../src/protocol/map-select.ts';
import type {MapCatalog,MapId,MapRef,RoomPhase,SetMapContext} from '../../src/protocol/map-select.ts';

// ---------- Fixtures ----------
const HASH_A='0123456789abcdef'.repeat(4);
const HASH_B='fedcba9876543210'.repeat(4);
const NEVADA:MapRef={id:'cidade-nevada',version:3,hash:HASH_A};
const INFINITO:MapRef={id:'infinito',version:1,hash:null};

function makeCatalog(...refs:MapRef[]):MapCatalog{
  return new Map(refs.map(r=>[r.id,r] as [MapId,MapRef]));
}
const CATALOG=makeCatalog(NEVADA,INFINITO);

const OWNER='p-owner';
const GUEST='p-guest';

function ctx(over:Partial<SetMapContext>={}):SetMapContext{
  return {rawLength:30,senderId:OWNER,ownerId:OWNER,phase:'lobby',current:INFINITO,catalog:CATALOG,...over};
}
const msg=(map:unknown)=>({t:'setMap',map});
const ALL_TEXTS:string[]=Object.values(MAP_TEXT);

type Result=ReturnType<typeof validateSetMap>;
function refused(r:Result,reason:string):void{
  assert.equal(r.ok,false,`expected refusal '${reason}', got ${JSON.stringify(r)}`);
  if(r.ok)return;
  assert.equal(r.reason,reason);
  assert.equal(typeof r.text,'string');
  assert.ok(r.text.length>0,'refusal text must be non-empty');
}

// Adversarial inputs used by several suites.
const GARBAGE:unknown[]=[
  null,undefined,0,1,-1,NaN,Infinity,'','setMap','{"t":"setMap","map":"infinito"}',true,false,
  [],['setMap','infinito'],[{t:'setMap',map:'infinito'}],{},
  {t:'setMap'},{map:'infinito'},{t:'setmap',map:'infinito'},{t:'SetMap',map:'infinito'},{t:'join',map:'infinito'},
  {t:1,map:'infinito'},{t:null,map:'infinito'},
  {t:'setMap',map:1},{t:'setMap',map:null},{t:'setMap',map:undefined},{t:'setMap',map:['infinito']},
  {t:'setMap',map:{id:'infinito'}},{t:'setMap',map:{id:'infinito',version:1,hash:null}},{t:'setMap',map:true},
  {t:'setMap',map:'infinito',extra:1},{t:'setMap',map:'infinito',hash:HASH_A},
  {t:'setMap',map:'cidade-nevada',version:3,hash:HASH_A},
  JSON.parse('{"__proto__":{"t":"setMap","map":"infinito"}}'),
  JSON.parse('{"__proto__":{"t":"setMap"}}'),
  JSON.parse('{"t":"setMap","map":"infinito","__proto__":{}}'),
  JSON.parse('{"t":"setMap","map":"infinito","constructor":{}}'),
  Object.create({t:'setMap',map:'infinito'}),
  () => ({t:'setMap',map:'infinito'}),
  Symbol('setMap'),
  10n,
  new Date(0),
  new Map([['t','setMap'],['map','infinito']]),
];
const BAD_IDS=['__proto__','constructor','toString','hasOwnProperty','valueOf','prototype','length','0','',
  ' infinito','infinito ','INFINITO','Infinito','cidade_nevada','cidade-nevada\u0000','x'.repeat(10_000)];

// ---------- Constants ----------
test('constants: ids, default, length cap', ()=>{
  assert.deepEqual([...MAP_IDS],['cidade-nevada','infinito']);
  assert.equal(DEFAULT_MAP,'infinito');
  assert.ok(MAP_IDS.includes(DEFAULT_MAP));
  assert.equal(MAX_SET_MAP_LENGTH,128);
  assert.ok(JSON.stringify(msg('cidade-nevada')).length<=MAX_SET_MAP_LENGTH,'a real message fits the cap');
});

test('MAP_TEXT: non-empty, short, pt-BR', ()=>{
  assert.deepEqual(Object.keys(MAP_TEXT).sort(),['lobbyOnly','ownerOnly','unknown','update']);
  for(const [k,v] of Object.entries(MAP_TEXT)){
    assert.equal(typeof v,'string',k);
    assert.ok(v.trim().length>0,`${k} empty`);
    assert.equal(v,v.trim(),`${k} has stray whitespace`);
    assert.ok(v.length<=60,`${k} too long (${v.length})`);
    assert.ok(!/[_{}<>]|undefined|null|TODO/.test(v),`${k} looks like a placeholder: ${v}`);
  }
  // pt-BR: spot-check vocabulary rather than exact copy.
  assert.match(MAP_TEXT.ownerOnly,/sala/i);
  assert.match(MAP_TEXT.lobbyOnly,/partida|começ/i);
  assert.match(MAP_TEXT.unknown,/mapa/i);
  assert.match(MAP_TEXT.update,/atualiz/i);
  assert.equal(new Set(ALL_TEXTS).size,ALL_TEXTS.length,'texts must be distinct');
});

// ---------- isMapId ----------
test('isMapId: own list only, no prototype tricks', ()=>{
  for(const id of MAP_IDS)assert.equal(isMapId(id),true,id);
  for(const id of BAD_IDS)assert.equal(isMapId(id),false,JSON.stringify(id.slice(0,40)));
  for(const v of GARBAGE)assert.equal(isMapId(v),false);
  assert.equal(isMapId(new String('infinito')),false,'boxed string is not an id');
});

// ---------- isMapRef ----------
test('isMapRef: accepts valid refs for both ids', ()=>{
  assert.equal(isMapRef(NEVADA),true);
  assert.equal(isMapRef(INFINITO),true);
  assert.equal(isMapRef({id:'infinito',version:Number.MAX_SAFE_INTEGER,hash:null}),true);
  assert.equal(isMapRef({id:'cidade-nevada',version:1,hash:HASH_B}),true);
  assert.equal(isMapRef(JSON.parse(JSON.stringify(NEVADA))),true);
});

test('isMapRef: rejects bad versions', ()=>{
  for(const version of [0,-1,1.5,NaN,Infinity,-Infinity,'1',null,undefined,2**53,2**53+2,1e300,true,[1],{}]){
    assert.equal(isMapRef({id:'infinito',version,hash:null}),false,`version ${String(version)}`);
    assert.equal(isMapRef({id:'cidade-nevada',version,hash:HASH_A}),false,`version ${String(version)}`);
  }
  assert.equal(isMapRef({id:'infinito',hash:null}),false,'missing version');
});

test('isMapRef: rejects bad hashes', ()=>{
  const bad=[HASH_A.toUpperCase(),'A'+HASH_A.slice(1),HASH_A.slice(1),HASH_A+'0','g'+HASH_A.slice(1),
    ' '+HASH_A.slice(1),HASH_A.slice(0,63)+'\n','0x'+HASH_A.slice(2),'',123,[],{},undefined,'z'.repeat(64)];
  for(const hash of bad)assert.equal(isMapRef({id:'cidade-nevada',version:1,hash}),false,`hash ${JSON.stringify(hash)}`);
  assert.equal(isMapRef({id:'cidade-nevada',version:1,hash:null}),false,'asset map needs a hash');
  assert.equal(isMapRef({id:'cidade-nevada',version:1}),false,'asset map missing hash key');
  assert.equal(isMapRef({id:'infinito',version:1,hash:HASH_A}),false,'generated map must have null hash');
  assert.equal(isMapRef({id:'infinito',version:1}),false,'infinito missing hash key');
});

test('isMapRef: rejects bad ids, extra keys and non-objects', ()=>{
  for(const id of [...BAD_IDS,undefined,null,1,['infinito']])
    assert.equal(isMapRef({id,version:1,hash:null}),false,`id ${JSON.stringify(id)?.slice(0,40)}`);
  assert.equal(isMapRef({...INFINITO,extra:1}),false,'extra key');
  assert.equal(isMapRef({...NEVADA,name:'x'}),false,'extra key');
  assert.equal(isMapRef(JSON.parse('{"id":"infinito","version":1,"hash":null,"__proto__":{}}')),false,'own __proto__ key');
  assert.equal(isMapRef(Object.create(INFINITO)),false,'inherited fields are not own keys');
  assert.equal(isMapRef([ 'infinito',1,null ]),false);
  const arr=Object.assign([],INFINITO);
  assert.equal(isMapRef(arr),false,'array with ref keys');
  for(const v of GARBAGE)assert.equal(isMapRef(v),false);
});

// ---------- sameMap ----------
test('sameMap: id, version and hash all equal', ()=>{
  assert.equal(sameMap(NEVADA,{...NEVADA}),true);
  assert.equal(sameMap(INFINITO,{...INFINITO}),true);
  assert.equal(sameMap(NEVADA,{...NEVADA,version:4}),false);
  assert.equal(sameMap(NEVADA,{...NEVADA,hash:HASH_B}),false);
  assert.equal(sameMap(NEVADA,INFINITO),false);
  assert.equal(sameMap({id:'infinito',version:3,hash:null},{id:'cidade-nevada',version:3,hash:null} as MapRef),false);
});

// ---------- validateSetMap ----------
test('validateSetMap: owner in lobby switches map; returns catalog entry', ()=>{
  const r=validateSetMap(msg('cidade-nevada'),ctx());
  assert.equal(r.ok,true);
  if(!r.ok)return;
  assert.deepEqual(r.map,NEVADA);
  assert.equal(r.changed,true);
  assert.ok(isMapRef(r.map));
});

test('validateSetMap: honest rawLength of a real JSON message', ()=>{
  for(const id of MAP_IDS){
    const raw=JSON.stringify(msg(id));
    const r=validateSetMap(JSON.parse(raw),ctx({rawLength:raw.length,current:id==='infinito'?NEVADA:INFINITO}));
    assert.equal(r.ok,true,id);
    if(r.ok){assert.deepEqual(r.map,CATALOG.get(id));assert.equal(r.changed,true);}
  }
});

test('validateSetMap: same map is ok with changed:false', ()=>{
  const r=validateSetMap(msg('infinito'),ctx({current:INFINITO}));
  assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.changed,false);assert.deepEqual(r.map,INFINITO);}
  const r2=validateSetMap(msg('cidade-nevada'),ctx({current:{...NEVADA}}));
  assert.equal(r2.ok,true);
  if(r2.ok)assert.equal(r2.changed,false);
});

test('validateSetMap: same id but outdated current is changed:true and takes catalog version', ()=>{
  const old:MapRef={id:'cidade-nevada',version:2,hash:HASH_B};
  const r=validateSetMap(msg('cidade-nevada'),ctx({current:old}));
  assert.equal(r.ok,true);
  if(r.ok){assert.equal(r.changed,true);assert.deepEqual(r.map,NEVADA);}
});

test('validateSetMap: map comes from the catalog, never the message', ()=>{
  const custom:MapRef={id:'cidade-nevada',version:42,hash:HASH_B};
  const r=validateSetMap(msg('cidade-nevada'),ctx({catalog:makeCatalog(custom,INFINITO)}));
  assert.equal(r.ok,true);
  if(r.ok)assert.deepEqual(r.map,custom);
  // Smuggling a version/hash in the message is a shape error, not an override.
  refused(validateSetMap({t:'setMap',map:'cidade-nevada',hash:HASH_B},ctx()),'shape');
  refused(validateSetMap({t:'setMap',map:'cidade-nevada',version:99},ctx()),'shape');
  refused(validateSetMap({t:'setMap',map:{id:'cidade-nevada',version:99,hash:HASH_B}},ctx()),'shape');
});

test('validateSetMap: result does not alias the message', ()=>{
  const m=msg('cidade-nevada');
  const r=validateSetMap(m,ctx());
  assert.equal(r.ok,true);
  if(r.ok)assert.notEqual(r.map as unknown,m as unknown);
  assert.deepEqual(m,{t:'setMap',map:'cidade-nevada'},'message not mutated');
});

test('validateSetMap: non-owner refused', ()=>{
  const r=validateSetMap(msg('cidade-nevada'),ctx({senderId:GUEST}));
  refused(r,'not-owner');
  if(!r.ok)assert.equal(r.text,MAP_TEXT.ownerOnly);
});

test('validateSetMap: owner outside lobby refused', ()=>{
  for(const phase of ['countdown','combat','result'] as RoomPhase[]){
    const r=validateSetMap(msg('cidade-nevada'),ctx({phase}));
    refused(r,'not-lobby');
    if(!r.ok)assert.equal(r.text,MAP_TEXT.lobbyOnly);
  }
});

test('validateSetMap: sender not joined / no owner', ()=>{
  refused(validateSetMap(msg('cidade-nevada'),ctx({senderId:undefined})),'not-joined');
  refused(validateSetMap(msg('cidade-nevada'),ctx({senderId:undefined,ownerId:undefined})),'not-joined');
  refused(validateSetMap(msg('cidade-nevada'),ctx({senderId:undefined,phase:'combat'})),'not-joined');
  // Joined sender but the room has no owner: nobody may pick.
  refused(validateSetMap(msg('cidade-nevada'),ctx({ownerId:undefined})),'not-owner');
  refused(validateSetMap(msg('cidade-nevada'),ctx({ownerId:undefined,phase:'result'})),'not-owner');
  // Empty-string ids must not match each other into ownership by accident.
  const r=validateSetMap(msg('cidade-nevada'),ctx({senderId:'',ownerId:''}));
  assert.equal(r.ok,false,'empty sender and empty owner must not match');
  refused(r,'not-joined');
});

test('validateSetMap: unknown map', ()=>{
  // Valid MapId missing from the injected catalog.
  const r=validateSetMap(msg('cidade-nevada'),ctx({catalog:makeCatalog(INFINITO)}));
  refused(r,'unknown-map');
  if(!r.ok)assert.equal(r.text,MAP_TEXT.unknown);
  // Strings that are not ids: spec leaves shape vs unknown-map open; must be one of them, never ok.
  for(const id of BAD_IDS){
    const r2=validateSetMap(msg(id),ctx());
    assert.equal(r2.ok,false,JSON.stringify(id.slice(0,40)));
    if(!r2.ok)assert.ok(['shape','unknown-map'].includes(r2.reason),`${JSON.stringify(id.slice(0,40))} -> ${r2.reason}`);
  }
});

test('validateSetMap: too-big at MAX+1, not at MAX', ()=>{
  refused(validateSetMap(msg('cidade-nevada'),ctx({rawLength:MAX_SET_MAP_LENGTH+1})),'too-big');
  refused(validateSetMap(msg('cidade-nevada'),ctx({rawLength:1_000_000})),'too-big');
  const r=validateSetMap(msg('cidade-nevada'),ctx({rawLength:MAX_SET_MAP_LENGTH}));
  assert.equal(r.ok,true);
  const huge='x'.repeat(10_000);
  const raw=JSON.stringify(msg(huge));
  refused(validateSetMap(JSON.parse(raw),ctx({rawLength:raw.length})),'too-big');
});

test('validateSetMap: check order precedence', ()=>{
  const worst={senderId:undefined,ownerId:OWNER,phase:'combat' as RoomPhase,catalog:makeCatalog(INFINITO)};
  // too-big beats everything, including garbage shape.
  refused(validateSetMap(null,ctx({...worst,rawLength:MAX_SET_MAP_LENGTH+1})),'too-big');
  refused(validateSetMap({t:'nope'},ctx({...worst,rawLength:MAX_SET_MAP_LENGTH+1})),'too-big');
  refused(validateSetMap(msg('cidade-nevada'),ctx({...worst,rawLength:MAX_SET_MAP_LENGTH+1})),'too-big');
  // shape beats unknown-map, not-joined, not-owner, not-lobby.
  refused(validateSetMap({t:'setMap',map:'cidade-nevada',x:1},ctx(worst)),'shape');
  refused(validateSetMap({t:'setMap',map:7},ctx(worst)),'shape');
  // unknown-map beats not-joined.
  refused(validateSetMap(msg('cidade-nevada'),ctx(worst)),'unknown-map');
  // not-joined beats not-owner and not-lobby.
  refused(validateSetMap(msg('infinito'),ctx(worst)),'not-joined');
  // not-owner beats not-lobby.
  refused(validateSetMap(msg('infinito'),ctx({...worst,senderId:GUEST})),'not-owner');
  // only not-lobby left.
  refused(validateSetMap(msg('infinito'),ctx({...worst,senderId:OWNER})),'not-lobby');
  // Same map still has to pass the authority checks (no free idempotent pass for guests).
  refused(validateSetMap(msg('infinito'),ctx({senderId:GUEST,current:INFINITO})),'not-owner');
  refused(validateSetMap(msg('infinito'),ctx({phase:'combat',current:INFINITO})),'not-lobby');
});

test('validateSetMap: shape fuzzing never throws and is never ok', ()=>{
  for(const v of GARBAGE){
    let r:Result|undefined;
    assert.doesNotThrow(()=>{r=validateSetMap(v,ctx());},`threw on ${String(typeof v)}`);
    assert.ok(r);
    assert.equal(r.ok,false,`accepted ${typeof v==='object'?JSON.stringify(v):String(typeof v)}`);
    if(!r.ok){
      assert.ok(['shape','unknown-map'].includes(r.reason),`reason ${r.reason}`);
      assert.ok(typeof r.text==='string'&&r.text.length>0);
    }
  }
  // Wrong-type / missing / extra fields are strictly 'shape'.
  for(const v of [null,undefined,0,'setMap',[],{},{t:'setMap'},{map:'infinito'},{t:'setMap',map:1},
    {t:'setMap',map:['infinito']},{t:'setMap',map:{id:'infinito'}},{t:'setMap',map:'infinito',extra:1},
    {t:'x',map:'infinito'},JSON.parse('{"__proto__":{"t":"setMap"}}'),
    JSON.parse('{"__proto__":{"t":"setMap","map":"infinito"}}'),
    JSON.parse('{"t":"setMap","map":"infinito","__proto__":{}}'),
    Object.create({t:'setMap',map:'infinito'})])
    refused(validateSetMap(v,ctx()),'shape');
});

test('validateSetMap: null-prototype object never throws', ()=>{
  const o=Object.create(null);
  o.t='setMap';o.map='cidade-nevada';
  let r:Result|undefined;
  assert.doesNotThrow(()=>{r=validateSetMap(o,ctx());});
  assert.ok(r);
  if(r.ok)assert.deepEqual(r.map,NEVADA,'if accepted, still the catalog entry');
  const bad=Object.create(null);
  bad.t='setMap';bad.map='__proto__';
  assert.doesNotThrow(()=>validateSetMap(bad,ctx()));
  assert.equal(validateSetMap(bad,ctx()).ok,false);
});

test('validateSetMap: prototype-ish ids with a small rawLength never pass', ()=>{
  for(const id of BAD_IDS){
    for(const phase of ['lobby','combat'] as RoomPhase[]){
      const r=validateSetMap(msg(id),ctx({phase,rawLength:20}));
      assert.equal(r.ok,false);
    }
  }
});

test('validateSetMap: deterministic', ()=>{
  const inputs:unknown[]=[msg('cidade-nevada'),msg('infinito'),msg('__proto__'),null,{t:'setMap'}];
  const ctxs=[ctx(),ctx({senderId:GUEST}),ctx({phase:'combat'}),ctx({rawLength:999}),ctx({senderId:undefined})];
  for(const m of inputs)for(const c of ctxs)
    assert.deepEqual(validateSetMap(m,c),validateSetMap(m,c));
});

// ---------- welcomeMap / parseWelcomeMap ----------
test('welcomeMap: plain JSON-safe copy', ()=>{
  for(const ref of [NEVADA,INFINITO]){
    const w=welcomeMap(ref);
    assert.deepEqual(w,{id:ref.id,version:ref.version,hash:ref.hash});
    assert.notEqual(w as unknown,ref as unknown,'must be a copy');
    assert.deepEqual(Object.keys(w).sort(),['hash','id','version']);
    const back=JSON.parse(JSON.stringify(w));
    assert.deepEqual(back,w);
    const p=parseWelcomeMap(back);
    assert.equal(p.ok,true);
    if(p.ok)assert.equal(sameMap(p.map,ref),true);
  }
});

test('welcomeMap: survives JSON round-trip inside a welcome payload', ()=>{
  const welcome={t:'welcome',world:{seed:1},map:welcomeMap(NEVADA)};
  const parsed=JSON.parse(JSON.stringify(welcome));
  const p=parseWelcomeMap(parsed.map);
  assert.equal(p.ok,true);
  if(p.ok)assert.ok(sameMap(p.map,NEVADA));
});

test('parseWelcomeMap: strict, failure text is MAP_TEXT.update', ()=>{
  const bad:unknown[]=[...GARBAGE,
    {id:'infinito',version:0,hash:null},{id:'infinito',version:-1,hash:null},{id:'infinito',version:1.5,hash:null},
    {id:'infinito',version:NaN,hash:null},{id:'infinito',version:Infinity,hash:null},{id:'infinito',version:'1',hash:null},
    {id:'infinito',version:2**53,hash:null},{id:'infinito',version:1,hash:HASH_A},
    {id:'cidade-nevada',version:1,hash:null},{id:'cidade-nevada',version:1,hash:HASH_A.toUpperCase()},
    {id:'cidade-nevada',version:1,hash:HASH_A.slice(1)},{id:'cidade-nevada',version:1,hash:HASH_A+'a'},
    {id:'cidade-nevada',version:1,hash:'q'.repeat(64)},{...NEVADA,extra:true},{id:'__proto__',version:1,hash:null},
    {id:'constructor',version:1,hash:null},{id:'x'.repeat(10_000),version:1,hash:null},
  ];
  for(const v of bad){
    let p:ReturnType<typeof parseWelcomeMap>|undefined;
    assert.doesNotThrow(()=>{p=parseWelcomeMap(v);});
    assert.ok(p);
    assert.equal(p.ok,false,`accepted ${typeof v==='object'?JSON.stringify(v)?.slice(0,80):String(typeof v)}`);
    if(!p.ok)assert.equal(p.text,MAP_TEXT.update);
  }
});

test('parseWelcomeMap: does not alias input', ()=>{
  const input={...NEVADA};
  const p=parseWelcomeMap(input);
  assert.equal(p.ok,true);
  if(p.ok){
    assert.deepEqual(p.map,NEVADA);
    input.version=99;
    assert.notEqual(p.map,input,'a fresh copy, never the caller object');
    assert.equal(p.map.version,3,'later changes to the input do not leak into the parsed ref');
  }
});

// ---------- checkClientMap ----------
test('checkClientMap: same map ok', ()=>{
  assert.deepEqual(checkClientMap(NEVADA,CATALOG),{ok:true});
  assert.deepEqual(checkClientMap({...INFINITO},CATALOG),{ok:true});
});

test('checkClientMap: unknown / version / hash', ()=>{
  const r1=checkClientMap(NEVADA,makeCatalog(INFINITO));
  assert.equal(r1.ok,false);
  if(!r1.ok){assert.equal(r1.reason,'unknown-map');assert.equal(r1.text,MAP_TEXT.update);}
  const r1b=checkClientMap(INFINITO,makeCatalog());
  assert.equal(r1b.ok,false);
  if(!r1b.ok)assert.equal(r1b.reason,'unknown-map');

  for(const version of [2,4]){
    const r=checkClientMap({...NEVADA,version},CATALOG);
    assert.equal(r.ok,false,`version ${version}`);
    if(!r.ok){assert.equal(r.reason,'version');assert.equal(r.text,MAP_TEXT.update);}
  }
  const ri=checkClientMap({...INFINITO,version:2},CATALOG);
  assert.equal(ri.ok,false);
  if(!ri.ok)assert.equal(ri.reason,'version');

  const r3=checkClientMap({...NEVADA,hash:HASH_B},CATALOG);
  assert.equal(r3.ok,false);
  if(!r3.ok){assert.equal(r3.reason,'hash');assert.equal(r3.text,MAP_TEXT.update);}

  // Both differ: version is reported first (reason order in the spec).
  const r4=checkClientMap({...NEVADA,version:4,hash:HASH_B},CATALOG);
  assert.equal(r4.ok,false);
  if(!r4.ok)assert.equal(r4.reason,'version');
});

test('checkClientMap: hostile room ref never throws, never ok', ()=>{
  const hostile:unknown[]=[null,undefined,{},{id:'__proto__',version:1,hash:null},{id:'constructor',version:1,hash:null},
    {id:'toString',version:1,hash:null},{id:'infinito',version:NaN,hash:null},{id:'cidade-nevada',version:3,hash:HASH_A.toUpperCase()},
    'infinito',42,[]];
  for(const v of hostile){
    let r:ReturnType<typeof checkClientMap>|undefined;
    assert.doesNotThrow(()=>{r=checkClientMap(v as MapRef,CATALOG);},JSON.stringify(v));
    assert.ok(r);
    assert.equal(r.ok,false,`accepted ${JSON.stringify(v)}`);
    if(!r.ok)assert.equal(r.text,MAP_TEXT.update);
  }
});

// ---------- Join: the client sends its whole catalog ----------
const BOTH=[{...NEVADA},{...INFINITO}];
test('parseClientMaps: one strict ref per known id, 1..2 entries, no duplicates', ()=>{
  const ok=parseClientMaps(BOTH);
  assert.equal(ok.ok,true);
  if(ok.ok){assert.ok(sameMap(ok.maps.get('cidade-nevada')!,NEVADA));assert.ok(sameMap(ok.maps.get('infinito')!,INFINITO));}
  assert.equal(parseClientMaps([{...INFINITO}]).ok,true,'a build may ship only the infinite map');
  for(const bad of [undefined,null,{},[],[NEVADA,NEVADA],[NEVADA,INFINITO,INFINITO],[NEVADA,{...INFINITO,extra:1}],
    [{...NEVADA,hash:HASH_A.toUpperCase()}],'[]',[null],Array.from({length:1000},()=>INFINITO)]){
    let r:ReturnType<typeof parseClientMaps>|undefined;
    assert.doesNotThrow(()=>{r=parseClientMaps(bad);});
    assert.equal(r!.ok,false,JSON.stringify(bad)?.slice(0,80));
    if(r&&!r.ok)assert.equal(r.text,MAP_TEXT.update);
  }
});

test('checkJoinMaps: an up-to-date client joins whatever map the room is on', ()=>{
  for(const room of [NEVADA,INFINITO]){
    const r=checkJoinMaps(JSON.parse(JSON.stringify(BOTH)),room);
    assert.equal(r.ok,true,room.id);
    if(r.ok)assert.ok(r.maps&&sameMap(r.maps.get(room.id)!,room),'keeps the client catalog for later setMap checks');
  }
  assert.deepEqual(checkJoinMaps(undefined,NEVADA),{ok:true,maps:undefined},'older client without maps: accepted, no catalog');
});

test('checkJoinMaps: a stale build is refused at join, for the room map', ()=>{
  const cases:[unknown,MapRef,string][]=[
    [[{...NEVADA,hash:HASH_B},INFINITO],NEVADA,'hash'],
    [[{...NEVADA,version:2},INFINITO],NEVADA,'version'],
    [[INFINITO],NEVADA,'unknown-map'],
    [[{...INFINITO,version:2}],INFINITO,'version'],
  ];
  for(const [maps,room,reason] of cases){
    const r=checkJoinMaps(maps,room);
    assert.equal(r.ok,false,JSON.stringify(maps));
    if(!r.ok){assert.equal(r.reason,reason);assert.equal(r.text,MAP_TEXT.update);}
  }
  // The stale city hash does not matter while the room is on the infinite map...
  assert.equal(checkJoinMaps([{...NEVADA,hash:HASH_B},INFINITO],INFINITO).ok,true);
});

test('checkJoinMaps: garbage is shape and never throws', ()=>{
  const garbage:unknown[]=[null,0,'','infinito',{},INFINITO,[],[{id:'infinito'}],[{...INFINITO,extra:1}],
    [{id:'__proto__',version:1,hash:null}],[JSON.parse('{"__proto__":{"id":"infinito","version":1,"hash":null}}')],
    [Object.create(INFINITO)],[{id:'x'.repeat(10_000),version:1,hash:null}]];
  for(const v of garbage){
    let r:ReturnType<typeof checkJoinMaps>|undefined;
    assert.doesNotThrow(()=>{r=checkJoinMaps(v,INFINITO);});
    assert.equal(r!.ok,false,`accepted ${JSON.stringify(v)?.slice(0,80)}`);
    if(r&&!r.ok){assert.equal(r.reason,'shape');assert.equal(r.text,MAP_TEXT.update);}
  }
});

test('playersMissingMap: who cannot load the map the owner wants (sorted)', ()=>{
  const fresh=makeCatalog(NEVADA,INFINITO),stale=makeCatalog({...NEVADA,hash:HASH_B},INFINITO),infOnly=makeCatalog(INFINITO);
  const seated:[string,MapCatalog|undefined][]=[['z-fresh',fresh],['b-stale',stale],['a-old',undefined],['c-inf',infOnly]];
  assert.deepEqual(playersMissingMap(NEVADA,seated),['a-old','b-stale','c-inf']);
  assert.deepEqual(playersMissingMap(INFINITO,seated),['a-old']);
  assert.deepEqual(playersMissingMap(NEVADA,[]),[]);
});

test('checkJoinMaps / checkClientMap: deterministic', ()=>{
  for(const v of [undefined,BOTH,[INFINITO],null,[{...NEVADA,hash:HASH_B}]]){
    assert.deepEqual(checkJoinMaps(v,NEVADA),checkJoinMaps(v,NEVADA));
  }
  for(const v of [NEVADA,INFINITO,{...NEVADA,version:9}]){
    assert.deepEqual(checkClientMap(v,CATALOG),checkClientMap(v,CATALOG));
  }
});

// ---------- Review fixes: single read, loose rawLength/current, manifest catalogs ----------
test('a ref is read once: an object that changes or throws on a second read can neither pass nor crash', ()=>{
  let reads=0;
  const shifty=new Proxy({id:'cidade-nevada',version:3,hash:HASH_A},{
    getOwnPropertyDescriptor(target,key){reads++;return Reflect.getOwnPropertyDescriptor(target,key);},
    get(target,key){if(key==='hash')return 'ZZ';if(reads>3)throw new Error('second read');return Reflect.get(target,key);},
  });
  for(const call of [()=>parseWelcomeMap(shifty),()=>checkClientMap(shifty as MapRef,CATALOG),()=>checkJoinMaps([shifty,INFINITO],NEVADA),()=>readMapRef(shifty)]){
    assert.doesNotThrow(call);
  }
  const parsed=parseWelcomeMap(shifty);
  if(parsed.ok)assert.equal(parsed.map.hash,HASH_A,'the validated copy is what comes out, never a later read');
});

test('validateSetMap: rawLength must be an honest non-negative number; a garbage current never throws', ()=>{
  for(const rawLength of [-1,NaN,Infinity,'30' as unknown as number,undefined as unknown as number])
    refused(validateSetMap(msg('cidade-nevada'),ctx({rawLength})),'too-big');
  for(const current of [null,undefined,{},{id:'cidade-nevada'},42] as unknown as MapRef[]){
    let r:ReturnType<typeof validateSetMap>|undefined;
    assert.doesNotThrow(()=>{r=validateSetMap(msg('cidade-nevada'),ctx({current}));});
    assert.ok(r!.ok&&r!.changed,'a valid pick is a change when current is unusable');
  }
});

test('a manifest catalog with extra fields still works, and the copy carries only id/version/hash', ()=>{
  const manifest=new Map([['cidade-nevada',{...NEVADA,file:'maps/cidade-nevada.abc.json',bytes:123}],['infinito',{...INFINITO,generator:2}]]) as unknown as MapCatalog;
  const r=validateSetMap(msg('cidade-nevada'),ctx({catalog:manifest}));
  assert.equal(r.ok,true);
  if(r.ok)assert.deepEqual(r.map,NEVADA);
  assert.deepEqual(checkClientMap(NEVADA,manifest),{ok:true});
});

// ---------- Hostile objects and broken catalogs (never throw) ----------
test('never throws on throwing getters, proxies or broken catalogs', ()=>{
  const getter={t:'setMap',get map():string{throw new Error('boom');}};
  const proxy=new Proxy({},{ownKeys(){throw new Error('boom');},get(){throw new Error('boom');},getOwnPropertyDescriptor(){throw new Error('boom');}});
  for(const v of [getter,proxy]){
    assert.doesNotThrow(()=>validateSetMap(v,ctx()));
    assert.equal(validateSetMap(v,ctx()).ok,false);
    assert.doesNotThrow(()=>isMapRef(v));
    assert.equal(isMapRef(v),false);
    assert.doesNotThrow(()=>parseWelcomeMap(v));
    assert.doesNotThrow(()=>checkJoinMaps([v],INFINITO));
    assert.equal(checkJoinMaps([v],INFINITO).ok,false);
  }
  const throwing={get(){throw new Error('boom');}} as unknown as MapCatalog;
  assert.doesNotThrow(()=>validateSetMap(msg('infinito'),ctx({catalog:throwing})));
  assert.equal(validateSetMap(msg('infinito'),ctx({catalog:throwing})).ok,false);
  assert.doesNotThrow(()=>checkClientMap(INFINITO,throwing));
  assert.equal(checkClientMap(INFINITO,throwing).ok,false);
  // A catalog entry stored under the wrong id must not be handed out.
  const crossed=new Map<MapId,MapRef>([['cidade-nevada',INFINITO]]);
  assert.equal(validateSetMap(msg('cidade-nevada'),ctx({catalog:crossed})).ok,false);
});
