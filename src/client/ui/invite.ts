// Room invite (NEW-20261009-UX-lobby-mobile): the code shown in groups (3103-A23-B68), read back with or without the
// dashes, and the link `?sala=<code>` that opens the room by itself. Pure and import-free: main.ts reads it statically.

/** Code of a room as the Worker makes it: 10 hex characters, upper case. */
export function isRoomCode(code:string){return /^[A-F0-9]{10}$/.test(code);}

/** Shown in groups of 4-3-3 (`3103-A23-B68`); anything that is not a full code is shown as typed. */
export function formatRoomCode(code:string){
  const c=code.toUpperCase();
  return isRoomCode(c)?`${c.slice(0,4)}-${c.slice(4,7)}-${c.slice(7)}`:c;
}

/**
 * What the player typed or pasted, as a code: dashes, spaces and dots go, letters go up. A pasted invite link gives its
 * `?sala=` (or the older `?room=`).
 */
export function readRoomCode(text:string){
  const t=text.trim();
  const linked=/[?&](?:sala|room)=([^&#\s]+)/i.exec(t);
  if(linked){const code=inviteCode(`?sala=${linked[1]}`);if(code)return code;}
  return t.replace(/[\s.\-_–—]/g,'').toUpperCase();
}

/** The room of an invite link (`?sala=`, or `?room=` from links sent before it), only when it is a valid code. */
export function inviteCode(search:string){
  let p:URLSearchParams;
  try{p=new URLSearchParams(search);}catch{return undefined;}
  for(const key of ['sala','room']){
    const raw=p.get(key);if(raw===null)continue;
    const code=raw.replace(/[\s.\-_–—]/g,'').toUpperCase();
    if(isRoomCode(code))return code;
  }
  return undefined;
}

/** Longest inviter name the menu shows (the rooms' own NAME_MAX, client/ui/nick.ts). */
export const INVITER_MAX=20;
/** A name from a link: no control characters, spaces tidied, at most INVITER_MAX characters (never half an emoji). */
const linkName=(raw:string)=>Array.from(raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/\s+/g,' ').trim()).slice(0,INVITER_MAX).join('').trim();

/**
 * Who sent the invite (menu-diz-o-jogo-e-convite): the `&de=` the link carries, cleaned, or undefined. Only text: the
 * menu writes it with textContent.
 */
export function inviterName(search:string){
  let p:URLSearchParams;
  try{p=new URLSearchParams(search);}catch{return undefined;}
  return linkName(p.get('de')??'')||undefined;
}

// The nickname of whoever shares from this tab (main.ts setInviter, when the lobby opens): the link says who called.
let inviter='';
export function setInviter(name:string){inviter=linkName(name);}

/**
 * Invite link: `?sala=` opens the room straight away (a saved hero joins by itself; a new player makes one first), and
 * `&de=` says who called (setInviter; the friend's menu reads it with inviterName).
 * `extra`: more query (`&dev=1&g=…` when this tab chose "medir a turma" in the playtest, dev/ux-flag.ts inviteQuery).
 */
export const shareLink=(origin:string,code:string,extra='')=>
  `${origin.replace(/\/+$/,'')}/?sala=${encodeURIComponent(code)}${inviter?`&de=${encodeURIComponent(inviter)}`:''}${extra}`;
