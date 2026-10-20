/**
 * Passive items (VGM-036). Each passive has 5 levels and adds a flat delta per level
 * to one or more PlayerStats. Numbers live here; stats.ts sums and clamps them.
 */
import type {ItemDef,PlayerStats} from '../contract/index.ts';

export const PASSIVE_MAX_LEVEL=5;

export const PASSIVE_IDS=['cafe-forte','marmita','tenis','megafone','bone','oculos','cartao','pente','silenciador'] as const;
/**
 * D-051 manual combat only (proposal §5): reinforcements of the weapon in the hand. The automatic game's offers never
 * roll them (sim/items.ts AUTO_PASSIVE_IDS); the stats still read them like any passive.
 */
export const MANUAL_PASSIVE_IDS=['pente','silenciador'] as const;
export const AUTO_PASSIVE_IDS=PASSIVE_IDS.filter(id=>!(MANUAL_PASSIVE_IDS as readonly string[]).includes(id));
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
  cartao:make('cartao','Cartão Fidelidade','cartao',{growth:0.08},
    level=>`${percent(0.08*level)} de XP ganho`,
    ['Mais um carimbo e ganha um pastel.','Pontos que nunca expiram (expiram).','Cliente VIP da padaria.','O caixa já sabe seu nome.','Cartão preto da padoca.']),
  pente:make('pente','Pente Estendido','pente',{amount:1},
    level=>`+${level} ${level===1?'projétil':'projéteis'} por disparo`,
    ['Cabe mais um. Sempre cabe mais um.','Comprado na feira do rolo.'],2),
  silenciador:make('silenciador','Silenciador de Garagem','silenciador',{},
    level=>`Armas fazem ${Math.round(SILENCER_PER_LEVEL*level*100)}% menos barulho`,
    ['Feito de garrafa PET.','O vizinho nem acordou.','Silêncio de biblioteca.'],3),
});
/** D-051 Silenciador de Garagem: noise taken off per level (sim/weapons/arsenal.ts weaponNoise). */
export const SILENCER_PER_LEVEL=.25;

export const isPassiveId=(id:string):id is PassiveId=>(PASSIVE_IDS as readonly string[]).includes(id);
export const passiveDef=(id:string):PassiveDef|undefined=>isPassiveId(id)?PASSIVES[id]:undefined;
