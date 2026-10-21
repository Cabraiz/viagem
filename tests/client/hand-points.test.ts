import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {HAND_POINTS} from '../../src/client/sprites/hand-points-data.ts';
import {AIM_ANGLE,DEFAULT_HOLD,WEAPON_HOLD,handOnScreen,handPoint,handSheetKey,heldHand,holdPose,type HandSheet} from '../../src/client/sprites/hand-points.ts';
import {MOVEMENT16_GRID} from '../../src/client/sprites/movement128.ts';
import {FIRE_LOOK} from '../../src/client/render/arsenal-rules.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8'));
const viciado=manifest.groups.personagens.pieces['viciado-em-bet'].files as Record<string,{file:string;figure:{left:number;top:number;right:number;bottom:number}}>;
const m16=Object.entries(viciado).filter(([name])=>/^(walk|attack|idle)16-/.test(name));

test('every M16 sheet of the viciado has its hand in each frame, inside the figure', ()=>{
  assert.equal(m16.length,15,'walk, attack and idle in the 5 drawn directions');
  for(const [name,f] of m16){
    const sheet=HAND_POINTS[f.file],motion=name.split('16-')[0] as keyof typeof MOVEMENT16_GRID,[c,r]=MOVEMENT16_GRID[motion];
    assert.ok(sheet,`${f.file} measured (scripts/hand-points.mjs)`);
    assert.equal(sheet.points.length,c*r,name);
    for(const [i,p] of sheet.points.entries()){
      assert.ok(p[0]>=f.figure.left-1&&p[0]<=f.figure.right+1&&p[1]>=f.figure.top-1&&p[1]<=f.figure.bottom+1,`${name} frame ${i} ${p} in ${JSON.stringify(f.figure)}`);
    }
  }
});

test('the weapon hand is the punching side, behind the body for the back views', ()=>{
  const of=(name:string)=>HAND_POINTS[viciado[name].file];
  for(const m of ['walk','attack','idle']){
    assert.equal(of(`${m}16-S`).side,-1);assert.equal(of(`${m}16-N`).side,1);
    assert.equal(of(`${m}16-W`).side,-1);assert.equal(of(`${m}16-NW`).side,-1);assert.equal(of(`${m}16-SE`).side,1);
    assert.equal(of(`${m}16-N`).behind,true);assert.equal(of(`${m}16-NW`).behind,true);assert.equal(of(`${m}16-S`).behind,false);
  }
  // The W attack thrusts the fist out in front: mid-swing the hand is 10+ px further left than on guard.
  const w=of('attack16-W').points.map(p=>p[0]);
  assert.ok(Math.min(...w)<w[0]-10,String(w));
});

test('handPoint: by file name (lite or lossless url), a pose behind marked per frame, none for an unmeasured sheet', ()=>{
  const table:Record<string,HandSheet>={'x.walk16-w.abc.webp':{side:-1,behind:false,points:[[40,50],[41,52,1]]}};
  assert.equal(handSheetKey('/art/lite/sprites/x.walk16-w.abc.webp?v=3'),'x.walk16-w.abc.webp');
  assert.deepEqual(handPoint('/art/sprites/x.walk16-w.abc.webp',0,table),{x:40,y:50,behind:false});
  assert.deepEqual(handPoint('/art/lite/sprites/x.walk16-w.abc.webp',1,table),{x:41,y:52,behind:true});
  assert.equal(handPoint('/art/sprites/x.walk16-w.old.webp',0,table),undefined,'a reimported sheet: the side sticker');
  assert.equal(handPoint('/art/sprites/x.walk16-w.abc.webp',7,table),undefined);
});

test('handOnScreen: the hand from the frame origin, mirrored around the body for E/NE/SW', ()=>{
  const hand={x:30,y:50,behind:false},at={x:100,y:200},out={x:0,y:0};
  // Origin at column 48 (0.5), feet row 72 (0.75), scale 0.5: 18 px left, 22 px up → 9 and 11 on screen.
  assert.deepEqual({...handOnScreen(hand,at,.5,.75,.5,false,out)},{x:91,y:189});
  assert.deepEqual({...handOnScreen(hand,at,.5,.75,.5,true,out)},{x:109,y:189});
});

test('holdPose: the barrel along the aim, upright when aiming left, the maçarico only mirrors', ()=>{
  const pistol=WEAPON_HOLD.pistola,right=holdPose(pistol,0),left=holdPose(pistol,Math.PI);
  assert.ok(Math.abs(right.rotation+pistol.barrel)<1e-9);assert.equal(right.flipY,false);assert.deepEqual([right.ox,right.oy],[...pistol.grip]);
  // Flipped upside down, the barrel's art angle mirrors: rotation + (−barrel) must land on the aim.
  assert.equal(left.flipY,true);assert.ok(Math.abs(left.rotation-pistol.barrel-Math.PI)<1e-9);assert.equal(left.oy,1-pistol.grip[1]);
  const torch=WEAPON_HOLD.macarico;
  assert.deepEqual(holdPose(torch,Math.PI),{rotation:0,flipX:true,flipY:false,ox:1-torch.grip[0],oy:torch.grip[1]});
  assert.deepEqual(holdPose(torch,0),{rotation:0,flipX:false,flipY:false,ox:torch.grip[0],oy:torch.grip[1]});
  for(const id of Object.keys(FIRE_LOOK))assert.ok(WEAPON_HOLD[id],`${id} has a hold`);
  assert.ok(DEFAULT_HOLD.px>0);
});

test('AIM_ANGLE: each mirrored facing aims as its pair mirrored', ()=>{
  const mirror=(a:number)=>Math.atan2(Math.sin(a),-Math.cos(a));
  for(const [a,b] of [['W','E'],['NW','NE'],['SW','SE']] as const)assert.ok(Math.abs(Math.sin(mirror(AIM_ANGLE[a])-AIM_ANGLE[b]))<1e-9,`${a}×${b}`);
  assert.ok(Math.sin(AIM_ANGLE.S)>.9&&Math.sin(AIM_ANGLE.N)<-.9);
});

test('heldHand: on screen from the pose, none for a downed (turned) or hidden hero or a pose without hands', ()=>{
  const pose={point:{x:30,y:50,behind:true},ox:.5,oy:.75,scale:.5,flip:false,direction:'NW' as const};
  const sprites={handPose:(s:{id:string})=>s.id==='m16'?pose:undefined};
  const sprite={id:'m16',x:100,y:200,depth:96400,rotation:0,visible:true};
  assert.deepEqual(heldHand(sprites,sprite),{x:91,y:189,aim:AIM_ANGLE.NW,behind:true,depth:96400});
  assert.equal(heldHand(sprites,{...sprite,rotation:-Math.PI/2}),undefined);
  assert.equal(heldHand(sprites,{...sprite,visible:false}),undefined);
  assert.equal(heldHand(sprites,{...sprite,id:'r06'}),undefined);
  assert.equal(heldHand(sprites,undefined),undefined);
});
