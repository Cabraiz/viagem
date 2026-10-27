/**
 * Build menu sandbox (torres-hud): `?sandbox=obra[&cena=chao|arvore|evoluir|gustavao][&texto=125][&unidades=N][&grana=N][&players=1..6]`.
 * The obra HUD over a mock ground, laid out beside the game's own controls (sandbox-obra-topo-uma-linha): the coop shell's
 * config button, joystick and skill button (controls-phase.ts markup, explore.css/coop.css places) and the real run HUD
 * (hud.ts RunHud on the phone: the one-line top band, the announcement slot, the minimap's slot) in the intermission, read
 * by the same `zoneInputBesideObra` the game hands the obra HUD. Driven by fake data shaped like the sim's TowersState and
 * built from the rules port's tree (the client may not import src/sim).
 * - chao: the intermission, menu closed: empty sites, a Vigia and an Atiradores ready (evolve arrows), one in obra, the rail;
 * - arvore: the tree open on the Vigia of a 1×1 site (A2 blocked: "Não cabe"; B2/C2 open);
 * - evoluir: the tree open on the Atiradores do Telhado (A3, evolve arrow): A4 or the alternative A4b, R$ 25 each;
 * - gustavao: the tree open on the Obuseiro (the Gustavão: "Sem trilho" until the rail is laid and done).
 * Confirming applies the choice to the fake state (fichas with the rules' payUnits, an evolution from the Grana by
 * priceOf), so the flow can be tapped through.
 * State: `window.__obra` ({view, actions}).
 */
// The shell's own styles, as explore.ts brings them (the controls' places live there).
import '../explore.css';
import '../coop.css';
import {DEFENSE_LIMIT,DEFENSES,payUnits,pickChild,priceOf,ROOT_DEFENSE,RAIL,type DefenseId} from '../../rules/index.ts';
import {ObraHud} from '../hud/towers/obra.ts';
import type {ObraAction,ObraSite,ObraView} from '../hud/towers/model.ts';
import {RunHud} from '../hud/hud.ts';
import {fakeView} from '../hud/fixtures.ts';
import {STICK_HTML,SKILL_HTML} from '../controls-phase.ts';
import {icon} from '../ui/icon.ts';

const params=new URLSearchParams(location.search);
const scene=params.get('cena')??'chao';
if(params.get('texto')==='125')document.documentElement.dataset.texto='125';
const players=Math.max(1,Math.min(6,Number(params.get('players'))||4));

// Site points as fractions of the screen (the host would project the plan's world points).
const SPOTS:readonly [string,number,number,1|2|3,DefenseId|undefined,boolean?][]=[
  ['obra-01',.30,.30,2,undefined],['obra-02',.55,.26,1,'vigia-do-predio'],['obra-03',.78,.34,3,'atiradores-do-telhado'],
  ['obra-04',.40,.52,3,'obuseiro'],['obra-05',.66,.55,2,'holofote',true],['obra-06',.24,.62,2,undefined],['obra-07',.86,.62,2,undefined],
];
let view:ObraView;
const actions:ObraAction[]=[];
function fake(w:number,h:number):ObraView{
  const sites:ObraSite[]=SPOTS.map(([id,fx,fy,maxSize,kind,building])=>({id,x:Math.round(fx*w),y:Math.round(fy*h),maxSize,
    ...(kind?{tower:{id:`defesa-${id.slice(5)}`,kind,...(building?{building:true}:{})}}:{})}));
  const standing=sites.filter(s=>s.tower).length;
  return {prepare:true,sites,rail:{x:Math.round(.12*w),y:Math.round(.42*h),laid:false,ready:false},
    // 3 fichas de torre and a quarter (D-048): the Vigia is buyable; ?unidades=N for another pile (36: no ficha, the ring
    // at 90%). R$ 30 of Grana: the tier-2 to -4 evolutions yes, a tier-5 (R$ 35) not; ?grana=N for another amount.
    balance:{units:Number(params.get('unidades')??130)||0},grana:Number(params.get('grana')??30)||0,standing:Math.min(standing,DEFENSE_LIMIT),gustavoes:0};
}
function apply(a:ObraAction){
  actions.push(a);
  if(a.type==='build'&&a.site===RAIL.siteId){if(payUnits(view.balance,RAIL.cost))view.rail={...view.rail!,laid:true};}
  else if(a.type==='build'){
    const s=view.sites.find(x=>x.id===a.site);
    if(s&&payUnits(view.balance,DEFENSES[ROOT_DEFENSE].cost)){s.tower={id:`defesa-${s.id.slice(5)}`,kind:ROOT_DEFENSE,building:true};view.standing++;}
  }else{
    const s=view.sites.find(x=>x.tower?.id===a.defense),next=s?.tower&&pickChild(s.tower.kind,a.branch);
    if(!s?.tower||!next)return hud.update(view);
    const price=priceOf(next);
    if('tokens' in price){if(!payUnits(view.balance,next.cost))return hud.update(view);}
    else{if(view.grana<price.grana)return hud.update(view);view.grana-=price.grana;}
    s.tower={...s.tower,kind:next.id,building:true};
  }
  hud.update(view);
}

// The coop shell as the game opens it on a phone (explore.ts): only the parts the zones read, at their own CSS places.
const shell=document.createElement('dialog');shell.className='explore-shell coop-shell';shell.dataset.input='touch';
shell.innerHTML=`<div class="explore-layout">
  <button class="explore-config" aria-label="Configurações do jogo">${icon('config',{size:32})}</button>
  <section class="explore-stage" style="background:var(--cena-grama)" tabindex="-1" aria-label="Chão de mentira"></section>
  <footer class="explore-controls"><div class="explore-movement">${STICK_HTML}</div><div class="explore-help"></div><div class="explore-actions">${SKILL_HTML}</div></footer>
</div>`;
document.body.append(shell);shell.showModal();
// The modal focuses the gear; the game hands the focus to its map (no ring on the gear in the prints).
shell.querySelector<HTMLElement>('.explore-stage')!.focus();
const layout=shell.querySelector<HTMLElement>('.explore-layout')!;
const run=new RunHud(layout,{localId:'p1',worldRescue:true,input:'touch',onChoose(){}});
run.update(fakeView('prepare',players));
const hud=new ObraHud(layout,{zoneInput:()=>run.zoneInputBesideObra(),onConfirm:apply,
  onWindow:()=>run.layoutChanged()});
function reset(){
  view=fake(innerWidth,innerHeight);hud.update(view);
  if(scene==='arvore')hud.open('obra-02');
  if(scene==='evoluir')hud.open('obra-03');
  if(scene==='gustavao')hud.open('obra-04');
  (window as unknown as {__obra:unknown}).__obra={view,actions};
}
reset();
addEventListener('resize',reset);
