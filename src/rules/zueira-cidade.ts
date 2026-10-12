/**
 * "Zueira" of the Cidade Nevada (D-026): round names, city round modifiers and the snow/cold lines of enemies, the forge,
 * the horn and the crashed vehicle at the start. Pure data, pt-BR content (no mention of the map this layout came from).
 *
 * City layout (D-026): the fountain plaza is the Stonewards base (wall, 4 barricades on the plaza mouths, forge); the far
 * ends of the 4 avenues (Norte, Sul, Leste, Oeste) are the telegraphed spawns; the crashed vehicle in the south is the
 * start; the round 10 boss fights in the plaza.
 *
 * Nothing is wired yet: the director, the enemy AI, the forge and the HUD read these tables in later cards. Every
 * modifier states its whole effect as data (fields below), balanced like waves.ts MODIFIERS: ~0.9-1.15 of the round's
 * threat, normalizeThreat for composition changes and multiplier products near 1.
 *
 * src/rules may only import the contract, which does not exist yet, so this module imports nothing: the small types
 * below mirror waves.ts (RegularKind, Formation, RoundModifier), catalog.ts (EnemyKind) and stonewards/rules.ts
 * (RecipeId) until the contract carries them. Every table is deep-frozen; text lives in plain arrays/objects so a
 * humor review can edit wording without touching code.
 */

// ---------- Mirrored types (until src/contract exists) ----------
/** Mirrors waves.ts RegularKind. */
export type CidadeRegularKind='gosma'|'pernilongo'|'tio-pave'|'fiscal';
/** Mirrors catalog.ts EnemyKind. */
export type CidadeEnemyKind=CidadeRegularKind|'chefe';
/** Mirrors waves.ts Formation. */
export type CidadeFormation='cluster'|'line'|'surround';
/** Mirrors stonewards/rules.ts RecipeId. */
export type CidadeRecipeId='reparo'|'gambiarra'|'torre-chinelo';

export type Avenue='norte'|'sul'|'leste'|'oeste';
export const AVENUES:readonly Avenue[]=Object.freeze(['norte','sul','leste','oeste']);
export const CIDADE_REGULAR_KINDS:readonly CidadeRegularKind[]=Object.freeze(['gosma','pernilongo','tio-pave','fiscal']);
export const CIDADE_RECIPE_IDS:readonly CidadeRecipeId[]=Object.freeze(['reparo','gambiarra','torre-chinelo']);

/** Longest modifier label (name + ': ' + description) and round name (VGM-033 banner rule). */
export const LABEL_MAX=46;
/** Longest speech balloon: barks, death lines and retreat lines. */
export const BARK_MAX=30;

/** Per-kind stat tweaks of a city modifier, applied on top of the round-wide multipliers. */
export interface CidadeKindTweak {
  speedMult?:number;hpMult?:number;sizeMult?:number;
  /** Fiscal: keep-distance and shot ranges (FISCAL_SHOT minRange/maxRange/fireRange). */
  rangeMult?:number;
  /** Pernilongo: zig-zag amplitude of the swarm behavior. */
  zigzagMult?:number;
}
/**
 * A city round modifier. The first block is a copy of waves.ts RoundModifier (same names and semantics); the second
 * block is city-only data the director reads once the city is wired.
 */
export interface CidadeModifier {
  id:string;name:string;description:string;
  /** Replaces the composition. */
  weights?:Partial<Record<CidadeRegularKind,number>>;
  /** Pins these shares and rescales the other kinds to fill the rest. */
  share?:Partial<Record<CidadeRegularKind,number>>;
  /** count x= base average threat / new average threat, clamped to [0.4, 1.6]. */
  normalizeThreat?:boolean;
  countMult?:number;hpMult?:number;speedMult?:number;sizeMult?:number;
  groupSizeMult?:number;cadenceMult?:number;
  formation?:CidadeFormation;
  /** Every group of the round comes from one side (in the city: one of the allowed avenues, picked per round). */
  singleSide?:boolean;
  /** Groups come from one side, then the opposite one, alternating (in the city: alternating between the allowed avenues). */
  alternateSide?:boolean;
  /** Rounds where this modifier is never drawn (it would hide the elite or break the round's identity). */
  banRounds:readonly number[];
  // ---- City-only ----
  /** Only these avenue ends spawn (default: all four). ['norte'] funnels every group into the Norte plaza mouth. */
  avenues?:readonly Avenue[];
  /**
   * Ice: enemies keep `slide` (0..1) of their previous velocity each tick and steer with the rest, so they drift wide on
   * corners and slide past targets. plazaOnly limits it to the plaza circle; kinds limits it to those enemy kinds;
   * heroSlide (0..1) is a milder slip for heroes, never applied to a dash.
   */
  ice?:{slide:number;plazaOnly?:boolean;kinds?:readonly CidadeRegularKind[];heroSlide?:number};
  /** Per-kind stat tweaks (e.g. only tio-pavê gets slower). */
  kindMult?:Partial<Record<CidadeRegularKind,CidadeKindTweak>>;
  /**
   * Client-side fog/snowstorm: share (0..1] of the clear view radius kept. Enemies keep a readable outline and spawn
   * warnings stay full size, so danger stays legible; the sim is untouched.
   */
  visibility?:number;
  /**
   * Snowball: sizeMult/hpMult reached at the plaza mouth (cap), lerped from the spawn values (sizeMult/hpMult above) by
   * the share of the avenue already walked.
   */
  growth?:{sizeMult:number;hpMult:number};
}

const deepFreeze=<T>(value:T):T=>{
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const v of Object.values(value))deepFreeze(v);
    Object.freeze(value);
  }
  return value;
};

// ---------- Round names ----------
export const CIDADE_ROUND_NAMES:readonly string[]=deepFreeze([
  'Chinelo na Neve','Achei Que Neve Era Isopor','Lá em Casa, 18 Graus É Inverno','Edredom da Vó na Avenida',
  'Luva de Lavar Louça','Casaco com Cheiro de Naftalina','Fumacinha Saindo da Boca','Parou Tudo Pra Filmar a Neve',
  'Banho? Só Semana Que Vem','Tombo na Frente de Todo Mundo','Língua de Fora Pegando Floco','Cachecol de Toalha de Praia',
  'Pinhão Acabou Antes da Quadrilha','Mão Gelada no Pescoço','Ponto de Ônibus a Menos Cinco','Pé Gelado Debaixo da Coberta',
  'Dormiu de Touca e Meia','Ventilador Tirou Férias','Agasalho do Uniforme da Escola','Cachecol Que a Tia Fez Torto',
  'Cueca Congelou no Varal','Carro do Ovo Atolou na Neve','Tobogã de Papelão na Ladeira','Rodo na Avenida Nevada',
  'Engavetamento de Trenó','Meia por Cima da Calça','Pé Dentro da Sacola de Mercado','Dedo Grudou no Poste',
  'Três Blusas e Uma Regata','Sorvete de Graça na Calçada',
]);
/** Round 5: the elite tio-pavê with a chest. */
export const CIDADE_ELITE_ROUND_NAMES:readonly string[]=deepFreeze([
  'Tio de Bermuda na Neve','Tio Já Morou no Canadá','Tio Caiu, Mas Foi de Propósito','Pavê de Neve É Só Pa Vê',
  'Tio Chegou de Trenó com o Baú',
]);
/** Round 10: the boss in the plaza. */
export const CIDADE_BOSS_ROUND_NAMES:readonly string[]=deepFreeze([
  'Síndico Contou os Flocos','Síndico Proibiu Boneco de Neve','Taxa Extra de Aquecimento','Proibido Nevar Após as 22h',
  'Rateio do Limpa-Neve',
]);

// ---------- Modifiers ----------
/**
 * Drawn like waves.ts MODIFIERS (from round 3, one per round, never twice in a run, never on the boss round).
 * Threat notes are against the base round (count x hp x kind weight; speed and control effects are felt, not counted).
 */
export const CIDADE_MODIFIERS:readonly CidadeModifier[]=deepFreeze<CidadeModifier[]>([
  // Everyone through the Norte mouth, stuck in traffic: ~1.1 count, slower. The other three barricades breathe.
  {id:'north-avenue-jam',name:'Tudo pela Av. Norte',description:'Saída de feriado.',
    avenues:['norte'],singleSide:true,countMult:1.1,groupSizeMult:1.3,cadenceMult:1.3,speedMult:.9,banRounds:[]},
  // Half the round is frozen tio-pavê: slow, tougher, sliding into barricades. ~1.0 after normalizeThreat.
  {id:'uncle-popsicle',name:'Picolé de Tio',description:'Desliza contando piada.',
    share:{'tio-pave':.5},normalizeThreat:true,kindMult:{'tio-pave':{speedMult:.6,hpMult:1.2}},
    ice:{slide:.85,kinds:['tio-pave']},banRounds:[5,6]},
  // Global ice: faster on straightaways, sloppy on corners. ~1.0.
  {id:'black-ice',name:'Pista de Patinação',description:'Freio? Que freio?',
    ice:{slide:.85,heroSlide:.3},speedMult:1.1,countMult:.95,banRounds:[]},
  // Ice only around the fountain: whoever breaches a barricade skates across the plaza. ~1.1 count.
  {id:'frozen-fountain',name:'Chafariz Congelado',description:'Rinque grátis na praça!',
    ice:{slide:.8,plazaOnly:true},countMult:1.1,banRounds:[]},
  // Snowstorm: less view, fewer and slower enemies. ~0.9 counted, ~1.0 felt. Banned on the elite round (hides the chest).
  {id:'whiteout',name:'Nevasca Braba',description:'Quem é esse aí? Ah, gosma.',
    visibility:.55,countMult:.9,speedMult:.95,banRounds:[5]},
  // Only Leste and Oeste spawn, alternating; cleared road is fast. ~1.05.
  {id:'snowplow',name:'Prefeitura Passou',description:'Limpou só Leste e Oeste.',
    avenues:['leste','oeste'],alternateSide:true,speedMult:1.15,countMult:.95,banRounds:[]},
  // Cold horde: more bodies, slower and squishier. ~1.02.
  {id:'no-coat',name:'Ninguém Trouxe Casaco',description:'E a mãe avisou.',
    speedMult:.8,hpMult:.85,countMult:1.2,groupSizeMult:1.1,banRounds:[]},
  // Pernilongos in beanies: slow, sturdy, short zig-zag. ~1.12 after normalizeThreat. Round 6 already has the swarm.
  {id:'beanie-mosquito',name:'Pernilongo de Gorro',description:'Lento, mas de gorrinho.',
    share:{pernilongo:.55},normalizeThreat:true,countMult:.95,groupSizeMult:1.3,cadenceMult:1.3,
    kindMult:{pernilongo:{speedMult:.75,hpMult:1.6,zigzagMult:.6}},banRounds:[6]},
  // Small at the avenue end, big at the plaza mouth: kill them early. ~0.95 (average hp ~1.05 over the walk).
  {id:'snowball',name:'Bola de Neve',description:'Cresce igual a fatura.',
    sizeMult:.8,hpMult:.8,growth:{sizeMult:1.3,hpMult:1.3},countMult:.9,banRounds:[5]},
  // Fiscal turns into a short-range bruiser for one round. ~1.0. Fiscais debut on round 4; round 6 is the breather.
  {id:'frozen-ink',name:'Caneta Congelou',description:'Fiscal só multa de perto.',
    share:{fiscal:.35},normalizeThreat:true,kindMult:{fiscal:{rangeMult:.5,speedMult:1.1}},banRounds:[3,6]},
  // Each group splits in four, one part per avenue at once: spread the team over the 4 barricades. ~1.0.
  {id:'rush-hour',name:'Cruzamento Sem Semáforo',description:'Vem dos 4 lados!',
    avenues:['norte','sul','leste','oeste'],formation:'surround',groupSizeMult:1.2,cadenceMult:1.2,countMult:.95,banRounds:[]},
]);
/** Banner label, same rule as waves.ts modifierLabel (VGM-033). */
export const cidadeModifierLabel=(m:Pick<CidadeModifier,'name'|'description'>)=>`${m.name}: ${m.description}`;

// ---------- Enemy lines ----------
/** Ambient speech balloons in the snow, per enemy kind (boss included). */
export const CIDADE_BARKS:Readonly<Record<CidadeEnemyKind,readonly string[]>>=deepFreeze({
  gosma:['Tô grudando no gelo!','Gelei, mas continuo mole!','Sou sorvete? Não, feijão!','Escorrego, mas não desisto!',
    'Sou raspadinha de limão!','Com neve eu fico crocante!','Me dá um cantinho do edredom!'],
  pernilongo:['Bzzz... brrr... bzzz!','Aqui não tem ventilador!','Tô de gorrinho, respeita!','Vim pegar um calorzinho!',
    'Seu pescoço tá quentinho?','Sangue sabor chocolate quente!','Nem a neve me cala!'],
  'tio-pave':['No meu tempo nevava pavê!','Sobrinho, cadê o casaco?','Frio? Eu tô de regata!',
    'Essa quebra o gelo, sobrinho!','Em 89 nevou lá em casa!'],
  fiscal:['Boneco de neve sem alvará!','Multa por excesso de neve!','Soltando fumacinha? Multa!','Cachecol fora do padrão!',
    'Caiu? Tombo sem autorização!','Caneta gelou, multo a lápis!','Iglu irregular! Demole já!'],
  chefe:['Neve no hall? Quem trouxe?','Neve na praça? Multa geral!','Chafariz é área comum!','Proibido guerra de neve!',
    'Devolve a pá do zelador!','Aquecedor só com ata!','Boneco na vaga do 302!'],
});
/**
 * Behavior lines in the snow, same role and shape as catalog.ts reactionLines (≤ BARK_MAX, under the catalog's 32):
 * enemy-ai says one when the behavior fires. The tio-pavê's joke stop (TIO_JOKE.range, chance 1) always shows one, so
 * this is where the city's laugh moment lives ("É pavê ou picolé?" while he slides on the ice).
 */
export const CIDADE_REACTION_LINES:Readonly<Partial<Record<CidadeEnemyKind,readonly string[]>>>=deepFreeze({
  'tio-pave':['É pavê ou picolé?','Olha o tio patinando!','Boneco de neve come? Flocos!','Floco no mar? Neve-gou!',
    'Pinguim bravo? Fica frio!','Sobrinho, segura que eu caio!'],
});
/** Pop text for the death "poof" in the snow, per regular kind. */
export const CIDADE_DEATH_LINES:Readonly<Record<CidadeRegularKind,readonly string[]>>=deepFreeze({
  gosma:['Virei gelatina de freezer!','Me usa de gelo no suco!','Me põe no micro-ondas...','Virei geladinho de gosma!',
    'Quebrei feito pé de moleque!'],
  pernilongo:['Morri de friagem!','Congelei no meio do bzz...','Tapa de luva vale?!','Hiberno até o verão!',
    'Nem deu pra picar ninguém...'],
  'tio-pave':['Agora sou pavê pa comê!','Congelei no meio da piada!','Me descongela na ceia!','Esqueci a ceroula!',
    'Quebrou o gelo... e eu!'],
  fiscal:['Multa... congelada...','Recorro... da... nevasca...','Escorreguei no meu talão!','Vou multar o inverno!',
    'Arquivado no freezer!'],
});
/** Said by one enemy when a timed-out horde gives up and walks back up the avenues. */
export const CIDADE_RETREAT_LINES:readonly string[]=deepFreeze([
  'Vou fazer sopa de pacotinho!','Vou ficar colado no fogão!','Volto quando esquentar!','Vou tomar um caldinho!',
  'Meu nariz congelou, tchau!','Vou ver novela de edredom!','Bora pra festa junina!','Neve não, sou de praia!',
  'Escorrego até em casa!',
]);

// ---------- Stonewards (forge and horn) ----------
/** Forge lines in the cold, per real recipe id (stonewards/rules.ts RECIPES). */
export const CIDADE_FORGE_LINES:Readonly<Record<CidadeRecipeId,readonly string[]>>=deepFreeze({
  reparo:['Rebocou com clara em neve. Tá firme.','Barricada nova: geladeira velha e fé.',
    'Garantia da obra: até o verão.','Fez tijolo na forminha de gelo.'],
  gambiarra:['Fita isolante no frio cola? Agora cola.','Aqueceu com secador de cabelo. Rodou.',
    'Enrolou no papel-alumínio. Pegou sinal.','Bateu duas vezes e esquentou. Funciona.'],
  'torre-chinelo':['Torre de chinelo: mira em pé gelado.','Chinelada gelada arde em dobro.',
    'A vó tirou a luva. Agora é sério.','Chinelo com meia: arma de inverno.'],
});
/** The return horn in the cold: back to the plaza before the horde comes down the avenues. */
export const CIDADE_HORN_LINES:readonly string[]=deepFreeze([
  'Último na praça é picolé de chuchu!','A corneta congelou, mas toca. Corre!','Volta antes que o pé congele!',
  'Pfffrrr! A corneta tá rouca de frio!','Larga tudo! Vem bicho na contramão!','Pro chafariz! Os bichos vêm patinando!',
  'Corre igual quando a mãe grita o nome!',
]);

// ---------- Crashed vehicle (start, south of the city; D-026: a helicopter) ----------
export interface CidadeVehicle {
  id:string;name:string;
  /** Lines shown in sequence at the run start (≤ LABEL_MAX each). */
  intro:readonly string[];
  /** Balloon when a hero inspects the wreck (≤ BARK_MAX each). */
  inspect:readonly string[];
}
export const CIDADE_VEHICLE:CidadeVehicle=deepFreeze({
  id:'heli-firma',name:'Helicóptero da Firma',
  intro:['Festa da firma: passeio de helicóptero!','O piloto era o estagiário. Primeiro dia.',
    'Era pra ir pra praia. Mapa de ponta-cabeça.','Caímos na cidade nevada. De chinelo.',
    'Presente do amigo secreto: uma meia. Salvou.'],
  inspect:['Ainda tem coxinha no banco?','O GPS insiste: praia, 2 km.','Nota do piloto: uma estrela.',
    'O estagiário foi efetivado?','Pavê no porta-luvas. Não abre.'],
});

/** Everything above in one object (same array references), for the director, the AI, the forge and the HUD. */
export const CIDADE_ZUEIRA=deepFreeze({
  roundNames:CIDADE_ROUND_NAMES,eliteRoundNames:CIDADE_ELITE_ROUND_NAMES,bossRoundNames:CIDADE_BOSS_ROUND_NAMES,
  modifiers:CIDADE_MODIFIERS,barks:CIDADE_BARKS,reactionLines:CIDADE_REACTION_LINES,deathLines:CIDADE_DEATH_LINES,
  retreatLines:CIDADE_RETREAT_LINES,
  forgeLines:CIDADE_FORGE_LINES,hornLines:CIDADE_HORN_LINES,vehicle:CIDADE_VEHICLE,
});
