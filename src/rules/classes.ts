export type Role = 'Linha de frente' | 'Dano' | 'Suporte' | 'Controle';
export interface HeroClass {
  id: string; name: string; subtitle: string; role: Role;
  skill: string; stats: [number, number, number, number]; art: number;
}
// Atlas: 6 colunas × 6 linhas. A ordem é um contrato com o prompt da arte.
export const classes: HeroClass[] = [
  {id:'cidadao-comum',name:'Cidadão',subtitle:'O básico também dá crítico.',role:'Linha de frente',skill:'Só Estou de Passagem',stats:[3,3,3,3],art:0},
  {id:'mendigo',name:'Mendigo',subtitle:'Improviso lendário.',role:'Suporte',skill:'Tesouro do Achados',stats:[2,3,4,3],art:1},
  {id:'viciado-em-bet',name:'Viciado em Bet',subtitle:'A sorte não leu o tutorial.',role:'Dano',skill:'Odd Impossível',stats:[4,2,5,1],art:2},
  {id:'clt-cansado',name:'CLT',subtitle:'Tanque em horário comercial.',role:'Linha de frente',skill:'Hora Extra',stats:[5,1,3,3],art:3},
  {id:'motogirl',name:'Motogirl',subtitle:'Sua salvação saiu para entrega.',role:'Suporte',skill:'Entrega Expressa',stats:[2,5,2,3],art:4},
  {id:'pedreiro',name:'Pedreiro',subtitle:'A obra é a defesa.',role:'Linha de frente',skill:'Puxadinho Tático',stats:[5,1,4,2],art:5},
  {id:'vizinha-fofoqueira',name:'Fofoqueira',subtitle:'Informação privilegiada.',role:'Controle',skill:'Já Fiquei Sabendo',stats:[1,3,5,3],art:6},
  {id:'tio-do-churrasco',name:'Tio do Churrasco',subtitle:'O suporte está no ponto.',role:'Suporte',skill:'Ponto Perfeito',stats:[3,1,3,5],art:7},
  {id:'maromba',name:'Maromba',subtitle:'Hoje é treino de chefe.',role:'Dano',skill:'Última Repetição',stats:[5,3,1,3],art:8},
  {id:'feirante',name:'Feirante',subtitle:'Três buffs por um.',role:'Suporte',skill:'É Pra Acabar',stats:[2,2,3,5],art:9},
  {id:'tecnico-ti',name:'Técnico de TI',subtitle:'Já tentou reviver de novo?',role:'Controle',skill:'Reinicia Isso',stats:[1,3,5,3],art:10},
  {id:'streamer',name:'Streamer',subtitle:'A live não pode cair.',role:'Dano',skill:'Clipa Isso',stats:[3,4,2,3],art:11},
  {id:'coach',name:'Coach Quântico',subtitle:'Destrave seu dano interior.',role:'Suporte',skill:'Mude o Mindset',stats:[1,2,4,5],art:12},
  {id:'faxineira',name:'Faxineira',subtitle:'Vai varrer a dungeon.',role:'Controle',skill:'Passa o Rodo',stats:[3,3,4,2],art:13},
  {id:'concurseira',name:'Concurseira',subtitle:'Especialista em decorar padrões.',role:'Controle',skill:'Questão Anulada',stats:[1,2,5,4],art:14},
  {id:'vendedor-praia',name:'Vendedor de Praia',subtitle:'Reforço geladinho.',role:'Suporte',skill:'Olha a Água',stats:[2,4,2,4],art:15},
  {id:'pagodeiro',name:'Pagodeiro',subtitle:'Sustain no cavaquinho.',role:'Suporte',skill:'Deixa Acontecer',stats:[2,2,3,5],art:18},
  {id:'gambiarreiro',name:'Gambiarreiro',subtitle:'Temporário há seis anos.',role:'Controle',skill:'Fita Resolve',stats:[3,2,5,2],art:20},
  {id:'universitario',name:'Universitário',subtitle:'Entrega às 23h59.',role:'Dano',skill:'Prazo Final',stats:[3,4,4,1],art:21},
  {id:'passageira',name:'Passageira do Busão',subtitle:'Esquiva em horário de pico.',role:'Linha de frente',skill:'Dá Licença',stats:[3,5,2,2],art:22},
  {id:'porteiro',name:'Porteiro',subtitle:'Entrada só com autorização.',role:'Linha de frente',skill:'Nome na Lista',stats:[4,1,4,3],art:23},
  {id:'merendeira',name:'Merendeira',subtitle:'A cura vem de concha.',role:'Suporte',skill:'Prato Reforçado',stats:[3,1,3,5],art:26},
  {id:'rei-pastel',name:'Rei do Pastel',subtitle:'Crocância ofensiva.',role:'Dano',skill:'Óleo no Fogo',stats:[4,2,3,3],art:27},
  {id:'astrologa',name:'Astróloga',subtitle:'Seu ascendente é stun.',role:'Controle',skill:'Mercúrio Retrógrado',stats:[2,2,5,3],art:28},
  {id:'rei-arraia',name:'Rei do Arraiá',subtitle:'Pula a fogueira, chefão.',role:'Controle',skill:'Olha a Cobra',stats:[3,2,2,5],art:29},
  {id:'mae-pet',name:'Mãe de Pet',subtitle:'Companheiro inseparável.',role:'Suporte',skill:'Cadê o Neném',stats:[1,3,3,5],art:30},
  {id:'aposentado',name:'Aposentado',subtitle:'Experiência não falta.',role:'Controle',skill:'No Meu Tempo',stats:[3,1,5,3],art:31},
  {id:'conspiracionista',name:'Conspiracionista',subtitle:'Ele sabe demais. Talvez.',role:'Controle',skill:'Eu Já Sabia',stats:[1,3,5,3],art:33},
  // NEW-20261022-ORQ-gato-personagem-completo: kit approved by the ORQ (23/10 00:21Z); cell 16 is the one Tia da Festa left.
  {id:'gato-nada-pra-comer',name:'Gatito da raça nada para comer em casa',subtitle:'A fome é a arma mais forte.',role:'Controle',skill:'Miado de Fome',stats:[1,5,4,2],art:16},
];
export const roles: Role[] = ['Linha de frente','Dano','Suporte','Controle'];
export function getClass(id: string): HeroClass | undefined { return classes.find(hero => hero.id === id); }
/**
 * D-053 (17/10/2026): for now only the heroes with the complete R06 movement art (8 directions, 128 poses, the 15 of
 * personagens-movimento128) can be picked in the menu or drawn for a room bot. The other 20 stay in the code and data,
 * hidden: a room or link asking for one of them plays one of these (playableClassId), never an error.
 */
export const PLAYABLE_CLASS_IDS: readonly string[] = Object.freeze(['clt-cansado','coach','concurseira','faxineira','feirante',
  'gato-nada-pra-comer','maromba','mendigo','passageira','pedreiro','streamer','universitario','viciado-em-bet','vizinha-fofoqueira',
  // The user (24/10, "falta liberar o aposentado e o vendedor"): playable with their 4-direction sheets until the 8-direction art lands.
  'vendedor-praia','aposentado']);
/** Playable, but never drawn for a room bot (gato-no-menu: "bots não usam" for now; the vendedor and the aposentado until their 8-direction art). */
export const NOT_FOR_BOTS: readonly string[] = Object.freeze(['gato-nada-pra-comer','vendedor-praia','aposentado']);
/** The classes a room bot may get: the playable ones minus NOT_FOR_BOTS, in the roster's order. */
export const BOT_CLASS_IDS: readonly string[] = Object.freeze(PLAYABLE_CLASS_IDS.filter(id => !NOT_FOR_BOTS.includes(id)));
/** The playable classes, in the roster's order. */
export const playableClasses: HeroClass[] = classes.filter(hero => PLAYABLE_CLASS_IDS.includes(hero.id));
export const isPlayableClass = (id: unknown): id is string => typeof id === 'string' && PLAYABLE_CLASS_IDS.includes(id);
/** `id` when playable; otherwise (hidden, unknown, not a string) the first playable class. */
export const playableClassId = (id: unknown): string => isPlayableClass(id) ? id : playableClasses[0].id;
/** The menu's search: over the playable classes only (D-053). */
export function filterClasses(query: string, role: string): HeroClass[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  return playableClasses.filter(hero => (role === 'Todas' || hero.role === role) && normalize(`${hero.name} ${hero.skill} ${hero.subtitle}`).includes(normalize(query)));
}
