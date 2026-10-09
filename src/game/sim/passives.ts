/**
 * Passive items (VGM-036). Each passive has 5 levels and adds a flat delta per level
 * to one or more PlayerStats. Numbers live here; stats.ts sums and clamps them.
 */
import type {ItemDef,PlayerStats} from './types.ts';

export const PASSIVE_MAX_LEVEL=5;

export const PASSIVE_IDS=['cafe-forte','marmita','tenis','megafone','bone','ima','oculos','cartao'] as const;
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
  effect:(level:number)=>string,jokes:readonly string[],
):PassiveDef=>({
  id,kind:'passive',name,icon,maxLevel:PASSIVE_MAX_LEVEL,perLevel,
  describe(level){
    const next=Math.min(Math.max(1,Math.floor(level)),PASSIVE_MAX_LEVEL);
    return `${effect(next)}. ${jokes[(next-1)%jokes.length]}`;
  },
});

export const PASSIVES:Readonly<Record<PassiveId,PassiveDef>>=Object.freeze({
  'cafe-forte':make('cafe-forte','Café Coado na Meia','☕',{cooldown:-0.08},
    level=>`Armas recarregam ${Math.round(8*level)}% mais rápido`,
    ['Coado na meia limpa. Juramos.','Agora você pisca em 4K.','O coração bateu em 3/4.','Dormir é coisa de quem não tem horda.','Você ouve cores.']),
  marmita:make('marmita','Marmita da Vó','🍱',{maxHp:20},
    level=>`+${20*level} de vida máxima`,
    ['Arroz, feijão e amor.','Tem farofa escondida embaixo.','A vó mandou mais um potinho.','Pote de sorvete que não era sorvete.','Você nunca mais vai passar fome.']),
  tenis:make('tenis','Tênis de Feira','👟',{moveSpeed:0.1},
    level=>`${percent(0.1*level)} de velocidade de movimento`,
    ['Marca "Naike". Corre igual.','A sola faz nhéc nhéc.','Ultrapassa até boleto vencendo.','Chegou antes do ônibus.','O vento pediu licença.']),
  megafone:make('megafone','Megafone do Carro do Ovo','📢',{area:0.1},
    level=>`${percent(0.1*level)} de área dos ataques`,
    ['Olha o ovo!','Trinta ovos por dez reais!','A vizinhança inteira escutou.','Ovo branco, ovo vermelho, ovo caipira!','Até o síndico desceu pra ver.']),
  bone:make('bone','Boné do Pai','🧢',{luck:0.1},
    level=>`${percent(0.1*level)} de sorte`,
    ['Aba reta, sorte torta.','Achou dois reais no bolso.','Pegou o último pão de queijo.','Ganhou no bingo da igreja.','O pai disse "tá vendo?".']),
  ima:make('ima','Ímã de Geladeira','🧲',{magnet:0.5},
    level=>`+${(0.5*level).toFixed(1).replace('.',',')} de alcance de coleta`,
    ['Brinde da pizzaria.','Segura o cardápio e o XP.','Puxou o boleto junto. Ops.','Até a geladeira veio atrás.','Você virou o polo norte.']),
  oculos:make('oculos','Óculos Juliet','🕶️',{might:0.1},
    level=>`${percent(0.1*level)} de dano`,
    ['Lente espelhada, dano refletido.','Ninguém vê seus olhos. Nem o medo.','Comprado no farol, funciona igual.','Dá +10 de respeito na quebrada.','Chave de cadeia. E de horda.']),
  cartao:make('cartao','Cartão Fidelidade','💳',{growth:0.08},
    level=>`${percent(0.08*level)} de XP coletado`,
    ['Mais um carimbo e ganha um pastel.','Pontos que nunca expiram (expiram).','Cliente VIP da padaria.','O caixa já sabe seu nome.','Cartão preto da padoca.']),
});

export const isPassiveId=(id:string):id is PassiveId=>(PASSIVE_IDS as readonly string[]).includes(id);
export const passiveDef=(id:string):PassiveDef|undefined=>isPassiveId(id)?PASSIVES[id]:undefined;
