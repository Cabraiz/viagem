/**
 * The enemies' dating-app profiles (card nome-inimigo-rede-social): the age, the bio (no emoji: the design lint bars them
 * in code, D-020) and the message in the photo's speech balloon of each roster kind that has a photo (public/art/perfis/<id>.webp,
 * scripts/import-perfis.mjs).
 * The name is the roster's (rules/enemy-roster.ts). Humor: design/HUMOR-ADULT-SWIM.md (D-047); no real person, brand,
 * song or anything sexual. Bio ≤ 66 chars, recado ≤ 28 (tests/client/perfis.test.ts).
 * Lote 1: the P0 of rounds 1–3, the P0 mini-bosses and the P0 bosses (22). Lote 2: the other P0 with art (47).
 * Lote 3: the P1 with art (63). Lote 4: the P2 with art (27).
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
  // Lote 3: os P1 com arte. Corredores
'rodinho-do-sinal':{idade:'38 (no sinal: 3 min)',bio:'Limpo seu vidro em 40 s. Minha alma tá suja desde 1998.',recado:'deixa eu limpar teu vidro'},
'garcom-equilibrista':{idade:'29',bio:'Equilibro 30 garrafas e um coração partido. Os 10% são opcionais.',recado:'vai querer os 10%?'},
'skatista-de-47':{idade:'47 (alma de 15)',bio:'Ainda acerto o ollie. A coluna é que não acerta mais.',recado:'tu viu essa manobra?'},
'vendedor-de-caixao':{idade:'58',bio:'Consórcio de caixão em 120x. A última parcela é você.',recado:'já pensou no seu futuro?'},
'cofre-mimico':{idade:'1952 (o segredo)',bio:'Por fora, sigiloso. Por dentro, um velhinho contando moedas.',recado:'adivinha a minha senha'},
'fiscal-da-garagem':{idade:'61',bio:'Sua vaga tem 2,30 m. Seu carro, 2,31. Precisamos conversar.',recado:'tá fora da faixa, amor'},
'peladeiro-de-vidro':{idade:'36 (joelho de 80)',bio:'Pelada todo sábado. Fisioterapia todo domingo.',recado:'passa a bola, devagar'},
'frango-de-academia':{idade:'2 (anos de treino)',bio:'Treino peito e braço todo dia. Perna? Nunca ouvi falar.',recado:'repara no meu bíceps'},
'glitter-senciente':{idade:'eterno',bio:'Uma vez na sua vida, nunca mais saio. Nem do tapete.',recado:'agora eu moro em você'},
'buraco-de-rua':{idade:'desde a última eleição',bio:'Me prometeram asfalto em todo mandato. Sigo esperando, aberto.',recado:'cai em mim, vai'},
  // Kamikazes
'ciclista-de-lycra':{idade:'44',bio:'Pedalo 120 km por domingo pra tomar um café e voltar.',recado:'olha minha média'},
'executivo-de-patinete':{idade:'35',bio:'Faço reunião, almoço e chego atrasado. Tudo de patinete.',recado:'te ligo em 5, tô em call'},
'entregador-matrioska':{idade:'27 (e 19, e 12, e 6)',bio:'Entrego qualquer coisa. Até a mim mesmo, em versões menores.',recado:'pedido seu: eu mesmo'},
'cafeteira-burnout':{idade:'12 (de expediente)',bio:'Trabalho das 6 às 23. Nunca limparam meu filtro.',recado:'mais um café? sério?'},
'cadeira-giratoria':{idade:'viúva desde a demissão',bio:'O dono foi embora numa sexta. Eu fiquei girando.',recado:'senta aqui, só um pouco'},
'madrinha-velociraptor':{idade:'34 (solteira)',bio:'Vou pegar o buquê. Quem estiver no caminho vira convidado ferido.',recado:'esse buquê é MEU'},
'gamer-rage-quit':{idade:'22',bio:'Não perdi, foi o lag. Também não perdi as outras 40.',recado:'gg, vou desinstalar'},
  // Palhaços
'taxista-reclamao':{idade:'59',bio:'O ar quebrou em 2009. O assunto não acabou desde então.',recado:'e esse calor, hein?'},
'filosofo-de-balcao':{idade:'52 (ou nada importa)',bio:'Já resolvi o universo três vezes. Sempre depois da quarta dose.',recado:'tu existe ou é ideia?'},
'forrozeiro-centrifugo':{idade:'41',bio:'Rodo até furar o chão. Te levo junto se quiser.',recado:'bora rodar, morena?'},
'palhaco-de-aniversario':{idade:'48 (cansado)',bio:'Faço cachorro de balão desde 1990. Ele também tá cansado.',recado:'quer um cachorrinho?'},
'dancinha-viral':{idade:'17 (de trend)',bio:'Danço a trend antes dela existir. Depois que acaba, congelo.',recado:'grava eu, rápido'},
  // Suporte
'camelo-pirata':{idade:'pirata há 300 anos',bio:'Relógio original, cabo original, eu original. Tudo pirata.',recado:'três por dez, marujo'},
'cobrador-do-busao':{idade:'49',bio:'Sou a catraca e a catraca sou eu. Pula e você vai ver.',recado:'tem trocado?'},
'rh-sorridente':{idade:'32 (sorrindo)',bio:'Aqui somos uma família. Por isso não tem aumento.',recado:'bora alinhar expectativas'},
'personal-gritao':{idade:'31',bio:'Mais uma série! Mais uma! Isso não era pergunta!',recado:'MAIS UMA, VAI!'},
'homem-surdo':{idade:'45',bio:'Bato na barriga, o bairro inteiro sabe que cheguei.',recado:'TÔ CHEGANDO! BUM!'},
  // Arremessadores
'vendedor-de-bala':{idade:'morto há 40 anos',bio:'Bala de menta, bala de coco, bala de alma. Três por um real.',recado:'aceita uma balinha?'},
'alambiqueiro':{idade:'60 (envelhecido)',bio:'Destilo desde menino. A tampa da minha cabeça já voou 3 vezes.',recado:'prova essa, é da boa'},
'coco-que-vende-gente':{idade:'colhido ontem',bio:'Vendo gente na praia. Não pergunta de onde veio.',recado:'quer com canudinho?'},
'tijolo-pai':{idade:'51',bio:'Construí essa família tijolo por tijolo. Literalmente.',recado:'filho meu não chora'},
'revendedora-de-catalogo':{idade:'43',bio:'Tenho o batom, o perfume e o boleto. Paga em 5 vezes.',recado:'olha a promoção, linda'},
'sapo-cururu':{idade:'12 (de brejo)',bio:'Canto na beira do rio. O rio pediu pra eu parar.',recado:'me beija, eu viro gente'},
  // Atiradores
'pichador-ninja':{idade:'24',bio:'Pinto uma porta na parede e atrás dela tem outra parede.',recado:'não me viu aqui'},
'auditor-das-sombras':{idade:'exercício de 2007',bio:'Achei um erro de 3 centavos na sua vida. Vamos conversar.',recado:'cadê o comprovante?'},
'zelador-hidraulico':{idade:'57',bio:'Conserto qualquer vazamento. Menos o do coração.',recado:'quer uma mangueirada?'},
  // Brutamontes
'homem-placa-do-fim':{idade:'o fim está próximo',bio:'O mundo acaba quinta. Remarcaram de novo pra quinta.',recado:'arrependa-se, amor'},
'homem-galao':{idade:'20 litros',bio:'Mato a sede do escritório inteiro. Ninguém me troca.',recado:'aceita um copinho?'},
'betoneira-ambulante':{idade:'35 (de obra)',bio:'Giro o dia inteiro. Parou de girar, endureci pra sempre.',recado:'quer ver eu girar?'},
'ratazana-mafiosa':{idade:'7 (anos de rato)',bio:'O bueiro é meu. A esquina é minha. Você vai ser meu.',recado:'proposta irrecusável'},
'caramujo-financiado':{idade:'faltam 360 parcelas',bio:'Casa própria nas costas. O banco ainda é dono do telhado.',recado:'fica pra jantar?'},
'jacare-do-bueiro':{idade:'40 (no esgoto)',bio:'Moro no bueiro da sua rua. De chapéu, porque sou educado.',recado:'boa noite, madame'},
'orelhao-zumbi':{idade:'em extinção',bio:'Ninguém me liga desde 2004. Ainda aceito ficha.',recado:'me liga, a cobrar mesmo'},
  // Invocadores
'despachante':{idade:'56 (com firma)',bio:'Resolvo seu documento em 3 dias. Úteis. De outro ano.',recado:'cadê o xerox?'},
'corretor-de-imoveis':{idade:'39',bio:'Apartamento de 1 m² com vista pra outro apartamento.',recado:'é um ótimo investimento'},
'reuniao-que-podia-ser-email':{idade:'1 h (podia ser 1 min)',bio:'Sou só 40 slides. Alguém me compartilha a tela?',recado:'tão me ouvindo?'},
'vo-tricoteira':{idade:'86',bio:'Tricotei um suéter pra você. E pra cidade. E pro mundo.',recado:'tá magrinho, come'},
'unboxer':{idade:'25',bio:'Abro caixa por profissão. Dentro de toda caixa tem outra caixa.',recado:'olha o que chegou!'},
'marimbondo-sindical':{idade:'em obra desde 2011',bio:'A obra parou, os marimbondos entraram em greve, eu fiquei.',recado:'cuidado, eu pico'},
  // Refletores
'rei-do-camarote':{idade:'26 (de camarote)',bio:'Camarote na calçada, champanhe de garrafa pet. Sou rei.',recado:'tá na minha lista?'},
'guru-do-linkedin':{idade:'24 (CEO de mim)',bio:'Acordo às 4h, choro às 5h, posto às 6h. Isso é liderança.',recado:'concorda? comenta SIM'},
'cosplayer':{idade:'33',bio:'Faço cosplay do síndico. Ninguém pediu. Ficou idêntico.',recado:'barulho depois das 22h?'},
  // Enxame
'grampeador-carente':{idade:'escritório de 1987',bio:'Grampeio tudo que amo. Por isso ninguém fica.',recado:'me deixa te grampear?'},
'trenzinho-da-festa':{idade:'18 (cada um)',bio:'Somos um só, de todos os tamanhos. Entra no trem.',recado:'olha o trenzinho!'},
  // Voadores
'ex-que-voltou':{idade:'o mesmo de sempre',bio:'Mudei. Não mudei nada. Mas tô aqui de novo.',recado:'oi... tá acordada?'},
'drone-ansioso':{idade:'8 % de bateria',bio:'Voo alto e entro em pânico. Pouso em árvore e choro.',recado:'tá todo mundo bem?'},
'urubu-fiscal':{idade:'48',bio:'Rodeio sua vida, esperando uma falha. Tenho paciência.',recado:'tá com nota fiscal?'},
  // Mini-chefes
'tia-do-pudim':{idade:'62 (dona do almoço)',bio:'Trago pudim pra todo almoço. O pudim não me larga mais.',recado:'come mais um pedaço'},
'bate-estaca':{idade:'15 t',bio:'Me apaixonei por um poste. Bato no chão até ele me notar.',recado:'poste, me nota, por favor'},
'gerente-regional':{idade:'50 (meta batida)',bio:'Bato a meta com o estagiário. O estagiário não bate mais nada.',recado:'tem um minutinho?'},
  // Chefes
'boitata-de-sacolinha':{idade:'lixo de 500 anos',bio:'Lenda da mata feita de sacolinha. Cada uma demora 400 anos.',recado:'leva uma sacolinha?'},
'mapinguari-do-shopping':{idade:'lenda (e cliente)',bio:'Saí da floresta pro shopping. A boca na barriga é pra promoção.',recado:'tá tudo 70% off?'},
'sogra-tita':{idade:'não interessa',bio:'Você não é bom o suficiente. Mas fica pro almoço.',recado:'cortou o cabelo, é?'},
  // Lote 4 (P2) — Corredores
'cobrador-fantasma':{idade:'morto desde 2009',bio:'Morri cobrando. Você ainda me deve R$ 37,50 de 2009.',recado:'lembra de mim? e da dívida?'},
'lagartixa-de-terno':{idade:'31 (o rabo: 2 semanas)',bio:'Subo pelas paredes da firma. Meu rabo foi promovido antes de mim.',recado:'vamos alinhar na parede?'},
'maratonista-eterno':{idade:'71 (largou com 23)',bio:'Larguei em 1978. Ninguém avisou que acabou. Não paro pra date.',recado:'corre comigo? não paro'},
'mico-da-dentadura':{idade:'6 (os dentes, 80)',bio:'Os dentes são do seu avô. O sorriso é todo meu.',recado:'sorri pra mim, vai'},
'noivo-em-fuga':{idade:'42 (15 de fuga)',bio:'Procuro algo casual. Muito casual. Sem altar, sem véu, sem mão.',recado:'você não é ela, né?'},
'quati-influencer':{idade:'3 (2 mi de seguidores)',bio:'Roubo seu lanche e posto. Você vira conteúdo, eu viro trend.',recado:'me marca na foto'},
'rolo-lava-rapido':{idade:'R$ 15 a ducha',bio:'Esfrego com carinho. Muito carinho. Sem parar. Por favor, saia.',recado:'quer cera também?'},
  // Kamikazes
'carrinho-da-vo':{idade:'83 (da vó)',bio:'Rodo a feira desde 1962 atrás do tomate perfeito. Você é ele?',recado:'cuidado, eu atropelo'},
  // Palhaços
'fa-de-novela':{idade:'58 (capítulo 9.412)',bio:'Já fui sequestrada, trocada na maternidade e tive amnésia. Na TV.',recado:'você é a gêmea má?'},
leiloeiro:{idade:'lance inicial: 45',bio:'Me vendo barato. Quem dá mais? Ninguém? Dou-lhe uma...',recado:'dou-lhe uma, dou-lhe duas'},
'servidor-fossilizado':{idade:'67 (34 de casa)',bio:'Atendo das 10h às 10h15. Tem que trazer a xerox autenticada.',recado:'volta amanhã, querida'},
'sommelier-de-ipa':{idade:'34',bio:'Sinto notas de manga, maracujá e superioridade moral.',recado:'isso aí é cerveja?'},
  // Suporte
'animador-necromante':{idade:'40 (morto há 3)',bio:'Animo festa infantil e defunto. A diferença é o bolo.',recado:'cadê a alegria, galera?'},
'bandeirinha-existencial':{idade:'44',bio:'Vivi impedido a vida toda. Ergo a bandeira e ninguém olha.',recado:'tá impedido, meu bem'},
'contador-de-almas':{idade:'contando...',bio:'Sua alma tá no vermelho desde 2015. Vamos conversar.',recado:'e a nota da sua alma?'},
'homem-wifi':{idade:'5 (2 barrinhas)',bio:'Conexão forte, sinal fraco. Se cair, desliga e liga de novo.',recado:'a senha tá atrás de mim'},
'podcaster-de-garagem':{idade:'38 (ep. 412)',bio:'Tenho 3 ouvintes. Dois são minha mãe em aparelhos diferentes.',recado:'cê já ouviu meu podcast?'},
'promotor-infinito':{idade:'29 (turno de 14 h)',bio:'Só um pedacinho. Mais um. Mais um. Você não sai daqui.',recado:'prova só um pedacinho'},
  // Arremessadores
'coelho-falsificado':{idade:'1 (Páscoa de 2019)',bio:'Chocolate 100% gordura vegetal. Orelha comprada no camelô.',recado:'é chocolate, juro'},
'geladeira-do-feijao':{idade:'27 (e a porta mole)',bio:'Pote de sorvete por fora, feijão por dentro. Igual a mim.',recado:'fecha a porta, menino!'},
'noiva-da-quadrilha':{idade:'22',bio:'Casei com um espantalho. Ele fugiu. Aceito propostas no arraiá.',recado:'quer casar? é rapidinho'},
  // Atiradores
'bebedouro-da-fofoca':{idade:'20 litros',bio:'Sei tudo de todo mundo da firma. Inclusive de você.',recado:'senta que lá vem fofoca'},
  // Brutamontes
'cupim-mansao':{idade:'120 (a casa)',bio:'Morava num casarão. Comi o casarão. Procuro onde morar.',recado:'sua casa é de madeira?'},
'engenheiro-obra-parada':{idade:'64 (a obra: 30)',bio:'Entrego mês que vem. Desde 1995. Falta só o resto.',recado:'semana que vem fica pronto'},
manobrista:{idade:'35',bio:'Estaciono qualquer coisa em qualquer vaga. Inclusive você.',recado:'deixa a chave comigo'},
  // Invocadores
'rapa-da-prefeitura':{idade:'48 (de carteira)',bio:'Apreendo mercadoria, coração e guarda-chuva. Sem nota, sem amor.',recado:'isso aí tem alvará?'},
  // Enxame
'domino-humano':{idade:'50 (cada um)',bio:'Se eu cair, cai a fila inteira. Por isso não me apaixono.',recado:'não encosta em mim!'},
});
