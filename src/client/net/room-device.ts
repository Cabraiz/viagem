/**
 * sala-rede-ruim-e-convite (auditoria multijogador 5): this browser's id for POST /rooms. The room Worker counts the
 * rooms a minute per IP + this id (CREATE_LIMIT), so two phones behind one IP (a carrier's CGNAT, a school's Wi-Fi) no
 * longer spend each other's rooms; the IP alone has a higher ceiling (CREATE_IP_LIMIT). Not a secret, not an account:
 * a random id kept in localStorage, a fresh one each page when storage is off.
 */
export const DEVICE_KEY='viagem:device';
/** What the Worker takes as a device id (multiplayer/worker.ts readDevice): anything else counts as none. */
export const DEVICE_PATTERN=/^[A-Za-z0-9-]{8,40}$/;
let fallback:string|undefined;
export function deviceId(storage:Pick<Storage,'getItem'|'setItem'>|undefined=globalThis.localStorage,make=()=>crypto.randomUUID()):string{
  try{
    if(!storage)return fallback??=make();
    const kept=storage.getItem(DEVICE_KEY);
    if(kept&&DEVICE_PATTERN.test(kept))return kept;
    const id=make();storage.setItem(DEVICE_KEY,id);return id;
  }catch{return fallback??=make();}
}
