// Card BUG-20261022-ORQ-troca-de-perna: every looping gait the game shows changes the leading leg each half cycle. The user
// saw the viciado run with the same leg always in front ("não tem a troca"): the image tool drew the second half as the
// first with the shoe colour markers swapped (scripts/troca-de-perna.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// @ts-expect-error plain ESM script without types
import {LEGS_BY_CLASS,MIRROR_MAX,gaitClips,measureClip,mirrorTest} from '../../scripts/troca-de-perna.mjs';

const manifest=JSON.parse(readFileSync('public/art/sprites/manifest.json','utf8'));
/**
 * Side and diagonal sheets checked by eye on their marked sources (no 2D test): file → verdict and proof. The side view
 * (W, mirrored to E) changes legs too: no more 'perfil' (user, 23/10: "trocar com looping", card
 * troca-perna-lado-viciado-clt).
 */
const reviewed:Record<string,{alterna:boolean,prova:string}>=JSON.parse(readFileSync('scripts/troca-de-perna.json','utf8'));
/**
 * S/N gaits that keep one leg in front, drawn before this gate. None is shown in a run: the heroes that run (viciado,
 * CLT) show run16; the walks are the bots' (R06, card of the bots) and the heroes' walk with HERO_GAIT.run off. A
 * fixed one leaves the list (the test asks for that), a new one fails.
 */
const KNOWN_SN=new Set([
  'clt-cansado walk128-N','clt-cansado walk128-S',
  'coach walk128-N','coach walk128-S','concurseira walk128-N','concurseira walk128-S','faxineira walk128-N',
  'faxineira walk128-S','feirante walk128-N','feirante walk128-S','maromba walk128-N','maromba walk128-S',
  'mendigo walk128-N','mendigo walk128-S','passageira walk128-N','passageira walk128-S','pedreiro walk128-N',
  'pedreiro walk128-S','streamer walk128-N','streamer walk128-S',
  'universitario walk128-N','universitario walk128-S','viciado-em-bet walk128-N','viciado-em-bet walk128-S',
  'viciado-em-bet walk16-N','viciado-em-bet walk16-S','vizinha-fofoqueira walk128-N','vizinha-fofoqueira walk128-S',
]);

/** Two legs (left 2 px wide, right 4 px wide) under a body, the front one longer: a 24 px cell, pivot at 12. */
function frame(frontLeft:boolean,lift:number){
  const C=24,f=new Float32Array(C*C*4),put=(x:number,y:number)=>{const i=(y*C+x)*4;f[i]=f[i+1]=f[i+2]=.5;f[i+3]=1;};
  for(let y=2;y<12;y++)for(let x=8;x<16;x++)put(x,y);
  const [front,back]=frontLeft?[[7,9],[13,17]]:[[13,17],[7,9]];
  for(let y=12;y<22-lift;y++)for(let x=front[0];x<front[1];x++)put(x,y);
  for(let y=12;y<18;y++)for(let x=back[0];x<back[1];x++)put(x,y);
  return f;
}

test('the mirror test: legs that change sides half a cycle later read alternating, one leg always in front does not',()=>{
  const halfA=[0,1,2,3].map(k=>frame(true,k)),changes=[...halfA,...[0,1,2,3].map(k=>frame(false,k))];
  // mirrored about the pivot the right leg (4 px) lands where the left (2 px) was: the 2nd half is the 1st mirrored
  const mirrored=[...halfA,...halfA.map(f=>{const C=24,g=new Float32Array(f.length);for(let y=0;y<C;y++)for(let x=0;x<C;x++){const xm=24-x;if(xm<0||xm>=C)continue;for(let k=0;k<4;k++)g[(y*C+x)*4+k]=f[(y*C+xm)*4+k];}return g;})];
  const limp=[...halfA,...halfA];
  assert.ok(mirrorTest(mirrored,24,12).ratio<=MIRROR_MAX,'2nd half = 1st mirrored');
  assert.ok(mirrorTest(limp,24,12).ratio>1,'2nd half = 1st: the same leg in front');
  assert.ok(mirrorTest(changes,24,12).ratio<mirrorTest(limp,24,12).ratio);
});

/**
 * Side/diagonal runs in the game without the change, each tied to its open card (the fix takes it out). Empty since the
 * gato's NW run changes legs with a flight (23/10, card NEW-20261023-E3-gato-troca-perna-nw) and the maromba's SE run
 * changes hip (card NEW-20261023-E7-maromba-troca-perna-se, legs transplanted from pose i+8).
 */
const KNOWN_SIDE=new Set<string>([]);

/**
 * A class may measure a lower legs band only when something it wears hangs on ONE hip and so cannot mirror (ORQ, 24/10):
 * the vendedor's cooler box sits at 55–74 % of the figure; below the shorts' hem (74 %) the legs still must alternate.
 */
test('the legs band per class: only the vendedor (cooler on the left hip), below the shorts',()=>{
  assert.deepEqual(LEGS_BY_CLASS,{'vendedor-praia':.74});
});

const clips=gaitClips(manifest);
const sn=clips.filter((c:{direction:string})=>c.direction==='S'||c.direction==='N');
test('every S/N looping gait changes legs (mirror ≤ '+MIRROR_MAX+' × same), but the known ones of the list',async()=>{
  const bad:string[]=[];
  for(const c of sn){const m=await measureClip(c);if(m.ratio>MIRROR_MAX)bad.push(`${c.id} ${c.key}`);}
  const fresh=bad.filter(b=>!KNOWN_SN.has(b)),fixed=[...KNOWN_SN].filter(k=>!bad.includes(k)&&sn.some((c:{id:string,key:string})=>`${c.id} ${c.key}`===k));
  assert.deepEqual(fresh,[],'these S/N gaits keep one leg in front');
  assert.deepEqual(fixed,[],'fixed: take them out of KNOWN_SN');
});

test('every run the heroes show (run16) changes legs: S/N by the mirror test, the drawn side/diagonals reviewed by file',async()=>{
  const runs=clips.filter((c:{motion:string})=>c.motion==='run16');
  assert.ok(runs.some((c:{id:string})=>c.id==='viciado-em-bet')&&runs.some((c:{id:string})=>c.id==='clt-cansado'),'the viciado and the CLT run');
  for(const c of runs){
    if(c.direction==='S'||c.direction==='N'){assert.ok((await measureClip(c)).ratio<=MIRROR_MAX,`${c.id} ${c.key}`);continue;}
    if(KNOWN_SIDE.has(c.file))continue;
    const r=reviewed[c.file];
    assert.ok(r,`${c.id} ${c.key}: ${c.file} not reviewed (scripts/troca-de-perna.json: check its marked source by eye)`);
    assert.ok(r.alterna===true,`${c.id} ${c.key}: one leg always in front (${r.prova})`);
  }
  const shown=new Set(runs.map((c:{file:string})=>c.file));
  assert.deepEqual([...KNOWN_SIDE].filter(f=>!shown.has(f)),[],'KNOWN_SIDE: a sheet no longer in the game leaves the list');
});
