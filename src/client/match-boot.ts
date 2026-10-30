/**
 * A match that does not open (partida-que-nao-abre-tem-saida): what the player reads and which ways out the window
 * offers, by kind of failure. explore.ts draws it with showFatal (net-fatal.ts); a second way out is a second button.
 * Pure (no DOM besides the WebGL probe), so the tests read the choices without Phaser.
 */
import {needsUpdate,REPLACED_MESSAGE} from '../protocol/room.ts';

export const BOOT_TEXT={
  loading:'Preparando a partida…',
  noWebgl:'Esse navegador não abriu o jogo. Atualiza o navegador ou tenta pelo Chrome.',
  failed:'Não deu pra abrir a partida.',
  slow:'Tá demorando mais que o normal.',
  retry:'Tentar de novo',
  home:'Voltar pro início',
} as const;
/** The loading cover with no ready() this long: the window offers a way out (the load keeps going behind it). */
export const COVER_SLOW_MS=20_000;

export type BootExit='retry'|'home';
export type BootFailure={kind:'no-webgl'|'failed'|'slow';text:string;exits:BootExit[]};

/** Can this browser make a WebGL context at all? Asked only after the boot failed (the scene runs Phaser.WEBGL). */
export function webglWorks(doc:Pick<Document,'createElement'>=document):boolean{
  try{const canvas=doc.createElement('canvas');return !!(canvas.getContext('webgl2')??canvas.getContext('webgl'));}catch{return false;}
}

/**
 * The boot threw (scene chunk, Phaser, the renderer). Without WebGL a retry gives the same screen: only the way home.
 * An old chunk is not here: the version watch takes it ('Saiu versão nova do jogo.').
 */
export function bootFailure(webgl:boolean):BootFailure{
  return webgl?{kind:'failed',text:BOOT_TEXT.failed,exits:['retry','home']}:{kind:'no-webgl',text:BOOT_TEXT.noWebgl,exits:['home']};
}
export const SLOW_COVER:BootFailure={kind:'slow',text:BOOT_TEXT.slow,exits:['retry','home']};

/**
 * The room stopped this client for good (net.fatal): which button the window gets. A reload only where it helps:
 * a new version, and another tab that took the character (REPLACED_MESSAGE says "toca em Atualizar"). Every other
 * refusal (sala cheia, sessão expirada, nome, sala de quem joga sozinho) forgot the seat, so reloading knocks on the
 * same door: the way home instead.
 */
export function refusalExit(message:string,{kicked,linkLost}:{kicked:boolean;linkLost:boolean}):'kicked'|'room'|'reload'|'home'{
  if(kicked)return 'kicked';
  if(linkLost)return 'room';
  if(needsUpdate(message)||message===REPLACED_MESSAGE)return 'reload';
  return 'home';
}
