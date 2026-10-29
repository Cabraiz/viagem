/**
 * Enemy catalog (VGM-031, cast of D-033): stats, visual identity and the joke lines of each kind.
 * Stats are base values; createEnemy applies the elite modifier and the director's hp scale.
 */
import type {Point} from '../../maps/index.ts';
import type {EnemyState} from '../../contract/index.ts';
import type {SimContext} from '../context.ts';
import {ticks} from '../../contract/index.ts';
import {CLASH_XP,LEGACY_ROLE,PROJECTILE_SPEED_MULT,ROLE_PROFILES,ROUNDS,roleBaseHp,entryLines,isLegacyKind,isRosterId,rosterEntry,type EnemyRole,type LegacyKind,type RoleBehavior} from '../../rules/index.ts';

/**
 * Any roster id (rules/enemy-roster.ts, D-040): the nine hand-tuned kinds of D-033 and the P1 trio (LegacyKind, their
 * own defs below) and the pack entries, whose defs are their role's profile on the role's base kind (enemyDef).
 * isEnemyKind validates a string against the roster.
 */
export type EnemyKind=string;
export type {LegacyKind};
/**
 * stagger: drunk zig-zag chase plus a telegraphed burp cone (bebado); swarm: fast zig-zag plus poop (pombos);
 * joker: stops for a joke then charges (tio-pave); ranged: keeps distance and shoots (agiota);
 * thrower: keeps distance and lobs telegraphed molotovs (anao-molotov); coach: keeps distance, no melee, lectures and
 * buffs the allies around him (PALESTRA); kamikaze: warned locked charge that ends in a marmita blast (MOTOBOY);
 * poser: slow tank whose pose reflects friendly shots (POSE, REFLECT); chase: walks straight (siege, generic);
 * boss: driven by VGM-038. Roles of the roster (D-040): brute walks and shoves on contact (BRUTE); summoner keeps the
 * coach's distance and calls minions with a spawn-warning (SUMMON); minichefe walks, shoves and slams (SLAM).
 */
export type EnemyBehavior=RoleBehavior;

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
  /** Ranged: the shot's source (AGIOTA_SHOT.source for the agiota, GENERIC_SHOT_SOURCE otherwise) and the mark it leaves. */
  shotSource?:string;
  marks?:'devendo';
  /**
   * Flies (torres-sim): only anti-air defenses (towers/catalog.ts hits 'air' or 'all') reach it; ground shells and
   * the barbed wire pass under it. Movement is unchanged (it still walks the enemy-ai's paths).
   * The pombos and every roster entry of the role 'voador' (rosterDef).
   */
  flying?:true;
}
/** Multipliers applied on top of any kind. */
export interface EliteDef extends EnemyLines {name:string;hp:number;speed:number;damage:number;radius:number;xp:number;accent:number}

/** The nine hand-tuned kinds (rules LEGACY_KINDS, same order). Every other roster id is a role-built def. */
export const ENEMY_KINDS=['bebado','anao-molotov','pombos','tio-pave','agiota','coach','motoboy','influencer','chefe'] as const satisfies readonly LegacyKind[];

/*
 * Lines are the D-033 joke pass (heavy tone, humor-reviewed). Every line is ≤ 30 characters and unique across the
 * catalog (the city's BARK_MAX). The bebado/anão/pombos/agiota reactionLines predate the pass (it wrote none for them).
 */
/** The hp is the role's (rules ROLE_HITS, roleHp below); only the boss keeps its own. */
type TunedDef=Omit<EnemyDef,'hp'>&{hp?:number};
const TUNED:Readonly<Record<LegacyKind,TunedDef>>={
  // VGM-031 basic chaser numbers: hugs more than it hurts, 5 per second of contact (BUG round 1). The drunk wobble sways
  // on top of his walk (ai.ts stagger), so he still closes at 1.4 u/s.
  bebado:{
    id:'bebado',name:'Bêbado do Boteco',behavior:'stagger',
    speed:1.4,damage:5,radius:.32,xp:1,contactCooldown:ticks(1),color:0xf0d9a0,accent:0x8a5a2b,
    zigzag:{freq:.18,amp:.3},
    barks:['Eu te amo, cara. Sério. Hic!','Pendura aí que amanhã eu pago','Cê sabe com quem tá falando?','O chão tá vindo me pegar!','Bebi pra esquecer. Cê é quem?','Bêbado não. Tô em modo avião','Segura minha cerveja. BURP!','Pago essa! Cadê minha calça?','Saideira é a penúltima, sabia?','Chama minha ex que eu tô bem'],
    deathLines:['Abracei o poste. Valeu, poste.','Zzz... mãe, hoje não tem aula','Fígado venceu. GG, fígado.','Hoje não bebo mais. Mentira.','Diz pra minha mãe que era suco','Ressaca eterna, desgraça...','Garçom... a conta... no céu...'],
    reactionLines:['BUUUURP!','Saiu o arrotão!','Ops, foi o torresmo.','Sente o buquê: pinga e pastel','Servido? Tem mais de onde veio'],
  },
  // New mid-range thrower: slow, medium hp, keeps MOLOTOV.minRange..maxRange and lobs molotovs; explodes on death.
  'anao-molotov':{
    id:'anao-molotov',name:'Anão do Molotov',behavior:'thrower',
    speed:1,damage:6,radius:.28,xp:3,contactCooldown:ticks(1),color:0xe8b48a,accent:0xd0502a,
    barks:['Pedreiro raiz usa molotov','Uma pra mim, uma pro fogo!','Minha barba já pegou fogo 3x','Cachaça boa não se bebe. Taca!','Alguém tem fogo? EU TENHO!','Licença ambiental? Queimei!','Tô calmo! TÔ CALMO, PORRA!','Vizinho reclamou. Ex-vizinho.','Hoje o churrasco é de vocês','Pano, gargalo e fé!'],
    deathLines:['Ih, acendi a cinta errada...','Falei SEGURA, não ACENDE!','Acidente de trabalho, caralho!','Minha barba! MINHA BARBA!','Era pra explodir vocês, desgr—','Pelo menos foi com a cana boa','Perda total. Inclusive eu.'],
    reactionLines:['Lá vai o molotov!','Aquece aí, campeão!','Brinde! Na tua cara!','Arremesso de três!','Quem pediu bem passado?'],
  },
  // VGM-031 swarm numbers: fast and fragile swarm; drops telegraphed poop (POOP).
  pombos:{
    id:'pombos',name:'Pombos do Centro',behavior:'swarm',
    speed:2.7,damage:4,radius:.2,xp:1,contactCooldown:ticks(.6),color:0xc4c4d2,accent:0x5d6b7a,
    zigzag:{freq:.45,amp:.9},flying:true,
    barks:['Cruu. Passa o pão. Cruu.','Estátua nova? Vamos inaugurar','Cagamos no seu carro novo','Comemos lixo e somos felizes','Pombo não paga aluguel, otário','Seu ombro é nosso banheiro','Rato com asa? Respeita, porra','Coxinha caiu? Coxinha é nossa','Sem pão, sem paz. CRUU!'],
    deathLines:['Cruu... volto na estátua...','Virei travesseiro, desgraça','Uma pena. Ou várias. Cruu.','Avisa a praça... cruu...','Morri e ainda caguei em você','Ressuscito no próximo milho'],
    reactionLines:['Bombardeio liberado!','Presente do alto!','Cocô de precisão!','Acertei! Vale 3 pontos, cruu!','Splat! Cruu!'],
  },
  // Heavier than the VGM-031 tio (1 u/s, 14 dmg, 0.48 radius): more size and push (TIO_JOKE shove/bump).
  'tio-pave':{
    id:'tio-pave',name:'Tio do Pavê',behavior:'joker',
    speed:.95,damage:13,radius:.52,xp:6,contactCooldown:ticks(1),color:0xf2d3a0,accent:0xa86b3c,
    barks:['Sobrinho, e as namoradinha?','Essa corrente é ouro de praia','Botão de camisa é pra fraco','É pavê ou pa comê? HÁ HÁ HÁ','No meu tempo pavê era arma','Dieta: só carne e cerveja','Sobrinho, tu é CLT ainda?','Pavê é pa vê. Empurrão é pa tu','Peito aberto, coração também!','Viu meu bom dia no grupo?'],
    deathLines:['Engasguei no trocadilho...','Caí no isopor. Gelou o tio.','Morri de rir sozinho. Literal.','Me enterra com o espetinho','Ninguém riu? Nem no velório?','A corrente fica pra tia!','Pavê... pa... morrê...'],
    reactionLines:['Pavê ou porrada? Toma os dois!','Puxa meu dedo, sobrinho. PUXA!','Toc toc. Quem é? EMPURRÃO!','Pa vê se aprende! PÁ!','O que o boleto disse? Venci!','Olha o passarinho... PLAFT!','Ri, porra! A piada era boa!','No peito: ouro e colesterol!'],
  },
  // VGM-031 ranged numbers: ranged; boletos with interest mark the hit player as "devendo" (AGIOTA_SHOT, DEVENDO).
  agiota:{
    id:'agiota',name:'Agiota do Bairro',behavior:'ranged',
    speed:1.3,damage:6,radius:.3,xp:3,contactCooldown:ticks(1),color:0xb9d3a0,accent:0x2f3f2f,shotSource:'boleto-juros',marks:'devendo',
    barks:['Juros de 40% ao dia, campeão','Aceito dinheiro, rim ou carro','Eu sei onde tua tia mora','Boleto ou joelho? Escolhe.','Sorria, você tá sendo cobrado','Fiado? Fiado é o caralho','Juros sobre juros é poesia','Quitou? Nunca quita, amigo.','Teu nome tá sujo, meu anjo','Taxa de cobrança: um dente'],
    deathLines:['O boleto... venceu... eu...','Prescreveu! PRESCREVEU!','Perdoo a dívida... MENTIRA','Minha pochete! Meu tudo!','Volto com correção monetária','Cobra no inferno, já tô indo','Me paga no enterro, à vista'],
    reactionLines:['Toma o boleto!','Vence hoje, hein!','Recibo? Te dou um roxo.','Boleto com multa e mora!','Parcelo teus dentes, quer?'],
  },
  // P1 support (priority target, weapons/system.ts targets()): fragile, keeps PALESTRA.minRange..maxRange from players and
  // never hits in melee (enemy-ai skips his contact; `damage` is only the nominal catalog stat).
  coach:{
    id:'coach',name:'Coach Quântico',behavior:'coach',
    speed:1.25,damage:4,radius:.3,xp:3,contactCooldown:ticks(1),color:0xdfe6f2,accent:0x2a3f8f,
    barks:['Acordo 4h, banho gelado e ódio','Aula grátis. A surra é paga','Fracasso é só sucesso de ré','Quântico porque eu quis, porra','Teu maior inimigo é você. E eu','Morte é só crença limitante','Desenhei tua morte no quadro','Respira. Visualiza. Apanha.','Tua dor é falta de mentoria','Morre, mas morre escalável'],
    deathLines:['Reembolso? Só no outro plano','Não é morte, é pivotar...','Link do curso na lápide','Morri antes do upsell...','Visualizei isso. Não assim.','Gratidão... pela... porrada...','Imersão... a sete palmos...'],
    reactionLines:['Isso foi um feedback!','Toma meu PDF na cara!','Slide 47: tua derrota!','Pancada de alta performance!','Não fui eu, foi a vibração','Escala esse hematoma 10x!'],
  },
  // P1 kamikaze: walks fast-ish, then one warned straight charge at the peak cap (MOTOBOY) that ends in his own blast.
  motoboy:{
    id:'motoboy',name:'Motoboy Kamikaze',behavior:'kamikaze',
    speed:1.6,damage:5,radius:.32,xp:2,contactCooldown:ticks(1),color:0xe2c290,accent:0xc23b2a,
    barks:['Freio é coisa de iniciante','Retrovisor? Arranquei. Pesava','Buzino, logo existo','Sinal vermelho é sugestão','Em 7 minutos ou te atropelo','Tô a 2 min. Desde terça.','Calçada também é avenida','Moto sem escapamento é ASMR','A marmita chega. Eu, talvez','Desce! Tô na porta... de quem?'],
    deathLines:['Avalia cinco estrelas... ai...','Pedido entregue: eu, no poste','Freio fez falta. Quem diria.','Marca como entregue, caralho!','O feijão chegou antes de mim','Me deixa na portaria...','Chegou seu pedido... voando'],
    reactionLines:['Sem contato! Só com a moto!','Assina aqui! No asfalto!','Passei por cima. Foi mal!','Corredor fechado? Abri!','Buzinei, então tá avisado!','Comprovante: tua marca de pneu'],
  },
  // P1 tank: slow and tough; every few seconds he poses (POSE) and reflects the friendly shots that hit him (REFLECT).
  influencer:{
    id:'influencer',name:'Influencer de Academia',behavior:'poser',
    speed:.85,damage:8,radius:.44,xp:5,contactCooldown:ticks(1),color:0xf0c8a8,accent:0xe0407a,
    barks:['Bom dia, família! Tá pago!','Usa meu cupom: SHAPE10','Isso aqui é publi, tá?','Grava meu lado bom. O esquerdo','Perna? Faço semana que vem','Shape não se faz, se posta','Arrasta pra cima que eu bato','Treino em jejum de humildade','Não postei? Então não treinei','Segue lá: @eu_mesmo_monstro'],
    deathLines:['A panturrilha! Para de filmar!','Posta não! POSTA NÃO!','Distendi no meu melhor ângulo','Morri ao vivo. Engajou bem','Chama o fisio! E a ring light!','Chorei sem filtro, caralho...','Edita isso pra parecer pose...'],
    reactionLines:['Corta! Faz de novo pro vídeo!','Essa foi pro story!','Essa doeu? Isso é hipertrofia!','Marca eu nessa porrada!','Sente o pré-treino!','Bati e postei. Rendeu!'],
  },
  chefe:{
    id:'chefe',name:'Síndico Supremo',behavior:'boss',
    hp:4000,speed:1.1,damage:25,radius:.9,xp:100,contactCooldown:ticks(1),color:0xd9a8e3,accent:0x6b3f7a,
    barks:['Quem estacionou na minha alma?','Ata lavrada. Vocês morreram.','Multa por respirar no hall!','Grupo do prédio já tá sabendo!','Barulho após 22h? Pena capital','Assembleia sou eu, porra!','Câmera do elevador viu tudo!','Rateio de caixão pra todos!'],
    deathLines:['Registra em ata: eu morri','Meu mandato! Minhas chaves!','Quem vai cobrar a taxa extra?','Pauta encerrada... pra sempre','Aprovado... por unanimidade...','Volto como fantasma do 302'],
    reactionLines:[],
  },
};
/**
 * Collision/hit radius of every enemy over the tuned numbers above (NEW-20261014-ORQ-balanco-pos-1-7-e-chaveiro, part
 * A): the enemies draw 15 % bigger (render/draw-scale.ts ENEMY_DRAW_SCALE, 66ab092) and their bodies follow the drawing.
 * Applied once here, so the nine kinds, every role-built roster def (rosterDef reads its base kind's radius) and the
 * elites (ELITE.radius multiplies it) grow together; the boss's own tuning (boss.ts BOSS_TUNING) takes it too.
 */
export const ENEMY_RADIUS_SCALE=1.15;
/**
 * Base hp of a role (card NEW-20261024-ORQ-vida-inimigos-estilo-clash): ROLE_HITS of the faca verde at the ninhos run's
 * start row (ROUNDS[0].hpNinhos), solo; the boss role has none (its own hp). Every kind and pack entry of a role shares it.
 */
export const roleHp=(role:EnemyRole,own=1)=>role==='chefe'?own:roleBaseHp(role,ROUNDS[0].hpNinhos??ROUNDS[0].hpScale);
export const ENEMIES:Readonly<Record<LegacyKind,EnemyDef>>=Object.freeze(Object.fromEntries(Object.entries(TUNED).map(([id,def])=>
  [id,{...def,hp:roleHp(LEGACY_ROLE[id as LegacyKind],def.hp),radius:def.radius*ENEMY_RADIUS_SCALE}])) as Record<LegacyKind,EnemyDef>);

export const ELITE:EliteDef=Object.freeze({
  name:'Funcionário do Mês',hp:8,speed:.9,damage:1.5,radius:1.5,xp:10,accent:0xffd25e,
  barks:['Chefe, olha eu matando eles!','Bati a meta de porrada!','Hora extra? É de graça, amo!','Ganhei um bombom de prêmio!','Vou contar tudo pro RH, hein','Levo notebook pro churrasco!','Puxo saco com as duas mãos','Férias? Nunca tirei. Orgulho!'],
  deathLines:['Morri no expediente. Conta?','Me substituem até segunda...','Fala pro chefe que fui bem!','Leva o baú, eu levo o burnout','Nem ganhei aumento, porra'],
  reactionLines:[],
});

/**
 * Orquestrador rule (BUG-20261012-E6-cidade-velocidades-relativas): no enemy-ai step (walk, zig-zag, approach, back-off,
 * strafe, the Tio's charge; in the city also the crowd's separation push) takes an enemy above ACTION_PEAK_MAX × the BASE walking
 * speed of the heroes of its world (maps baseHeroSpeed: the heroes now walk HERO_SPEED_MULT × it, the enemies stay), and an action's warning gives the hero time to step out (≥ 0.8 s, MIN_TELEGRAPH_TICKS).
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
 * projectiles.ts collideHostile marks the player it hurts (DEVENDO). Tuned 4.5 u/s for 3 s, flown through rules
 * PROJECTILE_SPEED_MULT (2.25 u/s for 6 s): the same 13.5 u reach.
 */
export const AGIOTA_SHOT=Object.freeze({source:'boleto-juros',speed:4.5*PROJECTILE_SPEED_MULT,radius:.18,damage:7,life:ticks(3/PROJECTILE_SPEED_MULT),cooldown:ticks(3),aim:ticks(.8),minRange:3.5,maxRange:5.5,fireRange:6.5,marks:'devendo' as const});
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
  deathRadius:1.4,deathDamage:15,deathEnemyDamage:30,deathDelay:ticks(1),
});
/** Floater when a hero steps in the molotov's fire (D-033). Used when the client/sim wires the event; nothing reads it yet. */
export const FIRE_GROUND_LINES:readonly string[]=Object.freeze(['Pisou na cachaça em chamas!','Arde mais que cachaça barata!','Churrasquinho de herói!','Pé no fogo! Dança, porra!','Flambado no álcool do anão']);
/**
 * Pombos' poop: while a player is within `range`, a bird may (`chance` per tick, `cooldown` per bird) drop a small
 * circle telegraph under itself, owned by `env:poop:<id>` (it falls even if the bird dies). At most `maxGlobal` at once.
 * TODO(PHASE B): the slippery puddle ("poça escorregadia") needs a ground effect / player slide field in the contract.
 */
export const POOP=Object.freeze({fromRound:2,range:2,chance:.04,cooldown:ticks(4),radius:.5,damage:3,delay:ticks(.8),maxGlobal:6});
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

/**
 * Coach Quântico's "palestra" (P1): when a player is within `trigger` and his cooldown is over he stops and lectures for
 * `lecture` ticks (EnemyView.phase 1, one PALESTRA_LINES line through the limiter), then every live ally within `radius`
 * (not a coach, not the boss, not retreating) is coached until tick + `duration` (EnemyState extra `coachedUntil`, D-002;
 * EnemyView.phase 2 while coached and not acting). A coached enemy deals `damageMult` × damage at the points where enemy
 * damage is set: contact hits, the agiota's boleto at spawn, enemy hazard telegraphs at spawn (burp, molotov landing,
 * poop, death explosions, the marmita blast) and a reflected shot. A window, not a stack: two coaches only refresh it.
 * Between lectures he keeps minRange..maxRange from the nearest player, like the agiota; he has no melee.
 */
export const PALESTRA=Object.freeze({trigger:7,minRange:4,maxRange:6,lecture:ticks(1.5),cooldown:ticks(6),radius:3.5,duration:ticks(6),damageMult:1.3});
/** Said by the coach when a lecture starts (limiter, key 'coach:palestra'). */
export const PALESTRA_LINES:readonly string[]=Object.freeze(['Repete comigo: EU SOU FODA!','Cada pombo aqui é um CEO!','Herói é só um lead frio!','Bêbado, tu nasceu pra liderar!','Imersão relâmpago: 3 minutos!','Mão no peito e grita: LUCRO!','Tio do Pavê, tu é uma marca!']);
/** Said by one ally the lecture coached, once per lecture, when the limiter allows while the buff lasts (key 'coach:buffed'). */
export const BUFFED_LINES:readonly string[]=Object.freeze(['Eu sou o protagonista, porra!','Acreditei em mim. Que nojo.','Tô vibrando em 5G!','Comprei o método. Tô imortal!','Sai da frente, sou mentorado!','Faturo sete dígitos de ódio']);
/** EnemyState extra (D-002) of the palestra buff. */
export interface CoachedEnemy {coachedUntil?:number}
export const isCoached=(enemy:object,tick:number)=>tick<((enemy as CoachedEnemy).coachedUntil??-Infinity);
/** Damage multiplier of an enemy right now (PALESTRA.damageMult while coached, else 1). */
/**
 * A borrowed entry's band numbers (decision D, rules/enemy-rotation.ts BORROW_TUNE), set by the director in its memory:
 * × every hit it deals (BAND_DAMAGE, through coachMult) and × its attack cooldowns (BAND_CADENCE, bandCooldown).
 */
export const BAND_DAMAGE='bd',BAND_CADENCE='bc';
const bandOf=(enemy:object,key:string)=>{const v=(enemy as {memory?:Record<string,number>}).memory?.[key];return typeof v==='number'&&v>0?v:1;};
/** `cooldown` ticks × the enemy's BAND_CADENCE (whole ticks). */
export const bandCooldown=(enemy:object,cooldown:number)=>Math.round(cooldown*bandOf(enemy,BAND_CADENCE));
/**
 * D-047 Dona Cida sold it a sweet (chaveiro objective): "açucarado" until `sugarUntil` (EnemyState extra, D-002):
 * × SUGAR.damage on every hit it deals (through coachMult) and × SUGAR.speed on its walk (enemy-ai paceSpeed, still
 * within the peak cap). Absent outside the objective.
 */
export const SUGAR=Object.freeze({damage:1.3,speed:1.2,duration:ticks(20)});
export interface SugaredEnemy {sugarUntil?:number}
export const isSugared=(enemy:object,tick:number)=>tick<((enemy as SugaredEnemy).sugarUntil??-Infinity);
/** × the coach's lecture buff, × a borrowed entry's band damage (BAND_DAMAGE), × Dona Cida's sugar: every hostile hit goes through it. */
export const coachMult=(enemy:object,tick:number)=>(isCoached(enemy,tick)?PALESTRA.damageMult:1)*bandOf(enemy,BAND_DAMAGE)*(isSugared(enemy,tick)?SUGAR.damage:1);
/** Kinds the auto-aim of the weapons prefers right after the tapped target (weapons/system.ts targets()): the supports. */
export const isPriorityTarget=(enemy:Pick<EnemyState,'kind'>)=>enemy.kind==='coach'||!isLegacyKind(enemy.kind)&&enemyDef(enemy.kind).behavior==='coach';

/**
 * Motoboy Kamikaze (P1): with a player within `trigger` and a free telegraph slot he honks (MOTOBOY_HONK_LINES, limiter;
 * the line is not required), locks the direction to that player and draws the whole run as an 'investida' line (0 damage)
 * for `aim` ticks while he stands still (EnemyView.phase 1, aiming and charging). Then he runs that line without homing for
 * `charge` ticks at `chargeSpeed` × his speed capped by ACTION_PEAK_MAX × the hero (always the cap: a straight dash at the
 * peak); touching a player then hits for `hitDamage`. The charge ends at its full length, on a player, on an obstacle
 * (blocked) or knocked off the line: he crashes, the bag explodes ('explosao' circle owned by `env:marmita:<id>`,
 * `blastRadius`, `blastDamage`, warned `blastDelay`, players only) and he dies through ctx.damageEnemy with no player
 * credit (XP and loot once). No line (budget full) → no charge (retry after `retry`); no blast outside the wave.
 * inimigos-avisos-justos: `trigger` sits inside the run plus the touch (city ~3.7 + .54 u, endless ~5.7 + .54; at 7 the
 * line stopped short and he never hit), `aim` is the .8 s floor (MIN_TELEGRAPH_TICKS) and the blast's 1 s lets a hero at its centre walk out
 * (1 s × 1.99 u/s ≥ blastRadius + body + .3), like the anão's death blast (MOLOTOV death*) and the agiota's .8 s aim.
 */
export const MOTOBOY=Object.freeze({trigger:4,aim:ticks(.8),charge:ticks(1.6),chargeSpeed:3,hitDamage:12,retry:ticks(1),
  blastRadius:1.4,blastDamage:12,blastDelay:ticks(1)});
export const MOTOBOY_HONK_LINES:readonly string[]=Object.freeze(['BIIIIII! SAI DA FRENTE!','Pedido saindo! ABRE ALAS!','Três... dois... BIIIIII!','GPS mandou passar por você!','Tô vendo a tua porta!','FOM-FOM! Desvia, se puder!']);
/** Said by the motoboy as he crashes (limiter, key 'motoboy:boom'). */
export const MARMITA_BOOM_LINES:readonly string[]=Object.freeze(['Arroz, feijão e estilhaço!','Ovo frito em órbita!','Entregue! Pra rua inteira!','Bife a milhão por hora!','Feijoada de fragmentação']);

/**
 * Influencer de Academia (P1): walks slowly; with a player within `trigger` and his cooldown over he poses for `duration`
 * ticks standing still (EnemyView.phase 1, one POSE_LINES line through the limiter). While posing, a FRIENDLY linear or
 * homing projectile that hits him is reflected (projectiles.ts collideFriendly, isReflecting): it turns hostile (owner =
 * him), its velocity reverses, damage × REFLECT.mult (× his coach buff), pierce 0, hit list reset, and it lives at least
 * REFLECT.minLife more. Orbiters, follow/area zones and the instant cone still hurt him: the counterplay.
 * inimigos-avisos-justos: one pose sends back at most REFLECT.cap damage in all (the shot that crosses it is clipped);
 * then the pose breaks (memory.until = now, enemy-ai walks and starts the cooldown) and the next shots hit him. Each
 * reflection and the break emit a 'pose' event (contract SimEvent) for the client's signal.
 */
export const POSE=Object.freeze({trigger:6,duration:ticks(2),cooldown:ticks(5)});
/**
 * minLife: the tuned 1 s through PROJECTILE_SPEED_MULT (2 s), so a reflected shot flies back as far at its slower speed.
 * cap: reflected damage per pose, all shooters together (6p fed him 10 downs in the audit with no cap).
 */
export const REFLECT=Object.freeze({mult:.6,minLife:ticks(1/PROJECTILE_SPEED_MULT),cap:18});
/** memory.state of the pose (enemies/ai.ts STATE.pose). */
export const POSE_STATE=6;
export const POSE_LINES:readonly string[]=Object.freeze(['Ninguém atira! Tô gravando!','Pera, achei a luz boa!','Pose de bíceps: modo escudo!','Contrai o abdômen! Sorri!','Mais uma! Agora de perfil!','Para tudo: hora do pump!']);
/** Said by the influencer after a reflection (the projectile system flags memory.reflectSay; enemy-ai says it). */
export const REFLECT_LINES:readonly string[]=Object.freeze(['Bateu no shape e voltou!','Devolvido com filtro!','Teu tiro saiu no meu story!','Rebatido! Me marca, hein!','Volta pro remetente, monstro!']);

/** Source of the hostile shot of an atirador that is not the agiota: the generic star (no devendo mark). */
export const GENERIC_SHOT_SOURCE='tiro';
/** Brutamontes (D-040): walks straight; every contact hit also shoves the player `shove` units away (the Tio's push, no joke). */
export const BRUTE=Object.freeze({shove:.9});
/**
 * Invocador (D-040): keeps minRange..maxRange like the coach and never hits in melee. With a player within `trigger`, his
 * cooldown over and room (fewer than `maxGlobal` summoned minions alive, enemy cap) he stops and calls `count` minions:
 * each spot (`radius` around him, walkable, ≥ `safe` from every player) gets a 'spawn-warning' and the minion appears
 * `warn` ticks later (EnemyView.phase 1 meanwhile), unless a player stands on it; killed first, nobody comes. Minions are
 * the round's corredores and enxames (EnemyAiOptions.minionKinds), at `hp` × the round's hp, flagged memory.minion.
 */
export const SUMMON=Object.freeze({trigger:7,minRange:4,maxRange:6,warn:ticks(1.5),cooldown:ticks(10),retry:ticks(2),
  count:[2,3] as const,radius:1.6,safe:1.2,maxGlobal:12,hp:.5,readyIn:ticks(.4)});
/** memory.state of the call (enemies/ai.ts STATE.summon). */
export const SUMMON_STATE=7;
/**
 * Mini-chefe (D-040, rounds 5 and 8): a big body that walks and shoves like the brutamontes and, with a player within
 * `trigger`, stomps: a circle around himself (`radius` + his own) warned `delay` ticks ('pancada', owned by him: it
 * fizzles if he dies), standing still until `recover` after it lands, then `cooldown` before the next.
 */
export const SLAM=Object.freeze({trigger:2.6,radius:1.6,damage:16,delay:ticks(1.2),recover:ticks(.4),cooldown:ticks(5)});
export const SLAM_STATE=8;
/**
 * True while `enemy` is a live influencer in his pose (reflects friendly shots). A retreating one (D-010, memory.retreat)
 * never reflects: retreaters deal no damage, and enemy-ai also drops his pose when the retreat starts.
 */
export const isReflecting=(enemy:EnemyState,tick:number)=>enemy.memory?.state===POSE_STATE&&enemy.hp>0&&enemy.memory.retreat!==1
  &&tick<(enemy.memory.until??-Infinity)&&enemyDef(enemy.kind).behavior==='poser';

/** Owner prefixes of the hazards that outlive their thrower (telegraphs.ts `env:` rule). */
export const HAZARD_OWNERS=Object.freeze({molotov:'env:molotov:',explosion:'env:explosion:',poop:'env:poop:',marmita:'env:marmita:'});
const HAZARD_KIND:Readonly<Record<string,LegacyKind>>=Object.freeze({molotov:'anao-molotov',explosion:'anao-molotov',poop:'pombos',marmita:'motoboy'});
/**
 * Owner of a hazard `enemy` leaves behind: `<prefix><id>` for the nine (as before), `<prefix><id>@<kind>` for a roster
 * entry that borrows their behavior, so the fall still names who threw it once the thrower is gone (hazardKind).
 */
export const hazardOwner=(prefix:string,enemy:Pick<EnemyState,'id'|'kind'>)=>isLegacyKind(enemy.kind)?prefix+enemy.id:`${prefix}${enemy.id}@${enemy.kind}`;
/**
 * Enemy kind behind a hazard owner (`env:molotov:e7` → 'anao-molotov', `env:poop:e3@barata-voadora` → 'barata-voadora'),
 * for "what got you" once the thrower is gone.
 */
export const hazardKind=(owner:string):EnemyKind|undefined=>{
  if(!owner.startsWith('env:'))return undefined;
  const what=owner.split(':')[1],at=owner.lastIndexOf('@'),kind=at>=0?owner.slice(at+1):undefined;
  if(kind!==undefined&&isRosterId(kind))return kind;
  return what!==undefined&&Object.hasOwn(HAZARD_KIND,what)?HAZARD_KIND[what]:undefined;
};

/** A roster id (the nine and the pack entries). */
export const isEnemyKind=(value:string):value is EnemyKind=>isRosterId(value);
const ROSTER_DEFS=new Map<string,EnemyDef>();
/**
 * Def of a pack entry: its role's hp (roleHp) and profile on the role's base kind (speed, damage, radius × cell / role cell, xp;
 * contact cooldown, zig-zag of a swarm), the entry's name and accent, and its lines (own or the role's, entryLines).
 */
function rosterDef(kind:string):EnemyDef|undefined{
  const cached=ROSTER_DEFS.get(kind);if(cached)return cached;
  const entry=rosterEntry(kind),lines=entryLines(kind);
  if(!entry||!lines)return undefined;
  const role=ROLE_PROFILES[entry.role],base=ENEMIES[role.base];
  const def:EnemyDef=Object.freeze({
    id:entry.id,name:entry.name,behavior:role.behavior,
    hp:roleHp(entry.role,base.hp),speed:base.speed*role.speed,damage:Math.max(1,Math.round(base.damage*role.damage)),
    radius:base.radius*role.radius*entry.cell/role.cell,xp:Math.max(1,Math.round(base.xp*role.xp)),
    contactCooldown:base.contactCooldown,color:base.color,accent:entry.accent,
    // The swarm's and the stagger's walk sway like their base's (pombos, bêbado).
    ...((role.behavior==='swarm'||role.behavior==='stagger')&&base.zigzag?{zigzag:base.zigzag}:{}),
    ...(role.behavior==='ranged'?{shotSource:GENERIC_SHOT_SOURCE}:{}),
    // D-041: flying is per entry (RosterEntry.flying: every voador, the aerial swarms, the bodies whose concept flies):
    // anti-air reaches it, ground fire and the wire pass under; it still walks like its role.
    ...(entry.flying?{flying:true as const}:{}),
    barks:lines.barks,deathLines:lines.deathLines,reactionLines:lines.reactionLines,
  });
  ROSTER_DEFS.set(kind,def);
  return def;
}
/** Def of any roster id (the nine hand-tuned, the rest built from their role); an unknown kind reads as the bêbado. */
export const enemyDef=(kind:string):EnemyDef=>(Object.hasOwn(ENEMIES,kind)?ENEMIES[kind as LegacyKind]:undefined)??rosterDef(kind)??ENEMIES.bebado;
/**
 * Flying enemy (EnemyDef.flying: the pombos and the roster entries with RosterEntry.flying): what anti-air reaches and ground fire does not
 * (torres-sim).
 */
export const isFlying=(enemy:Pick<EnemyState,'kind'>)=>enemyDef(enemy.kind).flying===true;
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
export function createEnemy(ctx:SimContext,kind:EnemyKind,point:Point,scale=1,options:CreateEnemyOptions={}):EnemyState{
  const def=isLegacyKind(kind)?ENEMIES[kind]:rosterDef(kind);
  if(!def)throw new Error(`unknown enemy kind: ${kind}`);
  const maxHp=Math.max(1,Math.round(def.hp*(Number.isFinite(scale)&&scale>0?scale:1)));
  const id=ctx.nextId('e');
  const enemy:EnemyState={
    id,kind,x:point.x,y:point.y,hp:maxHp,maxHp,speed:def.speed,damage:def.damage,radius:def.radius,
    // Fewer, sturdier bodies (rules CLASH_XP, card vida-inimigos-estilo-clash): every body pays ×1.4 its def's XP.
    xp:def.xp*CLASH_XP,
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
