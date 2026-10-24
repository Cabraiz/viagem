/**
 * The enemies' dating-app profiles (card nome-inimigo-rede-social): the age, the bio (with its emoji, as in the chosen
 * mockup) and the message in the photo's speech balloon of each roster kind that has a photo (public/art/perfis/<id>.webp,
 * scripts/import-perfis.mjs).
 * The name is the roster's (rules/enemy-roster.ts). Humor: design/HUMOR-ADULT-SWIM.md (D-047); no real person, brand,
 * song or anything sexual. Bio ≤ 66 chars, recado ≤ 28 (tests/client/perfis.test.ts).
 * Lote 1: the P0 of rounds 1–3, the P0 mini-bosses and the P0 bosses (22).
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
bebado:{idade:'47',bio:'Procuro alguém que me leve pra casa. Qualquer casa. 🍺',recado:'tu é poste? te abraçava'},
'estagiario-imortal':{idade:'19 (há 31 anos)',bio:'Efetivação prevista pra semana que vem desde 1994. ☕',recado:'posso pegar seu café?'},
'furry-de-convencao':{idade:'26',bio:'Não é fantasia. Paguei em 14 parcelas, agora é documento. 🐾',recado:'aceita abraço de pelúcia?'},
'ressaca-ambulante':{idade:'33',bio:'Domingo eterno. Prometi nunca mais beber. Ontem. 🥴',recado:'fala baixo, por favor'},
  // Enxame
'boleto-vivo':{idade:'vence hoje',bio:'Te procurei o mês inteiro. Agora é pessoal (e com juros). 💸',recado:'lembrou de mim, amor?'},
'bot-de-curtida':{idade:'fabricado ontem',bio:'Curto tudo. Inclusive você. Inclusive a sua queda. 👍',recado:'curti sua foto de 2013'},
'cachorro-de-madame':{idade:'4 (anos de spa)',bio:'Nunca pisei no chão. Mordo quem pisou. 💅',recado:'não encosta no casaco'},
pombos:{idade:'3 (cada)',bio:'Somos 40 e dividimos uma coxinha. Você é a coxinha. 😌',recado:'oi sumida, cadê o pão?'},
'rato-de-boteco':{idade:'2',bio:'Listras feitas de caneta. Rujo, mas sai um miado. 🐯',recado:'RAWR (é sério)'},
  // Palhaços
'bebado-do-karaoke':{idade:'51',bio:'Só canto uma. Já são 4 h e ainda é a mesma. 🎤',recado:'faz o dueto comigo?'},
'chefe-pizza':{idade:'44',bio:'Gestor de pessoas e de borda recheada. Bora alinhar? 🍕',recado:'tem 5 min? é rápido'},
'cliente-do-gerente':{idade:'52',bio:'Já fui atendida. Mal. Quero o gerente do gerente. 😤',recado:'cadê o responsável?'},
'cunhado-sabe-tudo':{idade:'39',bio:'Vi um vídeo. Agora sou engenheiro, médico e juiz. 🤓',recado:'na verdade, é assim ó'},
'primo-do-violao':{idade:'23',bio:'Sei 3 acordes e 1 música. A música é longa. 🎸',recado:'posso tocar só uma?'},
quadrilheiro:{idade:'35',bio:'Meu par é um espantalho. Ele dança melhor e sabe disso. 🤠',recado:'olha a cobra! é mentira'},
'tio-pave':{idade:'58',bio:'É pavê ou pra comer? Pergunto isso há 30 anos. 😏',recado:'é pavê ou pra comer?'},
  // Mini-chefes
'pombo-rei':{idade:'12 (reinado vitalício)',bio:'Herdei a praça. Meu único súdito é o farelo. 👑',recado:'ajoelha e traz pão'},
'rei-do-boteco':{idade:'61',bio:'Dono do balcão, da saideira e da sua conta pendurada. 🔔',recado:'a saideira é tua'},
'trio-eletrico':{idade:'modelo 98',bio:'Sem motorista desde o carnaval de 2011. Ainda tocando. 🎉',recado:'SAI DA FRENTE (com amor)'},
  // Chefes
chefe:{idade:'64',bio:'Multo você por existir. Em ata, com firma reconhecida. 📋',recado:'barulho após as 22 h?'},
'dj-do-fim-do-mundo':{idade:'40',bio:'Meu drop derruba prédio. Literalmente. Chama a defesa civil. 🎧',recado:'segura que o drop vem'},
'o-grande-credor':{idade:'eterno',bio:'Você me deve desde antes de nascer. Parcelo seu fim em 12x. 🤑',recado:'e aquele pix, hein?'},
});
