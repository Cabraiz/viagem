/**
 * Round table, player scaling and "zueira" themes for the director (VGM-033). Pure data and functions.
 *
 * Curve (regular enemies per round, no modifier; elite and boss are extra):
 *   round  1   2   3   4   5    6    7    8    9   10
 *   1 P   12  26  32  46  54   76   64   72   82   30 + chefe
 *   6 P   42  91 112 161 189  266  224  252  287  105 + chefe
 * Threat (count x hp x kind weight) climbs 6 -> 246 for one player; round 6 is a fragile swarm breather after the elite.
 * Round 1 teaches (BUG-20261009-N1-round1-letal): few gosmas at half hp, so the starting weapon kills each in one or
 * two hits, arriving slowly enough that walking in circles leaves hp to spare with 1, 2 or 6 players. Rounds 2-3 ramp
 * the hp back (0.8, 1.1) to meet round 4 where it was.
 * Six players get count x3.5 and hp x1.75 (~6x threat for ~6x damage); groups grow and arrive faster by sqrt(count),
 * so a round lasts about the same 40-55 s for 1 or 6 players. Spawns plus ~20 s intermissions add up to ~11 min.
 */
import type {Rng} from './rng.ts';
import {MAX_ENEMIES} from './budget.ts';
import {ticks} from './types.ts';

/** cluster: one point; line: single file at one point; surround: split across up to 4 sides at once. */
export type Formation='cluster'|'line'|'surround';
export type RegularKind='gosma'|'pernilongo'|'tio-pave'|'fiscal';
export const REGULAR_KINDS:readonly RegularKind[]=['gosma','pernilongo','tio-pave','fiscal'];
/** Relative threat per enemy (hp x danger). Placeholder until VGM-031 catalog numbers settle. */
export const THREAT:Readonly<Record<RegularKind,number>>={gosma:1,pernilongo:.5,'tio-pave':2.5,fiscal:1.5};

/** Round 5 (elite tio-pavê with a chest) and round 10 (the boss) draw from their own names. */
export const ELITE_ROUND_NAMES:readonly string[]=[
  'Chegou o Tio do Isopor','Tio da Pochete Chegou','Tio Contando a Mesma Piada','Tio do Pavê Gourmet','Tio Abriu a Cadeira de Praia',
];
export const BOSS_ROUND_NAMES:readonly string[]=[
  'Final de Novela','Assembleia Extraordinária','Advertência Por Escrito','Proibido Bola no Play','O Síndico Quer Falar',
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
  /** Pernilongo-only groups taken from the budget; `at` is a fraction of the spawn window. */
  swarm?:{size:[number,number];at:number[]};
  /** One elite with a chest, outside the budget. */
  elite?:{kind:RegularKind;at:number};
  /** spawnBoss() after atSeconds; the round never times out and escorts retreat when the boss falls. */
  boss?:{atSeconds:number};
  /** Names drawn for this round instead of the shared pool (elite and boss rounds keep their identity). */
  fixedNames?:readonly string[];
}

export const ROUNDS:readonly RoundDef[]=[
  {index:1,budget:12,weights:{gosma:1},group:[2,4],cadence:8,maxDuration:45,hpScale:.5},
  {index:2,budget:26,weights:{gosma:.75,pernilongo:.25},group:[3,5],cadence:5.5,maxDuration:50,hpScale:.8},
  {index:3,budget:32,weights:{gosma:.6,pernilongo:.25,'tio-pave':.15},group:[4,6],cadence:5.5,maxDuration:55,hpScale:1.1},
  {index:4,budget:46,weights:{gosma:.5,pernilongo:.2,'tio-pave':.15,fiscal:.15},group:[5,8],cadence:5.5,maxDuration:60,hpScale:1.35},
  {index:5,budget:54,weights:{gosma:.45,pernilongo:.2,'tio-pave':.2,fiscal:.15},group:[5,8],cadence:5,maxDuration:65,hpScale:1.55,
    elite:{kind:'tio-pave',at:.5},fixedNames:ELITE_ROUND_NAMES},
  {index:6,budget:76,weights:{gosma:.45,pernilongo:.2,'tio-pave':.2,fiscal:.15},group:[6,10],cadence:5,maxDuration:60,hpScale:1.7,
    swarm:{size:[14,18],at:[.3,.7]}},
  {index:7,budget:64,weights:{gosma:.4,pernilongo:.2,'tio-pave':.2,fiscal:.2},group:[6,9],cadence:5,maxDuration:65,hpScale:1.9},
  {index:8,budget:72,weights:{gosma:.35,pernilongo:.2,'tio-pave':.25,fiscal:.2},group:[6,10],cadence:5,maxDuration:70,hpScale:2.1},
  {index:9,budget:82,weights:{gosma:.35,pernilongo:.25,'tio-pave':.2,fiscal:.2},group:[7,11],cadence:5,maxDuration:75,hpScale:2.35},
  {index:10,budget:30,weights:{gosma:.4,pernilongo:.3,'tio-pave':.15,fiscal:.15},group:[4,6],cadence:8,maxDuration:90,hpScale:2.5,
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
  'Round do Boleto Vencido','Segunda-feira Eterna','Fila do Banco','Reunião que Podia Ser um E-mail',
  'Grupo da Família às 6h','Áudio de 7 Minutos','Churrasco Sem Carvão','Wi-Fi da Vizinha',
  'Pão de Queijo Frio','Domingo à Noite','Ônibus Lotado','Leve 3, Pague 3',
  'Rodízio de Gosma','Cadê o Controle?','Feriado que Caiu no Sábado','Café Sem Açúcar',
  'Liquidação de Pernilongo','Visita Surpresa da Tia','Pix Errado','Calor de 40 Graus',
  'Tomada de Três Pinos','Aniversário do Primo','Furadeira do Vizinho','Olha o Carro do Ovo',
  'Dedinho na Quina','Ventilador no Talo','Reunião de Condomínio','Celular com 2%',
  'Esqueci o Guarda-Chuva','Arroz Grudou na Panela','Pote de Sorvete com Feijão','Sexta-feira 17h59',
  'Chinelo Voador','Atualização Obrigatória','Pastel de Vento','Mãe Gritando o Nome Completo',
  // Pack 2 (VGM-055)
  'A Sacola de Sacolas','Só Mais um Episódio','Fone Enrolado no Bolso','Cortina do Box Grudando',
  'Chuveiro Queimou no Banho','Amigo Oculto de 20 Reais','Xepa da Feira','Gato Derrubou o Copo',
  'Toalha Molhada na Cama','Vizinho Gritou Gol Antes','Cadê a Ponta da Fita?','Pisou de Meia no Molhado',
  'Uva-Passa em Tudo','Telemarketing no Domingo','Ensaboado e Sem Água','Micro-ondas Frio no Meio',
  'Sobrou Só Piruá','Biscoito ou Bolacha?','Vó Disse Que Tá Magrinho','Pagou Academia, Nunca Foi',
  'Corre, Roupa no Varal!','Fecha Essa Geladeira!','Panela de Pressão Chiando','Soneca Pela Quinta Vez',
  'Se Eu For Aí e Achar...','Tio Pegou o Microfone','Todo Mundo Fala Xis!','O Bolo Solou',
  'Caramelo Dono da Rua','Brigadeiro Antes do Parabéns',
];
/** Said by one enemy when a timed-out horde gives up and walks back into the sea. */
export const RETREAT_LINES:readonly string[]=[
  'Deu meu horário, fui!','Amanhã a gente volta.','Esqueci o feijão no fogo!','Vou ali e já volto.',
  'Bateu o ponto, tchau!','Minha mãe tá chamando!',
  'Volto depois do comercial!','Ai, a água tá gelada!','Esqueci a carteira em casa!','Isso não tava no combinado!',
  'Vou ali buscar reforço...','Meu carro de app chegou!','Bateu o sono do almoço!','Tá muito sol, vou pra sombra.',
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
/** Drawn from round 3, one per round, never twice in a run, never on the boss round. Each stays within ~0.9-1.15 of the round threat. */
export const MODIFIERS:readonly RoundModifier[]=[
  {id:'uncle-party',name:'Round do Pavê',description:'Só tio. É pavê ou pacumê?',
    weights:{'tio-pave':1},normalizeThreat:true,banRounds:[5,6]},
  {id:'mosquito-swarm',name:'Enxame de Pernilongo',description:'Quem abriu a janela?!',
    share:{pernilongo:.7},normalizeThreat:true,groupSizeMult:1.5,cadenceMult:1.5,banRounds:[6]},
  {id:'giant-everyone',name:'Todo Mundo Gigante',description:'Exageraram no fermento.',
    sizeMult:1.5,hpMult:1.3,countMult:.7,banRounds:[5]},
  {id:'shrunk-in-wash',name:'Encolheu na Lavagem',description:'Lavaram com água quente.',
    sizeMult:.75,hpMult:.8,countMult:1.3,speedMult:1.1,banRounds:[]},
  {id:'lovesick-slimes',name:'Gosmas Apaixonadas',description:'Em fila, de mãozinha dada.',
    share:{gosma:.7},normalizeThreat:true,groupSizeMult:2,cadenceMult:2,formation:'line',banRounds:[6]},
  {id:'taxman-day-off',name:'Fiscal de Folga',description:'Tá na praia de meia e papete.',
    weights:{fiscal:0},normalizeThreat:true,banRounds:[3]},
  {id:'monday-speed',name:'Modo Segunda-feira',description:'Ninguém quer trabalhar.',
    speedMult:.75,countMult:1.15,banRounds:[]},
  {id:'company-trip',name:'Excursão da Firma',description:'Vieram todos na mesma van.',
    singleSide:true,countMult:1.1,groupSizeMult:1.3,cadenceMult:1.3,banRounds:[]},
  {id:'black-friday',name:'Black Friday',description:'Tudo pela metade do dobro.',
    countMult:1.35,hpMult:.75,groupSizeMult:1.35,banRounds:[]},
  {id:'audit-day',name:'Dia de Fiscalização',description:'Cadê o alvará?',
    share:{fiscal:.4},normalizeThreat:true,banRounds:[3,6]},
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
  {id:'bug-spray',name:'Passou Repelente',description:'Pernilongo hoje não.',
    weights:{pernilongo:0},normalizeThreat:true,banRounds:[6]},
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
  /** Enemy kind per member; a group arrives together at one coastal point. */
  members:string[];
  elite?:boolean;boss?:boolean;
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
  if(!REGULAR_KINDS.some(k=>(w[k]??0)>0))w={gosma:1};
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

  // Swarm groups first (pernilongo only), then the rest of the budget shuffled into groups.
  const swarmGroups:string[][]=[];
  let left=regular;
  for(const _ of def.swarm?.at??[]){
    const size=Math.min(left,Math.round(rng.int(def.swarm!.size[0],def.swarm!.size[1])*scale.group*Math.min(1,regular/raw*modCount)));
    swarmGroups.push(Array(size).fill('pernilongo'));left-=size;
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
  };
}
