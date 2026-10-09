/**
 * Enemy catalog (VGM-031): stats, visual identity and the joke lines of each kind.
 * Stats are base values; createEnemy applies the elite modifier and the director's hp scale.
 */
import type {Point} from '../../world.ts';
import type {EnemyState,SimContext} from '../types.ts';
import {ticks} from '../types.ts';

export type EnemyKind='gosma'|'pernilongo'|'tio-pave'|'fiscal'|'chefe';
/** chase: walks straight; swarm: zig-zag; joker: stops for a joke then charges; ranged: keeps distance and shoots; boss: driven by VGM-038. */
export type EnemyBehavior='chase'|'swarm'|'joker'|'ranged'|'boss';

export interface EnemyLines {
  /** Ambient speech balloons, picked rarely by enemy-ai. */
  barks:readonly string[];
  /** Pop text for the death "poof"; pick with deathLineFor. */
  deathLines:readonly string[];
  /** Lines tied to the kind's funny behavior (hug, buzz, dad joke, fine). */
  reactionLines:readonly string[];
}
export interface EnemyDef extends EnemyLines {
  id:EnemyKind; name:string; behavior:EnemyBehavior;
  /** World units for speed/radius (speed per second), damage per contact hit. */
  hp:number; speed:number; damage:number; radius:number; xp:number;
  /** Ticks between two contact hits from the same enemy. */
  contactCooldown:number;
  /** Pastel body and accent colors (0xRRGGBB) for procedural textures. */
  color:number; accent:number;
}
/** Multipliers applied on top of any kind. */
export interface EliteDef extends EnemyLines {name:string;hp:number;speed:number;damage:number;radius:number;xp:number;accent:number}

export const ENEMY_KINDS=['gosma','pernilongo','tio-pave','fiscal','chefe'] as const satisfies readonly EnemyKind[];

export const ENEMIES:Readonly<Record<EnemyKind,EnemyDef>>=Object.freeze({
  // Gosma hugs more than it hurts: 5 per second of contact (was 8 every 0.8 s, which downed a duo in round 1).
  gosma:{
    id:'gosma',name:'Gosma de Geladeira',behavior:'chase',
    hp:20,speed:1.4,damage:5,radius:.32,xp:1,contactCooldown:ticks(1),color:0x9be37a,accent:0x5fae4a,
    barks:['Me dá um abraço!','Tô grudento de saudade!','Vencido desde 2019!','Sou o pote sem tampa!','Cheiro de pote esquecido!','Vem cá, fofinho!','Eu só quero carinho!','Ninguém me jogou fora!','Gruda, gruda, gruda!'],
    deathLines:['Fui pro ralo!','Me joga no lixo orgânico!','Virei mancha no chão!','Splosh... adeus!','Avisa a mãe que eu mofei!','Volto na próxima faxina!'],
    reactionLines:['Grudei em você!','Agora somos um só!','Não solto mais!','Shlurp!'],
  },
  pernilongo:{
    id:'pernilongo',name:'Pernilongo das 3h',behavior:'swarm',
    hp:6,speed:2.7,damage:4,radius:.2,xp:1,contactCooldown:ticks(.6),color:0xc3bde3,accent:0xe86a7d,
    barks:['Bzzz no seu ouvido!','Acordei você? Ótimo!','Cadê o tapa? Errou!','Sangue sabor delícia!','Chamei a família toda!','Repelente? Nem ligo!','Só uma picadinha!','Ventilador não me pega!'],
    deathLines:['Esmagado na parede!','Morri de raquetada!','Virei pintinha no teto!','Avisa o enxame...','Bzz... bz... b.','Volto às 3 da manhã!'],
    reactionLines:['ZZZzzz!','ZZzz... zZZz!','BZZZZZZ!','Zig! Zag! Bzzz!','zzZZZzz...'],
  },
  'tio-pave':{
    id:'tio-pave',name:'Tio do Pavê',behavior:'joker',
    hp:90,speed:1,damage:14,radius:.48,xp:5,contactCooldown:ticks(1),color:0xf2d3a0,accent:0xa86b3c,
    barks:['É pavê ou pa comê?','Chega mais, sobrinho!','E a faculdade, hein?','Quer ouvir uma boa?','Pera que essa é ótima!','No meu tempo era a pé!','Cresceu, hein, rapaz!','Abraço de tio, vem!'],
    deathLines:['Volto no Natal!','Vou tirar um cochilo...','Me acorda no churrasco!','Essa foi pesada, hein!','Ninguém riu... morri.','Cadê o pavê? Ugh...'],
    reactionLines:['Zero pro oito: belo cinto!','Café perigoso? O ex-preso!','Pato pra pata? Vem quá!','Jacaré na escola? Réptil de ano!','Rei dos queijos? Requeijão!','Tomate no banco? Tirar extrato!','Pimenta no castelo? Do reino!','Peixe que caiu? Aaaaaatum!','Vaca no espaço? Via Láctea!','Cavalo no orelhão? Passa trote!'],
  },
  fiscal:{
    id:'fiscal',name:'Fiscal da Vizinhança',behavior:'ranged',
    hp:30,speed:1.3,damage:6,radius:.3,xp:3,contactCooldown:ticks(1),color:0x9cc3ee,accent:0x2f4f7f,
    barks:['Isso aí tá irregular!','Documento, por favor!','Vou ter que autuar!','Tô de olho, hein!','Cadê o alvará disso?','Anotei sua placa!','Regra é regra, querido!','Bloquinho na mão, viu!'],
    deathLines:['Meu bloquinho, não!','Isso vai pro relatório...','Meu carimbo... sumiu...','Caneta... sem tinta...','Autuado pelo destino!','Volto com reforço fiscal!'],
    reactionLines:['Multa: grama alta demais','Multa: andar feliz','Multa: respirar alto','Multa: chinelo sem par','Multa: sorriso sem alvará','Multa: varal no domingo','Multa: cachorro fofo demais','Multa: excesso de amizade','Multa: pisar na linha','Multa: acordar às 7h'],
  },
  chefe:{
    id:'chefe',name:'Síndico Supremo',behavior:'boss',
    hp:4000,speed:1.1,damage:25,radius:.9,xp:100,contactCooldown:ticks(1),color:0xd9a8e3,accent:0x6b3f7a,
    barks:['Assembleia extraordinária!','Artigo 12 do regimento!','Silêncio após as 22h!','Rateio extra pra todos!','Quem deixou a bike aí?','Isso vai pra ata!','Condomínio subiu de novo!','Piscina fechada, limpeza!','Pauta única: vocês!'],
    deathLines:['Convoco... nova... reunião...','Renuncio ao mandato!','Registra isso em ata!','O porteiro vai saber!','Volto na próxima eleição!','Quórum... insuficiente...'],
    reactionLines:[],
  },
});

export const ELITE:EliteDef=Object.freeze({
  name:'Funcionário do Mês',hp:8,speed:.9,damage:1.5,radius:1.5,xp:10,accent:0xffd25e,
  barks:['Fui promovido, respeita!','Tenho crachá dourado!','Treinei o ano inteiro!','Bati a meta de vocês!','Versão premium, meu bem!','Comi o PF completo!','Hoje eu tô brabo!'],
  deathLines:['Leva o baú, mas chora!','Meu baú... era da firma!','Larguei o espólio, toma!','O tesouro fica, eu vou!','Abre o baú com carinho!'],
  reactionLines:[],
});

/** Hostile "multa" shot of the fiscal. Projectile speed is in world units per second. */
export const FISCAL_SHOT=Object.freeze({source:'multa',speed:4.5,radius:.18,damage:10,life:ticks(3),cooldown:ticks(2.6),aim:ticks(.5),minRange:3.5,maxRange:5.5,fireRange:6.5});
/** Tio do Pavê: stops to tell a joke, then charges and shoves. */
export const TIO_JOKE=Object.freeze({range:2.4,pause:ticks(1.6),charge:ticks(1.2),chargeSpeed:2.6,cooldown:ticks(6),shove:1,bump:.35});

export const isEnemyKind=(value:string):value is EnemyKind=>Object.hasOwn(ENEMIES,value);
export const enemyDef=(kind:string):EnemyDef=>isEnemyKind(kind)?ENEMIES[kind]:ENEMIES.gosma;
export const enemyName=(enemy:Pick<EnemyState,'kind'|'elite'>)=>enemy.elite?`${enemyDef(enemy.kind).name} ${ELITE.name}`:enemyDef(enemy.kind).name;

/** FNV-1a of a string scaled to [0,1). Stable across server and client, consumes no rng. */
export function hashUnit(value:string){let h=0x811c9dc5;for(const c of value)h=Math.imul(h^c.charCodeAt(0),0x01000193);h^=h>>>13;h=Math.imul(h,0x5bd1e995);return ((h^h>>>15)>>>0)/4294967296;}
/** Death line for a kill event; the client can derive it from enemy id and kind without extra bytes. */
export function deathLineFor(enemy:Pick<EnemyState,'id'|'kind'|'elite'>){
  const lines=enemy.elite?ELITE.deathLines:enemyDef(enemy.kind).deathLines;
  return lines[Math.floor(hashUnit(enemy.id)*lines.length)]??'';
}

export interface CreateEnemyOptions {
  /** Applies applyElite after creation. The director (D-010) does not use this: it scales hp itself and sets elite. */
  elite?:boolean;
  /** Ticks before it moves or hits (spawn grace after the warning). */
  readyIn?:number}
/**
 * Creates an enemy of `kind` at `point`, registers it in ctx.enemies and returns it.
 * `scale` multiplies max hp only (player count, elite hp when the director asks for it); speed and radius
 * modifiers are applied by the caller afterwards (D-010).
 */
export function createEnemy(ctx:SimContext,kind:EnemyKind|(string&{}),point:Point,scale=1,options:CreateEnemyOptions={}):EnemyState{
  const def=isEnemyKind(kind)?ENEMIES[kind]:undefined;
  if(!def)throw new Error(`unknown enemy kind: ${kind}`);
  const maxHp=Math.max(1,Math.round(def.hp*(Number.isFinite(scale)&&scale>0?scale:1)));
  const id=ctx.nextId('e');
  const enemy:EnemyState={
    id,kind,x:point.x,y:point.y,hp:maxHp,maxHp,speed:def.speed,damage:def.damage,radius:def.radius,xp:def.xp,
    spawnTick:ctx.tick,readyTick:ctx.tick+Math.max(0,options.readyIn??0),
    memory:{seed:hashUnit(id),state:0,until:0,hitReady:0,actReady:0},
  };
  if(def.behavior==='boss')enemy.boss=true;
  if(options.elite)applyElite(enemy);
  ctx.enemies.set(id,enemy);
  return enemy;
}
/** Explicit elite upgrade with the catalog multipliers (hp, speed, damage, radius, xp). Idempotent. */
export function applyElite(enemy:EnemyState){
  if(enemy.elite)return enemy;
  enemy.elite=true;
  enemy.maxHp=Math.max(1,Math.round(enemy.maxHp*ELITE.hp));enemy.hp=enemy.maxHp;
  enemy.speed*=ELITE.speed;enemy.damage=Math.round(enemy.damage*ELITE.damage);enemy.radius*=ELITE.radius;enemy.xp*=ELITE.xp;
  return enemy;
}
