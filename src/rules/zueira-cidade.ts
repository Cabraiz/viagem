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
 * Types come from the same sector (waves.ts, stonewards.ts); only the enemy kind list with the boss is mirrored,
 * because sim/enemies/catalog.ts is outside rules. Every table is deep-frozen; text lives in plain arrays/objects so a
 * humor review can edit wording without touching code.
 */
import type {Formation,RegularKind,RoundModifier} from './waves.ts';
import type {RecipeId} from './stonewards.ts';

export type CidadeRegularKind=RegularKind;
/** Mirrors sim/enemies/catalog.ts EnemyKind (rules may not import sim). */
export type CidadeEnemyKind=CidadeRegularKind|'chefe';
export type CidadeFormation=Formation;
export type CidadeRecipeId=RecipeId;

export type Avenue='norte'|'sul'|'leste'|'oeste';
export const AVENUES:readonly Avenue[]=Object.freeze(['norte','sul','leste','oeste']);
export const CIDADE_REGULAR_KINDS:readonly CidadeRegularKind[]=Object.freeze(['bebado','pombos','tio-pave','agiota','anao-molotov']);
export const CIDADE_RECIPE_IDS:readonly CidadeRecipeId[]=Object.freeze(['reparo','gambiarra','torre-chinelo']);

/** Longest modifier label (name + ': ' + description) and round name (VGM-033 banner rule). */
export const LABEL_MAX=46;
/** Longest speech balloon: barks, death lines and retreat lines. */
export const BARK_MAX=30;

/** Per-kind stat tweaks of a city modifier, applied on top of the round-wide multipliers. */
export interface CidadeKindTweak {
  speedMult?:number;hpMult?:number;sizeMult?:number;
  /** Agiota: keep-distance and shot ranges (AGIOTA_SHOT minRange/maxRange/fireRange). */
  rangeMult?:number;
  /** Pombos: zig-zag amplitude of the swarm behavior. */
  zigzagMult?:number;
}
/**
 * A city round modifier: waves.ts RoundModifier (same fields and semantics; in the city singleSide picks one of the
 * allowed avenues per round and alternateSide alternates between them) plus city-only data the director reads once
 * the city is wired.
 */
export interface CidadeModifier extends RoundModifier {
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
  'Chinelo na Neve','Achei Que Neve Era Isopor','Cueca Congelou no Varal','Dedo Grudou no Poste',
  'Tombo na Frente de Todo Mundo','Quentão Batizado Duas Vezes','Cachaça Pra Esquentar, Juro',
  'Termômetro Pediu Demissão','Escreveu o Nome na Neve','Pombo Congelado em Pleno Voo','Vômito Virou Picolé',
  'Meia com Chinelo e Orgulho','Molotov Pra Aquecer as Mãos','Agiota Cobrando de Luva',
  'Churrasco na Neve, Tio Insistiu','Fatura Chegou Junto com a Neve','Tio de Regata a Menos Dez',
  'Corrente de Ouro Grudou no Peito','Lá em Casa, 18 Graus É Inverno','Fogueira de Boleto Vencido',
  'Ponto de Ônibus a Menos Cinco','Latinha Estourou no Congelador','Cocô de Pombo Virou Pedra','Engavetamento de Trenó',
  'Neve Amarela, Não Come','Hipotermia com Pochete','Esquiando na Ladeira do Bar','Firma Não Dá Folga Pra Nevasca',
  'Cachecol de Toalha de Praia','Guerra de Neve com Pedra Dentro',
]);
/** Round 5: the elite tio-pavê with a chest. */
export const CIDADE_ELITE_ROUND_NAMES:readonly string[]=deepFreeze([
  'Tio Já Morou no Canadá','Puxa-Saco Congelado','Coroa de Papel Molhou na Neve','Chefe Pediu Café na Nevasca',
  'Tio Chegou de Trenó com o Baú',
]);
/** Round 10: the boss in the plaza. */
export const CIDADE_BOSS_ROUND_NAMES:readonly string[]=deepFreeze([
  'Síndico Proibiu Boneco de Neve','Taxa Extra de Aquecimento','Síndico Contou os Flocos','Despejo na Nevasca',
  'Neve Vermelha no Hall',
]);

// ---------- Modifiers ----------
/**
 * Drawn like waves.ts MODIFIERS (from round 3, one per round, never twice in a run, never on the boss round).
 * Threat notes are against the base round (count x hp x kind weight; speed and control effects are felt, not counted).
 */
export const CIDADE_MODIFIERS:readonly CidadeModifier[]=deepFreeze<CidadeModifier[]>([
  // Everyone through the Norte mouth, stuck in traffic: ~1.1 count, slower. The other three barricades breathe.
  {id:'north-avenue-jam',name:'Tudo pela Av. Norte',description:'Fila do boteco às 2h.',
    avenues:['norte'],singleSide:true,countMult:1.1,groupSizeMult:1.3,cadenceMult:1.3,speedMult:.9,banRounds:[]},
  // Half the round is frozen tio-pavê: slow, tougher, sliding into barricades. ~1.0 after normalizeThreat.
  {id:'uncle-popsicle',name:'Picolé de Tio',description:'Congelou de peito aberto.',
    share:{'tio-pave':.5},normalizeThreat:true,kindMult:{'tio-pave':{speedMult:.6,hpMult:1.2}},
    ice:{slide:.85,kinds:['tio-pave']},banRounds:[5,6]},
  // Global ice: faster on straightaways, sloppy on corners. ~1.0.
  {id:'black-ice',name:'Pista de Patinação',description:'Freio? Que freio, porra?',
    ice:{slide:.85,heroSlide:.3},speedMult:1.1,countMult:.95,banRounds:[]},
  // Ice only around the fountain: whoever breaches a barricade skates across the plaza. ~1.1 count.
  {id:'frozen-fountain',name:'Chafariz Congelado',description:'Rinque grátis, tombo pago.',
    ice:{slide:.8,plazaOnly:true},countMult:1.1,banRounds:[]},
  // Snowstorm: less view, fewer and slower enemies. ~0.9 counted, ~1.0 felt. Banned on the elite round (hides the chest).
  {id:'whiteout',name:'Nevasca Braba',description:'Quem é esse aí? Ah, o bêbado.',
    visibility:.55,countMult:.9,speedMult:.95,banRounds:[5]},
  // Only Leste and Oeste spawn, alternating; cleared road is fast. ~1.05.
  {id:'snowplow',name:'Limpa-Neve',description:'Só Leste e Oeste. Verba acabou.',
    avenues:['leste','oeste'],alternateSide:true,speedMult:1.15,countMult:.95,banRounds:[]},
  // Cold horde: more bodies, slower and squishier. ~1.02.
  {id:'no-coat',name:'Ninguém Trouxe Casaco',description:'E a mãe avisou, porra.',
    speedMult:.8,hpMult:.85,countMult:1.2,groupSizeMult:1.1,banRounds:[]},
  // Pombos in beanies: slow, sturdy, short zig-zag. ~1.12 after normalizeThreat. Round 6 already has the swarm.
  {id:'beanie-mosquito',name:'Pombos de Gorro',description:'Gordos, lentos e cagões.',
    share:{pombos:.55},normalizeThreat:true,countMult:.95,groupSizeMult:1.3,cadenceMult:1.3,
    kindMult:{pombos:{speedMult:.75,hpMult:1.6,zigzagMult:.6}},banRounds:[6]},
  // Small at the avenue end, big at the plaza mouth: kill them early. ~0.95 (average hp ~1.05 over the walk).
  {id:'snowball',name:'Bola de Neve',description:'Cresce igual juros de agiota.',
    sizeMult:.8,hpMult:.8,growth:{sizeMult:1.3,hpMult:1.3},countMult:.9,banRounds:[5]},
  // The agiota turns into a short-range bruiser for one round. ~1.0. Agiotas debut on round 4; round 6 is the breather.
  {id:'frozen-ink',name:'Impressora Congelou',description:'Agiota cobra no soco.',
    share:{agiota:.35},normalizeThreat:true,kindMult:{agiota:{rangeMult:.5,speedMult:1.1}},banRounds:[3,6]},
  // Each group splits in four, one part per avenue at once: spread the team over the 4 barricades. ~1.0.
  {id:'rush-hour',name:'Cruzamento Sem Semáforo',description:'Buzina não freia.',
    avenues:['norte','sul','leste','oeste'],formation:'surround',groupSizeMult:1.2,cadenceMult:1.2,countMult:.95,banRounds:[]},
]);
/** Banner label, same rule as waves.ts modifierLabel (VGM-033). */
export const cidadeModifierLabel=(m:Pick<CidadeModifier,'name'|'description'>)=>`${m.name}: ${m.description}`;

// ---------- Enemy lines ----------
/** Ambient speech balloons in the snow, per enemy kind (boss included). */
export const CIDADE_BARKS:Readonly<Record<CidadeEnemyKind,readonly string[]>>=deepFreeze({
  bebado:['Cachaça é meu casaco, porra','Tô vendo dois bonecos de neve','Lambi o poste. Grudou. Hic!',
    'Quentão? Me dá o balde todo','Vomitei e virou raspadinha','Hipotermia? Isso é de beber?',
    'Fiz anjo de neve de bruços'],
  pombos:['Cruu... cadê a vó do milho?','Pão congelado quebra o bico!','Cruu! Cocô quentinho aquece!',
    'Fizemos ninho no teu gorro','Tô gordo de frio, respeita','Pombo de gorro é chique, cruu'],
  'tio-pave':['Frio? Eu tô de regata!','Gramado é mais frio, sobrinho','Espetinho de picolé, sobrinho?',
    'Neve? Ótimo pra gelar a ceva!','Essa quebra o gelo, sobrinho!','Em 89 nevou lá em casa!',
    'Quentão do tio tem segredo'],
  agiota:['O iglu tá no meu nome, viu?','Paga ou vira boneco de neve','Boleto chegou de trenó, hein',
    'Dívida não hiberna, meu anjo','Nevasca tem taxa de 30%','Pochete térmica, juros quentes'],
  'anao-molotov':['Frio? Taca fogo que passa!','Aquecimento central: EU','Barba congelou. Vou acender','Iglu? Iglu é forno, caralho!',
    'Vou fazer um quentão. Na rua.','Cachaça não congela. Eu testei','Boneco de neve? Agora é poça.'],
  chefe:['Proibido morrer no chafariz!','Quem autorizou nevar? NINGUÉM!','Floco caiu na tua vaga? Multa!',
    'Rateio da nevasca: pague já!','Quem pisou na neve do 302?!','Pá do zelador é arma, porra!',
    'Guerra de neve só com carimbo'],
});
/**
 * Behavior lines in the snow, same role and shape as catalog.ts reactionLines (≤ BARK_MAX, under the catalog's 32):
 * enemy-ai says one when the behavior fires. The tio-pavê's joke stop (TIO_JOKE.range, chance 1) always shows one, so
 * this is where the city's laugh moment lives ("É pavê ou picolé?" while he slides on the ice).
 */
export const CIDADE_REACTION_LINES:Readonly<Partial<Record<CidadeEnemyKind,readonly string[]>>>=deepFreeze({
  'tio-pave':['É pavê ou picolé?','Esquentou? Foi o tapa do tio!','Toc toc. Quem é? AVALANCHE!','Bola de neve ou de porrada?',
    'Esquia, sobrinho! VUPT!','Sabe o que o gelo disse? Cai!','Boneco de neve come? Flocos!'],
});
/** Pop text for the death "poof" in the snow, per regular kind. */
export const CIDADE_DEATH_LINES:Readonly<Record<CidadeRegularKind,readonly string[]>>=deepFreeze({
  bebado:['Dormi na neve. Acordo em abril','Congelei abraçado no poste','Virei picolé de cachaça',
    'Morri de friagem e de ressaca','Me põe no quentão, hic...'],
  pombos:['Congelamos no meio do cruu','Viramos estátua. Finalmente.','Caímos que nem granizo','Penas e neve. Uma beleza.'],
  'tio-pave':['Congelei no meio da piada!','Me descongela na ceia!','Peito aberto deu nisso...','Pelo menos morri de bermuda',
    'Agora sou pavê pa comê!'],
  agiota:['Fiador! Chama o fiador!','Meu filho herda a cobrança!','Boleto molhado não vale! NÃÃO!',
    'Congelei os juros. Que dor.'],
  'anao-molotov':['Pelo menos derreti a neve!','Pavio molhou... ah, pegou.','Virei fogueira da praça!','Explodi e esquentei a galera'],
});
/** Said by one enemy when a timed-out horde gives up and walks back up the avenues. */
export const CIDADE_RETREAT_LINES:readonly string[]=deepFreeze([
  'Volto no carnaval. Talvez.','Vou pro boteco esquentar!','Meu bico congelou, cruu!','Fui buscar o edredom da vó',
  'Vou tacar fogo em casa. Tchau','Dívida congelada até o verão','Neve não, sou de praia!','Escorrego até o bar!',
  'Vou dormir no forno do bar','Meu catarro virou estalactite',
]);

// ---------- Stonewards (forge and horn) ----------
/** Forge lines in the cold, per real recipe id (stonewards/rules.ts RECIPES). */
export const CIDADE_FORGE_LINES:Readonly<Record<CidadeRecipeId,readonly string[]>>=deepFreeze({
  reparo:['Rebocou com clara em neve. Tá firme.','Barricada nova: geladeira velha e fé.',
    'Remendou com boleto vencido. Aguenta.','Cimento com cachaça: seca rindo.','Tapou o buraco com o tio. Ele deixou.'],
  gambiarra:['Fita isolante no frio cola? Agora cola.','Bateu duas vezes e esquentou. Funciona.',
    'Ligou no molotov. Perdeu a sobrancelha.','Amarrou com a corrente do tio. Brilha.',
    'Arrumou no tapa e no palavrão. Rodou.'],
  'torre-chinelo':['Chinelada gelada arde em dobro.','A vó tirou a luva. Agora é sério.','Chinelo com gelo: mira em bêbado.',
    'Torre de chinelo: a mãe aprovaria.','Chinelo de dedo, pontaria de sniper.'],
});
/** The return horn in the cold: back to the plaza before the horde comes down the avenues. */
export const CIDADE_HORN_LINES:readonly string[]=deepFreeze([
  'Último na praça é picolé de chuchu!','A corneta congelou, mas toca. Corre!','Corre igual quando a mãe grita o nome!',
  'Pro chafariz! Vem bêbado em bando!','Volta! O agiota sabe onde cê tá!','Pfffrrr! Corneta com ressaca, mas toca!',
  'Larga tudo! Os pombos tão vindo armados!','Solta o quentão, porra! Pra praça!',
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
  intro:['Sorteio da firma: helicóptero! Que azar.','O piloto era o estagiário. Bebeu na festa.',
    'Era pra ir pra praia. Mapa de ponta-cabeça.','Caímos na cidade nevada. De chinelo.',
    'O RH mandou avisar: o dia conta como falta.'],
  inspect:['Ainda tem coxinha no banco?','O GPS insiste: praia, 2 km.','Garrafa vazia no manche. Ué.',
    'Caixa-preta: só karaokê.','Financiado pelo agiota. Eita.'],
});

/** Everything above in one object (same array references), for the director, the AI, the forge and the HUD. */
export const CIDADE_ZUEIRA=deepFreeze({
  roundNames:CIDADE_ROUND_NAMES,eliteRoundNames:CIDADE_ELITE_ROUND_NAMES,bossRoundNames:CIDADE_BOSS_ROUND_NAMES,
  modifiers:CIDADE_MODIFIERS,barks:CIDADE_BARKS,reactionLines:CIDADE_REACTION_LINES,deathLines:CIDADE_DEATH_LINES,
  retreatLines:CIDADE_RETREAT_LINES,
  forgeLines:CIDADE_FORGE_LINES,hornLines:CIDADE_HORN_LINES,vehicle:CIDADE_VEHICLE,
});
