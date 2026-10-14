/**
 * Build menu sandbox (torres-hud): `?sandbox=obra[&cena=chao|arvore|evoluir|gustavao][&texto=125]`.
 * The obra HUD over a mock ground with the real control positions (status rows, team, joystick, skill, as the zones
 * tests use them), driven by fake data shaped like the sim's TowersState and built from the rules port's tree (the
 * client may not import src/sim). Until torres-fio puts the defenses on the wire, this is where the menu runs.
 * - chao: the intermission, menu closed: empty sites, a Vigia and an Atiradores ready (evolve arrows), one in obra, the rail;
 * - arvore: the tree open on the Vigia of a 1×1 site (A2 blocked: "Não cabe"; B2/C2 open);
 * - evoluir: the tree open on the Atiradores do Telhado (A3, evolve arrow): A4 or the alternative A4b, 24 each;
 * - gustavao: the tree open on the Obuseiro (the Gustavão: "Sem trilho" until the rail is laid and done).
 * Confirming applies the choice to the fake state (paid with the rules' payUnits), so the flow can be tapped through.
 * State: `window.__obra` ({view, actions}).
 */
import {DEFENSE_LIMIT,DEFENSES,payUnits,pickChild,ROOT_DEFENSE,RAIL,type DefenseId} from '../../rules/index.ts';
import {ObraHud} from '../hud/towers/obra.ts';
import type {ObraAction,ObraSite,ObraView} from '../hud/towers/model.ts';
import {orientationOf,type Rect,type ZoneInput} from '../hud/zones.ts';

const params=new URLSearchParams(location.search);
const scene=params.get('cena')??'chao';
if(params.get('texto')==='125')document.documentElement.dataset.texto='125';

function controls(w:number,h:number):ZoneInput{
  const viewport={width:w,height:h};
  if(orientationOf(viewport)==='landscape')return {viewport,
    status:[{x:14,y:12,width:44,height:44},{x:(w-180)/2,y:8,width:180,height:40},{x:(w-420)/2,y:52,width:420,height:20}],
    team:{x:(w-328)/2,y:h-72,width:328,height:64},joystick:{x:18,y:h-112,width:96,height:96},skill:{x:w-98,y:h-98,width:82,height:82}};
  return {viewport,
    status:[{x:14,y:12,width:44,height:44},{x:(w-142)/2+14,y:8,width:142,height:46},{x:8,y:72,width:w-98,height:26}],
    team:{x:8,y:120,width:54,height:380},joystick:{x:24,y:h-136,width:112,height:112},skill:{x:w-106,y:h-106,width:82,height:82}};
}

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
    // 3 fichas de torre and a quarter (D-048): the Vigia is buyable, the evolutions too; ?unidades=N for another pile
    // (36: no ficha, the ring at 90%).
    balance:{units:Number(params.get('unidades')??130)||0},standing:Math.min(standing,DEFENSE_LIMIT),gustavoes:0};
}
function apply(a:ObraAction){
  actions.push(a);
  if(a.type==='build'&&a.site===RAIL.siteId){if(payUnits(view.balance,RAIL.cost))view.rail={...view.rail!,laid:true};}
  else if(a.type==='build'){
    const s=view.sites.find(x=>x.id===a.site);
    if(s&&payUnits(view.balance,DEFENSES[ROOT_DEFENSE].cost)){s.tower={id:`defesa-${s.id.slice(5)}`,kind:ROOT_DEFENSE,building:true};view.standing++;}
  }else{
    const s=view.sites.find(x=>x.tower?.id===a.defense),next=s?.tower&&pickChild(s.tower.kind,a.branch);
    if(s?.tower&&next&&payUnits(view.balance,next.cost))s.tower={...s.tower,kind:next.id,building:true};
  }
  hud.update(view);
}

const root=document.createElement('div');
root.style.cssText='position:fixed;inset:0;z-index:50;overflow:hidden;background:var(--cena-grama)';
document.body.append(root);
const mocks=document.createElement('div');mocks.style.cssText='position:absolute;inset:0;pointer-events:none';root.append(mocks);
let input=controls(innerWidth,innerHeight);
function drawMocks(){
  const box=(r:Rect,round:boolean,label='')=>{const d=document.createElement('div');
    d.style.cssText=`position:absolute;left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;border:2px solid var(--c-breu);`+
      `background:var(--c-veu);border-radius:${round?'50%':'6px'};color:var(--c-papel);font:700 13px/1 var(--f-sistema);display:grid;place-items:center`;
    d.textContent=label;mocks.append(d);};
  mocks.replaceChildren();
  input.status.forEach(r=>r&&box(r,false));
  if(input.team)box(input.team,false,'time');
  if(input.joystick)box(input.joystick,true,'joystick');
  if(input.skill)box(input.skill,true,'Atacar');
}
const hud=new ObraHud(root,{zoneInput:()=>input,onConfirm:apply});
function reset(){
  input=controls(innerWidth,innerHeight);view=fake(innerWidth,innerHeight);drawMocks();hud.update(view);
  if(scene==='arvore')hud.open('obra-02');
  if(scene==='evoluir')hud.open('obra-03');
  if(scene==='gustavao')hud.open('obra-04');
  (window as unknown as {__obra:unknown}).__obra={view,actions};
}
reset();
addEventListener('resize',reset);
