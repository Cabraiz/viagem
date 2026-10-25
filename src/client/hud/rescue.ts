/**
 * Client glue of the off-screen and rescue cards (UX-bordas-fora-da-tela, ORQ-minimapa, UX-resgate-e-ping), mounted
 * by explore.ts in a real run:
 * - every frame: radar → edge arrows on the useful area's rim (radar.ts, edges.ts); in the city (terrain.world 'cidade',
 *   design/cidade-hud.md §7) the city's arrows instead (groups, active mouths, base with the horn seconds; hud/city),
 *   switched per frame since the map can change in the lobby; the WC3 minimap at ≤ 10 Hz on every map (wc-minimap);
 * - "Me salva": while caído the skill button's place becomes a big ping button (3 s anti-spam, EmoteGate); the room
 *   relays the ping with the position to every phone, which lights the caído's arrow and dot, plays the fall whistle
 *   (and its buzz, VGM-050 settings) and shows the caído's own help line over the body;
 * - lines over heads (fun/lines, 053A): the fall (what got you, else the class line), the rescuer's "Segura aí, Zé!"
 *   while it holds the rescue, the class rescue line, and the rescue sound with its buzz for the rescuer.
 * Its pure helpers (holdLine, sosButton) live in radar.ts (tests); this part needs the DOM, the scene and the socket.
 */
import type {CoopClient} from '../net/client.ts';
import type {RunHud} from './hud.ts';
import {isAsleep} from '../render/wake-rules.ts';
import type {RunView,PlayerRunView} from '../../contract/index.ts';
import {railName} from '../render/map-label-rules.ts';
import type {IslandScene} from '../scene.ts';
import {layoutEdges,pointedTargets,inView,COVERING,WINDOWS,type EdgeOptions} from './edges.ts';
import {LayoutCache,viewportSize} from './box-cache.ts';
import {liveSelector} from './dom-find.ts';
import type {Rect,ScreenZones} from './zones.ts';
import {WcMinimapDriver} from './wc-minimap/driver.ts';
import {radar,keepWarnings,holdLine,sosButton,type SpawnWarning} from './radar.ts';
import {defaultPortrait} from './hud.ts';
import {EmoteGate,SosBoard,SOS_COOLDOWN_MS,type SosPing} from '../fun/emotes.ts';
import {pickLine} from '../fun/lines.ts';
import {causeCopy} from './cause.ts';
import {worldBase,prewarmFarPath,type CityAsset as MapsCityAsset} from '../../maps/index.ts';
import {getAudio} from '../audio/engine.ts';
import {playEvents} from '../audio/events.ts';
import {Footsteps,allyGain,type StepFigure} from '../audio/footsteps.ts';
import {AlarmLoop} from '../audio/alarm.ts';
/** The alarm stays loud this long after the car's last hit (ms). */
const ALARM_HIT_MS=1500;
import {heroRuns} from '../sprites/movement128.ts';
import {icon} from '../ui/icon.ts';
import {wallOf} from './camp.ts';
import {secondsLeft} from './model.ts';
import {chaveiroExtras} from './chaveiro-extras.ts';
import {vehicleLine} from '../../rules/index.ts';
import {bankExtras} from './bancos.ts';
import {objectiveOf,RouteMemo,cityAssetOf,cityMapInfo,trackMouths,screenCorners,hornSeconds,cityEdgeTargets,layoutCityEdges,cityMustPoint,relocateCityTargets,WALL_HIT_MS,UNO_HIT_MS,
  type CityAssetLike,type CityMapInfo,type MouthId,type EnemyPoint,type CityEdgeTarget,type CityPerson} from './city/index.ts';
import {shownTargets} from './arrows.ts';

/** The city's targets (clusters, mouths, base) are rebuilt at most this often (ms); in between only re-located on screen. */
export const CITY_TARGETS_MS=100;

/** The HUD pieces that hide the map (edges.ts COVERING, shared with the arrows sandbox and pinned by a test). */
export {COVERING};
/** The selectors' live lists, compiled once per document (dom-find.ts liveSelector, Q6). */
const lookups=new WeakMap<Document,Map<string,()=>Iterable<Element>>>();
function boxes(doc:Document,selector:string):Rect[]{
  let byDoc=lookups.get(doc);if(!byDoc)lookups.set(doc,byDoc=new Map());
  let find=byDoc.get(selector);if(!find)byDoc.set(selector,find=liveSelector(doc,selector));
  const out:Rect[]=[];
  for(const el of find()){
    if((el as HTMLElement).closest('[hidden]'))continue;
    const r=el.getBoundingClientRect();if(r.width>0&&r.height>0)out.push({x:r.left,y:r.top,width:r.width,height:r.height});
  }
  return out;
}
export interface RescueOptions {net:CoopClient;hud:RunHud;actions:HTMLElement;scene:()=>IslandScene|undefined;
  /** A tap on the button also wakes the controls (the explore shell's pause(false)). */
  onTap?:()=>void}

/** The caller's own confirmation, on the room's echo of its "Me salva". */
export const SOS_HEARD='Turma avisada!';
/** The one back on their feet thanks the rescuer: the end of a rescue reads on both bodies. */
export const thanks=(name:string)=>`Valeu, ${railName(name)}!`;
/** The thanks waits for the rescuer's balloon to go (horde balloons live 2.2 s). */
export const THANKS_AFTER_MS=2300;

export class RescueBoard {
  private readonly net:CoopClient;private readonly hud:RunHud;private readonly scene:()=>IslandScene|undefined;
  private readonly button:HTMLButtonElement;
  private readonly gate=new EmoteGate(SOS_COOLDOWN_MS);
  private readonly pings=new SosBoard();
  private warnings:SpawnWarning[]=[];
  private last?:RunView;
  private said=new Set<string>();
  private frame=0;private minimapAt=0;
  /** The WC3 minimap's driver (wc-minimap/driver.ts): frame, terrain cache, ally colours, heading. */
  private readonly wcDriver=new WcMinimapDriver();
  private farWarm?:unknown;private timers=new Set<ReturnType<typeof setTimeout>>();
  /**
   * HUD boxes over the map, read twice a second and on every layout change (a window opening): a target under them is not
   * in view. Read after the paint (box-cache.ts), never in the middle of the frame's DOM writes (F3).
   */
  private covered:Rect[]=[];private windows:Rect[]=[];
  private readonly boxCache=new LayoutCache(()=>{const hud=this.hud;return {covered:boxes(hud.el.ownerDocument,COVERING),windows:boxes(hud.el.ownerDocument,WINDOWS)};},500);
  // ---------- City (design/cidade-hud.md §7) ----------
  /** The city's map info, built once per decoded asset. */
  /** D-047: the chaveiro's last route and stops (the minimap draws the route still ahead). */
  private chaveiroRoute=new RouteMemo();
  private cityInfo?:{asset:CityAssetLike;map:CityMapInfo};
  /** Avenue mouths lit by spawn warnings (trackMouths), and the group keys that had an arrow last frame (hysteresis). */
  private mouths=new Map<MouthId,number>();private groupKeys=new Set<string>();
  /** When the wall last lost life (performance.now ms), from the views. */
  private wallHitAt=-Infinity;private wallHp?:number;
  /** Card inimigos-querem-o-uno: when the car last took a hit (its hits went up), for its edge arrow. */
  private carHitAt=-Infinity;private carHits?:number;
  /**
   * The city's world picture, rebuilt every CITY_TARGETS_MS (cityRefresh): the people and the live critters (buffers
   * reused) and the arrows' targets. Each frame only re-locates the few
   * targets on screen (relocateCityTargets) and lays the arrows out, so 300 critters are not clustered 60 times a second.
   */
  private cityAt=-Infinity;private cityPeople:CityPerson[]=[];private cityEnemies:EnemyPoint[]=[];private cityTargets:CityEdgeTarget[]=[];
  /** The heroes' footsteps and the boss's (audio/footsteps.ts), counted every frame. */
  private stepper?:{steps:Footsteps;figures:StepFigure[]};
  constructor(options:RescueOptions){
    this.net=options.net;this.hud=options.hud;
    // A scene already torn down (a defeat closing the island, a stop) is no scene: its cameras are gone (BUG resgate-hud-apos-derrota).
    this.scene=()=>{const scene=options.scene();return scene?.live===false?undefined:scene;};
    const b=this.button=document.createElement('button');b.type='button';b.id='coop-sos';b.hidden=true;
    b.setAttribute('aria-label','Me salva: chama a turma até você');
    b.innerHTML=`<svg class="sos-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100"/></svg>${icon('boia',{size:40})}<span>Me salva</span>`;
    // Pointer down answers at once, like the skill button; the HUD's taps never reach the joystick or the map.
    b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();options.onTap?.();this.ask();});
    b.addEventListener('click',e=>{e.stopPropagation();if(e.detail===0)this.ask();});
    options.actions.append(b);
    this.net.onSos=ping=>this.ping(ping);
    const loop=()=>{if(this.dead)return;this.tick();if(!this.dead)this.frame=requestAnimationFrame(loop);};this.frame=requestAnimationFrame(loop);
  }
  /** The local caído asks for help: the room checks the fall and the 3 s gate again and relays the position. */
  ask(now=performance.now()){
    const st=this.net.feed.players.get(this.net.id);
    if(!sosButton(st,this.net.run?.phase==='combat',0).show)return false;
    if(this.gate.remaining(this.net.id,now)>0)return false;
    if(!this.net.sos())return false;
    this.gate.tryUse(this.net.id,now);
    // The button answers at once (its 3 s ring); "Turma avisada!" waits for the room's echo, so it never claims a
    // ping the room dropped (code review onda 6).
    return true;
  }
  private ping(ping:SosPing){
    if(!this.pings.add(ping,performance.now()))return;
    // The caller's own echo: the room took it and every phone now shows the arrow (UX onda 6: confirm to the caído).
    if(ping.id===this.net.id){this.scene()?.say(this.net.id,SOS_HEARD);return;}
    const audio=getAudio();if(audio.unlocked)audio.play('queda');
    this.say(ping.id,'down',ping.tick);
  }
  /** The view the HUD shows: one clock for the arrows, the team strip and the map fichas (UX onda 6, aresta 1). */
  private states=new Map<string,PlayerRunView>();
  private say(id:string,situation:'down'|'revive',seed:string|number){
    const classId=this.net.players.get(id)?.classId;if(!classId)return;
    this.scene()?.say(id,pickLine(classId,situation,seed));
  }
  /** Each authoritative view (after the HUD took it): spawn warnings, fall and rescue lines, the rescuer's buzz. */
  view(view:RunView){
    if(this.dead)return;
    this.last=view;this.states=new Map(view.players.map(p=>[p.id,p]));
    // The match's sounds (audio/events.ts): the local hero's hits, shots, kills and pickups, and the team's moments.
    const audio=getAudio();if(audio.unlocked)playEvents(audio,view.events,this.net.id);
    keepWarnings(this.warnings,view.events,view.tick);
    const asset=cityAssetOf(this.net.terrain);
    if(asset){
      trackMouths(this.mouths,view.events,view.tick,this.cityMap(asset));
      const wall=wallOf(view.structures);
      if(wall&&this.wallHp!==undefined&&wall.hp<this.wallHp)this.wallHitAt=performance.now();
      this.wallHp=wall?.hp;
      const car=objectiveOf(view)?.car;
      if(car&&this.carHits!==undefined&&car.hits>this.carHits)this.carHitAt=performance.now();
      this.carHits=car?.hits;
    }
    for(const e of view.events){
      // Veículos: the vehicle's line over the rider (rules/veiculos.ts), at the take and at the end of the ride.
      if(e.type==='vehicle'){const line=vehicleLine(e.kind,e.what,(e as {eventId?:number}).eventId??0);if(line)this.scene()?.say(e.player,line);continue;}
      if(e.type==='downed'){
        // What got you (UX-voce-e-dano f) left the banner: it is the caído's first line over the body.
        const kind=this.hud.tally.causes.last.get(e.player),line=kind?causeCopy(kind).line:undefined;
        if(e.player===this.net.id)this.scene()?.fallenFrom(kind);
        if(line)this.scene()?.say(e.player,line);else this.say(e.player,'down',e.eventId);
      }else if(e.type==='revived'){
        this.pings.forget(e.player);
        if(e.by){
          this.say(e.by,'revive',e.eventId);
          // The end of a rescue reads on both bodies: the rescuer's class line and the one back on their feet thanks them.
          // Right after the rescuer's balloon (they stand side by side): one balloon at a time, never one over the other.
          const by=this.net.players.get(e.by)?.name;
          if(by&&e.player!==e.by){const who=e.player,t=setTimeout(()=>{this.timers.delete(t);this.scene()?.say(who,thanks(by));},THANKS_AFTER_MS);this.timers.add(t);}
          if(e.by===this.net.id){const audio=getAudio();if(audio.unlocked)audio.play('resgate');}
        }
      }
    }
    // Same frame as the team strip (it took this view a moment ago): the arrows never show the other clock.
    this.tick();
  }
  /**
   * One frame of footsteps: each hero's walk as the scene drew it (its sheet's contacts, card som-passos-fora-do-eixo),
   * the local hero full and centred, the allies quieter with distance and from their side of the screen, and the boss.
   */
  private footsteps(scene:IslandScene|undefined,now:number){
    const audio=getAudio(),net=this.net;
    if(!scene||!audio.unlocked||!net.run){this.stepper?.steps.reset();return;}
    const {steps,figures}=this.stepper??={steps:new Footsteps(audio),figures:[]};
    const hero=net.predicted,me=net.feed.players.get(net.id);
    figures.length=0;
    for(const p of net.players.values()){
      const local=p.id===net.id;
      const alive=p.online&&!p.spectator&&(local?!!me&&me.hp>0&&!me.downed&&!me.eliminated:p.hp>0);
      figures.push({id:p.id,gait:scene.heroGait(p.id),local,runs:heroRuns(p.classId),alive,
        gain:local?1:allyGain(Math.hypot(p.x-hero.x,p.y-hero.y)),side:local?0:scene.screenSide(p)});
    }
    steps.update(now,figures);
    let boss:{x:number;y:number}|undefined;
    for(const e of net.feed.enemies.values())if(e.boss&&e.hp>0){boss=e;break;}
    steps.boss(now,boss,hero,boss?scene.screenSide(boss):0);
  }
  /** Card inimigos-querem-o-uno, etapa 4: the Uno's alarm by the hero's distance to the car, louder while it takes hits. */
  private alarmLoop?:AlarmLoop;
  private alarm(now:number){
    const objective=objectiveOf(this.last),live=!!objective&&!objective.ended&&!!this.net.run;
    if(!live&&!this.alarmLoop)return;
    const loop=this.alarmLoop??=new AlarmLoop(getAudio()),hero=this.net.predicted;
    loop.update(live,objective?Math.hypot(objective.car.x-hero.x,objective.car.y-hero.y):Infinity,now-this.carHitAt<=ALARM_HIT_MS);
  }
  private tick(){
    const scene=this.scene(),net=this.net,hud=this.hud,run=net.run;
    // The room may switch maps in the lobby and the HUD is built once (explore.ts): the arrows follow the world now.
    const asset=cityAssetOf(net.terrain);
    // The city is known (the lobby on): its walking route is built on an idle moment now, not on round 1's first frame.
    if(asset)hud.prewarmCity(net.terrain);
    // Round 1 of the city is a walk to the plaza (card cidade-08): the HUD's row reads the route from the predicted hero,
    // in the camera's view (the arrow turns with it).
    hud.setCityRoute(asset&&run?.phase==='combat'?{terrain:net.terrain,hero:net.predicted,view:scene?.cameraView??0}:undefined);
    const combat=run?.phase==='combat'&&!hud.el.hidden&&!hud.el.classList.contains('rh-ended');
    const now=performance.now(),me=net.feed.players.get(net.id);
    this.footsteps(scene,now);
    this.alarm(now);
    const sos=sosButton(me,run?.phase==='combat',this.gate.remaining(net.id,now));
    if(this.button.hidden===sos.show)this.button.hidden=!sos.show;
    if(sos.show){
      this.button.setAttribute('aria-disabled',String(sos.cooling));
      this.button.style.setProperty('--sos-left',String(Math.round(sos.left*100)));
    }
    // Out of the wave the run's leftovers go (an old view, spawn warnings, lit pings, "Segura aí" already said).
    if(run?.phase!=='combat'&&this.last){this.last=undefined;this.states.clear();this.warnings.length=0;this.pings.clear();this.said.clear();
      this.mouths.clear();this.groupKeys.clear();this.wallHp=undefined;this.wallHitAt=-Infinity;this.carHits=undefined;this.carHitAt=-Infinity;this.cityAt=-Infinity;}
    if(!scene||!combat||!this.last){hud.edges?.clear();return;}
    const view=net.view(now),focus=scene.focusPoint(),zones=hud.zones();
    const self=view.players.find(p=>p.id===net.id);
    const hold=holdLine(self,this.states.get(net.id),view.players,this.states,this.said);
    if(hold)scene.say(net.id,hold.line);
    if(asset){this.cityFrame(asset,scene,view.players,focus,zones,now);return;}
    const {targets}=radar({selfId:net.id,focus,tick:this.last.tick,players:view.players,states:this.states,
      base:worldBase(net.terrain),enemies:net.feed.enemies.values(),telegraphs:this.last.telegraphs,
      warnings:this.warnings,pinged:id=>!!this.pings.get(id,now),locate:p=>scene.locate(p).screen,portrait:c=>defaultPortrait(c)});
    const area=scene.usefulArea??zones.useful,seen=this.seen(now,zones);
    // Only the kinds the game still points at (arrows.ts: the downed ally).
    hud.edges?.render(layoutEdges(shownTargets(targets),area,scene.heroScreenRect(),{seen,windows:this.windows}));
    // What must keep an arrow (a caído or the boss off the field): the zones audit checks it against the arrows drawn.
    hud.edges?.need(pointedTargets(shownTargets(targets),area,seen));
    this.minimap(scene,view.players,focus,now);
  }
  /** The WC3 minimap at ≤ 10 Hz, on every map. */
  private minimap(scene:IslandScene,players:readonly {id:string;x:number;y:number;online:boolean;spectator?:boolean}[],focus:{x:number;y:number},now:number){
    if(this.hud.wc&&now-this.minimapAt>=100){this.minimapAt=now;this.drawWc(scene,players,focus,now);}
  }
  /**
   * The WC3 minimap (card NEW-20261013-ORQ-minimapa-wc3): the whole map or the window around the hero, the marks and the
   * camera's view; a mouse click walks there (as a click on the ground), a touch or Alt+click pings (local for now).
   */
  private drawWc(scene:IslandScene,players:readonly {id:string;x:number;y:number;online:boolean;spectator?:boolean}[],focus:{x:number;y:number},now:number){
    const hud=this.hud,net=this.net,wc=hud.wc!;
    wc.onMove??=p=>{this.scene()?.goTo(p,{markerMs:900,far:true});};
    // A ping goes to the room (an old room drops it: it stays on this minimap); the team's come back through onMark.
    if(!wc.onPing){wc.onPing=p=>{net.mark(p.x,p.y);};net.onMark=m=>{if(m.player!==net.id)wc.pingWorld(m,this.wcDriver.colorOf(m.player));};}
    const locate=(p:{x:number;y:number})=>scene.locate(p).screen;
    // The far-walk grid of a click on the minimap, built on an idle moment once per world (maps far-path.ts).
    if(this.farWarm!==net.terrain){this.farWarm=net.terrain;const t=net.terrain;setTimeout(()=>prewarmFarPath(t),0);}
    // The city's maps asset (the HUD's cityAssetOf is a narrow view of it): the terrain image reads its cells and blocks.
    const city=cityAssetOf(net.terrain)?(net.terrain as unknown as {asset:MapsCityAsset}).asset:undefined;
    this.wcDriver.draw({minimap:wc,terrain:net.terrain,city,view:scene.cameraView,nowMs:now,
      selfId:net.id,self:scene.ghosting()?.at??net.predicted,players,states:this.states,enemies:net.feed.enemies.values(),structures:this.last?.structures??[],
      corners:screenCorners(locate,focus,viewportSize()),wallHitAt:this.wallHitAt,
      // D-047: the chaveiro's route ahead, delivery, car and moto (route and stops kept between keyframes).
      extras:[...chaveiroExtras(this.chaveiroRoute.fill(objectiveOf(this.last))),...bankExtras(this.last?.banks)]});
  }
  /** What the player sees: the viewport minus the HUD over it, read twice a second and on every layout change. */
  private seen(now:number,zones:ScreenZones){
    ({covered:this.covered,windows:this.windows}=this.boxCache.get(now,zones));
    const {width,height}=viewportSize();
    return {viewport:{x:0,y:0,width,height},covered:this.covered};
  }
  private cityMap(asset:CityAssetLike){
    if(this.cityInfo?.asset!==asset)this.cityInfo={asset,map:cityMapInfo(asset)};
    return this.cityInfo.map;
  }
  /**
   * One city frame (design/cidade-hud.md §1–§3): the city's arrows every frame (their targets rebuilt at ≤ 10 Hz,
   * cityRefresh), then the WC3 minimap.
   */
  private cityFrame(asset:CityAssetLike,scene:IslandScene,players:readonly {id:string;name:string;classId:string;x:number;y:number;online:boolean;spectator?:boolean}[],
    focus:{x:number;y:number},zones:ScreenZones,now:number){
    const hud=this.hud,map=this.cityMap(asset);
    const area=scene.usefulArea??zones.useful,seen=this.seen(now,zones);
    const locate=(p:{x:number;y:number})=>scene.locate(p).screen;
    if(now-this.cityAt>=CITY_TARGETS_MS||now<this.cityAt)this.cityRefresh(map,players,focus,locate,seen,now);
    else relocateCityTargets(this.cityTargets,focus,locate);
    if(hud.edges){
      hud.edges.render(layoutCityEdges(this.cityTargets,area,scene.heroScreenRect(),{seen,windows:this.windows,textScale:hud.edges.scale()}));
      // The base after the horn is a must-point arrow in the city: the zones audit checks it too (cityMustPoint).
      hud.edges.need(pointedTargets(this.cityTargets,area,seen),cityMustPoint);
    }
    this.minimap(scene,players,focus,now);
  }
  /**
   * Rebuilds the city's world picture (cityFrame): who shows (as radar.ts: nobody spectating or out; someone away only
   * while caído, the body still bleeds out), the live critters, the phase, the lit mouths and the arrows' targets
   * (clusters, mouths, base). The people and critter buffers are reused (objects included).
   */
  private cityRefresh(map:CityMapInfo,players:readonly {id:string;name:string;classId:string;x:number;y:number;online:boolean;spectator?:boolean}[],
    focus:{x:number;y:number},locate:(p:{x:number;y:number})=>{x:number;y:number},seen:NonNullable<EdgeOptions['seen']>,now:number){
    const net=this.net,last=this.last!,people=this.cityPeople,enemies=this.cityEnemies;
    this.cityAt=now;
    let n=0;
    for(const p of players){
      const st=this.states.get(p.id);
      if(p.spectator||st?.eliminated)continue;
      const downed=st?.downed;
      if(!downed&&!p.online&&p.id!==net.id)continue;
      const q=people[n]??={id:'',x:0,y:0,name:'',portrait:''};n++;
      q.id=p.id;q.x=p.x;q.y=p.y;q.name=p.name;q.portrait=defaultPortrait(p.classId);
      q.downed=downed?true:undefined;q.seconds=downed?secondsLeft(downed.bleedOutTick,last.tick):undefined;
      q.ping=downed&&this.pings.get(p.id,now)?true:undefined;
    }
    people.length=n;
    let m=0;
    for(const e of net.feed.enemies.values()){
      if(e.hp<=0||isAsleep(e))continue; // D-051: no group arrow to a nest's sleepers
      const q=enemies[m]??={id:'',x:0,y:0};m++;
      q.id=e.id;q.x=e.x;q.y=e.y;
      q.boss=e.boss?true:undefined;
    }
    enemies.length=m;
    const phase=last.round?.phase==='prepare'?'prepare':'wave';
    const activeMouths=trackMouths(this.mouths,[],last.tick,map);
    const objective=objectiveOf(last),moto=objective&&!objective.ended?objective.moto:undefined;
    const banks=last.banks,car=objective&&!objective.ended?{x:objective.car.x,y:objective.car.y,hit:now-this.carHitAt<=UNO_HIT_MS}:undefined;
    const point=this.hud.unoArrow,uno=car&&point?{x:car.x,y:car.y,urgent:point.urgent}:undefined;
    const {targets,groupKeys}=cityEdgeTargets({hero:focus,selfId:net.id,players:people,enemies,activeMouths,map,phase,...(moto?{moto}:{}),...(banks?{banks}:{}),...(car?{car}:{}),...(uno?{uno}:{}),
      wallHitRecently:now-this.wallHitAt<=WALL_HIT_MS,hornSeconds:hornSeconds(last.camp,last.tick,phase),locate,isOnScreen:p=>inView(locate(p),seen),previousGroups:this.groupKeys});
    // Only the kinds the game still points at (arrows.ts: the downed ally); the groups' memory keeps working.
    this.cityTargets=shownTargets(targets);this.groupKeys=groupKeys;
  }
  /** Destroyed: a late room view or a frame already queued draws nothing (the island may be gone). */
  private dead=false;
  destroy(){this.dead=true;this.alarmLoop?.stop();for(const t of this.timers)clearTimeout(t);cancelAnimationFrame(this.frame);this.net.onSos=()=>{};this.button.remove();}
}
