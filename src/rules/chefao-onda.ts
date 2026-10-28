/**
 * Card NEW-20261023-ORQ-boss-fim-onda-1 (the user, 23/10: "no final da primeira onda ter um boss … nossas câmeras ficam
 * fixadas nele mostrando que ele chegou"): the chefão at the end of the 1st wave, mode 'ninhos' only. Shared by the sim
 * (sim/ninhos/chefao.ts: who, when, where), the room (multiplayer/boss-scene.ts: the scene) and the client (name,
 * subtitle, the camera).
 *  - who: one of WAVE_BOSSES, drawn per run from the room's seed (pickWaveBoss: the same for every player). The four
 *    roster chefes with a full boss sheet (384 px, 8 directions) that never showed up before (the user, 23/10: "aleatório
 *    entre os 4");
 *  - when: the 1st wave's last body leaves (its map share dripped out): a fixed moment that always happens (a cleared
 *    wave may never close with one player); then the time to explore (inicio-no-uno-caixas-120) once he falls;
 *  - the scene: CENA.totalMs with the room not stepping the sim (like the level-up pause, D-050): the camera goes to
 *    him (CENA.goMs), holds with the name (CENA.holdMs) and comes back (CENA.backMs). Nobody moves nor takes damage.
 */
import {Rng} from '../contract/index.ts';
import {playsElenco8} from './enemy-rotation.ts';

export interface WaveBoss {
  /** Roster id (rules/enemy-roster.ts, role 'chefe'): the enemy kind and its art. */
  id:string;
  /** Big title of the scene (ALL CAPS) and its one-line subtitle in the game's tone; the boss bar's name. */
  name:string;subtitle:string;bar:string;
  /** Barks (≤ 30 chars) for the fight and his death lines. */
  barks:readonly string[];deathLines:readonly string[];
}
export const WAVE_BOSSES:readonly WaveBoss[]=Object.freeze([
  {id:'o-grande-credor',name:'O GRANDE CREDOR',bar:'O Grande Credor',subtitle:'Feito de todos os boletos que você esqueceu.',
    barks:['Tua dívida tem filhos','Juros compostos, dor composta','Parcela um de novecentas','Eu sou o rotativo'],
    deathLines:['Quitado?! Ninguém quita!','Viro avião de papel...','Nome limpo... o meu?']},
  {id:'dj-do-fim-do-mundo',name:'DJ DO FIM DO MUNDO',bar:'DJ do Fim do Mundo',subtitle:'O drop dele derruba prédio.',
    barks:['Prepara pro drop final!','Mãos pro alto! Pro céu!','Esse set acaba com o mundo','Laser no olho é estilo'],
    deathLines:['Riscou o disco... silêncio','Fim da festa. Da Terra.','Sem bis pra mim']},
  {id:'mapinguari-do-shopping',name:'MAPINGUARI DO SHOPPING',bar:'Mapinguari do Shopping',subtitle:'Tem uma boca na barriga e cartão sem limite.',
    barks:['Parcelo tua alma em 10x','A boca da barriga tá com fome','Liquidação de gente!','Passa no crédito, passa'],
    deathLines:['Cadeira de massagem... enfim','Fatura fechou... eu também','Volto na Black Friday']},
  {id:'boitata-de-sacolinha',name:'BOITATÁ DE SACOLINHA',bar:'Boitatá de Sacolinha',subtitle:'Feito de toda sacolinha que você jurou reaproveitar.',
    barks:['Vai uma sacolinha aí?','Queimo mais que plástico','Mil anos pra me decompor','Olha a fumaça preta!'],
    deathLines:['Reciclado... em cubinhos','Virei sacola retornável','Separa o lixo, por favor']},
]);
export const WAVE_BOSS_IDS:readonly string[]=Object.freeze(WAVE_BOSSES.map(b=>b.id));
export const waveBossById=(id:string|undefined)=>WAVE_BOSSES.find(b=>b.id===id);

/**
 * The cast of eight's chefão (enemy-rotation.ts ELENCO_8, card elenco-de-8): always him, so a phone keeps one HD
 * chefão in its cache. The lightest of the four on a phone: 14.3 MB and ~356 MB of textures against 14.3-20.2 MB and
 * 361-398 MB (evidence/NEW-20261028-ORQ-elenco-de-8/mapa.md).
 */
export const ELENCO_8_CHEFAO='dj-do-fim-do-mundo';
/**
 * The run's chefão: ELENCO_8_CHEFAO with the cast of eight, else drawn from the room's seed, so every player (and a
 * resumed run) gets the same one.
 */
export const pickWaveBoss=(seed:number):WaveBoss=>playsElenco8()?waveBossById(ELENCO_8_CHEFAO)!:
  WAVE_BOSSES[new Rng(seed).fork('chefao-onda').int(0,WAVE_BOSSES.length-1)];

/**
 * The fight (first pass; the balance is noted on the card): the final boss's controller (sim/boss.ts) with these
 * numbers, × hp by players like it (bossMaxHp: + hpPerExtraPlayer a player, 1..6).
 *  - waveIndex: the wave (0-based) whose end calls him;
 *  - fromCar: he appears this far from the Uno along the wave's way in (its entrance's route to the car), and at least
 *    clear from every body (a player, offline or downed too); the route's end when nothing fits;
 *  - crate: the crate he drops (sim/crates.ts rarity: 4 dourada; the final boss's is 5, lendária).
 */
export const WAVE_BOSS=Object.freeze({
  waveIndex:0,fromCar:24,clear:12,crate:4 as const,
  baseHp:1100,hpPerExtraPlayer:.7,damage:.7,
  /**
   * The user, 23/10: "tamanho 2× a 3× o atual" (a roster chefe draws 3 heroes tall, client art/horde-art.ts ROLE_HEIGHT).
   * His drawing × this; his body (radius) and his charge's width × it too, his slam, stamp and sweep × (1 + it) / 2.
   * The user, 24/10, after the 2× and 3× prints: "Ponha 3x pelo meme".
   */
  drawScale:3,
  /** The user, 24/10: with one player (alone, a fall is the defeat) his hits × this. */
  soloDamage:.5,
  /**
   * The user, 24/10: "ele bate na gente e a gente é empurrado igual ao gigante do L4D2": his slam throws whoever it hits
   * this far (u, away from where it landed), his charge farther (along it); then a short fall (contract KNOCK_*).
   */
  slamPush:5,chargePush:6,
});
/** The arrival scene (ms of the room's wall clock): go to him, hold on him, come back. */
export const CENA=Object.freeze({goMs:600,holdMs:2000,backMs:600,totalMs:3200});
