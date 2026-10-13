/**
 * Round table, player scaling and "zueira" themes for the director (VGM-033). Pure data and functions.
 *
 * Curve (regular enemies per round, no modifier; elite and boss are extra):
 *   round  1   2   3   4   5    6    7    8    9   10
 *   1 P    9  26  32  46  54   76   64   72   82   30 + chefe
 *   6 P   32  91 112 161 189  266  224  252  287  105 + chefe
 * Threat (count x hp x kind weight) climbs 3 -> 246 for one player; round 6 is a fragile swarm breather after the elite.
 * Round 1 teaches (BUG-20261009-N1-round1-letal): a trickle of bêbados at about a third of their hp, so every starting
 * weapon kills one in one or two hits, slow enough that a novice who stands 15 s or stops 8 s at each offer still
 * walks out with hp left, with 1, 2 or 6 players. Rounds 2-3 ramp the hp back (0.8, 1.1) to meet round 4 where it was.
 * Six players get count x3.5 and hp x1.75 (~6x threat for ~6x damage); groups grow and arrive faster by sqrt(count),
 * so a round lasts about the same 40-55 s for 1 or 6 players. Spawns plus ~20 s intermissions add up to ~11 min.
 */
import type {Rng} from '../contract/index.ts';
import {MAX_ENEMIES} from './budget.ts';
import {ticks} from '../contract/index.ts';

/** cluster: one point; line: single file at one point; surround: split across up to 4 sides at once. */
export type Formation='cluster'|'line'|'surround';
/** Regular cast of D-033 (sim/enemies/catalog.ts EnemyKind without the boss). */
export type RegularKind='bebado'|'pombos'|'tio-pave'|'agiota'|'anao-molotov'|'coach'|'motoboy'|'influencer';
export const REGULAR_KINDS:readonly RegularKind[]=['bebado','pombos','tio-pave','agiota','anao-molotov','coach','motoboy','influencer'];
/**
 * Relative threat per enemy (hp x danger). The heavier tio (100 hp, harder shove) went 2.5 → 2.8; the anão (40 hp,
 * telegraphed molotov with pulsing fire and a death explosion) is 2. P1 trio: the coach (40 hp, no melee, but his
 * lecture makes the crowd around him hit ×1.3) 1.5, the motoboy (18 hp, one warned charge and a blast, then he is gone)
 * 1.2, the influencer (80 hp, slow, reflects shots while posing) 2.5.
 */
export const THREAT:Readonly<Record<RegularKind,number>>={bebado:1,pombos:.5,'tio-pave':2.8,agiota:1.5,'anao-molotov':2,coach:1.5,motoboy:1.2,influencer:2.5};

/** Round 5 (elite tio-pavê with a chest) and round 10 (the boss) draw from their own names (D-033 joke pass). */
export const ELITE_ROUND_NAMES:readonly string[]=[
  'O Crachá Dourado Bateu Ponto','Puxa-Saco com Baú','Coroa de Papel, Baú de Ouro','O Chefe Tá Olhando',
  'Promovido a Desgraça',
];
export const BOSS_ROUND_NAMES:readonly string[]=[
  'Assembleia Sangrenta','Taxa Extra de Porrada','Síndico Desceu de Roupão','Ata da Carnificina','Rateio do Apocalipse',
];

export interface RoundDef {
  index:number;
  /** Regular enemies for one player, swarm included. */
  budget:number;
  /** Share per enemy kind, sums to 1. */
  weights:Partial<Record<RegularKind,number>>;
  /** Group size range for one player. */
  group:[number,number];
  /** Seconds between groups for one player. */
  cadence:number;
  /** Seconds; past this the rest of a regular round retreats to the sea. */
  maxDuration:number;
  hpScale:number;
  /** Pombos-only groups taken from the budget; `at` is a fraction of the spawn window. */
  swarm?:{size:[number,number];at:number[]};
  /** One elite with a chest, outside the budget. */
  elite?:{kind:RegularKind;at:number};
  /** spawnBoss() after atSeconds; the round never times out and escorts retreat when the boss falls. */
  boss?:{atSeconds:number};
  /** Names drawn for this round instead of the shared pool (elite and boss rounds keep their identity). */
  fixedNames?:readonly string[];
  /**
   * XP drops laid around the team when the wave starts (VGM-056, the first round teaches): the bêbados of the endless
   * world need ~25 s to arrive, so the first "+N" chip would come late or never; these few drops, a short walk away
   * and on screen, make walk, pick XP and the chip happen in the first seconds of moving. Team total, not per player.
   */
  crumbs?:{count:number;value:number;radius:readonly [number,number]};
}
/** Round 1's drops: one more than the first level needs (5 XP), so nobody hunts for the last one. */
export const TUTORIAL_CRUMBS={count:6,value:1,radius:[2.5,4.5] as const};

export const ROUNDS:readonly RoundDef[]=[
  // D-033 cast: the anão debuts in round 3 with a modest share (taken from the bêbados), 4-8% after that.
  // P1 trio (taken from the bêbados too): motoboy from round 3, coach from 4, influencer from 5, a few % each.
  {index:1,budget:9,weights:{bebado:1},group:[2,3],cadence:10,maxDuration:45,hpScale:.35,crumbs:TUTORIAL_CRUMBS},
  {index:2,budget:26,weights:{bebado:.75,pombos:.25},group:[3,5],cadence:5.5,maxDuration:50,hpScale:.8},
  {index:3,budget:32,weights:{bebado:.54,pombos:.25,'tio-pave':.15,'anao-molotov':.03,motoboy:.03},group:[4,6],cadence:5.5,maxDuration:55,hpScale:1.1},
  {index:4,budget:46,weights:{bebado:.43,pombos:.2,'tio-pave':.15,agiota:.12,'anao-molotov':.04,coach:.03,motoboy:.03},group:[5,8],cadence:5.5,maxDuration:60,hpScale:1.35},
  {index:5,budget:54,weights:{bebado:.35,pombos:.2,'tio-pave':.2,agiota:.12,'anao-molotov':.04,coach:.03,motoboy:.03,influencer:.03},group:[5,8],cadence:5,maxDuration:65,hpScale:1.55,
    elite:{kind:'tio-pave',at:.5},fixedNames:ELITE_ROUND_NAMES},
  {index:6,budget:76,weights:{bebado:.33,pombos:.2,'tio-pave':.2,agiota:.15,'anao-molotov':.05,coach:.02,motoboy:.03,influencer:.02},group:[6,10],cadence:5,maxDuration:60,hpScale:1.7,
    swarm:{size:[14,18],at:[.3,.7]}},
  {index:7,budget:64,weights:{bebado:.21,pombos:.2,'tio-pave':.2,agiota:.2,'anao-molotov':.07,coach:.04,motoboy:.04,influencer:.04},group:[6,9],cadence:5,maxDuration:65,hpScale:1.9},
  {index:8,budget:72,weights:{bebado:.16,pombos:.2,'tio-pave':.25,agiota:.2,'anao-molotov':.07,coach:.04,motoboy:.04,influencer:.04},group:[6,10],cadence:5,maxDuration:70,hpScale:2.1},
  {index:9,budget:82,weights:{bebado:.15,pombos:.25,'tio-pave':.2,agiota:.2,'anao-molotov':.08,coach:.04,motoboy:.04,influencer:.04},group:[7,11],cadence:5,maxDuration:75,hpScale:2.35},
  {index:10,budget:30,weights:{bebado:.29,pombos:.3,'tio-pave':.15,agiota:.15,'anao-molotov':.05,coach:.02,motoboy:.02,influencer:.02},group:[4,6],cadence:8,maxDuration:90,hpScale:2.5,
    boss:{atSeconds:2},fixedNames:BOSS_ROUND_NAMES},
];
export const ROUND_COUNT=ROUNDS.length;

// ---------- Player scaling (n = highest active player count of the last minute, 1..6) ----------
/** Alive cap 300 minus room for the elite or the boss. */
export const MAX_ROUND_ENEMIES=MAX_ENEMIES-10;
export const ELITE_HP=6,ELITE_SIZE=1.35;
export const countMult=(n:number)=>1+.5*(n-1);
export const hpMult=(n:number)=>1+.15*(n-1);
/** Elite (and boss) hp: a single target soaks the whole team's damage. */
export const soloHpMult=(n:number)=>1+.6*(n-1);
export function playerScale(players:number){
  const n=Math.max(1,Math.min(6,Math.round(players)));
  return {count:countMult(n),hp:hpMult(n),solo:soloHpMult(n),group:Math.sqrt(countMult(n))};
}

// ---------- Zueira ----------
export const ROUND_NAMES:readonly string[]=[
  // D-033 joke pass (heavy tone, humor-reviewed).
  'Saideira Que Nunca Acaba','Vaquinha Pro Presente do Chefe','Caixinha de Som no Ônibus',
  'Arroto Que Derrubou um Poste','Pombo Cagou no Pastel','Chá Revelação Pegou Fogo','Happy Hour de Guerra',
  'Agiota Mandou Áudio de 8 Minutos','Acordou no Ponto Final','Carvão Acabou no Meio do Churrasco',
  'Acendeu o Carvão com Cachaça','Tio Abriu Mais Um Botão','Agiota de Óculos à Noite','Reunião Que Podia Ser um Email',
  'Vômito na Escada do Prédio','Isopor Sem Gelo','Pastel de Vento e Porrada','Caldo de Cana Batizado',
  'Bar Fechou, Bêbado Não','Obra do Vizinho às 7h de Sábado','Revoada na Rodoviária','Tio Pegou o Microfone',
  'Fiado Só Amanhã','Almoço de Domingo na Sogra','Assembleia de Bêbados','O Garçom Desistiu','Sexta-feira, 18h01',
  'Feriado Prolongado de Porrada','Cheque Voltou, Tio Também','Penúltima Dose do Fim do Mundo',
  // Kept from the VGM-033/VGM-055 packs to hold the 60-name minimum (no repeats across a run).
  'Vomitou na Fila do Banco','Grupo da Família às 6h','Wi-Fi da Vizinha','Leve 3, Pague 3','Rodízio de Bêbado',
  'Feriado que Caiu no Sábado','Liquidação de Pombo','Visita Surpresa da Tia','Dedinho na Quina','Celular com 2%',
  'Pote de Sorvete com Feijão','Chinelo Voador','Acordou Abraçado na Privada','Amigo Oculto de 20 Reais','Feirante Gritando no Ouvido',
  'Vizinho Gritou Gol Antes','Pisou de Meia no Molhado','Uva-Passa em Tudo','Telemarketing no Domingo',
  'Ensaboado e Sem Água','Vó Disse Que Tá Magrinho','Pagou Academia, Nunca Foi','Fecha Essa Geladeira!',
  'Soneca Pela Quinta Vez','Se Eu For Aí e Achar...','Tia Bebeu o Licor do Bolo','Caramelo Dono da Rua',
  'Brigadeiro Antes do Parabéns','Ex Curtiu Foto de 2014','Olha o Carro do Ovo',
];
/** Said by one enemy when a timed-out horde gives up and walks back into the sea. */
export const RETREAT_LINES:readonly string[]=[
  'Fechou o bar? Então fui.','Vou ali vomitar e já volto','Minha mãe ligou. Tchau, porra','Amanhã tem firma, desgraça',
  'Deixei o feijão no fogo!','Vou buscar cigarro. Já volto.','Bateu a ressaca. Abortar!','Tô indo, mas levo o isopor',
  'Acabou a cachaça. Retirada!','Vou dormir na escada do prédio','Pombo não corre. Pombo voa.',
  'Volto quando sair o 13º','Deu minha hora, bati o ponto','Fui! Pendura minha morte aí',
];

export interface RoundModifier {
  id:string;name:string;description:string;
  /** Replaces the composition. */
  weights?:Partial<Record<RegularKind,number>>;
  /** Pins these shares and rescales the other kinds to fill the rest. */
  share?:Partial<Record<RegularKind,number>>;
  /** count x= base average threat / new average threat, clamped to [0.4, 1.6]. */
  normalizeThreat?:boolean;
  countMult?:number;hpMult?:number;speedMult?:number;sizeMult?:number;
  groupSizeMult?:number;cadenceMult?:number;
  formation?:Formation;
  /** Every group of the round comes from one side of the island. */
  singleSide?:boolean;
  /** Groups come from one side, then the opposite one, alternating. */
  alternateSide?:boolean;
  /** Rounds where this modifier is never drawn (it would hide the elite or break the round's identity). */
  banRounds:readonly number[];
}
/**
 * Drawn from round 3, one per round, never twice in a run, never on the boss round. Each stays within ~0.9-1.15 of the round threat.
 * Names and descriptions of the kind-specific ones follow the D-033 cast (the D-033 joke pass left the base modifiers as they are).
 */
export const MODIFIERS:readonly RoundModifier[]=[
  {id:'uncle-party',name:'Round do Pavê',description:'Só tio. É pavê ou pa comê?',
    weights:{'tio-pave':1},normalizeThreat:true,banRounds:[5,6]},
  {id:'mosquito-swarm',name:'Revoada de Pombos',description:'Quem jogou milho?!',
    share:{pombos:.7},normalizeThreat:true,groupSizeMult:1.5,cadenceMult:1.5,banRounds:[6]},
  {id:'giant-everyone',name:'Todo Mundo Gigante',description:'Exageraram no fermento.',
    sizeMult:1.5,hpMult:1.3,countMult:.7,banRounds:[5]},
  {id:'shrunk-in-wash',name:'Encolheu na Lavagem',description:'Lavaram com água quente.',
    sizeMult:.75,hpMult:.8,countMult:1.3,speedMult:1.1,banRounds:[]},
  {id:'lovesick-slimes',name:'Bêbados Abraçados',description:'Em fila, de mãozinha dada.',
    share:{bebado:.7},normalizeThreat:true,groupSizeMult:2,cadenceMult:2,formation:'line',banRounds:[6]},
  {id:'taxman-day-off',name:'Agiota de Folga',description:'Tá na praia de meia e papete.',
    weights:{agiota:0},normalizeThreat:true,banRounds:[3]},
  {id:'monday-speed',name:'Modo Segunda-feira',description:'Ninguém quer trabalhar.',
    speedMult:.75,countMult:1.15,banRounds:[]},
  {id:'company-trip',name:'Excursão da Firma',description:'Vieram todos na mesma van.',
    singleSide:true,countMult:1.1,groupSizeMult:1.3,cadenceMult:1.3,banRounds:[]},
  {id:'black-friday',name:'Black Friday',description:'Tudo pela metade do dobro.',
    countMult:1.35,hpMult:.75,groupSizeMult:1.35,banRounds:[]},
  {id:'audit-day',name:'Dia de Cobrança',description:'Venceu tudo hoje.',
    share:{agiota:.4},normalizeThreat:true,banRounds:[3,6]},
  // Pack 2 (VGM-055): surround and alternating sides, threat 0.9-1.12 of the base round.
  {id:'surprise-party',name:'Festa Surpresa',description:'Fingiram que esqueceram.',
    formation:'surround',countMult:.95,groupSizeMult:1.3,cadenceMult:1.3,banRounds:[]},
  {id:'uncle-hug',name:'Abraço de Tio',description:'Vem de todo lado, com tapinha.',
    share:{'tio-pave':.4},normalizeThreat:true,formation:'surround',banRounds:[5,6]},
  {id:'conga-line',name:'Trenzinho da Festa',description:'Vai pra lá, volta pra cá.',
    formation:'line',alternateSide:true,groupSizeMult:1.6,cadenceMult:1.6,countMult:1.05,banRounds:[]},
  {id:'frescobol',name:'Frescobol',description:'Ninguém ganha, ninguém para.',
    alternateSide:true,countMult:1.1,cadenceMult:.85,banRounds:[]},
  {id:'recess-bell',name:'Sinal do Recreio',description:'Correria rumo à cantina!',
    speedMult:1.25,countMult:.9,banRounds:[]},
  {id:'post-feijoada',name:'Pós-Feijoada',description:'Lentos, pesados e com sono.',
    speedMult:.8,hpMult:1.4,countMult:.8,sizeMult:1.15,banRounds:[5]},
  {id:'leaky-roof',name:'Goteira na Sala',description:'Pinga devagar, sem parar.',
    groupSizeMult:.4,cadenceMult:.45,countMult:1.05,banRounds:[6]},
  {id:'bug-spray',name:'Espantalho na Praça',description:'Pombo hoje não.',
    weights:{pombos:0},normalizeThreat:true,banRounds:[6]},
];
export const MODIFIER_FROM_ROUND=3;
export const modifierLabel=(m:RoundModifier)=>`${m.name}: ${m.description}`;

export interface RoundTheme {name:string;modifierId?:string;modifierLabel?:string}
/** Draws the round's absurd name and, from round 3 (not the boss round), a modifier. `used` holds names and modifier ids already drawn this run. */
export function drawTheme(index:number,rng:Rng,used:readonly string[]):RoundTheme{
  const def=ROUNDS[index-1];
  const names=ROUND_NAMES.filter(n=>!used.includes(n));
  const name=def.fixedNames?.length?rng.pick(def.fixedNames):rng.pick(names.length?names:ROUND_NAMES);
  if(index<MODIFIER_FROM_ROUND||def.boss)return {name};
  const pool=MODIFIERS.filter(m=>!m.banRounds.includes(index)&&!used.includes(m.id));
  const mod=rng.pick(pool.length?pool:MODIFIERS.filter(m=>!m.banRounds.includes(index)));
  return {name,modifierId:mod.id,modifierLabel:modifierLabel(mod)};
}

export interface SpawnGroup {
  /** Ticks after the round start. */
  at:number;
  /** Enemy kind per member; a group arrives together at one point (island coast, or off screen in the endless world). */
  members:string[];
  elite?:boolean;boss?:boolean;
  /** Besieges the base (memory.siege); the director may also flag groups through its siegeShare option. */
  siege?:boolean;
  formation?:Formation;
}
export interface RoundPlan {
  index:number;players:number;
  groups:SpawnGroup[];
  /** Regular members plus elite and boss. */
  total:number;
  durationTicks:number;
  /** hp multipliers handed to createEnemy. */
  hp:number;eliteHp:number;
  speed:number;size:number;
  /** Regular rounds retreat on timeout; the boss round does not. */
  retreat:boolean;
  /** Escorts retreat once the boss is gone. */
  boss:boolean;
  /** Angle (radians around the island center) when every group comes from one side. */
  side?:number;
  /** Flip the side every other group. */
  alternate?:boolean;
  /** XP drops laid around the team at the wave start (RoundDef.crumbs). */
  crumbs?:RoundDef['crumbs'];
}

const avgThreat=(w:Partial<Record<RegularKind,number>>)=>{
  let t=0,s=0;for(const k of REGULAR_KINDS){const v=w[k]??0;t+=v*THREAT[k];s+=v;}
  return s>0?t/s:1;
};
function composition(def:RoundDef,mod?:RoundModifier){
  let w:Partial<Record<RegularKind,number>>={...def.weights};
  if(mod?.weights)w={...w,...mod.weights};
  if(mod?.share){
    const pinned=Object.values(mod.share).reduce((a,b)=>a+(b??0),0);
    const rest=REGULAR_KINDS.filter(k=>!(k in mod.share!)).reduce((n,k)=>n+(w[k]??0),0);
    for(const k of REGULAR_KINDS)w[k]=k in mod.share?mod.share[k]:rest>0?(w[k]??0)*(1-pinned)/rest:0;
  }
  if(!REGULAR_KINDS.some(k=>(w[k]??0)>0))w={bebado:1};
  return w;
}
/** Splits `total` by weights with the largest remainder method, so composition is exact. */
function apportion(total:number,w:Partial<Record<RegularKind,number>>){
  const sum=REGULAR_KINDS.reduce((n,k)=>n+(w[k]??0),0);
  const raw=REGULAR_KINDS.map(k=>total*(w[k]??0)/sum),out=raw.map(Math.floor);
  let left=total-out.reduce((a,b)=>a+b,0);
  const order=raw.map((r,i)=>({i,f:r-Math.floor(r)})).sort((a,b)=>b.f-a.f||a.i-b.i);
  for(let j=0;left>0;j++,left--)out[order[j%order.length].i]++;
  return REGULAR_KINDS.map((k,i)=>({kind:k,count:out[i]}));
}

/** Builds the spawn schedule of a round for a player count. Deterministic for the same rng state. */
export function planRound(index:number,players:number,theme:RoundTheme,rng:Rng):RoundPlan{
  const def=ROUNDS[index-1];
  if(!def)throw new Error(`no round ${index}`);
  const mod=theme.modifierId?MODIFIERS.find(m=>m.id===theme.modifierId):undefined;
  const scale=playerScale(players),weights=composition(def,mod);
  let modCount=mod?.countMult??1;
  if(mod?.normalizeThreat)modCount*=Math.max(.4,Math.min(1.6,avgThreat(def.weights)/avgThreat(weights)));
  const raw=Math.round(def.budget*scale.count*modCount);
  const regular=Math.min(raw,MAX_ROUND_ENEMIES);
  // Threat lost to the cap moves partly into hp.
  const hpComp=Math.min(1.3,raw/Math.max(1,regular));
  const groups:SpawnGroup[]=[];
  const formation=mod?.formation??'cluster';
  const groupMult=scale.group*(mod?.groupSizeMult??1);
  const cadence=Math.max(2,def.cadence*(mod?.cadenceMult??1)/scale.group);

  // Swarm groups first (pombos only), then the rest of the budget shuffled into groups.
  const swarmGroups:string[][]=[];
  let left=regular;
  for(const _ of def.swarm?.at??[]){
    const size=Math.min(left,Math.round(rng.int(def.swarm!.size[0],def.swarm!.size[1])*scale.group*Math.min(1,regular/raw*modCount)));
    swarmGroups.push(Array(size).fill('pombos'));left-=size;
  }
  const pool:string[]=[];
  for(const {kind,count} of apportion(left,weights))for(let i=0;i<count;i++)pool.push(kind);
  for(let i=pool.length-1;i>0;i--){const j=rng.int(0,i);[pool[i],pool[j]]=[pool[j],pool[i]];}
  const regularGroups:string[][]=[];
  while(pool.length){
    const size=Math.max(1,Math.round(rng.int(def.group[0],def.group[1])*groupMult));
    regularGroups.push(pool.splice(0,size));
  }
  // Spread groups over the cadence, but finish dispatching by 65% of the round so the team has time to clean up.
  const window=def.maxDuration*.65;
  const step=Math.min(cadence,regularGroups.length>1?window/(regularGroups.length-1):cadence);
  const start=def.boss?def.boss.atSeconds+3:0;
  regularGroups.forEach((members,i)=>groups.push({at:ticks(start+i*step),members,formation}));
  const span=Math.max(1,(regularGroups.length-1)*step);
  def.swarm?.at.forEach((f,i)=>{if(swarmGroups[i]?.length)groups.push({at:ticks(start+f*span),members:swarmGroups[i],formation:'cluster'});});
  if(def.elite)groups.push({at:ticks(start+def.elite.at*span),members:[def.elite.kind],elite:true});
  if(def.boss)groups.push({at:ticks(def.boss.atSeconds),members:['chefe'],boss:true});
  groups.sort((a,b)=>a.at-b.at);

  return {
    index,players:Math.max(1,Math.min(6,Math.round(players))),groups,
    total:groups.reduce((n,g)=>n+g.members.length,0),
    durationTicks:ticks(def.maxDuration),
    hp:def.hpScale*scale.hp*(mod?.hpMult??1)*hpComp,
    eliteHp:def.hpScale*scale.solo*ELITE_HP,
    speed:mod?.speedMult??1,size:mod?.sizeMult??1,
    retreat:!def.boss,boss:!!def.boss,
    side:mod?.singleSide||mod?.alternateSide?rng.range(0,Math.PI*2):undefined,
    ...(mod?.alternateSide?{alternate:true}:{}),
    ...(def.crumbs?{crumbs:def.crumbs}:{}),
  };
}
