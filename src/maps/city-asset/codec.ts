/** Base64, LSB-first bitsets and the small JSON helpers shared by the encoder and the decoder. */
// ---- base64 and bitsets ----

const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_CODES=Uint8Array.from(B64,ch=>ch.charCodeAt(0));
const B64_INDEX=(()=>{const t=new Uint8Array(256).fill(255);for(let i=0;i<64;i++)t[B64_CODES[i]]=i;return t})();
const PAD=61;

/** Standard base64 with padding. */
export function encodeBase64(bytes:Uint8Array):string{
  const n=bytes.length,out=new Uint8Array(Math.ceil(n/3)*4),C=B64_CODES;
  let o=0,i=0;
  for(;i+2<n;i+=3){
    const v=bytes[i]<<16|bytes[i+1]<<8|bytes[i+2];
    out[o++]=C[v>>18];out[o++]=C[v>>12&63];out[o++]=C[v>>6&63];out[o++]=C[v&63];
  }
  if(i<n){
    const two=i+1<n,v=bytes[i]<<16|(two?bytes[i+1]<<8:0);
    out[o++]=C[v>>18];out[o++]=C[v>>12&63];out[o++]=two?C[v>>6&63]:PAD;out[o++]=PAD;
  }
  let s='';
  for(let k=0;k<out.length;k+=0x8000)s+=String.fromCharCode.apply(null,out.subarray(k,k+0x8000) as unknown as number[]);
  return s;
}

/** Strict base64 to exactly `size` bytes (canonical length and padding, zero pad bits); null when anything is off. */
export function decodeBase64(text:string,size:number):Uint8Array|null{
  if(typeof text!=='string'||!(size>=0)||text.length!==Math.ceil(size/3)*4)return null;
  const T=B64_INDEX,at=(i:number)=>{const c=text.charCodeAt(i);return c<256?T[c]:255};
  const out=new Uint8Array(size),full=Math.floor(size/3),rest=size-full*3;
  let o=0,i=0;
  for(let g=0;g<full;g++,i+=4){
    const a=at(i),b=at(i+1),c=at(i+2),d=at(i+3);
    if((a|b|c|d)>63)return null;
    const v=a<<18|b<<12|c<<6|d;
    out[o++]=v>>16;out[o++]=v>>8&255;out[o++]=v&255;
  }
  if(rest){
    const a=at(i),b=at(i+1);
    if((a|b)>63||text.charCodeAt(i+3)!==PAD)return null;
    if(rest===1){
      if(text.charCodeAt(i+2)!==PAD||b&15)return null;
      out[o]=a<<2|b>>4;
    }else{
      const c=at(i+2);
      if(c>63||c&3)return null;
      out[o++]=a<<2|b>>4;out[o]=(b&15)<<4|c>>2;
    }
  }
  return out;
}

/** 0/1 values to an LSB-first bitset (any truthy value sets the bit). */
export function packBits(values:ArrayLike<number>):Uint8Array{
  const n=values.length,out=new Uint8Array((n+7)>>3);
  for(let i=0;i<n;i++)if(values[i])out[i>>3]|=1<<(i&7);
  return out;
}

/** LSB-first bitset to `count` values 0/1. */
export function unpackBits(bits:Uint8Array,count:number):Uint8Array{
  const out=new Uint8Array(count);
  for(let i=0;i<count;i++)out[i]=bits[i>>3]>>(i&7)&1;
  return out;
}

// ---- shared by encode and decode ----

export const round3=(v:number)=>{const r=Math.round(v*1000)/1000;return r===0?0:r};
export const isObj=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
export const J=JSON.stringify;
