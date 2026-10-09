/**
 * Weapon and evolution catalog (VGM-035). Pure data plus lookups; the `weapons` system reads it.
 * Numbers are per level BEFORE player stats. Damage is base damage: `ctx.damageEnemy` applies might.
 */
import type {ItemDef,PlayerStats} from '../types.ts';
import {SIM_HZ} from '../types.ts';

export const WEAPON_IDS=['chinelo','boleto','cafe','guarda-chuva','pombo','audio'] as const;
export const EVOLUTION_IDS=['chinelo-evo','boleto-evo','cafe-evo'] as const;
export type WeaponId=typeof WEAPON_IDS[number]|typeof EVOLUTION_IDS[number];

/**
 * orbit: projectiles circle the owner for `duration`, then rest for `cooldown`.
 * pierce: straight projectiles aimed at the target or along `facing`.
 * zone: ground puddles on enemies (or, evolved, following the owner).
 * shield: aura around the owner that blocks hostile projectiles and pushes enemies.
 * homing: projectiles that steer toward an enemy.
 * cone: instant wave in front of the owner (`facing`), extra amount adds directions.
 */
export type WeaponPattern='orbit'|'pierce'|'zone'|'shield'|'homing'|'cone';

export interface WeaponLevel {
  /** Base damage per hit (might is applied by damageEnemy). */
  damage:number;
  /** Seconds between volleys (orbit/shield/zone: rest after duration ends). */
  cooldown:number;
  /** Projectiles, puddles, orbiters or cone directions per volley. */
  amount:number;
  /** Radius in world units: projectile/puddle/aura radius, cone length, orbit distance for orbit. */
  area:number;
  /** Units per second for moving projectiles; radians per second for orbit. */
  speed:number;
  /** Seconds a projectile, orbiter, puddle or aura lives. */
  duration:number;
  /** Extra enemies a projectile passes through after its first hit (PIERCE_INFINITE = no limit). */
  pierce:number;
  /** Push distance applied to non-boss enemies on hit. */
  knockback:number;
  /** Seconds before the same area/orbit/aura can hit the same enemy again. */
  hitInterval:number;
  /** Acquisition range in world units (targeted weapons ignore enemies beyond it). */
  range:number;
}

export interface WeaponDef extends ItemDef {
  kind:'weapon'|'evolution';
  pattern:WeaponPattern;
  /** Index 0 is level 1; length equals maxLevel. */
  levels:readonly WeaponLevel[];
  /** Evolutions: base weapon (at max level) and required passive. */
  base?:string; passive?:string;
  /** Joke line for offers/barks; the laugh moment of this card. */
  quip:string;
  /** Cone half-angle in radians (cone pattern only). */
  coneHalfAngle?:number;
  /** Evolution-only behavior switches read by the systems. */
  evolved?:{flingOnCycle?:boolean;returns?:boolean;followsOwner?:boolean;slowSeconds?:number};
}

export const PIERCE_INFINITE=1_000_000;

/** Upper bound on volley size after stats, so a stacked build cannot flood the projectile cap alone. */
export const MAX_AMOUNT=10;
/** Lowest cooldown any weapon can reach after stats, in ticks. */
export const MIN_COOLDOWN_TICKS=4;

// ---- Tables (filled by the balance pass). Keep values monotonic non-decreasing in power per level. ----

const lv=(damage:number,cooldown:number,amount:number,area:number,speed:number,duration:number,pierce:number,knockback:number,hitInterval:number,range:number):WeaponLevel=>
  ({damage,cooldown,amount,area,speed,duration,pierce,knockback,hitInterval,range});

const INF=PIERCE_INFINITE;

/** pt-BR number: at most 2 decimals, comma separator. */
const num=(x:number)=>String(Number(x.toFixed(2))).replace('.',',');
/** Percent growth from a to b, at least 1 so a real change never reads as "+0%". */
const pct=(a:number,b:number)=>Math.max(1,Math.round(Math.abs(b/a-1)*100));

/** Up to 3 offer bullets for the step prev -> next, most impactful first. */
function levelDiff(prev:WeaponLevel,next:WeaponLevel,pattern:WeaponPattern,unit:readonly [string,string]):string[]{
  const out:string[]=[];
  const d=(k:keyof WeaponLevel)=>next[k]-prev[k];
  if(d('amount')>0) out.push(`+${d('amount')} ${d('amount')===1?unit[0]:unit[1]}`);
  if(d('damage')>0) out.push(`Dano +${num(d('damage'))}`);
  if(d('pierce')>0) out.push(next.pierce>=INF?'Atravessa tudo':`Atravessa +${d('pierce')}`);
  if(d('cooldown')<0) out.push(`Recarga -${pct(prev.cooldown,next.cooldown)}%`);
  if(d('area')>0) out.push(`Área +${pct(prev.area,next.area)}%`);
  if(d('duration')>0) out.push(`Duração +${num(d('duration'))} s`);
  if(d('speed')>0) out.push(`Velocidade +${pct(prev.speed,next.speed)}%`);
  if(d('hitInterval')<0) out.push(`Acerta ${pct(prev.hitInterval,next.hitInterval)}% mais rápido`);
  if(d('knockback')>0) out.push(prev.knockback>0?`Empurrão +${pct(prev.knockback,next.knockback)}%`:'Agora empurra');
  // Cone range mirrors its area, so it would repeat the same bullet.
  if(d('range')>0&&pattern!=='cone') out.push(`Alcance +${pct(prev.range,next.range)}%`);
  return out.slice(0,3);
}

/** Attaches `describe`: level 1 (or below) is the pitch, later levels list the table diff. */
function withDescribe(def:Omit<WeaponDef,'describe'>,intro:string,unit:readonly [string,string]):WeaponDef{
  return {...def,describe(level:number){
    const l=Math.floor(level)||1;
    if(l<=1) return intro;
    if(l>def.maxLevel) return `${def.name} já está no máximo. Mais que isso é exagero.`;
    const lines=levelDiff(def.levels[l-2],def.levels[l-1],def.pattern,unit);
    return lines.length?lines.join(', '):'Melhora geral (confia)';
  }};
}

const defs:WeaponDef[]=[
  withDescribe({
    id:'chinelo',kind:'weapon',name:'Chinelo da Mãe',icon:'chinelo',maxLevel:8,pattern:'orbit',
    quip:'Volta sempre. Igual mãe.',
    levels:[
      //  dmg cd  amt area spd  dur pierce kb  hit range
      lv(10,2.5,2,1.6,3.2,3,INF,.3,.5,0),
      lv(12,2.5,2,1.6,3.2,3,INF,.3,.5,0),
      lv(12,2.5,2,1.8,3.6,3,INF,.3,.5,0),
      lv(12,2.5,3,1.8,3.6,3,INF,.3,.5,0),
      lv(14,2.5,3,1.8,3.6,3.5,INF,.3,.5,0),
      lv(14,2.2,3,1.9,3.8,3.5,INF,.35,.5,0),
      lv(14,2.2,4,1.9,3.8,3.5,INF,.35,.5,0),
      lv(16,2,4,2,4.2,4,INF,.4,.5,0),
    ],
  },'Chinelos giram em volta de você. Bicho que encostar leva a chinelada que você levou na infância.',['chinelo','chinelos']),
  withDescribe({
    id:'boleto',kind:'weapon',name:'Boleto Vencido',icon:'boleto',maxLevel:8,pattern:'pierce',
    quip:'Venceu ontem. Os juros chegam hoje.',
    levels:[
      lv(14,1.3,1,.25,9,1.2,0,.2,.5,7),
      lv(14,1.3,1,.25,10,1.3,1,.2,.5,7),
      lv(17,1.3,1,.27,10,1.3,1,.2,.5,7.5),
      lv(17,1.3,2,.27,10,1.3,1,.2,.5,7.5),
      lv(17,1.2,2,.3,11,1.4,2,.25,.5,8),
      lv(20,1.2,2,.32,11,1.4,3,.25,.5,8),
      lv(20,1.1,2,.35,12,1.5,3,.25,.5,8.5),
      lv(22,1.1,2,.38,13,1.6,4,.3,.5,9),
    ],
  },'Arremessa boletos em linha reta que atravessam a fila de bichos. Ninguém quer pagar.',['boleto','boletos']),
  withDescribe({
    id:'cafe',kind:'weapon',name:'Café Derramado',icon:'cafe',maxLevel:8,pattern:'zone',
    quip:'Cuidado que tá quente!',
    levels:[
      lv(10,3,1,1,0,2,INF,0,.5,6),
      lv(10,3,1,1.2,0,2.5,INF,0,.5,6),
      lv(12,3,1,1.2,0,2.5,INF,0,.5,6.5),
      lv(12,3,2,1.3,0,2.5,INF,0,.5,6.5),
      lv(12,2.7,2,1.4,0,3,INF,0,.5,7),
      lv(14,2.7,2,1.4,0,3,INF,0,.5,7),
      lv(14,2.5,2,1.5,0,3,INF,0,.5,7.5),
      lv(15,2.5,2,1.7,0,3,INF,0,.5,8),
    ],
  },'Derrama café quente no chão onde tem bicho. Queima, mancha e ninguém limpa.',['poça','poças']),
  withDescribe({
    id:'guarda-chuva',kind:'weapon',name:'Guarda-chuva da Vó',icon:'guarda-chuva',maxLevel:8,pattern:'shield',
    quip:'Leva o casaco também, menino!',
    levels:[
      lv(5,3,1,.9,0,2.5,INF,.6,.6,0),
      lv(5,3,1,1,0,2.5,INF,.7,.6,0),
      lv(7,3,1,1,0,2.5,INF,.7,.6,0),
      lv(7,2.7,1,1.1,0,3,INF,.8,.6,0),
      lv(8,2.7,1,1.2,0,3,INF,.9,.6,0),
      lv(9,2.4,1,1.3,0,3.5,INF,1,.6,0),
      lv(10,2.2,1,1.4,0,3.5,INF,1.1,.6,0),
      lv(11,2,1,1.6,0,4,INF,1.2,.6,0),
    ],
  },'Abre o guarda-chuva da vó: bloqueia tiro de bicho e empurra quem chegar perto.',['guarda-chuva','guarda-chuvas']),
  withDescribe({
    id:'pombo',kind:'weapon',name:'Pombo da Praça',icon:'pombo',maxLevel:8,pattern:'homing',
    quip:'Não sabe pra onde vai, mas vai com fé.',
    levels:[
      lv(12,1.6,1,.25,5,3,0,.2,.5,8),
      lv(12,1.6,2,.25,5,3,0,.2,.5,8),
      lv(12,1.6,2,.27,5.5,3,1,.2,.5,8.5),
      lv(13,1.6,2,.27,5.5,3,1,.2,.5,8.5),
      lv(13,1.5,2,.3,6,3,1,.2,.5,9),
      lv(13,1.5,3,.3,6,3,1,.2,.5,9),
      lv(14,1.5,3,.32,6.5,3,2,.25,.5,9.5),
      lv(15,1.5,3,.35,7,3,2,.3,.5,10),
    ],
  },'Pombos perseguem o bicho mais perto. Ninguém sabe de onde eles vêm.',['pombo','pombos']),
  withDescribe({
    id:'audio',kind:'weapon',name:'Áudio de 5 Minutos',icon:'audio',maxLevel:8,pattern:'cone',
    quip:'"Oi, sumido... então, deixa eu te contar..."',
    coneHalfAngle:.6,
    levels:[
      lv(10,2,1,2,0,.2,INF,.4,.2,2),
      lv(10,2,1,2.3,0,.2,INF,.4,.2,2.3),
      lv(12,2,1,2.3,0,.2,INF,.4,.2,2.3),
      lv(12,2,2,2.5,0,.2,INF,.4,.2,2.5),
      lv(12,1.9,2,2.7,0,.2,INF,.4,.2,2.7),
      lv(12,1.9,2,3,0,.2,INF,.5,.2,3),
      lv(12,1.8,2,3.2,0,.2,INF,.5,.2,3.2),
      lv(12,1.8,3,3.5,0,.2,INF,.6,.2,3.5),
    ],
  },'Manda um áudio de 5 minutos na sua frente. Todo bicho no caminho escuta tudo.',['direção','direções']),
  withDescribe({
    id:'chinelo-evo',kind:'evolution',name:'Havaianas do Caos',icon:'chinelo-evo',maxLevel:1,pattern:'orbit',
    base:'chinelo',passive:'tenis',evolved:{flingOnCycle:true},
    quip:'Todo mundo usa. Todo mundo apanha.',
    levels:[lv(20,1.5,5,2.2,4.6,4,INF,.8,.45,0)],
  },'Evolução! Cinco chinelos em órbita e, a cada giro novo, mais cinco voando longe.',['chinelo','chinelos']),
  withDescribe({
    id:'boleto-evo',kind:'evolution',name:'Carnê Infinito',icon:'boleto-evo',maxLevel:1,pattern:'pierce',
    base:'boleto',passive:'cartao',evolved:{returns:true},
    quip:'A parcela volta todo mês.',
    // Duration is the outbound leg; the system doubles it for the return trip.
    levels:[lv(26,.9,3,.4,13,1,INF,.3,.5,9)],
  },'Evolução! Carnês que atravessam tudo e voltam que nem bumerangue. Igual parcela.',['carnê','carnês']),
  withDescribe({
    id:'cafe-evo',kind:'evolution',name:'Cafeteira Industrial',icon:'cafe-evo',maxLevel:1,pattern:'zone',
    base:'cafe',passive:'cafe-forte',evolved:{followsOwner:true,slowSeconds:1},
    quip:'Expresso, coado e na cara.',
    levels:[lv(25,.5,1,2.2,0,4,INF,0,.4,8)],
  },'Evolução! Uma poça gigante de café te segue e deixa os bichos grudados no chão melado.',['poça','poças']),
];

export const WEAPON_CATALOG:ReadonlyMap<string,WeaponDef>=new Map(defs.map(d=>[d.id,d]));

export function getWeapon(id:string):WeaponDef|undefined{return WEAPON_CATALOG.get(id);}
/** Catalog shape expected by offers (VGM-034): `{get(id), all()}`. */
export const weaponCatalog={get:getWeapon,all:():WeaponDef[]=>[...WEAPON_CATALOG.values()]};

/** Level row clamped to 1..maxLevel. */
export function weaponLevel(def:WeaponDef,level:number):WeaponLevel{
  const i=Math.max(1,Math.min(def.maxLevel,Math.floor(level)||1))-1;
  return def.levels[i];
}

/** Weapon numbers after player stats, in ticks and world units. Damage still excludes might. */
export interface ResolvedWeapon {
  def:WeaponDef; level:number;
  damage:number; cooldownTicks:number; amount:number; area:number; speed:number;
  durationTicks:number; pierce:number; knockback:number; rehitTicks:number; range:number;
}

export function resolveWeapon(def:WeaponDef,level:number,stats:PlayerStats):ResolvedWeapon{
  const row=weaponLevel(def,level);
  const t=(s:number)=>Math.round(s*SIM_HZ);
  return {
    def,level:Math.max(1,Math.min(def.maxLevel,Math.floor(level)||1)),
    damage:row.damage,
    cooldownTicks:Math.max(MIN_COOLDOWN_TICKS,t(row.cooldown*stats.cooldown)),
    amount:Math.max(1,Math.min(MAX_AMOUNT,Math.round(row.amount+stats.amount))),
    area:Math.max(0,row.area*stats.area),
    speed:row.speed*stats.speed,
    durationTicks:Math.max(1,t(row.duration*stats.duration)),
    pierce:row.pierce,
    knockback:row.knockback,
    rehitTicks:Math.max(1,t(row.hitInterval)),
    // Range grows with area so bigger builds also reach farther.
    range:row.range*Math.max(1,stats.area),
  };
}
