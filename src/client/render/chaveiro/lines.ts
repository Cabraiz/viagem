/**
 * D-047, card NEW-20261013-ORQ-chaveiro-falas: what the chaveiro, Dona Cida, the Tio (who locked the key in) and the
 * Quadradão (its alarm) say at each moment of the objective, in the zueiras' balloon. The lines are the only thing to
 * edit after the humour review: one table, [who speaks, line], 4 to 8 per moment, at most MAX_LINE_CHARS each
 * (tests/client/chaveiro-falas.test.ts). Pure: the picker is deterministic from a seed (every phone shows the same line).
 */

/** Who speaks: the chaveiro and Cida ride the moto, the Tio (the car's owner) stands beside it, 'carro' is the alarm. */
export type Speaker='chaveiro'|'cida'|'tio'|'carro';
/**
 * Where a speaker's balloon stands: the moto (with its riders), a fixed point beside the car (the Tio, at a standing
 * head's height, off the roof so his line and the alarm's never stack), over the car's roof (the alarm).
 */
export type Spot='moto'|'car-side'|'car';
export const SPEAKER_SPOT:Readonly<Record<Speaker,Spot>>={chaveiro:'moto',cida:'moto',tio:'car-side',carro:'car'};

/** A line of the table: who says it and what. */
export type Line=readonly [Speaker,string];
/** Every line fits the balloon on a 390 px phone (3 rows at most of its 280 px wrap). */
export const MAX_LINE_CHARS=60;

/**
 * The moments with lines: volta (the alarm: he rides around the block), morta, tranco (the team pushed it),
 * tranco-sozinha (it started by itself), lombada, entrega, tombo (a critter touched the moto), buy (Cida sold to the
 * team), sale (Cida sold to a critter), part (a part fell off the car), chefe (the boss was called), acordou (D-051:
 * a nest's band woke up; the game is the nests now, no waves), empurra and puxa (D-052: the team started pushing the
 * Quadradão, or hooked its rope), chegou, abrindo,
 * and the end: conector (opened, paid), divida (opened, the wheel as a guarantee), perda-total (the car is gone).
 */
export const CHAVEIRO_LINES={
  volta:[
    ['chaveiro','Isso é sirene? Vou dar uma voltinha rapidinho.'],
    ['chaveiro','Alarme não, pô. Tenho três pendências nesse bairro.'],
    ['chaveiro','Esse barulho me lembra uma audiência que eu faltei.'],
    ['chaveiro','Vou contornar a quadra. De novo. Por precaução.'],
    ['cida','Ele não foge da polícia. Ele só gosta de passear.'],
    ['carro','UÉÉÉ-UÉÉÉ (o Quadradão chora há três dias)'],
  ],
  morta:[
    ['chaveiro','Morreu. Ela é sentimental, só pega de empurrão.'],
    ['chaveiro','Empurra aí. Eu empurrava, mas tô de bag.'],
    ['chaveiro','A bateria é de segunda mão. A moto é de quinta.'],
    ['cida','Ela morre toda vez que o assunto é trabalho.'],
    ['chaveiro','Calma, ela só pega se alguém sofrer junto.'],
  ],
  tranco:[
    ['chaveiro','Pegou! Ninguém solta, ela é ciumenta.'],
    ['chaveiro','Funcionou. Não conta pra ela que eu duvidei.'],
    ['cida','Voltou! O cheiro de queimado é o normal.'],
    ['chaveiro','Obrigado, turma. A visita técnica continua cara.'],
  ],
  'tranco-sozinha':[
    ['chaveiro','Pegou sozinha. Foi o tapa. Sempre é o tapa.'],
    ['cida','Ela pega quando ninguém tá olhando. Igual ele.'],
    ['chaveiro','Pegou no tranco do desespero. Nunca falha.'],
    ['chaveiro','Ela pega quando percebe que vai ser empurrada.'],
  ],
  lombada:[
    ['chaveiro','Lombada. Eu respeito a lei quando é de cimento.'],
    ['chaveiro','Um quilômetro por hora. Pela suspensão, não por mim.'],
    ['cida','Devagar que o pudim tá sem tampa.'],
    ['chaveiro','Essa lombada é mais velha que o asfalto.'],
  ],
  entrega:[
    ['chaveiro','Rapidinho, é só um marmitex. São quinze.'],
    ['chaveiro','O cliente pediu sem cebola. Vou tirar com a mão.'],
    ['chaveiro','Entregando a janta de quem já morreu de fome.'],
    ['chaveiro','Quarenta minutos de atraso. Melhor tempo do mês.'],
    ['cida','Ele para pra entregar, eu paro pra vender.'],
  ],
  tombo:[
    ['chaveiro','Encostou na moto! Isso é patrimônio, viu?'],
    ['chaveiro','Caí. Não foi o bicho, foi a autoestima.'],
    ['chaveiro','Se arranhou a bag, entra no orçamento.'],
    ['cida','Minha cocada voou longe. Quem vai pagar?'],
  ],
  buy:[
    ['cida','Brigadeiro de panela. A panela também era do chão.'],
    ['cida','Paçoca prensada. Prensada na minha bolsa.'],
    ['cida','Cocada dura. Serve de doce ou de arma.'],
    ['cida','Aceito Grana, PIX e promessa. Promessa com juros.'],
    ['cida','Leva dois, que o segundo sai mais caro.'],
  ],
  sale:[
    ['cida','Dinheiro de bicho é dinheiro. Boleto não tem lado.'],
    ['cida','Ele pagou à vista. Vocês pedem fiado.'],
    ['cida','Cliente é cliente, mesmo com três bocas.'],
    ['cida','Ele comprou cocada. Agora te bate mais doce.'],
    ['cida','Fidelidade é pra quem dá gorjeta.'],
  ],
  part:[
    ['tio','O para-choque caiu. Era colado com chiclete.'],
    ['tio','Lá se vai o retrovisor. Eu nunca olhava mesmo.'],
    ['tio','A porta caiu. A chave ficou mais acessível.'],
    ['tio','Caiu o capô. O motor segue ligado. Guerreiro.'],
    ['chaveiro','Cada peça que cai é mais oito no orçamento.'],
  ],
  chefe:[
    ['tio','O ronco do motor acordou o síndico dos bichos.'],
    ['chaveiro','Esse grandão aí eu conheço. Também me deve.'],
    ['tio','Três dias de motor ligado e ninguém reclamou. Até agora.'],
    ['cida','Grandão! Cocada tamanho família pra ele.'],
  ],
  acordou:[
    ['tio','Acordou o ninho. Não fui eu, foi o motor. Eu só deixei.'],
    ['cida','Acordou freguês! Quem acorda com fome compra doce.'],
    ['chaveiro','Bicho acordado cobra mais caro. Igual eu de madrugada.'],
    ['tio','O ninho acordou. Eu ainda não achei a chave.'],
    ['cida','Bom dia, flor do lixão. Brigadeiro pra abrir o dia?'],
    ['chaveiro','Acordou a vizinhança. Visita noturna é taxa extra.'],
  ],
  empurra:[
    ['tio','Empurra com jeito, que a lataria é original.'],
    ['tio','Pode empurrar. O freio de mão é decorativo.'],
    ['chaveiro','Empurrando o carro? Aí o orçamento é outro.'],
    ['tio','Três dias ligado e agora vai no braço. Progresso.'],
    ['cida','Empurra pra cá, que aqui tem freguês.'],
  ],
  puxa:[
    ['tio','Puxa devagar, o para-choque é de chiclete.'],
    ['tio','Na corda! O Quadradão nunca teve tanta atenção.'],
    ['chaveiro','Reboque é cinquenta o quilômetro. Tô só falando.'],
    ['tio','Cuidado com a corda, era o varal da minha mãe.'],
    ['cida','Puxa que eu empurro. Mentira, tô vendendo.'],
  ],
  chegou:[
    ['chaveiro','Cheguei! A visita técnica é cinquenta, viu?'],
    ['chaveiro','Cadê o carro? Ah, esse amontoado aí?'],
    ['cida','Chegamos. Ele demorou, eu faturei.'],
    ['chaveiro','Dez minutos é modo de dizer. Foi modo de fazer.'],
  ],
  abrindo:[
    ['chaveiro','Essa fechadura é mais teimosa que eu.'],
    ['chaveiro','Abrir leva três segundos. O resto é o preço.'],
    ['chaveiro','Não olha, é segredo profissional. E arame.'],
    ['chaveiro','Motor ligado há três dias e ninguém desligou?'],
  ],
  conector:[
    ['tio','É o carregador... do celular antigo. Não encaixa.'],
    ['tio','Meio bairro morreu por um carregador que não serve.'],
    ['tio','Alguém tem adaptador? Não? Tá. Valeu, pessoal.'],
    ['chaveiro','Abri. Se não encaixa, aí já é outro serviço.'],
  ],
  divida:[
    ['chaveiro','Faltou grana. Levo o volante de garantia.'],
    ['chaveiro','Sem volante vocês não fogem. Eu volto mês que vem.'],
    ['chaveiro','Paguem quando puder. O volante fica comigo até lá.'],
    ['tio','Ele levou o volante. O motor segue ligado.'],
  ],
  'perda-total':[
    ['tio','Perda total. Pelo menos a chave tá livre agora.'],
    ['chaveiro','O carro desmanchou. Mas a visita eu cobro igual.'],
    ['chaveiro','Não tem mais porta pra abrir. Serviço feito?'],
    ['chaveiro','Virou peça. Eu conheço um cara que compra.'],
  ],
} as const satisfies Record<string,readonly Line[]>;
export type LineEvent=keyof typeof CHAVEIRO_LINES;
export const LINE_EVENTS=Object.keys(CHAVEIRO_LINES) as LineEvent[];
/** The end of the run: always shown (no gap), once per run. */
export const END_EVENTS:ReadonlySet<LineEvent>=new Set<LineEvent>(['conector','divida','perda-total']);

/** A 32-bit mix of integers (FNV start, xorshift-multiply rounds): the same numbers give the same pick on every phone. */
export function hash32(...values:number[]):number{
  let h=0x811c9dc5;
  for(const v of values){h=Math.imul(h^(v|0),0x01000193);h^=h>>>15;h=Math.imul(h,0x2c1b3c6d);h^=h>>>12;}
  return h>>>0;
}
/** The room's seed for the lines: the room code mixed with the run's terrain seed. */
export function talkSeed(code:string,terrainSeed:number):number{
  let h=hash32(terrainSeed);
  for(let i=0;i<code.length;i++)h=hash32(h,code.charCodeAt(i));
  return h;
}

export interface PickedLine {event:LineEvent;index:number;speaker:Speaker;text:string;spot:Spot}
/**
 * The line of `event` for `seed` (mix the room's seed with a per-moment counter): never the line at index `last` (the
 * one shown last time for this moment), when the moment has more than one.
 */
export function pickLine(event:LineEvent,seed:number,last?:number):PickedLine{
  const lines:readonly Line[]=CHAVEIRO_LINES[event],n=lines.length,e=LINE_EVENTS.indexOf(event);
  let index=hash32(seed,e)%n;
  if(n>1&&index===last)index=(index+1+hash32(seed,e,0x5bd1e995)%(n-1))%n;
  const [speaker,text]=lines[index];
  return {event,index,speaker,text,spot:SPEAKER_SPOT[speaker]};
}
