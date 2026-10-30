/**
 * Passive items (VGM-036). Each passive has 5 levels and adds a flat delta per level
 * to one or more PlayerStats. Numbers live here; stats.ts sums and clamps them.
 */
import type {ItemDef,PlayerStats} from '../contract/index.ts';

export const PASSIVE_MAX_LEVEL=5;

export const PASSIVE_IDS=['cafe-forte','marmita','tenis','megafone','bone','oculos','cartao','pente',
  'estilingue','defumador','arruda','tampa-de-panela'] as const;
/**
 * D-051 manual combat only (proposal §5): reinforcements of the weapon in the hand. The automatic game's offers never
 * roll them (sim/items.ts AUTO_PASSIVE_IDS); the stats still read them like any passive.
 * Card upgrades-megabonk (usuário 22/10: "copiar os upgrades do Megabonk"): the manual combat's level cards are the
 * Megabonk tomes, global upgrades that need no equipping and hold for whatever weapon is in the hand (and the towers its
 * owner built, sim/towers/system.ts ownerBoost): the old ones (dano, área, cadência, vida, tênis, sorte, XP) plus
 * +1 projétil (the 'pente' id, now the Bombinha de São João: "pente" read as a magazine, and nothing runs out), the
 * projectile speed (Estilingue), the damage aura (Defumador, sim/weapons/system.ts aura), regeneration (Arruda) and
 * armour (Tampa de Panela). No ímã: D-054 took it out.
 */
export const MANUAL_PASSIVE_IDS=['pente','estilingue','defumador','arruda','tampa-de-panela'] as const;
export const AUTO_PASSIVE_IDS=PASSIVE_IDS.filter(id=>!(MANUAL_PASSIVE_IDS as readonly string[]).includes(id));
/**
 * NEW-20261029-ORQ-levelup-sem-arma-e-solo: the cards that only change the weapon in the hand (its reload, area, damage,
 * projectiles and their speed). A manual-combat hero with no weapon yet is never offered them (sim/progression.ts
 * `armed`): life, speed, luck, the cashback, the Defumador's smoke, regeneration and armour serve with empty hands.
 */
export const WEAPON_PASSIVE_IDS:readonly PassiveId[]=['cafe-forte','megafone','oculos','pente','estilingue'];
export const needsWeapon=(id:string)=>(WEAPON_PASSIVE_IDS as readonly string[]).includes(id);
export type PassiveId=typeof PASSIVE_IDS[number];

export interface PassiveDef extends ItemDef {
  kind:'passive';
  id:PassiveId;
  /** Additive change applied once per owned level. */
  perLevel:Partial<PlayerStats>;
}

/** Formats a per-level delta as pt-BR text, e.g. "-8% recarga". */
const percent=(value:number)=>`${value>0?'+':''}${Math.round(value*100)}%`;

const make=(
  id:PassiveId,name:string,icon:string,perLevel:Partial<PlayerStats>,
  effect:(level:number)=>string,jokes:readonly string[],maxLevel=PASSIVE_MAX_LEVEL,
):PassiveDef=>({
  id,kind:'passive',name,icon,maxLevel,perLevel,
  describe(level){
    const next=Math.min(Math.max(1,Math.floor(level)),maxLevel);
    return `${effect(next)}. ${jokes[(next-1)%jokes.length]}`;
  },
});

/** Card upgrades-megabonk: the levels of +1 projétil (amount 0 → 4; STAT_LIMITS.amount 6, the weapons' MAX_AMOUNT 10). */
export const PENTE_MAX_LEVEL=4;
/** Estilingue: projectile speed per level (×1.4 … ×3, STAT_LIMITS.speed): buys back the heroes' slower shots (HERO_SHOT_SLOWDOWN). */
export const ESTILINGUE_SPEED=.4;
/**
 * Cartão Fidelidade (card ofertas-sem-xp-e-icones, the user 25/10: "troque o ganho de XP por outra coisa, já que o XP não
 * é mostrado"): the cashback, Grana into the opener's wallet per crate opened, per level (sim/crates.ts open). It was
 * +8% XP a level (the growth stat), which no screen shows.
 */
export const CARTAO_CASHBACK=3;
/** Grana a crate pays its opener holding the Cartão Fidelidade at `level` (0 without it). */
export const cartaoCashback=(level:number)=>CARTAO_CASHBACK*Math.max(0,Math.floor(level)||0);
/** Arruda: hp regenerated per second per level (sim/systems/players.ts). */
export const ARRUDA_REGEN=.5;
/**
 * Defumador (the Megabonk aura, no equipping): every `every` seconds each awake enemy within `radius(level)` × the area
 * stat of the hero takes `damage(level)` (× might, core damageEnemy). Sleepers are never touched (walking by a nest does
 * not wake it). sim/weapons/system.ts runs it; the client draws its smoke (render/aura-ring.ts).
 */
export const AURA=Object.freeze({
  every:.5,
  radius:(level:number)=>Math.round((1.3+.3*(Math.max(1,level)-1))*100)/100,
  damage:(level:number)=>4+3*(Math.max(1,level)-1),
});
export const PASSIVES:Readonly<Record<PassiveId,PassiveDef>>=Object.freeze({
  'cafe-forte':make('cafe-forte','Café Coado na Meia','cafe-forte',{cooldown:-0.08},
    level=>`Armas recarregam ${Math.round(8*level)}% mais rápido`,
    ['Coado na meia limpa. Juramos.','Agora você pisca em 4K.','O coração bateu em 3/4.','Dormir é coisa de quem não tem horda.','Você ouve cores.']),
  marmita:make('marmita','Marmita da Vó','marmita',{maxHp:20},
    level=>`+${20*level} de vida máxima`,
    ['Arroz, feijão e amor.','Tem farofa escondida embaixo.','A vó mandou mais um potinho.','Pote de sorvete que não era sorvete.','Você nunca mais vai passar fome.']),
  tenis:make('tenis','Tênis de Feira','tenis',{moveSpeed:0.1},
    level=>`${percent(0.1*level)} de velocidade de movimento`,
    ['Marca "Naike". Corre igual.','A sola faz nhéc nhéc.','Ultrapassa até boleto vencendo.','Chegou antes do ônibus.','O vento pediu licença.']),
  megafone:make('megafone','Megafone do Carro do Ovo','megafone',{area:0.1},
    level=>`${percent(0.1*level)} de área dos ataques`,
    ['Olha o ovo!','Trinta ovos por dez reais!','A vizinhança inteira escutou.','Ovo branco, ovo vermelho, ovo caipira!','Até o síndico desceu pra ver.']),
  bone:make('bone','Boné do Pai','bone',{luck:0.1},
    level=>`${percent(0.1*level)} de sorte`,
    ['Aba reta, sorte torta.','Achou dois reais no bolso.','Pegou o último pão de queijo.','Ganhou no bingo da igreja.','O pai disse "tá vendo?".']),
  oculos:make('oculos','Óculos Juliet','oculos',{might:0.1},
    level=>`${percent(0.1*level)} de dano`,
    ['Lente espelhada, dano refletido.','Ninguém vê seus olhos. Nem o medo.','Comprado no farol, funciona igual.','Dá +10 de respeito na quebrada.','Chave de cadeia. E de horda.']),
  cartao:make('cartao','Cartão Fidelidade','cartao',{},
    level=>`Cada caixa aberta: +R$ ${cartaoCashback(level)}`,
    ['Mais um carimbo e ganha um pastel.','O caixa já sabe seu nome.','Cliente VIP da padaria.','Cashback de verdade, sem letra miúda.','Cartão preto da padoca.']),
  pente:make('pente','Bombinha de São João','traque',{amount:1},
    level=>`+${level} ${level===1?'projétil':'projéteis'} em cada ataque`,
    ['Uma vira duas.','Duas viram três.','O vizinho ligou pra polícia.','Parece réveillon em Copacabana.'],PENTE_MAX_LEVEL),
  estilingue:make('estilingue','Estilingue do Moleque','estilingue',{speed:ESTILINGUE_SPEED},
    level=>`${percent(ESTILINGUE_SPEED*level)} de velocidade do projétil`,
    ['Mira no poste, acerta a janela.','Pedra de rio, a mais lisa.','O moleque é profissional.','Zuniu no ouvido.','Bateu e voltou. Bateu de novo.']),
  defumador:make('defumador','Defumador da Tia','defumador',{},
    level=>`Fumaça em volta de você: ${AURA.damage(level)} de dano a cada ${String(AURA.every).replace('.',',')} s em ${String(AURA.radius(level)).replace('.',',')} m`,
    ['Espanta bicho e mau-olhado.','Cheiro de arruda queimada.','A tia benzeu até o chinelo.','Ninguém chega perto. Literalmente.','Fumaça de terreiro, dano de verdade.']),
  arruda:make('arruda','Arruda atrás da Orelha','arruda',{regen:ARRUDA_REGEN},
    level=>`+${String(ARRUDA_REGEN*level).replace('.',',')} de vida por segundo`,
    ['A vó jurou que funciona.','Funciona.','Até o machucado tem medo.','Raminho fresco da feira.','Mais forte que dipirona.']),
  'tampa-de-panela':make('tampa-de-panela','Tampa de Panela','tampa-de-panela',{armor:1},
    level=>`-${level} de dano em cada golpe que você toma`,
    ['Escudo de cozinha.','Amassou, mas segurou.','Faz "plim" quando apanha.'],3),
});

export const isPassiveId=(id:string):id is PassiveId=>(PASSIVE_IDS as readonly string[]).includes(id);
export const passiveDef=(id:string):PassiveDef|undefined=>isPassiveId(id)?PASSIVES[id]:undefined;
