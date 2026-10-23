/**
 * Ads boot (NEW-20261023-ORQ-anuncios-h5-games): tiny, so the menu imports it statically (menu-perf). When ads can run
 * (ads/config.ts) the ads chunk and Google's async script load after the load event, idle time and ADS_BOOT_DELAY_MS;
 * otherwise nothing at all is scheduled.
 */
import { ADS_CONFIG, activeAds, type AdsConfig } from '../ads/config.ts';
/** After the page's load event, idle time and this delay (the menu and its music go first) the ad script loads. */
export const ADS_BOOT_DELAY_MS=3000;

/** Schedules the ads chunk when ads can run; false (nothing loaded, zero calls) otherwise. */
export function startAds(win:Window,dev:boolean,config:Readonly<AdsConfig>=ADS_CONFIG):boolean{
  const active=activeAds({dev,search:win.location.search},config);
  if(!active)return false;
  const boot=()=>void import('../ads/ads.ts').then(m=>m.bootAds(active,win)).catch(()=>undefined);
  const later=()=>{
    const idle=(fn:()=>void)=>typeof win.requestIdleCallback==='function'?win.requestIdleCallback(fn,{timeout:4000}):win.setTimeout(fn,0);
    idle(()=>win.setTimeout(boot,ADS_BOOT_DELAY_MS));
  };
  if(win.document.readyState==='complete')later();else win.addEventListener('load',later,{once:true});
  return true;
}
