import './explore.css';
import {putData,putHidden,putText} from './hud/dom-put.ts';
import {firstShown,shownHolds,stickyQuery} from './hud/dom-find.ts';
import type { HeroClass } from '../rules/index.ts';
import {buildPlanFor,landmarks} from '../maps/index.ts';
import {LINK_LOST,type CoopClient} from './net/client.ts';
import './coop.css';
import './fun/fun.css';
import {EmoteBar} from './fun/emotes.ts';

/** The quick-emote bar (EmoteBar) is off until it comes back as a radial wheel around the hero. */
const EMOTE_BAR=false;
import {ZONE_WINDOWS} from './hud/zones.ts';
/** The match windows a thumb control must not cover (the emote bar hides while one is open). */
const OPEN_WINDOWS=ZONE_WINDOWS.map(s=>`${s}:not([hidden])`).join(',');
import {JoystickInput} from './joystick.ts';
import {RunHud,defaultPortrait} from './hud/hud.ts';
import {SpectatorBar} from './hud/spectator.ts';
import './hud/spectator.css';
import {exploraOf,minervaOf} from './hud/minerva.ts';
import {sceneOfPhase,setMusicScene} from './audio/menu-music.ts';
import {getAudio} from './audio/engine.ts';
import {mountAudioControls} from './audio/controls.ts';
import {auditBoxes,auditBoxesFromDom,besideArea,measureZones,type Rect} from './hud/zones.ts';
import {besideFrom,freeAround} from './framing.ts';
import {besideSelector,coverUp,mapInfoText} from './lobby.ts';
import {formatRoomCode,shareLink} from './ui/invite.ts';
import {TOTAL_ROUNDS} from './hud/model.ts';
import type {MapRunResult} from './hud/result.ts';
import {DamageTally} from './net/run-feed.ts';
import {ROOM_CLOSING_NOTICE,KICKED_TITLE} from '../protocol/index.ts';
import {showFatal,hideFatal,showSlowLink,SLOW_LINK_MS,BACK_TO_ROOM} from './net-fatal.ts';
import './hud/menu.css';
import {BACK_ONLINE_ROW_MS,BackOnlineWatch,SOLO_LINE,createGameMenu,menuBack,menuFocus,quietStatus,roomLine,type GameMenu} from './hud/menu.ts';
import type {RunState,RunView} from '../contract/index.ts';
import {SkillButton} from './hud/skill.ts';
import {AttackButton} from './hud/attack-button.ts';
import {heldReach,heldWeapon} from './hud/weapon-reach.ts';
import {icon,compass} from './ui/icon.ts';
import {gearTagSeen,guardBack,wantsGearTag} from './match-guard.ts';
import {RescueBoard} from './hud/rescue.ts';
import {ObraHud} from './hud/towers/obra.ts';
import type {ObraView} from './hud/towers/model.ts';
import {OBRA_NO_ANSWER,OBRA_TOAST_MS,ObraRequests,obraViewFrom,siteOf,towersInWorld} from './hud/towers/wiring.ts';
import {FortifyHud} from './hud/fortify/fortify.ts';
import {FORT_AIM_FIRST,FortBuild,construirEm,fortCounts,pullRefusalText,pullState,towFace} from './hud/fortify/model.ts';
import {buildHints} from './render/fortify-rules.ts';
import {KIT_TAP_HINT,KitArt,KitPlace,kitGround,kitRefusalText} from './hud/kit-place/model.ts';
import {KitGesture} from './hud/kit-place/gesture.ts';
import {WorkLatch,workShop,workingIn} from './hud/bicos.ts';
import {TralhaPick} from './hud/tralha/model.ts';
import {TralhaHud} from './hud/tralha/tralha.ts';
import {objectiveOf} from './render/chaveiro/view.ts';
import type {KeyValue} from './economy.ts';
import {QUALITY_LABEL,QUALITY_LEVELS,chooseQuality,detectQuality,deviceHints,loadQuality,qualityFromUrl,qualityProfile,saveQuality,stepDown,undoQuality,type QualityLevel,type QualitySettings} from './quality.ts';
import {pageZoomEvent,saveZoom,startZoom} from './camera-zoom.ts';
import {BOOT_TEXT,COVER_SLOW_MS,SLOW_COVER,bootFailure,refusalExit,webglWorks,type BootExit,type BootFailure} from './match-boot.ts';
import {chunkFailed,leftMatch,matchEnded,setMatchSlot,UPDATE_ROW_MS,type MatchSlot} from './ui/update-toast.ts';
import {RESUMED_ROW_MS,resumedOnce} from './ui/resumed-row.ts';
import {LayoutCache,viewportSize} from './hud/box-cache.ts';

/** The shell's data attributes that change every frame (the hero's spot, the tick) are written at most this often (ms). */
const SHELL_DATA_MS=250;
/** ?perf=1: the shell also carries the attributes only measurements read (data-tick, data-enemies), and the room's debug line. */
const SHELL_DEBUG=perfEnabled(globalThis.location?.search??'');
/** Economy toast (VGM-048): how long the "ligado sozinho" line stays before it leaves on its own. */
const ECONOMY_TOAST_MS=9000;
/** How long the "Gira fora da briga" answer to a tap on the locked camera stays (balloon or slot row). */
const CAMERA_HINT_MS=1500;
const economyStore=():KeyValue|null=>{try{return globalThis.localStorage??null;}catch{return null;}};
import {inviteQuery,uxMetricsEnabled} from './dev/ux-flag.ts';
import {GL_LOST_TEXT,GL_LOST_BUTTON,watchGlLoss,glLostTarget} from './render/gl-lost.ts';
import {perfEnabled} from './dev/perf-flag.ts';
import type {UxMetrics} from './dev/ux-metrics.ts';
import {artReady} from './ui/art-boot.ts';
import {controlsFor,applyControls,STICK_HTML,CONTROLS_HINT_HTML,SKILL_HTML} from './controls-phase.ts';
import {INPUT_TEXTS,InputKindWatch,coopNotice,finePointer,focusLost,hotkeyOf} from './desktop-input.ts';
import {HUD_SWITCH} from './hud/arrows.ts';
import {adBreakThen,soloRoom} from './ads/ads.ts';
import {CenaClock} from './render/chefao-cena.ts';
import type {Match} from './hud/perfis.ts';

/** Label of the result button when the room refuses another run (042a R2: not enough room lifetime left). */
const REMATCH_REFUSED='Criem uma sala nova';
/** Center banner while the socket stays down past RECONNECT_BANNER_MS (the client retries on its own). */
const RECONNECTING='Reconectando à turma…';
/** ?matches=sempre|demo → the HUD's dice and starting matches (hud/perfis.ts); anything else: the real ones. */
const matchesFlag=(flag:string|null):{profileRng?:()=>number;profileDemo?:readonly Match[]}=>
  flag==='sempre'?{profileRng:()=>0}:flag==='demo'?{profileRng:()=>0,profileDemo:[{kind:'bebado',distance:12,tilt:-3},{kind:'pombos',distance:7,tilt:2.5},{kind:'tio-pave',distance:31,tilt:-1.5}]}:{};

let active=false;
/** `solo` ("Jogar sozinho", lobby.ts openSolo): the loading cover stays until the match, the room's 3-2-1 plays on it. */
export async function openExploration(hero:HeroClass,name:string,net?:CoopClient,options:{solo?:boolean}={}){
  if(active)return;
  active=true;
  const returnFocus=document.getElementById('confirm');
  const shell=document.createElement('dialog');shell.className='explore-shell';shell.setAttribute('aria-label','Partida');shell.dataset.build='viagem-island-v2';
  shell.innerHTML=`<div class="explore-layout">
    <div class="explore-camera" role="group" aria-label="Girar câmera"><button data-turn="-1" aria-label="Girar câmera para a esquerda" disabled>${icon('girar-camera',{size:32,className:'ic-espelho'})}</button><span class="explore-view">${compass(0,{size:32})}<span class="sr-only" aria-live="polite">Vista 1 de 4</span></span><i class="explore-lock" aria-hidden="true">${icon('cadeado',{size:32})}</i><button data-turn="1" aria-label="Girar câmera para a direita" disabled>${icon('girar-camera',{size:32})}</button><span class="explore-camera-hint" role="status" hidden>${icon('cadeado',{size:24})}<span>Gira fora da briga</span></span></div>
    <button class="explore-config" aria-label="Configurações do jogo" aria-haspopup="dialog">${icon('config',{size:32})}${wantsGearTag()?'<span class="explore-config-tag" aria-hidden="true">Pausa</span>':''}</button>
    <header class="explore-top"><div class="explore-title"><img alt=""/><div><h2>Ilha do Começo</h2><p>Explorando sozinho como <span id="explorer-name"></span></p></div></div><button class="explore-exit">${icon('voltar')} Heróis</button></header>
    <section class="explore-stage" aria-label="Mapa da partida">
      <div class="explore-canvas" role="application" tabindex="0" aria-label="Mapa explorável. Use as setas ou WASD, toque no chão ou arraste o direcional."></div>
      <div class="explore-quest"><strong>Conheça a ilha</strong><span id="explore-progress">0 de 3 lugares descobertos</span></div>
      <div class="explore-map" aria-hidden="true"><svg viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="39" ry="39" fill="#c8d795"/><path d="M50 68 35 47 69 47 50 24 35 47" fill="none" stroke="#f7e5b2" stroke-width="5"/><g fill="#a184b4"><circle cx="35" cy="47" r="3"/><circle cx="69" cy="47" r="3"/><circle cx="50" cy="24" r="3"/></g><circle id="explore-dot" cx="50" cy="68" r="4" fill="#fff7d3" stroke="#7e638f" stroke-width="2"/></svg></div>
      <div class="explore-notice" role="status">${INPUT_TEXTS.touch.soloNotice}</div>
      <div class="explore-loading" role="status">${BOOT_TEXT.loading}</div>
    </section>
    <footer class="explore-controls"><div class="explore-movement">${STICK_HTML}${CONTROLS_HINT_HTML}<small>Arraste para andar</small></div><div class="explore-help"><strong>Sem pressa. É só o começo.</strong><p><span class="explore-help-walk">${INPUT_TEXTS.touch.soloHelp}</span></p></div><div class="explore-actions"><button id="explore-trail">Seguir trilha</button><button class="explore-pause" aria-pressed="false">Pausar</button></div></footer>
  </div>`;
  const $=<T extends HTMLElement>(selector:string)=>shell.querySelector<T>(selector)!;
  /** The position callback's per-frame lookups (Q6): the template's elements found once, the HUD's windows through live
   * class lists instead of `:not([hidden])` walks over the whole page every frame (hud/dom-find.ts). */
  const find=stickyQuery(shell);
  const trayLists=[document.getElementsByClassName('rh-forge'),document.getElementsByClassName('rh-cida')] as HTMLCollectionOf<HTMLElement>[];
  const obraList=document.getElementsByClassName('rh-obra') as HTMLCollectionOf<HTMLElement>;
  /** The class skill button (E7-skill-hud-wiring): one tap, one cast; cooldown and "sem alvo" on the button. */
  let skill:SkillButton|undefined;
  /** D-051 manual combat: the same #coop-attack as the attack button (press, hold, drag, reticle); idle otherwise. */
  let attackBtn:AttackButton|undefined;
  /** Space on the desktop (controles-desktop): the skill button's own tap, set in a room only. */
  let castSkill:(()=>void)|undefined;
  let emotes:EmoteBar|undefined;
  let hud:RunHud|undefined,resultShown:number|undefined;
  // The chefão's arrival scene (boss-fim-onda-1): one clock for the camera and the HUD's title, fed by the run state.
  const cena=new CenaClock(economyStore());
  const syncCena=(run:RunState|undefined)=>{if(run?.phase==='combat')cena.sync(run.cena,performance.now());else cena.reset();};
  let rescue:RescueBoard|undefined;
  /** The torcida's bar while out or watching (UX-espectador). */
  let spect:SpectatorBar|undefined;
  /**
   * The obra menu (torres-ligar, D-041): the build sites in the intermission, its build/upgrade to the room and the
   * room's {t:'built'} answer (a stamp on the marker, or the refusal as a row of the announcement slot).
   */
  let obra:ObraHud|undefined,obraView:ObraView|undefined,obraSay:(text:string)=>void=()=>undefined;
  const obraRequests=new ObraRequests();
  /** D-052 slice 3: the car's rope (Puxar) and the free build (Construir, the ghost, the wall counter). */
  let fort:FortifyHud|undefined;const fortBuild=new FortBuild();
  /**
   * Kits de torre and barricadas (torre-pela-caixa, barricada-tocar-no-mapa): a tap on the kit's slot selects it, a press
   * on the map puts the ghost there, the drag turns it and letting go builds (kitGesture → placeNow); the kit again, a
   * weapon or Esc lets it go. The attack button stays Atacar.
   */
  const kitPlace=new KitPlace(),kitArt=new KitArt();let placeNow:()=>void=()=>undefined,refreshKitGhost:()=>void=()=>undefined,kitShown=false,kitGesture:KitGesture|undefined;
  /** torre-limite-rebocar-sem-arma: the action button on the Uno's rope ("Rebocar"/"Soltar", skill.towing) sends {t:'puxar'}. */
  let towTap:()=>void=()=>undefined;
  /** Bicos (hud/bicos.ts): in an open shop's ring the attack button is Trabalhar; a tap clocks in, moving clocks out. */
  const workLatch=new WorkLatch();
  let tralhaHud:TralhaHud|undefined;const tralhaPick=new TralhaPick();
  /** The client stopped for good: its reason and a reload button replace "Reconectando…" (UX onda 4, B13). */
  let fatalShown:string|undefined;
  /** Playtest metrics (UX-playtest-metricas): only with ?dev=1, loaded on demand; every use is `ux?.`. */
  let ux:UxMetrics|undefined;
  /** The HUD slot lent to the version notice (room only). */
  let updateSlot:MatchSlot|undefined;
  // Dev overlay of the screen zones (UX-zonas-tela): ?zonas in the URL.
  let zoneOverlay=import.meta.env.DEV&&new URLSearchParams(location.search).has('zonas');
  const damage=new DamageTally();
  if(net){
    shell.classList.add('coop-shell');shell.dataset.build='viagem-coop-v3';shell.dataset.room=net.code;
    // The walk words follow the input kind (syncInput below): the phone's "Arraste…", the desktop's keys and clicks.
    $('.explore-notice').textContent=INPUT_TEXTS.touch.coopNotice;
    // The room plays on the endless map (D-019, terreno-em-blocos): no island words here; the island tour is solo only.
    shell.setAttribute('aria-label','Mapa da turma');$('.explore-title h2').textContent='Mapa da turma';
    $('.explore-stage').setAttribute('aria-label','Mapa sem fim da turma');
    $('.explore-title p').innerHTML='Jogando como <span id="explorer-name"></span>';
    $('.explore-quest').innerHTML='<small>A turma contra os bêbados</small><strong id="coop-objective">Segurem a muralha</strong><span id="coop-health"></span><div class="coop-party"></div>';
    // The island's little map (and its dot) has no meaning on the endless map: the HUD's minimap does that job.
    shell.querySelector('.explore-map')?.remove();
    $('.explore-help').innerHTML='<strong id="coop-code"></strong><p id="coop-network">Conectado</p><button id="coop-copy">Copiar convite</button>';
    $('#coop-code').textContent=roomLine(net.run?.members,net.id);
    // Weapons fire on their own: this slot is the class skill. One tap sends one {t:'cast'} (net.cast, input-10hz),
    // never during the cooldown; the button shows the cooldown and the caster's line comes as a balloon (`skill` event).
    $('.explore-actions').innerHTML=`${SKILL_HTML}<button class="explore-pause" aria-pressed="false">Pausar controles</button>`;
    skill=new SkillButton($<HTMLButtonElement>('#coop-attack'),hero.id);
    // D-051: the welcome already said the combat (net.join resolved), so a manual room never paints "Habilidade" first.
    skill.setCombat(net.combat);
    // Quick emotes (emote-relay-sala): the bar above the skill button is OFF (user, 13/10: "remova esse botão"; when it
    // comes back it is a radial wheel around the hero, like a weapon wheel). The relay and the balloons stay.
    if(EMOTE_BAR){emotes=new EmoteBar($('.explore-layout'),{playerId:net.id,onEmote:id=>{net.emote(id);}});emotes.root.hidden=true;}
    // The room's connection panel (players online, latency, a reconnect test) is a dev tool: the published game never
    // shows it (painel-conexao-so-dev); `vite dev` and ?perf=1 keep it.
    if(import.meta.env.DEV||SHELL_DEBUG){const debug=document.createElement('details');debug.className='coop-debug';debug.innerHTML='<summary>Conexão da sala</summary><span id="coop-diagnostics"></span><br/><button id="coop-reconnect">Testar reconexão</button>';$('.explore-layout').append(debug);}
    // The run HUD (VGM-040) replaces the old .coop-run strip: ready lives in the waiting room, rematch on the result screen.
    // ?matches=sempre: every kill of the hero is a match (hud/perfis.ts MatchBook); ?matches=demo (gravar-partida's matches
    // roteiro): the same, and the run starts with three, so the flame and its card show with no kill (round 1 has no weapon).
    hud=new RunHud($('.explore-layout'),{localId:net.id,worldRescue:true,cena,...matchesFlag(new URLSearchParams(location.search).get('matches')),onChoose:(offer,index)=>net.choose(offer,index),onSkip:offer=>net.skipOffer(offer),onReroll:offer=>net.rerollOffer(offer),// Ads (anuncios-h5-games): an interstitial only here, on the result: "Sair", and the rematch when no other human
      // waits on this player's vote (a room of friends never waits on someone's ad). Off or blocked = runs at once.
      onRematch:()=>{if(net&&soloRoom(net.run?.members,net.id))adBreakThen('revanche',()=>net?.rematch());else net?.rematch();},
      onExit:()=>adBreakThen('sair',()=>close()),critterIcon:kind=>controller?.scene.critterIcon(kind),
      onForge:(recipe,target)=>net.forge(recipe,target),
      // Dona Cida (D-047): {t:'cida'}; the room answers {t:'bought'} (net.onBought below).
      onCida:item=>net.buyCida(item),
      // PIX to a friend (carteira-e-pix): a tap on a portrait opens the balloon (hud/pix.ts); the room answers the promise.
      onPix:(to,amount)=>net.pix(to,amount),
      // D-051 inventory (manual combat): equip/use/drop/take; the room answers {t:'inv'} (net.onInventory below).
      // A kit de torre's tap ({t:'kit'}) stays here: it selects the kit (hud/kit-place), the same kit again lets it go.
      // With a kit selected, a weapon's tap puts the weapon back in the button (the one already in the hand sends nothing).
      onInventory:command=>{
        const me=hud?.view?.players.find(p=>p.id===net.id);
        if(command.t!=='kit'){
          const held=kitPlace.active&&command.t==='equip'&&command.slot===me?.hand;
          if(command.t==='equip')kitPlace.cancel();
          return held||net.inventory(command);
        }
        if(kitPlace.active&&kitPlace.kit?.slot===command.slot){kitPlace.cancel();return true;}
        const id=me?.weapons[command.slot]?.id;
        if(!id||!kitPlace.start(command.slot,id))return false;
        obraSay(KIT_TAP_HINT);
        return true;
      },
      kitSlot:()=>kitPlace.kit?.slot,
      // The owner's commands from the result screen (D-025); the room checks owner, phase and round.
      onKick:id=>net.kick(id),onAddBot:()=>net.addBot(),onRemoveBot:id=>net.removeBot(id),
      // First-run coach (VGM-056): the hint steps aside from the hero at view rate.
      heroRect:()=>controller?.scene.heroScreenRect()});
    // D-050: the level-up pause reaches the HUD with each run state (no frame brings it: the tick stands still).
    net.onRun=run=>{syncCena(run);hud?.setPause(run.phase==='combat'?run.pause:undefined);syncCover();};
    net.onForged=answer=>hud?.forged(answer);
    net.onBought=answer=>hud?.bought(answer);
    net.onInventory=result=>hud?.inventoryAnswer(result);
    {
      const host=hud;
      const note=document.createElement('div');note.className='rh-obra-aviso';note.setAttribute('role','status');note.hidden=true;
      // An answer to the player's own tap: it goes ahead of the coach's hint (like "Gira fora da briga").
      obraSay=text=>{note.textContent=text;host.queueRow(note,OBRA_TOAST_MS,{answer:true});};
      obra=new ObraHud($('.explore-layout'),{zoneInput:()=>host.zoneInputBesideObra(),
        onConfirm:action=>{const text=obraRequests.send(action,siteOf(action,obraView),net,{connected:net.connected,spectator:!!net.players.get(net.id)?.spectator});if(text)obraSay(text);},
        // Open: the forge steps aside (the same place on screen) and the camera's field leaves the window out.
        onWindow:open=>{host.yieldForge(open);host.layoutChanged();},
        // Off-screen sites' edge arrows (E4-obras-visiveis-da-base): clear of the hero and of the HUD's arrows (the base).
        heroRect:()=>controller?.scene.heroScreenRect(),edgeArrows:()=>host.edges?.shown});
      net.onBuilt=answer=>{
        // The free build's answers share {t:'built'} with the obra menu's: each takes its own requests.
        if(fortBuild.owns(answer.req)){const text=fortBuild.answer(answer);if(text)obraSay(text);return;}
        if(kitPlace.owns(answer.req)){const text=kitPlace.answer(answer);if(text)obraSay(text);return;}
        const text=obraRequests.answer(answer,host.view?.tick??0);if(text)obraSay(text);
      };
      net.onPulled=answer=>{if(!answer.ok)obraSay(pullRefusalText(answer.reason));};
      towTap=()=>{const face=skill?.towing;if(face&&net.pull(face==='rebocar')===undefined)obraSay('Agora não dá');};
      const cell=()=>buildPlanFor(net.terrain).cell;
      const send=(r:string)=>{if(r==='offline')obraSay('Agora não dá');};
      fort=new FortifyHud(host.el,{
        onPull:on=>{if(net.pull(on)===undefined)obraSay('Agora não dá');},
        onOpen:open=>{fortBuild.toggle(open);if(!open)controller?.scene.setBuildGhost(null);},
        onPick:piece=>fortBuild.pick(piece),onTurn:()=>fortBuild.turn(),
        // 'none': "Construir aqui" before any aim (varredura-celular: on the phone the tap did nothing and said nothing).
        onConfirm:()=>{const r=fortBuild.piece==='muro'?fortBuild.drag(net):fortBuild.confirm(net);if(r==='none')obraSay(FORT_AIM_FIRST);else send(r);},
        onAim:(x,y,drag)=>{const p=controller?.scene.worldAt(x,y);if(!p)return;fortBuild.point(p,cell());if(drag)send(fortBuild.drag(net));},
        onAimEnd:()=>fortBuild.endDrag(),
        canvas:()=>controller?.game.canvas});
      // barricada-tocar-no-mapa: the press let go on the map: the ghost's cell to the room; a red ghost says why instead.
      placeNow=()=>{
        if(!kitPlace.active||!kitShown)return;
        // The colour of the ghost the finger saw, recomputed for its last place (the drag may have turned it).
        if(kitPlace.blocked){obraSay(kitRefusalText(kitPlace.blocked));return;}
        const r=kitPlace.confirm(net);if(r!=='none')send(r);
      };
      refreshKitGhost=()=>{
        const scene=controller?.scene,view=hud?.view;
        if(!scene||!kitPlace.active)return;
        const car=view&&objectiveOf(view)?.car;
        scene.setBuildGhost(kitPlace.ghost({cell:cell(),...(car?{car}:{}),structures:view?.structures??[],ground:kitGround(net.terrain),
          bodies:[...[...net.players.values()].filter(p=>p.id!==net.id&&!p.spectator&&p.hp>0),...[...net.feed.enemies.values()].filter(e=>e.hp>0&&!e.asleep)]},net.predicted),[]);
      };
      kitGesture=new KitGesture({active:()=>kitPlace.active&&kitShown,canvas:()=>controller?.game.canvas,
        onPress:(x,y)=>{const p=controller?.scene.worldAt(x,y);if(p){pause(false);kitPlace.press(p,cell());refreshKitGhost();}},
        onMove:(x,y)=>{const p=controller?.scene.worldAt(x,y);if(p){kitPlace.move(p,cell());refreshKitGhost();}},
        onRelease:cancelled=>{if(kitPlace.release()&&!cancelled)placeNow();}});
      // barricada-construir part 2: tap a barricada de tralha → COLETAR / DESTRUIR; the mouse over it → outline + hand.
      const squares=()=>hud?.view?.structures??[];
      tralhaHud=new TralhaHud(host.el,{
        onTap:(x,y)=>{const p=controller?.scene.worldAt(x,y);return !!p&&tralhaPick.tap(squares(),p,cell());},
        onHover:(x,y)=>{const p=x===undefined||y===undefined?undefined:controller?.scene.worldAt(x,y);return tralhaPick.move(squares(),p,cell());},
        onAct:kind=>{const r=tralhaPick.act(kind,net,hud?.view?.tick??0);if(r==='offline')obraSay('Agora não dá');},
        canvas:()=>controller?.game.canvas,
        busy:()=>fortBuild.open||kitPlace.active});
      net.onTralha=answer=>{const text=tralhaPick.answer(answer);if(text)obraSay(text);};
    }
    // KKKK face on the team strip (rostos-kkkk): the room relays each emote, the sender's own included.
    net.onEmote=note=>hud?.emote(note.player,note.id);
    net.onDance=id=>{if(controller&&sceneReady)dancedAt.set(id,controller.scene.time.now);};
    // Edge arrows, minimap, "Me salva" and the rescue lines (UX-bordas-fora-da-tela, ORQ-minimapa, UX-resgate-e-ping).
    rescue=new RescueBoard({net,hud,actions:$('.explore-actions'),scene:()=>controller?.scene,onTap:()=>pause(false)});
    // Out or watching (UX-espectador): ‹ › pick the friend, the chinelo is screen-only, "Voltar ao lobby" leaves the room.
    spect=new SpectatorBar($('.explore-layout'),{onStep:dir=>{controller?.scene.watchStep(dir);},onLeave:()=>close(),
      target:()=>controller?.scene.watchedScreen(),portrait:classId=>defaultPortrait(classId)});
    // ?perf=1 (BUG-20261014-ORQ-engasgo-andando-celular): the frame meter on the phone; loaded only with the flag.
    if(perfEnabled(location.search))void import('./dev/perf-overlay.ts').then(m=>m.startPerfOverlay());
    if(uxMetricsEnabled(location.search))void import('./dev/ux-metrics.ts').then(m=>{
      if(closed||!hud)return;
      // It chains net.onCommand and net.onSos (RescueBoard's) and puts them back on destroy.
      ux=m.createUxMetrics(window,net);ux?.attachHud(hud);
      if(sceneReady)ux?.ready();
    }).catch(()=>undefined);
    hud.el.hidden=true;
    // Out or watching: a tap on a teammate's portrait makes the camera follow them (UX onda 4).
    // Capture phase: the HUD panels stop their own events from leaking into the game (VGM-040).
    hud.el.addEventListener('click',event=>{const member=(event.target as HTMLElement).closest<HTMLElement>('.rh-member[data-id]');if(member?.dataset.id)controller?.scene.watch(member.dataset.id);},true);
    // Dev server only (dropped from builds): the acceptance scripts read and poke the HUD (zones audit, boss marquee).
    if(import.meta.env.DEV){
      (window as unknown as {__hud?:RunHud}).__hud=hud;
      // barricada-construir: build barricada squares on build-grid cells until the gesture lands (dev only).
      (window as unknown as {__construirEm?:unknown}).__construirEm=(cells:{c:number;r:number}[])=>construirEm(net,cells);
      // The overlay module (and its CSS) is loaded on demand, so it never reaches the build.
      (window as unknown as {__zones?:unknown}).__zones={measure:()=>measureZones(),audit:(hero?:Rect)=>auditBoxes(auditBoxesFromDom(),measureZones(),hero),
        overlay:async(on:boolean)=>{zoneOverlay=on;const debug=await import('./hud/zones-debug.ts');if(!on)debug.clearZoneOverlay();else debug.drawZoneOverlay(measureZones());}};
    }
    net.onStatus=m=>{const line=$('#coop-network');line.textContent=m;line.hidden=quietStatus(m,roomLine(net.run?.members,net.id)===SOLO_LINE);};
    net.onNotice=message=>{if(message===ROOM_CLOSING_NOTICE&&resultShown!==undefined)hud?.rematchRefused(REMATCH_REFUSED);};
    document.querySelector('#coop-reconnect')?.addEventListener('click',()=>net.reconnect());
    $('#coop-copy').addEventListener('click',async()=>{$('#coop-network').hidden=false;try{await navigator.clipboard.writeText(shareLink(location.origin,net.code,inviteQuery(location.search)));$('#coop-network').textContent='Convite copiado!';}catch{$('#coop-network').textContent=`Compartilhe o código ${formatRoomCode(net.code)}`;}});
    // Pointer down answers at once (no wait for the click); a keyboard click (detail 0) is the debug fallback (D-009).
    const attack=$<HTMLButtonElement>('#coop-attack');
    const tapSkill=castSkill=()=>{if(skill?.attackMode)return;pause(false);skill?.tap(()=>net.cast(),performance.now());};
    attack.addEventListener('pointerdown',e=>{if(skill?.attackMode||e.button!==0||attack.disabled)return;e.preventDefault();tapSkill();});
    attack.addEventListener('click',e=>{if(e.detail===0&&!attack.disabled)tapSkill();});
    // D-051: in the manual combat the slot is the attack button; its listeners stay idle until the welcome says 'manual'.
    attackBtn=new AttackButton(attack,$('.explore-layout'),{
      hero:()=>controller&&sceneReady?net.predicted:undefined,toScreen:p=>controller!.scene.locate(p).screen,
      enemies:()=>net.feed.enemies.values(),tick:()=>net.tick,
      chosen:()=>controller?.scene.chosenTarget,choose:id=>controller?.scene.chooseTarget(id),
      wake:()=>pause(false),setHeld:held=>skill?.setHeld(held),
      // The aim stick (tiro-na-direcao-mobile): the arrow runs as far as the equipped weapon reaches; the ring is the left stick's size.
      reach:()=>{const me=net.feed.players.get(net.id);return me?heldReach(me):undefined;},
      ringRadius:()=>$('.explore-stick').getBoundingClientRect().width/2,
      // tiro-delay-1s-predicao: the press shows at once (swing, flash, sound); the room's copy is skipped.
      pressed:()=>{if(sceneReady)controller?.scene.predictAttack();}});
    net.onCast=result=>skill?.answer(result,performance.now());
  }
  // Only controls overlay the map. All secondary information lives in a native
  // modal so focus, Escape and touch input cannot leak into the running game.
  shell.dataset.build=net?'viagem-coop-v4':'viagem-island-v3';
  const settings=document.createElement('dialog');settings.className='explore-settings';settings.setAttribute('aria-label','Configurações do jogo');
  settings.innerHTML=`<div class="explore-settings-heading"><h2>Configurações</h2><button class="explore-settings-close" aria-label="Voltar ao jogo">${icon('fechar',{size:32})}</button></div><div class="explore-settings-content"></div>`;
  const settingsContent=settings.querySelector('.explore-settings-content')!;
  for(const selector of ['.explore-top','.explore-quest','.explore-map','.explore-help','.explore-notice','#explore-trail','.explore-pause','.coop-debug']){
    const element=shell.querySelector(selector);if(element)settingsContent.append(element);
  }
  $('.explore-movement small').remove();
  // The phone's minimal HUD (hud-mobile-minimo): the view buttons leave the top of the screen and turning the camera
  // lives here, first thing in the settings (explore.css shows this row with a finger only; the desktop keeps its
  // buttons and Q/E). The same [data-turn] buttons, so the wave lock, the compass and the answer are one logic.
  const cameraSettings=document.createElement('div');cameraSettings.className='explore-settings-camera';cameraSettings.setAttribute('role','group');cameraSettings.setAttribute('aria-label','Girar câmera');
  cameraSettings.innerHTML=`<span class="explore-settings-camera-title">Girar câmera</span><button data-turn="-1" aria-label="Girar câmera para a esquerda" disabled>${icon('girar-camera',{size:32,className:'ic-espelho'})}</button><span class="explore-view">${compass(0,{size:32})}<span class="sr-only">Vista 1 de 4</span></span><button data-turn="1" aria-label="Girar câmera para a direita" disabled>${icon('girar-camera',{size:32})}</button><span class="explore-settings-camera-note" role="status" hidden>${icon('cadeado',{size:24})}<span>Gira fora da briga</span></span>`;
  settingsContent.prepend(cameraSettings);
  const cameraNote=cameraSettings.querySelector<HTMLElement>('.explore-settings-camera-note')!;
  shell.append(settings);
  // The match menu (NEW-20261009-UX-menu-e-conexao): in a room the gear opens Continuar / Configurações / Copiar convite /
  // Sair da partida (with its confirmation) over today's settings, which become the menu's "Configurações" view. The room
  // code and the connection line head the menu; "Heróis" leaves the dialog (leaving the room asks first now).
  let menu:GameMenu|undefined;
  if(net){
    menu=createGameMenu(settings,settings.querySelector<HTMLElement>('.explore-settings-heading h2')!,settingsContent as HTMLElement,{
      onResume:()=>closeSettings(),onLeave:()=>close(),
      onView:()=>{if(settings.open)menuFocus(menu!).focus();}});
    const help=settings.querySelector('.explore-help');
    menu.status.append($('#coop-code'),$('#coop-network'));menu.invite.append($('#coop-copy'));help?.remove();
    $('.explore-exit').hidden=true;
  }
  // The menu's head line (auditoria-ui-menus 15): "Partida solo" or how many people are in, read each time the menu opens.
  const syncRoomLine=(room:CoopClient)=>{
    const line=roomLine(room.run?.members,room.id),status=$('#coop-network');
    putText($('#coop-code'),line);status.hidden=quietStatus(status.textContent??'',line===SOLO_LINE);
  };
  $('#explorer-name').textContent=name;
  // The settings' title picture (not the first <img> of the shell: with the imported art the view buttons' stickers are
  // <img> too, and the left one used to wear the hero's portrait, hud-mobile-minimo).
  shell.querySelector<HTMLImageElement>('.explore-title img')!.src=`/art/portraits/${hero.id}-thumb.webp`;
  document.body.append(shell);shell.showModal();
  // In a room the thumbs start off (waiting room): the per-frame update below only runs once the scene is up, and on
  // a slow network the waiting room shows long before that (manifesto-enxuto-3g; lobby-dead-controls).
  if(net)applyControls(shell,controlsFor({phase:net.run?.phase??'lobby'}));
  const abort=new AbortController(),signal=abort.signal;
  // The match's history entry (match-guard.ts); set with the gear's handlers below.
  let releaseBack=()=>{};
  const direction=new JoystickInput();
  const stick=$('.explore-stick'),knob=stick.querySelector('span')!;
  const stage=$('.explore-stage'),notice=$('.explore-notice');
  let controller:ReturnType<typeof import('./scene.ts').createIsland>|undefined;
  /** Scene-clock time of each hero's last "Dançar" (it dances from it until it moves: sprites/hero-dance.ts cheer). */
  const dancedAt=new Map<string,number>();
  const dance=()=>{pause(false);if(!net||!controller||!sceneReady)return;dancedAt.set(net.id,controller.scene.time.now);net.dance();};
  let closed=false,paused=false;
  /** When the per-frame shell attributes were last written (SHELL_DATA_MS). */
  let shellDataAt=-Infinity;
  /** The party line's last text (coop): its tags are rebuilt only when it changes. */
  let partyKey='';
  /** The open forge or Dona Cida tray (the camera frames the hero beside it) and its box, read after the paint. */
  let trayEl:HTMLElement|null=null;
  const trayBox=new LayoutCache(()=>{const el=trayEl,r=el?.getBoundingClientRect();return {el,rect:r&&{x:r.left,y:r.top,width:r.width,height:r.height}};},250);
  /** The economy toast's own clock (VGM-048), cleared on close. */
  let economyTimer:ReturnType<typeof setTimeout>|undefined;
  const visited=new Set<number>();
  /** The map line of the settings panel (one line, rewritten when the room switches maps): mapInfoText. */
  let mapInfo:HTMLElement|undefined,mapInfoSeed=0,mapInfoMap:CoopClient['map']|undefined,mapInfoTerrain:CoopClient['terrain']|undefined;
  const showMapInfo=()=>{
    if(!mapInfo)return;
    mapInfoMap=net?.map;mapInfoTerrain=net?.terrain;
    const text=mapInfoText(net?net.terrain.seed:mapInfoSeed,!!net?.terrain.chunks,net?.map);
    if(mapInfo.textContent!==text)mapInfo.textContent=text;
  };
  /** Result screen data from the last view: the room sends outcome and duration, the HUD view has round, players and build. */
  const runResult=(victory:boolean,durationTicks:number):MapRunResult=>{
    const view:RunView|undefined=hud?.view;
    return {victory,durationTicks,round:Math.max(1,view?.round?.index??1),totalRounds:view?.round?.total||TOTAL_ROUNDS,seed:String(net?.terrain.seed??''),
      // Server counters when the room sends them (award-stats-server); the local damage sum is the old fallback.
      players:(view?.players??[]).map(p=>({...p,stats:p.stats?.downs!==undefined?{...p.stats}:{damage:damage.of(p.id),kills:0,revives:0,pickups:0}})),
      ...(!victory&&view?.camp?.wallDown?{wall:true}:{}),
      // In the city the stats line says "Cidade Nevada", not "seed 0" (cidade-10).
      ...(net?.map.id==='cidade-nevada'?{map:net.map.id}:{}),
      // The run's most embarrassing moment comes with the result state (VGM-053B).
      ...(net?.run?.shame?{shame:{...net.run.shame}}:{}),
      // The chaveiro's bill (D-047): why it ended, the budget, the Grana, the debt; only when the room sends it.
      ...(net?.run?.objective?{objective:{...net.run.objective}}:{})};
  };
  const reset=()=>{const pointer=direction.pointer;direction.reset();knob.style.transform='';stick.classList.remove('is-dragging');if(pointer!==undefined&&stick.hasPointerCapture(pointer))stick.releasePointerCapture(pointer);};
  // partida-que-nao-abre-tem-saida: a boot that throws or a cover that never falls gets the window with its ways out
  // (match-boot.ts); a second way out is a second button of the same look.
  let bootShown:BootFailure|undefined;
  const bootFatal=(failure:BootFailure)=>{
    const exit=(kind:BootExit)=>kind==='retry'?{label:BOOT_TEXT.retry,run:()=>location.reload()}:{label:BOOT_TEXT.home,run:close};
    const panel=showFatal(find('.explore-layout'),failure.text,{action:exit(failure.exits[0])});
    panel.querySelector('.net-fatal-exit')?.remove();
    const second=failure.exits[1];
    if(second){const {label,run}=exit(second),button=document.createElement('button');button.type='button';button.className='net-fatal-reload net-fatal-exit';button.textContent=label;button.addEventListener('click',run);panel.append(button);}
    shell.dataset.fatal='true';bootShown=failure;
  };
  const hideBoot=()=>{hideFatal(find('.explore-layout'));delete shell.dataset.fatal;bootShown=undefined;};
  const coverSlow=setTimeout(()=>{if(!closed&&!sceneReady&&!shell.dataset.fatal)bootFatal(SLOW_COVER);},COVER_SLOW_MS);
  const close=()=>{
    if(closed)return;closed=true;active=false;clearTimeout(coverSlow);abort.abort();releaseBack();gearTagSeen();reset();if(economyTimer)clearTimeout(economyTimer);
    if(updateSlot)setMatchSlot(undefined);
    ux?.destroy();attackBtn?.destroy();net?.leave();rescue?.destroy();spect?.destroy();obra?.destroy();fort?.destroy();tralhaHud?.destroy();kitGesture?.destroy();emotes?.destroy();hud?.destroy();controller?.game.destroy(true);settings.close();shell.close();shell.remove();returnFocus?.focus();
    // Out of the island or the room: a version update that waited for the end of the match reloads now.
    matchEnded();
    // Back on the creation screens: the menu music returns.
    setMusicScene('menu');
  };
  const pause=(value:boolean)=>{paused=value;if(value){reset();attackBtn?.clear();}controller?.scene.setPaused(value);stage.classList.toggle('explore-paused',value);$('.explore-pause').textContent=value?'Continuar':net?'Pausar controles':'Pausar';$('.explore-pause').setAttribute('aria-pressed',String(value));};
  const openSettings=()=>{pause(true);if(net)syncRoomLine(net);shell.classList.add('settings-open');menu?.show('menu');settings.showModal();(menu?menuFocus(menu):$('.explore-settings-close')).focus();};
  const closeSettings=()=>{settings.close();shell.classList.remove('settings-open');pause(false);$('.explore-canvas').focus();};
  shell.dataset.cameraView='0';
  // The view turns only outside a wave (UX-camera-segue 4): the buttons go grey during it and come back in the intermission.
  // Locked is not disabled: the button still answers a tap with the lock's stamp beat and "Gira fora da briga" (UX onda 4 D3).
  let sceneReady=false,hintTimer:ReturnType<typeof setTimeout>|undefined;
  if(options.solo)shell.dataset.solo='';
  const syncCover=()=>{const cover=$('.explore-loading'),up=coverUp(sceneReady,net?.run?.phase,!!options.solo);if(cover.hidden===up)cover.hidden=!up;};
  const cameraGroup=$('.explore-camera'),lock=$('.explore-lock'),hint=$('.explore-camera-hint');
  // "Versão nova do jogo" during a round (NEW-20261012-E5-chunk-velho-deploy): a row of the HUD's announcement slot,
  // only while the round is on screen; before that (loading, countdown) it floats at the top (update-toast.ts).
  if(net&&hud){
    const runHud=hud;
    updateSlot={take:el=>{if(!sceneReady||closed||net.fatal||net.run?.phase!=='combat')return false;runHud.queueRow(el,UPDATE_ROW_MS);return true;},drop:el=>runHud.dropRow(el)};
    setMatchSlot(updateSlot);
    // The room restarted and the run came back (E5-checkpoint-por-round): the news once, a row of the same slot. It waits
    // in line while the HUD is still hidden (the scene loading), so news that came with the welcome shows with the round.
    const resumedRow=document.createElement('div');resumedRow.className='economy-toast resumed-toast';resumedRow.setAttribute('role','status');resumedRow.hidden=true;
    resumedRow.innerHTML='<p class="economy-toast-text"><strong></strong><span></span></p>';
    const showResumed=resumedOnce(news=>{resumedRow.querySelector('strong')!.textContent=news.title;resumedRow.querySelector('span')!.textContent=news.body;runHud.queueRow(resumedRow,RESUMED_ROW_MS);});
    // The run came back from an older moment: the skill button's last answer (from before the crash) no longer holds.
    net.onResumed=news=>{skill?.reset();showResumed(news);};if(net.resumedNotice)skill?.reset();showResumed(net.resumedNotice);
  }
  const syncTurn=()=>{
    const locked=!!controller?.scene.rotationLocked();putData(shell,'cameraLocked',String(locked));
    if(cameraGroup.dataset.locked!==String(locked))cameraGroup.dataset.locked=String(locked);
    for(const button of shell.querySelectorAll<HTMLButtonElement>('[data-turn]')){
      if(button.disabled!==!sceneReady)button.disabled=!sceneReady;
      if(button.getAttribute('aria-disabled')!==String(locked))button.setAttribute('aria-disabled',String(locked));
    }
    if(!locked&&!hint.hidden){hint.hidden=true;if(hintTimer)clearTimeout(hintTimer);}
    // The settings' row (phone): dimmed with the lock's words while a wave holds the view.
    if(cameraSettings.dataset.locked!==String(locked)){cameraSettings.dataset.locked=String(locked);cameraNote.hidden=!locked;}
  };
  // Portrait (pacote-bugs-ux design review): the top band has no free row under the camera buttons (the XP bar is 20 px
  // below), so the answer is a row of the announcement slot, "[cadeado] Gira fora da briga", ahead of the coach's hint;
  // the real lock keeps its beat in view. Landscape keeps the balloon under the buttons (nothing there to cover).
  /** The "Voltou!" row once the link is back after a drop (hud/menu.ts backOnline). */
  const backOnline=new BackOnlineWatch(),backRow=document.createElement('div');backRow.className='economy-toast back-online-toast';backRow.setAttribute('role','status');backRow.hidden=true;
  backRow.innerHTML='<p class="economy-toast-text"><strong></strong></p>';
  const cameraRow=document.createElement('div');cameraRow.className='explore-camera-row';cameraRow.setAttribute('role','status');cameraRow.hidden=true;
  cameraRow.innerHTML=`${icon('cadeado',{size:24})}<span>Gira fora da briga</span>`;
  const portrait=typeof matchMedia==='function'?matchMedia('(min-height:501px)'):undefined;
  const lockedTap=()=>{
    lock.classList.remove('is-beat');void lock.offsetWidth;lock.classList.add('is-beat');
    if(hud&&portrait?.matches){hud.queueRow(cameraRow,CAMERA_HINT_MS,{answer:true});return;}
    hint.hidden=false;if(hintTimer)clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hint.hidden=true;},CAMERA_HINT_MS);
  };
  for(const button of shell.querySelectorAll<HTMLButtonElement>('[data-turn]'))button.addEventListener('click',()=>{
    // The settings' copy (phone): the game stays paused under the open settings and the focus stays in them.
    const inSettings=!!button.closest('.explore-settings');
    if(controller?.scene.rotationLocked()){if(inSettings){cameraNote.classList.remove('is-beat');void cameraNote.offsetWidth;cameraNote.classList.add('is-beat');}else lockedTap();return;}
    if(!controller)return;reset();if(!inSettings)pause(false);
    const view=controller.scene.rotateCamera(Number(button.dataset.turn));
    shell.dataset.cameraView=String(view);
    // The compass needle turns with the view (the "1 / 4" left, DSG-icones-sistema); the text stays for screen readers.
    for(const spot of shell.querySelectorAll('.explore-view')){spot.querySelector('.ic-bussola')!.outerHTML=compass(view,{size:32});spot.querySelector('.sr-only')!.textContent=`Vista ${view+1} de 4`;}
    if(!inSettings)$('.explore-canvas').focus();
  },{signal});
  $('.explore-config').addEventListener('click',openSettings,{signal});
  $('.explore-settings-close').addEventListener('click',closeSettings,{signal});
  // Esc: from the menu's settings or its exit question back to the menu, from the menu (or solo's settings) to the game.
  const settingsBack=()=>{const back=menu&&menuBack(menu.view);if(back)menu!.show(back);else closeSettings();};
  settings.addEventListener('cancel',e=>{e.preventDefault();e.stopPropagation();settingsBack();},{signal});
  $('.explore-exit').addEventListener('click',close,{signal});
  shell.addEventListener('cancel',e=>{e.preventDefault();openSettings();},{signal});
  // Back guard (celular-voltar-e-pinca A): the iPhone's edge swipe, the browser's back or an Android Back that Chrome no
  // longer lets `cancel` stop (no tap since the last one) opens the gear or steps back in it; leaving stays "Sair".
  releaseBack=guardBack(history,window,()=>{if(settings.open)settingsBack();else openSettings();},signal);
  // That uncancelable Back closes a dialog by itself: the match comes back with the gear open, the gear goes as "Voltar".
  shell.addEventListener('close',()=>{if(closed)return;shell.showModal();openSettings();},{signal});
  settings.addEventListener('close',()=>{if(!closed&&shell.classList.contains('settings-open'))closeSettings();},{signal});
  // No long-press menu in the match (C; explore.css .explore-shell touch-action:none keeps the page from pinch zoom).
  shell.addEventListener('contextmenu',e=>e.preventDefault(),{signal});
  // Desktop controls (NEW-20261013-ORQ-controles-desktop, D-044): data-input="mouse" hides the joystick in every phase
  // (explore.css) and the walk words speak of keys and clicks; a finger on the screen brings the phone's controls back.
  const inputWatch=new InputKindWatch(finePointer());
  // The computer's camera is fixed (zoom-fixo-pc): no wheel zoom, and the page's zoom (Ctrl+wheel, a trackpad pinch,
  // Ctrl +/−/0) is cancelled while the game is open. The phone keeps its pinch.
  const desktopZoom=finePointer();
  if(desktopZoom){
    const block=(e:Event)=>{if(pageZoomEvent(e as KeyboardEvent))e.preventDefault();};
    globalThis.addEventListener?.('wheel',block,{signal,passive:false,capture:true});
    globalThis.addEventListener?.('keydown',block,{signal,capture:true});
  }
  const syncInput=()=>{
    const kind=inputWatch.kind,other=kind==='mouse'?'touch':'mouse';
    if(shell.dataset.input===kind)return;
    shell.dataset.input=kind;reset();
    // The notice keeps any later line ("Seguindo a trilha…"); only the other kind's opening words are swapped.
    const manual=net?.combat==='manual',texts=INPUT_TEXTS[kind],notice=net?coopNotice(kind,manual):texts.soloNotice,stale=net?coopNotice(other,manual):INPUT_TEXTS[other].soloNotice;
    const noticeEl=$('.explore-notice');if(noticeEl.textContent===stale)noticeEl.textContent=notice;
    const help=shell.querySelector('.explore-help-walk');if(help)help.textContent=texts.soloHelp;
    // The waiting room's etiqueta (the phase alone decides off/live; the round's flags are rewritten on the next frame).
    if(net)applyControls(shell,controlsFor({phase:net.run?.phase??'lobby'}));
    // The desktop has no stick to bring the controls back: a pause left by the phone's blur ends here (not the settings').
    if(kind==='mouse'&&paused&&!settings.open)pause(false);
    // The joystick came or went: the HUD measures its zones again (useful area, thumbs). The phone's minimal HUD
    // (hud-mobile-minimo) follows the same kind: a finger lays the phone's out, the mouse the desktop's.
    hud?.setInput(kind);hud?.layoutChanged();
  };
  syncInput();
  document.addEventListener('pointerdown',event=>{if(inputWatch.pointer(event.pointerType,true))syncInput();},{capture:true,signal});
  document.addEventListener('pointermove',event=>{if(inputWatch.pointer(event.pointerType,false))syncInput();},{capture:true,signal});
  // Focus lost: the phone pauses as before; the desktop never pauses, it lets go of every held key, the stick and the held
  // mouse button (no key stays stuck) and plays on when the focus comes back.
  const lost=()=>focusLost(inputWatch.kind,{pause:()=>pause(true),release:()=>{reset();controller?.scene.releaseInput();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lost();},{signal});
  // Back from the background: a drop ending soon after counts for the "Voltou!" row (hud/menu.ts BackOnlineWatch).
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)backOnline.wake(performance.now());},{signal});
  window.addEventListener('blur',lost,{signal});
  // D-051: a held attack (button or Space) never stays held without the focus, phone or desktop.
  document.addEventListener('visibilitychange',()=>{if(document.hidden)attackBtn?.clear();},{signal});
  window.addEventListener('blur',()=>attackBtn?.clear(),{signal});
  // Desktop hotkeys: Q/E press the camera buttons (their lock answer included), Space the skill (never the page scroll),
  // T opens or closes the emote bar while it is on screen (a room always mounts it; solo has no room to send a laugh to,
  // so T does nothing there). Movement keys are Phaser's (scene.ts), read every frame like the stick.
  document.addEventListener('keydown',event=>{
    if(closed)return;
    if(inputWatch.key(event.code,event.key))syncInput();
    const hotkey=hotkeyOf(event,settings.open);
    if(!hotkey)return;
    if(hotkey.kind==='skill')event.preventDefault();
    if(event.repeat)return;
    if(hotkey.kind==='turn'){shell.querySelector<HTMLButtonElement>(`[data-turn="${hotkey.turn}"]:not(:disabled)`)?.click();return;}
    if(hotkey.kind==='skill'){
      // D-051: Space held is the attack (keyup lets go); otherwise one press casts the skill. A kit selected: Construir.
      if(skill?.working){if(!$<HTMLButtonElement>('#coop-attack').disabled)workLatch.tap(performance.now());return;}
      if(skill?.towing){if(!$<HTMLButtonElement>('#coop-attack').disabled)towTap();return;}
      if(skill?.dancing){if(!$<HTMLButtonElement>('#coop-attack').disabled)dance();return;}
      if(attackBtn?.active){if(!$<HTMLButtonElement>('#coop-attack').disabled)attackBtn.key(true,'espaco');return;}
      if(castSkill&&!$<HTMLButtonElement>('#coop-attack').disabled)castSkill();return;
    }
    if(emotes&&!emotes.root.hidden)emotes.setOpen(!emotes.open);
  },{signal});
  // Trabalhar and Rebocar on the attack button (before AttackButton's own listeners see the press). With a kit selected
  // (barricada-tocar-no-mapa) Esc lets it go and R turns the barricade.
  if(net){
    const onBuild=(e:Event)=>{
      const button=(e.target as Element|null)?.closest?.('#coop-attack') as HTMLButtonElement|null;
      const work=!!skill?.working,tow=!!skill?.towing;
      if(!(work||tow)||!button||button.disabled)return;
      if(e.type==='pointerdown'&&(e as PointerEvent).button!==0)return;
      if(e.type==='click'&&(e as MouseEvent).detail!==0){e.stopImmediatePropagation();return;}
      e.stopImmediatePropagation();e.preventDefault();pause(false);
      if(work)workLatch.tap(performance.now());else towTap();
    };
    window.addEventListener('pointerdown',onBuild,{capture:true,signal});
    window.addEventListener('click',onBuild,{capture:true,signal});
    // exploracao-espera-carregar-e-sem-arma: with empty hands the button dances at once (Dançar), no swing.
    const onDance=(e:Event)=>{
      const button=(e.target as Element|null)?.closest?.('#coop-attack') as HTMLButtonElement|null;
      if(!skill?.dancing||skill.working||skill.towing||!button||button.disabled)return;
      if(e.type==='pointerdown'&&(e as PointerEvent).button!==0)return;
      if(e.type==='click'&&(e as MouseEvent).detail!==0){e.stopImmediatePropagation();return;}
      e.stopImmediatePropagation();e.preventDefault();dance();
    };
    window.addEventListener('pointerdown',onDance,{capture:true,signal});
    window.addEventListener('click',onDance,{capture:true,signal});
    document.addEventListener('keydown',e=>{
      if(closed||!kitPlace.active||settings.open)return;
      if(e.key==='Escape'){e.preventDefault();kitPlace.cancel();}
      // barricada-tocar-no-mapa: R turns the barricade (the drag does it on the phone).
      else if((e.key==='r'||e.key==='R')&&!e.repeat&&!(e.target instanceof HTMLInputElement)){e.preventDefault();kitPlace.turn(buildPlanFor(net.terrain).cell);refreshKitGhost();}
    },{signal});
  }
  // A focused button is pressed by Space on its keyup: never, when Space is the skill hotkey (Phaser does the same), so a
  // focused skill button casts once (the keydown above), not twice.
  document.addEventListener('keyup',event=>{if(!closed&&hotkeyOf(event,settings.open)?.kind==='skill')event.preventDefault();},{signal});
  // D-051: letting go of Space ends the held attack (any keyup of it, even with the settings open or a modifier down).
  document.addEventListener('keyup',event=>{if(!closed&&event.code==='Space')attackBtn?.key(false,'espaco');},{signal});
  $('.explore-pause').addEventListener('click',closeSettings,{signal});
  // Consent (VGM-053B, D7): whether this player's embarrassing moment may show on the result, for everyone in the room.
  if(net){
    const shame=document.createElement('button');shame.type='button';shame.className='explore-shame';
    const sync=()=>{shame.setAttribute('aria-pressed',String(net.allowsShame));shame.textContent=net.allowsShame?'Meu momento vergonhoso: pode aparecer':'Meu momento vergonhoso: fica de fora';};
    sync();shame.addEventListener('click',()=>{net.setShamePref(!net.allowsShame);sync();},{signal});
    settingsContent.append(shame);
  }
  // Quality levels (Q3, NEW-20261021-E6-q3-niveis-qualidade): Leve / Normal / Alta in the gear, saved on this device. The device
  // picks at first; the FPS watch steps it down once per match when the first 10 s of combat choke. `?qualidade=` (lab) forces one.
  const forced=qualityFromUrl(location.search);
  let quality:QualitySettings=loadQuality(economyStore(),detectQuality(deviceHints(globalThis.navigator as {deviceMemory?:number;hardwareConcurrency?:number}|undefined,finePointer())));
  if(forced)quality={level:forced,chosen:true,auto:false,declined:quality.declined};
  /** The level before the watch's step: the toast's "Desfazer" goes back to it. */
  let stepFrom:QualityLevel|undefined;
  let zoomSave:ReturnType<typeof setTimeout>|undefined;
  const QUALITY_NOTE:Record<QualityLevel,string>={leve:'Cenário parado e menos efeito: o celular agradece, a bateria também.',normal:'O jogo inteiro, sem fritar a mão.',alta:'Tudo no talo. Coisa de PC.'};
  const economyButton=document.createElement('div');economyButton.className='explore-economy explore-quality';economyButton.setAttribute('role','group');economyButton.setAttribute('aria-label','Qualidade');
  economyButton.innerHTML='<span class="explore-economy-head"><span class="explore-economy-title">Qualidade</span><span class="explore-economy-tag"></span></span>'
    +`<span class="explore-quality-levels">${QUALITY_LEVELS.map(l=>`<button type="button" data-level="${l}" aria-pressed="false">${QUALITY_LABEL[l]}</button>`).join('')}</span>`
    +'<span class="explore-economy-note"></span>';
  const economyTag=economyButton.querySelector<HTMLElement>('.explore-economy-tag')!,qualityNote=economyButton.querySelector<HTMLElement>('.explore-economy-note')!;
  const economyToast=document.createElement('div');economyToast.className='economy-toast';economyToast.setAttribute('role','status');economyToast.hidden=true;
  economyToast.innerHTML=`<span class="economy-toast-icon">${icon('suor')}</span><p class="economy-toast-text"><strong>Qualidade baixou pra Leve</strong><span>Tava engasgando</span></p><button type="button" class="economy-toast-off">Desfazer</button>`;
  // Coop: the HUD's announcement slot takes it in line (one row at a time, off the hero). Solo has no HUD and no watch.
  const hideEconomyToast=()=>{if(hud)hud.dropRow(economyToast);else economyToast.hidden=true;if(economyTimer)clearTimeout(economyTimer);economyTimer=undefined;};
  const syncQuality=()=>{
    for(const b of economyButton.querySelectorAll<HTMLButtonElement>('[data-level]'))b.setAttribute('aria-pressed',String(b.dataset.level===quality.level));
    economyTag.textContent=quality.chosen?'Sua escolha':'Automática';economyTag.dataset.on=String(!quality.chosen);
    qualityNote.textContent=QUALITY_NOTE[quality.level];
    shell.dataset.quality=quality.level;shell.dataset.economy=String(qualityProfile(quality.level).economy);
  };
  const setQuality=(next:QualitySettings)=>{quality=next;saveQuality(economyStore(),quality);controller?.scene.setQuality(quality.level);syncQuality();};
  syncQuality();
  economyButton.addEventListener('click',event=>{
    const level=(event.target as HTMLElement).closest<HTMLElement>('[data-level]')?.dataset.level as QualityLevel|undefined;
    if(!level)return;setQuality(chooseQuality(quality,level));hideEconomyToast();
  },{signal});
  economyToast.querySelector('button')!.addEventListener('click',event=>{event.stopPropagation();setQuality(undoQuality(quality,stepFrom??quality.level));hideEconomyToast();},{signal});
  // The toast sits over the map: its taps never reach the game (like the HUD panels).
  for(const type of ['pointerdown','touchstart'])economyToast.addEventListener(type,event=>event.stopPropagation(),{signal});
  // Near the top of the settings (the panel scrolls on a phone): right under the title and the way back.
  settingsContent.insertBefore(economyButton,settingsContent.querySelector('.explore-top')?.nextSibling??settingsContent.firstChild);
  if(!hud)$('.explore-layout').append(economyToast);
  // Sound (config-audio-musica-efeitos): "Música" and "Efeitos" (volume and mute each) and the vibration, under the economy.
  const sound=document.createElement('div');sound.className='explore-sound';
  economyButton.after(sound);
  const unmountSound=mountAudioControls(sound,getAudio());
  signal.addEventListener('abort',unmountSound,{once:true});
  const slow=()=>{
    const next=stepDown(quality);if(!next)return;
    stepFrom=quality.level;setQuality(next);
    economyToast.querySelector('strong')!.textContent=`Qualidade baixou pra ${QUALITY_LABEL[next.level]}`;
    if(hud){hud.queueRow(economyToast,ECONOMY_TOAST_MS);return;}
    economyToast.hidden=false;if(economyTimer)clearTimeout(economyTimer);economyTimer=setTimeout(hideEconomyToast,ECONOMY_TOAST_MS);
  };

  if(!net)$('#explore-trail').addEventListener('click',()=>{closeSettings();const next=landmarks.findIndex((_l,i)=>!visited.has(i));if(next>=0)controller?.scene.goTo(landmarks[next]);else notice.textContent='Ilha explorada! Agora escolha seu cantinho favorito.';},{signal});
  const updateStick=(event:PointerEvent)=>{
    const rect=stick.getBoundingClientRect(),max=rect.width*.27;
    if(!direction.move(event.pointerId,event.clientX-rect.left-rect.width/2,event.clientY-rect.top-rect.height/2,max))return;
    knob.style.transform=`translate(${direction.x*max}px,${direction.y*max}px)`;
    // The finger's first drag with a direction (playtest metrics; a tap on the stick is not a move).
    if(direction.x||direction.y)ux?.stick();
  };
  stick.addEventListener('pointerdown',event=>{
    if(event.button!==0||shell.dataset.controls==='off'||!direction.start(event.pointerId))return;
    event.preventDefault();pause(false);stick.setPointerCapture(event.pointerId);
    stick.classList.add('is-dragging');updateStick(event);
  },{signal});
  stick.addEventListener('pointermove',updateStick,{signal});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(type,event=>{
    if(direction.end((event as PointerEvent).pointerId))reset();
  },{signal});
  try{
    // Imported art v2: the index must be known before Phaser preloads (bounded wait; procedural art if it is late).
    // Awaited here, not at the top: everything above runs synchronously so the caller finds the shell right after the
    // call (lobby.ts mounts the waiting room on .explore-layout; awaiting first left the room without it).
    await artReady();
    if(closed)return;
    const {createIsland}=await import('./scene.ts');
    if(closed)return;
    controller=createIsland($('.explore-canvas'),{
      classId:hero.id,direction:()=>direction,net,cena,
      // D-051 manual combat: the attack rides each input step; a tap or click on a critter chooses it and hits it once.
      attacking:()=>!!attackBtn?.take(),working:dir=>workLatch.step(dir),enemyPicked:()=>attackBtn?.once(),manual:()=>net?.combat==='manual',
      aimStick:()=>attackBtn?.aim(),attackHeld:()=>!!attackBtn?.press.held,aimPick:()=>attackBtn?.autoPick(),danceAt:id=>dancedAt.get(id),
      // The right mouse button holds the attack like Space (direito-ataca-e-cone-no-ar), greyed button included.
      attackHold:down=>{if(down&&skill?.working){if(!$<HTMLButtonElement>('#coop-attack').disabled){pause(false);workLatch.tap(performance.now());}return;}if(down&&skill?.towing){if(!$<HTMLButtonElement>('#coop-attack').disabled)towTap();return;}if(down&&skill?.dancing){if(!$<HTMLButtonElement>('#coop-attack').disabled)dance();return;}if(!down)attackBtn?.key(false,'direito');else if(attackBtn?.active&&!$<HTMLButtonElement>('#coop-attack').disabled)attackBtn.key(true,'direito');},
      terrain:(seed,signature)=>{shell.dataset.terrainSeed=String(seed);shell.dataset.terrainSignature=signature;mapInfo??=settingsContent.appendChild(document.createElement('p'));mapInfoSeed=seed;showMapInfo();},
      visual:(animation,frame,sheets)=>{const canvas=$('.explore-canvas');putData(canvas,'spriteAnimation',animation);putData(canvas,'spriteFrame',frame);putData(canvas,'spriteSheets',String(sheets));},
      position:p=>{
        // The shell's data attributes (tests, scripts, CSS) are written only when they change, and the ones that change
        // every frame (the hero's spot, the tick) at most every SHELL_DATA_MS: each write invalidates the style of the
        // whole shell, and the HUD reads layout right after (BUG-20261014-ORQ-engasgo-andando-celular).
        const now=performance.now(),slow=now-shellDataAt>=SHELL_DATA_MS;
        if(slow){shellDataAt=now;putData(shell,'playerX',p.x.toFixed(3));putData(shell,'playerY',p.y.toFixed(3));}
        if(!net){find('#explore-dot').setAttribute('cx',String(50+(p.x-12)*3.8));find('#explore-dot').setAttribute('cy',String(50+(p.y-12)*3.8));}
        if(net){
          // The room may switch maps in the lobby (the scene swaps the world without calling terrain again).
          if(net.map!==mapInfoMap||net.terrain!==mapInfoTerrain)showMapInfo();
          const self=net.players.get(net.id);putData(shell,'playerId',net.id);putData(shell,'connected',String(net.connected));if(slow&&SHELL_DEBUG)putData(shell,'tick',String(net.tick));putData(shell,'players',String(net.players.size));
          const health=find('#coop-health'),healthText=`Sua vida: ${self?.hp??0}`;if(health.textContent!==healthText)health.textContent=healthText;
          // Long reconnection (UX onda 5): after SLOW_LINK_MS a second line and "Tentar de novo"; the stick dims while offline.
          putData(shell,'offline',String(!net.connected&&!net.fatal));
          showSlowLink(find('.explore-layout'),!net.fatal&&net.offlineMs()>SLOW_LINK_MS,()=>net.retryNow());
          // Kicked (D-025): the room's text and a way back to the start; reloading would knock on the same door.
          if(net.fatal&&fatalShown!==net.fatal){fatalShown=net.fatal;bootShown=undefined;find('.explore-layout').querySelector('.net-fatal-exit')?.remove();
            // Only a new version or another tab keeps the reload: every other refusal forgot the seat (match-boot.ts refusalExit).
            const exit=refusalExit(net.fatal,{kicked:net.kicked,linkLost:net.fatal===LINK_LOST}),home={label:BOOT_TEXT.home,run:close};
            showFatal(find('.explore-layout'),net.fatal,exit==='kicked'?{title:KICKED_TITLE,action:home}:exit==='home'?{action:home}:exit==='room'?{action:{label:BACK_TO_ROOM,run:()=>location.assign(`/?room=${net.code}${inviteQuery(location.search)}#personagem`)}}:{reconnect:()=>net.restart()});shell.dataset.fatal='true';if(net.kicked)shell.dataset.kicked='true';
            // Terminal here (another tab took the character, VGM-047): no stale offer or HUD left tappable behind the window.
            if(hud)hud.el.hidden=true;}
          // "Reconectar" (nao-e-versao-nova): the client is on again, the window and the hidden HUD come back down.
          else if(!net.fatal&&fatalShown){fatalShown=undefined;hideFatal(find('.explore-layout'));delete shell.dataset.fatal;if(hud)hud.el.hidden=false;}
          // D-051: the room's combat (its welcome) picks what the action slot does; the reticle follows the button.
          const manual=net.combat==='manual';
          if(shell.dataset.combat!==net.combat){
            shell.dataset.combat=net.combat;skill?.setCombat(net.combat);attackBtn?.setOn(manual);
            const noticeEl=find('.explore-notice'),kind=inputWatch.kind;if(noticeEl.textContent===coopNotice(kind,!manual))noticeEl.textContent=coopNotice(kind,manual);
          }
          // D-050: the level-up pause zeroes the attack like the rest of the input (a press there is not kept for later).
          if(net.run?.pause)attackBtn?.clear();
          // D-052: pushing or pulling the car the hands are busy (net.handsBusy): the button dims and a held press lets go.
          // torre-limite-rebocar-sem-arma: on the rope the button is Soltar (skill.towing), never dimmed.
          const busy=manual&&net.handsBusy&&!skill?.towing,attackEl=find<HTMLButtonElement>('#coop-attack');
          if(attackEl.classList.contains('explore-attack-ocupado')!==busy){attackEl.classList.toggle('explore-attack-ocupado',busy);if(busy)attackBtn?.clear();}
          attackBtn?.frame();
          const run=net.run,member=run?.members.find(p=>p.id===net.id);
          if(run){
            const previous=shell.dataset.runPhase;
            putData(shell,'runPhase',run.phase);putData(shell,'runRound',String(run.round));
            // The version watch reads the phase from the shell (update-toast.ts inMatchOf): out of countdown/combat, an
            // update that waited reloads now; any other change moves the notice to where it shows (HUD slot or top).
            if(previous!==run.phase){if(leftMatch(previous,run.phase))matchEnded();else if(updateSlot)setMatchSlot(updateSlot);}
            // Menu music (musica-do-menu): the waiting room keeps it; combat and the result hand over to the match's.
            if(previous!==run.phase)setMusicScene(sceneOfPhase(run.phase));
            if(hud){
              // Shown by runView once it holds this run's state; until then the DOM may still show the last run's falls.
              if(run.phase!=='combat'&&run.phase!=='result')hud.el.hidden=true;
              if(run.phase==='result'&&resultShown!==run.round){resultShown=run.round;hud.showResult(runResult(run.outcome==='victory',run.elapsed));}
              else if(run.phase!=='result'&&resultShown!==undefined){resultShown=undefined;hud.hideResult();damage.reset();skill?.reset();}
              putData(shell,'hudResult',String(resultShown!==undefined));
              // After showResult: the coach's end-of-run rule already ran, the metrics read what it learned.
              ux?.tick();
              // Owner, bots and who is still here on the result screen (D-025): crown, robot, "Arrumar turma".
              if(run.phase==='result'){
                const ids=run.members.map(m=>m.id);
                hud.setRoster({owner:run.owner,canManage:net.isOwner,members:ids,bots:run.members.filter(m=>m.bot).map(m=>m.id),seatsLeft:Math.max(0,6-ids.length),
                  extra:[...net.players.values()].filter(p=>ids.includes(p.id)).map(p=>({id:p.id,name:p.name,classId:p.classId,hp:p.hp,maxHp:p.hp,online:p.online,spectator:false,weapons:[],passives:[],
                    ...(run.members.find(m=>m.id===p.id)?.bot?{bot:true}:{})}))});
                // The collective rematch (UX-resultado-revanche): an older room sends no votes and the first tap starts it.
                hud.setRematch(run.rematchVotes&&{votes:run.rematchVotes,voters:run.members.filter(m=>m.online&&!m.bot).map(m=>m.id),
                  ...(run.rematchLeft!==undefined?{leftTicks:run.rematchLeft}:{})});
              }
              hud.setNetwork(net.showReconnecting()?RECONNECTING:undefined);
              // Back after a drop (NEW-20261009-UX-menu-e-conexao): "Voltou! O round tá no 4", a row of the announcement slot.
              const back=backOnline.frame(net.connected,now,run);
              if(back){backRow.querySelector('strong')!.textContent=back;hud.queueRow(backRow,BACK_ONLINE_ROW_MS);}
              hud.avoidHero(controller?.scene.heroScreenRect());
              hud.guardProfiles(controller?.scene.guardScreenRects());
              // Stonewards (VGM-046B): where the hero is (the forge opens in the camp) and the base's bearing on screen (horn arrow).
              const wall=hud.view?.structures.find(s=>s.kind==='muralha'),heroBox=controller?.scene.heroScreenRect();
              let bearing:number|undefined;
              if(wall&&heroBox&&controller){const at=controller.scene.locate(wall).screen;bearing=Math.atan2(at.y-(heroBox.y+heroBox.height*.85),at.x-(heroBox.x+heroBox.width/2))*180/Math.PI;}
              hud.setHero({x:net.predicted.x,y:net.predicted.y,bearing});
              // The obra menu (torres-ligar): the intermission only, and never with the offer window up. The offer keeps
              // priority: the obra window closes and its markers hide until the offer is chosen or put away ('Depois').
              if(obra&&controller){
                const view=hud.view,scene=controller.scene;
                if(run.phase!=='combat')obraRequests.resetRun();
                else if(obraRequests.expire())obraSay(OBRA_NO_ANSWER);
                // D-051 nests: calm around the hero opens it (scene.phase, calm-phase.ts); the rounds keep the intermission.
                // Off the player's game for now (hud/arrows.ts HUD_SWITCH.obra, user 18/10): no menu, no site markers.
                const prepare=HUD_SWITCH.obra&&run.phase==='combat'&&scene.phase==='prepare'&&!!view&&!view.camp?.wallDown&&!net.fatal&&!hud.el.hidden&&!hud.offerShown;
                obraView=obraViewFrom({prepare,view,plan:buildPlanFor(net.terrain),project:p=>scene.locate(p).screen,rail:obraRequests.rail(view?.tick??0),hero:net.predicted,
                  pending:obraRequests.pendingSites(),done:obraRequests.doneSites(),
                  // Watching: the plan shows, the confirm says "Assistindo" (the room would refuse it anyway).
                  readOnly:!!member?.spectator||!!net.players.get(net.id)?.spectator,
                  // The scene's optional towersInWorld() (card NEW-20261013-ORQ-torres-render): false until it draws the towers,
                  // so today the marker is the tower everyone sees.
                  drawnInWorld:towersInWorld(scene)});
                obra.update(obraView);
              }
              // D-052 slice 3: Puxar near the car, Construir with the ghost, the wall counter. Not while picking cards (D-050)
              // nor watching; the room is the judge of every request.
              if(fort&&controller){
                const view=hud.view,scene=controller.scene,car=view&&objectiveOf(view)?.car;
                const available=run.phase==='combat'&&!!car&&!run.pause&&!net.fatal&&!hud.el.hidden&&!hud.offerShown
                  &&!member?.spectator&&!net.players.get(net.id)?.spectator;
                if(run.phase!=='combat')fortBuild.reset();
                else if(!available&&fortBuild.open)fortBuild.toggle(false);
                const structures=view?.structures??[],plan=buildPlanFor(net.terrain);
                fort.update({available,pull:pullState(car,net.id,net.predicted),open:fortBuild.open,piece:fortBuild.piece,rot:fortBuild.rot,
                  walls:fortCounts(structures).walls});
                if(fortBuild.open){
                  const ctx={cell:plan.cell,...(car?{car}:{}),structures};
                  scene.setBuildGhost(fortBuild.ghost(ctx),buildHints(fortBuild.piece,plan.sites,ctx));
                }else if(!kitPlace.active)scene.setBuildGhost(null);
              }
              // Kits de torre: the mode lives while the hero may build (not watching, standing) and the kit is there.
              if(controller){
                const view=hud.view,scene=controller.scene,me=view?.players.find(p=>p.id===net.id);
                const available=run.phase==='combat'&&!net.fatal&&!member?.spectator
                  &&!!me&&!me.spectator&&!me.downed&&!me.eliminated&&me.hp>0;
                // The level-up pause or the offer only hide it: the kit stays selected for after the card (construir-no-botao).
                const shown=kitShown=!run.pause&&!hud.el.hidden&&!hud.offerShown;
                if(run.phase!=='combat')kitPlace.reset();
                else if(!available)kitPlace.cancel();
                kitPlace.sync(me?.weapons);kitArt.sync(scene,me?.weapons); // a tower kit in the backpack fetches its sheets
                // The ghost stands where the map was pressed (or the mouse hovers): its colour follows the room each frame.
                if(kitPlace.active&&shown)refreshKitGhost();
                else if(!fortBuild.open)scene.setBuildGhost(null);
                skill?.setBuild(undefined);
                // Bicos: standing in an open shop's ring (or inside it) the button is Trabalhar.
                const banks=view?.banks,inside=workingIn(banks,net.id),shop=inside??workShop(banks,net.predicted);
                // The level-up pause or the offer only hide it (the shift goes on after the card).
                const offered=available&&!!shop;
                workLatch.view(!!inside,offered,performance.now());
                const face=offered&&shown&&!run.pause&&shop?{bico:shop.bico,inside:!!inside||workLatch.asked}:undefined;
                skill?.setWork(face);
                if(face&&attackBtn?.press.held)attackBtn.clear();
                // torre-limite-rebocar-sem-arma: at the Uno's rope end Atacar turns Rebocar (on the rope: Soltar); Construir
                // and Trabalhar win; an enemy close by keeps Atacar while the hand holds a weapon (towFace).
                const towCar=view&&objectiveOf(view)?.car;
                const tow=available&&shown&&!face?towFace(towCar,net.id,net.predicted,{bot:id=>!!view?.players.find(p=>p.id===id)?.bot,
                  armed:!!me&&!!heldWeapon(me),enemies:net.feed.enemies.values()}):undefined;
                skill?.setTow(tow);
                if(tow&&attackBtn?.press.held)attackBtn.clear();
              }
              // barricada-construir part 2: the tralha's circles over the tapped square, the coleta's bar, the gold outline.
              if(tralhaHud&&controller){
                const view=hud.view,scene=controller.scene,me=view?.players.find(p=>p.id===net.id),structures=view?.structures??[];
                const available=run.phase==='combat'&&!run.pause&&!net.fatal&&!hud.el.hidden&&!hud.offerShown&&!member?.spectator
                  &&!!me&&!me.spectator&&!me.downed&&!me.eliminated&&me.hp>0&&!fortBuild.open&&!kitPlace.active;
                if(!available)tralhaPick.reset();else tralhaPick.sync(structures);
                const sel=tralhaPick.selected===undefined?undefined:structures.find(s=>s.id===tralhaPick.selected),tick=view?.tick??0;
                const progress=tralhaPick.progress(tick);
                tralhaHud.update({available,...(sel?{at:scene.locate(sel).screen}:{}),...(progress!==undefined?{hero:scene.locate(net.predicted).screen,progress}:{})});
                scene.setTralhaOutline(available?tralhaPick.outline(structures,tick):undefined);
              }
              // The useful area goes to the scene for the follow camera (D-019, UX-camera-segue), only when the layout changed.
              const zones=controller?hud.zonesIfChanged():undefined;
              // Out of the round the waiting panel sits in the middle: the hero goes to the free band around it.
              // Landscape: the map selector's small window sits in the side column (cidade-hud.md §7), the band keeps clear of it.
              const wait=run.phase!=='combat'?document.querySelector<HTMLElement>('.coop-wait:not([hidden])')?.getBoundingClientRect():undefined;
              const picker=wait?document.querySelector<HTMLElement>('.coop-wait-map.is-window:not([hidden])')?.getBoundingClientRect():undefined;
              const z=hud.zones(),screen=viewportSize(),thumbs=Math.min(z.leftThumb?.y??screen.height,z.rightThumb?.y??screen.height);
              if(controller)controller.scene.usefulArea=wait&&wait.width>0&&wait.height>0
                ?besideSelector(freeAround({width:screen.width,height:screen.height},{x:wait.left,y:wait.top,width:wait.width,height:wait.height},thumbs),picker&&{x:picker.left,y:picker.top,width:picker.width,height:picker.height})
                :z.useful;
              // An open obra window (intermission), or in portrait the forge or Dona Cida's tray: the camera frames the hero
              // beside it, in the useful area that already leaves the window out, or on a short screen the band from the
              // status rows down to it (framing.ts framesBeside, zones.ts besideArea; BUG-20261013-ORQ-camera-centro-heroi,
              // BUG-20261014-ORQ-forja-cobre-heroi-retrato).
              if(controller){
                const scene=controller.scene,el=trayEl=firstShown(trayLists);
                // Its box is read after the paint (box-cache.ts), not here after the frame's writes (F3); for a frame
                // after it opens there is none yet.
                const box=el?trayBox.get(now,el):undefined,rect=box?.el===el?box.rect:undefined,hero=scene.heroScreenRect();
                scene.besideWindow=besideFrom({viewport:{width:screen.width,height:screen.height},waiting:!!wait,obra:shownHolds(obraList,'rh-obra-janela'),
                  tray:el&&rect?{kind:el.classList.contains('rh-cida')?'cida':'forja',rect}:undefined,hero:hero&&{width:hero.width,height:hero.height}});
                scene.frameArea=rect&&(scene.besideWindow==='forja'||scene.besideWindow==='cida')?besideArea(z,rect):undefined;
              }
              // Out or watching: the camera follows a teammate; the torcida's bar names who (‹ › or a tap on a portrait
              // changes it) and the top banner keeps "Você tá fora. Volta na revanche." (UX-espectador).
              spect?.update({phase:run.phase,eliminated:!!net.feed.players.get(net.id)?.eliminated,spectator:!!member?.spectator,watching:controller?.scene.watching(),ghost:controller?.scene.ghosting()});
              if(zones&&import.meta.env.DEV&&zoneOverlay)void import('./hud/zones-debug.ts').then(debug=>debug.drawZoneOverlay(zones));
            }
            // Out of the run (bled out) or watching: the thumb controls go quiet; the HUD banner says why.
            // Waiting room, countdown and result (BUG-20261006-ORQ-lobby-dead-controls): no thumb controls at all, the room
            // drops their input; an etiqueta in the stick's corner says what they will do (controls-phase.ts).
            const state=net.feed.players.get(net.id);
            const controls=controlsFor({phase:run.phase,spectator:!!member?.spectator,eliminated:!!state?.eliminated,downed:!!state?.downed,offline:!net.connected});
            const out=controls.stick==='dimmed';
            if(shell.dataset.out!==String(out)){shell.dataset.out=String(out);if(out)reset();}
            if(applyControls(shell,controls))reset();
            {const attack=find<HTMLButtonElement>('#coop-attack'),off=controls.skill!=='live';if(attack.disabled!==off)attack.disabled=off;}
            if(controls.skill!=='live')attackBtn?.clear();
          }
          putText(find('#coop-objective'),net.victory?'O mapa é da turma!':self?.hp===0?'Recuperando o fôlego…':'Segurem a muralha');
          // The party's tags are rebuilt only when one of them reads differently (not 60 new spans a second).
          const partyLines=[...net.players.values()].map(player=>`${player.name}: ${player.hp} de vida${player.online?'':', reconectando'}`),party=partyLines.join('|');
          if(party!==partyKey){partyKey=party;find('.coop-party').replaceChildren(...partyLines.map(line=>{const tag=document.createElement('span');tag.textContent=line;return tag;}));}
          syncTurn();
          // The tick moves every frame: the debug line follows at the shell attributes' pace, and only while it is read
          // (its <details> open, or ?perf=1).
          const diagnostics=find('#coop-diagnostics');
          if(slow&&diagnostics&&(SHELL_DEBUG||(diagnostics.parentElement as HTMLDetailsElement|null)?.open))putText(diagnostics,`${[...net.players.values()].filter(p=>p.online).length} de 6 na sala. A sala responde em ${net.rtt} ms.`);
        }
      },
      discovered:i=>{visited.add(i);$('#explore-progress').textContent=`${visited.size} de 3 lugares descobertos`;notice.textContent=`${landmarks[i].name}: ${landmarks[i].detail}`;if(visited.size===3)$('#explore-trail').innerHTML=`Ilha explorada ${icon('pronto')}`;},
      runView:view=>{
        damage.add(view,id=>net!.players.has(id));
        if(net)attackBtn?.lastHit.note(view.events,net.id,view.tick,id=>net.feed.enemies.has(id));
        skill?.update(view.players.find(p=>p.id===net?.id),view.tick,performance.now());
        const phase=net?.run?.phase;
        if(net)syncCena(net.run);
        // The bar steps out while an offer, forge or obra window is open (review: its toggle sat on the window's corner).
        if(emotes){const off=phase!=='combat'||!!net?.fatal||!!net?.players.get(net.id)?.spectator||!!shell.querySelector(OPEN_WINDOWS);
          if(emotes.root.hidden!==off){emotes.root.hidden=off;if(off)emotes.setOpen(false);hud?.layoutChanged();}}
        if(hud&&(phase==='combat'||phase==='result')&&!net?.fatal){hud.setMinerva(phase==='combat'&&net?.run?minervaOf(net.run):undefined);hud.setExplora(phase==='combat'&&net?.run?exploraOf(net.run):undefined);hud.setPause(phase==='combat'?net?.run?.pause:undefined);hud.update(phase==='result'?{...view,offers:[]}:view);putHidden(hud.el,false);}
        if(phase==='combat')rescue?.view(view);
        // Every phase: the metrics keep the last event id across runs (D-011), and count only combat.
        ux?.view(view,net?{x:net.predicted.x,y:net.predicted.y}:undefined,phase==='combat');
        putData(shell,'offers',String(view.offers.length));
        // The enemy count changes all wave long: on the shell's root only for ?perf=1 (no test or script reads it).
        if(SHELL_DEBUG)putData(shell,'enemies',String(view.enemies.length));
      },
      // The kill-cam picture of the HUD (VGM-053B): the scene draws its second camera there.
      killcamRect:()=>hud?.killcamRect(),
      // Fear (card fear-escuridao-sozinho): the notice, the dimmed portraits and the sound of the dark.
      fear:(frame,far)=>hud?.setFear(frame,far),
      quality:quality.level,slow,
      // The player's zoom (camera-zoom-out-e-roda): saved per browser, once the wheel or the pinch rests.
      zoom:startZoom(desktopZoom,economyStore()),zoomLocked:desktopZoom,zoomChanged:k=>{clearTimeout(zoomSave);zoomSave=setTimeout(()=>saveZoom(economyStore(),k),400);},
      ready:()=>{sceneReady=true;clearTimeout(coverSlow);if(bootShown===SLOW_COVER)hideBoot();if(skill)skill.visible=true;ux?.ready();syncTurn();
        // Solo: the cover's line gives way to the room's ("Chamando os bots…", then the 3-2-1) until the match.
        if(options.solo)$('.explore-loading').textContent='';
        syncCover();$('.explore-canvas').focus();if(updateSlot)setMatchSlot(updateSlot);},
      message:text=>{notice.textContent=text;},
    });
    if(paused)controller.scene.setPaused(true);
    // The phone dropped the WebGL context (gl-lost.ts): a plain panel and a way back instead of a black screen; a room's own window wins, a restore takes ours down.
    watchGlLoss(controller.game.canvas,{lost:()=>{if(closed||fatalShown)return;const to=glLostTarget(options.solo?undefined:net?.code,inviteQuery(location.search));showFatal(find('.explore-layout'),GL_LOST_TEXT,{action:{label:GL_LOST_BUTTON,run:()=>to?location.assign(to):location.reload()}});shell.dataset.fatal='true';if(hud)hud.el.hidden=true;},
      restored:()=>{if(closed||fatalShown||find('.explore-layout').querySelector(':scope > .net-fatal .net-fatal-text')?.textContent!==GL_LOST_TEXT)return;hideFatal(find('.explore-layout'));delete shell.dataset.fatal;if(hud)hud.el.hidden=false;}});
  }catch(e){if(!closed){clearTimeout(coverSlow);if(chunkFailed(e))$('.explore-loading').textContent='Saiu versão nova do jogo.';else bootFatal(bootFailure(webglWorks()));}}
}
