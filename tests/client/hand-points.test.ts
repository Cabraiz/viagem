import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {handTone} from '../../scripts/hand-track.mjs';
import {HAND_POINTS} from '../../src/client/sprites/hand-points-data.ts';
import {AIM_ANGLE,DEFAULT_HOLD,HAND_PATCH,HELD_DEPTH,HELD_TINT,WEAPON_HOLD,heldLook,patchCrop,patchShift,handOnScreen,handPoint,handSheetKey,heldHand,holdPose,type HandSheet} from '../../src/client/sprites/hand-points.ts';
import {FIRE_LOOK,PACK12_ITEMS} from '../../src/client/render/arsenal-rules.ts';
import {parseArtIndex,setArtIndex} from '../../src/client/art/manifest.ts';
import {movementIdle8Frame,movementPlan} from '../../src/client/sprites/movement128.ts';
import {HERO_DIRECTIONS} from '../../src/client/sprites/sprite-motion.ts';
import {CITY_CONTOUR} from '../../src/client/render/you.ts';
import {RING_UNDER} from '../../src/client/render/you-rules.ts';

const manifest=JSON.parse(readFileSync(new URL('../../public/art/manifest.json',import.meta.url),'utf8'));
type ArtFile={file:string;figure:{left:number;top:number;right:number;bottom:number};height:number};
const filesOf=(id:string)=>manifest.groups.personagens.pieces[id].files as Record<string,ArtFile>;
const viciado=filesOf('viciado-em-bet');
sharp.cache(false);sharp.concurrency(1);

/**
 * Card NEW-20261022-ORQ-arma-na-mao: the classes whose weapon sits in the hand (the user saw the CLT's knife float at its
 * hip: its R06 sheets had no hand). Every sheet the game shows them (movement128.ts movementPlan: M16 with the run, else
 * R06 walk128/attack128 and idle8) needs a hand in each frame; a reimported sheet (a new sha12 in its name) fails here
 * until scripts/hand-points.mjs measures it again.
 */
/**
 * BUG-20261022-ORQ-arma-flutua-corrida-clt: every hero class (the two the player picks and the 13 the bots play), from
 * the manifest, so a class or a movement sheet added later (the CLT's run16 came in without a check) fails here too.
 */
const HELD=Object.keys(manifest.groups.personagens.pieces).filter(id=>Object.keys(filesOf(id)).some(n=>/^walk(16|128)-/.test(n)));
const shown=(id:string)=>{
  const files=filesOf(id),m16=Object.keys(files).some(n=>n.startsWith('walk16-'));
  return Object.entries(files).filter(([n])=>m16?/^(walk|attack|idle|run)16-/.test(n):/^(walk|attack)128-|^idle8$|^run16-/.test(n))
};
/** 1280×720 (DPR 1, city): the 96 px figure draws ≈45 px (56 × HERO_DRAW_SCALE), a figure ~50 cell px tall: ≈0.9 screen px a cell px. */
const SCREEN_PER_CELL=45/50;
/** Skin pixels the fingers patch must hold in a pose in front (a fist is ~5×5 cell px). */
const MIN_FINGERS=6;

test('every sheet the game shows any hero has its hand in each frame, inside the figure', ()=>{
  assert.equal(HELD.length,16,HELD.join());
  for(const id of HELD){
    const sheets=shown(id);
    // M16 (viciado, gato, maromba, vendedor, aposentado): walk, attack, idle and run in 5 directions; R06: walk128 and attack128 in 8, idle8, run16 in 5 if it runs.
    assert.equal(sheets.length,id==='viciado-em-bet'||id==='gato-nada-pra-comer'||id==='maromba'||id==='vendedor-praia'||id==='aposentado'?20:id==='clt-cansado'?22:17,`${id}: the sheets it shows`);
    // The M16 rest: 8 poses (held) or 16 (breathing, card parado-respiracao-herois), as its entry says.
    for(const [name,f] of sheets){
      const sheet=HAND_POINTS[f.file],frames=name==='idle8'?8:name.includes('128-')?128:name.startsWith('idle')?f.frames:16;
      assert.ok(sheet,`${f.file} measured (node scripts/hand-points.mjs --ids ${id})`);
      assert.equal(sheet.points.length,frames,name);if(name.startsWith('idle16'))assert.ok(f.frames===8||f.frames===16,name);
      for(const [i,p] of sheet.points.entries()){
        assert.ok(p[0]>=f.figure.left-1&&p[0]<=f.figure.right+1&&p[1]>=f.figure.top-1&&p[1]<=f.figure.bottom+1,`${name} frame ${i} ${p} in ${JSON.stringify(f.figure)}`);
      }
    }
  }
});

test('the grip lands on the drawn hand: skin within 3 screen px of it in every frame, a hidden hand on the body', async ()=>{
  const reach=3/SCREEN_PER_CELL,worst:{at:string;d:number}[]=[],few:{at:string;n:number}[]=[];
  for(const id of HELD)for(const [name,f] of shown(id)){
    const skin=handTone(id);
    const {data,info}=await sharp(fileURLToPath(new URL(`../../public/art/sprites/${f.file}`,import.meta.url))).raw().ensureAlpha().toBuffer({resolveWithObject:true});
    const cols=info.width/96;
    for(const [i,p] of HAND_POINTS[f.file].points.entries()){
      const ox=(i%cols)*96,oy=Math.floor(i/cols)*96,px=(x:number,y:number)=>((oy+y)*info.width+ox+x)*4;
      if(p[2]===1){
        // Behind the body: the weapon hangs from the body that hides the hand, never from the air beside it.
        assert.ok(data[px(Math.round(p[0]),Math.round(p[1]))+3]>200,`${name} frame ${i}: the hidden hand ${p} is on the body`);
        continue;
      }
      let d=Infinity;
      for(let y=Math.max(0,Math.floor(p[1]-6));y<=Math.min(95,Math.ceil(p[1]+6));y++)for(let x=Math.max(0,Math.floor(p[0]-6));x<=Math.min(95,Math.ceil(p[0]+6));x++){
        const k=px(x,y);if(skin(data[k],data[k+1],data[k+2],data[k+3]))d=Math.min(d,Math.hypot(x-p[0],y-p[1]));
      }
      worst.push({at:`${f.file} #${i}`,d});
      // The fingers patch (HAND_PATCH around the point) holds the hand's pixels: they are what closes over the handle.
      // Behind the body (a back view, the far hand) there is no patch.
      if(HAND_POINTS[f.file].behind)continue;
      let fingers=0;
      for(let y=Math.round(p[1]-HAND_PATCH);y<=Math.round(p[1]+HAND_PATCH);y++)for(let x=Math.round(p[0]-HAND_PATCH);x<=Math.round(p[0]+HAND_PATCH);x++){
        const k=px(x,y);if(x>=0&&y>=0&&x<96&&y<96&&skin(data[k],data[k+1],data[k+2],data[k+3]))fingers++;
      }
      few.push({at:`${f.file} #${i}`,n:fingers});
    }
  }
  worst.sort((a,b)=>b.d-a.d);
  few.sort((a,b)=>a.n-b.n);
  assert.ok(few[0].n>=MIN_FINGERS,`hand pixels under the fingers patch (≥${MIN_FINGERS}): ${few.slice(0,5).map(w=>`${w.at} ${w.n}`).join(', ')}`);
  assert.ok(worst[0].d<=reach,`grip off the hand (cell px, ≤${reach.toFixed(1)}): ${worst.slice(0,5).map(w=>`${w.at} ${w.d.toFixed(1)}`).join(', ')}`);
});

test('drawing order: from the back (N, NW, NE) and with the far hand, the weapon goes behind the hero', ()=>{
  for(const id of HELD)for(const [name,f] of shown(id)){
    const sheet=HAND_POINTS[f.file];
    if(name==='idle8'){
      // One pose per direction (S, SW, W, NW, N, NE, E, SE): the back views' poses behind.
      for(const i of [3,4,5])assert.equal(sheet.points[i][2],1,`${id} idle8 ${i}`);
      continue;
    }
    if(/-(N|NW|NE)$/.test(name))assert.equal(sheet.behind,true,`${id} ${name}`);
  }
  // The CLT throws its punches W and E with the far hand (the watch is on the near one).
  const clt=filesOf('clt-cansado');
  for(const d of ['W','E'])assert.equal(HAND_POINTS[clt[`attack128-${d}`].file].behind,true,d);
  // Behind → under the hero's depth; in front → over it (render/arsenal-fx.ts HELD_DEPTH).
  const sprites={handPose:()=>({point:{x:30,y:50,behind:true},ox:.5,oy:.75,scale:.5,flip:false,direction:'N' as const})};
  const sprite={x:0,y:0,depth:100,rotation:0,visible:true,texture:{key:'k'},frame:{name:0},originX:.5,originY:.75,scaleX:.5,scaleY:.5,flipX:false};
  const held=heldHand(sprites,sprite)!;
  assert.equal(held.behind,true);assert.equal(held.patch,undefined,'behind: the body covers it, no fingers patch');
});

/**
 * BUG arma-flutua-corrida-clt, reaberto 22/10 (site 37146d4, the viciado running): W, NW, SW and NE drew the knife over
 * the body. Per class, motion, facing (the mirrored ones as the game resolves them: movementPlan) and frame shown: from
 * the back (N, NW, NE) and side on (W, E) the weapon hand is on the hidden side of the body, so the weapon goes behind
 * it; facing the camera (S, SW, SE) in front, unless that pose's hand is hidden behind the body (marked per frame).
 */
const HIDDEN_SIDE=new Set(['N','NW','NE','W','E']);
test('per facing and frame shown, mirrors included: the weapon behind the body on the hidden side, in front on the visible one', ()=>{
  setArtIndex(parseArtIndex(manifest));
  try{
    const wrong:string[]=[];let front=0,behind=0;
    for(const id of HELD)for(const motion of ['walk','attack','idle'] as const)for(const d of HERO_DIRECTIONS){
      const plan=movementPlan(id,motion,d);
      assert.ok(plan,`${id} ${motion} ${d}: a sheet`);
      const sheet=HAND_POINTS[handSheetKey(plan.original)];
      assert.ok(sheet,`${plan.original} measured`);
      const idle8=plan.original.includes('.idle8.'),frames=idle8?[movementIdle8Frame(d)]:sheet.points.map((_,i)=>i);
      for(const i of frames){
        const hand=handPoint(plan.original,i)!,p=sheet.points[i];
        if(HIDDEN_SIDE.has(d)?!hand.behind:hand.behind!==(p[2]===1))wrong.push(`${id} ${motion} ${d}${plan.flip?' (mirrored)':''} #${i}`);
        if(hand.behind)behind++;else front++;
      }
    }
    assert.deepEqual(wrong.slice(0,12),[],`${wrong.length} poses on the wrong side of the body`);
    assert.ok(front>1000&&behind>2000,`${front} in front, ${behind} behind`);
  }finally{setArtIndex(parseArtIndex(undefined));}
});

test('behind the body the weapon also goes under the local hero\'s Papel/Breu contour, over its ring on the ground', ()=>{
  // At −0.02 the knife lay between the sprite and its sticker contour (−0.25…−0.15 in the city, −0.2/−0.1 on the
  // island): the blade crossed the outline in NE and NW.
  assert.ok(HELD_DEPTH.behind<Math.min(...CITY_CONTOUR.map(b=>b.depth),-.2),String(HELD_DEPTH.behind));
  assert.ok(HELD_DEPTH.behind>-RING_UNDER,'over the ring on the ground');
  assert.ok(HELD_DEPTH.front>0&&HELD_DEPTH.front<.1,'in front: just over the sprite, under the hit numbers');
  const sprites={handPose:()=>({point:{x:30,y:50,behind:true},ox:.5,oy:.75,scale:.5,flip:true,direction:'NE' as const})};
  const sprite={x:0,y:0,depth:100,rotation:0,visible:true,texture:{key:'k'},frame:{name:0},originX:.5,originY:.75,scaleX:.5,scaleY:.5,flipX:true};
  assert.equal(heldHand(sprites,sprite)!.behind,true,'NE (NW mirrored): behind');
  const arsenal=readFileSync(new URL('../../src/client/render/arsenal-fx.ts',import.meta.url),'utf8');
  assert.match(arsenal,/depth=held\.depth\+\(held\.behind\?HELD_DEPTH\.behind:HELD_DEPTH\.front\)/);
});

/**
 * Phaser 3.90's cropped frame on screen (Frame.setCropUVs + MultiPipeline.batchSprite, no trim, no custom pivot): the
 * screen x (from the sprite's x, unscaled) of texture column `tx` inside a crop [cx, cx + cw) of a frame `w` wide with
 * display origin `dox`. Unmirrored the quad starts at crop.x; mirrored the UV window is mirrored (w − cx − cw) but the
 * quad is still offset by crop.x before the −1 scale.
 */
function phaserCropX(tx:number,cx:number,cw:number,w:number,dox:number,flip:boolean){
  if(!flip)return -dox+tx;
  const u0=w-cx-cw,x0=-dox+cx+(-w+2*dox);
  return -(x0+(tx-u0));
}
test('the fingers patch lands on the drawn hand, mirrored frames included (E, NE, SW showed the handle over the fist)', ()=>{
  const geom={cellW:96,cellH:96,crop:{x:20,y:10,w:56,h:80},cw:28,ch:40,pad:4,ring:2,perCss:1,slotW:36,slotH:48,kx:2,ky:2};
  for(const g of [undefined,geom])for(const flip of [false,true])for(const hx of [30,44,61]){
    const w=g?g.slotW:96,x=g?g.pad+(hx-g.crop.x)/g.kx:hx,dox=.42*w,[cx,,cw]=patchCrop({x:hx,y:50},flip,g);
    // Where the sprite itself draws that hand (Phaser mirrors inside the frame's box), and where the patch draws it.
    const sprite=flip?w-dox-x:x-dox,patch=phaserCropX(x,cx,cw,w,dox,flip)+patchShift({x:hx},flip,g);
    assert.ok(Math.abs(patch-sprite)<1e-9,`${g?'city':'cell'} flip=${flip} hand ${hx}: patch ${patch} vs hand ${sprite}`);
  }
  assert.equal(patchShift({x:30},false),0);
  const sprites={handPose:()=>({point:{x:30,y:50,behind:false},ox:.5,oy:.75,scale:.5,flip:true,direction:'E' as const})};
  const sprite={x:100,y:0,depth:1,rotation:0,visible:true,texture:{key:'k'},frame:{name:0},originX:.5,originY:.75,scaleX:.5,scaleY:.5,flipX:true};
  assert.equal(heldHand(sprites,sprite)!.patch!.x,100+(96-60)*.5);
});

test('the hand never jumps between two poses of a dense sheet (no swap to the other hand, the elbow or the face)', ()=>{
  for(const id of HELD)for(const [name,f] of shown(id)){
    if(!name.includes('128-'))continue;
    const pts=HAND_POINTS[f.file].points;
    for(let i=1;i<pts.length;i++){
      const d=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);
      assert.ok(d<=9,`${name} ${i-1}→${i}: ${d.toFixed(1)} px`);
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
  // The firearms have their hold; the Pack 12 weapons hold their sticker small (DEFAULT_HOLD) until their in-hand art.
  for(const id of Object.keys(FIRE_LOOK))if(!PACK12_ITEMS.includes(id))assert.ok(WEAPON_HOLD[id],`${id} has a hold`);
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

test('patchCrop: the fingers square around the hand in the shown frame, mirrored with it, mapped onto a city copy', ()=>{
  const r=HAND_PATCH;
  assert.deepEqual(patchCrop({x:30,y:50},false),[30-r,50-r,2*r,2*r]);
  // Phaser crops a mirrored frame in its mirrored coordinates: the square goes to 96 − x.
  assert.deepEqual(patchCrop({x:30,y:50},true),[66-r,50-r,2*r,2*r]);
  // A city copy: the cell's crop from (20, 10), resampled 2:1, padded 4: the hand at 4 + (30 − 20)/2 = 9, 4 + 40/2 = 24.
  const geom={cellW:96,cellH:96,crop:{x:20,y:10,w:56,h:80},cw:28,ch:40,pad:4,ring:2,perCss:1,slotW:36,slotH:48,kx:2,ky:2};
  assert.deepEqual(patchCrop({x:30,y:50},false,geom),[9-r/2,24-r/2,r,r]);
  assert.deepEqual(patchCrop({x:30,y:50},true,geom),[27-r/2,24-r/2,r,r]);
});

test('heldLook: the held weapon loses the icon\'s gloss (greyer, highlights down, darker), alpha kept', ()=>{
  const px=new Uint8ClampedArray([255,255,255,255, 200,60,40,128]);
  heldLook(px);
  assert.ok(px[0]<235&&px[0]===px[1]&&px[1]===px[2],'a white highlight comes down');
  assert.equal(px[3],255);assert.equal(px[7],128);
  // The red is closer to its grey than before.
  assert.ok(px[4]-px[6]<(200-40)*.85,String([...px.slice(4,8)]));
  assert.ok(HELD_TINT.behind<HELD_TINT.front);
});

test('the weapons go in the hands after the scene placed and animated every hero this frame (arma-flutua-corrida-clt)', ()=>{
  // Drawn inside horde.update() the weapon read the hero sprite before place() moved it and before the allies were
  // animated: a frame's step behind a running hero, and from the back its stale depth put it over him.
  const scene=readFileSync(new URL('../../src/client/scene.ts',import.meta.url),'utf8');
  const arsenal=readFileSync(new URL('../../src/client/render/arsenal-fx.ts',import.meta.url),'utf8');
  assert.match(scene,/handsFromScene:true/);
  const coop=scene.slice(scene.indexOf('private updateCoop('));
  const at=(s:string)=>{const i=coop.indexOf(s);assert.ok(i>=0,s);return i;};
  const hands=at('this.horde?.hands();');
  assert.ok(at('this.horde?.update(time,delta)')<hands,'after the horde update');
  assert.ok(at('this.place();')<hands,'after the hero is placed');
  assert.ok(at('this.sprites.animate(objects.image')<hands&&at('objects.image.setPosition(q.x,q.y)')<hands,'after the allies');
  assert.match(arsenal,/if\(!this\.options\.handsFromScene\)this\.drawHands\(\);/);
});
