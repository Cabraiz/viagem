/**
 * HUD sandbox (VGM-040): `?sandbox=hud&players=1..6&state=wave|prepare|offer|offer-open|offer-prepare|offer-round|offer-heal|downed|boss|result[&lose=1][&full=1][&frozen=1][&phaser=1]`.
 * `full=1` gives every player a 12-item build (layout stress test).
 * Renders the run HUD over a mock island with the real control positions (camera, gear, joystick, attack)
 * so overlaps are visible. Fake data only; nothing talks to the server.
 * `phaser=1` mounts a real Phaser game under the HUD whose scene walks the hero to every tap, exactly like
 * the island scene (`input.on('pointerdown')` → goTo).
 * `cenario=bordas[&vista=0..3]` (UX-bordas-fora-da-tela): edge arrows and the minimap over the mock, with 5 allies, 2 caídos
 * (one pinging "Me salva"), the boss with a telegraph about to go off and a spawn warning, all off screen; the world
 * points are projected with the real camera math (projection.ts, framing.ts) in the chosen view. It proves taps on HUD panels never reach Phaser,
 * including its window-level touch listener. State: `window.__hero` ({x,y,taps}).
 */
import {HUD_SCENARIOS,fakeResult,fakeResultEvents,fakeView,type HudScenario} from './hud/fixtures.ts';
import {RunHud} from './hud/hud.ts';
import type {RunView} from './sim/view.ts';
import {BOSS_ROUND_NAMES,MODIFIERS,ROUND_NAMES,modifierLabel} from './sim/waves.ts';

/** Longest real copy, so the marquee is tested with the worst case the director can draw. */
const longest=(list:readonly string[])=>list.reduce((a,b)=>b.length>a.length?b:a,'');
const ROUND_NAME=longest(ROUND_NAMES),BOSS_NAME=longest(BOSS_ROUND_NAMES),MODIFIER=longest(MODIFIERS.map(modifierLabel));

const params=new URLSearchParams(location.search);
const players=Math.max(1,Math.min(6,Number(params.get('players'))||1));
const requested=params.get('state') as HudScenario|null;
let scenario:HudScenario=requested&&HUD_SCENARIOS.includes(requested)?requested:'wave';
const frozen=params.has('frozen');
const bordas=params.get('cenario')==='bordas';

const style=document.createElement('style');
style.textContent=`
html,body{margin:0;height:100%;overflow:hidden;background:#8dcecc}
body>:not(.hs-world):not(.rh):not(.hs-bar):not(.hs-phaser){display:none!important}
.hs-phaser{position:fixed;inset:0;z-index:5}
.hs-real .hs-world{z-index:4;pointer-events:none}.hs-real .hs-world::after{display:none}
.hs-world{position:fixed;inset:0;z-index:5;background:radial-gradient(ellipse 46% 30% at 50% 52%,#7cbf6a 0 62%,#e9d79a 63% 70%,#a6e0dc 72%,#8dcecc 100%)}
.hs-world::after{content:'';position:absolute;left:50%;top:52%;width:22px;height:30px;margin:-15px 0 0 -11px;border-radius:50% 50% 40% 40%;background:#f4c9a8;box-shadow:0 18px 0 -4px #6e5198}
.hs-mock{position:absolute;border:2px solid #fff8e9aa;background:#55466677;color:#fff9ed;font:700 12px system-ui;display:grid;place-items:center;text-shadow:0 1px 3px #302536}
.hs-cam{top:max(8px,env(safe-area-inset-top));left:max(8px,env(safe-area-inset-left));width:136px;height:44px;border-radius:15px}
.hs-gear{top:max(8px,env(safe-area-inset-top));right:max(8px,env(safe-area-inset-right));width:48px;height:48px;border-radius:50%}
.hs-stick{bottom:max(14px,env(safe-area-inset-bottom));left:max(14px,env(safe-area-inset-left));width:112px;height:112px;border-radius:50%}
.hs-attack{bottom:max(22px,env(safe-area-inset-bottom));right:max(18px,env(safe-area-inset-right));width:82px;height:82px;border-radius:50%}
@media (max-height:500px){.hs-stick{width:96px;height:96px}}
.hs-bar{position:fixed;z-index:20;left:50%;bottom:2px;transform:translateX(-50%);display:flex;gap:4px;opacity:.85}
.hs-bar button{font:600 10px system-ui;padding:2px 5px;border-radius:6px;border:1px solid #fff8;background:#302536cc;color:#fff}
.hs-bar[hidden]{display:none}
`;
document.head.append(style);

const world=document.createElement('div');world.className='hs-world';
world.innerHTML='<div class="hs-mock hs-cam">↶ 1 / 4 ↷</div><div class="hs-mock hs-gear">⚙</div><div class="hs-mock hs-stick">●</div><div class="hs-mock hs-attack">Atacar</div>';
document.body.append(world);
let moved=0;
world.addEventListener('pointerdown',()=>{moved++;document.body.dataset.worldTaps=String(moved);});

let tick=1000;
let view:RunView=fakeView(scenario,players,tick);
const hud=new RunHud(document.body,{
  localId:'p1',worldRescue:bordas,
  onChoose(offerId,index){
    document.body.dataset.lastChoice=`${offerId}:${index}`;
    view={...view,offers:view.offers.filter(offer=>offer.id!==offerId)};
    hud.update(view);
  },
  onRematch(){document.body.dataset.rematch='1';},
});
(window as unknown as {__hud:RunHud}).__hud=hud;

let eventId=0;
function load(next:HudScenario){
  scenario=next;tick=1000;
  view=fakeView(scenario,players,tick);
  if(scenario==='wave'||scenario==='boss')view.events=[{type:'round',index:view.round!.index,phase:'wave',name:scenario==='boss'?BOSS_NAME:ROUND_NAME,modifier:scenario==='boss'?undefined:MODIFIER,eventId:++eventId}];
  if(scenario==='prepare')view.events=[{type:'round',index:view.round!.index,phase:'prepare',eventId:++eventId}];
  // Result: feed falls, rescues and pickups through events so the joke awards reflect a tally.
  if(scenario==='result')view.events=fakeResultEvents(players,()=>++eventId);
  hud.hideResult();hud.update(view);
  if(scenario==='result')hud.showResult(fakeResult(players,!params.has('lose'),params.has('full')));
  // Combat with the compact panel open: the same tap a player gives on the "+N" chip.
  if(scenario==='offer-open'||scenario==='offer-open-downed'){const chip=hud.el.querySelector<HTMLButtonElement>('.rh-offer-chip');if(chip&&chip.getAttribute('aria-expanded')!=='true')chip.click();}
}
load(scenario);
(window as unknown as {__hudSandbox:{load:typeof load}}).__hudSandbox={load};

if(!frozen)setInterval(()=>{
  if(scenario==='result')return;
  tick+=4;
  view={...view,tick,events:[]};
  hud.update(view);
},200);

const bar=document.createElement('nav');bar.className='hs-bar';bar.hidden=params.has('clean');
bar.innerHTML=HUD_SCENARIOS.map(name=>`<button data-s="${name}">${name}</button>`).join('');
bar.addEventListener('click',event=>{const name=(event.target as HTMLElement).closest<HTMLButtonElement>('[data-s]')?.dataset.s;if(name)load(name as HudScenario);});
document.body.append(bar);

if(params.has('phaser'))void (async()=>{
  const Phaser=(await import('phaser')).default;
  document.body.classList.add('hs-real');
  const host=document.createElement('div');host.className='hs-phaser';document.body.prepend(host);
  const hero={x:0,y:0,taps:0};
  (window as unknown as {__hero:typeof hero}).__hero=hero;
  class Island extends Phaser.Scene {
    create(){
      const {width,height}=this.scale;
      this.add.ellipse(width/2,height*.52,width*.92,height*.6,0x7cbf6a).setStrokeStyle(10,0xe9d79a);
      const body=this.add.ellipse(width/2,height*.52,24,32,0xf4c9a8).setStrokeStyle(3,0x6e5198);
      hero.x=body.x;hero.y=body.y;
      // Same contract as the island scene: any primary pointerdown on the game walks the hero there.
      this.input.on('pointerdown',(pointer:Phaser.Input.Pointer)=>{
        hero.taps++;body.setPosition(pointer.x,pointer.y);hero.x=pointer.x;hero.y=pointer.y;
        document.body.dataset.heroTaps=String(hero.taps);
      });
      document.body.dataset.phaserReady='1';
    }
  }
  new Phaser.Game({type:Phaser.CANVAS,parent:host,transparent:true,scale:{mode:Phaser.Scale.RESIZE,width:innerWidth,height:innerHeight},scene:Island,banner:false,input:{activePointers:3}});
})();

if(bordas)void (async()=>{
  const {layoutEdges}=await import('./hud/edges.ts');
  const {radar}=await import('./hud/radar.ts');
  const {computeZones,union}=await import('./hud/zones.ts');
  const {islandOutline,MINIMAP_RANGE}=await import('./hud/minimap.ts');
  const {projectView}=await import('./projection.ts');
  const {toScreen,followZoom}=await import('./framing.ts');
  const view=Math.max(0,Math.min(3,Number(params.get('vista'))||0));
  const rect=(el:Element|null)=>{if(!el)return undefined;const r=el.getBoundingClientRect();return r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:undefined;};
  const all=(sel:string)=>[...document.querySelectorAll(sel)].map(rect);
  const draw=()=>{
    const viewport={width:innerWidth,height:innerHeight};
    const zones=computeZones({viewport,status:[rect(document.querySelector('.hs-cam')),rect(document.querySelector('.hs-gear')),...all('.rh-top>*')],
      team:union(all('.rh-member')),joystick:rect(document.querySelector('.hs-stick')),skill:rect(document.querySelector('.hs-attack')),minimap:rect(hud.minimap!.el)});
    const area=zones.useful,zoom=followZoom(viewport),hero={x:12,y:17};
    // The camera puts the hero's body in the middle of the useful area (framing.ts anchorOf), feet 28 px under it.
    const anchor={x:area.x+area.width/2,y:area.y+area.height/2+28},center=projectView(hero,view);
    const locate=(p:{x:number;y:number})=>{const q=toScreen(projectView(p,view),center,viewport,zoom);return {x:q.x-viewport.width/2+anchor.x,y:q.y-viewport.height/2+anchor.y};};
    const states=new Map(view0.players.map(p=>[p.id,p]));
    const spots=[{x:12,y:17},{x:2,y:15},{x:13,y:2},{x:24,y:20},{x:21,y:6},{x:4,y:26}];
    const players=view0.players.map((p,i)=>({id:p.id,name:p.name,classId:p.classId,x:spots[i].x,y:spots[i].y,online:true}));
    const {targets,items}=radar({selfId:'p1',focus:hero,self:hero,tick:view0.tick,players,states,base:{x:12,y:12},
      enemies:[{id:'boss',kind:'chefe',x:30,y:30,hp:900,maxHp:1000,boss:true}],telegraphs:[{id:'t',shape:'circle',x:30,y:31,radius:3,fireTick:view0.tick+10}],
      warnings:[{x:-6,y:4,atTick:view0.tick+20}],pinged:id=>id==='p3',locate,portrait:c=>`/art/portraits/${c}-thumb.webp`});
    const covered=all('.rh-round,.rh-xp,.rh-boss,.rh-member,.hs-cam,.hs-gear,.hs-stick,.hs-attack,.rh-minimap').filter((r):r is NonNullable<typeof r>=>!!r);
    const heroBox={x:anchor.x-28,y:anchor.y-56,width:56,height:56};
    hud.edges!.render(layoutEdges(targets,area,heroBox,{seen:{viewport:{x:0,y:0,...viewport},covered}}));
    hud.minimap!.render(hero,view,MINIMAP_RANGE.ilha[hud.minimap!.far?1:0],items,islandOutline());
    document.body.dataset.useful=JSON.stringify(area);document.body.dataset.hero=JSON.stringify(heroBox);
  };
  // 5 allies, two of them caídos (p3 pinging), every one far from the hero.
  const view0={...fakeView('wave',6,1000)};
  view0.players=view0.players.map((p,i)=>i===2?{...p,hp:0,downed:{progress:0,bleedOutTick:1000+20*14}}:i===4?{...p,hp:0,online:true,downed:{progress:.45,bleedOutTick:1000+20*6}}:{...p,online:true});
  hud.update(view0);
  draw();addEventListener('resize',draw);hud.minimap!.el.addEventListener('click',()=>requestAnimationFrame(draw));
  document.body.dataset.bordas='1';
})();
