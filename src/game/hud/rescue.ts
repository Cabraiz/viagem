/**
 * Client glue of the off-screen and rescue cards (UX-bordas-fora-da-tela, ORQ-minimapa, UX-resgate-e-ping), mounted
 * by explore.ts in a real run:
 * - every frame: radar → edge arrows on the useful area's rim and the minimap (radar.ts, edges.ts, minimap.ts);
 * - "Me salva": while caído the skill button's place becomes a big ping button (3 s anti-spam, EmoteGate); the room
 *   relays the ping with the position to every phone, which lights the caído's arrow and dot, plays the fall whistle
 *   (and its buzz, VGM-050 settings) and shows the caído's own help line over the body;
 * - lines over heads (fun/lines, 053A): the fall (what got you, else the class line), the rescuer's "Segura aí, Zé!"
 *   while it holds the rescue, the class rescue line, and the rescue sound with its buzz for the rescuer.
 * Its pure helpers (holdLine, sosButton) live in radar.ts (tests); this part needs the DOM, the scene and the socket.
 */
import type {CoopClient} from '../net/client.ts';
import type {RunHud} from './hud.ts';
import type {RunView,PlayerRunView} from '../sim/view.ts';
import {railName} from '../render/map-label-rules.ts';
import type {IslandScene} from '../scene.ts';
import {layoutEdges,pointedTargets} from './edges.ts';
import type {Rect} from './zones.ts';
import {MINIMAP_RANGE,islandOutline} from './minimap.ts';
import {radar,keepWarnings,holdLine,sosButton,type SpawnWarning} from './radar.ts';
import {defaultPortrait} from './hud.ts';
import {EmoteGate,SosBoard,SOS_COOLDOWN_MS,type SosPing} from '../fun/emotes.ts';
import {pickLine} from '../fun/lines.ts';
import {causeCopy} from './cause.ts';
import {worldBase} from '../world.ts';
import {getAudio} from '../audio/engine.ts';
import {icon} from '../../ui/icon.ts';

/**
 * The HUD pieces that hide the map under them (readouts, base ficha, team, controls, minimap, the open offer or forge,
 * and the announcement slot with the kill-cam), viewport CSS px. A caído under an open window is not "in view": it
 * gets its arrow beside the window (NEW-20261011-UX-janela-esconde-caido).
 */
export const COVERING='.rh-round,.rh-xp,.rh-boss,.rh-camp,.rh-member,.rh-stack>:not([hidden]),.explore-camera button,.explore-config,.explore-stick,#coop-attack,#coop-sos,.rh-minimap,.rh-offer-chip,.rh-offer:not([hidden]),.rh-forge:not([hidden])';
function coveredBoxes(doc:Document):Rect[]{
  const out:Rect[]=[];
  for(const el of doc.querySelectorAll(COVERING)){
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
  private covered:Rect[]=[];private coveredAt=-Infinity;private coveredZones?:object;
  private readonly outline=islandOutline();
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
    const combat=run?.phase==='combat'&&!hud.el.hidden&&!hud.el.classList.contains('rh-ended');
    const now=performance.now(),me=net.feed.players.get(net.id);
    const sos=sosButton(me,run?.phase==='combat',this.gate.remaining(net.id,now));
    if(this.button.hidden===sos.show)this.button.hidden=!sos.show;
    if(sos.show){
      this.button.setAttribute('aria-disabled',String(sos.cooling));
      this.button.style.setProperty('--sos-left',String(Math.round(sos.left*100)));
    }
    // Out of the wave the run's leftovers go (an old view, spawn warnings, lit pings, "Segura aí" already said).
    if(run?.phase!=='combat'&&this.last){this.last=undefined;this.states.clear();this.warnings.length=0;this.pings.clear();this.said.clear();}
    if(!scene||!combat||!this.last){hud.edges?.clear();return;}
    const view=net.view(now),focus=scene.focusPoint(),zones=hud.zones();
    const self=view.players.find(p=>p.id===net.id);
    const hold=holdLine(self,this.states.get(net.id),view.players,this.states,this.said);
    if(hold)scene.say(net.id,hold.line);
    const {targets,items}=radar({selfId:net.id,focus,self:self??focus,tick:this.last.tick,players:view.players,states:this.states,
      base:worldBase(net.terrain),enemies:net.feed.enemies.values(),telegraphs:this.last.telegraphs,pickups:this.last.pickups,
      warnings:this.warnings,nodes:this.last.nodes,pinged:id=>!!this.pings.get(id,now),locate:p=>scene.locate(p).screen,portrait:c=>defaultPortrait(c)});
    const area=scene.usefulArea??zones.useful;
    if(now-this.coveredAt>500||zones!==this.coveredZones){this.coveredAt=now;this.coveredZones=zones;this.covered=coveredBoxes(hud.el.ownerDocument);}
    const seen={viewport:{x:0,y:0,width:innerWidth,height:innerHeight},covered:this.covered};
    hud.edges?.render(layoutEdges(targets,area,scene.heroScreenRect(),{seen}));
    // What must keep an arrow (a caído or the boss off the field): the zones audit checks it against the arrows drawn.
    hud.edges?.need(pointedTargets(targets,area,seen));
    // The minimap at ~15 Hz is plenty (dots move a fraction of a pixel per frame at its scale).
    if(hud.minimap&&now-this.minimapAt>=66){
      this.minimapAt=now;
      const endless=!!net.terrain.chunks,range=MINIMAP_RANGE[endless?'infinito':'ilha'][hud.minimap.far?1:0];
      hud.minimap.render(focus,scene.cameraView,range,items,endless?undefined:this.outline);
    }
  }
  destroy(){for(const t of this.timers)clearTimeout(t);cancelAnimationFrame(this.frame);this.net.onSos=()=>{};this.button.remove();}
}
