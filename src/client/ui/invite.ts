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

/**
 * Invite link: `?sala=` opens the room straight away (a saved hero joins by itself; a new player makes one first).
 * `extra`: more query (`&dev=1&g=…` when this tab chose "medir a turma" in the playtest, dev/ux-flag.ts inviteQuery).
 */
export const shareLink=(origin:string,code:string,extra='')=>`${origin.replace(/\/+$/,'')}/?sala=${encodeURIComponent(code)}${extra}`;
