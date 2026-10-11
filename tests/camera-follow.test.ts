// Follow camera (D-019): NEW-20261009-ORQ-camera-segue + NEW-20261009-UX-camera-segue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FollowCamera,followZoom,followTarget,anchorOf,lookLimit,offsetBudget,toScreen,edgeOf,freeAround,
  VS_HERO_SHORT_RATIO,LAG_X_PX,LAG_Y_PX,FOLLOW_TAU_S,type Rect} from '../src/game/framing.ts';
import {projectView,unprojectView,viewDepth,rotationLocked,screenDirection,rotateVector} from '../src/game/projection.ts';
import {HERO_MIN_SCREEN_PX,HERO_WORLD_PX,VISIBLE_LONG_PX,VISIBLE_SHORT_PX,visibleOffset,TILE_X,TILE_Y} from '../src/game/sim/offscreen.ts';
import {ENEMY_ART} from '../src/game/render/keys.ts';
import {Projector} from '../src/game/render/projector.ts';
import {TerrainField} from '../src/game/terrain/field.ts';
import {SPEED} from '../src/game/world.ts';
import {HERO_MARGIN} from '../src/game/hud/zones.ts';

const PORTRAIT={width:390,height:844},LANDSCAPE={width:844,height:390};
// Useful areas measured on the real scene (6 players, round 1; window.__zones.measure()).
const USEFUL_P:Rect={x:70,y:202.6,width:320,height:481.4},USEFUL_L:Rect={x:138,y:154,width:582,height:155.1};
const HERO={width:56,height:56};

test('zoom: the VS ratio is under the D-009 floor on a phone, so the hero is 56 CSS px and a gosma ≥ 28 px',t=>{
  // VS (Steam screenshots 1280×800): hero 56 px on 800 → 7%. On 390 px that is 27 px, under the 56 px floor.
  assert.ok(VS_HERO_SHORT_RATIO*390<HERO_MIN_SCREEN_PX);
  for(const vp of [PORTRAIT,LANDSCAPE]){
    const z=followZoom(vp);
    assert.ok(Math.abs(HERO_WORLD_PX*z-56)<1e-9,`${vp.width}: hero ${HERO_WORLD_PX*z}`);
    for(const kind of ['gosma','pernilongo','fiscal','tio-pave'] as const)assert.ok(ENEMY_ART[kind].height*z>=28,`${kind} ${ENEMY_ART[kind].height*z}`);
    t.diagnostic(`${vp.width}×${vp.height}: zoom ${z.toFixed(4)}, hero ${(HERO_WORLD_PX*z).toFixed(1)} px, gosma ${(ENEMY_ART.gosma.height*z).toFixed(1)} px, pernilongo ${(ENEMY_ART.pernilongo.height*z).toFixed(1)} px`);
  }
  // One zoom per orientation: it does not depend on the useful area, only on the viewport.
  assert.equal(followZoom(PORTRAIT),followZoom(LANDSCAPE));
  // Any phone: never under the floor, never more world than the off-screen contract.
  for(const [w,h] of [[320,640],[360,780],[390,844],[412,915],[430,932],[844,390],[932,430],[1280,720],[640,320],[1080,2520]]){
    const z=followZoom({width:w,height:h}),short=Math.min(w,h),long=Math.max(w,h);
    assert.ok(HERO_WORLD_PX*z>=HERO_MIN_SCREEN_PX-1e-9,`${w}x${h}`);
    assert.ok(short/z<=VISIBLE_SHORT_PX+1e-6&&long/z<=VISIBLE_LONG_PX+1e-6,`${w}x${h}: ${short/z} × ${long/z}`);
  }
});

test('anchor: the hero\'s body is centred in the useful area, not on the screen',()=>{
  for(const [vp,useful] of [[PORTRAIT,USEFUL_P],[LANDSCAPE,USEFUL_L]] as const){
    const z=followZoom(vp),hero={x:1234.5,y:-678.25},c=followTarget(hero,vp,z,useful,{x:0,y:0},HERO);
    const feet=toScreen(hero,c,vp,z);
    assert.ok(Math.abs(feet.x-(useful.x+useful.width/2))<1e-6);
    assert.ok(Math.abs(feet.y-HERO.height/2-(useful.y+useful.height/2))<1e-6,'body centre on the useful centre');
    // Hero box ± HERO_MARGIN inside the useful area (the zones audit checks the HUD boxes against it).
    assert.ok(feet.y-HERO.height-HERO_MARGIN>=useful.y-1e-6&&feet.y+HERO_MARGIN<=useful.y+useful.height+1e-6,`${vp.width}`);
  }
  // Without a HUD (solo, waiting room) the screen centre.
  const a=anchorOf(PORTRAIT,followZoom(PORTRAIT));assert.equal(a.x,195);
});

test('look-ahead: ~15% of the useful half extent, never pushing the hero box ± 40 px out of the useful area',()=>{
  const zp=followZoom(PORTRAIT),lp=lookLimit(PORTRAIT,zp,USEFUL_P,HERO);
  assert.ok(Math.abs(lp.x*zp-.15*160)<1e-6&&Math.abs(lp.y*zp-.15*USEFUL_P.height/2)<1e-6);
  const zl=followZoom(LANDSCAPE),ll=lookLimit(LANDSCAPE,zl,USEFUL_L,HERO);
  // Landscape is ~155 px tall: what is left over the hero box and its margin.
  assert.ok(Math.abs(ll.y*zl-(USEFUL_L.height/2-HERO.height/2-HERO_MARGIN))<1e-6,`${ll.y*zl}`);
  for(const [vp,useful,l] of [[PORTRAIT,USEFUL_P,lp],[LANDSCAPE,USEFUL_L,ll]] as const){
    const z=followZoom(vp);
    for(const [sx,sy] of [[1,1],[-1,1],[1,-1],[-1,-1]]){
      const hero={x:0,y:0},feet=toScreen(hero,followTarget(hero,vp,z,useful,{x:sx*l.x,y:sy*l.y},HERO),vp,z);
      assert.ok(feet.y-HERO.height-HERO_MARGIN>=useful.y-1e-6&&feet.y+HERO_MARGIN<=useful.y+useful.height+1e-6,`${vp.width} ${sx},${sy}`);
      assert.ok(feet.x-HERO.width/2-HERO_MARGIN>=useful.x-1e-6&&feet.x+HERO.width/2+HERO_MARGIN<=useful.x+useful.width+1e-6);
    }
  }
});

/** Walks the hero at SPEED in world direction `dir` for `seconds` at `fps`, returning per-frame samples. */
function walk(camera:FollowCamera,vp:typeof PORTRAIT,useful:Rect,start:{x:number;y:number},dir:{x:number;y:number},seconds:number,fps:number,view=0){
  const z=followZoom(vp),out:{hero:{x:number;y:number};center:{x:number;y:number};screen:{x:number;y:number}}[]=[];
  let p={...start};const n=Math.round(seconds*fps),l=Math.hypot(dir.x,dir.y)||1;
  for(let i=0;i<n;i++){
    p={x:p.x+dir.x/l*SPEED/fps,y:p.y+dir.y/l*SPEED/fps};
    const hero=projectView(p,view),center={...camera.step(hero,1/fps,vp,z,useful,HERO)};
    out.push({hero,center,screen:toScreen(hero,center,vp,z)});
  }
  return out;
}

test('smooth follow: no tremor at 30 and 60 fps, steady hero on screen, lag inside the contract',t=>{
  for(const fps of [30,60])for(const [vp,useful] of [[PORTRAIT,USEFUL_P],[LANDSCAPE,USEFUL_L]] as const)for(const dir of [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:-1,y:.3}]){
    const cam=new FollowCamera(),z=followZoom(vp),start={x:5000,y:-3000};
    cam.snap(projectView(start,0),vp,z,useful,HERO);
    const s=walk(cam,vp,useful,start,dir,4,fps);
    // After ~2 s the hero sits still on screen (± 0.05 px frame to frame): the camera moves with it, no shake.
    let jitter=0;for(let i=fps*2+1;i<s.length;i++)jitter=Math.max(jitter,Math.hypot(s[i].screen.x-s[i-1].screen.x,s[i].screen.y-s[i-1].screen.y));
    assert.ok(jitter<.05,`${fps} fps ${vp.width} ${JSON.stringify(dir)}: ${jitter}`);
    // Camera speed changes smoothly (no tranco): frame-to-frame change of the camera step under 2 world px.
    let jerk=0;for(let i=2;i<s.length;i++){const a={x:s[i].center.x-s[i-1].center.x,y:s[i].center.y-s[i-1].center.y},b={x:s[i-1].center.x-s[i-2].center.x,y:s[i-1].center.y-s[i-2].center.y};jerk=Math.max(jerk,Math.hypot(a.x-b.x,a.y-b.y));}
    assert.ok(jerk<2,`jerk ${jerk}`);
    const budget=offsetBudget(vp);
    for(const f of s){assert.ok(Math.abs(f.hero.x-f.center.x)<=budget.x+LAG_X_PX+1e-6&&Math.abs(f.hero.y-f.center.y)<=budget.y+LAG_Y_PX+1e-6);}
    if(fps===60&&dir.x===1&&dir.y===0)t.diagnostic(`${vp.width}: hero settles at ${s.at(-1)!.screen.x.toFixed(1)},${s.at(-1)!.screen.y.toFixed(1)}; look ${cam.look.x.toFixed(1)},${cam.look.y.toFixed(1)} world px`);
  }
});

test('stopping eases back without a jump; a teleport snaps within the contract',()=>{
  const vp=PORTRAIT,z=followZoom(vp),cam=new FollowCamera();
  cam.snap(projectView({x:12,y:17},0),vp,z,USEFUL_P,HERO);
  const s=walk(cam,vp,USEFUL_P,{x:12,y:17},{x:1,y:-1},2,60);
  const stop=s.at(-1)!.hero;let prev={...cam.center},prevStep=0,maxStep=0;
  for(let i=0;i<120;i++){const c=cam.step(stop,1/60,vp,z,USEFUL_P,HERO),stepLen=Math.hypot(c.x-prev.x,c.y-prev.y);
    if(i>0)maxStep=Math.max(maxStep,Math.abs(stepLen-prevStep));prevStep=stepLen;prev={...c};}
  assert.ok(maxStep<2,`stop jerk ${maxStep}`);
  assert.ok(Math.abs(cam.look.x)<1&&Math.abs(cam.look.y)<1,'look-ahead goes back to rest');
  const far=projectView({x:40,y:40},0),c=cam.step(far,1/60,vp,z,USEFUL_P,HERO),budget=offsetBudget(vp);
  assert.ok(Math.abs(far.x-c.x)<=budget.x+LAG_X_PX+1e-6&&Math.abs(far.y-c.y)<=budget.y+LAG_Y_PX+1e-6);
  assert.ok(FOLLOW_TAU_S>=.12&&FOLLOW_TAU_S<=.2,'UX: 120-200 ms');
});

test('off-screen contract: every point on a follow-camera screen counts as visible for the director (4 views, offsets, lag)',()=>{
  // The director never spawns on a phone's screen only if the screen rectangle around the hero stays inside offscreen.ts.
  for(const [vp,useful,landscape] of [[PORTRAIT,USEFUL_P,false],[LANDSCAPE,USEFUL_L,true]] as const)for(let view=0;view<4;view++){
    const z=followZoom(vp),l=lookLimit(vp,z,useful,HERO),budget=offsetBudget(vp);
    for(const [lx,ly,gx,gy] of [[1,1,1,1],[-1,-1,-1,-1],[1,-1,1,-1],[-1,1,-1,1],[0,0,0,0]]){
      const hero={x:0,y:0},t=followTarget(hero,vp,z,useful,{x:lx*l.x,y:ly*l.y},HERO);
      // Worst case: the camera also trails by the whole lag, clamped to the contract like FollowCamera.step.
      const c={x:Math.min(hero.x+budget.x+LAG_X_PX,Math.max(hero.x-budget.x-LAG_X_PX,t.x+gx*LAG_X_PX)),y:Math.min(hero.y+budget.y+LAG_Y_PX,Math.max(hero.y-budget.y-LAG_Y_PX,t.y+gy*LAG_Y_PX))};
      for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){
        // Screen point -> flat world offset from the hero (elevation is inside the contract's ELEVATION_PX margin).
        const sx=(i/10*vp.width-vp.width/2)/z+c.x,sy=(j/10*vp.height-vp.height/2)/z+c.y;
        const a=sx/TILE_X,b=sy/TILE_Y,q={x:(b+a)/2,y:(b-a)/2},w=rotateVector(q,-view);
        assert.ok(visibleOffset(w.x,w.y,{landscape,view}),`${vp.width} view ${view} (${i},${j})`);
        assert.ok(visibleOffset(w.x,w.y),'and in the union of all cameras');
      }
    }
  }
});

test('the 4 views turn around the hero: same screen spot after a turn, 4 turns give back the same camera',()=>{
  const vp=PORTRAIT,z=followZoom(vp),p={x:5000.25,y:-1234.5};
  const centers=[0,1,2,3,4].map(view=>{const cam=new FollowCamera();const hero=projectView(p,view);const c=cam.snap(hero,vp,z,USEFUL_P,HERO);return {c,s:toScreen(hero,c,vp,z)};});
  for(const k of centers)assert.ok(Math.hypot(k.s.x-centers[0].s.x,k.s.y-centers[0].s.y)<1e-6,'hero stays put on screen');
  assert.deepEqual(centers[4].c,centers[0].c);
  // The joystick stays screen relative in all 4 views (up on the stick is up on the screen).
  for(let view=0;view<4;view++){const d=screenDirection(0,-1,view),q=rotateVector(d,view);assert.ok(Math.abs(q.x-q.y)<1e-12&&(q.x+q.y)<0);}
});

test('project/unproject round trip far from the origin (x = 5 000) in the 4 views, island math and endless terrain',()=>{
  const field=new TerrainField(424242,{world:'infinito'});
  for(let view=0;view<4;view++)for(const [x,y] of [[5000,3],[5000.4,-4999.7],[-5000,12.25],[7.5,5000]]){
    const back=unprojectView(projectView({x,y},view),view);
    assert.ok(Math.hypot(back.x-x,back.y-y)<1e-6,`flat ${view} ${x},${y}`);
    const b2=unprojectView(projectView({x,y},view,field),view,field);
    assert.ok(Math.hypot(b2.x-x,b2.y-y)<2e-3,`terrain ${view} ${x},${y}: ${b2.x},${b2.y}`);
  }
});

test('endless world: depths re-based on the hero stay in the island range and keep the order (scene + Projector)',()=>{
  const origin={x:5000,y:-3000},layersBottom=-9970,hudTop=95000;
  for(let view=0;view<4;view++){
    const pr=new Projector(view);pr.origin=origin;
    const pts=[{x:4990,y:-3010},{x:5000,y:-3000},{x:5012,y:-2988},{x:5030,y:-2970},{x:4970,y:-3030}];
    for(const p of pts){
      const d=viewDepth(p,view,origin);
      assert.ok(d>layersBottom&&d<hudTop,`${view} ${d}`);
      assert.ok(Math.abs(pr.depth(p.x,p.y)-d)<1e-6);
    }
    for(let i=1;i<pts.length;i++)assert.equal(Math.sign(viewDepth(pts[i],view,origin)-viewDepth(pts[0],view,origin)),Math.sign(viewDepth(pts[i],view)-viewDepth(pts[0],view)));
  }
  // The island default is unchanged.
  assert.equal(viewDepth({x:3,y:7},1,{x:12,y:12}),viewDepth({x:3,y:7},1));
});

test('rotation is refused during a wave and allowed in the intermission, lobby, countdown, result and solo',()=>{
  assert.equal(rotationLocked('combat','wave'),true);
  assert.equal(rotationLocked('combat',undefined),true,'combat before the first round state: locked');
  for(const [run,round] of [['combat','prepare'],['lobby',undefined],['countdown',undefined],['result','wave'],[undefined,undefined]] as const)
    assert.equal(rotationLocked(run,round),false,`${run}/${round}`);
});

test('off-screen API: inside the useful area, or the point on its edge towards it',()=>{
  const area:Rect={x:100,y:200,width:200,height:400};
  assert.equal(edgeOf({x:150,y:300},area).inside,true);
  const right=edgeOf({x:900,y:400},area);assert.equal(right.inside,false);assert.ok(Math.abs(right.edge.x-300)<1e-9&&Math.abs(right.edge.y-400)<1e-9);
  const up=edgeOf({x:200,y:-1000},area,10);assert.ok(Math.abs(up.edge.y-210)<1e-9&&Math.abs(up.angle+Math.PI/2)<1e-9);
});

test('reduced motion: no look-ahead, the hero stays on the anchor while walking',()=>{
  const vp=PORTRAIT,z=followZoom(vp),cam=new FollowCamera();cam.lookAhead=false;
  cam.snap(projectView({x:12,y:17},0),vp,z,USEFUL_P,HERO);
  walk(cam,vp,USEFUL_P,{x:12,y:17},{x:1,y:-1},3,60);
  assert.deepEqual(cam.look,{x:0,y:0});
});

test('waiting room: the hero goes to the roomiest free band around the waiting panel',()=>{
  // Portrait: the panel spans 122..~600 in the middle; the band below it is the largest.
  const b=freeAround(PORTRAIT,{x:15,y:122,width:360,height:480});
  assert.deepEqual(b,{x:0,y:602,width:390,height:242});
  // Landscape: the panel is a centred column; a side column beats the 126 px strip above it.
  const l=freeAround(LANDSCAPE,{x:224,y:126,width:396,height:254});
  assert.equal(l.height,390);assert.ok(l.width>=224);
});

test('out of the round the budget is lifted (waiting panel); back in the round the camera is inside the contract at once',()=>{
  const vp=PORTRAIT,z=followZoom(vp),band:Rect={x:0,y:602,width:390,height:242},cam=new FollowCamera(),hero=projectView({x:12,y:17},0);
  cam.free=true;cam.snap(hero,vp,z,band,HERO);
  const s=toScreen(hero,cam.center,vp,z);assert.ok(Math.abs(s.y-HERO.height/2-(602+121))<1e-6,'body centred in the band');
  cam.free=false;const c=cam.step(hero,1/60,vp,z,USEFUL_P,HERO),budget=offsetBudget(vp);
  assert.ok(Math.abs(hero.y-c.y)<=budget.y+LAG_Y_PX+1e-6);
});
