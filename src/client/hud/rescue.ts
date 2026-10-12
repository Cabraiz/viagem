/**
 * Client glue of the off-screen and rescue cards (UX-bordas-fora-da-tela, ORQ-minimapa, UX-resgate-e-ping), mounted
 * by explore.ts in a real run:
 * - every frame: radar → edge arrows on the useful area's rim and the minimap (radar.ts, edges.ts, minimap.ts); in the
 *   city (terrain.world 'cidade', design/cidade-hud.md §7) the city's arrows (groups, active mouths, base with the horn
 *   seconds) and the city minimap with its big one instead (hud/city), switched per frame since the map can change in
 *   the lobby;
 * - "Me salva": while caído the skill button's place becomes a big ping button (3 s anti-spam, EmoteGate); the room
 *   relays the ping with the position to every phone, which lights the caído's arrow and dot, plays the fall whistle
 *   (and its buzz, VGM-050 settings) and shows the caído's own help line over the body;
 * - lines over heads (fun/lines, 053A): the fall (what got you, else the class line), the rescuer's "Segura aí, Zé!"
 *   while it holds the rescue, the class rescue line, and the rescue sound with its buzz for the rescuer.
 * Its pure helpers (holdLine, sosButton) live in radar.ts (tests); this part needs the DOM, the scene and the socket.
 */
import type {CoopClient} from '../net/client.ts';
import type {RunHud} from './hud.ts';
import type {RunView,PlayerRunView} from '../../contract/index.ts';
import {railName} from '../render/map-label-rules.ts';
import type {IslandScene} from '../scene.ts';
import {layoutEdges,pointedTargets,inView,COVERING,WINDOWS} from './edges.ts';
import type {Rect,ScreenZones} from './zones.ts';
import {MINIMAP_RANGE,islandOutline} from './minimap.ts';
import {radar,keepWarnings,holdLine,sosButton,type SpawnWarning} from './radar.ts';
import {defaultPortrait} from './hud.ts';
import {EmoteGate,SosBoard,SOS_COOLDOWN_MS,type SosPing} from '../fun/emotes.ts';
import {pickLine} from '../fun/lines.ts';
import {causeCopy} from './cause.ts';
import {worldBase} from '../../maps/index.ts';
import {getAudio} from '../audio/engine.ts';
import {icon} from '../ui/icon.ts';
import {wallOf} from './camp.ts';
import {secondsLeft} from './model.ts';
import {cityAssetOf,cityMapInfo,trackMouths,screenCorners,hornSeconds,cityEdgeTargets,layoutCityEdges,blockReason,WALL_HIT_MS,
  type CityAssetLike,type CityMapInfo,type CityView,type MouthId,type NoticeKind,type EnemyPoint} from './city/index.ts';

/** The HUD pieces that hide the map (edges.ts COVERING, shared with the arrows sandbox and pinned by a test). */
export {COVERING};
function boxes(doc:Document,selector:string):Rect[]{
  const out:Rect[]=[];
  for(const el of doc.querySelectorAll(selector)){
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
  private frame=0;private minimapAt=0;private timers=new Set<ReturnType<typeof setTimeout>>();
  /** HUD boxes over the map, read twice a second and on every layout change (a window opening): a target under them is not in view. */
  private covered:Rect[]=[];private windows:Rect[]=[];private coveredAt=-Infinity;private coveredZones?:object;
  private readonly outline=islandOutline();
  // ---------- City (design/cidade-hud.md §7) ----------
  /** The city's map info, built once per decoded asset. */
  private cityInfo?:{asset:CityAssetLike;map:CityMapInfo};
  /** Avenue mouths lit by spawn warnings (trackMouths), and the group keys that had an arrow last frame (hysteresis). */
  private mouths=new Map<MouthId,number>();private groupKeys=new Set<string>();
  /** When the wall last lost life and the local hero last took damage (performance.now ms), from the views. */
  private wallHitAt=-Infinity;private hurtAt=-Infinity;private wallHp?:number;private selfHp?:number;
  private notice?:NoticeKind;
  constructor(options:RescueOptions){
    this.net=options.net;this.hud=options.hud;this.scene=options.scene;
    const b=this.button=document.createElement('button');b.type='button';b.id='coop-sos';b.hidden=true;
    b.setAttribute('aria-label','Me salva: chama a turma até você');
    b.innerHTML=`<svg class="sos-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" pathLength="100"/></svg>${icon('boia',{size:40})}<span>Me salva</span>`;
    // Pointer down answers at once, like the skill button; the HUD's taps never reach the joystick or the map.
    b.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();options.onTap?.();this.ask();});
    b.addEventListener('click',e=>{e.stopPropagation();if(e.detail===0)this.ask();});
    options.actions.append(b);
    this.net.onSos=ping=>this.ping(ping);
    const loop=()=>{this.tick();this.frame=requestAnimationFrame(loop);};this.frame=requestAnimationFrame(loop);
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
    this.last=view;this.states=new Map(view.players.map(p=>[p.id,p]));
    keepWarnings(this.warnings,view.events,view.tick);
    const asset=cityAssetOf(this.net.terrain);
    if(asset){
      trackMouths(this.mouths,view.events,view.tick,this.cityMap(asset));
      const now=performance.now(),wall=wallOf(view.structures),self=this.states.get(this.net.id);
      if(wall&&this.wallHp!==undefined&&wall.hp<this.wallHp)this.wallHitAt=now;
      if(self&&this.selfHp!==undefined&&self.hp<this.selfHp)this.hurtAt=now;
      this.wallHp=wall?.hp;this.selfHp=self?.hp;
    }
    for(const e of view.events){
      if(e.type==='downed'){
        // What got you (UX-voce-e-dano f) left the banner: it is the caído's first line over the body.
        const kind=this.hud.tally.causes.last.get(e.player),line=kind?causeCopy(kind).line:undefined;
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
  private tick(){
    const scene=this.scene(),net=this.net,hud=this.hud,run=net.run;
    // The room may switch maps in the lobby and the HUD is built once (explore.ts): the slot follows the world now.
    const asset=cityAssetOf(net.terrain);
    hud.useCityMinimap(!!asset);
    const combat=run?.phase==='combat'&&!hud.el.hidden&&!hud.el.classList.contains('rh-ended');
    const now=performance.now(),me=net.feed.players.get(net.id);
    const sos=sosButton(me,run?.phase==='combat',this.gate.remaining(net.id,now));
    if(this.button.hidden===sos.show)this.button.hidden=!sos.show;
    if(sos.show){
      this.button.setAttribute('aria-disabled',String(sos.cooling));
      this.button.style.setProperty('--sos-left',String(Math.round(sos.left*100)));
    }
    // Out of the wave the run's leftovers go (an old view, spawn warnings, lit pings, "Segura aí" already said).
    if(run?.phase!=='combat'&&this.last){this.last=undefined;this.states.clear();this.warnings.length=0;this.pings.clear();this.said.clear();
      this.mouths.clear();this.groupKeys.clear();this.wallHp=this.selfHp=undefined;this.wallHitAt=this.hurtAt=-Infinity;}
    if(!scene||!combat||!this.last){hud.edges?.clear();if(hud.cityMap.open)hud.closeCityMap();return;}
    const view=net.view(now),focus=scene.focusPoint(),zones=hud.zones();
    const self=view.players.find(p=>p.id===net.id);
    const hold=holdLine(self,this.states.get(net.id),view.players,this.states,this.said);
    if(hold)scene.say(net.id,hold.line);
    if(asset){this.cityFrame(asset,scene,view.players,focus,zones,now);return;}
    const {targets,items}=radar({selfId:net.id,focus,self:self??focus,tick:this.last.tick,players:view.players,states:this.states,
      base:worldBase(net.terrain),enemies:net.feed.enemies.values(),telegraphs:this.last.telegraphs,pickups:this.last.pickups,
      warnings:this.warnings,nodes:this.last.nodes,pinged:id=>!!this.pings.get(id,now),locate:p=>scene.locate(p).screen,portrait:c=>defaultPortrait(c)});
    const area=scene.usefulArea??zones.useful,seen=this.seen(now,zones);
    hud.edges?.render(layoutEdges(targets,area,scene.heroScreenRect(),{seen,windows:this.windows}));
    // What must keep an arrow (a caído or the boss off the field): the zones audit checks it against the arrows drawn.
    hud.edges?.need(pointedTargets(targets,area,seen));
    // The minimap at ~15 Hz is plenty (dots move a fraction of a pixel per frame at its scale).
    if(hud.minimap&&now-this.minimapAt>=66){
      this.minimapAt=now;
      const endless=!!net.terrain.chunks,range=MINIMAP_RANGE[endless?'infinito':'ilha'][hud.minimap.far?1:0];
      hud.minimap.render(focus,scene.cameraView,range,items,endless?undefined:this.outline);
    }
  }
  /** What the player sees: the viewport minus the HUD over it, read twice a second and on every layout change. */
  private seen(now:number,zones:ScreenZones){
    const hud=this.hud;
    if(now-this.coveredAt>500||zones!==this.coveredZones){this.coveredAt=now;this.coveredZones=zones;this.covered=boxes(hud.el.ownerDocument,COVERING);this.windows=boxes(hud.el.ownerDocument,WINDOWS);}
    return {viewport:{x:0,y:0,width:innerWidth,height:innerHeight},covered:this.covered};
  }
  private cityMap(asset:CityAssetLike){
    if(this.cityInfo?.asset!==asset)this.cityInfo={asset,map:cityMapInfo(asset)};
    return this.cityInfo.map;
  }
  /**
   * One city frame (design/cidade-hud.md §1–§3): the city's arrows every frame; the big minimap's blocking and closing;
   * the minimap at 5 Hz (at once when the big one opens or closes).
   */
  private cityFrame(asset:CityAssetLike,scene:IslandScene,players:readonly {id:string;name:string;classId:string;x:number;y:number;online:boolean;spectator?:boolean}[],
    focus:{x:number;y:number},zones:ScreenZones,now:number){
    const net=this.net,hud=this.hud,last=this.last!,map=this.cityMap(asset);
    const area=scene.usefulArea??zones.useful,seen=this.seen(now,zones);
    const locate=(p:{x:number;y:number})=>scene.locate(p).screen,isOnScreen=(p:{x:number;y:number})=>inView(locate(p),seen);
    // Who shows (as radar.ts): nobody spectating or out; someone away only while caído (the body still bleeds out).
    const people:{id:string;x:number;y:number;name:string;portrait:string;downed?:boolean;seconds?:number;ping?:boolean}[]=[];
    for(const p of players){
      const st=this.states.get(p.id);
      if(p.spectator||st?.eliminated)continue;
      const downed=st?.downed;
      if(!downed&&!p.online&&p.id!==net.id)continue;
      const ping=!!downed&&!!this.pings.get(p.id,now);
      people.push({id:p.id,x:p.x,y:p.y,name:p.name,portrait:defaultPortrait(p.classId),...(downed?{downed:true,seconds:secondsLeft(downed.bleedOutTick,last.tick)}:{}),...(ping?{ping}:{})});
    }
    const enemies:EnemyPoint[]=[];let nearest=Infinity;
    for(const e of net.feed.enemies.values()){
      if(e.hp<=0)continue;
      enemies.push({id:e.id,x:e.x,y:e.y,...(e.boss?{boss:true}:{})});
      nearest=Math.min(nearest,Math.hypot(e.x-focus.x,e.y-focus.y));
    }
    const phase:'wave'|'prepare'=last.round?.phase==='prepare'?'prepare':'wave',activeMouths=trackMouths(this.mouths,[],last.tick,map);
    const {targets,groupKeys}=cityEdgeTargets({hero:focus,selfId:net.id,players:people,enemies,activeMouths,map,phase,
      wallHitRecently:now-this.wallHitAt<=WALL_HIT_MS,hornSeconds:hornSeconds(last.camp,last.tick,phase),locate,isOnScreen,previousGroups:this.groupKeys});
    this.groupKeys=groupKeys;
    if(hud.edges){
      hud.edges.render(layoutCityEdges(targets,area,scene.heroScreenRect(),{seen,windows:this.windows,textScale:hud.edges.scale()}));
      hud.edges.need(pointedTargets(targets,area,seen));
    }
    // The big minimap (doc §2): blocked by a critter at 2.5 u or a notice; closes by itself (time, notice, damage, telegraph).
    const big=hud.cityBig(),notice=hud.cityNotice(),announced=!!notice&&notice!==this.notice;this.notice=notice;
    const nearestEnemy=Number.isFinite(nearest)?nearest:undefined;
    hud.blockCityMap(blockReason(nearestEnemy,notice,big.coversAnnounce));
    // A telegraph about to go off within its reach (+ 1 u) of the hero touches the hero's zone.
    const telegraphOnHero=last.telegraphs.some(t=>t.fireTick>=last.tick&&Math.hypot(t.x-focus.x,t.y-focus.y)<=t.radius+1);
    hud.cityMap.update({nowMs:now,phase,announced,notice,coversAnnounce:big.coversAnnounce,hurt:this.hurtAt>(hud.cityMap.openedAt??Infinity),telegraphOnHero,nearestEnemy});
    const city=hud.cityMinimap;
    if(!city||!(hud.cityMap.take()||now-this.minimapAt>=200))return;
    this.minimapAt=now;
    const open=hud.cityMap.open,wall=wallOf(last.structures);
    // Big only, in the intermission: the 8 nearest closed chests (doc §2).
    const chests=open&&phase==='prepare'?last.pickups.filter(p=>p.kind==='chest').sort((a,b)=>Math.hypot(a.x-focus.x,a.y-focus.y)-Math.hypot(b.x-focus.x,b.y-focus.y)).slice(0,8):undefined;
    city.render({map,view:scene.cameraView as CityView,...(open?{side:big.side,screen:screenCorners(locate,focus,{width:innerWidth,height:innerHeight})}:{}),
      selfId:net.id,players:people,enemies,activeMouths,...(wall?{baseHp:{hp:wall.hp,maxHp:wall.maxHp}}:{}),...(chests?{chests}:{}),offline:hud.offline},open);
  }
  destroy(){for(const t of this.timers)clearTimeout(t);cancelAnimationFrame(this.frame);this.net.onSos=()=>{};this.button.remove();}
}
