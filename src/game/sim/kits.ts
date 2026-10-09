/**
 * Class kits (VGM-044A/B): starting weapon, passive class bonus and active skill data for all 36 classes.
 * classBonus feeds computeStats/refreshStats/openChest (D-005). Skill effects live in skills.ts.
 * Unknown class ids fall back to DEFAULT_KIT.
 */
import type {PlayerBuild} from './types.ts';
import type {ClassBonus} from './stats.ts';

export type KitRole='Linha de frente'|'Dano'|'Suporte'|'Controle';

export interface ClassKit {
  classId:string;
  role:KitRole;
  /** One of the fixed weapon ids (VGM-035). */
  weapon:string;
  classBonus:ClassBonus;
  skill:{
    /** Matches the skill name shown on the class card (src/classes.ts). */
    name:string;
    /** Base cooldown in seconds, before stats.cooldown. */
    cooldown:number;
    /** Short pt-BR description of what it actually does in combat. */
    effect:string;
  };
  /** Funny pt-BR lines shown when the skill is cast. */
  lines:readonly string[];
}

export const KITS:readonly ClassKit[]=Object.freeze([
  {
    classId:'cidadao-comum',role:'Linha de frente',weapon:'chinelo',
    classBonus:{maxHp:10,armor:1},
    skill:{name:'Só Estou de Passagem',cooldown:12,
      effect:'Dá um passo à frente, empurra os bichos em volta e protege os aliados próximos; quanto mais confusão, mais tempo.'},
    lines:['Com licença, só vou ali comprar pão.','Eu nem queria estar aqui.','Opa, foi mal, tô passando!','Isso não estava no meu dia.'],
  },
  {
    classId:'mendigo',role:'Suporte',weapon:'guarda-chuva',
    classBonus:{luck:0.2,magnet:0.5,regen:0.2},
    skill:{name:'Tesouro do Achados',cooldown:20,
      effect:'Monta um abrigo de papelão: cura e protege os aliados por perto e, no meio do round, ainda acha uma coxinha ou um ímã.'},
    lines:['Isso aqui ainda dá jogo.','Papelão é tecnologia, confia.','Abrigo cinco estrelas, sem taxa de serviço.','Engenharia de reaproveitamento!'],
  },
  {
    classId:'viciado-em-bet',role:'Dano',weapon:'boleto',
    classBonus:{luck:0.3,might:0.1,maxHp:-10},
    skill:{name:'Odd Impossível',cooldown:15,
      effect:'Joga dados mágicos no bicho tocado (ou no mais perto): dano garantido e um extra que depende dos dados. Não custa nada além da recarga.'},
    lines:['Dessa vez é certeza. Eu acho.','Os dados nunca mentem. Mentem sim.','Calculei tudo de cabeça.','Probabilidade é questão de fé.'],
  },
  {
    classId:'clt-cansado',role:'Linha de frente',weapon:'cafe',
    classBonus:{maxHp:30,armor:2,moveSpeed:-0.1},
    skill:{name:'Hora Extra',cooldown:18,
      effect:'Fica invulnerável por um tempo e puxa a atenção dos bichos em volta.'},
    lines:['Isso entra no banco de horas?','Só vou responder esse e-mail.','Sextou? Não. É segunda.','Reunião que podia ser mensagem.'],
  },
  {
    classId:'motogirl',role:'Suporte',weapon:'pombo',
    classBonus:{moveSpeed:0.2,magnet:0.3},
    skill:{name:'Entrega Expressa',cooldown:14,
      effect:'Voa até o aliado mais machucado, atropela os bichos no caminho e entrega uma cura. Sozinha, come o próprio pedido.'},
    lines:['Tô na porta. Qual é o portão?','Pedido saiu pra entrega!','Cinco estrelas, por favor.','Sem troco pra cem, hein.'],
  },
  {
    classId:'vizinha-fofoqueira',role:'Controle',weapon:'audio',
    classBonus:{area:0.15,luck:0.1},
    skill:{name:'Já Fiquei Sabendo',cooldown:16,
      effect:'Espalha a fofoca: os 5 bichos mais perto ficam lentos e levam um dano de vergonha.'},
    lines:['Não sou de falar, mas...','Você não ouviu isso de mim.','Menina, você não sabe da maior!','Tá todo mundo comentando.'],
  },
  // ----- VGM-044B: the other 30 classes -----
  {
    classId:'pedreiro',role:'Linha de frente',weapon:'chinelo',
    classBonus:{maxHp:25,armor:2,moveSpeed:-0.05},
    skill:{name:'Puxadinho Tático',cooldown:16,
      effect:'Ergue um puxadinho na frente: empurra os bichos do arco, derruba os tiros inimigos ali e fica protegido por um instante.'},
    lines:['Vou só levantar uma paredinha aqui.','Fica pronto semana que vem. Juro.','Quem pegou meu nível de bolha?','Essa parede aguenta. Confia no prumo.'],
  },
  {
    classId:'passageira',role:'Linha de frente',weapon:'guarda-chuva',
    classBonus:{moveSpeed:0.15,armor:1,maxHp:10},
    skill:{name:'Dá Licença',cooldown:12,
      effect:'Avança uns 3 passos pela multidão, empurra quem estiver em volta e fica protegida durante a manobra.'},
    lines:['Licença, licença, vou descer!','Aperta o sinal pra mim, por favor!','Dá um passinho pra trás, gente.','Segura que o motorista é piloto.'],
  },
  {
    classId:'porteiro',role:'Linha de frente',weapon:'cafe',
    classBonus:{maxHp:20,armor:2},
    skill:{name:'Nome na Lista',cooldown:18,
      effect:'Fica protegido, chama a atenção dos bichos em volta e deixa todos eles lentos.'},
    lines:['Qual apartamento, por favor?','Deixa o documento aqui comigo.','Encomenda só com autorização.','Interfonei, ninguém atendeu.'],
  },
  {
    classId:'goleira',role:'Linha de frente',weapon:'guarda-chuva',
    classBonus:{armor:3,maxHp:15,moveSpeed:-0.05},
    skill:{name:'Muralha do Bairro',cooldown:15,
      effect:'Espalma tudo o que vem pela frente: derruba tiros inimigos, empurra os bichos e protege os aliados perto dela.'},
    lines:['Aqui é muralha, meu filho!','Bate que eu pego, pode bater!','Chuta de longe, vai, tenta!','Bola na área é minha, sai!'],
  },
  {
    classId:'maromba',role:'Dano',weapon:'chinelo',
    classBonus:{might:0.15,maxHp:15,moveSpeed:-0.05},
    skill:{name:'Última Repetição',cooldown:12,
      effect:'Golpe pesado bem de perto, à frente: muito dano e um empurrão que tira os bichos do lugar.'},
    lines:['Mais uma! Só mais umazinha!','Hoje é dia de perna e de chefe.','Foco, força e coqueteleira!','Tô usando esse aparelho, ó a toalha.'],
  },
  {
    classId:'streamer',role:'Dano',weapon:'pombo',
    classBonus:{might:0.1,speed:0.15},
    skill:{name:'Clipa Isso',cooldown:14,
      effect:'Acerta em sequência o bicho tocado e os 3 mais perto, e as armas disparam de novo na hora.'},
    lines:['Clipa isso, moderador!','Chat, foi tudo planejado.','Oi, mãe! Tô ao vivo agora!','Deixa o like e ativa o sininho!'],
  },
  {
    classId:'roqueira',role:'Dano',weapon:'audio',
    classBonus:{area:0.1,might:0.1},
    skill:{name:'Solo de Respeito',cooldown:13,
      effect:'Onda sonora em cone estreito e longo à frente: dano alto e um empurrãozinho.'},
    lines:['Aumenta, que isso aí é rock!','O síndico que lute!','Afinar? Vai assim mesmo!','Barulho? Isso é arte, vizinho.'],
  },
  {
    classId:'universitario',role:'Dano',weapon:'boleto',
    classBonus:{cooldown:-0.08,might:0.05,maxHp:-10},
    skill:{name:'Prazo Final',cooldown:10,
      effect:'Rajada de última hora: acerta até 6 bichos por perto e todas as armas disparam de novo na hora.'},
    lines:['Trabalho em grupo e só eu fiz.','Professor, o arquivo corrompeu!','Sétimo café do dia, bora.','Slide final: obrigado pela atenção.'],
  },
  {
    classId:'sensei',role:'Dano',weapon:'chinelo',
    classBonus:{might:0.1,armor:1,moveSpeed:0.05},
    skill:{name:'Combo da Garagem',cooldown:11,
      effect:'Três golpes seguidos no bicho tocado (ou no mais perto); se os três acertarem e ele aguentar, fica atordoado (o chefe não).'},
    lines:['Faixa preta em fugir de boleto.','Primeiro a reverência. Depois o golpe.','Kiai! Foi mal, vizinho.','Concentra. Mira. Chinelada.'],
  },
  {
    classId:'rei-pastel',role:'Dano',weapon:'cafe',
    classBonus:{might:0.1,area:0.1},
    skill:{name:'Óleo no Fogo',cooldown:14,
      effect:'Arremessa um pacote fumegante no bicho tocado (ou no mais perto): dano em área e todo mundo ali fica lento.'},
    lines:['Pastel de vento aqui não tem!','Caprichei no recheio, toma!','Cuidado que o óleo tá pelando!','Vai um caldo de cana pra acompanhar?'],
  },
  {
    classId:'gamer-mobile',role:'Dano',weapon:'pombo',
    classBonus:{speed:0.1,luck:0.1,cooldown:-0.05},
    skill:{name:'Modo Tryhard',cooldown:12,
      effect:'Dois toques rápidos em cada um dos 2 bichos mais perto (o tocado primeiro), e as armas disparam de novo na hora.'},
    lines:['Foi o ping, eu juro!','Bateria em 3%, é agora ou nunca!','Peraí, o Wi-Fi caiu de novo.','Tela rachada e mesmo assim acertei!'],
  },
  {
    classId:'rainha-bateria',role:'Dano',weapon:'audio',
    classBonus:{might:0.1,moveSpeed:0.1},
    skill:{name:'Virada de Carnaval',cooldown:14,
      effect:'Pulso em volta dela: dano em todos os bichos perto e um empurrão para abrir a roda.'},
    lines:['Esquenta, bateria!','Ninguém atravessa o samba aqui!','Paradinha... e volta!','Dez, nota dez! Pro chefe, zero!'],
  },
  {
    classId:'tio-do-churrasco',role:'Suporte',weapon:'cafe',
    classBonus:{maxHp:15,regen:0.3},
    skill:{name:'Ponto Perfeito',cooldown:20,
      effect:'Serve um espetinho para a turma: cura bem os aliados em volta (ele incluso).'},
    lines:['Sai da frente da churrasqueira!','Pega um pão de alho e senta aí.','Calma, a carne tá descansando.','Quem ficou de trazer o gelo? Ninguém?'],
  },
  {
    classId:'feirante',role:'Suporte',weapon:'guarda-chuva',
    classBonus:{luck:0.15,magnet:0.3},
    skill:{name:'É Pra Acabar',cooldown:16,
      effect:'Distribui fruta: cura um pouco os aliados em volta e as armas de todos ali disparam de novo na hora.'},
    lines:['Olha a xepa, freguesia!','Pode provar, freguês, tá docinha!','Leva a caixa que eu faço um precinho.','Três por dez, só hoje, é pra acabar!'],
  },
  {
    classId:'coach',role:'Suporte',weapon:'audio',
    classBonus:{area:0.05,cooldown:-0.05,luck:0.05},
    skill:{name:'Mude o Mindset',cooldown:18,
      effect:'Palestra relâmpago: aliados em volta ficam protegidos por um instante e recuperam um pouco de vida.'},
    lines:['Você não perdeu, você aprendeu!','Sai da zona de conforto, bora!','Visualiza a vitória. Agora corre.','Gratidão pelo dano recebido.'],
  },
  {
    classId:'vendedor-praia',role:'Suporte',weapon:'pombo',
    classBonus:{moveSpeed:0.15,regen:0.2},
    skill:{name:'Olha a Água',cooldown:16,
      effect:'Água gelada para todo mundo: cura os aliados numa área grande em volta.'},
    lines:['Água, mate, biscoito de polvilho!','Tá trincando de gelada, ó!','Passa no cartão, sem problema!','Protetor? Tenho. Cadeira? Também.'],
  },
  {
    classId:'tia-festa',role:'Suporte',weapon:'cafe',
    classBonus:{maxHp:20,revive:0.25},
    skill:{name:'Levanta e Vem',cooldown:20,
      effect:'Cura os aliados em volta e, nos caídos por perto, adianta o resgate e dá mais 5 s antes de sangrarem (até o dobro do tempo normal).'},
    lines:['Levanta, que essa música é boa!','Leva um pratinho pra viagem!','Nossa, como você cresceu!','Vem tirar foto com a tia!'],
  },
  {
    classId:'pagodeiro',role:'Suporte',weapon:'audio',
    classBonus:{regen:0.4,cooldown:-0.05},
    skill:{name:'Deixa Acontecer',cooldown:18,
      effect:'Puxa o refrão: cura um pouco os aliados em volta e adianta em 3 s a habilidade deles (nunca antes da metade da recarga; não vale para quem também adianta).'},
    lines:['Bate na palma da mão, galera!','Segura o tantã que eu puxo o refrão!','Puxa o cavaco que o clima é bom!','Roda boa não tem hora pra acabar.'],
  },
  {
    classId:'merendeira',role:'Suporte',weapon:'cafe',
    classBonus:{maxHp:20,regen:0.2},
    skill:{name:'Prato Reforçado',cooldown:14,
      effect:'Prato cheio para o aliado mais machucado por perto (ela inclusa): cura forte e proteção curta. Ninguém ferido, nada acontece.'},
    lines:['Fila organizada, um de cada vez!','Hoje tem macarronada, bora!','Repete quem raspou o prato!','Sem bagunça no refeitório!'],
  },
  {
    classId:'mae-pet',role:'Suporte',weapon:'pombo',
    classBonus:{magnet:0.4,luck:0.1},
    skill:{name:'Cadê o Neném',cooldown:18,
      effect:'O pet busca uma coxinha e larga ao lado do aliado mais machucado por perto. Só durante o round.'},
    lines:['Vai, neném, busca pra mamãe!','Ele é dócil, só é carente.','Quem é o bebê mais lindo? É você!','Larga isso, menino! Larga!'],
  },
  {
    classId:'salva-vidas',role:'Suporte',weapon:'guarda-chuva',
    classBonus:{moveSpeed:0.1,maxHp:10},
    skill:{name:'Segura a Boia',cooldown:16,
      effect:'Joga a boia no aliado mais machucado em alcance: puxa ele até 3 passos para perto (menos quem está resgatando alguém), cura um pouco e protege. Ninguém ferido, nada acontece.'},
    lines:['Segura a boia e não solta!','Bandeira vermelha, pessoal!','Volta pro raso, por favor!','Piiii! Sai daí agora!'],
  },
  {
    classId:'tecnico-ti',role:'Controle',weapon:'audio',
    classBonus:{area:0.1,duration:0.1},
    skill:{name:'Reinicia Isso',cooldown:16,
      effect:'Pulso em volta: os bichos perto travam por um instante (o chefe não), ficam lentos e levam um dano leve.'},
    lines:['Já tentou desligar e ligar de novo?','Abre um chamado, por favor.','Tá instalando atualização, aguarde.','Quem tirou esse cabo da tomada?'],
  },
  {
    classId:'faxineira',role:'Controle',weapon:'chinelo',
    classBonus:{area:0.1,armor:1},
    skill:{name:'Passa o Rodo',cooldown:14,
      effect:'Varre um arco largo à frente: dano, empurrão e limpeza dos tiros inimigos ali.'},
    lines:['Tira o pé, que o chão tá molhado!','Quem sujou, limpa. Simples.','Isso aí é sujeira de semanas.','Licença, vou passar o pano aí.'],
  },
  {
    classId:'concurseira',role:'Controle',weapon:'boleto',
    classBonus:{duration:0.1,luck:0.1},
    skill:{name:'Questão Anulada',cooldown:20,
      effect:'Anula o bicho tocado (ou o mais perto): cancela o próximo ataque avisado dele (no mesmo bicho, no máximo um a cada 6 s), trava ele e dá um dano leve. O chefe não trava.'},
    lines:['Pegadinha clássica de prova.','Recurso deferido, questão anulada!','Isso tá no edital, página 47.','Na dúvida, marca a C.'],
  },
  {
    classId:'caca-promocao',role:'Controle',weapon:'pombo',
    classBonus:{cooldown:-0.1,luck:0.1},
    skill:{name:'Cupom Acumulado',cooldown:18,
      effect:'Cupom para a turma em volta: armas disparam de novo na hora e a habilidade dos aliados volta 4 s mais cedo (nunca antes da metade da recarga; não vale para quem também adianta).'},
    lines:['Leve três, pague dois!','Cupom de energia, gente!','Frete grátis acima de três chefes.','Ontem tava mais barato, viu?'],
  },
  {
    classId:'gambiarreiro',role:'Controle',weapon:'cafe',
    classBonus:{area:0.05,duration:0.15},
    skill:{name:'Fita Resolve',cooldown:16,
      effect:'Armadilha de fita: os 4 bichos mais perto (o chefe por último) ficam presos por um tempo e levam um dano leve.'},
    lines:['Fita isolante resolve tudo.','Não encosta, que tá funcionando.','É provisório. Desde 2019.','Um clipe, um elástico e pronto.'],
  },
  {
    classId:'astrologa',role:'Controle',weapon:'audio',
    classBonus:{area:0.1,duration:0.1},
    skill:{name:'Mercúrio Retrógrado',cooldown:17,
      effect:'Os 10 bichos mais perto ficam lentos por um bom tempo e levam um dano leve.'},
    lines:['Culpa do Mercúrio, não minha.','Esse chefe é muito escorpiano.','Os astros mandaram eu fazer isso.','Hoje a lua tá contra você, viu?'],
  },
  {
    classId:'rei-arraia',role:'Controle',weapon:'chinelo',
    classBonus:{maxHp:10,moveSpeed:0.1},
    skill:{name:'Olha a Cobra',cooldown:13,
      effect:'Grita "olha a cobra": empurra para longe todos os bichos em volta, com um dano leve.'},
    lines:['Olha a cobra! É mentira!','Olha a chuva! Ih, é verdade!','Anarriê, pessoal, pro lado!','Balancê, que o chefe tá parado!'],
  },
  {
    classId:'aposentado',role:'Controle',weapon:'boleto',
    classBonus:{armor:1,area:0.05},
    skill:{name:'No Meu Tempo',cooldown:12,
      effect:'Bengalada no bicho tocado (ou no mais perto): dano, empurra para longe e trava ele por um instante (o chefe não trava).'},
    lines:['No meu tempo o chefe tinha modos.','Senta que lá vem história.','Peguei um desse no rio, maiorzão.','Isso aí eu vi em setenta e oito.'],
  },
  {
    classId:'conspiracionista',role:'Controle',weapon:'guarda-chuva',
    classBonus:{luck:0.15,magnet:0.2},
    skill:{name:'Eu Já Sabia',cooldown:15,
      effect:'Sensor de longo alcance: os 6 bichos mais perto ficam lentos e levam um dano leve.'},
    lines:['Coincidência? Acho que não.','Eles não querem que você saiba.','O chefe é um robô. Repara.','Tá tudo conectado, olha o mapa!'],
  },
] as ClassKit[]);

/** Plain fallback for unknown class ids: chinelo, no bonus, no skill. */
export const DEFAULT_KIT:Readonly<Omit<ClassKit,'skill'|'role'>&{skill?:undefined}>=Object.freeze({
  classId:'',weapon:'chinelo',classBonus:{},lines:[],
});

const byClass=new Map(KITS.map(kit=>[kit.classId,kit]));

export const kitFor=(classId:string):ClassKit|undefined=>byClass.get(classId);

/** D-005 hook: the class bonus for SimPlayer.classBonus. A fresh copy, safe to store on the player. */
export const classBonusOf=(classId:string):ClassBonus=>({...(kitFor(classId)?.classBonus??DEFAULT_KIT.classBonus)});

/** Build a new player starts the run with: the kit weapon at level 1, no passives. */
export const startingBuild=(classId:string):PlayerBuild=>({
  weapons:[{id:(kitFor(classId)??DEFAULT_KIT).weapon,level:1}],passives:[],
});
