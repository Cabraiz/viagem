/**
 * CORS/WebSocket origin policy for the rooms worker. Pure (no Workers runtime) so node tests can import it.
 * Production origins are always allowed. Local dev origins are allowed only when ALLOW_LOCAL is 'true'
 * (wrangler dev --var ALLOW_LOCAL:true); wrangler.jsonc keeps it 'false' for the deployed worker.
 */
export const PRODUCTION_ORIGINS:ReadonlySet<string>=new Set(['https://viagem.cyou','https://www.viagem.cyou']);
/** Legacy local port (npm run preview / single executor). */
export const LOCAL_PORT=4187;
/** One vite port range per executor group: PC executors 42NN (4200 + N), cloud executors 43k0..43k9 (N<k>). */
export const EXECUTOR_PORTS={min:4200,max:4299} as const;
export const CLOUD_EXECUTOR_PORTS={min:4300,max:4399} as const;
const LOCAL_RANGES=[EXECUTOR_PORTS,CLOUD_EXECUTOR_PORTS] as const;

const LOCAL_ORIGIN=/^http:\/\/127\.0\.0\.1:(\d{4})$/;

export function isAllowedOrigin(origin:string,allowLocal:boolean):boolean{
  if(PRODUCTION_ORIGINS.has(origin))return true;
  if(!allowLocal)return false;
  const match=LOCAL_ORIGIN.exec(origin);
  if(!match)return false;
  const port=Number(match[1]);
  return port===LOCAL_PORT||LOCAL_RANGES.some(r=>port>=r.min&&port<=r.max);
}
