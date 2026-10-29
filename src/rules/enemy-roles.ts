/**
 * Enemy roles as data (D-040, NEW-20261013-ORQ-papeis-de-inimigo; design/proximos/03-INIMIGOS-0-REGRAS.md §5).
 * Every roster entry (enemy-roster.ts) has one role; the role says which existing enemy-ai behavior drives it, which
 * hand-tuned kind its stats scale from (`base`, also the procedural texture the client draws until the entry has art),
 * the multipliers on that kind's hp, speed, damage, radius and xp, its threat for the director's budget and the
 * generic pt-BR lines an entry falls back to when it has none of its own (P1/P2 entries). Pure data: the sim builds
 * the EnemyDef (sim/enemies/catalog.ts enemyDef), the client reads `base` and the generic copy.
 */

export const ENEMY_ROLES=['corredor','brutamontes','arremessador','atirador','suporte','palhaco','kamikaze','enxame','voador',
  'refletor','invocador','mini-chefe','chefe'] as const;
export type EnemyRole=typeof ENEMY_ROLES[number];
/**
 * Mirrors sim/enemies/catalog.ts EnemyBehavior (rules may not import sim): chase walks straight and hits; stagger is the
 * bêbado's (burp); swarm the pombos' (poop drops); joker the Tio's joke and warned charge; ranged the agiota's shot;
 * thrower the anão's molotov; coach the lecture buff; kamikaze the motoboy's warned charge and blast; poser the
 * influencer's reflecting pose; brute walks, shoves on contact and stomps a telegraphed circle; summoner keeps distance and calls minions with a
 * spawn-warning; minichefe walks, shoves and slams a telegraphed circle; boss is boss.ts.
 */
export type RoleBehavior='chase'|'stagger'|'swarm'|'joker'|'ranged'|'thrower'|'coach'|'kamikaze'|'poser'|'brute'|'summoner'|'minichefe'|'boss';
/** The nine hand-tuned kinds (sim ENEMIES; the client's procedural textures). */
export const LEGACY_KINDS=['bebado','anao-molotov','pombos','tio-pave','agiota','coach','motoboy','influencer','chefe'] as const;
export type LegacyKind=typeof LEGACY_KINDS[number];
export const isLegacyKind=(kind:string):kind is LegacyKind=>(LEGACY_KINDS as readonly string[]).includes(kind);

export interface RoleLines {
  /** Ambient speech balloons (≤ 30 chars). */
  barks:readonly string[];
  /** Death lines (≤ 30 chars), picked by enemy id. */
  deathLines:readonly string[];
  /** Said when the behavior acts (the joke, the aim, the throw, the lecture, the honk, the pose, the call, the slam). */
  reactionLines:readonly string[];
  /** Death pops (ALL CAPS, ≤ 21 chars). */
  pops:readonly string[];
  /** "What got you" line (≤ 40 chars, no consecutive capitals). */
  cause:string;
}
export interface RoleProfile extends RoleLines {
  id:EnemyRole;
  /** pt-BR label. */
  label:string;
  behavior:RoleBehavior;
  /** Hand-tuned kind whose numbers the multipliers scale; the client's fallback texture until art exists. */
  base:LegacyKind;
  /** Multipliers on the base kind's speed, contact damage, radius and xp (the hp is the role's: ROLE_HITS). */
  speed:number;damage:number;radius:number;xp:number;
  /** Default sprite cell of the role (§5); an entry with another cell scales its radius by cell / this. */
  cell:number;
  /** Relative threat per enemy for the director's budget (rules/waves.ts THREAT scale: bêbado = 1). */
  threat:number;
}

const role=(p:RoleProfile)=>Object.freeze({...p,barks:Object.freeze([...p.barks]),deathLines:Object.freeze([...p.deathLines]),
  reactionLines:Object.freeze([...p.reactionLines]),pops:Object.freeze([...p.pops])});

/*
 * Threats follow THREAT (waves.ts) for the roles that are a legacy kind's double, so swapping a kind for a rotation
 * entry of its role keeps the round's threat budget; the new roles: brutamontes (the Tio's body without the joke, a
 * plain shove) a little under the Tio, voador (a sturdier pombo) 0.9, invocador 2.5 (his minions included).
 * Balance (fullrun3, 6 bots, 16 seeds) tunes these multipliers and threats, never single entries.
 */
export const ROLE_PROFILES:Readonly<Record<EnemyRole,RoleProfile>>=Object.freeze({
  // The bêbado's whole behavior (stagger): the zig-zag chase and, from round 2, the warned bafo cone that slows a hero
  // (the 'arroto' telegraph). Without it the rotation's early rounds lost their slows and the run got much easier.
  corredor:role({id:'corredor',label:'Corredor',behavior:'stagger',base:'bebado',speed:1,damage:1,radius:1,xp:1,cell:128,threat:1,
    barks:['Tô de chinelo e te alcanço','Corro mais que boato!','Pernas pra que te quero','Sem freio e sem juízo'],
    deathLines:['Corri pro lado errado...','Tropecei na própria pressa','Cansei. Pra sempre.'],
    reactionLines:['Sente o bafo do esforço!','Hálito de maratona, toma!','Chegou o abraço suado!'],
    pops:['TROPEÇOU!','CAIU DURO!','SEM FÔLEGO!'],cause:'Te alcançaram na corrida'}),
  brutamontes:role({id:'brutamontes',label:'Brutamontes',behavior:'brute',base:'tio-pave',speed:.9,damage:1,radius:1,xp:1,cell:160,threat:2.6,
    barks:['Sai da frente, ô fiapo','Empurrão com carinho. Não.','Peso pesado, juízo leve','Carrego geladeira de costas'],
    deathLines:['Caí que nem armário','Desabei com estilo','Peso morto, finalmente'],
    reactionLines:['EMPURRÃO!','Vai pra lá, ô!','Sai, porra!'],
    pops:['DESABOU!','TOMBOU!','CHÃO RACHOU!'],cause:'Um brutamontes te passou por cima'}),
  arremessador:role({id:'arremessador',label:'Arremessador',behavior:'thrower',base:'anao-molotov',speed:1,damage:1,radius:1,xp:1,cell:128,threat:2,
    barks:['Pega essa, se der!','Braço bom, mira melhor','Lá vai presente!','Tenho mais na mochila'],
    deathLines:['Taquei tudo. Até a dignidade','Acabou a munição...','Errei o último. Em mim.'],
    reactionLines:['Lá vai, lá vai!','Toma de longe!','Pegou? Pegou na cara!'],
    pops:['DEVOLVIDO!','ARREMESSADO!','FIM DO ESTOQUE!'],cause:'Levou um arremesso na testa'}),
  atirador:role({id:'atirador',label:'Atirador',behavior:'ranged',base:'agiota',speed:1,damage:1,radius:1,xp:1,cell:128,threat:1.35,
    barks:['Parado aí que eu miro','Óculos? Atiro melhor sem','Um tiro e tu já era','De longe eu sou valente'],
    deathLines:['Devia ter mirado antes','Fiquei sem mira...','Tiro saiu pela culatra'],
    reactionLines:['Mirando... mirando...','Fica paradinho, vai!','Na mosca, campeão!'],
    pops:['DESMIRADO!','FORA DE ALCANCE!','ALVO ATINGIDO: EU!'],cause:'Tomou um tiro bem mirado'}),
  suporte:role({id:'suporte',label:'Suporte',behavior:'coach',base:'coach',speed:1,damage:1,radius:1,xp:1,cell:128,threat:1.5,
    barks:['Vai, galera! Eu banco!','Força, time do mal!','Tô aqui de apoio moral','Acredita no teu soco!'],
    deathLines:['Apoiei até o fim. O meu.','Fui o último a saber','Apoio encerrado...'],
    reactionLines:['Bora, time! Acelera!','Vocês são lindos! Batam!','Eu acredito em vocês!'],
    pops:['TORCIDA CALOU!','SUPORTE CAIU!','TIME SEM TÉCNICO!'],cause:'A turma dele veio com tudo'}),
  palhaco:role({id:'palhaco',label:'Palhaço',behavior:'joker',base:'tio-pave',speed:1,damage:1,radius:1,xp:1,cell:160,threat:2.8,
    barks:['Sabe a do papagaio?','Pera, pera, essa é boa!','Plateia difícil, hein','Ri agora, apanha depois'],
    deathLines:['Fui vaiado até o caixão','Esqueci o final... e a vida','Plateia morta. E eu.'],
    reactionLines:['Escuta essa, ó!','Atenção pro número!','Intervalo pro meu show!','Pera que tem mais!'],
    pops:['SEM GRAÇA!','FIM DO SHOW!','PIADA MORTA!'],cause:'Parou pra ver o show e apanhou'}),
  kamikaze:role({id:'kamikaze',label:'Kamikaze',behavior:'kamikaze',base:'motoboy',speed:1,damage:1,radius:1,xp:1,cell:160,threat:1.2,
    barks:['Freio? Nunca ouvi falar','Vou em linha reta, sai!','Se bater, foi de propósito','Seguro? Nem de vida.'],
    deathLines:['Bati. Era o plano.','Missão cumprida, eu acho','A curva apareceu do nada'],
    reactionLines:['SAI DA FRENTE, CARALHO!','Lá vou eu, segura!','Três, dois, um... VAI!'],
    pops:['BATEU!','CAPOTOU FEIO!','IDA SEM VOLTA!'],cause:'Passaram por cima, em linha reta'}),
  enxame:role({id:'enxame',label:'Enxame',behavior:'swarm',base:'pombos',speed:1,damage:1,radius:1,xp:1,cell:64,threat:.5,
    barks:['Somos muitos, tu é um','Tá cercado, campeão','Tamanho? Compensa em número','Um morre, vem dez'],
    deathLines:['Fui, mas vem mais','Um a menos... ai','Avisa o bando...'],
    reactionLines:['Presente do bando!','Ataque em grupo!','Cerca! Cerca!'],
    pops:['SOBROU NOVE!','ESMAGADO!','SE FOI!'],cause:'O bando te cercou'}),
  // The flyer is the swarm behavior (it drops things, the poop telegraph), a sturdier and slower pombo. It flies for the
  // towers (D-041, sim/enemies/catalog.ts rosterDef sets EnemyDef.flying: anti-air reaches it, ground fire and the wire
  // pass under it); its movement is unchanged, so it still collides with walls and barricades like any body.
  voador:role({id:'voador',label:'Voador',behavior:'swarm',base:'pombos',speed:.85,damage:1.25,radius:1.5,xp:2,cell:96,threat:.9,
    barks:['Muro? Eu voo, otário','Lá de cima tu é formiga','Bombardeio aéreo liberado','Teu carro lavado? Já era.'],
    deathLines:['Turbulência... das grandes','Pane na asa...','Aterrissei de bico'],
    reactionLines:['Bomba lá de cima!','Lá vai do alto!','Mergulho! MERGULHO!'],
    pops:['ABATIDO!','ASA QUEBRADA!','CAIU DO CÉU!'],cause:'Bombardeado lá de cima'}),
  refletor:role({id:'refletor',label:'Refletor',behavior:'poser',base:'influencer',speed:1,damage:1,radius:1,xp:1,cell:160,threat:2.5,
    barks:['Atira em mim, atira','Minha pose é blindada','Tudo que vai, volta','Reflete e agradece'],
    deathLines:['Minha pose quebrou...','Pose errada, hora errada','Ninguém filmou meu fim'],
    reactionLines:['Pose de escudo!','Devolvido, querido!','Bateu e voltou!'],
    pops:['SAIU DO ÂNGULO!','ESPELHO RACHOU!','SEM REFLEXO!'],cause:'Teu próprio tiro voltou em você'}),
  invocador:role({id:'invocador',label:'Invocador',behavior:'summoner',base:'coach',speed:.95,damage:1,radius:1.1,xp:1.6,cell:160,threat:2.5,
    barks:['Chamei reforço, bobão','Vem, galera! Tem gente aqui!','Nunca venho sozinho','Mais um, mais dois, mais três'],
    deathLines:['Meus amigos me largaram','Chamei, ninguém veio...','Fui o primeiro a ir embora'],
    reactionLines:['Galera, desce todo mundo!','Reforço chegando!','Chega mais, chega mais!'],
    pops:['CONVOCAÇÃO CANCELADA!','SEM REFORÇO!','FIM DA TURMA!'],cause:'A turma que ele chamou te pegou'}),
  // Rounds 5 and 8 (rules/enemy-rotation.ts): the elite-like big body. Radius 0.66 (× 1.35 as the round-5 elite = 0.89)
  // stays under the boss's 0.9, the largest body the enemy-ai neighbor query is sized for.
  'mini-chefe':role({id:'mini-chefe',label:'Mini-chefe',behavior:'minichefe',base:'tio-pave',speed:.85,damage:1.2,radius:1.27,xp:1.5,cell:256,threat:8,
    barks:['Eu sou o chefe dessa rua','Ajoelha que eu piso','Tamanho é documento','Cresci de raiva, só isso'],
    deathLines:['Grande demais pra cair? Não.','Derrubaram o grandão...','Tamanho não salvou'],
    reactionLines:['PANCADA NO CHÃO!','Treme o chão!','Segura essa, formiga!'],
    pops:['CHEFINHO CAIU!','DERRUBADO!','GIGANTE NO CHÃO!'],cause:'O grandão te esmagou'}),
  chefe:role({id:'chefe',label:'Chefe',behavior:'boss',base:'chefe',speed:1,damage:1,radius:1,xp:1,cell:384,threat:0,
    barks:['Eu sou o fim da linha','Tremam. Ou peçam desconto.','Ninguém passa de mim','Última rodada, última dor'],
    deathLines:['Impossível... eu era o chefe','Fim da minha era','Volto na sequência. Juro.'],
    reactionLines:['Fase dois, otários!','Ajoelhem, plebeus!','Chega de brincadeira!'],
    pops:['CHEFE DERRUBADO!','FIM DE REINADO!','CAIU O CHEFÃO!'],cause:'O chefão te esmagou'}),
});

/*
 * Clash-style hp (card NEW-20261024-ORQ-vida-inimigos-estilo-clash, option B approved 24/10): every role has a fixed
 * number of hits of the starting weapon (the faca verde, STARTER_HIT) to die at the start of a ninhos run, solo; every
 * body of the role (the nine hand-tuned kinds and the pack entries) gets the same hp from this table, never a number of
 * its own. No common dies to one hit. The round row and the player count still multiply it (rules/waves.ts).
 * Evidence: evidence/vida-inimigos-clash/proposta.md.
 */
export const ROLE_HITS:Readonly<Record<Exclude<EnemyRole,'chefe'>,number>>=Object.freeze({
  enxame:2,kamikaze:2,corredor:2,voador:3,atirador:3,arremessador:3,suporte:3,invocador:4,refletor:5,palhaco:6,brutamontes:7,
  'mini-chefe':9,
});
/** Damage of one faca verde hit (sim/weapons/arsenal.ts, ARSENAL_DAMAGE included): the unit of ROLE_HITS. */
export const STARTER_HIT=24;
/** Hits taken off the table so the faca's and pistol's better rarities still need the same count (0.35 of a hit). */
export const HIT_MARGIN=.35;
/**
 * Fewer, sturdier bodies: the average body's hp grew ×1.48 with the table, so the waves and the nests' groups bring
 * ×0.7 bodies at 6 players (horde hp ≈ +4 %) and every regular body pays ×1.4 XP (and its drop chance).
 * By team size (ORQ decision B, bench 27/10: ×0.7 flat won 1p 15/16, 3p 16/16): CLASH_BODIES[0] at 1 player (all the
 * bodies, each sturdier) to CLASH_BODIES[1] at 6, linear; clashBodies(n) is the factor of a room of n.
 */
export const CLASH_BODIES=[1,.7] as const,CLASH_XP=1.4;
export const clashBodies=(players:number)=>{const n=Math.max(1,Math.min(6,Math.round(players)||1));return CLASH_BODIES[0]+(CLASH_BODIES[1]-CLASH_BODIES[0])*(n-1)/5;};
/** Base hp of a role (before the round row `startRow`, the ninhos row 1 hp): (hits − margin) × STARTER_HIT / startRow. */
export const roleBaseHp=(role:Exclude<EnemyRole,'chefe'>,startRow:number)=>Math.max(1,Math.round((ROLE_HITS[role]-HIT_MARGIN)*STARTER_HIT/startRow));

/** Role of each hand-tuned kind (the nine keep their own numbers and lines; this is only what they count as). */
export const LEGACY_ROLE:Readonly<Record<LegacyKind,EnemyRole>>=Object.freeze({
  bebado:'corredor','anao-molotov':'arremessador',pombos:'enxame','tio-pave':'palhaco',agiota:'atirador',
  coach:'suporte',motoboy:'kamikaze',influencer:'refletor',chefe:'chefe',
});
export const isEnemyRole=(value:string):value is EnemyRole=>(ENEMY_ROLES as readonly string[]).includes(value);
export const roleProfile=(id:EnemyRole):RoleProfile=>ROLE_PROFILES[id];
