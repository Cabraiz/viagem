/**
 * The stadium menu's sign (NEW-20261021-ORQ-botao-selecionar): the big letreiro shows the chosen hero's name ("VICIADO
 * EM" in Papel, "BET" big in Amarelo, like the old "BORA PRA / TORCIDA!") and the plaque under it his nickname. Heroes
 * without a nickname yet show their classes.ts subtitle. Pure (node tests); main.ts writes it on every ‹ ›.
 */
import type {HeroClass} from '../../rules/index.ts';

/** Nicknames by class id (the user's, 21/10). The rest show their subtitle until they get one. */
export const APELIDOS:Readonly<Record<string,string>>=Object.freeze({
  'viciado-em-bet':'O rei da picaretagem',
});

const upper=(s:string)=>s.toLocaleUpperCase('pt-BR');

/** The plaque: the nickname, else the subtitle, in caps, without the subtitle's closing period (a sign, not a sentence). */
export function plaqueText(hero:Pick<HeroClass,'id'|'subtitle'>):string{
  return upper((APELIDOS[hero.id]??hero.subtitle).trim().replace(/\.$/,''));
}

/** The letreiro's two lines: every word but the last on top, the last one big below (one word: only the big line). */
export function titleLines(name:string):[string,string]{
  const words=upper(name).trim().split(/\s+/).filter(Boolean);
  const last=words.pop()??'';
  return [words.join(' '),last];
}

/**
 * The letreiro's shrink for long names (CSS --titulo-fit): measured on the menu (21/10), the column holds a 14-letter top
 * line and a 13-letter big one (×1.18) at 1280×720, 844×390 and 390×844 (there the two lines run inline and wrap). The
 * longest names of today's cast ("PASSAGEIRA DO", "CAÇA-PROMOÇÃO", "UNIVERSITÁRIO") fit at full size; a longer one
 * scales the whole sign down, never below MIN_FIT.
 */
export const TOP_CHARS=14,BIG_CHARS=13,MIN_FIT=.5;
export function titleFit([top,big]:readonly [string,string]):number{
  const fit=Math.min(1,top?TOP_CHARS/top.length:1,big?BIG_CHARS/big.length:1);
  return Math.max(MIN_FIT,Math.floor(fit*100)/100);
}

/**
 * The final letreiro is a picture per hero (E7 makes it with the name and the nickname in the same design): its URL by
 * class id. Absent: the HTML letreiro above (name + plaque), until that hero's picture arrives. The page loads the 960 px
 * lite copy (scripts/art-lite.mjs MENU_SIZE, NEW-20261029-ORQ-primeira-visita-leve: 144 KB instead of 659, the widest
 * the menu draws it is ~810 px); the approved file stays in /art/menu/letreiro for the art scripts.
 */
export const LETREIROS:Readonly<Record<string,string>>=Object.freeze({
  'viciado-em-bet':'/art/lite/menu/letreiro/viciado-em-bet.webp', // the approved art (21/10, scripts/menu-arte.mjs)
  'clt-cansado':'/art/lite/menu/letreiro/clt-cansado.webp', // the office plaque drawn into his sunset (letreiro-clt-na-cena)
  'gato-nada-pra-comer':'/art/lite/menu/letreiro/gato-nada-pra-comer.webp', // the fish collar tag (gato-no-menu, variation 3 of 8)
  'maromba':'/art/lite/menu/letreiro/maromba.webp', // the iron plate (tela-maromba, variation 2 of 8)
  'vendedor-praia':'/art/lite/menu/letreiro/vendedor-praia.webp', // the blue cooler (tela-vendedor-praia, variation 1 of 8)
  'aposentado':'/art/lite/menu/letreiro/aposentado.webp', // the workshop's wooden plaque (tela-aposentado, variation 1 of 8)
});
/**
 * Letreiros taller than their sign (gato-no-menu, the user: "ampliar bem muito para cima caso precise descer"): the
 * picture's size and, from its bottom, the height of the sign itself (the cutout the user chose); the rest is the
 * collar, which runs up off the top of the screen. The menu lays the sign out like any other letreiro and lets the
 * collar overflow (estadio.css .letreiro-alto, main.ts --sinal-ar/--alto-ar). Sizes of the approved file: only their
 * ratios are used, the lite copy has the same shape.
 */
export const LETREIRO_ALTO:Readonly<Record<string,Readonly<{w:number,h:number,sinal:number}>>>=Object.freeze({
  // letreiro-gato-na-cena: 915 of the 2195 rows of the cutout are variation 3's own picture (juntar-ext.py).
  'gato-nada-pra-comer':Object.freeze({w:2436,h:4163,sinal:Math.round(4163*915/2195)}),
});
/**
 * The heroes whose new art (the row's face) is in: the others show a "?" in the row while the user redraws them
 * (21/10). Empty until the first one arrives; adding an id brings that hero's face back.
 */
export const ARTE_NOVA:ReadonlySet<string>=new Set<string>([]);
export const letreiroOf=(id:string):string|undefined=>LETREIROS[id];
export const letreiroAltoOf=(id:string)=>LETREIRO_ALTO[id];
export const hasNewArt=(id:string)=>ARTE_NOVA.has(id);
