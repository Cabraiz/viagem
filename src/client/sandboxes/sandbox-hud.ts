/**
 * HUD sandbox (VGM-040): `?sandbox=hud&players=1..6&state=wave|prepare|offer|offer-open|offer-prepare|offer-round|offer-heal|downed|boss|result[&lose=1][&full=1][&frozen=1][&phaser=1][&zueira=boletos|promo|apagao|killcam]`.
 * `full=1` gives every player a 12-item build (layout stress test).
 * Renders the run HUD over a mock island with the real control positions (camera, gear, joystick, attack)
 * so overlaps are visible. Fake data only; nothing talks to the server.
 * `phaser=1` mounts a real Phaser game under the HUD whose scene walks the hero to every tap, exactly like
 * the island scene (`input.on('pointerdown')` → goTo).
 * `cenario=bordas[&vista=0..3][&mapa=infinito]` (UX-bordas-fora-da-tela): edge arrows and the WC3 minimap over the mock, with 5 allies, 2 caídos
 * (one pinging "Me salva"), the boss with a telegraph about to go off and a spawn warning, all off screen; the world
 * points are projected with the real camera math (projection.ts, framing.ts) in the chosen view. It proves taps on HUD panels never reach Phaser,
 * including its window-level touch listener. State: `window.__hero` ({x,y,taps}).
 * `mapa=cidade[&vista=0..3]` (card cidade-04, design/cidade-hud.md §7): the city HUD over a snow mock,
 * with the real Cidade Nevada (public/maps/cidade-nevada.json, checked against its manifest hash and decoded by
 * cityTerrainFrom): the WC3 minimap of the whole city in the `.rh-minimap` slot and the city's arrows: two groups of
 * critters off screen (count in the body, distance on the tag), the active mouth of the east avenue, the base with the
 * horn's seconds (state=camp-horn, the default here) and a caído pinging "Me salva" (the ally on its feet shows on the
 * minimap only). `body[data-cidade]` is '1' once drawn ('erro' if the city did not load).
 * `mapa=cidade&state=tutorial[&ponto=inicio|travado|patio|meio|praca|X,Y][&vista=0..3][&dica=walk]` (card cidade-08):
 * round 1 of the city, the walk to the plaza. The hero stands at `ponto` (default inicio, the wreck; travado: where a
 * straight walk to the plaza parks against a block, ≈(103,154); patio: the dead-end yard inside that block ≈(104.5,149.5);
 * meio: halfway up the route; praca: in the plaza, where the row hides), three teammates at the wreck and round 1's first
 * bêbados on the road. The announcement slot shows "Vai pra praça!" with the walking distance and the arrow along the
 * route in that view; `dica=walk` is a phone that never walked (the joystick is lit for 6 s; no written walk line).
 * The city's first view brings round 1's banner ("Pouso Forçado", as the director sends it): a phone that already walked
 * sees the banner for its 1.8 s and then the row; with `dica=walk` the row takes the banner's slot at once (UX-1) and the
 * mock joystick (`.hs-stick`) wears the coach's Amarelo like the game's `.explore-stick`.
 * `mapa=cidade&chaveiro=1[&moto=anda|morta|…][&rota=N|S|L|O]` (D-047, card chaveiro-render): the chaveiro objective
 * (sandbox-chaveiro.ts, frozen 12 s into its loop): the moto's edge arrow (Cone while dead or fallen), and on the minimap
 * the car in place of the base (its ring: hits left), the moto, the next delivery and the route still ahead.
 * D-047 HUD (card chaveiro-hud): with `chaveiro=1` the run carries the objective (RunView.objective): the round chip says
 * "Onda N" with his clock, the base ficha shows the car's hits left, and a stopped `moto=` shows its reason row for 2.5 s at
 * load. `grana=N` (default 40) and `estoque=a,b,c` (default 4,4,4) feed Dona Cida; `cida=1` puts the hero by the moto (her
 * button shows), `cida=aberta` also opens her tray. Purchases answer after 150 ms like a room (ok, or the refusal the
 * numbers give). `state=result&conta=aberto|carro|time|tempo[&divida=1]`: the result with the chaveiro's bill.
 * `bancos=1` with `mapa=cidade` (card bancos-e-veiculos): three ATMs (RunView.banks), all off screen: Juros & Juros robbed
 * by a critter (its Cone arrow and the row "Bicho sacando no Juros & Juros!"), Pão-Duro full, Caixa do Posto empty.
 * `mapa=cidade&ninhos=1|nevoa[&seed=N][&dormindo=1]` (D-051, mapa-vivo-ninhos): the seed's nests on the minimap (all, or
 * the fog's 3 nearest), optionally with every sleeper as an enemy mark.
 * `body[data-objetivo]` is '1' while the row shows, '0' when it is hidden; `window.__cityObjective` has its numbers.
 * `dica=walk|xp|chip|rescue|gather` (VGM-056): the first-run coach shows that hint (a fresh memory with the others
 * learned); without it every hint counts as learned, so the other scenes stay as they were (walk turns the scene into
 * round 1 and has no row: only the joystick lights, for 6 s or until a step). walk/xp/rescue go with
 * state=wave (xp adds drops, rescue downs Zé do Pix), chip with state=offer, gather with state=prepare.
 * `bicho=bebado|anao-molotov|pombos|tio-pave|agiota|chefe|coach|motoboy|influencer` (arte v2): with state=downed the local fall names that critter
 * (the banner's cause line), with state=result every fall does ("Te derrubou"); its icon is the imported `ui/inimigo-<id>`
 * (art/hud-art.ts), else the still frame of its own enemy sheet (a roster id too, e.g. `bicho=rato-de-boteco`), cropped
 * here once the sheet loads. Without any art the line is text only here (the game then shows the enemy's sprite).
 * With `zueira=killcam` the kill-cam's critter is `bicho` (default tio-pave): its portrait in the frame, or, without art
 * (e.g. `bicho=sem-arte`), no frame at all (the caption takes the width).
 * `pausa=escolhendo|esperando|ultimo` (D-050, card NEW-20261014-E4-levelup-pausa-hud): the team's level-up pause, 4 players
 * unless `players=`, the room's fake pause (contract RunPause) sent like the room's, at each whole second:
 * escolhendo: the pause's offer window open by itself (offer.ts data-mode=pause, no clock of its own), 10 s of 12, Zé
 * already picked, you, Tia and Bruninha thinking; esperando: you picked (your offer closed), 7 s, Tia and Bruninha
 * missing; ultimo: 3 s (urgent), only you missing ("Falta você!"). With `frozen=1` the pause's clock stands still (RunHudOptions.pauseClock); without it the
 * seconds count down and start over.
 * The minimap's slot is mounted (empty), as in the game, so the title is laid out clear of it.
 */
import {shownTargets} from '../hud/arrows.ts';
import type {EdgeKind} from '../hud/edges.ts';
import type {InventoryCommand} from '../hud/inventory.ts';
import {FIXTURE_HERO,HUD_SCENARIOS,fakeResult,fakeResultEvents,fakeView,type HudScenario} from '../hud/fixtures.ts';
import {chaveiroExtras} from '../hud/chaveiro-extras.ts';
import {bankExtras} from '../hud/bancos.ts';
import {RunHud} from '../hud/hud.ts';
import {SIM_HZ,type BankView,type RunView} from '../../contract/index.ts';
import {LESSON_ORDER,COACH_KEY,type Lesson} from '../hud/coach.ts';
import {BOSS_ROUND_NAMES,CIDADE_TUTORIAL,MODIFIERS,ROUND_NAMES,modifierLabel} from '../../rules/index.ts';
import {uxMetricsEnabled} from '../dev/ux-flag.ts';
import {icon} from '../ui/icon.ts';
import {critterIconSource,critterSheetFrame} from '../art/hud-art.ts';
import {artReady} from '../ui/art-boot.ts';

/** Longest real copy, so the marquee is tested with the worst case the director can draw. */
const longest=(list:readonly string[])=>list.reduce((a,b)=>b.length>a.length?b:a,'');
const ROUND_NAME=longest(ROUND_NAMES),BOSS_NAME=longest(BOSS_ROUND_NAMES),MODIFIER=longest(MODIFIERS.map(modifierLabel));

const params=new URLSearchParams(location.search);
/** `texto=125`: the 125% text scale (UX-acessibilidade, <html data-texto>), as the settings set it (modo foto: --extra texto=125). */
if(params.get('texto')==='125')document.documentElement.dataset.texto='125';
const PAUSAS=['escolhendo','esperando','ultimo'] as const;
const pausa=(PAUSAS as readonly string[]).includes(params.get('pausa')??'')?params.get('pausa') as typeof PAUSAS[number]:undefined;
const players=Math.max(1,Math.min(6,Number(params.get('players'))||(pausa?4:1)));
// The pause's base scene: the combat offer open (escolhendo, ultimo), or a wave with nothing to pick (esperando).
const requested=(params.get('state')??(pausa?(pausa==='esperando'?'wave':'offer-open'):null)) as HudScenario|null;
const cidade=params.get('mapa')==='cidade';
/** Round 1 of the city (card cidade-08): a wave scene with no banner, trimmed to round 1 in the city block below. */
const tutorial=cidade&&(requested as string|null)==='tutorial';
let scenario:HudScenario=requested&&HUD_SCENARIOS.includes(requested)?requested:tutorial?'wave':cidade?'camp-horn':'wave';
const frozen=params.has('frozen');
const bordas=params.get('cenario')==='bordas';
const dica=(LESSON_ORDER as readonly string[]).includes(params.get('dica')??'')?params.get('dica') as Lesson:undefined;
const bicho=params.get('bicho')||undefined;
/** The coach's memory for this page: everything learned but the requested hint. */
const coachStore=new Map([[COACH_KEY,JSON.stringify(LESSON_ORDER.filter(l=>l!==dica))]]);

const style=document.createElement('style');
style.textContent=`
html,body{margin:0;height:100%;overflow:hidden;background:#8dcecc}
body>:not(.hs-world):not(.rh):not(.hs-bar):not(.hs-phaser):not(.hs-hero){display:none!important}
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
body:has(.rh[data-hud=fone]) .hs-cam{display:none} /* the phone's camera buttons live in the settings (fone.css) */
body:has(.rh-result:not([hidden])) .hs-hero{display:none} /* the game's hero is under the HUD (Phaser), not over the result */
.hs-cidade .hs-world{background:repeating-linear-gradient(135deg,#eef3f6 0 22px,#e3eaef 22px 44px)}.hs-cidade .hs-world::after{display:none}
/* The game's coach style for the joystick (explore.css .explore-stick under data-coach-stick): edge and knob in Amarelo. */
body:has(>.rh[data-coach-stick]) .hs-stick{border-color:var(--c-amarelo,#FFD23F);color:var(--c-amarelo,#FFD23F)}
.hs-heroi .hs-cam,.hs-heroi .hs-world::after{display:none}
.hs-heroi .hs-stick{left:max(24px,env(safe-area-inset-left));bottom:max(24px,env(safe-area-inset-bottom))}
.hs-heroi .hs-attack{right:max(24px,env(safe-area-inset-right));bottom:max(24px,env(safe-area-inset-bottom));width:var(--botao-habilidade);height:var(--botao-habilidade)}
@media (max-width:370px),(max-height:500px){.hs-heroi .hs-stick{width:96px;height:96px;left:max(18px,env(safe-area-inset-left));bottom:max(16px,env(safe-area-inset-bottom))}.hs-heroi .hs-attack{right:max(18px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom))}}
.hs-hero{position:fixed;z-index:6;width:56px;height:56px;box-sizing:border-box;border-radius:50% 50% 40% 40%;background:#f4c9a8;border:3px solid #6e5198;pointer-events:none}
`;
document.head.append(style);

const world=document.createElement('div');world.className='hs-world';
world.innerHTML='<div class="hs-mock hs-cam">↶ 1 / 4 ↷</div><div class="hs-mock hs-gear">'+icon('config')+'</div><div class="hs-mock hs-stick">●</div><div class="hs-mock hs-attack">Atacar</div>';
document.body.append(world);
let moved=0;
world.addEventListener('pointerdown',()=>{moved++;document.body.dataset.worldTaps=String(moved);});

/**
 * `nomes=longos`: the lobby's longest real names (20 characters) through the game's own rendering; `bots=N`: the owner's
 * roster marks the last N players as room bots (D-025). Both for the owner's 6-player result (BUG-resultado-dono-6p-rola).
 */
const LONG_NAMES=['Maria Aparecida dos','Seu Jorge do Pastel','Wagner Washington Mo','Tia da Festa Junina','Concurseira Eterna d','Zé do Pix Parcelado'];
const bots=Math.max(0,Math.min(5,Number(params.get('bots'))||0));
/**
 * `premios=empates` (DSG-adesivos-itens): the real room the lab ends at once. One player did all the damage, one caught a
 * thing, the rest tied at zero, so most cards get a vice with the long "Empatou em … e perdeu no desempate." line.
 */
const ties=params.get('premios')==='empates';
function tied<T extends {players:{stats?:unknown;weapons:unknown;passives:unknown}[]}>(v:T):T{
  if(!ties)return v;
  const builds=[['guarda-chuva','cartao'],['chinelo','tenis'],['chinelo','megafone'],['chinelo','audio'],['chinelo','cartao'],['chinelo']];
  return {...v,players:v.players.map((p,i)=>({...p,weapons:[{id:builds[i%6][0],level:i===5?2:1}],passives:builds[i%6].slice(1).map(id=>({id,level:1})),
    stats:{damage:i===3?900:0,kills:i===3?60:0,revives:0,pickups:i===0?1:0,downs:0,heals:0,chests:0,evolves:0}}))};
}
/**
 * `arsenal=1` (armas-caixas-render-2, D-051): the manual combat's hands, each player holding an arsenal weapon, so the
 * team portraits show the weapon's sticker (team.ts handWeapon).
 */
const ARSENAL_HANDS=['pistola','escopeta','macarico','rojao','rifle','submetralhadora'];
function armed<T extends {players:{name:string}[]}>(v:T):T{
  if(params.get('arsenal')!=='1')return v;
  return {...v,players:v.players.map((p,i)=>({...p,weapons:[{id:'faca',level:1},{id:ARSENAL_HANDS[i%ARSENAL_HANDS.length],level:2}],hand:1}))};
}
function named<T extends {players:{name:string}[]}>(v:T):T{
  if(params.get('nomes')!=='longos')return armed(v);
  return armed({...v,players:v.players.map((p,i)=>({...p,name:LONG_NAMES[i%LONG_NAMES.length]}))});
}
let tick=1000,forgeReq=0,cidaReq=0;
let view:RunView=named(fakeView(scenario,players,tick));
const hud=new RunHud(document.body,{
  localId:'p1',worldRescue:bordas||cidade||!!pausa,
  // The pause's frozen scenes (modo foto): its clock stands still, so the seconds and the bar print the same every time.
  ...(pausa&&frozen?{pauseClock:()=>0}:{}),
  // Forge taps answer after 150 ms, as a room would (VGM-046B); the balance does not move in the sandbox.
  onForge(recipe){const req=++forgeReq;setTimeout(()=>hud.forged({req,recipe,ok:true}),150);return req;},
  // Dona Cida (D-047): the answer a room would give for the sandbox's numbers (the tray's own checks run first).
  onCida(item){const req=++cidaReq;setTimeout(()=>hud.bought({req,item,ok:true,grana:view.objective?.grana??0}),150);return req;},
  // PIX (carteira-e-pix, hud/pix.ts): answers after 150 ms like a room (the sandbox's wallets do not move); an accepted
  // one comes back as the room's 'pix' event (the sender's toast, the friend's portrait flashing).
  onPix(to,amount){return new Promise(done=>setTimeout(()=>{
    const mine=view.camp?.grana??0;
    if(amount>mine){done({ok:false,reason:'grana'});return;}
    view={...view,events:[{type:'pix',from:'p1',to,amount,memo:1,eventId:++eventId}]};hud.update(view);
    done({ok:true,to,amount,grana:mine-amount});
  },150));},
  // D-051 inventory (`inv=meio|cheio[&recusa=<razão>]`): the room's answer after 150 ms, the slots change as the sim would.
  onInventory(command){
    const refusal=params.get('recusa');
    setTimeout(()=>{
      if(refusal){hud.inventoryAnswer({cmd:command.t,ok:false,reason:refusal});return;}
      view={...view,players:view.players.map(p=>p.id==='p1'?inventoryStep(p,command):p),
        pickups:command.t==='take'?view.pickups.filter(x=>x.id!==command.pickup):view.pickups};
      hud.update(view);hud.inventoryAnswer({cmd:command.t,ok:true});
    },150);
    return true;
  },
  onChoose(offerId,index){
    document.body.dataset.lastChoice=`${offerId}:${index}`;
    view={...view,offers:view.offers.filter(offer=>offer.id!==offerId)};
    hud.update(view);
  },
  // D-052: "Pular" closes the offer (no prize), "Rolar de novo" deals the cards again, each spending one of the local
  // player's charges (fakeCharges), like the room.
  onSkip(offerId){
    if(!(fakeCharges.skips.p1>0))return;
    fakeCharges.skips.p1--;view={...view,offers:view.offers.filter(offer=>offer.id!==offerId)};hud.update(view);sendPause();
  },
  onReroll(offerId){
    if(!(fakeCharges.rerolls.p1>0))return;
    fakeCharges.rerolls.p1--;
    view={...view,offers:view.offers.map(offer=>offer.id===offerId?{...offer,id:`${offerId.split('~')[0]}~${fakeCharges.rerolls.p1}`,choices:[...offer.choices.slice(1),offer.choices[0]!]}:offer)};
    hud.update(view);sendPause();
  },
  onRematch(){document.body.dataset.rematch='1';},
  // The game passes onExit, so the result has its three buttons here too (Revanche, Arrumar a sala, Sair).
  onExit(){document.body.dataset.exit='1';},
  coachStorage:{getItem:k=>coachStore.get(k)??null,setItem:(k,v)=>{coachStore.set(k,v);}},
  ...(bicho?{critterIcon:(kind:string)=>{const s=critterIconSource(kind);return s&&'url' in s?s.url:cropped.get(kind)??(cropFrame(kind),undefined);}}:{}),
});
(window as unknown as {__hud:RunHud}).__hud=hud;
/**
 * The sandbox has no Phaser textures: a critter's still frame (art/hud-art.ts critterSheetFrame) cut from its sheet into
 * a data URL, once; the scene is drawn again when it is in. A sheet that fails leaves the critter without a sticker.
 */
const cropped=new Map<string,string>(),cropping=new Set<string>();
function cropFrame(kind:string){
  const f=critterSheetFrame(kind);
  if(!f||cropping.has(kind))return;
  cropping.add(kind);
  const img=new Image();
  img.onload=()=>{
    const w=img.naturalWidth/f.columns,h=img.naturalHeight/f.rows,c=document.createElement('canvas');
    c.width=Math.round(w);c.height=Math.round(h);
    c.getContext('2d')?.drawImage(img,f.col*w,f.row*h,w,h,0,0,c.width,c.height);
    cropped.set(kind,c.toDataURL());load(scenario);
  };
  img.src=f.url;
}

/** `conta=aberto|carro|time|tempo[&divida=1]` (D-047): the result carries the chaveiro's bill (RunState.objective). */
const conta=({aberto:'opened',carro:'car',time:'team',tempo:'timeout'} as const)[params.get('conta') as 'aberto']??undefined;
function withBill<T extends {victory:boolean}>(result:T):T{
  if(!conta)return result;
  const debt=params.has('divida')?84:0,budget=120+8*42,grana=budget-debt;
  return {...result,objective:{kind:'chaveiro',outcome:conta==='opened'?'victory':conta==='timeout'?'timeout':'defeat',cause:conta,wave:12,extraWaves:2,eta:conta==='opened'?0:184,
    seconds:1340,hits:42,limit:120,budget,grana,paid:Math.min(grana,budget),debt,parts:3}};
}
/** The fake pause of `pausa=` (ids of fakePlayers: p1 you, p2 Tia Cleide, p3 Zé do Pix, p4 Bruninha). */
const PAUSA_FAKE={escolhendo:{leftMs:9900,waiting:['p1','p2','p4']},esperando:{leftMs:6900,waiting:['p2','p4']},ultimo:{leftMs:2900,waiting:['p1']}} as const;
const PAUSA_TOTAL=12000;let pausaFrom=performance.now();
/** D-052: the fake run's "Pular" / "Rolar de novo" left per player (`pular=N`, `rolar=N` set yours; default 2 and 1). */
const fakeCharges={skips:{p1:Number(params.get('pular')??2),p2:2,p3:1,p4:2} as Record<string,number>,rerolls:{p1:Number(params.get('rolar')??1),p2:2,p3:2,p4:0} as Record<string,number>};
/**
 * Like the room (multiplayer/levelup-pause.ts): the pause at each whole second of leftMs (rounded up), the same values in
 * between (Hud.setPause ignores them; the HUD counts down locally). Frozen: the scene's exact leftMs, always.
 */
function sendPause(){
  if(!pausa)return;
  const fake=PAUSA_FAKE[pausa];
  let left=fake.leftMs-(performance.now()-pausaFrom);
  if(left<=0){pausaFrom=performance.now();left=fake.leftMs;}
  hud.setPause({leftMs:frozen?fake.leftMs:Math.ceil(left/1000)*1000,totalMs:PAUSA_TOTAL,level:view.team.level,waiting:[...fake.waiting],skips:{...fakeCharges.skips},rerolls:{...fakeCharges.rerolls}});
}
if(pausa)setInterval(sendPause,200);
/**
 * `inv=meio|cheio|kit` (D-051): the local player's inventory in manual combat (hud/inventory.ts); `kit` (torre-pela-caixa)
 * holds a Morteiro kit and a muro kit.
 */
const inv=(['meio','cheio','kit'] as const).find(v=>v===params.get('inv'));
const INV_HERO={x:12,y:15};
const INV_FIXTURE={
  meio:[{id:'faca',level:1},{id:'pistola',level:2},{id:'coxinha',level:2}],
  cheio:[{id:'faca',level:1},{id:'pistola',level:2},{id:'escopeta',level:3},{id:'rifle',level:4},{id:'coxinha',level:3},{id:'kit-torre',level:1}],
  kit:[{id:'faca',level:1},{id:'pistola',level:2},{id:'kit:morteiro',level:1},{id:'coxinha',level:2},{id:'kit:muro',level:6}],
};
/** What the sim would do to p1 for a command the sandbox accepts (no checks: `recusa=` shows the refusals). */
function inventoryStep<P extends {weapons:{id:string;level:number}[];hand?:number}>(p:P,command:InventoryCommand):P{
  const weapons=[...p.weapons];let hand=p.hand??0;
  if(command.t==='equip')hand=command.slot;
  else if(command.t==='use'){const it=weapons[command.slot];if(it&&it.level>1)weapons[command.slot]={...it,level:it.level-1};else{weapons.splice(command.slot,1);if(hand>command.slot)hand--;}}
  else if(command.t==='drop'){weapons.splice(command.slot,1);if(hand>=command.slot)hand=Math.max(0,hand-1);}
  else weapons[hand]={id:'chinelo-lendario',level:5};
  return {...p,weapons,hand};
}
let eventId=0;
/** D-051: 8 nests, the first 2 fallen (`ninhos=…`). */
const FAKE_NESTS=Array.from({length:8},(_,i)=>({id:`ninho-${i}`,kind:'ninho',x:10+i,y:10,hp:i<2?0:40,maxHp:40,phase:i<2?'destruido':'dormindo'}));
/** The game's arrow rule (arrows.ts: only the caído); `setas=todas` shows every kind, for the old layout audits. */
const shownHere=<T extends {kind:EdgeKind}>(targets:readonly T[]):T[]=>params.get('setas')==='todas'?[...targets]:shownTargets(targets);
function load(next:HudScenario){
  scenario=next;tick=1000;
  view=named(fakeView(scenario,players,tick));
  // D-051 (ninhos-rounds-fora): `ninhos=…` also puts 8 nests in the view, 2 fallen: the mode's chip and bar ("[ninho] 6/8"),
  // no "Onda N" nor intermission, and the result's "Ninhos 2/8".
  if(params.has('ninhos'))view={...view,structures:[...view.structures,...FAKE_NESTS]};
  // (With the kill-cam the wave is at its end: its 1.8 s banner is long gone, as in the game.)
  if((scenario==='wave'||scenario==='boss')&&params.get('zueira')!=='killcam')view.events=[{type:'round',index:view.round!.index,phase:'wave',name:scenario==='boss'?BOSS_NAME:ROUND_NAME,modifier:scenario==='boss'?undefined:MODIFIER,eventId:++eventId}];
  if(scenario==='prepare')view.events=[{type:'round',index:view.round!.index,phase:'prepare',eventId:++eventId}];
  // The tutorial's round-1 banner comes with the city's first view (below), in the same frame as the walk's row, as in
  // the game; until the city is in, nothing.
  if(tutorial)view.events=[];
  // The pause freezes the round: no banner over it.
  if(pausa)view.events=[];
  // `barricada=1` with state=camp-forge (BUG-20261014-ORQ-forja-cobre-heroi-retrato): a damaged city barricade by the
  // camp, so the forge carries its fourth tag ("Reparar Norte"), as in the city camp. Stand-in mouths, the N one there.
  if(scenario==='camp-forge'&&params.get('barricada')==='1'){
    (hud as unknown as {camp:{setBocas(b:unknown):void}}).camp.setBocas({N:{x:12,y:17},S:{x:12,y:-60},L:{x:70,y:15},O:{x:-60,y:15}});
    view={...view,structures:[...view.structures,{id:'s9',kind:'barricada',x:12,y:16.5,hp:60,maxHp:200}]};
  }
  // Result: feed falls, rescues and pickups through events so the joke awards reflect a tally.
  if(scenario==='result')view.events=ties?[]:fakeResultEvents(players,()=>++eventId);
  // `bicho`: who got them (the downed banner's cause line and the result's "Te derrubou").
  if(bicho&&scenario==='result')view.events=view.events.map(e=>e.type==='downed'?{...e,source:bicho}:e);
  if(bicho&&scenario==='downed')view.events=[...view.events,{type:'downed',player:'p1',source:bicho,eventId:++eventId}];
  // A coach scene: no round banner (it would hold the slot for 1.8 s), and the world the hint talks about.
  if(dica){
    if(!tutorial)view.events=[];
    // "Andar" lives in round 1 only (it never lights in a later round): its scene is round 1, lit for 6 s.
    if(dica==='walk'&&view.round)view.round={...view.round,index:1};
    if(dica==='rescue')view.players=view.players.map(p=>p.id==='p3'?{...p,hp:0,online:true,downed:{progress:.2,bleedOutTick:tick+400}}:p);
  }
  // D-051 inventory (`inv=meio|cheio`): p1 in manual combat; full, with a weapon on the ground at the hero's feet ("Trocar").
  if(inv){
    view={...view,players:view.players.map(p=>p.id==='p1'?{...p,weapons:INV_FIXTURE[inv],hand:1}:p)};
    if(inv==='cheio')view.pickups=[...view.pickups,{id:'item-1',kind:'item',x:INV_HERO.x+.6,y:INV_HERO.y,value:5,resource:'chinelo-lendario'}];
  }
  hud.hideResult();hud.setHero(inv?{...INV_HERO,...FIXTURE_HERO[scenario]}:FIXTURE_HERO[scenario]);hud.update(view);
  // A wave with the wall going from 54% to 22%: the "Muralha em 25%" notice, as a real hit would bring it.
  if(scenario==='camp-wave'){hud.update({...view,structures:view.structures.map(s=>({...s,hp:324}))});hud.update(view);}
  // ?vergonha=nenhuma drops the shame notice, ?vergonha=cedo makes it the early fall (its "Round 1" / "Onda 1" / no number).
  const vergonha=params.get('vergonha'),shamed=<T extends {shame?:unknown;players:{id:string}[]}>(r:T):T=>{
    if(vergonha==='nenhuma'){const {shame:_,...rest}=r;return rest as T;}
    return vergonha==='cedo'&&r.players[0]?{...r,shame:{player:r.players[0].id,key:'cedo',round:1,tick:300,source:'bebado'}}:r;
  };
  if(scenario==='result')hud.showResult(shamed(withShare(withBill(tied(named(fakeResult(players,!params.has('lose')&&(!conta||conta==='opened'),params.has('full'))))))));
  // The owner's result (D-025: "Arrumar a sala"), and the playtest's "Métricas" chip with ?dev=1 (the layout audit).
  // `votos=N[&falta=S]` (UX-resultado-revanche): the room's rematch vote, the last N players said "topa" (the local one only with all) (S: the majority's clock).
  if(scenario==='result'&&params.has('votos')){
    const ids=view.players.map(p=>p.id),n=Number(params.get('votos'))||0,left=params.get('falta');
    hud.setRematch({votes:ids.slice(ids.length-n),voters:ids,...(left?{leftTicks:Number(left)*20}:{})});
  }
  if(scenario==='result'&&params.has('dono')){const ids=view.players.map(p=>p.id);hud.setRoster({owner:'p1',canManage:true,members:ids,bots:ids.slice(ids.length-bots),seatsLeft:Math.max(0,6-ids.length),extra:[]});}
  // `data-hud-ready` says the scene is drawn (the audit measures only then: BUG-audit-scroll-flaky); with the chip, once
  // its module and stylesheet are in.
  document.body.dataset.hudReady='0';
  if(scenario==='result'&&uxMetricsEnabled(location.search))void import('../dev/ux-metrics.ts').then(async m=>{
    await import('../dev/ux-metrics.css');
    const titles=hud.el.querySelector(m.RESULT_SELECTOR);
    if(titles&&!titles.querySelector('.ux-dev-export'))titles.append(m.createExportButton(document,async()=>'cancelled'));
    document.body.dataset.hudReady='1';
  });
  else document.body.dataset.hudReady='1';
  // Combat with the compact panel open: D-050's level-up pause (the room's RunState.pause), 9 s of 12 left, the whole
  // team still picking. Every other scenario runs unpaused.
  hud.setPause(scenario==='offer-open'||scenario==='offer-open-downed'||scenario==='offer-tomos'?{leftMs:9000,totalMs:12_000,level:view.team.level,waiting:view.players.map(p=>p.id).sort()}:undefined);
  // `pausa=` (D-050 HUD): the scene's own pause over it (who picked, the seconds), sent like the room's.
  if(pausa)sendPause();
  // `minerva=<s>` (relogio-minerva): the Minuto de Minerva clock with s seconds left, as the room's minervaAteTick.
  const minerva=Number(params.get('minerva'));
  hud.setMinerva(minerva>0?tick+Math.round(minerva*SIM_HZ):undefined);
}

load(scenario);
// The art index may land after the first draw: draw the scene again once it is in (critter icons, imported faces).
void artReady().then(ok=>{if(ok)load(scenario);});

/**
 * `pix=balao|recebido|enviado` (carteira-e-pix, hud/pix.ts; players ≥ 2): the PIX balloon open on Tia Cleide's portrait
 * (with frozen=1 it stays: the views drive its 4 s), or the toast of a PIX of R$ 10 received from her / sent to her,
 * her portrait (or yours) flashing. With `conta=`, the result's vaquinha comes with the bill (withShare).
 */
const pixScene=params.get('pix');
function showPix(){
  if(pixScene==='balao'){hud.el.querySelector('.rh-member[data-id="p2"]')?.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return;}
  if(pixScene!=='recebido'&&pixScene!=='enviado')return;
  const who=pixScene==='enviado'?{from:'p1',to:'p2'}:{from:'p2',to:'p1'};
  view={...view,events:[{type:'pix',...who,amount:10,memo:0,eventId:++eventId}]};hud.update(view);
}
if(pixScene)requestAnimationFrame(()=>requestAnimationFrame(showPix));
/** The chaveiro bill's vaquinha (ObjectiveResult.share): equal parts, Zé do Pix (p3) with R$ 0, the rest on p1. */
function withShare<T extends {objective?:{paid:number;share?:{id:string;had:number;paid:number}[]};players:{id:string}[]}>(result:T):T{
  const o=result.objective;if(!o)return result;
  const ids=result.players.map(p=>p.id),payers=ids.filter(id=>id!=='p3'),part=Math.floor(o.paid/Math.max(1,payers.length));
  const share=ids.map(id=>({id,had:id==='p3'?0:part+8,paid:id==='p3'?0:part+(id===payers[0]?o.paid-part*payers.length:0)}));
  return {...result,objective:{...o,share}};
}
/**
 * Zueira events (VGM-053B): `&zueira=boletos|promo|apagao` shows that event's banner, `&zueira=killcam` the kill-cam
 * window (as after a round's last kill). Re-sent every 1.5 s so a frozen page keeps it on screen for the audit.
 */
const zueira=params.get('zueira');
if(zueira){
  const send=()=>{
    const e=zueira==='killcam'?{type:'last-bicho' as const,kind:bicho??'tio-pave',x:4,y:6,round:view.round?.index??3,by:view.players[1]?.id}
      :{type:'happening' as const,kind:zueira as 'boletos'|'promo'|'apagao',endsTick:tick+60};
    hud.update({...view,events:[{...e,eventId:++eventId}]});
  };
  send();setInterval(send,1500);
}
(window as unknown as {__hudSandbox:{load:typeof load}}).__hudSandbox={load};

/**
 * Where the round's follow camera puts the hero's feet (body 28 px over them): the viewport centre
 * (BUG-20261013-ORQ-camera-centro-heroi), or, in portrait with the forge or Dona Cida's tray open, the middle of the band
 * the game frames it in beside the window (framing.ts framesBeside, zones.ts besideArea, the same functions the game
 * runs), from the live HUD and the mock thumbs. Off the city the sandbox has no minimap: the phone's (fone-layout.ts)
 * stands in for it in the band, as in the game.
 */
async function heroFeet(){
  const [{besideFrom},{besideArea,computeZones,measureZoneInput},{foneMinimapRect}]=await Promise.all([
    import('../framing.ts'),import('../hud/zones.ts'),import('../hud/fone-layout.ts')]);
  const box=(el:Element|null)=>{if(!el)return undefined;const r=el.getBoundingClientRect();return r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:undefined;};
  return ()=>{
    const viewport={width:innerWidth,height:innerHeight};
    const tray=document.querySelector('.rh-forge:not([hidden]),.rh-cida:not([hidden])'),rect=box(tray);
    const kind=tray?.classList.contains('rh-cida')?'cida' as const:'forja' as const;
    // The game's own decision (explore.ts): beside the window only when it would cover the centred hero, in portrait.
    if(!besideFrom({viewport,tray:rect&&{kind,rect}}))return {x:viewport.width/2,y:viewport.height/2+28};
    const input=measureZoneInput(document),phone=hud.el.dataset.hud==='fone';
    const status=[...input.status,box(document.querySelector('.hs-gear')),...(phone&&!input.minimap?[foneMinimapRect(viewport)]:[])];
    const zones=computeZones({...input,status,joystick:box(document.querySelector('.hs-stick')),skill:box(document.querySelector('.hs-attack'))});
    const a=besideArea(zones,rect);
    return {x:a.x+a.width/2,y:a.y+a.height/2+28};
  };
}

/**
 * `heroi=1` (BUG-20261014-ORQ-forja-cobre-heroi-retrato): the hero's 56 px box where the round's camera puts it
 * (heroFeet; the city scenes always draw it), and the mock joystick and skill button where the phone's shell draws them
 * (explore.css: 112 px stick 24 px in; 96 px at 16/18 px when ≤ 370 px wide; the skill --botao-habilidade; no camera
 * buttons), so a print shows whether a window covers the hero. `body[data-hero]` holds the box.
 */
const heroi=params.get('heroi')==='1';
if(heroi)document.body.classList.add('hs-heroi');
if(heroi&&!cidade)void heroFeet().then(feet=>{
  const heroEl=document.createElement('div');heroEl.className='hs-hero';document.body.append(heroEl);
  const place=()=>{
    const f=feet(),box={x:f.x-28,y:f.y-56,width:56,height:56};
    Object.assign(heroEl.style,{left:`${box.x}px`,top:`${box.y}px`});document.body.dataset.hero=JSON.stringify(box);
  };
  // The forge's window lays out with the HUD: placed again 4 times a second, as the city's draw.
  place();addEventListener('resize',place);setInterval(place,250);
});

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
  const {layoutEdges,pointedTargets,COVERING,WINDOWS}=await import('../hud/edges.ts');
  const {radar}=await import('../hud/radar.ts');
  const {computeZones,union}=await import('../hud/zones.ts');
  const {WcMinimapDriver}=await import('../hud/wc-minimap/driver.ts');
  const {screenCorners:screenCornersOf}=await import('../hud/city/wiring.ts');
  const maps=await import('../../maps/index.ts');
  const wcDriver=new WcMinimapDriver(),mmTerrain=params.get('mapa')==='infinito'?new maps.TerrainField(4242,{world:'infinito'}):maps.defaultTerrain;
  const {projectView}=await import('../projection.ts');
  const {toScreen,followZoom}=await import('../framing.ts');
  const view=Math.max(0,Math.min(3,Number(params.get('vista'))||0));
  const rect=(el:Element|null)=>{if(!el)return undefined;const r=el.getBoundingClientRect();return r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:undefined;};
  const all=(sel:string)=>[...document.querySelectorAll(sel)].map(rect);
  const draw=()=>{
    const viewport={width:innerWidth,height:innerHeight};
    // The open window (offer or forge) takes its part of the field, as measureZones does in the game: the hero and
    // the arrows go to what is left (NEW-20261011-UX-janela-esconde-caido).
    const open=rect(document.querySelector('.rh-offer:not([hidden])'))??rect(document.querySelector('.rh-forge:not([hidden])'));
    const shown=rect(hud.wc!.el);
    const zones=computeZones({viewport,status:[rect(document.querySelector('.hs-cam')),rect(document.querySelector('.hs-gear')),...all('.rh-top>*')],
      team:union(all('.rh-member:not(.rh-top .rh-member)')),joystick:rect(document.querySelector('.hs-stick')),skill:rect(document.querySelector('.hs-attack')),minimap:shown,offer:open});
    const area=zones.useful,zoom=followZoom(viewport),hero={x:12,y:17};
    // The camera puts the hero's body at the viewport centre in the round (framing.ts FollowCamera, BUG-20261013-ORQ-camera-centro-heroi), feet 28 px under it.
    const anchor={x:viewport.width/2,y:viewport.height/2+28},center=projectView(hero,view);
    const locate=(p:{x:number;y:number})=>{const q=toScreen(projectView(p,view),center,viewport,zoom);return {x:q.x-viewport.width/2+anchor.x,y:q.y-viewport.height/2+anchor.y};};
    const states=new Map(view0.players.map(p=>[p.id,p]));
    const spots=[{x:12,y:17},{x:2,y:15},{x:13,y:2},{x:24,y:20},{x:21,y:6},{x:4,y:26}];
    const players=view0.players.map((p,i)=>({id:p.id,name:p.name,classId:p.classId,x:spots[i].x,y:spots[i].y,online:true}));
    const {targets}=radar({selfId:'p1',focus:hero,tick:view0.tick,players,states,base:{x:12,y:12},
      enemies:[{id:'boss',kind:'chefe',x:30,y:30,hp:900,maxHp:1000,boss:true}],telegraphs:[{id:'t',shape:'circle',x:30,y:31,radius:3,fireTick:view0.tick+10}],
      warnings:[{x:-6,y:4,atTick:view0.tick+20}],pinged:id=>id==='p3',locate,portrait:c=>`/art/portraits/${c}-thumb.webp`});
    // The game's own list (edges.ts COVERING) plus the sandbox's stand-ins for the explore shell's controls: the audits
    // check the game's rule, not a copy of it (code review janela-caido).
    const covered=all(`${COVERING},.hs-cam,.hs-gear,.hs-stick,.hs-attack`).filter((r):r is NonNullable<typeof r>=>!!r);
    const heroBox={x:anchor.x-28,y:anchor.y-56,width:56,height:56};
    const seen={viewport:{x:0,y:0,...viewport},covered};
    hud.edges!.render(layoutEdges(shownHere(targets),area,heroBox,{seen,windows:all(WINDOWS)}));
    // What must keep an arrow (a caído or the boss off the field), as the game writes it: the audits check it against
    // the arrows drawn, whatever window is open (NEW-20261011-UX-janela-esconde-caido).
    hud.edges!.need(pointedTargets(targets,area,seen));
    // The WC3 minimap (wc-minimap/*), as rescue.ts draws it: the island, or the endless map with `mapa=infinito`.
    wcDriver.draw({minimap:hud.wc!,terrain:mmTerrain,view,nowMs:performance.now(),selfId:'p1',self:hero,players,states:new Map(view0.players.map(p=>[p.id,p])),
      enemies:[{x:30,y:30,boss:true},{x:20,y:24},{x:21,y:25},{x:6,y:28},{x:-4,y:10}],structures:[{kind:'muralha',x:12,y:12},{kind:'torre-chinelo',x:15,y:10}],
      corners:screenCornersOf(locate,hero,viewport),wallHitAt:performance.now()});
    hud.zones();// sets the announcement slot under the top band, as explore.ts does every layout
    document.body.dataset.useful=JSON.stringify(area);document.body.dataset.hero=JSON.stringify(heroBox);
  };
  // 5 allies, two of them caídos (p3 pinging), every one far from the hero.
  // The chosen state underneath (wave by default; camp-forge, camp-horn, offer-round… for the soma scenes of the audit),
  // always with the base ficha (VGM-046B) so the minimap and the ficha share the corner as in the real game.
  const base=named(fakeView(scenario,6,1000)),camp=fakeView('camp-wave',6,1000);
  const view0={...base,camp:base.camp??camp.camp,structures:base.structures.length?base.structures:camp.structures};
  view0.players=view0.players.map((p,i)=>i===2?{...p,hp:0,downed:{progress:0,bleedOutTick:1000+20*14}}:i===4?{...p,hp:0,online:true,downed:{progress:.45,bleedOutTick:1000+20*6}}:{...p,online:true});
  hud.setHero(FIXTURE_HERO[scenario]??FIXTURE_HERO['camp-wave']);hud.update(view0);
  draw();addEventListener('resize',draw);
  // The game lays the arrows out every frame; the sandbox does it 4 times a second, so a window opening or moving,
  // or the fonts arriving late, never leave the arrows of an older layout on screen.
  setInterval(draw,250);
  document.body.dataset.bordas='1';
})();

if(cidade)void (async()=>{
  document.body.classList.add('hs-cidade');
  const {cityTerrainFrom,cityAsField}=await import('../../maps/index.ts');
  const {CITY_ASSET_URL,CITY_MANIFEST_URL}=await import('../net/city-asset-loader.ts');
  const city=await import('../hud/city/index.ts');
  const {WcMinimapDriver}=await import('../hud/wc-minimap/driver.ts');
  const wcDriver=new WcMinimapDriver();
  const {pointedTargets,inView,COVERING,WINDOWS}=await import('../hud/edges.ts');
  const {computeZones,union}=await import('../hud/zones.ts');
  const {projectView}=await import('../projection.ts');
  const {toScreen}=await import('../framing.ts');
  // The same text and hash the game loads (net/city-asset-loader.ts): the sha256 is checked before decoding.
  const [text,manifest]=await Promise.all([fetch(CITY_ASSET_URL).then(r=>r.text()),fetch(CITY_MANIFEST_URL).then(r=>r.json() as Promise<{hash:string}>)]);
  const decoded=await cityTerrainFrom(text,manifest.hash);
  if(!decoded.ok){document.body.dataset.cidade='erro';return;}
  const terrain=decoded.terrain,map=city.cityMapInfo(terrain.asset),field=cityAsField(terrain);
  // The game builds the walking route on an idle moment from the lobby on (RunHud.prewarmCity); here it is ready before the first view.
  if(tutorial)city.cityRouteOf(terrain);
  const vista=Math.max(0,Math.min(3,Number(params.get('vista'))||0)) as 0|1|2|3;
  /** D-030: one 0.88 u cell is 56 CSS px on both reference phones; Phaser's zoom divides by the 42·√2 px of a projected unit. */
  const zoom=56/0.88/(42*Math.SQRT2);
  const rect=(el:Element|null|undefined)=>{if(!el)return undefined;const r=el.getBoundingClientRect();return r.width?{x:r.left,y:r.top,width:r.width,height:r.height}:undefined;};
  const all=(sel:string)=>[...document.querySelectorAll(sel)].map(rect);
  // On the south avenue, 35 u south of the plaza: the plaza, the groups, the caído and the east mouth are off screen.
  // The tutorial (cidade-08): the hero at `ponto` of round 1's walk, the team at the wreck.
  const P=terrain.asset.points;
  // The fixture's spots were picked on the .w3x-scale map (169 u): × CITY_MAP_SCALE they are the same places on the 1.7×
  // map (NEW-20261013-ORQ-cidade-escala-1-7). The asset's points (P) are already in its units.
  const {CITY_MAP_SCALE:S}=await import('../../rules/index.ts');
  const at=(x:number,y:number)=>({x:x*S,y:y*S});
  const SPOTS:Record<string,{x:number;y:number}>={inicio:P.inicio,travado:at(103.1,154.2),patio:at(104.5,149.5),meio:at(89.3,113),praca:P.praca};
  const spot=(text:string|null)=>{const xy=(text??'').split(',').map(Number);return xy.length===2&&xy.every(Number.isFinite)?{x:xy[0],y:xy[1]}:SPOTS[text??'']??P.inicio;};
  // D-047: `cida=1|aberta` puts the hero by the moto (Dona Cida's reach), else the fixture's spot.
  const cidaAt=params.get('chaveiro')==='1'&&params.has('cida');
  let hero=tutorial?spot(params.get('ponto')):at(82,125);
  const people:{id:string;name:string;x:number;y:number;downed?:boolean;seconds?:number;ping?:boolean}[]=tutorial
    ?[{id:'p1',name:'Você',x:hero.x,y:hero.y},{id:'p2',name:'Tia',x:P.inicio.x-1.4,y:P.inicio.y+.6},{id:'p3',name:'Zé do Pix',x:P.inicio.x+1.2,y:P.inicio.y+1}]
    :[{id:'p1',name:'Você',x:hero.x,y:hero.y},{id:'p2',name:'Tia',...at(58,100)},
      {id:'p3',name:'Zé do Pix',...at(118,142),downed:true,seconds:14,ping:true},{id:'p4',name:'Concursei',...at(86,128)}];
  const rnd=(()=>{let s=7;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/2**32;};})();
  const blob=(prefix:string,cx:number,cy:number,n:number)=>Array.from({length:n},(_,i)=>({id:`${prefix}${i}`,x:cx*S+(rnd()*2-1)*2,y:cy*S+(rnd()*2-1)*2}));
  // 12 coming down the north avenue, 7 on the west one, 3 (a clover on the minimap only) south-east, 1 alone (nowhere).
  // The tutorial: round 1's first group of bêbados on the novice's road (≈(89,124)).
  const enemies=tutorial?blob('b',89,124,3):[...blob('n',84,40,12),...blob('o',40,88,7),...blob('se',120,120,3),...blob('s',60,150,1)];
  const tick=1000,mouths=new Map<'N'|'S'|'L'|'O',number>();
  const active=tutorial?[]:city.trackMouths(mouths,[{type:'spawn-warning',...at(150,88),atTick:tick+30}],tick,map);
  // The fixture's run under it, trimmed to these 4 players, with the wall at the plaza at 63%.
  const base=fakeView(scenario,people.length,tick);
  // Round 1's banner as the director sends it with the city's tutorial round (its name and line, cidade-08).
  const banner=tutorial?[{type:'round' as const,index:1,phase:'wave' as const,name:CIDADE_TUTORIAL.roundName,modifier:CIDADE_TUTORIAL.modifier,eventId:++eventId}]:[];
  // D-051 (mapa-vivo-ninhos): `ninhos=1` puts the seed's nests (`seed=N`, default 1) on the minimap, all seen;
  // `ninhos=nevoa` only the 3 nearest the hero (the fog); `dormindo=1` also marks their sleepers and the loose bands.
  // The plan is maps' cityNestPlan without the routes and the team's start (the sim passes those).
  const nestsMode=params.get('ninhos');
  const nestPlan=nestsMode?(await import('../../maps/index.ts')).cityNestPlan(terrain,Number(params.get('seed')??1)|0,{players:people.length}):undefined;
  const nestNear=nestPlan?[...nestPlan.nests].sort((a,b)=>Math.hypot(a.x-hero.x,a.y-hero.y)-Math.hypot(b.x-hero.x,b.y-hero.y)).slice(0,3):[];
  const nestMarks=(nestPlan?.nests??[]).map(n=>({kind:'ninho',x:n.x,y:n.y,size:n.size,seen:nestsMode!=='nevoa'||nestNear.includes(n)}));
  const sleepers=params.has('dormindo')&&nestPlan?[...nestPlan.nests.flatMap(n=>n.sleepers),...nestPlan.loose.flatMap(b=>b.members)]:[];
  // D-047: the fake chaveiro objective (sandbox-chaveiro.ts) at the plaza, 12 s into its loop; the car replaces the wall.
  const chaveiro=params.get('chaveiro')==='1'?await import('./sandbox-chaveiro.ts').then(m=>{
    const from=(params.get('rota')??'N').toUpperCase() as 'N'|'S'|'L'|'O';
    return m.fakeChaveiro(params,map.plaza,P[`spawn${from}`],P.bocas[from]).view(12000).view;
  }):undefined;
  if(chaveiro&&cidaAt)hero={x:chaveiro.moto.x+1.3,y:chaveiro.moto.y+.9};
  if(chaveiro&&cidaAt)people[0]={...people[0],...hero};
  // The objective as the room sends it (protocol 15): the fake's moto, car and route plus Dona Cida's numbers.
  const stock=(params.get('estoque')??'4,4,4').split(',').map(n=>Math.max(0,Number(n)|0));
  const banks:BankView[]|undefined=params.get('bancos')==='1'?[
    {id:'banco-0',...at(84,70),name:'juros',saldo:18,state:'bicho',drawer:'n0'},
    {id:'banco-1',...at(45,118),name:'pao-duro',saldo:40,state:'aberto'},
    {id:'banco-2',...at(112,150),name:'posto',saldo:0,state:'sem-cedulas',until:tick+130*SIM_HZ},
  ]:undefined;
  const objective=chaveiro?{kind:'chaveiro' as const,...chaveiro,route:[...(chaveiro.route??[])],stops:[...(chaveiro.stops??[])],
    grana:Math.max(0,Number(params.get('grana')??40)|0),budget:120+8*chaveiro.car.hits,stock:[0,1,2].map(i=>stock[i]??4)}:undefined;
  const run:RunView={...base,events:banner,structures:chaveiro?[{id:'quadradao',kind:'quadradao',x:map.plaza.x,y:map.plaza.y,hp:chaveiro.car.limit-chaveiro.car.hits,maxHp:chaveiro.car.limit}]:[{id:'s1',kind:'muralha',x:map.plaza.x,y:map.plaza.y,hp:380,maxHp:600}],
    ...(objective?{objective}:{}),...(banks?{banks}:{}),
    ...(tutorial&&base.round?{round:{...base.round,index:1,remaining:9}}:{}),
    players:base.players.map((p,i)=>({...p,name:people[i].name,online:true,...(people[i].downed?{hp:0,downed:{progress:0,bleedOutTick:tick+20*14}}:{})}))};
  // D-051 (ninhos-rounds-fora): the same 8 nests, 2 fallen, in the city's run (the chip and the phone bar read them).
  if(params.has('ninhos'))run.structures=[...run.structures,...FAKE_NESTS];
  // The sandbox's ticker (unless frozen=1) keeps updating this run.
  view=run;hud.update(run);
  const phase:'wave'|'prepare'=run.round?.phase==='prepare'?'prepare':'wave';
  const heroEl=document.createElement('div');heroEl.className='hs-hero';document.body.append(heroEl);
  const feet=await heroFeet();
  let previous=new Set<string>();
  const draw=()=>{
    const viewport={width:innerWidth,height:innerHeight};
    const open=rect(document.querySelector('.rh-offer:not([hidden])'))??rect(document.querySelector('.rh-forge:not([hidden])'))??rect(document.querySelector('.rh-cida:not([hidden])'));
    const controls={status:[rect(document.querySelector('.hs-cam')),rect(document.querySelector('.hs-gear')),...all('.rh-top>*')],
      team:union(all('.rh-member:not(.rh-top .rh-member)')),joystick:rect(document.querySelector('.hs-stick')),skill:rect(document.querySelector('.hs-attack')),offer:open,cida:rect(document.querySelector('.rh-cida-btn:not([hidden])'))};
    const zones=computeZones({viewport,...controls,minimap:rect(hud.wc?.el)});
    const area=zones.useful;
    // The camera puts the hero's body at the viewport centre in the round (framing.ts FollowCamera, BUG-20261013-ORQ-camera-centro-heroi),
    // feet 28 px under it; beside Dona Cida's tray in portrait (heroFeet).
    const anchor=feet(),center=projectView(hero,vista,field);
    const locate=(p:{x:number;y:number})=>{const q=toScreen(projectView(p,vista,field),center,viewport,zoom);return {x:q.x-viewport.width/2+anchor.x,y:q.y-viewport.height/2+anchor.y};};
    const heroBox={x:anchor.x-28,y:anchor.y-56,width:56,height:56};
    Object.assign(heroEl.style,{left:`${heroBox.x}px`,top:`${heroBox.y}px`});
    const covered=all(`${COVERING},.hs-cam,.hs-gear,.hs-stick,.hs-attack`).filter((r):r is NonNullable<typeof r>=>!!r);
    const seen={viewport:{x:0,y:0,...viewport},covered},isOnScreen=(p:{x:number;y:number})=>inView(locate(p),seen);
    const plaza=locate(map.plaza);
    hud.setHero({x:hero.x,y:hero.y,bearing:Math.atan2(plaza.y-anchor.y,plaza.x-anchor.x)*180/Math.PI});
    const {targets,groupKeys}=city.cityEdgeTargets({hero,selfId:'p1',players:people,enemies,activeMouths:active,map,phase,
      hornSeconds:city.hornSeconds(run.camp,tick,phase),locate,isOnScreen,previousGroups:previous,...(chaveiro?{moto:chaveiro.moto}:{}),...(banks?{banks}:{})});
    previous=groupKeys;
    const arrows=city.layoutCityEdges(shownHere(targets),area,heroBox,{seen,windows:all(WINDOWS),textScale:hud.edges!.scale()});
    hud.edges!.render(arrows);
    // What the arrows were laid out from, for the visual audits (card cidade-04).
    (window as unknown as {__cityEdges:unknown}).__cityEdges={targets,arrows,area,hero:heroBox};
    hud.edges!.need(pointedTargets(shownHere(targets),area,seen),city.cityMustPoint);
    // The WC3 minimap (wc-minimap/*), as rescue.ts draws it: the whole city, the marks, the camera's view.
    wcDriver.draw({minimap:hud.wc!,terrain:field,city:terrain.asset,view:vista,nowMs:performance.now(),selfId:'p1',self:hero,
      players:people.map(p=>({...p,online:true})),states:new Map(people.map(p=>[p.id,{downed:p.downed}])),enemies:[...enemies,{x:map.plaza.x+30*S,y:map.plaza.y-26*S,boss:true},...sleepers],
      structures:[...run.structures,...nestMarks],corners:city.screenCorners(locate,hero,viewport),wallHitAt:performance.now(),extras:[...chaveiroExtras(chaveiro),...bankExtras(banks)]});
    // Round 1's walk to the plaza (cidade-08), as rescue.ts hands it every frame: the city, the hero, the view.
    if(tutorial){
      hud.setCityRoute({terrain,hero,view:vista});
      const route=city.cityRouteOf(terrain),d=route.direction(hero);
      (window as unknown as {__cityObjective:unknown}).__cityObjective={hero,inside:route.inside(hero),meters:route.distance(hero),
        direction:d,bearing:city.screenBearing(d,vista),shown:hud.objectiveShown};
      document.body.dataset.objetivo=hud.objectiveShown?'1':'0';
    }
    hud.zones();// sets the announcement slot under the top band, as explore.ts does every layout
    document.body.dataset.useful=JSON.stringify(area);document.body.dataset.hero=JSON.stringify(heroBox);
  };
  draw();
  if(cidaAt&&params.get('cida')==='aberta')requestAnimationFrame(()=>hud.el.querySelector<HTMLButtonElement>('.rh-cida-btn:not([hidden])')?.click());
  addEventListener('resize',draw);setInterval(draw,250);
  requestAnimationFrame(()=>{draw();document.body.dataset.cidade='1';});
})();

/**
 * D-052 slice 3: ?carro=perto (Puxar near the car), corda (Soltar, on the rope) or obra[-muro|-barricada] (the build
 * tray open with that piece). The buttons and the tray only; the ghost is the scene's (sandbox-cidade obra=1).
 */
const carro=params.get('carro');
if(carro)void (async()=>{
  const {FortifyHud}=await import('../hud/fortify/fortify.ts');
  const piece=carro==='obra-muro'?'muro':carro==='obra-barricada'?'barricada':'vigia-do-predio';
  const fort=new FortifyHud(hud.el,{onPull:()=>{},onOpen:()=>{},onPick:()=>{},onTurn:()=>{},onConfirm:()=>{},onAim:()=>{},onAimEnd:()=>{},canvas:()=>undefined});
  const on=carro==='corda';
  fort.update({available:true,pull:{show:carro!=='longe',on,label:on?'Soltar':'Puxar',pushing:false},open:carro.startsWith('obra'),piece,rot:0,walls:12});
})();
