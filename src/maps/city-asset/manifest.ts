import {decodeCityAsset} from './decode.ts';

/** Manifest entry for an encoded asset: sha256 of the exact UTF-8 bytes (D-027), never of the character count. */
export interface CityManifest {id:string;version:number;hash:string;bytes:number}
const hex=(bytes:Uint8Array)=>{let out='';for(let i=0;i<bytes.length;i++)out+=(bytes[i]<16?'0':'')+bytes[i].toString(16);return out;};
/** Hash of the asset text as UTF-8 bytes, with Web Crypto (Node, browser and Workers alike). */
export async function cityAssetHash(json:string):Promise<string>{
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(json))));
}
/** Builds {id,version,hash,bytes} for the importer's manifest file; throws if the text is not a valid asset. */
export async function cityManifest(json:string):Promise<CityManifest>{
  const decoded=decodeCityAsset(json);
  if(!decoded.ok)throw new Error(`city asset: cannot build a manifest: ${decoded.error}`);
  return {id:decoded.asset.id,version:decoded.asset.version,hash:await cityAssetHash(json),bytes:new TextEncoder().encode(json).length};
}
/** Client/Worker check of downloaded or bundled text against the manifest (or the room's MapRef hash). Never throws. */
export async function checkCityHash(json:unknown,expected:unknown):Promise<{ok:true}|{ok:false;error:string}>{
  try{
    if(typeof json!=='string')return {ok:false,error:'asset text must be a string'};
    if(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected))return {ok:false,error:'expected hash must be 64 lowercase hex characters'};
    const actual=await cityAssetHash(json);
    return actual===expected?{ok:true}:{ok:false,error:'asset hash does not match'};
  }catch(error){return {ok:false,error:`hash check failed: ${error instanceof Error?error.message:String(error)}`};}
}
