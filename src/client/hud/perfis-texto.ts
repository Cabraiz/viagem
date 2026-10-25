/**
 * The enemies' dating-app profiles (card nome-inimigo-rede-social): the age, the bio (no emoji: the design lint bars them
 * in code, D-020) and the message in the photo's speech balloon of each roster kind that has a photo (public/art/perfis/<id>.webp,
 * scripts/import-perfis.mjs).
 * The name is the roster's (rules/enemy-roster.ts). Humor: design/HUMOR-ADULT-SWIM.md (D-047); no real person, brand,
 * song or anything sexual. Bio ≤ 66 chars, recado ≤ 28 (tests/client/perfis.test.ts).
 * Lote 1: the P0 of rounds 1–3, the P0 mini-bosses and the P0 bosses (22). Lote 2: the other P0 with art (47).
 */
export interface PerfilTexto {
  /** "47", or a joke in place of the number ("vence hoje"). */
  idade:string;
  bio:string;
  /** The speech balloon on the photo: the first thing it says to you. */
  recado:string;
}

export const PERFIS_TEXTO:Readonly<Record<string,PerfilTexto>>=Object.freeze({
  // Corredores (rodadas 1–3)
bebado:{idade:'47',bio:'Procuro alguém que me leve pra casa. Qualquer casa.',recado:'tu é poste? te abraçava'},
'estagiario-imortal':{idade:'19 (há 31 anos)',bio:'Efetivação prevista pra semana que vem desde 1994.',recado:'posso pegar seu café?'},
'furry-de-convencao':{idade:'26',bio:'Não é fantasia. Paguei em 14 parcelas, agora é documento.',recado:'aceita abraço de pelúcia?'},
'ressaca-ambulante':{idade:'33',bio:'Domingo eterno. Prometi nunca mais beber. Ontem.',recado:'fala baixo, por favor'},
  // Enxame
'boleto-vivo':{idade:'vence hoje',bio:'Te procurei o mês inteiro. Agora é pessoal (e com juros).',recado:'lembrou de mim, amor?'},
'bot-de-curtida':{idade:'fabricado ontem',bio:'Curto tudo. Inclusive você. Inclusive a sua queda.',recado:'curti sua foto de 2013'},
'cachorro-de-madame':{idade:'4 (anos de spa)',bio:'Nunca pisei no chão. Mordo quem pisou.',recado:'não encosta no casaco'},
pombos:{idade:'3 (cada)',bio:'Somos 40 e dividimos uma coxinha. Você é a coxinha.',recado:'oi sumida, cadê o pão?'},
'rato-de-boteco':{idade:'2',bio:'Listras feitas de caneta. Rujo, mas sai um miado.',recado:'RAWR (é sério)'},
  // Palhaços
'bebado-do-karaoke':{idade:'51',bio:'Só canto uma. Já são 4 h e ainda é a mesma.',recado:'faz o dueto comigo?'},
'chefe-pizza':{idade:'44',bio:'Gestor de pessoas e de borda recheada. Bora alinhar?',recado:'tem 5 min? é rápido'},
'cliente-do-gerente':{idade:'52',bio:'Já fui atendida. Mal. Quero o gerente do gerente.',recado:'cadê o responsável?'},
'cunhado-sabe-tudo':{idade:'39',bio:'Vi um vídeo. Agora sou engenheiro, médico e juiz.',recado:'na verdade, é assim ó'},
'primo-do-violao':{idade:'23',bio:'Sei 3 acordes e 1 música. A música é longa.',recado:'posso tocar só uma?'},
quadrilheiro:{idade:'35',bio:'Meu par é um espantalho. Ele dança melhor e sabe disso.',recado:'olha a cobra! é mentira'},
'tio-pave':{idade:'58',bio:'É pavê ou pra comer? Pergunto isso há 30 anos.',recado:'é pavê ou pra comer?'},
  // Mini-chefes
'pombo-rei':{idade:'12 (reinado vitalício)',bio:'Herdei a praça. Meu único súdito é o farelo.',recado:'ajoelha e traz pão'},
'rei-do-boteco':{idade:'61',bio:'Dono do balcão, da saideira e da sua conta pendurada.',recado:'a saideira é tua'},
'trio-eletrico':{idade:'modelo 98',bio:'Sem motorista desde o carnaval de 2011. Ainda tocando.',recado:'SAI DA FRENTE (com amor)'},
  // Chefes
chefe:{idade:'64',bio:'Multo você por existir. Em ata, com firma reconhecida.',recado:'barulho após as 22 h?'},
'dj-do-fim-do-mundo':{idade:'40',bio:'Meu drop derruba prédio. Literalmente. Chama a defesa civil.',recado:'segura que o drop vem'},
'o-grande-credor':{idade:'eterno',bio:'Você me deve desde antes de nascer. Parcelo seu fim em 12x.',recado:'e aquele pix, hein?'},
  // Lote 2 — arremessadores, atiradores e suportes (meio da partida)
'anao-molotov':{idade:'1,20 m de pavio curto',bio:'Explosivo, mas só por fora. Por dentro também.',recado:'tem isqueiro? o meu acabou'},
agiota:{idade:'45 (+10% ao mês)',bio:'Empresto dinheiro e o sobrenome da sua avó como garantia.',recado:'lembra de mim? eu lembro'},
coach:{idade:'30 (mentalidade de 3)',bio:'Transformo sua dor em boleto. Você é o seu único limite.',recado:'acorda às 4 h comigo?'},
'ambulante-guarda-chuva':{idade:'40',bio:'Vendo guarda-chuva antes da chuva, durante o fim do mundo.',recado:'vai chover piano hoje'},
'malabarista-do-sinal':{idade:'28 (e o de 9)',bio:'Faço malabares no sinal. Meu clone faz no meu ombro.',recado:'sinal fechou, me nota'},
'tiozinho-da-sinuca':{idade:'67',bio:'Um olho na bola, outro no bueiro. Nunca perdi de verdade.',recado:'apostamos a sua janta?'},
marronzinho:{idade:'50',bio:'Já multei uma ambulância, um carro de boi e minha mãe.',recado:'parou em cima da faixa'},
pamonheiro:{idade:'38 decibéis',bio:'Pamonha fresquinha, pamonha caseira. Só sei dizer isso.',recado:'PAMONHA! (oi, tudo bem?)'},
'espetinho-suspeito':{idade:'35',bio:'Não pergunta de que é. Eu também não sei, mas tá barato.',recado:'quer com farofa?'},
carimbador:{idade:'59 (em 3 vias)',bio:'Sem carimbo não existo. Sem fila, também não.',recado:'falta uma assinatura'},
telemarketing:{idade:'24',bio:'Atendo 40 linhas ao mesmo tempo. Todas te oferecendo plano.',recado:'tem 1 minutinho, senhor?'},
subsindico:{idade:'62',bio:'Deixo bilhete no elevador. Sobre o barulho do bilhete.',recado:'seu tapete tá torto'},
'vizinho-da-furadeira':{idade:'48',bio:'Furo parede todo domingo às 7 h. Nunca pendurei nada.',recado:'acordou? que bom!'},
'gerente-vampiro':{idade:'312',bio:'Taxa de manutenção na sua alma. Pode pagar no débito.',recado:'aceita um cartão novo?'},
'impressora-possuida':{idade:'modelo 2003',bio:'Só funciono quando você não precisa. Sinto o seu medo.',recado:'papel atolado (mentira)'},
'robo-de-atendimento':{idade:'v0.1 beta',bio:'Não entendi. Digite 1 para eu continuar sem entender.',recado:'não entendi, pode repetir?'},
'tia-do-zap':{idade:'63',bio:'Bom dia com flor e corrente. Se não passar pra 10, já era.',recado:'BOM DIA (encaminhada)'},
'sogra-do-chinelo':{idade:'66',bio:'Mira infalível desde 1979. O chinelo sempre volta.',recado:'vem cá que eu não bato'},
'hater-anonimo':{idade:'?? (perfil sem foto)',bio:'Comento em tudo. Nunca li nada. Grama, nunca vi.',recado:'ninguém perguntou, mas'},
'juiz-vendido':{idade:'52',bio:'Imparcial: aceito pix dos dois times.',recado:'foi pênalti (pra quem paga)'},
fogueteiro:{idade:'41 (9 dedos)',bio:'Soltando rojão desde junho de 1998. Sem parar.',recado:'tapa o ouvido, amor'},
'poste-gambiarra':{idade:'1987 (sem vistoria)',bio:'Levo luz pro bairro todo. De graça e com faísca.',recado:'encosta não, dá choque'},
  // Kamikazes, voadores e invocadores
motoboy:{idade:'22',bio:'Entrego em 5 min ou chego dentro da sua cozinha.',recado:'tô na porta (tô não)'},
influencer:{idade:'27',bio:'Panturrilha de 3 dígitos. Dia de perna é todo dia.',recado:'me marca no stories'},
'flanelinha-interdimensional':{idade:'34 (em toda dimensão)',bio:'Olho seu carro em qualquer universo. Vai dar R$ 5.',recado:'pode vir, pode vir... vixe'},
perueiro:{idade:'50 (metade van)',bio:'Cabe mais um. Sempre cabe mais um. Até você.',recado:'sobe, que tem lugar!'},
'bebum-de-carrinho':{idade:'44',bio:'Meu carro é do mercado. Freio? Só se Deus quiser.',recado:'empurra eu, vai'},
grauzeiro:{idade:'19',bio:'Só ando numa roda. A outra é pra ocasião especial.',recado:'olha o grau, princesa'},
'moco-do-gas':{idade:'36',bio:'Toco a musiquinha às 7 h e você me ama mesmo assim.',recado:'olha o gás! (oi)'},
'paredao-ambulante':{idade:'29 (e 140 dB)',bio:'Levo a festa nas costas. O bairro inteiro escuta.',recado:'TÁ ME OUVINDO???'},
'barata-voadora':{idade:'3 semanas (ás desde já)',bio:'Piloto de caça. Meu inimigo é o chinelo.',recado:'pousei no seu ombro'},
'balao-rancoroso':{idade:'1 festa',bio:'Ninguém me soltou de propósito. Eu lembro de todos.',recado:'você me deixou ir'},
'pombo-tres-cabecas':{idade:'3 (a soma das três)',bio:'Somos três e nunca concordamos com o pão.',recado:'pão / pão / NÃO, BOLO'},
'guru-cripto':{idade:'25 (no metaverso, 90)',bio:'Comprei no topo. Vendi no fundo. Ensino o método.',recado:'vai pra lua, confia'},
'vendedor-de-piramide':{idade:'33',bio:'Seja seu próprio chefe. Eu sou seu chefe. Recruta 3.',recado:'oi sumido! oportunidade'},
'dj-de-casamento':{idade:'47',bio:'Sei todos os parabéns, o bota-fora e a dança da cadeira.',recado:'agora só os solteiros!'},
  // Brutamontes
'dono-do-boteco':{idade:'55',bio:'A conta pendurada do bairro todo tá no meu caderno.',recado:'vai fechar ou pendura?'},
'tio-do-isopor':{idade:'57',bio:'Gelada, mate e picolé. Na neve, na praia, no velório.',recado:'olha a gelada!'},
'caixa-eletronico':{idade:'fora de serviço',bio:'Não tenho notas de 50. Nem de 20. Nem paz.',recado:'insira o cartão. o seu.'},
'seguranca-de-shopping':{idade:'40',bio:'Sigo você do estacionamento até o banheiro. Por amor.',recado:'tá olhando o quê?'},
'leao-da-receita':{idade:'64 (declarados)',bio:'Pego 27,5 % de tudo, até do seu abraço.',recado:'declarou esse sorriso?'},
'bolo-vivo':{idade:'4 velas (e contando)',bio:'Tenho recheio de ressentimento. Ninguém me cortou ainda.',recado:'faz um pedido, rápido'},
'torcedor-fanatico':{idade:'38',bio:'Meu time perdeu de 7. Eu continuo perdendo junto.',recado:'é o meu time ou você'},
'crossfiteiro-do-pneu':{idade:'30',bio:'Levo meu pneu a todo lugar. Ele não me larga.',recado:'me vê levantando?'},
'boneco-gigante':{idade:'3 m de altura',bio:'Danço sozinho desde que o cara de dentro fugiu.',recado:'abraço de 3 metros?'},
'noel-derretendo':{idade:'70 (no calor, 80)',bio:'Ho ho ho. Tá 38 graus aqui dentro. Ho.',recado:'senta no meu colo não'},
'capivara-blindada':{idade:'8',bio:'Nada me tira do sério. Nem você, nem um tanque.',recado:'tá tudo bem. senta.'},
});
