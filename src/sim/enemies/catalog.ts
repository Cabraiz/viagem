/**
 * Enemy catalog (VGM-031, cast of D-033): stats, visual identity and the joke lines of each kind.
 * Stats are base values; createEnemy applies the elite modifier and the director's hp scale.
 */
import type {Point} from '../../maps/index.ts';
import type {EnemyState} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {ticks} from '../../contract/index.ts';

/** Cast of D-033 (design/arte-v2.md §4). Coach, motoboy and influencer come in a later card. */
export type EnemyKind='bebado'|'anao-molotov'|'pombos'|'tio-pave'|'agiota'|'chefe';
/**
 * stagger: drunk zig-zag chase plus a telegraphed burp cone (bebado); swarm: fast zig-zag plus poop (pombos);
 * joker: stops for a joke then charges (tio-pave); ranged: keeps distance and shoots (agiota);
 * thrower: keeps distance and lobs telegraphed molotovs (anao-molotov); chase: walks straight (siege, generic);
 * boss: driven by VGM-038.
 */
export type EnemyBehavior='chase'|'stagger'|'swarm'|'joker'|'ranged'|'thrower'|'boss';

export interface EnemyLines {
  /** Ambient speech balloons, picked rarely by enemy-ai. */
  barks:readonly string[];
  /** Pop text for the death "poof"; pick with deathLineFor. */
  deathLines:readonly string[];
  /** Lines tied to the kind's funny behavior (burp, molotov, poop, dad joke, boleto). */
  reactionLines:readonly string[];
}
/**
 * Lateral wobble of the walk: direction = toward + perpendicular × sin(tick·freq + seed·2π) × amp. The swarm walks the
 * normalized direction (its speed is its speed); the stagger keeps its speed toward the target and sways on top.
 */
export interface Zigzag {freq:number;amp:number}
export interface EnemyDef extends EnemyLines {
  id:EnemyKind; name:string; behavior:EnemyBehavior;
  /** World units for speed/radius (speed per second), damage per contact hit. */
  hp:number; speed:number; damage:number; radius:number; xp:number;
  /** Ticks between two contact hits from the same enemy. */
  contactCooldown:number;
  /** Pastel body and accent colors (0xRRGGBB) for procedural textures. */
  color:number; accent:number;
  /** Zig-zag walk (stagger and swarm behaviors). */
  zigzag?:Zigzag;
}
/** Multipliers applied on top of any kind. */
export interface EliteDef extends EnemyLines {name:string;hp:number;speed:number;damage:number;radius:number;xp:number;accent:number}

export const ENEMY_KINDS=['bebado','anao-molotov','pombos','tio-pave','agiota','chefe'] as const satisfies readonly EnemyKind[];

/*
 * Lines are the D-033 joke pass (heavy tone, humor-reviewed). Every line is ≤ 30 characters and unique across the
 * catalog (the city's BARK_MAX). The bebado/anão/pombos/agiota reactionLines predate the pass (it wrote none for them).
 */
export const ENEMIES:Readonly<Record<EnemyKind,EnemyDef>>=Object.freeze({
  // VGM-031 basic chaser numbers: hugs more than it hurts, 5 per second of contact (BUG round 1). The drunk wobble sways
  // on top of his walk (ai.ts stagger), so he still closes at 1.4 u/s.
  bebado:{
    id:'bebado',name:'Bêbado do Boteco',behavior:'stagger',
    hp:20,speed:1.4,damage:5,radius:.32,xp:1,contactCooldown:ticks(1),color:0xf0d9a0,accent:0x8a5a2b,
    zigzag:{freq:.18,amp:.3},
    barks:['Eu te amo, cara. Sério. Hic!','Pendura aí que amanhã eu pago','Cê sabe com quem tá falando?','O chão tá vindo me pegar!','Bebi pra esquecer. Cê é quem?','Bêbado não. Tô em modo avião','Segura minha cerveja. BURP!','Pago essa! Cadê minha calça?','Saideira é a penúltima, sabia?','Chama minha ex que eu tô bem'],
    deathLines:['Abracei o poste. Valeu, poste.','Zzz... mãe, hoje não tem aula','Fígado venceu. GG, fígado.','Hoje não bebo mais. Mentira.','Diz pra minha mãe que era suco','Ressaca eterna, desgraça...','Garçom... a conta... no céu...'],
    reactionLines:['BUUUURP!','Saiu o arrotão!','Ops, foi o torresmo.','Sente o buquê: pinga e pastel','Servido? Tem mais de onde veio'],
  },
  // New mid-range thrower: slow, medium hp, keeps MOLOTOV.minRange..maxRange and lobs molotovs; explodes on death.
  'anao-molotov':{
    id:'anao-molotov',name:'Anão do Molotov',behavior:'thrower',
    hp:40,speed:1,damage:6,radius:.28,xp:3,contactCooldown:ticks(1),color:0xe8b48a,accent:0xd0502a,
    barks:['Pedreiro raiz usa molotov','Uma pra mim, uma pro fogo!','Minha barba já pegou fogo 3x','Cachaça boa não se bebe. Taca!','Alguém tem fogo? EU TENHO!','Licença ambiental? Queimei!','Tô calmo! TÔ CALMO, PORRA!','Vizinho reclamou. Ex-vizinho.','Hoje o churrasco é de vocês','Pano, gargalo e fé!'],
    deathLines:['Ih, acendi a cinta errada...','Falei SEGURA, não ACENDE!','Acidente de trabalho, caralho!','Minha barba! MINHA BARBA!','Era pra explodir vocês, desgr—','Pelo menos foi com a cana boa','Perda total. Inclusive eu.'],
    reactionLines:['Lá vai o molotov!','Aquece aí, campeão!','Brinde! Na tua cara!','Arremesso de três!','Quem pediu bem passado?'],
  },
  // VGM-031 swarm numbers: fast and fragile swarm; drops telegraphed poop (POOP).
  pombos:{
    id:'pombos',name:'Pombos do Centro',behavior:'swarm',
    hp:6,speed:2.7,damage:4,radius:.2,xp:1,contactCooldown:ticks(.6),color:0xc4c4d2,accent:0x5d6b7a,
    zigzag:{freq:.45,amp:.9},
    barks:['Cruu. Passa o pão. Cruu.','Estátua nova? Vamos inaugurar','Cagamos no seu carro novo','Comemos lixo e somos felizes','Pombo não paga aluguel, otário','Seu ombro é nosso banheiro','Rato com asa? Respeita, porra','Coxinha caiu? Coxinha é nossa','Sem pão, sem paz. CRUU!'],
    deathLines:['Cruu... volto na estátua...','Virei travesseiro, desgraça','Uma pena. Ou várias. Cruu.','Avisa a praça... cruu...','Morri e ainda caguei em você','Ressuscito no próximo milho'],
    reactionLines:['Bombardeio liberado!','Presente do alto!','Cocô de precisão!','Acertei! Vale 3 pontos, cruu!','Splat! Cruu!'],
  },
  // Heavier than the VGM-031 tio (90 hp, 1 u/s, 14 dmg, 0.48 radius): more hp, size and push (TIO_JOKE shove/bump).
  'tio-pave':{
    id:'tio-pave',name:'Tio do Pavê',behavior:'joker',
    hp:100,speed:.95,damage:13,radius:.52,xp:6,contactCooldown:ticks(1),color:0xf2d3a0,accent:0xa86b3c,
    barks:['Sobrinho, e as namoradinha?','Essa corrente é ouro de praia','Botão de camisa é pra fraco','É pavê ou pa comê? HÁ HÁ HÁ','No meu tempo pavê era arma','Dieta: só carne e cerveja','Sobrinho, tu é CLT ainda?','Pavê é pa vê. Empurrão é pa tu','Peito aberto, coração também!','Viu meu bom dia no grupo?'],
    deathLines:['Engasguei no trocadilho...','Caí no isopor. Gelou o tio.','Morri de rir sozinho. Literal.','Me enterra com o espetinho','Ninguém riu? Nem no velório?','A corrente fica pra tia!','Pavê... pa... morrê...'],
    reactionLines:['Pavê ou porrada? Toma os dois!','Puxa meu dedo, sobrinho. PUXA!','Toc toc. Quem é? EMPURRÃO!','Pa vê se aprende! PÁ!','O que o boleto disse? Venci!','Olha o passarinho... PLAFT!','Ri, porra! A piada era boa!','No peito: ouro e colesterol!'],
  },
  // VGM-031 ranged numbers: ranged; boletos with interest mark the hit player as "devendo" (AGIOTA_SHOT, DEVENDO).
  agiota:{
    id:'agiota',name:'Agiota do Bairro',behavior:'ranged',
    hp:30,speed:1.3,damage:6,radius:.3,xp:3,contactCooldown:ticks(1),color:0xb9d3a0,accent:0x2f3f2f,
    barks:['Juros de 40% ao dia, campeão','Aceito dinheiro, rim ou carro','Eu sei onde tua tia mora','Boleto ou joelho? Escolhe.','Sorria, você tá sendo cobrado','Fiado? Fiado é o caralho','Juros sobre juros é poesia','Quitou? Nunca quita, amigo.','Teu nome tá sujo, meu anjo','Taxa de cobrança: um dente'],
    deathLines:['O boleto... venceu... eu...','Prescreveu! PRESCREVEU!','Perdoo a dívida... MENTIRA','Minha pochete! Meu tudo!','Volto com correção monetária','Cobra no inferno, já tô indo','Me paga no enterro, à vista'],
    reactionLines:['Toma o boleto!','Vence hoje, hein!','Recibo? Te dou um roxo.','Boleto com multa e mora!','Parcelo teus dentes, quer?'],
  },
  chefe:{
    id:'chefe',name:'Síndico Supremo',behavior:'boss',
    hp:4000,speed:1.1,damage:25,radius:.9,xp:100,contactCooldown:ticks(1),color:0xd9a8e3,accent:0x6b3f7a,
    barks:['Quem estacionou na minha alma?','Ata lavrada. Vocês morreram.','Multa por respirar no hall!','Grupo do prédio já tá sabendo!','Barulho após 22h? Pena capital','Assembleia sou eu, porra!','Câmera do elevador viu tudo!','Rateio de caixão pra todos!'],
    deathLines:['Registra em ata: eu morri','Meu mandato! Minhas chaves!','Quem vai cobrar a taxa extra?','Pauta encerrada... pra sempre','Aprovado... por unanimidade...','Volto como fantasma do 302'],
    reactionLines:[],
  },
});

export const ELITE:EliteDef=Object.freeze({
  name:'Funcionário do Mês',hp:8,speed:.9,damage:1.5,radius:1.5,xp:10,accent:0xffd25e,
  barks:['Chefe, olha eu matando eles!','Bati a meta de porrada!','Hora extra? É de graça, amo!','Ganhei um bombom de prêmio!','Vou contar tudo pro RH, hein','Levo notebook pro churrasco!','Puxo saco com as duas mãos','Férias? Nunca tirei. Orgulho!'],
  deathLines:['Morri no expediente. Conta?','Me substituem até segunda...','Fala pro chefe que fui bem!','Leva o baú, eu levo o burnout','Nem ganhei aumento, porra'],
  reactionLines:[],
});

/**
 * Orquestrador rule (BUG-20261012-E6-cidade-velocidades-relativas): no enemy-ai step (walk, zig-zag, approach, back-off,
 * strafe, the Tio's charge; in the city also the crowd's separation push) takes an enemy above ACTION_PEAK_MAX × the walking speed
 * of the heroes of its world, and an action's warning gives the hero time to step out (≥ 0.8 s, MIN_TELEGRAPH_TICKS).
 * Enemy speeds are converted per world (city/speed.ts citySpeed: the city's 1.99 u/s hero vs the endless 3.1; city
 * pombos walk ~1.95 u/s, ~2.17 with a 1.25 round modifier, and the Tio's ×2.6 charge would be ~3.15), so enemy-ai
 * moves at min(speed × pace, heroSpeed × ACTION_PEAK_MAX), slows on top, and in the city (EnemyAiOptions.capPush)
 * clamps the walk plus the push to the same peak. No endless walk or charge reaches it (fastest: pombos 2.7 < 3.565);
 * an endless crowd's push on top still can (left as tuned).
 * The boss (boss.ts) and retreating enemies (director.ts) move outside enemy-ai.
 */
export const ACTION_PEAK_MAX=1.15;
/**
 * Hostile "boleto com juros" of the agiota (source 'boleto-juros', NOT 'boleto', which is a player weapon). Projectile
 * speed is in world units per second; pierce 0 like every hostile shot (D-012). `marks` rides on the projectile (D-002):
 * projectiles.ts collideHostile marks the player it hurts (DEVENDO).
 */
export const AGIOTA_SHOT=Object.freeze({source:'boleto-juros',speed:4.5,radius:.18,damage:7,life:ticks(3),cooldown:ticks(3),aim:ticks(.5),minRange:3.5,maxRange:5.5,fireRange:6.5,marks:'devendo' as const});
/**
 * Tio do Pavê (heavier, D-033): stops to tell a joke, then charges and shoves harder than the VGM-031 tio (1 / 0.35).
 * The joke is the warning (BUG-20261012-E6-cidade-velocidades-relativas): when it starts he locks the charge on the
 * player's position then and draws it as an 'investida' line (0 damage) that lasts the `pause`; the charge runs that
 * line without homing, at `chargeSpeed` × his speed capped by ACTION_PEAK_MAX, so a hero who walks out of it is safe.
 */
export const TIO_JOKE=Object.freeze({range:2.4,pause:ticks(1.6),charge:ticks(1.2),chargeSpeed:2.6,cooldown:ticks(6),shove:1.3,bump:.45});
/**
 * Bêbado's burp: a cone telegraph (apex at him, aimed at the player) when a player stands within `trigger` in front of
 * him (inside half the aperture around his last walking direction). He stands still until it fires; the owner is his
 * id, so it fizzles if he dies first. `chance` per eligible tick, then `cooldown`. Never before round `fromRound`:
 * round 1 teaches the plain chase (BUG-20261009-N1-round1-letal; with the burp a novice standing still fell to 19%).
 * TODO(PHASE B): the burp should also slow the player ("arroto que deixa lento"); that needs a player slow field in the
 * contract (e.g. SimPlayer.slowUntil, read by the players system) — Orquestrador.
 */
export const BURP=Object.freeze({fromRound:2,trigger:2.5,range:2.5,angle:Math.PI/2,delay:ticks(.8),damage:6,cooldown:ticks(5),chance:.1});
/** Floater when the burp slows a hero (D-033). Used when the client/sim wires the event; nothing reads it yet. */
export const BURP_SLOW_LINES:readonly string[]=Object.freeze(['Arrotou na tua cara! Lento!','Bafo de torresmo! Lerdeza!','Hálito de cachaça com ovo','Atordoado pelo arroto do ano','Arroto com eco. Tá zonzo!']);
/**
 * Anão's molotov: keeps minRange..maxRange from the nearest player, aims `aim` ticks, then lobs at the player's
 * current position: a circle telegraph (`radius`, `damage`) landing after `flight`, owned by `env:molotov:<id>` so it
 * lands even if he dies. Each landing schedules the next fire pulse at the same spot (`pulses` of them, `pulseEvery`
 * apart, smaller and weaker): the fire on the ground pulses. At most `maxActive` molotov chains per anão and
 * `maxGlobal` overall, inside the enemies' telegraph budget (MAX_TELEGRAPHS minus the boss reserve, ai.ts).
 * On death he explodes (`death*`): a circle owned by `env:explosion:<id>` that hurts players; enemies inside it when it
 * fires take `deathEnemyDamage` through ctx.damageEnemy (no player credit, weapon 'env:explosion').
 */
export const MOLOTOV=Object.freeze({
  minRange:4,maxRange:6,fireRange:7.5,aim:ticks(.5),flight:ticks(1),radius:.9,damage:9,cooldown:ticks(4.5),retry:ticks(1),
  pulses:3,pulseEvery:ticks(.8),pulseRadius:.75,pulseDamage:3,maxActive:2,maxGlobal:8,
  deathRadius:1.6,deathDamage:15,deathEnemyDamage:30,deathDelay:ticks(.8),
});
/** Floater when a hero steps in the molotov's fire (D-033). Used when the client/sim wires the event; nothing reads it yet. */
export const FIRE_GROUND_LINES:readonly string[]=Object.freeze(['Pisou na cachaça em chamas!','Arde mais que cachaça barata!','Churrasquinho de herói!','Pé no fogo! Dança, porra!','Flambado no álcool do anão']);
/**
 * Pombos' poop: while a player is within `range`, a bird may (`chance` per tick, `cooldown` per bird) drop a small
 * circle telegraph under itself, owned by `env:poop:<id>` (it falls even if the bird dies). At most `maxGlobal` at once.
 * TODO(PHASE B): the slippery puddle ("poça escorregadia") needs a ground effect / player slide field in the contract.
 */
export const POOP=Object.freeze({range:2,chance:.04,cooldown:ticks(4),radius:.5,damage:3,delay:ticks(.8),maxGlobal:6});
/** Floater when a hero slips on the pombos' puddle (D-033). Used when the client/sim wires the event; nothing reads it yet. */
export const PUDDLE_SLIP_LINES:readonly string[]=Object.freeze(['Merda dá sorte. Só que não!','Patinação artística na bosta','Pombo 1 x 0 Você','Caiu de bunda no presente','Isso não é lama. Não é.']);
/**
 * "Devendo" mark of the agiota's boleto: the hit player takes `mult` × damage (before armor, core damagePlayer) while
 * tick < devendoUntil (JSON-safe extra field on SimPlayer, D-002). A fresh mark says one line (D-013 `say`, key `key`,
 * source = the player id) through the enemy-ai limiter.
 */
export const DEVENDO=Object.freeze({ticks:ticks(3),mult:1.15,key:'devendo'});
export const DEVENDO_LINES:readonly string[]=Object.freeze(['DEVENDO! Apanha com juros!','Teu nome tá na pochete dele','Nome no caderninho dele!','Parcelado em 48x de porrada','Nome sujo, corpo frágil']);
/** SimPlayer extras (D-002) of the mark: until when, and 1 while the fresh mark's line is still to be said. */
export interface DevendoPlayer {devendoUntil?:number;devendoSay?:number}
export const isDevendo=(player:object,tick:number)=>tick<((player as DevendoPlayer).devendoUntil??-Infinity);
/** Marks `player` as devendo from `tick`; a player who was not marked gets one line queued for the enemy-ai limiter. */
export function markDevendo(player:object,tick:number){
  const p=player as DevendoPlayer;
  if(!isDevendo(p,tick))p.devendoSay=1;
  p.devendoUntil=tick+DEVENDO.ticks;
}

/** Owner prefixes of the hazards that outlive their thrower (telegraphs.ts `env:` rule). */
export const HAZARD_OWNERS=Object.freeze({molotov:'env:molotov:',explosion:'env:explosion:',poop:'env:poop:'});
const HAZARD_KIND:Readonly<Record<string,EnemyKind>>=Object.freeze({molotov:'anao-molotov',explosion:'anao-molotov',poop:'pombos'});
/** Enemy kind behind a hazard owner (`env:molotov:e7` → 'anao-molotov'), for "what got you" once the thrower is gone. */
export const hazardKind=(owner:string):EnemyKind|undefined=>{const what=owner.startsWith('env:')?owner.split(':')[1]:undefined;return what!==undefined&&Object.hasOwn(HAZARD_KIND,what)?HAZARD_KIND[what]:undefined;};

export const isEnemyKind=(value:string):value is EnemyKind=>Object.hasOwn(ENEMIES,value);
export const enemyDef=(kind:string):EnemyDef=>isEnemyKind(kind)?ENEMIES[kind]:ENEMIES.bebado;
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
