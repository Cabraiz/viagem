/**
 * BUG-20261024-ORQ-resgate-hud-apos-derrota: after a defeat, on player 2, the rescue HUD kept framing a torn-down
 * island (IslandScene.screenSide ← RescueBoard.footsteps: `Cannot read properties of undefined (reading 'main')`).
 * The board skips a scene that is no longer live, and a destroyed board draws nothing (late views, queued frames).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';

const registerHooks=(nodeModule as {registerHooks?:(hooks:object)=>unknown}).registerHooks;
const noCss=registerHooks?(registerHooks({load(url:string,context:unknown,next:(url:string,context:unknown)=>unknown){
  return url.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:next(url,context);}}),undefined):'needs node:module registerHooks (node ≥ 22.15)';

/** A board built by its real constructor over small fakes: a button, a manual frame queue, a scene that can be torn down. */
async function rig(){
  const {RescueBoard}=await import('../../src/client/hud/rescue.ts');
  const {getAudio}=await import('../../src/client/audio/engine.ts');
  // The footsteps run only with the audio unlocked (a real match): the path of the bug.
  Object.defineProperty(getAudio(),'unlocked',{get:()=>true,configurable:true});
  const frames=new Map<number,()=>void>();let next=1;
  const g=globalThis as Record<string,unknown>;
  g.requestAnimationFrame=(f:()=>void)=>{frames.set(next,f);return next++;};
  g.cancelAnimationFrame=(id:number)=>{frames.delete(id);};
  const button={hidden:true,type:'',innerHTML:'',setAttribute(){},addEventListener(){},remove(){},style:{setProperty(){}}};
  g.document={createElement:()=>button};
  const calls:string[]=[];
  const scene={live:true,cameraView:0,heroGait:()=>undefined,say:()=>{},cedulasCaught:()=>0,pendingGrana:()=>0,
    // A torn-down Phaser scene has no cameras: what screenSide read.
    screenSide(){if(!this.live)throw new TypeError("Cannot read properties of undefined (reading 'main')");calls.push('screenSide');return 0;}};
  const player=(id:string)=>({id,classId:'gari',name:id,x:0,y:0,hp:10,online:true});
  const net={id:'me',terrain:{world:'ilha'},run:{phase:'result'},predicted:{x:0,y:0},onSos:undefined as unknown,
    players:new Map([['me',player('me')],['p2',player('p2')]]),feed:{players:new Map(),enemies:new Map()}};
  const hud={el:{hidden:false,classList:{contains:()=>false}},tally:{causes:{last:new Map()}},
    setCityRoute:()=>calls.push('cityRoute'),prewarmCity:()=>{},setGranaPending:()=>{},granaMoved:()=>{},edges:{clear:()=>calls.push('edges.clear')}};
  const board=new RescueBoard({net,hud,actions:{append(){}},scene:()=>scene} as never);
  const run=()=>{const queued=[...frames.values()];frames.clear();for(const f of queued)f();};
  return {board,scene,calls,frames,run};
}
const view={tick:1,players:[],events:[],structures:[],telegraphs:[]} as never;

test('a scene torn down under a live board: its frames skip the scene, no throw',{skip:noCss},async()=>{
  const {board,scene,calls,run}=await rig();
  run();assert.ok(calls.includes('screenSide'),'a live scene pans the ally steps');
  scene.live=false;calls.length=0;
  assert.doesNotThrow(run,'the queued frame after the teardown');
  assert.doesNotThrow(()=>board.view(view),'a late room view after the teardown');
  assert.ok(!calls.includes('screenSide'),'the torn-down scene is never read');
  board.destroy();
});

test('a destroyed board draws nothing: a late view, a frame already queued',{skip:noCss},async()=>{
  const {board,calls,frames,run}=await rig();
  run();calls.length=0;
  board.destroy();
  assert.equal(frames.size,0,'its frame is cancelled');
  board.view(view);
  assert.deepEqual(calls,[],'a late view after destroy does nothing');
});

test('destroyed inside its own frame: the loop does not come back',{skip:noCss},async()=>{
  const {board,frames,run}=await rig();
  (board as unknown as {tick():void}).tick=()=>board.destroy();
  run();
  assert.equal(frames.size,0,'no frame queued after a destroy from the tick');
});
