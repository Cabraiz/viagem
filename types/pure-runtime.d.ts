/**
 * The only runtime globals the pure sectors (contract, rules, maps, sim, protocol) may use.
 * Loaded by tsconfig.pure.json only, which has no DOM lib and no @types: every name here exists in the
 * browser, in Cloudflare Workers and in Node, so the sectors stay runnable on the client and in the room.
 * Need another global? Add it here only if all three runtimes have it; anything browser-only belongs in src/client.
 * Left out on purpose although every runtime has them: timers (setTimeout/setInterval) break the simulation's
 * determinism (time comes from ticks), and console logging belongs to the caller (client or room), not to pure code.
 */
declare class TextEncoder {
  readonly encoding:string;
  encode(input?:string):Uint8Array<ArrayBuffer>;
}
declare class TextDecoder {
  constructor(label?:string,options?:{fatal?:boolean;ignoreBOM?:boolean});
  readonly encoding:string;
  decode(input?:ArrayBuffer|ArrayBufferView,options?:{stream?:boolean}):string;
}
declare function structuredClone<T>(value:T,options?:{transfer?:unknown[]}):T;
declare var crypto:{
  /** Integer typed arrays only, as in every runtime (a Float64Array throws TypeMismatchError). */
  getRandomValues<T extends Int8Array|Uint8Array|Uint8ClampedArray|Int16Array|Uint16Array|Int32Array|Uint32Array|BigInt64Array|BigUint64Array>(array:T):T;
  readonly subtle:{digest(algorithm:string|{name:string},data:ArrayBuffer|ArrayBufferView):Promise<ArrayBuffer>};
};
