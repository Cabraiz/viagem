/**
 * Stonewards rules the client also needs (VGM-046B): recipes and their prices, node values, the camp radius and the
 * pt-BR lines. Pure constants and math, no terrain or server imports, so the HUD and the renderer can bundle them.
 */
import {SIM_HZ} from '../contract/index.ts';

export type ResourceKind='coco'|'pedra';
export const RESOURCE_KINDS:readonly ResourceKind[]=['coco','pedra'];
export type Balance=Record<ResourceKind,number>;

export type RecipeId='reparo'|'gambiarra'|'torre-chinelo';
export interface Recipe {id:RecipeId;name:string;cost:Balance;describe:string;lines:readonly string[]}

export const RECIPES:Readonly<Record<RecipeId,Recipe>>=Object.freeze({
  reparo:{id:'reparo',name:'Massa Corrida e Fé',cost:{coco:2,pedra:3},
    describe:'Conserta 25% da muralha',
    lines:['Passou massa corrida, tá novinha (de longe).','Reparo feito com fita silver tape e oração.','O pedreiro sumiu, mas a parede voltou.']},
  gambiarra:{id:'gambiarra',name:'Gambiarra',cost:{coco:4,pedra:2},
    describe:'+1 nível numa arma aleatória sua',
    lines:['Gambiarra aprovada pelo INMETRO, confia.','Prendeu com elástico de dinheiro. Funcionou.','Se tá funcionando, não mexe.']},
  'torre-chinelo':{id:'torre-chinelo',name:'Torre de Chinelo da Vó',cost:{coco:3,pedra:4},
    describe:'Arremessa chinelos por 45 s',
    lines:['A vó tá de olho. E de chinelo na mão.','Torre armada: chinelada teleguiada liberada.','Ninguém escapa da Havaiana voadora.']},
});
export const RECIPE_IDS=Object.keys(RECIPES) as RecipeId[];
export const isRecipeId=(id:unknown):id is RecipeId=>typeof id==='string'&&Object.hasOwn(RECIPES,id);
export const canPay=(b:Balance,c:Balance)=>b.coco>=c.coco&&b.pedra>=c.pedra;
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

/** Hero walking speed (world.ts SPEED, units per second); copied so this module stays import-free. */
export const WALK_SPEED=3.1;
/** Return estimate: straight-line time × this factor (trees, lakes) plus the slack, in seconds. */
export const RETURN_FACTOR=1.1,RETURN_SLACK_SECONDS=2;
/** Ticks a hero `distance` units away from the camp's edge needs to get back (0 inside the camp). */
export function returnTicks(distanceFromBase:number){
  const out=Math.max(0,(Number.isFinite(distanceFromBase)?distanceFromBase:0)-CAMP_RADIUS);
  return out>0?Math.ceil((out/WALK_SPEED*RETURN_FACTOR+RETURN_SLACK_SECONDS)*SIM_HZ):0;
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
  balance:'Falta coco ou pedra.',
  full:'Já tá no máximo.',
  'no-weapon':'Nenhuma arma pra gambiarra.',
  duplicate:'Esse pedido já foi.',
  'wall-down':'A muralha caiu.',
  away:'Volta pro acampamento pra forjar.',
  blocked:'Tem gente no meio da barricada. Sai daí que a gente monta.',
  target:'Essa barricada não existe nem no papel.',
});
