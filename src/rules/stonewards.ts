/**
 * Stonewards rules the client also needs (VGM-046B): recipes and their prices, node values, the camp radius and the
 * pt-BR lines. Pure constants and math, no terrain or server imports, so the HUD and the renderer can bundle them.
 */
import {SIM_HZ} from '../contract/index.ts';

export type ResourceKind='coco'|'pedra';
export const RESOURCE_KINDS:readonly ResourceKind[]=['coco','pedra'];
/**
 * The team's material (D-048, ficha de torre): one pile of units, whatever the node (a coconut tree or a rock) gave.
 * Every UNITS_PER_TOKEN units are one ficha de torre (🗼): the HUD shows the fichas and a ring filling to the next.
 */
export interface Balance {units:number}
/** Units of material per ficha de torre (D-048: 6p ~10 fichas a city run, 1p ~3.7, measured in balanco-cidade-so-arte). */
export const UNITS_PER_TOKEN=40;
/** Whole fichas in `units` (a tuned crate may leave a fraction). */
export const tokensOf=(units:number)=>Math.max(0,Math.floor(units/UNITS_PER_TOKEN+1e-9));
/** 0..1 of the way to the next ficha. */
export const tokenProgress=(units:number)=>{const t=tokensOf(units),rest=units-t*UNITS_PER_TOKEN;return Math.max(0,Math.min(1,rest/UNITS_PER_TOKEN));};

export type RecipeId='reparo'|'gambiarra'|'torre-chinelo';
/** `cost`: its price in Grana, R$ (D-048: the forge is paid in the team's Grana, not material). */
export interface Recipe {id:RecipeId;name:string;cost:number;describe:string;lines:readonly string[]}

export const RECIPES:Readonly<Record<RecipeId,Recipe>>=Object.freeze({
  reparo:{id:'reparo',name:'Massa Corrida e Fé',cost:5,
    describe:'Conserta 25% da muralha',
    lines:['Passou massa corrida, tá novinha (de longe).','Reparo feito com fita silver tape e oração.','O pedreiro sumiu, mas a parede voltou.']},
  gambiarra:{id:'gambiarra',name:'Gambiarra',cost:6,
    describe:'+1 nível numa arma aleatória sua',
    lines:['Gambiarra aprovada pelo INMETRO, confia.','Prendeu com elástico de dinheiro. Funcionou.','Se tá funcionando, não mexe.']},
  'torre-chinelo':{id:'torre-chinelo',name:'Torre de Chinelo da Vó',cost:7,
    describe:'Arremessa chinelos por 45 s',
    lines:['A vó tá de olho. E de chinelo na mão.','Torre armada: chinelada teleguiada liberada.','Ninguém escapa da Havaiana voadora.']},
});
export const RECIPE_IDS=Object.keys(RECIPES) as RecipeId[];
export const isRecipeId=(id:unknown):id is RecipeId=>typeof id==='string'&&Object.hasOwn(RECIPES,id);
/** The team can pay `cost` R$ from its Grana. */
export const canPay=(grana:number,cost:number)=>grana>=cost;
/**
 * The team's Grana (D-047, every world since D-048): R$ per kill by what fell. It pays the evolutions, the forge, the
 * tower repairs, Dona Cida's sweets and the chaveiro's bill.
 */
export const GRANA_PER_KILL=Object.freeze({normal:1,elite:5,boss:50});
export const granaPerKill=(e:{boss?:boolean;elite?:boolean})=>e.boss?GRANA_PER_KILL.boss:e.elite?GRANA_PER_KILL.elite:GRANA_PER_KILL.normal;
/**
 * What a forge tap may name as its optional `target` (cidade-06): the wall or one of the city's 4 barricades
 * (sim/stonewards/barricades.ts barricadeId). The room drops a tap with any other target before the simulation.
 */
export const FORGE_TARGET=/^(muralha|barricada-[NSLO])$/;
export const isForgeTarget=(id:unknown):id is string=>typeof id==='string'&&FORGE_TARGET.test(id);

/** How long a chinelo tower stays (the forge's third recipe). */
export const TOWER_SECONDS=45;

/**
 * The camp around the wall (base-stonewards-mapa): the forge only works inside it. 6 units holds the players' spawn
 * (5 units from the base on both maps), so a run starts with everyone in the camp.
 */
export const CAMP_RADIUS=6;

/**
 * Node value (base-stonewards-mapa): what one unit of gathering is worth, by the node's distance from the base.
 * Nearest nodes of the endless map sit 10-18 units out (BASE_CLEAR 9, 20 seeds measured in done/), so the first band
 * is the "quick run", the second costs the whole intermission and the third only pays with the horn's extension.
 * The island's 16 nodes are all within 10 units: value 1, as before.
 */
export const VALUE_BANDS=[16,32,56] as const;
export function nodeValue(distanceFromBase:number){
  if(!(distanceFromBase>=0))return 1;
  let value=1;for(const band of VALUE_BANDS)if(distanceFromBase>=band)value++;
  return value;
}

/**
 * BASE hero walking speed on the island and in the endless world (world.ts SPEED, units per second); copied so this
 * module stays import-free. The heroes really walk world.ts heroSpeed(terrain) (2 × the base since
 * velocidade-heroi-e-projetil; the city's base is CITY_HERO_SPEED ≈ 1.99): callers pass it; this is the fallback.
 */
export const WALK_SPEED=3.1;
/** Return estimate: straight-line time × this factor (trees, lakes) plus the slack, in seconds. */
export const RETURN_FACTOR=1.1,RETURN_SLACK_SECONDS=2;
/**
 * Ticks a hero `distance` units away from the camp's edge needs to get back (0 inside the camp), walking at
 * `walkSpeed` u/s (the room's world.ts heroSpeed(terrain); WALK_SPEED when omitted or not a positive number).
 */
export function returnTicks(distanceFromBase:number,walkSpeed=WALK_SPEED){
  const out=Math.max(0,(Number.isFinite(distanceFromBase)?distanceFromBase:0)-CAMP_RADIUS);
  const speed=Number.isFinite(walkSpeed)&&walkSpeed>0?walkSpeed:WALK_SPEED;
  return out>0?Math.ceil((out/speed*RETURN_FACTOR+RETURN_SLACK_SECONDS)*SIM_HZ):0;
}

export const HORN_LINES=[
  'Corneta tocou! Larga o coco e volta pra muralha!',
  'Fim do recreio! Os bichos tão chegando!',
  'Tá ouvindo? É a corneta, não é o caminhão do gás!',
] as const;

export const WALL_DOWN_LINES=[
  'A muralha caiu. Foi feita de isopor, admitimos.',
  'Abrigo derrubado. O síndico vai cobrar a obra.',
  'Caiu a muralha e a dignidade junto.',
] as const;

export const NODE_NAMES:Readonly<Record<ResourceKind,string>>=Object.freeze({coco:'Coco',pedra:'Pedra'});
/** pt-BR jokes said when a node runs dry. */
export const DEPLETED_LINES:Readonly<Record<ResourceKind,readonly string[]>>=Object.freeze({
  coco:['Coqueiro pelado. Respeita o coqueiro.','Acabou o coco, só sobrou a água de memória.','Esse coqueiro entrou de férias.'],
  pedra:['Pedra zerada. Agora é só pedregulho emocional.','Minerou até a alma da rocha.','Essa pedra virou areia de tanto apanhar.'],
});

/** Why the forge said no, in the house voice (one short sentence each). */
export const FORGE_REFUSALS:Readonly<Record<string,string>>=Object.freeze({
  phase:'A forja só abre no intervalo.',
  player:'Caído não forja. Pede resgate.',
  recipe:'Essa receita não existe.',
  balance:'Falta grana.',
  full:'Já tá no máximo.',
  'no-weapon':'Nenhuma arma pra gambiarra.',
  duplicate:'Esse pedido já foi.',
  'wall-down':'A muralha caiu.',
  away:'Volta pro acampamento pra forjar.',
  blocked:'Tem bicho no meio da barricada. Tira ele daí que a gente monta.',
  target:'Essa barricada não existe nem no papel.',
});
