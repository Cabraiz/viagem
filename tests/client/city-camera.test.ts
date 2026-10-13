// City camera (cidade-04): D-026 world proportions with the D-030 hero floor, figures scaled by CITY_VIEW_SCALE.
// Results only (D-031): no time or memory limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {CITY_VIEW_SCALE,ENDLESS_FOLLOW,FollowCamera,cityZoom,followTarget,followWorld,followZoom,hordeUiScale,lookLimit,offsetBudget,
  toScreen,worldZoom,LAG_X_PX,LAG_Y_PX,type Rect} from '../../src/client/framing.ts';
import {projectView,rotateVector} from '../../src/client/projection.ts';
import {HERO_MIN_SCREEN_PX,HERO_WORLD_PX,TILE_X,TILE_Y,visibleOffset} from '../../src/contract/offscreen.ts';
import {ENEMY_ART} from '../../src/client/render/keys.ts';
import {SCALE_PROFILES,zoomFor} from '../../src/rules/index.ts';
import {CITY_VIEW_SCALE as SIM_CITY_VIEW_SCALE,cityVisible} from '../../src/sim/city/avenues.ts';
import {CityTerrain,cityAsField} from '../../src/maps/city/terrain.ts';
import {SceneTerrain,sameWorld,worldCamera} from '../../src/client/world-swap.ts';
import {decodeCityAsset} from '../../src/maps/city-asset.ts';
import {TerrainField} from '../../src/maps/terrain/field.ts';
import {CITY_HERO_SPEED,SPEED,heroSpeed} from '../../src/maps/world.ts';

const PORTRAIT={width:390,height:844},LANDSCAPE={width:844,height:390};
// Useful areas measured on the real scene (camera-follow.test.ts), CSS px: the same HUD in the city.
const USEFUL_P:Rect={x:70,y:202.6,width:320,height:481.4},USEFUL_L:Rect={x:138,y:154,width:582,height:155.1};
/** The hero's drawn box in CSS px: 56 × 56 in both worlds. */
const HERO={width:56,height:56};
const UNIT_X=TILE_X*Math.SQRT2;

const fromRoot=(path:string)=>fileURLToPath(new URL(`../../${path}`,import.meta.url));
function realCity():CityTerrain{
  const text=readFileSync(fromRoot('public/maps/cidade-nevada.json'),'utf8');
  const hash=(JSON.parse(readFileSync(fromRoot('public/maps/cidade-nevada.manifest.json'),'utf8')) as {hash:string}).hash;
  const r=decodeCityAsset(text);if(!r.ok)throw new Error(r.error);
  return new CityTerrain(r.asset,hash);
}
const city=realCity(),island=new TerrainField(424242),endless=new TerrainField(424242,{world:'infinito'});
const cell=SCALE_PROFILES['cidade-nevada'].cell;
/** Visible world width in cells along screen x for a zoom. */
const cellsAt=(width:number,zoom:number)=>width/zoom/UNIT_X/cell;

test('CITY_VIEW_SCALE: the city drawn hero over the endless one (0.88/1.616), recomputed from the rules and equal to the sim',t=>{
  const recomputed=SCALE_PROFILES['cidade-nevada'].hero.drawnSize/SCALE_PROFILES.infinito.hero.drawnSize;
  assert.equal(CITY_VIEW_SCALE,recomputed);
  assert.equal(CITY_VIEW_SCALE,SIM_CITY_VIEW_SCALE,'the sim (avenues.ts cityVisible) and the client use the same scale');
  // 0.88 u (one city cell) over 96 world px = 96/(42·√2) ≈ 1.616 u.
  assert.ok(Math.abs(CITY_VIEW_SCALE-.88/(HERO_WORLD_PX/UNIT_X))<1e-12);
  assert.ok(Math.abs(CITY_VIEW_SCALE-.5445)<5e-4,`${CITY_VIEW_SCALE}`);
  t.diagnostic(`CITY_VIEW_SCALE ${CITY_VIEW_SCALE.toFixed(6)}`);
});

test('city zoom (D-030): ≈1.0713 on both reference phones, ≈15.07 cells landscape and ≈6.96 portrait, the hero 56 CSS px after the actor scale',t=>{
  for(const [vp,cells] of [[PORTRAIT,6.96],[LANDSCAPE,15.07]] as const){
    const z=cityZoom(vp),r=zoomFor(SCALE_PROFILES['cidade-nevada'],vp.width,vp.height);
    assert.ok(Math.abs(z-1.0713)<1e-4,`${vp.width}: zoom ${z}`);
    assert.ok(Math.abs(z-r.pixelsPerUnit/UNIT_X)<1e-9,'the rules zoomFor, in Phaser terms');
    assert.equal(r.floored,true,'the 56 px floor wins over the faithful 18 / 10.5 cells');
    assert.ok(Math.abs(cellsAt(vp.width,z)-cells)<.01,`${vp.width}: ${cellsAt(vp.width,z)} cells`);
    assert.ok(Math.abs(cellsAt(vp.width,z)-r.visibleCells)<1e-6);
    // The sheet is 96 world px tall (CharacterSprites scale 96/height), times viewScale = CITY_VIEW_SCALE.
    const hero=HERO_WORLD_PX*CITY_VIEW_SCALE*z;
    assert.ok(Math.abs(hero-HERO_MIN_SCREEN_PX)<1e-6,`${vp.width}: hero ${hero}`);
    assert.ok(Math.abs(hero-r.heroPixels)<1e-6,'≈ 1 cell: the rules\' drawn hero');
    assert.ok(Math.abs(hero-cell*z*UNIT_X)<1e-6,'one cell wide on screen');
    // Same CSS size as the endless map for every critter: art × scale × city zoom = art × endless zoom.
    for(const kind of Object.keys(ENEMY_ART) as (keyof typeof ENEMY_ART)[])
      assert.ok(Math.abs(ENEMY_ART[kind].height*CITY_VIEW_SCALE*z-ENEMY_ART[kind].height*followZoom(vp))<1e-6,kind);
    t.diagnostic(`${vp.width}×${vp.height}: zoom ${z.toFixed(4)}, ${cellsAt(vp.width,z).toFixed(2)} cells, hero ${hero.toFixed(2)} px`);
  }
  assert.ok(Math.abs(cityZoom(PORTRAIT)-cityZoom(LANDSCAPE))<1e-9,'one zoom on both reference phones');
  // Any phone: never under the floor, and never more world than the sim's city camera (the contract × CITY_VIEW_SCALE).
  for(const [w,h] of [[320,640],[360,780],[412,915],[430,932],[932,430],[1280,720],[640,320],[1080,2520],[768,1024],[1024,768]]){
    const z=cityZoom({width:w,height:h});
    assert.ok(HERO_WORLD_PX*CITY_VIEW_SCALE*z>=HERO_MIN_SCREEN_PX-1e-9,`${w}x${h}`);
    assert.ok(z>=followZoom({width:w,height:h})/CITY_VIEW_SCALE-1e-9,`${w}x${h}: never wider than the endless camera`);
  }
});

test('island and endless map: zoom, world and ui scale exactly as before',()=>{
  for(const vp of [PORTRAIT,LANDSCAPE,{width:1280,height:720}]){
    assert.equal(worldZoom(vp,island),followZoom(vp));
    assert.equal(worldZoom(vp,endless),followZoom(vp));
    assert.equal(worldZoom(vp,undefined),followZoom(vp));
    assert.equal(worldZoom(vp,city),cityZoom(vp));
  }
  assert.equal(followWorld(island),ENDLESS_FOLLOW);assert.equal(followWorld(endless),ENDLESS_FOLLOW);
  assert.deepEqual(ENDLESS_FOLLOW,{scale:1,speed:SPEED});
  for(const z of [.3,.5833,1,2])assert.equal(hordeUiScale(z),Math.max(1,Math.min(2.5,.55/z)));
  assert.deepEqual(offsetBudget(PORTRAIT),offsetBudget(PORTRAIT,1));
});

test('city world: the hero speed comes from maps heroSpeed (≈1.99375 u/s, the rules profile), the offsets scale with CITY_VIEW_SCALE',()=>{
  const w=followWorld(city);
  assert.equal(w.scale,CITY_VIEW_SCALE);
  assert.equal(w.speed,heroSpeed(city));assert.equal(w.speed,CITY_HERO_SPEED);
  assert.ok(Math.abs(w.speed-SCALE_PROFILES['cidade-nevada'].hero.speed)<1e-12&&Math.abs(w.speed-1.99375)<1e-12);
  // Text and balloons: the same CSS size as the endless map (ui × zoom equal), and the horde clamp (≥ 0.5) keeps it.
  for(const vp of [PORTRAIT,LANDSCAPE]){
    const ui=hordeUiScale(cityZoom(vp),CITY_VIEW_SCALE);
    assert.ok(Math.abs(ui*cityZoom(vp)-hordeUiScale(followZoom(vp))*followZoom(vp))<1e-9);
    assert.ok(ui>=.5&&ui<=3,`${ui}`);
  }
  for(const vp of [PORTRAIT,LANDSCAPE]){
    const b=offsetBudget(vp,CITY_VIEW_SCALE),e=offsetBudget(vp),zc=cityZoom(vp),ze=followZoom(vp);
    assert.ok(Math.abs(b.x*zc-e.x*ze)<1e-9&&Math.abs(b.y*zc-e.y*ze)<1e-9,'same CSS budget');
    const lc=lookLimit(vp,zc,undefined,undefined,CITY_VIEW_SCALE),le=lookLimit(vp,ze);
    assert.ok(Math.abs(lc.x*zc-le.x*ze)<1e-9&&Math.abs(lc.y*zc-le.y*ze)<1e-9,'same CSS look-ahead with the default hero box');
  }
});

/** Walks the hero at the world's speed for `seconds` at 60 fps in world direction `dir`; returns the last screen point and every centre. */
function walk(world:typeof ENDLESS_FOLLOW,vp:typeof PORTRAIT,useful:Rect,dir:{x:number;y:number},view:number){
  const z=world===ENDLESS_FOLLOW?followZoom(vp):cityZoom(vp),cam=new FollowCamera();cam.world=world;
  let p={x:50,y:60};const l=Math.hypot(dir.x,dir.y);
  cam.snap(projectView(p,view),vp,z,useful,HERO);
  const frames:{hero:{x:number;y:number};center:{x:number;y:number}}[]=[];let screen={x:0,y:0};
  for(let i=0;i<240;i++){
    p={x:p.x+dir.x/l*world.speed/60,y:p.y+dir.y/l*world.speed/60};
    const hero=projectView(p,view),center={...cam.step(hero,1/60,vp,z,useful,HERO)};
    frames.push({hero,center});screen=toScreen(hero,center,vp,z);
  }
  return {screen,frames,look:cam.look,z};
}

test('walking in the city: full look-ahead at the city speed (same CSS px as the endless map), hero inside the useful area, lag inside the scaled budget',t=>{
  const cityWorld=followWorld(city);
  for(const [vp,useful] of [[PORTRAIT,USEFUL_P],[LANDSCAPE,USEFUL_L]] as const)for(let view=0;view<4;view++)for(const dir of [{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:-1,y:.3}]){
    const c=walk(cityWorld,vp,useful,dir,view),e=walk(ENDLESS_FOLLOW,vp,useful,dir,view);
    // The look-ahead is a share of walking speed, so at the city hero speed it is as full as at SPEED on the endless map.
    assert.ok(Math.hypot(c.look.x*c.z-e.look.x*e.z,c.look.y*c.z-e.look.y*e.z)<1e-6,`${vp.width} view ${view} ${JSON.stringify(dir)}: same look-ahead in CSS px`);
    // The settled spot differs only by the smoothing trail (the city hero crosses the screen ~18% faster: 2.27 vs
    // 1.92 bodies/s); it stays a few CSS px from the endless one and the body stays in the useful area.
    assert.ok(Math.hypot(c.screen.x-e.screen.x,c.screen.y-e.screen.y)<4,`${JSON.stringify(c.screen)} vs ${JSON.stringify(e.screen)}`);
    assert.ok(c.screen.x>=useful.x&&c.screen.x<=useful.x+useful.width&&c.screen.y-HERO.height>=useful.y-1e-6&&c.screen.y<=useful.y+useful.height+1e-6);
    const budget=offsetBudget(vp,CITY_VIEW_SCALE);
    for(const f of c.frames)assert.ok(Math.abs(f.hero.x-f.center.x)<=budget.x+LAG_X_PX*CITY_VIEW_SCALE+1e-6&&Math.abs(f.hero.y-f.center.y)<=budget.y+LAG_Y_PX*CITY_VIEW_SCALE+1e-6);
    if(view===0&&dir.x===1&&dir.y===0)t.diagnostic(`${vp.width}: city hero settles at ${c.screen.x.toFixed(1)},${c.screen.y.toFixed(1)} CSS px (endless ${e.screen.x.toFixed(1)},${e.screen.y.toFixed(1)})`);
  }
});

test('off-screen in the city: every point of a city follow-camera screen counts as visible for the sim (cityVisible, 4 views, offsets, lag)',()=>{
  // Mirrors camera-follow.test.ts "off-screen contract", in city world px: the sim tests an offset scaled by
  // 1/CITY_VIEW_SCALE against the union of the endless cameras (avenues.ts cityVisible with no lead).
  const s=CITY_VIEW_SCALE,lagX=LAG_X_PX*s,lagY=LAG_Y_PX*s;
  for(const [vp,useful,landscape] of [[PORTRAIT,USEFUL_P,false],[LANDSCAPE,USEFUL_L,true]] as const)for(let view=0;view<4;view++){
    const z=cityZoom(vp),l=lookLimit(vp,z,useful,HERO,s),budget=offsetBudget(vp,s);
    for(const [lx,ly,gx,gy] of [[1,1,1,1],[-1,-1,-1,-1],[1,-1,1,-1],[-1,1,-1,1],[0,0,0,0]]){
      const hero={x:0,y:0},t=followTarget(hero,vp,z,useful,{x:lx*l.x,y:ly*l.y},HERO,false,s);
      const c={x:Math.min(hero.x+budget.x+lagX,Math.max(hero.x-budget.x-lagX,t.x+gx*lagX)),y:Math.min(hero.y+budget.y+lagY,Math.max(hero.y-budget.y-lagY,t.y+gy*lagY))};
      for(let i=0;i<=10;i++)for(let j=0;j<=10;j++){
        const sx=(i/10*vp.width-vp.width/2)/z+c.x,sy=(j/10*vp.height-vp.height/2)/z+c.y;
        const a=sx/TILE_X,b=sy/TILE_Y,q={x:(b+a)/2,y:(b-a)/2},w=rotateVector(q,-view);
        assert.ok(cityVisible({x:0,y:0},w,0),`${vp.width} view ${view} (${i},${j})`);
        assert.ok(visibleOffset(w.x/s,w.y/s,{landscape,view}),'and for this phone\'s own camera hint');
      }
    }
  }
});

test('switching world re-fits: island → city → island gives the city camera, then the island camera exactly as before',()=>{
  const cam=new FollowCamera(),hero={x:12,y:17};
  const fit=(terrain:TerrainField|CityTerrain,vp:typeof PORTRAIT,useful:Rect)=>{
    // What IslandScene.fit does with the scene's one terrain (world-swap.ts worldCamera; swapped with the net's).
    const w=worldCamera(vp,terrain as TerrainField),z=w.zoom;cam.world=w.follow;
    assert.equal(z,worldZoom(vp,terrain));assert.deepEqual(w.follow,followWorld(terrain));
    return {z,center:{...cam.snap(projectView(hero,0),vp,z,useful,HERO)}};
  };
  for(const [vp,useful] of [[PORTRAIT,USEFUL_P],[LANDSCAPE,USEFUL_L]] as const){
    const before=fit(island,vp,useful),inCity=fit(city,vp,useful),after=fit(island,vp,useful);
    assert.equal(before.z,followZoom(vp));assert.equal(inCity.z,cityZoom(vp));
    assert.deepEqual(after,before,'back on the island: byte-identical camera');
    assert.equal(cam.world,ENDLESS_FOLLOW);
    // The hero's body sits on the useful centre in both worlds (CSS px).
    for(const f of [before,inCity]){
      const feet=toScreen(projectView(hero,0),f.center,vp,f.z);
      assert.ok(Math.abs(feet.x-(useful.x+useful.width/2))<1e-6&&Math.abs(feet.y-HERO.height/2-(useful.y+useful.height/2))<1e-6);
    }
    // Rotation: a snap in each of the 4 views keeps the hero on the same screen spot in the city.
    const spots=[0,1,2,3].map(view=>{const c=new FollowCamera();c.world=followWorld(city);const h=projectView(hero,view),z=cityZoom(vp);return toScreen(h,c.snap(h,vp,z,useful,HERO),vp,z);});
    for(const s of spots)assert.ok(Math.hypot(s.x-spots[0].x,s.y-spots[0].y)<1e-6);
  }
  // Rotating the phone re-fits: the orientation flips, the zoom stays the D-030 one on the reference phones.
  assert.ok(Math.abs(fit(city,PORTRAIT,USEFUL_P).z-fit(city,LANDSCAPE,USEFUL_L).z)<1e-9);
});

test('enemy tap radius stays sensible in the city: the 26 CSS px floor is in world px over the zoom, the art scaled like the zoom',()=>{
  // scene.ts enemyAt: max(26/zoom, art.width × size × scale × 0.6) world px → CSS px: the same on both maps.
  for(const vp of [PORTRAIT,LANDSCAPE])for(const kind of Object.keys(ENEMY_ART) as (keyof typeof ENEMY_ART)[]){
    const zc=cityZoom(vp),ze=followZoom(vp);
    const cityCss=Math.max(26/zc,ENEMY_ART[kind].width*CITY_VIEW_SCALE*.6)*zc,endlessCss=Math.max(26/ze,ENEMY_ART[kind].width*.6)*ze;
    assert.ok(Math.abs(cityCss-endlessCss)<1e-9,`${kind}: ${cityCss} vs ${endlessCss}`);
  }
});

// ---------- One terrain in the scene (review #4): the field follows the net's by world kind and signature ----------

test('one terrain: a reconnect to the same map (a new but identical TerrainField) keeps the field, no re-fit',()=>{
  for(const make of [()=>new TerrainField(424242),()=>new TerrainField(424242,{world:'infinito'})]){
    const first=make(),scene=new SceneTerrain<TerrainField>(first);
    assert.equal(scene.sync(first),undefined,'the same object: nothing');
    const again=make();
    assert.notEqual(again,first,'terrainFor builds a new TerrainField on every welcome');
    assert.ok(sameWorld(again,first));
    assert.equal(scene.sync(again),undefined,'same kind and signature: no swap, no re-fit');
    assert.equal(scene.field,first,'the scene keeps the field it built its ground and props on');
    assert.equal(scene.sync(again),undefined,'asked again (every frame): still nothing');
    assert.equal(scene.sync(undefined),undefined,'solo (no net): nothing');
  }
  // The city decoded again from the same asset (same sha256): the same world.
  const cityAgain=realCity(),scene=new SceneTerrain<TerrainField>(cityAsField(city));
  assert.equal(scene.sync(cityAsField(cityAgain)),undefined);assert.equal(scene.field,cityAsField(city));
});

test('one terrain: island → city swaps the field with the re-fit; city → island comes back to the identical island camera',()=>{
  const islandField=new TerrainField(424242),cityField=cityAsField(city),scene=new SceneTerrain<TerrainField>(islandField);
  const hero={x:12,y:17};
  for(const vp of [PORTRAIT,LANDSCAPE]){
    const before=worldCamera(vp,scene.field);
    assert.equal(before.zoom,followZoom(vp));assert.equal(before.follow,ENDLESS_FOLLOW);
    // A lobby map switch: the net's terrain is the city.
    assert.equal(scene.sync(cityField),cityField,'another kind: the scene swaps');
    assert.equal(scene.field,cityField,'camera, projection, ground, props and the local walk now read the city');
    const inCity=worldCamera(vp,scene.field);
    assert.equal(inCity.zoom,cityZoom(vp));assert.equal(inCity.follow.scale,CITY_VIEW_SCALE);assert.equal(inCity.follow.speed,CITY_HERO_SPEED);
    // project() reads the same field as the camera: the city's ground heights, not the island's hill.
    assert.deepEqual(projectView(hero,0,scene.field),projectView(hero,0,cityField));
    assert.notDeepEqual(projectView(hero,0,scene.field),projectView(hero,0,islandField));
    // Back to the island (terrainFor builds a new one): swapped again, and the camera is byte-identical to before.
    const back=new TerrainField(424242);
    assert.equal(scene.sync(back),back);assert.equal(scene.field,back);
    assert.deepEqual(worldCamera(vp,scene.field),before);
    assert.deepEqual(projectView(hero,0,scene.field),projectView(hero,0,islandField));
    assert.equal(scene.sync(islandField),undefined,'the old island object again: same world, nothing');
    assert.equal(scene.sync(cityField),cityField);assert.equal(scene.sync(back),back);
  }
  // Another endless seed is another world too (signature), and the endless map keeps its own camera.
  const a=new TerrainField(1,{world:'infinito'}),b=new TerrainField(2,{world:'infinito'}),endlessScene=new SceneTerrain<TerrainField>(a);
  assert.equal(endlessScene.sync(b),b);
  assert.deepEqual(worldCamera(PORTRAIT,b),worldCamera(PORTRAIT,a));
});

test('scene.ts keeps one terrain: fit, project and the walk read this.field; the city never gets the island ground, trees or landmarks',()=>{
  const src=readFileSync(fromRoot('src/client/scene.ts'),'utf8');
  assert.ok(!/cameraField|cameraTerrain/.test(src),'no second (camera) terrain');
  assert.match(src,/worldCamera\(viewport,this\.field\)/,'fit() frames the scene\'s field');
  assert.match(src,/this\.terrainWatch\.sync\(this\.hooks\.net\?\.terrain\)\)this\.swapWorld\(\)/,'update() swaps by world, not by object');
  // The net's terrain is read in two places only: the constructor and the per-frame sync.
  assert.equal(src.match(/net\?\.terrain/g)?.length,2);
  const build=src.slice(src.indexOf('private buildWorld(){'),src.indexOf('private clearWorld(){'));
  assert.ok(build.indexOf('if(city||this.field.chunks)return;')>0&&build.indexOf('if(city||this.field.chunks)return;')<build.indexOf('landmarks.forEach'),
    'island trees, rocks and landmarks only on the island');
  // cidade-03: in the city drawGround builds the CityLayer and returns before the island/endless ground.
  const ground=src.slice(src.indexOf('private drawGround(){'));
  assert.match(ground,/^private drawGround\(\)\{\s*if\(isCityWorld\(this\.field\)\)\{/,'the city branch comes first');
  assert.ok(ground.indexOf('new CityLayer(')>0&&ground.indexOf('new CityLayer(')<ground.indexOf('createTerrain('),'city render, never the island ground');
  assert.ok(ground.indexOf('return;')<ground.indexOf('createTerrain('),'the city branch returns before createTerrain');
  assert.match(src,/private chooseTrees\(\)\{if\(this\.field\.chunks\|\|isCityWorld\(this\.field\)\)return \[\];/,'no island tree sheets loaded for the city');
});
