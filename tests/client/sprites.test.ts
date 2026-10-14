import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {classes} from '../../src/rules/classes.ts';
import {spriteCatalog} from '../../src/client/sprites/sprite-catalog.ts';
import {SpriteMotion,SPRITE_CLIPS,ATTACK_VISUAL_MS} from '../../src/client/sprites/sprite-motion.ts';
import {HERO_SPEED_MULT} from '../../src/maps/world.ts';
import {Simulation} from '../../multiplayer/simulation.ts';
import {packPlayer,unpackPlayer} from '../../src/protocol/room.ts';

// Light under memory pressure (many test processes at once): no libvips operation cache, one libvips thread.
sharp.cache(false);sharp.concurrency(1);

test('all 36 class IDs have a transparent 18-frame sheet and a measured scale',async()=>{
  assert.equal(Object.keys(spriteCatalog).length,classes.length);
  for(const hero of classes){
    assert.ok(spriteCatalog[hero.id].height>0);
    const m=await sharp(`public/art/sprites/${hero.id}.webp`).metadata();
    assert.deepEqual([m.width,m.height,m.hasAlpha],[1152,576,true],hero.id);
  }
});

test('an attack finishes once, survives movement, then yields to locomotion',()=>{
  const motion=new SpriteMotion();
  assert.equal(motion.update(0,false),'idle');
  assert.equal(motion.update(20,true),'walk');
  assert.equal(motion.update(100,true,5),'attack');
  assert.equal(motion.update(450,false,5),'attack');
  assert.equal(motion.update(1099,true,5),'attack');
  assert.equal(motion.update(1100,false,5),'idle');
  assert.equal(motion.update(1200,false,17),'attack');
  assert.equal(motion.update(1250,true,17,false),'idle');
  assert.equal(motion.update(1260,false,17,true),'idle');
});

test('weapon fire events reach observers through attackTick without changing old-wire compatibility',()=>{
  // Weapons auto-fire now: attackTick is the tick of the player's latest 'fire' event and only moves when one happens.
  const room=new Simulation();room.add('sprite-test','Sprite','pedreiro');room.resetRun();
  const p=room.players.get('sprite-test')!;
  assert.equal(p.attackTick,0);
  let fired=0,last=0;
  for(let i=0;i<1200&&fired<3;i++){
    room.input(p.id,{seq:i+1,x:0,y:0,attack:true});
    const events=room.step();
    // A swing lasts ATTACK_ANIMATION_TICKS (12): weapon fire inside it does not restart it; skill casts have their own field.
    if(events.some(e=>e.type==='fire'&&e.player===p.id&&!e.weapon.startsWith('skill:'))&&room.tick-last>=12){fired++;last=room.tick;assert.equal(p.attackTick,room.tick);}
    else assert.equal(p.attackTick,last,'no new swing without a weapon fire event');
  }
  assert.ok(fired>0,'the starting weapon fires once enemies arrive');
  assert.equal(unpackPlayer(packPlayer(p)).attackTick,p.attackTick);
  const legacy=packPlayer(p);legacy.length=9;assert.equal(unpackPlayer(legacy).attackTick,0);assert.equal(unpackPlayer(legacy).spectator,false);
});

test('all classes hold one idle pose and use half-speed walk and attack clips',()=>{
  assert.deepEqual(SPRITE_CLIPS.idle.frames,[0]);
  assert.equal(SPRITE_CLIPS.walk.frameRate,10/2*HERO_SPEED_MULT,'the walk cycle follows the 2× walk');
  assert.equal(SPRITE_CLIPS.attack.frameRate,12/2);
  assert.equal(ATTACK_VISUAL_MS,1000);
  assert.equal(SPRITE_CLIPS.attack.repeat,0);
});

test('overlapping server attacks cannot restart or extend the slower visual swing',()=>{
  const motion=new SpriteMotion();
  assert.equal(motion.update(0,false,1),'attack');
  assert.equal(motion.update(600,true,13),'attack');
  assert.equal(motion.update(999,true,13),'attack');
  assert.equal(motion.update(1000,true,13),'walk');
  assert.equal(motion.update(1200,false,25),'attack');
  assert.equal(motion.update(2200,false,25),'idle');
  for(let time=2300;time<10000;time+=100)assert.equal(motion.update(time,false,25),'idle');
});

test('rematch clears old attack ticks and accepts the first swing of the new round',()=>{
  const motion=new SpriteMotion();
  assert.equal(motion.update(10000,false,240),'attack');
  assert.equal(motion.update(10100,false,0),'idle');
  assert.equal(motion.update(10200,false,1),'attack');
});

// NEW-20261009-ORQ-sprites-4-direcoes: 4 diagonals (front/back × left/right) picked from the motion on screen.
import {FacingTracker,FACINGS,FACING_FRAMES,FACING_HYSTERESIS,FACING_STEP,legacyFlip,screenMotion,turnFacing,type Facing} from '../../src/client/sprites/sprite-motion.ts';
import {directionalSheets,sheetKey,LAB_SHEETS} from '../../src/client/sprites/sprite-sheets.ts';
import {screenDirection,rotateVector,projectView} from '../../src/client/projection.ts';
import {validateDirectionalAtlas,validateSingleSheet,approvedPivotX,figureBox,raw,DIR4,FACING_BLOCKS,PIVOT_Y,CELL} from '../../scripts/sprite-atlas.mjs';
import {importDirectional,readCatalog} from '../../scripts/import-dir4.mjs';
import {mkdtempSync,copyFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {existsSync,readdirSync} from 'node:fs';

const expected=(sx:number,sy:number):Facing=>`${sy>0?'front':'back'}-${sx>0?'right':'left'}` as Facing;
/** Walks a tracker for `frames` frames of 1/60 s at hero speed along a screen-relative joystick (the real input path). */
function walk(tracker:FacingTracker,jx:number,jy:number,view:number,frames=10){
  let facing:Facing='front-right';
  for(let i=0;i<frames;i++){const d=screenDirection(jx,jy,view),n=Math.hypot(d.x,d.y)||1;facing=tracker.update(d.x/n*3.1/60,d.y/n*3.1/60,view);}
  return facing;
}

test('4 directions: each screen diagonal of the joystick shows its drawing in each of the 4 camera views',()=>{
  for(let view=0;view<4;view++)for(const [jx,jy] of [[1,1],[-1,1],[1,-1],[-1,-1],[.9,.4],[-.3,.95],[.95,-.35],[-.5,-.8]]){
    const tracker=new FacingTracker();
    assert.equal(walk(tracker,jx,jy,view),expected(jx,jy),`view ${view} joystick ${jx},${jy}`);
    // The drawing follows the projected motion, not the world axes: the same check through projectView.
    const d=screenDirection(jx,jy,view),a=projectView({x:0,y:0},view),b=projectView({x:d.x,y:d.y},view);
    assert.equal(expected(b.x-a.x,b.y-a.y),expected(jx,jy));
  }
});

test('4 directions: a figure standing still turns with the camera like the ground under it',()=>{
  for(let view=0;view<4;view++)for(const [wx,wy] of [[1,0],[0,1],[-1,0],[0,-1],[1,.3],[-.2,1]]){
    const tracker=new FacingTracker();
    for(let i=0;i<5;i++)tracker.update(wx*.05,wy*.05,view);
    for(let next=0;next<4;next++){
      const s=screenMotion(wx,wy,next);
      assert.equal(tracker.update(0,0,next),expected(s.x,s.y),`walked in view ${view}, seen in view ${next}`);
    }
  }
  // One quarter turn of the camera moves every diagonal one step along the same cycle.
  for(const facing of FACINGS){assert.equal(turnFacing(turnFacing(facing,1),-1),facing);assert.equal(turnFacing(facing,4),facing);}
  const s=screenMotion(1,0,1);assert.equal(turnFacing('front-right',1),expected(s.x,s.y));
});

test('4 directions: hysteresis keeps the drawing while the thumb runs along a border',()=>{
  for(let view=0;view<4;view++){
    // Right along the screen's horizontal, wobbling ±10° (inside the 15° band): stays front (it came from front).
    const tracker=new FacingTracker();
    assert.equal(walk(tracker,1,1,view),'front-right');
    const changes=new Set<Facing>();
    for(let i=0;i<120;i++){const a=(i%2?10:-10)*Math.PI/180;changes.add(walk(tracker,Math.cos(a),Math.sin(a),view,1));}
    assert.deepEqual([...changes],['front-right'],`horizontal wobble, view ${view}`);
    // 20° up clears the band: now the back.
    const up=-20*Math.PI/180;assert.equal(walk(tracker,Math.cos(up),Math.sin(up),view,2),'back-right');
    // Straight up the screen with ±10° wobble: keeps its side (right); 25° to the left clears it.
    const side=new Set<Facing>();
    for(let i=0;i<120;i++){const a=(-90+(i%2?10:-10))*Math.PI/180;side.add(walk(tracker,Math.cos(a),Math.sin(a),view,1));}
    assert.deepEqual([...side],['back-right'],`vertical wobble, view ${view}`);
    const left=(-90-25)*Math.PI/180;assert.equal(walk(tracker,Math.cos(left),Math.sin(left),view,2),'back-left');
  }
  assert.ok(FACING_HYSTERESIS>Math.sin(10*Math.PI/180)&&FACING_HYSTERESIS<Math.sin(20*Math.PI/180));
});

test('4 directions: tiny corrections and teleports never turn the figure',()=>{
  const tracker=new FacingTracker();
  assert.equal(walk(tracker,1,1,0),'front-right');
  // A server correction backwards smaller than FACING_STEP, then standing still: nothing changes.
  const back=screenDirection(-1,-1,0),n=Math.hypot(back.x,back.y);
  assert.equal(tracker.update(back.x/n*FACING_STEP*.6,back.y/n*FACING_STEP*.6,0),'front-right');
  assert.equal(tracker.update(0,0,0),'front-right');
  assert.equal(tracker.update(back.x/n*FACING_STEP*.6,back.y/n*FACING_STEP*.6,0),'front-right','the stop clears the gathered jitter');
  // A respawn snap across the map is not a heading.
  assert.equal(tracker.update(-40,-40,0),'front-right');
});

test('4 directions: a remote ally turns by its interpolated velocity, without blinking',()=>{
  // 20 Hz snapshots of an ally walking a screen diagonal with ±0.03 tile noise, drawn at 60 fps by linear interpolation.
  for(let view=0;view<4;view++)for(const [jx,jy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){
    const d=screenDirection(jx,jy,view),n=Math.hypot(d.x,d.y);
    let seed=7;const noise=()=>{seed=(seed*16807)%2147483647;return (seed/2147483647-.5)*.06;};
    const snaps=Array.from({length:40},(_,k)=>({x:d.x/n*3.1*k/20+noise(),y:d.y/n*3.1*k/20+noise()}));
    const tracker=new FacingTracker(),seen:Facing[]=[];let last={...snaps[0]};
    for(let frame=0;frame<39*3;frame++){
      const k=Math.floor(frame/3),t=frame%3/3,p={x:snaps[k].x+(snaps[k+1].x-snaps[k].x)*t,y:snaps[k].y+(snaps[k+1].y-snaps[k].y)*t};
      seen.push(tracker.update(p.x-last.x,p.y-last.y,view));last=p;
    }
    const tail=seen.slice(3);
    assert.ok(tail.every(f=>f===expected(jx,jy)),`view ${view} ${jx},${jy}: ${[...new Set(tail)]}`);
  }
});

test('4 directions: the 36 classes without a 4-direction batch keep exactly the old mirror rule',()=>{
  // No class ships a 4-direction batch yet: every class (the 35 others and the lab one outside the lab) uses its
  // approved single sheet, under the same texture key and clips as before.
  assert.equal(directionalSheets.size,Object.values(spriteCatalog).filter(c=>c.dir4).length);
  const v2Heroes=JSON.parse(readFileSync('public/art/manifest.json','utf8')).groups?.personagens?.pieces??{};
  for(const hero of classes){
    if(spriteCatalog[hero.id].dir4)continue;
    assert.equal(sheetKey(hero.id),`sprite:${hero.id}`,hero.id);
    // An atlas from the art v2 import is fine: the index lists it (the game only uses it once the index is in).
    assert.ok(!existsSync(`public/art/sprites/${hero.id}.dir4.webp`)||v2Heroes[hero.id]?.files?.dir4,`${hero.id}: a 4-direction atlas without its catalog entry`);
  }
  // The flip of the single sheets, copied from the code before this card.
  const old=(flipped:boolean,dx:number,dy:number,view:number)=>{const d=rotateVector({x:dx,y:dy},view);return Math.abs(d.x-d.y)>.001?d.x-d.y<0:flipped;};
  let seed=3;const r=()=>{seed=(seed*48271)%2147483647;return seed/2147483647-.5;};
  for(let i=0;i<4000;i++){
    const flipped=i%2===0,dx=i%7===0?0:r()*.2,dy=i%11===0?dx:r()*.2,view=i%4;
    assert.equal(legacyFlip(flipped,dx,dy,view),old(flipped,dx,dy,view));
  }
  // Every approved sheet is still in place and valid: the new directions only add files.
  // Next to them, only what the art v2 import lists (dir4c, downed, the silhouette) and its group manifest.
  const v2Files=new Set(Object.values(v2Heroes).flatMap((p:any)=>Object.values(p.files??{}).map((f:any)=>f.file)));
  for(const file of readdirSync('public/art/sprites'))if(!v2Files.has(file)&&file!=='manifest.json')assert.match(file,/^[a-z-]+(\.dir4)?\.webp$/);
});

test('4 directions: the local hero faces its joystick, so a 0.5 or 1 tile reconciliation snap never shows its back',()=>{
  for(const snap of [.5,1])for(let view=0;view<4;view++){
    const intent=screenDirection(1,1,view),n=Math.hypot(intent.x,intent.y),step={x:intent.x/n*3.1/60,y:intent.y/n*3.1/60};
    const local=new FacingTracker(),remote=new FacingTracker();
    for(let i=0;i<10;i++){local.update(step.x,step.y,view,intent);remote.update(step.x,step.y,view);}
    assert.equal(local.update(0,0,view,intent),'front-right');
    // The room pulls the predicted hero back by `snap` tiles over 6 frames while the thumb still pushes forward.
    const back={x:-step.x/(3.1/60)*snap/6,y:-step.y/(3.1/60)*snap/6};
    const seenLocal=new Set<Facing>(),seenRemote=new Set<Facing>();
    for(let i=0;i<6;i++){seenLocal.add(local.update(back.x,back.y,view,intent));seenRemote.add(remote.update(back.x,back.y,view));}
    assert.deepEqual([...seenLocal],['front-right'],`local, snap ${snap}, view ${view}`);
    // What the position alone would have shown (the reviewers' finding): the back, for the frames of the snap.
    assert.ok(seenRemote.has('back-left'),`remote rule on the same motion, snap ${snap}`);
    // Thumb off (zero intent): standing still holds the drawing even while the snap moves the figure.
    for(let i=0;i<6;i++)assert.equal(local.update(back.x,back.y,view,{x:0,y:0}),'front-right');
    // The intent turns it at once, with the same hysteresis band.
    assert.equal(local.update(0,0,view,screenDirection(-1,-1,view)),'back-left');
  }
});

const LAB='tests/fixtures/sprites-4dir/cidadao-comum.dir4.webp';
/** The lab atlas decoded once (RGBA) for every test that needs its pixels; the importer calls still read the file. */
let labDecoded:Promise<{data:Buffer,info:sharp.OutputInfo}>|undefined;
const labPixels=()=>labDecoded??=sharp(LAB).ensureAlpha().raw().toBuffer({resolveWithObject:true});
/** A sharp pipeline over the decoded lab pixels: the same image as sharp(LAB), without decoding the file again. */
const labImage=async()=>{const {data,info}=await labPixels();return sharp(data,{raw:{width:info.width,height:info.height,channels:4}});};

test('figure boxes come measured in the catalog (no pixel reads in a match) and match the art',async()=>{
  for(const hero of classes){
    const {data,width,height}=await raw(`public/art/sprites/${hero.id}.webp`);
    assert.deepEqual(spriteCatalog[hero.id].figure,figureBox(data,width,height),hero.id);
  }
  const lab=await labPixels();
  assert.deepEqual(LAB_SHEETS['cidadao-comum'].figure,figureBox(lab.data,lab.info.width,lab.info.height));
});

test('4-direction atlas: the TEST batch passes the importer and matches the lab registry',async()=>{
  // The test batch keeps the approved drawing's own feet column (108.5 px) and mirrors it for the left facings.
  const pivotX=await approvedPivotX('public/art/sprites/cidadao-comum.webp');
  assert.ok(Math.abs(pivotX-108.5)<.2,String(pivotX));
  const result=await validateDirectionalAtlas(LAB,'cidadao-comum',{pivotX});
  assert.deepEqual(result.facings.map(f=>f.facing),[...FACINGS]);
  assert.deepEqual(FACING_BLOCKS,[...FACINGS]);
  assert.equal(FACING_FRAMES,18);
  assert.equal(LAB_SHEETS['cidadao-comum'].height,result.height);
  assert.equal(LAB_SHEETS['cidadao-comum'].url,'/'+LAB);
  for(const f of result.facings){assert.ok(Math.abs(f.baseline-PIVOT_Y)<=2,`${f.facing} feet on ${f.baseline}`);assert.equal(f.rows.length,3);}
  // Checked against the cell centre instead, the same drawing is refused: the class's own column is what keeps
  // today's visible pivot.
  await assert.rejects(validateDirectionalAtlas(LAB,'cidadao-comum'),/frente-direita, parado: pés centrados em x = 109, esperado 96 ± 12/);
  assert.equal((await validateSingleSheet('public/art/sprites/cidadao-comum.webp','cidadao-comum')).height,spriteCatalog['cidadao-comum'].height);
});

test('4-direction atlas: the importer refuses size, transparency, pivot, height, edge, and moved walk or attack cells',async()=>{
  const lab=await labPixels();
  const pivotX=108.5,rowBytes=DIR4.width*4;
  const copy=()=>{const b=Buffer.alloc(lab.data.length);lab.data.copy(b);return b;};
  const image=(data:Buffer)=>sharp(data,{raw:{width:DIR4.width,height:DIR4.height,channels:4}}).png().toBuffer();
  const check=(input:Buffer)=>validateDirectionalAtlas(input,'teste',{pivotX});
  const rejects=async(input:Buffer,pattern:RegExp,not?:RegExp)=>assert.rejects(check(input),(e:Error)=>{
    assert.match(e.message,pattern);if(not)assert.doesNotMatch(e.message,not);return true;});
  await rejects(await (await labImage()).extract({left:0,top:0,width:1152,height:576}).png().toBuffer(),/1152×576, esperado 1152×2304/);
  await rejects(await (await labImage()).flatten({background:'#ffffff'}).png().toBuffer(),/sem transparência/);
  // back-left block (rows 10..12) pushed 6 px down: its feet leave the shared row.
  const moved=copy(),top=9*CELL;
  moved.fill(0,top*rowBytes,(top+6)*rowBytes);lab.data.copy(moved,(top+6)*rowBytes,top*rowBytes,(DIR4.height-6)*rowBytes);
  await rejects(await image(moved),/costas-esquerda, parado: os pés ficam na linha 174/);
  // front-left block drawn 20 % smaller (squashed from the top, feet kept on their row): only the height is wrong.
  const cells=await Promise.all(Array.from({length:18},async(_,f)=>({
    input:await (await labImage()).extract({left:f%6*CELL,top:3*CELL+Math.floor(f/6)*CELL,width:CELL,height:CELL}).resize(CELL,Math.round(CELL*.8),{fit:'fill'}).png().toBuffer(),
    left:f%6*CELL,top:3*CELL+Math.floor(f/6)*CELL+PIVOT_Y-Math.round(PIVOT_Y*.8)})));
  const cleared=copy();cleared.fill(0,3*CELL*rowBytes,6*CELL*rowBytes);
  await rejects(await sharp(cleared,{raw:{width:DIR4.width,height:DIR4.height,channels:4}}).composite(cells).png().toBuffer(),/frente-esquerda, parado: altura/,/pés na linha|pés ficam|pés centrados/);
  // A figure touching the cell edge.
  const clipped=copy();
  for(let y=100;y<110;y++){const i=(y*DIR4.width)*4;clipped[i]=clipped[i+1]=clipped[i+2]=0;clipped[i+3]=255;}
  await rejects(await image(clipped),/desenho encostando na borda da célula \(linha 1, coluna 1\)/);
  // One walk cell of back-right lifted 12 px (a floating frame): caught cell by cell, not only on the standing cell.
  const lifted=copy(),cellTop=7*CELL,cellLeft=2*CELL;
  for(let y=0;y<CELL;y++){
    const from=y+12<CELL?lab.data.subarray(((cellTop+y+12)*DIR4.width+cellLeft)*4,((cellTop+y+12)*DIR4.width+cellLeft+CELL)*4):Buffer.alloc(CELL*4);
    from.copy(lifted,((cellTop+y)*DIR4.width+cellLeft)*4);
  }
  await rejects(await image(lifted),/costas-direita, andar: pés na linha 156 da célula \(linha 8, coluna 3\)/);
  // The whole attack row of back-right moved 20 px to the right: its feet leave front-right's column.
  const shifted=copy();
  for(let y=8*CELL;y<9*CELL;y++)for(let c=0;c<6;c++){
    const row=Buffer.alloc(CELL*4);lab.data.copy(row,20*4,((y*DIR4.width)+c*CELL)*4,((y*DIR4.width)+c*CELL+CELL-20)*4);
    row.copy(shifted,((y*DIR4.width)+c*CELL)*4);
  }
  await rejects(await image(shifted),/costas-direita, ataque: pés centrados em .* \(espelhado\), frente-direita em/);
});

test('4-direction import is all-or-nothing: one bad atlas writes nothing, not even the good one',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'dir4-'));
  try{
    const root=path.join(dir,'lote'),out=path.join(dir,'out'),catalogFile=path.join(dir,'catalog.ts');
    mkdirSync(path.join(root,'cidadao-comum'),{recursive:true});
    await (await labImage()).png().toFile(path.join(root,'cidadao-comum','atlas-4dir.png'));
    // mendigo: the approved single sheet passed off as a 4-direction atlas (wrong size).
    await sharp('public/art/sprites/mendigo.webp').png().toFile(path.join(root,'mendigo.dir4.png'));
    copyFileSync('src/client/sprites/sprite-catalog.ts',catalogFile);
    const before=readFileSync(catalogFile,'utf8'),ids=classes.map(c=>c.id);
    await assert.rejects(importDirectional({root,ids,outDir:out,catalogFile}),(e:Error)=>/Nada foi gravado/.test(e.message)&&/mendigo: atlas de 4 direções com 1152×576/.test(e.message));
    assert.ok(!existsSync(path.join(out,'cidadao-comum.dir4.webp')),'no orphan atlas');
    assert.equal(readFileSync(catalogFile,'utf8'),before,'catalog untouched');
    // Without the bad one: the good one goes in, with its catalog entry; a second run refuses to overwrite it.
    rmSync(path.join(root,'mendigo.dir4.png'));
    const {report}=await importDirectional({root,ids,outDir:out,catalogFile});
    assert.deepEqual(report.map(r=>r.id),['cidadao-comum']);
    assert.ok(existsSync(path.join(out,'cidadao-comum.dir4.webp')));
    const catalog=await readCatalog(catalogFile);
    assert.deepEqual(catalog['cidadao-comum'].dir4,{height:128,figure:LAB_SHEETS['cidadao-comum'].figure});
    assert.equal(catalog['cidadao-comum'].height,spriteCatalog['cidadao-comum'].height);
    await assert.rejects(importDirectional({root,ids,outDir:out,catalogFile}),/já existe; use --replace/);
    assert.equal((await importDirectional({root,ids,outDir:out,catalogFile,replace:true})).report.length,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
