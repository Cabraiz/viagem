/**
 * The playtest metrics' switch (NEW-20261009-UX-playtest-metricas), apart from the metrics themselves so the game loads
 * only this line when they are off: `dev/ux-metrics.ts` is imported on demand, only with `?dev=1`.
 */
/** The page address flag: exactly `dev=1` (not `dev`, `dev=true` or `dev=0`). */
export const UX_FLAG={name:'dev',value:'1'} as const;

/** Whether the metrics are on for this page address (`location.search`). Never throws. */
export function uxMetricsEnabled(search:string|undefined):boolean{
  try{return new URLSearchParams(search??'').get(UX_FLAG.name)===UX_FLAG.value;}catch{return false;}
}
