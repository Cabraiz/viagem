/**
 * CORS/WebSocket origin policy for the rooms worker. Pure (no Workers runtime) so node tests can import it.
 * Production origins are always allowed. Local dev origins are allowed only when ALLOW_LOCAL is 'true'
 * (wrangler dev --var ALLOW_LOCAL:true); wrangler.jsonc keeps it 'false' for the deployed worker.
 */
export const PRODUCTION_ORIGINS:ReadonlySet<string>=new Set(['https://viagem.cyou','https://www.viagem.cyou']);
/** Legacy local port, plus one vite port per executor: 4200 + executor number. */
export const LOCAL_PORT=4187;
export const EXECUTOR_PORTS={min:4200,max:4299} as const;

const LOCAL_ORIGIN=/^http:\/\/127\.0\.0\.1:(\d{4})$/;

export function isAllowedOrigin(origin:string,allowLocal:boolean):boolean{
  if(PRODUCTION_ORIGINS.has(origin))return true;
  if(!allowLocal)return false;
  const match=LOCAL_ORIGIN.exec(origin);
  if(!match)return false;
  const port=Number(match[1]);
  return port===LOCAL_PORT||(port>=EXECUTOR_PORTS.min&&port<=EXECUTOR_PORTS.max);
}
